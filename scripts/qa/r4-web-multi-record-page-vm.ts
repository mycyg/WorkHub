import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { WorkHubApiError, type WorkHubApiClient } from "@workhub/api-client";
import type { GoldPathSurfaceVM } from "@workhub/contracts";
import type { WorkHubLocale } from "@workhub/ui/gold-path";
import { createP05GoldPathFixture, validateP05GoldPathFixture } from "../../packages/agent/src/fixtures/index.js";

import {
  loadWebRoute,
  resolveWebRoute,
  type WebRouteLoadStatus
} from "../../apps/web/src/routes.js";

type Viewport = {
  width: number;
  height: number;
};

type RouteClientOverrides = {
  workItemError?: Error;
  proposalError?: Error;
  approvalsEmpty?: boolean;
};

type RouteCase = {
  id: string;
  label: string;
  route: string;
  locale: WorkHubLocale;
  viewport: Viewport;
  status: WebRouteLoadStatus;
  html: string;
  calls: string[];
};

type DomMarkers = {
  statusReady: number;
  statusEmpty: number;
  statusForbidden: number;
  pathNavigation: boolean;
  hashNavigationLeak: boolean;
  weeklyFixtureLeak: number;
  multiRecordCopy: Record<string, boolean>;
  cuuLeak: number;
  kanbanLeak: number;
  clientWidth: number | null;
  scrollWidth: number | null;
  horizontalOverflow: boolean;
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const auditDir = path.join(repoRoot, "docs", "workhub", "05-clients", "assets", "audit", "2026-06-11-r4-web-multi-record-page-vm");
const multiRecordNeedles = {
  regionalLaunch: "区域发布复盘包",
  legalReview: "法务条款复核",
  budgetReview: "预算复核包",
  workitemDetail: "跨区发布资料包",
  proposalDetail: "发布复盘资料包变更申请",
  replayDetail: "跨区发布资料包已完成"
} as const;

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

function baseSurfaceVm(): GoldPathSurfaceVM {
  const fixture = validateP05GoldPathFixture(createP05GoldPathFixture());
  const surface: GoldPathSurfaceVM = {
    fixture_id: fixture.id,
    routes: {
      home: "/",
      intake: "/intake/r4-multi-session",
      approvals: "/approvals",
      workitem: "/workitems/r4-multi-workitem",
      proposal: "/proposals/r4-multi-proposal",
      replay: "/agent-runs/r4-multi-run/replay",
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
  const sanitized = JSON.parse(
    JSON.stringify(surface)
      .replace(/客户周报/gu, "区域发布复盘")
      .replace(/周报/gu, "复盘")
      .replace(/weekly-report/giu, "regional-launch")
      .replace(/weekly_report/giu, "regional_launch")
      .replace(/weekly report/giu, "regional launch")
      .replace(/Cuu/gu, "AI")
  ) as GoldPathSurfaceVM;
  sanitized.fixture_id = surface.fixture_id;
  return sanitized;
}

function multiRecordSurfaceVm() {
  const surface = baseSurfaceVm();
  const firstApproval = {
    ...surface.page_vms.approvals.items[0],
    id: "r4-multi-approval-legal",
    source_ref: { entity_type: "approval_request" as const, entity_id: "r4-multi-approval-legal" },
    title: "法务条款复核需要你确认",
    summary_text: "AI 已把跨区发布资料中的法务条款和免责说明整理成变更申请。",
    reason_text: "这条审批会阻塞正式交付，打回理由会回灌给 AI 继续改。",
    actions: [
      { id: "approve", label: "同意", style: "primary", method: "POST", href: "/api/approvals/r4-multi-approval-legal/respond" },
      {
        id: "deny",
        label: "打回",
        style: "danger",
        method: "POST",
        href: "/api/approvals/r4-multi-approval-legal/respond",
        requires_reason: true
      }
    ]
  };
  const secondApproval = {
    ...firstApproval,
    id: "r4-multi-approval-budget",
    priority: "normal" as const,
    source_ref: { entity_type: "approval_request" as const, entity_id: "r4-multi-approval-budget" },
    title: "预算复核包等待审批",
    summary_text: "AI 已把三条区域预算差异归入资料包，需要负责人确认再进入正式版。",
    reason_text: "预算变更会影响成本仪表盘与后续 run 的模型路由。"
  };
  const firstRequest = {
    ...surface.page_vms.approvals.requests[0],
    id: "r4-multi-approval-legal",
    action_pattern: "proposal.review.legal_launch_pack",
    status: "pending" as const,
    routed_to_user_id: "owner-legal",
    sla_due_at: "2026-06-11T10:00:00.000Z"
  };
  const secondRequest = {
    ...firstRequest,
    id: "r4-multi-approval-budget",
    action_pattern: "proposal.review.budget_delta_pack",
    routed_to_user_id: "owner-finance",
    sla_due_at: "2026-06-11T11:00:00.000Z"
  };

  surface.page_vms.attention = {
    ...surface.page_vms.attention,
    primary: firstApproval,
    background_runs: [
      { preview_text: "区域发布复盘包正在汇总会议、网盘和预算差异。" },
      { preview_text: "预算复核包已生成，等待负责人审批。" }
    ]
  };
  surface.page_vms.approvals = {
    ...surface.page_vms.approvals,
    items: [firstApproval, secondApproval],
    requests: [firstRequest, secondRequest],
    counts: { pending: 2, all: 2 }
  };
  surface.page_vms.workitem = {
    ...surface.page_vms.workitem,
    workitem: {
      ...surface.page_vms.workitem.workitem,
      id: "r4-multi-workitem",
      code: "R4-MULTI-01",
      title: "跨区发布资料包",
      summary_md: "整理跨区发布材料、法务条款、预算复核和负责人审批记录。",
      status: "needs_review",
      priority: "high"
    },
    acceptance: [
      { title: "包含法务条款复核结论", status: "met" },
      { title: "包含预算差异和负责人确认", status: "met" },
      { title: "保留 AI 回放和证据来源", status: "open" }
    ],
    latest_proposal: { title: "发布复盘资料包变更申请" },
    agent_trace_preview: [
      { step_no: 1, phase: "plan", output_excerpt: "读取发布计划、会议纪要和预算表。" },
      { step_no: 2, phase: "draft", output_excerpt: "生成跨区发布资料包初稿。" },
      { step_no: 3, phase: "review", output_excerpt: "等待法务与预算负责人审批。" }
    ],
    evidence_refs: surface.page_vms.workitem.evidence_refs
  };
  surface.page_vms.proposal = {
    ...surface.page_vms.proposal,
    proposal_id: "r4-multi-proposal",
    work_item_id: "r4-multi-workitem",
    title: "发布复盘资料包变更申请",
    manifest: {
      ...surface.page_vms.proposal.manifest,
      work_item_id: "r4-multi-workitem",
      title: "发布复盘资料包变更申请",
      summary_md: "新增跨区发布资料包，覆盖法务条款、预算差异、负责人审批和可回滚交付记录。",
      changes: [
        {
          id: "r4-change-doc",
          human_summary: "新增 regional-launch-review.md",
          target_kind: "text_doc",
          change_type: "generated",
          target_ref: { entity_type: "drive_item", path: "docs/regional-launch-review.md" }
        },
        {
          id: "r4-change-budget",
          human_summary: "更新预算复核字段",
          target_kind: "structured_record",
          change_type: "updated",
          target_ref: { entity_type: "work_item", entity_id: "r4-multi-workitem" }
        }
      ],
      checks: [
        { id: "legal", label: "法务条款检查", status: "passed", detail: "免责说明已保留。" },
        { id: "budget", label: "预算差异检查", status: "warning", detail: "三条预算差异需要负责人审批。" }
      ]
    },
    comments: [
      {
        id: "r4-comment-owner",
        author_label: "Owner",
        body: "先确认预算复核包，再进入正式交付。",
        created_at: "2026-06-11T02:00:00.000Z"
      }
    ]
  };
  surface.page_vms.replay = {
    ...surface.page_vms.replay,
    run: {
      ...surface.page_vms.replay.run,
      id: "r4-multi-run",
      work_item_id: "r4-multi-workitem",
      handoff_md: "跨区发布资料包已完成，法务条款、预算差异和负责人审批都已纳入回放。"
    },
    steps: [
      { step_no: 1, phase: "plan", output_excerpt: "读取发布计划和审批规则。" },
      { step_no: 2, phase: "evidence", output_excerpt: "绑定会议纪要、预算表和法务备注。" },
      { step_no: 3, phase: "draft", output_excerpt: "生成 regional-launch-review.md。" },
      { step_no: 4, phase: "review", output_excerpt: "等待法务条款复核和预算复核包审批。" },
      { step_no: 5, phase: "final", output_excerpt: "生成可回滚交付记录和成本摘要。" }
    ]
  };
  surface.page_vms.cost = {
    ...surface.page_vms.cost,
    total_cost_cny: "18.42",
    token_in: 184000,
    token_out: 62000,
    notices: [
      {
        code: "budget_warning",
        severity: "warning",
        message: "预算复核包接近本日团队成本阈值，后续 run 会优先选择低成本模型。",
        scope: { kind: "team", team_id: "r4-team-finance" },
        usage_ratio: 0.82,
        recommended_action: "downgrade_model",
        action_href: "/dashboard/cost"
      }
    ],
    top_exhaustion_risks: [
      {
        scope: { kind: "workitem", workitem_id: "r4-multi-workitem" },
        label: "跨区发布资料包",
        remaining_cost_cny: "1.58",
        status: "warning"
      },
      {
        scope: { kind: "workitem", workitem_id: "r4-budget-pack" },
        label: "预算复核包",
        remaining_cost_cny: "2.10",
        status: "warning"
      }
    ]
  };
  return surface;
}

function fakeRouteClient(surface: GoldPathSurfaceVM, overrides: RouteClientOverrides = {}) {
  const calls: string[] = [];
  const localeCall = (name: string, options?: { locale?: string }) => calls.push(`${name}:${options?.locale ?? "none"}`);
  const approvals = overrides.approvalsEmpty
    ? { ...surface.page_vms.approvals, items: [], requests: [], counts: { pending: 0, all: 0 } }
    : surface.page_vms.approvals;
  const client = {
    pages: {
      async attention(options?: { locale?: string }) {
        localeCall("attention", options);
        return surface.page_vms.attention;
      },
      async approvals(options?: { locale?: string }) {
        localeCall("approvals", options);
        return approvals;
      },
      async cost(options?: { locale?: string }) {
        localeCall("cost", options);
        return surface.page_vms.cost;
      },
      async goldPath(options?: { locale?: string }) {
        localeCall("goldPath", options);
        return surface;
      },
      async workItem(id: string, options?: { locale?: string }) {
        localeCall(`workItem:${id}`, options);
        if (overrides.workItemError) {
          throw overrides.workItemError;
        }
        return surface.page_vms.workitem;
      },
      async proposal(id: string, options?: { locale?: string }) {
        localeCall(`proposal:${id}`, options);
        if (overrides.proposalError) {
          throw overrides.proposalError;
        }
        return surface.page_vms.proposal;
      }
    },
    async replayAgentRun(id: string) {
      calls.push(`replayAgentRun:${id}`);
      return surface.page_vms.replay;
    }
  } as unknown as WorkHubApiClient;
  return { client, calls };
}

async function loadedCase(input: {
  id: string;
  label: string;
  route: string;
  locale: WorkHubLocale;
  viewport: Viewport;
  overrides?: RouteClientOverrides;
}) {
  const surface = multiRecordSurfaceVm();
  const { client, calls } = fakeRouteClient(surface, input.overrides);
  const match = resolveWebRoute(input.route);
  if (!match) {
    throw new Error(`Route did not resolve: ${input.route}`);
  }
  const result = await loadWebRoute(client, match, input.locale);
  return {
    id: input.id,
    label: input.label,
    route: input.route,
    locale: input.locale,
    viewport: input.viewport,
    status: result.status,
    html: result.html,
    calls
  } satisfies RouteCase;
}

function fullDocument(caseItem: RouteCase) {
  return `<!doctype html>
<html lang="${caseItem.locale}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(caseItem.label)}</title>
</head>
<body data-r4-web-multi-record-case="${escapeHtml(caseItem.id)}" data-r4-web-route="${escapeHtml(caseItem.route)}" data-r4-locale="${caseItem.locale}">
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
  <title>R4 Web Multi-record Page VM Contact Sheet</title>
  <style>
    body{margin:0;font-family:"Aptos","Segoe UI",sans-serif;color:#172033;background:#eef4fb;padding:20px}
    h1{margin:0 0 14px;font-size:28px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
    figure{margin:0;background:white;border:1px solid #dfe5f1;border-radius:8px;padding:10px;box-shadow:0 18px 50px rgba(37,51,79,.08)}
    figcaption{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:#5e6a86;margin-bottom:8px}
    img{display:block;width:100%;height:auto;border:1px solid #eef2f8;border-radius:6px}
  </style>
</head>
<body>
  <h1>R4 Web Multi-record Page VM Contact Sheet</h1>
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
  const userDataDir = path.join(os.tmpdir(), `workhub-r4-web-multi-record-${path.basename(input.pngPath, ".png")}`);
  await rm(userDataDir, { recursive: true, force: true });
  await mkdir(userDataDir, { recursive: true });
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
    pathToFileURL(input.htmlPath).href
  ];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(input.chromePath, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Chrome screenshot failed with exit code ${String(code)} for ${input.htmlPath}`));
      }
    });
  });
  await rm(userDataDir, { recursive: true, force: true });
}

async function runChromeDump(input: {
  chromePath: string;
  htmlPath: string;
  viewport: Viewport;
}) {
  const userDataDir = path.join(os.tmpdir(), `workhub-r4-web-multi-record-dump-${path.basename(input.htmlPath, ".html")}`);
  await rm(userDataDir, { recursive: true, force: true });
  await mkdir(userDataDir, { recursive: true });
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--force-device-scale-factor=1",
    `--user-data-dir=${userDataDir}`,
    `--window-size=${input.viewport.width},${input.viewport.height}`,
    "--dump-dom",
    pathToFileURL(input.htmlPath).href
  ];
  const output = await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const child = spawn(input.chromePath, args, { stdio: ["ignore", "pipe", "ignore"] });
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks).toString("utf8"));
      } else {
        reject(new Error(`Chrome DOM dump failed with exit code ${String(code)} for ${input.htmlPath}`));
      }
    });
  });
  await rm(userDataDir, { recursive: true, force: true });
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
  const clientWidth = layoutNumber(html, "data-r4-client-width");
  const scrollWidth = layoutNumber(html, "data-r4-scroll-width");
  return {
    statusReady: countNeedle(html, 'data-r4-web-route-status="ready"'),
    statusEmpty: countNeedle(html, 'data-r4-web-route-status="empty"'),
    statusForbidden: countNeedle(html, 'data-r4-web-route-status="forbidden"'),
    pathNavigation: html.includes('href="/approvals"') && html.includes('href="/dashboard/cost"'),
    hashNavigationLeak: html.includes('href="#/'),
    weeklyFixtureLeak:
      countNeedle(html, "客户周报")
      + countNeedle(html.toLowerCase(), "weekly report")
      + countNeedle(html.toLowerCase(), "weekly-report"),
    multiRecordCopy: Object.fromEntries(
      Object.entries(multiRecordNeedles).map(([key, value]) => [key, html.includes(value)])
    ),
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
    throw new Error("Chrome/Chromium is required for R4 Web multi-record QA. Set CHROME_PATH or WORKHUB_R4_ALLOW_NO_CHROME=1.");
  }

  const cases: RouteCase[] = [
    await loadedCase({
      id: "ready-home-multi-zh-desktop",
      label: "Ready home multi-record zh-CN desktop",
      route: "/",
      locale: "zh-CN",
      viewport: { width: 1365, height: 1200 }
    }),
    await loadedCase({
      id: "ready-approvals-multi-en-mobile",
      label: "Ready approvals multi-record en-US mobile",
      route: "/approvals",
      locale: "en-US",
      viewport: { width: 467, height: 1700 }
    }),
    await loadedCase({
      id: "ready-cost-multi-zh-desktop",
      label: "Ready cost multi-record zh-CN desktop",
      route: "/dashboard/cost",
      locale: "zh-CN",
      viewport: { width: 1365, height: 1200 }
    }),
    await loadedCase({
      id: "ready-workitem-multi-en-desktop",
      label: "Ready workitem multi-record en-US desktop",
      route: "/workitems/r4-multi-workitem",
      locale: "en-US",
      viewport: { width: 1365, height: 1200 }
    }),
    await loadedCase({
      id: "ready-proposal-multi-zh-mobile",
      label: "Ready proposal multi-record zh-CN mobile",
      route: "/proposals/r4-multi-proposal",
      locale: "zh-CN",
      viewport: { width: 467, height: 1800 }
    }),
    await loadedCase({
      id: "ready-replay-multi-en-desktop",
      label: "Ready replay multi-record en-US desktop",
      route: "/agent-runs/r4-multi-run/replay",
      locale: "en-US",
      viewport: { width: 1365, height: 1300 }
    }),
    await loadedCase({
      id: "empty-approvals-multi-zh-mobile",
      label: "Empty approvals after multi-record zh-CN mobile",
      route: "/approvals",
      locale: "zh-CN",
      viewport: { width: 467, height: 900 },
      overrides: { approvalsEmpty: true }
    }),
    await loadedCase({
      id: "forbidden-workitem-multi-en-mobile",
      label: "Forbidden workitem en-US mobile",
      route: "/workitems/r4-private-workitem",
      locale: "en-US",
      viewport: { width: 467, height: 900 },
      overrides: { workItemError: new WorkHubApiError(403, "forbidden", "Needs work item owner approval") }
    }),
    await loadedCase({
      id: "missing-proposal-multi-zh-desktop",
      label: "Missing proposal zh-CN desktop",
      route: "/proposals/r4-missing-proposal",
      locale: "zh-CN",
      viewport: { width: 1365, height: 900 },
      overrides: { proposalError: new WorkHubApiError(404, "not_found", "not found") }
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
      markerHtml = await runChromeDump({ chromePath, htmlPath, viewport: caseItem.viewport });
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
      viewport: { width: 1365, height: 6500 }
    });
    await assertPng(contactPngPath);
  }

  const readyCases = reportCases.filter((caseItem) => caseItem.status === "ready");
  const endpointProof = [
    ["ready-home-multi-zh-desktop", "attention:zh-CN"],
    ["ready-approvals-multi-en-mobile", "approvals:en-US"],
    ["ready-cost-multi-zh-desktop", "cost:zh-CN"],
    ["ready-workitem-multi-en-desktop", "workItem:r4-multi-workitem:en-US"],
    ["ready-proposal-multi-zh-mobile", "proposal:r4-multi-proposal:zh-CN"],
    ["ready-replay-multi-en-desktop", "replayAgentRun:r4-multi-run"]
  ].every(([id, call]) => reportCases.some((caseItem) => caseItem.id === id && caseItem.endpoint_calls[0] === call));
  const multiCopyCoverage = Object.keys(multiRecordNeedles).every((key) =>
    reportCases.some((caseItem) => caseItem.markers.multiRecordCopy[key] === true)
  );
  const report = {
    generated_at: new Date().toISOString(),
    module: "R4.3 Web multi-record Page VM visual QA",
    chrome_path: chromePath ?? null,
    output_dir: path.relative(repoRoot, auditDir).replace(/\\/gu, "/"),
    gates: {
      screenshots_captured: Boolean(chromePath),
      ready_routes_use_page_vm_endpoints: endpointProof,
      detail_ready_routes_covered: readyCases.some((caseItem) => caseItem.route.startsWith("/workitems/"))
        && readyCases.some((caseItem) => caseItem.route.startsWith("/proposals/"))
        && readyCases.some((caseItem) => caseItem.route.startsWith("/agent-runs/")),
      multi_record_copy_covered: multiCopyCoverage,
      no_weekly_fixture_copy_in_ready: readyCases.every((caseItem) => caseItem.markers.weeklyFixtureLeak === 0),
      empty_and_forbidden_states: reportCases.some((caseItem) => caseItem.status === "empty")
        && reportCases.some((caseItem) => caseItem.status === "forbidden"),
      path_navigation_without_hash: readyCases.every((caseItem) => caseItem.markers.pathNavigation && !caseItem.markers.hashNavigationLeak),
      no_main_window_cuu: reportCases.every((caseItem) => caseItem.markers.cuuLeak === 0),
      no_default_kanban: reportCases.every((caseItem) => caseItem.markers.kanbanLeak === 0),
      no_horizontal_overflow: reportCases.every((caseItem) => !caseItem.markers.horizontalOverflow)
    },
    cases: reportCases
  };

  if (!Object.values(report.gates).every(Boolean)) {
    throw new Error(`R4 Web multi-record QA gates failed: ${JSON.stringify(report.gates)}`);
  }

  await writeFile(path.join(auditDir, "multi-record-page-vm-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(auditDir, "smoke-summary.md"), [
    "# R4 Web Multi-record Page VM Visual QA",
    "",
    `- Generated: ${report.generated_at}`,
    `- Chrome: ${chromePath ?? "not captured"}`,
    "- Scope: multi-record ready screenshots for home, approvals, cost, workitem, proposal, and replay via the real R4 route loader.",
    "- Gates: typed Page VM endpoints first, detail routes covered, no weekly-report fixture copy in ready pages, empty/forbidden states present, real path navigation, no Cuu main-window markers, no default Kanban wording, no horizontal overflow.",
    "- Boundary: this is still shared HTML surface QA. Product shell component migration remains R4.4.",
    ""
  ].join("\n"), "utf8");

  console.log(JSON.stringify({ ok: true, output_dir: report.output_dir, screenshots: Boolean(chromePath) }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
