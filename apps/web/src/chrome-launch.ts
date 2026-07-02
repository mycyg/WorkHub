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

async function waitForDebugTarget(port: number, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
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
  ], { stdio: "ignore" }) as ChildProcessWithoutNullStreams;
  let cdp: CdpClient | undefined;
  try {
    const websocketUrl = await waitForDebugTarget(debugPort, options.debugTargetTimeoutMs);
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
