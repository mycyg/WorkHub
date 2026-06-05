import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { settings } from "@workhub/config";

import { getOpenApiDocument } from "./openapi.js";
import { createAuthRoutes } from "./routes/auth.js";
import { createClientDeviceRoutes } from "./routes/client-devices.js";
import { createApprovalRoutes } from "./routes/approvals.js";
import { createAgentRunRoutes } from "./routes/agent-runs.js";
import { createPermissionRoutes } from "./routes/permissions.js";
import { createPushRoutes } from "./routes/push.js";
import { createNotificationRoutes } from "./routes/notifications.js";
import { createAuditRoutes } from "./routes/audit.js";
import { createPageRoutes } from "./routes/pages.js";
import { createSessionRoutes } from "./routes/sessions.js";
import { createKnowledgeRoutes } from "./routes/knowledge.js";
import { ApprovalServiceError } from "./services/approvals.js";
import { NotificationServiceError } from "./services/notifications.js";

export const app = new Hono();

app.get("/", (c) =>
  c.json({
    ok: true,
    service: "workhub-api",
    message: "WorkHub API daemon is running",
    health: "/api/health"
  })
);

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
app.route("/api/knowledge", createKnowledgeRoutes());
app.route("/api/pages", createPageRoutes());

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

  console.error(error);
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

export default app;
