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

/** 请求日志中间件：method/path/status/duration_ms（+ 已识别用户昵称，若中间件链已解析）。 */
export function createRequestLogMiddleware(logger: StructuredLogger): MiddlewareHandler {
  return async (c, next) => {
    const startedAt = Date.now();
    try {
      await next();
    } finally {
      const actor = (c.var as { actor?: { label?: string } }).actor;
      logger.info("http_request", {
        method: c.req.method,
        path: new URL(c.req.url).pathname,
        status: c.res.status,
        duration_ms: Date.now() - startedAt,
        ...(actor?.label ? { actor: actor.label } : {})
      });
    }
  };
}
