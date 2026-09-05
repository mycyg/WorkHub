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
  decideDesktopCuuAbortConfirmation,
  DesktopCuuFetchEventSource,
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
  // R25-Q：sse-status 不再往 controller 里塞任何卡片（那条路径连同它驱动的桌宠"offline"离线卡
  // 一起改由 workhub-connection-changed 承接，见 bindDesktopShellCuuRuntime 顶部注释）——这里注入一条
  // "open" 只是证明订阅本身还活着（channel 仍在 stopped 断言里），不该产生任何决策。
  handlers.get("sse-status")?.({
    payload: {
      stream_kind: "global",
      stream_path: "/api/push/stream",
      state: "open"
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
  // R25-Q：只有 push-event 产出的那一张卡——sse-status 的 "open" 不再触发第二个 decision。
  assert.equal(decisions.length, 1);
  assert.deepEqual(systemNotificationRoutes, ["/approvals?approvalId=approval-runtime"]);

  await runtime.dispose();
  // R12 批7 新增了第四条订阅——workbench-interrupt(接收工作台窗口广播的打扰矩阵结论，见
  // workbench/interrupt-broadcast.ts 与本文件的 buildDesktopWorkbenchInterruptCuuCard)。
  assert.deepEqual(stopped, ["push-event", "sse-status", "system-notification", "workbench-interrupt"]);
});

// R12 批7:action_card_item.dispatch_ask 通知(真实来源:conversation-observer.ts 的
// dispatchExecuteItem，dispatchPolicy==="ask" 时经既有 /me SSE 流推送)要换成 Cuu 二次元问询话术 +
// 深链进工作台的动作，且只出一张卡(不能连 cardFromEvent 的通用通知卡一起冒出两张)。
test("desktop Cuu runtime turns a dispatch_ask notification into a single custom bubble with a workbench deep link", async () => {
  const handlers = new Map<string, (event: DesktopShellEventEnvelope) => void>();
  const notices: DesktopCuuNotice[] = [];
  const decisions: CuuControllerDecision[] = [];
  const listen: DesktopShellListen = (eventName, handler) => {
    handlers.set(eventName, handler);
    return () => {};
  };

  const runtime = await bindDesktopShellCuuRuntime({
    listen,
    locale: "zh-CN",
    notify: (notice) => notices.push(notice),
    onDecision: (decision) => decisions.push(decision)
  });
  handlers.get("push-event")?.({
    payload: shellPayload(eventTypes.notificationCreated, {
      id: "notification-dispatch-ask-1",
      type: "action_card_item.dispatch_ask",
      severity: "normal",
      title: "有个活想派给你",
      body: "把选题报告初稿重写第三节",
      project_id: "10000000-0000-4000-8000-000000000777",
      created_at: "2026-07-12T09:00:00.000Z"
    })
  });

  assert.equal(runtime.subscribed, true);
  assert.equal(notices.length, 1, "exactly one bubble — not the generic card plus the custom one");
  const card = notices[0]?.card;
  assert.equal(card?.id, "dispatch-ask:notification-dispatch-ask-1");
  assert.equal(card?.title, "有个活儿想派给我");
  assert.match(card?.message ?? "", /把选题报告初稿重写第三节/u);
  assert.match(card?.message ?? "", /？$/u); // 问句,不是"已经开工了"的既成事实
  assert.deepEqual(card?.actions, [
    {
      id: "open_workbench",
      label: "去工作台看看",
      tone: "primary",
      method: "GET",
      href: "/workbench/10000000-0000-4000-8000-000000000777"
    }
  ]);
  assert.equal(decisions[0]?.outcome, "show");

  await runtime.dispose();
});

// R13 批 P2（拍板链路收尾）：Notification 契约新增的 additive conversation_id 字段（服务端从
// dispatch_ask 通知的 target_url 查询参数解出来）要能让气泡深链直接定位到发起这次派活讨论的会话——
// 不只是项目首屏。conversation_id 缺失时（老通知/契约还没升级的部署）href 照旧只带 projectId，
// 上一条测试已经锁死这个退化路径不受影响。
test("desktop Cuu runtime deep-links a dispatch_ask bubble straight to the source conversation when conversation_id is present", async () => {
  const handlers = new Map<string, (event: DesktopShellEventEnvelope) => void>();
  const notices: DesktopCuuNotice[] = [];
  const listen: DesktopShellListen = (eventName, handler) => {
    handlers.set(eventName, handler);
    return () => {};
  };

  const runtime = await bindDesktopShellCuuRuntime({
    listen,
    locale: "zh-CN",
    notify: (notice) => notices.push(notice)
  });
  handlers.get("push-event")?.({
    payload: shellPayload(eventTypes.notificationCreated, {
      id: "notification-dispatch-ask-2",
      type: "action_card_item.dispatch_ask",
      severity: "normal",
      title: "有个活想派给你",
      body: "整理会议纪要",
      project_id: "10000000-0000-4000-8000-000000000777",
      conversation_id: "10000000-0000-4000-8000-000000000801",
      created_at: "2026-07-13T09:00:00.000Z"
    })
  });

  const card = notices[0]?.card;
  assert.deepEqual(card?.actions, [
    {
      id: "open_workbench",
      label: "去工作台看看",
      tone: "primary",
      method: "GET",
      href: "/workbench/10000000-0000-4000-8000-000000000777/10000000-0000-4000-8000-000000000801"
    }
  ]);

  await runtime.dispose();
});

// R14 FIX（通知深链缺 conversation_id）：dispatch_ask 之外的通知类型（如 workitem.escalated/
// workitem.in_review 里程碑通知，见 apps/api/src/services/notifications.ts 的 notifyMilestone）现在
// 也可能带上 conversation_id（工作台会话派发出去的 run 失败/待审查时）。这类通知不该退化成
// cardFromEvent 的通用兜底（href=target_url，点开只会打开主窗口的工作项页）——该像 dispatch_ask 一样
// 直接深链进工作台会话，只是文案用通知自己的 title/body，不套 dispatch_ask 那句专属问句。
test("desktop Cuu runtime deep-links any conversation-linked notification (not just dispatch_ask) straight to the workbench", async () => {
  const handlers = new Map<string, (event: DesktopShellEventEnvelope) => void>();
  const notices: DesktopCuuNotice[] = [];
  const listen: DesktopShellListen = (eventName, handler) => {
    handlers.set(eventName, handler);
    return () => {};
  };

  const runtime = await bindDesktopShellCuuRuntime({
    listen,
    locale: "zh-CN",
    notify: (notice) => notices.push(notice)
  });
  handlers.get("push-event")?.({
    payload: shellPayload(eventTypes.notificationCreated, {
      id: "notification-escalated-1",
      type: "workitem.escalated",
      severity: "high",
      title: "WH-9 需要你来定一下",
      body: "这个活我先卡住了：预算已经用完。",
      project_id: "10000000-0000-4000-8000-000000000777",
      conversation_id: "10000000-0000-4000-8000-000000000802",
      target_url: "/workitems/10000000-0000-4000-8000-000000000900?conversation_id=10000000-0000-4000-8000-000000000802",
      created_at: "2026-07-14T09:00:00.000Z"
    })
  });

  assert.equal(notices.length, 1, "exactly one bubble — not the generic notification card plus a custom one");
  const card = notices[0]?.card;
  assert.equal(card?.title, "WH-9 需要你来定一下");
  assert.match(card?.message ?? "", /预算已经用完/u);
  assert.deepEqual(card?.actions, [
    {
      id: "open_workbench",
      label: "去工作台看看",
      tone: "primary",
      method: "GET",
      href: "/workbench/10000000-0000-4000-8000-000000000777/10000000-0000-4000-8000-000000000802"
    }
  ]);

  await runtime.dispose();
});

// 没有会话上下文的通知（没有 conversation_id，如老部署/其它通知类型）不该被这条新通路拦截——
// 照旧退化成 cardFromEvent 的通用兜底（href 直接用 target_url），消费端不炸、不假装有深链目标。
test("desktop Cuu runtime falls back to the generic notification card when there is no conversation_id", async () => {
  const handlers = new Map<string, (event: DesktopShellEventEnvelope) => void>();
  const notices: DesktopCuuNotice[] = [];
  const listen: DesktopShellListen = (eventName, handler) => {
    handlers.set(eventName, handler);
    return () => {};
  };

  const runtime = await bindDesktopShellCuuRuntime({
    listen,
    locale: "zh-CN",
    notify: (notice) => notices.push(notice)
  });
  handlers.get("push-event")?.({
    payload: shellPayload(eventTypes.notificationCreated, {
      id: "notification-in-review-1",
      type: "workitem.in_review",
      severity: "high",
      title: "WH-10 成果待你确认采纳",
      body: "AI 工人把成果整理好了，进去确认采纳或打回",
      project_id: "10000000-0000-4000-8000-000000000777",
      target_url: "/workitems/10000000-0000-4000-8000-000000000901",
      created_at: "2026-07-14T09:05:00.000Z"
    })
  });

  assert.equal(notices.length, 1);
  const card = notices[0]?.card;
  // 通用兜底：action href 就是通知自己的 target_url，没有 workbench 深链（没有会话上下文可深链）。
  assert.equal(card?.actions[0]?.href, "/workitems/10000000-0000-4000-8000-000000000901");
  assert.equal(card?.actions.some((action) => action.id === "open_workbench"), false);

  await runtime.dispose();
});

test("desktop Cuu runtime dedupes a replayed dispatch_ask notification (same id) instead of showing it twice", async () => {
  const handlers = new Map<string, (event: DesktopShellEventEnvelope) => void>();
  const notices: DesktopCuuNotice[] = [];
  const listen: DesktopShellListen = (eventName, handler) => {
    handlers.set(eventName, handler);
    return () => {};
  };

  const runtime = await bindDesktopShellCuuRuntime({
    listen,
    locale: "zh-CN",
    notify: (notice) => notices.push(notice)
  });
  const payload = {
    id: "notification-dispatch-ask-replay",
    type: "action_card_item.dispatch_ask",
    severity: "normal",
    title: "有个活想派给你",
    body: "整理会议纪要",
    project_id: "10000000-0000-4000-8000-000000000778"
  };
  handlers.get("push-event")?.({ payload: shellPayload(eventTypes.notificationCreated, payload) });
  handlers.get("push-event")?.({ payload: shellPayload(eventTypes.notificationCreated, payload) });

  assert.equal(notices.length, 1);
  await runtime.dispose();
});

// R12 批7:接收工作台窗口广播的"该弹气泡了"结论(见 workbench/interrupt-broadcast.ts)，转成一张
// CuuCard 走同一条 controller 队列——garbage/不完整 payload 静默忽略，不崩、不出卡。
test("desktop Cuu runtime turns a workbench-interrupt broadcast into a bubble with a workbench deep link", async () => {
  const handlers = new Map<string, (event: DesktopShellEventEnvelope) => void>();
  const notices: DesktopCuuNotice[] = [];
  const listen: DesktopShellListen = (eventName, handler) => {
    handlers.set(eventName, handler);
    return () => {};
  };

  const runtime = await bindDesktopShellCuuRuntime({
    listen,
    locale: "zh-CN",
    notify: (notice) => notices.push(notice)
  });
  handlers.get("workbench-interrupt")?.({
    payload: {
      id: "action-card-event-1",
      category: "action_card",
      projectId: "10000000-0000-4000-8000-000000000779",
      conversationId: "20000000-0000-4000-8000-000000000001",
      title: "Cuu 行动卡",
      message: "Cuu 整理出了 2 件事，等你看一眼。",
      createdAt: "2026-07-12T09:05:00.000Z"
    }
  });

  assert.equal(notices.length, 1);
  const card = notices[0]?.card;
  assert.equal(card?.id, "workbench-interrupt:action-card-event-1");
  assert.equal(card?.title, "Cuu 行动卡");
  assert.deepEqual(card?.actions[0]?.href, "/workbench/10000000-0000-4000-8000-000000000779/20000000-0000-4000-8000-000000000001");

  await runtime.dispose();
});

test("desktop Cuu runtime ignores a malformed workbench-interrupt payload instead of crashing", async () => {
  const handlers = new Map<string, (event: DesktopShellEventEnvelope) => void>();
  const notices: DesktopCuuNotice[] = [];
  const listen: DesktopShellListen = (eventName, handler) => {
    handlers.set(eventName, handler);
    return () => {};
  };

  const runtime = await bindDesktopShellCuuRuntime({
    listen,
    notify: (notice) => notices.push(notice)
  });
  handlers.get("workbench-interrupt")?.({ payload: { nonsense: true } });
  handlers.get("workbench-interrupt")?.({ payload: null });

  assert.equal(notices.length, 0);
  await runtime.dispose();
});

// R25-Q：此前这个用例用 sse-status 的 closed/retrying 两态各产一张"offline"卡来证明 locale getter
// 是活的——那条产卡路径已经整个搬去 workhub-connection-changed（见 bindDesktopShellCuuRuntime 顶部
// 注释），改用同样走 bridge/emitCard 的 dispatch_ask 推送通知（`buildDesktopDispatchAskCuuCard` 同样
// 读 `input.locale`），两条不同 id 的通知之间切换 liveLocale，断言点没变：locale 是在"卡片真正构建
// 那一刻"读取的，不是 bind 时冻结的。
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
    notify: () => {},
    onDecision: (decision) => decisions.push(decision),
    // Mirrors pet-surface.ts threading a live locale getter so the bridge
    // resolves the *current* locale at card-build time, not boot time.
    get locale() {
      return liveLocale;
    }
  });

  // First dispatch_ask card renders in the boot locale. Asserting against `decisions` (fired on
  // every controller.enqueue(), regardless of show/queue outcome) rather than `notices` (only
  // fired on show/replace) — the second card below queues behind the first still-active one, so
  // it would never reach `notify()`, but the card the bridge *built* is still what this test cares
  // about.
  handlers.get("push-event")?.({
    payload: shellPayload(eventTypes.notificationCreated, {
      id: "notification-live-locale-1",
      type: "action_card_item.dispatch_ask",
      severity: "normal",
      title: "有个活想派给你",
      body: "把选题报告初稿重写第三节",
      created_at: "2026-07-12T09:00:00.000Z"
    })
  });
  assert.equal(decisions[0]?.card?.title, "有个活儿想派给我");

  // User switches language; a newly arriving card (different notification id, so it is not
  // deduped against the first one) must localize live.
  liveLocale = "en-US";
  handlers.get("push-event")?.({
    payload: shellPayload(eventTypes.notificationCreated, {
      id: "notification-live-locale-2",
      type: "action_card_item.dispatch_ask",
      severity: "normal",
      title: "有个活想派给你",
      body: "把选题报告初稿重写第三节",
      created_at: "2026-07-12T09:01:00.000Z"
    })
  });
  assert.equal(decisions[1]?.card?.title, "A task might come my way");
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

test("desktop Cuu proposal actions preserve locale for localized result copy", async () => {
  const calls: unknown[] = [];
  const client = {
    async respondApproval() {
      throw new Error("not needed");
    },
    async reviewProposal(id: string, payload: unknown, options?: unknown) {
      calls.push({ type: "review", id, payload, options });
      return { attention: { summary_text: "Proposal approved." } };
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
    async mergeProposal(id: string, payload: unknown, options?: unknown) {
      calls.push({ type: "merge", id, payload, options });
      return { attention: { summary_text: "Proposal merged." } };
    },
    async applyMergeProposalCandidate(id: string, payload: unknown, options?: unknown) {
      calls.push({ type: "apply", id, payload, options });
      return { attention: { summary_text: "AI fusion applied." } };
    }
  };
  const review = resolveDesktopCuuAction("/api/proposals/proposal-1/review", { actionId: "approve" });
  const merge = resolveDesktopCuuAction("/api/proposals/proposal-1/merge", { actionId: "merge" });
  const apply = resolveDesktopCuuAction("/api/merge-proposals/merge-proposal-1/apply", { actionId: "apply" });

  await submitDesktopCuuAction({ client, action: review!, locale: "en-US" });
  await submitDesktopCuuAction({ client, action: merge!, locale: "en-US" });
  await submitDesktopCuuAction({ client, action: apply!, locale: "en-US" });

  assert.deepEqual(calls, [
    { type: "review", id: "proposal-1", payload: { decision: "approve", remember: "once" }, options: { locale: "en-US" } },
    { type: "merge", id: "proposal-1", payload: {}, options: { locale: "en-US" } },
    { type: "apply", id: "merge-proposal-1", payload: {}, options: { locale: "en-US" } }
  ]);
});

test("desktop Cuu actions resolve escalation cards with action-specific payloads", async () => {
  const calls: unknown[] = [];
  const client = {
    async respondApproval() {
      throw new Error("not needed");
    },
    async resolveEscalation(id: string, payload: unknown, options?: unknown) {
      calls.push({ id, payload, options });
      return { attention: { summary_text: "我会再让它试一次。" } };
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
  const retry = resolveDesktopCuuAction("/api/escalations/escalation-1/resolve", { actionId: "escalation_retry" });
  const pmMode = resolveDesktopCuuAction("/api/escalations/escalation-1/resolve", { actionId: "escalation_pm_mode" });
  const cancel = resolveDesktopCuuAction("/api/escalations/escalation-1/resolve", { actionId: "escalation_cancel" });

  assert.deepEqual(retry, {
    kind: "resolve-escalation",
    escalationId: "escalation-1",
    payload: { action: "retry" }
  });
  assert.deepEqual(pmMode, {
    kind: "resolve-escalation",
    escalationId: "escalation-1",
    payload: { action: "pm_mode" }
  });
  assert.deepEqual(cancel, {
    kind: "resolve-escalation",
    escalationId: "escalation-1",
    payload: { action: "cancel" }
  });

  assert.equal((await submitDesktopCuuAction({ client, action: retry! })).message, "我会再让它试一次。");
  assert.deepEqual(calls, [
    { id: "escalation-1", payload: { action: "retry" }, options: { locale: "zh-CN" } }
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
    async createSession(payload: unknown, options?: unknown): Promise<SessionVM> {
      calls.push({ step: "createSession", payload, options });
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
    async createWorkItem(payload: unknown, options?: unknown) {
      calls.push({ step: "createWorkItem", payload, options });
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
    async startAgentRun(workItemId: string, payload: unknown, options?: unknown) {
      calls.push({ step: "startAgentRun", workItemId, payload, options });
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
  const result = await submitDesktopCuuAction({ client, action: action!, locale: "zh-CN" });

  assert.equal(action?.kind, "cuu-start-agent");
  assert.equal(action && "selectedOptionIds" in action ? action.selectedOptionIds : undefined, undefined);
  assert.equal(action && action.kind === "cuu-start-agent" ? action.cuuLauncherSpec : undefined, undefined);
  assert.equal(action && "intentText" in action ? action.intentText : "", demand);
  assert.equal(result.message, "Cuu 已启动：Cuu 桌面入口任务");
  assert.equal(result.card?.payload_ref?.entity_type, "agent_run");
  assert.equal(result.card?.state, "thinking");
  assert.equal(result.agentRun?.run_id, run.run_id);
  // R9.7: the old assertion only checked payloads, but launcher-created sessions
  // render user-visible follow-up/confirm cards; omitting locale options let zh flows
  // silently fall back to English after the first clarification.
  assert.deepEqual(calls, [
    {
      step: "createSession",
      payload: {
        title: demand,
        intent_text: demand
      },
      options: { locale: "zh-CN" }
    },
    {
      step: "createWorkItem",
      payload: {
        session_id: "10000000-0000-4000-8000-000000000201",
        title: demand,
        raw_description: demand,
        free_text: demand,
        kickoff_agent: true
      },
      options: { locale: "zh-CN" }
    },
    {
      step: "startAgentRun",
      workItemId: "10000000-0000-4000-8000-000000000201",
      payload: {
        title: demand
      },
      options: { locale: "zh-CN" }
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

test("DSK-08: absolute run stream URLs must share the API base origin; cross-origin is refused with an error card", () => {
  FakeEventSource.instances = [];
  const cards: CuuCard[] = [];
  const statuses: DesktopCuuRunStreamStatus[] = [];
  const client = {
    streamUrl(path: string) {
      return `http://127.0.0.1:8787${path}`;
    },
    async getAgentRun() {
      return agentRunLive({ status: "running" });
    }
  };
  const runId = "10000000-0000-4000-8000-000000000301";

  // 同源绝对 URL：原样放行（与相对路径解析结果一致）。
  const sameOrigin = subscribeDesktopCuuAgentRunStream({
    client,
    run: agentRunLive({ stream_href: `http://127.0.0.1:8787/api/push/stream/run/${runId}` }),
    EventSourceCtor: FakeEventSource,
    fallbackRefreshMs: 60_000,
    onCard(card) {
      cards.push(card);
    },
    onStatus(status) {
      statuses.push(status);
    }
  });
  assert.equal(sameOrigin.streamUrl, `http://127.0.0.1:8787/api/push/stream/run/${runId}`);
  sameOrigin.close();

  // 跨源绝对 URL：拒绝——不建流（不带着 client token 去连第三方源），弹错误卡 + error 状态。
  const crossOrigin = subscribeDesktopCuuAgentRunStream({
    client,
    run: agentRunLive({ stream_href: "https://evil.example.com/api/push/stream/run/x" }),
    EventSourceCtor: FakeEventSource,
    fallbackRefreshMs: 60_000,
    onCard(card) {
      cards.push(card);
    },
    onStatus(status) {
      statuses.push(status);
    }
  });
  assert.equal(crossOrigin.streamUrl, undefined);
  assert.equal(FakeEventSource.instances.length, 1, "cross-origin URL must not open a stream");
  // 通用错误卡（kind=generic → state "worried"），带 run 上下文。
  assert.equal(cards.at(-1)?.state, "worried");
  assert.equal(cards.at(-1)?.id, `cuu-run-error-${runId}`);
  assert.ok(statuses.some((status) => status.state === "error"));
  crossOrigin.close();
  const lastStatus = statuses.at(-1);
  assert.ok(lastStatus?.state === "closed" && lastStatus.reason === "cross_origin_stream_url");
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

// R20 P1-03 回归门：可注入的假时钟——tick() 触发当拍全部挂起定时器，用于确定性驱动重连/兜底退避，
// 不依赖真定时器/真网络。返回值用 setTimeout 的真实类型别名，与生产注入点的 TimerId 结构一致。
type FakeTimerId = ReturnType<typeof globalThis.setTimeout>;

function createFakeClock() {
  let seq = 0;
  const pending = new Map<number, { handler: () => void; delayMs: number }>();
  const cleared: number[] = [];
  const delays: number[] = [];
  return {
    setTimeout(handler: () => void, delayMs: number): FakeTimerId {
      const id = seq;
      seq += 1;
      pending.set(id, { handler, delayMs });
      delays.push(delayMs);
      return id as unknown as FakeTimerId;
    },
    clearTimeout(id: FakeTimerId): void {
      cleared.push(id as unknown as number);
      pending.delete(id as unknown as number);
    },
    pendingCount() {
      return pending.size;
    },
    delays() {
      return delays.slice();
    },
    cleared() {
      return cleared.slice();
    },
    // 快照当拍挂起项后清空再逐一触发——新排的定时器进入下一拍，不在本拍内递归触发。
    fire() {
      const due = [...pending.values()];
      pending.clear();
      for (const timer of due) {
        timer.handler();
      }
    }
  };
}

// 冲刷微任务 + 宏任务，让 fire() 触发的 async open()/refresh() 跑到下一个悬挂点并把后续定时器排上。
async function flushAsync(cycles = 8) {
  for (let i = 0; i < cycles; i += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
  }
}

test("R20 P1-03: fetch SSE source reconnects with backoff on EOF and fetch failure, resets only once real data arrives", async () => {
  const clock = createFakeClock();
  const errors: string[] = [];
  let opens = 0;
  let fetchCalls = 0;
  // 脚本：连#0=EOF(无数据), 连#1..2=断网(抛), 连#3=真收到一帧数据后才 EOF(真正恢复)。
  // EOF 与抛错都必须派发 error 并按退避重连；C1（R21 审查）：只有连#3 真收到过数据块才算「连接活了」，
  // 退避才该复位——连#0 那种「accept 即断、从未有数据」的空 EOF 不该复位（那正是本轮修的 bug）。
  const script = ["eof", "throw", "throw", "data-then-eof"];
  const fakeFetch = async () => {
    const mode = script[fetchCalls] ?? "throw";
    fetchCalls += 1;
    if (mode === "throw") {
      throw new TypeError("Failed to fetch");
    }
    if (mode === "data-then-eof") {
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(": ping\n\n"));
            controller.close();
          }
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      );
    }
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.close();
        }
      }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } }
    );
  };

  const source = new DesktopCuuFetchEventSource(
    "/daemon/api/push/stream/run/run-1",
    { withCredentials: true },
    {
      fetch: fakeFetch as unknown as typeof fetch,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      random: () => 0,
      baseReconnectMs: 1000,
      maxReconnectMs: 60_000
    }
  );
  source.addEventListener("open", () => {
    opens += 1;
  });
  source.addEventListener("error", (event) => {
    if (event.data) {
      errors.push(event.data);
    }
  });

  // 首连成功后立即 EOF（从未收到任何数据）：旧实现在此静默返回、无任何调度（红）；
  // 新实现派发 error 并排一个退避重连（绿）。
  await flushAsync();
  assert.equal(fetchCalls, 1);
  assert.equal(opens, 1);
  assert.deepEqual(errors, ["event_source_eof"]);
  assert.equal(clock.pendingCount(), 1);
  assert.deepEqual(clock.delays(), [1000]);

  // 重连#1 → 断网抛错 → 派发 error + 退避翻倍。
  clock.fire();
  await flushAsync();
  assert.equal(fetchCalls, 2);
  assert.deepEqual(errors, ["event_source_eof", "Failed to fetch"]);
  assert.equal(clock.delays().at(-1), 2000);

  // 重连#2 → 再次断网 → 退避再翻倍。
  clock.fire();
  await flushAsync();
  assert.equal(fetchCalls, 3);
  assert.equal(clock.delays().at(-1), 4000);

  // 重连#3 → 网络恢复、真收到一帧数据后才 EOF → 退避复位回基准（真活过一次后下一次退避又是 1000），
  // 并再次派发 open。
  clock.fire();
  await flushAsync();
  assert.equal(fetchCalls, 4);
  assert.equal(opens, 2);
  assert.equal(clock.delays().at(-1), 1000);
  assert.equal(clock.pendingCount(), 1);

  // 视图关闭：清掉待触发的重连定时器，此后再怎么推进都不再重连（无泄漏）。
  source.close();
  assert.equal(clock.pendingCount(), 0);
  clock.fire();
  await flushAsync();
  assert.equal(fetchCalls, 4);
});

test("C4（R21 审查）: accept-即断（HTTP 200 后立刻 EOF、从未有数据帧）的连续重连必须正常指数退避，不能卡在基准值", async () => {
  const clock = createFakeClock();
  let fetchCalls = 0;
  // 每次都是同一种「accept 即断」：响应 200 后 body 立刻关闭，从未 enqueue 过任何字节。
  const fakeFetch = async () => {
    fetchCalls += 1;
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.close();
        }
      }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } }
    );
  };

  const source = new DesktopCuuFetchEventSource(
    "/daemon/api/push/stream/run/run-2",
    { withCredentials: true },
    {
      fetch: fakeFetch as unknown as typeof fetch,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      random: () => 0,
      baseReconnectMs: 1000,
      maxReconnectMs: 60_000
    }
  );

  // 连#0（首连）：accept 即断，退避排到基准 1000（consecutiveFailures 从 0 起，尚未有过错判）。
  await flushAsync();
  assert.equal(fetchCalls, 1);
  assert.deepEqual(clock.delays(), [1000]);

  // 连#1..#3：每次都同样 accept 即断——若退避在响应 OK 时就清零（修复前的 bug），这里会一直停在 1000；
  // 修复后应正常翻倍：2000 → 4000 → 8000。
  clock.fire();
  await flushAsync();
  assert.equal(fetchCalls, 2);
  assert.equal(clock.delays().at(-1), 2000);

  clock.fire();
  await flushAsync();
  assert.equal(fetchCalls, 3);
  assert.equal(clock.delays().at(-1), 4000);

  clock.fire();
  await flushAsync();
  assert.equal(fetchCalls, 4);
  assert.equal(clock.delays().at(-1), 8000);

  source.close();
});

test("R20 P1-03: run stream fallback keeps polling past 10 failures and converges after recovery", async () => {
  FakeEventSource.instances = [];
  const clock = createFakeClock();
  const cards: CuuCard[] = [];
  const statuses: DesktopCuuRunStreamStatus[] = [];
  let getCalls = 0;
  // 断网连续失败 14 次（远超旧的 10 次上限）后网络恢复，返回终态。
  const FAILURES = 14;
  const client = {
    streamUrl(path: string) {
      return `/daemon${path}`;
    },
    async getAgentRun() {
      getCalls += 1;
      if (getCalls <= FAILURES) {
        throw new WorkHubApiError(503, "network_unavailable", "Cuu R20 forced network unavailable.");
      }
      return agentRunLive({ status: "succeeded", title: "Cuu 桌面入口任务" });
    }
  };

  subscribeDesktopCuuAgentRunStream({
    client,
    run: agentRunLive({ status: "running" }),
    EventSourceCtor: FakeEventSource,
    fallbackRefreshMs: 1000,
    timers: { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout },
    onCard(card) {
      cards.push(card);
    },
    onStatus(status) {
      statuses.push(status);
    }
  });

  // 逐拍推进：每拍触发唯一挂起的兜底定时器 → refresh（失败）→ 退避后续排下一拍。旧代码第 10 次失败后
  // scheduleFallbackRefresh 直接返回、不再续排 → getCalls 卡在 10、永远等不到 SSE 唤醒（自制源已死）。
  for (let i = 0; i < FAILURES + 3; i += 1) {
    clock.fire();
    await flushAsync();
  }

  assert.ok(getCalls > 10, `polling must survive past 10 failures, got ${getCalls}`);
  assert.equal(statuses.some((status) => status.state === "refreshed" && status.status === "succeeded"), true);
  assert.equal(statuses.some((status) => status.state === "closed"), true);
  assert.equal(cards.at(-1)?.state, "celebrating");
  assert.equal(FakeEventSource.instances[0]?.closed, true);
  // 收敛后 close 清掉兜底定时器，无泄漏。
  assert.equal(clock.pendingCount(), 0);
});

test("R20 P1-03: SSE reconnect (open event) triggers terminal reconciliation", async () => {
  FakeEventSource.instances = [];
  const clock = createFakeClock();
  const cards: CuuCard[] = [];
  const statuses: DesktopCuuRunStreamStatus[] = [];
  let getCalls = 0;
  const client = {
    streamUrl(path: string) {
      return `/daemon${path}`;
    },
    async getAgentRun() {
      getCalls += 1;
      // 断网期间 run 已在服务端终结；重连后的流不回放漏掉的事件，靠 open 触发的对账收敛到终态。
      return agentRunLive({ status: "succeeded", title: "Cuu 桌面入口任务" });
    }
  };

  const subscription = subscribeDesktopCuuAgentRunStream({
    client,
    run: agentRunLive({ status: "running" }),
    EventSourceCtor: FakeEventSource,
    // 慢到本测试同步断言期间兜底定时器不自发触发——对账必须由 open 触发，而非兜底轮询。
    fallbackRefreshMs: 600_000,
    timers: { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout },
    onCard(card) {
      cards.push(card);
    },
    onStatus(status) {
      statuses.push(status);
    }
  });
  const source = FakeEventSource.instances[0]!;

  // 断连（无自动对账）→ 重连派发 open → 触发一次终态对账 refresh。
  source.emit("error");
  source.emit("open");
  await flushAsync();

  assert.ok(getCalls >= 1, "open must trigger a reconciliation getAgentRun");
  assert.equal(statuses.some((status) => status.state === "refreshed" && status.status === "succeeded"), true);
  assert.equal(cards.at(-1)?.state, "celebrating");
  assert.equal(statuses.some((status) => status.state === "closed"), true);
  assert.equal(clock.pendingCount(), 0);
  subscription.close();
});

test("R20 P1-03: closing the subscription clears fallback timers and stops rescheduling", async () => {
  FakeEventSource.instances = [];
  const clock = createFakeClock();
  let getCalls = 0;
  const client = {
    streamUrl(path: string) {
      return `/daemon${path}`;
    },
    async getAgentRun() {
      getCalls += 1;
      throw new WorkHubApiError(503, "network_unavailable", "Cuu R20 forced network unavailable.");
    }
  };

  const subscription = subscribeDesktopCuuAgentRunStream({
    client,
    run: agentRunLive({ status: "running" }),
    EventSourceCtor: FakeEventSource,
    fallbackRefreshMs: 1000,
    timers: { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout },
    onCard() {},
    onStatus() {}
  });
  const source = FakeEventSource.instances[0]!;

  // 先跑两拍（均失败）确认一直在续排。
  clock.fire();
  await flushAsync();
  clock.fire();
  await flushAsync();
  assert.ok(getCalls >= 2);
  assert.equal(clock.pendingCount(), 1);

  // 关闭视图 → 清掉挂起定时器 + 关掉 source；此后推进时钟不再排/触发任何轮询（无泄漏）。
  subscription.close();
  assert.equal(source.closed, true);
  assert.equal(clock.pendingCount(), 0);
  const callsAfterClose = getCalls;
  clock.fire();
  await flushAsync();
  assert.equal(clock.pendingCount(), 0);
  assert.equal(getCalls, callsAfterClose);
});

test("DSK-11: fallback polling yields while SSE events keep flowing, resumes when the stream goes silent", async () => {
  FakeEventSource.instances = [];
  const clock = createFakeClock();
  let now = 0;
  let getCalls = 0;
  const client = {
    streamUrl(path: string) {
      return `/daemon${path}`;
    },
    async getAgentRun() {
      getCalls += 1;
      return agentRunLive({ status: "running" });
    }
  };
  const subscription = subscribeDesktopCuuAgentRunStream({
    client,
    run: agentRunLive({ status: "running" }),
    EventSourceCtor: FakeEventSource,
    fallbackRefreshMs: 1000,
    timers: { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, now: () => now },
    onCard() {},
    onStatus() {}
  });
  const source = FakeEventSource.instances[0]!;

  // 流还没来任何事件：第一拍兜底照常跑（初始不是「活跃」）。
  clock.fire();
  await flushAsync();
  assert.equal(getCalls, 1);

  // SSE 事件到达（事件自身驱动一次 refresh）→ 之后活跃期内的兜底拍全部让位，不再双通道重复拉。
  now = 10_000;
  source.emit(eventTypes.agentRunStep, workHubEvent({
    event_id: "10000000-0000-4000-8000-000000000701",
    type: eventTypes.agentRunStep,
    topic: "run:10000000-0000-4000-8000-000000000301",
    data: { run_id: "10000000-0000-4000-8000-000000000301" }
  }));
  await flushAsync();
  assert.equal(getCalls, 2);
  clock.fire();
  await flushAsync();
  assert.equal(getCalls, 2, "fallback must skip while the SSE stream is active");
  clock.fire();
  await flushAsync();
  assert.equal(getCalls, 2);

  // 流静默超过 2 拍（事件停在 now=10_000，now 走到 12_500）→ 兜底恢复拉取。
  now = 12_500;
  clock.fire();
  await flushAsync();
  assert.equal(getCalls, 3, "fallback must resume once the stream has been silent for two beats");

  subscription.close();
  assert.equal(clock.pendingCount(), 0);
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

test("desktop Cuu session actions preserve the current locale for follow-up questions", async () => {
  const calls: unknown[] = [];
  const client = {
    async respondApproval() {
      throw new Error("not needed");
    },
    async nextQuestion(sessionId: string, payload: unknown, options?: unknown) {
      calls.push({ sessionId, payload, options });
      const session: SessionVM = {
        session_id: sessionId,
        work_item_id: sessionId,
        topic: `session:${sessionId}`,
        stream_href: `/api/push/stream/session/${sessionId}`,
        next_question_href: `/api/sessions/${sessionId}/next-question`,
        question: {
          id: "question-confirm",
          session_id: sessionId,
          work_item_id: sessionId,
          title: "是否按这个方向创建事项？",
          body: "点确认后会进入可执行事项；如果需要更多依据，可以先去检索项目证据。",
          input_mode: "confirm",
          options: [
            { id: "create-workitem", label: "创建事项", description: "确认后，事项会进入可执行状态，AI 可以继续处理。" },
            { id: "search-evidence-first", label: "先找证据", description: "先从项目历史、文档和事项里找依据。" },
            { id: "adjust-scope", label: "调整范围", description: "回到上一步补充澄清回答。" }
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
    title: "R9验收记录来源确认",
    message: "请提供源文件。",
    priority: "high",
    chips: [
      { id: "source-provided", label: "已提供来源", selected: true }
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

  const result = await submitDesktopCuuAction({ client, action: action!, locale: "zh-CN" });

  assert.deepEqual(calls, [
    {
      sessionId: "session-1",
      payload: { selected_option_ids: ["source-provided"] },
      options: { locale: "zh-CN" }
    }
  ]);
  assert.equal(result.message, "下一题：是否按这个方向创建事项？");
  assert.equal(result.card?.title, "是否按这个方向创建事项？");
  assert.doesNotMatch(JSON.stringify(result.card), /Create work item|Find evidence first|Adjust scope/u);
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


// B-R9.6 UX 审计（桌宠死卡）：sync_conflict / budget / skip-plan 卡动作现在有真分派——
// 点了会打到对应端点，而不是掉进裸 anchor 导航。
test("resolveDesktopCuuAction dispatches memory-conflict, budget and skip-plan hrefs", () => {
  const conflict = resolveDesktopCuuAction(
    "/api/memory-conflicts/c1/resolve/discard_both?expected_updated_at=2026-07-03T00%3A00%3A00.000Z"
  );
  assert.deepEqual(conflict, {
    kind: "memory-conflict-resolve",
    conflictId: "c1",
    resolution: "discard_both",
    expectedUpdatedAt: "2026-07-03T00:00:00.000Z"
  });
  // 缺 expected_updated_at 的冲突动作不派发（乐观锁参数是必需品）。
  assert.equal(resolveDesktopCuuAction("/api/memory-conflicts/c1/resolve/keep_current"), undefined);
  assert.deepEqual(resolveDesktopCuuAction("/api/escalations/e1/budget-actions/add_budget"), {
    kind: "budget-decision",
    escalationId: "e1",
    budgetActionId: "add_budget"
  });
  assert.deepEqual(resolveDesktopCuuAction("/api/proposals/p1/skip-plan"), {
    kind: "skip-plan",
    proposalId: "p1"
  });
});

// WIRE-07：进行中 run 卡的「取消执行」此前点了石沉大海——现在 href 能解析、确认后真的打 abort 端点。
test("resolveDesktopCuuAction dispatches the agent-run abort href", () => {
  assert.deepEqual(resolveDesktopCuuAction("/api/agent-runs/run-1/abort", { actionId: "abort_agent_run" }), {
    kind: "abort-agent-run",
    runId: "run-1"
  });
  // revert/replay 等同前缀路径不误判。
  assert.equal(resolveDesktopCuuAction("/api/agent-runs/run-1/revert"), undefined);
});

// C1（桌宠死按钮修复）：spec_ready 工作项卡的「启动」动作（packages/cuu/src/cards.ts 的
// start_agent）此前分发穷举里没有分支，点了既不提交也不导航——现在能解析并真调 startAgentRun。
test("resolveDesktopCuuAction dispatches the spec_ready work item start-agent href", () => {
  assert.deepEqual(resolveDesktopCuuAction("/api/workitems/wi-1/agent-runs", { actionId: "start_agent" }), {
    kind: "start-agent-run",
    workItemId: "wi-1"
  });
  // 评论等同前缀端点不误判。
  assert.equal(resolveDesktopCuuAction("/api/workitems/wi-1/comments"), undefined);
});

test("submitDesktopCuuAction starts an agent run directly for an existing spec_ready work item", async () => {
  const calls: unknown[] = [];
  const run: AgentRunLiveVM = {
    run_id: "10000000-0000-4000-8000-000000000401",
    work_item_id: "wi-1",
    title: "补齐验收要点",
    status: "queued",
    run: {
      id: "10000000-0000-4000-8000-000000000401",
      work_item_id: "wi-1",
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
        reason: "start-agent-run smoke"
      }
    },
    usage: {
      steps_used: 0,
      token_in: 0,
      token_out: 0,
      estimated_cost_cny: "0.00"
    },
    trace: [],
    stream_href: "/api/push/stream/run/10000000-0000-4000-8000-000000000401",
    replay_href: "/api/agent-runs/10000000-0000-4000-8000-000000000401/replay"
  };
  const client = {
    async respondApproval() { throw new Error("unused"); },
    async nextQuestion() { throw new Error("unused"); },
    async searchKnowledge() { throw new Error("unused"); },
    async useEvidenceForWorkItem() { throw new Error("unused"); },
    async startAgentRun(workItemId: string, payload: unknown, options: unknown) {
      calls.push({ workItemId, payload, options });
      return run;
    }
  } as never;

  const action = resolveDesktopCuuAction("/api/workitems/wi-1/agent-runs", { actionId: "start_agent" });
  const result = await submitDesktopCuuAction({ client, action: action!, locale: "zh-CN" });

  assert.deepEqual(calls, [{ workItemId: "wi-1", payload: undefined, options: { locale: "zh-CN" } }]);
  assert.match(result.message, /已启动/u);
  assert.equal(result.card?.payload_ref?.entity_type, "agent_run");
  assert.equal(result.agentRun?.run_id, run.run_id);

  // 没有启动能力的客户端替身要给出人话错误，而不是静默 no-op。
  const noStartClient = {
    async respondApproval() { throw new Error("unused"); },
    async nextQuestion() { throw new Error("unused"); },
    async searchKnowledge() { throw new Error("unused"); },
    async useEvidenceForWorkItem() { throw new Error("unused"); }
  } as never;
  await assert.rejects(
    () => submitDesktopCuuAction({ client: noStartClient, action: action!, locale: "zh-CN" }),
    /缺少启动 AI 执行的客户端能力/u
  );
});

test("decideDesktopCuuAbortConfirmation arms first and executes only on the second click of the same run", () => {
  assert.deepEqual(decideDesktopCuuAbortConfirmation(undefined, "run-1"), { kind: "arm", runId: "run-1" });
  assert.deepEqual(decideDesktopCuuAbortConfirmation("run-1", "run-1"), { kind: "execute", runId: "run-1" });
  // 点了另一个 run → 重新武装那一个，不执行上一个。
  assert.deepEqual(decideDesktopCuuAbortConfirmation("run-1", "run-2"), { kind: "arm", runId: "run-2" });
});

test("submitDesktopCuuAction aborts the run through the client", async () => {
  const calls: string[] = [];
  const client = {
    async respondApproval() { throw new Error("unused"); },
    async nextQuestion() { throw new Error("unused"); },
    async searchKnowledge() { throw new Error("unused"); },
    async useEvidenceForWorkItem() { throw new Error("unused"); },
    async abortAgentRun(runId: string) {
      calls.push(runId);
    }
  } as never;

  const result = await submitDesktopCuuAction({
    client,
    locale: "zh-CN",
    action: { kind: "abort-agent-run", runId: "run-1" }
  });
  assert.deepEqual(calls, ["run-1"]);
  assert.match(result.message, /已中止/u);

  const enResult = await submitDesktopCuuAction({
    client,
    locale: "en-US",
    action: { kind: "abort-agent-run", runId: "run-2" }
  });
  assert.deepEqual(calls, ["run-1", "run-2"]);
  assert.match(enResult.message, /aborted/u);
});

test("submitDesktopCuuAction runs the three new card actions through the client", async () => {
  const calls: unknown[] = [];
  const client = {
    async respondApproval() { throw new Error("unused"); },
    async nextQuestion() { throw new Error("unused"); },
    async searchKnowledge() { throw new Error("unused"); },
    async useEvidenceForWorkItem() { throw new Error("unused"); },
    async resolveMemoryConflict(id: string, payload: unknown) {
      calls.push(["conflict", id, payload]);
      return { conflict: {} };
    },
    async resolveBudgetDecision(id: string, actionId: string) {
      calls.push(["budget", id, actionId]);
      return { attention: { summary_text: "已追加预算，军团继续执行。" } };
    },
    async skipTaskPlanProposal(id: string) {
      calls.push(["skip", id]);
      return { attention: { summary_text: "已改为单个 AI 直接执行。" } };
    }
  } as never;

  const conflictResult = await submitDesktopCuuAction({
    client,
    locale: "zh-CN",
    action: {
      kind: "memory-conflict-resolve",
      conflictId: "c1",
      resolution: "merge_both",
      expectedUpdatedAt: "2026-07-03T00:00:00.000Z"
    }
  });
  assert.match(conflictResult.message, /偏好冲突已处理/u);
  const budgetResult = await submitDesktopCuuAction({
    client,
    locale: "zh-CN",
    action: { kind: "budget-decision", escalationId: "e1", budgetActionId: "add_budget" }
  });
  assert.equal(budgetResult.message, "已追加预算，军团继续执行。");
  const skipResult = await submitDesktopCuuAction({
    client,
    locale: "zh-CN",
    action: { kind: "skip-plan", proposalId: "p1" }
  });
  assert.equal(skipResult.message, "已改为单个 AI 直接执行。");
  assert.deepEqual(calls, [
    ["conflict", "c1", { resolution: "merge_both", expected_updated_at: "2026-07-03T00:00:00.000Z" }],
    ["budget", "e1", "add_budget"],
    ["skip", "p1"]
  ]);
});

// INF-08：SSE 断线重连成功（同一 stream_kind 第二次及以后的 open）要触发一次全量重拉对账——
// 后端不回放断线窗口的事件，不能只靠下一条增量兜底。首连不触发（壳层启动已拉过）。
test("desktop Cuu runtime fires onSseReconnected on stream reconnect, not on first connect", async () => {
  const handlers = new Map<string, (event: DesktopShellEventEnvelope) => void>();
  const listen: DesktopShellListen = (eventName, handler) => {
    handlers.set(eventName, handler);
    return () => {};
  };
  let reconnects = 0;
  const runtime = await bindDesktopShellCuuRuntime({
    listen,
    locale: "zh-CN",
    notify: () => undefined,
    onSseReconnected: () => {
      reconnects += 1;
    }
  });
  const sseStatus = (state: string) => {
    handlers.get("sse-status")?.({
      payload: {
        stream_kind: "me",
        stream_path: "/api/push/stream/me",
        state
      }
    });
  };

  sseStatus("open");
  assert.equal(reconnects, 0, "first connect does not re-pull (the shell just fetched)");
  sseStatus("retrying");
  sseStatus("open");
  assert.equal(reconnects, 1, "a reconnect triggers exactly one full reconciliation");
  sseStatus("open");
  assert.equal(reconnects, 2, "every subsequent reconnect re-pulls");

  await runtime.dispose();
});
