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
  type BudgetPolicy as CostBudgetPolicy,
  type BudgetPolicyPatch,
  type BudgetPolicyStore
} from "@workhub/cost";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import { buildCostSummary } from "../pages/cost.js";
import { getDefaultBudgetPolicyStore } from "../services/cost-policy-store.js";

export type CostRoutesDependencies = {
  auth?: AuthDependencySource;
  policyStore?: BudgetPolicyStore;
};

const scopeKindSchema = z.enum(["workitem", "user", "team", "eval"]);

export function createCostRoutes(deps: CostRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const policyStore = deps.policyStore ?? getDefaultBudgetPolicyStore();

  routes.get("/policies", createCurrentUserMiddleware(authSource), (c) => {
    requireCostPolicyAdmin(c.var.currentUser.isAdmin);
    const data = policyStore.listPolicies(settings).map(toApiBudgetPolicy);
    return c.json({ ok: true, data });
  });

  routes.put("/policies/:scope/:id", createCurrentUserMiddleware(authSource), async (c) => {
    requireCostPolicyAdmin(c.var.currentUser.isAdmin);
    const scopeKind = scopeKindSchema.parse(c.req.param("scope"));
    const payload = budgetPolicyUpdateSchema.parse(await c.req.json());
    let policy: CostBudgetPolicy | undefined;
    try {
      policy = policyStore.updatePolicy(settings, scopeKind, c.req.param("id"), toCostBudgetPolicyPatch(payload));
    } catch (error) {
      throw new HTTPException(422, {
        message: error instanceof Error ? error.message : "Budget policy update is invalid."
      });
    }
    if (!policy) {
      throw new HTTPException(404, { message: "Budget policy was not found." });
    }
    return c.json({ ok: true, data: toApiBudgetPolicy(policy) });
  });

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
