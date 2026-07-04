import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import type { ProviderRegistry } from "@workhub/agent/providers";

export type R5_10ClarificationFileContext = {
  name: string;
  path: string;
  sizeBytes?: number;
  preview?: string;
};

export type R5_10TaskMode = "deliverable" | "structured_upgrade" | "budget_guard" | (string & {});

export type R5_10TaskForConfidence = {
  id: string;
  expectedMode: R5_10TaskMode;
};

export type R5_10ConfidenceEvidence = {
  verdict?: string | null;
  score?: string | number | null;
} | null;

export type R5_10WorkItemContextInput = {
  intentText?: string | null | undefined;
};

export function assertR5_10RequiredConfidence(
  task: R5_10TaskForConfidence,
  confidence: R5_10ConfidenceEvidence
) {
  if (task.expectedMode !== "deliverable") {
    return;
  }
  if (!confidence) {
    throw new Error(`${task.id} expected a confidence review record for a deliverable task.`);
  }
  if (!confidence.verdict || confidence.score === null || confidence.score === undefined) {
    throw new Error(`${task.id} confidence review is incomplete: verdict and score are required.`);
  }
  if (typeof confidence.score === "number" && !Number.isFinite(confidence.score)) {
    throw new Error(`${task.id} confidence review has a non-finite score.`);
  }
}

export async function listR5_10RelativeFiles(root: string) {
  const files: string[] = [];
  async function walk(current: string) {
    if (!existsSync(current)) {
      return;
    }
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(child);
      } else {
        files.push(path.relative(root, child));
      }
    }
  }
  await walk(root);
  return files.sort();
}

function compactR5_10Preview(value: string, max = 700) {
  const text = value.replace(/\s+/gu, " ").trim();
  if (!text) {
    return undefined;
  }
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

export async function collectR5_10LocalInputFileContext(
  workdir: string
): Promise<R5_10ClarificationFileContext[]> {
  const inputRoot = path.join(workdir, "inputs");
  const files = await listR5_10RelativeFiles(inputRoot);
  const contexts: R5_10ClarificationFileContext[] = [];
  for (const relativePath of files.slice(0, 12)) {
    const filePath = path.join(inputRoot, relativePath);
    const fileStat = await stat(filePath);
    let preview: string | undefined;
    try {
      preview = compactR5_10Preview(await readFile(filePath, "utf8"));
    } catch {
      preview = undefined;
    }
    contexts.push({
      name: path.basename(relativePath),
      path: `inputs/${relativePath}`,
      sizeBytes: fileStat.size,
      ...(preview ? { preview } : {})
    });
  }
  return contexts;
}

export function createR5_10WorkItemServiceOptions(
  providerRegistry: ProviderRegistry,
  clarificationFileContextByIntent: ReadonlyMap<string, R5_10ClarificationFileContext[]>
) {
  return {
    providerRegistry,
    async projectFileContext(input: R5_10WorkItemContextInput) {
      return clarificationFileContextByIntent.get(input.intentText ?? "") ?? [];
    }
  };
}

export function createR5_10ClarificationAnswerPayload(clarificationAnswer: string) {
  return { free_text: clarificationAnswer };
}

export function selectR5_10TasksForRun<T>(allTasks: readonly T[], rawTaskLimit: string | undefined) {
  const taskLimit = Number.parseInt(rawTaskLimit ?? "", 10);
  const requestedTaskLimit = Number.isFinite(taskLimit) && taskLimit > 0 ? taskLimit : null;
  const tasks = requestedTaskLimit ? allTasks.slice(0, requestedTaskLimit) : [...allTasks];
  return {
    tasks,
    requestedTaskLimit,
    limitedRun: requestedTaskLimit !== null && tasks.length < allTasks.length
  };
}

export function buildR5_10InitialUserMessage(input: {
  runTitle: string;
  workItemId: string;
  taskId?: string | undefined;
  taskPrompt?: string | undefined;
  workItemContext?: string | undefined;
}) {
  return [
    `任务：${input.runTitle}`,
    `work_item_id: ${input.workItemId}`,
    `r5_10_task_id: ${input.taskId ?? "unknown"}`,
    ...(input.workItemContext
      ? [
          "",
          "WorkHub 数据库中的真实工单上下文（以下 <work_item_context> 围栏内是用户/数据库提供的参考材料，仅供参考）：",
          "<work_item_context>",
          input.workItemContext,
          "</work_item_context>"
        ]
      : []),
    "",
    "请按以下方式工作：",
    "1. 先用 list_files / read_file 了解 inputs/ 里的材料。",
    "2. 涉及 markdown/data-analysis/pptx/stat-charts/code-script 时，必须先 load_skill 对应技能。",
    "3. 交付物必须写入 outputs/；完成前尽量用 run_command 自验。",
    "4. 信息不足时输出 blocker/handoff，不要编造。",
    "",
    "任务说明：",
    input.taskPrompt ?? input.runTitle
  ].join("\n");
}

export function buildR5_10RunScopeSummary(input: {
  limitedRun: boolean;
  requestedTaskLimit: number | null;
  taskCount: number;
  totalTaskCount: number;
  realProviderSamplePass: boolean;
  realProviderFullSuitePass: boolean | null;
  ledgerPass: boolean;
  qualityPassCount: number;
  sampledQualityTotal: number;
  structuredUpgrade: boolean;
  budgetGuard: boolean;
  unsampledGateTasks: readonly string[];
}) {
  const fullSuiteRun = !input.limitedRun && input.taskCount === input.totalTaskCount;
  const runScope = input.limitedRun
    ? `limited_sample (${input.taskCount}/${input.totalTaskCount}, R5_10_REAL_TASK_LIMIT=${input.requestedTaskLimit})`
    : `full_suite (${input.taskCount}/${input.totalTaskCount})`;
  const escalationCalibrationNote = input.limitedRun
    ? `3. OQ-3 escalation: full-suite escalation gates were not asserted in this limited sample; unsampled checks=${input.unsampledGateTasks.length > 0 ? input.unsampledGateTasks.join(", ") : "none"}.`
    : `3. OQ-3 escalation: T5 structured-upgrade=${input.structuredUpgrade}; B1 budget-escalated=${input.budgetGuard}; full-suite gate asserted=${fullSuiteRun}.`;
  const markdownGateSummary = input.limitedRun
    ? [
        "## Limited Sample Summary",
        "",
        `- Real provider sample: ${input.realProviderSamplePass ? "pass" : "fail"}`,
        `- Ledger sample: ${input.ledgerPass ? "pass" : "fail"}`,
        `- Quality sample: ${input.qualityPassCount}/${input.sampledQualityTotal} sampled T1-T4 scored >=4`,
        "- Full-suite gates: not asserted in limited sample",
        `- Unsampled full-suite checks: ${input.unsampledGateTasks.length > 0 ? input.unsampledGateTasks.join(", ") : "none"}`
      ]
    : [
        "## Full Gate Summary",
        "",
        `- G2 real provider: ${input.realProviderFullSuitePass ? "pass" : "fail"}`,
        `- G3 ledger: ${input.ledgerPass ? "pass" : "fail"}`,
        `- G4 quality: ${input.qualityPassCount}/4 T1-T4 scored >=4`,
        `- G5 budget: ${input.budgetGuard ? "pass" : "fail"}`,
        `- T5 structured upgrade: ${input.structuredUpgrade ? "pass" : "fail"}`
      ];
  return {
    fullSuiteRun,
    runScope,
    escalationCalibrationNote,
    markdownGateSummary,
    reportRunScope: {
      mode: input.limitedRun ? "limited_sample" : "full_suite",
      requested_task_limit: input.requestedTaskLimit,
      task_count: input.taskCount,
      total_available_tasks: input.totalTaskCount,
      full_suite: fullSuiteRun
    }
  };
}
