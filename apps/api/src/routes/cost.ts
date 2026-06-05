import { Hono } from "hono";

import { settings } from "@workhub/config";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import { buildCostSummary } from "../pages/cost.js";

export type CostRoutesDependencies = {
  auth?: AuthDependencySource;
};

export function createCostRoutes(deps: CostRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;

  routes.get("/usage", createCurrentUserMiddleware(authSource), (c) => {
    const data = buildCostSummary({
      settings,
      isAdmin: c.var.currentUser.isAdmin,
      userId: c.var.currentUser.id
    });
    return c.json({ ok: true, data });
  });

  return routes;
}
