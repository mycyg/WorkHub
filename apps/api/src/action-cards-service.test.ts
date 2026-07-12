import assert from "node:assert/strict";
import test from "node:test";

import type {
  ActionCardItemRow,
  ActionCardRow,
  EscalationEventRow
} from "@workhub/db";

import type { AuthActor } from "./middleware/auth.js";
import { AgentRunnerError, type AgentRunQueueRecord } from "./workers/agent-runner.js";
import {
  ActionCardServiceError,
  createActionCardService,
  type ActionCardServiceOptions
} from "./services/action-cards.js";

const now = new Date("2026-07-12T09:10:00.000Z");
const workspaceId = "13000000-0000-4000-8000-000000000001";
const projectId = "13000000-0000-4000-8000-000000000003";
const conversationId = "13000000-0000-4000-8000-000000000004";
const cardId = "13000000-0000-4000-8000-000000000005";
const messageId = "13000000-0000-4000-8000-000000000006";
const itemId = "13000000-0000-4000-8000-000000000007";
const assigneeUserId = "13000000-0000-4000-8000-000000000008";
const otherUserId = "13000000-0000-4000-8000-000000000011";
const workItemId = "13000000-0000-4000-8000-000000000012";
const runId = "13000000-0000-4000-8000-000000000013";
const escalationId = "13000000-0000-4000-8000-000000000014";

function actor(overrides: Partial<AuthActor> = {}): AuthActor {
  return {
    kind: "human",
    id: assigneeUserId,
    label: "张三",
    userId: assigneeUserId,
    isAdmin: false,
    orgId: "00000000-0000-4000-8000-000000000001",
    workspaceId,
    ...overrides
  };
}

function decideItemRow(overrides: Partial<ActionCardItemRow> = {}): ActionCardItemRow {
  return {
    id: itemId,
    workspaceId,
    projectId,
    conversationId,
    actionCardId: cardId,
    ordinal: 0,
    kind: "decide",
    titleMd: "预算是否砍半",
    confidence: "low",
    workItemId,
    runId: null,
    assigneeUserId,
    status: "waiting_decision",
    undoDeadlineAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function executeItemRow(overrides: Partial<ActionCardItemRow> = {}): ActionCardItemRow {
  return decideItemRow({
    kind: "execute",
    titleMd: "重写第三节",
    confidence: "high",
    status: "running",
    runId,
    undoDeadlineAt: new Date(now.getTime() + 5 * 60 * 1000),
    ...overrides
  });
}

function cardRow(overrides: Partial<ActionCardRow> = {}): ActionCardRow {
  return {
    id: cardId,
    conversationId,
    messageId,
    status: "active",
    analyzedToSeq: 6,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function escalationRow(overrides: Partial<EscalationEventRow> = {}): EscalationEventRow {
  return {
    id: escalationId,
    workItemId,
    agentRunId: null,
    confidenceId: null,
    trigger: "unqualified",
    reasonMd: "预算是否砍半",
    handoffJson: {},
    suggestedLeadUserId: assigneeUserId,
    resolvedAt: null,
    createdAt: now,
    ...overrides
  };
}

function agentRunRow(overrides: Partial<AgentRunQueueRecord> = {}): AgentRunQueueRecord {
  return {
    run_id: runId,
    work_item_id: workItemId,
    actor_id: assigneeUserId,
    mode: "worker",
    status: "cancelled",
    title: "重写第三节",
    budget: { max_steps: 10, total_timeout_s: 300, max_tokens: 120000, max_cost_cny: "5" },
    budget_decision: { decision_id: "d1", allowed: true, model_route: { provider: "anthropic", model: "m", reason: "default" } },
    usage: { steps_used: 1, token_in: 10, token_out: 10, estimated_cost_cny: "0.01" },
    trace: [],
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    ...overrides
  };
}

function baseOptions(overrides: Partial<ActionCardServiceOptions> = {}): ActionCardServiceOptions {
  const defaults: ActionCardServiceOptions = {
    actionCards: {
      async findItemForActor() {
        return { item: decideItemRow(), card: cardRow() };
      },
      async transitionItemStatus(input) {
        return {
          ...decideItemRow(),
          status: input.toStatus,
          ...(input.assigneeUserId !== undefined ? { assigneeUserId: input.assigneeUserId } : {})
        };
      },
      async postSystemMessage() {
        return {
          id: "system-1",
          conversationId,
          seq: 8,
          senderType: "system",
          senderUserId: null,
          kind: "system_event",
          contentJson: {},
          threadRootId: messageId,
          createdAt: now
        };
      },
      async isActiveWorkspaceMember() {
        return true;
      }
    },
    decisions: {
      async listEscalationEventsForWorkItem() {
        return [escalationRow()];
      },
      async resolveEscalation() {
        return { id: escalationId, workItemId, agentRunId: null, projectId, title: "x", reasonMd: "x", trigger: "unqualified", handoffJson: {}, suggestedLeadUserId: assigneeUserId, createdAt: now, resolvedAt: now, workItemStatus: "pm_mode", workspaceId };
      },
      async delegateEscalation() {
        return { id: escalationId, workItemId, agentRunId: null, projectId, title: "x", reasonMd: "x", trigger: "unqualified", handoffJson: {}, suggestedLeadUserId: otherUserId, createdAt: now, resolvedAt: null, workItemStatus: "escalated", workspaceId };
      }
    },
    agentRuns: {
      async abort() {
        return agentRunRow();
      }
    },
    workItems: {
      async transitionWorkItemStatus() {
        return { id: workItemId, status: "cancelled", transitioned: true };
      }
    },
    now: () => now,
    bus: { publish: async () => {} },
    logger: { warn: () => {} }
  };
  return { ...defaults, ...overrides };
}

// ── decide: auth + state guards ─────────────────────────────────────────────────────

test("decide rejects a caller who is neither the assignee nor an admin", async () => {
  const service = createActionCardService(baseOptions());
  await assert.rejects(
    service.decide({ actor: actor({ id: otherUserId, userId: otherUserId }), itemId, action: "defer" }),
    (error: unknown) => error instanceof ActionCardServiceError && error.status === 403
  );
});

test("decide allows an admin who is not the assignee", async () => {
  const service = createActionCardService(baseOptions());
  const result = await service.decide({ actor: actor({ id: otherUserId, userId: otherUserId, isAdmin: true }), itemId, action: "defer" });
  assert.equal(result.status, "dismissed");
});

test("decide rejects a non-'decide' kind item as not decidable", async () => {
  const service = createActionCardService(baseOptions({
    actionCards: { ...baseOptions().actionCards, async findItemForActor() { return { item: executeItemRow(), card: cardRow() }; } }
  }));
  await assert.rejects(
    service.decide({ actor: actor(), itemId, action: "defer" }),
    (error: unknown) => error instanceof ActionCardServiceError && error.status === 422 && error.code === "action_card_item_not_decidable"
  );
});

test("decide rejects an item that is no longer waiting_decision", async () => {
  const service = createActionCardService(baseOptions({
    actionCards: { ...baseOptions().actionCards, async findItemForActor() { return { item: decideItemRow({ status: "dismissed" }), card: cardRow() }; } }
  }));
  await assert.rejects(
    service.decide({ actor: actor(), itemId, action: "defer" }),
    (error: unknown) => error instanceof ActionCardServiceError && error.status === 409
  );
});

test("decide returns 404 when the item does not resolve for this workspace", async () => {
  const service = createActionCardService(baseOptions({
    actionCards: { ...baseOptions().actionCards, async findItemForActor() { return null; } }
  }));
  await assert.rejects(
    service.decide({ actor: actor(), itemId, action: "defer" }),
    (error: unknown) => error instanceof ActionCardServiceError && error.status === 404
  );
});

test("decide surfaces a conflict when no unresolved escalation is found for the work item", async () => {
  const service = createActionCardService(baseOptions({
    decisions: { ...baseOptions().decisions, async listEscalationEventsForWorkItem() { return [escalationRow({ resolvedAt: now })]; } }
  }));
  await assert.rejects(
    service.decide({ actor: actor(), itemId, action: "defer" }),
    (error: unknown) => error instanceof ActionCardServiceError && error.status === 409 && error.code === "action_card_decision_already_resolved"
  );
});

// ── decide: claim ────────────────────────────────────────────────────────────────────

test("decide claim resolves the escalation to pm_mode and assigns the item to the caller", async () => {
  const resolveCalls: unknown[] = [];
  const published: unknown[] = [];
  const service = createActionCardService(baseOptions({
    decisions: {
      ...baseOptions().decisions,
      async resolveEscalation(input) {
        resolveCalls.push(input);
        return { id: escalationId, workItemId, agentRunId: null, projectId, title: "x", reasonMd: "x", trigger: "unqualified", handoffJson: {}, suggestedLeadUserId: assigneeUserId, createdAt: now, resolvedAt: now, workItemStatus: "pm_mode", workspaceId };
      }
    },
    bus: { publish: async (topic, type, event) => { published.push({ topic, type, event }); } }
  }));

  const result = await service.decide({ actor: actor(), itemId, action: "claim" });
  assert.equal(result.status, "running");
  assert.deepEqual((resolveCalls[0] as { targetStatus: string }).targetStatus, "pm_mode");
  assert.equal(published.length, 1);
  const event = (published[0] as { event: { data: { items: Array<{ status: string }> } } }).event;
  assert.equal(event.data.items[0]?.status, "running");
});

test("decide claim surfaces a conflict when the escalation was already resolved by a concurrent request", async () => {
  const service = createActionCardService(baseOptions({
    decisions: { ...baseOptions().decisions, async resolveEscalation() { return null; } }
  }));
  await assert.rejects(
    service.decide({ actor: actor(), itemId, action: "claim" }),
    (error: unknown) => error instanceof ActionCardServiceError && error.status === 409
  );
});

// ── decide: reassign ─────────────────────────────────────────────────────────────────

test("decide reassign requires an assignee_user_id", async () => {
  const service = createActionCardService(baseOptions());
  await assert.rejects(
    service.decide({ actor: actor(), itemId, action: "reassign" }),
    (error: unknown) => error instanceof ActionCardServiceError && error.status === 400
  );
});

test("decide reassign rejects a target who is not an active workspace member", async () => {
  const service = createActionCardService(baseOptions({
    actionCards: { ...baseOptions().actionCards, async isActiveWorkspaceMember() { return false; } }
  }));
  await assert.rejects(
    service.decide({ actor: actor(), itemId, action: "reassign", assigneeUserId: otherUserId }),
    (error: unknown) => error instanceof ActionCardServiceError && error.status === 422
  );
});

test("decide reassign delegates the escalation, updates the assignee, and threads a system note", async () => {
  const delegateCalls: unknown[] = [];
  const noteCalls: unknown[] = [];
  const service = createActionCardService(baseOptions({
    decisions: {
      ...baseOptions().decisions,
      async delegateEscalation(input) {
        delegateCalls.push(input);
        return { id: escalationId, workItemId, agentRunId: null, projectId, title: "x", reasonMd: "x", trigger: "unqualified", handoffJson: {}, suggestedLeadUserId: otherUserId, createdAt: now, resolvedAt: null, workItemStatus: "escalated", workspaceId };
      }
    },
    actionCards: {
      ...baseOptions().actionCards,
      async postSystemMessage(input) {
        noteCalls.push(input);
        return { id: "system-1", conversationId, seq: 8, senderType: "system", senderUserId: null, kind: "system_event", contentJson: {}, threadRootId: input.threadRootId ?? null, createdAt: now };
      }
    }
  }));

  const result = await service.decide({ actor: actor(), itemId, action: "reassign", assigneeUserId: otherUserId });
  assert.equal(result.status, "waiting_decision");
  assert.equal(result.assignee_user_id, otherUserId);
  assert.equal((delegateCalls[0] as { toUserId: string }).toUserId, otherUserId);
  assert.equal((noteCalls[0] as { threadRootId: string }).threadRootId, messageId);
});

// ── decide: defer ────────────────────────────────────────────────────────────────────

test("decide defer dismisses the item and leaves the escalation untouched", async () => {
  let resolveCalled = false;
  let delegateCalled = false;
  const service = createActionCardService(baseOptions({
    decisions: {
      ...baseOptions().decisions,
      async resolveEscalation() { resolveCalled = true; return null; },
      async delegateEscalation() { delegateCalled = true; return null; }
    }
  }));
  const result = await service.decide({ actor: actor(), itemId, action: "defer" });
  assert.equal(result.status, "dismissed");
  assert.equal(resolveCalled, false);
  assert.equal(delegateCalled, false);
});

// ── undo ─────────────────────────────────────────────────────────────────────────────

test("undo rejects items with no run, wrong status, or an expired window", async () => {
  const noRun = createActionCardService(baseOptions({
    actionCards: { ...baseOptions().actionCards, async findItemForActor() { return { item: executeItemRow({ runId: null }), card: cardRow() }; } }
  }));
  await assert.rejects(
    noRun.undo({ actor: actor(), itemId }),
    (error: unknown) => error instanceof ActionCardServiceError && error.code === "action_card_item_not_undoable"
  );

  const expired = createActionCardService(baseOptions({
    actionCards: { ...baseOptions().actionCards, async findItemForActor() { return { item: executeItemRow({ undoDeadlineAt: new Date(now.getTime() - 1000) }), card: cardRow() }; } }
  }));
  await assert.rejects(
    expired.undo({ actor: actor(), itemId }),
    (error: unknown) => error instanceof ActionCardServiceError && error.code === "action_card_item_not_undoable"
  );

  const wrongStatus = createActionCardService(baseOptions({
    actionCards: { ...baseOptions().actionCards, async findItemForActor() { return { item: executeItemRow({ status: "done" }), card: cardRow() }; } }
  }));
  await assert.rejects(
    wrongStatus.undo({ actor: actor(), itemId }),
    (error: unknown) => error instanceof ActionCardServiceError && error.code === "action_card_item_not_undoable"
  );
});

test("undo aborts the run, cancels the work item, marks the item undone, and threads a trace note", async () => {
  const abortCalls: unknown[] = [];
  const transitionCalls: unknown[] = [];
  const noteCalls: unknown[] = [];
  const service = createActionCardService(baseOptions({
    actionCards: {
      ...baseOptions().actionCards,
      async findItemForActor() { return { item: executeItemRow(), card: cardRow() }; },
      async postSystemMessage(input) { noteCalls.push(input); return { id: "system-1", conversationId, seq: 8, senderType: "cuu", senderUserId: null, kind: "system_event", contentJson: {}, threadRootId: input.threadRootId ?? null, createdAt: now }; }
    },
    agentRuns: { async abort(id, who) { abortCalls.push({ id, who }); return agentRunRow(); } },
    workItems: { async transitionWorkItemStatus(input) { transitionCalls.push(input); return { id: workItemId, status: "cancelled", transitioned: true }; } }
  }));

  const result = await service.undo({ actor: actor(), itemId });
  assert.equal(result.status, "undone");
  assert.equal((abortCalls[0] as { id: string }).id, runId);
  assert.equal((transitionCalls[0] as { to: string }).to, "cancelled");
  assert.equal((noteCalls[0] as { threadRootId: string }).threadRootId, messageId);
});

test("undo still closes the work item when the run already settled on its own", async () => {
  const service = createActionCardService(baseOptions({
    actionCards: { ...baseOptions().actionCards, async findItemForActor() { return { item: executeItemRow(), card: cardRow() }; } },
    agentRuns: {
      async abort() {
        throw new AgentRunnerError(409, "agent_run_already_settled", "这次 AI 执行已经结束。");
      }
    }
  }));
  const result = await service.undo({ actor: actor(), itemId });
  assert.equal(result.status, "undone");
});

test("undo rethrows unexpected abort errors without closing the work item", async () => {
  let transitioned = false;
  const service = createActionCardService(baseOptions({
    actionCards: { ...baseOptions().actionCards, async findItemForActor() { return { item: executeItemRow(), card: cardRow() }; } },
    agentRuns: {
      async abort() {
        throw new AgentRunnerError(403, "agent_run_abort_forbidden", "只有发起人或管理员可以取消这次 AI 执行。");
      }
    },
    workItems: { async transitionWorkItemStatus() { transitioned = true; return { id: workItemId, status: "cancelled", transitioned: true }; } }
  }));
  await assert.rejects(
    service.undo({ actor: actor(), itemId }),
    (error: unknown) => error instanceof AgentRunnerError && error.code === "agent_run_abort_forbidden"
  );
  assert.equal(transitioned, false);
});

test("undo surfaces a conflict when the work item can no longer transition to cancelled", async () => {
  const service = createActionCardService(baseOptions({
    actionCards: { ...baseOptions().actionCards, async findItemForActor() { return { item: executeItemRow(), card: cardRow() }; } },
    workItems: { async transitionWorkItemStatus() { return null; } }
  }));
  await assert.rejects(
    service.undo({ actor: actor(), itemId }),
    (error: unknown) => error instanceof ActionCardServiceError && error.status === 409 && error.code === "action_card_item_not_undoable"
  );
});

test("undo rejects a caller who is neither the assignee nor an admin", async () => {
  const service = createActionCardService(baseOptions({
    actionCards: { ...baseOptions().actionCards, async findItemForActor() { return { item: executeItemRow(), card: cardRow() }; } }
  }));
  await assert.rejects(
    service.undo({ actor: actor({ id: otherUserId, userId: otherUserId }), itemId }),
    (error: unknown) => error instanceof ActionCardServiceError && error.status === 403
  );
});
