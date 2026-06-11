import { createApiClient, type WorkHubApiClient } from "@workhub/api-client";
import { defaultPorts } from "@workhub/config";
import type { CreateSessionRequest, CreateWorkItemRequest, ProposalConflict, ProposalDetailVM, StartAgentRunRequest, WorkHubEvent } from "@workhub/contracts";
import { cardFromAgentRunLive, cardFromEvent, cardFromProposalDetail, cardsFromProposalConflicts, cardFromSessionVm, cardFromWorkItemDetail, type CuuCard } from "@workhub/cuu";
import { renderAgentRunLive } from "@workhub/ui/agent-run";
import { renderGoldPathSurface, type WorkHubLocale } from "@workhub/ui/gold-path";
import { renderIntakeSession } from "@workhub/ui/intake";
import { renderWorkItemDetail } from "@workhub/ui/workitem";
import { renderProposalDetail } from "@workhub/ui/proposal";
import { renderAgentRunReplay } from "@workhub/ui/replay";

export const desktopWebviewSurface = {
  name: "C-PET webview",
  description: "Tauri webview surface; Rust owns local shell capabilities and this view consumes typed daemon APIs.",
  devPort: defaultPorts.desktopWebview,
  defaultDaemonUrl: `http://127.0.0.1:${defaultPorts.api}`,
  pages: [
    "/api/auth/me",
    "/api/auth/preferences",
    "/api/pages/attention",
    "/api/sessions",
    "/api/sessions/:id",
    "/api/workitems",
    "/api/workitems/:id/agent-runs",
    "/api/agent-runs/:id",
    "/api/agent-runs/:id/trace",
    "/api/knowledge/search",
    "/api/pages/gold-path",
    "/intake/:sessionId",
    "/knowledge/search",
    "/api/pages/workitems/:id",
    "/api/workitems/:id/conflicts",
    "/api/pages/proposals/:id",
    "/api/pages/drive",
    "/api/drive/projects/:projectId/files",
    "/api/drive/projects/:projectId/items/:itemId/delete",
    "/api/drive/projects/:projectId/items/:itemId/restore",
    "/api/drive/projects/:projectId/comments/:commentId/draft",
    "/api/drive/workitems/:workItemId/proposal-draft",
    "/api/pages/approvals",
    "/api/pages/cost",
    "/api/pages/settings",
    "/api/agent-runs/:id/replay",
    "/settings"
  ],
  consumesTypedClient: "@workhub/api-client",
  cuuCardAdapter: "@workhub/cuu",
  rustEventBridge: "push-event -> shell-events -> @workhub/cuu",
  rustOwns: ["device_token", "tray", "deep_link", "local_sync", "system_notification"]
} as const;

export function createDesktopWebviewApiClient(input: {
  baseUrl: string;
  getClientToken: () => string | undefined;
}) {
  return createApiClient({
    baseUrl: input.baseUrl,
    getClientToken: input.getClientToken
  });
}

export function loadDesktopGoldPathSurface(client: WorkHubApiClient, locale?: WorkHubLocale) {
  return client.pages.goldPath(locale ? { locale } : undefined);
}

export async function renderDesktopGoldPathSurface(client: WorkHubApiClient, locale?: WorkHubLocale) {
  return renderGoldPathSurface(await loadDesktopGoldPathSurface(client, locale), "desktop", { locale });
}

export function startDesktopIntakeSession(client: WorkHubApiClient, payload: CreateSessionRequest = {}) {
  return client.createSession(payload);
}

export async function renderDesktopIntakeSession(
  client: WorkHubApiClient,
  payload: CreateSessionRequest = {},
  locale?: WorkHubLocale
) {
  return renderIntakeSession(await startDesktopIntakeSession(client, payload), "desktop", locale ? { locale } : undefined);
}

export function createDesktopWorkItem(client: WorkHubApiClient, payload: CreateWorkItemRequest) {
  return client.createWorkItem(payload);
}

export function loadDesktopWorkItemDetail(client: WorkHubApiClient, workItemId: string, locale?: WorkHubLocale) {
  return client.pages.workItem(workItemId, locale ? { locale } : undefined);
}

export async function renderDesktopWorkItemDetail(client: WorkHubApiClient, workItemId: string, locale?: WorkHubLocale) {
  return renderWorkItemDetail(await loadDesktopWorkItemDetail(client, workItemId, locale), "desktop", locale ? { locale } : undefined);
}

export function startDesktopAgentRun(
  client: WorkHubApiClient,
  workItemId: string,
  payload: StartAgentRunRequest = {}
) {
  return client.startAgentRun(workItemId, payload);
}

export function loadDesktopAgentRun(client: WorkHubApiClient, runId: string) {
  return client.getAgentRun(runId);
}

export function loadDesktopAgentRunTrace(client: WorkHubApiClient, runId: string, after?: number) {
  return client.getAgentRunTrace(runId, after);
}

export function loadDesktopAgentRunReplay(client: WorkHubApiClient, runId: string) {
  return client.replayAgentRun(runId);
}

export async function renderDesktopAgentRunReplay(client: WorkHubApiClient, runId: string, locale?: WorkHubLocale) {
  return renderAgentRunReplay(await loadDesktopAgentRunReplay(client, runId), "desktop", locale ? { locale } : undefined);
}

export async function renderDesktopAgentRunLive(client: WorkHubApiClient, runId: string, locale?: WorkHubLocale) {
  return renderAgentRunLive(await loadDesktopAgentRun(client, runId), "desktop", locale ? { locale } : undefined);
}

export function loadDesktopProposalDetail(client: WorkHubApiClient, proposalId: string, locale?: WorkHubLocale) {
  return client.pages.proposal(proposalId, locale ? { locale } : undefined);
}

export async function loadDesktopProposalConflicts(client: WorkHubApiClient, proposal: ProposalDetailVM): Promise<ProposalConflict[]> {
  const result = await client.listWorkItemConflicts(proposal.work_item_id);
  return result.conflicts.filter((conflict) => conflict.proposal_id === proposal.proposal_id);
}

export async function renderDesktopProposalDetail(client: WorkHubApiClient, proposalId: string, locale?: WorkHubLocale) {
  const proposal = await loadDesktopProposalDetail(client, proposalId, locale);
  return renderProposalDetail(proposal, "desktop", {
    ...(locale ? { locale } : {}),
    conflicts: await loadDesktopProposalConflicts(client, proposal)
  });
}

export function desktopCuuCardFromEvent(event: WorkHubEvent<unknown>, locale?: WorkHubLocale): CuuCard {
  return cardFromEvent(event, locale ? { locale } : undefined);
}

export async function loadDesktopProposalCuuCard(client: WorkHubApiClient, proposalId: string, locale?: WorkHubLocale): Promise<CuuCard> {
  return cardFromProposalDetail(await loadDesktopProposalDetail(client, proposalId, locale), locale ? { locale } : undefined);
}

export async function loadDesktopProposalConflictCuuCards(
  client: WorkHubApiClient,
  proposalId: string,
  locale?: WorkHubLocale
): Promise<CuuCard[]> {
  const proposal = await loadDesktopProposalDetail(client, proposalId, locale);
  return cardsFromProposalConflicts(await loadDesktopProposalConflicts(client, proposal), locale ? { locale } : undefined);
}

export async function loadDesktopIntakeCuuCard(
  client: WorkHubApiClient,
  payload: CreateSessionRequest = {},
  locale?: WorkHubLocale
): Promise<CuuCard> {
  return cardFromSessionVm(await startDesktopIntakeSession(client, payload), locale ? { locale } : undefined);
}

export async function createDesktopWorkItemCuuCard(
  client: WorkHubApiClient,
  payload: CreateWorkItemRequest,
  locale?: WorkHubLocale
): Promise<CuuCard> {
  return cardFromWorkItemDetail(await createDesktopWorkItem(client, payload), locale ? { locale } : undefined);
}

export async function loadDesktopWorkItemCuuCard(client: WorkHubApiClient, workItemId: string, locale?: WorkHubLocale): Promise<CuuCard> {
  return cardFromWorkItemDetail(await loadDesktopWorkItemDetail(client, workItemId, locale), locale ? { locale } : undefined);
}

export async function startDesktopAgentRunCuuCard(
  client: WorkHubApiClient,
  workItemId: string,
  payload: StartAgentRunRequest = {},
  locale?: WorkHubLocale
): Promise<CuuCard> {
  return cardFromAgentRunLive(await startDesktopAgentRun(client, workItemId, payload), locale ? { locale } : undefined);
}

export async function loadDesktopAgentRunCuuCard(client: WorkHubApiClient, runId: string, locale?: WorkHubLocale): Promise<CuuCard> {
  return cardFromAgentRunLive(await loadDesktopAgentRun(client, runId), locale ? { locale } : undefined);
}

export {
  bootDesktopPetSurface,
  desktopPetRunRestoreStorageKey,
  desktopPetSurfaceCss,
  renderDesktopPetSurface,
  resolveDesktopSurface,
  type DesktopPetSurfaceClient,
  type DesktopPetSurfaceRender,
  type DesktopPetSurfaceRuntime,
  type DesktopSurface
} from "./pet-surface.js";

export {
  createDesktopPetPointerSensor,
  desktopPetPointerSnapshotFromSample,
  desktopPetWindowModeForCard,
  desktopPetWindowSettingsFromPreferences,
  normalizeDesktopPetPointerSnapshot,
  pointerPatchFromEvent,
  resolveDesktopPetWindowBridge,
  type PetCursorSampleResult,
  type DesktopPetPointerSensor,
  type DesktopPetPointerSnapshot,
  type DesktopPetOpacityPercent,
  type DesktopPetScalePercent,
  type DesktopPetWindowBridge,
  type DesktopPetWindowMode,
  type DesktopPetWindowSettings
} from "./pet-window-bridge.js";

export {
  cardFromDesktopCuuRuntimeError,
  createDesktopCuuAgentLauncherCard,
  resolveDesktopCuuAction,
  startDesktopCuuAgentFromLauncher,
  subscribeDesktopCuuAgentRunStream,
  submitDesktopCuuAction,
  type DesktopCuuActionRequest,
  type DesktopCuuActionResult,
  type DesktopCuuAgentLaunchClient,
  type DesktopCuuAgentLaunchResult,
  type DesktopCuuRunStreamStatus,
  type DesktopCuuRunStreamSubscription
} from "./desktop-cuu-runtime.js";

export {
  createDesktopShellEventBridge,
  desktopCuuCardFromShellPush,
  desktopCuuCardFromShellSseStatus,
  parseDesktopShellPushPayload,
  parseDesktopShellSseStatusPayload,
  workHubEventFromDesktopShellPush,
  type DesktopShellBridgeEvent,
  type DesktopShellPushPayload,
  type DesktopShellSseStatusPayload
} from "./shell-events.js";
