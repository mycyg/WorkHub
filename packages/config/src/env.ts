import { z } from "zod";

import { authDefaults } from "./auth.js";

type EnvInput = Record<string, string | undefined>;

const emptyToUndefined = (value: unknown) => {
  if (value === "") {
    return undefined;
  }
  return value;
};

const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const cnyString = z.string().regex(/^\d+(\.\d+)?$/, "Expected a numeric CNY string");
const booleanString = z.preprocess((value) => {
  if (value === undefined || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    return value;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return value;
}, z.boolean());

export const brokerBackendSchema = z.enum(["memory", "redis", "pg_listen"]);
export type BrokerBackend = z.infer<typeof brokerBackendSchema>;

export const envSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8787),
  API_HOST: z.string().min(1).default("127.0.0.1"),
  WORKER_COUNT: z.coerce.number().int().positive().default(1),
  LOG_FORMAT: z.enum(["json", "pretty"]).default("json"),

  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgresql+psycopg://workhub:workhub@127.0.0.1:5432/workhub"),
  DATA_DIR: z.string().min(1).default("./data"),
  DOWNLOADS_DIR: optionalString,
  WEB_DIST_DIR: optionalString,

  DB_POOL_SIZE: z.coerce.number().int().positive().default(5),
  DB_MAX_OVERFLOW: z.coerce.number().int().min(0).default(10),
  DB_POOL_TIMEOUT: z.coerce.number().int().positive().default(30),

  BROKER_BACKEND: brokerBackendSchema.default("memory"),
  BROKER_URL: z.string().default(""),

  COOKIE_SECRET: z.string().default("dev-change-me"),
  COOKIE_SECURE: booleanString.default(false),
  ADMIN_CLAIM_SECRET: z.string().default(""),
  CORS_ALLOW_ORIGINS: z.string().default("*"),
  TOUCH_DEVICE_ON_AUTH: booleanString.default(true),
  DEFAULT_ORG_ID: z.string().uuid().default(authDefaults.defaultOrgId),
  DEFAULT_WORKSPACE_ID: z.string().uuid().default(authDefaults.defaultWorkspaceId),

  // findings[#33/M39]：只约束到真正注册的 provider（createProviderRegistryConfig 仅注册 "deepseek"）。
  // 此前任意字符串都收，配错(如 "openai")要到运行时找不到路由才炸；改 enum 后启动解析即 fail-closed。
  // 加新 provider 时这里与 providers.ts 注册表同步更新——刻意如此。
  LLM_PROVIDER_DEFAULT: z.enum(["deepseek"]).default("deepseek"),
  LLM_BASE_URL: z.string().url().default("https://api.deepseek.com/anthropic"),
  LLM_MODEL: z.string().min(1).default("deepseek-v4-flash"),
  LLM_API_KEY: z.string().default(""),
  LLM_MAX_TOKENS_PER_STEP: z.coerce.number().int().positive().max(64000).default(8192),

  PROVIDER_DEEPSEEK_BASE_URL: z.string().url().default("https://api.deepseek.com/anthropic"),
  PROVIDER_DEEPSEEK_MODEL: z.string().min(1).default("deepseek-v4-flash"),
  PROVIDER_DEEPSEEK_COST_INPUT_CNY_PER_MTOK: z.coerce.number().min(0).default(2),
  PROVIDER_DEEPSEEK_COST_OUTPUT_CNY_PER_MTOK: z.coerce.number().min(0).default(8),

  BUDGET_DEFAULT_RUN_TOKENS: z.coerce.number().int().positive().default(120000),
  BUDGET_DEFAULT_USER_DAILY_TOKENS: z.coerce.number().int().positive().default(500000),
  BUDGET_DEFAULT_TEAM_DAILY_TOKENS: z.coerce.number().int().positive().default(5000000),
  BUDGET_DEFAULT_TEAM_MONTHLY_TOKENS: z.coerce.number().int().positive().default(50000000),
  // eval（夜间/发布评测套件）日预算：此前 eval 在决策层无任何策略=无上限，跑飞的套件可无限烧钱。
  BUDGET_DEFAULT_EVAL_DAILY_TOKENS: z.coerce.number().int().positive().default(2000000),
  BUDGET_DEFAULT_RUN_COST_CNY: cnyString.default("5"),
  BUDGET_DEFAULT_USER_DAILY_COST_CNY: cnyString.default("20"),
  BUDGET_DEFAULT_TEAM_DAILY_COST_CNY: cnyString.default("200"),
  BUDGET_DEFAULT_TEAM_MONTHLY_COST_CNY: cnyString.default("2000"),
  BUDGET_DEFAULT_EVAL_DAILY_COST_CNY: cnyString.default("80"),
  // 夜间技能蒸馏(curation)日花费上限：当日 curation 花费超过即整轮跳过，防 interval 配错/跑飞无限烧钱。
  BUDGET_DEFAULT_CURATION_DAILY_COST_CNY: cnyString.default("40"),

  AGENT_RUN_LEASE_MS: z.coerce.number().int().positive().default(300000),
  AGENT_RUN_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(0).default(0),
  AGENT_RUN_RECOVERY_INTERVAL_MS: z.coerce.number().int().min(0).default(30000),
  // 一条 run 因租约过期被恢复（requeue）的最大次数；超过即转入死信 failed，不再无限重跑。
  AGENT_RUN_MAX_RECOVER_ATTEMPTS: z.coerce.number().int().positive().default(3),
  // 默认 false：run_command 默认 fail-closed（不执行宿主命令）。仅在受信本地/单机环境显式置 true，
  // 才把无约束 nodeCommandRunner 接进 agent 循环（白名单解释器但不隔离，可访问宿主路径）。
  // 多租户/生产环境应保持 false，并由部署方注入真正隔离的 commandRunner。
  AGENT_RUN_ALLOW_UNSANDBOXED_COMMANDS: booleanString.default(false),
  AGENT_RUN_SKILL_CURATION_ENABLED: booleanString.default(false),
  AGENT_RUN_SKILL_CURATION_INTERVAL_MS: z.coerce.number().int().min(0).default(86400000),
  AGENT_RUN_PROJECT_HYDRATE_ENABLED: booleanString.default(false),
  AGENT_RUN_PROJECT_HYDRATE_MAX_FILES: z.coerce.number().int().positive().default(200),
  AGENT_RUN_PROJECT_HYDRATE_MAX_BYTES: z.coerce.number().int().positive().default(33554432)
});

type ParsedEnv = z.infer<typeof envSchema>;

export type Settings = {
  appEnv: ParsedEnv["APP_ENV"];
  port: number;
  apiHost: string;
  logFormat: "json" | "pretty";
  workerCount: number;
  databaseUrl: string;
  dataDir: string;
  downloadsDir: string;
  webDistDir?: string;
  db: {
    poolSize: number;
    maxOverflow: number;
    poolTimeout: number;
  };
  broker: {
    backend: BrokerBackend;
    url: string;
  };
  auth: {
    cookieSecret: string;
    cookieSecure: boolean;
    adminClaimSecret: string;
    corsAllowOrigins: string[];
    touchDeviceOnAuth: boolean;
    defaultOrgId: string;
    defaultWorkspaceId: string;
  };
  llm: {
    defaultProvider: string;
    baseUrl: string;
    model: string;
    apiKey: string;
    maxTokensPerStep: number;
  };
  providers: {
    deepseek: {
      baseUrl: string;
      model: string;
      costInputCnyPerMtok: number;
      costOutputCnyPerMtok: number;
    };
  };
  budgets: {
    runTokens: number;
    userDailyTokens: number;
    teamDailyTokens: number;
    teamMonthlyTokens: number;
    evalDailyTokens: number;
    runCostCny: string;
    userDailyCostCny: string;
    teamDailyCostCny: string;
    teamMonthlyCostCny: string;
    evalDailyCostCny: string;
    curationDailyCostCny: string;
  };
  agentRun: {
    leaseMs: number;
    heartbeatIntervalMs?: number;
    recoveryIntervalMs: number;
    maxRecoverAttempts: number;
    allowUnsandboxedCommands: boolean;
    skillCurationEnabled: boolean;
    skillCurationIntervalMs: number;
    projectHydrateEnabled: boolean;
    projectHydrateMaxFiles: number;
    projectHydrateMaxBytes: number;
  };
};

const parseCorsOrigins = (value: string) =>
  value
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

export function loadSettings(env: EnvInput = process.env): Settings {
  const parsed = envSchema.parse(env);
  const settings: Settings = {
    appEnv: parsed.APP_ENV,
    port: parsed.PORT,
    apiHost: parsed.API_HOST,
    logFormat: parsed.LOG_FORMAT,
    workerCount: parsed.WORKER_COUNT,
    databaseUrl: parsed.DATABASE_URL,
    dataDir: parsed.DATA_DIR,
    downloadsDir: parsed.DOWNLOADS_DIR ?? `${parsed.DATA_DIR}/downloads`,
    db: {
      poolSize: parsed.DB_POOL_SIZE,
      maxOverflow: parsed.DB_MAX_OVERFLOW,
      poolTimeout: parsed.DB_POOL_TIMEOUT
    },
    broker: {
      backend: parsed.BROKER_BACKEND,
      url: parsed.BROKER_URL
    },
    auth: {
      cookieSecret: parsed.COOKIE_SECRET,
      cookieSecure: parsed.COOKIE_SECURE,
      adminClaimSecret: parsed.ADMIN_CLAIM_SECRET,
      corsAllowOrigins: parseCorsOrigins(parsed.CORS_ALLOW_ORIGINS),
      touchDeviceOnAuth: parsed.TOUCH_DEVICE_ON_AUTH,
      defaultOrgId: parsed.DEFAULT_ORG_ID,
      defaultWorkspaceId: parsed.DEFAULT_WORKSPACE_ID
    },
    llm: {
      defaultProvider: parsed.LLM_PROVIDER_DEFAULT,
      baseUrl: parsed.LLM_BASE_URL,
      model: parsed.LLM_MODEL,
      apiKey: parsed.LLM_API_KEY,
      maxTokensPerStep: parsed.LLM_MAX_TOKENS_PER_STEP
    },
    providers: {
      deepseek: {
        baseUrl: parsed.PROVIDER_DEEPSEEK_BASE_URL,
        model: parsed.PROVIDER_DEEPSEEK_MODEL,
        costInputCnyPerMtok: parsed.PROVIDER_DEEPSEEK_COST_INPUT_CNY_PER_MTOK,
        costOutputCnyPerMtok: parsed.PROVIDER_DEEPSEEK_COST_OUTPUT_CNY_PER_MTOK
      }
    },
    budgets: {
      runTokens: parsed.BUDGET_DEFAULT_RUN_TOKENS,
      userDailyTokens: parsed.BUDGET_DEFAULT_USER_DAILY_TOKENS,
      teamDailyTokens: parsed.BUDGET_DEFAULT_TEAM_DAILY_TOKENS,
      teamMonthlyTokens: parsed.BUDGET_DEFAULT_TEAM_MONTHLY_TOKENS,
      evalDailyTokens: parsed.BUDGET_DEFAULT_EVAL_DAILY_TOKENS,
      runCostCny: parsed.BUDGET_DEFAULT_RUN_COST_CNY,
      userDailyCostCny: parsed.BUDGET_DEFAULT_USER_DAILY_COST_CNY,
      teamDailyCostCny: parsed.BUDGET_DEFAULT_TEAM_DAILY_COST_CNY,
      teamMonthlyCostCny: parsed.BUDGET_DEFAULT_TEAM_MONTHLY_COST_CNY,
      evalDailyCostCny: parsed.BUDGET_DEFAULT_EVAL_DAILY_COST_CNY,
      curationDailyCostCny: parsed.BUDGET_DEFAULT_CURATION_DAILY_COST_CNY
    },
    agentRun: {
      leaseMs: parsed.AGENT_RUN_LEASE_MS,
      ...(parsed.AGENT_RUN_HEARTBEAT_INTERVAL_MS > 0
        ? { heartbeatIntervalMs: parsed.AGENT_RUN_HEARTBEAT_INTERVAL_MS }
        : {}),
      recoveryIntervalMs: parsed.AGENT_RUN_RECOVERY_INTERVAL_MS,
      maxRecoverAttempts: parsed.AGENT_RUN_MAX_RECOVER_ATTEMPTS,
      allowUnsandboxedCommands: parsed.AGENT_RUN_ALLOW_UNSANDBOXED_COMMANDS,
      skillCurationEnabled: parsed.AGENT_RUN_SKILL_CURATION_ENABLED,
      skillCurationIntervalMs: parsed.AGENT_RUN_SKILL_CURATION_INTERVAL_MS,
      projectHydrateEnabled: parsed.AGENT_RUN_PROJECT_HYDRATE_ENABLED,
      projectHydrateMaxFiles: parsed.AGENT_RUN_PROJECT_HYDRATE_MAX_FILES,
      projectHydrateMaxBytes: parsed.AGENT_RUN_PROJECT_HYDRATE_MAX_BYTES
    }
  };

  if (parsed.WEB_DIST_DIR) {
    settings.webDistDir = parsed.WEB_DIST_DIR;
  }

  validateRuntimeConfig(settings);
  return settings;
}

export function validateRuntimeConfig(value: Settings) {
  if (value.appEnv !== "production") {
    return;
  }

  if (value.auth.cookieSecret === "dev-change-me") {
    throw new Error("COOKIE_SECRET must be changed in production");
  }

  // .default() only fires on undefined, so "" or a short value would otherwise pass — a weak/empty
  // cookie secret makes identity cookies forgeable. Require real entropy in production.
  if (value.auth.cookieSecret.length < 32) {
    throw new Error("COOKIE_SECRET must be at least 32 characters in production");
  }

  // The admin-claim secret is the only privileged-account boundary; an empty default must not pass in prod.
  if (value.auth.adminClaimSecret.length < 16) {
    throw new Error("ADMIN_CLAIM_SECRET must be set (>=16 chars) in production");
  }

  if (!value.auth.cookieSecure) {
    throw new Error("COOKIE_SECURE must be true in production");
  }

  if (value.auth.corsAllowOrigins.includes("*")) {
    throw new Error("CORS_ALLOW_ORIGINS cannot include * in production");
  }

  if (value.workerCount > 1 && value.broker.backend === "memory") {
    throw new Error("BROKER_BACKEND=memory cannot be used with multiple workers in production");
  }

  if (value.broker.backend !== "memory" && value.broker.url.length === 0) {
    throw new Error("BROKER_URL is required when BROKER_BACKEND is not memory");
  }
}

export const settings = loadSettings();
