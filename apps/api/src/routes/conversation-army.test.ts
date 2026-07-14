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
import type { ArmyOverviewPageVM, ArmyRunCardVM, ConversationArmyPanelVM } from "@workhub/contracts";

import { httpErrorCodeFor } from "../http-error-codes.js";
import {
  COOKIE_NAME,
  type AuthDependencies,
  type AuthEnv
} from "../middleware/auth.js";
import { InternalContractError } from "../pages/output-contract.js";
import { createConversationArmyRoutes } from "./conversation-army.js";
import {
  ConversationArmyServiceError,
  type ConversationArmyService
} from "../services/conversation-army.js";

const now = new Date("2026-07-12T09:00:00.000Z");
const conversationId = "31000000-0000-4000-8000-000000000001";
const projectId = "31000000-0000-4000-8000-000000000002";
const runId = "31000000-0000-4000-8000-000000000003";
const workItemId = "31000000-0000-4000-8000-000000000004";
const proposalId = "31000000-0000-4000-8000-000000000005";
const userId = "31000000-0000-4000-8000-000000000006";

function settings(): Settings {
  return loadSettings({ APP_ENV: "test", COOKIE_SECRET: "r12-batch5-army-route-secret" });
}

function user(): UserAuthRow {
  return {
    id: userId,
    nickname: "r12-army-owner",
    cookieToken: "cookie-r12-army-owner",
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
    updatedAt: now
  };
}

class MemoryUsers implements UserRepository {
  async findActiveById(id: string) {
    return id === userId ? user() : null;
  }
  async findActiveByCookieToken(token: string) {
    return token === "cookie-r12-army-owner" ? user() : null;
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

function authDeps(runtimeSettings: Settings): AuthDependencies {
  return {
    users: new MemoryUsers(),
    devices: new MemoryDevices(),
    settings: runtimeSettings,
    now: () => now
  };
}

async function cookie(runtimeSettings: Settings) {
  return generateSignedCookie(COOKIE_NAME, "cookie-r12-army-owner", runtimeSettings.auth.cookieSecret);
}

function runCardVm(): ArmyRunCardVM {
  return {
    id: runId,
    status: "running",
    goal_summary: "把第三节重写一遍",
    assignee_user_id: userId,
    cost_cny: "0.032000",
    execution_hint: "server",
    work_item_id: workItemId,
    source_conversation_id: conversationId,
    source_action_card_item_id: null,
    cat_codename: "阿墨",
    recent_step: null,
    created_at: now.toISOString(),
    updated_at: now.toISOString()
  };
}

function armyPanelVm(): ConversationArmyPanelVM {
  return {
    generated_at: now.toISOString(),
    conversation_id: conversationId,
    project_id: projectId,
    runs: { runs: [runCardVm()], capped: false, next_cursor: null },
    outputs: {
      items: [{
        proposal_id: proposalId,
        work_item_id: workItemId,
        run_id: runId,
        title: "重写第三节",
        status: "opened",
        proposal_href: `/proposals/${proposalId}`,
        updated_at: now.toISOString()
      }],
      capped: false
    },
    background_tasks: { items: [], empty_state: "not_yet_available" }
  };
}

function armyOverviewVm(): ArmyOverviewPageVM {
  return {
    generated_at: now.toISOString(),
    viewer_user_id: userId,
    runs: {
      runs: [{ ...runCardVm(), project_id: projectId, project_name: "星尘短剧" }],
      capped: false,
      next_cursor: null
    }
  };
}

function service(overrides: Partial<ConversationArmyService> = {}): ConversationArmyService {
  return {
    async conversationArmyPanel() {
      return armyPanelVm();
    },
    async armyOverview() {
      return armyOverviewVm();
    },
    ...overrides
  };
}

function withErrors(app: Hono<AuthEnv>) {
  app.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json({ ok: false, error: { code: "validation_error", message: "invalid payload" } }, 422);
    }
    if (error instanceof ConversationArmyServiceError) {
      return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status);
    }
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: httpErrorCodeFor(error), message: error.message } }, error.status);
    }
    if (error instanceof InternalContractError) {
      return c.json({ ok: false, error: { code: "internal_contract_error", message: "internal" } }, 500);
    }
    return c.json({ ok: false, error: { code: "internal_error", message: "internal" } }, 500);
  });
  return app;
}

function routeApp(runtimeSettings: Settings, conversations: ConversationArmyService) {
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createConversationArmyRoutes({ auth: authDeps(runtimeSettings), conversations }));
  return app;
}

test("conversation army routes require authentication before reaching the service", async () => {
  const runtimeSettings = settings();
  const app = routeApp(runtimeSettings, service({
    async conversationArmyPanel() {
      throw new Error("anonymous request must not reach the service");
    },
    async armyOverview() {
      throw new Error("anonymous request must not reach the service");
    }
  }));

  for (const path of [`/api/conversations/${conversationId}/army`, "/api/me/army"]) {
    const response = await app.request(path);
    assert.equal(response.status, 401);
  }
});

test("an invalid conversation id 404s in the same uniform shape without entering the service", async () => {
  const runtimeSettings = settings();
  let calls = 0;
  const app = routeApp(runtimeSettings, service({
    async conversationArmyPanel() {
      calls += 1;
      throw new Error("invalid UUID must not reach the service");
    }
  }));
  const headers = { Cookie: await cookie(runtimeSettings) };

  const response = await app.request("/api/conversations/not-a-uuid/army", { headers });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: "conversation_army_not_found", message: "没有找到这个会话的军团面板。" }
  });
  assert.equal(calls, 0);
});

test("conversation army panel route parses query params and forwards them to the service", async () => {
  const runtimeSettings = settings();
  const seen: unknown[] = [];
  const app = routeApp(runtimeSettings, service({
    async conversationArmyPanel(input) {
      seen.push(input);
      return armyPanelVm();
    }
  }));
  const headers = { Cookie: await cookie(runtimeSettings) };
  const afterCreatedAt = "2026-07-12T08:30:00.123456Z";

  const response = await app.request(
    `/api/conversations/${conversationId}/army?afterCreatedAt=${afterCreatedAt}&afterId=${runId}&limit=10`,
    { headers }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, data: armyPanelVm() });
  assert.equal(seen.length, 1);
  const call = seen[0] as { conversationId: string; query: unknown };
  assert.equal(call.conversationId, conversationId);
  assert.deepEqual(call.query, { afterCreatedAt, afterId: runId, limit: 10 });
});

test("army overview route defaults limit to 20 and returns the service VM verbatim", async () => {
  const runtimeSettings = settings();
  const seen: unknown[] = [];
  const app = routeApp(runtimeSettings, service({
    async armyOverview(input) {
      seen.push(input);
      return armyOverviewVm();
    }
  }));
  const headers = { Cookie: await cookie(runtimeSettings) };

  const response = await app.request("/api/me/army", { headers });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, data: armyOverviewVm() });
  assert.equal(seen.length, 1);
  const call = seen[0] as { query: unknown };
  assert.deepEqual(call.query, { limit: 20 });
});

test("army routes reject an out-of-range limit with a 422 validation envelope before the service runs", async () => {
  const runtimeSettings = settings();
  let calls = 0;
  const app = routeApp(runtimeSettings, service({
    async conversationArmyPanel() {
      calls += 1;
      return armyPanelVm();
    },
    async armyOverview() {
      calls += 1;
      return armyOverviewVm();
    }
  }));
  const headers = { Cookie: await cookie(runtimeSettings) };

  const panelResponse = await app.request(`/api/conversations/${conversationId}/army?limit=51`, { headers });
  const overviewResponse = await app.request("/api/me/army?limit=0", { headers });

  assert.equal(panelResponse.status, 422);
  assert.equal(overviewResponse.status, 422);
  assert.equal(calls, 0);
});

test("army routes reject a half cursor (only one of afterCreatedAt/afterId) with a 422", async () => {
  const runtimeSettings = settings();
  const app = routeApp(runtimeSettings, service());
  const headers = { Cookie: await cookie(runtimeSettings) };

  const response = await app.request(
    `/api/conversations/${conversationId}/army?afterCreatedAt=2026-07-12T08:30:00.123456Z`,
    { headers }
  );

  assert.equal(response.status, 422);
});

test("conversation army routes preserve the service's typed 404", async () => {
  const runtimeSettings = settings();
  const app = routeApp(runtimeSettings, service({
    async conversationArmyPanel() {
      throw new ConversationArmyServiceError(404, "conversation_army_not_found", "没有找到这个会话的军团面板。");
    }
  }));
  const headers = { Cookie: await cookie(runtimeSettings) };

  const response = await app.request(`/api/conversations/${conversationId}/army`, { headers });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: "conversation_army_not_found", message: "没有找到这个会话的军团面板。" }
  });
});

test("conversation army routes return an internal 500 envelope for output-contract drift", async () => {
  const runtimeSettings = settings();
  const app = routeApp(runtimeSettings, service({
    async armyOverview() {
      throw new InternalContractError("conversation-army.overview", new ZodError([]));
    }
  }));

  const response = await app.request("/api/me/army", { headers: { Cookie: await cookie(runtimeSettings) } });

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: "internal_contract_error", message: "internal" }
  });
});
