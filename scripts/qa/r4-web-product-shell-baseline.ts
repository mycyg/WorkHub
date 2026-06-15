import { existsSync, statSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { WorkHubApiClient } from "@workhub/api-client";
import type {
  ApprovalCenterVM,
  AttentionHomeVM,
  CostDashboardVM,
  GoldPathSurfaceVM,
  ProposalDetailVM,
  ReplayTraceVM,
  WorkHubLocale,
  WorkItemDetailVM
} from "@workhub/contracts";

import { loadWebRoute, resolveWebRoute } from "../../apps/web/src/routes.js";
import { createP05GoldPathFixture, validateP05GoldPathFixture } from "../../packages/agent/src/fixtures/index.js";

type Viewport = {
  width: number;
  height: number;
};

type ProductShellCase = {
  id: string;
  route: string;
  locale: WorkHubLocale;
  viewport: Viewport;
};

type DomMarkers = {
  productShell: boolean;
  masthead: boolean;
  routeKey: string;
  statusReady: number;
  pathNavigation: boolean;
  hashNavigationLeak: boolean;
  oldShellLeak: boolean;
  cuuLeak: boolean;
  kanbanLeak: boolean;
  weeklyFixtureLeak: boolean;
  zhChrome: boolean;
  enChrome: boolean;
  clientWidth: number;
  scrollWidth: number;
  navClientWidth: number;
  navScrollWidth: number;
  navHorizontalOverflow: boolean;
  horizontalOverflow: boolean;
  textBoxOverflow: boolean;
  textOverflowCount: number;
  textOverflowSamples: string[];
};

type ProductShellReportCase = ProductShellCase & {
  endpoint_calls: string[];
  html: string;
  screenshot: string;
  markers: DomMarkers;
};

type ProductShellReport = {
  generated_at: string;
  module: string;
  chrome_path: string;
  output_dir: string;
  contact_sheet: string;
  gates: Record<string, boolean>;
  cases: ProductShellReportCase[];
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputDir = path.join(
  repoRoot,
  "docs",
  "workhub",
  "05-clients",
  "assets",
  "audit",
  "2026-06-11-r4-web-product-shell-baseline"
);

const cases: ProductShellCase[] = [
  {
    id: "product-home-zh-desktop",
    route: "/",
    locale: "zh-CN",
    viewport: { width: 1365, height: 1180 }
  },
  {
    id: "product-approvals-en-mobile",
    route: "/approvals",
    locale: "en-US",
    viewport: { width: 467, height: 1600 }
  },
  {
    id: "product-workitem-zh-desktop",
    route: "/workitems/r4-product-workitem",
    locale: "zh-CN",
    viewport: { width: 1365, height: 1220 }
  },
  {
    id: "product-proposal-en-mobile",
    route: "/proposals/r4-product-proposal",
    locale: "en-US",
    viewport: { width: 467, height: 1700 }
  }
];

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
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, deepReplace(item)])
    ) as T;
  }
  return value;
}

function productSurface(): GoldPathSurfaceVM {
  const fixture = validateP05GoldPathFixture(createP05GoldPathFixture());
  return deepReplace({
    fixture_id: fixture.id,
    routes: {
      home: "/",
      intake: "/intake/r4-product-session",
      approvals: "/approvals",
      workitem: "/workitems/r4-product-workitem",
      proposal: "/proposals/r4-product-proposal",
      replay: "/agent-runs/r4-product-run/replay",
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

function fakeRouteClient(surface: GoldPathSurfaceVM) {
  const calls: string[] = [];
  const localeCall = (name: string, options?: { locale?: string }) => {
    calls.push(`${name}:${options?.locale ?? "none"}`);
  };
  const client = {
    pages: {
      async attention(options?: { locale?: string }): Promise<AttentionHomeVM> {
        localeCall("attention", options);
        return surface.page_vms.attention;
      },
      async approvals(options?: { locale?: string }): Promise<ApprovalCenterVM> {
        localeCall("approvals", options);
        return surface.page_vms.approvals;
      },
      async cost(options?: { locale?: string }): Promise<CostDashboardVM> {
        localeCall("cost", options);
        return surface.page_vms.cost;
      },
      async goldPath(options?: { locale?: string }): Promise<GoldPathSurfaceVM> {
        localeCall("goldPath", options);
        return surface;
      },
      async workItem(id: string, options?: { locale?: string }): Promise<WorkItemDetailVM> {
        localeCall(`workItem:${id}`, options);
        return surface.page_vms.workitem;
      },
      async proposal(id: string, options?: { locale?: string }): Promise<ProposalDetailVM> {
        localeCall(`proposal:${id}`, options);
        return surface.page_vms.proposal;
      }
    },
    async listWorkItemConflicts(workItemId: string) {
      localeCall(`conflicts:${workItemId}`);
      return { conflicts: [], empty_state: "no_conflicts" as const };
    },
    async replayAgentRun(id: string): Promise<ReplayTraceVM> {
      calls.push(`replayAgentRun:${id}`);
      return surface.page_vms.replay;
    }
  } as unknown as WorkHubApiClient;
  return { client, calls };
}

function instrumentedDocument(input: { title: string; html: string }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(input.title)}</title>
</head>
<body>
${input.html}
<script>
(() => {
  const clone = document.body.cloneNode(true);
  clone.querySelectorAll("script,style").forEach((node) => node.remove());
  const text = clone.textContent || "";
  const nav = document.querySelector(".wh-product-nav");
  const navClientWidth = nav ? Math.round(nav.clientWidth) : 0;
  const navScrollWidth = nav ? Math.round(nav.scrollWidth) : 0;
  const root = document.querySelector("[data-r4-product-shell]");
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
  const report = {
    productShell: Boolean(root),
    masthead: Boolean(document.querySelector("[data-r4-product-masthead]")),
    routeKey: root ? root.getAttribute("data-r4-product-route-key") || "" : "",
    statusReady: document.querySelectorAll('[data-r4-web-route-status="ready"]').length,
    pathNavigation: Array.from(document.querySelectorAll("a[href]")).some((anchor) => (anchor.getAttribute("href") || "").startsWith("/")),
    hashNavigationLeak: Array.from(document.querySelectorAll("a[href]")).some((anchor) => (anchor.getAttribute("href") || "").startsWith("#/")),
    oldShellLeak: Boolean(document.querySelector(".wh-app-root")),
    cuuLeak: /\\bCuu\\b/i.test(text) || Boolean(document.querySelector("[data-cuu]")),
    kanbanLeak: /\\bkanban\\b/i.test(text),
    weeklyFixtureLeak: /客户周报|weekly report/i.test(text),
    zhChrome: text.includes("工作入口") && text.includes("当前焦点"),
    enChrome: text.includes("Work entry") && text.includes("Focus"),
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    navClientWidth,
    navScrollWidth,
    navHorizontalOverflow: nav ? navScrollWidth > navClientWidth + 2 : true,
    horizontalOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > document.documentElement.clientWidth + 2,
    textBoxOverflow: textOverflowSamples.length > 0,
    textOverflowCount: textOverflowSamples.length,
    textOverflowSamples: textOverflowSamples.slice(0, 8)
  };
  document.body.setAttribute("data-r4-product-shell-report", JSON.stringify(report));
})();
</script>
</body>
</html>`;
}

async function runChrome(input: {
  chromePath: string;
  htmlPath: string;
  pngPath: string;
  viewport: Viewport;
  mode: "dump" | "screenshot";
}) {
  const userDataDir = path.join(os.tmpdir(), `workhub-r4-product-shell-${input.mode}-${Date.now()}`);
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
    input.mode === "dump" ? "--dump-dom" : `--screenshot=${input.pngPath}`,
    pathToFileURL(chromeHtmlPath).href
  ];
  const output = await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
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
    const child = spawn(input.chromePath, args, { stdio: ["ignore", "pipe", "ignore"] });
    const hasCompleteDom = () => Buffer.concat(chunks).toString("utf8").includes("</html>");
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
        resolve(Buffer.concat(chunks).toString("utf8"));
      }
    };
    const poll = setInterval(() => {
      if (input.mode !== "screenshot") {
        return;
      }
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
      finish(
        (input.mode === "screenshot" && size > 0) || (input.mode === "dump" && hasCompleteDom())
          ? undefined
          : new Error(`Chrome ${input.mode} timed out for ${input.htmlPath}`)
      );
    }, 20_000);
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", finish);
    child.on("exit", (code) => {
      if (code === 0 || (input.mode === "screenshot" && screenshotSize() > 0) || (input.mode === "dump" && hasCompleteDom())) {
        finish();
      } else {
        finish(new Error(`Chrome ${input.mode} failed with exit code ${String(code)}`));
      }
    });
  });
  await rm(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  return output;
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

function extractMarkers(dump: string): DomMarkers {
  const match = /data-r4-product-shell-report="([^"]+)"/u.exec(dump);
  if (!match?.[1]) {
    throw new Error("Chrome DOM dump did not include data-r4-product-shell-report.");
  }
  return JSON.parse(match[1].replace(/&quot;/gu, "\"").replace(/&amp;/gu, "&")) as DomMarkers;
}

async function renderCase(chromePath: string, input: ProductShellCase): Promise<ProductShellReportCase> {
  const surface = productSurface();
  const { client, calls } = fakeRouteClient(surface);
  const match = resolveWebRoute(input.route);
  if (!match) {
    throw new Error(`Route did not resolve: ${input.route}`);
  }
  const result = await loadWebRoute(client, match, input.locale);
  if (result.status !== "ready") {
    throw new Error(`Expected ready route for ${input.route}, got ${result.status}`);
  }
  const htmlPath = path.join(outputDir, `${input.id}.html`);
  const pngPath = path.join(outputDir, `${input.id}.png`);
  await writeFile(htmlPath, stripTrailingWhitespace(instrumentedDocument({ title: input.id, html: result.html })), "utf8");
  await runChrome({ chromePath, htmlPath, pngPath, viewport: input.viewport, mode: "screenshot" });
  await assertPng(pngPath);
  const dump = await runChrome({ chromePath, htmlPath, pngPath, viewport: input.viewport, mode: "dump" });
  return {
    ...input,
    endpoint_calls: calls,
    html: path.basename(htmlPath),
    screenshot: path.basename(pngPath),
    markers: extractMarkers(dump)
  };
}

async function writeContactSheet(chromePath: string, reportCases: ProductShellReportCase[]) {
  const htmlPath = path.join(outputDir, "contact-sheet.html");
  const pngPath = path.join(outputDir, "contact-sheet.png");
  const items = reportCases.map((item) => `<figure>
    <figcaption>${escapeHtml(item.id)} · ${escapeHtml(item.route)} · ${escapeHtml(item.locale)}</figcaption>
    <img src="${escapeHtml(item.screenshot)}" alt="${escapeHtml(item.id)}" />
  </figure>`).join("");
  await writeFile(
    htmlPath,
    stripTrailingWhitespace(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>R4.4 Web Product Shell Contact Sheet</title>
  <style>
    body{margin:0;background:#eef4fb;color:#172033;font-family:Aptos,Segoe UI,sans-serif}
    main{padding:18px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
    figure{margin:0;border:1px solid #dce4f1;border-radius:8px;background:#fff;padding:10px;box-shadow:0 14px 36px rgba(37,51,79,.08);min-width:0}
    figcaption{font-size:12px;font-weight:850;color:#66728c;margin:0 0 8px;overflow-wrap:anywhere}
    img{display:block;width:100%;height:auto;border-radius:6px;border:1px solid #e5ecf5}
  </style>
</head>
<body><main>${items}</main></body>
</html>`),
    "utf8"
  );
  await runChrome({
    chromePath,
    htmlPath,
    pngPath,
    viewport: { width: 1280, height: 1600 },
    mode: "screenshot"
  });
  await assertPng(pngPath);
  return path.basename(pngPath);
}

async function main() {
  const chromePath = findChrome();
  if (!chromePath) {
    throw new Error("Chrome/Chromium is required. Set CHROME_PATH to run R4 web product shell QA.");
  }
  await mkdir(outputDir, { recursive: true });
  const reportCases: ProductShellReportCase[] = [];
  for (const item of cases) {
    reportCases.push(await renderCase(chromePath, item));
  }
  const contactSheet = await writeContactSheet(chromePath, reportCases);
  const coveredRoutes = new Set(reportCases.map((item) => item.markers.routeKey));
  const expectedEndpointPrefixes = {
    home: ["attention:"],
    approvals: ["approvals:"],
    workitem: ["workItem:"],
    proposal: ["proposal:", "conflicts:"]
  } as const;
  const gates = {
    screenshots_captured: reportCases.every((item) => existsSync(path.join(outputDir, item.screenshot))) && existsSync(path.join(outputDir, contactSheet)),
    product_shell_present: reportCases.every((item) => item.markers.productShell && (item.markers.routeKey === "home" || item.markers.masthead)),
    four_product_screens_covered: ["home", "approvals", "workitem", "proposal"].every((route) => coveredRoutes.has(route)),
    ready_routes_use_page_vm_endpoints: reportCases.every((item) =>
      expectedEndpointPrefixes[item.markers.routeKey as keyof typeof expectedEndpointPrefixes]
        .every((prefix) => item.endpoint_calls.some((call) => call.startsWith(prefix)))
    ),
    fixed_chrome_bilingual: reportCases.some((item) => item.markers.zhChrome) && reportCases.some((item) => item.markers.enChrome),
    path_navigation_without_hash: reportCases.every((item) => item.markers.pathNavigation && !item.markers.hashNavigationLeak),
    no_old_preview_shell: reportCases.every((item) => !item.markers.oldShellLeak),
    no_weekly_fixture_copy_in_ready: reportCases.every((item) => !item.markers.weeklyFixtureLeak),
    no_main_window_cuu: reportCases.every((item) => !item.markers.cuuLeak),
    no_default_kanban: reportCases.every((item) => !item.markers.kanbanLeak),
    no_horizontal_overflow: reportCases.every((item) => !item.markers.horizontalOverflow && !item.markers.navHorizontalOverflow),
    no_text_box_overflow: reportCases.every((item) => !item.markers.textBoxOverflow)
  };
  const report: ProductShellReport = {
    generated_at: new Date().toISOString(),
    module: "R4.4 Web product shell baseline",
    chrome_path: chromePath,
    output_dir: path.relative(repoRoot, outputDir).replace(/\\/gu, "/"),
    contact_sheet: contactSheet,
    gates,
    cases: reportCases
  };
  await writeFile(path.join(outputDir, "product-shell-baseline-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(
    path.join(outputDir, "smoke-summary.md"),
    [
      "# R4.4 Web Product Shell Baseline",
      "",
      `- ok: ${String(Object.values(gates).every(Boolean))}`,
      `- cases: ${String(reportCases.length)}`,
      `- product shell: ${String(gates.product_shell_present)}`,
      `- fixed bilingual chrome: ${String(gates.fixed_chrome_bilingual)}`,
      `- no horizontal overflow: ${String(gates.no_horizontal_overflow)}`,
      `- no text box overflow: ${String(gates.no_text_box_overflow)}`,
      ""
    ].join("\n"),
    "utf8"
  );
  if (!Object.values(gates).every(Boolean)) {
    throw new Error(`R4 web product shell baseline failed: ${JSON.stringify(gates)}`);
  }
  console.log(JSON.stringify({ ok: true, output_dir: report.output_dir, screenshots: gates.screenshots_captured }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
