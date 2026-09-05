import { spawn } from "node:child_process";
import { accessSync, constants, realpathSync } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

import {
  SANDBOX_EXEC_PATH,
  buildSeatbeltProfile,
  detectSandboxDenial,
  detectSeatbeltRunnerFailure,
  interpreterReadRoot,
  resolveExecutable,
  resolveSandboxBackend,
  sandboxDenialNotice,
  sandboxUnavailableMessage,
  seatbeltArgv,
  seatbeltRunnerFailureMessage
} from "./seatbelt.js";
import { defaultSandboxMode, type CommandRunner, type CommandRunnerInput, type CommandRunnerOutput, type SandboxBudget, type SandboxMode } from "./types.js";

export const allowedCommands = new Set([
  "python",
  "python3",
  "py",
  "node",
  "npm",
  "pnpm",
  "bun",
  "pytest",
  "ruff",
  "tsc"
]);

const dependencyInstallCommands = new Set(["install", "i", "add", "ci"]);
// npm exec / pnpm dlx / bun x / *run / create / init 都会从 registry 下载并执行任意包 → 一并禁。
const remoteExecCommands = new Set(["exec", "x", "dlx", "run", "create", "init"]);

function normalizeCommandName(raw: string) {
  const base = path.basename(raw).toLowerCase();
  return base.replace(/\.(exe|cmd|bat|ps1)$/u, "");
}

export function ensureCommandAllowed(args: string[]) {
  if (args.length === 0 || !args[0]?.trim()) {
    throw new Error("command args must not be empty");
  }
  if (args.some((arg) => arg.includes("\0"))) {
    throw new Error("command args must not contain null bytes");
  }

  // 命令必须是裸名，不能带路径或绝对路径。否则白名单按 basename 校验、spawn 却按原样执行：
  // AI 可先 write_file 一个同名可执行文件，再用 ./python / evil/node / /usr/bin/x 绕过白名单跑任意代码。
  const raw = args[0] as string;
  if (path.isAbsolute(raw) || path.basename(raw) !== raw) {
    throw new Error("command must be a bare allowlisted name, not a path");
  }

  const command = normalizeCommandName(raw);
  if (!allowedCommands.has(command)) {
    throw new Error(`command not allowlisted: ${command}`);
  }

  const subcommand = args[1]?.toLowerCase();
  if (["npm", "pnpm", "bun"].includes(command) && subcommand
    && (dependencyInstallCommands.has(subcommand) || remoteExecCommands.has(subcommand))) {
    throw new Error("dependency installation / remote package execution is disabled in the WorkHub sandbox");
  }
}

// 防符号链接逃逸：词法检查（path.relative）挡不住沙箱内一个指向外部的 symlink。
// 解析 target 最近的"已存在祖先"的真实路径，确认仍在 workdir 真实根内。workdir 本身不存在时
// （纯路径单测）跳过——没有真实文件就没有 symlink 可跟。
function realpathEscapes(root: string, target: string): boolean {
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    return false; // workdir 不存在 → 无 symlink 风险，词法守卫已足够
  }
  let probe = target;
  for (;;) {
    try {
      const real = realpathSync(probe);
      const rel = path.relative(realRoot, real);
      return rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel));
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) {
        return false;
      }
      probe = parent;
    }
  }
}

export function safeResolvePath(workdir: string, inputPath = ".") {
  if (inputPath.includes("\0")) {
    throw new Error("path must not contain null bytes");
  }
  const root = path.resolve(workdir);
  const target = path.resolve(root, inputPath);
  const relative = path.relative(root, target);
  if (relative !== "" && (relative.startsWith("..") || path.isAbsolute(relative))) {
    throw new Error("path escapes workdir");
  }
  if (realpathEscapes(root, target)) {
    throw new Error("path escapes workdir via symlink");
  }
  return target;
}

export type SandboxStats = {
  files: number;
  bytes: number;
};

export async function sandboxStats(workdir: string): Promise<SandboxStats> {
  const root = safeResolvePath(workdir);
  async function walk(current: string): Promise<SandboxStats> {
    const currentStat = await lstat(current);
    // 不跟随符号链接：否则毒环 symlink 会让预算统计死循环、指向 / 的 symlink 把整个主机 FS 算进预算。
    if (currentStat.isSymbolicLink()) {
      return { files: 1, bytes: 0 };
    }
    if (!currentStat.isDirectory()) {
      return { files: 1, bytes: currentStat.size };
    }
    const entries = await readdir(current);
    const totals: SandboxStats = { files: 0, bytes: 0 };
    for (const entry of entries) {
      const child = await walk(path.join(current, entry));
      totals.files += child.files;
      totals.bytes += child.bytes;
    }
    return totals;
  }
  return walk(root);
}

export async function enforceSandboxBudget(workdir: string, budget: Pick<SandboxBudget, "maxFiles" | "maxBytes">) {
  const stats = await sandboxStats(workdir);
  if (stats.files > budget.maxFiles) {
    throw new Error(`sandbox file budget exceeded: ${stats.files}/${budget.maxFiles}`);
  }
  if (stats.bytes > budget.maxBytes) {
    throw new Error(`sandbox byte budget exceeded: ${stats.bytes}/${budget.maxBytes}`);
  }
  return stats;
}

function sandboxEnv(workdir: string): Record<string, string> {
  return {
    // CORE-16 风险标注：透传宿主 PATH 意味着白名单命令（python3/node/…）解析到的是宿主真实解释器
    // 及其整套 site-packages/全局工具。R26 B8 起这不再是唯一的一道防线——macOS 上 argv 会被包进
    // Seatbelt（`(deny default)` + 出网全拒 + 写只限工作目录），PATH 上的东西即便被执行也受同一策略
    // 约束。但在没有 Seatbelt 的平台上（Linux/Windows），本 env 仍然只是「预算+路径围栏」级别的软
    // 沙箱、不是安全边界，因此那些平台默认 fail-closed 拒绝执行（见 resolveSandboxBackend）。
    PATH: process.env.PATH ?? "",
    PYTHONPATH: workdir,
    HOME: workdir,
    TMPDIR: workdir,
    TEMP: workdir,
    TMP: workdir,
    NO_COLOR: "1"
  };
}

function spawnCommand(input: {
  args: string[];
  cwd: string;
  timeoutSeconds: number;
  env: Record<string, string>;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const { args, cwd, timeoutSeconds, env } = input;
  return new Promise((resolve) => {
    const child = spawn(args[0] as string, args.slice(1), {
      cwd,
      env,
      shell: false,
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let truncated = false;
    // 输出上限：被白名单命令（LLM 可控，如 python3 -c "print('x'*N)"）在超时窗口内能吐 GB 级，
    // 撑爆 agent 宿主内存（DoS）。各流封顶并截断 + 杀进程。
    const MAX_STREAM_BYTES = 2 * 1024 * 1024;
    const capStop = () => {
      if (!truncated) {
        truncated = true;
        child.kill("SIGKILL");
      }
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutSeconds * 1000);

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length >= MAX_STREAM_BYTES) {
        capStop();
        return;
      }
      stdout += chunk.toString("utf8");
      if (stdout.length > MAX_STREAM_BYTES) {
        stdout = `${stdout.slice(0, MAX_STREAM_BYTES)}\n[output truncated]`;
        capStop();
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length >= MAX_STREAM_BYTES) {
        capStop();
        return;
      }
      stderr += chunk.toString("utf8");
      if (stderr.length > MAX_STREAM_BYTES) {
        stderr = `${stderr.slice(0, MAX_STREAM_BYTES)}\n[output truncated]`;
        capStop();
      }
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr
      });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        exitCode: 1,
        stdout,
        stderr: error.message
      });
    });
  });
}

function seatbeltAvailable(sandboxExecPath: string): boolean {
  try {
    accessSync(sandboxExecPath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export type SandboxedCommandRunnerOptions = {
  /**
   * 允许在没有操作系统级后端的平台上降级到用户态软沙箱（enforcement=partial）。
   * 对应 `AGENT_RUN_ALLOW_UNSANDBOXED_COMMANDS`；不开就 fail-closed 拒绝执行。
   */
  allowDegraded?: boolean;
  /** 覆写平台判定（测试用）。 */
  platform?: string;
  /** 覆写 sandbox-exec 路径（测试用）。 */
  sandboxExecPath?: string;
  /** 覆写宿主临时目录（测试用）。 */
  hostTempDir?: string;
};

/**
 * 受控命令执行器：spawn 之前先决策后端，macOS 上把 argv 包成
 * `sandbox-exec -p '<profile>' -- <argv>`，并把执行完整度与拒绝签名一起上报。
 * 没有可用后端且没显式允许降级时**拒绝执行**（fail-closed），绝不静默无约束地跑。
 */
export function createSandboxedCommandRunner(options: SandboxedCommandRunnerOptions = {}): CommandRunner {
  const platform = options.platform ?? process.platform;
  const sandboxExecPath = options.sandboxExecPath ?? SANDBOX_EXEC_PATH;
  const allowDegraded = options.allowDegraded ?? false;
  return async (input: CommandRunnerInput): Promise<CommandRunnerOutput> => {
    const mode: SandboxMode = input.mode ?? defaultSandboxMode;
    const decision = resolveSandboxBackend({
      platform,
      mode,
      allowDegraded,
      seatbeltAvailable: platform === "darwin" && seatbeltAvailable(sandboxExecPath)
    });
    if (decision.backend === "unavailable") {
      // fail-closed：命令根本没有执行。
      return { exitCode: 126, stdout: "", stderr: decision.message, sandboxUnavailable: true };
    }
    if (decision.backend !== "seatbelt") {
      const raw = await spawnCommand(input);
      return { ...raw, enforcement: decision.enforcement, backend: decision.backend };
    }

    const workdir = input.workdir ?? input.cwd;
    // 解释器可能装在 nvm/pyenv/conda 这类非系统前缀里，把它的安装前缀一起放行（只读）。
    const executable = resolveExecutable(input.args[0] ?? "", input.env.PATH ?? process.env.PATH ?? "");
    const interpreterRoot = executable ? interpreterReadRoot(executable) : undefined;
    const profile = buildSeatbeltProfile({
      mode,
      workdir,
      ...(interpreterRoot ? { readExtras: [interpreterRoot] } : {}),
      ...(options.hostTempDir ? { hostTempDir: options.hostTempDir } : {})
    });
    const raw = await spawnCommand({
      ...input,
      args: seatbeltArgv({ args: input.args, profile, sandboxExecPath })
    });

    const runnerFailure = detectSeatbeltRunnerFailure(raw);
    if (runnerFailure.failed && runnerFailure.kind === "profile") {
      // 包裹器拒了 profile → 命令没跑。绝不退回无包裹重试。
      return {
        exitCode: raw.exitCode,
        stdout: raw.stdout,
        stderr: seatbeltRunnerFailureMessage(runnerFailure.reason ?? "sandbox-exec refused the profile"),
        sandboxUnavailable: true
      };
    }
    const denial = detectSandboxDenial(raw);
    return {
      ...raw,
      enforcement: decision.enforcement,
      backend: decision.backend,
      ...(denial.denied && denial.operation
        ? { sandboxDenied: true, stderr: `${sandboxDenialNotice(denial.operation)}\n${raw.stderr}`.trim() }
        : {})
    };
  };
}

/**
 * 默认执行器：macOS 走 Seatbelt（full），其余平台在未显式允许降级时 fail-closed。
 * 需要降级到软沙箱的部署请显式 `createSandboxedCommandRunner({ allowDegraded: true })`。
 */
export const nodeCommandRunner: CommandRunner = createSandboxedCommandRunner();

export async function runSandboxedCommand(input: {
  args: string[];
  cwd: string;
  workdir: string;
  timeoutSeconds: number;
  runner?: CommandRunner;
  mode?: SandboxMode;
}) {
  ensureCommandAllowed(input.args);
  const cwd = safeResolvePath(input.workdir, input.cwd);
  const timeoutSeconds = Math.max(1, Math.min(60, input.timeoutSeconds));
  const runner = input.runner ?? nodeCommandRunner;
  return runner({
    args: input.args,
    cwd,
    timeoutSeconds,
    env: sandboxEnv(input.workdir),
    mode: input.mode ?? defaultSandboxMode,
    workdir: path.resolve(input.workdir)
  });
}
