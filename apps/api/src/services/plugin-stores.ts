import { createPluginRepository, getSharedDatabaseClient, type WorkHubDatabaseClient } from "@workhub/db";

// R24-P 阶段 1：插件清单仓储的默认接线。与 audit-stores.ts 同款懒单例——
// `getSharedDatabaseClient()` 只在真被调用时才建连接池，所以 import 本模块不会碰 PG。

let defaultDbClient: WorkHubDatabaseClient | undefined;

export function getDefaultPluginRepository() {
  defaultDbClient ??= getSharedDatabaseClient();
  return createPluginRepository(defaultDbClient.db);
}
