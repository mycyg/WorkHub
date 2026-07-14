import { and, desc, eq, isNotNull, isNull, notInArray, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";

import type { WorkHubDb } from "../client.js";
import {
  conversationMessages,
  conversationParticipants,
  meetingRecords,
  projectConversations,
  projectDriveItems,
  projectDriveVersions,
  projects,
  users,
  workItemAssignments,
  workItems,
  workspaceMemberships,
  workspaces
} from "../schema/index.js";

// R14 批 SEARCH（全局搜索）：四 scope 的查询仓库。铁律（02-search-design.md §2）：
//   * 鉴权全部进 SQL 逐 actor（照 project-health.ts DF-2 范本），绝不 load 全量再应用层过滤——
//     每 scope 的 WHERE 直接内联鉴权谓词，LIMIT 施加在**已围栏**的行集上。
//   * 墓碑/软删全滤（会话/网盘/工单有 deleted_at；会议 meeting_records 无软删列，如实不滤）。
//   * ILIKE '%q%' 子串（trgm GIN 加速 ≥3 字符）+ recency 倒序，不用 similarity() 阈值。
//   * LIKE 元字符（% _ \）在服务层转义后拼成 pattern 传入，这里只 `ILIKE ${pattern} ESCAPE '\'`，全程参数化。
//   * 每 scope limit 由服务层传入（clamped + 1 探测 has_more），仓库只忠实施加 .limit()。

// 与 canViewWorkItemRecord / project-health 的 privateWorkItemStatuses 同口径（inline 以免 db 包新增
// 对 @workhub/permissions 的依赖，照 project-health.ts:58 的 inline 先例）。
type WorkItemStatusColumn = typeof workItems.$inferSelect.status;
const privateWorkItemStatuses: WorkItemStatusColumn[] = ["intake", "ai_clarifying", "spec_ready"];

export type SearchActorScope = {
  isAdmin?: boolean;
  orgId?: string;
  userId?: string;
  workspaceId?: string;
};

export type SearchScopeQuery = {
  actor: SearchActorScope;
  // 已在服务层转义（% _ \）并拼上首尾通配符的 LIKE pattern，例如 %预算%。仓库只做参数化插值。
  pattern: string;
  // 服务层传入 clamped + 1（多取一行探测 has_more）；仓库忠实 .limit()。
  limit: number;
};

export type ConversationSearchRow = {
  messageId: string;
  conversationId: string;
  projectId: string;
  projectName: string;
  conversationTitle: string;
  seq: number;
  senderType: string;
  senderUserId: string | null;
  senderLabel: string | null;
  text: string;
  createdAt: Date;
};

export type DriveSearchRow = {
  itemId: string;
  projectId: string;
  projectName: string;
  name: string;
  kind: string;
  parsedText: string | null;
  updatedAt: Date;
};

export type WorkItemSearchRow = {
  workItemId: string;
  code: string;
  projectId: string;
  projectName: string;
  title: string | null;
  rawDescription: string | null;
  status: string;
  updatedAt: Date;
};

export type MeetingSearchRow = {
  meetingId: string;
  projectId: string;
  projectName: string;
  title: string;
  minutesMd: string | null;
  status: string;
  createdAt: Date;
};

export type SearchRepository = {
  searchConversations: (input: SearchScopeQuery) => Promise<ConversationSearchRow[]>;
  searchDrive: (input: SearchScopeQuery) => Promise<DriveSearchRow[]>;
  searchWorkItems: (input: SearchScopeQuery) => Promise<WorkItemSearchRow[]>;
  searchMeetings: (input: SearchScopeQuery) => Promise<MeetingSearchRow[]>;
};

// 子串匹配：ESCAPE '\'（源码里 '\\' 编成一个反斜杠），故服务层转义的 \% \_ \\ 在 PG 里被当字面量，
// 防用户输入 50% 被当通配符（正确性 + 注入面收口）。pattern 参数化绑定，不字符串拼接进 SQL。
function likeMatch(expr: SQLWrapper, pattern: string): SQL {
  return sql`${expr} ILIKE ${pattern} ESCAPE '\\'`;
}

// 网盘/会议共用的项目围栏（02-search-design.md §2 保守版，集成裁定批准）：
//   canViewProjectDrive 语义（项目 active + admin 同 org / 非 admin 同工作区或 owner）
//   **追加**「个人空间一律 owner-only」守卫，对齐会话 scope 的 activeConversationCondition，
//   防聚合搜索把他人个人空间的文件名/正文/会议纪要抖给整个工作区（fail-closed；含 admin 也不越个人空间）。
function driveMeetingProjectConditions(actor: SearchActorScope): SQL[] {
  const ownerMatch = actor.userId ? eq(projects.ownerUserId, actor.userId) : sql`false`;
  const conditions: SQL[] = [
    eq(projects.archived, false),
    isNull(projects.deletedAt),
    // 保守个人空间围栏（对所有 actor 生效，含 admin）。
    or(eq(projects.isPersonal, false), ownerMatch) ?? sql`false`
  ];
  if (actor.isAdmin) {
    // 管理员是 org 级总览：可跨工作区但不跨 org、不复活归档/删除项目（与个人空间围栏叠加）。
    if (actor.orgId) {
      conditions.push(sql`exists (
        select 1
        from ${workspaces}
        where ${workspaces.id} = ${projects.workspaceId}
          and ${workspaces.orgId} = ${actor.orgId}
      )`);
    }
    return conditions;
  }
  if (actor.workspaceId) {
    conditions.push(or(eq(projects.workspaceId, actor.workspaceId), ownerMatch) ?? sql`false`);
  } else {
    conditions.push(sql`false`);
  }
  return conditions;
}

// 工单围栏（照抄 canViewWorkItemRecord + project-health.ts workItemScopeConditions 的 DF-2 SQL 下推，
// 含 assignee 的 exists 子查询）。项目 active 从 projects join 上判定。不加个人空间围栏——工单可见性本就
// 走 status/submitter/assignee（与既有工单列表/详情端点同口径），设计只对网盘/会议追加个人空间守卫。
function workItemAuthzConditions(actor: SearchActorScope): SQL[] {
  const conditions: SQL[] = [eq(projects.archived, false), isNull(projects.deletedAt)];
  if (actor.isAdmin) {
    if (actor.orgId) {
      conditions.push(sql`exists (
        select 1
        from ${workspaces}
        where ${workspaces.id} = ${projects.workspaceId}
          and ${workspaces.orgId} = ${actor.orgId}
      )`);
    }
    return conditions;
  }
  if (actor.workspaceId) {
    conditions.push(
      or(eq(workItems.workspaceId, actor.workspaceId), eq(projects.workspaceId, actor.workspaceId)) ?? sql`false`
    );
  } else {
    conditions.push(sql`false`);
    return conditions;
  }
  if (actor.userId) {
    conditions.push(
      or(
        notInArray(workItems.status, privateWorkItemStatuses),
        eq(workItems.submitterUserId, actor.userId),
        eq(workItems.claimedByUserId, actor.userId),
        sql`exists (
          select 1
          from ${workItemAssignments}
          where ${workItemAssignments.workItemId} = ${workItems.id}
            and ${workItemAssignments.userId} = ${actor.userId}
        )`
      ) ?? sql`false`
    );
  } else {
    conditions.push(notInArray(workItems.status, privateWorkItemStatuses));
  }
  return conditions;
}

export function createSearchRepository(db: WorkHubDb): SearchRepository {
  return {
    async searchConversations(input) {
      const viewerUserId = input.actor.userId;
      const workspaceId = input.actor.workspaceId;
      // 会话 scope 严格单工作区 + 需已认证 human（照抄 activeConversationCondition 的前置）；缺则 fail-closed 空。
      if (!viewerUserId || !workspaceId) {
        return [];
      }
      const textExpr = sql`(${conversationMessages.contentJson} ->> 'text')`;
      const rows = await db
        .select({
          messageId: conversationMessages.id,
          conversationId: conversationMessages.conversationId,
          projectId: projectConversations.projectId,
          projectName: projects.name,
          conversationTitle: projectConversations.title,
          seq: conversationMessages.seq,
          senderType: conversationMessages.senderType,
          senderUserId: conversationMessages.senderUserId,
          senderLabel: users.nickname,
          text: sql<string | null>`${textExpr}`,
          createdAt: conversationMessages.createdAt
        })
        .from(conversationMessages)
        .innerJoin(projectConversations, eq(projectConversations.id, conversationMessages.conversationId))
        .innerJoin(
          projects,
          and(
            eq(projects.id, projectConversations.projectId),
            eq(projects.workspaceId, projectConversations.workspaceId)
          )
        )
        .innerJoin(
          workspaceMemberships,
          and(
            eq(workspaceMemberships.workspaceId, projectConversations.workspaceId),
            eq(workspaceMemberships.userId, viewerUserId),
            isNull(workspaceMemberships.deletedAt)
          )
        )
        .leftJoin(
          conversationParticipants,
          and(
            eq(conversationParticipants.conversationId, projectConversations.id),
            eq(conversationParticipants.userId, viewerUserId)
          )
        )
        .leftJoin(users, eq(users.id, conversationMessages.senderUserId))
        .where(
          and(
            eq(conversationMessages.kind, "text"),
            isNull(conversationMessages.deletedAt),
            likeMatch(textExpr, input.pattern),
            // 照抄 activeConversationCondition（conversations.ts）：单工作区 + 项目 active + 个人空间 owner-only。
            eq(projectConversations.workspaceId, workspaceId),
            isNull(projectConversations.deletedAt),
            eq(projects.workspaceId, workspaceId),
            eq(projects.archived, false),
            isNull(projects.deletedAt),
            or(eq(projects.isPersonal, false), eq(projects.ownerUserId, viewerUserId)),
            // visibleConversationCondition：main 全员可见 / collab 仅参与者（leftJoin 命中）。
            or(
              eq(projectConversations.kind, "main"),
              and(eq(projectConversations.kind, "collab"), isNotNull(conversationParticipants.id))
            )
          )
        )
        .orderBy(desc(conversationMessages.createdAt), desc(conversationMessages.seq))
        .limit(input.limit);
      return rows.map((row) => ({
        messageId: row.messageId,
        conversationId: row.conversationId,
        projectId: row.projectId,
        projectName: row.projectName,
        conversationTitle: row.conversationTitle,
        seq: Number(row.seq),
        senderType: row.senderType,
        senderUserId: row.senderUserId,
        senderLabel: row.senderLabel,
        text: row.text == null ? "" : String(row.text),
        createdAt: row.createdAt
      }));
    },

    async searchDrive(input) {
      const rows = await db
        .select({
          itemId: projectDriveItems.id,
          projectId: projectDriveItems.projectId,
          projectName: projects.name,
          name: projectDriveItems.name,
          kind: projectDriveItems.kind,
          parsedText: projectDriveVersions.parsedText,
          updatedAt: projectDriveItems.updatedAt
        })
        .from(projectDriveItems)
        .innerJoin(projects, eq(projects.id, projectDriveItems.projectId))
        // 只 join 当前版本的正文（items.current_version_id → versions.id）；文件夹/无当前版则 parsedText 为 null，
        // 只有文件名可命中（leftJoin 不丢这些行）。
        .leftJoin(projectDriveVersions, eq(projectDriveVersions.id, projectDriveItems.currentVersionId))
        .where(
          and(
            isNull(projectDriveItems.deletedAt),
            or(likeMatch(projectDriveItems.name, input.pattern), likeMatch(projectDriveVersions.parsedText, input.pattern)),
            ...driveMeetingProjectConditions(input.actor)
          )
        )
        .orderBy(desc(projectDriveItems.updatedAt), desc(projectDriveItems.id))
        .limit(input.limit);
      return rows;
    },

    async searchWorkItems(input) {
      const searchExpr = sql`(coalesce(${workItems.title}, '') || ' ' || coalesce(${workItems.rawDescription}, ''))`;
      const rows = await db
        .select({
          workItemId: workItems.id,
          code: workItems.code,
          projectId: workItems.projectId,
          projectName: projects.name,
          title: workItems.title,
          rawDescription: workItems.rawDescription,
          status: workItems.status,
          updatedAt: workItems.updatedAt
        })
        .from(workItems)
        .innerJoin(projects, eq(projects.id, workItems.projectId))
        .where(
          and(isNull(workItems.deletedAt), likeMatch(searchExpr, input.pattern), ...workItemAuthzConditions(input.actor))
        )
        .orderBy(desc(workItems.updatedAt), desc(workItems.id))
        .limit(input.limit);
      return rows;
    },

    async searchMeetings(input) {
      const searchExpr = sql`(coalesce(${meetingRecords.title}, '') || ' ' || coalesce(${meetingRecords.minutesMd}, ''))`;
      const rows = await db
        .select({
          meetingId: meetingRecords.id,
          projectId: meetingRecords.projectId,
          projectName: projects.name,
          title: meetingRecords.title,
          minutesMd: meetingRecords.minutesMd,
          status: meetingRecords.status,
          createdAt: meetingRecords.createdAt
        })
        .from(meetingRecords)
        .innerJoin(projects, eq(projects.id, meetingRecords.projectId))
        // meeting_records 无 deleted_at 软删列（设计 §0 如实），故无墓碑过滤。
        .where(and(likeMatch(searchExpr, input.pattern), ...driveMeetingProjectConditions(input.actor)))
        .orderBy(desc(meetingRecords.createdAt), desc(meetingRecords.id))
        .limit(input.limit);
      return rows;
    }
  };
}
