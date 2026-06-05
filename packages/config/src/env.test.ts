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
  assert.equal(value.budgets.runTokens, 120000);
  assert.equal(value.budgets.teamMonthlyCostCny, "2000");
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
      COOKIE_SECRET: "strong-secret",
      COOKIE_SECURE: "true",
      CORS_ALLOW_ORIGINS: "*"
    })
  );
});

test("fails closed for memory broker with multiple production workers", () => {
  assert.throws(() =>
    loadSettings({
      APP_ENV: "production",
      COOKIE_SECRET: "strong-secret",
      COOKIE_SECURE: "true",
      CORS_ALLOW_ORIGINS: "http://localhost:5173",
      WORKER_COUNT: "2",
      BROKER_BACKEND: "memory"
    })
  );
});

test("fails closed for insecure production cookies", () => {
  assert.throws(() =>
    loadSettings({
      APP_ENV: "production",
      COOKIE_SECRET: "strong-secret",
      CORS_ALLOW_ORIGINS: "http://localhost:5173",
      COOKIE_SECURE: "false"
    })
  );
});
