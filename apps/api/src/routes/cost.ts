import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { settings } from "@workhub/config";
import {
  budgetPolicySchema,
  budgetPolicyUpdateSchema,
  type BudgetPolicy as ApiBudgetPolicy,
  type BudgetPolicyUpdate as ApiBudgetPolicyUpdate
} from "@workhub/contracts";
import {
  decideRunBudget,
  type BudgetPolicy as CostBudgetPolicy,
  type BudgetPolicyPatch,
  type BudgetPolicyStore,
  type CostLedgerStore
} from "@workhub/cost";
import type { CreateAuditLogInput } from "@workhub/db";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import { buildCostSummary } from "../pages/cost.js";
import { getDefaultCostLedgerStore } from "../services/cost-ledger-store.js";
import {
  getDefaultBudgetPolicyAuditLogRepository,
  getDefaultBudgetPolicyStore
} from "../services/cost-policy-store.js";

type BudgetPolicyAuditWriter = {
  createAuditLog: (input: CreateAuditLogInput) => Promise<unknown> | unknown;
};

export type CostRoutesDependencies = {
  auth?: AuthDependencySource;
  policyStore?: BudgetPolicyStore;
  ledgerStore?: CostLedgerStore;
  auditLogs?: BudgetPolicyAuditWriter;
};

const scopeKindSchema = z.enum(["workitem", "user", "team", "eval"]);

export function createCostRoutes(deps: CostRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const policyStore = deps.policyStore ?? getDefaultBudgetPolicyStore();
  const ledgerStore = deps.ledgerStore ?? getDefaultCostLedgerStore();

  routes.get("/policies", createCurrentUserMiddleware(authSource), async (c) => {
    requireCostPolicyAdmin(c.var.currentUser.isAdmin);
    const data = (await policyStore.listPolicies(settings)).map(toApiBudgetPolicy);
    return c.json({ ok: true, data });
  });

  routes.put("/policies/:scope/:id", createCurrentUserMiddleware(authSource), async (c) => {
    requireCostPolicyAdmin(c.var.currentUser.isAdmin);
    const scopeKind = scopeKindSchema.parse(c.req.param("scope"));
    const policyId = c.req.param("id");
    const payload = budgetPolicyUpdateSchema.parse(await c.req.json());
    const before = (await policyStore.listPolicies(settings)).find((candidate) =>
      candidate.scopeKind === scopeKind && candidate.id === policyId
    );
    let policy: CostBudgetPolicy | undefined;
    try {
      policy = await policyStore.updatePolicy(settings, scopeKind, policyId, toCostBudgetPolicyPatch(payload));
    } catch (error) {
      throw new HTTPException(422, {
        message: error instanceof Error ? error.message : "Budget policy update is invalid."
      });
    }
    if (!policy) {
      throw new HTTPException(404, { message: "Budget policy was not found." });
    }
    const data = toApiBudgetPolicy(policy);
    await (deps.auditLogs ?? getDefaultBudgetPolicyAuditLogRepository()).createAuditLog({
      orgId: settings.auth.defaultOrgId,
      workspaceId: settings.auth.defaultWorkspaceId,
      actorKind: "human",
      actorUserId: c.var.currentUser.id,
      actorNickname: c.var.currentUser.nickname,
      entityType: "budget_policy",
      entityId: policy.id,
      action: "budget_policy.updated",
      detailJson: {
        scope_kind: scopeKind,
        policy_id: policy.id,
        patch: payload,
        version_before: before?.version,
        version_after: policy.version,
        ...(before ? { before: toApiBudgetPolicy(before) } : {}),
        after: data
      }
    });
    return c.json({ ok: true, data });
  });

  routes.get("/usage", createCurrentUserMiddleware(authSource), async (c) => {
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
    const data = buildCostSummary({
      settings,
      isAdmin: c.var.currentUser.isAdmin,
      userId: c.var.currentUser.id,
      budgetUsages: decision.usages
    });
    return c.json({ ok: true, data });
  });

  return routes;
}

function requireCostPolicyAdmin(isAdmin: boolean) {
  if (!isAdmin) {
    throw new HTTPException(403, { message: "Only admins can manage AI budget policies." });
  }
}

function toApiBudgetPolicy(policy: CostBudgetPolicy): ApiBudgetPolicy {
  return budgetPolicySchema.parse({
    id: policy.id,
    scope_kind: policy.scopeKind,
    period: policy.period,
    max_tokens: policy.maxTokens,
    max_cost_cny: policy.maxCostCny,
    warning_ratio: policy.warningRatio,
    critical_ratio: policy.criticalRatio,
    on_warning: policy.onWarning,
    on_exhausted: policy.onExhausted,
    ...(policy.modelRouteHint ? { model_route_hint: policy.modelRouteHint } : {}),
    enabled: policy.enabled,
    version: policy.version
  });
}

function toCostBudgetPolicyPatch(payload: ApiBudgetPolicyUpdate): BudgetPolicyPatch {
  return {
    ...(payload.max_tokens !== undefined ? { maxTokens: payload.max_tokens } : {}),
    ...(payload.max_cost_cny !== undefined ? { maxCostCny: payload.max_cost_cny } : {}),
    ...(payload.warning_ratio !== undefined ? { warningRatio: payload.warning_ratio } : {}),
    ...(payload.critical_ratio !== undefined ? { criticalRatio: payload.critical_ratio } : {}),
    ...(payload.on_warning !== undefined ? { onWarning: payload.on_warning } : {}),
    ...(payload.on_exhausted !== undefined ? { onExhausted: payload.on_exhausted } : {}),
    ...(payload.model_route_hint !== undefined ? { modelRouteHint: payload.model_route_hint } : {}),
    ...(payload.enabled !== undefined ? { enabled: payload.enabled } : {})
  };
}
