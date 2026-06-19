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
};
