// R14 真库冒烟的隔离库辅助：以操作者提供的 workhub_r14_*smoke 库为锚（只用来 CREATE/DROP，不写业务数据），
// 每次运行自建唯一命名的 scratch 库，跑完（无论成败）DROP 清理——chat/search 等多个 smoke 互不污染，
// 「固定命中数」类断言不再受运行顺序影响。
// 守卫不降级：production 拒跑 + 锚库命名必须匹配 workhub_r14_*smoke，两条都保留在入口。
import { randomUUID } from "node:crypto";

import { loadSettings } from "@workhub/config";
import { createDatabaseClient } from "@workhub/db";

export type R14SmokeSettings = ReturnType<typeof loadSettings>;

function swapDatabaseName(databaseUrl: string, databaseName: string) {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function createUniqueDatabase(admin: ReturnType<typeof createDatabaseClient>, name: string) {
  // 并发 smoke 同时从 template1 建库会撞「source database is being accessed by other users」——短退避重试。
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await admin.pool.query(`CREATE DATABASE "${name}"`);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw lastError;
}

export async function withR14SmokeDatabase<T>(
  smokeName: string,
  run: (settings: R14SmokeSettings) => Promise<T>
): Promise<T> {
  const anchorSettings = loadSettings(process.env);
  if (anchorSettings.appEnv === "production") {
    throw new Error(`Refusing to run the R14 ${smokeName} smoke in production.`);
  }
  if (!/workhub_r14_[a-z0-9_]*smoke/u.test(anchorSettings.databaseUrl)) {
    throw new Error(`R14 ${smokeName} smoke requires a dedicated workhub_r14_*smoke scratch anchor database.`);
  }
  const uniqueName = `workhub_r14_${smokeName}_smoke_${randomUUID().replace(/-/gu, "").slice(0, 12)}`;
  const admin = createDatabaseClient(anchorSettings);
  try {
    await createUniqueDatabase(admin, uniqueName);
    try {
      const derivedSettings = loadSettings({ ...process.env, DATABASE_URL: swapDatabaseName(anchorSettings.databaseUrl, uniqueName) });
      return await run(derivedSettings);
    } finally {
      // WITH (FORCE)（PG13+）：断言失败时残留连接也不挡清理。
      await admin.pool.query(`DROP DATABASE IF EXISTS "${uniqueName}" WITH (FORCE)`);
    }
  } finally {
    await admin.close();
  }
}
