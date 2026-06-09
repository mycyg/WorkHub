import { applyBudgetPolicyPatch, defaultBudgetPoliciesFromSettings, type BudgetPolicy, type BudgetPolicyPatch, type BudgetPolicyStore } from "@workhub/cost";
import type { Settings } from "@workhub/config";

import type { WorkHubDb } from "../client.js";
import { budgetPolicies } from "../schema/index.js";

export type BudgetPolicyRow = typeof budgetPolicies.$inferSelect;

function normalizeNumericString(value: string) {
  return value.replace(/(\.\d*?)0+$/u, "$1").replace(/\.$/u, "");
}

function optionalRouteHint(value: string | null): BudgetPolicy["modelRouteHint"] | undefined {
  if (value === "cheapest_safe" || value === "balanced" || value === "premium") {
    return value;
  }
  return undefined;
}

function rowToBudgetPolicy(row: BudgetPolicyRow): BudgetPolicy {
  const modelRouteHint = optionalRouteHint(row.modelRouteHint);
  return {
    id: row.id,
    scopeKind: row.scopeKind as BudgetPolicy["scopeKind"],
    period: row.period as BudgetPolicy["period"],
    maxTokens: row.maxTokens,
    maxCostCny: normalizeNumericString(row.maxCostCny),
    warningRatio: Number(row.warningRatio),
    criticalRatio: Number(row.criticalRatio),
    onWarning: row.onWarning as BudgetPolicy["onWarning"],
    onExhausted: row.onExhausted as BudgetPolicy["onExhausted"],
    ...(modelRouteHint ? { modelRouteHint } : {}),
    enabled: row.enabled,
    version: row.version
  };
}

function policyInsert(policy: BudgetPolicy, settings: Settings): typeof budgetPolicies.$inferInsert {
  return {
    id: policy.id,
    orgId: settings.auth.defaultOrgId,
    workspaceId: settings.auth.defaultWorkspaceId,
    scopeKind: policy.scopeKind,
    period: policy.period,
    maxTokens: policy.maxTokens,
    maxCostCny: policy.maxCostCny,
    warningRatio: policy.warningRatio.toString(),
    criticalRatio: policy.criticalRatio.toString(),
    onWarning: policy.onWarning,
    onExhausted: policy.onExhausted,
    ...(policy.modelRouteHint ? { modelRouteHint: policy.modelRouteHint } : {}),
    enabled: policy.enabled,
    version: policy.version
  };
}

function mergeDefaultPolicies(settings: Settings, rows: BudgetPolicyRow[]) {
  const overrides = new Map(rows.map((row) => [row.id, rowToBudgetPolicy(row)]));
  return defaultBudgetPoliciesFromSettings(settings).map((policy) => overrides.get(policy.id) ?? policy);
}

export function createDbBudgetPolicyStore(db: WorkHubDb): BudgetPolicyStore {
  async function listRows() {
    return db.select().from(budgetPolicies);
  }

  async function listPolicies(settings: Settings) {
    return mergeDefaultPolicies(settings, await listRows());
  }

  return {
    listPolicies,

    async updatePolicy(settings, scopeKind, id, patch: BudgetPolicyPatch) {
      const current = (await listPolicies(settings)).find((policy) =>
        policy.scopeKind === scopeKind && policy.id === id
      );
      if (!current) {
        return undefined;
      }
      const next = applyBudgetPolicyPatch(current, patch);
      await db
        .insert(budgetPolicies)
        .values(policyInsert(next, settings))
        .onConflictDoUpdate({
          target: budgetPolicies.id,
          set: {
            orgId: settings.auth.defaultOrgId,
            workspaceId: settings.auth.defaultWorkspaceId,
            scopeKind: next.scopeKind,
            period: next.period,
            maxTokens: next.maxTokens,
            maxCostCny: next.maxCostCny,
            warningRatio: next.warningRatio.toString(),
            criticalRatio: next.criticalRatio.toString(),
            onWarning: next.onWarning,
            onExhausted: next.onExhausted,
            modelRouteHint: next.modelRouteHint ?? null,
            enabled: next.enabled,
            version: next.version,
            updatedAt: new Date()
          }
        });
      return next;
    }
  };
}
