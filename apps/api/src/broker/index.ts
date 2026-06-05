import { settings as defaultSettings, type Settings } from "@workhub/config";

import { InProcessPushBus } from "./memory.js";
import { RedisPushBus } from "./redis.js";
import type { PushBus } from "./types.js";

let defaultPushBus: PushBus | undefined;

export function createPushBus(runtimeSettings: Settings = defaultSettings): PushBus {
  if (runtimeSettings.broker.backend === "redis") {
    return new RedisPushBus(runtimeSettings.broker.url);
  }

  if (runtimeSettings.broker.backend === "pg_listen") {
    throw new Error("BROKER_BACKEND=pg_listen is reserved for a future adapter; use redis or memory");
  }

  return new InProcessPushBus();
}

export function getDefaultPushBus() {
  defaultPushBus ??= createPushBus();
  return defaultPushBus;
}

export * from "./types.js";
export * from "./memory.js";
export * from "./redis.js";
export * from "./presence.js";
