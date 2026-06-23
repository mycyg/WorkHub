import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { createSessionRequestSchema, nextQuestionRequestSchema, normalizeWorkHubLocale, type WorkHubLocale } from "@workhub/contracts";

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
import { isUuidParam } from "./uuid-param.js";

export type SessionRoutesDependencies = {
  auth?: AuthDependencySource;
  workItems?: WorkItemService;
};

// 与 workitems/proposals/agent-runs 一致:非 uuid 的 session id 直接 404,别透传到 PG uuid 列引发 22P02→未处理 500。
function requireSessionId(value: string): string {
  if (!isUuidParam(value)) {
    throw new HTTPException(404, { message: "没有找到这个会话。" });
  }
  return value;
}

function handleWorkItemError(error: unknown): never {
  if (error instanceof WorkItemServiceError) {
    throw new HTTPException(error.status as 400, { message: error.message });
  }
  throw error;
}

function requestLocale(c: { req: { query: (key: string) => string | undefined; header: (key: string) => string | undefined } }): WorkHubLocale {
  return normalizeWorkHubLocale(c.req.query("locale") ?? c.req.header("Accept-Language"));
}

export function createSessionRoutes(deps: SessionRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const workItems = deps.workItems ?? getDefaultWorkItemService();

  routes.post("/sessions", createCurrentUserMiddleware(authSource), async (c) => {
    const payload = createSessionRequestSchema.parse(await optionalJson(c.req));
    const locale = requestLocale(c);
    try {
      const data = await workItems.createSession({ payload, actor: c.var.actor, locale });
      return c.json({ ok: true, data, meta: { locale } });
    } catch (error) {
      handleWorkItemError(error);
    }
  });

  routes.get("/sessions/:id", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    try {
      const data = await workItems.getSession({
        sessionId: requireSessionId(c.req.param("id")),
        actor: c.var.actor,
        locale
      });
      return c.json({ ok: true, data, meta: { locale } });
    } catch (error) {
      handleWorkItemError(error);
    }
  });

  routes.post("/sessions/:id/next-question", createCurrentUserMiddleware(authSource), async (c) => {
    const payload = nextQuestionRequestSchema.parse(await optionalJson(c.req));
    const locale = requestLocale(c);
    try {
      const data = await workItems.nextQuestion({
        sessionId: requireSessionId(c.req.param("id")),
        payload,
        actor: c.var.actor,
        locale
      });
      return c.json({ ok: true, data, meta: { locale } });
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
