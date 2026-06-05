import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { settings as defaultSettings, type Settings } from "@workhub/config";

import { createDatabaseClient } from "./client.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultMigrationsFolder = join(currentDir, "..", "migrations");

export type RunMigrationOptions = {
  migrationsFolder?: string;
};

export async function runMigrations(
  runtimeSettings: Settings = defaultSettings,
  options: RunMigrationOptions = {}
) {
  const client = createDatabaseClient(runtimeSettings);

  try {
    await migrate(client.db, {
      migrationsFolder: options.migrationsFolder ?? defaultMigrationsFolder
    });
  } finally {
    await client.close();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;

if (invokedPath === import.meta.url) {
  await runMigrations();
  console.log("WorkHub database migrations applied");
}
