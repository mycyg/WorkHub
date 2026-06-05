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
import { createSessionRoutes } from "./routes/sessions.js";
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
    async trace() {
      return [];
    },
    async abort(): Promise<AgentRunQueueRecord> {
      throw new Error("not needed");
    },
    async listActive() {
      return [];
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
      page_vms: { question: { options: unknown[] }; replay: { steps: unknown[] } };
      cuu_states: string[];
    };
  };
  assert.equal(body.data.fixture_id, "weekly_report_manifest_doc");
  assert.equal(body.data.page_vms.question.options.length >= 2, true);
  assert.equal(body.data.page_vms.replay.steps.length >= 5, true);
  assert.equal(body.data.cuu_states.includes("carrying_document"), true);
  assert.equal(body.data.cuu_states.includes("celebrating"), true);
});

test("P0.5 route set returns option question, evidence bubble, proposal detail, work item detail, and replay", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  const auth = authDeps(runtimeSettings);
  app.route("/api", createSessionRoutes({ auth }));
  app.route("/api/knowledge", createKnowledgeRoutes({ auth }));
  app.route("/api/pages", createPageRoutes({ auth, queue: emptyQueue() }));
  app.route("/api", createAgentRunRoutes({ auth, queue: emptyQueue() }));
  const headers = { Cookie: await cookie(runtimeSettings) };

  const question = await app.request(`/api/sessions/${p05GoldPathIds.session}/next-question`, {
    method: "POST",
    headers
  });
  const evidence = await app.request("/api/knowledge/search", { method: "POST", headers });
  const proposal = await app.request(`/api/pages/proposals/${p05GoldPathIds.proposal}`, { headers });
  const workitem = await app.request(`/api/pages/workitems/${p05GoldPathIds.workItem}`, { headers });
  const replay = await app.request(`/api/agent-runs/${p05GoldPathIds.run}/replay`, { headers });

  assert.equal(question.status, 200);
  assert.equal(evidence.status, 200);
  assert.equal(proposal.status, 200);
  assert.equal(workitem.status, 200);
  assert.equal(replay.status, 200);

  const questionBody = await question.json() as { data: { free_text: { collapsed_by_default: boolean } } };
  const evidenceBody = await evidence.json() as { data: { evidence_refs: unknown[] } };
  const proposalBody = await proposal.json() as {
    data: { review_actions: { request_changes: { requires_reason?: boolean } } };
  };
  const workItemBody = await workitem.json() as { data: { latest_proposal?: unknown } };
  const replayBody = await replay.json() as { ok: true; data: { cost?: { me: { warning_ratio: number } } } };

  assert.equal(questionBody.data.free_text.collapsed_by_default, true);
  assert.equal(evidenceBody.data.evidence_refs.length, 3);
  assert.equal(proposalBody.data.review_actions.request_changes.requires_reason, true);
  assert.equal(workItemBody.data.latest_proposal !== undefined, true);
  assert.equal((replayBody.data.cost?.me.warning_ratio ?? 0) >= 0.8, true);
});
