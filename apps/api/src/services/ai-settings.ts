import type { ProviderRegistry } from "@workhub/agent/providers";
import {
  settings as defaultSettings,
  type Settings
} from "@workhub/config";
import {
  DEFAULT_PROJECT_AI_GOVERNANCE,
  DEFAULT_RISK_MONITOR_SETTINGS,
  DEFAULT_USER_AI_PROFILE,
  aiBudgetSummaryVmSchema,
  aiProviderVmSchema,
  projectAiGovernanceVmSchema,
  userAiProfileVmSchema,
  type AiBudgetSummaryVM,
  type AiQuietHours,
  type PatchProjectAiGovernanceRequest,
  type PatchUserAiProfileRequest,
  type ProjectAiGovernanceVM,
  type UserAiProfileVM
} from "@workhub/contracts";
import {
  AiSettingsAccessDeniedError,
  createAiSettingsRepository,
  getSharedDatabaseClient,
  type AiSettingsRepository,
  type ProjectAiGovernanceRow,
  type UserAiProfileRow,
  type WorkHubDatabaseClient
} from "@workhub/db";
import type {
  BudgetPolicyStore,
  BudgetUsageSnapshot,
  CostLedgerStore
} from "@workhub/cost";

import type { AuthActor } from "../middleware/auth.js";
import { parseOutputContract } from "../pages/output-contract.js";
import { getDefaultBudgetPolicyStore } from "./cost-policy-store.js";
import { getDefaultCostLedgerStore } from "./cost-ledger-store.js";
import { getDefaultProviderRegistry } from "./provider-registry.js";

export class AiSettingsServiceError extends Error {
  constructor(
    public readonly status: 403 | 404 | 422,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "AiSettingsServiceError";
  }
}

type HumanAiSettingsActor = {
  actor: AuthActor;
  userId: string;
  workspaceId: string;
};

export type AiSettingsServiceDependencies = {
  repository: AiSettingsRepository;
  providers: Pick<ProviderRegistry, "publicMetadata">;
  ledger: Pick<CostLedgerStore, "usageSnapshots">;
  policies: Pick<BudgetPolicyStore, "listPolicies">;
  settings?: Settings;
  now?: () => Date;
};

export type AiSettingsService = {
  assertUserProfileAccess(input: { actor: AuthActor }): Promise<void>;
  getUserProfile(input: { actor: AuthActor }): Promise<UserAiProfileVM>;
  patchUserProfile(input: {
    actor: AuthActor;
    payload: PatchUserAiProfileRequest;
  }): Promise<UserAiProfileVM>;
  assertProjectGovernanceAccess(input: {
    actor: AuthActor;
    projectId: string;
  }): Promise<void>;
  getProjectGovernance(input: {
    actor: AuthActor;
    projectId: string;
  }): Promise<ProjectAiGovernanceVM>;
  patchProjectGovernance(input: {
    actor: AuthActor;
    projectId: string;
    payload: PatchProjectAiGovernanceRequest;
  }): Promise<ProjectAiGovernanceVM>;
};

function requireHumanActor(actor: AuthActor): HumanAiSettingsActor {
  const userId = actor.userId?.trim();
  const workspaceId = actor.workspaceId.trim();
  if (actor.kind !== "human" || !userId || !workspaceId) {
    throw new AiSettingsServiceError(
      403,
      "ai_profile_access_denied",
      "需要已加入工作区的真人用户才能访问 AI 设置。"
    );
  }
  return { actor, userId, workspaceId };
}

function profileAccessDenied(): AiSettingsServiceError {
  return new AiSettingsServiceError(
    403,
    "ai_profile_access_denied",
    "当前用户没有可用的工作区 AI 档案。"
  );
}

function governanceNotFound(): AiSettingsServiceError {
  return new AiSettingsServiceError(
    404,
    "ai_governance_not_found",
    "没有找到可管理的项目 AI 设置。"
  );
}

function unavailableModelPreference(): AiSettingsServiceError {
  return new AiSettingsServiceError(
    422,
    "ai_model_preference_unavailable",
    "选择的模型档位当前不可用。"
  );
}

function tenantSettings(settings: Settings, human: HumanAiSettingsActor): Settings {
  return {
    ...settings,
    auth: {
      ...settings.auth,
      defaultOrgId: human.actor.orgId,
      defaultWorkspaceId: human.workspaceId
    }
  };
}

function copyQuietHours(value: AiQuietHours): AiQuietHours {
  return value.enabled
    ? { ...value, weekdays: [...value.weekdays] }
    : { enabled: false };
}

function providerView(metadata: ReturnType<ProviderRegistry["publicMetadata"]>) {
  const providers = metadata
    .map((provider) => ({
      name: provider.name,
      configured: provider.configured,
      default_model_id: provider.defaultModelId,
      models: Object.entries(provider.models)
        .map(([id, model]) => ({
          id,
          model: model.model,
          display_name: model.displayName,
          context_window_tokens: model.contextWindowTokens,
          supports_streaming: model.supportsStreaming,
          supports_tools: model.supportsTools,
          cost_input_cny_per_mtok: model.costInputCnyPerMtok,
          cost_output_cny_per_mtok: model.costOutputCnyPerMtok
        }))
        .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    }))
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  return parseOutputContract(
    aiProviderVmSchema.array().max(100),
    providers,
    "ai-settings.providers"
  );
}

function modelIdAllowlist(metadata: ReturnType<ProviderRegistry["publicMetadata"]>) {
  return new Set(metadata.flatMap((provider) => Object.keys(provider.models)));
}

function usageView(
  snapshots: BudgetUsageSnapshot[],
  userId: string,
  period: "day" | "month"
) {
  const snapshot = snapshots.find((candidate) =>
    candidate.scope.kind === "user"
    && candidate.scope.userId === userId
    && candidate.period === period
  );
  const tokenIn = snapshot?.tokenIn ?? 0;
  const tokenOut = snapshot?.tokenOut ?? 0;
  return {
    period,
    token_in: tokenIn,
    token_out: tokenOut,
    total_tokens: tokenIn + tokenOut,
    estimated_cost_cny: snapshot?.estimatedCostCny ?? "0"
  };
}

function requireValidatedWriteView<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`${label} repository did not run its written-row validator`);
  }
  return value;
}

export function createAiSettingsService(deps: AiSettingsServiceDependencies): AiSettingsService {
  const runtimeSettings = deps.settings ?? defaultSettings;
  const currentTime = deps.now ?? (() => new Date());

  async function readProfileAccess(actor: AuthActor) {
    const human = requireHumanActor(actor);
    const access = await deps.repository.findUserProfileAccessRecord({
      workspaceId: human.workspaceId,
      userId: human.userId
    });
    if (!access) {
      throw profileAccessDenied();
    }
    return { human, access };
  }

  async function readGovernanceAccess(actor: AuthActor, projectId: string) {
    const human = requireHumanActor(actor);
    const access = await deps.repository.findProjectGovernanceAccessRecord({
      workspaceId: human.workspaceId,
      projectId,
      actorUserId: human.userId
    });
    if (!access) {
      throw governanceNotFound();
    }
    return { human, access };
  }

  async function readBudgetSummary(input: {
    human: HumanAiSettingsActor;
    generatedAt: Date;
  }): Promise<AiBudgetSummaryVM> {
    const settings = tenantSettings(runtimeSettings, input.human);
    const [snapshots, budgetPolicies] = await Promise.all([
      deps.ledger.usageSnapshots(
        { userId: input.human.userId, teamId: input.human.workspaceId },
        { now: input.generatedAt }
      ),
      deps.policies.listPolicies(settings)
    ]);
    const dailyPolicy = budgetPolicies.find((policy) =>
      policy.id === "pcost-user-day-v0"
      && policy.scopeKind === "user"
      && policy.period === "day"
    );
    return parseOutputContract(aiBudgetSummaryVmSchema, {
      daily_quota: dailyPolicy
        ? {
            policy_id: dailyPolicy.id,
            period: "day",
            max_tokens: dailyPolicy.maxTokens,
            max_cost_cny: dailyPolicy.maxCostCny,
            enabled: dailyPolicy.enabled
          }
        : null,
      usage: {
        day: usageView(snapshots, input.human.userId, "day"),
        month: usageView(snapshots, input.human.userId, "month")
      }
    }, "ai-settings.budget-summary");
  }

  function buildProfileView(input: {
    human: HumanAiSettingsActor;
    profile: UserAiProfileRow | null;
    providers: ReturnType<typeof providerView>;
    budgetSummary: AiBudgetSummaryVM;
    generatedAt: Date;
  }) {
    const profile = input.profile;
    return parseOutputContract(userAiProfileVmSchema, {
      workspace_id: input.human.workspaceId,
      user_id: input.human.userId,
      default_mode: profile?.defaultMode ?? DEFAULT_USER_AI_PROFILE.default_mode,
      granular_settings: {
        ...(profile?.granularJson ?? DEFAULT_USER_AI_PROFILE.granular_settings)
      },
      dispatch_policy: profile?.dispatchPolicy ?? DEFAULT_USER_AI_PROFILE.dispatch_policy,
      cuu_proactivity: profile?.cuuProactivity ?? DEFAULT_USER_AI_PROFILE.cuu_proactivity,
      model_tier_preference: profile?.modelTierPref ?? DEFAULT_USER_AI_PROFILE.model_tier_preference,
      providers: input.providers,
      budget_summary: input.budgetSummary,
      generated_at: input.generatedAt.toISOString(),
      updated_at: profile?.updatedAt.toISOString() ?? null
    }, "ai-settings.profile");
  }

  function governanceView(projectId: string, row: ProjectAiGovernanceRow | null) {
    return parseOutputContract(projectAiGovernanceVmSchema, {
      project_id: projectId,
      observer_enabled: row?.observerEnabled ?? DEFAULT_PROJECT_AI_GOVERNANCE.observer_enabled,
      silence_window_seconds: row?.silenceWindowSecs ?? DEFAULT_PROJECT_AI_GOVERNANCE.silence_window_seconds,
      quiet_hours: row?.quietHoursJson ?? { ...DEFAULT_PROJECT_AI_GOVERNANCE.quiet_hours },
      granular_settings: {
        ...(row?.granularJson ?? DEFAULT_PROJECT_AI_GOVERNANCE.granular_settings)
      },
      // R14 批 RISK：读侧完整默认值合并输出（非 partial）——DB 列缺省是 '{}'::jsonb，与
      // DEFAULT_RISK_MONITOR_SETTINGS 合并后每个键都有值，供设置 UI 直接展示当前生效阈值。
      risk_monitor: {
        ...DEFAULT_RISK_MONITOR_SETTINGS,
        ...(row?.riskMonitorJson ?? {})
      },
      updated_at: row?.updatedAt.toISOString() ?? null
    }, "ai-settings.project-governance");
  }

  return {
    async assertUserProfileAccess({ actor }) {
      await readProfileAccess(actor);
    },

    async getUserProfile({ actor }) {
      const { human, access } = await readProfileAccess(actor);
      const generatedAt = currentTime();
      const metadata = deps.providers.publicMetadata();
      const providers = providerView(metadata);
      const budgetSummary = await readBudgetSummary({ human, generatedAt });
      return buildProfileView({
        human,
        profile: access.profile,
        providers,
        budgetSummary,
        generatedAt
      });
    },

    async patchUserProfile({ actor, payload }) {
      const human = requireHumanActor(actor);
      const metadata = deps.providers.publicMetadata();
      const providers = providerView(metadata);
      if (
        payload.model_tier_preference !== undefined
        && payload.model_tier_preference !== null
        && !modelIdAllowlist(metadata).has(payload.model_tier_preference)
      ) {
        throw unavailableModelPreference();
      }
      const generatedAt = currentTime();
      const budgetSummary = await readBudgetSummary({ human, generatedAt });
      let validatedView: UserAiProfileVM | undefined;
      try {
        await deps.repository.upsertUserProfile({
          workspaceId: human.workspaceId,
          userId: human.userId,
          patch: {
            ...(payload.default_mode !== undefined ? { defaultMode: payload.default_mode } : {}),
            ...(payload.granular_settings !== undefined
              ? { granularJson: { ...payload.granular_settings } }
              : {}),
            ...(payload.dispatch_policy !== undefined ? { dispatchPolicy: payload.dispatch_policy } : {}),
            ...(payload.cuu_proactivity !== undefined ? { cuuProactivity: payload.cuu_proactivity } : {}),
            ...(payload.model_tier_preference !== undefined
              ? { modelTierPref: payload.model_tier_preference }
              : {})
          },
          at: generatedAt,
          validateWritten(row) {
            validatedView = buildProfileView({
              human,
              profile: row,
              providers,
              budgetSummary,
              generatedAt
            });
          }
        });
      } catch (error) {
        if (error instanceof AiSettingsAccessDeniedError) {
          throw profileAccessDenied();
        }
        throw error;
      }
      return requireValidatedWriteView(validatedView, "user AI profile");
    },

    async assertProjectGovernanceAccess({ actor, projectId }) {
      await readGovernanceAccess(actor, projectId);
    },

    async getProjectGovernance({ actor, projectId }) {
      const { access } = await readGovernanceAccess(actor, projectId);
      return governanceView(projectId, access.governance);
    },

    async patchProjectGovernance({ actor, projectId, payload }) {
      const human = requireHumanActor(actor);
      const at = currentTime();
      let validatedView: ProjectAiGovernanceVM | undefined;
      try {
        await deps.repository.upsertProjectGovernance({
          workspaceId: human.workspaceId,
          projectId,
          actorUserId: human.userId,
          patch: {
            ...(payload.observer_enabled !== undefined ? { observerEnabled: payload.observer_enabled } : {}),
            ...(payload.silence_window_seconds !== undefined
              ? { silenceWindowSecs: payload.silence_window_seconds }
              : {}),
            ...(payload.quiet_hours !== undefined
              ? { quietHoursJson: copyQuietHours(payload.quiet_hours) }
              : {}),
            ...(payload.granular_settings !== undefined
              ? { granularJson: { ...payload.granular_settings } }
              : {}),
            ...(payload.risk_monitor !== undefined
              ? { riskMonitorJson: { ...payload.risk_monitor } }
              : {})
          },
          at,
          validateWritten(row) {
            validatedView = governanceView(projectId, row);
          }
        });
      } catch (error) {
        if (error instanceof AiSettingsAccessDeniedError) {
          throw governanceNotFound();
        }
        throw error;
      }
      return requireValidatedWriteView(validatedView, "project AI governance");
    }
  };
}

let defaultDbClient: WorkHubDatabaseClient | undefined;
let defaultAiSettingsService: AiSettingsService | undefined;

export function getDefaultAiSettingsService(): AiSettingsService {
  if (!defaultAiSettingsService) {
    defaultDbClient = getSharedDatabaseClient();
    defaultAiSettingsService = createAiSettingsService({
      repository: createAiSettingsRepository(defaultDbClient.db),
      providers: getDefaultProviderRegistry(),
      ledger: getDefaultCostLedgerStore(),
      policies: getDefaultBudgetPolicyStore(),
      settings: defaultSettings
    });
  }
  return defaultAiSettingsService;
}
