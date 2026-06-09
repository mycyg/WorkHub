import { createHash } from "node:crypto";
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
  costLedgerEntries,
  createAgentRunRepository,
  createAuditLogRepository,
  createClientDeviceRepository,
  createDatabaseClient,
  createDbBudgetPolicyStore,
  createDbCostLedgerStore,
  createProposalRepository,
  createWorkItemRepository,
  createSnapshotRepository,
  createUserRepository,
  defaultSeedFixture,
  defaultSeedIds,
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
import { createProposalRoutes, createWorkItemProposalRoutes } from "../routes/proposals.js";
import { createSessionRoutes } from "../routes/sessions.js";
import { createWorkItemRoutes } from "../routes/workitems.js";
import type { MergeFusionCandidateGenerator } from "../services/merge-fusion-candidates.js";
import { createDbAgentRunPersistence } from "../services/agent-run-persistence.js";
import { createDbProposalService } from "../services/proposals.js";
import { createDbWorkItemService } from "../services/work-items.js";
import { createInMemoryAgentRunQueue } from "../workers/agent-runner.js";

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
    const formalStorageRoot = await mkdtemp(path.join(os.tmpdir(), "workhub-r1-pg-drive-"));
    const proposalRepository = createProposalRepository(db);
    const proposalService = createDbProposalService(proposalRepository, {
      storageRoot: formalStorageRoot,
      fusionCandidateGenerator: deterministicFusionGenerator()
    });
    const workItemService = createDbWorkItemService(createWorkItemRepository(db));
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
    const app = withErrors(new Hono<AuthEnv>());
    app.route("/api", createSessionRoutes({ auth, workItems: workItemService }));
    app.route("/api", createWorkItemRoutes({ auth, workItems: workItemService }));
    app.route("/api/proposals", createProposalRoutes({ auth, proposals: proposalService }));
    app.route("/api", createWorkItemProposalRoutes({ auth, proposals: proposalService }));
    app.route("/api/knowledge", createKnowledgeRoutes({ auth, workItems: workItemService }));
    app.route("/api/pages", createPageRoutes({
      auth,
      queue,
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
    const policyListBefore = await app.request("/api/cost/policies", { headers });
    if (policyListBefore.status !== 200) {
      throw new Error(`Expected cost policy list 200, got ${policyListBefore.status}: ${await policyListBefore.text()}`);
    }
    const policyListBeforeBody = await policyListBefore.json() as {
      data: { id: string; scope_kind: string; max_tokens: number; max_cost_cny: string; version: number }[];
    };
    if (policyListBeforeBody.data.length !== 4) {
      throw new Error(`Expected 4 default P-COST policies, got ${policyListBeforeBody.data.length}`);
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
    const [budgetPolicyRows, budgetPolicyAuditRows] = await Promise.all([
      db.select().from(budgetPolicies).then((rows) => rows.filter((row) => row.id === "pcost-user-day-v0")),
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
