import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { cardFromAgentRunLive } from "../../packages/cuu/src/cards.js";
import type { AgentRunLiveVM } from "../../packages/contracts/src/index.js";
import { renderDesktopPetSurface } from "../../apps/desktop-webview/src/pet-surface.js";

type Viewport = {
  width: number;
  height: number;
};

type LayoutMetric = {
  clientHeight: number;
  scrollHeight: number;
  clientWidth: number;
  scrollWidth: number;
  overflowY: string;
  horizontalOverflow: boolean;
  verticalOverflow: boolean;
};

type TextClippingOffender = {
  selector: string;
  text: string;
  top: number;
  bottom: number;
  bubbleTop: number;
  bubbleBottom: number;
  clippedTop: boolean;
  clippedBottom: boolean;
};

type QaReport = {
  ok: boolean;
  chrome_path: string;
  audit_dir: string;
  screenshot: string;
  html: string;
  metrics: {
    bubble: LayoutMetric;
    surface: LayoutMetric;
    budgetBottomClearance: number;
    bubbleGapToLive2d: number;
    statusVisible: boolean;
    budgetVisible: boolean;
    textClippingOffenders: TextClippingOffender[];
  };
  gates: Record<string, boolean>;
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const auditDir = path.join(
  repoRoot,
  "docs",
  "workhub",
  "05-clients",
  "assets",
  "audit",
  "2026-06-11-cuu-run-card-overflow-regression"
);

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

function failedRunFixture(): AgentRunLiveVM {
  const runId = "40000000-0000-4000-8000-000000000999";
  const workItemId = "20000000-0000-4000-8000-000000000999";
  return {
    run_id: runId,
    work_item_id: workItemId,
    title: "Cuu R3 run-failure QA forced provider failure",
    status: "failed",
    run: {
      id: runId,
      work_item_id: workItemId,
      mode: "worker",
      actor: "AI",
      status: "failed",
      model: "deepseek-v4-flash",
      turns_used: 1,
      max_turns: 15,
      token_in: 3050,
      token_out: 980,
      created_at: "2026-06-11T00:00:00.000Z",
      updated_at: "2026-06-11T00:04:00.000Z",
      handoff_md: "Cuu R3 run-failure QA forced provider failure."
    },
    budget: {
      max_steps: 15,
      total_timeout_s: 300,
      max_tokens: 120000,
      max_cost_cny: "5.00"
    },
    budget_decision: {
      decision_id: "cuu-overflow-regression-budget",
      allowed: true,
      model_route: {
        provider: "deepseek",
        model: "deepseek-v4-flash",
        reason: "forced_provider_failure"
      }
    },
    usage: {
      steps_used: 1,
      token_in: 3050,
      token_out: 980,
      estimated_cost_cny: "0.24"
    },
    trace: [
      {
        id: "50000000-0000-4000-8000-000000000999",
        agent_run_id: runId,
        step_no: 1,
        phase: "final",
        input_json: {},
        output_excerpt: "Cuu R3 run-failure QA forced provider failure.",
        created_at: "2026-06-11T00:04:00.000Z"
      }
    ],
    stream_href: `/api/push/stream/run/${runId}`,
    replay_href: `/agent-runs/${runId}/replay`
  };
}

function failedRunDocument() {
  const card = cardFromAgentRunLive(failedRunFixture(), { locale: "en-US" });
  const surface = renderDesktopPetSurface({
    card,
    status_text: "Cuu updated progress: Cuu desktop entry task",
    locale: "en-US"
  });
  const publicBaseUrl = pathToFileURL(path.join(repoRoot, "apps", "desktop-webview", "public") + path.sep).href;
  return `<!doctype html>
<html lang="en-US">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <base href="${escapeHtml(publicBaseUrl)}" />
  <title>Cuu Run Card Overflow Regression</title>
  <style>${surface.css}</style>
  <style>body{margin:0;width:520px;height:720px;background:#eef4fb;overflow:hidden}</style>
</head>
<body>
  ${surface.html}
  <script>
    (() => {
      const layout = (el) => {
        const style = getComputedStyle(el);
        return {
          clientHeight: Math.round(el.clientHeight),
          scrollHeight: Math.round(el.scrollHeight),
          clientWidth: Math.round(el.clientWidth),
          scrollWidth: Math.round(el.scrollWidth),
          overflowY: style.overflowY,
          horizontalOverflow: el.scrollWidth > el.clientWidth + 2,
          verticalOverflow: el.scrollHeight > el.clientHeight + 2
        };
      };
      const rect = (el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
      };
      const selectorName = (el) => {
        const tag = el.tagName.toLowerCase();
        const cls = (el.getAttribute("class") || "").trim().split(/\\s+/).filter(Boolean).slice(0, 2).join(".");
        return cls ? tag + "." + cls : tag;
      };
      const surface = document.querySelector(".wh-pet-surface");
      const bubble = document.querySelector(".wh-pet-bubble");
      const budget = document.querySelector('[data-pet-section-id="budget"]');
      const live2d = document.querySelector(".wh-cuu-cat-live2d");
      const bubbleRect = rect(bubble);
      const budgetRect = rect(budget);
      const live2dRect = rect(live2d);
      const clippingSelectors = [
        ".wh-pet-kicker",
        ".wh-pet-title",
        ".wh-pet-message",
        ".wh-pet-status",
        ".wh-pet-action",
        ".wh-pet-section-title",
        ".wh-pet-section-line",
        ".wh-pet-progress-label"
      ].join(",");
      const textClippingOffenders = Array.from(document.querySelectorAll(clippingSelectors))
        .map((el) => {
          const r = rect(el);
          const text = (el.textContent || "").replace(/\\s+/g, " ").trim();
          const clippedTop = r.y < bubbleRect.y - 1;
          const clippedBottom = r.bottom > bubbleRect.bottom + 1;
          return {
            selector: selectorName(el),
            text: text.slice(0, 120),
            top: Math.round(r.y * 100) / 100,
            bottom: Math.round(r.bottom * 100) / 100,
            bubbleTop: Math.round(bubbleRect.y * 100) / 100,
            bubbleBottom: Math.round(bubbleRect.bottom * 100) / 100,
            clippedTop,
            clippedBottom
          };
        })
        .filter((entry) => entry.text && (entry.clippedTop || entry.clippedBottom));
      const report = {
        bubble: layout(bubble),
        surface: layout(surface),
        budgetBottomClearance: Math.round((bubbleRect.bottom - budgetRect.bottom) * 100) / 100,
        bubbleGapToLive2d: Math.round((live2dRect.y - bubbleRect.bottom) * 100) / 100,
        statusVisible: (bubble.textContent || "").includes("Cuu updated progress"),
        budgetVisible: (bubble.textContent || "").includes("Budget") && budgetRect.bottom <= bubbleRect.bottom - 4,
        textClippingOffenders
      };
      document.body.setAttribute("data-cuu-layout-report", JSON.stringify(report));
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
  const userDataDir = path.join(os.tmpdir(), `workhub-cuu-overflow-${input.mode}`);
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
    input.mode === "dump" ? "--dump-dom" : `--screenshot=${input.pngPath}`,
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
        reject(new Error(`Chrome ${input.mode} failed with exit code ${String(code)}`));
      }
    });
  });
  await rm(userDataDir, { recursive: true, force: true });
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

function extractLayoutReport(dump: string): QaReport["metrics"] {
  const match = /data-cuu-layout-report="([^"]+)"/u.exec(dump);
  if (!match?.[1]) {
    throw new Error("Chrome DOM dump did not include data-cuu-layout-report.");
  }
  const decoded = match[1]
    .replace(/&quot;/gu, "\"")
    .replace(/&amp;/gu, "&");
  return JSON.parse(decoded) as QaReport["metrics"];
}

async function main() {
  const chromePath = findChrome();
  if (!chromePath) {
    throw new Error("Chrome/Chromium is required. Set CHROME_PATH to run Cuu pet run-card overflow QA.");
  }
  await mkdir(auditDir, { recursive: true });
  const htmlPath = path.join(auditDir, "failed-run-card.html");
  const pngPath = path.join(auditDir, "failed-run-card.png");
  const reportPath = path.join(auditDir, "run-card-overflow-report.json");
  const summaryPath = path.join(auditDir, "smoke-summary.md");
  const html = failedRunDocument();
  const viewport = { width: 520, height: 720 };
  await writeFile(htmlPath, stripTrailingWhitespace(html), "utf8");
  await runChrome({ chromePath, htmlPath, pngPath, viewport, mode: "screenshot" });
  await assertPng(pngPath);
  const dump = await runChrome({ chromePath, htmlPath, pngPath, viewport, mode: "dump" });
  const metrics = extractLayoutReport(dump);
  const gates = {
    bubble_no_horizontal_overflow: !metrics.bubble.horizontalOverflow,
    bubble_no_vertical_overflow: !metrics.bubble.verticalOverflow,
    no_text_clipped_by_bubble: metrics.textClippingOffenders.length === 0,
    surface_no_horizontal_overflow: !metrics.surface.horizontalOverflow,
    surface_no_vertical_overflow: !metrics.surface.verticalOverflow,
    status_suppressed_for_failed_trace: !metrics.statusVisible,
    budget_visible_with_padding: metrics.budgetVisible && metrics.budgetBottomClearance >= 8,
    bubble_clear_of_live2d: metrics.bubbleGapToLive2d >= 8
  };
  const ok = Object.values(gates).every(Boolean);
  const report: QaReport = {
    ok,
    chrome_path: chromePath,
    audit_dir: auditDir,
    screenshot: pngPath,
    html: htmlPath,
    metrics,
    gates
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(
    summaryPath,
    [
      "# Cuu Run Card Overflow Regression",
      "",
      `- ok: ${String(ok)}`,
      `- screenshot: ${escapeHtml(path.basename(pngPath))}`,
      `- bubble vertical overflow: ${String(metrics.bubble.verticalOverflow)}`,
      `- text clipping offenders: ${String(metrics.textClippingOffenders.length)}`,
      `- budget bottom clearance: ${String(metrics.budgetBottomClearance)}px`,
      `- bubble gap to Live2D: ${String(metrics.bubbleGapToLive2d)}px`,
      `- transient status visible: ${String(metrics.statusVisible)}`,
      ""
    ].join("\n"),
    "utf8"
  );
  if (!ok) {
    throw new Error(`Cuu run-card overflow QA failed: ${JSON.stringify(gates)}`);
  }
  console.log(JSON.stringify(report, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
