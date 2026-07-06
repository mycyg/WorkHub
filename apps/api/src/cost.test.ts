import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import type {
  LlmCreateParams,
  LlmCreateResponse,
  LlmStream,
  LlmStreamEvent,
  LlmTransport
} from "@workhub/agent/providers";
import { loadSettings, type Settings } from "@workhub/config";
import {
  buildUsageRecord,
  createMemoryBudgetPolicyStore,
  createMemoryCostLedgerStore,
  type BudgetPolicyStore,
  type CostLedgerStore
} from "@workhub/cost";
import type {
  ClientDeviceAuthRow,
  CreateAuditLogInput,
  ClientDeviceRepository,
  TeamSkillRow,
  UserAuthRow,
  UserRepository,
  WorkspaceMembershipRepository
} from "@workhub/db";

import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "./middleware/auth.js";
import { buildCostDashboardPage } from "./pages/cost.js";
import { InternalContractError } from "./pages/output-contract.js";
import { createCostRoutes } from "./routes/cost.js";
import { createPageRoutes } from "./routes/pages.js";
import { createApiProviderRegistry } from "./services/provider-registry.js";

const now = new Date("2026-06-05T00:00:00.000Z");
const adminId = "10000000-0000-4000-8000-0000000000a1";
const userId = "10000000-0000-4000-8000-0000000000b1";

function user(partial: Partial<UserAuthRow> = {}): UserAuthRow {
  return {
    id: userId,
    nickname: "cost-user",
    cookieToken: "cookie-cost-user",
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

class ProviderLedgerTestStream implements LlmStream {
  constructor(private readonly final: LlmCreateResponse) {}

  async *[Symbol.asyncIterator](): AsyncIterator<LlmStreamEvent> {
    yield { type: "content_block_delta", data: { text: "streamed" } };
  }

  async getFinalMessage() {
    return this.final;
  }
}

class ProviderLedgerTestTransport implements LlmTransport {
  public calls: (LlmCreateParams & { model: string })[] = [];

  async create(params: LlmCreateParams & { model: string }) {
    this.calls.push(params);
    return {
      id: "msg-cost-create",
      content: [{ type: "text", text: "created" }],
      usage: { inputTokens: 1000, outputTokens: 500 }
    };
  }

  async stream(params: LlmCreateParams & { model: string }) {
    this.calls.push(params);
    return new ProviderLedgerTestStream({
      id: "msg-cost-stream",
      content: [{ type: "text", text: "streamed" }],
      usage: { inputTokens: 2000, outputTokens: 1000 }
    });
  }
}

function settings(): Settings {
  return loadSettings({
    APP_ENV: "test",
    COOKIE_SECRET: "test-cookie-secret"
  });
}

function authDeps(runtimeSettings: Settings, options: {
  tenant?: { orgId: string; workspaceId: string };
} = {}): AuthDependencies {
  const deps: AuthDependencies = {
    users: new MemoryUsers([
      user({
        id: adminId,
        nickname: "cost-admin",
        cookieToken: "cookie-cost-admin",
        isAdmin: true
      }),
      user()
    ]),
    devices: new MemoryDevices(),
    settings: runtimeSettings,
    now: () => now
  };
  if (options.tenant) {
    deps.memberships = {
      async resolveDefaultTenant() {
        return options.tenant ?? null;
      }
    } as unknown as WorkspaceMembershipRepository;
  }
  return deps;
}

function withErrors<T extends { Variables: Record<string, unknown> }>(app: Hono<T>) {
  app.onError((error, c) => {
    if (error instanceof InternalContractError) {
      return c.json({ ok: false, error: { code: "internal_contract_error", message: "internal contract error" } }, 500);
    }
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

async function cookie(runtimeSettings: Settings, cookieToken: string) {
  return generateSignedCookie(COOKIE_NAME, cookieToken, runtimeSettings.auth.cookieSecret);
}

function captureAuditLogs() {
  const logs: CreateAuditLogInput[] = [];
  return {
    logs,
    writer: {
      async createAuditLog(input: CreateAuditLogInput) {
        logs.push(input);
      }
    }
  };
}

test("R1 PG smoke checks tenant-scoped budget policy storage ids", () => {
  const source = readFileSync("src/qa/r1-pg-agent-run-smoke.ts", "utf8");

  assert.match(source, /budgetPolicyStorageId\(\s*settings,\s*"pcost-user-day-v0"\s*\)/u);
  assert.doesNotMatch(source, /row\.id === "pcost-user-day-v0"/u);
});

test("R2 audit#1: a failed audit write surfaces as a server error, not a 422 invalid-patch (update+audit stay atomic in production)", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  const policyStore = createMemoryBudgetPolicyStore();
  app.route("/api/cost", createCostRoutes({
    auth: authDeps(runtimeSettings),
    policyStore,
    // 审计写在编排器内紧随策略更新；它抛出时不能被当作「补丁非法(422)」,而应冒泡成 5xx。
    // 生产路径里二者同处一个 db.transaction,审计失败会回滚策略变更(原子)。
    auditLogs: {
      async createAuditLog() {
        throw new Error("audit sink unavailable");
      }
    }
  }));
  const headers = { Cookie: await cookie(runtimeSettings, "cookie-cost-admin") };

  // 审计写失败必须作为服务端错误冒泡(app.ts 真 onError 映射 500),绝不被路由 catch 当成 422 invalid-patch 吞掉。
  // 此处用 withErrors 测试 helper 对泛型错误是 rethrow,故 app.request 直接 reject——正是「向上冒泡」的证据。
  await assert.rejects(
    async () => {
      await app.request("/api/cost/policies/user/pcost-user-day-v0", {
        method: "PUT",
        headers,
        body: JSON.stringify({ max_tokens: 250000 })
      });
    },
    (error: unknown) => error instanceof Error && error.message === "audit sink unavailable"
  );
});

test("cost policy routes expose configurable P-COST defaults to admins", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  const policyStore = createMemoryBudgetPolicyStore();
  const auditLogs = captureAuditLogs();
  app.route("/api/cost", createCostRoutes({
    auth: authDeps(runtimeSettings),
    policyStore,
    auditLogs: auditLogs.writer
  }));
  const headers = { Cookie: await cookie(runtimeSettings, "cookie-cost-admin") };

  const list = await app.request("/api/cost/policies", { headers });
  assert.equal(list.status, 200);
  const listBody = await list.json() as {
    ok: true;
    data: { id: string; scope_kind: string; max_tokens: number; max_cost_cny: string; version: number }[];
  };
  // 旧断言 5 在只有 workitem/user/team/eval 默认策略时是对的；R9.5 新增 task/objective 预算策略后必须一起暴露给管理员配置。
  assert.equal(listBody.data.length, 7);
  assert.equal(listBody.data.find((policy) => policy.id === "pcost-workitem-run-v0")?.max_tokens, 120000);
  assert.equal(listBody.data.find((policy) => policy.id === "pcost-task-day-v0")?.scope_kind, "task");
  assert.equal(listBody.data.find((policy) => policy.id === "pcost-objective-day-v0")?.scope_kind, "objective");
  // eval 套件日预算策略现已存在（M21：此前 eval 在决策层无上限）。
  assert.equal(listBody.data.find((policy) => policy.id === "pcost-eval-day-v0")?.scope_kind, "eval");

  const update = await app.request("/api/cost/policies/user/pcost-user-day-v0", {
    method: "PUT",
    headers,
    body: JSON.stringify({ max_tokens: 250000, max_cost_cny: "12.5", on_warning: "notify" })
  });
  assert.equal(update.status, 200);
  const updateBody = await update.json() as { ok: true; data: { max_tokens: number; max_cost_cny: string; version: number } };
  assert.equal(updateBody.data.max_tokens, 250000);
  assert.equal(updateBody.data.max_cost_cny, "12.5");
  assert.equal(updateBody.data.version, 2);

  const readBack = await app.request("/api/cost/policies", { headers });
  const readBackBody = await readBack.json() as { ok: true; data: { id: string; max_cost_cny: string }[] };
  assert.equal(readBackBody.data.find((policy) => policy.id === "pcost-user-day-v0")?.max_cost_cny, "12.5");
  assert.equal(auditLogs.logs.length, 1);
  assert.equal(auditLogs.logs[0]?.action, "budget_policy.updated");
  assert.equal(auditLogs.logs[0]?.entityType, "budget_policy");
  assert.equal(auditLogs.logs[0]?.entityId, "pcost-user-day-v0");
  assert.equal(auditLogs.logs[0]?.actorUserId, adminId);
  assert.equal(auditLogs.logs[0]?.detailJson?.["version_before"], 1);
  assert.equal(auditLogs.logs[0]?.detailJson?.["version_after"], 2);
  assert.deepEqual(auditLogs.logs[0]?.detailJson?.["patch"], {
    max_tokens: 250000,
    max_cost_cny: "12.5",
    on_warning: "notify"
  });
});

test("cost policy routes fail closed as server errors when stored policies violate the response contract", async () => {
  const runtimeSettings = settings();
  const invalidPolicyStore: BudgetPolicyStore = {
    async listPolicies() {
      return [{
        id: "pcost-invalid-row",
        scopeKind: "user",
        period: "day",
        maxTokens: 1000,
        maxCostCny: "1",
        warningRatio: 0.95,
        criticalRatio: 0.9,
        onWarning: "notify",
        onExhausted: "block_new_run",
        enabled: true,
        version: 1
      }];
    },
    async updatePolicy() {
      return undefined;
    }
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/cost", createCostRoutes({
    auth: authDeps(runtimeSettings),
    policyStore: invalidPolicyStore
  }));

  const response = await app.request("/api/cost/policies", {
    headers: { Cookie: await cookie(runtimeSettings, "cookie-cost-admin") }
  });

  assert.equal(response.status, 500);
  const body = await response.json() as { ok: false; error: { code: string } };
  assert.equal(body.error.code, "internal_contract_error");
});

test("cost policy routes read and update policies in the admin actor workspace", async () => {
  const runtimeSettings = settings();
  const actorWorkspaceId = "00000000-0000-4000-8000-00000000c0b2";
  const actorOrgId = "00000000-0000-4000-8000-00000000c0a1";
  const baseStore = createMemoryBudgetPolicyStore();
  const seenListWorkspaces: string[] = [];
  const seenUpdateWorkspaces: string[] = [];
  const policyStore = {
    listPolicies(inputSettings: Settings) {
      seenListWorkspaces.push(inputSettings.auth.defaultWorkspaceId);
      return baseStore.listPolicies(inputSettings);
    },
    updatePolicy(inputSettings: Settings, ...args: Parameters<typeof baseStore.updatePolicy> extends [Settings, ...infer Rest] ? Rest : never) {
      seenUpdateWorkspaces.push(inputSettings.auth.defaultWorkspaceId);
      return baseStore.updatePolicy(inputSettings, ...args);
    }
  };
  const auditLogs = captureAuditLogs();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/cost", createCostRoutes({
    auth: authDeps(runtimeSettings, {
      tenant: { orgId: actorOrgId, workspaceId: actorWorkspaceId }
    }),
    policyStore,
    auditLogs: auditLogs.writer
  }));
  const headers = { Cookie: await cookie(runtimeSettings, "cookie-cost-admin") };

  const list = await app.request("/api/cost/policies", { headers });
  assert.equal(list.status, 200);
  const update = await app.request("/api/cost/policies/user/pcost-user-day-v0", {
    method: "PUT",
    headers,
    body: JSON.stringify({ max_tokens: 240000 })
  });

  assert.equal(update.status, 200);
  assert.equal(seenListWorkspaces[0], actorWorkspaceId);
  assert.equal(seenUpdateWorkspaces[0], actorWorkspaceId);
  assert.equal(auditLogs.logs[0]?.orgId, actorOrgId);
  assert.equal(auditLogs.logs[0]?.workspaceId, actorWorkspaceId);
});

test("cost policy routes fail closed for non-admins and invalid policy updates", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/cost", createCostRoutes({
    auth: authDeps(runtimeSettings),
    policyStore: createMemoryBudgetPolicyStore(),
    ledgerStore: createMemoryCostLedgerStore({ teamId: runtimeSettings.auth.defaultWorkspaceId })
  }));

  const userHeaders = { Cookie: await cookie(runtimeSettings, "cookie-cost-user") };
  const adminHeaders = { Cookie: await cookie(runtimeSettings, "cookie-cost-admin") };

  const blocked = await app.request("/api/cost/policies", { headers: userHeaders });
  assert.equal(blocked.status, 403);

  const usage = await app.request("/api/cost/usage", { headers: userHeaders });
  assert.equal(usage.status, 200);

  const invalid = await app.request("/api/cost/policies/user/pcost-user-day-v0", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ warning_ratio: 0.98 })
  });
  assert.equal(invalid.status, 422);

  const empty = await app.request("/api/cost/policies/user/pcost-user-day-v0", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({})
  });
  assert.equal(empty.status, 422);

  const missing = await app.request("/api/cost/policies/user/missing", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ enabled: false })
  });
  assert.equal(missing.status, 404);
});

test("cost usage route reads budget usage from the shared ledger", async () => {
  const runtimeSettings = settings();
  const ledgerStore = createMemoryCostLedgerStore({ teamId: runtimeSettings.auth.defaultWorkspaceId });
  await ledgerStore.recordUsage(buildUsageRecord({
    provider: "deepseek",
    model: "deepseek-v4-flash",
    task: "worker",
    runId: "40000000-0000-4000-8000-0000000000b1",
    workItemId: "50000000-0000-4000-8000-0000000000b1",
    userId,
    inputTokens: 450000,
    outputTokens: 0,
    costTier: { inputCnyPerMtok: 2, outputCnyPerMtok: 8 },
    // 路由用真实 now 做周期预算（user-day/team-month），用量须落在当前周期内才计入。
    createdAt: new Date()
  }));
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/cost", createCostRoutes({
    auth: authDeps(runtimeSettings),
    policyStore: createMemoryBudgetPolicyStore(),
    ledgerStore
  }));

  const response = await app.request("/api/cost/usage", {
    headers: { Cookie: await cookie(runtimeSettings, "cookie-cost-user") }
  });

  assert.equal(response.status, 200);
  const body = await response.json() as {
    ok: true;
    data: {
      me: { token_in: number; status: string; remaining_tokens: number };
      team?: { token_in: number };
      active_notices: { code: string; options?: unknown[] }[];
    };
  };
  assert.equal(body.data.me.token_in, 450000);
  assert.equal(body.data.me.status, "warning");
  assert.equal(body.data.me.remaining_tokens, 50000);
  assert.equal(body.data.team?.token_in, 450000);
  assert.equal(body.data.active_notices[0]?.code, "budget_warning");
  assert.equal((body.data.active_notices[0]?.options?.length ?? 0) >= 2, true);
});

test("cost usage route uses the actor workspace for team budget usage", async () => {
  const runtimeSettings = settings();
  const actorWorkspaceId = "00000000-0000-4000-8000-00000000c0b2";
  const otherWorkspaceId = "00000000-0000-4000-8000-00000000c0b3";
  const ledgerStore = createMemoryCostLedgerStore({ teamId: actorWorkspaceId });
  await ledgerStore.recordUsage(buildUsageRecord({
    provider: "deepseek",
    model: "deepseek-v4-flash",
    task: "worker",
    runId: "40000000-0000-4000-8000-0000000000c2",
    workItemId: "50000000-0000-4000-8000-0000000000c2",
    userId,
    inputTokens: 120000,
    outputTokens: 0,
    costTier: { inputCnyPerMtok: 2, outputCnyPerMtok: 8 },
    createdAt: new Date()
  }));
  await ledgerStore.recordUsage(buildUsageRecord({
    provider: "deepseek",
    model: "deepseek-v4-flash",
    task: "worker",
    runId: "40000000-0000-4000-8000-0000000000c3",
    workItemId: "50000000-0000-4000-8000-0000000000c3",
    userId,
    workspaceId: otherWorkspaceId,
    inputTokens: 220000,
    outputTokens: 0,
    costTier: { inputCnyPerMtok: 2, outputCnyPerMtok: 8 },
    createdAt: new Date()
  }));
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/cost", createCostRoutes({
    auth: authDeps(runtimeSettings, {
      tenant: { orgId: runtimeSettings.auth.defaultOrgId, workspaceId: actorWorkspaceId }
    }),
    policyStore: createMemoryBudgetPolicyStore(),
    ledgerStore
  }));

  const response = await app.request("/api/cost/usage", {
    headers: { Cookie: await cookie(runtimeSettings, "cookie-cost-user") }
  });

  assert.equal(response.status, 200);
  const body = await response.json() as {
    ok: true;
    data: {
      me: { scope: { kind: "user"; user_id: string }; token_in: number };
      team?: { scope: { kind: "team"; team_id: string }; token_in: number };
    };
  };
  assert.equal(body.data.me.scope.user_id, userId);
  assert.equal(body.data.me.token_in, 120000);
  assert.equal(body.data.team?.scope.team_id, actorWorkspaceId);
  assert.equal(body.data.team?.token_in, 120000);
});

test("cost usage route does not resurrect disabled user and team budget policies as default scopes", async () => {
  const runtimeSettings = settings();
  const policyStore = createMemoryBudgetPolicyStore();
  policyStore.updatePolicy(runtimeSettings, "user", "pcost-user-day-v0", { enabled: false });
  policyStore.updatePolicy(runtimeSettings, "team", "pcost-team-day-v0", { enabled: false });
  policyStore.updatePolicy(runtimeSettings, "team", "pcost-team-month-v0", { enabled: false });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/cost", createCostRoutes({
    auth: authDeps(runtimeSettings),
    policyStore,
    ledgerStore: createMemoryCostLedgerStore({ teamId: runtimeSettings.auth.defaultWorkspaceId })
  }));

  const response = await app.request("/api/cost/usage", {
    headers: { Cookie: await cookie(runtimeSettings, "cookie-cost-user") }
  });

  assert.equal(response.status, 200);
  const body = await response.json() as {
    ok: true;
    data: {
      me: { policy_id: string; max_tokens: number; enabled?: boolean };
      team?: { policy_id: string; max_tokens: number; enabled?: boolean };
      scopes: { policy_id: string; scope: { kind: string } }[];
      active_notices: unknown[];
    };
  };
  assert.equal(body.data.scopes.some((usage) => usage.scope.kind === "user" || usage.scope.kind === "team"), false);
  assert.equal(body.data.me.max_tokens, 0);
  assert.equal(body.data.me.enabled, false);
  assert.equal(body.data.me.policy_id, "pcost-user-day-v0:disabled");
  assert.equal(body.data.team?.max_tokens, 0);
  assert.equal(body.data.team?.enabled, false);
  assert.equal(body.data.team?.policy_id, "pcost-team-day-v0:disabled");
  assert.deepEqual(body.data.active_notices, []);
});

test("cost dashboard page marks disabled budget rows instead of hiding them behind zero quotas", async () => {
  const runtimeSettings = settings();
  const policyStore = createMemoryBudgetPolicyStore();
  policyStore.updatePolicy(runtimeSettings, "user", "pcost-user-day-v0", { enabled: false });
  policyStore.updatePolicy(runtimeSettings, "team", "pcost-team-day-v0", { enabled: false });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/pages", createPageRoutes({
    auth: authDeps(runtimeSettings),
    policyStore,
    ledgerStore: createMemoryCostLedgerStore({ teamId: runtimeSettings.auth.defaultWorkspaceId })
  }));

  const response = await app.request("/api/pages/cost", {
    headers: { Cookie: await cookie(runtimeSettings, "cookie-cost-user") }
  });

  assert.equal(response.status, 200);
  const body = await response.json() as {
    ok: true;
    data: {
      budget: { policy_id: string; enabled?: boolean; max_tokens: number; max_cost_cny: string }[];
      top_exhaustion_risks: unknown[];
    };
  };
  const disabledRows = body.data.budget.filter((usage) => usage.enabled === false);
  assert.equal(disabledRows.length, 2);
  assert.deepEqual(disabledRows.map((usage) => usage.policy_id).sort(), ["pcost-team-day-v0:disabled", "pcost-user-day-v0:disabled"]);
  assert.equal(disabledRows.every((usage) => usage.max_tokens === 0 && usage.max_cost_cny === "0"), true);
  assert.deepEqual(body.data.top_exhaustion_risks, []);
});

test("cost usage route preserves budget policy notice actions", async () => {
  const runtimeSettings = settings();
  const policyStore = createMemoryBudgetPolicyStore();
  policyStore.updatePolicy(runtimeSettings, "user", "pcost-user-day-v0", { onWarning: "notify" });
  const ledgerStore = createMemoryCostLedgerStore({ teamId: runtimeSettings.auth.defaultWorkspaceId });
  await ledgerStore.recordUsage(buildUsageRecord({
    provider: "deepseek",
    model: "deepseek-v4-flash",
    task: "worker",
    runId: "40000000-0000-4000-8000-0000000000d1",
    workItemId: "50000000-0000-4000-8000-0000000000d1",
    userId,
    inputTokens: 450000,
    outputTokens: 0,
    costTier: { inputCnyPerMtok: 2, outputCnyPerMtok: 8 },
    createdAt: new Date()
  }));
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/cost", createCostRoutes({
    auth: authDeps(runtimeSettings),
    policyStore,
    ledgerStore
  }));

  const response = await app.request("/api/cost/usage", {
    headers: { Cookie: await cookie(runtimeSettings, "cookie-cost-user") }
  });

  assert.equal(response.status, 200);
  const body = await response.json() as {
    ok: true;
    data: { active_notices: { recommended_action: string }[] };
  };
  assert.equal(body.data.active_notices[0]?.recommended_action, "continue");
});

test("cost dashboard page uses the actor workspace for budget policies", async () => {
  const runtimeSettings = settings();
  const actorWorkspaceId = "00000000-0000-4000-8000-00000000c0d2";
  const actorOrgId = "00000000-0000-4000-8000-00000000c0d1";
  const baseStore = createMemoryBudgetPolicyStore();
  const seenPolicyWorkspaces: string[] = [];
  const policyStore = {
    listPolicies(inputSettings: Settings) {
      seenPolicyWorkspaces.push(inputSettings.auth.defaultWorkspaceId);
      return baseStore.listPolicies(inputSettings);
    },
    updatePolicy: baseStore.updatePolicy
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/pages", createPageRoutes({
    auth: authDeps(runtimeSettings, {
      tenant: { orgId: actorOrgId, workspaceId: actorWorkspaceId }
    }),
    policyStore,
    ledgerStore: createMemoryCostLedgerStore({ teamId: actorWorkspaceId })
  }));

  const response = await app.request("/api/pages/cost", {
    headers: { Cookie: await cookie(runtimeSettings, "cookie-cost-user") }
  });

  assert.equal(response.status, 200);
  assert.equal(seenPolicyWorkspaces[0], actorWorkspaceId);
});

test("cost dashboard page scopes admin ledger totals to the actor workspace", async () => {
  const runtimeSettings = settings();
  const actorWorkspaceId = "00000000-0000-4000-8000-00000000c0e2";
  const otherWorkspaceId = "00000000-0000-4000-8000-00000000c0e3";
  const ledgerStore = createMemoryCostLedgerStore();
  await ledgerStore.recordUsage(buildUsageRecord({
    provider: "deepseek",
    model: "deepseek-v4-flash",
    task: "worker",
    runId: "40000000-0000-4000-8000-0000000000e1",
    userId,
    workspaceId: actorWorkspaceId,
    inputTokens: 1_000_000,
    outputTokens: 0,
    costTier: { inputCnyPerMtok: 1, outputCnyPerMtok: 1 },
    createdAt: now
  }));
  await ledgerStore.recordUsage(buildUsageRecord({
    provider: "deepseek",
    model: "deepseek-v4-flash",
    task: "skill-curation",
    workspaceId: actorWorkspaceId,
    inputTokens: 500_000,
    outputTokens: 0,
    source: "curation",
    costTier: { inputCnyPerMtok: 1, outputCnyPerMtok: 1 },
    createdAt: now
  }));
  await ledgerStore.recordUsage(buildUsageRecord({
    provider: "deepseek",
    model: "deepseek-v4-pro",
    task: "worker",
    runId: "40000000-0000-4000-8000-0000000000e2",
    userId: "10000000-0000-4000-8000-0000000000e9",
    workspaceId: otherWorkspaceId,
    inputTokens: 2_000_000,
    outputTokens: 0,
    costTier: { inputCnyPerMtok: 1, outputCnyPerMtok: 1 },
    createdAt: now
  }));
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/pages", createPageRoutes({
    auth: authDeps(runtimeSettings, {
      tenant: { orgId: runtimeSettings.auth.defaultOrgId, workspaceId: actorWorkspaceId }
    }),
    policyStore: createMemoryBudgetPolicyStore(),
    ledgerStore
  }));

  const response = await app.request("/api/pages/cost", {
    headers: { Cookie: await cookie(runtimeSettings, "cookie-cost-admin") }
  });

  assert.equal(response.status, 200);
  const body = await response.json() as {
    ok: true;
    data: {
      total_cost_cny: string;
      token_in: number;
      labor_split?: { production_cost_cny: string; self_improvement_cost_cny: string };
      model_breakdown: { model: string }[];
    };
  };
  assert.equal(body.data.total_cost_cny, "1.5");
  assert.equal(body.data.token_in, 1_500_000);
  assert.deepEqual(body.data.model_breakdown.map((item) => item.model), ["deepseek-v4-flash"]);
  assert.equal(body.data.labor_split?.production_cost_cny, "1");
  assert.equal(body.data.labor_split?.self_improvement_cost_cny, "0.5");
});

test("routes-b-2/contracts-pkgs-4: non-admin cost page calls the narrow user-scope query, not a full workspace scan", async () => {
  const runtimeSettings = settings();
  const baseStore = createMemoryCostLedgerStore({ teamId: runtimeSettings.auth.defaultWorkspaceId });
  await baseStore.recordUsage(buildUsageRecord({
    provider: "deepseek",
    model: "deepseek-v4-flash",
    task: "worker",
    runId: "40000000-0000-4000-8000-0000000000ba",
    workItemId: "50000000-0000-4000-8000-0000000000ba",
    userId,
    inputTokens: 1000,
    outputTokens: 500,
    costTier: { inputCnyPerMtok: 2, outputCnyPerMtok: 8 },
    createdAt: now
  }));
  const scopesCalls: unknown[] = [];
  const workspaceCalls: unknown[] = [];
  const spyStore: CostLedgerStore = {
    records: baseStore.records,
    entries: baseStore.entries,
    recordUsage: (record) => baseStore.recordUsage(record),
    usageSnapshots: (scopeIds, options) => baseStore.usageSnapshots(scopeIds, options),
    listEntries: (options) => baseStore.listEntries!(options),
    listEntriesForScopes: (scopeIds, options) => {
      scopesCalls.push(scopeIds);
      return baseStore.listEntriesForScopes!(scopeIds, options);
    },
    listEntriesForWorkspace: (teamId, options) => {
      workspaceCalls.push(teamId);
      return baseStore.listEntriesForWorkspace!(teamId, options);
    }
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/pages", createPageRoutes({
    auth: authDeps(runtimeSettings),
    policyStore: createMemoryBudgetPolicyStore(),
    ledgerStore: spyStore
  }));

  const userResponse = await app.request("/api/pages/cost", {
    headers: { Cookie: await cookie(runtimeSettings, "cookie-cost-user") }
  });
  assert.equal(userResponse.status, 200);

  // 非管理员必须走 listEntriesForScopes({ userId, teamId })（走索引 + 子查询半连接），绝不能调用
  // listEntriesForWorkspace（拉整个工作区再靠内存过滤）。
  assert.equal(workspaceCalls.length, 0);
  assert.equal(scopesCalls.length, 1);
  assert.deepEqual(scopesCalls[0], { userId, teamId: runtimeSettings.auth.defaultWorkspaceId });

  const adminResponse = await app.request("/api/pages/cost", {
    headers: { Cookie: await cookie(runtimeSettings, "cookie-cost-admin") }
  });
  assert.equal(adminResponse.status, 200);
  // 管理员路径语义不变：仍走 listEntriesForWorkspace（保留 team/user/workitem 同胞条目供拆分展示）。
  assert.equal(workspaceCalls.length, 1);
  assert.equal(workspaceCalls[0], runtimeSettings.auth.defaultWorkspaceId);
});

test("R9.5 cost dashboard aggregates task and objective ledger dimensions", () => {
  const runtimeSettings = settings();
  const taskPlanId = "83000000-0000-4000-8000-000000000501";
  const objectiveId = "83000000-0000-4000-8000-000000000502";
  const usageRecordId = "usage-task-objective";
  const baseEntry = {
    usageRecordId,
    runId: "40000000-0000-4000-8000-000000000501",
    workItemId: "50000000-0000-4000-8000-000000000501",
    userId,
    teamId: runtimeSettings.auth.defaultWorkspaceId,
    periodBucket: "2026-06-05",
    tokenIn: 1200,
    tokenOut: 300,
    estimatedCostCny: "0.5",
    currency: "CNY" as const,
    provider: "deepseek",
    model: "deepseek-v4-flash",
    source: "agent_step" as const,
    createdAt: now.toISOString()
  };
  const dashboard = buildCostDashboardPage({
    settings: runtimeSettings,
    isAdmin: true,
    userId,
    teamId: runtimeSettings.auth.defaultWorkspaceId,
    generatedAt: now,
    budgetUsages: [],
    ledgerEntries: [
      {
        ...baseEntry,
        id: "ledger-task",
        scope: { kind: "task", taskPlanId }
      },
      {
        ...baseEntry,
        id: "ledger-objective",
        scope: { kind: "objective", objectiveId }
      }
    ] as NonNullable<Parameters<typeof buildCostDashboardPage>[0]["ledgerEntries"]>
  });

  assert.equal(dashboard.total_cost_cny, "0.5");
  assert.deepEqual((dashboard as unknown as { by_task?: unknown[] }).by_task, [{
    task_plan_id: taskPlanId,
    cost_cny: "0.5",
    turns: 1
  }]);
  assert.deepEqual((dashboard as unknown as { by_objective?: unknown[] }).by_objective, [{
    objective_id: objectiveId,
    cost_cny: "0.5",
    turns: 1
  }]);
});

test("cost dashboard page aggregates ledger entries without exposing all users to non-admins", async () => {
  const runtimeSettings = settings();
  const otherWorkspaceId = "00000000-0000-4000-8000-00000000f0f1";
  const ledgerStore = createMemoryCostLedgerStore({ teamId: runtimeSettings.auth.defaultWorkspaceId });
  await ledgerStore.recordUsage(buildUsageRecord({
    provider: "deepseek",
    model: "deepseek-v4-flash",
    task: "worker",
    runId: "40000000-0000-4000-8000-0000000000b2",
    workItemId: "50000000-0000-4000-8000-0000000000b2",
    userId,
    inputTokens: 1000,
    outputTokens: 500,
    costTier: { inputCnyPerMtok: 2, outputCnyPerMtok: 8 },
    createdAt: now
  }));
  // 另一个用户的花费：非管理员绝不能在自己的总额/趋势里看到它（M8）。
  await ledgerStore.recordUsage(buildUsageRecord({
    provider: "deepseek",
    model: "deepseek-v4-pro",
    task: "worker",
    runId: "40000000-0000-4000-8000-0000000000b3",
    workItemId: "50000000-0000-4000-8000-0000000000b3",
    userId: "10000000-0000-4000-8000-0000000000c9",
    inputTokens: 9000,
    outputTokens: 9000,
    costTier: { inputCnyPerMtok: 4, outputCnyPerMtok: 16 },
    createdAt: now
  }));
  // 同一个用户在另一个 workspace 的花费也不能混进当前 workspace 的「我的成本」。
  await ledgerStore.recordUsage(buildUsageRecord({
    provider: "deepseek",
    model: "deepseek-v4-pro",
    task: "worker",
    runId: "40000000-0000-4000-8000-0000000000b4",
    workItemId: "50000000-0000-4000-8000-0000000000b4",
    userId,
    workspaceId: otherWorkspaceId,
    inputTokens: 7000,
    outputTokens: 7000,
    costTier: { inputCnyPerMtok: 4, outputCnyPerMtok: 16 },
    createdAt: now
  }));
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/pages", createPageRoutes({
    auth: authDeps(runtimeSettings),
    policyStore: createMemoryBudgetPolicyStore(),
    ledgerStore
  }));

  const userResponse = await app.request("/api/pages/cost", {
    headers: { Cookie: await cookie(runtimeSettings, "cookie-cost-user") }
  });
  const adminResponse = await app.request("/api/pages/cost", {
    headers: { Cookie: await cookie(runtimeSettings, "cookie-cost-admin") }
  });

  assert.equal(userResponse.status, 200);
  assert.equal(adminResponse.status, 200);
  const userBody = await userResponse.json() as {
    ok: true;
    data: { total_cost_cny: string; token_in: number; by_user: unknown[]; by_team: unknown[]; by_workitem: unknown[]; model_breakdown: { provider: string; model: string }[] };
  };
  const adminBody = await adminResponse.json() as { ok: true; data: { by_user: unknown[]; by_team: unknown[]; by_workitem: unknown[]; token_in: number } };
  // 非管理员：只看到自己的花费，另一用户的 18000 token / 高额成本完全不出现。
  assert.equal(userBody.data.total_cost_cny, "0.006");
  assert.equal(userBody.data.token_in, 1000);
  assert.equal(userBody.data.by_user.length, 0);
  // findings[37]：by_team / by_workitem 也是全组织口径，非管理员一律置空（不把自己花费误标成"团队预算"）。
  assert.equal(userBody.data.by_team.length, 0);
  assert.equal(userBody.data.by_workitem.length, 0);
  assert.equal(userBody.data.model_breakdown.length, 1);
  assert.equal(userBody.data.model_breakdown[0]?.model, "deepseek-v4-flash");
  // 管理员：全组织视图，两个用户都在，团队聚合可见。
  assert.equal(adminBody.data.by_user.length, 2);
  assert.equal(adminBody.data.token_in, 10000);
  assert.ok(adminBody.data.by_team.length >= 1);
});

test("L[1] cost dashboard fails closed (empty) for a non-admin when the store lacks scope-filtered reads", async () => {
  const runtimeSettings = settings();
  const fullStore = createMemoryCostLedgerStore({ teamId: runtimeSettings.auth.defaultWorkspaceId });
  await fullStore.recordUsage(buildUsageRecord({
    provider: "deepseek",
    model: "deepseek-v4-flash",
    task: "worker",
    runId: "40000000-0000-4000-8000-0000000000d2",
    workItemId: "50000000-0000-4000-8000-0000000000d2",
    userId,
    inputTokens: 1000,
    outputTokens: 500,
    costTier: { inputCnyPerMtok: 2, outputCnyPerMtok: 8 },
    createdAt: now
  }));
  await fullStore.recordUsage(buildUsageRecord({
    provider: "deepseek",
    model: "deepseek-v4-pro",
    task: "worker",
    runId: "40000000-0000-4000-8000-0000000000d3",
    workItemId: "50000000-0000-4000-8000-0000000000d3",
    userId: "10000000-0000-4000-8000-0000000000c9",
    inputTokens: 9000,
    outputTokens: 9000,
    costTier: { inputCnyPerMtok: 4, outputCnyPerMtok: 16 },
    createdAt: now
  }));
  // 模拟一个未实现按 scope 查询的 store 注入：保留 listEntries/entries（全量），但去掉 listEntriesForScopes。
  // 非管理员请求绝不能 fail-open 回退到全量账目——必须 fail-closed 返回空。
  const storeWithoutScopes: CostLedgerStore = {
    records: fullStore.records,
    entries: fullStore.entries,
    recordUsage: (record) => fullStore.recordUsage(record),
    usageSnapshots: (scopeIds, options) => fullStore.usageSnapshots(scopeIds, options),
    listEntries: () => fullStore.listEntries!()
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/pages", createPageRoutes({
    auth: authDeps(runtimeSettings),
    policyStore: createMemoryBudgetPolicyStore(),
    ledgerStore: storeWithoutScopes
  }));

  const userResponse = await app.request("/api/pages/cost", {
    headers: { Cookie: await cookie(runtimeSettings, "cookie-cost-user") }
  });
  assert.equal(userResponse.status, 200);
  const userBody = await userResponse.json() as { ok: true; data: { token_in: number; by_user: unknown[] } };
  // fail-closed：既看不到自己的 1000，也绝不泄露另一用户的 18000——全空。
  assert.equal(userBody.data.token_in, 0);
  assert.equal(userBody.data.by_user.length, 0);
});

test("api provider registry records create and stream usage into the shared cost ledger", async () => {
  const runtimeSettings = loadSettings({
    APP_ENV: "test",
    COOKIE_SECRET: "test-cookie-secret",
    LLM_API_KEY: "fake-api-provider-key",
    PROVIDER_DEEPSEEK_COST_INPUT_CNY_PER_MTOK: "2",
    PROVIDER_DEEPSEEK_COST_OUTPUT_CNY_PER_MTOK: "8"
  });
  const ledgerStore = createMemoryCostLedgerStore({ teamId: runtimeSettings.auth.defaultWorkspaceId });
  const transport = new ProviderLedgerTestTransport();
  const registry = createApiProviderRegistry({
    settings: runtimeSettings,
    ledgerStore,
    transportFactory: () => transport
  });
  const actor = {
    id: "actor-cost-ledger",
    userId,
    runId: "40000000-0000-4000-8000-0000000000c1",
    workItemId: "50000000-0000-4000-8000-0000000000c1"
  };

  await registry.get(actor, "worker").messages.create({
    maxTokens: 4096,
    messages: [{ role: "user", content: "write a proposal" }]
  });
  const stream = await registry.get(actor, "review").messages.stream({
    maxTokens: 4096,
    source: "review",
    messages: [{ role: "user", content: "review the proposal" }]
  });
  for await (const _event of stream) {
    // The stream body is intentionally consumed before final usage is reconciled.
  }
  await stream.getFinalMessage();

  assert.equal(transport.calls.length, 2);
  assert.equal(transport.calls.every((call) => call.model === "deepseek-v4-flash"), true);
  assert.equal(ledgerStore.records.length, 2);
  assert.equal(ledgerStore.entries.length, 6);
  assert.equal(ledgerStore.records[0]?.estimatedCostCny, "0.006");
  assert.equal(ledgerStore.records[1]?.estimatedCostCny, "0.012");
  assert.equal(JSON.stringify(ledgerStore.records).includes("fake-api-provider-key"), false);

  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/pages", createPageRoutes({
    auth: authDeps(runtimeSettings),
    ledgerStore,
    policyStore: createMemoryBudgetPolicyStore()
  }));
  const response = await app.request("/api/pages/cost", {
    headers: { Cookie: await cookie(runtimeSettings, "cookie-cost-user") }
  });
  assert.equal(response.status, 200);
  const body = await response.json() as {
    ok: true;
    data: {
      total_cost_cny: string;
      token_in: number;
      token_out: number;
      model_breakdown: { provider: string; model: string; count: number; cost_cny: string }[];
    };
  };
  assert.equal(body.data.total_cost_cny, "0.018");
  assert.equal(body.data.token_in, 3000);
  assert.equal(body.data.token_out, 1500);
  assert.deepEqual(body.data.model_breakdown, [
    { provider: "deepseek", model: "deepseek-v4-flash", count: 2, cost_cny: "0.018" }
  ]);
});

test("team skills page route authenticates and returns active skills with K2 provenance", async () => {
  const runtimeSettings = settings();
  const activeRow = {
    id: "ts-quarterly-report",
    workspaceId: runtimeSettings.auth.defaultWorkspaceId,
    skillKey: "quarterly-report",
    name: "季度报告",
    whenToUse: "生成季度业务报告",
    contentMd: "---\nname: q\nwhen_to_use: y\n---\n\n# q\n正文",
    status: "active",
    version: 2,
    sourceKind: "distilled",
    createdByKind: "ai",
    confidenceScore: 0.86,
    sampleCount: 0,
    samplesJson: { refined_from_version: 1, ops: [{ op: "add_section", section: "边界情况" }], rationale_md: "补边界" },
    sourceRunId: null,
    deprecatedReason: null,
    deprecatedAt: null,
    createdAt: now,
    updatedAt: now
  } as unknown as TeamSkillRow;

  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/pages", createPageRoutes({
    auth: authDeps(runtimeSettings),
    teamSkills: { listActive: async () => [activeRow] }
  }));

  const response = await app.request("/api/pages/skills", {
    headers: { Cookie: await cookie(runtimeSettings, "cookie-cost-user") }
  });

  assert.equal(response.status, 200);
  const body = await response.json() as {
    ok: true;
    data: {
      skills: Array<{ skill_key: string; version: number; provenance?: { refined_from_version: number; op_count: number } }>;
      totals: { active: number; refined: number; ai_authored: number };
    };
  };
  assert.equal(body.data.skills.length, 1);
  assert.equal(body.data.skills[0]?.skill_key, "quarterly-report");
  assert.equal(body.data.skills[0]?.version, 2);
  assert.equal(body.data.skills[0]?.provenance?.refined_from_version, 1);
  assert.equal(body.data.skills[0]?.provenance?.op_count, 1);
  assert.equal(body.data.totals.active, 1);
  assert.equal(body.data.totals.refined, 1);
  assert.equal(body.data.totals.ai_authored, 1);
});

test("team skills page route requires authentication", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/pages", createPageRoutes({
    auth: authDeps(runtimeSettings),
    teamSkills: { listActive: async () => [] }
  }));
  const response = await app.request("/api/pages/skills");
  assert.equal(response.status, 401);
});
