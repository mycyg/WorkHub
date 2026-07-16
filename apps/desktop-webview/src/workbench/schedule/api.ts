// WorkHub 桌面 · 工作台「日程」标签的数据访问薄层——照 timeline/api.ts 的取舍。
//   右栏周历：复用 E1 已上线的项目时间线 VM（工作项按 due_at 落卡、里程碑 due_at 标在列头），
//             与看板同一份取数，不另起端点。
//   左栏项目计划：G4 #9 把 E3 项目规划草案（起草 / 列表 / 详情 / 批准 / 驳回 / 物化五端点，
//             apps/api/src/routes/project-planner.ts 全通）接成双端可用——桌面日程左栏起草、发现、审批。
//
// 说明：项目计划草案 VM（ProjectPlanDraftVM）定义在 apps/api 的 service 里、未经 contracts 导出，这里只
// 为单一消费者（这个日程标签）声明「读形状」最小类型——同 timeline/api.ts 给依赖/挂里程碑响应用内联
// 类型的既有先例，不为一个工作台特性去扩 packages/contracts 的公共面；写路径同理走 client.request<T>。

import type { WorkHubApiClient } from "@workhub/api-client";

// 日程周历复用时间线的取数薄封装——同一份 VM。
export { fetchProjectTimeline } from "../timeline/api.js";
export type { TimelineApiClient } from "../timeline/api.js";

type Locale = "zh-CN" | "en-US";

export type ScheduleApiClient = Pick<WorkHubApiClient, "request">;

// 计划草案的读形状——挑左栏起草/列表/详情/审批真正用到的字段（与服务端 ProjectPlanDraftVM 子集对齐）。
export type SchedulePlanDraftMilestone = { ref: string; title: string; due_at: string | null; sort: number };
export type SchedulePlanDraftItem = {
  ref: string;
  title: string;
  objective_md: string;
  due_at: string | null;
  milestone_ref: string | null;
  depends_on_refs: string[];
  assignee_suggestion: string | null;
};
export type SchedulePlanDraftStatus = "draft" | "pending_review" | "approved" | "rejected" | "materialized";
export type SchedulePlanDraft = {
  id: string;
  status: SchedulePlanDraftStatus | string;
  intent_md: string;
  rationale_md: string | null;
  review_reason_md: string | null;
  milestones: SchedulePlanDraftMilestone[];
  items: SchedulePlanDraftItem[];
  result: { milestone_ids: string[]; work_item_ids: string[]; dependency_count: number } | null;
  created_at: string;
  updated_at: string;
};

export type SchedulePlanMaterializeResult = {
  draft: SchedulePlanDraft;
  result: { milestone_ids: string[]; work_item_ids: string[]; dependency_count: number };
};

type PlanDraftListResponse = { drafts?: SchedulePlanDraft[] };

function draftsPath(projectId: string, locale: Locale): string {
  return `/api/projects/${encodeURIComponent(projectId)}/plan-drafts?locale=${encodeURIComponent(locale)}`;
}

function draftPath(draftId: string, suffix: string, locale: Locale): string {
  return `/api/plan-drafts/${encodeURIComponent(draftId)}${suffix}?locale=${encodeURIComponent(locale)}`;
}

// 列出项目全部计划草案（含 pending_review）。抛错交给调用方分流：403＝无管理权（左栏退回里程碑回落）。
export async function fetchPlanDrafts(
  client: ScheduleApiClient,
  projectId: string,
  locale: Locale
): Promise<SchedulePlanDraft[]> {
  const data = await client.request<PlanDraftListResponse>(draftsPath(projectId, locale));
  return Array.isArray(data.drafts) ? data.drafts : [];
}

// 起草：Cuu 拟计划草案 → 落库待审。LLM 未配置服务端回 503（人话消息随 WorkHubApiError.message 抛出）。
export function createPlanDraft(
  client: ScheduleApiClient,
  projectId: string,
  intent: string,
  locale: Locale
): Promise<SchedulePlanDraft> {
  return client.request<SchedulePlanDraft>(
    `/api/projects/${encodeURIComponent(projectId)}/plan-drafts?locale=${encodeURIComponent(locale)}`,
    { method: "POST", body: JSON.stringify({ intent }) }
  );
}

export function approvePlanDraft(
  client: ScheduleApiClient,
  draftId: string,
  locale: Locale
): Promise<SchedulePlanDraft> {
  return client.request<SchedulePlanDraft>(draftPath(draftId, "/approve", locale), { method: "POST" });
}

export function rejectPlanDraft(
  client: ScheduleApiClient,
  draftId: string,
  reason: string,
  locale: Locale
): Promise<SchedulePlanDraft> {
  return client.request<SchedulePlanDraft>(draftPath(draftId, "/reject", locale), {
    method: "POST",
    body: JSON.stringify({ reason })
  });
}

// 物化：把已批准草案落成里程碑 + 工作项 + 依赖（时间线/日历读路径立即可见）。返回更新后的草案 + 结果计数。
export function materializePlanDraft(
  client: ScheduleApiClient,
  draftId: string,
  locale: Locale
): Promise<SchedulePlanMaterializeResult> {
  return client.request<SchedulePlanMaterializeResult>(draftPath(draftId, "/materialize", locale), { method: "POST" });
}
