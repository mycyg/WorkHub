// WorkHub 桌面 · 工作台「日程」标签的数据访问薄层——照 timeline/api.ts 的取舍。日程是纯只读视图：
//   右栏周历：复用 E1 已上线的项目时间线 VM（工作项按 due_at 落卡、里程碑 due_at 标在列头），
//             与看板同一份取数，不另起端点。
//   左栏计划摘要：取 E3 已上线的项目计划草案（GET /api/projects/:id/plan-drafts），挑「最新已批准 /
//             已物化」那份，展示它的 rationale + 里程碑列表；拿不到（无草案 / 无权 / 出错）时静默降级，
//             render 会回落到时间线里程碑列表——绝不因为左栏取数失败拖垮整个日程（同 army pill 的降级手法）。
//
// 说明：项目计划草案 VM（ProjectPlanDraftVM）定义在 apps/api 的 service 里、未经 contracts 导出，这里只
// 为单一消费者（这个日程标签）声明一个「读形状」最小类型，只挑我们真正读的字段——同 timeline/api.ts 给
// 依赖/挂里程碑响应用内联类型的既有先例，不为一个工作台特性去扩 packages/contracts 的公共面。

import type { WorkHubApiClient } from "@workhub/api-client";

// 日程周历复用时间线的取数薄封装——同一份 VM。
export { fetchProjectTimeline } from "../timeline/api.js";
export type { TimelineApiClient } from "../timeline/api.js";

type Locale = "zh-CN" | "en-US";

export type ScheduleApiClient = Pick<WorkHubApiClient, "request">;

// 计划草案的最小读形状——只挑左栏摘要真正用到的字段。
export type SchedulePlanDraft = {
  id: string;
  status: string;
  rationale_md: string | null;
  updated_at: string;
  milestones: Array<{ ref: string; title: string; due_at: string | null; sort: number }>;
};

type PlanDraftListResponse = { drafts?: SchedulePlanDraft[] };

// 已「落地」的计划：已批准（approved）或已物化（materialized，物化后仍留着 rationale/里程碑）。草稿 /
// 待审 / 已驳回都不算——那些还不是拍板的计划，不该冒充「项目计划」展示在日程左栏。
const SETTLED_PLAN_STATUSES = new Set(["approved", "materialized"]);

// 取最新一份已落地的计划草案；没有 / 取数失败 → undefined（render 回落到时间线里程碑列表，不报错）。
export async function fetchLatestSettledPlanDraft(
  client: ScheduleApiClient,
  projectId: string,
  locale: Locale
): Promise<SchedulePlanDraft | undefined> {
  try {
    const path = `/api/projects/${encodeURIComponent(projectId)}/plan-drafts?locale=${encodeURIComponent(locale)}`;
    const data = await client.request<PlanDraftListResponse>(path);
    const drafts = Array.isArray(data.drafts) ? data.drafts : [];
    const settled = drafts.filter((draft) => SETTLED_PLAN_STATUSES.has(draft.status));
    if (settled.length === 0) {
      return undefined;
    }
    // 最新 = updated_at 倒序第一份。
    return [...settled].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  } catch {
    // 无权 / 端点报错 / 网络问题——静默降级，日程右栏照常渲染，左栏回落到里程碑列表。
    return undefined;
  }
}
