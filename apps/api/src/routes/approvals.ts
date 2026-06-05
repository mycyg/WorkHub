import { Hono } from "hono";

import {
  delegateApprovalRequestSchema,
  respondApprovalRequestSchema
} from "@workhub/contracts";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  createApprovalService,
  type ApprovalService
} from "../services/approvals.js";

export type ApprovalRoutesDependencies = {
  auth?: AuthDependencySource;
  service?: ApprovalService;
};

export function createApprovalRoutes(deps: ApprovalRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const service = deps.service ?? createApprovalService();

  routes.get("/", createCurrentUserMiddleware(authSource), async (c) => {
    const data = await service.listPendingForUser(c.var.currentUser);
    return c.json({ ok: true, data });
  });

  routes.post("/:id/respond", createCurrentUserMiddleware(authSource), async (c) => {
    const payload = respondApprovalRequestSchema.parse(await c.req.json());
    const data = await service.respond(c.req.param("id"), c.var.actor, payload);
    return c.json({ ok: true, data });
  });

  routes.post("/:id/delegate", createCurrentUserMiddleware(authSource), async (c) => {
    const payload = delegateApprovalRequestSchema.parse(await c.req.json());
    const data = await service.delegate(c.req.param("id"), c.var.actor, payload.to_user_id);
    return c.json({ ok: true, data });
  });

  return routes;
}
