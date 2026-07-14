import { Hono } from "hono";

import { advanceReadCursorRequestSchema } from "@workhub/contracts";

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

// R14 批 CHAT（已读游标：聚合式「已读 N/M」+ 未读分割线的地基）：这个路由模块故意 **不挂载** 进
// apps/api/src/app.ts——挂载是集成者的活。只导出 createConversationReadRoutes(deps)。单调夹紧、发布
// conversation.read.updated 都在 services/conversations.ts 里做，路由层只做 uuid 守卫、body 校验、成形响应。

export type ConversationReadRoutesDependencies = {
  auth?: AuthDependencySource;
  conversations?: ConversationService;
};

function requireConversationId(value: string) {
  if (!isUuidParam(value)) {
    throw new ConversationServiceError(404, "conversation_not_found", "没有找到这个会话。");
  }
  return value;
}

export function createConversationReadRoutes(deps: ConversationReadRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const conversations = deps.conversations ?? getDefaultConversationService();
  const requireCurrentUser = createCurrentUserMiddleware(authSource);

  // 推进已读游标（单调夹紧不超过会话最大 seq）：200 { last_read_seq }。
  routes.put("/conversations/:id/read", requireCurrentUser, async (c) => {
    const conversationId = requireConversationId(c.req.param("id"));
    const payload = advanceReadCursorRequestSchema.parse(await readJsonObject(c));
    const data = await conversations.advanceReadCursor({ actor: c.var.actor, conversationId, payload });
    return c.json({ ok: true, data });
  });

  // 全部读游标（聚合式「已读 N/M」在上层算）：200 { receipts: [{ user_id, last_read_seq }] }。
  routes.get("/conversations/:id/receipts", requireCurrentUser, async (c) => {
    const conversationId = requireConversationId(c.req.param("id"));
    const data = await conversations.listReceipts({ actor: c.var.actor, conversationId });
    return c.json({ ok: true, data });
  });

  return routes;
}
