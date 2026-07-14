// WorkHub 桌面 · R12 批7:打扰矩阵——决定一条工作台事件(消息/行动卡/派活问询/提议)在此刻应该
// 「窗内呈现 / Cuu 气泡 / 静默」。规则照 00-interaction-design.md §8「Cuu 打通」:
//   「主窗前台时事件只在窗内呈现;主窗最小化/后台时才走桌宠气泡+系统通知」
// 本文件把这条规则收窄到「会话」粒度(不是整窗):输入不是单纯的「窗口是否前台」,而是
// 「工作台窗口是否前台且正显示着这条事件所属的那个会话」——同一个窗口前台时,若用户开的是另一个
// 会话/视图,事件所在会话依然应该走气泡,不能被「反正窗口在前台」吞掉。
//
// 纯函数,不碰任何 I/O/DOM/Tauri API——真正的事件来源接线在 interrupt-broadcast.ts(工作台侧,发)与
// desktop-cuu-runtime.ts(桌宠/主窗侧,收)。

export type WorkbenchInterruptionCategory = "message" | "action_card" | "dispatch_ask" | "proposal";

export type WorkbenchInterruptionOutcome = "in_window" | "cuu_bubble" | "silent";

export type WorkbenchInterruptionInput = {
  /**
   * 只有「工作台窗口前台 且 用户正看着这条事件所属的会话」才算 true。窗口前台但看着别的会话/视图、
   * 或窗口根本不是前台(后台/最小化/未打开),都是 false——这两种falsy 情况在 00 §8 里都归为
   * 「不在窗内呈现」,该走气泡还是静默由 category 决定。
   */
  isForegroundAndWatching: boolean;
  category: WorkbenchInterruptionCategory;
};

// 未看着时仍然要打扰用户的类别——行动卡/派活问询/提议都是"有人等你或者已经替你做了决定"级别的信号,
// 值得弹气泡;普通聊天消息(message)大流量、群里人多(00 §2.3:"群里人多,不设等谁点头的实时确认"),
// 每条都弹气泡会把 Cuu 变成骚扰通知机——照 00 §9 的整体克制基调("绝不在群聊里刷报错"),不在场时
// 普通消息静默,只有 action_card/dispatch_ask/proposal 这类"终局/决策"信号才气泡。
const BUBBLES_WHEN_UNWATCHED: ReadonlySet<WorkbenchInterruptionCategory> = new Set([
  "action_card",
  "dispatch_ask",
  "proposal"
]);

export function decideWorkbenchInterruption(input: WorkbenchInterruptionInput): WorkbenchInterruptionOutcome {
  if (input.isForegroundAndWatching) {
    return "in_window";
  }
  return BUBBLES_WHEN_UNWATCHED.has(input.category) ? "cuu_bubble" : "silent";
}

// ── 事件类型 → 打扰矩阵类别 的分类器 ──────────────────────────────────────────────────
// 输入是"裸事件类型字符串"(WorkHubEvent.type / notification.type),不是解析过的强类型对象——
// 分类只看类型名,不掺业务字段判断,保持这层纯粹且和契约 schema 解耦(schema 校验在调用方做)。

export function classifyWorkbenchInterruptionCategory(input: {
  eventType?: string | undefined;
  notificationType?: string | undefined;
}): WorkbenchInterruptionCategory | undefined {
  const notificationType = input.notificationType?.trim();
  if (notificationType === "action_card_item.dispatch_ask") {
    return "dispatch_ask";
  }
  if (notificationType && /^proposal\./u.test(notificationType)) {
    return "proposal";
  }

  const eventType = input.eventType?.trim();
  switch (eventType) {
    case "conversation.message.created":
      return "message";
    case "conversation.action_card.updated":
      return "action_card";
    case "proposal.opened":
    case "proposal.reviewed":
    case "proposal.merged":
    case "revision.fedback":
      return "proposal";
    default:
      return undefined;
  }
}

// ── 深链落点抽取 ──────────────────────────────────────────────────────────────────────
// 从一个宽松类型的事件/通知对象里尽量抠出 {projectId, conversationId}——两种真实来源都覆盖:
//   1) WorkHubEvent 信封:project_id 在顶层,conversation_id 嵌在 data 里(见 events.ts 的
//      conversationMessageCreatedEventSchema/conversationActionCardUpdatedEventSchema)。
//   2) Notification 行:project_id 在顶层;conversation_id 曾经是恒缺的诚实缺口(批7汇报)，
//      R14 FIX 批把它补上了——dispatch_ask 与 workitem.escalated/workitem.in_review 等里程碑通知
//      现在也会带上顶层 conversation_id(服务端从 target_url 查询参数解出，additive，见
//      apps/api/src/services/notifications.ts)。字段顶层/嵌套的判定逻辑不用跟着改：本来就先查
//      顶层再查 data，Notification 行的 conversation_id 恰好落在顶层分支。没有会话上下文的通知
//      类型这个字段依旧缺席，find 不到就该字段缺席,不伪造。
//      本函数被 desktop-cuu-runtime.ts 的 parseDesktopConversationNotification 复用，把
//      notification.created 事件深链进工作台会话(而不只是打开工作项页)。

export type WorkbenchDeepLinkTarget = {
  projectId?: string;
  conversationId?: string;
};

export function extractWorkbenchDeepLinkTarget(raw: unknown): WorkbenchDeepLinkTarget {
  const record = asRecord(raw);
  if (!record) {
    return {};
  }
  const data = asRecord(record.data);
  const projectId =
    stringField(record, "project_id") ??
    stringField(record, "projectId") ??
    stringField(data, "project_id") ??
    stringField(data, "projectId");
  const conversationId =
    stringField(record, "conversation_id") ??
    stringField(record, "conversationId") ??
    stringField(data, "conversation_id") ??
    stringField(data, "conversationId");
  return {
    ...(projectId ? { projectId } : {}),
    ...(conversationId ? { conversationId } : {})
  };
}

function asRecord(input: unknown): Record<string, unknown> | undefined {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : undefined;
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

// ── 骚扰控制:同一分组(会话/项目)60s 内合并计数 ─────────────────────────────────────────
// 照 00 §8 的克制基调,同一会话短时间内连续触发多条气泡worthy 事件时,只弹第一条,其余在窗口内合并
// 计数(供调用方将来把"已展示气泡"的角标数字往上翻,本批只做节流判定,不做 UI 合并渲染——见批7汇报)。
// 窗口过期后下一条重新起窗。

export type WorkbenchBubbleThrottleDecision = {
  surface: boolean;
  mergedCount: number;
};

export const DEFAULT_WORKBENCH_BUBBLE_THROTTLE_WINDOW_MS = 60_000;

export function createWorkbenchBubbleMergeThrottle(
  options: { windowMs?: number; now?: () => number } = {}
): { evaluate: (groupKey: string) => WorkbenchBubbleThrottleDecision; reset: (groupKey?: string) => void } {
  const windowMs = options.windowMs ?? DEFAULT_WORKBENCH_BUBBLE_THROTTLE_WINDOW_MS;
  const now = options.now ?? (() => Date.now());
  const windows = new Map<string, { openedAt: number; count: number }>();

  return {
    evaluate(groupKey: string): WorkbenchBubbleThrottleDecision {
      const at = now();
      const existing = windows.get(groupKey);
      if (existing && at - existing.openedAt < windowMs) {
        existing.count += 1;
        return { surface: false, mergedCount: existing.count };
      }
      windows.set(groupKey, { openedAt: at, count: 1 });
      return { surface: true, mergedCount: 1 };
    },
    reset(groupKey) {
      if (groupKey) {
        windows.delete(groupKey);
      } else {
        windows.clear();
      }
    }
  };
}

// ── dedupe:同一 id 只弹一次 ────────────────────────────────────────────────────────────
// 形状照 client-tauri 既有的 ShellSystemNotificationDeduper(notify.rs):有上限的 FIFO 淘汰集合,
// 不是无界 Set——长驻进程(桌宠/主窗)不能无限堆内存。webview 侧目前没有等价 TS 实现,这里按同款
// 语义重新写一份(不是照抄 Rust 代码,是复用它的形状:cap + 插入序淘汰),不另起一套不同的口径。

export const DEFAULT_WORKBENCH_BUBBLE_DEDUPE_MAX_KEYS = 256;

export function createWorkbenchNotificationDeduper(
  options: { maxKeys?: number } = {}
): { shouldDeliver: (id: string) => boolean } {
  const maxKeys = options.maxKeys ?? DEFAULT_WORKBENCH_BUBBLE_DEDUPE_MAX_KEYS;
  const seen = new Set<string>();
  const order: string[] = [];

  return {
    shouldDeliver(id: string): boolean {
      if (maxKeys <= 0) {
        return true;
      }
      if (seen.has(id)) {
        return false;
      }
      seen.add(id);
      order.push(id);
      while (order.length > maxKeys) {
        const oldest = order.shift();
        if (oldest !== undefined) {
          seen.delete(oldest);
        }
      }
      return true;
    }
  };
}
