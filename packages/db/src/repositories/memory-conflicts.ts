import { randomUUID } from "node:crypto";

import { and, desc, eq, sql } from "drizzle-orm";

import type { UserMemoryCategory } from "@workhub/contracts";

import type { WorkHubDb } from "../client.js";
import { memoryConflicts } from "../schema/index.js";

export type MemoryConflictRow = typeof memoryConflicts.$inferSelect;
// B-R9.6 §3.7：discard_both = 「都不要」——两条都不该成为记忆，收卡 + 撤下现存记忆。
export type MemoryConflictResolution = "keep_current" | "accept_incoming" | "merge_both" | "edit_memory" | "discard_both";

export type CreateMemoryConflictInput = {
  id?: string;
  workspaceId: string;
  userId: string;
  sourceRunId?: string | null;
  category: UserMemoryCategory;
  key: string;
  currentValueMd: string;
  incomingValueMd: string;
  baseValueMd?: string | null;
  candidateMemoryIds: string[];
  now?: Date;
};

export type MemoryConflictListResult = {
  rows: MemoryConflictRow[];
  capped: boolean;
};

export type MemoryConflictRepository = {
  createOrUpdateOpen: (input: CreateMemoryConflictInput) => Promise<MemoryConflictRow>;
  listOpenForUser: (input: {
    workspaceId: string;
    userId: string;
    limit?: number;
  }) => Promise<MemoryConflictListResult>;
  findOpenForUser: (input: {
    workspaceId: string;
    userId: string;
    conflictId: string;
  }) => Promise<MemoryConflictRow | null>;
  resolve: (input: {
    workspaceId: string;
    userId: string;
    conflictId: string;
    expectedUpdatedAt: Date;
    resolution: MemoryConflictResolution;
    resolvedValueMd?: string | null;
    resolvedAt?: Date;
  }) => Promise<MemoryConflictRow | null>;
};

function openConflictConditions(input: { workspaceId: string; userId: string; conflictId?: string }) {
  return [
    ...(input.conflictId ? [eq(memoryConflicts.id, input.conflictId)] : []),
    eq(memoryConflicts.workspaceId, input.workspaceId),
    eq(memoryConflicts.userId, input.userId),
    eq(memoryConflicts.status, "open")
  ];
}

export function createMemoryConflictRepository(db: WorkHubDb): MemoryConflictRepository {
  return {
    async createOrUpdateOpen(input) {
      const now = input.now ?? new Date();
      const id = input.id ?? randomUUID();
      const values = {
        workspaceId: input.workspaceId,
        userId: input.userId,
        sourceRunId: input.sourceRunId ?? null,
        category: input.category,
        key: input.key,
        currentValueMd: input.currentValueMd,
        incomingValueMd: input.incomingValueMd,
        baseValueMd: input.baseValueMd ?? null,
        candidateMemoryIds: input.candidateMemoryIds,
        status: "open" as const,
        resolution: null,
        resolvedValueMd: null,
        resolvedByUserId: null,
        resolvedAt: null,
        updatedAt: now
      };

      const rows = await db
        .insert(memoryConflicts)
        .values({
          id,
          ...values,
          createdAt: now
        })
        .onConflictDoUpdate({
          target: [
            memoryConflicts.workspaceId,
            memoryConflicts.userId,
            memoryConflicts.category,
            memoryConflicts.key
          ],
          targetWhere: sql`${memoryConflicts.status} = 'open'`,
          set: values
        })
        .returning();
      return rows[0]!;
    },

    async listOpenForUser(input) {
      const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
      const rows = await db
        .select()
        .from(memoryConflicts)
        .where(and(...openConflictConditions(input)))
        .orderBy(desc(memoryConflicts.createdAt), desc(memoryConflicts.id))
        .limit(limit + 1);
      return {
        rows: rows.slice(0, limit),
        capped: rows.length > limit
      };
    },

    async findOpenForUser(input) {
      const rows = await db
        .select()
        .from(memoryConflicts)
        .where(and(...openConflictConditions(input)))
        .limit(1);
      return rows[0] ?? null;
    },

    async resolve(input) {
      const resolvedAt = input.resolvedAt ?? new Date();
      const rows = await db
        .update(memoryConflicts)
        .set({
          status: "resolved",
          resolution: input.resolution,
          resolvedValueMd: input.resolvedValueMd ?? null,
          resolvedByUserId: input.userId,
          resolvedAt,
          updatedAt: resolvedAt
        })
        .where(and(
          ...openConflictConditions(input),
          eq(memoryConflicts.updatedAt, input.expectedUpdatedAt)
        ))
        .returning();
      return rows[0] ?? null;
    }
  };
}
