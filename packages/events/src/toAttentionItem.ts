import {
  eventTypes,
  type AttentionItem,
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
    case eventTypes.agentRunEscalated:
    case eventTypes.agentRunFailed:
      return { entity_type: "agent_run", entity_id: event.run_id ?? fallback };
    case eventTypes.knowledgeEvidenceReady:
      return { entity_type: "knowledge_run", entity_id: findUuid(event.data, ["run_id"]) ?? fallback };
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
      return "escalation";
    case eventTypes.syncConflict:
      return "sync_conflict";
    case eventTypes.knowledgeEvidenceReady:
      return "knowledge_result";
    default:
      return "system_health";
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
    priority: event.type === eventTypes.budgetExhausted ? "urgent" : "normal",
    ...(event.work_item_id ? { work_item_id: event.work_item_id } : {}),
    ...(event.project_id ? { project_id: event.project_id } : {}),
    source_ref: sourceRefFor(event),
    title: summary,
    summary_text: summary,
    actions: [],
    cuu_state: toCuuState(event),
    created_at: event.ts
  };
}
