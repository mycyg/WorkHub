import { randomUUID } from "node:crypto";

import { and, desc, eq, isNull, type SQL } from "drizzle-orm";

import type { ActorKind } from "@workhub/contracts";

import type { WorkHubDb } from "../client.js";
import { auditLogs, snapshots } from "../schema/index.js";

export type SnapshotRow = typeof snapshots.$inferSelect;
export type AuditLogRow = typeof auditLogs.$inferSelect;

export type CreateSnapshotInput = {
  id?: string;
  workItemId: string;
  branchId?: string;
  kind: "pre_step" | "merge" | "manual";
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
  findSnapshotById: (id: string) => Promise<SnapshotRow | null>;
  listSnapshotsForWorkItem: (
    workItemId: string,
    options?: { branchId?: string; includeReverted?: boolean }
  ) => Promise<SnapshotRow[]>;
  markSnapshotReverted: (id: string, at: Date) => Promise<SnapshotRow | null>;
};

export type AuditLogRepository = {
  createAuditLog: (input: CreateAuditLogInput) => Promise<AuditLogRow>;
  listAuditLogsForEntity: (entityType: string, entityId: string) => Promise<AuditLogRow[]>;
  listAuditLogsForWorkItem: (workItemId: string) => Promise<AuditLogRow[]>;
  markAuditLogUndone: (id: string, at: Date) => Promise<AuditLogRow | null>;
};

export function createSnapshotRepository(db: WorkHubDb): SnapshotRepository {
  return {
    async createSnapshot(input) {
      const rows = await db
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

    async listAuditLogsForEntity(entityType, entityId) {
      return db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityType, entityType), eq(auditLogs.entityId, entityId)))
        .orderBy(desc(auditLogs.createdAt));
    },

    async listAuditLogsForWorkItem(workItemId) {
      return this.listAuditLogsForEntity("work_item", workItemId);
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
