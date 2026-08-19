import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { TOTAL_RESERVATION_PERIOD_BUCKET, type BudgetScope } from "@workhub/cost";

import { createBudgetReservationRepository } from "./repositories/budget-reservations.js";
import * as schema from "./schema/index.js";
import { agentRuns, budgetReservations, orgs, projects, users, workItems, workspaces } from "./schema/index.js";
import { createQueryRecorder, queryParamValues, queryRawStrings, queryReferences, queryTextFragments } from "./test-query-recorder.js";

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const workspaceId = "00000000-0000-4000-8000-000000000001";
const otherWorkspaceId = "00000000-0000-4000-8000-000000000002";
const runId = "40000000-0000-4000-8000-000000000001";
const leaseExpiresAt = new Date("2026-07-04T00:05:00.000Z");
const teamScope: BudgetScope = { kind: "team", teamId: workspaceId };
const sharedScopeId = "shared-team";

function scopeInput() {
  return {
    scope: teamScope,
    scopeKind: "team" as const,
    scopeId: workspaceId,
    period: "day" as const,
    periodBucket: "2026-07-04",
    capTokens: 100000,
    capCostCny: "10",
    committedTokens: 0,
    committedCostCny: "0",
    estTokens: 1000,
    estCostCny: "0.1"
  };
}

function reservationRow(over: Partial<typeof budgetReservations.$inferSelect> = {}): typeof budgetReservations.$inferSelect {
  return {
    id: "40000000-0000-4000-8000-000000000101",
    runId,
    workspaceId,
    scopeKind: "team",
    scopeId: sharedScopeId,
    period: "day",
    periodBucket: "2026-07-04",
    estTokens: 1000,
    estCostCny: "1",
    actualTokens: 0,
    actualCostCny: "0",
    status: "active",
    leaseExpiresAt,
    createdAt: new Date("2026-07-04T00:00:00.000Z"),
    updatedAt: new Date("2026-07-04T00:00:00.000Z"),
    ...over
  };
}

function outstandingKey(workspace: string) {
  return `${workspace}:team:${sharedScopeId}:2026-07-04`;
}

test("R9.7 budget reservation reserve is bounded by workspace", async () => {
  const { db, queries } = createQueryRecorder([[], [], []]);
  const repository = createBudgetReservationRepository(db);

  await repository.reserve({
    workspaceId,
    runId,
    leaseExpiresAt,
    scopes: [scopeInput()]
  } as Parameters<typeof repository.reserve>[0] & { workspaceId: string });

  const select = queries.find((query) => query.operation === "select");
  assert.ok(queryReferences(select?.where, budgetReservations.workspaceId));
  assert.ok(queryParamValues(select?.where).includes(workspaceId));
  const insert = queries.find((query) => query.operation === "insert");
  const inserted = insert?.valuesValue as Array<Record<string, unknown>> | undefined;
  assert.equal(inserted?.[0]?.["workspaceId"], workspaceId);
});

test("R9.7 budget reservation outstanding reads are bounded by workspace", async () => {
  const { db, queries } = createQueryRecorder([[]]);
  const repository = createBudgetReservationRepository(db);

  await repository.outstandingForScopes([
    {
      workspaceId,
      scopeKind: "team",
      scopeId: workspaceId,
      periodBucket: "2026-07-04"
    }
  ] as Parameters<typeof repository.outstandingForScopes>[0] & Array<{ workspaceId: string }>);

  const select = queries[0];
  assert.equal(select?.operation, "select");
  assert.ok(queryReferences(select?.where, budgetReservations.workspaceId));
  assert.ok(queryParamValues(select?.where).includes(workspaceId));
});

test("R9.7 budget reservation outstanding totals do not cross-count same scope ids across workspaces", async () => {
  const { db } = createQueryRecorder([[
    reservationRow({ workspaceId, estTokens: 1000, estCostCny: "1" }),
    reservationRow({
      id: "40000000-0000-4000-8000-000000000102",
      runId: "40000000-0000-4000-8000-000000000002",
      workspaceId: otherWorkspaceId,
      estTokens: 2500,
      estCostCny: "2.5"
    })
  ]]);
  const repository = createBudgetReservationRepository(db);

  const totals = await repository.outstandingForScopes([
    { workspaceId, scopeKind: "team", scopeId: sharedScopeId, periodBucket: "2026-07-04" },
    { workspaceId: otherWorkspaceId, scopeKind: "team", scopeId: sharedScopeId, periodBucket: "2026-07-04" }
  ]);

  assert.deepEqual(totals.get(outstandingKey(workspaceId)), { tokens: 1000, costCny: "1" });
  assert.deepEqual(totals.get(outstandingKey(otherWorkspaceId)), { tokens: 2500, costCny: "2.5" });
});

test("R9.7 budget reservation reconcile is bounded by workspace and run", async () => {
  const { db, queries } = createQueryRecorder([[{ id: "40000000-0000-4000-8000-000000000201" }]]);
  const repository = createBudgetReservationRepository(db);

  await repository.reconcile(workspaceId, runId, 700, "0.7", new Date("2026-07-04T00:01:00.000Z"));

  const update = queries[0];
  assert.equal(update?.operation, "update");
  assert.ok(queryReferences(update?.where, budgetReservations.workspaceId));
  assert.ok(queryReferences(update?.where, budgetReservations.runId));
  assert.ok(queryParamValues(update?.where).includes(workspaceId));
  assert.ok(queryParamValues(update?.where).includes(runId));
});

test("R9.7 budget reservation lease refresh is bounded by workspace and run", async () => {
  const nextLeaseExpiresAt = new Date("2026-07-04T00:10:00.000Z");
  const { db, queries } = createQueryRecorder([[{ id: "40000000-0000-4000-8000-000000000202" }]]);
  const repository = createBudgetReservationRepository(db);

  await repository.refreshLease(workspaceId, runId, nextLeaseExpiresAt);

  const update = queries[0];
  assert.equal(update?.operation, "update");
  assert.ok(queryReferences(update?.where, budgetReservations.workspaceId));
  assert.ok(queryReferences(update?.where, budgetReservations.runId));
  assert.ok(queryParamValues(update?.where).includes(workspaceId));
  assert.ok(queryParamValues(update?.where).includes(runId));
});

// ── CORE-03：period="total"（军团 task 计划总预算）纳入原子预留 ────────────────────────────
// 此前 buildReserveScopes 只覆盖 day/month，period=total 的 task 策略完全不在预留内：并发子 run 各自在
// decideRunBudget 的旧 committed 快照上判不超、双双起跑，穿透计划总预算。修复后 total scope 用固定桶
// TOTAL_RESERVATION_PERIOD_BUCKET，同一计划的所有子 run 共用同一把 advisory 锁串行化。

function totalTaskScopeInput(taskPlanId: string, over: Record<string, unknown> = {}) {
  return {
    scope: { kind: "task", taskPlanId } as BudgetScope,
    scopeKind: "task" as const,
    scopeId: taskPlanId,
    period: "total" as const,
    periodBucket: TOTAL_RESERVATION_PERIOD_BUCKET,
    capTokens: 200000,
    capCostCny: "10",
    committedTokens: 1000,
    committedCostCny: "0.1",
    estTokens: 120000,
    estCostCny: "1",
    ...over
  };
}

test("CORE-03 reserve covers period=total task scope on the fixed bucket with a serialized advisory lock", async () => {
  const taskPlanId = "81000000-0000-4000-8000-000000000009";
  // 响应按查询顺序：①advisory 锁 execute ②outstanding select ③insert。
  const { db, queries, transactions } = createQueryRecorder([[], [], []]);
  const repository = createBudgetReservationRepository(db);

  const result = await repository.reserve({
    workspaceId,
    runId,
    leaseExpiresAt,
    scopes: [totalTaskScopeInput(taskPlanId)]
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(transactions, [{ outcome: "resolved" }]);
  const lockIndex = queries.findIndex(
    (query) =>
      query.operation === "execute" &&
      queryTextFragments(query.rawQuery).join("").includes("pg_advisory_xact_lock")
  );
  assert.notEqual(lockIndex, -1, "total scope 预留必须先加 advisory 锁");
  assert.ok(
    queryRawStrings(queries[lockIndex]!.rawQuery).includes(
      `budget-reserve:${workspaceId}:task:${taskPlanId}:${TOTAL_RESERVATION_PERIOD_BUCKET}`
    ),
    "total 预留的锁键必须落在固定桶上（同一计划的并发子 run 共用同一把锁）"
  );
  const selectIndex = queries.findIndex((query) => query.operation === "select");
  assert.ok(lockIndex < selectIndex, "advisory 锁必须在读 outstanding 之前");
  const insert = queries.find((query) => query.operation === "insert");
  const inserted = insert?.valuesValue as Array<Record<string, unknown>> | undefined;
  assert.equal(inserted?.[0]?.["period"], "total");
  assert.equal(inserted?.[0]?.["periodBucket"], TOTAL_RESERVATION_PERIOD_BUCKET);
});

test("CORE-03 the serialized loser of a total-budget race is denied by the winner's outstanding reservation", async () => {
  // 并发语义（锁串行化后的输家视角）：赢家已持有 active 预留（est 120000），输家在锁内重读 outstanding
  // 后 committed(1000)+outstanding(120000)+est(120000)=241000 超 cap(200000) → 拒绝且不插任何行。
  const taskPlanId = "81000000-0000-4000-8000-00000000000a";
  const winnerRow = reservationRow({
    scopeKind: "task",
    scopeId: taskPlanId,
    period: "total",
    periodBucket: TOTAL_RESERVATION_PERIOD_BUCKET,
    runId: "40000000-0000-4000-8000-000000000777",
    estTokens: 120000,
    estCostCny: "6"
  });
  const { db, queries } = createQueryRecorder([[], [winnerRow]]);
  const repository = createBudgetReservationRepository(db);

  const result = await repository.reserve({
    workspaceId,
    runId,
    leaseExpiresAt,
    scopes: [totalTaskScopeInput(taskPlanId)]
  });

  assert.deepEqual(result, { ok: false, limitingScope: { kind: "task", taskPlanId }, limit: "tokens" });
  assert.equal(queries.some((query) => query.operation === "insert"), false, "被拒的预留不得插入任何行");
});

test("CORE-03 real-PG concurrent reserve on a total task budget admits exactly one sub-run", {
  skip: process.env.WORKHUB_CORE03_RESERVATION_REAL_PG !== "1",
  timeout: 120_000
}, async () => {
  // 真并发复现：两个子 run 同时起跑同一 task 计划（total 预算 200000，各 est 120000）。
  // 修复前 total 不进预留 → 双双放行穿透计划预算；修复后 advisory 锁把「读 outstanding→判定→插入」
  // 串行化，恰一个 ok、另一个以 tokens 越限被拒。屏障连接用 EXCLUSIVE 表锁挡住 INSERT（SELECT 不受影响），
  // 确保两个事务都进入锁等待后再放行（时序确定，非偶发）。
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "real-PG 并发测试需要 DATABASE_URL");
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  assert.match(
    databaseName,
    /^workhub_core03_[a-z0-9_]+$/u,
    "real-PG 并发测试只允许指向专用 workhub_core03_* 草稿库"
  );

  const pool = new Pool({ connectionString: databaseUrl, max: 4, connectionTimeoutMillis: 10_000 });
  const db = drizzle(pool, { schema });
  try {
    await migrate(db, { migrationsFolder });

    const runTag = randomUUID().slice(0, 8);
    const orgId = randomUUID();
    const pgWorkspaceId = randomUUID();
    const projectId = randomUUID();
    const submitterUserId = randomUUID();
    const workItemId = randomUUID();
    const taskPlanId = randomUUID();
    const runIdA = randomUUID();
    const runIdB = randomUUID();

    await db.insert(orgs).values({ id: orgId, name: "CORE-03 Org", slug: `core03-org-${runTag}`, plan: "lan" });
    await db.insert(workspaces).values({
      id: pgWorkspaceId,
      orgId,
      name: "CORE-03 Workspace",
      slug: `core03-workspace-${runTag}`
    });
    await db.insert(users).values({
      id: submitterUserId,
      nickname: `CORE-03 Submitter ${runTag}`,
      cookieToken: `core03-submitter-${runTag}`,
      isAdmin: false
    });
    await db.insert(projects).values({
      id: projectId,
      workspaceId: pgWorkspaceId,
      name: "CORE-03 Project",
      slug: `core03-project-${runTag}`,
      ownerNickname: `CORE-03 Submitter ${runTag}`,
      ownerUserId: submitterUserId
    });
    await db.insert(workItems).values({
      id: workItemId,
      code: `CORE-03-${runTag}`,
      projectId,
      workspaceId: pgWorkspaceId,
      submitterUserId,
      title: "CORE-03 reservation race",
      status: "ai_working"
    });
    // reservations.run_id 有 FK → agent_runs.id，先落两条 run 行。
    await db.insert(agentRuns).values([
      { id: runIdA, workItemId, mode: "worker", actor: "human", model: "deepseek-v4-flash", maxTurns: 15 },
      { id: runIdB, workItemId, mode: "worker", actor: "human", model: "deepseek-v4-flash", maxTurns: 15 }
    ]);

    const repository = createBudgetReservationRepository(db);
    const scopeInput = (run: string) => ({
      workspaceId: pgWorkspaceId,
      runId: run,
      leaseExpiresAt: new Date(Date.now() + 5 * 60_000),
      scopes: [{
        scope: { kind: "task", taskPlanId } as BudgetScope,
        scopeKind: "task" as const,
        scopeId: taskPlanId,
        period: "total" as const,
        periodBucket: TOTAL_RESERVATION_PERIOD_BUCKET,
        capTokens: 200000,
        capCostCny: "10",
        committedTokens: 0,
        committedCostCny: "0",
        estTokens: 120000,
        estCostCny: "1"
      }]
    });

    const barrier = await pool.connect();
    let settled: PromiseSettledResult<{ ok: boolean }>[];
    try {
      await barrier.query("begin");
      await barrier.query("lock table budget_reservations in exclusive mode");

      const racing = Promise.allSettled([repository.reserve(scopeInput(runIdA)), repository.reserve(scopeInput(runIdB))]);

      // 等两个事务都停在锁等待上（一个卡 INSERT 表锁、一个卡 advisory 锁）再放开屏障。
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const waiting = await barrier.query(
          "select count(*)::int as waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'"
        );
        if ((waiting.rows[0]?.waiting ?? 0) >= 2) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await barrier.query("commit");
      settled = await racing;
    } finally {
      barrier.release();
    }

    assert.equal(settled.every((entry) => entry.status === "fulfilled"), true, "reserve 不得抛错（拒绝走返回值）");
    const outcomes = settled.map((entry) => (entry as PromiseFulfilledResult<{ ok: boolean }>).value);
    assert.equal(outcomes.filter((outcome) => outcome.ok).length, 1, "并发子 run 必须恰好一个预留成功");
    const loser = outcomes.find((outcome) => !outcome.ok) as { ok: false; limitingScope: BudgetScope; limit: string };
    assert.deepEqual(loser.limitingScope, { kind: "task", taskPlanId });
    assert.equal(loser.limit, "tokens");
  } finally {
    await pool.end();
  }
});
