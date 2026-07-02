import { createHash } from "node:crypto";

import {
  ProjectSlugOccupiedError,
  getSharedDatabaseClient,
  createProjectRepository,
  type ProjectRepository,
  type WorkHubDatabaseClient
} from "@workhub/db";
import { projectListVmSchema } from "@workhub/contracts";
import type {
  BootstrapProjectRequest,
  BootstrapProjectResult,
  ProjectListItemVM,
  ProjectListVM,
  ProjectVM
} from "@workhub/contracts";
import { settings as defaultSettings, type Settings } from "@workhub/config";

import type { AuthActor } from "../middleware/auth.js";
import { parseOutputContract } from "../pages/output-contract.js";

export class ProjectServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export type ProjectService = {
  bootstrapProject: (input: {
    payload: BootstrapProjectRequest;
    actor: AuthActor;
  }) => Promise<BootstrapProjectResult>;
  listProjects: (input: { actor: AuthActor }) => Promise<ProjectListVM>;
};

export type ProjectServiceOptions = {
  settings?: Settings;
  now?: () => Date;
};

let defaultDbClient: WorkHubDatabaseClient | undefined;
let defaultProjectService: ProjectService | undefined;

function slugFromName(name: string) {
  const ascii = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);
  // H1：纯非 ASCII 名（如纯中文）会被清成空串。旧代码统一落回固定 "pilot-project" slug，
  // 会把不同中文项目挤进同一个项目；随机 fallback 又会让同名重试失去幂等性。
  // 用名称 hash：不同中文名分开，同一中文名重试仍命中同一 slug。
  return ascii || `project-${createHash("sha256").update(name.trim(), "utf8").digest("hex").slice(0, 8)}`;
}

function toProjectVm(project: Awaited<ReturnType<ProjectRepository["bootstrapPilotProject"]>>["project"]): ProjectVM {
  return {
    id: project.id,
    workspace_id: project.workspaceId ?? null,
    name: project.name,
    slug: project.slug,
    ...(project.description ? { description: project.description } : {}),
    owner_nickname: project.ownerNickname,
    owner_user_id: project.ownerUserId ?? null
  };
}

function toProjectListItemVm(
  row: Awaited<ReturnType<ProjectRepository["listForWorkspace"]>>[number]
): ProjectListItemVM {
  return {
    id: row.id,
    workspace_id: row.workspaceId ?? null,
    name: row.name,
    slug: row.slug,
    ...(row.description ? { description: row.description } : {}),
    owner_nickname: row.ownerNickname,
    owner_user_id: row.ownerUserId ?? null,
    archived: row.archived,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    open_work_item_count: row.openWorkItemCount
  };
}

export function createProjectService(
  repository: ProjectRepository,
  options: ProjectServiceOptions = {}
): ProjectService {
  const runtimeSettings = options.settings ?? defaultSettings;
  const now = options.now ?? (() => new Date());

  function isProjectSlugOccupied(error: unknown) {
    return error instanceof ProjectSlugOccupiedError
      || (error instanceof Error && error.message.includes("slug occupied by an archived/deleted row"));
  }

  return {
    async bootstrapProject(input) {
      if (!input.actor.userId) {
        throw new ProjectServiceError(403, "human_required", "需要真人用户才能创建 pilot 项目。");
      }
      const name = input.payload.name?.trim() || "Day 0 Pilot Project";
      const slug = input.payload.slug?.trim() || slugFromName(name);
      let result: Awaited<ReturnType<ProjectRepository["bootstrapPilotProject"]>>;
      try {
        result = await repository.bootstrapPilotProject({
          orgId: input.actor.orgId || runtimeSettings.auth.defaultOrgId,
          workspaceId: input.actor.workspaceId || runtimeSettings.auth.defaultWorkspaceId,
          name,
          slug,
          description: input.payload.description ?? "Pilot Day 0 project context created from the WorkHub intake entry.",
          ownerNickname: input.actor.label,
          ownerUserId: input.actor.userId,
          at: now()
        });
      } catch (error) {
        if (isProjectSlugOccupied(error)) {
          throw new ProjectServiceError(
            409,
            "project_slug_occupied",
            "这个项目标识已被归档或删除的项目占用，请换一个标识后再试。"
          );
        }
        throw error;
      }
      return {
        project: toProjectVm(result.project),
        created: result.created,
        context_ready: true
      };
    },
    async listProjects(input) {
      const workspaceId = input.actor.workspaceId || runtimeSettings.auth.defaultWorkspaceId;
      const rows = await repository.listForWorkspace(workspaceId);
      // findings[#79 同类]：返回前过 fail-closed 输出契约校验（装配走样 → 500，不甩 422）。
      return parseOutputContract(projectListVmSchema, {
        generated_at: now().toISOString(),
        projects: rows.map(toProjectListItemVm)
      }, "projects.list");
    }
  };
}

export function getDefaultProjectService() {
  if (!defaultProjectService) {
    defaultDbClient = getSharedDatabaseClient();
    defaultProjectService = createProjectService(createProjectRepository(defaultDbClient.db));
  }
  return defaultProjectService;
}
