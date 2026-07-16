// R15 批 E1b：项目时间线写路径的 HTTP 出口——里程碑 CRUD + 依赖增删 + 工作项挂里程碑。
// 全部经 createCurrentUserMiddleware 收口（未鉴权 401，route-auth-posture 门兜底）；领域错误经
// ProjectTimelineServiceError / WorkItemServiceError 走 app.onError 统一映射。
import { Hono } from "hono";
import { z } from "zod";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  getDefaultProjectTimelineService,
  ProjectTimelineServiceError,
  type ProjectTimelineService
} from "../services/project-timeline.js";
import { readJsonObject } from "./json-body.js";
import { isUuidParam } from "./uuid-param.js";

const createMilestoneRequestSchema = z.object({
  title: z.string().trim().min(1).max(256),
  due_at: z.string().datetime({ offset: true }).nullish(),
  sort: z.number().int().min(0).max(1_000_000).optional()
});

const updateMilestoneRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(256).optional(),
    due_at: z.string().datetime({ offset: true }).nullable().optional(),
    sort: z.number().int().min(0).max(1_000_000).optional(),
    status: z.enum(["open", "done"]).optional()
  })
  .refine((value) => Object.keys(value).length > 0, { message: "至少要改一个字段。" });

const dependencyRequestSchema = z.object({
  depends_on: z.string().uuid()
});

const attachMilestoneRequestSchema = z.object({
  milestone_id: z.string().uuid().nullable()
});

export type ProjectTimelineRoutesDependencies = {
  auth?: AuthDependencySource;
  service?: ProjectTimelineService;
};

function requireProjectId(value: string): string {
  if (!isUuidParam(value)) {
    throw new ProjectTimelineServiceError(404, "project_not_found", "没有找到这个项目。");
  }
  return value;
}

function requireMilestoneId(value: string): string {
  if (!isUuidParam(value)) {
    throw new ProjectTimelineServiceError(404, "milestone_not_found", "没有找到这个里程碑。");
  }
  return value;
}

function requireWorkItemId(value: string): string {
  if (!isUuidParam(value)) {
    throw new ProjectTimelineServiceError(404, "work_item_not_found", "没有找到这个工作项。");
  }
  return value;
}

export function createProjectTimelineRoutes(deps: ProjectTimelineRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const service = deps.service ?? getDefaultProjectTimelineService();

  routes.post("/projects/:id/milestones", createCurrentUserMiddleware(authSource), async (c) => {
    const projectId = requireProjectId(c.req.param("id"));
    const payload = createMilestoneRequestSchema.parse(await readJsonObject(c));
    const data = await service.createMilestone({
      projectId,
      actor: c.var.actor,
      title: payload.title,
      ...(payload.due_at !== undefined ? { dueAt: payload.due_at ? new Date(payload.due_at) : null } : {}),
      ...(payload.sort !== undefined ? { sort: payload.sort } : {})
    });
    return c.json({ ok: true, data }, 201);
  });

  routes.patch("/projects/:id/milestones/:milestoneId", createCurrentUserMiddleware(authSource), async (c) => {
    const projectId = requireProjectId(c.req.param("id"));
    const milestoneId = requireMilestoneId(c.req.param("milestoneId"));
    const payload = updateMilestoneRequestSchema.parse(await readJsonObject(c));
    const data = await service.updateMilestone({
      projectId,
      milestoneId,
      actor: c.var.actor,
      ...(payload.title !== undefined ? { title: payload.title } : {}),
      ...(payload.due_at !== undefined ? { dueAt: payload.due_at ? new Date(payload.due_at) : null } : {}),
      ...(payload.sort !== undefined ? { sort: payload.sort } : {}),
      ...(payload.status !== undefined ? { status: payload.status } : {})
    });
    return c.json({ ok: true, data });
  });

  routes.delete("/projects/:id/milestones/:milestoneId", createCurrentUserMiddleware(authSource), async (c) => {
    const projectId = requireProjectId(c.req.param("id"));
    const milestoneId = requireMilestoneId(c.req.param("milestoneId"));
    await service.deleteMilestone({ projectId, milestoneId, actor: c.var.actor });
    return c.json({ ok: true, data: { milestone_id: milestoneId } });
  });

  routes.post("/workitems/:id/dependencies", createCurrentUserMiddleware(authSource), async (c) => {
    const workItemId = requireWorkItemId(c.req.param("id"));
    const payload = dependencyRequestSchema.parse(await readJsonObject(c));
    const data = await service.addDependency({
      workItemId,
      dependsOnWorkItemId: payload.depends_on,
      actor: c.var.actor
    });
    return c.json({ ok: true, data }, data.created ? 201 : 200);
  });

  routes.delete("/workitems/:id/dependencies", createCurrentUserMiddleware(authSource), async (c) => {
    const workItemId = requireWorkItemId(c.req.param("id"));
    const payload = dependencyRequestSchema.parse(await readJsonObject(c));
    const data = await service.removeDependency({
      workItemId,
      dependsOnWorkItemId: payload.depends_on,
      actor: c.var.actor
    });
    return c.json({ ok: true, data });
  });

  routes.patch("/workitems/:id/milestone", createCurrentUserMiddleware(authSource), async (c) => {
    const workItemId = requireWorkItemId(c.req.param("id"));
    const payload = attachMilestoneRequestSchema.parse(await readJsonObject(c));
    const data = await service.attachMilestone({
      workItemId,
      milestoneId: payload.milestone_id,
      actor: c.var.actor
    });
    return c.json({ ok: true, data });
  });

  return routes;
}
