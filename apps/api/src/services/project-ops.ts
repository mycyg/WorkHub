// R20 P2A（R19-19 项目归档/删除 · 纯后端）：POST /api/projects/:id/archive 与 /delete 的服务层。
// 归档/删除是破坏性的项目生命周期操作——门比「管项目内容」（canManageProjectDrive 放行任意同工作区成员）
// 更严：仅**管理员或项目所有者**（且同租户作用域内）。项目不存在/已归档/已软删（findProjectById 只回活跃项目）
// → 404；有身份但非管理员且非所有者 → 403。落地写走 ProjectRepository 的 archiveProject/softDeleteProject
// （CAS 只命中活跃/未删行）。复用 ProjectServiceError（app.onError 已映射其 status/code），不新起错误类型、
// 不碰 app.ts 的错误处理表。
import type { ArchiveProjectResult, DeleteProjectResult, ProjectVM } from "@workhub/contracts";
import {
  createProjectRepository,
  createWorkItemRepository,
  getSharedDatabaseClient,
  type ProjectRepository,
  type ProjectRow,
  type WorkItemDataRepository,
  type WorkItemProjectRow,
  type WorkHubDatabaseClient
} from "@workhub/db";

import type { AuthActor } from "../middleware/auth.js";
import { ProjectServiceError } from "./projects.js";

export type ProjectOpsService = {
  archiveProject: (input: { projectId: string; actor: AuthActor }) => Promise<ArchiveProjectResult>;
  deleteProject: (input: { projectId: string; actor: AuthActor }) => Promise<DeleteProjectResult>;
};

export type ProjectOpsServiceDependencies = {
  // findProjectById 只回「活跃」项目（archived=false 且未软删）——正是归档/删除前的可操作目标。
  projectLookup: Pick<WorkItemDataRepository, "findProjectById">;
  projects: Pick<ProjectRepository, "archiveProject" | "softDeleteProject">;
  now?: () => Date;
};

function toProjectVm(project: Pick<ProjectRow, "id" | "workspaceId" | "name" | "slug" | "description" | "ownerNickname" | "ownerUserId" | "isPersonal">): ProjectVM {
  return {
    id: project.id,
    workspace_id: project.workspaceId ?? null,
    name: project.name,
    slug: project.slug,
    ...(project.description ? { description: project.description } : {}),
    owner_nickname: project.ownerNickname,
    owner_user_id: project.ownerUserId ?? null,
    is_personal: project.isPersonal
  };
}

export function createProjectOpsService(deps: ProjectOpsServiceDependencies): ProjectOpsService {
  const now = deps.now ?? (() => new Date());

  // 仅管理员或项目所有者，且同租户作用域内（workspace/org 不跨界）。
  // R21 加固（NULL 旁路收口）：旧写法「任一侧为空则不设限」让 workspaceId 为 NULL 的孤儿项目对任意租户的
  // 管理员敞开——跨租户 admin 可归档/删除别家（或无主）的项目。收紧为：admin 特权只在「项目 workspaceId
  // 非空且与 actor 同租户」时生效，孤儿 NULL 行 admin 一律不得管理；owner 路径保留（ownerUserId===actor
  // 即可管理自己的 NULL workspace 项目——所有权本身就是最强归属证明），但仍受「两侧都非空且不等→false」
  // 的先决拒绝约束。
  function canManageLifecycle(project: WorkItemProjectRow, actor: AuthActor): boolean {
    // 先决拒绝：项目与 actor 的 workspace/org 两侧都非空且不等 → 明确跨租户，直接拒。
    if (project.workspaceId && actor.workspaceId && project.workspaceId !== actor.workspaceId) {
      return false;
    }
    if (project.orgId && actor.orgId && project.orgId !== actor.orgId) {
      return false;
    }
    if (actor.isAdmin) {
      // admin 特权要求「确证同租户」：两侧 workspaceId 都非空且相等。NULL 不算同租户——孤儿行谁的
      // admin 都不该拿它当自家资产处置。
      return Boolean(project.workspaceId && actor.workspaceId && project.workspaceId === actor.workspaceId);
    }
    const actorUserId = actor.userId ?? actor.id;
    return project.ownerUserId != null && project.ownerUserId === actorUserId;
  }

  async function requireManageableProject(projectId: string, actor: AuthActor): Promise<WorkItemProjectRow> {
    const project = await deps.projectLookup.findProjectById(projectId);
    if (!project) {
      throw new ProjectServiceError(404, "project_not_found", "没有找到这个项目。");
    }
    if (!canManageLifecycle(project, actor)) {
      throw new ProjectServiceError(403, "project_forbidden", "你没有权限管理这个项目。");
    }
    return project;
  }

  return {
    async archiveProject({ projectId, actor }) {
      await requireManageableProject(projectId, actor);
      const row = await deps.projects.archiveProject({ projectId, now: now() });
      if (!row) {
        // 权限门刚过、CAS 又落空——竞态窗口内被别的请求先归档/软删了，按 404 收口。
        throw new ProjectServiceError(404, "project_not_found", "没有找到这个项目。");
      }
      return { project: toProjectVm(row), archived: true };
    },

    async deleteProject({ projectId, actor }) {
      await requireManageableProject(projectId, actor);
      const row = await deps.projects.softDeleteProject({
        projectId,
        deletedByNickname: actor.label,
        now: now()
      });
      if (!row) {
        throw new ProjectServiceError(404, "project_not_found", "没有找到这个项目。");
      }
      return { project: toProjectVm(row), deleted: true };
    }
  };
}

let defaultDbClient: WorkHubDatabaseClient | undefined;
let defaultService: ProjectOpsService | undefined;

export function getDefaultProjectOpsService(): ProjectOpsService {
  if (!defaultService) {
    defaultDbClient = getSharedDatabaseClient();
    defaultService = createProjectOpsService({
      projectLookup: createWorkItemRepository(defaultDbClient.db),
      projects: createProjectRepository(defaultDbClient.db)
    });
  }
  return defaultService;
}
