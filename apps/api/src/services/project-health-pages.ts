import {
  projectHealthPageVmSchema,
  projectHealthSignalBand,
  resolveProjectHealthBand,
  type ProjectHealthCardVM,
  type ProjectHealthPageVM,
  type ProjectHealthSignalKey,
  type ProjectHealthSignalVM,
  type WorkHubLocale
} from "@workhub/contracts";
import {
  getSharedDatabaseClient,
  createProjectHealthRepository,
  type ProjectHealthRepository,
  type ProjectHealthSourceRows,
  type ScheduleNotifyProjectRow,
  type WorkHubDatabaseClient
} from "@workhub/db";
import {
  canViewProjectDrive,
  canViewProjectMeetings,
  canViewWorkItemRecord
} from "@workhub/permissions";

import type { AuthActor } from "../middleware/auth.js";
import { parseOutputContract } from "../pages/output-contract.js";

export type ProjectHealthPageServiceDependencies = {
  projectHealth: ProjectHealthRepository;
  now?: () => Date;
};

export type ProjectHealthPageService = ReturnType<typeof createProjectHealthPageService>;

let defaultDbClient: WorkHubDatabaseClient | undefined;

export function getDefaultProjectHealthPageServiceDependencies(): ProjectHealthPageServiceDependencies {
  defaultDbClient ??= getSharedDatabaseClient();
  return {
    projectHealth: createProjectHealthRepository(defaultDbClient.db)
  };
}

const failedRunWindowDays = 30;

function projectAccess(project: ScheduleNotifyProjectRow) {
  return {
    archived: project.archived,
    deletedAt: project.deletedAt,
    ownerUserId: project.ownerUserId,
    orgId: project.orgId ?? null,
    workspaceId: project.workspaceId
  };
}

function actorUser(actor: AuthActor) {
  return {
    id: actor.userId ?? actor.id,
    isAdmin: actor.isAdmin
  };
}

function canViewWorkItemRow(
  row: {
    workItem: ProjectHealthSourceRows["openWorkItems"][number]["workItem"];
    project: ScheduleNotifyProjectRow | null;
    assignments?: Array<{ userId: string; role: string }>;
  },
  actor: AuthActor
) {
  return canViewWorkItemRecord({
    id: row.workItem.id,
    status: row.workItem.status,
    submitterUserId: row.workItem.submitterUserId,
    claimedByUserId: row.workItem.claimedByUserId,
    workspaceId: row.workItem.workspaceId,
    assignments: row.assignments ?? [],
    project: row.project ? projectAccess(row.project) : null
  }, actorUser(actor), {
    workspaceId: actor.workspaceId
  });
}

function isDoneWorkItem(status: string) {
  return status === "merged" || status === "done" || status === "cancelled";
}

function signalTargetHref(key: ProjectHealthSignalKey, projectId: string): string {
  if (key === "pending_approvals") {
    return "/approvals";
  }
  if (key === "pending_insights") {
    return `/meetings?project_id=${projectId}`;
  }
  // XC-2/XC-3：逾期事项、失败运行此前分别指向 /calendar(只显示本周,逾期按定义在过去→看不到)和 /(首页只显示
  // 在跑的 run→失败的看不到),点了都落到空页。改指向该项目主页(/projects/:id)——逾期是 open 工作项的子集,
  // 主页就列着开放工作项;失败运行也归属这个项目的上下文。比把人甩到必然为空的页面诚实得多。
  if (key === "overdue_work_items" || key === "failed_runs") {
    return `/projects/${projectId}`;
  }
  return `/projects/${projectId}`;
}

function signal(key: ProjectHealthSignalKey, count: number, projectId: string): ProjectHealthSignalVM {
  return {
    key,
    count,
    band: projectHealthSignalBand(key, count),
    target_href: signalTargetHref(key, projectId)
  };
}

export function createProjectHealthPageService(
  deps: ProjectHealthPageServiceDependencies = getDefaultProjectHealthPageServiceDependencies()
) {
  const now = deps.now ?? (() => new Date());

  return {
    async healthPage(input: { actor: AuthActor; locale: WorkHubLocale }): Promise<ProjectHealthPageVM> {
      const clock = now();
      const since = new Date(clock.getTime() - failedRunWindowDays * 24 * 60 * 60 * 1000);
      const sources = await deps.projectHealth.readProjectHealthSources({
        failedRunsSince: since,
        actor: {
          isAdmin: input.actor.isAdmin,
          userId: input.actor.userId ?? input.actor.id,
          ...(input.actor.orgId ? { orgId: input.actor.orgId } : {}),
          ...(input.actor.workspaceId ? { workspaceId: input.actor.workspaceId } : {})
        }
      });

      const visibleProjects = sources.projects.filter((project) =>
        canViewProjectDrive(projectAccess(project), input.actor)
      );
      const visibleProjectIds = new Set(visibleProjects.map((project) => project.id));

      const openWorkItems = sources.openWorkItems.filter((row) =>
        row.project && visibleProjectIds.has(row.project.id) && canViewWorkItemRow(row, input.actor)
      );
      // XC-1：health 的「待审批」必须与点进去的 /approvals 同口径——/approvals 对非管理员只显示**路由给本人**的
      // (listPendingForUser includeAll=isAdmin)。否则成员看到非零「待审批」点进去却是空队列,像数据撒谎。管理员两边都看全。
      const approvalActorUserId = input.actor.userId ?? input.actor.id;
      const pendingApprovals = sources.pendingApprovals.filter((row) =>
        row.project && row.workItem && visibleProjectIds.has(row.project.id) &&
        canViewWorkItemRow({ workItem: row.workItem, project: row.project, assignments: row.workItemAssignments ?? [] }, input.actor) &&
        (input.actor.isAdmin || row.approval.routedToUserId === approvalActorUserId)
      );
      const failedRuns = sources.failedRuns.filter((row) =>
        row.project && row.workItem && visibleProjectIds.has(row.project.id) &&
        canViewWorkItemRow({ workItem: row.workItem, project: row.project, assignments: row.workItemAssignments ?? [] }, input.actor)
      );
      const pendingInsights = sources.pendingInsights.filter((row) =>
        row.project && visibleProjectIds.has(row.project.id) &&
        canViewProjectMeetings(projectAccess(row.project), input.actor)
      );

      const cards: ProjectHealthCardVM[] = visibleProjects.map((project) => {
        const projectOpen = openWorkItems.filter((row) => row.project?.id === project.id);
        const overdue = projectOpen.filter((row) =>
          row.workItem.dueAt && row.workItem.dueAt.getTime() < clock.getTime() && !isDoneWorkItem(row.workItem.status)
        );
        const signals: ProjectHealthSignalVM[] = [
          signal("open_work_items", projectOpen.length, project.id),
          signal("overdue_work_items", overdue.length, project.id),
          signal("pending_approvals", pendingApprovals.filter((row) => row.project?.id === project.id).length, project.id),
          signal("failed_runs", failedRuns.filter((row) => row.project?.id === project.id).length, project.id),
          signal("pending_insights", pendingInsights.filter((row) => row.project?.id === project.id).length, project.id)
        ];
        return {
          project_id: project.id,
          project_name: project.name,
          // band 仍由真实 count 推导（健康/关注/紧急三档），保证排序与配色正确。
          band: resolveProjectHealthBand(signals),
          // L[5]：原始 count 是服务端泄露面——numbers_visible 只是展示提示，绕过它（curl）仍能读到精确的
          // 待审批数 / 失败运行数。非管理员一律把 count 归零，仅保留定性 band，绝不依赖客户端遵守 numbers_visible。
          signals: input.actor.isAdmin ? signals : signals.map((signalVm) => ({ ...signalVm, count: 0 })),
          numbers_visible: input.actor.isAdmin,
          // PROJ-3：「打开项目」应进项目主页 hub(/projects/:id,那里有工作项/负责人/动作,并自带「打开网盘」),
          // 而不是直接跳进网盘文件树、绕过这个 GitHub 式的项目组织单元。
          target_href: `/projects/${project.id}`
        };
      });

      const sorted = [...cards].sort((left, right) => {
        const order = { critical: 0, attention: 1, healthy: 2 } as const;
        return order[left.band] - order[right.band] || left.project_name.localeCompare(right.project_name);
      });

      // findings[#79 同类]：返回前过 fail-closed 输出契约校验（装配走样 → 500，不甩 422）。
      return parseOutputContract(projectHealthPageVmSchema, {
        generated_at: clock.toISOString(),
        actor_user_id: input.actor.userId ?? input.actor.id,
        viewer_scope: input.actor.isAdmin ? "admin" : "member",
        summary: {
          project_count: sorted.length,
          healthy_count: sorted.filter((card) => card.band === "healthy").length,
          attention_count: sorted.filter((card) => card.band === "attention").length,
          critical_count: sorted.filter((card) => card.band === "critical").length
        },
        cards: sorted,
        ...(sorted.length === 0 ? { empty_state: "no_projects" as const } : {})
      }, "project-health.page");
    }
  };
}
