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
  markStreamClosed: (userId: string) => Promise<void>;
  forgetUser: (userId: string) => Promise<void>;
  getPresence: (userId: string) => Promise<PresenceState>;
  getPresenceMap: (userIds: string[]) => Promise<Record<string, PresenceState>>;
};
