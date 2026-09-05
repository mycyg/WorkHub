import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { installPluginRequestSchema } from "@workhub/contracts";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import { getDefaultPluginService, type PluginService } from "../services/plugins.js";
import { readJsonObject } from "./json-body.js";
import { isUuidParam } from "./uuid-param.js";

// R24-P 阶段 1：插件治理端点（全部仅管理员——鉴权判定在服务层 requireAdmin，路由不重复一份）。
//   GET    /api/plugins            清单 + 宿主捆绑版本 + 还有几条来自环境变量的引导路径
//   POST   /api/plugins            从本机目录安装（静态体检 → 登记 → 试加载）
//   POST   /api/plugins/:id/enable 启用（重新试加载，结果可能是装不上）
//   POST   /api/plugins/:id/disable 停用（工具从此不出现在任何一次执行里）
//   DELETE /api/plugins/:id        移除
// 启停/安装/移除都会让宿主按新清单热重载；四个动作各落一条审计（服务层）。

export type PluginRoutesDependencies = {
  auth?: AuthDependencySource;
  service?: PluginService;
};

function requirePluginId(id: string): string {
  if (!isUuidParam(id)) {
    // 非法 id 形状按「没有这个插件」处理——不把「这不是个 uuid」当成对外语义。
    throw new HTTPException(404, { message: "没有找到这个插件。" });
  }
  return id;
}

export function createPluginRoutes(deps: PluginRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const requireCurrentUser = createCurrentUserMiddleware(authSource);
  // 懒解析：不注入时才建默认服务，且推迟到第一次请求——路由工厂本身不该在 import 期建 DB 连接池。
  let resolved: PluginService | undefined = deps.service;
  const service = () => (resolved ??= getDefaultPluginService());

  routes.get("/plugins", requireCurrentUser, async (c) => {
    const data = await service().list({ actor: c.var.actor });
    return c.json({ ok: true, data });
  });

  routes.post("/plugins", requireCurrentUser, async (c) => {
    const payload = installPluginRequestSchema.parse(await readJsonObject(c));
    const data = await service().install({ actor: c.var.actor, sourcePath: payload.source_path });
    return c.json({ ok: true, data }, 201);
  });

  routes.post("/plugins/:id/enable", requireCurrentUser, async (c) => {
    const id = requirePluginId(c.req.param("id"));
    const data = await service().setEnabled({ actor: c.var.actor, id, enabled: true });
    return c.json({ ok: true, data });
  });

  routes.post("/plugins/:id/disable", requireCurrentUser, async (c) => {
    const id = requirePluginId(c.req.param("id"));
    const data = await service().setEnabled({ actor: c.var.actor, id, enabled: false });
    return c.json({ ok: true, data });
  });

  routes.delete("/plugins/:id", requireCurrentUser, async (c) => {
    const id = requirePluginId(c.req.param("id"));
    const data = await service().remove({ actor: c.var.actor, id });
    return c.json({ ok: true, data });
  });

  return routes;
}
