import { getSharedDatabaseClient, createProjectRepository, type ProjectRepository, type WorkHubDatabaseClient } from "@workhub/db";
import type { BootstrapProjectRequest, BootstrapProjectResult, ProjectVM } from "@workhub/contracts";
import { settings as defaultSettings, type Settings } from "@workhub/config";

import type { AuthActor } from "../middleware/auth.js";

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
  return ascii || "pilot-project";
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

export function createProjectService(
  repository: ProjectRepository,
  options: ProjectServiceOptions = {}
): ProjectService {
  const runtimeSettings = options.settings ?? defaultSettings;
  const now = options.now ?? (() => new Date());

  return {
    async bootstrapProject(input) {
      if (!input.actor.userId) {
        throw new ProjectServiceError(403, "human_required", "需要真人用户才能创建 pilot 项目。");
      }
      const name = input.payload.name?.trim() || "Day 0 Pilot Project";
      const slug = input.payload.slug?.trim() || slugFromName(name);
      const result = await repository.bootstrapPilotProject({
        orgId: input.actor.orgId || runtimeSettings.auth.defaultOrgId,
        workspaceId: input.actor.workspaceId || runtimeSettings.auth.defaultWorkspaceId,
        name,
        slug,
        description: input.payload.description ?? "Pilot Day 0 project context created from the WorkHub intake entry.",
        ownerNickname: input.actor.label,
        ownerUserId: input.actor.userId,
        at: now()
      });
      return {
        project: toProjectVm(result.project),
        created: result.created,
        context_ready: true
      };
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
