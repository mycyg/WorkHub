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

// R14 批 FEEDBACK（提议卡的「有用/没用」轻反馈）：**不挂载**，挂载归集成者（同 conversation-message-
// feedback.ts 的说明）。可见性复用 canReadWorkItem（与 GET /proposals/:id 同款判定），status 不限
// （merged/rejected 之后依然可以回头打分，见设计 §2）。

export type ProposalFeedbackRoutesDependencies = {
  auth?: AuthDependencySource;
  feedback?: AiFeedbackService;
};

function requireProposalId(value: string) {
  if (!isUuidParam(value)) {
    throw new AiFeedbackServiceError(404, "ai_feedback_subject_not_found", "没有找到这个变更申请。");
  }
  return value;
}

export function createProposalFeedbackRoutes(deps: ProposalFeedbackRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const feedback = deps.feedback ?? getDefaultAiFeedbackService();
  const requireCurrentUser = createCurrentUserMiddleware(authSource);

  // 204 / 400 / 403(canReadWorkItem 未过) / 404(不存在)。
  routes.put("/proposals/:id/feedback", requireCurrentUser, async (c) => {
    const proposalId = requireProposalId(c.req.param("id"));
    const payload = putAiFeedbackRequestSchema.parse(await readJsonObject(c));
    await feedback.putProposalFeedback({
      actor: c.var.actor,
      proposalId,
      verdict: payload.verdict,
      note: payload.note ?? null
    });
    return c.body(null, 204);
  });

  // 204 / 403 / 404（幂等撤销）。
  routes.delete("/proposals/:id/feedback", requireCurrentUser, async (c) => {
    const proposalId = requireProposalId(c.req.param("id"));
    await feedback.removeProposalFeedback({ actor: c.var.actor, proposalId });
    return c.body(null, 204);
  });

  return routes;
}
