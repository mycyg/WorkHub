import { existsSync, statSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { GoldPathSurfaceVM } from "@workhub/contracts";
import { createP05GoldPathFixture, validateP05GoldPathFixture } from "../../packages/agent/src/fixtures/index.js";
import { toCuuState } from "../../packages/events/src/index.js";
import { renderGoldPathAppShell, renderGoldPathSurface, type WorkHubLocale } from "../../packages/ui/src/gold-path/index.js";
import {
  r4RouteStateKinds,
  r4WebRouteKeys,
  renderRouteStateMatrix,
  routeStateCss
} from "../../packages/ui/src/route-state.js";

type Viewport = {
  width: number;
  height: number;
};

type MatrixCase = {
  id: string;
  label: string;
  locale: WorkHubLocale;
  viewport: Viewport;
  html: string;
};

type DomMarkers = {
  routeStateCards: number;
  routeStates: Record<string, number>;
  routeKeys: Record<string, number>;
  readyPanels: number;
  zhCopy: boolean;
  enCopy: boolean;
  cuuLeak: number;
  kanbanLeak: number;
  clientWidth: number | null;
  scrollWidth: number | null;
  horizontalOverflow: boolean;
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const auditDir = path.join(repoRoot, "docs", "workhub", "05-clients", "assets", "audit", "2026-06-11-r4-web-route-state-matrix");

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
      intake: "/intake/r4-route-state-session",
      approvals: "/approvals",
      workitem: "/workitems/r4-route-state-workitem",
      proposal: "/proposals/r4-route-state-proposal",
      replay: "/agent-runs/r4-route-state-run/replay",
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
    cuu_states: fixture.events.map((event) => toCuuState(event))
  };
}

function routeStateDocument(locale: WorkHubLocale) {
  const title = locale === "zh-CN" ? "R4 Web 路由四态矩阵" : "R4 Web Route State Matrix";
  const subtitle = locale === "zh-CN"
    ? "覆盖总览、快捷入口、审批、工作项、变更申请、回放、成本和设置的 loading / empty / error / forbidden。"
    : "Covers loading, empty, error, and forbidden states for overview, intake, approvals, work items, proposals, replay, cost, and settings.";
  return `<!doctype html>
<html lang="${locale}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root{color-scheme:light;--ink:#172033;--muted:#66728c;--line:#dfe5f1;--paper:#fff;--soft:#f5f8fc;--blue:#355cff}
    body{margin:0;font-family:"Aptos","Segoe UI",sans-serif;color:var(--ink);background:linear-gradient(180deg,#fbfdff 0%,#edf4fb 100%);padding:24px;overflow-x:hidden}
    main{max-width:1280px;margin:0 auto;display:grid;gap:18px;min-width:0}
    header{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;min-width:0}
    h1{font-size:30px;line-height:1.15;margin:0;overflow-wrap:anywhere}
    p{margin:6px 0 0;color:var(--muted);line-height:1.5;overflow-wrap:anywhere}
    .r4qa-badge{border:1px solid var(--line);border-radius:999px;background:#fff;padding:7px 10px;color:var(--muted);font-size:12px;font-weight:800;max-width:100%;overflow-wrap:anywhere}
    ${routeStateCss}
  </style>
</head>
<body data-r4-web-route-state-case="matrix-${locale}" data-r4-locale="${locale}">
  <main>
    <header>
      <div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div>
      <span class="r4qa-badge">R4.1 route-state foundation</span>
    </header>
    ${renderRouteStateMatrix({ locale })}
  </main>
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

function readyDocument(locale: WorkHubLocale, currentRoute: string) {
  const rendered = renderGoldPathSurface(goldPathSurfaceVm(), "web", { locale });
  const shell = renderGoldPathAppShell(rendered, {
    appName: "WorkHub",
    surfaceLabel: "R4 Web",
    apiBaseLabel: "typed Page VM",
    currentRoute,
    locale
  });
  const label = locale === "zh-CN" ? "R4 Web 可用页面壳" : "R4 Web Ready Shell";
  return `<!doctype html>
<html lang="${locale}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(label)}</title>
  <style>
    ${shell.css}
    body{margin:0;background:#f6f9fd;overflow-x:hidden}
    .r4qa-ready-banner{font-family:"Aptos","Segoe UI",sans-serif;background:#172033;color:#fff;padding:10px 16px;display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}
    .r4qa-ready-banner strong{font-size:13px}.r4qa-ready-banner span{font-size:12px;color:#dbe5ff;overflow-wrap:anywhere;min-width:0;flex:1 1 160px;text-align:right}
    @media (max-width:520px){.r4qa-ready-banner{justify-content:flex-start}.r4qa-ready-banner span{display:none}}
  </style>
</head>
<body data-r4-web-route-state-case="ready-${locale}" data-r4-locale="${locale}">
  <div class="r4qa-ready-banner"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(currentRoute)} · ${locale}</span></div>
  ${shell.html}
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
  <title>R4 Web Route State Matrix Contact Sheet</title>
  <style>
    body{margin:0;font-family:"Aptos","Segoe UI",sans-serif;color:#172033;background:#eef4fb;padding:20px}
    h1{margin:0 0 14px;font-size:28px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
    figure{margin:0;background:white;border:1px solid #dfe5f1;border-radius:8px;padding:10px;box-shadow:0 18px 50px rgba(37,51,79,.08)}
    figcaption{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:#5e6a86;margin-bottom:8px}
    img{display:block;width:100%;height:auto;border:1px solid #eef2f8;border-radius:6px}
  </style>
</head>
<body>
  <h1>R4 Web Route State Matrix Contact Sheet</h1>
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
  const userDataDir = path.join(os.tmpdir(), `workhub-r4-web-route-state-${path.basename(input.pngPath, ".png")}`);
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
  const userDataDir = path.join(os.tmpdir(), `workhub-r4-web-route-state-dump-${path.basename(input.htmlPath, ".html")}`);
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
  const routeStates = Object.fromEntries(r4RouteStateKinds.map((state) => [
    state,
    countNeedle(html, `data-route-state="${state}"`)
  ]));
  const routeKeys = Object.fromEntries(r4WebRouteKeys.map((routeKey) => [
    routeKey,
    countNeedle(html, `data-route-key="${routeKey}"`)
  ]));
  const clientWidth = layoutNumber(html, "data-r4-client-width");
  const scrollWidth = layoutNumber(html, "data-r4-scroll-width");
  return {
    routeStateCards: countNeedle(html, "data-route-state=\""),
    routeStates,
    routeKeys,
    readyPanels: countNeedle(html, "data-wh-panel="),
    zhCopy: html.includes("正在加载真实数据") && html.includes("你没有权限查看"),
    enCopy: html.includes("Loading real data") && html.includes("You do not have access"),
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

async function main() {
  const chromePath = findChrome();
  if (!chromePath && process.env["WORKHUB_R4_ALLOW_NO_CHROME"] !== "1") {
    throw new Error("Chrome/Chromium is required for R4 Web visual route-state QA. Set CHROME_PATH or WORKHUB_R4_ALLOW_NO_CHROME=1.");
  }

  const cases: MatrixCase[] = [
    {
      id: "ready-zh-desktop",
      label: "Ready shell zh-CN desktop",
      locale: "zh-CN",
      viewport: { width: 1365, height: 1600 },
      html: readyDocument("zh-CN", "/")
    },
    {
      id: "ready-en-mobile",
      label: "Ready shell en-US mobile",
      locale: "en-US",
      viewport: { width: 467, height: 1900 },
      html: readyDocument("en-US", "/proposals/r4-route-state-proposal")
    },
    {
      id: "states-zh-desktop",
      label: "Route states zh-CN desktop",
      locale: "zh-CN",
      viewport: { width: 1365, height: 1800 },
      html: routeStateDocument("zh-CN")
    },
    {
      id: "states-en-mobile",
      label: "Route states en-US mobile",
      locale: "en-US",
      viewport: { width: 467, height: 6400 },
      html: routeStateDocument("en-US")
    }
  ];

  await mkdir(auditDir, { recursive: true });
  const reportCases = [];
  const contactCases = [];

  for (const caseItem of cases) {
    const htmlPath = path.join(auditDir, `${caseItem.id}.html`);
    const pngPath = path.join(auditDir, `${caseItem.id}.png`);
    await writeFile(htmlPath, stripTrailingWhitespace(caseItem.html), "utf8");
    let markerHtml = caseItem.html;
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
    if (caseMarkers.horizontalOverflow) {
      throw new Error(`${caseItem.id} has horizontal overflow: ${String(caseMarkers.scrollWidth)} > ${String(caseMarkers.clientWidth)}`);
    }
    reportCases.push({
      id: caseItem.id,
      label: caseItem.label,
      locale: caseItem.locale,
      viewport: caseItem.viewport,
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
      viewport: { width: 1365, height: 7200 }
    });
    await assertPng(contactPngPath);
  }

  const stateCases = reportCases.filter((caseItem) => caseItem.id.startsWith("states-"));
  const readyCases = reportCases.filter((caseItem) => caseItem.id.startsWith("ready-"));
  const expectedCards = r4WebRouteKeys.length * r4RouteStateKinds.length;
  const stateCoverage = stateCases.every((caseItem) =>
    caseItem.markers.routeStateCards >= expectedCards
    && r4WebRouteKeys.every((routeKey) => caseItem.markers.routeKeys[routeKey] > 0)
    && r4RouteStateKinds.every((state) => caseItem.markers.routeStates[state] >= r4WebRouteKeys.length)
  );
  const report = {
    generated_at: new Date().toISOString(),
    module: "R4.1 Web route-state matrix",
    chrome_path: chromePath ?? null,
    output_dir: path.relative(repoRoot, auditDir).replace(/\\/gu, "/"),
    gates: {
      screenshots_captured: Boolean(chromePath),
      ready_shell_pages: readyCases.every((caseItem) => caseItem.markers.readyPanels >= 8),
      route_state_coverage: stateCoverage,
      bilingual_state_copy:
        stateCases.some((caseItem) => caseItem.markers.zhCopy)
        && stateCases.some((caseItem) => caseItem.markers.enCopy),
      no_main_window_cuu: reportCases.every((caseItem) => caseItem.markers.cuuLeak === 0),
      no_default_kanban: reportCases.every((caseItem) => caseItem.markers.kanbanLeak === 0),
      no_horizontal_overflow: reportCases.every((caseItem) => !caseItem.markers.horizontalOverflow)
    },
    required_routes: r4WebRouteKeys,
    required_states: r4RouteStateKinds,
    cases: reportCases
  };

  if (!Object.values(report.gates).every(Boolean)) {
    throw new Error(`R4 Web route-state matrix gates failed: ${JSON.stringify(report.gates)}`);
  }

  await writeFile(path.join(auditDir, "route-state-matrix-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(auditDir, "smoke-summary.md"), [
    "# R4 Web Route State Matrix",
    "",
    `- Generated: ${report.generated_at}`,
    `- Chrome: ${chromePath ?? "not captured"}`,
    "- Scope: ready Web shell plus loading/empty/error/forbidden state matrix for home, intake, approvals, workitem, proposal, replay, cost, and settings.",
    "- Gates: screenshots captured, all route states present in zh-CN/en-US, no Cuu main-window markers, no default Kanban wording, no horizontal overflow.",
    "- Boundary: this is an R4 QA foundation. It does not yet prove the full React SPA migration or real multi-record backend data on every route.",
    ""
  ].join("\n"), "utf8");

  console.log(JSON.stringify({ ok: true, output_dir: report.output_dir, screenshots: Boolean(chromePath) }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
