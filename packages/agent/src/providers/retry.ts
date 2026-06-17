export type RetryDecision = {
  retry: boolean;
  delayMs: number;
  reason: "retry_after" | "transient" | "none";
};

export function parseRetryAfterMs(value: string | null | undefined, now = new Date()) {
  if (!value) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - now.getTime());
  }
  return undefined;
}

export function nextRetryDecision(
  error: { status?: number; headers?: { get: (name: string) => string | null }; message?: string; code?: string; cause?: unknown },
  attempt: number,
  options: { maxAttempts?: number; baseDelayMs?: number; maxDelayMs?: number; now?: Date } = {}
): RetryDecision {
  const maxAttempts = options.maxAttempts ?? 3;
  // findings[#49]：钳住重试延迟上限。Retry-After 由（可能恶意/异常的）上游控制且无上界——
  // 一个 `Retry-After: 86400` 就能把 worker 在单次重试上 park 24 小时，而 totalTimeoutSeconds 只在
  // 循环顶部检查、sleep 期间无法打断。退避指数增长也可能膨胀过大。两条分支都钳到 maxDelayMs。
  const clampDelay = (ms: number) => (options.maxDelayMs !== undefined ? Math.min(ms, options.maxDelayMs) : ms);
  if (attempt >= maxAttempts) {
    return { retry: false, delayMs: 0, reason: "none" };
  }

  const status = error.status ?? 0;
  const networkMessage = [
    error.message,
    error.code,
    error.cause instanceof Error ? error.cause.message : undefined
  ].filter(Boolean).join(" ");
  const isNetworkError = status === 0
    && /\b(fetch failed|terminated|econnreset|econnrefused|etimedout|enotfound|network)\b/iu.test(networkMessage);
  const isRetryableStatus = status === 429 || status >= 500;
  if (!isRetryableStatus && !isNetworkError) {
    // L#62：非可重试状态（4xx，鉴权/参数错误等）即便带 Retry-After 也不重试——
    // 否则恶意/异常上游用一个 4xx + Retry-After 就能逼客户端反复重打。
    return { retry: false, delayMs: 0, reason: "none" };
  }

  const retryAfter = parseRetryAfterMs(error.headers?.get("retry-after"), options.now);
  if (retryAfter !== undefined) {
    return { retry: true, delayMs: clampDelay(retryAfter), reason: "retry_after" };
  }

  // L#67：退避按 2**attempt 增长（attempt 是已失败次数，从 0 起），
  // 这样第一次、第二次、第三次重试分别是 base×1 / ×2 / ×4，而不是前两次都等于 base。
  return {
    retry: true,
    delayMs: clampDelay((options.baseDelayMs ?? 500) * 2 ** attempt),
    reason: "transient"
  };
}
