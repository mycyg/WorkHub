import assert from "node:assert/strict";
import test from "node:test";

import { eventTypes } from "@workhub/contracts";

import {
  desktopPetQaScenarioFromGlobal,
  desktopPetQaScriptForScenario,
  normalizeDesktopPetQaScenario
} from "./cuu-qa-scenarios.js";

test("desktop pet QA scenarios create business push events for motion capture", () => {
  const approval = desktopPetQaScriptForScenario("approval", { initialDelayMs: 25 });
  const approvalPayload = approval[0]?.payload as { event?: string; data?: string; stream_path?: string };
  const approvalEvent = JSON.parse(approvalPayload.data ?? "{}");
  const search = desktopPetQaScriptForScenario("search");
  const searchPayload = search[0]?.payload as { event?: string; data?: string; stream_path?: string };
  const searchEvent = JSON.parse(searchPayload.data ?? "{}");

  assert.equal(approval.length, 1);
  assert.equal(approval[0]?.eventName, "push-event");
  assert.equal(approval[0]?.delayMs, 25);
  assert.equal(approvalPayload.event, eventTypes.permissionAsk);
  assert.equal(approvalPayload.stream_path, "/api/push/stream/me");
  assert.equal(approvalEvent.attention.kind, "approval");
  assert.equal(approvalEvent.attention.cuu_state, "asking_approval");
  assert.equal(approvalEvent.attention.actions[1].requires_reason, true);

  assert.equal(searchPayload.event, eventTypes.knowledgeEvidenceReady);
  assert.equal(searchEvent.attention.kind, "knowledge_result");
  assert.equal(searchEvent.attention.cuu_state, "searching_evidence");
  assert.equal(searchEvent.attention.evidence_refs.length, 2);
});

test("desktop pet QA scenarios cover clarify sync done and offline", () => {
  const launcher = desktopPetQaScriptForScenario("launcher");
  const clarify = desktopPetQaScriptForScenario("clarify");
  const clarifyPayload = clarify[0]?.payload as { data?: string; stream_path?: string };
  const clarifyEvent = JSON.parse(clarifyPayload.data ?? "{}");
  const sync = desktopPetQaScriptForScenario("sync");
  const syncPayload = sync[0]?.payload as { data?: string; event?: string; stream_path?: string };
  const syncEvent = JSON.parse(syncPayload.data ?? "{}");
  const done = desktopPetQaScriptForScenario("done");
  const donePayload = done[0]?.payload as { data?: string; event?: string; stream_path?: string };
  const doneEvent = JSON.parse(donePayload.data ?? "{}");
  const offline = desktopPetQaScriptForScenario("offline", { initialDelayMs: 15 });
  const offlinePayload = offline[0]?.payload as { state?: string; stream_path?: string };

  assert.equal(launcher.length, 0);
  assert.equal(clarifyPayload.stream_path, "/api/push/stream/session/10000000-0000-4000-8000-000000000104");
  assert.equal(clarifyEvent.attention.kind, "clarification");
  assert.equal(clarifyEvent.attention.cuu_state, "asking_approval");
  assert.equal(syncPayload.event, eventTypes.syncProgress);
  assert.equal(syncEvent.cuu_state, "syncing_files");
  assert.equal(syncEvent.attention.kind, "sync_conflict");
  assert.equal(syncEvent.attention.cuu_state, "syncing_files");
  assert.equal(donePayload.event, eventTypes.agentRunStep);
  assert.equal(doneEvent.cuu_state, "celebrating");
  assert.equal(doneEvent.data.status, "succeeded");
  assert.equal(offline[0]?.eventName, "sse-status");
  assert.equal(offline[0]?.delayMs, 15);
  assert.equal(offlinePayload.state, "retrying");
  assert.equal(offlinePayload.stream_path, "/api/push/stream/me");
});

test("desktop pet QA scenario normalization only accepts explicit capture scenarios", () => {
  assert.equal(normalizeDesktopPetQaScenario("launcher"), "launcher");
  assert.equal(normalizeDesktopPetQaScenario("approval"), "approval");
  assert.equal(normalizeDesktopPetQaScenario("idle"), undefined);
  assert.equal(normalizeDesktopPetQaScenario("legacy-cuu-pack"), undefined);
  assert.equal(desktopPetQaScenarioFromGlobal({ __WORKHUB_CUU_QA_SCENARIO__: "done" }), "done");
  assert.equal(desktopPetQaScenarioFromGlobal({ __WORKHUB_CUU_QA_SCENARIO__: "orange" }), undefined);
});
