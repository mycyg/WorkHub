import { settingsPageVmSchema, workHubLocaleStorageKey, workHubLocales, type SettingsPageVM, type WorkHubLocale } from "@workhub/contracts";
import type { Settings } from "@workhub/config";

import { parseOutputContract } from "./output-contract.js";
import type { ReadinessResult } from "../readiness.js";

type SettingsPageInput = {
  settings: Settings;
  readiness: ReadinessResult;
  locale: WorkHubLocale;
  preferenceLocale?: WorkHubLocale;
  preferenceSource?: "server" | "request" | "fallback";
  permissionPolicies?: Array<{
    id?: string;
    action_pattern: string;
    effect: "allow" | "deny" | "ask";
    learned_from_session: boolean;
    created_at: string;
  }>;
  generatedAt?: Date;
};

export function buildSettingsPage(input: SettingsPageInput): SettingsPageVM {
  const brokerConfigured = input.readiness.checks.broker?.ok === true;
  const databaseConfigured = input.readiness.checks.database?.ok === true;
  const preferenceLocale = input.preferenceLocale ?? input.locale;
  const preferenceSource = input.preferenceSource ?? (input.preferenceLocale ? "server" : "request");
  // findings[#79 同类]：返回前过 fail-closed 输出契约校验，VM 装配走样 → 500（不是甩给调用方 422）。
  return parseOutputContract(settingsPageVmSchema, {
    generated_at: (input.generatedAt ?? new Date()).toISOString(),
    locale: input.locale,
    ...(input.permissionPolicies
      ? {
        permission_policies: input.permissionPolicies
          .filter((policy): policy is typeof policy & { id: string } => Boolean(policy.id))
          .map((policy) => ({
            id: policy.id,
            action_pattern: policy.action_pattern,
            effect: policy.effect,
            learned_from_session: policy.learned_from_session,
            created_at: policy.created_at,
            revoke_href: `/api/permissions/${policy.id}`
          }))
      }
      : {}),
    runtime: {
      app_env: input.settings.appEnv,
      runtime_status: input.readiness.ready && brokerConfigured && databaseConfigured ? "ready" : "attention_needed",
      worker_count: input.settings.workerCount,
      broker_backend: input.settings.broker.backend,
      broker_configured: brokerConfigured,
      database_configured: databaseConfigured,
      agent_run_lease_ms: input.settings.agentRun.leaseMs,
      agent_run_recovery_interval_ms: input.settings.agentRun.recoveryIntervalMs
    },
    llm_runtime: {
      default_provider: input.settings.llm.defaultProvider,
      default_model: input.settings.llm.model,
      provider_count: Object.keys(input.settings.providers).length,
      api_key_configured: input.settings.llm.apiKey.length > 0,
      base_url_configured: input.settings.llm.baseUrl.length > 0
    },
    budgets: {
      run_tokens: input.settings.budgets.runTokens,
      user_daily_tokens: input.settings.budgets.userDailyTokens,
      team_daily_tokens: input.settings.budgets.teamDailyTokens,
      team_monthly_tokens: input.settings.budgets.teamMonthlyTokens,
      run_cost_cny: input.settings.budgets.runCostCny,
      user_daily_cost_cny: input.settings.budgets.userDailyCostCny,
      team_daily_cost_cny: input.settings.budgets.teamDailyCostCny,
      team_monthly_cost_cny: input.settings.budgets.teamMonthlyCostCny
    },
    language: {
      active_locale: input.locale,
      preference_locale: preferenceLocale,
      preference_source: preferenceSource,
      preference_synced: preferenceLocale === input.locale,
      supported_locales: [...workHubLocales],
      storage_key: workHubLocaleStorageKey,
      update_href: "/api/auth/preferences"
    },
    device: {
      desktop_client: "tauri",
      local_execution_boundary: true,
      independent_pet_window: true,
      pet_model_settings_in_web: false,
      restore_href: "/settings?panel=desktop",
      restore_requires_desktop: true,
      web_local_actions_enabled: false
    }
  }, "settings.page");
}
