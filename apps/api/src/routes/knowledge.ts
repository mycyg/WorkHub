import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";

export type KnowledgeRoutesDependencies = {
  auth?: AuthDependencySource;
};

const serviceUnavailableMessage = "真实知识库检索服务尚未接入；演示 fixture 只保留在 /api/pages/gold-path 页面包。";

export function createKnowledgeRoutes(deps: KnowledgeRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;

  routes.post("/search", createCurrentUserMiddleware(authSource), (c) => {
    throw new HTTPException(501, { message: serviceUnavailableMessage });
  });

  return routes;
}
