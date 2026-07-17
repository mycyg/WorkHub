import { Hono } from "hono";

import { bootstrapProjectRequestSchema } from "@workhub/contracts";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  getDefaultProjectService,
  ProjectServiceError,
  type ProjectService
} from "../services/projects.js";
import {
  getDefaultProjectOpsService,
  type ProjectOpsService
} from "../services/project-ops.js";
import { readJsonObject } from "./json-body.js";
import { isUuidParam } from "./uuid-param.js";

export type ProjectRoutesDependencies = {
  auth?: AuthDependencySource;
  projects?: ProjectService;
  projectOps?: ProjectOpsService;
};

// 路由 uuid 形参先校验：非 uuid 串原本直达服务层的 uuid 列 → PG 22P02 → 误报 500；
// 非法即抛与「合法但不存在」同样的 404（ProjectServiceError，经 app.onError 收口）。
function requireProjectId(value: string): string {
  if (!isUuidParam(value)) {
    throw new ProjectServiceError(404, "project_not_found", "没有找到这个项目。");
  }
  return value;
}

function handleProjectError(error: unknown): never {
  if (error instanceof ProjectServiceError) {
    throw error;
  }
  throw error;
}

export function createProjectRoutes(deps: ProjectRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const projects = deps.projects ?? getDefaultProjectService();
  const projectOps = deps.projectOps ?? getDefaultProjectOpsService();

  routes.get("/", createCurrentUserMiddleware(authSource), async (c) => {
    try {
      const data = await projects.listProjects({ actor: c.var.actor });
      return c.json({ ok: true, data });
    } catch (error) {
      handleProjectError(error);
    }
  });

  routes.post("/bootstrap", createCurrentUserMiddleware(authSource), async (c) => {
    const payload = bootstrapProjectRequestSchema.parse(await readJsonObject(c));
    try {
      const data = await projects.bootstrapProject({ payload, actor: c.var.actor });
      return c.json({ ok: true, data }, data.created ? 201 : 200);
    } catch (error) {
      handleProjectError(error);
    }
  });

  // R20 P2A（R19-19）：归档——软置 archived=true，从团队项目列表隐去。管理员/项目所有者门控。
  routes.post("/:id/archive", createCurrentUserMiddleware(authSource), async (c) => {
    const projectId = requireProjectId(c.req.param("id"));
    try {
      const data = await projectOps.archiveProject({ projectId, actor: c.var.actor });
      return c.json({ ok: true, data });
    } catch (error) {
      handleProjectError(error);
    }
  });

  // R20 P2A（R19-19）：软删——软置 deletedAt（墓碑）。管理员/项目所有者门控。
  routes.post("/:id/delete", createCurrentUserMiddleware(authSource), async (c) => {
    const projectId = requireProjectId(c.req.param("id"));
    try {
      const data = await projectOps.deleteProject({ projectId, actor: c.var.actor });
      return c.json({ ok: true, data });
    } catch (error) {
      handleProjectError(error);
    }
  });

  return routes;
}
