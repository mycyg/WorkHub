import { Hono } from "hono";

import { armyRunListQuerySchema } from "@workhub/contracts";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  ConversationArmyServiceError,
  getDefaultConversationArmyService,
  type ConversationArmyService
} from "../services/conversation-army.js";
import { isUuidParam } from "./uuid-param.js";

// R12 批 5(军团面板,服务端读侧切片):这个路由模块故意 **不挂载** 进 apps/api/src/app.ts——挂载是
// 集成者的活(见 r12-desktop-workbench/reports/batch-5-server-read.md 的「挂载清单」)。这里只导出
// createConversationArmyRoutes(deps)，跟 routes/conversations.ts 的既有写法保持一致。

export type ConversationArmyRoutesDependencies = {
  auth?: AuthDependencySource;
  conversations?: ConversationArmyService;
};

function requireConversationId(value: string) {
  // uuid 参数守卫：非法串直接 404，与「合法但不存在的 uuid」同一形状，攻击者无法据状态码区分存在性
  // （照 routes/uuid-param.ts 既有用法，agent-runs.ts 的 requireUuidParam 是同款先例）。
  if (!isUuidParam(value)) {
    throw new ConversationArmyServiceError(404, "conversation_army_not_found", "没有找到这个会话的军团面板。");
  }
  return value;
}

export function createConversationArmyRoutes(deps: ConversationArmyRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const conversationArmy = deps.conversations ?? getDefaultConversationArmyService();
  const requireCurrentUser = createCurrentUserMiddleware(authSource);

  routes.get("/conversations/:id/army", requireCurrentUser, async (c) => {
    const conversationId = requireConversationId(c.req.param("id"));
    const query = armyRunListQuerySchema.parse(c.req.query());
    const data = await conversationArmy.conversationArmyPanel({ actor: c.var.actor, conversationId, query });
    return c.json({ ok: true, data });
  });

  routes.get("/me/army", requireCurrentUser, async (c) => {
    const query = armyRunListQuerySchema.parse(c.req.query());
    const data = await conversationArmy.armyOverview({ actor: c.var.actor, query });
    return c.json({ ok: true, data });
  });

  // R17 G3（#8 后台任务区接真 · 拍板 B）：军团面板「后台任务」区的只读数据源——pulse 统一调度器的每任务
  // 运行统计 + 最近投向当前用户的主动性动态。权限=工作区成员（requireCurrentUser 已保证；service 的
  // humanScope 再收窄 human/workspace/user）。无查询参数、无写副作用。
  routes.get("/army/background", requireCurrentUser, async (c) => {
    const data = await conversationArmy.armyBackground({ actor: c.var.actor });
    return c.json({ ok: true, data });
  });

  return routes;
}
