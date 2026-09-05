import { createApiClient, type CreateTaskPlanRequest, type WorkHubApiClient } from "@workhub/api-client";
import { defaultPorts } from "@workhub/config/ports";
import type { CreateSessionRequest, CreateWorkItemRequest, ProposalConflict, ProposalDetailVM, StartAgentRunRequest, WorkHubEvent } from "@workhub/contracts";
import { cardFromAgentRunLive, cardFromEvent, cardFromSessionVm, cardFromWorkItemDetail, type CuuCard } from "@workhub/cuu";
import { renderAgentRunLive } from "@workhub/ui/agent-run";
import { renderGoldPathSurface, type WorkHubLocale } from "@workhub/ui/gold-path";
import { renderIntakeSession } from "@workhub/ui/intake";
import { renderWorkItemDetail } from "@workhub/ui/workitem";
import { renderProposalDetail } from "@workhub/ui/proposal";
import { bindReplayRevertActions, renderAgentRunReplay, type ReplayRevertRoot } from "@workhub/ui/replay";

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
    "/api/workitems/:id/task-plan",
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
    "/api/pages/meetings",
    "/api/pages/notifications",
    "/api/pages/calendar",
    "/meetings",
    "/notifications",
    "/calendar",
    "/api/drive/projects/:projectId/files",
    "/api/drive/projects/:projectId/items/:itemId/delete",
    "/api/drive/projects/:projectId/items/:itemId/restore",
    "/api/drive/projects/:projectId/comments/:commentId/draft",
    "/api/drive/workitems/:workItemId/proposal-draft",
    "/api/meetings/projects/:projectId/insights/:insightId/draft",
    "/api/meetings/projects/:projectId/insights/:insightId/dismiss",
    "/api/meetings/workitems/:workItemId/proposal-draft",
    "/api/notifications/:id/read",
    "/api/notifications/read-all",
    "/api/notifications/:id/dismiss",
    "/api/notifications/:id/complete",
    "/api/pages/approvals",
    "/api/pages/cost",
    "/api/pages/agents",
    "/api/pages/settings",
    "/api/agent-runs/:id/replay",
    "/dashboard/agents",
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

export function createDesktopTaskPlan(
  client: WorkHubApiClient,
  workItemId: string,
  payload: CreateTaskPlanRequest = {},
  locale?: WorkHubLocale
) {
  return client.createTaskPlan(workItemId, payload, locale ? { locale } : undefined);
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

// R20 DSK-UX（R19-3）：桌面壳挂上 replay 的 HTML 后调这里，给「撤销此次改动」按钮接真回调——桌面本就是
// 本地客户端，可直接执行 POST /api/agent-runs/:id/revert（snapshot_id 走 body）。web 端不接这条、由既有
// data-requires-desktop 拦截渲成「需在桌面端操作」。二次确认 + 刷新都在 @workhub/ui 的 bindReplayRevertActions
// 里，这里只做「传 client + 回调」的薄接线。缺 revertAgentRun（旧 client）则安静退化成 no-op。
export function bindDesktopAgentRunReplayRevert(
  root: ReplayRevertRoot,
  client: WorkHubApiClient,
  options?: { onReverted?: (info: { runId: string; snapshotId: string }) => void }
): () => void {
  const revert = client.revertAgentRun;
  if (!revert) {
    return () => {};
  }
  return bindReplayRevertActions(root, {
    revert: (runId, payload) => revert(runId, payload),
    ...(options?.onReverted ? { onReverted: options.onReverted } : {})
  });
}

export function loadDesktopAgentArmyDashboard(client: WorkHubApiClient, locale?: WorkHubLocale) {
  return client.pages.agents(locale ? { locale } : undefined);
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

// WIRE-06：loadDesktopProposalCuuCard / loadDesktopProposalConflictCuuCards 已删——它们只被这个死 barrel
// 自己引用（其依赖的 cuu 侧死导出 cardFromProposalDetail/cardsFromProposalConflicts 同步删除）；
// 提议卡的真实生产路径是 attention 卡（cardFromAttentionItem）与桌宠冲突卡（cardFromProposalConflict）。

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
