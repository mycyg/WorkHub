import { createHash } from "node:crypto";

import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";

import type { WorkItemMode } from "@workhub/contracts";

import type { WorkHubDb } from "../client.js";
import { agentRuns, agentSteps } from "../schema/index.js";

export type AgentRunRow = typeof agentRuns.$inferSelect;
export type AgentStepRow = typeof agentSteps.$inferSelect;

export type AgentRunStatusForPersistence =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "escalated"
  | "cancelled";

export type AgentRunBudgetForPersistence = {
  maxSteps: number;
  totalTimeoutS: number;
  maxTokens: number;
  maxCostCny: string;
};

export type AgentRunUsageForPersistence = {
  stepsUsed: number;
  tokenIn: number;
  tokenOut: number;
  estimatedCostCny: string;
};

export type AgentRunTraceForPersistence = {
  id: string;
  stepNo: number;
  phase: "think" | "tool_call" | "tool_result" | "final";
  outputExcerpt?: string;
  controlSignal?: "continue" | "stop" | "compact" | "escalate";
  snapshotId?: string;
  createdAt: Date;
};

export type AgentRunForPersistence = {
  runId: string;
  workItemId: string;
  actorUserId: string;
  mode: WorkItemMode;
  status: AgentRunStatusForPersistence;
  title: string;
  model: string;
  budget: AgentRunBudgetForPersistence;
  budgetDecisionJson: Record<string, unknown>;
  usage: AgentRunUsageForPersistence;
  outcomeReason?: string;
  handoffMd?: string;
  handoffJson?: Record<string, unknown>;
  workdirRef?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type StoredAgentRunRows = {
  run: AgentRunRow;
  steps: AgentStepRow[];
};

export type AgentRunClaimInput = {
  workerId: string;
  claimedAt: Date;
  heartbeatAt: Date;
  leaseExpiresAt: Date;
};

export type AgentRunHeartbeatInput = {
  runId: string;
  workerId: string;
  heartbeatAt: Date;
  leaseExpiresAt: Date;
};

export type AgentRunRequeueStaleInput = {
  expiredBefore: Date;
  requeuedAt: Date;
};

export type AgentRunRepository = {
  createRun: (run: AgentRunForPersistence) => Promise<AgentRunRow>;
  createRunIfWorkItemIdle: (run: AgentRunForPersistence) => Promise<AgentRunRow | null>;
  // fencingWorkerId（可选）：执行中的 worker 传自己的 claimedBy，写入会附 `claimedBy = workerId` 守卫，
  // 一旦该 run 的租约已被回收/转交给别的 worker，本次写入命中 0 行（返回 null/[]），不会覆盖新 owner 的数据。
  // 非执行路径（enqueue 建 run、abort 取消）省略此参数，保持原无守卫语义。
  updateRun: (run: AgentRunForPersistence, fencingWorkerId?: string) => Promise<AgentRunRow | null>;
  replaceTrace: (runId: string, trace: AgentRunTraceForPersistence[], fencingWorkerId?: string) => Promise<AgentStepRow[]>;
  setWorkdir: (runId: string, workdirRef: string, at: Date, fencingWorkerId?: string) => Promise<AgentRunRow | null>;
  findById: (runId: string) => Promise<StoredAgentRunRows | null>;
  listActive: () => Promise<StoredAgentRunRows[]>;
  claimQueued: (runId: string, claim: AgentRunClaimInput) => Promise<StoredAgentRunRows | null>;
  claimNextQueued: (claim: AgentRunClaimInput) => Promise<StoredAgentRunRows | null>;
  heartbeatClaim: (input: AgentRunHeartbeatInput) => Promise<AgentRunRow | null>;
  requeueExpiredClaims: (input: AgentRunRequeueStaleInput) => Promise<AgentRunRow[]>;
};

const terminalStatuses: AgentRunStatusForPersistence[] = ["succeeded", "failed", "escalated", "cancelled"];
const activeStatuses: AgentRunStatusForPersistence[] = ["queued", "running"];
const activeWorkItemRunWhere = sql`${agentRuns.status} in ('queued', 'running')`;

function stableUuid(input: string) {
  const hex = createHash("sha256").update(input).digest("hex");
  const variant = ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variant}${hex.slice(18, 20)}`,
    hex.slice(20, 32)
  ].join("-");
}

function secondsBetween(start: Date, end: Date) {
  return Math.max((end.getTime() - start.getTime()) / 1000, 0);
}

function terminalFinishedAt(run: AgentRunForPersistence) {
  return terminalStatuses.includes(run.status) ? run.updatedAt : undefined;
}

function runningStartedAt(run: AgentRunForPersistence) {
  return run.status === "running" || terminalStatuses.includes(run.status) ? run.createdAt : undefined;
}

function claimUpdateValues(claim: AgentRunClaimInput): Partial<typeof agentRuns.$inferInsert> {
  return {
    status: "running",
    claimedBy: claim.workerId,
    claimedAt: claim.claimedAt,
    heartbeatAt: claim.heartbeatAt,
    leaseExpiresAt: claim.leaseExpiresAt,
    startedAt: claim.claimedAt,
    updatedAt: claim.claimedAt
  };
}

function runInsertValues(run: AgentRunForPersistence): typeof agentRuns.$inferInsert {
  return {
    id: run.runId,
    workItemId: run.workItemId,
    mode: run.mode,
    actor: "human",
    actorUserId: run.actorUserId,
    title: run.title,
    status: run.status,
    model: run.model,
    turnsUsed: run.usage.stepsUsed,
    maxTurns: run.budget.maxSteps,
    totalTimeoutS: run.budget.totalTimeoutS,
    maxTokens: run.budget.maxTokens,
    maxCostCny: run.budget.maxCostCny,
    seconds: secondsBetween(run.createdAt, run.updatedAt),
    tokenIn: run.usage.tokenIn,
    tokenOut: run.usage.tokenOut,
    costEstimate: run.usage.estimatedCostCny,
    budgetDecisionJson: run.budgetDecisionJson,
    outcomeReason: run.outcomeReason,
    handoffMd: run.handoffMd,
    handoffJson: run.handoffJson,
    workdirRef: run.workdirRef,
    startedAt: runningStartedAt(run),
    finishedAt: terminalFinishedAt(run),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt
  };
}

function runUpdateValues(run: AgentRunForPersistence): Partial<typeof agentRuns.$inferInsert> {
  const values: Partial<typeof agentRuns.$inferInsert> = {
    mode: run.mode,
    actorUserId: run.actorUserId,
    title: run.title,
    status: run.status,
    model: run.model,
    turnsUsed: run.usage.stepsUsed,
    maxTurns: run.budget.maxSteps,
    totalTimeoutS: run.budget.totalTimeoutS,
    maxTokens: run.budget.maxTokens,
    maxCostCny: run.budget.maxCostCny,
    seconds: secondsBetween(run.createdAt, run.updatedAt),
    tokenIn: run.usage.tokenIn,
    tokenOut: run.usage.tokenOut,
    costEstimate: run.usage.estimatedCostCny,
    budgetDecisionJson: run.budgetDecisionJson,
    outcomeReason: run.outcomeReason,
    handoffMd: run.handoffMd,
    handoffJson: run.handoffJson,
    workdirRef: run.workdirRef,
    updatedAt: run.updatedAt
  };
  const startedAt = runningStartedAt(run);
  if (startedAt) {
    values.startedAt = startedAt;
  }
  const finishedAt = terminalFinishedAt(run);
  if (finishedAt) {
    values.finishedAt = finishedAt;
  }
  return values;
}

async function readStoredAgentRun(db: WorkHubDb, runId: string): Promise<StoredAgentRunRows | null> {
  const runRows = await db.select().from(agentRuns).where(eq(agentRuns.id, runId)).limit(1);
  const run = runRows[0];
  if (!run) {
    return null;
  }
  const steps = await db
    .select()
    .from(agentSteps)
    .where(eq(agentSteps.agentRunId, run.id))
    .orderBy(asc(agentSteps.seq), asc(agentSteps.createdAt));
  return { run, steps };
}

export function createAgentRunRepository(db: WorkHubDb): AgentRunRepository {
  async function claimById(runId: string, claim: AgentRunClaimInput) {
    return db.transaction(async (tx) => {
      const candidates = await tx
        .select({ id: agentRuns.id })
        .from(agentRuns)
        .where(and(eq(agentRuns.id, runId), eq(agentRuns.status, "queued")))
        .limit(1)
        .for("update", { skipLocked: true });
      const candidate = candidates[0];
      if (!candidate) {
        return null;
      }
      const rows = await tx
        .update(agentRuns)
        .set(claimUpdateValues(claim))
        .where(and(eq(agentRuns.id, candidate.id), eq(agentRuns.status, "queued")))
        .returning();
      const row = rows[0];
      if (!row) {
        return null;
      }
      const steps = await tx
        .select()
        .from(agentSteps)
        .where(eq(agentSteps.agentRunId, row.id))
        .orderBy(asc(agentSteps.seq), asc(agentSteps.createdAt));
      return { run: row, steps };
    });
  }

  return {
    async createRun(run) {
      const rows = await db.insert(agentRuns).values(runInsertValues(run)).returning();
      const row = rows[0];
      if (!row) {
        throw new Error("Failed to create agent run");
      }
      return row;
    },

    async createRunIfWorkItemIdle(run) {
      const rows = await db
        .insert(agentRuns)
        .values(runInsertValues(run))
        .onConflictDoNothing({
          target: agentRuns.workItemId,
          where: activeWorkItemRunWhere
        })
        .returning();
      return rows[0] ?? null;
    },

    async updateRun(run, fencingWorkerId) {
      const rows = await db
        .update(agentRuns)
        .set(runUpdateValues(run))
        .where(and(
          eq(agentRuns.id, run.runId),
          fencingWorkerId ? eq(agentRuns.claimedBy, fencingWorkerId) : undefined
        ))
        .returning();
      return rows[0] ?? null;
    },

    async replaceTrace(runId, trace, fencingWorkerId) {
      // delete+insert 必须同事务：否则 insert 失败/进程崩溃会把已删的整条 trace 永久抹掉。
      return db.transaction(async (tx) => {
        if (fencingWorkerId) {
          // trace 行不带 claimedBy，故在事务里先核对父 run 的 owner；租约已转交则直接放弃，
          // 不删不写（避免抹掉新 owner 正在写的 trace）。
          const owner = await tx
            .select({ claimedBy: agentRuns.claimedBy })
            .from(agentRuns)
            .where(eq(agentRuns.id, runId))
            .limit(1);
          if (owner[0]?.claimedBy !== fencingWorkerId) {
            return [];
          }
        }
        await tx.delete(agentSteps).where(eq(agentSteps.agentRunId, runId));
        if (trace.length === 0) {
          return [];
        }
        return tx
          .insert(agentSteps)
          .values(trace.map((step, index) => ({
            id: stableUuid(`${runId}:${step.id}:${index + 1}`),
            agentRunId: runId,
            seq: index + 1,
            stepNo: step.stepNo,
            phase: step.phase,
            inputJson: {},
            outputExcerpt: step.outputExcerpt,
            controlSignal: step.controlSignal,
            snapshotId: step.snapshotId,
            createdAt: step.createdAt
          })))
          .returning();
      });
    },

    async setWorkdir(runId, workdirRef, at, fencingWorkerId) {
      const rows = await db
        .update(agentRuns)
        .set({ workdirRef, updatedAt: at })
        .where(and(
          eq(agentRuns.id, runId),
          fencingWorkerId ? eq(agentRuns.claimedBy, fencingWorkerId) : undefined
        ))
        .returning();
      return rows[0] ?? null;
    },

    findById(runId) {
      return readStoredAgentRun(db, runId);
    },

    async listActive() {
      // L#54：一次查活跃 run，再一次批量查它们的 step（按 run 分组），避免每个 run 再各发 2 条查询（N+1）。
      const runRows = await db
        .select()
        .from(agentRuns)
        .where(inArray(agentRuns.status, activeStatuses))
        .orderBy(asc(agentRuns.createdAt));
      if (runRows.length === 0) {
        return [];
      }
      const runIds = runRows.map((row) => row.id);
      const allSteps = await db
        .select()
        .from(agentSteps)
        .where(inArray(agentSteps.agentRunId, runIds))
        .orderBy(asc(agentSteps.seq), asc(agentSteps.createdAt));
      const stepsByRun = new Map<string, typeof allSteps>();
      for (const step of allSteps) {
        const list = stepsByRun.get(step.agentRunId);
        if (list) {
          list.push(step);
        } else {
          stepsByRun.set(step.agentRunId, [step]);
        }
      }
      return runRows.map((run) => ({ run, steps: stepsByRun.get(run.id) ?? [] }));
    },

    claimQueued(runId, claim) {
      return claimById(runId, claim);
    },

    async claimNextQueued(claim) {
      return db.transaction(async (tx) => {
        const candidates = await tx
          .select({ id: agentRuns.id })
          .from(agentRuns)
          .where(eq(agentRuns.status, "queued"))
          .orderBy(asc(agentRuns.createdAt))
          .limit(1)
          .for("update", { skipLocked: true });
        const candidate = candidates[0];
        if (!candidate) {
          return null;
        }
        const rows = await tx
          .update(agentRuns)
          .set(claimUpdateValues(claim))
          .where(and(eq(agentRuns.id, candidate.id), eq(agentRuns.status, "queued")))
          .returning();
        const row = rows[0];
        if (!row) {
          return null;
        }
        const steps = await tx
          .select()
          .from(agentSteps)
          .where(eq(agentSteps.agentRunId, row.id))
          .orderBy(asc(agentSteps.seq), asc(agentSteps.createdAt));
        return { run: row, steps };
      });
    },

    async heartbeatClaim(input) {
      const rows = await db
        .update(agentRuns)
        .set({
          heartbeatAt: input.heartbeatAt,
          leaseExpiresAt: input.leaseExpiresAt,
          updatedAt: input.heartbeatAt
        })
        .where(and(
          eq(agentRuns.id, input.runId),
          eq(agentRuns.status, "running"),
          eq(agentRuns.claimedBy, input.workerId)
        ))
        .returning();
      return rows[0] ?? null;
    },

    async requeueExpiredClaims(input) {
      return db
        .update(agentRuns)
        .set({
          status: "queued",
          claimedBy: null,
          claimedAt: null,
          heartbeatAt: null,
          leaseExpiresAt: null,
          startedAt: null,
          updatedAt: input.requeuedAt
        })
        .where(and(
          eq(agentRuns.status, "running"),
          lt(agentRuns.leaseExpiresAt, input.expiredBefore)
        ))
        .returning();
    }
  };
}
