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

// R13 批 S3（个人空间）：故意不在 app.ts 里挂载这个路由器——04 铁律范围围栏禁碰 app.ts/openapi.ts
// （多个并行批次同时在改这两个文件，谁都不改能避免合并冲突）。这个文件本身是完整、可测的真实现，
// 只是运行时的 Hono 实例暂时访问不到它——集成时把下面两行接进 app.ts、并把这两个端点的 OpenAPI
// 描述补进 openapi.ts（同一次改动里做，否则会撞 app.test.ts 的
// "runtime API routes stay in lockstep with the OpenAPI document" 门）：
//
//   import { createPersonalProjectRoutes } from "./routes/personal-projects.js";
//   app.route("/api", createPersonalProjectRoutes());
//
// 挂载后端点是 GET/POST /api/me/personal-projects（与既有 /api/me/ai-profile、/api/me/army 同一个
// "/me" 前缀风格）。
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
