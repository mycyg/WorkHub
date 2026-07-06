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
  type TaskPlanWorkflowService
} from "../services/task-plans.js";
import {
  getDefaultWorkItemService,
  type WorkItemService
} from "../services/work-items.js";
import { readJsonObject } from "./json-body.js";
import { isUuidParam } from "./uuid-param.js";

const taskPlanRequestSchema = z.object({
  objective_id: z.string().uuid().optional(),
  memories: z.object({
    user: z.array(z.string().min(1).max(1_000)).max(20).optional(),
    team: z.array(z.string().min(1).max(1_000)).max(20).optional()
  }).optional()
}).default({});

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

function memoriesForPlanner(input: z.infer<typeof taskPlanRequestSchema>["memories"]) {
  if (!input) {
    return undefined;
  }
  const memories: { user?: string[]; team?: string[] } = {};
  if (input.user) {
    memories.user = input.user;
  }
  if (input.team) {
    memories.team = input.team;
  }
  return memories.user || memories.team ? memories : undefined;
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
    const payload = taskPlanRequestSchema.parse(await readJsonObject(c));
    const detail = await workItems.detailPage({ workItemId, actor: c.var.actor });
    const memories = memoriesForPlanner(payload.memories);
    const result = await service.createPlanProposal({
      detail,
      actor: actorForPlanner(c.var.actor),
      locale: normalizeWorkHubLocale(c.req.query("locale") ?? c.req.header("Accept-Language")),
      ...(payload.objective_id ? { objectiveId: payload.objective_id } : {}),
      ...(memories ? { memories } : {})
    });
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
