import assert from "node:assert/strict";
import test from "node:test";

import { eventTypes, type AttentionItem, type EvidenceBubble, type QuestionCard, type WorkHubEvent, type WorkItemDetailVM } from "@workhub/contracts";
import { createCuuController, type CuuCard, type CuuControllerDecision } from "@workhub/cuu";

import {
  bindDesktopShellCuuRuntime,
  createDesktopCuuDemoScript,
  createDesktopShellScriptedListener,
  desktopCuuNoticeCss,
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
  const decisions: CuuControllerDecision[] = [];
  const systemNotificationRoutes: string[] = [];
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
    notify: (notice) => notices.push(notice),
    onDecision: (decision) => decisions.push(decision),
    onSystemNotification: (plan) => systemNotificationRoutes.push(plan.route)
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
  handlers.get("system-notification")?.({
    payload: {
      id: "evt-approval",
      event: eventTypes.permissionAsk,
      title: "Cuu needs your approval",
      body: "Open WorkHub to allow, deny, or remember this rule.",
      urgency: "urgent",
      route: "/approvals?approvalId=approval-runtime",
      windowControl: {
        label: "main",
        action: "show_and_focus",
        source: "system_notification",
        route: "/approvals?approvalId=approval-runtime",
        focus: true,
        reason: "focus-main-route"
      },
      streamKind: "me",
      streamPath: "/api/push/stream/me"
    }
  });

  assert.equal(runtime.subscribed, true);
  assert.equal(notices[0]?.card.state, "asking_approval");
  assert.equal(notices[0]?.message, "Cuu：Cuu 等你审批 <不要执行脚本>");
  assert.match(notices[0]?.html ?? "", /&lt;不要执行脚本&gt;/u);
  assert.match(notices[0]?.html ?? "", /data-method="POST"/u);
  assert.equal(notices.length, 1);
  assert.equal(decisions[0]?.outcome, "show");
  assert.equal(decisions[1]?.outcome, "queue");
  assert.equal(decisions[1]?.card?.state, "offline");
  assert.deepEqual(systemNotificationRoutes, ["/approvals?approvalId=approval-runtime"]);

  await runtime.dispose();
  assert.deepEqual(stopped, ["push-event", "sse-status", "system-notification"]);
});

test("desktop Cuu runtime respects do-not-disturb controller decisions", async () => {
  const handlers = new Map<string, (event: DesktopShellEventEnvelope) => void>();
  const notices: DesktopCuuNotice[] = [];
  const decisions: CuuControllerDecision[] = [];
  const listen: DesktopShellListen = (eventName, handler) => {
    handlers.set(eventName, handler);
    return () => {};
  };
  const attention: AttentionItem = {
    id: "attention-dnd",
    kind: "approval",
    priority: "urgent",
    source_ref: { entity_type: "approval_request", entity_id: "approval-dnd" },
    title: "Cuu 等你审批",
    summary_text: "勿扰时不弹窗，但保留系统级提醒意图。",
    actions: [],
    cuu_state: "asking_approval",
    created_at: "2026-06-05T01:00:00.000Z"
  };

  await bindDesktopShellCuuRuntime({
    listen,
    controller: createCuuController({ preferences: { attention_mode: "do_not_disturb" } }),
    now: () => new Date("2026-06-05T01:00:00.000Z"),
    notify: (notice) => notices.push(notice),
    onDecision: (decision) => decisions.push(decision)
  });
  handlers.get("push-event")?.({
    payload: shellPayload(eventTypes.permissionAsk, {
      summary_text: attention.summary_text,
      attention
    })
  });

  assert.equal(notices.length, 0);
  assert.equal(decisions[0]?.outcome, "badge");
  assert.equal(decisions[0]?.reason, "do_not_disturb_badge");
  assert.equal(decisions[0]?.presentation.os_notification, true);
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
  assert.match(html, /wh-cuu-card-mark/u);
  assert.match(html, /不用打字，点选即可。/u);
  assert.match(html, /data-cuu-action-id="submit"/u);
  assert.doesNotMatch(html, /wh-cuu-sprite|wh-cuu-atlas|wh-cuu-bongo/u);
  assert.match(desktopCuuNoticeCss, /wh-cuu-queue-badge/u);
  assert.doesNotMatch(desktopCuuNoticeCss, /wh-cuu-sprite/u);

  assert.equal(desktopCuuNoticeMessage({
    id: "card-en",
    kind: "offline",
    state: "offline",
    motion: {
      state: "offline",
      sprite_state: "offline_sleep",
      emphasis: "calm",
      loop: true,
      reduced_motion_fallback: "Cuu is offline."
    },
    title: "Disconnected",
    message: "Reconnecting.",
    priority: "normal",
    actions: []
  }, { locale: "en-US" }), "Cuu: Disconnected");
  assert.match(renderDesktopCuuNotice({
    id: "card-en",
    kind: "question",
    state: "asking_approval",
    motion: {
      state: "asking_approval",
      sprite_state: "asking_approval_bounce",
      emphasis: "urgent",
      loop: true,
      reduced_motion_fallback: "Cuu is waiting."
    },
    title: "Pick one",
    message: "No typing needed.",
    priority: "high",
    actions: []
  }, { locale: "en-US" }), /Waiting for you/u);
});

test("desktop Cuu actions submit approval choices through the typed API client", async () => {
  const calls: unknown[] = [];
  const client = {
    async respondApproval(id: string, payload: unknown) {
      calls.push({ id, payload });
    },
    async nextQuestion() {
      throw new Error("not needed");
    },
    async searchKnowledge() {
      throw new Error("not needed");
    },
    async useEvidenceForWorkItem() {
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

  assert.equal(
    (await submitDesktopCuuAction({ client, action: allow!, locale: "en-US" })).message,
    "Cuu got it: this step is approved."
  );
});

test("desktop Cuu actions advance option-first clarification sessions", async () => {
  const calls: unknown[] = [];
  const client = {
    async respondApproval() {
      throw new Error("not needed");
    },
    async nextQuestion(sessionId: string, payload: unknown) {
      calls.push({ sessionId, payload });
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
    },
    async searchKnowledge() {
      throw new Error("not needed");
    },
    async useEvidenceForWorkItem() {
      throw new Error("not needed");
    }
  };
  const card: CuuCard = {
    id: "question-card",
    kind: "question",
    state: "asking_approval",
    motion: {
      state: "asking_approval",
      sprite_state: "asking_approval_bounce",
      emphasis: "urgent",
      loop: true,
      reduced_motion_fallback: "Cuu 等你选择一个澄清选项。"
    },
    title: "选择口径",
    message: "点一个选项即可。",
    priority: "high",
    chips: [
      { id: "risk-first", label: "风险优先", selected: true },
      { id: "progress-first", label: "进展优先" }
    ],
    input: {
      mode: "single_choice",
      option_first: true,
      free_text_enabled: true,
      free_text_collapsed_by_default: true
    },
    actions: [
      {
        id: "submit_option",
        label: "确认选项",
        tone: "primary",
        method: "POST",
        href: "/api/sessions/session-1/next-question"
      }
    ]
  };
  const action = resolveDesktopCuuAction("/api/sessions/session-1/next-question", { actionId: "submit_option", card });

  assert.deepEqual(action, { kind: "session-next-question", sessionId: "session-1", selectedOptionIds: ["risk-first"] });
  assert.equal((await submitDesktopCuuAction({ client, action: action! })).message, "下一题：下一步要谁审批？");
  assert.deepEqual(calls, [{ sessionId: "session-1", payload: { selected_option_ids: ["risk-first"] } }]);
  assert.equal(resolveDesktopCuuAction("/api/proposals/proposal-1/review", { actionId: "approve" }), undefined);
});

test("desktop Cuu actions search project knowledge and return an evidence card", async () => {
  const calls: unknown[] = [];
  const bubble: EvidenceBubble = {
    id: "00000000-0000-4000-8000-000000000302",
    query_text: "客户成功周报模板",
    summary_text: "我找到了会议口径、网盘数据和客户格式偏好。",
    evidence_refs: [
      {
        id: "00000000-0000-4000-8000-000000000201",
        source_type: "meeting",
        source_id: "00000000-0000-4000-8000-000000000101",
        title: "上次周会纪要",
        confidence_hint: "found",
        href: "/knowledge/evidence/meeting-1"
      }
    ],
    actions: [
      { id: "use_for_current_task", label: "用这些证据继续" },
      { id: "open_full_search", label: "打开完整检索", href: "/knowledge/search?run=weekly-report" }
    ]
  };
  const client = {
    async respondApproval() {
      throw new Error("not needed");
    },
    async nextQuestion() {
      throw new Error("not needed");
    },
    async searchKnowledge(payload: unknown) {
      calls.push(payload);
      return bubble;
    },
    async useEvidenceForWorkItem() {
      throw new Error("not needed");
    }
  };
  const action = resolveDesktopCuuAction("/knowledge/search?run=weekly-report&query=客户成功", {
    actionId: "open_full_search"
  });

  assert.deepEqual(action, {
    kind: "knowledge-search",
    query: "客户成功",
    run: "weekly-report"
  });

  const result = await submitDesktopCuuAction({ client, action: action! });
  assert.equal(result.message, "Cuu 找到了一组项目证据。");
  assert.equal(result.card?.kind, "evidence");
  assert.equal(result.card?.state, "searching_evidence");
  assert.equal(result.card?.chips?.[0]?.label, "上次周会纪要");
  assert.deepEqual(calls, [{ query: "客户成功", run: "weekly-report" }]);
});

test("desktop Cuu actions bind evidence refs back to the current work item", async () => {
  const workItemId = "10000000-0000-4000-8000-000000000001";
  const evidenceBubbleId = "00000000-0000-4000-8000-000000000302";
  const evidenceRefs = [
    {
      id: "00000000-0000-4000-8000-000000000201",
      source_type: "meeting" as const,
      source_id: "weekly-sync",
      title: "上次周会纪要",
      confidence_hint: "found" as const
    }
  ];
  const card: CuuCard = {
    id: evidenceBubbleId,
    kind: "evidence",
    state: "searching_evidence",
    motion: {
      state: "searching_evidence",
      sprite_state: "searching_evidence_peek",
      emphasis: "busy",
      loop: true,
      reduced_motion_fallback: "Cuu 正在找证据。"
    },
    title: "找到证据",
    message: "可以继续处理。",
    priority: "normal",
    actions: [
      {
        id: "use_for_current_task",
        label: "用这些证据继续",
        tone: "primary",
        method: "POST",
        href: `/api/workitems/${workItemId}/evidence-bindings`
      }
    ],
    evidence_refs: evidenceRefs,
    payload_ref: {
      entity_type: "evidence",
      entity_id: evidenceBubbleId
    }
  };
  const calls: unknown[] = [];
  const client = {
    async respondApproval() {
      throw new Error("not needed");
    },
    async nextQuestion() {
      throw new Error("not needed");
    },
    async searchKnowledge() {
      throw new Error("not needed");
    },
    async useEvidenceForWorkItem(id: string, payload: unknown) {
      calls.push({ id, payload });
      return {
        workitem: {
          id,
          code: "CSW-1",
          project_id: "10000000-0000-4000-8000-000000000002",
          title: "生成客户周报模板",
          status: "ai_working",
          summary_md: "Cuu 已把证据绑定到当前任务。"
        },
        acceptance: [],
        agent_trace_preview: [],
        evidence_refs: evidenceRefs
      } as unknown as WorkItemDetailVM;
    }
  };

  const action = resolveDesktopCuuAction(`/api/workitems/${workItemId}/evidence-bindings`, {
    actionId: "use_for_current_task",
    card
  });

  assert.deepEqual(action, {
    kind: "use-evidence-for-task",
    workItemId,
    evidenceRefs,
    evidenceBubbleId
  });

  const result = await submitDesktopCuuAction({ client, action: action! });

  assert.equal(result.message, "Cuu 已把这些证据放进当前任务。");
  assert.equal(result.card?.payload_ref?.entity_type, "workitem");
  assert.equal(result.card?.evidence_refs?.[0]?.title, "上次周会纪要");
  assert.deepEqual(calls, [
    {
      id: workItemId,
      payload: {
        evidence_bubble_id: evidenceBubbleId,
        evidence_refs: evidenceRefs,
        note: "Cuu evidence card action: use_for_current_task"
      }
    }
  ]);
});
