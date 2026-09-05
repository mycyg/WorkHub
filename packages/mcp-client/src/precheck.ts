/**
 * 添加一台 MCP 服务器之前的静态体检（设计稿 4.3 的体检表）。
 *
 * **不执行任何东西。** 唯一需要真实世界的一件事——「这个命令在这台机器上存在吗」——由调用方
 * 做一次 `access()` 把结论传进来，本模块只做判定。形状照 `apps/api/src/services/plugin-compat.ts`
 * 的 `evaluatePluginManifest`：稳定 id 枚举 + `pass`/`warn`/`block` 三档 + 英文 detail，
 * 人话由展示层按 id 出，两端 UI 不解析英文诊断。
 *
 * 体检项：
 *
 * | id                     | 判据                                                     | 结论  |
 * |------------------------|----------------------------------------------------------|-------|
 * | `server_name`          | 不匹配 `^[A-Za-z0-9_-]{1,32}$`，或该工作区已被占用          | block |
 * | `command_resolvable`   | 相对路径；裸名在 PATH 上找不到；绝对路径不存在或不可执行      | block |
 * | `remote_exec_launcher` | 命令是 `npx` / `pnpm dlx` 一类「现下现跑」的启动器           | block |
 * | `args_shape`           | 参数含 NUL 字节 → block；含 `..` 路径穿越片段 → warn         | 两档  |
 * | `env_credential_shaped`| `env` 的键命中凭据形状黑名单                                | block |
 * | `env_overrides_base`   | `env` 试图覆盖白名单基座键（PATH/HOME/…）                   | block |
 * | `secret_ref_scope`     | 引用式密钥指向 `WORKHUB_MCP_SECRET_` 之外的服务端变量        | block |
 * | `secret_refs_present`  | 引用的服务端变量当前不存在                                  | warn  |
 *
 * 最后一项只 warn 不 block：管理员完全可能先把服务器配好、再去改部署环境重启。
 * 但**spawn 的时候是 fail-closed 的**（`env.ts` 的 `buildMcpChildEnv` 直接抛错）——
 * 体检允许你先填，不代表凭据缺着也能起。
 *
 * `secret_ref_scope` 是设计稿那张表之外新增的一条（设计稿只在正文里给了带前缀的例子）。
 * 理由写在 `env.ts` 的模块注释里：这条不立，引用式密钥就是一个绕过白名单读任意环境变量的原语。
 * **M0/M3 注意**：契约里的体检项枚举因此是 8 条，不是设计稿表里的 7 条。
 */
import path from "node:path";

import { isDeniedPluginHostEnvKey, MCP_CHILD_ENV_ALLOWLIST, MCP_SECRET_REF_ENV_PREFIX } from "./env.js";
import { isValidMcpServerName, MCP_SERVER_NAME_MAX_CHARS } from "./names.js";

/** NUL 字节。写成常量而不是字面量，免得它在源码里变成一个看不见的字符。 */
const NULL_BYTE = "\x00";

export const MCP_PRECHECK_CHECK_IDS = [
  "server_name",
  "command_resolvable",
  "remote_exec_launcher",
  "args_shape",
  "env_credential_shaped",
  "env_overrides_base",
  "secret_ref_scope",
  "secret_refs_present"
] as const;

export type McpPrecheckCheckId = (typeof MCP_PRECHECK_CHECK_IDS)[number];
export type McpPrecheckLevel = "pass" | "warn" | "block";

export type McpPrecheckCheck = {
  id: McpPrecheckCheckId;
  level: McpPrecheckLevel;
  /** 英文诊断细节（命令名、变量名等），上限 500 字符。 */
  detail?: string;
};

export type McpPrecheckReport = {
  verdict: "ok" | "warn" | "blocked";
  checks: McpPrecheckCheck[];
  checked_at: string;
};

/**
 * 「现下现跑」的启动器：每次启动都从 registry 下载并执行任意包。
 *
 * 生态现实是几乎所有 MCP 服务器的官方文档都写 `npx -y @modelcontextprotocol/server-github`，
 * 拦掉等于教程上的每一行都用不了。仍然拦，是因为放行会让 WorkHub 的两条既有红线对同一类风险
 * 给出相反答案：`plugin_install_scripts_refused`（安装期脚本 = 沙箱之外的任意代码执行）与
 * `packages/tools/src/sandbox.ts` 里 `npm exec / pnpm dlx / bun x` 的禁令，封的正是这条路。
 * 错误文案负责把代价降到最低：教用户先在本机装好，再填装好之后的可执行路径。
 */
export const MCP_REMOTE_EXEC_LAUNCHERS = ["npx", "pnpx", "bunx", "uvx"] as const;

/** 「命令 + 第一个非选项参数」构成的启动器。 */
export const MCP_REMOTE_EXEC_LAUNCHER_PAIRS: Record<string, readonly string[]> = {
  npm: ["exec", "x"],
  pnpm: ["dlx", "exec"],
  yarn: ["dlx"],
  bun: ["x"],
  uv: ["tool"],
  pipx: ["run"]
};

/** 命令名归一化：去目录、去 Windows 扩展名、转小写。与 `sandbox.ts` 的 `normalizeCommandName` 同口径。 */
export function normalizeMcpCommandName(raw: string): string {
  return path.basename(raw).toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/u, "");
}

/** 这条命令是不是「现下现跑」的启动器；是的话回一段英文诊断，不是则回 undefined。 */
export function detectRemoteExecLauncher(command: string, args: readonly string[]): string | undefined {
  const name = normalizeMcpCommandName(command);
  if ((MCP_REMOTE_EXEC_LAUNCHERS as readonly string[]).includes(name)) {
    return name;
  }
  const subcommands = MCP_REMOTE_EXEC_LAUNCHER_PAIRS[name];
  if (!subcommands) {
    return undefined;
  }
  const firstOperand = args.find((arg) => !arg.startsWith("-"));
  if (firstOperand !== undefined && subcommands.includes(firstOperand.toLowerCase())) {
    return `${name} ${firstOperand.toLowerCase()}`;
  }
  return undefined;
}

/**
 * 调用方做完 IO 之后的结论。
 * `undefined` = 没查（本模块不假装查过，出一条 warn 说清楚「没验证」）。
 */
export type McpCommandResolution = {
  /** 文件存在（裸名则是在 PATH 上找到了）。 */
  found: boolean;
  /** 存在且可执行。 */
  executable: boolean;
  /** 找到的完整路径，给展示层回显。 */
  resolvedPath?: string;
};

export type PrecheckMcpServerInput = {
  serverName: string;
  /** 该工作区已被占用的服务器名。 */
  takenServerNames?: readonly string[];
  command: string;
  args?: readonly string[];
  /** 服务器配置里的非密环境变量。 */
  env?: Record<string, string>;
  /** `{子进程变量名: 服务端变量名}`。 */
  secretRefs?: Record<string, string>;
  /** 调用方查出来的命令存在性。**只传结论，不传 env 的值。** */
  commandResolution?: McpCommandResolution;
  /** API 进程上当前存在的 `WORKHUB_MCP_SECRET_*` 变量名（只有名字，没有值）。 */
  presentSecretEnvNames?: readonly string[];
  checkedAt: Date;
};

function detail(text: string): string {
  return text.length > 500 ? text.slice(0, 500) : text;
}

function hasTraversalSegment(value: string): boolean {
  return value.split("/").some((segment) => segment === "..");
}

/** 纯判定：给一份配置（外加调用方查好的命令存在性），出一份体检报告。 */
export function precheckMcpServer(input: PrecheckMcpServerInput): McpPrecheckReport {
  const checks: McpPrecheckCheck[] = [];
  const args = input.args ?? [];
  const env = input.env ?? {};
  const secretRefs = input.secretRefs ?? {};

  if (!isValidMcpServerName(input.serverName)) {
    checks.push({
      id: "server_name",
      level: "block",
      detail: detail(`server name must match [A-Za-z0-9_-] and be 1-${MCP_SERVER_NAME_MAX_CHARS} characters`)
    });
  } else if ((input.takenServerNames ?? []).includes(input.serverName)) {
    checks.push({ id: "server_name", level: "block", detail: detail(`name already used: ${input.serverName}`) });
  } else {
    checks.push({ id: "server_name", level: "pass" });
  }

  const command = input.command.trim();
  if (command.length === 0) {
    checks.push({ id: "command_resolvable", level: "block", detail: "command is empty" });
  } else if (command.includes(NULL_BYTE)) {
    checks.push({ id: "command_resolvable", level: "block", detail: "command contains a null byte" });
  } else if (!path.isAbsolute(command) && command.includes("/")) {
    // 相对谁？API 进程的 cwd 是部署细节，不该决定跑起来的是哪个可执行文件。
    // 同 `normalizePluginSourcePath` 只认本机绝对路径的理由。
    checks.push({ id: "command_resolvable", level: "block", detail: detail(`relative path refused: ${command}`) });
  } else if (!input.commandResolution) {
    checks.push({ id: "command_resolvable", level: "warn", detail: "command existence was not checked" });
  } else if (!input.commandResolution.found) {
    checks.push({ id: "command_resolvable", level: "block", detail: detail(`command not found: ${command}`) });
  } else if (!input.commandResolution.executable) {
    checks.push({ id: "command_resolvable", level: "block", detail: detail(`command is not executable: ${command}`) });
  } else {
    checks.push({
      id: "command_resolvable",
      level: "pass",
      ...(input.commandResolution.resolvedPath ? { detail: detail(input.commandResolution.resolvedPath) } : {})
    });
  }

  const launcher = command.length > 0 ? detectRemoteExecLauncher(command, args) : undefined;
  if (launcher !== undefined) {
    checks.push({
      id: "remote_exec_launcher",
      level: "block",
      detail: detail(`${launcher} downloads and runs code from the network on every start`)
    });
  } else {
    checks.push({ id: "remote_exec_launcher", level: "pass" });
  }

  const nullByteArgs = args.filter((arg) => arg.includes(NULL_BYTE));
  const traversalArgs = args.filter((arg) => hasTraversalSegment(arg));
  if (nullByteArgs.length > 0) {
    checks.push({ id: "args_shape", level: "block", detail: `${nullByteArgs.length} argument(s) contain a null byte` });
  } else if (traversalArgs.length > 0) {
    checks.push({
      id: "args_shape",
      level: "warn",
      detail: detail(`path traversal segment in: ${traversalArgs.join(", ")}`)
    });
  } else {
    checks.push({ id: "args_shape", level: "pass" });
  }

  const credentialKeys = Object.keys(env).filter((key) => isDeniedPluginHostEnvKey(key));
  if (credentialKeys.length > 0) {
    checks.push({
      id: "env_credential_shaped",
      level: "block",
      detail: detail(`credential-shaped env keys: ${credentialKeys.join(", ")}`)
    });
  } else {
    checks.push({ id: "env_credential_shaped", level: "pass" });
  }

  const baseKeys = Object.keys(env).filter((key) => (MCP_CHILD_ENV_ALLOWLIST as readonly string[]).includes(key));
  if (baseKeys.length > 0) {
    checks.push({
      id: "env_overrides_base",
      level: "block",
      detail: detail(`env may not override host keys: ${baseKeys.join(", ")}`)
    });
  } else {
    checks.push({ id: "env_overrides_base", level: "pass" });
  }

  const refEntries = Object.entries(secretRefs);
  const outOfScope = refEntries.filter(([, sourceKey]) => !sourceKey.startsWith(MCP_SECRET_REF_ENV_PREFIX));
  if (outOfScope.length > 0) {
    checks.push({
      id: "secret_ref_scope",
      level: "block",
      detail: detail(
        `secret references must point at ${MCP_SECRET_REF_ENV_PREFIX}* variables: ${outOfScope
          .map(([childKey, sourceKey]) => `${childKey} -> ${sourceKey}`)
          .join(", ")}`
      )
    });
  } else {
    checks.push({ id: "secret_ref_scope", level: "pass" });
  }

  const present = new Set(input.presentSecretEnvNames ?? []);
  const absent = refEntries
    .filter(([, sourceKey]) => sourceKey.startsWith(MCP_SECRET_REF_ENV_PREFIX) && !present.has(sourceKey))
    .map(([, sourceKey]) => sourceKey);
  if (absent.length > 0) {
    checks.push({
      id: "secret_refs_present",
      level: "warn",
      detail: detail(`not configured on this server yet: ${absent.join(", ")}`)
    });
  } else {
    checks.push({ id: "secret_refs_present", level: "pass" });
  }

  const verdict = checks.some((check) => check.level === "block")
    ? "blocked"
    : checks.some((check) => check.level === "warn")
      ? "warn"
      : "ok";
  return { verdict, checks, checked_at: input.checkedAt.toISOString() };
}

/**
 * 第一条 block 对应的稳定错误码，给治理端点直接用。
 *
 * 设计稿 4.5 那张错误码表里已有的：`mcp_command_not_found` / `mcp_remote_exec_refused` /
 * `mcp_server_name_taken` / `mcp_env_credential_shaped`。
 * 表里没写、这里补齐的四条（**M3 注意**）：`mcp_server_name_invalid` / `mcp_args_invalid` /
 * `mcp_env_overrides_base` / `mcp_secret_ref_out_of_scope`。
 * 每条 block 都要有自己的码，否则展示层只能去解析英文 detail——那正是既有纪律禁止的做法。
 */
export function mcpPrecheckErrorCode(report: McpPrecheckReport): string | undefined {
  const blocked = report.checks.find((check) => check.level === "block");
  if (!blocked) {
    return undefined;
  }
  switch (blocked.id) {
    case "server_name":
      return blocked.detail?.startsWith("name already used") ? "mcp_server_name_taken" : "mcp_server_name_invalid";
    case "command_resolvable":
      return "mcp_command_not_found";
    case "remote_exec_launcher":
      return "mcp_remote_exec_refused";
    case "args_shape":
      return "mcp_args_invalid";
    case "env_credential_shaped":
      return "mcp_env_credential_shaped";
    case "env_overrides_base":
      return "mcp_env_overrides_base";
    case "secret_ref_scope":
      return "mcp_secret_ref_out_of_scope";
    default:
      return undefined;
  }
}
