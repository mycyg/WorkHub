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

test("planDdlIntent: an item that jumps straight to overdue only emits overdue (no back-fill of t3d/t1d)", () => {
  // 新建即逾期：现在算出的当前阶梯就是 overdue，只产 overdue 一条（t3d/t1d 的窗口 now 从没落进去）。
  const plan = planDdlIntent(candidate({ claimedByUserId: "u1", dueAt: new Date(now.getTime() - 1 * HOUR) }), now);
  const intent = (plan as { intent: ProactiveIntentInput }).intent;
  assert.equal(intent.stage, "overdue");
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
