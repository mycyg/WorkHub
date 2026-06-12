import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { settings } from "@workhub/config";
import {
  createDatabaseClient,
  r4WebLiveApiPgSeedIds,
  runMigrations,
  seedR4WebLiveApiPg,
  type R4WebLiveApiPgSeedResult
} from "@workhub/db";
import { createServer as createViteServer, type ViteDevServer } from "vite";

type Viewport = { width: number; height: number };
type CdpMessage = { id?: number; method?: string; params?: unknown; result?: unknown; error?: { message?: string } };
type ApiRequestRecord = { pathname: string; search: string; locale: string | null; url: string };
type BrowserAudit = {
  pathname: string;
  lang: string;
  status: string;
  routeKey: string;
  productShell: boolean;
  activeLocale: string | null;
  mastheadTitle: string;
  bodyText: string;
  metricValues: Record<string, string>;
  clientWidth: number;
  scrollWidth: number;
  horizontalOverflow: boolean;
  textOverflowCount: number;
  textOverflowSamples: string[];
  cuuLeak: boolean;
  kanbanLeak: boolean;
  hashNavigationLeak: boolean;
};
type StepReport = { id: string; url: string; viewport: Viewport; screenshot: string; audit: BrowserAudit };

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../../..");
const webRoot = path.join(repoRoot, "apps", "web");
const outputDir = path.join(
  repoRoot,
  "docs",
  "workhub",
  "05-clients",
  "assets",
  "audit",
  "2026-06-11-r4-web-locale-metrics-browser-smoke"
);

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

async function freePort() {
  const server = createHttpServer();
  const port = await listen(server);
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function chromeCandidates() {
  return [
    process.env["CHROME_PATH"],
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter((candidate): candidate is string => Boolean(candidate));
}

function findChrome() {
  return chromeCandidates().find((candidate) => existsSync(candidate));
}

async function waitForHttpOk(url: string, label: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = new Error(`${label} returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 160));
  }
  throw new Error(`Timed out waiting for ${label}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function tailLines(lines: string[], limit = 18) {
  return lines.slice(Math.max(0, lines.length - limit));
}

async function stopProcess(child: ChildProcessWithoutNullStreams | undefined) {
  if (!child || child.exitCode !== null) {
    return;
  }
  child.kill();
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 1500);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function seedDatabase() {
  if (settings.appEnv === "production") {
    throw new Error("Refusing to run R4.9 locale metrics browser smoke with APP_ENV=production.");
  }
  await runMigrations(settings);
  const client = createDatabaseClient();
  try {
    return await seedR4WebLiveApiPg(client.db);
  } finally {
    await client.close();
  }
}

async function startApiServer(port: number) {
  const logs: string[] = [];
  const child = spawn(process.execPath, ["--import", "tsx", path.join(repoRoot, "apps", "api", "src", "server.ts")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      APP_ENV: "test",
      PORT: String(port),
      API_HOST: "127.0.0.1",
      DATABASE_URL: settings.databaseUrl,
      TSX_TSCONFIG_PATH: path.join(repoRoot, "tsconfig.base.json"),
      BROKER_BACKEND: process.env["BROKER_BACKEND"] ?? "memory",
      BROKER_URL: process.env["BROKER_URL"] ?? "",
      WORKER_COUNT: process.env["WORKER_COUNT"] ?? "1",
      AGENT_RUN_RECOVERY_INTERVAL_MS: "0"
    }
  });
  child.stdout.on("data", (chunk) => logs.push(String(chunk).trim()));
  child.stderr.on("data", (chunk) => logs.push(String(chunk).trim()));
  child.once("exit", (code, signal) => logs.push(`api process exited code=${String(code)} signal=${String(signal)}`));
  try {
    await waitForHttpOk(`http://127.0.0.1:${port}/api/health`, "WorkHub API health");
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nAPI log tail:\n${tailLines(logs).join("\n")}`);
  }
  return { child, logs };
}

class CdpClient {
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private handlers = new Map<string, Array<(params: unknown) => void>>();

  constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as CdpMessage;
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id)!;
        this.pending.delete(message.id);
        if (message.error) {
          pending.reject(new Error(message.error.message ?? "CDP command failed"));
        } else {
          pending.resolve(message.result);
        }
        return;
      }
      if (message.method) {
        for (const handler of this.handlers.get(message.method) ?? []) {
          handler(message.params);
        }
      }
    });
  }

  on(method: string, handler: (params: unknown) => void) {
    const handlers = this.handlers.get(method) ?? [];
    handlers.push(handler);
    this.handlers.set(method, handlers);
  }

  async send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++;
    const promise = new Promise<unknown>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.socket.send(JSON.stringify({ id, method, params }));
    return await promise as T;
  }

  async evaluate<T>(expression: string): Promise<T> {
    const result = await this.send<{ result: { value?: T }; exceptionDetails?: unknown }>("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (result.exceptionDetails) {
      throw new Error(`Browser evaluation failed: ${JSON.stringify(result.exceptionDetails)}`);
    }
    return result.result.value as T;
  }

  close() {
    this.socket.close();
  }
}

async function waitForDebugTarget(port: number) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const pages = await response.json() as Array<{ type?: string; webSocketDebuggerUrl?: string }>;
      const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (page?.webSocketDebuggerUrl) {
        return page.webSocketDebuggerUrl;
      }
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error("Timed out waiting for Chrome CDP target.");
}

async function launchChrome(chromePath: string, debugPort: number, userDataDir: string) {
  const child = spawn(chromePath, [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--force-device-scale-factor=1",
    "--window-size=1365,1120",
    "about:blank"
  ], { stdio: "ignore" });
  const socket = new WebSocket(await waitForDebugTarget(debugPort));
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("Chrome CDP socket failed to open")), { once: true });
  });
  const cdp = new CdpClient(socket);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  return { child, cdp };
}

function apiRequestFromUrl(url: string): ApiRequestRecord | undefined {
  const parsed = new URL(url);
  if (!parsed.pathname.startsWith("/api/")) {
    return undefined;
  }
  return {
    pathname: parsed.pathname,
    search: parsed.search,
    locale: parsed.searchParams.get("locale"),
    url
  };
}

function collectApiRequests(cdp: CdpClient, records: ApiRequestRecord[]) {
  cdp.on("Network.requestWillBeSent", (params) => {
    const request = (params as { request?: { url?: string } })?.request;
    if (!request?.url) {
      return;
    }
    const record = apiRequestFromUrl(request.url);
    if (record) {
      records.push(record);
    }
  });
}

async function setViewport(cdp: CdpClient, viewport: Viewport) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.width < 600
  });
}

async function waitFor<T>(cdp: CdpClient, label: string, expression: string, predicate: (value: T) => boolean, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await cdp.evaluate<T>(expression);
    if (predicate(last)) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`Timed out waiting for ${label}; last value=${JSON.stringify(last)}`);
}


async function registerThroughOnboarding(cdp: CdpClient, baseUrl: string, nickname: string) {
  await cdp.send("Page.navigate", { url: `${baseUrl}/` });
  await waitFor<string>(
    cdp,
    "boot -> onboarding/ready",
    "document.querySelector('[data-r4-web-route-status]')?.getAttribute('data-r4-web-route-status') || ''",
    (value) => value === "onboarding" || value === "ready"
  );
  const status = await cdp.evaluate<string>(
    "document.querySelector('[data-r4-web-route-status]')?.getAttribute('data-r4-web-route-status') || ''"
  );
  if (status === "ready") {
    return;
  }
  const filled = await cdp.evaluate<boolean>(`(() => {
    const input = document.querySelector("[data-r5-9-onboarding-nickname]");
    const form = document.querySelector("[data-r5-9-onboarding-form]");
    if (!input || !form) return false;
    input.value = ${JSON.stringify(nickname)};
    form.requestSubmit();
    return true;
  })()`);
  if (!filled) {
    throw new Error("Onboarding form not found for scripted registration");
  }
  await waitFor<string>(
    cdp,
    `register ${nickname} -> ready`,
    "document.querySelector('[data-r4-web-route-status]')?.getAttribute('data-r4-web-route-status') || ''",
    (value) => value === "ready"
  );
}

async function navigate(cdp: CdpClient, url: string, expectedRouteKey: string) {
  await cdp.send("Page.navigate", { url });
  await waitFor<BrowserAudit>(
    cdp,
    `${expectedRouteKey} ready`,
    auditExpression(),
    (audit) => audit.status === "ready" && audit.routeKey === expectedRouteKey && audit.productShell
  );
}

async function click(cdp: CdpClient, selector: string) {
  await cdp.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error("missing selector " + ${JSON.stringify(selector)});
    element.click();
    return true;
  })()`);
}

function auditExpression() {
  return `(() => {
    const text = document.body.innerText || "";
    const metricValues = Object.fromEntries(Array.from(document.querySelectorAll("[data-r4-product-metric]")).map((node) => [
      node.getAttribute("data-r4-product-metric") || "",
      (node.querySelector("strong")?.textContent || "").trim()
    ]));
    const textContainerSelector = ".wh-card,.wh-panel,.wh-product-metric,.wh-product-masthead,.wh-product-rail-block,.wh-row,.wh-actions";
    const textOverflowSamples = Array.from(document.querySelectorAll("a,button,span,p,h1,h2,h3,h4,strong,small,li,label,time"))
      .flatMap((element) => {
        const htmlElement = element;
        const style = window.getComputedStyle(htmlElement);
        const rect = htmlElement.getBoundingClientRect();
        const visible = style.display !== "none" && style.visibility !== "hidden" && rect.width > 1 && rect.height > 1;
        const value = (htmlElement.textContent || "").replace(/\\s+/g, " ").trim();
        if (!visible || !value) return [];
        const explicitTextClip = style.textOverflow === "ellipsis" && (style.whiteSpace === "nowrap" || (style.webkitLineClamp && style.webkitLineClamp !== "none"));
        const scrollArea = ["auto", "scroll"].includes(style.overflowX) || ["auto", "scroll"].includes(style.overflowY);
        const horizontalLeak = Math.ceil(htmlElement.scrollWidth) > Math.ceil(htmlElement.clientWidth) + 2 && !explicitTextClip && !scrollArea;
        const verticalLeak = Math.ceil(htmlElement.scrollHeight) > Math.ceil(htmlElement.clientHeight) + 2 && !explicitTextClip && !scrollArea;
        const container = htmlElement.parentElement ? htmlElement.parentElement.closest(textContainerSelector) : null;
        const containerRect = container ? container.getBoundingClientRect() : null;
        const containmentLeak = Boolean(containerRect && (rect.left < containerRect.left - 2 || rect.right > containerRect.right + 2 || rect.top < containerRect.top - 2 || rect.bottom > containerRect.bottom + 2));
        if (!horizontalLeak && !verticalLeak && !containmentLeak) return [];
        return [htmlElement.tagName.toLowerCase() + " " + JSON.stringify(value.slice(0, 96))];
      });
    const statusRoot = document.querySelector("[data-r4-web-route-status]");
    const routeRoot = document.querySelector("[data-r4-product-shell]");
    return {
      pathname: location.pathname,
      lang: document.documentElement.lang,
      status: statusRoot?.getAttribute("data-r4-web-route-status") || "missing",
      routeKey: statusRoot?.getAttribute("data-r4-web-route-key") || routeRoot?.getAttribute("data-r4-product-route-key") || "missing",
      productShell: Boolean(routeRoot),
      activeLocale: document.querySelector("[data-wh-locale][aria-pressed=true]")?.getAttribute("data-wh-locale") || null,
      mastheadTitle: document.querySelector(".wh-product-masthead h1")?.textContent?.trim() || "",
      bodyText: text,
      metricValues,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      textOverflowCount: textOverflowSamples.length,
      textOverflowSamples: textOverflowSamples.slice(0, 8),
      cuuLeak: text.includes("Cuu") || Boolean(document.querySelector("[data-cuu-card]")),
      kanbanLeak: text.toLowerCase().includes("kanban"),
      hashNavigationLeak: Boolean(document.querySelector('a[href^="#/"]'))
    };
  })()`;
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

async function captureStep(cdp: CdpClient, input: { id: string; url: string; viewport: Viewport }): Promise<StepReport> {
  const audit = await cdp.evaluate<BrowserAudit>(auditExpression());
  if (audit.horizontalOverflow || audit.textOverflowCount > 0) {
    throw new Error(`${input.id} overflow: ${audit.textOverflowSamples.join("; ")}`);
  }
  if (audit.cuuLeak || audit.kanbanLeak || audit.hashNavigationLeak) {
    throw new Error(`${input.id} boundary leak: ${JSON.stringify({
      cuu: audit.cuuLeak,
      kanban: audit.kanbanLeak,
      hash: audit.hashNavigationLeak
    })}`);
  }
  const screenshot = `${input.id}.png`;
  const captured = await cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile(path.join(outputDir, screenshot), Buffer.from(captured.data, "base64"));
  await assertPng(path.join(outputDir, screenshot));
  return { ...input, screenshot, audit };
}

function contactSheetDocument(steps: StepReport[]) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>R4.9 Locale Metrics Contact Sheet</title>
  <style>body{margin:0;background:#eef4fb;color:#172033;font-family:Aptos,Segoe UI,sans-serif}main{padding:18px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}figure{margin:0;border:1px solid #dce4f1;border-radius:8px;background:#fff;padding:10px}figcaption{font-size:12px;font-weight:850;color:#66728c;margin:0 0 8px;overflow-wrap:anywhere}img{display:block;width:100%;height:auto;border-radius:6px;border:1px solid #e5ecf5}</style>
  </head><body><main>${steps.map((step) => `<figure><figcaption>${escapeHtml(step.id)} · ${escapeHtml(step.audit.pathname)} · ${escapeHtml(step.audit.mastheadTitle)}</figcaption><img src="${escapeHtml(step.screenshot)}" alt="${escapeHtml(step.id)}" /></figure>`).join("")}</main></body></html>`;
}

async function captureContactSheet(cdp: CdpClient, steps: StepReport[]) {
  const htmlPath = path.join(outputDir, "contact-sheet.html");
  const screenshotPath = path.join(outputDir, "contact-sheet.png");
  await writeFile(htmlPath, contactSheetDocument(steps), "utf8");
  await setViewport(cdp, { width: 1365, height: 1200 });
  await cdp.send("Page.navigate", { url: pathToFileURL(htmlPath).href });
  await new Promise((resolve) => setTimeout(resolve, 450));
  const captured = await cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile(screenshotPath, Buffer.from(captured.data, "base64"));
  await assertPng(screenshotPath);
}

async function identify(apiTarget: string) {
  const response = await fetch(`${apiTarget}/api/auth/identify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname: "P0.5 Reviewer" })
  });
  if (!response.ok) {
    throw new Error(`identify failed ${response.status}: ${await response.text()}`);
  }
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) {
    throw new Error("identify did not return a cookie");
  }
  return cookie;
}

async function apiJson<T>(apiTarget: string, cookie: string, pathWithQuery: string): Promise<{ data: T; meta?: { locale?: string } }> {
  const response = await fetch(`${apiTarget}${pathWithQuery}`, { headers: { Cookie: cookie } });
  if (!response.ok) {
    throw new Error(`${pathWithQuery} failed ${response.status}: ${await response.text()}`);
  }
  return await response.json() as { ok: true; data: T; meta?: { locale?: string } };
}

async function runBrowserScenario(cdp: CdpClient, baseUrl: string, seed: R4WebLiveApiPgSeedResult) {
  const desktop = { width: 1365, height: 1120 };
  const mobile = { width: 390, height: 1180 };
  const ids = seed.ids;
  const steps: StepReport[] = [];

  await setViewport(cdp, desktop);
  await registerThroughOnboarding(cdp, baseUrl, "P0.5 Reviewer");
  await navigate(cdp, `${baseUrl}/workitems/${ids.workItemId}`, "workitem");
  steps.push(await captureStep(cdp, {
    id: "01-workitem-zh-desktop-locale-metrics",
    url: `${baseUrl}/workitems/${ids.workItemId}`,
    viewport: desktop
  }));

  await click(cdp, '[data-wh-locale="en-US"]');
  await waitFor<BrowserAudit>(
    cdp,
    "workitem English reload",
    auditExpression(),
    (audit) => audit.lang === "en-US" && audit.activeLocale === "en-US" && audit.mastheadTitle === "WorkItem Detail"
  );

  await navigate(cdp, `${baseUrl}/proposals/${ids.proposalId}`, "proposal");
  steps.push(await captureStep(cdp, {
    id: "02-proposal-en-desktop-locale-actions",
    url: `${baseUrl}/proposals/${ids.proposalId}`,
    viewport: desktop
  }));

  await navigate(cdp, `${baseUrl}/agent-runs/${ids.runId}/replay`, "replay");
  steps.push(await captureStep(cdp, {
    id: "03-replay-en-desktop-vm-metrics",
    url: `${baseUrl}/agent-runs/${ids.runId}/replay`,
    viewport: desktop
  }));

  await setViewport(cdp, mobile);
  await navigate(cdp, `${baseUrl}/dashboard/cost`, "cost");
  steps.push(await captureStep(cdp, {
    id: "04-cost-en-mobile-vm-metrics",
    url: `${baseUrl}/dashboard/cost`,
    viewport: mobile
  }));

  return steps;
}

async function main() {
  const chromePath = findChrome();
  if (!chromePath) {
    throw new Error("Chrome/Chromium is required. Set CHROME_PATH to run R4.9 locale metrics smoke.");
  }

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  const seed = await seedDatabase();
  const apiPort = await freePort();
  const vitePort = await freePort();
  const debugPort = await freePort();
  const apiTarget = `http://127.0.0.1:${apiPort}`;
  const userDataDir = path.join(os.tmpdir(), `workhub-r4-locale-metrics-${Date.now()}`);
  let api: Awaited<ReturnType<typeof startApiServer>> | undefined;
  let viteServer: ViteDevServer | undefined;
  let chrome: { child: ChildProcessWithoutNullStreams; cdp: CdpClient } | undefined;
  const apiRequests: ApiRequestRecord[] = [];

  try {
    api = await startApiServer(apiPort);
    viteServer = await createViteServer({
      configFile: false,
      root: webRoot,
      server: {
        host: "127.0.0.1",
        port: vitePort,
        strictPort: true,
        proxy: {
          "/api": apiTarget,
          "/openapi.json": apiTarget
        }
      }
    });
    await viteServer.listen();
    await waitForHttpOk(`http://127.0.0.1:${vitePort}/`, "Vite Web dev server");
    const baseUrl = `http://127.0.0.1:${vitePort}`;
    const cookie = await identify(apiTarget);
    const proposal = await apiJson<{ review_actions: { approve: { label: string }; request_changes: { label: string }; merge?: { label: string } }; title: string }>(
      apiTarget,
      cookie,
      `/api/pages/proposals/${seed.ids.proposalId}?locale=en-US`
    );
    const replay = await apiJson<{ run: { handoff_md?: string }; steps: unknown[]; cost?: { me: { scope_label: string } } }>(
      apiTarget,
      cookie,
      `/api/agent-runs/${seed.ids.runId}/replay?locale=en-US`
    );
    const cost = await apiJson<{ token_in: number; token_out: number; total_cost_cny: string; budget: Array<{ scope_label: string }> }>(
      apiTarget,
      cookie,
      "/api/pages/cost?locale=en-US"
    );

    chrome = await launchChrome(chromePath, debugPort, userDataDir);
    collectApiRequests(chrome.cdp, apiRequests);
    const steps = await runBrowserScenario(chrome.cdp, baseUrl, seed);
    await captureContactSheet(chrome.cdp, steps);

    const replayStepMetric = steps.find((step) => step.id.startsWith("03-"))?.audit.metricValues.steps;
    const costStep = steps.find((step) => step.id.startsWith("04-"));
    const gates = {
      pg_seed_applied: seed.ids.workItemId === r4WebLiveApiPgSeedIds.workItemId,
      proposal_locale_meta_en: proposal.meta?.locale === "en-US",
      proposal_actions_english:
        proposal.data.review_actions.approve.label === "Approve" &&
        proposal.data.review_actions.request_changes.label === "Request changes with a reason" &&
        proposal.data.review_actions.merge?.label === "Accept into the official version",
      replay_locale_meta_en: replay.meta?.locale === "en-US",
      replay_handoff_english: replay.data.run.handoff_md?.startsWith("Done: ") === true,
      replay_cost_scope_english: replay.data.cost?.me.scope_label === "My current AI run budget",
      cost_locale_meta_en: cost.meta?.locale === "en-US",
      cost_scope_labels_english:
        cost.data.budget.some((item) => item.scope_label === "My AI budget today") &&
        cost.data.budget.some((item) => item.scope_label === "Team AI budget today"),
      browser_replay_requested_locale:
        apiRequests.some((request) => request.pathname === `/api/agent-runs/${seed.ids.runId}/replay` && request.locale === "en-US"),
      replay_metric_matches_vm: replayStepMetric === String(replay.data.steps.length),
      cost_metric_matches_vm:
        costStep?.audit.metricValues.tokens === String(cost.data.token_in + cost.data.token_out) &&
        costStep.audit.metricValues.cost === `¥${cost.data.total_cost_cny}`,
      all_screenshots_captured: steps.length === 4,
      no_horizontal_overflow: steps.every((step) => !step.audit.horizontalOverflow),
      no_text_box_overflow: steps.every((step) => step.audit.textOverflowCount === 0),
      no_main_window_cuu: steps.every((step) => !step.audit.cuuLeak),
      no_default_kanban: steps.every((step) => !step.audit.kanbanLeak),
      no_hash_navigation: steps.every((step) => !step.audit.hashNavigationLeak)
    };
    const ok = Object.values(gates).every(Boolean);
    const report = {
      generated_at: new Date().toISOString(),
      module: "R4.9 Web locale Page VM + shell metrics browser smoke",
      chrome_path: chromePath,
      api_target: apiTarget,
      vite_url: baseUrl,
      broker_backend: process.env["BROKER_BACKEND"] ?? "memory",
      output_dir: path.relative(repoRoot, outputDir).replace(/\\/gu, "/"),
      contact_sheet: "contact-sheet.png",
      seed,
      gates,
      direct_api: {
        proposal: proposal.data,
        replay: replay.data,
        cost: cost.data
      },
      api_requests: apiRequests,
      api_log_tail: tailLines(api.logs),
      steps
    };
    await writeFile(path.join(outputDir, "locale-metrics-browser-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await writeFile(path.join(outputDir, "smoke-summary.md"), [
      "# R4.9 Web Locale Metrics Browser Smoke",
      "",
      `- ok: ${String(ok)}`,
      `- steps: ${String(steps.length)}`,
      `- api target: ${apiTarget}`,
      `- broker backend: ${process.env["BROKER_BACKEND"] ?? "memory"}`,
      `- replay locale request: ${String(gates.browser_replay_requested_locale)}`,
      `- replay metric matches VM: ${String(gates.replay_metric_matches_vm)}`,
      `- cost metric matches VM: ${String(gates.cost_metric_matches_vm)}`,
      `- no text box overflow: ${String(gates.no_text_box_overflow)}`,
      ""
    ].join("\n"), "utf8");
    if (!ok) {
      throw new Error(`R4.9 locale metrics smoke failed: ${JSON.stringify(gates)}`);
    }
    console.log(JSON.stringify({ ok, output_dir: report.output_dir, steps: steps.length, api_target: apiTarget }, null, 2));
  } finally {
    chrome?.cdp.close();
    await stopProcess(chrome?.child);
    await viteServer?.close();
    await stopProcess(api?.child);
    await rm(userDataDir, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
