// WorkHub 桌面 · 工作台「任务看板」标签的数据访问薄层——照 timeline/api.ts 的取舍：看板直接复用
// E1 已上线的项目时间线 VM（GET /api/pages/project/:id/timeline，每个工作项已带 status / due_at /
// assignee / blocks_count / overdue），不为看板另起取数端点（后端零改动）。
//
// 唯一的写动作是「派发 / 启动 AI」——把一个「待开工」(spec_ready) 工作项推进到「进行中」(ai_working)，走
// FIX#7 已上线的 POST /api/workitems/:id/agent-runs：服务端入队成功后在仓库层用 CAS 守卫做这次状态机
// 迁移（见 apps/api/src/routes/agent-runs.ts 的 kickoffWorkItemStatus / transitionWorkItemStatus）。
// 这是看板四列之间唯一「工作项级、人可直接触发」有真实端点的状态机转移；其余列间移动没有对应的单端点
// （评审要在提议面板批、澄清要在对话里推进、完成要合并提议、退回要在提议里「要求修改」），一律在
// render/view 里弹回并给人话说明，绝不假接线（04 §4 铁律）。

import type { WorkHubApiClient } from "@workhub/api-client";
import { WorkHubApiError } from "@workhub/api-client";

import { kanbanT } from "./locales.js";

// 看板复用时间线的取数薄封装——同一份 VM，同一个 request 转发口。
export { fetchProjectTimeline } from "../timeline/api.js";
export type { TimelineApiClient } from "../timeline/api.js";

type Locale = "zh-CN" | "en-US";

export type KanbanApiClient = Pick<WorkHubApiClient, "request">;

// 派发 / 启动 AI：把「待开工」(spec_ready) 工作项推进「进行中」(ai_working)。mode/title 皆可选，空 body 即可；
// 服务端 CAS 守卫在仓库层——当前态不是合法前驱时它会 409（agent_run_not_startable），我们据此弹回。
export function dispatchWorkItem(client: KanbanApiClient, workItemId: string): Promise<unknown> {
  return client.request(`/api/workitems/${encodeURIComponent(workItemId)}/agent-runs`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

// 派发失败的人话化：预算/未配模型/状态已变/无权，各给一句可读话；拿不到已知码时 zh 直接用服务端 message
// （已是中文人话），en 回落一句通用英文（不把中文塞进英文界面）。绝不吞真错误。
export function humanizeKanbanError(error: unknown, locale: Locale): string {
  const zh = locale === "zh-CN";
  if (error instanceof WorkHubApiError) {
    const byCode: Record<string, { zh: string; en: string }> = {
      agent_run_not_startable: {
        zh: "这件的状态已经变了，没法从这里开工——刷新看板后再试。",
        en: "This item's status changed — refresh the board and try again."
      },
      budget_exhausted: {
        zh: "这个工作区的 AI 预算已用尽，暂时没法启动新的执行。",
        en: "This workspace's AI budget is used up — can't start a new run right now."
      },
      llm_not_configured: {
        zh: "还没有配置可用的 AI 模型，没法启动执行。",
        en: "No AI model is configured yet, so a run can't start."
      }
    };
    const mapped = byCode[error.code];
    if (mapped) {
      return zh ? mapped.zh : mapped.en;
    }
    if (error.status === 403) {
      return kanbanT(locale, "youDonTHavePermissionTo");
    }
    return zh ? error.message : "Couldn't start the AI — please try again.";
  }
  return kanbanT(locale, "thatDidnTGoThroughPlease");
}
