import {
  createAuditLogRepository,
  getSharedDatabaseClient,
  createDbBudgetPolicyStore,
  type AuditLogRepository,
  type CreateAuditLogInput,
  type WorkHubDatabaseClient
} from "@workhub/db";
import type { BudgetPolicy, BudgetPolicyPatch, BudgetPolicyStore } from "@workhub/cost";
import type { Settings } from "@workhub/config";

// R2 audit#1：策略更新 + 审计日志原子化的编排器签名。把两次写聚成一个可注入单元——
// 生产用 db.transaction(原子,审计写失败回滚策略变更),测试注入顺序版(假仓库,无需真库)。
export type BudgetPolicyAuditWriter = {
  createAuditLog: (input: CreateAuditLogInput) => Promise<unknown> | unknown;
};

export type UpdateBudgetPolicyWithAudit = (input: {
  settings: Settings;
  scopeKind: BudgetPolicy["scopeKind"];
  policyId: string;
  patch: BudgetPolicyPatch;
  buildAuditLog: (policy: BudgetPolicy) => CreateAuditLogInput;
}) => Promise<BudgetPolicy | undefined>;

// 把「补丁非法(updatePolicy 抛)」与「审计/事务写失败」区分开：前者→422,后者→500(保持原路由语义)。
export class BudgetPolicyUpdateInvalidError extends Error {
  constructor(public readonly reason: unknown) {
    super(reason instanceof Error ? reason.message : "Budget policy update is invalid.");
    this.name = "BudgetPolicyUpdateInvalidError";
  }
}

async function updatePolicyOrInvalid(
  store: Pick<BudgetPolicyStore, "updatePolicy">,
  settings: Settings,
  scopeKind: BudgetPolicy["scopeKind"],
  policyId: string,
  patch: BudgetPolicyPatch
): Promise<BudgetPolicy | undefined> {
  try {
    return (await store.updatePolicy(settings, scopeKind, policyId, patch)) ?? undefined;
  } catch (error) {
    throw new BudgetPolicyUpdateInvalidError(error);
  }
}

let defaultDbClient: WorkHubDatabaseClient | undefined;
let defaultBudgetPolicyStore: BudgetPolicyStore | undefined;
let defaultBudgetPolicyAuditLogs: AuditLogRepository | undefined;

function getDefaultDbClient() {
  defaultDbClient ??= getSharedDatabaseClient();
  return defaultDbClient;
}

export function getDefaultBudgetPolicyStore(): BudgetPolicyStore {
  defaultBudgetPolicyStore ??= createDbBudgetPolicyStore(getDefaultDbClient().db);
  return defaultBudgetPolicyStore;
}

export function getDefaultBudgetPolicyAuditLogRepository(): AuditLogRepository {
  defaultBudgetPolicyAuditLogs ??= createAuditLogRepository(getDefaultDbClient().db);
  return defaultBudgetPolicyAuditLogs;
}

// 顺序版(无事务)：从已构造的 store+audit 复用,供测试注入假仓库 / 不便起事务的调用方。语义同旧两步。
export function createSequentialUpdateBudgetPolicyWithAudit(
  store: Pick<BudgetPolicyStore, "updatePolicy">,
  audit: BudgetPolicyAuditWriter
): UpdateBudgetPolicyWithAudit {
  return async ({ settings, scopeKind, policyId, patch, buildAuditLog }) => {
    const policy = await updatePolicyOrInvalid(store, settings, scopeKind, policyId, patch);
    if (!policy) {
      return undefined;
    }
    await audit.createAuditLog(buildAuditLog(policy));
    return policy;
  };
}

// R2 audit#1：原子版——策略更新与审计日志在同一 db.transaction 内,审计写抛出则整笔回滚,
// 杜绝「策略已改、审计丢失、请求 500」的不一致。tx 与 db 共享查询接口,故可现起 tx-bound 仓库。
export function getDefaultUpdateBudgetPolicyWithAudit(): UpdateBudgetPolicyWithAudit {
  return async ({ settings, scopeKind, policyId, patch, buildAuditLog }) => {
    const { db } = getDefaultDbClient();
    return db.transaction(async (tx) => {
      const store = createDbBudgetPolicyStore(tx);
      const audit = createAuditLogRepository(tx);
      const policy = await updatePolicyOrInvalid(store, settings, scopeKind, policyId, patch);
      if (!policy) {
        return undefined;
      }
      await audit.createAuditLog(buildAuditLog(policy));
      return policy;
    });
  };
}
