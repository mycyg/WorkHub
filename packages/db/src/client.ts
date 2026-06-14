import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient, type PoolConfig } from "pg";

import { settings as defaultSettings, type Settings } from "@workhub/config";

import * as schema from "./schema/index.js";
import { normalizeNodePostgresUrl } from "./types.js";

export type WorkHubDb = NodePgDatabase<typeof schema>;

export type WorkHubDatabaseClient = {
  db: WorkHubDb;
  pool: Pool;
  close: () => Promise<void>;
};

function serializePoolError(error: Error) {
  return {
    name: error.name,
    message: error.message,
    ...("code" in error ? { code: (error as Error & { code?: unknown }).code } : {}),
    ...("severity" in error ? { severity: (error as Error & { severity?: unknown }).severity } : {})
  };
}

function handleIdlePoolError(error: Error, client: PoolClient) {
  const processId = (client as PoolClient & { processID?: number }).processID;
  process.stderr.write(`${JSON.stringify({
    ts: new Date().toISOString(),
    level: "warn",
    service: "workhub-db",
    event: "pg_pool_idle_client_error",
    error: serializePoolError(error),
    ...(typeof processId === "number" ? { process_id: processId } : {})
  })}\n`);
}

export function createPgPool(runtimeSettings: Settings = defaultSettings, overrides: PoolConfig = {}) {
  const connectionString = normalizeNodePostgresUrl(runtimeSettings.databaseUrl);

  const pool = new Pool({
    connectionString,
    max: runtimeSettings.db.poolSize + runtimeSettings.db.maxOverflow,
    connectionTimeoutMillis: runtimeSettings.db.poolTimeout * 1000,
    ...overrides
  });

  pool.on("error", handleIdlePoolError);
  return pool;
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

let sharedClient: WorkHubDatabaseClient | undefined;

// 进程内共享单一连接池：各服务以前各自 createDatabaseClient() → 每个一个 pg Pool，
// 一个 API 进程能开 20+ 个池、轻易耗尽 Postgres 连接（M6）。默认 settings 复用同一个；
// 显式传入自定义 settings（测试/多库）时另建，互不影响。共享实例的 close() 故意置空，
// 避免某个服务关掉别人还在用的池。
export function getSharedDatabaseClient(runtimeSettings: Settings = defaultSettings): WorkHubDatabaseClient {
  if (runtimeSettings !== defaultSettings) {
    return createDatabaseClient(runtimeSettings);
  }
  if (!sharedClient) {
    const base = createDatabaseClient(runtimeSettings);
    sharedClient = { db: base.db, pool: base.pool, close: async () => {} };
  }
  return sharedClient;
}

export async function checkDatabaseHealth(db: Pick<WorkHubDb, "execute">) {
  await db.execute(sql`select 1 as ok`);
  return true;
}
