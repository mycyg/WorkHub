// WorkHub 桌面 · R12 批7:工作台侧的打扰路由——把主区群聊 SSE 流(conversation.message.created /
// conversation.action_card.updated)接进打扰矩阵,决定是否要往其它窗口(桌宠/主窗)广播一条「该弹气泡了」
// 的信号。
//
// 为什么在工作台窗口里做,不在桌宠/主窗里做:client-tauri 的桌宠/主窗 SSE worker 目前只订阅
// `/api/push/stream/me`(见 client-tauri/src-tauri/src/sse.rs 的 startup_shell_sse_targets,本批
// 不许碰 client-tauri),conversation:<id> 话题的事件根本不会到那两个窗口——只有工作台窗口自己的
// chat/stream.ts(直连 `/api/push/stream/conversation/:id`)真的收得到这些事件。所以"看见事件"这一步
// 必须发生在工作台窗口;工作台窗口再把"该弹气泡"这个结论广播给其它窗口。
// 这个缺口(桌宠/主窗原生收不到会话事件)详细记在批7汇报的「Rust 侧待办」。
//
// 广播用 desktop-cuu-runtime.ts 已经导出的通用 Tauri 事件桥(resolveDesktopShellEmitter/
// resolveDesktopShellListen 用的同一个 __TAURI__.event.emit/listen),不新开一条协议;接收端在
// desktop-cuu-runtime.ts 里监听同一个新事件名("workbench-interrupt")。

import {
  conversationActionCardUpdatedEventSchema,
  conversationMessageCreatedEventSchema,
  type ConversationMessageVM
} from "@workhub/contracts";

import {
  classifyWorkbenchInterruptionCategory,
  createWorkbenchBubbleMergeThrottle,
  createWorkbenchNotificationDeduper,
  decideWorkbenchInterruption,
  type WorkbenchInterruptionCategory,
  type WorkbenchInterruptionOutcome
} from "./interruption-policy.js";

export type WorkbenchInterruptBroadcastPayload = {
  id: string;
  category: WorkbenchInterruptionCategory;
  projectId: string;
  conversationId: string;
  title: string;
  message: string;
  createdAt: string;
};

export type WorkbenchInterruptEmit = (
  eventName: "workbench-interrupt",
  payload: WorkbenchInterruptBroadcastPayload
) => void | Promise<void>;

type ParsedInterruptEvent = {
  id: string;
  category: WorkbenchInterruptionCategory;
  projectId: string;
  conversationId: string;
  title: string;
  message: string;
  createdAt: string;
};

const FALLBACK_COPY = {
  "zh-CN": {
    messageTitle: "项目群聊",
    actionCardTitle: "Cuu 行动卡",
    actionCardBody: (itemCount: number) => `Cuu 整理出了 ${itemCount} 件事，等你看一眼。`,
    genericMessageBody: "有新消息。"
  },
  "en-US": {
    messageTitle: "Team chat",
    actionCardTitle: "Cuu action card",
    actionCardBody: (itemCount: number) => `Cuu pulled ${itemCount} item(s) out of the discussion — take a look.`,
    genericMessageBody: "New message."
  }
} as const;

// 工作台侧看到的窗口前台态:因为一个工作台窗口当前只挂载"一个"会话视图(批2/4a现状——协同会话/网盘等
// 并行视图要等批4/5/6),"是否正看着这条事件所属的会话"在这里退化成"这个窗口本身是否前台"。等未来
// 批次让工作台在同一窗口内并行呈现多个会话/视图时,这个简化需要重新评估(会话粒度的判断要接进来)——
// 已写进批7汇报的已知简化项，不是伪装成"更精细"的判断。
export function createWorkbenchInterruptBroadcaster(options: {
  emit: WorkbenchInterruptEmit;
  isForeground: () => Promise<boolean> | boolean;
  locale?: "zh-CN" | "en-US";
  now?: () => number;
  throttleWindowMs?: number;
  maxDedupeKeys?: number;
}): { handleRawConversationEvent: (raw: unknown) => Promise<WorkbenchInterruptionOutcome | undefined> } {
  const locale = options.locale ?? "zh-CN";
  const throttle = createWorkbenchBubbleMergeThrottle({
    ...(options.throttleWindowMs !== undefined ? { windowMs: options.throttleWindowMs } : {}),
    ...(options.now ? { now: options.now } : {})
  });
  const deduper = createWorkbenchNotificationDeduper(
    options.maxDedupeKeys !== undefined ? { maxKeys: options.maxDedupeKeys } : {}
  );

  return {
    async handleRawConversationEvent(raw: unknown): Promise<WorkbenchInterruptionOutcome | undefined> {
      const parsed = parseConversationInterruptEvent(raw, locale);
      if (!parsed) {
        return undefined;
      }

      // isForeground() 拿不到结果(no Tauri isFocused()/capabilities 缺口/查询本身抛错)时默认当作
      // "前台"——宁可少弹一次气泡(退化成"照常按窗内呈现处理,不额外广播"),也不要在无法判断前台状态
      // 时误判成背景乱弹气泡骚扰用户。
      const isForegroundAndWatching = await Promise.resolve(options.isForeground()).catch(() => true);
      const outcome = decideWorkbenchInterruption({ isForegroundAndWatching, category: parsed.category });
      if (outcome !== "cuu_bubble") {
        return outcome;
      }
      if (!deduper.shouldDeliver(parsed.id)) {
        return outcome;
      }
      // 骚扰控制:同会话 60s 内已经弹过一条,这条合并计数,不再往其它窗口广播一条新气泡
      // (合并数字目前只做节流判定，尚未接回 UI 角标——见批7汇报「未做」)。
      const throttleDecision = throttle.evaluate(parsed.conversationId);
      if (!throttleDecision.surface) {
        return outcome;
      }

      await Promise.resolve(
        options.emit("workbench-interrupt", {
          id: parsed.id,
          category: parsed.category,
          projectId: parsed.projectId,
          conversationId: parsed.conversationId,
          title: parsed.title,
          message: parsed.message,
          createdAt: parsed.createdAt
        })
      );
      return outcome;
    }
  };
}

function parseConversationInterruptEvent(raw: unknown, locale: "zh-CN" | "en-US"): ParsedInterruptEvent | undefined {
  const copy = FALLBACK_COPY[locale];

  const messageEvent = conversationMessageCreatedEventSchema.safeParse(raw);
  if (messageEvent.success) {
    const event = messageEvent.data;
    const category = classifyWorkbenchInterruptionCategory({ eventType: event.type });
    if (!category) {
      return undefined;
    }
    return {
      id: event.event_id,
      category,
      projectId: event.project_id,
      conversationId: event.data.conversation_id,
      title: copy.messageTitle,
      message: event.preview_text ?? messageBodyPreview(event.data, copy.genericMessageBody),
      createdAt: event.ts
    };
  }

  const actionCardEvent = conversationActionCardUpdatedEventSchema.safeParse(raw);
  if (actionCardEvent.success) {
    const event = actionCardEvent.data;
    const category = classifyWorkbenchInterruptionCategory({ eventType: event.type });
    if (!category) {
      return undefined;
    }
    return {
      id: event.event_id,
      category,
      projectId: event.project_id,
      conversationId: event.data.conversation_id,
      title: copy.actionCardTitle,
      message: event.preview_text ?? copy.actionCardBody(event.data.items.length),
      createdAt: event.ts
    };
  }

  return undefined;
}

function messageBodyPreview(data: ConversationMessageVM, fallback: string): string {
  if (data.kind === "text") {
    return data.content.text.slice(0, 200);
  }
  return fallback;
}
