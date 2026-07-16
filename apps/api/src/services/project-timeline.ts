// R15 批 E1b（项目时间线 / 甘特底座 · 写路径）：里程碑 CRUD + 工作项依赖增删 + 工作项挂里程碑。
// 权限分两档：
//   · 里程碑是项目级对象 → 用「能管理该项目资源」的项目级守卫（canManageProjectDrive，与网盘写同一道
//     项目 fence：活跃项目 + 本工作区成员/负责人，admin 同工作区）。「能改该项目工作项的人」的项目级投影。
//   · 依赖 / 挂里程碑是对具体工作项的治理写 → 复用 assertCanMutateWorkItem 同级守卫（逐工作项）。
// 纯写；不碰前端、ddl-chase 行为、conversation/loop。
import {
  createProjectTimelineRepository,
  createWorkItemRepository,
  getSharedDatabaseClient,
  TimelineDependencyError,
  TimelineMilestoneScopeError,
  type ProjectMilestoneRow,
  type ProjectTimelineRepository,
  type WorkItemDataRepository,
  type WorkHubDatabaseClient
} from "@workhub/db";
import type { ProjectMilestoneVM } from "@workhub/contracts";
import { canManageProjectDrive } from "@workhub/permissions";

import type { AuthActor } from "../middleware/auth.js";
import {
  getDefaultWorkItemService,
  type WorkItemService
} from "./work-items.js";

export class ProjectTimelineServiceError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 422,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ProjectTimelineServiceError";
  }
}

export type ProjectTimelineService = {
  createMilestone: (input: {
    projectId: string;
    actor: AuthActor;
    title: string;
    dueAt?: Date | null;
    sort?: number;
  }) => Promise<ProjectMilestoneVM>;
  updateMilestone: (input: {
    projectId: string;
    milestoneId: string;
    actor: AuthActor;
    title?: string;
    dueAt?: Date | null;
    sort?: number;
    status?: "open" | "done";
  }) => Promise<ProjectMilestoneVM>;
  deleteMilestone: (input: { projectId: string; milestoneId: string; actor: AuthActor }) => Promise<void>;
  addDependency: (input: {
    workItemId: string;
    dependsOnWorkItemId: string;
    actor: AuthActor;
  }) => Promise<{ work_item_id: string; depends_on: string; created: boolean }>;
  removeDependency: (input: {
    workItemId: string;
    dependsOnWorkItemId: string;
    actor: AuthActor;
  }) => Promise<{ work_item_id: string; depends_on: string; removed: boolean }>;
  attachMilestone: (input: {
    workItemId: string;
    milestoneId: string | null;
    actor: AuthActor;
  }) => Promise<{ work_item_id: string; milestone_id: string | null }>;
};

export type ProjectTimelineServiceDependencies = {
  repo: ProjectTimelineRepository;
  projectRepo: Pick<WorkItemDataRepository, "findProjectById">;
  workItems: Pick<WorkItemService, "assertCanMutateWorkItem">;
  now?: () => Date;
};

function milestoneVm(row: ProjectMilestoneRow): ProjectMilestoneVM {
  return {
    id: row.id,
    project_id: row.projectId,
    title: row.title,
    due_at: row.dueAt ? row.dueAt.toISOString() : null,
    sort: row.sort,
    status: row.status
  };
}

// 依赖治理错误 → 422 带明确错误码（环 / 跨项目 / 自依赖 / 端点不存在）。
function mapDependencyError(error: unknown): never {
  if (error instanceof TimelineDependencyError) {
    const status = error.code === "work_item_not_found" ? 404 : 422;
    throw new ProjectTimelineServiceError(status, `dependency_${error.code}`, error.message);
  }
  throw error;
}

export function createProjectTimelineService(deps: ProjectTimelineServiceDependencies): ProjectTimelineService {
  const now = deps.now ?? (() => new Date());

  // 里程碑写：项目级守卫。项目不存在/归档/已删 → 404（findProjectById 已过滤归档/删除）；无管理权 → 403。
  async function requireManageableProject(projectId: string, actor: AuthActor) {
    const project = await deps.projectRepo.findProjectById(projectId);
    if (!project) {
      throw new ProjectTimelineServiceError(404, "project_not_found", "没有找到这个项目。");
    }
    const allowed = canManageProjectDrive(
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
    if (!allowed) {
      throw new ProjectTimelineServiceError(403, "project_forbidden", "你没有权限管理这个项目的里程碑。");
    }
    return project;
  }

  return {
    async createMilestone({ projectId, actor, title, dueAt, sort }) {
      await requireManageableProject(projectId, actor);
      const row = await deps.repo.createMilestone({
        projectId,
        title,
        ...(dueAt !== undefined ? { dueAt } : {}),
        ...(sort !== undefined ? { sort } : {}),
        now: now()
      });
      return milestoneVm(row);
    },

    async updateMilestone({ projectId, milestoneId, actor, title, dueAt, sort, status }) {
      await requireManageableProject(projectId, actor);
      const row = await deps.repo.updateMilestone({
        projectId,
        milestoneId,
        ...(title !== undefined ? { title } : {}),
        ...(dueAt !== undefined ? { dueAt } : {}),
        ...(sort !== undefined ? { sort } : {}),
        ...(status !== undefined ? { status } : {}),
        now: now()
      });
      if (!row) {
        throw new ProjectTimelineServiceError(404, "milestone_not_found", "没有找到这个里程碑。");
      }
      return milestoneVm(row);
    },

    async deleteMilestone({ projectId, milestoneId, actor }) {
      await requireManageableProject(projectId, actor);
      const removed = await deps.repo.softDeleteMilestone({ projectId, milestoneId, now: now() });
      if (!removed) {
        throw new ProjectTimelineServiceError(404, "milestone_not_found", "没有找到这个里程碑。");
      }
    },

    async addDependency({ workItemId, dependsOnWorkItemId, actor }) {
      // 增依赖 = 对「依赖方」工作项的治理写：按工作项写权限收口（同 objective link 的铁律）。
      await deps.workItems.assertCanMutateWorkItem({ workItemId, actor });
      try {
        const { created } = await deps.repo.addDependency({
          workItemId,
          dependsOnWorkItemId,
          createdByUserId: actor.userId ?? actor.id,
          now: now()
        });
        return { work_item_id: workItemId, depends_on: dependsOnWorkItemId, created };
      } catch (error) {
        mapDependencyError(error);
      }
    },

    async removeDependency({ workItemId, dependsOnWorkItemId, actor }) {
      await deps.workItems.assertCanMutateWorkItem({ workItemId, actor });
      const removed = await deps.repo.removeDependency({ workItemId, dependsOnWorkItemId });
      return { work_item_id: workItemId, depends_on: dependsOnWorkItemId, removed };
    },

    async attachMilestone({ workItemId, milestoneId, actor }) {
      await deps.workItems.assertCanMutateWorkItem({ workItemId, actor });
      try {
        const updated = await deps.repo.attachWorkItemMilestone({ workItemId, milestoneId, now: now() });
        if (!updated) {
          throw new ProjectTimelineServiceError(404, "work_item_not_found", "没有找到这个工作项。");
        }
        return { work_item_id: workItemId, milestone_id: milestoneId };
      } catch (error) {
        if (error instanceof TimelineMilestoneScopeError) {
          throw new ProjectTimelineServiceError(
            422,
            "milestone_scope_mismatch",
            "里程碑必须与工作项属于同一个项目。"
          );
        }
        throw error;
      }
    }
  };
}

let defaultTimelineDbClient: WorkHubDatabaseClient | undefined;
let defaultProjectTimelineService: ProjectTimelineService | undefined;
export function getDefaultProjectTimelineService(): ProjectTimelineService {
  if (!defaultProjectTimelineService) {
    defaultTimelineDbClient = getSharedDatabaseClient();
    defaultProjectTimelineService = createProjectTimelineService({
      repo: createProjectTimelineRepository(defaultTimelineDbClient.db),
      projectRepo: createWorkItemRepository(defaultTimelineDbClient.db),
      workItems: getDefaultWorkItemService()
    });
  }
  return defaultProjectTimelineService;
}
