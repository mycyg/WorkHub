import { Hono } from "hono";

import { renameConversationRequestSchema } from "@workhub/contracts";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  ConversationServiceError,
  getDefaultConversationService,
  type ConversationService
} from "../services/conversations.js";
import { readJsonObject } from "./json-body.js";
import { isUuidParam } from "./uuid-param.js";

// R14FIX 批 workbench（会话重命名，2026-07-15 用户反馈）：这个路由模块故意 **不挂载** 进
// apps/api/src/app.ts——挂载是集成者的活（见交付报告的挂载 snippet）。只导出
// createConversationRenameRoutes(deps)。会话种类/参与者鉴权红线与 title 落库都在
// services/conversations.ts 的 renameConversation 里做，路由层只做 uuid 守卫、body 校验、成形响应。

export type ConversationRenameRoutesDependencies = {
  auth?: AuthDependencySource;
  conversations?: ConversationService;
};

function requireConversationId(value: string) {
  if (!isUuidParam(value)) {
    throw new ConversationServiceError(404, "conversation_not_found", "没有找到这个会话。");
  }
  return value;
}

export function createConversationRenameRoutes(deps: ConversationRenameRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const conversations = deps.conversations ?? getDefaultConversationService();
  const requireCurrentUser = createCurrentUserMiddleware(authSource);

  // 协同会话改名：200 { conversation }。仅 collab、仅参与者/owner——红线在服务层强制（403），
  // main 主区改名一律 403（不给点了必失败的入口）。
  routes.patch("/conversations/:id", requireCurrentUser, async (c) => {
    const conversationId = requireConversationId(c.req.param("id"));
    const payload = renameConversationRequestSchema.parse(await readJsonObject(c));
    const data = await conversations.renameConversation({ actor: c.var.actor, conversationId, payload });
    return c.json({ ok: true, data });
  });

  return routes;
}
