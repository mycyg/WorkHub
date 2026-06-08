import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { createSessionRequestSchema, nextQuestionRequestSchema } from "@workhub/contracts";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  getDefaultWorkItemService,
  WorkItemServiceError,
  type WorkItemService
} from "../services/work-items.js";

export type SessionRoutesDependencies = {
  auth?: AuthDependencySource;
  workItems?: WorkItemService;
};

function handleWorkItemError(error: unknown): never {
  if (error instanceof WorkItemServiceError) {
    throw new HTTPException(error.status as 400, { message: error.message });
  }
  throw error;
}

export function createSessionRoutes(deps: SessionRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const workItems = deps.workItems ?? getDefaultWorkItemService();

  routes.post("/sessions", createCurrentUserMiddleware(authSource), async (c) => {
    const payload = createSessionRequestSchema.parse(await optionalJson(c.req));
    try {
      const data = await workItems.createSession({ payload, actor: c.var.actor });
      return c.json({ ok: true, data });
    } catch (error) {
      handleWorkItemError(error);
    }
  });

  routes.post("/sessions/:id/next-question", createCurrentUserMiddleware(authSource), async (c) => {
    const payload = nextQuestionRequestSchema.parse(await optionalJson(c.req));
    try {
      const data = await workItems.nextQuestion({
        sessionId: c.req.param("id"),
        payload,
        actor: c.var.actor
      });
      return c.json({ ok: true, data });
    } catch (error) {
      handleWorkItemError(error);
    }
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
