import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createAgentLoop,
  type AgentLoopClient,
  type AgentLoopEvent,
  type AgentLoopResult,
  type AgentLoopStep,
  type AgentLoopUsage,
  type StructuredHandoff
} from "@workhub/agent/loop";
import { settings as runtimeSettings, type Settings } from "@workhub/config";
import { eventTypes, type CuuState, type WorkItemMode } from "@workhub/contracts";
import {
  createMemoryCostLedgerStore,
  decideRunBudget,
  type BudgetDecision,
  type BudgetDecisionTrace,
  type BudgetNotice,
  type BudgetPolicyStore,
  type BudgetScope,
  type BudgetUsageSnapshot,
  type CostLedgerStore,
  type RunBudget
} from "@workhub/cost";
import {
  createBuiltInFileTools,
  createToolRegistry,
  errorToolResult,
  type SnapshotHook,
  type ToolExecutionContext,
  type ToolResult
} from "@workhub/tools";
import { makeWorkHubEvent, topics, toCuuState, type LifecycleWorkItemRef } from "@workhub/events";
import type { AuditLogRepository, SnapshotRepository } from "@workhub/db";

import { getDefaultPushBus, type PushBus } from "../broker/index.js";
import { getDefaultCostLedgerStore } from "../services/cost-ledger-store.js";
import { getDefaultBudgetPolicyStore } from "../services/cost-policy-store.js";
import { getDefaultProviderRegistry } from "../services/provider-registry.js";
import { createAgentRunSnapshotHook } from "../services/agent-run-snapshots.js";
import {
  createAgentRunConfidenceRecorder,
  type AgentRunConfidenceRecorder
} from "../services/agent-run-confidence.js";
import { createHumanReservedGuard, type HumanReservedGuard } from "../services/human-reserved-guard.js";
import { createNotificationService, type NotificationService } from "../services/notifications.js";
import {
  createAgentRunNotificationWorkItemResolver,
  type AgentRunNotificationWorkItemResolver
} from "../services/agent-run-notification-workitem.js";
import { getDefaultProposalService, type ProposalService, type StoredProposal } from "../services/proposals.js";
import { getDefaultAgentRunPersistence } from "../services/agent-run-persistence.js";

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
  workdir_ref?: string;
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

export type AbortAgentRunActor = string | { id: string; isAdmin?: boolean };

export type BudgetDecisionInput = EnqueueAgentRunInput & {
  settings: Settings;
};

export type BudgetDecisionProvider = (input: BudgetDecisionInput) => BudgetDecisionTrace | Promise<BudgetDecisionTrace>;

export type AgentRunExecutionInput = {
  run: AgentRunQueueRecord;
  settings: Settings;
};

export type AgentRunClientProvider = (input: AgentRunExecutionInput) => AgentLoopClient | Promise<AgentLoopClient>;
export type AgentRunWorkdirProvider = (input: AgentRunExecutionInput) => string | Promise<string>;
export type AgentRunToolsProvider = (input: AgentRunExecutionInput) => {
  toModelTools: (ctx: ToolExecutionContext) => Promise<unknown[]> | unknown[];
  execute: (toolId: string, input: unknown, ctx: ToolExecutionContext) => Promise<ToolResult> | ToolResult;
};
export type AgentRunNotificationPublisher = Pick<NotificationService, "notifyMilestone">;
export type AgentRunEventBus = Pick<PushBus, "publish">;
export type AgentRunProposalSink = Pick<ProposalService, "createFromManifest">;
export type AgentRunPersistence = {
  createRun: (run: AgentRunQueueRecord) => Promise<void>;
  updateRun: (run: AgentRunQueueRecord) => Promise<void>;
  replaceTrace: (runId: string, trace: AgentRunTraceStepRecord[]) => Promise<void>;
  setWorkdir: (runId: string, workdir: string, at: Date) => Promise<void>;
  get: (runId: string) => Promise<AgentRunQueueRecord | null>;
  getWorkdir: (runId: string) => Promise<string | null>;
  listActive: () => Promise<AgentRunQueueRecord[]>;
};

export type AgentRunQueue = {
  enqueue: (input: EnqueueAgentRunInput) => Promise<AgentRunQueueRecord>;
  get: (runId: string) => Promise<AgentRunQueueRecord | null>;
  workdir: (runId: string) => Promise<string | null>;
  trace: (runId: string, after?: number) => Promise<AgentRunTraceStepRecord[]>;
  abort: (runId: string, actor: AbortAgentRunActor) => Promise<AgentRunQueueRecord>;
  listActive: () => Promise<AgentRunQueueRecord[]>;
  run: (runId: string) => Promise<AgentRunQueueRecord>;
  runNext: () => Promise<AgentRunQueueRecord | null>;
};

export function createInMemoryAgentRunQueue(options: {
  now?: () => Date;
  id?: () => string;
  settings?: Settings;
  policyStore?: BudgetPolicyStore;
  ledgerStore?: CostLedgerStore;
  usage?: (input: EnqueueAgentRunInput) => BudgetUsageSnapshot[] | Promise<BudgetUsageSnapshot[]>;
  decideBudget?: BudgetDecisionProvider;
  client?: AgentRunClientProvider;
  workdir?: AgentRunWorkdirProvider;
  tools?: AgentRunToolsProvider;
  snapshot?: SnapshotHook;
  snapshotRoot?: string;
  snapshotId?: () => string;
  snapshots?: SnapshotRepository;
  auditLogs?: AuditLogRepository;
  confidence?: AgentRunConfidenceRecorder | false;
  humanReserved?: HumanReservedGuard | false;
  proposals?: AgentRunProposalSink | false;
  notifications?: AgentRunNotificationPublisher | false;
  notificationWorkItem?: AgentRunNotificationWorkItemResolver | false;
  eventBus?: AgentRunEventBus | false;
  persistence?: AgentRunPersistence | false;
  systemPrompt?: string;
  initialUserMessage?: (run: AgentRunQueueRecord) => string;
  requireDeliverable?: boolean;
  emit?: (event: AgentLoopEvent, run: AgentRunQueueRecord) => Promise<void> | void;
} = {}): AgentRunQueue {
  const now = options.now ?? (() => new Date());
  const nextId = options.id ?? randomUUID;
  const settings = options.settings ?? runtimeSettings;
  const policyStore = options.policyStore ?? getDefaultBudgetPolicyStore();
  const ledgerStore = options.ledgerStore ?? createMemoryCostLedgerStore({
    teamId: settings.auth.defaultWorkspaceId,
    evalSuite: "nightly"
  });
  const defaultTools = createToolRegistry(createBuiltInFileTools());
  const humanReservedGuard = options.humanReserved === false ? undefined : options.humanReserved;
  const proposalSink = options.proposals === false ? undefined : options.proposals;
  const notificationWorkItem = options.notificationWorkItem === false ? undefined : options.notificationWorkItem;
  const eventBus = options.eventBus === false ? undefined : options.eventBus ?? getDefaultPushBus();
  const persistence = options.persistence === false ? undefined : options.persistence;
  const decideBudget = options.decideBudget ?? (async (input: BudgetDecisionInput) =>
    decideRunBudget({
      settings: input.settings,
      scopeIds: {
        workItemId: input.workItemId,
        userId: input.actorId,
        teamId: input.settings.auth.defaultWorkspaceId
      },
      policies: policyStore.listPolicies(input.settings),
      usage: await (options.usage?.(input) ?? ledgerStore.usageSnapshots({
        workItemId: input.workItemId,
        userId: input.actorId,
        teamId: input.settings.auth.defaultWorkspaceId
      })),
      modelRoute: {
        provider: input.settings.llm.defaultProvider,
        model: input.settings.llm.model,
        reason: "default"
      },
      now: now()
    }));
  const runs = new Map<string, AgentRunQueueRecord>();
  const runWorkdirs = new Map<string, string>();
  const startingWorkItems = new Set<string>();
  const tracePersistenceChains = new Map<string, Promise<void>>();

  function activeForWorkItem(workItemId: string) {
    if (startingWorkItems.has(workItemId)) {
      return true;
    }
    return [...runs.values()].find(
      (run) =>
        run.work_item_id === workItemId &&
        (run.status === "queued" || run.status === "running")
    );
  }

  async function persistedActiveForWorkItem(workItemId: string) {
    const active = await persistence?.listActive();
    return active?.find((run) => run.work_item_id === workItemId) ?? null;
  }

  async function queuedRun() {
    const inMemory = [...runs.values()].find((run) => run.status === "queued");
    if (inMemory) {
      return inMemory;
    }
    const persisted = await persistence?.listActive();
    return persisted?.find((run) => run.status === "queued") ?? null;
  }

  async function defaultWorkdir(input: AgentRunExecutionInput) {
    return mkdtemp(path.join(os.tmpdir(), `workhub-agent-${input.run.run_id}-`));
  }

  async function defaultClient(input: AgentRunExecutionInput) {
    return getDefaultProviderRegistry().get({
      id: input.run.actor_id,
      userId: input.run.actor_id,
      runId: input.run.run_id,
      workItemId: input.run.work_item_id
    }, "worker");
  }

  function defaultInitialUserMessage(run: AgentRunQueueRecord) {
    return [
      `请处理这个 WorkHub 事项: ${run.title}`,
      `work_item_id: ${run.work_item_id}`,
      "请先理解目标，必要时使用工具生成 outputs/ 下的交付物，完成后自然结束。"
    ].join("\n");
  }

  function updateRun(run: AgentRunQueueRecord) {
    runs.set(run.run_id, run);
    return run;
  }

  async function persistCreatedRun(run: AgentRunQueueRecord) {
    await persistence?.createRun(run);
    if (run.trace.length > 0) {
      await queueTracePersistence(run);
    }
  }

  async function persistRun(run: AgentRunQueueRecord) {
    await persistence?.updateRun(run);
  }

  async function persistRunWithTrace(run: AgentRunQueueRecord) {
    await persistRun(run);
    await queueTracePersistence(run);
  }

  function queueTracePersistence(run: AgentRunQueueRecord) {
    if (!persistence) {
      return Promise.resolve();
    }
    const previous = tracePersistenceChains.get(run.run_id) ?? Promise.resolve();
    const task = previous
      .catch(() => undefined)
      .then(() => persistence.replaceTrace(run.run_id, run.trace));
    tracePersistenceChains.set(run.run_id, task);
    void task.finally(() => {
      if (tracePersistenceChains.get(run.run_id) === task) {
        tracePersistenceChains.delete(run.run_id);
      }
    });
    return task;
  }

  function persistTraceInBackground(run: AgentRunQueueRecord) {
    if (!persistence) {
      return;
    }
    void queueTracePersistence(run).catch((error) => {
      console.warn("WorkHub AgentRun trace persistence failed", error);
    });
  }

  function abortActorId(actor: AbortAgentRunActor) {
    return typeof actor === "string" ? actor : actor.id;
  }

  function abortActorIsAdmin(actor: AbortAgentRunActor) {
    return typeof actor === "object" && actor.isAdmin === true;
  }

  function driftedRun(runId: string) {
    const live = runs.get(runId);
    return live && live.status !== "running" ? live : null;
  }

  async function emitRunEvent(
    event: AgentLoopEvent,
    run: AgentRunQueueRecord,
    cuuState?: CuuState
  ) {
    await options.emit?.(event, run);
    if (!eventBus) {
      return;
    }

    const topic = topics.run(run.run_id).topic;
    const envelope = makeWorkHubEvent({
      type: event.type,
      topic,
      actor: { actor_kind: "ai", label: "WorkHub AI" },
      work_item_id: run.work_item_id,
      run_id: run.run_id,
      ...(event.previewText ? { preview_text: event.previewText } : {}),
      cuu_state: cuuState ?? toCuuState({ type: event.type }),
      data: {
        run_id: run.run_id,
        work_item_id: run.work_item_id,
        ...event.data
      }
    });
    await eventBus.publish(topic, event.type, envelope);
  }

  async function emitFinalRunEvent(run: AgentRunQueueRecord, result: AgentLoopResult) {
    const cuuState: CuuState = result.status === "succeeded" ? "celebrating" : "worried";
    await emitRunEvent({
      type: eventTypes.agentRunStep,
      previewText: result.reason,
      data: {
        run_id: run.run_id,
        work_item_id: run.work_item_id,
        kind: "done",
        status: result.status,
        steps: result.usage.stepsUsed,
        control: result.control
      }
    }, run, cuuState);
  }

  async function emitProposalOpenedEvent(run: AgentRunQueueRecord, proposal: StoredProposal) {
    if (!eventBus) {
      return;
    }

    const topic = topics.workitem(run.work_item_id).topic;
    const envelope = makeWorkHubEvent({
      type: eventTypes.proposalOpened,
      topic,
      actor: { actor_kind: "ai", label: "WorkHub AI" },
      work_item_id: run.work_item_id,
      run_id: run.run_id,
      proposal_id: proposal.id,
      preview_text: `AI 已生成变更申请: ${proposal.title}`,
      cuu_state: "carrying_document",
      data: {
        proposal_id: proposal.id,
        work_item_id: run.work_item_id,
        run_id: run.run_id,
        branch_id: proposal.branch_id,
        title: proposal.title,
        status: proposal.status,
        manifest: proposal.diff_manifest
      }
    });
    await eventBus.publish(topic, eventTypes.proposalOpened, envelope);
  }

  async function openProposalFromManifest(run: AgentRunQueueRecord, result: AgentLoopResult) {
    if (!proposalSink || result.status !== "succeeded" || !result.manifest) {
      return;
    }

    const proposal = await proposalSink.createFromManifest({
      workItemId: run.work_item_id,
      manifest: result.manifest,
      actor: { actor_kind: "ai", label: "WorkHub AI" },
      title: result.manifest.title,
      ...(result.manifest.branch_id ? { branchId: result.manifest.branch_id } : {})
    });
    await emitProposalOpenedEvent(run, proposal);
  }

  async function executeRun(runId: string) {
    let run = runs.get(runId);
    if (!run) {
      run = await persistence?.get(runId) ?? undefined;
      if (run) {
        runs.set(run.run_id, run);
      }
    }
    if (!run) {
      throw new AgentRunnerError(404, "not_found", "没有找到这次 AI 执行。");
    }
    if (run.status !== "queued") {
      throw new AgentRunnerError(409, "agent_run_not_queued", "这次 AI 执行已经不是排队状态。");
    }

    let current = updateRun({
      ...run,
      status: "running",
      updated_at: now().toISOString()
    });
    await persistRun(current);
    const executionInput = { run: current, settings };
    const client = await (options.client ?? defaultClient)(executionInput);
    const workdir = await (options.workdir ?? defaultWorkdir)(executionInput);
    runWorkdirs.set(current.run_id, workdir);
    current = updateRun({
      ...current,
      workdir_ref: workdir,
      updated_at: now().toISOString()
    });
    await persistence?.setWorkdir(current.run_id, workdir, now());
    const rawTools = options.tools?.(executionInput) ?? defaultTools;
    const tools: ReturnType<AgentRunToolsProvider> = {
      toModelTools: (ctx) => rawTools.toModelTools(ctx),
      execute: async (toolId, input, ctx) => {
        if (driftedRun(current.run_id)) {
          return errorToolResult("这次 AI 执行已经取消，已跳过后续工具执行。");
        }
        return rawTools.execute(toolId, input, ctx);
      }
    };
    const snapshot = options.snapshot ?? createAgentRunSnapshotHook({
      run: current,
      settings,
      ...(options.snapshotRoot ? { snapshotRoot: options.snapshotRoot } : {}),
      ...(options.snapshotId ? { id: options.snapshotId } : {}),
      ...(options.snapshots ? { snapshots: options.snapshots } : {}),
      ...(options.auditLogs ? { auditLogs: options.auditLogs } : {}),
      now
    });
    const loop = createAgentLoop();

    try {
      const result = await loop.run({
        runId: current.run_id,
        workItemId: current.work_item_id,
        actorId: current.actor_id,
        workdir,
        systemPrompt: options.systemPrompt ?? "You are WorkHub's AI worker. Produce concise, reviewable deliverables.",
        initialUserMessage: options.initialUserMessage?.(current) ?? defaultInitialUserMessage(current),
        client,
        tools,
        budget: toAgentLoopBudget(current.budget),
        requireDeliverable: options.requireDeliverable ?? true,
        snapshot,
        recorder: {
          recordStep: (step) => {
            const live = runs.get(current.run_id);
            if (!live || live.status !== "running") {
              return;
            }
            current = updateRun({
              ...live,
              trace: [...live.trace, ...traceRecordsFromStep(current.run_id, step)],
              updated_at: now().toISOString()
            });
            persistTraceInBackground(current);
          }
        },
        emit: (event) => emitRunEvent(event, current),
        now
      });
      const drifted = driftedRun(current.run_id);
      if (drifted) {
        return drifted;
      }
      await openProposalFromManifest(current, result);
      current = updateRun(finalizeExecutedRun(current, result, now()));
      await persistRunWithTrace(current);
      await emitFinalRunEvent(current, result);
      await recordRunConfidence(current, result);
      await notifyRunMilestone(current, result.reason);
      return current;
    } catch (error) {
      const failureReason = error instanceof Error ? error.message : String(error);
      const drifted = driftedRun(current.run_id);
      if (drifted) {
        return drifted;
      }
      current = updateRun({
        ...current,
        status: "failed",
        usage: {
          ...current.usage
        },
        trace: [
          ...current.trace,
          {
            id: `${current.run_id}:final:error`,
            step_no: Math.max(current.trace.at(-1)?.step_no ?? 0, 0) + 1,
            phase: "final",
            output_excerpt: failureReason,
            control_signal: "escalate",
            created_at: now().toISOString()
          }
        ],
        updated_at: now().toISOString()
      });
      await persistRunWithTrace(current);
      await emitRunEvent({
        type: eventTypes.agentRunFailed,
        previewText: failureReason,
        data: {
          run_id: current.run_id,
          work_item_id: current.work_item_id,
          reason: failureReason
        }
      }, current, "worried");
      await emitFinalRunEvent(current, {
        status: "failed",
        reason: failureReason,
        control: "escalate",
        usage: {
          stepsUsed: current.usage.steps_used,
          secondsUsed: 0,
          tokenIn: current.usage.token_in,
          tokenOut: current.usage.token_out,
          totalTokens: current.usage.token_in + current.usage.token_out,
          estimatedCostCny: current.usage.estimated_cost_cny
        },
        steps: []
      });
      await recordRunConfidence(current, {
        status: "failed",
        reason: failureReason,
        control: "escalate",
        usage: {
          stepsUsed: current.usage.steps_used,
          secondsUsed: 0,
          tokenIn: current.usage.token_in,
          tokenOut: current.usage.token_out,
          totalTokens: current.usage.token_in + current.usage.token_out,
          estimatedCostCny: current.usage.estimated_cost_cny
        },
        steps: []
      });
      await notifyRunMilestone(current, current.trace.at(-1)?.output_excerpt ?? "AI 执行中断,需要人工查看。");
      return current;
    }
  }

  async function recordRunConfidence(run: AgentRunQueueRecord, result: AgentLoopResult) {
    if (options.confidence === false || !options.confidence) {
      return;
    }
    try {
      await options.confidence({ run, result });
    } catch (error) {
      console.warn("WorkHub AgentRun confidence recording failed", error);
    }
  }

  async function notifyRunMilestone(run: AgentRunQueueRecord, reasonOneline: string) {
    const newStatus = run.status === "succeeded"
      ? "in_review"
      : run.status === "failed" || run.status === "escalated"
        ? "escalated"
        : null;
    if (!newStatus || options.notifications === false) {
      return;
    }
    const notifications = options.notifications ?? createNotificationService();
    const resolvedWorkItem = await notificationWorkItem?.(run);
    const submitterUserId = resolvedWorkItem?.submitterUserId ?? run.actor_id;
    const workItem: LifecycleWorkItemRef = {
      id: resolvedWorkItem?.id ?? run.work_item_id,
      code: resolvedWorkItem?.code ?? "当前事项",
      title: resolvedWorkItem?.title ?? run.title,
      submitterUserId,
      ...(resolvedWorkItem?.projectId ? { projectId: resolvedWorkItem.projectId } : {}),
      ...(resolvedWorkItem?.assigneeUserIds ? { assigneeUserIds: resolvedWorkItem.assigneeUserIds } : {}),
      ...(resolvedWorkItem?.leadUserId ? { leadUserId: resolvedWorkItem.leadUserId } : {}),
      ...(resolvedWorkItem?.projectOwnerUserId ? { projectOwnerUserId: resolvedWorkItem.projectOwnerUserId } : {}),
      ...(resolvedWorkItem?.approverUserId
        ? { approverUserId: resolvedWorkItem.approverUserId }
        : newStatus === "in_review"
          ? { approverUserId: submitterUserId }
          : {})
    };
    try {
      await notifications.notifyMilestone({
        workItem,
        actor: {
          id: "ai-auto",
          label: "AI 工人"
        },
        newStatus,
        reasonOneline
      });
    } catch (error) {
      console.warn("WorkHub notification milestone failed", error);
    }
  }

  return {
    async enqueue(input) {
      let existing = activeForWorkItem(input.workItemId);
      if (!existing && persistence) {
        existing = await persistedActiveForWorkItem(input.workItemId) ?? undefined;
      }
      if (existing) {
        throw new AgentRunnerError(409, "agent_run_already_active", "这个事项已经有 AI 在处理了。");
      }
      startingWorkItems.add(input.workItemId);
      try {
        const humanReserved = await humanReservedGuard?.({
          ...input,
          settings
        });
        if (humanReserved) {
          throw new AgentRunnerError(
            409,
            "human_reserved",
            "这个事项已经标记为人工处理，我不会让 AI 工人自动施工。",
            {
              escalation_id: humanReserved.escalationId,
              trigger: humanReserved.trigger,
              source: humanReserved.source,
              reused: humanReserved.reused,
              suggested_action: "pm_mode"
            }
          );
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
        await persistCreatedRun(run);
        runs.set(run.run_id, run);
        return run;
      } finally {
        startingWorkItems.delete(input.workItemId);
      }
    },

    async get(runId) {
      const run = runs.get(runId) ?? await persistence?.get(runId) ?? null;
      if (run) {
        runs.set(run.run_id, run);
      }
      return run;
    },

    async workdir(runId) {
      return runWorkdirs.get(runId) ?? runs.get(runId)?.workdir_ref ?? await persistence?.getWorkdir(runId) ?? null;
    },

    async trace(runId, after = 0) {
      const run = runs.get(runId) ?? await persistence?.get(runId) ?? null;
      if (!run) {
        throw new AgentRunnerError(404, "not_found", "没有找到这次 AI 执行。");
      }
      runs.set(run.run_id, run);
      return run.trace.filter((step) => step.step_no > after);
    },

    async abort(runId, actor) {
      const run = runs.get(runId) ?? await persistence?.get(runId) ?? null;
      if (!run) {
        throw new AgentRunnerError(404, "not_found", "没有找到这次 AI 执行。");
      }
      if (run.actor_id !== abortActorId(actor) && !abortActorIsAdmin(actor)) {
        throw new AgentRunnerError(403, "agent_run_abort_forbidden", "只有发起人或管理员可以取消这次 AI 执行。");
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
      await persistRun(updated);
      return updated;
    },

    async listActive() {
      const byId = new Map<string, AgentRunQueueRecord>();
      for (const run of await persistence?.listActive() ?? []) {
        byId.set(run.run_id, run);
      }
      for (const run of runs.values()) {
        if (run.status === "queued" || run.status === "running") {
          byId.set(run.run_id, run);
        }
      }
      return [...byId.values()];
    },

    run: executeRun,

    async runNext() {
      const run = await queuedRun();
      return run ? executeRun(run.run_id) : null;
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

function toAgentLoopBudget(budget: AgentRunQueueRecord["budget"]) {
  return {
    maxSteps: budget.max_steps,
    totalTimeoutSeconds: budget.total_timeout_s,
    maxTokens: budget.max_tokens,
    maxCostCny: budget.max_cost_cny
  };
}

function preview(value: unknown, maxLength = 200) {
  if (typeof value === "string") {
    return value.slice(0, maxLength);
  }
  try {
    return JSON.stringify(value).slice(0, maxLength);
  } catch {
    return String(value).slice(0, maxLength);
  }
}

function textPreview(step: AgentLoopStep) {
  return step.assistant
    .filter((block) => block.type === "text" || block.type === "thinking")
    .map((block) => block.text)
    .join("\n")
    .trim()
    .slice(0, 200);
}

function traceRecordsFromStep(runId: string, step: AgentLoopStep): AgentRunTraceStepRecord[] {
  const records: AgentRunTraceStepRecord[] = [];
  const text = textPreview(step);
  if (text) {
    records.push({
      id: `${runId}:step:${step.index}:think`,
      step_no: step.index,
      phase: "think",
      output_excerpt: text,
      control_signal: step.control,
      ...(step.snapshotId ? { snapshot_id: step.snapshotId } : {}),
      created_at: step.endedAt
    });
  }
  for (const toolCall of step.toolCalls) {
    records.push({
      id: `${runId}:step:${step.index}:tool:${toolCall.id}`,
      step_no: step.index,
      phase: "tool_call",
      output_excerpt: `${toolCall.name} ${preview(toolCall.input)}`.slice(0, 200),
      control_signal: step.control,
      ...(step.snapshotId ? { snapshot_id: step.snapshotId } : {}),
      created_at: step.endedAt
    });
  }
  step.toolResults.forEach((result, index) => {
    records.push({
      id: `${runId}:step:${step.index}:result:${index + 1}`,
      step_no: step.index,
      phase: "tool_result",
      output_excerpt: result.content.slice(0, 200),
      control_signal: step.control,
      ...(result.snapshotId ?? step.snapshotId ? { snapshot_id: result.snapshotId ?? step.snapshotId } : {}),
      created_at: step.endedAt
    });
  });
  return records;
}

function toQueueUsage(usage: AgentLoopUsage): AgentRunQueueRecord["usage"] {
  return {
    steps_used: usage.stepsUsed,
    token_in: usage.tokenIn,
    token_out: usage.tokenOut,
    estimated_cost_cny: usage.estimatedCostCny
  };
}

function toQueueHandoff(handoff: StructuredHandoff): NonNullable<AgentRunQueueRecord["handoff"]> {
  return {
    done: handoff.done,
    remaining: handoff.remaining,
    next_steps: handoff.nextSteps,
    blockers: handoff.blockers,
    artifacts: handoff.artifacts,
    budget_hit: handoff.budgetHit
  };
}

function finalizeExecutedRun(
  run: AgentRunQueueRecord,
  result: AgentLoopResult,
  endedAt: Date
): AgentRunQueueRecord {
  const trace = [
    ...run.trace,
    {
      id: `${run.run_id}:final:${result.status}`,
      step_no: result.usage.stepsUsed + 1,
      phase: "final" as const,
      output_excerpt: result.reason.slice(0, 200),
      control_signal: result.control,
      created_at: endedAt.toISOString()
    }
  ];
  return {
    ...run,
    status: result.status,
    usage: toQueueUsage(result.usage),
    trace,
    ...(result.handoff ? { handoff: toQueueHandoff(result.handoff) } : {}),
    updated_at: endedAt.toISOString()
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
  defaultQueue ??= createInMemoryAgentRunQueue({
    confidence: createAgentRunConfidenceRecorder(),
    humanReserved: createHumanReservedGuard(),
    ledgerStore: getDefaultCostLedgerStore(),
    proposals: getDefaultProposalService(),
    persistence: getDefaultAgentRunPersistence(),
    notificationWorkItem: createAgentRunNotificationWorkItemResolver()
  });
  return defaultQueue;
}
