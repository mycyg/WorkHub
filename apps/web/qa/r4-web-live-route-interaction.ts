import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { AddressInfo } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createServer as createViteServer, type ViteDevServer } from "vite";
import { createP05GoldPathFixture, validateP05GoldPathFixture } from "@workhub/agent/fixtures";
import type { GoldPathSurfaceVM, SettingsPageVM, WorkHubLocale } from "@workhub/contracts";

type Viewport = {
  width: number;
  height: number;
};

type ApiRequestRecord = {
  method: string;
  pathname: string;
  search: string;
  locale: string | null;
  referer: string | null;
};

type BrowserAudit = {
  pathname: string;
  search: string;
  lang: string;
  storedLocale: string | null;
  status: string;
  routeKey: string;
  productShell: boolean;
  linkModePath: boolean;
  masthead: boolean;
  routeComponent: string | null;
  routeComponentSource: string | null;
  routeComponentPanel: string | null;
  routeComponentActive: boolean;
  routeSpecificMarker: boolean;
  routeData: {
    workitemTraceCount: string | null;
    workitemEvidenceCount: string | null;
    workitemAcceptanceCount: string | null;
    proposalChangeCount: string | null;
    proposalActionCount: string | null;
    proposalEvidenceCount: string | null;
    costTotalTokens: string | null;
    costTotalCny: string | null;
    costBudgetCount: string | null;
    costModelCount: string | null;
    settingsPetModelInWeb: string | null;
    settingsWorkerCount: string | null;
  };
  notice: {
    visible: boolean;
    kind: string | null;
    tone: string | null;
    source: string | null;
    locale: string | null;
    actionId: string | null;
    eventType: string | null;
    stream: string | null;
    title: string;
    body: string;
    reasonButtonCount: number;
  };
  live: {
    streamCount: string | null;
    connectedCount: string | null;
    eventCount: string | null;
    refreshCount: string | null;
    lastEvent: string | null;
    lastStream: string | null;
  };
  routeState: {
    kind: string | null;
    actionText: string | null;
  };
  panelCount: number;
  visiblePanelCount: number;
  activeLocale: string | null;
  pathNavigation: boolean;
  hashNavigationLeak: boolean;
  oldShellLeak: boolean;
  weeklyFixtureLeak: boolean;
  cuuLeak: boolean;
  kanbanLeak: boolean;
  clientWidth: number;
  scrollWidth: number;
  horizontalOverflow: boolean;
  navHorizontalOverflow: boolean;
  textOverflowCount: number;
  textOverflowSamples: string[];
  topbarNavOverlap: boolean;
  zhChrome: boolean;
  enChrome: boolean;
};

type StepReport = {
  id: string;
  url: string;
  viewport: Viewport;
  expectedStatus: string;
  screenshot: string;
  audit: BrowserAudit;
};

type CdpMessage = {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string };
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../../..");
const webRoot = path.join(repoRoot, "apps", "web");
const defaultOutputDir = path.join(
  repoRoot,
  "docs",
  "workhub",
  "05-clients",
  "assets",
  "audit",
  "2026-06-11-r4-web-live-route-interaction"
);
const outputDir = process.env["WORKHUB_R4_WEB_ROUTE_SMOKE_OUTPUT_DIR"]
  ? path.resolve(repoRoot, process.env["WORKHUB_R4_WEB_ROUTE_SMOKE_OUTPUT_DIR"])
  : defaultOutputDir;
const smokeTitle = process.env["WORKHUB_R4_WEB_ROUTE_SMOKE_TITLE"] ?? "R4.5 Web Live Route Interaction Smoke";
const reportFilename = process.env["WORKHUB_R4_WEB_ROUTE_SMOKE_REPORT_NAME"] ?? "live-route-interaction-report.json";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function replacement(value: string) {
  return value
    .replace(/\bCuu\b/gu, "AI assistant")
    .replace(/客户周报/gu, "区域发布复盘包")
    .replace(/周报/gu, "复盘包")
    .replace(/weekly report/giu, "regional launch review")
    .replace(/weekly/giu, "regional");
}

function deepReplace<T>(value: T): T {
  if (typeof value === "string") {
    return replacement(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepReplace(item)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deepReplace(item)])) as T;
  }
  return value;
}

function settingsPage(locale: WorkHubLocale): SettingsPageVM {
  return {
    generated_at: "2026-06-11T09:00:00.000Z",
    locale,
    runtime: {
      app_env: "test",
      worker_count: 2,
      broker_backend: "memory",
      broker_configured: true,
      database_configured: true,
      agent_run_lease_ms: 300000,
      agent_run_recovery_interval_ms: 30000
    },
    llm_runtime: {
      default_provider: "deepseek",
      default_model: "deepseek-v4-flash-r4-11-browser-smoke",
      provider_count: 1,
      api_key_configured: true,
      base_url_configured: true
    },
    budgets: {
      run_tokens: 120000,
      user_daily_tokens: 500000,
      team_daily_tokens: 5000000,
      team_monthly_tokens: 50000000,
      run_cost_cny: "5",
      user_daily_cost_cny: "20",
      team_daily_cost_cny: "200",
      team_monthly_cost_cny: "2000"
    },
    language: {
      active_locale: locale,
      supported_locales: ["zh-CN", "en-US"],
      storage_key: "workhub.locale"
    },
    device: {
      desktop_client: "tauri",
      local_execution_boundary: true,
      independent_pet_window: true,
      pet_model_settings_in_web: false,
      restore_href: "/settings?panel=desktop"
    }
  };
}

function productSurface(): GoldPathSurfaceVM {
  const fixture = validateP05GoldPathFixture(createP05GoldPathFixture());
  return deepReplace({
    fixture_id: fixture.id,
    routes: {
      home: "/",
      intake: "/intake/r4-live-session",
      approvals: "/approvals",
      workitem: "/workitems/r4-live-workitem",
      proposal: "/proposals/r4-live-proposal",
      replay: "/agent-runs/r4-live-run/replay",
      cost: "/dashboard/cost"
    },
    page_vms: {
      attention: fixture.attentionHome,
      question: fixture.question,
      evidence: fixture.evidenceBubble,
      approvals: fixture.approvalCenter,
      workitem: fixture.workItemDetail,
      proposal: fixture.proposalDetail,
      replay: fixture.replay,
      cost: fixture.costDashboard,
      settings: settingsPage("zh-CN")
    },
    events: fixture.events,
    cuu_states: []
  });
}

function identity(locale: WorkHubLocale) {
  return {
    id: "r4-live-user",
    nickname: "R4 Live Reviewer",
    display_name: "R4 Live Reviewer",
    created: false,
    locale,
    preferences: { locale },
    is_admin: true,
    availability_status: "available"
  };
}

function isEmptyApprovalProbe(request: IncomingMessage) {
  const referer = request.headers.referer;
  return typeof referer === "string" && referer.includes("empty=approvals");
}

async function requestBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function sendApiError(response: ServerResponse, status: number, code: string, message: string) {
  sendJson(response, status, {
    ok: false,
    error: { code, message }
  });
}

function createMockApiServer(surface: GoldPathSurfaceVM, requestLog: ApiRequestRecord[]) {
  let currentLocale: WorkHubLocale = "zh-CN";
  const sseClients = new Map<ServerResponse, string>();
  const sseStreamKey = (pathname: string) => {
    if (pathname === "/api/push/stream") {
      return "all";
    }
    if (pathname === "/api/push/stream/me") {
      return "me";
    }
    const match = /^\/api\/push\/stream\/([^/]+)/u.exec(pathname);
    return match?.[1] ?? "unknown";
  };
  const writeSseEvent = (response: ServerResponse, event: string, payload: Record<string, unknown>) => {
    response.write(`event: ${event}\n`);
    response.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  const server = createHttpServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    requestLog.push({
      method: request.method ?? "GET",
      pathname: url.pathname,
      search: url.search,
      locale: url.searchParams.get("locale"),
      referer: typeof request.headers.referer === "string" ? request.headers.referer : null
    });

    if (request.method === "GET" && (url.pathname === "/api/push/stream" || url.pathname.startsWith("/api/push/stream/"))) {
      const streamKey = sseStreamKey(url.pathname);
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store, no-transform",
        connection: "keep-alive"
      });
      writeSseEvent(response, "connected", { stream: streamKey });
      sseClients.set(response, streamKey);
      request.on("close", () => {
        sseClients.delete(response);
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/__qa/emit") {
      const event = url.searchParams.get("event") ?? "proposal.merged";
      const stream = url.searchParams.get("stream") ?? "proposal";
      let emitted = 0;
      for (const [client, streamKey] of Array.from(sseClients.entries())) {
        if (streamKey !== stream) {
          continue;
        }
        writeSseEvent(client, event, { stream, event_type: event, source: "r4-smoke" });
        emitted += 1;
      }
      sendJson(response, 200, { ok: true, event, stream, emitted });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/auth/me") {
      sendJson(response, 200, identity(currentLocale));
      return;
    }
    if (request.method === "PATCH" && url.pathname === "/api/auth/preferences") {
      const body = JSON.parse(await requestBody(request) || "{}") as { locale?: WorkHubLocale };
      currentLocale = body.locale === "en-US" ? "en-US" : "zh-CN";
      sendJson(response, 200, identity(currentLocale));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/auth/identify") {
      sendJson(response, 200, { ...identity(currentLocale), created: true });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/pages/attention") {
      sendJson(response, 200, surface.page_vms.attention);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/pages/approvals") {
      if (isEmptyApprovalProbe(request)) {
        sendJson(response, 200, {
          ...surface.page_vms.approvals,
          items: [],
          requests: [],
          counts: { pending: 0, all: 0 }
        });
        return;
      }
      sendJson(response, 200, surface.page_vms.approvals);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/pages/cost") {
      sendJson(response, 200, surface.page_vms.cost);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/pages/settings") {
      sendJson(response, 200, settingsPage(currentLocale));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/pages/gold-path") {
      sendJson(response, 200, surface);
      return;
    }
    const approvalRespondMatch = /^\/api\/approvals\/([^/]+)\/respond$/u.exec(url.pathname);
    if (request.method === "POST" && approvalRespondMatch?.[1]) {
      const body = JSON.parse(await requestBody(request) || "{}") as { decision?: string };
      sendJson(response, 200, {
        approval: { id: approvalRespondMatch[1], status: body.decision === "deny" ? "denied" : "allowed" },
        attention: {
          summary_text: currentLocale === "en-US"
            ? body.decision === "deny"
              ? "Approval sent back to AI with your reason."
              : "Approval recorded. AI can continue."
            : body.decision === "deny"
              ? "已带着原因打回审批。"
              : "已记录审批，AI 可以继续。"
        }
      });
      return;
    }
    const workItemMatch = /^\/api\/pages\/workitems\/([^/]+)$/u.exec(url.pathname);
    if (request.method === "GET" && workItemMatch?.[1]) {
      if (workItemMatch[1] === "r4-live-forbidden") {
        sendApiError(response, 403, "forbidden", "Needs owner approval");
        return;
      }
      sendJson(response, 200, surface.page_vms.workitem);
      return;
    }
    const proposalMatch = /^\/api\/pages\/proposals\/([^/]+)$/u.exec(url.pathname);
    if (request.method === "GET" && proposalMatch?.[1]) {
      if (proposalMatch[1] === "r4-live-missing") {
        sendApiError(response, 404, "not_found", "Proposal not found");
        return;
      }
      sendJson(response, 200, surface.page_vms.proposal);
      return;
    }
    const proposalReviewMatch = /^\/api\/proposals\/([^/]+)\/review$/u.exec(url.pathname);
    if (request.method === "POST" && proposalReviewMatch?.[1]) {
      await requestBody(request);
      sendJson(response, 200, {
        attention: {
          summary_text: currentLocale === "en-US"
            ? "Change request sent back to AI with your reason."
            : "已带着原因打回给 AI。"
        }
      });
      return;
    }
    const proposalMergeMatch = /^\/api\/proposals\/([^/]+)\/merge$/u.exec(url.pathname);
    if (request.method === "POST" && proposalMergeMatch?.[1]) {
      await requestBody(request);
      sendJson(response, 200, {
        attention: {
          summary_text: currentLocale === "en-US"
            ? "Accepted into the official version."
            : "已合入正式版本。"
        }
      });
      return;
    }
    const replayMatch = /^\/api\/agent-runs\/([^/]+)\/replay$/u.exec(url.pathname);
    if (request.method === "GET" && replayMatch?.[1]) {
      sendJson(response, 200, surface.page_vms.replay);
      return;
    }
    sendApiError(response, 404, "not_found", `Unhandled R4 live mock endpoint: ${url.pathname}`);
  });
  return server;
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

async function removeBestEffort(target: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 4) {
        console.warn(`warning: could not remove ${target}: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
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

async function freePort() {
  const server = createHttpServer();
  const port = await listen(server);
  await closeServer(server);
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

async function launchChrome(chromePath: string, debugPort: number, userDataDir: string) {
  await rm(userDataDir, { recursive: true, force: true });
  await mkdir(userDataDir, { recursive: true });
  const child = spawn(chromePath, [
    "--headless=new",
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
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`Timed out waiting for ${label}; last value=${JSON.stringify(lastValue)}`);
}

async function navigate(cdp: CdpClient, url: string, expectedStatus: string) {
  await cdp.send("Page.navigate", { url });
  await waitFor<string>(
    cdp,
    `${url} -> ${expectedStatus}`,
    "document.querySelector('[data-r4-web-route-status]')?.getAttribute('data-r4-web-route-status') || ''",
    (value) => value === expectedStatus
  );
}

async function clickAndWait(cdp: CdpClient, selector: string, pathname: string, expectedStatus = "ready") {
  const clicked = await cdp.evaluate<boolean>(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) return false;
    target.click();
    return true;
  })()`);
  if (!clicked) {
    throw new Error(`Could not click selector: ${selector}`);
  }
  await waitFor<{ pathname: string; status: string }>(
    cdp,
    `${selector} -> ${pathname}`,
    "(() => ({ pathname: location.pathname, status: document.querySelector('[data-r4-web-route-status]')?.getAttribute('data-r4-web-route-status') || '' }))()",
    (value) => value.pathname === pathname && value.status === expectedStatus
  );
}

async function clickAndWaitForNotice(cdp: CdpClient, selector: string, kind: string, actionId?: string) {
  const clicked = await cdp.evaluate<boolean>(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) return false;
    target.click();
    return true;
  })()`);
  if (!clicked) {
    throw new Error(`Could not click selector: ${selector}`);
  }
  await waitFor<BrowserAudit>(
    cdp,
    `${selector} -> notice ${kind}`,
    auditExpression(),
    (audit) =>
      audit.notice.visible &&
      audit.notice.kind === kind &&
      (actionId === undefined || audit.notice.actionId === actionId)
  );
}

async function emitQaSseEvent(cdp: CdpClient, event: string, stream = "proposal") {
  const ok = await cdp.evaluate<boolean>(`fetch(${JSON.stringify(`/api/__qa/emit?event=${encodeURIComponent(event)}&stream=${encodeURIComponent(stream)}`)}).then((response) => response.ok)`);
  if (!ok) {
    throw new Error(`QA SSE emit failed for ${stream}:${event}`);
  }
}

async function historyAndWait(cdp: CdpClient, direction: "back" | "forward", pathname: string) {
  await cdp.evaluate(`history.${direction}(); true`);
  await waitFor<{ pathname: string; status: string }>(
    cdp,
    `history.${direction} -> ${pathname}`,
    "(() => ({ pathname: location.pathname, status: document.querySelector('[data-r4-web-route-status]')?.getAttribute('data-r4-web-route-status') || '' }))()",
    (value) => value.pathname === pathname && value.status === "ready"
  );
}

function auditExpression() {
  return `(() => {
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll("script,style").forEach((node) => node.remove());
    const text = clone.textContent || "";
    const nav = document.querySelector(".wh-product-nav");
    const navClientWidth = nav ? Math.round(nav.clientWidth) : 0;
    const navScrollWidth = nav ? Math.round(nav.scrollWidth) : 0;
    const textContainerSelector = [
      ".wh-product-topbar",
      ".wh-product-brand",
      ".wh-product-top-actions",
      ".wh-product-nav",
      ".wh-product-nav a",
      ".wh-product-masthead",
      ".wh-product-metric",
      ".wh-route-panel",
      ".wh-panel",
      ".wh-card",
      ".wh-section",
      ".wh-product-rail-block",
      ".wh-app-notice",
      ".wh-app-action-row",
      ".wh-web-route-state-wrap",
      ".route-state-card",
      "button",
      "a"
    ].join(",");
    const textOverflowSamples = Array.from(document.querySelectorAll("a,button,span,p,h1,h2,h3,h4,strong,small,li,dd,dt,label,time"))
      .flatMap((element) => {
        const htmlElement = element;
        const style = window.getComputedStyle(htmlElement);
        const rect = htmlElement.getBoundingClientRect();
        const visible = style.display !== "none" && style.visibility !== "hidden" && rect.width > 1 && rect.height > 1;
        const value = (htmlElement.textContent || "").replace(/\\s+/g, " ").trim();
        if (!visible || !value) return [];
        const explicitTextClip =
          style.textOverflow === "ellipsis" &&
          (style.whiteSpace === "nowrap" || (style.webkitLineClamp && style.webkitLineClamp !== "none"));
        const scrollArea = ["auto", "scroll"].includes(style.overflowX) || ["auto", "scroll"].includes(style.overflowY);
        const horizontalLeak =
          Math.ceil(htmlElement.scrollWidth) > Math.ceil(htmlElement.clientWidth) + 2 &&
          !explicitTextClip &&
          !scrollArea;
        const verticalLeak =
          Math.ceil(htmlElement.scrollHeight) > Math.ceil(htmlElement.clientHeight) + 2 &&
          !explicitTextClip &&
          !scrollArea;
        const container = htmlElement.parentElement ? htmlElement.parentElement.closest(textContainerSelector) : null;
        const containerRect = container ? container.getBoundingClientRect() : null;
        const containmentLeak = Boolean(
          containerRect &&
            (rect.left < containerRect.left - 2 ||
              rect.right > containerRect.right + 2 ||
              rect.top < containerRect.top - 2 ||
              rect.bottom > containerRect.bottom + 2)
        );
        if (!horizontalLeak && !verticalLeak && !containmentLeak) return [];
        const className = typeof htmlElement.className === "string" && htmlElement.className ? "." + htmlElement.className.split(/\\s+/).slice(0, 2).join(".") : "";
        return [
          htmlElement.tagName.toLowerCase() + className + " " + JSON.stringify(value.slice(0, 96)) +
            " leak=" + [horizontalLeak ? "horizontal" : "", verticalLeak ? "vertical" : "", containmentLeak ? "container" : ""].filter(Boolean).join("+") +
            " sw/cw=" + Math.ceil(htmlElement.scrollWidth) + "/" + Math.ceil(htmlElement.clientWidth) +
            " sh/ch=" + Math.ceil(htmlElement.scrollHeight) + "/" + Math.ceil(htmlElement.clientHeight)
        ];
      });
    const topbar = document.querySelector(".wh-product-topbar");
    const topbarRect = topbar ? topbar.getBoundingClientRect() : null;
    const navRect = nav ? nav.getBoundingClientRect() : null;
    const navVisible = Boolean(navRect && navRect.bottom > 0 && navRect.top < window.innerHeight);
    const topbarNavOverlap = Boolean(
      topbarRect &&
        navRect &&
        navVisible &&
        navRect.top < topbarRect.bottom - 2 &&
        navRect.bottom > topbarRect.top + 2
    );
    const statusRoot = document.querySelector("[data-r4-web-route-status]");
    const routeRoot = document.querySelector("[data-r4-product-shell]");
    const routeComponent = document.querySelector("[data-r4-route-component]");
    const routeComponentPanel = document.querySelector("[data-r4-route-component-panel]");
    const panels = Array.from(document.querySelectorAll("[data-wh-panel]"));
    const visiblePanels = panels.filter((panel) => !panel.hasAttribute("hidden"));
    const routeComponentKey = routeComponent ? routeComponent.getAttribute("data-r4-route-component") : null;
    const routeData = {
      workitemTraceCount: routeComponent?.getAttribute("data-r4-workitem-trace-count") || null,
      workitemEvidenceCount: routeComponent?.getAttribute("data-r4-workitem-evidence-count") || null,
      workitemAcceptanceCount: routeComponent?.getAttribute("data-r4-workitem-acceptance-count") || null,
      proposalChangeCount: routeComponent?.getAttribute("data-r4-proposal-change-count") || null,
      proposalActionCount: routeComponent?.getAttribute("data-r4-proposal-action-count") || null,
      proposalEvidenceCount: routeComponent?.getAttribute("data-r4-proposal-evidence-count") || null,
      costTotalTokens: routeComponent?.getAttribute("data-r4-cost-total-tokens") || null,
      costTotalCny: routeComponent?.getAttribute("data-r4-cost-total-cny") || null,
      costBudgetCount: routeComponent?.getAttribute("data-r4-cost-budget-count") || null,
      costModelCount: routeComponent?.getAttribute("data-r4-cost-model-count") || null,
      settingsPetModelInWeb: routeComponent?.getAttribute("data-r4-settings-pet-model-in-web") || null,
      settingsWorkerCount: routeComponent?.getAttribute("data-r4-settings-worker-count") || null
    };
    const noticeElement = document.querySelector("[data-wh-app-notice]");
    const noticeVisible = Boolean(noticeElement && !noticeElement.hasAttribute("hidden"));
    const notice = {
      visible: noticeVisible,
      kind: noticeElement?.getAttribute("data-r4-notice-kind") || null,
      tone: noticeElement?.getAttribute("data-r4-notice-tone") || null,
      source: noticeElement?.getAttribute("data-r4-notice-source") || null,
      locale: noticeElement?.getAttribute("data-r4-notice-locale") || null,
      actionId: noticeElement?.getAttribute("data-r4-notice-action-id") || null,
      eventType: noticeElement?.getAttribute("data-r4-notice-event-type") || null,
      stream: noticeElement?.getAttribute("data-r4-notice-stream") || null,
      title: noticeElement?.querySelector(".wh-app-notice-title")?.textContent?.trim() || "",
      body: noticeElement?.querySelector(".wh-app-notice-body")?.textContent?.trim() || "",
      reasonButtonCount: noticeVisible ? document.querySelectorAll("[data-review-reason]").length : 0
    };
    const live = {
      streamCount: document.documentElement.dataset.r4LiveStreamCount || null,
      connectedCount: document.documentElement.dataset.r4LiveConnectedCount || null,
      eventCount: document.documentElement.dataset.r4LiveEventCount || null,
      refreshCount: document.documentElement.dataset.r4LiveRefreshCount || null,
      lastEvent: document.documentElement.dataset.r4LiveLastEvent || null,
      lastStream: document.documentElement.dataset.r4LiveLastStream || null
    };
    const routeStateCard = document.querySelector("[data-route-state]");
    const routeState = {
      kind: routeStateCard?.getAttribute("data-route-state") || null,
      actionText: routeStateCard?.querySelector("a")?.textContent?.trim() || null
    };
    const routeSpecificMarker =
      routeComponentKey === "workitem"
        ? Boolean(document.querySelector("[data-r4-workitem-context]") && document.querySelector("[data-r4-workitem-trace]") && document.querySelector("[data-r4-workitem-evidence]"))
        : routeComponentKey === "proposal"
          ? Boolean(document.querySelector("[data-r4-proposal-summary]") && document.querySelector("[data-r4-proposal-changes]") && document.querySelector("[data-action-id='request_changes'][data-method='POST'][data-requires-reason='true']"))
          : routeComponentKey === "cost"
            ? Boolean(document.querySelector("[data-r4-cost-metrics]") && document.querySelector("[data-r4-cost-budget]") && document.querySelector("[data-r4-cost-models]"))
            : routeComponentKey === "settings"
              ? Boolean(document.querySelector("[data-r4-settings-runtime]") && document.querySelector("[data-r4-settings-llm]") && document.querySelector("[data-r4-settings-device]"))
              : Boolean(routeComponentKey);
    return {
      pathname: location.pathname,
      search: location.search,
      lang: document.documentElement.lang,
      storedLocale: localStorage.getItem("workhub.locale"),
      status: statusRoot ? statusRoot.getAttribute("data-r4-web-route-status") || "" : "",
      routeKey: statusRoot ? statusRoot.getAttribute("data-r4-web-route-key") || routeRoot?.getAttribute("data-r4-product-route-key") || "" : "",
      productShell: Boolean(routeRoot),
      linkModePath: routeRoot ? routeRoot.getAttribute("data-r4-product-link-mode") === "path" : false,
      masthead: Boolean(document.querySelector("[data-r4-product-masthead]")),
      routeComponent: routeComponentKey,
      routeComponentSource: routeComponent ? routeComponent.getAttribute("data-r4-route-component-source") : null,
      routeComponentPanel: routeComponentPanel ? routeComponentPanel.getAttribute("data-r4-route-component-panel") : null,
      routeComponentActive: routeComponentPanel ? routeComponentPanel.getAttribute("data-r4-route-component-active") === "true" : false,
      routeSpecificMarker,
      routeData,
      notice,
      live,
      routeState,
      panelCount: panels.length,
      visiblePanelCount: visiblePanels.length,
      activeLocale: document.querySelector("[data-wh-locale][aria-pressed='true']")?.getAttribute("data-wh-locale") || null,
      pathNavigation: Array.from(document.querySelectorAll("a[href]")).some((anchor) => (anchor.getAttribute("href") || "").startsWith("/")),
      hashNavigationLeak: Array.from(document.querySelectorAll("a[href]")).some((anchor) => (anchor.getAttribute("href") || "").startsWith("#/")),
      oldShellLeak: Boolean(document.querySelector(".wh-app-root")),
      weeklyFixtureLeak: /客户周报|weekly report/i.test(text),
      cuuLeak: /\\bCuu\\b/i.test(text) || Boolean(document.querySelector("[data-cuu]")),
      kanbanLeak: /\\bkanban\\b/i.test(text),
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      horizontalOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > document.documentElement.clientWidth + 2,
      navHorizontalOverflow: nav ? navScrollWidth > navClientWidth + 2 : false,
      textOverflowCount: textOverflowSamples.length,
      textOverflowSamples: textOverflowSamples.slice(0, 8),
      topbarNavOverlap,
      zhChrome: text.includes("工作入口") && text.includes("当前焦点"),
      enChrome: text.includes("Work entry") && text.includes("Focus")
    };
  })()`;
}

async function captureStep(
  cdp: CdpClient,
  input: { id: string; url: string; viewport: Viewport; expectedStatus: string; expectedRouteComponent?: string }
): Promise<StepReport> {
  const audit = await cdp.evaluate<BrowserAudit>(auditExpression());
  if (audit.status !== input.expectedStatus) {
    throw new Error(`${input.id} expected status ${input.expectedStatus}, got ${audit.status}`);
  }
  if (input.expectedRouteComponent && audit.routeComponent !== input.expectedRouteComponent) {
    throw new Error(`${input.id} expected route component ${input.expectedRouteComponent}, got ${audit.routeComponent ?? "missing"}`);
  }
  if (input.expectedRouteComponent && !audit.routeSpecificMarker) {
    throw new Error(`${input.id} is missing route-specific R4.11 markers`);
  }
  if (audit.productShell && audit.status === "ready" && (audit.panelCount !== 1 || audit.visiblePanelCount !== 1)) {
    throw new Error(`${input.id} expected one active product panel, got ${audit.visiblePanelCount}/${audit.panelCount}`);
  }
  if (audit.cuuLeak) {
    throw new Error(`${input.id} leaked Cuu main-window markers`);
  }
  if (audit.kanbanLeak) {
    throw new Error(`${input.id} leaked Kanban wording`);
  }
  if (audit.hashNavigationLeak) {
    throw new Error(`${input.id} leaked hash navigation`);
  }
  if (audit.oldShellLeak) {
    throw new Error(`${input.id} leaked old preview shell`);
  }
  if (audit.weeklyFixtureLeak) {
    throw new Error(`${input.id} leaked weekly fixture copy`);
  }
  if (audit.horizontalOverflow || audit.navHorizontalOverflow) {
    throw new Error(`${input.id} has horizontal overflow`);
  }
  if (audit.textOverflowCount > 0) {
    throw new Error(`${input.id} has text overflow: ${audit.textOverflowSamples.join("; ")}`);
  }
  if (audit.topbarNavOverlap) {
    throw new Error(`${input.id} has topbar/nav overlap`);
  }
  const screenshot = `${input.id}.png`;
  const captured = await cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile(path.join(outputDir, screenshot), Buffer.from(captured.data, "base64"));
  await assertPng(path.join(outputDir, screenshot));
  return {
    id: input.id,
    url: input.url,
    viewport: input.viewport,
    expectedStatus: input.expectedStatus,
    screenshot,
    audit
  };
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

function contactSheetDocument(steps: StepReport[]) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(smokeTitle)} Contact Sheet</title>
  <style>
    body{margin:0;background:#eef4fb;color:#172033;font-family:Aptos,Segoe UI,sans-serif}
    main{padding:18px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
    figure{margin:0;border:1px solid #dce4f1;border-radius:8px;background:#fff;padding:10px;box-shadow:0 14px 36px rgba(37,51,79,.08);min-width:0}
    figcaption{font-size:12px;font-weight:850;color:#66728c;margin:0 0 8px;overflow-wrap:anywhere}
    img{display:block;width:100%;height:auto;border-radius:6px;border:1px solid #e5ecf5}
  </style>
</head>
<body><main>${steps
    .map(
      (step) =>
        `<figure><figcaption>${escapeHtml(step.id)} · ${escapeHtml(step.audit.pathname + step.audit.search)} · ${escapeHtml(step.audit.status)}</figcaption><img src="${escapeHtml(step.screenshot)}" alt="${escapeHtml(step.id)}" /></figure>`
    )
    .join("")}</main></body>
</html>`;
}

async function navigateFileAndCaptureContactSheet(cdp: CdpClient, steps: StepReport[]) {
  const htmlPath = path.join(outputDir, "contact-sheet.html");
  const screenshotPath = path.join(outputDir, "contact-sheet.png");
  await writeFile(htmlPath, contactSheetDocument(steps), "utf8");
  await setViewport(cdp, { width: 1280, height: 1800 });
  await cdp.send("Page.navigate", { url: pathToFileURL(htmlPath).href });
  await waitFor<string>(cdp, "contact sheet images", "document.readyState", (value) => value === "complete");
  const captured = await cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile(screenshotPath, Buffer.from(captured.data, "base64"));
  await assertPng(screenshotPath);
}

async function runScenario(cdp: CdpClient, baseUrl: string) {
  const desktop = { width: 1365, height: 1120 };
  const mobile = { width: 390, height: 1180 };
  const steps: StepReport[] = [];

  await setViewport(cdp, desktop);
  await navigate(cdp, `${baseUrl}/`, "ready");
  steps.push(await captureStep(cdp, { id: "01-home-zh-desktop", url: `${baseUrl}/`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "home" }));

  await clickAndWait(cdp, 'a[href="/approvals"]', "/approvals");
  steps.push(await captureStep(cdp, { id: "02-approvals-click-zh-desktop", url: `${baseUrl}/approvals`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "approvals" }));

  await clickAndWaitForNotice(cdp, '[data-action-id="deny"]', "reason_required", "deny");
  steps.push(await captureStep(cdp, { id: "02a-approval-deny-reason-gate-zh-desktop", url: `${baseUrl}/approvals`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "approvals" }));

  await clickAndWaitForNotice(cdp, "[data-review-reason]", "action_success", "deny");
  steps.push(await captureStep(cdp, { id: "02b-approval-deny-success-zh-desktop", url: `${baseUrl}/approvals`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "approvals" }));

  await clickAndWaitForNotice(cdp, '[data-action-id="approve"]', "action_success", "approve");
  steps.push(await captureStep(cdp, { id: "02c-approval-approve-success-zh-desktop", url: `${baseUrl}/approvals`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "approvals" }));

  await clickAndWait(cdp, 'a[href="/workitems/r4-live-workitem"]', "/workitems/r4-live-workitem");
  steps.push(await captureStep(cdp, { id: "03-workitem-click-zh-desktop-route-component", url: `${baseUrl}/workitems/r4-live-workitem`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "workitem" }));

  await historyAndWait(cdp, "back", "/approvals");
  steps.push(await captureStep(cdp, { id: "04-history-back-approvals", url: `${baseUrl}/approvals`, viewport: desktop, expectedStatus: "ready" }));

  await historyAndWait(cdp, "forward", "/workitems/r4-live-workitem");
  steps.push(await captureStep(cdp, { id: "05-history-forward-workitem", url: `${baseUrl}/workitems/r4-live-workitem`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "workitem" }));

  await clickAndWait(cdp, '[data-wh-locale="en-US"]', "/workitems/r4-live-workitem");
  await waitFor<BrowserAudit>(
    cdp,
    "en-US reload",
    auditExpression(),
    (audit) => audit.lang === "en-US" && audit.enChrome && audit.storedLocale === "en-US" && audit.activeLocale === "en-US"
  );
  steps.push(await captureStep(cdp, { id: "06-locale-toggle-en-workitem-route-component", url: `${baseUrl}/workitems/r4-live-workitem`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "workitem" }));

  await navigate(cdp, `${baseUrl}/proposals/r4-live-proposal`, "ready");
  await waitFor<BrowserAudit>(
    cdp,
    "proposal SSE stream connected",
    auditExpression(),
    (audit) => Number(audit.live.connectedCount ?? "0") > 0 && Number(audit.live.streamCount ?? "0") >= 3
  );
  await clickAndWaitForNotice(cdp, '[data-action-id="request_changes"]', "reason_required", "request_changes");
  steps.push(await captureStep(cdp, { id: "07-proposal-reason-gate-en-desktop", url: `${baseUrl}/proposals/r4-live-proposal`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "proposal" }));

  await clickAndWaitForNotice(cdp, "[data-review-reason]", "action_success", "request_changes");
  steps.push(await captureStep(cdp, { id: "08-proposal-request-changes-success-en-desktop", url: `${baseUrl}/proposals/r4-live-proposal`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "proposal" }));

  await clickAndWaitForNotice(cdp, '[data-action-id="merge"]', "action_success", "merge");
  steps.push(await captureStep(cdp, { id: "09-proposal-merge-success-en-desktop", url: `${baseUrl}/proposals/r4-live-proposal`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "proposal" }));

  await emitQaSseEvent(cdp, "proposal.merged", "proposal");
  await waitFor<BrowserAudit>(
    cdp,
    "proposal SSE refresh notice",
    auditExpression(),
    (audit) => audit.notice.visible && audit.notice.kind === "sse_refresh" && audit.notice.eventType === "proposal.merged" && Number(audit.live.refreshCount ?? "0") > 0
  );
  steps.push(await captureStep(cdp, { id: "10-proposal-sse-refresh-notice-en-desktop", url: `${baseUrl}/proposals/r4-live-proposal`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "proposal" }));

  await setViewport(cdp, mobile);
  await cdp.evaluate("window.scrollTo(0, 680); true");
  await new Promise((resolve) => setTimeout(resolve, 250));
  steps.push(await captureStep(cdp, { id: "11-proposal-en-mobile-scrolled-notice-route-component", url: `${baseUrl}/proposals/r4-live-proposal`, viewport: mobile, expectedStatus: "ready", expectedRouteComponent: "proposal" }));

  await navigate(cdp, `${baseUrl}/dashboard/cost`, "ready");
  steps.push(await captureStep(cdp, { id: "12-cost-en-mobile-route-component", url: `${baseUrl}/dashboard/cost`, viewport: mobile, expectedStatus: "ready", expectedRouteComponent: "cost" }));

  await waitFor<BrowserAudit>(
    cdp,
    "cost SSE stream connected",
    auditExpression(),
    (audit) => Number(audit.live.connectedCount ?? "0") > 0 && audit.live.streamCount === "1"
  );
  await emitQaSseEvent(cdp, "budget.warning", "me");
  await waitFor<BrowserAudit>(
    cdp,
    "budget warning notice",
    auditExpression(),
    (audit) => audit.notice.visible && audit.notice.kind === "budget_warning" && audit.notice.eventType === "budget.warning" && Number(audit.live.refreshCount ?? "0") > 0
  );
  steps.push(await captureStep(cdp, { id: "12a-cost-budget-warning-notice-en-mobile", url: `${baseUrl}/dashboard/cost`, viewport: mobile, expectedStatus: "ready", expectedRouteComponent: "cost" }));

  await setViewport(cdp, desktop);
  await navigate(cdp, `${baseUrl}/settings`, "ready");
  steps.push(await captureStep(cdp, { id: "13-settings-en-desktop-route-component", url: `${baseUrl}/settings`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "settings" }));

  await clickAndWaitForNotice(cdp, '[data-action-id="open_desktop_settings"]', "desktop_required", "open_desktop_settings");
  steps.push(await captureStep(cdp, { id: "14-settings-desktop-gate-en-desktop", url: `${baseUrl}/settings`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "settings" }));

  await navigate(cdp, `${baseUrl}/agent-runs/r4-live-run/replay`, "ready");
  steps.push(await captureStep(cdp, { id: "15-replay-en-desktop-route-component", url: `${baseUrl}/agent-runs/r4-live-run/replay`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "replay" }));

  await setViewport(cdp, mobile);
  await navigate(cdp, `${baseUrl}/approvals?empty=approvals`, "empty");
  steps.push(await captureStep(cdp, { id: "16-empty-approvals-mobile", url: `${baseUrl}/approvals?empty=approvals`, viewport: mobile, expectedStatus: "empty" }));

  await setViewport(cdp, desktop);
  await navigate(cdp, `${baseUrl}/workitems/r4-live-forbidden`, "forbidden");
  steps.push(await captureStep(cdp, { id: "17-forbidden-workitem-desktop", url: `${baseUrl}/workitems/r4-live-forbidden`, viewport: desktop, expectedStatus: "forbidden" }));

  await navigate(cdp, `${baseUrl}/missing-r4-live-route`, "error");
  steps.push(await captureStep(cdp, { id: "18-unknown-route-error", url: `${baseUrl}/missing-r4-live-route`, viewport: desktop, expectedStatus: "error" }));

  return steps;
}

function requestProof(requests: ApiRequestRecord[]) {
  const count = (pathname: string, method = "GET") =>
    requests.filter((request) => request.method === method && request.pathname === pathname).length;
  const countMatch = (pattern: RegExp, method = "GET") =>
    requests.filter((request) => request.method === method && pattern.test(request.pathname)).length;
  return {
    attention: requests.some((request) => request.pathname === "/api/pages/attention" && request.locale === "zh-CN"),
    approvals: requests.some((request) => request.pathname === "/api/pages/approvals"),
    workitem: requests.some((request) => request.pathname === "/api/pages/workitems/r4-live-workitem"),
    workitemEn: requests.some((request) => request.pathname === "/api/pages/workitems/r4-live-workitem" && request.locale === "en-US"),
    proposal: requests.some((request) => request.pathname === "/api/pages/proposals/r4-live-proposal"),
    cost: requests.some((request) => request.pathname === "/api/pages/cost" && request.locale === "en-US"),
    settings: requests.some((request) => request.pathname === "/api/pages/settings" && request.locale === "en-US"),
    replay: requests.some((request) => request.pathname === "/api/agent-runs/r4-live-run/replay" && request.locale === "en-US"),
    goldPath: requests.filter((request) => request.pathname === "/api/pages/gold-path").length >= 4,
    goldPathEn: requests.some((request) => request.pathname === "/api/pages/gold-path" && request.locale === "en-US"),
    localePatch: requests.some((request) => request.method === "PATCH" && request.pathname === "/api/auth/preferences"),
    counts: {
      attention: count("/api/pages/attention"),
      approvals: count("/api/pages/approvals"),
      workitem: count("/api/pages/workitems/r4-live-workitem"),
      workitemForbidden: count("/api/pages/workitems/r4-live-forbidden"),
      proposal: count("/api/pages/proposals/r4-live-proposal"),
      approvalRespond: countMatch(/^\/api\/approvals\/[^/]+\/respond$/u, "POST"),
      proposalReview: countMatch(/^\/api\/proposals\/[^/]+\/review$/u, "POST"),
      proposalMerge: countMatch(/^\/api\/proposals\/[^/]+\/merge$/u, "POST"),
      cost: count("/api/pages/cost"),
      settings: count("/api/pages/settings"),
      replay: count("/api/agent-runs/r4-live-run/replay"),
      qaEmit: count("/api/__qa/emit"),
      sseProposal: count("/api/push/stream/proposal/r4-live-proposal"),
      goldPath: count("/api/pages/gold-path"),
      preferencePatch: count("/api/auth/preferences", "PATCH")
    }
  };
}

function hasActiveComponent(steps: StepReport[], id: string, key: string) {
  return steps.some((step) =>
    step.id === id &&
    step.audit.routeComponent === key &&
    step.audit.routeComponentSource === "page-vm" &&
    step.audit.routeComponentActive &&
    step.audit.routeSpecificMarker
  );
}

function vmDomValueMatches(steps: StepReport[], surface: GoldPathSurfaceVM) {
  const byId = new Map(steps.map((step) => [step.id, step]));
  const workitem = byId.get("03-workitem-click-zh-desktop-route-component")?.audit.routeData;
  const proposal = byId.get("11-proposal-en-mobile-scrolled-notice-route-component")?.audit.routeData;
  const cost = byId.get("12-cost-en-mobile-route-component")?.audit.routeData;
  const settings = byId.get("13-settings-en-desktop-route-component")?.audit.routeData;
  return Boolean(
    workitem &&
      workitem.workitemTraceCount === String(surface.page_vms.workitem.agent_trace_preview.length) &&
      workitem.workitemEvidenceCount === String(surface.page_vms.workitem.evidence_refs.length) &&
      workitem.workitemAcceptanceCount === String(surface.page_vms.workitem.acceptance.length) &&
      proposal &&
      proposal.proposalChangeCount === String(surface.page_vms.proposal.manifest.changes.length) &&
      proposal.proposalActionCount === String([
        surface.page_vms.proposal.review_actions.approve,
        surface.page_vms.proposal.review_actions.request_changes,
        surface.page_vms.proposal.review_actions.merge
      ].filter(Boolean).length) &&
      proposal.proposalEvidenceCount === String(surface.page_vms.proposal.evidence_refs.length) &&
      cost &&
      cost.costTotalTokens === String(surface.page_vms.cost.token_in + surface.page_vms.cost.token_out) &&
      cost.costTotalCny === surface.page_vms.cost.total_cost_cny &&
      cost.costBudgetCount === String(surface.page_vms.cost.budget.length) &&
      cost.costModelCount === String(surface.page_vms.cost.model_breakdown.length) &&
      settings &&
      settings.settingsPetModelInWeb === "false" &&
      settings.settingsWorkerCount === "2"
  );
}

async function main() {
  const chromePath = findChrome();
  if (!chromePath) {
    throw new Error("Chrome/Chromium is required. Set CHROME_PATH to run R4.5 live browser route interaction QA.");
  }

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  const surface = productSurface();
  const requests: ApiRequestRecord[] = [];
  const apiServer = createMockApiServer(surface, requests);
  let viteServer: ViteDevServer | undefined;
  let chrome: { child: ChildProcessWithoutNullStreams; cdp: CdpClient } | undefined;
  const userDataDir = path.join(os.tmpdir(), `workhub-r4-live-route-${Date.now()}`);

  try {
    const apiPort = await listen(apiServer);
    const vitePort = await freePort();
    const debugPort = await freePort();
    const apiTarget = `http://127.0.0.1:${apiPort}`;
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
    const baseUrl = `http://127.0.0.1:${vitePort}`;
    chrome = await launchChrome(chromePath, debugPort, userDataDir);
    const steps = await runScenario(chrome.cdp, baseUrl);
    await navigateFileAndCaptureContactSheet(chrome.cdp, steps);
    const proof = requestProof(requests);
    const gates = {
      dev_server_started: Boolean(viteServer.httpServer?.listening),
      screenshots_captured: steps.every((step) => existsSync(path.join(outputDir, step.screenshot))) && existsSync(path.join(outputDir, "contact-sheet.png")),
      path_nav_clicks: steps.some((step) => step.id === "02-approvals-click-zh-desktop" && step.audit.pathname === "/approvals") &&
        steps.some((step) => step.id === "03-workitem-click-zh-desktop-route-component" && step.audit.pathname === "/workitems/r4-live-workitem"),
      history_back_forward: steps.some((step) => step.id === "04-history-back-approvals" && step.audit.pathname === "/approvals") &&
        steps.some((step) => step.id === "05-history-forward-workitem" && step.audit.pathname === "/workitems/r4-live-workitem"),
      locale_toggle_reload: steps.some((step) => step.id === "06-locale-toggle-en-workitem-route-component" && step.audit.lang === "en-US" && step.audit.enChrome && step.audit.activeLocale === "en-US"),
      ready_empty_forbidden_error_routes: ["ready", "empty", "forbidden", "error"].every((status) => steps.some((step) => step.audit.status === status)),
      ready_routes_use_page_vm_endpoints: proof.attention && proof.approvals && proof.workitem && proof.workitemEn && proof.proposal && proof.cost && proof.settings && proof.replay && proof.goldPath && proof.goldPathEn && proof.localePatch,
      r4_10_home_approvals_replay_route_components:
        steps.some((step) => step.id === "01-home-zh-desktop" && step.audit.routeComponent === "home" && step.audit.routeComponentSource === "page-vm" && step.audit.routeComponentActive) &&
        steps.some((step) => step.id === "02-approvals-click-zh-desktop" && step.audit.routeComponent === "approvals" && step.audit.routeComponentSource === "page-vm" && step.audit.routeComponentActive) &&
        steps.some((step) => step.id === "15-replay-en-desktop-route-component" && step.audit.routeComponent === "replay" && step.audit.routeComponentSource === "page-vm" && step.audit.routeComponentActive),
      r4_11_workitem_proposal_cost_settings_route_components:
        hasActiveComponent(steps, "03-workitem-click-zh-desktop-route-component", "workitem") &&
        hasActiveComponent(steps, "11-proposal-en-mobile-scrolled-notice-route-component", "proposal") &&
        hasActiveComponent(steps, "12-cost-en-mobile-route-component", "cost") &&
        hasActiveComponent(steps, "13-settings-en-desktop-route-component", "settings"),
      r4_11_route_component_source_truth: steps
        .filter((step) => step.audit.productShell && step.audit.status === "ready")
        .every((step) => step.audit.routeComponentSource === "page-vm"),
      r4_11_route_specific_markers: steps
        .filter((step) => step.audit.productShell && step.audit.status === "ready")
        .every((step) => step.audit.routeSpecificMarker),
      r4_11_vm_dom_value_match: vmDomValueMatches(steps, surface),
      r4_12_approval_response_notice:
        steps.some((step) => step.id === "02a-approval-deny-reason-gate-zh-desktop" && step.audit.notice.kind === "reason_required" && step.audit.notice.actionId === "deny" && step.audit.notice.locale === "zh-CN" && step.audit.notice.reasonButtonCount >= 3) &&
        steps.some((step) => step.id === "02b-approval-deny-success-zh-desktop" && step.audit.notice.kind === "action_success" && step.audit.notice.actionId === "deny" && step.audit.notice.locale === "zh-CN") &&
        steps.some((step) => step.id === "02c-approval-approve-success-zh-desktop" && step.audit.notice.kind === "action_success" && step.audit.notice.actionId === "approve" && step.audit.notice.locale === "zh-CN") &&
        proof.counts.approvalRespond === 2,
      r4_12_reason_gate_blocks_without_reason:
        steps.some((step) => step.id === "07-proposal-reason-gate-en-desktop" && step.audit.notice.kind === "reason_required" && step.audit.notice.reasonButtonCount >= 3) &&
        proof.counts.proposalReview === 1,
      r4_12_request_changes_success_notice:
        steps.some((step) => step.id === "08-proposal-request-changes-success-en-desktop" && step.audit.notice.kind === "action_success" && step.audit.notice.actionId === "request_changes" && step.audit.notice.locale === "en-US"),
      r4_12_merge_success_notice:
        steps.some((step) => step.id === "09-proposal-merge-success-en-desktop" && step.audit.notice.kind === "action_success" && step.audit.notice.actionId === "merge" && step.audit.notice.tone === "success") &&
        proof.counts.proposalMerge === 1,
      r4_12_sse_refresh_notice:
        steps.some((step) => step.id === "10-proposal-sse-refresh-notice-en-desktop" && step.audit.notice.kind === "sse_refresh" && step.audit.notice.source === "sse" && step.audit.notice.eventType === "proposal.merged" && step.audit.notice.stream === "proposal" && Number(step.audit.live.refreshCount ?? "0") >= 1) &&
        proof.counts.qaEmit === 2,
      r4_12_budget_warning_notice:
        steps.some((step) => step.id === "12a-cost-budget-warning-notice-en-mobile" && step.audit.notice.kind === "budget_warning" && step.audit.notice.source === "sse" && step.audit.notice.eventType === "budget.warning" && step.audit.notice.tone === "warning" && !step.audit.horizontalOverflow),
      r4_12_desktop_gate_fail_closed:
        steps.some((step) => step.id === "14-settings-desktop-gate-en-desktop" && step.audit.pathname === "/settings" && step.audit.search === "" && step.audit.notice.kind === "desktop_required" && step.audit.notice.actionId === "open_desktop_settings"),
      r4_12_retry_access_route_states:
        steps.some((step) => step.id === "17-forbidden-workitem-desktop" && step.audit.routeState.kind === "forbidden" && step.audit.routeState.actionText === "Request access") &&
        steps.some((step) => step.id === "18-unknown-route-error" && step.audit.routeState.kind === "error" && step.audit.routeState.actionText === "Retry"),
      r4_12_mobile_notice_no_overflow:
        steps.some((step) => step.id === "11-proposal-en-mobile-scrolled-notice-route-component" && step.audit.notice.kind === "sse_refresh" && !step.audit.horizontalOverflow && step.audit.textOverflowCount === 0),
      active_only_product_panels: steps.filter((step) => step.audit.productShell && step.audit.status === "ready").every((step) => step.audit.panelCount === 1 && step.audit.visiblePanelCount === 1),
      r4_10_active_only_product_panels: steps.filter((step) => step.audit.productShell && step.audit.status === "ready").every((step) => step.audit.panelCount === 1 && step.audit.visiblePanelCount === 1),
      product_shell_stays_path_mode: steps.filter((step) => step.audit.productShell).every((step) => step.audit.linkModePath),
      no_duplicate_route_loader_calls:
        proof.counts.approvals === 3 &&
        proof.counts.workitem === 3 &&
        proof.counts.workitemForbidden === 1 &&
        proof.counts.proposal === 2 &&
        proof.counts.approvalRespond === 2 &&
        proof.counts.proposalReview === 1 &&
        proof.counts.proposalMerge === 1 &&
        proof.counts.cost === 2 &&
        proof.counts.settings === 1 &&
        proof.counts.replay === 1 &&
        proof.counts.preferencePatch === 1 &&
        proof.counts.qaEmit === 2 &&
        proof.counts.sseProposal >= 2,
      mobile_scroll_no_topbar_nav_overlap: steps.some((step) => step.id === "11-proposal-en-mobile-scrolled-notice-route-component" && !step.audit.topbarNavOverlap),
      no_main_window_cuu: steps.every((step) => !step.audit.cuuLeak),
      no_default_kanban: steps.every((step) => !step.audit.kanbanLeak),
      no_old_preview_shell: steps.every((step) => !step.audit.oldShellLeak),
      no_weekly_fixture_copy: steps.every((step) => !step.audit.weeklyFixtureLeak),
      no_hash_navigation: steps.every((step) => !step.audit.hashNavigationLeak),
      no_horizontal_overflow: steps.every((step) => !step.audit.horizontalOverflow && !step.audit.navHorizontalOverflow),
      no_text_box_overflow: steps.every((step) => step.audit.textOverflowCount === 0)
    };
    const report = {
      generated_at: new Date().toISOString(),
      module: smokeTitle,
      chrome_path: chromePath,
      vite_url: baseUrl,
      api_target: apiTarget,
      output_dir: path.relative(repoRoot, outputDir).replace(/\\/gu, "/"),
      contact_sheet: "contact-sheet.png",
      gates,
      request_proof: proof,
      api_requests: requests,
      steps
    };
    await writeFile(path.join(outputDir, reportFilename), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await writeFile(
      path.join(outputDir, "smoke-summary.md"),
      [
        `# ${smokeTitle}`,
        "",
        `- ok: ${String(Object.values(gates).every(Boolean))}`,
        `- steps: ${String(steps.length)}`,
        `- path nav clicks: ${String(gates.path_nav_clicks)}`,
        `- history back/forward: ${String(gates.history_back_forward)}`,
        `- locale toggle reload: ${String(gates.locale_toggle_reload)}`,
        `- R4.10 route components: ${String(gates.r4_10_home_approvals_replay_route_components)}`,
        `- R4.11 route components: ${String(gates.r4_11_workitem_proposal_cost_settings_route_components)}`,
        `- R4.11 source truth: ${String(gates.r4_11_route_component_source_truth)}`,
        `- R4.11 VM/DOM match: ${String(gates.r4_11_vm_dom_value_match)}`,
        `- R4.12 approval response notice: ${String(gates.r4_12_approval_response_notice)}`,
        `- R4.12 reason gate: ${String(gates.r4_12_reason_gate_blocks_without_reason)}`,
        `- R4.12 request changes notice: ${String(gates.r4_12_request_changes_success_notice)}`,
        `- R4.12 merge notice: ${String(gates.r4_12_merge_success_notice)}`,
        `- R4.12 SSE refresh notice: ${String(gates.r4_12_sse_refresh_notice)}`,
        `- R4.12 budget warning notice: ${String(gates.r4_12_budget_warning_notice)}`,
        `- R4.12 desktop gate: ${String(gates.r4_12_desktop_gate_fail_closed)}`,
        `- R4.12 route-state actions: ${String(gates.r4_12_retry_access_route_states)}`,
        `- active-only product panels: ${String(gates.active_only_product_panels)}`,
        `- no text box overflow: ${String(gates.no_text_box_overflow)}`,
        ""
      ].join("\n"),
      "utf8"
    );
    if (!Object.values(gates).every(Boolean)) {
      throw new Error(`${smokeTitle} failed: ${JSON.stringify(gates)}`);
    }
    console.log(JSON.stringify({ ok: true, output_dir: report.output_dir, steps: steps.length }, null, 2));
  } finally {
    chrome?.cdp.close();
    await stopChrome(chrome?.child);
    if (viteServer) {
      await viteServer.close();
    }
    await closeServer(apiServer).catch(() => undefined);
    await removeBestEffort(userDataDir);
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
