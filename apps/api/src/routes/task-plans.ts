import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { normalizeWorkHubLocale } from "@workhub/contracts";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthActor,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  getDefaultTaskPlanWorkflowService,
  TaskPlanServiceError,
  type TaskPlanWorkflowService
} from "../services/task-plans.js";
import {
  getDefaultWorkItemService,
  type WorkItemService
} from "../services/work-items.js";
import { readJsonObject } from "./json-body.js";
import { isUuidParam } from "./uuid-param.js";

// B-R9.1-2（branch-review 注入面）：请求体禁止携带 memories——那是可伪造的
// 「团队记忆」直入 planner prompt 的注入面。记忆一律服务端读 user_memories/team_skills。
// body 里多余字段（含旧客户端残留的 memories）静默忽略，保持向后兼容。
const taskPlanRequestSchema = z.object({}).passthrough().default({});

export type TaskPlanRoutesDependencies = {
  auth?: AuthDependencySource;
  service?: TaskPlanWorkflowService;
  workItems?: Pick<WorkItemService, "detailPage" | "assertCanMutateArtifacts"> | false;
};

function requireWorkItemId(value: string) {
  if (!isUuidParam(value)) {
    throw new HTTPException(404, { message: "没有找到这个事项。" });
  }
  return value;
}

function actorForPlanner(actor: AuthActor) {
  return {
    id: actor.userId ?? actor.id,
    userId: actor.userId ?? actor.id,
    ...(actor.workspaceId ? { workspaceId: actor.workspaceId } : {}),
    label: actor.label
  };
}

export function createTaskPlanRoutes(deps: TaskPlanRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const service = deps.service ?? getDefaultTaskPlanWorkflowService();
  const workItems = deps.workItems === false ? undefined : deps.workItems ?? getDefaultWorkItemService();

  routes.post("/workitems/:id/task-plan", createCurrentUserMiddleware(authSource), async (c) => {
    if (!workItems) {
      throw new HTTPException(403, { message: "没有权限修改这个事项。" });
    }
    const workItemId = requireWorkItemId(c.req.param("id"));
    await workItems.assertCanMutateArtifacts({ workItemId, actor: c.var.actor });
    taskPlanRequestSchema.parse(await readJsonObject(c));
    const detail = await workItems.detailPage({ workItemId, actor: c.var.actor });
    let result;
    try {
      result = await service.createPlanProposal({
        detail,
        actor: actorForPlanner(c.var.actor),
        locale: normalizeWorkHubLocale(c.req.query("locale") ?? c.req.header("Accept-Language"))
      });
    } catch (error) {
      if (error instanceof TaskPlanServiceError) {
        return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as 400);
      }
      throw error;
    }
    const { reviews: _reviews, ...proposal } = result.proposal;
    return c.json({
      ok: true,
      data: {
        plan_id: result.planId,
        proposal_id: proposal.id,
        proposal_href: `/proposals/${proposal.id}`,
        proposal
      }
    }, 201);
  });

  return routes;
}
