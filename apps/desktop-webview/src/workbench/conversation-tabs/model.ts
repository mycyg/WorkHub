// WorkHub 桌面 · R16-W4b2（中栏「已打开会话」tab 条）：集合语义纯逻辑（无副作用、可单测）。
//
// openConversationTabs 是一个有序数组（展示顺序 = 插入顺序，不做拖拽/激活重排——W4b2 拍板不做拖拽排序）。
// 每条 tab 由 conversationId 唯一标识（主区/协同/私聊的会话 id 在全库唯一）。tab 条只是「已打开的快捷切换」，
// 不改挂载模型——切 tab 仍走现状 selectProject/openDm 的单实例重挂路径（见 shell.ts）。
//
// 「活跃」是从 store 派生的（centerTab + activeConversationId/activeDmConversationId + 主区会话 id，见
// shell.ts 的 currentlyOpenConversationId），不在 tab 上单独存——rail 选中态与活跃 tab 因此天然双向同步。
// lastActiveAt 是一个单调递增的激活序号，只用于「超限时挑最久未激活的淘汰」（LRU），不参与展示排序。

import type { DmListItemVM, WorkbenchPageVM } from "@workhub/contracts";

import { dmPeerParticipant } from "../dm.js";

// 集合上限：超过就挤掉「最久未激活的非当前」tab（浏览器标签手感）。
export const MAX_OPEN_CONVERSATION_TABS = 8;

export type OpenConversationTabKind = "main" | "collab" | "dm";

// 一条已打开会话 tab。
// - projectId：main/collab 的所属项目（点 tab 时据此走 selectProject 重挂）；dm 是容器项目（信息性，
//   点 dm tab 走 openDm，不用 projectId）。跨项目 tab 也可共存（dm 天然跨项目、多项目主区可并列）。
// - title：渲染快照——跨项目 tab 的 vm 没加载在本地时也要有个标签；同项目 tab 的标题由 refreshTabs 从
//   活数据（vm/dmList）持续刷新（会话重命名/对方昵称变化会跟上）。
// - unread：徽标数——由 refreshTabs 从活数据单向刷入的镜像（vm/dmList 的 unread_count 是权威，rail 红点
//   读同一个源，因此 tab 徽标与 rail 红点天然同步；这里绝不另开一路写 unread，见 W4b2「别双写」纪律）。
export type OpenConversationTab = {
  kind: OpenConversationTabKind;
  conversationId: string;
  projectId?: string;
  title: string;
  unread: number;
  lastActiveAt: number;
};

// 打开/激活一条会话 tab 的描述——不带 unread/lastActiveAt（由集合维护）。
export type ConversationTabDescriptor = {
  kind: OpenConversationTabKind;
  conversationId: string;
  projectId?: string;
  title: string;
};

function makeTab(descriptor: ConversationTabDescriptor, unread: number, lastActiveAt: number): OpenConversationTab {
  // exactOptionalPropertyTypes：projectId?: string 不接受显式 undefined——没值时干脆不带这个键
  // （同 rail.ts toPendingRenderModel 的既有取舍）。
  return {
    kind: descriptor.kind,
    conversationId: descriptor.conversationId,
    ...(descriptor.projectId !== undefined ? { projectId: descriptor.projectId } : {}),
    title: descriptor.title,
    unread,
    lastActiveAt
  };
}

function maxLastActiveAt(tabs: readonly OpenConversationTab[]): number {
  return tabs.reduce((max, tab) => (tab.lastActiveAt > max ? tab.lastActiveAt : max), 0);
}

function sameMeta(tab: OpenConversationTab, descriptor: ConversationTabDescriptor): boolean {
  return (
    tab.kind === descriptor.kind &&
    tab.projectId === descriptor.projectId &&
    tab.title === descriptor.title
  );
}

// 打开一条会话 tab（激活 + 加入集合）。
// - 已在集合：只激活（把 lastActiveAt 提到 now，成为「最前」）并顺手刷元数据；若它本就是最前且元数据未变，
//   原引用返回（幂等）——这条是渲染回路里被反复调用还不炸的关键（见 shell.ts renderSessStrip 注释）。
// - 不在集合：追加到末尾；若超限，挤掉「最久未激活」的一条（排除刚打开的这条，它 now 最大本就不会被选中）。
// now 必须单调递增（shell 用一个自增序号喂进来），保证被激活的 tab 唯一最大。
export function openConversationTab(
  tabs: readonly OpenConversationTab[],
  descriptor: ConversationTabDescriptor,
  now: number
): OpenConversationTab[] {
  const index = tabs.findIndex((tab) => tab.conversationId === descriptor.conversationId);
  if (index !== -1) {
    const existing = tabs[index]!;
    const alreadyFront = existing.lastActiveAt >= maxLastActiveAt(tabs);
    if (alreadyFront && sameMeta(existing, descriptor)) {
      return tabs as OpenConversationTab[];
    }
    const next = tabs.slice();
    next[index] = makeTab(descriptor, existing.unread, now);
    return next;
  }
  const appended: OpenConversationTab[] = [...tabs, makeTab(descriptor, 0, now)];
  if (appended.length <= MAX_OPEN_CONVERSATION_TABS) {
    return appended;
  }
  let evictId: string | undefined;
  let evictAt = Infinity;
  for (const tab of appended) {
    if (tab.conversationId === descriptor.conversationId) {
      continue;
    }
    if (tab.lastActiveAt < evictAt) {
      evictAt = tab.lastActiveAt;
      evictId = tab.conversationId;
    }
  }
  return appended.filter((tab) => tab.conversationId !== evictId);
}

// 关闭一条 tab（点 x）。返回移除后的集合 + 应当被激活的邻居会话 id（供调用方在「关的是当前活跃」时切过去）。
// 邻居优先取右侧（关掉后原 index 位置正好是右邻），没有右邻取左邻；集合关空则邻居为 undefined。
export function closeConversationTab(
  tabs: readonly OpenConversationTab[],
  conversationId: string
): { tabs: OpenConversationTab[]; neighborConversationId: string | undefined } {
  const index = tabs.findIndex((tab) => tab.conversationId === conversationId);
  if (index === -1) {
    return { tabs: tabs as OpenConversationTab[], neighborConversationId: undefined };
  }
  const next = tabs.filter((tab) => tab.conversationId !== conversationId);
  const neighbor = next[index] ?? next[index - 1];
  return { tabs: next, neighborConversationId: neighbor?.conversationId };
}

// refreshTabs 的活数据上下文——当前选中项目的 vm、全局 DM 列表、当前 viewer。
export type TabLiveContext = {
  selectedProjectId: string | undefined;
  vm: WorkbenchPageVM | undefined;
  dmList: readonly DmListItemVM[];
  dmListReady: boolean;
  currentUserId: string | undefined;
};

type TabResolution = OpenConversationTab | "prune";

function withTitleUnread(tab: OpenConversationTab, title: string, unread: number): OpenConversationTab {
  if (tab.title === title && tab.unread === unread) {
    return tab;
  }
  return { ...tab, title, unread };
}

function resolveTab(tab: OpenConversationTab, ctx: TabLiveContext): TabResolution {
  if (tab.kind === "dm") {
    const dm = ctx.dmList.find((item) => item.conversation.id === tab.conversationId);
    if (dm) {
      const peer = dmPeerParticipant(dm, ctx.currentUserId);
      const title = peer?.nickname ?? tab.title;
      return withTitleUnread(tab, title, dm.conversation.unread_count ?? 0);
    }
    // DM 列表已就绪却查不到这条——会话对本 actor 不再可见，静默剔除；列表还没拉到就先留着快照。
    return ctx.dmListReady ? "prune" : tab;
  }
  // main / collab：只有当 tab 属于「当前已加载的项目」时才拿 vm 校验/刷新；其它项目的 tab 留着快照
  //（vm 不在手，既不能确认失效也不能读未读，保守保留，点它时走 selectProject 重挂，失效会在到达那个项目
  // 时才被剔除）。
  if (tab.projectId === ctx.selectedProjectId && ctx.vm) {
    const conversation = ctx.vm.conversations.conversations.find((item) => item.id === tab.conversationId);
    if (!conversation) {
      return "prune";
    }
    const title = tab.kind === "main" ? ctx.vm.project.name : conversation.title;
    return withTitleUnread(tab, title, conversation.unread_count ?? 0);
  }
  return tab;
}

// 从活数据刷新每条 tab 的标题/未读，并静默剔除已确认失效的（同项目里消失的会话 / 已就绪 DM 列表里没有的
// DM）。幂等：连续跑两次第二次一定返回同引用（渲染回路安全）。无变化时返回原引用，调用方据此判断要不要写回。
export function refreshTabs(tabs: readonly OpenConversationTab[], ctx: TabLiveContext): OpenConversationTab[] {
  let changed = false;
  const next: OpenConversationTab[] = [];
  for (const tab of tabs) {
    const resolved = resolveTab(tab, ctx);
    if (resolved === "prune") {
      changed = true;
      continue;
    }
    if (resolved !== tab) {
      changed = true;
    }
    next.push(resolved);
  }
  return changed ? next : (tabs as OpenConversationTab[]);
}
