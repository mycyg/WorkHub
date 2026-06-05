import {
  eventTypes,
  type AttentionItem,
  budgetNoticeSchema,
  type EventType,
  type WorkHubEvent
} from "@workhub/contracts";

import { toCuuState } from "./toCuuState.js";

const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function sourceRefFor(event: WorkHubEvent<unknown>): AttentionItem["source_ref"] {
  const fallback = event.event_id;
  switch (event.type as EventType) {
    case eventTypes.permissionAsk:
      return { entity_type: "approval_request", entity_id: findUuid(event.data, ["approval_id"]) ?? fallback };
    case eventTypes.proposalOpened:
    case eventTypes.proposalReviewed:
    case eventTypes.proposalMerged:
      return { entity_type: "proposal", entity_id: event.proposal_id ?? fallback };
    case eventTypes.escalationOpened:
      return { entity_type: "escalation_event", entity_id: findUuid(event.data, ["escalation_id"]) ?? fallback };
    case eventTypes.agentRunEscalated:
    case eventTypes.agentRunFailed:
      return { entity_type: "agent_run", entity_id: event.run_id ?? fallback };
    case eventTypes.knowledgeEvidenceReady:
      return { entity_type: "knowledge_run", entity_id: findUuid(event.data, ["run_id"]) ?? fallback };
    case eventTypes.budgetWarning:
    case eventTypes.budgetExhausted:
      return { entity_type: "budget_notice", entity_id: fallback };
    default:
      return { entity_type: "notification", entity_id: fallback };
  }
}

function findUuid(data: unknown, keys: string[]) {
  if (!data || typeof data !== "object") {
    return undefined;
  }
  const record = data as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && uuidLike.test(value)) {
      return value;
    }
  }
  return undefined;
}

function kindFor(event: WorkHubEvent<unknown>): AttentionItem["kind"] {
  switch (event.type as EventType) {
    case eventTypes.permissionAsk:
      return "approval";
    case eventTypes.proposalOpened:
    case eventTypes.proposalReviewed:
      return "proposal_review";
    case eventTypes.agentRunEscalated:
    case eventTypes.escalationOpened:
      return "escalation";
    case eventTypes.syncConflict:
      return "sync_conflict";
    case eventTypes.knowledgeEvidenceReady:
      return "knowledge_result";
    case eventTypes.budgetWarning:
    case eventTypes.budgetExhausted:
      return "budget";
    default:
      return "system_health";
  }
}

function priorityFor(event: WorkHubEvent<unknown>): AttentionItem["priority"] {
  if (event.type === eventTypes.budgetExhausted) {
    return "urgent";
  }
  const budgetNotice = budgetNoticeSchema.safeParse(event.data);
  if (budgetNotice.success && budgetNotice.data.severity === "critical") {
    return "high";
  }
  return "normal";
}

function budgetActions(event: WorkHubEvent<unknown>): AttentionItem["actions"] | undefined {
  const budgetNotice = budgetNoticeSchema.safeParse(event.data);
  if (!budgetNotice.success) {
    return undefined;
  }

  const actions = budgetNotice.data.options?.map<AttentionItem["actions"][number]>((option) => ({
    id: option.id,
    label: option.label,
    style: option.id === budgetNotice.data.recommended_action ? "primary" : "secondary",
    method: "POST",
    href: option.action_href
  })) ?? [];

  if (actions.length === 0 && budgetNotice.data.action_href) {
    actions.push({
      id: "open_budget",
      label: budgetNotice.data.code === "budget_exhausted" ? "处理预算" : "查看预算",
      style: budgetNotice.data.code === "budget_exhausted" ? "danger" : "secondary",
      method: "GET",
      href: budgetNotice.data.action_href
    });
  }

  return actions;
}

function titleFor(event: WorkHubEvent<unknown>, summary: string) {
  switch (event.type as EventType) {
    case eventTypes.budgetWarning:
      return "预算快到线了";
    case eventTypes.budgetExhausted:
      return "预算用完了";
    default:
      return summary;
  }
}

export function toAttentionItem(event: WorkHubEvent<unknown>): AttentionItem | undefined {
  if (event.attention) {
    return event.attention;
  }

  const summary = event.preview_text ?? "WorkHub 有新的状态更新。";
  return {
    id: event.event_id,
    kind: kindFor(event),
    priority: priorityFor(event),
    ...(event.work_item_id ? { work_item_id: event.work_item_id } : {}),
    ...(event.project_id ? { project_id: event.project_id } : {}),
    source_ref: sourceRefFor(event),
    title: titleFor(event, summary),
    summary_text: summary,
    actions: budgetActions(event) ?? [],
    cuu_state: toCuuState(event),
    created_at: event.ts
  };
}
