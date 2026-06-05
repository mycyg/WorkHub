import { Hono } from "hono";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  createNotificationService,
  type NotificationService
} from "../services/notifications.js";

export type NotificationRoutesDependencies = {
  auth?: AuthDependencySource;
  service?: NotificationService;
};

export function createNotificationRoutes(deps: NotificationRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const service = deps.service ?? createNotificationService();

  routes.get("/", createCurrentUserMiddleware(authSource), async (c) => {
    const data = await service.listForUser(c.var.currentUser.id);
    return c.json({ ok: true, data });
  });

  routes.post("/:id/read", createCurrentUserMiddleware(authSource), async (c) => {
    const data = await service.markRead(c.req.param("id"), c.var.currentUser.id);
    return c.json({ ok: true, data });
  });

  routes.post("/read-all", createCurrentUserMiddleware(authSource), async (c) => {
    const data = await service.markAllRead(c.var.currentUser.id);
    return c.json({ ok: true, data });
  });

  return routes;
}
