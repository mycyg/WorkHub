import { randomUUID } from "node:crypto";

import { loadSettings } from "@workhub/config";
import {
  createAgentMemoryRepository,
  createDatabaseClient,
  defaultSeedFixture,
  defaultSeedIds,
  orgs,
  projects,
  runMigrations,
  taskPlanItems,
  taskPlans,
  users,
  workItems,
  workspaces
} from "@workhub/db";

async function ensureDefaultSeed(db: ReturnType<typeof createDatabaseClient>["db"]) {
  await db.insert(orgs).values(defaultSeedFixture.orgs).onConflictDoNothing();
  await db.insert(workspaces).values(defaultSeedFixture.workspaces).onConflictDoNothing();
  await db.insert(users).values(defaultSeedFixture.users).onConflictDoNothing();
}

async function main() {
  const settings = loadSettings(process.env);
  if (settings.appEnv === "production") {
    throw new Error("Refusing to run R9 agent memory PG smoke in production.");
  }

  await runMigrations(settings);
  const client = createDatabaseClient(settings);
  try {
    const db = client.db;
    await ensureDefaultSeed(db);

    const workspaceId = settings.auth.defaultWorkspaceId;
    const userId = defaultSeedIds.adminUserId;
    const projectId = randomUUID();
    const workItemId = randomUUID();
    const planId = randomUUID();
    const itemId = randomUUID();

    await db.insert(projects).values({
      id: projectId,
      workspaceId,
      name: "R9 agent memory PG smoke",
      slug: `r9-memory-${randomUUID().slice(0, 8)}`,
      ownerNickname: "owner",
      ownerUserId: userId
    });
    await db.insert(workItems).values({
      id: workItemId,
      code: `R9-MEM-${randomUUID().slice(0, 8)}`,
      projectId,
      workspaceId,
      submitterUserId: userId,
      title: "R9 agent memory concurrent write smoke",
      rawDescription: "Two workers learn the same preference key concurrently.",
      summaryMd: "R9 agent memory concurrent write smoke.",
      status: "ai_working",
      mode: "worker"
    });
    await db.insert(taskPlans).values({
      id: planId,
      workItemId,
      workspaceId,
      status: "dispatching",
      createdByUserId: userId,
      budgetJson: {},
      decompositionContextJson: { source: "r9-agent-memory-pg-smoke" }
    });
    await db.insert(taskPlanItems).values({
      id: itemId,
      planId,
      seq: 0,
      title: "Concurrent memory item",
      role: "research",
      objectiveMd: "Write the same L1 key from two worker completions.",
      acceptanceMd: "Both learned values are preserved as versions.",
      budgetSharePct: 100,
      dependsOn: [],
      status: "dispatched"
    });

    const repository = createAgentMemoryRepository(db);
    const firstValue = "用户偏好：先给结论。";
    const secondValue = "用户偏好：先给结论，并列证据。";
    const writes = await Promise.allSettled([
      repository.upsertPrivateMemory({
        workspaceId,
        agentContextId: itemId,
        category: "preference",
        key: "reply_style",
        valueMd: firstValue,
        confidence: 0.86
      }),
      repository.upsertPrivateMemory({
        workspaceId,
        agentContextId: itemId,
        category: "preference",
        key: "reply_style",
        valueMd: secondValue,
        confidence: 0.88
      })
    ]);
    const rejected = writes.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (rejected) {
      throw new Error(`Expected concurrent L1 writes to both settle, got rejection: ${String(rejected.reason)}`);
    }

    const rows = (await repository.listPrivateForContext({
      workspaceId,
      agentContextId: itemId,
      limit: 2
    })).rows.filter((memory) => memory.category === "preference" && memory.key === "reply_style");
    if (rows.length !== 1) {
      throw new Error(`Expected one agent_memory row for the concurrent key, got ${rows.length}`);
    }
    const row = rows[0]!;
    const versions = (await repository.listVersions({
      workspaceId,
      memoryId: row.id,
      limit: 5
    })).rows;
    const versionValues = new Set(versions.map((version) => version.valueMd));
    if (row.currentVersion !== 2 || versions.length !== 2 || !versionValues.has(firstValue) || !versionValues.has(secondValue)) {
      throw new Error(`Expected two preserved L1 versions, got ${JSON.stringify({
        currentVersion: row.currentVersion,
        versionCount: versions.length,
        values: [...versionValues]
      })}`);
    }

    console.log(JSON.stringify({
      ok: true,
      agent_memory_id: row.id,
      agent_memory_versions: versions.length,
      current_version: row.currentVersion
    }));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
