import { settings as runtimeSettings, type Settings } from "@workhub/config";
import {
  aiQuietHoursSchema,
  conversationActionCardUpdatedEventSchema,
  eventTypes,
  DEFAULT_USER_AI_PROFILE,
  type AiQuietHours,
  type DispatchPolicy,
  type WorkItemMode,
  type WorkItemStatus
} from "@workhub/contracts";
import {
  buildObserverSystemPrompt,
  buildObserverUserPrompt,
  deriveActionCardItemId,
  isLowQualityObserverPlan,
  parseObserverPlanResponse,
  type ObserverPlanItem,
  type ObserverPromptMessage
} from "@workhub/agent/observer";
import {
  decideRunBudget,
  type BudgetPolicyStore,
  type CostLedgerStore
} from "@workhub/cost";
import { makeWorkHubEvent, topics } from "@workhub/events";
import {
  createActionCardRepository,
  createAiDecisionRepository,
  createAiSettingsRepository,
  createNotificationRepository,
  createWorkItemRepository,
  getSharedDatabaseClient,
  type ActionCardConversationMessageRow,
  type ActionCardItemKind,
  type ActionCardItemStatus,
  type AiDecisionRepository,
  type AiSettingsRepository,
  type NotificationRepository,
  type ObserverCandidateRow,
  type PlanItemInput,
  type WorkItemDataRepository
} from "@workhub/db";

import { getDefaultPushBus, type PushBus } from "../broker/index.js";
import { getDefaultStructuredLogger, type StructuredLogger } from "../logging.js";
import { InternalContractError, parseOutputContract } from "../pages/output-contract.js";
import { getDefaultBudgetPolicyStore } from "../services/cost-policy-store.js";
import { getDefaultCostLedgerStore } from "../services/cost-ledger-store.js";
import { getDefaultProviderRegistry } from "../services/provider-registry.js";
import { getDefaultAgentRunQueue, type AgentRunQueue } from "./agent-runner.js";

// R12 批3：静默观察者 worker——claim-lease 骨架仿 apps/api/src/workers/agent-run-recovery.ts /
// session-sweep.ts 的 tick scheduler 形态（running 守卫 + 独立可测 tick()，定时器 unref 不挡进程退出）。
// 60s 静默判定与安静时段全部在服务端算，桌面端不做本地定时——保证多端一致（03 §2B）。

const OBSERVER_ACTOR_ID = "conversation-observer";
const OBSERVER_ACTOR_LABEL = "Cuu";
const DEFAULT_INTERVAL_MS = 15_000;
const DEFAULT_MAX_CANDIDATES_PER_TICK = 10;
// 真 key 冒烟(qa/r12-real-key-smoke.ts)逮到的跨层漂移:仓库层 listMessagesForAnalysis 的
// assertLimit 上限是 100,这里原来写 200——mock 单测不校验所以全绿,真库一跑就 failed:1。
// 对齐到仓库上限;跨层一致性由 conversation-observer.test.ts 的对齐断言锁死,防再漂。
export const DEFAULT_MAX_MESSAGES_PER_ANALYSIS = 100;
const DEFAULT_MAX_ANALYSIS_TOKENS = 2000;
// 00-interaction-design.md §2.3：执行类条目「10 分钟内可撤销」。
const UNDO_WINDOW_MS = 10 * 60 * 1000;

export type ConversationObserverTickResult = {
  scanned: number;
  analyzed: number;
  cards_created: number;
  cards_appended: number;
  skipped_quiet_hours: number;
  skipped_low_quality: number;
  skipped_budget: number;
  // R13 H1：createOrAppendCard 撞了 items 表唯一约束、被当幂等重复吞掉的次数——跟
  // skipped_low_quality 分开计，不然会把"这批已经落过库"误读成"AI 判断没活儿"（见
  // isUniqueViolation 分支）。
  skipped_duplicate_write: number;
  failed: number;
  started_at: string;
  finished_at: string;
};

export type ConversationObserverScheduler = {
  tick: () => Promise<ConversationObserverTickResult>;
  start: () => void;
  stop: () => void;
  stats: () => {
    running: boolean;
    tick_count: number;
    analyzed_count: number;
    cards_created_count: number;
    cards_appended_count: number;
    failed_count: number;
    error_count: number;
    last_tick_at?: string;
    last_error_message?: string;
  };
};

// 观察者自身分析调用用的最小 LLM 客户端形状——不是完整 AgentLoopClient（观察者无工具、无多轮）。
export type ObserverLlmContent = { type: string; text?: string };
export type ObserverLlmResponse = { content: ObserverLlmContent[] };
export type ObserverLlmClient = {
  messages: {
    create: (input: {
      maxTokens: number;
      source: "agent_step";
      system: string;
      messages: Array<{ role: "user"; content: string }>;
    }) => Promise<ObserverLlmResponse>;
  };
};
export type ObserverClientProvider = (input: {
  actorId: string;
  workspaceId: string;
}) => ObserverLlmClient | Promise<ObserverLlmClient>;

export type ConversationObserverDeps = {
  actionCards: Pick<
    ReturnType<typeof createActionCardRepository>,
    | "listObserverCandidates"
    | "listMessagesForAnalysis"
    | "listNicknamesByUserIds"
    | "resolveAssigneeByNickname"
    | "createOrAppendCard"
    | "advanceWatermark"
    | "recordAnalysisFailure"
    | "postSystemMessage"
  >;
  workItems: Pick<WorkItemDataRepository, "createWorkItem" | "findProjectById">;
  agentRuns: Pick<AgentRunQueue, "enqueue">;
  notifications: Pick<NotificationRepository, "createOrUpdateNotification">;
  decisions: Pick<AiDecisionRepository, "createEscalationEvent">;
  aiSettings: Pick<AiSettingsRepository, "findUserProfileAccessRecord">;
  client: ObserverClientProvider;
  policyStore: Pick<BudgetPolicyStore, "listPolicies">;
  ledgerStore: Pick<CostLedgerStore, "usageSnapshots">;
  settings?: Settings;
  bus?: Pick<PushBus, "publish">;
  logger?: Pick<StructuredLogger, "warn" | "error">;
  now?: () => Date;
  id?: () => string;
  intervalMs?: number;
  maxCandidatesPerTick?: number;
  maxMessagesPerAnalysis?: number;
  onError?: (error: unknown) => void;
};

// ── 安静时段：纯函数,不碰 DB/网络,worker 用捕获的候选行本地过滤 ──────────────────────────

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function isWithinQuietHours(quietHours: AiQuietHours, now: Date): boolean {
  if (!quietHours.enabled) {
    return false;
  }
  let weekdayName: string;
  let hour: number;
  let minute: number;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: quietHours.timezone,
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
      hour12: false
    }).formatToParts(now);
    weekdayName = parts.find((part) => part.type === "weekday")?.value ?? "";
    // hour12:false 在部分 runtime 对午夜返回 "24"，按 0 归一。
    const hourText = parts.find((part) => part.type === "hour")?.value ?? "0";
    hour = Number.parseInt(hourText, 10) % 24;
    minute = Number.parseInt(parts.find((part) => part.type === "minute")?.value ?? "0", 10);
  } catch {
    // 时区解析失败：fail-open（不拦分析），并在调用方日志里可见——宁可多分析一次，不静默吞掉整条项目的观察者。
    return false;
  }
  const weekday = WEEKDAY_INDEX[weekdayName];
  if (weekday === undefined || !quietHours.weekdays.includes(weekday)) {
    return false;
  }
  const minutesSinceMidnight = hour * 60 + minute;
  const { start_minute: start, end_minute: end } = quietHours;
  if (start < end) {
    return minutesSinceMidnight >= start && minutesSinceMidnight < end;
  }
  // 跨零点（如 22:00–06:00）。
  return minutesSinceMidnight >= start || minutesSinceMidnight < end;
}

function parseQuietHours(raw: Record<string, unknown>): AiQuietHours {
  const parsed = aiQuietHoursSchema.safeParse(raw);
  // 治理数据损坏时 fail-open：不拦分析（宁可多跑一次，也不让脏数据静默饿死整个项目的观察者）。
  return parsed.success ? parsed.data : { enabled: false };
}

// ── 消息 → prompt 展示行 ──────────────────────────────────────────────────────────

function messageDisplayText(row: ActionCardConversationMessageRow): string | null {
  const content = row.contentJson as Record<string, unknown>;
  switch (row.kind) {
    case "text":
      return typeof content["text"] === "string" ? content["text"] : null;
    case "file_card":
      return typeof content["snapshot_name"] === "string" ? `分享了文件：${content["snapshot_name"]}` : "分享了一个文件";
    case "tool_note":
      return "（一次工具调用）";
    case "system_event":
      return typeof content["summary"] === "string" ? content["summary"] : "（系统事件）";
    case "action_card":
      // 不把 Cuu 自己产出的行动卡回灌进下一次分析。
      return null;
    default:
      return null;
  }
}

function buildPromptMessages(
  rows: ActionCardConversationMessageRow[],
  nicknames: Map<string, string>
): ObserverPromptMessage[] {
  const result: ObserverPromptMessage[] = [];
  for (const row of rows) {
    const text = messageDisplayText(row);
    if (!text) {
      continue;
    }
    const senderKind = row.senderType as ObserverPromptMessage["senderKind"];
    const senderLabel = row.senderUserId
      ? nicknames.get(row.senderUserId) ?? "未知成员"
      : senderKind === "cuu"
        ? OBSERVER_ACTOR_LABEL
        : "系统";
    result.push({ seq: row.seq, senderKind, senderLabel, text, createdAt: row.createdAt.toISOString() });
  }
  return result;
}

function extractText(content: ObserverLlmContent[]): string {
  return content
    .filter((block): block is { type: string; text: string } => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

// ── 每条目派发结果 ─────────────────────────────────────────────────────────────────

type DispatchOutcome = {
  item: PlanItemInput;
  systemNote?: { content: Record<string, unknown> };
};

async function resolveAssignee(
  deps: ConversationObserverDeps,
  candidate: ObserverCandidateRow,
  planItem: ObserverPlanItem
): Promise<{ userId: string; nickname: string } | null> {
  if (planItem.suggested_assignee_nickname) {
    const matched = await deps.actionCards.resolveAssigneeByNickname({
      workspaceId: candidate.workspaceId,
      nickname: planItem.suggested_assignee_nickname
    });
    if (matched) {
      return matched;
    }
  }
  const project = await deps.workItems.findProjectById(candidate.projectId);
  if (!project?.ownerUserId) {
    return null;
  }
  return { userId: project.ownerUserId, nickname: project.ownerNickname };
}

async function dispatchExecuteItem(
  deps: ConversationObserverDeps,
  candidate: ObserverCandidateRow,
  planItem: ObserverPlanItem,
  itemId: string,
  at: Date
): Promise<DispatchOutcome> {
  const assignee = await resolveAssignee(deps, candidate, planItem);
  if (!assignee) {
    return {
      item: {
        id: itemId,
        kind: "execute",
        titleMd: planItem.title_md,
        confidence: planItem.confidence,
        status: "escalated"
      }
    };
  }
  const profileAccess = await deps.aiSettings.findUserProfileAccessRecord({
    workspaceId: candidate.workspaceId,
    userId: assignee.userId
  });
  const dispatchPolicy: DispatchPolicy = profileAccess?.profile?.dispatchPolicy ?? DEFAULT_USER_AI_PROFILE.dispatch_policy;

  try {
    const workItem = await deps.workItems.createWorkItem({
      projectId: candidate.projectId,
      workspaceId: candidate.workspaceId,
      submitterUserId: assignee.userId,
      title: planItem.title_md,
      rawDescription: planItem.title_md,
      summaryMd: planItem.title_md,
      status: (dispatchPolicy === "auto" ? "ai_working" : "spec_ready") satisfies WorkItemStatus,
      mode: "worker" satisfies WorkItemMode,
      at
    });

    if (dispatchPolicy === "auto") {
      const run = await deps.agentRuns.enqueue({
        workItemId: workItem.id,
        actorId: assignee.userId,
        workspaceId: candidate.workspaceId,
        title: planItem.title_md,
        // R12 批5 军团面板靠这条血缘把 run 挂回会话右栏;执行地默认 server(本地执行器=批9)。
        sourceConversationId: candidate.conversationId,
        sourceActionCardItemId: itemId,
        executionHint: "server"
      });
      return {
        item: {
          id: itemId,
          kind: "execute",
          titleMd: planItem.title_md,
          confidence: planItem.confidence,
          assigneeUserId: assignee.userId,
          workItemId: workItem.id,
          runId: run.run_id,
          status: "running",
          undoDeadlineAt: new Date(at.getTime() + UNDO_WINDOW_MS)
        }
      };
    }

    if (dispatchPolicy === "ask") {
      await deps.notifications.createOrUpdateNotification(
        {
          userId: assignee.userId,
          type: "action_card_item.dispatch_ask",
          severity: "normal",
          title: "有个活想派给你",
          body: planItem.title_md,
          targetUrl: `/workitems/${workItem.id}`,
          projectId: candidate.projectId,
          workItemId: workItem.id,
          dedupeKey: `action-card-item:${itemId}:dispatch-ask`
        },
        at
      );
    }

    return {
      item: {
        id: itemId,
        kind: "execute",
        titleMd: planItem.title_md,
        confidence: planItem.confidence,
        assigneeUserId: assignee.userId,
        workItemId: workItem.id,
        status: "running"
      }
    };
  } catch (error) {
    deps.logger?.warn?.("conversation_observer_execute_dispatch_failed", {
      conversationId: candidate.conversationId,
      error
    });
    return {
      item: {
        id: itemId,
        kind: "execute",
        titleMd: planItem.title_md,
        confidence: planItem.confidence,
        assigneeUserId: assignee.userId,
        status: "escalated"
      }
    };
  }
}

async function dispatchDecideItem(
  deps: ConversationObserverDeps,
  candidate: ObserverCandidateRow,
  planItem: ObserverPlanItem,
  itemId: string,
  at: Date
): Promise<DispatchOutcome> {
  const assignee = await resolveAssignee(deps, candidate, planItem);
  if (!assignee) {
    return {
      item: {
        id: itemId,
        kind: "decide",
        titleMd: planItem.title_md,
        confidence: planItem.confidence,
        status: "escalated"
      }
    };
  }
  try {
    const workItem = await deps.workItems.createWorkItem({
      projectId: candidate.projectId,
      workspaceId: candidate.workspaceId,
      submitterUserId: assignee.userId,
      title: planItem.title_md,
      rawDescription: planItem.title_md,
      summaryMd: planItem.title_md,
      status: "escalated" satisfies WorkItemStatus,
      mode: "pm" satisfies WorkItemMode,
      at
    });
    await deps.decisions.createEscalationEvent({
      workItemId: workItem.id,
      trigger: "unqualified",
      reasonMd: planItem.title_md,
      suggestedLeadUserId: assignee.userId,
      handoffJson: {
        source: "conversation_observer",
        conversation_id: candidate.conversationId,
        action_card_item_id: itemId
      }
    });
    return {
      item: {
        id: itemId,
        kind: "decide",
        titleMd: planItem.title_md,
        confidence: planItem.confidence,
        assigneeUserId: assignee.userId,
        workItemId: workItem.id,
        status: "waiting_decision"
      },
      systemNote: {
        content: {
          event: "decide_item_created",
          action_card_item_id: itemId,
          assignee_user_id: assignee.userId,
          summary: `@${assignee.nickname} 这件事我拿不准，你来定：${planItem.title_md}`
        }
      }
    };
  } catch (error) {
    deps.logger?.warn?.("conversation_observer_decide_dispatch_failed", {
      conversationId: candidate.conversationId,
      error
    });
    return {
      item: {
        id: itemId,
        kind: "decide",
        titleMd: planItem.title_md,
        confidence: planItem.confidence,
        assigneeUserId: assignee.userId,
        status: "escalated"
      }
    };
  }
}

function observeItem(planItem: ObserverPlanItem, itemId: string): DispatchOutcome {
  return {
    item: {
      id: itemId,
      kind: "observe" as ActionCardItemKind,
      titleMd: planItem.title_md,
      confidence: planItem.confidence,
      status: "done" as ActionCardItemStatus
    }
  };
}

// ── 预算软闸 ────────────────────────────────────────────────────────────────────────
//
// 已知缺口（写进批3汇报，供集成者裁决）：budget_reservations.run_id 是 NOT NULL 外键指向
// agent_runs（且 agent_runs.work_item_id 也 NOT NULL）。观察者自身的分析调用发生在任何
// work_item 存在之前，没有可挂靠的 run_id——接入原子 reservation 需要为每次分析伪造一个
// work_item+agent_run，这正是铁律第3条禁止的假接线。这里改为「软闸」：分析前用 decideRunBudget
// 读团队维度的已用量快照做门槛判断（不足即跳过，不建卡也不推水位线，下个 tick 重试），
// 分析调用本身仍通过 ProviderRegistry 的 usageSink 计入 cost_ledger_entries（真实成本记账，
// 只是不参与并发原子预留的互斥）。

async function checkObserverBudget(
  deps: ConversationObserverDeps,
  workspaceId: string,
  now: Date
): Promise<boolean> {
  const settings = deps.settings ?? runtimeSettings;
  const usage = await deps.ledgerStore.usageSnapshots({ teamId: workspaceId }, { now });
  const decision = decideRunBudget({
    settings,
    scopeIds: { teamId: workspaceId },
    policies: await deps.policyStore.listPolicies(settings),
    usage,
    now
  });
  return decision.allowed;
}

// ── SSE 生产者 ──────────────────────────────────────────────────────────────────────

async function emitActionCardUpdated(
  deps: ConversationObserverDeps,
  input: {
    conversationId: string;
    projectId: string;
    cardId: string;
    messageId: string;
    status: "active" | "superseded";
    appended: boolean;
    items: Array<{ id: string; kind: string; confidence: string; status: string }>;
    previewText: string;
    at: Date;
  }
) {
  const bus = deps.bus ?? getDefaultPushBus();
  const topic = topics.conversation(input.conversationId).topic;
  let event;
  try {
    event = parseOutputContract(
      conversationActionCardUpdatedEventSchema,
      makeWorkHubEvent({
        type: eventTypes.conversationActionCardUpdated,
        topic,
        ts: input.at,
        actor: { actor_kind: "ai", label: OBSERVER_ACTOR_LABEL },
        project_id: input.projectId,
        preview_text: input.previewText,
        data: {
          conversation_id: input.conversationId,
          action_card_id: input.cardId,
          message_id: input.messageId,
          status: input.status,
          appended: input.appended,
          items: input.items
        }
      }),
      "conversation-observer.action-card.event"
    );
  } catch (error) {
    if (error instanceof InternalContractError) {
      deps.logger?.warn?.("conversation_observer_event_contract_violation", { conversationId: input.conversationId, error });
      return;
    }
    throw error;
  }
  try {
    await bus.publish(topic, eventTypes.conversationActionCardUpdated, event);
  } catch (error) {
    deps.logger?.warn?.("conversation_observer_event_publish_failed", { conversationId: input.conversationId, error });
  }
}

// ── 单会话分析 ──────────────────────────────────────────────────────────────────────

type AnalyzeOutcome = "card_created" | "card_appended" | "no_card" | "budget_blocked" | "duplicate_write";

// 裸 PG 唯一冲突（23505）——同一判定手法照 packages/db/src/repositories/drive.ts /
// proposals.ts、apps/api/src/routes/auth.ts 的既有 isUniqueViolation：`pg` 驱动的
// DatabaseError 直接把 SQLSTATE 挂在 `.code` 上，drizzle-orm/node-postgres 不做二次包装。
function isUniqueViolation(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { code?: string }).code === "23505";
}

async function analyzeConversation(
  deps: ConversationObserverDeps,
  candidate: ObserverCandidateRow,
  now: Date
): Promise<AnalyzeOutcome> {
  const budgetOk = await checkObserverBudget(deps, candidate.workspaceId, now);
  if (!budgetOk) {
    return "budget_blocked";
  }

  const maxMessages = deps.maxMessagesPerAnalysis ?? DEFAULT_MAX_MESSAGES_PER_ANALYSIS;
  const messages = await deps.actionCards.listMessagesForAnalysis({
    workspaceId: candidate.workspaceId,
    projectId: candidate.projectId,
    conversationId: candidate.conversationId,
    afterSeq: candidate.lastAnalyzedSeq,
    limit: maxMessages
  });
  if (messages.length === 0) {
    await deps.actionCards.advanceWatermark({ conversationId: candidate.conversationId, analyzedToSeq: candidate.nextSeq, at: now });
    return "no_card";
  }
  const analyzedToSeq = messages[messages.length - 1]!.seq;

  const senderIds = [...new Set(messages.map((row) => row.senderUserId).filter((id): id is string => Boolean(id)))];
  const nicknames = await deps.actionCards.listNicknamesByUserIds(senderIds);
  const promptMessages = buildPromptMessages(messages, nicknames);

  const client = await deps.client({ actorId: OBSERVER_ACTOR_ID, workspaceId: candidate.workspaceId });
  const response = await client.messages.create({
    maxTokens: DEFAULT_MAX_ANALYSIS_TOKENS,
    source: "agent_step",
    system: buildObserverSystemPrompt(),
    messages: [
      {
        role: "user",
        content: buildObserverUserPrompt({ projectName: candidate.projectId, messages: promptMessages })
      }
    ]
  });
  const plan = parseObserverPlanResponse(extractText(response.content));

  if (isLowQualityObserverPlan(plan)) {
    await deps.actionCards.advanceWatermark({ conversationId: candidate.conversationId, analyzedToSeq, at: now });
    return "no_card";
  }

  // R13 H1（自审 backlog 项2）：条目 id 由 (conversationId, analyzedToSeq, ordinal) 确定性派生
  // （见 deriveActionCardItemId 顶部注释）——ordinal 就是这批计划条目在 plan.items 里的下标，跟
  // createOrAppendCard 落库时给它们分配的 ordinal（见 packages/db 的 itemInsertValues）一致。
  const outcomes: DispatchOutcome[] = [];
  for (const [ordinal, planItem] of plan.items.entries()) {
    const itemId = deriveActionCardItemId(candidate.conversationId, analyzedToSeq, ordinal);
    if (planItem.kind === "execute") {
      outcomes.push(await dispatchExecuteItem(deps, candidate, planItem, itemId, now));
    } else if (planItem.kind === "decide") {
      outcomes.push(await dispatchDecideItem(deps, candidate, planItem, itemId, now));
    } else {
      outcomes.push(observeItem(planItem, itemId));
    }
  }

  let result: Awaited<ReturnType<typeof deps.actionCards.createOrAppendCard>>;
  try {
    result = await deps.actionCards.createOrAppendCard({
      workspaceId: candidate.workspaceId,
      projectId: candidate.projectId,
      conversationId: candidate.conversationId,
      analyzedToSeq,
      items: outcomes.map((outcome) => outcome.item),
      at: now
    });
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    // 上面的 dispatch*Item 已经跑完——可能已经建了真实 work_item/agent_run/通知，那些不在
    // createOrAppendCard 的事务里，回不了滚（见文件顶部注释里这条 backlog 的病根）。走到这里说明
    // items 表撞了唯一约束：这批 (conversationId, analyzedToSeq) 的条目此前已经落过库，这次重扫
    // 是水位线没推成功导致的重复分析，不是新错误。幂等吞掉——只推水位线挡住下一 tick 再扫同一批，
    // 不当成分析失败计数（也不会再重复派发，因为这个 tick 到此为止不会再进 for 循环）。
    deps.logger?.warn?.("conversation_observer_card_write_conflict_treated_as_idempotent", {
      conversationId: candidate.conversationId,
      analyzedToSeq,
      error
    });
    await deps.actionCards.advanceWatermark({ conversationId: candidate.conversationId, analyzedToSeq, at: now });
    return "duplicate_write";
  }

  for (const outcome of outcomes) {
    if (outcome.systemNote) {
      await deps.actionCards.postSystemMessage({
        workspaceId: candidate.workspaceId,
        conversationId: candidate.conversationId,
        senderType: "cuu",
        content: outcome.systemNote.content,
        threadRootId: result.message.id,
        at: now
      });
    }
  }

  await emitActionCardUpdated(deps, {
    conversationId: candidate.conversationId,
    projectId: candidate.projectId,
    cardId: result.card.id,
    messageId: result.message.id,
    status: result.card.status as "active" | "superseded",
    appended: result.appended,
    items: result.items.map((item) => ({ id: item.id, kind: item.kind, confidence: item.confidence, status: item.status })),
    previewText: `Cuu 从刚才的讨论里拎出 ${result.items.length} 件事`,
    at: now
  });

  return result.appended ? "card_appended" : "card_created";
}

// ── tick scheduler ──────────────────────────────────────────────────────────────────

export function createConversationObserverScheduler(deps: ConversationObserverDeps): ConversationObserverScheduler {
  const now = deps.now ?? (() => new Date());
  const logger = deps.logger ?? getDefaultStructuredLogger();
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  const maxCandidatesPerTick = deps.maxCandidatesPerTick ?? DEFAULT_MAX_CANDIDATES_PER_TICK;
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  let tickCount = 0;
  let analyzedCount = 0;
  let cardsCreatedCount = 0;
  let cardsAppendedCount = 0;
  let failedCount = 0;
  let errorCount = 0;
  let lastTickAt: string | undefined;
  let lastErrorMessage: string | undefined;

  async function tick(): Promise<ConversationObserverTickResult> {
    const startedAt = now();
    if (running) {
      return zeroResult(startedAt);
    }
    running = true;
    let scanned = 0;
    let analyzed = 0;
    let cardsCreated = 0;
    let cardsAppended = 0;
    let skippedQuietHours = 0;
    let skippedLowQuality = 0;
    let skippedBudget = 0;
    let skippedDuplicateWrite = 0;
    let failed = 0;
    try {
      const candidates = await deps.actionCards.listObserverCandidates({ now: startedAt, limit: maxCandidatesPerTick });
      scanned = candidates.length;
      for (const candidate of candidates) {
        if (isWithinQuietHours(parseQuietHours(candidate.quietHoursJson), startedAt)) {
          skippedQuietHours += 1;
          continue;
        }
        try {
          const outcome = await analyzeConversation(deps, candidate, now());
          analyzed += 1;
          if (outcome === "card_created") {
            cardsCreated += 1;
          } else if (outcome === "card_appended") {
            cardsAppended += 1;
          } else if (outcome === "no_card") {
            skippedLowQuality += 1;
          } else if (outcome === "duplicate_write") {
            skippedDuplicateWrite += 1;
          } else {
            skippedBudget += 1;
          }
        } catch (error) {
          failed += 1;
          // 失败静默：不往群里发任何东西，只计数（connective_failures 供治理健康提示用，本批不建 UI）。
          await deps.actionCards
            .recordAnalysisFailure({ conversationId: candidate.conversationId, at: now() })
            .catch((recordError) => {
              logger.warn?.("conversation_observer_failure_record_failed", {
                conversationId: candidate.conversationId,
                error: recordError
              });
            });
          logger.warn?.("conversation_observer_analysis_failed", { conversationId: candidate.conversationId, error });
        }
      }
      const finishedAt = now();
      tickCount += 1;
      analyzedCount += analyzed;
      cardsCreatedCount += cardsCreated;
      cardsAppendedCount += cardsAppended;
      failedCount += failed;
      lastTickAt = finishedAt.toISOString();
      return {
        scanned,
        analyzed,
        cards_created: cardsCreated,
        cards_appended: cardsAppended,
        skipped_quiet_hours: skippedQuietHours,
        skipped_low_quality: skippedLowQuality,
        skipped_budget: skippedBudget,
        skipped_duplicate_write: skippedDuplicateWrite,
        failed,
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString()
      };
    } catch (error) {
      errorCount += 1;
      lastErrorMessage = error instanceof Error ? error.message : String(error);
      deps.onError?.(error);
      throw error;
    } finally {
      running = false;
    }
  }

  function zeroResult(startedAt: Date): ConversationObserverTickResult {
    return {
      scanned: 0,
      analyzed: 0,
      cards_created: 0,
      cards_appended: 0,
      skipped_quiet_hours: 0,
      skipped_low_quality: 0,
      skipped_budget: 0,
      skipped_duplicate_write: 0,
      failed: 0,
      started_at: startedAt.toISOString(),
      finished_at: startedAt.toISOString()
    };
  }

  function start() {
    if (timer || intervalMs <= 0) {
      return;
    }
    timer = setInterval(() => {
      void tick().catch((error) => {
        logger.error?.("conversation_observer_tick_failed", { error });
      });
    }, intervalMs);
    timer.unref?.();
  }

  function stop() {
    if (!timer) {
      return;
    }
    clearInterval(timer);
    timer = undefined;
  }

  return {
    tick,
    start,
    stop,
    stats: () => ({
      running,
      tick_count: tickCount,
      analyzed_count: analyzedCount,
      cards_created_count: cardsCreatedCount,
      cards_appended_count: cardsAppendedCount,
      failed_count: failedCount,
      error_count: errorCount,
      ...(lastTickAt ? { last_tick_at: lastTickAt } : {}),
      ...(lastErrorMessage ? { last_error_message: lastErrorMessage } : {})
    })
  };
}

let defaultScheduler: ConversationObserverScheduler | undefined;

function defaultClientProvider(): ObserverClientProvider {
  return ({ actorId, workspaceId }) =>
    getDefaultProviderRegistry().get({ id: actorId, workspaceId }, "assistant") as unknown as ObserverLlmClient;
}

export function getDefaultConversationObserverScheduler(): ConversationObserverScheduler {
  if (defaultScheduler) {
    return defaultScheduler;
  }
  const db = getSharedDatabaseClient().db;
  defaultScheduler = createConversationObserverScheduler({
    actionCards: createActionCardRepository(db),
    workItems: createWorkItemRepository(db),
    agentRuns: getDefaultAgentRunQueue(),
    notifications: createNotificationRepository(db),
    decisions: createAiDecisionRepository(db),
    aiSettings: createAiSettingsRepository(db),
    client: defaultClientProvider(),
    policyStore: getDefaultBudgetPolicyStore(),
    ledgerStore: getDefaultCostLedgerStore(),
    intervalMs: runtimeSettings.agentRun.recoveryIntervalMs
  });
  return defaultScheduler;
}
