import assert from "node:assert/strict";
import test from "node:test";

import type { DdlChaseCandidateRow } from "@workhub/db";

import { createDdlChaseService, planDdlIntent } from "./ddl-chase.js";
import type {
  ProactiveDeliverResult,
  ProactiveIntentInput,
  ProactiveQuietHours
} from "./proactive-intents.js";

const HOUR = 60 * 60 * 1000;
const now = new Date("2026-07-15T12:00:00.000Z");

function candidate(over: Partial<DdlChaseCandidateRow> = {}): DdlChaseCandidateRow {
  return {
    workItemId: "wi-1",
    code: "WI-1",
    title: "上线报价单",
    status: "ai_working",
    dueAt: new Date(now.getTime() + 100 * HOUR),
    projectId: "proj-1",
    workspaceId: "ws-1",
    claimedByUserId: null,
    projectOwnerUserId: "owner-1",
    leadUserId: null,
    collaboratorUserId: null,
    ...over
  };
}

// ── planDdlIntent 阶梯边界（纯函数）─────────────────────────────────────────────────────

test("planDdlIntent: due beyond the 72h horizon yields no stage", () => {
  const plan = planDdlIntent(candidate({ claimedByUserId: "u1", dueAt: new Date(now.getTime() + 100 * HOUR) }), now);
  assert.equal(plan.kind, "skip");
});

test("planDdlIntent: T-3d window targets the responsible user at normal severity", () => {
  // due 在 48h 后 → 落在 [due-72h, due-24h) 窗内。
  const plan = planDdlIntent(candidate({ claimedByUserId: "u1", dueAt: new Date(now.getTime() + 48 * HOUR) }), now);
  assert.equal(plan.kind, "intent");
  const intent = (plan as { intent: ProactiveIntentInput }).intent;
  assert.equal(intent.stage, "t3d");
  assert.equal(intent.targetUserId, "u1");
  assert.equal(intent.kind, "ddl_chase");
  assert.equal(intent.notification.severity, "normal");
  assert.equal(intent.notification.type, "work_item.due_soon");
  assert.equal(intent.suppressionKey, "ddl:wi-1:t3d");
  assert.equal(intent.notification.nextRemindAt, undefined);
});

test("planDdlIntent: T-1d window is high severity due_soon to the responsible user", () => {
  const plan = planDdlIntent(candidate({ leadUserId: "lead-1", dueAt: new Date(now.getTime() + 12 * HOUR) }), now);
  const intent = (plan as { intent: ProactiveIntentInput }).intent;
  assert.equal(intent.stage, "t1d");
  assert.equal(intent.targetUserId, "lead-1");
  assert.equal(intent.notification.severity, "high");
  assert.equal(intent.suppressionKey, "ddl:wi-1:t1d");
});

test("planDdlIntent: overdue targets responsible user and seeds the 24h reminder ladder", () => {
  const plan = planDdlIntent(candidate({ claimedByUserId: "u1", dueAt: new Date(now.getTime() - 3 * HOUR) }), now);
  const intent = (plan as { intent: ProactiveIntentInput }).intent;
  assert.equal(intent.stage, "overdue");
  assert.equal(intent.targetUserId, "u1");
  assert.equal(intent.notification.type, "work_item.overdue");
  assert.equal(intent.notification.severity, "high");
  // 只有 overdue 进 24h 提醒阶梯。
  assert.equal(intent.notification.nextRemindAt?.getTime(), now.getTime() + 24 * HOUR);
});

test("planDdlIntent: escalate (overdue +24h) routes to the project owner at urgent severity", () => {
  const plan = planDdlIntent(
    candidate({ claimedByUserId: "u1", projectOwnerUserId: "owner-1", dueAt: new Date(now.getTime() - 30 * HOUR) }),
    now
  );
  const intent = (plan as { intent: ProactiveIntentInput }).intent;
  assert.equal(intent.stage, "escalate");
  // 升级发给项目负责人，不是迟到的责任人。
  assert.equal(intent.targetUserId, "owner-1");
  assert.equal(intent.notification.type, "work_item.escalated_ddl");
  assert.equal(intent.notification.severity, "urgent");
  assert.equal(intent.suppressionKey, "ddl:wi-1:escalate");
});

test("planDdlIntent: escalate falls back to the work-item lead when the project has no owner", () => {
  const plan = planDdlIntent(
    candidate({ claimedByUserId: "u1", projectOwnerUserId: null, leadUserId: "lead-1", dueAt: new Date(now.getTime() - 30 * HOUR) }),
    now
  );
  const intent = (plan as { intent: ProactiveIntentInput }).intent;
  assert.equal(intent.targetUserId, "lead-1");
});

test("planDdlIntent: an unassigned but overdue item becomes a find_owner card to the owner chain", () => {
  const plan = planDdlIntent(
    candidate({ claimedByUserId: null, leadUserId: null, collaboratorUserId: null, projectOwnerUserId: "owner-1", dueAt: new Date(now.getTime() - 5 * HOUR) }),
    now
  );
  const intent = (plan as { intent: ProactiveIntentInput }).intent;
  assert.equal(intent.stage, "needs_owner");
  assert.equal(intent.kind, "find_owner");
  assert.equal(intent.targetUserId, "owner-1");
  assert.equal(intent.notification.type, "work_item.needs_owner");
  assert.equal(intent.suppressionKey, "ddl_card:wi-1");
});

test("planDdlIntent: an unassigned item that is not yet overdue does nothing", () => {
  const plan = planDdlIntent(
    candidate({ claimedByUserId: null, leadUserId: null, collaboratorUserId: null, dueAt: new Date(now.getTime() + 10 * HOUR) }),
    now
  );
  assert.equal(plan.kind, "skip");
});

test("planDdlIntent: escalate with neither owner nor lead has no target", () => {
  const plan = planDdlIntent(
    candidate({ claimedByUserId: "u1", projectOwnerUserId: null, leadUserId: null, dueAt: new Date(now.getTime() - 30 * HOUR) }),
    now
  );
  assert.equal(plan.kind, "no_target");
});

test("planDdlIntent: a max-length work-item title is clamped so the notification title stays within varchar(256)", () => {
  const longTitle = "标".repeat(256); // work_items.title 的上限
  const plan = planDdlIntent(candidate({ claimedByUserId: "u1", title: longTitle, dueAt: new Date(now.getTime() - 3 * HOUR) }), now);
  const intent = (plan as { intent: ProactiveIntentInput }).intent;
  assert.ok(intent.notification.title.length <= 256, "notification title must fit varchar(256)");
  assert.ok(intent.notification.title.endsWith("已逾期"), "suffix preserved after clamping");
});

test("planDdlIntent: an item that jumps straight to overdue only emits overdue (no back-fill of t3d/t1d)", () => {
  // 新建即逾期：现在算出的当前阶梯就是 overdue，只产 overdue 一条（t3d/t1d 的窗口 now 从没落进去）。
  const plan = planDdlIntent(candidate({ claimedByUserId: "u1", dueAt: new Date(now.getTime() - 1 * HOUR) }), now);
  const intent = (plan as { intent: ProactiveIntentInput }).intent;
  assert.equal(intent.stage, "overdue");
});

// ── D2 会话通道路由（planDdlIntent 的 cuuDeliveryEnabled 选项）───────────────────────────

test("planDdlIntent: with Cuu delivery on, t1d routes to the conversation channel with human copy", () => {
  const plan = planDdlIntent(
    candidate({ leadUserId: "lead-1", dueAt: new Date(now.getTime() + 12 * HOUR) }),
    now,
    { cuuDeliveryEnabled: true }
  );
  const intent = (plan as { intent: ProactiveIntentInput }).intent;
  assert.equal(intent.stage, "t1d");
  assert.equal(intent.channel, "conversation_message");
  assert.match(intent.conversationText ?? "", /明天/);
  assert.match(intent.conversationText ?? "", /上线报价单/);
  // notification 草稿仍然保留（供降级路径用）。
  assert.equal(intent.notification.type, "work_item.due_soon");
});

test("planDdlIntent: with Cuu delivery on, overdue routes to conversation and still seeds the notification 24h ladder", () => {
  const plan = planDdlIntent(
    candidate({ claimedByUserId: "u1", dueAt: new Date(now.getTime() - 3 * HOUR) }),
    now,
    { cuuDeliveryEnabled: true }
  );
  const intent = (plan as { intent: ProactiveIntentInput }).intent;
  assert.equal(intent.stage, "overdue");
  assert.equal(intent.channel, "conversation_message");
  assert.match(intent.conversationText ?? "", /逾期/);
  // 「反复叮嘱靠通知侧」：nextRemindAt 仍挂在 notification 草稿上（降级到通知时接 24h 阶梯）。
  assert.equal(intent.notification.nextRemindAt?.getTime(), now.getTime() + 24 * HOUR);
});

test("planDdlIntent: with Cuu delivery on, t3d/escalate stay on the notification channel", () => {
  const t3d = planDdlIntent(
    candidate({ claimedByUserId: "u1", dueAt: new Date(now.getTime() + 48 * HOUR) }),
    now,
    { cuuDeliveryEnabled: true }
  );
  const escalate = planDdlIntent(
    candidate({ claimedByUserId: "u1", projectOwnerUserId: "owner-1", dueAt: new Date(now.getTime() - 30 * HOUR) }),
    now,
    { cuuDeliveryEnabled: true }
  );
  for (const [label, plan] of [["t3d", t3d], ["escalate", escalate]] as const) {
    const intent = (plan as { intent: ProactiveIntentInput }).intent;
    assert.equal(intent.channel, undefined, `${label} must not use a non-notification channel`);
    assert.equal(intent.conversationText, undefined, `${label} carries no conversation copy`);
  }
});

// R15 批 D4b：找人（needs_owner）走 action_card 通道（项目主区插系统 decide 卡），不带会话文案；
// 与会话通道开关无关（找人卡是给项目负责人定夺，非给责任人的 Cuu 私语）。
test("planDdlIntent: needs_owner routes to the action_card channel regardless of the Cuu-delivery flag", () => {
  for (const cuuDeliveryEnabled of [true, false]) {
    const plan = planDdlIntent(
      candidate({ claimedByUserId: null, leadUserId: null, collaboratorUserId: null, projectOwnerUserId: "owner-1", dueAt: new Date(now.getTime() - 5 * HOUR) }),
      now,
      { cuuDeliveryEnabled }
    );
    const intent = (plan as { intent: ProactiveIntentInput }).intent;
    assert.equal(intent.kind, "find_owner");
    assert.equal(intent.channel, "action_card");
    assert.equal(intent.conversationText, undefined, "find-owner card carries no conversation copy");
    // 通知草稿仍在（项目主区不可用时闸内降级用它），标题即卡的 decide 条目标题。
    assert.equal(intent.notification.type, "work_item.needs_owner");
    assert.equal(intent.targetUserId, "owner-1");
  }
});

test("planDdlIntent: with Cuu delivery off, t1d/overdue stay on the notification channel (batch D behaviour)", () => {
  const t1d = planDdlIntent(candidate({ leadUserId: "lead-1", dueAt: new Date(now.getTime() + 12 * HOUR) }), now, { cuuDeliveryEnabled: false });
  const overdue = planDdlIntent(candidate({ claimedByUserId: "u1", dueAt: new Date(now.getTime() - 3 * HOUR) }), now, { cuuDeliveryEnabled: false });
  for (const plan of [t1d, overdue]) {
    const intent = (plan as { intent: ProactiveIntentInput }).intent;
    assert.equal(intent.channel, undefined);
    assert.equal(intent.conversationText, undefined);
  }
});

test("planDdlIntent: the cuuDeliveryEnabled option defaults to off when omitted", () => {
  const plan = planDdlIntent(candidate({ claimedByUserId: "u1", dueAt: new Date(now.getTime() - 3 * HOUR) }), now);
  const intent = (plan as { intent: ProactiveIntentInput }).intent;
  assert.equal(intent.channel, undefined, "omitting the option must not opt into the conversation channel");
});

// ── runOnce 巡检整合 ────────────────────────────────────────────────────────────────────

function recordingProactive(results: ProactiveDeliverResult[] = []) {
  const calls: ProactiveIntentInput[] = [];
  let index = 0;
  return {
    calls,
    proactive: {
      async recordAndDeliver(input: ProactiveIntentInput): Promise<ProactiveDeliverResult> {
        calls.push(input);
        return results[index++] ?? { status: "delivered", intentId: `i-${calls.length}` };
      }
    }
  };
}

const noQuiet: ProactiveQuietHours = null;

test("runOnce delivers one intent per candidate and tallies outcomes", async () => {
  const candidates = [
    candidate({ workItemId: "a", claimedByUserId: "u1", dueAt: new Date(now.getTime() + 48 * HOUR) }),
    candidate({ workItemId: "b", claimedByUserId: "u2", dueAt: new Date(now.getTime() - 3 * HOUR) })
  ];
  const { calls, proactive } = recordingProactive([
    { status: "delivered", intentId: "i1" },
    { status: "suppressed", reason: "daily_cap", intentId: "i2" }
  ]);
  const service = createDdlChaseService({
    listCandidates: async () => candidates,
    proactive,
    quietHours: noQuiet,
    now: () => now
  });
  const result = await service.runOnce();
  assert.equal(result.scanned, 2);
  assert.equal(result.delivered, 1);
  assert.equal(result.suppressed_daily_cap, 1);
  assert.equal(calls.length, 2);
});

test("runOnce during quiet hours records the deferred count and delivers nothing", async () => {
  const candidates = [candidate({ claimedByUserId: "u1", dueAt: new Date(now.getTime() - 3 * HOUR) })];
  const { calls, proactive } = recordingProactive();
  const service = createDdlChaseService({
    listCandidates: async () => candidates,
    proactive,
    // 全时段静默：本 tick 一律不投递，但仍精确计「该产但静默」数。
    quietHours: { startHour: 0, endHour: 23 },
    now: () => new Date(2026, 6, 15, 3, 0)
  });
  const result = await service.runOnce();
  assert.equal(result.skipped_quiet_hours, 1);
  assert.equal(result.delivered, 0);
  assert.equal(calls.length, 0, "quiet hours must not invoke the delivery gate");
});

test("runOnce counts no-stage skips (unassigned, not yet overdue) without delivering", async () => {
  const candidates = [
    candidate({ claimedByUserId: null, leadUserId: null, collaboratorUserId: null, dueAt: new Date(now.getTime() + 10 * HOUR) })
  ];
  const { calls, proactive } = recordingProactive();
  const service = createDdlChaseService({
    listCandidates: async () => candidates,
    proactive,
    quietHours: noQuiet,
    now: () => now
  });
  const result = await service.runOnce();
  assert.equal(result.skipped_no_stage, 1);
  assert.equal(calls.length, 0);
});

test("runOnce counts no-target skips when the owner chain is empty on escalate", async () => {
  const candidates = [
    candidate({ claimedByUserId: "u1", projectOwnerUserId: null, leadUserId: null, dueAt: new Date(now.getTime() - 30 * HOUR) })
  ];
  const { calls, proactive } = recordingProactive();
  const service = createDdlChaseService({
    listCandidates: async () => candidates,
    proactive,
    quietHours: noQuiet,
    now: () => now
  });
  const result = await service.runOnce();
  assert.equal(result.skipped_no_target, 1);
  assert.equal(calls.length, 0);
});

test("runOnce isolates a delivery failure: sibling candidates still process", async () => {
  const candidates = [
    candidate({ workItemId: "a", claimedByUserId: "u1", dueAt: new Date(now.getTime() - 3 * HOUR) }),
    candidate({ workItemId: "b", claimedByUserId: "u2", dueAt: new Date(now.getTime() - 3 * HOUR) })
  ];
  const calls: ProactiveIntentInput[] = [];
  const service = createDdlChaseService({
    listCandidates: async () => candidates,
    proactive: {
      async recordAndDeliver(input) {
        calls.push(input);
        if (input.workItemId === "a") {
          throw new Error("transient");
        }
        return { status: "delivered", intentId: "i2" };
      }
    },
    quietHours: noQuiet,
    now: () => now,
    logger: { info() {}, warn() {} }
  });
  const result = await service.runOnce();
  assert.equal(calls.length, 2, "sibling must still be attempted after a throw");
  assert.equal(result.delivered, 1);
});

test("runOnce with cuuDeliveryEnabled threads the conversation channel onto t1d/overdue intents", async () => {
  const candidates = [
    candidate({ workItemId: "a", claimedByUserId: "u1", dueAt: new Date(now.getTime() + 12 * HOUR) }), // t1d
    candidate({ workItemId: "b", claimedByUserId: "u2", dueAt: new Date(now.getTime() - 3 * HOUR) }),  // overdue
    candidate({ workItemId: "c", claimedByUserId: "u3", dueAt: new Date(now.getTime() + 48 * HOUR) })  // t3d
  ];
  const { calls, proactive } = recordingProactive();
  const service = createDdlChaseService({
    listCandidates: async () => candidates,
    proactive,
    quietHours: noQuiet,
    cuuDeliveryEnabled: true,
    now: () => now
  });
  await service.runOnce();
  const byItem = new Map(calls.map((c) => [c.workItemId, c]));
  assert.equal(byItem.get("a")?.channel, "conversation_message");
  assert.equal(byItem.get("b")?.channel, "conversation_message");
  assert.equal(byItem.get("c")?.channel, undefined, "t3d stays on the notification channel");
});

test("runOnce during quiet hours delivers nothing even for conversation-eligible candidates", async () => {
  // 静默在会话通道同样生效：静默期由扫描前置拦截，任何通道都不投。
  const candidates = [candidate({ claimedByUserId: "u1", dueAt: new Date(now.getTime() - 3 * HOUR) })]; // overdue
  const { calls, proactive } = recordingProactive();
  const service = createDdlChaseService({
    listCandidates: async () => candidates,
    proactive,
    quietHours: { startHour: 0, endHour: 23 },
    cuuDeliveryEnabled: true,
    now: () => new Date(2026, 6, 15, 3, 0)
  });
  const result = await service.runOnce();
  assert.equal(result.skipped_quiet_hours, 1);
  assert.equal(result.delivered, 0);
  assert.equal(calls.length, 0, "quiet hours must gate the conversation channel too");
});
