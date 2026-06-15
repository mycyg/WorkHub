import { existsSync, statSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { WorkHubApiError, type WorkHubApiClient } from "@workhub/api-client";
import type {
  ApprovalCenterVM,
  AttentionHomeVM,
  CostDashboardVM,
  GoldPathSurfaceVM
} from "@workhub/contracts";
import type { WorkHubLocale } from "@workhub/ui/gold-path";
import { createP05GoldPathFixture, validateP05GoldPathFixture } from "../../packages/agent/src/fixtures/index.js";

import {
  loadWebRoute,
  renderWebRouteState,
  resolveWebRoute,
  webRouteRegistry,
  type WebRouteLoadStatus
} from "../../apps/web/src/routes.js";

type Viewport = {
  width: number;
  height: number;
};

type RouteCase = {
  id: string;
  label: string;
  locale: WorkHubLocale;
  viewport: Viewport;
  status: WebRouteLoadStatus;
  route: string;
  html: string;
  calls: string[];
};

type RouteClientOverrides = {
  attention?: AttentionHomeVM;
  approvals?: ApprovalCenterVM;
  cost?: CostDashboardVM;
  attentionError?: Error;
  approvalsError?: Error;
  costError?: Error;
};

type DomMarkers = {
  statuses: Record<string, number>;
  routeKeys: Record<string, number>;
  zhCopy: boolean;
  enCopy: boolean;
  pathNavigation: boolean;
  hashNavigationLeak: boolean;
  cuuLeak: number;
  kanbanLeak: number;
  clientWidth: number | null;
  scrollWidth: number | null;
  horizontalOverflow: boolean;
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const auditDir = path.join(repoRoot, "docs", "workhub", "05-clients", "assets", "audit", "2026-06-11-r4-web-route-registry-loader");
const requiredStatuses = ["loading", "ready", "empty", "error", "forbidden"] as const;
const requiredRouteKeys = ["home", "approvals", "cost"] as const;

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function stripTrailingWhitespace(value: string) {
  return value.replace(/[ \t]+$/gmu, "");
}

function countNeedle(value: string, needle: string) {
  return value.split(needle).length - 1;
}

function layoutNumber(html: string, attribute: string) {
  const match = new RegExp(`${attribute}="(\\d+)"`, "u").exec(html);
  return match?.[1] ? Number.parseInt(match[1], 10) : null;
}

function goldPathSurfaceVm(): GoldPathSurfaceVM {
  const fixture = validateP05GoldPathFixture(createP05GoldPathFixture());
  return {
    fixture_id: fixture.id,
    routes: {
      home: "/",
      intake: "/intake/r4-route-registry-session",
      approvals: "/approvals",
      workitem: "/workitems/r4-route-registry-workitem",
      proposal: "/proposals/r4-route-registry-proposal",
      replay: "/agent-runs/r4-route-registry-run/replay",
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
  };
}

function fakeRouteClient(surface: GoldPathSurfaceVM, overrides: RouteClientOverrides = {}) {
  const calls: string[] = [];
  const localeCall = (name: string, options?: { locale?: string }) => {
    calls.push(`${name}:${options?.locale ?? "none"}`);
  };
  const client = {
    pages: {
      async attention(options?: { locale?: string }) {
        localeCall("attention", options);
        if (overrides.attentionError) {
          throw overrides.attentionError;
        }
        return overrides.attention ?? surface.page_vms.attention;
      },
      async approvals(options?: { locale?: string }) {
        localeCall("approvals", options);
        if (overrides.approvalsError) {
          throw overrides.approvalsError;
        }
        return overrides.approvals ?? surface.page_vms.approvals;
      },
      async cost(options?: { locale?: string }) {
        localeCall("cost", options);
        if (overrides.costError) {
          throw overrides.costError;
        }
        return overrides.cost ?? surface.page_vms.cost;
      },
      async goldPath(options?: { locale?: string }) {
        localeCall("goldPath", options);
        return surface;
      },
      async workItem() {
        calls.push("workItem");
        return surface.page_vms.workitem;
      },
      async proposal() {
        calls.push("proposal");
        return surface.page_vms.proposal;
      }
    },
    async replayAgentRun() {
      calls.push("replayAgentRun");
      return surface.page_vms.replay;
    }
  } as unknown as WorkHubApiClient;
  return { client, calls };
}

function fullDocument(caseItem: RouteCase) {
  return `<!doctype html>
<html lang="${caseItem.locale}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(caseItem.label)}</title>
</head>
<body data-r4-web-route-registry-case="${escapeHtml(caseItem.id)}" data-r4-web-route-registry-locale="${caseItem.locale}">
  ${caseItem.html}
  <script>
    (() => {
      const root = document.documentElement;
      document.body.dataset.r4ClientWidth = String(root.clientWidth);
      document.body.dataset.r4ScrollWidth = String(root.scrollWidth);
    })();
  </script>
</body>
</html>`;
}

function contactSheetDocument(cases: Array<{ id: string; label: string; screenshot: string; locale: WorkHubLocale }>) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>R4 Web Route Registry Loader Contact Sheet</title>
  <style>
    body{margin:0;font-family:"Aptos","Segoe UI",sans-serif;color:#172033;background:#eef4fb;padding:20px}
    h1{margin:0 0 14px;font-size:28px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
    figure{margin:0;background:white;border:1px solid #dfe5f1;border-radius:8px;padding:10px;box-shadow:0 18px 50px rgba(37,51,79,.08)}
    figcaption{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:#5e6a86;margin-bottom:8px}
    img{display:block;width:100%;height:auto;border:1px solid #eef2f8;border-radius:6px}
  </style>
</head>
<body>
  <h1>R4 Web Route Registry Loader Contact Sheet</h1>
  <main class="grid">
    ${cases.map((item) => `<figure data-contact-case="${escapeHtml(item.id)}"><figcaption><strong>${escapeHtml(item.label)}</strong><span>${item.locale}</span></figcaption><img src="${escapeHtml(item.screenshot)}" alt="${escapeHtml(item.label)}" /></figure>`).join("")}
  </main>
</body>
</html>`;
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

async function runChromeScreenshot(input: {
  chromePath: string;
  htmlPath: string;
  pngPath: string;
  viewport: Viewport;
}) {
  const userDataDir = path.join(os.tmpdir(), `workhub-r4-web-route-registry-${path.basename(input.pngPath, ".png")}`);
  await rm(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  await mkdir(userDataDir, { recursive: true });
  const chromeHtmlPath = path.basename(input.htmlPath) === "contact-sheet.html"
    ? input.htmlPath
    : path.join(userDataDir, "page.html");
  if (chromeHtmlPath !== input.htmlPath) {
    await copyFile(input.htmlPath, chromeHtmlPath);
  }
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--force-device-scale-factor=1",
    `--user-data-dir=${userDataDir}`,
    `--window-size=${input.viewport.width},${input.viewport.height}`,
    `--screenshot=${input.pngPath}`,
    pathToFileURL(chromeHtmlPath).href
  ];
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let lastSize = -1;
    let stablePolls = 0;
    const screenshotSize = () => {
      try {
        return existsSync(input.pngPath) ? statSync(input.pngPath).size : 0;
      } catch {
        return 0;
      }
    };
    const child = spawn(input.chromePath, args, { stdio: "ignore" });
    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearInterval(poll);
      clearTimeout(timeout);
      if (child.exitCode === null && !child.killed) {
        child.kill("SIGTERM");
      }
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    const poll = setInterval(() => {
      const size = screenshotSize();
      if (size > 0 && size === lastSize) {
        stablePolls += 1;
      } else {
        stablePolls = 0;
      }
      lastSize = size;
      if (stablePolls >= 2) {
        finish();
      }
    }, 100);
    const timeout = setTimeout(() => {
      const size = screenshotSize();
      finish(size > 0 ? undefined : new Error(`Chrome screenshot timed out for ${input.htmlPath}`));
    }, 20_000);
    child.on("error", finish);
    child.on("exit", (code) => {
      if (code === 0 || screenshotSize() > 0) {
        finish();
      } else {
        finish(new Error(`Chrome screenshot failed with exit code ${String(code)} for ${input.htmlPath}`));
      }
    });
  });
  await rm(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

async function runChromeDump(input: {
  chromePath: string;
  htmlPath: string;
  viewport: Viewport;
}) {
  const userDataDir = path.join(os.tmpdir(), `workhub-r4-web-route-registry-dump-${path.basename(input.htmlPath, ".html")}`);
  await rm(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  await mkdir(userDataDir, { recursive: true });
  const chromeHtmlPath = path.basename(input.htmlPath) === "contact-sheet.html"
    ? input.htmlPath
    : path.join(userDataDir, "page.html");
  if (chromeHtmlPath !== input.htmlPath) {
    await copyFile(input.htmlPath, chromeHtmlPath);
  }
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--force-device-scale-factor=1",
    `--user-data-dir=${userDataDir}`,
    `--window-size=${input.viewport.width},${input.viewport.height}`,
    "--dump-dom",
    pathToFileURL(chromeHtmlPath).href
  ];
  const output = await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let settled = false;
    const child = spawn(input.chromePath, args, { stdio: ["ignore", "pipe", "ignore"] });
    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (child.exitCode === null && !child.killed) {
        child.kill("SIGTERM");
      }
      if (error) {
        reject(error);
      } else {
        resolve(Buffer.concat(chunks).toString("utf8"));
      }
    };
    const hasCompleteDom = () => Buffer.concat(chunks).toString("utf8").includes("</html>");
    const timeout = setTimeout(() => {
      finish(hasCompleteDom() ? undefined : new Error(`Chrome DOM dump timed out for ${input.htmlPath}`));
    }, 20_000);
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", finish);
    child.on("exit", (code) => {
      if (code === 0 || hasCompleteDom()) {
        finish();
      } else {
        finish(new Error(`Chrome DOM dump failed with exit code ${String(code)} for ${input.htmlPath}`));
      }
    });
  });
  await rm(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  return output;
}

async function assertPng(pathname: string) {
  const buffer = await readFile(pathname);
  const size = await stat(pathname);
  const signature = buffer.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") {
    throw new Error(`Not a PNG: ${pathname}`);
  }
  if (size.size < 8_000) {
    throw new Error(`Screenshot looks too small: ${pathname}`);
  }
}

function markers(html: string): DomMarkers {
  const statuses = Object.fromEntries(requiredStatuses.map((status) => [
    status,
    countNeedle(html, `data-r4-web-route-status="${status}"`)
  ]));
  const routeKeys = Object.fromEntries(requiredRouteKeys.map((routeKey) => [
    routeKey,
    countNeedle(html, `data-r4-web-route-key="${routeKey}"`) + countNeedle(html, `data-route-key="${routeKey}"`)
  ]));
  const clientWidth = layoutNumber(html, "data-r4-client-width");
  const scrollWidth = layoutNumber(html, "data-r4-scroll-width");
  return {
    statuses,
    routeKeys,
    zhCopy: html.includes("正在加载真实数据") || html.includes("现在没有需要处理的事项"),
    enCopy: html.includes("Loading real data") || html.includes("This page failed to load") || html.includes("You do not have access"),
    pathNavigation: html.includes('href="/approvals"') && html.includes('href="/dashboard/cost"'),
    hashNavigationLeak: html.includes('href="#/'),
    cuuLeak:
      countNeedle(html, "wh-cuu")
      + countNeedle(html, "data-cuu")
      + countNeedle(html, "Cuu ·")
      + countNeedle(html, "Cuu settings")
      + countNeedle(html, "assets/cuu"),
    kanbanLeak: countNeedle(html.toLowerCase(), "kanban"),
    clientWidth,
    scrollWidth,
    horizontalOverflow: clientWidth !== null && scrollWidth !== null ? scrollWidth > clientWidth + 1 : false
  };
}

async function loadedCase(input: {
  id: string;
  label: string;
  locale: WorkHubLocale;
  viewport: Viewport;
  route: string;
  overrides?: RouteClientOverrides;
}) {
  const surface = goldPathSurfaceVm();
  const { client, calls } = fakeRouteClient(surface, input.overrides);
  const match = resolveWebRoute(input.route);
  if (!match) {
    throw new Error(`Route did not resolve: ${input.route}`);
  }
  const result = await loadWebRoute(client, match, input.locale);
  return {
    id: input.id,
    label: input.label,
    locale: input.locale,
    viewport: input.viewport,
    status: result.status,
    route: input.route,
    html: result.html,
    calls
  } satisfies RouteCase;
}

async function main() {
  const chromePath = findChrome();
  if (!chromePath && process.env["WORKHUB_R4_ALLOW_NO_CHROME"] !== "1") {
    throw new Error("Chrome/Chromium is required for R4 Web route registry QA. Set CHROME_PATH or WORKHUB_R4_ALLOW_NO_CHROME=1.");
  }

  const homeMatch = resolveWebRoute("/");
  if (!homeMatch) {
    throw new Error("Home route did not resolve.");
  }
  const loadingHome: RouteCase = {
    id: "loading-home-zh-mobile",
    label: "Loading home zh-CN mobile",
    locale: "zh-CN",
    viewport: { width: 467, height: 900 },
    status: "loading",
    route: "/",
    html: renderWebRouteState(homeMatch, "loading", "zh-CN").html,
    calls: []
  };

  const surface = goldPathSurfaceVm();
  const emptyApprovals: ApprovalCenterVM = {
    ...surface.page_vms.approvals,
    items: [],
    requests: [],
    counts: { pending: 0, all: 0 }
  };

  const cases: RouteCase[] = [
    loadingHome,
    await loadedCase({
      id: "ready-home-zh-desktop",
      label: "Ready home zh-CN desktop",
      locale: "zh-CN",
      viewport: { width: 1365, height: 1200 },
      route: "/"
    }),
    await loadedCase({
      id: "ready-approvals-en-mobile",
      label: "Ready approvals en-US mobile",
      locale: "en-US",
      viewport: { width: 467, height: 1600 },
      route: "/approvals"
    }),
    await loadedCase({
      id: "ready-cost-zh-desktop",
      label: "Ready cost zh-CN desktop",
      locale: "zh-CN",
      viewport: { width: 1365, height: 1200 },
      route: "/dashboard/cost"
    }),
    await loadedCase({
      id: "empty-approvals-zh-mobile",
      label: "Empty approvals zh-CN mobile",
      locale: "zh-CN",
      viewport: { width: 467, height: 900 },
      route: "/approvals",
      overrides: { approvals: emptyApprovals }
    }),
    await loadedCase({
      id: "error-home-en-mobile",
      label: "Error home en-US mobile",
      locale: "en-US",
      viewport: { width: 467, height: 900 },
      route: "/",
      overrides: { attentionError: new Error("route registry probe failure") }
    }),
    await loadedCase({
      id: "forbidden-cost-en-desktop",
      label: "Forbidden cost en-US desktop",
      locale: "en-US",
      viewport: { width: 1365, height: 900 },
      route: "/dashboard/cost",
      overrides: { costError: new WorkHubApiError(403, "forbidden", "Needs admin approval") }
    })
  ];

  await mkdir(auditDir, { recursive: true });
  const reportCases = [];
  const contactCases = [];

  for (const caseItem of cases) {
    const htmlPath = path.join(auditDir, `${caseItem.id}.html`);
    const pngPath = path.join(auditDir, `${caseItem.id}.png`);
    await writeFile(htmlPath, stripTrailingWhitespace(fullDocument(caseItem)), "utf8");
    let markerHtml = await readFile(htmlPath, "utf8");
    if (chromePath) {
      await runChromeScreenshot({ chromePath, htmlPath, pngPath, viewport: caseItem.viewport });
      await assertPng(pngPath);
      markerHtml = await runChromeDump({ chromePath, htmlPath, viewport: caseItem.viewport })
        .catch(() => markerHtml);
      contactCases.push({
        id: caseItem.id,
        label: caseItem.label,
        locale: caseItem.locale,
        screenshot: path.basename(pngPath)
      });
    }
    const caseMarkers = markers(markerHtml);
    if (caseMarkers.cuuLeak > 0) {
      throw new Error(`${caseItem.id} leaked Cuu main-window markers`);
    }
    if (caseMarkers.kanbanLeak > 0) {
      throw new Error(`${caseItem.id} leaked default Kanban wording`);
    }
    if (caseMarkers.hashNavigationLeak) {
      throw new Error(`${caseItem.id} still uses hash navigation`);
    }
    if (caseMarkers.horizontalOverflow) {
      throw new Error(`${caseItem.id} has horizontal overflow: ${String(caseMarkers.scrollWidth)} > ${String(caseMarkers.clientWidth)}`);
    }
    reportCases.push({
      id: caseItem.id,
      label: caseItem.label,
      locale: caseItem.locale,
      route: caseItem.route,
      status: caseItem.status,
      viewport: caseItem.viewport,
      endpoint_calls: caseItem.calls,
      html: path.basename(htmlPath),
      screenshot: chromePath ? path.basename(pngPath) : null,
      markers: caseMarkers
    });
  }

  if (chromePath) {
    const contactHtmlPath = path.join(auditDir, "contact-sheet.html");
    const contactPngPath = path.join(auditDir, "contact-sheet.png");
    await writeFile(contactHtmlPath, stripTrailingWhitespace(contactSheetDocument(contactCases)), "utf8");
    await runChromeScreenshot({
      chromePath,
      htmlPath: contactHtmlPath,
      pngPath: contactPngPath,
      viewport: { width: 1365, height: 5200 }
    });
    await assertPng(contactPngPath);
  }

  const statusesPresent = requiredStatuses.every((status) => reportCases.some((caseItem) => caseItem.status === status));
  const readyEndpointProof = [
    ["ready-home-zh-desktop", "attention:zh-CN"],
    ["ready-approvals-en-mobile", "approvals:en-US"],
    ["ready-cost-zh-desktop", "cost:zh-CN"]
  ].every(([id, call]) => reportCases.some((caseItem) => caseItem.id === id && caseItem.endpoint_calls.some((item) => item === call)));
  const report = {
    generated_at: new Date().toISOString(),
    module: "R4.2 Web route registry loader",
    chrome_path: chromePath ?? null,
    output_dir: path.relative(repoRoot, auditDir).replace(/\\/gu, "/"),
    registry: webRouteRegistry,
    gates: {
      screenshots_captured: Boolean(chromePath),
      registry_has_expected_routes: webRouteRegistry.length >= 8,
      ready_routes_use_page_vm_endpoints: readyEndpointProof,
      route_status_coverage: statusesPresent,
      bilingual_state_copy:
        reportCases.some((caseItem) => caseItem.markers.zhCopy)
        && reportCases.some((caseItem) => caseItem.markers.enCopy),
      path_navigation_without_hash: reportCases.filter((caseItem) => caseItem.status === "ready").every((caseItem) => caseItem.markers.pathNavigation && !caseItem.markers.hashNavigationLeak),
      no_main_window_cuu: reportCases.every((caseItem) => caseItem.markers.cuuLeak === 0),
      no_default_kanban: reportCases.every((caseItem) => caseItem.markers.kanbanLeak === 0),
      no_horizontal_overflow: reportCases.every((caseItem) => !caseItem.markers.horizontalOverflow)
    },
    cases: reportCases
  };

  if (!Object.values(report.gates).every(Boolean)) {
    throw new Error(`R4 Web route registry loader gates failed: ${JSON.stringify(report.gates)}`);
  }

  await writeFile(path.join(auditDir, "route-registry-loader-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(auditDir, "smoke-summary.md"), [
    "# R4 Web Route Registry Loader",
    "",
    `- Generated: ${report.generated_at}`,
    `- Chrome: ${chromePath ?? "not captured"}`,
    "- Scope: URL route registry plus loader boundary for `/`, `/approvals`, and `/dashboard/cost`, with state cards for loading, empty, error, and forbidden.",
    "- Gates: ready routes call typed Page VM endpoints, navigation uses real paths instead of hash links, bilingual state copy is present, no Cuu main-window markers, no default Kanban wording, and no horizontal overflow.",
    "- Boundary: detail-route loaders are registered and wired, but the next slice must add live browser interaction QA against a running daemon for workitem/proposal/replay records.",
    ""
  ].join("\n"), "utf8");

  console.log(JSON.stringify({ ok: true, output_dir: report.output_dir, screenshots: Boolean(chromePath) }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
