import assert from "node:assert/strict";
import test from "node:test";

import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { loadSettings, type Settings } from "@workhub/config";
import { userAiProfileVmSchema } from "@workhub/contracts";
import type {
  ClientDeviceAuthRow,
  ClientDeviceRepository,
  UserAuthRow,
  UserRepository
} from "@workhub/db";

import { httpErrorCodeFor } from "./http-error-codes.js";
import {
  COOKIE_NAME,
  type AuthDependencies,
  type AuthEnv
} from "./middleware/auth.js";
import {
  InternalContractError,
  parseOutputContract
} from "./pages/output-contract.js";
import {
  jsonObjectMessage,
  malformedJsonMessage
} from "./routes/json-body.js";
import {
  AiSettingsServiceError,
  type AiSettingsService
} from "./services/ai-settings.js";

const now = new Date("2026-07-12T10:00:00.000Z");
const projectId = "14000000-0000-4000-8000-000000000004";
const userId = "14000000-0000-4000-8000-000000000003";
const workspaceId = "14000000-0000-4000-8000-000000000001";

function settings(): Settings {
  return loadSettings({ APP_ENV: "test", COOKIE_SECRET: "r12-ai-settings-route-secret" });
}

function user(): UserAuthRow {
  return {
    id: userId,
    nickname: "r12-owner",
    cookieToken: "cookie-r12-owner",
    preferredLocale: "zh-CN",
    availabilityStatus: "free",
    availabilityText: null,
    availabilityUpdatedAt: null,
    mutedNotificationTypes: [],
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
    return token === "cookie-r12-owner" ? user() : null;
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
  return generateSignedCookie(COOKIE_NAME, "cookie-r12-owner", runtimeSettings.auth.cookieSecret);
}

function profileVm() {
  return {
    workspace_id: workspaceId,
    user_id: userId,
    default_mode: 3 as const,
    granular_settings: {},
    dispatch_policy: "auto" as const,
    cuu_proactivity: "balanced" as const,
    model_tier_preference: null,
    providers: [{
      name: "deepseek",
      configured: true,
      default_model_id: "default",
      models: [{
        id: "default",
        model: "deepseek-v4-pro",
        display_name: "deepseek-v4-pro",
        context_window_tokens: 128000,
        supports_streaming: true,
        supports_tools: true,
        cost_input_cny_per_mtok: 2,
        cost_output_cny_per_mtok: 8
      }]
    }],
    budget_summary: {
      daily_quota: {
        policy_id: "pcost-user-day-v0",
        period: "day" as const,
        max_tokens: 500000,
        max_cost_cny: "20",
        enabled: true
      },
      usage: {
        day: { period: "day" as const, token_in: 0, token_out: 0, total_tokens: 0, estimated_cost_cny: "0" },
        month: { period: "month" as const, token_in: 0, token_out: 0, total_tokens: 0, estimated_cost_cny: "0" }
      }
    },
    generated_at: now.toISOString(),
    updated_at: null
  };
}

function governanceVm() {
  return {
    project_id: projectId,
    observer_enabled: true,
    silence_window_seconds: 60,
    quiet_hours: { enabled: false as const },
    granular_settings: {},
    updated_at: null
  };
}

function service(overrides: Partial<AiSettingsService> = {}): AiSettingsService {
  return {
    async assertUserProfileAccess() {},
    async getUserProfile() {
      return profileVm();
    },
    async patchUserProfile() {
      return profileVm();
    },
    async assertProjectGovernanceAccess() {},
    async getProjectGovernance() {
      return governanceVm();
    },
    async patchProjectGovernance() {
      return governanceVm();
    },
    ...overrides
  };
}

function withErrors(app: Hono<AuthEnv>) {
  app.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json({ ok: false, error: { code: "validation_error", message: "invalid payload" } }, 422);
    }
    if (error instanceof AiSettingsServiceError) {
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

async function routeModule() {
  const module = await import("./routes/ai-settings.js").catch(() => null);
  assert.ok(module, "missing AI settings route module");
  assert.equal(typeof module.createAiSettingsRoutes, "function", "missing createAiSettingsRoutes export");
  return module;
}

async function routeApp(runtimeSettings: Settings, aiSettings: AiSettingsService) {
  const module = await routeModule();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", module.createAiSettingsRoutes({ auth: authDeps(runtimeSettings), aiSettings }));
  return app;
}

test("AI settings PATCH routes authenticate before reading malformed bodies", async () => {
  const runtimeSettings = settings();
  const app = await routeApp(runtimeSettings, service({
    async assertUserProfileAccess() {
      throw new Error("anonymous profile request must not enter service");
    },
    async assertProjectGovernanceAccess() {
      throw new Error("anonymous governance request must not enter service");
    }
  }));

  for (const path of [
    "/api/me/ai-profile",
    `/api/projects/${projectId}/ai-governance`
  ]) {
    const response = await app.request(path, { method: "PATCH", body: "{" });
    assert.equal(response.status, 401);
  }
});

test("AI governance invalid UUIDs return the domain 404 without calling the service", async () => {
  const runtimeSettings = settings();
  let calls = 0;
  const app = await routeApp(runtimeSettings, service({
    async getProjectGovernance() {
      calls += 1;
      throw new Error("invalid UUID must not reach service");
    },
    async assertProjectGovernanceAccess() {
      calls += 1;
      throw new Error("invalid UUID must not reach service");
    }
  }));
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const get = await app.request("/api/projects/not-a-uuid/ai-governance", { headers });
  const patch = await app.request("/api/projects/not-a-uuid/ai-governance", {
    method: "PATCH",
    headers,
    body: "{"
  });

  assert.equal(get.status, 404);
  assert.equal(patch.status, 404);
  assert.deepEqual(await get.json(), {
    ok: false,
    error: { code: "ai_governance_not_found", message: "没有找到可管理的项目 AI 设置。" }
  });
  assert.deepEqual(await patch.json(), {
    ok: false,
    error: { code: "ai_governance_not_found", message: "没有找到可管理的项目 AI 设置。" }
  });
  assert.equal(calls, 0);
});

test("AI settings PATCH access preflights run before body parsing", async () => {
  const runtimeSettings = settings();
  const seen: string[] = [];
  const app = await routeApp(runtimeSettings, service({
    async assertUserProfileAccess() {
      seen.push("profile-access");
      throw new AiSettingsServiceError(403, "ai_profile_access_denied", "profile denied");
    },
    async assertProjectGovernanceAccess() {
      seen.push("governance-access");
      throw new AiSettingsServiceError(404, "ai_governance_not_found", "governance missing");
    },
    async patchUserProfile() {
      seen.push("profile-patch");
      throw new Error("must not patch");
    },
    async patchProjectGovernance() {
      seen.push("governance-patch");
      throw new Error("must not patch");
    }
  }));
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const profile = await app.request("/api/me/ai-profile", { method: "PATCH", headers, body: "{" });
  const governance = await app.request(`/api/projects/${projectId}/ai-governance`, {
    method: "PATCH",
    headers,
    body: "{"
  });

  assert.equal(profile.status, 403);
  assert.equal(governance.status, 404);
  assert.deepEqual(seen, ["profile-access", "governance-access"]);
});

test("AI settings PATCH keeps malformed, non-object, shape, and semantic model errors distinct", async () => {
  const runtimeSettings = settings();
  const app = await routeApp(runtimeSettings, service({
    async patchUserProfile(input) {
      if (input.payload.model_tier_preference === "premium-v2") {
        throw new AiSettingsServiceError(422, "ai_model_preference_unavailable", "model unavailable");
      }
      return profileVm();
    }
  }));
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const malformed = await app.request("/api/me/ai-profile", { method: "PATCH", headers, body: "{" });
  const nonObject = await app.request("/api/me/ai-profile", { method: "PATCH", headers, body: "[]" });
  const invalidShape = await app.request("/api/me/ai-profile", {
    method: "PATCH",
    headers,
    body: JSON.stringify({ defaultMode: 4 })
  });
  const unavailable = await app.request("/api/me/ai-profile", {
    method: "PATCH",
    headers,
    body: JSON.stringify({ model_tier_preference: "premium-v2" })
  });

  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), {
    ok: false,
    error: { code: "malformed_json", message: malformedJsonMessage }
  });
  assert.equal(nonObject.status, 400);
  assert.deepEqual(await nonObject.json(), {
    ok: false,
    error: { code: "json_object_required", message: jsonObjectMessage }
  });
  assert.equal(invalidShape.status, 422);
  assert.equal(unavailable.status, 422);
  assert.deepEqual(await unavailable.json(), {
    ok: false,
    error: { code: "ai_model_preference_unavailable", message: "model unavailable" }
  });
});

test("AI settings expose exactly four successful GET/PATCH service bindings", async () => {
  const runtimeSettings = settings();
  const calls: unknown[] = [];
  const app = await routeApp(runtimeSettings, service({
    async getUserProfile(input) {
      calls.push({ method: "profile-get", input });
      return profileVm();
    },
    async assertUserProfileAccess(input) {
      calls.push({ method: "profile-access", input });
    },
    async patchUserProfile(input) {
      calls.push({ method: "profile-patch", input });
      return profileVm();
    },
    async getProjectGovernance(input) {
      calls.push({ method: "governance-get", input });
      return governanceVm();
    },
    async assertProjectGovernanceAccess(input) {
      calls.push({ method: "governance-access", input });
    },
    async patchProjectGovernance(input) {
      calls.push({ method: "governance-patch", input });
      return governanceVm();
    }
  }));
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const responses = [
    await app.request("/api/me/ai-profile", { headers }),
    await app.request("/api/me/ai-profile", {
      method: "PATCH",
      headers,
      body: JSON.stringify({ default_mode: 4 })
    }),
    await app.request(`/api/projects/${projectId}/ai-governance`, { headers }),
    await app.request(`/api/projects/${projectId}/ai-governance`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ observer_enabled: false })
    })
  ];

  assert.deepEqual(responses.map((response) => response.status), [200, 200, 200, 200]);
  for (const response of responses) {
    assert.equal((await response.json() as { ok?: boolean }).ok, true);
  }
  assert.deepEqual(calls.map((call) => {
    const value = call as { method: string; input: { actor: unknown; [key: string]: unknown } };
    const { actor: _actor, ...input } = value.input;
    return { method: value.method, input };
  }), [
    { method: "profile-get", input: {} },
    { method: "profile-access", input: {} },
    { method: "profile-patch", input: { payload: { default_mode: 4 } } },
    { method: "governance-get", input: { projectId } },
    { method: "governance-access", input: { projectId } },
    { method: "governance-patch", input: { projectId, payload: { observer_enabled: false } } }
  ]);
});

test("AI settings preserve typed service errors and map output drift to internal_contract_error", async () => {
  const runtimeSettings = settings();
  const typedApp = await routeApp(runtimeSettings, service({
    async getUserProfile() {
      throw new AiSettingsServiceError(403, "ai_profile_access_denied", "profile denied");
    }
  }));
  const driftApp = await routeApp(runtimeSettings, service({
    async getUserProfile() {
      return parseOutputContract(userAiProfileVmSchema, {}, "test-drift");
    }
  }));
  const headers = { Cookie: await cookie(runtimeSettings) };

  const typed = await typedApp.request("/api/me/ai-profile", { headers });
  const drift = await driftApp.request("/api/me/ai-profile", { headers });

  assert.equal(typed.status, 403);
  assert.deepEqual(await typed.json(), {
    ok: false,
    error: { code: "ai_profile_access_denied", message: "profile denied" }
  });
  assert.equal(drift.status, 500);
  assert.deepEqual(await drift.json(), {
    ok: false,
    error: { code: "internal_contract_error", message: "internal" }
  });
});
