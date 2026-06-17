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
  row: { workItem: ProjectHealthSourceRows["openWorkItems"][number]["workItem"]; project: ScheduleNotifyProjectRow | null },
  actor: AuthActor
) {
  return canViewWorkItemRecord({
    id: row.workItem.id,
    status: row.workItem.status,
    submitterUserId: row.workItem.submitterUserId,
    claimedByUserId: row.workItem.claimedByUserId,
    workspaceId: row.workItem.workspaceId,
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
  if (key === "overdue_work_items") {
    return "/calendar";
  }
  if (key === "pending_insights") {
    return `/meetings?project_id=${projectId}`;
  }
  if (key === "failed_runs") {
    return "/";
  }
  return "/";
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
      const sources = await deps.projectHealth.readProjectHealthSources({ failedRunsSince: since });

      const visibleProjects = sources.projects.filter((project) =>
        canViewProjectDrive(projectAccess(project), input.actor)
      );
      const visibleProjectIds = new Set(visibleProjects.map((project) => project.id));

      const openWorkItems = sources.openWorkItems.filter((row) =>
        row.project && visibleProjectIds.has(row.project.id) && canViewWorkItemRow(row, input.actor)
      );
      const pendingApprovals = sources.pendingApprovals.filter((row) =>
        row.project && row.workItem && visibleProjectIds.has(row.project.id) &&
        canViewWorkItemRow({ workItem: row.workItem, project: row.project }, input.actor)
      );
      const failedRuns = sources.failedRuns.filter((row) =>
        row.project && row.workItem && visibleProjectIds.has(row.project.id) &&
        canViewWorkItemRow({ workItem: row.workItem, project: row.project }, input.actor)
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
          target_href: `/drive?project_id=${project.id}`
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
