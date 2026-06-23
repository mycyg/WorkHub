// GitHub 式项目主页(/projects/:id)聚合：项目元信息 + 进行中工作清单 + 入口动作(新任务/打开网盘)。
// 访问按 canViewProjectDrive 收口(与网盘同一道项目级 fence)；归档/已删项目 findProjectById 返回 null → 404。
import {
  createWorkItemRepository,
  getSharedDatabaseClient,
  type WorkItemDataRepository,
  type WorkHubDatabaseClient
} from "@workhub/db";
import {
  projectHomePageVmSchema,
  type ProjectHomePageVM,
  type WorkHubLocale
} from "@workhub/contracts";
import { canViewProjectDrive } from "@workhub/permissions";

import type { AuthActor } from "../middleware/auth.js";
import { parseOutputContract } from "../pages/output-contract.js";

export type ProjectHomePageService = {
  page: (input: { actor: AuthActor; projectId: string; locale?: WorkHubLocale }) => Promise<ProjectHomePageVM>;
};

export type ProjectHomePageServiceDependencies = {
  repo: Pick<WorkItemDataRepository, "findProjectById" | "listOpenByProject">;
  now?: () => Date;
};

export class ProjectHomePageServiceError extends Error {
  constructor(
    public readonly status: 403 | 404,
    message: string,
    public readonly code = "project_home_error"
  ) {
    super(message);
  }
}

// 展示清单最多 50 条(项目进行中工作通常远小于此)；open_work_item_count 取清单长度，超 50 的极端项目会封顶。
const OPEN_WORK_ITEM_LIMIT = 50;

export function createProjectHomePageService(deps: ProjectHomePageServiceDependencies): ProjectHomePageService {
  const now = deps.now ?? (() => new Date());
  return {
    async page({ actor, projectId, locale }) {
      const project = await deps.repo.findProjectById(projectId);
      if (!project) {
        throw new ProjectHomePageServiceError(404, "没有找到这个项目。", "project_not_found");
      }
      const canView = canViewProjectDrive(
        {
          archived: project.archived,
          deletedAt: project.deletedAt,
          ownerUserId: project.ownerUserId,
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
        throw new ProjectHomePageServiceError(403, "你没有这个项目的访问权限。", "project_forbidden");
      }
      const zh = (locale ?? "zh-CN") === "zh-CN";
      const openItems = await deps.repo.listOpenByProject(projectId, OPEN_WORK_ITEM_LIMIT);
      const data: ProjectHomePageVM = {
        generated_at: now().toISOString(),
        project: {
          id: project.id,
          name: project.name,
          slug: project.slug,
          description: project.description ?? null,
          owner_label: project.ownerNickname,
          status: project.archived ? "archived" : "active"
        },
        summary: { open_work_item_count: openItems.length },
        open_work_items: openItems.map((item) => ({
          id: item.id,
          code: item.code,
          title: item.title ?? item.code,
          status: item.status,
          priority: item.priority,
          href: `/workitems/${encodeURIComponent(item.id)}`
        })),
        actions: {
          new_task: { id: "new_task", label: zh ? "新任务" : "New task", method: "GET", href: "/intake" },
          open_drive: {
            id: "open_drive",
            label: zh ? "打开网盘" : "Open drive",
            method: "GET",
            href: `/drive?project_id=${encodeURIComponent(project.id)}`
          }
        },
        ...(openItems.length === 0 ? { empty_state: "no_open_work" as const } : {})
      };
      return parseOutputContract(projectHomePageVmSchema, data, "project.home");
    }
  };
}

let defaultProjectHomeDbClient: WorkHubDatabaseClient | undefined;
let defaultProjectHomePageService: ProjectHomePageService | undefined;
export function getDefaultProjectHomePageService(): ProjectHomePageService {
  if (!defaultProjectHomePageService) {
    defaultProjectHomeDbClient = getSharedDatabaseClient();
    defaultProjectHomePageService = createProjectHomePageService({
      repo: createWorkItemRepository(defaultProjectHomeDbClient.db)
    });
  }
  return defaultProjectHomePageService;
}
