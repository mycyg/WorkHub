import assert from "node:assert/strict";
import test from "node:test";

import {
  CARE_SIGNAL_CATEGORY,
  detectFrustrationSignals,
  detectHighLoadSignals,
  detectLateNightSignals,
  listActiveCareSignals,
  upsertCareSignal
} from "./repositories/care-signals.js";
import {
  countDeliveredCareIntentsForUser
} from "./repositories/proactive-intents.js";
import { createQueryRecorder, queryParamValues } from "./test-query-recorder.js";

const now = new Date("2026-07-15T12:00:00.000Z");
const ws = "84000000-0000-4000-8000-0000000000a1";
const u1 = "84000000-0000-4000-8000-0000000000b1";
const u2 = "84000000-0000-4000-8000-0000000000b2";

// ── upsertCareSignal（幂等）─────────────────────────────────────────────────────────────

test("upsertCareSignal inserts a fresh signal with a 14d expiry when none exists", async () => {
  const { db, queries } = createQueryRecorder([[], []]);
  await upsertCareSignal(db, {
    userId: u1,
    workspaceId: ws,
    signalType: "high_load",
    valueMd: "负责的未完成工作项 9 件，其中 2 件已逾期。",
    confidence: 0.7,
    now
  });
  // 先查既有（select），未命中 → 插入（insert）。
  assert.equal(queries[0]?.operation, "select");
  assert.equal(queries[1]?.operation, "insert");
  const inserted = queries[1]?.valuesValue as Record<string, unknown>;
  assert.equal(inserted["category"], CARE_SIGNAL_CATEGORY);
  assert.equal(inserted["key"], "high_load");
  assert.equal(inserted["confidence"], 0.7);
  const expiresAt = inserted["expiresAt"] as Date;
  assert.equal(expiresAt.getTime(), now.getTime() + 14 * 24 * 60 * 60 * 1000);
  // 幂等约束兜底：撞局部唯一索引不 500。
  assert.equal(queries[1]?.steps.includes("onConflictDoNothing"), true);
});

test("upsertCareSignal updates the existing row in place (idempotent by user+key), not a second row", async () => {
  const { db, queries } = createQueryRecorder([[{ id: "mem-1" }], []]);
  await upsertCareSignal(db, {
    userId: u1,
    workspaceId: ws,
    signalType: "late_night",
    valueMd: "近 7 天 4 个夜晚有活动。",
    confidence: 0.6,
    now,
    ttlMs: 1000
  });
  assert.equal(queries[0]?.operation, "select");
  assert.equal(queries[1]?.operation, "update", "existing row is updated, not inserted");
  const set = queries[1]?.setValue as Record<string, unknown>;
  assert.equal(set["confidence"], 0.6);
  assert.equal((set["expiresAt"] as Date).getTime(), now.getTime() + 1000);
  assert.equal((set["updatedAt"] as Date).getTime(), now.getTime());
});

// ── listActiveCareSignals ────────────────────────────────────────────────────────────────

test("listActiveCareSignals maps rows to typed signals and drops unknown keys / null workspace", async () => {
  const { db, queries } = createQueryRecorder([[
    { userId: u1, workspaceId: ws, key: "high_load", confidence: 0.7, updatedAt: now },
    { userId: u2, workspaceId: ws, key: "frustration", confidence: 0.8, updatedAt: now },
    { userId: u2, workspaceId: null, key: "late_night", confidence: 0.5, updatedAt: now },
    { userId: u1, workspaceId: ws, key: "some_other_thing", confidence: 0.9, updatedAt: now }
  ]]);
  const signals = await listActiveCareSignals(db, { now, limit: 500 });
  assert.deepEqual(signals.map((s) => `${s.userId}:${s.signalType}`), [`${u1}:high_load`, `${u2}:frustration`]);
  // 只认 care_signal 分类、未过期（expires_at > now）——param 里应带 now 作过期下界。
  assert.equal(queryParamValues(queries[0]?.where).some((v) => v === CARE_SIGNAL_CATEGORY), true);
});

// ── detectHighLoadSignals（责任人 = 认领 > lead > 协作者；≥threshold 且含逾期）─────────────

test("detectHighLoadSignals emits only responsible users at/over the threshold that also have an overdue item", async () => {
  const past = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const future = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const { db } = createQueryRecorder([
    [
      // u1: 认领两件，其一逾期 → open=2>=2, overdue=1 → 命中。
      { workItemId: "wi1", dueAt: past, workItemWorkspaceId: ws, projectWorkspaceId: ws, claimedByUserId: u1 },
      { workItemId: "wi2", dueAt: future, workItemWorkspaceId: ws, projectWorkspaceId: ws, claimedByUserId: u1 },
      // u2: 仅 lead 一件且逾期 → open=1 < 2 → 不命中。
      { workItemId: "wi3", dueAt: past, workItemWorkspaceId: ws, projectWorkspaceId: ws, claimedByUserId: null },
      // 无责任人（无认领无指派）→ 忽略。
      { workItemId: "wi4", dueAt: past, workItemWorkspaceId: ws, projectWorkspaceId: ws, claimedByUserId: null }
    ],
    [
      { workItemId: "wi3", userId: u2, role: "lead" }
      // wi4 无任何指派。
    ]
  ]);
  const rows = await detectHighLoadSignals(db, { now, threshold: 2, limit: 5000 });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { workspaceId: ws, userId: u1, openCount: 2, overdueCount: 1 });
});

test("detectHighLoadSignals does not emit a heavily-loaded user with zero overdue items", async () => {
  const future = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
  const { db } = createQueryRecorder([
    [
      { workItemId: "wi1", dueAt: future, workItemWorkspaceId: ws, projectWorkspaceId: ws, claimedByUserId: u1 },
      { workItemId: "wi2", dueAt: future, workItemWorkspaceId: ws, projectWorkspaceId: ws, claimedByUserId: u1 },
      { workItemId: "wi3", dueAt: null, workItemWorkspaceId: ws, projectWorkspaceId: ws, claimedByUserId: u1 }
    ],
    []
  ]);
  const rows = await detectHighLoadSignals(db, { now, threshold: 2, limit: 5000 });
  assert.equal(rows.length, 0, "high load requires at least one overdue item");
});

// ── detectLateNightSignals（≥minNights 个不同深夜日历日）──────────────────────────────────

test("detectLateNightSignals counts distinct late-night calendar days and applies the minNights floor", async () => {
  const { db } = createQueryRecorder([[
    // u1: 3 个不同日历日的深夜活动（含同日两条只算一晚）→ 命中 minNights=3。
    { workspaceId: ws, actorUserId: u1, createdAt: new Date(2026, 6, 10, 23, 30) },
    { workspaceId: ws, actorUserId: u1, createdAt: new Date(2026, 6, 11, 1, 15) },
    { workspaceId: ws, actorUserId: u1, createdAt: new Date(2026, 6, 11, 2, 40) },
    { workspaceId: ws, actorUserId: u1, createdAt: new Date(2026, 6, 13, 0, 5) },
    // 白天活动不算深夜。
    { workspaceId: ws, actorUserId: u1, createdAt: new Date(2026, 6, 14, 14, 0) },
    // u2: 仅 2 个深夜日 → 不命中。
    { workspaceId: ws, actorUserId: u2, createdAt: new Date(2026, 6, 10, 23, 30) },
    { workspaceId: ws, actorUserId: u2, createdAt: new Date(2026, 6, 12, 3, 0) }
  ]]);
  const rows = await detectLateNightSignals(db, { now, windowDays: 7, minNights: 3, limit: 5000 });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { workspaceId: ws, userId: u1, nightCount: 3 });
});

// ── detectFrustrationSignals（近 7 天提案被打回 ≥threshold；reviews.decision='reject'）──────

test("detectFrustrationSignals maps grouped rows and filters on decision='reject'", async () => {
  const { db, queries } = createQueryRecorder([[
    { workspaceId: ws, userId: u1, rejectionCount: 3 },
    { workspaceId: ws, userId: null, rejectionCount: 5 } // 匿名/AI 无发起人 → 丢弃。
  ]]);
  const rows = await detectFrustrationSignals(db, { now, windowDays: 7, threshold: 2 });
  assert.deepEqual(rows, [{ workspaceId: ws, userId: u1, rejectionCount: 3 }]);
  // 打回在 reviews 表统一存 'reject'（service 层叫 request_changes）——闸必须查 'reject'。
  const params = queryParamValues(queries[0]?.where);
  assert.equal(params.some((v) => v === "reject"), true, "must filter reviews.decision = 'reject'");
});

// ── countDeliveredCareIntentsForUser（周频闸计数源）────────────────────────────────────────

test("countDeliveredCareIntentsForUser counts only delivered care intents in the window", async () => {
  const { db, queries } = createQueryRecorder([[{ value: 2 }]]);
  const from = new Date(2026, 6, 13, 0, 0, 0);
  const to = new Date(2026, 6, 20, 0, 0, 0);
  const count = await countDeliveredCareIntentsForUser(db, { targetUserId: u1, from, to });
  assert.equal(count, 2);
  const params = queryParamValues(queries[0]?.where);
  assert.equal(params.some((v) => v === "care"), true, "kind must be 'care'");
  assert.equal(params.some((v) => v === "delivered"), true, "status must be 'delivered'");
});
