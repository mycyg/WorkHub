import assert from "node:assert/strict";
import test from "node:test";

import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { p05GoldPathIds, createP05GoldPathFixture } from "@workhub/agent/fixtures";
import { loadSettings, type Settings } from "@workhub/config";
import type {
  ClientDeviceAuthRow,
  ClientDeviceRepository,
  UserAuthRow,
  UserRepository
} from "@workhub/db";

import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "./middleware/auth.js";
import { createAgentRunRoutes } from "./routes/agent-runs.js";
import { createKnowledgeRoutes } from "./routes/knowledge.js";
import { createPageRoutes } from "./routes/pages.js";
import type { ApprovalService } from "./services/approvals.js";
import { createProposalRoutes } from "./routes/proposals.js";
import { createSessionRoutes } from "./routes/sessions.js";
import { createWorkItemRoutes } from "./routes/workitems.js";
import { createInMemoryProposalService } from "./services/proposals.js";
import {
  createInMemoryWorkItemService,
  parseClarificationDraftFromLlmText,
  WorkItemServiceError
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
    async run(): Promise<AgentRunQueueRecord> {
      throw new Error("not needed");
    },
    async runNext() {
      return null;
    }
  };
}

function withErrors<T extends { Variables: Record<string, unknown> }>(app: Hono<T>) {
  app.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json({ ok: false, error: { code: "validation_error", message: "invalid payload" } }, 422);
    }
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: "http_error", message: error.message } }, error.status);
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

test("attention home decision queue is fed by the user's pending approvals", async () => {
  const runtimeSettings = settings();
  const fixture = createP05GoldPathFixture();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/pages", createPageRoutes({
    auth: authDeps(runtimeSettings),
    queue: emptyQueue(),
    // 决策队列必须接真实的"用户待决策审批"源；这里用 gold-path 审批中心做替身。
    approvals: { async listPendingForUser() { return fixture.approvalCenter; } } as unknown as ApprovalService,
    // 决策队列现在按可读工作项收口（findings）；注入放行所有工作项的 workItems，让 fixture 审批项保持可见。
    workItems: { async detailPage() { return {}; } } as never
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

test("attention home marks the decision queue as partial when the approvals lookup fails", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/pages", createPageRoutes({
    auth: authDeps(runtimeSettings),
    queue: emptyQueue(),
    approvals: { async listPendingForUser() { throw new Error("db down"); } } as unknown as ApprovalService,
    proposals: { async listReviewableForUser() { return []; } } as never
  }));

  const response = await app.request("/api/pages/attention", {
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(response.status, 200);
  const body = await response.json() as { data: { queue: unknown[]; primary?: unknown; source_warnings: { source: string; message: string }[] } };
  assert.equal(body.data.queue.length, 0);
  assert.equal(body.data.primary, undefined);
  assert.deepEqual(body.data.source_warnings.map((warning) => warning.source), ["approvals"]);
  assert.match(body.data.source_warnings[0]?.message ?? "", /审批待办/u);
});

test("settings page carries server locale preference sync state without secrets", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/pages", createPageRoutes({
    auth: authDeps(runtimeSettings, [user({ preferredLocale: "en-US" })]),
    queue: emptyQueue()
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
      llm_runtime: { secret_safe: boolean };
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
  assert.equal(body.data.llm_runtime.secret_safe, true);
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
