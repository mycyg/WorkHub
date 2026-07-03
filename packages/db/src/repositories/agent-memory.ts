import { randomUUID } from "node:crypto";

import { and, asc, desc, eq } from "drizzle-orm";

import {
  AGENT_MEMORY_PROMPT_TOP_N,
  type UserMemoryCategory
} from "@workhub/contracts";

import type { WorkHubDb } from "../client.js";
import { agentMemory, agentMemoryVersions, agentRuns, taskPlanItems, taskPlans } from "../schema/index.js";

export type AgentMemoryRow = typeof agentMemory.$inferSelect;
export type AgentMemoryVersionRow = typeof agentMemoryVersions.$inferSelect;

export class AgentMemoryWriteConflict extends Error {
  constructor() {
    super("agent_memory_write_conflict");
    this.name = "AgentMemoryWriteConflict";
  }
}

export class AgentMemoryContextNotFound extends Error {
  constructor() {
    super("agent_memory_context_not_found");
    this.name = "AgentMemoryContextNotFound";
  }
}

export type UpsertAgentMemoryInput = {
  workspaceId: string;
  agentContextId: string;
  category: UserMemoryCategory;
  key: string;
  valueMd: string;
  confidence?: number;
  sourceRunId?: string;
  baseVersion?: number;
  now?: Date;
};

export type ListPrivateAgentMemoryInput = {
  workspaceId: string;
  agentContextId: string;
  limit?: number;
};

export type ListAgentMemoryVersionsInput = {
  workspaceId: string;
  memoryId: string;
  limit?: number;
};

export type AgentMemoryListResult = {
  rows: AgentMemoryRow[];
  capped: boolean;
};

export type AgentMemoryVersionListResult = {
  rows: AgentMemoryVersionRow[];
  capped: boolean;
};

export type AgentMemoryPromotionContext = {
  entry: AgentMemoryRow;
  planId: string;
  sourceActorUserId?: string;
  candidates: AgentMemoryRow[];
  capped: boolean;
};

export type ReadAgentMemoryPromotionContextInput = {
  workspaceId: string;
  memoryId: string;
  limit?: number;
};

export type AgentMemoryRepository = {
  upsertPrivateMemory: (input: UpsertAgentMemoryInput) => Promise<AgentMemoryRow>;
  listPrivateForContext: (input: ListPrivateAgentMemoryInput) => Promise<AgentMemoryListResult>;
  listVersions: (input: ListAgentMemoryVersionsInput) => Promise<AgentMemoryVersionListResult>;
  readPromotionContext: (input: ReadAgentMemoryPromotionContextInput) => Promise<AgentMemoryPromotionContext | undefined>;
};

const DEFAULT_LIMIT = AGENT_MEMORY_PROMPT_TOP_N;
const MAX_LIMIT = 50;
const MAX_PROMOTION_CANDIDATES = 20;

function boundedLimit(input: number | undefined) {
  if (!Number.isFinite(input)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.max(Math.floor(input ?? DEFAULT_LIMIT), 0), MAX_LIMIT);
}

function defaultConfidence(category: UserMemoryCategory): number {
  return category === "correction" ? 0.9 : 0.5;
}

function sourceRunPatch(sourceRunId: string | undefined) {
  return sourceRunId ? { sourceRunId } : {};
}

function privateMemoryKeyCondition(input: {
  workspaceId: string;
  agentContextId: string;
  category: UserMemoryCategory;
  key: string;
}) {
  return and(
    eq(agentMemory.workspaceId, input.workspaceId),
    eq(agentMemory.agentContextId, input.agentContextId),
    eq(agentMemory.category, input.category),
    eq(agentMemory.key, input.key)
  );
}

function privateMemoryConflictTarget() {
  return [agentMemory.workspaceId, agentMemory.agentContextId, agentMemory.category, agentMemory.key];
}

async function assertAgentContextInWorkspace(db: WorkHubDb, input: { workspaceId: string; agentContextId: string }) {
  const [context] = await db
    .select({
      item: {
        id: taskPlanItems.id
      },
      plan: {
        id: taskPlans.id,
        workspaceId: taskPlans.workspaceId
      }
    })
    .from(taskPlanItems)
    .innerJoin(taskPlans, eq(taskPlans.id, taskPlanItems.planId))
    .where(and(
      eq(taskPlanItems.id, input.agentContextId),
      eq(taskPlans.workspaceId, input.workspaceId)
    ))
    .limit(1);
  if (!context) {
    throw new AgentMemoryContextNotFound();
  }
}

async function findPrivateMemoryByKey(db: WorkHubDb, input: {
  workspaceId: string;
  agentContextId: string;
  category: UserMemoryCategory;
  key: string;
}) {
  const [existing] = await db
    .select()
    .from(agentMemory)
    .where(privateMemoryKeyCondition(input))
    .limit(1);
  return existing;
}

async function appendPrivateMemoryVersion(
  db: WorkHubDb,
  existing: AgentMemoryRow,
  input: UpsertAgentMemoryInput,
  at: Date
) {
  const nextVersion = existing.currentVersion + 1;
  const baseVersion = input.baseVersion ?? existing.currentVersion;
  return db.transaction(async (tx) => {
    await tx
      .insert(agentMemoryVersions)
      .values({
        id: randomUUID(),
        memoryId: existing.id,
        version: nextVersion,
        baseVersion,
        valueMd: input.valueMd,
        ...sourceRunPatch(input.sourceRunId),
        createdAt: at
      })
      .returning();
    const [updated] = await tx
      .update(agentMemory)
      .set({
        valueMd: input.valueMd,
        confidence: input.confidence ?? Math.min(1, existing.confidence + 0.1),
        ...sourceRunPatch(input.sourceRunId),
        baseVersion,
        currentVersion: nextVersion,
        updatedAt: at
      })
      .where(and(
        eq(agentMemory.id, existing.id),
        eq(agentMemory.workspaceId, input.workspaceId),
        eq(agentMemory.currentVersion, existing.currentVersion)
      ))
      .returning();
    if (!updated) {
      throw new AgentMemoryWriteConflict();
    }
    return updated;
  });
}

export function createAgentMemoryRepository(db: WorkHubDb): AgentMemoryRepository {
  return {
    async upsertPrivateMemory(input) {
      const at = input.now ?? new Date();
      await assertAgentContextInWorkspace(db, input);
      const existing = await findPrivateMemoryByKey(db, input);

      if (!existing) {
        const memoryId = randomUUID();
        const baseVersion = input.baseVersion ?? 0;
        const inserted = await db.transaction(async (tx) => {
          const insertedRows = await tx
            .insert(agentMemory)
            .values({
              id: memoryId,
              workspaceId: input.workspaceId,
              agentContextId: input.agentContextId,
              category: input.category,
              key: input.key,
              valueMd: input.valueMd,
              confidence: input.confidence ?? defaultConfidence(input.category),
              ...sourceRunPatch(input.sourceRunId),
              baseVersion,
              currentVersion: 1,
              createdAt: at,
              updatedAt: at
            })
            .onConflictDoNothing({ target: privateMemoryConflictTarget() })
            .returning();
          const inserted = insertedRows[0];
          if (!inserted) {
            return undefined;
          }
          await tx
            .insert(agentMemoryVersions)
            .values({
              id: randomUUID(),
              memoryId,
              version: 1,
              baseVersion,
              valueMd: input.valueMd,
              ...sourceRunPatch(input.sourceRunId),
              createdAt: at
            })
            .returning();
          return inserted;
        });
        if (inserted) {
          return inserted;
        }
        const conflictWinner = await findPrivateMemoryByKey(db, input);
        if (!conflictWinner) {
          throw new AgentMemoryWriteConflict();
        }
        return appendPrivateMemoryVersion(db, conflictWinner, input, at);
      }

      return appendPrivateMemoryVersion(db, existing, input, at);
    },

    async listPrivateForContext(input) {
      const limit = boundedLimit(input.limit);
      const rows = await db
        .select()
        .from(agentMemory)
        .where(and(
          eq(agentMemory.workspaceId, input.workspaceId),
          eq(agentMemory.agentContextId, input.agentContextId)
        ))
        .orderBy(desc(agentMemory.confidence), desc(agentMemory.updatedAt), asc(agentMemory.key))
        .limit(limit + 1);
      return {
        rows: rows.slice(0, limit),
        capped: rows.length > limit
      };
    },

    async listVersions(input) {
      const limit = boundedLimit(input.limit);
      const rows = await db
        .select({ version: agentMemoryVersions })
        .from(agentMemoryVersions)
        .innerJoin(agentMemory, eq(agentMemory.id, agentMemoryVersions.memoryId))
        .where(and(
          eq(agentMemory.workspaceId, input.workspaceId),
          eq(agentMemory.id, input.memoryId)
        ))
        .orderBy(desc(agentMemoryVersions.version))
        .limit(limit + 1);
      return {
        rows: rows.slice(0, limit).map((row) => row.version),
        capped: rows.length > limit
      };
    },

    async readPromotionContext(input) {
      const limit = Math.min(Math.max(Math.floor(input.limit ?? MAX_PROMOTION_CANDIDATES), 1), MAX_PROMOTION_CANDIDATES);
      const [entry] = await db
        .select({
          memory: agentMemory,
          item: taskPlanItems,
          sourceRun: agentRuns
        })
        .from(agentMemory)
        .innerJoin(taskPlanItems, eq(agentMemory.agentContextId, taskPlanItems.id))
        .innerJoin(taskPlans, eq(taskPlans.id, taskPlanItems.planId))
        .leftJoin(agentRuns, and(
          eq(agentMemory.sourceRunId, agentRuns.id),
          eq(agentRuns.workspaceId, input.workspaceId)
        ))
        .where(and(
          eq(agentMemory.workspaceId, input.workspaceId),
          eq(agentMemory.id, input.memoryId),
          eq(taskPlans.workspaceId, input.workspaceId)
        ))
        .limit(1);
      if (!entry) {
        return undefined;
      }
      const rows = await db
        .select({ memory: agentMemory })
        .from(agentMemory)
        .innerJoin(taskPlanItems, eq(agentMemory.agentContextId, taskPlanItems.id))
        .innerJoin(taskPlans, eq(taskPlans.id, taskPlanItems.planId))
        .where(and(
          eq(agentMemory.workspaceId, input.workspaceId),
          eq(taskPlans.workspaceId, input.workspaceId),
          eq(taskPlanItems.planId, entry.item.planId),
          eq(agentMemory.category, entry.memory.category),
          eq(agentMemory.key, entry.memory.key)
        ))
        .orderBy(desc(agentMemory.confidence), desc(agentMemory.updatedAt), asc(agentMemory.id))
        .limit(limit + 1);
      return {
        entry: entry.memory,
        planId: entry.item.planId,
        ...(entry.sourceRun?.actorUserId ? { sourceActorUserId: entry.sourceRun.actorUserId } : {}),
        candidates: rows.slice(0, limit).map((row) => row.memory),
        capped: rows.length > limit
      };
    }
  };
}
