import assert from "node:assert/strict";
import test from "node:test";

import type {
  ActionCardConversationMessageRow,
  ActionCardItemRow,
  ActionCardRow,
  CandidateForProjectRow,
  EscalationEventRow,
  NotificationRow,
  ObserverCandidateRow,
  ObserverStateRow,
  UserAiProfileRow,
  WorkItemProjectRow,
  WorkItemRow
} from "@workhub/db";
import type { BudgetPolicy } from "@workhub/cost";

import {
  buildDispatchAskTargetUrl,
  createConversationObserverScheduler,
  DEFAULT_MAX_MESSAGES_PER_ANALYSIS,
  isObserverSilenceElapsed,
  isWithinQuietHours,
  observerSilenceWindowMs,
  type ConversationObserverDeps
} from "./workers/conversation-observer.js";
import { ACTION_CARD_ANALYSIS_LIMIT_MAX, OBSERVER_SILENCE_SCAN_FLOOR_FACTOR } from "@workhub/db";
import { resolveProactivityPolicy } from "./services/proactivity-policy.js";
import type { AgentRunQueueRecord } from "./workers/agent-runner.js";

const now = new Date("2026-07-12T09:00:00.000Z");
const workspaceId = "13000000-0000-4000-8000-000000000001";
const projectId = "13000000-0000-4000-8000-000000000003";
const conversationId = "13000000-0000-4000-8000-000000000004";
const messageId = "13000000-0000-4000-8000-000000000006";
const ownerUserId = "13000000-0000-4000-8000-000000000009";
const assigneeUserId = "13000000-0000-4000-8000-000000000010";

function candidate(overrides: Partial<ObserverCandidateRow> = {}): ObserverCandidateRow {
  return {
    conversationId,
    projectId,
    workspaceId,
    nextSeq: 6,
    lastAnalyzedSeq: 3,
    activeCardId: null,
    consecutiveFailures: 0,
    silenceWindowSecs: 60,
    // R23 P3b（SA-07）：默认档=均衡，等同接线前的行为（窗口系数 ×1）。
    ownerProactivity: "balanced",
    quietHoursJson: { enabled: false },
    lastMessageAt: new Date("2026-07-12T08:58:00.000Z"),
    ...overrides
  };
}

function message(seq: number, overrides: Partial<ActionCardConversationMessageRow> = {}): ActionCardConversationMessageRow {
  return {
    id: `20000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    conversationId,
    seq,
    senderType: "user",
    senderUserId: assigneeUserId,
    kind: "text",
    contentJson: { text: `讨论 ${seq}` },
    threadRootId: null,
    // R14 批 CHAT：conversation_messages 新增六列（全部 nullable）——观察者分析窗读整表，fixture 补齐默认。
    editedAt: null,
    deletedAt: null,
    deletedByUserId: null,
    replyToMessageId: null,
    pinnedAt: null,
    pinnedByUserId: null,
    createdAt: now,
    ...overrides
  };
}

function projectRow(overrides: Partial<WorkItemProjectRow> = {}): WorkItemProjectRow {
  return {
    id: projectId,
    workspaceId,
    name: "星尘计划",
    slug: "star-dust",
    description: null,
    ownerNickname: "阿曼",
    ownerUserId,
    archived: false,
    deletedAt: null,
    deletedByNickname: null,
    nextSeq: 1,
    // R13 批 S3：projects 加了 is_personal 列——机械补齐，不是本文件测的功能改动。
    isPersonal: false,
    // R15 批 B：projects 加了 is_dm_container 列——机械补齐（普通项目固定 false）。
    isDmContainer: false,
    // R16 批 W4a：projects 加了 instructions_md 列——机械补齐（这份 fixture 不关心它，默认空）。
    instructionsMd: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function workItemRow(overrides: Partial<WorkItemRow> = {}): WorkItemRow {
  return {
    id: "30000000-0000-4000-8000-000000000001",
    code: "STAR-1",
    projectId,
    workspaceId,
    submitterUserId: assigneeUserId,
    claimedByUserId: null,
    claimedByNickname: null,
    title: "重写第三节",
    rawDescription: "重写第三节",
    summaryMd: "重写第三节",
    status: "ai_working",
    priority: "normal",
    estimateHours: null,
    estimateConfidence: null,
    planningNote: null,
    startAt: null,
    dueAt: null,
    sourceMeetingId: null,
    sourceWorkItemId: null,
    milestoneId: null,
    claimedAt: null,
    doneAt: null,
    deliveredAt: null,
    deliveryDocReadyAt: null,
    acceptedAt: null,
    syncState: "pending",
    version: 0,
    mode: "worker",
    humanReserved: false,
    currentSpecId: null,
    mainBranchId: null,
    latestConfidenceId: null,
    deletedAt: null,
    deletedByUserId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function agentRunRow(overrides: Partial<AgentRunQueueRecord> = {}): AgentRunQueueRecord {
  return {
    run_id: "40000000-0000-4000-8000-000000000001",
    work_item_id: workItemRow().id,
    actor_id: assigneeUserId,
    mode: "worker",
    status: "queued",
    title: "重写第三节",
    budget: { max_steps: 10, total_timeout_s: 300, max_tokens: 120000, max_cost_cny: "5" },
    budget_decision: { decision_id: "d1", allowed: true, model_route: { provider: "anthropic", model: "m", reason: "default" } },
    usage: { steps_used: 0, token_in: 0, token_out: 0, estimated_cost_cny: "0" },
    trace: [],
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    ...overrides
  };
}

function notificationRow(overrides: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: "50000000-0000-4000-8000-000000000001",
    userId: assigneeUserId,
    type: "action_card_item.dispatch_ask",
    severity: "normal",
    title: "有个活想派给你",
    body: "重写第三节",
    targetUrl: `/workitems/${workItemRow().id}`,
    projectId,
    workItemId: workItemRow().id,
    dedupeKey: "dedupe-1",
    readAt: null,
    archivedAt: null,
    nextRemindAt: null,
    reminderCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function escalationRow(overrides: Partial<EscalationEventRow> = {}): EscalationEventRow {
  return {
    id: "60000000-0000-4000-8000-000000000001",
    workItemId: workItemRow().id,
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

// R13 批 A2（派人推荐 v2）：派活候选名单一行的测试构造器。
const rosterUserId = "13000000-0000-4000-8000-000000000020";
const rosterNickname = "李四";

function candidateForProjectRow(overrides: Partial<CandidateForProjectRow> = {}): CandidateForProjectRow {
  return {
    userId: rosterUserId,
    nickname: rosterNickname,
    title: "后端负责人",
    bioMd: "做过五个交付项目",
    skillTags: ["go", "postgres"],
    acceptedDeliverableCount: 5,
    lastAcceptedAt: now,
    ...overrides
  };
}

function actionCardRow(overrides: Partial<ActionCardRow> = {}): ActionCardRow {
  return {
    id: "70000000-0000-4000-8000-000000000001",
    conversationId,
    messageId,
    status: "active",
    origin: "observer",
    analyzedToSeq: 6,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function cardMessageRow(overrides: Partial<ActionCardConversationMessageRow> = {}): ActionCardConversationMessageRow {
  return {
    id: messageId,
    conversationId,
    seq: 7,
    senderType: "cuu",
    senderUserId: null,
    kind: "action_card",
    contentJson: {},
    threadRootId: null,
    editedAt: null,
    deletedAt: null,
    deletedByUserId: null,
    replyToMessageId: null,
    pinnedAt: null,
    pinnedByUserId: null,
    createdAt: now,
    ...overrides
  };
}

function llmClientReturning(planJson: unknown) {
  return async () => ({
    messages: {
      async create() {
        return { content: [{ type: "text", text: JSON.stringify(planJson) }] };
      }
    }
  });
}

function baseDeps(overrides: Partial<ConversationObserverDeps> = {}): ConversationObserverDeps {
  const publishCalls: unknown[] = [];
  const defaults: ConversationObserverDeps = {
    actionCards: {
      async listObserverCandidates() {
        return [];
      },
      async listMessagesForAnalysis() {
        return [message(4), message(5), message(6)];
      },
      async listNicknamesByUserIds() {
        return new Map([[assigneeUserId, "张三"]]);
      },
      async resolveAssigneeByNickname(input) {
        return input.nickname === "张三" ? { userId: assigneeUserId, nickname: "张三" } : null;
      },
      async createOrAppendCard(input) {
        const items: ActionCardItemRow[] = input.items.map((item, index) => ({
          id: item.id ?? `item-${index}`,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          conversationId: input.conversationId,
          actionCardId: actionCardRow().id,
          ordinal: index,
          kind: item.kind,
          titleMd: item.titleMd,
          confidence: item.confidence,
          workItemId: item.workItemId ?? null,
          runId: item.runId ?? null,
          assigneeUserId: item.assigneeUserId ?? null,
          status: item.status,
          undoDeadlineAt: item.undoDeadlineAt ?? null,
          createdAt: now,
          updatedAt: now
        }));
        return { card: actionCardRow(), items, appended: false, message: cardMessageRow() };
      },
      async advanceWatermark() {
        return {} as ObserverStateRow;
      },
      async recordAnalysisFailure() {
        return {} as ObserverStateRow;
      },
      async postSystemMessage() {
        return cardMessageRow({ id: "system-message-1", kind: "system_event" });
      }
    },
    workItems: {
      async createWorkItem() {
        return workItemRow();
      },
      async findProjectById() {
        return projectRow();
      }
    },
    agentRuns: {
      async enqueue() {
        return agentRunRow();
      }
    },
    notifications: {
      async createOrUpdateNotification() {
        return { notification: notificationRow(), created: true, resurfaced: false };
      }
    },
    decisions: {
      async createEscalationEvent() {
        return escalationRow();
      }
    },
    aiSettings: {
      async findUserProfileAccessRecord() {
        return null;
      }
    },
    // R13 批 A2（派人推荐 v2）：默认空候选名单——不影响任何既有测试（既有"点名/查无此人→项目负责人
    // 兜底"断言全部假设名单为空，见下方专门的候选名单测试组）。
    userProfiles: {
      async listCandidatesForProject() {
        return [];
      }
    },
    client: llmClientReturning({ items: [] }),
    policyStore: { listPolicies: () => [] },
    ledgerStore: { usageSnapshots: async () => [] },
    now: () => now,
    bus: { publish: async (...args: unknown[]) => { publishCalls.push(args); } },
    logger: { warn: () => {}, error: () => {} },
    intervalMs: 0
  };
  return { ...defaults, ...overrides };
}

// ── isWithinQuietHours ───────────────────────────────────────────────────────────────

test("isWithinQuietHours returns false when disabled", () => {
  assert.equal(isWithinQuietHours({ enabled: false }, now), false);
});

test("isWithinQuietHours matches a same-day window in the configured timezone", () => {
  // 2026-07-12T09:00:00Z is 2026-07-12 17:00 in Asia/Shanghai (UTC+8), a Sunday.
  const quietHours = {
    enabled: true as const,
    timezone: "Asia/Shanghai",
    start_minute: 16 * 60,
    end_minute: 18 * 60,
    weekdays: [0]
  };
  assert.equal(isWithinQuietHours(quietHours, now), true);
  assert.equal(isWithinQuietHours({ ...quietHours, weekdays: [1] }, now), false);
});

test("isWithinQuietHours handles an overnight window that wraps past midnight", () => {
  const quietHours = {
    enabled: true as const,
    timezone: "UTC",
    start_minute: 22 * 60,
    end_minute: 6 * 60,
    weekdays: [0, 1, 2, 3, 4, 5, 6]
  };
  assert.equal(isWithinQuietHours(quietHours, new Date("2026-07-12T23:00:00.000Z")), true);
  assert.equal(isWithinQuietHours(quietHours, new Date("2026-07-12T02:00:00.000Z")), true);
  assert.equal(isWithinQuietHours(quietHours, new Date("2026-07-12T12:00:00.000Z")), false);
});

// ── tick: scanning + gating ──────────────────────────────────────────────────────────

test("tick skips candidates in quiet hours without ever fetching their messages", async () => {
  let messagesFetched = false;
  const deps = baseDeps({
    actionCards: {
      ...baseDeps().actionCards,
      async listObserverCandidates() {
        return [
          candidate({
            quietHoursJson: {
              enabled: true,
              timezone: "UTC",
              start_minute: 0,
              end_minute: 1439,
              weekdays: [0, 1, 2, 3, 4, 5, 6]
            }
          })
        ];
      },
      async listMessagesForAnalysis() {
        messagesFetched = true;
        return [];
      }
    }
  });
  const scheduler = createConversationObserverScheduler(deps);
  const result = await scheduler.tick();
  assert.equal(result.skipped_quiet_hours, 1);
  assert.equal(result.analyzed, 0);
  assert.equal(messagesFetched, false);
});

test("tick blocks analysis on budget exhaustion without dispatching anything", async () => {
  const exhaustedPolicy: BudgetPolicy = {
    id: "team-day",
    scopeKind: "team",
    period: "day",
    maxTokens: 1,
    maxCostCny: "0.01",
    warningRatio: 0.7,
    criticalRatio: 0.9,
    onWarning: "notify",
    onExhausted: "block_new_run",
    enabled: true,
    version: 1
  };
  let dispatched = false;
  const deps = baseDeps({
    actionCards: {
      ...baseDeps().actionCards,
      async listObserverCandidates() {
        return [candidate()];
      }
    },
    workItems: {
      async createWorkItem() {
        dispatched = true;
        return workItemRow();
      },
      async findProjectById() {
        return projectRow();
      }
    },
    policyStore: { listPolicies: () => [exhaustedPolicy] },
    ledgerStore: {
      usageSnapshots: async () => [
        { scope: { kind: "team", teamId: workspaceId }, period: "day", tokenIn: 10, tokenOut: 10, estimatedCostCny: "1" }
      ]
    }
  });
  const result = await createConversationObserverScheduler(deps).tick();
  assert.equal(result.skipped_budget, 1);
  assert.equal(dispatched, false);
});

test("tick with no new messages advances the watermark without opening a card", async () => {
  let advanced: unknown;
  const deps = baseDeps({
    actionCards: {
      ...baseDeps().actionCards,
      async listObserverCandidates() {
        return [candidate()];
      },
      async listMessagesForAnalysis() {
        return [];
      },
      async advanceWatermark(input) {
        advanced = input;
        return {} as ObserverStateRow;
      }
    }
  });
  const result = await createConversationObserverScheduler(deps).tick();
  assert.equal(result.skipped_low_quality, 1);
  assert.deepEqual(advanced, { conversationId, analyzedToSeq: 6, at: now });
});

test("tick discards an empty/all-observe plan and still advances the watermark to the last seen seq", async () => {
  let cardCreated = false;
  let advancedTo: number | undefined;
  const deps = baseDeps({
    actionCards: {
      ...baseDeps().actionCards,
      async listObserverCandidates() {
        return [candidate()];
      },
      async advanceWatermark(input) {
        advancedTo = input.analyzedToSeq;
        return {} as ObserverStateRow;
      },
      async createOrAppendCard(input) {
        cardCreated = true;
        return baseDeps().actionCards.createOrAppendCard(input);
      }
    },
    client: llmClientReturning({ items: [{ kind: "observe", title_md: "只是记一笔", confidence: "low" }] })
  });
  const result = await createConversationObserverScheduler(deps).tick();
  assert.equal(result.skipped_low_quality, 1);
  assert.equal(cardCreated, false);
  assert.equal(advancedTo, 6, "watermark must advance to the last fetched seq, not next_seq blindly");
});

// ── tick: execute dispatch ───────────────────────────────────────────────────────────

test("execute items with dispatch_policy=auto build a work item, enqueue a run, and open a 10-minute undo window", async () => {
  const enqueueCalls: unknown[] = [];
  let cardInput: unknown;
  const deps = baseDeps({
    actionCards: {
      ...baseDeps().actionCards,
      async listObserverCandidates() {
        return [candidate()];
      },
      async createOrAppendCard(input) {
        cardInput = input;
        return baseDeps().actionCards.createOrAppendCard(input);
      }
    },
    agentRuns: {
      async enqueue(input) {
        enqueueCalls.push(input);
        return agentRunRow();
      }
    },
    aiSettings: {
      async findUserProfileAccessRecord() {
        return { membershipRole: "member", profile: { workspaceId, userId: assigneeUserId, defaultMode: 3, granularJson: {}, dispatchPolicy: "auto", cuuProactivity: "balanced", modelTierPref: null, createdAt: now, updatedAt: now } as UserAiProfileRow };
      }
    },
    client: llmClientReturning({
      items: [{ kind: "execute", title_md: "重写第三节", confidence: "high", suggested_assignee_nickname: "张三" }]
    })
  });

  const result = await createConversationObserverScheduler(deps).tick();
  assert.equal(result.cards_created, 1);
  assert.equal(enqueueCalls.length, 1);
  assert.deepEqual((enqueueCalls[0] as { actorId: string }).actorId, assigneeUserId);

  const items = (cardInput as { items: Array<Record<string, unknown>> }).items;
  assert.equal(items[0]?.status, "running");
  assert.equal(items[0]?.assigneeUserId, assigneeUserId);
  assert.ok(items[0]?.runId);
  const undoDeadline = items[0]?.undoDeadlineAt as Date;
  assert.equal(undoDeadline.getTime() - now.getTime(), 10 * 60 * 1000);
});

test("execute items with dispatch_policy=ask notify the assignee and do not enqueue a run", async () => {
  let enqueued = false;
  let notified: unknown;
  const deps = baseDeps({
    actionCards: {
      ...baseDeps().actionCards,
      async listObserverCandidates() {
        return [candidate()];
      }
    },
    agentRuns: {
      async enqueue() {
        enqueued = true;
        return agentRunRow();
      }
    },
    notifications: {
      async createOrUpdateNotification(input) {
        notified = input;
        return { notification: notificationRow(), created: true, resurfaced: false };
      }
    },
    aiSettings: {
      async findUserProfileAccessRecord() {
        return { membershipRole: "member", profile: { workspaceId, userId: assigneeUserId, defaultMode: 3, granularJson: {}, dispatchPolicy: "ask", cuuProactivity: "balanced", modelTierPref: null, createdAt: now, updatedAt: now } as UserAiProfileRow };
      }
    },
    client: llmClientReturning({
      items: [{ kind: "execute", title_md: "重写第三节", confidence: "mid", suggested_assignee_nickname: "张三" }]
    })
  });

  await createConversationObserverScheduler(deps).tick();
  assert.equal(enqueued, false);
  assert.ok(notified);
  assert.equal((notified as { userId: string }).userId, assigneeUserId);
  assert.equal((notified as { dedupeKey: string }).dedupeKey.startsWith("action-card-item:"), true);
  // R13 批 P2：target_url 带上发起这次派活讨论的会话 id（additive 深链，见
  // apps/api/src/services/notifications.ts 的 extractConversationIdFromTargetUrl）——气泡/追赶提醒
  // 才能把用户带回那个会话，不只是工作项页。
  assert.equal(
    (notified as { targetUrl: string }).targetUrl,
    buildDispatchAskTargetUrl(workItemRow().id, conversationId)
  );
});

test("execute items with dispatch_policy=manual create only a work item with no run and no notification", async () => {
  let enqueued = false;
  let notified = false;
  const deps = baseDeps({
    actionCards: {
      ...baseDeps().actionCards,
      async listObserverCandidates() {
        return [candidate()];
      }
    },
    agentRuns: { async enqueue() { enqueued = true; return agentRunRow(); } },
    notifications: { async createOrUpdateNotification() { notified = true; return { notification: notificationRow(), created: true, resurfaced: false }; } },
    aiSettings: {
      async findUserProfileAccessRecord() {
        return { membershipRole: "member", profile: { workspaceId, userId: assigneeUserId, defaultMode: 3, granularJson: {}, dispatchPolicy: "manual", cuuProactivity: "balanced", modelTierPref: null, createdAt: now, updatedAt: now } as UserAiProfileRow };
      }
    },
    client: llmClientReturning({
      items: [{ kind: "execute", title_md: "重写第三节", confidence: "low", suggested_assignee_nickname: "张三" }]
    })
  });

  await createConversationObserverScheduler(deps).tick();
  assert.equal(enqueued, false);
  assert.equal(notified, false);
});

test("execute items fall back to the project owner when the suggested nickname does not match a member", async () => {
  let submitter: string | undefined;
  const deps = baseDeps({
    actionCards: {
      ...baseDeps().actionCards,
      async listObserverCandidates() {
        return [candidate()];
      }
    },
    workItems: {
      async createWorkItem(input) {
        submitter = input.submitterUserId;
        return workItemRow({ submitterUserId: input.submitterUserId });
      },
      async findProjectById() {
        return projectRow();
      }
    },
    client: llmClientReturning({
      items: [{ kind: "execute", title_md: "重写第三节", confidence: "high", suggested_assignee_nickname: "查无此人" }]
    })
  });

  await createConversationObserverScheduler(deps).tick();
  assert.equal(submitter, ownerUserId);
});

test("execute items are escalated with no work item when neither the nickname nor the project owner resolve", async () => {
  let cardInput: unknown;
  const deps = baseDeps({
    actionCards: {
      ...baseDeps().actionCards,
      async listObserverCandidates() {
        return [candidate()];
      },
      async resolveAssigneeByNickname() {
        return null;
      },
      async createOrAppendCard(input) {
        cardInput = input;
        return baseDeps().actionCards.createOrAppendCard(input);
      }
    },
    workItems: {
      async createWorkItem() {
        throw new Error("must not be called when no assignee resolves");
      },
      async findProjectById() {
        return projectRow({ ownerUserId: null });
      }
    },
    client: llmClientReturning({
      items: [{ kind: "execute", title_md: "重写第三节", confidence: "high" }]
    })
  });

  await createConversationObserverScheduler(deps).tick();
  const items = (cardInput as { items: Array<Record<string, unknown>> }).items;
  assert.equal(items[0]?.status, "escalated");
  assert.equal(items[0]?.workItemId, undefined);
});

test("a per-item work-item creation failure escalates only that item and does not abort the whole tick", async () => {
  let cardInput: unknown;
  const deps = baseDeps({
    actionCards: {
      ...baseDeps().actionCards,
      async listObserverCandidates() {
        return [candidate()];
      },
      async createOrAppendCard(input) {
        cardInput = input;
        return baseDeps().actionCards.createOrAppendCard(input);
      }
    },
    workItems: {
      async createWorkItem() {
        throw new Error("db exploded");
      },
      async findProjectById() {
        return projectRow();
      }
    },
    client: llmClientReturning({
      items: [{ kind: "execute", title_md: "重写第三节", confidence: "high", suggested_assignee_nickname: "张三" }]
    })
  });

  const result = await createConversationObserverScheduler(deps).tick();
  assert.equal(result.failed, 0, "a per-item dispatch failure is not a tick-level analysis failure");
  assert.equal(result.cards_created, 1, "the card still gets created with the item marked escalated");
  const items = (cardInput as { items: Array<Record<string, unknown>> }).items;
  assert.equal(items[0]?.status, "escalated");
});

// #4：execute 类派发失败（工作项已建成、enqueue 抛错）时补落真实 escalation_event，让这次失败进决策收件箱、
// 有恢复入口——对齐 decide 类总会落 ai_decisions 行的语义。同时把工作项推进 escalated、往会话里发一条转人系统提示。
test("execute dispatch failure after the work item exists opens a real escalation so the failure reaches the decision inbox", async () => {
  let cardInput: unknown;
  let escalationInput: unknown;
  let transitionInput: unknown;
  let systemNoteInput: unknown;
  const deps = baseDeps({
    actionCards: {
      ...baseDeps().actionCards,
      async listObserverCandidates() {
        return [candidate()];
      },
      async createOrAppendCard(input) {
        cardInput = input;
        return baseDeps().actionCards.createOrAppendCard(input);
      },
      async postSystemMessage(input) {
        systemNoteInput = input;
        return cardMessageRow({ id: "system-message-escalated", kind: "system_event" });
      }
    },
    workItems: {
      async createWorkItem(input) {
        return workItemRow({ id: "work-item-execute-failed", submitterUserId: input.submitterUserId });
      },
      async findProjectById() {
        return projectRow();
      },
      async transitionWorkItemStatus(input) {
        transitionInput = input;
        return { id: input.workItemId, status: input.to, transitioned: true };
      }
    },
    agentRuns: {
      async enqueue() {
        throw new Error("queue is down");
      }
    },
    aiSettings: {
      async findUserProfileAccessRecord() {
        return { membershipRole: "member", profile: { workspaceId, userId: assigneeUserId, defaultMode: 3, granularJson: {}, dispatchPolicy: "auto", cuuProactivity: "balanced", modelTierPref: null, createdAt: now, updatedAt: now } as UserAiProfileRow };
      }
    },
    decisions: {
      async createEscalationEvent(input) {
        escalationInput = input;
        return escalationRow();
      }
    },
    client: llmClientReturning({
      items: [{ kind: "execute", title_md: "重写第三节", confidence: "high", suggested_assignee_nickname: "张三" }]
    })
  });

  const result = await createConversationObserverScheduler(deps).tick();
  assert.equal(result.failed, 0, "a dispatch failure that we recover into an escalation is not a tick-level analysis failure");
  assert.equal(result.cards_created, 1);
  const items = (cardInput as { items: Array<Record<string, unknown>> }).items;
  assert.equal(items[0]?.status, "escalated");
  assert.equal(items[0]?.workItemId, "work-item-execute-failed", "the item keeps the work-item lineage so the inbox can resolve it");
  // 真落了一条 escalation（进决策收件箱的驱动数据），指向失败工作项、带负责人与来源溯源。
  assert.equal((escalationInput as { workItemId: string }).workItemId, "work-item-execute-failed");
  assert.equal((escalationInput as { trigger: string }).trigger, "unqualified");
  assert.equal((escalationInput as { suggestedLeadUserId: string }).suggestedLeadUserId, assigneeUserId);
  assert.equal((escalationInput as { handoffJson: { execute_dispatch_failed?: boolean } }).handoffJson.execute_dispatch_failed, true);
  // 工作项被推进 escalated（状态诚实反映"在等人"）。
  assert.equal((transitionInput as { workItemId: string }).workItemId, "work-item-execute-failed");
  assert.equal((transitionInput as { to: string }).to, "escalated");
  // 会话里落一条转人系统提示。
  assert.equal((systemNoteInput as { content: { event?: string } }).content.event, "execute_item_escalated");
});

// ── tick: decide dispatch ────────────────────────────────────────────────────────────

test("decide items open a pm-mode work item, create an escalation, and post a threaded @-mention", async () => {
  let escalationInput: unknown;
  let systemNoteInput: unknown;
  const deps = baseDeps({
    actionCards: {
      ...baseDeps().actionCards,
      async listObserverCandidates() {
        return [candidate()];
      },
      async postSystemMessage(input) {
        systemNoteInput = input;
        return cardMessageRow({ id: "system-message-1", kind: "system_event" });
      }
    },
    workItems: {
      async createWorkItem(input) {
        assert.equal(input.mode, "pm");
        assert.equal(input.status, "escalated");
        return workItemRow({ mode: "pm", status: "escalated" });
      },
      async findProjectById() {
        return projectRow();
      }
    },
    decisions: {
      async createEscalationEvent(input) {
        escalationInput = input;
        return escalationRow();
      }
    },
    client: llmClientReturning({
      items: [{ kind: "decide", title_md: "预算是否砍半", confidence: "low", suggested_assignee_nickname: "张三" }]
    })
  });

  await createConversationObserverScheduler(deps).tick();
  assert.equal((escalationInput as { trigger: string }).trigger, "unqualified");
  assert.equal((escalationInput as { suggestedLeadUserId: string }).suggestedLeadUserId, assigneeUserId);
  assert.equal((systemNoteInput as { threadRootId: string }).threadRootId, messageId);
  assert.match((systemNoteInput as { content: { summary: string } }).content.summary, /张三/u);
});

// ── R13 H1：条目 id 确定性派生 + 建卡冲突幂等 ──────────────────────────────────────────
//
// 自审 backlog 项2：execute/decide 派发（建真实 work_item/agent_run/通知）发生在
// createOrAppendCard 落库、推水位线之前，且那些派发写不进同一个事务、回不了滚。此前条目 id 是
// randomUUID()——若 createOrAppendCard 这一步失败，水位线不会推进，下一 tick 会对同一批消息重新
// 分析，每次都造一批全新 id、全新的真实 work_item。这里验证：(a) id 现在是 (conversationId,
// analyzedToSeq, ordinal) 的确定性派生，同一批消息重扫两次拿到相同 id；(b) createOrAppendCard 撞
// items 表唯一约束（23505）时被当幂等吞掉,不算分析失败,只推水位线；(c) 其它非唯一冲突错误依然
// 原样冒泡成分析失败,不会被这条幂等分支误吞。

test("re-analyzing the same message window twice derives the same item id both times (not a fresh randomUUID)", async () => {
  const cardInputs: Array<{ items: Array<{ id: string }> }> = [];
  const deps = baseDeps({
    actionCards: {
      ...baseDeps().actionCards,
      async listObserverCandidates() {
        return [candidate()];
      },
      async createOrAppendCard(input) {
        const result = await baseDeps().actionCards.createOrAppendCard(input);
        cardInputs.push(input as { items: Array<{ id: string }> });
        return result;
      }
    },
    client: llmClientReturning({
      items: [{ kind: "execute", title_md: "重写第三节", confidence: "high", suggested_assignee_nickname: "张三" }]
    })
  });
  const scheduler = createConversationObserverScheduler(deps);
  await scheduler.tick();
  await scheduler.tick();

  assert.equal(cardInputs.length, 2);
  const firstId = cardInputs[0]?.items[0]?.id;
  const secondId = cardInputs[1]?.items[0]?.id;
  assert.ok(firstId, "first tick must produce an item id");
  assert.equal(firstId, secondId, "the same (conversationId, analyzedToSeq, ordinal) must derive the same id on retry");
});

test("item ids differ by ordinal within the same plan", async () => {
  let cardInput: { items: Array<{ id: string }> } | undefined;
  const deps = baseDeps({
    actionCards: {
      ...baseDeps().actionCards,
      async listObserverCandidates() {
        return [candidate()];
      },
      async createOrAppendCard(input) {
        const result = await baseDeps().actionCards.createOrAppendCard(input);
        cardInput = input as { items: Array<{ id: string }> };
        return result;
      }
    },
    client: llmClientReturning({
      // 两条都得是非 observe（isLowQualityObserverPlan 把"全 observe"计划当低质早退，走不到
      // createOrAppendCard），随便混一个 execute 一个 decide 就够验证 ordinal 区分。
      items: [
        { kind: "execute", title_md: "重写第三节", confidence: "high", suggested_assignee_nickname: "张三" },
        { kind: "decide", title_md: "预算是否砍半", confidence: "low", suggested_assignee_nickname: "张三" }
      ]
    })
  });
  await createConversationObserverScheduler(deps).tick();
  const ids = cardInput?.items.map((item) => item.id) ?? [];
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1]);
});

test("a unique-violation (23505) from createOrAppendCard is treated as an idempotent duplicate: watermark advances, no failure is recorded", async () => {
  let advanced: unknown;
  const deps = baseDeps({
    actionCards: {
      ...baseDeps().actionCards,
      async listObserverCandidates() {
        return [candidate()];
      },
      async createOrAppendCard() {
        throw Object.assign(new Error('duplicate key value violates unique constraint "action_card_items_pkey"'), {
          code: "23505"
        });
      },
      async advanceWatermark(input) {
        advanced = input;
        return {} as ObserverStateRow;
      }
    },
    client: llmClientReturning({
      items: [{ kind: "execute", title_md: "重写第三节", confidence: "high", suggested_assignee_nickname: "张三" }]
    })
  });
  const result = await createConversationObserverScheduler(deps).tick();
  assert.equal(result.failed, 0, "a duplicate-key conflict on retry is not a genuine analysis failure");
  assert.equal(result.skipped_duplicate_write, 1);
  assert.equal(result.cards_created, 0);
  assert.deepEqual(advanced, { conversationId, analyzedToSeq: 6, at: now });
});

test("R24 S3: a unique-violation nested under drizzle-orm's `.cause` (the real production shape) is also treated as an idempotent duplicate", async () => {
  // drizzle-orm 0.45 的 node-postgres 驱动把裸 pg DatabaseError 包进 DrizzleQueryError 的
  // `.cause`——顶层没有 `.code`。上面那条测试用的顶层塞 code 的假错误形状，在生产里并不真实存在；
  // 这条锁死 isUniqueViolation 接得住真实的嵌套包装（同一根因见 apps/api/src/routes/auth.ts 的
  // desktop-bootstrap 并发 500 修复）。
  let advanced: unknown;
  const deps = baseDeps({
    actionCards: {
      ...baseDeps().actionCards,
      async listObserverCandidates() {
        return [candidate()];
      },
      async createOrAppendCard() {
        const pgDatabaseError = Object.assign(
          new Error('duplicate key value violates unique constraint "action_card_items_pkey"'),
          { code: "23505" }
        );
        throw Object.assign(new Error('Failed query: insert into "action_card_items" ...'), {
          cause: pgDatabaseError
        });
      },
      async advanceWatermark(input) {
        advanced = input;
        return {} as ObserverStateRow;
      }
    },
    client: llmClientReturning({
      items: [{ kind: "execute", title_md: "重写第三节", confidence: "high", suggested_assignee_nickname: "张三" }]
    })
  });
  const result = await createConversationObserverScheduler(deps).tick();
  assert.equal(result.failed, 0, "a nested-cause duplicate-key conflict on retry is not a genuine analysis failure");
  assert.equal(result.skipped_duplicate_write, 1);
  assert.equal(result.cards_created, 0);
  assert.deepEqual(advanced, { conversationId, analyzedToSeq: 6, at: now });
});

test("a non-unique-violation error from createOrAppendCard still propagates as a genuine analysis failure", async () => {
  let recorded: unknown;
  const deps = baseDeps({
    actionCards: {
      ...baseDeps().actionCards,
      async listObserverCandidates() {
        return [candidate()];
      },
      async createOrAppendCard() {
        throw new Error("connection terminated unexpectedly");
      },
      async recordAnalysisFailure(input) {
        recorded = input;
        return {} as ObserverStateRow;
      }
    },
    client: llmClientReturning({
      items: [{ kind: "execute", title_md: "重写第三节", confidence: "high", suggested_assignee_nickname: "张三" }]
    })
  });
  const result = await createConversationObserverScheduler(deps).tick();
  assert.equal(result.failed, 1, "a non-duplicate-key error must not be swallowed by the idempotency branch");
  assert.equal(result.skipped_duplicate_write, 0);
  assert.equal((recorded as { conversationId: string } | undefined)?.conversationId, conversationId);
});

// ── SSE ──────────────────────────────────────────────────────────────────────────────

test("tick publishes a conversation.action_card.updated event carrying only the minimal renderable summary", async () => {
  const published: unknown[] = [];
  const deps = baseDeps({
    actionCards: {
      ...baseDeps().actionCards,
      async listObserverCandidates() {
        return [candidate()];
      }
    },
    client: llmClientReturning({
      items: [{ kind: "execute", title_md: "重写第三节", confidence: "high", suggested_assignee_nickname: "张三" }]
    }),
    bus: {
      async publish(topic: string, type: string, event: unknown) {
        published.push({ topic, type, event });
      }
    }
  });
  await createConversationObserverScheduler(deps).tick();
  // R14 CHAT 批（presence-observer 工包）：tick 现在还会先发一条 conversation.observer.analyzing
  // 瞬态信号（见 emitObserverAnalyzing，在真正准备 prompt/调 LLM 之前发布）——这条测试原本断言总发布
  // 数为 1，那时协议里只有 action_card.updated 一种会话级 SSE 产出。这里改成按 type 过滤，
  // 而不是放宽总数断言：既验证 analyzing 确实先发了一条，也保留原有「action_card.updated 只发一条、
  // 只带最小可渲染摘要」的核心断言不被稀释。
  assert.equal(published.length, 2);
  const analyzing = published[0] as { topic: string; type: string };
  assert.equal(analyzing.topic, `conversation:${conversationId}`);
  assert.equal(analyzing.type, "conversation.observer.analyzing");
  const actionCardCalls = published.filter(
    (call) => (call as { type: string }).type === "conversation.action_card.updated"
  );
  assert.equal(actionCardCalls.length, 1);
  const call = actionCardCalls[0] as { topic: string; type: string; event: { data: { items: unknown[] } } };
  assert.equal(call.topic, `conversation:${conversationId}`);
  assert.equal(call.type, "conversation.action_card.updated");
  assert.equal(call.event.data.items.length, 1);
});

// ── SSE: conversation.observer.analyzing ──────────────────────────────────────────────

test("tick publishes conversation.observer.analyzing before analyzing a message window, shaped exactly per contract", async () => {
  const published: Array<{ topic: string; type: string; event: unknown }> = [];
  const deps = baseDeps({
    actionCards: {
      ...baseDeps().actionCards,
      async listObserverCandidates() {
        return [candidate()];
      }
    },
    bus: {
      async publish(topic: string, type: string, event: unknown) {
        published.push({ topic, type, event });
      }
    }
  });
  await createConversationObserverScheduler(deps).tick();
  const analyzingCalls = published.filter((call) => call.type === "conversation.observer.analyzing");
  assert.equal(analyzingCalls.length, 1);
  const event = analyzingCalls[0]!.event as {
    type: string;
    topic: string;
    ts: string;
    actor: { actor_kind: string; label?: string };
    data: { conversation_id: string; ttl_ms: number; expires_at: string };
  };
  assert.equal(analyzingCalls[0]!.topic, `conversation:${conversationId}`);
  assert.equal(event.type, "conversation.observer.analyzing");
  assert.equal(event.topic, `conversation:${conversationId}`);
  assert.equal(event.actor.actor_kind, "ai");
  assert.equal(event.data.conversation_id, conversationId);
  assert.equal(event.data.ttl_ms, 30000);
  assert.equal(event.ts, now.toISOString());
  assert.equal(Date.parse(event.data.expires_at) - Date.parse(event.ts), 30000);
});

test("tick does not publish conversation.observer.analyzing when there is no message window to analyze", async () => {
  const published: Array<{ topic: string; type: string }> = [];
  const deps = baseDeps({
    actionCards: {
      ...baseDeps().actionCards,
      async listObserverCandidates() {
        return [candidate()];
      },
      async listMessagesForAnalysis() {
        return [];
      }
    },
    bus: {
      async publish(topic: string, type: string) {
        published.push({ topic, type });
      }
    }
  });
  const result = await createConversationObserverScheduler(deps).tick();
  assert.equal(result.skipped_low_quality, 1);
  assert.equal(published.length, 0);
});

test("tick does not publish conversation.observer.analyzing when budget-blocked before any message window is fetched", async () => {
  const exhaustedPolicy: BudgetPolicy = {
    id: "team-day",
    scopeKind: "team",
    period: "day",
    maxTokens: 1,
    maxCostCny: "0.01",
    warningRatio: 0.7,
    criticalRatio: 0.9,
    onWarning: "notify",
    onExhausted: "block_new_run",
    enabled: true,
    version: 1
  };
  const published: Array<{ topic: string; type: string }> = [];
  const deps = baseDeps({
    actionCards: {
      ...baseDeps().actionCards,
      async listObserverCandidates() {
        return [candidate()];
      }
    },
    policyStore: { listPolicies: () => [exhaustedPolicy] },
    ledgerStore: {
      usageSnapshots: async () => [
        { scope: { kind: "team", teamId: workspaceId }, period: "day", tokenIn: 10, tokenOut: 10, estimatedCostCny: "1" }
      ]
    },
    bus: {
      async publish(topic: string, type: string) {
        published.push({ topic, type });
      }
    }
  });
  const result = await createConversationObserverScheduler(deps).tick();
  assert.equal(result.skipped_budget, 1);
  assert.equal(published.length, 0);
});

// ── tick: failure isolation ──────────────────────────────────────────────────────────

test("an analysis-level failure is recorded and does not crash the tick or block other candidates", async () => {
  let recorded: unknown;
  const secondConversationId = "13000000-0000-4000-8000-000000000099";
  const deps = baseDeps({
    actionCards: {
      ...baseDeps().actionCards,
      async listObserverCandidates() {
        return [candidate(), candidate({ conversationId: secondConversationId })];
      },
      async listMessagesForAnalysis(input) {
        if (input.conversationId === conversationId) {
          throw new Error("transient db error");
        }
        return [];
      },
      async recordAnalysisFailure(input) {
        recorded = input;
        return {} as ObserverStateRow;
      },
      async advanceWatermark() {
        return {} as ObserverStateRow;
      }
    }
  });
  const result = await createConversationObserverScheduler(deps).tick();
  assert.equal(result.failed, 1);
  assert.equal(result.skipped_low_quality, 1, "the second, healthy candidate still gets processed");
  assert.equal((recorded as { conversationId: string }).conversationId, conversationId);
});

test("tick returns a zero result and does not re-enter while a previous tick is already running", async () => {
  let resolveFirst: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    resolveFirst = resolve;
  });
  const deps = baseDeps({
    actionCards: {
      ...baseDeps().actionCards,
      async listObserverCandidates() {
        await gate;
        return [];
      }
    }
  });
  const scheduler = createConversationObserverScheduler(deps);
  const firstTick = scheduler.tick();
  const secondResult = await scheduler.tick();
  assert.equal(secondResult.scanned, 0);
  assert.equal(secondResult.analyzed, 0);
  resolveFirst?.();
  await firstTick;
});

test("stats accumulate tick/analyzed/card counts across ticks", async () => {
  const deps = baseDeps({
    actionCards: {
      ...baseDeps().actionCards,
      async listObserverCandidates() {
        return [candidate()];
      }
    },
    client: llmClientReturning({
      items: [{ kind: "execute", title_md: "重写第三节", confidence: "high", suggested_assignee_nickname: "张三" }]
    })
  });
  const scheduler = createConversationObserverScheduler(deps);
  await scheduler.tick();
  const stats = scheduler.stats();
  assert.equal(stats.tick_count, 1);
  assert.equal(stats.analyzed_count, 1);
  assert.equal(stats.cards_created_count, 1);
  assert.equal(stats.error_count, 0);
});

test("R12 真 key 冒烟回归:分析窗口默认值不得超过 action-cards 仓库的 limit 上限(跨层漂移曾致真库 tick 全失败)", () => {
  assert.ok(
    DEFAULT_MAX_MESSAGES_PER_ANALYSIS <= ACTION_CARD_ANALYSIS_LIMIT_MAX,
    `observer default analysis window (${DEFAULT_MAX_MESSAGES_PER_ANALYSIS}) must fit the repository cap (${ACTION_CARD_ANALYSIS_LIMIT_MAX})`
  );
});

// ── R13 批 A2（派人推荐 v2）：候选名单 + resolveAssignee 优先级 ──────────────────────────────

test("R13 A2: the observer builds a candidate roster once per analysis and passes it into the prompt in a project-manager voice", async () => {
  let capturedPrompt: string | undefined;
  const deps = baseDeps({
    actionCards: {
      ...baseDeps().actionCards,
      async listObserverCandidates() {
        return [candidate()];
      }
    },
    userProfiles: {
      async listCandidatesForProject(input) {
        assert.equal(input.projectId, projectId);
        return [candidateForProjectRow()];
      }
    },
    client: async () => ({
      messages: {
        async create(input: { messages: Array<{ content: string }> }) {
          capturedPrompt = input.messages[0]?.content;
          return { content: [{ type: "text", text: JSON.stringify({ items: [] }) }] };
        }
      }
    })
  });

  await createConversationObserverScheduler(deps).tick();

  assert.ok(capturedPrompt, "expected the observer to have called the LLM client");
  assert.match(capturedPrompt!, /派活候选名单/u);
  assert.match(capturedPrompt!, /项目经理/u);
  assert.match(capturedPrompt!, new RegExp(rosterNickname, "u"));
  assert.match(capturedPrompt!, /后端负责人/u);
});

test("R13 A2: execute items fall back to the roster's top scorer (not the project owner) when the LLM names no one", async () => {
  let submitter: string | undefined;
  let systemNoteContent: unknown;
  const deps = baseDeps({
    actionCards: {
      ...baseDeps().actionCards,
      async listObserverCandidates() {
        return [candidate()];
      },
      async postSystemMessage(input) {
        systemNoteContent = input.content;
        return cardMessageRow({ id: "system-message-1", kind: "system_event" });
      }
    },
    userProfiles: {
      async listCandidatesForProject() {
        return [candidateForProjectRow()];
      }
    },
    workItems: {
      async createWorkItem(input) {
        submitter = input.submitterUserId;
        return workItemRow({ submitterUserId: input.submitterUserId });
      },
      async findProjectById() {
        throw new Error("must not fall back to the project owner when the roster has a candidate");
      }
    },
    client: llmClientReturning({
      items: [{ kind: "execute", title_md: "重写第三节", confidence: "high" }]
    })
  });

  await createConversationObserverScheduler(deps).tick();

  assert.equal(submitter, rosterUserId);
  assert.equal((systemNoteContent as { assignee_user_id: string }).assignee_user_id, rosterUserId);
  assert.match((systemNoteContent as { summary: string }).summary, /根据资料与历史交付选中/u);
});

test("R13 A2: execute items fall back to the roster's top scorer (not the project owner) when the suggested nickname matches no member", async () => {
  let submitter: string | undefined;
  const deps = baseDeps({
    actionCards: {
      ...baseDeps().actionCards,
      async listObserverCandidates() {
        return [candidate()];
      }
    },
    userProfiles: {
      async listCandidatesForProject() {
        return [candidateForProjectRow()];
      }
    },
    workItems: {
      async createWorkItem(input) {
        submitter = input.submitterUserId;
        return workItemRow({ submitterUserId: input.submitterUserId });
      },
      async findProjectById() {
        throw new Error("must not fall back to the project owner when the roster has a candidate");
      }
    },
    client: llmClientReturning({
      items: [{ kind: "execute", title_md: "重写第三节", confidence: "high", suggested_assignee_nickname: "查无此人" }]
    })
  });

  await createConversationObserverScheduler(deps).tick();
  assert.equal(submitter, rosterUserId);
});

test("R13 A2: an explicit LLM nickname match is never overridden by the roster, even when the roster's top scorer has a far higher score", async () => {
  let submitter: string | undefined;
  const higherScoringOtherUserId = "13000000-0000-4000-8000-000000000030";
  const deps = baseDeps({
    actionCards: {
      ...baseDeps().actionCards,
      async listObserverCandidates() {
        return [candidate()];
      },
      async resolveAssigneeByNickname(input) {
        return input.nickname === "张三" ? { userId: assigneeUserId, nickname: "张三" } : null;
      }
    },
    userProfiles: {
      async listCandidatesForProject() {
        // 名单里分数最高的是另一个人（李四，交付量刷到 999）——nickname 命中必须原样采用张三，
        // 不能被这份高分名单压过去（用户拍板的点名优先语义铁律）。
        return [
          candidateForProjectRow({
            userId: higherScoringOtherUserId,
            nickname: "李四",
            acceptedDeliverableCount: 999,
            title: "交付大户"
          })
        ];
      }
    },
    workItems: {
      async createWorkItem(input) {
        submitter = input.submitterUserId;
        return workItemRow({ submitterUserId: input.submitterUserId });
      },
      async findProjectById() {
        throw new Error("must not reach the project-owner fallback — the nickname already resolved");
      }
    },
    client: llmClientReturning({
      items: [{ kind: "execute", title_md: "重写第三节", confidence: "high", suggested_assignee_nickname: "张三" }]
    })
  });

  await createConversationObserverScheduler(deps).tick();
  assert.equal(submitter, assigneeUserId, "explicit nickname match must win over the roster's top scorer");
});

test("R13 A2: an empty roster still falls back to the project owner (pre-existing behavior, not regressed)", async () => {
  let submitter: string | undefined;
  const deps = baseDeps({
    actionCards: {
      ...baseDeps().actionCards,
      async listObserverCandidates() {
        return [candidate()];
      },
      async resolveAssigneeByNickname() {
        return null;
      }
    },
    userProfiles: {
      async listCandidatesForProject() {
        return [];
      }
    },
    workItems: {
      async createWorkItem(input) {
        submitter = input.submitterUserId;
        return workItemRow({ submitterUserId: input.submitterUserId });
      },
      async findProjectById() {
        return projectRow();
      }
    },
    client: llmClientReturning({
      items: [{ kind: "execute", title_md: "重写第三节", confidence: "high", suggested_assignee_nickname: "查无此人" }]
    })
  });

  await createConversationObserverScheduler(deps).tick();
  assert.equal(submitter, ownerUserId);
});

test("R13 A2: decide item system note appends the roster-selection explainer only when the assignee came from the roster", async () => {
  let systemNoteContent: unknown;
  const deps = baseDeps({
    actionCards: {
      ...baseDeps().actionCards,
      async listObserverCandidates() {
        return [candidate()];
      },
      async postSystemMessage(input) {
        systemNoteContent = input.content;
        return cardMessageRow({ id: "system-message-1", kind: "system_event" });
      }
    },
    userProfiles: {
      async listCandidatesForProject() {
        return [candidateForProjectRow()];
      }
    },
    client: llmClientReturning({
      items: [{ kind: "decide", title_md: "预算是否砍半", confidence: "low" }]
    })
  });

  await createConversationObserverScheduler(deps).tick();
  assert.match((systemNoteContent as { summary: string }).summary, /根据资料与历史交付选中/u);
});

test("R13 A2: decide item system note does not carry the roster-selection explainer when the LLM named someone explicitly", async () => {
  let systemNoteContent: unknown;
  const deps = baseDeps({
    actionCards: {
      ...baseDeps().actionCards,
      async listObserverCandidates() {
        return [candidate()];
      },
      async postSystemMessage(input) {
        systemNoteContent = input.content;
        return cardMessageRow({ id: "system-message-1", kind: "system_event" });
      }
    },
    userProfiles: {
      async listCandidatesForProject() {
        return [candidateForProjectRow()];
      }
    },
    client: llmClientReturning({
      items: [{ kind: "decide", title_md: "预算是否砍半", confidence: "low", suggested_assignee_nickname: "张三" }]
    })
  });

  await createConversationObserverScheduler(deps).tick();
  assert.doesNotMatch((systemNoteContent as { summary: string }).summary, /根据资料与历史交付选中/u);
});

// ── R14 批 CHAT（下游墓碑过滤）：观察者分析窗跳过墓碑，但 watermark 仍按真实最大 seq 推进 ──────
test("R14 observer excludes deleted (tombstone) message text from the analysis prompt yet advances the watermark past it", async () => {
  let capturedPrompt = "";
  let advancedTo = -1;
  const deps = baseDeps({
    actionCards: {
      ...baseDeps().actionCards,
      async listObserverCandidates() {
        return [candidate()];
      },
      async listMessagesForAnalysis() {
        // 故意让墓碑行仍带残留文本（生产里删除会清空 content——这里是为了单独证明 deletedAt 短路本身，
        // 而不是被“内容已空”顺带挡下）。墓碑还占着最高 seq。
        return [
          message(4, { seq: 4, contentJson: { text: "活着的讨论内容" } }),
          message(5, { seq: 5, deletedAt: now, contentJson: { text: "这条已删但仍带残留文本" } })
        ];
      },
      async advanceWatermark(input) {
        advancedTo = input.analyzedToSeq;
        return {} as ObserverStateRow;
      }
    },
    client: async () => ({
      messages: {
        async create(input: unknown) {
          capturedPrompt = JSON.stringify(input);
          return { content: [{ type: "text", text: JSON.stringify({ items: [] }) }] };
        }
      }
    })
  });

  await createConversationObserverScheduler(deps).tick();

  assert.ok(capturedPrompt.includes("活着的讨论内容"), "live message text must reach the prompt");
  assert.ok(!capturedPrompt.includes("这条已删但仍带残留文本"), "tombstone text must be skipped");
  assert.equal(advancedTo, 5, "watermark advances to the true max seq (tombstone still counts), not the last live seq");
});

// ── R23 P3b（SA-03）：仓库动态进观察者 prompt ─────────────────────────────────────────────

test("tick feeds the project's recent repo activity into the observer prompt as an objective record", async () => {
  let capturedPrompt = "";
  const requested: Array<{ projectId: string; limit: number }> = [];
  const occurred = (daysAgo: number) => new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  const deps = baseDeps({
    actionCards: {
      ...baseDeps().actionCards,
      async listObserverCandidates() {
        return [candidate()];
      }
    },
    githubActivity: {
      listRecentActivitiesByProject: async (id: string, limit: number) => {
        requested.push({ projectId: id, limit });
        return [
          { kind: "commit", title: "修好了支付回调", occurredAt: occurred(1), state: null, authorLogin: "amy" },
          { kind: "commit", title: "上个月的提交", occurredAt: occurred(45), state: null, authorLogin: null }
        ] as never;
      }
    },
    client: async () => ({
      messages: {
        async create(input: unknown) {
          capturedPrompt = JSON.stringify(input);
          return { content: [{ type: "text", text: JSON.stringify({ items: [] }) }] };
        }
      }
    })
  });

  await createConversationObserverScheduler(deps).tick();

  assert.deepEqual(requested, [{ projectId, limit: 30 }]);
  assert.ok(capturedPrompt.includes("最近的代码仓库动态"), "the repo activity section must reach the prompt");
  assert.ok(capturedPrompt.includes("修好了支付回调"));
  assert.ok(!capturedPrompt.includes("上个月的提交"), "rows outside the 7-day window must be dropped");
});

test("tick analyzes normally when no github activity port is wired in", async () => {
  let capturedPrompt = "";
  const deps = baseDeps({
    actionCards: {
      ...baseDeps().actionCards,
      async listObserverCandidates() {
        return [candidate()];
      }
    },
    client: async () => ({
      messages: {
        async create(input: unknown) {
          capturedPrompt = JSON.stringify(input);
          return { content: [{ type: "text", text: JSON.stringify({ items: [] }) }] };
        }
      }
    })
  });

  const result = await createConversationObserverScheduler(deps).tick();

  assert.equal(result.analyzed, 1);
  assert.ok(!capturedPrompt.includes("最近的代码仓库动态"));
});

test("tick keeps analyzing when the repo activity lookup throws", async () => {
  const warnings: string[] = [];
  const deps = baseDeps({
    actionCards: {
      ...baseDeps().actionCards,
      async listObserverCandidates() {
        return [candidate()];
      }
    },
    githubActivity: {
      listRecentActivitiesByProject: async () => {
        throw new Error("github table exploded");
      }
    },
    logger: { warn: (event: string) => { warnings.push(event); }, error: () => {} }
  });

  const result = await createConversationObserverScheduler(deps).tick();

  assert.equal(result.analyzed, 1);
  assert.equal(result.failed, 0);
  assert.ok(warnings.includes("conversation_observer_repo_activity_failed"));
});

// ── R23 P3b（SA-07）：「助手主动性」三档决定观察者的静默窗口 ────────────────────────────

test("the observer silence window scales with the project owner's proactivity level", () => {
  // 项目级窗口 60s：安静档要等两倍、均衡档原样、主动档减半。均衡=接线前行为，是本次改造的不变式。
  assert.equal(observerSilenceWindowMs(candidate({ ownerProactivity: "quiet" })), 120_000);
  assert.equal(observerSilenceWindowMs(candidate({ ownerProactivity: "balanced" })), 60_000);
  assert.equal(observerSilenceWindowMs(candidate({ ownerProactivity: "proactive" })), 30_000);
  // 脏数据（历史行/手改库）回落默认档，不让整个 tick 崩掉。
  assert.equal(observerSilenceWindowMs(candidate({ ownerProactivity: "nonsense" })), 60_000);
});

test("a conversation that went quiet 45 seconds ago is only ripe for the proactive level", () => {
  const lastMessageAt = new Date(now.getTime() - 45_000);
  assert.equal(isObserverSilenceElapsed(candidate({ ownerProactivity: "quiet", lastMessageAt }), now), false);
  assert.equal(isObserverSilenceElapsed(candidate({ ownerProactivity: "balanced", lastMessageAt }), now), false);
  assert.equal(isObserverSilenceElapsed(candidate({ ownerProactivity: "proactive", lastMessageAt }), now), true);
});

test("a conversation that went quiet 90 seconds ago is ripe for every level except quiet", () => {
  const lastMessageAt = new Date(now.getTime() - 90_000);
  assert.equal(isObserverSilenceElapsed(candidate({ ownerProactivity: "quiet", lastMessageAt }), now), false);
  assert.equal(isObserverSilenceElapsed(candidate({ ownerProactivity: "balanced", lastMessageAt }), now), true);
  assert.equal(isObserverSilenceElapsed(candidate({ ownerProactivity: "proactive", lastMessageAt }), now), true);
});

test("tick defers a candidate whose precise silence window has not elapsed yet, without touching the LLM", async () => {
  // SQL 粗筛按最宽窗口（主动档 ×0.5=30s）放行，所以 45 秒前的会话会被扫出来；均衡档的项目
  // 这时候还没到点，worker 必须自己挡住，且不能记进 skipped_quiet_hours。
  let llmCalls = 0;
  const deps = baseDeps({
    actionCards: {
      ...baseDeps().actionCards,
      async listObserverCandidates() {
        return [candidate({ ownerProactivity: "balanced", lastMessageAt: new Date(now.getTime() - 45_000) })];
      }
    },
    client: async () => ({
      messages: {
        async create() {
          llmCalls += 1;
          return { content: [{ type: "text", text: JSON.stringify({ items: [] }) }] };
        }
      }
    })
  });

  const result = await createConversationObserverScheduler(deps).tick();

  assert.equal(result.scanned, 1);
  assert.equal(result.analyzed, 0);
  assert.equal(result.skipped_proactivity_window, 1);
  assert.equal(result.skipped_quiet_hours, 0, "not-yet-ripe must not be miscounted as quiet hours");
  assert.equal(llmCalls, 0, "a deferred candidate must not cost a single LLM call");
});

test("tick analyzes the same 45-second-old conversation once the owner switches to the proactive level", async () => {
  const deps = baseDeps({
    actionCards: {
      ...baseDeps().actionCards,
      async listObserverCandidates() {
        return [candidate({ ownerProactivity: "proactive", lastMessageAt: new Date(now.getTime() - 45_000) })];
      }
    },
    client: async () => ({
      messages: {
        async create() {
          return { content: [{ type: "text", text: JSON.stringify({ items: [] }) }] };
        }
      }
    })
  });

  const result = await createConversationObserverScheduler(deps).tick();

  assert.equal(result.analyzed, 1);
  assert.equal(result.skipped_proactivity_window, 0);
});

test("tick defers a 90-second-old conversation for a quiet-level owner that a balanced owner would get analyzed", async () => {
  const listFor = (level: string) => async () => [
    candidate({ ownerProactivity: level, lastMessageAt: new Date(now.getTime() - 90_000) })
  ];
  const build = (level: string) =>
    baseDeps({
      actionCards: { ...baseDeps().actionCards, listObserverCandidates: listFor(level) },
      client: async () => ({
        messages: {
          async create() {
            return { content: [{ type: "text", text: JSON.stringify({ items: [] }) }] };
          }
        }
      })
    });

  const quiet = await createConversationObserverScheduler(build("quiet")).tick();
  const balanced = await createConversationObserverScheduler(build("balanced")).tick();

  assert.equal(quiet.analyzed, 0);
  assert.equal(quiet.skipped_proactivity_window, 1);
  assert.equal(balanced.analyzed, 1);
  assert.equal(balanced.skipped_proactivity_window, 0);
});

// 跨层一致性（同 DEFAULT_MAX_MESSAGES_PER_ANALYSIS ≤ ACTION_CARD_ANALYSIS_LIMIT_MAX 的对齐断言）：
// SQL 粗筛的窗口系数必须不严于最宽的档位系数，否则主动档该扫的会话在 SQL 里就被滤掉了，worker
// 这层再宽也救不回来——这种跨层常数漂移只有断言拦得住。
test("the SQL prefilter factor stays at least as permissive as the most permissive proactivity level", () => {
  const widest = Math.min(
    ...(["quiet", "balanced", "proactive"] as const).map(
      (level) => resolveProactivityPolicy(level).observerSilenceMultiplier
    )
  );
  assert.ok(
    OBSERVER_SILENCE_SCAN_FLOOR_FACTOR <= widest,
    `SQL prefilter factor ${OBSERVER_SILENCE_SCAN_FLOOR_FACTOR} must not be stricter than the widest level factor ${widest}`
  );
});
