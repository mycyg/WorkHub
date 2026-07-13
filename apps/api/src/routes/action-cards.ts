import { Hono } from "hono";
import { z } from "zod";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  ActionCardServiceError,
  getDefaultActionCardService,
  type ActionCardService
} from "../services/action-cards.js";
import { readJsonObject } from "./json-body.js";
import { isUuidParam } from "./uuid-param.js";

// R12 批3：行动卡条目的决策/撤销端点。这个模块**不挂载**到 app.ts——由批3之后的集成者决定挂在哪个
// 路由前缀下（见 r12-desktop-workbench/reports/batch-3-server.md「未挂载清单」）。

export type ActionCardRoutesDependencies = {
  auth?: AuthDependencySource;
  actionCards?: ActionCardService;
};

const decideActionCardItemRequestSchema = z
  .object({
    action: z.enum(["claim", "reassign", "defer"]),
    assignee_user_id: z.string().uuid().optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action === "reassign" && !value.assignee_user_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assignee_user_id"],
        message: "reassign requires assignee_user_id"
      });
    }
    if (value.action !== "reassign" && value.assignee_user_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assignee_user_id"],
        message: "assignee_user_id is only accepted for the reassign action"
      });
    }
  });

function requireItemId(value: string) {
  if (!isUuidParam(value)) {
    throw new ActionCardServiceError(404, "action_card_item_not_found", "没有找到这个行动卡条目。");
  }
  return value;
}

export function createActionCardRoutes(deps: ActionCardRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const actionCards = deps.actionCards ?? getDefaultActionCardService();
  const requireCurrentUser = createCurrentUserMiddleware(authSource);

  routes.post("/action-card-items/:id/decide", requireCurrentUser, async (c) => {
    const itemId = requireItemId(c.req.param("id"));
    const payload = decideActionCardItemRequestSchema.parse(await readJsonObject(c));
    const data = await actionCards.decide({
      actor: c.var.actor,
      itemId,
      action: payload.action,
      ...(payload.assignee_user_id ? { assigneeUserId: payload.assignee_user_id } : {})
    });
    return c.json({ ok: true, data });
  });

  routes.post("/action-card-items/:id/undo", requireCurrentUser, async (c) => {
    const itemId = requireItemId(c.req.param("id"));
    const data = await actionCards.undo({ actor: c.var.actor, itemId });
    return c.json({ ok: true, data });
  });

  return routes;
}
