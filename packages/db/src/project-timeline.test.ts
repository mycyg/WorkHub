import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import type { WorkItemStatus } from "@workhub/contracts";

import {
  computeBlockingCounts,
  createProjectTimelineRepository,
  TimelineDependencyError,
  wouldCreateDependencyCycle,
  type DependencyEdge
} from "./repositories/project-timeline.js";
import * as schema from "./schema/index.js";
import { orgs, projects, users, workItems, workspaces } from "./schema/index.js";
import { createQueryRecorder, queryRawStrings, queryTextFragments } from "./test-query-recorder.js";

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

function fixtureId(sequence: number) {
  return `79000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

// edge { workItemId: A, dependsOnWorkItemId: B } 表示「A 依赖 B」（B 阻塞 A）。
function edge(workItemId: string, dependsOnWorkItemId: string): DependencyEdge {
  return { workItemId, dependsOnWorkItemId };
}

function openItem(id: string, status: WorkItemStatus = "ai_working") {
  return { id, status };
}

test("wouldCreateDependencyCycle rejects a direct 2-cycle", () => {
  const edges = [edge("A", "B")]; // A 依赖 B
  // 再加 B 依赖 A → B → A 已可达（A 依赖 B 的反面看：从 A 能走到 B，但方向是 forward: A→B）。
  // workItemId=B, dependsOn=A：从 A 出发正向走 A→B，命中 B → 环。
  assert.equal(wouldCreateDependencyCycle(edges, "B", "A"), true);
});

test("wouldCreateDependencyCycle rejects a transitive cycle across a chain", () => {
  const edges = [edge("A", "B"), edge("B", "C")]; // A→B→C
  // 加 C 依赖 A：从 A 正向 A→B→C，命中 C → 环。
  assert.equal(wouldCreateDependencyCycle(edges, "C", "A"), true);
});

test("wouldCreateDependencyCycle allows a redundant forward shortcut", () => {
  const edges = [edge("A", "B"), edge("B", "C")]; // A→B→C
  // 加 A 依赖 C（已经传递依赖 C 的冗余捷径）：从 C 正向无出边，走不到 A → 不成环。
  assert.equal(wouldCreateDependencyCycle(edges, "A", "C"), false);
});

test("wouldCreateDependencyCycle allows an unrelated edge and a fresh root", () => {
  const edges = [edge("A", "B")];
  assert.equal(wouldCreateDependencyCycle(edges, "C", "D"), false);
  // 空图上任何非自依赖边都安全。
  assert.equal(wouldCreateDependencyCycle([], "X", "Y"), false);
});

test("computeBlockingCounts counts direct + transitive downstream along a chain", () => {
  // A→B→C→D（A 依赖 B 依赖 C 依赖 D）。D 阻塞 C/B/A=3，C 阻塞 B/A=2，B 阻塞 A=1，A=0。
  const items = [openItem("A"), openItem("B"), openItem("C"), openItem("D")];
  const edges = [edge("A", "B"), edge("B", "C"), edge("C", "D")];
  const counts = computeBlockingCounts(items, edges);
  assert.equal(counts.get("D"), 3);
  assert.equal(counts.get("C"), 2);
  assert.equal(counts.get("B"), 1);
  assert.equal(counts.get("A"), 0);
});

test("computeBlockingCounts de-duplicates diamond reconvergence", () => {
  // 菱形：A 依赖 B、A 依赖 C；B 依赖 D、C 依赖 D。D 阻塞 B/C/A（A 经两条路只算一次）=3。
  const items = [openItem("A"), openItem("B"), openItem("C"), openItem("D")];
  const edges = [edge("A", "B"), edge("A", "C"), edge("B", "D"), edge("C", "D")];
  const counts = computeBlockingCounts(items, edges);
  assert.equal(counts.get("D"), 3);
  assert.equal(counts.get("B"), 1);
  assert.equal(counts.get("C"), 1);
  assert.equal(counts.get("A"), 0);
});

test("computeBlockingCounts keeps multiple roots independent", () => {
  // 两条不相干的链：A→B 与 C→D。B 阻塞 A=1，D 阻塞 C=1，其余 0。
  const items = [openItem("A"), openItem("B"), openItem("C"), openItem("D")];
  const edges = [edge("A", "B"), edge("C", "D")];
  const counts = computeBlockingCounts(items, edges);
  assert.equal(counts.get("B"), 1);
  assert.equal(counts.get("D"), 1);
  assert.equal(counts.get("A"), 0);
  assert.equal(counts.get("C"), 0);
});

test("computeBlockingCounts excludes finished downstream and skips finished nodes", () => {
  // B 被两件事依赖：A（进行中）和 E（已完成）。已完成的下游不再「等」B，故 B 只阻塞 A=1。
  // 已完成节点自身不出现在结果里（只对未完成项算 blocks_count）。
  const items = [openItem("A"), openItem("B"), { id: "E", status: "done" as WorkItemStatus }];
  const edges = [edge("A", "B"), edge("E", "B")];
  const counts = computeBlockingCounts(items, edges);
  assert.equal(counts.get("B"), 1);
  assert.equal(counts.get("A"), 0);
  assert.equal(counts.has("E"), false);
});

test("computeBlockingCounts ignores edges pointing at unknown (out-of-project) nodes", () => {
  // 边指向图外节点（已删/跨项目残留）：不计入闭包，只在已知节点集合内计数。
  const items = [openItem("A"), openItem("B")];
  const edges = [edge("A", "B"), edge("GHOST", "B")];
  const counts = computeBlockingCounts(items, edges);
  assert.equal(counts.get("B"), 1);
});

test("R20 addDependency takes a project-scoped advisory xact lock before reading edges", async () => {
  // P1-12 回归钉：读边→判环→插边必须先拿项目级 pg_advisory_xact_lock 串行化，否则并发 A→B 与 B→A
  // 各自在旧快照上判无环、双双插入成环。这里用查询记录器断言锁语句存在、键含 projectId、且发生在
  // 读边/插入之前（真并发行为由下方 real-PG 测试盖）。
  const workItemA = fixtureId(1);
  const workItemB = fixtureId(2);
  const projectId = fixtureId(3);
  const scopeRows = [
    { id: workItemA, projectId, deletedAt: null },
    { id: workItemB, projectId, deletedAt: null }
  ];
  const insertedEdge = {
    id: fixtureId(4),
    workItemId: workItemA,
    dependsOnWorkItemId: workItemB,
    createdByUserId: null,
    createdAt: new Date("2026-07-15T00:00:00.000Z")
  };
  // 响应按查询顺序：①scope select ②advisory lock execute ③边 select ④insert returning。
  const { db, queries, transactions } = createQueryRecorder([scopeRows, [], [], [insertedEdge]]);
  const repository = createProjectTimelineRepository(db);

  const result = await repository.addDependency({ workItemId: workItemA, dependsOnWorkItemId: workItemB });
  assert.equal(result.created, true);
  assert.deepEqual(transactions, [{ outcome: "resolved" }]);

  const lockIndex = queries.findIndex((query) => {
    if (query.operation !== "execute") {
      return false;
    }
    return queryTextFragments(query.rawQuery).join("").includes("pg_advisory_xact_lock");
  });
  assert.notEqual(lockIndex, -1, "addDependency 必须执行 pg_advisory_xact_lock");
  const lockQuery = queries[lockIndex]!;
  // 锁键按项目命名空间化：project-dependency:{projectId}（不同项目互不阻塞）。
  // sql 模板里的插值在构建前以裸字符串存于 queryChunks，用 queryRawStrings 提取。
  assert.ok(
    queryRawStrings(lockQuery.rawQuery).includes(`project-dependency:${projectId}`),
    "advisory 锁键必须绑定 projectId"
  );
  // 锁必须先于「读边 select + 插入 insert」——锁后读的图快照才是判环依据。
  const edgeSelectIndex = queries.findIndex(
    (query, index) => index > 0 && query.operation === "select"
  );
  const insertIndex = queries.findIndex((query) => query.operation === "insert");
  assert.ok(lockIndex < edgeSelectIndex, "advisory 锁必须在读依赖边之前");
  assert.ok(lockIndex < insertIndex, "advisory 锁必须在插入依赖边之前");
});

test("R20 addDependency real-PG concurrency keeps the dependency graph acyclic", {
  skip: process.env.WORKHUB_R20_TIMELINE_REAL_PG !== "1",
  timeout: 120_000
}, async () => {
  // P1-12 并发复现：空图上同时提交 A→B 与 B→A。修复前两事务各自在空快照上判无环、双双提交成环；
  // 修复后 advisory 锁把「读边→判环→插边」按项目串行化，恰好一条成功、另一条以 cycle 被拒。
  // 用 EXCLUSIVE 表锁做屏障（允许 SELECT、阻塞 INSERT）：保证两个事务都完成「读边判环」后才放行插入，
  // 修复前必然稳定成环（而非偶发），修复后第二个事务会先卡在 advisory 锁上、放行后重读到新边而拒绝。
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "real-PG 并发测试需要 DATABASE_URL");
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  assert.match(
    databaseName,
    /^workhub_r20_rel3_[a-z0-9_]+$/u,
    "real-PG 并发测试只允许指向专用 workhub_r20_rel3_* 草稿库"
  );

  // 至少 3 个连接：两个并发事务 + 一个屏障/观测连接。
  const pool = new Pool({ connectionString: databaseUrl, max: 4, connectionTimeoutMillis: 10_000 });
  const db = drizzle(pool, { schema });
  try {
    await migrate(db, { migrationsFolder });

    // 全部 fixture 主键/唯一键随机化：同一草稿库上可重复跑（append-only），断言按本轮 projectId 圈定。
    const runTag = randomUUID().slice(0, 8);
    const orgId = randomUUID();
    const workspaceId = randomUUID();
    const projectId = randomUUID();
    const submitterUserId = randomUUID();
    const workItemA = randomUUID();
    const workItemB = randomUUID();

    await db.insert(orgs).values({
      id: orgId,
      name: "R20 Timeline Org",
      slug: `r20-timeline-org-${runTag}`,
      plan: "lan"
    });
    await db.insert(workspaces).values({
      id: workspaceId,
      orgId,
      name: "R20 Timeline Workspace",
      slug: `r20-timeline-workspace-${runTag}`
    });
    await db.insert(users).values({
      id: submitterUserId,
      // nickname 也有部分唯一索引（users_nickname_uq where deleted_at is null），同样按轮次唯一化。
      nickname: `R20 Submitter ${runTag}`,
      cookieToken: `r20-timeline-submitter-${runTag}`,
      isAdmin: false
    });
    await db.insert(projects).values({
      id: projectId,
      workspaceId,
      name: "R20 Timeline Project",
      slug: `r20-timeline-project-${runTag}`,
      ownerNickname: `R20 Submitter ${runTag}`,
      ownerUserId: submitterUserId
    });
    await db.insert(workItems).values([
      {
        id: workItemA,
        code: `R20-DEP-A-${runTag}`,
        projectId,
        workspaceId,
        submitterUserId,
        title: "Dependency race A",
        status: "ai_working"
      },
      {
        id: workItemB,
        code: `R20-DEP-B-${runTag}`,
        projectId,
        workspaceId,
        submitterUserId,
        title: "Dependency race B",
        status: "ai_working"
      }
    ]);

    const repository = createProjectTimelineRepository(db);

    // 屏障连接：EXCLUSIVE 表锁挡住两个事务的 INSERT（SELECT 不受影响），确保并发窗口稳定张开。
    const barrier = await pool.connect();
    let settled: PromiseSettledResult<{ created: boolean }>[];
    try {
      await barrier.query("begin");
      await barrier.query("lock table work_item_dependencies in exclusive mode");

      const racing = Promise.allSettled([
        repository.addDependency({ workItemId: workItemA, dependsOnWorkItemId: workItemB }),
        repository.addDependency({ workItemId: workItemB, dependsOnWorkItemId: workItemA })
      ]);

      // 等两个事务都停在锁等待上（修复前：双双卡在 INSERT 的表锁；修复后：一个卡表锁、一个卡 advisory 锁），
      // 再放开屏障。轮询 pg_stat_activity 而非拍脑袋 sleep，保证时序确定。
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

    const fulfilled = settled.filter((entry) => entry.status === "fulfilled");
    const rejected = settled.filter((entry) => entry.status === "rejected");
    assert.equal(fulfilled.length, 1, "并发 A→B / B→A 必须恰好一条成功");
    assert.equal(rejected.length, 1, "另一条必须被环检测拒绝");
    const failure = (rejected[0] as PromiseRejectedResult).reason;
    assert.ok(failure instanceof TimelineDependencyError, "拒绝原因必须是 TimelineDependencyError");
    assert.equal(failure.code, "cycle");

    // 落库校验：只有一条边，且不存在互为反向的成环边对。
    const edgesInDb = await repository.listDependencyEdgesByProject(projectId);
    assert.equal(edgesInDb.length, 1, "库里必须只有一条依赖边（成环即此断言失败）");
    assert.equal(
      wouldCreateDependencyCycle([], edgesInDb[0]!.workItemId, edgesInDb[0]!.dependsOnWorkItemId),
      false
    );
    const pairs = new Set(edgesInDb.map((entry) => `${entry.workItemId}->${entry.dependsOnWorkItemId}`));
    for (const entry of edgesInDb) {
      assert.equal(
        pairs.has(`${entry.dependsOnWorkItemId}->${entry.workItemId}`),
        false,
        "不允许出现互为反向的成环边对"
      );
    }
  } finally {
    await pool.end();
  }
});
