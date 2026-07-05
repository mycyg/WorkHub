import {
  budgetNoticeSchema,
  eventTypes,
  type ActionSpec,
  type AgentRunLiveVM,
  type AttentionAction,
  type AttentionItem,
  type BudgetNotice,
  type BudgetScope,
  type CostDashboardVM,
  type CuuState,
  type EvidenceBubble,
  type EvidenceRef,
  type GoldPathSurfaceVM,
  type ProposalConflict,
  type ProposalConflictOption,
  type ProposalDetailVM,
  type QuestionCard,
  type ReplayTraceVM,
  type SessionVM,
  type WorkItemDetailVM,
  type WorkItemStatus,
  type WorkHubEvent
} from "@workhub/contracts";
import { toAttentionItem } from "@workhub/events/toAttentionItem";
import { toCuuState } from "@workhub/events/toCuuState";

import { cuuMotionForState, type CuuMotionHint } from "./motion.js";
import { cuuFormat, cuuT, type CuuLocaleOptions } from "./i18n.js";

export type CuuCardKind =
  | "bubble"
  | "question"
  | "approval"
  | "proposal"
  | "evidence"
  | "budget"
  | "sync"
  | "trace"
  | "completion"
  | "offline";

export type CuuCardActionTone = "primary" | "secondary" | "danger" | "quiet";

export type CuuCardAction = {
  id: string;
  label: string;
  tone: CuuCardActionTone;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  href?: string;
  requires_desktop?: boolean;
  requires_reason?: boolean;
  payload?: Record<string, unknown>;
};

export type CuuCardChip = {
  id: string;
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger";
  description?: string;
  metadata?: Record<string, unknown>;
  recommended?: boolean;
  selected?: boolean;
  href?: string;
};

export type CuuCardSection = {
  id: string;
  title: string;
  lines: string[];
};

export type CuuCardProgressStep = {
  key: string;
  label: string;
  state: "done" | "active" | "pending";
  index: number;
};

export type CuuCardInputPolicy = {
  mode: QuestionCard["input_mode"];
  option_first: boolean;
  free_text_enabled: boolean;
  free_text_collapsed_by_default: boolean;
  free_text_placeholder?: string;
  free_text_max_length?: number;
};

export type CuuPayloadRef = {
  entity_type:
    | "attention"
    | "question"
    | "evidence"
    | "proposal"
    | "budget_notice"
    | "cost_dashboard"
    | "replay_trace"
    | "session"
    | "workitem"
    | "agent_run"
    | "event"
    | "proposal_conflict";
  entity_id: string;
  href?: string;
};

export type CuuCardSource = {
  entity_type: AttentionItem["source_ref"]["entity_type"] | "event" | "page_vm";
  entity_id: string;
  work_item_id?: string;
  project_id?: string;
};

export type CuuCard = {
  id: string;
  kind: CuuCardKind;
  state: CuuState;
  motion: CuuMotionHint;
  title: string;
  message: string;
  priority: AttentionItem["priority"];
  actions: CuuCardAction[];
  chips?: CuuCardChip[];
  sections?: CuuCardSection[];
  progress?: CuuCardProgressStep[];
  input?: CuuCardInputPolicy;
  evidence_refs?: EvidenceRef[];
  payload_ref?: CuuPayloadRef;
  source?: CuuCardSource;
  created_at?: string;
  expires_at?: string;
};

const stateByAttentionKind: Record<AttentionItem["kind"], CuuState> = {
  clarification: "asking_approval",
  approval: "asking_approval",
  plan_review: "asking_approval",
  proposal_review: "carrying_document",
  escalation: "worried",
  sync_conflict: "worried",
  knowledge_result: "searching_evidence",
  budget: "worried",
  delivery_ready: "carrying_document",
  system_health: "idle"
};

const defaultAttentionSummary = "WorkHub 有新的状态更新。";

function withMotion(input: Omit<CuuCard, "motion">): CuuCard {
  return {
    ...input,
    motion: cuuMotionForState(input.state)
  };
}

function truncate(text: string, max = 220) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= max) {
    return compact;
  }
  return `${compact.slice(0, max - 1)}...`;
}

function isModelSelfNarrationTitle(title: string) {
  return /deliverable is written|(?:deliverable|file) looks (?:good and )?complete|well-structured|let me now provide|summary in chinese|as require|接下来我|我会先|我已经|完成了?[。.!！\s]*(?:让?我来?|接下来我|我(?:会|要|将|可以|已经)).{0,24}(?:总结|说明|整理|输出|回复)/iu.test(title);
}

function stripProposalOpenedPrefix(text: string) {
  return text.replace(/^(?:AI|Cuu)\s*已(?:生成|创建|准备好)?变更申请[：:\s]+/iu, "").trim();
}

function publicProposalTitle(title: string, options: CuuLocaleOptions = {}) {
  const compact = truncate(stripProposalOpenedPrefix(title), 96);
  return isModelSelfNarrationTitle(compact) ? cuuT(options.locale, "proposal.reviewTitle") : compact;
}

function normalizeProposalMergeVerb(text: string, options: CuuLocaleOptions = {}) {
  if (options.locale === "en-US") {
    return text;
  }
  return text
    .replaceAll("采纳这次版本", "合入这次版本")
    .replaceAll("正式采纳", "正式合入")
    .replaceAll("是否采纳", "是否合入");
}

function publicProposalSummary(text: string | undefined, options: CuuLocaleOptions = {}) {
  const compact = truncate(stripProposalOpenedPrefix(text ?? "")
    .replaceAll("进入派发", "开始执行")
    .replaceAll("自动派发", "自动开始执行")
    .replaceAll("派发", "开始执行")
    .replace(/\bdispatch(?:ed|ing)?\b/gi, options.locale === "en-US" ? "start work" : "开始执行"), 180);
  return !compact || isModelSelfNarrationTitle(compact)
    ? cuuT(options.locale, "proposal.summaryFallback")
    : normalizeProposalMergeVerb(compact, options);
}

function proposalNextStepForStatus(status: ProposalDetailVM["status"], options: CuuLocaleOptions = {}) {
  switch (status) {
    case "opened":
      return cuuT(options.locale, "proposal.nextStepOpened");
    case "reviewed":
      return cuuT(options.locale, "proposal.nextStepReviewed");
    case "merged":
      return cuuT(options.locale, "proposal.nextStepMerged");
    case "rejected":
      return cuuT(options.locale, "proposal.nextStepRejected");
  }
}

function proposalNextStepForAttention(item: AttentionItem, options: CuuLocaleOptions = {}) {
  if (item.kind === "plan_review") {
    return cuuT(options.locale, "proposal.planNextStepOpened");
  }
  const actionIds = new Set(item.actions.map((action) => action.id));
  if (actionIds.has("merge")) {
    return cuuT(options.locale, "proposal.nextStepReviewed");
  }
  if (actionIds.has("approve") || actionIds.has("allow") || actionIds.has("request_changes")) {
    return cuuT(options.locale, "proposal.nextStepOpened");
  }
  return cuuT(options.locale, "proposal.nextStepOpenReview");
}

function proposalNextStepSection(line: string, options: CuuLocaleOptions = {}): CuuCardSection {
  return {
    id: "next_step",
    title: cuuT(options.locale, "proposal.nextStepSection"),
    lines: [line]
  };
}

function attentionHasAction(item: AttentionItem, actionId: string) {
  return item.actions.some((action) => action.id === actionId);
}

function isProposalLikeAttentionKind(kind: AttentionItem["kind"]) {
  return kind === "plan_review" || kind === "proposal_review" || kind === "delivery_ready";
}

function stateForAttentionItem(item: AttentionItem): CuuState {
  if (isProposalLikeAttentionKind(item.kind) && attentionHasAction(item, "merge")) {
    return "carrying_document";
  }
  return item.cuu_state ?? stateByAttentionKind[item.kind];
}

function publicProposalAttentionTitle(item: AttentionItem, message: string, options: CuuLocaleOptions = {}) {
  const title = publicProposalTitle(item.title, options);
  if (attentionHasAction(item, "merge")) {
    if (
      title === message
      || title === cuuT(options.locale, "proposal.reviewTitle")
      || title === cuuT(options.locale, "proposal.mergeTitle")
    ) {
      return cuuT(options.locale, "proposal.mergeTitle");
    }
    return cuuFormat(options.locale, "proposal.mergeTitleNamed", { title });
  }
  return title === message ? cuuT(options.locale, "proposal.reviewTitle") : title;
}

function optionalSource(input: {
  entity_type: CuuCardSource["entity_type"];
  entity_id: string;
  work_item_id?: string;
  project_id?: string;
}): CuuCardSource {
  return {
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    ...(input.work_item_id ? { work_item_id: input.work_item_id } : {}),
    ...(input.project_id ? { project_id: input.project_id } : {})
  };
}

function localizedAttentionActionLabel(
  action: AttentionAction,
  item: AttentionItem,
  options: CuuLocaleOptions
) {
  if (item.kind !== "approval" && !isProposalLikeAttentionKind(item.kind) && item.kind !== "escalation") {
    return action.label;
  }
  switch (action.id) {
    case "escalation_retry":
      return options.locale === "en-US" ? "Let it retry" : "让它重试";
    case "escalation_pm_mode":
      return options.locale === "en-US" ? "I'll take over" : "转成我来做";
    case "escalation_cancel":
      return options.locale === "en-US" ? "Cancel this subtask" : "取消这个子任务";
    case "approve":
    case "allow":
      if (item.kind === "plan_review") {
        return cuuT(options.locale, "proposal.approvePlanReview");
      }
      if (isProposalLikeAttentionKind(item.kind)) {
        return cuuT(options.locale, "proposal.approveReview");
      }
      return cuuT(options.locale, "pet.action.approve");
    case "approve_and_dispatch":
      return cuuT(options.locale, "proposal.approvePlanAndStart");
    case "approve_hold":
      return cuuT(options.locale, "proposal.approvePlanHold");
    case "start_task_plan":
      return cuuT(options.locale, "proposal.startHeldPlan");
    case "request_replan":
      return cuuT(options.locale, "proposal.requestReplan");
    case "request_changes":
    case "deny":
    case "reject":
      if (item.kind === "plan_review") {
        return cuuT(options.locale, "proposal.requestReplan");
      }
      if (isProposalLikeAttentionKind(item.kind)) {
        return cuuT(options.locale, "proposal.requestChanges");
      }
      return cuuT(options.locale, "pet.action.requestChanges");
    case "open_proposal":
      return item.kind === "plan_review" || attentionHasAction(item, "start_task_plan")
        ? cuuT(options.locale, "proposal.openPlanReview")
        : cuuT(options.locale, "proposal.openReview");
    case "open":
    case "view":
      return isProposalLikeAttentionKind(item.kind)
        ? cuuT(options.locale, item.kind === "plan_review" || attentionHasAction(item, "start_task_plan") ? "proposal.openPlanReview" : "proposal.openReview")
        : cuuT(options.locale, "pet.action.open");
    default:
      return action.label;
  }
}

function mapAttentionAction(action: AttentionAction, item: AttentionItem, options: CuuLocaleOptions): CuuCardAction {
  return {
    id: action.id,
    label: localizedAttentionActionLabel(action, item, options),
    tone: action.style,
    method: action.method,
    href: action.href,
    ...(action.requires_desktop ? { requires_desktop: action.requires_desktop } : {}),
    ...(action.requires_reason ? { requires_reason: action.requires_reason } : {}),
    ...(action.request_json ? { payload: action.request_json } : {})
  };
}

function sortAttentionActionsForUser(actions: CuuCardAction[], item: AttentionItem) {
  if (!isProposalLikeAttentionKind(item.kind)) {
    return actions;
  }
  const rank = (action: CuuCardAction) => {
    if (action.id === "open" || action.id === "open_proposal" || action.id === "view") {
      return 0;
    }
    if (action.id === "approve" || action.id === "allow" || action.id === "approve_and_dispatch" || action.id === "start_task_plan") {
      return 1;
    }
    if (action.id === "approve_hold") {
      return 2;
    }
    if (action.id === "request_replan" || action.id === "request_changes" || action.id === "deny" || action.id === "reject") {
      return 3;
    }
    return 4;
  };
  return [...actions].sort((a, b) => rank(a) - rank(b));
}

function isSessionNextQuestionAction(action: CuuCardAction) {
  return action.method === "POST" && /\/api\/sessions\/[^/]+\/next-question(?:$|[?#])/u.test(action.href ?? "");
}

function clarificationInputForAttention(
  item: AttentionItem,
  actions: CuuCardAction[],
  options: CuuLocaleOptions
): CuuCardInputPolicy | undefined {
  if (item.kind !== "clarification" || !actions.some(isSessionNextQuestionAction)) {
    return undefined;
  }
  return {
    mode: "long_text",
    option_first: false,
    free_text_enabled: true,
    free_text_collapsed_by_default: false,
    free_text_placeholder: cuuT(options.locale, "pet.input.textNeeded")
  };
}

function mapActionSpec(action: ActionSpec, tone: CuuCardActionTone): CuuCardAction {
  return {
    id: action.id,
    label: action.label,
    tone,
    method: action.method,
    href: action.href,
    ...(action.requires_desktop ? { requires_desktop: action.requires_desktop } : {}),
    ...(action.requires_reason ? { requires_reason: action.requires_reason } : {}),
    ...(action.request_json ? { payload: action.request_json } : {})
  };
}

function evidenceById(evidenceRefs: EvidenceRef[]) {
  const seen = new Set<string>();
  const result: EvidenceRef[] = [];
  for (const evidence of evidenceRefs) {
    if (!seen.has(evidence.id)) {
      seen.add(evidence.id);
      result.push(evidence);
    }
  }
  return result;
}

function budgetScopeChip(scope: BudgetScope, options: CuuLocaleOptions = {}): CuuCardChip {
  switch (scope.kind) {
    case "workitem":
      return { id: "scope", label: cuuT(options.locale, "budget.scope.workitem"), description: cuuT(options.locale, "budget.scopeDesc.workitem") };
    case "task":
      return { id: "scope", label: cuuT(options.locale, "budget.scope.task"), description: cuuT(options.locale, "budget.scopeDesc.task") };
    case "objective":
      return { id: "scope", label: cuuT(options.locale, "budget.scope.objective"), description: cuuT(options.locale, "budget.scopeDesc.objective") };
    case "user":
      return { id: "scope", label: cuuT(options.locale, "budget.scope.user"), description: cuuT(options.locale, "budget.scopeDesc.user") };
    case "team":
      return { id: "scope", label: cuuT(options.locale, "budget.scope.team"), description: cuuT(options.locale, "budget.scopeDesc.team") };
    case "curation":
      return { id: "scope", label: cuuT(options.locale, "budget.scope.curation"), description: cuuT(options.locale, "budget.scopeDesc.curation") };
    case "eval":
      return { id: "scope", label: cuuT(options.locale, "budget.scope.eval"), description: cuuT(options.locale, "budget.scopeDesc.eval") };
  }
}

function budgetStatusLabel(status: CostDashboardVM["top_exhaustion_risks"][number]["status"], options: CuuLocaleOptions) {
  return cuuT(options.locale, `cost.status.${status}`);
}

const budgetActionLabels = {
  "zh-CN": {
    add_budget: "追加预算继续",
    finish_current_output: "就用现有产出收尾",
    close_scope: "整体收工",
    downgrade_model: "降级模型继续",
    pause: "先暂停",
    ask_admin: "找管理员"
  },
  "en-US": {
    add_budget: "Add budget and continue",
    finish_current_output: "Finish with current output",
    close_scope: "Close scope",
    downgrade_model: "Use a cheaper model",
    pause: "Pause for now",
    ask_admin: "Ask an admin"
  }
} as const;

function budgetActionLabel(id: string, fallback: string, options: CuuLocaleOptions) {
  const locale = options.locale === "en-US" ? "en-US" : "zh-CN";
  return budgetActionLabels[locale][id as keyof typeof budgetActionLabels[typeof locale]] ?? fallback;
}

function dataStringField(data: unknown, key: string) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }
  const value = (data as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function isAgentRunEvent(event: WorkHubEvent<unknown>) {
  return (
    event.type === eventTypes.agentRunStarted ||
    event.type === eventTypes.agentRunStep ||
    event.type === eventTypes.agentRunCompacting ||
    event.type === eventTypes.agentRunFailed ||
    event.type === eventTypes.agentRunEscalated
  );
}

function isDefaultAttentionFallback(attention: AttentionItem) {
  return attention.title === defaultAttentionSummary && attention.summary_text === defaultAttentionSummary;
}

function agentRunHref(runId: string | undefined) {
  return runId ? `/agent-runs/${runId}/replay` : undefined;
}

function cardFromAgentRunEvent(event: WorkHubEvent<unknown>, options: CuuLocaleOptions = {}): CuuCard {
  const runId = event.run_id ?? (event.topic.startsWith("run:") ? event.topic.slice("run:".length) : undefined);
  const dataKind = dataStringField(event.data, "kind");
  const dataStatus = dataStringField(event.data, "status");
  // L#74 续：预算耗尽即便以 agent_run.step(data.status="budget_exhausted") 形式到达，也要和 budget.exhausted
  // 事件型(toCuuState→asking_approval)与 cardFromBudgetNotice(状态映射 asking_approval)对齐——否则 toCuuState
  // 按 event.type=agentRunStep 默认给 "thinking"，桌宠会"淡定思考"却又 urgent(下方 priority)，自相矛盾。
  const state = dataStatus === "budget_exhausted" ? "asking_approval" : toCuuState(event);
  const finalEvent =
    event.type === eventTypes.agentRunFailed ||
    event.type === eventTypes.agentRunEscalated ||
    (event.type === eventTypes.agentRunStep && (dataKind === "done" || dataStatus === "succeeded" || state === "celebrating"));
  const href = agentRunHref(runId);
  const title = finalEvent
    ? state === "celebrating"
      ? cuuT(options.locale, "agentRun.doneTitle")
      : cuuT(options.locale, "agentRun.attentionTitle")
    : event.type === eventTypes.agentRunStarted
      ? cuuT(options.locale, "agentRun.startedTitle")
      : cuuT(options.locale, "agentRun.workingTitle");

  return withMotion({
    id: event.event_id,
    kind: finalEvent && state === "celebrating" ? "completion" : "trace",
    state,
    title,
    message: truncate(event.preview_text ?? dataStringField(event.data, "summary") ?? cuuT(options.locale, "agentRun.progressFallback")),
    // L#74：预算耗尽与 cardFromBudgetNotice 一致用 urgent（同一现实状况不应因卡片来源不同而优先级不一）。
    priority: dataStatus === "budget_exhausted" ? "urgent" : state === "worried" ? "high" : "normal",
    actions: href
      ? [
          {
            id: "view_replay",
            label: cuuT(options.locale, "agentRun.viewReplay"),
            tone: finalEvent ? "primary" : "secondary",
            method: "GET",
            href
          }
        ]
      : [],
    payload_ref: {
      entity_type: "event",
      entity_id: event.event_id,
      ...(href ? { href } : {})
    },
    source: optionalSource({
      entity_type: "event",
      entity_id: event.event_id,
      ...(event.work_item_id ? { work_item_id: event.work_item_id } : {}),
      ...(event.project_id ? { project_id: event.project_id } : {})
    }),
    created_at: event.ts
  });
}

function cardKindForAttention(kind: AttentionItem["kind"]): CuuCardKind {
  switch (kind) {
    case "clarification":
      return "question";
    case "approval":
      return "approval";
    case "plan_review":
    case "proposal_review":
    case "delivery_ready":
      return "proposal";
    case "knowledge_result":
      return "evidence";
    case "budget":
      return "budget";
    case "sync_conflict":
      return "sync";
    case "escalation":
      return "bubble";
    case "system_health":
      return "bubble";
  }
}

export function cardFromAttentionItem(item: AttentionItem, options: CuuLocaleOptions = {}): CuuCard {
  const state = stateForAttentionItem(item);
  const proposalLike = isProposalLikeAttentionKind(item.kind);
  const message = proposalLike
    ? publicProposalSummary(item.reason_text ?? item.summary_text, options)
    : item.kind === "clarification"
      ? truncate(item.summary_text)
    : truncate(item.reason_text ?? item.summary_text);
  const publicTitle = proposalLike ? publicProposalAttentionTitle(item, message, options) : item.title;
  const proposalSections: CuuCardSection[] = proposalLike
    ? [
        {
          id: "summary",
          title: cuuT(options.locale, "proposal.summarySection"),
          lines: [message]
        },
        proposalNextStepSection(proposalNextStepForAttention(item, options), options)
      ]
    : [];
  const actions = sortAttentionActionsForUser(item.actions.map((action) => mapAttentionAction(action, item, options)), item);
  const input = clarificationInputForAttention(item, actions, options);
  return withMotion({
    id: item.id,
    kind: cardKindForAttention(item.kind),
    state,
    title: publicTitle,
    message,
    priority: item.priority,
    actions,
    ...(proposalLike ? { sections: proposalSections } : {}),
    ...(input ? { input } : {}),
    ...(item.evidence_refs?.length ? { evidence_refs: item.evidence_refs } : {}),
    payload_ref: {
      entity_type: "attention",
      entity_id: item.id
    },
    source: optionalSource({
      entity_type: item.source_ref.entity_type,
      entity_id: item.source_ref.entity_id,
      ...(item.work_item_id ? { work_item_id: item.work_item_id } : {}),
      ...(item.project_id ? { project_id: item.project_id } : {})
    }),
    created_at: item.created_at,
    ...(item.expires_at ? { expires_at: item.expires_at } : {})
  });
}

export function cardFromQuestionCard(question: QuestionCard, options: CuuLocaleOptions = {}): CuuCard {
  const recommended = new Set(question.recommended_option_ids ?? []);
  const chips = question.options.map<CuuCardChip>((option) => {
    const description = option.description ?? option.impact;
    return {
      id: option.id,
      label: option.label,
      ...(option.risk_hint === "high"
        ? { tone: "danger" }
        : option.risk_hint === "medium"
          ? { tone: "warning" }
          : { tone: "neutral" }),
      ...(description ? { description } : {}),
      ...(option.delivery_kind || option.default_acceptance
        ? {
            metadata: {
              ...(option.risk_hint ? { risk_hint: option.risk_hint } : {}),
              ...(option.delivery_kind ? { delivery_kind: option.delivery_kind } : {}),
              ...(option.default_acceptance ? { default_acceptance: option.default_acceptance } : {})
            }
          }
        : {}),
      ...(recommended.has(option.id) ? { recommended: true } : {})
    };
  });

  return withMotion({
    id: question.id,
    kind: "question",
    state: "asking_approval",
    title: question.title,
    message: truncate(question.body ?? cuuT(options.locale, "question.bodyFallback")),
    priority: "high",
    actions: [
      {
        id: "submit_option",
        label: cuuT(options.locale, question.input_mode === "long_text" ? "question.submitAnswer" : "question.submit"),
        tone: "primary",
        method: question.submit.method,
        href: question.submit.href
      }
    ],
    ...(chips.length ? { chips } : {}),
    progress: question.progress.map((step, index) => ({
      key: step.key,
      label: step.label,
      state: step.state,
      index
    })),
    input: {
      mode: question.input_mode,
      option_first: question.input_mode !== "long_text" && chips.length > 0,
      free_text_enabled: question.free_text.enabled,
      free_text_collapsed_by_default: question.free_text.collapsed_by_default,
      ...(question.free_text.placeholder ? { free_text_placeholder: question.free_text.placeholder } : {}),
      ...(question.free_text.max_length ? { free_text_max_length: question.free_text.max_length } : {})
    },
    ...(question.evidence_refs?.length ? { evidence_refs: question.evidence_refs } : {}),
    payload_ref: {
      entity_type: "question",
      entity_id: question.id,
      href: question.submit.href
    },
    ...(question.work_item_id
      ? {
          source: optionalSource({
            entity_type: "page_vm",
            entity_id: question.id,
            work_item_id: question.work_item_id
          })
        }
      : {})
  });
}

export function cardFromSessionVm(session: SessionVM, options: CuuLocaleOptions = {}): CuuCard {
  const workItemId = session.work_item_id ?? session.question.work_item_id;
  const question = {
    ...session.question,
    session_id: session.question.session_id ?? session.session_id,
    ...(workItemId ? { work_item_id: workItemId } : {})
  };
  const card = cardFromQuestionCard(question, options);

  return {
    ...card,
    id: session.session_id,
    payload_ref: {
      entity_type: "session",
      entity_id: session.session_id,
      href: session.next_question_href
    },
    source: optionalSource({
      entity_type: "page_vm",
      entity_id: session.session_id,
      ...(workItemId ? { work_item_id: workItemId } : {})
    })
  };
}

export function cardFromEvidenceBubble(bubble: EvidenceBubble, options: CuuLocaleOptions = {}): CuuCard {
  const missing = bubble.missing_evidence_note
    ? [{ id: "missing", title: cuuT(options.locale, "evidence.missingSection"), lines: [bubble.missing_evidence_note] }]
    : [];

  return withMotion({
    id: bubble.id,
    kind: "evidence",
    state: "searching_evidence",
    title: bubble.query_text
      ? cuuFormat(options.locale, "evidence.titleFound", { query: bubble.query_text })
      : cuuT(options.locale, "evidence.titleDefault"),
    message: truncate(bubble.summary_text),
    priority: bubble.missing_evidence_note ? "high" : "normal",
    actions: bubble.actions.map((action) => ({
      id: action.id,
      label: action.label,
      tone: action.id === "use_for_current_task" ? "primary" : "secondary",
      ...(action.href ? { method: action.method ?? "GET", href: action.href } : {})
    })),
    chips: bubble.evidence_refs.slice(0, 4).map((evidence) => ({
      id: evidence.id,
      label: evidence.title,
      tone: evidence.confidence_hint === "missing" ? "danger" : evidence.confidence_hint === "weak" ? "warning" : "success",
      ...(evidence.href ? { href: evidence.href } : {})
    })),
    sections: missing,
    evidence_refs: bubble.evidence_refs,
    payload_ref: {
      entity_type: "evidence",
      entity_id: bubble.id
    }
  });
}

export function cardFromProposalDetail(vm: ProposalDetailVM, options: CuuLocaleOptions = {}): CuuCard {
  const state: CuuState =
    vm.status === "merged" ? "celebrating" : vm.status === "rejected" ? "revision_requested" : "carrying_document";
  const changes = vm.manifest.changes.slice(0, 5);
  const checks = vm.manifest.checks.slice(0, 5);
  const sections: CuuCardSection[] = [
    {
      id: "summary",
      title: cuuT(options.locale, "proposal.summarySection"),
      lines: [publicProposalSummary(vm.manifest.summary_md, options)]
    },
    proposalNextStepSection(
      vm.status === "reviewed" && vm.review_actions.approve_hold
        ? cuuT(options.locale, "proposal.planNextStepReviewed")
        : proposalNextStepForStatus(vm.status, options),
      options
    ),
    {
      id: "changes",
      title: cuuT(options.locale, "proposal.changesSection"),
      lines: changes.map((change) =>
        change.target_ref.path ? `${change.human_summary} (${change.target_ref.path})` : change.human_summary
      )
    },
    {
      id: "risk",
      title: cuuT(options.locale, "proposal.riskSection"),
      lines: [
        vm.manifest.risk.human_label,
        vm.manifest.risk.reversible
          ? cuuT(options.locale, "proposal.rollbackAvailable")
          : cuuT(options.locale, "proposal.rollbackUnavailable"),
        vm.manifest.rollback.description
      ]
    }
  ];

  if (checks.length) {
    sections.push({
      id: "checks",
      title: cuuT(options.locale, "proposal.checksSection"),
      lines: checks.map((check) => `${check.label}: ${check.status}${check.detail ? ` - ${check.detail}` : ""}`)
    });
  }

  const actions = vm.status === "opened"
    ? [
        mapActionSpec(vm.review_actions.approve, "primary"),
        mapActionSpec(vm.review_actions.request_changes, "danger")
      ]
    : vm.status === "reviewed" && vm.review_actions.merge
      ? [
          mapActionSpec(vm.review_actions.merge, "primary"),
          ...(vm.review_actions.approve_hold ? [mapActionSpec(vm.review_actions.approve_hold, "secondary")] : [])
        ]
      : [];

  return withMotion({
    id: vm.proposal_id,
    kind: vm.status === "merged" ? "completion" : "proposal",
    state,
    title: publicProposalTitle(vm.title, options),
    message: publicProposalSummary(vm.manifest.summary_md, options),
    priority: vm.status === "opened" ? "high" : "normal",
    actions,
    chips: changes.map((change) => ({
      id: change.id,
      label: change.target_ref.path ?? change.human_summary,
      tone: change.change_type === "deleted" ? "danger" : "neutral",
      description: change.human_summary
    })),
    sections,
    evidence_refs: evidenceById([...vm.evidence_refs, ...vm.manifest.evidence_refs]),
    payload_ref: {
      entity_type: "proposal",
      entity_id: vm.proposal_id,
      href: `/proposals/${vm.proposal_id}`
    },
    source: optionalSource({
      entity_type: "proposal",
      entity_id: vm.proposal_id,
      work_item_id: vm.work_item_id
    })
  });
}

function proposalConflictOptionLabel(option: ProposalConflictOption, options: CuuLocaleOptions = {}) {
  if (option.id === "keep_current") {
    return cuuT(options.locale, "proposal.conflictKeepCurrent");
  }
  if (option.id === "accept_incoming") {
    return cuuT(options.locale, "proposal.conflictAcceptIncoming");
  }
  if (option.id === "ai_fusion") {
    if (option.action?.id === "apply_ai_fusion") {
      return cuuT(options.locale, "proposal.conflictApplyAiFusion");
    }
    return cuuT(options.locale, "proposal.conflictAiFusion");
  }
  return option.label;
}

function proposalConflictOptionTone(option: ProposalConflictOption): CuuCardActionTone {
  if (option.id === "accept_incoming") {
    return "danger";
  }
  return option.recommended ? "primary" : "secondary";
}

function mapProposalConflictAction(option: ProposalConflictOption, options: CuuLocaleOptions = {}): CuuCardAction {
  return {
    id: option.id,
    label: proposalConflictOptionLabel(option, options),
    tone: proposalConflictOptionTone(option),
    ...(option.action?.method ? { method: option.action.method } : {}),
    ...(option.action?.href ? { href: option.action.href } : {}),
    ...(option.action?.request_json ? { payload: option.action.request_json } : {})
  };
}

export function cardFromProposalConflict(conflict: ProposalConflict, options: CuuLocaleOptions = {}): CuuCard {
  const target = conflict.target_path ?? conflict.target_key;
  const sections: CuuCardSection[] = [
    {
      id: "target",
      title: cuuT(options.locale, "proposal.conflictTargetSection"),
      lines: [target, conflict.headline]
    },
    {
      id: "versions",
      title: cuuT(options.locale, "proposal.conflictVersionSection"),
      lines: conflict.options.map((option) => normalizeProposalMergeVerb(option.summary_text, options))
    }
  ];
  const actions = [
    ...conflict.options.map((option) => mapProposalConflictAction(option, options)),
    {
      id: "open_proposal",
      label: cuuT(options.locale, "proposal.conflictOpenProposal"),
      tone: "secondary" as const,
      method: "GET" as const,
      href: `/proposals/${conflict.proposal_id}`
    }
  ];

  return withMotion({
    id: conflict.id,
    kind: "proposal",
    state: "asking_approval",
    title: cuuT(options.locale, "proposal.conflictTitle"),
    message: truncate(normalizeProposalMergeVerb(conflict.summary_text, options)),
    priority: "high",
    actions,
    chips: [
      {
        id: "target",
        label: target,
        tone: "warning",
        description: conflict.target_kind
      }
    ],
    sections,
    payload_ref: {
      entity_type: "proposal_conflict",
      entity_id: conflict.id,
      href: `/proposals/${conflict.proposal_id}`
    },
    source: optionalSource({
      entity_type: "proposal",
      entity_id: conflict.proposal_id,
      work_item_id: conflict.work_item_id
    })
  });
}

export function cardsFromProposalConflicts(conflicts: ProposalConflict[], options: CuuLocaleOptions = {}): CuuCard[] {
  return conflicts.map((conflict) => cardFromProposalConflict(conflict, options));
}

function stateForWorkItem(status: WorkItemStatus, hasProposal: boolean): CuuState {
  if (status === "merged" || status === "done") {
    return "celebrating";
  }
  if (status === "in_review" || hasProposal) {
    return "carrying_document";
  }
  if (status === "escalated" || status === "pm_mode") {
    return "worried";
  }
  if (status === "intake" || status === "ai_clarifying") {
    return "asking_approval";
  }
  return "thinking";
}

export function cardFromWorkItemDetail(vm: WorkItemDetailVM, options: CuuLocaleOptions = {}): CuuCard {
  const hasProposal = Boolean(vm.latest_proposal);
  const state = stateForWorkItem(vm.workitem.status, hasProposal);
  const proposalId = vm.latest_proposal?.proposal_id;
  const latestStep = vm.agent_trace_preview.at(-1);
  const runId = latestStep?.agent_run_id;
  const actions: CuuCardAction[] = [
    {
      id: "open_workitem",
      label: cuuT(options.locale, "workItem.open"),
      tone: hasProposal ? "secondary" : "primary",
      method: "GET",
      href: `/workitems/${vm.workitem.id}`
    },
    ...(proposalId
      ? [
          {
            id: "open_proposal",
            label: cuuT(options.locale, "workItem.openProposal"),
            tone: "primary" as const,
            method: "GET" as const,
            href: `/proposals/${proposalId}`
          }
        ]
      : []),
    ...(runId
      ? [
          {
            id: "view_replay",
            label: cuuT(options.locale, "workItem.viewReplay"),
            tone: "secondary" as const,
            method: "GET" as const,
            href: `/agent-runs/${runId}/replay`
          }
        ]
      : []),
    ...(!hasProposal && vm.workitem.status === "spec_ready"
      ? [
          {
            id: "start_agent",
            label: cuuT(options.locale, "workItem.startAgent"),
            tone: "primary" as const,
            method: "POST" as const,
            href: `/api/workitems/${vm.workitem.id}/agent-runs`
          }
        ]
      : [])
  ];

  const sections: CuuCardSection[] = [
    {
      id: "status",
      title: cuuT(options.locale, "workItem.statusSection"),
      lines: [
        vm.workitem.status,
        latestStep?.output_excerpt ?? vm.workitem.summary_md ?? vm.workitem.raw_description ?? cuuT(options.locale, "workItem.readyFallback")
      ]
    }
  ];

  if (vm.acceptance.length) {
    sections.push({
      id: "acceptance",
      title: cuuT(options.locale, "workItem.acceptanceSection"),
      lines: vm.acceptance.slice(0, 4).map((item, index) => {
        const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
        // findings[#low]：acceptance 项是 z.unknown()，title/status 可能不是字符串。
        // ?? 只挡 null/undefined，对象/数字会 stringify 成 "[object Object]"/"5"。改 typeof 守卫，
        // 非字符串落到占位文案（与 cards.ts:233 dataStringField 约定一致）。
        const title = typeof record.title === "string" ? record.title : cuuFormat(options.locale, "workItem.acceptanceFallback", { index: index + 1 });
        const status = typeof record.status === "string" ? record.status : "open";
        return `${title}: ${status}`;
      })
    });
  }

  return withMotion({
    id: vm.workitem.id,
    kind: state === "carrying_document" ? "proposal" : state === "celebrating" ? "completion" : "trace",
    state,
    title: vm.workitem.title ?? vm.workitem.code,
    message: truncate(latestStep?.output_excerpt ?? vm.workitem.summary_md ?? vm.workitem.raw_description ?? cuuT(options.locale, "workItem.startedFallback")),
    priority: state === "worried" ? "high" : "normal",
    actions,
    sections,
    ...(vm.evidence_refs.length ? { evidence_refs: vm.evidence_refs } : {}),
    payload_ref: {
      entity_type: "workitem",
      entity_id: vm.workitem.id,
      href: `/workitems/${vm.workitem.id}`
    },
    source: optionalSource({
      entity_type: "page_vm",
      entity_id: vm.workitem.id,
      work_item_id: vm.workitem.id,
      project_id: vm.workitem.project_id
    })
  });
}

function stateForAgentRun(status: AgentRunLiveVM["status"]): CuuState {
  if (status === "succeeded") {
    return "celebrating";
  }
  if (status === "failed" || status === "escalated") {
    return "worried";
  }
  return "thinking";
}

type AgentRunTraceStep = AgentRunLiveVM["trace"][number];

function publicAgentRunTraceLine(step: AgentRunTraceStep, options: CuuLocaleOptions) {
  switch (step.phase) {
    case "think":
      return `#${step.step_no} ${cuuT(options.locale, "agentRun.phase.think")}`;
    case "tool_call":
      return `#${step.step_no} ${cuuT(options.locale, "agentRun.phase.toolCall")}`;
    case "tool_result":
      return `#${step.step_no} ${cuuT(options.locale, "agentRun.phase.toolResult")}`;
    case "final":
      return `#${step.step_no} ${cuuT(options.locale, "agentRun.phase.final")}${step.output_excerpt ? `${options.locale === "en-US" ? ": " : "："}${truncate(step.output_excerpt, 120)}` : ""}`;
    default:
      return `#${step.step_no} ${step.phase}`;
  }
}

function publicAgentRunStepMessage(step: AgentRunTraceStep | undefined, options: CuuLocaleOptions) {
  if (!step) {
    return undefined;
  }
  switch (step.phase) {
    case "think":
      return cuuT(options.locale, "agentRun.thinkingStatus");
    case "tool_call":
      return cuuT(options.locale, "agentRun.toolCallStatusGeneric");
    case "tool_result":
      return cuuT(options.locale, "agentRun.toolResultStatus");
    case "final":
      return step.output_excerpt;
    default:
      return undefined;
  }
}

export function cardFromAgentRunLive(vm: AgentRunLiveVM, options: CuuLocaleOptions = {}): CuuCard {
  const state = stateForAgentRun(vm.status);
  const latestStep = vm.trace.at(-1);
  const active = vm.status === "queued" || vm.status === "running";
  const actions: CuuCardAction[] = [
    {
      id: "view_replay",
      label: cuuT(options.locale, "agentRun.viewReplay"),
      tone: state === "celebrating" ? "primary" : "secondary",
      method: "GET",
      href: `/agent-runs/${vm.run_id}/replay`
    },
    {
      id: "open_workitem",
      label: cuuT(options.locale, "agentRun.openWorkItem"),
      tone: "secondary",
      method: "GET",
      href: `/workitems/${vm.work_item_id}`
    },
    ...(active
      ? [
          {
            id: "abort_agent_run",
            label: cuuT(options.locale, "agentRun.abort"),
            tone: "danger" as const,
            method: "POST" as const,
            href: `/api/agent-runs/${vm.run_id}/abort`
          }
        ]
      : [])
  ];
  const sections: CuuCardSection[] = [
    {
      id: "trace",
      title: cuuT(options.locale, "agentRun.progressSection"),
      lines: vm.trace.length
        ? vm.trace.slice(-4).map((step) => publicAgentRunTraceLine(step, options))
        : [cuuT(options.locale, "agentRun.queued")]
    },
    {
      id: "budget",
      title: cuuT(options.locale, "agentRun.budgetSection"),
      lines: [
        `${vm.usage.token_in + vm.usage.token_out}/${vm.budget.max_tokens} tokens`,
        `¥${vm.usage.estimated_cost_cny}/${vm.budget.max_cost_cny}`
      ]
    }
  ];

  if (vm.handoff) {
    sections.push({
      id: "handoff",
      title: cuuT(options.locale, "agentRun.handoffSection"),
      lines: [...vm.handoff.remaining, ...vm.handoff.next_steps, ...vm.handoff.blockers].slice(0, 4)
    });
  }

  return withMotion({
    id: vm.run_id,
    kind: state === "celebrating" ? "completion" : "trace",
    state,
    title: state === "celebrating"
        ? cuuT(options.locale, "agentRun.doneTitle")
        : state === "worried"
          ? cuuT(options.locale, "agentRun.attentionTitle")
          : cuuT(options.locale, "agentRun.startedTitle"),
    message: truncate(
      publicAgentRunStepMessage(latestStep, options) ??
        vm.run.handoff_md ??
        cuuT(options.locale, "agentRun.progressFallback")
    ),
    priority: state === "worried" || state === "asking_approval" ? "high" : "normal",
    actions,
    sections,
    payload_ref: {
      entity_type: "agent_run",
      entity_id: vm.run_id,
      href: `/agent-runs/${vm.run_id}/replay`
    },
    source: optionalSource({
      entity_type: "page_vm",
      entity_id: vm.run_id,
      work_item_id: vm.work_item_id
    }),
    created_at: vm.run.created_at
  });
}

export function cardFromBudgetNotice(notice: BudgetNotice, id = `budget-${notice.code}`, options: CuuLocaleOptions = {}): CuuCard {
  const exhausted = notice.code === "budget_exhausted";
  const actions = notice.options?.map<CuuCardAction>((option) => ({
    id: option.id,
    label: budgetActionLabel(option.id, option.label, options),
    tone: option.id === notice.recommended_action ? "primary" : "secondary",
    method: "POST",
    href: option.action_href
  })) ?? [
    {
      id: notice.recommended_action,
      label: exhausted ? cuuT(options.locale, "budget.handle") : cuuT(options.locale, "budget.view"),
      tone: exhausted ? "danger" : "secondary",
      ...(notice.action_href ? { method: "GET", href: notice.action_href } : {})
    }
  ];

  return withMotion({
    id,
    kind: "budget",
    state: exhausted ? "asking_approval" : "worried",
    title: exhausted ? cuuT(options.locale, "budget.exhaustedTitle") : cuuT(options.locale, "budget.warningTitle"),
    message: truncate(notice.message),
    priority: exhausted ? "urgent" : notice.severity === "critical" ? "high" : "normal",
    actions,
    chips: [
      budgetScopeChip(notice.scope, options),
      {
        id: "usage",
        label: `${Math.round(notice.usage_ratio * 100)}%`,
        tone: exhausted ? "danger" : "warning",
        description: cuuT(options.locale, "budget.usageDescription")
      }
    ],
    payload_ref: {
      entity_type: "budget_notice",
      entity_id: id,
      ...(notice.action_href ? { href: notice.action_href } : {})
    }
  });
}

export function cardFromCostDashboard(vm: CostDashboardVM, options: CuuLocaleOptions = {}): CuuCard {
  const exhausted = vm.notices.some((notice) => notice.code === "budget_exhausted");
  const warning = vm.notices.length > 0 || vm.top_exhaustion_risks.length > 0;
  const sections: CuuCardSection[] = [
    {
      id: "summary",
      title: cuuT(options.locale, "cost.summarySection"),
      lines: [
        `${cuuT(options.locale, "cost.total")} ¥${vm.total_cost_cny}`,
        `${cuuT(options.locale, "cost.input")} ${vm.token_in} tokens`,
        `${cuuT(options.locale, "cost.output")} ${vm.token_out} tokens`
      ]
    }
  ];

  if (vm.top_exhaustion_risks.length) {
    sections.push({
      id: "risks",
      title: cuuT(options.locale, "cost.risksSection"),
      lines: vm.top_exhaustion_risks
        .slice(0, 4)
        .map((risk) => `${risk.label}: ${cuuFormat(options.locale, "cost.remaining", { cost: risk.remaining_cost_cny })} (${budgetStatusLabel(risk.status, options)})`)
    });
  }

  return withMotion({
    id: "cost-dashboard",
    kind: "budget",
    state: exhausted ? "asking_approval" : warning ? "worried" : "idle",
    title: cuuT(options.locale, "cost.title"),
    message: vm.empty_state === "usage_not_connected"
      ? cuuT(options.locale, "cost.notConnected")
      : cuuFormat(options.locale, "cost.usedToday", { cost: vm.total_cost_cny }),
    priority: exhausted ? "urgent" : warning ? "high" : "low",
    actions: [],
    sections,
    payload_ref: {
      entity_type: "cost_dashboard",
      entity_id: "cost-dashboard",
      href: "/dashboard/cost"
    }
  });
}

export function cardsFromCostDashboard(vm: CostDashboardVM, options: CuuLocaleOptions = {}): CuuCard[] {
  return [
    cardFromCostDashboard(vm, options),
    ...vm.notices.map((notice, index) => cardFromBudgetNotice(notice, `budget-${index}`, options))
  ];
}

export function cardFromReplayTrace(vm: ReplayTraceVM, options: CuuLocaleOptions = {}): CuuCard {
  const latestStep = vm.steps.at(-1);
  const sections: CuuCardSection[] = [
    {
      id: "steps",
      title: cuuT(options.locale, "replay.summarySection"),
      lines: vm.steps.slice(-4).map((step) => `#${step.step_no} ${step.phase}${step.output_excerpt ? `: ${step.output_excerpt}` : ""}`)
    }
  ];

  if (vm.cost) {
    sections.push({
      id: "cost",
      title: cuuT(options.locale, "replay.costSection"),
      lines: [
        `${vm.cost.me.scope_label}: ¥${vm.cost.me.estimated_cost_cny}`,
        cuuFormat(options.locale, "cost.remaining", { cost: vm.cost.me.remaining_cost_cny })
      ]
    });
  }

  return withMotion({
    id: vm.run.id,
    kind: "trace",
    state: vm.run.status === "failed" || vm.run.status === "escalated" ? "worried" : "thinking",
    title: cuuT(options.locale, "replay.title"),
    message: truncate(latestStep?.output_excerpt ?? vm.run.handoff_md ?? cuuT(options.locale, "replay.readyFallback")),
    priority: vm.run.status === "failed" || vm.run.status === "escalated" ? "high" : "normal",
    actions: [],
    sections,
    evidence_refs: vm.evidence_refs,
    payload_ref: {
      entity_type: "replay_trace",
      entity_id: vm.run.id,
      href: `/agent-runs/${vm.run.id}/replay`
    },
    source: optionalSource({
      entity_type: "page_vm",
      entity_id: vm.run.id,
      work_item_id: vm.run.work_item_id
    })
  });
}

export function cardFromEvent(event: WorkHubEvent<unknown>, options: CuuLocaleOptions = {}): CuuCard {
  const budgetNotice = budgetNoticeSchema.safeParse(event.data);
  if (budgetNotice.success) {
    return cardFromBudgetNotice(budgetNotice.data, event.event_id, options);
  }

  if (isAgentRunEvent(event)) {
    return cardFromAgentRunEvent(event, options);
  }

  const attention = event.attention ? event.attention : toAttentionItem(event);
  if (attention) {
    if (options.locale === "en-US" && isDefaultAttentionFallback(attention)) {
      return withMotion({
        id: event.event_id,
        kind: "bubble",
        state: toCuuState(event),
        title: event.preview_text ?? cuuT(options.locale, "event.defaultTitle"),
        message: truncate(event.preview_text ?? cuuT(options.locale, "event.defaultMessage")),
        priority: "normal",
        actions: [],
        payload_ref: {
          entity_type: "event",
          entity_id: event.event_id
        },
        source: optionalSource({
          entity_type: "event",
          entity_id: event.event_id,
          ...(event.work_item_id ? { work_item_id: event.work_item_id } : {}),
          ...(event.project_id ? { project_id: event.project_id } : {})
        }),
        created_at: event.ts
      });
    }
    return cardFromAttentionItem(attention, options);
  }

  return withMotion({
    id: event.event_id,
    kind: "bubble",
    state: toCuuState(event),
    title: event.preview_text ?? cuuT(options.locale, "event.defaultTitle"),
    message: truncate(event.preview_text ?? cuuT(options.locale, "event.defaultMessage")),
    priority: "normal",
    actions: [],
    payload_ref: {
      entity_type: "event",
      entity_id: event.event_id
    },
    source: optionalSource({
      entity_type: "event",
      entity_id: event.event_id,
      ...(event.work_item_id ? { work_item_id: event.work_item_id } : {}),
      ...(event.project_id ? { project_id: event.project_id } : {})
    }),
    created_at: event.ts
  });
}

export function cardsFromGoldPathSurface(surface: GoldPathSurfaceVM, options: CuuLocaleOptions = {}): CuuCard[] {
  const cards = [
    surface.page_vms.attention.primary ? cardFromAttentionItem(surface.page_vms.attention.primary, options) : undefined,
    ...surface.page_vms.attention.queue.map((item) => cardFromAttentionItem(item, options)),
    cardFromQuestionCard(surface.page_vms.question, options),
    cardFromWorkItemDetail(surface.page_vms.workitem, options),
    cardFromEvidenceBubble(surface.page_vms.evidence, options),
    cardFromProposalDetail(surface.page_vms.proposal, options),
    cardFromReplayTrace(surface.page_vms.replay, options),
    ...cardsFromCostDashboard(surface.page_vms.cost, options),
    ...surface.events.map((event) => cardFromEvent(event as WorkHubEvent<unknown>, options))
  ].filter((card): card is CuuCard => Boolean(card));

  const seen = new Set<string>();
  return cards.filter((card) => {
    if (seen.has(card.id)) {
      return false;
    }
    seen.add(card.id);
    return true;
  });
}
