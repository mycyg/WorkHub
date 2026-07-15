import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  createNotificationService,
  normalizeMutedNotificationTypes,
  NotificationServiceError,
  type NotificationService
} from "../services/notifications.js";
import { readJsonObject } from "./json-body.js";
import { isUuidParam } from "./uuid-param.js";

export type NotificationRoutesDependencies = {
  auth?: AuthDependencySource;
  service?: NotificationService;
};

const notificationPreferencesRequestSchema = z.object({
  muted_notification_types: z.array(z.string().trim().min(1).max(64)).max(100)
}).transform((value) => ({
  muted_notification_types: normalizeMutedNotificationTypes(value.muted_notification_types)
}));

export function createNotificationRoutes(deps: NotificationRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const service = deps.service ?? createNotificationService();

  function handleNotificationError(error: unknown): never {
    if (error instanceof NotificationServiceError) {
      throw error;
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
    const data = await service.listForUser({ userId: c.var.currentUser.id, actor: c.var.actor });
    return c.json({ ok: true, data });
  });

  // 团队就绪 must-have（通知偏好-按类型静音）：读当前用户被静音的通知类型清单。
  routes.get("/preferences", createCurrentUserMiddleware(authSource), async (c) => {
    const data = await service.getPreferences(c.var.currentUser.id);
    return c.json({ ok: true, data });
  });

  // 写当前用户被静音的通知类型清单。校验：必须是去重后的非空字符串数组（空数组=不静音）。
  routes.put("/preferences", createCurrentUserMiddleware(authSource), async (c) => {
    const payload = notificationPreferencesRequestSchema.parse(await readJsonObject(c));
    try {
      const data = await service.setPreferences(c.var.currentUser.id, payload.muted_notification_types);
      return c.json({ ok: true, data });
    } catch (error) {
      handleNotificationError(error);
    }
  });

  routes.post("/:id/read", createCurrentUserMiddleware(authSource), async (c) => {
    try {
      const notificationId = requireNotificationId(c.req.param("id"));
      const data = await service.markRead(notificationId, c.var.currentUser.id, { actor: c.var.actor });
      return c.json({ ok: true, data });
    } catch (error) {
      handleNotificationError(error);
    }
  });

  routes.post("/read-all", createCurrentUserMiddleware(authSource), async (c) => {
    const data = await service.markAllRead(c.var.currentUser.id, { actor: c.var.actor });
    return c.json({ ok: true, data });
  });

  routes.post("/:id/dismiss", createCurrentUserMiddleware(authSource), async (c) => {
    try {
      const notificationId = requireNotificationId(c.req.param("id"));
      const data = await service.dismiss(notificationId, c.var.currentUser.id, { actor: c.var.actor });
      return c.json({ ok: true, data });
    } catch (error) {
      handleNotificationError(error);
    }
  });

  routes.post("/:id/complete", createCurrentUserMiddleware(authSource), async (c) => {
    try {
      const notificationId = requireNotificationId(c.req.param("id"));
      const data = await service.complete(notificationId, c.var.currentUser.id, { actor: c.var.actor });
      return c.json({ ok: true, data });
    } catch (error) {
      handleNotificationError(error);
    }
  });

  // R15 批 A（提醒阶梯）：暂停提醒——停掉 24h 叮嘱但保留读/归档态（通知仍在待决策队列，只是不再催）。
  routes.post("/:id/snooze", createCurrentUserMiddleware(authSource), async (c) => {
    try {
      const notificationId = requireNotificationId(c.req.param("id"));
      const data = await service.snooze(notificationId, c.var.currentUser.id, { actor: c.var.actor });
      return c.json({ ok: true, data });
    } catch (error) {
      handleNotificationError(error);
    }
  });

  return routes;
}
