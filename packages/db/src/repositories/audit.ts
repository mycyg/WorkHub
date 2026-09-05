import { randomUUID } from "node:crypto";

import { and, desc, eq, gte, isNull, lte, or, sql, type SQL } from "drizzle-orm";

import type { ActorKind } from "@workhub/contracts";

import type { WorkHubDb } from "../client.js";
import { auditLogs, snapshots } from "../schema/index.js";

export type SnapshotRow = typeof snapshots.$inferSelect;
export type AuditLogRow = typeof auditLogs.$inferSelect;

export type CreateSnapshotInput = {
  id?: string;
  workItemId: string;
  branchId?: string;
  kind: "pre_step" | "merge" | "manual" | "base";
  ref: string;
  contentSha256?: string;
  createdByKind: ActorKind;
};

export type CreateAuditLogInput = {
  id?: string;
  orgId?: string;
  workspaceId?: string;
  actorKind: ActorKind;
  actorUserId?: string;
  actorNickname?: string;
  entityType: string;
  entityId: string;
  action: string;
  detailJson?: Record<string, unknown>;
  snapshotId?: string;
};

export type SnapshotRepository = {
  createSnapshot: (input: CreateSnapshotInput) => Promise<SnapshotRow>;
  // INF-10：快照行 + 其审计行必须原子——分开写时审计写失败会留下孤儿快照行（replay 反查不到、
  // 回滚点口径失真）。两表写在同一事务里，任一失败整体回滚。返回落库的快照行。
  // 可选（additive）：旧测试 fake 不实现时调用方退回两写路径，见 services/agent-run-snapshots.ts。
  createSnapshotWithAudit?: (
    snapshot: CreateSnapshotInput,
    audit: Omit<CreateAuditLogInput, "snapshotId">
  ) => Promise<SnapshotRow>;
  findSnapshotById: (id: string) => Promise<SnapshotRow | null>;
  listSnapshotsForWorkItem: (
    workItemId: string,
    options?: { branchId?: string; includeReverted?: boolean }
  ) => Promise<SnapshotRow[]>;
  markSnapshotReverted: (id: string, at: Date) => Promise<SnapshotRow | null>;
};

// db-repos-7：工作项审计时间线是「最近 N 条」视图，不是全量导出——加上限防止随 audit_logs
// 线性增长而变慢的无界扫描。三处调用方（routes/audit.ts 的时间线/revert 归属判定、
// routes/agent-runs.ts 的 replay）都只消费最近的记录，200 条对这些用途足够。
export const AUDIT_LOGS_FOR_WORK_ITEM_LIMIT = 200;

export type AuditLogRepository = {
  createAuditLog: (input: CreateAuditLogInput) => Promise<AuditLogRow>;
  listAuditLogsForEntity: (entityType: string, entityId: string, options?: { limit?: number }) => Promise<AuditLogRow[]>;
  listAuditLogsForWorkItem: (workItemId: string, options?: { limit?: number }) => Promise<AuditLogRow[]>;
  markAuditLogUndone: (id: string, at: Date) => Promise<AuditLogRow | null>;
};

// R20 P2A（R19-21 工作区审计列表）：跨工作项的审计流读口（仅管理员用）——按 workspace 硬隔离 +
// 可选操作者/动作/时间范围过滤 + 分页，时间倒序。单列在自有类型/工厂（不塞进 AuditLogRepository），
// 保持纯 additive：不牵动 middleware/auth、agent-runner 等一堆现有 AuditLogRepository 实现/fake。
export const WORKSPACE_AUDIT_LOGS_DEFAULT_LIMIT = 50;
export const WORKSPACE_AUDIT_LOGS_MAX_LIMIT = 200;

export type WorkspaceAuditLogFilter = {
  workspaceId: string;
  actorUserId?: string | undefined;
  action?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
};

export type WorkspaceAuditLogRepository = {
  listAuditLogsForWorkspace: (filter: WorkspaceAuditLogFilter) => Promise<AuditLogRow[]>;
};

export function createWorkspaceAuditLogRepository(db: WorkHubDb): WorkspaceAuditLogRepository {
  return {
    async listAuditLogsForWorkspace(filter) {
      const conditions: SQL[] = [eq(auditLogs.workspaceId, filter.workspaceId)];
      if (filter.actorUserId) {
        conditions.push(eq(auditLogs.actorUserId, filter.actorUserId));
      }
      if (filter.action) {
        conditions.push(eq(auditLogs.action, filter.action));
      }
      if (filter.from) {
        conditions.push(gte(auditLogs.createdAt, filter.from));
      }
      if (filter.to) {
        conditions.push(lte(auditLogs.createdAt, filter.to));
      }
      const rawLimit = filter.limit ?? WORKSPACE_AUDIT_LOGS_DEFAULT_LIMIT;
      const limit = Math.min(Math.max(rawLimit, 1), WORKSPACE_AUDIT_LOGS_MAX_LIMIT);
      const offset = Math.max(filter.offset ?? 0, 0);
      // R21 加固：createdAt 撞秒时行序不稳定会让 limit/offset 翻页在页边界重复/漏行——补 id 次级键
      // 钉死全序。
      return db
        .select()
        .from(auditLogs)
        .where(and(...conditions))
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
        .limit(limit)
        .offset(offset);
    }
  };
}

export function createSnapshotRepository(db: WorkHubDb): SnapshotRepository {
  // 事务 tx 与库句柄同构可插入（event-outbox.ts 同款写法），让同事务复用这段 insert。
  async function insertSnapshot(executor: Pick<WorkHubDb, "insert">, input: CreateSnapshotInput): Promise<SnapshotRow> {
    const rows = await executor
      .insert(snapshots)
      .values({
        id: input.id ?? randomUUID(),
        workItemId: input.workItemId,
        ...(input.branchId ? { branchId: input.branchId } : {}),
        kind: input.kind,
        ref: input.ref,
        ...(input.contentSha256 ? { contentSha256: input.contentSha256 } : {}),
        createdByKind: input.createdByKind
      })
      .returning();
    const snapshot = rows[0];
    if (!snapshot) {
      throw new Error("Failed to create snapshot");
    }
    return snapshot;
  }

  return {
    async createSnapshot(input) {
      return insertSnapshot(db, input);
    },

    async createSnapshotWithAudit(snapshotInput, auditInput) {
      // INF-10：快照行 + 审计行同事务——审计写失败整体回滚，不再留下 replay 反查不到的孤儿快照行。
      return db.transaction(async (tx) => {
        const snapshot = await insertSnapshot(tx, snapshotInput);
        const rows = await tx
          .insert(auditLogs)
          .values({
            id: auditInput.id ?? randomUUID(),
            ...(auditInput.orgId ? { orgId: auditInput.orgId } : {}),
            ...(auditInput.workspaceId ? { workspaceId: auditInput.workspaceId } : {}),
            actorKind: auditInput.actorKind,
            ...(auditInput.actorUserId ? { actorUserId: auditInput.actorUserId } : {}),
            ...(auditInput.actorNickname ? { actorNickname: auditInput.actorNickname } : {}),
            entityType: auditInput.entityType,
            entityId: auditInput.entityId,
            action: auditInput.action,
            detailJson: auditInput.detailJson ?? {},
            snapshotId: snapshot.id
          })
          .returning();
        if (!rows[0]) {
          throw new Error("Failed to create snapshot audit log");
        }
        return snapshot;
      });
    },

    async findSnapshotById(id) {
      const rows = await db.select().from(snapshots).where(eq(snapshots.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async listSnapshotsForWorkItem(workItemId, options = {}) {
      const conditions: SQL[] = [eq(snapshots.workItemId, workItemId)];
      if (options.branchId) {
        conditions.push(eq(snapshots.branchId, options.branchId));
      }
      if (!options.includeReverted) {
        conditions.push(isNull(snapshots.revertedAt));
      }
      return db
        .select()
        .from(snapshots)
        .where(and(...conditions))
        .orderBy(desc(snapshots.createdAt));
    },

    async markSnapshotReverted(id, at) {
      const rows = await db
        .update(snapshots)
        .set({ revertedAt: at })
        .where(eq(snapshots.id, id))
        .returning();
      return rows[0] ?? null;
    }
  };
}

export function createAuditLogRepository(db: WorkHubDb): AuditLogRepository {
  return {
    async createAuditLog(input) {
      const rows = await db
        .insert(auditLogs)
        .values({
          id: input.id ?? randomUUID(),
          ...(input.orgId ? { orgId: input.orgId } : {}),
          ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
          actorKind: input.actorKind,
          ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
          ...(input.actorNickname ? { actorNickname: input.actorNickname } : {}),
          entityType: input.entityType,
          entityId: input.entityId,
          action: input.action,
          detailJson: input.detailJson ?? {},
          ...(input.snapshotId ? { snapshotId: input.snapshotId } : {})
        })
        .returning();
      const auditLog = rows[0];
      if (!auditLog) {
        throw new Error("Failed to create audit log");
      }
      return auditLog;
    },

    async listAuditLogsForEntity(entityType, entityId, options = {}) {
      // CORE-14：与 listAuditLogsForWorkItem 同口径封顶——实体时间线是「最近 N 条」视图，
      // 不封顶则随 audit_logs 增长退化成无界扫描（唯一调用方 agent-runs replay 只消费最近记录）。
      const limit = options.limit ?? AUDIT_LOGS_FOR_WORK_ITEM_LIMIT;
      return db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityType, entityType), eq(auditLogs.entityId, entityId)))
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit);
    },

    async listAuditLogsForWorkItem(workItemId, options = {}) {
      const limit = options.limit ?? AUDIT_LOGS_FOR_WORK_ITEM_LIMIT;
      return db
        .select()
        .from(auditLogs)
        .where(or(
          // 主路径：entityType="work_item" 直接命中 audit_logs_entity_idx (entity_type, entity_id)。
          and(eq(auditLogs.entityType, "work_item"), eq(auditLogs.entityId, workItemId)),
          // 补充路径：approval_request/agent_run 审计行把所属 work_item_id 存在 detailJson 里
          // （见 services/approvals.ts:auditApprovalAction、workers/agent-runner.ts:auditRecoveredClaims）。
          // 先用 entityType IN (...) 收窄到同样能走 audit_logs_entity_idx 前缀的行，
          // 再补 detailJson 谓词精确匹配——避免对整表做 JSON 提取。
          and(
            sql`${auditLogs.entityType} in ('approval_request', 'agent_run')`,
            sql`${auditLogs.detailJson}->>'work_item_id' = ${workItemId}`
          )
        ))
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit);
    },

    async markAuditLogUndone(id, at) {
      const rows = await db
        .update(auditLogs)
        .set({ undoneAt: at })
        .where(eq(auditLogs.id, id))
        .returning();
      return rows[0] ?? null;
    }
  };
}
