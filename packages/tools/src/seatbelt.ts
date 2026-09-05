/**
 * macOS Seatbelt（`sandbox-exec`）后端 + fail-closed 决策（R26 B8）。
 *
 * 借 deepseek-harness `packages/sandbox` 的三条契约（只借契约，profile 是本仓实测出来的）：
 * ① 没有可用后端就 `SANDBOX_UNAVAILABLE` **拒绝执行**，绝不静默无约束地跑；
 * ② 每次包裹上报**执行完整度** `full` / `partial`，让消费者区分「沙箱坏了」与「命令被拒」；
 * ③ 被拒的调用要能被识别出来，翻成一句给模型看的固定话——否则模型会把策略拒绝当成命令写错，
 *    然后不停换写法绕，这是真实的失控路径。
 *
 * profile 形状（`(deny default)` 起手）与其中每一条 allow 都由本机实测收敛而来，实测矩阵见
 * `seatbelt.test.ts` 的集成用例：workdir 外写被拒 / workdir 内写通过 / 网络被拒 / read-only 下
 * workdir 内写也被拒。
 */
import { accessSync, constants, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { SandboxBackend, SandboxEnforcement, SandboxMode } from "./types.js";

/** macOS 自带的 Seatbelt 包裹器。 */
export const SANDBOX_EXEC_PATH = "/usr/bin/sandbox-exec";

/** fail-closed 错误码（沿用 deepseek-harness 的同名契约，便于对照文档）。 */
export const SANDBOX_UNAVAILABLE = "SANDBOX_UNAVAILABLE";

/**
 * 只读放行的系统运行库与常用解释器安装前缀。**实测最小集**：去掉其中任何一条都会让
 * `/usr/bin/python3` 或 `node` 在 `(deny default)` 下起不来（见 seatbelt.test.ts 的说明）。
 * 注意这里放行的是「跑得起来所必需的系统只读资料」，不含任何用户数据目录（`/Users/*` 被拒）。
 */
export const SYSTEM_READ_SUBPATHS = [
  "/usr",
  "/bin",
  "/sbin",
  "/System",
  "/Library",
  "/private/etc",
  // Xcode Command Line Tools 的 python3 shim 要读这两处，否则 xcode-select 直接失败。
  "/private/var/select",
  "/private/var/db",
  "/dev",
  // 常用第三方解释器前缀（Homebrew / MacPorts / /usr/local）。不存在也无害：匹配不到任何路径。
  "/opt/homebrew",
  "/opt/local",
  "/usr/local"
] as const;

/**
 * 必须逐个放行的「路径节点」而不是子树：根目录本身要可读（否则连 `/bin/echo` 都起不来，实测
 * 退出码 134），`/var` `/tmp` `/etc` 是指向 `/private/*` 的符号链接，解析前缀时要能读到链接本体。
 */
export const SYSTEM_READ_LITERALS = ["/", "/var", "/tmp", "/etc"] as const;

/** 无论哪档都放行的字符设备写（`/dev/null` 这类是「丢弃」不是「落盘」）。 */
export const DEVICE_WRITE_LITERALS = [
  "/dev/null",
  "/dev/zero",
  "/dev/random",
  "/dev/urandom",
  "/dev/tty",
  "/dev/dtracehelper",
  "/dev/stdout",
  "/dev/stderr"
] as const;

/** 把一个路径写成 SBPL 字符串字面量（反斜杠与引号要转义，否则含引号的 workdir 能注入 profile）。 */
export function sbplString(value: string): string {
  return `"${value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"')}"`;
}

/**
 * 解析成规范路径：Seatbelt 比对的是解析后的路径（`/tmp` 就是 `/private/tmp`），
 * 以未解析的拼法授权等于什么都没授权。解析不了就原样返回——不存在的路径匹配不到任何东西，
 * 这是保守的那一侧。
 */
export function canonicalPath(target: string): string {
  try {
    return realpathSync.native(target);
  } catch {
    return target;
  }
}

/**
 * 同一个位置在 macOS 上有两种拼法（`/var/folders/...` 与 `/private/var/folders/...`），
 * 内核对不同操作用的拼法并不一致，两种都授权最省事也最不容易误伤。
 */
export function pathAliases(target: string): string[] {
  const aliases = new Set<string>([target]);
  for (const [firm, link] of [["/private/var", "/var"], ["/private/tmp", "/tmp"], ["/private/etc", "/etc"]] as const) {
    if (target === firm || target.startsWith(`${firm}/`)) {
      aliases.add(`${link}${target.slice(firm.length)}`);
    }
    if (target === link || target.startsWith(`${link}/`)) {
      aliases.add(`${firm}${target.slice(link.length)}`);
    }
  }
  return [...aliases];
}

/**
 * 解释器的安装前缀：`~/.local/node22/bin/node` → `~/.local/node22`，`/usr/bin/python3` → `/usr`。
 * nvm / pyenv / conda 装的解释器不在系统前缀里，不放行它自己的标准库就跑不起来。
 * 只给**读**权限，且绝不退化成 `/`（那等于放弃整个只读围栏）。
 */
export function interpreterReadRoot(binary: string): string | undefined {
  if (!path.isAbsolute(binary)) {
    return undefined;
  }
  const real = canonicalPath(binary);
  const dir = path.dirname(real);
  const prefix = path.basename(dir) === "bin" ? path.dirname(dir) : dir;
  if (prefix === "/" || prefix === "" || prefix === ".") {
    return undefined;
  }
  return prefix;
}

/** 在给定 PATH 上找出裸命令名对应的可执行文件（与 `spawn(shell:false)` 的解析口径一致）。 */
export function resolveExecutable(command: string, pathEnv: string): string | undefined {
  if (path.isAbsolute(command)) {
    return command;
  }
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, command);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // 这一段 PATH 上没有 / 不可执行，继续找下一段。
    }
  }
  return undefined;
}

/**
 * 一次执行可以**写**的根目录：`read-only` 一个都没有（与 deepseek-harness `writableRoots` 同口径）；
 * `workspace-write` 是工作目录 + 本进程自己的临时目录。
 *
 * 为什么要带宿主临时目录：macOS 的 `/usr/bin/python3` 是 Command Line Tools 的 shim，起来时 xcrun
 * 要往 `confstr(_CS_DARWIN_USER_TEMP_DIR)`（即 `/var/folders/<...>/T`）写一份缓存；那个位置不受
 * `TMPDIR` 环境变量影响，不放行就连 `python3 -c "print(1)"` 都跑不起来（实测）。
 */
export function writableRoots(input: { mode: SandboxMode; workdir: string; hostTempDir?: string }): string[] {
  if (input.mode !== "workspace-write") {
    return [];
  }
  const roots = [input.workdir, input.hostTempDir ?? os.tmpdir()]
    .filter((root): root is string => Boolean(root))
    .map((root) => canonicalPath(root).replace(/\/+$/u, ""))
    .filter((root) => root !== "" && root !== "/");
  return [...new Set(roots)];
}

export type SeatbeltProfileInput = {
  mode: SandboxMode;
  /** 沙箱根目录（读 + 写的基准）。 */
  workdir: string;
  /** 额外只读放行的目录（解释器安装前缀等）。 */
  readExtras?: string[];
  /** 宿主临时目录；缺省取本进程的 `os.tmpdir()`。 */
  hostTempDir?: string;
};

/**
 * 生成一条 SBPL profile。`(deny default)` 起手 + `(deny network*)`，其余全部是显式 allow。
 * 子进程继承同一策略（实测：sandbox-exec 下的 python3 再 spawn 的 python3 写 workdir 外同样被拒）。
 */
export function buildSeatbeltProfile(input: SeatbeltProfileInput): string {
  const workdir = canonicalPath(input.workdir).replace(/\/+$/u, "") || input.workdir;
  const writable = writableRoots({ mode: input.mode, workdir, ...(input.hostTempDir ? { hostTempDir: input.hostTempDir } : {}) });
  const readRoots = [
    ...SYSTEM_READ_SUBPATHS,
    ...writable,
    workdir,
    ...(input.readExtras ?? []).map((root) => canonicalPath(root).replace(/\/+$/u, ""))
  ]
    .filter((root) => root !== "" && root !== "/")
    .flatMap((root) => pathAliases(root));
  const readForms = [
    ...SYSTEM_READ_LITERALS.map((literal) => `(literal ${sbplString(literal)})`),
    ...[...new Set(readRoots)].map((root) => `(subpath ${sbplString(root)})`)
  ];
  const writeForms = [...new Set(writable.flatMap((root) => pathAliases(root)))]
    .map((root) => `(subpath ${sbplString(root)})`);

  const lines = [
    "(version 1)",
    ";; WorkHub 命令沙箱：拒绝一切，再逐条放行跑得起来所必需的最小集。",
    "(deny default)",
    ";; 出网一律拒（含 Unix 域套接字连接）：本次执行不该有任何外发通道。",
    "(deny network*)",
    `(allow file-read* ${readForms.join(" ")})`,
    ";; 允许起子进程；子进程继承同一条 profile，所以这不是逃逸口子。",
    "(allow process-exec* process-fork)",
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    "(allow signal (target self))",
    `(allow file-write-data ${DEVICE_WRITE_LITERALS.map((literal) => `(literal ${sbplString(literal)})`).join(" ")})`,
    `(allow file-ioctl ${["/dev/tty", "/dev/dtracehelper", "/dev/null"].map((literal) => `(literal ${sbplString(literal)})`).join(" ")})`
  ];
  if (writeForms.length > 0) {
    lines.push(`(allow file-write* ${writeForms.join(" ")})`);
  }
  return lines.join("\n");
}

/** 把 argv 包成 `sandbox-exec -p '<profile>' -- <argv>`。 */
export function seatbeltArgv(input: { args: string[]; profile: string; sandboxExecPath?: string }): string[] {
  return [input.sandboxExecPath ?? SANDBOX_EXEC_PATH, "-p", input.profile, "--", ...input.args];
}

export type SandboxBackendDecision =
  | { backend: SandboxBackend; enforcement: SandboxEnforcement }
  | { backend: "unavailable"; code: typeof SANDBOX_UNAVAILABLE; message: string };

/**
 * fail-closed 决策矩阵（平台 × 开关 × 模式）。唯一能在没有操作系统级边界的情况下执行命令的路径，
 * 是部署方**显式**打开降级开关（`AGENT_RUN_ALLOW_UNSANDBOXED_COMMANDS`）。
 */
export function resolveSandboxBackend(input: {
  platform: string;
  mode: SandboxMode;
  /** 允许降级到用户态软沙箱（partial）。对应 `AGENT_RUN_ALLOW_UNSANDBOXED_COMMANDS`。 */
  allowDegraded: boolean;
  seatbeltAvailable: boolean;
}): SandboxBackendDecision {
  if (input.mode === "danger-full-access") {
    // 显式配置才取得到：完全不包裹。这里绝不上报 full——`full` 的含义是「有一条操作系统级边界」，
    // 而这一档一条都没有。
    return { backend: "danger-full-access", enforcement: "partial" };
  }
  if (input.platform === "darwin" && input.seatbeltAvailable) {
    return { backend: "seatbelt", enforcement: "full" };
  }
  if (input.allowDegraded) {
    return { backend: "soft", enforcement: "partial" };
  }
  return {
    backend: "unavailable",
    code: SANDBOX_UNAVAILABLE,
    message: sandboxUnavailableMessage(input.platform)
  };
}

/** fail-closed 时给模型看的话：说清楚「命令没跑」以及「这不是命令写错」。 */
export function sandboxUnavailableMessage(platform: string): string {
  return [
    `[sandbox: ${SANDBOX_UNAVAILABLE}] 当前平台（${platform}）没有可用的命令沙箱后端，命令已被拒绝执行——`,
    "这是默认拒绝的安全策略，不是命令写错，换写法没有用。请改用不需要执行命令的做法，或把它列为 blocker。",
    `No command sandbox backend is available on this platform (${platform}), so the command was refused. `,
    "This is a fail-closed policy rather than a malformed command."
  ].join("");
}

export type SandboxDenialOperation = "network" | "file access";

/**
 * 识别 Seatbelt 的拒绝签名。Seatbelt 把拒绝表达成 `EPERM`（Operation not permitted），
 * 各解释器的措辞不同，这里按「出网相关词」优先、其余归为文件访问来分类。
 */
export function detectSandboxDenial(input: { stdout?: string; stderr: string; exitCode: number }): {
  denied: boolean;
  operation?: SandboxDenialOperation;
} {
  if (input.exitCode === 0) {
    return { denied: false };
  }
  const text = `${input.stderr}\n${input.stdout ?? ""}`;
  const permissionDenied = /Operation not permitted|EPERM|\[Errno 1\]|errno=1\b|errno 1\b/u.test(text);
  if (!permissionDenied) {
    return { denied: false };
  }
  if (/socket|connect|getaddrinfo|network|urlopen|ENETDOWN|ENETUNREACH/iu.test(text)) {
    return { denied: true, operation: "network" };
  }
  return { denied: true, operation: "file access" };
}

/**
 * 拒绝提示的固定话术。写死这一句是刻意的：模型看到策略拒绝的第一反应是「命令写错了」，
 * 于是不停换写法绕——把「这是策略」说死，比任何委婉措辞都有效。
 */
export function sandboxDenialNotice(operation: SandboxDenialOperation): string {
  const zh = operation === "network"
    ? "这是沙箱策略拒绝，不是命令写错：本次执行不能联网，请改用本地已有资料，不要换写法绕过。"
    : "这是沙箱策略拒绝，不是命令写错：请改在工作目录内读写，不要换写法绕过。";
  const en = operation === "network"
    ? "The sandbox policy denied this; the command is not malformed. This run has no network, so work from local material instead of trying another spelling."
    : "The sandbox policy denied this; the command is not malformed. Read and write inside the run workspace instead of trying another spelling.";
  return `[sandbox: ${operation} denied by policy] ${zh}${en}`;
}

/**
 * 识别「包裹器自己说话了」并分类。两种情况必须分开：
 * - `profile`：sandbox-exec 拒绝了 profile（语法错等）——**沙箱坏了**，命令根本没跑，要 fail-closed；
 * - `exec`：sandbox-exec 起不来目标程序（拼错命令名/没装）——这是命令的问题，不是沙箱的问题。
 * 混为一谈的话，沙箱坏掉会伪装成「命令写错」，一路静默无人发现。
 */
export function detectSeatbeltRunnerFailure(input: { stderr: string; exitCode: number }): {
  failed: boolean;
  kind?: "profile" | "exec";
  reason?: string;
} {
  const line = input.stderr.split("\n").find((entry) => entry.startsWith("sandbox-exec:"));
  if (!line) {
    return { failed: false };
  }
  return { failed: true, kind: line.includes("execvp()") ? "exec" : "profile", reason: line.trim() };
}

/** 包裹器自己失败时给模型看的话（沙箱坏了，不是命令被拒）。 */
export function seatbeltRunnerFailureMessage(reason: string): string {
  return [
    `[sandbox: ${SANDBOX_UNAVAILABLE}] 命令沙箱包裹器启动失败，命令没有执行：${reason}。`,
    "这是沙箱本身的故障，不是命令写错；请把它列为 blocker，交给部署方排查。",
    `The command sandbox wrapper failed to start, so the command never ran: ${reason}. `,
    "This is a sandbox fault rather than a malformed command."
  ].join("");
}
