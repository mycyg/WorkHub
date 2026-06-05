import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import { eventTypes, workHubEventSchema } from "@workhub/contracts";

import { formatSseEvent, makeWorkHubEvent, parseSseFrames, toAttentionItem, toCuuState, topics } from "./index.js";

test("topic helpers keep identity-scoped topic names explicit", () => {
  assert.equal(topics.all().topic, "all");
  assert.equal(topics.user("u1").topic, "user:u1");
  assert.equal(topics.workitem("w1").topic, "workitem:w1");
  assert.equal(topics.run("r1").topic, "run:r1");
});

test("WorkHubEvent envelope uses formal event names and trims Cuu preview text", () => {
  const event = makeWorkHubEvent({
    event_id: "30000000-0000-4000-8000-000000000001",
    type: eventTypes.permissionAsk,
    topic: topics.user("10000000-0000-4000-8000-000000000001").topic,
    ts: new Date("2026-06-05T00:00:00.000Z"),
    preview_text: "x".repeat(260),
    data: { approval_id: "40000000-0000-4000-8000-000000000001" }
  });

  const parsed = workHubEventSchema(z.unknown()).parse(event);
  assert.equal(parsed.type, "permission.ask");
  assert.equal(parsed.preview_text?.length, 200);
  assert.equal(toCuuState(event), "asking_approval");
  assert.equal(toAttentionItem(event)?.kind, "approval");
});

test("SSE formatting prefixes every data line and round-trips multiline payloads", () => {
  const frame = formatSseEvent("agent_run.step", "line 1\r\nline 2");

  assert.equal(frame, "event: agent_run.step\ndata: line 1\ndata: line 2\n\n");
  assert.deepEqual(parseSseFrames(frame), [{ event: "agent_run.step", data: "line 1\nline 2" }]);
});
