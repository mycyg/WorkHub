import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { settings } from "@workhub/config";

import { createAuthRoutes } from "./routes/auth.js";
import { createClientDeviceRoutes } from "./routes/client-devices.js";
import { createPushRoutes } from "./routes/push.js";

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

app.route("/api/auth", createAuthRoutes());
app.route("/api/client-devices", createClientDeviceRoutes());
app.route("/api/push", createPushRoutes());

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
