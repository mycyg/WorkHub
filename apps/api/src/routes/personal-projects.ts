import { Hono } from "hono";

import { createPersonalProjectRequestSchema } from "@workhub/contracts";

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
import { readJsonObject } from "./json-body.js";

// R13 批 S3（个人空间）：GET/POST /api/me/personal-projects（与既有 /api/me/ai-profile、
// /api/me/army 同一个 "/me" 前缀风格）。已挂载进 app.ts（`app.route("/api",
// createPersonalProjectRoutes())`，2026-07-13）、OpenAPI 描述也已在 openapi.ts 里——
// R23 P2（SA-05）web 端的「新建个人空间」按钮（apps/web/src/browser.ts）与 SDK 方法
// （packages/api-client 的 listPersonalProjects/createPersonalProject）都已接上这两个端点。
export type PersonalProjectRoutesDependencies = {
  auth?: AuthDependencySource;
  projects?: ProjectService;
};

function handleProjectError(error: unknown): never {
  if (error instanceof ProjectServiceError) {
    throw error;
  }
  throw error;
}

export function createPersonalProjectRoutes(deps: PersonalProjectRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const projects = deps.projects ?? getDefaultProjectService();

  routes.get("/me/personal-projects", createCurrentUserMiddleware(authSource), async (c) => {
    try {
      const data = await projects.listPersonalProjects({ actor: c.var.actor });
      return c.json({ ok: true, data });
    } catch (error) {
      handleProjectError(error);
    }
  });

  routes.post("/me/personal-projects", createCurrentUserMiddleware(authSource), async (c) => {
    const payload = createPersonalProjectRequestSchema.parse(await readJsonObject(c));
    try {
      const data = await projects.createPersonalProject({ payload, actor: c.var.actor });
      return c.json({ ok: true, data }, data.created ? 201 : 200);
    } catch (error) {
      handleProjectError(error);
    }
  });

  return routes;
}
