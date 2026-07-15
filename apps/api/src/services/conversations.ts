import {
  ConversationAccessDeniedError,
  ConversationDmTargetError,
  ConversationMessageActorMismatchError,
  ConversationMessageDeletedError,
  ConversationMessageEditWindowError,
  ConversationMessageNotFoundError,
  ConversationMessageNotTextError,
  ConversationParentAccessError,
  ConversationParticipantMembershipError,
  ConversationReplyTargetError,
  ConversationRepositoryInputError,
  ConversationSequenceExhaustedError,
  ConversationSourceMessageMismatchError,
  ConversationThreadRootMismatchError,
  createAiFeedbackRepository,
  createConversationRepository,
  getSharedDatabaseClient,
  type AiFeedbackRepository,
  type AiFeedbackRow,
  type ConversationMessageRow,
  type ConversationParticipantRow,
  type ConversationReactionKey,
  type ConversationRepository,
  type ConversationRow,
  type CreateUserMessageInput,
  type MessageReactionAggregate,
  type ReplyPreviewTargetRow,
  type VisibleConversationRow,
  type WorkHubDatabaseClient
} from "@workhub/db";
import {
  conversationFileCardContentSchema,
  conversationMessageCreatedEventSchema,
  conversationMessageUpdatedEventSchema,
  conversationListPageVmSchema,
  conversationMessagePageVmSchema,
  conversationMessageVmSchema,
  conversationPinsVmSchema,
  conversationReactionKeySchema,
  conversationReactionUpdatedEventSchema,
  conversationReadCursorVmSchema,
  conversationReadReceiptsVmSchema,
  conversationReadUpdatedEventSchema,
  createConversationResultVmSchema,
  openDmResultVmSchema,
  dmListVmSchema,
  DM_LIST_CAP,
  renameConversationResultVmSchema,
  eventTypes,
  MAX_CONVERSATION_REPLY_PREVIEW_CODE_UNITS,
  type AdvanceReadCursorRequest,
  type ConversationListPageVM,
  type ConversationListQuery,
  type ConversationMessageListQuery,
  type ConversationMessagePageVM,
  type ConversationMessageReplyPreviewVM,
  type ConversationMessageVM,
  type ConversationPinsVM,
  type ConversationReadCursorVM,
  type ConversationReadReceiptsVM,
  type CreateConversationMessageRequest,
  type CreateConversationRequest,
  type CreateConversationResultVM,
  type DmListVM,
  type EditConversationMessageRequest,
  type OpenDmResultVM,
  type RenameConversationRequest,
  type RenameConversationResultVM
} from "@workhub/contracts";
import { makeWorkHubEvent, topics } from "@workhub/events";

// R14 批 CHAT：编辑窗（15 分钟）——服务端策略常量，传给仓库层并进同一次原子判定。
const CONVERSATION_EDIT_WINDOW_MS = 15 * 60 * 1000;
// R14 批 CHAT：置顶清单读取上限（设计 §3：seq 降序 cap 50）。
const CONVERSATION_PINS_CAP = 50;

import { getDefaultPushBus, getDefaultPresenceStore, type PushBus } from "../broker/index.js";
import type { PresenceStore } from "../broker/types.js";
import { getDefaultStructuredLogger, type StructuredLogger } from "../logging.js";
import type { AuthActor } from "../middleware/auth.js";
import { parseOutputContract } from "../pages/output-contract.js";
import { notifyConversationMessage } from "./conversation-message-notify.js";
import { createNotificationService, type NotificationService } from "./notifications.js";
import { getDefaultConversationReplyJudgeService } from "./conversation-reply-judge.js";
import {
  getDefaultConversationTurnService,
  mentionsCuu,
  type ConversationTurnService
} from "./conversation-turns.js";
import {
  DrivePageServiceError,
  getDefaultDrivePageService,
  type DrivePageService
} from "./drive-pages.js";

export class ConversationServiceError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ConversationServiceError";
  }
}

type HumanConversationActor = {
  actor: AuthActor;
  userId: string;
  workspaceId: string;
};

export type ConversationService = {
  assertProjectAccess(input: { actor: AuthActor; projectId: string }): Promise<void>;
  assertConversationAccess(input: { actor: AuthActor; conversationId: string }): Promise<{ projectId: string }>;
  listConversations(input: {
    actor: AuthActor;
    projectId: string;
    query: ConversationListQuery;
  }): Promise<ConversationListPageVM>;
  createConversation(input: {
    actor: AuthActor;
    projectId: string;
    payload: CreateConversationRequest;
  }): Promise<CreateConversationResultVM>;
  // R15 批 B（人对人私聊）：查/开一对用户的 DM——返回既有会话列表同款的 conversation VM（带 is_dm）。
  // 目标须与调用者同工作区活跃成员、且不是自己（校验在实现/仓库层，映射到 400/404）。
  openDm(input: { actor: AuthActor; targetUserId: string }): Promise<OpenDmResultVM>;
  // R15 批 B（人对人私聊）：actor 参与的 DM 列表（参与者门控、含对方昵称+is_self）——rail「私聊」分组
  // 的唯一数据源。DM 容器项目对项目树/工作台 VM 全线围栏，DM 会话没有任何常规入口，靠这个窄口列出。
  listDms(input: { actor: AuthActor }): Promise<DmListVM>;
  // R14FIX 批 workbench：协同会话改名——仅 collab 会话、仅参与者/owner（红线在实现里强制）。
  renameConversation(input: {
    actor: AuthActor;
    conversationId: string;
    payload: RenameConversationRequest;
  }): Promise<RenameConversationResultVM>;
  listMessages(input: {
    actor: AuthActor;
    conversationId: string;
    query: ConversationMessageListQuery;
  }): Promise<ConversationMessagePageVM>;
  createMessage(input: {
    actor: AuthActor;
    conversationId: string;
    payload: CreateConversationMessageRequest;
  }): Promise<ConversationMessageVM>;
  // R14 批 CHAT：编辑/删除/置顶/取消置顶——返回变更后全量消息 VM（编辑/删除）或无内容（置顶/取消）。
  editMessage(input: {
    actor: AuthActor;
    conversationId: string;
    messageId: string;
    payload: EditConversationMessageRequest;
  }): Promise<ConversationMessageVM>;
  deleteMessage(input: {
    actor: AuthActor;
    conversationId: string;
    messageId: string;
  }): Promise<ConversationMessageVM>;
  pinMessage(input: { actor: AuthActor; conversationId: string; messageId: string }): Promise<void>;
  unpinMessage(input: { actor: AuthActor; conversationId: string; messageId: string }): Promise<void>;
  addReaction(input: {
    actor: AuthActor;
    conversationId: string;
    messageId: string;
    reactionKey: string;
  }): Promise<void>;
  removeReaction(input: {
    actor: AuthActor;
    conversationId: string;
    messageId: string;
    reactionKey: string;
  }): Promise<void>;
  advanceReadCursor(input: {
    actor: AuthActor;
    conversationId: string;
    payload: AdvanceReadCursorRequest;
  }): Promise<ConversationReadCursorVM>;
  listReceipts(input: { actor: AuthActor; conversationId: string }): Promise<ConversationReadReceiptsVM>;
  listPins(input: { actor: AuthActor; conversationId: string }): Promise<ConversationPinsVM>;
};

// R14 FIX批10（被 @ 的回复延迟：事件驱动直通）：消息落库后，如果这条消息命中 @Cuu 且会话是真小群
// （collab、participantCount>1，与回话判定器 listReplyJudgeCandidates 的候选口径完全一致），createMessage
// 会异步（fire-and-forget，不阻塞这次 HTTP 响应）触发一次 turn，不必再等判定器最长 15s 的轮询 tick。
// 这个依赖可选——省略时（比如既有测试的 createConversationService 调用点）createMessage 完全不做任何
// 直通尝试，行为与本批之前一致，不会因为缺依赖而抛错。
export type ConversationMentionTriggerDeps = {
  // 复用既有 ConversationTurnService.createTurn——不重新实现一遍鉴权/预算/工具环/并发闸；这里只是多了
  // 一个"消息落库时机"的触发点，闸语义（activeTurns busy/cuu_enabled/mode）完全交给 createTurn 自己判断。
  turns: Pick<ConversationTurnService, "createTurn">;
  // 接到 conversation-reply-judge.ts 的"已判定"水位线——见该文件 markMentionHandled 的注释：直通命中时
  // 同步（在任何 await 之前）标记这条消息，关闭与轮询 tick 的竞态窗口，保证同一条消息不会被两条路径各
  // 触发一次 turn。
  markMentionHandled: (input: { conversationId: string; messageId: string }) => void;
  cuuDisplayName?: string;
};

export type ConversationServiceOptions = {
  driveFiles: Pick<DrivePageService, "file">;
  now?: () => Date;
  bus?: Pick<PushBus, "backend" | "publish">;
  logger?: Pick<StructuredLogger, "warn">;
  mentionTrigger?: ConversationMentionTriggerDeps;
  // R14 批 FEEDBACK：消息 VM / 行动卡条目的读聚合——只回当前 actor 自己的判定（不做全员聚合，见设计
  // §5.1/§5.3）。可选依赖：省略时（既有测试的 createConversationService 调用点）读聚合整体跳过、
  // my_feedback / items[].feedback 一律不出现，行为与本批之前逐字一致，不会因缺依赖抛错。
  aiFeedback?: Pick<AiFeedbackRepository, "listForSubjects">;
  // R15 批 A（A5 消息通知）：人类消息落库 + 广播后，给其他参与者 fire-and-forget 扇出 conversation.message
  // 通知（在线正在看该会话的人被抑制，见 conversation-message-notify.ts）。可选依赖——省略时（既有测试的
  // createConversationService 调用点）整个扇出跳过，行为零回归，不会因缺依赖抛错。
  messageNotify?: {
    presence: Pick<PresenceStore, "isViewingConversation">;
    notifications: Pick<NotificationService, "createConversationMessageNotification">;
  };
};

function requireHumanActor(actor: AuthActor): HumanConversationActor {
  const workspaceId = actor.workspaceId.trim();
  const userId = actor.userId?.trim();
  if (actor.kind !== "human" || !userId || !workspaceId) {
    throw new ConversationServiceError(
      403,
      "human_required",
      "需要已加入工作区的真人用户才能访问会话。"
    );
  }
  return { actor, userId, workspaceId };
}

function conversationToVm(
  row: ConversationRow | VisibleConversationRow,
  participantRole?: "owner" | "member" | null,
  // R15 批 A（A4 未读聚合）：会话列表 VM 组装时透传的未读数（一条聚合 SQL 一次算齐，见
  // listConversations）。additive optional——省略时（单条 create/open/rename 结果 VM）VM 不带这个键，
  // 存量行为零回归；给了具体数（含 0）时才输出 unread_count。
  unreadCount?: number
) {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    project_id: row.projectId,
    kind: row.kind,
    title: row.title,
    parent_conversation_id: row.parentConversationId,
    source_message_id: row.sourceMessageId,
    visibility: row.visibility,
    next_seq: row.nextSeq,
    created_by: row.createdBy,
    participant_role: participantRole ?? ("participantRole" in row ? row.participantRole : null),
    // R13 批 G1（小群）：会话级 Cuu 硬开关——additive 输出字段，直接透传 DB 列。
    cuu_enabled: row.cuuEnabled,
    // R15 批 B（人对人私聊）：由 dm_key 非空推导——只在 DM 会话上输出 is_dm=true，普通会话不带这个键
    // （契约层 is_dm 是 optional，见 conversationVmSchema）。
    ...(row.dmKey ? { is_dm: true as const } : {}),
    // R15 批 A（A4 未读聚合）：给了具体数（含 0）时才输出——单条结果 VM 传 undefined 则不带这个键。
    ...(unreadCount !== undefined ? { unread_count: unreadCount } : {}),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString()
  };
}

function participantToVm(row: ConversationParticipantRow) {
  return {
    id: row.id,
    conversation_id: row.conversationId,
    user_id: row.userId,
    role: row.role,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString()
  };
}

// R14 批 CHAT：一条消息可选的页级富化——reactions（全量聚合）与 reply 目标行（用于构建引用预览）。
// 两者都由服务层用一次 grouped/IN 查询批量取回（禁 N+1），再逐条挂到 VM 上。
// R14 批 FEEDBACK：再加两条——myFeedback（这条消息本人的反馈）与 itemFeedback（本页所有行动卡条目
// 本人的反馈，读时合并进 content.items[]，不写回共享 content_json，理由见设计 §5.3）。
type MessageEnrichment = {
  reactions?: MessageReactionAggregate[] | undefined;
  replyTarget?: ReplyPreviewTargetRow | undefined;
  myFeedback?: AiFeedbackRow | undefined;
  itemFeedback?: Map<string, AiFeedbackRow> | undefined;
};

// R14 批 FEEDBACK：从一页消息里收集所有 kind==='action_card' 活消息的条目 id（content_json.items[].id），
// 供一次批量反馈查询用（禁 N+1）。墓碑短路，非数组 items 静默跳过。
function collectActionCardItemIds(rows: ConversationMessageRow[]): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.deletedAt || row.kind !== "action_card") {
      continue;
    }
    const content = row.contentJson as Record<string, unknown>;
    const items = Array.isArray(content["items"]) ? content["items"] : [];
    for (const item of items) {
      const itemId = (item as Record<string, unknown> | null)?.["id"];
      if (typeof itemId === "string") {
        ids.add(itemId);
      }
    }
  }
  return [...ids];
}

// R14 批 CHAT：引用预览文本——同 historyDisplayText 的映射口径，但用于「原消息一句话预览」。墓碑目标
// 由调用方置空，这里只负责活着的目标。
function replyPreviewText(kind: ConversationMessageRow["kind"], content: Record<string, unknown>): string {
  switch (kind) {
    case "text":
      return typeof content["text"] === "string" ? content["text"] : "";
    case "file_card":
      return typeof content["snapshot_name"] === "string"
        ? `分享了文件：${content["snapshot_name"]}`
        : "分享了一个文件";
    case "tool_note":
      return "（一次工具调用）";
    case "system_event":
      return typeof content["summary"] === "string" ? content["summary"] : "（系统事件）";
    case "action_card":
      return "（行动卡）";
    default:
      return "";
  }
}

function buildReplyPreview(messageId: string, target: ReplyPreviewTargetRow): ConversationMessageReplyPreviewVM {
  const deleted = target.deletedAt !== null;
  const previewText = deleted ? "" : replyPreviewText(target.kind, target.contentJson);
  return {
    message_id: messageId,
    sender_type: target.senderType,
    sender_user_id: target.senderUserId,
    preview_text: previewText.slice(0, MAX_CONVERSATION_REPLY_PREVIEW_CODE_UNITS),
    deleted
  };
}

function reactionsToVm(aggregates: MessageReactionAggregate[]) {
  return aggregates.map((aggregate) => ({ key: aggregate.key, user_ids: aggregate.userIds }));
}

// R14 批 CHAT：消息行 → VM，含墓碑归一与 additive 富化字段。
//   * 墓碑（deleted_at 置位）一律归一成 kind:'text'、content:{text:''}、deleted_at；不带 reactions/
//     reply/pinned/edited（保持墓碑干净，契约层 superRefine 也强制这一点）。
//   * 活消息：透传 kind/content，按需挂 edited_at/pinned/reply_to/reactions。
function messageToVm(row: ConversationMessageRow, enrichment: MessageEnrichment = {}) {
  const base = {
    id: row.id,
    conversation_id: row.conversationId,
    seq: row.seq,
    sender_type: row.senderType,
    sender_user_id: row.senderUserId,
    thread_root_id: row.threadRootId,
    created_at: row.createdAt.toISOString()
  };
  if (row.deletedAt) {
    return {
      ...base,
      kind: "text" as const,
      content: { text: "" },
      deleted_at: row.deletedAt.toISOString()
    };
  }
  const vm: Record<string, unknown> = {
    ...base,
    kind: row.kind,
    content: row.contentJson
  };
  if (row.editedAt) {
    vm["edited_at"] = row.editedAt.toISOString();
  }
  if (row.pinnedAt) {
    vm["pinned"] = { at: row.pinnedAt.toISOString(), by_user_id: row.pinnedByUserId };
  }
  // reply_to 只在拿得到目标预览时才渲染——拿不到（理论上不该发生，服务层总是成对查询）宁可不显示，
  // 也不构造缺 sender/preview 的半截引用块。
  if (row.replyToMessageId && enrichment.replyTarget) {
    vm["reply_to"] = buildReplyPreview(row.replyToMessageId, enrichment.replyTarget);
  }
  if (enrichment.reactions && enrichment.reactions.length > 0) {
    vm["reactions"] = reactionsToVm(enrichment.reactions);
  }
  // R14 批 FEEDBACK：本人对这条消息的反馈（只对 Cuu 活文字回复写入，写入端点已在服务层把关）。
  if (enrichment.myFeedback) {
    vm["my_feedback"] = {
      verdict: enrichment.myFeedback.verdict,
      ...(enrichment.myFeedback.note ? { note: enrichment.myFeedback.note } : {}),
      updated_at: enrichment.myFeedback.updatedAt.toISOString()
    };
  }
  // R14 批 FEEDBACK：行动卡条目反馈——读时合并进 content.items[]（per-user，不写回全会话共享的
  // content_json 快照，见设计 §5.3）。只在真有本人反馈时改写对应 item，其余原样透传。
  if (row.kind === "action_card" && enrichment.itemFeedback && enrichment.itemFeedback.size > 0) {
    const content = row.contentJson as Record<string, unknown>;
    const items = Array.isArray(content["items"]) ? content["items"] : [];
    vm["content"] = {
      ...content,
      items: items.map((item) => {
        const itemRecord = item as Record<string, unknown> | null;
        const itemId = itemRecord?.["id"];
        const fb = typeof itemId === "string" ? enrichment.itemFeedback!.get(itemId) : undefined;
        return fb
          ? {
              ...itemRecord,
              feedback: { verdict: fb.verdict, ...(fb.note ? { note: fb.note } : {}) }
            }
          : item;
      })
    };
  }
  return vm;
}

function messagePreviewText(row: ConversationMessageRow): string | undefined {
  if (row.deletedAt) {
    return undefined;
  }
  const content = row.contentJson as Record<string, unknown>;
  if (row.kind === "text") {
    return typeof content["text"] === "string" ? content["text"] : undefined;
  }
  if (row.kind === "file_card") {
    return typeof content["snapshot_name"] === "string" ? content["snapshot_name"] : undefined;
  }
  return row.kind;
}

function mapRepositoryError(error: unknown): never {
  if (error instanceof ConversationRepositoryInputError) {
    throw new ConversationServiceError(400, "conversation_invalid_input", error.message);
  }
  if (error instanceof ConversationParticipantMembershipError) {
    throw new ConversationServiceError(400, "conversation_participant_invalid", error.message);
  }
  if (error instanceof ConversationParentAccessError) {
    throw new ConversationServiceError(400, "conversation_parent_invalid", error.message);
  }
  if (error instanceof ConversationSourceMessageMismatchError) {
    throw new ConversationServiceError(400, "conversation_source_invalid", error.message);
  }
  if (error instanceof ConversationThreadRootMismatchError) {
    throw new ConversationServiceError(400, "conversation_thread_invalid", error.message);
  }
  if (error instanceof ConversationAccessDeniedError) {
    throw new ConversationServiceError(404, "conversation_not_found", "没有找到这个会话。");
  }
  // R15 批 B（人对人私聊）：私聊对象不是本工作区活跃成员——404，不泄漏「这个人存在但不在你工作区」。
  if (error instanceof ConversationDmTargetError) {
    throw new ConversationServiceError(404, "conversation_dm_target_not_found", "没有找到这个工作区里的这个人。");
  }
  if (error instanceof ConversationSequenceExhaustedError) {
    throw new ConversationServiceError(409, "conversation_sequence_exhausted", "这个会话的消息序号已经耗尽。");
  }
  // R14 批 CHAT（引用回复）：目标跨会话/不存在/已删除 → 400（干净的请求错误，不是 500）。
  if (error instanceof ConversationReplyTargetError) {
    throw new ConversationServiceError(400, "conversation_reply_target_invalid", "没有找到可引用的原消息，或它已被删除。");
  }
  // R14 批 CHAT：消息动作（编辑/删除/置顶/反应）的结构性失败映射。
  if (error instanceof ConversationMessageNotFoundError) {
    throw new ConversationServiceError(404, "conversation_message_not_found", "没有找到这条消息。");
  }
  if (error instanceof ConversationMessageActorMismatchError) {
    throw new ConversationServiceError(403, "conversation_message_forbidden", "只能编辑或删除自己发的消息。");
  }
  if (error instanceof ConversationMessageNotTextError) {
    throw new ConversationServiceError(409, "conversation_message_not_editable", "这条消息不是文字消息，不能编辑。");
  }
  if (error instanceof ConversationMessageEditWindowError) {
    throw new ConversationServiceError(409, "conversation_message_edit_window_closed", "已经超过可以编辑的时间了。");
  }
  if (error instanceof ConversationMessageDeletedError) {
    throw new ConversationServiceError(409, "conversation_message_deleted", "这条消息已经被删除了。");
  }
  throw error;
}

export function createConversationService(
  repository: ConversationRepository,
  options: ConversationServiceOptions
): ConversationService {
  const now = options.now ?? (() => new Date());
  const bus = options.bus ?? getDefaultPushBus();
  const logger = options.logger ?? getDefaultStructuredLogger();
  const aiFeedback = options.aiFeedback;

  async function visibleConversation(input: { actor: AuthActor; conversationId: string }) {
    const human = requireHumanActor(input.actor);
    const access = await repository.findVisibleAccessRecord({
      workspaceId: human.workspaceId,
      viewerUserId: human.userId,
      conversationId: input.conversationId
    });
    if (!access) {
      throw new ConversationServiceError(404, "conversation_not_found", "没有找到这个会话。");
    }
    return { human, access };
  }

  // R14 批 CHAT：一页/一批消息的富化——reactions 与 reply 预览各一条批量查询（禁 N+1），逐条挂到 VM。
  // 删除消息（墓碑）在 messageToVm 里短路，富化对它无效（无害，不为它单独排除）。
  // R14 批 FEEDBACK：再加两条并行查询——按当前 viewer（viewerUserId）过滤的消息级 / 行动卡条目级反馈
  // （只读自己，见设计 §5.1/§5.3）。aiFeedback 依赖缺省时整体跳过，行为与本批之前一致。
  async function enrichMessageRows(
    conversationId: string,
    rows: ConversationMessageRow[],
    viewerUserId: string
  ) {
    const messageIds = rows.map((row) => row.id);
    const replyTargetIds = [
      ...new Set(rows.map((row) => row.replyToMessageId).filter((value): value is string => Boolean(value)))
    ];
    const actionCardItemIds = collectActionCardItemIds(rows);
    const emptyFeedback = () => Promise.resolve(new Map<string, AiFeedbackRow>());
    const [reactionsByMessage, replyTargets, feedbackByMessage, feedbackByItem] = await Promise.all([
      messageIds.length > 0
        ? repository.listReactionsForMessages({ conversationId, messageIds })
        : Promise.resolve(new Map<string, MessageReactionAggregate[]>()),
      replyTargetIds.length > 0
        ? repository.listReplyPreviews({ conversationId, messageIds: replyTargetIds })
        : Promise.resolve(new Map<string, ReplyPreviewTargetRow>()),
      aiFeedback && messageIds.length > 0
        ? aiFeedback.listForSubjects({ subjectType: "conversation_message", subjectIds: messageIds, userId: viewerUserId })
        : emptyFeedback(),
      aiFeedback && actionCardItemIds.length > 0
        ? aiFeedback.listForSubjects({ subjectType: "action_card_item", subjectIds: actionCardItemIds, userId: viewerUserId })
        : emptyFeedback()
    ]);
    return rows.map((row) =>
      messageToVm(row, {
        reactions: reactionsByMessage.get(row.id),
        replyTarget: row.replyToMessageId ? replyTargets.get(row.replyToMessageId) : undefined,
        myFeedback: feedbackByMessage.get(row.id),
        itemFeedback: feedbackByItem
      })
    );
  }

  // 单条消息富化（编辑/置顶后组装变更后全量 VM 用）——同上批量路径，只是集合大小为 1。
  async function enrichSingleMessage(
    conversationId: string,
    row: ConversationMessageRow,
    viewerUserId: string
  ) {
    const [enriched] = await enrichMessageRows(conversationId, [row], viewerUserId);
    return enriched;
  }

  // R14 批 CHAT：发布 conversation.message.updated（编辑/删除/置顶/取消置顶后）——发布失败仅 warn，
  // 与既有 message.created 的 best-effort 广播口径一致（发送者已看到动作成功，不因广播失败回滚）。
  async function publishMessageUpdated(
    access: ConversationRow,
    actor: HumanConversationActor,
    messageVm: ConversationMessageVM,
    row: ConversationMessageRow
  ) {
    const conversationTopic = topics.conversation(access.id).topic;
    const previewText = messagePreviewText(row);
    const event = parseOutputContract(
      conversationMessageUpdatedEventSchema,
      makeWorkHubEvent({
        type: eventTypes.conversationMessageUpdated,
        topic: conversationTopic,
        ts: now(),
        actor: { actor_kind: "human", actor_user_id: actor.userId, label: actor.actor.label },
        project_id: access.projectId,
        ...(previewText !== undefined ? { preview_text: previewText } : {}),
        data: messageVm
      }),
      "conversations.messages.event.updated"
    );
    try {
      await bus.publish(conversationTopic, eventTypes.conversationMessageUpdated, event);
    } catch (error) {
      logger.warn("conversation_message_updated_publish_failed", {
        event_id: event.event_id,
        topic: conversationTopic,
        conversation_id: access.id,
        message_id: row.id,
        broker_backend: bus.backend,
        error
      });
    }
  }

  async function publishReactionUpdated(
    access: ConversationRow,
    messageId: string,
    reactions: MessageReactionAggregate[]
  ) {
    const conversationTopic = topics.conversation(access.id).topic;
    const event = parseOutputContract(
      conversationReactionUpdatedEventSchema,
      makeWorkHubEvent({
        type: eventTypes.conversationReactionUpdated,
        topic: conversationTopic,
        ts: now(),
        data: {
          conversation_id: access.id,
          message_id: messageId,
          reactions: reactionsToVm(reactions)
        }
      }),
      "conversations.reactions.event.updated"
    );
    try {
      await bus.publish(conversationTopic, eventTypes.conversationReactionUpdated, event);
    } catch (error) {
      logger.warn("conversation_reaction_updated_publish_failed", {
        event_id: event.event_id,
        topic: conversationTopic,
        conversation_id: access.id,
        message_id: messageId,
        broker_backend: bus.backend,
        error
      });
    }
  }

  async function publishReadUpdated(access: ConversationRow, userId: string, lastReadSeq: number) {
    const conversationTopic = topics.conversation(access.id).topic;
    const event = parseOutputContract(
      conversationReadUpdatedEventSchema,
      makeWorkHubEvent({
        type: eventTypes.conversationReadUpdated,
        topic: conversationTopic,
        ts: now(),
        data: { conversation_id: access.id, user_id: userId, last_read_seq: lastReadSeq }
      }),
      "conversations.read.event.updated"
    );
    try {
      await bus.publish(conversationTopic, eventTypes.conversationReadUpdated, event);
    } catch (error) {
      logger.warn("conversation_read_updated_publish_failed", {
        event_id: event.event_id,
        topic: conversationTopic,
        conversation_id: access.id,
        user_id: userId,
        broker_backend: bus.backend,
        error
      });
    }
  }

  function parseReactionKey(rawKey: string): ConversationReactionKey {
    const parsed = conversationReactionKeySchema.safeParse(rawKey);
    if (!parsed.success) {
      throw new ConversationServiceError(400, "conversation_reaction_invalid_key", "不认识这个反应。");
    }
    return parsed.data;
  }

  return {
    async assertProjectAccess(input) {
      const human = requireHumanActor(input.actor);
      const page = await repository.listVisibleForProject({
        workspaceId: human.workspaceId,
        viewerUserId: human.userId,
        projectId: input.projectId,
        limit: 1
      });
      if (!page) {
        throw new ConversationServiceError(404, "conversation_project_not_found", "没有找到这个项目会话区。");
      }
    },

    async assertConversationAccess(input) {
      const { access } = await visibleConversation(input);
      return { projectId: access.conversation.projectId };
    },

    async listConversations(input) {
      const human = requireHumanActor(input.actor);
      const result = await repository.listVisibleForProject({
        workspaceId: human.workspaceId,
        viewerUserId: human.userId,
        projectId: input.projectId,
        ...(input.query.afterCreatedAt && input.query.afterId
          ? { after: { createdAt: input.query.afterCreatedAt, id: input.query.afterId } }
          : {}),
        limit: input.query.limit
      });
      if (!result) {
        throw new ConversationServiceError(404, "conversation_project_not_found", "没有找到这个项目会话区。");
      }
      // R15 批 A（A4 未读聚合）：一条聚合 SQL 算齐本页所有会话在当前 viewer 视角的未读数（禁 N+1——
      // 不逐会话查）。聚合失败只降级成"不带未读数"，绝不因为红点算不出来而让整页会话列表 500。
      let unreadCounts = new Map<string, number>();
      try {
        unreadCounts = await repository.unreadCountsForViewer({
          viewerUserId: human.userId,
          conversationIds: result.rows.map((row) => row.id)
        });
      } catch (error) {
        logger.warn("conversation_unread_aggregate_failed", {
          projectId: input.projectId,
          viewerUserId: human.userId,
          error
        });
      }
      return parseOutputContract(conversationListPageVmSchema, {
        conversations: result.rows.map((row) => conversationToVm(row, undefined, unreadCounts.get(row.id) ?? 0)),
        capped: result.capped,
        next_cursor: result.nextCursor
          ? { afterCreatedAt: result.nextCursor.createdAt, afterId: result.nextCursor.id }
          : null
      }, "conversations.list");
    },

    async createConversation(input) {
      const human = requireHumanActor(input.actor);
      try {
        const result = await repository.createCollab({
          workspaceId: human.workspaceId,
          projectId: input.projectId,
          creatorUserId: human.userId,
          title: input.payload.title,
          visibility: input.payload.visibility,
          ...(input.payload.parent_conversation_id
            ? { parentConversationId: input.payload.parent_conversation_id }
            : {}),
          ...(input.payload.source_message_id ? { sourceMessageId: input.payload.source_message_id } : {}),
          participantUserIds: input.payload.participant_user_ids,
          cuuEnabled: input.payload.cuu_enabled,
          at: now()
        });
        const creatorRole = result.participants.find(
          (participant) => participant.userId.toLowerCase() === human.userId.toLowerCase()
        )?.role ?? null;
        return parseOutputContract(createConversationResultVmSchema, {
          conversation: conversationToVm(result.conversation, creatorRole),
          participants: result.participants.map(participantToVm)
        }, "conversations.create");
      } catch (error) {
        mapRepositoryError(error);
      }
    },

    // ── R15 批 B（人对人私聊）：查/开一对用户的 DM ───────────────────────────────────
    // 自聊在这里先行 400（不进仓库）；目标不在工作区由仓库抛 ConversationDmTargetError → 404。
    // 返回既有会话列表同款的 conversation VM——发起者天然是 owner（新建时如此；命中既有 DM 时也可能是
    // member，取 DB 里的真实角色，见下）。cuu_enabled=false（DM 默认 Cuu 不在场，B5 拍板）由仓库写死。
    async openDm(input) {
      const human = requireHumanActor(input.actor);
      const targetUserId = input.targetUserId.trim().toLowerCase();
      if (!targetUserId) {
        throw new ConversationServiceError(400, "conversation_dm_target_required", "请选择一个私聊对象。");
      }
      if (targetUserId === human.userId.toLowerCase()) {
        throw new ConversationServiceError(400, "conversation_dm_self", "不能和自己开私聊。");
      }
      let result: Awaited<ReturnType<ConversationRepository["openOrCreateDm"]>>;
      try {
        result = await repository.openOrCreateDm({
          workspaceId: human.workspaceId,
          actorUserId: human.userId,
          targetUserId,
          at: now()
        });
      } catch (error) {
        mapRepositoryError(error);
      }
      // participant_role：DM 里发起者一定是两名参与者之一——命中既有 DM 时，取「本 actor 相对这条 DM」的
      // 真实角色（发起过的那方是 owner、被开聊的那方是 member）。这里按 created_by 判定：会话 createdBy===
      // 本 actor 即 owner，否则 member。不额外查参与者表（VM 只需要一个 owner/member 标签）。
      const participantRole =
        result.conversation.createdBy?.toLowerCase() === human.userId.toLowerCase() ? "owner" : "member";
      return parseOutputContract(
        openDmResultVmSchema,
        { conversation: conversationToVm(result.conversation, participantRole) },
        "conversations.dm.open"
      );
    },

    // ── R15 批 B（人对人私聊）：actor 参与的 DM 列表 ─────────────────────────────────────
    // 参与者门控在仓库层做（只回 actor 是 participant 的 DM）。participant_role 与 openDm 同款按
    // created_by 判定（发起过的那方 owner、被开聊的那方 member），不额外查参与者角色列。
    async listDms(input) {
      const human = requireHumanActor(input.actor);
      const rows = await repository.listDmsForUser({
        workspaceId: human.workspaceId,
        userId: human.userId,
        limit: DM_LIST_CAP
      });
      // R15 批 A6（rail 未读红点）：复用 A4 的同一条聚合 SQL（unreadCountsForViewer，禁 N+1）给每条 DM 会话
      // 带上当前 viewer 的未读数——DM 列表复用 conversationVmSchema，unread_count 是 additive optional，与
      // listConversations 同口径。聚合失败只降级成"不带未读数"，绝不因为红点算不出来而让整份 DM 列表 500。
      let unreadCounts = new Map<string, number>();
      try {
        unreadCounts = await repository.unreadCountsForViewer({
          viewerUserId: human.userId,
          conversationIds: rows.map((row) => row.conversation.id)
        });
      } catch (error) {
        logger.warn("dm_list_unread_aggregate_failed", {
          viewerUserId: human.userId,
          error
        });
      }
      return parseOutputContract(
        dmListVmSchema,
        {
          items: rows.map((row) => ({
            conversation: conversationToVm(
              row.conversation,
              row.conversation.createdBy?.toLowerCase() === human.userId.toLowerCase() ? "owner" : "member",
              unreadCounts.get(row.conversation.id) ?? 0
            ),
            participants: row.participants.map((participant) => ({
              user_id: participant.userId,
              nickname: participant.nickname,
              is_self: participant.isSelf
            }))
          }))
        },
        "conversations.dm.list"
      );
    },

    // ── R14FIX 批 workbench：协同会话改名 ─────────────────────────────────────────────
    // 红线（04 §4 铁律 / 01-chat-design：主区随项目原子创建、不可改名；协同会话是可命名的单元）：
    //   1. 会话可见（visibleConversation 已 404 挡住不可见者）；
    //   2. 仅 collab 会话可改名——main（团队主区/个人空间单聊）一律 403，不给一个点了必失败的入口；
    //   3. 仅参与者/owner（participantRole !== null）——project 可见的 collab 里的旁观者不能改名。
    // 没有 conversation.updated 事件（本仓库事件面只到 message/reaction/read 三类），改名后靠客户端
    // 就地更新左栏树叶 / 下次拉会话树刷新，不广播（见交付报告说明）。
    async renameConversation(input) {
      const { human, access } = await visibleConversation(input);
      const conversation = access.conversation;
      if (conversation.kind !== "collab") {
        throw new ConversationServiceError(
          403,
          "conversation_rename_forbidden",
          "只有协同会话可以改名。"
        );
      }
      if (access.participantRole === null) {
        throw new ConversationServiceError(
          403,
          "conversation_rename_forbidden",
          "只有会话的参与者才能给它改名。"
        );
      }
      let updated: ConversationRow;
      try {
        updated = await repository.renameConversation({
          workspaceId: human.workspaceId,
          conversationId: conversation.id,
          title: input.payload.title,
          at: now()
        });
      } catch (error) {
        mapRepositoryError(error);
      }
      return parseOutputContract(
        renameConversationResultVmSchema,
        { conversation: conversationToVm(updated, access.participantRole) },
        "conversations.rename"
      );
    },

    async listMessages(input) {
      const human = requireHumanActor(input.actor);
      // R12 批8：beforeSeq（反向翻页）和 afterSeq（正向，批 0 既有）在契约层互斥——
      // conversationMessageListQuerySchema 是一个 union，两个分支的键不会同时出现。
      if ("beforeSeq" in input.query) {
        const result = await repository.listMessagesBefore({
          workspaceId: human.workspaceId,
          viewerUserId: human.userId,
          conversationId: input.conversationId,
          beforeSeq: input.query.beforeSeq,
          limit: input.query.limit
        });
        if (!result) {
          throw new ConversationServiceError(404, "conversation_not_found", "没有找到这个会话。");
        }
        // rows 已经是 seq 升序（仓库层保证）——next_after_seq 复用页内最高 seq，让客户端加载完一页
        // 更早历史后，仍然能无缝拼上「继续往前追」的正向翻页游标，不强制它单独再查一次。
        const highestSeqInPage = result.rows.reduce((max, row) => Math.max(max, row.seq), 0);
        const messages = await enrichMessageRows(input.conversationId, result.rows, human.userId);
        return parseOutputContract(conversationMessagePageVmSchema, {
          messages,
          has_more: result.hasMore,
          next_after_seq: highestSeqInPage,
          next_before_seq: result.nextBeforeSeq
        }, "conversations.messages.list");
      }
      const result = await repository.listMessagesAfter({
        workspaceId: human.workspaceId,
        viewerUserId: human.userId,
        conversationId: input.conversationId,
        afterSeq: input.query.afterSeq,
        limit: input.query.limit
      });
      if (!result) {
        throw new ConversationServiceError(404, "conversation_not_found", "没有找到这个会话。");
      }
      const messages = await enrichMessageRows(input.conversationId, result.rows, human.userId);
      return parseOutputContract(conversationMessagePageVmSchema, {
        messages,
        has_more: result.hasMore,
        next_after_seq: result.nextAfterSeq
      }, "conversations.messages.list");
    },

    async createMessage(input) {
      const { human, access } = await visibleConversation(input);
      let writeInput: CreateUserMessageInput;
      if (input.payload.kind === "text") {
        writeInput = {
          workspaceId: human.workspaceId,
          conversationId: input.conversationId,
          senderUserId: human.userId,
          kind: "text",
          contentJson: input.payload.content,
          ...(input.payload.thread_root_id ? { threadRootId: input.payload.thread_root_id } : {}),
          // R14 批 CHAT（引用回复）：仅 text 新消息可带引用——目标同会话/存在/未删除的校验在仓库层
          // 事务内做（对已删/跨会话/不存在的目标抛 ConversationReplyTargetError → 400）。
          ...(input.payload.reply_to_message_id ? { replyToMessageId: input.payload.reply_to_message_id } : {}),
          at: now()
        };
      } else {
        let file: Awaited<ReturnType<DrivePageService["file"]>>;
        try {
          file = await options.driveFiles.file({
            actor: human.actor,
            projectId: access.conversation.projectId,
            itemId: input.payload.content.drive_item_id
          });
        } catch (error) {
          if (error instanceof DrivePageServiceError && (error.status === 403 || error.status === 404)) {
            throw new ConversationServiceError(404, "conversation_file_not_found", "没有找到这个可引用的网盘文件。");
          }
          throw error;
        }
        if (
          file.projectId !== access.conversation.projectId
          || file.itemId !== input.payload.content.drive_item_id
        ) {
          throw new Error("Drive file authorization returned mismatched project or item identity");
        }
        const contentJson = parseOutputContract(conversationFileCardContentSchema, {
          drive_item_id: file.itemId,
          snapshot_name: file.filename
        }, "conversations.file-card");
        writeInput = {
          workspaceId: human.workspaceId,
          conversationId: input.conversationId,
          senderUserId: human.userId,
          kind: "file_card",
          contentJson,
          ...(input.payload.thread_root_id ? { threadRootId: input.payload.thread_root_id } : {}),
          at: now()
        };
      }

      let created: ConversationMessageRow;
      try {
        created = await repository.createUserMessage(writeInput);
      } catch (error) {
        mapRepositoryError(error);
      }
      // 富化：新消息还没有 reactions，但可能带 reply_to——补上引用预览（一次 join），让响应与广播都完整。
      const message = parseOutputContract(
        conversationMessageVmSchema,
        await enrichSingleMessage(access.conversation.id, created, human.userId),
        "conversations.messages.create"
      );
      const conversationTopic = topics.conversation(access.conversation.id).topic;
      const previewText = message.kind === "text"
        ? message.content.text
        : message.kind === "file_card"
          ? message.content.snapshot_name
          : message.kind;
      const event = parseOutputContract(
        conversationMessageCreatedEventSchema,
        makeWorkHubEvent({
          type: eventTypes.conversationMessageCreated,
          topic: conversationTopic,
          ts: now(),
          actor: {
            actor_kind: "human",
            actor_user_id: human.userId,
            label: human.actor.label
          },
          project_id: access.conversation.projectId,
          preview_text: previewText,
          data: message
        }),
        "conversations.messages.event.created"
      );
      try {
        await bus.publish(conversationTopic, eventTypes.conversationMessageCreated, event);
      } catch (error) {
        logger.warn("conversation_message_publish_failed", {
          event_id: event.event_id,
          topic: conversationTopic,
          conversation_id: message.conversation_id,
          message_id: message.id,
          seq: message.seq,
          broker_backend: bus.backend,
          error
        });
      }

      // R15 批 A（A5 消息通知）：给其他参与者扇出 conversation.message 通知——fire-and-forget，绝不阻塞/
      // 拖垮这次消息创建的 HTTP 响应（内部已全程 try/catch 吞错，这里的 void+catch 是双保险）。DM/协同天然
      // 生效（参与者=2/N）；主区无 participant 行 → 无收件人 → 内部短路不发。
      if (options.messageNotify) {
        const notify = options.messageNotify;
        void notifyConversationMessage(
          { repository, presence: notify.presence, notifications: notify.notifications, logger },
          {
            conversationId: access.conversation.id,
            projectId: access.conversation.projectId,
            conversationTitle: access.conversation.title,
            senderUserId: human.userId,
            senderLabel: human.actor.label ?? "",
            messageKind: message.kind,
            previewText
          }
        ).catch(() => {});
      }

      // R14 FIX批10（被 @ 的回复延迟：事件驱动直通）——见 ConversationMentionTriggerDeps 顶部注释。
      // 触发口径必须与回话判定器 listReplyJudgeCandidates 的候选口径完全一致（kind='collab' 且
      // participantCount>1），否则会出现"直通覆盖了判定器根本不会扫到的会话"这种新分叉行为：
      //   - 主区（kind='main'，含团队主区与个人空间单聊）：kind !== 'collab' 直接短路，不占用一次
      //     createTurn 调用——个人空间单聊/1:1 协同会话本来就由桌面端"发消息后自动请一轮 turn"的既有
      //     路径处理（shouldRequestConversationTurn），直通对它们刻意不生效，避免同一条消息被两条
      //     机制各触发一次 turn（这两条路径唯一的共同防线是 createTurn 自己的 activeTurns busy 闸，
      //     不能指望它、更不应该主动制造原本不存在的竞态）。
      //   - cuu_enabled=false：前置跳过，省一次注定会被 createTurn 自己的硬闸拒掉（409）的调用；
      //     这个字段已经在本次 access 读取里拿到，不需要多一次查询。
      //   - participantCount<=1 的 collab 会话：同 kind='main' 的理由，已经有客户端即时自动请路径。
      if (options.mentionTrigger && message.kind === "text") {
        const trigger = options.mentionTrigger;
        const conversation = access.conversation;
        const isMentionTriggerEligible =
          conversation.kind === "collab" &&
          access.participantCount > 1 &&
          conversation.cuuEnabled !== false &&
          mentionsCuu(message.content.text, trigger.cuuDisplayName);
        if (isMentionTriggerEligible) {
          // 标记必须是函数体接下来第一个同步动作（在任何 await 之前）：这次 createMessage 调用还没有
          // 返回给 HTTP 层之前，判定器的"已判定"水位线就已经更新——关闭它与后台轮询 tick 之间的竞态
          // 窗口（判定器最长 15s 才会扫一次，实践中窗口早已关闭，这里只是把"尽量早"钉成"确定早"）。
          trigger.markMentionHandled({ conversationId: conversation.id, messageId: message.id });
          const syntheticActor: AuthActor = {
            kind: "human",
            id: human.userId,
            label: "workspace-member",
            userId: human.userId,
            isAdmin: false,
            orgId: "",
            workspaceId: human.workspaceId
          };
          // fire-and-forget：不 await，不能让一次 Cuu 回应的耗时（可能到 120s 的 turn 超时）拖慢这次
          // 消息创建的 HTTP 响应。失败（撞会话忙碌闸/模式闸/预算耗尽/LLM 失败等）只记警告——发送者
          // 已经看到消息落库成功，这与判定器 runOnce 自己对失败候选的既有取舍（只 warn 不重试）一致，
          // 也不产生"消息发出去了但服务端 500"这种矛盾观感。
          void trigger.turns
            .createTurn({
              actor: syntheticActor,
              conversationId: conversation.id,
              payload: { user_message_id: message.id }
            })
            .catch((error) => {
              logger.warn("conversation_mention_direct_trigger_failed", {
                conversation_id: conversation.id,
                message_id: message.id,
                error
              });
            });
        }
      }

      return message;
    },

    // ── R14 批 CHAT：编辑 ────────────────────────────────────────────────────────────
    async editMessage(input) {
      const { human, access } = await visibleConversation(input);
      let updated: ConversationMessageRow;
      try {
        updated = await repository.editMessage({
          workspaceId: human.workspaceId,
          conversationId: input.conversationId,
          messageId: input.messageId,
          editorUserId: human.userId,
          text: input.payload.text,
          editWindowMs: CONVERSATION_EDIT_WINDOW_MS,
          at: now()
        });
      } catch (error) {
        mapRepositoryError(error);
      }
      const message = parseOutputContract(
        conversationMessageVmSchema,
        await enrichSingleMessage(access.conversation.id, updated, human.userId),
        "conversations.messages.edit"
      );
      await publishMessageUpdated(access.conversation, human, message, updated);
      return message;
    },

    // ── R14 批 CHAT：墓碑删除（幂等） ─────────────────────────────────────────────────
    async deleteMessage(input) {
      const { human, access } = await visibleConversation(input);
      let updated: ConversationMessageRow;
      try {
        updated = await repository.deleteMessage({
          workspaceId: human.workspaceId,
          conversationId: input.conversationId,
          messageId: input.messageId,
          deleterUserId: human.userId,
          at: now()
        });
      } catch (error) {
        mapRepositoryError(error);
      }
      // 墓碑 VM 归一（messageToVm 的 deleted 分支）——不带 reactions/reply，无需富化查询。
      const message = parseOutputContract(
        conversationMessageVmSchema,
        messageToVm(updated),
        "conversations.messages.delete"
      );
      await publishMessageUpdated(access.conversation, human, message, updated);
      return message;
    },

    // ── R14 批 CHAT：置顶 / 取消置顶（幂等，204） ─────────────────────────────────────
    async pinMessage(input) {
      const { human, access } = await visibleConversation(input);
      let updated: ConversationMessageRow;
      try {
        updated = await repository.pinMessage({
          workspaceId: human.workspaceId,
          conversationId: input.conversationId,
          messageId: input.messageId,
          pinnerUserId: human.userId,
          at: now()
        });
      } catch (error) {
        mapRepositoryError(error);
      }
      const message = parseOutputContract(
        conversationMessageVmSchema,
        await enrichSingleMessage(access.conversation.id, updated, human.userId),
        "conversations.messages.pin"
      );
      await publishMessageUpdated(access.conversation, human, message, updated);
    },

    async unpinMessage(input) {
      const { human, access } = await visibleConversation(input);
      let updated: ConversationMessageRow;
      try {
        updated = await repository.unpinMessage({
          workspaceId: human.workspaceId,
          conversationId: input.conversationId,
          messageId: input.messageId,
          at: now()
        });
      } catch (error) {
        mapRepositoryError(error);
      }
      const message = parseOutputContract(
        conversationMessageVmSchema,
        await enrichSingleMessage(access.conversation.id, updated, human.userId),
        "conversations.messages.unpin"
      );
      await publishMessageUpdated(access.conversation, human, message, updated);
    },

    // ── R14 批 CHAT：reaction 幂等加/减（204，发 reaction.updated 全量聚合） ────────────
    async addReaction(input) {
      const { human, access } = await visibleConversation(input);
      const reactionKey = parseReactionKey(input.reactionKey);
      let result: { reactions: MessageReactionAggregate[] };
      try {
        result = await repository.addReaction({
          workspaceId: human.workspaceId,
          conversationId: input.conversationId,
          messageId: input.messageId,
          userId: human.userId,
          reactionKey,
          at: now()
        });
      } catch (error) {
        mapRepositoryError(error);
      }
      await publishReactionUpdated(access.conversation, input.messageId, result.reactions);
    },

    async removeReaction(input) {
      const { human, access } = await visibleConversation(input);
      const reactionKey = parseReactionKey(input.reactionKey);
      let result: { reactions: MessageReactionAggregate[] };
      try {
        result = await repository.removeReaction({
          workspaceId: human.workspaceId,
          conversationId: input.conversationId,
          messageId: input.messageId,
          userId: human.userId,
          reactionKey,
          at: now()
        });
      } catch (error) {
        mapRepositoryError(error);
      }
      await publishReactionUpdated(access.conversation, input.messageId, result.reactions);
    },

    // ── R14 批 CHAT：已读游标推进（发 read.updated） ─────────────────────────────────
    async advanceReadCursor(input) {
      const { human, access } = await visibleConversation(input);
      let result: { lastReadSeq: number };
      try {
        result = await repository.advanceReadCursor({
          workspaceId: human.workspaceId,
          conversationId: input.conversationId,
          userId: human.userId,
          lastReadSeq: input.payload.last_read_seq,
          at: now()
        });
      } catch (error) {
        mapRepositoryError(error);
      }
      await publishReadUpdated(access.conversation, human.userId, result.lastReadSeq);
      return parseOutputContract(
        conversationReadCursorVmSchema,
        { last_read_seq: result.lastReadSeq },
        "conversations.read.cursor"
      );
    },

    async listReceipts(input) {
      const { human, access } = await visibleConversation(input);
      const receipts = await repository.listReceipts({
        workspaceId: human.workspaceId,
        conversationId: access.conversation.id
      });
      return parseOutputContract(
        conversationReadReceiptsVmSchema,
        { receipts: receipts.map((row) => ({ user_id: row.userId, last_read_seq: row.lastReadSeq })) },
        "conversations.read.receipts"
      );
    },

    async listPins(input) {
      const { human, access } = await visibleConversation(input);
      const rows = await repository.listPins({
        workspaceId: human.workspaceId,
        conversationId: access.conversation.id,
        limit: CONVERSATION_PINS_CAP
      });
      const messages = await enrichMessageRows(access.conversation.id, rows, human.userId);
      return parseOutputContract(
        conversationPinsVmSchema,
        { messages },
        "conversations.pins.list"
      );
    }
  };
}

let defaultDbClient: WorkHubDatabaseClient | undefined;
let defaultConversationService: ConversationService | undefined;

export function getDefaultConversationService(): ConversationService {
  if (!defaultConversationService) {
    defaultDbClient = getSharedDatabaseClient();
    defaultConversationService = createConversationService(
      createConversationRepository(defaultDbClient.db),
      {
        driveFiles: getDefaultDrivePageService(),
        bus: getDefaultPushBus(),
        logger: getDefaultStructuredLogger(),
        // R14 批 FEEDBACK：读聚合复用同一个共享 DB 客户端的 ai_feedback 仓库——消息 VM / 行动卡条目
        // 富化时只回当前 viewer 自己的判定（listForSubjects 的 userId 过滤）。
        aiFeedback: createAiFeedbackRepository(defaultDbClient.db),
        // R14 FIX批10：直通复用既有的 turn 服务单例（与判定器 worker 触发 turn 走的是同一个
        // ConversationTurnService 实例，activeTurns busy 闸因此天然共享）和判定器服务单例（模块级
        // 缓存，markMentionHandled 操作的是同一张 lastJudgedByConversation Map，见该文件顶部注释）。
        mentionTrigger: {
          turns: getDefaultConversationTurnService(),
          markMentionHandled: (input) => getDefaultConversationReplyJudgeService().markMentionHandled(input)
        },
        // R15 批 A（A5 消息通知）：人类消息落库后扇出 conversation.message 通知。presence 用会话级「正在看」
        // 注册表（同 SSE 流写的那个单例），notifications 用默认通知服务（自带静音检查 + dedupe 复活推送）。
        messageNotify: {
          presence: getDefaultPresenceStore(),
          notifications: createNotificationService()
        }
      }
    );
  }
  return defaultConversationService;
}
