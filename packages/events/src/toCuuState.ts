import { eventTypes, type CuuState, type EventType, type WorkHubEvent } from "@workhub/contracts";

const eventTypeToCuuState: Partial<Record<EventType, CuuState>> = {
  [eventTypes.agentRunStarted]: "thinking",
  [eventTypes.agentRunStep]: "thinking",
  [eventTypes.agentRunCompacting]: "thinking",
  [eventTypes.agentRunFailed]: "worried",
  [eventTypes.agentRunEscalated]: "worried",
  [eventTypes.permissionAsk]: "asking_approval",
  [eventTypes.permissionDecided]: "thinking",
  [eventTypes.permissionReassigned]: "asking_approval",
  [eventTypes.permissionExpired]: "worried",
  [eventTypes.proposalOpened]: "carrying_document",
  [eventTypes.proposalReviewed]: "carrying_document",
  [eventTypes.proposalMerged]: "celebrating",
  [eventTypes.knowledgeEvidenceReady]: "searching_evidence",
  [eventTypes.syncProgress]: "syncing_files",
  [eventTypes.syncConflict]: "worried",
  [eventTypes.budgetWarning]: "worried",
  [eventTypes.budgetExhausted]: "asking_approval",
  [eventTypes.notificationCreated]: "idle"
};

export function toCuuState(event: Pick<WorkHubEvent<unknown>, "type" | "cuu_state">): CuuState {
  if (event.cuu_state) {
    return event.cuu_state;
  }
  return eventTypeToCuuState[event.type as EventType] ?? "idle";
}
