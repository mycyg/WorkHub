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

// BUG-09：启动失败时不能只剩泛化 fetch 超时——限长保留 stderr 尾部与端口探测轨迹，报告里带全诊断。
const STDERR_TAIL_LIMIT = 16 * 1024;
const PORT_PROBE_TAIL_LIMIT = 10;

type ChromeExitInfo = { code: number | null; signal: NodeJS.Signals | null };

type PortProbe = { at_ms: number; note: string };

async function chromeVersion(chromePath: string) {
  return new Promise<string | null>((resolve) => {
    let output = "";
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(chromePath, ["--version"], { stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      resolve(null);
      return;
    }
    const settle = () => {
      clearTimeout(timer);
      resolve(output.trim() || null);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      settle();
    }, 3_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.on("error", settle);
    child.on("exit", settle);
  });
}

async function waitForDebugTarget(input: {
  port: number;
  timeoutMs: number;
  probes: PortProbe[];
  probeCounter: { total: number };
  childExit: () => ChromeExitInfo | null;
}) {
  const startedAt = Date.now();
  const deadline = startedAt + input.timeoutMs;
  const record = (note: string) => {
    input.probeCounter.total += 1;
    input.probes.push({ at_ms: Date.now() - startedAt, note });
    if (input.probes.length > PORT_PROBE_TAIL_LIMIT) {
      input.probes.shift();
    }
  };
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${input.port}/json/list`, { signal: AbortSignal.timeout(2_000) });
      const pages = await response.json() as Array<{ type?: string; webSocketDebuggerUrl?: string }>;
      const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (page?.webSocketDebuggerUrl) {
        return page.webSocketDebuggerUrl;
      }
      record(`http ${response.status}: ${pages.length} targets, none is a page with webSocketDebuggerUrl`);
    } catch (error) {
      lastError = error;
      record(String(error));
    }
    const exit = input.childExit();
    if (exit) {
      // Chrome 已经死了还傻等整个超时窗只会把真因冲淡成 fetch timeout——立即失败并报退出状态。
      throw new Error(`Chrome exited (code ${String(exit.code)}, signal ${String(exit.signal)}) before the CDP debug port ${input.port} came up`);
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`Timed out waiting for Chrome CDP target: ${String(lastError)}`);
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
  const args = [
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
  ];
  const child = spawn(chromePath, args, { stdio: ["ignore", "ignore", "pipe"] }) as unknown as ChildProcessWithoutNullStreams;
  let stderrTail = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString("utf8")).slice(-STDERR_TAIL_LIMIT);
  });
  let exitInfo: ChromeExitInfo | null = null;
  child.once("exit", (code, signal) => {
    exitInfo = { code, signal };
  });
  const probes: PortProbe[] = [];
  const probeCounter = { total: 0 };
  let cdp: CdpClient | undefined;
  try {
    const websocketUrl = await waitForDebugTarget({
      port: debugPort,
      timeoutMs: options.debugTargetTimeoutMs ?? 45_000,
      probes,
      probeCounter,
      childExit: () => exitInfo
    });
    cdp = await CdpClient.connect(websocketUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    return { child, cdp };
  } catch (error) {
    cdp?.close();
    // 先快照退出状态再 stopChrome,否则诊断里的 exit 会被我们自己的 SIGTERM 污染。
    const exitBeforeStop: ChromeExitInfo | null = exitInfo;
    const [version] = await Promise.all([chromeVersion(chromePath), stopChrome(child)]);
    const diagnostics = {
      chrome_path: chromePath,
      chrome_version: version,
      args,
      exit: exitBeforeStop,
      stderr_tail: stderrTail,
      port_probes: { total: probeCounter.total, tail: probes }
    };
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${message}\nChrome launch diagnostics: ${JSON.stringify(diagnostics, null, 2)}`,
      error instanceof Error ? { cause: error } : undefined
    );
  }
}
