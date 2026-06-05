import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  getP05GoldPathFixture,
  isP05SessionId,
  p05GoldPathIds
} from "../pages/gold-path.js";

export type SessionRoutesDependencies = {
  auth?: AuthDependencySource;
};

export function createSessionRoutes(deps: SessionRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;

  routes.post("/sessions", createCurrentUserMiddleware(authSource), (c) => {
    const fixture = getP05GoldPathFixture();
    return c.json({
      ok: true,
      data: {
        session_id: p05GoldPathIds.session,
        work_item_id: p05GoldPathIds.workItem,
        next_question_href: `/api/sessions/${p05GoldPathIds.session}/next-question`,
        question: fixture.question
      }
    });
  });

  routes.post("/sessions/:id/next-question", createCurrentUserMiddleware(authSource), (c) => {
    if (!isP05SessionId(c.req.param("id"))) {
      throw new HTTPException(404, { message: "没有找到这个澄清会话。" });
    }
    return c.json({ ok: true, data: getP05GoldPathFixture().question });
  });

  return routes;
}
