import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { AgentLoopClient } from "@workhub/agent/loop";
import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { loadSettings, type Settings } from "@workhub/config";
import { buildUsageRecord, createMemoryCostLedgerStore } from "@workhub/cost";
import type {
  AuditLogRepository,
  AuditLogRow,
  AiDecisionRepository,
  ClientDeviceAuthRow,
  ClientDeviceRepository,
  ConfidenceRecordRow,
  EscalationEventRow,
  SnapshotRepository,
  SnapshotRow,
  UserAuthRow,
  UserRepository
} from "@workhub/db";

import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "./middleware/auth.js";
import { createAgentRunRoutes } from "./routes/agent-runs.js";
import { createAgentRunConfidenceRecorder } from "./services/agent-run-confidence.js";
import {
  AgentRunnerError,
  createInMemoryAgentRunQueue,
  type AgentRunNotificationPublisher
} from "./workers/agent-runner.js";

const now = new Date("2026-06-05T00:00:00.000Z");
const userId = "10000000-0000-4000-8000-000000000021";
const workItemId = "50000000-0000-4000-8000-000000000021";
const snapshotId = "70000000-0000-4000-8000-000000000025";
const confidenceId = "72000000-0000-4000-8000-000000000025";
const escalationId = "73000000-0000-4000-8000-000000000025";

function user(): UserAuthRow {
  return {
    id: userId,
    nickname: "agent-run-user",
    cookieToken: "cookie-agent-run",
    availabilityStatus: "free",
    availabilityText: null,
    availabilityUpdatedAt: null,
    isAdmin: false,
    deletedAt: null,
    createdAt: now,
    updatedAt: now
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

function authDeps(runtimeSettings: Settings): AuthDependencies {
  return {
    users: new MemoryUsers([user()]),
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

async function cookie(runtimeSettings: Settings) {
  return generateSignedCookie(COOKIE_NAME, "cookie-agent-run", runtimeSettings.auth.cookieSecret);
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
  app.route("/api", createAgentRunRoutes({ auth: authDeps(runtimeSettings), queue }));

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
  app.route("/api", createAgentRunRoutes({ auth: authDeps(runtimeSettings), queue }));

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
  app.route("/api", createAgentRunRoutes({ auth: authDeps(runtimeSettings), queue }));

  const response = await app.request(`/api/workitems/${workItemId}/agent-runs`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) },
    body: JSON.stringify({ title: "Weekly report" })
  });

  assert.equal(response.status, 202);
  const body = await response.json() as { ok: true; data: { budget: { max_tokens: number } } };
  assert.equal(body.data.budget.max_tokens, 25000);
});

test("agent run queue executes a queued AgentLoop run and records trace for replay", async () => {
  const runtimeSettings = settings();
  const workdir = await mkdtemp(path.join(os.tmpdir(), "workhub-agent-run-test-"));
  const snapshotRoot = await mkdtemp(path.join(os.tmpdir(), "workhub-agent-snapshot-test-"));
  const snapshots = new MemorySnapshots();
  const auditLogs = new MemoryAuditLogs();
  const decisions = new MemoryAiDecisions();
  const milestoneNotifications: { newStatus: string; approverUserId?: string }[] = [];
  const notifications: AgentRunNotificationPublisher = {
    async notifyMilestone(context) {
      milestoneNotifications.push({
        newStatus: context.newStatus,
        ...(context.workItem.approverUserId ? { approverUserId: context.workItem.approverUserId } : {})
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
    notifications
  });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createAgentRunRoutes({ auth: authDeps(runtimeSettings), queue, snapshots, auditLogs }));

  const start = await app.request(`/api/workitems/${workItemId}/agent-runs`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) },
    body: JSON.stringify({ title: "Executable worker run" })
  });
  assert.equal(start.status, 202);
  const startBody = await start.json() as { ok: true; data: { run_id: string; status: string } };
  assert.equal(startBody.data.status, "queued");

  const executed = await queue.runNext();
  assert.equal(executed?.status, "succeeded");
  assert.equal(await queue.workdir(startBody.data.run_id), workdir);
  assert.equal(executed?.usage.token_in, 15);
  assert.equal(executed?.usage.token_out, 25);
  assert.equal(executed?.usage.estimated_cost_cny, "0.003");
  assert.equal(await readFile(path.join(workdir, "outputs", "result.md"), "utf8"), "done");
  assert.equal(snapshots.rows.length, 1);
  assert.equal(snapshots.rows[0]?.contentSha256?.length, 64);
  assert.equal(auditLogs.rows.some((row) => row.action === "tool.write_file.snapshot"), true);
  assert.equal(auditLogs.rows.some((row) => row.action === "confidence.scored"), true);
  assert.equal(decisions.confidenceRows.length, 1);
  assert.equal(decisions.confidenceRows[0]?.agentRunId, startBody.data.run_id);
  assert.equal(decisions.confidenceRows[0]?.verdict, "human_spotcheck");
  assert.equal(decisions.confidenceRows[0]?.grade, "high");
  assert.equal(decisions.escalationRows.length, 0);
  assert.deepEqual(milestoneNotifications, [{ newStatus: "in_review", approverUserId: userId }]);

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
  assert.equal(replayBody.data.manifest_facts.rollback.available, true);
  assert.equal(replayBody.data.manifest_facts.rollback.snapshot_id, snapshotId);
  assert.equal(await queue.runNext(), null);
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
