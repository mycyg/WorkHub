// WorkHub 桌面 · R13 批 P2（拍板链路收尾）：dispatch_ask 错过补偿——群里派活的问询气泡是"实时才会看见"
// 的东西（打扰路由：前台=气泡，后台=系统通知，见 apps/api/src/workers/conversation-observer.ts 的
// dispatchExecuteItem 与 00-interaction-design.md §7 打扰矩阵），工作台没开着的时候错过了就是真的错过
// 了——重开工作台/切回这个项目时,应该有条温和的行内提醒条把它捞回来,而不是让它只活在通知中心里
// 没人点开看。
//
// 数据来源:GET /api/notifications(现有端点,已经带服务端 200 上限,见
// apps/api/src/services/notifications.ts 的 listForUser)——这里只按"未读 + action_card_item.
// dispatch_ask + 当前项目"三个条件在客户端筛一遍，不新增任何服务端端点或分页参数(范围围栏也不允许)。
//
// 点击后"跳到对应行动卡"的定位方式看 timeline.ts 的 findActionCardMessageIdByTitle 顶部注释——
// notifications 表/action_card_items 的 wire content 都没有能直接互相关联的条目 id，只能退而求其次
// 用标题文本做最佳努力匹配；找不到就诚实地退化成"滚到会话顶部"（mountChatView 里实现，这里只管
// 纯函数：筛通知、渲染这条提醒条）。

import type { Notification } from "@workhub/contracts";
import { escapeHtml } from "@workhub/web-runtime";

import { workbenchIcons } from "../icons.js";

type Locale = "zh-CN" | "en-US";

const DISPATCH_ASK_NOTIFICATION_TYPE = "action_card_item.dispatch_ask";

// 未读 + 未归档 + 类型是 dispatch_ask + 属于当前项目——四个条件全中才算"这个项目里有一件事在等你拍板"。
// 一个项目可能同时攒了好几条(比如工作台好几天没开)，只挑最新一条摆出来(温和提醒不该是一整叠)；
// 服务端 listForUser 已经按 created_at desc 排好序，这里防御性地不假设顺序，自己按 created_at 挑最新。
export function pickDispatchAskCatchupNotification(
  notifications: readonly Notification[],
  projectId: string
): Notification | undefined {
  const candidates = notifications.filter(
    (notification) =>
      notification.type === DISPATCH_ASK_NOTIFICATION_TYPE &&
      notification.project_id === projectId &&
      !notification.read_at &&
      !notification.archived_at
  );
  if (candidates.length === 0) {
    return undefined;
  }
  return candidates.reduce((latest, candidate) =>
    Date.parse(candidate.created_at) > Date.parse(latest.created_at) ? candidate : latest
  );
}

export function renderDispatchAskCatchupBannerHtml(notification: Notification | undefined, locale: Locale): string {
  if (!notification) {
    return "";
  }
  const zh = locale === "zh-CN";
  const title = zh ? "有个活在等你拍板" : "Something's waiting on your call";
  const body = notification.body?.trim();
  return `<button type="button" class="wh-wb-chat-catchup" data-wb-chat-catchup-open data-wb-chat-catchup-notification="${escapeHtml(notification.id)}">
    ${workbenchIcons.army}
    <span class="wh-wb-chat-catchup-text"><b>${escapeHtml(title)}</b>${body ? `<span class="wh-wb-chat-catchup-body">${escapeHtml(body)}</span>` : ""}</span>
    <span class="wh-wb-chat-catchup-cta">${zh ? "去看看" : "Take a look"}</span>
  </button>`;
}
