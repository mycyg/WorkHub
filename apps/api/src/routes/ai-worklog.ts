import { Hono } from "hono";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  getDefaultAiWorklogMetricsService,
  type AiWorklogMetricsService
} from "../services/ai-worklog-metrics.js";

export type AiWorklogRoutesDependencies = {
  auth?: AuthDependencySource;
  metrics?: AiWorklogMetricsService;
};

export function createAiWorklogRoutes(deps: AiWorklogRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const metrics = deps.metrics ?? getDefaultAiWorklogMetricsService();

  // 非 admin：所有登录用户都能看到"今天 AI 干了多少活"（不含成本明细，成本仍走 admin cost 页）。
  routes.get("/today", createCurrentUserMiddleware(authSource), async (c) => {
    // AUTHZ-2：与首页横幅(/api/pages/attention)同源,同样按请求者工作区收口,避免跨租户聚合泄露。
    const data = await metrics.getTodayMetrics({ workspaceId: c.var.actor.workspaceId });
    return c.json({ ok: true, data });
  });

  return routes;
}
