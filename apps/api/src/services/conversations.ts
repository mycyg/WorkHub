import {
  ConversationAccessDeniedError,
  ConversationParentAccessError,
  ConversationParticipantMembershipError,
  ConversationRepositoryInputError,
  ConversationSequenceExhaustedError,
  ConversationSourceMessageMismatchError,
  ConversationThreadRootMismatchError,
  createConversationRepository,
  getSharedDatabaseClient,
  type ConversationMessageRow,
  type ConversationParticipantRow,
  type ConversationRepository,
  type ConversationRow,
  type CreateUserMessageInput,
  type VisibleConversationRow,
  type WorkHubDatabaseClient
} from "@workhub/db";
import {
  conversationFileCardContentSchema,
  conversationMessageCreatedEventSchema,
  conversationListPageVmSchema,
  conversationMessagePageVmSchema,
  conversationMessageVmSchema,
  createConversationResultVmSchema,
  eventTypes,
  type ConversationListPageVM,
  type ConversationListQuery,
  type ConversationMessageListQuery,
  type ConversationMessagePageVM,
  type ConversationMessageVM,
  type CreateConversationMessageRequest,
  type CreateConversationRequest,
  type CreateConversationResultVM
} from "@workhub/contracts";
import { makeWorkHubEvent, topics } from "@workhub/events";

import { getDefaultPushBus, type PushBus } from "../broker/index.js";
import { getDefaultStructuredLogger, type StructuredLogger } from "../logging.js";
import type { AuthActor } from "../middleware/auth.js";
import { parseOutputContract } from "../pages/output-contract.js";
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

function conversationToVm(row: ConversationRow | VisibleConversationRow, participantRole?: "owner" | "member" | null) {
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

function messageToVm(row: ConversationMessageRow) {
  return {
    id: row.id,
    conversation_id: row.conversationId,
    seq: row.seq,
    sender_type: row.senderType,
    sender_user_id: row.senderUserId,
    kind: row.kind,
    content: row.contentJson,
    thread_root_id: row.threadRootId,
    created_at: row.createdAt.toISOString()
  };
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
  if (error instanceof ConversationSequenceExhaustedError) {
    throw new ConversationServiceError(409, "conversation_sequence_exhausted", "这个会话的消息序号已经耗尽。");
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
      return parseOutputContract(conversationListPageVmSchema, {
        conversations: result.rows.map((row) => conversationToVm(row)),
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
        return parseOutputContract(conversationMessagePageVmSchema, {
          messages: result.rows.map(messageToVm),
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
      return parseOutputContract(conversationMessagePageVmSchema, {
        messages: result.rows.map(messageToVm),
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
      const message = parseOutputContract(
        conversationMessageVmSchema,
        messageToVm(created),
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
        // R14 FIX批10：直通复用既有的 turn 服务单例（与判定器 worker 触发 turn 走的是同一个
        // ConversationTurnService 实例，activeTurns busy 闸因此天然共享）和判定器服务单例（模块级
        // 缓存，markMentionHandled 操作的是同一张 lastJudgedByConversation Map，见该文件顶部注释）。
        mentionTrigger: {
          turns: getDefaultConversationTurnService(),
          markMentionHandled: (input) => getDefaultConversationReplyJudgeService().markMentionHandled(input)
        }
      }
    );
  }
  return defaultConversationService;
}
