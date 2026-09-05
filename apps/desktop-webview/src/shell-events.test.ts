import assert from "node:assert/strict";
import test from "node:test";

import { eventTypes, type AttentionItem, type BudgetNotice, type WorkHubEvent } from "@workhub/contracts";

import {
  createDesktopShellEventBridge,
  desktopCuuCardFromShellPush,
  desktopCuuCardFromShellSseStatus,
  parseDesktopShellNavigatePayload,
  parseDesktopShellPushPayload,
  parseDesktopShellSystemNotificationPlan,
  workHubEventFromDesktopShellPush,
  type DesktopShellPushPayload,
  primeDesktopConnectionState
} from "./shell-events.js";

const now = () => new Date("2026-06-05T01:00:00.000Z");
const workItemId = "10000000-0000-4000-8000-000000000001";

function shellPayload(event: string, data: unknown, streamPath = "/api/push/stream/me"): DesktopShellPushPayload {
  return {
    event,
    data: typeof data === "string" ? data : JSON.stringify(data),
    stream_kind: streamPath.endsWith("/me") ? "me" : "workitem",
    stream_path: streamPath
  };
}

test("desktop shell bridge turns Rust push-event payloads into Cuu approval cards", () => {
  const attention: AttentionItem = {
    id: "attention-1",
    kind: "approval",
    priority: "high",
    source_ref: { entity_type: "approval_request", entity_id: "approval-1" },
    title: "Cuu 需要你批准这次 file-only 变更",
    summary_text: "AI 准备好了一个变更申请。",
    reason_text: "点同意后才会正式交付。",
    actions: [
      { id: "approve", label: "批准", style: "primary", method: "POST", href: "/api/approvals/approval-1/respond" },
      {
        id: "deny",
        label: "打回",
        style: "danger",
        method: "POST",
        href: "/api/approvals/approval-1/respond",
        requires_reason: true
      }
    ],
    cuu_state: "asking_approval",
    created_at: "2026-06-05T01:00:00.000Z"
  };

  const shell = shellPayload(eventTypes.permissionAsk, {
    approval_id: "approval-1",
    summary_text: attention.summary_text,
    attention
  });
  const event = workHubEventFromDesktopShellPush(shell, { now });
  const card = desktopCuuCardFromShellPush(shell, { now });

  assert.equal(event.type, "permission.ask");
  assert.equal(event.topic, "user:me");
  assert.equal(event.preview_text, "AI 准备好了一个变更申请。");
  assert.equal(card?.kind, "approval");
  assert.equal(card?.state, "asking_approval");
  assert.equal(card?.actions.find((action) => action.id === "deny")?.requires_reason, true);
});

test("desktop shell bridge preserves full WorkHubEvent envelopes from daemon SSE", () => {
  const notice: BudgetNotice = {
    code: "budget_exhausted",
    severity: "critical",
    message: "本次任务预算已经用完，Cuu 需要你选择下一步。",
    scope: { kind: "workitem", workitem_id: workItemId },
    usage_ratio: 1.02,
    recommended_action: "pause",
    options: [{ id: "pause", label: "先暂停", action_href: `/api/workitems/${workItemId}/pause` }]
  };
  const embedded: WorkHubEvent<BudgetNotice> = {
    event_id: "event-budget",
    type: eventTypes.budgetExhausted,
    topic: `workitem:${workItemId}`,
    ts: "2026-06-05T01:00:00.000Z",
    work_item_id: workItemId,
    preview_text: notice.message,
    data: notice
  };
  const shell = shellPayload(eventTypes.budgetExhausted, embedded, `/api/push/stream/workitem/${workItemId}`);
  const event = workHubEventFromDesktopShellPush(shell, { now });
  const card = desktopCuuCardFromShellPush(shell, { now });

  assert.equal(event.event_id, "event-budget");
  assert.equal(event.topic, `workitem:${workItemId}`);
  assert.equal(card?.kind, "budget");
  assert.equal(card?.state, "asking_approval");
  assert.equal(card?.actions[0]?.href, `/api/workitems/${workItemId}/pause`);
});

test("desktop shell bridge maps run stream events into Cuu trace completion cards", () => {
  const embedded: WorkHubEvent<unknown> = {
    event_id: "event-run-done",
    type: eventTypes.agentRunStep,
    topic: "run:run-1",
    ts: "2026-06-05T01:00:00.000Z",
    run_id: "run-1",
    preview_text: "Cuu 已经完成本次执行。",
    cuu_state: "celebrating",
    data: { kind: "done", status: "succeeded" }
  };
  const shell = shellPayload(eventTypes.agentRunStep, embedded, "/api/push/stream/run/run-1");
  const event = workHubEventFromDesktopShellPush(shell, { now });
  const card = desktopCuuCardFromShellPush(shell, { now });

  assert.equal(event.topic, "run:run-1");
  assert.equal(event.run_id, "run-1");
  assert.equal(card?.kind, "completion");
  assert.equal(card?.state, "celebrating");
  assert.equal(card?.actions[0]?.href, "/agent-runs/run-1/replay");
});

test("passive connected frames are parsed but do not create Cuu interruption cards", () => {
  const shell = shellPayload("connected", { topic: "user:me" });

  assert.deepEqual(parseDesktopShellPushPayload(shell), shell);
  assert.equal(workHubEventFromDesktopShellPush(shell, { now }).type, "connected");
  assert.equal(desktopCuuCardFromShellPush(shell, { now }), undefined);
});

test("sse-status retrying and closed states become offline Cuu cards", () => {
  const open = desktopCuuCardFromShellSseStatus({
    stream_kind: "global",
    stream_path: "/api/push/stream",
    state: "open"
  });
  const retrying = desktopCuuCardFromShellSseStatus(
    {
      stream_kind: "global",
      stream_path: "/api/push/stream",
      state: "retrying",
      message: "failed to connect SSE stream: error sending request for url (http://127.0.0.1:8787/api/push/stream)"
    },
    { now }
  );

  assert.equal(open, undefined);
  assert.equal(retrying?.kind, "offline");
  assert.equal(retrying?.state, "offline");
  assert.equal(retrying?.motion.sprite_state, "offline_sleep");
  assert.equal(retrying?.title, "连接有点不稳");
  assert.equal(retrying?.message, "Cuu 正在重新连接，恢复后会继续把提醒送到你这里。");
  assert.equal(retrying?.chips?.[0]?.label, "重连中");
  assert.doesNotMatch(retrying?.title ?? "", /failed to connect|127\.0\.0\.1/u);
  assert.doesNotMatch(retrying?.message ?? "", /failed to connect|127\.0\.0\.1/u);

  const english = desktopCuuCardFromShellSseStatus({
    stream_kind: "global",
    stream_path: "/api/push/stream",
    state: "closed"
  }, { now, locale: "en-US" });
  assert.equal(english?.title, "WorkHub is disconnected");
  assert.equal(english?.chips?.[0]?.label, "Disconnected");
});

test("desktop shell event bridge dispatches events and Cuu cards to callbacks", () => {
  const seenEvents: string[] = [];
  const seenCards: string[] = [];
  const bridge = createDesktopShellEventBridge({
    now,
    onEvent: ({ event }) => seenEvents.push(event.type),
    onCuuCard: (card) => seenCards.push(card.state)
  });

  const bridged = bridge.handlePushPayload(
    shellPayload(eventTypes.proposalOpened, {
      proposal_id: "proposal-1",
      summary_text: "Cuu 找到了一个变更申请。"
    })
  );
  const statusCard = bridge.handleSseStatusPayload({
    stream_kind: "global",
    stream_path: "/api/push/stream",
    state: "closed"
  });

  assert.equal(bridged?.event.type, "proposal.opened");
  assert.equal(bridged?.card?.state, "carrying_document");
  assert.equal(statusCard?.state, "offline");
  assert.deepEqual(seenEvents, ["proposal.opened"]);
  assert.deepEqual(seenCards, ["carrying_document", "offline"]);
});

test("desktop shell navigate payloads accept only safe WorkHub routes", () => {
  assert.deepEqual(parseDesktopShellNavigatePayload("/approvals?approvalId=approval-1"), {
    route: "/approvals?approvalId=approval-1"
  });
  assert.deepEqual(parseDesktopShellNavigatePayload({ route: "/proposals/proposal-1" }), {
    route: "/proposals/proposal-1"
  });
  assert.deepEqual(parseDesktopShellNavigatePayload({ path: "/agent-runs/run-1/replay" }), {
    route: "/agent-runs/run-1/replay"
  });
  assert.equal(parseDesktopShellNavigatePayload("https://evil.test/approvals"), undefined);
  assert.equal(parseDesktopShellNavigatePayload("//evil.test/approvals"), undefined);
  assert.equal(parseDesktopShellNavigatePayload("/../settings"), undefined);
  assert.equal(parseDesktopShellNavigatePayload("/workitems\\evil"), undefined);
});

test("desktop shell bridge parses Rust system-notification plans for Cuu follow-up handling", () => {
  const seenPlans: string[] = [];
  const payload = {
    id: "evt-approval",
    event: eventTypes.permissionAsk,
    title: "Cuu needs your approval",
    body: "Open WorkHub to allow, deny, or remember this rule.",
    urgency: "urgent",
    route: "/approvals?approvalId=approval-1",
    windowControl: {
      label: "main",
      action: "show_and_focus",
      source: "system_notification",
      route: "/approvals?approvalId=approval-1",
      focus: true,
      reason: "focus-main-route"
    },
    streamKind: "me",
    streamPath: "/api/push/stream/me"
  };
  const bridge = createDesktopShellEventBridge({
    onSystemNotification: (plan) => seenPlans.push(plan.route)
  });
  const plan = parseDesktopShellSystemNotificationPlan(payload);
  const bridged = bridge.handleSystemNotificationPayload(payload);

  assert.equal(plan?.urgency, "urgent");
  assert.equal(plan?.windowControl.source, "system_notification");
  assert.equal(bridged?.route, "/approvals?approvalId=approval-1");
  assert.deepEqual(seenPlans, ["/approvals?approvalId=approval-1"]);
  assert.equal(
    parseDesktopShellSystemNotificationPlan({
      ...payload,
      streamKind: undefined,
      stream_kind: "me",
      stream_path: "/api/push/stream/me",
      window_control: payload.windowControl
    })?.streamKind,
    "me"
  );
});

const connectedPayload = { state: "connected", server_url: "http://127.0.0.1:8787", since_ms: 1, attempt: 0 };
const reconnectingPayload = { state: "reconnecting", server_url: "http://127.0.0.1:8787", since_ms: 1, attempt: 1 };

test("primeDesktopConnectionState 先订阅后拉快照：事件已到时过期快照不覆盖（真机 DEFECT-1）", async () => {
  const applied: unknown[] = [];
  let deliver: ((payload: never) => void) | undefined;
  let resolveRead: ((value: unknown) => void) | undefined;
  const done = primeDesktopConnectionState({
    subscribe: (onPayload) => {
      deliver = onPayload as never;
      return Promise.resolve();
    },
    read: () => new Promise((resolve) => { resolveRead = resolve; }),
    apply: (payload) => applied.push(payload)
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(deliver, "订阅必须先于拉快照落地");
  // 运行期事件先到：connected；随后过期的快照才回来：reconnecting。
  deliver!(connectedPayload as never);
  resolveRead!(reconnectingPayload);
  await done;
  assert.deepEqual(applied, [connectedPayload]);
});

test("primeDesktopConnectionState 没有事件时用快照补初值；快照不合法时什么都不写", async () => {
  const applied: unknown[] = [];
  await primeDesktopConnectionState({
    subscribe: () => Promise.resolve(),
    read: () => Promise.resolve(reconnectingPayload),
    apply: (payload) => applied.push(payload)
  });
  assert.deepEqual(applied, [reconnectingPayload]);
  const none: unknown[] = [];
  await primeDesktopConnectionState({
    subscribe: () => Promise.resolve(),
    read: () => Promise.resolve({ state: "什么都不是" }),
    apply: (payload) => none.push(payload)
  });
  assert.deepEqual(none, []);
});

test("primeDesktopConnectionState 订阅失败仍拉快照；拉取失败静默", async () => {
  const applied: unknown[] = [];
  await primeDesktopConnectionState({
    subscribe: () => Promise.reject(new Error("no bridge")),
    read: () => Promise.resolve(connectedPayload),
    apply: (payload) => applied.push(payload)
  });
  assert.deepEqual(applied, [connectedPayload]);
  await assert.doesNotReject(() =>
    primeDesktopConnectionState({
      subscribe: () => undefined,
      read: () => Promise.reject(new Error("invoke failed")),
      apply: () => assert.fail("不该写入")
    })
  );
});
