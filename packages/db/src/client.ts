import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

import { settings as defaultSettings, type Settings } from "@workhub/config";

import * as schema from "./schema/index.js";
import { normalizeNodePostgresUrl } from "./types.js";

export type WorkHubDb = NodePgDatabase<typeof schema>;

export type WorkHubDatabaseClient = {
  db: WorkHubDb;
  pool: Pool;
  close: () => Promise<void>;
};

export function createPgPool(runtimeSettings: Settings = defaultSettings, overrides: PoolConfig = {}) {
  const connectionString = normalizeNodePostgresUrl(runtimeSettings.databaseUrl);

  return new Pool({
    connectionString,
    max: runtimeSettings.db.poolSize + runtimeSettings.db.maxOverflow,
    connectionTimeoutMillis: runtimeSettings.db.poolTimeout * 1000,
    ...overrides
  });
}

export function createDatabaseClient(
  runtimeSettings: Settings = defaultSettings,
  existingPool?: Pool
): WorkHubDatabaseClient {
  const pool = existingPool ?? createPgPool(runtimeSettings);
  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    close: () => pool.end()
  };
}

export async function checkDatabaseHealth(db: Pick<WorkHubDb, "execute">) {
  await db.execute(sql`select 1 as ok`);
  return true;
}
