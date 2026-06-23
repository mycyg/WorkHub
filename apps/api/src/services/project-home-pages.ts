// GitHub 式项目主页(/projects/:id)聚合：项目元信息 + 进行中工作清单 + 入口动作(新任务/打开网盘)。
// 访问按 canViewProjectDrive 收口(与网盘同一道项目级 fence)；归档/已删项目 findProjectById 返回 null → 404。
import {
  createDriveRepository,
  createWorkItemRepository,
  getSharedDatabaseClient,
  type DriveRepository,
  type WorkItemDataRepository,
  type WorkHubDatabaseClient
} from "@workhub/db";
import {
  projectHomePageVmSchema,
  type ProjectHomePageVM,
  type WorkHubLocale
} from "@workhub/contracts";
import { canViewProjectDrive, canViewWorkItemRecord } from "@workhub/permissions";

import type { AuthActor } from "../middleware/auth.js";
import { parseOutputContract } from "../pages/output-contract.js";

export type ProjectHomePageService = {
  page: (input: { actor: AuthActor; projectId: string; locale?: WorkHubLocale }) => Promise<ProjectHomePageVM>;
};

export type ProjectHomePageServiceDependencies = {
  repo: Pick<WorkItemDataRepository, "findProjectById" | "listOpenByProject">;
  driveRepo: Pick<DriveRepository, "listRecentFilesByProject" | "countFilesByProject">;
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

// 展示清单最多 50 条(项目进行中工作通常远小于此)；可见过滤后 open_work_item_count 取可见清单长度，超 50 的极端项目会封顶。
const OPEN_WORK_ITEM_LIMIT = 50;
// 最近文件卡只展示前几条（file_count 给真实总数）；超出由「打开网盘」进完整文件树。
const RECENT_FILE_LIMIT = 5;

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
      const driveHref = `/drive?project_id=${encodeURIComponent(project.id)}`;
      const [openItems, recentFiles, fileCount] = await Promise.all([
        deps.repo.listOpenByProject(projectId, OPEN_WORK_ITEM_LIMIT),
        deps.driveRepo.listRecentFilesByProject(projectId, RECENT_FILE_LIMIT),
        deps.driveRepo.countFilesByProject(projectId)
      ]);
      // 列表只保留「点进去不会 403」的事项：私有态(intake/澄清/spec_ready)的他人事项对项目成员是
      // 隐藏的(canViewWorkItemRecord 收口),否则项目主页会列出一堆点开就「你没有权限查看」的死链。
      // 与详情页 assertCanReadDetail 同口径:认领人短路 + canViewWorkItemRecord(按 workspace 作用域)。
      // 头部计数随之取「可见条数」,与清单一致(诚实反映用户在本项目能处理多少),不再用全量 countOpenByProject。
      const viewerUserId = actor.userId ?? actor.id;
      const viewableItems = openItems.filter(
        (item) =>
          item.claimedByUserId === viewerUserId ||
          canViewWorkItemRecord(
            {
              id: item.id,
              status: item.status,
              submitterUserId: item.submitterUserId,
              claimedByUserId: item.claimedByUserId,
              workspaceId: item.workspaceId,
              project: {
                archived: project.archived,
                deletedAt: project.deletedAt,
                ownerUserId: project.ownerUserId,
                workspaceId: project.workspaceId
              }
            },
            { id: viewerUserId, isAdmin: actor.isAdmin },
            { workspaceId: actor.workspaceId }
          )
      );
      const data: ProjectHomePageVM = {
        generated_at: now().toISOString(),
        project: {
          id: project.id,
          name: project.name,
          slug: project.slug,
          description: project.description ?? null,
          owner_label: project.ownerNickname,
          // findProjectById 已过滤 archived=false AND deletedAt IS NULL（归档/已删项目在上面就 404 了），
          // 故此处 status 当前恒为 "active"；"archived" 分支为将来「归档项目只读主页」预留，暂不可达。
          status: project.archived ? "archived" : "active"
        },
        // 头部计数 = 当前用户在本项目「可见且可处理」的进行中条数(与下方清单一致)；清单封顶 OPEN_WORK_ITEM_LIMIT 条。
        summary: { open_work_item_count: viewableItems.length },
        drive: {
          file_count: fileCount,
          recent_files: recentFiles.map((file) => ({
            id: file.id,
            name: file.name,
            updated_at: file.updatedAt.toISOString(),
            // #5：深链到网盘并高亮这个文件(item_id)，不再所有文件都指向同一个通用网盘页。
            href: `${driveHref}&item_id=${encodeURIComponent(file.id)}`
          }))
        },
        open_work_items: viewableItems.map((item) => ({
          id: item.id,
          code: item.code,
          title: item.title ?? item.code,
          status: item.status,
          priority: item.priority,
          href: `/workitems/${encodeURIComponent(item.id)}`
        })),
        actions: {
          // 新任务带上项目上下文(/intake?project_id=)→ 接入起始页绑定到本项目，不再丢进通用「试点项目」。
          new_task: { id: "new_task", label: zh ? "新任务" : "New task", method: "GET", href: `/intake?project_id=${encodeURIComponent(project.id)}` },
          open_drive: {
            id: "open_drive",
            label: zh ? "打开网盘" : "Open drive",
            method: "GET",
            href: `/drive?project_id=${encodeURIComponent(project.id)}`
          }
        },
        ...(viewableItems.length === 0 ? { empty_state: "no_open_work" as const } : {})
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
      repo: createWorkItemRepository(defaultProjectHomeDbClient.db),
      driveRepo: createDriveRepository(defaultProjectHomeDbClient.db)
    });
  }
  return defaultProjectHomePageService;
}
