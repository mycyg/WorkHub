import type {
  AttentionItem,
  DelegateEscalationRequest,
  ResolveEscalationRequest,
  WorkHubLocale,
  WorkItemStatus
} from "@workhub/contracts";
import {
  delegateEscalationRequestSchema,
  resolveEscalationRequestSchema
} from "@workhub/contracts";
import {
  createAiDecisionRepository,
  createUserRepository,
  getSharedDatabaseClient,
  type EscalationServiceRow as DbEscalationServiceRow,
  type UserRepository
} from "@workhub/db";

import type { AuthActor } from "../middleware/auth.js";
import { getDefaultWorkItemService, type WorkItemService } from "./work-items.js";

export type EscalationServiceRow = DbEscalationServiceRow;

export type EscalationRepository = {
  findById: (id: string) => Promise<EscalationServiceRow | null>;
  listUnresolvedForWorkspace: (input: { workspaceId: string; limit?: number }) => Promise<EscalationServiceRow[]>;
  resolveEscalation: (input: { escalationId: string; targetStatus: WorkItemStatus; at: Date }) => Promise<EscalationServiceRow | null>;
  delegateEscalation: (input: { escalationId: string; toUserId: string; at: Date }) => Promise<EscalationServiceRow | null>;
};

export class EscalationServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export type EscalationService = ReturnType<typeof createEscalationService>;

type EscalationServiceDependencies = {
  repository?: EscalationRepository;
  users?: Pick<UserRepository, "findActiveById"> | false;
  workItems?: Pick<WorkItemService, "canReadWorkItems"> | false;
  now?: () => Date;
};

let defaultDbClient: ReturnType<typeof getSharedDatabaseClient> | undefined;

function getDefaultEscalationRepository(): EscalationRepository {
  defaultDbClient ??= getSharedDatabaseClient();
  const repo = createAiDecisionRepository(defaultDbClient.db);
  return {
    findById: (id) => repo.findEscalationById(id),
    listUnresolvedForWorkspace: (input) => repo.listUnresolvedEscalationsForWorkspace(input),
    resolveEscalation: (input) => repo.resolveEscalation(input),
    delegateEscalation: (input) => repo.delegateEscalation(input)
  };
}

function getDefaultUsers() {
  defaultDbClient ??= getSharedDatabaseClient();
  return createUserRepository(defaultDbClient.db);
}

function compactText(value: string, max = 220) {
  const compact = value.replace(/\s+/gu, " ").trim();
  if (compact.length <= max) {
    return compact;
  }
  return `${compact.slice(0, max - 3)}...`;
}

function resolveTargetStatus(action: ResolveEscalationRequest["action"]): WorkItemStatus {
  if (action === "retry") {
    return "ai_working";
  }
  if (action === "pm_mode") {
    return "pm_mode";
  }
  return "cancelled";
}

function actionSummary(action: ResolveEscalationRequest["action"], locale: WorkHubLocale) {
  if (locale === "en-US") {
    if (action === "retry") return "Cuu will retry this stuck task.";
    if (action === "pm_mode") return "This task is now in human mode.";
    return "This subtask has been cancelled.";
  }
  if (action === "retry") return "已让它重试这个卡住的任务。";
  if (action === "pm_mode") return "已转成你来处理。";
  return "已取消这个子任务。";
}

function workspaceMatches(row: EscalationServiceRow, actor: AuthActor) {
  return !row.workspaceId || row.workspaceId === actor.workspaceId;
}

function ensureWorkspace(row: EscalationServiceRow, actor: AuthActor) {
  if (!workspaceMatches(row, actor)) {
    throw new EscalationServiceError(403, "forbidden", "你没有权限处理这条升级。");
  }
}

function escalationActions(id: string, locale: WorkHubLocale): AttentionItem["actions"] {
  const zh = locale === "zh-CN";
  const href = `/api/escalations/${id}/resolve`;
  return [
    {
      id: "escalation_retry",
      label: zh ? "让它重试" : "Let it retry",
      style: "primary",
      method: "POST",
      href
    },
    {
      id: "escalation_pm_mode",
      label: zh ? "转成我来做" : "I'll take over",
      style: "secondary",
      method: "POST",
      href
    },
    {
      id: "escalation_cancel",
      label: zh ? "取消这个子任务" : "Cancel this subtask",
      style: "danger",
      method: "POST",
      href
    }
  ];
}

export function buildEscalationAttentionItem(row: EscalationServiceRow, locale: WorkHubLocale): AttentionItem {
  const zh = locale === "zh-CN";
  const title = zh ? `《${row.title}》卡住了` : `"${row.title}" needs a decision`;
  const reason = compactText(row.reasonMd);
  return {
    id: row.id,
    kind: "escalation",
    priority: "urgent",
    work_item_id: row.workItemId,
    project_id: row.projectId,
    source_ref: {
      entity_type: "escalation_event",
      entity_id: row.id
    },
    title,
    summary_text: reason,
    reason_text: reason,
    actions: escalationActions(row.id, locale),
    cuu_state: "worried",
    created_at: row.createdAt.toISOString()
  };
}

export function createEscalationService(deps: EscalationServiceDependencies = {}) {
  const repository = deps.repository ?? getDefaultEscalationRepository();
  const users = deps.users === false ? undefined : deps.users ?? getDefaultUsers();
  const workItems = deps.workItems === false ? undefined : deps.workItems ?? getDefaultWorkItemService();
  const now = deps.now ?? (() => new Date());

  return {
    async resolve(id: string, actor: AuthActor, input: ResolveEscalationRequest) {
      const payload = resolveEscalationRequestSchema.parse(input);
      const existing = await repository.findById(id);
      if (!existing) {
        throw new EscalationServiceError(404, "escalation_not_found", "没有找到这条升级。");
      }
      ensureWorkspace(existing, actor);
      const targetStatus = resolveTargetStatus(payload.action);
      let row: EscalationServiceRow | null;
      try {
        row = await repository.resolveEscalation({
          escalationId: id,
          targetStatus,
          at: now()
        });
      } catch (error) {
        if ((error as { message?: string }).message === "escalation_status_transition_conflict") {
          throw new EscalationServiceError(409, "escalation_status_conflict", "当前事项状态已经变化，请刷新后再处理。");
        }
        throw error;
      }
      if (!row) {
        throw new EscalationServiceError(409, "escalation_race", "这条升级已经被处理过了。");
      }
      return {
        escalation: {
          id: row.id,
          work_item_id: row.workItemId,
          resolved_at: row.resolvedAt?.toISOString()
        },
        work_item_status: row.workItemStatus,
        attention: {
          summary_text: actionSummary(payload.action, "zh-CN")
        }
      };
    },

    async delegate(id: string, actor: AuthActor, input: DelegateEscalationRequest) {
      const payload = delegateEscalationRequestSchema.parse(input);
      const existing = await repository.findById(id);
      if (!existing) {
        throw new EscalationServiceError(404, "escalation_not_found", "没有找到这条升级。");
      }
      ensureWorkspace(existing, actor);
      if (users) {
        const target = await users.findActiveById(payload.to_user_id);
        if (!target) {
          throw new EscalationServiceError(404, "delegate_target_not_found", "找不到要转派的成员。");
        }
      }
      const row = await repository.delegateEscalation({
        escalationId: id,
        toUserId: payload.to_user_id,
        at: now()
      });
      if (!row) {
        throw new EscalationServiceError(409, "escalation_race", "这条升级已经被处理过了。");
      }
      return {
        escalation: {
          id: row.id,
          work_item_id: row.workItemId,
          suggested_lead_user_id: row.suggestedLeadUserId
        },
        attention: {
          summary_text: "已转派升级。"
        }
      };
    },

    async listAttentionItems(input: { actor: AuthActor; locale: WorkHubLocale }) {
      const rows = (await repository.listUnresolvedForWorkspace({
        workspaceId: input.actor.workspaceId,
        limit: 50
      })).filter((row) => workspaceMatches(row, input.actor));
      if (rows.length === 0) {
        return [];
      }
      if (!workItems) {
        return rows.map((row) => buildEscalationAttentionItem(row, input.locale));
      }
      const readable = await workItems.canReadWorkItems({
        workItemIds: [...new Set(rows.map((row) => row.workItemId))],
        actor: input.actor
      });
      return rows
        .filter((row) => readable.has(row.workItemId))
        .map((row) => buildEscalationAttentionItem(row, input.locale));
    }
  };
}
