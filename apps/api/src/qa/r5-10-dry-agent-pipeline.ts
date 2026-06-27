import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { LlmCreateParams, LlmCreateResponse, LlmStream, LlmTransport, TransportFactory } from "@workhub/agent/providers";
import { loadSettings, type LlmProviderConfig } from "@workhub/config";
import {
  acceptedDeliverableChanges,
  agentRuns,
  auditLogs,
  confidenceRecords,
  costLedgerEntries,
  createAgentRunRepository,
  createAiDecisionRepository,
  createAuditLogRepository,
  createClientDeviceRepository,
  createDatabaseClient,
  createDbBudgetPolicyStore,
  createDbCostLedgerStore,
  createProposalRepository,
  createSnapshotRepository,
  createUserRepository,
  createWorkItemRepository,
  defaultSeedFixture,
  defaultSeedIds,
  orgs,
  proposals,
  projects,
  projectDriveVersions,
  runMigrations,
  snapshots,
  usageRecords,
  users,
  workItems,
  workspaces
} from "@workhub/db";
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
import { createAgentRunConfidenceRecorder } from "../services/agent-run-confidence.js";
import { createDbAgentRunPersistence } from "../services/agent-run-persistence.js";
import { createApiProviderRegistry } from "../services/provider-registry.js";
import { createDbProposalService } from "../services/proposals.js";
import { createDbWorkItemService } from "../services/work-items.js";
import { createInMemoryAgentRunQueue } from "../workers/agent-runner.js";

type RestEvidence = {
  method: string;
  path: string;
  status: number;
  response_bytes: number;
};

type FakeProviderCall = {
  via: "create" | "stream";
  source: string;
  model: string;
  max_tokens: number;
  content_blocks: number;
};

function sha256Buffer(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Text(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function numericDelta(after: string | number, before: string | number) {
  return Number(after) - Number(before);
}

function formatDelta(value: number) {
  return value.toFixed(6).replace(/0+$/u, "").replace(/\.$/u, "") || "0";
}

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
}

function responseStream(response: LlmCreateResponse): LlmStream {
  return {
    async *[Symbol.asyncIterator]() {
      yield {
        type: "message_delta",
        data: {
          delta: {
            text: response.id
          }
        }
      };
    },
    async getFinalMessage() {
      return response;
    }
  };
}

function deterministicTransportFactory(calls: FakeProviderCall[]): TransportFactory {
  const responses: LlmCreateResponse[] = [
    {
      id: "r5-10-dry-step-write-file",
      stopReason: "tool_use",
      usage: { inputTokens: 120, outputTokens: 45 },
      content: [
        {
          type: "tool_use",
          id: "tool-r5-10-dry-write-file",
          name: "write_file",
          input: {
            path: "outputs/r5-10-dry-weekly-report.md",
            content: [
              "# R5.10 Dry Weekly Report",
              "",
              "## Summary",
              "",
              "This deterministic deliverable proves the WorkHub request-to-delivery pipeline can move a real file through AgentRun, proposal review, merge, accepted ledger, replay, preview, and download without a live LLM key.",
              "",
              "## Acceptance Evidence",
              "",
              "- AgentRun produced an output in `outputs/`.",
              "- The output became a reviewable proposal.",
              "- A human approval merged the proposal into the formal deliverable ledger.",
              "- Replay and download endpoints can read the accepted artifact bytes.",
              "",
              "## Next Step",
              "",
              "Swap the fake transport for the configured DeepSeek-compatible client and run the five-task R5.10 evaluation set."
            ].join("\n")
          }
        }
      ]
    },
    {
      id: "r5-10-dry-step-end-turn",
      stopReason: "end_turn",
      usage: { inputTokens: 90, outputTokens: 35 },
      content: [
        {
          type: "text",
          text: "Dry run deliverable completed. Output: outputs/r5-10-dry-weekly-report.md. No blockers."
        }
      ]
    },
    {
      id: "r5-10-dry-review",
      stopReason: "end_turn",
      usage: { inputTokens: 140, outputTokens: 30 },
      content: [
        {
          type: "text",
          text: "{\"grade\": 4, \"rationale\": \"交付物覆盖了 dry run 的关键验收链路，可作为真 key 前的管线证明。\"}"
        }
      ]
    }
  ];

  function nextResponse(params: LlmCreateParams, via: FakeProviderCall["via"], provider: LlmProviderConfig) {
    const response = responses.shift();
    if (!response) {
      throw new Error(`No R5.10-dry fake response queued for ${via}:${params.source ?? "agent_step"}`);
    }
    calls.push({
      via,
      source: params.source ?? "agent_step",
      model: params.model ?? provider.defaultModelId,
      max_tokens: params.maxTokens,
      content_blocks: response.content.length
    });
    return response;
  }

  return (provider): LlmTransport => ({
    async create(params) {
      return nextResponse(params, "create", provider);
    },
    async stream(params) {
      return responseStream(nextResponse(params, "stream", provider));
    }
  });
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
  const seedUser = defaultSeedFixture.users[0];
  if (!seedUser) {
    throw new Error("Default seed user is missing.");
  }
  await db.insert(users).values(defaultSeedFixture.users).onConflictDoUpdate({
    target: users.id,
    set: {
      nickname: seedUser.nickname,
      cookieToken: seedUser.cookieToken,
      availabilityStatus: seedUser.availabilityStatus ?? "free",
      isAdmin: seedUser.isAdmin ?? true,
      deletedAt: null,
      deletedByUserId: null,
      updatedAt: new Date()
    }
  });
  await db.insert(projects).values(defaultSeedFixture.projects).onConflictDoNothing();
}

async function main() {
  const settings = loadSettings({
    ...process.env,
    PROVIDER_DEEPSEEK_COST_INPUT_CNY_PER_MTOK: process.env.PROVIDER_DEEPSEEK_COST_INPUT_CNY_PER_MTOK ?? "2",
    PROVIDER_DEEPSEEK_COST_OUTPUT_CNY_PER_MTOK: process.env.PROVIDER_DEEPSEEK_COST_OUTPUT_CNY_PER_MTOK ?? "8"
  });
  if (settings.appEnv === "production") {
    throw new Error("Refusing to run R5.10 dry pipeline smoke in production.");
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
    const auditRepo = createAuditLogRepository(db);
    const snapshotsRepo = createSnapshotRepository(db);
    const proposalRepository = createProposalRepository(db);
    const proposalService = createDbProposalService(proposalRepository, {
      storageRoot: await mkdtemp(path.join(os.tmpdir(), "workhub-r5-10-dry-drive-"))
    });
    const workItemRepository = createWorkItemRepository(db);
    const workItemService = createDbWorkItemService(workItemRepository);
    const agentRunRepo = createAgentRunRepository(db);
    const persistence = createDbAgentRunPersistence(agentRunRepo);
    const ledgerStore = createDbCostLedgerStore(db, {
      teamId: settings.auth.defaultWorkspaceId,
      evalSuite: "release"
    });
    const policyStore = createDbBudgetPolicyStore(db);
    const fakeCalls: FakeProviderCall[] = [];
    const providerRegistry = createApiProviderRegistry({
      settings,
      ledgerStore,
      transportFactory: deterministicTransportFactory(fakeCalls)
    });
    const workdir = await mkdtemp(path.join(os.tmpdir(), "workhub-r5-10-dry-agent-"));
    const snapshotRoot = await mkdtemp(path.join(os.tmpdir(), "workhub-r5-10-dry-snapshot-"));
    const queue = createInMemoryAgentRunQueue({
      settings,
      policyStore,
      ledgerStore,
      persistence,
      proposals: proposalService,
      workdir: () => workdir,
      snapshotRoot,
      snapshots: snapshotsRepo,
      auditLogs: auditRepo,
      client: ({ run }) => providerRegistry.get({
        id: run.actor_id,
        userId: run.actor_id,
        runId: run.run_id,
        workItemId: run.work_item_id
      }, "worker"),
      confidence: createAgentRunConfidenceRecorder({
        decisions: createAiDecisionRepository(db),
        auditLogs: auditRepo,
        settings
      }),
      humanReserved: false,
      notifications: false,
      eventBus: false
    });

    const app = withErrors(new Hono<AuthEnv>());
    app.route("/api", createSessionRoutes({ auth, workItems: workItemService }));
    app.route("/api", createWorkItemRoutes({ auth, workItems: workItemService }));
    app.route("/api/proposals", createProposalRoutes({ auth, proposals: proposalService, workItems: workItemService }));
    app.route("/api", createWorkItemProposalRoutes({ auth, proposals: proposalService, workItems: workItemService }));
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
    const headers = { Cookie: cookie, "Content-Type": "application/json" };
    const restCalls: RestEvidence[] = [];

    async function requestJson<T>(method: string, requestPath: string, body: unknown | undefined, expectedStatus: number): Promise<T> {
      const response = await app.request(requestPath, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      const text = await response.text();
      restCalls.push({ method, path: requestPath, status: response.status, response_bytes: Buffer.byteLength(text, "utf8") });
      if (response.status !== expectedStatus) {
        throw new Error(`Expected ${method} ${requestPath} ${expectedStatus}, got ${response.status}: ${text}`);
      }
      return JSON.parse(text) as T;
    }

    async function requestBytes(method: string, requestPath: string, expectedStatus: number) {
      const response = await app.request(requestPath, { method, headers });
      const buffer = Buffer.from(await response.arrayBuffer());
      restCalls.push({ method, path: requestPath, status: response.status, response_bytes: buffer.byteLength });
      if (response.status !== expectedStatus) {
        throw new Error(`Expected ${method} ${requestPath} ${expectedStatus}, got ${response.status}: ${buffer.toString("utf8")}`);
      }
      return buffer;
    }

    const costPageBefore = await requestJson<{ data: { total_cost_cny: string; token_in: number; token_out: number } }>(
      "GET",
      "/api/pages/cost?locale=en-US",
      undefined,
      200
    );
    const session = await requestJson<{ data: { session_id: string } }>("POST", "/api/sessions", {
      intent_text: "R5.10 dry run: create a weekly report deliverable and prove the delivery pipeline."
    }, 200);
    await requestJson("POST", `/api/sessions/${session.data.session_id}/next-question`, {
      selected_option_ids: ["document-draft"]
    }, 200);
    const createdWorkItem = await requestJson<{ data: { workitem: { id: string; status: string } } }>("POST", "/api/workitems", {
      session_id: session.data.session_id,
      selected_option_ids: ["document-draft"]
    }, 201);
    const workItemId = createdWorkItem.data.workitem.id;
    if (createdWorkItem.data.workitem.status !== "spec_ready") {
      throw new Error(`Expected spec_ready work item, got ${createdWorkItem.data.workitem.status}`);
    }

    const knowledge = await requestJson<{ data: { evidence_refs: unknown[] } }>("POST", "/api/knowledge/search", {
      query: "weekly report dry run",
      work_item_id: workItemId
    }, 200);
    const evidenceRefs = knowledge.data.evidence_refs.length > 0
      ? knowledge.data.evidence_refs
      : [{
          id: workItemId,
          source_type: "work_item",
          source_id: workItemId,
          title: "R5.10 dry run work item",
          excerpt: "Fallback self-reference used when the deterministic dry run has no indexed knowledge yet.",
          confidence_hint: "found",
          href: `/api/pages/workitems/${workItemId}`
        }];
    await requestJson("POST", `/api/workitems/${workItemId}/evidence-bindings`, {
      evidence_refs: evidenceRefs
    }, 200);
    await requestJson("GET", `/api/pages/workitems/${workItemId}?locale=zh-CN`, undefined, 200);

    const started = await requestJson<{ data: { run_id: string } }>("POST", `/api/workitems/${workItemId}/agent-runs`, {
      title: "R5.10 dry pipeline run"
    }, 202);
    const runId = started.data.run_id;
    const executed = await queue.run(runId);
    if (executed.status !== "succeeded") {
      throw new Error(`Expected R5.10 dry AgentRun to succeed, got ${executed.status}: ${executed.handoff?.blockers.join(", ") ?? executed.trace.at(-1)?.output_excerpt ?? ""}`);
    }

    const liveRun = await requestJson<{ data: { run_id: string; status: string; usage: { token_in: number; token_out: number; estimated_cost_cny: string } } }>(
      "GET",
      `/api/agent-runs/${runId}`,
      undefined,
      200
    );
    const proposalList = await requestJson<{ data: { id: string; status: string; title: string }[] }>(
      "GET",
      `/api/workitems/${workItemId}/proposals`,
      undefined,
      200
    );
    const proposal = proposalList.data[0];
    if (!proposal) {
      throw new Error("Expected AgentRun to open a proposal.");
    }
    await requestJson("GET", `/api/pages/proposals/${proposal.id}?locale=en-US`, undefined, 200);
    await requestJson("POST", `/api/proposals/${proposal.id}/review`, {
      decision: "approve"
    }, 200);
    const merged = await requestJson<{ data: { status: string; merge_snapshot_id: string } }>("POST", `/api/proposals/${proposal.id}/merge`, {}, 200);
    if (merged.data.status !== "merged" || !merged.data.merge_snapshot_id) {
      throw new Error(`Expected merged proposal, got ${JSON.stringify(merged.data)}`);
    }

    const mergedWorkItem = await requestJson<{ data: { accepted_deliverables: { id: string; filename?: string; preview_href?: string; download_href?: string; drive_version_id?: string }[] } }>(
      "GET",
      `/api/pages/workitems/${workItemId}?locale=zh-CN`,
      undefined,
      200
    );
    const accepted = mergedWorkItem.data.accepted_deliverables[0];
    if (!accepted?.preview_href || !accepted.download_href || !accepted.drive_version_id) {
      throw new Error(`Expected accepted deliverable preview/download refs, got ${JSON.stringify(accepted)}`);
    }
    const preview = await requestJson<{ data: { text: string; preview_type: string; download_href: string } }>(
      "GET",
      accepted.preview_href,
      undefined,
      200
    );
    if (preview.data.preview_type !== "text" || !preview.data.text.includes("R5.10 Dry Weekly Report")) {
      throw new Error("Expected preview text to include the deterministic dry deliverable.");
    }
    const downloaded = await requestBytes("GET", accepted.download_href, 200);
    const downloadedText = downloaded.toString("utf8");
    if (!downloadedText.includes("R5.10 Dry Weekly Report")) {
      throw new Error("Expected downloaded artifact to include the deterministic dry deliverable.");
    }
    await requestJson("GET", `/api/agent-runs/${runId}/replay?locale=en-US`, undefined, 200);
    const costPageAfter = await requestJson<{ data: { total_cost_cny: string; token_in: number; token_out: number } }>(
      "GET",
      "/api/pages/cost?locale=en-US",
      undefined,
      200
    );
    const costPageDelta = {
      total_cost_cny: formatDelta(numericDelta(costPageAfter.data.total_cost_cny, costPageBefore.data.total_cost_cny)),
      token_in: costPageAfter.data.token_in - costPageBefore.data.token_in,
      token_out: costPageAfter.data.token_out - costPageBefore.data.token_out
    };

    const [
      runRows,
      workItemRows,
      proposalRows,
      acceptedRows,
      driveVersionRows,
      snapshotRows,
      usageRows,
      ledgerRows,
      confidenceRows,
      auditRows
    ] = await Promise.all([
      db.select().from(agentRuns).then((rows) => rows.filter((row) => row.id === runId)),
      db.select().from(workItems).then((rows) => rows.filter((row) => row.id === workItemId)),
      db.select().from(proposals).then((rows) => rows.filter((row) => row.workItemId === workItemId)),
      db.select().from(acceptedDeliverableChanges).then((rows) => rows.filter((row) => row.workItemId === workItemId)),
      db.select().from(projectDriveVersions).then((rows) => rows.filter((row) => row.id === accepted.drive_version_id)),
      db.select().from(snapshots).then((rows) => rows.filter((row) => row.workItemId === workItemId)),
      db.select().from(usageRecords).then((rows) => rows.filter((row) => row.runId === runId)),
      db.select().from(costLedgerEntries).then((rows) => rows.filter((row) => row.runId === runId)),
      db.select().from(confidenceRecords).then((rows) => rows.filter((row) => row.agentRunId === runId)),
      db.select().from(auditLogs).then((rows) => rows.filter((row) => row.entityId === workItemId || row.entityId === proposal.id))
    ]);
    const sourceSet = [...new Set(usageRows.map((row) => row.source))].sort();
    if (!sourceSet.includes("agent_step") || !sourceSet.includes("review")) {
      throw new Error(`Expected usage rows for agent_step and review, got ${sourceSet.join(",")}`);
    }
    if (usageRows.length !== 3) {
      throw new Error(`Expected three measured usage records, got ${usageRows.length}`);
    }
    if (ledgerRows.length < 9) {
      throw new Error(`Expected ledger entries for workitem/user/team scopes, got ${ledgerRows.length}`);
    }
    const confidence = confidenceRows[0];
    const confidenceSignals = confidence?.signalsJson as { sources?: { review?: { grade?: unknown; source?: unknown } } } | undefined;
    if (!confidence || confidenceSignals?.sources?.review?.source !== "llm_review" || confidenceSignals.sources.review.grade !== 4) {
      throw new Error(`Expected confidence record to include llm_review grade=4, got ${JSON.stringify(confidence?.signalsJson)}`);
    }
    if (
      costPageDelta.token_in !== liveRun.data.usage.token_in
      || costPageDelta.token_out !== liveRun.data.usage.token_out
      || Math.abs(Number(costPageDelta.total_cost_cny) - Number(liveRun.data.usage.estimated_cost_cny)) > 0.000001
    ) {
      throw new Error(`Expected cost page delta to match current run usage, got ${JSON.stringify({ costPageDelta, runUsage: liveRun.data.usage })}`);
    }
    const driveVersion = driveVersionRows[0];
    if (!driveVersion?.sha256 || driveVersion.sha256 !== sha256Buffer(downloaded)) {
      throw new Error("Expected accepted drive version sha256 to match downloaded bytes.");
    }

    const reportDir = path.join(repoRoot(), "docs/workhub/05-clients/assets/audit/2026-06-13-r5-10-dry-agent-pipeline");
    await mkdir(reportDir, { recursive: true });
    await writeFile(path.join(reportDir, "downloaded-r5-10-dry-weekly-report.md"), downloadedText, "utf8");
    const report = {
      ok: true,
      generated_at: new Date().toISOString(),
      module: "R5.10-dry",
      keyless: true,
      provider: {
        default_provider: settings.llm.defaultProvider,
        model: settings.llm.model,
        live_key_required: false,
        fake_transport_calls: fakeCalls
      },
      entities: {
        session_id: session.data.session_id,
        work_item_id: workItemId,
        agent_run_id: runId,
        proposal_id: proposal.id,
        merge_snapshot_id: merged.data.merge_snapshot_id,
        accepted_change_id: accepted.id,
        drive_version_id: accepted.drive_version_id
      },
      rest_evidence: restCalls,
      db_rows: {
        agent_runs: runRows.length,
        work_items: workItemRows.length,
        proposals: proposalRows.length,
        accepted_deliverable_changes: acceptedRows.length,
        project_drive_versions: driveVersionRows.length,
        snapshots: snapshotRows.length,
        usage_records: usageRows.length,
        cost_ledger_entries: ledgerRows.length,
        confidence_records: confidenceRows.length,
        audit_logs_related: auditRows.length
      },
      usage: {
        run_usage: liveRun.data.usage,
        usage_sources: sourceSet,
        usage_records: usageRows.map((row) => ({
          id: row.id,
          source: row.source,
          input_tokens: row.inputTokens,
          output_tokens: row.outputTokens,
          estimated_cost_cny: row.estimatedCostCny
        })),
        cost_page_before: costPageBefore.data,
        cost_page_after: costPageAfter.data,
        cost_page_delta: costPageDelta
      },
      confidence: {
        grade: confidence.grade,
        risk_level: confidence.riskLevel,
        verdict: confidence.verdict,
        score: confidence.confidenceScore,
        review_grade: confidenceSignals.sources.review.grade
      },
      artifact: {
        filename: accepted.filename,
        preview_href: accepted.preview_href,
        download_href: accepted.download_href,
        preview_type: preview.data.preview_type,
        downloaded_bytes: downloaded.byteLength,
        downloaded_sha256: sha256Buffer(downloaded),
        downloaded_text_sha256: sha256Text(downloadedText),
        drive_version_sha256: driveVersion.sha256,
        saved_copy: path.join(reportDir, "downloaded-r5-10-dry-weekly-report.md")
      }
    };
    await writeFile(path.join(reportDir, "r5-10-dry-agent-pipeline-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({
      ok: true,
      run_id: runId,
      work_item_id: workItemId,
      proposal_id: proposal.id,
      accepted_change_id: accepted.id,
      usage_sources: sourceSet,
      usage_records: usageRows.length,
      cost_ledger_entries: ledgerRows.length,
      confidence_verdict: confidence.verdict,
      downloaded_sha256: report.artifact.downloaded_sha256,
      report_dir: reportDir
    }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
