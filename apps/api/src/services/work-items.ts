import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import {
  createDatabaseClient,
  createWorkItemRepository,
  defaultSeedIds,
  type StoredWorkItemDetailRows,
  type WorkItemDataRepository,
  type WorkItemAgentStepRow,
  type WorkItemKnowledgeDocumentRow,
  type WorkItemRow,
  type WorkHubDatabaseClient
} from "@workhub/db";
import {
  deliverableChangeManifestSchema,
  evidenceRefSchema,
  sessionVmSchema,
  workItemDetailVmSchema,
  type AgentStep,
  type CreateSessionRequest,
  type CreateWorkItemRequest,
  type EvidenceBubble,
  type EvidenceRef,
  type NextQuestionRequest,
  type QuestionCard,
  type SessionVM,
  type UseEvidenceForTaskRequest,
  type WorkItem,
  type WorkItemDetailVM
} from "@workhub/contracts";

import type { AuthActor } from "../middleware/auth.js";

export const knowledgeSearchRequestSchema = z.object({
  q: z.string().trim().min(1).max(500).optional(),
  query: z.string().trim().min(1).max(500).optional(),
  project_id: z.string().uuid().optional(),
  work_item_id: z.string().uuid().optional(),
  run: z.string().min(1).max(128).optional(),
  scope: z.string().min(1).max(64).optional(),
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
  }) => Promise<SessionVM>;
  nextQuestion: (input: {
    sessionId: string;
    payload: NextQuestionRequest;
    actor: AuthActor;
  }) => Promise<SessionVM>;
  createWorkItem: (input: {
    payload: CreateWorkItemRequest;
    actor: AuthActor;
  }) => Promise<WorkItemDetailVM>;
  bindEvidence: (input: {
    workItemId: string;
    payload: UseEvidenceForTaskRequest;
    actor: AuthActor;
  }) => Promise<WorkItemDetailVM>;
  searchKnowledge: (input: {
    payload: KnowledgeSearchRequest;
    actor: AuthActor;
  }) => Promise<EvidenceBubble>;
  detailPage: (input: {
    workItemId: string;
    actor: AuthActor;
  }) => Promise<WorkItemDetailVM>;
};

type ServiceOptions = {
  now?: () => Date;
  id?: () => string;
  defaultProjectId?: string;
};

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

function titleFromIntent(intentText: string | undefined) {
  const compact = compactText(intentText, 64);
  return compact ?? "待澄清事项";
}

function assertCanReadDetail(rows: StoredWorkItemDetailRows, actor: AuthActor) {
  if (actor.isAdmin) {
    return;
  }
  const userId = actor.userId ?? actor.id;
  if (
    rows.workItem.submitterUserId === userId ||
    rows.workItem.claimedByUserId === userId ||
    rows.projectOwnerUserId === userId
  ) {
    return;
  }
  throw new WorkItemServiceError(403, "forbidden", "你没有权限查看这个事项。");
}

function toWorkItemVm(row: WorkItemRow): WorkItem {
  const workItem: WorkItem = {
    id: row.id,
    code: row.code,
    project_id: row.projectId,
    submitter_user_id: row.submitterUserId,
    status: row.status,
    priority: row.priority,
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

function evidenceRefFromDocument(row: WorkItemKnowledgeDocumentRow): EvidenceRef {
  const ref: EvidenceRef = {
    id: row.id,
    source_type: evidenceSourceType(row.sourceType),
    source_id: row.sourceId,
    title: row.title,
    locator: { path: row.corpusPath },
    confidence_hint: "found",
    href: row.sourceUrl
  };
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

function buildWorkItemDetail(rows: StoredWorkItemDetailRows): WorkItemDetailVM {
  const latestProposal = rows.latestProposal
    ? deliverableChangeManifestSchema.safeParse(rows.latestProposal.diffManifest)
    : undefined;
  return workItemDetailVmSchema.parse({
    workitem: toWorkItemVm(rows.workItem),
    acceptance: rows.acceptance.map((item) => ({
      id: item.id,
      work_item_id: item.workItemId,
      title: item.title,
      ...(item.description ? { description: item.description } : {}),
      status: item.status,
      sort_order: item.sortOrder,
      ...(item.sourcePlanId ? { source_plan_id: item.sourcePlanId } : {}),
      created_at: item.createdAt.toISOString(),
      updated_at: item.updatedAt.toISOString()
    })),
    agent_trace_preview: rows.agentSteps.map(toAgentStepVm),
    ...(latestProposal?.success ? { latest_proposal: latestProposal.data } : {}),
    evidence_refs: evidenceRefsFromBindings(rows.evidenceBindings)
  });
}

function questionFor(workItem: Pick<WorkItemRow, "id" | "title" | "rawDescription">, stage: "scope" | "confirm"): QuestionCard {
  if (stage === "confirm") {
    return {
      id: stableUuid(`${workItem.id}:question:confirm`),
      session_id: workItem.id,
      work_item_id: workItem.id,
      title: "是否按这个方向创建事项？",
      body: "点确认后会进入可执行事项；如果需要更多依据，可以先去检索项目证据。",
      input_mode: "confirm",
      options: [
        { id: "create-workitem", label: "创建事项", description: "进入 AI 可施工的 spec_ready 状态。", icon: "check" },
        { id: "search-evidence-first", label: "先找证据", description: "先从项目历史、文档和事项里找依据。", icon: "search" },
        { id: "adjust-scope", label: "调整范围", description: "回到上一步重新选择口径。", icon: "sliders" }
      ],
      recommended_option_ids: ["create-workitem"],
      free_text: {
        enabled: true,
        collapsed_by_default: true,
        placeholder: "需要补充时再写一句。",
        max_length: 300
      },
      progress: [
        { key: "intent", label: "需求", state: "done" },
        { key: "scope", label: "口径", state: "done" },
        { key: "confirm", label: "确认", state: "active" },
        { key: "run", label: "执行", state: "pending" }
      ],
      submit: {
        method: "POST",
        href: `/api/sessions/${workItem.id}/next-question`
      }
    };
  }

  const question: QuestionCard = {
    id: stableUuid(`${workItem.id}:question:scope`),
    session_id: workItem.id,
    work_item_id: workItem.id,
    title: "这件事先按哪种交付方式处理？",
    input_mode: "single_choice",
    options: [
      {
        id: "document-draft",
        label: "文档/方案草稿",
        description: "适合周报、方案、说明书、PR 式变更说明。",
        impact: "首发 L2 file-only 白名单内，风险最低。",
        risk_hint: "low",
        icon: "file-text"
      },
      {
        id: "structured-data",
        label: "结构化数据",
        description: "适合 JSON、YAML、CSV、配置或表格分析。",
        impact: "会保留字段级证据和回滚点。",
        risk_hint: "low",
        icon: "table"
      },
      {
        id: "code-template",
        label: "小型代码/模板",
        description: "适合低风险代码片段、模板或配置改动。",
        impact: "需要通过快照、测试和审批。",
        risk_hint: "medium",
        icon: "code"
      },
      {
        id: "let-ai-decide",
        label: "让 AI 判断",
        description: "我会按证据和风险选择最稳的交付路径。",
        impact: "不用打字，保持 option-first。",
        risk_hint: "low",
        icon: "sparkles"
      }
    ],
    recommended_option_ids: ["document-draft"],
    free_text: {
      enabled: true,
      collapsed_by_default: true,
      placeholder: "有特殊要求再补一句，不填也可以。",
      max_length: 300
    },
    progress: [
      { key: "intent", label: "需求", state: "done" },
      { key: "scope", label: "口径", state: "active" },
      { key: "confirm", label: "确认", state: "pending" },
      { key: "run", label: "执行", state: "pending" }
    ],
    submit: {
      method: "POST",
      href: `/api/sessions/${workItem.id}/next-question`
    }
  };
  const body = compactText(workItem.rawDescription ?? workItem.title, 160);
  if (body) {
    question.body = body;
  }
  return question;
}

function sessionVmFor(workItem: Pick<WorkItemRow, "id" | "title" | "rawDescription">, stage: "scope" | "confirm"): SessionVM {
  return sessionVmSchema.parse({
    session_id: workItem.id,
    work_item_id: workItem.id,
    topic: `session:${workItem.id}`,
    stream_href: `/api/push/stream/session/${workItem.id}`,
    next_question_href: `/api/sessions/${workItem.id}/next-question`,
    question: questionFor(workItem, stage)
  });
}

function handleMissingWorkItem(): never {
  throw new WorkItemServiceError(404, "not_found", "没有找到这个事项。");
}

export function createDbWorkItemService(repository: WorkItemDataRepository, options: ServiceOptions = {}): WorkItemService {
  const now = options.now ?? (() => new Date());
  const defaultProjectId = options.defaultProjectId ?? defaultSeedIds.projectId;

  async function resolveProject(projectId?: string) {
    if (projectId) {
      const project = await repository.findProjectById(projectId);
      if (!project) {
        throw new WorkItemServiceError(404, "project_not_found", "没有找到这个项目。");
      }
      return project;
    }
    const seeded = await repository.findProjectById(defaultProjectId);
    if (seeded) {
      return seeded;
    }
    const first = await repository.findFirstActiveProject();
    if (!first) {
      throw new WorkItemServiceError(404, "project_not_found", "还没有可用项目，无法创建事项。");
    }
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

  return {
    async createSession(input) {
      if (input.payload.work_item_id) {
        const rows = await requireDetail(input.payload.work_item_id, input.actor);
        return sessionVmFor(rows.workItem, "scope");
      }

      const project = await resolveProject(input.payload.project_id);
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
      return sessionVmFor(workItem, "scope");
    },

    async nextQuestion(input) {
      const rows = await requireDetail(input.sessionId, input.actor);
      const selectedOptionIds = input.payload.selected_option_ids ?? [];
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
      return sessionVmFor(rows.workItem, "confirm");
    },

    async createWorkItem(input) {
      if (input.payload.session_id) {
        const rows = await requireDetail(input.payload.session_id, input.actor);
        const updateInput: Parameters<WorkItemDataRepository["updateWorkItemFromSession"]>[0] = {
          workItemId: rows.workItem.id,
          title: input.payload.title ?? rows.workItem.title ?? titleFromIntent(rows.workItem.rawDescription ?? undefined),
          status: input.payload.kickoff_agent ? "ai_working" : "spec_ready",
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
        if (input.payload.selected_option_ids) {
          updateInput.selectedOptionIds = input.payload.selected_option_ids;
        }
        const updated = await repository.updateWorkItemFromSession(updateInput);
        if (!updated) {
          handleMissingWorkItem();
        }
        await repository.insertChatMessage({
          workItemId: updated.id,
          role: "system",
          kind: "workitem_finalized",
          contentJson: {
            selected_option_ids: input.payload.selected_option_ids ?? [],
            kickoff_agent: input.payload.kickoff_agent ?? false
          },
          at: now()
        });
        return buildWorkItemDetail(await requireDetail(updated.id, input.actor));
      }

      const project = await resolveProject(input.payload.project_id);
      const title = input.payload.title ?? titleFromIntent(input.payload.raw_description);
      const createInput: Parameters<WorkItemDataRepository["createWorkItem"]>[0] = {
        projectId: project.id,
        workspaceId: project.workspaceId,
        submitterUserId: input.actor.userId ?? input.actor.id,
        title,
        rawDescription: input.payload.raw_description ?? title,
        summaryMd: input.payload.raw_description ?? `准备执行：${title}`,
        status: input.payload.kickoff_agent ? "ai_working" : "spec_ready",
        at: now()
      };
      if (input.payload.selected_option_ids) {
        createInput.selectedOptionIds = input.payload.selected_option_ids;
      }
      const created = await repository.createWorkItem(createInput);
      return buildWorkItemDetail(await requireDetail(created.id, input.actor));
    },

    async bindEvidence(input) {
      await requireDetail(input.workItemId, input.actor);
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
      return buildWorkItemDetail(await requireDetail(input.workItemId, input.actor));
    },

    async searchKnowledge(input) {
      const query = input.payload.query ?? input.payload.q;
      const searchInput: Parameters<WorkItemDataRepository["searchKnowledge"]>[0] = {};
      if (query) searchInput.query = query;
      if (input.payload.project_id) searchInput.projectId = input.payload.project_id;
      if (input.payload.work_item_id) searchInput.workItemId = input.payload.work_item_id;
      if (input.payload.limit) searchInput.limit = input.payload.limit;
      const rows = await repository.searchKnowledge(searchInput);
      const refs = [
        ...rows.documents.map(evidenceRefFromDocument),
        ...rows.workItems.map(evidenceRefFromWorkItem)
      ].slice(0, Math.max(1, Math.min(input.payload.limit ?? 10, 20)));
      const bubble: EvidenceBubble = {
        id: stableUuid(`evidence:${input.actor.id}:${query ?? "recent"}:${input.payload.project_id ?? ""}:${input.payload.work_item_id ?? ""}`),
        ...(query ? { query_text: query } : {}),
        summary_text: refs.length > 0
          ? `找到了 ${refs.length} 条可引用证据。`
          : "还没有找到足够证据，我不会编造来源。",
        evidence_refs: refs,
        ...(refs.length === 0 ? { missing_evidence_note: "请先上传文档、同步项目文件，或缩小检索范围。" } : {}),
        actions: [
          ...(input.payload.work_item_id && refs.length > 0
            ? [{
                id: "use_for_current_task" as const,
                label: "用这些证据继续",
                method: "POST" as const,
                href: `/api/workitems/${input.payload.work_item_id}/evidence-bindings`
              }]
            : []),
          {
            id: "open_full_search",
            label: "打开完整检索",
            href: `/knowledge/search${query ? `?q=${encodeURIComponent(query)}` : ""}`
          },
          {
            id: "ask_followup",
            label: "换个问法再找",
            href: "/knowledge/search"
          }
        ]
      };
      return bubble;
    },

    async detailPage(input) {
      return buildWorkItemDetail(await requireDetail(input.workItemId, input.actor));
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
  const evidence = new Map<string, EvidenceRef[]>();

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
    actor: AuthActor;
    status: WorkItem["status"];
  }) {
    const id = nextId();
    const createdAt = at();
    const workItem: MemoryStoredWorkItem = {
      id,
      code: `MEM-${String(++sequence).padStart(3, "0")}`,
      project_id: options.defaultProjectId ?? defaultSeedIds.projectId,
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

  function detail(workItem: MemoryStoredWorkItem): WorkItemDetailVM {
    return workItemDetailVmSchema.parse({
      workitem: workItem,
      acceptance: [
        { id: "option-first", title: "点选澄清完成", status: answers.has(workItem.id) ? "met" : "open" },
        { id: "evidence-bound", title: "证据已绑定", status: (evidence.get(workItem.id)?.length ?? 0) > 0 ? "met" : "open" }
      ],
      agent_trace_preview: [],
      evidence_refs: evidence.get(workItem.id) ?? []
    });
  }

  return {
    async createSession(input) {
      const workItem = input.payload.work_item_id
        ? requireWorkItem(input.payload.work_item_id)
        : putWorkItem({
            ...(input.payload.title ? { title: input.payload.title } : {}),
            ...(input.payload.intent_text ? { rawDescription: input.payload.intent_text } : {}),
            actor: input.actor,
            status: "ai_clarifying"
          });
      return sessionVmFor(memoryRow(workItem), "scope");
    },

    async nextQuestion(input) {
      const workItem = requireWorkItem(input.sessionId);
      answers.set(input.sessionId, [...(answers.get(input.sessionId) ?? []), input.payload]);
      return sessionVmFor(memoryRow(workItem), "confirm");
    },

    async createWorkItem(input) {
      const workItem = input.payload.session_id
        ? requireWorkItem(input.payload.session_id)
        : putWorkItem({
            ...(input.payload.title ? { title: input.payload.title } : {}),
            ...(input.payload.raw_description ? { rawDescription: input.payload.raw_description } : {}),
            actor: input.actor,
            status: input.payload.kickoff_agent ? "ai_working" : "spec_ready"
          });
      workItem.status = input.payload.kickoff_agent ? "ai_working" : "spec_ready";
      workItem.title = input.payload.title ?? workItem.title;
      workItem.raw_description = input.payload.raw_description ?? workItem.raw_description;
      workItem.summary_md = input.payload.raw_description ?? workItem.summary_md;
      workItem.updated_at = at();
      workItem.version += 1;
      return detail(workItem);
    },

    async bindEvidence(input) {
      requireWorkItem(input.workItemId);
      evidence.set(input.workItemId, input.payload.evidence_refs);
      return detail(requireWorkItem(input.workItemId));
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
        summary_text: refs.length > 0 ? `找到了 ${refs.length} 条可引用证据。` : "还没有找到足够证据，我不会编造来源。",
        evidence_refs: refs,
        ...(refs.length === 0 ? { missing_evidence_note: "请先上传或同步项目资料。" } : {}),
        actions: [
          ...(input.payload.work_item_id && refs.length > 0
            ? [{
                id: "use_for_current_task" as const,
                label: "用这些证据继续",
                method: "POST" as const,
                href: `/api/workitems/${input.payload.work_item_id}/evidence-bindings`
              }]
            : []),
          { id: "open_full_search", label: "打开完整检索", href: "/knowledge/search" }
        ]
      };
    },

    async detailPage(input) {
      return detail(requireWorkItem(input.workItemId));
    }
  };
}

let defaultWorkItemService: WorkItemService | undefined;
let defaultWorkItemDbClient: WorkHubDatabaseClient | undefined;

export function getDefaultWorkItemService() {
  if (!defaultWorkItemService) {
    defaultWorkItemDbClient = createDatabaseClient();
    defaultWorkItemService = createDbWorkItemService(createWorkItemRepository(defaultWorkItemDbClient.db));
  }
  return defaultWorkItemService;
}
