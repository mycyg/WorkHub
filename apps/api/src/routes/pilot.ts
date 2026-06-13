import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  getDefaultPilotDay1MetricsService,
  PilotDay1MetricsServiceError,
  type PilotDay1MetricsService
} from "../services/pilot-day1-metrics.js";

export type PilotRoutesDependencies = {
  auth?: AuthDependencySource;
  metrics?: PilotDay1MetricsService;
};

function parseOptionalDate(value: string | undefined, label: string) {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new HTTPException(422, { message: `${label} must be an ISO datetime.` });
  }
  return parsed;
}

function handlePilotError(error: unknown): never {
  if (error instanceof PilotDay1MetricsServiceError) {
    throw new HTTPException(error.status as 400, { message: error.message });
  }
  throw error;
}

export function createPilotRoutes(deps: PilotRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const metrics = deps.metrics ?? getDefaultPilotDay1MetricsService();

  routes.get("/day1/metrics", createCurrentUserMiddleware(authSource), async (c) => {
    try {
      const from = parseOptionalDate(c.req.query("from"), "from");
      const to = parseOptionalDate(c.req.query("to"), "to");
      const data = await metrics.snapshot({
        actor: c.var.actor,
        ...(from ? { from } : {}),
        ...(to ? { to } : {})
      });
      return c.json({ ok: true, data });
    } catch (error) {
      handlePilotError(error);
    }
  });

  return routes;
}
