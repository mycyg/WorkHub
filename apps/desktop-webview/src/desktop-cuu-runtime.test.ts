import assert from "node:assert/strict";
import test from "node:test";

import { eventTypes, type AttentionItem, type QuestionCard, type WorkHubEvent } from "@workhub/contracts";

import {
  bindDesktopShellCuuRuntime,
  createDesktopCuuDemoScript,
  createDesktopShellScriptedListener,
  desktopCuuNoticeMessage,
  renderDesktopCuuNotice,
  resolveDesktopCuuAction,
  resolveDesktopShellListen,
  submitDesktopCuuAction,
  type DesktopCuuNotice,
  type DesktopShellEventEnvelope,
  type DesktopShellListen
} from "./desktop-cuu-runtime.js";
import type { DesktopShellPushPayload } from "./shell-events.js";

function shellPayload(event: string, data: unknown): DesktopShellPushPayload {
  return {
    event,
    data: JSON.stringify(data),
    stream_kind: "me",
    stream_path: "/api/push/stream/me"
  };
}

function workHubEvent(input: {
  event_id: string;
  type: string;
  topic: string;
  session_id?: string | undefined;
  proposal_id?: string | undefined;
  preview_text?: string | undefined;
  attention?: AttentionItem | undefined;
  data?: unknown;
}): WorkHubEvent<unknown> {
  return {
    event_id: input.event_id,
    type: input.type,
    topic: input.topic,
    ts: "2026-06-05T01:00:00.000Z",
    ...(input.session_id ? { session_id: input.session_id } : {}),
    ...(input.proposal_id ? { proposal_id: input.proposal_id } : {}),
    ...(input.preview_text ? { preview_text: input.preview_text } : {}),
    ...(input.attention ? { attention: input.attention } : {}),
    data: input.data ?? {}
  };
}

test("desktop Cuu runtime listens to Rust push-event and sse-status channels", async () => {
  const handlers = new Map<string, (event: DesktopShellEventEnvelope) => void>();
  const stopped: string[] = [];
  const notices: DesktopCuuNotice[] = [];
  const listen: DesktopShellListen = (eventName, handler) => {
    handlers.set(eventName, handler);
    return () => stopped.push(eventName);
  };
  const attention: AttentionItem = {
    id: "attention-runtime",
    kind: "approval",
    priority: "urgent",
    source_ref: { entity_type: "approval_request", entity_id: "approval-runtime" },
    title: "Cuu 等你审批 <不要执行脚本>",
    summary_text: "点选后继续。",
    reason_text: "这次动作需要你确认。",
    actions: [
      {
        id: "approve",
        label: "同意",
        style: "primary",
        method: "POST",
        href: "/api/approvals/approval-runtime/respond"
      }
    ],
    cuu_state: "asking_approval",
    created_at: "2026-06-05T01:00:00.000Z"
  };

  const runtime = await bindDesktopShellCuuRuntime({
    listen,
    now: () => new Date("2026-06-05T01:00:00.000Z"),
    notify: (notice) => notices.push(notice)
  });
  handlers.get("push-event")?.({
    payload: shellPayload(eventTypes.permissionAsk, {
      summary_text: attention.summary_text,
      attention
    })
  });
  handlers.get("sse-status")?.({
    payload: {
      stream_kind: "global",
      stream_path: "/api/push/stream",
      state: "closed"
    }
  });

  assert.equal(runtime.subscribed, true);
  assert.equal(notices[0]?.card.state, "asking_approval");
  assert.equal(notices[0]?.message, "Cuu：Cuu 等你审批 <不要执行脚本>");
  assert.match(notices[0]?.html ?? "", /&lt;不要执行脚本&gt;/u);
  assert.match(notices[0]?.html ?? "", /data-method="POST"/u);
  assert.equal(notices[1]?.card.state, "offline");

  await runtime.dispose();
  assert.deepEqual(stopped, ["push-event", "sse-status"]);
});

test("desktop Cuu runtime resolves Tauri and mock listeners without subscribing in plain browsers", async () => {
  const listen: DesktopShellListen = () => undefined;

  assert.equal(resolveDesktopShellListen({ __TAURI__: { event: { listen } } }), listen);
  assert.equal(resolveDesktopShellListen({ __YQGL_MOCK_LISTEN__: listen }), listen);
  assert.equal(resolveDesktopShellListen({}), undefined);

  const runtime = await bindDesktopShellCuuRuntime({
    notify() {
      throw new Error("should not notify without a listener");
    },
    listen: undefined
  });

  assert.equal(runtime.subscribed, false);
});

test("desktop Cuu demo script curates Gold Path events into shell push payloads", () => {
  const approvalAttention: AttentionItem = {
    id: "10000000-0000-4000-8000-000000000011",
    kind: "approval",
    priority: "high",
    source_ref: { entity_type: "approval_request", entity_id: "10000000-0000-4000-8000-000000000012" },
    title: "Cuu 等你审批",
    summary_text: "点选后继续。",
    actions: [],
    cuu_state: "asking_approval",
    created_at: "2026-06-05T01:00:00.000Z"
  };
  const events = [
    workHubEvent({
      event_id: "10000000-0000-4000-8000-000000000021",
      type: eventTypes.notificationCreated,
      topic: "user:me"
    }),
    workHubEvent({
      event_id: "10000000-0000-4000-8000-000000000022",
      type: eventTypes.permissionAsk,
      topic: "session:session-1",
      session_id: "session-1",
      preview_text: "先点一个澄清选项。"
    }),
    workHubEvent({
      event_id: "10000000-0000-4000-8000-000000000023",
      type: eventTypes.agentRunStarted,
      topic: "run:run-1",
      preview_text: "Cuu 开始整理。"
    }),
    workHubEvent({
      event_id: "10000000-0000-4000-8000-000000000024",
      type: eventTypes.budgetWarning,
      topic: "user:me",
      preview_text: "预算快到线了。"
    }),
    workHubEvent({
      event_id: "10000000-0000-4000-8000-000000000025",
      type: eventTypes.proposalOpened,
      topic: "workitem:workitem-1",
      proposal_id: "proposal-1",
      preview_text: "变更申请已准备好。"
    }),
    workHubEvent({
      event_id: "10000000-0000-4000-8000-000000000026",
      type: eventTypes.permissionAsk,
      topic: "user:me",
      proposal_id: "proposal-1",
      attention: approvalAttention,
      preview_text: "请审批。"
    }),
    workHubEvent({
      event_id: "10000000-0000-4000-8000-000000000027",
      type: eventTypes.proposalMerged,
      topic: "workitem:workitem-1",
      preview_text: "已采纳。"
    })
  ];

  const script = createDesktopCuuDemoScript({ events }, {
    initialDelayMs: 10,
    intervalMs: 5,
    includeOfflineStatus: true
  });
  const firstPayload = script[0]?.payload as DesktopShellPushPayload;
  const approvalPayload = script[4]?.payload as DesktopShellPushPayload;

  assert.equal(script.length, 7);
  assert.equal(script[0]?.delayMs, 10);
  assert.equal(script[1]?.delayMs, 15);
  assert.equal(firstPayload.event, eventTypes.permissionAsk);
  assert.equal(firstPayload.stream_path, "/api/push/stream/session/session-1");
  assert.equal(JSON.parse(firstPayload.data).preview_text, "先点一个澄清选项。");
  assert.equal(approvalPayload.stream_path, "/api/push/stream/me");
  assert.equal(script.at(-1)?.eventName, "sse-status");
});

test("scripted desktop shell listener dispatches scheduled push and status events", () => {
  type Timer = ReturnType<typeof globalThis.setTimeout>;
  const scheduled: { handler: () => void; timeout: number; id: Timer }[] = [];
  const cleared: Timer[] = [];
  const listener = createDesktopShellScriptedListener(
    [
      {
        eventName: "push-event",
        delayMs: 25,
        payload: { event: "permission.ask" }
      },
      {
        eventName: "sse-status",
        delayMs: 50,
        payload: { state: "retrying" }
      }
    ],
    {
      setTimeout(handler, timeout) {
        const id = scheduled.length as unknown as Timer;
        scheduled.push({ handler, timeout, id });
        return id;
      },
      clearTimeout(id) {
        cleared.push(id);
      }
    }
  );
  const seen: unknown[] = [];
  const status: unknown[] = [];

  listener.listen("push-event", (event) => seen.push(event.payload));
  listener.listen("sse-status", (event) => status.push(event.payload));
  listener.start();
  listener.start();

  assert.deepEqual(scheduled.map((item) => item.timeout), [25, 50]);
  scheduled[0]?.handler();
  scheduled[1]?.handler();
  assert.deepEqual(seen, [{ event: "permission.ask" }]);
  assert.deepEqual(status, [{ state: "retrying" }]);
  assert.equal(listener.dispatched(), 2);

  listener.stop();
  assert.deepEqual(cleared, [scheduled[0]?.id, scheduled[1]?.id]);
});

test("desktop Cuu notice renders compact option-first actions", () => {
  const html = renderDesktopCuuNotice({
    id: "card-1",
    kind: "question",
    state: "asking_approval",
    motion: {
      state: "asking_approval",
      sprite_state: "asking_approval_bounce",
      emphasis: "urgent",
      loop: true,
      reduced_motion_fallback: "Cuu 在等你点选。"
    },
    title: "选一个方向",
    message: "不用打字，点选即可。",
    priority: "high",
    chips: [{ id: "brief", label: "简洁版", recommended: true }],
    actions: [
      {
        id: "submit",
        label: "确认",
        tone: "primary",
        method: "POST",
        href: "/api/sessions/session-1/answer"
      }
    ]
  });

  assert.equal(desktopCuuNoticeMessage({
    id: "card-1",
    kind: "offline",
    state: "offline",
    motion: {
      state: "offline",
      sprite_state: "offline_sleep",
      emphasis: "calm",
      loop: true,
      reduced_motion_fallback: "Cuu 离线休息中。"
    },
    title: "连接断开",
    message: "正在重连。",
    priority: "normal",
    actions: []
  }), "Cuu：连接断开");
  assert.match(html, /data-cuu-state="asking_approval"/u);
  assert.match(html, /不用打字，点选即可。/u);
  assert.match(html, /data-cuu-action-id="submit"/u);
});

test("desktop Cuu actions submit approval choices through the typed API client", async () => {
  const calls: unknown[] = [];
  const client = {
    async respondApproval(id: string, payload: unknown) {
      calls.push({ id, payload });
    },
    async nextQuestion() {
      throw new Error("not needed");
    }
  };
  const allow = resolveDesktopCuuAction("/api/approvals/approval-1/respond", { actionId: "approve" });
  const deny = resolveDesktopCuuAction("/api/approvals/approval-1/respond", {
    actionId: "deny",
    requiresReason: true
  });

  assert.deepEqual(allow, {
    kind: "approval-response",
    approvalId: "approval-1",
    decision: "allow",
    requiresReason: false
  });
  assert.equal(deny?.kind, "approval-response");
  assert.equal(deny && "decision" in deny ? deny.decision : undefined, "deny");

  assert.equal((await submitDesktopCuuAction({ client, action: allow! })).message, "Cuu 已收到：这步已批准。");
  await assert.rejects(() => submitDesktopCuuAction({ client, action: deny! }), /打回需要先选择一个原因/u);
  assert.equal(
    (await submitDesktopCuuAction({ client, action: deny!, reasonMd: "证据不足" })).message,
    "Cuu 已带着原因打回，会继续改。"
  );
  assert.deepEqual(calls, [
    { id: "approval-1", payload: { decision: "allow", remember: "once" } },
    { id: "approval-1", payload: { decision: "deny", reason_md: "证据不足", remember: "once" } }
  ]);
});

test("desktop Cuu actions advance option-first clarification sessions", async () => {
  const calls: string[] = [];
  const client = {
    async respondApproval() {
      throw new Error("not needed");
    },
    async nextQuestion(sessionId: string) {
      calls.push(sessionId);
      const question: QuestionCard = {
        id: "question-next",
        title: "下一步要谁审批？",
        input_mode: "single_choice",
        options: [],
        free_text: { enabled: true, collapsed_by_default: true },
        progress: [],
        submit: { method: "POST", href: `/api/sessions/${sessionId}/next-question` }
      };
      return question;
    }
  };
  const action = resolveDesktopCuuAction("/api/sessions/session-1/next-question", { actionId: "submit_option" });

  assert.deepEqual(action, { kind: "session-next-question", sessionId: "session-1" });
  assert.equal((await submitDesktopCuuAction({ client, action: action! })).message, "下一题：下一步要谁审批？");
  assert.deepEqual(calls, ["session-1"]);
  assert.equal(resolveDesktopCuuAction("/api/proposals/proposal-1/review", { actionId: "approve" }), undefined);
});
