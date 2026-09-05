import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  attachMigrationAuditIdlePoolErrorHandler,
  runMigrationAudit,
  type MigrationReplayPlan
} from "../../../scripts/dev/check-migrations.js";
import { captureStderrLines } from "./test-support/capture-stream.js";

async function writeRequiredMigrationAuditSkeleton(root: string) {
  const migrationsDir = path.join(root, "packages", "db", "migrations");
  await mkdir(path.join(migrationsDir, "meta"), { recursive: true });
  for (const file of [
    "packages/db/drizzle.config.ts",
    "packages/db/src/client.ts",
    "packages/db/src/migrate.ts",
    "packages/db/src/types.ts",
    "packages/db/src/locks.ts",
    "packages/db/src/sequences.ts",
    "packages/db/src/seed.ts"
  ]) {
    const fullPath = path.join(root, file);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, "export {};\n", "utf8");
  }
  await writeFile(path.join(migrationsDir, "meta", "_journal.json"), "[]\n", "utf8");
  await writeFile(
    path.join(migrationsDir, "0000_initial.sql"),
    'CREATE TABLE "work_items"(id uuid);\nCREATE TABLE "proposals"(id uuid);\nCREATE TABLE "agent_runs"(id uuid);\nCREATE TABLE "audit_logs"(id uuid, payload jsonb);\n',
    "utf8"
  );
  return migrationsDir;
}

test("migration audit covers R9 migrations starting at 0031", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workhub-migration-audit-"));
  try {
    const migrationsDir = await writeRequiredMigrationAuditSkeleton(root);
    await writeFile(
      path.join(migrationsDir, "0031_bad_r9_migration.sql"),
      'ALTER TABLE "task_plans" ADD COLUMN "workspace_id" uuid;\n',
      "utf8"
    );

    await assert.rejects(
      () => runMigrationAudit({ root }),
      /0031_bad_r9_migration\.sql has non-replay-safe ADD COLUMN/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("migration audit can require a real database replay gate", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workhub-migration-audit-"));
  try {
    await writeRequiredMigrationAuditSkeleton(root);

    await assert.rejects(
      () => runMigrationAudit({ root, requireDatabaseReplay: true }),
      /DATABASE_URL is required for migration replay audit/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("migration audit replays all migrations fresh, then R9 migrations against the existing database", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workhub-migration-audit-"));
  try {
    const migrationsDir = await writeRequiredMigrationAuditSkeleton(root);
    await writeFile(
      path.join(migrationsDir, "0031_r9_replay_safe.sql"),
      'ALTER TABLE "work_items" ADD COLUMN IF NOT EXISTS "workspace_id" uuid;\n',
      "utf8"
    );

    let captured: MigrationReplayPlan | undefined;
    await runMigrationAudit({
      root,
      databaseUrl: "postgresql://workhub:workhub@127.0.0.1:5432/workhub",
      replayDatabaseMigrations: async (plan) => {
        captured = plan;
      }
    });

    assert.deepEqual(captured?.freshMigrationFiles, ["0000_initial.sql", "0031_r9_replay_safe.sql"]);
    assert.deepEqual(captured?.existingDatabaseReplayFiles, ["0031_r9_replay_safe.sql"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("migration audit pools handle forced-cleanup idle client errors without crashing", async () => {
  const pool = new EventEmitter();
  // 捕获且透传（见 @workhub/tools/test-support）：整段替换 process.stderr.write 会吞掉别人的输出。
  const { lines: writes } = await captureStderrLines(async () => {
    attachMigrationAuditIdlePoolErrorHandler(pool, "scratch");

    assert.equal(pool.listenerCount("error"), 1);
    assert.doesNotThrow(() => {
      pool.emit(
        "error",
        Object.assign(new Error("terminating connection due to administrator command"), {
          code: "57P01",
          severity: "FATAL"
        }),
        { processID: 94 }
      );
    });
  });
  assert.match(writes.join(""), /migration_audit_pg_pool_idle_client_error/);
  assert.match(writes.join(""), /57P01/);
  assert.match(writes.join(""), /scratch/);
});
