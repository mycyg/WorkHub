import { applyBudgetPolicyPatch, defaultBudgetPoliciesFromSettings, type BudgetPolicy, type BudgetPolicyPatch, type BudgetPolicyStore } from "@workhub/cost";
import type { Settings } from "@workhub/config";
import { and, eq } from "drizzle-orm";

import type { WorkHubDb } from "../client.js";
import { budgetPolicies } from "../schema/index.js";

// 多次乐观锁重试仍被并发写抢占时抛出（路由层 catch→422，提示管理员重试）。
export class BudgetPolicyVersionConflictError extends Error {
  constructor(scopeKind: string, id: string) {
    super(`预算策略 ${scopeKind}:${id} 正被并发修改，请刷新后重试。`);
    this.name = "BudgetPolicyVersionConflictError";
  }
}

export type BudgetPolicyRow = typeof budgetPolicies.$inferSelect;
const budgetPolicyStorageSeparator = "::";

export function budgetPolicyStorageId(settings: Settings, logicalId: string) {
  return [
    settings.auth.defaultOrgId,
    settings.auth.defaultWorkspaceId,
    logicalId
  ].join(budgetPolicyStorageSeparator);
}

function budgetPolicyLogicalId(row: Pick<BudgetPolicyRow, "id" | "orgId" | "workspaceId">) {
  const prefix = row.orgId && row.workspaceId
    ? `${row.orgId}${budgetPolicyStorageSeparator}${row.workspaceId}${budgetPolicyStorageSeparator}`
    : "";
  return prefix && row.id.startsWith(prefix) ? row.id.slice(prefix.length) : row.id;
}

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
    id: budgetPolicyLogicalId(row),
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
    id: budgetPolicyStorageId(settings, policy.id),
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

export function mergeDefaultPoliciesForSettings(settings: Settings, rows: BudgetPolicyRow[]) {
  const overrides = new Map<string, { policy: BudgetPolicy; rank: number }>();
  for (const row of rows) {
    if (
      row.orgId !== settings.auth.defaultOrgId
      || row.workspaceId !== settings.auth.defaultWorkspaceId
    ) {
      continue;
    }
    const policy = rowToBudgetPolicy(row);
    const rank = row.id === budgetPolicyStorageId(settings, policy.id) ? 2 : 1;
    const current = overrides.get(policy.id);
    if (!current || rank >= current.rank) {
      overrides.set(policy.id, { policy, rank });
    }
  }
  return defaultBudgetPoliciesFromSettings(settings).map((policy) => overrides.get(policy.id)?.policy ?? policy);
}

export function createDbBudgetPolicyStore(db: WorkHubDb): BudgetPolicyStore {
  async function listRows(settings: Settings) {
    return db
      .select()
      .from(budgetPolicies)
      .where(and(
        eq(budgetPolicies.orgId, settings.auth.defaultOrgId),
        eq(budgetPolicies.workspaceId, settings.auth.defaultWorkspaceId)
      ));
  }

  async function listPolicies(settings: Settings) {
    return mergeDefaultPoliciesForSettings(settings, await listRows(settings));
  }

  return {
    listPolicies,

    async updatePolicy(settings, scopeKind, id, patch: BudgetPolicyPatch) {
      // 乐观并发控制（M22）：此前 read→modify→write 的 onConflictDoUpdate 无版本守卫，两个管理员并发
      // 编辑同一策略会双双写 N+1，后写静默覆盖前写（丢失更新）。改为只在 DB 版本 == 读到的版本时才更新
      // （setWhere），命中 0 行说明被并发改过——重读最新版本把本次 patch 叠加上去再试，有界重试后抛冲突。
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const current = (await listPolicies(settings)).find((policy) =>
          policy.scopeKind === scopeKind && policy.id === id
        );
        if (!current) {
          return undefined;
        }
        const next = applyBudgetPolicyPatch(current, patch);
        const written = await db
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
            },
            // 冲突行的版本必须仍等于我们读到的版本，否则不更新（命中 0 行，下面据此重试）。
            setWhere: eq(budgetPolicies.version, current.version)
          })
          .returning({ id: budgetPolicies.id });
        if (written.length > 0) {
          return next;
        }
        // 0 行：要么并发写改了版本（onConflict 的 setWhere 不匹配），重读重试。
      }
      throw new BudgetPolicyVersionConflictError(scopeKind, id);
    }
  };
}
