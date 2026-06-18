import { createClient } from "redis";

import { settings as defaultSettings, type Settings } from "@workhub/config";
import { checkDatabaseHealth, getSharedDatabaseClient } from "@workhub/db";

/**
 * 深度就绪检查（编排器 readiness probe 用）。
 *
 * 与 /api/health 的存活探针分离：liveness 只确认进程在转、不碰外部依赖；readiness 真打依赖——
 * Postgres（SELECT 1）+ Redis（仅当 BROKER_BACKEND=redis）。每项检查都裹在超时 + try/catch 里，
 * 任何依赖卡死/拒连都不会让探针挂起，最坏在 timeout 后判定为 down。
 */

export type ReadinessCheck = {
  ok: boolean;
  /** 仅 down 时给一行简短原因，便于运维定位；绝不外泄连接串/堆栈。 */
  error?: string;
};

export type ReadinessResult = {
  ready: boolean;
  checks: Record<string, ReadinessCheck>;
};

/** 每项依赖检查的硬超时（毫秒）。可经 READINESS_TIMEOUT_MS 调整（无效/非正值回退默认）。 */
const DEFAULT_READINESS_TIMEOUT_MS = 2_000;

function resolveTimeoutMs(): number {
  const raw = process.env.READINESS_TIMEOUT_MS;
  if (!raw) {
    return DEFAULT_READINESS_TIMEOUT_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_READINESS_TIMEOUT_MS;
}

/** 给任意 promise 套一个超时；超时即 reject，由调用方的 try/catch 收敛为 check.ok=false。 */
async function withTimeout<T>(work: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function shortError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 200);
  }
  return String(error).slice(0, 200);
}

async function checkDatabase(runtimeSettings: Settings, timeoutMs: number): Promise<ReadinessCheck> {
  try {
    const { db } = getSharedDatabaseClient(runtimeSettings);
    await withTimeout(checkDatabaseHealth(db), timeoutMs, "database");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: shortError(error) };
  }
}

async function checkRedis(runtimeSettings: Settings, timeoutMs: number): Promise<ReadinessCheck> {
  const client = createClient({ url: runtimeSettings.broker.url });
  // 防御性：未挂监听的 client 在连接出错时会抛 unhandledRejection；接住即丢，错误已由 race 收敛。
  client.on("error", () => {});
  try {
    await withTimeout(
      (async () => {
        await client.connect();
        await client.ping();
      })(),
      timeoutMs,
      "redis"
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, error: shortError(error) };
  } finally {
    try {
      await client.quit();
    } catch {
      // 连接从未建立时 quit 可能抛——忽略，探针不该因清理失败而报错。
    }
  }
}

export async function checkReadiness(runtimeSettings: Settings = defaultSettings): Promise<ReadinessResult> {
  const timeoutMs = resolveTimeoutMs();
  const checks: Record<string, ReadinessCheck> = {};

  checks.database = await checkDatabase(runtimeSettings, timeoutMs);

  // Redis 仅在被配置为 broker 后端时纳入就绪判定；memory/pg_listen 后端下不依赖 Redis，跳过。
  if (runtimeSettings.broker.backend === "redis" && runtimeSettings.broker.url.length > 0) {
    checks.redis = await checkRedis(runtimeSettings, timeoutMs);
  }

  const ready = Object.values(checks).every((check) => check.ok);
  return { ready, checks };
}
