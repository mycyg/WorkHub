import assert from "node:assert/strict";
import test from "node:test";

import { eventTypes } from "@workhub/contracts";

import {
  createDesktopPetQaShellListen,
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
  const runStream = desktopPetQaScriptForScenario("run-stream");
  const runFailure = desktopPetQaScriptForScenario("run-failure");
  const physicalTray = desktopPetQaScriptForScenario("pass-through-recovery-tray-physical");
  const reloadSession = desktopPetQaScriptForScenario("reload-session");
  const reloadActiveRun = desktopPetQaScriptForScenario("reload-active-run");
  const reloadTerminalRun = desktopPetQaScriptForScenario("reload-terminal-run");
  const permission401 = desktopPetQaScriptForScenario("permission-401");
  const permission403 = desktopPetQaScriptForScenario("permission-403");
  const genericRuntimeError = desktopPetQaScriptForScenario("generic-runtime-error");
  const streamOffline = desktopPetQaScriptForScenario("stream-offline");
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
  assert.equal(runStream.length, 0);
  assert.equal(runFailure.length, 0);
  assert.equal(physicalTray.length, 0);
  assert.equal(reloadSession.length, 0);
  assert.equal(reloadActiveRun.length, 0);
  assert.equal(reloadTerminalRun.length, 0);
  assert.equal(permission401.length, 0);
  assert.equal(permission403.length, 0);
  assert.equal(genericRuntimeError.length, 0);
  assert.equal(streamOffline.length, 0);
  assert.equal(desktopPetQaScriptForScenario("settings-menu").length, 0);
  assert.equal(desktopPetQaScriptForScenario("settings-menu-model-switch").length, 0);
  assert.equal(desktopPetQaScriptForScenario("settings-menu-hover-sync").length, 0);
  assert.equal(desktopPetQaScriptForScenario("pass-through-recovery-settings").length, 0);
  assert.equal(desktopPetQaScriptForScenario("pass-through-recovery-tray").length, 0);
  assert.equal(desktopPetQaScriptForScenario("pass-through-recovery-tray-physical").length, 0);
  assert.equal(createDesktopPetQaShellListen("launcher"), undefined);
  assert.equal(createDesktopPetQaShellListen("settings-menu"), undefined);
  assert.equal(createDesktopPetQaShellListen("settings-menu-hover-sync"), undefined);
  assert.equal(createDesktopPetQaShellListen("pass-through-recovery-tray"), undefined);
  assert.equal(createDesktopPetQaShellListen("pass-through-recovery-tray-physical"), undefined);
  assert.equal(createDesktopPetQaShellListen("run-stream"), undefined);
  assert.equal(createDesktopPetQaShellListen("run-failure"), undefined);
  assert.equal(createDesktopPetQaShellListen("reload-session"), undefined);
  assert.equal(createDesktopPetQaShellListen("reload-active-run"), undefined);
  assert.equal(createDesktopPetQaShellListen("reload-terminal-run"), undefined);
  assert.equal(createDesktopPetQaShellListen("permission-401"), undefined);
  assert.equal(createDesktopPetQaShellListen("permission-403"), undefined);
  assert.equal(createDesktopPetQaShellListen("generic-runtime-error"), undefined);
  assert.equal(createDesktopPetQaShellListen("stream-offline"), undefined);
  assert.equal(clarifyPayload.stream_path, "/api/push/stream/session/10000000-0000-4000-8000-000000000104");
  assert.equal(clarifyEvent.attention.kind, "clarification");
  assert.equal(clarifyEvent.attention.cuu_state, "asking_approval");
  assert.match(clarifyEvent.attention.title, /workhub-app-upload\.txt/u);
  assert.match(clarifyEvent.attention.summary_text, /AI 已读取需求和项目文件/u);
  assert.doesNotMatch(`${clarifyEvent.preview_text} ${clarifyEvent.attention.title} ${clarifyEvent.attention.summary_text} ${clarifyEvent.attention.reason_text ?? ""}`, /交付口径|交付方式|文档\/方案|结构化数据|小型代码|隐藏思考|工具状态|最终反问/u);
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
  assert.equal(normalizeDesktopPetQaScenario("settings-menu"), "settings-menu");
  assert.equal(normalizeDesktopPetQaScenario("settings-menu-model-switch"), "settings-menu-model-switch");
  assert.equal(normalizeDesktopPetQaScenario("settings-menu-hover-sync"), "settings-menu-hover-sync");
  assert.equal(normalizeDesktopPetQaScenario("pass-through-recovery-settings"), "pass-through-recovery-settings");
  assert.equal(normalizeDesktopPetQaScenario("pass-through-recovery-tray"), "pass-through-recovery-tray");
  assert.equal(normalizeDesktopPetQaScenario("pass-through-recovery-tray-physical"), "pass-through-recovery-tray-physical");
  assert.equal(normalizeDesktopPetQaScenario("approval"), "approval");
  assert.equal(normalizeDesktopPetQaScenario("run-stream"), "run-stream");
  assert.equal(normalizeDesktopPetQaScenario("run-failure"), "run-failure");
  assert.equal(normalizeDesktopPetQaScenario("reload-session"), "reload-session");
  assert.equal(normalizeDesktopPetQaScenario("reload-active-run"), "reload-active-run");
  assert.equal(normalizeDesktopPetQaScenario("reload-terminal-run"), "reload-terminal-run");
  assert.equal(normalizeDesktopPetQaScenario("permission-401"), "permission-401");
  assert.equal(normalizeDesktopPetQaScenario("permission-403"), "permission-403");
  assert.equal(normalizeDesktopPetQaScenario("generic-runtime-error"), "generic-runtime-error");
  assert.equal(normalizeDesktopPetQaScenario("stream-offline"), "stream-offline");
  assert.equal(normalizeDesktopPetQaScenario("idle"), undefined);
  assert.equal(normalizeDesktopPetQaScenario("legacy-cuu-pack"), undefined);
  assert.equal(desktopPetQaScenarioFromGlobal({ __WORKHUB_CUU_QA_SCENARIO__: "done" }), "done");
  assert.equal(desktopPetQaScenarioFromGlobal({ __WORKHUB_CUU_QA_SCENARIO__: "orange" }), undefined);
});
