import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { addMcpServerRequestSchema, updateMcpServerRequestSchema } from "@workhub/contracts";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import { getDefaultMcpServerService, type McpServerService } from "../services/mcp-servers.js";
import { readJsonObject } from "./json-body.js";
import { isUuidParam } from "./uuid-param.js";

// R26 M3：MCP（Model Context Protocol，模型上下文协议）服务器的治理端点。
// 全部仅管理员——鉴权判定在服务层 requireAdmin，路由不重复一份（同 routes/plugins.ts 的口径）。
//
//   GET    /api/mcp-servers            清单 + 每台的连接事实 + 可引用的服务端密钥变量名
//   POST   /api/mcp-servers            添加（静态体检 → 登记 → 按新清单握手）
//   POST   /api/mcp-servers/:id/enable 启用（工具重新出现在执行里）
//   POST   /api/mcp-servers/:id/disable 停用（子进程收掉，工具从此不出现在任何一次执行里）
//   POST   /api/mcp-servers/:id/reload 测试连接（重新握手并如实回报，失败也是 200 的一条结论）
//   PATCH  /api/mcp-servers/:id        改信任级别 / 单次调用超时 / 环境变量 / 密钥引用
//   DELETE /api/mcp-servers/:id        移除
//
// 六个写动作各落一条审计（服务层）。「测试连接」失败**不是** HTTP 错误：用户问的就是「现在连得上
// 吗」，把答案编码成 5xx 会让客户端把一次成功的问询当成自己坏了（同插件那侧「装不上是一条记录」）。

export type McpServerRoutesDependencies = {
  auth?: AuthDependencySource;
  service?: McpServerService;
};

function requireServerId(id: string): string {
  if (!isUuidParam(id)) {
    // 非法 id 形状按「没有这台服务器」处理——不把「这不是个 uuid」当成对外语义，
    // 也不让攻击者据状态码区分「不存在」与「存在但没权限」。
    throw new HTTPException(404, { message: "no such mcp server" });
  }
  return id;
}

export function createMcpServerRoutes(deps: McpServerRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const requireCurrentUser = createCurrentUserMiddleware(authSource);
  // 懒解析：不注入时才建默认服务，且推迟到第一次请求——路由工厂本身不该在 import 期建 DB 连接池。
  let resolved: McpServerService | undefined = deps.service;
  const service = () => (resolved ??= getDefaultMcpServerService());

  routes.get("/mcp-servers", requireCurrentUser, async (c) => {
    const data = await service().list({ actor: c.var.actor });
    return c.json({ ok: true, data });
  });

  routes.post("/mcp-servers", requireCurrentUser, async (c) => {
    const request = addMcpServerRequestSchema.parse(await readJsonObject(c));
    const data = await service().add({ actor: c.var.actor, request });
    return c.json({ ok: true, data }, 201);
  });

  routes.post("/mcp-servers/:id/enable", requireCurrentUser, async (c) => {
    const id = requireServerId(c.req.param("id"));
    const data = await service().setEnabled({ actor: c.var.actor, id, enabled: true });
    return c.json({ ok: true, data });
  });

  routes.post("/mcp-servers/:id/disable", requireCurrentUser, async (c) => {
    const id = requireServerId(c.req.param("id"));
    const data = await service().setEnabled({ actor: c.var.actor, id, enabled: false });
    return c.json({ ok: true, data });
  });

  routes.post("/mcp-servers/:id/reload", requireCurrentUser, async (c) => {
    const id = requireServerId(c.req.param("id"));
    const data = await service().reload({ actor: c.var.actor, id });
    return c.json({ ok: true, data });
  });

  routes.patch("/mcp-servers/:id", requireCurrentUser, async (c) => {
    const id = requireServerId(c.req.param("id"));
    const request = updateMcpServerRequestSchema.parse(await readJsonObject(c));
    const data = await service().update({ actor: c.var.actor, id, request });
    return c.json({ ok: true, data });
  });

  routes.delete("/mcp-servers/:id", requireCurrentUser, async (c) => {
    const id = requireServerId(c.req.param("id"));
    await service().remove({ actor: c.var.actor, id });
    // 204：删除没有第二种成功形态，回一个 `{removed:true}` 的躯壳只是让客户端多解析一次。
    return c.body(null, 204);
  });

  return routes;
}
