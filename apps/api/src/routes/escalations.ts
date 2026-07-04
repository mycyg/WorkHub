import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import {
  delegateEscalationRequestSchema,
  normalizeWorkHubLocale,
  resolveEscalationRequestSchema
} from "@workhub/contracts";
import type { WorkHubLocale } from "@workhub/contracts";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  createEscalationService,
  type EscalationService
} from "../services/escalations.js";
import { readJsonObject } from "./json-body.js";
import { isUuidParam } from "./uuid-param.js";

export type EscalationRoutesDependencies = {
  auth?: AuthDependencySource;
  service?: EscalationService;
};

function requireEscalationId(id: string) {
  if (!isUuidParam(id)) {
    throw new HTTPException(404, { message: "没有找到这条升级。" });
  }
  return id;
}

function requestLocale(c: { req: { query: (key: string) => string | undefined; header: (key: string) => string | undefined } }): WorkHubLocale {
  return normalizeWorkHubLocale(c.req.query("locale") ?? c.req.header("Accept-Language"));
}

export function createEscalationRoutes(deps: EscalationRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const service = deps.service ?? createEscalationService();

  routes.post("/:id/resolve", createCurrentUserMiddleware(authSource), async (c) => {
    const id = requireEscalationId(c.req.param("id"));
    const payload = resolveEscalationRequestSchema.parse(await readJsonObject(c));
    const data = await service.resolve(id, c.var.actor, payload, requestLocale(c));
    return c.json({ ok: true, data });
  });

  routes.post("/:id/budget-actions/:actionId", createCurrentUserMiddleware(authSource), async (c) => {
    const id = requireEscalationId(c.req.param("id"));
    const actionId = c.req.param("actionId");
    const data = await service.resolveBudgetDecision(id, c.var.actor, actionId, requestLocale(c));
    return c.json({ ok: true, data });
  });

  routes.post("/:id/delegate", createCurrentUserMiddleware(authSource), async (c) => {
    const id = requireEscalationId(c.req.param("id"));
    const payload = delegateEscalationRequestSchema.parse(await readJsonObject(c));
    const data = await service.delegate(id, c.var.actor, payload, requestLocale(c));
    return c.json({ ok: true, data });
  });

  return routes;
}
