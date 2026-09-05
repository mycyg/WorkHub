/**
 * MCP 服务器子进程的环境变量组装（设计稿 4.3 的密钥方案、4.4 第 1 条）。
 *
 * ## 白名单，不是黑名单
 *
 * 基座就是插件宿主那六个键（`PATH HOME LANG LC_ALL TZ TMPDIR`），其余一律不给。
 * 参考实现（deepseek-harness 的 `scrubbedParentEnv()`）用的是黑名单——过滤掉像凭据的键名、
 * 其余父进程环境全透传。WorkHub 已经明确否决过这条口径（`plugin-host/src/env.ts` 开头那段）：
 * 黑名单漏一个 `MY_COMPANY_PAT` 就把它全给出去了。
 *
 * 代价要说清：某些 MCP 服务器依赖 `HTTPS_PROXY` / `NO_PROXY` 才能出网。要加就**显式加进白名单
 * 并过一条 Agent Note**，不能顺手加。
 *
 * ## 凭据不落库：引用式密钥
 *
 * 服务器配置里的 `env`（`env_json`）过凭据形状黑名单，命中直接拒——于是那一列**结构性**存不进凭据。
 * 真要给服务器一份凭据，填的是**指针不是值**：`{"GITHUB_TOKEN": "WORKHUB_MCP_SECRET_GITHUB"}`，
 * API 进程在 spawn 时从**自己的** `process.env` 里取值注入子进程。运维方式与 `WORKHUB_PLUGIN_PATHS`、
 * `LLM_API_KEY` 完全一致，零新增的静态密钥面。
 *
 * **被引用的服务端变量必须带 `WORKHUB_MCP_SECRET_` 前缀**（设计稿只给了这个形状的例子，这里把它
 * 提成硬规则）。理由是这条规则不立，引用式密钥就成了一个绕过整个白名单的读 env 原语——
 * 管理员填一个指向 `COOKIE_SECRET` / `DATABASE_URL` / `LLM_API_KEY` 的引用，就能把 API 进程的任何
 * 环境变量递给第三方服务器。反过来也说明这条不能用凭据形状黑名单来兜：`WORKHUB_MCP_SECRET_GITHUB`
 * 自己就命中 `SECRET`。所以只能用「显式命名空间」来划：这个前缀底下的变量是运维专门为 MCP 服务器
 * 准备的，外面的一律不给。
 *
 * ## 引用不存在时 fail-closed
 *
 * 不拿空串起进程。起来了也只会在第一次调用时报一个远端的 401，比「这台服务器没配好」难查得多。
 *
 * 本模块零 IO：真实 `process.env` 由调用方读好传进来，这里只做组装与判定。
 */
import { isDeniedPluginHostEnvKey } from "@workhub/plugin-host";

/**
 * 子进程能看到的宿主环境变量键。加键要过 Agent Note，不能顺手加。
 * 与 `PLUGIN_HOST_ENV_ALLOWLIST` 同一份内容但**各自持有**：两边放行的东西迟早会分叉
 * （MCP 服务器可能要 proxy 变量，插件宿主不该要），共用一个常量会让其中一边的放宽悄悄惠及另一边。
 */
export const MCP_CHILD_ENV_ALLOWLIST = ["PATH", "HOME", "LANG", "LC_ALL", "TZ", "TMPDIR"] as const;

/** 引用式密钥只能指向这个前缀底下的服务端变量。 */
export const MCP_SECRET_REF_ENV_PREFIX = "WORKHUB_MCP_SECRET_";

/** 环境变量名的形状。子进程 env 的键要能被 shell 与 libc 认成变量名。 */
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

/** 凭据形状判定直接复用插件宿主那一份，本包不留副本——两份黑名单迟早漂移，而漏一条就是漏一份凭据。 */
export { isDeniedPluginHostEnvKey };

function isBaseEnvKey(key: string): boolean {
  return (MCP_CHILD_ENV_ALLOWLIST as readonly string[]).includes(key);
}

/** 一条引用式密钥为什么用不了。英文诊断，人话由展示层出。 */
export type McpSecretRefProblemReason =
  /** 子进程变量名不是合法的环境变量名。 */
  | "invalid_child_key"
  /** 子进程变量名撞上了白名单基座键（PATH/HOME/…）。 */
  | "overrides_base_key"
  /** 被引用的服务端变量不在 `WORKHUB_MCP_SECRET_` 命名空间里。 */
  | "out_of_scope"
  /** 被引用的服务端变量当前没有配置。 */
  | "missing";

export type McpSecretRefProblem = {
  childKey: string;
  sourceKey: string;
  reason: McpSecretRefProblemReason;
};

export type McpSecretRefResolution =
  | { ok: true; values: Record<string, string> }
  | { ok: false; problems: McpSecretRefProblem[] };

export type ResolveMcpSecretRefsInput = {
  /** API 进程的 env（通常 `process.env`）。由调用方读好传进来。 */
  source: Record<string, string | undefined>;
  /** `{子进程变量名: 服务端变量名}`。 */
  secretRefs: Record<string, string>;
};

/**
 * 解析引用式密钥。**一次把所有问题都报出来**，不是遇到第一条就停——
 * 管理员配三条引用错两条时，一条一条试是最难受的体验。
 */
export function resolveMcpSecretRefs(input: ResolveMcpSecretRefsInput): McpSecretRefResolution {
  const values: Record<string, string> = {};
  const problems: McpSecretRefProblem[] = [];
  for (const [childKey, sourceKey] of Object.entries(input.secretRefs)) {
    if (!ENV_KEY_PATTERN.test(childKey)) {
      problems.push({ childKey, sourceKey, reason: "invalid_child_key" });
      continue;
    }
    if (isBaseEnvKey(childKey)) {
      problems.push({ childKey, sourceKey, reason: "overrides_base_key" });
      continue;
    }
    if (!sourceKey.startsWith(MCP_SECRET_REF_ENV_PREFIX) || !ENV_KEY_PATTERN.test(sourceKey)) {
      problems.push({ childKey, sourceKey, reason: "out_of_scope" });
      continue;
    }
    const value = input.source[sourceKey];
    if (typeof value !== "string" || value.length === 0) {
      problems.push({ childKey, sourceKey, reason: "missing" });
      continue;
    }
    values[childKey] = value;
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, values };
}

export type BuildMcpChildEnvInput = {
  /** API 进程的 env（通常 `process.env`）。 */
  source: Record<string, string | undefined>;
  /** 服务器配置里的非密环境变量（`env_json`）。 */
  serverEnv?: Record<string, string>;
  /** `{子进程变量名: 服务端变量名}`（`secret_refs_json`）。 */
  secretRefs?: Record<string, string>;
};

/**
 * 组装子进程 env：白名单基座 + 服务器配置的非密键 + 解析出的引用式密钥。
 * 任何一步不合规**直接抛错**（fail-closed），绝不「跳过这一条继续」——
 * 少一个凭据的服务器会以一个远端 401 的形式失败，那时没人查得到是这里悄悄跳过了。
 *
 * 注意这里没有 `NODE_OPTIONS`：子进程不继承宿主的 `--require` / `--import` 注入。
 */
export function buildMcpChildEnv(input: BuildMcpChildEnvInput): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of MCP_CHILD_ENV_ALLOWLIST) {
    if (isDeniedPluginHostEnvKey(key)) {
      throw new Error(`mcp child env allowlist contains a denied key: ${key}`);
    }
    const value = input.source[key];
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  for (const [key, value] of Object.entries(input.serverEnv ?? {})) {
    if (!ENV_KEY_PATTERN.test(key)) {
      throw new Error(`mcp server env key is not a valid environment variable name: ${key}`);
    }
    if (isDeniedPluginHostEnvKey(key)) {
      throw new Error(`mcp server env may not set a credential-shaped key: ${key}`);
    }
    if (isBaseEnvKey(key)) {
      throw new Error(`mcp server env may not override a host env key: ${key}`);
    }
    env[key] = value;
  }
  const secretRefs = input.secretRefs ?? {};
  const resolution = resolveMcpSecretRefs({ source: input.source, secretRefs });
  if (!resolution.ok) {
    const first = resolution.problems[0];
    throw new Error(
      `mcp secret reference unusable (${resolution.problems.length}): ${first?.childKey} -> ${first?.sourceKey} (${first?.reason})`
    );
  }
  for (const [key, value] of Object.entries(resolution.values)) {
    if (key in env) {
      throw new Error(`mcp secret reference collides with an env key already set: ${key}`);
    }
    env[key] = value;
  }
  return env;
}
