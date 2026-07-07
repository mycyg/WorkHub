import assert from "node:assert/strict";
import test from "node:test";

import type { TaskPlanItemRow, TaskPlanRow, TaskPlanWithItems } from "@workhub/db";

import {
  createDbTaskDispatchEscalationSink,
  createTaskDispatcher,
  type TaskDispatchArbitrationSink,
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
    dispatchEpoch: input.status === "dispatched" ? 1 : 0,
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

  async markItemDispatched(input: { planId: string; workspaceId: string; itemId: string; dispatchedAt?: Date }) {
    assert.equal(input.workspaceId, this.row.workspaceId);
    if (this.markDispatchedMisses.has(input.itemId)) {
      return null;
    }
    const current = this.items.find((candidate) => candidate.planId === input.planId && candidate.id === input.itemId);
    if (!current || current.status !== "pending") {
      return null;
    }
    current.status = "dispatched";
    (current as { dispatchEpoch: number }).dispatchEpoch = ((current as { dispatchEpoch?: number }).dispatchEpoch ?? 0) + 1;
    current.updatedAt = input.dispatchedAt ?? now;
    return current;
  }

  async settleDispatchedItem(input: {
    planId: string;
    workspaceId: string;
    itemId: string;
    status: "succeeded" | "failed";
    epoch?: number;
    settledAt?: Date;
  }) {
    assert.equal(input.workspaceId, this.row.workspaceId);
    const current = this.items.find((candidate) => candidate.planId === input.planId && candidate.id === input.itemId);
    if (!current || current.status !== "dispatched") {
      return null;
    }
    if (input.epoch !== undefined && (current as { dispatchEpoch?: number }).dispatchEpoch !== input.epoch) {
      return null;
    }
    current.status = input.status;
    current.updatedAt = input.settledAt ?? now;
    return current;
  }

  async skipPendingItems(input: { planId: string; workspaceId: string; itemIds: string[]; skippedAt?: Date }) {
    assert.equal(input.workspaceId, this.row.workspaceId);
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

class CappedTaskDispatcherRepository extends MemoryTaskDispatcherRepository {
  async getPlanWithItems(input: { planId: string; workspaceId: string; itemLimit?: number }): Promise<TaskPlanWithItems | null> {
    const loaded = await super.getPlanWithItems(input);
    return loaded ? { ...loaded, itemsCapped: true } : null;
  }
}

class CapturingQueue implements Pick<AgentRunQueue, "enqueue" | "runNext"> {
  public readonly inputs: EnqueueAgentRunInput[] = [];
  public runNextCalls = 0;
  public runNextResult: AgentRunQueueRecord | null = null;

  async enqueue(input: EnqueueAgentRunInput) {
    this.inputs.push(structuredClone(input));
    return run({
      status: "queued",
      ...(input.taskPlanItemId ? { taskPlanItemId: input.taskPlanItemId } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {})
    });
  }

  async runNext() {
    this.runNextCalls += 1;
    return this.runNextResult;
  }
}

test("R9.7 dispatcher user-facing errors avoid dispatch wording", async () => {
  const repository = new CappedTaskDispatcherRepository(plan(), [
    item({ id: researchItemId, seq: 0, title: "Research", role: "research" })
  ]);
  const dispatcher = createTaskDispatcher({ repository, queue: new CapturingQueue(), now: () => now });

  await assert.rejects(
    dispatcher.dispatch({ planId, workspaceId, actorId }),
    (error: unknown) => error instanceof Error
      && (error as { code?: string }).code === "task_plan_items_capped"
      && !/dispatch|派发/iu.test(error.message)
  );
});

test("R9.7 dispatcher escalation attention copy avoids dispatch wording", async () => {
  const reasons: string[] = [];
  const sink = createDbTaskDispatchEscalationSink({
    async createEscalationEvent(input) {
      reasons.push(input.reasonMd);
      return {} as Awaited<ReturnType<Parameters<typeof createDbTaskDispatchEscalationSink>[0]["createEscalationEvent"]>>;
    }
  });

  await sink({
    plan: plan("dispatching"),
    items: [
      item({ id: researchItemId, seq: 0, title: "Research", role: "research", status: "skipped" }),
      item({ id: produceItemId, seq: 1, title: "Produce", role: "produce", status: "skipped" })
    ],
    skippedItemIds: [researchItemId, produceItemId],
    reason: "cycle",
    at: now
  });

  assert.equal(reasons.length, 1);
  assert.doesNotMatch(reasons.join("\n"), /dispatch|派发/iu);
});

test("R9.0 dispatcher escalation reasons are human sentences for every branch", async () => {
  // ux-flow-spec §1.2 无黑话验收：reasonMd 必须是完整人话中文（正向断言，
  // 不再只靠「不含 dispatch」的负向断言撑覆盖）。
  const reasons = new Map<string, string>();
  const sink = createDbTaskDispatchEscalationSink({
    async createEscalationEvent(input) {
      reasons.set((input.handoffJson as { reason?: string }).reason ?? "unknown", input.reasonMd);
      return {} as Awaited<ReturnType<Parameters<typeof createDbTaskDispatchEscalationSink>[0]["createEscalationEvent"]>>;
    }
  });

  const baseInput = {
    plan: plan("dispatching"),
    items: [item({ id: researchItemId, seq: 0, title: "Research", role: "research", status: "failed" })],
    skippedItemIds: [] as string[],
    at: now
  };
  await sink({ ...baseInput, reason: "cycle" });
  await sink({ ...baseInput, reason: "partial_failure", failedItemIds: [researchItemId] });
  await sink({ ...baseInput, reason: "dependency_failed", failedItemIds: [researchItemId] });
  await sink({ ...baseInput, reason: "arbitration_blocked", reasonMd: "两份草稿的数据口径不一致。" });

  assert.equal(reasons.get("cycle"), "任务计划依赖图存在循环，已跳过尚未开始的子任务，请人工调整计划后重试。");
  assert.equal(reasons.get("partial_failure"), "任务计划已有子任务失败，请在决策收件箱选择重试、转人工或改计划。");
  assert.equal(reasons.get("dependency_failed"), "任务计划的上游子任务失败或被跳过，依赖它的子任务已跳过，请人工决定是否重试或改计划。");
  assert.equal(
    reasons.get("arbitration_blocked"),
    "跨 Agent 仲裁未通过，请在决策收件箱选择重试、转人工或改计划。\n仲裁理由：两份草稿的数据口径不一致。"
  );
  for (const reasonMd of reasons.values()) {
    // 每条都是人话句子：无裸枚举/错误码/英文黑话。
    assert.doesNotMatch(reasonMd, /[a-z_]{3,}:|grade \d|confidence|enum|null|undefined/iu);
  }
});

test("R9.0 partial failure keeps independent pending siblings dispatching", async () => {
  // ux-flow-spec §1.2「其余子任务不受影响继续跑」：A 失败只连坐依赖 A 的 C，
  // 无依赖的 pending 兄弟 B 必须照常入队（部分失败是一等公民）。
  const escalations: string[] = [];
  const repository = new MemoryTaskDispatcherRepository(plan("dispatching"), [
    item({ id: researchItemId, seq: 0, title: "Research", role: "research", status: "dispatched" }),
    item({ id: produceItemId, seq: 1, title: "Produce", role: "produce" }),
    item({ id: reviewItemId, seq: 2, title: "Review", role: "review", dependsOn: [researchItemId] })
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
  assert.equal(repository.items.find((candidate) => candidate.id === reviewItemId)?.status, "skipped");
  // 独立兄弟继续跑：B 从 pending 真被派发进队列。
  assert.equal(repository.items.find((candidate) => candidate.id === produceItemId)?.status, "dispatched");
  assert.deepEqual(queue.inputs.map((input) => input.taskPlanItemId), [produceItemId]);
  assert.deepEqual(escalations, ["dependency_failed"]);
});

test("B-R9.0 dispatcher escalation notifies the submitter and project owner", async () => {
  // 施工图：升级发生要主动触达提交人+项目 owner，不能只写 event 等人自己刷收件箱。
  const submitterId = "94000000-0000-4000-8000-000000000401";
  const ownerId = "94000000-0000-4000-8000-000000000402";
  const escalationEventId = "94000000-0000-4000-8000-000000000403";
  const drafts: Array<{ userId: string; type: string; workItemId: string | undefined; dedupeKey: string }> = [];
  const sink = createDbTaskDispatchEscalationSink({
    async createEscalationEvent() {
      return { id: escalationEventId } as Awaited<ReturnType<Parameters<typeof createDbTaskDispatchEscalationSink>[0]["createEscalationEvent"]>>;
    }
  }, {
    notifications: {
      async createNotification(draft: { userId: string; type: string; workItemId?: string; dedupeKey: string }) {
        drafts.push({ userId: draft.userId, type: draft.type, workItemId: draft.workItemId, dedupeKey: draft.dedupeKey });
        return null;
      }
    } as never,
    workItems: {
      async findWorkItemAccessRecord() {
        return {
          id: workItemId,
          status: "ai_working",
          submitterUserId: submitterId,
          claimedByUserId: null,
          workspaceId,
          project: { archived: false, deletedAt: null, ownerUserId: ownerId, workspaceId },
          assignments: []
        };
      }
    } as never
  });

  await sink({
    plan: plan("dispatching"),
    items: [item({ id: researchItemId, seq: 0, title: "Research", role: "research", status: "failed" })],
    skippedItemIds: [],
    failedItemIds: [researchItemId],
    reason: "partial_failure",
    at: now
  });

  assert.deepEqual(drafts.map((draft) => draft.userId).sort(), [submitterId, ownerId].sort());
  for (const draft of drafts) {
    assert.equal(draft.type, "workitem.escalated");
    assert.equal(draft.workItemId, workItemId);
    assert.equal(draft.dedupeKey.includes(escalationEventId), true);
  }
});

test("B-R9.0 dispatcher escalation still lands when the notification write fails", async () => {
  // 通知是触达手段、决策收件箱才是承重记录：通知失败只告警，升级事件照常成立。
  let eventCreated = 0;
  const sink = createDbTaskDispatchEscalationSink({
    async createEscalationEvent() {
      eventCreated += 1;
      return { id: "94000000-0000-4000-8000-000000000404" } as Awaited<ReturnType<Parameters<typeof createDbTaskDispatchEscalationSink>[0]["createEscalationEvent"]>>;
    }
  }, {
    notifications: {
      async createNotification() {
        throw new Error("notification store down");
      }
    } as never,
    workItems: {
      async findWorkItemAccessRecord() {
        return {
          id: workItemId,
          status: "ai_working",
          submitterUserId: actorId,
          claimedByUserId: null,
          workspaceId,
          project: null,
          assignments: []
        };
      }
    } as never
  });

  await sink({
    plan: plan("dispatching"),
    items: [],
    skippedItemIds: [],
    reason: "cycle",
    at: now
  });

  assert.equal(eventCreated, 1);
});

test("R9.7 dispatcher arbitration-blocked attention carries judge context", async () => {
  const events: Array<Parameters<Parameters<typeof createDbTaskDispatchEscalationSink>[0]["createEscalationEvent"]>[0]> = [];
  const sink = createDbTaskDispatchEscalationSink({
    async createEscalationEvent(input) {
      events.push(input);
      return {} as Awaited<ReturnType<Parameters<typeof createDbTaskDispatchEscalationSink>[0]["createEscalationEvent"]>>;
    }
  });

  await sink({
    plan: plan("dispatching"),
    items: [
      item({ id: researchItemId, seq: 0, title: "Research", role: "research", status: "succeeded" }),
      item({ id: produceItemId, seq: 1, title: "Produce", role: "produce", status: "succeeded" })
    ],
    skippedItemIds: [],
    reason: "arbitration_blocked",
    arbitrationReason: "replan",
    reasonMd: "The child outputs contradict the acceptance criteria.",
    at: now
  } as Parameters<typeof sink>[0]);

  assert.equal(events.length, 1);
  assert.match(events[0]?.reasonMd ?? "", /仲裁/u);
  assert.match(events[0]?.reasonMd ?? "", /acceptance criteria/u);
  assert.doesNotMatch(events[0]?.reasonMd ?? "", /dispatch|派发/iu);
  assert.equal(events[0]?.handoffJson?.reason, "arbitration_blocked");
  assert.equal(events[0]?.handoffJson?.arbitration_reason, "replan");
  assert.equal(events[0]?.handoffJson?.arbitration_reason_md, "The child outputs contradict the acceptance criteria.");
});

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

test("R9.2 dispatcher pumps queued child runs after enqueueing ready task-plan items", async () => {
  const repository = new MemoryTaskDispatcherRepository(plan(), [
    item({ id: researchItemId, seq: 0, title: "Research", role: "research" }),
    item({ id: reviewItemId, seq: 1, title: "Review", role: "review" })
  ]);
  const queue = new CapturingQueue();
  const dispatcher = createTaskDispatcher({ repository, queue, now: () => now });

  const result = await dispatcher.dispatch({ planId, workspaceId, orgId, actorId });

  assert.deepEqual(result.enqueuedItemIds, [researchItemId, reviewItemId]);
  assert.equal(queue.runNextCalls, 2);
});

test("B-R9.2 stale-epoch terminal runs cannot settle a redispatched item", async () => {
  // branch-review 竞态：人工重派（item 代际 +1）后，旧终态子 run 的结果不许覆盖新一轮，
  // 也不许替新一轮发 partial_failure 升级卡。
  const escalations: string[] = [];
  const repository = new MemoryTaskDispatcherRepository(plan("dispatching"), [
    item({ id: researchItemId, seq: 0, title: "Research", role: "research" })
  ]);
  const queue = new CapturingQueue();
  const dispatcher = createTaskDispatcher({
    repository,
    queue,
    now: () => now,
    escalationSink: async (input) => { escalations.push(input.reason); }
  });

  // 第一代派发：run 记住 epoch=1。
  await dispatcher.dispatch({ planId, workspaceId, actorId });
  assert.equal(queue.inputs[0]?.taskPlanItemEpoch, 1);
  const staleRun = {
    ...run({ status: "failed", taskPlanItemId: researchItemId, workspaceId }),
    task_plan_item_epoch: 1
  };

  // 人工重派：item 重置回 pending 再派发 → 代际 2。
  const target = repository.items.find((candidate) => candidate.id === researchItemId)!;
  target.status = "pending";
  await dispatcher.dispatch({ planId, workspaceId, actorId });
  assert.equal(queue.inputs[1]?.taskPlanItemEpoch, 2);

  // 第一代终态 run 迟到结算：CAS 落空，item 仍 dispatched、无升级卡。
  const settled = await dispatcher.handleRunSettled(staleRun);
  assert.equal(settled, null);
  assert.equal(repository.items.find((candidate) => candidate.id === researchItemId)?.status, "dispatched");
  assert.deepEqual(escalations, []);

  // 同代（epoch=2）的 run 照常结算。
  const freshRun = {
    ...run({ status: "succeeded", taskPlanItemId: researchItemId, workspaceId }),
    task_plan_item_epoch: 2
  };
  const freshSettled = await dispatcher.handleRunSettled(freshRun);
  assert.equal(freshSettled?.settledItemId, researchItemId);
  assert.equal(repository.items.find((candidate) => candidate.id === researchItemId)?.status, "succeeded");
});

test("B-R9.2 dispatcher splits the plan budget across child runs by share", async () => {
  // branch-review 假接线（最重要）：budget_share_pct 必须真切分子 run 预算——
  // 每个子 run 的 budgetCapCny=计划总预算×份额，N 个子预算之和 ≤ 计划预算。
  const budgetedPlan = {
    ...plan(),
    budgetJson: { total_share_pct: 100, max_cost_cny: "10" }
  } as TaskPlanRow;
  const repository = new MemoryTaskDispatcherRepository(budgetedPlan, [
    item({ id: researchItemId, seq: 0, title: "Research", role: "research", budgetSharePct: 30 }),
    item({ id: produceItemId, seq: 1, title: "Produce", role: "produce", budgetSharePct: 50 }),
    item({ id: reviewItemId, seq: 2, title: "Review", role: "review", budgetSharePct: 20 })
  ]);
  const queue = new CapturingQueue();
  const dispatcher = createTaskDispatcher({ repository, queue, now: () => now });

  await dispatcher.dispatch({ planId, workspaceId, actorId });

  assert.deepEqual(queue.inputs.map((input) => input.budgetCapCny), ["3.00", "5.00", "2.00"]);
  const totalChildBudget = queue.inputs.reduce((sum, input) => sum + Number.parseFloat(input.budgetCapCny ?? "0"), 0);
  assert.equal(totalChildBudget <= 10, true, `child budgets ${totalChildBudget} must not exceed the plan budget`);

  // 计划没有预算时不造假 cap（份额只进 prompt 说明，执行预算走 policy）。
  const unbudgetedRepository = new MemoryTaskDispatcherRepository(plan(), [
    item({ id: researchItemId, seq: 0, title: "Research", role: "research" })
  ]);
  const unbudgetedQueue = new CapturingQueue();
  const unbudgetedDispatcher = createTaskDispatcher({ repository: unbudgetedRepository, queue: unbudgetedQueue, now: () => now });
  await unbudgetedDispatcher.dispatch({ planId, workspaceId, actorId });
  assert.equal(unbudgetedQueue.inputs[0]?.budgetCapCny, undefined);
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
  const escalations: Array<{ reason: string; failedItemIds?: string[]; skippedItemIds: string[] }> = [];
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
    escalationSink: async (input) => {
      escalations.push({
        reason: input.reason,
        ...(input.failedItemIds ? { failedItemIds: input.failedItemIds } : {}),
        skippedItemIds: input.skippedItemIds
      });
    }
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
  // B-R9.0-3（branch-review 死循环）：升级卡必须带上失败的上游项，否则「让它重试」
  // 只重置被阻塞项、失败依赖原样不动，下一次派发立刻再跳过再升级。
  assert.deepEqual(escalations, [{
    reason: "dependency_failed",
    failedItemIds: [researchItemId],
    skippedItemIds: [produceItemId, reviewItemId]
  }]);
});

test("B-R9.0 dependency-failed retry re-dispatches after the failed upstream is reset", async () => {
  // 走完整闭环：失败→升级（带 failed+skipped ids）→模拟人点「让它重试」把这批 id 重置回
  // pending（repo 层 resolveEscalation 的行为）→再次 dispatch 必须真把失败上游重新入队。
  const repository = new MemoryTaskDispatcherRepository(plan("dispatching"), [
    item({ id: researchItemId, seq: 0, title: "Research", role: "research", status: "failed" }),
    item({ id: produceItemId, seq: 1, title: "Produce", role: "produce", status: "skipped", dependsOn: [researchItemId] })
  ]);
  const queue = new CapturingQueue();
  const dispatcher = createTaskDispatcher({
    repository,
    queue,
    now: () => now,
    escalationSink: async () => {}
  });

  for (const candidate of repository.items) {
    candidate.status = "pending";
  }

  const result = await dispatcher.dispatch({ planId, workspaceId, actorId });

  assert.deepEqual(result.enqueuedItemIds, [researchItemId]);
  assert.deepEqual(result.skippedItemIds, []);
  assert.deepEqual(queue.inputs.map((input) => input.taskPlanItemId), [researchItemId]);
});

test("R9.7 dispatcher does not complete dependency-failed plans when attention persistence fails", async () => {
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
    escalationSink: async () => {
      throw new Error("dependency attention write failed");
    }
  });

  await assert.rejects(
    dispatcher.handleRunSettled(run({
      status: "failed",
      taskPlanItemId: researchItemId,
      workspaceId
    })),
    /dependency attention write failed/u
  );

  assert.equal(repository.row.status, "dispatching");
  assert.equal(repository.doneCalls, 0);
  assert.equal(repository.items.find((candidate) => candidate.id === researchItemId)?.status, "failed");
  assert.equal(repository.items.find((candidate) => candidate.id === produceItemId)?.status, "skipped");
  assert.equal(repository.items.find((candidate) => candidate.id === reviewItemId)?.status, "skipped");
  assert.deepEqual(queue.inputs, []);
});

test("R9.7 dispatcher surfaces partial child-run failure in attention before completing the terminal plan", async () => {
  const escalations: { reason: string; skippedItemIds: string[]; failedItemIds?: string[] }[] = [];
  const repository = new MemoryTaskDispatcherRepository(plan("dispatching"), [
    item({ id: researchItemId, seq: 0, title: "Research", role: "research", status: "dispatched" }),
    item({ id: produceItemId, seq: 1, title: "Produce", role: "produce", status: "succeeded" }),
    item({ id: reviewItemId, seq: 2, title: "Review", role: "review", status: "succeeded" })
  ]);
  const queue = new CapturingQueue();
  const dispatcher = createTaskDispatcher({
    repository,
    queue,
    now: () => now,
    escalationSink: async (input) => {
      escalations.push({
        reason: input.reason,
        skippedItemIds: input.skippedItemIds,
        ...(input.failedItemIds ? { failedItemIds: input.failedItemIds } : {})
      });
    }
  });

  const result = await dispatcher.handleRunSettled(run({
    status: "failed",
    taskPlanItemId: researchItemId,
    workspaceId
  }));

  assert.equal(result?.settledItemId, researchItemId);
  assert.equal(result?.dispatch.completed, true);
  assert.equal(repository.row.status, "done");
  assert.equal(repository.doneCalls, 1);
  assert.deepEqual(queue.inputs, []);
  assert.deepEqual(escalations, [{
    reason: "partial_failure",
    skippedItemIds: [],
    failedItemIds: [researchItemId]
  }]);
});

test("R9.7 dispatcher surfaces partial child-run failure immediately while sibling children continue", async () => {
  const escalations: { reason: string; skippedItemIds: string[]; failedItemIds?: string[]; failedRunId?: string }[] = [];
  const repository = new MemoryTaskDispatcherRepository(plan("dispatching"), [
    item({ id: researchItemId, seq: 0, title: "Research", role: "research", status: "dispatched" }),
    item({ id: produceItemId, seq: 1, title: "Produce", role: "produce", status: "dispatched" }),
    item({ id: reviewItemId, seq: 2, title: "Review", role: "review", status: "dispatched" })
  ]);
  const queue = new CapturingQueue();
  const dispatcher = createTaskDispatcher({
    repository,
    queue,
    now: () => now,
    escalationSink: async (input) => {
      escalations.push({
        reason: input.reason,
        skippedItemIds: input.skippedItemIds,
        ...(input.failedItemIds ? { failedItemIds: input.failedItemIds } : {}),
        ...(input.failedRunId ? { failedRunId: input.failedRunId } : {})
      });
    }
  });

  const failedRun = run({
    status: "failed",
    taskPlanItemId: researchItemId,
    workspaceId
  });
  const result = await dispatcher.handleRunSettled(failedRun);

  assert.equal(result?.settledItemId, researchItemId);
  assert.equal(result?.dispatch.completed, false);
  assert.equal(repository.row.status, "dispatching");
  assert.equal(repository.doneCalls, 0);
  assert.equal(repository.items.find((candidate) => candidate.id === researchItemId)?.status, "failed");
  assert.equal(repository.items.find((candidate) => candidate.id === produceItemId)?.status, "dispatched");
  assert.equal(repository.items.find((candidate) => candidate.id === reviewItemId)?.status, "dispatched");
  assert.deepEqual(queue.inputs, []);
  assert.deepEqual(escalations, [{
    reason: "partial_failure",
    skippedItemIds: [],
    failedItemIds: [researchItemId],
    failedRunId: failedRun.run_id
  }]);
});

test("R9.4 dispatcher arbitrates sibling successful outputs before completing the plan", async () => {
  const events: string[] = [];
  const repository = new MemoryTaskDispatcherRepository(plan("dispatching"), [
    item({ id: researchItemId, seq: 0, title: "Research", role: "research", status: "succeeded" }),
    item({ id: produceItemId, seq: 1, title: "Produce", role: "produce", status: "succeeded" }),
    item({ id: reviewItemId, seq: 2, title: "Review", role: "review", status: "dispatched" })
  ]);
  const markPlanDone = repository.markPlanDone.bind(repository);
  repository.markPlanDone = async (input) => {
    events.push("done");
    return markPlanDone(input);
  };
  const queue = new CapturingQueue();
  const dispatcher = createTaskDispatcher({
    repository,
    queue,
    now: () => now,
    arbitrationSink: (async (input) => {
      events.push("arbitrate");
      assert.equal(input.plan.id, planId);
      assert.equal(input.at, now);
      assert.deepEqual(
        input.items
          .filter((candidate) => candidate.status === "succeeded")
          .map((candidate) => candidate.id),
        [researchItemId, produceItemId, reviewItemId]
      );
    }) satisfies TaskDispatchArbitrationSink
  });

  const result = await dispatcher.handleRunSettled(run({
    status: "succeeded",
    taskPlanItemId: reviewItemId,
    workspaceId
  }));

  assert.equal(result?.dispatch.completed, true);
  assert.deepEqual(events, ["arbitrate", "done"]);
});

test("R9.7 dispatcher keeps terminal plans open when arbitration requests changes", async () => {
  const events: string[] = [];
  const repository = new MemoryTaskDispatcherRepository(plan("dispatching"), [
    item({ id: researchItemId, seq: 0, title: "Research", role: "research", status: "succeeded" }),
    item({ id: produceItemId, seq: 1, title: "Produce", role: "produce", status: "succeeded" }),
    item({ id: reviewItemId, seq: 2, title: "Review", role: "review", status: "dispatched" })
  ]);
  const markPlanDone = repository.markPlanDone.bind(repository);
  repository.markPlanDone = async (input) => {
    events.push("done");
    return markPlanDone(input);
  };
  const queue = new CapturingQueue();
  const dispatcher = createTaskDispatcher({
    repository,
    queue,
    now: () => now,
    arbitrationSink: (async () => {
      events.push("arbitrate");
      return {
        completion: "blocked",
        reason: "request_changes",
        reasonMd: "The accepted child outputs contradict each other."
      };
    }) satisfies TaskDispatchArbitrationSink,
    // R9.7: the old no-sink setup only proved the plan stayed open; it missed that a blocked terminal plan
    // must also become visible in the decision inbox so a human can resolve the arbitration.
    escalationSink: async (input) => {
      events.push(`attention:${input.reason}`);
    }
  });

  const result = await dispatcher.handleRunSettled(run({
    status: "succeeded",
    taskPlanItemId: reviewItemId,
    workspaceId
  }));

  assert.equal(result?.dispatch.completed, false);
  assert.equal(repository.row.status, "dispatching");
  assert.equal(repository.doneCalls, 0);
  assert.deepEqual(events, ["arbitrate", "attention:arbitration_blocked"]);
  assert.deepEqual(queue.inputs, []);
});

test("R9.7 dispatcher persists decision attention when arbitration blocks a terminal plan", async () => {
  const escalations: Array<{
    reason: string;
    skippedItemIds: string[];
    arbitrationReason?: string;
    reasonMd?: string;
  }> = [];
  const repository = new MemoryTaskDispatcherRepository(plan("dispatching"), [
    item({ id: researchItemId, seq: 0, title: "Research", role: "research", status: "succeeded" }),
    item({ id: produceItemId, seq: 1, title: "Produce", role: "produce", status: "succeeded" }),
    item({ id: reviewItemId, seq: 2, title: "Review", role: "review", status: "dispatched" })
  ]);
  const queue = new CapturingQueue();
  const dispatcher = createTaskDispatcher({
    repository,
    queue,
    now: () => now,
    arbitrationSink: (async () => ({
      completion: "blocked",
      reason: "escalate",
      reasonMd: "The child outputs need a human tie-break."
    })) satisfies TaskDispatchArbitrationSink,
    escalationSink: async (input) => {
      const arbitration = input as typeof input & { arbitrationReason?: string; reasonMd?: string };
      escalations.push({
        reason: input.reason,
        skippedItemIds: input.skippedItemIds,
        ...(arbitration.arbitrationReason ? { arbitrationReason: arbitration.arbitrationReason } : {}),
        ...(arbitration.reasonMd ? { reasonMd: arbitration.reasonMd } : {})
      });
    }
  });

  const result = await dispatcher.handleRunSettled(run({
    status: "succeeded",
    taskPlanItemId: reviewItemId,
    workspaceId
  }));

  assert.equal(result?.dispatch.completed, false);
  assert.equal(repository.row.status, "dispatching");
  assert.equal(repository.doneCalls, 0);
  assert.deepEqual(queue.inputs, []);
  assert.deepEqual(escalations, [{
    reason: "arbitration_blocked",
    skippedItemIds: [],
    arbitrationReason: "escalate",
    reasonMd: "The child outputs need a human tie-break."
  }]);
});

test("R9.7 dispatcher keeps the done CAS authoritative when completion side effects fail", async () => {
  const events: string[] = [];
  const repository = new MemoryTaskDispatcherRepository(plan("dispatching"), [
    item({ id: researchItemId, seq: 0, title: "Research", role: "research", status: "succeeded" }),
    item({ id: produceItemId, seq: 1, title: "Produce", role: "produce", status: "failed" }),
    item({ id: reviewItemId, seq: 2, title: "Review", role: "review", status: "dispatched" })
  ]);
  const markPlanDone = repository.markPlanDone.bind(repository);
  repository.markPlanDone = async (input) => {
    events.push("done");
    return markPlanDone(input);
  };
  const queue = new CapturingQueue();
  const dispatcher = createTaskDispatcher({
    repository,
    queue,
    now: () => now,
    completionSink: async (input) => {
      events.push("completion");
      assert.equal(input.plan.id, planId);
      assert.equal(input.summaryMd.includes("Task plan"), true);
      throw new Error("completion audit failed");
    }
  });

  await assert.rejects(
    dispatcher.handleRunSettled(run({
      status: "succeeded",
      taskPlanItemId: reviewItemId,
      workspaceId
    })),
    /completion audit failed/u
  );

  // R9.7 review: the old assertion expected the completion audit side effect to run before
  // `markPlanDone()`, but that allowed a CAS miss to emit a false completion record.
  assert.deepEqual(events, ["done", "completion"]);
  assert.equal(repository.row.status, "done");
  assert.equal(repository.doneCalls, 1);
  assert.deepEqual(queue.inputs, []);
});

test("R9.7 dispatcher does not emit completion side effects when markPlanDone CAS misses", async () => {
  const events: string[] = [];
  const repository = new MemoryTaskDispatcherRepository(plan("dispatching"), [
    item({ id: researchItemId, seq: 0, title: "Research", role: "research", status: "succeeded" }),
    item({ id: produceItemId, seq: 1, title: "Produce", role: "produce", status: "succeeded" }),
    item({ id: reviewItemId, seq: 2, title: "Review", role: "review", status: "dispatched" })
  ]);
  repository.markPlanDone = async () => {
    events.push("done-cas-miss");
    return null;
  };
  const queue = new CapturingQueue();
  const dispatcher = createTaskDispatcher({
    repository,
    queue,
    now: () => now,
    completionSink: async () => {
      events.push("completion");
    }
  });

  const result = await dispatcher.handleRunSettled(run({
    status: "succeeded",
    taskPlanItemId: reviewItemId,
    workspaceId
  }));

  assert.equal(result?.dispatch.completed, false);
  assert.equal(repository.row.status, "dispatching");
  assert.deepEqual(events, ["done-cas-miss"]);
  assert.deepEqual(queue.inputs, []);
});

test("R9.7 dispatcher does not complete a partial-failed plan when attention persistence fails", async () => {
  const repository = new MemoryTaskDispatcherRepository(plan("dispatching"), [
    item({ id: researchItemId, seq: 0, title: "Research", role: "research", status: "dispatched" }),
    item({ id: produceItemId, seq: 1, title: "Produce", role: "produce", status: "succeeded" }),
    item({ id: reviewItemId, seq: 2, title: "Review", role: "review", status: "succeeded" })
  ]);
  const queue = new CapturingQueue();
  const dispatcher = createTaskDispatcher({
    repository,
    queue,
    now: () => now,
    escalationSink: async () => {
      throw new Error("attention write failed");
    }
  });

  await assert.rejects(
    dispatcher.handleRunSettled(run({
      status: "failed",
      taskPlanItemId: researchItemId,
      workspaceId
    })),
    /attention write failed/u
  );

  assert.equal(repository.row.status, "dispatching");
  assert.equal(repository.doneCalls, 0);
  // The old assertion expected `failed`, but that consumed the only retryable
  // state before the decision-inbox attention card was durable.
  assert.equal(repository.items.find((candidate) => candidate.id === researchItemId)?.status, "dispatched");
  assert.deepEqual(queue.inputs, []);
});

test("R9.7 dispatcher keeps partial failure retryable until attention is durable", async () => {
  const repository = new MemoryTaskDispatcherRepository(plan("dispatching"), [
    item({ id: researchItemId, seq: 0, title: "Research", role: "research", status: "dispatched" }),
    item({ id: produceItemId, seq: 1, title: "Produce", role: "produce", status: "succeeded" }),
    item({ id: reviewItemId, seq: 2, title: "Review", role: "review", status: "succeeded" })
  ]);
  const queue = new CapturingQueue();
  const escalations: string[] = [];
  let failAttention = true;
  const dispatcher = createTaskDispatcher({
    repository,
    queue,
    now: () => now,
    escalationSink: async (input) => {
      if (failAttention) {
        throw new Error("attention write failed once");
      }
      escalations.push(input.reason);
    }
  });
  const failedRun = run({
    status: "failed",
    taskPlanItemId: researchItemId,
    workspaceId
  });

  await assert.rejects(
    dispatcher.handleRunSettled(failedRun),
    /attention write failed once/u
  );
  failAttention = false;

  const recovered = await dispatcher.handleRunSettled(failedRun);

  assert.equal(recovered?.settledItemId, researchItemId);
  assert.equal(repository.row.status, "done");
  assert.equal(repository.doneCalls, 1);
  assert.equal(repository.items.find((candidate) => candidate.id === researchItemId)?.status, "failed");
  assert.deepEqual(escalations, ["partial_failure"]);
  assert.deepEqual(queue.inputs, []);
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

test("R9.7 dispatcher does not complete cyclic plans when attention persistence fails", async () => {
  const repository = new MemoryTaskDispatcherRepository(plan(), [
    item({ id: researchItemId, seq: 0, title: "Research", role: "research", dependsOn: [produceItemId] }),
    item({ id: produceItemId, seq: 1, title: "Produce", role: "produce", dependsOn: [researchItemId] })
  ]);
  const queue = new CapturingQueue();
  const dispatcher = createTaskDispatcher({
    repository,
    queue,
    now: () => now,
    escalationSink: async () => {
      throw new Error("cycle attention write failed");
    }
  });

  await assert.rejects(
    dispatcher.dispatch({ planId, workspaceId, actorId }),
    /cycle attention write failed/u
  );

  assert.equal(repository.row.status, "dispatching");
  assert.equal(repository.doneCalls, 0);
  assert.equal(repository.items.every((candidate) => candidate.status === "skipped"), true);
  assert.deepEqual(queue.inputs, []);
});

test("R9.7 dispatcher fails closed when child run enqueue fails after item dispatch CAS", async () => {
  const escalations: { reason: string; failedItemIds?: string[]; failedRunId?: string }[] = [];
  const repository = new MemoryTaskDispatcherRepository(plan(), [
    item({ id: researchItemId, seq: 0, title: "Research", role: "research" })
  ]);
  const queue: Pick<AgentRunQueue, "enqueue"> = {
    async enqueue() {
      throw new Error("budget exhausted before child run persisted");
    }
  };
  const dispatcher = createTaskDispatcher({
    repository,
    queue,
    now: () => now,
    escalationSink: async (input) => {
      escalations.push({
        reason: input.reason,
        ...(input.failedItemIds ? { failedItemIds: input.failedItemIds } : {}),
        ...(input.failedRunId ? { failedRunId: input.failedRunId } : {})
      });
    }
  });

  await assert.rejects(
    dispatcher.dispatch({ planId, workspaceId, actorId }),
    /budget exhausted before child run persisted/u
  );

  assert.equal(repository.row.status, "dispatching");
  assert.equal(repository.doneCalls, 0);
  assert.equal(repository.items.find((candidate) => candidate.id === researchItemId)?.status, "failed");
  assert.deepEqual(escalations, [{
    reason: "partial_failure",
    failedItemIds: [researchItemId]
  }]);
});
