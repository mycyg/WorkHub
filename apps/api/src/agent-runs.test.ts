import assert from "node:assert/strict";
import { mkdtemp, readFile, mkdir, writeFile, utimes, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { AgentLoopClient } from "@workhub/agent/loop";
import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { loadSettings, type Settings } from "@workhub/config";
import {
  allowedWorkItemTransitions,
  eventTypes,
  type AcceptedDeliverableVM,
  type WorkHubEvent,
  type WorkItemStatus
} from "@workhub/contracts";
import { buildUsageRecord, createMemoryCostLedgerStore, decideRunBudget } from "@workhub/cost";
import { topics } from "@workhub/events";
import type {
  AuditLogRepository,
  AuditLogRow,
  BudgetReservationRepository,
  AiDecisionRepository,
  ClientDeviceAuthRow,
  ClientDeviceRepository,
  ConfidenceRecordRow,
  EscalationEventRow,
  MergeAttemptRow,
  MergeProposalRow,
  SnapshotRepository,
  SnapshotRow,
  UserAuthRow,
  UserRepository,
  WorkItemHumanReservedRow,
  WorkItemRepository
} from "@workhub/db";

import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "./middleware/auth.js";
import { createAgentRunRoutes, type ProposalReplayAuditReader } from "./routes/agent-runs.js";
import { createAgentRunConfidenceRecorder } from "./services/agent-run-confidence.js";
import { createHumanReservedGuard } from "./services/human-reserved-guard.js";
import { createInMemoryProposalService } from "./services/proposals.js";
import { WorkItemServiceError, type WorkItemService } from "./services/work-items.js";
import {
  AgentRunnerError,
  createInMemoryAgentRunQueue,
  sweepStaleAgentWorkdirs,
  type AgentRunNotificationPublisher,
  type AgentRunClaimLease,
  type AgentRunHeartbeatLease,
  type AgentRunPersistence,
  type AgentRunQueue,
  type AgentRunQueueRecord,
  type AgentRunRequeueExpiredLeases,
  type AgentRunTraceStepRecord,
  type BudgetDecisionProvider
} from "./workers/agent-runner.js";
import { createAgentRunRecoveryScheduler } from "./workers/agent-run-recovery.js";

const now = new Date("2026-06-05T00:00:00.000Z");
const userId = "10000000-0000-4000-8000-000000000021";
const strangerId = "10000000-0000-4000-8000-000000000099";
const adminId = "10000000-0000-4000-8000-000000000098";
const projectOwnerId = "10000000-0000-4000-8000-000000000097";
const workItemId = "50000000-0000-4000-8000-000000000021";
const snapshotId = "70000000-0000-4000-8000-000000000025";
const confidenceId = "72000000-0000-4000-8000-000000000025";
const escalationId = "73000000-0000-4000-8000-000000000025";

class MemoryAgentRunPersistence implements AgentRunPersistence {
  public readonly rows = new Map<string, AgentRunQueueRecord>();
  public readonly traceWrites: AgentRunTraceStepRecord[][] = [];
  public readonly claims: { runId: string; workerId: string }[] = [];
  public readonly heartbeats: AgentRunHeartbeatLease[] = [];
  // 模拟 DB 的 agent_runs.recover_attempts 列：按 run 累计被恢复次数，到上限即转死信。
  private readonly recoverAttempts = new Map<string, number>();

  async createRun(run: AgentRunQueueRecord) {
    this.rows.set(run.run_id, structuredClone(run));
  }

  async createRunIfWorkItemIdle(run: AgentRunQueueRecord) {
    const existing = [...this.rows.values()].find(
      (candidate) =>
        candidate.work_item_id === run.work_item_id &&
        (candidate.status === "queued" || candidate.status === "running")
    );
    if (existing) {
      return false;
    }
    await this.createRun(run);
    return true;
  }

  async updateRun(run: AgentRunQueueRecord) {
    this.rows.set(run.run_id, structuredClone(run));
  }

  async replaceTrace(runId: string, trace: AgentRunTraceStepRecord[]) {
    this.traceWrites.push(structuredClone(trace));
    const run = this.rows.get(runId);
    if (run) {
      this.rows.set(runId, {
        ...run,
        trace: structuredClone(trace),
        updated_at: run.updated_at
      });
    }
  }

  async setWorkdir(runId: string, workdir: string) {
    const run = this.rows.get(runId);
    if (run) {
      this.rows.set(runId, {
        ...run,
        workdir_ref: workdir
      });
    }
  }

  async get(runId: string) {
    const run = this.rows.get(runId);
    return run ? structuredClone(run) : null;
  }

  async getWorkdir(runId: string) {
    return this.rows.get(runId)?.workdir_ref ?? null;
  }

  async listActive() {
    return [...this.rows.values()]
      .filter((run) => run.status === "queued" || run.status === "running")
      .map((run) => structuredClone(run));
  }

  private claimRun(run: AgentRunQueueRecord, claim: AgentRunClaimLease) {
    const claimed: AgentRunQueueRecord = {
      ...structuredClone(run),
      status: "running",
      claim: {
        claimed_by: claim.workerId,
        claimed_at: claim.claimedAt.toISOString(),
        heartbeat_at: claim.heartbeatAt.toISOString(),
        lease_expires_at: claim.leaseExpiresAt.toISOString()
      },
      updated_at: claim.claimedAt.toISOString()
    };
    this.rows.set(run.run_id, structuredClone(claimed));
    this.claims.push({ runId: run.run_id, workerId: claim.workerId });
    return structuredClone(claimed);
  }

  async claimQueued(runId: string, claim: AgentRunClaimLease) {
    const run = this.rows.get(runId);
    if (!run || run.status !== "queued") {
      return null;
    }
    return this.claimRun(run, claim);
  }

  async claimNextQueued(claim: AgentRunClaimLease) {
    const run = [...this.rows.values()]
      .filter((candidate) => candidate.status === "queued")
      .sort((left, right) => left.created_at.localeCompare(right.created_at))[0];
    return run ? this.claimRun(run, claim) : null;
  }

  async heartbeatClaim(input: AgentRunHeartbeatLease) {
    this.heartbeats.push({ ...input });
    const run = this.rows.get(input.runId);
    if (!run || run.status !== "running" || run.claim?.claimed_by !== input.workerId) {
      return null;
    }
    const updated: AgentRunQueueRecord = {
      ...structuredClone(run),
      claim: {
        claimed_by: input.workerId,
        claimed_at: run.claim.claimed_at,
        heartbeat_at: input.heartbeatAt.toISOString(),
        lease_expires_at: input.leaseExpiresAt.toISOString()
      },
      updated_at: input.heartbeatAt.toISOString()
    };
    this.rows.set(input.runId, structuredClone(updated));
    return structuredClone(updated);
  }

  async requeueExpiredClaims(input: AgentRunRequeueExpiredLeases) {
    const recovered: AgentRunQueueRecord[] = [];
    for (const run of this.rows.values()) {
      if (
        run.status === "running" &&
        run.claim &&
        new Date(run.claim.lease_expires_at).getTime() < input.expiredBefore.getTime()
      ) {
        // 已恢复 >= 上限：转死信 failed，不再重排（与 DB repo 同口径）。
        const attempts = this.recoverAttempts.get(run.run_id) ?? 0;
        const deadLetter = attempts >= input.maxRecoverAttempts;
        this.recoverAttempts.set(run.run_id, attempts + 1);
        const updated: AgentRunQueueRecord = {
          ...structuredClone(run),
          status: deadLetter ? "failed" : "queued",
          updated_at: input.requeuedAt.toISOString()
        };
        delete updated.claim;
        this.rows.set(run.run_id, structuredClone(updated));
        recovered.push(structuredClone(updated));
      }
    }
    return recovered;
  }
}

function user(partial: Partial<UserAuthRow> = {}): UserAuthRow {
  return {
    id: userId,
    nickname: "agent-run-user",
    cookieToken: "cookie-agent-run",
    preferredLocale: "zh-CN",
    availabilityStatus: "free",
    availabilityText: null,
    availabilityUpdatedAt: null,
    mutedNotificationTypes: [],
    isAdmin: false,
    deletedAt: null,
    deletedByUserId: null,
    createdAt: now,
    updatedAt: now,
    ...partial
  };
}

class MemoryUsers implements UserRepository {
  constructor(private readonly rows: UserAuthRow[]) {}

  async findActiveById(id: string) {
    return this.rows.find((candidate) => candidate.id === id && candidate.deletedAt === null) ?? null;
  }

  async findActiveByCookieToken(cookieToken: string) {
    return this.rows.find((candidate) => candidate.cookieToken === cookieToken && candidate.deletedAt === null) ?? null;
  }

  async findActiveByNickname() {
    return null;
  }

  async createUser(): Promise<UserAuthRow> {
    throw new Error("not needed");
  }

  async getOrCreateActiveByNickname(): Promise<{ user: UserAuthRow; created: boolean }> {
    throw new Error("not needed");
  }

  async rotateCookieToken() {
    return null;
  }
}

class MemoryDevices implements ClientDeviceRepository {
  async findActiveByTokenHash() {
    return null;
  }

  async findActiveByTokenHashForUser() {
    return null;
  }

  async createClientDevice(): Promise<ClientDeviceAuthRow> {
    throw new Error("not needed");
  }

  async listByUser() {
    return [];
  }

  async touchLastSeen() {
    return null;
  }

  async revokeByIdForUser() {
    return null;
  }

  async revokeByTokenHash() {
    return null;
  }
}

function snapshotRow(partial: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    id: snapshotId,
    workItemId,
    branchId: null,
    kind: "pre_step",
    ref: "snapshot-ref",
    contentSha256: null,
    createdByKind: "ai",
    revertedAt: null,
    createdAt: now,
    ...partial
  };
}

function auditLogRow(partial: Partial<AuditLogRow> = {}): AuditLogRow {
  return {
    id: "71000000-0000-4000-8000-000000000025",
    orgId: null,
    workspaceId: null,
    actorKind: "ai",
    actorUserId: null,
    actorNickname: "WorkHub AI",
    entityType: "work_item",
    entityId: workItemId,
    action: "tool.write_file.snapshot",
    detailJson: {},
    snapshotId,
    undoneAt: null,
    createdAt: now,
    ...partial
  };
}

function confidenceRecordRow(partial: Partial<ConfidenceRecordRow> = {}): ConfidenceRecordRow {
  return {
    id: confidenceId,
    workItemId,
    proposalId: null,
    agentRunId: null,
    confidenceScore: 0.88,
    riskScore: 0.16,
    grade: "high",
    riskLevel: "low",
    verdict: "human_spotcheck",
    signalsJson: {},
    rationaleMd: null,
    createdAt: now,
    ...partial
  };
}

function escalationEventRow(partial: Partial<EscalationEventRow> = {}): EscalationEventRow {
  return {
    id: escalationId,
    workItemId,
    agentRunId: null,
    confidenceId: null,
    trigger: "unqualified",
    reasonMd: "AI 没有完成可用交付。",
    handoffJson: {},
    suggestedLeadUserId: null,
    resolvedAt: null,
    createdAt: now,
    ...partial
  };
}

function humanReservedWorkItemRow(partial: Partial<WorkItemHumanReservedRow> = {}): WorkItemHumanReservedRow {
  return {
    id: workItemId,
    code: "WH-21",
    title: "Manual-only client approval",
    status: "spec_ready",
    mode: "worker",
    humanReserved: true,
    submitterUserId: userId,
    claimedByUserId: null,
    workspaceId: "00000000-0000-4000-8000-000000000002",
    ...partial
  };
}

class MemorySnapshots implements SnapshotRepository {
  public rows: SnapshotRow[] = [];

  async createSnapshot(input: Parameters<SnapshotRepository["createSnapshot"]>[0]) {
    const row = snapshotRow({
      id: input.id ?? snapshotId,
      workItemId: input.workItemId,
      branchId: input.branchId ?? null,
      kind: input.kind,
      ref: input.ref,
      contentSha256: input.contentSha256 ?? null,
      createdByKind: input.createdByKind
    });
    this.rows.push(row);
    return row;
  }

  async findSnapshotById(id: string) {
    return this.rows.find((row) => row.id === id) ?? null;
  }

  async listSnapshotsForWorkItem(id: string) {
    return this.rows.filter((row) => row.workItemId === id);
  }

  async markSnapshotReverted(id: string, at: Date) {
    const row = this.rows.find((candidate) => candidate.id === id) ?? null;
    if (!row) {
      return null;
    }
    row.revertedAt = at;
    return row;
  }
}

class MemoryWorkItems implements WorkItemRepository {
  public rows = new Map<string, WorkItemHumanReservedRow>();

  constructor(rows: WorkItemHumanReservedRow[]) {
    for (const row of rows) {
      this.rows.set(row.id, row);
    }
  }

  async findWorkItemForHumanReservedGuard(id: string) {
    return this.rows.get(id) ?? null;
  }

  async findWorkItemForNotificationContext(id: string) {
    const row = this.rows.get(id);
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      code: row.code,
      title: row.title,
      projectId: "50000000-0000-4000-8000-000000000099",
      submitterUserId: row.submitterUserId,
      claimedByUserId: row.claimedByUserId,
      projectOwnerUserId: projectOwnerId
    };
  }

  async markHumanReservedPmMode(input: Parameters<WorkItemRepository["markHumanReservedPmMode"]>[0]) {
    const row = this.rows.get(input.workItemId);
    if (!row?.humanReserved) {
      return null;
    }
    const updated: WorkItemHumanReservedRow = {
      ...row,
      status: "pm_mode",
      mode: "pm"
    };
    this.rows.set(input.workItemId, updated);
    return updated;
  }

  transitions: { workItemId: string; to: string }[] = [];
  // 忠实复刻仓库层 CAS：仅当当前态是 `to` 的合法前驱时才写并返回 transitioned:true；否则幂等 no-op，
  // 回填当前真实状态 + transitioned:false（FIX#4 的「已在目标态 vs 非法前驱」判别全凭它）。
  async transitionWorkItemStatus(input: Parameters<WorkItemRepository["transitionWorkItemStatus"]>[0]) {
    this.transitions.push({ workItemId: input.workItemId, to: input.to });
    const row = this.rows.get(input.workItemId);
    if (!row) {
      return null;
    }
    const predecessors = (Object.entries(allowedWorkItemTransitions) as [WorkItemStatus, readonly WorkItemStatus[]][])
      .filter(([, targets]) => targets.includes(input.to))
      .map(([from]) => from);
    if (predecessors.includes(row.status as WorkItemStatus)) {
      this.rows.set(input.workItemId, { ...row, status: input.to });
      return { id: input.workItemId, status: input.to, transitioned: true };
    }
    return { id: input.workItemId, status: row.status as WorkItemStatus, transitioned: false };
  }
}

class MemoryAuditLogs implements AuditLogRepository {
  public rows: AuditLogRow[] = [];

  async createAuditLog(input: Parameters<AuditLogRepository["createAuditLog"]>[0]) {
    const row = auditLogRow({
      id: input.id ?? `71000000-0000-4000-8000-${String(this.rows.length + 25).padStart(12, "0")}`,
      orgId: input.orgId ?? null,
      workspaceId: input.workspaceId ?? null,
      actorKind: input.actorKind,
      actorUserId: input.actorUserId ?? null,
      actorNickname: input.actorNickname ?? null,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      detailJson: input.detailJson ?? {},
      snapshotId: input.snapshotId ?? null
    });
    this.rows.push(row);
    return row;
  }

  async listAuditLogsForEntity(entityType: string, entityId: string) {
    return this.rows.filter((row) => row.entityType === entityType && row.entityId === entityId);
  }

  async listAuditLogsForWorkItem(id: string) {
    return this.listAuditLogsForEntity("work_item", id);
  }

  async markAuditLogUndone(id: string, at: Date) {
    const row = this.rows.find((candidate) => candidate.id === id) ?? null;
    if (!row) {
      return null;
    }
    row.undoneAt = at;
    return row;
  }
}

class MemoryAiDecisions implements AiDecisionRepository {
  public confidenceRows: ConfidenceRecordRow[] = [];
  public escalationRows: EscalationEventRow[] = [];

  async createConfidenceRecord(input: Parameters<AiDecisionRepository["createConfidenceRecord"]>[0]) {
    const row = confidenceRecordRow({
      id: input.id ?? `72000000-0000-4000-8000-${String(this.confidenceRows.length + 25).padStart(12, "0")}`,
      workItemId: input.workItemId,
      proposalId: input.proposalId ?? null,
      agentRunId: input.agentRunId ?? null,
      confidenceScore: input.confidenceScore,
      riskScore: input.riskScore,
      grade: input.grade,
      riskLevel: input.riskLevel,
      verdict: input.verdict,
      signalsJson: input.signalsJson ?? {},
      rationaleMd: input.rationaleMd ?? null
    });
    this.confidenceRows.push(row);
    return row;
  }

  async listConfidenceRecordsForWorkItem(id: string) {
    return this.confidenceRows.filter((row) => row.workItemId === id);
  }

  async findConfidenceRecordForAgentRun(id: string) {
    return this.confidenceRows.find((row) => row.agentRunId === id) ?? null;
  }

  async createEscalationEvent(input: Parameters<AiDecisionRepository["createEscalationEvent"]>[0]) {
    const row = escalationEventRow({
      id: input.id ?? `73000000-0000-4000-8000-${String(this.escalationRows.length + 25).padStart(12, "0")}`,
      workItemId: input.workItemId,
      agentRunId: input.agentRunId ?? null,
      confidenceId: input.confidenceId ?? null,
      trigger: input.trigger,
      reasonMd: input.reasonMd,
      handoffJson: input.handoffJson ?? {},
      suggestedLeadUserId: input.suggestedLeadUserId ?? null
    });
    this.escalationRows.push(row);
    return row;
  }

  async listEscalationEventsForWorkItem(id: string) {
    return this.escalationRows.filter((row) => row.workItemId === id);
  }
}

function settings(): Settings {
  return loadSettings({
    APP_ENV: "test",
    COOKIE_SECRET: "test-cookie-secret"
  });
}

function authDeps(runtimeSettings: Settings, users: UserAuthRow[] = [user()]): AuthDependencies {
  return {
    users: new MemoryUsers(users),
    devices: new MemoryDevices(),
    settings: runtimeSettings,
    now: () => now
  };
}

function withErrors<T extends { Variables: Record<string, unknown> }>(app: Hono<T>) {
  app.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json({ ok: false, error: { code: "validation_error", message: "invalid payload" } }, 422);
    }
    if (error instanceof AgentRunnerError) {
      return c.json(
        {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            ...(error.details ? { details: error.details } : {})
          }
        },
        error.status as 400
      );
    }
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: "http_error", message: error.message } }, error.status);
    }
    throw error;
  });
  return app;
}

async function cookie(runtimeSettings: Settings, token = "cookie-agent-run") {
  return generateSignedCookie(COOKIE_NAME, token, runtimeSettings.auth.cookieSecret);
}

function acceptedDeliverable(partial: Partial<AcceptedDeliverableVM> = {}): AcceptedDeliverableVM {
  return {
    id: "74000000-0000-4000-8000-000000000001",
    work_item_id: workItemId,
    proposal_id: "74000000-0000-4000-8000-000000000002",
    change_id: "74000000-0000-4000-8000-000000000003",
    target_kind: "delivery",
    target_key: "delivery:/outputs/result.md",
    change_type: "created",
    accepted_version: 2,
    target_path: "/outputs/result.md",
    sha256: "b".repeat(64),
    drive_item_id: "74000000-0000-4000-8000-000000000004",
    drive_version_id: "74000000-0000-4000-8000-000000000005",
    filename: "result.md",
    mime: "text/markdown",
    size_bytes: 4,
    download_href: `/api/workitems/${workItemId}/deliverables/74000000-0000-4000-8000-000000000001/download`,
    preview_href: `/api/workitems/${workItemId}/deliverables/74000000-0000-4000-8000-000000000001/preview`,
    restore_href: `/api/workitems/${workItemId}/deliverables/74000000-0000-4000-8000-000000000001/restore`,
    accepted_at: now.toISOString(),
    ...partial
  };
}

function workItemsWithAcceptedDeliverables(deliverables: AcceptedDeliverableVM[]): WorkItemService {
  return {
    async createSession() {
      throw new Error("not needed");
    },
    async getSession() {
      throw new Error("not needed");
    },
    async nextQuestion() {
      throw new Error("not needed");
    },
    async createWorkItem() {
      throw new Error("not needed");
    },
    async bindEvidence() {
      throw new Error("not needed");
    },
    async searchKnowledge() {
      throw new Error("not needed");
    },
    async detailPage() {
      return {
        workitem: {
          id: workItemId,
          code: "WH-21",
          project_id: "50000000-0000-4000-8000-000000000099",
          submitter_user_id: userId,
          title: "Executable worker run",
          status: "merged",
          priority: "normal",
          sync_state: "synced",
          version: 1,
          mode: "worker",
          human_reserved: false,
          created_at: now.toISOString(),
          updated_at: now.toISOString()
        },
        acceptance: [],
        agent_trace_preview: [],
        accepted_deliverables: deliverables,
        evidence_refs: [],
        actions: {}
      };
    },
    async acceptedDeliverableFile() {
      throw new Error("not needed");
    },
    async restoreAcceptedDeliverable() {
      throw new Error("not needed");
    }
  };
}

function proposalAuditWithMergeTimeline(): ProposalReplayAuditReader {
  const proposalId = "75000000-0000-4000-8000-000000000001";
  const mergeAttemptId = "75000000-0000-4000-8000-000000000002";
  const mergeProposalId = "75000000-0000-4000-8000-000000000003";
  const targetKey = "delivery:/outputs/result.md";
  const attempt: MergeAttemptRow = {
    id: mergeAttemptId,
    proposalId,
    workItemId,
    branchId: "75000000-0000-4000-8000-000000000004",
    actorKind: "human",
    actorUserId: userId,
    result: "merged",
    mergeSnapshotId: snapshotId,
    conflictsJson: [{ target_key: targetKey }],
    acceptedTargetKeys: [targetKey],
    targetKeys: [targetKey],
    conflictCount: 1,
    createdAt: now
  };
  const mergeProposal: MergeProposalRow = {
    id: mergeProposalId,
    mergeAttemptId,
    conflictKey: targetKey,
    candidatesJson: [
      {
        option_key: "keep_current",
        target_kind: "delivery",
        rationale_md: "保留当前正式版，不覆盖已经采纳的交付物。"
      },
      {
        option_key: "accept_incoming",
        target_kind: "delivery",
        rationale_md: "明确采纳这次版本，覆盖当前正式版，并保留还原入口。"
      }
    ],
    recommendedOptionKey: "keep_current",
    chosenOptionKey: "accept_incoming",
    chosenByUserId: userId,
    chosenAt: now,
    createdAt: now,
    updatedAt: now
  };
  return {
    async listByWorkItem(candidateWorkItemId) {
      return candidateWorkItemId === workItemId ? [{ proposal: { id: proposalId } }] : [];
    },
    async listMergeAttemptsByProposal(candidateProposalId) {
      return candidateProposalId === proposalId ? [attempt] : [];
    },
    async listMergeProposalsByAttempt(candidateAttemptId) {
      return candidateAttemptId === mergeAttemptId ? [mergeProposal] : [];
    }
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

async function waitForRunStatus(
  queue: ReturnType<typeof createInMemoryAgentRunQueue>,
  runId: string,
  status: string,
  attempts = 100
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const run = await queue.get(runId);
    if (run?.status === status) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const latest = await queue.get(runId);
  throw new Error(`Timed out waiting for run ${runId} to reach ${status}; latest=${latest?.status ?? "missing"}`);
}

function executableAgentClient(): AgentLoopClient {
  const responses = [
    {
      id: "msg-run-1",
      stopReason: "tool_use",
      usage: { inputTokens: 10, outputTokens: 20 },
      usageRecord: {
        provider: "deepseek",
        model: "deepseek-v4-flash",
        task: "worker",
        inputTokens: 10,
        outputTokens: 20,
        estimatedCostCny: "0.001",
        source: "agent_step",
        createdAt: "2026-06-05T00:00:00.000Z"
      },
      content: [
        {
          type: "tool_use",
          id: "tool-1",
          name: "write_file",
          input: { path: "outputs/result.md", content: "done" }
        }
      ]
    },
    {
      id: "msg-run-2",
      stopReason: "end_turn",
      usage: { inputTokens: 5, outputTokens: 5 },
      usageRecord: {
        provider: "deepseek",
        model: "deepseek-v4-flash",
        task: "worker",
        inputTokens: 5,
        outputTokens: 5,
        estimatedCostCny: "0.002",
        source: "agent_step",
        createdAt: "2026-06-05T00:00:01.000Z"
      },
      content: [{ type: "text", text: "交付完成" }]
    },
    // findings[#2/#3]：loop 默认在成功后追加一次 llm_review。此前本 fake client 只排了 2 条 worker 响应，
    // 第 3 次（评审）调用会 throw —— 旧实现把 throw 静默吞成 undefined 并回退乐观启发式 0.88（human_spotcheck）。
    // 修复后 fail-closed：throw→escalate。为保留本用例「成功 run 的 trace/置信度 happy-path」原意，补一条
    // 合法 grade=5 评审响应，让置信度真按「高分评审」走（grade=5 是 #3 唯一进 auto-merge 资格带的档；
    // 但本用例未开 autoMergeAllowed → 仍降级 human_spotcheck，原断言不变且更有意义）。
    {
      id: "msg-run-review",
      stopReason: "end_turn",
      usage: { inputTokens: 0, outputTokens: 0 },
      content: [{ type: "text", text: "{\"grade\": 5, \"rationale\": \"可直接采纳\"}" }]
    }
  ] satisfies Awaited<ReturnType<AgentLoopClient["messages"]["create"]>>[];

  return {
    model: "deepseek-v4-flash",
    messages: {
      async create() {
        const response = responses.shift();
        if (!response) {
          throw new Error("No fake AgentLoop response queued");
        }
        return response;
      }
    }
  };
}

// FIX#5：成功 + 写出交付物(manifest)，但自评/评审给低分(grade=1) → confidenceScore≈0.41 → grade=low →
// matrixVerdict 落 escalate。用来构造「成功且有可审阅提议、但置信度判 escalate」的关键场景。
function escalateReviewAgentClient(): AgentLoopClient {
  const responses = [
    {
      id: "msg-esc-1",
      stopReason: "tool_use",
      usage: { inputTokens: 10, outputTokens: 20 },
      usageRecord: {
        provider: "deepseek",
        model: "deepseek-v4-flash",
        task: "worker",
        inputTokens: 10,
        outputTokens: 20,
        estimatedCostCny: "0.001",
        source: "agent_step",
        createdAt: "2026-06-05T00:00:00.000Z"
      },
      content: [
        {
          type: "tool_use",
          id: "tool-esc-1",
          name: "write_file",
          input: { path: "outputs/result.md", content: "done" }
        }
      ]
    },
    {
      id: "msg-esc-2",
      stopReason: "end_turn",
      usage: { inputTokens: 5, outputTokens: 5 },
      usageRecord: {
        provider: "deepseek",
        model: "deepseek-v4-flash",
        task: "worker",
        inputTokens: 5,
        outputTokens: 5,
        estimatedCostCny: "0.002",
        source: "agent_step",
        createdAt: "2026-06-05T00:00:01.000Z"
      },
      content: [{ type: "text", text: "交付完成" }]
    },
    // 低分评审：driving verdict 落到 escalate（而 run 仍成功、manifest 仍生成）。
    {
      id: "msg-esc-review",
      stopReason: "end_turn",
      usage: { inputTokens: 0, outputTokens: 0 },
      content: [{ type: "text", text: "{\"grade\": 1, \"rationale\": \"质量不足，建议人工复核\"}" }]
    }
  ] satisfies Awaited<ReturnType<AgentLoopClient["messages"]["create"]>>[];

  return {
    model: "deepseek-v4-flash",
    messages: {
      async create() {
        const response = responses.shift();
        if (!response) {
          throw new Error("No fake AgentLoop response queued");
        }
        return response;
      }
    }
  };
}

test("agent run prompt includes resolved WorkItem context before calling the model", async () => {
  const runtimeSettings = settings();
  const workdir = await mkdtemp(path.join(os.tmpdir(), "workhub-agent-context-test-"));
  const snapshotRoot = await mkdtemp(path.join(os.tmpdir(), "workhub-agent-context-snapshot-test-"));
  const snapshots = new MemorySnapshots();
  const auditLogs = new MemoryAuditLogs();
  const capturedMessages: unknown[] = [];
  const responses = [
    {
      id: "msg-context-1",
      stopReason: "tool_use",
      usage: { inputTokens: 10, outputTokens: 20 },
      content: [{
        type: "tool_use",
        id: "tool-context-1",
        name: "write_file",
        input: { path: "outputs/result.md", content: "done" }
      }]
    },
    {
      id: "msg-context-2",
      stopReason: "end_turn",
      usage: { inputTokens: 5, outputTokens: 5 },
      content: [{ type: "text", text: "交付完成" }]
    }
  ] satisfies Awaited<ReturnType<AgentLoopClient["messages"]["create"]>>[];
  const client: AgentLoopClient = {
    model: "deepseek-v4-flash",
    messages: {
      async create(params) {
        capturedMessages.push(params.messages[0]?.content);
        const response = responses.shift();
        if (!response) {
          throw new Error("No fake AgentLoop response queued");
        }
        return response;
      }
    }
  };
  const statusTransitions: string[] = [];
  const queue = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => now,
    id: () => "40000000-0000-4000-8000-000000000029",
    workdir: () => workdir,
    client: () => client,
    snapshotRoot,
    snapshotId: () => snapshotId,
    snapshots,
    auditLogs,
    confidence: false,
    proposals: false,
    notifications: false,
    eventBus: false,
    // findings[H8]：成功 run 应把工作项推进 in_review。
    transitionWorkItemStatus: async (input) => { statusTransitions.push(input.to); },
    workItemContext: () => [
      "- Work item: DAY0PILOT-005 - Prepare a concise Day 0 pilot validation note",
      "- Status / mode / priority: spec_ready / worker / normal",
      "- Raw description:",
      "  Prepare a concise Day 0 pilot validation note with screenshots and next actions.",
      "- User-selected clarification options: document-draft",
      "- Acceptance checks:",
      "  1. [open] Option-first intake - The task was clarified through options before AI work."
    ].join("\n")
  });

  const queued = await queue.enqueue({ workItemId, actorId: userId, title: "AI worker run" });
  const executed = await queue.runNext();
  const firstMessage = String(capturedMessages[0]);

  assert.equal(executed?.run_id, queued.run_id);
  assert.equal(executed?.status, "succeeded", JSON.stringify(executed?.trace));
  // FIX#5：本测试未接 proposalSink（proposals:false）→ 成功 run 没有可审阅交付物 → 工作项推进 escalated
  // （而非 in_review）。in_review 仅保留给「成功 + 开出提议」的 run（见下方 confidence/proposal 集成测试）。
  // 旧断言期望 in_review，依赖的是「无 proposalSink 也谎报 proposalOpened=true→in_review」的 bug——已修。
  assert.equal(statusTransitions.includes("escalated"), true);
  assert.equal(statusTransitions.includes("in_review"), false);
  assert.match(firstMessage, /WorkHub 数据库中的真实工单上下文/u);
  assert.match(firstMessage, /DAY0PILOT-005/u);
  assert.match(firstMessage, /Prepare a concise Day 0 pilot validation note/u);
  assert.match(firstMessage, /document-draft/u);
  assert.match(firstMessage, /Acceptance checks/u);
});

function noDeliverableAgentClient(): AgentLoopClient {
  return {
    model: "deepseek-v4-flash",
    messages: {
      async create() {
        return {
          id: "msg-failed-1",
          stopReason: "end_turn",
          usage: { inputTokens: 3, outputTokens: 4 },
          usageRecord: {
            provider: "deepseek",
            model: "deepseek-v4-flash",
            task: "worker",
            inputTokens: 3,
            outputTokens: 4,
            estimatedCostCny: "0.001",
            source: "agent_step",
            createdAt: "2026-06-05T00:00:00.000Z"
          },
          content: [{ type: "text", text: "我没有可交付文件。" }]
        };
      }
    }
  };
}

function singleToolThenDoneAgentClient(): AgentLoopClient {
  let calls = 0;
  return {
    model: "deepseek-v4-flash",
    messages: {
      async create() {
        calls += 1;
        if (calls === 1) {
          return {
            id: "msg-cancellable-1",
            stopReason: "tool_use",
            usage: { inputTokens: 1, outputTokens: 1 },
            content: [
              {
                type: "tool_use",
                id: "tool-cancel-1",
                name: "slow_tool",
                input: {}
              }
            ]
          };
        }
        return {
          id: "msg-cancellable-2",
          stopReason: "end_turn",
          usage: { inputTokens: 1, outputTokens: 1 },
          content: [{ type: "text", text: "交付完成" }]
        };
      }
    }
  };
}

test("agent run enqueue consumes P-COST decisions before creating a run", async () => {
  const runtimeSettings = settings();
  const queue = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => now,
    id: () => "40000000-0000-4000-8000-000000000021",
    usage: () => [
      {
        policyId: "pcost-user-day-v0",
        scope: { kind: "user", userId },
        tokenIn: 475000,
        tokenOut: 0,
        estimatedCostCny: "1"
      }
    ]
  });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createAgentRunRoutes({ auth: authDeps(runtimeSettings), queue, autoRun: false }));

  const response = await app.request(`/api/workitems/${workItemId}/agent-runs`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) },
    body: JSON.stringify({ title: "Weekly report" })
  });

  assert.equal(response.status, 202);
  const body = await response.json() as {
    ok: true;
    data: {
      budget: { max_tokens: number; max_cost_cny: string };
      budget_decision: { reason?: string; model_route: { reason: string }; notice?: { recommended_action: string } };
    };
  };
  assert.equal(body.data.budget.max_tokens, 25000);
  assert.equal(body.data.budget.max_cost_cny, "5");
  assert.equal(body.data.budget_decision.reason, "critical");
  assert.equal(body.data.budget_decision.model_route.reason, "near_budget_downgrade");
  assert.equal(body.data.budget_decision.notice?.recommended_action, "downgrade_model");
});

test("agent run enqueue denies starting AI on a work item the caller cannot read (cross-tenant IDOR guard)", async () => {
  const runtimeSettings = settings();
  let enqueued = false;
  const queue = {
    enqueue: async () => {
      enqueued = true;
      throw new Error("enqueue should not be reached when work-item access is denied");
    }
  } as unknown as AgentRunQueue;
  const denyingWorkItems = {
    detailPage: async () => {
      throw new WorkItemServiceError(403, "forbidden", "你没有权限查看这个事项。");
    }
  } as unknown as WorkItemService;
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createAgentRunRoutes({ auth: authDeps(runtimeSettings), queue, workItems: denyingWorkItems, autoRun: false }));

  const response = await app.request(`/api/workitems/${workItemId}/agent-runs`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) },
    body: JSON.stringify({ title: "should be blocked" })
  });

  assert.equal(response.status, 403);
  assert.equal(enqueued, false);
});

test("agent run enqueue returns budget_exhausted before queueing new work", async () => {
  const runtimeSettings = settings();
  const queue = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => now,
    id: () => "40000000-0000-4000-8000-000000000022",
    usage: () => [
      {
        policyId: "pcost-user-day-v0",
        scope: { kind: "user", userId },
        tokenIn: 500000,
        tokenOut: 1,
        estimatedCostCny: "20"
      }
    ]
  });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createAgentRunRoutes({ auth: authDeps(runtimeSettings), queue, autoRun: false }));

  const response = await app.request(`/api/workitems/${workItemId}/agent-runs`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) },
    body: JSON.stringify({ title: "Weekly report" })
  });

  assert.equal(response.status, 402);
  const body = await response.json() as {
    ok: false;
    error: {
      code: string;
      details?: {
        policy_id?: string;
        remaining_tokens?: number;
        remaining_cost_cny?: string;
        recommended_action?: string;
      };
    };
  };
  assert.equal(body.error.code, "budget_exhausted");
  assert.equal(body.error.details?.policy_id, "pcost-user-day-v0");
  assert.equal(body.error.details?.remaining_tokens, 0);
  assert.equal(body.error.details?.remaining_cost_cny, "0");
  assert.equal(body.error.details?.recommended_action, "ask_admin");
  assert.equal((await queue.listActive()).length, 0);
});

test("agent run enqueue reserves budget, denies an over-cap concurrent start, and compensates the queued run", async () => {
  const runtimeSettings = settings();
  // 默认拒绝（模拟并发在飞已占满该 scope 的预留）；之后切允许验证补偿释放了 work-item 槽。
  let reserveResult: { ok: true } | { ok: false; limitingScope: { kind: "team"; teamId: string }; limit: "tokens" } = {
    ok: false,
    limitingScope: { kind: "team", teamId: runtimeSettings.auth.defaultWorkspaceId },
    limit: "tokens"
  };
  const reserveInputs: Array<{ runId: string; scopes: Array<{ scopeKind: string; estTokens: number }> }> = [];
  const fakeReservationRepo = {
    reserve: async (input: { runId: string; scopes: Array<{ scopeKind: string; estTokens: number }> }) => {
      reserveInputs.push(input);
      return reserveResult;
    },
    reconcile: async () => 0,
    releaseExpired: async () => 0,
    refreshLease: async () => 0,
    outstandingForScopes: async () => new Map()
  };
  const queue = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => now,
    id: () => "40000000-0000-4000-8000-000000000031",
    reservationRepo: fakeReservationRepo as unknown as BudgetReservationRepository,
    confidence: false,
    proposals: false,
    notifications: false,
    eventBus: false
  });

  // 预留被拒 → enqueue 抛与 decideBudget 同款 402 budget_exhausted（decideBudget 本身放行，TOCTOU 由预留挡住）。
  await assert.rejects(
    () => queue.enqueue({ workItemId, actorId: userId, title: "denied by reservation" }),
    (error: unknown) => error instanceof AgentRunnerError && error.status === 402 && error.code === "budget_exhausted"
  );
  assert.equal(reserveInputs.length, 1);
  // 预留输入含受限 day/month scope，est = 本 run 的 per-run cap（>0）。
  assert.equal(reserveInputs[0]!.scopes.some((scope) => scope.scopeKind === "team"), true);
  assert.equal(reserveInputs[0]!.scopes.some((scope) => scope.scopeKind === "user"), true);
  assert.equal(reserveInputs[0]!.scopes.every((scope) => scope.estTokens > 0), true);
  // 补偿：被拒的 queued run 不留在 active 集合里。
  assert.equal((await queue.listActive()).length, 0);

  // 切允许后，同一 work item 能再次入队 → 证明上一次被干净补偿（work-item active 槽已释放）。
  reserveResult = { ok: true };
  const allowed = await queue.enqueue({ workItemId, actorId: userId, title: "allowed after compensation" });
  assert.equal(allowed.work_item_id, workItemId);
  assert.equal(reserveInputs.length, 2);
});

test("agent run enqueue uses ledger snapshots when no usage fixture is injected", async () => {
  const runtimeSettings = settings();
  const ledgerStore = createMemoryCostLedgerStore({ teamId: runtimeSettings.auth.defaultWorkspaceId });
  await ledgerStore.recordUsage(buildUsageRecord({
    provider: "deepseek",
    model: "deepseek-v4-flash",
    task: "worker",
    runId: "40000000-0000-4000-8000-000000000023",
    workItemId: "50000000-0000-4000-8000-000000000023",
    userId,
    inputTokens: 475000,
    outputTokens: 0,
    costTier: { inputCnyPerMtok: 2, outputCnyPerMtok: 8 },
    createdAt: now
  }));
  const queue = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    ledgerStore,
    now: () => now,
    id: () => "40000000-0000-4000-8000-000000000024"
  });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createAgentRunRoutes({ auth: authDeps(runtimeSettings), queue, autoRun: false }));

  const response = await app.request(`/api/workitems/${workItemId}/agent-runs`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) },
    body: JSON.stringify({ title: "Weekly report" })
  });

  assert.equal(response.status, 202);
  const body = await response.json() as { ok: true; data: { budget: { max_tokens: number } } };
  assert.equal(body.data.budget.max_tokens, 25000);
});

test("concurrent agent run starts keep one active run per work item", async () => {
  const runtimeSettings = settings();
  const budgetBarrier = deferred<void>();
  let budgetCalls = 0;
  let runIndex = 0;
  const queue = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => now,
    id: () => `40000000-0000-4000-8000-${String(30 + runIndex++).padStart(12, "0")}`,
    decideBudget: async (input) => {
      const callNo = ++budgetCalls;
      await budgetBarrier.promise;
      return decideRunBudget({
        settings: input.settings,
        scopeIds: {
          workItemId: input.workItemId,
          userId: input.actorId,
          teamId: input.settings.auth.defaultWorkspaceId
        },
        usage: [],
        modelRoute: {
          provider: input.settings.llm.defaultProvider,
          model: input.settings.llm.model,
          reason: "default"
        },
        now,
        decisionId: `budget-decision-${callNo}`
      });
    }
  });

  const starts = [
    queue.enqueue({ workItemId, actorId: userId, title: "Concurrent worker run A" }),
    queue.enqueue({ workItemId, actorId: userId, title: "Concurrent worker run B" })
  ];
  budgetBarrier.resolve();
  const results = await Promise.allSettled(starts);

  const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.ok(rejected);
  assert.equal(rejected.reason instanceof AgentRunnerError, true);
  assert.equal((rejected.reason as AgentRunnerError).status, 409);
  assert.equal((rejected.reason as AgentRunnerError).code, "agent_run_already_active");
  assert.equal(budgetCalls, 1);
  assert.equal((await queue.listActive()).length, 1);
});

test("persistent agent run enqueue rejects duplicate active work item across queue instances", async () => {
  const runtimeSettings = settings();
  const persistence = new MemoryAgentRunPersistence();
  const budgetBarrier = deferred<void>();
  let budgetCalls = 0;
  const decideBudgetForTest: BudgetDecisionProvider = async (input) => {
    const callNo = ++budgetCalls;
    await budgetBarrier.promise;
    return decideRunBudget({
      settings: input.settings,
      scopeIds: {
        workItemId: input.workItemId,
        userId: input.actorId,
        teamId: input.settings.auth.defaultWorkspaceId
      },
      usage: [],
      modelRoute: {
        provider: input.settings.llm.defaultProvider,
        model: input.settings.llm.model,
        reason: "default"
      },
      now,
      decisionId: `persistent-budget-decision-${callNo}`
    });
  };
  const queueA = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => now,
    id: () => "40000000-0000-4000-8000-000000000031",
    persistence,
    decideBudget: decideBudgetForTest,
    eventBus: false
  });
  const queueB = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => now,
    id: () => "40000000-0000-4000-8000-000000000032",
    persistence,
    decideBudget: decideBudgetForTest,
    eventBus: false
  });

  const starts = [
    queueA.enqueue({ workItemId, actorId: userId, title: "Persistent concurrent run A" }),
    queueB.enqueue({ workItemId, actorId: userId, title: "Persistent concurrent run B" })
  ];
  budgetBarrier.resolve();
  const results = await Promise.allSettled(starts);

  const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.ok(rejected);
  assert.equal(rejected.reason instanceof AgentRunnerError, true);
  assert.equal((rejected.reason as AgentRunnerError).status, 409);
  assert.equal((rejected.reason as AgentRunnerError).code, "agent_run_already_active");
  assert.equal(budgetCalls, 2);
  assert.equal((await persistence.listActive()).length, 1);
});

test("agent run queue refreshes stale cached trace from persistence", async () => {
  const runtimeSettings = settings();
  const persistence = new MemoryAgentRunPersistence();
  const queue = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => now,
    id: () => "40000000-0000-4000-8000-000000000033",
    persistence,
    confidence: false,
    proposals: false,
    notifications: false,
    eventBus: false
  });
  const run = await queue.enqueue({
    workItemId,
    actorId: userId,
    title: "Cross-worker cached replay run"
  });
  assert.equal((await queue.get(run.run_id))?.trace.length, 0);

  const persisted = await persistence.get(run.run_id);
  assert.ok(persisted);
  const remoteStep: AgentRunTraceStepRecord = {
    id: `${run.run_id}:remote:step`,
    step_no: 1,
    phase: "tool_result",
    output_excerpt: "Redis worker wrote a fresh step.",
    created_at: "2026-06-05T00:00:05.000Z"
  };
  persistence.rows.set(run.run_id, {
    ...persisted,
    trace: [remoteStep],
    updated_at: "2026-06-05T00:00:05.000Z"
  });

  const refreshed = await queue.get(run.run_id);
  const trace = await queue.trace(run.run_id);
  assert.equal(refreshed?.trace.at(-1)?.output_excerpt, remoteStep.output_excerpt);
  assert.deepEqual(trace.map((step) => step.id), [remoteStep.id]);
});

test("agent run route auto-pump drains through runNext instead of direct run id", async () => {
  const runtimeSettings = settings();
  const queuedRun: AgentRunQueueRecord = {
    run_id: "40000000-0000-4000-8000-000000000033",
    work_item_id: workItemId,
    actor_id: userId,
    mode: "worker",
    status: "queued",
    title: "Route queued worker run",
    budget: {
      max_steps: 15,
      total_timeout_s: 300,
      max_tokens: 120000,
      max_cost_cny: "5"
    },
    budget_decision: {
      decision_id: "route-auto-pump-budget",
      allowed: true,
      model_route: {
        provider: runtimeSettings.llm.defaultProvider,
        model: runtimeSettings.llm.model,
        reason: "default"
      }
    },
    usage: {
      steps_used: 0,
      token_in: 0,
      token_out: 0,
      estimated_cost_cny: "0"
    },
    trace: [],
    created_at: now.toISOString(),
    updated_at: now.toISOString()
  };
  let runCalls = 0;
  let runNextCalls = 0;
  const errors: unknown[] = [];
  const queue: AgentRunQueue = {
    async enqueue() {
      return queuedRun;
    },
    async get(runId) {
      return runId === queuedRun.run_id ? queuedRun : null;
    },
    async workdir() {
      return null;
    },
    async trace() {
      return [];
    },
    async abort() {
      return queuedRun;
    },
    async listActive() {
      return [queuedRun];
    },
    async recoverExpiredClaims() {
      return [];
    },
    async run() {
      runCalls += 1;
      throw new Error("direct run should not be used by route auto-pump");
    },
    async runNext() {
      runNextCalls += 1;
      return null;
    }
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createAgentRunRoutes({
    auth: authDeps(runtimeSettings),
    queue,
    onAutoRunError: (error) => errors.push(error)
  }));

  const response = await app.request(`/api/workitems/${workItemId}/agent-runs`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) },
    body: JSON.stringify({ title: "Route worker" })
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(response.status, 202);
  assert.equal(runCalls, 0);
  assert.equal(runNextCalls, 1);
  assert.deepEqual(errors, []);
});

test("agent run abort is limited to the run owner or an admin actor", async () => {
  const runtimeSettings = settings();
  let runIndex = 0;
  const queue = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => now,
    id: () => `40000000-0000-4000-8000-${String(40 + runIndex++).padStart(12, "0")}`
  });

  const ownedRun = await queue.enqueue({
    workItemId,
    actorId: userId,
    title: "Owner cancellable run"
  });
  await assert.rejects(
    () => queue.abort(ownedRun.run_id, "10000000-0000-4000-8000-000000000099"),
    (error) =>
      error instanceof AgentRunnerError &&
      error.status === 403 &&
      error.code === "agent_run_abort_forbidden"
  );
  assert.equal((await queue.get(ownedRun.run_id))?.status, "queued");

  const ownerCancelled = await queue.abort(ownedRun.run_id, userId);
  assert.equal(ownerCancelled.status, "cancelled");

  const adminRun = await queue.enqueue({
    workItemId,
    actorId: userId,
    title: "Admin cancellable run"
  });
  const adminCancelled = await queue.abort(adminRun.run_id, {
    id: "10000000-0000-4000-8000-000000000098",
    isAdmin: true
  });
  assert.equal(adminCancelled.status, "cancelled");
});

test("agent run read routes are limited to the run owner or an admin actor", async () => {
  const runtimeSettings = settings();
  const queue = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => now,
    id: () => "40000000-0000-4000-8000-000000000032"
  });
  const snapshots = new MemorySnapshots();
  const auditLogs = new MemoryAuditLogs();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createAgentRunRoutes({
    auth: authDeps(runtimeSettings, [
      user(),
      user({
        id: strangerId,
        nickname: "agent-run-stranger",
        cookieToken: "cookie-agent-run-stranger"
      }),
      user({
        id: adminId,
        nickname: "agent-run-admin",
        cookieToken: "cookie-agent-run-admin",
        isAdmin: true
      })
    ]),
    queue,
    snapshots,
    auditLogs,
    autoRun: false
  }));

  const queued = await queue.enqueue({
    workItemId,
    actorId: userId,
    title: "Private worker run"
  });
  const readRoutes = [
    `/api/agent-runs/${queued.run_id}`,
    `/api/agent-runs/${queued.run_id}/trace`,
    `/api/agent-runs/${queued.run_id}/handoff`,
    `/api/agent-runs/${queued.run_id}/replay`
  ];

  const strangerCookie = await cookie(runtimeSettings, "cookie-agent-run-stranger");
  for (const route of readRoutes) {
    const response = await app.request(route, { headers: { Cookie: strangerCookie } });
    assert.equal(response.status, 403, route);
    const body = await response.json() as { ok: false; error: { code: string } };
    assert.equal(body.error.code, "http_error");
  }

  const ownerCookie = await cookie(runtimeSettings);
  const adminCookie = await cookie(runtimeSettings, "cookie-agent-run-admin");
  for (const route of readRoutes) {
    const ownerResponse = await app.request(route, { headers: { Cookie: ownerCookie } });
    assert.equal(ownerResponse.status, 200, route);
    const adminResponse = await app.request(route, { headers: { Cookie: adminCookie } });
    assert.equal(adminResponse.status, 200, route);
  }
});

test("aborted running agent runs keep the cancelled state during finalize drift", async () => {
  const runtimeSettings = settings();
  const toolStarted = deferred<void>();
  const releaseTool = deferred<void>();
  const milestoneNotifications: { newStatus: string }[] = [];
  let toolExecutions = 0;
  let confidenceCalls = 0;
  const notifications: AgentRunNotificationPublisher = {
    async notifyMilestone(context) {
      milestoneNotifications.push({ newStatus: context.newStatus });
      return [];
    }
  };
  const queue = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => now,
    id: () => "40000000-0000-4000-8000-000000000031",
    client: () => singleToolThenDoneAgentClient(),
    requireDeliverable: false,
    confidence: async () => {
      confidenceCalls += 1;
      return { confidenceId };
    },
    notifications,
    tools: () => ({
      toModelTools: () => [],
      async execute() {
        toolExecutions += 1;
        toolStarted.resolve();
        await releaseTool.promise;
        return {
          ok: true,
          isError: false,
          content: "slow tool done"
        };
      }
    })
  });

  const queued = await queue.enqueue({
    workItemId,
    actorId: userId,
    title: "Cancellable worker run"
  });
  const running = queue.runNext();
  await toolStarted.promise;
  const aborted = await queue.abort(queued.run_id, userId);

  assert.equal(aborted.status, "cancelled");
  releaseTool.resolve();
  const settled = await running;
  const stored = await queue.get(queued.run_id);

  assert.equal(settled?.status, "cancelled");
  assert.equal(stored?.status, "cancelled");
  assert.equal(stored?.trace.length, 0);
  assert.equal(toolExecutions, 1);
  assert.equal(confidenceCalls, 0);
  assert.deepEqual(milestoneNotifications, []);
});

test("agent run enqueue opens user_forbidden escalation for human-reserved worker work", async () => {
  const runtimeSettings = settings();
  const workItems = new MemoryWorkItems([humanReservedWorkItemRow()]);
  const decisions = new MemoryAiDecisions();
  const auditLogs = new MemoryAuditLogs();
  const events: { topic: string; type: string; data: Record<string, unknown> }[] = [];
  const queue = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => now,
    id: () => "40000000-0000-4000-8000-000000000027",
    humanReserved: createHumanReservedGuard({
      workItems,
      decisions,
      auditLogs,
      settings: runtimeSettings,
      now: () => now,
      bus: {
        async publish(topic, type, data) {
          events.push({ topic, type, data: data as Record<string, unknown> });
        }
      }
    })
  });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createAgentRunRoutes({ auth: authDeps(runtimeSettings), queue, autoRun: false }));

  const blocked = await app.request(`/api/workitems/${workItemId}/agent-runs`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) },
    body: JSON.stringify({ title: "Manual-only worker run" })
  });

  assert.equal(blocked.status, 409);
  const blockedBody = await blocked.json() as {
    ok: false;
    error: { code: string; details?: { escalation_id?: string; trigger?: string; suggested_action?: string } };
  };
  assert.equal(blockedBody.error.code, "human_reserved");
  assert.equal(blockedBody.error.details?.escalation_id, escalationId);
  assert.equal(blockedBody.error.details?.trigger, "user_forbidden");
  assert.equal(blockedBody.error.details?.suggested_action, "pm_mode");
  assert.equal((await queue.listActive()).length, 0);
  assert.equal(decisions.confidenceRows.length, 0);
  assert.equal(decisions.escalationRows.length, 1);
  assert.equal(decisions.escalationRows[0]?.trigger, "user_forbidden");
  assert.equal(decisions.escalationRows[0]?.handoffJson["source"], "work_item");
  assert.equal(auditLogs.rows.some((row) => row.action === "escalation.opened"), true);
  // findings[#tenancy]：全局 escalation 发到按工作区隔离的话题 `all:<workspaceId>`（不再裸 'all'），
  // 与订阅侧对齐。单租户下解析到默认工作区。
  assert.deepEqual(events.map((event) => [event.topic, event.type]), [
    [`workitem:${workItemId}`, "escalation.opened"],
    [`all:${runtimeSettings.auth.defaultWorkspaceId}`, "escalation.opened"]
  ]);
  assert.equal(workItems.rows.get(workItemId)?.status, "pm_mode");
  assert.equal(workItems.rows.get(workItemId)?.mode, "pm");

  const pmRun = await app.request(`/api/workitems/${workItemId}/agent-runs`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) },
    body: JSON.stringify({ mode: "pm", title: "PM assist" })
  });
  assert.equal(pmRun.status, 202);
  assert.equal(decisions.escalationRows.length, 1);
});

test("#18: human-reserved guard does not re-mark pm_mode or re-version when an unresolved escalation already exists", async () => {
  const runtimeSettings = settings();
  const workItems = new MemoryWorkItems([humanReservedWorkItemRow()]);
  const decisions = new MemoryAiDecisions();
  const auditLogs = new MemoryAuditLogs();
  // 计数 markHumanReservedPmMode 的真实调用次数：每次状态写入 == 一次版本号空转。
  let markCalls = 0;
  const baseMark = workItems.markHumanReservedPmMode.bind(workItems);
  workItems.markHumanReservedPmMode = async (input) => {
    markCalls += 1;
    return baseMark(input);
  };
  const events: { topic: string; type: string }[] = [];
  const guard = createHumanReservedGuard({
    workItems,
    decisions,
    auditLogs,
    settings: runtimeSettings,
    now: () => now,
    bus: {
      async publish(topic, type) {
        events.push({ topic, type });
      }
    }
  });

  const first = await guard({ workItemId, actorId: userId, mode: "worker", settings: runtimeSettings });
  assert.ok(first, "first trigger reserves the work item");
  assert.equal(first?.reused, false, "first trigger is a fresh reservation");
  assert.equal(markCalls, 1, "first reservation marks pm_mode once");
  assert.equal(workItems.rows.get(workItemId)?.status, "pm_mode");
  assert.equal(decisions.escalationRows.length, 1);
  assert.equal(auditLogs.rows.filter((row) => row.action === "escalation.opened").length, 1);
  const eventsAfterFirst = events.length;

  // 第二次触发：未结 user_forbidden 升级仍在 → 必须复用且不再写状态/审计/事件。
  const second = await guard({ workItemId, actorId: userId, mode: "worker", settings: runtimeSettings });
  assert.ok(second, "second trigger still returns the reused escalation");
  assert.equal(second?.reused, true, "second trigger reuses the existing escalation");
  assert.equal(second?.escalationId, first?.escalationId, "same escalation id reused");
  // 关键修复：第二次不得再调用 markHumanReservedPmMode（无版本号空转/静默写）。
  assert.equal(markCalls, 1, "second trigger must NOT re-mark pm_mode");
  assert.equal(decisions.escalationRows.length, 1, "no duplicate escalation created");
  assert.equal(
    auditLogs.rows.filter((row) => row.action === "escalation.opened").length,
    1,
    "no second audit row (no silent write)"
  );
  assert.equal(events.length, eventsAfterFirst, "no second escalation event published");
});

test("agent run queue executes a queued AgentLoop run and records trace for replay", async () => {
  const runtimeSettings = settings();
  const workdir = await mkdtemp(path.join(os.tmpdir(), "workhub-agent-run-test-"));
  const snapshotRoot = await mkdtemp(path.join(os.tmpdir(), "workhub-agent-snapshot-test-"));
  const snapshots = new MemorySnapshots();
  const auditLogs = new MemoryAuditLogs();
  const decisions = new MemoryAiDecisions();
  const milestoneNotifications: {
    newStatus: string;
    code: string;
    approverUserId?: string;
    projectOwnerUserId?: string;
  }[] = [];
  const publishedEvents: {
    topic: string;
    type: string;
    data: WorkHubEvent<Record<string, unknown>>;
  }[] = [];
  const notifications: AgentRunNotificationPublisher = {
    async notifyMilestone(context) {
      milestoneNotifications.push({
        newStatus: context.newStatus,
        code: context.workItem.code,
        ...(context.workItem.approverUserId ? { approverUserId: context.workItem.approverUserId } : {}),
        ...(context.workItem.projectOwnerUserId ? { projectOwnerUserId: context.workItem.projectOwnerUserId } : {})
      });
      return [];
    }
  };
  const queue = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => now,
    id: () => "40000000-0000-4000-8000-000000000025",
    workdir: () => workdir,
    client: () => executableAgentClient(),
    snapshotRoot,
    snapshotId: () => snapshotId,
    snapshots,
    auditLogs,
    confidence: createAgentRunConfidenceRecorder({
      decisions,
      auditLogs,
      settings: runtimeSettings
    }),
    notifications,
    notificationWorkItem: async () => ({
      id: workItemId,
      code: "WH-21",
      title: "Executable worker run",
      projectId: "50000000-0000-4000-8000-000000000099",
      submitterUserId: userId,
      projectOwnerUserId: projectOwnerId
    }),
    eventBus: {
      async publish(topic, type, data) {
        publishedEvents.push({
          topic,
          type,
          data: data as WorkHubEvent<Record<string, unknown>>
        });
      }
    }
  });
  const app = withErrors(new Hono<AuthEnv>());
  const replayDeliverable = acceptedDeliverable();
  app.route("/api", createAgentRunRoutes({
    auth: authDeps(runtimeSettings),
    queue,
    snapshots,
    auditLogs,
    workItems: workItemsWithAcceptedDeliverables([replayDeliverable]),
    proposalAudit: proposalAuditWithMergeTimeline(),
    autoRun: false
  }));

  const start = await app.request(`/api/workitems/${workItemId}/agent-runs`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) },
    body: JSON.stringify({ title: "Executable worker run" })
  });
  assert.equal(start.status, 202);
  const startBody = await start.json() as { ok: true; data: { run_id: string; status: string } };
  assert.equal(startBody.data.status, "queued");

  const executed = await queue.runNext();
  assert.equal(executed?.status, "succeeded", JSON.stringify(executed?.trace.at(-1)));
  assert.equal(await queue.workdir(startBody.data.run_id), workdir);
  assert.equal(executed?.usage.token_in, 15);
  assert.equal(executed?.usage.token_out, 25);
  assert.equal(executed?.usage.estimated_cost_cny, "0.003");
  const runTopic = topics.run(startBody.data.run_id).topic;
  assert.equal(publishedEvents.length > 0, true);
  assert.equal(publishedEvents.every((event) => event.topic === runTopic), true);
  assert.equal(publishedEvents.some((event) => event.topic === "all"), false);
  assert.equal(publishedEvents.some((event) => event.type === eventTypes.agentRunStarted), true);
  assert.equal(publishedEvents.some((event) => event.type === eventTypes.stepToolResult), true);
  assert.equal(publishedEvents.some((event) => event.type === eventTypes.stepSnapshot), true);
  for (const event of publishedEvents) {
    assert.equal(event.data.topic, runTopic);
    assert.equal(event.data.run_id, startBody.data.run_id);
    assert.equal(event.data.work_item_id, workItemId);
    assert.equal(event.data.preview_text === undefined || event.data.preview_text.length <= 200, true);
  }
  const startedEvent = publishedEvents.find((event) => event.type === eventTypes.agentRunStarted);
  assert.equal(startedEvent?.data.cuu_state, "thinking");
  assert.equal(startedEvent?.data.data["run_id"], startBody.data.run_id);
  const finalEvent = publishedEvents.find((event) =>
    event.type === eventTypes.agentRunStep &&
    event.data.data["kind"] === "done"
  );
  assert.equal(finalEvent?.data.cuu_state, "celebrating");
  assert.equal(finalEvent?.data.data["status"], "succeeded");
  assert.equal(await readFile(path.join(workdir, "outputs", "result.md"), "utf8"), "done");
  assert.equal(snapshots.rows.length, 1);
  assert.equal(snapshots.rows[0]?.contentSha256?.length, 64);
  assert.equal(auditLogs.rows.some((row) => row.action === "tool.write_file.snapshot"), true);
  assert.equal(auditLogs.rows.some((row) => row.action === "confidence.scored"), true);
  await auditLogs.createAuditLog({
    id: "71000000-0000-4000-8000-000000000091",
    actorKind: "human",
    actorUserId: userId,
    entityType: "proposal",
    entityId: "75000000-0000-4000-8000-000000000001",
    action: "proposal.merged",
    snapshotId,
    detailJson: {
      merge_attempt_id: "75000000-0000-4000-8000-000000000002",
      text_hunk_decisions: [
        {
          hunkIndex: 0,
          startLine: 4,
          endLine: 6,
          decision: "accept_incoming"
        }
      ],
      text_hunk_count: 1,
      text_hunk_output_sha256: "d".repeat(64),
      bulk_action: {
        action: "accept_incoming",
        target_keys: ["delivery:/outputs/result.md"],
        conflict_count: 1
      }
    }
  });
  await auditLogs.createAuditLog({
    id: "71000000-0000-4000-8000-000000000092",
    actorKind: "human",
    actorUserId: userId,
    entityType: "proposal",
    entityId: "75000000-0000-4000-8000-000000000001",
    action: "proposal.bulk_action",
    snapshotId,
    detailJson: {
      merge_attempt_id: "75000000-0000-4000-8000-000000000002",
      bulk_action: {
        action: "accept_incoming",
        target_keys: ["delivery:/outputs/result.md"],
        conflict_count: 1
      },
      result: "merged",
      accepted_incoming_target_keys: ["delivery:/outputs/result.md"],
      resolved_conflict_target_keys: ["delivery:/outputs/result.md"],
      blocked_target_keys: [],
      target_keys: ["delivery:/outputs/result.md"]
    }
  });
  assert.equal(decisions.confidenceRows.length, 1);
  assert.equal(decisions.confidenceRows[0]?.agentRunId, startBody.data.run_id);
  assert.equal(decisions.confidenceRows[0]?.verdict, "human_spotcheck");
  assert.equal(decisions.confidenceRows[0]?.grade, "high");
  assert.equal(decisions.escalationRows.length, 0);
  // FIX#5：本测试聚焦 run 域的 trace/replay/事件，未接 proposalSink（避免 proposalOpened 事件污染
  // 「每条事件都在 run topic」的断言）→ 成功 run 无可审阅交付物 → 里程碑落 escalated（不是 in_review）。
  // 「成功 + 真开出提议 → in_review + 唯一通知」的完整路径由专门的 FIX#5 集成测试覆盖（下方）。
  // 旧断言期望 in_review，依赖的是「无 proposalSink 也谎报 proposalOpened=true」的 bug——已修。
  // escalated 无 approverUserId（仅 in_review 里程碑才补发起人为审批人）。
  assert.deepEqual(milestoneNotifications, [{
    newStatus: "escalated",
    code: "WH-21",
    projectOwnerUserId: projectOwnerId
  }]);

  const runResponse = await app.request(`/api/agent-runs/${startBody.data.run_id}`, {
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  const traceResponse = await app.request(`/api/agent-runs/${startBody.data.run_id}/trace`, {
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  const replayResponse = await app.request(`/api/agent-runs/${startBody.data.run_id}/replay`, {
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(runResponse.status, 200);
  assert.equal(traceResponse.status, 200);
  assert.equal(replayResponse.status, 200);
  const runBody = await runResponse.json() as { ok: true; data: { status: string } };
  const traceBody = await traceResponse.json() as {
    ok: true;
    data: { phase: string; snapshot_id?: string; output_excerpt?: string }[];
  };
  const replayBody = await replayResponse.json() as {
    ok: true;
    data: {
      cost: { me: { estimated_cost_cny: string } };
      snapshots: { id: string }[];
      audit_logs: { action: string; snapshot_id?: string }[];
      accepted_deliverables: { id: string; download_href?: string; preview_href?: string }[];
      merge_timeline: {
        result: string;
        text_hunk_decisions?: { hunk_index: number; start_line: number; end_line: number; decision: string }[];
        bulk_action?: {
          action: string;
          result?: string;
          accepted_incoming_target_keys: string[];
          resolved_conflict_target_keys: string[];
          blocked_target_keys: string[];
        };
        decisions: {
          chosen_option_key?: string;
          candidates: { option_key: string; chosen: boolean; recommended: boolean }[];
        }[];
      }[];
      manifest_facts: { rollback: { available: boolean; snapshot_id?: string } };
    };
  };
  assert.equal(runBody.data.status, "succeeded");
  assert.deepEqual(traceBody.data.map((step) => step.phase), ["tool_call", "tool_result", "think", "final"]);
  assert.equal(traceBody.data[0]?.snapshot_id, snapshotId);
  assert.equal(traceBody.data.some((step) => step.output_excerpt?.includes("交付完成")), true);
  assert.equal(replayBody.data.cost.me.estimated_cost_cny, "0.003");
  assert.deepEqual(replayBody.data.snapshots.map((snapshot) => snapshot.id), [snapshotId]);
  assert.equal(replayBody.data.audit_logs.some((log) => log.action === "tool.write_file.snapshot"), true);
  assert.equal(replayBody.data.audit_logs.some((log) => log.action === "confidence.scored"), true);
  assert.equal(replayBody.data.accepted_deliverables[0]?.id, replayDeliverable.id);
  assert.equal(replayBody.data.accepted_deliverables[0]?.download_href, replayDeliverable.download_href);
  assert.equal(replayBody.data.accepted_deliverables[0]?.preview_href, replayDeliverable.preview_href);
  assert.equal(replayBody.data.merge_timeline[0]?.result, "merged");
  assert.equal(replayBody.data.merge_timeline[0]?.text_hunk_decisions?.[0]?.decision, "accept_incoming");
  assert.equal(replayBody.data.merge_timeline[0]?.text_hunk_decisions?.[0]?.start_line, 4);
  assert.equal(replayBody.data.merge_timeline[0]?.bulk_action?.action, "accept_incoming");
  assert.equal(replayBody.data.merge_timeline[0]?.bulk_action?.result, "merged");
  assert.deepEqual(replayBody.data.merge_timeline[0]?.bulk_action?.accepted_incoming_target_keys, [
    "delivery:/outputs/result.md"
  ]);
  assert.equal(replayBody.data.merge_timeline[0]?.decisions[0]?.chosen_option_key, "accept_incoming");
  assert.equal(
    replayBody.data.merge_timeline[0]?.decisions[0]?.candidates.some((candidate) =>
      candidate.chosen && candidate.option_key === "accept_incoming"
    ),
    true
  );
  assert.equal(
    replayBody.data.merge_timeline[0]?.decisions[0]?.candidates.some((candidate) =>
      candidate.recommended && candidate.option_key === "keep_current"
    ),
    true
  );
  assert.equal(replayBody.data.manifest_facts.rollback.available, true);
  assert.equal(replayBody.data.manifest_facts.rollback.snapshot_id, snapshotId);
  assert.equal(await queue.runNext(), null);
});

test("agent run queue writes through to persistence and restores DB-backed run state", async () => {
  const runtimeSettings = settings();
  const persistence = new MemoryAgentRunPersistence();
  const workdir = await mkdtemp(path.join(os.tmpdir(), "workhub-agent-run-persist-test-"));
  const snapshotRoot = await mkdtemp(path.join(os.tmpdir(), "workhub-agent-run-persist-snapshot-test-"));
  const snapshots = new MemorySnapshots();
  const auditLogs = new MemoryAuditLogs();
  const queue = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => now,
    id: () => "40000000-0000-4000-8000-000000000026",
    workdir: () => workdir,
    client: () => executableAgentClient(),
    snapshotRoot,
    snapshots,
    auditLogs,
    persistence,
    confidence: false,
    proposals: false,
    notifications: false,
    eventBus: false
  });

  const run = await queue.enqueue({
    workItemId,
    actorId: userId,
    title: "Persistent worker run"
  });
  assert.equal(persistence.rows.get(run.run_id)?.status, "queued");

  const coldQueueBeforeRun = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => now,
    persistence,
    confidence: false,
    proposals: false,
    notifications: false,
    eventBus: false
  });
  assert.equal((await coldQueueBeforeRun.get(run.run_id))?.status, "queued");
  assert.deepEqual((await coldQueueBeforeRun.listActive()).map((item) => item.run_id), [run.run_id]);

  const executed = await queue.runNext();
  assert.equal(executed?.status, "succeeded", JSON.stringify(executed?.trace.at(-1)));
  assert.equal(await persistence.getWorkdir(run.run_id), workdir);
  assert.equal(persistence.rows.get(run.run_id)?.status, "succeeded");
  assert.deepEqual(persistence.rows.get(run.run_id)?.trace.map((step) => step.phase), [
    "tool_call",
    "tool_result",
    "think",
    "final"
  ]);
  assert.equal(persistence.traceWrites.at(-1)?.at(-1)?.phase, "final");

  const coldQueueAfterRun = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => now,
    persistence,
    confidence: false,
    proposals: false,
    notifications: false,
    eventBus: false
  });
  assert.equal((await coldQueueAfterRun.get(run.run_id))?.status, "succeeded");
  assert.equal(await coldQueueAfterRun.workdir(run.run_id), workdir);
  assert.deepEqual((await coldQueueAfterRun.trace(run.run_id)).map((step) => step.phase), [
    "tool_call",
    "tool_result",
    "think",
    "final"
  ]);
  assert.deepEqual(await coldQueueAfterRun.listActive(), []);
});

test("agent run queue claims the next persisted run before execution", async () => {
  const runtimeSettings = settings();
  const persistence = new MemoryAgentRunPersistence();
  const workdir = await mkdtemp(path.join(os.tmpdir(), "workhub-agent-run-claim-next-test-"));
  const snapshotRoot = await mkdtemp(path.join(os.tmpdir(), "workhub-agent-run-claim-next-snapshot-test-"));
  const snapshots = new MemorySnapshots();
  const auditLogs = new MemoryAuditLogs();
  const queue = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => now,
    id: () => "40000000-0000-4000-8000-000000000027",
    workerId: "worker-a",
    leaseMs: 60_000,
    workdir: () => workdir,
    client: () => executableAgentClient(),
    snapshotRoot,
    snapshots,
    auditLogs,
    persistence,
    confidence: false,
    proposals: false,
    notifications: false,
    eventBus: false
  });

  const run = await queue.enqueue({
    workItemId,
    actorId: userId,
    title: "Claimed worker run"
  });

  const executed = await queue.runNext();

  assert.equal(executed?.status, "succeeded", JSON.stringify(executed?.trace.at(-1)));
  assert.deepEqual(persistence.claims, [{ runId: run.run_id, workerId: "worker-a" }]);
  assert.equal(persistence.rows.get(run.run_id)?.claim?.claimed_by, "worker-a");
  assert.equal(persistence.rows.get(run.run_id)?.claim?.lease_expires_at, "2026-06-05T00:01:00.000Z");
});

test("agent run queue claims by id before direct run execution", async () => {
  const runtimeSettings = settings();
  const persistence = new MemoryAgentRunPersistence();
  const workdir = await mkdtemp(path.join(os.tmpdir(), "workhub-agent-run-claim-id-test-"));
  const snapshotRoot = await mkdtemp(path.join(os.tmpdir(), "workhub-agent-run-claim-id-snapshot-test-"));
  const snapshots = new MemorySnapshots();
  const auditLogs = new MemoryAuditLogs();
  const queue = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => now,
    id: () => "40000000-0000-4000-8000-000000000028",
    workerId: "worker-b",
    leaseMs: 120_000,
    workdir: () => workdir,
    client: () => executableAgentClient(),
    snapshotRoot,
    snapshots,
    auditLogs,
    persistence,
    confidence: false,
    proposals: false,
    notifications: false,
    eventBus: false
  });

  const run = await queue.enqueue({
    workItemId,
    actorId: userId,
    title: "Direct claimed worker run"
  });

  const executed = await queue.run(run.run_id);

  assert.equal(executed.status, "succeeded", JSON.stringify(executed.trace.at(-1)));
  assert.deepEqual(persistence.claims, [{ runId: run.run_id, workerId: "worker-b" }]);
  assert.equal(persistence.rows.get(run.run_id)?.claim?.claimed_by, "worker-b");
  assert.equal(persistence.rows.get(run.run_id)?.claim?.lease_expires_at, "2026-06-05T00:02:00.000Z");
});

test("agent run queue requeues expired persistent claims and audits the recovery", async () => {
  const runtimeSettings = settings();
  const persistence = new MemoryAgentRunPersistence();
  const auditLogs = new MemoryAuditLogs();
  const recoveredAt = new Date("2026-06-05T00:10:00.000Z");
  const queue = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => recoveredAt,
    id: () => "40000000-0000-4000-8000-000000000040",
    workerId: "worker-recovery",
    leaseMs: 60_000,
    persistence,
    auditLogs,
    confidence: false,
    proposals: false,
    notifications: false,
    eventBus: false
  });
  const queued = await queue.enqueue({
    workItemId,
    actorId: userId,
    title: "Stale run"
  });
  const claimed = await persistence.claimQueued(queued.run_id, {
    workerId: "dead-worker",
    claimedAt: new Date("2026-06-05T00:00:00.000Z"),
    heartbeatAt: new Date("2026-06-05T00:00:30.000Z"),
    leaseExpiresAt: new Date("2026-06-05T00:01:00.000Z")
  });

  assert.equal(claimed?.status, "running");
  const recovered = await queue.recoverExpiredClaims();
  const live = await queue.get(queued.run_id);

  assert.equal(recovered.length, 1);
  assert.equal(recovered[0]?.status, "queued");
  assert.equal(recovered[0]?.claim, undefined);
  assert.equal(live?.status, "queued");
  assert.equal(live?.claim, undefined);
  assert.equal(auditLogs.rows.length, 1);
  assert.equal(auditLogs.rows[0]?.action, "agent_run.requeued_stale_claim");
  assert.equal(auditLogs.rows[0]?.entityType, "agent_run");
  assert.equal(auditLogs.rows[0]?.entityId, queued.run_id);
});

test("R2 audit#6: recoverExpiredClaims preserves a richer in-memory trace instead of clobbering it with the trace-less requeued record", async () => {
  const runtimeSettings = settings();
  const workdir = await mkdtemp(path.join(os.tmpdir(), "workhub-audit6-work-"));
  const snapshotRoot = await mkdtemp(path.join(os.tmpdir(), "workhub-audit6-snap-"));
  const snapshots = new MemorySnapshots();
  const persistence = new MemoryAgentRunPersistence();
  const queue = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => now,
    id: () => "40000000-0000-4000-8000-000000000061",
    workdir: () => workdir,
    client: () => executableAgentClient(),
    snapshotRoot,
    snapshotId: () => "40000000-0000-4000-8000-000000000062",
    snapshots,
    persistence,
    auditLogs: new MemoryAuditLogs(),
    confidence: false,
    proposals: false,
    notifications: false,
    eventBus: false
  });

  const queued = await queue.enqueue({ workItemId, actorId: userId, title: "Trace-preservation run" });
  const executed = await queue.runNext();
  // 不依赖 run 成功——本用例只需内存里存在已累积的执行轨迹(成功/失败 run 都会累积 trace 步骤)。
  assert.ok(executed, "run must execute");
  const richTraceLength = (await queue.get(queued.run_id))?.trace.length ?? 0;
  assert.ok(richTraceLength > 0, "executed run must have accumulated an in-memory trace");

  // 模拟「本进程内存里有富 trace 的 run、其租约在 persistence 侧已过期、且 persistence 重排/读取不暴露步骤」
  //（与生产 requeueExpiredClaims/get 的 trace-less 行为一致）。只重写 persistence 行,不动内存 runs[id] 的富 trace。
  const persisted = await persistence.get(queued.run_id);
  assert.ok(persisted);
  persistence.rows.set(queued.run_id, {
    ...persisted,
    status: "running",
    trace: [],
    claim: {
      claimed_by: "dead-worker",
      claimed_at: "2020-01-01T00:00:00.000Z",
      heartbeat_at: "2020-01-01T00:00:30.000Z",
      lease_expires_at: "2020-01-01T00:01:00.000Z"
    },
    updated_at: "2020-01-01T00:01:00.000Z"
  });

  const recovered = await queue.recoverExpiredClaims();
  assert.equal(recovered.length, 1, "the expired running claim must be requeued");
  assert.equal(recovered[0]?.trace.length, 0, "requeued record is trace-less (matches production persistence)");

  // 修复后内存富 trace 被保留,不被空 trace 覆盖。无修复时此处为 0——与仍在跑的 executeRun(按 runs.get(id).trace
  // 逐步追加)交错会把轨迹截断,再经 replaceTrace 把 DB 也写短(真丢数据)。
  const afterRecover = await queue.get(queued.run_id);
  assert.equal(afterRecover?.trace.length, richTraceLength, "recoverExpiredClaims must preserve the richer in-memory trace");
});

test("R2 audit#35: concurrent runNext drains claim a queued run exactly once (no in-memory double-execute)", async () => {
  const runtimeSettings = settings();
  const workdir = await mkdtemp(path.join(os.tmpdir(), "workhub-audit35-work-"));
  const snapshotRoot = await mkdtemp(path.join(os.tmpdir(), "workhub-audit35-snap-"));
  const snapshots = new MemorySnapshots();
  let clientFactoryCalls = 0;
  const queue = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => now,
    id: () => "40000000-0000-4000-8000-000000000071",
    workdir: () => workdir,
    client: () => {
      clientFactoryCalls += 1;
      return executableAgentClient();
    },
    snapshotRoot,
    snapshotId: () => "40000000-0000-4000-8000-000000000072",
    snapshots,
    auditLogs: new MemoryAuditLogs(),
    confidence: false,
    proposals: false,
    notifications: false,
    eventBus: false
  });

  await queue.enqueue({ workItemId, actorId: userId, title: "Concurrent-drain run" });
  // 两个并发 drain/runNext 同时来抢这唯一一个 queued run（模拟 routes 里 void drainAutoRunQueue 的并发触发）。
  const results = await Promise.all([queue.runNext(), queue.runNext()]);

  // 恰好一个 runNext 领到并执行了该 run,另一个领空返回 null。无同步认领时两者都会执行 → 双执行(len 2 / 工厂 2)。
  assert.equal(results.filter(Boolean).length, 1, "exactly one concurrent runNext may claim+execute the queued run");
  assert.equal(clientFactoryCalls, 1, "the run must be executed exactly once (no double-execute)");
});

test("agent run queue dead-letters a run that keeps crashing past the recover-attempt cap", async () => {
  // poison run（每次都崩）不该被无限重排：超过 maxRecoverAttempts 即转死信 failed，且打专门的审计动作。
  const runtimeSettings = settings();
  const persistence = new MemoryAgentRunPersistence();
  const auditLogs = new MemoryAuditLogs();
  const recoveredAt = new Date("2026-06-05T00:10:00.000Z");
  const queue = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => recoveredAt,
    id: () => "40000000-0000-4000-8000-00000000004a",
    workerId: "worker-deadletter",
    leaseMs: 60_000,
    maxRecoverAttempts: 1,
    persistence,
    auditLogs,
    confidence: false,
    proposals: false,
    notifications: false,
    eventBus: false
  });
  const queued = await queue.enqueue({ workItemId, actorId: userId, title: "Poison run" });
  const expiredLease = {
    claimedAt: new Date("2026-06-05T00:00:00.000Z"),
    heartbeatAt: new Date("2026-06-05T00:00:30.000Z"),
    leaseExpiresAt: new Date("2026-06-05T00:01:00.000Z")
  };

  // 第一次过期：仍在上限内 → 重排 queued。
  await persistence.claimQueued(queued.run_id, { workerId: "dead-worker-1", ...expiredLease });
  const firstRecover = await queue.recoverExpiredClaims();
  assert.equal(firstRecover[0]?.status, "queued");

  // 第二次过期（attempts 已达上限）：转死信 failed，不再重排。
  await persistence.claimQueued(queued.run_id, { workerId: "dead-worker-2", ...expiredLease });
  const secondRecover = await queue.recoverExpiredClaims();
  assert.equal(secondRecover[0]?.status, "failed");

  const live = await queue.get(queued.run_id);
  assert.equal(live?.status, "failed");
  // 死信后不应再出现在活跃列表里被领走重跑。
  const active = await queue.listActive();
  assert.equal(active.some((run) => run.run_id === queued.run_id), false);
  // 审计：第二次走专门的 dead-letter 动作。
  const deadLetterAudit = auditLogs.rows.find((row) => row.action === "agent_run.dead_lettered_stale_claim");
  assert.equal(deadLetterAudit?.entityId, queued.run_id);
});

test("sweepStaleAgentWorkdirs removes only stale workhub-agent dirs", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "workhub-sweep-test-"));
  const stale = path.join(parent, "workhub-agent-stale");
  const fresh = path.join(parent, "workhub-agent-fresh");
  const unrelated = path.join(parent, "some-other-tmp");
  await mkdir(stale, { recursive: true });
  await mkdir(fresh, { recursive: true });
  await mkdir(unrelated, { recursive: true });
  await writeFile(path.join(stale, "outputs.bin"), "x", "utf8");
  // 把 stale 目录的 mtime 退回到很久以前；fresh / unrelated 保持当前时间。
  const longAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
  await utimes(stale, longAgo, longAgo);

  const result = await sweepStaleAgentWorkdirs({ tmpDir: parent, ttlMs: 6 * 60 * 60 * 1000 });

  assert.equal(result.removed, 1);
  await assert.rejects(stat(stale), "stale workhub-agent dir should be removed");
  assert.equal((await stat(fresh)).isDirectory(), true);
  // 非 workhub-agent 前缀的目录即使陈旧也不动。
  assert.equal((await stat(unrelated)).isDirectory(), true);
});

test("agent run recovery scheduler ticks once, recovers stale claims, and drains recovered work", async () => {
  const recoveredRun: AgentRunQueueRecord = {
    run_id: "40000000-0000-4000-8000-000000000041",
    work_item_id: workItemId,
    actor_id: userId,
    mode: "worker",
    status: "queued",
    title: "Recovered run",
    budget: {
      max_steps: 15,
      total_timeout_s: 300,
      max_tokens: 120000,
      max_cost_cny: "5"
    },
    budget_decision: {
      decision_id: "budget-1",
      allowed: true,
      model_route: {
        provider: "test",
        model: "test",
        reason: "default"
      }
    },
    usage: {
      steps_used: 0,
      token_in: 0,
      token_out: 0,
      estimated_cost_cny: "0"
    },
    trace: [],
    created_at: now.toISOString(),
    updated_at: now.toISOString()
  };
  let drained = false;
  const scheduler = createAgentRunRecoveryScheduler({
    intervalMs: 0,
    now: () => now,
    queue: {
      async recoverExpiredClaims() {
        return [recoveredRun];
      },
      async runNext() {
        if (drained) {
          return null;
        }
        drained = true;
        return recoveredRun;
      }
    }
  });

  const result = await scheduler.tick();

  assert.equal(result.recovered, 1);
  assert.equal(result.requeued, 1);
  assert.equal(result.dead_lettered, 0);
  assert.equal(result.drained, 1);
  assert.deepEqual(scheduler.stats(), {
    running: false,
    tick_count: 1,
    recovered_count: 1,
    requeued_count: 1,
    dead_lettered_count: 0,
    drained_count: 1,
    error_count: 0,
    last_tick_at: now.toISOString()
  });
});

test("#25: recovery drain budget counts only requeued runs, not dead-lettered ones", async () => {
  const requeuedRun: AgentRunQueueRecord = {
    run_id: "40000000-0000-4000-8000-000000000042",
    work_item_id: workItemId,
    actor_id: userId,
    mode: "worker",
    status: "queued",
    title: "Requeued run",
    budget: {
      max_steps: 15,
      total_timeout_s: 300,
      max_tokens: 120000,
      max_cost_cny: "5"
    },
    budget_decision: {
      decision_id: "budget-1",
      allowed: true,
      model_route: {
        provider: "test",
        model: "test",
        reason: "default"
      }
    },
    usage: {
      steps_used: 0,
      token_in: 0,
      token_out: 0,
      estimated_cost_cny: "0"
    },
    trace: [],
    created_at: now.toISOString(),
    updated_at: now.toISOString()
  };
  // 死信记录：超过重试上限后落入 status='failed'，runNext 永远不会放行它。
  const deadLetteredRun: AgentRunQueueRecord = {
    ...requeuedRun,
    run_id: "40000000-0000-4000-8000-000000000043",
    status: "failed",
    title: "Dead-lettered run"
  };
  let runNextCalls = 0;
  let drained = false;
  const scheduler = createAgentRunRecoveryScheduler({
    intervalMs: 0,
    now: () => now,
    queue: {
      async recoverExpiredClaims() {
        // 并集：1 条重新入队 + 1 条死信。
        return [requeuedRun, deadLetteredRun];
      },
      async runNext() {
        runNextCalls += 1;
        if (drained) {
          return null;
        }
        drained = true;
        return requeuedRun;
      }
    }
  });

  const result = await scheduler.tick();

  assert.equal(result.recovered, 2, "both records counted as recovered");
  assert.equal(result.requeued, 1, "only the queued record is requeued");
  assert.equal(result.dead_lettered, 1, "the failed record is dead-lettered");
  assert.equal(result.drained, 1, "only the requeued run drains");
  // 关键：drain 预算按 requeued(=1) 而非 recovered(=2) 计，runNext 不会为死信白跑。
  assert.equal(runNextCalls, 1, "runNext is not called for the dead-lettered run");
  assert.deepEqual(scheduler.stats(), {
    running: false,
    tick_count: 1,
    recovered_count: 2,
    requeued_count: 1,
    dead_lettered_count: 1,
    drained_count: 1,
    error_count: 0,
    last_tick_at: now.toISOString()
  });
});

test("agent run queue keeps the lease alive during a long provider call", async () => {
  const runtimeSettings = settings();
  const persistence = new MemoryAgentRunPersistence();
  const heartbeatSeen = deferred<void>();
  const releaseProvider = deferred<void>();
  const workdir = await mkdtemp(path.join(os.tmpdir(), "workhub-agent-run-long-provider-test-"));
  let tick = 0;
  const longProviderClient: AgentLoopClient = {
    model: "deepseek-v4-flash",
    messages: {
      async create() {
        await releaseProvider.promise;
        return {
          id: "msg-long-provider",
          stopReason: "end_turn",
          usage: { inputTokens: 1, outputTokens: 1 },
          usageRecord: {
            provider: "deepseek",
            model: "deepseek-v4-flash",
            task: "worker",
            inputTokens: 1,
            outputTokens: 1,
            estimatedCostCny: "0.001",
            source: "agent_step",
            createdAt: "2026-06-05T00:00:00.000Z"
          },
          content: [{ type: "text", text: "done" }]
        };
      }
    }
  };
  const originalHeartbeatClaim = persistence.heartbeatClaim.bind(persistence);
  persistence.heartbeatClaim = async (input) => {
    const row = await originalHeartbeatClaim(input);
    if (persistence.heartbeats.length >= 1) {
      heartbeatSeen.resolve();
    }
    return row;
  };
  const queue = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => new Date(now.getTime() + tick++ * 100),
    id: () => "40000000-0000-4000-8000-000000000029",
    workerId: "worker-long-provider",
    leaseMs: 300,
    heartbeatIntervalMs: 10,
    workdir: () => workdir,
    client: () => longProviderClient,
    persistence,
    confidence: false,
    proposals: false,
    notifications: false,
    eventBus: false,
    requireDeliverable: false
  });
  const run = await queue.enqueue({
    workItemId,
    actorId: userId,
    title: "Long provider heartbeat run"
  });

  const running = queue.runNext();
  await heartbeatSeen.promise;
  const duringProvider = await persistence.get(run.run_id);
  releaseProvider.resolve();
  const executed = await running;

  assert.equal(executed?.status, "succeeded");
  assert.equal(persistence.claims.length, 1);
  assert.equal(persistence.heartbeats.length >= 1, true);
  assert.equal(duringProvider?.claim?.claimed_by, "worker-long-provider");
  assert.notEqual(duringProvider?.claim?.heartbeat_at, duringProvider?.claim?.claimed_at);
});

test("agent run aborts its in-flight loop when its lease is lost mid-run", async () => {
  // 模拟：worker 正跑着，租约被回收/转交（心跳命中 0 行 → heartbeatClaim 返回 null）。
  // 期望：worker 本地标记漂移、停手，最终 run 不落「成功」（不会污染接手方的结果）。
  const runtimeSettings = settings();
  const persistence = new MemoryAgentRunPersistence();
  const leaseLostSeen = deferred<void>();
  const releaseProvider = deferred<void>();
  const workdir = await mkdtemp(path.join(os.tmpdir(), "workhub-agent-run-lease-lost-test-"));
  let tick = 0;
  const longProviderClient: AgentLoopClient = {
    model: "deepseek-v4-flash",
    messages: {
      async create() {
        await releaseProvider.promise;
        return {
          id: "msg-lease-lost",
          stopReason: "end_turn",
          usage: { inputTokens: 1, outputTokens: 1 },
          usageRecord: {
            provider: "deepseek",
            model: "deepseek-v4-flash",
            task: "worker",
            inputTokens: 1,
            outputTokens: 1,
            estimatedCostCny: "0.001",
            source: "agent_step",
            createdAt: "2026-06-05T00:00:00.000Z"
          },
          content: [{ type: "text", text: "done" }]
        };
      }
    }
  };
  // 第一次心跳即返回 null，模拟租约已被别的 worker 接手。
  persistence.heartbeatClaim = async () => {
    leaseLostSeen.resolve();
    return null;
  };
  const queue = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => new Date(now.getTime() + tick++ * 100),
    id: () => "40000000-0000-4000-8000-00000000002a",
    workerId: "worker-lease-lost",
    leaseMs: 300,
    heartbeatIntervalMs: 10,
    workdir: () => workdir,
    client: () => longProviderClient,
    persistence,
    confidence: false,
    proposals: false,
    notifications: false,
    eventBus: false,
    requireDeliverable: false
  });
  const run = await queue.enqueue({
    workItemId,
    actorId: userId,
    title: "Lease-lost abort run"
  });

  const running = queue.runNext();
  await leaseLostSeen.promise;
  releaseProvider.resolve();
  const executed = await running;

  // 本地漂移标记：失去租约后 run 不再以「成功」收尾。
  assert.notEqual(executed?.status, "succeeded");
  // 持久层里这条 run 也没被本 worker 打成 succeeded（接手的新 owner 才决定它的终态）。
  const persisted = await persistence.get(run.run_id);
  assert.notEqual(persisted?.status, "succeeded");
});

test("SIR-1: agent run self-aborts when heartbeat keeps THROWING past the lease horizon", async () => {
  // 模拟：心跳写持续抛错(transient DB error,不是命中 0 行返回 null)。此前 refreshClaimInBackground 的 .catch
  // 会静默吞掉,run 内存 status 永远 running、driftedRun 永不停手——服务端租约静默过期后会被重排重领,同进程双跑。
  // 期望：越过租约视界后本地翻 failed,loop 自停,run 不以「成功」收尾(不污染重领方结果)。
  const runtimeSettings = settings();
  const persistence = new MemoryAgentRunPersistence();
  const heartbeatThrew = deferred<void>();
  const releaseProvider = deferred<void>();
  const workdir = await mkdtemp(path.join(os.tmpdir(), "workhub-agent-run-heartbeat-throw-test-"));
  let tick = 0;
  const longProviderClient: AgentLoopClient = {
    model: "deepseek-v4-flash",
    messages: {
      async create() {
        await releaseProvider.promise;
        return {
          id: "msg-heartbeat-throw",
          stopReason: "end_turn",
          usage: { inputTokens: 1, outputTokens: 1 },
          usageRecord: {
            provider: "deepseek",
            model: "deepseek-v4-flash",
            task: "worker",
            inputTokens: 1,
            outputTokens: 1,
            estimatedCostCny: "0.001",
            source: "agent_step",
            createdAt: "2026-06-05T00:00:00.000Z"
          },
          content: [{ type: "text", text: "done" }]
        };
      }
    }
  };
  // 心跳每次都抛错(永远续不上)。tick 每次 now() +100ms,leaseMs=300 → 数次后逻辑时钟越过租约视界。
  let heartbeatAttempts = 0;
  persistence.heartbeatClaim = async () => {
    heartbeatAttempts += 1;
    heartbeatThrew.resolve(); // 重复 resolve 无害,只取首次。
    throw new Error("transient DB error during heartbeat");
  };
  const queue = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => new Date(now.getTime() + tick++ * 100),
    id: () => "40000000-0000-4000-8000-00000000002b",
    workerId: "worker-heartbeat-throw",
    leaseMs: 300,
    heartbeatIntervalMs: 10,
    workdir: () => workdir,
    client: () => longProviderClient,
    persistence,
    confidence: false,
    proposals: false,
    notifications: false,
    eventBus: false,
    requireDeliverable: false
  });
  const run = await queue.enqueue({
    workItemId,
    actorId: userId,
    title: "Heartbeat-throw abort run"
  });

  const running = queue.runNext();
  await heartbeatThrew.promise;
  // 给心跳几次机会把逻辑时钟推过视界并翻 failed。
  await new Promise((resolve) => setTimeout(resolve, 60));
  releaseProvider.resolve();
  const executed = await running;

  assert.ok(heartbeatAttempts >= 1, "heartbeat was attempted (and threw)");
  // 心跳持续抛错越过租约视界 → 本地自停,不以成功收尾。
  assert.notEqual(executed?.status, "succeeded");
  const persisted = await persistence.get(run.run_id);
  assert.notEqual(persisted?.status, "succeeded");
});

test("agent run route auto-pumps queued work after enqueue", async () => {
  const runtimeSettings = settings();
  const workdir = await mkdtemp(path.join(os.tmpdir(), "workhub-agent-run-autopump-test-"));
  const snapshotRoot = await mkdtemp(path.join(os.tmpdir(), "workhub-agent-autopump-snapshot-test-"));
  const snapshots = new MemorySnapshots();
  const auditLogs = new MemoryAuditLogs();
  const queue = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => now,
    id: () => "40000000-0000-4000-8000-000000000028",
    workdir: () => workdir,
    client: () => executableAgentClient(),
    snapshotRoot,
    snapshotId: () => snapshotId,
    snapshots,
    auditLogs,
    confidence: false,
    notifications: false,
    eventBus: false
  });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createAgentRunRoutes({ auth: authDeps(runtimeSettings), queue, snapshots, auditLogs }));

  const start = await app.request(`/api/workitems/${workItemId}/agent-runs`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) },
    body: JSON.stringify({ title: "Auto-pumped worker run" })
  });
  assert.equal(start.status, 202);
  const startBody = await start.json() as { ok: true; data: { run_id: string; status: string } };
  assert.equal(startBody.data.status, "queued");

  const executed = await waitForRunStatus(queue, startBody.data.run_id, "succeeded");
  assert.equal(executed.status, "succeeded");
  assert.equal(await readFile(path.join(workdir, "outputs", "result.md"), "utf8"), "done");
  assert.equal(await queue.runNext(), null);
});

test("successful agent run opens a proposal from its generated manifest", async () => {
  const runtimeSettings = settings();
  const workdir = await mkdtemp(path.join(os.tmpdir(), "workhub-agent-run-proposal-test-"));
  const snapshotRoot = await mkdtemp(path.join(os.tmpdir(), "workhub-agent-proposal-snapshot-test-"));
  const snapshots = new MemorySnapshots();
  const auditLogs = new MemoryAuditLogs();
  const proposalIds = [
    "60000000-0000-4000-8000-000000000025",
    "61000000-0000-4000-8000-000000000025"
  ];
  const proposals = createInMemoryProposalService({
    now: () => now,
    id: () => {
      const id = proposalIds.shift();
      if (!id) {
        throw new Error("No fake proposal id queued");
      }
      return id;
    }
  });
  const publishedEvents: {
    topic: string;
    type: string;
    data: WorkHubEvent<Record<string, unknown>>;
  }[] = [];
  const queue = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => now,
    id: () => "40000000-0000-4000-8000-000000000027",
    workdir: () => workdir,
    client: () => executableAgentClient(),
    snapshotRoot,
    snapshotId: () => snapshotId,
    snapshots,
    auditLogs,
    proposals,
    confidence: false,
    notifications: false,
    eventBus: {
      async publish(topic, type, data) {
        publishedEvents.push({
          topic,
          type,
          data: data as WorkHubEvent<Record<string, unknown>>
        });
      }
    }
  });

  const queued = await queue.enqueue({
    workItemId,
    actorId: userId,
    title: "Executable worker run"
  });
  const executed = await queue.runNext();
  const opened = await proposals.listByWorkItem(workItemId);

  assert.equal(executed?.run_id, queued.run_id);
  assert.equal(executed?.status, "succeeded");
  assert.equal(opened.length, 1);
  assert.equal(opened[0]?.id, "60000000-0000-4000-8000-000000000025");
  assert.equal(opened[0]?.branch_id, "61000000-0000-4000-8000-000000000025");
  assert.equal(opened[0]?.diff_manifest.work_item_id, workItemId);
  assert.equal(opened[0]?.diff_manifest.changes[0]?.target_ref.path, "/outputs/result.md");
  assert.equal(opened[0]?.opened_by_kind, "ai");

  const proposalEvent = publishedEvents.find((event) => event.type === eventTypes.proposalOpened);
  assert.equal(proposalEvent?.topic, topics.workitem(workItemId).topic);
  assert.equal(proposalEvent?.data.run_id, queued.run_id);
  assert.equal(proposalEvent?.data.proposal_id, opened[0]?.id);
  assert.equal(proposalEvent?.data.cuu_state, "carrying_document");
  assert.equal(proposalEvent?.data.data["branch_id"], opened[0]?.branch_id);
  // chain1/rank2：proposal.opened 还必须发到派活用户的 per-user /me 流——桌面富 Cuu 决策卡只订 topics.user，
  // 否则旗舰「AI 把决策端到你面前」降级成一条干巴巴的通知。
  const userProposalEvent = publishedEvents.find(
    (event) => event.type === eventTypes.proposalOpened && event.topic === topics.user(queued.actor_id).topic
  );
  assert.ok(userProposalEvent, "proposal.opened must also reach the dispatcher's /me stream (chain1)");
  assert.equal(userProposalEvent?.data.proposal_id, opened[0]?.id);
  assert.equal(userProposalEvent?.data.cuu_state, "carrying_document");
});

test("P-COLLAB M2: a hydrated run captures a base snapshot and stamps manifest.base.snapshot_id", async () => {
  const runtimeSettings = settings();
  const workdir = await mkdtemp(path.join(os.tmpdir(), "workhub-agent-base-snapshot-test-"));
  const snapshotRoot = await mkdtemp(path.join(os.tmpdir(), "workhub-agent-base-snapshot-root-"));
  const snapshots = new MemorySnapshots();
  const auditLogs = new MemoryAuditLogs();
  const proposalIds = [
    "62000000-0000-4000-8000-000000000025",
    "63000000-0000-4000-8000-000000000025"
  ];
  const proposals = createInMemoryProposalService({
    now: () => now,
    id: () => {
      const id = proposalIds.shift();
      if (!id) {
        throw new Error("No fake proposal id queued");
      }
      return id;
    }
  });
  const queue = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => now,
    id: () => "40000000-0000-4000-8000-000000000028",
    workdir: () => workdir,
    client: () => executableAgentClient(),
    snapshotRoot,
    snapshotId: () => snapshotId,
    snapshots,
    auditLogs,
    proposals,
    confidence: false,
    notifications: false,
    // 物化出 project/ 只读祖先文件,触发 run 开始时的 base 快照。
    hydrateProject: async (_run, wd) => {
      const projectDir = path.join(wd, "project");
      await mkdir(projectDir, { recursive: true });
      await writeFile(path.join(projectDir, "spec.md"), "existing project content\n", "utf8");
      return { files: 1, bytes: 25, skipped: 0 };
    },
    eventBus: { async publish() {} }
  });

  await queue.enqueue({ workItemId, actorId: userId, title: "Base snapshot run" });
  const executed = await queue.runNext();
  assert.equal(executed?.status, "succeeded");

  // 拍了一份 kind:"base" 快照,且其 ref 目录里含 project/ 树(spec.md),不是 outputs/。
  const baseRows = snapshots.rows.filter((row) => row.kind === "base");
  assert.equal(baseRows.length, 1, "exactly one base snapshot should be captured");
  const baseRef = baseRows[0]?.ref;
  assert.ok(baseRef, "base snapshot has a ref dir");
  assert.equal(await readFile(path.join(baseRef!, "spec.md"), "utf8"), "existing project content\n");

  // base.snapshot_id 写进了 manifest → createProposal 会落到 branches.baseSnapshotId。
  const opened = await proposals.listByWorkItem(workItemId);
  assert.equal(opened.length, 1);
  assert.equal(opened[0]?.diff_manifest.base.snapshot_id, baseRows[0]?.id);
});

test("agent run confidence recording opens an escalation for failed deliverables", async () => {
  const runtimeSettings = settings();
  const workdir = await mkdtemp(path.join(os.tmpdir(), "workhub-agent-run-failed-test-"));
  const auditLogs = new MemoryAuditLogs();
  const decisions = new MemoryAiDecisions();
  const queue = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => now,
    id: () => "40000000-0000-4000-8000-000000000026",
    workdir: () => workdir,
    client: () => noDeliverableAgentClient(),
    notifications: false,
    confidence: createAgentRunConfidenceRecorder({
      decisions,
      auditLogs,
      settings: runtimeSettings
    })
  });

  const queued = await queue.enqueue({
    workItemId,
    actorId: userId,
    title: "Failed worker run"
  });
  const executed = await queue.runNext();

  assert.equal(executed?.run_id, queued.run_id);
  assert.equal(executed?.status, "failed");
  assert.equal(decisions.confidenceRows.length, 1);
  assert.equal(decisions.confidenceRows[0]?.verdict, "escalate");
  assert.equal(decisions.confidenceRows[0]?.grade, "low");
  assert.equal(decisions.escalationRows.length, 1);
  assert.equal(decisions.escalationRows[0]?.trigger, "unqualified");
  assert.equal(decisions.escalationRows[0]?.confidenceId, decisions.confidenceRows[0]?.id);
  assert.equal(auditLogs.rows.some((row) => row.action === "confidence.scored"), true);
  assert.equal(auditLogs.rows.some((row) => row.action === "escalation.opened"), true);
});

// 忠实复刻仓库层 CAS 的工作项状态写入器：持一份 id→status 内存表，仅当当前态是 `to` 的合法前驱时才写并回
// transitioned:true；否则回填当前真实状态 + transitioned:false（让 FIX#4 的「已在目标态 vs 非法前驱」判别生效）。
function faithfulWorkItemStatusWriter(initial: Record<string, WorkItemStatus>) {
  const statuses = new Map<string, WorkItemStatus>(Object.entries(initial));
  const calls: { to: WorkItemStatus; transitioned: boolean; from: WorkItemStatus | undefined }[] = [];
  const writer = async (input: { workItemId: string; to: WorkItemStatus; at: Date }) => {
    const from = statuses.get(input.workItemId);
    if (from === undefined) {
      calls.push({ to: input.to, transitioned: false, from });
      return null;
    }
    const predecessors = (Object.entries(allowedWorkItemTransitions) as [WorkItemStatus, readonly WorkItemStatus[]][])
      .filter(([, targets]) => targets.includes(input.to))
      .map(([predecessor]) => predecessor);
    if (predecessors.includes(from)) {
      statuses.set(input.workItemId, input.to);
      calls.push({ to: input.to, transitioned: true, from });
      return { id: input.workItemId, status: input.to, transitioned: true };
    }
    calls.push({ to: input.to, transitioned: false, from });
    return { id: input.workItemId, status: from, transitioned: false };
  };
  return { writer, statuses, calls };
}

test("FIX#5: a succeeded+manifest run with an escalate verdict ends in_review with an open proposal (not escalated) and notifies once", async () => {
  const runtimeSettings = settings();
  const workdir = await mkdtemp(path.join(os.tmpdir(), "workhub-fix5-test-"));
  const snapshotRoot = await mkdtemp(path.join(os.tmpdir(), "workhub-fix5-snapshot-test-"));
  const snapshots = new MemorySnapshots();
  const auditLogs = new MemoryAuditLogs();
  const decisions = new MemoryAiDecisions();
  const proposals = createInMemoryProposalService({
    now: () => now,
    id: () => "75000000-0000-4000-8000-000000000501"
  });
  const milestoneNotifications: { newStatus: string }[] = [];
  const notifications: AgentRunNotificationPublisher = {
    async notifyMilestone(context) {
      milestoneNotifications.push({ newStatus: context.newStatus });
      return [];
    }
  };
  // 工作项已被 kickoff 推到 ai_working（route 路径在入队时做；此处直接 seed）。
  const status = faithfulWorkItemStatusWriter({ [workItemId]: "ai_working" });
  const queue = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => now,
    id: () => "40000000-0000-4000-8000-000000000051",
    workdir: () => workdir,
    // 工人写出交付物 + 低分评审 → run 成功且有 manifest，但置信度判 escalate。
    client: () => escalateReviewAgentClient(),
    snapshotRoot,
    snapshotId: () => snapshotId,
    snapshots,
    auditLogs,
    proposals,
    confidence: createAgentRunConfidenceRecorder({
      decisions,
      auditLogs,
      settings: runtimeSettings,
      // FIX#5：把置信记录器的 escalated 写入指到忠实 CAS writer——验证它在 proposalWillOpen 时绝不推 escalated。
      transitionWorkItemStatus: async (input) => {
        await status.writer(input);
      }
    }),
    notifications,
    notificationWorkItem: async () => ({
      id: workItemId,
      code: "WH-21",
      title: "Escalate-verdict worker run",
      projectId: "50000000-0000-4000-8000-000000000099",
      submitterUserId: userId,
      projectOwnerUserId: projectOwnerId
    }),
    eventBus: false,
    transitionWorkItemStatus: status.writer
  });

  const queued = await queue.enqueue({ workItemId, actorId: userId, title: "Escalate-verdict worker run" });
  const executed = await queue.runNext();

  assert.equal(executed?.run_id, queued.run_id);
  assert.equal(executed?.status, "succeeded", JSON.stringify(executed?.trace.at(-1)));
  // 置信度真判 escalate（低分评审驱动），且升级/注意力事件照常落库——attention 队列仍能浮出这条低置信提议。
  assert.equal(decisions.confidenceRows.length, 1);
  assert.equal(decisions.confidenceRows[0]?.verdict, "escalate");
  assert.equal(decisions.escalationRows.length, 1, "escalation/attention event is still recorded");
  assert.equal(auditLogs.rows.some((row) => row.action === "escalation.opened"), true);
  // (a) 恰好一个最终状态：in_review（绝不是 escalated）——有可审阅提议，工作项必须停在 in_review。
  assert.equal(status.statuses.get(workItemId), "in_review");
  // 置信记录器在 proposalWillOpen 时绝不写 escalated（否则会抢在 notifyRunMilestone 前把状态拐进 escalated）。
  assert.equal(status.calls.some((call) => call.to === "escalated"), false, "must never attempt escalated transition");
  // (c) escalated 工作项上绝不挂 open 提议：本工作项在 in_review，且确有一条 open 提议。
  const opened = await proposals.listByWorkItem(workItemId);
  assert.equal(opened.length, 1);
  assert.equal(opened[0]?.status, "opened");
  // (b) 恰好一条里程碑通知，且为 in_review。
  assert.deepEqual(milestoneNotifications, [{ newStatus: "in_review" }]);
});

test("FIX#4: a failed run already AT escalated still emits the milestone notification (idempotent no-op counts as success)", async () => {
  const runtimeSettings = settings();
  const workdir = await mkdtemp(path.join(os.tmpdir(), "workhub-fix4-test-"));
  const auditLogs = new MemoryAuditLogs();
  const milestoneNotifications: { newStatus: string }[] = [];
  const notifications: AgentRunNotificationPublisher = {
    async notifyMilestone(context) {
      milestoneNotifications.push({ newStatus: context.newStatus });
      return [];
    }
  };
  // 工作项已被别处推到 escalated（例如置信记录器先一步落定）。failed run 的里程碑目标也是 escalated：
  // ai_working→escalated 的 CAS 此刻是「已在目标态」的幂等 no-op（escalated 非 escalated 的合法前驱）。
  // 旧逻辑把这次 no-op 当真 no-op → 抑制通知（漏报）。FIX#4：already-at-target 视为成功 → 仍发通知。
  const status = faithfulWorkItemStatusWriter({ [workItemId]: "escalated" });
  const queue = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => now,
    id: () => "40000000-0000-4000-8000-000000000041",
    workdir: () => workdir,
    client: () => noDeliverableAgentClient(),
    auditLogs,
    confidence: false,
    proposals: false,
    notifications,
    notificationWorkItem: async () => ({
      id: workItemId,
      code: "WH-21",
      title: "Failed worker run",
      projectId: "50000000-0000-4000-8000-000000000099",
      submitterUserId: userId,
      projectOwnerUserId: projectOwnerId
    }),
    eventBus: false,
    transitionWorkItemStatus: status.writer
  });

  const queued = await queue.enqueue({ workItemId, actorId: userId, title: "Failed worker run" });
  const executed = await queue.runNext();

  assert.equal(executed?.run_id, queued.run_id);
  assert.equal(executed?.status, "failed");
  // CAS 这次是幂等 no-op（已在 escalated）：transitioned:false 但 status===escalated。
  const escalatedCall = status.calls.find((call) => call.to === "escalated");
  assert.equal(escalatedCall?.transitioned, false, "transition is a no-op (already at escalated)");
  // 关键：尽管状态没真正迁移，still-at-target 算成功 → 里程碑通知照常发，不被漏报。
  assert.deepEqual(milestoneNotifications, [{ newStatus: "escalated" }]);
});

test("FIX#4: a failed run whose item is at an illegal predecessor (spec_ready) suppresses the milestone notification", async () => {
  const runtimeSettings = settings();
  const workdir = await mkdtemp(path.join(os.tmpdir(), "workhub-fix4b-test-"));
  const auditLogs = new MemoryAuditLogs();
  const milestoneNotifications: { newStatus: string }[] = [];
  const notifications: AgentRunNotificationPublisher = {
    async notifyMilestone(context) {
      milestoneNotifications.push({ newStatus: context.newStatus });
      return [];
    }
  };
  // 工作项卡在 spec_ready（非 escalated 的合法前驱，也非 escalated 本身）→ 真 no-op → 抑制谎报通知。
  const status = faithfulWorkItemStatusWriter({ [workItemId]: "spec_ready" });
  const queue = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => now,
    id: () => "40000000-0000-4000-8000-000000000042",
    workdir: () => workdir,
    client: () => noDeliverableAgentClient(),
    auditLogs,
    confidence: false,
    proposals: false,
    notifications,
    notificationWorkItem: async () => ({
      id: workItemId,
      code: "WH-21",
      title: "Failed worker run",
      projectId: "50000000-0000-4000-8000-000000000099",
      submitterUserId: userId,
      projectOwnerUserId: projectOwnerId
    }),
    eventBus: false,
    transitionWorkItemStatus: status.writer
  });

  await queue.enqueue({ workItemId, actorId: userId, title: "Failed worker run" });
  const executed = await queue.runNext();

  assert.equal(executed?.status, "failed");
  const escalatedCall = status.calls.find((call) => call.to === "escalated");
  assert.equal(escalatedCall?.transitioned, false, "illegal predecessor → genuine no-op");
  // 真 no-op（既没迁移、也不在目标态）→ 抑制里程碑通知，避免谎报「已转人工」。
  assert.deepEqual(milestoneNotifications, []);
});

test("FIX#7: POST /workitems/:id/agent-runs on a spec_ready item kicks it to ai_working and reaches in_review (not stuck)", async () => {
  const runtimeSettings = settings();
  const workdir = await mkdtemp(path.join(os.tmpdir(), "workhub-fix7-test-"));
  const snapshotRoot = await mkdtemp(path.join(os.tmpdir(), "workhub-fix7-snapshot-test-"));
  const snapshots = new MemorySnapshots();
  const auditLogs = new MemoryAuditLogs();
  const proposals = createInMemoryProposalService({
    now: () => now,
    id: () => "75000000-0000-4000-8000-000000000701"
  });
  const milestoneNotifications: { newStatus: string }[] = [];
  const notifications: AgentRunNotificationPublisher = {
    async notifyMilestone(context) {
      milestoneNotifications.push({ newStatus: context.newStatus });
      return [];
    }
  };
  // 工作项一开始处于 spec_ready（此前的 bug：入队不动状态 → 成功后 ai_working→in_review CAS 落空 → 卡死）。
  const status = faithfulWorkItemStatusWriter({ [workItemId]: "spec_ready" });
  const queue = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => now,
    id: () => "40000000-0000-4000-8000-000000000071",
    workdir: () => workdir,
    client: () => executableAgentClient(),
    snapshotRoot,
    snapshotId: () => snapshotId,
    snapshots,
    auditLogs,
    proposals,
    confidence: false,
    notifications,
    notificationWorkItem: async () => ({
      id: workItemId,
      code: "WH-21",
      title: "Kickoff worker run",
      projectId: "50000000-0000-4000-8000-000000000099",
      submitterUserId: userId,
      projectOwnerUserId: projectOwnerId
    }),
    eventBus: false,
    transitionWorkItemStatus: status.writer
  });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createAgentRunRoutes({
    auth: authDeps(runtimeSettings),
    queue,
    snapshots,
    auditLogs,
    autoRun: false,
    // FIX#7：route 入队时把工作项 spec_ready→ai_working（镜像 session-finalize kickoff）。
    kickoffWorkItemStatus: status.writer
  }));

  const start = await app.request(`/api/workitems/${workItemId}/agent-runs`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) },
    body: JSON.stringify({ title: "Kickoff worker run" })
  });
  assert.equal(start.status, 202);
  const startBody = await start.json() as { ok: true; data: { run_id: string } };

  // 入队即把工作项 kickoff 到 ai_working（route FIX#7）。
  assert.equal(status.statuses.get(workItemId), "ai_working");

  const executed = await queue.runNext();
  assert.equal(executed?.run_id, startBody.data.run_id);
  assert.equal(executed?.status, "succeeded");
  // 成功 + 开出提议 → ai_working→in_review 的 CAS 现在能落（不再卡 spec_ready）。
  assert.equal(status.statuses.get(workItemId), "in_review");
  const opened = await proposals.listByWorkItem(workItemId);
  assert.equal(opened.length, 1);
  assert.deepEqual(milestoneNotifications, [{ newStatus: "in_review" }]);
});

test("FIX#10: a dead-lettered run moves its work item ai_working→escalated and notifies", async () => {
  const runtimeSettings = settings();
  const persistence = new MemoryAgentRunPersistence();
  const auditLogs = new MemoryAuditLogs();
  const milestoneNotifications: { newStatus: string }[] = [];
  const notifications: AgentRunNotificationPublisher = {
    async notifyMilestone(context) {
      milestoneNotifications.push({ newStatus: context.newStatus });
      return [];
    }
  };
  const recoveredAt = new Date("2026-06-05T00:10:00.000Z");
  // run 在执行中崩溃，工作项停在 ai_working（执行 worker 已死，无人替它落终态）。
  const status = faithfulWorkItemStatusWriter({ [workItemId]: "ai_working" });
  const queue = createInMemoryAgentRunQueue({
    settings: runtimeSettings,
    now: () => recoveredAt,
    id: () => "40000000-0000-4000-8000-00000000004b",
    workerId: "worker-deadletter-10",
    leaseMs: 60_000,
    maxRecoverAttempts: 1,
    persistence,
    auditLogs,
    confidence: false,
    proposals: false,
    notifications,
    notificationWorkItem: async () => ({
      id: workItemId,
      code: "WH-21",
      title: "Poison run",
      projectId: "50000000-0000-4000-8000-000000000099",
      submitterUserId: userId,
      projectOwnerUserId: projectOwnerId
    }),
    eventBus: false,
    transitionWorkItemStatus: status.writer
  });
  const queued = await queue.enqueue({ workItemId, actorId: userId, title: "Poison run" });
  const expiredLease = {
    claimedAt: new Date("2026-06-05T00:00:00.000Z"),
    heartbeatAt: new Date("2026-06-05T00:00:30.000Z"),
    leaseExpiresAt: new Date("2026-06-05T00:01:00.000Z")
  };

  // 第一次过期：仍在上限内 → 重排 queued（不应动工作项状态，也不发通知）。
  await persistence.claimQueued(queued.run_id, { workerId: "dead-worker-1", ...expiredLease });
  const firstRecover = await queue.recoverExpiredClaims();
  assert.equal(firstRecover[0]?.status, "queued");
  assert.equal(status.statuses.get(workItemId), "ai_working", "requeue must not touch the work item");
  assert.deepEqual(milestoneNotifications, [], "requeue must not notify");

  // 第二次过期（已达上限）：转死信 failed → 工作项 ai_working→escalated + 一条「转人工」里程碑通知。
  await persistence.claimQueued(queued.run_id, { workerId: "dead-worker-2", ...expiredLease });
  const secondRecover = await queue.recoverExpiredClaims();
  assert.equal(secondRecover[0]?.status, "failed");
  assert.equal(status.statuses.get(workItemId), "escalated", "dead-letter advances the stuck item to escalated");
  assert.deepEqual(milestoneNotifications, [{ newStatus: "escalated" }]);
  // 死信审计动作仍照常打。
  assert.equal(
    auditLogs.rows.some((row) => row.action === "agent_run.dead_lettered_stale_claim"),
    true
  );
});
