// R16 批 W4a（项目级自定义指令 · 纯后端）：项目设置里的一段自由文本，读/写两个端点的服务层。
// 权限门与 E1 里程碑写同一道项目级守卫（canManageProjectDrive，见 project-timeline.ts 的
// requireManageableProject 先例）——都是「能管这个项目的人」：项目不存在/归档/已删 → 404；无管理权 → 403。
// 长度上限 + 去首尾空白已经在契约层（patchProjectInstructionsRequestSchema 的 .trim().max()）做完，
// 这里不重复校验；服务层只负责权限门 + 落库 + 视图组装。
import { canManageProjectDrive } from "@workhub/permissions";
import type { PatchProjectInstructionsRequest, ProjectInstructionsVM } from "@workhub/contracts";
import {
  createProjectRepository,
  createWorkItemRepository,
  getSharedDatabaseClient,
  type ProjectRepository,
  type WorkItemDataRepository,
  type WorkItemProjectRow,
  type WorkHubDatabaseClient
} from "@workhub/db";

import type { AuthActor } from "../middleware/auth.js";

export class ProjectInstructionsServiceError extends Error {
  constructor(
    public readonly status: 403 | 404,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ProjectInstructionsServiceError";
  }
}

export type ProjectInstructionsService = {
  getInstructions: (input: { projectId: string; actor: AuthActor }) => Promise<ProjectInstructionsVM>;
  patchInstructions: (input: {
    projectId: string;
    actor: AuthActor;
    payload: PatchProjectInstructionsRequest;
  }) => Promise<ProjectInstructionsVM>;
};

export type ProjectInstructionsServiceDependencies = {
  projectRepo: Pick<WorkItemDataRepository, "findProjectById">;
  instructionsRepo: Pick<ProjectRepository, "updateInstructions">;
  now?: () => Date;
};

function instructionsVm(project: Pick<WorkItemProjectRow, "id" | "instructionsMd" | "updatedAt">): ProjectInstructionsVM {
  return {
    project_id: project.id,
    instructions_md: project.instructionsMd ?? "",
    updated_at: project.updatedAt.toISOString()
  };
}

export function createProjectInstructionsService(deps: ProjectInstructionsServiceDependencies): ProjectInstructionsService {
  const now = deps.now ?? (() => new Date());

  // 项目级守卫：与 project-timeline.ts / project-planner.ts 的 requireManageableProject 同一道
  // fence（canManageProjectDrive）——项目不存在/归档/已删 → 404；无管理权 → 403。
  async function requireManageableProject(projectId: string, actor: AuthActor) {
    const project = await deps.projectRepo.findProjectById(projectId);
    if (!project) {
      throw new ProjectInstructionsServiceError(404, "project_not_found", "没有找到这个项目。");
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
      throw new ProjectInstructionsServiceError(403, "project_forbidden", "你没有权限管理这个项目的自定义指令。");
    }
    return project;
  }

  return {
    async getInstructions({ projectId, actor }) {
      const project = await requireManageableProject(projectId, actor);
      return instructionsVm(project);
    },

    async patchInstructions({ projectId, actor, payload }) {
      await requireManageableProject(projectId, actor);
      const trimmed = payload.instructions_md;
      const row = await deps.instructionsRepo.updateInstructions({
        projectId,
        instructionsMd: trimmed.length > 0 ? trimmed : null,
        now: now()
      });
      if (!row) {
        // 权限门刚过、写路径又落空——竞态窗口内被归档/软删,按其它服务同款处理成 404。
        throw new ProjectInstructionsServiceError(404, "project_not_found", "没有找到这个项目。");
      }
      return instructionsVm(row);
    }
  };
}

let defaultDbClient: WorkHubDatabaseClient | undefined;
let defaultService: ProjectInstructionsService | undefined;

export function getDefaultProjectInstructionsService(): ProjectInstructionsService {
  if (!defaultService) {
    defaultDbClient = getSharedDatabaseClient();
    defaultService = createProjectInstructionsService({
      projectRepo: createWorkItemRepository(defaultDbClient.db),
      instructionsRepo: createProjectRepository(defaultDbClient.db)
    });
  }
  return defaultService;
}
