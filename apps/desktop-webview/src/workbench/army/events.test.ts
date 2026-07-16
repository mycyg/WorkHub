import assert from "node:assert/strict";
import { test } from "node:test";

import { isIncomingAgentRunLifecycleEvent } from "./events.js";

function envelope(type: string, data: Record<string, unknown>): unknown {
  return { event_id: "e-1", type, topic: "conversation:conv-1", ts: "2026-07-16T00:00:00.000Z", data };
}

test("isIncomingAgentRunLifecycleEvent matches started/failed/escalated", () => {
  assert.equal(isIncomingAgentRunLifecycleEvent(envelope("agent_run.started", { run_id: "r-1" })), true);
  assert.equal(isIncomingAgentRunLifecycleEvent(envelope("agent_run.failed", { run_id: "r-1", reason: "x" })), true);
  assert.equal(isIncomingAgentRunLifecycleEvent(envelope("agent_run.escalated", { run_id: "r-1" })), true);
});

test("isIncomingAgentRunLifecycleEvent matches agent_run.step only for the terminal done kind (not high-frequency mid steps)", () => {
  assert.equal(isIncomingAgentRunLifecycleEvent(envelope("agent_run.step", { run_id: "r-1", kind: "done", status: "succeeded" })), true);
  assert.equal(isIncomingAgentRunLifecycleEvent(envelope("agent_run.step", { run_id: "r-1", kind: "requeued" })), false);
  assert.equal(isIncomingAgentRunLifecycleEvent(envelope("agent_run.step", { run_id: "r-1" })), false);
});

test("isIncomingAgentRunLifecycleEvent ignores unrelated conversation events and malformed input", () => {
  assert.equal(isIncomingAgentRunLifecycleEvent(envelope("conversation.message.created", { conversation_id: "conv-1" })), false);
  assert.equal(isIncomingAgentRunLifecycleEvent(envelope("conversation.action_card.updated", { conversation_id: "conv-1" })), false);
  assert.equal(isIncomingAgentRunLifecycleEvent(envelope("agent_run.started", {})), false, "missing run_id");
  assert.equal(isIncomingAgentRunLifecycleEvent(null), false);
  assert.equal(isIncomingAgentRunLifecycleEvent("agent_run.started"), false);
  assert.equal(isIncomingAgentRunLifecycleEvent({ type: "agent_run.started" }), false, "missing data");
});
