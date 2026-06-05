import { Hono } from "hono";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import { getP05GoldPathFixture } from "../pages/gold-path.js";

export type KnowledgeRoutesDependencies = {
  auth?: AuthDependencySource;
};

export function createKnowledgeRoutes(deps: KnowledgeRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;

  routes.post("/search", createCurrentUserMiddleware(authSource), (c) => {
    return c.json({ ok: true, data: getP05GoldPathFixture().evidenceBubble });
  });

  return routes;
}
