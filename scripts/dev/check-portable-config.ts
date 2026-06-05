import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { loadSettings } from "../../packages/config/src/index.js";

const forbidden = "/srv/yqgl";
const root = process.cwd();
const scanRoots = ["apps", "packages"];

const settings = loadSettings({});
const serializedSettings = JSON.stringify(settings);

if (serializedSettings.includes(forbidden)) {
  throw new Error(`Default settings must not include ${forbidden}`);
}

if (!settings.databaseUrl.startsWith("postgresql+psycopg://")) {
  throw new Error("DATABASE_URL default must be PostgreSQL-first");
}

function* walk(path: string): Generator<string> {
  for (const entry of readdirSync(path)) {
    const absolute = join(path, entry);
    const stats = statSync(absolute);
    if (stats.isDirectory()) {
      if (["node_modules", "dist", "build", ".git"].includes(entry)) {
        continue;
      }
      yield* walk(absolute);
      continue;
    }
    yield absolute;
  }
}

for (const scanRoot of scanRoots) {
  const absoluteRoot = join(root, scanRoot);
  for (const file of walk(absoluteRoot)) {
    if (!/\.(ts|tsx|js|mjs|cjs)$/.test(file) || /\.(test|spec)\.(ts|tsx|js|mjs|cjs)$/.test(file)) {
      continue;
    }

    const text = readFileSync(file, "utf8");
    if (text.includes(forbidden)) {
      throw new Error(`${relative(root, file)} contains forbidden runtime path ${forbidden}`);
    }
  }
}

console.log("portable config audit passed");
