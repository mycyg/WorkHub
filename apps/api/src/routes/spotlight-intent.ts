import { Hono } from "hono";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  createSpotlightIntentRequestSchema,
  getDefaultSpotlightIntentService,
  type SpotlightIntentService
} from "../services/spotlight-intent.js";
import { readJsonObject } from "./json-body.js";

// R13 批 S1（聚焦盒 AI 入口）：这个路由模块故意 **不挂载** 进 apps/api/src/app.ts——挂载是集成者的活
// （见 r12-desktop-workbench/reports/r13-s1-spotlight-ai.md 的「挂载清单」）。写法照
// routes/conversation-turns.ts 保持一致。

export type SpotlightIntentRoutesDependencies = {
  auth?: AuthDependencySource;
  spotlightIntent?: SpotlightIntentService;
};

export function createSpotlightIntentRoutes(deps: SpotlightIntentRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const spotlightIntent = deps.spotlightIntent ?? getDefaultSpotlightIntentService();
  const requireCurrentUser = createCurrentUserMiddleware(authSource);

  routes.post("/spotlight/intent", requireCurrentUser, async (c) => {
    const payload = createSpotlightIntentRequestSchema.parse(await readJsonObject(c));
    const data = await spotlightIntent.createIntent({ actor: c.var.actor, payload });
    return c.json({ ok: true, data }, 200);
  });

  return routes;
}
