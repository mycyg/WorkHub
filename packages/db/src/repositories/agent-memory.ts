import { randomUUID } from "node:crypto";

import { and, asc, desc, eq } from "drizzle-orm";

import {
  AGENT_MEMORY_PROMPT_TOP_N,
  type UserMemoryCategory
} from "@workhub/contracts";

import type { WorkHubDb } from "../client.js";
import { agentMemory, agentMemoryVersions } from "../schema/index.js";

export type AgentMemoryRow = typeof agentMemory.$inferSelect;
export type AgentMemoryVersionRow = typeof agentMemoryVersions.$inferSelect;

export class AgentMemoryWriteConflict extends Error {
  constructor() {
    super("agent_memory_write_conflict");
    this.name = "AgentMemoryWriteConflict";
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

export type AgentMemoryRepository = {
  upsertPrivateMemory: (input: UpsertAgentMemoryInput) => Promise<AgentMemoryRow>;
  listPrivateForContext: (input: ListPrivateAgentMemoryInput) => Promise<AgentMemoryListResult>;
  listVersions: (input: ListAgentMemoryVersionsInput) => Promise<AgentMemoryVersionListResult>;
};

const DEFAULT_LIMIT = AGENT_MEMORY_PROMPT_TOP_N;
const MAX_LIMIT = 50;

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

export function createAgentMemoryRepository(db: WorkHubDb): AgentMemoryRepository {
  return {
    async upsertPrivateMemory(input) {
      const at = input.now ?? new Date();
      const [existing] = await db
        .select()
        .from(agentMemory)
        .where(and(
          eq(agentMemory.workspaceId, input.workspaceId),
          eq(agentMemory.agentContextId, input.agentContextId),
          eq(agentMemory.category, input.category),
          eq(agentMemory.key, input.key)
        ))
        .limit(1);

      if (!existing) {
        const memoryId = randomUUID();
        const baseVersion = input.baseVersion ?? 0;
        const [inserted] = await db.transaction(async (tx) => {
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
            .returning();
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
          return insertedRows;
        });
        return inserted!;
      }

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
    }
  };
}
