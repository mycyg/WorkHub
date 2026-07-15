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
  conversationReadCursors,
  messageReactions,
  projectConversations,
  projects,
  users,
  workspaceMemberships
} from "../schema/index.js";

export type ConversationRow = typeof projectConversations.$inferSelect;
export type ConversationParticipantRow = typeof conversationParticipants.$inferSelect;
export type ConversationMessageRow = typeof conversationMessages.$inferSelect;
export type MessageReactionRow = typeof messageReactions.$inferSelect;
export type ConversationReadCursorRow = typeof conversationReadCursors.$inferSelect;
export type ConversationParticipantRole = "owner" | "member";
// R14 批 CHAT：精选五键反应的 ASCII slug 集合。仓库层的规范顺序，页级聚合按这个顺序稳定输出。
export type ConversationReactionKey = "approve" | "disagree" | "done" | "question" | "watch";
export const CONVERSATION_REACTION_KEYS: readonly ConversationReactionKey[] = [
  "approve",
  "disagree",
  "done",
  "question",
  "watch"
];

export type VisibleConversationRow = ConversationRow & {
  participantRole: ConversationParticipantRole | null;
};

export type ConversationAccessRecord = {
  conversation: ConversationRow;
  projectOwnerUserId: string | null;
  // R13 终验修复（个人空间单聊必回）：会话所属项目是否个人空间——conversation-turns.ts 据此放行
  // "个人项目的 main 会话"这一单聊特例（团队项目的 main 仍归观察者，turns 恒 409）。跟着
  // readVisibleAccess 的 select 一起加（不显式投影运行时就是 undefined，教训同 cuuEnabled）。
  projectIsPersonal: boolean;
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
    // R14 批 CHAT（引用回复）：仅 text 新消息可带 replyToMessageId——目标须同会话、存在、未删除
    // （对已删/跨会话/不存在的目标抛 ConversationReplyTargetError → 服务层 400）。file_card 不支持引用。
    | { kind: "text"; contentJson: { text: string }; replyToMessageId?: string }
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

// R14FIX 批 workbench（会话重命名）：只改 title 这一列的幂等更新（不碰 nextSeq/其它任何列，同
// updateContextSummary 那套「给已存在的会话行做一次字段更新」的事务独立）。语义红线（仅 collab、
// 仅参与者/owner）在服务层强制——这里只负责租户安全（workspaceId + 未删除围栏）的原子写。
export type RenameConversationInput = {
  workspaceId: string;
  conversationId: string;
  title: string;
  at?: Date;
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

// R15 批 B（人对人私聊）：openOrCreateDm 的输入——只需两个人类 user id + 工作区，容器项目由本方法惰性
// 创建（不需要调用方先解析出容器 id）。target 须与 actor 同工作区活跃成员、且 target≠actor（自聊在
// 服务层先行 400，仓库层再兜一次 InputError）。
export type OpenOrCreateDmInput = {
  workspaceId: string;
  actorUserId: string;
  targetUserId: string;
  at?: Date;
};

// created=true 表示这次真的新建了 DM（含 2 参与者）；false 表示命中既有 DM 或并发双开回退到既有。
export type OpenOrCreateDmResult = {
  conversation: ConversationRow;
  created: boolean;
};

// R15 批 B（人对人私聊）：listDmsForUser 的输入——actor 的工作区 + user id + 列表上限。只读、参与者门控
// （只回 actor 是 participant 的 DM），与 openOrCreateDm 一样限定在工作区级 DM 容器项目内。
export type ListDmsForUserInput = {
  workspaceId: string;
  userId: string;
  limit: number;
};

// 一条 DM 的仓库结果：会话行 + 两名活跃参与者（含昵称、is_self 由 actor 判定）。对方账号已注销的 DM
// 在仓库层被过滤掉（活跃参与者 < 2），不进列表。
export type DmParticipantRow = {
  userId: string;
  nickname: string;
  isSelf: boolean;
};
export type DmListForUserRow = {
  conversation: ConversationRow;
  participants: DmParticipantRow[];
};

// R15 批 B：DM 会话查重键——两个 user id 归一化（小写）后排序，再拼 'dm:' 前缀。同一对用户与顺序无关
// 得到同一个 key（workspace 维度由容器项目 id 天然限定，见 dmKey 列/唯一索引注释）。导出供单测直接覆盖。
export function normalizeDmKey(userIdA: string, userIdB: string): string {
  const normalized = [userIdA.trim().toLowerCase(), userIdB.trim().toLowerCase()].sort();
  return `dm:${normalized[0]}:${normalized[1]}`;
}

// R15 批 B：DM 容器项目的固定命名与 slug——slug 带 workspace 短 id（前 8 位），(workspace_id, slug)
// 既有唯一索引 + is_dm_container 部分唯一索引双重兜底「每工作区至多一个容器」。
const DM_CONTAINER_PROJECT_NAME = "直达消息";
const DM_CONTAINER_OWNER_NICKNAME = "系统";
function dmContainerSlug(workspaceId: string): string {
  return `dm-container-${workspaceId.slice(0, 8)}`;
}

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

// ── R14 批 CHAT：编辑 / 墓碑删除 / 引用 / 置顶 / reaction / 已读游标 ──────────────────────

export type EditMessageInput = {
  workspaceId: string;
  conversationId: string;
  messageId: string;
  editorUserId: string;
  text: string;
  // 编辑窗（毫秒）——服务端策略（15 分钟），仓库把「created_at + window >= at」并进同一次原子判定，
  // 不跨调用留 TOCTOU 缝。
  editWindowMs: number;
  at?: Date;
};

export type DeleteMessageInput = {
  workspaceId: string;
  conversationId: string;
  messageId: string;
  deleterUserId: string;
  at?: Date;
};

export type PinMessageInput = {
  workspaceId: string;
  conversationId: string;
  messageId: string;
  pinnerUserId: string;
  at?: Date;
};

export type UnpinMessageInput = {
  workspaceId: string;
  conversationId: string;
  messageId: string;
  at?: Date;
};

export type ReactionMutationInput = {
  workspaceId: string;
  conversationId: string;
  messageId: string;
  userId: string;
  reactionKey: ConversationReactionKey;
  at?: Date;
};

// 页级 reaction 全量聚合——一条消息一个键一行，user_ids 是按键去重后的全部反应者（幂等替换语义）。
export type MessageReactionAggregate = {
  key: ConversationReactionKey;
  userIds: string[];
};

export type ReactionMutationResult = {
  reactions: MessageReactionAggregate[];
};

export type AdvanceReadCursorInput = {
  workspaceId: string;
  conversationId: string;
  userId: string;
  lastReadSeq: number;
  at?: Date;
};

export type ReadReceiptRow = {
  userId: string;
  lastReadSeq: number;
};

export type ListPinsInput = {
  workspaceId: string;
  conversationId: string;
  limit: number;
};

// 引用预览的目标消息投影——服务层据此拼 preview_text(≤80)+deleted 布尔，不在仓库层做文本裁剪。
export type ReplyPreviewTargetRow = {
  id: string;
  senderType: ConversationMessageRow["senderType"];
  senderUserId: string | null;
  kind: ConversationMessageRow["kind"];
  contentJson: Record<string, unknown>;
  deletedAt: Date | null;
};

export type ConversationRepository = {
  listVisibleForProject: (
    input: ListVisibleConversationsInput
  ) => Promise<VisibleConversationListResult | null>;
  findVisibleAccessRecord: (input: FindConversationAccessInput) => Promise<ConversationAccessRecord | null>;
  createCollab: (input: CreateCollabConversationInput) => Promise<CreatedCollabConversation>;
  // R15 批 B（人对人私聊）：查/开一对用户的 DM——惰性建工作区级容器项目、按 dm_key 查重、未命中则事务内
  // 建 collab 会话（cuu_enabled=false）+ 2 参与者，并发双开撞唯一约束后回退查询既有。新增方法，不改动
  // 上面任何既有方法的签名/行为。
  openOrCreateDm: (input: OpenOrCreateDmInput) => Promise<OpenOrCreateDmResult>;
  // R15 批 B（人对人私聊）：actor 参与的 DM 列表（参与者门控、含两名参与者昵称）。新增只读方法，不改动
  // 上面任何既有方法的签名/行为——rail「私聊」分组的唯一数据源，桌面 chat 视图据此拿到真实参与者集合。
  listDmsForUser: (input: ListDmsForUserInput) => Promise<DmListForUserRow[]>;
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
  // R14FIX 批 workbench：新增，不改动上面任何既有方法——协同会话改名（返回改名后的会话行）。
  renameConversation: (input: RenameConversationInput) => Promise<ConversationRow>;
  // R14 批 CHAT：以下全部新增，不改动上面任何既有方法。语义红线在服务层强制（见 apps/api/src/
  // services/conversations.ts），仓库层负责租户安全的原子写与页级无 N+1 聚合。
  editMessage: (input: EditMessageInput) => Promise<ConversationMessageRow>;
  deleteMessage: (input: DeleteMessageInput) => Promise<ConversationMessageRow>;
  pinMessage: (input: PinMessageInput) => Promise<ConversationMessageRow>;
  unpinMessage: (input: UnpinMessageInput) => Promise<ConversationMessageRow>;
  addReaction: (input: ReactionMutationInput) => Promise<ReactionMutationResult>;
  removeReaction: (input: ReactionMutationInput) => Promise<ReactionMutationResult>;
  advanceReadCursor: (input: AdvanceReadCursorInput) => Promise<{ lastReadSeq: number }>;
  listReceipts: (input: { workspaceId: string; conversationId: string }) => Promise<ReadReceiptRow[]>;
  listPins: (input: ListPinsInput) => Promise<ConversationMessageRow[]>;
  // 页级富化：给一页/一批消息一次性取回 reaction 聚合与引用目标——禁 N+1（每批一条 grouped 查询）。
  listReactionsForMessages: (input: {
    conversationId: string;
    messageIds: string[];
  }) => Promise<Map<string, MessageReactionAggregate[]>>;
  listReplyPreviews: (input: {
    conversationId: string;
    messageIds: string[];
  }) => Promise<Map<string, ReplyPreviewTargetRow>>;
  // R14 批 FEEDBACK：反馈目标消息的只读定位（无锁）——服务层据此判定 sender_type/kind/deleted_at 是否
  // 对反馈开放（只对 Cuu 的活文字回复）。会话级可见性由服务层先行 assertConversationAccess 把关，
  // 这里只按 workspace + 会话定位消息本体，不做二次可见性判定（与 lockActiveMessage 同款 workspace 围栏）。
  findMessageForFeedback: (input: {
    workspaceId: string;
    conversationId: string;
    messageId: string;
  }) => Promise<ConversationMessageRow | null>;
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
// R14 批 CHAT：消息动作（编辑/删除/置顶/反应）的结构性失败——服务层映射到具体 HTTP 状态。
export class ConversationMessageNotFoundError extends NamedConversationRepositoryError {}
// 编辑/删除只许本人（sender_type='user' 且 sender_user_id=自己）——Cuu/system/他人消息命中这条。
export class ConversationMessageActorMismatchError extends NamedConversationRepositoryError {}
// 编辑只许 kind='text'（file_card 等不可编辑）。
export class ConversationMessageNotTextError extends NamedConversationRepositoryError {}
// 编辑窗（15 分钟）已过。
export class ConversationMessageEditWindowError extends NamedConversationRepositoryError {}
// 目标消息已是墓碑——编辑/置顶/加反应命中这条（幂等删除不走这条，见 deleteMessage）。
export class ConversationMessageDeletedError extends NamedConversationRepositoryError {}
export class ConversationMessageMutationFailedError extends NamedConversationRepositoryError {}
// R14 批 CHAT（引用回复）：reply_to 目标跨会话/不存在/已删除——服务层映射到 400。
export class ConversationReplyTargetError extends NamedConversationRepositoryError {}
// R15 批 B（人对人私聊）：openOrCreateDm 的目标用户不是本工作区的活跃成员——服务层映射到 404
// （跨工作区 DM 不存在；不泄漏「这个人存在但不在你工作区」的细节，与既有 fail-closed 口径一致）。
export class ConversationDmTargetError extends NamedConversationRepositoryError {}
// R15 批 B：DM 容器项目惰性创建/回查都落空的兜底（理论上不该发生：唯一索引兜底并发后必能回查到）。
export class ConversationDmContainerError extends NamedConversationRepositoryError {}

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
  // R15 批 B（人对人私聊）：dm_key 必须显式投影——不加进 conversationSelection，DM 会话读回的
  // dmKey 运行时就是 undefined（同 cuuEnabled/contextSummary 的教训），VM 的 is_dm 推导与查重都会失效。
  dmKey: projectConversations.dmKey,
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
  // R14 批 CHAT：编辑/墓碑/引用/置顶列必须显式投影——不加进 messageSelection，listMessagesAfter/Before
  // 返回的行在运行时这些字段就是 undefined（同 cuuEnabled/contextSummary 的教训）。下游墓碑短路
  // （historyDisplayText 读 deletedAt）与 VM 富化（编辑标/置顶/引用块）全靠这几列真的被读回来。
  editedAt: conversationMessages.editedAt,
  deletedAt: conversationMessages.deletedAt,
  deletedByUserId: conversationMessages.deletedByUserId,
  replyToMessageId: conversationMessages.replyToMessageId,
  pinnedAt: conversationMessages.pinnedAt,
  pinnedByUserId: conversationMessages.pinnedByUserId,
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

// R14 批 CHAT：已读回执读取上限——main 会话可能是整工作区成员，游标行数无界，读端点必须封顶
// （04 铁律#4）。500 对内部团队规模足够，聚合式「已读 N/M」在服务/客户端上层算。
const CONVERSATION_READ_RECEIPTS_CAP = 500;
// 页级富化（reactions/reply 预览）的 IN 列表上限——正常调用方传的是一页消息（≤100）或置顶清单
// （≤50），这里只做防御性封顶，防止误用把无界 id 列表拼进 IN。
const CONVERSATION_PAGE_ENRICH_CAP = 200;

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
      projectIsPersonal: projects.isPersonal,
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
      isPersonal: projects.isPersonal,
      // R15 批 B：显式投影容器标记——createCollab 据此拒绝在 DM 容器项目内新建普通协同会话。
      isDmContainer: projects.isDmContainer
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

// R15 批 B（人对人私聊）：惰性取/建工作区级 DM 容器项目，返回容器项目 id。原子创建复用「项目 main
// 会话原子创建」的既有先例（ensureActiveMain）：先 onConflictDoNothing 插入（(workspace_id, slug)
// 既有唯一索引 + is_dm_container 部分唯一索引双重兜底并发），落空则回查已存在的那条。事务内调用。
async function lockOrCreateDmContainer(
  db: WorkHubDb,
  input: { workspaceId: string; at: Date }
): Promise<string> {
  const inserted = await db
    .insert(projects)
    .values({
      id: randomUUID(),
      workspaceId: input.workspaceId,
      name: DM_CONTAINER_PROJECT_NAME,
      slug: dmContainerSlug(input.workspaceId),
      ownerNickname: DM_CONTAINER_OWNER_NICKNAME,
      isDmContainer: true,
      archived: false,
      nextSeq: 0,
      createdAt: input.at,
      updatedAt: input.at
    })
    .onConflictDoNothing({ target: [projects.workspaceId, projects.slug] })
    .returning({ id: projects.id });
  if (inserted[0]) {
    return inserted[0].id;
  }
  const [existing] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, input.workspaceId),
        eq(projects.isDmContainer, true),
        isNull(projects.deletedAt)
      )
    )
    .limit(1);
  if (!existing) {
    throw new ConversationDmContainerError("dm container project could not be resolved");
  }
  return existing.id;
}

// R15 批 B：按 (容器项目 id, dm_key) 查既有 DM 会话（未删除）。命中即返回既有会话行（含 dmKey 投影）。
async function findDmConversationByKey(
  db: WorkHubDb,
  input: { projectId: string; dmKey: string }
): Promise<ConversationRow | null> {
  const [row] = await db
    .select(conversationSelection)
    .from(projectConversations)
    .where(
      and(
        eq(projectConversations.projectId, input.projectId),
        eq(projectConversations.dmKey, input.dmKey),
        isNull(projectConversations.deletedAt)
      )
    )
    .limit(1);
  return (row as ConversationRow | undefined) ?? null;
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

// R14 批 CHAT：锁定一条消息（租户安全：只锁属于本工作区、且所在会话未删的消息），供编辑/删除/置顶/
// 反应的原子写用。FOR UPDATE OF conversation_messages 只锁消息行本身（不锁会话），串行化并发编辑/删除。
async function lockActiveMessage(
  db: WorkHubDb,
  input: { workspaceId: string; conversationId: string; messageId: string }
): Promise<ConversationMessageRow | null> {
  const [row] = await db
    .select({ message: conversationMessages })
    .from(conversationMessages)
    .innerJoin(
      projectConversations,
      and(
        eq(projectConversations.id, conversationMessages.conversationId),
        eq(projectConversations.workspaceId, input.workspaceId),
        isNull(projectConversations.deletedAt)
      )
    )
    .where(
      and(
        eq(conversationMessages.conversationId, input.conversationId),
        eq(conversationMessages.id, input.messageId)
      )
    )
    .for("update", { of: conversationMessages })
    .limit(1);
  return row?.message ?? null;
}

// R14 批 CHAT：一条消息当前的 reaction 全量聚合（单消息版，供加/减反应后组装 SSE 事件）。按规范键序
// 稳定输出，跳过零反应者的键。
async function aggregateMessageReactions(
  db: WorkHubDb,
  input: { conversationId: string; messageId: string }
): Promise<MessageReactionAggregate[]> {
  const rows = await db
    .select({
      reactionKey: messageReactions.reactionKey,
      userIds: sql<string[]>`array_agg(${messageReactions.userId} order by ${messageReactions.userId})`
    })
    .from(messageReactions)
    .where(
      and(
        eq(messageReactions.conversationId, input.conversationId),
        eq(messageReactions.messageId, input.messageId)
      )
    )
    .groupBy(messageReactions.reactionKey);
  const byKey = new Map<ConversationReactionKey, string[]>();
  for (const row of rows) {
    byKey.set(row.reactionKey as ConversationReactionKey, row.userIds ?? []);
  }
  const aggregates: MessageReactionAggregate[] = [];
  for (const key of CONVERSATION_REACTION_KEYS) {
    const userIds = byKey.get(key);
    if (userIds && userIds.length > 0) {
      aggregates.push({ key, userIds });
    }
  }
  return aggregates;
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
        // R15 批 B：DM 容器项目不接受普通协同会话——DM 会话只能经 openOrCreateDm 建（固定 2 人 +
        // dm_key + cuu_enabled=false）。fail-closed 与个人空间同款（404），不给用户「在容器里建群」的入口。
        if (project.isDmContainer) {
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

    // R15 批 B（人对人私聊）：查/开一对用户的 DM。刻意不复用 createCollab——DM 不是「在某项目里建群」，
    // 而是「在工作区级容器项目里，对一对用户查重开聊」：容器惰性创建、按 dm_key 查重、固定 2 人、
    // cuu_enabled=false（B5 拍板）。整段在一个事务里，与「项目 main 会话原子创建」同一套幂等模式
    // （onConflictDoNothing + returning 落空回查），并发双开靠 (project_id, dm_key) 部分唯一索引兜底。
    async openOrCreateDm(input) {
      const actorUserId = input.actorUserId.trim().toLowerCase();
      const targetUserId = input.targetUserId.trim().toLowerCase();
      if (!actorUserId || !targetUserId) {
        throw new ConversationRepositoryInputError("direct message requires both actor and target users");
      }
      // 自聊在服务层已先行 400；仓库层再兜一次，保证任何调用方都拿不到「和自己开聊」的会话。
      if (actorUserId === targetUserId) {
        throw new ConversationRepositoryInputError("cannot open a direct message with yourself");
      }
      const at = input.at ?? new Date();
      const dmKey = normalizeDmKey(actorUserId, targetUserId);
      return db.transaction(async (tx) => {
        // 1. 惰性取/建工作区级 DM 容器项目。
        const containerProjectId = await lockOrCreateDmContainer(tx, { workspaceId: input.workspaceId, at });
        // 2. 锁双方 workspace 成员行——二人须同工作区活跃成员（跨工作区 DM 不存在，复用 createCollab
        //    的 lockActiveMembershipSet 校验模式）。
        const memberships = await lockActiveMembershipSet(tx, {
          workspaceId: input.workspaceId,
          userIds: [actorUserId, targetUserId]
        });
        const activeIds = new Set(memberships.map((row) => row.userId.toLowerCase()));
        if (!activeIds.has(actorUserId)) {
          throw new ConversationAccessDeniedError("actor is not an active workspace member");
        }
        if (!activeIds.has(targetUserId)) {
          throw new ConversationDmTargetError("target user is not an active member of this workspace");
        }
        // 3. 查既有 DM——命中直接返回（幂等：点头像开聊不越点越多）。
        const existing = await findDmConversationByKey(tx, { projectId: containerProjectId, dmKey });
        if (existing) {
          return { conversation: existing, created: false };
        }
        // 4. 未命中：事务内建 collab 会话（cuu_enabled=false）+ dm_key。onConflictDoNothing 兜并发双开：
        //    撞 (project_id, dm_key) 部分唯一索引则 returning 落空 → 回查既有。
        const conversationId = randomUUID();
        const [created] = await tx
          .insert(projectConversations)
          .values({
            id: conversationId,
            workspaceId: input.workspaceId,
            projectId: containerProjectId,
            kind: "collab",
            title: "私聊",
            visibility: "private",
            nextSeq: 0,
            cuuEnabled: false,
            dmKey,
            createdBy: actorUserId,
            createdAt: at,
            updatedAt: at
          })
          .onConflictDoNothing({
            target: [projectConversations.projectId, projectConversations.dmKey],
            where: sql`${projectConversations.dmKey} is not null`
          })
          .returning();
        if (!created) {
          // 并发双开：另一发已抢先建好——回查返回既有（不再插参与者，避免重复）。
          const raced = await findDmConversationByKey(tx, { projectId: containerProjectId, dmKey });
          if (!raced) {
            throw new ConversationInsertFailedError("dm conversation insert conflict could not be resolved");
          }
          return { conversation: raced, created: false };
        }
        // 5. 固定 2 参与者：发起者 owner、对方 member。
        await tx.insert(conversationParticipants).values([
          {
            id: randomUUID(),
            conversationId,
            userId: actorUserId,
            role: "owner" as const,
            createdAt: at,
            updatedAt: at
          },
          {
            id: randomUUID(),
            conversationId,
            userId: targetUserId,
            role: "member" as const,
            createdAt: at,
            updatedAt: at
          }
        ]);
        return { conversation: created, created: true };
      });
    },

    // R15 批 B（人对人私聊）：actor 参与的 DM 列表——两步查询（禁 N+1）：
    //  1) 工作区级 DM 容器项目里、dm_key 非空、未删除、actor 是 participant 的会话（按 updatedAt 倒序，
    //     最近聊过的排前）；容器还没被任何人建过（没有 DM）时直接空列表。
    //  2) 对这批会话 id 一次性取回全部活跃参与者 + 昵称（join users 过滤已注销）。
    // 对方账号已注销 → 活跃参与者 < 2 → 整条 DM 不进列表（不能给一个点了打不开的死会话）。
    async listDmsForUser(input) {
      const actorUserId = input.userId.trim().toLowerCase();
      if (!actorUserId) {
        throw new ConversationRepositoryInputError("dm list requires an actor user id");
      }
      if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 500) {
        throw new ConversationRepositoryInputError("dm list limit must be an integer from 1 through 500");
      }
      const [container] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.workspaceId, input.workspaceId),
            eq(projects.isDmContainer, true),
            isNull(projects.deletedAt)
          )
        )
        .limit(1);
      if (!container) {
        return [];
      }
      const conversationRows = await db
        .select(conversationSelection)
        .from(projectConversations)
        .innerJoin(
          conversationParticipants,
          and(
            eq(conversationParticipants.conversationId, projectConversations.id),
            eq(conversationParticipants.userId, actorUserId)
          )
        )
        .where(
          and(
            eq(projectConversations.projectId, container.id),
            eq(projectConversations.workspaceId, input.workspaceId),
            isNotNull(projectConversations.dmKey),
            isNull(projectConversations.deletedAt)
          )
        )
        .orderBy(desc(projectConversations.updatedAt), desc(projectConversations.id))
        .limit(input.limit);
      if (conversationRows.length === 0) {
        return [];
      }
      const conversations = conversationRows as ConversationRow[];
      const conversationIds = conversations.map((row) => row.id);
      const participantRows = await db
        .select({
          conversationId: conversationParticipants.conversationId,
          userId: users.id,
          nickname: users.nickname
        })
        .from(conversationParticipants)
        .innerJoin(
          users,
          and(eq(users.id, conversationParticipants.userId), isNull(users.deletedAt))
        )
        .where(inArray(conversationParticipants.conversationId, conversationIds));
      const byConversation = new Map<string, DmParticipantRow[]>();
      for (const row of participantRows) {
        const bucket = byConversation.get(row.conversationId) ?? [];
        bucket.push({
          userId: row.userId,
          nickname: row.nickname,
          isSelf: row.userId.toLowerCase() === actorUserId
        });
        byConversation.set(row.conversationId, bucket);
      }
      const result: DmListForUserRow[] = [];
      for (const conversation of conversations) {
        const participants = byConversation.get(conversation.id) ?? [];
        // 固定 2 人：actor 自己 + 对方都必须是活跃用户。任一注销（活跃行 < 2）就跳过——不给死会话入口。
        if (participants.length !== 2 || !participants.some((participant) => participant.isSelf)) {
          continue;
        }
        result.push({ conversation, participants });
      }
      return result;
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

        // R14 批 CHAT（引用回复）：目标须同会话、存在、未删除。跨会话/不存在/已删除都抛
        // ConversationReplyTargetError（服务层 → 400）。目标事后被删只是变墓碑，这条引用边靠复合外键
        // 保住、读时 join 判墓碑；这里只在“创建引用消息的当下”拦已删目标。
        const replyToMessageId = input.kind === "text" ? input.replyToMessageId : undefined;
        if (replyToMessageId) {
          const [target] = await tx
            .select({ id: conversationMessages.id, deletedAt: conversationMessages.deletedAt })
            .from(conversationMessages)
            .where(
              and(
                eq(conversationMessages.conversationId, input.conversationId),
                eq(conversationMessages.id, replyToMessageId)
              )
            )
            .limit(1);
          if (!target) {
            throw new ConversationReplyTargetError("reply target does not belong to the target conversation");
          }
          if (target.deletedAt) {
            throw new ConversationReplyTargetError("reply target has been deleted");
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
            ...(replyToMessageId ? { replyToMessageId } : {}),
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
            eq(conversationMessages.senderType, "user"),
            // R14 批 CHAT（下游墓碑过滤）：判定器不能把 Cuu 拉去回应一条已被删除的消息——删掉的
            // 尾消息不再算「最近有一条值得判的人类消息」，也不进下面 recentUserMessages 的归并。
            isNull(conversationMessages.deletedAt)
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
            eq(conversationMessages.senderType, "user"),
            // R14 批 CHAT（下游墓碑过滤）：与上面 groups 查询同口径——归并每会话「最新一条人类消息」
            // 时跳过墓碑，保证挑出的 lastMessage 一定是活着的、可回应的那条。
            isNull(conversationMessages.deletedAt)
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
    },

    // ── R14FIX 批 workbench：协同会话改名 ─────────────────────────────────────────────
    // 只更新 title（+ updatedAt），workspace + 未删除围栏。命中 0 行（会话不存在/跨租户/已删）→
    // ConversationAccessDeniedError（服务层映射 404）。会话种类/参与者鉴权在服务层已把关，这里
    // 只做租户安全的原子写。
    async renameConversation(input) {
      const title = input.title.trim();
      if (title.length === 0 || title.length > 256) {
        throw new ConversationRepositoryInputError("conversation title must be 1..256 characters after trimming");
      }
      const [updated] = await db
        .update(projectConversations)
        .set({ title, updatedAt: input.at ?? new Date() })
        .where(
          and(
            eq(projectConversations.id, input.conversationId),
            eq(projectConversations.workspaceId, input.workspaceId),
            isNull(projectConversations.deletedAt)
          )
        )
        .returning();
      if (!updated) {
        throw new ConversationAccessDeniedError("conversation not found for rename");
      }
      return updated;
    },

    // ── R14 批 CHAT：编辑 ────────────────────────────────────────────────────────────
    // 仅本人（sender_type='user' 且 sender_user_id=自己）、仅 kind='text'、created_at+window 内、
    // 目标未删除。四道判定在锁住消息行后的同一次事务里做，不跨调用留 TOCTOU 缝。
    async editMessage(input) {
      if (typeof input.text !== "string" || input.text.length === 0) {
        throw new ConversationRepositoryInputError("edit text must be a non-empty string");
      }
      if (!Number.isFinite(input.editWindowMs) || input.editWindowMs < 0) {
        throw new ConversationRepositoryInputError("edit window must be a non-negative number of milliseconds");
      }
      const at = input.at ?? new Date();
      const editorUserId = input.editorUserId.toLowerCase();
      return db.transaction(async (tx) => {
        const message = await lockActiveMessage(tx, input);
        if (!message) {
          throw new ConversationMessageNotFoundError("message not found in the active conversation");
        }
        if (message.senderType !== "user" || (message.senderUserId?.toLowerCase() ?? null) !== editorUserId) {
          throw new ConversationMessageActorMismatchError("only the original sender can edit this message");
        }
        if (message.deletedAt) {
          throw new ConversationMessageDeletedError("cannot edit a deleted message");
        }
        if (message.kind !== "text") {
          throw new ConversationMessageNotTextError("only text messages can be edited");
        }
        if (at.getTime() - message.createdAt.getTime() > input.editWindowMs) {
          throw new ConversationMessageEditWindowError("the edit window for this message has closed");
        }
        const [updated] = await tx
          .update(conversationMessages)
          .set({ contentJson: { text: input.text }, editedAt: at })
          .where(
            and(
              eq(conversationMessages.id, input.messageId),
              eq(conversationMessages.conversationId, input.conversationId)
            )
          )
          .returning();
        if (!updated) {
          throw new ConversationMessageMutationFailedError("edit update returned no row");
        }
        return updated;
      });
    },

    // ── R14 批 CHAT：墓碑删除（幂等） ─────────────────────────────────────────────────
    // 仅本人、不限时。墓碑=deleted_at+deleted_by_user_id 置位、content_json 清 {}（file_card 不留
    // 文件名）、顺带取消置顶（删了的消息不该继续挂在置顶栏）。不物理删、seq 不回收。重复删返回现状。
    async deleteMessage(input) {
      const at = input.at ?? new Date();
      const deleterUserId = input.deleterUserId.toLowerCase();
      return db.transaction(async (tx) => {
        const message = await lockActiveMessage(tx, input);
        if (!message) {
          throw new ConversationMessageNotFoundError("message not found in the active conversation");
        }
        if (message.senderType !== "user" || (message.senderUserId?.toLowerCase() ?? null) !== deleterUserId) {
          throw new ConversationMessageActorMismatchError("only the original sender can delete this message");
        }
        if (message.deletedAt) {
          return message;
        }
        const [updated] = await tx
          .update(conversationMessages)
          .set({
            deletedAt: at,
            deletedByUserId: deleterUserId,
            contentJson: {},
            pinnedAt: null,
            pinnedByUserId: null
          })
          .where(
            and(
              eq(conversationMessages.id, input.messageId),
              eq(conversationMessages.conversationId, input.conversationId)
            )
          )
          .returning();
        if (!updated) {
          throw new ConversationMessageMutationFailedError("delete update returned no row");
        }
        return updated;
      });
    },

    // ── R14 批 CHAT：置顶 / 取消置顶（幂等） ──────────────────────────────────────────
    // 会话可见者皆可置顶/取消（可见性在服务层 assertConversationAccess 已把关）；已删除消息不可置顶。
    async pinMessage(input) {
      const at = input.at ?? new Date();
      const pinnerUserId = input.pinnerUserId.toLowerCase();
      return db.transaction(async (tx) => {
        const message = await lockActiveMessage(tx, input);
        if (!message) {
          throw new ConversationMessageNotFoundError("message not found in the active conversation");
        }
        if (message.deletedAt) {
          throw new ConversationMessageDeletedError("cannot pin a deleted message");
        }
        if (message.pinnedAt) {
          return message;
        }
        const [updated] = await tx
          .update(conversationMessages)
          .set({ pinnedAt: at, pinnedByUserId: pinnerUserId })
          .where(
            and(
              eq(conversationMessages.id, input.messageId),
              eq(conversationMessages.conversationId, input.conversationId)
            )
          )
          .returning();
        if (!updated) {
          throw new ConversationMessageMutationFailedError("pin update returned no row");
        }
        return updated;
      });
    },

    async unpinMessage(input) {
      return db.transaction(async (tx) => {
        const message = await lockActiveMessage(tx, input);
        if (!message) {
          throw new ConversationMessageNotFoundError("message not found in the active conversation");
        }
        if (!message.pinnedAt) {
          return message;
        }
        const [updated] = await tx
          .update(conversationMessages)
          .set({ pinnedAt: null, pinnedByUserId: null })
          .where(
            and(
              eq(conversationMessages.id, input.messageId),
              eq(conversationMessages.conversationId, input.conversationId)
            )
          )
          .returning();
        if (!updated) {
          throw new ConversationMessageMutationFailedError("unpin update returned no row");
        }
        return updated;
      });
    },

    // ── R14 批 CHAT：reaction 幂等加/减 ──────────────────────────────────────────────
    // 登录可见会话者皆可加/减；对已删除消息加反应回 409（删除消息命中 ConversationMessageDeletedError）；
    // 一人同 key 同消息至多一条（unique 兜底 + onConflictDoNothing 幂等）。返回该消息的全量聚合，服务层
    // 据此发 conversation.reaction.updated（幂等替换语义，不发增量）。
    async addReaction(input) {
      if (!CONVERSATION_REACTION_KEYS.includes(input.reactionKey)) {
        throw new ConversationRepositoryInputError("unknown reaction key");
      }
      const at = input.at ?? new Date();
      const userId = input.userId.toLowerCase();
      return db.transaction(async (tx) => {
        const message = await lockActiveMessage(tx, input);
        if (!message) {
          throw new ConversationMessageNotFoundError("message not found in the active conversation");
        }
        if (message.deletedAt) {
          throw new ConversationMessageDeletedError("cannot react to a deleted message");
        }
        await tx
          .insert(messageReactions)
          .values({
            id: randomUUID(),
            messageId: input.messageId,
            conversationId: input.conversationId,
            userId,
            reactionKey: input.reactionKey,
            createdAt: at
          })
          .onConflictDoNothing({
            target: [messageReactions.messageId, messageReactions.userId, messageReactions.reactionKey]
          });
        const reactions = await aggregateMessageReactions(tx, input);
        return { reactions };
      });
    },

    async removeReaction(input) {
      if (!CONVERSATION_REACTION_KEYS.includes(input.reactionKey)) {
        throw new ConversationRepositoryInputError("unknown reaction key");
      }
      const userId = input.userId.toLowerCase();
      return db.transaction(async (tx) => {
        // 取反应不因目标已删除而拒（DELETE reaction 只有 204/404 两态）——但仍要求消息存在于本租户，
        // 否则给 404，不静默假装成功。
        const message = await lockActiveMessage(tx, input);
        if (!message) {
          throw new ConversationMessageNotFoundError("message not found in the active conversation");
        }
        await tx
          .delete(messageReactions)
          .where(
            and(
              eq(messageReactions.messageId, input.messageId),
              eq(messageReactions.userId, userId),
              eq(messageReactions.reactionKey, input.reactionKey)
            )
          );
        const reactions = await aggregateMessageReactions(tx, input);
        return { reactions };
      });
    },

    // ── R14 批 CHAT：已读游标单调 upsert ─────────────────────────────────────────────
    // 单调推进（greatest 兜底，收到更小值静默返回当前值）、夹紧不得超过会话当前最大 seq（= next_seq）。
    async advanceReadCursor(input) {
      assertCursor(input.lastReadSeq);
      const at = input.at ?? new Date();
      const userId = input.userId.toLowerCase();
      return db.transaction(async (tx) => {
        const [conversation] = await tx
          .select({ nextSeq: projectConversations.nextSeq })
          .from(projectConversations)
          .where(
            and(
              eq(projectConversations.id, input.conversationId),
              eq(projectConversations.workspaceId, input.workspaceId),
              isNull(projectConversations.deletedAt)
            )
          )
          .limit(1);
        if (!conversation) {
          throw new ConversationAccessDeniedError("read cursor target conversation is not active");
        }
        const clamped = Math.min(input.lastReadSeq, conversation.nextSeq);
        const [row] = await tx
          .insert(conversationReadCursors)
          .values({
            id: randomUUID(),
            conversationId: input.conversationId,
            userId,
            lastReadSeq: clamped,
            updatedAt: at
          })
          .onConflictDoUpdate({
            target: [conversationReadCursors.conversationId, conversationReadCursors.userId],
            set: {
              lastReadSeq: sql`greatest(${conversationReadCursors.lastReadSeq}, ${clamped})`,
              updatedAt: at
            }
          })
          .returning({ lastReadSeq: conversationReadCursors.lastReadSeq });
        if (!row) {
          throw new ConversationMessageMutationFailedError("read cursor upsert returned no row");
        }
        return { lastReadSeq: row.lastReadSeq };
      });
    },

    async listReceipts(input) {
      const rows = await db
        .select({
          userId: conversationReadCursors.userId,
          lastReadSeq: conversationReadCursors.lastReadSeq
        })
        .from(conversationReadCursors)
        .innerJoin(
          projectConversations,
          and(
            eq(projectConversations.id, conversationReadCursors.conversationId),
            eq(projectConversations.workspaceId, input.workspaceId),
            isNull(projectConversations.deletedAt)
          )
        )
        .where(eq(conversationReadCursors.conversationId, input.conversationId))
        .orderBy(asc(conversationReadCursors.userId))
        .limit(CONVERSATION_READ_RECEIPTS_CAP);
      return rows.map((row) => ({ userId: row.userId, lastReadSeq: row.lastReadSeq }));
    },

    async listPins(input) {
      assertLimit(input.limit);
      const rows = await db
        .select(messageSelection)
        .from(conversationMessages)
        .innerJoin(
          projectConversations,
          and(
            eq(projectConversations.id, conversationMessages.conversationId),
            eq(projectConversations.workspaceId, input.workspaceId),
            isNull(projectConversations.deletedAt)
          )
        )
        .where(
          and(
            eq(conversationMessages.conversationId, input.conversationId),
            isNotNull(conversationMessages.pinnedAt),
            // 删除已顺带取消置顶（见 deleteMessage），这条是防御性双保险：墓碑绝不进置顶栏。
            isNull(conversationMessages.deletedAt)
          )
        )
        .orderBy(desc(conversationMessages.seq))
        .limit(input.limit);
      return rows as ConversationMessageRow[];
    },

    // ── R14 批 CHAT：页级富化（禁 N+1，每批一条 grouped 查询） ────────────────────────
    async listReactionsForMessages(input) {
      const messageIds = [...new Set(input.messageIds)];
      const result = new Map<string, MessageReactionAggregate[]>();
      if (messageIds.length === 0) {
        return result;
      }
      if (messageIds.length > CONVERSATION_PAGE_ENRICH_CAP) {
        throw new ConversationRepositoryInputError("reaction enrichment message set exceeds the page cap");
      }
      const rows = await db
        .select({
          messageId: messageReactions.messageId,
          reactionKey: messageReactions.reactionKey,
          userIds: sql<string[]>`array_agg(${messageReactions.userId} order by ${messageReactions.userId})`
        })
        .from(messageReactions)
        .where(
          and(
            eq(messageReactions.conversationId, input.conversationId),
            inArray(messageReactions.messageId, messageIds)
          )
        )
        .groupBy(messageReactions.messageId, messageReactions.reactionKey);
      const byMessageKey = new Map<string, Map<ConversationReactionKey, string[]>>();
      for (const row of rows) {
        let keyMap = byMessageKey.get(row.messageId);
        if (!keyMap) {
          keyMap = new Map();
          byMessageKey.set(row.messageId, keyMap);
        }
        keyMap.set(row.reactionKey as ConversationReactionKey, row.userIds ?? []);
      }
      for (const [messageId, keyMap] of byMessageKey) {
        const aggregates: MessageReactionAggregate[] = [];
        for (const key of CONVERSATION_REACTION_KEYS) {
          const userIds = keyMap.get(key);
          if (userIds && userIds.length > 0) {
            aggregates.push({ key, userIds });
          }
        }
        if (aggregates.length > 0) {
          result.set(messageId, aggregates);
        }
      }
      return result;
    },

    async listReplyPreviews(input) {
      const messageIds = [...new Set(input.messageIds)];
      const result = new Map<string, ReplyPreviewTargetRow>();
      if (messageIds.length === 0) {
        return result;
      }
      if (messageIds.length > CONVERSATION_PAGE_ENRICH_CAP) {
        throw new ConversationRepositoryInputError("reply preview message set exceeds the page cap");
      }
      const rows = await db
        .select({
          id: conversationMessages.id,
          senderType: conversationMessages.senderType,
          senderUserId: conversationMessages.senderUserId,
          kind: conversationMessages.kind,
          contentJson: conversationMessages.contentJson,
          deletedAt: conversationMessages.deletedAt
        })
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.conversationId, input.conversationId),
            inArray(conversationMessages.id, messageIds)
          )
        );
      for (const row of rows) {
        result.set(row.id, {
          id: row.id,
          senderType: row.senderType,
          senderUserId: row.senderUserId,
          kind: row.kind,
          contentJson: row.contentJson as Record<string, unknown>,
          deletedAt: row.deletedAt
        });
      }
      return result;
    },

    async findMessageForFeedback(input) {
      const [row] = await db
        .select({ message: conversationMessages })
        .from(conversationMessages)
        .innerJoin(
          projectConversations,
          and(
            eq(projectConversations.id, conversationMessages.conversationId),
            eq(projectConversations.workspaceId, input.workspaceId),
            isNull(projectConversations.deletedAt)
          )
        )
        .where(
          and(
            eq(conversationMessages.conversationId, input.conversationId),
            eq(conversationMessages.id, input.messageId)
          )
        )
        .limit(1);
      return row?.message ?? null;
    }
  };
}
