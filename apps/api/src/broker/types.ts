import type { PushEvent } from "@workhub/events";

export type PushSubscription<T = unknown> = AsyncIterable<PushEvent<T>> & {
  topic: string;
  close: () => Promise<void>;
};

export type PushBus = {
  backend: "memory" | "redis";
  subscribe: (topic: string) => Promise<PushSubscription>;
  unsubscribe: (topic: string, subscription: PushSubscription) => Promise<void>;
  publish: <T = unknown>(topic: string, type: string, data: T) => Promise<void>;
  close?: () => Promise<void>;
};

export type PresenceState = {
  is_online: boolean;
  last_seen_at?: Date;
};

export type PresenceStore = {
  touchUser: (userId: string) => Promise<void>;
  markStreamOpen: (userId: string) => Promise<void>;
  // 审计 FIX#2(a)：刷新一个「持续活跃」流的在线状态——同时续期 lastseen 与 streams 计数键的 TTL。
  // 持续有事件（间隔 <30s 永不空闲 → 永不走心跳）的流不刷任一键，两键都会在 120s TTL 到期，
  // is_online 在用户正盯着看时误转 false。SSE 写出真事件时按节流（>~30s）调用本方法续期。
  refreshStream: (userId: string) => Promise<void>;
  markStreamClosed: (userId: string) => Promise<void>;
  forgetUser: (userId: string) => Promise<void>;
  getPresence: (userId: string) => Promise<PresenceState>;
  getPresenceMap: (userIds: string[]) => Promise<Record<string, PresenceState>>;
  // R15 批 A（A5 在线抑制）：会话级「正在看」注册表——某用户是否持有某会话的实时 SSE 订阅
  // （GET /api/push/stream/conversation/:id）。桌面 OS 桥只订 /stream/me（收 notification.created），
  // conversation.message.created 只在客户端打开了该会话流时才收得到——所以「持有该会话流」正是
  // 「此刻正在看这条会话」的精确信号（粗粒度的 is_online 会把「后台/锁屏但流还开着」误判成正在看，
  // 反而扼杀 OS 通知的主用例，见 conversation-message-notify.ts 的取舍注释）。引用计数（同一用户多窗
  // 各一条流）与 streams 计数同构。SSE 流打开/心跳续期/断开时维护，A5 通知生成时查询。
  markConversationViewer: (userId: string, conversationId: string) => Promise<void>;
  refreshConversationViewer: (userId: string, conversationId: string) => Promise<void>;
  markConversationViewerClosed: (userId: string, conversationId: string) => Promise<void>;
  isViewingConversation: (userId: string, conversationId: string) => Promise<boolean>;
};
