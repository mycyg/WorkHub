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

  async markStreamClosed(userId: string) {
    const client = await this.redis();
    const streamKey = this.streamsKey(userId);
    const count = await client.decr(streamKey);
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
