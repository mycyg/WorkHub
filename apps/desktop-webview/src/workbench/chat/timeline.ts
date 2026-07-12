// WorkHub 桌面 · 主区群聊消息流的纯函数部分：排序去重（seq 是权威顺序）、按天分隔、时间格式化。
// 不含任何 DOM/网络——render.ts 消费这里的输出拼 HTML，view.ts 负责拉数据喂进来。

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
