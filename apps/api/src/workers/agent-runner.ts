import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
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
  createMemoryBudgetPolicyStore,
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
  createSkillTool,
  skillCatalogForPrompt,
  createBuiltInFileTools,
  createToolRegistry,
  errorToolResult,
  nodeCommandRunner,
  type CommandRunner,
  type SnapshotHook,
  type ToolExecutionContext,
  type ToolResult
} from "@workhub/tools";
import { makeWorkHubEvent, topics, toCuuState, type LifecycleWorkItemRef } from "@workhub/events";
import { getSharedDatabaseClient, createWorkItemRepository } from "@workhub/db";
import type {
  AuditLogRepository,
  SnapshotRepository,
  StoredWorkItemDetailRows,
  WorkItemDataRepository,
  WorkItemProjectRow,
  WorkHubDatabaseClient
} from "@workhub/db";

import { getDefaultPushBus, type PushBus } from "../broker/index.js";
import { getDefaultCostLedgerStore } from "../services/cost-ledger-store.js";
import { getDefaultBudgetPolicyStore } from "../services/cost-policy-store.js";
import { getDefaultProviderRegistry } from "../services/provider-registry.js";
import { createSnapshotService } from "@workhub/audit";
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
import { getDefaultUserMemoryContextProvider, type UserMemoryContextProvider } from "../services/user-memory.js";
import {
  getDefaultTeamSkillContextProvider,
  type TeamSkillContextProvider
} from "../services/team-skill-context.js";
import { getDefaultProjectHydrator, type ProjectHydrator } from "./project-hydrate.js";
import { getDefaultAuditStores } from "../services/audit-stores.js";

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
  claim?: {
    claimed_by: string;
    claimed_at: string;
    heartbeat_at: string;
    lease_expires_at: string;
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
export type AgentRunWorkItemContextProvider =
  (run: AgentRunQueueRecord) => Promise<string | undefined> | string | undefined;
export type AgentRunPersistence = {
  createRun: (run: AgentRunQueueRecord) => Promise<void>;
  createRunIfWorkItemIdle?: (run: AgentRunQueueRecord) => Promise<boolean>;
  // workerId（可选）：执行循环把自己的 workerId 透传下去，让持久层对写入加 `claimedBy = workerId` 守卫；
  // 租约被回收/转交后本 worker 的写入即变空操作，不会污染新 owner 的数据。abort/enqueue 等非执行路径不传。
  updateRun: (run: AgentRunQueueRecord, workerId?: string) => Promise<void>;
  replaceTrace: (runId: string, trace: AgentRunTraceStepRecord[], workerId?: string) => Promise<void>;
  setWorkdir: (runId: string, workdir: string, at: Date, workerId?: string) => Promise<void>;
  get: (runId: string) => Promise<AgentRunQueueRecord | null>;
  getWorkdir: (runId: string) => Promise<string | null>;
  listActive: () => Promise<AgentRunQueueRecord[]>;
  claimQueued?: (runId: string, claim: AgentRunClaimLease) => Promise<AgentRunQueueRecord | null>;
  claimNextQueued?: (claim: AgentRunClaimLease) => Promise<AgentRunQueueRecord | null>;
  heartbeatClaim?: (input: AgentRunHeartbeatLease) => Promise<AgentRunQueueRecord | null>;
  requeueExpiredClaims?: (input: AgentRunRequeueExpiredLeases) => Promise<AgentRunQueueRecord[]>;
};

export type AgentRunClaimLease = {
  workerId: string;
  claimedAt: Date;
  heartbeatAt: Date;
  leaseExpiresAt: Date;
};

export type AgentRunHeartbeatLease = {
  runId: string;
  workerId: string;
  heartbeatAt: Date;
  leaseExpiresAt: Date;
};

export type AgentRunRequeueExpiredLeases = {
  expiredBefore: Date;
  requeuedAt: Date;
  // 已被恢复 >= 此次数的过期 run 转死信 failed，不再重排（防 poison run 无限重跑）。
  maxRecoverAttempts: number;
};

export type AgentRunQueue = {
  enqueue: (input: EnqueueAgentRunInput) => Promise<AgentRunQueueRecord>;
  get: (runId: string) => Promise<AgentRunQueueRecord | null>;
  workdir: (runId: string) => Promise<string | null>;
  trace: (runId: string, after?: number) => Promise<AgentRunTraceStepRecord[]>;
  abort: (runId: string, actor: AbortAgentRunActor) => Promise<AgentRunQueueRecord>;
  listActive: () => Promise<AgentRunQueueRecord[]>;
  recoverExpiredClaims: () => Promise<AgentRunQueueRecord[]>;
  run: (runId: string) => Promise<AgentRunQueueRecord>;
  runNext: () => Promise<AgentRunQueueRecord | null>;
};

function compactContextText(value: string | null | undefined, maxChars = 1400) {
  const text = value?.trim();
  if (!text) {
    return undefined;
  }
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n...[truncated]`;
}

function indentedBlock(value: string) {
  return value.split(/\r?\n/u).map((line) => `  ${line}`).join("\n");
}

function formatWorkItemContext(
  rows: StoredWorkItemDetailRows,
  project: WorkItemProjectRow | null,
  selectedOptionIds: string[]
) {
  const item = rows.workItem;
  const lines = [
    `- Work item: ${item.code}${item.title ? ` - ${item.title}` : ""}`,
    `- Status / mode / priority: ${item.status} / ${item.mode} / ${item.priority}`,
    `- Project: ${project ? `${project.name} (${project.slug})` : item.projectId}`
  ];
  const rawDescription = compactContextText(item.rawDescription, 1800);
  if (rawDescription) {
    lines.push(`- Raw description:\n${indentedBlock(rawDescription)}`);
  }
  const summary = item.summaryMd !== item.rawDescription ? compactContextText(item.summaryMd, 1200) : undefined;
  if (summary) {
    lines.push(`- Current summary:\n${indentedBlock(summary)}`);
  }
  const planningNote = compactContextText(item.planningNote, 800);
  if (planningNote) {
    lines.push(`- Planning note: ${planningNote}`);
  }
  if (selectedOptionIds.length > 0) {
    lines.push(`- User-selected clarification options: ${selectedOptionIds.join(", ")}`);
  }
  if (rows.acceptance.length > 0) {
    lines.push([
      "- Acceptance checks:",
      ...rows.acceptance.slice(0, 10).map((acceptance, index) => {
        const description = compactContextText(acceptance.description, 320);
        return `  ${index + 1}. [${acceptance.status}] ${acceptance.title}${description ? ` - ${description}` : ""}`;
      })
    ].join("\n"));
  }
  if (rows.evidenceBindings.length > 0) {
    lines.push(`- Evidence bindings available: ${rows.evidenceBindings.length}. Use them as context; do not invent missing facts.`);
  }
  if (rows.driveSourceComment) {
    lines.push(`- Drive source: ${rows.driveSourceComment.folderPath ?? rows.driveSourceComment.comment.folderId ?? "linked drive comment"}`);
  }
  if (rows.meetingSourceInsight) {
    const insight = compactContextText(rows.meetingSourceInsight.insight.description, 500);
    lines.push(`- Meeting source insight: ${insight ?? rows.meetingSourceInsight.meeting.title ?? rows.meetingSourceInsight.meeting.id}`);
  }
  if (rows.latestProposal) {
    lines.push(`- Latest proposal: ${rows.latestProposal.title} (${rows.latestProposal.status})`);
  }
  if (rows.acceptedDeliverables.length > 0) {
    lines.push(`- Accepted deliverables already exist: ${rows.acceptedDeliverables.length}. Preserve accepted work unless asked to replace it.`);
  }
  return lines.join("\n");
}

function createDbWorkItemContextProvider(repository: WorkItemDataRepository): AgentRunWorkItemContextProvider {
  return async (run) => {
    const rows = await repository.readWorkItemDetail(run.work_item_id);
    if (!rows) {
      return undefined;
    }
    const [project, selectedOptionIds] = await Promise.all([
      repository.findProjectById(rows.workItem.projectId),
      repository.listSessionSelectedOptionIds(rows.workItem.id)
    ]);
    return formatWorkItemContext(rows, project, selectedOptionIds);
  };
}

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
  auditLogs?: AuditLogRepository | false;
  confidence?: AgentRunConfidenceRecorder | false;
  humanReserved?: HumanReservedGuard | false;
  proposals?: AgentRunProposalSink | false;
  notifications?: AgentRunNotificationPublisher | false;
  notificationWorkItem?: AgentRunNotificationWorkItemResolver | false;
  eventBus?: AgentRunEventBus | false;
  persistence?: AgentRunPersistence | false;
  workerId?: string;
  leaseMs?: number;
  heartbeatIntervalMs?: number;
  maxRecoverAttempts?: number;
  // 注入受控命令执行器；不传则 run_command fail-closed（默认不执行宿主命令）。
  commandRunner?: CommandRunner;
  systemPrompt?: string;
  initialUserMessage?: (run: AgentRunQueueRecord, workItemContext?: string) => string | Promise<string>;
  workItemContext?: AgentRunWorkItemContextProvider | false;
  userMemory?: UserMemoryContextProvider | false;
  teamSkills?: TeamSkillContextProvider | false;
  hydrateProject?: ProjectHydrator | false;
  requireDeliverable?: boolean;
  emit?: (event: AgentLoopEvent, run: AgentRunQueueRecord) => Promise<void> | void;
} = {}): AgentRunQueue {
  const now = options.now ?? (() => new Date());
  const nextId = options.id ?? randomUUID;
  const settings = options.settings ?? runtimeSettings;
  const policyStore = options.policyStore ?? createMemoryBudgetPolicyStore();
  const ledgerStore = options.ledgerStore ?? createMemoryCostLedgerStore({
    teamId: settings.auth.defaultWorkspaceId,
    evalSuite: "nightly"
  });
  const defaultTools = createToolRegistry([...createBuiltInFileTools(), createSkillTool()]);
  const humanReservedGuard = options.humanReserved === false ? undefined : options.humanReserved;
  const proposalSink = options.proposals === false ? undefined : options.proposals;
  const notificationWorkItem = options.notificationWorkItem === false ? undefined : options.notificationWorkItem;
  const eventBus = options.eventBus === false ? undefined : options.eventBus ?? getDefaultPushBus();
  const persistence = options.persistence === false ? undefined : options.persistence;
  const workItemContext = options.workItemContext === false ? undefined : options.workItemContext;
  const userMemory = options.userMemory === false ? undefined : options.userMemory;
  const teamSkills = options.teamSkills === false ? undefined : options.teamSkills;
  const hydrateProject = options.hydrateProject === false ? undefined : options.hydrateProject;
  const workerId = options.workerId ?? `${os.hostname()}:${process.pid}`;
  const leaseMs = options.leaseMs ?? 5 * 60 * 1000;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? Math.max(1000, Math.min(30_000, Math.floor(leaseMs / 3)));
  const maxRecoverAttempts = Math.max(1, options.maxRecoverAttempts ?? 3);
  const decideBudget = options.decideBudget ?? (async (input: BudgetDecisionInput) =>
    decideRunBudget({
      settings: input.settings,
      scopeIds: {
        workItemId: input.workItemId,
        userId: input.actorId,
        teamId: input.settings.auth.defaultWorkspaceId
      },
      policies: await policyStore.listPolicies(input.settings),
      usage: await (options.usage?.(input) ?? ledgerStore.usageSnapshots({
        workItemId: input.workItemId,
        userId: input.actorId,
        teamId: input.settings.auth.defaultWorkspaceId
      }, { now: now() })),
      modelRoute: {
        provider: input.settings.llm.defaultProvider,
        model: input.settings.llm.model,
        reason: "default"
      },
      now: now()
    }));
  const runs = new Map<string, AgentRunQueueRecord>();
  const runWorkdirs = new Map<string, string>();
  // P-COLLAB M2：run 开始时拍下的 project/ base 快照 id（按 run 暂存），
  // 开提议时写进 manifest.base.snapshot_id → createProposal 落到 branches.baseSnapshotId。
  const runBaseSnapshotIds = new Map<string, string>();
  const startingWorkItems = new Set<string>();
  const tracePersistenceChains = new Map<string, Promise<void>>();
  // 内存里只保留有限条已结束的 run 作为读缓存；活跃(queued/running)的永不剔除。
  // 否则长跑 worker 的 runs/runWorkdirs Map 会无限增长 → 内存泄漏。有 persistence 时被剔的 run 仍可从 DB 读回。
  const RUN_CACHE_CAP = 500;
  const TERMINAL_RUN_STATUSES = new Set(["succeeded", "failed", "escalated", "budget_exhausted", "cancelled"]);

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
    if (persistence?.claimNextQueued) {
      return persistence.claimNextQueued(createClaimLease());
    }
    const inMemory = [...runs.values()].find((run) => run.status === "queued");
    if (inMemory) {
      return inMemory;
    }
    const persisted = await persistence?.listActive();
    return persisted?.find((run) => run.status === "queued") ?? null;
  }

  function createClaimLease(): AgentRunClaimLease {
    const claimedAt = now();
    return {
      workerId,
      claimedAt,
      heartbeatAt: claimedAt,
      leaseExpiresAt: new Date(claimedAt.getTime() + leaseMs)
    };
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

  function defaultWorkerSystemPrompt(teamSkillCatalogAppendix?: string) {
    const catalog = [skillCatalogForPrompt(), teamSkillCatalogAppendix?.trim()]
      .filter((part): part is string => Boolean(part))
      .join("\n");
    return [
      "你是 WorkHub 的 AI 工人（默认劳动力）。人类是审批者：你的产出会进入\"提议→审批→合并\"流程，必须让非技术审阅者一眼能懂。",
      "",
      "工作纪律：",
      "1. 交付物必须写入 outputs/ 目录（用 write_file / write_base64_file）。没有 outputs/ 产出 = 任务失败。",
      "2. 只做数字交付物：文档、报告、结构化数据(JSON/YAML/CSV)、小型代码或模板、本地可算出的分析结果。不做对外发送、付款、部署、联网安装、不可逆删除；任务要求这些时，停止并在总结中列为 blocker。",
      "3. 完成判定：当你不再需要任何工具调用时自然结束。结束前用简短人话总结：做了什么、产出文件在哪、还有什么没做。",
      "4. 信息不足、权限不够或同一动作反复失败时：停止尝试，明确列出 blockers（缺什么、建议谁来定），不要猜测或编造内容。",
      "5. 工具结果可能被截断（标注\"完整内容见 trace\"）；需要完整内容时分段读取。",
      "6. 输出语言跟随任务描述的语言；交付物命名用清晰的小写连字符文件名。",
      "",
      "技能纪律：涉及下列交付物类型时，必须先用 load_skill 加载对应技能再动手；库用法、模板与自验步骤以技能内容为准，不得凭记忆臆写 API。",
      catalog
    ].join("\n");
  }

  function defaultInitialUserMessage(
    run: AgentRunQueueRecord,
    resolvedWorkItemContext?: string,
    userMemorySection?: string,
    projectFileCount?: number
  ) {
    return [
      `任务：${run.title}`,
      `work_item_id: ${run.work_item_id}`,
      ...(resolvedWorkItemContext
        ? [
            "",
            "WorkHub 数据库中的真实工单上下文：",
            resolvedWorkItemContext
          ]
        : []),
      ...(userMemorySection ? [userMemorySection] : []),
      ...(projectFileCount && projectFileCount > 0
        ? [
            "",
            `本项目已有 ${projectFileCount} 个文件放在只读目录 project/（项目现有资料）。动手前先用 list_files/read_file 查阅相关文件，复用或衔接已有内容，避免重复造或与现有冲突。project/ 只读，产出仍写入 outputs/。`
          ]
        : []),
      "",
      "请按以下方式工作：",
      "1. 先用 list_files / read_file 了解工作目录里已有的材料（如有）。",
      "2. 围绕任务目标生成交付物，写入 outputs/ 目录。",
      "3. 完成后自然结束，并给出人话总结（做了什么 / 产出在哪 / 未尽事项）。"
    ].join("\n");
  }

  function updateRun(run: AgentRunQueueRecord) {
    runs.set(run.run_id, run);
    pruneRunCache();
    return run;
  }

  // 超过上限时，按插入顺序剔除最旧的已结束 run（Map 保序），保留全部活跃 run。
  function pruneRunCache() {
    if (runs.size <= RUN_CACHE_CAP) {
      return;
    }
    for (const [runId, record] of runs) {
      if (runs.size <= RUN_CACHE_CAP) {
        break;
      }
      if (TERMINAL_RUN_STATUSES.has(record.status)) {
        runs.delete(runId);
        runWorkdirs.delete(runId);
        runBaseSnapshotIds.delete(runId);
      }
    }
  }

  async function persistCreatedRun(run: AgentRunQueueRecord) {
    await persistence?.createRun(run);
    if (run.trace.length > 0) {
      await queueTracePersistence(run);
    }
  }

  async function persistCreatedRunIfWorkItemIdle(run: AgentRunQueueRecord) {
    if (!persistence?.createRunIfWorkItemIdle) {
      await persistCreatedRun(run);
      return;
    }
    const created = await persistence.createRunIfWorkItemIdle(run);
    if (!created) {
      throw new AgentRunnerError(409, "agent_run_already_active", "这个事项已经有 AI 在处理了。");
    }
    if (run.trace.length > 0) {
      await queueTracePersistence(run);
    }
  }

  // fencingWorkerId：执行循环传 workerId 给写入加租约守卫（见 AgentRunPersistence 注释）；
  // abort/enqueue 等非执行路径省略，保持无守卫写入。
  async function persistRun(run: AgentRunQueueRecord, fencingWorkerId?: string) {
    await persistence?.updateRun(run, fencingWorkerId);
  }

  async function persistRunWithTrace(run: AgentRunQueueRecord, fencingWorkerId?: string) {
    await persistRun(run, fencingWorkerId);
    await queueTracePersistence(run, fencingWorkerId);
  }

  function queueTracePersistence(run: AgentRunQueueRecord, fencingWorkerId?: string) {
    if (!persistence) {
      return Promise.resolve();
    }
    const previous = tracePersistenceChains.get(run.run_id) ?? Promise.resolve();
    const task = previous
      .catch(() => undefined)
      .then(() => persistence.replaceTrace(run.run_id, run.trace, fencingWorkerId));
    tracePersistenceChains.set(run.run_id, task);
    void task.finally(() => {
      if (tracePersistenceChains.get(run.run_id) === task) {
        tracePersistenceChains.delete(run.run_id);
      }
    });
    return task;
  }

  function persistTraceInBackground(run: AgentRunQueueRecord, fencingWorkerId?: string) {
    if (!persistence) {
      return;
    }
    void queueTracePersistence(run, fencingWorkerId).catch((error) => {
      console.warn("WorkHub AgentRun trace persistence failed", error);
    });
  }

  async function refreshClaim(run: AgentRunQueueRecord) {
    if (!persistence?.heartbeatClaim || !run.claim) {
      return;
    }
    const heartbeatAt = now();
    const leaseExpiresAt = new Date(heartbeatAt.getTime() + leaseMs);
    const updated = await persistence.heartbeatClaim({
      runId: run.run_id,
      workerId,
      heartbeatAt,
      leaseExpiresAt
    });
    const live = runs.get(run.run_id);
    if (!live || live.status !== "running") {
      return;
    }
    if (!updated) {
      // 心跳命中 0 行：该 run 已不归本 worker（租约过期被回收/转交给别的 worker，或已被取消）。
      // 本地标记漂移，让执行循环尽快停手——工具执行守卫(driftedRun)与循环后的 driftedRun 检查都会据此中止；
      // 同时后续写入会被持久层的 claimedBy fencing 拒绝，不会污染接手的新 owner。
      // 注意：心跳的瞬时 DB 错误会 throw 并被 refreshClaimInBackground 的 .catch 吞掉，不会走到这里，
      // 因此 updated 为 null 必定意味着「行不再匹配 id+running+claimedBy」，即真正的租约丢失。
      runs.set(run.run_id, { ...live, status: "failed", updated_at: now().toISOString() });
      return;
    }
    runs.set(run.run_id, {
      ...live,
      ...(updated.claim ? { claim: updated.claim } : {}),
      updated_at: updated.updated_at
    });
  }

  async function auditRecoveredClaims(recovered: AgentRunQueueRecord[], recoveredAt: Date) {
    if (recovered.length === 0 || options.auditLogs === false) {
      return;
    }
    const auditLogs = options.auditLogs ?? getDefaultAuditStores().auditLogs;
    for (const run of recovered) {
      // 转死信的（status=failed）与重排的（status=queued）打不同 action：死信值得人盯（poison run）。
      const deadLettered = run.status === "failed";
      await auditLogs.createAuditLog({
        actorKind: "system",
        actorNickname: "agent-run-recovery",
        entityType: "agent_run",
        entityId: run.run_id,
        action: deadLettered ? "agent_run.dead_lettered_stale_claim" : "agent_run.requeued_stale_claim",
        detailJson: {
          run_id: run.run_id,
          work_item_id: run.work_item_id,
          ...(deadLettered ? { dead_lettered: true } : {}),
          requeued_at: recoveredAt.toISOString()
        }
      });
    }
  }

  function refreshClaimInBackground(runId: string) {
    const live = runs.get(runId);
    if (!live || live.status !== "running") {
      return;
    }
    void refreshClaim(live).catch((error) => {
      console.warn("WorkHub AgentRun claim heartbeat failed", error);
    });
  }

  function startClaimHeartbeat(runId: string) {
    if (!persistence?.heartbeatClaim || heartbeatIntervalMs <= 0) {
      return () => undefined;
    }
    const timer = setInterval(() => refreshClaimInBackground(runId), heartbeatIntervalMs);
    return () => clearInterval(timer);
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

  function runUpdatedAtMs(run: AgentRunQueueRecord) {
    const value = Date.parse(run.updated_at);
    return Number.isFinite(value) ? value : 0;
  }

  function persistedRunIsFresher(live: AgentRunQueueRecord, persisted: AgentRunQueueRecord) {
    const liveUpdatedAt = runUpdatedAtMs(live);
    const persistedUpdatedAt = runUpdatedAtMs(persisted);
    if (persistedUpdatedAt !== liveUpdatedAt) {
      return persistedUpdatedAt > liveUpdatedAt;
    }
    return persisted.trace.length > live.trace.length;
  }

  async function readFreshRun(runId: string) {
    const live = runs.get(runId) ?? null;
    const persisted = await persistence?.get(runId) ?? null;
    const run = persisted && (!live || persistedRunIsFresher(live, persisted))
      ? persisted
      : live ?? persisted;
    if (run) {
      runs.set(run.run_id, run);
    }
    return run;
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

  async function openProposalFromManifest(
    run: AgentRunQueueRecord,
    result: AgentLoopResult,
    confidenceId?: string
  ) {
    if (!proposalSink || result.status !== "succeeded" || !result.manifest) {
      return;
    }

    // P-COLLAB M2：把 run 开始时拍的 project/ base 快照 id 写进 manifest.base.snapshot_id。
    // createProposal 建分支时读取它落到 branches.baseSnapshotId,供三方合并/对底稿当 diff3 共同祖先。
    // 这里是覆盖写：manifest.base.snapshot_id 原本是循环的整 workdir 快照（回滚点,另存于
    // rollback.snapshot_id),而合并要的是 project/ 专属祖先。branches.baseSnapshotId 目前别无消费者,覆盖安全。
    const baseSnapshotId = runBaseSnapshotIds.get(run.run_id);
    if (baseSnapshotId) {
      result.manifest.base.snapshot_id = baseSnapshotId;
    }

    const proposal = await proposalSink.createFromManifest({
      workItemId: run.work_item_id,
      manifest: result.manifest,
      actor: { actor_kind: "ai", label: "WorkHub AI" },
      title: result.manifest.title,
      agentRunId: run.run_id,
      // M27：把本次运行的置信度记录与提议关联，审查者打开提议即可看到 AI 的评级/结论。
      ...(confidenceId ? { confidenceId } : {}),
      ...(result.manifest.branch_id ? { branchId: result.manifest.branch_id } : {})
    });
    await emitProposalOpenedEvent(run, proposal);
  }

  async function executeRun(runId: string, claimedRun?: AgentRunQueueRecord) {
    let run = claimedRun;
    const requiresPersistentClaim = !run && Boolean(persistence?.claimQueued);
    if (requiresPersistentClaim && persistence?.claimQueued) {
      run = await persistence.claimQueued(runId, createClaimLease()) ?? undefined;
    }
    if (!run && requiresPersistentClaim) {
      const existing = await persistence?.get(runId);
      if (!existing) {
        throw new AgentRunnerError(404, "not_found", "没有找到这次 AI 执行。");
      }
      throw new AgentRunnerError(409, "agent_run_not_queued", "这次 AI 执行已经不是排队状态。");
    }
    run = run ?? runs.get(runId);
    if (!run) {
      run = await persistence?.get(runId) ?? undefined;
      if (run) {
        runs.set(run.run_id, run);
      }
    }
    if (!run) {
      throw new AgentRunnerError(404, "not_found", "没有找到这次 AI 执行。");
    }
    if (run.status !== "queued" && run.status !== "running") {
      throw new AgentRunnerError(409, "agent_run_not_queued", "这次 AI 执行已经不是排队状态。");
    }

    let current = updateRun(run.status === "running"
      ? run
      : {
          ...run,
          status: "running",
          updated_at: now().toISOString()
        });
    if (run.status !== "running") {
      await persistRun(current, workerId);
    }
    const executionInput = { run: current, settings };
    const client = await (options.client ?? defaultClient)(executionInput);
    const workdir = await (options.workdir ?? defaultWorkdir)(executionInput);
    runWorkdirs.set(current.run_id, workdir);
    current = updateRun({
      ...current,
      workdir_ref: workdir,
      updated_at: now().toISOString()
    });
    await persistence?.setWorkdir(current.run_id, workdir, now(), workerId);
    // P-COLLAB M1：把项目现有文件物化进 workdir/project/（只读参考区），让 AI 能读整个项目。
    // fail-open：物化失败不影响 run（照常以空 workdir 跑）。默认关闭，由 hydrateProject 提供者决定。
    let projectFileCount = 0;
    if (hydrateProject) {
      try {
        const hydrated = await hydrateProject(current, workdir);
        projectFileCount = hydrated?.files ?? 0;
      } catch (error) {
        console.warn("WorkHub project hydrate failed", error);
      }
    }
    // P-COLLAB M2：物化出 project/（只读祖先态）后,趁 AI 还没动手,拍一份 kind:"base" 快照。
    // 它就是这次工作副本的"共同祖先",日后三方合并/对底稿(rebase)拿它当 diff3 base。
    // fail-open：拍照失败不影响 run（baseSnapshotId 留空,合并回退到 accepted-history 祖先）。
    if (projectFileCount > 0 && options.snapshots) {
      try {
        const baseSnapshotRoot =
          options.snapshotRoot ?? path.join(settings.dataDir, "snapshots", "agent-runs", current.run_id);
        const baseSnapshot = await createSnapshotService({ snapshotRoot: baseSnapshotRoot, now })
          .takeSandboxFileSnapshot({
            workItemId: current.work_item_id,
            workdir: path.join(workdir, "project"),
            kind: "base",
            createdByKind: "system"
          });
        const baseRow = await options.snapshots.createSnapshot({
          id: baseSnapshot.id,
          workItemId: baseSnapshot.workItemId,
          kind: baseSnapshot.kind,
          ref: baseSnapshot.ref,
          ...(baseSnapshot.contentSha256 ? { contentSha256: baseSnapshot.contentSha256 } : {}),
          createdByKind: baseSnapshot.createdByKind
        });
        runBaseSnapshotIds.set(current.run_id, baseRow.id);
      } catch (error) {
        console.warn("WorkHub base snapshot capture failed", error);
      }
    }
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

    const stopClaimHeartbeat = startClaimHeartbeat(current.run_id);

    try {
      const resolvedWorkItemContext = await workItemContext?.(current);
      const resolvedUserMemory = await userMemory?.(current);
      const resolvedTeamSkills = await teamSkills?.(current);
      // 默认工具集时把团队技能内容塞进 load_skill；自定义 tools 提供者保持原样不动。
      const teamSkillContent = resolvedTeamSkills?.contentByKey;
      const rawTools =
        !options.tools && teamSkillContent && Object.keys(teamSkillContent).length > 0
          ? createToolRegistry([...createBuiltInFileTools(), createSkillTool(undefined, teamSkillContent)])
          : options.tools?.(executionInput) ?? defaultTools;
      const tools: ReturnType<AgentRunToolsProvider> = {
        toModelTools: (ctx) => rawTools.toModelTools(ctx),
        execute: async (toolId, input, ctx) => {
          if (driftedRun(current.run_id)) {
            return errorToolResult("这次 AI 执行已经取消，已跳过后续工具执行。");
          }
          return rawTools.execute(toolId, input, ctx);
        }
      };
      const initialUserMessage = options.initialUserMessage
        ? await options.initialUserMessage(current, resolvedWorkItemContext)
        : defaultInitialUserMessage(current, resolvedWorkItemContext, resolvedUserMemory, projectFileCount);
      const result = await loop.run({
        runId: current.run_id,
        workItemId: current.work_item_id,
        actorId: current.actor_id,
        workdir,
        systemPrompt: options.systemPrompt ?? defaultWorkerSystemPrompt(resolvedTeamSkills?.catalogAppendix),
        initialUserMessage,
        client,
        tools,
        budget: toAgentLoopBudget(current.budget),
        maxTokensPerStep: settings.llm.maxTokensPerStep,
        requireDeliverable: options.requireDeliverable ?? true,
        ...(options.commandRunner ? { commandRunner: options.commandRunner } : {}),
        snapshot,
        recorder: {
          recordStep: (step) => {
            const live = runs.get(current.run_id);
            if (!live || live.status !== "running") {
              return;
            }
            current = updateRun({
              ...live,
              // recordUsage 在 recordStep 之前跑（loop.ts），但只写了 current 没写 runs map；
              // 这里 spread live（其 usage 是上一步的旧值）会把最新用量盖掉，导致失败 run 少记最近一步。
              // 显式带上 current.usage 保留最新用量（M1 失败记账的本意）。
              usage: current.usage,
              trace: [...live.trace, ...traceRecordsFromStep(current.run_id, step)],
              updated_at: now().toISOString()
            });
            persistTraceInBackground(current, workerId);
            refreshClaimInBackground(current.run_id);
          },
          // M1：把每步累计用量落到 current.usage，这样即便 loop 中途抛错，失败 run 也按真实消耗记账（不再记 0）。
          recordUsage: (usage) => {
            current = {
              ...current,
              usage: {
                steps_used: usage.stepsUsed,
                token_in: usage.tokenIn,
                token_out: usage.tokenOut,
                estimated_cost_cny: usage.estimatedCostCny
              }
            };
          }
        },
        emit: (event) => emitRunEvent(event, current),
        now
      });
      const drifted = driftedRun(current.run_id);
      if (drifted) {
        return drifted;
      }
      // 先落定运行成功状态，再开提议。否则 openProposalFromManifest 抛错（manifest 不匹配/
      // 提议已存在/DB 写失败）会被外层 catch 当作"run 失败"、丢掉本已成功的交付物。
      current = updateRun(finalizeExecutedRun(current, result, now()));
      await persistRunWithTrace(current, workerId);
      await emitFinalRunEvent(current, result);
      const confidenceId = await recordRunConfidence(current, result);
      try {
        await openProposalFromManifest(current, result, confidenceId);
      } catch (error) {
        console.warn("WorkHub openProposalFromManifest failed; run already recorded as succeeded", error);
      }
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
      await persistRunWithTrace(current, workerId);
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
    } finally {
      stopClaimHeartbeat();
    }
  }

  async function recordRunConfidence(
    run: AgentRunQueueRecord,
    result: AgentLoopResult
  ): Promise<string | undefined> {
    if (options.confidence === false || !options.confidence) {
      return undefined;
    }
    try {
      const recorded = await options.confidence({ run, result });
      return recorded?.confidenceId;
    } catch (error) {
      console.warn("WorkHub AgentRun confidence recording failed", error);
      return undefined;
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
      const hasPersistentIdleCreate = Boolean(persistence?.createRunIfWorkItemIdle);
      let existing = activeForWorkItem(input.workItemId);
      if (!existing && persistence) {
        existing = await persistedActiveForWorkItem(input.workItemId) ?? undefined;
      }
      if (existing) {
        throw new AgentRunnerError(409, "agent_run_already_active", "这个事项已经有 AI 在处理了。");
      }
      if (!hasPersistentIdleCreate) {
        startingWorkItems.add(input.workItemId);
      }
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
        await persistCreatedRunIfWorkItemIdle(run);
        runs.set(run.run_id, run);
        return run;
      } finally {
        if (!hasPersistentIdleCreate) {
          startingWorkItems.delete(input.workItemId);
        }
      }
    },

    async get(runId) {
      return readFreshRun(runId);
    },

    async workdir(runId) {
      return runWorkdirs.get(runId) ?? runs.get(runId)?.workdir_ref ?? await persistence?.getWorkdir(runId) ?? null;
    },

    async trace(runId, after = 0) {
      const run = await readFreshRun(runId);
      if (!run) {
        throw new AgentRunnerError(404, "not_found", "没有找到这次 AI 执行。");
      }
      return run.trace.filter((step) => step.step_no > after);
    },

    async abort(runId, actor) {
      const run = await readFreshRun(runId);
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

    async recoverExpiredClaims() {
      if (!persistence?.requeueExpiredClaims) {
        return [];
      }
      const recoveredAt = now();
      const recovered = await persistence.requeueExpiredClaims({
        expiredBefore: recoveredAt,
        requeuedAt: recoveredAt,
        maxRecoverAttempts
      });
      for (const run of recovered) {
        runs.set(run.run_id, run);
      }
      await auditRecoveredClaims(recovered, recoveredAt);
      return recovered;
    },

    run: executeRun,

    async runNext() {
      const run = await queuedRun();
      return run ? executeRun(run.run_id, run.status === "running" ? run : undefined) : null;
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

// 回收泄漏的 run workdir：长跑 worker 每个 run 在 os.tmpdir() 下 mkdtemp 一个 workhub-agent-* 目录
// （hydrate≤32MB 项目文件 + AI 输出），从不删除；崩溃/重启后旧目录成孤儿无限堆积。启动时扫一遍，
// 删掉 mtime 早于 TTL 的目录。TTL 默认 6h——远大于单次 run 上限（≤300s），故绝不会碰到活跃或近期
// （replay 仍要读产物）的 run 目录，无需额外的活跃集排除。
export async function sweepStaleAgentWorkdirs(input: {
  tmpDir?: string;
  ttlMs?: number;
  now?: () => number;
} = {}): Promise<{ removed: number; scanned: number }> {
  const dir = input.tmpDir ?? os.tmpdir();
  const ttlMs = input.ttlMs ?? 6 * 60 * 60 * 1000;
  const nowMs = input.now ? input.now() : Date.now();
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return { removed: 0, scanned: 0 };
  }
  let removed = 0;
  let scanned = 0;
  for (const name of entries) {
    if (!name.startsWith("workhub-agent-")) {
      continue;
    }
    scanned += 1;
    const full = path.join(dir, name);
    try {
      const info = await stat(full);
      if (!info.isDirectory() || nowMs - info.mtimeMs < ttlMs) {
        continue;
      }
      await rm(full, { recursive: true, force: true });
      removed += 1;
    } catch {
      // 单个目录扫描/删除失败不影响其余（可能正被并发清理/权限问题）。
    }
  }
  return { removed, scanned };
}

let defaultQueue: AgentRunQueue | undefined;
let defaultWorkItemContextDbClient: WorkHubDatabaseClient | undefined;
let defaultWorkItemContextProvider: AgentRunWorkItemContextProvider | undefined;

function getDefaultWorkItemContextProvider() {
  if (!defaultWorkItemContextProvider) {
    defaultWorkItemContextDbClient = getSharedDatabaseClient();
    defaultWorkItemContextProvider = createDbWorkItemContextProvider(
      createWorkItemRepository(defaultWorkItemContextDbClient.db)
    );
  }
  return defaultWorkItemContextProvider;
}

export function getDefaultAgentRunQueue() {
  defaultQueue ??= createInMemoryAgentRunQueue({
    confidence: createAgentRunConfidenceRecorder(),
    humanReserved: createHumanReservedGuard(),
    policyStore: getDefaultBudgetPolicyStore(),
    ledgerStore: getDefaultCostLedgerStore(),
    proposals: getDefaultProposalService(),
    persistence: getDefaultAgentRunPersistence(),
    // P-COLLAB M2：生产环境也接入快照仓库，否则 hydrate 后的 project/ base 快照分支永不触发，
    // manifest.base.snapshot_id 永远为空、三方合并退回 accepted-history 祖先（背离 M2 设计）。
    snapshots: getDefaultAuditStores().snapshots,
    workItemContext: getDefaultWorkItemContextProvider(),
    userMemory: getDefaultUserMemoryContextProvider(),
    teamSkills: getDefaultTeamSkillContextProvider(),
    // 默认关闭：AGENT_RUN_PROJECT_HYDRATE_ENABLED=true 才让 AI 取材整个项目（fail-open + 预算上限）。
    hydrateProject: runtimeSettings.agentRun.projectHydrateEnabled ? getDefaultProjectHydrator() : false,
    leaseMs: runtimeSettings.agentRun.leaseMs,
    ...(runtimeSettings.agentRun.heartbeatIntervalMs
      ? { heartbeatIntervalMs: runtimeSettings.agentRun.heartbeatIntervalMs }
      : {}),
    maxRecoverAttempts: runtimeSettings.agentRun.maxRecoverAttempts,
    // 默认 run_command fail-closed；仅当显式 opt-in 才接入无约束 nodeCommandRunner（受信本地/单机）。
    // 生产/多租户应保持 false 并改注入真正隔离的 runner。
    ...(runtimeSettings.agentRun.allowUnsandboxedCommands ? { commandRunner: nodeCommandRunner } : {}),
    notificationWorkItem: createAgentRunNotificationWorkItemResolver()
  });
  // 启动时回收上次进程崩溃/重启遗留的过期 workdir（fire-and-forget，失败不影响队列就绪）。
  void sweepStaleAgentWorkdirs().catch((error) => {
    console.warn("WorkHub stale agent workdir sweep failed", error);
  });
  return defaultQueue;
}
