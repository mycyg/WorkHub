import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPLAY_SAFE_MIGRATION_AUDIT_FLOOR = 31;

export type MigrationReplayPlan = {
  root: string;
  migrationsDir: string;
  databaseUrl: string;
  scratchDatabaseName: string;
  freshMigrationFiles: readonly string[];
  existingDatabaseReplayFiles: readonly string[];
};

export type MigrationAuditOptions = {
  root?: string;
  databaseUrl?: string;
  requireDatabaseReplay?: boolean;
  replayDatabaseMigrations?: (plan: MigrationReplayPlan) => Promise<void>;
};

type PgClientLike = {
  query: (sql: string) => Promise<unknown>;
  release: () => void;
};

type PgPoolLike = {
  connect: () => Promise<PgClientLike>;
  end: () => Promise<void>;
};

type PgPoolConstructor = new (options: { connectionString: string; max?: number; connectionTimeoutMillis?: number }) => PgPoolLike;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const absolute = join(dir, entry);
    const stats = statSync(absolute);
    if (stats.isDirectory()) {
      if (["node_modules", "dist", "build", ".git", "migrations"].includes(entry)) {
        continue;
      }
      yield* walk(absolute);
      continue;
    }
    yield absolute;
  }
}

function normalizeAuditPostgresUrl(databaseUrl: string) {
  const trimmed = databaseUrl.trim();
  if (trimmed.startsWith("postgresql+psycopg://")) {
    return `postgresql://${trimmed.slice("postgresql+psycopg://".length)}`;
  }
  if (trimmed.startsWith("postgres+psycopg://")) {
    return `postgres://${trimmed.slice("postgres+psycopg://".length)}`;
  }
  return trimmed;
}

function databaseUrlFor(databaseUrl: string, databaseName: string) {
  const parsed = new URL(normalizeAuditPostgresUrl(databaseUrl));
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error("migration replay audit requires a PostgreSQL DATABASE_URL");
  }
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function loadPgPool(root: string): PgPoolConstructor {
  const requireFromDbPackage = createRequire(join(root, "packages", "db", "package.json"));
  return (requireFromDbPackage("pg") as { Pool: PgPoolConstructor }).Pool;
}

async function executeMigrationFile(client: PgClientLike, migrationsDir: string, file: string, phase: "fresh" | "replay") {
  try {
    await client.query(readFileSync(join(migrationsDir, file), "utf8"));
  } catch (error) {
    throw new Error(`${phase} migration replay failed at ${file}: ${errorMessage(error)}`, { cause: error });
  }
}

async function runPostgresMigrationReplay(plan: MigrationReplayPlan) {
  const Pool = loadPgPool(plan.root);
  const adminPool = new Pool({
    connectionString: databaseUrlFor(plan.databaseUrl, "postgres"),
    max: 1,
    connectionTimeoutMillis: 10_000
  });
  let scratchCreated = false;

  try {
    const adminClient = await adminPool.connect();
    try {
      await adminClient.query(`CREATE DATABASE ${quoteIdentifier(plan.scratchDatabaseName)}`);
      scratchCreated = true;
    } finally {
      adminClient.release();
    }

    const scratchPool = new Pool({
      connectionString: databaseUrlFor(plan.databaseUrl, plan.scratchDatabaseName),
      max: 1,
      connectionTimeoutMillis: 10_000
    });
    try {
      const scratchClient = await scratchPool.connect();
      try {
        for (const file of plan.freshMigrationFiles) {
          await executeMigrationFile(scratchClient, plan.migrationsDir, file, "fresh");
        }
        for (const file of plan.existingDatabaseReplayFiles) {
          await executeMigrationFile(scratchClient, plan.migrationsDir, file, "replay");
        }
      } finally {
        scratchClient.release();
      }
    } finally {
      await scratchPool.end();
    }
  } finally {
    if (scratchCreated) {
      const cleanupClient = await adminPool.connect();
      try {
        await cleanupClient.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(plan.scratchDatabaseName)} WITH (FORCE)`);
      } finally {
        cleanupClient.release();
      }
    }
    await adminPool.end();
  }
}

export async function runMigrationAudit(options: MigrationAuditOptions = {}) {
  const root = options.root ?? process.cwd();
  const migrationsDir = join(root, "packages", "db", "migrations");
  const migrationMeta = join(migrationsDir, "meta", "_journal.json");
  const requiredFiles = [
    join(root, "packages", "db", "drizzle.config.ts"),
    join(root, "packages", "db", "src", "client.ts"),
    join(root, "packages", "db", "src", "migrate.ts"),
    join(root, "packages", "db", "src", "types.ts"),
    join(root, "packages", "db", "src", "locks.ts"),
    join(root, "packages", "db", "src", "sequences.ts"),
    join(root, "packages", "db", "src", "seed.ts"),
    migrationsDir,
    migrationMeta
  ];

  const missing = requiredFiles.filter((path) => !existsSync(path));
  if (missing.length > 0) {
    throw new Error(`F03 migration target paths missing: ${missing.map((path) => relative(root, path)).join(", ")}`);
  }

  const migrationFiles = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
  if (migrationFiles.length === 0) {
    throw new Error("F03 requires at least one Drizzle SQL migration");
  }

  const firstMigration = readFileSync(join(migrationsDir, migrationFiles[0]!), "utf8");
  for (const expected of ['"work_items"', '"proposals"', '"agent_runs"', '"audit_logs"', "jsonb", "uuid"]) {
    if (!firstMigration.includes(expected)) {
      throw new Error(`Initial migration must include ${expected}`);
    }
  }

  for (const migrationFile of migrationFiles) {
    const ordinal = Number.parseInt(migrationFile.slice(0, 4), 10);
    if (!Number.isFinite(ordinal) || ordinal < REPLAY_SAFE_MIGRATION_AUDIT_FLOOR) {
      continue;
    }
    const migrationText = readFileSync(join(migrationsDir, migrationFile), "utf8");
    const statements = migrationText
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean);
    for (const statement of statements) {
      if (/^ALTER\s+TABLE\b[\s\S]*\bADD\s+COLUMN\b/i.test(statement) && !/\bADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\b/i.test(statement)) {
        throw new Error(`${migrationFile} has non-replay-safe ADD COLUMN; use ADD COLUMN IF NOT EXISTS`);
      }
      if (/^CREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(statement) && !/^CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\b/i.test(statement)) {
        throw new Error(`${migrationFile} has non-replay-safe CREATE INDEX; use CREATE INDEX IF NOT EXISTS`);
      }
    }
  }

  const runtimeRoots = ["apps", "packages", "scripts"];
  const forbiddenRuntimeSchemaPatterns = [
    `Base.metadata.${"create_all"}`,
    `ensure_runtime_${"schema"}`,
    `CREATE TABLE IF NOT ${"EXISTS"}`,
    `ALTER ${"TABLE"}`
  ];

  for (const runtimeRoot of runtimeRoots) {
    const absoluteRoot = join(root, runtimeRoot);
    if (!existsSync(absoluteRoot)) {
      continue;
    }

    for (const file of walk(absoluteRoot)) {
      if (!/\.(ts|tsx|js|mjs|cjs)$/.test(file) || /\.(test|spec)\.(ts|tsx|js|mjs|cjs)$/.test(file)) {
        continue;
      }
      const text = readFileSync(file, "utf8");
      for (const pattern of forbiddenRuntimeSchemaPatterns) {
        if (text.includes(pattern)) {
          throw new Error(`${relative(root, file)} contains runtime schema mutation pattern: ${pattern}`);
        }
      }
    }
  }

  const databaseUrl = options.databaseUrl ?? process.env.WORKHUB_MIGRATION_AUDIT_DATABASE_URL ?? process.env.DATABASE_URL;
  const requireDatabaseReplay =
    options.requireDatabaseReplay ?? process.env.WORKHUB_MIGRATION_AUDIT_REQUIRE_DB === "true";
  if (!databaseUrl) {
    if (requireDatabaseReplay) {
      throw new Error("DATABASE_URL is required for migration replay audit");
    }
    return;
  }

  const existingDatabaseReplayFiles = migrationFiles.filter((migrationFile) => {
    const ordinal = Number.parseInt(migrationFile.slice(0, 4), 10);
    return Number.isFinite(ordinal) && ordinal >= REPLAY_SAFE_MIGRATION_AUDIT_FLOOR;
  });
  const replayDatabaseMigrations = options.replayDatabaseMigrations ?? runPostgresMigrationReplay;
  await replayDatabaseMigrations({
    root,
    migrationsDir,
    databaseUrl,
    scratchDatabaseName: `workhub_migration_audit_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
    freshMigrationFiles: migrationFiles,
    existingDatabaseReplayFiles
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await runMigrationAudit();
  console.log("migration audit passed");
}
