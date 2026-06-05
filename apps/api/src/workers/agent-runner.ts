import { randomUUID } from "node:crypto";

import { settings as runtimeSettings, type Settings } from "@workhub/config";
import type { WorkItemMode } from "@workhub/contracts";
import {
  decideRunBudget,
  type BudgetDecision,
  type BudgetDecisionTrace,
  type BudgetNotice,
  type BudgetPolicyStore,
  type BudgetScope,
  type BudgetUsageSnapshot,
  type RunBudget
} from "@workhub/cost";

import { getDefaultBudgetPolicyStore } from "../services/cost-policy-store.js";

export type AgentRunQueueStatus = "queued" | "running" | "succeeded" | "failed" | "escalated" | "cancelled";

export type AgentRunTraceStepRecord = {
  id: string;
  step_no: number;
  phase: "think" | "tool_call" | "tool_result" | "final";
  output_excerpt?: string;
  control_signal?: "continue" | "stop" | "compact" | "escalate";
  snapshot_id?: string;
  created_at: string;
};

export type AgentRunQueueRecord = {
  run_id: string;
  work_item_id: string;
  actor_id: string;
  mode: WorkItemMode;
  status: AgentRunQueueStatus;
  title: string;
  budget: {
    max_steps: number;
    total_timeout_s: number;
    max_tokens: number;
    max_cost_cny: string;
  };
  budget_decision: {
    decision_id: string;
    allowed: boolean;
    reason?: BudgetDecision["reason"];
    model_route: BudgetDecision["modelRoute"];
    notice?: QueueBudgetNotice;
  };
  usage: {
    steps_used: number;
    token_in: number;
    token_out: number;
    estimated_cost_cny: string;
  };
  trace: AgentRunTraceStepRecord[];
  handoff?: {
    done: string[];
    remaining: string[];
    next_steps: string[];
    blockers: string[];
    artifacts: string[];
    budget_hit: string;
  };
  created_at: string;
  updated_at: string;
};

export class AgentRunnerError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
  }
}

export type EnqueueAgentRunInput = {
  workItemId: string;
  actorId: string;
  title?: string;
  mode?: WorkItemMode;
};

export type BudgetDecisionInput = EnqueueAgentRunInput & {
  settings: Settings;
};

export type BudgetDecisionProvider = (input: BudgetDecisionInput) => BudgetDecisionTrace | Promise<BudgetDecisionTrace>;

export type AgentRunQueue = {
  enqueue: (input: EnqueueAgentRunInput) => Promise<AgentRunQueueRecord>;
  get: (runId: string) => Promise<AgentRunQueueRecord | null>;
  trace: (runId: string, after?: number) => Promise<AgentRunTraceStepRecord[]>;
  abort: (runId: string, actorId: string) => Promise<AgentRunQueueRecord>;
  listActive: () => Promise<AgentRunQueueRecord[]>;
};

export function createInMemoryAgentRunQueue(options: {
  now?: () => Date;
  id?: () => string;
  settings?: Settings;
  policyStore?: BudgetPolicyStore;
  usage?: (input: EnqueueAgentRunInput) => BudgetUsageSnapshot[];
  decideBudget?: BudgetDecisionProvider;
} = {}): AgentRunQueue {
  const now = options.now ?? (() => new Date());
  const nextId = options.id ?? randomUUID;
  const settings = options.settings ?? runtimeSettings;
  const policyStore = options.policyStore ?? getDefaultBudgetPolicyStore();
  const decideBudget = options.decideBudget ?? ((input: BudgetDecisionInput) =>
    decideRunBudget({
      settings: input.settings,
      scopeIds: {
        workItemId: input.workItemId,
        userId: input.actorId
      },
      policies: policyStore.listPolicies(input.settings),
      usage: options.usage?.(input) ?? [],
      modelRoute: {
        provider: input.settings.llm.defaultProvider,
        model: input.settings.llm.model,
        reason: "default"
      },
      now: now()
    }));
  const runs = new Map<string, AgentRunQueueRecord>();

  function activeForWorkItem(workItemId: string) {
    return [...runs.values()].find(
      (run) =>
        run.work_item_id === workItemId &&
        (run.status === "queued" || run.status === "running")
    );
  }

  return {
    async enqueue(input) {
      const existing = activeForWorkItem(input.workItemId);
      if (existing) {
        throw new AgentRunnerError(409, "agent_run_already_active", "这个事项已经有 AI 在处理了。");
      }
      const decision = await decideBudget({ ...input, settings });
      if (!decision.allowed) {
        throw new AgentRunnerError(
          402,
          "budget_exhausted",
          decision.notice?.message ?? "AI 预算已经用完，先暂停新的自动执行。",
          budgetErrorDetails(decision)
        );
      }
      const at = now().toISOString();
      const run: AgentRunQueueRecord = {
        run_id: nextId(),
        work_item_id: input.workItemId,
        actor_id: input.actorId,
        mode: input.mode ?? "worker",
        status: "queued",
        title: input.title ?? "AI worker run",
        budget: toQueueRunBudget(decision.runBudget),
        budget_decision: toQueueBudgetDecision(decision),
        usage: {
          steps_used: 0,
          token_in: 0,
          token_out: 0,
          estimated_cost_cny: "0"
        },
        trace: [],
        created_at: at,
        updated_at: at
      };
      runs.set(run.run_id, run);
      return run;
    },

    async get(runId) {
      return runs.get(runId) ?? null;
    },

    async trace(runId, after = 0) {
      const run = runs.get(runId);
      if (!run) {
        throw new AgentRunnerError(404, "not_found", "没有找到这次 AI 执行。");
      }
      return run.trace.filter((step) => step.step_no > after);
    },

    async abort(runId) {
      const run = runs.get(runId);
      if (!run) {
        throw new AgentRunnerError(404, "not_found", "没有找到这次 AI 执行。");
      }
      if (!["queued", "running"].includes(run.status)) {
        throw new AgentRunnerError(409, "agent_run_already_settled", "这次 AI 执行已经结束。");
      }
      const updated: AgentRunQueueRecord = {
        ...run,
        status: "cancelled",
        updated_at: now().toISOString()
      };
      runs.set(runId, updated);
      return updated;
    },

    async listActive() {
      return [...runs.values()].filter((run) => run.status === "queued" || run.status === "running");
    }
  };
}

type QueueBudgetScope =
  | { kind: "workitem"; workitem_id: string }
  | { kind: "user"; user_id: string }
  | { kind: "team"; team_id: string }
  | { kind: "eval"; suite: "nightly" | "release" };

type QueueBudgetNotice = {
  code: BudgetNotice["code"];
  severity: BudgetNotice["severity"];
  message: string;
  scope: QueueBudgetScope;
  usage_ratio: number;
  recommended_action: BudgetNotice["recommendedAction"];
  options?: { id: string; label: string; action_href: string }[];
  action_href?: string;
};

function toQueueRunBudget(budget: RunBudget): AgentRunQueueRecord["budget"] {
  return {
    max_steps: budget.maxSteps,
    total_timeout_s: budget.totalTimeoutSeconds,
    max_tokens: budget.maxTokens,
    max_cost_cny: budget.maxCostCny
  };
}

function toQueueBudgetDecision(decision: BudgetDecision): AgentRunQueueRecord["budget_decision"] {
  return {
    decision_id: decision.decisionId,
    allowed: decision.allowed,
    ...(decision.reason ? { reason: decision.reason } : {}),
    model_route: decision.modelRoute,
    ...(decision.notice ? { notice: toQueueBudgetNotice(decision.notice) } : {})
  };
}

function toQueueBudgetNotice(notice: BudgetNotice): QueueBudgetNotice {
  return {
    code: notice.code,
    severity: notice.severity,
    message: notice.message,
    scope: toQueueBudgetScope(notice.scope),
    usage_ratio: notice.usageRatio,
    recommended_action: notice.recommendedAction,
    ...(notice.options
      ? {
          options: notice.options.map((option) => ({
            id: option.id,
            label: option.label,
            action_href: option.actionHref
          }))
        }
      : {}),
    ...(notice.actionHref ? { action_href: notice.actionHref } : {})
  };
}

function budgetErrorDetails(decision: BudgetDecisionTrace): Record<string, unknown> {
  const usage = decision.limitingUsage;
  return {
    ...(decision.limitingScope ? { scope: toQueueBudgetScope(decision.limitingScope) } : {}),
    ...(usage
      ? {
          policy_id: usage.policyId,
          remaining_tokens: usage.remainingTokens,
          remaining_cost_cny: usage.remainingCostCny
        }
      : {}),
    recommended_action: decision.notice?.recommendedAction ?? "pause"
  };
}

function toQueueBudgetScope(scope: BudgetScope): QueueBudgetScope {
  switch (scope.kind) {
    case "workitem":
      return { kind: "workitem", workitem_id: scope.workitemId };
    case "user":
      return { kind: "user", user_id: scope.userId };
    case "team":
      return { kind: "team", team_id: scope.teamId };
    case "eval":
      return { kind: "eval", suite: scope.suite };
  }
}

let defaultQueue: AgentRunQueue | undefined;

export function getDefaultAgentRunQueue() {
  defaultQueue ??= createInMemoryAgentRunQueue();
  return defaultQueue;
}
