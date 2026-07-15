// R15 批 E3 测试夹具（非 *.test.ts，不被测试运行器自动收集，只供 project-planner*.test.ts 复用）。
// 提供内存版 ProjectPlannerRepository（忠实实现 CAS 语义，让 service 的幂等/环兜底/物化逻辑被真正走到）、
// 一个可管理的假项目、假时间线仓库、假 actor。参照 packages/db 的 test-query-recorder 惯例（source 侧 helper）。
import type { WorkItemStatus } from "@workhub/contracts";
import type {
  MaterializeOutcome,
  MaterializeProjectPlanDraftInput,
  MaterializeResult,
  ProjectMilestoneRow,
  ProjectPlanDraftRow,
  ProjectPlannerRepository,
  TimelineWorkItemRow
} from "@workhub/db";

import type { AuthActor } from "./middleware/auth.js";

export const projectId = "11111111-0000-4000-8000-000000000001";
export const workspaceId = "11111111-0000-4000-8000-000000000002";
export const userId = "11111111-0000-4000-8000-000000000003";

export function makeActor(overrides: Partial<AuthActor> = {}): AuthActor {
  return {
    id: userId,
    userId,
    workspaceId,
    label: "PM",
    ...overrides
  } as AuthActor;
}

// canManageProjectDrive 只读 archived/deletedAt/ownerUserId/orgId/workspaceId；其余列给足以过类型（cast）。
export function fakeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: projectId,
    workspaceId,
    name: "Launch WorkHub",
    slug: "launch",
    description: null,
    ownerNickname: "pm",
    ownerUserId: "11111111-0000-4000-8000-0000000000ff",
    orgId: null,
    archived: false,
    deletedAt: null,
    deletedByNickname: null,
    nextSeq: 0,
    isPersonal: false,
    isDmContainer: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  } as never;
}

export function fakeTimelineRepo(data: {
  milestones?: ProjectMilestoneRow[];
  items?: Array<{ id: string; code: string; title?: string | null; status: WorkItemStatus }>;
} = {}) {
  return {
    async listActiveMilestonesByProject() {
      return data.milestones ?? [];
    },
    async listTimelineWorkItems() {
      return (data.items ?? []).map((item) => ({
        id: item.id,
        code: item.code,
        title: item.title ?? null,
        status: item.status,
        startAt: null,
        dueAt: null,
        submitterUserId: userId,
        claimedByUserId: null,
        claimedByNickname: null,
        workspaceId,
        milestoneId: null,
        assignments: []
      })) as TimelineWorkItemRow[];
    }
  };
}

function resultFromJson(json: Record<string, unknown> | null): MaterializeResult {
  const value = json ?? {};
  return {
    milestoneIds: Array.isArray(value.milestone_ids) ? (value.milestone_ids as unknown[]).filter((id): id is string => typeof id === "string") : [],
    workItemIds: Array.isArray(value.work_item_ids) ? (value.work_item_ids as unknown[]).filter((id): id is string => typeof id === "string") : [],
    dependencyCount: typeof value.dependency_count === "number" ? value.dependency_count : 0
  };
}

export function createFakeProjectPlannerRepository(): {
  repo: ProjectPlannerRepository;
  store: Map<string, ProjectPlanDraftRow>;
  materializeCalls: MaterializeProjectPlanDraftInput[];
} {
  const store = new Map<string, ProjectPlanDraftRow>();
  const materializeCalls: MaterializeProjectPlanDraftInput[] = [];
  const repo: ProjectPlannerRepository = {
    async createDraft(input) {
      const now = input.now ?? new Date();
      const row: ProjectPlanDraftRow = {
        id: input.id,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        status: input.status ?? "pending_review",
        intentMd: input.intentMd,
        payloadJson: input.payloadJson,
        rationaleMd: input.rationaleMd ?? null,
        reviewReasonMd: null,
        decompositionContextJson: input.decompositionContextJson ?? {},
        resultJson: null,
        createdByUserId: input.createdByUserId,
        reviewedByUserId: null,
        createdAt: now,
        updatedAt: now,
        reviewedAt: null,
        materializedAt: null
      };
      store.set(row.id, row);
      return row;
    },
    async getDraftById({ draftId, workspaceId: ws }) {
      const row = store.get(draftId);
      if (!row) {
        return null;
      }
      if (ws && row.workspaceId !== ws) {
        return null;
      }
      return row;
    },
    async listDraftsByProject({ projectId: pid, workspaceId: ws }) {
      return [...store.values()]
        .filter((row) => row.projectId === pid && row.workspaceId === ws)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    async approveDraft({ draftId, workspaceId: ws, reviewedByUserId, now }) {
      const row = store.get(draftId);
      if (!row || row.workspaceId !== ws || row.status !== "pending_review") {
        return null;
      }
      const at = now ?? new Date();
      const updated: ProjectPlanDraftRow = { ...row, status: "approved", reviewedByUserId, reviewedAt: at, updatedAt: at };
      store.set(draftId, updated);
      return updated;
    },
    async rejectDraft({ draftId, workspaceId: ws, reviewedByUserId, reasonMd, expectedStatus, now }) {
      const row = store.get(draftId);
      const from = expectedStatus ?? "pending_review";
      if (!row || row.workspaceId !== ws || row.status !== from) {
        return null;
      }
      const at = now ?? new Date();
      const updated: ProjectPlanDraftRow = { ...row, status: "rejected", reviewReasonMd: reasonMd, reviewedByUserId, reviewedAt: at, updatedAt: at };
      store.set(draftId, updated);
      return updated;
    },
    async materialize(input) {
      materializeCalls.push(input);
      const row = store.get(input.draftId);
      if (!row || row.workspaceId !== input.workspaceId) {
        return { outcome: "not_found" } satisfies MaterializeOutcome;
      }
      if (row.status === "materialized") {
        return { outcome: "already_materialized", result: resultFromJson(row.resultJson as Record<string, unknown> | null), draft: row } satisfies MaterializeOutcome;
      }
      if (row.status !== "approved") {
        return { outcome: "not_approved", draft: row } satisfies MaterializeOutcome;
      }
      const result: MaterializeResult = {
        milestoneIds: input.milestones.map((milestone) => milestone.id),
        workItemIds: input.workItems.map((item) => item.id),
        dependencyCount: input.dependencies.length
      };
      const at = input.now ?? new Date();
      const updated: ProjectPlanDraftRow = {
        ...row,
        status: "materialized",
        resultJson: { milestone_ids: result.milestoneIds, work_item_ids: result.workItemIds, dependency_count: result.dependencyCount },
        materializedAt: at,
        updatedAt: at
      };
      store.set(input.draftId, updated);
      return { outcome: "materialized", result, draft: updated } satisfies MaterializeOutcome;
    }
  };
  return { repo, store, materializeCalls };
}
