import assert from "node:assert/strict";
import { test } from "node:test";

import type { AgentRunLiveVM, ArmyOverviewPageVM, ConversationArmyPanelVM } from "@workhub/contracts";

import { fetchAgentRunTrace, fetchArmyOverview, fetchConversationArmyPanel } from "./api.js";

function fakePanel(): ConversationArmyPanelVM {
  return {
    generated_at: "2026-07-13T00:00:00.000000Z",
    conversation_id: "conv-1",
    project_id: "proj-1",
    runs: { runs: [], capped: false, next_cursor: null, empty_state: "no_army_runs" },
    outputs: { items: [], capped: false },
    background_tasks: { items: [], empty_state: "not_yet_available" }
  };
}

function fakeOverview(): ArmyOverviewPageVM {
  return {
    generated_at: "2026-07-13T00:00:00.000000Z",
    viewer_user_id: "user-1",
    runs: { runs: [], capped: false, next_cursor: null, empty_state: "no_army_runs" }
  };
}

function fakeRequestClient(handler: (path: string, init?: RequestInit) => unknown) {
  return {
    request: async <T>(path: string, init?: RequestInit) => handler(path, init) as T
  };
}

test("fetchConversationArmyPanel requests the conversation's army path without a query string by default", async () => {
  const calls: string[] = [];
  const client = fakeRequestClient((path) => {
    calls.push(path);
    return fakePanel();
  });

  const result = await fetchConversationArmyPanel(client, "conv-1");

  assert.equal(calls.length, 1);
  assert.equal(calls[0], "/api/conversations/conv-1/army");
  assert.deepEqual(result, fakePanel());
});

test("fetchConversationArmyPanel URL-encodes the conversation id and appends cursor/limit params together", async () => {
  const calls: string[] = [];
  const client = fakeRequestClient((path) => {
    calls.push(path);
    return fakePanel();
  });

  await fetchConversationArmyPanel(client, "conv 1", {
    afterCreatedAt: "2026-07-13T00:00:00.000000Z",
    afterId: "run-1",
    limit: 10
  });

  assert.equal(
    calls[0],
    "/api/conversations/conv%201/army?afterCreatedAt=2026-07-13T00%3A00%3A00.000000Z&afterId=run-1&limit=10"
  );
});

test("fetchArmyOverview requests /api/me/army without a query string by default", async () => {
  const calls: string[] = [];
  const client = fakeRequestClient((path) => {
    calls.push(path);
    return fakeOverview();
  });

  const result = await fetchArmyOverview(client);

  assert.equal(calls[0], "/api/me/army");
  assert.deepEqual(result, fakeOverview());
});

test("fetchArmyOverview appends the cursor when given", async () => {
  const calls: string[] = [];
  const client = fakeRequestClient((path) => {
    calls.push(path);
    return fakeOverview();
  });

  await fetchArmyOverview(client, { afterCreatedAt: "2026-07-13T00:00:00.000000Z", afterId: "run-2" });

  assert.equal(calls[0], "/api/me/army?afterCreatedAt=2026-07-13T00%3A00%3A00.000000Z&afterId=run-2");
});

test("fetchAgentRunTrace forwards to the client's existing getAgentRun method (the same one Spotlight's replay view uses)", async () => {
  const calls: string[] = [];
  const trace = { run_id: "run-1", trace: [] } as unknown as AgentRunLiveVM;
  const client = {
    getAgentRun: async (runId: string) => {
      calls.push(runId);
      return trace;
    }
  };

  const result = await fetchAgentRunTrace(client, "run-1");

  assert.deepEqual(calls, ["run-1"]);
  assert.equal(result, trace);
});
