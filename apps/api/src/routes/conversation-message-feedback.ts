import { Hono } from "hono";

import { putAiFeedbackRequestSchema } from "@workhub/contracts";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  AiFeedbackServiceError,
  getDefaultAiFeedbackService,
  type AiFeedbackService
} from "../services/ai-feedback.js";
import { readJsonObject } from "./json-body.js";
import { isUuidParam } from "./uuid-param.js";

// R14 批 FEEDBACK（Cuu 文字回复的「有用/没用」轻反馈）：故意 **不挂载** 进 app.ts——挂载归集成者
// （照 conversation-message-actions.ts / conversation-typing.ts 的先例：写好不挂，集成者统一挂进白名单
// + 补 openapi + 给 app.ts onError 补一个 AiFeedbackServiceError 分支）。语义红线（只对 Cuu 活文字消息、
// 会话可见性、note 校验、幂等改判/撤销）全在 services/ai-feedback.ts 强制；路由层只做 uuid 守卫、body
// 校验、调服务、回 204。SSE 不发（反馈没有跨用户可见面，见设计 §0 结论 3/§9）。

export type ConversationMessageFeedbackRoutesDependencies = {
  auth?: AuthDependencySource;
  feedback?: AiFeedbackService;
};

function requireConversationId(value: string) {
  if (!isUuidParam(value)) {
    throw new AiFeedbackServiceError(404, "conversation_not_found", "没有找到这个会话。");
  }
  return value;
}

function requireMessageId(value: string) {
  if (!isUuidParam(value)) {
    throw new AiFeedbackServiceError(404, "conversation_message_not_found", "没有找到这条消息。");
  }
  return value;
}

export function createConversationMessageFeedbackRoutes(
  deps: ConversationMessageFeedbackRoutesDependencies = {}
) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const feedback = deps.feedback ?? getDefaultAiFeedbackService();
  const requireCurrentUser = createCurrentUserMiddleware(authSource);

  // 反馈写入（幂等 upsert）：204 / 400(超长/注入短语/坏 verdict) / 403(非真人) / 404(会话不可见 /
  // 非 Cuu 文字消息 / 已删除 / 不存在)。
  routes.put("/conversations/:id/messages/:messageId/feedback", requireCurrentUser, async (c) => {
    const conversationId = requireConversationId(c.req.param("id"));
    const messageId = requireMessageId(c.req.param("messageId"));
    const payload = putAiFeedbackRequestSchema.parse(await readJsonObject(c));
    await feedback.putMessageFeedback({
      actor: c.var.actor,
      conversationId,
      messageId,
      verdict: payload.verdict,
      note: payload.note ?? null
    });
    return c.body(null, 204);
  });

  // 反馈撤销（幂等）：204 / 403 / 404(会话不可见)。
  routes.delete("/conversations/:id/messages/:messageId/feedback", requireCurrentUser, async (c) => {
    const conversationId = requireConversationId(c.req.param("id"));
    const messageId = requireMessageId(c.req.param("messageId"));
    await feedback.removeMessageFeedback({ actor: c.var.actor, conversationId, messageId });
    return c.body(null, 204);
  });

  return routes;
}
