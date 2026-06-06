import assert from "node:assert/strict";
import test from "node:test";

import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { p05GoldPathIds } from "@workhub/agent/fixtures";
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
import { createProposalRoutes } from "./routes/proposals.js";
import { createSessionRoutes } from "./routes/sessions.js";
import { createWorkItemRoutes } from "./routes/workitems.js";
import { createCostRoutes } from "./routes/cost.js";
import type { AgentRunQueue, AgentRunQueueRecord } from "./workers/agent-runner.js";

const now = new Date("2026-06-05T00:00:00.000Z");
const userId = "10000000-0000-4000-8000-000000000010";

function user(partial: Partial<UserAuthRow> = {}): UserAuthRow {
  return {
    id: userId,
    nickname: "gold-path-user",
    cookieToken: "cookie-gold-path",
    availabilityStatus: "free",
    availabilityText: null,
    availabilityUpdatedAt: null,
    isAdmin: false,
    deletedAt: null,
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

function authDeps(runtimeSettings: Settings): AuthDependencies {
  return {
    users: new MemoryUsers([user()]),
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

test("P0.5 route set returns option question, evidence bubble, proposal detail, work item detail, and replay", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  const auth = authDeps(runtimeSettings);
  app.route("/api", createSessionRoutes({ auth }));
  app.route("/api", createWorkItemRoutes({ auth }));
  app.route("/api/knowledge", createKnowledgeRoutes({ auth }));
  app.route("/api/pages", createPageRoutes({ auth, queue: emptyQueue() }));
  app.route("/api", createAgentRunRoutes({ auth, queue: emptyQueue() }));
  app.route("/api/proposals", createProposalRoutes({ auth, allowUnauthenticatedGoldPath: false }));
  app.route("/api/cost", createCostRoutes({ auth }));
  const headers = { Cookie: await cookie(runtimeSettings) };

  const session = await app.request("/api/sessions", {
    method: "POST",
    headers,
    body: JSON.stringify({ intent_text: "帮我整理客户周报模板。" })
  });
  const question = await app.request(`/api/sessions/${p05GoldPathIds.session}/next-question`, {
    method: "POST",
    headers
  });
  const createdWorkItem = await app.request("/api/workitems", {
    method: "POST",
    headers,
    body: JSON.stringify({
      session_id: p05GoldPathIds.session,
      selected_option_ids: ["risk-first"]
    })
  });
  const evidence = await app.request("/api/knowledge/search", { method: "POST", headers });
  const proposal = await app.request(`/api/pages/proposals/${p05GoldPathIds.proposal}`, { headers });
  const workitem = await app.request(`/api/pages/workitems/${p05GoldPathIds.workItem}`, { headers });
  const replay = await app.request(`/api/agent-runs/${p05GoldPathIds.run}/replay`, { headers });
  const costUsage = await app.request("/api/cost/usage", { headers });

  assert.equal(session.status, 200);
  assert.equal(question.status, 200);
  assert.equal(createdWorkItem.status, 201);
  assert.equal(evidence.status, 200);
  assert.equal(proposal.status, 200);
  assert.equal(workitem.status, 200);
  assert.equal(replay.status, 200);
  assert.equal(costUsage.status, 200);

  const sessionBody = await session.json() as {
    data: {
      session_id: string;
      topic: string;
      stream_href: string;
      next_question_href: string;
      question: { free_text: { collapsed_by_default: boolean } };
    };
  };
  const questionBody = await question.json() as { data: { free_text: { collapsed_by_default: boolean } } };
  const createdWorkItemBody = await createdWorkItem.json() as {
    data: { workitem: { id: string; status: string; summary_md?: string }; latest_proposal?: unknown; agent_trace_preview: unknown[] };
  };
  const evidenceBody = await evidence.json() as { data: { evidence_refs: unknown[] } };
  const proposalBody = await proposal.json() as {
    data: { review_actions: { request_changes: { requires_reason?: boolean } } };
  };
  const workItemBody = await workitem.json() as { data: { latest_proposal?: unknown } };
  const replayBody = await replay.json() as {
    ok: true;
    data: { cost?: { active_notices: { usage_ratio: number; options?: unknown[] }[] } };
  };
  const costUsageBody = await costUsage.json() as {
    ok: true;
    data: { me: { max_tokens: number }; scopes: unknown[]; active_notices: unknown[]; generated_at: string };
  };

  assert.equal(sessionBody.data.session_id, p05GoldPathIds.session);
  assert.equal(sessionBody.data.topic, `session:${p05GoldPathIds.session}`);
  assert.equal(sessionBody.data.stream_href, `/api/push/stream/session/${p05GoldPathIds.session}`);
  assert.equal(sessionBody.data.next_question_href, `/api/sessions/${p05GoldPathIds.session}/next-question`);
  assert.equal(sessionBody.data.question.free_text.collapsed_by_default, true);
  assert.equal(questionBody.data.free_text.collapsed_by_default, true);
  assert.equal(createdWorkItemBody.data.workitem.id, p05GoldPathIds.workItem);
  assert.equal(createdWorkItemBody.data.workitem.status, "ai_working");
  assert.equal(createdWorkItemBody.data.latest_proposal, undefined);
  assert.equal(createdWorkItemBody.data.agent_trace_preview.length >= 1, true);
  assert.equal(createdWorkItemBody.data.workitem.summary_md?.includes("已选择：风险优先"), true);
  assert.equal(evidenceBody.data.evidence_refs.length, 3);
  assert.equal(proposalBody.data.review_actions.request_changes.requires_reason, true);
  assert.equal(workItemBody.data.latest_proposal !== undefined, true);
  assert.equal((replayBody.data.cost?.active_notices[0]?.usage_ratio ?? 0) >= 0.8, true);
  assert.equal((replayBody.data.cost?.active_notices[0]?.options?.length ?? 0) >= 2, true);
  assert.equal(costUsageBody.data.me.max_tokens, 500000);
  assert.equal(costUsageBody.data.scopes.length >= 2, true);
  assert.equal(typeof costUsageBody.data.generated_at, "string");
});

test("P0.5 proposal review requires a reason on request changes and feeds it back to the next Agent context", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  const auth = authDeps(runtimeSettings);
  app.route("/api/proposals", createProposalRoutes({ auth, allowUnauthenticatedGoldPath: false }));
  const headers = { Cookie: await cookie(runtimeSettings) };

  const missingReason = await app.request(`/api/proposals/${p05GoldPathIds.proposal}/review`, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "request_changes" })
  });
  assert.equal(missingReason.status, 422);

  const response = await app.request(`/api/proposals/${p05GoldPathIds.proposal}/review`, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "request_changes", reason_md: "证据不足，请补充客户风险列表。" })
  });

  assert.equal(response.status, 200);
  const body = await response.json() as {
    ok: true;
    data: {
      status: string;
      decision: string;
      next_agent_context?: { correction: string; reason_fed_back: boolean };
      event: { type: string; attention?: { cuu_state?: string } };
      feedback_event?: { type: string; cuu_state?: string; data: { reason_fed_back?: boolean } };
      audit_logs?: { action: string; detail_json: { reason_fed_back?: boolean } }[];
    };
  };
  assert.equal(body.data.status, "revision_requested");
  assert.equal(body.data.decision, "request_changes");
  assert.equal(body.data.next_agent_context?.correction, "证据不足，请补充客户风险列表。");
  assert.equal(body.data.next_agent_context?.reason_fed_back, true);
  assert.equal(body.data.event.type, "proposal.reviewed");
  assert.equal(body.data.event.attention?.cuu_state, "revision_requested");
  assert.equal(body.data.feedback_event?.type, "revision.fedback");
  assert.equal(body.data.feedback_event?.cuu_state, "revision_requested");
  assert.equal(body.data.feedback_event?.data.reason_fed_back, true);
  assert.equal(body.data.audit_logs?.some((log) => log.action === "reason_fed_back"), true);
  assert.equal(body.data.audit_logs?.[0]?.detail_json.reason_fed_back, true);
});

test("P0.5 proposal approve and merge expose merged event, notification, audit facts, and rollback entry", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  const auth = authDeps(runtimeSettings);
  app.route("/api/proposals", createProposalRoutes({ auth, allowUnauthenticatedGoldPath: false }));
  const headers = { Cookie: await cookie(runtimeSettings) };

  const review = await app.request(`/api/proposals/${p05GoldPathIds.proposal}/review`, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "approve" })
  });
  assert.equal(review.status, 200);
  const reviewBody = await review.json() as { ok: true; data: { next_action?: { href: string } } };
  assert.equal(reviewBody.data.next_action?.href, `/api/proposals/${p05GoldPathIds.proposal}/merge`);

  const merge = await app.request(`/api/proposals/${p05GoldPathIds.proposal}/merge`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });

  assert.equal(merge.status, 200);
  const mergeBody = await merge.json() as {
    ok: true;
    data: {
      status: string;
      merge_snapshot_id: string;
      rollback_available: boolean;
      rollback: { available: boolean };
      events: { type: string }[];
      audit_logs: { action: string; snapshot_id?: string }[];
      attention: { cuu_state?: string };
    };
  };
  assert.equal(mergeBody.data.status, "merged");
  assert.equal(mergeBody.data.merge_snapshot_id, p05GoldPathIds.mergeSnapshot);
  assert.equal(mergeBody.data.rollback_available, true);
  assert.equal(mergeBody.data.rollback.available, true);
  assert.equal(mergeBody.data.events.some((event) => event.type === "proposal.merged"), true);
  assert.equal(mergeBody.data.events.some((event) => event.type === "notification.created"), true);
  assert.equal(mergeBody.data.audit_logs.some((log) => log.action === "proposal.merged" && log.snapshot_id === p05GoldPathIds.mergeSnapshot), true);
  assert.equal(mergeBody.data.attention.cuu_state, "celebrating");
});
