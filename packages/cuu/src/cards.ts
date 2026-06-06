import {
  budgetNoticeSchema,
  eventTypes,
  type ActionSpec,
  type AttentionAction,
  type AttentionItem,
  type BudgetNotice,
  type BudgetScope,
  type CostDashboardVM,
  type CuuState,
  type EvidenceBubble,
  type EvidenceRef,
  type GoldPathSurfaceVM,
  type ProposalDetailVM,
  type QuestionCard,
  type ReplayTraceVM,
  type SessionVM,
  type WorkHubEvent
} from "@workhub/contracts";
import { toAttentionItem } from "@workhub/events/toAttentionItem";
import { toCuuState } from "@workhub/events/toCuuState";

import { cuuMotionForState, type CuuMotionHint } from "./motion.js";

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
  option_first: true;
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
    | "event";
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
  proposal_review: "carrying_document",
  escalation: "worried",
  sync_conflict: "worried",
  knowledge_result: "searching_evidence",
  budget: "worried",
  delivery_ready: "carrying_document",
  system_health: "idle"
};

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

function mapAttentionAction(action: AttentionAction): CuuCardAction {
  return {
    id: action.id,
    label: action.label,
    tone: action.style,
    method: action.method,
    href: action.href,
    ...(action.requires_desktop ? { requires_desktop: action.requires_desktop } : {}),
    ...(action.requires_reason ? { requires_reason: action.requires_reason } : {})
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
    ...(action.requires_reason ? { requires_reason: action.requires_reason } : {})
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

function budgetScopeChip(scope: BudgetScope): CuuCardChip {
  switch (scope.kind) {
    case "workitem":
      return { id: "scope", label: "任务预算", description: scope.workitem_id };
    case "user":
      return { id: "scope", label: "个人预算", description: scope.user_id };
    case "team":
      return { id: "scope", label: "团队预算", description: scope.team_id };
    case "eval":
      return { id: "scope", label: "评测预算", description: scope.suite };
  }
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

function agentRunHref(runId: string | undefined) {
  return runId ? `/agent-runs/${runId}/replay` : undefined;
}

function cardFromAgentRunEvent(event: WorkHubEvent<unknown>): CuuCard {
  const runId = event.run_id ?? (event.topic.startsWith("run:") ? event.topic.slice("run:".length) : undefined);
  const state = toCuuState(event);
  const dataKind = dataStringField(event.data, "kind");
  const dataStatus = dataStringField(event.data, "status");
  const finalEvent =
    event.type === eventTypes.agentRunFailed ||
    event.type === eventTypes.agentRunEscalated ||
    (event.type === eventTypes.agentRunStep && (dataKind === "done" || dataStatus === "succeeded" || state === "celebrating"));
  const href = agentRunHref(runId);
  const title = finalEvent
    ? state === "celebrating"
      ? "这次执行完成了"
      : "这次执行需要关注"
    : event.type === eventTypes.agentRunStarted
      ? "Cuu 开始处理了"
      : "Cuu 正在处理";

  return withMotion({
    id: event.event_id,
    kind: finalEvent && state === "celebrating" ? "completion" : "trace",
    state,
    title,
    message: truncate(event.preview_text ?? dataStringField(event.data, "summary") ?? "Cuu 正在整理执行进度。"),
    priority: state === "worried" ? "high" : "normal",
    actions: href
      ? [
          {
            id: "view_replay",
            label: "查看回放",
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

export function cardFromAttentionItem(item: AttentionItem): CuuCard {
  const state = item.cuu_state ?? stateByAttentionKind[item.kind];
  return withMotion({
    id: item.id,
    kind: cardKindForAttention(item.kind),
    state,
    title: item.title,
    message: truncate(item.reason_text ?? item.summary_text),
    priority: item.priority,
    actions: item.actions.map(mapAttentionAction),
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

export function cardFromQuestionCard(question: QuestionCard): CuuCard {
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
      ...(recommended.has(option.id) ? { recommended: true } : {})
    };
  });

  return withMotion({
    id: question.id,
    kind: "question",
    state: "asking_approval",
    title: question.title,
    message: truncate(question.body ?? "点一个选项，Cuu 就继续往下做。"),
    priority: "high",
    actions: [
      {
        id: "submit_option",
        label: "确认选项",
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
      option_first: true,
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

export function cardFromSessionVm(session: SessionVM): CuuCard {
  const workItemId = session.work_item_id ?? session.question.work_item_id;
  const question = {
    ...session.question,
    session_id: session.question.session_id ?? session.session_id,
    ...(workItemId ? { work_item_id: workItemId } : {})
  };
  const card = cardFromQuestionCard(question);

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

export function cardFromEvidenceBubble(bubble: EvidenceBubble): CuuCard {
  const missing = bubble.missing_evidence_note
    ? [{ id: "missing", title: "缺口", lines: [bubble.missing_evidence_note] }]
    : [];

  return withMotion({
    id: bubble.id,
    kind: "evidence",
    state: "searching_evidence",
    title: bubble.query_text ? `找到和「${bubble.query_text}」相关的证据` : "Cuu 找到了证据",
    message: truncate(bubble.summary_text),
    priority: bubble.missing_evidence_note ? "high" : "normal",
    actions: bubble.actions.map((action) => ({
      id: action.id,
      label: action.label,
      tone: action.id === "use_for_current_task" ? "primary" : "secondary",
      ...(action.href ? { method: "GET", href: action.href } : {})
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

export function cardFromProposalDetail(vm: ProposalDetailVM): CuuCard {
  const state: CuuState =
    vm.status === "merged" ? "celebrating" : vm.status === "rejected" ? "revision_requested" : "carrying_document";
  const changes = vm.manifest.changes.slice(0, 5);
  const checks = vm.manifest.checks.slice(0, 5);
  const sections: CuuCardSection[] = [
    {
      id: "changes",
      title: "这次改了什么",
      lines: changes.map((change) =>
        change.target_ref.path ? `${change.human_summary} (${change.target_ref.path})` : change.human_summary
      )
    },
    {
      id: "risk",
      title: "风险与回滚",
      lines: [
        vm.manifest.risk.human_label,
        vm.manifest.risk.reversible ? "可回滚" : "不可完整回滚",
        vm.manifest.rollback.description
      ]
    }
  ];

  if (checks.length) {
    sections.push({
      id: "checks",
      title: "检查结果",
      lines: checks.map((check) => `${check.label}: ${check.status}${check.detail ? ` - ${check.detail}` : ""}`)
    });
  }

  const actions = [
    mapActionSpec(vm.review_actions.approve, "primary"),
    mapActionSpec(vm.review_actions.request_changes, "danger"),
    ...(vm.review_actions.merge ? [mapActionSpec(vm.review_actions.merge, "primary")] : [])
  ];

  return withMotion({
    id: vm.proposal_id,
    kind: vm.status === "merged" ? "completion" : "proposal",
    state,
    title: vm.title,
    message: truncate(vm.manifest.summary_md),
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

export function cardFromBudgetNotice(notice: BudgetNotice, id = `budget-${notice.code}`): CuuCard {
  const exhausted = notice.code === "budget_exhausted";
  const actions = notice.options?.map<CuuCardAction>((option) => ({
    id: option.id,
    label: option.label,
    tone: option.id === notice.recommended_action ? "primary" : "secondary",
    method: "POST",
    href: option.action_href
  })) ?? [
    {
      id: notice.recommended_action,
      label: exhausted ? "处理预算" : "查看预算",
      tone: exhausted ? "danger" : "secondary",
      ...(notice.action_href ? { method: "GET", href: notice.action_href } : {})
    }
  ];

  return withMotion({
    id,
    kind: "budget",
    state: exhausted ? "asking_approval" : "worried",
    title: exhausted ? "预算用完了" : "预算快到线了",
    message: truncate(notice.message),
    priority: exhausted ? "urgent" : notice.severity === "critical" ? "high" : "normal",
    actions,
    chips: [
      budgetScopeChip(notice.scope),
      {
        id: "usage",
        label: `${Math.round(notice.usage_ratio * 100)}%`,
        tone: exhausted ? "danger" : "warning",
        description: "预算使用率"
      }
    ],
    payload_ref: {
      entity_type: "budget_notice",
      entity_id: id,
      ...(notice.action_href ? { href: notice.action_href } : {})
    }
  });
}

export function cardFromCostDashboard(vm: CostDashboardVM): CuuCard {
  const exhausted = vm.notices.some((notice) => notice.code === "budget_exhausted");
  const warning = vm.notices.length > 0 || vm.top_exhaustion_risks.length > 0;
  const sections: CuuCardSection[] = [
    {
      id: "summary",
      title: "今日成本",
      lines: [`总成本 ¥${vm.total_cost_cny}`, `输入 ${vm.token_in} tokens`, `输出 ${vm.token_out} tokens`]
    }
  ];

  if (vm.top_exhaustion_risks.length) {
    sections.push({
      id: "risks",
      title: "预算风险",
      lines: vm.top_exhaustion_risks
        .slice(0, 4)
        .map((risk) => `${risk.label}: 还剩 ¥${risk.remaining_cost_cny} (${risk.status})`)
    });
  }

  return withMotion({
    id: "cost-dashboard",
    kind: "budget",
    state: exhausted ? "asking_approval" : warning ? "worried" : "idle",
    title: "AI 成本与预算",
    message: vm.empty_state === "usage_not_connected" ? "成本数据还没有接入。" : `今天已使用 ¥${vm.total_cost_cny}。`,
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

export function cardsFromCostDashboard(vm: CostDashboardVM): CuuCard[] {
  return [cardFromCostDashboard(vm), ...vm.notices.map((notice, index) => cardFromBudgetNotice(notice, `budget-${index}`))];
}

export function cardFromReplayTrace(vm: ReplayTraceVM): CuuCard {
  const latestStep = vm.steps.at(-1);
  const sections: CuuCardSection[] = [
    {
      id: "steps",
      title: "Replay 摘要",
      lines: vm.steps.slice(-4).map((step) => `#${step.step_no} ${step.phase}${step.output_excerpt ? `: ${step.output_excerpt}` : ""}`)
    }
  ];

  if (vm.cost) {
    sections.push({
      id: "cost",
      title: "成本",
      lines: [`${vm.cost.me.scope_label}: ¥${vm.cost.me.estimated_cost_cny}`, `剩余 ¥${vm.cost.me.remaining_cost_cny}`]
    });
  }

  return withMotion({
    id: vm.run.id,
    kind: "trace",
    state: vm.run.status === "failed" || vm.run.status === "escalated" ? "worried" : "thinking",
    title: "执行回放已就绪",
    message: truncate(latestStep?.output_excerpt ?? vm.run.handoff_md ?? "Cuu 整理好了这次执行轨迹。"),
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

export function cardFromEvent(event: WorkHubEvent<unknown>): CuuCard {
  const budgetNotice = budgetNoticeSchema.safeParse(event.data);
  if (budgetNotice.success) {
    return cardFromBudgetNotice(budgetNotice.data, event.event_id);
  }

  if (isAgentRunEvent(event)) {
    return cardFromAgentRunEvent(event);
  }

  const attention = toAttentionItem(event);
  if (attention) {
    return cardFromAttentionItem(attention);
  }

  return withMotion({
    id: event.event_id,
    kind: "bubble",
    state: toCuuState(event),
    title: event.preview_text ?? "WorkHub 更新",
    message: truncate(event.preview_text ?? "Cuu 收到一条新的状态更新。"),
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

export function cardsFromGoldPathSurface(surface: GoldPathSurfaceVM): CuuCard[] {
  const cards = [
    surface.page_vms.attention.primary ? cardFromAttentionItem(surface.page_vms.attention.primary) : undefined,
    ...surface.page_vms.attention.queue.map(cardFromAttentionItem),
    cardFromQuestionCard(surface.page_vms.question),
    cardFromEvidenceBubble(surface.page_vms.evidence),
    cardFromProposalDetail(surface.page_vms.proposal),
    cardFromReplayTrace(surface.page_vms.replay),
    ...cardsFromCostDashboard(surface.page_vms.cost),
    ...surface.events.map((event) => cardFromEvent(event as WorkHubEvent<unknown>))
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
