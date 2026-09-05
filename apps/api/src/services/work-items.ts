import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { z } from "zod";

import {
  createDriveRepository,
  getSharedDatabaseClient,
  createWorkItemRepository,
  defaultSeedIds,
  WorkItemAcceptedDeliverableRestoreError,
  type DriveItemRow,
  type DrivePageRows,
  type DriveVersionRow,
  type WorkItemClarificationAnswerRow,
  type StoredWorkItemDetailRows,
  type TaskPlanWithItems,
  type WorkItemDataRepository,
  type WorkItemAgentStepRow,
  type WorkItemKnowledgeDocumentRow,
  type WorkItemKnowledgeSearchWorkItemRow,
  type WorkItemProjectRow,
  type WorkItemRow,
  type WorkHubDatabaseClient
} from "@workhub/db";
import {
  cuuLauncherSpecFromSelectedOptionIds,
  deliverableChangeManifestSchema,
  evidenceRefSchema,
  sessionVmSchema,
  workItemAgentTeamVmSchema,
  taskPlanVmSchema,
  workItemDetailVmSchema,
  workItemPrioritySchema,
  type AgentStep,
  type AcceptedDeliverableRestoreResult,
  type CreateSessionRequest,
  type CreateWorkItemRequest,
  type CuuLauncherWorkItemSpec,
  type EvidenceBubble,
  type EvidenceRef,
  type NextQuestionRequest,
  type QuestionCard,
  type SessionVM,
  type TaskPlanVM,
  type WorkItemAgentTeamVM,
  type UseEvidenceForTaskRequest,
  type WorkItem,
  type WorkItemDetailVM,
  type WorkHubLocale
} from "@workhub/contracts";
import type { ProviderRegistry } from "@workhub/agent/providers";

import {
  ASSIGNMENT_ROLES,
  canClaimWorkItem,
  canManageWorkItemAssignees,
  canViewProjectDrive,
  canViewWorkItemRecord
} from "@workhub/permissions";

import type { AuthActor } from "../middleware/auth.js";
import { parseOutputContract } from "../pages/output-contract.js";
import { acceptedDeliverableToVm } from "./accepted-deliverables.js";
import { getDefaultProviderRegistry } from "./provider-registry.js";
import { checkEntryLlmBudget, entryLlmBudgetExceededMessage } from "./entry-llm-budget.js";

export const knowledgeSearchRequestSchema = z.object({
  q: z.string().trim().min(1).max(500).optional(),
  query: z.string().trim().min(1).max(500).optional(),
  project_id: z.string().uuid().optional(),
  work_item_id: z.string().uuid().optional(),
  run: z.string().min(1).max(128).optional(),
  scope: z.string().min(1).max(64).optional(),
  source_ref: z.string().min(1).max(200).optional(),
  limit: z.number().int().min(1).max(80).optional()
});
export type KnowledgeSearchRequest = z.infer<typeof knowledgeSearchRequestSchema>;

export class WorkItemServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export type WorkItemService = {
  createSession: (input: {
    payload: CreateSessionRequest;
    actor: AuthActor;
    locale?: WorkHubLocale;
  }) => Promise<SessionVM>;
  getSession: (input: {
    sessionId: string;
    actor: AuthActor;
    locale?: WorkHubLocale;
  }) => Promise<SessionVM>;
  nextQuestion: (input: {
    sessionId: string;
    payload: NextQuestionRequest;
    actor: AuthActor;
    locale?: WorkHubLocale;
  }) => Promise<SessionVM>;
  createWorkItem: (input: {
    payload: CreateWorkItemRequest;
    actor: AuthActor;
    locale?: WorkHubLocale;
  }) => Promise<WorkItemDetailVM>;
  bindEvidence: (input: {
    workItemId: string;
    payload: UseEvidenceForTaskRequest;
    actor: AuthActor;
    locale?: WorkHubLocale;
  }) => Promise<WorkItemDetailVM>;
  searchKnowledge: (input: {
    payload: KnowledgeSearchRequest;
    actor: AuthActor;
    locale?: WorkHubLocale;
  }) => Promise<EvidenceBubble>;
  detailPage: (input: {
    workItemId: string;
    actor: AuthActor;
    locale?: WorkHubLocale;
  }) => Promise<WorkItemDetailVM>;
  // routes-a-2/routes-b-1/services-a-2/xlink-authz-4/ux-web-govern-6：审批中心可见性判定此前借用 detailPage
  // （整页 VM 装配：assignments/proposals/acceptance/agent trace 等一堆 join）只为算一个 boolean，且逐行调用无
  // 去重。改成批量、轻量的访问记录判定——一次 IN 查询把一批 workItemId 的可见性判完，返回可读的那部分 id 集合。
  projectNamesForWorkItems: (input: { workItemIds: string[]; actor: AuthActor }) => Promise<Map<string, string>>;
  canReadWorkItems: (input: {
    workItemIds: string[];
    actor: AuthActor;
  }) => Promise<Set<string>>;
  assertCanMutateWorkItem: (input: {
    workItemId: string;
    actor: AuthActor;
  }) => Promise<void>;
  assertCanMutateArtifacts: (input: {
    workItemId: string;
    actor: AuthActor;
  }) => Promise<void>;
  acceptedDeliverableFile: (input: {
    workItemId: string;
    acceptedChangeId: string;
    actor: AuthActor;
  }) => Promise<{
    id: string;
    filename: string;
    mime?: string;
    sizeBytes: number;
    storagePath: string;
    sha256?: string;
    parsedText?: string;
  }>;
  restoreAcceptedDeliverable: (input: {
    workItemId: string;
    acceptedChangeId: string;
    actor: AuthActor;
  }) => Promise<AcceptedDeliverableRestoreResult>;
};

type ServiceOptions = {
  now?: () => Date;
  id?: () => string;
  defaultProjectId?: string;
  clarificationGenerator?: ClarificationQuestionGenerator;
  projectFileContext?: ProjectFileContextProvider;
  providerRegistry?: ProviderRegistry;
  // API-04：入口澄清 LLM（createSession/next-question 共用的生成路径）的预算软闸——
  // 真正要调 generator 前调用，超预算时由它抛 429；复用已存草稿不触发。
  budgetGate?: (input: { workspaceId?: string; locale?: WorkHubLocale }) => Promise<void>;
};

type ClarificationFileContext = {
  name: string;
  path: string;
  mime?: string | null | undefined;
  sizeBytes?: number | undefined;
  preview?: string | undefined;
};

export type ClarificationQuestionDraft = {
  title: string;
  body?: string | undefined;
  placeholder?: string | undefined;
  options?: Array<{ id?: string | undefined; label: string; description?: string | undefined }> | undefined;
  recommended_option_id?: string | undefined;
};

type ClarificationQuestionInput = {
  workItem: Pick<WorkItemRow, "id" | "projectId" | "title" | "rawDescription">;
  files: ClarificationFileContext[];
  actor: AuthActor;
  locale: WorkHubLocale;
};

type ClarificationQuestionGenerator = (input: ClarificationQuestionInput) => Promise<ClarificationQuestionDraft | undefined>;
type ProjectFileContextProvider = (input: {
  projectId: string;
  actor: AuthActor;
  locale: WorkHubLocale;
  intentText: string | undefined;
}) => Promise<ClarificationFileContext[]>;

const allowedEvidenceSourceTypes = new Set<EvidenceRef["source_type"]>([
  "drive_file",
  "meeting",
  "comment",
  "work_item",
  "spec_doc",
  "agent_step",
  "audit_log",
  "external_url"
]);

function stableUuid(input: string) {
  const hex = createHash("sha256").update(input).digest("hex");
  const variant = ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variant}${hex.slice(18, 20)}`,
    hex.slice(20, 32)
  ].join("-");
}

function compactText(value: string | null | undefined, max = 300) {
  const text = value?.replace(/\s+/gu, " ").trim();
  if (!text) {
    return undefined;
  }
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

type WorkItemCopyKey =
  | "question.confirm.title"
  | "question.confirm.body"
  | "question.confirm.create.label"
  | "question.confirm.create.description"
  | "question.confirm.evidence.label"
  | "question.confirm.evidence.description"
  | "question.confirm.adjust.label"
  | "question.confirm.adjust.description"
  | "question.clarify.title"
  | "question.clarify.placeholder"
  | "question.scope.title"
  | "question.scope.document.label"
  | "question.scope.document.description"
  | "question.scope.document.impact"
  | "question.scope.data.label"
  | "question.scope.data.description"
  | "question.scope.data.impact"
  | "question.scope.code.label"
  | "question.scope.code.description"
  | "question.scope.code.impact"
  | "question.scope.ai.label"
  | "question.scope.ai.description"
  | "question.scope.ai.impact"
  | "question.free.placeholder"
  | "question.progress.intent"
  | "question.progress.scope"
  | "question.progress.confirm"
  | "question.progress.run"
  | "evidence.useCurrent"
  | "evidence.openFull"
  | "evidence.askFollowup"
  | "evidence.missing"
  | "acceptance.optionFirst"
  | "acceptance.evidenceBound"
  | "proposalDraft.create.label";

const workItemCopy: Record<WorkHubLocale, Record<WorkItemCopyKey, string>> = {
  "zh-CN": {
    "question.confirm.title": "是否按这个方向创建任务？",
    "question.confirm.body": "确认后会按下面的方向创建任务。",
    "question.confirm.create.label": "创建任务",
    "question.confirm.create.description": "确认后，任务会进入可执行状态，AI 可以继续处理。",
    "question.confirm.evidence.label": "先找证据",
    "question.confirm.evidence.description": "先从项目历史、文档和任务里找依据。",
    "question.confirm.adjust.label": "调整范围",
    "question.confirm.adjust.description": "回到上一步补充澄清回答。",
    "question.clarify.title": "需要先确认一个关键点",
    "question.clarify.placeholder": "直接补一句：必须依据的文件、目标读者、输出形式或验收口径。",
    "question.scope.title": "这件事先按哪种交付方式处理？",
    "question.scope.document.label": "文档/方案草稿",
    "question.scope.document.description": "适合周报、方案、说明书、PR 式变更说明。",
    "question.scope.document.impact": "第一阶段只改文件、不动别的东西，风险最低。",
    "question.scope.data.label": "结构化数据",
    "question.scope.data.description": "适合 JSON、YAML、CSV、配置或表格分析。",
    "question.scope.data.impact": "会保留字段级证据和回滚点。",
    "question.scope.code.label": "小型代码/模板",
    "question.scope.code.description": "适合低风险代码片段、模板或配置改动。",
    "question.scope.code.impact": "需要通过快照、测试和审批。",
    "question.scope.ai.label": "让 AI 判断",
    "question.scope.ai.description": "我会按证据和风险选择最稳的交付路径。",
    "question.scope.ai.impact": "不用打字，点选就行。",
    "question.free.placeholder": "有特殊要求再补一句，不填也可以。",
    "question.progress.intent": "任务",
    "question.progress.scope": "澄清",
    "question.progress.confirm": "确认",
    "question.progress.run": "执行",
    "evidence.useCurrent": "用这些证据继续",
    "evidence.openFull": "打开完整检索",
    "evidence.askFollowup": "换个问法再找",
    "evidence.missing": "请先上传文档、同步项目文件，或缩小检索范围。",
    "acceptance.optionFirst": "澄清回答已纳入执行范围",
    "acceptance.evidenceBound": "证据已绑定",
    "proposalDraft.create.label": "生成变更提议"
  },
  "en-US": {
    "question.confirm.title": "Create the task with this direction?",
    "question.confirm.body": "Confirming creates the task with the direction below.",
    "question.confirm.create.label": "Create task",
    "question.confirm.create.description": "After confirmation, the task becomes executable so AI can continue.",
    "question.confirm.evidence.label": "Find evidence first",
    "question.confirm.evidence.description": "Search project history, documents, and related tasks first.",
    "question.confirm.adjust.label": "Adjust scope",
    "question.confirm.adjust.description": "Go back and refine the clarification answer.",
    "question.clarify.title": "One key detail to confirm",
    "question.clarify.placeholder": "Add the required file, audience, output shape, or acceptance criteria.",
    "question.scope.title": "Which delivery path should this use first?",
    "question.scope.document.label": "Document / plan draft",
    "question.scope.document.description": "Best for reports, plans, manuals, and PR-style change notes.",
    "question.scope.document.impact": "Lowest risk: the first stage only touches files, nothing else.",
    "question.scope.data.label": "Structured data",
    "question.scope.data.description": "Best for JSON, YAML, CSV, configuration, or spreadsheet analysis.",
    "question.scope.data.impact": "Keeps field-level evidence and rollback points.",
    "question.scope.code.label": "Small code / template",
    "question.scope.code.description": "Best for low-risk snippets, templates, or configuration changes.",
    "question.scope.code.impact": "Requires snapshots, tests, and approval.",
    "question.scope.ai.label": "Let AI decide",
    "question.scope.ai.description": "AI will choose the most stable delivery path from evidence and risk.",
    "question.scope.ai.impact": "No typing required; just pick options.",
    "question.free.placeholder": "Add special requirements only if needed.",
    "question.progress.intent": "Task",
    "question.progress.scope": "Clarify",
    "question.progress.confirm": "Confirm",
    "question.progress.run": "Run",
    "evidence.useCurrent": "Use this evidence",
    "evidence.openFull": "Open full search",
    "evidence.askFollowup": "Try another query",
    "evidence.missing": "Upload documents, sync project files, or narrow the search first.",
    "acceptance.optionFirst": "Clarification answer is included in the execution scope",
    "acceptance.evidenceBound": "Evidence is bound",
    "proposalDraft.create.label": "Create proposal draft"
  }
};

const generatedAcceptanceCopy = new Map<string, string>([
  ["输出可审阅的文档或方案草稿，包含结构、正文和后续修改点。", "Produce a reviewable document or plan draft with structure, body, and follow-up edit points."],
  ["标明依据、假设和待确认内容，不把未确认内容写成事实。", "Mark evidence, assumptions, and items needing confirmation without presenting unconfirmed content as fact."],
  ["输出结构化文件或表格，包含字段说明、样例和校验方式。", "Produce a structured file or sheet with field notes, samples, and validation method."],
  ["保留数据来源、转换规则和异常项说明。", "Preserve source data, transformation rules, and anomaly notes."],
  ["输出可运行的小型代码或模板，包含入口、使用说明和验证命令。", "Produce runnable small code or a template with entry point, usage notes, and verification command."],
  ["列出改动范围、风险点和回滚方式。", "List change scope, risks, and rollback method."],
  ["根据上下文选择最稳交付形态，并说明选择理由。", "Choose the most stable delivery format from context and explain why."],
  ["输出可审阅结果和后续验收步骤。", "Produce a reviewable result and follow-up acceptance steps."],
  ["点选澄清完成", workItemCopy["en-US"]["acceptance.optionFirst"]],
  ["澄清回答已纳入执行范围", workItemCopy["en-US"]["acceptance.optionFirst"]],
  ["证据已绑定", workItemCopy["en-US"]["acceptance.evidenceBound"]],
  ["澄清以点选为主", "Clarification is done by picking options"],
  ["交付物变更必须逐条可审", "Deliverable changes must be reviewable item by item"],
  ["回放页脚必须显示成本明细", "The replay footer must show cost details"]
]);

function workItemT(locale: WorkHubLocale | undefined, key: WorkItemCopyKey) {
  return workItemCopy[locale ?? "zh-CN"][key];
}

function localizeGeneratedAcceptanceText(value: string, locale: WorkHubLocale | undefined) {
  if (locale !== "en-US") {
    return value;
  }
  return generatedAcceptanceCopy.get(value) ?? value;
}

function localizeGeneratedEvidenceSummary(count: number, locale: WorkHubLocale | undefined) {
  return locale === "en-US"
    ? `Found ${count} usable evidence reference${count === 1 ? "" : "s"}.`
    : `找到了 ${count} 条可引用证据。`;
}

function mergeSelectedOptionIds(...groups: (readonly string[] | undefined)[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const group of groups) {
    for (const id of group ?? []) {
      const trimmed = id.trim();
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed);
        result.push(trimmed);
      }
    }
  }
  return result;
}

function selectedOptionIdsFromLauncherSpec(spec: CuuLauncherWorkItemSpec | undefined) {
  return spec?.selected_options.map((option) => option.id) ?? [];
}

function launcherSpecForSelectedOptions(
  selectedOptionIds: readonly string[],
  payloadSpec: CuuLauncherWorkItemSpec | undefined
) {
  return payloadSpec?.selected_options.length ? payloadSpec : cuuLauncherSpecFromSelectedOptionIds(selectedOptionIds);
}

function planningNoteForSelectedOptions(input: {
  selectedOptionIds: readonly string[];
  launcherSpec?: CuuLauncherWorkItemSpec | undefined;
  clarificationAnswers?: readonly WorkItemClarificationAnswerRow[];
  finalFreeText?: string | undefined;
}) {
  const lines: string[] = [];
  if (input.selectedOptionIds.length) {
    lines.push(`selected_options: ${input.selectedOptionIds.join(",")}`);
  }
  if (input.launcherSpec?.selected_options.length) {
    lines.push(`cuu_launcher_spec: ${JSON.stringify(input.launcherSpec)}`);
  }
  const freeTextAnswers = (input.clarificationAnswers ?? [])
    .map((answer) => compactText(answer.freeText, 500))
    .filter((answer): answer is string => Boolean(answer));
  if (freeTextAnswers.length) {
    lines.push([
      "clarification_answers:",
      ...freeTextAnswers.map((answer) => `- ${answer}`)
    ].join("\n"));
  }
  const finalFreeText = compactText(input.finalFreeText, 500);
  if (finalFreeText) {
    lines.push([
      "final_create_note:",
      `- ${finalFreeText}`
    ].join("\n"));
  }
  return lines.length ? lines.join("\n") : undefined;
}

function acceptanceItemsFromLauncherSpec(spec: CuuLauncherWorkItemSpec | undefined) {
  let sortOrder = 0;
  return (spec?.selected_options ?? []).flatMap((option) => {
    const description = [
      `Cuu launcher option: ${option.label ?? option.id}`,
      `delivery_kind=${option.delivery_kind}`,
      `risk_hint=${option.risk_hint}`
    ].join("; ");
    return option.default_acceptance.map((title) => ({
      title,
      description,
      sortOrder: sortOrder++
    }));
  });
}

function acceptanceItemsFromClarification(locale: WorkHubLocale | undefined) {
  return [
    {
      title: workItemT(locale, "acceptance.optionFirst"),
      description: locale === "en-US"
        ? "The user's clarification answer is carried into the planning note for AI execution."
        : "用户的澄清回答会写入规划备注，供 AI 执行时读取。",
      sortOrder: 0
    },
    {
      title: locale === "en-US" ? "Project files and evidence must be named" : "必须标明使用的项目文件或证据",
      description: locale === "en-US"
        ? "The output should state which project file or evidence source it used."
        : "交付结果需要说明使用了哪份项目文件或证据来源。",
      sortOrder: 1
    }
  ];
}

function titleFromIntent(intentText: string | undefined) {
  const compact = compactText(intentText, 64);
  return compact ?? "待澄清事项";
}

// R10-0c：澄清草稿升级为「选项优先」契约——LLM 给出 2-4 个可点选的具体答案候选（含推荐项），
// 自由文本降级为折叠兜底（page-concepts §Option Cards 的产品承诺）。旧存量草稿无 options，
// 渲染端自动退化为长文本，不炸。
const clarificationOptionSchema = z.object({
  id: z.string().trim().min(1).max(64).optional(),
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().max(200).optional()
});

const clarificationQuestionDraftSchema = z.object({
  title: z.string().trim().min(2).max(160),
  body: z.string().trim().max(900).optional(),
  placeholder: z.string().trim().max(180).optional(),
  options: z.array(clarificationOptionSchema).max(4).optional(),
  recommended_option_id: z.string().trim().min(1).max(64).optional()
});

const CLARIFICATION_LLM_MAX_TOKENS = 1_600;
const CLARIFICATION_LLM_TIMEOUT_MS = 60_000;

function textFromContent(content: unknown[]) {
  return content
    .map((block) => {
      if (typeof block === "string") {
        return block;
      }
      if (block && typeof block === "object") {
        const text = (block as Record<string, unknown>).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .join("\n")
    .trim();
}

function parseJsonObject(text: string) {
  const direct = text.trim();
  const fenced = direct.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1]?.trim();
  const candidate = fenced ?? direct;
  try {
    return JSON.parse(candidate) as unknown;
  } catch (error) {
    if (fenced) {
      throw error;
    }
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1)) as unknown;
    }
    throw error;
  }
}

function invalidClarificationResponseError(locale: WorkHubLocale) {
  return new WorkItemServiceError(
    502,
    "clarification_llm_invalid_response",
    locale === "en-US"
      ? "AI material analysis did not return a valid clarification question."
      : "AI 材料分析没有返回可用的澄清反问。"
  );
}

function clarificationFileContextFailedError(locale: WorkHubLocale, missingFileNames: string[] = []) {
  if (missingFileNames.length > 0) {
    const names = missingFileNames.join(", ");
    return new WorkItemServiceError(
      502,
      "clarification_file_context_failed",
      locale === "en-US"
        ? `WorkHub could not find the named project file(s): ${names}. Upload or sync them before AI asks a material-based clarification question.`
        : `WorkHub 没有在项目网盘里找到你点名的文件：${names}。请先上传或同步文件，再生成基于材料的澄清反问。`
    );
  }
  return new WorkItemServiceError(
    502,
    "clarification_file_context_failed",
    locale === "en-US"
      ? "WorkHub could not read project files, so AI cannot ask a material-based clarification question yet."
      : "WorkHub 无法读取项目文件，暂时不能生成基于材料的澄清反问。"
  );
}

function pickClarificationTextField(raw: unknown, keys: string[]) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const value = raw as Record<string, unknown>;
  for (const key of keys) {
    const text = value[key];
    if (typeof text === "string" && text.trim()) {
      return text;
    }
  }
  return undefined;
}

function clarificationDraftFromRawJson(raw: unknown, locale: WorkHubLocale): ClarificationQuestionDraft {
  const questionText = pickClarificationTextField(raw, [
    "title",
    "question",
    "clarification_question",
    "clarificationQuestion",
    "follow_up",
    "followUp"
  ]);
  const bodyText = pickClarificationTextField(raw, ["body", "context"]);
  const title = compactText(questionText ?? bodyText, 160);
  if (!title) {
    throw invalidClarificationResponseError(locale);
  }
  // R10-0c：选项候选——LLM 返回 options 数组时逐条收口（label 必填、截断、最多 4 条、id 缺省按序补）。
  // 解析失败不整体拒稿：选项是增强，退化为无选项长文本仍是合法草稿。
  const rawOptions = raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>)["options"])
    ? ((raw as Record<string, unknown>)["options"] as unknown[])
    : [];
  const options = rawOptions
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        return undefined;
      }
      const record = entry as Record<string, unknown>;
      const label = compactText(typeof record["label"] === "string" ? record["label"] : undefined, 80);
      if (!label) {
        return undefined;
      }
      const id = compactText(typeof record["id"] === "string" ? record["id"] : undefined, 64) ?? `option-${index + 1}`;
      const description = compactText(typeof record["description"] === "string" ? record["description"] : undefined, 200);
      return { id, label, ...(description ? { description } : {}) };
    })
    .filter((entry): entry is { id: string; label: string; description?: string } => Boolean(entry))
    .slice(0, 4);
  const recommendedRaw = raw && typeof raw === "object" ? (raw as Record<string, unknown>)["recommended_option_id"] : undefined;
  const recommended = compactText(typeof recommendedRaw === "string" ? recommendedRaw : undefined, 64);
  const draft = {
    title,
    body: questionText ? compactText(bodyText, 900) : undefined,
    placeholder: compactText(pickClarificationTextField(raw, ["placeholder"]), 180),
    ...(options.length >= 2 ? { options } : {}),
    ...(options.length >= 2 && recommended && options.some((option) => option.id === recommended) ? { recommended_option_id: recommended } : {})
  };
  const parsed = clarificationQuestionDraftSchema.safeParse(draft);
  if (!parsed.success) {
    throw invalidClarificationResponseError(locale);
  }
  return parsed.data;
}

export function parseClarificationDraftFromLlmText(text: string, locale: WorkHubLocale): ClarificationQuestionDraft {
  let raw: unknown;
  try {
    raw = parseJsonObject(text);
  } catch {
    throw invalidClarificationResponseError(locale);
  }
  return clarificationDraftFromRawJson(raw, locale);
}

function parseClarificationDraftFromResponse(response: { content: unknown[] }, locale: WorkHubLocale) {
  return parseClarificationDraftFromLlmText(textFromContent(response.content), locale);
}

function normalizeClarificationDraft(
  draft: ClarificationQuestionDraft | undefined,
  fallback: ClarificationQuestionDraft
): ClarificationQuestionDraft {
  const parsed = clarificationQuestionDraftSchema.safeParse(draft);
  if (!parsed.success) {
    return fallback;
  }
  const body = compactText(parsed.data.body, 900);
  const placeholder = compactText(parsed.data.placeholder, 180);
  const options = (parsed.data.options ?? []).length >= 2 ? parsed.data.options : undefined;
  const recommended = options && parsed.data.recommended_option_id && options.some((option) => (option.id ?? "") === parsed.data.recommended_option_id)
    ? parsed.data.recommended_option_id
    : undefined;
  return {
    title: parsed.data.title,
    ...(body ? { body } : {}),
    ...(placeholder ? { placeholder } : {}),
    ...(options ? { options } : {}),
    ...(recommended ? { recommended_option_id: recommended } : {})
  };
}

function draftFromStoredClarificationQuestion(row: { contentJson: unknown } | null | undefined) {
  if (!row) {
    return undefined;
  }
  const parsed = clarificationQuestionDraftSchema.safeParse(row.contentJson);
  return parsed.success ? parsed.data : undefined;
}

function driveItemPath(item: DriveItemRow, itemsById: Map<string, DriveItemRow>) {
  const names = [item.name];
  let cursor = item.parentId ? itemsById.get(item.parentId) : undefined;
  for (let depth = 0; cursor && depth < 12; depth += 1) {
    names.push(cursor.name);
    cursor = cursor.parentId ? itemsById.get(cursor.parentId) : undefined;
  }
  return names.reverse().join("/");
}

function isTextLikeDriveVersion(version: DriveVersionRow) {
  const mime = version.mime?.toLowerCase() ?? "";
  const lower = version.filename.toLowerCase();
  return mime.startsWith("text/")
    || mime.includes("json")
    || mime.includes("markdown")
    || /\.(txt|md|markdown|json|csv|tsv|yaml|yml|xml)$/u.test(lower);
}

async function previewForDriveVersion(version: DriveVersionRow) {
  const embedded = compactText(version.parsedText, 700);
  if (embedded) {
    return embedded;
  }
  const previewPath = version.parsedTextPath ?? (isTextLikeDriveVersion(version) && version.sizeBytes <= 64 * 1024 ? version.storagePath : undefined);
  if (!previewPath) {
    return undefined;
  }
  try {
    return compactText(await readFile(previewPath, "utf8"), 700);
  } catch {
    return undefined;
  }
}

function currentVersionForItem(item: DriveItemRow, versions: DriveVersionRow[]) {
  return versions.find((version) => version.itemId === item.id && version.id === item.currentVersionId)
    ?? versions.find((version) => version.itemId === item.id);
}

function driveFileRelevanceScore(input: { item: DriveItemRow; path: string; intentText: string | undefined }) {
  const intent = input.intentText?.toLowerCase() ?? "";
  if (!intent) {
    return 0;
  }
  const name = input.item.name.toLowerCase();
  const path = input.path.toLowerCase();
  if (intent.includes(path)) {
    return 120;
  }
  if (intent.includes(name)) {
    return 100;
  }
  return name
    .split(/[^\p{Letter}\p{Number}_\-.]+/u)
    .filter((token) => token.length >= 4)
    .reduce((score, token) => score + (intent.includes(token) ? 10 : 0), 0);
}

// R9 批次0-2：只认「明确像文件名」的提及——扩展名必须在白名单里。
// 旧正则把版本号(v1.2)、小数(3.14)、域名(example.com)、技术词全当点名文件，
// 找不到就 502 阻断 intake 并连带 cancel 工单（r9 审查 services-b-1/ux-web-projects-1）。
const DRIVE_TARGET_FILE_EXTENSIONS = new Set([
  "txt", "md", "markdown", "json", "csv", "tsv", "yaml", "yml", "xml",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx", "pdf", "rtf",
  "png", "jpg", "jpeg", "gif", "svg", "webp",
  "mp3", "mp4", "mov", "wav", "zip", "tar", "gz", "7z",
  "ts", "tsx", "js", "jsx", "mjs", "py", "rs", "go", "java", "rb", "html", "css", "scss", "sql", "sh"
]);

export function driveTargetFileNamesFromIntent(intentText: string | undefined): string[] {
  if (!intentText) {
    return [];
  }
  const names = new Set<string>();
  // URL 不是点名文件：先把整段链接（含路径）从意图文本剥掉，再做文件名匹配。
  const withoutUrls = intentText.replace(/(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s"'“”‘’<>，。；;！？]*/giu, " ");
  for (const match of withoutUrls.matchAll(/[^\s"'“”‘’<>，。；;：:!?？]+?\.([A-Za-z][A-Za-z0-9]{0,15})/gu)) {
    const raw = match[0]?.replace(/[),，。；;：:!?？]+$/u, "");
    if (!raw) {
      continue;
    }
    const name = raw.split(/[\\/]/u).pop()?.trim();
    const extension = name?.split(".").pop()?.toLowerCase();
    if (!name || !extension || !DRIVE_TARGET_FILE_EXTENSIONS.has(extension)) {
      continue;
    }
    // 扩展名前必须真有主名（`.md` 单独出现不算），且主名不能是纯标点。
    const stem = name.slice(0, name.length - extension.length - 1);
    if (stem.length === 0 || !/[\p{Letter}\p{Number}]/u.test(stem)) {
      continue;
    }
    if (name.length <= 160) {
      names.add(name);
    }
  }
  return [...names].slice(0, 8);
}

function driveContextMatchesTarget(file: ClarificationFileContext, targetFileName: string) {
  const target = targetFileName.toLowerCase();
  const pathName = file.path.split(/[\\/]/u).pop()?.toLowerCase();
  return file.name.toLowerCase() === target || pathName === target;
}

function missingDriveTargetFileNames(input: { intentText: string | undefined; files: ClarificationFileContext[] }) {
  const targets = driveTargetFileNamesFromIntent(input.intentText);
  return targets.filter((target) => !input.files.some((file) => driveContextMatchesTarget(file, target)));
}

export async function fileContextFromDriveRows(rows: DrivePageRows, intentText: string | undefined): Promise<ClarificationFileContext[]> {
  const itemsById = new Map(rows.items.map((item) => [item.id, item]));
  const namedTargets = driveTargetFileNamesFromIntent(intentText);
  // R10-0c（P1-1 根因）：用户没点名文件且与当前意图零相关（score=0）的旧项目文件，不再送进澄清
  // 上下文——此前相关性全 0 时按原始顺序取前 12 个旧文件，LLM 会拿它们把全新任务带偏成历史任务。
  // 点名的文件（namedTargets）始终保留；一个相关文件都没有时宁可空上下文，让反问只围绕用户意图。
  const fileItems = rows.items
    .filter((item) => item.kind === "file")
    .map((item, index) => {
      const path = driveItemPath(item, itemsById);
      return {
        item,
        index,
        path,
        score: driveFileRelevanceScore({ item, path, intentText }),
        named: namedTargets.some((target) => {
          const pathName = path.split(/[\\/]/u).pop()?.toLowerCase();
          return item.name.toLowerCase() === target.toLowerCase() || pathName === target.toLowerCase();
        })
      };
    })
    .filter((entry) => entry.named || entry.score > 0)
    .sort((left, right) => {
      const byRelevance = (right.named ? 1000 : right.score) - (left.named ? 1000 : left.score);
      return byRelevance || left.index - right.index;
    })
    .slice(0, 12);
  const contexts: ClarificationFileContext[] = [];
  for (const { item, path } of fileItems) {
    const version = currentVersionForItem(item, rows.versions);
    contexts.push({
      name: item.name,
      path,
      ...(version?.mime ? { mime: version.mime } : {}),
      ...(version?.sizeBytes !== undefined ? { sizeBytes: version.sizeBytes } : {}),
      ...(version ? { preview: await previewForDriveVersion(version) } : {})
    });
  }
  return contexts;
}

async function defaultProjectFileContext(input: { projectId: string; intentText: string | undefined }) {
  const drive = createDriveRepository(getSharedDatabaseClient().db);
  const rows = await drive.readPage({
    projectId: input.projectId,
    limit: 200,
    includeDeleted: false,
    operationLimit: 1,
    targetFileNames: driveTargetFileNamesFromIntent(input.intentText)
  });
  return fileContextFromDriveRows(rows, input.intentText);
}

function fallbackClarificationDraft(input: ClarificationQuestionInput): ClarificationQuestionDraft {
  const zh = input.locale !== "en-US";
  const intent = compactText(input.workItem.rawDescription ?? input.workItem.title, 220);
  const topic = compactText(input.workItem.rawDescription ?? input.workItem.title, 48)?.replace(/[。.!！?？,，;；:：]+$/u, "");
  const fileSummary = input.files.length
    ? input.files
      .slice(0, 5)
      .map((file) => {
        const size = file.sizeBytes !== undefined ? `, ${file.sizeBytes} B` : "";
        const preview = file.preview ? `：${compactText(file.preview, 120)}` : "";
        return `${file.path}${size}${preview}`;
      })
      .join("；")
    : "";
  if (zh) {
    return {
      title: input.files.length
        ? "需要确认：这次应以哪份项目文件和哪条验收口径为准？"
        : topic
          ? `请确认“${topic}”的验收口径`
          : "请确认这次任务的验收口径",
      body: [
        intent ? `需求：${intent}` : undefined,
        fileSummary ? `我已看到项目文件：${fileSummary}` : "我还没有看到可引用的项目文件，会先按你的需求补齐关键约束。",
        "请补一句最关键的约束，AI 会把它带进后续执行。"
      ].filter(Boolean).join("\n"),
      placeholder: workItemT(input.locale, "question.clarify.placeholder")
    };
  }
  return {
    title: input.files.length
      ? "Confirm the source file and acceptance rule for this task"
      : topic
        ? `Confirm the acceptance rule for "${topic}"`
        : "Confirm the acceptance rule for this task",
    body: [
      intent ? `Request: ${intent}` : undefined,
      fileSummary ? `Project files found: ${fileSummary}` : "No usable project file is visible yet; clarify the key constraint for the AI before execution.",
      "Add the one constraint the AI must carry into the work."
    ].filter(Boolean).join("\n"),
    placeholder: workItemT(input.locale, "question.clarify.placeholder")
  };
}

function clarificationPrompt(input: ClarificationQuestionInput) {
  const zh = input.locale !== "en-US";
  const intent = input.workItem.rawDescription ?? input.workItem.title ?? "";
  const files = input.files.length
    ? input.files.map((file, index) => [
        `${index + 1}. ${file.path}`,
        file.mime ? `mime=${file.mime}` : undefined,
        file.sizeBytes !== undefined ? `size=${file.sizeBytes}` : undefined,
        file.preview ? `preview=${file.preview}` : undefined
      ].filter(Boolean).join("\n   ")).join("\n")
    : "No project files are currently visible.";
  return [
    zh
      ? "请根据用户需求和项目文件，生成一个真正需要用户补充的澄清反问。"
      : "Generate one useful clarification question from the user's request and project files.",
    "Return strict JSON only:",
    `{"title":"...","body":"...","placeholder":"...","options":[{"id":"option-1","label":"...","description":"..."}],"recommended_option_id":"option-1"}`,
    zh
      ? "规则：只问一个问题；不要问预设交付方式；不要使用“需要确认一个关键点”这类泛化标题；反问必须引用用户需求或项目文件中的具体信息；优先围绕文件依据、验收口径、目标读者、缺失输入；如果信息足够，就让用户确认你将采用的文件和假设；使用中文。"
      : "Rules: ask exactly one question; do not ask for a preset delivery type; do not use generic titles like 'One key detail to confirm'; the question must reference concrete information from the user request or project files; prioritize source file, acceptance criteria, audience, or missing input; if enough information exists, ask the user to confirm the file and assumptions; use English.",
    zh
      ? "options 规则：给出 2-4 个针对这个问题的具体候选答案（不是交付类型），每条 label ≤ 20 字、description 一句话说明影响；把最合理的一条设为 recommended_option_id。候选必须来自用户需求或文件里的真实信息，凑不出 2 条有区分度的就返回空数组。"
      : "Options rules: provide 2-4 concrete candidate answers to this exact question (not delivery types); label ≤ 8 words, description one sentence on the consequence; set recommended_option_id to the most sensible one. Candidates must come from real information in the request or files — return an empty array if you cannot form 2 distinct ones.",
    "",
    `Request:\n${intent}`,
    "",
    `Project files:\n${files}`
  ].join("\n");
}

function clarificationDraftLooksTemplated(draft: ClarificationQuestionDraft, input: ClarificationQuestionInput) {
  const combined = `${draft.title}\n${draft.body ?? ""}`.toLowerCase();
  if (
    /需要先确认一个关键点|one key detail to confirm/u.test(combined)
    || /这件事先按(?:哪种|什么)?交付(?:方式|方向)处理/u.test(combined)
    || /which delivery path should this use first/u.test(combined)
  ) {
    return true;
  }
  const presetBuckets = [
    /文档\/方案|document\s*\/\s*plan/u,
    /结构化数据|structured data/u,
    /小型代码|small code/u
  ].filter((pattern) => pattern.test(combined)).length;
  if (presetBuckets >= 2) {
    return true;
  }
  const fileMatched = input.files.some((file) =>
    [file.name, file.path]
      .filter(Boolean)
      .some((value) => combined.includes(value.toLowerCase()))
  );
  const intentTokens = (input.workItem.rawDescription ?? input.workItem.title ?? "")
    .split(/[^\p{Letter}\p{Number}_\-.]+/u)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 4)
    // E2E-07：CJK 文本没有词边界，整段「写一份团队周会纪要模板」是一个长 token，反问只要稍作转述
    // （如「周会纪要」）就永不命中 → 真实问题被误判 templated 502。长 CJK token 追加 4 字滑窗 n-gram。
    .flatMap((token) => {
      if (token.length <= 8 || !/[\p{Script=Han}]/u.test(token)) {
        return [token];
      }
      const grams: string[] = [token];
      for (let i = 0; i + 4 <= token.length; i += 2) {
        grams.push(token.slice(i, i + 4));
      }
      return grams;
    })
    .slice(0, 48);
  const intentMatched = intentTokens.some((token) => combined.includes(token));
  return input.files.length > 0 ? !fileMatched && !intentMatched : !intentMatched;
}

function clarificationDraftCoversNamedDriveTargets(draft: ClarificationQuestionDraft, intentText: string | undefined) {
  const targets = driveTargetFileNamesFromIntent(intentText);
  if (targets.length === 0) {
    return true;
  }
  const combined = `${draft.title}\n${draft.body ?? ""}`.toLowerCase();
  return targets.every((target) => combined.includes(target.toLowerCase()));
}

// CHAT-1：读路径拿不到可用已存草稿时的统一出口——草稿生成已收敛到 createSession（含带
// work_item_id 的显式重试），GET 不再现场生成。文案里把「怎么重试」说清楚，前端会话页
// 会把它原样渲进状态卡（apps/web routes.ts intake 分支对 clarification_draft_missing 有定制）。
function clarificationDraftMissingError(locale: WorkHubLocale): WorkItemServiceError {
  return new WorkItemServiceError(
    409,
    "clarification_draft_missing",
    locale === "en-US"
      ? "The clarification question for this session is missing or out of date. Retry generating it by restarting intake for this work item."
      : "这个会话的澄清反问还没生成或已失效。请重新进入该事项的接入流程，重试生成澄清反问。"
  );
}

function canReuseStoredClarificationDraft(
  draft: ClarificationQuestionDraft,
  input: ClarificationQuestionInput
) {
  const intentText = input.workItem.rawDescription ?? input.workItem.title ?? undefined;
  return !clarificationDraftLooksTemplated(draft, input)
    && clarificationDraftCoversNamedDriveTargets(draft, intentText);
}

// R9 批次0-2：删除 assertGeneratedClarificationDraftIsGrounded——
// 「草稿必须逐字包含每个点名文件名」是伪 grounding：LLM 正常改写（换称呼/概括）就 502，
// 文件明明已找到并喂给了模型（r9 审查 services-b-2）。覆盖度只用于复用判定的启发式。

function createLlmClarificationGenerator(registry: ProviderRegistry): ClarificationQuestionGenerator {
  return async (input) => {
    if (!registry.isConfigured()) {
      throw new WorkItemServiceError(
        503,
        "clarification_llm_unavailable",
        input.locale === "en-US"
          ? "AI material analysis is not configured, so WorkHub cannot generate a real clarification question."
          : "AI 材料分析尚未配置，WorkHub 无法生成真实澄清反问。"
      );
    }
    const client = registry.get({
      id: input.actor.userId ?? input.actor.id,
      label: "workhub-intake-clarifier",
      userId: input.actor.userId ?? input.actor.id,
      ...(input.actor.workspaceId ? { workspaceId: input.actor.workspaceId } : {}),
      workItemId: input.workItem.id
    }, "clarify");
    const request = (extraInstruction?: string) => client.messages.create({
      maxTokens: CLARIFICATION_LLM_MAX_TOKENS,
      source: "agent_step",
      timeoutMs: CLARIFICATION_LLM_TIMEOUT_MS,
      // E2E-03：thinking 模型的思维链计入 max_tokens，1600 的短预算会被吃光导致正文从未生成（实测
      // 同 prompt 思维链 485~2855 tokens 波动）→ 短 JSON 调用显式关闭 thinking。
      disableThinking: true,
      system: "You are WorkHub's intake clarifier. Return strict JSON only. Never include secrets or unrelated implementation advice.",
      messages: [{
        role: "user",
        // E2E-01：重试时在 prompt 末尾追加「只返回合法 JSON」强调，不改变原 prompt 结构。
        content: extraInstruction ? `${clarificationPrompt(input)}\n\n${extraInstruction}` : clarificationPrompt(input)
      }]
    });
    const parseAndCheck = (response: { content: unknown[] }) => {
      const draft = parseClarificationDraftFromResponse(response, input.locale);
      if (clarificationDraftLooksTemplated(draft, input)) {
        throw new WorkItemServiceError(
          502,
          "clarification_llm_templated_response",
          input.locale === "en-US"
            ? "AI material analysis returned a generic template instead of a real follow-up question."
            : "AI 材料分析返回了泛化模板，不是真实反问。"
        );
      }
      return draft;
    };
    try {
      return parseAndCheck(await request());
    } catch (error) {
      // E2E-01：只有「输出解析失败」(clarification_llm_invalid_response) 值得原样重试一次——
      // 模型偶发输出围栏/多余文本是瞬态错误；泛化模板拒稿、超时、配额等重试也不会改变结论，不重试。
      if (!(error instanceof WorkItemServiceError) || error.code !== "clarification_llm_invalid_response") {
        throw error;
      }
      const retryInstruction = input.locale === "en-US"
        ? "Important: return exactly one valid JSON object and nothing else — no prose, no markdown fences."
        : "注意：只返回一个合法 JSON 对象，不要输出任何解释文字或 Markdown 代码围栏。";
      return parseAndCheck(await request(retryInstruction));
    }
  };
}

// 把已加载的 detail 行摊平成 @workhub/permissions 的 WorkItemAccessRecord——
// readWorkItemDetail 已 join 出项目的 workspace/archived/deletedAt，故无需再多查一次。
function detailToWorkItemAccessRecord(rows: StoredWorkItemDetailRows) {
  return {
    id: rows.workItem.id,
    status: rows.workItem.status,
    submitterUserId: rows.workItem.submitterUserId,
    claimedByUserId: rows.workItem.claimedByUserId,
    workspaceId: rows.workItem.workspaceId,
    project: {
      archived: rows.projectArchived,
      deletedAt: rows.projectDeletedAt,
      ownerUserId: rows.projectOwnerUserId,
      workspaceId: rows.projectWorkspaceId
    },
    assignments: rows.assignments
  };
}

// routes-a-2/routes-b-1/services-a-2/xlink-authz-4/ux-web-govern-6：assertCanReadDetail 的判定谓词抽出成
// 一个只依赖「摊平后的可见性记录」的纯函数，让批量的轻量判定（canReadWorkItemAccessRow，走 findWorkItemAccessRecords
// 而非整页 readWorkItemDetail）能复用同一套口径——两条路径（detailPage 的 403 抛出 vs 审批中心的批量 boolean）
// 必须是同一个判定，否则会出现「detailPage 说能看，审批中心过滤说不能看」的不一致，或反过来放宽可见性。
function canReadWorkItemAccessRow(
  row: {
    status: StoredWorkItemDetailRows["workItem"]["status"];
    submitterUserId: string;
    claimedByUserId: string | null;
    workspaceId: string | null;
    project: { archived: boolean | null; deletedAt: Date | null; ownerUserId: string | null; workspaceId: string | null } | null;
    assignments: Array<{ userId: string; role: string }>;
  },
  actor: AuthActor
): boolean {
  const userId = actor.userId ?? actor.id;
  const allowed = canViewWorkItemRecord(
    {
      id: "" /* unused by canViewWorkItemRecord */,
      status: row.status,
      submitterUserId: row.submitterUserId,
      claimedByUserId: row.claimedByUserId,
      workspaceId: row.workspaceId,
      ...(row.project ? { project: row.project } : {}),
      assignments: row.assignments
    },
    { id: userId, isAdmin: actor.isAdmin },
    // 仅按 workspace 作用域（workspace = 硬租户边界）。**不传 orgId**：work_items/projects 无 orgId 列，
    // 记录侧 orgId 恒为 undefined，而 scopeMatches 在「scope.orgId 有值、记录 orgId 为空」时判否——
    // 真 PG 下 actor.orgId 是默认 org 实值，会把所有合法读误判成 403（r1-pg-smoke 撞红）。workspace 已是真边界。
    { workspaceId: actor.workspaceId }
  );
  // Read-only claimer continuity survives project archival; mutation paths still require an active project.
  const claimedByActorInScope = row.claimedByUserId === userId
    && row.project?.deletedAt == null
    && (
      !actor.workspaceId
      || actor.workspaceId === row.workspaceId
      || actor.workspaceId === row.project?.workspaceId
    );
  return allowed || claimedByActorInScope;
}

// A2 同源收口（读路径）：旧的 ad-hoc 判定只看 submitter/claimer/owner，忽略 workspace 归属——
// admin 可越租户读全组织工作项，与权限契约漂移。改用读路径同款 canViewWorkItemRecord，
// 传 actor 的 {orgId, workspaceId} 作用域；单租户下 actor 与工作项同属默认 workspace，故对旧放行的用例仍放行。
// 认领人（claimedByUserId）此前可读 spec_ready 私有态，canViewWorkItemRecord 不查认领字段，保留显式短路防回归。
function assertCanReadDetail(rows: StoredWorkItemDetailRows, actor: AuthActor) {
  const allowed = canReadWorkItemAccessRow(detailToWorkItemAccessRecord(rows), actor);
  if (!allowed) {
    throw new WorkItemServiceError(403, "forbidden", "你没有权限查看这个事项。");
  }
}

function canMutateWorkItem(rows: StoredWorkItemDetailRows, actor: AuthActor) {
  const userId = actor.userId ?? actor.id;
  const inWorkspace = !actor.workspaceId
    || actor.workspaceId === rows.workItem.workspaceId
    || actor.workspaceId === rows.projectWorkspaceId;
  const projectActive = !rows.projectArchived && rows.projectDeletedAt == null;
  const canWorkAssignment = rows.assignments.some(
    (assignment) => assignment.userId === userId && (ASSIGNMENT_ROLES as readonly string[]).includes(assignment.role)
  );
  const ownsOrWorksItem = rows.projectOwnerUserId === userId
    || rows.workItem.submitterUserId === userId
    || rows.workItem.claimedByUserId === userId
    || canWorkAssignment;
  return projectActive && inWorkspace && (actor.isAdmin || ownsOrWorksItem);
}

function assertCanMutateWorkItemRows(rows: StoredWorkItemDetailRows, actor: AuthActor) {
  if (canMutateWorkItem(rows, actor)) {
    return;
  }
  throw new WorkItemServiceError(403, "forbidden", "你没有权限修改这个事项。");
}

function assertCanMutateWorkItemArtifacts(rows: StoredWorkItemDetailRows, actor: AuthActor) {
  if (canMutateWorkItem(rows, actor)) {
    return;
  }
  throw new WorkItemServiceError(403, "forbidden", "你没有权限修改这个事项的正式交付物。");
}

function toWorkItemVm(row: WorkItemRow): WorkItem {
  const workItem: WorkItem = {
    id: row.id,
    code: row.code,
    project_id: row.projectId,
    submitter_user_id: row.submitterUserId,
    status: row.status,
    // L#59：DB 是 varchar，遇到非枚举的历史值退化为 normal，而不是让整条 VM 校验失败。
    priority: workItemPrioritySchema.catch("normal").parse(row.priority),
    sync_state: row.syncState as WorkItem["sync_state"],
    version: row.version,
    mode: row.mode,
    human_reserved: row.humanReserved,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString()
  };
  if (row.workspaceId) workItem.workspace_id = row.workspaceId;
  if (row.claimedByUserId) workItem.claimed_by_user_id = row.claimedByUserId;
  if (row.claimedByNickname) workItem.claimed_by_nickname = row.claimedByNickname;
  if (row.title) workItem.title = row.title;
  if (row.rawDescription) workItem.raw_description = row.rawDescription;
  if (row.summaryMd) workItem.summary_md = row.summaryMd;
  if (row.estimateHours !== null) workItem.estimate_hours = row.estimateHours;
  if (row.estimateConfidence) workItem.estimate_confidence = row.estimateConfidence;
  if (row.planningNote) workItem.planning_note = row.planningNote;
  if (row.startAt) workItem.start_at = row.startAt.toISOString();
  if (row.dueAt) workItem.due_at = row.dueAt.toISOString();
  if (row.sourceMeetingId) workItem.source_meeting_id = row.sourceMeetingId;
  if (row.sourceWorkItemId) workItem.source_work_item_id = row.sourceWorkItemId;
  if (row.claimedAt) workItem.claimed_at = row.claimedAt.toISOString();
  if (row.doneAt) workItem.done_at = row.doneAt.toISOString();
  if (row.deliveredAt) workItem.delivered_at = row.deliveredAt.toISOString();
  if (row.deliveryDocReadyAt) workItem.delivery_doc_ready_at = row.deliveryDocReadyAt.toISOString();
  if (row.acceptedAt) workItem.accepted_at = row.acceptedAt.toISOString();
  if (row.currentSpecId) workItem.current_spec_id = row.currentSpecId;
  if (row.mainBranchId) workItem.main_branch_id = row.mainBranchId;
  if (row.latestConfidenceId) workItem.latest_confidence_id = row.latestConfidenceId;
  if (row.deletedAt) workItem.deleted_at = row.deletedAt.toISOString();
  if (row.deletedByUserId) workItem.deleted_by_user_id = row.deletedByUserId;
  return workItem;
}

function toAgentStepVm(row: WorkItemAgentStepRow): AgentStep {
  const step: AgentStep = {
    id: row.id,
    agent_run_id: row.agentRunId,
    step_no: row.stepNo,
    phase: row.phase as AgentStep["phase"],
    input_json: row.inputJson,
    created_at: row.createdAt.toISOString()
  };
  if (row.toolName) step.tool_name = row.toolName;
  if (row.outputExcerpt) step.output_excerpt = row.outputExcerpt;
  if (row.controlSignal) step.control_signal = row.controlSignal as AgentStep["control_signal"];
  if (row.snapshotId) step.snapshot_id = row.snapshotId;
  return step;
}

function evidenceSourceType(raw: string): EvidenceRef["source_type"] {
  if (allowedEvidenceSourceTypes.has(raw as EvidenceRef["source_type"])) {
    return raw as EvidenceRef["source_type"];
  }
  if (raw === "drive" || raw === "file" || raw === "document") {
    return "drive_file";
  }
  return "external_url";
}

function safeEvidenceHref(value: string): string | undefined {
  if (value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

function evidenceRefFromDocument(row: WorkItemKnowledgeDocumentRow): EvidenceRef {
  const ref: EvidenceRef = {
    id: row.id,
    source_type: evidenceSourceType(row.sourceType),
    source_id: row.sourceId,
    title: row.title,
    locator: { path: row.corpusPath },
    confidence_hint: "found"
  };
  const href = safeEvidenceHref(row.sourceUrl);
  if (href) {
    ref.href = href;
  }
  return ref;
}

function evidenceRefFromWorkItem(row: WorkItemRow): EvidenceRef {
  const ref: EvidenceRef = {
    id: row.id,
    source_type: "work_item",
    source_id: row.code,
    title: row.title ?? row.code,
    confidence_hint: "found",
    // R10-P1-3：证据出处要打开产品页，不是 JSON Page VM——web SPA 按 /workitems/:id 导航，
    // 桌面 Spotlight 也按同一形状正则解析做内联 morph（dashboards.ts data-know-ref 分支）。
    href: `/workitems/${row.id}`
  };
  const excerpt = compactText(row.summaryMd ?? row.rawDescription);
  if (excerpt) {
    ref.excerpt = excerpt;
  }
  return ref;
}

type KnowledgeWorkItemProject = {
  ownerUserId?: string | null;
  workspaceId?: string | null;
  archived?: boolean | null;
  deletedAt?: Date | string | null;
};

function canViewKnowledgeWorkItem(row: WorkItemKnowledgeSearchWorkItemRow, actor: AuthActor, project?: KnowledgeWorkItemProject) {
  return canViewWorkItemRecord(
    {
      id: row.id,
      status: row.status,
      submitterUserId: row.submitterUserId,
      claimedByUserId: row.claimedByUserId,
      workspaceId: row.workspaceId,
      assignments: row.assignments,
      ...(project
        ? {
            project: {
              archived: project.archived ?? false,
              deletedAt: project.deletedAt ?? null,
              ownerUserId: project.ownerUserId ?? null,
              workspaceId: project.workspaceId ?? row.workspaceId
            }
          }
        : {})
    },
    { id: actor.userId ?? actor.id, isAdmin: actor.isAdmin },
    { workspaceId: actor.workspaceId }
  );
}

function evidenceRefsFromBindings(rows: StoredWorkItemDetailRows["evidenceBindings"]) {
  const refs: EvidenceRef[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const rawRefs = row.contentJson.evidence_refs;
    if (!Array.isArray(rawRefs)) {
      continue;
    }
    for (const rawRef of rawRefs) {
      const parsed = evidenceRefSchema.safeParse(rawRef);
      if (parsed.success && !seen.has(parsed.data.id)) {
        refs.push(parsed.data);
        seen.add(parsed.data.id);
      }
    }
  }
  return refs;
}

function taskPlanToVm(rows: TaskPlanWithItems | null | undefined): TaskPlanVM | undefined {
  if (!rows) {
    return undefined;
  }
  return parseOutputContract(taskPlanVmSchema, {
    id: rows.plan.id,
    work_item_id: rows.plan.workItemId,
    workspace_id: rows.plan.workspaceId,
    status: rows.plan.status,
    objective_id: rows.plan.objectiveId,
    budget_json: rows.plan.budgetJson,
    decomposition_context_json: rows.plan.decompositionContextJson,
    created_by: rows.plan.createdByUserId,
    created_at: rows.plan.createdAt.toISOString(),
    updated_at: rows.plan.updatedAt.toISOString(),
    items: rows.items.map((item) => ({
      id: item.id,
      plan_id: item.planId,
      parent_item_id: item.parentItemId,
      seq: item.seq,
      title: item.title,
      role: item.role,
      objective_md: item.objectiveMd,
      acceptance_md: item.acceptanceMd,
      budget_share_pct: item.budgetSharePct,
      depends_on: item.dependsOn,
      status: item.status,
      created_at: item.createdAt.toISOString(),
      updated_at: item.updatedAt.toISOString()
    })),
    items_capped: rows.itemsCapped
  }, "work-item.task-plan");
}

type TaskPlanRunForTeam = NonNullable<TaskPlanWithItems["runs"]>[number];

function parseCostCny(value: string | null | undefined) {
  if (!value) {
    return 0;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatCostCny(value: number) {
  return value.toFixed(6);
}

function costBudgetFromPlan(rows: TaskPlanWithItems) {
  const value = rows.plan.budgetJson["max_cost_cny"];
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return formatCostCny(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? formatCostCny(parsed) : undefined;
  }
  return undefined;
}

function latestRunByTaskPlanItem(runs: TaskPlanRunForTeam[]) {
  const result = new Map<string, TaskPlanRunForTeam>();
  for (const run of runs) {
    if (run.taskPlanItemId) {
      result.set(run.taskPlanItemId, run);
    }
  }
  return result;
}

function agentTeamItemStatus(
  item: TaskPlanWithItems["items"][number],
  run: TaskPlanRunForTeam | undefined
): WorkItemAgentTeamVM["items"][number]["status"] {
  if (run?.status === "escalated") {
    return "needs_human";
  }
  if (run?.status === "queued" || run?.status === "running") {
    return "dispatched";
  }
  if (run?.status === "succeeded") {
    return "succeeded";
  }
  if (run?.status === "failed" || run?.status === "cancelled") {
    return "failed";
  }
  if (item.status === "dispatched") {
    return "dispatched";
  }
  if (item.status === "succeeded" || item.status === "failed" || item.status === "skipped") {
    return item.status;
  }
  return "pending";
}

function taskPlanAgentTeamToVm(
  rows: TaskPlanWithItems | null | undefined,
  locale: WorkHubLocale = "zh-CN"
): WorkItemAgentTeamVM | undefined {
  if (!rows) {
    return undefined;
  }
  const runs = (rows.runs ?? []).filter((run) =>
    run.workspaceId === rows.plan.workspaceId
    && run.workItemId === rows.plan.workItemId
    && run.taskPlanId === rows.plan.id
  );
  const latestByItem = latestRunByTaskPlanItem(runs);
  const displaySeqByItemId = new Map(rows.items.map((item, index) => [item.id, index + 1]));
  const completedCount = rows.items.filter((item) => item.status === "succeeded").length;
  const costUsed = runs.reduce((sum, run) => sum + parseCostCny(run.costEstimate), 0);
  const costBudget = costBudgetFromPlan(rows);
  const costBudgetNumber = costBudget ? Number.parseFloat(costBudget) : undefined;
  const costBurnPct = costBudgetNumber && costBudgetNumber > 0
    ? Math.round((costUsed / costBudgetNumber) * 100)
    : undefined;
  const viewLabel = locale === "zh-CN" ? "看产出" : "View output";
  const decideLabel = locale === "zh-CN" ? "去决策" : "Decide";
  // B-R9.6 §3.1：暂停/恢复派发控制。dispatching/approved 可暂停，paused 可恢复，终态无控制。
  const dispatchControl = rows.plan.status === "dispatching" || rows.plan.status === "approved"
    ? {
      kind: "pause" as const,
      label: locale === "zh-CN" ? "暂停派发" : "Pause dispatch",
      href: `/api/task-plans/${rows.plan.id}/pause`,
      method: "POST" as const
    }
    : rows.plan.status === "paused"
      ? {
        kind: "resume" as const,
        label: locale === "zh-CN" ? "恢复派发" : "Resume dispatch",
        href: `/api/task-plans/${rows.plan.id}/resume`,
        method: "POST" as const
      }
      : undefined;

  return parseOutputContract(workItemAgentTeamVmSchema, {
    plan_id: rows.plan.id,
    status: rows.plan.status,
    completed_count: completedCount,
    total_count: rows.items.length,
    cost_used_cny: formatCostCny(costUsed),
    ...(costBudget ? { cost_budget_cny: costBudget } : {}),
    ...(costBurnPct !== undefined ? { cost_burn_pct: costBurnPct } : {}),
    runs_capped: rows.runsCapped ?? false,
    ...(dispatchControl ? { dispatch_control: dispatchControl } : {}),
    items: rows.items.map((item, index) => {
      const displaySeq = index + 1;
      const run = latestByItem.get(item.id);
      const status = agentTeamItemStatus(item, run);
      const replayHref = run ? `/agent-runs/${run.id}/replay` : undefined;
      const decisionHref = status === "needs_human" || status === "failed" ? "/attention" : undefined;
      const waitingForSeq = item.dependsOn
        .filter((id) => {
          const dependency = rows.items.find((candidate) => candidate.id === id);
          return dependency && dependency.status !== "succeeded";
        })
        .map((id) => displaySeqByItemId.get(id))
        .filter((seq): seq is number => Boolean(seq));
      return {
        task_plan_item_id: item.id,
        seq: displaySeq,
        title: item.title,
        role: item.role,
        plan_status: item.status,
        status,
        budget_share_pct: item.budgetSharePct,
        depends_on: item.dependsOn,
        waiting_for_seq: waitingForSeq,
        ...(run?.costEstimate ? { cost_estimate_cny: run.costEstimate } : {}),
        ...(run ? {
          run_id: run.id,
          run_workspace_id: run.workspaceId,
          ...(run.parentRunId ? { parent_run_id: run.parentRunId } : {}),
          run_status: run.status,
          replay_href: replayHref
        } : {}),
        ...(decisionHref ? { decision_href: decisionHref } : {}),
        ...(status === "succeeded" && replayHref
          ? { action: { kind: "view_output" as const, label: viewLabel, href: replayHref } }
          : decisionHref
            ? { action: { kind: "decide" as const, label: decideLabel, href: decisionHref } }
            : {})
      };
    })
  }, "work-item.agent-team");
}

function buildWorkItemDetail(
  rows: StoredWorkItemDetailRows,
  locale: WorkHubLocale = "zh-CN",
  options: {
    includeAcceptedDeliverableRestore?: boolean;
    includeSourceProposalDraftAction?: boolean;
    // R23 P4（R20 P2A 端点上界面）：详情页「认领 / 指派给…」两个动作的资格。只有 detailPage 这条路径
    // 会算（它拿得到 actor），其它构造路径（新建/更新后回显）省略——省略即前端不渲按钮，不是渲个会 403 的。
    canClaim?: boolean;
    canAssign?: boolean;
  } = {}
): WorkItemDetailVM {
  const latestProposal = rows.latestProposal
    ? deliverableChangeManifestSchema.safeParse(rows.latestProposal.diffManifest)
    : undefined;
  const sourceComment = rows.driveSourceComment;
  const sourceInsight = rows.meetingSourceInsight;
  const latestProposalId = latestProposal?.success ? latestProposal.data.proposal_id : rows.latestProposal?.id;
  const driveSourceContext = sourceComment
    ? {
      source_type: "drive_comment" as const,
      project_id: sourceComment.comment.projectId,
      comment_id: sourceComment.comment.id,
      ...(sourceComment.comment.folderId ? { folder_id: sourceComment.comment.folderId } : {}),
      ...(sourceComment.folderPath ? { folder_path: sourceComment.folderPath } : {}),
      author_label: sourceComment.comment.authorNickname,
      body: sourceComment.comment.body,
      status: sourceComment.comment.status === "proposal_created"
        ? "proposal_created"
        : sourceComment.comment.status === "draft_created"
          ? "draft_created"
          : sourceComment.comment.status === "dismissed"
            ? "dismissed"
            : "pending_llm",
      created_at: sourceComment.comment.createdAt.toISOString(),
      ...(latestProposalId ? { proposal_id: latestProposalId, proposal_href: `/proposals/${latestProposalId}` } : {}),
      ...(rows.latestProposal?.status ? { proposal_status: rows.latestProposal.status } : {})
    }
    : undefined;
  const meetingSourceContext = sourceInsight
    ? {
      source_type: "meeting_insight" as const,
      project_id: sourceInsight.meeting.projectId,
      meeting_id: sourceInsight.meeting.id,
      insight_id: sourceInsight.insight.id,
      meeting_title: sourceInsight.meeting.title,
      insight_kind: sourceInsight.insight.kind === "requirement_change" || sourceInsight.insight.kind === "normal_note"
        ? sourceInsight.insight.kind
        : "new_requirement" as const,
      title: sourceInsight.insight.title,
      description: sourceInsight.insight.description,
      confidence_reason: compactText(sourceInsight.insight.confidenceReason, 420) ?? "Meeting insight was confirmed by a project owner.",
      status: sourceInsight.insight.status === "confirmed"
        ? "confirmed"
        : sourceInsight.insight.status === "dismissed"
          ? "dismissed"
          : "pending",
      ...(sourceInsight.meeting.transcriptText ? { transcript_excerpt: compactText(sourceInsight.meeting.transcriptText, 420) } : {}),
      ...(sourceInsight.meeting.minutesMd ? { minutes_excerpt: compactText(sourceInsight.meeting.minutesMd, 420) } : {}),
      evidence_refs: [{
        id: stableUuid(`meeting-source-evidence:${sourceInsight.insight.id}`),
        source_type: "meeting" as const,
        source_id: sourceInsight.meeting.id,
        title: sourceInsight.meeting.title,
        excerpt: compactText(sourceInsight.meeting.minutesMd ?? sourceInsight.meeting.transcriptText ?? sourceInsight.insight.description, 260) ?? sourceInsight.insight.description,
        locator: {
          path: `/meetings/${sourceInsight.meeting.id}`
        },
        confidence_hint: "found" as const,
        href: `/meetings?project_id=${sourceInsight.meeting.projectId}`
      }],
      created_at: sourceInsight.insight.createdAt.toISOString(),
      ...(latestProposalId ? { proposal_id: latestProposalId, proposal_href: `/proposals/${latestProposalId}` } : {}),
      ...(rows.latestProposal?.status ? { proposal_status: rows.latestProposal.status } : {})
    }
    : undefined;
  // R13 批 P4（观察者工单来源标注）：与上面两种既有来源互斥（观察者派发从不途经网盘评论/会议纪要）——
  // 只在两者都没有、但 action_card_items 反查到这个事项确是观察者创建的时候才补这条。
  const observerSourceContext = (!driveSourceContext && !meetingSourceContext && rows.observerActionCardItem)
    ? {
      source_type: "conversation_observer" as const,
      ...(rows.workItem.projectId ? { project_id: rows.workItem.projectId } : {}),
      conversation_id: rows.observerActionCardItem.conversationId,
      created_at: rows.observerActionCardItem.createdAt.toISOString()
    }
    : undefined;
  const sourceContext = driveSourceContext ?? meetingSourceContext ?? observerSourceContext;
  // R23 P4（R20 P2A 端点上界面）：指派名单摊平成 VM 行。lead 排在 collaborator 前面（谁主责是读者第一
  // 眼要找的），同角色内按展示名稳定排序，页面刷新两次不会自己换顺序。上限 50 与契约一致——真被指派
  // 50 人以上时截断，不让一个异常事项把详情页撑爆。
  const assigneeList = [...rows.assignments]
    .map((assignment) => ({
      user_id: assignment.userId,
      ...(assignment.nickname ? { nickname: assignment.nickname } : {}),
      role: assignment.role === "lead" ? ("lead" as const) : ("collaborator" as const)
    }))
    .sort((left, right) => {
      if (left.role !== right.role) {
        return left.role === "lead" ? -1 : 1;
      }
      return (left.nickname ?? left.user_id).localeCompare(right.nickname ?? right.user_id);
    })
    .slice(0, 50);
  const taskPlan = taskPlanToVm(rows.taskPlan);
  const agentTeam = taskPlanAgentTeamToVm(rows.taskPlan, locale);
  // R13 批 P4：conversation_observer 没有评论/纪要正文可转草稿——三路显式分支，第三路（观察者来源）
  // 恒 false，不给这个不存在的动作留隐式 fallthrough。
  const canCreateSourceProposal = sourceContext
    && !latestProposalId
    && (sourceContext.source_type === "drive_comment"
      ? sourceContext.status !== "dismissed"
      : sourceContext.source_type === "meeting_insight"
        ? sourceContext.status === "confirmed"
        : false);
  const createProposalAction = (options.includeSourceProposalDraftAction ?? true) && canCreateSourceProposal
    ? {
      id: sourceContext.source_type === "drive_comment" ? "drive_draft_to_proposal" : "meeting_draft_to_proposal",
      label: workItemT(locale, "proposalDraft.create.label"),
      method: "POST" as const,
      href: sourceContext.source_type === "drive_comment"
        ? `/api/drive/workitems/${rows.workItem.id}/proposal-draft`
        : `/api/meetings/workitems/${rows.workItem.id}/proposal-draft`
    }
    : undefined;
  return parseOutputContract(workItemDetailVmSchema, {
    workitem: toWorkItemVm(rows.workItem),
    ...(rows.projectName ? { project_name: rows.projectName } : {}),
    acceptance: rows.acceptance.map((item) => ({
      id: item.id,
      work_item_id: item.workItemId,
      title: localizeGeneratedAcceptanceText(item.title, locale),
      ...(item.description ? { description: localizeGeneratedAcceptanceText(item.description, locale) } : {}),
      status: item.status,
      sort_order: item.sortOrder,
      ...(item.sourcePlanId ? { source_plan_id: item.sourcePlanId } : {}),
      created_at: item.createdAt.toISOString(),
      updated_at: item.updatedAt.toISOString()
    })),
    agent_trace_preview: rows.agentSteps.map(toAgentStepVm),
    ...(latestProposal?.success ? { latest_proposal: latestProposal.data } : {}),
    // R13 批 P4：reviewer_kind 是仓库层批量反查好、直接挂在 row 上的字段（见 attachAcceptedDeliverableReviewerKind），
    // 这里始终原样透传——与 includeRestore 是否显式传入无关（两者是正交的两个可选项）。
    accepted_deliverables: rows.acceptedDeliverables.map((row) => acceptedDeliverableToVm(row, {
      ...(options.includeAcceptedDeliverableRestore === undefined ? {} : { includeRestore: options.includeAcceptedDeliverableRestore }),
      ...(row.reviewerKind ? { reviewerKind: row.reviewerKind } : {})
    })),
    evidence_refs: evidenceRefsFromBindings(rows.evidenceBindings),
    ...(taskPlan ? { task_plan: taskPlan } : {}),
    ...(agentTeam ? { agent_team: agentTeam } : {}),
    ...(sourceContext ? { source_context: sourceContext } : {}),
    // R6（信任 high）：置信评级最后一公里——后端早已按 run 落库，详情页此前只透传 opaque id。
    ...(rows.latestConfidence && (rows.latestConfidence.verdict === "auto_merge" || rows.latestConfidence.verdict === "human_spotcheck" || rows.latestConfidence.verdict === "escalate")
      ? { confidence: { score: rows.latestConfidence.confidenceScore, grade: rows.latestConfidence.grade, verdict: rows.latestConfidence.verdict } }
      : {}),
    approval_decisions: (rows.approvalDecisions ?? []).map((decision) => ({
      id: decision.id,
      decision: decision.status,
      ...(decision.decisionReasonMd ? { reason_md: decision.decisionReasonMd.slice(0, 300) } : {}),
      decided_at: decision.updatedAt.toISOString()
    })),
    actions: {
      ...(createProposalAction ? { create_proposal_draft: createProposalAction } : {})
    },
    ...(options.canClaim === undefined ? {} : { can_claim: options.canClaim }),
    ...(options.canAssign === undefined ? {} : { can_assign: options.canAssign }),
    // R23 P4（R20 P2A 端点上界面）：指派名单。POST /api/workitems/:id/assign 写 work_item_assignments，
    // 与 claimed_by 是两回事——不把它端出来，指派成功后详情页会毫无变化（看不出结果的假动作）。
    // 空名单省略字段（诚实缺省，前端不渲空区块）；未知角色的历史行按 collaborator 收口，
    // 不让一条脏数据把整页 VM 校验打挂。
    ...(assigneeList.length > 0 ? { assignees: assigneeList } : {})
  }, "work-item.detail");
}

function questionFor(
  workItem: Pick<WorkItemRow, "id" | "title" | "rawDescription">,
  stage: "scope" | "confirm",
  locale: WorkHubLocale = "zh-CN",
  clarificationDraft?: ClarificationQuestionDraft
): QuestionCard {
  if (stage === "confirm") {
    return {
      id: stableUuid(`${workItem.id}:question:confirm`),
      session_id: workItem.id,
      work_item_id: workItem.id,
      title: workItemT(locale, "question.confirm.title"),
      // 普通用户审查 R2：问「是否按这个方向创建」却不给看方向——回显标题与需求原文摘要。
      body: `${workItemT(locale, "question.confirm.body")}\n${locale === "en-US" ? "Direction" : "方向"}：${workItem.title}${workItem.rawDescription ? `\n${(workItem.rawDescription ?? "").slice(0, 280)}` : ""}`,
      input_mode: "confirm",
      options: [
        { id: "create-workitem", label: workItemT(locale, "question.confirm.create.label"), description: workItemT(locale, "question.confirm.create.description"), icon: "check" },
        { id: "adjust-scope", label: workItemT(locale, "question.confirm.adjust.label"), description: workItemT(locale, "question.confirm.adjust.description"), icon: "sliders" }
      ],
      recommended_option_ids: ["create-workitem"],
      free_text: {
        enabled: true,
        collapsed_by_default: true,
        placeholder: workItemT(locale, "question.free.placeholder"),
        max_length: 300
      },
      progress: [
        { key: "intent", label: workItemT(locale, "question.progress.intent"), state: "done" },
        { key: "scope", label: workItemT(locale, "question.progress.scope"), state: "done" },
        { key: "confirm", label: workItemT(locale, "question.progress.confirm"), state: "active" },
        { key: "run", label: workItemT(locale, "question.progress.run"), state: "pending" }
      ],
      submit: {
        method: "POST",
        href: `/api/sessions/${workItem.id}/next-question`
      }
    };
  }

  const draft = normalizeClarificationDraft(
    clarificationDraft,
    fallbackClarificationDraft({
      workItem: {
        id: workItem.id,
        projectId: defaultSeedIds.projectId,
        title: workItem.title,
        rawDescription: workItem.rawDescription
      },
      files: [],
      actor: {
        id: "system",
        kind: "system",
        label: "system",
        isAdmin: true,
        orgId: defaultSeedIds.orgId,
        workspaceId: defaultSeedIds.workspaceId
      },
      locale
    })
  );
  // R10-0c（P1-1 契约）：首轮澄清落实「选项优先」——LLM 草稿带 ≥2 个候选答案时渲 single_choice
  // 选项卡（自由文本折叠为兜底）；没有可用候选时诚实退化为长文本（不造假选项）。
  const scopeOptions = (draft.options ?? [])
    .map((option, index) => ({
      id: option.id ?? `option-${index + 1}`,
      label: option.label,
      ...(option.description ? { description: option.description } : {})
    }));
  const optionFirst = scopeOptions.length >= 2;
  const question: QuestionCard = {
    id: stableUuid(`${workItem.id}:question:scope`),
    session_id: workItem.id,
    work_item_id: workItem.id,
    title: draft.title,
    ...(draft.body ? { body: draft.body } : {}),
    input_mode: optionFirst ? "single_choice" : "long_text",
    options: optionFirst ? scopeOptions : [],
    recommended_option_ids: optionFirst && draft.recommended_option_id ? [draft.recommended_option_id] : [],
    free_text: {
      enabled: true,
      collapsed_by_default: optionFirst,
      placeholder: draft.placeholder ?? workItemT(locale, "question.clarify.placeholder"),
      max_length: 1000
    },
    progress: [
      { key: "intent", label: workItemT(locale, "question.progress.intent"), state: "done" },
      { key: "scope", label: workItemT(locale, "question.progress.scope"), state: "active" },
      { key: "confirm", label: workItemT(locale, "question.progress.confirm"), state: "pending" },
      { key: "run", label: workItemT(locale, "question.progress.run"), state: "pending" }
    ],
    submit: {
      method: "POST",
      href: `/api/sessions/${workItem.id}/next-question`
    }
  };
  return question;
}

function sessionVmFor(
  workItem: Pick<WorkItemRow, "id" | "title" | "rawDescription">,
  stage: "scope" | "confirm",
  locale: WorkHubLocale = "zh-CN",
  clarificationDraft?: ClarificationQuestionDraft
): SessionVM {
  return parseOutputContract(sessionVmSchema, {
    session_id: workItem.id,
    work_item_id: workItem.id,
    topic: `session:${workItem.id}`,
    stream_href: `/api/push/stream/session/${workItem.id}`,
    next_question_href: `/api/sessions/${workItem.id}/next-question`,
    question: questionFor(workItem, stage, locale, clarificationDraft)
  }, "work-item.session");
}

function handleMissingWorkItem(): never {
  throw new WorkItemServiceError(404, "not_found", "没有找到这个事项。");
}

export function createDbWorkItemService(repository: WorkItemDataRepository, options: ServiceOptions = {}): WorkItemService {
  const now = options.now ?? (() => new Date());
  const defaultProjectId = options.defaultProjectId ?? defaultSeedIds.projectId;

  // A2(HIGH/安全)：project_id 是客户端可传的可选 id，findProjectById 仅按 archived/deletedAt 过滤，
  // 不含任何租户谓词。若不校验 actor 对该项目的访问权，B 工作区成员就能传 A 工作区的 project_id 把
  // 事项/会话注入 A 工作区（跨租户写）。复用读路径同款 canViewProjectDrive（按 workspace/owner/admin 判定，
  // 单租户下 actor 与默认项目同属默认 workspace 故必过），失败按 404 处理以免泄漏跨租户项目是否存在。
  function assertCanCreateInProject(project: WorkItemProjectRow, actor: AuthActor) {
    if (!canViewProjectDrive(project, actor)) {
      throw new WorkItemServiceError(404, "project_not_found", "没有找到这个项目。");
    }
    // canViewProjectDrive 对 admin **故意**放宽 scope（admin 的项目健康看板等是跨工作区的组织级只读总览）。
    // 但**写**(建事项/会话)必须落在 actor 自己的租户内——否则 admin 可拿别工作区的 project_id 跨租户注入。
    // 与缺省项目路径的 `seeded.workspaceId === actor.workspaceId` 同口径;单租户下 actor 与项目同 workspace 故必过。
    if (project.workspaceId && actor.workspaceId && project.workspaceId !== actor.workspaceId) {
      throw new WorkItemServiceError(404, "project_not_found", "没有找到这个项目。");
    }
  }

  async function resolveProject(projectId: string | undefined, actor: AuthActor) {
    if (projectId) {
      const project = await repository.findProjectById(projectId);
      if (!project) {
        throw new WorkItemServiceError(404, "project_not_found", "没有找到这个项目。");
      }
      assertCanCreateInProject(project, actor);
      return project;
    }
    // A2 兜底收口：缺省 project_id 时，旧逻辑取全局 seed/最早一个 ACTIVE 项目，无视 actor 的 workspace，
    // 会把事项写进全局默认 seed 工作区（常量兜底跨租户泄漏）。改为只在 actor.workspaceId 内解析默认/首个 ACTIVE 项目；
    // 命中的项目仍过 canViewProjectDrive（同租户故必过）。单租户下 actor 的 workspace 即含 seed 项目的默认 workspace，行为不变。
    const seeded = await repository.findProjectById(defaultProjectId);
    if (seeded && seeded.workspaceId === actor.workspaceId) {
      assertCanCreateInProject(seeded, actor);
      return seeded;
    }
    const first = await repository.findFirstActiveProjectInWorkspace(actor.workspaceId);
    if (!first) {
      throw new WorkItemServiceError(404, "project_not_found", "还没有可用项目，无法创建任务。");
    }
    assertCanCreateInProject(first, actor);
    return first;
  }

  async function requireDetail(workItemId: string, actor: AuthActor) {
    const rows = await repository.readWorkItemDetail(workItemId);
    if (!rows) {
      handleMissingWorkItem();
    }
    assertCanReadDetail(rows, actor);
    return rows;
  }

  // routes-a-2/routes-b-1/services-a-2/xlink-authz-4/ux-web-govern-6：批量、轻量的可见性判定——
  // 一次 findWorkItemAccessRecords（IN 查询 workItems + IN 查询 assignments，两次往返，不管 workItemIds 有多少个）
  // 换掉此前审批中心每行一次 detailPage（整页 VM：assignments/proposals/acceptance/agent trace 等 ~10 条查询）。
  // 找不到的 workItemId 不算可见（fail-closed，与 detailPage 404→false 的旧行为一致）。
  // R13（多项目一致性）：批量取「actor 可见工作项 → 项目名」——首页决策队列四路来源统一点名用。
  // 复用同一次 findWorkItemAccessRecords，可见性判定与 canReadWorkItems 同口径。
  async function projectNamesForWorkItems(input: { workItemIds: string[]; actor: AuthActor }): Promise<Map<string, string>> {
    const uniqueIds = [...new Set(input.workItemIds)];
    const names = new Map<string, string>();
    if (uniqueIds.length === 0) {
      return names;
    }
    const records = await repository.findWorkItemAccessRecords(uniqueIds);
    for (const workItemId of uniqueIds) {
      const record = records.get(workItemId);
      if (record && canReadWorkItemAccessRow(record, input.actor) && record.project?.name) {
        names.set(workItemId, record.project.name);
      }
    }
    return names;
  }

  async function canReadWorkItems(input: { workItemIds: string[]; actor: AuthActor }): Promise<Set<string>> {
    const uniqueIds = [...new Set(input.workItemIds)];
    if (uniqueIds.length === 0) {
      return new Set();
    }
    const records = await repository.findWorkItemAccessRecords(uniqueIds);
    const visible = new Set<string>();
    for (const workItemId of uniqueIds) {
      const record = records.get(workItemId);
      if (record && canReadWorkItemAccessRow(record, input.actor)) {
        visible.add(workItemId);
      }
    }
    return visible;
  }

  const projectFileContext = options.projectFileContext ?? defaultProjectFileContext;
  const clarificationGenerator = options.clarificationGenerator
    ?? (options.providerRegistry ? createLlmClarificationGenerator(options.providerRegistry) : undefined);

  // CHAT-1（读路径去副作用）：GET /sessions/:id 是轮询/刷新都会打到的读路径，此前混在
  // clarificationDraftFor 里——缺文件就插 notice、加载失败就插 error、复用启发式不命中就直接烧一次
  // LLM（60s/1600 tokens 无频率限制），读流量会把 chat_messages 写爆还烧钱。拆成两条路径：
  //   - storedReusableClarificationDraft（本函数）：纯读。只读「已存草稿」+ 只读的文件上下文
  //     （复用启发式要用），不写任何 chat 消息、绝不调 LLM。草稿不存在/失效返回 undefined，
  //     由调用方决定怎么呈现（getSession 抛 409 引导走生成路径重试）。
  //   - generateClarificationDraftFor：唯一允许写留痕/调 LLM 的生成路径，只在 createSession
  //     （新建或带 work_item_id 的显式重试）里调用。
  async function storedReusableClarificationDraft(
    workItem: WorkItemRow,
    actor: AuthActor,
    locale: WorkHubLocale = "zh-CN"
  ) {
    const stored = draftFromStoredClarificationQuestion(
      await repository.findLatestChatMessageByKind(workItem.id, "clarification_question")
    );
    if (!stored) {
      return undefined;
    }
    const intentText = workItem.rawDescription ?? workItem.title ?? undefined;
    let files: ClarificationFileContext[] = [];
    try {
      files = await projectFileContext({
        projectId: workItem.projectId,
        actor,
        locale,
        intentText
      });
    } catch {
      // 读路径 fail-closed 但**不留痕**（留痕写在生成路径，见 generateClarificationDraftFor）：
      // 文件上下文读不出就无法验证复用启发式，宁可当作没有可用草稿。
      throw clarificationFileContextFailedError(locale);
    }
    const input: ClarificationQuestionInput = { workItem, actor, locale, files };
    return canReuseStoredClarificationDraft(stored, input) ? stored : undefined;
  }

  async function generateClarificationDraftFor(
    workItem: WorkItemRow,
    actor: AuthActor,
    locale: WorkHubLocale = "zh-CN"
  ) {
    const intentText = workItem.rawDescription ?? workItem.title ?? undefined;
    const stored = draftFromStoredClarificationQuestion(
      await repository.findLatestChatMessageByKind(workItem.id, "clarification_question")
    );
    let files: ClarificationFileContext[] = [];
    try {
      files = await projectFileContext({
        projectId: workItem.projectId,
        actor,
        locale,
        intentText
      });
    } catch (error) {
      // CHAT-1：留痕只在生成路径写——这里是用户显式触发的生成/重试，一次调用最多一条。
      await repository.insertChatMessage({
        workItemId: workItem.id,
        role: "system",
        kind: "clarification_file_context_error",
        contentJson: {
          message: locale === "en-US"
            ? `project file context failed: ${error instanceof Error ? error.message : "unknown error"}`
            : `项目文件上下文加载失败：${error instanceof Error ? error.message : "未知错误"}`
        },
        at: now()
      });
      throw clarificationFileContextFailedError(locale);
    }
    // R9 批次0-2：点名文件没找到不再 502（并连带 cancel 工单）——降级为留痕后继续，
    // 让澄清反问自然向用户确认缺失的材料。识别本身有误报可能，阻断主流程代价不对称。
    // CHAT-1：留痕挪到「复用判断之后」——只有真的会重新生成草稿才写，复用已存草稿的
    // 显式重试（createSession 带 work_item_id）不再重复堆 notice。
    const input: ClarificationQuestionInput = { workItem, actor, locale, files };
    if (stored && canReuseStoredClarificationDraft(stored, input)) {
      return stored;
    }
    const missingFileNames = missingDriveTargetFileNames({
      intentText,
      files
    });
    if (missingFileNames.length > 0) {
      await repository.insertChatMessage({
        workItemId: workItem.id,
        role: "system",
        kind: "clarification_file_context_notice",
        contentJson: {
          message: "explicit project file was not loaded; continuing without it",
          missing_file_names: missingFileNames,
          loaded_file_paths: files.map((file) => file.path)
        },
        at: now()
      });
    }
    if (!clarificationGenerator) {
      throw new WorkItemServiceError(
        503,
        "clarification_llm_unavailable",
        locale === "en-US"
          ? "AI material analysis is not configured, so WorkHub cannot generate a real clarification question."
          : "AI 材料分析尚未配置，WorkHub 无法生成真实澄清反问。"
      );
    }
    // API-04：真正要调 LLM 生成反问前过预算软闸（复用已存草稿的路径在上面已 return，不触发）。
    await options.budgetGate?.({ workspaceId: workItem.workspaceId ?? actor.workspaceId, locale });
    const fallback = fallbackClarificationDraft(input);
    let generated: ClarificationQuestionDraft | undefined;
    try {
      generated = await clarificationGenerator(input);
    } catch (error) {
      await repository.insertChatMessage({
        workItemId: workItem.id,
        role: "system",
        kind: "clarification_analysis_error",
        contentJson: {
          // E2E-01：落库留痕按 locale 写中/英文（此前硬编码英文 message，中文用户看不懂失败原因）。
          message: locale === "en-US"
            ? `AI material analysis failed: ${error instanceof Error ? error.message : "unknown error"}`
            : `AI 材料分析失败：${error instanceof Error ? error.message : "未知错误"}`,
          file_paths: files.map((file) => file.path)
        },
        at: now()
      });
      if (error instanceof WorkItemServiceError) {
        throw error;
      }
      throw new WorkItemServiceError(
        502,
        "clarification_llm_failed",
        locale === "en-US"
          ? "AI material analysis failed before a real clarification question was generated."
          : "AI 材料分析失败，尚未生成真实澄清反问。"
      );
    }
    if (!generated) {
      throw new WorkItemServiceError(
        502,
        "clarification_llm_empty_response",
        locale === "en-US"
          ? "AI material analysis returned no clarification question."
          : "AI 材料分析没有返回澄清反问。"
      );
    }
    const draft = normalizeClarificationDraft(generated, fallback);
    if (generated && clarificationDraftLooksTemplated(draft, input)) {
      await repository.insertChatMessage({
        workItemId: workItem.id,
        role: "system",
        kind: "clarification_analysis_error",
        contentJson: {
          message: locale === "en-US"
            ? "AI material analysis returned a generic template"
            : "AI 材料分析返回了泛化模板",
          file_paths: files.map((file) => file.path)
        },
        at: now()
      });
      throw new WorkItemServiceError(
        502,
        "clarification_llm_templated_response",
        locale === "en-US"
          ? "AI material analysis returned a generic template instead of a real follow-up question."
          : "AI 材料分析返回了泛化模板，不是真实反问。"
      );
    }
    await repository.insertChatMessage({
      workItemId: workItem.id,
      role: generated ? "assistant" : "system",
      kind: "clarification_question",
      contentJson: {
        ...draft,
        source: generated ? "llm" : "fallback",
        file_paths: files.map((file) => file.path)
      },
      at: now()
    });
    return draft;
  }

  async function scopeSessionVmFor(workItem: WorkItemRow, actor: AuthActor, locale: WorkHubLocale = "zh-CN") {
    return sessionVmFor(workItem, "scope", locale, await generateClarificationDraftFor(workItem, actor, locale));
  }

  return {
    async createSession(input) {
      if (input.payload.work_item_id) {
        const rows = await requireDetail(input.payload.work_item_id, input.actor);
        assertCanMutateWorkItemRows(rows, input.actor);
        return scopeSessionVmFor(rows.workItem, input.actor, input.locale);
      }

      const project = await resolveProject(input.payload.project_id, input.actor);
      const title = input.payload.title ?? titleFromIntent(input.payload.intent_text);
      const workItem = await repository.createWorkItem({
        projectId: project.id,
        workspaceId: project.workspaceId,
        submitterUserId: input.actor.userId ?? input.actor.id,
        title,
        rawDescription: input.payload.intent_text ?? title,
        summaryMd: input.payload.intent_text ? `待澄清：${input.payload.intent_text}` : "待澄清事项。",
        status: "ai_clarifying",
        at: now()
      });
      try {
        await repository.insertChatMessage({
          workItemId: workItem.id,
          role: "user",
          kind: "intent",
          contentJson: {
            title,
            intent_text: input.payload.intent_text ?? null
          },
          ...(input.payload.intent_text ? { userOtherText: input.payload.intent_text } : {}),
          at: now()
        });
        const session = await scopeSessionVmFor(workItem, input.actor, input.locale);
        return session;
      } catch (error) {
        // E2E-01：澄清生成失败**不再把工作项置 cancelled**——意图没有丢（上方 intent 消息已落库），
        // 工作项留在 ai_clarifying，用户可经 createSession(带 work_item_id) 显式重试生成；
        // 长时间没人处理的滞留会话由 clarification-chase pulse（CHAT-8）兜底提醒提交人。
        // 此前失败即 cancel 会让一次瞬态 LLM 故障永久吞掉用户意图。
        throw error;
      }
    },

    async getSession(input) {
      // CHAT-06：读会话是读路径——requireDetail 内已做 assertCanReadDetail；只读干系人
      // （可观不可改）也要能看澄清问答。写路径（createSession/nextQuestion）仍保持 mutate 判定。
      const rows = await requireDetail(input.sessionId, input.actor);
      const clarificationAnswers = await repository.listSessionClarificationAnswers(rows.workItem.id);
      if (clarificationAnswers.length > 0) {
        return sessionVmFor(rows.workItem, "confirm", input.locale);
      }
      // CHAT-1：读路径只读已存草稿——不生成、不写留痕、不调 LLM。草稿缺失/失效由
      // createSession(带 work_item_id) 的显式重试负责再生成。
      const stored = await storedReusableClarificationDraft(rows.workItem, input.actor, input.locale);
      if (!stored) {
        throw clarificationDraftMissingError(input.locale ?? "zh-CN");
      }
      return sessionVmFor(rows.workItem, "scope", input.locale, stored);
    },

    async nextQuestion(input) {
      const rows = await requireDetail(input.sessionId, input.actor);
      assertCanMutateWorkItemRows(rows, input.actor);
      // CHAT-2④ 状态守卫：只有澄清中的会话可作答。已定稿(spec_ready 及以后)/终态事项再写
      // 澄清回答没有消费者，只会污染定稿输入与留痕（fail-closed，与定稿侧的状态守卫同口径）。
      if (rows.workItem.status !== "ai_clarifying") {
        throw new WorkItemServiceError(
          409,
          "clarification_state_conflict",
          (input.locale ?? "zh-CN") === "en-US"
            ? "This session has already moved past clarification; new answers are no longer accepted."
            : "这个会话已经越过澄清阶段，不能再提交澄清回答。"
        );
      }
      const selectedOptionIds = input.payload.selected_option_ids ?? [];
      // M10: "调整范围"(adjust-scope) on the confirm step is navigation back to the
      // scope question, not a clarification answer. Re-rendering confirm would trap
      // the user on the same screen; send them back to scope to re-choose and don't
      // record the navigation as an answer.
      // CHAT-2③：回到 scope 重答前必须清掉已存的 scope 回答——否则旧回答残留在定稿输入里，
      // 用户「调整范围」后旧选择仍悄悄生效。
      if (selectedOptionIds.includes("adjust-scope")) {
        await repository.deleteSessionClarificationAnswers(rows.workItem.id);
        const draft = await storedReusableClarificationDraft(rows.workItem, input.actor, input.locale);
        if (!draft) {
          throw clarificationDraftMissingError(input.locale ?? "zh-CN");
        }
        return sessionVmFor(rows.workItem, "scope", input.locale, draft);
      }
      // CHAT-2① 选项合法性：selected_option_ids 必须来自当前阶段真实渲染出去的选项集，
      // 否则客户端可提交任意字符串落库，定稿时变成来路不明的 planning_note/launcher 输入。
      // 无法核验（无草稿/无选项=长文本问题）时带选项提交一律 422（fail-closed）。
      if (selectedOptionIds.length > 0) {
        const priorAnswers = await repository.listSessionClarificationAnswers(rows.workItem.id);
        // confirm 阶段的合法选项是确认卡上的哨兵（create-workitem/adjust-scope 等），不是 scope 草稿的选项——
        // CUU 桌宠的确认卡就走这条路提交（cuu-r3 冒烟实证）。按阶段取校验集。
        const atConfirmStage = priorAnswers.length > 0;
        const validOptionIds = new Set(
          atConfirmStage
            ? (questionFor(rows.workItem, "confirm", input.locale).options ?? []).map((option, index) => option.id ?? `option-${index + 1}`)
            : (draftFromStoredClarificationQuestion(
                await repository.findLatestChatMessageByKind(rows.workItem.id, "clarification_question")
              )?.options ?? []).map((option, index) => option.id ?? `option-${index + 1}`)
        );
        if (validOptionIds.size < 2 || selectedOptionIds.some((id) => !validOptionIds.has(id))) {
          throw new WorkItemServiceError(
            422,
            "clarification_option_invalid",
            (input.locale ?? "zh-CN") === "en-US"
              ? "The submitted option does not belong to the current clarification question. Refresh and answer again."
              : "提交的选项不属于当前澄清问题，请刷新后重新作答。"
          );
        }
      }
      // CHAT-2② 幂等：scope 阶段只有一道题，回答键即 (session, question) ≡ (workItem, 'clarification_answer')。
      // 重复提交（双击/网络重试）upsert 替换而非追加，同一题的回答不会无界堆积。
      // 哨兵过滤：confirm 阶段的「创建任务/调整范围」是导航动作不是内容回答——落库前剥掉哨兵 id，
      // 否则定稿合并时 "create-workitem" 会漏进执行范围（cuu-r3 冒烟实证钉住）。
      const CONFIRM_SENTINELS = new Set(["create-workitem", "adjust-scope"]);
      const contentOptionIds = selectedOptionIds.filter((id) => !CONFIRM_SENTINELS.has(id));
      if (contentOptionIds.length === 0 && !input.payload.free_text && selectedOptionIds.length > 0) {
        // 纯哨兵提交（点了「创建任务」）：不产生回答记录，直接回确认卡（创建动作走 createWorkItem）。
        return sessionVmFor(rows.workItem, "confirm", input.locale);
      }
      await repository.replaceSessionClarificationAnswer({
        workItemId: rows.workItem.id,
        role: "user",
        kind: "clarification_answer",
        contentJson: {
          selected_option_ids: contentOptionIds,
          free_text: input.payload.free_text ?? null
        },
        ...(contentOptionIds[0] ? { selectedOptionKey: contentOptionIds[0] } : {}),
        ...(input.payload.free_text ? { userOtherText: input.payload.free_text } : {}),
        at: now()
      });
      return sessionVmFor(rows.workItem, "confirm", input.locale);
    },

    async createWorkItem(input) {
      if (input.payload.session_id) {
        const rows = await requireDetail(input.payload.session_id, input.actor);
        assertCanMutateWorkItemRows(rows, input.actor);
        const clarificationAnswers = await repository.listSessionClarificationAnswers(rows.workItem.id);
        const selectedOptionIds = mergeSelectedOptionIds(
          clarificationAnswers.flatMap((answer) => answer.selectedOptionIds),
          input.payload.selected_option_ids,
          selectedOptionIdsFromLauncherSpec(input.payload.cuu_launcher_spec)
        );
        const launcherSpec = launcherSpecForSelectedOptions(selectedOptionIds, input.payload.cuu_launcher_spec);
        const planningNote = planningNoteForSelectedOptions({
          selectedOptionIds,
          launcherSpec,
          clarificationAnswers,
          finalFreeText: input.payload.free_text
        });
        const launcherAcceptanceItems = acceptanceItemsFromLauncherSpec(launcherSpec);
        const acceptanceItems = launcherAcceptanceItems.length
          ? launcherAcceptanceItems
          : acceptanceItemsFromClarification(input.locale);
        const updateInput: Parameters<WorkItemDataRepository["updateWorkItemFromSession"]>[0] = {
          workItemId: rows.workItem.id,
          title: input.payload.title ?? rows.workItem.title ?? titleFromIntent(rows.workItem.rawDescription ?? undefined),
          status: "spec_ready",
          // CHAT-3（定稿竞态）：上面的 clarificationAnswers 是在事务外读的；把读到的条数交给仓库层，
          // 在「状态守卫 + 定稿写入」同一事务里复核回答数未变——读与写之间插入的新回答（用户在另一
          // 标签页又答了一次）会让复核落空返回 null，而不是拿陈旧回答集静默定稿。
          expectedClarificationAnswerCount: clarificationAnswers.length,
          at: now()
        };
        const rawDescription = input.payload.raw_description ?? rows.workItem.rawDescription ?? undefined;
        if (rawDescription) {
          updateInput.rawDescription = rawDescription;
        }
        const summaryMd = input.payload.raw_description ?? rows.workItem.summaryMd ?? rows.workItem.rawDescription ?? undefined;
        if (summaryMd) {
          updateInput.summaryMd = summaryMd;
        }
        if (selectedOptionIds.length) {
          updateInput.selectedOptionIds = selectedOptionIds;
        }
        if (planningNote) {
          updateInput.planningNote = planningNote;
        }
        if (acceptanceItems.length) {
          updateInput.acceptanceItems = acceptanceItems;
        }
        const updated = await repository.updateWorkItemFromSession(updateInput);
        if (!updated) {
          // findings[#19/H4]：item 必存在（requireDetail 已在上方校验），故 0 行命中只能是状态守卫拒绝了
          // 非法转移（如想把已交付/在审事项回滚到 spec_ready/ai_working）→ 409 状态冲突，而非误报 404。
          // CHAT-3：此外回答计数复核（expectedClarificationAnswerCount）落空也走这里——读回答与定稿之间
          // 有新回答写入，提示刷新重答而非拿旧回答集定稿。
          throw new WorkItemServiceError(
            409,
            "workitem_state_conflict",
            "这个事项的当前状态不允许重新定稿；若刚提交过新的澄清回答，请刷新后重试。"
          );
        }
        await repository.insertChatMessage({
          workItemId: updated.id,
          role: "system",
          kind: "workitem_finalized",
          contentJson: {
            selected_option_ids: selectedOptionIds,
            ...(input.payload.free_text ? { free_text: input.payload.free_text } : {}),
            ...(launcherSpec ? { cuu_launcher_spec: launcherSpec } : {}),
            kickoff_agent: input.payload.kickoff_agent ?? false
          },
          at: now()
        });
        return buildWorkItemDetail(await requireDetail(updated.id, input.actor), input.locale);
      }

      const project = await resolveProject(input.payload.project_id, input.actor);
      const title = input.payload.title ?? titleFromIntent(input.payload.raw_description);
      const selectedOptionIds = mergeSelectedOptionIds(
        input.payload.selected_option_ids,
        selectedOptionIdsFromLauncherSpec(input.payload.cuu_launcher_spec)
      );
      const launcherSpec = launcherSpecForSelectedOptions(selectedOptionIds, input.payload.cuu_launcher_spec);
      const planningNote = planningNoteForSelectedOptions({
        selectedOptionIds,
        launcherSpec,
        finalFreeText: input.payload.free_text
      });
      const acceptanceItems = acceptanceItemsFromLauncherSpec(launcherSpec);
      const createInput: Parameters<WorkItemDataRepository["createWorkItem"]>[0] = {
        projectId: project.id,
        workspaceId: project.workspaceId,
        submitterUserId: input.actor.userId ?? input.actor.id,
        title,
        rawDescription: input.payload.raw_description ?? title,
        summaryMd: input.payload.raw_description ?? `准备执行：${title}`,
        status: "spec_ready",
        at: now()
      };
      if (selectedOptionIds.length) {
        createInput.selectedOptionIds = selectedOptionIds;
      }
      if (planningNote) {
        createInput.planningNote = planningNote;
      }
      if (acceptanceItems.length) {
        createInput.acceptanceItems = acceptanceItems;
      }
      const created = await repository.createWorkItem(createInput);
      return buildWorkItemDetail(await requireDetail(created.id, input.actor), input.locale);
    },

    async bindEvidence(input) {
      const rows = await requireDetail(input.workItemId, input.actor);
      assertCanMutateWorkItemRows(rows, input.actor);
      // CHAT-05：evidence_refs 客户端可任意构造——work_item 类引用（ref.id 即事项 id）必须真实存在
      // 且 actor 可读，否则能把无权访问的事项绑进证据流。其余 source_type（drive_file/meeting 等）
      // 的实体不经过本服务存取，暂无服务端可校验的真源，维持透传。不可见按 404 处理，不泄露存在性。
      const workItemRefIds = input.payload.evidence_refs
        .filter((ref) => ref.source_type === "work_item")
        .map((ref) => ref.id);
      if (workItemRefIds.length > 0) {
        const records = await repository.findWorkItemAccessRecords([...new Set(workItemRefIds)]);
        for (const refId of workItemRefIds) {
          const record = records.get(refId);
          if (!record || !canReadWorkItemAccessRow(record, input.actor)) {
            throw new WorkItemServiceError(404, "evidence_ref_not_found", "引用的证据不存在或不可见。");
          }
        }
      }
      await repository.insertChatMessage({
        workItemId: input.workItemId,
        role: "user",
        kind: "evidence_binding",
        contentJson: {
          evidence_bubble_id: input.payload.evidence_bubble_id ?? null,
          evidence_refs: input.payload.evidence_refs,
          note: input.payload.note ?? null
        },
        ...(input.payload.note ? { userOtherText: input.payload.note } : {}),
        at: now()
      });
      return buildWorkItemDetail(await requireDetail(input.workItemId, input.actor), input.locale);
    },

    async searchKnowledge(input) {
      // 授权：检索必须锚定一个可访问的工单或项目，否则跨项目/工作空间泄露知识库与工单。
      let explicitWorkItemId: string | undefined;
      let projectContext: KnowledgeWorkItemProject | undefined;
      if (input.payload.work_item_id) {
        const detail = await requireDetail(input.payload.work_item_id, input.actor); // 抛 403/404
        explicitWorkItemId = input.payload.work_item_id;
        projectContext = {
          ownerUserId: detail.projectOwnerUserId,
          workspaceId: detail.projectWorkspaceId,
          archived: detail.projectArchived,
          deletedAt: detail.projectDeletedAt
        };
      } else if (input.payload.project_id) {
        // 与首页/网盘/项目主页同口径用 canViewProjectDrive(admin/owner/同工作区)，不再 owner-only
        // ——否则同工作区成员能看项目网盘却搜不了它的资料，前后矛盾。
        const project = await repository.findProjectById(input.payload.project_id);
        if (!project || project.archived || project.deletedAt != null) {
          throw new WorkItemServiceError(404, "project_not_found", "没有找到这个项目。");
        }
        if (!canViewProjectDrive(project, input.actor)) {
          throw new WorkItemServiceError(403, "forbidden", "你没有权限检索这个项目的资料。");
        }
        projectContext = project;
      } else if (!input.actor.isAdmin) {
        // 既无工单也无项目 = 全局检索，非管理员禁止（避免泄露全部项目资料）。
        throw new WorkItemServiceError(403, "forbidden", "请在具体事项或项目内检索。");
      }
      const query = input.payload.query ?? input.payload.q;
      const searchInput: Parameters<WorkItemDataRepository["searchKnowledge"]>[0] = {};
      if (query) searchInput.query = query;
      if (input.payload.project_id) searchInput.projectId = input.payload.project_id;
      if (input.payload.work_item_id) searchInput.workItemId = input.payload.work_item_id;
      if (input.payload.limit) searchInput.limit = input.payload.limit;
      const rows = await repository.searchKnowledge(searchInput);
      const visibleWorkItems = rows.workItems.filter(
        (row) => row.id === explicitWorkItemId || canViewKnowledgeWorkItem(row, input.actor, projectContext)
      );
      const visibleWorkItemIds = new Set(visibleWorkItems.map((row) => row.id));
      const visibleDocuments = rows.documents.filter((row) => {
        if (!row.workItemId) {
          return true;
        }
        return row.workItemId === explicitWorkItemId || visibleWorkItemIds.has(row.workItemId);
      });
      const refs = [
        ...visibleDocuments.map(evidenceRefFromDocument),
        ...visibleWorkItems.map(evidenceRefFromWorkItem)
      ].slice(0, Math.max(1, Math.min(input.payload.limit ?? 10, 20)));
      const bubble: EvidenceBubble = {
        id: stableUuid(`evidence:${input.actor.id}:${query ?? "recent"}:${input.payload.project_id ?? ""}:${input.payload.work_item_id ?? ""}`),
        ...(query ? { query_text: query } : {}),
        summary_text: refs.length > 0
          ? localizeGeneratedEvidenceSummary(refs.length, input.locale)
          : (input.locale === "en-US" ? "Not enough evidence is available yet. I will not invent sources." : "还没有找到足够证据，我不会编造来源。"),
        evidence_refs: refs,
        ...(refs.length === 0 ? { missing_evidence_note: workItemT(input.locale, "evidence.missing") } : {}),
        actions: [
          ...(input.payload.work_item_id && refs.length > 0
            ? [{
                id: "use_for_current_task" as const,
                label: workItemT(input.locale, "evidence.useCurrent"),
                method: "POST" as const,
                href: `/api/workitems/${input.payload.work_item_id}/evidence-bindings`
              }]
            : []),
          {
            id: "open_full_search",
            label: workItemT(input.locale, "evidence.openFull"),
            href: `/knowledge/search${query ? `?q=${encodeURIComponent(query)}` : ""}`
          },
          {
            id: "ask_followup",
            label: workItemT(input.locale, "evidence.askFollowup"),
            href: "/knowledge/search"
          }
        ]
      };
      return bubble;
    },

    async detailPage(input) {
      const rows = await requireDetail(input.workItemId, input.actor);
      const canMutate = canMutateWorkItem(rows, input.actor);
      // R23 P4：认领/指派资格用与 POST /api/workitems/:id/{claim,assign} 服务层完全相同的谓词算
      // （@workhub/permissions 的 canClaimWorkItem / canManageWorkItemAssignees，作用域同样只按 workspace——
      // 见 work-item-assignment.ts 里 permissionScope 的说明），前端据此决定按钮渲不渲。
      const accessRecord = detailToWorkItemAccessRecord(rows);
      const permissionUser = { id: input.actor.userId ?? input.actor.id, isAdmin: input.actor.isAdmin };
      const permissionScope = input.actor.workspaceId ? { workspaceId: input.actor.workspaceId } : undefined;
      return buildWorkItemDetail(rows, input.locale, {
        includeAcceptedDeliverableRestore: canMutate,
        includeSourceProposalDraftAction: canMutate,
        canClaim: canClaimWorkItem(accessRecord, permissionUser, permissionScope),
        canAssign: canManageWorkItemAssignees(accessRecord, permissionUser, permissionScope)
      });
    },

    projectNamesForWorkItems,
    canReadWorkItems,

    async assertCanMutateWorkItem(input) {
      const rows = await requireDetail(input.workItemId, input.actor);
      assertCanMutateWorkItemRows(rows, input.actor);
    },

    async assertCanMutateArtifacts(input) {
      const rows = await requireDetail(input.workItemId, input.actor);
      assertCanMutateWorkItemArtifacts(rows, input.actor);
    },

    async acceptedDeliverableFile(input) {
      await requireDetail(input.workItemId, input.actor);
      const row = await repository.findAcceptedDeliverableFile(input.workItemId, input.acceptedChangeId);
      if (!row?.driveVersion?.storagePath) {
        throw new WorkItemServiceError(404, "deliverable_not_found", "没有找到这份正式交付物。");
      }
      return {
        id: row.accepted.id,
        filename: row.driveVersion.filename,
        ...(row.driveVersion.mime ? { mime: row.driveVersion.mime } : {}),
        sizeBytes: row.driveVersion.sizeBytes,
        storagePath: row.driveVersion.storagePath,
        ...(row.driveVersion.sha256 ? { sha256: row.driveVersion.sha256 } : {}),
        ...(row.driveVersion.parsedText ? { parsedText: row.driveVersion.parsedText } : {})
      };
    },

    async restoreAcceptedDeliverable(input) {
      const rows = await requireDetail(input.workItemId, input.actor);
      assertCanMutateWorkItemArtifacts(rows, input.actor);
      try {
        const row = await repository.restoreAcceptedDeliverable({
          workItemId: input.workItemId,
          acceptedChangeId: input.acceptedChangeId,
          actorKind: input.actor.kind,
          actorUserId: input.actor.userId ?? input.actor.id,
          at: now()
        });
        if (!row) {
          throw new WorkItemServiceError(404, "deliverable_not_found", "没有找到这份正式交付物。");
        }
        return {
          accepted_deliverable: acceptedDeliverableToVm(row)
        };
      } catch (error) {
        if (error instanceof WorkItemAcceptedDeliverableRestoreError) {
          throw new WorkItemServiceError(409, error.code, error.message);
        }
        throw error;
      }
    }
  };
}

type MemoryStoredWorkItem = WorkItem & {
  projectOwnerUserId?: string;
};

export function createInMemoryWorkItemService(options: ServiceOptions = {}): WorkItemService {
  const now = options.now ?? (() => new Date());
  const nextId = options.id ?? randomUUID;
  let sequence = 0;
  const workItems = new Map<string, MemoryStoredWorkItem>();
  const answers = new Map<string, NextQuestionRequest[]>();
  const questionDrafts = new Map<string, ClarificationQuestionDraft>();
  const evidence = new Map<string, EvidenceRef[]>();
  const acceptanceItems = new Map<string, Array<{
    id: string;
    work_item_id: string;
    title: string;
    description?: string;
    status: "open" | "met" | "unmet" | "waived";
    sort_order: number;
    created_at: string;
    updated_at: string;
  }>>();

  function at() {
    return now().toISOString();
  }

  function memoryRow(workItem: MemoryStoredWorkItem): Pick<WorkItemRow, "id" | "title" | "rawDescription"> {
    return {
      id: workItem.id,
      title: workItem.title ?? null,
      rawDescription: workItem.raw_description ?? null
    };
  }

  function memoryClarificationWorkItem(workItem: MemoryStoredWorkItem): Pick<WorkItemRow, "id" | "projectId" | "title" | "rawDescription"> {
    return {
      id: workItem.id,
      projectId: workItem.project_id,
      title: workItem.title ?? null,
      rawDescription: workItem.raw_description ?? null
    };
  }

  function requireWorkItem(id: string) {
    const workItem = workItems.get(id);
    if (!workItem) {
      handleMissingWorkItem();
    }
    return workItem;
  }

  function putWorkItem(input: {
    title?: string;
    rawDescription?: string;
    projectId?: string;
    actor: AuthActor;
    status: WorkItem["status"];
  }) {
    const id = nextId();
    const createdAt = at();
    const workItem: MemoryStoredWorkItem = {
      id,
      code: `MEM-${String(++sequence).padStart(3, "0")}`,
      project_id: input.projectId ?? options.defaultProjectId ?? defaultSeedIds.projectId,
      workspace_id: "00000000-0000-4000-8000-000000000002",
      submitter_user_id: input.actor.userId ?? input.actor.id,
      title: input.title ?? titleFromIntent(input.rawDescription),
      raw_description: input.rawDescription ?? input.title ?? "待澄清事项。",
      summary_md: input.rawDescription ?? input.title ?? "待澄清事项。",
      status: input.status,
      priority: "normal",
      sync_state: "pending",
      version: 0,
      mode: "worker",
      human_reserved: false,
      created_at: createdAt,
      updated_at: createdAt
    };
    workItems.set(id, workItem);
    return workItem;
  }

  function detail(workItem: MemoryStoredWorkItem, locale: WorkHubLocale = "zh-CN"): WorkItemDetailVM {
    const defaultAcceptance = [
      { id: "option-first", title: workItemT(locale, "acceptance.optionFirst"), status: answers.has(workItem.id) ? "met" : "open" },
      { id: "evidence-bound", title: workItemT(locale, "acceptance.evidenceBound"), status: (evidence.get(workItem.id)?.length ?? 0) > 0 ? "met" : "open" }
    ];
    return parseOutputContract(workItemDetailVmSchema, {
      workitem: workItem,
      acceptance: [...(acceptanceItems.get(workItem.id) ?? []), ...defaultAcceptance],
      agent_trace_preview: [],
      accepted_deliverables: [],
      evidence_refs: evidence.get(workItem.id) ?? []
    }, "work-item.detail");
  }

  function selectedOptionIdsForSession(sessionId: string, current: readonly string[] | undefined) {
    return mergeSelectedOptionIds(
      ...(answers.get(sessionId) ?? []).map((answer) => answer.selected_option_ids),
      current
    );
  }

  function clarificationAnswersForSession(sessionId: string): WorkItemClarificationAnswerRow[] {
    return (answers.get(sessionId) ?? []).map((answer) => ({
      selectedOptionIds: answer.selected_option_ids ?? [],
      ...(answer.free_text ? { freeText: answer.free_text } : {})
    }));
  }

  async function memoryClarificationDraftFor(
    workItem: MemoryStoredWorkItem,
    actor: AuthActor,
    locale: WorkHubLocale = "zh-CN"
  ) {
    const intentText = workItem.raw_description ?? workItem.title ?? undefined;
    const stored = questionDrafts.get(workItem.id);
    let files: ClarificationFileContext[] = [];
    if (options.projectFileContext) {
      try {
        files = await options.projectFileContext({
          projectId: workItem.project_id,
          actor,
          locale,
          intentText
        });
      } catch {
        throw clarificationFileContextFailedError(locale);
      }
    }
    // R9 批次0-2：与 PG 路径一致——点名文件缺失降级继续，不 502。
    const input: ClarificationQuestionInput = {
      workItem: memoryClarificationWorkItem(workItem),
      actor,
      locale,
      files
    };
    if (stored && canReuseStoredClarificationDraft(stored, input)) {
      return stored;
    }
    const fallback = fallbackClarificationDraft(input);
    let generated: ClarificationQuestionDraft | undefined;
    if (options.clarificationGenerator) {
      // API-04：内存路径同口径——调 LLM 前过预算软闸。
      await options.budgetGate?.({ workspaceId: actor.workspaceId, locale });
      try {
        generated = await options.clarificationGenerator(input);
      } catch (error) {
        if (error instanceof WorkItemServiceError) {
          throw error;
        }
        throw new WorkItemServiceError(
          502,
          "clarification_llm_failed",
          locale === "en-US"
            ? "AI material analysis failed before a real clarification question was generated."
            : "AI 材料分析失败，尚未生成真实澄清反问。"
        );
      }
      if (!generated || clarificationDraftLooksTemplated(generated, input)) {
        throw new WorkItemServiceError(
          502,
          !generated ? "clarification_llm_empty_response" : "clarification_llm_templated_response",
          locale === "en-US"
            ? "AI material analysis did not produce a real follow-up question."
            : "AI 材料分析没有产出真实反问。"
        );
      }
    }
    const draft = normalizeClarificationDraft(generated, fallback);
    questionDrafts.set(workItem.id, draft);
    return draft;
  }

  async function memoryScopeSessionVmFor(workItem: MemoryStoredWorkItem, actor: AuthActor, locale: WorkHubLocale = "zh-CN") {
    return sessionVmFor(memoryRow(workItem), "scope", locale, await memoryClarificationDraftFor(workItem, actor, locale));
  }

  return {
    async createSession(input) {
      const workItem = input.payload.work_item_id
        ? requireWorkItem(input.payload.work_item_id)
        : putWorkItem({
            ...(input.payload.title ? { title: input.payload.title } : {}),
            ...(input.payload.intent_text ? { rawDescription: input.payload.intent_text } : {}),
            ...(input.payload.project_id ? { projectId: input.payload.project_id } : {}),
            actor: input.actor,
            status: "ai_clarifying"
      });
      return memoryScopeSessionVmFor(workItem, input.actor, input.locale);
    },

    async getSession(input) {
      const workItem = requireWorkItem(input.sessionId);
      const hasAnswers = (answers.get(input.sessionId) ?? []).length > 0;
      if (hasAnswers) {
        return sessionVmFor(memoryRow(workItem), "confirm", input.locale);
      }
      // CHAT-1：与持久化路径同口径——读路径只读已存草稿，不调 generator 现场生成。
      const stored = questionDrafts.get(workItem.id);
      if (!stored) {
        throw clarificationDraftMissingError(input.locale ?? "zh-CN");
      }
      return sessionVmFor(memoryRow(workItem), "scope", input.locale, stored);
    },

    async nextQuestion(input) {
      const workItem = requireWorkItem(input.sessionId);
      // CHAT-2④：与持久化路径同口径——只有澄清中的会话可作答。
      if (workItem.status !== "ai_clarifying") {
        throw new WorkItemServiceError(
          409,
          "clarification_state_conflict",
          (input.locale ?? "zh-CN") === "en-US"
            ? "This session has already moved past clarification; new answers are no longer accepted."
            : "这个会话已经越过澄清阶段，不能再提交澄清回答。"
        );
      }
      const selectedOptionIds = input.payload.selected_option_ids ?? [];
      // M10: mirror the persistent path — "调整范围"(adjust-scope) navigates back to
      // the scope question instead of dead-ending on confirm, and is not recorded.
      // CHAT-2③：回 scope 前清掉已存回答（旧选择不得残留进定稿输入）。
      if (selectedOptionIds.includes("adjust-scope")) {
        answers.delete(input.sessionId);
        const stored = questionDrafts.get(workItem.id);
        if (!stored) {
          throw clarificationDraftMissingError(input.locale ?? "zh-CN");
        }
        return sessionVmFor(memoryRow(workItem), "scope", input.locale, stored);
      }
      // CHAT-2①：与持久化路径同口径——选项必须属于当前阶段真实渲染出去的选项集
      //（confirm 阶段的合法选项是确认卡哨兵 create-workitem/adjust-scope，见持久化路径同注释）。
      if (selectedOptionIds.length > 0) {
        const atConfirmStage = (answers.get(input.sessionId) ?? []).length > 0;
        const stored = questionDrafts.get(workItem.id);
        const validOptionIds = new Set(
          atConfirmStage
            ? (questionFor(memoryRow(workItem), "confirm", input.locale).options ?? []).map((option, index) => option.id ?? `option-${index + 1}`)
            : (stored?.options ?? []).map((option, index) => option.id ?? `option-${index + 1}`)
        );
        if (validOptionIds.size < 2 || selectedOptionIds.some((id) => !validOptionIds.has(id))) {
          throw new WorkItemServiceError(
            422,
            "clarification_option_invalid",
            (input.locale ?? "zh-CN") === "en-US"
              ? "The submitted option does not belong to the current clarification question. Refresh and answer again."
              : "提交的选项不属于当前澄清问题，请刷新后重新作答。"
          );
        }
      }
      // CHAT-2②：与持久化路径同口径——同一会话的回答 upsert 替换而非追加（幂等）。
      // 哨兵过滤：confirm 阶段的纯哨兵提交（create-workitem）不是内容回答——不落库、不覆盖 scope 回答。
      const contentOptionIds = selectedOptionIds.filter((id) => id !== "create-workitem" && id !== "adjust-scope");
      if (contentOptionIds.length === 0 && !input.payload.free_text && selectedOptionIds.length > 0) {
        return sessionVmFor(memoryRow(workItem), "confirm", input.locale);
      }
      answers.set(input.sessionId, [{ ...input.payload, selected_option_ids: contentOptionIds }]);
      return sessionVmFor(memoryRow(workItem), "confirm", input.locale);
    },

    async createWorkItem(input) {
      const workItem = input.payload.session_id
        ? requireWorkItem(input.payload.session_id)
        : putWorkItem({
            ...(input.payload.title ? { title: input.payload.title } : {}),
            ...(input.payload.raw_description ? { rawDescription: input.payload.raw_description } : {}),
            ...(input.payload.project_id ? { projectId: input.payload.project_id } : {}),
            actor: input.actor,
            status: "spec_ready"
          });
      const selectedOptionIds = input.payload.session_id
        ? mergeSelectedOptionIds(
            selectedOptionIdsForSession(workItem.id, input.payload.selected_option_ids),
            selectedOptionIdsFromLauncherSpec(input.payload.cuu_launcher_spec)
          )
        : mergeSelectedOptionIds(
            input.payload.selected_option_ids,
            selectedOptionIdsFromLauncherSpec(input.payload.cuu_launcher_spec)
          );
      const launcherSpec = launcherSpecForSelectedOptions(selectedOptionIds, input.payload.cuu_launcher_spec);
      const clarificationAnswers = input.payload.session_id ? clarificationAnswersForSession(workItem.id) : [];
      const planningNote = planningNoteForSelectedOptions({
        selectedOptionIds,
        launcherSpec,
        clarificationAnswers,
        finalFreeText: input.payload.free_text
      });
      const launcherAcceptanceItems = acceptanceItemsFromLauncherSpec(launcherSpec);
      workItem.status = "spec_ready";
      workItem.title = input.payload.title ?? workItem.title;
      workItem.raw_description = input.payload.raw_description ?? workItem.raw_description;
      workItem.summary_md = input.payload.raw_description ?? workItem.summary_md;
      if (planningNote) {
        workItem.planning_note = planningNote;
      }
      if (launcherAcceptanceItems.length) {
        const timestamp = at();
        acceptanceItems.set(workItem.id, launcherAcceptanceItems.map((item, index) => ({
          id: stableUuid(`${workItem.id}:launcher-acceptance:${index}:${item.title}`),
          work_item_id: workItem.id,
          title: item.title,
          ...(item.description ? { description: item.description } : {}),
          status: "open",
          sort_order: item.sortOrder,
          created_at: timestamp,
          updated_at: timestamp
        })));
      } else if (input.payload.session_id) {
        const timestamp = at();
        acceptanceItems.set(workItem.id, acceptanceItemsFromClarification(input.locale).map((item, index) => ({
          id: stableUuid(`${workItem.id}:clarification-acceptance:${index}:${item.title}`),
          work_item_id: workItem.id,
          title: item.title,
          ...(item.description ? { description: item.description } : {}),
          status: "open",
          sort_order: item.sortOrder,
          created_at: timestamp,
          updated_at: timestamp
        })));
      }
      workItem.updated_at = at();
      workItem.version += 1;
      return detail(workItem, input.locale);
    },

    async bindEvidence(input) {
      requireWorkItem(input.workItemId);
      evidence.set(input.workItemId, input.payload.evidence_refs);
      return detail(requireWorkItem(input.workItemId), input.locale);
    },

    async searchKnowledge(input) {
      const query = input.payload.query ?? input.payload.q;
      const refs = [...workItems.values()]
        .filter((item) => !input.payload.work_item_id || item.id === input.payload.work_item_id)
        .filter((item) => {
          if (!query) return true;
          const haystack = `${item.code} ${item.title ?? ""} ${item.raw_description ?? ""} ${item.summary_md ?? ""}`;
          return haystack.toLocaleLowerCase().includes(query.toLocaleLowerCase());
        })
        .slice(0, input.payload.limit ?? 10)
        .map((item) => ({
          id: item.id,
          source_type: "work_item" as const,
          source_id: item.code,
          title: item.title ?? item.code,
          ...(item.summary_md ? { excerpt: compactText(item.summary_md) } : {}),
          confidence_hint: "found" as const,
          // WIRE-09：证据「打开」要给 SPA 地址而非 JSON Page VM——与 PG 实现 evidenceRefFromWorkItem
          // （同文件上方，/workitems/:id）同口径；/api/pages/* 点过去只会看到一坨 JSON。
          href: `/workitems/${item.id}`
        }));
      return {
        id: stableUuid(`memory:evidence:${query ?? "recent"}:${input.payload.work_item_id ?? ""}`),
        ...(query ? { query_text: query } : {}),
        summary_text: refs.length > 0
          ? localizeGeneratedEvidenceSummary(refs.length, input.locale)
          : (input.locale === "en-US" ? "Not enough evidence is available yet. I will not invent sources." : "还没有找到足够证据，我不会编造来源。"),
        evidence_refs: refs,
        ...(refs.length === 0 ? { missing_evidence_note: workItemT(input.locale, "evidence.missing") } : {}),
        actions: [
          ...(input.payload.work_item_id && refs.length > 0
            ? [{
                id: "use_for_current_task" as const,
                label: workItemT(input.locale, "evidence.useCurrent"),
                method: "POST" as const,
                href: `/api/workitems/${input.payload.work_item_id}/evidence-bindings`
              }]
            : []),
          { id: "open_full_search", label: workItemT(input.locale, "evidence.openFull"), href: "/knowledge/search" }
        ]
      };
    },

    async detailPage(input) {
      return detail(requireWorkItem(input.workItemId), input.locale);
    },

    // In-memory fixture has no actor-based access model (requireWorkItem only checks existence) — mirror that:
    // any workItemId that exists in the map is "visible". Matches detailPage's lack of restriction above.
    // 内存双不建模项目名——返回空 Map（首页点名优雅降级）。
    async projectNamesForWorkItems() {
      return new Map<string, string>();
    },

    async canReadWorkItems(input) {
      return new Set(input.workItemIds.filter((id) => workItems.has(id)));
    },

    async assertCanMutateWorkItem(input) {
      requireWorkItem(input.workItemId);
    },

    async assertCanMutateArtifacts(input) {
      requireWorkItem(input.workItemId);
    },

    async acceptedDeliverableFile(input) {
      requireWorkItem(input.workItemId);
      throw new WorkItemServiceError(404, "deliverable_not_found", "没有找到这份正式交付物。");
    },

    async restoreAcceptedDeliverable(input) {
      requireWorkItem(input.workItemId);
      throw new WorkItemServiceError(409, "deliverable_no_previous_version", "这份正式交付物还没有上一版可还原。");
    }
  };
}

let defaultWorkItemService: WorkItemService | undefined;
let defaultWorkItemDbClient: WorkHubDatabaseClient | undefined;

export function getDefaultWorkItemService() {
  if (!defaultWorkItemService) {
    defaultWorkItemDbClient = getSharedDatabaseClient();
    defaultWorkItemService = createDbWorkItemService(createWorkItemRepository(defaultWorkItemDbClient.db), {
      providerRegistry: getDefaultProviderRegistry(),
      // API-04：入口澄清 LLM 的预算软闸（团队维度已用量，与 reply-judge 同款软闸口径）。
      budgetGate: async ({ workspaceId, locale }) => {
        if (!await checkEntryLlmBudget({ workspaceId })) {
          throw new WorkItemServiceError(429, "budget_exhausted", entryLlmBudgetExceededMessage(locale));
        }
      }
    });
  }
  return defaultWorkItemService;
}
