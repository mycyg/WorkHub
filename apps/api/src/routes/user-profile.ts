import { Hono } from "hono";

import { patchUserProfileRequestSchema } from "@workhub/contracts";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  getDefaultUserProfileService,
  type UserProfileService
} from "../services/user-profile.js";
import { readJsonObject } from "./json-body.js";

// R13 批 A2（派人推荐 v2）：GET/PATCH /me/profile ——"我是谁"，与既有 PATCH /me/ai-profile
// （"AI 该怎么替我干活"）语义分开，不混表不混端点。
//
// 集成者缝合位（本批范围围栏禁止直接改 app.ts/openapi.ts，具体片段见批次汇报）：
//   - app.ts 挂载：import { createUserProfileRoutes } from "./routes/user-profile.js";
//                  app.route("/api", createUserProfileRoutes());
//   - openapi.ts：/api/me/profile 的 GET/PATCH 两条路径文档（参照 /api/me/ai-profile 现有写法）。

export type UserProfileRoutesDependencies = {
  auth?: AuthDependencySource;
  userProfile?: UserProfileService;
};

export function createUserProfileRoutes(deps: UserProfileRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const userProfile = deps.userProfile ?? getDefaultUserProfileService();
  const requireCurrentUser = createCurrentUserMiddleware(authSource);

  routes.get("/me/profile", requireCurrentUser, async (c) => {
    const data = await userProfile.getMyProfile({ actor: c.var.actor });
    return c.json({ ok: true, data });
  });

  routes.patch("/me/profile", requireCurrentUser, async (c) => {
    const payload = patchUserProfileRequestSchema.parse(await readJsonObject(c));
    const data = await userProfile.patchMyProfile({ actor: c.var.actor, payload });
    return c.json({ ok: true, data });
  });

  return routes;
}
