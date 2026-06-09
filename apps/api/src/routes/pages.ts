import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { settings } from "@workhub/config";
import { decideRunBudget, type BudgetPolicyStore, type CostLedgerStore } from "@workhub/cost";
import { normalizeWorkHubLocale, type WorkHubLocale } from "@workhub/contracts";

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
import { buildP05GoldPathSurfacePage } from "../pages/gold-path.js";
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
  getDefaultWorkItemService,
  WorkItemServiceError,
  type WorkItemService
} from "../services/work-items.js";
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
  workItems?: WorkItemService;
  allowUnauthenticatedGoldPath?: boolean;
};

function requestLocale(c: { req: { query: (key: string) => string | undefined; header: (key: string) => string | undefined } }): WorkHubLocale {
  return normalizeWorkHubLocale(c.req.query("locale") ?? c.req.header("Accept-Language"));
}

function pageEnvelope<T>(data: T, locale: WorkHubLocale) {
  return {
    ok: true,
    data,
    meta: {
      locale
    }
  } as const;
}

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
  const workItems = deps.workItems ?? getDefaultWorkItemService();

  routes.get("/attention", createCurrentUserMiddleware(authSource), async (c) => {
    const activeRuns = await queue.listActive();
    return c.json(pageEnvelope(buildAttentionHomePage({ backgroundRuns: activeRuns }), requestLocale(c)));
  });

  if (allowUnauthenticatedGoldPath) {
    routes.get("/gold-path", (c) => {
      return c.json(pageEnvelope(buildP05GoldPathSurfacePage(), requestLocale(c)));
    });
  } else {
    routes.get("/gold-path", createCurrentUserMiddleware(authSource), (c) => {
      return c.json(pageEnvelope(buildP05GoldPathSurfacePage(), requestLocale(c)));
    });
  }

  routes.get("/approvals", createCurrentUserMiddleware(authSource), async (c) => {
    const data = await approvals.listPendingForUser(c.var.currentUser);
    return c.json(pageEnvelope(data, requestLocale(c)));
  });

  routes.get("/workitems/:id", createCurrentUserMiddleware(authSource), async (c) => {
    try {
      const data = await workItems.detailPage({
        workItemId: c.req.param("id"),
        actor: c.var.actor
      });
      return c.json(pageEnvelope(data, requestLocale(c)));
    } catch (error) {
      if (error instanceof WorkItemServiceError) {
        throw new HTTPException(error.status as 400, { message: error.message });
      }
      throw error;
    }
  });

  routes.get("/proposals/:id", createCurrentUserMiddleware(authSource), async (c) => {
    const proposal = await proposals.get(c.req.param("id"));
    if (!proposal) {
      throw new HTTPException(404, { message: "没有找到这个变更申请。" });
    }
    return c.json(pageEnvelope(buildProposalDetailPage(proposal), requestLocale(c)));
  });

  routes.get("/cost", createCurrentUserMiddleware(authSource), async (c) => {
    const teamId = settings.auth.defaultWorkspaceId;
    const decision = decideRunBudget({
      settings,
      scopeIds: {
        userId: c.var.currentUser.id,
        teamId
      },
      policies: await policyStore.listPolicies(settings),
      usage: await ledgerStore.usageSnapshots({ userId: c.var.currentUser.id, teamId })
    });
    const data = buildCostDashboardPage({
      settings,
      isAdmin: c.var.currentUser.isAdmin,
      userId: c.var.currentUser.id,
      budgetUsages: decision.usages,
      ledgerEntries: ledgerStore.listEntries ? await ledgerStore.listEntries() : ledgerStore.entries
    });
    return c.json(pageEnvelope(data, requestLocale(c)));
  });

  return routes;
}
