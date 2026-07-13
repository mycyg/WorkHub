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
  // R13 批 G1（小群）：conversation_participants 的真实行数（含创建者）——服务端回话判定的
  // "1:1 vs 小群"维度（见 apps/api/src/services/conversation-turns.ts 的 mentionsCuu/respondDecider
  // 接缝）从这里读，不是另开一次循环查询。只在 findVisibleAccessRecord 上附加（见下），
  // listMessagesAfter/listMessagesBefore 复用的 readVisibleAccess 内部辅助类型不带这个字段——
  // 那两条是高频轮询路径，不需要为一个用不上的字段多付一次 count 查询。
  participantCount: number;
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
  // R13 批 G1（小群）：会话级「Cuu 是否参与」硬开关。可选——省略时仓库层退回 true（同 DB 列
  // default true、同 createConversationRequestSchema.cuu_enabled 的 zod default(true)，三处默认值
  // 保持一致，不会出现"契约说默认开、仓库测试没传却建出关闭会话"的漂移）。
  cuuEnabled?: boolean;
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

// R12 批4a：协同会话 turn 落库的 Cuu 回应——最初 kind 固定 'text'。sender_user_id 固定 null（Cuu 不是
// workspace 成员，不需要也不能过 createUserMessage 那套 membership/participant 校验），这一点在下面
// 三个分支里都不变。memory_citations 是本轮实际注入过的记忆/技能引用清单，additive，由调用方
// （services/conversation-turns.ts）组装好后原样落 content_json。
//
// R13 批4c（Cuu 对话工具面）：扩成判别联合——file_card（发文件卡）、tool_note（工具调用透明日志）都是
// conversation_messages_kind_ck 既有 check 约束里本来就允许的值（'text'|'file_card'|'action_card'|
// 'system_event'|'tool_note'，未新增迁移），只是 createCuuMessage 之前只会写 'text'。这里只是把
// "这个方法能写的 kind"对齐到"DB 已经允许、Cuu 有资格写的 kind"子集，不涉及任何 schema 改动。
// is_clarifying_question/clarify_options/clarify_placeholder 是 text 分支上的 additive 标记，对齐
// @workhub/contracts 的 conversationTextContentSchema 同名字段（该文件顶部注释解释了为什么澄清追问
// 复用 text kind 而不是新增 DB kind：范围围栏不许碰 schema/迁移）。
export type CreateCuuMessageInput = {
  id?: string;
  workspaceId: string;
  conversationId: string;
  threadRootId?: string;
  at?: Date;
} & (
  | {
      kind: "text";
      contentJson: {
        text: string;
        memory_citations?: Array<{ kind: "user_memory" | "team_skill"; title: string }>;
        is_clarifying_question?: boolean;
        clarify_options?: string[];
        clarify_placeholder?: string;
      };
    }
  | { kind: "file_card"; contentJson: { drive_item_id: string; snapshot_name: string } }
  // tool_note 的内容形状留给服务层的 boundedConversationObjectContentSchema 校验（同 system_event/
  // action_card 现有的分工）；仓库层只做"是个普通对象、不是数组"这一档次的防御性检查。
  | { kind: "tool_note"; contentJson: Record<string, unknown> }
);

export type ListConversationMessagesInput = {
  workspaceId: string;
  viewerUserId: string;
  conversationId: string;
  afterSeq: number;
  limit: number;
};

// R13 批 C1（会话上下文压缩）：createTurn 刷新滚动摘要后落库用——只更新摘要正文与覆盖游标这两列，
// 不碰 nextSeq/其它任何列（与 createCuuMessage/createUserMessage 那套「分配 seq、插消息」的事务完全
// 独立，这里只是给已经存在的会话行做一次幂等的字段更新）。
export type UpdateContextSummaryInput = {
  workspaceId: string;
  conversationId: string;
  summaryMd: string;
  throughSeq: number;
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

// R13 批4c/G1（回话判定器）：listReplyJudgeCandidates 的输入/输出——见该方法实现处的注释了解为什么
// 只挑 participantCount>1 的会话、为什么是两条查询而不是一条 LATERAL。
export type ListReplyJudgeCandidatesInput = {
  limit: number;
  sinceCreatedAt: Date;
};

export type ReplyJudgeCandidateRow = {
  conversationId: string;
  workspaceId: string;
  projectId: string;
  participantCount: number;
  lastMessageId: string;
  lastMessageSeq: number;
  lastMessageSenderUserId: string;
  lastMessageKind: ConversationMessageRow["kind"];
  lastMessageContentJson: Record<string, unknown>;
  lastMessageCreatedAt: Date;
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
  // R13 批4c/G1：新增，不改动上面任何既有方法的签名/行为——回话判定器 worker 的候选扫描（跨会话，
  // 无 viewerUserId，与 action-cards.ts 的 listObserverCandidates 同一档次的"系统级批量读"）。
  listReplyJudgeCandidates: (input: ListReplyJudgeCandidatesInput) => Promise<ReplyJudgeCandidateRow[]>;
  // R13 批 C1：新增，不改动上面任何既有方法的签名/行为——滚动摘要落库。
  updateContextSummary: (input: UpdateContextSummaryInput) => Promise<void>;
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
  // R13 批 G1（小群）：加进显式投影——conversationSelection 是这个仓库文件里对 project_conversations
  // 的唯一 select 列表，不加这一行 access.conversation.cuuEnabled 在运行时会是 undefined（哪怕
  // ConversationRow 的 TS 类型因为 schema 改了而"看起来"总是有这个字段）。
  cuuEnabled: projectConversations.cuuEnabled,
  // R13 批 C1（会话上下文压缩）：同上一行的教训——不显式投影，createTurn 读到的 context_summary_md/
  // context_summary_through_seq 就是 undefined，压缩触发判定与摘要注入都会悄悄失效。
  contextSummaryMd: projectConversations.contextSummaryMd,
  contextSummaryThroughSeq: projectConversations.contextSummaryThroughSeq,
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

// R13 批 C1：同一档次的轻量防御性检查（与 assertCursor/assertLimit 同款），不复述调用方
// （services/conversation-turns.ts）已经做过的压缩触发判定逻辑。
function assertUpdateContextSummaryInput(input: UpdateContextSummaryInput) {
  if (!Number.isSafeInteger(input.throughSeq) || input.throughSeq < 0) {
    throw new ConversationRepositoryInputError("context summary through-seq must be a non-negative safe integer");
  }
  if (typeof input.summaryMd !== "string" || input.summaryMd.trim().length === 0) {
    throw new ConversationRepositoryInputError("context summary markdown must be non-empty");
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
// R13 批4c：按 kind 分支扩展同一档次的检查，text 分支保持原有校验完全不变。
function assertCuuMessageContent(input: CreateCuuMessageInput) {
  if (input.kind === "text") {
    const contentJson = input.contentJson;
    if (typeof contentJson.text !== "string" || contentJson.text.length === 0) {
      throw new ConversationRepositoryInputError("cuu text messages require non-empty text metadata");
    }
    if (contentJson.memory_citations !== undefined && !Array.isArray(contentJson.memory_citations)) {
      throw new ConversationRepositoryInputError("cuu memory citations must be an array when present");
    }
    if (contentJson.clarify_options !== undefined && !Array.isArray(contentJson.clarify_options)) {
      throw new ConversationRepositoryInputError("cuu clarify options must be an array when present");
    }
    return;
  }
  if (input.kind === "file_card") {
    const contentJson = input.contentJson;
    if (
      typeof contentJson.drive_item_id !== "string" ||
      contentJson.drive_item_id.length === 0 ||
      typeof contentJson.snapshot_name !== "string" ||
      contentJson.snapshot_name.length === 0
    ) {
      throw new ConversationRepositoryInputError("cuu file card messages require drive item and snapshot metadata");
    }
    return;
  }
  // tool_note
  if (!input.contentJson || typeof input.contentJson !== "object" || Array.isArray(input.contentJson)) {
    throw new ConversationRepositoryInputError("cuu tool note messages require an object content payload");
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

// R13 批 G1：不带 participantCount 的内部行形状——listMessagesAfter/listMessagesBefore 这两条高频轮询
// 路径只用它做一次可见性布尔判断，不需要额外一次 count 查询（见 ConversationAccessRecord 顶部注释）。
type ConversationAccessRow = Omit<ConversationAccessRecord, "participantCount">;

async function readVisibleAccess(
  db: WorkHubDb,
  input: FindConversationAccessInput & { projectId?: string }
): Promise<ConversationAccessRow | null> {
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
  return (rows[0] as ConversationAccessRow | undefined) ?? null;
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
      const access = await readVisibleAccess(db, input);
      if (!access) {
        return null;
      }
      const [participantCountRow] = await db
        .select({ value: sql<number>`count(*)::int` })
        .from(conversationParticipants)
        .where(eq(conversationParticipants.conversationId, access.conversation.id));
      return { ...access, participantCount: participantCountRow?.value ?? 0 };
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
            cuuEnabled: input.cuuEnabled ?? true,
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
      assertCuuMessageContent(input);
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
            kind: input.kind,
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
    },

    // R13 批4c/G1（回话判定器候选扫描）：不是给某个人类查——是给后台判定器 worker 扫「哪些小群
    // （collab 会话，participantCount>1）最近有一条新的人类消息，值得判一下 Cuu 该不该接话」。
    // 只挑 participantCount>1（真正的多人小群）——今天的 1:1 协同会话（G1 之前，rail.ts 建会话时
    // participant_user_ids 恒为空数组，故 participantCount 恒为 1）继续 100% 由桌面端既有的
    // 「发消息后自动请一轮 turn」路径处理（apps/desktop-webview/src/workbench/chat/turn.ts 的
    // shouldRequestConversationTurn），本方法刻意不把它们纳入候选——否则同一条消息会被桌面端和这个
    // 判定器 worker 各触发一次 turn，重复消耗预算、甚至可能出现两条 Cuu 回复。等 G1 的建群 UI 落地、
    // 真正出现 participantCount>1 的会话之前，这个方法在当前仓库状态下恒返回空数组（无副作用地
    // 提前就位）。
    //
    // 两条查询而非一条 LATERAL 子查询：先聚合出候选会话 id（按参与者数/最近人类消息时间过滤+限流），
    // 再用一条 IN 查询把这些会话各自最新的人类消息一次性取回、在内存里按会话归并成"每会话一条"——
    // 避免在候选列表上循环发查询（04 铁律#4），也避免依赖本仓库其它地方未曾用过的 DISTINCT ON/
    // LATERAL 语法。
    async listReplyJudgeCandidates(input) {
      assertLimit(input.limit);
      const participantCountSelection = sql<number>`count(distinct ${conversationParticipants.id})`.mapWith(Number);
      const groups = await db
        .select({
          conversationId: projectConversations.id,
          workspaceId: projectConversations.workspaceId,
          projectId: projectConversations.projectId,
          participantCount: participantCountSelection
        })
        .from(projectConversations)
        .innerJoin(
          projects,
          and(
            eq(projects.id, projectConversations.projectId),
            eq(projects.workspaceId, projectConversations.workspaceId)
          )
        )
        .innerJoin(conversationParticipants, eq(conversationParticipants.conversationId, projectConversations.id))
        .innerJoin(
          conversationMessages,
          and(
            eq(conversationMessages.conversationId, projectConversations.id),
            eq(conversationMessages.senderType, "user")
          )
        )
        .where(
          and(
            eq(projectConversations.kind, "collab"),
            isNull(projectConversations.deletedAt),
            eq(projects.archived, false),
            isNull(projects.deletedAt)
          )
        )
        .groupBy(projectConversations.id, projectConversations.workspaceId, projectConversations.projectId)
        .having(
          sql`count(distinct ${conversationParticipants.id}) > 1 and max(${conversationMessages.createdAt}) >= ${input.sinceCreatedAt}`
        )
        .orderBy(sql`max(${conversationMessages.createdAt}) desc`)
        .limit(input.limit);

      if (groups.length === 0) {
        return [];
      }

      const conversationIds = groups.map((group) => group.conversationId);
      // 每会话最多 20 条打底：候选会话数已经被上面的 limit 卡死，这里只是给"归并出每会话最新一条"
      // 留够余量，不是一个会随候选数无界增长的查询。
      const recentUserMessages = await db
        .select({
          conversationId: conversationMessages.conversationId,
          id: conversationMessages.id,
          seq: conversationMessages.seq,
          senderUserId: conversationMessages.senderUserId,
          kind: conversationMessages.kind,
          contentJson: conversationMessages.contentJson,
          createdAt: conversationMessages.createdAt
        })
        .from(conversationMessages)
        .where(
          and(
            inArray(conversationMessages.conversationId, conversationIds),
            eq(conversationMessages.senderType, "user")
          )
        )
        .orderBy(desc(conversationMessages.seq))
        .limit(Math.min(conversationIds.length * 20, 500));

      const lastByConversation = new Map<string, (typeof recentUserMessages)[number]>();
      for (const row of recentUserMessages) {
        if (!lastByConversation.has(row.conversationId)) {
          lastByConversation.set(row.conversationId, row);
        }
      }

      const candidates: ReplyJudgeCandidateRow[] = [];
      for (const group of groups) {
        const last = lastByConversation.get(group.conversationId);
        if (!last || !last.senderUserId) {
          continue;
        }
        candidates.push({
          conversationId: group.conversationId,
          workspaceId: group.workspaceId,
          projectId: group.projectId,
          participantCount: group.participantCount,
          lastMessageId: last.id,
          lastMessageSeq: last.seq,
          lastMessageSenderUserId: last.senderUserId,
          lastMessageKind: last.kind,
          lastMessageContentJson: last.contentJson as Record<string, unknown>,
          lastMessageCreatedAt: last.createdAt
        });
      }
      return candidates;
    },

    // R13 批 C1（会话上下文压缩）：滚动摘要落库——只更新 context_summary_md/context_summary_through_seq
    // 这两列，不做 seq 分配（不是消息，不占用 conversation_messages 的 seq 空间）。防止落后的并发压缩
    // 覆盖已经更靠前的覆盖游标：WHERE 里带上 `context_summary_through_seq < :throughSeq`，退化更新
    // 静默无操作而不是报错（调用方本来就把整条压缩路径当 best-effort/fail-open 处理，见
    // apps/api/src/services/conversation-turns.ts 的 tryCompactConversationContext）。
    async updateContextSummary(input) {
      assertUpdateContextSummaryInput(input);
      await db
        .update(projectConversations)
        .set({
          contextSummaryMd: input.summaryMd,
          contextSummaryThroughSeq: input.throughSeq,
          updatedAt: new Date()
        })
        .where(
          and(
            eq(projectConversations.id, input.conversationId),
            eq(projectConversations.workspaceId, input.workspaceId),
            isNull(projectConversations.deletedAt),
            lt(projectConversations.contextSummaryThroughSeq, input.throughSeq)
          )
        );
    }
  };
}
