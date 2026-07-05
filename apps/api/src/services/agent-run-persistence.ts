import {
  createAgentRunRepository,
  getSharedDatabaseClient,
  type AgentRunForPersistence,
  type AgentRunRepository,
  type AgentRunTraceForPersistence,
  type AgentRunUsageForPersistence,
  type StoredAgentRunRows,
  type WorkHubDatabaseClient
} from "@workhub/db";

import type {
  AgentRunClaimLease,
  AgentRunHeartbeatLease,
  AgentRunPersistence,
  AgentRunQueueRecord,
  AgentRunQueueStatus,
  AgentRunRequeueExpiredLeases,
  AgentRunTraceStepRecord
} from "../workers/agent-runner.js";

function toDate(value: string | Date) {
  return value instanceof Date ? value : new Date(value);
}

function latestOutcome(run: AgentRunQueueRecord) {
  return run.trace.at(-1)?.output_excerpt?.slice(0, 256);
}

function handoffMd(handoff: AgentRunQueueRecord["handoff"]) {
  if (!handoff) {
    return undefined;
  }
  return [
    handoff.done.length ? `已完成: ${handoff.done.join("；")}` : undefined,
    handoff.remaining.length ? `还剩: ${handoff.remaining.join("；")}` : undefined,
    handoff.next_steps.length ? `下一步: ${handoff.next_steps.join("；")}` : undefined,
    handoff.blockers.length ? `阻塞: ${handoff.blockers.join("；")}` : undefined
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function toPersistenceRun(run: AgentRunQueueRecord): AgentRunForPersistence {
  const outcomeReason = latestOutcome(run);
  const handoffText = handoffMd(run.handoff);
  return {
    runId: run.run_id,
    ...(run.org_id ? { orgId: run.org_id } : {}),
    ...(run.workspace_id ? { workspaceId: run.workspace_id } : {}),
    workItemId: run.work_item_id,
    ...(run.parent_run_id ? { parentRunId: run.parent_run_id } : {}),
    ...(run.task_plan_id ? { taskPlanId: run.task_plan_id } : {}),
    ...(run.task_plan_item_id ? { taskPlanItemId: run.task_plan_item_id } : {}),
    ...(run.objective_id ? { objectiveId: run.objective_id } : {}),
    ...(run.agent_role ? { agentRole: run.agent_role } : {}),
    ...(run.objective_md ? { objectiveMd: run.objective_md } : {}),
    actorUserId: run.actor_id,
    mode: run.mode,
    status: run.status,
    title: run.title,
    model: run.budget_decision.model_route.model,
    budget: {
      maxSteps: run.budget.max_steps,
      totalTimeoutS: run.budget.total_timeout_s,
      maxTokens: run.budget.max_tokens,
      maxCostCny: run.budget.max_cost_cny
    },
    budgetDecisionJson: run.budget_decision as unknown as Record<string, unknown>,
    usage: {
      stepsUsed: run.usage.steps_used,
      tokenIn: run.usage.token_in,
      tokenOut: run.usage.token_out,
      estimatedCostCny: run.usage.estimated_cost_cny
    },
    ...(outcomeReason ? { outcomeReason } : {}),
    ...(handoffText ? { handoffMd: handoffText } : {}),
    ...(run.handoff ? { handoffJson: run.handoff as unknown as Record<string, unknown> } : {}),
    ...(run.workdir_ref ? { workdirRef: run.workdir_ref } : {}),
    createdAt: toDate(run.created_at),
    updatedAt: toDate(run.updated_at)
  };
}

function toPersistenceTrace(trace: AgentRunTraceStepRecord[]): AgentRunTraceForPersistence[] {
  return trace.map((step) => ({
    id: step.id,
    stepNo: step.step_no,
    phase: step.phase,
    ...(step.output_excerpt ? { outputExcerpt: step.output_excerpt } : {}),
    ...(step.control_signal ? { controlSignal: step.control_signal } : {}),
    ...(step.snapshot_id ? { snapshotId: step.snapshot_id } : {}),
    createdAt: toDate(step.created_at)
  }));
}

function queueStatus(status: string): AgentRunQueueStatus {
  switch (status) {
    case "queued":
    case "running":
    case "succeeded":
    case "failed":
    case "escalated":
    case "cancelled":
      return status;
    default:
      return "failed";
  }
}

function queueBudgetDecision(rows: StoredAgentRunRows): AgentRunQueueRecord["budget_decision"] {
  const raw = jsonObject(rows.run.budgetDecisionJson);
  const route = jsonObject(raw.model_route);
  if (
    typeof raw.decision_id === "string" &&
    typeof raw.allowed === "boolean" &&
    typeof route.provider === "string" &&
    typeof route.model === "string" &&
    typeof route.reason === "string"
  ) {
    return raw as AgentRunQueueRecord["budget_decision"];
  }
  return {
    decision_id: `${rows.run.id}:budget`,
    allowed: true,
    model_route: {
      provider: "persisted",
      model: rows.run.model,
      reason: "default"
    }
  };
}

function queueUsage(rows: StoredAgentRunRows): AgentRunUsageForPersistence {
  return {
    stepsUsed: rows.run.turnsUsed,
    tokenIn: rows.run.tokenIn,
    tokenOut: rows.run.tokenOut,
    estimatedCostCny: rows.run.costEstimate ?? "0"
  };
}

function queueHandoff(rows: StoredAgentRunRows): AgentRunQueueRecord["handoff"] {
  const raw = jsonObject(rows.run.handoffJson);
  const done = stringArray(raw.done);
  const remaining = stringArray(raw.remaining);
  const nextSteps = stringArray(raw.next_steps);
  const blockers = stringArray(raw.blockers);
  const artifacts = stringArray(raw.artifacts);
  if (!done.length && !remaining.length && !nextSteps.length && !blockers.length && !artifacts.length) {
    return undefined;
  }
  return {
    done,
    remaining,
    next_steps: nextSteps,
    blockers,
    artifacts,
    budget_hit: typeof raw.budget_hit === "string" ? raw.budget_hit : "unknown"
  };
}

function queueTrace(rows: StoredAgentRunRows): AgentRunTraceStepRecord[] {
  return rows.steps.map((step) => {
    const record: AgentRunTraceStepRecord = {
      id: step.id,
      step_no: step.stepNo,
      phase: step.phase as AgentRunTraceStepRecord["phase"],
      created_at: step.createdAt.toISOString()
    };
    if (step.outputExcerpt) {
      record.output_excerpt = step.outputExcerpt;
    }
    if (step.controlSignal) {
      record.control_signal = step.controlSignal as NonNullable<AgentRunTraceStepRecord["control_signal"]>;
    }
    if (step.snapshotId) {
      record.snapshot_id = step.snapshotId;
    }
    return record;
  });
}

function toQueueRun(rows: StoredAgentRunRows): AgentRunQueueRecord {
  const usage = queueUsage(rows);
  const handoff = queueHandoff(rows);
  const claim = rows.run.claimedBy && rows.run.claimedAt && rows.run.heartbeatAt && rows.run.leaseExpiresAt
    ? {
        claimed_by: rows.run.claimedBy,
        claimed_at: rows.run.claimedAt.toISOString(),
        heartbeat_at: rows.run.heartbeatAt.toISOString(),
        lease_expires_at: rows.run.leaseExpiresAt.toISOString()
      }
    : undefined;
  return {
    run_id: rows.run.id,
    ...(rows.run.orgId ? { org_id: rows.run.orgId } : {}),
    ...(rows.run.workspaceId ? { workspace_id: rows.run.workspaceId } : {}),
    work_item_id: rows.run.workItemId,
    ...(rows.run.parentRunId ? { parent_run_id: rows.run.parentRunId } : {}),
    ...(rows.run.taskPlanId ? { task_plan_id: rows.run.taskPlanId } : {}),
    ...(rows.run.taskPlanItemId ? { task_plan_item_id: rows.run.taskPlanItemId } : {}),
    ...(rows.run.objectiveId ? { objective_id: rows.run.objectiveId } : {}),
    ...(rows.run.agentRole ? { agent_role: rows.run.agentRole } : {}),
    ...(rows.run.objectiveMd ? { objective_md: rows.run.objectiveMd } : {}),
    actor_id: rows.run.actorUserId ?? rows.run.actor,
    mode: rows.run.mode,
    status: queueStatus(rows.run.status),
    title: rows.run.title,
    ...(rows.run.workdirRef ? { workdir_ref: rows.run.workdirRef } : {}),
    budget: {
      max_steps: rows.run.maxTurns,
      total_timeout_s: rows.run.totalTimeoutS,
      max_tokens: rows.run.maxTokens,
      max_cost_cny: rows.run.maxCostCny
    },
    budget_decision: queueBudgetDecision(rows),
    usage: {
      steps_used: usage.stepsUsed,
      token_in: usage.tokenIn,
      token_out: usage.tokenOut,
      estimated_cost_cny: usage.estimatedCostCny
    },
    trace: queueTrace(rows),
    ...(handoff ? { handoff } : {}),
    ...(claim ? { claim } : {}),
    created_at: rows.run.createdAt.toISOString(),
    updated_at: rows.run.updatedAt.toISOString()
  };
}

function claimForRepository(claim: AgentRunClaimLease) {
  return {
    workerId: claim.workerId,
    claimedAt: claim.claimedAt,
    heartbeatAt: claim.heartbeatAt,
    leaseExpiresAt: claim.leaseExpiresAt
  };
}

function heartbeatForRepository(input: AgentRunHeartbeatLease) {
  return {
    runId: input.runId,
    workerId: input.workerId,
    heartbeatAt: input.heartbeatAt,
    leaseExpiresAt: input.leaseExpiresAt
  };
}

function requeueForRepository(input: AgentRunRequeueExpiredLeases) {
  return {
    expiredBefore: input.expiredBefore,
    requeuedAt: input.requeuedAt,
    maxRecoverAttempts: input.maxRecoverAttempts
  };
}

export function createDbAgentRunPersistence(repository: AgentRunRepository): AgentRunPersistence {
  return {
    async createRun(run) {
      await repository.createRun(toPersistenceRun(run));
    },

    async createRunIfWorkItemIdle(run) {
      const row = await repository.createRunIfWorkItemIdle(toPersistenceRun(run));
      return Boolean(row);
    },

    async updateRun(run, workerId) {
      const row = await repository.updateRun(toPersistenceRun(run), workerId);
      return Boolean(row);
    },

    async cancelActiveRun(run) {
      const row = await repository.cancelActiveRun(toPersistenceRun(run));
      if (!row) {
        return null;
      }
      const rows = await repository.findById(row.id);
      return rows ? toQueueRun(rows) : null;
    },

    async replaceTrace(runId, trace, workerId) {
      await repository.replaceTrace(runId, toPersistenceTrace(trace), workerId);
    },

    async setWorkdir(runId, workdir, at, workerId) {
      await repository.setWorkdir(runId, workdir, at, workerId);
    },

    async get(runId) {
      const rows = await repository.findById(runId);
      return rows ? toQueueRun(rows) : null;
    },

    async getWorkdir(runId) {
      const rows = await repository.findById(runId);
      return rows?.run.workdirRef ?? null;
    },

    async listActive() {
      const rows = await repository.listActive();
      return rows.map(toQueueRun);
    },

    async listUnsettledTaskPlanRuns(input) {
      const rows = await repository.listUnsettledTaskPlanRuns(input);
      return rows.map(toQueueRun);
    },

    async claimQueued(runId, claim) {
      const rows = await repository.claimQueued(runId, claimForRepository(claim));
      return rows ? toQueueRun(rows) : null;
    },

    async claimNextQueued(claim) {
      const rows = await repository.claimNextQueued(claimForRepository(claim));
      return rows ? toQueueRun(rows) : null;
    },

    async heartbeatClaim(input) {
      const row = await repository.heartbeatClaim(heartbeatForRepository(input));
      return row ? toQueueRun({ run: row, steps: [] }) : null;
    },

    async requeueExpiredClaims(input) {
      const rows = await repository.requeueExpiredClaims(requeueForRepository(input));
      return rows.map((run) => toQueueRun({ run, steps: [] }));
    },

    async restoreDeadLetterClaim(input) {
      const row = await repository.restoreDeadLetterClaim({
        runId: input.runId,
        restoredAt: input.restoredAt,
        claim: claimForRepository(input.claim)
      });
      return row ? toQueueRun({ run: row, steps: [] }) : null;
    }
  };
}

let defaultAgentRunDbClient: WorkHubDatabaseClient | undefined;
let defaultAgentRunPersistence: AgentRunPersistence | undefined;

export function getDefaultAgentRunPersistence() {
  if (!defaultAgentRunPersistence) {
    defaultAgentRunDbClient = getSharedDatabaseClient();
    defaultAgentRunPersistence = createDbAgentRunPersistence(createAgentRunRepository(defaultAgentRunDbClient.db));
  }
  return defaultAgentRunPersistence;
}
