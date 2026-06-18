import { randomUUID } from "node:crypto";

import type { MiddlewareHandler } from "hono";

export type LogLevel = "info" | "warn" | "error";
export type LogFormat = "json" | "pretty";

export type StructuredLogger = {
  info: (event: string, fields?: Record<string, unknown>) => void;
  warn: (event: string, fields?: Record<string, unknown>) => void;
  error: (event: string, fields?: Record<string, unknown>) => void;
};

function serializeError(value: unknown) {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(value.stack ? { stack: value.stack.split("\n").slice(0, 6).join("\n") } : {})
    };
  }
  return { message: String(value) };
}

function normalizeFields(fields: Record<string, unknown> | undefined) {
  if (!fields) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      value instanceof Error ? serializeError(value) : value
    ])
  );
}

export function createStructuredLogger(input: {
  format?: LogFormat;
  service?: string;
  write?: (line: string) => void;
  now?: () => Date;
} = {}): StructuredLogger {
  const format = input.format ?? "json";
  const service = input.service ?? "workhub-api";
  const write = input.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = input.now ?? (() => new Date());

  function log(level: LogLevel, event: string, fields?: Record<string, unknown>) {
    const normalized = normalizeFields(fields);
    if (format === "pretty") {
      const extra = Object.entries(normalized)
        .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
        .join(" ");
      write(`${now().toISOString()} ${level.toUpperCase().padEnd(5)} ${event}${extra ? ` ${extra}` : ""}`);
      return;
    }
    write(JSON.stringify({
      ts: now().toISOString(),
      level,
      service,
      event,
      ...normalized
    }));
  }

  return {
    info: (event, fields) => log("info", event, fields),
    warn: (event, fields) => log("warn", event, fields),
    error: (event, fields) => log("error", event, fields)
  };
}

/** 客户端可传入的关联 ID 头；否则每请求自生成一个 UUID。响应同名头回显，便于跨服务/日志串联。 */
export const REQUEST_ID_HEADER = "X-Request-Id";

/** 入站 X-Request-Id 做最小净化：截断到 200 字符并去掉控制字符，避免日志/响应头注入。 */
function sanitizeRequestId(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  // 去掉 C0/C1 控制字符（含 CR/LF），避免响应头注入；用码点过滤而非内联控制字符的正则，更稳更易读。
  const cleaned = Array.from(trimmed.slice(0, 200))
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return !(code <= 0x1f || (code >= 0x7f && code <= 0x9f));
    })
    .join("");
  return cleaned.length > 0 ? cleaned : undefined;
}

/** 请求日志中间件：request_id/method/path/status/duration_ms（+ 已识别用户昵称，若中间件链已解析）。 */
export function createRequestLogMiddleware(logger: StructuredLogger): MiddlewareHandler {
  return async (c, next) => {
    const startedAt = Date.now();
    // 关联 ID：取客户端传入的 X-Request-Id（净化后），否则生成 UUID。挂到 context 供下游使用，
    // 并作为响应头回显，让编排层/前端把一次请求与服务端日志行串起来。
    const inbound = sanitizeRequestId(c.req.header(REQUEST_ID_HEADER) ?? "");
    const requestId = inbound ?? randomUUID();
    c.set("requestId", requestId);
    c.header(REQUEST_ID_HEADER, requestId);
    try {
      await next();
    } finally {
      // 即便下游已写出响应，也再钉一次关联头（已结束的响应上 c.header 无副作用）。
      c.header(REQUEST_ID_HEADER, requestId);
      const actor = (c.var as { actor?: { label?: string } }).actor;
      logger.info("http_request", {
        request_id: requestId,
        method: c.req.method,
        path: new URL(c.req.url).pathname,
        status: c.res.status,
        duration_ms: Date.now() - startedAt,
        ...(actor?.label ? { actor: actor.label } : {})
      });
    }
  };
}
