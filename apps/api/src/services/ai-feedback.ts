import {
  createActionCardRepository,
  createAiFeedbackRepository,
  createConversationRepository,
  getSharedDatabaseClient,
  type ActionCardRepository,
  type AiFeedbackRepository,
  type AiFeedbackRow,
  type ConversationRepository
} from "@workhub/db";
import { AI_FEEDBACK_NOTE_MAX_CHARS, type AiFeedbackVerdict } from "@workhub/contracts";

import type { AuthActor } from "../middleware/auth.js";
import { getDefaultConversationService, type ConversationService } from "./conversations.js";
import { getDefaultProposalService, type ProposalService } from "./proposals.js";
import { getDefaultWorkItemService, type WorkItemService } from "./work-items.js";
import { looksLikeInjection } from "./skill-curation.js";

// R14 批 FEEDBACK：类型化服务错误——照 memory-conflicts.ts 的 MemoryConflictServiceError 模板。
// 三个挂载点（消息/提议/行动卡路由）各自 instanceof 兜底成路由既有映射；app.ts 只需补一个 instanceof
// 分支（见交付报告的挂载 snippet）。消息路由的会话可见性走 assertConversationAccess，抛的是既有的
// ConversationServiceError（app.ts 已映射），不重复包裹。
export class AiFeedbackServiceError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "AiFeedbackServiceError";
  }
}

type FeedbackWrite = { verdict: AiFeedbackVerdict; note?: string | null };

export type AiFeedbackServiceDependencies = {
  repo?: AiFeedbackRepository;
  // conversation_message：可见性复用会话服务的 assertConversationAccess；消息本体的资格判定用仓库读。
  conversations?: Pick<ConversationService, "assertConversationAccess">;
  conversationMessages?: Pick<ConversationRepository, "findMessageForFeedback">;
  // proposal：存在性 + work-item 可见性（与 GET /proposals/:id 同款判定）。
  proposals?: Pick<ProposalService, "get">;
  workItems?: Pick<WorkItemService, "canReadWorkItems">;
  // action_card_item：workspace 围栏（与 decide/undo 同款 findItemForActor，不收紧不放宽）。
  actionCards?: Pick<ActionCardRepository, "findItemForActor">;
  now?: () => Date;
};

export type AiFeedbackService = {
  putMessageFeedback: (
    input: { actor: AuthActor; conversationId: string; messageId: string } & FeedbackWrite
  ) => Promise<void>;
  removeMessageFeedback: (input: {
    actor: AuthActor;
    conversationId: string;
    messageId: string;
  }) => Promise<void>;
  putProposalFeedback: (input: { actor: AuthActor; proposalId: string } & FeedbackWrite) => Promise<void>;
  removeProposalFeedback: (input: { actor: AuthActor; proposalId: string }) => Promise<void>;
  putActionCardItemFeedback: (input: { actor: AuthActor; itemId: string } & FeedbackWrite) => Promise<void>;
  removeActionCardItemFeedback: (input: { actor: AuthActor; itemId: string }) => Promise<void>;
};

// 需要已加入工作区的真人才能反馈（同 conversations/action-cards 服务的 requireHumanActor 口径）。
function humanIdentity(actor: AuthActor): { userId: string; workspaceId: string } {
  const userId = actor.userId?.trim();
  const workspaceId = actor.workspaceId?.trim();
  if (actor.kind !== "human" || !userId || !workspaceId) {
    throw new AiFeedbackServiceError(403, "ai_feedback_human_required", "需要已加入工作区的真人用户才能反馈。");
  }
  return { userId, workspaceId };
}

// 备注归一 + 校验：空串等同「无备注」（存 null）；超长 400；指令注入短语 400（备注会进 curation
// prompt，人类输入不该比 AI 自己写的技能正文更松，见设计 §1/§2）。
function normalizeNote(note: string | null | undefined): string | null {
  if (note === undefined || note === null) {
    return null;
  }
  const trimmed = note.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > AI_FEEDBACK_NOTE_MAX_CHARS) {
    throw new AiFeedbackServiceError(
      400,
      "ai_feedback_note_too_long",
      `备注最多 ${AI_FEEDBACK_NOTE_MAX_CHARS} 个字符。`
    );
  }
  if (looksLikeInjection(trimmed)) {
    throw new AiFeedbackServiceError(400, "ai_feedback_note_rejected", "备注里不能包含改写指令类的措辞。");
  }
  return trimmed;
}

const SUBJECT_NOT_FOUND = "ai_feedback_subject_not_found";

export function createAiFeedbackService(deps: AiFeedbackServiceDependencies = {}): AiFeedbackService {
  const repo = deps.repo ?? createAiFeedbackRepository(getSharedDatabaseClient().db);
  const conversations = deps.conversations ?? getDefaultConversationService();
  const conversationMessages =
    deps.conversationMessages ?? createConversationRepository(getSharedDatabaseClient().db);
  const proposals = deps.proposals ?? getDefaultProposalService();
  const workItems = deps.workItems ?? getDefaultWorkItemService();
  const actionCards = deps.actionCards ?? createActionCardRepository(getSharedDatabaseClient().db);
  const now = deps.now ?? (() => new Date());

  async function assertProposalReadable(workItemId: string, actor: AuthActor) {
    const visible = await workItems.canReadWorkItems({ workItemIds: [workItemId], actor });
    if (!visible.has(workItemId)) {
      throw new AiFeedbackServiceError(403, "ai_feedback_forbidden", "你没有权限反馈这个变更申请。");
    }
  }

  async function loadReadableProposalWorkItemId(proposalId: string, actor: AuthActor): Promise<string> {
    const proposal = await proposals.get(proposalId);
    if (!proposal) {
      throw new AiFeedbackServiceError(404, SUBJECT_NOT_FOUND, "没有找到这个变更申请。");
    }
    await assertProposalReadable(proposal.work_item_id, actor);
    return proposal.work_item_id;
  }

  async function assertActionCardItemReadable(itemId: string, workspaceId: string) {
    const record = await actionCards.findItemForActor({ itemId, workspaceId });
    if (!record) {
      // findItemForActor 只按 workspace 定位——不存在与跨工作区都塌成 404（同 decide/undo 口径）。
      throw new AiFeedbackServiceError(404, SUBJECT_NOT_FOUND, "没有找到这个行动卡条目。");
    }
  }

  return {
    async putMessageFeedback(input) {
      // 会话可见性先行把关（非真人 → 403；会话不可见 → 404，均为既有 ConversationServiceError）。
      await conversations.assertConversationAccess({ actor: input.actor, conversationId: input.conversationId });
      const { userId, workspaceId } = humanIdentity(input.actor);
      const message = await conversationMessages.findMessageForFeedback({
        workspaceId,
        conversationId: input.conversationId,
        messageId: input.messageId
      });
      // 只对 Cuu 的活着的文字回复开放——对人类消息/系统消息/墓碑/不存在一律 404（对着墓碑或人类消息
      // 打分没有语义）。
      if (!message || message.senderType !== "cuu" || message.kind !== "text" || message.deletedAt) {
        throw new AiFeedbackServiceError(404, SUBJECT_NOT_FOUND, "没有找到可以反馈的消息。");
      }
      const note = normalizeNote(input.note);
      await repo.upsert({
        workspaceId,
        subjectType: "conversation_message",
        subjectId: input.messageId,
        userId,
        verdict: input.verdict,
        note,
        at: now()
      });
    },

    async removeMessageFeedback(input) {
      // 撤销幂等：只要会话可见就 204（不区分「没反馈」与「不存在」）。
      await conversations.assertConversationAccess({ actor: input.actor, conversationId: input.conversationId });
      const { userId } = humanIdentity(input.actor);
      await repo.remove({ subjectType: "conversation_message", subjectId: input.messageId, userId });
    },

    async putProposalFeedback(input) {
      const { userId, workspaceId } = humanIdentity(input.actor);
      await loadReadableProposalWorkItemId(input.proposalId, input.actor);
      const note = normalizeNote(input.note);
      await repo.upsert({
        workspaceId,
        subjectType: "proposal",
        subjectId: input.proposalId,
        userId,
        verdict: input.verdict,
        note,
        at: now()
      });
    },

    async removeProposalFeedback(input) {
      const { userId } = humanIdentity(input.actor);
      await loadReadableProposalWorkItemId(input.proposalId, input.actor);
      await repo.remove({ subjectType: "proposal", subjectId: input.proposalId, userId });
    },

    async putActionCardItemFeedback(input) {
      const { userId, workspaceId } = humanIdentity(input.actor);
      await assertActionCardItemReadable(input.itemId, workspaceId);
      const note = normalizeNote(input.note);
      await repo.upsert({
        workspaceId,
        subjectType: "action_card_item",
        subjectId: input.itemId,
        userId,
        verdict: input.verdict,
        note,
        at: now()
      });
    },

    async removeActionCardItemFeedback(input) {
      const { userId, workspaceId } = humanIdentity(input.actor);
      await assertActionCardItemReadable(input.itemId, workspaceId);
      await repo.remove({ subjectType: "action_card_item", subjectId: input.itemId, userId });
    }
  };
}

let defaultService: AiFeedbackService | undefined;

export function getDefaultAiFeedbackService(): AiFeedbackService {
  if (!defaultService) {
    defaultService = createAiFeedbackService();
  }
  return defaultService;
}

// 仅供 pages.ts 的提议详情页读聚合复用——单主体读（已在 canReadWorkItem 之后调用，无需再判可见性）。
export type { AiFeedbackRow };
