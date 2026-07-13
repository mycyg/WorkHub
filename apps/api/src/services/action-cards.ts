import {
  conversationActionCardUpdatedEventSchema,
  eventTypes
} from "@workhub/contracts";
import {
  createActionCardRepository,
  createAiDecisionRepository,
  createWorkItemRepository,
  getSharedDatabaseClient,
  type ActionCardItemRow,
  type ActionCardRepository,
  type AiDecisionRepository,
  type WorkItemDataRepository
} from "@workhub/db";
import { makeWorkHubEvent, topics } from "@workhub/events";

import { getDefaultPushBus, type PushBus } from "../broker/index.js";
import { getDefaultStructuredLogger, type StructuredLogger } from "../logging.js";
import type { AuthActor } from "../middleware/auth.js";
import { InternalContractError, parseOutputContract } from "../pages/output-contract.js";
import { AgentRunnerError, getDefaultAgentRunQueue, type AgentRunQueue } from "../workers/agent-runner.js";

// R12 批3：行动卡条目的决策(decide)与撤销(undo)。批0冻结了存储与协议，运行时语义(observer 分派、
// abort、语义化留痕)在本批一并交付——见 02-construction-plan.md「批3」与 03 §2B/§2C。

export class ActionCardServiceError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409 | 422 | 500,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ActionCardServiceError";
  }
}

// 00-interaction-design.md §2.3 的卡片按钮：交给我干 / 派给别人… / 先不动。
export type DecideActionCardItemAction = "claim" | "reassign" | "defer";

export type DecideActionCardItemInput = {
  actor: AuthActor;
  itemId: string;
  action: DecideActionCardItemAction;
  assigneeUserId?: string;
};

export type UndoActionCardItemInput = {
  actor: AuthActor;
  itemId: string;
};

export type ActionCardItemVM = {
  id: string;
  conversation_id: string;
  action_card_id: string;
  kind: string;
  title_md: string;
  confidence: string;
  status: string;
  assignee_user_id: string | null;
  work_item_id: string | null;
  run_id: string | null;
  undo_deadline_at: string | null;
};

export type ActionCardService = {
  decide(input: DecideActionCardItemInput): Promise<ActionCardItemVM>;
  undo(input: UndoActionCardItemInput): Promise<ActionCardItemVM>;
};

export type ActionCardServiceOptions = {
  actionCards: Pick<
    ActionCardRepository,
    "findItemForActor" | "transitionItemStatus" | "postSystemMessage" | "isActiveWorkspaceMember"
  >;
  decisions: Pick<AiDecisionRepository, "listEscalationEventsForWorkItem" | "resolveEscalation" | "delegateEscalation">;
  agentRuns: Pick<AgentRunQueue, "abort">;
  // 撤销要把 run 全程锚定的事项关掉；只用 work-items 仓库已导出的 CAS 状态迁移，不新增写面（铁律7）。
  workItems: Pick<WorkItemDataRepository, "transitionWorkItemStatus">;
  now?: () => Date;
  bus?: Pick<PushBus, "publish">;
  logger?: Pick<StructuredLogger, "warn">;
};

function requireHumanActor(actor: AuthActor) {
  const userId = actor.userId?.trim();
  if (actor.kind !== "human" || !userId || !actor.workspaceId) {
    throw new ActionCardServiceError(403, "human_required", "需要已加入工作区的真人用户才能操作行动卡。");
  }
  return { userId, workspaceId: actor.workspaceId, isAdmin: actor.isAdmin };
}

// 铁律9：仅被 @ 的负责人（当前 assignee_user_id）或管理员可操作——比通用「谁能改这个工单」更窄，
// 这里不复用 work-items 服务的 assertCanMutateWorkItem（那个还放行项目负责人/认领人/协作 assignment）。
function assertCanActOnItem(item: ActionCardItemRow, actor: { userId: string; isAdmin: boolean }) {
  if (actor.isAdmin || item.assigneeUserId === actor.userId) {
    return;
  }
  throw new ActionCardServiceError(403, "forbidden", "只有被 @ 的负责人或管理员可以处理这张卡。");
}

function itemToVm(item: ActionCardItemRow): ActionCardItemVM {
  return {
    id: item.id,
    conversation_id: item.conversationId,
    action_card_id: item.actionCardId,
    kind: item.kind,
    title_md: item.titleMd,
    confidence: item.confidence,
    status: item.status,
    assignee_user_id: item.assigneeUserId,
    work_item_id: item.workItemId,
    run_id: item.runId,
    undo_deadline_at: item.undoDeadlineAt ? item.undoDeadlineAt.toISOString() : null
  };
}

export function createActionCardService(options: ActionCardServiceOptions): ActionCardService {
  const now = options.now ?? (() => new Date());
  const bus = options.bus ?? getDefaultPushBus();
  const logger = options.logger ?? getDefaultStructuredLogger();

  async function emitUpdated(item: ActionCardItemRow, messageId: string, previewText: string) {
    const topic = topics.conversation(item.conversationId).topic;
    let event;
    try {
      event = parseOutputContract(
        conversationActionCardUpdatedEventSchema,
        makeWorkHubEvent({
          type: eventTypes.conversationActionCardUpdated,
          topic,
          ts: now(),
          actor: { actor_kind: "ai", label: "Cuu" },
          project_id: item.projectId,
          preview_text: previewText,
          data: {
            conversation_id: item.conversationId,
            action_card_id: item.actionCardId,
            message_id: messageId,
            // 单条目变更只知道自己这一条卡的状态，不重读整卡——事件是「该刷新了」的信号，
            // 完整卡片仍以 GET 为准；status 字段固定 active（卡片对象自身是否 superseded 与
            // 单个条目决策无关，这里不重新判定）。
            status: "active",
            appended: true,
            items: [{ id: item.id, kind: item.kind, confidence: item.confidence, status: item.status }]
          }
        }),
        "action-cards.item-updated.event"
      );
    } catch (error) {
      if (error instanceof InternalContractError) {
        logger.warn("action_card_updated_event_contract_violation", { itemId: item.id, error });
        return;
      }
      throw error;
    }
    try {
      await bus.publish(topic, eventTypes.conversationActionCardUpdated, event);
    } catch (error) {
      logger.warn("action_card_updated_event_publish_failed", { itemId: item.id, error });
    }
  }

  async function requireUnresolvedEscalation(workItemId: string) {
    const events = await options.decisions.listEscalationEventsForWorkItem(workItemId);
    const unresolved = events.find((event) => !event.resolvedAt);
    if (!unresolved) {
      throw new ActionCardServiceError(409, "action_card_decision_already_resolved", "这条决策已经被处理过了。");
    }
    return unresolved;
  }

  return {
    async decide(input) {
      const human = requireHumanActor(input.actor);
      const record = await options.actionCards.findItemForActor({ itemId: input.itemId, workspaceId: human.workspaceId });
      if (!record) {
        throw new ActionCardServiceError(404, "action_card_item_not_found", "没有找到这个行动卡条目。");
      }
      const { item } = record;
      if (item.kind !== "decide") {
        throw new ActionCardServiceError(422, "action_card_item_not_decidable", "这个条目不是需要决策的类型。");
      }
      if (item.status !== "waiting_decision") {
        throw new ActionCardServiceError(409, "action_card_item_already_decided", "这个条目已经被处理过了。");
      }
      if (!item.workItemId) {
        throw new ActionCardServiceError(500, "action_card_item_invariant_violated", "这个决策条目缺少对应的事项记录。");
      }
      assertCanActOnItem(item, human);

      const escalation = await requireUnresolvedEscalation(item.workItemId);
      const at = now();

      if (input.action === "claim") {
        const resolved = await options.decisions.resolveEscalation({
          escalationId: escalation.id,
          targetStatus: "pm_mode",
          workspaceId: human.workspaceId,
          at
        });
        if (!resolved) {
          throw new ActionCardServiceError(409, "action_card_decision_already_resolved", "这条决策已经被处理过了。");
        }
        const updated = await options.actionCards.transitionItemStatus({
          itemId: item.id,
          workspaceId: human.workspaceId,
          fromStatuses: ["waiting_decision"],
          toStatus: "running",
          assigneeUserId: human.userId,
          at
        });
        if (!updated) {
          throw new ActionCardServiceError(409, "action_card_item_already_decided", "这个条目已经被处理过了。");
        }
        await emitUpdated(updated, record.card.messageId, "有人认领了一条决策");
        return itemToVm(updated);
      }

      if (input.action === "reassign") {
        if (!input.assigneeUserId) {
          throw new ActionCardServiceError(400, "action_card_reassign_requires_assignee", "改派需要指定接手的人。");
        }
        const isMember = await options.actionCards.isActiveWorkspaceMember({
          workspaceId: human.workspaceId,
          userId: input.assigneeUserId
        });
        if (!isMember) {
          throw new ActionCardServiceError(422, "action_card_assignee_not_a_member", "这个人不是当前工作区的活跃成员。");
        }
        const delegated = await options.decisions.delegateEscalation({
          escalationId: escalation.id,
          toUserId: input.assigneeUserId,
          workspaceId: human.workspaceId,
          at
        });
        if (!delegated) {
          throw new ActionCardServiceError(409, "action_card_decision_already_resolved", "这条决策已经被处理过了。");
        }
        const updated = await options.actionCards.transitionItemStatus({
          itemId: item.id,
          workspaceId: human.workspaceId,
          fromStatuses: ["waiting_decision"],
          toStatus: "waiting_decision",
          assigneeUserId: input.assigneeUserId,
          at
        });
        if (!updated) {
          throw new ActionCardServiceError(409, "action_card_item_already_decided", "这个条目已经被处理过了。");
        }
        await options.actionCards.postSystemMessage({
          workspaceId: human.workspaceId,
          conversationId: item.conversationId,
          senderType: "system",
          content: { event: "action_card_item_reassigned", action_card_item_id: item.id, to_user_id: input.assigneeUserId },
          threadRootId: record.card.messageId,
          at
        });
        await emitUpdated(updated, record.card.messageId, "一条决策改派给了别人");
        return itemToVm(updated);
      }

      // defer（先不动）：升级卡保持未解决（对应工单仍在 attention 里），只把卡上这一条标记「先不动」。
      const updated = await options.actionCards.transitionItemStatus({
        itemId: item.id,
        workspaceId: human.workspaceId,
        fromStatuses: ["waiting_decision"],
        toStatus: "dismissed",
        at
      });
      if (!updated) {
        throw new ActionCardServiceError(409, "action_card_item_already_decided", "这个条目已经被处理过了。");
      }
      await emitUpdated(updated, record.card.messageId, "一条决策先放着了");
      return itemToVm(updated);
    },

    async undo(input) {
      const human = requireHumanActor(input.actor);
      const record = await options.actionCards.findItemForActor({ itemId: input.itemId, workspaceId: human.workspaceId });
      if (!record) {
        throw new ActionCardServiceError(404, "action_card_item_not_found", "没有找到这个行动卡条目。");
      }
      const { item } = record;
      assertCanActOnItem(item, human);
      const at = now();
      if (!item.runId || item.status !== "running" || !item.undoDeadlineAt || at > item.undoDeadlineAt) {
        throw new ActionCardServiceError(409, "action_card_item_not_undoable", "这个条目已经过了可撤销的窗口。");
      }

      try {
        await options.agentRuns.abort(item.runId, { id: human.userId, isAdmin: human.isAdmin });
      } catch (error) {
        if (!(error instanceof AgentRunnerError && error.code === "agent_run_already_settled")) {
          throw error;
        }
        // run 已经自然结束：撤销仍然有效——继续关闭事项、留痕，只是没有可中止的在飞执行了。
      }

      if (!item.workItemId) {
        throw new ActionCardServiceError(500, "action_card_item_invariant_violated", "这个执行条目缺少对应的事项记录。");
      }
      // 关闭工作副本：run 全程产物锚在这个事项上，撤销即废弃它（留痕不删数据，仍可在事项详情追溯）。
      const transitioned = await options.workItems.transitionWorkItemStatus({
        workItemId: item.workItemId,
        to: "cancelled",
        at
      });
      if (!transitioned) {
        throw new ActionCardServiceError(409, "action_card_item_not_undoable", "这个事项的状态已经变化，无法再撤销。");
      }

      let updated = await options.actionCards.transitionItemStatus({
        itemId: item.id,
        workspaceId: human.workspaceId,
        fromStatuses: ["running"],
        toStatus: "undone",
        at
      });
      if (!updated) {
        // R13 条目终态回写钩子(action-card-run-settlement)上线后的确定性顺序:上面 await abort() 时
        // settled 钩子已把 cancelled 映射成 running→undone 并赢得 CAS——这里落空不代表撤销失败,
        // 复读确认:条目已是 undone 即殊途同归,按成功继续(留痕/播报照旧);其它状态才是真的不可撤销。
        const settled = await options.actionCards.findItemForActor({
          itemId: item.id,
          workspaceId: human.workspaceId
        });
        if (settled?.item.status === "undone") {
          updated = settled.item;
        } else {
          throw new ActionCardServiceError(409, "action_card_item_not_undoable", "这个条目已经过了可撤销的窗口。");
        }
      }
      await options.actionCards.postSystemMessage({
        workspaceId: human.workspaceId,
        conversationId: item.conversationId,
        senderType: "cuu",
        content: { event: "action_card_item_undone", action_card_item_id: item.id, title_md: item.titleMd },
        threadRootId: record.card.messageId,
        at
      });
      await emitUpdated(updated, record.card.messageId, "一条执行被撤销了");
      return itemToVm(updated);
    }
  };
}

let defaultDbClient: ReturnType<typeof getSharedDatabaseClient> | undefined;
let defaultService: ActionCardService | undefined;

export function getDefaultActionCardService(): ActionCardService {
  if (!defaultService) {
    defaultDbClient = getSharedDatabaseClient();
    const db = defaultDbClient.db;
    defaultService = createActionCardService({
      actionCards: createActionCardRepository(db),
      decisions: createAiDecisionRepository(db),
      agentRuns: getDefaultAgentRunQueue(),
      workItems: createWorkItemRepository(db)
    });
  }
  return defaultService;
}
