import {
  createActionCardRepository,
  getSharedDatabaseClient,
  listActivePendingDigestCards,
  listProjectsWithPendingApprovals,
  tombstonePendingDigestCard,
  type PendingApprovalDigestRow,
  type PendingDigestCardRow
} from "@workhub/db";

import { getDefaultStructuredLogger, type StructuredLogger } from "../logging.js";

// R15 批 A（A3 会话 digest 卡，见 r15-proactive-upgrade/01-batch-a-pipeline.md §A3）：pulse 的 approval-digest
// 任务主体。每个项目 main 会话里维护【至多一张】「待你拍板 N 件，最久 X 天」的 digest 卡。
//
// ── 置底/更新机制的取舍（收窄版，务必读懂再改）──────────────────────────────────────────
// 想要的是「数字变化时原地更新那张卡并重新置底，绝不每 tick 刷屏」。但 conversation_messages 的 seq 是
// 插入即分配、不可变的 append-only 序（(conversation_id, seq) 唯一、读游标/翻页/未读全建立在它单调之上）。
// 「原地把 seq 顶到最新」= 改一条既有消息的 seq，破坏这条全仓假设的不变量（见 01 设计对此的明确警告）。
// 因此采用设计许可的收窄：**数字变化时墓碑旧卡 + 发一张新卡**（新卡天然拿到最大 seq → 自然重新置底；
// payload 里 previous_digest_message_id 链上前一张，保留痕迹）。代价：每次「数字真的变了」会在历史里留
// 一条空墓碑——但有「数字没变就一动不动」这道门兜底，绝不每 tick 刷屏，墓碑只在真实变化时才产生。
//   * 数字没变          → 什么都不做（no-op）。
//   * 数字变了 / 首次    → 墓碑旧卡（若有）+ 发新卡。
//   * 归零（pending=0）  → 墓碑现存卡，不发新卡。

const DEFAULT_MAX_PROJECTS_PER_TICK = 200;
// 一 tick 扫多少张现存活卡（用于归零收尾 + 重复卡清理）——与项目候选同档的安全网上限。
const DEFAULT_MAX_CARDS_PER_TICK = 500;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export type ApprovalDigestPostSystemMessageInput = {
  workspaceId: string;
  conversationId: string;
  senderType: "cuu";
  content: Record<string, unknown>;
  at?: Date;
};

export type ApprovalDigestRepositoryDeps = {
  listProjectsWithPendingApprovals: (input: { limit: number }) => Promise<PendingApprovalDigestRow[]>;
  listActivePendingDigestCards: (input: { limit: number }) => Promise<PendingDigestCardRow[]>;
  tombstonePendingDigestCard: (input: { conversationId: string; messageId: string; at: Date }) => Promise<boolean>;
};

export type ApprovalDigestServiceDeps = {
  repository: ApprovalDigestRepositoryDeps;
  postSystemMessage: (input: ApprovalDigestPostSystemMessageInput) => Promise<unknown>;
  now?: () => Date;
  logger?: Pick<StructuredLogger, "warn">;
  maxProjectsPerTick?: number;
  maxCardsPerTick?: number;
};

export type ApprovalDigestRunResult = {
  scanned: number; // 有待办审批的候选项目数
  posted: number; // 首次为某项目发出 digest 卡
  updated: number; // 数字变化 → 墓碑旧卡 + 发新卡
  unchanged: number; // 数字没变 → 一动不动
  zeroed: number; // 归零 → 墓碑现存卡、不发新卡
  duplicates_tombstoned: number; // 同一会话残留的重复活卡（防御性清理）
  failed: number;
  started_at: string;
  finished_at: string;
};

// §A3 文案：确定性模板拼接（非 LLM）。X=0（今天刚提的）不显示「最久」子句。
export function buildPendingDigestContent(input: {
  projectId: string;
  pendingCount: number;
  oldestDays: number;
  previousDigestMessageId?: string;
}): Record<string, unknown> {
  const oldestClause = input.oldestDays > 0 ? `，最久 ${input.oldestDays} 天` : "";
  return {
    kind: "pending_digest",
    pending_count: input.pendingCount,
    oldest_days: input.oldestDays,
    summary: `待你拍板 ${input.pendingCount} 件${oldestClause}`,
    target_url: "/approvals",
    ...(input.previousDigestMessageId ? { previous_digest_message_id: input.previousDigestMessageId } : {})
  };
}

export function createApprovalDigestService(deps: ApprovalDigestServiceDeps): { runOnce(): Promise<ApprovalDigestRunResult> } {
  const now = deps.now ?? (() => new Date());
  const logger = deps.logger ?? getDefaultStructuredLogger();
  const maxProjectsPerTick = deps.maxProjectsPerTick ?? DEFAULT_MAX_PROJECTS_PER_TICK;
  const maxCardsPerTick = deps.maxCardsPerTick ?? DEFAULT_MAX_CARDS_PER_TICK;

  return {
    async runOnce(): Promise<ApprovalDigestRunResult> {
      const startedAt = now();
      const result = {
        scanned: 0,
        posted: 0,
        updated: 0,
        unchanged: 0,
        zeroed: 0,
        duplicates_tombstoned: 0,
        failed: 0
      };

      const [candidates, cards] = await Promise.all([
        deps.repository.listProjectsWithPendingApprovals({ limit: maxProjectsPerTick }),
        deps.repository.listActivePendingDigestCards({ limit: maxCardsPerTick })
      ]);
      result.scanned = candidates.length;

      // 每会话取最新一张为「当前卡」，其余当重复卡（应当不出现——每次都墓碑再发；防御性清理）。
      const currentCardByConversation = new Map<string, PendingDigestCardRow>();
      const duplicateCards: PendingDigestCardRow[] = [];
      // 查询已按 (conversation_id, seq desc) 排序——每会话第一条即最新。
      for (const card of cards) {
        if (currentCardByConversation.has(card.conversationId)) {
          duplicateCards.push(card);
        } else {
          currentCardByConversation.set(card.conversationId, card);
        }
      }

      const tombstone = async (card: PendingDigestCardRow): Promise<void> => {
        try {
          await deps.repository.tombstonePendingDigestCard({
            conversationId: card.conversationId,
            messageId: card.messageId,
            at: startedAt
          });
        } catch (error) {
          logger.warn?.("approval_digest_tombstone_failed", { conversationId: card.conversationId, error });
        }
      };

      // 重复卡先清掉（不影响对账结果，纯卫生）。
      for (const duplicate of duplicateCards) {
        await tombstone(duplicate);
        result.duplicates_tombstoned += 1;
      }

      const seenConversations = new Set<string>();
      for (const candidate of candidates) {
        try {
          const conversationId = candidate.mainConversationId;
          seenConversations.add(conversationId);
          const current = currentCardByConversation.get(conversationId);
          // 数字没变 → 一动不动（绝不每 tick 刷屏的核心门）。
          if (current && current.storedCount === candidate.pendingCount) {
            result.unchanged += 1;
            continue;
          }
          // 数字变了 / 首次：先墓碑旧卡（若有），再发一张新卡（链上前一张 id、天然重新置底）。
          if (current) {
            await tombstone(current);
          }
          const oldestDays = Math.max(0, Math.floor((startedAt.getTime() - candidate.oldestPendingAt.getTime()) / ONE_DAY_MS));
          await deps.postSystemMessage({
            workspaceId: candidate.workspaceId,
            conversationId,
            senderType: "cuu",
            content: buildPendingDigestContent({
              projectId: candidate.projectId,
              pendingCount: candidate.pendingCount,
              oldestDays,
              ...(current ? { previousDigestMessageId: current.messageId } : {})
            }),
            at: startedAt
          });
          if (current) {
            result.updated += 1;
          } else {
            result.posted += 1;
          }
        } catch (error) {
          result.failed += 1;
          logger.warn?.("approval_digest_candidate_failed", { projectId: candidate.projectId, error });
        }
      }

      // 归零收尾：现存卡所在会话本 tick 没有任何待办审批候选 → pending 已降到 0 → 墓碑现存卡、不发新卡。
      for (const [conversationId, card] of currentCardByConversation) {
        if (seenConversations.has(conversationId)) {
          continue;
        }
        await tombstone(card);
        result.zeroed += 1;
      }

      return { ...result, started_at: startedAt.toISOString(), finished_at: now().toISOString() };
    }
  };
}

let defaultApprovalDigestService: ReturnType<typeof createApprovalDigestService> | undefined;

export function getDefaultApprovalDigestService(): ReturnType<typeof createApprovalDigestService> {
  if (!defaultApprovalDigestService) {
    const db = getSharedDatabaseClient().db;
    const actionCards = createActionCardRepository(db);
    defaultApprovalDigestService = createApprovalDigestService({
      repository: {
        listProjectsWithPendingApprovals: (input) => listProjectsWithPendingApprovals(db, input),
        listActivePendingDigestCards: (input) => listActivePendingDigestCards(db, input),
        tombstonePendingDigestCard: (input) => tombstonePendingDigestCard(db, input)
      },
      // digest 卡也是 Cuu 往 main 会话落的一条 system_event（同 risk-monitor 的风险 digest 播报）。
      postSystemMessage: (input) => actionCards.postSystemMessage(input)
    });
  }
  return defaultApprovalDigestService;
}
