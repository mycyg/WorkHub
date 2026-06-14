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
  mode?: "worker" | "pm";
  title?: string;
  settings: Settings;
};

export type HumanReservedGuardResult = {
  workItemId: string;
  escalationId: string;
  trigger: "user_forbidden";
  source: "work_item";
  reasonMd: string;
  reused: boolean;
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

function buildHumanReservedReason(row: WorkItemHumanReservedRow, fallbackTitle?: string) {
  return `这个事项「${titleFor(row, fallbackTitle)}」已标记为人工处理。我不会让 AI 工人自动施工，已经把它转给人来接手。`;
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

function actorOrg(settings: Settings) {
  return {
    orgId: settings.auth.defaultOrgId,
    workspaceId: settings.auth.defaultWorkspaceId
  };
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

    const workItem = await workItems.findWorkItemForHumanReservedGuard(input.workItemId);
    if (!workItem?.humanReserved) {
      return null;
    }

    const reasonMd = buildHumanReservedReason(workItem, input.title);
    const existing = (await decisions.listEscalationEventsForWorkItem(input.workItemId)).find(
      (event) => event.trigger === "user_forbidden" && !event.resolvedAt
    );
    const escalation = existing ?? (await decisions.createEscalationEvent({
      workItemId: input.workItemId,
      trigger: "user_forbidden",
      reasonMd,
      handoffJson: humanReservedHandoff(workItem)
    }));

    await workItems.markHumanReservedPmMode({
      workItemId: input.workItemId,
      at: now()
    });

    if (!existing) {
      await auditLogs.createAuditLog({
        ...actorOrg(settings),
        actorKind: "system",
        actorNickname: "WorkHub",
        entityType: "work_item",
        entityId: input.workItemId,
        action: "escalation.opened",
        detailJson: {
          escalation_id: escalation.id,
          trigger: escalation.trigger,
          source: "human_reserved",
          requested_by_user_id: input.actorId,
          reason_preview: escalation.reasonMd.slice(0, 160)
        }
      });

      const eventPayload = {
        work_item_id: input.workItemId,
        escalation_id: escalation.id,
        trigger: escalation.trigger,
        reason_preview: escalation.reasonMd.slice(0, 160),
        source: "human_reserved",
        next_mode: "pm"
      };
      await bus?.publish(topics.workitem(input.workItemId).topic, eventTypes.escalationOpened, eventPayload);
      await bus?.publish(topics.all().topic, eventTypes.escalationOpened, eventPayload);
    }

    return {
      workItemId: input.workItemId,
      escalationId: escalation.id,
      trigger: "user_forbidden",
      source: "work_item",
      reasonMd: escalation.reasonMd,
      reused: Boolean(existing)
    };
  };
}
