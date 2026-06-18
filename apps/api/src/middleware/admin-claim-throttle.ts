// 管理员认领限流（审计高危：/identify 的 ADMIN_CLAIM_SECRET 此前可无限次在线猜测）。
// 进程内滑动窗口 + 临时锁定：S1 是单机 LAN 单进程部署，进程内计数即足够；多租户/多实例
// 部署应换成共享存储（Redis）后端，但那不在 pilot 范围内（见 DEPLOY.md / phasing P5）。
// 仅对「需要校验管理员口令」的请求计数，普通昵称登录（LAN 信任模式）不受影响。

export type AdminClaimThrottleResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export type AdminClaimThrottle = {
  /** 当前 key 是否仍在锁定窗口内。 */
  check: (key: string) => AdminClaimThrottleResult;
  /** 记一次失败（口令错误）。达到阈值即进入锁定。 */
  recordFailure: (key: string) => void;
  /** 口令正确：清空该 key 的失败记录与锁定。 */
  recordSuccess: (key: string) => void;
};

type Bucket = {
  failures: number[];
  lockedUntil?: number;
};

export type AdminClaimThrottleOptions = {
  maxFailures?: number;
  windowMs?: number;
  lockoutMs?: number;
  now?: () => number;
};

export function createAdminClaimThrottle(options: AdminClaimThrottleOptions = {}): AdminClaimThrottle {
  const maxFailures = Math.max(1, options.maxFailures ?? 8);
  const windowMs = Math.max(1, options.windowMs ?? 10 * 60 * 1000);
  const lockoutMs = Math.max(1, options.lockoutMs ?? 15 * 60 * 1000);
  const now = options.now ?? (() => Date.now());
  const buckets = new Map<string, Bucket>();

  function recentFailures(bucket: Bucket, at: number) {
    return bucket.failures.filter((ts) => at - ts < windowMs);
  }

  return {
    check(key) {
      const at = now();
      const bucket = buckets.get(key);
      if (bucket?.lockedUntil && bucket.lockedUntil > at) {
        return { allowed: false, retryAfterSeconds: Math.ceil((bucket.lockedUntil - at) / 1000) };
      }
      return { allowed: true, retryAfterSeconds: 0 };
    },

    recordFailure(key) {
      const at = now();
      const bucket = buckets.get(key) ?? { failures: [] };
      const failures = recentFailures(bucket, at);
      failures.push(at);
      if (failures.length >= maxFailures) {
        buckets.set(key, { failures: [], lockedUntil: at + lockoutMs });
        return;
      }
      buckets.set(key, { failures });
    },

    recordSuccess(key) {
      buckets.delete(key);
    }
  };
}

// 审计修复：默认 key 是常量 "global" 桶——绝不信任客户端可伪造的 X-Forwarded-For / x-real-ip。
// 之前用 XFF 首跳作 key，攻击者只需每次请求换一个 XFF 值即可让每次猜测落入不同桶、彻底绕过锁定。
// S1 是单进程 LAN pilot，本就没有可信反代终结连接，全局桶恰好限制对「共享」管理员口令的在线暴力猜测
// （口令全局唯一，无需按客户端区分）。仅当确实部署在可信反代之后（且配置了受信代理白名单/跳数）
// 时，XFF 才可信——届时传 trustedProxy=true 才会启用按客户端 IP 分桶；默认 LAN 模型下一律 "global"。
export function adminClaimClientKey(
  headers: {
    get: (name: string) => string | null | undefined;
  },
  options: { trustedProxy?: boolean } = {}
): string {
  if (!options.trustedProxy) {
    return "global";
  }
  // 仅在显式配置了可信反代时才信任转发头（当前 LAN pilot 不会进到这里）。
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }
  const real = headers.get("x-real-ip")?.trim();
  if (real) {
    return real;
  }
  return "global";
}
