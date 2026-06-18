import assert from "node:assert/strict";
import test from "node:test";

import {
  createLifecycleNotificationDrafts,
  lifecycleMilestones,
  renderLifecycleTemplate,
  resolveLifecycleRecipients
} from "./lifecycle.js";

const baseContext = {
  workItem: {
    id: "80000000-0000-4000-8000-000000000001",
    code: "WH-1",
    title: "预算申请",
    submitterUserId: "80000000-0000-4000-8000-000000000002",
    approverUserId: "80000000-0000-4000-8000-000000000003",
    assigneeUserIds: ["80000000-0000-4000-8000-000000000004"]
  },
  actor: {
    id: "ai-auto",
    label: "AI 工人"
  }
};

test("F09 P0 statuses are registered in the milestone table", () => {
  for (const status of ["escalated", "pm_mode", "in_review", "merged"] as const) {
    assert.equal(lifecycleMilestones[status]?.status, status);
  }
});

test("approver recipients prefer explicit approver and filter actor/deleted users", () => {
  const milestone = lifecycleMilestones.escalated;
  assert.ok(milestone);
  const recipients = resolveLifecycleRecipients(milestone, {
    ...baseContext,
    newStatus: "escalated",
    actor: { id: "80000000-0000-4000-8000-000000000002", label: "提交人" },
    usersById: {
      "80000000-0000-4000-8000-000000000003": {
        id: "80000000-0000-4000-8000-000000000003",
        deletedAt: null
      }
    }
  });

  assert.deepEqual(recipients, ["80000000-0000-4000-8000-000000000003"]);
});

test("R2 audit#5: deactivated recipients are dropped, active+unknown recipients kept", () => {
  // cancelled 里程碑收件人 = 提交人 + 受理人。提交人已停用→丢弃；受理人未知(不在 map)→fail-open 保留。
  const milestone = lifecycleMilestones.cancelled;
  assert.ok(milestone);
  const recipients = resolveLifecycleRecipients(milestone, {
    ...baseContext,
    workItem: {
      ...baseContext.workItem,
      submitterUserId: "80000000-0000-4000-8000-000000000002",
      assigneeUserIds: ["80000000-0000-4000-8000-000000000004"]
    },
    newStatus: "cancelled",
    usersById: {
      // 提交人已软删——必须被过滤掉。
      "80000000-0000-4000-8000-000000000002": {
        id: "80000000-0000-4000-8000-000000000002",
        deletedAt: new Date("2026-06-01T00:00:00.000Z")
      }
      // 受理人 ...004 不在 map：解析缺失视为活跃（fail-open），保留。
    }
  });

  assert.deepEqual(recipients, ["80000000-0000-4000-8000-000000000004"]);
});

test("approver recipients fall back to project owner without routing to the actor", () => {
  const milestone = lifecycleMilestones.escalated;
  assert.ok(milestone);
  const { approverUserId: _approverUserId, ...workItemWithoutApprover } = baseContext.workItem;
  const recipients = resolveLifecycleRecipients(milestone, {
    ...baseContext,
    workItem: {
      ...workItemWithoutApprover,
      submitterUserId: "80000000-0000-4000-8000-000000000002",
      projectOwnerUserId: "80000000-0000-4000-8000-000000000005"
    },
    newStatus: "escalated",
    actor: { id: "80000000-0000-4000-8000-000000000002", label: "提交人" }
  });

  assert.deepEqual(recipients, ["80000000-0000-4000-8000-000000000005"]);
});

test("template rendering uses safe replace semantics instead of format parsing", () => {
  const rendered = renderLifecycleTemplate("{code} {title} {actor}", {
    code: "WH-1",
    title: "{actor.__class__}",
    actor: "小云"
  });

  assert.equal(rendered, "WH-1 {actor.__class__} 小云");
});

test("lifecycle drafts carry human copy, target URL, and dedupe key", () => {
  const drafts = createLifecycleNotificationDrafts({
    ...baseContext,
    newStatus: "escalated",
    reasonOneline: "预算已经用完"
  });

  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.type, "workitem.escalated");
  assert.equal(drafts[0]?.severity, "high");
  assert.equal(drafts[0]?.body.includes("{reason_oneline}"), false);
  assert.equal(
    drafts[0]?.dedupeKey,
    "escalated:80000000-0000-4000-8000-000000000001:ai-auto"
  );
});
