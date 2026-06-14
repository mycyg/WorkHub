import { spawn } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { CommandRunner, SandboxBudget } from "./types.js";

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

export function safeResolvePath(workdir: string, inputPath = ".") {
  if (inputPath.includes("\0")) {
    throw new Error("path must not contain null bytes");
  }
  const root = path.resolve(workdir);
  const target = path.resolve(root, inputPath);
  const relative = path.relative(root, target);
  if (relative === "") {
    return target;
  }
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("path escapes workdir");
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
    const currentStat = await stat(current);
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
    PATH: process.env.PATH ?? "",
    PYTHONPATH: workdir,
    HOME: workdir,
    TMPDIR: workdir,
    TEMP: workdir,
    TMP: workdir,
    NO_COLOR: "1"
  };
}

export const nodeCommandRunner: CommandRunner = async ({ args, cwd, timeoutSeconds, env }) =>
  new Promise((resolve) => {
    const child = spawn(args[0] as string, args.slice(1), {
      cwd,
      env,
      shell: false,
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutSeconds * 1000);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
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

export async function runSandboxedCommand(input: {
  args: string[];
  cwd: string;
  workdir: string;
  timeoutSeconds: number;
  runner?: CommandRunner;
}) {
  ensureCommandAllowed(input.args);
  const cwd = safeResolvePath(input.workdir, input.cwd);
  const timeoutSeconds = Math.max(1, Math.min(60, input.timeoutSeconds));
  const runner = input.runner ?? nodeCommandRunner;
  return runner({
    args: input.args,
    cwd,
    timeoutSeconds,
    env: sandboxEnv(input.workdir)
  });
}
