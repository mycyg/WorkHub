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

// R14 批 FEEDBACK（行动卡条目的「有用/没用」轻反馈）：**不挂载**，挂载归集成者（同上）。可见性复用
// findItemForActor（workspace 围栏，与 decide/undo 同款，不因新增子功能收紧成 @负责人/管理员标准，
// 见设计 §2）。kind/status 不限（服务端宽松，桌面渲染层自己收窄「什么时候值得展示入口」）。

export type ActionCardItemFeedbackRoutesDependencies = {
  auth?: AuthDependencySource;
  feedback?: AiFeedbackService;
};

function requireItemId(value: string) {
  if (!isUuidParam(value)) {
    throw new AiFeedbackServiceError(404, "ai_feedback_subject_not_found", "没有找到这个行动卡条目。");
  }
  return value;
}

export function createActionCardItemFeedbackRoutes(deps: ActionCardItemFeedbackRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const feedback = deps.feedback ?? getDefaultAiFeedbackService();
  const requireCurrentUser = createCurrentUserMiddleware(authSource);

  // 204 / 400 / 403(非真人) / 404(不在此工作区 / 不存在)。
  routes.put("/action-card-items/:id/feedback", requireCurrentUser, async (c) => {
    const itemId = requireItemId(c.req.param("id"));
    const payload = putAiFeedbackRequestSchema.parse(await readJsonObject(c));
    await feedback.putActionCardItemFeedback({
      actor: c.var.actor,
      itemId,
      verdict: payload.verdict,
      note: payload.note ?? null
    });
    return c.body(null, 204);
  });

  // 204 / 403 / 404（幂等撤销）。
  routes.delete("/action-card-items/:id/feedback", requireCurrentUser, async (c) => {
    const itemId = requireItemId(c.req.param("id"));
    await feedback.removeActionCardItemFeedback({ actor: c.var.actor, itemId });
    return c.body(null, 204);
  });

  return routes;
}
