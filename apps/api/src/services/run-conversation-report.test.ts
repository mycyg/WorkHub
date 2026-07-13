import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRunSettledReportContent,
  createRunConversationReportHook,
  extractRunOutcomeReason
} from "./run-conversation-report.js";
import type { AgentRunQueueRecord } from "../workers/agent-runner.js";

const runId = "10000000-0000-4000-8000-000000000030";
const workItemId = "10000000-0000-4000-8000-000000000020";
const conversationId = "10000000-0000-4000-8000-000000000040";
const workspaceId = "10000000-0000-4000-8000-000000000001";

function runRecord(partial: Partial<AgentRunQueueRecord> = {}): AgentRunQueueRecord {
  return {
    run_id: runId,
    work_item_id: workItemId,
    actor_id: "10000000-0000-4000-8000-000000000010",
    mode: "worker",
    status: "failed",
    title: "重写选题报告第三节",
    source_conversation_id: conversationId,
    workspace_id: workspaceId,
    budget: { max_steps: 10, total_timeout_s: 300, max_tokens: 100, max_cost_cny: "1" },
    budget_decision: {
      decision_id: "decision-1",
      allowed: true,
      model_route: { provider: "openai", model: "test-model", reason: "default" }
    },
    usage: { steps_used: 2, token_in: 80, token_out: 10, estimated_cost_cny: "0.5" },
    trace: [],
    created_at: "2026-07-13T09:00:00.000000Z",
    updated_at: "2026-07-13T09:05:00.000000Z",
    ...partial
  };
}

// —— extractRunOutcomeReason —— //

test("extractRunOutcomeReason returns null for an empty trace instead of inventing a reason", () => {
  assert.equal(extractRunOutcomeReason([]), null);
});

test("extractRunOutcomeReason returns null when no trace step is phase='final'", () => {
  assert.equal(
    extractRunOutcomeReason([
      { phase: "think", output_excerpt: "thinking about it" },
      { phase: "tool_call", output_excerpt: "calling a tool" }
    ]),
    null
  );
});

test("extractRunOutcomeReason takes the last final step's output_excerpt, collapsed to a single line", () => {
  const reason = extractRunOutcomeReason([
    { phase: "tool_result", output_excerpt: "some tool result" },
    { phase: "final", output_excerpt: "沙箱写文件权限\n被拒绝了" }
  ]);
  assert.equal(reason, "沙箱写文件权限 被拒绝了");
});

test("extractRunOutcomeReason picks the last final entry when there are several", () => {
  const reason = extractRunOutcomeReason([
    { phase: "final", output_excerpt: "first attempt failed" },
    { phase: "think", output_excerpt: "retrying" },
    { phase: "final", output_excerpt: "second attempt also failed" }
  ]);
  assert.equal(reason, "second attempt also failed");
});

test("extractRunOutcomeReason truncates an overly long reason with an ellipsis", () => {
  const longText = "x".repeat(300);
  const reason = extractRunOutcomeReason([{ phase: "final", output_excerpt: longText }]);
  assert.equal(reason?.length, 161); // 160 chars + ellipsis
  assert.ok(reason?.endsWith("…"));
});

test("extractRunOutcomeReason returns null when the final step has no output_excerpt text", () => {
  assert.equal(extractRunOutcomeReason([{ phase: "final", output_excerpt: "   " }]), null);
  assert.equal(extractRunOutcomeReason([{ phase: "final" }]), null);
});

// —— buildRunSettledReportContent —— //

test("buildRunSettledReportContent returns undefined for succeeded runs — batch 4b's deliverable card already covers this terminal state", () => {
  assert.equal(buildRunSettledReportContent(runRecord({ status: "succeeded" })), undefined);
});

test("buildRunSettledReportContent returns undefined for cancelled runs — the actor who aborted it already knows", () => {
  assert.equal(buildRunSettledReportContent(runRecord({ status: "cancelled" })), undefined);
});

test("buildRunSettledReportContent returns undefined for non-terminal statuses (defensive; should never be called at settle time)", () => {
  assert.equal(buildRunSettledReportContent(runRecord({ status: "queued" })), undefined);
  assert.equal(buildRunSettledReportContent(runRecord({ status: "running" })), undefined);
});

test("buildRunSettledReportContent builds a failed-outcome report with the extracted reason", () => {
  const content = buildRunSettledReportContent(
    runRecord({ status: "failed", trace: [{ id: "t1", step_no: 1, phase: "final", output_excerpt: "沙箱权限被拒绝", created_at: "2026-07-13T09:05:00.000000Z" }] })
  );
  assert.deepEqual(content, {
    event: "run_settled_report",
    run_id: runId,
    work_item_id: workItemId,
    outcome: "failed",
    title: "重写选题报告第三节",
    reason: "沙箱权限被拒绝"
  });
});

test("buildRunSettledReportContent builds an escalated-outcome report", () => {
  const content = buildRunSettledReportContent(runRecord({ status: "escalated", trace: [] }));
  assert.equal(content?.outcome, "escalated");
  assert.equal(content?.reason, null);
});

// —— createRunConversationReportHook —— //

function fakePoster() {
  const calls: Array<{ workspaceId: string; conversationId: string; content: Record<string, unknown>; at: Date }> = [];
  return {
    calls,
    post: async (input: { workspaceId: string; conversationId: string; content: Record<string, unknown>; at: Date }) => {
      calls.push(input);
      return { id: "posted" };
    }
  };
}

test("createRunConversationReportHook skips runs with no source conversation", async () => {
  const poster = fakePoster();
  const hook = createRunConversationReportHook({ postSystemMessage: poster.post });
  // exactOptionalPropertyTypes：省略这个可选字段（而不是显式赋 undefined）才是"这个 run 没有会话血缘"
  // 的正确表达方式——同 view.ts 里反复出现的同款取舍。
  const { source_conversation_id: _omitted, ...withoutConversation } = runRecord({ status: "failed" });

  await hook(withoutConversation);

  assert.equal(poster.calls.length, 0);
});

test("createRunConversationReportHook skips runs with no workspace id", async () => {
  const poster = fakePoster();
  const hook = createRunConversationReportHook({ postSystemMessage: poster.post });
  const { workspace_id: _omitted, ...withoutWorkspace } = runRecord({ status: "failed" });

  await hook(withoutWorkspace);

  assert.equal(poster.calls.length, 0);
});

test("createRunConversationReportHook does not duplicate the batch-4b deliverable card for succeeded runs", async () => {
  const poster = fakePoster();
  const hook = createRunConversationReportHook({ postSystemMessage: poster.post });

  await hook(runRecord({ status: "succeeded" }));

  assert.equal(poster.calls.length, 0);
});

test("createRunConversationReportHook does not report a cancelled run", async () => {
  const poster = fakePoster();
  const hook = createRunConversationReportHook({ postSystemMessage: poster.post });

  await hook(runRecord({ status: "cancelled" }));

  assert.equal(poster.calls.length, 0);
});

test("createRunConversationReportHook posts a failed report with the workspace/conversation ids and injected clock", async () => {
  const poster = fakePoster();
  const fixedAt = new Date("2026-07-13T10:00:00.000Z");
  const hook = createRunConversationReportHook({ postSystemMessage: poster.post, now: () => fixedAt });

  await hook(
    runRecord({
      status: "failed",
      trace: [{ id: "t1", step_no: 1, phase: "final", output_excerpt: "网络超时", created_at: "2026-07-13T09:05:00.000000Z" }]
    })
  );

  assert.equal(poster.calls.length, 1);
  const call = poster.calls[0]!;
  assert.equal(call.workspaceId, workspaceId);
  assert.equal(call.conversationId, conversationId);
  assert.equal(call.at, fixedAt);
  assert.deepEqual(call.content, {
    event: "run_settled_report",
    run_id: runId,
    work_item_id: workItemId,
    outcome: "failed",
    title: "重写选题报告第三节",
    reason: "网络超时"
  });
});

test("createRunConversationReportHook posts an escalated report", async () => {
  const poster = fakePoster();
  const hook = createRunConversationReportHook({ postSystemMessage: poster.post });

  await hook(runRecord({ status: "escalated" }));

  assert.equal(poster.calls.length, 1);
  assert.equal((poster.calls[0]!.content as { outcome: string }).outcome, "escalated");
});

test("createRunConversationReportHook swallows a poster failure instead of throwing (best-effort, must never trigger the settled-hook retry path)", async () => {
  const hook = createRunConversationReportHook({
    postSystemMessage: async () => {
      throw new Error("db unavailable");
    }
  });

  await assert.doesNotReject(hook(runRecord({ status: "failed" })));
});
