import assert from "node:assert/strict";
import test from "node:test";

import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { loadSettings, type Settings } from "@workhub/config";
import type {
  AttentionItem,
  DelegateEscalationRequest,
  ResolveEscalationRequest,
  WorkHubLocale
} from "@workhub/contracts";
import type {
  ClientDeviceAuthRow,
  ClientDeviceRepository,
  UserAuthRow,
  UserRepository
} from "@workhub/db";

import { COOKIE_NAME, type AuthActor, type AuthDependencies, type AuthEnv } from "./middleware/auth.js";
import { httpErrorCodeFor } from "./http-error-codes.js";
import { createEscalationRoutes } from "./routes/escalations.js";
import { createPageRoutes } from "./routes/pages.js";
import { EscalationServiceError, type EscalationService } from "./services/escalations.js";
import type { ApprovalService } from "./services/approvals.js";
import type { ProposalService } from "./services/proposals.js";
import type { AgentRunQueue } from "./workers/agent-runner.js";

const now = new Date("2026-07-02T16:00:00.000Z");
const userId = "12000000-0000-4000-8000-000000000011";
const escalationId = "94000000-0000-4000-8000-000000000101";
const workItemId = "94000000-0000-4000-8000-000000000102";
const projectId = "94000000-0000-4000-8000-000000000103";

function user(partial: Partial<UserAuthRow> = {}): UserAuthRow {
  return {
    id: userId,
    nickname: "escalation-owner",
    cookieToken: "cookie-escalation-owner",
    preferredLocale: "zh-CN",
    availabilityStatus: "free",
    availabilityText: null,
    availabilityUpdatedAt: null,
    mutedNotificationTypes: [],
    avatarWebp: null,
    avatarUpdatedAt: null,
    isAdmin: false,
    deletedAt: null,
    deletedByUserId: null,
    createdAt: now,
    updatedAt: now,
    ...partial
  };
}

class MemoryUsers implements UserRepository {
  constructor(private readonly rows: UserAuthRow[] = [user()]) {}

  async findActiveById(id: string) {
    return this.rows.find((row) => row.id === id && row.deletedAt === null) ?? null;
  }

  async findActiveByCookieToken(cookieToken: string) {
    return this.rows.find((row) => row.cookieToken === cookieToken && row.deletedAt === null) ?? null;
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

function authDeps(runtimeSettings: Settings): AuthDependencies {
  return {
    users: new MemoryUsers(),
    devices: new MemoryDevices(),
    settings: runtimeSettings,
    now: () => now
  };
}

async function cookie(runtimeSettings: Settings) {
  return generateSignedCookie(COOKIE_NAME, "cookie-escalation-owner", runtimeSettings.auth.cookieSecret);
}

function withErrors(app: Hono<AuthEnv>) {
  app.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json({ ok: false, error: { code: "validation_error", message: "invalid payload" } }, 422);
    }
    if (error instanceof EscalationServiceError) {
      return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as 400);
    }
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: httpErrorCodeFor(error), message: error.message } }, error.status);
    }
    throw error;
  });
  return app;
}

function emptyQueue(): AgentRunQueue {
  return {
    async enqueue() { throw new Error("not needed"); },
    async runNext() { return null; },
    async get() { return null; },
    async workdir() { return null; },
    async trace() { return []; },
    async abort() { throw new Error("not needed"); },
    async recoverExpiredClaims() { return []; },
    async recoverUnsettledTaskPlanRuns() { return []; },
    async run() { throw new Error("not needed"); },
    async listActive() { return []; }
  };
}

function emptyApprovalService(): ApprovalService {
  return {
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
  } as unknown as ApprovalService;
}

function escalationCard(): AttentionItem {
  return {
    id: escalationId,
    kind: "escalation",
    priority: "urgent",
    work_item_id: workItemId,
    project_id: projectId,
    source_ref: { entity_type: "escalation_event", entity_id: escalationId },
    title: "《竞品价格调研》卡住了",
    summary_text: "AI 对数据来源不确定。",
    reason_text: "AI 对数据来源不确定。",
    actions: [
      { id: "escalation_retry", label: "让它重试", style: "primary", method: "POST", href: `/api/escalations/${escalationId}/resolve` },
      { id: "escalation_pm_mode", label: "转成我来做", style: "secondary", method: "POST", href: `/api/escalations/${escalationId}/resolve` },
      { id: "escalation_cancel", label: "取消这个子任务", style: "danger", method: "POST", href: `/api/escalations/${escalationId}/resolve` }
    ],
    cuu_state: "worried",
    created_at: now.toISOString()
  };
}

class MemoryEscalations implements EscalationService {
  public resolveCalls: Array<{ id: string; actor: AuthActor; payload: unknown; locale?: WorkHubLocale }> = [];
  public delegateCalls: Array<{ id: string; actor: AuthActor; payload: unknown; locale?: WorkHubLocale }> = [];
  public budgetDecisionCalls: Array<{ id: string; actor: AuthActor; actionId: string; locale?: WorkHubLocale }> = [];
  public listCalls: Array<{ actor: AuthActor; locale: WorkHubLocale }> = [];

  async resolve(id: string, actor: AuthActor, payload: ResolveEscalationRequest, locale?: WorkHubLocale) {
    this.resolveCalls.push({ id, actor, payload, ...(locale ? { locale } : {}) });
    return {
      escalation: { id, work_item_id: workItemId, resolved_at: now.toISOString() },
      work_item_status: "pm_mode" as const,
      attention: { summary_text: "已处理升级。" }
    };
  }

  async delegate(id: string, actor: AuthActor, payload: DelegateEscalationRequest, locale?: WorkHubLocale) {
    this.delegateCalls.push({ id, actor, payload, ...(locale ? { locale } : {}) });
    return {
      escalation: { id, work_item_id: workItemId, suggested_lead_user_id: payload.to_user_id ?? null },
      attention: { summary_text: "已转派给负责人处理。" }
    };
  }

  async resolveBudgetDecision(id: string, actor: AuthActor, actionId: string, locale?: WorkHubLocale) {
    this.budgetDecisionCalls.push({ id, actor, actionId, ...(locale ? { locale } : {}) });
    return {
      escalation: { id, work_item_id: workItemId, resolved_at: now.toISOString() },
      work_item_status: "ai_working" as const,
      attention: { summary_text: "已记录预算选择。" }
    };
  }

  async listAttentionItems(input: { actor: AuthActor; locale: WorkHubLocale }) {
    this.listCalls.push(input);
    return [escalationCard()];
  }

  async listAttentionPage(input: { actor: AuthActor; locale: WorkHubLocale }) {
    const items = await this.listAttentionItems(input);
    return {
      items,
      page_info: {
        limit: 50,
        returned: items.length,
        has_more: false
      }
    };
  }
}

test("R9.0 escalation routes parse resolve and delegate actions under auth", async () => {
  const runtimeSettings = settings();
  const service = new MemoryEscalations();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/escalations", createEscalationRoutes({ auth: authDeps(runtimeSettings), service }));

  const bad = await app.request("/api/escalations/not-a-uuid/resolve", {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) },
    body: JSON.stringify({ action: "pm_mode" })
  });
  assert.equal(bad.status, 404);
  assert.equal(service.resolveCalls.length, 0);

  const resolved = await app.request(`/api/escalations/${escalationId}/resolve`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Accept-Language": "en-US" },
    body: JSON.stringify({ action: "pm_mode", reason_md: "我来接手。" })
  });
  assert.equal(resolved.status, 200);
  assert.equal(service.resolveCalls[0]?.id, escalationId);
  assert.equal(service.resolveCalls[0]?.actor.userId, userId);
  assert.equal(service.resolveCalls[0]?.locale, "en-US");
  assert.deepEqual(service.resolveCalls[0]?.payload, { action: "pm_mode", reason_md: "我来接手。" });

  const targetUserId = "12000000-0000-4000-8000-000000000012";
  const delegated = await app.request(`/api/escalations/${escalationId}/delegate`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Accept-Language": "en-US" },
    body: JSON.stringify({ to_user_id: targetUserId, reason_md: "请同事接手来源核验。" })
  });
  assert.equal(delegated.status, 200);
  assert.equal(service.delegateCalls[0]?.id, escalationId);
  assert.equal(service.delegateCalls[0]?.locale, "en-US");
  assert.deepEqual(service.delegateCalls[0]?.payload, {
    to_user_id: targetUserId,
    reason_md: "请同事接手来源核验。"
  });

  const budgetDecision = await app.request(`/api/escalations/${escalationId}/budget-actions/add_budget?locale=en-US`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  assert.equal(budgetDecision.status, 200);
  assert.equal(service.budgetDecisionCalls[0]?.id, escalationId);
  assert.equal(service.budgetDecisionCalls[0]?.actor.userId, userId);
  assert.equal(service.budgetDecisionCalls[0]?.actionId, "add_budget");
  assert.equal(service.budgetDecisionCalls[0]?.locale, "en-US");
});

test("R9.0 attention home includes unresolved escalation cards before lower-priority decisions", async () => {
  const runtimeSettings = settings();
  const service = new MemoryEscalations();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/pages", createPageRoutes({
    auth: authDeps(runtimeSettings),
    queue: emptyQueue(),
    approvals: emptyApprovalService(),
    proposals: { async listReviewableForUser() { return []; } } as unknown as ProposalService,
    escalations: service
  }));

  const response = await app.request("/api/pages/attention?locale=zh-CN", {
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(response.status, 200);
  const body = await response.json() as { data: { primary?: AttentionItem; queue: AttentionItem[] } };
  assert.equal(body.data.primary?.kind, "escalation");
  assert.equal(body.data.primary?.source_ref.entity_type, "escalation_event");
  assert.deepEqual(body.data.primary?.actions.map((action) => action.label), [
    "让它重试",
    "转成我来做",
    "取消这个子任务"
  ]);
  assert.equal(service.listCalls[0]?.actor.userId, userId);
  assert.equal(service.listCalls[0]?.locale, "zh-CN");
});
