import { Hono } from "hono";

import { editConversationMessageRequestSchema } from "@workhub/contracts";

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

// R14 批 CHAT（消息动作：编辑/删除/引用回复的目标校验、reaction、置顶）：这个路由模块故意 **不挂载**
// 进 apps/api/src/app.ts——挂载是集成者的活（照 routes/conversation-typing.ts / conversation-army.ts
// 的先例：写好不挂，集成者统一挂进 app.ts 白名单 + 补 openapi）。只导出 createConversationMessageActionRoutes(deps)。
// 语义红线（本人判定/编辑窗/墓碑归一/引用校验/置顶可见性）全在 services/conversations.ts 里强制；SSE
// （conversation.message.updated / conversation.reaction.updated）也由服务层发布，路由层只做 uuid 守卫、
// body 校验、调服务、成形响应（编辑/删除回全量 VM；reaction/pin 回 204）。

export type ConversationMessageActionRoutesDependencies = {
  auth?: AuthDependencySource;
  conversations?: ConversationService;
};

function requireConversationId(value: string) {
  // uuid 参数守卫：非法串直接 404，和「合法但不存在的 uuid」同形状（照 routes/uuid-param.ts 既有用法）。
  if (!isUuidParam(value)) {
    throw new ConversationServiceError(404, "conversation_not_found", "没有找到这个会话。");
  }
  return value;
}

function requireMessageId(value: string) {
  if (!isUuidParam(value)) {
    throw new ConversationServiceError(404, "conversation_message_not_found", "没有找到这条消息。");
  }
  return value;
}

export function createConversationMessageActionRoutes(deps: ConversationMessageActionRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const conversations = deps.conversations ?? getDefaultConversationService();
  const requireCurrentUser = createCurrentUserMiddleware(authSource);

  // 编辑：仅本人、仅 text、15 分钟窗、未删除（服务层强制）。200 全量消息 VM / 403 / 404 / 409。
  routes.patch("/conversations/:id/messages/:messageId", requireCurrentUser, async (c) => {
    const conversationId = requireConversationId(c.req.param("id"));
    const messageId = requireMessageId(c.req.param("messageId"));
    const payload = editConversationMessageRequestSchema.parse(await readJsonObject(c));
    const data = await conversations.editMessage({ actor: c.var.actor, conversationId, messageId, payload });
    return c.json({ ok: true, data });
  });

  // 墓碑删除（幂等）：200 墓碑 VM（重复删返回现状）/ 403 / 404。
  routes.delete("/conversations/:id/messages/:messageId", requireCurrentUser, async (c) => {
    const conversationId = requireConversationId(c.req.param("id"));
    const messageId = requireMessageId(c.req.param("messageId"));
    const data = await conversations.deleteMessage({ actor: c.var.actor, conversationId, messageId });
    return c.json({ ok: true, data });
  });

  // reaction 加（幂等）：204 / 400(坏 key) / 404 / 409(已删除)。key 合法性在服务层校验。
  routes.put("/conversations/:id/messages/:messageId/reactions/:key", requireCurrentUser, async (c) => {
    const conversationId = requireConversationId(c.req.param("id"));
    const messageId = requireMessageId(c.req.param("messageId"));
    await conversations.addReaction({
      actor: c.var.actor,
      conversationId,
      messageId,
      reactionKey: c.req.param("key")
    });
    return c.body(null, 204);
  });

  // reaction 减（幂等）：204 / 404。
  routes.delete("/conversations/:id/messages/:messageId/reactions/:key", requireCurrentUser, async (c) => {
    const conversationId = requireConversationId(c.req.param("id"));
    const messageId = requireMessageId(c.req.param("messageId"));
    await conversations.removeReaction({
      actor: c.var.actor,
      conversationId,
      messageId,
      reactionKey: c.req.param("key")
    });
    return c.body(null, 204);
  });

  // 置顶：204 / 404 / 409(已删除)。
  routes.put("/conversations/:id/messages/:messageId/pin", requireCurrentUser, async (c) => {
    const conversationId = requireConversationId(c.req.param("id"));
    const messageId = requireMessageId(c.req.param("messageId"));
    await conversations.pinMessage({ actor: c.var.actor, conversationId, messageId });
    return c.body(null, 204);
  });

  // 取消置顶（幂等）：204 / 404。
  routes.delete("/conversations/:id/messages/:messageId/pin", requireCurrentUser, async (c) => {
    const conversationId = requireConversationId(c.req.param("id"));
    const messageId = requireMessageId(c.req.param("messageId"));
    await conversations.unpinMessage({ actor: c.var.actor, conversationId, messageId });
    return c.body(null, 204);
  });

  // 置顶清单：seq 降序 cap 50。200 { messages: [VM] }。
  routes.get("/conversations/:id/pins", requireCurrentUser, async (c) => {
    const conversationId = requireConversationId(c.req.param("id"));
    const data = await conversations.listPins({ actor: c.var.actor, conversationId });
    return c.json({ ok: true, data });
  });

  return routes;
}
