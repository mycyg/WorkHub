// WorkHub 桌面 · R16-W4b2（中栏「已打开会话」tab 条）：纯渲染函数（无副作用）。
// 位置照原型（中栏顶部、聊天视图之上的一条 tab 条）、样式贴玻璃体系（css.ts 的 .wh-wb-sess-* 一组）。
// 只在 centerTab 为会话类（chat/collab/dm）且集合非空时由 shell 挂出来——它只是「已打开的快捷切换」，
// rail 仍是唯一「发现」入口。
//
// 标题/未读走 refreshTabs 已刷进 tab 的快照（tab.title / tab.unread，见 model.ts）；DM 的在线点是渲染态
// （不入库、随 presence 变），这里从 dmList + onlineUserIds 现算。close(x) 是紧挨 open 按钮的兄弟按钮
// （不套在 open 按钮里——按钮里不能套按钮，同 rail.ts 协同会话叶子旁的重命名铅笔的既有取舍）。

import { escapeHtml } from "@workhub/web-runtime";

import type { DmListItemVM } from "@workhub/contracts";

import { dmPeerParticipant } from "../dm.js";
import { workbenchIcons } from "../icons.js";
import type { OpenConversationTab } from "./model.js";

type Locale = "zh-CN" | "en-US";

function tabIconHtml(tab: OpenConversationTab, online: boolean): string {
  if (tab.kind === "dm") {
    // 私聊：对方昵称 + 在线点（在线=绿，离线/未知=淡灰空心感）。
    return `<span class="wh-wb-sess-dot${online ? " is-online" : ""}" aria-hidden="true"></span>`;
  }
  return tab.kind === "collab" ? workbenchIcons.collab : workbenchIcons.chat;
}

function dmPeerOnline(
  tab: OpenConversationTab,
  dmList: readonly DmListItemVM[],
  currentUserId: string | undefined,
  onlineUserIds: ReadonlySet<string>
): boolean {
  const dm = dmList.find((item) => item.conversation.id === tab.conversationId);
  if (!dm) {
    return false;
  }
  const peer = dmPeerParticipant(dm, currentUserId);
  return peer ? onlineUserIds.has(peer.user_id) : false;
}

export function renderConversationTabsHtml(input: {
  tabs: readonly OpenConversationTab[];
  activeConversationId: string | undefined;
  dmList: readonly DmListItemVM[];
  currentUserId: string | undefined;
  onlineUserIds: ReadonlySet<string>;
  locale: Locale;
}): string {
  const zh = input.locale === "zh-CN";
  const tabsHtml = input.tabs
    .map((tab) => {
      // R24-D：关闭按钮平时是隐形的（CSS 只在 hover/激活/键盘聚焦时显出来，见 css.ts 的 .wh-wb-sess-close），
      // 所以它的无障碍名字必须自带会话名——读屏里一串「关闭 关闭 关闭」等于没说。
      // 会话名是用户输入，进属性前照样要转义（同下面 .wh-wb-sess-name 的 escapeHtml）。
      const closeLabel = escapeHtml(zh ? `关闭「${tab.title}」` : `Close "${tab.title}"`);
      const active = tab.conversationId === input.activeConversationId;
      const online = tab.kind === "dm" ? dmPeerOnline(tab, input.dmList, input.currentUserId, input.onlineUserIds) : false;
      const unread =
        !active && tab.unread > 0
          ? `<span class="wh-wb-sess-unread">${tab.unread}</span>`
          : "";
      return `<div class="wh-wb-sess-tab${active ? " is-active" : ""}">
        <button type="button" class="wh-wb-sess-open" data-wb-tab="${escapeHtml(tab.conversationId)}" aria-current="${active ? "true" : "false"}">${tabIconHtml(
          tab,
          online
        )}<span class="wh-wb-sess-name">${escapeHtml(tab.title)}</span>${unread}</button>
        <button type="button" class="wh-wb-sess-close" data-wb-tab-close="${escapeHtml(tab.conversationId)}" aria-label="${closeLabel}" title="${closeLabel}">${workbenchIcons.close}</button>
      </div>`;
    })
    .join("");
  return tabsHtml;
}
