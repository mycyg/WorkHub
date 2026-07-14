// WorkHub 桌面 · 主区群聊消息流的纯函数部分：排序去重（seq 是权威顺序）、按天分隔、时间格式化、
// 行动卡条目状态就地更新。不含任何 DOM/网络——render.ts 消费这里的输出拼 HTML，view.ts 负责拉数据喂进来。

import type { AiFeedbackVerdict, ConversationMessageReactionVM, ConversationMessageVM, MyAiFeedbackVM } from "@workhub/contracts";

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
//
// R12 P0-A1：这个合并函数也是 decide/undo 的 HTTP 响应落地的地方——SSE 事件契约（strict schema）
// 只带 {id,status}，但 decide/undo 的响应是 ActionCardItemVM，多带 assignee_user_id/undo_deadline_at。
// assigneeUserId/undoDeadlineAt 是可选字段：SSE 调用点不传（undefined）→ 完全不碰这两个键，行为和
// 批3落地时一模一样；HTTP 响应调用点会传，按需覆盖快照里对应的 assignee_user_id/undo_deadline_at。
export type ActionCardItemStatusPatch = {
  id: string;
  status: string;
  assigneeUserId?: string | null;
  undoDeadlineAt?: string | null;
};

export type ActionCardUpdatePatch = {
  messageId: string;
  items: ReadonlyArray<ActionCardItemStatusPatch>;
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
  const patchById = new Map(patch.items.map((item) => [item.id, item]));
  let changed = false;
  const nextItems = rawItems.map((raw) => {
    if (!raw || typeof raw !== "object") {
      return raw;
    }
    const item = raw as SnapshotItem;
    const id = item["id"];
    const itemPatch = typeof id === "string" ? patchById.get(id) : undefined;
    if (!itemPatch) {
      return raw;
    }
    patchById.delete(id as string);
    const statusChanged = item["status"] !== itemPatch.status;
    const assigneeChanged =
      itemPatch.assigneeUserId !== undefined && item["assignee_user_id"] !== itemPatch.assigneeUserId;
    const undoDeadlineChanged =
      itemPatch.undoDeadlineAt !== undefined && item["undo_deadline_at"] !== itemPatch.undoDeadlineAt;
    if (!statusChanged && !assigneeChanged && !undoDeadlineChanged) {
      return raw;
    }
    changed = true;
    return {
      ...item,
      status: itemPatch.status,
      ...(itemPatch.assigneeUserId !== undefined ? { assignee_user_id: itemPatch.assigneeUserId } : {}),
      ...(itemPatch.undoDeadlineAt !== undefined ? { undo_deadline_at: itemPatch.undoDeadlineAt } : {})
    };
  });
  // 事件里剩下没消化掉的条目 id = 快照里没有的新条目（观察者追加）——快照过期，需要补拉。
  const snapshotStale = patchById.size > 0;
  if (!changed) {
    return { messages: [...messages], changed: false, snapshotStale };
  }
  const next = [...messages];
  next[index] = { ...target, content: { ...target.content, items: nextItems } } as ConversationMessageVM;
  return { messages: next, changed: true, snapshotStale };
}

// R12 P0-A1：decide/undo 成功后，调用方（view.ts）只知道被点的条目 id，不知道它挂在哪条 action_card
// 消息下——扫描本地消息快照的 content.items 找归属（不落网络请求，纯内存查找；找不到就是本地还没有
// 这条卡消息，调用方据此走 reconcileGap 的既有补拉路径，同 applyActionCardUpdate 对「本地没有」的处理）。
export function findActionCardMessageIdForItem(
  messages: readonly ConversationMessageVM[],
  itemId: string
): string | undefined {
  for (const message of messages) {
    if (message.kind !== "action_card") {
      continue;
    }
    const rawItems = Array.isArray(message.content["items"]) ? (message.content["items"] as unknown[]) : [];
    const hit = rawItems.some((raw) => Boolean(raw) && typeof raw === "object" && (raw as SnapshotItem)["id"] === itemId);
    if (hit) {
      return message.id;
    }
  }
  return undefined;
}

// R13 批 P2（拍板链路收尾）：dispatch_ask 追赶提醒点击后想跳到"对应行动卡"，但通知只带
// work_item_id/conversation_id——服务端 buildActionCardMessageContent 的 itemSummary 从来没把
// work_item_id 塞进消息 content（这批范围围栏不碰 packages/db，见 dispatch-ask-catchup.ts 顶部
// 注释的取舍说明），没有可靠的条目 id 可以直接比对。退而求其次：dispatch_ask 通知的 body 字段
// 就是建卡时的 planItem.title_md（见 apps/api/src/workers/conversation-observer.ts 的
// dispatchExecuteItem），和卡片条目的 title_md 同源同值——用精确文本匹配做最佳努力定位；
// 找不到（标题被后续追加改写/已经翻页翻出了本地窗口）就让调用方老实地退化成"滚到会话顶部"，
// 不假装总能精确定位。
export function findActionCardMessageIdByTitle(
  messages: readonly ConversationMessageVM[],
  titleMd: string
): string | undefined {
  const needle = titleMd.trim();
  if (!needle) {
    return undefined;
  }
  for (const message of messages) {
    if (message.kind !== "action_card") {
      continue;
    }
    const rawItems = Array.isArray(message.content["items"]) ? (message.content["items"] as unknown[]) : [];
    const hit = rawItems.some(
      (raw) => Boolean(raw) && typeof raw === "object" && (raw as SnapshotItem)["title_md"] === needle
    );
    if (hit) {
      return message.id;
    }
  }
  return undefined;
}

// R14 批 CHAT：conversation.message.updated（编辑/删除/置顶/取消置顶）落地——按 id 整条替换本地快照
// （data=变更后全量 VM，见契约注释）。保持 seq 不变（编辑/删除/置顶都不动 seq），所以不需要重排；
// 本地没有这条 id（观察者补拉边界/翻页还没加载到）→ unknownId=true，调用方据此走既有的定点补拉/reconcile
// 路径（同 applyActionCardUpdate 对「本地没有」的处理）。changed=false 表示同 id 消息内容逐字节相同，
// 调用方可据此跳过重渲。
export type ApplyMessageReplacementResult = {
  messages: ConversationMessageVM[];
  changed: boolean;
  unknownId: boolean;
};

export function applyMessageReplacement(
  messages: readonly ConversationMessageVM[],
  updated: ConversationMessageVM
): ApplyMessageReplacementResult {
  const index = messages.findIndex((message) => message.id === updated.id);
  if (index < 0) {
    return { messages: [...messages], changed: false, unknownId: true };
  }
  const existing = messages[index]!;
  if (JSON.stringify(existing) === JSON.stringify(updated)) {
    return { messages: [...messages], changed: false, unknownId: false };
  }
  const next = [...messages];
  next[index] = updated;
  return { messages: next, changed: true, unknownId: false };
}

// R14 批 CHAT：conversation.reaction.updated 落地——用事件里的全量聚合（幂等替换）覆盖本地这条消息的
// reactions 字段。谁加谁减不影响最终态。空数组表示这条消息现在一个反应都没有了——写入空数组（而不是
// 删掉字段），渲染层据此不渲染 reaction 行（reactions?.length 为 0）。本地没有这条消息 → unknownId=true，
// 调用方据此补拉（同 applyMessageReplacement）。
export type ApplyReactionUpdateResult = {
  messages: ConversationMessageVM[];
  changed: boolean;
  unknownId: boolean;
};

export function applyReactionUpdate(
  messages: readonly ConversationMessageVM[],
  patch: { messageId: string; reactions: readonly ConversationMessageReactionVM[] }
): ApplyReactionUpdateResult {
  const index = messages.findIndex((message) => message.id === patch.messageId);
  if (index < 0) {
    return { messages: [...messages], changed: false, unknownId: true };
  }
  const existing = messages[index]!;
  const nextReactions = patch.reactions.map((reaction) => ({ key: reaction.key, user_ids: [...reaction.user_ids] }));
  if (JSON.stringify(existing.reactions ?? []) === JSON.stringify(nextReactions)) {
    return { messages: [...messages], changed: false, unknownId: false };
  }
  const next = [...messages];
  next[index] = { ...existing, reactions: nextReactions };
  return { messages: next, changed: true, unknownId: false };
}

// R14 批 FEEDBACK：Cuu 文字消息的本人反馈——乐观 PUT/DELETE 落地（同 applyReactionUpdate 的「本地没有
// 这条消息→unknownId」处理）。反馈没有 SSE（见 04-feedback-design.md §0 结论 3/§9），unknownId 这里
// 只在极端竞态下出现（比如反馈发生在一条刚被本地移除的墓碑消息上）。feedback=undefined 表示「本地视图
// 里现在没有反馈」（DELETE 落地）。exactOptionalPropertyTypes 下用 delete 摘掉 my_feedback 键而不是把它
// 设成 undefined——键要么不出现，要么真有值。
export type ApplyMessageFeedbackUpdateResult = {
  messages: ConversationMessageVM[];
  changed: boolean;
  unknownId: boolean;
};

export function applyMessageFeedbackUpdate(
  messages: readonly ConversationMessageVM[],
  patch: { messageId: string; feedback: MyAiFeedbackVM | undefined }
): ApplyMessageFeedbackUpdateResult {
  const index = messages.findIndex((message) => message.id === patch.messageId);
  if (index < 0) {
    return { messages: [...messages], changed: false, unknownId: true };
  }
  const existing = messages[index]!;
  if (JSON.stringify(existing.my_feedback ?? null) === JSON.stringify(patch.feedback ?? null)) {
    return { messages: [...messages], changed: false, unknownId: false };
  }
  const base = { ...existing } as Record<string, unknown>;
  delete base["my_feedback"];
  const updated = (patch.feedback ? { ...base, my_feedback: patch.feedback } : base) as ConversationMessageVM;
  const next = [...messages];
  next[index] = updated;
  return { messages: next, changed: true, unknownId: false };
}

// R14 批 FEEDBACK：行动卡条目反馈——本人对某个条目的判定，读时合并进 content.items[i].feedback（per-user，
// 不落 DB 共享快照，见 04-feedback-design.md §5.3）。落地方式镜像 applyActionCardUpdate：按 id 找归属
// 消息，就地替换命中条目的 feedback 键，其余条目原样透传。itemId 在本地任何 action_card 消息里都找不到
// →unknownId=true（同 findActionCardMessageIdForItem 对「本地没有」的既有处理）。
export type ApplyActionCardItemFeedbackUpdateResult = {
  messages: ConversationMessageVM[];
  changed: boolean;
  unknownId: boolean;
};

export function applyActionCardItemFeedbackUpdate(
  messages: readonly ConversationMessageVM[],
  patch: { itemId: string; feedback: { verdict: AiFeedbackVerdict; note?: string } | undefined }
): ApplyActionCardItemFeedbackUpdateResult {
  const messageId = findActionCardMessageIdForItem(messages, patch.itemId);
  if (!messageId) {
    return { messages: [...messages], changed: false, unknownId: true };
  }
  const index = messages.findIndex((message) => message.id === messageId);
  const target = messages[index]! as Extract<ConversationMessageVM, { kind: "action_card" }>;
  const rawItems = Array.isArray(target.content["items"]) ? (target.content["items"] as unknown[]) : [];
  let changed = false;
  const nextItems = rawItems.map((raw) => {
    if (!raw || typeof raw !== "object") {
      return raw;
    }
    const item = raw as SnapshotItem;
    if (item["id"] !== patch.itemId) {
      return raw;
    }
    if (JSON.stringify(item["feedback"] ?? null) === JSON.stringify(patch.feedback ?? null)) {
      return raw;
    }
    changed = true;
    const nextItem: SnapshotItem = { ...item };
    if (patch.feedback) {
      nextItem["feedback"] = patch.feedback;
    } else {
      delete nextItem["feedback"];
    }
    return nextItem;
  });
  if (!changed) {
    return { messages: [...messages], changed: false, unknownId: false };
  }
  const next = [...messages];
  next[index] = { ...target, content: { ...target.content, items: nextItems } } as ConversationMessageVM;
  return { messages: next, changed: true, unknownId: false };
}

// R14 批 FEEDBACK：从本地消息快照读出「本人对这个行动卡条目的当前判定」——toggle 处理器据此算
// decideFeedbackToggle 的 current 参数，不需要额外网络往返（同 findActionCardMessageIdForItem 的
// 「纯内存查找」取舍）。找不到条目 / 条目没有 feedback / feedback 形状不认识都返回 undefined（没有
// 判定，不是报错——04 §4 铁律 3 的延伸：没把握的形状不瞎猜）。
export function findActionCardItemFeedbackVerdict(
  messages: readonly ConversationMessageVM[],
  itemId: string
): AiFeedbackVerdict | undefined {
  for (const message of messages) {
    if (message.kind !== "action_card") {
      continue;
    }
    const rawItems = Array.isArray(message.content["items"]) ? (message.content["items"] as unknown[]) : [];
    for (const raw of rawItems) {
      if (!raw || typeof raw !== "object") {
        continue;
      }
      const item = raw as SnapshotItem;
      if (item["id"] !== itemId) {
        continue;
      }
      const feedback = item["feedback"];
      if (!feedback || typeof feedback !== "object") {
        return undefined;
      }
      const verdict = (feedback as SnapshotItem)["verdict"];
      return verdict === "useful" || verdict === "not_useful" ? verdict : undefined;
    }
  }
  return undefined;
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

// R12 P0-A1：行动卡「执行」条目的撤销按钮要带一个「还剩几分钟」的提示——纯函数，渲染时刻为准，
// 不开倒计时 interval（过期后用户点了由服务端 409 兜底并温和提示，见 turn.ts 同款「不本地假装
// 权威」的取舍）。向上取整：剩 0.1 分钟也显示「1 分钟」而不是「0 分钟」，不假装比实际更紧迫。
// 无效时间戳或已过期（deadline <= now）一律返回 undefined——调用方据此不渲染撤销按钮，而不是
// 渲染一个「0 分钟」的死按钮。
export function computeUndoRemainingMinutes(undoDeadlineAtIso: string, nowMs: number): number | undefined {
  const deadlineMs = Date.parse(undoDeadlineAtIso);
  if (!Number.isFinite(deadlineMs)) {
    return undefined;
  }
  const diffMs = deadlineMs - nowMs;
  if (diffMs <= 0) {
    return undefined;
  }
  return Math.ceil(diffMs / 60_000);
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

// R14 批 PERF（切片②：渲染窗封顶）：窗口只增不减会让长会话里"翻过一次历史"这个动作的代价长期背在
// 每一次后续渲染上（renderWindowSize 只有 +=，进程生命周期内永不回落）——加一个上限，超过上限就不再放大
// （宁可让最上面那批消息重新折叠回"本地未展开"态，用户可以再点一次「加载更早」展开）。900 的取值见
// 08-perf-design.md §2.2 的基准表支撑：900 窗口纯字符串拼装 ~46ms，只发生在低频的主动翻页/跳转上、且
// 本身有 loading 态铺垫，可接受；再往上（1800/3000）耗时不可接受。这个数字标了真机复核（§3 方案 C），
// 先当一个有理由的起点。
export const MAX_MESSAGE_RENDER_WINDOW = 900;

export function capRenderWindowSize(size: number, cap: number = MAX_MESSAGE_RENDER_WINDOW): number {
  return Math.min(size, cap);
}

// R14 批 PERF（切片②：回缩）：用户真的贴底回到"看最新"的状态时，没有理由继续背着一个被翻页撑大的
// 窗口——收回默认值，下一次翻页需求发生时会重新按需撑大，不是一次性代价。只在贴底且当前确实撑大过
// （currentSize > fallback）时回缩，否则原样返回（不贴底不动、已经是默认值也不动）。
export function maybeShrinkRenderWindowSize(
  currentSize: number,
  wasNearBottom: boolean,
  fallback: number = DEFAULT_MESSAGE_RENDER_WINDOW
): number {
  return wasNearBottom && currentSize > fallback ? fallback : currentSize;
}
