import { randomUUID } from "node:crypto";

import type { WorkItemMode } from "@workhub/contracts";

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
    message: string
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
} = {}): AgentRunQueue {
  const now = options.now ?? (() => new Date());
  const nextId = options.id ?? randomUUID;
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
      const at = now().toISOString();
      const run: AgentRunQueueRecord = {
        run_id: nextId(),
        work_item_id: input.workItemId,
        actor_id: input.actorId,
        mode: input.mode ?? "worker",
        status: "queued",
        title: input.title ?? "AI worker run",
        budget: {
          max_steps: 15,
          total_timeout_s: 300,
          max_tokens: 120000,
          max_cost_cny: "5"
        },
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

let defaultQueue: AgentRunQueue | undefined;

export function getDefaultAgentRunQueue() {
  defaultQueue ??= createInMemoryAgentRunQueue();
  return defaultQueue;
}
