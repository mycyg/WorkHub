import assert from "node:assert/strict";
import test from "node:test";

import { loadSettings } from "./env.js";
import { createProviderRegistryConfig, toPublicProviderConfig } from "./providers.js";

test("defaults are portable and PostgreSQL-first", () => {
  const value = loadSettings({});

  assert.equal(value.databaseUrl.startsWith("postgresql+psycopg://"), true);
  assert.equal(value.dataDir, "./data");
  assert.equal(value.downloadsDir, "./data/downloads");
  assert.equal(value.auth.cookieSecure, false);
  assert.equal(value.auth.touchDeviceOnAuth, true);
  assert.equal(value.auth.defaultWorkspaceId, "00000000-0000-4000-8000-000000000002");
  assert.equal(JSON.stringify(value).includes("/srv/yqgl"), false);
});

test("keeps provider and budget defaults available", () => {
  const value = loadSettings({});

  assert.equal(value.llm.defaultProvider, "deepseek");
  assert.equal(value.providers.deepseek.model, "deepseek-v4-flash");
  assert.equal(value.providers.deepseek.costInputCnyPerMtok, 2);
  assert.equal(value.providers.deepseek.costOutputCnyPerMtok, 8);
  assert.equal(value.budgets.runTokens, 120000);
  assert.equal(value.budgets.teamMonthlyCostCny, "2000");
  assert.equal(value.agentRun.leaseMs, 300000);
  assert.equal(value.agentRun.heartbeatIntervalMs, undefined);
  assert.equal(value.agentRun.recoveryIntervalMs, 30000);
  assert.equal(value.agentRun.projectHydrateEnabled, true);
});

test("R14 批 GH: GITHUB_TOKEN_ENC_KEY defaults empty (feature unconfigured) and passes through verbatim when set", () => {
  // 默认空串=未配置 GH 加密密钥：绑定端点 fail-closed 503，轮询 worker 空转（见 07-gh-design §1.1）。
  assert.equal(loadSettings({}).github.tokenEncKey, "");
  // 显式配置时逐字节透传，不做任何解码/校验（长度校验在 secret-box 建箱时做，见 secret-box.ts）。
  const key = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
  assert.equal(loadSettings({ GITHUB_TOKEN_ENC_KEY: key }).github.tokenEncKey, key);
  // 密钥不得意外出现在与 LLM/COOKIE 无关的字段里——它只落在 github.tokenEncKey 这一处。
  const serialized = JSON.stringify(loadSettings({ GITHUB_TOKEN_ENC_KEY: key }));
  assert.equal((serialized.match(new RegExp(key, "g")) ?? []).length, 1);
});

test("findings[#33] LLM_PROVIDER_DEFAULT is constrained to registered providers (fail-closed at parse)", () => {
  // 默认/显式 "deepseek" 通过，且确实在注册表里。
  assert.equal(loadSettings({ LLM_PROVIDER_DEFAULT: "deepseek" }).llm.defaultProvider, "deepseek");
  assert.equal("deepseek" in createProviderRegistryConfig(loadSettings({})).providers, true);
  // 未注册的 provider 在启动解析时就被拒，而不是到运行时找不到路由才炸。
  assert.throws(() => loadSettings({ LLM_PROVIDER_DEFAULT: "openai" }));
});

test("agent run runtime intervals are configurable without serializing secrets", () => {
  const value = loadSettings({
    AGENT_RUN_LEASE_MS: "600000",
    AGENT_RUN_HEARTBEAT_INTERVAL_MS: "15000",
    AGENT_RUN_RECOVERY_INTERVAL_MS: "45000"
  });

  assert.equal(value.agentRun.leaseMs, 600000);
  assert.equal(value.agentRun.heartbeatIntervalMs, 15000);
  assert.equal(value.agentRun.recoveryIntervalMs, 45000);
});

test("project drive hydration is on by default and can be explicitly disabled", () => {
  assert.equal(loadSettings({}).agentRun.projectHydrateEnabled, true);
  assert.equal(loadSettings({ AGENT_RUN_PROJECT_HYDRATE_ENABLED: "false" }).agentRun.projectHydrateEnabled, false);
});

test("R15 批 D: proactivity + ddl-chase settings have sensible defaults and are overridable", () => {
  const defaults = loadSettings({});
  // 追 DDL 巡检默认 30 分钟；静默时段默认 22:00–08:00；每人每日上限默认 10。
  assert.equal(defaults.pulse.ddlChaseIntervalMs, 1800000);
  assert.equal(defaults.proactive.quietHours, "22-08");
  assert.equal(defaults.proactive.dailyCapPerUser, 10);

  const overridden = loadSettings({
    PULSE_DDL_CHASE_INTERVAL_MS: "600000",
    PROACTIVE_QUIET_HOURS: "23-07",
    PROACTIVE_DAILY_CAP_PER_USER: "3"
  });
  assert.equal(overridden.pulse.ddlChaseIntervalMs, 600000);
  assert.equal(overridden.proactive.quietHours, "23-07");
  assert.equal(overridden.proactive.dailyCapPerUser, 3);

  // 间隔置 0 = 不挂定时器（沿用其他 pulse 任务的 min(0) 语义）；空静默串 = 不启用静默。
  assert.equal(loadSettings({ PULSE_DDL_CHASE_INTERVAL_MS: "0" }).pulse.ddlChaseIntervalMs, 0);
  assert.equal(loadSettings({ PROACTIVE_QUIET_HOURS: "" }).proactive.quietHours, "");
});

test("R15 批 F: care-scan settings have sensible defaults and are overridable", () => {
  const defaults = loadSettings({});
  // 关怀扫描默认 6 小时一 tick；周频总闸默认 2；三类信号阈值默认 8/3/2。
  assert.equal(defaults.pulse.careScanIntervalMs, 21600000);
  assert.equal(defaults.proactive.careWeeklyCap, 2);
  assert.equal(defaults.proactive.careHighLoadThreshold, 8);
  assert.equal(defaults.proactive.careLateNightMinNights, 3);
  assert.equal(defaults.proactive.careFrustrationThreshold, 2);

  const overridden = loadSettings({
    PULSE_CARE_SCAN_INTERVAL_MS: "3600000",
    PROACTIVE_CARE_WEEKLY_CAP: "1",
    PROACTIVE_CARE_HIGH_LOAD_THRESHOLD: "12",
    PROACTIVE_CARE_LATE_NIGHT_MIN_NIGHTS: "4",
    PROACTIVE_CARE_FRUSTRATION_THRESHOLD: "3"
  });
  assert.equal(overridden.pulse.careScanIntervalMs, 3600000);
  assert.equal(overridden.proactive.careWeeklyCap, 1);
  assert.equal(overridden.proactive.careHighLoadThreshold, 12);
  assert.equal(overridden.proactive.careLateNightMinNights, 4);
  assert.equal(overridden.proactive.careFrustrationThreshold, 3);

  // 间隔置 0 = 不挂定时器（关掉关怀）。
  assert.equal(loadSettings({ PULSE_CARE_SCAN_INTERVAL_MS: "0" }).pulse.careScanIntervalMs, 0);
});

test("provider registry config keeps API keys out of public metadata", () => {
  const value = loadSettings({
    LLM_API_KEY: "secret-key",
    PROVIDER_DEEPSEEK_COST_INPUT_CNY_PER_MTOK: "1.5",
    PROVIDER_DEEPSEEK_COST_OUTPUT_CNY_PER_MTOK: "3"
  });
  const registry = createProviderRegistryConfig(value);
  const deepseek = registry.providers.deepseek;
  assert.ok(deepseek);
  const publicDeepseek = toPublicProviderConfig(deepseek);

  assert.equal(deepseek.apiKey, "secret-key");
  assert.equal(publicDeepseek.configured, true);
  assert.equal(JSON.stringify(publicDeepseek).includes("secret-key"), false);
  assert.equal(publicDeepseek.models.default?.costOutputCnyPerMtok, 3);
});

test("LLM_MODEL selects the default provider model when no provider override is set", () => {
  const value = loadSettings({
    LLM_MODEL: "deepseek-v4-pro"
  });
  const registry = createProviderRegistryConfig(value);

  assert.equal(value.llm.model, "deepseek-v4-pro");
  assert.equal(value.providers.deepseek.model, "deepseek-v4-pro");
  assert.equal(registry.providers.deepseek?.models.default?.model, "deepseek-v4-pro");
});

test("LLM_BASE_URL is the DeepSeek provider base URL unless provider URL is explicitly set", () => {
  const inherited = loadSettings({
    LLM_BASE_URL: "https://proxy.example/anthropic"
  });
  const overridden = loadSettings({
    LLM_BASE_URL: "https://proxy.example/anthropic",
    PROVIDER_DEEPSEEK_BASE_URL: "https://deepseek.internal/anthropic"
  });

  assert.equal(inherited.providers.deepseek.baseUrl, "https://proxy.example/anthropic");
  assert.equal(createProviderRegistryConfig(inherited).providers.deepseek?.baseUrl, "https://proxy.example/anthropic");
  assert.equal(overridden.providers.deepseek.baseUrl, "https://deepseek.internal/anthropic");
  assert.equal(createProviderRegistryConfig(overridden).providers.deepseek?.baseUrl, "https://deepseek.internal/anthropic");
});

test("fails closed for weak production cookie secret", () => {
  assert.throws(() =>
    loadSettings({
      APP_ENV: "production",
      CORS_ALLOW_ORIGINS: "http://localhost:5173"
    })
  );
});

test("fails closed for wildcard CORS in production", () => {
  assert.throws(() =>
    loadSettings({
      APP_ENV: "production",
      COOKIE_SECRET: "strong-secret-strong-secret-1234", ADMIN_CLAIM_SECRET: "admin-secret-123456",
      COOKIE_SECURE: "true",
      CORS_ALLOW_ORIGINS: "*"
    })
  );
});

test("fails closed for memory broker with multiple production workers", () => {
  assert.throws(() =>
    loadSettings({
      APP_ENV: "production",
      COOKIE_SECRET: "strong-secret-strong-secret-1234", ADMIN_CLAIM_SECRET: "admin-secret-123456",
      COOKIE_SECURE: "true",
      CORS_ALLOW_ORIGINS: "http://localhost:5173",
      WORKER_COUNT: "2",
      BROKER_BACKEND: "memory"
    })
  );
});

test("allows redis broker for multiple production workers when url is configured", () => {
  const value = loadSettings({
    APP_ENV: "production",
    COOKIE_SECRET: "strong-secret-strong-secret-1234", ADMIN_CLAIM_SECRET: "admin-secret-123456",
    COOKIE_SECURE: "true",
    CORS_ALLOW_ORIGINS: "http://localhost:5173",
    WORKER_COUNT: "2",
    BROKER_BACKEND: "redis",
    BROKER_URL: "redis://127.0.0.1:6379"
  });

  assert.equal(value.broker.backend, "redis");
  assert.equal(value.broker.url, "redis://127.0.0.1:6379");
});

test("requires broker url for non-memory production broker", () => {
  assert.throws(() =>
    loadSettings({
      APP_ENV: "production",
      COOKIE_SECRET: "strong-secret-strong-secret-1234", ADMIN_CLAIM_SECRET: "admin-secret-123456",
      COOKIE_SECURE: "true",
      CORS_ALLOW_ORIGINS: "http://localhost:5173",
      BROKER_BACKEND: "redis"
    })
  );
});

test("fails closed for insecure production cookies", () => {
  assert.throws(() =>
    loadSettings({
      APP_ENV: "production",
      COOKIE_SECRET: "strong-secret-strong-secret-1234", ADMIN_CLAIM_SECRET: "admin-secret-123456",
      CORS_ALLOW_ORIGINS: "http://localhost:5173",
      COOKIE_SECURE: "false"
    })
  );
});
