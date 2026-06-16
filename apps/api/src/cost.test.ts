import assert from "node:assert/strict";
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
import { buildUsageRecord, createMemoryBudgetPolicyStore, createMemoryCostLedgerStore } from "@workhub/cost";
import type {
  ClientDeviceAuthRow,
  CreateAuditLogInput,
  ClientDeviceRepository,
  TeamSkillRow,
  UserAuthRow,
  UserRepository
} from "@workhub/db";

import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "./middleware/auth.js";
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

function authDeps(runtimeSettings: Settings): AuthDependencies {
  return {
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
  assert.equal(listBody.data.length, 4);
  assert.equal(listBody.data.find((policy) => policy.id === "pcost-workitem-run-v0")?.max_tokens, 120000);

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

test("cost dashboard page aggregates ledger entries without exposing all users to non-admins", async () => {
  const runtimeSettings = settings();
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
    data: { total_cost_cny: string; token_in: number; by_user: unknown[]; model_breakdown: { provider: string; model: string }[] };
  };
  const adminBody = await adminResponse.json() as { ok: true; data: { by_user: unknown[]; token_in: number } };
  // 非管理员：只看到自己的花费，另一用户的 18000 token / 高额成本完全不出现。
  assert.equal(userBody.data.total_cost_cny, "0.006");
  assert.equal(userBody.data.token_in, 1000);
  assert.equal(userBody.data.by_user.length, 0);
  assert.equal(userBody.data.model_breakdown.length, 1);
  assert.equal(userBody.data.model_breakdown[0]?.model, "deepseek-v4-flash");
  // 管理员：全组织视图，两个用户都在。
  assert.equal(adminBody.data.by_user.length, 2);
  assert.equal(adminBody.data.token_in, 10000);
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
