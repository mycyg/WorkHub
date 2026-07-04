import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runMigrationAudit } from "../../../scripts/dev/check-migrations.js";

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

    assert.throws(
      () => runMigrationAudit({ root }),
      /0031_bad_r9_migration\.sql has non-replay-safe ADD COLUMN/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
