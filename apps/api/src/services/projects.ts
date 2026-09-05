import { createHash } from "node:crypto";

import {
  ProjectSlugOccupiedError,
  getSharedDatabaseClient,
  createProjectRepository,
  type ProjectRepository,
  type WorkHubDatabaseClient
} from "@workhub/db";
import { projectListVmSchema, type WorkHubLocale } from "@workhub/contracts";
import type {
  BootstrapProjectRequest,
  BootstrapProjectResult,
  CreatePersonalProjectRequest,
  CreatePersonalProjectResult,
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
    // R24-K（S5-N-06）：建项目时内置的「主区」会话标题按这个语言生成。不传即中文（既有调用方不变）。
    locale?: WorkHubLocale;
  }) => Promise<BootstrapProjectResult>;
  listProjects: (input: { actor: AuthActor }) => Promise<ProjectListVM>;
  // R13 批 S3（个人空间）：与团队项目 bootstrap/list 分开的两个方法——个人空间没有 slug 幂等复用
  // 语义（每次调用都新建一个），列表也只回该 actor 名下 is_personal=true 的项目。
  createPersonalProject: (input: {
    payload: CreatePersonalProjectRequest;
    actor: AuthActor;
    locale?: WorkHubLocale;
  }) => Promise<CreatePersonalProjectResult>;
  listPersonalProjects: (input: { actor: AuthActor }) => Promise<ProjectListVM>;
};

export type ProjectServiceOptions = {
  settings?: Settings;
  now?: () => Date;
};

let defaultDbClient: WorkHubDatabaseClient | undefined;
let defaultProjectService: ProjectService | undefined;

// R24-K（S5-N-06）：项目内置「主区」会话的名字。真机走查里，英文系统的新用户建完项目，工作台侧栏那一行
// 是整窗唯一的中文——服务端建项目时把标题写死成了「主区」。主区不可改名（conversation-rename 对
// kind='main' 一律 403），所以这就是个纯展示常量，按建项目那一刻的语言给出即可。
export function mainConversationTitleForLocale(locale: WorkHubLocale | undefined): string {
  return locale === "en-US" ? "Main" : "主区";
}

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
    owner_user_id: project.ownerUserId ?? null,
    is_personal: project.isPersonal
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
    open_work_item_count: row.openWorkItemCount,
    is_personal: row.isPersonal
  };
}

// R13 批 S3：默认命名「我的空间」/「我的空间 2」…按该用户已有的个人空间数量顺延。不追求全局强
// 唯一（两次几乎同时创建可能撞到同一个序号），行为取舍与 rail.ts 的 nextCollabConversationTitle
// 同款——多余的编号重复不影响可用性，比引入服务端串行计数器更简单诚实。
function nextPersonalProjectName(existingCount: number): string {
  return existingCount === 0 ? "我的空间" : `我的空间 ${existingCount + 1}`;
}

// slug 只是内部标识，不在任何用户可见界面里展示（rail.ts 只渲染 name）；用 userId + 时间戳而不是
// slugFromName(name)——个人空间的默认名是纯中文，slugFromName 对纯 ASCII-空结果会退化成
// name 的哈希，和「同一用户可以建多个默认同名个人空间」的需求在语义上纠缠，不如直接按人+时间生成，
// 保真唯一且和显示名完全解耦。
function personalProjectSlug(ownerUserId: string, at: Date): string {
  return `personal-${ownerUserId}-${at.getTime().toString(36)}`;
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
          mainConversationTitle: mainConversationTitleForLocale(input.locale),
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
    },

    async createPersonalProject(input) {
      if (!input.actor.userId) {
        throw new ProjectServiceError(403, "human_required", "需要真人用户才能创建个人空间。");
      }
      const workspaceId = input.actor.workspaceId || runtimeSettings.auth.defaultWorkspaceId;
      const at = now();
      // 用户拍板：不做跨工作区统一视图——个人空间挂在发起人当前活跃工作区，多工作区用户在
      // 每个工作区各自拥有一批个人空间（同 R13 S3 设计稿踩雷#1）。
      const existing = await repository.listPersonalForUser({ workspaceId, ownerUserId: input.actor.userId });
      const requestedName = input.payload.name?.trim();
      const name = requestedName || nextPersonalProjectName(existing.length);
      let result: Awaited<ReturnType<ProjectRepository["bootstrapPersonalProject"]>>;
      try {
        result = await repository.bootstrapPersonalProject({
          workspaceId,
          name,
          slug: personalProjectSlug(input.actor.userId, at),
          ownerNickname: input.actor.label,
          ownerUserId: input.actor.userId,
          mainConversationTitle: mainConversationTitleForLocale(input.locale),
          at
        });
      } catch (error) {
        if (isProjectSlugOccupied(error)) {
          throw new ProjectServiceError(409, "project_slug_occupied", "这个个人空间暂时创建失败，请重试。");
        }
        throw error;
      }
      return {
        project: toProjectVm(result.project),
        created: result.created,
        context_ready: true
      };
    },

    async listPersonalProjects(input) {
      if (!input.actor.userId) {
        throw new ProjectServiceError(403, "human_required", "需要真人用户才能查看个人空间。");
      }
      const workspaceId = input.actor.workspaceId || runtimeSettings.auth.defaultWorkspaceId;
      const rows = await repository.listPersonalForUser({ workspaceId, ownerUserId: input.actor.userId });
      return parseOutputContract(projectListVmSchema, {
        generated_at: now().toISOString(),
        projects: rows.map(toProjectListItemVm)
      }, "projects.personal.list");
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
