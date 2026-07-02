import assert from "node:assert/strict";
import test from "node:test";

import type { TaskPlanItemRow, TaskPlanRow, TaskPlanWithItems } from "@workhub/db";

import {
  createTaskDispatcher,
  type TaskDispatcherRepository
} from "./services/task-dispatcher.js";
import type {
  AgentRunQueue,
  AgentRunQueueRecord,
  EnqueueAgentRunInput
} from "./workers/agent-runner.js";

const now = new Date("2026-07-03T04:00:00.000Z");
const planId = "95000000-0000-4000-8000-000000000101";
const workItemId = "95000000-0000-4000-8000-000000000102";
const workspaceId = "95000000-0000-4000-8000-000000000103";
const orgId = "95000000-0000-4000-8000-000000000104";
const actorId = "95000000-0000-4000-8000-000000000105";
const parentRunId = "95000000-0000-4000-8000-000000000106";
const objectiveId = "95000000-0000-4000-8000-000000000107";
const researchItemId = "95000000-0000-4000-8000-000000000201";
const produceItemId = "95000000-0000-4000-8000-000000000202";
const reviewItemId = "95000000-0000-4000-8000-000000000203";

function plan(status: TaskPlanRow["status"] = "approved"): TaskPlanRow {
  return {
    id: planId,
    workItemId,
    workspaceId,
    status,
    objectiveId,
    budgetJson: { total_share_pct: 100 },
    decompositionContextJson: { source: "test" },
    createdByUserId: actorId,
    createdAt: now,
    updatedAt: now
  } as TaskPlanRow;
}

function item(input: {
  id: string;
  seq: number;
  title: string;
  role: TaskPlanItemRow["role"];
  status?: TaskPlanItemRow["status"];
  dependsOn?: string[];
  budgetSharePct?: number;
}): TaskPlanItemRow {
  return {
    id: input.id,
    planId,
    parentItemId: null,
    seq: input.seq,
    title: input.title,
    role: input.role,
    objectiveMd: `${input.title} objective.`,
    acceptanceMd: `${input.title} acceptance.`,
    budgetSharePct: input.budgetSharePct ?? 33,
    dependsOn: input.dependsOn ?? [],
    status: input.status ?? "pending",
    createdAt: now,
    updatedAt: now
  } as TaskPlanItemRow;
}

function run(input: {
  status: AgentRunQueueRecord["status"];
  taskPlanItemId?: string;
  workspaceId?: string;
}): AgentRunQueueRecord {
  return {
    run_id: "96000000-0000-4000-8000-000000000301",
    org_id: orgId,
    ...(input.workspaceId ? { workspace_id: input.workspaceId } : {}),
    work_item_id: workItemId,
    parent_run_id: parentRunId,
    task_plan_id: planId,
    ...(input.taskPlanItemId ? { task_plan_item_id: input.taskPlanItemId } : {}),
    actor_id: actorId,
    mode: "worker",
    status: input.status,
    title: "Child run",
    budget: {
      max_steps: 8,
      total_timeout_s: 60,
      max_tokens: 2000,
      max_cost_cny: "1"
    },
    budget_decision: {
      decision_id: "budget",
      allowed: true,
      model_route: { provider: "deepseek", model: "deepseek-v4-flash", reason: "default" }
    },
    usage: {
      steps_used: 0,
      token_in: 0,
      token_out: 0,
      estimated_cost_cny: "0"
    },
    trace: [],
    created_at: now.toISOString(),
    updated_at: now.toISOString()
  };
}

class MemoryTaskDispatcherRepository implements TaskDispatcherRepository {
  public startCalls = 0;
  public doneCalls = 0;
  public markDispatchedMisses = new Set<string>();

  constructor(
    public row: TaskPlanRow,
    public readonly items: TaskPlanItemRow[]
  ) {}

  async getPlanWithItems(input: { planId: string; workspaceId: string; itemLimit?: number }): Promise<TaskPlanWithItems | null> {
    assert.equal(input.itemLimit, 100);
    if (input.planId !== this.row.id || input.workspaceId !== this.row.workspaceId) {
      return null;
    }
    return {
      plan: this.row,
      items: [...this.items].sort((left, right) => left.seq - right.seq || left.id.localeCompare(right.id)),
      itemsCapped: false
    };
  }

  async startDispatchingPlan(input: { planId: string; workspaceId: string; startedAt?: Date }) {
    this.startCalls += 1;
    if (input.planId !== this.row.id || input.workspaceId !== this.row.workspaceId || this.row.status !== "approved") {
      return null;
    }
    this.row = { ...this.row, status: "dispatching", updatedAt: input.startedAt ?? now };
    return this.row;
  }

  async markItemDispatched(input: { planId: string; itemId: string; dispatchedAt?: Date }) {
    if (this.markDispatchedMisses.has(input.itemId)) {
      return null;
    }
    const current = this.items.find((candidate) => candidate.planId === input.planId && candidate.id === input.itemId);
    if (!current || current.status !== "pending") {
      return null;
    }
    current.status = "dispatched";
    current.updatedAt = input.dispatchedAt ?? now;
    return current;
  }

  async settleDispatchedItem(input: {
    planId: string;
    itemId: string;
    status: "succeeded" | "failed";
    settledAt?: Date;
  }) {
    const current = this.items.find((candidate) => candidate.planId === input.planId && candidate.id === input.itemId);
    if (!current || current.status !== "dispatched") {
      return null;
    }
    current.status = input.status;
    current.updatedAt = input.settledAt ?? now;
    return current;
  }

  async skipPendingItems(input: { planId: string; itemIds: string[]; skippedAt?: Date }) {
    const updated: TaskPlanItemRow[] = [];
    for (const current of this.items) {
      if (current.planId === input.planId && input.itemIds.includes(current.id) && current.status === "pending") {
        current.status = "skipped";
        current.updatedAt = input.skippedAt ?? now;
        updated.push(current);
      }
    }
    return updated;
  }

  async markPlanDone(input: { planId: string; workspaceId: string; doneAt?: Date }) {
    this.doneCalls += 1;
    if (input.planId !== this.row.id || input.workspaceId !== this.row.workspaceId || this.row.status !== "dispatching") {
      return null;
    }
    this.row = { ...this.row, status: "done", updatedAt: input.doneAt ?? now };
    return this.row;
  }
}

class CapturingQueue implements Pick<AgentRunQueue, "enqueue"> {
  public readonly inputs: EnqueueAgentRunInput[] = [];

  async enqueue(input: EnqueueAgentRunInput) {
    this.inputs.push(structuredClone(input));
    return run({
      status: "queued",
      ...(input.taskPlanItemId ? { taskPlanItemId: input.taskPlanItemId } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {})
    });
  }
}

test("R9.2 dispatcher enqueues ready task-plan items as ordinary child runs with lineage and acceptance", async () => {
  const repository = new MemoryTaskDispatcherRepository(plan(), [
    item({ id: researchItemId, seq: 0, title: "Research", role: "research", budgetSharePct: 35 }),
    item({ id: produceItemId, seq: 1, title: "Produce", role: "produce", dependsOn: [researchItemId], budgetSharePct: 45 }),
    item({ id: reviewItemId, seq: 2, title: "Review", role: "review", budgetSharePct: 20 })
  ]);
  const queue = new CapturingQueue();
  const dispatcher = createTaskDispatcher({ repository, queue, now: () => now });

  const result = await dispatcher.dispatch({ planId, workspaceId, orgId, actorId, parentRunId });

  assert.deepEqual(result.enqueuedItemIds, [researchItemId, reviewItemId]);
  assert.equal(repository.row.status, "dispatching");
  assert.equal(repository.startCalls, 1);
  assert.deepEqual(queue.inputs.map((input) => input.taskPlanItemId), [researchItemId, reviewItemId]);
  assert.deepEqual(queue.inputs.map((input) => input.agentRole), ["research", "review"]);
  assert.equal(queue.inputs[0]?.workItemId, workItemId);
  assert.equal(queue.inputs[0]?.parentRunId, parentRunId);
  assert.equal(queue.inputs[0]?.taskPlanId, planId);
  assert.equal(queue.inputs[0]?.objectiveId, objectiveId);
  assert.equal(queue.inputs[0]?.workspaceId, workspaceId);
  assert.equal(queue.inputs[0]?.orgId, orgId);
  assert.match(queue.inputs[0]?.objectiveMd ?? "", /Research objective\./u);
  assert.match(queue.inputs[0]?.objectiveMd ?? "", /Research acceptance\./u);
  assert.match(queue.inputs[0]?.objectiveMd ?? "", /Budget share: 35%/u);
  assert.equal(repository.items.find((candidate) => candidate.id === produceItemId)?.status, "pending");
});

test("R9.2 dispatcher respects item CAS misses and does not duplicate child enqueue", async () => {
  const repository = new MemoryTaskDispatcherRepository(plan(), [
    item({ id: researchItemId, seq: 0, title: "Research", role: "research" })
  ]);
  repository.markDispatchedMisses.add(researchItemId);
  const queue = new CapturingQueue();
  const dispatcher = createTaskDispatcher({ repository, queue, now: () => now });

  const result = await dispatcher.dispatch({ planId, workspaceId, actorId });

  assert.deepEqual(result.enqueuedItemIds, []);
  assert.deepEqual(result.casMissItemIds, [researchItemId]);
  assert.equal(queue.inputs.length, 0);
});

test("R9.2 dispatcher run-settled callback advances succeeded items and unlocks downstream work", async () => {
  const repository = new MemoryTaskDispatcherRepository(plan("dispatching"), [
    item({ id: researchItemId, seq: 0, title: "Research", role: "research", status: "dispatched" }),
    item({ id: produceItemId, seq: 1, title: "Produce", role: "produce", dependsOn: [researchItemId] })
  ]);
  const queue = new CapturingQueue();
  const dispatcher = createTaskDispatcher({ repository, queue, now: () => now });

  const result = await dispatcher.handleRunSettled(run({
    status: "succeeded",
    taskPlanItemId: researchItemId,
    workspaceId
  }));

  assert.equal(result?.settledItemId, researchItemId);
  assert.equal(repository.items.find((candidate) => candidate.id === researchItemId)?.status, "succeeded");
  assert.equal(repository.items.find((candidate) => candidate.id === produceItemId)?.status, "dispatched");
  assert.deepEqual(queue.inputs.map((input) => input.taskPlanItemId), [produceItemId]);
});

test("R9.2 dispatcher skips dependency-failed pending items and escalates the plan", async () => {
  const escalations: string[] = [];
  const repository = new MemoryTaskDispatcherRepository(plan("dispatching"), [
    item({ id: researchItemId, seq: 0, title: "Research", role: "research", status: "dispatched" }),
    item({ id: produceItemId, seq: 1, title: "Produce", role: "produce", dependsOn: [researchItemId] }),
    item({ id: reviewItemId, seq: 2, title: "Review", role: "review", dependsOn: [produceItemId] })
  ]);
  const queue = new CapturingQueue();
  const dispatcher = createTaskDispatcher({
    repository,
    queue,
    now: () => now,
    escalationSink: async (input) => { escalations.push(input.reason); }
  });

  const result = await dispatcher.handleRunSettled(run({
    status: "failed",
    taskPlanItemId: researchItemId,
    workspaceId
  }));

  assert.equal(result?.settledItemId, researchItemId);
  assert.equal(repository.items.find((candidate) => candidate.id === researchItemId)?.status, "failed");
  assert.equal(repository.items.find((candidate) => candidate.id === produceItemId)?.status, "skipped");
  assert.equal(repository.items.find((candidate) => candidate.id === reviewItemId)?.status, "skipped");
  assert.deepEqual(queue.inputs, []);
  assert.deepEqual(escalations, ["dependency_failed"]);
});

test("R9.2 dispatcher skips cyclic plans and escalates without enqueueing children", async () => {
  const escalations: string[] = [];
  const repository = new MemoryTaskDispatcherRepository(plan(), [
    item({ id: researchItemId, seq: 0, title: "Research", role: "research", dependsOn: [produceItemId] }),
    item({ id: produceItemId, seq: 1, title: "Produce", role: "produce", dependsOn: [researchItemId] })
  ]);
  const queue = new CapturingQueue();
  const dispatcher = createTaskDispatcher({
    repository,
    queue,
    now: () => now,
    escalationSink: async (input) => { escalations.push(input.reason); }
  });

  const result = await dispatcher.dispatch({ planId, workspaceId, actorId });

  assert.deepEqual(result.enqueuedItemIds, []);
  assert.deepEqual(result.skippedItemIds.sort(), [produceItemId, researchItemId].sort());
  assert.equal(repository.items.every((candidate) => candidate.status === "skipped"), true);
  assert.deepEqual(queue.inputs, []);
  assert.deepEqual(escalations, ["cycle"]);
});
