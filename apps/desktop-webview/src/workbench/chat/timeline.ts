// WorkHub 桌面 · 主区群聊消息流的纯函数部分：排序去重（seq 是权威顺序）、按天分隔、时间格式化、
// 行动卡条目状态就地更新。不含任何 DOM/网络——render.ts 消费这里的输出拼 HTML，view.ts 负责拉数据喂进来。

import type { ConversationMessageVM } from "@workhub/contracts";

type Locale = "zh-CN" | "en-US";

// 批 0 的 UNIQUE(conversation_id, seq) 是权威排序键；同一条消息可能因为首屏分页拉取 + SSE 实时事件
// 重叠而重复出现——按 id 去重（后到的覆盖先到的：SSE 增量事件应该比分页快照更新，虽然内容通常一样），
// 再按 seq 升序排列。
export function sortAndDedupeMessages(messages: readonly ConversationMessageVM[]): ConversationMessageVM[] {
  const byId = new Map<string, ConversationMessageVM>();
  for (const message of messages) {
    byId.set(message.id, message);
  }
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

// R12 行动卡状态回流：把 conversation.action_card.updated 事件里的条目状态，合并进本地持有的那条
// action_card 消息的 content 快照（快照是建卡/追加时的时点数据，decide/undo 之后服务端不重写它，
// 实时状态只走这个事件）。规则：
//  - 只按条目 id 改 status，绝不增删条目（00 §9「不删卡」留痕；事件也不带 title_md，凭空加渲染不出标题）；
//  - 消息不在本地、或事件里出现快照没有的条目 id → snapshotStale=true，调用方按需重拉这条消息
//    （观察者建卡/追加时会在服务端重写快照，但不重发 message.created——只能补拉）；
//  - changed=false 表示没有任何条目状态真的变了，调用方可据此跳过重渲。
export type ActionCardUpdatePatch = {
  messageId: string;
  items: ReadonlyArray<{ id: string; status: string }>;
};

export type ApplyActionCardUpdateResult = {
  messages: ConversationMessageVM[];
  changed: boolean;
  snapshotStale: boolean;
};

type SnapshotItem = Record<string, unknown>;

export function applyActionCardUpdate(
  messages: readonly ConversationMessageVM[],
  patch: ActionCardUpdatePatch
): ApplyActionCardUpdateResult {
  const index = messages.findIndex((message) => message.id === patch.messageId && message.kind === "action_card");
  if (index < 0) {
    return { messages: [...messages], changed: false, snapshotStale: true };
  }
  // findIndex 已经筛过 kind === "action_card"，这里只是把窄化结果告诉 TS（content 才可按键索引）。
  const target = messages[index]! as Extract<ConversationMessageVM, { kind: "action_card" }>;
  const rawItems = Array.isArray(target.content["items"]) ? (target.content["items"] as unknown[]) : [];
  const statusById = new Map(patch.items.map((item) => [item.id, item.status]));
  let changed = false;
  const nextItems = rawItems.map((raw) => {
    if (!raw || typeof raw !== "object") {
      return raw;
    }
    const item = raw as SnapshotItem;
    const id = item["id"];
    const nextStatus = typeof id === "string" ? statusById.get(id) : undefined;
    if (nextStatus === undefined || item["status"] === nextStatus) {
      if (typeof id === "string") {
        statusById.delete(id);
      }
      return raw;
    }
    changed = true;
    statusById.delete(id as string);
    return { ...item, status: nextStatus };
  });
  // 事件里剩下没消化掉的条目 id = 快照里没有的新条目（观察者追加）——快照过期，需要补拉。
  const snapshotStale = statusById.size > 0;
  if (!changed) {
    return { messages: [...messages], changed: false, snapshotStale };
  }
  const next = [...messages];
  next[index] = { ...target, content: { ...target.content, items: nextItems } } as ConversationMessageVM;
  return { messages: next, changed: true, snapshotStale };
}

export type DayGroup = {
  dateKey: string;
  label: string;
  messages: ConversationMessageVM[];
};

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function weekdayLabel(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date);
}

function dayLabel(date: Date, locale: Locale, now: Date): string {
  const key = localDateKey(date);
  const todayKey = localDateKey(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = localDateKey(yesterday);
  const weekday = weekdayLabel(date, locale);
  if (key === todayKey) {
    return locale === "zh-CN" ? `今天 · ${weekday}` : `Today · ${weekday}`;
  }
  if (key === yesterdayKey) {
    return locale === "zh-CN" ? `昨天 · ${weekday}` : `Yesterday · ${weekday}`;
  }
  if (locale === "zh-CN") {
    return `${date.getMonth() + 1}月${date.getDate()}日 · ${weekday}`;
  }
  const month = new Intl.DateTimeFormat(locale, { month: "short" }).format(date);
  return `${month} ${date.getDate()} · ${weekday}`;
}

// messages 必须已经按 seq 升序（调用方先过 sortAndDedupeMessages）。同一天的连续消息聚成一组，
// 组的顺序 = 消息本身的顺序（不额外排序），避免和上游的 seq 权威顺序打架。
export function groupMessagesByDay(
  messages: readonly ConversationMessageVM[],
  input: { locale: Locale; now?: Date }
): DayGroup[] {
  const now = input.now ?? new Date();
  const groups: DayGroup[] = [];
  for (const message of messages) {
    const created = new Date(message.created_at);
    const dateKey = localDateKey(created);
    const current = groups[groups.length - 1];
    if (current && current.dateKey === dateKey) {
      current.messages.push(message);
      continue;
    }
    groups.push({ dateKey, label: dayLabel(created, input.locale, now), messages: [message] });
  }
  return groups;
}

export function formatMessageTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

// R12 批8：消息列表窗口化——不引第三方虚拟滚动库，做最简单的"只挂载最近 N 条到 DOM"。messages 必须
// 已经按 seq 升序（同 groupMessagesByDay 的前置条件）。更早的那些留在内存（messages 数组本身不截断，
// 仍然是翻页/去重/SSE 合并的权威数据源），只是不进 DOM——render.ts 在它们前面渲染一个折叠占位，
// view.ts 的点击/滚动到顶事件把 windowSize 调大来展开，不需要重新请求网络。
export const DEFAULT_MESSAGE_RENDER_WINDOW = 300;

export type MessageWindow<T> = {
  visible: T[];
  hiddenLocalCount: number;
};

export function windowRecentMessages<T>(
  messages: readonly T[],
  windowSize: number = DEFAULT_MESSAGE_RENDER_WINDOW
): MessageWindow<T> {
  const size = Math.max(0, Math.trunc(windowSize));
  const start = Math.max(0, messages.length - size);
  return { visible: messages.slice(start), hiddenLocalCount: start };
}
