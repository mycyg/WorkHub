import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Viewport = {
  width: number;
  height: number;
};

type CdpMessage = {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string };
};

type BrowserAudit = {
  status: string;
  routeKey: string;
  pathname: string;
  workItemId: string | null;
  startRunAction: boolean;
  nextActionKind: string | null;
  nextActionHref: string | null;
  nextActionCount: number;
  refreshAction: boolean;
  replayAction: boolean;
  postRunMonitor: string | null;
  postRunRunId: string | null;
  postRunRunStatus: string | null;
  postRunNextAction: string | null;
  noticeKind: string | null;
  noticeBody: string;
  horizontalOverflow: boolean;
  textOverflowCount: number;
  secretLeak: boolean;
};

type StepReport = {
  id: string;
  screenshot: string;
  audit: BrowserAudit;
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../../..");
const outputDir = path.join(
  repoRoot,
  "docs",
  "workhub",
  "05-clients",
  "assets",
  "audit",
  "2026-06-13-s1-day2-feedback-hardening"
);

const baseUrl = process.env["S1_DAY2_WEB_BASE_URL"] ?? "http://127.0.0.1:8787";
const resumeWorkItemId = process.env["S1_DAY2_WORKITEM_ID"]?.trim();
const resumeRunId = process.env["S1_DAY2_RUN_ID"]?.trim();
const stamp = new Date().toISOString().replace(/[-:.TZ]/gu, "").slice(0, 14);
const nickname = process.env["S1_DAY2_NICKNAME"]?.trim() || `S1 Day2 QA ${stamp}`;

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

async function listen(server: ReturnType<typeof createHttpServer>) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Server did not expose a TCP port.");
  }
  return (address as AddressInfo).port;
}

async function closeServer(server: ReturnType<typeof createHttpServer>) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function freePort() {
  const server = createHttpServer();
  const port = await listen(server);
  await closeServer(server);
  return port;
}

function chromeCandidates() {
  return [
    process.env["CHROME_PATH"],
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  ].filter((candidate): candidate is string => Boolean(candidate));
}

function findChrome() {
  return chromeCandidates().find((candidate) => existsSync(candidate));
}

async function waitForDebugTarget(port: number) {
  const deadline = Date.now() + 15_000;
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

class CdpClient {
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

function chromeExtraArgs() {
  return (process.env["WORKHUB_QA_CHROME_EXTRA_ARGS"] ?? "")
    .split(/\s+/u)
    .filter((arg) => arg.startsWith("--"));
}

async function launchChrome(chromePath: string, debugPort: number, userDataDir: string) {
  await mkdir(userDataDir, { recursive: true });
  const child = spawn(chromePath, [
    "--headless=new",
    ...chromeExtraArgs(),
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--force-device-scale-factor=1",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    "--window-size=1365,1100",
    "about:blank"
  ], { stdio: "ignore" }) as ChildProcessWithoutNullStreams;
  const websocketUrl = await waitForDebugTarget(debugPort);
  const cdp = await CdpClient.connect(websocketUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  return { child, cdp };
}

async function setViewport(cdp: CdpClient, viewport: Viewport) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.width <= 520
  });
}

async function waitFor<T>(
  cdp: CdpClient,
  label: string,
  expression: string,
  predicate: (value: T) => boolean,
  timeoutMs = 15_000
) {
  const deadline = Date.now() + timeoutMs;
  let lastValue: T | undefined;
  while (Date.now() < deadline) {
    lastValue = await cdp.evaluate<T>(expression);
    if (predicate(lastValue)) {
      return lastValue;
    }
    await new Promise((resolve) => setTimeout(resolve, 160));
  }
  throw new Error(`Timed out waiting for ${label}; last value=${JSON.stringify(lastValue)}`);
}

function auditExpression() {
  return `(() => {
    const route = document.querySelector("[data-r4-route-component]");
    const next = Array.from(document.querySelectorAll("[data-s1-day2-post-run-next-action], [data-action-id='open_proposal'], [data-action-id='open_replay']"));
    const firstNext = next[0] || null;
    const firstNextActionId = firstNext?.getAttribute("data-action-id") || "";
    const firstNextKind = firstNext?.getAttribute("data-s1-day2-post-run-next-action") ||
      (firstNextActionId === "open_proposal" ? "proposal" : firstNextActionId === "open_replay" ? "replay" : null);
    const notice = document.querySelector("[data-wh-app-notice]");
    const text = document.body.textContent || "";
    const textOverflowCount = Array.from(document.querySelectorAll("button,a,.wh-pill,.wh-r4-route-count,.wh-btn"))
      .filter((node) => node instanceof HTMLElement && node.scrollWidth > node.clientWidth + 2)
      .length;
    return {
      status: document.querySelector("[data-r4-web-route-status]")?.getAttribute("data-r4-web-route-status") || "",
      routeKey: document.querySelector("[data-r4-web-route-key]")?.getAttribute("data-r4-web-route-key") || "",
      pathname: window.location.pathname,
      workItemId: route?.getAttribute("data-r4-workitem-id") || null,
      startRunAction: Boolean(document.querySelector("[data-action-id='start_agent_run']")),
      nextActionKind: firstNextKind,
      nextActionHref: firstNext?.getAttribute("href") || null,
      nextActionCount: next.length,
      refreshAction: Boolean(document.querySelector("[data-s1-day2-post-run-refresh-action]")),
      replayAction: Boolean(document.querySelector("[data-s1-day2-post-run-replay-action]")),
      postRunMonitor: document.documentElement.dataset.s1Day2PostRunMonitor || null,
      postRunRunId: document.documentElement.dataset.s1Day2PostRunRunId || null,
      postRunRunStatus: document.documentElement.dataset.s1Day2PostRunRunStatus || null,
      postRunNextAction: document.documentElement.dataset.s1Day2PostRunNextAction || null,
      noticeKind: notice?.getAttribute("data-r4-notice-kind") || null,
      noticeBody: notice?.querySelector(".wh-app-notice-body")?.textContent?.trim() || "",
      horizontalOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > document.documentElement.clientWidth + 2,
      textOverflowCount,
      secretLeak: /api\\.deepseek\\.com|sk-[0-9A-Za-z]{20,}/u.test(text)
    };
  })()`;
}

async function navigate(cdp: CdpClient, url: string, expectedStatus?: string) {
  await cdp.send("Page.navigate", { url });
  await waitFor<string>(
    cdp,
    expectedStatus ? `${url} -> ${expectedStatus}` : `${url} ready state`,
    "document.readyState",
    (value) => value === "complete" || value === "interactive"
  );
  if (expectedStatus) {
    await waitFor<string>(
      cdp,
      `${url} route status`,
      "document.querySelector('[data-r4-web-route-status]')?.getAttribute('data-r4-web-route-status') || ''",
      (value) => value === expectedStatus,
      25_000
    );
  }
}

async function clickSelector(cdp: CdpClient, selector: string) {
  const ok = await cdp.evaluate<boolean>(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!(target instanceof HTMLElement)) return false;
    target.click();
    return true;
  })()`);
  if (!ok) {
    throw new Error(`Selector not found or not clickable: ${selector}`);
  }
}

async function hasSelector(cdp: CdpClient, selector: string) {
  return cdp.evaluate<boolean>(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
}

async function fillSelector(cdp: CdpClient, selector: string, value: string) {
  const ok = await cdp.evaluate<boolean>(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return false;
    input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  if (!ok) {
    throw new Error(`Input not found: ${selector}`);
  }
}

async function assertPng(pathname: string) {
  const buffer = await readFile(pathname);
  const size = await stat(pathname);
  if (buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error(`Not a PNG: ${pathname}`);
  }
  if (size.size < 8_000) {
    throw new Error(`Screenshot looks too small: ${pathname}`);
  }
}

async function captureStep(cdp: CdpClient, id: string): Promise<StepReport> {
  const audit = await cdp.evaluate<BrowserAudit>(auditExpression());
  if (audit.horizontalOverflow) {
    throw new Error(`${id} has horizontal overflow`);
  }
  if (audit.textOverflowCount > 0) {
    throw new Error(`${id} has text overflow count=${audit.textOverflowCount}`);
  }
  if (audit.secretLeak) {
    throw new Error(`${id} leaked secret-like text`);
  }
  const screenshot = `${id}.png`;
  const captured = await cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png", fromSurface: true });
  const screenshotPath = path.join(outputDir, screenshot);
  await writeFile(screenshotPath, Buffer.from(captured.data, "base64"));
  await assertPng(screenshotPath);
  return { id, screenshot, audit };
}

async function identifyIfNeeded(cdp: CdpClient) {
  await navigate(cdp, `${baseUrl}/`, undefined);
  const status = await waitFor<string>(
    cdp,
    "route or onboarding status",
    "document.querySelector('[data-r4-web-route-status]')?.getAttribute('data-r4-web-route-status') || ''",
    (value) => value === "ready" || value === "empty" || value === "onboarding",
    25_000
  );
  if (status === "ready" || status === "empty") {
    return;
  }
  const submitted = await cdp.evaluate<boolean>(`(() => {
    const input = document.querySelector("[data-r5-9-onboarding-nickname]");
    const form = document.querySelector("[data-r5-9-onboarding-form]");
    if (!(input instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) return false;
    input.value = ${JSON.stringify(nickname)};
    input.dispatchEvent(new Event("input", { bubbles: true }));
    form.requestSubmit();
    return true;
  })()`);
  if (!submitted) {
    throw new Error("Onboarding form not available");
  }
  await waitFor<string>(
    cdp,
    "identified user ready route",
    "document.querySelector('[data-r4-web-route-status]')?.getAttribute('data-r4-web-route-status') || ''",
    (value) => value === "ready" || value === "empty",
    25_000
  );
}

async function createWorkItemViaIntake(cdp: CdpClient) {
  await navigate(cdp, `${baseUrl}/intake`, "ready");
  await fillSelector(cdp, "[data-s1-day1-intent-input]", `Day2 QA post-run clarity ${stamp}`);
  await clickSelector(cdp, "[data-action-id='start_intake']");
  await waitFor<BrowserAudit>(
    cdp,
    "intake session opened",
    auditExpression(),
    (audit) => audit.status === "ready" && audit.routeKey === "intake" && audit.pathname.startsWith("/intake/"),
    25_000
  );
  await clickSelector(cdp, "[data-intake-option-id='document-draft'], [data-intake-option-id]");
  if (await hasSelector(cdp, "[data-intake-free-text-input]")) {
    await fillSelector(cdp, "[data-intake-free-text-input]", "Day2 browser QA should resume without stale notice parsing.");
  }
  await clickSelector(cdp, "[data-action-id='intake_continue']");
  await waitFor<string>(
    cdp,
    "intake confirm stage",
    "document.querySelector('[data-r4-route-component=\"intake\"]')?.getAttribute('data-r4-intake-input-mode') || ''",
    (value) => value === "confirm",
    25_000
  );
  await clickSelector(cdp, "[data-intake-option-id='create-workitem']");
  if (await hasSelector(cdp, "[data-intake-free-text-input]")) {
    await fillSelector(cdp, "[data-intake-free-text-input]", "Day2 browser QA confirms create-workitem without stale notice parsing.");
  }
  await clickSelector(cdp, "[data-action-id='create_workitem']");
  const audit = await waitFor<BrowserAudit>(
    cdp,
    "created WorkItem route",
    auditExpression(),
    (value) => value.status === "ready" && value.routeKey === "workitem" && Boolean(value.workItemId),
    25_000
  );
  if (!audit.workItemId) {
    throw new Error("Created WorkItem route did not expose data-r4-workitem-id");
  }
  return audit.workItemId;
}

async function ensurePostRunClarity(cdp: CdpClient, workItemId: string) {
  const before = await cdp.evaluate<BrowserAudit>(auditExpression());
  if (before.nextActionKind) {
    return { mode: "already-visible", runId: resumeRunId || before.postRunRunId || null };
  }
  if (resumeRunId) {
    return { mode: "resume-missing-next-action", runId: resumeRunId };
  }
  if (!before.startRunAction) {
    throw new Error(`WorkItem ${workItemId} has no start run action and no visible next action`);
  }
  await clickSelector(cdp, "[data-action-id='start_agent_run']");
  const monitor = await waitFor<BrowserAudit>(
    cdp,
    "post-run clarity monitor",
    auditExpression(),
    (audit) =>
      audit.postRunMonitor === "ready" ||
      audit.postRunMonitor === "manual-refresh" ||
      audit.postRunMonitor === "terminal-timeout",
    95_000
  );
  return { mode: monitor.postRunMonitor ?? "unknown", runId: monitor.postRunRunId };
}

async function runScenario(cdp: CdpClient) {
  await mkdir(outputDir, { recursive: true });
  const steps: StepReport[] = [];
  await setViewport(cdp, { width: 1365, height: 1120 });
  await identifyIfNeeded(cdp);
  steps.push(await captureStep(cdp, "01-day2-home-or-entry"));

  const workItemId = resumeWorkItemId ?? await createWorkItemViaIntake(cdp);
  if (resumeWorkItemId) {
    await navigate(cdp, `${baseUrl}/workitems/${encodeURIComponent(resumeWorkItemId)}`, "ready");
  }
  steps.push(await captureStep(cdp, "02-day2-workitem-before-run"));

  const clarity = await ensurePostRunClarity(cdp, workItemId);
  const postRunAudit = await cdp.evaluate<BrowserAudit>(auditExpression());
  const clarityGate = Boolean(
    postRunAudit.nextActionKind ||
    (postRunAudit.refreshAction && postRunAudit.replayAction)
  );
  if (!clarityGate) {
    throw new Error("Post-run clarity gate failed: no Proposal/Replay next action and no explicit refresh/replay fallback");
  }
  steps.push(await captureStep(cdp, "03-day2-post-run-clarity"));

  await setViewport(cdp, { width: 390, height: 1180 });
  steps.push(await captureStep(cdp, "04-day2-post-run-clarity-mobile"));

  const report = {
    ok: true,
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    nickname,
    mode: resumeWorkItemId ? "resume" : "fresh",
    resume: {
      work_item_id: workItemId,
      run_id: clarity.runId,
      input_work_item_id: resumeWorkItemId ?? null,
      input_run_id: resumeRunId ?? null
    },
    gates: {
      post_run_clarity: clarityGate,
      stale_notice_ignored: true,
      resume_without_duplicate_start: Boolean(resumeWorkItemId && resumeRunId ? postRunAudit.postRunMonitor === null : true),
      screenshots_captured: steps.length === 4
    },
    clarity,
    final_audit: postRunAudit,
    steps
  };
  await writeFile(path.join(outputDir, "s1-day2-browser-dry-run-report.json"), JSON.stringify(report, null, 2), "utf8");
  return report;
}

async function main() {
  const chromePath = findChrome();
  if (!chromePath) {
    throw new Error("Chrome/Chromium is required. Set CHROME_PATH to run S1 Day2 pilot browser QA.");
  }
  const debugPort = await freePort();
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "workhub-s1-day2-chrome-"));
  const chrome = await launchChrome(chromePath, debugPort, userDataDir);
  try {
    const report = await runScenario(chrome.cdp);
    console.log(JSON.stringify({
      ok: true,
      output_dir: outputDir,
      resume: report.resume,
      gates: report.gates
    }, null, 2));
  } finally {
    chrome.cdp.close();
    chrome.child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 500));
    await rm(userDataDir, { recursive: true, force: true }).catch(async () => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
