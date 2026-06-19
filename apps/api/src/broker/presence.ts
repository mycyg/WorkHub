import { createClient } from "redis";

import { settings as defaultSettings, type Settings } from "@workhub/config";

import type { PresenceState, PresenceStore } from "./types.js";

export const ONLINE_TTL_SECONDS = 120;

export type RedisSetOptions = {
  EX?: number;
};

export type RedisPresenceMulti = {
  set: (key: string, value: string, options?: RedisSetOptions) => RedisPresenceMulti;
  incr: (key: string) => RedisPresenceMulti;
  expire: (key: string, seconds: number) => RedisPresenceMulti;
  exec: () => Promise<unknown>;
};

export type RedisPresenceClient = {
  readonly isOpen: boolean;
  on: (event: "error", listener: (error: unknown) => void) => RedisPresenceClient;
  connect: () => Promise<void>;
  quit: () => Promise<void>;
  set: (key: string, value: string, options?: RedisSetOptions) => Promise<unknown>;
  multi: () => RedisPresenceMulti;
  get: (key: string) => Promise<string | null>;
  decr: (key: string) => Promise<number>;
  del: (keys: string | string[]) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<unknown>;
};

export type RedisPresenceClientFactory = (url: string) => RedisPresenceClient;

const createDefaultRedisPresenceClient: RedisPresenceClientFactory = (url) =>
  createClient({ url }) as unknown as RedisPresenceClient;

export class InMemoryPresenceStore implements PresenceStore {
  private lastSeen = new Map<string, Date>();
  private openStreams = new Map<string, number>();

  constructor(private readonly now = () => new Date()) {}

  async touchUser(userId: string) {
    this.lastSeen.set(userId, this.now());
  }

  async markStreamOpen(userId: string) {
    this.lastSeen.set(userId, this.now());
    this.openStreams.set(userId, (this.openStreams.get(userId) ?? 0) + 1);
  }

  // 审计 FIX#2(a)：内存实现里 streams 计数不带 TTL（getPresence 直接看计数 >0），故刷新只需续 lastSeen。
  // 保持与 Redis 实现同语义（活跃流不掉线）即可。
  async refreshStream(userId: string) {
    this.lastSeen.set(userId, this.now());
  }

  async markStreamClosed(userId: string) {
    this.lastSeen.set(userId, this.now());
    const nextCount = (this.openStreams.get(userId) ?? 0) - 1;
    if (nextCount <= 0) {
      this.openStreams.delete(userId);
      return;
    }
    this.openStreams.set(userId, nextCount);
  }

  async forgetUser(userId: string) {
    this.lastSeen.delete(userId);
    this.openStreams.delete(userId);
  }

  async getPresence(userId: string): Promise<PresenceState> {
    const lastSeenAt = this.lastSeen.get(userId);
    const recent = lastSeenAt
      ? this.now().getTime() - lastSeenAt.getTime() <= ONLINE_TTL_SECONDS * 1000
      : false;
    return {
      is_online: (this.openStreams.get(userId) ?? 0) > 0 || recent,
      ...(lastSeenAt ? { last_seen_at: lastSeenAt } : {})
    };
  }

  async getPresenceMap(userIds: string[]) {
    const output: Record<string, PresenceState> = {};
    for (const userId of userIds) {
      output[userId] = await this.getPresence(userId);
    }
    return output;
  }
}

export class RedisPresenceStore implements PresenceStore {
  private client: RedisPresenceClient | undefined;
  private connecting: Promise<void> | undefined;

  constructor(
    private readonly url: string,
    private readonly clientFactory: RedisPresenceClientFactory = createDefaultRedisPresenceClient,
    private readonly now = () => new Date()
  ) {
    if (!url) {
      throw new Error("BROKER_URL is required for Redis presence");
    }
  }

  async touchUser(userId: string) {
    const client = await this.redis();
    await client.set(this.lastSeenKey(userId), this.now().toISOString(), { EX: ONLINE_TTL_SECONDS });
  }

  async markStreamOpen(userId: string) {
    const client = await this.redis();
    const streamKey = this.streamsKey(userId);
    await client.multi()
      .set(this.lastSeenKey(userId), this.now().toISOString(), { EX: ONLINE_TTL_SECONDS })
      .incr(streamKey)
      .expire(streamKey, ONLINE_TTL_SECONDS)
      .exec();
  }

  // 审计 FIX#2(a)：持续活跃的流（事件 <30s 一条，永不空闲走心跳）必须同时续 lastSeen 与 streams 计数键的
  // TTL，否则两键都到 120s 自然过期、is_online 在用户正在线时误转 false。SSE 写真事件时按节流调用此方法。
  // expire 在键不存在时是 no-op（活跃流的 streams 键本应仍在；即便恰好过期，lastSeen 续期也能维持 recent=online）。
  async refreshStream(userId: string) {
    const client = await this.redis();
    const streamKey = this.streamsKey(userId);
    await client.multi()
      .set(this.lastSeenKey(userId), this.now().toISOString(), { EX: ONLINE_TTL_SECONDS })
      .expire(streamKey, ONLINE_TTL_SECONDS)
      .exec();
  }

  async markStreamClosed(userId: string) {
    const client = await this.redis();
    const streamKey = this.streamsKey(userId);
    const count = await client.decr(streamKey);
    // 审计 FIX#2(b)：若 streams 键已过期，decr 从 0 起算返回 -1（且把键重建成「-1」）。计数绝不能变负，
    // 否则并发流下在线计数被早删/算成负数。<=0 一律删键归零；正数才续期。这样过期键既不会产出 -1，
    // 也不会留下负数残骸。
    if (count <= 0) {
      await client.del(streamKey);
    } else {
      await client.expire(streamKey, ONLINE_TTL_SECONDS);
    }
    await this.touchUser(userId);
  }

  async forgetUser(userId: string) {
    const client = await this.redis();
    await client.del([this.lastSeenKey(userId), this.streamsKey(userId)]);
  }

  async getPresence(userId: string): Promise<PresenceState> {
    const client = await this.redis();
    const [lastSeenRaw, streamCountRaw] = await Promise.all([
      client.get(this.lastSeenKey(userId)),
      client.get(this.streamsKey(userId))
    ]);
    const lastSeenAt = lastSeenRaw ? new Date(lastSeenRaw) : undefined;
    const streamCount = streamCountRaw ? Number.parseInt(streamCountRaw, 10) : 0;
    const recent = lastSeenAt
      ? this.now().getTime() - lastSeenAt.getTime() <= ONLINE_TTL_SECONDS * 1000
      : false;
    return {
      is_online: streamCount > 0 || recent,
      ...(lastSeenAt ? { last_seen_at: lastSeenAt } : {})
    };
  }

  async getPresenceMap(userIds: string[]) {
    const output: Record<string, PresenceState> = {};
    for (const userId of userIds) {
      output[userId] = await this.getPresence(userId);
    }
    return output;
  }

  async close() {
    await this.client?.quit();
    this.client = undefined;
    this.connecting = undefined;
  }

  private lastSeenKey(userId: string) {
    return `presence:lastseen:${userId}`;
  }

  private streamsKey(userId: string) {
    return `presence:streams:${userId}`;
  }

  private async redis() {
    if (this.client?.isOpen) {
      return this.client;
    }
    this.connecting ??= this.connect().catch((error) => {
      this.connecting = undefined;
      throw error;
    });
    await this.connecting;
    if (!this.client) {
      throw new Error("Redis presence client failed to connect");
    }
    return this.client;
  }

  private async connect() {
    this.client = this.clientFactory(this.url);
    this.client.on("error", (error) => console.error("Redis presence error", error));
    await this.client.connect();
  }
}

let defaultPresenceStore: PresenceStore | undefined;

export function createPresenceStore(runtimeSettings: Settings = defaultSettings): PresenceStore {
  if (runtimeSettings.broker.backend === "redis") {
    return new RedisPresenceStore(runtimeSettings.broker.url);
  }
  return new InMemoryPresenceStore();
}

export function getDefaultPresenceStore() {
  defaultPresenceStore ??= createPresenceStore();
  return defaultPresenceStore;
}
