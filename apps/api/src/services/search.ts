import { HTTPException } from "hono/http-exception";

import {
  SEARCH_LIMIT_DEFAULT,
  SEARCH_LIMIT_MAX,
  SEARCH_LIMIT_MIN,
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_QUERY_MIN_LENGTH,
  SEARCH_SCOPE_ORDER,
  searchResultsVmSchema,
  type ConversationSearchResult,
  type DriveSearchResult,
  type MeetingSearchResult,
  type SearchGroup,
  type SearchResultsVm,
  type SearchScope,
  type WorkItemSearchResult
} from "@workhub/contracts";
import {
  createSearchRepository,
  getSharedDatabaseClient,
  type ConversationSearchRow,
  type DriveSearchRow,
  type MeetingSearchRow,
  type SearchActorScope,
  type SearchRepository,
  type WorkItemSearchRow
} from "@workhub/db";

import type { AuthActor } from "../middleware/auth.js";
import { parseOutputContract } from "../pages/output-contract.js";

// R14 批 SEARCH（全局搜索）服务层：q/scopes/limit 人话校验（400 走 app.onError 的 HTTPException 分支，
// 不新建错误类）、LIKE 元字符转义、snippet 纯函数、limit+1 探测 has_more、逐 scope VM 组装（parseOutputContract）。
// 鉴权与墓碑过滤全在仓库层进 SQL（逐 actor）——服务层不碰可见性，只做输入净化 + 输出成形。

const SNIPPET_RADIUS = 60;
const SNIPPET_MAX_LENGTH = 160;

// ── 纯函数（穷举单测）───────────────────────────────────────────────────────
// LIKE 元字符转义：先转义反斜杠自身，再转义 % 与 _。配合仓库层的 ESCAPE '\'，用户输入的 50% / a_b 被当字面量。
export function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function buildLikePattern(value: string): string {
  return `%${escapeLikePattern(value)}%`;
}

// snippet：在首个（大小写不敏感）命中位置开窗，两端加省略号，硬 cap 长度；空文本/未命中如实降级。
// 折叠空白（含 minutes_md 的换行）让片段可读；偏移量按折叠后的文本计算，保持一致。
export function buildSnippet(
  text: string | null | undefined,
  query: string,
  radius = SNIPPET_RADIUS,
  maxLength = SNIPPET_MAX_LENGTH
): string {
  const clean = (text ?? "").replace(/\s+/gu, " ").trim();
  if (clean.length === 0) {
    return "";
  }
  const needle = query.trim().toLowerCase();
  const idx = needle.length > 0 ? clean.toLowerCase().indexOf(needle) : -1;
  if (idx === -1) {
    // 该列并非命中列（例如误在文件名命中时对正文取片段）——退化成前缀窗口，不编造命中位置。
    return clean.length > maxLength ? `${clean.slice(0, maxLength)}…` : clean;
  }
  let start = Math.max(0, idx - radius);
  let end = Math.min(clean.length, idx + needle.length + radius);
  if (end - start > maxLength) {
    end = Math.min(clean.length, start + maxLength);
    if (end - start > maxLength) {
      start = Math.max(0, end - maxLength);
    }
  }
  const core = clean.slice(start, end);
  return `${start > 0 ? "…" : ""}${core}${end < clean.length ? "…" : ""}`;
}

// ── 输入校验（人话 400）─────────────────────────────────────────────────────
export function validateSearchQuery(raw: string | undefined): string {
  const q = (raw ?? "").trim();
  const length = [...q].length;
  if (length < SEARCH_QUERY_MIN_LENGTH) {
    throw new HTTPException(400, { message: `搜索词至少需要 ${SEARCH_QUERY_MIN_LENGTH} 个字符。` });
  }
  if (length > SEARCH_QUERY_MAX_LENGTH) {
    throw new HTTPException(400, { message: `搜索词最多 ${SEARCH_QUERY_MAX_LENGTH} 个字符。` });
  }
  return q;
}

const ALL_SCOPES: readonly string[] = SEARCH_SCOPE_ORDER;

export function parseSearchScopes(raw: string | string[] | undefined): SearchScope[] {
  if (raw === undefined) {
    return [...SEARCH_SCOPE_ORDER];
  }
  const parts = (Array.isArray(raw) ? raw : raw.split(","))
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0);
  const valid = [...new Set(parts.filter((piece): piece is SearchScope => ALL_SCOPES.includes(piece)))];
  if (valid.length === 0) {
    // scopes 参数给了但一个合法值都没有（含 `scopes=` 空串）→ 400；未知值在有合法值时静默丢弃。
    throw new HTTPException(400, {
      message: `scopes 必须是 ${SEARCH_SCOPE_ORDER.join(",")} 的非空子集。`
    });
  }
  // 输出恒按固定 scope 顺序，与请求顺序无关。
  return SEARCH_SCOPE_ORDER.filter((scope) => valid.includes(scope));
}

export function clampSearchLimit(raw: string | number | undefined): number {
  if (raw === undefined || raw === "") {
    return SEARCH_LIMIT_DEFAULT;
  }
  const parsed = typeof raw === "number" ? raw : Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return SEARCH_LIMIT_DEFAULT;
  }
  return Math.max(SEARCH_LIMIT_MIN, Math.min(Math.trunc(parsed), SEARCH_LIMIT_MAX));
}

// ── 服务 ──────────────────────────────────────────────────────────────────
export type SearchInput = {
  actor: AuthActor;
  q: string | undefined;
  scopes?: string | string[] | undefined;
  limit?: string | number | undefined;
};

export type SearchService = {
  search: (input: SearchInput) => Promise<SearchResultsVm>;
};

function toActorScope(actor: AuthActor): SearchActorScope {
  return {
    isAdmin: actor.isAdmin,
    orgId: actor.orgId,
    userId: actor.userId ?? actor.id,
    workspaceId: actor.workspaceId
  };
}

function paginate<T>(rows: T[], limit: number): { page: T[]; hasMore: boolean } {
  if (rows.length > limit) {
    return { page: rows.slice(0, limit), hasMore: true };
  }
  return { page: rows, hasMore: false };
}

function includesQuery(text: string | null | undefined, needleLower: string): boolean {
  return (text ?? "").toLowerCase().includes(needleLower);
}

function conversationVm(row: ConversationSearchRow, q: string): ConversationSearchResult {
  return {
    message_id: row.messageId,
    conversation_id: row.conversationId,
    project_id: row.projectId,
    project_name: row.projectName,
    conversation_title: row.conversationTitle,
    seq: row.seq,
    sender_type: row.senderType,
    sender_user_id: row.senderUserId,
    sender_label: row.senderLabel,
    matched_in: "text",
    snippet: buildSnippet(row.text, q),
    created_at: row.createdAt.toISOString(),
    deep_link: { project_id: row.projectId, conversation_id: row.conversationId, seq: row.seq }
  };
}

function driveVm(row: DriveSearchRow, q: string, needleLower: string): DriveSearchResult {
  const nameMatches = includesQuery(row.name, needleLower);
  return {
    item_id: row.itemId,
    project_id: row.projectId,
    project_name: row.projectName,
    name: row.name,
    kind: row.kind,
    matched_in: nameMatches ? "name" : "body",
    snippet: nameMatches ? row.name : buildSnippet(row.parsedText, q),
    updated_at: row.updatedAt.toISOString()
  };
}

function workItemVm(row: WorkItemSearchRow, q: string, needleLower: string): WorkItemSearchResult {
  const titleMatches = includesQuery(row.title, needleLower);
  return {
    work_item_id: row.workItemId,
    code: row.code,
    project_id: row.projectId,
    project_name: row.projectName,
    title: row.title,
    status: row.status,
    matched_in: titleMatches ? "title" : "description",
    snippet: titleMatches ? row.title ?? "" : buildSnippet(row.rawDescription, q),
    updated_at: row.updatedAt.toISOString()
  };
}

function meetingVm(row: MeetingSearchRow, q: string, needleLower: string): MeetingSearchResult {
  const titleMatches = includesQuery(row.title, needleLower);
  return {
    meeting_id: row.meetingId,
    project_id: row.projectId,
    project_name: row.projectName,
    title: row.title,
    status: row.status,
    matched_in: titleMatches ? "title" : "minutes",
    snippet: titleMatches ? row.title : buildSnippet(row.minutesMd, q),
    created_at: row.createdAt.toISOString()
  };
}

export function createSearchService(repo: SearchRepository): SearchService {
  return {
    async search(input) {
      const q = validateSearchQuery(input.q);
      const scopes = parseSearchScopes(input.scopes);
      const limit = clampSearchLimit(input.limit);
      const pattern = buildLikePattern(q);
      const actor = toActorScope(input.actor);
      const needleLower = q.toLowerCase();
      // limit + 1：多取一行探测 has_more，命中则置 has_more 并丢弃末行（不跨 scope 共享 cap，逐 scope 独立）。
      const fetchLimit = limit + 1;
      const groups: SearchGroup[] = [];

      for (const scope of scopes) {
        if (scope === "conversations") {
          const rows = await repo.searchConversations({ actor, pattern, limit: fetchLimit });
          const { page, hasMore } = paginate(rows, limit);
          groups.push({ scope, has_more: hasMore, results: page.map((row) => conversationVm(row, q)) });
        } else if (scope === "drive") {
          const rows = await repo.searchDrive({ actor, pattern, limit: fetchLimit });
          const { page, hasMore } = paginate(rows, limit);
          groups.push({ scope, has_more: hasMore, results: page.map((row) => driveVm(row, q, needleLower)) });
        } else if (scope === "work_items") {
          const rows = await repo.searchWorkItems({ actor, pattern, limit: fetchLimit });
          const { page, hasMore } = paginate(rows, limit);
          groups.push({ scope, has_more: hasMore, results: page.map((row) => workItemVm(row, q, needleLower)) });
        } else {
          const rows = await repo.searchMeetings({ actor, pattern, limit: fetchLimit });
          const { page, hasMore } = paginate(rows, limit);
          groups.push({ scope, has_more: hasMore, results: page.map((row) => meetingVm(row, q, needleLower)) });
        }
      }

      return parseOutputContract(searchResultsVmSchema, { query: q, groups }, "search results");
    }
  };
}

let defaultSearchService: SearchService | undefined;

export function getDefaultSearchService(): SearchService {
  if (!defaultSearchService) {
    defaultSearchService = createSearchService(createSearchRepository(getSharedDatabaseClient().db));
  }
  return defaultSearchService;
}
