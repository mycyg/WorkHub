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
