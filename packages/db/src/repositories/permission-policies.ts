import { randomUUID } from "node:crypto";

import { eq, isNull } from "drizzle-orm";

import type { PermissionEffect, PermissionScopeKind } from "@workhub/contracts";

import type { WorkHubDb } from "../client.js";
import { permissionPolicies } from "../schema/index.js";

export type PermissionPolicyRow = typeof permissionPolicies.$inferSelect;

export type PermissionPolicyRecord = {
  id?: string;
  scopeKind: PermissionScopeKind;
  scopeId: string;
  actionPattern: string;
  effect: PermissionEffect;
  priority?: number;
  learnedFromSession?: boolean;
  createdByUserId?: string | null;
  orgId?: string | null;
  workspaceId?: string | null;
  deletedAt?: Date | string | null;
};

export type CreatePermissionPolicyInput = {
  id?: string;
  scopeKind: PermissionScopeKind;
  scopeId: string;
  actionPattern: string;
  effect: PermissionEffect;
  priority?: number;
  learnedFromSession?: boolean;
  createdByUserId?: string;
  orgId?: string;
  workspaceId?: string;
};

export type PermissionPolicyRepository = {
  listActivePolicies: () => Promise<PermissionPolicyRecord[]>;
  createPermissionPolicy: (input: CreatePermissionPolicyInput) => Promise<PermissionPolicyRecord>;
  softDeletePolicy: (id: string, deletedByUserId: string, at: Date) => Promise<PermissionPolicyRecord | null>;
};

export function toPermissionPolicyRecord(row: PermissionPolicyRow): PermissionPolicyRecord {
  return {
    id: row.id,
    scopeKind: row.scopeKind as PermissionScopeKind,
    scopeId: row.scopeId,
    actionPattern: row.actionPattern,
    effect: row.effect as PermissionEffect,
    priority: row.priority,
    learnedFromSession: row.learnedFromSession,
    createdByUserId: row.createdByUserId,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    deletedAt: row.deletedAt
  };
}

export function createPermissionPolicyRepository(db: WorkHubDb): PermissionPolicyRepository {
  return {
    async listActivePolicies() {
      const rows = await db.select().from(permissionPolicies).where(isNull(permissionPolicies.deletedAt));
      return rows.map(toPermissionPolicyRecord);
    },

    async createPermissionPolicy(input) {
      const rows = await db
        .insert(permissionPolicies)
        .values({
          id: input.id ?? randomUUID(),
          scopeKind: input.scopeKind,
          scopeId: input.scopeId,
          actionPattern: input.actionPattern,
          effect: input.effect,
          priority: input.priority ?? 0,
          learnedFromSession: input.learnedFromSession ?? false,
          createdByUserId: input.createdByUserId,
          orgId: input.orgId,
          workspaceId: input.workspaceId
        })
        .returning();
      const policy = rows[0];
      if (!policy) {
        throw new Error("Failed to create permission policy");
      }
      return toPermissionPolicyRecord(policy);
    },

    async softDeletePolicy(id, deletedByUserId, at) {
      const rows = await db
        .update(permissionPolicies)
        .set({
          deletedAt: at,
          deletedByUserId,
          updatedAt: at
        })
        .where(eq(permissionPolicies.id, id))
        .returning();
      return rows[0] ? toPermissionPolicyRecord(rows[0]) : null;
    }
  };
}
