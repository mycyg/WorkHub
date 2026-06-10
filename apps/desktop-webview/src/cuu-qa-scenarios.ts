import { eventTypes, type WorkHubEvent } from "@workhub/contracts";

import {
  createDesktopShellScriptedListener,
  type DesktopShellListen,
  type DesktopShellScriptedEvent
} from "./desktop-cuu-runtime.js";

export type DesktopPetQaScenario =
  | "launcher"
  | "settings-menu"
  | "settings-menu-model-switch"
  | "settings-menu-hover-sync"
  | "pass-through-recovery-settings"
  | "pass-through-recovery-tray"
  | "pass-through-recovery-tray-physical"
  | "clarify"
  | "approval"
  | "search"
  | "sync"
  | "done"
  | "run-stream"
  | "run-failure"
  | "reload-session"
  | "reload-active-run"
  | "reload-terminal-run"
  | "permission-401"
  | "permission-403"
  | "stream-offline"
  | "offline";

export type DesktopPetQaScenarioGlobal = {
  __WORKHUB_CUU_QA_SCENARIO__?: unknown;
};

const qaScenarioSet = new Set<DesktopPetQaScenario>([
  "launcher",
  "settings-menu",
  "settings-menu-model-switch",
  "settings-menu-hover-sync",
  "pass-through-recovery-settings",
  "pass-through-recovery-tray",
  "pass-through-recovery-tray-physical",
  "clarify",
  "approval",
  "search",
  "sync",
  "done",
  "run-stream",
  "run-failure",
  "reload-session",
  "reload-active-run",
  "reload-terminal-run",
  "permission-401",
  "permission-403",
  "stream-offline",
  "offline"
]);

const ts = "2026-06-08T01:00:00.000Z";
const workItemId = "10000000-0000-4000-8000-000000000101";
const proposalId = "10000000-0000-4000-8000-000000000102";
const approvalId = "10000000-0000-4000-8000-000000000103";
const sessionId = "10000000-0000-4000-8000-000000000104";
const runId = "10000000-0000-4000-8000-000000000105";
const knowledgeRunId = "10000000-0000-4000-8000-000000000106";

export function normalizeDesktopPetQaScenario(value: unknown): DesktopPetQaScenario | undefined {
  return typeof value === "string" && qaScenarioSet.has(value as DesktopPetQaScenario)
    ? value as DesktopPetQaScenario
    : undefined;
}

export function desktopPetQaScenarioFromGlobal(
  target: DesktopPetQaScenarioGlobal = globalThis as DesktopPetQaScenarioGlobal
): DesktopPetQaScenario | undefined {
  return normalizeDesktopPetQaScenario(target.__WORKHUB_CUU_QA_SCENARIO__);
}

export function createDesktopPetQaShellListen(
  scenario: DesktopPetQaScenario | undefined,
  input: { initialDelayMs?: number | undefined } = {}
): DesktopShellListen | undefined {
  if (!scenario) {
    return undefined;
  }
  if (desktopPetQaScenarioUsesRunApi(scenario)) {
    return undefined;
  }
  const events = desktopPetQaScriptForScenario(scenario, input);
  if (events.length === 0) {
    return undefined;
  }
  const listener = createDesktopShellScriptedListener(events);
  listener.start();
  return listener.listen;
}

export function createDesktopPetQaShellListenFromGlobal(
  target: DesktopPetQaScenarioGlobal = globalThis as DesktopPetQaScenarioGlobal
): DesktopShellListen | undefined {
  return createDesktopPetQaShellListen(desktopPetQaScenarioFromGlobal(target));
}

export function desktopPetQaScriptForScenario(
  scenario: DesktopPetQaScenario,
  input: { initialDelayMs?: number | undefined } = {}
): DesktopShellScriptedEvent[] {
  const initialDelayMs = input.initialDelayMs ?? 650;
  if (scenario === "launcher") {
    return [];
  }
  if (desktopPetQaScenarioUsesManualCdp(scenario)) {
    return [];
  }
  if (desktopPetQaScenarioUsesRunApi(scenario)) {
    return [];
  }
  if (scenario === "offline") {
    return [
      {
        eventName: "sse-status",
        delayMs: initialDelayMs,
        payload: {
          stream_kind: "me",
          stream_path: "/api/push/stream/me",
          state: "retrying",
          message: "QA: daemon disconnected so Cuu should show a calm reconnect bubble."
        }
      }
    ];
  }

  return [
    {
      eventName: "push-event",
      delayMs: initialDelayMs,
      payload: shellPayload(eventForScenario(scenario))
    }
  ];
}

function shellPayload(event: WorkHubEvent<unknown>) {
  const stream = streamForTopic(event.topic);
  return {
    event: event.type,
    data: JSON.stringify(event),
    stream_kind: stream.kind,
    stream_path: stream.path
  };
}

function streamForTopic(topic: string) {
  const [kind, id] = topic.split(":", 2);
  if (kind === "user") {
    return { kind: "me", path: "/api/push/stream/me" };
  }
  if (kind === "session" && id) {
    return { kind, path: `/api/push/stream/session/${encodeURIComponent(id)}` };
  }
  if (kind === "workitem" && id) {
    return { kind, path: `/api/push/stream/workitem/${encodeURIComponent(id)}` };
  }
  if (kind === "run" && id) {
    return { kind, path: `/api/push/stream/run/${encodeURIComponent(id)}` };
  }
  return { kind: "global", path: "/api/push/stream" };
}

function desktopPetQaScenarioUsesRunApi(scenario: DesktopPetQaScenario) {
  return scenario === "run-stream" ||
    scenario === "run-failure" ||
    scenario === "reload-session" ||
    scenario === "reload-active-run" ||
    scenario === "reload-terminal-run" ||
    scenario === "permission-401" ||
    scenario === "permission-403" ||
    scenario === "stream-offline";
}

function desktopPetQaScenarioUsesManualCdp(scenario: DesktopPetQaScenario) {
  return scenario === "settings-menu" ||
    scenario === "settings-menu-model-switch" ||
    scenario === "settings-menu-hover-sync" ||
    scenario === "pass-through-recovery-settings" ||
    scenario === "pass-through-recovery-tray" ||
    scenario === "pass-through-recovery-tray-physical";
}

function eventForScenario(
  scenario: Exclude<
    DesktopPetQaScenario,
    | "launcher"
    | "settings-menu"
    | "settings-menu-model-switch"
    | "settings-menu-hover-sync"
    | "pass-through-recovery-settings"
    | "pass-through-recovery-tray"
    | "pass-through-recovery-tray-physical"
    | "run-stream"
    | "run-failure"
    | "reload-session"
    | "reload-active-run"
    | "reload-terminal-run"
    | "permission-401"
    | "permission-403"
    | "stream-offline"
    | "offline"
  >
): WorkHubEvent<unknown> {
  switch (scenario) {
    case "clarify":
      return {
        event_id: "20000000-0000-4000-8000-000000000201",
        type: eventTypes.permissionAsk,
        topic: `session:${sessionId}`,
        ts,
        session_id: sessionId,
        preview_text: "这次要按哪种交付口径整理？点一个选项即可。",
        attention: {
          id: "20000000-0000-4000-8000-000000000202",
          kind: "clarification",
          priority: "high",
          work_item_id: workItemId,
          source_ref: { entity_type: "approval_request", entity_id: approvalId },
          title: "选一个交付口径",
          summary_text: "Cuu 推荐先生成 PR-like 变更说明。",
          reason_text: "不用打字，点选项即可继续。",
          actions: [
            { id: "submit_option", label: "确认选项", style: "primary", method: "POST", href: `/api/sessions/${sessionId}/next-question` }
          ],
          cuu_state: "asking_approval",
          created_at: ts
        },
        data: { session_id: sessionId, question: "delivery_style" }
      };
    case "approval":
      return {
        event_id: "20000000-0000-4000-8000-000000000211",
        type: eventTypes.permissionAsk,
        topic: "user:me",
        ts,
        work_item_id: workItemId,
        proposal_id: proposalId,
        preview_text: "Cuu 需要你批准这次 file-only 变更。",
        attention: {
          id: "20000000-0000-4000-8000-000000000212",
          kind: "approval",
          priority: "urgent",
          work_item_id: workItemId,
          source_ref: { entity_type: "approval_request", entity_id: approvalId },
          title: "需要审批",
          summary_text: "AI 准备好了一个变更申请。",
          reason_text: "点同意后才会正式交付。",
          actions: [
            { id: "approve", label: "同意", style: "primary", method: "POST", href: `/api/approvals/${approvalId}/respond` },
            { id: "request_changes", label: "打回", style: "danger", method: "POST", href: `/api/approvals/${approvalId}/respond`, requires_reason: true },
            { id: "open_proposal", label: "打开", style: "secondary", method: "GET", href: `/proposals/${proposalId}` }
          ],
          cuu_state: "asking_approval",
          created_at: ts
        },
        data: { approval_id: approvalId, proposal_id: proposalId }
      };
    case "search":
      return {
        event_id: "20000000-0000-4000-8000-000000000221",
        type: eventTypes.knowledgeEvidenceReady,
        topic: `workitem:${workItemId}`,
        ts,
        work_item_id: workItemId,
        preview_text: "Cuu 找到了项目证据，可以继续处理。",
        attention: {
          id: "20000000-0000-4000-8000-000000000222",
          kind: "knowledge_result",
          priority: "normal",
          work_item_id: workItemId,
          source_ref: { entity_type: "knowledge_run", entity_id: knowledgeRunId },
          title: "找到项目证据",
          summary_text: "匹配到周会纪要、方案草稿和历史验收记录。",
          evidence_refs: [
            {
              id: "20000000-0000-4000-8000-000000000223",
              source_type: "meeting",
              source_id: "weekly-sync",
              title: "上次周会纪要",
              locator: { path: "meetings/weekly-sync.md" },
              confidence_hint: "found"
            },
            {
              id: "20000000-0000-4000-8000-000000000224",
              source_type: "spec_doc",
              source_id: "brief-v3",
              title: "项目方案草稿",
              locator: { path: "docs/project-brief.md" },
              confidence_hint: "found"
            }
          ],
          actions: [
            { id: "use_for_current_task", label: "用这些证据继续", style: "primary", method: "POST", href: `/api/workitems/${workItemId}/evidence-bindings` },
            { id: "open_full_search", label: "打开完整检索", style: "secondary", method: "GET", href: `/knowledge/search?run=${knowledgeRunId}` }
          ],
          cuu_state: "searching_evidence",
          created_at: ts
        },
        data: { run_id: knowledgeRunId, query: "项目证据" }
      };
    case "sync":
      return {
        event_id: "20000000-0000-4000-8000-000000000231",
        type: eventTypes.syncProgress,
        topic: `workitem:${workItemId}`,
        ts,
        work_item_id: workItemId,
        preview_text: "Cuu 正在同步本地文件和证据索引。",
        cuu_state: "syncing_files",
        attention: {
          id: "20000000-0000-4000-8000-000000000232",
          kind: "sync_conflict",
          priority: "normal",
          work_item_id: workItemId,
          source_ref: { entity_type: "notification", entity_id: "20000000-0000-4000-8000-000000000233" },
          title: "正在同步",
          summary_text: "Cuu 正在同步本地文件和证据索引。",
          actions: [
            { id: "open_sync", label: "查看同步", style: "secondary", method: "GET", href: "/settings?panel=sync" }
          ],
          cuu_state: "syncing_files",
          created_at: ts
        },
        data: { phase: "sync", completed: 7, total: 12 }
      };
    case "done":
      return {
        event_id: "20000000-0000-4000-8000-000000000241",
        type: eventTypes.agentRunStep,
        topic: `run:${runId}`,
        ts,
        run_id: runId,
        work_item_id: workItemId,
        preview_text: "Cuu 已经完成本次执行。",
        cuu_state: "celebrating",
        data: { kind: "done", status: "succeeded" }
      };
  }
}
