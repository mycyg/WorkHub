import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  getDefaultObjectiveService,
  type ObjectiveService
} from "../services/objectives.js";
import {
  getDefaultWorkItemService,
  WorkItemServiceError,
  type WorkItemService
} from "../services/work-items.js";
import { readJsonObject } from "./json-body.js";
import { isUuidParam } from "./uuid-param.js";

// B-R9.5-1（branch-review 整块死接线）：objectives 此前只有表和函数，没有任何创建/链接
// 入口——这里补上最小闭环：建目标（含关键结果）+ 把工作项挂到目标上。
const createObjectiveRequestSchema = z.object({
  title: z.string().trim().min(1).max(256),
  description_md: z.string().trim().max(4_000).optional(),
  key_results: z.array(z.object({
    title: z.string().trim().min(1).max(256),
    target_value: z.string().trim().max(64).optional(),
    current_value: z.string().trim().max(64).optional(),
    unit: z.string().trim().max(16).optional()
  })).max(8).default([])
});

const linkObjectiveRequestSchema = z.object({
  work_item_id: z.string().uuid()
});

export type ObjectiveRoutesDependencies = {
  auth?: AuthDependencySource;
  service?: ObjectiveService;
  workItems?: Pick<WorkItemService, "assertCanMutateWorkItem"> | false;
};

export function createObjectiveRoutes(deps: ObjectiveRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const service = deps.service ?? getDefaultObjectiveService();
  const workItems = deps.workItems === false ? undefined : deps.workItems ?? getDefaultWorkItemService();

  routes.post("/", createCurrentUserMiddleware(authSource), async (c) => {
    const workspaceId = c.var.actor.workspaceId;
    if (!workspaceId) {
      throw new HTTPException(403, { message: "没有权限创建目标。" });
    }
    const payload = createObjectiveRequestSchema.parse(await readJsonObject(c));
    const objective = await service.createObjective({
      workspaceId,
      title: payload.title,
      ...(payload.description_md ? { descriptionMd: payload.description_md } : {}),
      ownerUserId: c.var.actor.userId ?? c.var.actor.id,
      keyResults: payload.key_results.map((keyResult) => ({
        title: keyResult.title,
        ...(keyResult.target_value ? { targetValue: keyResult.target_value } : {}),
        ...(keyResult.current_value ? { currentValue: keyResult.current_value } : {}),
        ...(keyResult.unit ? { unit: keyResult.unit } : {})
      }))
    });
    return c.json({
      ok: true,
      data: {
        objective_id: objective.id,
        title: objective.title,
        status: objective.status,
        progress_percent: objective.progressPercent
      }
    }, 201);
  });

  routes.post("/:id/link", createCurrentUserMiddleware(authSource), async (c) => {
    const objectiveId = c.req.param("id");
    if (!isUuidParam(objectiveId)) {
      throw new HTTPException(404, { message: "没有找到这个目标。" });
    }
    const workspaceId = c.var.actor.workspaceId;
    if (!workspaceId) {
      throw new HTTPException(403, { message: "没有权限修改目标。" });
    }
    const payload = linkObjectiveRequestSchema.parse(await readJsonObject(c));
    // 挂链是对工作项的治理写动作：按工作项写权限收口（B-R9.0-1 同款铁律）。
    if (workItems) {
      try {
        await workItems.assertCanMutateWorkItem({ workItemId: payload.work_item_id, actor: c.var.actor });
      } catch (error) {
        if (error instanceof WorkItemServiceError) {
          throw new HTTPException(error.status as 403, { message: error.message });
        }
        throw error;
      }
    }
    await service.linkWorkItem({
      workspaceId,
      objectiveId,
      workItemId: payload.work_item_id,
      linkedByUserId: c.var.actor.userId ?? c.var.actor.id
    });
    return c.json({ ok: true, data: { objective_id: objectiveId, work_item_id: payload.work_item_id } });
  });

  return routes;
}
