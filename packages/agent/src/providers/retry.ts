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
  error: { status?: number; headers?: { get: (name: string) => string | null } },
  attempt: number,
  options: { maxAttempts?: number; baseDelayMs?: number; now?: Date } = {}
): RetryDecision {
  const maxAttempts = options.maxAttempts ?? 3;
  if (attempt >= maxAttempts) {
    return { retry: false, delayMs: 0, reason: "none" };
  }

  const status = error.status ?? 0;
  const retryAfter = parseRetryAfterMs(error.headers?.get("retry-after"), options.now);
  if (retryAfter !== undefined) {
    return { retry: true, delayMs: retryAfter, reason: "retry_after" };
  }

  if (status === 429 || status >= 500) {
    return {
      retry: true,
      delayMs: (options.baseDelayMs ?? 500) * 2 ** Math.max(0, attempt - 1),
      reason: "transient"
    };
  }

  return { retry: false, delayMs: 0, reason: "none" };
}
