// R16 批 W4a（项目级自定义指令）：GET/PATCH /api/projects/:id/instructions 的 HTTP 出口——形状仿
// routes/project-timeline.ts（同一道 canManageProjectDrive 项目级守卫，payload 解析在服务层权限检查
// 之前，权限失败/找不到项目由 ProjectInstructionsServiceError 经 app.onError 统一映射）。
import { Hono } from "hono";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import { patchProjectInstructionsRequestSchema } from "@workhub/contracts";
import {
  getDefaultProjectInstructionsService,
  ProjectInstructionsServiceError,
  type ProjectInstructionsService
} from "../services/project-instructions.js";
import { readJsonObject } from "./json-body.js";
import { isUuidParam } from "./uuid-param.js";

export type ProjectInstructionsRoutesDependencies = {
  auth?: AuthDependencySource;
  service?: ProjectInstructionsService;
};

function requireProjectId(value: string): string {
  if (!isUuidParam(value)) {
    throw new ProjectInstructionsServiceError(404, "project_not_found", "没有找到这个项目。");
  }
  return value;
}

export function createProjectInstructionsRoutes(deps: ProjectInstructionsRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const service = deps.service ?? getDefaultProjectInstructionsService();
  const requireCurrentUser = createCurrentUserMiddleware(authSource);

  routes.get("/projects/:id/instructions", requireCurrentUser, async (c) => {
    const projectId = requireProjectId(c.req.param("id"));
    const data = await service.getInstructions({ projectId, actor: c.var.actor });
    return c.json({ ok: true, data });
  });

  routes.patch("/projects/:id/instructions", requireCurrentUser, async (c) => {
    const projectId = requireProjectId(c.req.param("id"));
    const payload = patchProjectInstructionsRequestSchema.parse(await readJsonObject(c));
    const data = await service.patchInstructions({ projectId, actor: c.var.actor, payload });
    return c.json({ ok: true, data });
  });

  return routes;
}
