import assert from "node:assert/strict";

import { createApiClient } from "@workhub/api-client";

import { createCuuR3SmokeApp, cuuR3SmokeClientToken, type CuuR3ReloadRestoreSeedKind } from "./cuu-r3-launcher-harness.js";

const { app } = createCuuR3SmokeApp({
  runStream: true,
  runDelayMs: 40,
  modelDelayMs: 15
});

const fetchFn: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  return app.request(`${url.pathname}${url.search}`, init);
};
const client = createApiClient({
  baseUrl: "http://workhub-cuu-r3-restore.local",
  fetchFn,
  getClientToken: () => cuuR3SmokeClientToken
});

const sessionSeed = await createSeed("reload-session", "zh-CN");
assert.equal(sessionSeed.restore_state.entity_type, "session");
assert.equal(sessionSeed.restore_state.card.kind, "question");
assert.equal(sessionSeed.restore_state.card.payload_ref?.entity_type, "session");
assert.equal(sessionSeed.restore_state.card.actions[0]?.id, "submit_option");

const activeSeed = await createSeed("reload-active-run", "en-US");
assert.equal(activeSeed.restore_state.entity_type, "agent_run");
assert.ok(activeSeed.run);
assert.equal(activeSeed.run.status, "queued");
const activeFinal = await waitForRunStatus(activeSeed.run.run_id, "succeeded");
assert.equal(activeFinal.status, "succeeded");
assert.equal(activeFinal.run_id, activeSeed.restore_state.entity_id);

const terminalSeed = await createSeed("reload-terminal-run", "en-US");
assert.equal(terminalSeed.restore_state.entity_type, "agent_run");
assert.ok(terminalSeed.run);
assert.equal(terminalSeed.run.status, "succeeded");
assert.equal(terminalSeed.run.run_id, terminalSeed.restore_state.entity_id);

console.log(JSON.stringify({
  ok: true,
  smoke: "cuu-r3-reload-restore",
  session_restore_entity: sessionSeed.restore_state.entity_type,
  active_run_id: activeSeed.run.run_id,
  active_final_status: activeFinal.status,
  terminal_run_id: terminalSeed.run.run_id,
  terminal_status: terminalSeed.run.status
}, null, 2));

async function createSeed(kind: CuuR3ReloadRestoreSeedKind, locale: "zh-CN" | "en-US") {
  const response = await app.request("/api/qa/cuu-r3-restore-seed", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-workhub-client-token": cuuR3SmokeClientToken
    },
    body: JSON.stringify({ kind, locale })
  });
  assert.equal(response.status, 200);
  const body = await response.json() as {
    ok: true;
    data: {
      kind: CuuR3ReloadRestoreSeedKind;
      restore_state:
        | {
            entity_type: "session";
            entity_id: string;
            card: {
              kind: string;
              actions: Array<{ id: string }>;
              payload_ref?: { entity_type: string };
            };
          }
        | {
            entity_type: "agent_run";
            entity_id: string;
          };
      run?: Awaited<ReturnType<typeof client.getAgentRun>>;
    };
  };
  assert.equal(body.ok, true);
  assert.equal(body.data.kind, kind);
  return body.data;
}

async function waitForRunStatus(runId: string, status: "succeeded") {
  const deadline = Date.now() + 3000;
  let latest: Awaited<ReturnType<typeof client.getAgentRun>> | undefined;
  do {
    latest = await client.getAgentRun(runId);
    if (latest.status === status) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for reload restore run ${runId}; latest=${latest?.status}`);
}
