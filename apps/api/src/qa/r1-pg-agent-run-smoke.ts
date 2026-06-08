import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AgentLoopClient } from "@workhub/agent/loop";
import { loadSettings } from "@workhub/config";
import {
  auditLogs,
  agentRuns,
  createAgentRunRepository,
  createAuditLogRepository,
  createClientDeviceRepository,
  createDatabaseClient,
  createProposalRepository,
  createSnapshotRepository,
  createUserRepository,
  defaultSeedFixture,
  defaultSeedIds,
  orgs,
  proposals,
  projects,
  runMigrations,
  snapshots,
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
import { createDbAgentRunPersistence } from "../services/agent-run-persistence.js";
import { createDbProposalService } from "../services/proposals.js";
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

async function createSmokeWorkItem(db: ReturnType<typeof createDatabaseClient>["db"]) {
  const id = randomUUID();
  const code = `R1-PG-${Date.now()}`;
  const rows = await db
    .insert(workItems)
    .values({
      id,
      code,
      projectId: defaultSeedIds.projectId,
      workspaceId: defaultSeedIds.workspaceId,
      submitterUserId: defaultSeedIds.adminUserId,
      title: "R1 PG smoke file-only task",
      rawDescription: "Write a small markdown deliverable into outputs/ and produce a reviewable proposal.",
      summaryMd: "R1 PG smoke task.",
      status: "spec_ready",
      mode: "worker",
      humanReserved: false
    })
    .returning();
  const row = rows[0];
  if (!row) {
    throw new Error("Failed to create smoke work item");
  }
  return row;
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
    const workItem = await createSmokeWorkItem(db);
    const auth: AuthDependencies = {
      users: createUserRepository(db),
      devices: createClientDeviceRepository(db),
      settings
    };
    const snapshotsRepo = createSnapshotRepository(db);
    const auditRepo = createAuditLogRepository(db);
    const agentRunRepo = createAgentRunRepository(db);
    const persistence = createDbAgentRunPersistence(agentRunRepo);
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
      proposals: createDbProposalService(createProposalRepository(db)),
      confidence: false,
      humanReserved: false,
      notifications: false,
      eventBus: false
    });
    const app = withErrors(new Hono<AuthEnv>());
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
    const start = await app.request(`/api/workitems/${workItem.id}/agent-runs`, {
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
    const [agentRunRows, stepRows, proposalRows, snapshotRows, auditRows] = await Promise.all([
      db.select().from(agentRuns).then((rows) => rows.filter((row) => row.id === runId)),
      restartedQueue.trace(runId),
      db.select().from(proposals).then((rows) => rows.filter((row) => row.workItemId === workItem.id)),
      db.select().from(snapshots).then((rows) => rows.filter((row) => row.workItemId === workItem.id)),
      db.select().from(auditLogs).then((rows) => rows.filter((row) => row.entityId === workItem.id))
    ]);
    const replay = await replayAfterRestart.json() as {
      data: { steps: unknown[]; snapshots: unknown[]; audit_logs: unknown[] };
    };
    const summary = {
      ok: true,
      database_url: settings.databaseUrl.replace(/:\/\/([^:]+):([^@]+)@/u, "://$1:***@"),
      work_item_id: workItem.id,
      run_id: runId,
      run_status: (await runAfterRestart.json() as { data: { status: string } }).data.status,
      db_rows: {
        agent_runs: agentRunRows.length,
        agent_steps: stepRows.length,
        proposals: proposalRows.length,
        snapshots: snapshotRows.length,
        audit_logs: auditRows.length
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
