import type { NotificationSeverity, WorkItemStatus } from "@workhub/contracts";

export type LifecycleRecipientRole = "submitter" | "assignees" | "other_side" | "approver";

export type LifecycleMilestone = {
  status: WorkItemStatus;
  notificationType: string;
  severity: NotificationSeverity;
  recipients: LifecycleRecipientRole[];
  titleTemplate: string;
  bodyTemplate: string;
};

export type LifecycleUserRef = {
  id: string;
  deletedAt?: Date | null;
};

export type LifecycleActorRef = {
  id: string;
  label: string;
};

export type LifecycleWorkItemRef = {
  id: string;
  code: string;
  title?: string | null;
  projectId?: string | null;
  submitterUserId?: string | null;
  assigneeUserIds?: string[];
  leadUserId?: string | null;
  projectOwnerUserId?: string | null;
  approverUserId?: string | null;
};

export type MilestoneNotificationContext = {
  workItem: LifecycleWorkItemRef;
  actor: LifecycleActorRef;
  newStatus: WorkItemStatus;
  label?: string;
  reasonOneline?: string;
  usersById?: Record<string, LifecycleUserRef | undefined>;
};

export type NotificationDraft = {
  userId: string;
  type: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  targetUrl: string;
  projectId?: string;
  workItemId: string;
  dedupeKey: string;
};

export const lifecycleMilestones: Partial<Record<WorkItemStatus, LifecycleMilestone>> = {
  ai_working: {
    status: "ai_working",
    notificationType: "workitem.ai_working",
    severity: "normal",
    recipients: ["submitter"],
    titleTemplate: "{code} 已交给 AI 处理",
    bodyTemplate: "{actor} 正在处理「{title}」。"
  },
  escalated: {
    status: "escalated",
    notificationType: "workitem.escalated",
    severity: "high",
    recipients: ["submitter", "approver"],
    titleTemplate: "{code} 需要你来定一下",
    bodyTemplate: "这个活我先卡住了：{reason_oneline}。我建议这么推进，看一眼？"
  },
  pm_mode: {
    status: "pm_mode",
    notificationType: "workitem.pm_mode",
    severity: "high",
    recipients: ["approver"],
    titleTemplate: "{code} 我整理好了推进方案",
    bodyTemplate: "为什么卡 / 建议谁做 / 计划都列好了 —— 确认或调整"
  },
  in_review: {
    status: "in_review",
    notificationType: "workitem.in_review",
    severity: "high",
    recipients: ["approver"],
    titleTemplate: "{code} 成果待你确认采纳",
    bodyTemplate: "{actor} 把成果整理好了，进去确认采纳或打回"
  },
  merged: {
    status: "merged",
    notificationType: "workitem.merged",
    severity: "normal",
    recipients: ["submitter"],
    titleTemplate: "{code} 已采纳进正式版",
    bodyTemplate: "{actor} 采纳了成果，本次工作已汇入正式版。"
  },
  cancelled: {
    status: "cancelled",
    notificationType: "workitem.cancelled",
    severity: "normal",
    recipients: ["submitter", "assignees"],
    titleTemplate: "{code} 已取消",
    bodyTemplate: "{actor} 取消了「{title}」。"
  }
};

export function renderLifecycleTemplate(template: string, values: Record<string, string>) {
  let output = template;
  for (const [key, value] of Object.entries(values)) {
    output = output.split(`{${key}}`).join(value);
  }
  return output;
}

function userIsActive(context: MilestoneNotificationContext, userId: string) {
  const ref = context.usersById?.[userId];
  return ref?.deletedAt === undefined || ref.deletedAt === null;
}

export function resolveLifecycleRecipients(
  milestone: LifecycleMilestone,
  context: MilestoneNotificationContext
) {
  const recipients = new Set<string>();
  for (const role of milestone.recipients) {
    if (role === "submitter" && context.workItem.submitterUserId) {
      recipients.add(context.workItem.submitterUserId);
    }
    if (role === "assignees") {
      for (const userId of context.workItem.assigneeUserIds ?? []) {
        recipients.add(userId);
      }
    }
    if (role === "other_side") {
      for (const userId of [context.workItem.submitterUserId, ...(context.workItem.assigneeUserIds ?? [])]) {
        if (userId && userId !== context.actor.id) {
          recipients.add(userId);
        }
      }
    }
    if (role === "approver") {
      const approver =
        context.workItem.approverUserId ??
        context.workItem.leadUserId ??
        context.workItem.projectOwnerUserId ??
        context.workItem.submitterUserId;
      if (approver) {
        recipients.add(approver);
      }
    }
  }

  recipients.delete(context.actor.id);
  return [...recipients].filter((userId) => userIsActive(context, userId));
}

export function createLifecycleNotificationDrafts(context: MilestoneNotificationContext) {
  const milestone = lifecycleMilestones[context.newStatus];
  if (!milestone) {
    return [];
  }

  const values = {
    code: context.workItem.code,
    title: context.workItem.title ?? "未命名事项",
    label: context.label ?? context.newStatus,
    actor: context.actor.label,
    reason_oneline: context.reasonOneline ?? "需要你补一个决定"
  };
  const targetUrl = `/workitems/${context.workItem.id}`;
  const dedupeKey = `${context.newStatus}:${context.workItem.id}:${context.actor.id}`;

  return resolveLifecycleRecipients(milestone, context).map((userId): NotificationDraft => {
    const draft: NotificationDraft = {
      userId,
      type: milestone.notificationType,
      severity: milestone.severity,
      title: renderLifecycleTemplate(milestone.titleTemplate, values),
      body: renderLifecycleTemplate(milestone.bodyTemplate, values),
      targetUrl,
      workItemId: context.workItem.id,
      dedupeKey
    };
    if (context.workItem.projectId) {
      draft.projectId = context.workItem.projectId;
    }
    return draft;
  });
}
