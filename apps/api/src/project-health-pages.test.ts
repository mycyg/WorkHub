import assert from "node:assert/strict";
import test from "node:test";

import type {
  ProjectHealthRepository,
  ProjectHealthSourceRows,
  ScheduleNotifyProjectRow,
  ScheduleNotifyWorkItemRow
} from "@workhub/db";

import { createProjectHealthPageService } from "./services/project-health-pages.js";
import type { AuthActor } from "./middleware/auth.js";

const now = new Date("2026-06-11T10:00:00.000Z");
const userId = "85000000-0000-4000-8000-000000000001";
const workspaceId = "85000000-0000-4000-8000-000000000002";
const visibleProjectId = "85000000-0000-4000-8000-000000000003";
const hiddenProjectId = "85000000-0000-4000-8000-000000000004";
const orgId = "85000000-0000-4000-8000-000000000007";

function actor(partial: Partial<AuthActor> = {}): AuthActor {
  return {
    kind: "human",
    id: userId,
    userId,
    label: "alex",
    isAdmin: false,
    orgId,
    workspaceId,
    ...partial
  };
}

function project(partial: Partial<ScheduleNotifyProjectRow> = {}): ScheduleNotifyProjectRow {
  return {
    id: visibleProjectId,
    orgId,
    workspaceId,
    name: "西南区发布",
    slug: "southwest",
    description: null,
    ownerNickname: "alex",
    ownerUserId: userId,
    archived: false,
    deletedAt: null,
    deletedByNickname: null,
    nextSeq: 1,
    // R13 批 S3：projects 加了 is_personal 列——机械补齐，不是本文件测的功能改动。
    isPersonal: false,
    createdAt: now,
    updatedAt: now,
    ...partial
  };
}

function workItem(partial: Partial<ScheduleNotifyWorkItemRow> = {}): ScheduleNotifyWorkItemRow {
  return {
    id: "85000000-0000-4000-8000-000000000010",
    code: "WH-1",
    projectId: visibleProjectId,
    workspaceId,
    submitterUserId: userId,
    claimedByUserId: userId,
    claimedByNickname: "alex",
    title: "Review pricing",
    rawDescription: null,
    summaryMd: null,
    status: "in_review",
    priority: "normal",
    estimateHours: null,
    estimateConfidence: null,
    planningNote: null,
    startAt: null,
    dueAt: null,
    sourceMeetingId: null,
    sourceWorkItemId: null,
    claimedAt: null,
    doneAt: null,
    deliveredAt: null,
    deliveryDocReadyAt: null,
    acceptedAt: null,
    syncState: "pending",
    version: 0,
    mode: "worker",
    humanReserved: false,
    currentSpecId: null,
    mainBranchId: null,
    latestConfidenceId: null,
    deletedAt: null,
    deletedByUserId: null,
    createdAt: now,
    updatedAt: now,
    ...partial
  };
}

function sources(): ProjectHealthSourceRows {
  const visible = project();
  const hidden = project({
    id: hiddenProjectId,
    name: "别人的项目",
    ownerUserId: "85000000-0000-4000-8000-000000000099",
    workspaceId: "85000000-0000-4000-8000-000000000098"
  });
  return {
    projects: [visible, hidden],
    openWorkItems: [
      { workItem: workItem(), project: visible },
      {
        workItem: workItem({
          id: "85000000-0000-4000-8000-000000000011",
          code: "WH-2",
          dueAt: new Date("2026-06-10T00:00:00.000Z")
        }),
        project: visible
      },
      {
        workItem: workItem({
          id: "85000000-0000-4000-8000-000000000012",
          code: "WH-3",
          projectId: hiddenProjectId,
          submitterUserId: "85000000-0000-4000-8000-000000000099",
          claimedByUserId: null,
          workspaceId: "85000000-0000-4000-8000-000000000098"
        }),
        project: hidden
      }
    ],
    pendingApprovals: [{
      approval: {
        id: "85000000-0000-4000-8000-000000000020",
        workItemId: workItem().id,
        agentRunId: null,
        actionPattern: "proposal.merge",
        payloadJson: {},
        status: "pending",
        routedToUserId: userId,
        decidedByUserId: null,
        decisionReasonMd: null,
        delegatedToUserId: null,
        slaDueAt: null,
        createdAt: now,
        updatedAt: now
      },
      workItem: workItem(),
      project: visible
    }],
    failedRuns: [{
      run: {
        id: "85000000-0000-4000-8000-000000000030",
        workItemId: workItem().id,
        status: "failed",
        createdAt: now
      },
      workItem: workItem(),
      project: visible
    }],
    pendingInsights: []
  };
}

class MemoryProjectHealth implements ProjectHealthRepository {
  async readProjectHealthSources() {
    return sources();
  }
}

test("project health page bands signals per visible project and fails closed on hidden ones", async () => {
  const service = createProjectHealthPageService({
    projectHealth: new MemoryProjectHealth(),
    now: () => now
  });

  const page = await service.healthPage({ actor: actor(), locale: "zh-CN" });
  assert.equal(page.viewer_scope, "member");
  assert.equal(page.summary.project_count, 1);
  assert.equal(page.cards.length, 1);

  const card = page.cards[0]!;
  assert.equal(card.project_id, visibleProjectId);
  assert.equal(card.numbers_visible, false);
  // PROJ-3：「打开项目」进项目主页 hub(那里有工作项/负责人/动作并自带「打开网盘」),不再直跳网盘文件树。
  assert.equal(card.target_href, `/projects/${visibleProjectId}`);

  const byKey = new Map(card.signals.map((signal) => [signal.key, signal]));
  // L[5]：非管理员的原始 count 一律服务端归零（不泄露精确待审批/失败运行数），但定性 band 仍由真实
  // count 推导——所以 band 仍是 attention、卡片 band 仍是 attention，证明归零发生在 band 计算之后。
  assert.equal(byKey.get("open_work_items")?.count, 0);
  assert.equal(byKey.get("overdue_work_items")?.count, 0);
  assert.equal(byKey.get("overdue_work_items")?.band, "attention");
  assert.equal(byKey.get("pending_approvals")?.count, 0);
  assert.equal(byKey.get("failed_runs")?.count, 0);
  assert.equal(byKey.get("failed_runs")?.band, "attention");
  assert.equal(card.signals.every((signal) => signal.count === 0), true);
  assert.equal(card.band, "attention");
  assert.equal(card.signals.every((signal) => signal.target_href?.startsWith("/")), true);
  assert.equal(card.signals.some((signal) => signal.target_href?.startsWith("/api/")), false);
});

test("project health page gives admin the numeric view across projects", async () => {
  const service = createProjectHealthPageService({
    projectHealth: new MemoryProjectHealth(),
    now: () => now
  });

  const page = await service.healthPage({ actor: actor({ isAdmin: true }), locale: "en-US" });
  assert.equal(page.viewer_scope, "admin");
  assert.equal(page.summary.project_count, 2);
  assert.equal(page.cards.every((card) => card.numbers_visible), true);
  assert.equal(page.cards[0]?.band, "attention");
  // L[5]：管理员仍看到真实 count（归零只对非管理员生效）。
  assert.equal(page.cards.some((card) => card.signals.some((signal) => signal.count > 0)), true);
});

test("project health page does not expose another org's project to an admin", async () => {
  const service = createProjectHealthPageService({
    projectHealth: {
      async readProjectHealthSources() {
        const foreign = project({
          id: hiddenProjectId,
          name: "另一个组织的项目",
          orgId: "85000000-0000-4000-8000-0000000000ff",
          workspaceId: "85000000-0000-4000-8000-0000000000ee",
          ownerUserId: "85000000-0000-4000-8000-000000000099"
        });
        return {
          ...sources(),
          projects: [project(), foreign],
          openWorkItems: [],
          pendingApprovals: [],
          failedRuns: [],
          pendingInsights: []
        };
      }
    },
    now: () => now
  });

  const page = await service.healthPage({ actor: actor({ isAdmin: true }), locale: "zh-CN" });

  assert.equal(page.summary.project_count, 1);
  assert.deepEqual(page.cards.map((card) => card.project_id), [visibleProjectId]);
});

test("project health page includes assigned private open work in member risk bands", async () => {
  const assignedPrivateWorkItems = Array.from({ length: 6 }, (_, index) => ({
    workItem: workItem({
      id: `85000000-0000-4000-8000-0000000001${index}`,
      code: `WH-A${index}`,
      status: "spec_ready",
      submitterUserId: "85000000-0000-4000-8000-000000000099",
      claimedByUserId: null,
      claimedByNickname: null
    }),
    project: project(),
    assignments: [{ userId, role: "lead" }]
  }));
  const service = createProjectHealthPageService({
    projectHealth: {
      async readProjectHealthSources() {
        return {
          projects: [project()],
          openWorkItems: assignedPrivateWorkItems,
          pendingApprovals: [],
          failedRuns: [],
          pendingInsights: []
        };
      }
    },
    now: () => now
  });

  const page = await service.healthPage({ actor: actor(), locale: "zh-CN" });
  const card = page.cards[0]!;
  const openSignal = card.signals.find((signal) => signal.key === "open_work_items");

  assert.equal(card.project_id, visibleProjectId);
  assert.equal(card.numbers_visible, false);
  assert.equal(openSignal?.count, 0);
  assert.equal(openSignal?.band, "attention");
  assert.equal(card.band, "attention");
});

test("project health page requests actor-scoped sources before repository limits are applied", async () => {
  const visible = project({
    id: "85000000-0000-4000-8000-000000000055",
    name: "被晚近外部项目挤掉的项目"
  });
  const visibleWorkItem = workItem({
    id: "85000000-0000-4000-8000-000000000056",
    projectId: visible.id,
    code: "WH-SCOPED",
    status: "spec_ready",
    submitterUserId: "85000000-0000-4000-8000-000000000099",
    claimedByUserId: null
  });
  const service = createProjectHealthPageService({
    projectHealth: {
      async readProjectHealthSources(input) {
        if (!input.actor || input.actor.workspaceId !== workspaceId || input.actor.userId !== userId) {
          return {
            projects: [],
            openWorkItems: [],
            pendingApprovals: [],
            failedRuns: [],
            pendingInsights: []
          };
        }
        return {
          projects: [visible],
          openWorkItems: [{
            workItem: visibleWorkItem,
            project: visible,
            assignments: [{ userId, role: "lead" }]
          }],
          pendingApprovals: [],
          failedRuns: [],
          pendingInsights: []
        };
      }
    },
    now: () => now
  });

  const page = await service.healthPage({ actor: actor(), locale: "zh-CN" });

  assert.equal(page.summary.project_count, 1);
  assert.equal(page.cards[0]?.project_id, visible.id);
  assert.equal(page.cards[0]?.signals.some((signal) => signal.key === "open_work_items"), true);
});
