import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { USER_MEMORY_MAX_ACTIVE_PER_USER, textDiff3Merge, type UserMemoryCategory } from "@workhub/contracts";

import type { WorkHubDb } from "../client.js";
import { userMemories } from "../schema/index.js";

export type UserMemoryRow = typeof userMemories.$inferSelect;

export type UpsertUserMemoryInput = {
  userId: string;
  workspaceId?: string;
  category: UserMemoryCategory;
  key: string;
  valueMd: string;
  confidence?: number;
  sourceRunId?: string;
};

export type ListUserMemoriesOptions = {
  limit?: number;
  categories?: UserMemoryCategory[];
  workspaceId?: string;
};

export type MergeUserMemoryInput = UpsertUserMemoryInput & {
  baseValueMd?: string | null;
};

export type UserMemoryMergeResult =
  | {
      status: "upserted" | "merged";
      userMemory: UserMemoryRow;
    }
  | {
      status: "conflict";
      current: UserMemoryRow;
      incoming: MergeUserMemoryInput;
      baseValueMd?: string | null;
    };

export type UserMemoryRepository = {
  upsert: (input: UpsertUserMemoryInput) => Promise<UserMemoryRow>;
  mergeUpsert: (input: MergeUserMemoryInput) => Promise<UserMemoryMergeResult>;
  listForUser: (userId: string, options?: ListUserMemoriesOptions) => Promise<UserMemoryRow[]>;
  touch: (ids: string[], at?: Date) => Promise<void>;
  softDeleteForUser: (userId: string, id: string, at?: Date) => Promise<boolean>;
  prune: (now?: Date) => Promise<number>;
  countActiveForUser: (userId: string) => Promise<number>;
};

function defaultConfidence(category: UserMemoryCategory): number {
  // 用户纠正的口径是强信号；推断偏好从中位起步。
  return category === "correction" ? 0.9 : 0.5;
}

function memoryKeyConditions(input: Pick<UpsertUserMemoryInput, "userId" | "workspaceId" | "category" | "key">) {
  return [
    eq(userMemories.userId, input.userId),
    input.workspaceId ? eq(userMemories.workspaceId, input.workspaceId) : isNull(userMemories.workspaceId),
    eq(userMemories.category, input.category),
    eq(userMemories.key, input.key),
    isNull(userMemories.deletedAt)
  ];
}

async function findExistingMemory(db: WorkHubDb, input: UpsertUserMemoryInput): Promise<UserMemoryRow | undefined> {
  const existing = await db
    .select()
    .from(userMemories)
    .where(and(...memoryKeyConditions(input)))
    .limit(1);
  return existing[0];
}

async function updateMemory(
  db: WorkHubDb,
  prev: UserMemoryRow,
  input: UpsertUserMemoryInput,
  valueMd: string,
  now: Date,
  expectedValueMd?: string
) {
  const confidence = input.confidence ?? Math.min(1, prev.confidence + 0.1);
  const updated = await db
    .update(userMemories)
    .set({
      valueMd,
      confidence,
      ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}),
      updatedAt: now
    })
    .where(and(
      eq(userMemories.id, prev.id),
      prev.workspaceId ? eq(userMemories.workspaceId, prev.workspaceId) : isNull(userMemories.workspaceId),
      ...(expectedValueMd !== undefined ? [eq(userMemories.valueMd, expectedValueMd)] : [])
    ))
    .returning();
  return updated[0]!;
}

async function insertMemory(db: WorkHubDb, input: UpsertUserMemoryInput) {
  const inserted = await db
    .insert(userMemories)
    .values({
      id: randomUUID(),
      userId: input.userId,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      category: input.category,
      key: input.key,
      valueMd: input.valueMd,
      confidence: input.confidence ?? defaultConfidence(input.category),
      ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {})
    })
    .returning();
  return inserted[0]!;
}

// 超出每用户上限时，按 confidence × 最近使用 排序，驱逐最弱的（软删）。
async function evictOverCap(db: WorkHubDb, userId: string, now: Date, workspaceId?: string): Promise<void> {
  const active = await db
    .select({ id: userMemories.id })
    .from(userMemories)
    .where(and(
      eq(userMemories.userId, userId),
      workspaceId ? eq(userMemories.workspaceId, workspaceId) : isNull(userMemories.workspaceId),
      isNull(userMemories.deletedAt)
    ))
    .orderBy(desc(userMemories.confidence), desc(sql`coalesce(${userMemories.lastUsedAt}, ${userMemories.createdAt})`));
  if (active.length <= USER_MEMORY_MAX_ACTIVE_PER_USER) {
    return;
  }
  const evictIds = active.slice(USER_MEMORY_MAX_ACTIVE_PER_USER).map((row) => row.id);
  for (const id of evictIds) {
    await db.update(userMemories).set({ deletedAt: now, updatedAt: now }).where(eq(userMemories.id, id));
  }
}

export function createUserMemoryRepository(db: WorkHubDb): UserMemoryRepository {
  return {
    async upsert(input) {
      const now = new Date();
      const existing = await findExistingMemory(db, input);

      if (existing) {
        // 同一偏好反复出现 → 提 confidence（封顶 1），不堆重复行。
        return updateMemory(db, existing, input, input.valueMd, now);
      }

      const inserted = await insertMemory(db, input);
      await evictOverCap(db, input.userId, now, input.workspaceId);
      return inserted;
    },

    async mergeUpsert(input) {
      const now = new Date();
      const existing = await findExistingMemory(db, input);
      if (!existing) {
        const inserted = await insertMemory(db, input);
        await evictOverCap(db, input.userId, now, input.workspaceId);
        return { status: "upserted", userMemory: inserted };
      }
      if (existing.valueMd === input.valueMd) {
        return { status: "upserted", userMemory: await updateMemory(db, existing, input, input.valueMd, now) };
      }
      if (input.baseValueMd && existing.valueMd === input.baseValueMd) {
        return { status: "upserted", userMemory: await updateMemory(db, existing, input, input.valueMd, now, existing.valueMd) };
      }
      if (input.baseValueMd && input.valueMd === input.baseValueMd) {
        return {
          status: "conflict",
          current: existing,
          incoming: input,
          baseValueMd: input.baseValueMd
        };
      }
      if (input.baseValueMd) {
        const merged = textDiff3Merge({
          base: { text: input.baseValueMd, truncated: false },
          current: { text: existing.valueMd, truncated: false },
          incoming: { text: input.valueMd, truncated: false }
        });
        if (merged) {
          return { status: "merged", userMemory: await updateMemory(db, existing, input, merged.mergedText, now, existing.valueMd) };
        }
      }
      return {
        status: "conflict",
        current: existing,
        incoming: input,
        ...(input.baseValueMd !== undefined ? { baseValueMd: input.baseValueMd } : {})
      };
    },

    async listForUser(userId, options = {}) {
      const conditions = [eq(userMemories.userId, userId), isNull(userMemories.deletedAt)];
      // L#86：类别过滤下推到 SQL，使 LIMIT 在过滤之后生效——否则先取全类别前 N 行再过滤，
      // 指定类别时可能返回远少于 limit 的行（明明还有更多该类别的记忆）。
      if (options.categories?.length) {
        conditions.push(inArray(userMemories.category, options.categories));
      }
      const workspaceCondition = options.workspaceId
        ? or(eq(userMemories.workspaceId, options.workspaceId), isNull(userMemories.workspaceId))
        : isNull(userMemories.workspaceId);
      if (workspaceCondition) {
        conditions.push(workspaceCondition);
      }
      const limit = Math.max(0, Math.floor(options.limit ?? USER_MEMORY_MAX_ACTIVE_PER_USER));
      const sqlLimit = options.workspaceId ? Math.min(limit * 2, USER_MEMORY_MAX_ACTIVE_PER_USER * 2) : limit;
      const rows = await db
        .select()
        .from(userMemories)
        .where(and(...conditions))
        .orderBy(desc(userMemories.confidence), desc(sql`coalesce(${userMemories.lastUsedAt}, ${userMemories.createdAt})`))
        .limit(sqlLimit);
      if (!options.workspaceId) {
        return rows;
      }
      const byKey = new Map<string, UserMemoryRow>();
      for (const row of rows) {
        const dedupeKey = `${row.category}\u0000${row.key}`;
        const current = byKey.get(dedupeKey);
        if (!current || (current.workspaceId === null && row.workspaceId === options.workspaceId)) {
          byKey.set(dedupeKey, row);
        }
      }
      return [...byKey.values()].slice(0, limit);
    },

    async touch(ids, at) {
      if (ids.length === 0) {
        return;
      }
      const now = at ?? new Date();
      for (const id of ids) {
        await db.update(userMemories).set({ lastUsedAt: now }).where(eq(userMemories.id, id));
      }
    },

    async softDeleteForUser(userId, id, at) {
      const now = at ?? new Date();
      const updated = await db
        .update(userMemories)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(userMemories.id, id), eq(userMemories.userId, userId), isNull(userMemories.deletedAt)))
        .returning({ id: userMemories.id });
      return updated.length > 0;
    },

    async prune(now) {
      const at = now ?? new Date();
      const expired = await db
        .update(userMemories)
        .set({ deletedAt: at, updatedAt: at })
        .where(and(isNull(userMemories.deletedAt), lt(userMemories.expiresAt, at)))
        .returning({ id: userMemories.id });
      return expired.length;
    },

    async countActiveForUser(userId) {
      const rows = await db
        .select({ id: userMemories.id })
        .from(userMemories)
        .where(and(eq(userMemories.userId, userId), isNull(userMemories.deletedAt)))
        .orderBy(asc(userMemories.createdAt));
      return rows.length;
    }
  };
}
