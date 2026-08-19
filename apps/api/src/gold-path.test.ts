import assert from "node:assert/strict";
import test from "node:test";

import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { z, ZodError } from "zod";

import { p05GoldPathIds, createP05GoldPathFixture } from "@workhub/agent/fixtures";
import { loadSettings, type Settings } from "@workhub/config";
import { goldPathSurfaceVmSchema, type AttentionItem } from "@workhub/contracts";
import type {
  ClientDeviceAuthRow,
  ClientDeviceRepository,
  UserAuthRow,
  UserRepository
} from "@workhub/db";

import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "./middleware/auth.js";
import { httpErrorCodeFor } from "./http-error-codes.js";
import { createAgentRunRoutes } from "./routes/agent-runs.js";
import { createKnowledgeRoutes } from "./routes/knowledge.js";
import { createPageRoutes } from "./routes/pages.js";
import { malformedJsonMessage } from "./routes/json-body.js";
import { buildP05GoldPathSurfacePage } from "./pages/gold-path.js";
import { InternalContractError } from "./pages/output-contract.js";
import type { ApprovalService } from "./services/approvals.js";
import { InProcessPushBus } from "./broker/memory.js";
import { createProposalRoutes } from "./routes/proposals.js";
import { createSessionRoutes } from "./routes/sessions.js";
import { createWorkItemRoutes } from "./routes/workitems.js";
import { DrivePageServiceError } from "./services/drive-pages.js";
import type { ProjectHomePageService } from "./services/project-home-pages.js";
import { createInMemoryProposalService, type ProposalService } from "./services/proposals.js";
import {
  createInMemoryWorkItemService,
  driveTargetFileNamesFromIntent,
  parseClarificationDraftFromLlmText,
  WorkItemServiceError,
  type WorkItemService
} from "./services/work-items.js";
import type { AgentRunQueue, AgentRunQueueRecord } from "./workers/agent-runner.js";

const now = new Date("2026-06-05T00:00:00.000Z");
const userId = "10000000-0000-4000-8000-000000000010";

function user(partial: Partial<UserAuthRow> = {}): UserAuthRow {
  return {
    id: userId,
    nickname: "gold-path-user",
    cookieToken: "cookie-gold-path",
    preferredLocale: "zh-CN",
    availabilityStatus: "free",
    availabilityText: null,
    availabilityUpdatedAt: null,
    mutedNotificationTypes: [],
    isAdmin: false,
    deletedAt: null,
    deletedByUserId: null,
    createdAt: now,
    updatedAt: now,
    ...partial
  };
}

class MemoryUsers implements UserRepository {
  constructor(private readonly rows: UserAuthRow[]) {}

  async findActiveById(id: string) {
    return this.rows.find((candidate) => candidate.id === id && candidate.deletedAt === null) ?? null;
  }

  async findActiveByCookieToken(cookieToken: string) {
    return this.rows.find((candidate) => candidate.cookieToken === cookieToken && candidate.deletedAt === null) ?? null;
  }

  async findActiveByNickname() {
    return null;
  }

  async createUser(): Promise<UserAuthRow> {
    throw new Error("not needed");
  }

  async getOrCreateActiveByNickname(): Promise<{ user: UserAuthRow; created: boolean }> {
    throw new Error("not needed");
  }

  async rotateCookieToken() {
    return null;
  }
}

class MemoryDevices implements ClientDeviceRepository {
  async findActiveByTokenHash() {
    return null;
  }

  async findActiveByTokenHashForUser() {
    return null;
  }

  async createClientDevice(): Promise<ClientDeviceAuthRow> {
    throw new Error("not needed");
  }

  async listByUser() {
    return [];
  }

  async touchLastSeen() {
    return null;
  }

  async revokeByIdForUser() {
    return null;
  }

  async revokeByTokenHash() {
    return null;
  }
}

function settings(): Settings {
  return loadSettings({
    APP_ENV: "test",
    COOKIE_SECRET: "test-cookie-secret"
  });
}

function authDeps(runtimeSettings: Settings, rows: UserAuthRow[] = [user()]): AuthDependencies {
  return {
    users: new MemoryUsers(rows),
    devices: new MemoryDevices(),
    settings: runtimeSettings,
    now: () => now
  };
}

// 本地开发机的默认 escalation 仓库指向真实持久化存储，残留 dev 数据会漏进
// attention 决策队列断言（CI 干净所以看不出来）。attention 测试一律显式注入空升级源。
function emptyEscalations() {
  return {
    async listAttentionPage() {
      return { items: [], page_info: { limit: 50, returned: 0, has_more: false } };
    },
    async listAttentionItems() {
      return [];
    }
  } as never;
}

function emptyQueue(): AgentRunQueue {
  return {
    async enqueue(): Promise<AgentRunQueueRecord> {
      throw new Error("not needed");
    },
    async get() {
      return null;
    },
    async workdir() {
      return null;
    },
    async trace() {
      return [];
    },
    async abort(): Promise<AgentRunQueueRecord> {
      throw new Error("not needed");
    },
    async listActive() {
      return [];
    },
    async recoverExpiredClaims() {
      return [];
    },
    async recoverUnsettledTaskPlanRuns() {
      return [];
    },
    async run(): Promise<AgentRunQueueRecord> {
      throw new Error("not needed");
    },
    async runNext() {
      return null;
    }
  };
}

function pageRun(partial: Partial<AgentRunQueueRecord> = {}): AgentRunQueueRecord {
  const runtimeSettings = settings();
  return {
    run_id: "40000000-0000-4000-8000-0000000000a1",
    workspace_id: runtimeSettings.auth.defaultWorkspaceId,
    work_item_id: p05GoldPathIds.workItem,
    actor_id: userId,
    mode: "worker",
    status: "running",
    title: "WorkHub QA run",
    budget: {
      max_steps: 10,
      total_timeout_s: 300,
      max_tokens: 100000,
      max_cost_cny: "3"
    },
    budget_decision: {
      decision_id: "gold-path-page-budget",
      allowed: true,
      model_route: {
        provider: runtimeSettings.llm.defaultProvider,
        model: runtimeSettings.llm.model,
        reason: "default"
      }
    },
    usage: {
      steps_used: 1,
      token_in: 100,
      token_out: 20,
      estimated_cost_cny: "0.01"
    },
    trace: [],
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    ...partial
  };
}

function withErrors<T extends { Variables: Record<string, unknown> }>(app: Hono<T>) {
  app.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json({ ok: false, error: { code: "validation_error", message: "invalid payload" } }, 422);
    }
    if (error instanceof WorkItemServiceError) {
      return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as 400);
    }
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: httpErrorCodeFor(error), message: error.message } }, error.status);
    }
    throw error;
  });
  return app;
}

async function cookie(runtimeSettings: Settings) {
  return generateSignedCookie(COOKIE_NAME, "cookie-gold-path", runtimeSettings.auth.cookieSecret);
}

test("P0.5 gold path page bundle exposes page VMs, events, and Cuu state progression", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/pages", createPageRoutes({ auth: authDeps(runtimeSettings), queue: emptyQueue() }));

  const response = await app.request("/api/pages/gold-path", {
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(response.status, 200);
  const body = await response.json() as {
    ok: true;
    data: {
      fixture_id: string;
      routes: { approvals: string };
      page_vms: {
        question: { options: unknown[] };
        approvals: { items: unknown[]; requests: { status: string }[] };
        replay: { steps: unknown[] };
      };
      events: { type: string; topic: string; attention?: { id: string } }[];
      cuu_states: string[];
    };
  };
  assert.equal(body.data.fixture_id, "weekly_report_manifest_doc");
  assert.equal(body.data.routes.approvals, "/approvals");
  assert.equal(body.data.page_vms.question.options.length >= 2, true);
  assert.equal(body.data.page_vms.approvals.items.length, 1);
  assert.equal(body.data.page_vms.approvals.requests[0]?.status, "pending");
  assert.equal(body.data.page_vms.replay.steps.length >= 5, true);
  assert.equal(body.data.events.some((event) => event.type === "permission.ask" && event.topic.startsWith("user:")), true);
  assert.equal(body.data.cuu_states.includes("carrying_document"), true);
  assert.equal(body.data.cuu_states.includes("celebrating"), true);
});

test("P0.5 gold path page wraps surface VM drift as an internal contract error", () => {
  let drift: ZodError | undefined;
  try {
    z.object({ fixture_id: z.string() }).parse({});
  } catch (error) {
    drift = error as ZodError;
  }
  const schema = goldPathSurfaceVmSchema as typeof goldPathSurfaceVmSchema & {
    parse: typeof goldPathSurfaceVmSchema.parse;
  };
  const originalParse = schema.parse;
  schema.parse = (() => {
    throw drift;
  }) as typeof goldPathSurfaceVmSchema.parse;

  try {
    assert.throws(
      () => buildP05GoldPathSurfacePage(),
      (error: unknown) => error instanceof InternalContractError && error.context === "gold-path.surface"
    );
  } finally {
    schema.parse = originalParse;
  }
});

test("attention home decision queue is fed by the user's pending approvals", async () => {
  const runtimeSettings = settings();
  const fixture = createP05GoldPathFixture();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/pages", createPageRoutes({
    auth: authDeps(runtimeSettings),
    queue: emptyQueue(),
    escalations: emptyEscalations(),
    // 决策队列必须接真实的"用户待决策审批"源；这里用 gold-path 审批中心做替身。
    approvals: { async listPendingForUser() { return fixture.approvalCenter; } } as unknown as ApprovalService,
    // 决策队列现在按可读工作项收口（findings）；注入放行所有工作项的 workItems，让 fixture 审批项保持可见。
    // routes-a-2 修法：可见性判定换成批量 canReadWorkItems（不再逐次 detailPage），这里的桩要跟着换，
    // 否则 visibleApprovalCenter 调用一个不存在的方法、运行时 undefined 短路成「不可见」，队列会被误判成空
    // （这不是 fixture 该测的东西——测试意图是"放行所有工作项"，旧断言 0 而非 1 是桩没跟上实现换代产生的假失败）。
    workItems: { async canReadWorkItems(input: { workItemIds: string[] }) { return new Set(input.workItemIds); } } as never
  }));

  const response = await app.request("/api/pages/attention", {
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(response.status, 200);
  const body = await response.json() as {
    data: { queue: { id: string }[]; primary?: { id: string } };
  };
  assert.ok(fixture.approvalCenter.items.length > 0);
  assert.equal(body.data.queue.length, fixture.approvalCenter.items.length);
  assert.equal(body.data.primary?.id, fixture.approvalCenter.items[0]?.id);
});

test("attention home scopes proposal review lookup to the actor workspace", async () => {
  const runtimeSettings = settings();
  let captured: { user: { id: string; isAdmin: boolean; workspaceId?: string } } | undefined;
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/pages", createPageRoutes({
    auth: authDeps(runtimeSettings),
    queue: emptyQueue(),
    approvals: {
      async listPendingForUser() {
        return {
          items: [],
          requests: [],
          filters: {},
          counts: { pending: 0, pending_total: 0 },
          page_info: { limit: 100, returned: 0, has_more: false },
          items_detail: {}
        };
      }
    } as unknown as ApprovalService,
    proposals: {
      async listReviewableForUser(input: { user: { id: string; isAdmin: boolean; workspaceId?: string } }) {
        captured = input;
        return [];
      }
    } as unknown as ProposalService
  }));

  const response = await app.request("/api/pages/attention", {
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(response.status, 200);
  assert.equal(captured?.user.id, userId);
  assert.equal(captured?.user.workspaceId, runtimeSettings.auth.defaultWorkspaceId);
});

test("attention home includes durable memory conflict cards as sync_conflict decisions", async () => {
  const runtimeSettings = settings();
  let capturedWorkspaceId: string | undefined;
  const conflictId = "40000000-0000-4000-8000-0000000000d1";
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/pages", createPageRoutes({
    auth: authDeps(runtimeSettings),
    queue: emptyQueue(),
    escalations: emptyEscalations(),
    approvals: {
      async listPendingForUser() {
        return {
          items: [],
          requests: [],
          filters: {},
          counts: { pending: 0, pending_total: 0 },
          page_info: { limit: 100, returned: 0, has_more: false },
          items_detail: {}
        };
      }
    } as unknown as ApprovalService,
    proposals: {
      async listReviewableForUser() {
        return [];
      }
    } as unknown as ProposalService,
    memoryConflicts: {
      async listAttentionItems(input: { actor: AuthEnv["Variables"]["actor"] }) {
        capturedWorkspaceId = input.actor.workspaceId;
        return [{
          id: conflictId,
          kind: "sync_conflict" as const,
          priority: "high" as const,
          source_ref: { entity_type: "notification" as const, entity_id: conflictId },
          title: "Cuu 学到了两条打架的偏好",
          summary_text: "回复风格出现两种说法，需要确认。",
          actions: [
            { id: "keep_current", label: "要 A", style: "secondary" as const, method: "POST" as const, href: `/api/memory-conflicts/${conflictId}/resolve/keep_current` },
            { id: "accept_incoming", label: "要 B", style: "primary" as const, method: "POST" as const, href: `/api/memory-conflicts/${conflictId}/resolve/accept_incoming` }
          ],
          cuu_state: "worried" as const,
          created_at: "2026-07-03T00:00:00.000Z"
        }];
      }
    }
  }));

  const response = await app.request("/api/pages/attention?locale=zh-CN", {
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(response.status, 200);
  const body = await response.json() as { data: { primary?: AttentionItem; queue: AttentionItem[] } };
  assert.equal(capturedWorkspaceId, runtimeSettings.auth.defaultWorkspaceId);
  assert.equal(body.data.primary?.id, conflictId);
  assert.equal(body.data.primary?.kind, "sync_conflict");
  assert.deepEqual(body.data.primary?.actions.map((action) => action.id), ["keep_current", "accept_incoming"]);
});

test("attention home warns when unresolved escalation attention is capped", async () => {
  const runtimeSettings = settings();
  const escalationId = "40000000-0000-4000-8000-0000000000e1";
  const card: AttentionItem = {
    id: escalationId,
    kind: "escalation",
    priority: "urgent",
    source_ref: { entity_type: "escalation_event", entity_id: escalationId },
    title: "《竞品资料梳理》卡住了",
    summary_text: "需要你判断下一步。",
    actions: [{
      id: "escalation_retry",
      label: "让它重试",
      style: "primary",
      method: "POST",
      href: `/api/escalations/${escalationId}/resolve`
    }],
    created_at: "2026-07-03T00:00:00.000Z"
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/pages", createPageRoutes({
    auth: authDeps(runtimeSettings),
    queue: emptyQueue(),
    escalations: {
      async listAttentionPage() {
        return {
          items: [card],
          page_info: { limit: 50, returned: 1, has_more: true }
        };
      },
      async listAttentionItems() {
        return [card];
      }
    } as never,
    approvals: {
      async listPendingForUser() {
        return {
          items: [],
          requests: [],
          filters: {},
          counts: { pending: 0, pending_total: 0 },
          page_info: { limit: 100, returned: 0, has_more: false },
          items_detail: {}
        };
      }
    } as unknown as ApprovalService,
    memoryConflicts: { async listAttentionItems() { return []; } },
    proposals: { async listReviewableForUser() { return []; } } as unknown as ProposalService
  }));

  const response = await app.request("/api/pages/attention?locale=zh-CN", {
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(response.status, 200);
  const body = await response.json() as {
    data: {
      queue: AttentionItem[];
      source_warnings?: Array<{ source: string; message: string }>;
    };
  };
  assert.equal(body.data.queue[0]?.id, escalationId);
  assert.equal(body.data.source_warnings?.[0]?.source, "escalations");
  assert.match(body.data.source_warnings?.[0]?.message ?? "", /上限/u);
});

test("attention home preserves task-plan proposal reviews as plan_review cards", async () => {
  const runtimeSettings = settings();
  const planProposalId = "40000000-0000-4000-8000-0000000000b1";
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/pages", createPageRoutes({
    auth: authDeps(runtimeSettings),
    queue: emptyQueue(),
    escalations: emptyEscalations(),
    approvals: {
      async listPendingForUser() {
        return {
          items: [],
          requests: [],
          filters: {},
          counts: { pending: 0, pending_total: 0 },
          page_info: { limit: 100, returned: 0, has_more: false },
          items_detail: {}
        };
      }
    } as unknown as ApprovalService,
    proposals: {
      async listReviewableForUser() {
        return [{
          id: planProposalId,
          work_item_id: "40000000-0000-4000-8000-0000000000b2",
          title: "《短剧选题调研》的分工计划等你过目",
          status: "opened" as const,
          created_at: "2026-07-03T00:00:00.000Z",
          review_kind: "plan_review" as const
        }];
      }
    } as unknown as ProposalService
  }));

  const response = await app.request("/api/pages/attention?locale=zh-CN", {
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(response.status, 200);
  const body = await response.json() as { data: { primary?: AttentionItem; queue: AttentionItem[] } };
  assert.equal(body.data.primary?.kind, "plan_review");
  assert.equal(body.data.primary?.source_ref.entity_id, planProposalId);
  // R9.7: the old assertion leaked internal "派发" terminology into user-facing plan-review copy.
  assert.equal(body.data.primary?.summary_text, "任务已拆成任务计划，等你确认后再开始执行。");
  assert.equal(body.data.primary?.actions.find((action) => action.id === "open_proposal")?.label, "查看计划提议");
});

test("attention home background runs stay scoped to the actor workspace for admins", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  const currentRun = pageRun({ run_id: "40000000-0000-4000-8000-0000000000a1" });
  const foreignRun = pageRun({
    run_id: "40000000-0000-4000-8000-0000000000a2",
    workspace_id: "99990000-0000-4000-8000-000000000002"
  });
  const queue: AgentRunQueue = {
    ...emptyQueue(),
    async listActive() {
      return [currentRun, foreignRun];
    }
  };
  app.route("/api/pages", createPageRoutes({
    auth: authDeps(runtimeSettings, [user({ isAdmin: true })]),
    queue,
    approvals: {
      async listPendingForUser() {
        return {
          items: [],
          requests: [],
          filters: {},
          counts: { pending: 0, pending_total: 0 },
          page_info: { limit: 100, returned: 0, has_more: false },
          items_detail: {}
        };
      }
    } as unknown as ApprovalService,
    proposals: { async listReviewableForUser() { return []; } } as unknown as ProposalService
  }));

  const response = await app.request("/api/pages/attention", {
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  const body = await response.json() as { data: { background_runs: Array<{ run_id: string }> } };

  assert.equal(response.status, 200);
  assert.deepEqual(body.data.background_runs.map((run) => run.run_id), [currentRun.run_id]);
});

test("work item page route preserves work item service error codes", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  const workItems = {
    async detailPage() {
      throw new WorkItemServiceError(409, "workitem_state_conflict", "这个事项当前状态不能打开详情。");
    }
  } as unknown as WorkItemService;
  app.route("/api/pages", createPageRoutes({
    auth: authDeps(runtimeSettings),
    queue: emptyQueue(),
    workItems
  }));

  const response = await app.request(`/api/pages/workitems/${p05GoldPathIds.workItem}`, {
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  const body = await response.json() as { ok: false; error: { code: string; message: string } };

  assert.equal(response.status, 409);
  assert.equal(body.error.code, "workitem_state_conflict");
  assert.equal(body.error.message, "这个事项当前状态不能打开详情。");
});

test("drive page route preserves drive service error codes", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  const drivePages = {
    async page() {
      throw new DrivePageServiceError(409, "文件版本已经变化，请刷新后重试。", "drive_current_version_changed");
    }
  };
  app.route("/api/pages", createPageRoutes({
    auth: authDeps(runtimeSettings),
    queue: emptyQueue(),
    drivePages: drivePages as never
  }));

  const response = await app.request("/api/pages/drive", {
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  const body = await response.json() as { ok: false; error: { code: string; message: string } };

  assert.equal(response.status, 409);
  assert.equal(body.error.code, "drive_current_version_changed");
  assert.equal(body.error.message, "文件版本已经变化，请刷新后重试。");
});

test("attention home marks the decision queue as partial when the approvals lookup fails", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/pages", createPageRoutes({
    auth: authDeps(runtimeSettings),
    queue: emptyQueue(),
    // 本测试断言升级源与审批源都产生 partial 警告：两者都注入抛错桩。
    // （不能靠默认 escalation 仓库在测试环境里"恰好"报错——本地有真实存储时它会读成功。）
    escalations: {
      async listAttentionPage() { throw new Error("escalation store down"); },
      async listAttentionItems() { throw new Error("escalation store down"); }
    } as never,
    approvals: { async listPendingForUser() { throw new Error("db down"); } } as unknown as ApprovalService,
    memoryConflicts: { async listAttentionItems() { return []; } },
    proposals: { async listReviewableForUser() { return []; } } as never
  }));

  const response = await app.request("/api/pages/attention", {
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(response.status, 200);
  const body = await response.json() as { data: { queue: unknown[]; primary?: unknown; source_warnings: { source: string; message: string }[] } };
  assert.equal(body.data.queue.length, 0);
  assert.equal(body.data.primary, undefined);
  // R9.0: the old assertion expected only `approvals`, but `/attention` now loads unresolved
  // escalation cards before approvals, so both degraded sources must be exposed when their
  // default services are unavailable in this fixture.
  assert.deepEqual(body.data.source_warnings.map((warning) => warning.source), ["escalations", "approvals"]);
  assert.match(body.data.source_warnings.find((warning) => warning.source === "approvals")?.message ?? "", /审批待办/u);
});

test("settings page carries server locale preference sync state without secrets", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/pages", createPageRoutes({
    auth: authDeps(runtimeSettings, [user({ preferredLocale: "en-US" })]),
    queue: emptyQueue(),
    readiness: async () => ({
      ready: true,
      checks: { database: { ok: true }, broker: { ok: true } }
    })
  }));

  const response = await app.request("/api/pages/settings?locale=zh-CN", {
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(response.status, 200);
  const body = await response.json() as {
    meta: { locale: string };
    data: {
      locale: string;
      runtime: { runtime_status: string };
      language: {
        active_locale: string;
        preference_locale: string;
        preference_source: string;
        preference_synced: boolean;
        update_href: string;
      };
      device: {
        restore_requires_desktop: boolean;
        web_local_actions_enabled: boolean;
        pet_model_settings_in_web: boolean;
      };
    };
  };
  assert.equal(body.meta.locale, "zh-CN");
  assert.equal(body.data.locale, "zh-CN");
  assert.equal(body.data.runtime.runtime_status, "ready");
  assert.equal(body.data.language.active_locale, "zh-CN");
  assert.equal(body.data.language.preference_locale, "en-US");
  assert.equal(body.data.language.preference_source, "server");
  assert.equal(body.data.language.preference_synced, false);
  assert.equal(body.data.language.update_href, "/api/auth/preferences");
  assert.equal(body.data.device.restore_requires_desktop, true);
  assert.equal(body.data.device.web_local_actions_enabled, false);
  assert.equal(body.data.device.pet_model_settings_in_web, false);
  assert.equal(JSON.stringify(body.data).includes("sk-"), false);
});

test("P0.5 page routes echo normalized locale metadata for bilingual clients", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/pages", createPageRoutes({
    auth: authDeps(runtimeSettings),
    queue: emptyQueue(),
    allowUnauthenticatedGoldPath: true
  }));

  const english = await app.request("/api/pages/gold-path?locale=en-US");
  const fallback = await app.request("/api/pages/gold-path?locale=fr-FR");

  assert.equal(english.status, 200);
  assert.equal(fallback.status, 200);
  const englishBody = await english.json() as {
    meta: { locale: string };
    data: {
      page_vms: {
        question: { options: { label: string }[] };
        approvals: { items: { actions: { label: string }[] }[] };
      };
    };
  };
  assert.equal(englishBody.meta.locale, "en-US");
  assert.equal(englishBody.data.page_vms.question.options[0]?.label, "Risk first");
  assert.equal(englishBody.data.page_vms.approvals.items[0]?.actions.some((action) => action.label === "Approve"), true);
  assert.equal((await fallback.json() as { meta: { locale: string } }).meta.locale, "zh-CN");
});

test("P0.5 gold path preview can be served without DB auth when explicitly enabled", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/pages", createPageRoutes({
    auth: authDeps(runtimeSettings),
    queue: emptyQueue(),
    allowUnauthenticatedGoldPath: true
  }));

  const response = await app.request("/api/pages/gold-path");

  assert.equal(response.status, 200);
  const body = await response.json() as { ok: true; data: { fixture_id: string } };
  assert.equal(body.data.fixture_id, "weekly_report_manifest_doc");
});

test("P0.5 gold path preview still closes when unauthenticated preview is disabled", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/pages", createPageRoutes({
    auth: authDeps(runtimeSettings),
    queue: emptyQueue(),
    allowUnauthenticatedGoldPath: false
  }));

  const response = await app.request("/api/pages/gold-path");

  assert.equal(response.status, 401);
});

test("project home route preserves project domain code for malformed project ids", async () => {
  const runtimeSettings = settings();
  const calls: unknown[] = [];
  const projectHomePages: ProjectHomePageService = {
    async page(input) {
      calls.push(input);
      throw new Error("project home service should not be reached");
    }
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/pages", createPageRoutes({
    auth: authDeps(runtimeSettings),
    projectHomePages
  }));

  const response = await app.request("/api/pages/project/not-a-project", {
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(response.status, 404);
  const body = await response.json() as { error: { code: string } };
  assert.equal(body.error.code, "project_not_found");
  assert.deepEqual(calls, []);
});

test("production routes use real services and do not serve the P0.5 fixture route set", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  const auth = authDeps(runtimeSettings);
  const proposals = createInMemoryProposalService({ now: () => now });
  const workItems = createInMemoryWorkItemService({ now: () => now });
  app.route("/api", createSessionRoutes({ auth, workItems }));
  app.route("/api", createWorkItemRoutes({ auth, workItems }));
  app.route("/api/knowledge", createKnowledgeRoutes({ auth, workItems }));
  app.route("/api/pages", createPageRoutes({
    auth,
    queue: emptyQueue(),
    proposals,
    workItems,
    allowUnauthenticatedGoldPath: false
  }));
  app.route("/api", createAgentRunRoutes({ auth, queue: emptyQueue(), autoRun: false }));
  app.route("/api/proposals", createProposalRoutes({ auth, proposals }));
  const headers = { Cookie: await cookie(runtimeSettings) };

  const session = await app.request("/api/sessions", {
    method: "POST",
    headers,
    body: JSON.stringify({ intent_text: "帮我整理客户周报模板。" })
  });
  assert.equal(session.status, 200);
  const sessionBody = await session.json() as {
    data: {
      session_id: string;
      work_item_id: string;
      question: { input_mode: string; title: string; body?: string; options: { id: string }[] };
    };
  };
  assert.equal(sessionBody.data.question.input_mode, "long_text");
  assert.match(sessionBody.data.question.title, /确认|澄清/u);
  assert.match(`${sessionBody.data.question.title} ${sessionBody.data.question.body ?? ""}`, /客户周报模板/u);
  assert.doesNotMatch(`${sessionBody.data.question.title} ${sessionBody.data.question.body ?? ""}`, /需要先确认一个关键点|交付方式|文档\/方案|结构化数据|小型代码/u);
  assert.deepEqual(sessionBody.data.question.options.map((option) => option.id), []);
  const question = await app.request(`/api/sessions/${sessionBody.data.session_id}/next-question`, {
    method: "POST",
    headers,
    body: JSON.stringify({ free_text: "按项目已有资料整理成可审阅的周报模板。" })
  });
  const createdWorkItem = await app.request("/api/workitems", {
    method: "POST",
    headers,
    body: JSON.stringify({
      session_id: sessionBody.data.session_id,
      free_text: "最终验收补充：输出必须给产品经理和交付负责人看。"
    })
  });
  assert.equal(question.status, 200);
  assert.equal(createdWorkItem.status, 201);
  const createdWorkItemBody = await createdWorkItem.json() as {
    data: { workitem: { id: string; status: string; planning_note?: string } };
  };
  assert.equal(createdWorkItemBody.data.workitem.status, "spec_ready");
  assert.match(createdWorkItemBody.data.workitem.planning_note ?? "", /周报模板/u);
  assert.match(createdWorkItemBody.data.workitem.planning_note ?? "", /产品经理和交付负责人/u);
  const realWorkItemId = createdWorkItemBody.data.workitem.id;
  const evidence = await app.request("/api/knowledge/search", {
    method: "POST",
    headers,
    body: JSON.stringify({ query: "周报", work_item_id: realWorkItemId })
  });
  assert.equal(evidence.status, 200);
  const evidenceBody = await evidence.json() as {
    data: { evidence_refs: { id: string; source_type: string; source_id: string; title: string }[] };
  };
  assert.equal(evidenceBody.data.evidence_refs.length >= 1, true);
  const workitem = await app.request(`/api/pages/workitems/${realWorkItemId}`, { headers });
  const evidenceBound = await app.request(`/api/workitems/${realWorkItemId}/evidence-bindings`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      evidence_refs: evidenceBody.data.evidence_refs
    })
  });
  const p05Workitem = await app.request(`/api/pages/workitems/${p05GoldPathIds.workItem}`, { headers });
  const proposal = await app.request(`/api/pages/proposals/${p05GoldPathIds.proposal}`, { headers });
  const replay = await app.request(`/api/agent-runs/${p05GoldPathIds.run}/replay`, { headers });
  const proposalReview = await app.request(`/api/proposals/${p05GoldPathIds.proposal}/review`, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "approve" })
  });
  const proposalMerge = await app.request(`/api/proposals/${p05GoldPathIds.proposal}/merge`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });

  assert.equal(workitem.status, 200);
  assert.equal(evidenceBound.status, 200);
  assert.equal(p05Workitem.status, 404);
  assert.equal(proposal.status, 404);
  assert.equal(replay.status, 404);
  assert.equal(proposalReview.status, 404);
  assert.equal(proposalMerge.status, 404);
});

test("session route publishes generated questions to the advertised session stream", async () => {
  const runtimeSettings = settings();
  const auth = authDeps(runtimeSettings);
  const workItems = createInMemoryWorkItemService({ now: () => now });
  const publishedEvents: { topic: string; type: string; data: Record<string, unknown> }[] = [];
  const app = withErrors(new Hono<AuthEnv>());
  class CapturingSessionBus extends InProcessPushBus {
    override async publish(topic: string, type: string, data: unknown) {
      publishedEvents.push({ topic, type, data: data as Record<string, unknown> });
      await super.publish(topic, type, data);
    }
  }
  const bus = new CapturingSessionBus();
  app.route("/api", createSessionRoutes({ auth, workItems, bus }));

  const response = await app.request("/api/sessions", {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) },
    body: JSON.stringify({ intent_text: "生成一组三条验收要点。" })
  });
  const body = await response.json() as {
    ok: true;
    data: {
      session_id: string;
      stream_href: string;
      question: { id: string; input_mode: string };
    };
  };

  assert.equal(response.status, 200);
  assert.equal(body.data.stream_href, `/api/push/stream/session/${body.data.session_id}`);
  assert.equal(publishedEvents.length, 1);
  assert.equal(publishedEvents[0]?.topic, `session:${body.data.session_id}`);
  assert.equal(publishedEvents[0]?.type, "session.question");
  const eventPayload = publishedEvents[0]?.data["data"] as Record<string, unknown> | undefined;
  assert.equal(eventPayload?.["session_id"], body.data.session_id);
  assert.equal(eventPayload?.["question_id"], body.data.question.id);
  assert.equal(eventPayload?.["input_mode"], "long_text");

  const readback = await app.request(`/api/sessions/${body.data.session_id}`, {
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  assert.equal(readback.status, 200);
  assert.equal(publishedEvents.length, 1);
});

test("session clarification question is generated from the request and project files", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  const auth = authDeps(runtimeSettings);
  const workItems = createInMemoryWorkItemService({
    now: () => now,
    async projectFileContext() {
      return [{
        name: "workhub-app-upload.txt",
        path: "验收材料/workhub-app-upload.txt",
        preview: "客户周报模板需要覆盖风险、进展和下周动作。"
      }];
    },
    async clarificationGenerator(input) {
      return {
        title: "需要确认 workhub-app-upload.txt 里的哪一段作为最终验收口径？",
        body: `需求：${input.workItem.rawDescription}\n文件：${input.files[0]?.path}`,
        placeholder: "请补充最终验收口径。"
      };
    }
  });
  app.route("/api", createSessionRoutes({ auth, workItems }));
  const headers = { Cookie: await cookie(runtimeSettings) };

  const session = await app.request("/api/sessions", {
    method: "POST",
    headers,
    body: JSON.stringify({ intent_text: "请读取项目网盘文件并整理验收要点。" })
  });

  assert.equal(session.status, 200);
  const body = await session.json() as {
    data: { question: { input_mode: string; title: string; body?: string; options: { id: string }[] } };
  };
  assert.equal(body.data.question.input_mode, "long_text");
  assert.match(body.data.question.title, /workhub-app-upload\.txt/u);
  assert.match(body.data.question.body ?? "", /项目网盘文件/u);
  assert.match(body.data.question.body ?? "", /验收材料\/workhub-app-upload\.txt/u);
  assert.deepEqual(body.data.question.options.map((option) => option.id), []);
});

test("session route preserves AI clarification service error codes", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  const auth = authDeps(runtimeSettings);
  const workItems = {
    async createSession() {
      throw new WorkItemServiceError(
        502,
        "clarification_llm_templated_response",
        "AI 材料分析返回了泛化模板，不是真实反问。"
      );
    }
  } as unknown as WorkItemService;
  app.route("/api", createSessionRoutes({ auth, workItems }));

  const response = await app.request("/api/sessions", {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: JSON.stringify({ intent_text: "请读取项目网盘 workhub-app-upload.txt 并生成验收要点。" })
  });

  assert.equal(response.status, 502);
  const body = await response.json() as { error: { code: string; message: string } };
  assert.equal(body.error.code, "clarification_llm_templated_response");
  assert.match(body.error.message, /泛化模板/u);
});

test("in-memory session clarification keeps the explicit project context for QA harnesses", async () => {
  const requestedProjectId = "10000000-0000-4000-8000-0000000000aa";
  let contextProjectId: string | undefined;
  const workItems = createInMemoryWorkItemService({
    now: () => now,
    async projectFileContext(input) {
      contextProjectId = input.projectId;
      return [{
        name: "workhub-app-upload.txt",
        path: "workhub-app-upload.txt",
        preview: "验收材料"
      }];
    },
    async clarificationGenerator(input) {
      return {
        title: "请确认 workhub-app-upload.txt 的三条验收要点面向谁？",
        body: `project=${input.workItem.projectId}`,
        placeholder: "例如：面向验收同学。"
      };
    }
  });

  const session = await workItems.createSession({
    actor: {
      kind: "human",
      id: userId,
      label: "gold-path-user",
      userId,
      isAdmin: false,
      orgId: "00000000-0000-4000-8000-000000000001",
      workspaceId: "00000000-0000-4000-8000-000000000002"
    },
    locale: "zh-CN",
    payload: {
      project_id: requestedProjectId,
      intent_text: "请读取项目网盘 workhub-app-upload.txt 并生成验收要点。"
    }
  });

  assert.equal(contextProjectId, requestedProjectId);
  assert.match(session.question.body ?? "", new RegExp(requestedProjectId, "u"));
});

test("AI clarification extracts explicit drive filenames from the user's request", () => {
  assert.deepEqual(
    driveTargetFileNamesFromIntent("请根据 验收材料/workhub-app-upload.txt，结合 docs/周报-v2.md 生成验收要点。"),
    ["workhub-app-upload.txt", "周报-v2.md"]
  );
  assert.deepEqual(
    driveTargetFileNamesFromIntent("没有点名文件，只说整理项目网盘。"),
    []
  );
  // R9 批次0-2 回归：版本号/小数/域名/URL 不是点名文件，禁止误报（曾把普通意图 502 掉）。
  assert.deepEqual(
    driveTargetFileNamesFromIntent("把 v1.2 升级到 2.0，预算 3.14 万，参考 example.com 和 https://a.io/report.md 的做法。"),
    []
  );
  assert.deepEqual(
    driveTargetFileNamesFromIntent("整理 需求.md 和 数据表.xlsx，忽略 .md 这种裸扩展名。"),
    ["需求.md", "数据表.xlsx"]
  );
});

test("R10-0c clarification file context drops old project files that are irrelevant to the current intent", async () => {
  const { fileContextFromDriveRows } = await import("./services/work-items.js");
  const rows = {
    items: [
      { id: "f1", kind: "file", name: "day-1-pilot-feedback-digest.md", parentId: null, currentVersionId: null },
      { id: "f2", kind: "file", name: "regional-report-template.md", parentId: null, currentVersionId: null }
    ],
    versions: []
  } as never;

  // 全新意图与两份旧文件零相关 → 空上下文（宁缺毋滥，LLM 只围绕意图反问，不被旧任务带偏）。
  const unrelated = await fileContextFromDriveRows(rows, "检查异步动作状态提示，不继续创建正式任务。");
  assert.equal(unrelated.length, 0);

  // 点名文件始终进入上下文，且相关文件按分数排序。
  const named = await fileContextFromDriveRows(rows, "基于 regional-report-template.md 更新风险段落");
  assert.equal(named.length, 1);
  assert.equal(named[0]?.name, "regional-report-template.md");
});

test("AI clarification parser accepts question/context JSON from real providers", () => {
  const body = Array.from({ length: 60 }, () => "请围绕验收材料/workhub-app-upload.txt 的风险、进展和下周动作生成验收口径。").join("");
  const placeholder = Array.from({ length: 20 }, () => "例如：只使用 workhub-app-upload.txt，并面向验收同学输出。").join("");

  const draft = parseClarificationDraftFromLlmText(JSON.stringify({
    question: "请确认是否只使用验收材料/workhub-app-upload.txt 作为三条验收要点的唯一来源？",
    context: body,
    placeholder
  }), "zh-CN");

  assert.equal(draft.title, "请确认是否只使用验收材料/workhub-app-upload.txt 作为三条验收要点的唯一来源？");
  assert.match(draft.body ?? "", /workhub-app-upload\.txt/u);
  assert.ok((draft.body ?? "").length <= 900);
  assert.ok((draft.placeholder ?? "").length <= 180);
});

test("R10-0c clarification parser carries option candidates through to the scope question contract", () => {
  const draft = parseClarificationDraftFromLlmText(JSON.stringify({
    question: "复盘包以哪份材料为唯一数据来源？",
    options: [
      { id: "option-1", label: "只用 workhub-app-upload.txt", description: "口径最稳，缺口由 AI 标注。" },
      { label: "上传材料 + 周会纪要", description: "更全，但要人工核对两处冲突。" },
      { label: "" },
      "not-an-object"
    ],
    recommended_option_id: "option-1"
  }), "zh-CN");

  assert.equal(draft.options?.length, 2);
  assert.equal(draft.options?.[0]?.id, "option-1");
  // 缺省 id 按序补齐；空 label 与非对象项被丢弃。
  assert.equal(draft.options?.[1]?.id, "option-2");
  assert.equal(draft.recommended_option_id, "option-1");

  // 只有 1 条有效候选 → 不构成选项集，退化为无选项（渲染端回长文本，不造假选项）。
  const single = parseClarificationDraftFromLlmText(JSON.stringify({
    question: "确认验收对象？",
    options: [{ label: "验收同学" }],
    recommended_option_id: "option-1"
  }), "zh-CN");
  assert.equal(single.options, undefined);
  assert.equal(single.recommended_option_id, undefined);
});

test("AI clarification parser extracts fenced JSON without requiring exact title/body fields", () => {
  const draft = parseClarificationDraftFromLlmText([
    "```json",
    JSON.stringify({
      clarification_question: "workhub-app-upload.txt 里未写明验收对象，请确认这三条要点给谁使用？",
      context: "用户要求输出给验收同学，项目文件名是 workhub-app-upload.txt。"
    }),
    "```"
  ].join("\n"), "zh-CN");

  assert.match(draft.title, /workhub-app-upload\.txt/u);
  assert.match(draft.body ?? "", /验收同学/u);
});

test("AI clarification accepts material-grounded questions that mention the Markdown deliverable", async () => {
  const workItems = createInMemoryWorkItemService({
    now: () => now,
    async projectFileContext() {
      return [{
        name: "workhub-app-upload.txt",
        path: "验收材料/workhub-app-upload.txt",
        preview: "验收材料要求三条要点覆盖真实 App 读取网盘、Cuu 反问和交付物回看。"
      }];
    },
    async clarificationGenerator(input) {
      return {
        title: "请确认 workhub-app-upload.txt 中列出的三条 App 验收口径是否就是 Markdown 交付方式的全部范围？",
        body: `我已读取 ${input.files[0]?.path}，里面提到真实 App 读取项目网盘、Cuu 根据材料反问、最终交付物回看。`,
        placeholder: "例如：是，只围绕这三条验收。"
      };
    }
  });

  const session = await workItems.createSession({
    actor: {
      kind: "human",
      id: userId,
      label: "gold-path-user",
      userId,
      isAdmin: false,
      orgId: "00000000-0000-4000-8000-000000000001",
      workspaceId: "00000000-0000-4000-8000-000000000002"
    },
    locale: "zh-CN",
    payload: {
      intent_text: "请根据项目网盘 workhub-app-upload.txt 生成三条验收要点，输出成 Markdown 交付物。"
    }
  });

  assert.equal(session.question.input_mode, "long_text");
  assert.match(session.question.title, /workhub-app-upload\.txt/u);
  assert.match(session.question.title, /Markdown/u);
  assert.deepEqual(session.question.options.map((option) => option.id), []);
});

test("AI clarification rejects generic preset-template follow-up questions", async () => {
  const workItems = createInMemoryWorkItemService({
    now: () => now,
    async projectFileContext() {
      return [{
        name: "workhub-app-upload.txt",
        path: "验收材料/workhub-app-upload.txt",
        preview: "WorkHub desktop app upload smoke"
      }];
    },
    async clarificationGenerator() {
      return {
        title: "这件事先按哪种交付方式处理？",
        body: "可以选择文档/方案草稿、结构化数据或小型代码/模板。",
        placeholder: "请选择一个方向。"
      };
    }
  });

  await assert.rejects(
    () => workItems.createSession({
      actor: {
        kind: "human",
        id: userId,
        label: "gold-path-user",
        userId,
        isAdmin: false,
        orgId: "00000000-0000-4000-8000-000000000001",
        workspaceId: "00000000-0000-4000-8000-000000000002"
      },
      locale: "zh-CN",
      payload: {
        intent_text: "请读取项目网盘 workhub-app-upload.txt 并生成验收要点。"
      }
    }),
    (error) => error instanceof WorkItemServiceError && error.code === "clarification_llm_templated_response"
  );
});

test("AI clarification fails clearly when project files cannot be read", async () => {
  const workItems = createInMemoryWorkItemService({
    now: () => now,
    async projectFileContext() {
      throw new Error("drive context unavailable");
    }
  });

  await assert.rejects(
    () => workItems.createSession({
      actor: {
        kind: "human",
        id: userId,
        label: "gold-path-user",
        userId,
        isAdmin: false,
        orgId: "00000000-0000-4000-8000-000000000001",
        workspaceId: "00000000-0000-4000-8000-000000000002"
      },
      locale: "zh-CN",
      payload: {
        intent_text: "请读取项目网盘 workhub-app-upload.txt 并生成验收要点。"
      }
    }),
    (error) => error instanceof WorkItemServiceError && error.code === "clarification_file_context_failed"
  );
});

test("M10: confirm-step '调整范围' navigates back to the scope question instead of dead-ending", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  const auth = authDeps(runtimeSettings);
  const workItems = createInMemoryWorkItemService({ now: () => now });
  app.route("/api", createSessionRoutes({ auth, workItems }));
  const headers = { Cookie: await cookie(runtimeSettings) };

  const session = await app.request("/api/sessions", {
    method: "POST",
    headers,
    body: JSON.stringify({ intent_text: "帮我整理客户周报模板。" })
  });
  assert.equal(session.status, 200);
  const sessionBody = (await session.json()) as {
    data: { session_id: string; question: { input_mode: string; options: { id: string }[] } };
  };
  const sessionId = sessionBody.data.session_id;

  assert.equal(sessionBody.data.question.input_mode, "long_text");
  assert.deepEqual(sessionBody.data.question.options.map((option) => option.id), []);

  // Answer the AI clarification question → advances to the confirm step.
  const toConfirm = await app.request(`/api/sessions/${sessionId}/next-question`, {
    method: "POST",
    headers,
    body: JSON.stringify({ free_text: "请优先依据项目文档里的口径。" })
  });
  assert.equal(toConfirm.status, 200);
  const confirmBody = (await toConfirm.json()) as { data: { question: { input_mode: string } } };
  assert.equal(confirmBody.data.question.input_mode, "confirm");

  // Selecting "调整范围"(adjust-scope) on confirm must return to the scope question,
  // not re-render confirm (the M10 dead-end).
  const back = await app.request(`/api/sessions/${sessionId}/next-question`, {
    method: "POST",
    headers,
    body: JSON.stringify({ selected_option_ids: ["adjust-scope"] })
  });
  assert.equal(back.status, 200);
  const backBody = (await back.json()) as {
    data: { question: { input_mode: string; options: { id: string }[] } };
  };
  assert.equal(backBody.data.question.input_mode, "long_text");
  const optionIds = backBody.data.question.options.map((option) => option.id);
  assert.equal(optionIds.includes("adjust-scope"), false);
  assert.deepEqual(optionIds, []);
});

test("session next-question validates session id before parsing the body", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  const auth = authDeps(runtimeSettings);
  const workItems = createInMemoryWorkItemService({ now: () => now });
  app.route("/api", createSessionRoutes({ auth, workItems }));

  const response = await app.request("/api/sessions/not-a-uuid/next-question", {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: "{"
  });

  assert.equal(response.status, 404);
});

test("session create checks work item mutation before unrelated schema errors", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  const auth = authDeps(runtimeSettings);
  const workItemId = "50000000-0000-4000-8000-0000000000c4";
  let createSessionCalled = false;
  const workItems = {
    assertCanMutateWorkItem: async (input: Parameters<WorkItemService["assertCanMutateWorkItem"]>[0]) => {
      assert.equal(input.workItemId, workItemId);
      throw new WorkItemServiceError(403, "forbidden", "你没有权限修改这个事项。");
    },
    createSession: async () => {
      createSessionCalled = true;
      throw new Error("createSession must not be reached before the work item mutation gate");
    }
  } as unknown as WorkItemService;
  app.route("/api", createSessionRoutes({ auth, workItems }));

  const response = await app.request("/api/sessions", {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: JSON.stringify({
      work_item_id: workItemId,
      project_id: "not-a-uuid"
    })
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {
      code: "forbidden",
      message: "你没有权限修改这个事项。"
    }
  });
  assert.equal(createSessionCalled, false);
});

test("session create route returns malformed_json for malformed request bodies", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  const auth = authDeps(runtimeSettings);
  const workItems = {
    createSession: async () => {
      throw new Error("createSession must not be reached for malformed JSON");
    }
  } as unknown as WorkItemService;
  app.route("/api", createSessionRoutes({ auth, workItems }));

  const response = await app.request("/api/sessions", {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: "{"
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {
      code: "malformed_json",
      message: malformedJsonMessage
    }
  });
});

test("session next-question checks session access before parsing the body", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  const auth = authDeps(runtimeSettings);
  let nextQuestionCalled = false;
  let getSessionCalled = false;
  const workItems = {
    getSession: async () => {
      getSessionCalled = true;
      throw new Error("getSession must not run before mutation gate because it can regenerate clarification");
    },
    assertCanMutateWorkItem: async () => {
      throw new WorkItemServiceError(403, "forbidden", "你没有权限查看这个会话。");
    },
    nextQuestion: async () => {
      nextQuestionCalled = true;
      throw new Error("nextQuestion must not be reached for an unreadable session");
    }
  } as unknown as WorkItemService;
  app.route("/api", createSessionRoutes({ auth, workItems }));

  const response = await app.request("/api/sessions/50000000-0000-4000-8000-0000000000c5/next-question", {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: "{"
  });

  assert.equal(response.status, 403);
  assert.equal(getSessionCalled, false);
  assert.equal(nextQuestionCalled, false);
});

test("session next-question checks mutation access before parsing the answer body", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  const auth = authDeps(runtimeSettings);
  let nextQuestionCalled = false;
  const workItems = {
    getSession: async () => ({
      session_id: "50000000-0000-4000-8000-0000000000c6",
      work_item_id: "50000000-0000-4000-8000-0000000000c6",
      stage: "scope",
      question: { title: "补充信息", input_mode: "long_text", options: [] }
    }),
    assertCanMutateWorkItem: async () => {
      throw new WorkItemServiceError(403, "forbidden", "你没有权限修改这个事项。");
    },
    assertCanMutateArtifacts: async () => {
      throw new WorkItemServiceError(403, "forbidden", "你没有权限修改这个事项的正式交付物。");
    },
    nextQuestion: async () => {
      nextQuestionCalled = true;
      throw new Error("nextQuestion must not be reached for a readonly session");
    }
  } as unknown as WorkItemService;
  app.route("/api", createSessionRoutes({ auth, workItems }));

  const response = await app.request("/api/sessions/50000000-0000-4000-8000-0000000000c6/next-question", {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: "{"
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {
      code: "forbidden",
      message: "你没有权限修改这个事项。"
    }
  });
  assert.equal(nextQuestionCalled, false);
});
