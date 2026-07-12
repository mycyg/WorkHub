import { Hono } from "hono";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  ConversationTurnServiceError,
  createConversationTurnRequestSchema,
  getDefaultConversationTurnService,
  type ConversationTurnService
} from "../services/conversation-turns.js";
import { readJsonObject } from "./json-body.js";
import { isUuidParam } from "./uuid-param.js";

// R12 批 4a（协同会话 turns，服务端切片）：这个路由模块故意 **不挂载** 进 apps/api/src/app.ts——
// 挂载是集成者的活（见 r12-desktop-workbench/reports/batch-4a-turns.md 的「挂载清单」）。写法跟
// routes/conversation-army.ts、routes/conversations.ts 保持一致。

export type ConversationTurnRoutesDependencies = {
  auth?: AuthDependencySource;
  turns?: ConversationTurnService;
};

function requireConversationId(value: string) {
  // uuid 参数守卫：非法串直接 404，与「合法但不存在的 uuid」同一形状（照 routes/uuid-param.ts 既有用法）。
  if (!isUuidParam(value)) {
    throw new ConversationTurnServiceError(404, "conversation_not_found", "没有找到这个会话。");
  }
  return value;
}

export function createConversationTurnRoutes(deps: ConversationTurnRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const turns = deps.turns ?? getDefaultConversationTurnService();
  const requireCurrentUser = createCurrentUserMiddleware(authSource);

  routes.post("/conversations/:id/turns", requireCurrentUser, async (c) => {
    const conversationId = requireConversationId(c.req.param("id"));
    const payload = createConversationTurnRequestSchema.parse(await readJsonObject(c));
    const data = await turns.createTurn({ actor: c.var.actor, conversationId, payload });
    return c.json({ ok: true, data }, 201);
  });

  return routes;
}
