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
import { isUuidParam } from "./uuid-param.js";

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

  // 路由 uuid 形参先校验：非 uuid 串原本直达通知服务的 uuid 列 → PG 22P02 → 误报 500；非法即抛与
  // 「合法但不存在」同样的 404（NotificationServiceError，经 handleNotificationError 收口），不泄露存在性。
  function requireNotificationId(value: string): string {
    if (!isUuidParam(value)) {
      throw new NotificationServiceError(404, "not_found", "没有找到这条通知。");
    }
    return value;
  }

  routes.get("/", createCurrentUserMiddleware(authSource), async (c) => {
    const data = await service.listForUser(c.var.currentUser.id);
    return c.json({ ok: true, data });
  });

  // 团队就绪 must-have（通知偏好-按类型静音）：读当前用户被静音的通知类型清单。
  routes.get("/preferences", createCurrentUserMiddleware(authSource), async (c) => {
    const data = await service.getPreferences(c.var.currentUser.id);
    return c.json({ ok: true, data });
  });

  // 写当前用户被静音的通知类型清单。校验：必须是去重后的非空字符串数组（空数组=不静音）。
  routes.put("/preferences", createCurrentUserMiddleware(authSource), async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      throw new HTTPException(400, { message: "请求体必须是 JSON。" });
    }
    const raw = (payload as { muted_notification_types?: unknown } | null)?.muted_notification_types;
    if (!Array.isArray(raw)) {
      throw new HTTPException(400, { message: "muted_notification_types 必须是字符串数组。" });
    }
    if (raw.length > 100) {
      throw new HTTPException(400, { message: "静音类型过多（上限 100 个）。" });
    }
    const cleaned: string[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
      if (typeof item !== "string") {
        throw new HTTPException(400, { message: "muted_notification_types 的每一项都必须是字符串。" });
      }
      const trimmed = item.trim();
      if (trimmed.length === 0) {
        throw new HTTPException(400, { message: "通知类型不能为空。" });
      }
      if (trimmed.length > 64) {
        throw new HTTPException(400, { message: "通知类型过长（上限 64 字符）。" });
      }
      if (!seen.has(trimmed)) {
        seen.add(trimmed);
        cleaned.push(trimmed);
      }
    }
    try {
      const data = await service.setPreferences(c.var.currentUser.id, cleaned);
      return c.json({ ok: true, data });
    } catch (error) {
      handleNotificationError(error);
    }
  });

  routes.post("/:id/read", createCurrentUserMiddleware(authSource), async (c) => {
    try {
      const data = await service.markRead(requireNotificationId(c.req.param("id")), c.var.currentUser.id);
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
      const data = await service.dismiss(requireNotificationId(c.req.param("id")), c.var.currentUser.id);
      return c.json({ ok: true, data });
    } catch (error) {
      handleNotificationError(error);
    }
  });

  routes.post("/:id/complete", createCurrentUserMiddleware(authSource), async (c) => {
    try {
      const data = await service.complete(requireNotificationId(c.req.param("id")), c.var.currentUser.id);
      return c.json({ ok: true, data });
    } catch (error) {
      handleNotificationError(error);
    }
  });

  return routes;
}
