import { randomUUID } from "node:crypto";

import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";

import type { AiFeedbackSubjectType, AiFeedbackVerdict } from "@workhub/contracts";

import type { WorkHubDb } from "../client.js";
import { actionCardItems, aiFeedback, conversationMessages, proposals } from "../schema/index.js";

// R14 批 FEEDBACK：反馈行的对外形状——刻意不含 workspace_id（VM/服务面向的读聚合都以「当前 actor +
// 主体」定位，workspace 只是落盘/curation 的内部围栏列，不外泄）。
export type AiFeedbackRow = {
  id: string;
  subjectType: AiFeedbackSubjectType;
  subjectId: string;
  userId: string;
  verdict: AiFeedbackVerdict;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AiFeedbackUpsertInput = {
  id?: string;
  workspaceId: string;
  subjectType: AiFeedbackSubjectType;
  subjectId: string;
  userId: string;
  verdict: AiFeedbackVerdict;
  note?: string | null;
  at?: Date;
};

export type AiFeedbackSubjectKey = {
  subjectType: AiFeedbackSubjectType;
  subjectId: string;
  userId: string;
};

export type AiFeedbackPositiveCount = {
  subjectType: AiFeedbackSubjectType;
  count: number;
};

export type AiFeedbackRepository = {
  // 幂等 upsert：命中 (subject_type, subject_id, user_id) 唯一约束就覆盖 verdict/note/updated_at
  // （改判不追加新行，见设计 §4.4）。
  upsert: (input: AiFeedbackUpsertInput) => Promise<AiFeedbackRow>;
  // 物理删（幂等）：true=真删了一行，false=本没有（幂等空操作）。
  remove: (input: AiFeedbackSubjectKey) => Promise<boolean>;
  getForSubject: (input: AiFeedbackSubjectKey) => Promise<AiFeedbackRow | null>;
  // 页级批量读——禁 N+1。只回本人（user_id 过滤）的判定，键为 subject_id。
  listForSubjects: (input: {
    subjectType: AiFeedbackSubjectType;
    subjectIds: string[];
    userId: string;
  }) => Promise<Map<string, AiFeedbackRow>>;
  // 夜间 curation 专用（差评样本）：按 workspace 直接查，零 join（workspace_id 冗余列的收益点）。
  negativeSamplesSince: (workspaceId: string, since: Date, limit: number) => Promise<AiFeedbackRow[]>;
  // 夜间 curation 专用（好评强化）：只回 {subjectType, count} 聚合，不取全文（避免 prompt 膨胀）。
  positiveCountsSince: (workspaceId: string, since: Date) => Promise<AiFeedbackPositiveCount[]>;
};

// 对外列选择（剔除 workspace_id）——所有读路径共用，保证返回形状与 AiFeedbackRow 严格对齐。
const feedbackColumns = {
  id: aiFeedback.id,
  subjectType: aiFeedback.subjectType,
  subjectId: aiFeedback.subjectId,
  userId: aiFeedback.userId,
  verdict: aiFeedback.verdict,
  note: aiFeedback.note,
  createdAt: aiFeedback.createdAt,
  updatedAt: aiFeedback.updatedAt
};

// 单主体读聚合上限——防御性 cap（listForSubjects 的入参理论上已被页级读上限约束）。
const MAX_SUBJECT_BATCH = 200;
// 差评样本的绝对上限（调用方传入的 limit 再被这一层夹紧，防越权大页）。
const MAX_NEGATIVE_SAMPLES = 100;

export function createAiFeedbackRepository(db: WorkHubDb): AiFeedbackRepository {
  return {
    async upsert(input) {
      const at = input.at ?? new Date();
      const note = input.note ?? null;
      const rows = await db
        .insert(aiFeedback)
        .values({
          id: input.id ?? randomUUID(),
          workspaceId: input.workspaceId,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          userId: input.userId,
          verdict: input.verdict,
          note,
          createdAt: at,
          updatedAt: at
        })
        .onConflictDoUpdate({
          target: [aiFeedback.subjectType, aiFeedback.subjectId, aiFeedback.userId],
          set: { verdict: input.verdict, note, updatedAt: at }
        })
        .returning(feedbackColumns);
      return rows[0]!;
    },

    async remove(input) {
      const rows = await db
        .delete(aiFeedback)
        .where(
          and(
            eq(aiFeedback.subjectType, input.subjectType),
            eq(aiFeedback.subjectId, input.subjectId),
            eq(aiFeedback.userId, input.userId)
          )
        )
        .returning({ id: aiFeedback.id });
      return rows.length > 0;
    },

    async getForSubject(input) {
      const rows = await db
        .select(feedbackColumns)
        .from(aiFeedback)
        .where(
          and(
            eq(aiFeedback.subjectType, input.subjectType),
            eq(aiFeedback.subjectId, input.subjectId),
            eq(aiFeedback.userId, input.userId)
          )
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async listForSubjects(input) {
      if (input.subjectIds.length === 0) {
        return new Map();
      }
      const unique = [...new Set(input.subjectIds)].slice(0, MAX_SUBJECT_BATCH);
      const rows = await db
        .select(feedbackColumns)
        .from(aiFeedback)
        .where(
          and(
            eq(aiFeedback.subjectType, input.subjectType),
            eq(aiFeedback.userId, input.userId),
            inArray(aiFeedback.subjectId, unique)
          )
        );
      return new Map(rows.map((row) => [row.subjectId, row]));
    },

    async negativeSamplesSince(workspaceId, since, limit) {
      const capped = Math.max(1, Math.min(limit, MAX_NEGATIVE_SAMPLES));
      return db
        .select(feedbackColumns)
        .from(aiFeedback)
        .where(
          and(
            eq(aiFeedback.workspaceId, workspaceId),
            eq(aiFeedback.verdict, "not_useful"),
            gte(aiFeedback.updatedAt, since)
          )
        )
        .orderBy(desc(aiFeedback.updatedAt), desc(aiFeedback.id))
        .limit(capped);
    },

    async positiveCountsSince(workspaceId, since) {
      const rows = await db
        .select({
          subjectType: aiFeedback.subjectType,
          count: sql<number>`count(*)::int`
        })
        .from(aiFeedback)
        .where(
          and(
            eq(aiFeedback.workspaceId, workspaceId),
            eq(aiFeedback.verdict, "useful"),
            gte(aiFeedback.updatedAt, since)
          )
        )
        .groupBy(aiFeedback.subjectType);
      return rows.map((row) => ({
        subjectType: row.subjectType as AiFeedbackSubjectType,
        count: Number(row.count)
      }));
    }
  };
}

// R14 批 FEEDBACK · W-B curation 消费：差评样本的「逐条摘要」批量取正文。刻意与 AiFeedbackRepository
// （读写 ai_feedback 表本身）解耦成独立 reader——它查的是三张主体表（会话消息 / 提议 / 行动卡条目），
// 只为夜间 curation 拼「这条差评具体在说什么」的人话摘要服务（见 04-feedback-design.md §6.1）。三组
// 主体各一条 IN 批量取回，禁 N+1；空集短路不发查询（同 listForSubjects 的守卫口径）。
export type FeedbackSubjectExcerptReader = {
  // 会话消息正文：取 content_json.text；墓碑（deleted_at 置位，正文已清空）或无 text → null，
  // 由 curation 侧渲染成「内容不可用」（Cuu 消息理论上不会被删，见设计 §2，此为防御性判断）。
  conversationMessageTexts: (ids: string[]) => Promise<Map<string, string | null>>;
  proposalTitles: (ids: string[]) => Promise<Map<string, string>>;
  actionCardItemTitles: (ids: string[]) => Promise<Map<string, string>>;
};

// 单组 IN 批量的防御性 cap（调用方传入的 id 集理论上已被 negativeSamplesSince 的样本上限约束）。
const MAX_EXCERPT_BATCH = 100;

export function createFeedbackSubjectExcerptReader(db: WorkHubDb): FeedbackSubjectExcerptReader {
  return {
    async conversationMessageTexts(ids) {
      if (ids.length === 0) {
        return new Map();
      }
      const unique = [...new Set(ids)].slice(0, MAX_EXCERPT_BATCH);
      const rows = await db
        .select({
          id: conversationMessages.id,
          contentJson: conversationMessages.contentJson,
          deletedAt: conversationMessages.deletedAt
        })
        .from(conversationMessages)
        .where(inArray(conversationMessages.id, unique));
      const map = new Map<string, string | null>();
      for (const row of rows) {
        // 墓碑（content_json 已清 {}）→ null；否则取 content_json.text（非字符串 → null）。
        if (row.deletedAt) {
          map.set(row.id, null);
          continue;
        }
        const content = row.contentJson as Record<string, unknown> | null;
        const text = content && typeof content["text"] === "string" ? (content["text"] as string) : null;
        map.set(row.id, text);
      }
      return map;
    },

    async proposalTitles(ids) {
      if (ids.length === 0) {
        return new Map();
      }
      const unique = [...new Set(ids)].slice(0, MAX_EXCERPT_BATCH);
      const rows = await db
        .select({ id: proposals.id, title: proposals.title })
        .from(proposals)
        .where(inArray(proposals.id, unique));
      return new Map(rows.map((row) => [row.id, row.title]));
    },

    async actionCardItemTitles(ids) {
      if (ids.length === 0) {
        return new Map();
      }
      const unique = [...new Set(ids)].slice(0, MAX_EXCERPT_BATCH);
      const rows = await db
        .select({ id: actionCardItems.id, titleMd: actionCardItems.titleMd })
        .from(actionCardItems)
        .where(inArray(actionCardItems.id, unique));
      return new Map(rows.map((row) => [row.id, row.titleMd]));
    }
  };
}
