import { settings as runtimeSettings, type Settings } from "@workhub/config";
import { eventTypes } from "@workhub/contracts";
import {
  createAiDecisionRepository,
  createAuditLogRepository,
  getSharedDatabaseClient,
  createWorkItemRepository,
  type AiDecisionRepository,
  type AuditLogRepository,
  type WorkHubDatabaseClient,
  type WorkItemHumanReservedRow,
  type WorkItemRepository
} from "@workhub/db";
import { topics } from "@workhub/events";

import { getDefaultPushBus } from "../broker/index.js";
import type { PushBus } from "../broker/types.js";

export type HumanReservedGuardInput = {
  workItemId: string;
  actorId: string;
  agentRunId?: string;
  mode?: "worker" | "pm";
  title?: string;
  settings: Settings;
  toolCall?: HumanReservedToolCall;
};

export type HumanReservedToolRiskCategory = "legal" | "finance" | "identity" | "publish";

export type HumanReservedToolCall = {
  toolId: string;
  input: unknown;
  riskCategory?: HumanReservedToolRiskCategory;
};

export type HumanReservedGuardResult = {
  workItemId: string;
  escalationId: string;
  trigger: "user_forbidden";
  source: "work_item" | "tool_call";
  reasonMd: string;
  reused: boolean;
  riskCategory?: HumanReservedToolRiskCategory;
  toolId?: string;
};

export type HumanReservedGuard = (input: HumanReservedGuardInput) => Promise<HumanReservedGuardResult | null>;

export type HumanReservedGuardOptions = {
  workItems?: WorkItemRepository;
  decisions?: AiDecisionRepository;
  auditLogs?: AuditLogRepository;
  bus?: Pick<PushBus, "publish">;
  settings?: Settings;
  now?: () => Date;
};

let defaultDbClient: WorkHubDatabaseClient | undefined;

function defaultStores() {
  defaultDbClient ??= getSharedDatabaseClient();
  return {
    workItems: createWorkItemRepository(defaultDbClient.db),
    decisions: createAiDecisionRepository(defaultDbClient.db),
    auditLogs: createAuditLogRepository(defaultDbClient.db),
    bus: getDefaultPushBus()
  };
}

function titleFor(row: WorkItemHumanReservedRow, fallbackTitle?: string) {
  return row.title ?? fallbackTitle ?? row.code;
}

const highRiskToolTokens: Record<HumanReservedToolRiskCategory, readonly string[]> = {
  legal: ["legal", "contract", "contracts", "terms", "tos", "signature", "sign"],
  finance: ["finance", "financial", "payment", "payments", "payout", "bank", "banking", "card", "wire", "payroll", "invoice"],
  identity: ["identity", "identities", "kyc", "passport", "idv", "credential", "credentials"],
  publish: ["publish", "publishing", "published"]
};

const identityRegistrationActionTokens = ["create", "register", "registration", "signup", "open"] as const;
const identityRegistrationSubjectTokens = ["account", "accounts", "entity", "entities", "company", "companies"] as const;
const externalPublishActionTokens = ["post", "posting", "share", "send"] as const;
const externalPublishChannelTokens = ["external", "public", "social", "media", "website", "blog", "twitter", "linkedin", "wechat"] as const;

function toolIdTokens(toolId: string) {
  return toolId
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);
}

function hasAnyToken(tokens: ReadonlySet<string>, candidates: readonly string[]) {
  return candidates.some((token) => tokens.has(token));
}

function hasIdentityRegistrationIntent(tokens: ReadonlySet<string>) {
  return hasAnyToken(tokens, identityRegistrationActionTokens) && hasAnyToken(tokens, identityRegistrationSubjectTokens);
}

function hasExternalPublishingIntent(tokens: ReadonlySet<string>) {
  return hasAnyToken(tokens, externalPublishActionTokens) && hasAnyToken(tokens, externalPublishChannelTokens);
}

export function classifyHumanReservedToolCall(input: Pick<HumanReservedToolCall, "toolId">): HumanReservedToolRiskCategory | null {
  const tokens = new Set(toolIdTokens(input.toolId));
  for (const category of ["legal", "finance", "identity", "publish"] as const) {
    if (highRiskToolTokens[category].some((token) => tokens.has(token))) {
      return category;
    }
  }
  if (hasIdentityRegistrationIntent(tokens)) {
    return "identity";
  }
  if (hasExternalPublishingIntent(tokens)) {
    return "publish";
  }
  return null;
}

function buildHumanReservedReason(row: WorkItemHumanReservedRow, fallbackTitle?: string) {
  return `这个事项「${titleFor(row, fallbackTitle)}」已标记为人工处理。我不会让 AI 工人自动施工，已经把它转给人来接手。`;
}

const toolRiskLabels: Record<HumanReservedToolRiskCategory, string> = {
  legal: "法务",
  finance: "财务",
  identity: "身份",
  publish: "对外发布"
};

function toolInputShape(input: unknown) {
  if (Array.isArray(input)) {
    return { kind: "array", length: input.length };
  }
  if (input && typeof input === "object") {
    const keys = Object.keys(input as Record<string, unknown>);
    return { kind: "object", keys: keys.slice(0, 12), key_count: keys.length };
  }
  return { kind: typeof input };
}

function buildHighRiskToolReason(row: WorkItemHumanReservedRow, toolCall: HumanReservedToolCall, category: HumanReservedToolRiskCategory, fallbackTitle?: string) {
  const label = toolRiskLabels[category];
  return `这个事项「${titleFor(row, fallbackTitle)}」请求执行${label}类高风险动作。我已经停止自动工具调用，并转给人确认。`;
}

function humanReservedHandoff(row: WorkItemHumanReservedRow) {
  return {
    done: ["已识别该事项被标记为人工处理。"],
    todo: ["请负责人确认接手人和下一步计划。"],
    blockers: ["用户明确不让 AI 工人自动施工。"],
    artifacts: [],
    source: "work_item",
    work_item: {
      id: row.id,
      code: row.code,
      previous_status: row.status
    }
  };
}

function highRiskToolHandoff(row: WorkItemHumanReservedRow, toolCall: HumanReservedToolCall, category: HumanReservedToolRiskCategory, agentRunId?: string) {
  return {
    done: [`已拦截${toolRiskLabels[category]}类高风险工具调用。`],
    todo: ["请负责人确认是否允许该动作，并由人执行或改写任务边界。"],
    blockers: ["法务、财务、身份、对外发布类高风险动作不能由 AI 工人自动执行。"],
    artifacts: [],
    source: "tool_call",
    risk_category: category,
    tool_id: toolCall.toolId,
    input_shape: toolInputShape(toolCall.input),
    ...(agentRunId ? { agent_run_id: agentRunId } : {}),
    work_item: {
      id: row.id,
      code: row.code,
      previous_status: row.status
    }
  };
}

function auditTenantForWorkItem(settings: Settings, row: WorkItemHumanReservedRow) {
  return {
    orgId: settings.auth.defaultOrgId,
    workspaceId: row.workspaceId ?? settings.auth.defaultWorkspaceId
  };
}

async function publishEscalationEvent(
  bus: Pick<PushBus, "publish"> | undefined,
  topic: string,
  payload: Record<string, unknown>
) {
  if (!bus) {
    return;
  }
  try {
    await bus.publish(topic, eventTypes.escalationOpened, payload);
  } catch (error) {
    console.warn("human_reserved_escalation_publish_failed", { topic, error });
  }
}

export function createHumanReservedGuard(options: HumanReservedGuardOptions = {}): HumanReservedGuard {
  const settings = options.settings ?? runtimeSettings;
  const stores = options.workItems && options.decisions && options.auditLogs
    ? options
    : defaultStores();
  const workItems = stores.workItems;
  const decisions = stores.decisions;
  const auditLogs = stores.auditLogs;
  const bus = options.bus ?? stores.bus;
  const now = options.now ?? (() => new Date());

  if (!workItems || !decisions || !auditLogs) {
    throw new Error("Human reserved guard requires work item, decision, and audit stores");
  }

  return async (input) => {
    if ((input.mode ?? "worker") !== "worker") {
      return null;
    }

    const toolRiskCategory = input.toolCall
      ? input.toolCall.riskCategory ?? classifyHumanReservedToolCall(input.toolCall)
      : null;
    const workItem = await workItems.findWorkItemForHumanReservedGuard(input.workItemId);
    if (!workItem || (!workItem.humanReserved && !toolRiskCategory)) {
      return null;
    }

    const source = toolRiskCategory && input.toolCall ? "tool_call" : "work_item";
    const reasonMd = source === "tool_call" && input.toolCall && toolRiskCategory
      ? buildHighRiskToolReason(workItem, input.toolCall, toolRiskCategory, input.title)
      : buildHumanReservedReason(workItem, input.title);
    const existing = (await decisions.listEscalationEventsForWorkItem(input.workItemId)).find(
      (event) => event.trigger === "user_forbidden" && !event.resolvedAt
    );
    const escalation = existing ?? (await decisions.createEscalationEvent({
      workItemId: input.workItemId,
      ...(input.agentRunId ? { agentRunId: input.agentRunId } : {}),
      trigger: "user_forbidden",
      reasonMd,
      handoffJson: source === "tool_call" && input.toolCall && toolRiskCategory
        ? highRiskToolHandoff(workItem, input.toolCall, toolRiskCategory, input.agentRunId)
        : humanReservedHandoff(workItem)
    }));

    if (!existing) {
      if (workItem.humanReserved) {
        // #18：状态写入只在首次预留时发生。已有未结升级时再次触发不得重写状态——否则版本号空转
        // (version++ / updatedAt churn) 且无任何审计轨迹（静默写），还可能把后续状态硬拉回 pm_mode。
        await workItems.markHumanReservedPmMode({
          workItemId: input.workItemId,
          at: now()
        });
      }

      try {
        await auditLogs.createAuditLog({
          ...auditTenantForWorkItem(settings, workItem),
          actorKind: "system",
          actorNickname: "WorkHub",
          entityType: "work_item",
          entityId: input.workItemId,
          action: "escalation.opened",
          detailJson: {
            escalation_id: escalation.id,
            trigger: escalation.trigger,
            source: source === "tool_call" ? "human_reserved_tool_call" : "human_reserved",
            requested_by_user_id: input.actorId,
            reason_preview: escalation.reasonMd.slice(0, 160),
            ...(source === "tool_call" && input.toolCall && toolRiskCategory
              ? { tool_id: input.toolCall.toolId, risk_category: toolRiskCategory }
              : {})
          }
        });
      } catch (error) {
        console.warn("human_reserved_escalation_audit_failed", { workItemId: input.workItemId, error });
      }

      const eventPayload = {
        work_item_id: input.workItemId,
        escalation_id: escalation.id,
        trigger: escalation.trigger,
        reason_preview: escalation.reasonMd.slice(0, 160),
        source: source === "tool_call" ? "human_reserved_tool_call" : "human_reserved",
        next_mode: "pm"
      };
      await publishEscalationEvent(bus, topics.workitem(input.workItemId).topic, eventPayload);
      // AUTHZ-1：全局事件发到工作项**真实**工作区的话题，与订阅侧 `all:<workspaceId>` 对齐——
      // 否则一旦出现第二工作区，B 的升级会漏发给 B 的 admin、却错发给 default 工作区的 admin(跨租户泄露)。
      // 单租户下 workspaceId == default，行为等价。
      await publishEscalationEvent(
        bus,
        topics.all(workItem.workspaceId ?? settings.auth.defaultWorkspaceId).topic,
        eventPayload
      );
    }

    return {
      workItemId: input.workItemId,
      escalationId: escalation.id,
      trigger: "user_forbidden",
      source,
      reasonMd: escalation.reasonMd,
      reused: Boolean(existing),
      ...(toolRiskCategory ? { riskCategory: toolRiskCategory } : {}),
      ...(input.toolCall ? { toolId: input.toolCall.toolId } : {})
    };
  };
}
