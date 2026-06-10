import assert from "node:assert/strict";
import test from "node:test";

import { deliverableManifestFixtures } from "@workhub/contracts";

import { createApiClient, joinApiUrl, parseRunEventSse, parseWorkHubEventSse, parseWorkHubSse, WorkHubApiError } from "./index.js";

test("joinApiUrl preserves relative mode and absolute daemon base URLs", () => {
  assert.equal(joinApiUrl(undefined, "/api/health"), "/api/health");
  assert.equal(joinApiUrl("http://127.0.0.1:8787/", "/api/health"), "http://127.0.0.1:8787/api/health");
});

test("api client unwraps WorkHub envelopes and injects the desktop token headers", async () => {
  const seenHeaders: Record<string, string | null> = {};
  const client = createApiClient({
    baseUrl: "http://127.0.0.1:8787",
    getClientToken: () => "device-token",
    fetchFn: async (_input, init) => {
      const headers = new Headers(init?.headers);
      seenHeaders.workhub = headers.get("X-WorkHub-Client-Token");
      seenHeaders.legacy = headers.get("X-YQGL-Client-Token");
      return new Response(JSON.stringify({ ok: true, data: { ok: true, service: "workhub-api", runtime: "node", port: 8787 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  const health = await client.health();
  assert.equal(health.service, "workhub-api");
  assert.equal(seenHeaders.workhub, "device-token");
  assert.equal(seenHeaders.legacy, "device-token");
});

test("api client preserves raw ok health payloads that are not WorkHub envelopes", async () => {
  const client = createApiClient({
    fetchFn: async () =>
      new Response(JSON.stringify({ ok: true, service: "workhub-api", runtime: "node", port: 8787 }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
  });

  const health = await client.health();
  assert.deepEqual(health, { ok: true, service: "workhub-api", runtime: "node", port: 8787 });
});

test("api client converts error envelopes to WorkHubApiError", async () => {
  const client = createApiClient({
    fetchFn: async () =>
      new Response(JSON.stringify({ ok: false, error: { code: "budget_exhausted", message: "预算用完了。" } }), {
        status: 402,
        headers: { "Content-Type": "application/json" }
      })
  });

  await assert.rejects(
    () => client.request("/api/agent-runs/demo"),
    (error) => error instanceof WorkHubApiError && error.code === "budget_exhausted"
  );
});

test("api client exposes P0.5 gold path page and replay endpoints", async () => {
  const calls: string[] = [];
  const client = createApiClient({
    fetchFn: async (input, init) => {
      const body = (String(input).includes("/next-question") || String(input).includes("/auth/preferences")) && typeof init?.body === "string"
        ? ` ${init.body}`
        : "";
      calls.push(`${init?.method ?? "GET"} ${input}${body}`);
      return new Response(JSON.stringify({ ok: true, data: { id: "ok" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  await client.pages.goldPath();
  await client.me();
  await client.updatePreferences({ locale: "en-US" });
  await client.pages.workItem("work-1");
  await client.pages.proposal("proposal-1");
  await client.createSession({ intent_text: "帮我整理客户周报模板。" });
  await client.createWorkItem({ session_id: "session-1", selected_option_ids: ["risk-first"] });
  await client.startAgentRun("work-1", { title: "AI 开始整理周报" });
  await client.getAgentRun("run-1");
  await client.getAgentRunTrace("run-1", 2);
  await client.getAgentRunHandoff("run-1");
  await client.abortAgentRun("run-1");
  await client.createProposalFromManifest("work-1", { manifest: deliverableManifestFixtures[0]! });
  await client.listWorkItemProposals("work-1");
  await client.listWorkItemConflicts("work-1");
  await client.getProposal("proposal-1");
  await client.nextQuestion("session-1", { selected_option_ids: ["risk-first"] });
  await client.searchKnowledge({ q: "weekly" });
  await client.useEvidenceForWorkItem("work-1", {
    evidence_refs: [
      {
        id: "00000000-0000-4000-8000-000000000201",
        source_type: "meeting",
        source_id: "weekly-sync",
        title: "周会纪要"
      }
    ]
  });
  await client.restoreAcceptedDeliverable("work-1", "accepted-1");
  await client.costUsage();
  await client.costPolicies();
  await client.updateCostPolicy("user", "pcost-user-day-v0", { max_tokens: 250000 });
  await client.reviewProposal("proposal-1", { decision: "approve", remember: "once" });
  await client.mergeProposal("proposal-1");
  await client.chooseMergeProposalCandidate("merge-proposal/1", { option_key: "ai_fusion" });
  await client.applyMergeProposalCandidate("merge-proposal/1");
  await client.replayAgentRun("run-1");

  assert.deepEqual(calls, [
    "GET /api/pages/gold-path",
    "GET /api/auth/me",
    'PATCH /api/auth/preferences {"locale":"en-US"}',
    "GET /api/pages/workitems/work-1",
    "GET /api/pages/proposals/proposal-1",
    "POST /api/sessions",
    "POST /api/workitems",
    "POST /api/workitems/work-1/agent-runs",
    "GET /api/agent-runs/run-1",
    "GET /api/agent-runs/run-1/trace?after=2",
    "GET /api/agent-runs/run-1/handoff",
    "POST /api/agent-runs/run-1/abort",
    "POST /api/workitems/work-1/proposals",
    "GET /api/workitems/work-1/proposals",
    "GET /api/workitems/work-1/conflicts",
    "GET /api/proposals/proposal-1",
    'POST /api/sessions/session-1/next-question {"selected_option_ids":["risk-first"]}',
    "POST /api/knowledge/search",
    "POST /api/workitems/work-1/evidence-bindings",
    "POST /api/workitems/work-1/deliverables/accepted-1/restore",
    "GET /api/cost/usage",
    "GET /api/cost/policies",
    "PUT /api/cost/policies/user/pcost-user-day-v0",
    "POST /api/proposals/proposal-1/review",
    "POST /api/proposals/proposal-1/merge",
    "POST /api/merge-proposals/merge-proposal%2F1/choose",
    "POST /api/merge-proposals/merge-proposal%2F1/apply",
    "GET /api/agent-runs/run-1/replay"
  ]);
});

test("api client carries locale on typed page VM requests", async () => {
  const calls: string[] = [];
  const client = createApiClient({
    fetchFn: async (input) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ ok: true, data: { id: "ok" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  await client.pages.goldPath({ locale: "en-US" });
  await client.pages.workItem("work/1", { locale: "zh-CN" });
  await client.pages.proposal("proposal 1", { locale: "en-US" });

  assert.deepEqual(calls, [
    "/api/pages/gold-path?locale=en-US",
    "/api/pages/workitems/work%2F1?locale=zh-CN",
    "/api/pages/proposals/proposal%201?locale=en-US"
  ]);
});

test("api client exposes typed push stream URLs for web and desktop clients", () => {
  const relative = createApiClient();
  const daemon = createApiClient({ baseUrl: "http://127.0.0.1:8787/" });

  assert.equal(relative.streams.all(), "/api/push/stream");
  assert.equal(relative.streams.me(), "/api/push/stream/me");
  assert.equal(relative.streams.workItem("work/1"), "/api/push/stream/workitem/work%2F1");
  assert.equal(relative.streams.run("run/1"), "/api/push/stream/run/run%2F1");
  assert.equal(relative.streams.session("session 1"), "/api/push/stream/session/session%201");
  assert.equal(relative.streams.proposal("proposal:1"), "/api/push/stream/proposal/proposal%3A1");
  assert.equal(daemon.streams.run("run-1"), "http://127.0.0.1:8787/api/push/stream/run/run-1");
});

test("SSE parser keeps event names and parses JSON payloads", () => {
  const events = parseWorkHubSse<{ topic: string }>('event: connected\ndata: {"topic":"user:1"}\n\n: ping\n\n');
  assert.equal(events.length, 1);
  assert.equal(events[0]?.event, "connected");
  assert.equal(events[0]?.json?.topic, "user:1");
});

test("SSE parser extracts WorkHubEvent envelopes and run-specific event streams", () => {
  const input = [
    'event: agent_run.step\ndata: {"event_id":"event-1","type":"agent_run.step","topic":"run:run-1","ts":"2026-06-05T01:00:00.000Z","run_id":"run-1","data":{"kind":"step","summary":"读取文档"}}',
    'event: budget.warning\ndata: {"event_id":"event-2","type":"budget.warning","topic":"workitem:work-1","ts":"2026-06-05T01:00:01.000Z","data":{"message":"预算提醒"}}',
    "event: message\ndata: not-json"
  ].join("\n\n");

  const events = parseWorkHubEventSse(input);
  const runEvents = parseRunEventSse("run-1", input);

  assert.equal(events.length, 2);
  assert.equal(events[0]?.type, "agent_run.step");
  assert.equal(runEvents.length, 1);
  assert.equal(runEvents[0]?.topic, "run:run-1");
});
