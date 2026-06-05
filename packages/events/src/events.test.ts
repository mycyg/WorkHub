import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import { eventTypes, type BudgetNotice, workHubEventSchema } from "@workhub/contracts";

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

test("budget events become actionable attention items for Web and Cuu", () => {
  const notice: BudgetNotice = {
    code: "budget_warning",
    severity: "warning",
    message: "这次任务预算快用完了，建议降级模型继续。",
    scope: { kind: "workitem", workitem_id: "30000000-0000-4000-8000-000000000002" },
    usage_ratio: 0.84,
    recommended_action: "downgrade_model",
    options: [
      {
        id: "downgrade_model",
        label: "降级模型继续",
        action_href: "/api/workitems/30000000-0000-4000-8000-000000000002/agent-runs"
      },
      { id: "pause", label: "先暂停", action_href: "/workitems/30000000-0000-4000-8000-000000000002" }
    ],
    action_href: "/dashboard/cost"
  };
  const warning = makeWorkHubEvent({
    event_id: "30000000-0000-4000-8000-000000000003",
    type: eventTypes.budgetWarning,
    topic: topics.user("10000000-0000-4000-8000-000000000001").topic,
    ts: new Date("2026-06-05T00:00:00.000Z"),
    preview_text: notice.message,
    data: notice
  });
  const warningAttention = toAttentionItem(warning);

  assert.equal(toCuuState(warning), "worried");
  assert.equal(warningAttention?.kind, "budget");
  assert.equal(warningAttention?.source_ref.entity_type, "budget_notice");
  assert.equal(warningAttention?.title, "预算快到线了");
  assert.equal(warningAttention?.actions[0]?.id, "downgrade_model");
  assert.equal(warningAttention?.actions[0]?.style, "primary");

  const exhausted = makeWorkHubEvent({
    event_id: "30000000-0000-4000-8000-000000000004",
    type: eventTypes.budgetExhausted,
    topic: topics.user("10000000-0000-4000-8000-000000000001").topic,
    ts: new Date("2026-06-05T00:01:00.000Z"),
    preview_text: "AI 预算已经用完。",
    data: { ...notice, code: "budget_exhausted", severity: "critical", recommended_action: "pause", usage_ratio: 1 }
  });
  const exhaustedAttention = toAttentionItem(exhausted);

  assert.equal(toCuuState(exhausted), "asking_approval");
  assert.equal(exhaustedAttention?.priority, "urgent");
  assert.equal(exhaustedAttention?.title, "预算用完了");
});

test("escalation opened events become Cuu handoff attention", () => {
  const event = makeWorkHubEvent({
    event_id: "30000000-0000-4000-8000-000000000005",
    type: eventTypes.escalationOpened,
    topic: topics.workitem("50000000-0000-4000-8000-000000000001").topic,
    ts: new Date("2026-06-05T00:02:00.000Z"),
    work_item_id: "50000000-0000-4000-8000-000000000001",
    preview_text: "AI 觉得这事需要请人接手。",
    data: { escalation_id: "73000000-0000-4000-8000-000000000025" }
  });
  const attention = toAttentionItem(event);

  assert.equal(toCuuState(event), "worried");
  assert.equal(attention?.kind, "escalation");
  assert.equal(attention?.source_ref.entity_type, "escalation_event");
});

test("revision feedback events keep Cuu in revision-requested handoff mode", () => {
  const event = makeWorkHubEvent({
    event_id: "30000000-0000-4000-8000-000000000006",
    type: eventTypes.revisionFedback,
    topic: topics.workitem("50000000-0000-4000-8000-000000000001").topic,
    ts: new Date("2026-06-05T00:03:00.000Z"),
    work_item_id: "50000000-0000-4000-8000-000000000001",
    proposal_id: "60000000-0000-4000-8000-000000000001",
    preview_text: "打回原因已回灌给下一轮 AI。",
    data: {
      proposal_id: "60000000-0000-4000-8000-000000000001",
      reason_fed_back: true
    }
  });
  const attention = toAttentionItem(event);

  assert.equal(toCuuState(event), "revision_requested");
  assert.equal(attention?.kind, "proposal_review");
  assert.equal(attention?.source_ref.entity_type, "proposal");
});

test("SSE formatting prefixes every data line and round-trips multiline payloads", () => {
  const frame = formatSseEvent("agent_run.step", "line 1\r\nline 2");

  assert.equal(frame, "event: agent_run.step\ndata: line 1\ndata: line 2\n\n");
  assert.deepEqual(parseSseFrames(frame), [{ event: "agent_run.step", data: "line 1\nline 2" }]);
});
