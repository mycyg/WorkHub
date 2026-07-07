import assert from "node:assert/strict";
import test from "node:test";

import type { AttentionItem } from "@workhub/contracts";
import type { UserAuthRow } from "@workhub/db";

import type { AuthActor } from "../middleware/auth.js";
import {
  buildEscalationAttentionItem,
  createEscalationService as createEscalationServiceImpl,
  type EscalationRepository,
  type EscalationServiceRow
} from "./escalations.js";
import { WorkItemServiceError } from "./work-items.js";

const now = new Date("2026-07-02T16:00:00.000Z");
const escalationId = "94000000-0000-4000-8000-000000000101";
const workItemId = "94000000-0000-4000-8000-000000000102";
const projectId = "94000000-0000-4000-8000-000000000103";
const userId = "12000000-0000-4000-8000-000000000011";
const delegateTargetUserId = "12000000-0000-4000-8000-000000000012";

function actor(): AuthActor {
  return {
    kind: "human",
    id: userId,
    userId,
    label: "r9-runner",
    isAdmin: false,
    orgId: "91000000-0000-4000-8000-000000000001",
    workspaceId: "92000000-0000-4000-8000-000000000001"
  };
}

function row(partial: Partial<EscalationServiceRow> = {}): EscalationServiceRow {
  return {
    id: escalationId,
    workItemId,
    agentRunId: null,
    projectId,
    title: "竞品价格调研",
    reasonMd: "AI 对数据来源不确定。",
    trigger: "unqualified",
    handoffJson: {},
    suggestedLeadUserId: null,
    createdAt: now,
    resolvedAt: null,
    workItemStatus: "escalated",
    workspaceId: actor().workspaceId,
    ...partial
  };
}

function createEscalationService(
  deps: Parameters<typeof createEscalationServiceImpl>[0] = {}
): ReturnType<typeof createEscalationServiceImpl> {
  return createEscalationServiceImpl({ workItems: false, runQueue: false, ...deps });
}

class MemoryEscalationRepository implements EscalationRepository {
  public findCalls: Array<string | { id: string; workspaceId: string }> = [];
  public resolveCalls: Array<{ escalationId: string; targetStatus: string; taskPlanAction?: string }> = [];
  public reopenCalls: Array<{ escalationId: string; targetStatus: string }> = [];
  public delegateCalls: Array<{ escalationId: string; toUserId: string; workspaceId?: string }> = [];
  public budgetDecisionCalls: Array<{
    escalationId: string;
    workspaceId: string;
    actionId: string;
    targetStatus: EscalationServiceRow["workItemStatus"];
  }> = [];
  public listCalls: Array<{ workspaceId: string; limit?: number }> = [];

  constructor(
    private readonly options: {
      findRow?: EscalationServiceRow | null;
      listRows?: EscalationServiceRow[];
    } = {}
  ) {}

  async findById(input: string | { id: string; workspaceId: string }) {
    this.findCalls.push(input);
    const id = typeof input === "string" ? input : input.id;
    if (id !== escalationId) {
      return null;
    }
    return this.options.findRow === undefined ? row() : this.options.findRow;
  }

  async listUnresolvedForWorkspace(input: { workspaceId: string; limit?: number }) {
    this.listCalls.push(input);
    return (this.options.listRows ?? [row()]).slice(0, input.limit ?? 50);
  }

  async resolveEscalation(input: { escalationId: string; targetStatus: string; taskPlanAction?: string }) {
    this.resolveCalls.push({
      escalationId: input.escalationId,
      targetStatus: input.targetStatus,
      ...(input.taskPlanAction ? { taskPlanAction: input.taskPlanAction } : {})
    });
    return row({ resolvedAt: now, workItemStatus: input.targetStatus as EscalationServiceRow["workItemStatus"] });
  }

  async reopenEscalation(input: { escalationId: string; targetStatus: string }) {
    this.reopenCalls.push({ escalationId: input.escalationId, targetStatus: input.targetStatus });
    return row({ resolvedAt: null, workItemStatus: input.targetStatus as EscalationServiceRow["workItemStatus"] });
  }

  async delegateEscalation(input: { escalationId: string; toUserId: string; workspaceId?: string }) {
    this.delegateCalls.push({
      escalationId: input.escalationId,
      toUserId: input.toUserId,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {})
    });
    return row({ suggestedLeadUserId: "12000000-0000-4000-8000-000000000012" });
  }

  async resolveBudgetDecision(input: { escalationId: string; workspaceId: string; actionId: string; targetStatus: EscalationServiceRow["workItemStatus"] }) {
    this.budgetDecisionCalls.push({
      escalationId: input.escalationId,
      workspaceId: input.workspaceId,
      actionId: input.actionId,
      targetStatus: input.targetStatus
    });
    return row({
      trigger: "budget_exhausted",
      resolvedAt: now,
      workItemStatus: input.targetStatus,
      handoffJson: {
        attention_kind: "budget",
        budget_resolution: { action_id: input.actionId }
      }
    });
  }
}

test("R9.7 escalation resolve scopes the initial read to the actor workspace", async () => {
  const repository = new MemoryEscalationRepository();
  const service = createEscalationService({ repository, now: () => now });

  await service.resolve(escalationId, actor(), { action: "retry" });

  assert.deepEqual(repository.findCalls, [{ id: escalationId, workspaceId: actor().workspaceId }]);
});

test("R9.0 escalation attention cards expose three human decisions without raw enum copy", () => {
  const item = buildEscalationAttentionItem(row(), "zh-CN");

  assert.equal(item.kind, "escalation");
  assert.equal(item.priority, "urgent");
  assert.equal(item.source_ref.entity_type, "escalation_event");
  assert.equal(item.title, "《竞品价格调研》卡住了");
  assert.equal(item.reason_text, "AI 对数据来源不确定。");
  assert.deepEqual(item.actions.map((action) => [action.id, action.label, action.method, action.href]), [
    ["escalation_retry", "让它重试", "POST", `/api/escalations/${escalationId}/resolve`],
    ["escalation_pm_mode", "转成我来做", "POST", `/api/escalations/${escalationId}/resolve`],
    ["escalation_cancel", "取消这个子任务", "POST", `/api/escalations/${escalationId}/resolve`]
  ]);
});

test("R9.0 escalation attention cards localize the title and actions for English readers", () => {
  // ux-flow-spec §3.3 双语文案：en-US 卡的标题与三动作都是英文，动作 id 与 zh 完全一致
  // （前端动作接线按 id 映射，不许因 locale 漂移）。
  const item = buildEscalationAttentionItem(row(), "en-US");

  assert.equal(item.title, "\"竞品价格调研\" needs a decision");
  assert.deepEqual(item.actions.map((action) => [action.id, action.label]), [
    ["escalation_retry", "Let it retry"],
    ["escalation_pm_mode", "I'll take over"],
    ["escalation_cancel", "Cancel this subtask"]
  ]);
});

test("R9.7 budget exhaustion rows render as budget decision cards", () => {
  const item = buildEscalationAttentionItem(row({
    trigger: "budget_exhausted",
    reasonMd: "AI 预算已经用完，先暂停新的自动执行。",
    handoffJson: {
      attention_kind: "budget",
      notice: {
        code: "budget_exhausted",
        severity: "critical",
        message: "AI 预算已经用完，先暂停新的自动执行。",
        usage: {
          scope_label: "目标预算",
          period: "month",
          total_tokens: 1001,
          max_tokens: 1000,
          remaining_tokens: 0,
          estimated_cost_cny: "51",
          max_cost_cny: "50",
          remaining_cost_cny: "0",
          status: "exhausted"
        },
        recommended_action: "add_budget",
        options: [
          { id: "add_budget", label: "追加预算继续", action_href: "/dashboard/cost?objectiveId=obj-1" },
          { id: "finish_current_output", label: "就用现有产出收尾", action_href: "/workitems/demo" },
          { id: "close_scope", label: "整体收工", action_href: "/workitems/demo" }
        ]
      }
    }
  }), "zh-CN");

  assert.equal(item.kind, "budget");
  assert.equal(item.priority, "high");
  assert.equal(item.source_ref.entity_type, "budget_notice");
  assert.equal(item.title, "《竞品价格调研》预算需要处理");
  assert.equal(item.summary_text.includes("目标预算"), true);
  assert.equal(item.reason_text?.includes("1001/1000 令牌"), true);
  assert.equal(item.reason_text?.includes("¥51/¥50"), true);
  // R9.7 review: the old assertion made every budget option POST to resolve the card, but
  // `add_budget` does not itself update a budget policy. Only applied terminal choices may resolve.
  assert.deepEqual(item.actions.map((action) => [action.id, action.label, action.method, action.href]), [
    ["add_budget", "追加预算继续", "GET", "/dashboard/cost?objectiveId=obj-1"],
    ["finish_current_output", "就用现有产出收尾", "POST", `/api/escalations/${escalationId}/budget-actions/finish_current_output`],
    ["close_scope", "整体收工", "POST", `/api/escalations/${escalationId}/budget-actions/close_scope`]
  ]);
});

test("R9.7 budget escalation cards localize durable Chinese labels for English readers", () => {
  const item = buildEscalationAttentionItem(row({
    trigger: "budget_exhausted",
    reasonMd: "AI 预算已经用完，先暂停新的自动执行。",
    handoffJson: {
      attention_kind: "budget",
      notice: {
        code: "budget_exhausted",
        severity: "critical",
        message: "AI 预算已经用完，先暂停新的自动执行。",
        usage: {
          scope_label: "目标预算",
          period: "month",
          total_tokens: 1001,
          max_tokens: 1000,
          remaining_tokens: 0,
          estimated_cost_cny: "51",
          max_cost_cny: "50",
          remaining_cost_cny: "0",
          status: "exhausted"
        },
        recommended_action: "add_budget",
        options: [
          { id: "add_budget", label: "追加预算继续", action_href: "/dashboard/cost?objectiveId=obj-1" },
          { id: "finish_current_output", label: "就用现有产出收尾", action_href: "/workitems/demo" },
          { id: "close_scope", label: "整体收工", action_href: "/workitems/demo" }
        ]
      }
    }
  }), "en-US");

  assert.equal(item.title, "\"竞品价格调研\" needs a budget decision");
  assert.equal(item.summary_text.includes("目标预算"), false);
  assert.equal(item.summary_text.includes("Objective budget month"), true);
  assert.deepEqual(item.actions.map((action) => [action.id, action.label, action.method, action.href]), [
    ["add_budget", "Add budget and continue", "GET", "/dashboard/cost?objectiveId=obj-1"],
    ["finish_current_output", "Finish with current output", "POST", `/api/escalations/${escalationId}/budget-actions/finish_current_output`],
    ["close_scope", "Close scope", "POST", `/api/escalations/${escalationId}/budget-actions/close_scope`]
  ]);
});

test("R9.7 budget terminal actions apply scope state transitions", async () => {
  const budgetRow = row({
    trigger: "budget_exhausted",
    workItemStatus: "ai_working",
    handoffJson: {
      attention_kind: "budget",
      notice: {
        code: "budget_exhausted",
        severity: "critical",
        message: "AI 预算已经用完，先暂停新的自动执行。",
        recommended_action: "add_budget",
        options: [
          { id: "add_budget", label: "追加预算继续", action_href: "/dashboard/cost?objectiveId=obj-1" },
          { id: "finish_current_output", label: "就用现有产出收尾", action_href: "/workitems/demo" },
          { id: "close_scope", label: "整体收工", action_href: "/workitems/demo" }
        ]
      }
    }
  });
  const repository = new MemoryEscalationRepository({ findRow: budgetRow });
  const service = createEscalationService({ repository, now: () => now }) as ReturnType<typeof createEscalationService> & {
    resolveBudgetDecision: (id: string, actor: AuthActor, actionId: string) => Promise<{
      escalation: { id: string; work_item_id: string; resolved_at?: string };
      work_item_status: EscalationServiceRow["workItemStatus"];
      attention: { summary_text: string };
    }>;
  };

  const result = await service.resolveBudgetDecision(escalationId, actor(), "finish_current_output");
  const closed = await service.resolveBudgetDecision(escalationId, actor(), "close_scope");

  // R9.7 review: the old assertion expected this path to only record a receipt.
  // That closed the human card while leaving automation state unchanged.
  assert.deepEqual(repository.budgetDecisionCalls, [{
    escalationId,
    workspaceId: actor().workspaceId,
    actionId: "finish_current_output",
    targetStatus: "in_review"
  }, {
    escalationId,
    workspaceId: actor().workspaceId,
    actionId: "close_scope",
    targetStatus: "cancelled"
  }]);
  assert.deepEqual(repository.resolveCalls, []);
  assert.equal(result.escalation.id, escalationId);
  assert.equal(result.work_item_status, "in_review");
  assert.equal(closed.work_item_status, "cancelled");
  assert.equal(result.attention.summary_text, "已记录预算选择。");
});

test("R9.7 escalation mutation success summaries honor the requested locale", async () => {
  const budgetRow = row({
    trigger: "budget_exhausted",
    workItemStatus: "ai_working",
    handoffJson: {
      attention_kind: "budget",
      notice: {
        options: [
          { id: "finish_current_output", label: "Finish with current output", action_href: "/workitems/demo" }
        ]
      }
    }
  });
  const budgetRepository = new MemoryEscalationRepository({ findRow: budgetRow });
  const budgetService = createEscalationService({ repository: budgetRepository, now: () => now });

  const budget = await budgetService.resolveBudgetDecision(
    escalationId,
    actor(),
    "finish_current_output",
    "en-US"
  );

  assert.equal(budget.attention.summary_text, "Budget choice recorded.");

  const resolveRepository = new MemoryEscalationRepository();
  const resolveService = createEscalationService({ repository: resolveRepository, now: () => now });
  const resolved = await resolveService.resolve(escalationId, actor(), { action: "pm_mode" }, "en-US");

  assert.equal(resolved.attention.summary_text, "This task is now in human mode.");

  const delegateRepository = new MemoryEscalationRepository();
  const delegateService = createEscalationService({
    repository: delegateRepository,
    users: false,
    memberships: false,
    now: () => now
  });
  const delegated = await delegateService.delegate(
    escalationId,
    actor(),
    { to_user_id: delegateTargetUserId },
    "en-US"
  );

  assert.equal(delegated.attention.summary_text, "Escalation delegated.");
});

test("R9.7 budget decision actions reject options not present on the durable notice", async () => {
  const repository = new MemoryEscalationRepository({
    findRow: row({
      trigger: "budget_exhausted",
      handoffJson: {
        attention_kind: "budget",
        notice: {
          options: [
            { id: "add_budget", label: "追加预算继续", action_href: "/dashboard/cost?objectiveId=obj-1" }
          ]
        }
      }
    })
  });
  const service = createEscalationService({ repository, now: () => now }) as ReturnType<typeof createEscalationService> & {
    resolveBudgetDecision: (id: string, actor: AuthActor, actionId: string) => Promise<unknown>;
  };

  await assert.rejects(
    service.resolveBudgetDecision(escalationId, actor(), "close_scope"),
    (error: unknown) => error instanceof Error
      && (error as { status?: number; code?: string }).status === 422
      && (error as { code?: string }).code === "budget_action_not_available"
  );
  assert.deepEqual(repository.budgetDecisionCalls, []);
});

test("R9.7 budget decision actions reject unapplied budget policy choices", async () => {
  const repository = new MemoryEscalationRepository({
    findRow: row({
      trigger: "budget_exhausted",
      handoffJson: {
        attention_kind: "budget",
        notice: {
          recommended_action: "add_budget",
          options: [
            { id: "add_budget", label: "追加预算继续", action_href: "/dashboard/cost?objectiveId=obj-1" },
            { id: "finish_current_output", label: "就用现有产出收尾", action_href: "/workitems/demo" }
          ]
        }
      }
    })
  });
  const service = createEscalationService({ repository, now: () => now }) as ReturnType<typeof createEscalationService> & {
    resolveBudgetDecision: (id: string, actor: AuthActor, actionId: string) => Promise<unknown>;
  };

  await assert.rejects(
    service.resolveBudgetDecision(escalationId, actor(), "add_budget"),
    (error: unknown) => error instanceof Error
      && (error as { status?: number; code?: string }).status === 422
      && (error as { code?: string }).code === "budget_action_requires_budget_update"
  );
  assert.deepEqual(repository.budgetDecisionCalls, []);
});

test("R9.0 escalation resolve actions map to the work-item state machine", async () => {
  const repository = new MemoryEscalationRepository();
  const service = createEscalationService({ repository, now: () => now });

  await service.resolve(escalationId, actor(), { action: "retry" });
  await service.resolve(escalationId, actor(), { action: "pm_mode" });
  await service.resolve(escalationId, actor(), { action: "cancel" });

  assert.deepEqual(repository.resolveCalls.map((call) => call.targetStatus), [
    "ai_working",
    "pm_mode",
    "cancelled"
  ]);
});

test("B-R9.0 non-plan escalation retry re-enqueues a real agent run", async () => {
  // branch-review 假接线：非计划升级 retry 原先只翻状态、无执行体接手。
  const repository = new MemoryEscalationRepository();
  const enqueueCalls: Array<{ workItemId: string; actorId: string; workspaceId?: string; orgId?: string; title?: string }> = [];
  const service = createEscalationService({
    repository,
    runQueue: {
      async enqueue(input) {
        enqueueCalls.push({
          workItemId: input.workItemId,
          actorId: input.actorId,
          ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
          ...(input.orgId ? { orgId: input.orgId } : {}),
          ...(input.title ? { title: input.title } : {})
        });
        return { run_id: "94000000-0000-4000-8000-000000000901" } as never;
      }
    },
    now: () => now
  });

  const resolved = await service.resolve(escalationId, actor(), { action: "retry" });

  assert.equal(resolved.work_item_status, "ai_working");
  assert.deepEqual(enqueueCalls, [{
    workItemId,
    actorId: actor().userId,
    workspaceId: actor().workspaceId,
    orgId: actor().orgId,
    title: row().title
  }]);

  // pm_mode / cancel 不该再入队。
  await service.resolve(escalationId, actor(), { action: "pm_mode" });
  await service.resolve(escalationId, actor(), { action: "cancel" });
  assert.equal(enqueueCalls.length, 1);
});

test("B-R9.0 non-plan retry reopens the escalation when the run enqueue fails", async () => {
  const repository = new MemoryEscalationRepository();
  const service = createEscalationService({
    repository,
    runQueue: {
      async enqueue() {
        throw new Error("queue down");
      }
    },
    now: () => now
  });

  await assert.rejects(
    service.resolve(escalationId, actor(), { action: "retry" }),
    (error: unknown) => error instanceof Error
      && (error as { status?: number }).status === 503
      && (error as { code?: string }).code === "agent_run_retry_failed"
  );
  assert.deepEqual(repository.reopenCalls, [{ escalationId, targetStatus: "escalated" }]);
});

test("B-R9.0 plan escalation retry uses the dispatcher, not a bare work-item run", async () => {
  const taskPlanId = "94000000-0000-4000-8000-000000000205";
  const repository = new MemoryEscalationRepository({
    findRow: row({ handoffJson: { task_plan_id: taskPlanId } })
  });
  let enqueued = 0;
  let dispatched = 0;
  const service = createEscalationService({
    repository,
    runQueue: {
      async enqueue() {
        enqueued += 1;
        return { run_id: "94000000-0000-4000-8000-000000000902" } as never;
      }
    },
    taskDispatcher: {
      async dispatch(input) {
        dispatched += 1;
        return { planId: input.planId, enqueuedItemIds: [], skippedItemIds: [], casMissItemIds: [], completed: false };
      }
    },
    now: () => now
  });

  await service.resolve(escalationId, actor(), { action: "retry" });

  assert.equal(dispatched, 1);
  assert.equal(enqueued, 0);
});

test("R9.7 child escalation retry resets the task slice and dispatches the plan", async () => {
  const taskPlanId = "94000000-0000-4000-8000-000000000201";
  const taskPlanItemId = "94000000-0000-4000-8000-000000000202";
  const repository = new MemoryEscalationRepository({
    findRow: row({
      agentRunId: "94000000-0000-4000-8000-000000000203",
      handoffJson: {
        source: "agent_run_recovery",
        task_plan_id: taskPlanId,
        task_plan_item_id: taskPlanItemId
      }
    })
  });
  const dispatchCalls: Array<{ planId: string; workspaceId: string; orgId?: string; actorId?: string }> = [];
  const service = createEscalationService({
    repository,
    taskDispatcher: {
      async dispatch(input) {
        dispatchCalls.push(input);
        return {
          planId: input.planId,
          enqueuedItemIds: [taskPlanItemId],
          skippedItemIds: [],
          casMissItemIds: [],
          completed: false
        };
      }
    },
    now: () => now
  });

  const resolved = await service.resolve(escalationId, actor(), { action: "retry" });

  assert.equal(resolved.work_item_status, "ai_working");
  assert.deepEqual(repository.resolveCalls, [{
    escalationId,
    targetStatus: "ai_working",
    taskPlanAction: "retry"
  }]);
  assert.deepEqual(dispatchCalls, [{
    planId: taskPlanId,
    workspaceId: actor().workspaceId,
    orgId: actor().orgId,
    actorId: actor().userId
  }]);
});

test("R9.7 plan-level arbitration retry dispatches the task plan without child item ids", async () => {
  const taskPlanId = "94000000-0000-4000-8000-000000000204";
  const repository = new MemoryEscalationRepository({
    findRow: row({
      handoffJson: {
        source: "task_dispatcher",
        reason: "arbitration_blocked",
        task_plan_id: taskPlanId,
        skipped_item_ids: [],
        arbitration_reason: "escalate"
      }
    })
  });
  const dispatchCalls: Array<{ planId: string; workspaceId: string; orgId?: string; actorId?: string }> = [];
  const service = createEscalationService({
    repository,
    taskDispatcher: {
      async dispatch(input) {
        dispatchCalls.push(input);
        return {
          planId: input.planId,
          enqueuedItemIds: [],
          skippedItemIds: [],
          casMissItemIds: [],
          completed: true
        };
      }
    },
    now: () => now
  });

  await service.resolve(escalationId, actor(), { action: "retry" });

  assert.deepEqual(repository.resolveCalls, [{
    escalationId,
    targetStatus: "ai_working",
    taskPlanAction: "retry"
  }]);
  assert.deepEqual(dispatchCalls, [{
    planId: taskPlanId,
    workspaceId: actor().workspaceId,
    orgId: actor().orgId,
    actorId: actor().userId
  }]);
});

test("R9.7 child escalation retry reopens the card when redispatch fails", async () => {
  const taskPlanId = "94000000-0000-4000-8000-000000000211";
  const taskPlanItemId = "94000000-0000-4000-8000-000000000212";
  const repository = new MemoryEscalationRepository({
    findRow: row({
      agentRunId: "94000000-0000-4000-8000-000000000213",
      handoffJson: {
        source: "agent_run_recovery",
        task_plan_id: taskPlanId,
        task_plan_item_id: taskPlanItemId
      }
    })
  });
  const service = createEscalationService({
    repository,
    taskDispatcher: {
      async dispatch() {
        throw new Error("dispatch unavailable");
      }
    },
    now: () => now
  });

  await assert.rejects(
    service.resolve(escalationId, actor(), { action: "retry" }),
    (error: unknown) => error instanceof Error
      && (error as { status?: number; code?: string }).status === 503
      && (error as { code?: string }).code === "task_dispatch_retry_failed"
      && !/dispatch|派发/iu.test(error.message)
  );

  assert.deepEqual(repository.resolveCalls, [{
    escalationId,
    targetStatus: "ai_working",
    taskPlanAction: "retry"
  }]);
  assert.deepEqual(repository.reopenCalls, [{
    escalationId,
    targetStatus: "escalated"
  }]);
});

test("R9.7 escalation service refuses legacy null-workspace rows", async () => {
  const repository = new MemoryEscalationRepository({
    findRow: row({ workspaceId: null }),
    listRows: [row({ workspaceId: null })]
  });
  const service = createEscalationService({
    repository,
    users: false,
    workItems: false,
    now: () => now
  });

  await assert.rejects(
    service.resolve(escalationId, actor(), { action: "retry" }),
    (error: unknown) => error instanceof Error
      && error.name === "Error"
      && (error as { status?: number; code?: string }).status === 403
      && (error as { code?: string }).code === "forbidden"
  );
  await assert.rejects(
    service.delegate(escalationId, actor(), { to_user_id: "12000000-0000-4000-8000-000000000012" }),
    (error: unknown) => error instanceof Error
      && (error as { status?: number; code?: string }).status === 403
      && (error as { code?: string }).code === "forbidden"
  );
  const items = await service.listAttentionItems({ actor: actor(), locale: "zh-CN" });

  assert.deepEqual(items, []);
  assert.deepEqual(repository.resolveCalls, []);
  assert.deepEqual(repository.delegateCalls, []);
});

test("R9.7 escalation direct mutations require work-item mutate permission", async () => {
  // B-R9.0-1：写动作改按写权限收口。对完全不可见的工单，assertCanMutateWorkItem 抛 404，
  // 服务必须折叠成 403 forbidden（不向无权者泄露升级是否存在对应工单）。
  const mutateChecks: Array<{ workItemId: string; actorWorkspaceId: string }> = [];
  const hiddenWorkItems = {
    async canReadWorkItems(input: { workItemIds: string[]; actor: AuthActor }) {
      return new Set<string>(input.workItemIds);
    },
    async assertCanMutateWorkItem(input: { workItemId: string; actor: AuthActor }) {
      mutateChecks.push({
        workItemId: input.workItemId,
        actorWorkspaceId: input.actor.workspaceId
      });
      throw new WorkItemServiceError(404, "not_found", "没有找到这个事项。");
    }
  };

  const resolveRepository = new MemoryEscalationRepository();
  const resolveService = createEscalationService({
    repository: resolveRepository,
    workItems: hiddenWorkItems,
    now: () => now
  });

  await assert.rejects(
    resolveService.resolve(escalationId, actor(), { action: "retry" }),
    (error: unknown) => error instanceof Error
      && (error as { status?: number; code?: string }).status === 403
      && (error as { code?: string }).code === "forbidden"
  );
  assert.deepEqual(resolveRepository.resolveCalls, []);

  const budgetRepository = new MemoryEscalationRepository({
    findRow: row({
      trigger: "budget_exhausted",
      handoffJson: {
        attention_kind: "budget",
        notice: {
          options: [
            { id: "finish_current_output", label: "就用现有产出收尾", action_href: "/workitems/demo" }
          ]
        }
      }
    })
  });
  const budgetService = createEscalationService({
    repository: budgetRepository,
    workItems: hiddenWorkItems,
    now: () => now
  });

  await assert.rejects(
    budgetService.resolveBudgetDecision(escalationId, actor(), "finish_current_output"),
    (error: unknown) => error instanceof Error
      && (error as { status?: number; code?: string }).status === 403
      && (error as { code?: string }).code === "forbidden"
  );
  assert.deepEqual(budgetRepository.budgetDecisionCalls, []);

  const delegateRepository = new MemoryEscalationRepository();
  const delegateService = createEscalationService({
    repository: delegateRepository,
    users: false,
    memberships: false,
    workItems: hiddenWorkItems,
    now: () => now
  });

  await assert.rejects(
    delegateService.delegate(escalationId, actor(), { to_user_id: delegateTargetUserId }),
    (error: unknown) => error instanceof Error
      && (error as { status?: number; code?: string }).status === 403
      && (error as { code?: string }).code === "forbidden"
  );
  assert.deepEqual(delegateRepository.delegateCalls, []);
  assert.deepEqual(mutateChecks, [
    { workItemId, actorWorkspaceId: actor().workspaceId },
    { workItemId, actorWorkspaceId: actor().workspaceId },
    { workItemId, actorWorkspaceId: actor().workspaceId }
  ]);
});

test("B-R9.0 read access alone cannot resolve, delegate, or decide budget on an escalation", async () => {
  // branch-review 越权洞：旧实现只查 canReadWorkItems——同工作区任何能看到工单的人都能
  // 取消/转派/杀掉别人的升级。现在可读但不可写的 actor 必须 403，且不触发任何仓库写调用。
  const readableNotMutable = {
    async canReadWorkItems(input: { workItemIds: string[] }) {
      return new Set<string>(input.workItemIds);
    },
    async assertCanMutateWorkItem() {
      throw new WorkItemServiceError(403, "forbidden", "你没有权限修改这个事项。");
    }
  };
  const repository = new MemoryEscalationRepository();
  const service = createEscalationService({
    repository,
    users: false,
    memberships: false,
    workItems: readableNotMutable,
    now: () => now
  });

  const expectForbidden = (error: unknown) => error instanceof Error
    && (error as { status?: number }).status === 403
    && (error as { code?: string }).code === "forbidden";

  await assert.rejects(service.resolve(escalationId, actor(), { action: "cancel" }), expectForbidden);
  await assert.rejects(service.resolve(escalationId, actor(), { action: "pm_mode" }), expectForbidden);
  await assert.rejects(service.delegate(escalationId, actor(), { to_user_id: delegateTargetUserId }), expectForbidden);
  await assert.rejects(service.resolveBudgetDecision(escalationId, actor(), "finish_current_output"), expectForbidden);
  assert.deepEqual(repository.resolveCalls, []);
  assert.deepEqual(repository.delegateCalls, []);
  assert.deepEqual(repository.budgetDecisionCalls, []);
});

test("B-R9.0 mutate-permitted actor still resolves and delegates escalations", async () => {
  let mutateChecks = 0;
  const mutableWorkItems = {
    async canReadWorkItems(input: { workItemIds: string[] }) {
      return new Set<string>(input.workItemIds);
    },
    async assertCanMutateWorkItem() {
      mutateChecks += 1;
    }
  };
  const repository = new MemoryEscalationRepository();
  const service = createEscalationService({
    repository,
    users: false,
    memberships: false,
    workItems: mutableWorkItems,
    now: () => now
  });

  const resolved = await service.resolve(escalationId, actor(), { action: "cancel" });
  assert.equal(resolved.escalation.id, escalationId);
  await service.delegate(escalationId, actor(), { to_user_id: delegateTargetUserId });

  assert.equal(mutateChecks, 2);
  assert.equal(repository.resolveCalls.length, 1);
  assert.equal(repository.delegateCalls.length, 1);
});

test("R9.7 escalation attention scans past unreadable rows before applying the visible page limit", async () => {
  const hiddenRows = Array.from({ length: 50 }, (_, index) => row({
    id: `94000000-0000-4000-8000-${(0x200 + index).toString(16).padStart(12, "0")}`,
    workItemId: `94000000-0000-4000-8000-${(0x300 + index).toString(16).padStart(12, "0")}`,
    title: `hidden ${index}`
  }));
  const visible = row({
    id: "94000000-0000-4000-8000-0000000002ff",
    workItemId: "94000000-0000-4000-8000-0000000003ff",
    title: "可读的升级"
  });
  const repository = new MemoryEscalationRepository({ listRows: [...hiddenRows, visible] });
  const service = createEscalationService({
    repository,
    users: false,
    workItems: {
      async canReadWorkItems(input: { workItemIds: string[]; actor: AuthActor }) {
        assert.equal(input.actor.workspaceId, actor().workspaceId);
        assert.equal(input.workItemIds.includes(visible.workItemId), true);
        return new Set([visible.workItemId]);
      },
      // 决策信箱是读路径：列表可见性只看 canRead，绝不该向读者要写权限。
      async assertCanMutateWorkItem() {
        throw new Error("attention listing must not demand mutate permission");
      }
    },
    now: () => now
  });

  const items = await service.listAttentionItems({ actor: actor(), locale: "zh-CN" });

  assert.equal(repository.listCalls[0]?.workspaceId, actor().workspaceId);
  assert.equal((repository.listCalls[0]?.limit ?? 0) > 50, true);
  assert.deepEqual(items.map((item) => item.id), [visible.id]);
});

test("R9.7 escalation attention page reports when the unresolved scan is capped", async () => {
  const rows = Array.from({ length: 101 }, (_, index) => row({
    id: `94000000-0000-4000-8000-${(0x500 + index).toString(16).padStart(12, "0")}`,
    workItemId: `94000000-0000-4000-8000-${(0x600 + index).toString(16).padStart(12, "0")}`,
    title: `visible ${index}`
  }));
  const repository = new MemoryEscalationRepository({ listRows: rows });
  const service = createEscalationService({
    repository,
    users: false,
    workItems: false,
    now: () => now
  }) as ReturnType<typeof createEscalationService> & {
    listAttentionPage: (input: { actor: AuthActor; locale: "zh-CN" }) => Promise<{
      items: AttentionItem[];
      page_info: { limit: number; returned: number; has_more: boolean };
    }>;
  };

  const page = await service.listAttentionPage({ actor: actor(), locale: "zh-CN" });

  assert.equal(page.items.length, 50);
  assert.deepEqual(page.page_info, {
    limit: 50,
    returned: 50,
    has_more: true
  });
  assert.equal(repository.listCalls[0]?.limit, 101);
});

test("R9.7 escalation delegation requires the target to be an active workspace member", async () => {
  const repository = new MemoryEscalationRepository();
  const membershipCalls: Array<{ userId: string; workspaceId: string }> = [];
  const service = createEscalationService({
    repository,
    users: {
      async findActiveById(id: string) {
        return id === delegateTargetUserId ? ({ id, deletedAt: null } as UserAuthRow) : null;
      }
    },
    memberships: {
      async findActiveForUserWorkspace(userId: string, workspaceId: string) {
        membershipCalls.push({ userId, workspaceId });
        return null;
      }
    },
    now: () => now
  });

  await assert.rejects(
    service.delegate(escalationId, actor(), { to_user_id: delegateTargetUserId }),
    (error: unknown) => error instanceof Error
      && (error as { status?: number; code?: string }).status === 404
      && (error as { code?: string }).code === "delegate_target_not_found"
  );

  assert.deepEqual(membershipCalls, [{ userId: delegateTargetUserId, workspaceId: actor().workspaceId }]);
  assert.deepEqual(repository.delegateCalls, []);
});

test("R9.7 escalation delegation passes actor workspace to the repository mutation", async () => {
  const repository = new MemoryEscalationRepository();
  const service = createEscalationService({
    repository,
    users: {
      async findActiveById(id: string) {
        return id === delegateTargetUserId ? ({ id, deletedAt: null } as UserAuthRow) : null;
      }
    },
    memberships: {
      async findActiveForUserWorkspace(userId: string, workspaceId: string) {
        return userId === delegateTargetUserId && workspaceId === actor().workspaceId
          ? {
              id: "93000000-0000-4000-8000-000000000301",
              userId,
              workspaceId,
              role: "member",
              defaultWorkspace: false,
              deletedAt: null,
              createdAt: now,
              updatedAt: now
            }
          : null;
      }
    },
    now: () => now
  });

  await service.delegate(escalationId, actor(), { to_user_id: delegateTargetUserId });

  assert.deepEqual(repository.delegateCalls, [{
    escalationId,
    toUserId: delegateTargetUserId,
    workspaceId: actor().workspaceId
  }]);
});
