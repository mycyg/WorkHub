import assert from "node:assert/strict";
import test from "node:test";

import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { loadSettings, type Settings } from "@workhub/config";
import type {
  ClientDeviceAuthRow,
  ClientDeviceRepository,
  UserAuthRow,
  UserRepository
} from "@workhub/db";

import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "./middleware/auth.js";
import { createAgentRunRoutes } from "./routes/agent-runs.js";
import {
  AgentRunnerError,
  createInMemoryAgentRunQueue
} from "./workers/agent-runner.js";

const now = new Date("2026-06-05T00:00:00.000Z");
const userId = "10000000-0000-4000-8000-000000000021";
const workItemId = "50000000-0000-4000-8000-000000000021";

function user(): UserAuthRow {
  return {
    id: userId,
    nickname: "agent-run-user",
    cookieToken: "cookie-agent-run",
    availabilityStatus: "free",
    availabilityText: null,
    availabilityUpdatedAt: null,
    isAdmin: false,
    deletedAt: null,
    createdAt: now,
    updatedAt: now
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

function withErrors<T extends { Variables: Record<string, unknown> }>(app: Hono<T>) {
  app.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json({ ok: false, error: { code: "validation_error", message: "invalid payload" } }, 422);
    }
    if (error instanceof AgentRunnerError) {
      return c.json(
        {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            ...(error.details ? { details: error.details } : {})
          }
        },
        error.status as 400
      );
    }
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: "http_error", message: error.message } }, error.status);
    }
    throw error;
  });
  return app;
}

async function cookie(runtimeSettings: Settings) {
  return generateSignedCookie(COOKIE_NAME, "cookie-agent-run", runtimeSettings.auth.cookieSecret);
}

test("agent run enqueue consumes P-COST decisions before creating a run", async () => {
  const runtimeSettings = settings();
  const queue = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => now,
    id: () => "40000000-0000-4000-8000-000000000021",
    usage: () => [
      {
        policyId: "pcost-user-day-v0",
        scope: { kind: "user", userId },
        tokenIn: 475000,
        tokenOut: 0,
        estimatedCostCny: "1"
      }
    ]
  });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createAgentRunRoutes({ auth: authDeps(runtimeSettings), queue }));

  const response = await app.request(`/api/workitems/${workItemId}/agent-runs`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) },
    body: JSON.stringify({ title: "Weekly report" })
  });

  assert.equal(response.status, 202);
  const body = await response.json() as {
    ok: true;
    data: {
      budget: { max_tokens: number; max_cost_cny: string };
      budget_decision: { reason?: string; model_route: { reason: string }; notice?: { recommended_action: string } };
    };
  };
  assert.equal(body.data.budget.max_tokens, 25000);
  assert.equal(body.data.budget.max_cost_cny, "5");
  assert.equal(body.data.budget_decision.reason, "critical");
  assert.equal(body.data.budget_decision.model_route.reason, "near_budget_downgrade");
  assert.equal(body.data.budget_decision.notice?.recommended_action, "downgrade_model");
});

test("agent run enqueue returns budget_exhausted before queueing new work", async () => {
  const runtimeSettings = settings();
  const queue = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => now,
    id: () => "40000000-0000-4000-8000-000000000022",
    usage: () => [
      {
        policyId: "pcost-user-day-v0",
        scope: { kind: "user", userId },
        tokenIn: 500000,
        tokenOut: 1,
        estimatedCostCny: "20"
      }
    ]
  });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createAgentRunRoutes({ auth: authDeps(runtimeSettings), queue }));

  const response = await app.request(`/api/workitems/${workItemId}/agent-runs`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) },
    body: JSON.stringify({ title: "Weekly report" })
  });

  assert.equal(response.status, 402);
  const body = await response.json() as {
    ok: false;
    error: {
      code: string;
      details?: {
        policy_id?: string;
        remaining_tokens?: number;
        remaining_cost_cny?: string;
        recommended_action?: string;
      };
    };
  };
  assert.equal(body.error.code, "budget_exhausted");
  assert.equal(body.error.details?.policy_id, "pcost-user-day-v0");
  assert.equal(body.error.details?.remaining_tokens, 0);
  assert.equal(body.error.details?.remaining_cost_cny, "0");
  assert.equal(body.error.details?.recommended_action, "ask_admin");
  assert.equal((await queue.listActive()).length, 0);
});
