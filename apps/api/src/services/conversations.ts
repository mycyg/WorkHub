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

export type ConversationServiceOptions = {
  driveFiles: Pick<DrivePageService, "file">;
  now?: () => Date;
  bus?: Pick<PushBus, "backend" | "publish">;
  logger?: Pick<StructuredLogger, "warn">;
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
        logger: getDefaultStructuredLogger()
      }
    );
  }
  return defaultConversationService;
}
