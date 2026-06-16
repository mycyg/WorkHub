import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { settings } from "@workhub/config";

import { getOpenApiDocument } from "./openapi.js";
import { createAuthRoutes } from "./routes/auth.js";
import { createClientDeviceRoutes } from "./routes/client-devices.js";
import { createApprovalRoutes } from "./routes/approvals.js";
import { createAgentRunRoutes } from "./routes/agent-runs.js";
import { AgentRunnerError } from "./workers/agent-runner.js";
import { createPermissionRoutes } from "./routes/permissions.js";
import { createPushRoutes } from "./routes/push.js";
import { createNotificationRoutes } from "./routes/notifications.js";
import { createAuditRoutes } from "./routes/audit.js";
import { createPageRoutes } from "./routes/pages.js";
import { createAiWorklogRoutes } from "./routes/ai-worklog.js";
import { createDriveRoutes } from "./routes/drive.js";
import { createMeetingRoutes } from "./routes/meetings.js";
import { createPilotRoutes } from "./routes/pilot.js";
import { createProjectRoutes } from "./routes/projects.js";
import { createSessionRoutes } from "./routes/sessions.js";
import { createKnowledgeRoutes } from "./routes/knowledge.js";
import { createWorkItemRoutes } from "./routes/workitems.js";
import { createProposalRoutes, createWorkItemProposalRoutes } from "./routes/proposals.js";
import { createCostRoutes } from "./routes/cost.js";
import { ApprovalServiceError } from "./services/approvals.js";
import { NotificationServiceError } from "./services/notifications.js";
import {
  ProposalServiceError,
  ProposalServiceMergeConflictError,
  ProposalServiceRebaseRequiredError
} from "./services/proposals.js";
import { WorkItemServiceError } from "./services/work-items.js";

import { createRequestLogMiddleware, createStructuredLogger } from "./logging.js";

export const logger = createStructuredLogger({ format: settings.logFormat });

export const app = new Hono();

app.use("*", createRequestLogMiddleware(logger));

// CORS：此前 CORS_ALLOW_ORIGINS 被解析+生产校验却从未挂载（死配置）。挂上 hono/cors，由 settings 驱动。
// 凭据走 cookie，故不能用通配 origin——用 "*" 时反射请求 origin（等效放行且兼容 credentials）；
// 否则只放行白名单。生产已禁止 "*"（validateRuntimeConfig）。
const corsAllowOrigins = settings.auth.corsAllowOrigins;
app.use("/api/*", cors({
  origin: corsAllowOrigins.includes("*") ? (origin) => origin || "*" : corsAllowOrigins,
  credentials: true,
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "X-Requested-With"]
}));

// attachWebStatic() 之后根路径服务 SPA；未挂载 web dist 时保留 API banner。
let webIndexHtml: string | undefined;

app.get("/", (c) => {
  if (webIndexHtml) {
    return c.html(webIndexHtml);
  }
  return c.json({
    ok: true,
    service: "workhub-api",
    message: "WorkHub API daemon is running",
    health: "/api/health"
  });
});

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    service: "workhub-api",
    env: settings.appEnv,
    runtime: "node",
    port: settings.port
  })
);

app.get("/openapi.json", (c) => c.json(getOpenApiDocument()));
app.get("/api/openapi.json", (c) => c.json(getOpenApiDocument()));

app.route("/api/auth", createAuthRoutes());
app.route("/api/client-devices", createClientDeviceRoutes());
app.route("/api/push", createPushRoutes());
app.route("/api/approvals", createApprovalRoutes());
app.route("/api/permissions", createPermissionRoutes());
app.route("/api", createAgentRunRoutes());
app.route("/api/notifications", createNotificationRoutes());
app.route("/api", createAuditRoutes());
app.route("/api", createSessionRoutes());
app.route("/api", createWorkItemRoutes());
app.route("/api/knowledge", createKnowledgeRoutes());
app.route("/api", createWorkItemProposalRoutes());
app.route("/api/proposals", createProposalRoutes());
app.route("/api/cost", createCostRoutes());
app.route("/api/pages", createPageRoutes());
app.route("/api/drive", createDriveRoutes());
app.route("/api/meetings", createMeetingRoutes());
app.route("/api/projects", createProjectRoutes());
app.route("/api/pilot", createPilotRoutes());
app.route("/api/ai-worklog", createAiWorklogRoutes());

app.onError((error, c) => {
  if (error instanceof ZodError) {
    return c.json(
      {
        ok: false,
        error: {
          code: "validation_error",
          message: "Request payload does not match the WorkHub API contract.",
          details: error.issues
        }
      },
      422
    );
  }

  if (error instanceof HTTPException) {
    const codeByStatus: Record<number, string> = {
      400: "bad_request",
      401: "not_identified",
      403: "forbidden",
      404: "not_found"
    };
    return c.json(
      {
        ok: false,
        error: {
          code: codeByStatus[error.status] ?? "http_error",
          message: error.message
        }
      },
      error.status
    );
  }

  if (error instanceof AgentRunnerError) {
    return c.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {})
        }
      },
      error.status as 400
    );
  }

  if (error instanceof ApprovalServiceError) {
    return c.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message
        }
      },
      error.status as 400
    );
  }

  if (error instanceof NotificationServiceError) {
    return c.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message
        }
      },
      error.status as 400
    );
  }

  if (error instanceof ProposalServiceError) {
    // 保留真实 code（409/422/415 等）与冲突/rebase 子类的 details，供客户端据 code 分支驱动 UX。
    const details = error instanceof ProposalServiceRebaseRequiredError
      ? { conflicts: error.conflicts, card: error.card }
      : error instanceof ProposalServiceMergeConflictError
        ? { conflicts: error.conflicts }
        : undefined;
    return c.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(details ? { details } : {})
        }
      },
      error.status as 400
    );
  }

  if (error instanceof WorkItemServiceError) {
    return c.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message
        }
      },
      error.status as 400
    );
  }

  logger.error("unhandled_error", { path: new URL(c.req.url).pathname, error });
  return c.json(
    {
      ok: false,
      error: {
        code: "internal_error",
        message: "WorkHub hit an unexpected server error."
      }
    },
    500
  );
});

app.notFound((c) =>
  c.json(
    {
      ok: false,
      error: {
        code: "not_found",
        message: "The requested WorkHub endpoint does not exist."
      }
    },
    404
  )
);

/**
 * Pilot 单源部署：API 进程直接服务 Web 构建产物。
 * 非 /api、/openapi 路径返回静态文件；未命中文件回 index.html（SPA fallback）。
 */
export function attachWebStatic(target: Hono, distDir: string, log = logger) {
  const indexPath = path.join(distDir, "index.html");
  if (!existsSync(indexPath)) {
    log.warn("web_dist_missing", { dist_dir: distDir });
    return false;
  }
  const indexHtml = readFileSync(indexPath, "utf8");
  if (target === app) {
    webIndexHtml = indexHtml;
  }
  target.get("*", async (c, next) => {
    const pathname = new URL(c.req.url).pathname;
    if (pathname.startsWith("/api") || pathname.startsWith("/openapi")) {
      await next();
      return;
    }
    const relative = pathname === "/" ? "index.html" : pathname.slice(1);
    const resolved = path.resolve(distDir, relative);
    const distRoot = path.resolve(distDir) + path.sep;
    if (resolved.startsWith(distRoot) && resolved !== path.resolve(indexPath) && existsSync(resolved)) {
      const body = readFileSync(resolved);
      const types: Record<string, string> = {
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".ico": "image/x-icon",
        ".json": "application/json; charset=utf-8",
        ".map": "application/json; charset=utf-8",
        ".woff2": "font/woff2",
        ".html": "text/html; charset=utf-8"
      };
      const type = types[path.extname(resolved)] ?? "application/octet-stream";
      return c.body(new Uint8Array(body), 200, { "Content-Type": type });
    }
    return c.html(indexHtml);
  });
  log.info("web_static_attached", { dist_dir: distDir });
  return true;
}

export default app;
