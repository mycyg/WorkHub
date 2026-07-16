// R15 批 E1c（项目时间线 / 甘特数据源）：GET /api/pages/project/:id/timeline 的 VM 装配。纯读、无写副作用。
// 访问按 canViewProjectDrive 收口（与项目主页/网盘同一道项目 fence）；逐工作项再按 canViewWorkItemRecord
// 过滤掉他人私有草稿（intake/ai_clarifying/spec_ready），不在时间线上泄漏私有态标题（与项目主页同口径）。
//
// 关键路径 MVP：对每个未完成项算「它直接 + 传递阻塞的未完成项数」（全图传递闭包，见 computeBlockingCounts）。
// blocks_count>0 且逾期的即「这件卡在你这里，后面 N 件在等」的数据源（overdue_blocking），是未来 ddl-chase
// escalate 文案带 blocks_count 的接缝（见 services/ddl-chase.ts 的注释与 listDependencyEdgesByProject 导出）。
import {
  computeBlockingCounts,
  createProjectTimelineRepository,
  createWorkItemRepository,
  getSharedDatabaseClient,
  type ProjectTimelineRepository,
  type TimelineWorkItemRow,
  type WorkItemDataRepository,
  type WorkHubDatabaseClient
} from "@workhub/db";
import {
  projectTimelinePageVmSchema,
  type ProjectTimelinePageVM,
  type TimelineWorkItemVM,
  type WorkHubLocale
} from "@workhub/contracts";
import { canViewProjectDrive, canViewWorkItemRecord } from "@workhub/permissions";

import type { AuthActor } from "../middleware/auth.js";
import { parseOutputContract } from "../pages/output-contract.js";

export class ProjectTimelinePageServiceError extends Error {
  constructor(
    public readonly status: 403 | 404,
    message: string,
    public readonly code = "project_timeline_error"
  ) {
    super(message);
    this.name = "ProjectTimelinePageServiceError";
  }
}

export type ProjectTimelinePageService = {
  page: (input: { actor: AuthActor; projectId: string; locale?: WorkHubLocale }) => Promise<ProjectTimelinePageVM>;
};

export type ProjectTimelinePageServiceDependencies = {
  repo: Pick<
    ProjectTimelineRepository,
    "listActiveMilestonesByProject" | "listTimelineWorkItems" | "listDependencyEdgesByProject" | "listObjectiveIdsByWorkItemIds"
  >;
  projectRepo: Pick<WorkItemDataRepository, "findProjectById">;
  now?: () => Date;
};

// critical.blocking 展示上限（阻塞数倒序取前 N）——防止超大图把 VM 撑爆；front-end 要全量另走分页。
const CRITICAL_LIMIT = 100;

function isOverdue(row: TimelineWorkItemRow, now: Date): boolean {
  const terminal = new Set(["merged", "done", "cancelled"]);
  return Boolean(row.dueAt && row.dueAt.getTime() < now.getTime() && !terminal.has(row.status));
}

export function createProjectTimelinePageService(
  deps: ProjectTimelinePageServiceDependencies
): ProjectTimelinePageService {
  const now = deps.now ?? (() => new Date());
  return {
    async page({ actor, projectId, locale }) {
      const project = await deps.projectRepo.findProjectById(projectId);
      if (!project) {
        throw new ProjectTimelinePageServiceError(404, "没有找到这个项目。", "project_not_found");
      }
      const canView = canViewProjectDrive(
        {
          archived: project.archived,
          deletedAt: project.deletedAt,
          ownerUserId: project.ownerUserId,
          orgId: project.orgId ?? null,
          workspaceId: project.workspaceId
        },
        {
          id: actor.id,
          ...(actor.userId ? { userId: actor.userId } : {}),
          isAdmin: actor.isAdmin,
          orgId: actor.orgId,
          workspaceId: actor.workspaceId
        }
      );
      if (!canView) {
        throw new ProjectTimelinePageServiceError(403, "你没有这个项目的访问权限。", "project_forbidden");
      }

      const viewerUserId = actor.userId ?? actor.id;
      const [milestones, allItems, edges] = await Promise.all([
        deps.repo.listActiveMilestonesByProject(projectId),
        deps.repo.listTimelineWorkItems(projectId),
        deps.repo.listDependencyEdgesByProject(projectId)
      ]);

      // 关键路径闭包用全图（所有项 + 边）算，计数才诚实——即便部分下游对当前用户不可见，「后面 N 件在等」
      // 仍是真实的（只是 id/标题不展示）。展示层再按可见性过滤 items 与 critical 列表。
      const blockingCounts = computeBlockingCounts(
        allItems.map((item) => ({ id: item.id, status: item.status })),
        edges
      );

      // 可见性过滤：canViewWorkItemRecord（认领人/提交人/协作者短路 + 私有态收口），与项目主页同口径。
      const visibleItems = allItems.filter((item) =>
        canViewWorkItemRecord(
          {
            id: item.id,
            status: item.status,
            submitterUserId: item.submitterUserId,
            claimedByUserId: item.claimedByUserId,
            workspaceId: item.workspaceId,
            assignments: item.assignments,
            project: {
              archived: project.archived,
              deletedAt: project.deletedAt,
              ownerUserId: project.ownerUserId,
              orgId: project.orgId ?? null,
              workspaceId: project.workspaceId
            }
          },
          { id: viewerUserId, isAdmin: actor.isAdmin },
          { workspaceId: actor.workspaceId }
        )
      );
      const visibleIds = new Set(visibleItems.map((item) => item.id));

      // 每项的 depends_on 只保留同样可见的依赖目标（避免暴露不可见项的存在；边残缺由前端按缺失节点降级）。
      const dependsOnByItem = new Map<string, string[]>();
      for (const edge of edges) {
        if (!visibleIds.has(edge.workItemId) || !visibleIds.has(edge.dependsOnWorkItemId)) {
          continue;
        }
        const bucket = dependsOnByItem.get(edge.workItemId) ?? [];
        bucket.push(edge.dependsOnWorkItemId);
        dependsOnByItem.set(edge.workItemId, bucket);
      }

      // E1d OKR 挂钩（最小、只读）：只对可见项、且项目有 workspace 时取链接。
      const objectiveWorkspaceId = project.workspaceId ?? actor.workspaceId ?? undefined;
      const objectiveIdsByItem = objectiveWorkspaceId && visibleItems.length > 0
        ? await deps.repo.listObjectiveIdsByWorkItemIds({
          workspaceId: objectiveWorkspaceId,
          workItemIds: visibleItems.map((item) => item.id)
        })
        : new Map<string, string[]>();

      const at = now();
      const items: TimelineWorkItemVM[] = visibleItems.map((item) => {
        const blocksCount = blockingCounts.get(item.id) ?? 0;
        const objectiveIds = objectiveIdsByItem.get(item.id);
        const vm: TimelineWorkItemVM = {
          id: item.id,
          code: item.code,
          title: item.title ?? item.code,
          status: item.status,
          depends_on: dependsOnByItem.get(item.id) ?? [],
          blocks_count: blocksCount,
          overdue: isOverdue(item, at)
        };
        if (item.startAt) vm.start_at = item.startAt.toISOString();
        if (item.dueAt) vm.due_at = item.dueAt.toISOString();
        if (item.claimedByUserId && item.claimedByNickname) {
          vm.assignee = { user_id: item.claimedByUserId, label: item.claimedByNickname };
        }
        if (item.milestoneId) vm.milestone_id = item.milestoneId;
        if (objectiveIds && objectiveIds.length > 0) vm.objective_ids = objectiveIds;
        return vm;
      });

      // critical：只列可见且阻塞≥1 的项，按阻塞数倒序（tie 按 code 稳定），封顶 CRITICAL_LIMIT。
      const blocking = items
        .filter((item) => item.blocks_count > 0)
        .sort((left, right) => right.blocks_count - left.blocks_count || left.code.localeCompare(right.code))
        .slice(0, CRITICAL_LIMIT)
        .map((item) => ({ work_item_id: item.id, blocks_count: item.blocks_count }));
      const overdueBlocking = items
        .filter((item) => item.blocks_count > 0 && item.overdue)
        .sort((left, right) => right.blocks_count - left.blocks_count || left.code.localeCompare(right.code))
        .slice(0, CRITICAL_LIMIT)
        .map((item) => ({ work_item_id: item.id, blocks_count: item.blocks_count }));

      const data: ProjectTimelinePageVM = {
        generated_at: at.toISOString(),
        project: { id: project.id, name: project.name, slug: project.slug },
        milestones: milestones.map((milestone) => ({
          id: milestone.id,
          project_id: milestone.projectId,
          title: milestone.title,
          due_at: milestone.dueAt ? milestone.dueAt.toISOString() : null,
          sort: milestone.sort,
          status: milestone.status
        })),
        items,
        critical: { blocking, overdue_blocking: overdueBlocking },
        ...(items.length === 0 ? { empty_state: "no_work_items" as const } : {})
      };
      return parseOutputContract(projectTimelinePageVmSchema, data, "project.timeline");
    }
  };
}

let defaultTimelinePageDbClient: WorkHubDatabaseClient | undefined;
let defaultProjectTimelinePageService: ProjectTimelinePageService | undefined;
export function getDefaultProjectTimelinePageService(): ProjectTimelinePageService {
  if (!defaultProjectTimelinePageService) {
    defaultTimelinePageDbClient = getSharedDatabaseClient();
    defaultProjectTimelinePageService = createProjectTimelinePageService({
      repo: createProjectTimelineRepository(defaultTimelinePageDbClient.db),
      projectRepo: createWorkItemRepository(defaultTimelinePageDbClient.db)
    });
  }
  return defaultProjectTimelinePageService;
}
