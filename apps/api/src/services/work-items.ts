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

import { ASSIGNMENT_ROLES, canViewProjectDrive, canViewWorkItemRecord } from "@workhub/permissions";

import type { AuthActor } from "../middleware/auth.js";
import { parseOutputContract } from "../pages/output-contract.js";
import { acceptedDeliverableToVm } from "./accepted-deliverables.js";
import { getDefaultProviderRegistry } from "./provider-registry.js";

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
    "question.confirm.title": "是否按这个方向创建事项？",
    "question.confirm.body": "点确认后会进入可执行事项；如果需要更多依据，可以先去检索项目证据。",
    "question.confirm.create.label": "创建事项",
    "question.confirm.create.description": "进入 AI 可施工的 spec_ready 状态。",
    "question.confirm.evidence.label": "先找证据",
    "question.confirm.evidence.description": "先从项目历史、文档和事项里找依据。",
    "question.confirm.adjust.label": "调整范围",
    "question.confirm.adjust.description": "回到上一步补充澄清回答。",
    "question.clarify.title": "需要先确认一个关键点",
    "question.clarify.placeholder": "直接补一句：必须依据的文件、目标读者、输出形式或验收口径。",
    "question.scope.title": "这件事先按哪种交付方式处理？",
    "question.scope.document.label": "文档/方案草稿",
    "question.scope.document.description": "适合周报、方案、说明书、PR 式变更说明。",
    "question.scope.document.impact": "首发 L2 file-only 白名单内，风险最低。",
    "question.scope.data.label": "结构化数据",
    "question.scope.data.description": "适合 JSON、YAML、CSV、配置或表格分析。",
    "question.scope.data.impact": "会保留字段级证据和回滚点。",
    "question.scope.code.label": "小型代码/模板",
    "question.scope.code.description": "适合低风险代码片段、模板或配置改动。",
    "question.scope.code.impact": "需要通过快照、测试和审批。",
    "question.scope.ai.label": "让 AI 判断",
    "question.scope.ai.description": "我会按证据和风险选择最稳的交付路径。",
    "question.scope.ai.impact": "不用打字，保持 option-first。",
    "question.free.placeholder": "有特殊要求再补一句，不填也可以。",
    "question.progress.intent": "需求",
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
    "question.confirm.title": "Create the work item with this direction?",
    "question.confirm.body": "Confirming turns this into executable work. If more support is needed, search project evidence first.",
    "question.confirm.create.label": "Create work item",
    "question.confirm.create.description": "Move into the spec_ready state so AI can start work.",
    "question.confirm.evidence.label": "Find evidence first",
    "question.confirm.evidence.description": "Search project history, documents, and related work first.",
    "question.confirm.adjust.label": "Adjust scope",
    "question.confirm.adjust.description": "Go back and refine the clarification answer.",
    "question.clarify.title": "One key detail to confirm",
    "question.clarify.placeholder": "Add the required file, audience, output shape, or acceptance criteria.",
    "question.scope.title": "Which delivery path should this use first?",
    "question.scope.document.label": "Document / plan draft",
    "question.scope.document.description": "Best for reports, plans, manuals, and PR-style change notes.",
    "question.scope.document.impact": "Lowest risk in the first L2 file-only allowlist.",
    "question.scope.data.label": "Structured data",
    "question.scope.data.description": "Best for JSON, YAML, CSV, configuration, or spreadsheet analysis.",
    "question.scope.data.impact": "Keeps field-level evidence and rollback points.",
    "question.scope.code.label": "Small code / template",
    "question.scope.code.description": "Best for low-risk snippets, templates, or configuration changes.",
    "question.scope.code.impact": "Requires snapshots, tests, and approval.",
    "question.scope.ai.label": "Let AI decide",
    "question.scope.ai.description": "AI will choose the most stable delivery path from evidence and risk.",
    "question.scope.ai.impact": "No typing required; keeps the option-first flow.",
    "question.free.placeholder": "Add special requirements only if needed.",
    "question.progress.intent": "Intent",
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
  ["澄清必须点选优先", "Clarification must stay option-first"],
  ["交付物变更申请必须像 PR 一样可审", "Deliverable change requests must be PR-like and reviewable"],
  ["Replay footer 必须显示成本切片", "Replay footer must show cost slices"]
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

const clarificationQuestionDraftSchema = z.object({
  title: z.string().trim().min(2).max(160),
  body: z.string().trim().max(900).optional(),
  placeholder: z.string().trim().max(180).optional()
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
  const draft = {
    title,
    body: questionText ? compactText(bodyText, 900) : undefined,
    placeholder: compactText(pickClarificationTextField(raw, ["placeholder"]), 180)
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
  return {
    title: parsed.data.title,
    ...(body ? { body } : {}),
    ...(placeholder ? { placeholder } : {})
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

async function fileContextFromDriveRows(rows: DrivePageRows, intentText: string | undefined): Promise<ClarificationFileContext[]> {
  const itemsById = new Map(rows.items.map((item) => [item.id, item]));
  const fileItems = rows.items
    .filter((item) => item.kind === "file")
    .map((item, index) => ({ item, index, path: driveItemPath(item, itemsById) }))
    .sort((left, right) => {
      const byRelevance = driveFileRelevanceScore({ item: right.item, path: right.path, intentText })
        - driveFileRelevanceScore({ item: left.item, path: left.path, intentText });
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
    `{"title":"...","body":"...","placeholder":"..."}`,
    zh
      ? "规则：只问一个问题；不要问预设交付方式；不要使用“需要确认一个关键点”这类泛化标题；反问必须引用用户需求或项目文件中的具体信息；优先围绕文件依据、验收口径、目标读者、缺失输入；如果信息足够，就让用户确认你将采用的文件和假设；使用中文。"
      : "Rules: ask exactly one question; do not ask for a preset delivery type; do not use generic titles like 'One key detail to confirm'; the question must reference concrete information from the user request or project files; prioritize source file, acceptance criteria, audience, or missing input; if enough information exists, ask the user to confirm the file and assumptions; use English.",
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
    .slice(0, 12);
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
    const response = await client.messages.create({
      maxTokens: CLARIFICATION_LLM_MAX_TOKENS,
      source: "agent_step",
      timeoutMs: CLARIFICATION_LLM_TIMEOUT_MS,
      system: "You are WorkHub's intake clarifier. Return strict JSON only. Never include secrets or unrelated implementation advice.",
      messages: [{
        role: "user",
        content: clarificationPrompt(input)
      }]
    });
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
    href: `/api/pages/workitems/${row.id}`
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

  return parseOutputContract(workItemAgentTeamVmSchema, {
    plan_id: rows.plan.id,
    status: rows.plan.status,
    completed_count: completedCount,
    total_count: rows.items.length,
    cost_used_cny: formatCostCny(costUsed),
    ...(costBudget ? { cost_budget_cny: costBudget } : {}),
    ...(costBurnPct !== undefined ? { cost_burn_pct: costBurnPct } : {}),
    runs_capped: rows.runsCapped ?? false,
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
  options: { includeAcceptedDeliverableRestore?: boolean; includeSourceProposalDraftAction?: boolean } = {}
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
  const sourceContext = driveSourceContext ?? meetingSourceContext;
  const taskPlan = taskPlanToVm(rows.taskPlan);
  const agentTeam = taskPlanAgentTeamToVm(rows.taskPlan, locale);
  const canCreateSourceProposal = sourceContext
    && !latestProposalId
    && (sourceContext.source_type === "drive_comment"
      ? sourceContext.status !== "dismissed"
      : sourceContext.status === "confirmed");
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
    accepted_deliverables: rows.acceptedDeliverables.map((row) =>
      options.includeAcceptedDeliverableRestore === undefined
        ? acceptedDeliverableToVm(row)
        : acceptedDeliverableToVm(row, { includeRestore: options.includeAcceptedDeliverableRestore })
    ),
    evidence_refs: evidenceRefsFromBindings(rows.evidenceBindings),
    ...(taskPlan ? { task_plan: taskPlan } : {}),
    ...(agentTeam ? { agent_team: agentTeam } : {}),
    ...(sourceContext ? { source_context: sourceContext } : {}),
    actions: {
      ...(createProposalAction ? { create_proposal_draft: createProposalAction } : {})
    }
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
      body: workItemT(locale, "question.confirm.body"),
      input_mode: "confirm",
      options: [
        { id: "create-workitem", label: workItemT(locale, "question.confirm.create.label"), description: workItemT(locale, "question.confirm.create.description"), icon: "check" },
        { id: "search-evidence-first", label: workItemT(locale, "question.confirm.evidence.label"), description: workItemT(locale, "question.confirm.evidence.description"), icon: "search" },
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
  const question: QuestionCard = {
    id: stableUuid(`${workItem.id}:question:scope`),
    session_id: workItem.id,
    work_item_id: workItem.id,
    title: draft.title,
    ...(draft.body ? { body: draft.body } : {}),
    input_mode: "long_text",
    options: [],
    recommended_option_ids: [],
    free_text: {
      enabled: true,
      collapsed_by_default: false,
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
      throw new WorkItemServiceError(404, "project_not_found", "还没有可用项目，无法创建事项。");
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

  async function clarificationDraftFor(
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
      await repository.insertChatMessage({
        workItemId: workItem.id,
        role: "system",
        kind: "clarification_file_context_error",
        contentJson: {
          message: error instanceof Error ? error.message : "project file context failed"
        },
        at: now()
      });
      throw clarificationFileContextFailedError(locale);
    }
    // R9 批次0-2：点名文件没找到不再 502（并连带 cancel 工单）——降级为留痕后继续，
    // 让澄清反问自然向用户确认缺失的材料。识别本身有误报可能，阻断主流程代价不对称。
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
    const input: ClarificationQuestionInput = { workItem, actor, locale, files };
    if (stored && canReuseStoredClarificationDraft(stored, input)) {
      return stored;
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
          message: error instanceof Error ? error.message : "clarification analysis failed",
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
          message: "clarification analysis returned a generic template",
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
    return sessionVmFor(workItem, "scope", locale, await clarificationDraftFor(workItem, actor, locale));
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
        try {
          await repository.updateWorkItemFromSession({
            workItemId: workItem.id,
            status: "cancelled",
            planningNote: "clarification_session_failed",
            at: now()
          });
        } catch (cancelError) {
          void cancelError;
        }
        throw error;
      }
    },

    async getSession(input) {
      const rows = await requireDetail(input.sessionId, input.actor);
      assertCanMutateWorkItemRows(rows, input.actor);
      const clarificationAnswers = await repository.listSessionClarificationAnswers(rows.workItem.id);
      if (clarificationAnswers.length > 0) {
        return sessionVmFor(rows.workItem, "confirm", input.locale);
      }
      return scopeSessionVmFor(rows.workItem, input.actor, input.locale);
    },

    async nextQuestion(input) {
      const rows = await requireDetail(input.sessionId, input.actor);
      assertCanMutateWorkItemRows(rows, input.actor);
      const selectedOptionIds = input.payload.selected_option_ids ?? [];
      // M10: "调整范围"(adjust-scope) on the confirm step is navigation back to the
      // scope question, not a clarification answer. Re-rendering confirm would trap
      // the user on the same screen; send them back to scope to re-choose and don't
      // record the navigation as an answer.
      if (selectedOptionIds.includes("adjust-scope")) {
        return scopeSessionVmFor(rows.workItem, input.actor, input.locale);
      }
      await repository.insertChatMessage({
        workItemId: rows.workItem.id,
        role: "user",
        kind: "clarification_answer",
        contentJson: {
          selected_option_ids: selectedOptionIds,
          free_text: input.payload.free_text ?? null
        },
        ...(selectedOptionIds[0] ? { selectedOptionKey: selectedOptionIds[0] } : {}),
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
          throw new WorkItemServiceError(409, "workitem_state_conflict", "这个事项的当前状态不允许重新定稿。");
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
      return buildWorkItemDetail(rows, input.locale, {
        includeAcceptedDeliverableRestore: canMutate,
        includeSourceProposalDraftAction: canMutate
      });
    },

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
      return hasAnswers
        ? sessionVmFor(memoryRow(workItem), "confirm", input.locale)
        : memoryScopeSessionVmFor(workItem, input.actor, input.locale);
    },

    async nextQuestion(input) {
      const workItem = requireWorkItem(input.sessionId);
      // M10: mirror the persistent path — "调整范围"(adjust-scope) navigates back to
      // the scope question instead of dead-ending on confirm, and is not recorded.
      if ((input.payload.selected_option_ids ?? []).includes("adjust-scope")) {
        return memoryScopeSessionVmFor(workItem, input.actor, input.locale);
      }
      answers.set(input.sessionId, [...(answers.get(input.sessionId) ?? []), input.payload]);
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
          href: `/api/pages/workitems/${item.id}`
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
      providerRegistry: getDefaultProviderRegistry()
    });
  }
  return defaultWorkItemService;
}
