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
import { createInMemoryWorkItemService } from "./services/work-items.js";
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

test("attention home degrades to an empty decision queue when the approvals lookup fails", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/pages", createPageRoutes({
    auth: authDeps(runtimeSettings),
    queue: emptyQueue(),
    approvals: { async listPendingForUser() { throw new Error("db down"); } } as unknown as ApprovalService
  }));

  const response = await app.request("/api/pages/attention", {
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(response.status, 200);
  const body = await response.json() as { data: { queue: unknown[]; primary?: unknown } };
  assert.equal(body.data.queue.length, 0);
  assert.equal(body.data.primary, undefined);
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
  const sessionBody = await session.json() as { data: { session_id: string; work_item_id: string } };
  const question = await app.request(`/api/sessions/${sessionBody.data.session_id}/next-question`, {
    method: "POST",
    headers,
    body: JSON.stringify({ selected_option_ids: ["document-draft"] })
  });
  const createdWorkItem = await app.request("/api/workitems", {
    method: "POST",
    headers,
    body: JSON.stringify({
      session_id: sessionBody.data.session_id,
      selected_option_ids: ["document-draft"]
    })
  });
  assert.equal(question.status, 200);
  assert.equal(createdWorkItem.status, 201);
  const createdWorkItemBody = await createdWorkItem.json() as {
    data: { workitem: { id: string; status: string } };
  };
  assert.equal(createdWorkItemBody.data.workitem.status, "spec_ready");
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
