import { readAgentRunReminderFacts } from "@workhub/contracts";
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

import { getDefaultStructuredLogger } from "../logging.js";

import {
  AGENT_RUN_REMINDER_CAP
} from "../workers/agent-runner.js";

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
    ...(run.task_plan_item_epoch !== undefined && run.task_plan_item_epoch !== null ? { taskPlanItemEpoch: run.task_plan_item_epoch } : {}),
    ...(run.source_conversation_id ? { sourceConversationId: run.source_conversation_id } : {}),
    ...(run.source_action_card_item_id ? { sourceActionCardItemId: run.source_action_card_item_id } : {}),
    ...(run.execution_hint ? { executionHint: run.execution_hint } : {}),
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
    // B6b：空数组不落列——缺席与 [] 同义（没被劝过），写 [] 只会让「这一列有没有内容」多出一个
    // 没有语义差别的第三态。省略键后 drizzle 在 UPDATE 里跳过这一列，既有值不被清空。
    ...(run.reminders?.length ? { remindersJson: run.reminders as unknown as Record<string, unknown>[] } : {}),
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

function queueStatus(status: string, runId?: string): AgentRunQueueStatus {
  switch (status) {
    case "queued":
    case "running":
    case "succeeded":
    case "failed":
    case "escalated":
    case "cancelled":
      return status;
    default:
      // INF-11：未知 DB 状态此前静默映射 failed——未来 schema 加新状态时无人察觉。
      // 留一条结构化 warn（含 runId/原始状态），映射行为不变（failed 兜底）。
      getDefaultStructuredLogger().warn("agent_run_unknown_status_mapped_to_failed", {
        status,
        ...(runId ? { runId } : {})
      });
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

// B6b：读回提醒。null（从没劝过）/ 非数组（脏数据）一律退回缺席；逐条走 contracts 的宽容读取，
// 解析不出来的那一条整条丢掉——渲染层宁可少一行，也绝不把半截数据编成一句话。上限与运行器写入侧同为
// AGENT_RUN_REMINDER_CAP，防一行畸形 JSON 把整页时间线撑爆。
function queueReminders(rows: StoredAgentRunRows): AgentRunQueueRecord["reminders"] {
  const raw = rows.run.remindersJson;
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const reminders = raw
    .map((item) => readAgentRunReminderFacts(item))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, AGENT_RUN_REMINDER_CAP);
  return reminders.length > 0 ? reminders : undefined;
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
  const reminders = queueReminders(rows);
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
    ...(rows.run.taskPlanItemEpoch !== null && rows.run.taskPlanItemEpoch !== undefined ? { task_plan_item_epoch: rows.run.taskPlanItemEpoch } : {}),
    ...(rows.run.sourceConversationId ? { source_conversation_id: rows.run.sourceConversationId } : {}),
    ...(rows.run.sourceActionCardItemId ? { source_action_card_item_id: rows.run.sourceActionCardItemId } : {}),
    ...(rows.run.executionHint ? { execution_hint: rows.run.executionHint as "server" | "local" | "any" } : {}),
    ...(rows.run.objectiveId ? { objective_id: rows.run.objectiveId } : {}),
    ...(rows.run.agentRole ? { agent_role: rows.run.agentRole } : {}),
    ...(rows.run.objectiveMd ? { objective_md: rows.run.objectiveMd } : {}),
    actor_id: rows.run.actorUserId ?? rows.run.actor,
    mode: rows.run.mode,
    status: queueStatus(rows.run.status, rows.run.id),
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
    ...(reminders ? { reminders } : {}),
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
