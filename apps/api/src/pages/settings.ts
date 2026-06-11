import { workHubLocaleStorageKey, workHubLocales, type SettingsPageVM, type WorkHubLocale } from "@workhub/contracts";
import type { Settings } from "@workhub/config";

type SettingsPageInput = {
  settings: Settings;
  locale: WorkHubLocale;
  generatedAt?: Date;
};

export function buildSettingsPage(input: SettingsPageInput): SettingsPageVM {
  return {
    generated_at: (input.generatedAt ?? new Date()).toISOString(),
    locale: input.locale,
    runtime: {
      app_env: input.settings.appEnv,
      worker_count: input.settings.workerCount,
      broker_backend: input.settings.broker.backend,
      broker_configured: input.settings.broker.backend === "memory" || input.settings.broker.url.length > 0,
      database_configured: input.settings.databaseUrl.length > 0,
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
      supported_locales: [...workHubLocales],
      storage_key: workHubLocaleStorageKey
    },
    device: {
      desktop_client: "tauri",
      local_execution_boundary: true,
      independent_pet_window: true,
      pet_model_settings_in_web: false,
      restore_href: "/settings?panel=desktop"
    }
  };
}
