import assert from "node:assert/strict";
import test from "node:test";

import type { ActionCardItemRow, TransitionItemStatusInput } from "@workhub/db";

import {
  actionCardItemStatusForRunStatus,
  createActionCardRunSettlementHook
} from "./action-card-run-settlement.js";
import type { AgentRunQueueRecord } from "../workers/agent-runner.js";

const runId = "10000000-0000-4000-8000-000000000030";
const workItemId = "10000000-0000-4000-8000-000000000020";
const itemId = "10000000-0000-4000-8000-000000000050";
const workspaceId = "10000000-0000-4000-8000-000000000001";

function runRecord(partial: Partial<AgentRunQueueRecord> = {}): AgentRunQueueRecord {
  return {
    run_id: runId,
    work_item_id: workItemId,
    actor_id: "10000000-0000-4000-8000-000000000010",
    mode: "worker",
    status: "succeeded",
    title: "重写选题报告第三节",
    source_action_card_item_id: itemId,
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

function fakeActionCardRepository(
  options: { result?: ActionCardItemRow | null; throwError?: Error } = {}
) {
  const calls: TransitionItemStatusInput[] = [];
  return {
    calls,
    transitionItemStatus: async (input: TransitionItemStatusInput): Promise<ActionCardItemRow | null> => {
      calls.push(input);
      if (options.throwError) {
        throw options.throwError;
      }
      return options.result ?? null;
    }
  };
}

// —— actionCardItemStatusForRunStatus (纯函数：四终态映射) —— //

test("actionCardItemStatusForRunStatus maps succeeded to done", () => {
  assert.equal(actionCardItemStatusForRunStatus("succeeded"), "done");
});

test("actionCardItemStatusForRunStatus maps failed to escalated", () => {
  assert.equal(actionCardItemStatusForRunStatus("failed"), "escalated");
});

test("actionCardItemStatusForRunStatus maps escalated to escalated", () => {
  assert.equal(actionCardItemStatusForRunStatus("escalated"), "escalated");
});

test("actionCardItemStatusForRunStatus maps cancelled to undone", () => {
  assert.equal(actionCardItemStatusForRunStatus("cancelled"), "undone");
});

test("actionCardItemStatusForRunStatus returns undefined for non-terminal statuses (defensive; should never be called at settle time)", () => {
  assert.equal(actionCardItemStatusForRunStatus("queued"), undefined);
  assert.equal(actionCardItemStatusForRunStatus("running"), undefined);
});

// —— createActionCardRunSettlementHook —— //

test("createActionCardRunSettlementHook skips runs with no source action-card item (not dispatched from an action card)", async () => {
  const repo = fakeActionCardRepository();
  const hook = createActionCardRunSettlementHook({ actionCards: repo });
  const { source_action_card_item_id: _omitted, ...withoutSourceItem } = runRecord({ status: "succeeded" });

  await hook(withoutSourceItem);

  assert.equal(repo.calls.length, 0);
});

test("createActionCardRunSettlementHook skips non-terminal statuses defensively", async () => {
  const repo = fakeActionCardRepository();
  const hook = createActionCardRunSettlementHook({ actionCards: repo });

  await hook(runRecord({ status: "queued" }));
  await hook(runRecord({ status: "running" }));

  assert.equal(repo.calls.length, 0);
});

test("createActionCardRunSettlementHook warns and skips when the run has no workspace id", async () => {
  const repo = fakeActionCardRepository();
  const warnCalls: Array<{ event: string; fields: Record<string, unknown> | undefined }> = [];
  const hook = createActionCardRunSettlementHook({
    actionCards: repo,
    logger: { warn: (event, fields) => warnCalls.push({ event, fields }) }
  });
  const { workspace_id: _omitted, ...withoutWorkspace } = runRecord({ status: "succeeded" });

  await hook(withoutWorkspace);

  assert.equal(repo.calls.length, 0);
  assert.equal(warnCalls.length, 1);
  assert.equal(warnCalls[0]?.event, "action_card_run_settlement_missing_workspace");
});

test("createActionCardRunSettlementHook settles a succeeded run to done via a CAS from running, with the injected clock", async () => {
  const repo = fakeActionCardRepository({ result: null });
  const fixedAt = new Date("2026-07-13T10:00:00.000Z");
  const hook = createActionCardRunSettlementHook({ actionCards: repo, now: () => fixedAt });

  await hook(runRecord({ status: "succeeded" }));

  assert.equal(repo.calls.length, 1);
  assert.deepEqual(repo.calls[0], {
    itemId,
    workspaceId,
    fromStatuses: ["running"],
    toStatus: "done",
    at: fixedAt
  });
});

test("createActionCardRunSettlementHook settles a failed run to escalated", async () => {
  const repo = fakeActionCardRepository();
  const hook = createActionCardRunSettlementHook({ actionCards: repo });

  await hook(runRecord({ status: "failed" }));

  assert.equal(repo.calls.length, 1);
  assert.equal(repo.calls[0]?.toStatus, "escalated");
  assert.deepEqual(repo.calls[0]?.fromStatuses, ["running"]);
});

test("createActionCardRunSettlementHook settles an escalated run to escalated", async () => {
  const repo = fakeActionCardRepository();
  const hook = createActionCardRunSettlementHook({ actionCards: repo });

  await hook(runRecord({ status: "escalated" }));

  assert.equal(repo.calls.length, 1);
  assert.equal(repo.calls[0]?.toStatus, "escalated");
  assert.deepEqual(repo.calls[0]?.fromStatuses, ["running"]);
});

test("createActionCardRunSettlementHook settles a cancelled run to undone", async () => {
  const repo = fakeActionCardRepository();
  const hook = createActionCardRunSettlementHook({ actionCards: repo });

  await hook(runRecord({ status: "cancelled" }));

  assert.equal(repo.calls.length, 1);
  assert.equal(repo.calls[0]?.toStatus, "undone");
  assert.deepEqual(repo.calls[0]?.fromStatuses, ["running"]);
});

test("createActionCardRunSettlementHook treats a lost CAS race (item already moved off running, e.g. by a prior undo) as a silent no-op, not a failure", async () => {
  // 模拟：条目已经被别的动作(先前一次结算重放 / 已经完成的 undo())转出 running，
  // transitionItemStatus 的 CAS 落空返回 null —— 这里必须安静地成功，不抛错、不当失败处理。
  const repo = fakeActionCardRepository({ result: null });
  const warnCalls: unknown[] = [];
  const hook = createActionCardRunSettlementHook({
    actionCards: repo,
    logger: { warn: (...args) => warnCalls.push(args) }
  });

  await assert.doesNotReject(hook(runRecord({ status: "cancelled" })));

  assert.equal(repo.calls.length, 1);
  assert.equal(warnCalls.length, 0);
});

test("createActionCardRunSettlementHook swallows a repository failure instead of throwing (best-effort, must never trigger the settled-hook retry path)", async () => {
  const repo = fakeActionCardRepository({ throwError: new Error("db unavailable") });
  const warnCalls: Array<{ event: string; fields: Record<string, unknown> | undefined }> = [];
  const hook = createActionCardRunSettlementHook({
    actionCards: repo,
    logger: { warn: (event, fields) => warnCalls.push({ event, fields }) }
  });

  await assert.doesNotReject(hook(runRecord({ status: "failed" })));

  assert.equal(warnCalls.length, 1);
  assert.equal(warnCalls[0]?.event, "action_card_run_settlement_failed");
});
