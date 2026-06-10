import assert from "node:assert/strict";

import { createApiClient, WorkHubApiError } from "@workhub/api-client";
import type { AgentRunLiveVM } from "@workhub/contracts";
import type { CuuCard } from "@workhub/cuu";

import {
  cardFromDesktopCuuRuntimeError,
  createDesktopCuuAgentLauncherCard,
  resolveDesktopCuuAction,
  submitDesktopCuuAction
} from "../../../desktop-webview/src/desktop-cuu-runtime.js";
import {
  createCuuR3SmokeApp,
  cuuR3SmokeClientToken,
  type CuuR3ApiFault
} from "./cuu-r3-launcher-harness.js";

async function main() {
  const permission401 = await runFaultCase("permission-401");
  const permission403 = await runFaultCase("permission-403");
  const streamOffline = await runFaultCase("stream-offline");
  const generic502 = await runFaultCase("generic-502");

  assert.equal(permission401.card.kind, "bubble");
  assert.equal(permission401.card.state, "worried");
  assert.equal(permission401.card.payload_ref?.entity_type, "agent_run");
  assert.equal(permission401.card.actions.some((action) => action.id === "view_replay"), true);

  assert.equal(permission403.card.kind, "bubble");
  assert.equal(permission403.card.state, "worried");
  assert.equal(permission403.card.payload_ref?.entity_type, "agent_run");
  assert.equal(permission403.card.actions.some((action) => action.id === "view_replay"), true);

  assert.equal(streamOffline.card.kind, "offline");
  assert.equal(streamOffline.card.state, "offline");
  assert.equal(streamOffline.card.payload_ref?.entity_type, "agent_run");
  assert.equal(streamOffline.card.actions.some((action) => action.id === "view_replay"), true);

  assert.equal(generic502.card.kind, "bubble");
  assert.equal(generic502.card.state, "worried");
  assert.equal(generic502.card.payload_ref?.entity_type, "agent_run");
  assert.equal(generic502.card.actions.some((action) => action.id === "view_replay"), true);

  console.log(JSON.stringify({
    ok: true,
    smoke: "cuu-r3-error-fault",
    route_stack: ["sessions", "workitems", "agent-runs", "agent-run-read-fault"],
    cases: [permission401, permission403, streamOffline, generic502].map(({ apiFault, run, error, card }) => ({
      api_fault: apiFault,
      run_id: run.run_id,
      error_status: error.status,
      error_code: error.code,
      card_kind: card.kind,
      card_state: card.state,
      payload_ref: card.payload_ref?.entity_type,
      primary_action: card.actions[0]?.id
    }))
  }, null, 2));
}

async function runFaultCase(apiFault: Exclude<CuuR3ApiFault, "none">) {
  const { app } = createCuuR3SmokeApp({
    runStream: true,
    apiFault,
    runDelayMs: 0,
    modelDelayMs: 1
  });
  const client = createApiClient({
    baseUrl: "http://workhub-cuu-r3-fault.local",
    fetchFn: async (input, init) => {
      const url = new URL(String(input));
      return app.request(`${url.pathname}${url.search}`, init);
    },
    getClientToken: () => cuuR3SmokeClientToken
  });

  const health = await client.health() as { api_fault?: string };
  assert.equal(health.api_fault, apiFault);

  const started = await startRun(client);
  const error = await captureGetAgentRunError(client, started.run);
  const card = cardFromDesktopCuuRuntimeError(error, { locale: "en-US", run: started.run });
  return { apiFault, run: started.run, error, card };
}

async function startRun(client: ReturnType<typeof createApiClient>) {
  const launcher = selectChip(createDesktopCuuAgentLauncherCard({ locale: "en-US" }), "document-draft");
  const clarification = await submitDesktopCuuAction({
    client,
    action: resolveCardAction(launcher, "start_agent_from_cuu"),
    locale: "en-US"
  });
  assert.ok(clarification.card);

  const scopeCard = selectChip(clarification.card, "document-draft");
  const confirmation = await submitDesktopCuuAction({
    client,
    action: resolveCardAction(scopeCard, "submit_option"),
    locale: "en-US"
  });
  assert.ok(confirmation.card);

  const confirmCard = selectChip(confirmation.card, "create-workitem");
  const started = await submitDesktopCuuAction({
    client,
    action: resolveCardAction(confirmCard, "submit_option"),
    locale: "en-US"
  });
  assert.ok(started.agentRun);
  return { run: started.agentRun };
}

function resolveCardAction(card: CuuCard, actionId: string) {
  const href = card.actions[0]?.href;
  assert.ok(href);
  const action = resolveDesktopCuuAction(href, { actionId, card });
  assert.ok(action);
  return action;
}

function selectChip(card: CuuCard, chipId: string): CuuCard {
  const chips = card.chips?.map((chip) => ({ ...chip, selected: chip.id === chipId }));
  return chips ? { ...card, chips } : card;
}

async function captureGetAgentRunError(client: ReturnType<typeof createApiClient>, run: AgentRunLiveVM) {
  try {
    await client.getAgentRun(run.run_id);
  } catch (error) {
    assert.ok(error instanceof WorkHubApiError);
    return error;
  }
  throw new Error("Expected getAgentRun to fail for Cuu R3 API fault smoke.");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
