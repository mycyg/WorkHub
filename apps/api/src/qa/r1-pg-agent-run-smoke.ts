import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AgentLoopClient } from "@workhub/agent/loop";
import { loadSettings } from "@workhub/config";
import {
  auditLogs,
  agentRuns,
  acceptedDeliverableChanges,
  branches,
  budgetPolicies,
  budgetPolicyStorageId,
  budgetReservations,
  costLedgerEntries,
  createAgentRunRepository,
  createAuditLogRepository,
  createBudgetReservationRepository,
  createAiDecisionRepository,
  createClientDeviceRepository,
  createDatabaseClient,
  createDbBudgetPolicyStore,
  createDbCostLedgerStore,
  createDriveRepository,
  createProposalRepository,
  createTaskPlanRepository,
  createWorkItemRepository,
  createSnapshotRepository,
  createUserRepository,
  defaultSeedFixture,
  defaultSeedIds,
  escalationEvents,
  mergeAttempts,
  mergeProposals,
  orgs,
  proposals,
  projects,
  projectDriveItems,
  projectDriveOperations,
  projectDriveVersions,
  runMigrations,
  snapshots,
  taskPlanItems,
  taskPlans,
  usageRecords,
  users,
  workItemAcceptanceItems,
  workItemTaskItems,
  workItemTaskPlans,
  workItems,
  workspaces
} from "@workhub/db";
import { buildUsageRecord } from "@workhub/cost";
import type { DeliverableChangeManifest } from "@workhub/contracts";
import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "../middleware/auth.js";
import { createAgentRunRoutes } from "../routes/agent-runs.js";
import { createCostRoutes } from "../routes/cost.js";
import { createEscalationRoutes } from "../routes/escalations.js";
import { createKnowledgeRoutes } from "../routes/knowledge.js";
import { createPageRoutes } from "../routes/pages.js";
import { createProposalRoutes, createWorkItemProposalRoutes } from "../routes/proposals.js";
import { createSessionRoutes } from "../routes/sessions.js";
import { createTaskPlanRoutes } from "../routes/task-plans.js";
import { createWorkItemRoutes } from "../routes/workitems.js";
import type { MergeFusionCandidateGenerator } from "../services/merge-fusion-candidates.js";
import { createDbAgentRunPersistence } from "../services/agent-run-persistence.js";
import { createEscalationService, EscalationServiceError } from "../services/escalations.js";
import { createDbProposalService, ProposalServiceError } from "../services/proposals.js";
import { createTaskDispatcher } from "../services/task-dispatcher.js";
import { createTaskPlanWorkflowService, TaskPlanServiceError } from "../services/task-plans.js";
import { createDbWorkItemService } from "../services/work-items.js";
import { createInMemoryAgentRunQueue, type AgentRunQueue } from "../workers/agent-runner.js";

function sha256Text(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

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

function deterministicFusionGenerator(): MergeFusionCandidateGenerator {
  return {
    async generate(input) {
      return input.conflicts
        .filter((conflict) => conflict.target_kind === "text_doc" || conflict.target_kind === "spec_doc")
        .map((conflict) => {
          const context = input.contentContexts?.[conflict.target_key];
          if (!context?.current?.text || !context.incoming?.text) {
            throw new Error(`Expected R1.20 fusion content context for ${conflict.target_key}`);
          }
          return {
            conflictKey: conflict.target_key,
            recommendedOptionKey: "ai_fusion",
            candidates: [
              {
                option_key: "ai_fusion",
                target_kind: conflict.target_kind,
                rationale_md: "PG smoke AI 融合稿同时保留正式版与这次版本的关键信息。",
                source: "llm",
                quality_gate: {
                  status: "passed",
                  checks: [
                    "pg_smoke_deterministic_generator",
                    "current_text_context",
                    "incoming_text_context",
                    "no_git_conflict_markers"
                  ]
                },
                merged_value: {
                  proposed_resolution_md: [
                    "# R1.17 one-click AI fusion",
                    "",
                    "PG smoke fused current accepted content with the incoming proposal.",
                    "",
                    `Conflict key: ${conflict.target_key}`
                  ].join("\n")
                }
              }
            ]
          };
        });
    }
  };
}

function deterministicTaskPlanner() {
  return {
    async createDraft() {
      const researchId = randomUUID();
      const produceId = randomUUID();
      const reviewId = randomUUID();
      return {
        items: [
          {
            id: researchId,
            seq: 0,
            title: "R1 PG smoke research",
            role: "research" as const,
            objectiveMd: "Collect deterministic source notes for the smoke task.",
            acceptanceMd: "At least one deterministic source note is listed.",
            budgetSharePct: 30,
            dependsOn: []
          },
          {
            id: produceId,
            seq: 1,
            title: "R1 PG smoke produce",
            role: "produce" as const,
            objectiveMd: "Draft the deterministic task-plan deliverable outline.",
            acceptanceMd: "The outline has a conclusion and evidence section.",
            budgetSharePct: 50,
            dependsOn: [researchId]
          },
          {
            id: reviewId,
            seq: 2,
            title: "R1 PG smoke review",
            role: "review" as const,
            objectiveMd: "Review that each acceptance item maps to a subtask.",
            acceptanceMd: "All acceptance items are covered by the plan.",
            budgetSharePct: 20,
            dependsOn: []
          }
        ],
        decompositionContext: {
          source: "r1-pg-smoke",
          judge: { decision: "approve", confidence: "high" }
        }
      };
    }
  };
}

function withErrors<T extends { Variables: Record<string, unknown> }>(app: Hono<T>) {
  app.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json({ ok: false, error: { code: "validation_error", message: "invalid payload" } }, 422);
    }
    if (error instanceof EscalationServiceError) {
      return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as 400);
    }
    if (error instanceof TaskPlanServiceError) {
      return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as 400);
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
    const userRepo = createUserRepository(db);
    const deviceRepo = createClientDeviceRepository(db);
    const auth: AuthDependencies = {
      users: userRepo,
      devices: deviceRepo,
      settings
    };
    const snapshotsRepo = createSnapshotRepository(db);
    const auditRepo = createAuditLogRepository(db);
    const agentRunRepo = createAgentRunRepository(db);
    const persistence = createDbAgentRunPersistence(agentRunRepo);
    const formalStorageRoot = await mkdtemp(path.join(os.tmpdir(), "workhub-r1-pg-drive-"));
    const proposalRepository = createProposalRepository(db);
    const taskPlanRepository = createTaskPlanRepository(db);
    const proposalService = createDbProposalService(proposalRepository, {
      storageRoot: formalStorageRoot,
      fusionCandidateGenerator: deterministicFusionGenerator()
    });
    const workItemRepository = createWorkItemRepository(db);
    // codex 把 intake 改为「必须真 AI 反问，无 provider 直接 503」但没同步本 smoke——
    // 与 fusionCandidateGenerator 同款：注入确定性澄清生成器（引用意图原文以通过反模板校验）。
    const workItemService = createDbWorkItemService(workItemRepository, {
      clarificationGenerator: async (input) => ({
        title: `请确认「${(input.workItem.title ?? "").slice(0, 60)}」的交付重点与验收口径？`,
        body: `PG smoke deterministic clarification. Intent: ${(input.workItem.rawDescription ?? input.workItem.title ?? "").slice(0, 200)}`,
        placeholder: "例如：按需求原文执行即可。"
      })
    });
    const taskPlanService = createTaskPlanWorkflowService({
      taskPlans: taskPlanRepository,
      proposals: proposalService,
      planner: deterministicTaskPlanner()
    });
    const aiDecisionRepository = createAiDecisionRepository(db);
    const escalationService = createEscalationService({
      repository: {
        findById: (id) => aiDecisionRepository.findEscalationById(id),
        listUnresolvedForWorkspace: (input) => aiDecisionRepository.listUnresolvedEscalationsForWorkspace(input),
        resolveEscalation: (input) => aiDecisionRepository.resolveEscalation(input),
        delegateEscalation: (input) => aiDecisionRepository.delegateEscalation(input)
      },
      users: userRepo,
      workItems: workItemService
    });
    const ledgerStore = createDbCostLedgerStore(db, {
      teamId: settings.auth.defaultWorkspaceId,
      evalSuite: "nightly"
    });
    const policyStore = createDbBudgetPolicyStore(db);
    const workdir = await mkdtemp(path.join(os.tmpdir(), "workhub-r1-pg-agent-"));
    const snapshotRoot = await mkdtemp(path.join(os.tmpdir(), "workhub-r1-pg-snapshot-"));
    const queue = createInMemoryAgentRunQueue({
      settings,
      workdir: () => workdir,
      client: () => executableAgentClient(),
      snapshotRoot,
      snapshots: snapshotsRepo,
      auditLogs: auditRepo,
      policyStore,
      ledgerStore,
      persistence,
      proposals: proposalService,
      confidence: false,
      humanReserved: false,
      notifications: false,
      eventBus: false
    });
    const taskDispatcher = createTaskDispatcher({
      repository: taskPlanRepository,
      queue,
      escalationSink: false,
      completionSink: false
    });
    const app = withErrors(new Hono<AuthEnv>());
    app.route("/api", createSessionRoutes({ auth, workItems: workItemService }));
    app.route("/api", createWorkItemRoutes({ auth, workItems: workItemService }));
    app.route("/api/escalations", createEscalationRoutes({ auth, service: escalationService }));
    app.route("/api/proposals", createProposalRoutes({ auth, proposals: proposalService }));
    app.route("/api", createWorkItemProposalRoutes({ auth, proposals: proposalService }));
    app.route("/api", createTaskPlanRoutes({ auth, service: taskPlanService, workItems: workItemService }));
    app.route("/api/knowledge", createKnowledgeRoutes({ auth, workItems: workItemService }));
    app.route("/api/pages", createPageRoutes({
      auth,
      queue,
      escalations: escalationService,
      proposals: proposalService,
      workItems: workItemService,
      policyStore,
      ledgerStore,
      allowUnauthenticatedGoldPath: false
    }));
    app.route("/api/cost", createCostRoutes({ auth, policyStore, ledgerStore, auditLogs: auditRepo }));
    app.route("/api", createAgentRunRoutes({
      auth,
      queue,
      snapshots: snapshotsRepo,
      auditLogs: auditRepo,
      workItems: workItemService,
      proposalAudit: proposalRepository,
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
    const taskPlanSession = await app.request("/api/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        intent_text: "R9.1 task-plan smoke: research and produce a short topic report."
      })
    });
    if (taskPlanSession.status !== 200) {
      throw new Error(`Expected task-plan session create 200, got ${taskPlanSession.status}: ${await taskPlanSession.text()}`);
    }
    const taskPlanSessionBody = await taskPlanSession.json() as { data: { session_id: string } };
    const taskPlanNextQuestion = await app.request(`/api/sessions/${taskPlanSessionBody.data.session_id}/next-question`, {
      method: "POST",
      headers,
      body: JSON.stringify({ selected_option_ids: ["document-draft"] })
    });
    if (taskPlanNextQuestion.status !== 200) {
      throw new Error(`Expected task-plan next question 200, got ${taskPlanNextQuestion.status}: ${await taskPlanNextQuestion.text()}`);
    }
    const taskPlanWorkItem = await app.request("/api/workitems", {
      method: "POST",
      headers,
      body: JSON.stringify({
        session_id: taskPlanSessionBody.data.session_id,
        selected_option_ids: ["document-draft"]
      })
    });
    if (taskPlanWorkItem.status !== 201) {
      throw new Error(`Expected task-plan work item create 201, got ${taskPlanWorkItem.status}: ${await taskPlanWorkItem.text()}`);
    }
    const taskPlanWorkItemBody = await taskPlanWorkItem.json() as { data: { workitem: { id: string; status: string } } };
    const taskPlanWorkItemId = taskPlanWorkItemBody.data.workitem.id;
    const taskPlanCreate = await app.request(`/api/workitems/${taskPlanWorkItemId}/task-plan`, {
      method: "POST",
      headers,
      body: JSON.stringify({ memories: { user: ["R1 smoke prefers evidence-backed output."], team: ["Separate produce and review roles."] } })
    });
    if (taskPlanCreate.status !== 201) {
      throw new Error(`Expected task-plan create 201, got ${taskPlanCreate.status}: ${await taskPlanCreate.text()}`);
    }
    const taskPlanCreateBody = await taskPlanCreate.json() as {
      data: {
        plan_id: string;
        proposal_id: string;
        proposal: {
          title: string;
          diff_manifest: {
            changes: {
              machine_summary?: {
                task_plan_items?: { role: string; budget_share_pct: number; depends_on: string[] }[];
              };
            }[];
          };
        };
      };
    };
    if (taskPlanCreateBody.data.proposal.title !== "计划提议") {
      throw new Error(`Expected plan proposal title 计划提议, got ${taskPlanCreateBody.data.proposal.title}`);
    }
    const taskPlanProposalItems = taskPlanCreateBody.data.proposal.diff_manifest.changes[0]?.machine_summary?.task_plan_items ?? [];
    if (taskPlanProposalItems.length !== 3 || taskPlanProposalItems[1]?.depends_on.length !== 1) {
      throw new Error(`Expected plan proposal manifest to expose 3 structured items with dependencies, got ${taskPlanProposalItems.length}`);
    }
    const taskPlanReview = await app.request(`/api/proposals/${taskPlanCreateBody.data.proposal_id}/review`, {
      method: "POST",
      headers,
      body: JSON.stringify({ decision: "approve" })
    });
    if (taskPlanReview.status !== 200) {
      throw new Error(`Expected task-plan proposal review 200, got ${taskPlanReview.status}: ${await taskPlanReview.text()}`);
    }
    const taskPlanMerge = await app.request(`/api/proposals/${taskPlanCreateBody.data.proposal_id}/merge`, {
      method: "POST",
      headers,
      body: JSON.stringify({})
    });
    if (taskPlanMerge.status !== 200) {
      throw new Error(`Expected task-plan proposal merge 200, got ${taskPlanMerge.status}: ${await taskPlanMerge.text()}`);
    }
    const taskPlanRows = await db.select().from(taskPlans).then((rows) =>
      rows.filter((row) => row.id === taskPlanCreateBody.data.plan_id)
    );
    const taskPlanRow = taskPlanRows[0];
    if (taskPlanRow?.status !== "approved") {
      throw new Error(`Expected task plan approved after merge, got ${taskPlanRow?.status ?? "missing"}`);
    }
    const taskPlanItemRows = await db.select().from(taskPlanItems).then((rows) =>
      rows.filter((row) => row.planId === taskPlanCreateBody.data.plan_id)
    );
    if (taskPlanItemRows.length !== 3) {
      throw new Error(`Expected 3 task plan items, got ${taskPlanItemRows.length}`);
    }
    const taskPlanWorkItemRows = await db.select().from(workItems).then((rows) =>
      rows.filter((row) => row.id === taskPlanWorkItemId)
    );
    const taskPlanWorkItemAfterMerge = taskPlanWorkItemRows[0];
    if (!taskPlanWorkItemAfterMerge || taskPlanWorkItemAfterMerge.status === "merged") {
      throw new Error(`Expected task-plan proposal merge not to complete the work item, got ${taskPlanWorkItemAfterMerge?.status ?? "missing"}`);
    }
    const taskPlanWorkItemPage = await app.request(`/api/pages/workitems/${taskPlanWorkItemId}`, { headers });
    if (taskPlanWorkItemPage.status !== 200) {
      throw new Error(`Expected task-plan work item page 200, got ${taskPlanWorkItemPage.status}: ${await taskPlanWorkItemPage.text()}`);
    }
    const taskPlanWorkItemPageBody = await taskPlanWorkItemPage.json() as {
      data: { task_plan?: { status: string; items: unknown[]; items_capped: boolean } };
    };
    const taskPlanPagePlan = taskPlanWorkItemPageBody.data.task_plan;
    if (!taskPlanPagePlan || taskPlanPagePlan.status !== "approved") {
      throw new Error(`Expected work item page task_plan approved, got ${taskPlanPagePlan?.status ?? "missing"}`);
    }
    if (taskPlanPagePlan.items.length !== 3 || taskPlanPagePlan.items_capped) {
      throw new Error(`Expected work item page task_plan to expose 3 uncapped items, got ${taskPlanPagePlan.items.length}`);
    }
    const taskPlanDispatch = await taskDispatcher.dispatch({
      planId: taskPlanCreateBody.data.plan_id,
      workspaceId: settings.auth.defaultWorkspaceId,
      orgId: defaultSeedIds.orgId,
      actorId: seedUser.id
    });
    if (taskPlanDispatch.enqueuedItemIds.length !== 2 || taskPlanDispatch.casMissItemIds.length !== 0) {
      throw new Error(`Expected dispatcher to enqueue 2 ready child runs without CAS misses, got ${JSON.stringify(taskPlanDispatch)}`);
    }
    const dispatchedTaskPlanRows = await db.select().from(taskPlans).then((rows) =>
      rows.filter((row) => row.id === taskPlanCreateBody.data.plan_id)
    );
    if (dispatchedTaskPlanRows[0]?.status !== "dispatching") {
      throw new Error(`Expected task plan dispatching after dispatcher run, got ${dispatchedTaskPlanRows[0]?.status ?? "missing"}`);
    }
    const dispatchedTaskPlanItems = await db.select().from(taskPlanItems).then((rows) =>
      rows.filter((row) => row.planId === taskPlanCreateBody.data.plan_id)
    );
    const dispatchedReadyItems = dispatchedTaskPlanItems.filter((row) => row.status === "dispatched");
    const pendingAfterDispatch = dispatchedTaskPlanItems.filter((row) => row.status === "pending");
    if (dispatchedReadyItems.length !== 2 || pendingAfterDispatch.length !== 1) {
      throw new Error(`Expected 2 dispatched ready items and 1 pending dependency, got ${JSON.stringify({
        dispatched: dispatchedReadyItems.map((row) => ({ id: row.id, role: row.role, activeRunId: row.activeRunId })),
        pending: pendingAfterDispatch.map((row) => ({ id: row.id, role: row.role }))
      })}`);
    }
    if (dispatchedReadyItems.some((row) => !row.activeRunId)) {
      throw new Error("Expected dispatched task-plan items to bind active_run_id.");
    }
    const taskPlanChildRuns = await db.select().from(agentRuns).then((rows) =>
      rows.filter((row) => row.taskPlanId === taskPlanCreateBody.data.plan_id)
    );
    if (taskPlanChildRuns.length !== 2) {
      throw new Error(`Expected 2 task-plan child agent_runs, got ${taskPlanChildRuns.length}`);
    }
    const childReplayRunIds = taskPlanChildRuns.map((row) => row.id);
    const researchItem = dispatchedReadyItems.find((row) => row.role === "research");
    const reviewItem = dispatchedReadyItems.find((row) => row.role === "review");
    const researchRun = taskPlanChildRuns.find((row) => row.id === researchItem?.activeRunId);
    const reviewRun = taskPlanChildRuns.find((row) => row.id === reviewItem?.activeRunId);
    if (!researchRun || !reviewRun) {
      throw new Error("Expected active_run_id to point at the created child agent_runs.");
    }
    const expectedPlanCost = Number.parseFloat(settings.budgets.runCostCny);
    const childCostTotal = taskPlanChildRuns.reduce((sum, row) => sum + Number.parseFloat(row.maxCostCny), 0);
    if (Number.isFinite(expectedPlanCost) && childCostTotal > expectedPlanCost + 0.000001) {
      throw new Error(`Expected child run budget total <= plan budget ${expectedPlanCost}, got ${childCostTotal}`);
    }
    if (researchRun.maxTokens !== Math.floor(settings.budgets.runTokens * 0.3)) {
      throw new Error(`Expected research run max_tokens to be budget-share sliced, got ${researchRun.maxTokens}`);
    }
    if (Math.abs(Number.parseFloat(researchRun.maxCostCny) - expectedPlanCost * 0.3) > 0.000001) {
      throw new Error(`Expected research run max_cost_cny to be 30% of plan budget, got ${researchRun.maxCostCny}`);
    }
    const taskPlanWorkItemPageAfterDispatch = await app.request(`/api/pages/workitems/${taskPlanWorkItemId}`, { headers });
    if (taskPlanWorkItemPageAfterDispatch.status !== 200) {
      throw new Error(`Expected task-plan work item page after dispatch 200, got ${taskPlanWorkItemPageAfterDispatch.status}: ${await taskPlanWorkItemPageAfterDispatch.text()}`);
    }
    const taskPlanWorkItemPageAfterDispatchBody = await taskPlanWorkItemPageAfterDispatch.json() as {
      data: {
        task_plan?: { status: string };
        agent_team?: {
          status: string;
          completed_count: number;
          total_count: number;
          runs_capped: boolean;
          items: Array<{ status: string; run_id?: string; action?: { kind: string; href: string } }>;
        };
      };
    };
    const taskPlanPageAgentTeam = taskPlanWorkItemPageAfterDispatchBody.data.agent_team;
    const dispatchedAgentTeamItems = taskPlanPageAgentTeam?.items.filter((item) => item.status === "dispatched") ?? [];
    const pendingAgentTeamItems = taskPlanPageAgentTeam?.items.filter((item) => item.status === "pending") ?? [];
    if (
      !taskPlanPageAgentTeam
      || taskPlanPageAgentTeam.status !== "dispatching"
      || taskPlanPageAgentTeam.completed_count !== 0
      || taskPlanPageAgentTeam.total_count !== 3
      || taskPlanPageAgentTeam.runs_capped
      || dispatchedAgentTeamItems.length !== 2
      || pendingAgentTeamItems.length !== 1
      || dispatchedAgentTeamItems.some((item) => !item.run_id)
    ) {
      throw new Error(`Expected task-plan agent_team to expose 2 dispatched child runs plus 1 pending dependency, got ${JSON.stringify(taskPlanPageAgentTeam)}`);
    }
    const staleRecord = await queue.get(researchRun.id);
    if (!staleRecord) {
      throw new Error("Expected queued research run to be readable from queue.");
    }
    const staleSettle = await taskDispatcher.handleRunSettled({
      ...staleRecord,
      run_id: randomUUID(),
      status: "succeeded"
    });
    if (staleSettle !== null) {
      throw new Error("Expected stale child run settlement to be ignored by active_run_id fence.");
    }
    const currentSettle = await taskDispatcher.handleRunSettled({
      ...staleRecord,
      status: "succeeded"
    });
    if (!currentSettle || currentSettle.dispatch.enqueuedItemIds.length !== 1) {
      throw new Error(`Expected current child settlement to unlock exactly one downstream item, got ${JSON.stringify(currentSettle)}`);
    }
    const afterSettleItems = await db.select().from(taskPlanItems).then((rows) =>
      rows.filter((row) => row.planId === taskPlanCreateBody.data.plan_id)
    );
    const produceAfterSettle = afterSettleItems.find((row) => row.role === "produce");
    if (produceAfterSettle?.status !== "dispatched" || !produceAfterSettle.activeRunId) {
      throw new Error(`Expected produce item dispatched with active_run_id after research settles, got ${JSON.stringify(produceAfterSettle)}`);
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

    const r2ConcurrentWorkItemId = randomUUID();
    await db.insert(workItems).values({
      id: r2ConcurrentWorkItemId,
      code: `R2-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
      projectId: defaultSeedIds.projectId,
      workspaceId: settings.auth.defaultWorkspaceId,
      submitterUserId: seedUser.id,
      title: "R2 multi-worker duplicate enqueue smoke",
      rawDescription: "Verifies DB-backed active AgentRun uniqueness for one work item.",
      summaryMd: "R2 duplicate enqueue smoke.",
      status: "spec_ready",
      mode: "worker"
    });
    const r2QueueOptions = {
      settings,
      persistence,
      confidence: false,
      humanReserved: false,
      proposals: false,
      notifications: false,
      eventBus: false
    } satisfies Parameters<typeof createInMemoryAgentRunQueue>[0];
    const r2QueueA: AgentRunQueue = createInMemoryAgentRunQueue(r2QueueOptions);
    const r2QueueB: AgentRunQueue = createInMemoryAgentRunQueue(r2QueueOptions);
    const r2ConcurrentResults = await Promise.allSettled([
      r2QueueA.enqueue({
        workItemId: r2ConcurrentWorkItemId,
        actorId: seedUser.id,
        title: "R2 duplicate enqueue A"
      }),
      r2QueueB.enqueue({
        workItemId: r2ConcurrentWorkItemId,
        actorId: seedUser.id,
        title: "R2 duplicate enqueue B"
      })
    ]);
    const r2Fulfilled = r2ConcurrentResults.filter((result) => result.status === "fulfilled");
    const r2Rejected = r2ConcurrentResults.find((result): result is PromiseRejectedResult => result.status === "rejected");
    const r2RejectedReason = r2Rejected?.reason as { status?: unknown; code?: unknown } | undefined;
    const r2AgentRunRows = await db.select().from(agentRuns).then((rows) =>
      rows.filter((row) => row.workItemId === r2ConcurrentWorkItemId)
    );
    const r2ActiveAgentRunRows = r2AgentRunRows.filter((row) => row.status === "queued" || row.status === "running");
    if (
      r2Fulfilled.length !== 1
      || !r2Rejected
      || r2RejectedReason?.status !== 409
      || r2RejectedReason.code !== "agent_run_already_active"
      || r2AgentRunRows.length !== 1
      || r2ActiveAgentRunRows.length !== 1
    ) {
      throw new Error(`Expected R2 duplicate enqueue to create exactly one active run, got ${JSON.stringify({
        fulfilled: r2Fulfilled.length,
        rejected: Boolean(r2Rejected),
        rejectedStatus: r2RejectedReason?.status,
        rejectedCode: r2RejectedReason?.code,
        agentRuns: r2AgentRunRows.length,
        activeAgentRuns: r2ActiveAgentRunRows.length
      })}`);
    }
    const policyListBefore = await app.request("/api/cost/policies", { headers });
    if (policyListBefore.status !== 200) {
      throw new Error(`Expected cost policy list 200, got ${policyListBefore.status}: ${await policyListBefore.text()}`);
    }
    const policyListBeforeBody = await policyListBefore.json() as {
      data: { id: string; scope_kind: string; max_tokens: number; max_cost_cny: string; version: number }[];
    };
    // R9.5：旧断言只数 5 条默认策略；task/objective 预算现在也是 enqueue 与成本页的默认契约，
    // R1 smoke 必须确认这两条存在，避免生产 PG 路径继续沿用旧预算面。
    const defaultPolicyIds = policyListBeforeBody.data.map((policy) => policy.id).sort();
    if (
      policyListBeforeBody.data.length !== 7
      || !defaultPolicyIds.includes("pcost-task-day-v0")
      || !defaultPolicyIds.includes("pcost-objective-day-v0")
    ) {
      throw new Error(`Expected 7 default P-COST policies with task/objective scopes, got ${JSON.stringify(defaultPolicyIds)}`);
    }
    const userPolicyBefore = policyListBeforeBody.data.find((policy) => policy.id === "pcost-user-day-v0");
    if (!userPolicyBefore || userPolicyBefore.scope_kind !== "user") {
      throw new Error("Expected pcost-user-day-v0 to be present before policy update.");
    }
    const policyUpdate = await app.request("/api/cost/policies/user/pcost-user-day-v0", {
      method: "PUT",
      headers,
      body: JSON.stringify({ max_tokens: 250000, max_cost_cny: "12.5", on_warning: "notify" })
    });
    if (policyUpdate.status !== 200) {
      throw new Error(`Expected cost policy update 200, got ${policyUpdate.status}: ${await policyUpdate.text()}`);
    }
    const policyUpdateBody = await policyUpdate.json() as {
      data: { id: string; max_tokens: number; max_cost_cny: string; version: number };
    };
    if (
      policyUpdateBody.data.id !== "pcost-user-day-v0"
      || policyUpdateBody.data.max_tokens !== 250000
      || policyUpdateBody.data.max_cost_cny !== "12.5"
      || policyUpdateBody.data.version !== userPolicyBefore.version + 1
    ) {
      throw new Error(`Expected persisted policy update response, got ${JSON.stringify(policyUpdateBody.data)}`);
    }
    const policyListAfter = await app.request("/api/cost/policies", { headers });
    if (policyListAfter.status !== 200) {
      throw new Error(`Expected cost policy readback 200, got ${policyListAfter.status}: ${await policyListAfter.text()}`);
    }
    const policyListAfterBody = await policyListAfter.json() as {
      data: { id: string; max_tokens: number; max_cost_cny: string; version: number }[];
    };
    const userPolicyAfter = policyListAfterBody.data.find((policy) => policy.id === "pcost-user-day-v0");
    if (
      !userPolicyAfter
      || userPolicyAfter.max_tokens !== 250000
      || userPolicyAfter.max_cost_cny !== "12.5"
      || userPolicyAfter.version !== policyUpdateBody.data.version
    ) {
      throw new Error(`Expected cost policy readback to use DB override, got ${JSON.stringify(userPolicyAfter)}`);
    }
    const userDayPolicyStorageId = budgetPolicyStorageId(settings, "pcost-user-day-v0");
    const [budgetPolicyRows, budgetPolicyAuditRows] = await Promise.all([
      db.select().from(budgetPolicies).then((rows) => rows.filter((row) => row.id === userDayPolicyStorageId)),
      db.select().from(auditLogs).then((rows) =>
        rows.filter((row) =>
          row.entityType === "budget_policy"
          && row.entityId === "pcost-user-day-v0"
          && row.action === "budget_policy.updated"
        )
      )
    ]);
    if (
      budgetPolicyRows.length !== 1
      || budgetPolicyRows[0]?.maxTokens !== 250000
      || budgetPolicyRows[0]?.version !== policyUpdateBody.data.version
      || budgetPolicyRows[0]?.workspaceId !== settings.auth.defaultWorkspaceId
    ) {
      throw new Error(`Expected one persisted budget_policies override, got ${JSON.stringify(budgetPolicyRows)}`);
    }
    if (
      !budgetPolicyAuditRows.some((row) =>
        row.detailJson["version_before"] === userPolicyBefore.version
        && row.detailJson["version_after"] === policyUpdateBody.data.version
        && (row.detailJson["patch"] as Record<string, unknown> | undefined)?.["max_tokens"] === 250000
      )
    ) {
      throw new Error("Expected budget_policy.updated audit log with before/after versions.");
    }
    const costUsageBefore = await app.request("/api/cost/usage", { headers });
    const costPageBefore = await app.request("/api/pages/cost", { headers });
    if (costUsageBefore.status !== 200) {
      throw new Error(`Expected pre-record cost usage 200, got ${costUsageBefore.status}: ${await costUsageBefore.text()}`);
    }
    if (costPageBefore.status !== 200) {
      throw new Error(`Expected pre-record cost page 200, got ${costPageBefore.status}: ${await costPageBefore.text()}`);
    }
    const costUsageBeforeBody = await costUsageBefore.json() as {
      data: { me: { token_in: number; max_tokens: number }; team?: { token_in: number } };
    };
    const costPageBeforeBody = await costPageBefore.json() as {
      data: { total_cost_cny: string; token_in: number; budget: { policy_id: string; max_tokens: number }[] };
    };
    if (
      costUsageBeforeBody.data.me.max_tokens !== 250000
      || !costPageBeforeBody.data.budget.some((usage) =>
        usage.policy_id === "pcost-user-day-v0" && usage.max_tokens === 250000
      )
    ) {
      throw new Error("Expected cost usage and cost page to read the persisted user budget override.");
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
      // 周期感知预算（C3）只统计当前周期用量，用量须落在当前周期内才计入 delta。
      createdAt: new Date()
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
    const userTokenDelta = costUsageBody.data.me.token_in - costUsageBeforeBody.data.me.token_in;
    const teamTokenDelta = (costUsageBody.data.team?.token_in ?? 0) - (costUsageBeforeBody.data.team?.token_in ?? 0);
    if (userTokenDelta !== 1500 || teamTokenDelta !== 1500) {
      throw new Error("Expected DB cost usage delta to include user and team ledger scopes.");
    }
    const pageCostDelta = Number(costPageBody.data.total_cost_cny) - Number(costPageBeforeBody.data.total_cost_cny);
    const pageTokenDelta = costPageBody.data.token_in - costPageBeforeBody.data.token_in;
    if (Math.abs(pageCostDelta - 0.007) > 0.000001 || pageTokenDelta !== 1500) {
      throw new Error(`Expected DB cost page totals, got ${JSON.stringify(costPageBody.data)}`);
    }
    const escalationProjectId = randomUUID();
    const escalationWorkItemId = randomUUID();
    const escalationEventId = randomUUID();
    await db.insert(projects).values({
      id: escalationProjectId,
      workspaceId: settings.auth.defaultWorkspaceId,
      name: "R9 escalation smoke project",
      slug: `r9-escalation-${randomUUID().slice(0, 8)}`,
      ownerNickname: "owner",
      ownerUserId: seedUser.id
    });
    await db.insert(workItems).values({
      id: escalationWorkItemId,
      code: `R9-ESC-${randomUUID().slice(0, 8)}`,
      projectId: escalationProjectId,
      workspaceId: settings.auth.defaultWorkspaceId,
      submitterUserId: seedUser.id,
      title: "R9 escalation smoke",
      rawDescription: "制造一个真实升级卡,再从 HTTP resolve 回到 ai_working。",
      summaryMd: "R9 escalation smoke.",
      status: "escalated",
      mode: "worker"
    });
    await db.insert(escalationEvents).values({
      id: escalationEventId,
      workItemId: escalationWorkItemId,
      trigger: "unqualified",
      reasonMd: "PG smoke escalation needs a human decision before retry.",
      handoffJson: {}
    });
    const attentionWithEscalation = await app.request("/api/pages/attention?locale=zh-CN", { headers });
    if (attentionWithEscalation.status !== 200) {
      throw new Error(`Expected attention escalation page 200, got ${attentionWithEscalation.status}: ${await attentionWithEscalation.text()}`);
    }
    const attentionWithEscalationBody = await attentionWithEscalation.json() as {
      data: {
        primary?: {
          kind?: string;
          source_ref?: { entity_type?: string; entity_id?: string };
          actions?: Array<{ label?: string; href?: string }>;
        };
        queue: Array<{
          kind?: string;
          source_ref?: { entity_type?: string; entity_id?: string };
          actions?: Array<{ label?: string; href?: string }>;
        }>;
      };
    };
    const escalationCards = [
      attentionWithEscalationBody.data.primary,
      ...attentionWithEscalationBody.data.queue
    ].filter(Boolean);
    const escalationCard = escalationCards.find((item) => item?.source_ref?.entity_id === escalationEventId);
    if (
      escalationCard?.kind !== "escalation"
      || !escalationCard.actions?.some((action) =>
        action.label === "让它重试" && action.href === `/api/escalations/${escalationEventId}/resolve`
      )
    ) {
      throw new Error("Expected attention page to show the unresolved R9 escalation card with retry action.");
    }
    const escalationResolve = await app.request(`/api/escalations/${escalationEventId}/resolve`, {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "retry", reason_md: "PG smoke retry path" })
    });
    if (escalationResolve.status !== 200) {
      throw new Error(`Expected escalation resolve 200, got ${escalationResolve.status}: ${await escalationResolve.text()}`);
    }
    const escalationResolveBody = await escalationResolve.json() as {
      data: { escalation: { resolved_at?: string }; work_item_status: string };
    };
    if (escalationResolveBody.data.work_item_status !== "ai_working" || !escalationResolveBody.data.escalation.resolved_at) {
      throw new Error(`Expected escalation resolve to return ai_working + resolved_at, got ${JSON.stringify(escalationResolveBody.data)}`);
    }
    const [resolvedEscalationWorkItem] = await db.select().from(workItems).then((rows) =>
      rows.filter((row) => row.id === escalationWorkItemId)
    );
    const [resolvedEscalationEvent] = await db.select().from(escalationEvents).then((rows) =>
      rows.filter((row) => row.id === escalationEventId)
    );
    if (resolvedEscalationWorkItem?.status !== "ai_working" || !resolvedEscalationEvent?.resolvedAt) {
      throw new Error(
        `Expected DB escalation resolve to persist ai_working/resolvedAt, got status=${resolvedEscalationWorkItem?.status ?? "missing"}`
      );
    }
    const attentionAfterEscalation = await app.request("/api/pages/attention?locale=zh-CN", { headers });
    if (attentionAfterEscalation.status !== 200) {
      throw new Error(`Expected post-resolve attention page 200, got ${attentionAfterEscalation.status}: ${await attentionAfterEscalation.text()}`);
    }
    const attentionAfterEscalationBody = await attentionAfterEscalation.json() as {
      data: {
        primary?: { source_ref?: { entity_id?: string } };
        queue: Array<{ source_ref?: { entity_id?: string } }>;
      };
    };
    const postResolveEscalationCard = [
      attentionAfterEscalationBody.data.primary,
      ...attentionAfterEscalationBody.data.queue
    ].filter(Boolean)
      .find((item) => item?.source_ref?.entity_id === escalationEventId);
    if (postResolveEscalationCard) {
      throw new Error("Expected resolved escalation to disappear from attention queue.");
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
    const firstAcceptedRowsForRestore = await db.select().from(acceptedDeliverableChanges).then((rows) =>
      rows.filter((row) => row.workItemId === workItemId && row.supersededAt === null && row.driveVersionId)
    );
    const firstAcceptedForRestore = firstAcceptedRowsForRestore[0];
    if (!firstAcceptedForRestore?.driveVersionId || !firstAcceptedForRestore.sha256After) {
      throw new Error("Expected first accepted deliverable to have a drive version and sha.");
    }
    const firstDriveVersionId = firstAcceptedForRestore.driveVersionId;
    const runWorkdir = await queue.workdir(runId);
    if (!runWorkdir) {
      throw new Error("Expected AgentRun workdir before second proposal.");
    }
    const secondContent = "R1 PG smoke deliverable v2";
    await writeFile(path.join(runWorkdir, "outputs", "result.md"), secondContent, "utf8");
    const secondSha = sha256Text(secondContent);
    const firstChange = proposalBeforeMerge.diffManifest.changes[0];
    if (!firstChange) {
      throw new Error("Expected first proposal to contain a deliverable change.");
    }
    const secondManifest: typeof proposalBeforeMerge.diffManifest = {
      ...proposalBeforeMerge.diffManifest,
      proposal_id: undefined,
      branch_id: undefined,
      title: "R1 PG smoke deliverable v2",
      summary_md: "更新同一个正式交付物，用于验证还原到上一版。",
      changes: [
        {
          ...firstChange,
          id: "92000000-0000-4000-8000-000000000201",
          change_type: "updated",
          target_ref: {
            ...firstChange.target_ref,
            sha256_before: firstAcceptedForRestore.sha256After,
            sha256_after: secondSha
          },
          human_summary: "更新 outputs/result.md 为第二版。"
        }
      ]
    };
    const secondProposal = await proposalService.createFromManifest({
      workItemId,
      manifest: secondManifest,
      actor: { actor_kind: "ai", label: "R1 PG smoke AI" },
      agentRunId: runId
    });
    await proposalService.review({
      proposalId: secondProposal.id,
      actor: { actor_kind: "human", actor_user_id: defaultSeedIds.adminUserId },
      decision: "approve"
    });
    const secondMerged = await proposalService.merge({
      proposalId: secondProposal.id,
      actor: { actor_kind: "human", actor_user_id: defaultSeedIds.adminUserId }
    });
    if (secondMerged.status !== "merged") {
      throw new Error(`Expected second proposal merged, got ${secondMerged.status}`);
    }
    const currentBeforeRestoreRows = await db.select().from(acceptedDeliverableChanges).then((rows) =>
      rows.filter((row) => row.workItemId === workItemId && row.supersededAt === null && row.driveVersionId)
    );
    const currentBeforeRestore = currentBeforeRestoreRows[0];
    if (!currentBeforeRestore?.driveVersionId || currentBeforeRestore.driveVersionId === firstDriveVersionId) {
      throw new Error("Expected second accepted deliverable to advance the current drive version before restore.");
    }
    const restoreResponse = await app.request(
      `/api/workitems/${workItemId}/deliverables/${currentBeforeRestore.id}/restore`,
      { method: "POST", headers }
    );
    if (restoreResponse.status !== 200) {
      throw new Error(`Expected accepted deliverable restore 200, got ${restoreResponse.status}: ${await restoreResponse.text()}`);
    }
    const restoreBody = await restoreResponse.json() as {
      data: { accepted_deliverable: { id: string; drive_version_id?: string; preview_href?: string; download_href?: string } };
    };
    if (restoreBody.data.accepted_deliverable.drive_version_id !== firstDriveVersionId) {
      throw new Error("Expected restore response to point back to the first drive version.");
    }
    if (!restoreBody.data.accepted_deliverable.preview_href || !restoreBody.data.accepted_deliverable.download_href) {
      throw new Error("Expected restored deliverable to keep preview and download refs.");
    }
    const restorePreview = await app.request(restoreBody.data.accepted_deliverable.preview_href, { headers });
    if (restorePreview.status !== 200) {
      throw new Error(`Expected restored preview 200, got ${restorePreview.status}: ${await restorePreview.text()}`);
    }
    const restorePreviewBody = await restorePreview.json() as { data: { text: string } };
    if (!restorePreviewBody.data.text.includes("R1 PG smoke deliverable") || restorePreviewBody.data.text.includes("v2")) {
      throw new Error("Expected restored preview to show the first accepted deliverable content.");
    }

    const limitedProjectId = randomUUID();
    const limitedWorkItemId = randomUUID();
    const limitedBranchId = randomUUID();
    const limitedProposalId = randomUUID();
    const limitedDriveItemId = randomUUID();
    const limitedDriveVersionId = randomUUID();
    const limitedWantedDriveItemId = randomUUID();
    const limitedWantedDriveVersionId = randomUUID();
    const limitedLoadedCurrentAcceptedId = randomUUID();
    const limitedWantedCurrentAcceptedId = randomUUID();
    await db.insert(projects).values({
      id: limitedProjectId,
      workspaceId: settings.auth.defaultWorkspaceId,
      name: "R9 current accepted limit smoke",
      slug: `r9-current-accepted-${randomUUID().slice(0, 8)}`,
      ownerNickname: "owner",
      ownerUserId: seedUser.id
    });
    await db.insert(workItems).values({
      id: limitedWorkItemId,
      code: `R9-ACCEPTED-${randomUUID().slice(0, 8)}`,
      projectId: limitedProjectId,
      workspaceId: settings.auth.defaultWorkspaceId,
      submitterUserId: seedUser.id,
      title: "R9 current accepted limit smoke",
      rawDescription: "History accepted rows must not consume the drive page current accepted limit.",
      summaryMd: "R9 accepted limit smoke.",
      status: "merged",
      mode: "worker"
    });
    await db.insert(branches).values({
      id: limitedBranchId,
      workItemId: limitedWorkItemId,
      actorKind: "ai",
      actorUserId: seedUser.id,
      status: "merged"
    });
    const limitedManifestChange: DeliverableChangeManifest["changes"][number] = {
      ...firstChange,
      id: randomUUID(),
      target_ref: {
        ...firstChange.target_ref,
        entity_id: limitedDriveItemId,
        path: "/r9/current-limit.md",
        sha256_after: "c".repeat(64)
      },
      human_summary: "R9 current accepted limit row."
    };
    const limitedWantedManifestChange: DeliverableChangeManifest["changes"][number] = {
      ...limitedManifestChange,
      id: randomUUID(),
      target_ref: {
        ...limitedManifestChange.target_ref,
        entity_id: limitedWantedDriveItemId,
        path: "/r9/wanted-current.md",
        sha256_after: "d".repeat(64)
      },
      human_summary: "R9 wanted current accepted row."
    };
    await db.insert(proposals).values({
      id: limitedProposalId,
      workItemId: limitedWorkItemId,
      branchId: limitedBranchId,
      round: 1,
      title: "R9 current accepted limit proposal",
      status: "merged",
      diffManifest: {
        ...proposalBeforeMerge.diffManifest,
        work_item_id: limitedWorkItemId,
        branch_id: limitedBranchId,
        proposal_id: limitedProposalId,
        title: "R9 current accepted limit proposal",
        changes: [limitedManifestChange, limitedWantedManifestChange]
      },
      openedByKind: "ai",
      openedByUserId: seedUser.id,
      reviewedAt: new Date("2026-07-02T00:00:00.000Z"),
      mergedAt: new Date("2026-07-02T00:01:00.000Z")
    });
    await db.insert(projectDriveItems).values({
      id: limitedDriveItemId,
      projectId: limitedProjectId,
      parentId: null,
      name: "aaa-loaded-current.md",
      kind: "file",
      currentVersionId: limitedDriveVersionId,
      createdByUserId: seedUser.id,
      updatedByUserId: seedUser.id,
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-01T00:00:00.000Z")
    });
    await db.insert(projectDriveItems).values({
      id: limitedWantedDriveItemId,
      projectId: limitedProjectId,
      parentId: null,
      name: "zzz-wanted-current.md",
      kind: "file",
      currentVersionId: limitedWantedDriveVersionId,
      createdByUserId: seedUser.id,
      updatedByUserId: seedUser.id,
      createdAt: new Date("2026-07-01T00:10:00.000Z"),
      updatedAt: new Date("2026-07-01T00:10:00.000Z")
    });
    await db.insert(projectDriveVersions).values({
      id: limitedDriveVersionId,
      itemId: limitedDriveItemId,
      versionNo: 1,
      filename: "aaa-loaded-current.md",
      mime: "text/markdown",
      sizeBytes: 128,
      storagePath: "drive/r9/aaa-loaded-current.md",
      sha256: "c".repeat(64),
      parsedText: "R9 current accepted limit",
      createdByUserId: seedUser.id,
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-01T00:00:00.000Z")
    });
    await db.insert(projectDriveVersions).values({
      id: limitedWantedDriveVersionId,
      itemId: limitedWantedDriveItemId,
      versionNo: 1,
      filename: "zzz-wanted-current.md",
      mime: "text/markdown",
      sizeBytes: 256,
      storagePath: "drive/r9/zzz-wanted-current.md",
      sha256: "d".repeat(64),
      parsedText: "R9 wanted current accepted limit",
      createdByUserId: seedUser.id,
      createdAt: new Date("2026-07-01T00:10:00.000Z"),
      updatedAt: new Date("2026-07-01T00:10:00.000Z")
    });
    const acceptedLimitBase = {
      workItemId: limitedWorkItemId,
      projectId: limitedProjectId,
      proposalId: limitedProposalId,
      branchId: limitedBranchId,
      targetKind: limitedManifestChange.target_kind,
      targetEntityType: limitedManifestChange.target_ref.entity_type,
      targetEntityId: limitedDriveItemId,
      changeType: limitedManifestChange.change_type,
      acceptedVersion: 1,
      acceptedRef: limitedDriveVersionId,
      driveItemId: limitedDriveItemId,
      driveVersionId: limitedDriveVersionId,
      sha256After: "c".repeat(64),
      previewRefJson: limitedManifestChange.preview_ref,
      manifestChangeJson: limitedManifestChange
    };
    await db.insert(acceptedDeliverableChanges).values({
      ...acceptedLimitBase,
      id: limitedLoadedCurrentAcceptedId,
      changeId: randomUUID(),
      targetPath: "/r9/aaa-loaded-current.md",
      targetKey: "drive:/r9/aaa-loaded-current.md",
      supersededAt: null,
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-01T00:00:00.000Z")
    });
    await db.insert(acceptedDeliverableChanges).values({
      ...acceptedLimitBase,
      id: limitedWantedCurrentAcceptedId,
      changeId: randomUUID(),
      targetEntityId: limitedWantedDriveItemId,
      targetPath: "/r9/zzz-wanted-current.md",
      targetKey: "drive:/r9/zzz-wanted-current.md",
      acceptedRef: limitedWantedDriveVersionId,
      driveItemId: limitedWantedDriveItemId,
      driveVersionId: limitedWantedDriveVersionId,
      sha256After: "d".repeat(64),
      previewRefJson: limitedWantedManifestChange.preview_ref,
      manifestChangeJson: limitedWantedManifestChange,
      supersededAt: null,
      createdAt: new Date("2026-07-01T00:10:00.000Z"),
      updatedAt: new Date("2026-07-01T00:10:00.000Z")
    });
    await db.insert(acceptedDeliverableChanges).values([0, 1, 2].map((index) => ({
      ...acceptedLimitBase,
      id: randomUUID(),
      changeId: randomUUID(),
      targetPath: `/r9/history-${index}.md`,
      targetKey: `drive:/r9/history-${index}.md`,
      supersededAt: new Date(`2026-07-02T00:0${index}:00.000Z`),
      createdAt: new Date(`2026-07-02T00:0${index}:00.000Z`),
      updatedAt: new Date(`2026-07-02T00:0${index}:30.000Z`)
    })));
    const limitedDrivePage = await createDriveRepository(db).readPage({
      projectId: limitedProjectId,
      workspaceId: settings.auth.defaultWorkspaceId,
      limit: 1
    });
    const limitedCurrentIds = limitedDrivePage.acceptedDeliverables
      .filter((row) => row.accepted.supersededAt === null)
      .map((row) => row.accepted.id);
    if (limitedDrivePage.totalAcceptedDeliverableCount !== 2 || !limitedCurrentIds.includes(limitedWantedCurrentAcceptedId)) {
      throw new Error(`Expected readPage(limit=1) to let the current accepted main query pick the newest current row, got ${JSON.stringify({
        totalAcceptedDeliverableCount: limitedDrivePage.totalAcceptedDeliverableCount,
        acceptedIds: limitedDrivePage.acceptedDeliverables.map((row) => ({
          id: row.accepted.id,
          supersededAt: row.accepted.supersededAt?.toISOString() ?? null
        }))
      })}`);
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
      workItems: workItemService,
      proposalAudit: proposalRepository,
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
      acceptedChangeRows,
      driveItemRows,
      driveVersionRows,
      snapshotRows,
      auditRows,
      acceptedRestoreAuditRows,
      driveOperationRows,
      usageRecordRows,
      costLedgerRows
    ] = await Promise.all([
      db.select().from(agentRuns).then((rows) => rows.filter((row) => row.id === runId)),
      restartedQueue.trace(runId),
      db.select().from(proposals).then((rows) => rows.filter((row) => row.workItemId === workItemId)),
      db.select().from(branches).then((rows) => rows.filter((row) => row.workItemId === workItemId)),
      db.select().from(workItems).then((rows) => rows.filter((row) => row.id === workItemId)),
      db.select().from(acceptedDeliverableChanges).then((rows) => rows.filter((row) => row.workItemId === workItemId)),
      db.select().from(projectDriveItems),
      db.select().from(projectDriveVersions),
      db.select().from(snapshots).then((rows) => rows.filter((row) => row.workItemId === workItemId)),
      db.select().from(auditLogs).then((rows) => rows.filter((row) => row.entityId === workItemId)),
      db.select().from(auditLogs).then((rows) =>
        rows.filter((row) => row.action === "accepted_deliverable.reverted")
      ),
      db.select().from(projectDriveOperations).then((rows) =>
        rows.filter((row) => row.payloadJson["work_item_id"] === workItemId)
      ),
      db.select().from(usageRecords).then((rows) => rows.filter((row) => row.runId === runId)),
      db.select().from(costLedgerEntries).then((rows) => rows.filter((row) => row.runId === runId))
    ]);
    const proposalAfterMerge = proposalRows.find((row) => row.id === secondProposal.id) ?? proposalRows[0];
    const branchAfterMerge = branchRows.find((row) => row.id === proposalAfterMerge?.branchId);
    const workItemAfterMerge = workItemRows[0];
    if (proposalAfterMerge?.status !== "merged") {
      throw new Error(`Expected proposal.status merged, got ${proposalAfterMerge?.status ?? "missing"}`);
    }
    const proposalAuditRows = await db.select().from(auditLogs).then((rows) =>
      rows.filter((row) => row.entityId === proposalAfterMerge.id)
    );
    if (branchAfterMerge?.status !== "merged") {
      throw new Error(`Expected branch.status merged, got ${branchAfterMerge?.status ?? "missing"}`);
    }
    if (workItemAfterMerge?.status !== "merged" || workItemAfterMerge.mainBranchId !== proposalAfterMerge.branchId) {
      throw new Error(
        `Expected work item main branch merge, got status=${workItemAfterMerge?.status ?? "missing"} main=${workItemAfterMerge?.mainBranchId ?? "missing"}`
      );
    }
    if (acceptedChangeRows.length < proposalAfterMerge.diffManifest.changes.length) {
      throw new Error(`Expected accepted deliverable changes, got ${acceptedChangeRows.length}`);
    }
    const acceptedDriveVersionIds = new Set(
      acceptedChangeRows.map((row) => row.driveVersionId).filter((id): id is string => !!id)
    );
    if (acceptedDriveVersionIds.size < 1) {
      throw new Error("Expected accepted deliverable changes to point at ProjectDriveVersion rows.");
    }
    const adoptedDriveVersions = driveVersionRows.filter((row) => acceptedDriveVersionIds.has(row.id));
    if (adoptedDriveVersions.length !== acceptedDriveVersionIds.size) {
      throw new Error(`Expected adopted drive versions, got ${adoptedDriveVersions.length}`);
    }
    const currentAcceptedChangeRows = acceptedChangeRows.filter((row) => row.supersededAt === null);
    if (currentAcceptedChangeRows.length !== 1 || currentAcceptedChangeRows[0]?.driveVersionId !== firstDriveVersionId) {
      throw new Error("Expected restore to make the first accepted drive version current again.");
    }
    for (const version of adoptedDriveVersions) {
      const storageStat = await stat(version.storagePath);
      if (!storageStat.isFile() || storageStat.size !== version.sizeBytes) {
        throw new Error(`Expected adopted file at ${version.storagePath}`);
      }
      const content = await readFile(version.storagePath, "utf8");
      if (!content.includes("R1 PG smoke deliverable")) {
        throw new Error("Expected adopted drive file content to match AgentRun output.");
      }
    }
    for (const row of currentAcceptedChangeRows) {
      const version = driveVersionRows.find((candidate) => candidate.id === row.driveVersionId);
      const item = version ? driveItemRows.find((candidate) => candidate.id === version.itemId) : undefined;
      if (!version || !item || item.currentVersionId !== version.id) {
        throw new Error(`Expected current accepted drive version ${row.driveVersionId ?? "missing"} to be the Drive current version.`);
      }
    }
    const mergedWorkItemPage = await app.request(`/api/pages/workitems/${workItemId}`, { headers });
    if (mergedWorkItemPage.status !== 200) {
      throw new Error(`Expected merged work item page 200, got ${mergedWorkItemPage.status}: ${await mergedWorkItemPage.text()}`);
    }
    const mergedWorkItemPageBody = await mergedWorkItemPage.json() as {
      data: {
        accepted_deliverables: {
          id: string;
          filename?: string;
          download_href?: string;
          preview_href?: string;
          drive_version_id?: string;
        }[];
      };
    };
    const acceptedDeliverable = mergedWorkItemPageBody.data.accepted_deliverables[0];
    if (
      !acceptedDeliverable?.download_href
      || !acceptedDeliverable.preview_href
      || acceptedDeliverable.drive_version_id !== firstDriveVersionId
    ) {
      throw new Error("Expected work item page to expose restored accepted deliverable refs.");
    }
    const previewResponse = await app.request(acceptedDeliverable.preview_href, { headers });
    if (previewResponse.status !== 200) {
      throw new Error(`Expected accepted deliverable preview 200, got ${previewResponse.status}: ${await previewResponse.text()}`);
    }
    const previewBody = await previewResponse.json() as { data: { text: string; preview_type: string } };
    if (previewBody.data.preview_type !== "text" || !previewBody.data.text.includes("R1 PG smoke deliverable")) {
      throw new Error("Expected accepted deliverable preview to include AgentRun output text.");
    }
    const downloadResponse = await app.request(acceptedDeliverable.download_href, { headers });
    if (downloadResponse.status !== 200) {
      throw new Error(`Expected accepted deliverable download 200, got ${downloadResponse.status}: ${await downloadResponse.text()}`);
    }
    const downloadedText = await downloadResponse.text();
    if (!downloadedText.includes("R1 PG smoke deliverable")) {
      throw new Error("Expected accepted deliverable download to include AgentRun output text.");
    }
    if (downloadedText.includes("v2")) {
      throw new Error("Expected accepted deliverable download to use the restored first version.");
    }
    if (!proposalAuditRows.some((row) => row.action === "proposal.merged" && row.snapshotId === proposalAfterMerge.mergeSnapshotId)) {
      throw new Error("Expected persistent proposal.merged audit log linked to the merge snapshot.");
    }
    if (
      !acceptedRestoreAuditRows.some((row) =>
        row.detailJson["work_item_id"] === workItemId
        && row.detailJson["to_drive_version_id"] === firstDriveVersionId
      )
    ) {
      throw new Error("Expected accepted_deliverable.reverted audit log for the restored drive version.");
    }
    if (!driveOperationRows.some((row) => row.opType === "restore_version")) {
      throw new Error("Expected ProjectDriveOperation restore_version row.");
    }
    const replay = await replayAfterRestart.json() as {
      data: {
        steps: unknown[];
        snapshots: unknown[];
        audit_logs: unknown[];
        accepted_deliverables: { drive_version_id?: string; download_href?: string; preview_href?: string }[];
      };
    };
    if (
      replay.data.accepted_deliverables.length < 1
      || replay.data.accepted_deliverables[0]?.drive_version_id !== firstDriveVersionId
      || !replay.data.accepted_deliverables[0]?.download_href
    ) {
      throw new Error("Expected restart replay to expose restored accepted deliverables.");
    }

    const oneClickContent = "R1.17 incoming proposal should be fused by one-click AI apply";
    await writeFile(path.join(runWorkdir, "outputs", "result.md"), oneClickContent, "utf8");
    const oneClickSha = sha256Text(oneClickContent);
    const oneClickManifest: typeof proposalBeforeMerge.diffManifest = {
      ...proposalBeforeMerge.diffManifest,
      proposal_id: undefined,
      branch_id: undefined,
      title: "R1.17 PG smoke AI fusion one-click",
      summary_md: "验证冲突卡可以直接采用 AI 融合稿，不需要先选择候选。",
      changes: [
        {
          ...firstChange,
          id: "92000000-0000-4000-8000-000000000301",
          target_kind: "text_doc",
          change_type: "generated",
          target_ref: {
            ...firstChange.target_ref,
            sha256_after: oneClickSha
          },
          human_summary: "同路径生成新版本，触发 R1.17 AI 融合一键采用。"
        }
      ]
    };
    const oneClickProposal = await proposalService.createFromManifest({
      workItemId,
      manifest: oneClickManifest,
      actor: { actor_kind: "ai", label: "R1.17 PG smoke AI" },
      agentRunId: runId
    });
    await proposalService.review({
      proposalId: oneClickProposal.id,
      actor: { actor_kind: "human", actor_user_id: defaultSeedIds.adminUserId },
      decision: "approve"
    });
    const oneClickMergeConflict = await app.request(`/api/proposals/${oneClickProposal.id}/merge`, {
      method: "POST",
      headers,
      body: JSON.stringify({})
    });
    if (oneClickMergeConflict.status !== 409) {
      throw new Error(`Expected one-click AI fusion merge conflict 409, got ${oneClickMergeConflict.status}: ${await oneClickMergeConflict.text()}`);
    }
    const oneClickConflictBody = await oneClickMergeConflict.json() as {
      error: {
        code: string;
        details?: {
          conflicts?: Array<{
            target_key: string;
            merge_proposal_id?: string;
            recommended_option_id?: string;
            options: Array<{
              id: string;
              label?: string;
              action?: {
                id?: string;
                href?: string;
                method?: string;
                request_json?: Record<string, unknown>;
              };
            }>;
          }>;
        };
      };
    };
    const oneClickConflict = oneClickConflictBody.error.details?.conflicts?.[0];
    const oneClickAiOption = oneClickConflict?.options.find((option) => option.id === "ai_fusion");
    const oneClickMergeProposalId = oneClickConflict?.merge_proposal_id;
    if (
      oneClickConflictBody.error.code !== "merge_conflict"
      || !oneClickMergeProposalId
      || oneClickConflict?.recommended_option_id !== "ai_fusion"
      || oneClickAiOption?.label !== "采用 AI 融合稿"
      || oneClickAiOption.action?.id !== "apply_ai_fusion"
      || oneClickAiOption.action.href !== `/api/merge-proposals/${oneClickMergeProposalId}/apply`
      || oneClickAiOption.action.method !== "POST"
      || oneClickAiOption.action.request_json?.confirm !== true
    ) {
      throw new Error(`Expected one-click conflict card to expose apply_ai_fusion action, got ${JSON.stringify(oneClickConflict)}`);
    }
    const listedConflicts = await app.request(`/api/workitems/${workItemId}/conflicts`, { headers });
    if (listedConflicts.status !== 200) {
      throw new Error(`Expected work item conflicts 200, got ${listedConflicts.status}: ${await listedConflicts.text()}`);
    }
    const listedConflictsBody = await listedConflicts.json() as {
      data: {
        conflicts: Array<{
          target_key: string;
          merge_proposal_id?: string;
          recommended_option_id?: string;
          options: Array<{ id: string; action?: { href?: string } }>;
        }>;
      };
    };
    const listedOneClickConflict = listedConflictsBody.data.conflicts.find((conflict) =>
      conflict.merge_proposal_id === oneClickMergeProposalId
    );
    if (
      !listedOneClickConflict
      || listedOneClickConflict.recommended_option_id !== "ai_fusion"
      || listedOneClickConflict.options.find((option) => option.id === "ai_fusion")?.action?.href !== `/api/merge-proposals/${oneClickMergeProposalId}/apply`
    ) {
      throw new Error("Expected GET /workitems/:id/conflicts to mirror the R1.17 one-click apply action.");
    }
    const oneClickApply = await app.request(`/api/merge-proposals/${oneClickMergeProposalId}/apply`, {
      method: "POST",
      headers,
      body: JSON.stringify({ confirm: true })
    });
    if (oneClickApply.status !== 200) {
      throw new Error(`Expected one-click AI fusion apply 200, got ${oneClickApply.status}: ${await oneClickApply.text()}`);
    }
    const oneClickApplyBody = await oneClickApply.json() as {
      data: { status: string; merge_snapshot_id?: string };
    };
    if (oneClickApplyBody.data.status !== "merged" || !oneClickApplyBody.data.merge_snapshot_id) {
      throw new Error("Expected one-click AI fusion apply to merge the proposal with a snapshot.");
    }
    const [
      oneClickMergeProposalRows,
      oneClickAttemptRows,
      oneClickAcceptedRows,
      oneClickDriveVersionRows,
      oneClickAuditRows
    ] = await Promise.all([
      db.select().from(mergeProposals).then((rows) =>
        rows.filter((row) => row.id === oneClickMergeProposalId || row.conflictKey === oneClickConflict.target_key)
      ),
      db.select().from(mergeAttempts).then((rows) => rows.filter((row) => row.proposalId === oneClickProposal.id)),
      db.select().from(acceptedDeliverableChanges).then((rows) =>
        rows.filter((row) => row.proposalId === oneClickProposal.id)
      ),
      db.select().from(projectDriveVersions),
      db.select().from(auditLogs).then((rows) =>
        rows.filter((row) => row.entityId === oneClickProposal.id || row.entityId === workItemId)
      )
    ]);
    const originalOneClickMergeProposal = oneClickMergeProposalRows.find((row) => row.id === oneClickMergeProposalId);
    if (
      originalOneClickMergeProposal?.chosenOptionKey !== "ai_fusion"
      || originalOneClickMergeProposal.chosenByUserId !== defaultSeedIds.adminUserId
      || !originalOneClickMergeProposal.chosenAt
    ) {
      throw new Error("Expected one-click apply to write chosen_* onto the original merge_proposals row.");
    }
    const originalAiFusionCandidate = (Array.isArray(originalOneClickMergeProposal.candidatesJson)
      ? originalOneClickMergeProposal.candidatesJson
      : [])
      .find((candidate) =>
        candidate
        && typeof candidate === "object"
        && (candidate as Record<string, unknown>)["option_key"] === "ai_fusion"
      ) as { quality_gate?: Record<string, unknown> } | undefined;
    const textPatchPreview = originalAiFusionCandidate?.quality_gate?.["text_patch_preview"] as {
      type?: string;
      stats?: { changed?: boolean; overlap_risk?: string };
      hunks?: unknown[];
    } | undefined;
    if (
      textPatchPreview?.type !== "unified_text_patch_preview"
      || textPatchPreview.stats?.changed !== true
      || !Array.isArray(textPatchPreview.hunks)
      || textPatchPreview.hunks.length === 0
    ) {
      throw new Error("Expected original AI fusion candidate to persist an R1.21 text patch preview.");
    }
    if (!oneClickAttemptRows.some((row) => row.result === "conflict") || !oneClickAttemptRows.some((row) => row.result === "merged")) {
      throw new Error("Expected one-click proposal to retain both conflict and merged attempts.");
    }
    const oneClickAccepted = oneClickAcceptedRows.find((row) => row.driveVersionId);
    if (!oneClickAccepted?.driveVersionId || oneClickAccepted.changeType !== "updated") {
      throw new Error("Expected one-click AI fusion apply to create an accepted updated deliverable row.");
    }
    const oneClickDriveVersion = oneClickDriveVersionRows.find((row) => row.id === oneClickAccepted.driveVersionId);
    if (!oneClickDriveVersion) {
      throw new Error("Expected one-click accepted row to point at a ProjectDriveVersion.");
    }
    const oneClickDriveText = await readFile(oneClickDriveVersion.storagePath, "utf8");
    const expectedOneClickFusionText = [
      "# R1.17 one-click AI fusion",
      "",
      "PG smoke fused current accepted content with the incoming proposal.",
      "",
      `Conflict key: ${oneClickConflict.target_key}`
    ].join("\n");
    if (oneClickDriveText !== expectedOneClickFusionText) {
      throw new Error("Expected one-click Drive version to contain the direct AI fusion text writeback.");
    }
    if (/AI 融合正式稿|```json|Merge Proposal ID/u.test(oneClickDriveText)) {
      throw new Error("Expected one-click Drive version to omit the old Markdown wrapper.");
    }
    if (
      !oneClickAuditRows.some((row) =>
        row.action === "proposal.merged"
        && row.detailJson["merge_proposal_id"] === oneClickMergeProposalId
        && row.detailJson["chosen_option_key"] === "ai_fusion"
        && row.detailJson["merge_strategy"] === "ai_resolved"
      )
    ) {
      throw new Error("Expected proposal.merged audit log to carry the R1.17 AI fusion merge proposal id.");
    }
    const replayAfterOneClick = await app.request(`/api/agent-runs/${runId}/replay`, { headers });
    if (replayAfterOneClick.status !== 200) {
      throw new Error(`Expected replay after one-click apply 200, got ${replayAfterOneClick.status}: ${await replayAfterOneClick.text()}`);
    }
    const replayAfterOneClickBody = await replayAfterOneClick.json() as {
      data: {
        accepted_deliverables: { drive_version_id?: string }[];
        merge_timeline?: Array<{
          proposal_id: string;
          decisions: Array<{
            chosen_option_key?: string;
            candidates: Array<{ option_key: string; chosen?: boolean }>;
          }>;
        }>;
      };
    };
    const oneClickTimelines = replayAfterOneClickBody.data.merge_timeline?.filter((attempt) =>
      attempt.proposal_id === oneClickProposal.id
    ) ?? [];
    if (
      !oneClickTimelines.some((attempt) => attempt.decisions.some((decision) =>
        decision.chosen_option_key === "ai_fusion"
        && decision.candidates.some((candidate) => candidate.option_key === "ai_fusion" && candidate.chosen)
      ))
    ) {
      throw new Error("Expected replay timeline to show the chosen AI fusion candidate after one-click apply.");
    }
    if (!replayAfterOneClickBody.data.accepted_deliverables.some((item) => item.drive_version_id === oneClickAccepted.driveVersionId)) {
      throw new Error("Expected replay accepted deliverables to include the one-click AI fusion Drive version.");
    }

    const structuredChangeId = randomUUID();
    const structuredBranchId = randomUUID();
    const structuredManifest: DeliverableChangeManifest = {
      version: 0,
      work_item_id: workItemId,
      branch_id: structuredBranchId,
      title: "R1.29 PG smoke structured field patch",
      summary_md: "验证结构化字段补丁直接写回 WorkItem 标量字段。",
      author: {
        actor_kind: "ai",
        label: "R1.29 PG smoke AI"
      },
      base: {
        snapshot_id: merged.merge_snapshot_id,
        branch_head_ref: oneClickApplyBody.data.merge_snapshot_id,
        created_at: new Date().toISOString()
      },
      changes: [
        {
          id: structuredChangeId,
          target_kind: "structured_record",
          target_ref: {
            entity_type: "work_item",
            entity_id: workItemId
          },
          change_type: "updated",
          human_summary: "更新事项标题、摘要、优先级和截止时间。",
          machine_summary: {
            changed_fields: ["title", "summary_md", "priority", "due_at"]
          }
        }
      ],
      checks: [
        {
          id: "structured-field-patch-ready",
          label: "结构化字段补丁可执行",
          status: "passed"
        }
      ],
      evidence_refs: [],
      risk: {
        level: "medium",
        human_label: "中风险",
        reversible: true
      },
      rollback: {
        available: true,
        description: "可通过审计与字段旧值恢复。"
      },
      review: {
        suggested_decision: "approve",
        reason_required_on_reject: true
      }
    };
    const structuredProposal = await proposalService.createFromManifest({
      workItemId,
      manifest: structuredManifest,
      actor: { actor_kind: "ai", label: "R1.29 PG smoke AI" }
    });
    await proposalService.review({
      proposalId: structuredProposal.id,
      actor: { actor_kind: "human", actor_user_id: defaultSeedIds.adminUserId },
      decision: "approve"
    });
    const structuredMergeAttemptId = randomUUID();
    const structuredMergeProposalId = randomUUID();
    const structuredConflictKey = `work_item:${workItemId}`;
    const structuredConflict = {
      proposal_id: structuredProposal.id,
      work_item_id: workItemId,
      proposal_title: structuredProposal.title,
      target_key: structuredConflictKey,
      change_id: structuredChangeId,
      target_kind: "structured_record" as const,
      change_type: "updated" as const,
      existing_proposal_id: oneClickProposal.id,
      existing_change_id: oneClickAccepted.changeId,
      existing_ref: oneClickApplyBody.data.merge_snapshot_id
    };
    const structuredNow = new Date();
    await db.insert(mergeAttempts).values({
      id: structuredMergeAttemptId,
      proposalId: structuredProposal.id,
      workItemId,
      branchId: structuredProposal.branch_id,
      actorKind: "human",
      actorUserId: defaultSeedIds.adminUserId,
      result: "conflict",
      conflictsJson: [structuredConflict],
      acceptedTargetKeys: [],
      targetKeys: [structuredConflictKey],
      conflictCount: 1,
      createdAt: structuredNow
    });
    await db.insert(mergeProposals).values({
      id: structuredMergeProposalId,
      mergeAttemptId: structuredMergeAttemptId,
      conflictKey: structuredConflictKey,
      candidatesJson: [
        {
          option_key: "ai_fusion",
          target_kind: "structured_record",
          rationale_md: "PG smoke 直接写回 WorkItem 标量字段。",
          source: "llm",
          quality_gate: { status: "passed" },
          merged_value: {
            fields: {
              title: "R1.29 结构化字段写回",
              summary_md: "PG smoke 已确认结构化字段 patch 直接写入 WorkItem。",
              priority: "urgent",
              due_at: "2026-06-30T00:00:00.000Z"
            }
          }
        }
      ],
      recommendedOptionKey: "ai_fusion",
      createdAt: structuredNow,
      updatedAt: structuredNow
    });
    const structuredApply = await proposalService.applyMergeCandidate({
      mergeProposalId: structuredMergeProposalId,
      actor: { actor_kind: "human", actor_user_id: defaultSeedIds.adminUserId }
    });
    if (structuredApply.status !== "merged" || !structuredApply.merge_snapshot_id) {
      throw new Error("Expected structured field patch apply to merge the proposal.");
    }
    const [
      structuredWorkItemRows,
      structuredAcceptedRows,
      structuredAuditRows,
      structuredOriginalMergeProposalRows
    ] = await Promise.all([
      db.select().from(workItems).then((rows) => rows.filter((row) => row.id === workItemId)),
      db.select().from(acceptedDeliverableChanges).then((rows) =>
        rows.filter((row) => row.proposalId === structuredProposal.id)
      ),
      db.select().from(auditLogs).then((rows) =>
        rows.filter((row) => row.entityId === structuredProposal.id && row.action === "proposal.merged")
      ),
      db.select().from(mergeProposals).then((rows) => rows.filter((row) => row.id === structuredMergeProposalId))
    ]);
    const structuredWorkItem = structuredWorkItemRows[0];
    if (
      structuredWorkItem?.title !== "R1.29 结构化字段写回"
      || structuredWorkItem.summaryMd !== "PG smoke 已确认结构化字段 patch 直接写入 WorkItem。"
      || structuredWorkItem.priority !== "urgent"
      || structuredWorkItem.dueAt?.toISOString() !== "2026-06-30T00:00:00.000Z"
    ) {
      throw new Error(`Expected structured field patch to update WorkItem scalars, got ${JSON.stringify(structuredWorkItem)}`);
    }
    if (structuredAcceptedRows.length !== 1) {
      // findings[H14]：结构化记录 AI 融合采纳现在与 merge()/drive-file 分支一致，写一条 accepted_deliverable_changes
      // 台账行（此前漏写导致台账与已改写的 WorkItem 发散）。
      throw new Error(`Expected structured field patch apply to write exactly one accepted deliverable ledger row, got ${structuredAcceptedRows.length}.`);
    }
    if (structuredOriginalMergeProposalRows[0]?.chosenOptionKey !== "ai_fusion") {
      throw new Error("Expected structured field patch apply to mark the original merge proposal chosen.");
    }
    const structuredAudit = structuredAuditRows[0];
    if (
      structuredAudit?.detailJson["merge_strategy"] !== "field_merge"
      || structuredAudit.detailJson["structured_field_count"] !== 4
      || structuredAudit.detailJson["accepted_change_count"] !== 1
      || !Array.isArray(structuredAudit.detailJson["structured_field_changes"])
    ) {
      throw new Error(`Expected structured field patch audit payload, got ${JSON.stringify(structuredAudit?.detailJson)}`);
    }

    const structuredConflictChangeId = randomUUID();
    const structuredConflictBranchId = randomUUID();
    const structuredConflictManifest: DeliverableChangeManifest = {
      version: 0,
      work_item_id: workItemId,
      branch_id: structuredConflictBranchId,
      title: "R1.30 PG smoke structured field conflict",
      summary_md: "验证结构化字段补丁遇到人工并发修改时拒绝静默覆盖。",
      author: {
        actor_kind: "ai",
        label: "R1.30 PG smoke AI"
      },
      base: {
        snapshot_id: structuredApply.merge_snapshot_id,
        branch_head_ref: structuredApply.merge_snapshot_id
      },
      changes: [
        {
          id: structuredConflictChangeId,
          target_kind: "structured_record",
          target_ref: {
            entity_type: "work_item",
            entity_id: workItemId
          },
          change_type: "updated",
          human_summary: "更新事项标题，用于验证字段级三方冲突。",
          machine_summary: {
            changed_fields: ["title"]
          }
        }
      ],
      checks: [
        {
          id: "structured-field-conflict-candidate",
          label: "结构化字段冲突检测候选",
          status: "passed"
        }
      ],
      evidence_refs: [],
      risk: {
        level: "medium",
        human_label: "中风险",
        reversible: true
      },
      rollback: {
        available: true,
        description: "冲突时不写回，当前人工标题保持不变。"
      },
      review: {
        suggested_decision: "approve",
        reason_required_on_reject: true
      }
    };
    const structuredConflictProposal = await proposalService.createFromManifest({
      workItemId,
      manifest: structuredConflictManifest,
      actor: { actor_kind: "ai", label: "R1.30 PG smoke AI" }
    });
    await proposalService.review({
      proposalId: structuredConflictProposal.id,
      actor: { actor_kind: "human", actor_user_id: defaultSeedIds.adminUserId },
      decision: "approve"
    });
    const manualConcurrentTitle = "R1.30 人工并发标题";
    const manuallyUpdatedWorkItem = await workItemRepository.updateWorkItemFromSession({
      workItemId,
      title: manualConcurrentTitle,
      status: structuredWorkItem.status,
      at: new Date()
    });
    if (!manuallyUpdatedWorkItem) {
      throw new Error("Expected manual WorkItem update before structured conflict apply.");
    }
    const structuredConflictMergeAttemptId = randomUUID();
    const structuredConflictMergeProposalId = randomUUID();
    const structuredFieldConflictKey = `work_item:${workItemId}`;
    const structuredConflictContext = {
      proposal_id: structuredConflictProposal.id,
      work_item_id: workItemId,
      proposal_title: structuredConflictProposal.title,
      target_key: structuredFieldConflictKey,
      change_id: structuredConflictChangeId,
      target_kind: "structured_record" as const,
      change_type: "updated" as const,
      existing_proposal_id: structuredProposal.id,
      existing_change_id: structuredChangeId,
      existing_ref: structuredApply.merge_snapshot_id
    };
    const structuredConflictNow = new Date();
    await db.insert(mergeAttempts).values({
      id: structuredConflictMergeAttemptId,
      proposalId: structuredConflictProposal.id,
      workItemId,
      branchId: structuredConflictProposal.branch_id,
      actorKind: "human",
      actorUserId: defaultSeedIds.adminUserId,
      result: "conflict",
      conflictsJson: [structuredConflictContext],
      acceptedTargetKeys: [],
      targetKeys: [structuredFieldConflictKey],
      conflictCount: 1,
      createdAt: structuredConflictNow
    });
    await db.insert(mergeProposals).values({
      id: structuredConflictMergeProposalId,
      mergeAttemptId: structuredConflictMergeAttemptId,
      conflictKey: structuredFieldConflictKey,
      candidatesJson: [
        {
          option_key: "ai_fusion",
          target_kind: "structured_record",
          rationale_md: "PG smoke 应拒绝覆盖人工并发标题。",
          source: "llm",
          quality_gate: { status: "passed" },
          merged_value: {
            fields: {
              title: "R1.30 AI 候选标题"
            }
          }
        }
      ],
      recommendedOptionKey: "ai_fusion",
      createdAt: structuredConflictNow,
      updatedAt: structuredConflictNow
    });
    let structuredConflictErrorCode: string | null = null;
    try {
      await proposalService.applyMergeCandidate({
        mergeProposalId: structuredConflictMergeProposalId,
        actor: { actor_kind: "human", actor_user_id: defaultSeedIds.adminUserId }
      });
    } catch (error) {
      if (error instanceof ProposalServiceError) {
        structuredConflictErrorCode = error.code;
      } else {
        throw error;
      }
    }
    if (structuredConflictErrorCode !== "structured_field_patch_conflict") {
      throw new Error(`Expected structured_field_patch_conflict, got ${structuredConflictErrorCode ?? "no error"}`);
    }
    const [structuredConflictWorkItemRows, structuredConflictProposalRows, structuredConflictMergeProposalRows] = await Promise.all([
      db.select().from(workItems).then((rows) => rows.filter((row) => row.id === workItemId)),
      db.select().from(proposals).then((rows) => rows.filter((row) => row.id === structuredConflictProposal.id)),
      db.select().from(mergeProposals).then((rows) => rows.filter((row) => row.id === structuredConflictMergeProposalId))
    ]);
    const structuredConflictWorkItem = structuredConflictWorkItemRows[0];
    if (structuredConflictWorkItem?.title !== manualConcurrentTitle) {
      throw new Error(`Expected conflicting field patch to leave manual title intact, got ${structuredConflictWorkItem?.title}`);
    }
    if (structuredConflictProposalRows[0]?.status === "merged") {
      throw new Error("Expected conflicting structured field patch proposal to remain unmerged.");
    }
    if (structuredConflictMergeProposalRows[0]?.chosenOptionKey) {
      throw new Error("Expected conflicting structured field patch transaction to roll back chosen option.");
    }

    const structuredAcceptanceBaseId = randomUUID();
    const structuredAcceptanceNewId = randomUUID();
    const structuredAcceptanceNow = new Date();
    await db.insert(workItemAcceptanceItems).values({
      id: structuredAcceptanceBaseId,
      workItemId,
      title: "R1.31 原始验收项",
      description: null,
      status: "open",
      sortOrder: 0,
      sourcePlanId: null,
      createdAt: structuredAcceptanceNow,
      updatedAt: structuredAcceptanceNow
    });
    const structuredAcceptanceChangeId = randomUUID();
    const structuredAcceptanceBranchId = randomUUID();
    const structuredAcceptanceManifest: DeliverableChangeManifest = {
      version: 0,
      work_item_id: workItemId,
      branch_id: structuredAcceptanceBranchId,
      title: "R1.31 PG smoke acceptance item patch",
      summary_md: "验证 acceptance_items 子记录可执行合并。",
      author: {
        actor_kind: "ai",
        label: "R1.31 PG smoke AI"
      },
      base: {
        snapshot_id: structuredApply.merge_snapshot_id,
        branch_head_ref: structuredApply.merge_snapshot_id,
        created_at: new Date().toISOString()
      },
      changes: [
        {
          id: structuredAcceptanceChangeId,
          target_kind: "structured_record",
          target_ref: {
            entity_type: "work_item",
            entity_id: workItemId
          },
          change_type: "updated",
          human_summary: "更新事项验收项子记录。",
          machine_summary: {
            changed_fields: ["acceptance_items"]
          }
        }
      ],
      checks: [
        {
          id: "structured-acceptance-items-ready",
          label: "验收项子记录补丁可执行",
          status: "passed"
        }
      ],
      evidence_refs: [],
      risk: {
        level: "medium",
        human_label: "中风险",
        reversible: true
      },
      rollback: {
        available: true,
        description: "可通过审计中的 base/current/incoming 验证恢复。"
      },
      review: {
        suggested_decision: "approve",
        reason_required_on_reject: true
      }
    };
    const structuredAcceptanceProposal = await proposalService.createFromManifest({
      workItemId,
      manifest: structuredAcceptanceManifest,
      actor: { actor_kind: "ai", label: "R1.31 PG smoke AI" }
    });
    await proposalService.review({
      proposalId: structuredAcceptanceProposal.id,
      actor: { actor_kind: "human", actor_user_id: defaultSeedIds.adminUserId },
      decision: "approve"
    });
    const structuredAcceptanceMergeAttemptId = randomUUID();
    const structuredAcceptanceMergeProposalId = randomUUID();
    const structuredAcceptanceConflictKey = `work_item:${workItemId}`;
    const structuredAcceptanceContext = {
      proposal_id: structuredAcceptanceProposal.id,
      work_item_id: workItemId,
      proposal_title: structuredAcceptanceProposal.title,
      target_key: structuredAcceptanceConflictKey,
      change_id: structuredAcceptanceChangeId,
      target_kind: "structured_record" as const,
      change_type: "updated" as const,
      existing_proposal_id: structuredProposal.id,
      existing_change_id: structuredChangeId,
      existing_ref: structuredApply.merge_snapshot_id
    };
    await db.insert(mergeAttempts).values({
      id: structuredAcceptanceMergeAttemptId,
      proposalId: structuredAcceptanceProposal.id,
      workItemId,
      branchId: structuredAcceptanceProposal.branch_id,
      actorKind: "human",
      actorUserId: defaultSeedIds.adminUserId,
      result: "conflict",
      conflictsJson: [structuredAcceptanceContext],
      acceptedTargetKeys: [],
      targetKeys: [structuredAcceptanceConflictKey],
      conflictCount: 1,
      createdAt: structuredAcceptanceNow
    });
    await db.insert(mergeProposals).values({
      id: structuredAcceptanceMergeProposalId,
      mergeAttemptId: structuredAcceptanceMergeAttemptId,
      conflictKey: structuredAcceptanceConflictKey,
      candidatesJson: [
        {
          option_key: "ai_fusion",
          target_kind: "structured_record",
          rationale_md: "PG smoke 直接写回 WorkItem 验收项子记录。",
          source: "llm",
          quality_gate: { status: "passed" },
          merged_value: {
            fields: {
              acceptance_items: [
                {
                  id: structuredAcceptanceBaseId,
                  title: "R1.31 原始验收项",
                  description: null,
                  status: "met",
                  sort_order: 0,
                  source_plan_id: null
                },
                {
                  id: structuredAcceptanceNewId,
                  title: "R1.31 新增验收项",
                  description: "子记录合并需要保留稳定 id。",
                  status: "open",
                  sort_order: 1,
                  source_plan_id: null
                }
              ]
            }
          }
        }
      ],
      recommendedOptionKey: "ai_fusion",
      createdAt: structuredAcceptanceNow,
      updatedAt: structuredAcceptanceNow
    });
    const structuredAcceptanceApply = await proposalService.applyMergeCandidate({
      mergeProposalId: structuredAcceptanceMergeProposalId,
      actor: { actor_kind: "human", actor_user_id: defaultSeedIds.adminUserId }
    });
    if (structuredAcceptanceApply.status !== "merged" || !structuredAcceptanceApply.merge_snapshot_id) {
      throw new Error("Expected acceptance item patch apply to merge the proposal.");
    }
    const [
      structuredAcceptanceRows,
      structuredAcceptanceAcceptedRows,
      structuredAcceptanceAuditRows,
      structuredAcceptanceOriginalMergeProposalRows
    ] = await Promise.all([
      db.select().from(workItemAcceptanceItems).then((rows) =>
        rows
          .filter((row) => row.workItemId === workItemId)
          .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))
      ),
      db.select().from(acceptedDeliverableChanges).then((rows) =>
        rows.filter((row) => row.proposalId === structuredAcceptanceProposal.id)
      ),
      db.select().from(auditLogs).then((rows) =>
        rows.filter((row) => row.entityId === structuredAcceptanceProposal.id && row.action === "proposal.merged")
      ),
      db.select().from(mergeProposals).then((rows) => rows.filter((row) => row.id === structuredAcceptanceMergeProposalId))
    ]);
    if (
      structuredAcceptanceRows.length !== 2
      || structuredAcceptanceRows[0]?.id !== structuredAcceptanceBaseId
      || structuredAcceptanceRows[0].status !== "met"
      || structuredAcceptanceRows[1]?.id !== structuredAcceptanceNewId
      || structuredAcceptanceRows[1].title !== "R1.31 新增验收项"
    ) {
      throw new Error(`Expected acceptance item patch to replace subrecords, got ${JSON.stringify(structuredAcceptanceRows)}`);
    }
    if (structuredAcceptanceAcceptedRows.length !== 1) {
      // findings[H14]：见上——结构化采纳一律写一条台账行。
      throw new Error(`Expected acceptance item patch apply to write exactly one accepted deliverable ledger row, got ${structuredAcceptanceAcceptedRows.length}.`);
    }
    if (structuredAcceptanceOriginalMergeProposalRows[0]?.chosenOptionKey !== "ai_fusion") {
      throw new Error("Expected acceptance item patch apply to mark the original merge proposal chosen.");
    }
    const structuredAcceptanceAudit = structuredAcceptanceAuditRows[0];
    const structuredAcceptanceChanges = structuredAcceptanceAudit?.detailJson["structured_field_changes"];
    if (
      structuredAcceptanceAudit?.detailJson["merge_strategy"] !== "field_merge"
      || structuredAcceptanceAudit.detailJson["structured_field_count"] !== 1
      || structuredAcceptanceAudit.detailJson["accepted_change_count"] !== 1
      || !Array.isArray(structuredAcceptanceChanges)
      || structuredAcceptanceChanges[0]?.field !== "acceptance_items"
      || structuredAcceptanceChanges[0]?.itemCount !== 2
    ) {
      throw new Error(
        `Expected acceptance item patch audit payload, got ${JSON.stringify(structuredAcceptanceAudit?.detailJson)}`
      );
    }

    const structuredTaskPlanId = randomUUID();
    const structuredTaskBaseId = randomUUID();
    const structuredTaskNewId = randomUUID();
    const structuredTaskNow = new Date();
    await db.insert(workItemTaskPlans).values({
      id: structuredTaskPlanId,
      workItemId,
      stage: "dispatch",
      status: "draft",
      summary: "R1.32 task base",
      createdByUserId: defaultSeedIds.adminUserId,
      createdAt: structuredTaskNow,
      updatedAt: structuredTaskNow
    });
    await db.insert(workItemTaskItems).values({
      id: structuredTaskBaseId,
      planId: structuredTaskPlanId,
      title: "R1.32 原始任务项",
      description: null,
      itemType: "task",
      suggestedUserId: null,
      estimateHours: 1,
      sortOrder: 0,
      createdAt: structuredTaskNow,
      updatedAt: structuredTaskNow
    });
    const structuredTaskChangeId = randomUUID();
    const structuredTaskBranchId = randomUUID();
    const structuredTaskManifest: DeliverableChangeManifest = {
      version: 0,
      work_item_id: workItemId,
      branch_id: structuredTaskBranchId,
      title: "R1.32 PG smoke task item patch",
      summary_md: "验证 task_items 子记录可执行合并到 dispatch plan。",
      author: {
        actor_kind: "ai",
        label: "R1.32 PG smoke AI"
      },
      base: {
        snapshot_id: structuredAcceptanceApply.merge_snapshot_id,
        branch_head_ref: structuredAcceptanceApply.merge_snapshot_id,
        created_at: new Date().toISOString()
      },
      changes: [
        {
          id: structuredTaskChangeId,
          target_kind: "structured_record",
          target_ref: {
            entity_type: "work_item",
            entity_id: workItemId
          },
          change_type: "updated",
          human_summary: "更新事项任务项子记录。",
          machine_summary: {
            changed_fields: ["task_items"]
          }
        }
      ],
      checks: [
        {
          id: "structured-task-items-ready",
          label: "任务项子记录补丁可执行",
          status: "passed"
        }
      ],
      evidence_refs: [],
      risk: {
        level: "medium",
        human_label: "中风险",
        reversible: true
      },
      rollback: {
        available: true,
        description: "可通过审计中的 base/current/incoming 验证恢复。"
      },
      review: {
        suggested_decision: "approve",
        reason_required_on_reject: true
      }
    };
    const structuredTaskProposal = await proposalService.createFromManifest({
      workItemId,
      manifest: structuredTaskManifest,
      actor: { actor_kind: "ai", label: "R1.32 PG smoke AI" }
    });
    await proposalService.review({
      proposalId: structuredTaskProposal.id,
      actor: { actor_kind: "human", actor_user_id: defaultSeedIds.adminUserId },
      decision: "approve"
    });
    const structuredTaskMergeAttemptId = randomUUID();
    const structuredTaskMergeProposalId = randomUUID();
    const structuredTaskConflictKey = `work_item:${workItemId}`;
    const structuredTaskContext = {
      proposal_id: structuredTaskProposal.id,
      work_item_id: workItemId,
      proposal_title: structuredTaskProposal.title,
      target_key: structuredTaskConflictKey,
      change_id: structuredTaskChangeId,
      target_kind: "structured_record" as const,
      change_type: "updated" as const,
      existing_proposal_id: structuredAcceptanceProposal.id,
      existing_change_id: structuredAcceptanceChangeId,
      existing_ref: structuredAcceptanceApply.merge_snapshot_id
    };
    await db.insert(mergeAttempts).values({
      id: structuredTaskMergeAttemptId,
      proposalId: structuredTaskProposal.id,
      workItemId,
      branchId: structuredTaskProposal.branch_id,
      actorKind: "human",
      actorUserId: defaultSeedIds.adminUserId,
      result: "conflict",
      conflictsJson: [structuredTaskContext],
      acceptedTargetKeys: [],
      targetKeys: [structuredTaskConflictKey],
      conflictCount: 1,
      createdAt: structuredTaskNow
    });
    await db.insert(mergeProposals).values({
      id: structuredTaskMergeProposalId,
      mergeAttemptId: structuredTaskMergeAttemptId,
      conflictKey: structuredTaskConflictKey,
      candidatesJson: [
        {
          option_key: "ai_fusion",
          target_kind: "structured_record",
          rationale_md: "PG smoke 直接写回 dispatch plan 任务项子记录。",
          source: "llm",
          quality_gate: { status: "passed" },
          merged_value: {
            fields: {
              task_items: [
                {
                  id: structuredTaskBaseId,
                  title: "R1.32 原始任务项",
                  description: null,
                  item_type: "task",
                  suggested_user_id: null,
                  estimate_hours: 2,
                  sort_order: 0
                },
                {
                  id: structuredTaskNewId,
                  title: "R1.32 新增风险核对",
                  description: "任务项合并需要保留稳定 id 并支持风险项。",
                  item_type: "risk",
                  suggested_user_id: null,
                  estimate_hours: null,
                  sort_order: 1
                }
              ]
            }
          }
        }
      ],
      recommendedOptionKey: "ai_fusion",
      createdAt: structuredTaskNow,
      updatedAt: structuredTaskNow
    });
    const structuredTaskApply = await proposalService.applyMergeCandidate({
      mergeProposalId: structuredTaskMergeProposalId,
      actor: { actor_kind: "human", actor_user_id: defaultSeedIds.adminUserId }
    });
    if (structuredTaskApply.status !== "merged" || !structuredTaskApply.merge_snapshot_id) {
      throw new Error("Expected task item patch apply to merge the proposal.");
    }
    const [
      structuredTaskRows,
      structuredTaskAcceptedRows,
      structuredTaskAuditRows,
      structuredTaskOriginalMergeProposalRows
    ] = await Promise.all([
      db.select().from(workItemTaskItems).then((rows) =>
        rows
          .filter((row) => row.planId === structuredTaskPlanId)
          .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))
      ),
      db.select().from(acceptedDeliverableChanges).then((rows) =>
        rows.filter((row) => row.proposalId === structuredTaskProposal.id)
      ),
      db.select().from(auditLogs).then((rows) =>
        rows.filter((row) => row.entityId === structuredTaskProposal.id && row.action === "proposal.merged")
      ),
      db.select().from(mergeProposals).then((rows) => rows.filter((row) => row.id === structuredTaskMergeProposalId))
    ]);
    if (
      structuredTaskRows.length !== 2
      || structuredTaskRows[0]?.id !== structuredTaskBaseId
      || structuredTaskRows[0].estimateHours !== 2
      || structuredTaskRows[1]?.id !== structuredTaskNewId
      || structuredTaskRows[1].itemType !== "risk"
    ) {
      throw new Error(`Expected task item patch to replace dispatch plan subrecords, got ${JSON.stringify(structuredTaskRows)}`);
    }
    if (structuredTaskAcceptedRows.length !== 1) {
      // findings[H14]：见上——结构化采纳一律写一条台账行。
      throw new Error(`Expected task item patch apply to write exactly one accepted deliverable ledger row, got ${structuredTaskAcceptedRows.length}.`);
    }
    if (structuredTaskOriginalMergeProposalRows[0]?.chosenOptionKey !== "ai_fusion") {
      throw new Error("Expected task item patch apply to mark the original merge proposal chosen.");
    }
    const structuredTaskAudit = structuredTaskAuditRows[0];
    const structuredTaskChanges = structuredTaskAudit?.detailJson["structured_field_changes"];
    if (
      structuredTaskAudit?.detailJson["merge_strategy"] !== "field_merge"
      || structuredTaskAudit.detailJson["structured_field_count"] !== 1
      || structuredTaskAudit.detailJson["accepted_change_count"] !== 1
      || !Array.isArray(structuredTaskChanges)
      || structuredTaskChanges[0]?.field !== "task_items"
      || structuredTaskChanges[0]?.itemCount !== 2
    ) {
      throw new Error(
        `Expected task item patch audit payload, got ${JSON.stringify(structuredTaskAudit?.detailJson)}`
      );
    }

    // R2 原子预算：真 PG 并发 deny 门。把 team/day cap 压到一个 run 的额度，两个不同 work-item 在同团队
    // 并发入队 → reserve 的 advisory 锁 + 锁内读 outstanding 串行化 → 恰一个成功、另一个 402（decideBudget
    // 本身都放行，TOCTOU 由预留挡住）。自包含：用自己的 work-item + 队列，结束后还原 team/day cap。
    const teamDayOriginal = policyListBeforeBody.data.find((policy) => policy.id === "pcost-team-day-v0");
    if (!teamDayOriginal) {
      throw new Error("Expected pcost-team-day-v0 policy to exist for reservation concurrency gate.");
    }
    const reserveCapTokens = settings.budgets.runTokens;
    // max_cost_cny 用 numeric(12,6) 上限内的大值（999999，>> 任何 run 成本，使 cost 维不绑定，由 tokens 决定）。
    const teamDayCapOverride = await app.request("/api/cost/policies/team/pcost-team-day-v0", {
      method: "PUT",
      headers,
      body: JSON.stringify({ max_tokens: reserveCapTokens, max_cost_cny: "999999", on_warning: "notify" })
    });
    if (teamDayCapOverride.status !== 200) {
      throw new Error(`Expected team/day reservation-cap override 200, got ${teamDayCapOverride.status}: ${await teamDayCapOverride.text()}`);
    }
    const reservationRepoForGate = createBudgetReservationRepository(db);
    const reserveQueueOptions = {
      settings,
      persistence,
      policyStore,
      ledgerStore,
      reservationRepo: reservationRepoForGate,
      confidence: false,
      humanReserved: false,
      proposals: false,
      notifications: false,
      eventBus: false
    } satisfies Parameters<typeof createInMemoryAgentRunQueue>[0];
    const reserveWorkItemIds = [randomUUID(), randomUUID()] as const;
    for (const [index, id] of reserveWorkItemIds.entries()) {
      await db.insert(workItems).values({
        id,
        code: `RES-${Date.now().toString(36)}-${index}-${randomUUID().slice(0, 6)}`,
        projectId: defaultSeedIds.projectId,
        workspaceId: settings.auth.defaultWorkspaceId,
        submitterUserId: seedUser.id,
        title: `Budget reservation concurrency ${index}`,
        rawDescription: "Atomic budget reservation concurrency gate.",
        summaryMd: "Reservation concurrency smoke.",
        status: "spec_ready",
        mode: "worker"
      });
    }
    const reserveQueueA: AgentRunQueue = createInMemoryAgentRunQueue(reserveQueueOptions);
    const reserveQueueB: AgentRunQueue = createInMemoryAgentRunQueue(reserveQueueOptions);
    const reserveResults = await Promise.allSettled([
      reserveQueueA.enqueue({ workItemId: reserveWorkItemIds[0], actorId: seedUser.id, title: "Budget reserve A" }),
      reserveQueueB.enqueue({ workItemId: reserveWorkItemIds[1], actorId: seedUser.id, title: "Budget reserve B" })
    ]);
    const reserveFulfilled = reserveResults.filter((result) => result.status === "fulfilled");
    const reserveRejected = reserveResults.find((result): result is PromiseRejectedResult => result.status === "rejected");
    const reserveRejectedReason = reserveRejected?.reason as { status?: unknown; code?: unknown } | undefined;
    const winnerRunId = reserveFulfilled[0]?.status === "fulfilled" ? reserveFulfilled[0].value.run_id : undefined;
    const winnerActiveReservations = winnerRunId
      ? await db.select().from(budgetReservations).then((rows) =>
          rows.filter((row) => row.runId === winnerRunId && row.status === "active")
        )
      : [];
    if (
      reserveFulfilled.length !== 1
      || !reserveRejected
      || reserveRejectedReason?.status !== 402
      || reserveRejectedReason.code !== "budget_exhausted"
      || winnerActiveReservations.length === 0
    ) {
      throw new Error(`Expected exactly one concurrent enqueue to win the team/day budget reservation, got ${JSON.stringify({
        fulfilled: reserveFulfilled.length,
        rejected: Boolean(reserveRejected),
        rejectedStatus: reserveRejectedReason?.status,
        rejectedCode: reserveRejectedReason?.code,
        winnerActiveReservations: winnerActiveReservations.length
      })}`);
    }

    // R2 原子预算 — 崩溃释放：用一个远未来的 "now" 调 releaseExpired，模拟胜者租约过期被回收 → 归还其持有 →
    // 之前被 402 堵掉的那个 work-item（其 run 已被补偿失败、无 active run）现在能新入队成功，证明额度被正确释放。
    // （此刻只有胜者一条 active 预留，远未来 now 只会释放它，不会误伤别的。）
    const rejectedIndex = reserveResults.findIndex((result) => result.status === "rejected");
    const loserWorkItemId = rejectedIndex === 0 ? reserveWorkItemIds[0] : reserveWorkItemIds[1];
    const loserQueue = rejectedIndex === 0 ? reserveQueueA : reserveQueueB;
    const releasedHolds = await reservationRepoForGate.releaseExpired(new Date(Date.now() + 24 * 60 * 60 * 1000));
    if (releasedHolds < 1) {
      throw new Error(`Expected releaseExpired to free the crashed winner's reservation, got ${releasedHolds}`);
    }
    const reReserve = await loserQueue.enqueue({
      workItemId: loserWorkItemId,
      actorId: seedUser.id,
      title: "Budget reserve retry after crash-release"
    });
    if (!reReserve.run_id) {
      throw new Error("Expected enqueue to succeed after the crashed reservation hold was released.");
    }

    // 还原 team/day cap，避免影响本 smoke 后续/重跑。
    const teamDayRestore = await app.request("/api/cost/policies/team/pcost-team-day-v0", {
      method: "PUT",
      headers,
      body: JSON.stringify({ max_tokens: teamDayOriginal.max_tokens, max_cost_cny: teamDayOriginal.max_cost_cny, on_warning: "notify" })
    });
    if (teamDayRestore.status !== 200) {
      throw new Error(`Expected team/day reservation-cap restore 200, got ${teamDayRestore.status}: ${await teamDayRestore.text()}`);
    }

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
      r2_multi_worker_enqueue: {
        work_item_id: r2ConcurrentWorkItemId,
        fulfilled: r2Fulfilled.length,
        rejected: r2Rejected ? 1 : 0,
        rejected_status: r2RejectedReason?.status,
        rejected_code: r2RejectedReason?.code,
        agent_runs: r2AgentRunRows.length,
        active_agent_runs: r2ActiveAgentRunRows.length
      },
      db_rows: {
        agent_runs: agentRunRows.length,
        agent_steps: stepRows.length,
        proposals: proposalRows.length,
        branches: branchRows.length,
        accepted_deliverable_changes: acceptedChangeRows.length,
        adopted_drive_items: driveItemRows.filter((row) =>
          adoptedDriveVersions.some((version) => version.itemId === row.id)
        ).length,
        adopted_drive_versions: adoptedDriveVersions.length,
        project_drive_operations: driveOperationRows.length,
        snapshots: snapshotRows.length,
        audit_logs: auditRows.length,
        accepted_restore_audit_logs: acceptedRestoreAuditRows.length,
        proposal_merge_audit_logs: proposalAuditRows.length,
        budget_policies: budgetPolicyRows.length,
        budget_policy_audit_logs: budgetPolicyAuditRows.length,
        usage_records: usageRecordRows.length,
        cost_ledger_entries: costLedgerRows.length
      },
      cost: {
        usage_me_token_in: costUsageBody.data.me.token_in,
        usage_team_token_in: costUsageBody.data.team?.token_in,
        page_total_cost_cny: costPageBody.data.total_cost_cny,
        page_token_in: costPageBody.data.token_in,
        usage_me_token_delta: userTokenDelta,
        usage_team_token_delta: teamTokenDelta,
        page_cost_cny_delta: pageCostDelta.toFixed(3),
        page_token_delta: pageTokenDelta,
        user_policy_version: policyUpdateBody.data.version,
        user_policy_max_tokens: costUsageBeforeBody.data.me.max_tokens
      },
      escalation: {
        work_item_id: escalationWorkItemId,
        event_id: escalationEventId,
        attention_card_kind: escalationCard.kind,
        resolve_status: escalationResolveBody.data.work_item_status,
        persisted_status: resolvedEscalationWorkItem?.status,
        resolved_at_present: Boolean(resolvedEscalationEvent?.resolvedAt)
      },
      task_plan: {
        work_item_id: taskPlanWorkItemId,
        work_item_status: taskPlanWorkItemAfterMerge.status,
        plan_id: taskPlanCreateBody.data.plan_id,
        proposal_id: taskPlanCreateBody.data.proposal_id,
        proposal_title: taskPlanCreateBody.data.proposal.title,
        proposal_item_count: taskPlanProposalItems.length,
        status: taskPlanRow.status,
        item_count: taskPlanItemRows.length,
        page_status: taskPlanPagePlan.status,
        page_item_count: taskPlanPagePlan.items.length,
        agent_team_status: taskPlanPageAgentTeam.status,
        agent_team_completed: taskPlanPageAgentTeam.completed_count,
        agent_team_total: taskPlanPageAgentTeam.total_count,
        child_replay_run_ids: childReplayRunIds
      },
      merge: {
        proposal_status: proposalAfterMerge.status,
        branch_status: branchAfterMerge?.status,
        work_item_status: workItemAfterMerge.status,
        main_branch_id: workItemAfterMerge.mainBranchId,
        merge_snapshot_id: proposalAfterMerge.mergeSnapshotId,
        accepted_targets: acceptedChangeRows.map((row) => row.targetKey),
        accepted_drive_version_ids: [...acceptedDriveVersionIds],
        current_accepted_drive_version_ids: currentAcceptedChangeRows.map((row) => row.driveVersionId),
        accepted_deliverables_on_page: mergedWorkItemPageBody.data.accepted_deliverables.length,
        preview_status: previewResponse.status,
        download_status: downloadResponse.status,
        restore_status: restoreResponse.status,
        restored_drive_version_id: restoreBody.data.accepted_deliverable.drive_version_id
      },
      one_click_ai_fusion: {
        proposal_id: oneClickProposal.id,
        merge_proposal_id: oneClickMergeProposalId,
        conflict_status: oneClickMergeConflict.status,
        apply_status: oneClickApply.status,
        original_row_chosen_option: originalOneClickMergeProposal.chosenOptionKey,
        text_patch_preview: textPatchPreview.type,
        accepted_drive_version_id: oneClickAccepted.driveVersionId,
        replay_timeline_count: oneClickTimelines.length
      },
      structured_field_patch: {
        proposal_id: structuredProposal.id,
        merge_proposal_id: structuredMergeProposalId,
        apply_status: structuredApply.status,
        merge_strategy: structuredAudit.detailJson["merge_strategy"],
        field_count: structuredAudit.detailJson["structured_field_count"],
        accepted_change_count: structuredAudit.detailJson["accepted_change_count"],
        title: structuredWorkItem.title,
        priority: structuredWorkItem.priority,
        due_at: structuredWorkItem.dueAt?.toISOString()
      },
      structured_field_conflict: {
        proposal_id: structuredConflictProposal.id,
        merge_proposal_id: structuredConflictMergeProposalId,
        error_code: structuredConflictErrorCode,
        title_after_reject: structuredConflictWorkItem.title,
        proposal_status: structuredConflictProposalRows[0]?.status,
        chosen_option_key: structuredConflictMergeProposalRows[0]?.chosenOptionKey ?? null
      },
      structured_acceptance_items_patch: {
        proposal_id: structuredAcceptanceProposal.id,
        merge_proposal_id: structuredAcceptanceMergeProposalId,
        apply_status: structuredAcceptanceApply.status,
        merge_strategy: structuredAcceptanceAudit.detailJson["merge_strategy"],
        field_count: structuredAcceptanceAudit.detailJson["structured_field_count"],
        item_count: structuredAcceptanceRows.length,
        first_status: structuredAcceptanceRows[0]?.status,
        second_title: structuredAcceptanceRows[1]?.title
      },
      structured_task_items_patch: {
        proposal_id: structuredTaskProposal.id,
        merge_proposal_id: structuredTaskMergeProposalId,
        apply_status: structuredTaskApply.status,
        merge_strategy: structuredTaskAudit.detailJson["merge_strategy"],
        field_count: structuredTaskAudit.detailJson["structured_field_count"],
        item_count: structuredTaskRows.length,
        first_estimate_hours: structuredTaskRows[0]?.estimateHours,
        second_type: structuredTaskRows[1]?.itemType
      },
      replay_steps: replay.data.steps.length,
      replay_snapshots: replay.data.snapshots.length,
      replay_audit_logs: replay.data.audit_logs.length,
      replay_accepted_deliverables: replayAfterOneClickBody.data.accepted_deliverables.length,
      workdir_ref: await restartedQueue.workdir(runId)
    };
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await client.close();
  }
}

await main();
