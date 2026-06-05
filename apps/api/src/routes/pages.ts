import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { settings } from "@workhub/config";
import { decideRunBudget, type BudgetPolicyStore, type CostLedgerStore } from "@workhub/cost";

import {
  createCurrentUserMiddleware,
  getAuthSettings,
  getDefaultAuthDependencies,
  resolveAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import { buildAttentionHomePage } from "../pages/attention.js";
import { buildCostDashboardPage } from "../pages/cost.js";
import {
  buildP05GoldPathSurfacePage,
  getP05GoldPathFixture,
  isP05ProposalId,
  isP05WorkItemId
} from "../pages/gold-path.js";
import { buildProposalDetailPage } from "../pages/proposals.js";
import {
  createApprovalService,
  type ApprovalService
} from "../services/approvals.js";
import {
  getDefaultProposalService,
  type ProposalService
} from "../services/proposals.js";
import {
  getDefaultAgentRunQueue,
  type AgentRunQueue
} from "../workers/agent-runner.js";
import { getDefaultCostLedgerStore } from "../services/cost-ledger-store.js";
import { getDefaultBudgetPolicyStore } from "../services/cost-policy-store.js";

export type PageRoutesDependencies = {
  auth?: AuthDependencySource;
  approvals?: ApprovalService;
  proposals?: ProposalService;
  queue?: AgentRunQueue;
  policyStore?: BudgetPolicyStore;
  ledgerStore?: CostLedgerStore;
  allowUnauthenticatedGoldPath?: boolean;
};

export function createPageRoutes(deps: PageRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const authSettings = getAuthSettings(resolveAuthDependencies(authSource));
  const allowUnauthenticatedGoldPath = deps.allowUnauthenticatedGoldPath ?? authSettings.appEnv !== "production";
  const approvals = deps.approvals ?? createApprovalService();
  const proposals = deps.proposals ?? getDefaultProposalService();
  const queue = deps.queue ?? getDefaultAgentRunQueue();
  const policyStore = deps.policyStore ?? getDefaultBudgetPolicyStore();
  const ledgerStore = deps.ledgerStore ?? getDefaultCostLedgerStore();

  routes.get("/attention", createCurrentUserMiddleware(authSource), async (c) => {
    const activeRuns = await queue.listActive();
    return c.json({ ok: true, data: buildAttentionHomePage({ backgroundRuns: activeRuns }) });
  });

  if (allowUnauthenticatedGoldPath) {
    routes.get("/gold-path", (c) => {
      return c.json({ ok: true, data: buildP05GoldPathSurfacePage() });
    });
  } else {
    routes.get("/gold-path", createCurrentUserMiddleware(authSource), (c) => {
      return c.json({ ok: true, data: buildP05GoldPathSurfacePage() });
    });
  }

  routes.get("/approvals", createCurrentUserMiddleware(authSource), async (c) => {
    const data = await approvals.listPendingForUser(c.var.currentUser);
    return c.json({ ok: true, data });
  });

  routes.get("/workitems/:id", createCurrentUserMiddleware(authSource), (c) => {
    if (!isP05WorkItemId(c.req.param("id"))) {
      throw new HTTPException(404, { message: "没有找到这个事项页面。" });
    }
    return c.json({ ok: true, data: getP05GoldPathFixture().workItemDetail });
  });

  routes.get("/proposals/:id", createCurrentUserMiddleware(authSource), async (c) => {
    if (!isP05ProposalId(c.req.param("id"))) {
      const proposal = await proposals.get(c.req.param("id"));
      if (!proposal) {
        throw new HTTPException(404, { message: "没有找到这个变更申请。" });
      }
      return c.json({ ok: true, data: buildProposalDetailPage(proposal) });
    }
    return c.json({ ok: true, data: getP05GoldPathFixture().proposalDetail });
  });

  routes.get("/cost", createCurrentUserMiddleware(authSource), async (c) => {
    const teamId = settings.auth.defaultWorkspaceId;
    const decision = decideRunBudget({
      settings,
      scopeIds: {
        userId: c.var.currentUser.id,
        teamId
      },
      policies: policyStore.listPolicies(settings),
      usage: ledgerStore.usageSnapshots({ userId: c.var.currentUser.id, teamId })
    });
    const data = buildCostDashboardPage({
      settings,
      isAdmin: c.var.currentUser.isAdmin,
      userId: c.var.currentUser.id,
      budgetUsages: decision.usages,
      ledgerEntries: ledgerStore.entries
    });
    return c.json({ ok: true, data });
  });

  return routes;
}
