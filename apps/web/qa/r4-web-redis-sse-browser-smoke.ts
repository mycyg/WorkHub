import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadSettings, settings } from "@workhub/config";
import {
  agentSteps,
  createDatabaseClient,
  r4WebLiveApiPgSeedIds,
  runMigrations,
  seedR4WebLiveApiPg,
  type R4WebLiveApiPgSeedResult
} from "@workhub/db";
import { eventTypes } from "@workhub/contracts";
import { createServer as createViteServer, type ViteDevServer } from "vite";

import { RedisPushBus } from "../../api/src/broker/redis.js";
import { makeWorkHubEvent, topics } from "../../../packages/events/src/index.js";

type Viewport = {
  width: number;
  height: number;
};

type ApiRequestRecord = {
  method: string;
  pathname: string;
  search: string;
  locale: string | null;
  url: string;
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
  liveStreams: string | null;
  liveStreamCount: number;
  liveConnectedCount: number;
  liveEventCount: number;
  liveRefreshCount: number;
  liveLastEvent: string | null;
  liveLastStream: string | null;
  liveReplayStepVisible: boolean;
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
  "2026-06-11-r4-web-redis-sse-production-browser-smoke"
);

const r4RedisSseStepId = "00000000-0000-4000-8000-000000000708";
const r4RedisSseStepText = "R4.8 Redis SSE replay refresh step from the production-like browser smoke.";

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

async function waitForHttpOk(url: string, label: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return true;
      }
      lastError = new Error(`${label} returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 160));
  }
  throw new Error(`Timed out waiting for ${label}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function tailLines(lines: string[], limit = 16) {
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

async function startApiServer(input: { port: number; label: string; redisUrl: string }) {
  const logs: string[] = [];
  const child = spawn(process.execPath, [
    "--import",
    "tsx",
    path.join(repoRoot, "apps", "api", "src", "server.ts")
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      APP_ENV: "test",
      PORT: String(input.port),
      API_HOST: "127.0.0.1",
      DATABASE_URL: settings.databaseUrl,
      TSX_TSCONFIG_PATH: path.join(repoRoot, "tsconfig.base.json"),
      BROKER_BACKEND: "redis",
      BROKER_URL: input.redisUrl,
      WORKER_COUNT: "2",
      AGENT_RUN_RECOVERY_INTERVAL_MS: "0"
    }
  });
  child.stdout.on("data", (chunk) => {
    logs.push(`[${input.label}] ${String(chunk).trim()}`);
  });
  child.stderr.on("data", (chunk) => {
    logs.push(`[${input.label}] ${String(chunk).trim()}`);
  });
  child.once("exit", (code, signal) => {
    logs.push(`[${input.label}] api process exited code=${String(code)} signal=${String(signal)}`);
  });
  try {
    await waitForHttpOk(`http://127.0.0.1:${input.port}/api/health`, `WorkHub API health (${input.label})`);
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nAPI log tail:\n${tailLines(logs).join("\n")}`
    );
  }
  return { child, logs };
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
  private handlers = new Map<string, Array<(params: unknown) => void>>();

  constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as CdpMessage;
      if (!message.id && message.method) {
        for (const handler of this.handlers.get(message.method) ?? []) {
          handler(message.params);
        }
        return;
      }
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

  on(method: string, handler: (params: unknown) => void) {
    this.handlers.set(method, [...(this.handlers.get(method) ?? []), handler]);
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
    "--window-size=1365,1120",
    "about:blank"
  ]) as ChildProcessWithoutNullStreams;
  const websocketUrl = await waitForDebugTarget(debugPort);
  const cdp = await CdpClient.connect(websocketUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  return { child, cdp };
}

function collectApiRequests(cdp: CdpClient, requests: ApiRequestRecord[]) {
  cdp.on("Network.requestWillBeSent", (params) => {
    const request = (params as { request?: { url?: string; method?: string } } | undefined)?.request;
    if (!request?.url) {
      return;
    }
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return;
    }
    requests.push({
      method: request.method ?? "GET",
      pathname: url.pathname,
      search: url.search,
      locale: url.searchParams.get("locale"),
      url: request.url
    });
  });
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

function routeStatusDebugExpression() {
  return `(() => ({
    status: document.querySelector("[data-r4-web-route-status]")?.getAttribute("data-r4-web-route-status") || "",
    pathname: location.pathname,
    title: document.title,
    text: (document.body?.innerText || "").slice(0, 1200)
  }))()`;
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

async function navigate(cdp: CdpClient, url: string, expectedStatus: string) {
  await cdp.send("Page.navigate", { url });
  const route = await waitFor<{ status: string; pathname: string; title: string; text: string }>(
    cdp,
    `${url} -> ${expectedStatus}`,
    routeStatusDebugExpression(),
    (value) => value.status === expectedStatus || value.status === "error"
  );
  if (route.status !== expectedStatus) {
    throw new Error(`${url} expected route status ${expectedStatus}, got ${route.status}: ${JSON.stringify(route)}`);
  }
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
      ".wh-product-rail-tag",
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
      enChrome: text.includes("Work entry") && text.includes("Focus"),
      liveStreams: document.documentElement.dataset.r4LiveStreams || null,
      liveStreamCount: Number(document.documentElement.dataset.r4LiveStreamCount || "0"),
      liveConnectedCount: Number(document.documentElement.dataset.r4LiveConnectedCount || "0"),
      liveEventCount: Number(document.documentElement.dataset.r4LiveEventCount || "0"),
      liveRefreshCount: Number(document.documentElement.dataset.r4LiveRefreshCount || "0"),
      liveLastEvent: document.documentElement.dataset.r4LiveLastEvent || null,
      liveLastStream: document.documentElement.dataset.r4LiveLastStream || null,
      liveReplayStepVisible: text.includes(${JSON.stringify(r4RedisSseStepText)})
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

async function captureStep(
  cdp: CdpClient,
  input: { id: string; url: string; viewport: Viewport; expectedStatus: string }
): Promise<StepReport> {
  const audit = await cdp.evaluate<BrowserAudit>(auditExpression());
  if (audit.status !== input.expectedStatus) {
    throw new Error(`${input.id} expected status ${input.expectedStatus}, got ${audit.status}`);
  }
  if (input.expectedStatus === "ready" && !audit.productShell) {
    throw new Error(`${input.id} did not render the product shell`);
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

function contactSheetDocument(steps: StepReport[]) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>R4.8 Web Redis SSE Production Browser Contact Sheet</title>
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
  await setViewport(cdp, { width: 1280, height: 2200 });
  await cdp.send("Page.navigate", { url: pathToFileURL(htmlPath).href });
  await waitFor<string>(cdp, "contact sheet images", "document.readyState", (value) => value === "complete");
  const captured = await cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile(screenshotPath, Buffer.from(captured.data, "base64"));
  await assertPng(screenshotPath);
}

async function runScenario(cdp: CdpClient, baseUrl: string, seed: R4WebLiveApiPgSeedResult) {
  const desktop = { width: 1365, height: 1120 };
  const mobile = { width: 390, height: 1180 };
  const steps: StepReport[] = [];
  const ids = seed.ids;

  await setViewport(cdp, desktop);
  await registerThroughOnboarding(cdp, baseUrl, "P0.5 Reviewer");
  await navigate(cdp, `${baseUrl}/`, "ready");
  steps.push(await captureStep(cdp, { id: "01-home-zh-desktop-real-api", url: `${baseUrl}/`, viewport: desktop, expectedStatus: "ready" }));

  await clickAndWait(cdp, 'a[href="/approvals"]', "/approvals");
  steps.push(await captureStep(cdp, { id: "02-approvals-click-zh-desktop-real-api", url: `${baseUrl}/approvals`, viewport: desktop, expectedStatus: "ready" }));

  await clickAndWait(cdp, `a[href="/workitems/${ids.workItemId}"]`, `/workitems/${ids.workItemId}`);
  steps.push(await captureStep(cdp, { id: "03-workitem-click-zh-desktop-real-api", url: `${baseUrl}/workitems/${ids.workItemId}`, viewport: desktop, expectedStatus: "ready" }));

  await historyAndWait(cdp, "back", "/approvals");
  steps.push(await captureStep(cdp, { id: "04-history-back-approvals-real-api", url: `${baseUrl}/approvals`, viewport: desktop, expectedStatus: "ready" }));

  await historyAndWait(cdp, "forward", `/workitems/${ids.workItemId}`);
  steps.push(await captureStep(cdp, { id: "05-history-forward-workitem-real-api", url: `${baseUrl}/workitems/${ids.workItemId}`, viewport: desktop, expectedStatus: "ready" }));

  await clickAndWait(cdp, '[data-wh-locale="en-US"]', `/workitems/${ids.workItemId}`);
  await waitFor<BrowserAudit>(
    cdp,
    "en-US reload",
    auditExpression(),
    (audit) => audit.lang === "en-US" && audit.enChrome && audit.storedLocale === "en-US" && audit.activeLocale === "en-US"
  );
  steps.push(await captureStep(cdp, { id: "06-locale-toggle-en-workitem-real-api", url: `${baseUrl}/workitems/${ids.workItemId}`, viewport: desktop, expectedStatus: "ready" }));

  await setViewport(cdp, mobile);
  await navigate(cdp, `${baseUrl}/proposals/${ids.proposalId}`, "ready");
  await cdp.evaluate("window.scrollTo(0, 680); true");
  await new Promise((resolve) => setTimeout(resolve, 250));
  steps.push(await captureStep(cdp, { id: "07-proposal-mobile-scrolled-real-api", url: `${baseUrl}/proposals/${ids.proposalId}`, viewport: mobile, expectedStatus: "ready" }));

  await setViewport(cdp, desktop);
  await navigate(cdp, `${baseUrl}/agent-runs/${ids.runId}/replay`, "ready");
  steps.push(await captureStep(cdp, { id: "08-replay-desktop-real-api", url: `${baseUrl}/agent-runs/${ids.runId}/replay`, viewport: desktop, expectedStatus: "ready" }));

  await navigate(cdp, `${baseUrl}/dashboard/cost`, "ready");
  steps.push(await captureStep(cdp, { id: "09-cost-desktop-real-api", url: `${baseUrl}/dashboard/cost`, viewport: desktop, expectedStatus: "ready" }));

  await setViewport(cdp, mobile);
  await navigate(cdp, `${baseUrl}/settings`, "ready");
  steps.push(await captureStep(cdp, { id: "10-settings-mobile-route-fallback", url: `${baseUrl}/settings`, viewport: mobile, expectedStatus: "ready" }));

  await navigate(cdp, `${baseUrl}/proposals/${ids.missingProposalId}`, "empty");
  steps.push(await captureStep(cdp, { id: "11-missing-proposal-empty-real-api", url: `${baseUrl}/proposals/${ids.missingProposalId}`, viewport: mobile, expectedStatus: "empty" }));

  await setViewport(cdp, desktop);
  await navigate(cdp, `${baseUrl}/workitems/${ids.forbiddenWorkItemId}`, "forbidden");
  steps.push(await captureStep(cdp, { id: "12-forbidden-workitem-real-api", url: `${baseUrl}/workitems/${ids.forbiddenWorkItemId}`, viewport: desktop, expectedStatus: "forbidden" }));

  await navigate(cdp, `${baseUrl}/missing-r4-redis-sse-route`, "error");
  steps.push(await captureStep(cdp, { id: "13-unknown-route-error", url: `${baseUrl}/missing-r4-redis-sse-route`, viewport: desktop, expectedStatus: "error" }));

  return steps;
}

function requestProof(requests: ApiRequestRecord[], seed: R4WebLiveApiPgSeedResult) {
  const ids = seed.ids;
  const has = (pathname: string, predicate: (request: ApiRequestRecord) => boolean = () => true) =>
    requests.some((request) => request.pathname === pathname && predicate(request));
  const count = (pathname: string) => requests.filter((request) => request.pathname === pathname).length;
  return {
    authMe: has("/api/auth/me"),
    identify: has("/api/auth/identify", (request) => request.method === "POST"),
    localePatch: has("/api/auth/preferences", (request) => request.method === "PATCH"),
    attentionZh: has("/api/pages/attention", (request) => request.locale === "zh-CN"),
    approvals: has("/api/pages/approvals"),
    workitemZh: has(`/api/pages/workitems/${ids.workItemId}`, (request) => request.locale === "zh-CN"),
    workitemEn: has(`/api/pages/workitems/${ids.workItemId}`, (request) => request.locale === "en-US"),
    proposal: has(`/api/pages/proposals/${ids.proposalId}`),
    replay: has(`/api/agent-runs/${ids.runId}/replay`),
    cost: has("/api/pages/cost"),
    settingsGoldPath: count("/api/pages/gold-path") >= 1,
    missingProposalEmpty: has(`/api/pages/proposals/${ids.missingProposalId}`),
    forbiddenWorkItem: has(`/api/pages/workitems/${ids.forbiddenWorkItemId}`),
    streamMe: has("/api/push/stream/me"),
    streamWorkItem: has(`/api/push/stream/workitem/${ids.workItemId}`),
    streamRun: has(`/api/push/stream/run/${ids.runId}`),
    streamProposal: has(`/api/push/stream/proposal/${ids.proposalId}`),
    counts: {
      authMe: count("/api/auth/me"),
      goldPath: count("/api/pages/gold-path"),
      attention: count("/api/pages/attention"),
      approvals: count("/api/pages/approvals"),
      workitem: count(`/api/pages/workitems/${ids.workItemId}`),
      proposal: count(`/api/pages/proposals/${ids.proposalId}`),
      replay: count(`/api/agent-runs/${ids.runId}/replay`),
      cost: count("/api/pages/cost"),
      streamMe: count("/api/push/stream/me"),
      streamWorkItem: count(`/api/push/stream/workitem/${ids.workItemId}`),
      streamRun: count(`/api/push/stream/run/${ids.runId}`),
      streamProposal: count(`/api/push/stream/proposal/${ids.proposalId}`)
    }
  };
}

function redisUrlFromEnv() {
  return process.env["BROKER_URL"] || settings.broker.url || "redis://127.0.0.1:6379";
}

function validateProductionMemoryBrokerFails() {
  try {
    loadSettings({
      APP_ENV: "production",
      PORT: "8787",
      API_HOST: "127.0.0.1",
      DATABASE_URL: settings.databaseUrl,
      COOKIE_SECRET: "r4-redis-sse-production-cookie-secret",
      COOKIE_SECURE: "true",
      CORS_ALLOW_ORIGINS: "https://workhub.local",
      WORKER_COUNT: "2",
      BROKER_BACKEND: "memory"
    });
    return false;
  } catch (error) {
    return error instanceof Error && error.message.includes("BROKER_BACKEND=memory");
  }
}

async function assertRedisBroker(redisUrl: string) {
  const publisher = new RedisPushBus(redisUrl);
  const subscriber = new RedisPushBus(redisUrl);
  const topic = `r4:redis-sse:${Date.now()}`;
  const subscription = await subscriber.subscribe(topic);
  try {
    await publisher.publish(topic, "r4.redis.probe", { ok: true });
    const received = await Promise.race([
      subscription[Symbol.asyncIterator]().next(),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 5_000))
    ]);
    if (received === "timeout" || received.done || received.value.type !== "r4.redis.probe") {
      throw new Error("Redis broker probe did not deliver the test event.");
    }
    return {
      topic,
      event_type: received.value.type
    };
  } finally {
    await subscriber.unsubscribe(topic, subscription);
    await Promise.all([publisher.close(), subscriber.close()]);
  }
}

async function identifyCookie(baseUrl: string, nickname: string) {
  const response = await fetch(`${baseUrl}/api/auth/identify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname })
  });
  if (!response.ok) {
    throw new Error(`identify ${nickname} failed with HTTP ${response.status}: ${await response.text()}`);
  }
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) {
    throw new Error(`identify ${nickname} did not set an auth cookie.`);
  }
  return cookie;
}

async function streamStatus(baseUrl: string, pathname: string, cookie: string) {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: {
      Accept: "text/event-stream",
      Cookie: cookie
    },
    signal: controller.signal
  });
  const status = response.status;
  const contentType = response.headers.get("content-type") ?? "";
  controller.abort();
  await response.body?.cancel().catch(() => undefined);
  return {
    pathname,
    status,
    content_type: contentType
  };
}

async function collectTopicAuthProof(baseUrl: string, seed: R4WebLiveApiPgSeedResult) {
  const ownerCookie = await identifyCookie(baseUrl, "P0.5 Reviewer");
  const strangerCookie = await identifyCookie(baseUrl, "R4.7 Forbidden Reviewer");
  const ownerWorkItem = await streamStatus(baseUrl, `/api/push/stream/workitem/${seed.ids.workItemId}`, ownerCookie);
  const strangerWorkItem = await streamStatus(baseUrl, `/api/push/stream/workitem/${seed.ids.workItemId}`, strangerCookie);
  const ownerAll = await streamStatus(baseUrl, "/api/push/stream", ownerCookie);
  return {
    ownerWorkItem,
    strangerWorkItem,
    ownerAll,
    owner_workitem_200: ownerWorkItem.status === 200 && ownerWorkItem.content_type.includes("text/event-stream"),
    stranger_workitem_403: strangerWorkItem.status === 403,
    non_admin_all_403: ownerAll.status === 403
  };
}

async function respondApprovalFromApi(baseUrl: string, seed: R4WebLiveApiPgSeedResult) {
  const cookie = await identifyCookie(baseUrl, "P0.5 Reviewer");
  const response = await fetch(`${baseUrl}/api/approvals/${seed.ids.approvalId}/respond`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie
    },
    body: JSON.stringify({ decision: "allow", remember: "once" })
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`approval respond failed with HTTP ${response.status}: ${body}`);
  }
  return {
    status: response.status,
    body: JSON.parse(body) as unknown
  };
}

function liveMetricExpression() {
  return `(() => ({
    status: document.querySelector("[data-r4-web-route-status]")?.getAttribute("data-r4-web-route-status") || "",
    pathname: location.pathname,
    streams: document.documentElement.dataset.r4LiveStreams || "",
    streamCount: Number(document.documentElement.dataset.r4LiveStreamCount || "0"),
    connectedCount: Number(document.documentElement.dataset.r4LiveConnectedCount || "0"),
    eventCount: Number(document.documentElement.dataset.r4LiveEventCount || "0"),
    refreshCount: Number(document.documentElement.dataset.r4LiveRefreshCount || "0"),
    lastEvent: document.documentElement.dataset.r4LiveLastEvent || "",
    lastStream: document.documentElement.dataset.r4LiveLastStream || "",
    replayStepVisible: document.body.textContent.includes(${JSON.stringify(r4RedisSseStepText)})
  }))()`;
}

async function waitForLiveConnection(cdp: CdpClient, streamKey: string) {
  return waitFor<{
    streams: string;
    connectedCount: number;
  }>(
    cdp,
    `live stream ${streamKey} connection`,
    liveMetricExpression(),
    (value) => value.streams.split(",").includes(streamKey) && value.connectedCount > 0
  );
}

async function waitForLiveRefresh(cdp: CdpClient, input: {
  eventCountBefore: number;
  refreshCountBefore: number;
  eventType: string;
  status?: string;
  replayStepVisible?: boolean;
}) {
  return waitFor<{
    status: string;
    eventCount: number;
    refreshCount: number;
    lastEvent: string;
    replayStepVisible: boolean;
  }>(
    cdp,
    `live refresh ${input.eventType}`,
    liveMetricExpression(),
    (value) =>
      value.eventCount > input.eventCountBefore &&
      value.refreshCount > input.refreshCountBefore &&
      value.lastEvent === input.eventType &&
      (!input.status || value.status === input.status) &&
      (input.replayStepVisible === undefined || value.replayStepVisible === input.replayStepVisible),
    18_000
  );
}

async function insertReplayStepAndPublish(redisUrl: string, seed: R4WebLiveApiPgSeedResult) {
  const dbClient = createDatabaseClient(settings);
  try {
    await dbClient.db
      .insert(agentSteps)
      .values({
        id: r4RedisSseStepId,
        agentRunId: seed.ids.runId,
        seq: 8,
        stepNo: 8,
        phase: "tool_result",
        toolName: "redis_sse_browser_smoke",
        inputJson: { route: "r4.8", source: "redis-sse-browser-smoke" },
        outputExcerpt: r4RedisSseStepText,
        createdAt: new Date()
      })
      .onConflictDoUpdate({
        target: agentSteps.id,
        set: {
          outputExcerpt: r4RedisSseStepText,
          createdAt: new Date()
        }
      });
  } finally {
    await dbClient.close();
  }

  const bus = new RedisPushBus(redisUrl);
  const topic = topics.run(seed.ids.runId).topic;
  const event = makeWorkHubEvent({
    type: eventTypes.agentRunStep,
    topic,
    actor: { actor_kind: "ai", label: "WorkHub AI" },
    work_item_id: seed.ids.workItemId,
    run_id: seed.ids.runId,
    preview_text: r4RedisSseStepText,
    cuu_state: "thinking",
    data: {
      run_id: seed.ids.runId,
      work_item_id: seed.ids.workItemId,
      step_no: 8,
      phase: "tool_result",
      output_excerpt: r4RedisSseStepText
    }
  });
  try {
    await bus.publish(topic, eventTypes.agentRunStep, event);
  } finally {
    await bus.close();
  }
  return {
    topic,
    event_type: eventTypes.agentRunStep
  };
}

async function seedDatabase() {
  if (settings.appEnv === "production") {
    throw new Error("Refusing to run R4.8 Redis/SSE browser smoke with APP_ENV=production.");
  }
  await runMigrations(settings);
  const client = createDatabaseClient(settings);
  try {
    return await seedR4WebLiveApiPg(client.db);
  } finally {
    await client.close();
  }
}

async function main() {
  const chromePath = findChrome();
  if (!chromePath) {
    throw new Error("Chrome/Chromium is required. Set CHROME_PATH to run R4.8 Redis/SSE browser QA.");
  }

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  const redisUrl = redisUrlFromEnv();
  const redisProbe = await assertRedisBroker(redisUrl);
  const productionMemoryFailClosed = validateProductionMemoryBrokerFails();
  const seed = await seedDatabase();
  const apiStreamPort = await freePort();
  const apiActionPort = await freePort();
  const vitePort = await freePort();
  const debugPort = await freePort();
  const apiStreamTarget = `http://127.0.0.1:${apiStreamPort}`;
  const apiActionTarget = `http://127.0.0.1:${apiActionPort}`;
  let apiStream: Awaited<ReturnType<typeof startApiServer>> | undefined;
  let apiAction: Awaited<ReturnType<typeof startApiServer>> | undefined;
  let viteServer: ViteDevServer | undefined;
  let chrome: { child: ChildProcessWithoutNullStreams; cdp: CdpClient } | undefined;
  const apiRequests: ApiRequestRecord[] = [];
  const userDataDir = path.join(os.tmpdir(), `workhub-r4-redis-sse-${Date.now()}`);
  let topicAuthProof: Awaited<ReturnType<typeof collectTopicAuthProof>> | undefined;
  let approvalLiveProof: unknown;
  let runLiveProof: unknown;

  try {
    apiStream = await startApiServer({ port: apiStreamPort, label: "stream-api", redisUrl });
    apiAction = await startApiServer({ port: apiActionPort, label: "action-api", redisUrl });
    topicAuthProof = await collectTopicAuthProof(apiStreamTarget, seed);
    viteServer = await createViteServer({
      configFile: false,
      root: webRoot,
      server: {
        host: "127.0.0.1",
        port: vitePort,
        strictPort: true,
        proxy: {
          "/api": apiStreamTarget,
          "/openapi.json": apiStreamTarget
        }
      }
    });
    await viteServer.listen();
    await waitForHttpOk(`http://127.0.0.1:${vitePort}/`, "Vite Web dev server");
    const baseUrl = `http://127.0.0.1:${vitePort}`;
    chrome = await launchChrome(chromePath, debugPort, userDataDir);
    collectApiRequests(chrome.cdp, apiRequests);
    const steps = await runScenario(chrome.cdp, baseUrl, seed);

    await setViewport(chrome.cdp, { width: 1365, height: 1120 });
    await navigate(chrome.cdp, `${baseUrl}/approvals`, "ready");
    await waitForLiveConnection(chrome.cdp, "me");
    const approvalBefore = await chrome.cdp.evaluate<{ eventCount: number; refreshCount: number }>(liveMetricExpression());
    const approvalResponse = await respondApprovalFromApi(apiActionTarget, seed);
    const approvalAfter = await waitForLiveRefresh(chrome.cdp, {
      eventCountBefore: approvalBefore.eventCount,
      refreshCountBefore: approvalBefore.refreshCount,
      eventType: eventTypes.permissionDecided,
      status: "empty"
    });
    steps.push(await captureStep(chrome.cdp, {
      id: "14-approvals-after-redis-sse-permission-decided-empty",
      url: `${baseUrl}/approvals`,
      viewport: { width: 1365, height: 1120 },
      expectedStatus: "empty"
    }));
    approvalLiveProof = {
      api_action_target: apiActionTarget,
      response: approvalResponse,
      before: approvalBefore,
      after: approvalAfter
    };

    await navigate(chrome.cdp, `${baseUrl}/agent-runs/${seed.ids.runId}/replay`, "ready");
    await waitForLiveConnection(chrome.cdp, "run");
    const replayBefore = await chrome.cdp.evaluate<{ eventCount: number; refreshCount: number }>(liveMetricExpression());
    const replayPublish = await insertReplayStepAndPublish(redisUrl, seed);
    const replayAfter = await waitForLiveRefresh(chrome.cdp, {
      eventCountBefore: replayBefore.eventCount,
      refreshCountBefore: replayBefore.refreshCount,
      eventType: eventTypes.agentRunStep,
      status: "ready",
      replayStepVisible: true
    });
    steps.push(await captureStep(chrome.cdp, {
      id: "15-replay-after-redis-sse-agent-step-real-api",
      url: `${baseUrl}/agent-runs/${seed.ids.runId}/replay`,
      viewport: { width: 1365, height: 1120 },
      expectedStatus: "ready"
    }));
    runLiveProof = {
      publish: replayPublish,
      before: replayBefore,
      after: replayAfter
    };

    await navigateFileAndCaptureContactSheet(chrome.cdp, steps);
    const proof = requestProof(apiRequests, seed);
    const gates = {
      pg_seed_applied: seed.ids.currentUserId.length > 0 && seed.ids.workItemId === r4WebLiveApiPgSeedIds.workItemId,
      redis_server_available: redisProbe.event_type === "r4.redis.probe",
      broker_backend_redis: redisUrl.startsWith("redis://"),
      production_multi_worker_memory_fail_closed: productionMemoryFailClosed,
      api_stream_server_started: Boolean(apiStream?.child.pid),
      api_action_server_started: Boolean(apiAction?.child.pid),
      vite_dev_server_started: Boolean(viteServer.httpServer?.listening),
      screenshots_captured: steps.every((step) => existsSync(path.join(outputDir, step.screenshot))) && existsSync(path.join(outputDir, "contact-sheet.png")),
      route_coverage_ready_empty_forbidden_error: ["ready", "empty", "forbidden", "error"].every((status) => steps.some((step) => step.audit.status === status)),
      required_routes_ready: ["/", "/approvals", `/workitems/${seed.ids.workItemId}`, `/proposals/${seed.ids.proposalId}`, `/agent-runs/${seed.ids.runId}/replay`, "/dashboard/cost", "/settings"]
        .every((pathname) => steps.some((step) => step.audit.pathname === pathname && step.audit.status === "ready")),
      ready_routes_use_live_api_endpoints:
        proof.authMe &&
        proof.identify &&
        proof.attentionZh &&
        proof.approvals &&
        proof.workitemZh &&
        proof.workitemEn &&
        proof.proposal &&
        proof.replay &&
        proof.cost &&
        proof.settingsGoldPath,
      locale_toggle_reload: steps.some((step) => step.id === "06-locale-toggle-en-workitem-real-api" && step.audit.lang === "en-US" && step.audit.enChrome && step.audit.activeLocale === "en-US") && proof.localePatch,
      path_nav_clicks: steps.some((step) => step.id === "02-approvals-click-zh-desktop-real-api" && step.audit.pathname === "/approvals") &&
        steps.some((step) => step.id === "03-workitem-click-zh-desktop-real-api" && step.audit.pathname === `/workitems/${seed.ids.workItemId}`),
      history_back_forward: steps.some((step) => step.id === "04-history-back-approvals-real-api" && step.audit.pathname === "/approvals") &&
        steps.some((step) => step.id === "05-history-forward-workitem-real-api" && step.audit.pathname === `/workitems/${seed.ids.workItemId}`),
      empty_and_forbidden_from_real_api: proof.missingProposalEmpty && proof.forbiddenWorkItem,
      topic_auth_owner_200_stranger_403: Boolean(topicAuthProof?.owner_workitem_200 && topicAuthProof.stranger_workitem_403 && topicAuthProof.non_admin_all_403),
      browser_connected_to_sse: proof.streamMe && proof.streamRun && proof.streamWorkItem,
      cross_worker_permission_event_delivered: Boolean(
        approvalLiveProof &&
        steps.some((step) =>
          step.id === "14-approvals-after-redis-sse-permission-decided-empty" &&
          step.audit.status === "empty" &&
          step.audit.liveLastEvent === eventTypes.permissionDecided &&
          step.audit.liveRefreshCount > 0
        )
      ),
      redis_run_event_reconciled_replay: Boolean(
        runLiveProof &&
        steps.some((step) =>
          step.id === "15-replay-after-redis-sse-agent-step-real-api" &&
          step.audit.liveLastEvent === eventTypes.agentRunStep &&
          step.audit.liveReplayStepVisible
        )
      ),
      product_shell_stays_path_mode: steps.filter((step) => step.audit.productShell).every((step) => step.audit.linkModePath),
      no_main_window_cuu: steps.every((step) => !step.audit.cuuLeak),
      no_default_kanban: steps.every((step) => !step.audit.kanbanLeak),
      no_old_preview_shell: steps.every((step) => !step.audit.oldShellLeak),
      no_weekly_fixture_copy: steps.every((step) => !step.audit.weeklyFixtureLeak),
      no_hash_navigation: steps.every((step) => !step.audit.hashNavigationLeak),
      no_horizontal_overflow: steps.every((step) => !step.audit.horizontalOverflow && !step.audit.navHorizontalOverflow),
      no_text_box_overflow: steps.every((step) => step.audit.textOverflowCount === 0),
      mobile_scroll_no_topbar_nav_overlap: steps.some((step) => step.id === "07-proposal-mobile-scrolled-real-api" && !step.audit.topbarNavOverlap)
    };
    const ok = Object.values(gates).every(Boolean);
    const report = {
      generated_at: new Date().toISOString(),
      module: "R4.8 Web Redis/SSE production browser smoke",
      chrome_path: chromePath,
      vite_url: baseUrl,
      api_stream_target: apiStreamTarget,
      api_action_target: apiActionTarget,
      seed,
      output_dir: path.relative(repoRoot, outputDir).replace(/\\/gu, "/"),
      contact_sheet: "contact-sheet.png",
      gates,
      request_proof: proof,
      redis: {
        url: redisUrl,
        probe: redisProbe,
        productionMemoryFailClosed
      },
      topic_auth: topicAuthProof,
      live_proof: {
        approval: approvalLiveProof,
        run: runLiveProof
      },
      api_requests: apiRequests,
      api_log_tail: {
        stream_api: tailLines(apiStream?.logs ?? []),
        action_api: tailLines(apiAction?.logs ?? [])
      },
      steps
    };
    await writeFile(path.join(outputDir, "redis-sse-production-browser-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await writeFile(
      path.join(outputDir, "smoke-summary.md"),
      [
        "# R4.8 Web Redis/SSE Production Browser Smoke",
        "",
        `- ok: ${String(ok)}`,
        `- steps: ${String(steps.length)}`,
        `- stream api target: ${apiStreamTarget}`,
        `- action api target: ${apiActionTarget}`,
        `- redis url: ${redisUrl}`,
        `- seeded work item: ${seed.ids.workItemId}`,
        `- seeded proposal: ${seed.ids.proposalId}`,
        `- seeded run: ${seed.ids.runId}`,
        `- cross worker permission event delivered: ${String(gates.cross_worker_permission_event_delivered)}`,
        `- redis run event reconciled replay: ${String(gates.redis_run_event_reconciled_replay)}`,
        `- locale toggle reload: ${String(gates.locale_toggle_reload)}`,
        `- no text box overflow: ${String(gates.no_text_box_overflow)}`,
        ""
      ].join("\n"),
      "utf8"
    );
    if (!ok) {
      throw new Error(`R4.8 Redis/SSE browser smoke failed: ${JSON.stringify(gates)}`);
    }
    console.log(JSON.stringify({ ok, output_dir: report.output_dir, steps: steps.length, api_stream_target: apiStreamTarget, api_action_target: apiActionTarget, redis_url: redisUrl }, null, 2));
  } finally {
    chrome?.cdp.close();
    await stopProcess(chrome?.child);
    if (viteServer) {
      await viteServer.close();
    }
    await stopProcess(apiAction?.child);
    await stopProcess(apiStream?.child);
    await removeBestEffort(userDataDir);
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
