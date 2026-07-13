import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";

import {
  conversationListQuerySchema,
  type ConversationVisibility
} from "@workhub/contracts";

import type { WorkHubDb } from "../client.js";
import {
  conversationMessages,
  conversationParticipants,
  projectConversations,
  projects,
  workspaceMemberships
} from "../schema/index.js";

export type ConversationRow = typeof projectConversations.$inferSelect;
export type ConversationParticipantRow = typeof conversationParticipants.$inferSelect;
export type ConversationMessageRow = typeof conversationMessages.$inferSelect;
export type ConversationParticipantRole = "owner" | "member";

export type VisibleConversationRow = ConversationRow & {
  participantRole: ConversationParticipantRole | null;
};

export type ConversationAccessRecord = {
  conversation: ConversationRow;
  projectOwnerUserId: string | null;
  membershipRole: string;
  participantRole: ConversationParticipantRole | null;
};

export type ListVisibleConversationsInput = {
  workspaceId: string;
  viewerUserId: string;
  projectId: string;
  after?: ConversationListCursor;
  limit: number;
};

export type ConversationListCursor = {
  createdAt: string;
  id: string;
};

export type FindConversationAccessInput = {
  workspaceId: string;
  viewerUserId: string;
  conversationId: string;
};

export type CreateCollabConversationInput = {
  id?: string;
  workspaceId: string;
  projectId: string;
  creatorUserId: string;
  title: string;
  visibility: ConversationVisibility;
  parentConversationId?: string;
  sourceMessageId?: string;
  participantUserIds: string[];
  at?: Date;
};

type CreateUserMessageBaseInput = {
  id?: string;
  workspaceId: string;
  conversationId: string;
  senderUserId: string;
  threadRootId?: string;
  at?: Date;
};

export type CreateUserMessageInput = CreateUserMessageBaseInput &
  (
    | { kind: "text"; contentJson: { text: string } }
    | { kind: "file_card"; contentJson: { drive_item_id: string; snapshot_name: string } }
  );

// R12 批4a：协同会话 turn 落库的 Cuu 回应——kind 固定 'text'（本批只做纯对话，不产出 file_card 等其它
// kind）。sender_user_id 固定 null（Cuu 不是 workspace 成员，不需要也不能过 createUserMessage 那套
// membership/participant 校验）。memory_citations 是本轮实际注入过的记忆/技能引用清单，additive，
// 由调用方（services/conversation-turns.ts）组装好后原样落 content_json。
export type CreateCuuMessageInput = {
  id?: string;
  workspaceId: string;
  conversationId: string;
  contentJson: {
    text: string;
    memory_citations?: Array<{ kind: "user_memory" | "team_skill"; title: string }>;
  };
  threadRootId?: string;
  at?: Date;
};

export type ListConversationMessagesInput = {
  workspaceId: string;
  viewerUserId: string;
  conversationId: string;
  afterSeq: number;
  limit: number;
};

// R12 批8：反向翻页（listMessagesBefore）的输入——除了游标方向（beforeSeq 而非 afterSeq），access
// 判定与 listMessagesAfter 完全同款（复用同一个 readVisibleAccess + activeConversationCondition）。
export type ListConversationMessagesBeforeInput = {
  workspaceId: string;
  viewerUserId: string;
  conversationId: string;
  beforeSeq: number;
  limit: number;
};

export type VisibleConversationListResult = {
  rows: VisibleConversationRow[];
  capped: boolean;
  nextCursor: ConversationListCursor | null;
};

export type CreatedCollabConversation = {
  conversation: ConversationRow;
  participants: ConversationParticipantRow[];
};

export type ConversationMessagePage = {
  rows: ConversationMessageRow[];
  hasMore: boolean;
  nextAfterSeq: number;
};

// R12 批8：rows 始终按 seq 升序返回（和 listMessagesAfter 的页形状一致，调用方不需要按方向切换排序
// 逻辑）——仓库内部按 seq 降序扫描离 beforeSeq 最近的一页，取回后再翻正。nextBeforeSeq 是继续向更早
// 翻页的游标（本页最旧一条的 seq）；页为空时保持 beforeSeq 不变，同 listMessagesAfter 空页时的既有
// 约定（nextAfterSeq 保持 afterSeq 不变）。
export type ConversationMessageBeforePage = {
  rows: ConversationMessageRow[];
  hasMore: boolean;
  nextBeforeSeq: number;
};

export type ConversationRepository = {
  listVisibleForProject: (
    input: ListVisibleConversationsInput
  ) => Promise<VisibleConversationListResult | null>;
  findVisibleAccessRecord: (input: FindConversationAccessInput) => Promise<ConversationAccessRecord | null>;
  createCollab: (input: CreateCollabConversationInput) => Promise<CreatedCollabConversation>;
  createUserMessage: (input: CreateUserMessageInput) => Promise<ConversationMessageRow>;
  // R12 批4a：新增，不改动上面任何既有方法的签名/行为。
  createCuuMessage: (input: CreateCuuMessageInput) => Promise<ConversationMessageRow>;
  listMessagesAfter: (input: ListConversationMessagesInput) => Promise<ConversationMessagePage | null>;
  // R12 批8：反向翻页——「滚到顶加载更早」。access 判定/鉴权与 listMessagesAfter 完全同款（同一份
  // readVisibleAccess + activeConversationCondition），仅游标方向与排序不同。
  listMessagesBefore: (input: ListConversationMessagesBeforeInput) => Promise<ConversationMessageBeforePage | null>;
};

class NamedConversationRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ConversationRepositoryInputError extends NamedConversationRepositoryError {}
export class ConversationAccessDeniedError extends NamedConversationRepositoryError {}
export class ConversationParticipantMembershipError extends NamedConversationRepositoryError {}
export class ConversationParentAccessError extends NamedConversationRepositoryError {}
export class ConversationSourceMessageMismatchError extends NamedConversationRepositoryError {}
export class ConversationInsertFailedError extends NamedConversationRepositoryError {}
export class ConversationParticipantInsertFailedError extends NamedConversationRepositoryError {}
export class ConversationThreadRootMismatchError extends NamedConversationRepositoryError {}
export class ConversationSequenceExhaustedError extends NamedConversationRepositoryError {}
export class ConversationSequenceAllocationError extends NamedConversationRepositoryError {}
export class ConversationMessageInsertFailedError extends NamedConversationRepositoryError {}

const conversationSelection = {
  id: projectConversations.id,
  workspaceId: projectConversations.workspaceId,
  projectId: projectConversations.projectId,
  kind: projectConversations.kind,
  title: projectConversations.title,
  parentConversationId: projectConversations.parentConversationId,
  sourceMessageId: projectConversations.sourceMessageId,
  visibility: projectConversations.visibility,
  nextSeq: projectConversations.nextSeq,
  createdBy: projectConversations.createdBy,
  deletedAt: projectConversations.deletedAt,
  deletedByUserId: projectConversations.deletedByUserId,
  createdAt: projectConversations.createdAt,
  updatedAt: projectConversations.updatedAt
};

const messageSelection = {
  id: conversationMessages.id,
  conversationId: conversationMessages.conversationId,
  seq: conversationMessages.seq,
  senderType: conversationMessages.senderType,
  senderUserId: conversationMessages.senderUserId,
  kind: conversationMessages.kind,
  contentJson: conversationMessages.contentJson,
  threadRootId: conversationMessages.threadRootId,
  createdAt: conversationMessages.createdAt
};

const conversationCursorCreatedAtSelection = sql<string>`to_char(
  ${projectConversations.createdAt} at time zone 'UTC',
  'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
)`;

function assertLimit(limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ConversationRepositoryInputError("conversation limit must be an integer from 1 through 100");
  }
}

function assertCursor(afterSeq: number) {
  if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) {
    throw new ConversationRepositoryInputError("conversation cursor must be a non-negative safe integer");
  }
}

function assertConversationListCursor(cursor: ConversationListCursor | undefined) {
  if (!cursor) {
    return;
  }
  const parsed = conversationListQuerySchema.safeParse({
    afterCreatedAt: cursor.createdAt,
    afterId: cursor.id,
    limit: 1
  });
  if (!parsed.success) {
    throw new ConversationRepositoryInputError(
      "conversation list cursor requires a canonical UTC microsecond timestamp and UUID"
    );
  }
}

function assertCollabInput(input: CreateCollabConversationInput) {
  if (input.sourceMessageId && !input.parentConversationId) {
    throw new ConversationRepositoryInputError("source message requires a parent conversation");
  }
  if (input.participantUserIds.length > 99) {
    throw new ConversationRepositoryInputError("a collab may request at most 99 members");
  }
  const normalizedCreatorUserId = input.creatorUserId.toLowerCase();
  const normalizedParticipantUserIds = input.participantUserIds.map((userId) => userId.toLowerCase());
  const unique = new Set(normalizedParticipantUserIds);
  if (unique.size !== normalizedParticipantUserIds.length || unique.has(normalizedCreatorUserId)) {
    throw new ConversationRepositoryInputError("collab participants must be unique and exclude the creator");
  }
}

function assertMessageContent(input: CreateUserMessageInput) {
  const keys = Object.keys(input.contentJson).sort();
  if (input.kind === "text") {
    if (keys.length !== 1 || keys[0] !== "text" || input.contentJson.text.length === 0) {
      throw new ConversationRepositoryInputError("text messages require only non-empty text metadata");
    }
    return;
  }
  if (
    keys.length !== 2 ||
    keys[0] !== "drive_item_id" ||
    keys[1] !== "snapshot_name" ||
    input.contentJson.drive_item_id.length === 0 ||
    input.contentJson.snapshot_name.length === 0
  ) {
    throw new ConversationRepositoryInputError("file cards accept only drive item and snapshot metadata");
  }
}

// R12 批4a：仓库层只做轻量防御性形状检查（与 assertMessageContent 同一档次），不复述
// @workhub/contracts 的 conversationTextContentSchema 全套边界校验——那份校验在调用方
// （services/conversation-turns.ts）用 parseOutputContract 对装配好的 VM 做一次即可，双写两份
// 校验逻辑只会随时间漂移。这里只保证不会把明显错形状的值写进 content_json。
function assertCuuMessageContent(contentJson: CreateCuuMessageInput["contentJson"]) {
  if (typeof contentJson.text !== "string" || contentJson.text.length === 0) {
    throw new ConversationRepositoryInputError("cuu text messages require non-empty text metadata");
  }
  if (contentJson.memory_citations !== undefined && !Array.isArray(contentJson.memory_citations)) {
    throw new ConversationRepositoryInputError("cuu memory citations must be an array when present");
  }
}

function visibleConversationCondition() {
  return or(
    eq(projectConversations.kind, "main"),
    and(eq(projectConversations.kind, "collab"), isNotNull(conversationParticipants.id))
  );
}

function activeConversationCondition(input: {
  workspaceId: string;
  viewerUserId: string;
  conversationId?: string;
  projectId?: string;
}) {
  return and(
    eq(projectConversations.workspaceId, input.workspaceId),
    input.conversationId ? eq(projectConversations.id, input.conversationId) : undefined,
    input.projectId ? eq(projectConversations.projectId, input.projectId) : undefined,
    isNull(projectConversations.deletedAt),
    eq(projects.workspaceId, input.workspaceId),
    eq(projects.archived, false),
    isNull(projects.deletedAt),
    // R13 批 S3（个人空间）：is_personal=true 的项目只对 owner 本人可见——工作区里其他任何正常成员
    // （含 admin）都看不到、进不去别人的个人空间会话。is_personal=false 时这个条件恒真，团队项目的
    // 既有行为（工作区内全员可见）完全不变。这一个条件同时守住单会话访问（readVisibleAccess）、
    // 消息翻页（listMessagesAfter/listMessagesBefore）与项目内会话列表（listVisibleForProject 的
    // 行查询）——四处共用同一份 activeConversationCondition。
    or(eq(projects.isPersonal, false), eq(projects.ownerUserId, input.viewerUserId)),
    eq(workspaceMemberships.workspaceId, input.workspaceId),
    eq(workspaceMemberships.userId, input.viewerUserId),
    isNull(workspaceMemberships.deletedAt),
    visibleConversationCondition()
  );
}

function conversationListCursorCondition(cursor: ConversationListCursor | undefined) {
  if (!cursor) {
    return undefined;
  }
  return sql`(${projectConversations.createdAt}, ${projectConversations.id}) > (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`;
}

async function readVisibleAccess(
  db: WorkHubDb,
  input: FindConversationAccessInput & { projectId?: string }
): Promise<ConversationAccessRecord | null> {
  const rows = await db
    .select({
      conversation: conversationSelection,
      projectOwnerUserId: projects.ownerUserId,
      membershipRole: workspaceMemberships.role,
      participantRole: conversationParticipants.role
    })
    .from(projectConversations)
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
        eq(workspaceMemberships.userId, input.viewerUserId),
        isNull(workspaceMemberships.deletedAt)
      )
    )
    .leftJoin(
      conversationParticipants,
      and(
        eq(conversationParticipants.conversationId, projectConversations.id),
        eq(conversationParticipants.userId, input.viewerUserId)
      )
    )
    .where(activeConversationCondition(input))
    .limit(1);
  return (rows[0] as ConversationAccessRecord | undefined) ?? null;
}

async function readActiveProjectMembership(
  db: WorkHubDb,
  input: { workspaceId: string; projectId: string; userId: string }
) {
  const [access] = await db
    .select({ projectId: projects.id, membershipRole: workspaceMemberships.role })
    .from(projects)
    .innerJoin(
      workspaceMemberships,
      and(
        eq(workspaceMemberships.workspaceId, projects.workspaceId),
        eq(workspaceMemberships.userId, input.userId),
        isNull(workspaceMemberships.deletedAt)
      )
    )
    .where(
      and(
        eq(projects.id, input.projectId),
        eq(projects.workspaceId, input.workspaceId),
        eq(projects.archived, false),
        isNull(projects.deletedAt),
        // R13 批 S3：与 activeConversationCondition 同款——个人空间的会话列表只对 owner 本人可见。
        or(eq(projects.isPersonal, false), eq(projects.ownerUserId, input.userId)),
        eq(workspaceMemberships.workspaceId, input.workspaceId),
        eq(workspaceMemberships.userId, input.userId),
        isNull(workspaceMemberships.deletedAt)
      )
    )
    .limit(1);
  return access ?? null;
}

async function lockActiveProject(
  db: WorkHubDb,
  input: { workspaceId: string; projectId: string }
) {
  const [project] = await db
    .select({
      projectId: projects.id,
      projectOwnerUserId: projects.ownerUserId,
      isPersonal: projects.isPersonal
    })
    .from(projects)
    .where(
      and(
        eq(projects.id, input.projectId),
        eq(projects.workspaceId, input.workspaceId),
        eq(projects.archived, false),
        isNull(projects.deletedAt)
      )
    )
    .for("share", { of: projects })
    .limit(1);
  return project ?? null;
}

async function lockActiveMembershipSet(
  db: WorkHubDb,
  input: { workspaceId: string; userIds: string[] }
) {
  if (input.userIds.length === 0) {
    return [];
  }
  return db
    .select({ id: workspaceMemberships.id, userId: workspaceMemberships.userId })
    .from(workspaceMemberships)
    .where(
      and(
        eq(workspaceMemberships.workspaceId, input.workspaceId),
        inArray(workspaceMemberships.userId, input.userIds),
        isNull(workspaceMemberships.deletedAt)
      )
    )
    .orderBy(asc(workspaceMemberships.userId))
    .for("share", { of: workspaceMemberships });
}

async function lockConversationParticipant(
  db: WorkHubDb,
  input: { conversationId: string; userId: string }
) {
  const [participant] = await db
    .select({ id: conversationParticipants.id, role: conversationParticipants.role })
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.conversationId, input.conversationId),
        eq(conversationParticipants.userId, input.userId)
      )
    )
    .for("share", { of: conversationParticipants })
    .limit(1);
  return participant ?? null;
}

async function lockParentConversation(
  db: WorkHubDb,
  input: { workspaceId: string; projectId: string; conversationId: string }
) {
  const [parent] = await db
    .select(conversationSelection)
    .from(projectConversations)
    .where(
      and(
        eq(projectConversations.workspaceId, input.workspaceId),
        eq(projectConversations.projectId, input.projectId),
        eq(projectConversations.id, input.conversationId),
        isNull(projectConversations.deletedAt)
      )
    )
    .for("update", { of: projectConversations })
    .limit(1);
  if (!parent) {
    return null;
  }
  return parent;
}

async function readConversationProjectId(
  db: WorkHubDb,
  input: { workspaceId: string; conversationId: string }
) {
  const [locator] = await db
    .select({ projectId: projectConversations.projectId })
    .from(projectConversations)
    .where(
      and(
        eq(projectConversations.workspaceId, input.workspaceId),
        eq(projectConversations.id, input.conversationId),
        isNull(projectConversations.deletedAt)
      )
    )
    .limit(1);
  return locator ?? null;
}

async function lockActiveConversation(
  db: WorkHubDb,
  input: { workspaceId: string; projectId: string; conversationId: string }
) {
  const [conversation] = await db
    .select(conversationSelection)
    .from(projectConversations)
    .where(
      and(
        eq(projectConversations.workspaceId, input.workspaceId),
        eq(projectConversations.projectId, input.projectId),
        eq(projectConversations.id, input.conversationId),
        isNull(projectConversations.deletedAt)
      )
    )
    .for("update", { of: projectConversations })
    .limit(1);
  return conversation ?? null;
}

export function createConversationRepository(db: WorkHubDb): ConversationRepository {
  return {
    async listVisibleForProject(input) {
      assertLimit(input.limit);
      assertConversationListCursor(input.after);
      const projectAccess = await readActiveProjectMembership(db, {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        userId: input.viewerUserId
      });
      if (!projectAccess) {
        return null;
      }
      const rows = await db
        .select({
          ...conversationSelection,
          participantRole: conversationParticipants.role,
          cursorCreatedAt: conversationCursorCreatedAtSelection
        })
        .from(projectConversations)
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
            eq(workspaceMemberships.userId, input.viewerUserId),
            isNull(workspaceMemberships.deletedAt)
          )
        )
        .leftJoin(
          conversationParticipants,
          and(
            eq(conversationParticipants.conversationId, projectConversations.id),
            eq(conversationParticipants.userId, input.viewerUserId)
          )
        )
        .where(
          and(
            activeConversationCondition(input),
            conversationListCursorCondition(input.after)
          )
        )
        .orderBy(asc(projectConversations.createdAt), asc(projectConversations.id))
        .limit(input.limit + 1);
      const pageSourceRows = rows.slice(0, input.limit);
      const pageRows = pageSourceRows.map(({ cursorCreatedAt: _cursorCreatedAt, ...row }) => ({
        ...row,
        participantRole: (row.participantRole as ConversationParticipantRole | null) ?? null
      }));
      const capped = rows.length > input.limit;
      const last = pageSourceRows.at(-1);
      return {
        rows: pageRows,
        capped,
        nextCursor: capped && last ? { createdAt: last.cursorCreatedAt, id: last.id } : null
      };
    },

    async findVisibleAccessRecord(input) {
      return readVisibleAccess(db, input);
    },

    async createCollab(input) {
      assertCollabInput(input);
      const at = input.at ?? new Date();
      const creatorUserId = input.creatorUserId.toLowerCase();
      const participantUserIds = input.participantUserIds.map((userId) => userId.toLowerCase());
      return db.transaction(async (tx) => {
        const project = await lockActiveProject(tx, input);
        if (!project) {
          throw new ConversationAccessDeniedError("creator cannot access the active project");
        }
        // R13 批 S3：个人空间成员语义=仅本人——即便发起人是正常工作区成员，也不能在别人的个人空间
        // 下新建协同会话。fail-closed 语义与上面的 !project 分支一致（同一个错误/同一个 404）。
        if (project.isPersonal && project.projectOwnerUserId !== creatorUserId) {
          throw new ConversationAccessDeniedError("creator cannot access the active project");
        }

        let parent: ConversationRow | null = null;
        if (input.parentConversationId) {
          parent = await lockParentConversation(tx, {
            workspaceId: input.workspaceId,
            conversationId: input.parentConversationId,
            projectId: input.projectId
          });
          if (!parent) {
            throw new ConversationParentAccessError("parent conversation is not visible in this project");
          }
        }

        const activeMemberships = await lockActiveMembershipSet(tx, {
          workspaceId: input.workspaceId,
          userIds: [creatorUserId, ...participantUserIds]
        });
        const activeIds = new Set(activeMemberships.map((row) => row.userId.toLowerCase()));
        if (!activeIds.has(creatorUserId)) {
          throw new ConversationAccessDeniedError("creator is not an active workspace member");
        }
        if (participantUserIds.some((userId) => !activeIds.has(userId))) {
          throw new ConversationParticipantMembershipError(
            "every collab participant must be an active workspace member"
          );
        }

        if (parent?.kind === "collab") {
          const parentParticipant = await lockConversationParticipant(tx, {
            conversationId: parent.id,
            userId: creatorUserId
          });
          if (!parentParticipant) {
            throw new ConversationParentAccessError("parent conversation is not visible in this project");
          }
        }

        if (parent && input.sourceMessageId) {
          const [source] = await tx
            .select({ id: conversationMessages.id })
            .from(conversationMessages)
            .where(
              and(
                eq(conversationMessages.conversationId, parent.id),
                eq(conversationMessages.id, input.sourceMessageId)
              )
            )
            .limit(1);
          if (!source) {
            throw new ConversationSourceMessageMismatchError(
              "source message does not belong to the selected parent conversation"
            );
          }
        }

        const [created] = await tx
          .insert(projectConversations)
          .values({
            id: input.id ?? randomUUID(),
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            kind: "collab",
            title: input.title,
            ...(input.parentConversationId ? { parentConversationId: input.parentConversationId } : {}),
            ...(input.sourceMessageId ? { sourceMessageId: input.sourceMessageId } : {}),
            visibility: input.visibility,
            nextSeq: 0,
            createdBy: creatorUserId,
            createdAt: at,
            updatedAt: at
          })
          .returning();
        if (!created) {
          throw new ConversationInsertFailedError("collab insert returned no conversation");
        }

        const participantValues = [
          {
            id: randomUUID(),
            conversationId: created.id,
            userId: creatorUserId,
            role: "owner" as const,
            createdAt: at,
            updatedAt: at
          },
          ...participantUserIds.map((userId) => ({
            id: randomUUID(),
            conversationId: created.id,
            userId,
            role: "member" as const,
            createdAt: at,
            updatedAt: at
          }))
        ];
        const insertedParticipants = await tx
          .insert(conversationParticipants)
          .values(participantValues)
          .returning();
        const expectedParticipantRoles = new Map(
          participantValues.map((row) => [row.userId, row.role])
        );
        if (
          insertedParticipants.length !== participantValues.length ||
          insertedParticipants.some(
            (row) => expectedParticipantRoles.get(row.userId) !== row.role
          )
        ) {
          throw new ConversationParticipantInsertFailedError(
            "collab participant insert returned an incomplete or mismatched set"
          );
        }
        return { conversation: created, participants: insertedParticipants };
      });
    },

    async createUserMessage(input) {
      assertMessageContent(input);
      const at = input.at ?? new Date();
      const senderUserId = input.senderUserId.toLowerCase();
      return db.transaction(async (tx) => {
        const locator = await readConversationProjectId(tx, input);
        if (!locator) {
          throw new ConversationAccessDeniedError("sender cannot access the active conversation");
        }
        const project = await lockActiveProject(tx, {
          workspaceId: input.workspaceId,
          projectId: locator.projectId
        });
        if (!project) {
          throw new ConversationAccessDeniedError("sender cannot access the active project");
        }
        const conversation = await lockActiveConversation(tx, {
          workspaceId: input.workspaceId,
          projectId: locator.projectId,
          conversationId: input.conversationId
        });
        if (!conversation) {
          throw new ConversationAccessDeniedError("sender cannot access the active conversation");
        }
        const senderMemberships = await lockActiveMembershipSet(tx, {
          workspaceId: input.workspaceId,
          userIds: [senderUserId]
        });
        if (!senderMemberships.some((row) => row.userId.toLowerCase() === senderUserId)) {
          throw new ConversationAccessDeniedError("sender is not an active workspace member");
        }
        if (conversation.kind === "collab") {
          const participant = await lockConversationParticipant(tx, {
            conversationId: input.conversationId,
            userId: senderUserId
          });
          if (!participant) {
            throw new ConversationAccessDeniedError("sender is not an active collab participant");
          }
        }

        if (input.threadRootId) {
          const [root] = await tx
            .select({ id: conversationMessages.id })
            .from(conversationMessages)
            .where(
              and(
                eq(conversationMessages.conversationId, input.conversationId),
                eq(conversationMessages.id, input.threadRootId)
              )
            )
            .limit(1);
          if (!root) {
            throw new ConversationThreadRootMismatchError(
              "thread root does not belong to the target conversation"
            );
          }
        }

        const currentSeq = conversation.nextSeq;
        if (!Number.isSafeInteger(currentSeq) || currentSeq < 0) {
          throw new ConversationSequenceAllocationError("stored conversation sequence is not a safe integer");
        }
        if (currentSeq >= Number.MAX_SAFE_INTEGER) {
          throw new ConversationSequenceExhaustedError("conversation sequence space is exhausted");
        }
        const [allocation] = await tx
          .update(projectConversations)
          .set({
            nextSeq: sql<number>`${projectConversations.nextSeq} + 1`,
            updatedAt: at
          })
          .where(
            and(
              eq(projectConversations.workspaceId, input.workspaceId),
              eq(projectConversations.id, input.conversationId),
              eq(projectConversations.projectId, conversation.projectId),
              eq(projectConversations.nextSeq, currentSeq),
              isNull(projectConversations.deletedAt)
            )
          )
          .returning({ nextSeq: projectConversations.nextSeq });
        const nextSeq = allocation?.nextSeq;
        if (!Number.isSafeInteger(nextSeq) || nextSeq !== currentSeq + 1) {
          throw new ConversationSequenceAllocationError(
            "conversation sequence update returned no exact next sequence"
          );
        }

        const [created] = await tx
          .insert(conversationMessages)
          .values({
            id: input.id ?? randomUUID(),
            conversationId: input.conversationId,
            seq: nextSeq,
            senderType: "user",
            senderUserId,
            kind: input.kind,
            contentJson: input.contentJson,
            ...(input.threadRootId ? { threadRootId: input.threadRootId } : {}),
            createdAt: at
          })
          .returning();
        if (!created) {
          throw new ConversationMessageInsertFailedError("message insert returned no row");
        }
        return created;
      });
    },

    // R12 批4a：新增方法，createUserMessage 上面一字未改。刻意比 createUserMessage 精简——Cuu 不是
    // workspace 成员，不需要（也无法）复用 lockActiveMembershipSet/lockConversationParticipant 那两段
    // 人类发言人校验；调用方（services/conversation-turns.ts）在调这个方法之前已经用
    // findVisibleAccessRecord 确认过发起 turn 的人类是会话的可见参与者，这里只需要重新锁定并确认
    // 会话本身仍然活跃（租户围栏 + 并发安全，与 createUserMessage 同一套 seq 分配防重复模式）。
    async createCuuMessage(input) {
      assertCuuMessageContent(input.contentJson);
      const at = input.at ?? new Date();
      return db.transaction(async (tx) => {
        const locator = await readConversationProjectId(tx, input);
        if (!locator) {
          throw new ConversationAccessDeniedError("cuu message target conversation is not active");
        }
        const project = await lockActiveProject(tx, {
          workspaceId: input.workspaceId,
          projectId: locator.projectId
        });
        if (!project) {
          throw new ConversationAccessDeniedError("cuu message target project is not active");
        }
        const conversation = await lockActiveConversation(tx, {
          workspaceId: input.workspaceId,
          projectId: locator.projectId,
          conversationId: input.conversationId
        });
        if (!conversation) {
          throw new ConversationAccessDeniedError("cuu message target conversation is not active");
        }

        if (input.threadRootId) {
          const [root] = await tx
            .select({ id: conversationMessages.id })
            .from(conversationMessages)
            .where(
              and(
                eq(conversationMessages.conversationId, input.conversationId),
                eq(conversationMessages.id, input.threadRootId)
              )
            )
            .limit(1);
          if (!root) {
            throw new ConversationThreadRootMismatchError(
              "thread root does not belong to the target conversation"
            );
          }
        }

        const currentSeq = conversation.nextSeq;
        if (!Number.isSafeInteger(currentSeq) || currentSeq < 0) {
          throw new ConversationSequenceAllocationError("stored conversation sequence is not a safe integer");
        }
        if (currentSeq >= Number.MAX_SAFE_INTEGER) {
          throw new ConversationSequenceExhaustedError("conversation sequence space is exhausted");
        }
        const [allocation] = await tx
          .update(projectConversations)
          .set({
            nextSeq: sql<number>`${projectConversations.nextSeq} + 1`,
            updatedAt: at
          })
          .where(
            and(
              eq(projectConversations.workspaceId, input.workspaceId),
              eq(projectConversations.id, input.conversationId),
              eq(projectConversations.projectId, conversation.projectId),
              eq(projectConversations.nextSeq, currentSeq),
              isNull(projectConversations.deletedAt)
            )
          )
          .returning({ nextSeq: projectConversations.nextSeq });
        const nextSeq = allocation?.nextSeq;
        if (!Number.isSafeInteger(nextSeq) || nextSeq !== currentSeq + 1) {
          throw new ConversationSequenceAllocationError(
            "conversation sequence update returned no exact next sequence"
          );
        }

        const [created] = await tx
          .insert(conversationMessages)
          .values({
            id: input.id ?? randomUUID(),
            conversationId: input.conversationId,
            seq: nextSeq,
            senderType: "cuu",
            senderUserId: null,
            kind: "text",
            contentJson: input.contentJson,
            ...(input.threadRootId ? { threadRootId: input.threadRootId } : {}),
            createdAt: at
          })
          .returning();
        if (!created) {
          throw new ConversationMessageInsertFailedError("cuu message insert returned no row");
        }
        return created;
      });
    },

    async listMessagesAfter(input) {
      assertCursor(input.afterSeq);
      assertLimit(input.limit);
      const access = await readVisibleAccess(db, input);
      if (!access) {
        return null;
      }
      const rows = await db
        .select(messageSelection)
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
            eq(workspaceMemberships.userId, input.viewerUserId),
            isNull(workspaceMemberships.deletedAt)
          )
        )
        .leftJoin(
          conversationParticipants,
          and(
            eq(conversationParticipants.conversationId, projectConversations.id),
            eq(conversationParticipants.userId, input.viewerUserId)
          )
        )
        .where(
          and(
            eq(conversationMessages.conversationId, input.conversationId),
            gt(conversationMessages.seq, input.afterSeq),
            activeConversationCondition(input)
          )
        )
        .orderBy(asc(conversationMessages.seq))
        .limit(input.limit + 1);
      const pageRows = rows.slice(0, input.limit) as ConversationMessageRow[];
      return {
        rows: pageRows,
        hasMore: rows.length > input.limit,
        nextAfterSeq: pageRows.at(-1)?.seq ?? input.afterSeq
      };
    },

    // R12 批8：反向翻页——同一份 access 判定（readVisibleAccess）+ 同一份 activeConversationCondition，
    // 唯一的区别是排序方向（seq 降序找离 beforeSeq 最近的一页）与游标比较符（lt 而非 gt）。取回后翻正
    // 序，保证 rows 始终是 seq 升序（和 listMessagesAfter 的页形状一致，渲染层不需要为方向分叉排序）。
    async listMessagesBefore(input) {
      assertCursor(input.beforeSeq);
      assertLimit(input.limit);
      const access = await readVisibleAccess(db, input);
      if (!access) {
        return null;
      }
      const rows = await db
        .select(messageSelection)
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
            eq(workspaceMemberships.userId, input.viewerUserId),
            isNull(workspaceMemberships.deletedAt)
          )
        )
        .leftJoin(
          conversationParticipants,
          and(
            eq(conversationParticipants.conversationId, projectConversations.id),
            eq(conversationParticipants.userId, input.viewerUserId)
          )
        )
        .where(
          and(
            eq(conversationMessages.conversationId, input.conversationId),
            lt(conversationMessages.seq, input.beforeSeq),
            activeConversationCondition(input)
          )
        )
        .orderBy(desc(conversationMessages.seq))
        .limit(input.limit + 1);
      const hasMore = rows.length > input.limit;
      const pageRows = (rows.slice(0, input.limit) as ConversationMessageRow[]).reverse();
      return {
        rows: pageRows,
        hasMore,
        nextBeforeSeq: pageRows.at(0)?.seq ?? input.beforeSeq
      };
    }
  };
}
