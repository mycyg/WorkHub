/**
 * 插件宿主子进程的环境变量白名单（R24-P 报告 6.2「权限模型」的硬约束落地）。
 *
 * 纪律：**白名单，不是黑名单**。`packages/tools/src/sandbox.ts` 的 sandboxEnv 是原样透传
 * 宿主 PATH 的软沙箱（那里自己注释了「不是安全边界」）；插件宿主里跑的是第三方代码，
 * 不能沿用那条口径。这里只放行进程能起来所必需的几个键，其余一律不给。
 *
 * 黑名单只是**兜底断言**：万一有人日后往白名单里加了危险键、或插件配置里塞了个
 * `*_API_KEY`，`buildPluginHostEnv` 直接抛错，而不是悄悄把凭据递出去。
 */

/** 子进程能看到的宿主环境变量键。加键要过 Agent Note，不能顺手加。 */
export const PLUGIN_HOST_ENV_ALLOWLIST = ["PATH", "HOME", "LANG", "LC_ALL", "TZ", "TMPDIR"] as const;

/**
 * 永不透传的键（兜底断言）。命中即抛错。
 * - `DATABASE_URL` / `REDIS_URL`：直连数据面，等于把整个多租户围栏交出去。
 * - `*_API_KEY` / `*_TOKEN` / `*_SECRET` / `*_PASSWORD` / `*_CREDENTIAL*`：凭据类。
 * - `COOKIE_SECRET` / `ADMIN_CLAIM_SECRET`：能伪造会话与管理员身份。
 */
export const PLUGIN_HOST_ENV_DENY_PATTERNS: RegExp[] = [
  /^DATABASE_URL$/u,
  /^REDIS_URL$/u,
  /^BROKER_URL$/u,
  /^COOKIE_SECRET$/u,
  /^ADMIN_CLAIM_SECRET$/u,
  /API_KEY/u,
  /SECRET/u,
  /TOKEN/u,
  /PASSWORD/u,
  /CREDENTIAL/u,
  /PRIVATE_KEY/u
];

export function isDeniedPluginHostEnvKey(key: string) {
  const upper = key.toUpperCase();
  return PLUGIN_HOST_ENV_DENY_PATTERNS.some((pattern) => pattern.test(upper));
}

export type BuildPluginHostEnvInput = {
  /** 宿主进程的 env（通常 `process.env`）。 */
  source: Record<string, string | undefined>;
  /** 插件路径清单，转成子进程读的 `WORKHUB_PLUGIN_PATHS`。 */
  pluginPaths: string[];
  /** 插件自己声明的配置键值（阶段 0 无来源，留口给阶段 1 的设置页）。 */
  pluginConfigEnv?: Record<string, string>;
};

/**
 * 组装子进程 env：白名单里存在的键 + `WORKHUB_PLUGIN_PATHS` + 插件配置键。
 * 任何一步命中黑名单直接抛错（fail-closed），绝不「跳过该键继续」。
 */
export function buildPluginHostEnv(input: BuildPluginHostEnvInput): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of PLUGIN_HOST_ENV_ALLOWLIST) {
    if (isDeniedPluginHostEnvKey(key)) {
      throw new Error(`plugin-host env allowlist contains a denied key: ${key}`);
    }
    const value = input.source[key];
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  for (const [key, value] of Object.entries(input.pluginConfigEnv ?? {})) {
    if (isDeniedPluginHostEnvKey(key)) {
      throw new Error(`plugin config may not set a credential-shaped env key: ${key}`);
    }
    if (PLUGIN_HOST_ENV_ALLOWLIST.includes(key as (typeof PLUGIN_HOST_ENV_ALLOWLIST)[number])) {
      throw new Error(`plugin config may not override a host env key: ${key}`);
    }
    env[key] = value;
  }
  env.WORKHUB_PLUGIN_PATHS = input.pluginPaths.join(",");
  // 宿主模块被单测 import 时不该起 RPC 循环，只有真被 spawn 成进程入口才置这个标志。
  env.WORKHUB_PLUGIN_HOST_ENTRY = "1";
  // 注意这里没有 NODE_OPTIONS：子进程不继承宿主的 --require/--import 注入。
  return env;
}

/**
 * 解析 `WORKHUB_PLUGIN_PATHS`：逗号分隔的**本地路径**。
 * 阶段 0 明令只支持本地路径——npm 包名 / git url / tarball 一律拒绝（报告第 5 节
 * 「阶段 0 硬约束」）。这里做的是形状判断，真实存在性由宿主加载时报错。
 */
export function parsePluginPaths(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  for (const entry of entries) {
    if (/^[a-z][a-z0-9+.-]*:/iu.test(entry)) {
      throw new Error(`WORKHUB_PLUGIN_PATHS only accepts local paths; refused: ${entry}`);
    }
    if (!entry.startsWith("/") && !entry.startsWith("./") && !entry.startsWith("../") && !entry.startsWith("~")) {
      throw new Error(`WORKHUB_PLUGIN_PATHS only accepts local paths; refused bare specifier: ${entry}`);
    }
  }
  return entries;
}
