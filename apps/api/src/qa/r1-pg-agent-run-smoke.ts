import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AgentLoopClient } from "@workhub/agent/loop";
import { loadSettings } from "@workhub/config";
import {
  auditLogs,
  agentRuns,
  branches,
  costLedgerEntries,
  createAgentRunRepository,
  createAuditLogRepository,
  createClientDeviceRepository,
  createDatabaseClient,
  createDbCostLedgerStore,
  createProposalRepository,
  createWorkItemRepository,
  createSnapshotRepository,
  createUserRepository,
  defaultSeedFixture,
  defaultSeedIds,
  orgs,
  proposals,
  projects,
  runMigrations,
  snapshots,
  usageRecords,
  users,
  workItems,
  workspaces
} from "@workhub/db";
import { buildUsageRecord } from "@workhub/cost";
import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "../middleware/auth.js";
import { createAgentRunRoutes } from "../routes/agent-runs.js";
import { createCostRoutes } from "../routes/cost.js";
import { createKnowledgeRoutes } from "../routes/knowledge.js";
import { createPageRoutes } from "../routes/pages.js";
import { createSessionRoutes } from "../routes/sessions.js";
import { createWorkItemRoutes } from "../routes/workitems.js";
import { createDbAgentRunPersistence } from "../services/agent-run-persistence.js";
import { createDbProposalService } from "../services/proposals.js";
import { createDbWorkItemService } from "../services/work-items.js";
import { createInMemoryAgentRunQueue } from "../workers/agent-runner.js";

function executableAgentClient(): AgentLoopClient {
  const responses = [
    {
      id: "msg-r1-pg-1",
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
        createdAt: new Date().toISOString()
      },
      content: [
        {
          type: "tool_use",
          id: "tool-r1-pg-1",
          name: "write_file",
          input: {
            path: "outputs/result.md",
            content: "R1 PG smoke deliverable"
          }
        }
      ]
    },
    {
      id: "msg-r1-pg-2",
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
        createdAt: new Date().toISOString()
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

function withErrors<T extends { Variables: Record<string, unknown> }>(app: Hono<T>) {
  app.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json({ ok: false, error: { code: "validation_error", message: "invalid payload" } }, 422);
    }
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: "http_error", message: error.message } }, error.status);
    }
    throw error;
  });
  return app;
}

async function ensureDefaultSeed(db: ReturnType<typeof createDatabaseClient>["db"]) {
  await db.insert(orgs).values(defaultSeedFixture.orgs).onConflictDoNothing();
  await db.insert(workspaces).values(defaultSeedFixture.workspaces).onConflictDoNothing();
  await db.insert(users).values(defaultSeedFixture.users).onConflictDoNothing();
  await db.insert(projects).values(defaultSeedFixture.projects).onConflictDoNothing();
}

async function main() {
  const settings = loadSettings(process.env);
  if (settings.appEnv === "production") {
    throw new Error("Refusing to run R1 PG smoke in production.");
  }

  await runMigrations(settings);
  const client = createDatabaseClient(settings);
  try {
    const db = client.db;
    await ensureDefaultSeed(db);
    const auth: AuthDependencies = {
      users: createUserRepository(db),
      devices: createClientDeviceRepository(db),
      settings
    };
    const snapshotsRepo = createSnapshotRepository(db);
    const auditRepo = createAuditLogRepository(db);
    const agentRunRepo = createAgentRunRepository(db);
    const persistence = createDbAgentRunPersistence(agentRunRepo);
    const proposalService = createDbProposalService(createProposalRepository(db));
    const workItemService = createDbWorkItemService(createWorkItemRepository(db));
    const ledgerStore = createDbCostLedgerStore(db, {
      teamId: settings.auth.defaultWorkspaceId,
      evalSuite: "nightly"
    });
    const workdir = await mkdtemp(path.join(os.tmpdir(), "workhub-r1-pg-agent-"));
    const snapshotRoot = await mkdtemp(path.join(os.tmpdir(), "workhub-r1-pg-snapshot-"));
    const queue = createInMemoryAgentRunQueue({
      settings,
      workdir: () => workdir,
      client: () => executableAgentClient(),
      snapshotRoot,
      snapshots: snapshotsRepo,
      auditLogs: auditRepo,
      persistence,
      proposals: proposalService,
      confidence: false,
      humanReserved: false,
      notifications: false,
      eventBus: false
    });
    const app = withErrors(new Hono<AuthEnv>());
    app.route("/api", createSessionRoutes({ auth, workItems: workItemService }));
    app.route("/api", createWorkItemRoutes({ auth, workItems: workItemService }));
    app.route("/api/knowledge", createKnowledgeRoutes({ auth, workItems: workItemService }));
    app.route("/api/pages", createPageRoutes({
      auth,
      queue,
      proposals: proposalService,
      workItems: workItemService,
      ledgerStore,
      allowUnauthenticatedGoldPath: false
    }));
    app.route("/api/cost", createCostRoutes({ auth, ledgerStore }));
    app.route("/api", createAgentRunRoutes({
      auth,
      queue,
      snapshots: snapshotsRepo,
      auditLogs: auditRepo,
      autoRun: false
    }));
    const seedUser = defaultSeedFixture.users[0];
    if (!seedUser) {
      throw new Error("Default seed user is missing.");
    }
    const cookie = await generateSignedCookie(COOKIE_NAME, seedUser.cookieToken, settings.auth.cookieSecret);
    const headers = { Cookie: cookie };
    const session = await app.request("/api/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        intent_text: "Write a small markdown deliverable into outputs/ and produce a reviewable proposal."
      })
    });
    if (session.status !== 200) {
      throw new Error(`Expected session create 200, got ${session.status}: ${await session.text()}`);
    }
    const sessionBody = await session.json() as { data: { session_id: string } };
    const nextQuestion = await app.request(`/api/sessions/${sessionBody.data.session_id}/next-question`, {
      method: "POST",
      headers,
      body: JSON.stringify({ selected_option_ids: ["document-draft"] })
    });
    if (nextQuestion.status !== 200) {
      throw new Error(`Expected next question 200, got ${nextQuestion.status}: ${await nextQuestion.text()}`);
    }
    const createdWorkItem = await app.request("/api/workitems", {
      method: "POST",
      headers,
      body: JSON.stringify({
        session_id: sessionBody.data.session_id,
        selected_option_ids: ["document-draft"]
      })
    });
    if (createdWorkItem.status !== 201) {
      throw new Error(`Expected work item create 201, got ${createdWorkItem.status}: ${await createdWorkItem.text()}`);
    }
    const createdWorkItemBody = await createdWorkItem.json() as { data: { workitem: { id: string; status: string } } };
    const workItemId = createdWorkItemBody.data.workitem.id;
    if (createdWorkItemBody.data.workitem.status !== "spec_ready") {
      throw new Error(`Expected spec_ready work item, got ${createdWorkItemBody.data.workitem.status}`);
    }
    const knowledge = await app.request("/api/knowledge/search", {
      method: "POST",
      headers,
      body: JSON.stringify({ query: "markdown deliverable", work_item_id: workItemId })
    });
    if (knowledge.status !== 200) {
      throw new Error(`Expected knowledge search 200, got ${knowledge.status}: ${await knowledge.text()}`);
    }
    const knowledgeBody = await knowledge.json() as {
      data: { evidence_refs: { id: string; source_type: string; source_id: string; title: string }[] };
    };
    if (knowledgeBody.data.evidence_refs.length < 1) {
      throw new Error("Expected knowledge search to find the newly created work item as evidence.");
    }
    const evidenceBound = await app.request(`/api/workitems/${workItemId}/evidence-bindings`, {
      method: "POST",
      headers,
      body: JSON.stringify({ evidence_refs: knowledgeBody.data.evidence_refs })
    });
    if (evidenceBound.status !== 200) {
      throw new Error(`Expected evidence binding 200, got ${evidenceBound.status}: ${await evidenceBound.text()}`);
    }
    const workItemPage = await app.request(`/api/pages/workitems/${workItemId}`, { headers });
    if (workItemPage.status !== 200) {
      throw new Error(`Expected work item page 200, got ${workItemPage.status}: ${await workItemPage.text()}`);
    }
    const workItemPageBody = await workItemPage.json() as { data: { evidence_refs: unknown[] } };
    if (workItemPageBody.data.evidence_refs.length < 1) {
      throw new Error("Expected work item page to include bound evidence refs.");
    }

    const start = await app.request(`/api/workitems/${workItemId}/agent-runs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "R1 PG smoke run" })
    });
    if (start.status !== 202) {
      throw new Error(`Expected AgentRun enqueue 202, got ${start.status}: ${await start.text()}`);
    }
    const startBody = await start.json() as { data: { run_id: string } };
    const runId = startBody.data.run_id;
    const executed = await queue.run(runId);
    if (executed.status !== "succeeded") {
      throw new Error(`Expected succeeded AgentRun, got ${executed.status}`);
    }
    await ledgerStore.recordUsage(buildUsageRecord({
      provider: "deepseek",
      model: "deepseek-v4-flash",
      task: "worker",
      runId,
      workItemId,
      userId: defaultSeedIds.adminUserId,
      inputTokens: 1500,
      outputTokens: 500,
      costTier: { inputCnyPerMtok: 2, outputCnyPerMtok: 8 },
      createdAt: new Date("2026-06-08T12:00:00.000Z")
    }));
    const costUsage = await app.request("/api/cost/usage", { headers });
    const costPage = await app.request("/api/pages/cost", { headers });
    if (costUsage.status !== 200) {
      throw new Error(`Expected cost usage 200, got ${costUsage.status}: ${await costUsage.text()}`);
    }
    if (costPage.status !== 200) {
      throw new Error(`Expected cost page 200, got ${costPage.status}: ${await costPage.text()}`);
    }
    const costUsageBody = await costUsage.json() as { data: { me: { token_in: number }; team?: { token_in: number } } };
    const costPageBody = await costPage.json() as { data: { total_cost_cny: string; token_in: number } };
    if (costUsageBody.data.me.token_in !== 1500 || costUsageBody.data.team?.token_in !== 1500) {
      throw new Error("Expected DB cost usage to include user and team ledger scopes.");
    }
    if (costPageBody.data.total_cost_cny !== "0.007" || costPageBody.data.token_in !== 1500) {
      throw new Error(`Expected DB cost page totals, got ${JSON.stringify(costPageBody.data)}`);
    }
    const proposalRowsBeforeMerge = await db.select().from(proposals).then((rows) =>
      rows.filter((row) => row.workItemId === workItemId)
    );
    const proposalBeforeMerge = proposalRowsBeforeMerge[0];
    if (!proposalBeforeMerge) {
      throw new Error("Expected AgentRun to open a proposal.");
    }
    await proposalService.review({
      proposalId: proposalBeforeMerge.id,
      actor: { actor_kind: "human", actor_user_id: defaultSeedIds.adminUserId },
      decision: "approve"
    });
    const merged = await proposalService.merge({
      proposalId: proposalBeforeMerge.id,
      actor: { actor_kind: "human", actor_user_id: defaultSeedIds.adminUserId }
    });
    if (merged.status !== "merged" || !merged.merge_snapshot_id) {
      throw new Error(`Expected merged proposal with snapshot, got ${merged.status}`);
    }

    const restartedPersistence = createDbAgentRunPersistence(createAgentRunRepository(db));
    const restartedQueue = createInMemoryAgentRunQueue({
      settings,
      persistence: restartedPersistence,
      confidence: false,
      humanReserved: false,
      proposals: false,
      notifications: false,
      eventBus: false
    });
    const restartedApp = withErrors(new Hono<AuthEnv>());
    restartedApp.route("/api", createAgentRunRoutes({
      auth,
      queue: restartedQueue,
      snapshots: snapshotsRepo,
      auditLogs: auditRepo,
      autoRun: false
    }));
    const runAfterRestart = await restartedApp.request(`/api/agent-runs/${runId}`, { headers });
    const replayAfterRestart = await restartedApp.request(`/api/agent-runs/${runId}/replay`, { headers });
    if (runAfterRestart.status !== 200) {
      throw new Error(`Expected restart run read 200, got ${runAfterRestart.status}: ${await runAfterRestart.text()}`);
    }
    if (replayAfterRestart.status !== 200) {
      throw new Error(`Expected restart replay read 200, got ${replayAfterRestart.status}: ${await replayAfterRestart.text()}`);
    }
    const [
      agentRunRows,
      stepRows,
      proposalRows,
      branchRows,
      workItemRows,
      snapshotRows,
      auditRows,
      usageRecordRows,
      costLedgerRows
    ] = await Promise.all([
      db.select().from(agentRuns).then((rows) => rows.filter((row) => row.id === runId)),
      restartedQueue.trace(runId),
      db.select().from(proposals).then((rows) => rows.filter((row) => row.workItemId === workItemId)),
      db.select().from(branches).then((rows) => rows.filter((row) => row.workItemId === workItemId)),
      db.select().from(workItems).then((rows) => rows.filter((row) => row.id === workItemId)),
      db.select().from(snapshots).then((rows) => rows.filter((row) => row.workItemId === workItemId)),
      db.select().from(auditLogs).then((rows) => rows.filter((row) => row.entityId === workItemId)),
      db.select().from(usageRecords).then((rows) => rows.filter((row) => row.runId === runId)),
      db.select().from(costLedgerEntries).then((rows) => rows.filter((row) => row.runId === runId))
    ]);
    const proposalAfterMerge = proposalRows[0];
    const branchAfterMerge = branchRows.find((row) => row.id === proposalAfterMerge?.branchId);
    const workItemAfterMerge = workItemRows[0];
    if (proposalAfterMerge?.status !== "merged") {
      throw new Error(`Expected proposal.status merged, got ${proposalAfterMerge?.status ?? "missing"}`);
    }
    if (branchAfterMerge?.status !== "merged") {
      throw new Error(`Expected branch.status merged, got ${branchAfterMerge?.status ?? "missing"}`);
    }
    if (workItemAfterMerge?.status !== "merged" || workItemAfterMerge.mainBranchId !== proposalAfterMerge.branchId) {
      throw new Error(
        `Expected work item main branch merge, got status=${workItemAfterMerge?.status ?? "missing"} main=${workItemAfterMerge?.mainBranchId ?? "missing"}`
      );
    }
    const replay = await replayAfterRestart.json() as {
      data: { steps: unknown[]; snapshots: unknown[]; audit_logs: unknown[] };
    };
    const summary = {
      ok: true,
      database_url: settings.databaseUrl.replace(/:\/\/([^:]+):([^@]+)@/u, "://$1:***@"),
      work_item_id: workItemId,
      run_id: runId,
      intake: {
        session_status: session.status,
        work_item_status: createdWorkItemBody.data.workitem.status,
        evidence_refs: knowledgeBody.data.evidence_refs.length,
        page_evidence_refs: workItemPageBody.data.evidence_refs.length
      },
      run_status: (await runAfterRestart.json() as { data: { status: string } }).data.status,
      db_rows: {
        agent_runs: agentRunRows.length,
        agent_steps: stepRows.length,
        proposals: proposalRows.length,
        branches: branchRows.length,
        snapshots: snapshotRows.length,
        audit_logs: auditRows.length,
        usage_records: usageRecordRows.length,
        cost_ledger_entries: costLedgerRows.length
      },
      cost: {
        usage_me_token_in: costUsageBody.data.me.token_in,
        usage_team_token_in: costUsageBody.data.team?.token_in,
        page_total_cost_cny: costPageBody.data.total_cost_cny,
        page_token_in: costPageBody.data.token_in
      },
      merge: {
        proposal_status: proposalAfterMerge.status,
        branch_status: branchAfterMerge?.status,
        work_item_status: workItemAfterMerge.status,
        main_branch_id: workItemAfterMerge.mainBranchId,
        merge_snapshot_id: proposalAfterMerge.mergeSnapshotId
      },
      replay_steps: replay.data.steps.length,
      replay_snapshots: replay.data.snapshots.length,
      replay_audit_logs: replay.data.audit_logs.length,
      workdir_ref: await restartedQueue.workdir(runId)
    };
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await client.close();
  }
}

await main();
