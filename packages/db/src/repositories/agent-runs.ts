import { createHash } from "node:crypto";

import { asc, eq, inArray } from "drizzle-orm";

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

export type AgentRunRepository = {
  createRun: (run: AgentRunForPersistence) => Promise<AgentRunRow>;
  updateRun: (run: AgentRunForPersistence) => Promise<AgentRunRow | null>;
  replaceTrace: (runId: string, trace: AgentRunTraceForPersistence[]) => Promise<AgentStepRow[]>;
  setWorkdir: (runId: string, workdirRef: string, at: Date) => Promise<AgentRunRow | null>;
  findById: (runId: string) => Promise<StoredAgentRunRows | null>;
  listActive: () => Promise<StoredAgentRunRows[]>;
};

const terminalStatuses: AgentRunStatusForPersistence[] = ["succeeded", "failed", "escalated", "cancelled"];
const activeStatuses: AgentRunStatusForPersistence[] = ["queued", "running"];

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
  return {
    async createRun(run) {
      const rows = await db.insert(agentRuns).values(runInsertValues(run)).returning();
      const row = rows[0];
      if (!row) {
        throw new Error("Failed to create agent run");
      }
      return row;
    },

    async updateRun(run) {
      const rows = await db
        .update(agentRuns)
        .set(runUpdateValues(run))
        .where(eq(agentRuns.id, run.runId))
        .returning();
      return rows[0] ?? null;
    },

    async replaceTrace(runId, trace) {
      await db.delete(agentSteps).where(eq(agentSteps.agentRunId, runId));
      if (trace.length === 0) {
        return [];
      }
      const rows = await db
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
      return rows;
    },

    async setWorkdir(runId, workdirRef, at) {
      const rows = await db
        .update(agentRuns)
        .set({ workdirRef, updatedAt: at })
        .where(eq(agentRuns.id, runId))
        .returning();
      return rows[0] ?? null;
    },

    findById(runId) {
      return readStoredAgentRun(db, runId);
    },

    async listActive() {
      const rows = await db
        .select()
        .from(agentRuns)
        .where(inArray(agentRuns.status, activeStatuses))
        .orderBy(asc(agentRuns.createdAt));
      return Promise.all(rows.map((row) => readStoredAgentRun(db, row.id))).then((items) =>
        items.filter((item): item is StoredAgentRunRows => Boolean(item))
      );
    }
  };
}
