import { eventTypes, type CuuState, type EventType, type WorkHubEvent } from "@workhub/contracts";

const eventTypeToCuuState: Partial<Record<EventType, CuuState>> = {
  [eventTypes.agentRunStarted]: "thinking",
  [eventTypes.agentRunStep]: "thinking",
  [eventTypes.agentRunCompacting]: "thinking",
  // R26 批 B6：前两档提醒只是「换个做法」的自救提示，运行仍在继续——桌宠保持 thinking，不变 worried。
  // worried 是「需要人介入」的信号，那由第三档的 agent_run.escalated 负责。
  [eventTypes.agentRunReminded]: "thinking",
  [eventTypes.agentRunFailed]: "worried",
  [eventTypes.agentRunEscalated]: "worried",
  [eventTypes.confidenceScored]: "thinking",
  [eventTypes.escalationOpened]: "worried",
  [eventTypes.permissionAsk]: "asking_approval",
  [eventTypes.permissionDecided]: "thinking",
  [eventTypes.permissionReassigned]: "asking_approval",
  [eventTypes.permissionExpired]: "worried",
  [eventTypes.proposalOpened]: "carrying_document",
  [eventTypes.proposalReviewed]: "carrying_document",
  [eventTypes.proposalMerged]: "celebrating",
  [eventTypes.revisionFedback]: "revision_requested",
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
