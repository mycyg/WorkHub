import { Hono } from "hono";

import { openDmRequestSchema } from "@workhub/contracts";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  getDefaultConversationService,
  type ConversationService
} from "../services/conversations.js";
import { readJsonObject } from "./json-body.js";

// R15 批 B（人对人私聊 · 02-batch-b-dm.md B2）：POST /api/dm/open —— 查/开一对用户的 DM，返回既有会话
// 列表同款的 conversation VM（带 is_dm=true）。鉴权中间件随既有 conversations 路由；会话查重/容器
// 惰性创建/同工作区校验全在 services/conversations.ts 的 openDm 里做，路由层只做 body 校验、成形响应。
// 自聊 400、目标不在工作区 404、其余错误经 app.onError 的 ConversationServiceError 分支统一映射。

export type DmRoutesDependencies = {
  auth?: AuthDependencySource;
  conversations?: ConversationService;
};

export function createDmRoutes(deps: DmRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const conversations = deps.conversations ?? getDefaultConversationService();
  const requireCurrentUser = createCurrentUserMiddleware(authSource);

  routes.post("/open", requireCurrentUser, async (c) => {
    const payload = openDmRequestSchema.parse(await readJsonObject(c));
    const data = await conversations.openDm({ actor: c.var.actor, targetUserId: payload.user_id });
    return c.json({ ok: true, data }, 201);
  });

  return routes;
}
