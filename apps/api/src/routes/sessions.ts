import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { createSessionRequestSchema, sessionVmSchema } from "@workhub/contracts";
import { topics } from "@workhub/events";

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

  routes.post("/sessions", createCurrentUserMiddleware(authSource), async (c) => {
    createSessionRequestSchema.parse(await optionalJson(c.req));
    const fixture = getP05GoldPathFixture();
    const sessionId = p05GoldPathIds.session;
    return c.json({
      ok: true,
      data: sessionVmSchema.parse({
        session_id: sessionId,
        work_item_id: p05GoldPathIds.workItem,
        topic: topics.session(sessionId).topic,
        stream_href: `/api/push/stream/session/${sessionId}`,
        next_question_href: `/api/sessions/${sessionId}/next-question`,
        question: fixture.question
      })
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

async function optionalJson(req: { text: () => Promise<string> }) {
  const text = await req.text();
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HTTPException(400, { message: "澄清会话请求不是有效的 JSON。" });
  }
}
