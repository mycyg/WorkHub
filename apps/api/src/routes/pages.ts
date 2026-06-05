import { Hono } from "hono";

import { settings } from "@workhub/config";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import { buildAttentionHomePage } from "../pages/attention.js";
import { buildCostDashboardPage } from "../pages/cost.js";
import {
  createApprovalService,
  type ApprovalService
} from "../services/approvals.js";
import {
  getDefaultAgentRunQueue,
  type AgentRunQueue
} from "../workers/agent-runner.js";

export type PageRoutesDependencies = {
  auth?: AuthDependencySource;
  approvals?: ApprovalService;
  queue?: AgentRunQueue;
};

export function createPageRoutes(deps: PageRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const approvals = deps.approvals ?? createApprovalService();
  const queue = deps.queue ?? getDefaultAgentRunQueue();

  routes.get("/attention", createCurrentUserMiddleware(authSource), async (c) => {
    const activeRuns = await queue.listActive();
    return c.json({ ok: true, data: buildAttentionHomePage({ backgroundRuns: activeRuns }) });
  });

  routes.get("/approvals", createCurrentUserMiddleware(authSource), async (c) => {
    const data = await approvals.listPendingForUser(c.var.currentUser);
    return c.json({ ok: true, data });
  });

  routes.get("/cost", createCurrentUserMiddleware(authSource), async (c) => {
    const data = buildCostDashboardPage({
      settings,
      isAdmin: c.var.currentUser.isAdmin,
      userId: c.var.currentUser.id
    });
    return c.json({ ok: true, data });
  });

  return routes;
}
