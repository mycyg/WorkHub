import assert from "node:assert/strict";
import test from "node:test";

import { WorkHubApiError } from "@workhub/api-client";
import { eventTypes, type AgentRunLiveVM, type AttentionItem, type EvidenceBubble, type SessionVM, type WorkHubEvent, type WorkItemDetailVM } from "@workhub/contracts";
import { createCuuController, type CuuCard, type CuuControllerDecision } from "@workhub/cuu";
import { formatSseEvent } from "@workhub/events";

import {
  bindDesktopShellCuuRuntime,
  cardFromDesktopCuuRuntimeError,
  createDesktopCuuAnalysisCard,
  createDesktopCuuAgentLauncherCard,
  createDesktopCuuDemoScript,
  createDesktopShellScriptedListener,
  desktopCuuProjectContextFromRoute,
  desktopCuuProjectContextMaxAgeMs,
  desktopCuuProjectContextStorageKey,
  desktopCuuNoticeCss,
  desktopCuuNoticeMessage,
  loadDesktopCuuProjectContext,
  renderDesktopCuuNotice,
  resolveDesktopCuuAction,
  resolveDesktopShellEmitter,
  resolveDesktopShellListen,
  saveDesktopCuuProjectContextFromRoute,
  startDesktopCuuAgentFromLauncher,
  subscribeDesktopCuuAgentRunStream,
  submitDesktopCuuAction,
  type DesktopCuuNotice,
  type DesktopCuuRunStreamStatus,
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

test("desktop Cuu project context follows current project and drive routes", () => {
  const projectId = "10000000-0000-4000-8000-000000000002";
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    }
  };

  assert.equal(desktopCuuProjectContextFromRoute(`/projects/${projectId}`, 1_000)?.project_id, projectId);
  assert.equal(saveDesktopCuuProjectContextFromRoute(`/drive?project_id=${projectId}`, storage, 1_000)?.project_id, projectId);
  assert.equal(loadDesktopCuuProjectContext(storage, 1_500)?.project_id, projectId);
  assert.equal(loadDesktopCuuProjectContext(storage, 1_000 + desktopCuuProjectContextMaxAgeMs + 1), undefined);
  assert.equal(saveDesktopCuuProjectContextFromRoute("/settings", storage, 2_000), undefined);
  assert.ok(values.has(desktopCuuProjectContextStorageKey));
});

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

function agentRunLive(input: Partial<AgentRunLiveVM> & { run_id?: string; status?: AgentRunLiveVM["status"] } = {}): AgentRunLiveVM {
  const runId = input.run_id ?? "10000000-0000-4000-8000-000000000301";
  const workItemId = input.work_item_id ?? "10000000-0000-4000-8000-000000000201";
  const status = input.status ?? "queued";
  return {
    run_id: runId,
    work_item_id: workItemId,
    title: input.title ?? "Cuu 桌面入口任务",
    status,
    budget: {
      max_steps: 15,
      total_timeout_s: 300,
      max_tokens: 120000,
      max_cost_cny: "5.00"
    },
    budget_decision: {
      decision_id: "budget-1",
      allowed: true,
      model_route: {
        provider: "deepseek",
        model: "deepseek-v4-flash",
        reason: "desktop launcher smoke"
      }
    },
    usage: {
      steps_used: status === "queued" ? 0 : 1,
      token_in: status === "queued" ? 0 : 120,
      token_out: status === "queued" ? 0 : 80,
      estimated_cost_cny: status === "queued" ? "0.00" : "0.01"
    },
    trace: input.trace ?? [],
    stream_href: `/api/push/stream/run/${runId}`,
    replay_href: `/api/agent-runs/${runId}/replay`,
    ...input,
    run: {
      id: runId,
      work_item_id: workItemId,
      mode: "worker",
      actor: "AI",
      status,
      model: "deepseek-v4-flash",
      turns_used: status === "queued" ? 0 : 1,
      max_turns: 15,
      token_in: status === "queued" ? 0 : 120,
      token_out: status === "queued" ? 0 : 80,
      created_at: "2026-06-10T01:00:00.000Z",
      updated_at: "2026-06-10T01:00:00.000Z",
      ...(input.run ?? {})
    }
  };
}

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, Array<(event: { data?: string }) => void>>();
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(eventName: string, handler: (event: { data?: string }) => void) {
    const bucket = this.listeners.get(eventName) ?? [];
    bucket.push(handler);
    this.listeners.set(eventName, bucket);
  }

  emit(eventName: string, data?: unknown) {
    for (const handler of this.listeners.get(eventName) ?? []) {
      if (data === undefined) {
        handler({});
      } else {
        handler({ data: typeof data === "string" ? data : JSON.stringify(data) });
      }
    }
  }

  close() {
    this.closed = true;
  }
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

test("desktop Cuu runtime forwards a live locale getter to shell-pushed cards", async () => {
  const handlers = new Map<string, (event: DesktopShellEventEnvelope) => void>();
  const decisions: CuuControllerDecision[] = [];
  const listen: DesktopShellListen = (eventName, handler) => {
    handlers.set(eventName, handler);
    return () => {};
  };

  let liveLocale: "zh-CN" | "en-US" = "zh-CN";
  await bindDesktopShellCuuRuntime({
    listen,
    now: () => new Date("2026-06-05T01:00:00.000Z"),
    notify: () => {},
    onDecision: (decision) => decisions.push(decision),
    // Mirrors pet-surface.ts threading a live locale getter so the bridge
    // resolves the *current* locale at card-build time, not boot time.
    get locale() {
      return liveLocale;
    }
  });

  // First SSE-closed card (distinct id per state) renders in the boot locale.
  handlers.get("sse-status")?.({
    payload: { stream_kind: "global", stream_path: "/api/push/stream", state: "closed" }
  });
  assert.equal(decisions[0]?.card?.title, "WorkHub 连接断开了");

  // User switches language; a newly arriving SSE-retrying card must localize live.
  liveLocale = "en-US";
  handlers.get("sse-status")?.({
    payload: { stream_kind: "global", stream_path: "/api/push/stream", state: "retrying" }
  });
  assert.equal(decisions[1]?.card?.title, "Connection is unstable");
});

test("desktop Cuu runtime clears the offline status card when the SSE stream reopens", async () => {
  const handlers = new Map<string, (event: DesktopShellEventEnvelope) => void>();
  const controller = createCuuController();
  const decisions: CuuControllerDecision[] = [];
  const listen: DesktopShellListen = (eventName, handler) => {
    handlers.set(eventName, handler);
    return () => {};
  };

  const runtime = await bindDesktopShellCuuRuntime({
    listen,
    controller,
    notify: () => {},
    onDecision: (decision) => decisions.push(decision)
  });

  handlers.get("sse-status")?.({
    payload: { stream_kind: "global", stream_path: "/api/push/stream", state: "retrying" }
  });
  assert.equal(controller.snapshot().active_card?.id, "sse-status:global:retrying");

  handlers.get("sse-status")?.({
    payload: { stream_kind: "global", stream_path: "/api/push/stream", state: "open" }
  });

  assert.equal(controller.snapshot().active_card, undefined);
  assert.equal(decisions.at(-1)?.outcome, "idle");
  assert.equal(decisions.at(-1)?.reason, "dismissed_current");

  await runtime.dispose();
});

test("desktop Cuu runtime suppresses transient retrying status when the stream quickly reopens", async () => {
  const handlers = new Map<string, (event: DesktopShellEventEnvelope) => void>();
  const controller = createCuuController();
  const decisions: CuuControllerDecision[] = [];
  const listen: DesktopShellListen = (eventName, handler) => {
    handlers.set(eventName, handler);
    return () => {};
  };

  const runtime = await bindDesktopShellCuuRuntime({
    listen,
    controller,
    notify: () => {},
    onDecision: (decision) => decisions.push(decision),
    retryingDelayMs: 25
  });

  handlers.get("sse-status")?.({
    payload: { stream_kind: "global", stream_path: "/api/push/stream", state: "retrying" }
  });
  assert.equal(controller.snapshot().active_card, undefined);

  handlers.get("sse-status")?.({
    payload: { stream_kind: "global", stream_path: "/api/push/stream", state: "open" }
  });
  await new Promise((resolve) => setTimeout(resolve, 35));

  assert.equal(controller.snapshot().active_card, undefined);
  assert.equal(decisions.find((decision) => decision.card?.id === "sse-status:global:retrying"), undefined);

  await runtime.dispose();
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
  const emit = () => undefined;
  const emitTo = () => undefined;

  assert.equal(resolveDesktopShellListen({ __TAURI__: { event: { listen } } }), listen);
  assert.equal(resolveDesktopShellListen({ __YQGL_MOCK_LISTEN__: listen }), listen);
  assert.equal(resolveDesktopShellListen({}), undefined);
  assert.deepEqual(resolveDesktopShellEmitter({ __TAURI__: { event: { emit, emitTo } } }), { emit, emitTo });
  assert.deepEqual(resolveDesktopShellEmitter({ __YQGL_MOCK_EMIT__: emit, __YQGL_MOCK_EMIT_TO__: emitTo }), { emit, emitTo });
  assert.equal(resolveDesktopShellEmitter({}), undefined);

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
  assert.doesNotMatch(html, /wh-cuu-sprite|wh-cuu-atlas|wh-cuu-legacy/u);
  assert.match(desktopCuuNoticeCss, /wh-cuu-queue-badge/u);
  assert.match(desktopCuuNoticeCss, /\.wh-cuu-card\{[^}]*min-width:0;max-width:100%;[^}]*overflow:hidden;overflow-wrap:anywhere;word-break:break-word/u);
  assert.match(desktopCuuNoticeCss, /\.wh-cuu-card-copy\{[^}]*min-width:0;max-width:100%;width:100%;overflow:hidden/u);
  assert.match(desktopCuuNoticeCss, /\.wh-cuu-card-head\{[^}]*min-width:0;max-width:100%;[^}]*flex-wrap:wrap/u);
  assert.match(desktopCuuNoticeCss, /\.wh-cuu-card-title\{[^}]*max-width:100%;width:100%;[^}]*white-space:normal;overflow-wrap:anywhere;word-break:break-word/u);
  assert.match(desktopCuuNoticeCss, /\.wh-cuu-card-message\{[^}]*max-width:100%;width:100%;[^}]*white-space:normal;overflow-wrap:anywhere;word-break:break-word/u);
  assert.match(desktopCuuNoticeCss, /\.wh-cuu-chip\{[^}]*max-width:100%;[^}]*white-space:normal;overflow-wrap:anywhere;word-break:break-word/u);
  assert.match(desktopCuuNoticeCss, /\.wh-cuu-action\{[^}]*max-width:100%;[^}]*white-space:normal;overflow-wrap:anywhere;word-break:break-word/u);
  assert.match(desktopCuuNoticeCss, /\.wh-cuu-queue-badge\{[^}]*max-width:calc\(100vw - 36px\);min-width:0/u);
  assert.doesNotMatch(desktopCuuNoticeCss, /wh-cuu-sprite/u);

  const longNoticeHtml = renderDesktopCuuNotice({
    id: "card-long",
    kind: "bubble",
    state: "worried",
    motion: {
      state: "worried",
      sprite_state: "worried_ears",
      emphasis: "urgent",
      loop: true,
      reduced_motion_fallback: "Cuu needs attention."
    },
    title: `Provider failure ${"LongDiagnosticTokenWithoutNaturalBreaks".repeat(8)}`,
    message: `Open the replay for details ${"LongProviderPayloadWithoutSpaces".repeat(8)}`,
    priority: "high",
    chips: [{ id: "provider_failed", label: `Provider ${"LongCodeWithoutBreaks".repeat(5)}` }],
    actions: [{
      id: "view_replay",
      label: `View replay ${"LongActionLabelWithoutBreaks".repeat(5)}`,
      tone: "secondary",
      href: "/agent-runs/run-1/replay"
    }]
  }, { locale: "en-US" });
  assert.match(longNoticeHtml, /LongDiagnosticTokenWithoutNaturalBreaks/u);
  assert.match(longNoticeHtml, /LongProviderPayloadWithoutSpaces/u);

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
    },
    async mergeProposal() {
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

test("desktop Cuu actions submit proposal review choices instead of navigating to API URLs", async () => {
  const calls: unknown[] = [];
  const client = {
    async respondApproval() {
      throw new Error("not needed");
    },
    async reviewProposal(id: string, payload: unknown) {
      calls.push({ id, payload });
      return { attention: { summary_text: "已记录你的审阅意见。" } };
    },
    async nextQuestion() {
      throw new Error("not needed");
    },
    async searchKnowledge() {
      throw new Error("not needed");
    },
    async useEvidenceForWorkItem() {
      throw new Error("not needed");
    },
    async mergeProposal() {
      throw new Error("not needed");
    }
  };
  const approve = resolveDesktopCuuAction("/api/proposals/proposal-1/review", { actionId: "approve" });
  const requestChanges = resolveDesktopCuuAction("/api/proposals/proposal-1/review", {
    actionId: "request_changes",
    requiresReason: true
  });

  assert.deepEqual(approve, {
    kind: "proposal-review",
    proposalId: "proposal-1",
    decision: "approve",
    requiresReason: false
  });
  assert.equal(requestChanges?.kind, "proposal-review");
  assert.equal(requestChanges && "decision" in requestChanges ? requestChanges.decision : undefined, "request_changes");

  assert.equal((await submitDesktopCuuAction({ client, action: approve! })).message, "已记录你的审阅意见。");
  await assert.rejects(() => submitDesktopCuuAction({ client, action: requestChanges! }), /打回需要先选择一个原因/u);
  assert.equal(
    (await submitDesktopCuuAction({ client, action: requestChanges!, reasonMd: "需要补验收标准" })).message,
    "已记录你的审阅意见。"
  );
  assert.deepEqual(calls, [
    { id: "proposal-1", payload: { decision: "approve", remember: "once" } },
    { id: "proposal-1", payload: { decision: "request_changes", reason_md: "需要补验收标准", remember: "once" } }
  ]);
});

test("desktop Cuu actions start a real agent run from a free-text launcher card", async () => {
  const calls: unknown[] = [];
  const launcher = createDesktopCuuAgentLauncherCard();
  const demand = "请根据项目网盘 workhub-app-upload.txt 生成三条验收要点。";
  const run: AgentRunLiveVM = {
    run_id: "10000000-0000-4000-8000-000000000301",
    work_item_id: "10000000-0000-4000-8000-000000000201",
    title: "Cuu 桌面入口任务",
    status: "queued",
    run: {
      id: "10000000-0000-4000-8000-000000000301",
      work_item_id: "10000000-0000-4000-8000-000000000201",
      mode: "worker",
      actor: "AI",
      status: "queued",
      model: "deepseek-v4-flash",
      turns_used: 0,
      max_turns: 15,
      token_in: 0,
      token_out: 0,
      created_at: "2026-06-10T01:00:00.000Z",
      updated_at: "2026-06-10T01:00:00.000Z"
    },
    budget: {
      max_steps: 15,
      total_timeout_s: 300,
      max_tokens: 120000,
      max_cost_cny: "5.00"
    },
    budget_decision: {
      decision_id: "budget-1",
      allowed: true,
      model_route: {
        provider: "deepseek",
        model: "deepseek-v4-flash",
        reason: "desktop launcher smoke"
      }
    },
    usage: {
      steps_used: 0,
      token_in: 0,
      token_out: 0,
      estimated_cost_cny: "0.00"
    },
    trace: [],
    stream_href: "/api/push/stream/run/10000000-0000-4000-8000-000000000301",
    replay_href: "/api/agent-runs/10000000-0000-4000-8000-000000000301/replay"
  };
  const client = {
    async createSession(payload: unknown): Promise<SessionVM> {
      calls.push({ step: "createSession", payload });
      return {
        session_id: "10000000-0000-4000-8000-000000000201",
        work_item_id: "10000000-0000-4000-8000-000000000201",
        topic: "session:10000000-0000-4000-8000-000000000201",
        stream_href: "/api/push/stream/session/10000000-0000-4000-8000-000000000201",
        next_question_href: "/api/sessions/10000000-0000-4000-8000-000000000201/next-question",
        question: {
          id: "10000000-0000-4000-8000-000000000211",
          title: "这件事先按哪种交付方式处理？",
          input_mode: "single_choice",
          options: [],
          free_text: { enabled: false, collapsed_by_default: true },
          progress: [],
          submit: {
            method: "POST",
            href: "/api/sessions/10000000-0000-4000-8000-000000000201/next-question"
          }
        }
      };
    },
    async createWorkItem(payload: unknown) {
      calls.push({ step: "createWorkItem", payload });
      return {
        workitem: {
          id: "10000000-0000-4000-8000-000000000201",
          code: "WH-201",
          project_id: "10000000-0000-4000-8000-000000000002",
          title: "Cuu 桌面入口任务",
          status: "ai_working"
        },
        acceptance: [],
        agent_trace_preview: [],
        evidence_refs: []
      } as unknown as WorkItemDetailVM;
    },
    async startAgentRun(workItemId: string, payload: unknown) {
      calls.push({ step: "startAgentRun", workItemId, payload });
      return run;
    },
    async respondApproval() {
      throw new Error("not needed");
    },
    async nextQuestion() {
      throw new Error("not needed");
    },
    async searchKnowledge() {
      throw new Error("not needed");
    },
    async useEvidenceForWorkItem() {
      throw new Error("not needed");
    },
    async mergeProposal() {
      throw new Error("not needed");
    }
  };

  const action = resolveDesktopCuuAction("/api/cuu/start-agent", {
    actionId: "start_agent_from_cuu",
    card: launcher,
    freeText: demand
  });
  const result = await submitDesktopCuuAction({ client, action: action! });

  assert.equal(action?.kind, "cuu-start-agent");
  assert.equal(action && "selectedOptionIds" in action ? action.selectedOptionIds : undefined, undefined);
  assert.equal(action && action.kind === "cuu-start-agent" ? action.cuuLauncherSpec : undefined, undefined);
  assert.equal(action && "intentText" in action ? action.intentText : "", demand);
  assert.equal(result.message, "Cuu 已启动：Cuu 桌面入口任务");
  assert.equal(result.card?.payload_ref?.entity_type, "agent_run");
  assert.equal(result.card?.state, "thinking");
  assert.equal(result.agentRun?.run_id, run.run_id);
  assert.deepEqual(calls, [
    {
      step: "createSession",
      payload: {
        title: demand,
        intent_text: demand
      }
    },
    {
      step: "createWorkItem",
      payload: {
        session_id: "10000000-0000-4000-8000-000000000201",
        title: demand,
        raw_description: demand,
        free_text: demand,
        kickoff_agent: true
      }
    },
    {
      step: "startAgentRun",
      workItemId: "10000000-0000-4000-8000-000000000201",
      payload: {
        title: demand
      }
    }
  ]);
});

test("desktop Cuu launcher captures a free-text demand before AI clarification", () => {
  const launcher = createDesktopCuuAgentLauncherCard({ locale: "zh-CN" });

  assert.equal(launcher.chips?.length ?? 0, 0);
  assert.equal(launcher.input?.mode, "long_text");
  assert.equal(launcher.input?.option_first, false);
  assert.equal(launcher.input?.free_text_enabled, true);
  assert.match(launcher.input?.free_text_placeholder ?? "", /需求/u);

  const action = resolveDesktopCuuAction("/api/cuu/start-agent", {
    actionId: "start_agent_from_cuu",
    card: launcher,
    freeText: "请根据项目网盘 workhub-app-upload.txt 生成三条验收要点。"
  });

  assert.equal(action?.kind, "cuu-start-agent");
  assert.equal(action && action.kind === "cuu-start-agent" ? action.intentText : "", "请根据项目网盘 workhub-app-upload.txt 生成三条验收要点。");
  assert.equal(action && action.kind === "cuu-start-agent" ? action.title : "", "请根据项目网盘 workhub-app-upload.txt 生成三条验收要点。");
  assert.equal(action && action.kind === "cuu-start-agent" ? action.selectedOptionIds : undefined, undefined);
  assert.equal(action && action.kind === "cuu-start-agent" ? action.cuuLauncherSpec : undefined, undefined);
});

test("desktop Cuu launcher keeps the current project context for AI material analysis", () => {
  const projectId = "10000000-0000-4000-8000-000000000002";
  const launcher = createDesktopCuuAgentLauncherCard({ locale: "zh-CN", projectId });

  const action = resolveDesktopCuuAction("/api/cuu/start-agent", {
    actionId: "start_agent_from_cuu",
    card: launcher,
    freeText: "请根据项目网盘 workhub-app-upload.txt 生成三条验收要点。"
  });

  assert.equal(action?.kind, "cuu-start-agent");
  assert.equal(action && action.kind === "cuu-start-agent" ? action.projectId : undefined, projectId);
});

test("desktop Cuu launcher shows an analysis card while the AI reads materials", () => {
  const launcher = createDesktopCuuAgentLauncherCard({ locale: "zh-CN" });
  const action = resolveDesktopCuuAction("/api/cuu/start-agent", {
    actionId: "start_agent_from_cuu",
    card: launcher,
    freeText: "请根据项目网盘 workhub-app-upload.txt 生成三条验收要点。"
  });

  assert.equal(action?.kind, "cuu-start-agent");
  if (!action || action.kind !== "cuu-start-agent") {
    throw new Error("expected Cuu start action");
  }
  const card = createDesktopCuuAnalysisCard(action, { locale: "zh-CN" });

  assert.equal(card.kind, "trace");
  assert.equal(card.state, "thinking");
  assert.match(card.title, /正在分析材料/u);
  assert.match(card.message, /只展示反问结果/u);
  assert.deepEqual(card.actions, []);
  assert.match(card.sections?.[0]?.lines.join("\n") ?? "", /读取项目网盘|调用澄清模型/u);
  assert.match(card.sections?.[1]?.lines.join("\n") ?? "", /只显示工具调用和当前状态/u);
  assert.doesNotMatch(card.sections?.[1]?.lines.join("\n") ?? "", /隐藏思考|隐藏推理/u);
});

test("desktop Cuu launcher helper returns session, work item, run, and Cuu card", async () => {
  const calls: string[] = [];
  const launcher = createDesktopCuuAgentLauncherCard({ locale: "en-US" });
  const demand = "Use project drive files to produce a structured acceptance checklist.";
  const action = resolveDesktopCuuAction("/api/cuu/start-agent", {
    actionId: "start_agent_from_cuu",
    card: launcher,
    freeText: demand
  });
  const run = agentRunLive({ title: "Cuu structured task", status: "running" });
  const client = {
    async createSession(): Promise<SessionVM> {
      calls.push("session");
      return {
        session_id: "10000000-0000-4000-8000-000000000201",
        topic: "session:10000000-0000-4000-8000-000000000201",
        stream_href: "/api/push/stream/session/10000000-0000-4000-8000-000000000201",
        next_question_href: "/api/sessions/10000000-0000-4000-8000-000000000201/next-question",
        question: {
          id: "10000000-0000-4000-8000-000000000211",
          title: "Pick a direction",
          input_mode: "single_choice",
          options: [],
          free_text: { enabled: false, collapsed_by_default: true },
          progress: [],
          submit: { method: "POST", href: "/api/sessions/10000000-0000-4000-8000-000000000201/next-question" }
        }
      };
    },
    async createWorkItem(): Promise<WorkItemDetailVM> {
      calls.push("workitem");
      return {
        workitem: {
          id: run.work_item_id,
          code: "WH-201",
          project_id: "10000000-0000-4000-8000-000000000002",
          title: "Cuu structured task",
          status: "ai_working"
        },
        acceptance: [],
        agent_trace_preview: [],
        evidence_refs: []
      } as unknown as WorkItemDetailVM;
    },
    async startAgentRun(): Promise<AgentRunLiveVM> {
      calls.push("run");
      return run;
    }
  };

  assert.equal(action?.kind, "cuu-start-agent");
  if (!action || action.kind !== "cuu-start-agent") {
    throw new Error("expected Cuu start action");
  }
  assert.equal(action.intentText, demand);
  assert.equal(action.cuuLauncherSpec, undefined);
  const result = await startDesktopCuuAgentFromLauncher({ client, action, locale: "en-US" });

  assert.deepEqual(calls, ["session", "workitem", "run"]);
  assert.equal(result.outcome, "started");
  assert.equal(result.session.session_id, "10000000-0000-4000-8000-000000000201");
  assert.equal(result.workItem.workitem.id, run.work_item_id);
  assert.equal(result.run.run_id, run.run_id);
  assert.equal(result.card.payload_ref?.entity_type, "agent_run");
  assert.equal(result.message, "Cuu started: Cuu structured task");
});

test("desktop Cuu launcher stops at backend clarification instead of bypassing the question", async () => {
  const calls: string[] = [];
  const launcher = createDesktopCuuAgentLauncherCard({ locale: "en-US" });
  const demand = "Draft acceptance points from the project drive upload.";
  const action = resolveDesktopCuuAction("/api/cuu/start-agent", {
    actionId: "start_agent_from_cuu",
    card: launcher,
    freeText: demand
  });
  const session: SessionVM = {
    session_id: "10000000-0000-4000-8000-000000000201",
    work_item_id: "10000000-0000-4000-8000-000000000201",
    topic: "session:10000000-0000-4000-8000-000000000201",
    stream_href: "/api/push/stream/session/10000000-0000-4000-8000-000000000201",
    next_question_href: "/api/sessions/10000000-0000-4000-8000-000000000201/next-question",
    question: {
      id: "10000000-0000-4000-8000-000000000211",
      session_id: "10000000-0000-4000-8000-000000000201",
      work_item_id: "10000000-0000-4000-8000-000000000201",
      title: "Which project file and acceptance standard should Cuu use?",
      body: "AI generated this follow-up from the user request and project files.",
      input_mode: "long_text",
      options: [],
      free_text: { enabled: true, collapsed_by_default: false, placeholder: "Name the file and acceptance standard.", max_length: 300 },
      progress: [
        { key: "intent", label: "Intent", state: "done" },
        { key: "scope", label: "Scope", state: "active" },
        { key: "run", label: "Run", state: "pending" }
      ],
      submit: {
        method: "POST",
        href: "/api/sessions/10000000-0000-4000-8000-000000000201/next-question"
      }
    }
  };
  const client = {
    async createSession(): Promise<SessionVM> {
      calls.push("session");
      return session;
    },
    async createWorkItem(): Promise<WorkItemDetailVM> {
      calls.push("workitem");
      throw new Error("createWorkItem should wait for clarification");
    },
    async startAgentRun(): Promise<AgentRunLiveVM> {
      calls.push("run");
      throw new Error("startAgentRun should wait for clarification");
    }
  };

  assert.equal(action?.kind, "cuu-start-agent");
  if (!action || action.kind !== "cuu-start-agent") {
    throw new Error("expected Cuu start action");
  }
  const result = await startDesktopCuuAgentFromLauncher({ client, action, locale: "en-US" });

  assert.deepEqual(calls, ["session"]);
  assert.equal(result.outcome, "clarification");
  assert.equal(result.session.session_id, session.session_id);
  assert.equal(result.card.kind, "question");
  assert.equal(result.card.payload_ref?.entity_type, "session");
  assert.equal(result.card.input?.option_first, false);
  assert.equal(result.card.input?.free_text_collapsed_by_default, false);
  assert.equal(result.card.actions[0]?.href, session.next_question_href);
  assert.equal(result.message, "Cuu needs one more detail: Which project file and acceptance standard should Cuu use?");

  const submitClient = {
    ...client,
    async respondApproval() {
      throw new Error("not needed");
    },
    async nextQuestion() {
      throw new Error("not needed");
    },
    async searchKnowledge() {
      throw new Error("not needed");
    },
    async useEvidenceForWorkItem() {
      throw new Error("not needed");
    },
    async mergeProposal() {
      throw new Error("not needed");
    }
  };
  const submitted = await submitDesktopCuuAction({ client: submitClient, action, locale: "en-US" });

  assert.equal(submitted.card?.payload_ref?.entity_type, "session");
  assert.equal(submitted.agentRun, undefined);
});

test("desktop Cuu run stream refreshes agent cards and closes on terminal status", async () => {
  FakeEventSource.instances = [];
  const statuses: DesktopCuuRunStreamStatus[] = [];
  const cards: CuuCard[] = [];
  const refreshes = [
    agentRunLive({
      status: "running",
      trace: [
        {
          id: "10000000-0000-4000-8000-000000000401",
          agent_run_id: "10000000-0000-4000-8000-000000000301",
          step_no: 1,
          phase: "think",
          input_json: {},
          output_excerpt: "Cuu 正在整理证据。",
          created_at: "2026-06-10T01:00:01.000Z"
        }
      ]
    }),
    agentRunLive({ status: "succeeded", title: "Cuu 桌面入口任务" })
  ];
  let refreshedResolve: (() => void) | undefined;
  const refreshed = new Promise<void>((resolve) => {
    refreshedResolve = resolve;
  });
  let closedResolve: (() => void) | undefined;
  const closed = new Promise<void>((resolve) => {
    closedResolve = resolve;
  });
  const client = {
    streamUrl(path: string) {
      return `/daemon${path}`;
    },
    async getAgentRun() {
      return refreshes.shift() ?? agentRunLive({ status: "succeeded" });
    }
  };
  const subscription = subscribeDesktopCuuAgentRunStream({
    client,
    run: agentRunLive(),
    EventSourceCtor: FakeEventSource,
    onCard(card) {
      cards.push(card);
    },
    onStatus(status) {
      statuses.push(status);
      if (status.state === "refreshed") {
        refreshedResolve?.();
      }
      if (status.state === "closed") {
        closedResolve?.();
      }
    }
  });

  assert.equal(subscription.streamUrl, "/daemon/api/push/stream/run/10000000-0000-4000-8000-000000000301");
  const source = FakeEventSource.instances[0]!;
  source.emit(eventTypes.agentRunStep, workHubEvent({
    event_id: "10000000-0000-4000-8000-000000000501",
    type: eventTypes.agentRunStep,
    topic: "run:10000000-0000-4000-8000-000000000301",
    data: { run_id: "10000000-0000-4000-8000-000000000301" }
  }));
  await refreshed;
  assert.equal(cards[0]?.state, "thinking");
  assert.match(cards[0]?.message ?? "", /AI 正在整理材料/u);
  assert.doesNotMatch(cards[0]?.message ?? "", /整理证据/u);
  assert.deepEqual(cards[0]?.sections?.[0]?.lines, ["#1 AI 正在整理材料"]);

  source.emit(eventTypes.agentRunStep, workHubEvent({
    event_id: "10000000-0000-4000-8000-000000000502",
    type: eventTypes.agentRunStep,
    topic: "run:10000000-0000-4000-8000-000000000301",
    data: { run_id: "10000000-0000-4000-8000-000000000301" }
  }));
  await closed;

  assert.equal(cards.at(-1)?.state, "celebrating");
  assert.equal(source.closed, true);
  assert.deepEqual(statuses.map((status) => status.state), ["subscribed", "event", "refreshed", "event", "refreshed", "closed"]);
});

test("findings: error card re-surfaces after a recovery event resets the latch", async () => {
  FakeEventSource.instances = [];
  const cards: CuuCard[] = [];
  const client = {
    streamUrl(path: string) {
      return `/daemon${path}`;
    },
    async getAgentRun() {
      return agentRunLive({ status: "running" });
    }
  };
  const subscription = subscribeDesktopCuuAgentRunStream({
    client,
    run: agentRunLive(),
    EventSourceCtor: FakeEventSource,
    // 大值：避免兜底刷新计时器在本测试同步断言期间触发。
    fallbackRefreshMs: 60_000,
    onCard(card) {
      cards.push(card);
    },
    onStatus() {}
  });
  const source = FakeEventSource.instances[0]!;

  // 1) 首次断连 → 弹错误卡（worried）。
  source.emit("error");
  // 2) 收到有效事件 → 同步重置 errorCardShown 闩。
  source.emit(eventTypes.agentRunStep, workHubEvent({
    event_id: "10000000-0000-4000-8000-000000000601",
    type: eventTypes.agentRunStep,
    topic: "run:10000000-0000-4000-8000-000000000301",
    data: { run_id: "10000000-0000-4000-8000-000000000301" }
  }));
  // 3) 再次断连 → 修复后应再次弹错误卡（修复前闩永久 true，不再弹）。
  source.emit("error");

  // event_source_error → kind "offline" → 卡片 state "offline"。
  const errorCards = cards.filter((card) => card.state === "offline");
  assert.equal(errorCards.length, 2);

  // 关键：关闭订阅，停掉兜底刷新计时器 + EventSource，否则进程挂起不退出（run 是 running，永不自然 close）。
  subscription.close();
});

test("desktop Cuu run stream falls back to polling when no SSE event arrives", async () => {
  FakeEventSource.instances = [];
  const cards: CuuCard[] = [];
  const closed = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("run stream fallback did not close")), 150);
    subscribeDesktopCuuAgentRunStream({
      client: {
        streamUrl(path: string) {
          return `/daemon${path}`;
        },
        async getAgentRun() {
          return agentRunLive({ status: "succeeded", title: "Cuu 桌面入口任务" });
        }
      },
      run: agentRunLive({ status: "running" }),
      EventSourceCtor: FakeEventSource,
      fallbackRefreshMs: 1,
      onCard(card) {
        cards.push(card);
      },
      onStatus(status) {
        if (status.state === "closed") {
          clearTimeout(timeout);
          resolve();
        }
      }
    });
  });

  await closed;
  assert.equal(FakeEventSource.instances[0]?.closed, true);
  assert.equal(cards.at(-1)?.state, "celebrating");
});

test("desktop Cuu run stream fallback maps failed runs to worried replay cards", async () => {
  FakeEventSource.instances = [];
  const cards: CuuCard[] = [];
  const statuses: DesktopCuuRunStreamStatus[] = [];
  const failedRun = agentRunLive({
    status: "failed",
    title: "Cuu 桌面入口任务",
    trace: [
      {
        id: "trace-failed",
        agent_run_id: "10000000-0000-4000-8000-000000000301",
        step_no: 1,
        phase: "final",
        input_json: {},
        output_excerpt: "Cuu R3 run-failure QA 模拟执行失败。",
        control_signal: "escalate",
        created_at: "2026-06-10T01:00:00.000Z"
      }
    ]
  });
  const closed = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("failed run fallback did not close")), 150);
    subscribeDesktopCuuAgentRunStream({
      client: {
        streamUrl(path: string) {
          return `/daemon${path}`;
        },
        async getAgentRun() {
          return failedRun;
        }
      },
      run: agentRunLive({ status: "running" }),
      EventSourceCtor: FakeEventSource,
      fallbackRefreshMs: 1,
      onCard(card) {
        cards.push(card);
      },
      onStatus(status) {
        statuses.push(status);
        if (status.state === "closed") {
          clearTimeout(timeout);
          resolve();
        }
      }
    });
  });

  await closed;
  assert.equal(FakeEventSource.instances[0]?.closed, true);
  assert.equal(cards.at(-1)?.state, "worried");
  assert.equal(cards.at(-1)?.kind, "trace");
  assert.equal(cards.at(-1)?.actions.some((action) => action.id === "view_replay"), true);
  assert.equal(statuses.some((status) => status.state === "refreshed" && status.status === "failed"), true);
});

test("desktop Cuu runtime uses fetch SSE with local client-token headers", async () => {
  const target = globalThis as typeof globalThis & {
    fetch?: typeof fetch;
    localStorage?: Storage;
  };
  const originalFetch = target.fetch;
  const originalLocalStorage = target.localStorage;
  const seen: { url?: string; workhub?: string | null; legacy?: string | null } = {};

  try {
    Object.defineProperty(target, "localStorage", {
      configurable: true,
      value: {
        getItem(key: string) {
          return key === "workhub_client_token" ? "desktop-token-1" : null;
        }
      }
    });
    Object.defineProperty(target, "fetch", {
      configurable: true,
      value: async (url: string | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        seen.url = String(url);
        seen.workhub = headers.get("X-WorkHub-Client-Token");
        seen.legacy = headers.get("X-YQGL-Client-Token");
        return new Response(
          new ReadableStream({
            start(controller) {
              const event = workHubEvent({
                event_id: "10000000-0000-4000-8000-000000000503",
                type: eventTypes.agentRunStep,
                topic: "run:10000000-0000-4000-8000-000000000301",
                data: { run_id: "10000000-0000-4000-8000-000000000301", kind: "done" }
              });
              controller.enqueue(new TextEncoder().encode(formatSseEvent(eventTypes.agentRunStep, event)));
              controller.close();
            }
          }),
          { status: 200, headers: { "Content-Type": "text/event-stream" } }
        );
      }
    });

    const cards: CuuCard[] = [];
    const closed = new Promise<void>((resolve) => {
      subscribeDesktopCuuAgentRunStream({
        client: {
          streamUrl(path: string) {
            return `/daemon${path}`;
          },
          async getAgentRun() {
            return agentRunLive({ status: "succeeded" });
          }
        },
        run: agentRunLive({ status: "running" }),
        onCard(card) {
          cards.push(card);
        },
        onStatus(status) {
          if (status.state === "closed") {
            resolve();
          }
        }
      });
    });

    await closed;
    assert.equal(seen.url, "/daemon/api/push/stream/run/10000000-0000-4000-8000-000000000301");
    assert.equal(seen.workhub, "desktop-token-1");
    assert.equal(seen.legacy, "desktop-token-1");
    assert.equal(cards.at(-1)?.state, "celebrating");
  } finally {
    Object.defineProperty(target, "fetch", {
      configurable: true,
      value: originalFetch
    });
    Object.defineProperty(target, "localStorage", {
      configurable: true,
      value: originalLocalStorage
    });
  }
});

test("desktop Cuu runtime maps API and stream failures to Cuu cards", () => {
  const budget = cardFromDesktopCuuRuntimeError(new WorkHubApiError(402, "budget_exhausted", "预算用完了。"));
  const permission = cardFromDesktopCuuRuntimeError(new WorkHubApiError(403, "forbidden", "没有权限。"), { locale: "en-US" });
  const budgetEnglish = cardFromDesktopCuuRuntimeError(new WorkHubApiError(402, "budget_exhausted", "预算用完了。"), {
    locale: "en-US"
  });
  const genericEnglish = cardFromDesktopCuuRuntimeError(new Error("内部错误"), { locale: "en-US" });
  const genericRunEnglish = cardFromDesktopCuuRuntimeError(new Error("内部错误"), {
    locale: "en-US",
    run: agentRunLive({ status: "failed" })
  });
  const offline = cardFromDesktopCuuRuntimeError(new TypeError("Failed to fetch"), {
    run: agentRunLive({ status: "running" })
  });
  const apiOffline = cardFromDesktopCuuRuntimeError(new WorkHubApiError(
    503,
    "network_unavailable",
    "Cuu R3 QA forced network unavailable."
  ), { locale: "en-US", run: agentRunLive({ status: "running" }) });

  assert.equal(budget.kind, "budget");
  assert.equal(budget.state, "asking_approval");
  assert.equal(budget.message, "这次任务已到预算线，需要你确认下一步。");
  assert.equal(permission.state, "worried");
  assert.equal(permission.title, "This step needs permission");
  assert.equal(permission.message, "Cuu cannot continue directly. Open the detail view to handle it.");
  assert.equal(budgetEnglish.message, "This task reached its budget limit and needs your decision.");
  assert.equal(genericEnglish.message, "Start again and Cuu will reread the request and project files.");
  assert.equal(genericEnglish.actions.some((action) => action.id === "restart_cuu"), true);
  assert.equal(genericEnglish.actions.some((action) => action.id === "view_replay"), false);
  assert.equal(genericRunEnglish.message, "Cuu could not complete this step. Open the detail view to inspect the reason.");
  assert.equal(genericRunEnglish.actions.some((action) => action.id === "view_replay"), true);
  assert.doesNotMatch(
    `${permission.title} ${permission.message} ${budgetEnglish.message} ${genericEnglish.message} ${genericRunEnglish.message}`,
    /[\u3400-\u9fff]/u
  );
  assert.equal(offline.kind, "offline");
  assert.equal(offline.state, "offline");
  assert.equal(offline.payload_ref?.entity_type, "agent_run");
  assert.equal(offline.actions.some((action) => action.id === "view_replay"), true);
  assert.equal(apiOffline.kind, "offline");
  assert.equal(apiOffline.state, "offline");
  assert.equal(apiOffline.message, "The connection or service is unavailable. Cuu will continue when it recovers.");
  assert.equal(apiOffline.payload_ref?.entity_type, "agent_run");
  assert.equal(apiOffline.actions.some((action) => action.id === "view_replay"), true);
});

test("desktop Cuu actions advance option-first clarification sessions", async () => {
  const calls: unknown[] = [];
  const client = {
    async respondApproval() {
      throw new Error("not needed");
    },
    async nextQuestion(sessionId: string, payload: unknown) {
      calls.push({ sessionId, payload });
      const session: SessionVM = {
        session_id: sessionId,
        work_item_id: sessionId,
        topic: `session:${sessionId}`,
        stream_href: `/api/push/stream/session/${sessionId}`,
        next_question_href: `/api/sessions/${sessionId}/next-question`,
        question: {
          id: "question-next",
          session_id: sessionId,
          work_item_id: sessionId,
          title: "下一步要谁审批？",
          input_mode: "single_choice",
          options: [
            { id: "legal", label: "法务审批", description: "先让法务确认口径。", risk_hint: "low" },
            { id: "owner", label: "负责人审批", description: "直接交给项目负责人确认。", risk_hint: "low" }
          ],
          free_text: { enabled: true, collapsed_by_default: true },
          progress: [],
          submit: { method: "POST", href: `/api/sessions/${sessionId}/next-question` }
        }
      };
      return session;
    },
    async searchKnowledge() {
      throw new Error("not needed");
    },
    async useEvidenceForWorkItem() {
      throw new Error("not needed");
    },
    async mergeProposal() {
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
  const result = await submitDesktopCuuAction({ client, action: action! });

  assert.equal(result.message, "下一题：下一步要谁审批？");
  assert.equal(result.card?.kind, "question");
  assert.equal(result.card?.title, "下一步要谁审批？");
  assert.equal(result.card?.payload_ref?.entity_type, "session");
  assert.equal(result.card?.input?.option_first, true);
  assert.deepEqual(calls, [{ sessionId: "session-1", payload: { selected_option_ids: ["risk-first"] } }]);
});

test("desktop Cuu actions finalize confirmed sessions and start the agent run", async () => {
  const calls: unknown[] = [];
  const run = agentRunLive({ title: "Confirmed Cuu run", status: "queued" });
  const client = {
    async respondApproval() {
      throw new Error("not needed");
    },
    async nextQuestion(sessionId: string, payload: unknown) {
      calls.push({ step: "nextQuestion", sessionId, payload });
      const session: SessionVM = {
        session_id: sessionId,
        work_item_id: sessionId,
        topic: `session:${sessionId}`,
        stream_href: `/api/push/stream/session/${sessionId}`,
        next_question_href: `/api/sessions/${sessionId}/next-question`,
        question: {
          id: "question-confirmed",
          session_id: sessionId,
          work_item_id: sessionId,
          title: "是否按这个方向创建事项？",
          input_mode: "confirm",
          options: [],
          free_text: { enabled: true, collapsed_by_default: true },
          progress: [],
          submit: { method: "POST", href: `/api/sessions/${sessionId}/next-question` }
        }
      };
      return session;
    },
    async createWorkItem(payload: unknown): Promise<WorkItemDetailVM> {
      calls.push({ step: "createWorkItem", payload });
      return {
        workitem: {
          id: run.work_item_id,
          code: "WH-301",
          project_id: "10000000-0000-4000-8000-000000000002",
          title: "Confirmed Cuu task",
          status: "ai_working"
        },
        acceptance: [],
        agent_trace_preview: [],
        evidence_refs: []
      } as unknown as WorkItemDetailVM;
    },
    async startAgentRun(workItemId: string, payload: unknown): Promise<AgentRunLiveVM> {
      calls.push({ step: "startAgentRun", workItemId, payload });
      return run;
    },
    async searchKnowledge() {
      throw new Error("not needed");
    },
    async useEvidenceForWorkItem() {
      throw new Error("not needed");
    },
    async mergeProposal() {
      throw new Error("not needed");
    }
  };
  const card: CuuCard = {
    id: "session-confirm",
    kind: "question",
    state: "asking_approval",
    motion: {
      state: "asking_approval",
      sprite_state: "asking_approval_bounce",
      emphasis: "busy",
      loop: true,
      reduced_motion_fallback: "Cuu 等你确认创建事项。"
    },
    title: "是否按这个方向创建事项？",
    message: "点确认后进入真实 AI 执行。",
    priority: "high",
    chips: [
      { id: "create-workitem", label: "创建事项", selected: true },
      { id: "search-evidence-first", label: "先找证据" }
    ],
    input: {
      mode: "confirm",
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

  assert.deepEqual(action, { kind: "session-next-question", sessionId: "session-1", selectedOptionIds: ["create-workitem"] });
  const result = await submitDesktopCuuAction({ client, action: action!, locale: "en-US" });

  assert.equal(result.message, "Cuu started: Confirmed Cuu run");
  assert.equal(result.card?.payload_ref?.entity_type, "agent_run");
  assert.equal(result.card?.state, "thinking");
  assert.equal(result.agentRun?.run_id, run.run_id);
  assert.deepEqual(calls, [
    {
      step: "nextQuestion",
      sessionId: "session-1",
      payload: { selected_option_ids: ["create-workitem"] }
    },
    {
      step: "createWorkItem",
      payload: {
        session_id: "session-1",
        selected_option_ids: ["create-workitem"],
        kickoff_agent: true
      }
    },
    {
      step: "startAgentRun",
      workItemId: run.work_item_id,
      payload: {
        title: "Confirmed Cuu task"
      }
    }
  ]);
});

test("desktop Cuu actions submit proposal merge conflict choices with payloads", async () => {
  const calls: unknown[] = [];
  const card: CuuCard = {
    id: "conflict-card",
    kind: "proposal",
    state: "asking_approval",
    motion: {
      state: "asking_approval",
      sprite_state: "asking_approval_bounce",
      emphasis: "urgent",
      loop: true,
      reduced_motion_fallback: "Cuu 等你选择冲突处理方式。"
    },
    title: "变更撞车了",
    message: "点一个选项继续。",
    priority: "high",
    actions: [
      {
        id: "accept_incoming",
        label: "采纳这次版本",
        tone: "danger",
        method: "POST",
        href: "/api/proposals/proposal-1/merge",
        payload: {
          conflict_resolution: {
            accept_incoming_target_keys: ["drive_item:docs/weekly-report.md"]
          }
        }
      }
    ]
  };
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
    async useEvidenceForWorkItem() {
      throw new Error("not needed");
    },
    async mergeProposal(id: string, payload: unknown) {
      calls.push({ id, payload });
      return {
        attention: {
          summary_text: "已按你的选择采纳这次版本。"
        }
      };
    }
  };

  const action = resolveDesktopCuuAction("/api/proposals/proposal-1/merge", { actionId: "accept_incoming", card });
  const result = await submitDesktopCuuAction({ client, action: action! });

  assert.deepEqual(action, {
    kind: "proposal-merge",
    proposalId: "proposal-1",
    payload: {
      conflict_resolution: {
        accept_incoming_target_keys: ["drive_item:docs/weekly-report.md"]
      }
    }
  });
  assert.equal(result.message, "已按你的选择采纳这次版本。");
  assert.deepEqual(calls, [
    {
      id: "proposal-1",
      payload: {
        conflict_resolution: {
          accept_incoming_target_keys: ["drive_item:docs/weekly-report.md"]
        }
      }
    }
  ]);
});

test("desktop Cuu actions apply AI fusion merge candidates with payloads", async () => {
  const calls: unknown[] = [];
  const card: CuuCard = {
    id: "conflict-card",
    kind: "proposal",
    state: "asking_approval",
    motion: {
      state: "asking_approval",
      sprite_state: "asking_approval_bounce",
      emphasis: "urgent",
      loop: true,
      reduced_motion_fallback: "Cuu 等你选择冲突处理方式。"
    },
    title: "变更撞车了",
    message: "点一个选项继续。",
    priority: "high",
    actions: [
      {
        id: "ai_fusion",
        label: "采用 AI 融合稿",
        tone: "primary",
        method: "POST",
        href: "/api/merge-proposals/merge-proposal-1/apply",
        payload: { confirm: true }
      }
    ]
  };
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
    async useEvidenceForWorkItem() {
      throw new Error("not needed");
    },
    async mergeProposal() {
      throw new Error("not needed");
    },
    async applyMergeProposalCandidate(id: string, payload: unknown) {
      calls.push({ id, payload });
      return {
        attention: {
          summary_text: "已采用 AI 融合稿。"
        }
      };
    }
  };

  const action = resolveDesktopCuuAction("/api/merge-proposals/merge-proposal-1/apply", {
    actionId: "ai_fusion",
    card
  });
  const result = await submitDesktopCuuAction({ client, action: action! });

  assert.deepEqual(action, {
    kind: "proposal-merge-candidate-apply",
    mergeProposalId: "merge-proposal-1",
    payload: { confirm: true }
  });
  assert.equal(result.message, "已采用 AI 融合稿。");
  assert.deepEqual(calls, [{ id: "merge-proposal-1", payload: { confirm: true } }]);
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
    },
    async mergeProposal() {
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
    },
    async mergeProposal() {
      throw new Error("not needed");
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
