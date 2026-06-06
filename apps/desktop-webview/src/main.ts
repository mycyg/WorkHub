import { createApiClient, type WorkHubApiClient } from "@workhub/api-client";
import { defaultPorts } from "@workhub/config";
import type { CreateSessionRequest, CreateWorkItemRequest, WorkHubEvent } from "@workhub/contracts";
import { cardFromEvent, cardFromProposalDetail, cardFromSessionVm, cardFromWorkItemDetail, type CuuCard } from "@workhub/cuu";
import { renderGoldPathSurface } from "@workhub/ui/gold-path";
import { renderIntakeSession } from "@workhub/ui/intake";
import { renderWorkItemDetail } from "@workhub/ui/workitem";
import { renderProposalDetail } from "@workhub/ui/proposal";

export const desktopWebviewSurface = {
  name: "C-PET webview",
  description: "Tauri webview surface; Rust owns local shell capabilities and this view consumes typed daemon APIs.",
  devPort: defaultPorts.desktopWebview,
  defaultDaemonUrl: `http://127.0.0.1:${defaultPorts.api}`,
  pages: [
    "/api/pages/attention",
    "/api/sessions",
    "/api/workitems",
    "/api/pages/gold-path",
    "/intake/:sessionId",
    "/api/pages/workitems/:id",
    "/api/pages/proposals/:id",
    "/api/pages/approvals",
    "/api/pages/cost",
    "/api/agent-runs/:id/replay"
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

export function loadDesktopGoldPathSurface(client: WorkHubApiClient) {
  return client.pages.goldPath();
}

export async function renderDesktopGoldPathSurface(client: WorkHubApiClient) {
  return renderGoldPathSurface(await loadDesktopGoldPathSurface(client), "desktop");
}

export function startDesktopIntakeSession(client: WorkHubApiClient, payload: CreateSessionRequest = {}) {
  return client.createSession(payload);
}

export async function renderDesktopIntakeSession(client: WorkHubApiClient, payload: CreateSessionRequest = {}) {
  return renderIntakeSession(await startDesktopIntakeSession(client, payload), "desktop");
}

export function createDesktopWorkItem(client: WorkHubApiClient, payload: CreateWorkItemRequest) {
  return client.createWorkItem(payload);
}

export function loadDesktopWorkItemDetail(client: WorkHubApiClient, workItemId: string) {
  return client.pages.workItem(workItemId);
}

export async function renderDesktopWorkItemDetail(client: WorkHubApiClient, workItemId: string) {
  return renderWorkItemDetail(await loadDesktopWorkItemDetail(client, workItemId), "desktop");
}

export function loadDesktopProposalDetail(client: WorkHubApiClient, proposalId: string) {
  return client.pages.proposal(proposalId);
}

export async function renderDesktopProposalDetail(client: WorkHubApiClient, proposalId: string) {
  return renderProposalDetail(await loadDesktopProposalDetail(client, proposalId), "desktop");
}

export function desktopCuuCardFromEvent(event: WorkHubEvent<unknown>): CuuCard {
  return cardFromEvent(event);
}

export async function loadDesktopProposalCuuCard(client: WorkHubApiClient, proposalId: string): Promise<CuuCard> {
  return cardFromProposalDetail(await loadDesktopProposalDetail(client, proposalId));
}

export async function loadDesktopIntakeCuuCard(
  client: WorkHubApiClient,
  payload: CreateSessionRequest = {}
): Promise<CuuCard> {
  return cardFromSessionVm(await startDesktopIntakeSession(client, payload));
}

export async function createDesktopWorkItemCuuCard(
  client: WorkHubApiClient,
  payload: CreateWorkItemRequest
): Promise<CuuCard> {
  return cardFromWorkItemDetail(await createDesktopWorkItem(client, payload));
}

export async function loadDesktopWorkItemCuuCard(client: WorkHubApiClient, workItemId: string): Promise<CuuCard> {
  return cardFromWorkItemDetail(await loadDesktopWorkItemDetail(client, workItemId));
}

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
