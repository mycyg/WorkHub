import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { createSessionRequestSchema, nextQuestionRequestSchema } from "@workhub/contracts";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";

export type SessionRoutesDependencies = {
  auth?: AuthDependencySource;
};

const serviceUnavailableMessage = "真实澄清会话服务尚未接入；演示 fixture 只保留在 /api/pages/gold-path 页面包。";

export function createSessionRoutes(deps: SessionRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;

  routes.post("/sessions", createCurrentUserMiddleware(authSource), async (c) => {
    createSessionRequestSchema.parse(await optionalJson(c.req));
    throw new HTTPException(501, { message: serviceUnavailableMessage });
  });

  routes.post("/sessions/:id/next-question", createCurrentUserMiddleware(authSource), async (c) => {
    nextQuestionRequestSchema.parse(await optionalJson(c.req));
    throw new HTTPException(501, { message: serviceUnavailableMessage });
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
