// WorkHub 桌面 · 工作台「时间线」标签的数据访问薄层——照 chat/api.ts 的取舍：里程碑 CRUD /
// 依赖增删 / 挂里程碑这一组写端点还没有专门的 WorkHubApiClient 具名方法，不为一个只有工作台窗口用的
// 批次特性扩大 packages/api-client 的公共面（`request<T>` 是现成的、供单一消费者端点用的转发口，
// 同 chat/api.ts、apps/web/src/browser.ts 的既有先例），这里只给它包一层类型安全的薄封装 + 领域错误
// 人话化。GET 时间线 VM 也走同一个 request（服务端端点是 E1 已上线的 GET /api/pages/project/:id/timeline）。

import type { WorkHubApiClient } from "@workhub/api-client";
import { WorkHubApiError } from "@workhub/api-client";
import type { ProjectMilestoneVM, ProjectTimelinePageVM } from "@workhub/contracts";

import { timelineT } from "./locales.js";

type Locale = "zh-CN" | "en-US";

export type TimelineApiClient = Pick<WorkHubApiClient, "request">;

function localePath(path: string, locale: Locale): string {
  return `${path}${path.includes("?") ? "&" : "?"}locale=${encodeURIComponent(locale)}`;
}

export function fetchProjectTimeline(
  client: TimelineApiClient,
  projectId: string,
  locale: Locale
): Promise<ProjectTimelinePageVM> {
  return client.request<ProjectTimelinePageVM>(
    localePath(`/api/pages/project/${encodeURIComponent(projectId)}/timeline`, locale)
  );
}

export function createMilestone(
  client: TimelineApiClient,
  projectId: string,
  payload: { title: string; due_at?: string | null }
): Promise<ProjectMilestoneVM> {
  return client.request<ProjectMilestoneVM>(`/api/projects/${encodeURIComponent(projectId)}/milestones`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateMilestone(
  client: TimelineApiClient,
  projectId: string,
  milestoneId: string,
  payload: { title?: string; due_at?: string | null; status?: "open" | "done" }
): Promise<ProjectMilestoneVM> {
  return client.request<ProjectMilestoneVM>(
    `/api/projects/${encodeURIComponent(projectId)}/milestones/${encodeURIComponent(milestoneId)}`,
    { method: "PATCH", body: JSON.stringify(payload) }
  );
}

export function deleteMilestone(
  client: TimelineApiClient,
  projectId: string,
  milestoneId: string
): Promise<{ milestone_id: string }> {
  return client.request<{ milestone_id: string }>(
    `/api/projects/${encodeURIComponent(projectId)}/milestones/${encodeURIComponent(milestoneId)}`,
    { method: "DELETE" }
  );
}

export function addDependency(
  client: TimelineApiClient,
  workItemId: string,
  dependsOn: string
): Promise<{ work_item_id: string; depends_on: string; created: boolean }> {
  return client.request(`/api/workitems/${encodeURIComponent(workItemId)}/dependencies`, {
    method: "POST",
    body: JSON.stringify({ depends_on: dependsOn })
  });
}

export function removeDependency(
  client: TimelineApiClient,
  workItemId: string,
  dependsOn: string
): Promise<{ work_item_id: string; depends_on: string; removed: boolean }> {
  return client.request(`/api/workitems/${encodeURIComponent(workItemId)}/dependencies`, {
    method: "DELETE",
    body: JSON.stringify({ depends_on: dependsOn })
  });
}

export function attachMilestone(
  client: TimelineApiClient,
  workItemId: string,
  milestoneId: string | null
): Promise<{ work_item_id: string; milestone_id: string | null }> {
  return client.request(`/api/workitems/${encodeURIComponent(workItemId)}/milestone`, {
    method: "PATCH",
    body: JSON.stringify({ milestone_id: milestoneId })
  });
}

// 领域错误人话化：E1 的服务端已经带了不错的中文 message（环/跨项目/自依赖/里程碑跨项目），en-US
// 则按错误码翻成英文；拿不到已知码就回落到服务端 message、再回落到一句通用话。绝不吞掉真错误。
export function humanizeTimelineError(error: unknown, locale: Locale): string {
  const zh = locale === "zh-CN";
  if (error instanceof WorkHubApiError) {
    const byCode: Record<string, { zh: string; en: string }> = {
      dependency_cycle: {
        zh: "这条依赖会绕成一个环（A 等 B、B 又回头等 A），没法建立。",
        en: "That dependency would form a cycle (A waits on B, B loops back to A)."
      },
      dependency_cross_project: {
        zh: "依赖只能建立在同一个项目内的任务之间。",
        en: "Dependencies can only link tasks within the same project."
      },
      dependency_self_dependency: {
        zh: "一个任务不能依赖它自己。",
        en: "A task can't depend on itself."
      },
      milestone_scope_mismatch: {
        zh: "里程碑必须和任务属于同一个项目。",
        en: "The milestone must belong to the same project as the task."
      }
    };
    const mapped = byCode[error.code];
    if (mapped) {
      return zh ? mapped.zh : mapped.en;
    }
    if (error.status === 403) {
      return timelineT(locale, "youDonTHavePermissionFor");
    }
    // 服务端 message 已是中文人话——zh 直接用；en 没有专门映射时给一句通用英文（不把中文塞给英文界面）。
    return zh ? error.message : "Couldn't save that change — please try again.";
  }
  return timelineT(locale, "thatDidnTGoThroughPlease");
}
