import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
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
  if (!Number.isFinite(ordinal) || ordinal < 36) {
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

console.log("migration audit passed");
