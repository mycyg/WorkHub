import { Hono } from "hono";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import { getDefaultSearchService, type SearchService } from "../services/search.js";

// R14 批 SEARCH（全局搜索）：GET /api/search?q=&scopes=&limit=——02-search-design.md §4 拍板的统一读端点。
// 这个路由模块故意 **不挂载**进 apps/api/src/app.ts——挂载是集成者的活（照 routes/presence.ts /
// routes/conversation-typing.ts 的先例：写好不挂，wave 集成者统一挂进 app.ts + openapi + app.test 白名单，
// 见本工包报告的「挂载清单」）。只导出 createSearchRoutes(deps)，跟仓库既有路由模块的写法保持一致。
//
// 鉴权 = 登录 human actor（createCurrentUserMiddleware 解析出的 actor 恒为 kind:"human"，未登录 401）。
// q/scopes/limit 的人话校验（非法→400）与逐 scope 逐 actor 的 SQL 围栏都在服务/仓库层完成，路由只透传
// 原始 query 串给服务层，不在这里做半套校验（单一事实源在服务层，便于穷举单测）。

export type SearchRoutesDependencies = {
  auth?: AuthDependencySource;
  search?: SearchService;
};

export function createSearchRoutes(deps: SearchRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const requireCurrentUser = createCurrentUserMiddleware(authSource);
  const search = deps.search ?? getDefaultSearchService();

  routes.get("/search", requireCurrentUser, async (c) => {
    const data = await search.search({
      actor: c.var.actor,
      q: c.req.query("q"),
      scopes: c.req.query("scopes"),
      limit: c.req.query("limit")
    });
    return c.json({ ok: true, data });
  });

  return routes;
}
