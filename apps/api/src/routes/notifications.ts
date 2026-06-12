import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  createNotificationService,
  NotificationServiceError,
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

  function handleNotificationError(error: unknown): never {
    if (error instanceof NotificationServiceError) {
      throw new HTTPException(error.status as 400, { message: error.message });
    }
    throw error;
  }

  routes.get("/", createCurrentUserMiddleware(authSource), async (c) => {
    const data = await service.listForUser(c.var.currentUser.id);
    return c.json({ ok: true, data });
  });

  routes.post("/:id/read", createCurrentUserMiddleware(authSource), async (c) => {
    try {
      const data = await service.markRead(c.req.param("id"), c.var.currentUser.id);
      return c.json({ ok: true, data });
    } catch (error) {
      handleNotificationError(error);
    }
  });

  routes.post("/read-all", createCurrentUserMiddleware(authSource), async (c) => {
    const data = await service.markAllRead(c.var.currentUser.id);
    return c.json({ ok: true, data });
  });

  routes.post("/:id/dismiss", createCurrentUserMiddleware(authSource), async (c) => {
    try {
      const data = await service.dismiss(c.req.param("id"), c.var.currentUser.id);
      return c.json({ ok: true, data });
    } catch (error) {
      handleNotificationError(error);
    }
  });

  routes.post("/:id/complete", createCurrentUserMiddleware(authSource), async (c) => {
    try {
      const data = await service.complete(c.req.param("id"), c.var.currentUser.id);
      return c.json({ ok: true, data });
    } catch (error) {
      handleNotificationError(error);
    }
  });

  return routes;
}
