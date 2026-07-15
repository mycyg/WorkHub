import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { WorkHubDb } from "../client.js";
import {
  actionCardItems,
  actionCards,
  conversationMessages,
  conversationObserverState,
  projectAiGovernance,
  projectConversations,
  projects,
  users,
  workspaceMemberships
} from "../schema/index.js";

// R12 批3：行动卡 + 观察者水位线的读写。所有查询都在 SQL 里带 workspaceId/projectId 过滤（租户隔离
// 不做"查完再滤"）；所有列表读取都带 limit 上限；观察者候选扫描/追加写全部在事务内做行锁，避免并发
// tick 与并发决策/撤销互相踩踏。

export type ActionCardItemKind = "execute" | "decide" | "observe";
export type ActionCardItemConfidence = "high" | "mid" | "low";
export type ActionCardItemStatus =
  | "running"
  | "done"
  | "undone"
  | "waiting_decision"
  | "dismissed"
  | "escalated";
export type ActionCardStatus = "active" | "superseded";

export type ActionCardRow = typeof actionCards.$inferSelect;
export type ActionCardItemRow = typeof actionCardItems.$inferSelect;
export type ObserverStateRow = typeof conversationObserverState.$inferSelect;
export type ActionCardConversationMessageRow = typeof conversationMessages.$inferSelect;

const OBSERVER_CANDIDATE_HARD_CAP = 100;
const CARD_ITEMS_READ_CAP = 100;
const DEFAULT_SILENCE_WINDOW_SECS = 60;

class NamedActionCardRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ActionCardRepositoryInputError extends NamedActionCardRepositoryError {}
export class ActionCardConversationNotFoundError extends NamedActionCardRepositoryError {}
export class ActionCardSequenceAllocationError extends NamedActionCardRepositoryError {}
export class ActionCardInsertFailedError extends NamedActionCardRepositoryError {}
export class ActionCardMessageInsertFailedError extends NamedActionCardRepositoryError {}

// 分析窗口上限——conversation-observer worker 的 DEFAULT_MAX_MESSAGES_PER_ANALYSIS 必须 ≤ 它
// (跨层一致性在 worker 测试里有对齐断言;此前 worker 写 200 被真 key 冒烟逮到)。
export const ACTION_CARD_ANALYSIS_LIMIT_MAX = 100;

function assertLimit(limit: number, max = ACTION_CARD_ANALYSIS_LIMIT_MAX) {
  if (!Number.isInteger(limit) || limit < 1 || limit > max) {
    throw new ActionCardRepositoryInputError(`limit must be an integer from 1 through ${max}`);
  }
}

// ── 观察者候选扫描 ──────────────────────────────────────────────────────────────────────

export type ObserverCandidateRow = {
  conversationId: string;
  projectId: string;
  workspaceId: string;
  nextSeq: number;
  lastAnalyzedSeq: number;
  activeCardId: string | null;
  consecutiveFailures: number;
  silenceWindowSecs: number;
  // 原样透出 project_ai_governance.quiet_hours_json；调用方（worker）自行按 aiQuietHoursSchema 校验/降级，
  // 仓库层不对安静时段做时区语义判断（那是纯函数关注点，不属于 SQL 查询层）。
  quietHoursJson: Record<string, unknown>;
  lastMessageAt: Date;
};

export type ListObserverCandidatesInput = {
  now: Date;
  limit: number;
};

export function createActionCardRepository(db: WorkHubDb) {
  const lastMessageAtSelection = sql<Date>`(
    select max(${conversationMessages.createdAt})
    from ${conversationMessages}
    where ${conversationMessages.conversationId} = ${projectConversations.id}
  )`;

  const silenceElapsedCondition = (now: Date) => sql`(
    extract(epoch from (${now}::timestamptz - ${lastMessageAtSelection})) >=
    coalesce(${projectAiGovernance.silenceWindowSecs}, ${DEFAULT_SILENCE_WINDOW_SECS})
  )`;

  return {
    // ── 观察者水位线 ──────────────────────────────────────────────────────────────────

    async findObserverState(conversationId: string): Promise<ObserverStateRow | null> {
      const [row] = await db
        .select()
        .from(conversationObserverState)
        .where(eq(conversationObserverState.conversationId, conversationId))
        .limit(1);
      return row ?? null;
    },

    // 观察者 tick 用的候选扫描：观察开启(缺行按默认 true) && 有新消息(next_seq > 水位线) &&
    // 最近一条消息距今 >= 静默窗口 && 项目活跃未删除。结果按最近消息时间倒序，带硬上限。
    // 安静时段过滤留给调用方（时区语义是纯函数关注点，不塞进这条 SQL）。
    async listObserverCandidates(input: ListObserverCandidatesInput): Promise<ObserverCandidateRow[]> {
      assertLimit(input.limit, OBSERVER_CANDIDATE_HARD_CAP);
      const rows = await db
        .select({
          conversationId: projectConversations.id,
          projectId: projectConversations.projectId,
          workspaceId: projectConversations.workspaceId,
          nextSeq: projectConversations.nextSeq,
          lastAnalyzedSeq: sql<number>`coalesce(${conversationObserverState.lastAnalyzedSeq}, 0)`.mapWith(Number),
          activeCardId: conversationObserverState.activeCardId,
          consecutiveFailures: sql<number>`coalesce(${conversationObserverState.consecutiveFailures}, 0)`.mapWith(Number),
          silenceWindowSecs: sql<number>`coalesce(${projectAiGovernance.silenceWindowSecs}, ${DEFAULT_SILENCE_WINDOW_SECS})`.mapWith(Number),
          quietHoursJson: sql<Record<string, unknown>>`coalesce(${projectAiGovernance.quietHoursJson}, '{"enabled":false}'::jsonb)`,
          lastMessageAt: lastMessageAtSelection
        })
        .from(projectConversations)
        .innerJoin(
          projects,
          and(
            eq(projects.id, projectConversations.projectId),
            eq(projects.workspaceId, projectConversations.workspaceId)
          )
        )
        .leftJoin(projectAiGovernance, eq(projectAiGovernance.projectId, projectConversations.projectId))
        .leftJoin(
          conversationObserverState,
          eq(conversationObserverState.conversationId, projectConversations.id)
        )
        .where(
          and(
            eq(projectConversations.kind, "main"),
            isNull(projectConversations.deletedAt),
            eq(projects.archived, false),
            isNull(projects.deletedAt),
            // 缺 governance 行按 DEFAULT_PROJECT_AI_GOVERNANCE.observer_enabled=true 处理。
            sql`coalesce(${projectAiGovernance.observerEnabled}, true) = true`,
            sql`${projectConversations.nextSeq} > coalesce(${conversationObserverState.lastAnalyzedSeq}, 0)`,
            silenceElapsedCondition(input.now)
          )
        )
        .orderBy(asc(projectConversations.id))
        .limit(input.limit);
      return rows.filter((row): row is ObserverCandidateRow => row.lastMessageAt != null);
    },

    // ── 分析输入（水位线以来的增量消息） ──────────────────────────────────────────────────

    async listMessagesForAnalysis(input: {
      workspaceId: string;
      projectId: string;
      conversationId: string;
      afterSeq: number;
      limit: number;
    }): Promise<ActionCardConversationMessageRow[]> {
      assertLimit(input.limit);
      if (!Number.isSafeInteger(input.afterSeq) || input.afterSeq < 0) {
        throw new ActionCardRepositoryInputError("afterSeq must be a non-negative safe integer");
      }
      const rows = await db
        .select({ message: conversationMessages })
        .from(conversationMessages)
        .innerJoin(
          projectConversations,
          and(
            eq(projectConversations.id, conversationMessages.conversationId),
            eq(projectConversations.workspaceId, input.workspaceId),
            eq(projectConversations.projectId, input.projectId)
          )
        )
        .where(
          and(
            eq(conversationMessages.conversationId, input.conversationId),
            sql`${conversationMessages.seq} > ${input.afterSeq}`
          )
        )
        .orderBy(asc(conversationMessages.seq))
        .limit(input.limit);
      return rows.map((row) => row.message);
    },

    // ── 建卡 / 追加 ──────────────────────────────────────────────────────────────────

    async createOrAppendCard(input: UpsertCardInput): Promise<UpsertCardResult> {
      if (input.items.length === 0) {
        throw new ActionCardRepositoryInputError("createOrAppendCard requires at least one item");
      }
      if (!Number.isSafeInteger(input.analyzedToSeq) || input.analyzedToSeq < 0) {
        throw new ActionCardRepositoryInputError("analyzedToSeq must be a non-negative safe integer");
      }
      const at = input.at ?? new Date();

      return db.transaction(async (tx) => {
        const [conversation] = await tx
          .select({
            id: projectConversations.id,
            nextSeq: projectConversations.nextSeq
          })
          .from(projectConversations)
          .where(
            and(
              eq(projectConversations.id, input.conversationId),
              eq(projectConversations.workspaceId, input.workspaceId),
              eq(projectConversations.projectId, input.projectId),
              eq(projectConversations.kind, "main"),
              isNull(projectConversations.deletedAt)
            )
          )
          .for("update", { of: projectConversations })
          .limit(1);
        if (!conversation) {
          throw new ActionCardConversationNotFoundError("conversation is not an active main conversation in this project");
        }

        const [state] = await tx
          .select()
          .from(conversationObserverState)
          .where(eq(conversationObserverState.conversationId, input.conversationId))
          .for("update", { of: conversationObserverState })
          .limit(1);

        let activeCard: ActionCardRow | null = null;
        if (state?.activeCardId) {
          const [card] = await tx
            .select()
            .from(actionCards)
            .where(
              and(
                eq(actionCards.id, state.activeCardId),
                eq(actionCards.conversationId, input.conversationId),
                eq(actionCards.status, "active"),
                // R15 批 D4：观察者只认领/追加 observer 卡——系统卡（ddl-chase 找人等）永不进观察者的
                // activeCardId 状态机（insertSystemCard 也从不写 conversation_observer_state），这里再加一
                // 道显式围栏，防止任何路径把 active_card_id 指到系统卡后观察者误把新条目追加进去。
                eq(actionCards.origin, "observer")
              )
            )
            .for("update", { of: actionCards })
            .limit(1);
          activeCard = card ?? null;
        }

        if (activeCard) {
          return appendToCard(tx, input, activeCard, at);
        }
        return createNewCard(tx, input, conversation.nextSeq, at);
      });
    },

    // ── 系统行动卡插入（D4a：非观察者路径，绝不碰水位线/activeCardId） ────────────────────────
    //
    // 服务端规则（ddl-chase 找人等）在项目 main 会话直接插一张 origin='system' 的行动卡：分配一个消息
    // seq、写 action_card 消息 + action_cards 行（analyzed_to_seq 置 NULL）+ 条目，全程【不触碰
    // conversation_observer_state】——不设 activeCardId、不推 last_analyzed_seq。因此它既不污染观察者的
    // 水位线（观察者下个 tick 照常从自己的 last_analyzed_seq 起分析、认领自己的 observer active card），
    // 也不撞观察者条目 id 的确定性派生（系统卡条目用随机 id，不走 deriveActionCardItemId）。与观察者卡在
    // 同一会话可并存。幂等由调用方（ProactiveIntent 的 suppression_key）在上游保证——本方法每调用一次插一张。
    async insertSystemCard(input: InsertSystemCardInput): Promise<InsertSystemCardResult> {
      if (input.items.length === 0) {
        throw new ActionCardRepositoryInputError("insertSystemCard requires at least one item");
      }
      const at = input.at ?? new Date();

      return db.transaction(async (tx) => {
        const [conversation] = await tx
          .select({ id: projectConversations.id, nextSeq: projectConversations.nextSeq })
          .from(projectConversations)
          .where(
            and(
              eq(projectConversations.id, input.conversationId),
              eq(projectConversations.workspaceId, input.workspaceId),
              eq(projectConversations.projectId, input.projectId),
              eq(projectConversations.kind, "main"),
              isNull(projectConversations.deletedAt)
            )
          )
          .for("update", { of: projectConversations })
          .limit(1);
        if (!conversation) {
          throw new ActionCardConversationNotFoundError("conversation is not an active main conversation in this project");
        }

        const currentSeq = conversation.nextSeq;
        const [allocation] = await tx
          .update(projectConversations)
          .set({ nextSeq: sql<number>`${projectConversations.nextSeq} + 1`, updatedAt: at })
          .where(
            and(
              eq(projectConversations.id, input.conversationId),
              eq(projectConversations.nextSeq, currentSeq),
              isNull(projectConversations.deletedAt)
            )
          )
          .returning({ nextSeq: projectConversations.nextSeq });
        const nextSeq = allocation?.nextSeq;
        if (!Number.isSafeInteger(nextSeq) || nextSeq !== currentSeq + 1) {
          throw new ActionCardSequenceAllocationError("system-card message sequence update returned no exact next sequence");
        }

        const cardId = input.cardId ?? randomUUID();
        const messageId = input.cardMessageId ?? randomUUID();
        const preparedItems = input.items.map((item) => ({ ...item, id: item.id ?? randomUUID() }));
        const contentJson: Record<string, unknown> = {
          ...buildActionCardMessageContent(
            cardId,
            preparedItems.map((item) => ({
              id: item.id,
              kind: item.kind,
              titleMd: item.titleMd,
              confidence: item.confidence,
              status: item.status,
              assigneeUserId: item.assigneeUserId ?? null,
              undoDeadlineAt: item.undoDeadlineAt ?? null
            }))
          ),
          // D4a：审计溯源——把上游 ProactiveIntent 的 id 挂在消息内容里（additive 字段，与
          // proactive-cuu-delivery 的 conversation_message content 同款做法）。
          ...(input.messageContentExtra ?? {})
        };

        const [insertedMessage] = await tx
          .insert(conversationMessages)
          .values({
            id: messageId,
            conversationId: input.conversationId,
            seq: nextSeq,
            senderType: "cuu",
            senderUserId: null,
            kind: "action_card",
            contentJson,
            createdAt: at
          })
          .returning();
        if (!insertedMessage) {
          throw new ActionCardMessageInsertFailedError("system-card message insert returned no row");
        }

        const [insertedCard] = await tx
          .insert(actionCards)
          .values({
            id: cardId,
            conversationId: input.conversationId,
            messageId,
            status: "active",
            origin: "system",
            // 系统卡不挂水位线。
            analyzedToSeq: null,
            createdAt: at,
            updatedAt: at
          })
          .returning();
        if (!insertedCard) {
          throw new ActionCardInsertFailedError("system-card insert returned no row");
        }

        const itemRows = preparedItems.map((item, index) =>
          itemInsertValues(
            item,
            { workspaceId: input.workspaceId, projectId: input.projectId, conversationId: input.conversationId, actionCardId: cardId },
            index,
            at
          )
        );
        const insertedItems = await tx.insert(actionCardItems).values(itemRows).returning();
        if (insertedItems.length !== itemRows.length) {
          throw new ActionCardInsertFailedError("system-card item insert returned an incomplete set");
        }

        return { card: insertedCard, items: insertedItems, message: insertedMessage };
      });
    },

    // ── 失败静默计数 ──────────────────────────────────────────────────────────────────

    async recordAnalysisFailure(input: { conversationId: string; at?: Date }): Promise<ObserverStateRow> {
      const at = input.at ?? new Date();
      const [row] = await db
        .insert(conversationObserverState)
        .values({
          conversationId: input.conversationId,
          lastAnalyzedSeq: 0,
          activeCardId: null,
          consecutiveFailures: 1,
          updatedAt: at
        })
        .onConflictDoUpdate({
          target: conversationObserverState.conversationId,
          set: {
            consecutiveFailures: sql`${conversationObserverState.consecutiveFailures} + 1`,
            updatedAt: at
          }
        })
        .returning();
      if (!row) {
        throw new ActionCardInsertFailedError("observer failure counter upsert returned no row");
      }
      return row;
    },

    // 低质分析结果（空 items/全 observe）不建卡，但水位线仍要推进——否则下一 tick 会对同一段
    // 已经判过"没活儿"的讨论重复分析。只推水位线+清失败计数，不碰 active_card_id。
    async advanceWatermark(input: { conversationId: string; analyzedToSeq: number; at?: Date }): Promise<ObserverStateRow> {
      if (!Number.isSafeInteger(input.analyzedToSeq) || input.analyzedToSeq < 0) {
        throw new ActionCardRepositoryInputError("analyzedToSeq must be a non-negative safe integer");
      }
      const at = input.at ?? new Date();
      const [row] = await db
        .insert(conversationObserverState)
        .values({
          conversationId: input.conversationId,
          lastAnalyzedSeq: input.analyzedToSeq,
          activeCardId: null,
          consecutiveFailures: 0,
          updatedAt: at
        })
        .onConflictDoUpdate({
          target: conversationObserverState.conversationId,
          set: {
            lastAnalyzedSeq: input.analyzedToSeq,
            consecutiveFailures: 0,
            updatedAt: at
          }
        })
        .returning();
      if (!row) {
        throw new ActionCardInsertFailedError("observer watermark upsert returned no row");
      }
      return row;
    },

    // 观察者 prompt 里给每条消息标发言人昵称；批量按 id 解析，带上限防误传超大数组。
    async listNicknamesByUserIds(userIds: string[]): Promise<Map<string, string>> {
      const unique = [...new Set(userIds)];
      if (unique.length === 0) {
        return new Map();
      }
      if (unique.length > 100) {
        throw new ActionCardRepositoryInputError("listNicknamesByUserIds accepts at most 100 ids per call");
      }
      const rows = await db
        .select({ id: users.id, nickname: users.nickname })
        .from(users)
        .where(inArray(users.id, unique));
      return new Map(rows.map((row) => [row.id, row.nickname]));
    },

    // ── 行动卡条目：路由层用 ──────────────────────────────────────────────────────────

    async findItemForActor(input: { itemId: string; workspaceId: string }): Promise<ActionCardItemAccessRecord | null> {
      const [row] = await db
        .select({
          item: actionCardItems,
          card: actionCards
        })
        .from(actionCardItems)
        .innerJoin(actionCards, eq(actionCards.id, actionCardItems.actionCardId))
        .where(
          and(
            eq(actionCardItems.id, input.itemId),
            eq(actionCardItems.workspaceId, input.workspaceId)
          )
        )
        .limit(1);
      return row ?? null;
    },

    async transitionItemStatus(input: TransitionItemStatusInput): Promise<ActionCardItemRow | null> {
      if (input.fromStatuses.length === 0) {
        throw new ActionCardRepositoryInputError("transitionItemStatus requires at least one source status");
      }
      const at = input.at ?? new Date();
      const [row] = await db
        .update(actionCardItems)
        .set({
          status: input.toStatus,
          updatedAt: at,
          ...(input.assigneeUserId !== undefined ? { assigneeUserId: input.assigneeUserId } : {}),
          ...(input.workItemId !== undefined ? { workItemId: input.workItemId } : {}),
          ...(input.runId !== undefined ? { runId: input.runId } : {}),
          ...(input.undoDeadlineAt !== undefined ? { undoDeadlineAt: input.undoDeadlineAt } : {})
        })
        .where(
          and(
            eq(actionCardItems.id, input.itemId),
            eq(actionCardItems.workspaceId, input.workspaceId),
            inArray(actionCardItems.status, input.fromStatuses)
          )
        )
        .returning();
      return row ?? null;
    },

    async listCardsForConversation(input: {
      workspaceId: string;
      conversationId: string;
      limit: number;
    }): Promise<ActionCardWithItemsRow[]> {
      assertLimit(input.limit);
      const cardRows = await db
        .select()
        .from(actionCards)
        .where(eq(actionCards.conversationId, input.conversationId))
        .orderBy(asc(actionCards.createdAt))
        .limit(input.limit);
      if (cardRows.length === 0) {
        return [];
      }
      const cardIds = cardRows.map((card) => card.id);
      const itemRows = await db
        .select()
        .from(actionCardItems)
        .where(
          and(
            eq(actionCardItems.workspaceId, input.workspaceId),
            inArray(actionCardItems.actionCardId, cardIds)
          )
        )
        .orderBy(asc(actionCardItems.ordinal))
        .limit(CARD_ITEMS_READ_CAP);
      return cardRows.map((card) => ({
        card,
        items: itemRows.filter((item) => item.actionCardId === card.id)
      }));
    },

    // ── @ 提及负责人 / 撤销 / 改派留痕：系统消息（进线程，不占主流） ────────────────────────

    async postSystemMessage(input: PostSystemMessageInput): Promise<ActionCardConversationMessageRow> {
      const at = input.at ?? new Date();
      return db.transaction(async (tx) => {
        const [conversation] = await tx
          .select({ id: projectConversations.id, nextSeq: projectConversations.nextSeq })
          .from(projectConversations)
          .where(
            and(
              eq(projectConversations.id, input.conversationId),
              eq(projectConversations.workspaceId, input.workspaceId),
              isNull(projectConversations.deletedAt)
            )
          )
          .for("update", { of: projectConversations })
          .limit(1);
        if (!conversation) {
          throw new ActionCardConversationNotFoundError("conversation is not active");
        }
        const currentSeq = conversation.nextSeq;
        const [allocation] = await tx
          .update(projectConversations)
          .set({ nextSeq: sql<number>`${projectConversations.nextSeq} + 1`, updatedAt: at })
          .where(
            and(
              eq(projectConversations.id, input.conversationId),
              eq(projectConversations.nextSeq, currentSeq)
            )
          )
          .returning({ nextSeq: projectConversations.nextSeq });
        const nextSeq = allocation?.nextSeq;
        if (!Number.isSafeInteger(nextSeq) || nextSeq !== currentSeq + 1) {
          throw new ActionCardSequenceAllocationError("system-message sequence update returned no exact next sequence");
        }
        const [created] = await tx
          .insert(conversationMessages)
          .values({
            id: randomUUID(),
            conversationId: input.conversationId,
            seq: nextSeq,
            senderType: input.senderType,
            senderUserId: null,
            kind: "system_event",
            contentJson: input.content,
            ...(input.threadRootId ? { threadRootId: input.threadRootId } : {}),
            createdAt: at
          })
          .returning();
        if (!created) {
          throw new ActionCardMessageInsertFailedError("system-event message insert returned no row");
        }
        return created;
      });
    },

    // ── 受派人解析 ──────────────────────────────────────────────────────────────────

    async resolveAssigneeByNickname(input: {
      workspaceId: string;
      nickname: string;
    }): Promise<{ userId: string; nickname: string } | null> {
      const trimmed = input.nickname.trim();
      if (trimmed.length === 0) {
        return null;
      }
      const [row] = await db
        .select({ userId: users.id, nickname: users.nickname })
        .from(workspaceMemberships)
        .innerJoin(users, eq(users.id, workspaceMemberships.userId))
        .where(
          and(
            eq(workspaceMemberships.workspaceId, input.workspaceId),
            isNull(workspaceMemberships.deletedAt),
            isNull(users.deletedAt),
            sql`lower(${users.nickname}) = lower(${trimmed})`
          )
        )
        .limit(1);
      return row ?? null;
    },

    async isActiveWorkspaceMember(input: { workspaceId: string; userId: string }): Promise<boolean> {
      const [row] = await db
        .select({ id: workspaceMemberships.id })
        .from(workspaceMemberships)
        .where(
          and(
            eq(workspaceMemberships.workspaceId, input.workspaceId),
            eq(workspaceMemberships.userId, input.userId),
            isNull(workspaceMemberships.deletedAt)
          )
        )
        .limit(1);
      return Boolean(row);
    }
  };
}

export type ActionCardRepository = ReturnType<typeof createActionCardRepository>;

// ── 建卡/追加的共享类型与内部实现 ──────────────────────────────────────────────────────

export type PlanItemInput = {
  id?: string;
  kind: ActionCardItemKind;
  titleMd: string;
  confidence: ActionCardItemConfidence;
  assigneeUserId?: string | null;
  workItemId?: string | null;
  runId?: string | null;
  status: ActionCardItemStatus;
  undoDeadlineAt?: Date | null;
};

export type UpsertCardInput = {
  workspaceId: string;
  projectId: string;
  conversationId: string;
  analyzedToSeq: number;
  items: PlanItemInput[];
  at?: Date;
  cardId?: string;
  cardMessageId?: string;
};

export type UpsertCardResult = {
  card: ActionCardRow;
  items: ActionCardItemRow[];
  appended: boolean;
  message: ActionCardConversationMessageRow;
};

// D4a：系统行动卡插入入参。与 UpsertCardInput 的差异：无 analyzedToSeq（系统卡不挂水位线），加一个
// 可选 messageContentExtra 用于把 ProactiveIntent id 等审计字段并进消息 content_json。
export type InsertSystemCardInput = {
  workspaceId: string;
  projectId: string;
  conversationId: string;
  items: PlanItemInput[];
  at?: Date;
  cardId?: string;
  cardMessageId?: string;
  messageContentExtra?: Record<string, unknown>;
};

export type InsertSystemCardResult = {
  card: ActionCardRow;
  items: ActionCardItemRow[];
  message: ActionCardConversationMessageRow;
};

export type ActionCardItemAccessRecord = {
  item: ActionCardItemRow;
  card: ActionCardRow;
};

export type TransitionItemStatusInput = {
  itemId: string;
  workspaceId: string;
  fromStatuses: ActionCardItemStatus[];
  toStatus: ActionCardItemStatus;
  assigneeUserId?: string | null;
  workItemId?: string | null;
  runId?: string | null;
  undoDeadlineAt?: Date | null;
  at?: Date;
};

export type ActionCardWithItemsRow = {
  card: ActionCardRow;
  items: ActionCardItemRow[];
};

export type PostSystemMessageInput = {
  workspaceId: string;
  conversationId: string;
  senderType: "system" | "cuu";
  content: Record<string, unknown>;
  threadRootId?: string;
  at?: Date;
};

// R12 P0-A1：消息内容里的条目摘要是发给桌面客户端渲染操作按钮用的 bounded 松对象（不是 SSE 事件的
// strict schema，SSE 契约的 items 形状不动）——增补 assignee_user_id/undo_deadline_at 两个只增字段，
// 让前端不必再为了拿这两个值单独打一次 GET。
function itemSummary(row: {
  id: string;
  kind: string;
  titleMd: string;
  confidence: string;
  status: string;
  assigneeUserId?: string | null;
  undoDeadlineAt?: Date | null;
}) {
  return {
    id: row.id,
    kind: row.kind,
    title_md: row.titleMd,
    confidence: row.confidence,
    status: row.status,
    assignee_user_id: row.assigneeUserId ?? null,
    undo_deadline_at: row.undoDeadlineAt ? row.undoDeadlineAt.toISOString() : null
  };
}

function buildActionCardMessageContent(
  cardId: string,
  items: ReadonlyArray<{
    id: string;
    kind: string;
    titleMd: string;
    confidence: string;
    status: string;
    assigneeUserId?: string | null;
    undoDeadlineAt?: Date | null;
  }>
): Record<string, unknown> {
  return {
    card_id: cardId,
    items: items.slice(0, CARD_ITEMS_READ_CAP).map(itemSummary)
  };
}

function itemInsertValues(
  item: PlanItemInput,
  scope: { workspaceId: string; projectId: string; conversationId: string; actionCardId: string },
  ordinal: number,
  at: Date
) {
  return {
    id: item.id ?? randomUUID(),
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    conversationId: scope.conversationId,
    actionCardId: scope.actionCardId,
    ordinal,
    kind: item.kind,
    titleMd: item.titleMd,
    confidence: item.confidence,
    workItemId: item.workItemId ?? null,
    runId: item.runId ?? null,
    assigneeUserId: item.assigneeUserId ?? null,
    status: item.status,
    undoDeadlineAt: item.undoDeadlineAt ?? null,
    createdAt: at,
    updatedAt: at
  };
}

async function appendToCard(
  tx: WorkHubDb,
  input: UpsertCardInput,
  activeCard: ActionCardRow,
  at: Date
): Promise<UpsertCardResult> {
  const [maxOrdinalRow] = await tx
    .select({ maxOrdinal: sql<number>`coalesce(max(${actionCardItems.ordinal}), -1)`.mapWith(Number) })
    .from(actionCardItems)
    .where(eq(actionCardItems.actionCardId, activeCard.id));
  const startOrdinal = (maxOrdinalRow?.maxOrdinal ?? -1) + 1;

  const itemRows = input.items.map((item, index) =>
    itemInsertValues(
      item,
      { workspaceId: input.workspaceId, projectId: input.projectId, conversationId: input.conversationId, actionCardId: activeCard.id },
      startOrdinal + index,
      at
    )
  );
  const insertedItems = await tx.insert(actionCardItems).values(itemRows).returning();
  if (insertedItems.length !== itemRows.length) {
    throw new ActionCardInsertFailedError("action-card item insert returned an incomplete set");
  }

  const allItems = await tx
    .select()
    .from(actionCardItems)
    .where(eq(actionCardItems.actionCardId, activeCard.id))
    .orderBy(asc(actionCardItems.ordinal))
    .limit(CARD_ITEMS_READ_CAP);
  const contentJson = buildActionCardMessageContent(activeCard.id, allItems);

  const [updatedMessage] = await tx
    .update(conversationMessages)
    .set({ contentJson })
    .where(
      and(
        eq(conversationMessages.id, activeCard.messageId),
        eq(conversationMessages.conversationId, input.conversationId)
      )
    )
    .returning();
  if (!updatedMessage) {
    throw new ActionCardMessageInsertFailedError("action-card message update returned no row");
  }

  const [updatedCard] = await tx
    .update(actionCards)
    .set({ analyzedToSeq: input.analyzedToSeq, updatedAt: at })
    .where(eq(actionCards.id, activeCard.id))
    .returning();
  if (!updatedCard) {
    throw new ActionCardInsertFailedError("action-card watermark update returned no row");
  }

  const [updatedState] = await tx
    .insert(conversationObserverState)
    .values({
      conversationId: input.conversationId,
      lastAnalyzedSeq: input.analyzedToSeq,
      activeCardId: activeCard.id,
      consecutiveFailures: 0,
      updatedAt: at
    })
    .onConflictDoUpdate({
      target: conversationObserverState.conversationId,
      set: {
        lastAnalyzedSeq: input.analyzedToSeq,
        activeCardId: activeCard.id,
        consecutiveFailures: 0,
        updatedAt: at
      }
    })
    .returning();
  if (!updatedState) {
    throw new ActionCardInsertFailedError("observer state upsert returned no row");
  }

  return { card: updatedCard, items: insertedItems, appended: true, message: updatedMessage };
}

async function createNewCard(
  tx: WorkHubDb,
  input: UpsertCardInput,
  currentSeq: number,
  at: Date
): Promise<UpsertCardResult> {
  const [allocation] = await tx
    .update(projectConversations)
    .set({ nextSeq: sql<number>`${projectConversations.nextSeq} + 1`, updatedAt: at })
    .where(
      and(
        eq(projectConversations.id, input.conversationId),
        eq(projectConversations.workspaceId, input.workspaceId),
        eq(projectConversations.projectId, input.projectId),
        eq(projectConversations.nextSeq, currentSeq),
        isNull(projectConversations.deletedAt)
      )
    )
    .returning({ nextSeq: projectConversations.nextSeq });
  const nextSeq = allocation?.nextSeq;
  if (!Number.isSafeInteger(nextSeq) || nextSeq !== currentSeq + 1) {
    throw new ActionCardSequenceAllocationError("action-card message sequence update returned no exact next sequence");
  }

  const cardId = input.cardId ?? randomUUID();
  const messageId = input.cardMessageId ?? randomUUID();
  const preparedItems = input.items.map((item) => ({ ...item, id: item.id ?? randomUUID() }));
  const contentJson = buildActionCardMessageContent(
    cardId,
    preparedItems.map((item) => ({
      id: item.id,
      kind: item.kind,
      titleMd: item.titleMd,
      confidence: item.confidence,
      status: item.status,
      assigneeUserId: item.assigneeUserId ?? null,
      undoDeadlineAt: item.undoDeadlineAt ?? null
    }))
  );

  const [insertedMessage] = await tx
    .insert(conversationMessages)
    .values({
      id: messageId,
      conversationId: input.conversationId,
      seq: nextSeq,
      senderType: "cuu",
      senderUserId: null,
      kind: "action_card",
      contentJson,
      createdAt: at
    })
    .returning();
  if (!insertedMessage) {
    throw new ActionCardMessageInsertFailedError("action-card message insert returned no row");
  }

  const [insertedCard] = await tx
    .insert(actionCards)
    .values({
      id: cardId,
      conversationId: input.conversationId,
      messageId,
      status: "active",
      analyzedToSeq: input.analyzedToSeq,
      createdAt: at,
      updatedAt: at
    })
    .returning();
  if (!insertedCard) {
    throw new ActionCardInsertFailedError("action-card insert returned no row");
  }

  const itemRows = preparedItems.map((item, index) =>
    itemInsertValues(
      item,
      { workspaceId: input.workspaceId, projectId: input.projectId, conversationId: input.conversationId, actionCardId: cardId },
      index,
      at
    )
  );
  const insertedItems = await tx.insert(actionCardItems).values(itemRows).returning();
  if (insertedItems.length !== itemRows.length) {
    throw new ActionCardInsertFailedError("action-card item insert returned an incomplete set");
  }

  const [upsertedState] = await tx
    .insert(conversationObserverState)
    .values({
      conversationId: input.conversationId,
      lastAnalyzedSeq: input.analyzedToSeq,
      activeCardId: cardId,
      consecutiveFailures: 0,
      updatedAt: at
    })
    .onConflictDoUpdate({
      target: conversationObserverState.conversationId,
      set: {
        lastAnalyzedSeq: input.analyzedToSeq,
        activeCardId: cardId,
        consecutiveFailures: 0,
        updatedAt: at
      }
    })
    .returning();
  if (!upsertedState) {
    throw new ActionCardInsertFailedError("observer state upsert returned no row");
  }

  return { card: insertedCard, items: insertedItems, appended: false, message: insertedMessage };
}
