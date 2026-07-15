import assert from "node:assert/strict";
import test from "node:test";

import type { ActiveCareSignal, FrustrationSignalRow, HighLoadSignalRow, LateNightSignalRow } from "@workhub/db";

import { createCareScanService, localWeekBounds, type CareScanServiceDeps } from "./care-scan.js";
import type { ProactiveDeliverResult, ProactiveIntentInput, ProactiveQuietHours } from "./proactive-intents.js";

const at = new Date("2026-07-15T14:00:00.000Z"); // 周三下午（非静默、非深夜）
const ws = "d0000000-0000-4000-8000-0000000000a1";
const u1 = "d0000000-0000-4000-8000-0000000000b1";
const u2 = "d0000000-0000-4000-8000-0000000000b2";

type Recorded = {
  upserts: Array<{ userId: string; workspaceId: string; signalType: string; confidence: number }>;
  delivered: ProactiveIntentInput[];
};

function makeDeps(over: {
  highLoad?: HighLoadSignalRow[];
  lateNight?: LateNightSignalRow[];
  frustration?: FrustrationSignalRow[];
  active?: ActiveCareSignal[];
  weekly?: Record<string, number>;
  optedOut?: Set<string>;
  quietHours?: ProactiveQuietHours;
  weeklyCap?: number;
  deliverOutcome?: (intent: ProactiveIntentInput) => ProactiveDeliverResult;
}): { deps: CareScanServiceDeps; recorded: Recorded } {
  const recorded: Recorded = { upserts: [], delivered: [] };
  const deps: CareScanServiceDeps = {
    detectHighLoad: async () => over.highLoad ?? [],
    detectLateNight: async () => over.lateNight ?? [],
    detectFrustration: async () => over.frustration ?? [],
    async upsertSignal(input) {
      recorded.upserts.push({ userId: input.userId, workspaceId: input.workspaceId, signalType: input.signalType, confidence: input.confidence });
    },
    listActiveSignals: async () => over.active ?? [],
    countWeeklyCareForUser: async ({ targetUserId }) => over.weekly?.[targetUserId] ?? 0,
    isCareOptedOut: async (userId) => over.optedOut?.has(userId) ?? false,
    proactive: {
      async recordAndDeliver(intent) {
        const outcome = over.deliverOutcome
          ? over.deliverOutcome(intent)
          : ({ status: "delivered", intentId: "intent-1" } as ProactiveDeliverResult);
        if (outcome.status === "delivered") {
          recorded.delivered.push(intent);
        }
        return outcome;
      }
    },
    quietHours: over.quietHours ?? null,
    weeklyCap: over.weeklyCap ?? 2,
    highLoadThreshold: 8,
    lateNightMinNights: 3,
    frustrationThreshold: 2,
    now: () => at
  };
  return { deps, recorded };
}

function signal(over: Partial<ActiveCareSignal> = {}): ActiveCareSignal {
  return { userId: u1, workspaceId: ws, signalType: "high_load", confidence: 0.7, updatedAt: at, ...over };
}

// ── F1：侦测 → upsert ───────────────────────────────────────────────────────────────────

test("care-scan F1: detected signals are upserted (memory write source), counted in signals_detected", async () => {
  const { deps, recorded } = makeDeps({
    highLoad: [{ workspaceId: ws, userId: u1, openCount: 9, overdueCount: 2 }],
    lateNight: [{ workspaceId: ws, userId: u2, nightCount: 4 }],
    frustration: [{ workspaceId: ws, userId: u1, rejectionCount: 3 }]
  });
  const result = await createCareScanService(deps).runOnce();
  assert.equal(result.signals_detected, 3);
  assert.deepEqual(
    recorded.upserts.map((u) => `${u.userId}:${u.signalType}`).sort(),
    [`${u1}:frustration`, `${u1}:high_load`, `${u2}:late_night`]
  );
  // confidence 随信号强度抬高、封顶 0.9。
  assert.ok(recorded.upserts.every((u) => u.confidence >= 0.5 && u.confidence <= 0.9));
});

// ── F2：活跃信号 → care intent（形状）─────────────────────────────────────────────────────

test("care-scan F2: builds a conversation-channel care intent with no project/work-item and no notification degrade", async () => {
  const { deps, recorded } = makeDeps({ active: [signal()] });
  const result = await createCareScanService(deps).runOnce();
  assert.equal(result.delivered, 1);
  const intent = recorded.delivered[0]!;
  assert.equal(intent.kind, "care");
  assert.equal(intent.stage, "high_load");
  assert.equal(intent.channel, "conversation_message");
  assert.equal(intent.degradeToNotification, false, "care must never degrade to a system notification");
  assert.equal(intent.projectId, null);
  assert.equal(intent.workItemId, null);
  assert.equal(intent.targetUserId, u1);
  assert.ok(typeof intent.conversationText === "string" && intent.conversationText.length > 0);
  // suppression_key 含本周键（同人同类型一周至多一次）。
  const week = localWeekBounds(at);
  assert.equal(intent.suppressionKey, `care:${u1}:high_load:${week.key}`);
});

// ── 周频总闸 ──────────────────────────────────────────────────────────────────────────────

test("care-scan weekly cap: a user already at the weekly cap is suppressed before delivery", async () => {
  const { deps, recorded } = makeDeps({ active: [signal()], weekly: { [u1]: 2 }, weeklyCap: 2 });
  const result = await createCareScanService(deps).runOnce();
  assert.equal(result.delivered, 0);
  assert.equal(result.suppressed_weekly_cap, 1);
  assert.equal(recorded.delivered.length, 0);
});

test("care-scan weekly cap: in-tick tally increments so a 3rd signal for the same user is capped within one tick", async () => {
  const { deps, recorded } = makeDeps({
    // 同一用户三类信号都活跃；weeklyCap=2 → 只投前 2，第 3 条被本 tick 内自增的计数挡下。
    active: [
      signal({ signalType: "high_load" }),
      signal({ signalType: "late_night" }),
      signal({ signalType: "frustration" })
    ],
    weekly: { [u1]: 0 },
    weeklyCap: 2
  });
  const result = await createCareScanService(deps).runOnce();
  assert.equal(result.delivered, 2);
  assert.equal(result.suppressed_weekly_cap, 1);
  assert.equal(recorded.delivered.length, 2);
});

// ── opt-out ───────────────────────────────────────────────────────────────────────────────

test("care-scan opt-out: an opted-out user is skipped entirely (no delivery, counted skipped_opted_out)", async () => {
  const { deps, recorded } = makeDeps({
    active: [signal({ userId: u1 }), signal({ userId: u2, signalType: "late_night" })],
    optedOut: new Set([u1])
  });
  const result = await createCareScanService(deps).runOnce();
  assert.equal(result.skipped_opted_out, 1);
  assert.equal(result.delivered, 1);
  assert.deepEqual(recorded.delivered.map((i) => i.targetUserId), [u2]);
});

// ── 静默时段 ────────────────────────────────────────────────────────────────────────────────

test("care-scan quiet hours: F1 signals still refresh but no intent is produced (deferred)", async () => {
  const quietAt = new Date(2026, 6, 15, 2, 0); // 本地凌晨 2 点，落在 22-08 静默窗
  const { deps, recorded } = makeDeps({
    highLoad: [{ workspaceId: ws, userId: u1, openCount: 9, overdueCount: 2 }],
    active: [signal()],
    quietHours: { startHour: 22, endHour: 8 }
  });
  deps.now = () => quietAt;
  const result = await createCareScanService(deps).runOnce();
  assert.equal(result.signals_detected, 1, "F1 bookkeeping runs even during quiet hours");
  assert.equal(result.skipped_quiet_hours, 1);
  assert.equal(result.delivered, 0);
  assert.equal(recorded.delivered.length, 0);
});

// ── 个人空间缺失（不降级）────────────────────────────────────────────────────────────────────

test("care-scan tallies no_personal_space suppression without degrading to a notification", async () => {
  const { deps, recorded } = makeDeps({
    active: [signal()],
    deliverOutcome: () => ({ status: "suppressed", reason: "no_personal_space", intentId: "intent-1" })
  });
  const result = await createCareScanService(deps).runOnce();
  assert.equal(result.delivered, 0);
  assert.equal(result.suppressed_no_personal_space, 1);
  assert.equal(recorded.delivered.length, 0);
});

// ── localWeekBounds ─────────────────────────────────────────────────────────────────────────

test("localWeekBounds spans Monday 00:00 to next Monday 00:00 with a stable week key", () => {
  const wed = new Date(2026, 6, 15, 14, 0); // 周三
  const bounds = localWeekBounds(wed);
  assert.equal(bounds.from.getDay(), 1, "week starts on Monday");
  assert.equal(bounds.from.getHours(), 0);
  assert.equal(bounds.to.getTime() - bounds.from.getTime(), 7 * 24 * 60 * 60 * 1000);
  assert.equal(bounds.key, "20260713"); // 2026-07-13 是那一周的周一
  // 同一周内不同天算出同一个周键（周频闸稳定）。
  assert.equal(localWeekBounds(new Date(2026, 6, 17, 23, 0)).key, bounds.key);
});
