import { Hono } from "hono";

import { addConversationParticipantRequestSchema } from "@workhub/contracts";

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

// R15 批 cuu-toggle：会话参与者列表——GET /api/conversations/:id/participants。main 诚实回
// scope:"workspace" + 空列表（它没有 conversation_participants 行，全员可见）；collab（含 DM）回
// scope:"participants" + 真实参与者（user_id/昵称/角色）。参与者门控与消息可见性同口径——非参与者的
// collab 在 services/conversations.ts 的 visibleConversation() 就已经 404，路由层不重复判断。
//
// R17 批 G1（群成员管理）：新增两条写路由——POST /participants（建群后加人，body {user_id}）与
// DELETE /participants/:userId（退群/移出）。语义红线（main 全员/DM 2 人各自 409、加人上限、owner 退群
// 继任、最后一人 409、移出他人仅 owner）全在 services/conversations.ts 的 addParticipant/removeParticipant
// 里做，路由层只做 body/param 校验与成形响应。错误经 app.onError 的 ConversationServiceError 分支映射。

export type ConversationParticipantsRoutesDependencies = {
  auth?: AuthDependencySource;
  conversations?: ConversationService;
};

function requireConversationId(value: string) {
  if (!isUuidParam(value)) {
    throw new ConversationServiceError(404, "conversation_not_found", "没有找到这个会话。");
  }
  return value;
}

// 被加/移出的目标 user id 必须是形如 UUID 的合法值——非法 param 直接 404（不进服务层），与
// requireConversationId 同款 fail-closed，避免把垃圾串带进仓库查询。
function requireTargetUserId(value: string) {
  if (!isUuidParam(value)) {
    throw new ConversationServiceError(404, "conversation_participant_not_found", "这个人不在这个会话里。");
  }
  return value;
}

export function createConversationParticipantsRoutes(deps: ConversationParticipantsRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const conversations = deps.conversations ?? getDefaultConversationService();
  const requireCurrentUser = createCurrentUserMiddleware(authSource);

  routes.get("/conversations/:id/participants", requireCurrentUser, async (c) => {
    const conversationId = requireConversationId(c.req.param("id"));
    const data = await conversations.listParticipants({ actor: c.var.actor, conversationId });
    return c.json({ ok: true, data });
  });

  routes.post("/conversations/:id/participants", requireCurrentUser, async (c) => {
    const conversationId = requireConversationId(c.req.param("id"));
    const payload = addConversationParticipantRequestSchema.parse(await readJsonObject(c));
    const data = await conversations.addParticipant({
      actor: c.var.actor,
      conversationId,
      addUserId: payload.user_id
    });
    return c.json({ ok: true, data });
  });

  routes.delete("/conversations/:id/participants/:userId", requireCurrentUser, async (c) => {
    const conversationId = requireConversationId(c.req.param("id"));
    const targetUserId = requireTargetUserId(c.req.param("userId"));
    const data = await conversations.removeParticipant({
      actor: c.var.actor,
      conversationId,
      targetUserId
    });
    return c.json({ ok: true, data });
  });

  return routes;
}
