import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { presenceListResponseSchema, type PresenceEntryVm } from "@workhub/contracts";
import {
  createPresenceMembershipRepository,
  getSharedDatabaseClient,
  type PresenceMembershipRepository
} from "@workhub/db";

import { getDefaultPresenceStore } from "../broker/index.js";
import type { PresenceStore } from "../broker/index.js";
import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import { isUuidParam } from "./uuid-param.js";

// R14 CHAT 批（presence-observer 工包）：GET /api/presence——01-chat-design.md §3 拍板的读端点。
// 这个路由模块故意 **不挂载**进 apps/api/src/app.ts——挂载是集成者的活（照 routes/conversation-typing.ts
// / routes/conversation-army.ts 的先例：写好不挂，wave-1 集成者统一挂进 app.ts，见本工包报告的
// 「挂载清单」）。只导出 createPresenceRoutes(deps)，跟仓库既有路由模块的写法保持一致。
//
// PresenceStore 基础设施（apps/api/src/broker/presence.ts）早就存在——ONLINE_TTL_SECONDS=120，
// 由 SSE 流心跳驱动 markStreamOpen/refreshStream/markStreamClosed/touchUser。这个端点只是把
// getPresenceMap 读侧暴露成 REST，不新造在线态存储。
//
// 鉴权 = 登录 human actor（createCurrentUserMiddleware 解析出的 actor 恒为 kind:"human"）。
// 同工作区过滤在 SQL 层完成（PresenceMembershipRepository.listActiveUserIdsInWorkspace），不是
// 全量捞回 presence 再在应用层按 workspace 筛——不可见的 user_id 直接从结果集里消失，不占用响应位、
// 也不用一个假的 {is_online:false} 占位去暗示"这个 id 存在但离线"。

const MAX_PRESENCE_USER_IDS = 50;

function parsePresenceUserIds(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim().length === 0) {
    throw new HTTPException(400, { message: "user_ids query parameter is required" });
  }
  const parts = raw
    .split(",")
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0);
  if (parts.length === 0) {
    throw new HTTPException(400, { message: "user_ids query parameter is required" });
  }
  // 上限检查在去重之前——防的是查询串本身被灌成一个很长的列表（04 §4 铁律 4「不许无上限增长」的
  // 精神同样适用于请求输入，不只是列表查询），而不是"去重后还剩多少个不同 id"。
  if (parts.length > MAX_PRESENCE_USER_IDS) {
    throw new HTTPException(400, { message: `user_ids accepts at most ${MAX_PRESENCE_USER_IDS} ids` });
  }
  for (const part of parts) {
    if (!isUuidParam(part)) {
      throw new HTTPException(400, { message: `user_ids contains an invalid id: ${part}` });
    }
  }
  // 去重放在校验之后——保留调用方原始顺序（客户端多半按成员条渲染顺序请求，响应顺序跟随请求顺序
  // 对客户端友好），只是丢掉重复项。
  return [...new Set(parts)];
}

export type PresenceRoutesDependencies = {
  auth?: AuthDependencySource;
  presence?: Pick<PresenceStore, "getPresenceMap">;
  memberships?: Pick<PresenceMembershipRepository, "listActiveUserIdsInWorkspace">;
};

export function createPresenceRoutes(deps: PresenceRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const requireCurrentUser = createCurrentUserMiddleware(authSource);
  const presenceStore = deps.presence ?? getDefaultPresenceStore();
  const memberships = deps.memberships ?? createPresenceMembershipRepository(getSharedDatabaseClient().db);

  routes.get("/presence", requireCurrentUser, async (c) => {
    const actor = c.var.actor;
    const requestedUserIds = parsePresenceUserIds(c.req.query("user_ids"));

    const visibleUserIds = await memberships.listActiveUserIdsInWorkspace(actor.workspaceId, requestedUserIds);
    if (visibleUserIds.length === 0) {
      return c.json({ ok: true, data: presenceListResponseSchema.parse({ presence: [] }) });
    }
    // 保留调用方的请求顺序，而不是仓库返回的（未指定的）SQL 行序——过滤掉不可见的 id，其余顺序不变。
    const visibleSet = new Set(visibleUserIds);
    const orderedVisibleUserIds = requestedUserIds.filter((id) => visibleSet.has(id));

    const presenceMap = await presenceStore.getPresenceMap(orderedVisibleUserIds);
    const presence: PresenceEntryVm[] = orderedVisibleUserIds.map((userId) => {
      const state = presenceMap[userId];
      return {
        user_id: userId,
        is_online: state?.is_online ?? false,
        last_seen_at: state?.last_seen_at ? state.last_seen_at.toISOString() : null
      };
    });

    return c.json({ ok: true, data: presenceListResponseSchema.parse({ presence }) });
  });

  return routes;
}
