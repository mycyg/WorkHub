import { Hono } from "hono";

import { updateConversationCuuRequestSchema } from "@workhub/contracts";

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

// R15 批 cuu-toggle：会话级 Cuu 参与开关——PATCH /api/conversations/:id/cuu，body { enabled }。仅
// collab 会话（含 DM）可翻，main 一律 409；仅参与者/owner 可翻，红线全部在 services/conversations.ts
// 的 updateCuuEnabled 里做，路由层只做 uuid 守卫、body 校验、成形响应。

export type ConversationCuuRoutesDependencies = {
  auth?: AuthDependencySource;
  conversations?: ConversationService;
};

function requireConversationId(value: string) {
  if (!isUuidParam(value)) {
    throw new ConversationServiceError(404, "conversation_not_found", "没有找到这个会话。");
  }
  return value;
}

export function createConversationCuuRoutes(deps: ConversationCuuRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const conversations = deps.conversations ?? getDefaultConversationService();
  const requireCurrentUser = createCurrentUserMiddleware(authSource);

  // 会话级 Cuu 参与开关翻转：200 { conversation }。main 一律 409 conversation_cuu_not_collab；
  // 非参与者 403 conversation_cuu_forbidden；幂等（重复翻到同一个值不是错误）。
  routes.patch("/conversations/:id/cuu", requireCurrentUser, async (c) => {
    const conversationId = requireConversationId(c.req.param("id"));
    const payload = updateConversationCuuRequestSchema.parse(await readJsonObject(c));
    const data = await conversations.updateCuuEnabled({ actor: c.var.actor, conversationId, payload });
    return c.json({ ok: true, data });
  });

  return routes;
}
