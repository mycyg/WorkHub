import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import {
  createDatabaseClient,
  createProposalRepository,
  type AuditLogRepository,
  type MergeAttemptRow,
  type MergeProposalRow,
  type SnapshotRepository,
  type WorkHubDatabaseClient
} from "@workhub/db";
import { startAgentRunRequestSchema } from "@workhub/contracts";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthActor,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  getDefaultAgentRunQueue,
  type AgentRunQueue,
  type AgentRunQueueRecord
} from "../workers/agent-runner.js";
import {
  buildReplayTracePage,
  toAgentRunLiveVm,
  toAgentStepVm,
  toAuditLogFact,
  toReplayMergeAttemptVm,
  toSnapshotVm
} from "../pages/replay.js";
import { getDefaultAuditStores } from "../services/audit-stores.js";
import {
  getDefaultWorkItemService,
  WorkItemServiceError,
  type WorkItemService
} from "../services/work-items.js";

function auditLogRunId(detailJson: unknown) {
  if (!detailJson || typeof detailJson !== "object") {
    return undefined;
  }
  const value = (detailJson as Record<string, unknown>).run_id;
  return typeof value === "string" ? value : undefined;
}

function auditLogMergeAttemptId(detailJson: unknown) {
  if (!detailJson || typeof detailJson !== "object") {
    return undefined;
  }
  const value = (detailJson as Record<string, unknown>).merge_attempt_id;
  return typeof value === "string" ? value : undefined;
}

function assertCanReadRun(run: AgentRunQueueRecord, actor: AuthActor) {
  if (run.actor_id === actor.id || actor.isAdmin) {
    return;
  }
  throw new HTTPException(403, { message: "你没有权限查看这次 AI 执行。" });
}

export type ProposalReplayAuditReader = {
  listByWorkItem: (workItemId: string) => Promise<Array<{ proposal: { id: string } }>>;
  listMergeAttemptsByProposal: (proposalId: string) => Promise<MergeAttemptRow[]>;
  listMergeProposalsByAttempt: (mergeAttemptId: string) => Promise<MergeProposalRow[]>;
};

let defaultProposalReplayAuditDbClient: WorkHubDatabaseClient | undefined;

function getDefaultProposalReplayAudit(): ProposalReplayAuditReader {
  defaultProposalReplayAuditDbClient ??= createDatabaseClient();
  return createProposalRepository(defaultProposalReplayAuditDbClient.db);
}

async function buildMergeTimelineForWorkItem(
  proposalAudit: ProposalReplayAuditReader | undefined,
  auditLogs: AuditLogRepository | undefined,
  workItemId: string
) {
  if (!proposalAudit) {
    return [];
  }
  const proposals = await proposalAudit.listByWorkItem(workItemId);
  const timeline: ReturnType<typeof toReplayMergeAttemptVm>[] = [];
  for (const proposal of proposals) {
    const proposalAuditRows = auditLogs
      ? await auditLogs.listAuditLogsForEntity("proposal", proposal.proposal.id)
      : [];
    const attempts = await proposalAudit.listMergeAttemptsByProposal(proposal.proposal.id);
    for (const attempt of attempts) {
      const mergeProposals = await proposalAudit.listMergeProposalsByAttempt(attempt.id);
      const attemptAuditRows = proposalAuditRows.filter((row) => auditLogMergeAttemptId(row.detailJson) === attempt.id);
      timeline.push(toReplayMergeAttemptVm({ attempt, mergeProposals, auditLogs: attemptAuditRows }));
    }
  }
  return timeline.sort((left, right) => left.created_at.localeCompare(right.created_at));
}

export type AgentRunRoutesDependencies = {
  auth?: AuthDependencySource;
  queue?: AgentRunQueue;
  auditLogs?: AuditLogRepository;
  snapshots?: SnapshotRepository;
  workItems?: WorkItemService;
  proposalAudit?: ProposalReplayAuditReader;
  autoRun?: boolean;
  onAutoRunError?: (error: unknown, run: AgentRunQueueRecord) => void;
};

async function drainAutoRunQueue(queue: AgentRunQueue) {
  for (;;) {
    const run = await queue.runNext();
    if (!run) {
      return;
    }
  }
}

export function createAgentRunRoutes(deps: AgentRunRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const queue = deps.queue ?? getDefaultAgentRunQueue();
  const replayWorkItems = deps.workItems ?? (deps.queue ? undefined : getDefaultWorkItemService());
  const replayProposalAudit = deps.proposalAudit ?? (deps.queue ? undefined : getDefaultProposalReplayAudit());

  function auditStores() {
    if (deps.auditLogs && deps.snapshots) {
      return { auditLogs: deps.auditLogs, snapshots: deps.snapshots };
    }
    return getDefaultAuditStores();
  }

  routes.post("/workitems/:id/agent-runs", createCurrentUserMiddleware(authSource), async (c) => {
    const payload = startAgentRunRequestSchema.parse(await c.req.json().catch(() => ({})));
    const run = await queue.enqueue({
      workItemId: c.req.param("id"),
      actorId: c.var.actor.id,
      ...(payload.title ? { title: payload.title } : {}),
      ...(payload.mode ? { mode: payload.mode } : {})
    });
    if (deps.autoRun !== false) {
      void drainAutoRunQueue(queue).catch((error) => {
        if (deps.onAutoRunError) {
          deps.onAutoRunError(error, run);
          return;
        }
        console.warn("WorkHub AgentRun auto pump failed", error);
      });
    }
    return c.json({ ok: true, data: toAgentRunLiveVm(run) }, 202);
  });

  routes.get("/agent-runs/:id", createCurrentUserMiddleware(authSource), async (c) => {
    const data = await queue.get(c.req.param("id"));
    if (!data) {
      throw new HTTPException(404, { message: "没有找到这次 AI 执行。" });
    }
    assertCanReadRun(data, c.var.actor);
    return c.json({ ok: true, data: toAgentRunLiveVm(data) });
  });

  routes.get("/agent-runs/:id/trace", createCurrentUserMiddleware(authSource), async (c) => {
    const afterRaw = c.req.query("after");
    const after = afterRaw ? Number.parseInt(afterRaw, 10) : 0;
    const run = await queue.get(c.req.param("id"));
    if (!run) {
      throw new HTTPException(404, { message: "没有找到这次 AI 执行。" });
    }
    assertCanReadRun(run, c.var.actor);
    const data = await queue.trace(run.run_id, Number.isFinite(after) ? after : 0);
    return c.json({ ok: true, data: data.map((step) => toAgentStepVm(run.run_id, step)) });
  });

  routes.post("/agent-runs/:id/abort", createCurrentUserMiddleware(authSource), async (c) => {
    const data = await queue.abort(c.req.param("id"), {
      id: c.var.actor.id,
      isAdmin: c.var.actor.isAdmin
    });
    return c.json({ ok: true, data: toAgentRunLiveVm(data) });
  });

  routes.get("/agent-runs/:id/handoff", createCurrentUserMiddleware(authSource), async (c) => {
    const run = await queue.get(c.req.param("id"));
    if (!run) {
      throw new HTTPException(404, { message: "没有找到这次 AI 执行。" });
    }
    assertCanReadRun(run, c.var.actor);
    return c.json({ ok: true, data: run.handoff ?? null });
  });

  routes.get("/agent-runs/:id/replay", createCurrentUserMiddleware(authSource), async (c) => {
    const run = await queue.get(c.req.param("id"));
    if (!run) {
      throw new HTTPException(404, { message: "没有找到这次 AI 执行。" });
    }
    assertCanReadRun(run, c.var.actor);
    const stores = auditStores();
    const snapshotRows = await stores.snapshots.listSnapshotsForWorkItem(run.work_item_id, { includeReverted: true });
    const auditRows = await stores.auditLogs.listAuditLogsForWorkItem(run.work_item_id);
    const runAuditRows = auditRows.filter((row) => auditLogRunId(row.detailJson) === run.run_id);
    const runSnapshotIds = new Set(runAuditRows.map((row) => row.snapshotId).filter((id): id is string => Boolean(id)));
    const runSnapshotRows = snapshotRows.filter((row) => runSnapshotIds.has(row.id));
    const snapshots = runSnapshotRows.map(toSnapshotVm);
    const auditLogs = runAuditRows.map(toAuditLogFact);
    try {
      const acceptedDeliverables = replayWorkItems
        ? (await replayWorkItems.detailPage({ workItemId: run.work_item_id, actor: c.var.actor })).accepted_deliverables
        : [];
      const mergeTimeline = await buildMergeTimelineForWorkItem(replayProposalAudit, stores.auditLogs, run.work_item_id);
      return c.json({
        ok: true,
        data: buildReplayTracePage({ run, snapshots, auditLogs, acceptedDeliverables, mergeTimeline })
      });
    } catch (error) {
      if (error instanceof WorkItemServiceError) {
        throw new HTTPException(error.status as 400, { message: error.message });
      }
      throw error;
    }
  });

  return routes;
}
