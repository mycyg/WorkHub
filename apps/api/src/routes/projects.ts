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
import { readJsonObject } from "./json-body.js";

export type ProjectRoutesDependencies = {
  auth?: AuthDependencySource;
  projects?: ProjectService;
};

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

  return routes;
}
