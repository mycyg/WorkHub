import { Hono } from "hono";

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
import { isUuidParam } from "./uuid-param.js";

// R15 批 cuu-toggle：会话参与者列表——GET /api/conversations/:id/participants。main 诚实回
// scope:"workspace" + 空列表（它没有 conversation_participants 行，全员可见）；collab（含 DM）回
// scope:"participants" + 真实参与者（user_id/昵称/角色）。参与者门控与消息可见性同口径——非参与者的
// collab 在 services/conversations.ts 的 visibleConversation() 就已经 404，路由层不重复判断。

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

  return routes;
}
