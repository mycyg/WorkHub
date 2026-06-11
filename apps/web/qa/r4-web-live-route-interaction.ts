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
import type { GoldPathSurfaceVM, WorkHubLocale } from "@workhub/contracts";

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
const outputDir = path.join(
  repoRoot,
  "docs",
  "workhub",
  "05-clients",
  "assets",
  "audit",
  "2026-06-11-r4-web-live-route-interaction"
);

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
      cost: fixture.costDashboard
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
  const server = createHttpServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    requestLog.push({
      method: request.method ?? "GET",
      pathname: url.pathname,
      search: url.search,
      locale: url.searchParams.get("locale"),
      referer: typeof request.headers.referer === "string" ? request.headers.referer : null
    });

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
    if (request.method === "GET" && url.pathname === "/api/pages/gold-path") {
      sendJson(response, 200, surface);
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
  input: { id: string; url: string; viewport: Viewport; expectedStatus: string }
): Promise<StepReport> {
  const audit = await cdp.evaluate<BrowserAudit>(auditExpression());
  if (audit.status !== input.expectedStatus) {
    throw new Error(`${input.id} expected status ${input.expectedStatus}, got ${audit.status}`);
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
  <title>R4.5 Web Live Route Interaction Contact Sheet</title>
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
  steps.push(await captureStep(cdp, { id: "01-home-zh-desktop", url: `${baseUrl}/`, viewport: desktop, expectedStatus: "ready" }));

  await clickAndWait(cdp, 'a[href="/approvals"]', "/approvals");
  steps.push(await captureStep(cdp, { id: "02-approvals-click-zh-desktop", url: `${baseUrl}/approvals`, viewport: desktop, expectedStatus: "ready" }));

  await clickAndWait(cdp, 'a[href="/workitems/r4-live-workitem"]', "/workitems/r4-live-workitem");
  steps.push(await captureStep(cdp, { id: "03-workitem-click-zh-desktop", url: `${baseUrl}/workitems/r4-live-workitem`, viewport: desktop, expectedStatus: "ready" }));

  await historyAndWait(cdp, "back", "/approvals");
  steps.push(await captureStep(cdp, { id: "04-history-back-approvals", url: `${baseUrl}/approvals`, viewport: desktop, expectedStatus: "ready" }));

  await historyAndWait(cdp, "forward", "/workitems/r4-live-workitem");
  steps.push(await captureStep(cdp, { id: "05-history-forward-workitem", url: `${baseUrl}/workitems/r4-live-workitem`, viewport: desktop, expectedStatus: "ready" }));

  await clickAndWait(cdp, '[data-wh-locale="en-US"]', "/workitems/r4-live-workitem");
  await waitFor<BrowserAudit>(
    cdp,
    "en-US reload",
    auditExpression(),
    (audit) => audit.lang === "en-US" && audit.enChrome && audit.storedLocale === "en-US" && audit.activeLocale === "en-US"
  );
  steps.push(await captureStep(cdp, { id: "06-locale-toggle-en-reload", url: `${baseUrl}/workitems/r4-live-workitem`, viewport: desktop, expectedStatus: "ready" }));

  await setViewport(cdp, mobile);
  await navigate(cdp, `${baseUrl}/approvals?empty=approvals`, "empty");
  steps.push(await captureStep(cdp, { id: "07-empty-approvals-mobile", url: `${baseUrl}/approvals?empty=approvals`, viewport: mobile, expectedStatus: "empty" }));

  await setViewport(cdp, desktop);
  await navigate(cdp, `${baseUrl}/workitems/r4-live-forbidden`, "forbidden");
  steps.push(await captureStep(cdp, { id: "08-forbidden-workitem-desktop", url: `${baseUrl}/workitems/r4-live-forbidden`, viewport: desktop, expectedStatus: "forbidden" }));

  await navigate(cdp, `${baseUrl}/missing-r4-live-route`, "error");
  steps.push(await captureStep(cdp, { id: "09-unknown-route-error", url: `${baseUrl}/missing-r4-live-route`, viewport: desktop, expectedStatus: "error" }));

  await setViewport(cdp, mobile);
  await navigate(cdp, `${baseUrl}/proposals/r4-live-proposal`, "ready");
  await cdp.evaluate("window.scrollTo(0, 680); true");
  await new Promise((resolve) => setTimeout(resolve, 250));
  steps.push(await captureStep(cdp, { id: "10-proposal-mobile-scrolled", url: `${baseUrl}/proposals/r4-live-proposal`, viewport: mobile, expectedStatus: "ready" }));

  return steps;
}

function requestProof(requests: ApiRequestRecord[]) {
  const count = (pathname: string, method = "GET") =>
    requests.filter((request) => request.method === method && request.pathname === pathname).length;
  return {
    attention: requests.some((request) => request.pathname === "/api/pages/attention" && request.locale === "zh-CN"),
    approvals: requests.some((request) => request.pathname === "/api/pages/approvals"),
    workitem: requests.some((request) => request.pathname === "/api/pages/workitems/r4-live-workitem"),
    workitemEn: requests.some((request) => request.pathname === "/api/pages/workitems/r4-live-workitem" && request.locale === "en-US"),
    proposal: requests.some((request) => request.pathname === "/api/pages/proposals/r4-live-proposal"),
    goldPath: requests.filter((request) => request.pathname === "/api/pages/gold-path").length >= 4,
    goldPathEn: requests.some((request) => request.pathname === "/api/pages/gold-path" && request.locale === "en-US"),
    localePatch: requests.some((request) => request.method === "PATCH" && request.pathname === "/api/auth/preferences"),
    counts: {
      attention: count("/api/pages/attention"),
      approvals: count("/api/pages/approvals"),
      workitem: count("/api/pages/workitems/r4-live-workitem"),
      workitemForbidden: count("/api/pages/workitems/r4-live-forbidden"),
      proposal: count("/api/pages/proposals/r4-live-proposal"),
      goldPath: count("/api/pages/gold-path"),
      preferencePatch: count("/api/auth/preferences", "PATCH")
    }
  };
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
        steps.some((step) => step.id === "03-workitem-click-zh-desktop" && step.audit.pathname === "/workitems/r4-live-workitem"),
      history_back_forward: steps.some((step) => step.id === "04-history-back-approvals" && step.audit.pathname === "/approvals") &&
        steps.some((step) => step.id === "05-history-forward-workitem" && step.audit.pathname === "/workitems/r4-live-workitem"),
      locale_toggle_reload: steps.some((step) => step.id === "06-locale-toggle-en-reload" && step.audit.lang === "en-US" && step.audit.enChrome && step.audit.activeLocale === "en-US"),
      ready_empty_forbidden_error_routes: ["ready", "empty", "forbidden", "error"].every((status) => steps.some((step) => step.audit.status === status)),
      ready_routes_use_page_vm_endpoints: proof.attention && proof.approvals && proof.workitem && proof.workitemEn && proof.proposal && proof.goldPath && proof.goldPathEn && proof.localePatch,
      product_shell_stays_path_mode: steps.filter((step) => step.audit.productShell).every((step) => step.audit.linkModePath),
      no_duplicate_route_loader_calls:
        proof.counts.approvals === 3 &&
        proof.counts.workitem === 3 &&
        proof.counts.workitemForbidden === 1 &&
        proof.counts.proposal === 1 &&
        proof.counts.preferencePatch === 1,
      mobile_scroll_no_topbar_nav_overlap: steps.some((step) => step.id === "10-proposal-mobile-scrolled" && !step.audit.topbarNavOverlap),
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
      module: "R4.5 Web live route interaction smoke",
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
    await writeFile(path.join(outputDir, "live-route-interaction-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await writeFile(
      path.join(outputDir, "smoke-summary.md"),
      [
        "# R4.5 Web Live Route Interaction Smoke",
        "",
        `- ok: ${String(Object.values(gates).every(Boolean))}`,
        `- steps: ${String(steps.length)}`,
        `- path nav clicks: ${String(gates.path_nav_clicks)}`,
        `- history back/forward: ${String(gates.history_back_forward)}`,
        `- locale toggle reload: ${String(gates.locale_toggle_reload)}`,
        `- no text box overflow: ${String(gates.no_text_box_overflow)}`,
        ""
      ].join("\n"),
      "utf8"
    );
    if (!Object.values(gates).every(Boolean)) {
      throw new Error(`R4.5 live route interaction smoke failed: ${JSON.stringify(gates)}`);
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
