import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";

type CdpMessage = {
  id?: number;
  method?: string;
  result?: unknown;
  error?: { message?: string };
};

export class CdpClient {
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as CdpMessage;
      if (!message.id) {
        return;
      }
      const waiter = this.pending.get(message.id);
      if (!waiter) {
        return;
      }
      this.pending.delete(message.id);
      if (message.error) {
        waiter.reject(new Error(message.error.message ?? "CDP command failed"));
      } else {
        waiter.resolve(message.result);
      }
    });
  }

  static async connect(url: string) {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("Chrome CDP websocket failed to open")), { once: true });
    });
    return new CdpClient(socket);
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}) {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.socket.send(payload);
    });
  }

  async evaluate<T>(expression: string) {
    const result = await this.send<{
      result?: { value?: T };
      exceptionDetails?: { text?: string };
    }>("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text ?? `Evaluation failed: ${expression}`);
    }
    return result.result?.value as T;
  }

  close() {
    this.socket.close();
  }
}

async function stopChrome(child: ChildProcessWithoutNullStreams | undefined) {
  if (!child || child.exitCode !== null) {
    return;
  }
  child.kill();
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 1200);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

const stderrTailLimit = 4000;

// R20 P2-11：launchChrome 失败此前只抛「Timed out waiting for Chrome CDP target: <fetch 错误>」——
// fetch 错误几乎总是 ECONNREFUSED（端口没起来），从不告诉你 Chrome 进程本身是否真的启动了、
// 是不是秒退了、退出码/信号是什么、路径对不对、stderr 里有没有真正的根因（缺共享库/沙箱权限/
// profile 损坏……）。QA 排障只能本地重跑加日志。这里把 spawn 错误码、进程提前退出的 exit
// code/signal、stderr 尾部、以及 chromePath/debugPort/userDataDir 全部收进同一条结构化错误信息里。
function describeExit(code: number | null, signal: NodeJS.Signals | null): string {
  if (signal) {
    return `signal ${signal}`;
  }
  return `exit code ${code ?? "null"}`;
}

type LaunchFailureContext = {
  chromePath: string;
  debugPort: number;
  userDataDir: string;
};

function buildLaunchFailureMessage(context: LaunchFailureContext, reason: string, stderrTail: string): string {
  const parts = [
    reason,
    `chromePath=${context.chromePath}`,
    `debugPort=${context.debugPort}`,
    `userDataDir=${context.userDataDir}`
  ];
  if (stderrTail.trim()) {
    parts.push(`stderr=${JSON.stringify(stderrTail.trim())}`);
  }
  return parts.join(" | ");
}

async function waitForDebugTarget(
  child: ChildProcessWithoutNullStreams,
  context: LaunchFailureContext,
  timeoutMs: number,
  getStderrTail: () => string
) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  let spawnError: NodeJS.ErrnoException | undefined;
  const onSpawnError = (error: NodeJS.ErrnoException) => {
    spawnError = error;
  };
  child.on("error", onSpawnError);
  try {
    while (Date.now() < deadline) {
      if (spawnError) {
        throw new Error(
          buildLaunchFailureMessage(
            context,
            `Chrome process failed to spawn (${spawnError.code ?? spawnError.message})`,
            getStderrTail()
          )
        );
      }
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(
          buildLaunchFailureMessage(
            context,
            `Chrome process exited before its CDP debug target came up (${describeExit(child.exitCode, child.signalCode)})`,
            getStderrTail()
          )
        );
      }
      try {
        const response = await fetch(`http://127.0.0.1:${context.debugPort}/json/list`);
        const pages = await response.json() as Array<{ type?: string; webSocketDebuggerUrl?: string }>;
        const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
        if (page?.webSocketDebuggerUrl) {
          return page.webSocketDebuggerUrl;
        }
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    throw new Error(
      buildLaunchFailureMessage(context, `Timed out waiting for Chrome CDP target: ${String(lastError)}`, getStderrTail())
    );
  } finally {
    child.off("error", onSpawnError);
  }
}

function chromeExtraArgs() {
  // CI runners need sandbox/dev-shm flags; local macOS runs keep the default Chrome profile isolated by user-data-dir.
  return (process.env["WORKHUB_QA_CHROME_EXTRA_ARGS"] ?? "")
    .split(/\s+/u)
    .filter((arg) => arg.startsWith("--"));
}

export async function launchChrome(
  chromePath: string,
  debugPort: number,
  userDataDir: string,
  options: { debugTargetTimeoutMs?: number } = {}
) {
  await rm(userDataDir, { recursive: true, force: true });
  await mkdir(userDataDir, { recursive: true });
  const context: LaunchFailureContext = { chromePath, debugPort, userDataDir };
  const child = spawn(chromePath, [
    "--headless=new",
    ...chromeExtraArgs(),
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--force-device-scale-factor=1",
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    "--window-size=1365,1100",
    "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] }) as unknown as ChildProcessWithoutNullStreams;

  let stderrTail = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString("utf8")).slice(-stderrTailLimit);
  });
  // Avoid an unhandled 'error' on the stderr stream itself turning into noise unrelated to the launch outcome.
  child.stderr.on("error", () => undefined);

  let cdp: CdpClient | undefined;
  try {
    const websocketUrl = await waitForDebugTarget(child, context, options.debugTargetTimeoutMs ?? 45_000, () => stderrTail);
    cdp = await CdpClient.connect(websocketUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    return { child, cdp };
  } catch (error) {
    cdp?.close();
    await stopChrome(child);
    throw error;
  }
}
