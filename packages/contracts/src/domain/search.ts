import { z } from "zod";

import { idSchema, isoDateTimeSchema } from "./common.js";

// R14 批 SEARCH（全局搜索）：GET /api/search 的请求 + 响应 VM 契约。独立域文件而非塞进 conversation.ts /
// work-item.ts——搜索是「跨会话·网盘·工单·会议」的横切聚合面，不属于任何一个既有领域（照 02-search-design.md §4
// 的拍板：搜索契约新文件 packages/contracts/src/domain/search.ts，不与会话/工单域混写，呼应 CHAT 批 presence
// 契约单开的先例）。四 scope 恒按固定顺序输出，每 scope 各自 has_more（逐 scope limit，非全局 cap）。

export const searchScopeSchema = z.enum(["conversations", "drive", "work_items", "meetings"]);
export type SearchScope = z.infer<typeof searchScopeSchema>;

// 固定 scope 输出顺序——服务端组装 groups 时恒按此序，客户端分组渲染依赖它稳定。
export const SEARCH_SCOPE_ORDER: readonly SearchScope[] = [
  "conversations",
  "drive",
  "work_items",
  "meetings"
];

// matched_in：命中在哪一列（客户端可标「命中于文件名 / 正文 / 标题 / 描述 / 纪要」）。
export const searchMatchedInSchema = z.enum([
  "name",
  "body",
  "title",
  "description",
  "text",
  "minutes"
]);
export type SearchMatchedIn = z.infer<typeof searchMatchedInSchema>;

// ── 请求 ──────────────────────────────────────────────────────────────────────
// 服务端另做人话校验（trim / 2–64 字符 / scopes 枚举子集 / limit 夹紧）并抛 HTTPException(400)，
// 这份 schema 是形状契约与客户端参数构造的单一事实源。
export const SEARCH_QUERY_MIN_LENGTH = 2;
export const SEARCH_QUERY_MAX_LENGTH = 64;
export const SEARCH_LIMIT_MIN = 1;
export const SEARCH_LIMIT_MAX = 25;
export const SEARCH_LIMIT_DEFAULT = 10;

export const searchRequestSchema = z
  .object({
    q: z.string(),
    // 缺省=全四 scope；给了就取枚举子集（未知值丢弃，全非法→400 由服务端处理）。
    scopes: z.array(searchScopeSchema).optional(),
    limit: z.number().int().min(SEARCH_LIMIT_MIN).max(SEARCH_LIMIT_MAX).optional()
  })
  .strict();
export type SearchRequest = z.infer<typeof searchRequestSchema>;

// ── 逐 scope 结果 VM ─────────────────────────────────────────────────────────
// 会话结果带 deep_link（桌面 workbench 深链所需的 project/conversation/seq），其余 scope 客户端按既有
// open()/route 直达，不给 deep_link（见设计 §4/§6）。
export const conversationSearchResultSchema = z
  .object({
    message_id: idSchema,
    conversation_id: idSchema,
    project_id: idSchema,
    project_name: z.string(),
    conversation_title: z.string(),
    seq: z.number().int().nonnegative(),
    sender_type: z.string(),
    // agent/system 发的消息无 sender_user_id → null（客户端按 sender_type 渲 Cuu 标签，不编造用户）。
    sender_user_id: idSchema.nullable(),
    sender_label: z.string().nullable(),
    matched_in: z.literal("text"),
    snippet: z.string(),
    created_at: isoDateTimeSchema,
    deep_link: z
      .object({
        project_id: idSchema,
        conversation_id: idSchema,
        seq: z.number().int().nonnegative()
      })
      .strict()
  })
  .strict();
export type ConversationSearchResult = z.infer<typeof conversationSearchResultSchema>;

export const driveSearchResultSchema = z
  .object({
    item_id: idSchema,
    project_id: idSchema,
    project_name: z.string(),
    name: z.string(),
    kind: z.string(),
    matched_in: z.enum(["name", "body"]),
    snippet: z.string(),
    updated_at: isoDateTimeSchema
  })
  .strict();
export type DriveSearchResult = z.infer<typeof driveSearchResultSchema>;

export const workItemSearchResultSchema = z
  .object({
    work_item_id: idSchema,
    code: z.string(),
    project_id: idSchema,
    project_name: z.string(),
    // work_items.title 可空（intake 早期还没定标题）——命中一定在 description 侧，title 如实给 null。
    title: z.string().nullable(),
    status: z.string(),
    matched_in: z.enum(["title", "description"]),
    snippet: z.string(),
    updated_at: isoDateTimeSchema
  })
  .strict();
export type WorkItemSearchResult = z.infer<typeof workItemSearchResultSchema>;

export const meetingSearchResultSchema = z
  .object({
    meeting_id: idSchema,
    project_id: idSchema,
    project_name: z.string(),
    title: z.string(),
    status: z.string(),
    matched_in: z.enum(["title", "minutes"]),
    snippet: z.string(),
    created_at: isoDateTimeSchema
  })
  .strict();
export type MeetingSearchResult = z.infer<typeof meetingSearchResultSchema>;

// ── 分组 + 顶层响应 ──────────────────────────────────────────────────────────
// 按 scope 判别联合，每组自带 has_more（该 scope 是否还有超出 limit 的命中）。
export const searchGroupSchema = z.discriminatedUnion("scope", [
  z
    .object({
      scope: z.literal("conversations"),
      has_more: z.boolean(),
      results: z.array(conversationSearchResultSchema)
    })
    .strict(),
  z
    .object({
      scope: z.literal("drive"),
      has_more: z.boolean(),
      results: z.array(driveSearchResultSchema)
    })
    .strict(),
  z
    .object({
      scope: z.literal("work_items"),
      has_more: z.boolean(),
      results: z.array(workItemSearchResultSchema)
    })
    .strict(),
  z
    .object({
      scope: z.literal("meetings"),
      has_more: z.boolean(),
      results: z.array(meetingSearchResultSchema)
    })
    .strict()
]);
export type SearchGroup = z.infer<typeof searchGroupSchema>;

export const searchResultsVmSchema = z
  .object({
    query: z.string(),
    // 仅返回**请求的** scope，恒按 SEARCH_SCOPE_ORDER 排序；空组给 results:[]、has_more:false（不脚手架）。
    groups: z.array(searchGroupSchema)
  })
  .strict();
export type SearchResultsVm = z.infer<typeof searchResultsVmSchema>;
