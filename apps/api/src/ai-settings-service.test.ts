import assert from "node:assert/strict";
import test from "node:test";

import type { ProviderRegistry } from "@workhub/agent/providers";
import { loadSettings } from "@workhub/config";
import type {
  AiSettingsRepository,
  ProjectAiGovernanceRow,
  ProjectGovernanceAccessRecord,
  UserAiProfileRow,
  UserProfileAccessRecord
} from "@workhub/db";
import { AiSettingsAccessDeniedError } from "@workhub/db";
import type {
  BudgetPolicy,
  BudgetPolicyStore,
  BudgetUsageSnapshot,
  CostLedgerStore
} from "@workhub/cost";

import type { AuthActor } from "./middleware/auth.js";
import { InternalContractError } from "./pages/output-contract.js";

const now = new Date("2026-07-12T10:00:00.000Z");
const workspaceId = "14000000-0000-4000-8000-000000000001";
const otherWorkspaceId = "14000000-0000-4000-8000-000000000002";
const userId = "14000000-0000-4000-8000-000000000003";
const projectId = "14000000-0000-4000-8000-000000000004";

const runtimeSettings = loadSettings({
  APP_ENV: "test",
  DEFAULT_WORKSPACE_ID: otherWorkspaceId
});

function actor(overrides: Partial<AuthActor> = {}): AuthActor {
  return {
    kind: "human",
    id: userId,
    label: "R12 owner",
    userId,
    isAdmin: false,
    orgId: "14000000-0000-4000-8000-000000000005",
    workspaceId,
    ...overrides
  };
}

function profile(overrides: Partial<UserAiProfileRow> = {}): UserAiProfileRow {
  return {
    workspaceId,
    userId,
    defaultMode: 3,
    granularJson: {},
    dispatchPolicy: "auto",
    cuuProactivity: "balanced",
    modelTierPref: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

const project = {
  id: projectId,
  workspaceId,
  name: "R12",
  slug: "r12",
  description: null,
  ownerNickname: "R12 owner",
  ownerUserId: userId,
  archived: false,
  deletedAt: null,
  deletedByNickname: null,
  nextSeq: 0,
  // R13 批 S3：projects 加了 is_personal 列——AiSettingsProjectRow 现在要求这个字段，
  // 不是本文件测的功能改动，纯粹是共享表加列牵连的机械补齐。
  isPersonal: false,
  // R15 批 B：projects 加了 is_dm_container 列——机械补齐（普通项目固定 false）。
  isDmContainer: false,
  createdAt: now,
  updatedAt: now
};

function governance(overrides: Partial<ProjectAiGovernanceRow> = {}): ProjectAiGovernanceRow {
  return {
    projectId,
    observerEnabled: true,
    silenceWindowSecs: 60,
    quietHoursJson: { enabled: false },
    granularJson: {},
    // R14 批 RISK：projectAiGovernance 加了 risk_monitor_json 列——ProjectAiGovernanceRow
    // ($inferSelect) 现在要求这个字段，不是本文件测的功能改动，纯粹是共享表加列牵连的机械补齐。
    riskMonitorJson: {},
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

type RepositoryOptions = {
  profileAccess?: UserProfileAccessRecord | null;
  governanceAccess?: ProjectGovernanceAccessRecord | null;
  findProfile?: AiSettingsRepository["findUserProfileAccessRecord"];
  writeProfile?: AiSettingsRepository["upsertUserProfile"];
  findGovernance?: AiSettingsRepository["findProjectGovernanceAccessRecord"];
  writeGovernance?: AiSettingsRepository["upsertProjectGovernance"];
};

function repository(options: RepositoryOptions = {}) {
  const profileReads: unknown[] = [];
  const profileWrites: unknown[] = [];
  const profileCommits: unknown[] = [];
  const governanceReads: unknown[] = [];
  const governanceWrites: unknown[] = [];
  const governanceCommits: unknown[] = [];
  const repo: AiSettingsRepository = {
    async findUserProfileAccessRecord(input) {
      profileReads.push(input);
      if (options.findProfile) {
        return options.findProfile(input);
      }
      return options.profileAccess === undefined
        ? { membershipRole: "member", profile: null }
        : options.profileAccess;
    },
    async upsertUserProfile(input) {
      profileWrites.push(input);
      let written: UserAiProfileRow;
      if (options.writeProfile) {
        written = await options.writeProfile(input);
      } else {
        written = profile({
          defaultMode: input.patch.defaultMode ?? 3,
          granularJson: { ...(input.patch.granularJson ?? {}) },
          dispatchPolicy: input.patch.dispatchPolicy ?? "auto",
          cuuProactivity: input.patch.cuuProactivity ?? "balanced",
          modelTierPref: input.patch.modelTierPref ?? null,
          updatedAt: input.at ?? now
        });
      }
      input.validateWritten?.(written);
      profileCommits.push(input);
      return written;
    },
    async findProjectGovernanceAccessRecord(input) {
      governanceReads.push(input);
      if (options.findGovernance) {
        return options.findGovernance(input);
      }
      return options.governanceAccess === undefined
        ? { membershipRole: "member", project, governance: null }
        : options.governanceAccess;
    },
    async upsertProjectGovernance(input) {
      governanceWrites.push(input);
      let written: ProjectAiGovernanceRow;
      if (options.writeGovernance) {
        written = await options.writeGovernance(input);
      } else {
        written = governance({
          observerEnabled: input.patch.observerEnabled ?? true,
          silenceWindowSecs: input.patch.silenceWindowSecs ?? 60,
          quietHoursJson: input.patch.quietHoursJson ?? { enabled: false },
          granularJson: { ...(input.patch.granularJson ?? {}) },
          riskMonitorJson: { ...(input.patch.riskMonitorJson ?? {}) },
          updatedAt: input.at ?? now
        });
      }
      input.validateWritten?.(written);
      governanceCommits.push(input);
      return written;
    }
  };
  return {
    repo,
    profileReads,
    profileWrites,
    profileCommits,
    governanceReads,
    governanceWrites,
    governanceCommits
  };
}

function model(id: string, modelName: string) {
  return {
    id,
    model: modelName,
    displayName: modelName.toUpperCase(),
    contextWindowTokens: 128000,
    supportsStreaming: true,
    supportsTools: true,
    costInputCnyPerMtok: 2,
    costOutputCnyPerMtok: 8
  };
}

function providerRegistry(
  metadata: ReturnType<ProviderRegistry["publicMetadata"]> = [
    {
      name: "deepseek",
      defaultModelId: "default",
      configured: true,
      models: { default: model("default", "deepseek-v4-pro") }
    }
  ]
) {
  let calls = 0;
  return {
    registry: {
      publicMetadata() {
        calls += 1;
        return metadata;
      }
    } satisfies Pick<ProviderRegistry, "publicMetadata">,
    get calls() {
      return calls;
    }
  };
}

function ledger(snapshots: BudgetUsageSnapshot[] = []) {
  const calls: unknown[] = [];
  return {
    store: {
      async usageSnapshots(scopeIds, options) {
        calls.push({ scopeIds, options });
        return snapshots;
      }
    } satisfies Pick<CostLedgerStore, "usageSnapshots">,
    calls
  };
}

function userDayPolicy(overrides: Partial<BudgetPolicy> = {}): BudgetPolicy {
  return {
    id: "pcost-user-day-v0",
    scopeKind: "user",
    period: "day",
    maxTokens: 500000,
    maxCostCny: "20",
    warningRatio: 0.8,
    criticalRatio: 0.95,
    onWarning: "notify",
    onExhausted: "block_new_run",
    modelRouteHint: "balanced",
    enabled: true,
    version: 1,
    ...overrides
  };
}

function policies(values: BudgetPolicy[] = [userDayPolicy()]) {
  const calls: unknown[] = [];
  return {
    store: {
      async listPolicies(settings) {
        calls.push(settings);
        return values;
      }
    } satisfies Pick<BudgetPolicyStore, "listPolicies">,
    calls
  };
}

async function serviceModule() {
  const module = await import("./services/ai-settings.js").catch(() => null);
  assert.ok(module, "missing AI settings service module");
  assert.equal(typeof module.createAiSettingsService, "function", "missing createAiSettingsService export");
  return module;
}

test("AI profile GET synthesizes defaults, sanitizes and sorts metadata, and keeps user day/month usage truthful", async () => {
  const module = await serviceModule();
  const db = repository({ profileAccess: { membershipRole: "member", profile: null } });
  const rawMetadata = [
    {
      name: "zeta",
      defaultModelId: "z",
      configured: false,
      models: { z: model("ignored-z", "z-model") },
      apiKey: "must-not-leak",
      baseUrl: "https://must-not-leak.invalid"
    },
    {
      name: "alpha",
      defaultModelId: "a",
      configured: true,
      models: {
        z: { ...model("ignored-z", "z-model"), storageSecret: "must-not-leak" },
        a: model("ignored-a", "a-model")
      }
    }
  ] as unknown as ReturnType<ProviderRegistry["publicMetadata"]>;
  const providers = providerRegistry(rawMetadata);
  const usage = ledger([
    { scope: { kind: "team", teamId: workspaceId }, period: "day", tokenIn: 999, tokenOut: 1, estimatedCostCny: "99" },
    { scope: { kind: "user", userId }, period: "day", tokenIn: 10, tokenOut: 2, estimatedCostCny: "0.1" },
    { scope: { kind: "user", userId }, period: "month", tokenIn: 100, tokenOut: 20, estimatedCostCny: "1.25" }
  ]);
  const policy = policies([userDayPolicy({ maxTokens: 321000, maxCostCny: "7.5", enabled: false })]);
  let nowCalls = 0;
  const service = module.createAiSettingsService({
    repository: db.repo,
    providers: providers.registry,
    ledger: usage.store,
    policies: policy.store,
    settings: runtimeSettings,
    now: () => {
      nowCalls += 1;
      return now;
    }
  });

  const result = await service.getUserProfile({ actor: actor() });

  assert.deepEqual(result, {
    workspace_id: workspaceId,
    user_id: userId,
    default_mode: 3,
    granular_settings: {},
    dispatch_policy: "auto",
    cuu_proactivity: "balanced",
    model_tier_preference: null,
    providers: [
      {
        name: "alpha",
        configured: true,
        default_model_id: "a",
        models: [
          {
            id: "a",
            model: "a-model",
            display_name: "A-MODEL",
            context_window_tokens: 128000,
            supports_streaming: true,
            supports_tools: true,
            cost_input_cny_per_mtok: 2,
            cost_output_cny_per_mtok: 8
          },
          {
            id: "z",
            model: "z-model",
            display_name: "Z-MODEL",
            context_window_tokens: 128000,
            supports_streaming: true,
            supports_tools: true,
            cost_input_cny_per_mtok: 2,
            cost_output_cny_per_mtok: 8
          }
        ]
      },
      {
        name: "zeta",
        configured: false,
        default_model_id: "z",
        models: [
          {
            id: "z",
            model: "z-model",
            display_name: "Z-MODEL",
            context_window_tokens: 128000,
            supports_streaming: true,
            supports_tools: true,
            cost_input_cny_per_mtok: 2,
            cost_output_cny_per_mtok: 8
          }
        ]
      }
    ],
    budget_summary: {
      daily_quota: {
        policy_id: "pcost-user-day-v0",
        period: "day",
        max_tokens: 321000,
        max_cost_cny: "7.5",
        enabled: false
      },
      usage: {
        day: { period: "day", token_in: 10, token_out: 2, total_tokens: 12, estimated_cost_cny: "0.1" },
        month: { period: "month", token_in: 100, token_out: 20, total_tokens: 120, estimated_cost_cny: "1.25" }
      }
    },
    generated_at: now.toISOString(),
    updated_at: null
  });
  assert.equal(JSON.stringify(result).includes("must-not-leak"), false);
  assert.deepEqual(db.profileReads, [{ workspaceId, userId }]);
  assert.deepEqual(db.profileWrites, []);
  assert.deepEqual(usage.calls, [{ scopeIds: { userId, teamId: workspaceId }, options: { now } }]);
  assert.equal(policy.calls.length, 1);
  assert.equal((policy.calls[0] as typeof runtimeSettings).auth.defaultWorkspaceId, workspaceId);
  assert.equal((policy.calls[0] as typeof runtimeSettings).auth.defaultOrgId, actor().orgId);
  assert.equal(providers.calls, 1);
  assert.equal(nowCalls, 1);
});

test("AI profile GET maps a stored row and returns null quota with explicit zero usage when no user/day policy exists", async () => {
  const module = await serviceModule();
  const stored = profile({
    defaultMode: 2,
    granularJson: { mutate_drive: false },
    dispatchPolicy: "manual",
    cuuProactivity: "quiet",
    modelTierPref: "default"
  });
  const db = repository({ profileAccess: { membershipRole: "member", profile: stored } });
  const providers = providerRegistry();
  const usage = ledger();
  const policy = policies([]);
  const service = module.createAiSettingsService({
    repository: db.repo,
    providers: providers.registry,
    ledger: usage.store,
    policies: policy.store,
    settings: runtimeSettings,
    now: () => now
  });

  const result = await service.getUserProfile({ actor: actor() });

  assert.equal(result.default_mode, 2);
  assert.deepEqual(result.granular_settings, { mutate_drive: false });
  assert.equal(result.dispatch_policy, "manual");
  assert.equal(result.cuu_proactivity, "quiet");
  assert.equal(result.model_tier_preference, "default");
  assert.equal(result.updated_at, now.toISOString());
  assert.equal(result.budget_summary.daily_quota, null);
  assert.deepEqual(result.budget_summary.usage, {
    day: { period: "day", token_in: 0, token_out: 0, total_tokens: 0, estimated_cost_cny: "0" },
    month: { period: "month", token_in: 0, token_out: 0, total_tokens: 0, estimated_cost_cny: "0" }
  });
  assert.deepEqual(db.profileWrites, []);
});

test("AI profile PATCH maps only contract fields, accepts null reset, and rejects unavailable model IDs before writing", async () => {
  const module = await serviceModule();
  const db = repository();
  const providers = providerRegistry();
  const usage = ledger();
  const policy = policies();
  const service = module.createAiSettingsService({
    repository: db.repo,
    providers: providers.registry,
    ledger: usage.store,
    policies: policy.store,
    settings: runtimeSettings,
    now: () => now
  });
  const payload = {
    default_mode: 5 as const,
    granular_settings: { create_work_item: false },
    dispatch_policy: "ask" as const,
    cuu_proactivity: "proactive" as const,
    model_tier_preference: null
  };

  const updated = await service.patchUserProfile({ actor: actor(), payload });

  assert.equal(updated.model_tier_preference, null);
  assert.equal(db.profileWrites.length, 1);
  const profileWrite = db.profileWrites[0]! as Parameters<AiSettingsRepository["upsertUserProfile"]>[0];
  assert.equal(typeof profileWrite.validateWritten, "function");
  const { validateWritten: _validateProfileWrite, ...profileWriteFields } = profileWrite;
  assert.deepEqual(profileWriteFields, {
    workspaceId,
    userId,
    patch: {
      defaultMode: 5,
      granularJson: { create_work_item: false },
      dispatchPolicy: "ask",
      cuuProactivity: "proactive",
      modelTierPref: null
    },
    at: now
  });

  await assert.rejects(
    service.patchUserProfile({
      actor: actor(),
      payload: { model_tier_preference: "premium-v2" }
    }),
    (error: unknown) => error instanceof module.AiSettingsServiceError
      && error.status === 422
      && error.code === "ai_model_preference_unavailable"
  );
  assert.equal(db.profileWrites.length, 1, "unavailable preference must not reach the repository");
});

test("AI profile access denial is typed while unknown repository failures remain observable", async () => {
  const module = await serviceModule();
  const denied = repository({ profileAccess: null });
  const deps = {
    providers: providerRegistry().registry,
    ledger: ledger().store,
    policies: policies().store,
    settings: runtimeSettings,
    now: () => now
  };
  const deniedService = module.createAiSettingsService({ repository: denied.repo, ...deps });

  await assert.rejects(
    deniedService.getUserProfile({ actor: actor() }),
    (error: unknown) => error instanceof module.AiSettingsServiceError
      && error.status === 403
      && error.code === "ai_profile_access_denied"
  );

  const sentinel = new Error("profile database unavailable");
  const failing = repository({ findProfile: async () => { throw sentinel; } });
  await assert.rejects(
    module.createAiSettingsService({ repository: failing.repo, ...deps }).getUserProfile({ actor: actor() }),
    (error: unknown) => error === sentinel
  );
});

test("AI profile rejects non-human or blank tenant actors without falling back to configured IDs", async () => {
  const module = await serviceModule();
  const db = repository();
  const providers = providerRegistry();
  const usage = ledger();
  const policy = policies();
  const service = module.createAiSettingsService({
    repository: db.repo,
    providers: providers.registry,
    ledger: usage.store,
    policies: policy.store,
    settings: runtimeSettings,
    now: () => now
  });
  const { userId: _humanUserId, ...actorWithoutUserId } = actor();

  for (const invalidActor of [
    { ...actorWithoutUserId, kind: "system" as const },
    actor({ userId: "   " }),
    actor({ workspaceId: "   " })
  ]) {
    await assert.rejects(
      service.getUserProfile({ actor: invalidActor }),
      (error: unknown) => error instanceof module.AiSettingsServiceError
        && error.status === 403
    );
  }
  assert.deepEqual(db.profileReads, []);
  assert.deepEqual(db.profileWrites, []);
  assert.equal(providers.calls, 0);
  assert.deepEqual(usage.calls, []);
  assert.deepEqual(policy.calls, []);
});

test("AI profile maps transactional revocation to 403 and propagates ledger and policy failures", async () => {
  const module = await serviceModule();
  const revoked = repository({
    writeProfile: async () => {
      throw new AiSettingsAccessDeniedError("membership was revoked");
    }
  });
  const baseDeps = {
    providers: providerRegistry().registry,
    ledger: ledger().store,
    policies: policies().store,
    settings: runtimeSettings,
    now: () => now
  };
  const revokedService = module.createAiSettingsService({ repository: revoked.repo, ...baseDeps });
  await revokedService.assertUserProfileAccess({ actor: actor() });
  await assert.rejects(
    revokedService.patchUserProfile({ actor: actor(), payload: { default_mode: 4 } }),
    (error: unknown) => error instanceof module.AiSettingsServiceError
      && error.status === 403
      && error.code === "ai_profile_access_denied"
  );

  const ledgerFailure = new Error("ledger unavailable");
  const failingLedger = {
    async usageSnapshots(): Promise<BudgetUsageSnapshot[]> {
      throw ledgerFailure;
    }
  };
  await assert.rejects(
    module.createAiSettingsService({
      repository: repository().repo,
      ...baseDeps,
      ledger: failingLedger
    }).getUserProfile({ actor: actor() }),
    (error: unknown) => error === ledgerFailure
  );

  const policyFailure = new Error("policy store unavailable");
  const failingPolicies = {
    async listPolicies(): Promise<BudgetPolicy[]> {
      throw policyFailure;
    }
  };
  await assert.rejects(
    module.createAiSettingsService({
      repository: repository().repo,
      ...baseDeps,
      policies: failingPolicies
    }).getUserProfile({ actor: actor() }),
    (error: unknown) => error === policyFailure
  );
});

test("AI profile PATCH validates ledger and policy response inputs before writing", async () => {
  const module = await serviceModule();
  const ledgerFailure = new Error("patch ledger unavailable");
  const policyFailure = new Error("patch policy store unavailable");
  const cases: Array<{
    label: string;
    ledgerStore: Pick<CostLedgerStore, "usageSnapshots">;
    policyStore: Pick<BudgetPolicyStore, "listPolicies">;
    expected: (error: unknown) => boolean;
  }> = [
    {
      label: "ledger failure",
      ledgerStore: {
        async usageSnapshots(): Promise<BudgetUsageSnapshot[]> {
          throw ledgerFailure;
        }
      },
      policyStore: policies().store,
      expected: (error) => error === ledgerFailure
    },
    {
      label: "policy failure",
      ledgerStore: ledger().store,
      policyStore: {
        async listPolicies(): Promise<BudgetPolicy[]> {
          throw policyFailure;
        }
      },
      expected: (error) => error === policyFailure
    },
    {
      label: "malformed matching usage snapshot",
      ledgerStore: ledger([{
        scope: { kind: "user", userId },
        period: "day",
        tokenIn: -1,
        tokenOut: 2,
        estimatedCostCny: "0.1"
      }]).store,
      policyStore: policies().store,
      expected: (error) => error instanceof InternalContractError
    },
    {
      label: "malformed daily policy",
      ledgerStore: ledger().store,
      policyStore: policies([userDayPolicy({ maxTokens: 0 })]).store,
      expected: (error) => error instanceof InternalContractError
    }
  ];
  const observedWrites: Array<{ label: string; writes: number }> = [];

  for (const testCase of cases) {
    const db = repository();
    const service = module.createAiSettingsService({
      repository: db.repo,
      providers: providerRegistry().registry,
      ledger: testCase.ledgerStore,
      policies: testCase.policyStore,
      settings: runtimeSettings,
      now: () => now
    });

    await assert.rejects(
      service.patchUserProfile({ actor: actor(), payload: { default_mode: 4 } }),
      testCase.expected,
      testCase.label
    );
    observedWrites.push({ label: testCase.label, writes: db.profileWrites.length });
  }
  assert.deepEqual(
    observedWrites,
    cases.map((testCase) => ({ label: testCase.label, writes: 0 })),
    "all response dependency failures and malformed values must fail before profile mutation"
  );
});

test("project governance GET synthesizes defaults without writing and PATCH maps owner settings", async () => {
  const module = await serviceModule();
  const db = repository();
  const service = module.createAiSettingsService({
    repository: db.repo,
    providers: providerRegistry().registry,
    ledger: ledger().store,
    policies: policies().store,
    settings: runtimeSettings,
    now: () => now
  });

  const defaults = await service.getProjectGovernance({ actor: actor(), projectId });
  assert.deepEqual(defaults, {
    project_id: projectId,
    observer_enabled: true,
    silence_window_seconds: 60,
    quiet_hours: { enabled: false },
    granular_settings: {},
    // R14 批 RISK（批准变更，见 r14-release-readiness/05-risk-design.md §2.1）：additive risk_monitor,
    // 读侧完整默认值合并输出。
    risk_monitor: {
      enabled: true,
      stall_days_threshold: 5,
      deadline_lookahead_days: 2,
      cost_spike_ratio_pct: 300,
      cost_spike_min_cny: 20
    },
    updated_at: null
  });
  assert.deepEqual(db.governanceWrites, []);

  const quietHours = {
    enabled: true as const,
    timezone: "Asia/Singapore",
    start_minute: 1320,
    end_minute: 480,
    weekdays: [1, 2, 3, 4, 5]
  };
  const updated = await service.patchProjectGovernance({
    actor: actor(),
    projectId,
    payload: {
      observer_enabled: false,
      silence_window_seconds: 30,
      quiet_hours: quietHours,
      granular_settings: { dispatch_run: false }
    }
  });

  assert.equal(updated.observer_enabled, false);
  assert.deepEqual(updated.quiet_hours, quietHours);
  assert.equal(db.governanceWrites.length, 1);
  const governanceWrite = db.governanceWrites[0]! as Parameters<
    AiSettingsRepository["upsertProjectGovernance"]
  >[0];
  assert.equal(typeof governanceWrite.validateWritten, "function");
  const { validateWritten: _validateGovernanceWrite, ...governanceWriteFields } = governanceWrite;
  assert.deepEqual(governanceWriteFields, {
    workspaceId,
    projectId,
    actorUserId: userId,
    patch: {
      observerEnabled: false,
      silenceWindowSecs: 30,
      quietHoursJson: quietHours,
      granularJson: { dispatch_run: false }
    },
    at: now
  });
});

// R14 批 RISK：PATCH .risk_monitor 映射到仓库 patch 的 riskMonitorJson，读侧输出用
// DEFAULT_RISK_MONITOR_SETTINGS 补全成完整对象（非 partial）。
test("project governance PATCH maps risk_monitor to riskMonitorJson and GET merges it with conservative defaults", async () => {
  const module = await serviceModule();
  const db = repository();
  const service = module.createAiSettingsService({
    repository: db.repo,
    providers: providerRegistry().registry,
    ledger: ledger().store,
    policies: policies().store,
    settings: runtimeSettings,
    now: () => now
  });

  const updated = await service.patchProjectGovernance({
    actor: actor(),
    projectId,
    payload: { risk_monitor: { stall_days_threshold: 3, cost_spike_ratio_pct: 500 } }
  });

  assert.deepEqual(updated.risk_monitor, {
    enabled: true,
    stall_days_threshold: 3,
    deadline_lookahead_days: 2,
    cost_spike_ratio_pct: 500,
    cost_spike_min_cny: 20
  });
  const governanceWrite = db.governanceWrites[0]! as Parameters<
    AiSettingsRepository["upsertProjectGovernance"]
  >[0];
  assert.deepEqual(governanceWrite.patch, {
    riskMonitorJson: { stall_days_threshold: 3, cost_spike_ratio_pct: 500 }
  });
});

test("project governance stays owner-only for admins and maps post-preflight revocation to the same 404", async () => {
  const module = await serviceModule();
  const deps = {
    providers: providerRegistry().registry,
    ledger: ledger().store,
    policies: policies().store,
    settings: runtimeSettings,
    now: () => now
  };
  const denied = repository({ governanceAccess: null });
  const deniedService = module.createAiSettingsService({ repository: denied.repo, ...deps });

  await assert.rejects(
    deniedService.getProjectGovernance({ actor: actor({ isAdmin: true }), projectId }),
    (error: unknown) => error instanceof module.AiSettingsServiceError
      && error.status === 404
      && error.code === "ai_governance_not_found"
  );
  assert.deepEqual(denied.governanceWrites, []);

  const revoked = repository({
    governanceAccess: { membershipRole: "admin", project, governance: null },
    writeGovernance: async () => {
      throw new AiSettingsAccessDeniedError("ownership was revoked");
    }
  });
  const revokedService = module.createAiSettingsService({ repository: revoked.repo, ...deps });
  await revokedService.assertProjectGovernanceAccess({ actor: actor(), projectId });
  await assert.rejects(
    revokedService.patchProjectGovernance({
      actor: actor(),
      projectId,
      payload: { observer_enabled: false }
    }),
    (error: unknown) => error instanceof module.AiSettingsServiceError
      && error.status === 404
      && error.code === "ai_governance_not_found"
  );
  assert.equal(revoked.governanceWrites.length, 1, "transactional repository check remains authoritative");
});

test("AI settings PATCH validates malformed RETURNING rows before transaction commit", async () => {
  const module = await serviceModule();
  const deps = {
    providers: providerRegistry().registry,
    ledger: ledger().store,
    policies: policies().store,
    settings: runtimeSettings,
    now: () => now
  };
  const malformedProfile = repository({
    writeProfile: async () => profile({ defaultMode: 99 as never })
  });
  await assert.rejects(
    module.createAiSettingsService({
      repository: malformedProfile.repo,
      ...deps
    }).patchUserProfile({ actor: actor(), payload: { dispatch_policy: "ask" } }),
    (error: unknown) => error instanceof InternalContractError
  );

  const malformedGovernance = repository({
    writeGovernance: async () => governance({ silenceWindowSecs: 86_401 })
  });
  await assert.rejects(
    module.createAiSettingsService({
      repository: malformedGovernance.repo,
      ...deps
    }).patchProjectGovernance({
      actor: actor(),
      projectId,
      payload: { observer_enabled: false }
    }),
    (error: unknown) => error instanceof InternalContractError
  );

  assert.deepEqual(
    {
      profile_attempts: malformedProfile.profileWrites.length,
      profile_commits: malformedProfile.profileCommits.length,
      governance_attempts: malformedGovernance.governanceWrites.length,
      governance_commits: malformedGovernance.governanceCommits.length
    },
    {
      profile_attempts: 1,
      profile_commits: 0,
      governance_attempts: 1,
      governance_commits: 0
    }
  );
});

test("AI profile output drift throws InternalContractError and provider failures are not swallowed", async () => {
  const module = await serviceModule();
  const db = repository();
  const malformedMetadata = [{
    name: "deepseek",
    defaultModelId: "missing",
    configured: true,
    models: { default: model("default", "deepseek-v4-pro") }
  }] as ReturnType<ProviderRegistry["publicMetadata"]>;
  const malformedService = module.createAiSettingsService({
    repository: db.repo,
    providers: providerRegistry(malformedMetadata).registry,
    ledger: ledger().store,
    policies: policies().store,
    settings: runtimeSettings,
    now: () => now
  });
  await assert.rejects(
    malformedService.getUserProfile({ actor: actor() }),
    (error: unknown) => error instanceof InternalContractError
  );
  await assert.rejects(
    malformedService.patchUserProfile({
      actor: actor(),
      payload: { model_tier_preference: "default" }
    }),
    (error: unknown) => error instanceof InternalContractError
  );
  assert.deepEqual(db.profileWrites, [], "invalid provider metadata must fail before profile mutation");

  const sentinel = new Error("provider metadata unavailable");
  const failingProvider = {
    publicMetadata(): ReturnType<ProviderRegistry["publicMetadata"]> {
      throw sentinel;
    }
  };
  await assert.rejects(
    module.createAiSettingsService({
      repository: db.repo,
      providers: failingProvider,
      ledger: ledger().store,
      policies: policies().store,
      settings: runtimeSettings,
      now: () => now
    }).getUserProfile({ actor: actor() }),
    (error: unknown) => error === sentinel
  );
});
