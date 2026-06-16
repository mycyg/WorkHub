import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

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

export type ProjectRoutesDependencies = {
  auth?: AuthDependencySource;
  projects?: ProjectService;
};

function handleProjectError(error: unknown): never {
  if (error instanceof ProjectServiceError) {
    throw new HTTPException(error.status as 400, { message: error.message });
  }
  throw error;
}

async function optionalJson(req: { text: () => Promise<string> }) {
  const text = await req.text();
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HTTPException(400, { message: "项目请求不是有效的 JSON。" });
  }
}

export function createProjectRoutes(deps: ProjectRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const projects = deps.projects ?? getDefaultProjectService();

  routes.get("/", createCurrentUserMiddleware(authSource), async (c) => {
    try {
      const data = await projects.listProjects({ actor: c.var.actor });
      return c.json({ ok: true, data });
    } catch (error) {
      handleProjectError(error);
    }
  });

  routes.post("/bootstrap", createCurrentUserMiddleware(authSource), async (c) => {
    const payload = bootstrapProjectRequestSchema.parse(await optionalJson(c.req));
    try {
      const data = await projects.bootstrapProject({ payload, actor: c.var.actor });
      return c.json({ ok: true, data }, data.created ? 201 : 200);
    } catch (error) {
      handleProjectError(error);
    }
  });

  return routes;
}
