import { Hono, type Context } from "hono";

import { normalizeWorkHubLocale, type MeetingPageVM, type WorkItemDetailVM } from "@workhub/contracts";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  getDefaultMeetingPageService,
  MeetingPageServiceError,
  type MeetingPageService
} from "../services/meeting-pages.js";
import { isUuidParam } from "./uuid-param.js";

export type MeetingRoutesDependencies = {
  auth?: AuthDependencySource;
  meetingPages?: MeetingPageService;
};

function requestLocale(c: { req: { query: (key: string) => string | undefined; header: (key: string) => string | undefined } }) {
  return normalizeWorkHubLocale(c.req.query("locale") ?? c.req.header("Accept-Language"));
}

function pageEnvelope<T extends MeetingPageVM | WorkItemDetailVM>(data: T, locale: ReturnType<typeof requestLocale>) {
  return {
    ok: true,
    data,
    meta: { locale }
  } as const;
}

function meetingErrorResponse(c: Context<AuthEnv>, error: MeetingPageServiceError) {
  return c.json({
    ok: false,
    error: {
      code: error.code,
      message: error.message
    }
  }, error.status);
}

// 路由 uuid 形参在到达 DB（uuid 列）前先校验。非 uuid 串原本直达 PG 查询 → 22P02 invalid uuid 抛未捕获
// 500；非法即抛 MeetingPageServiceError(404)，经既有 catch 走 meetingErrorResponse——与「合法但不存在」同样 404。
function requireUuidParam(value: string, label: string): string {
  if (!isUuidParam(value)) {
    throw new MeetingPageServiceError(404, `没有找到这个${label}。`, "not_found");
  }
  return value;
}

export function createMeetingRoutes(deps: MeetingRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const meetingPages = deps.meetingPages ?? getDefaultMeetingPageService();

  routes.post("/projects/:projectId/insights/:insightId/draft", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    try {
      const data = await meetingPages.insightToDraft({
        actor: c.var.actor,
        projectId: requireUuidParam(c.req.param("projectId"), "项目"),
        insightId: c.req.param("insightId"),
        locale
      });
      return c.json(pageEnvelope(data, locale));
    } catch (error) {
      if (error instanceof MeetingPageServiceError) {
        return meetingErrorResponse(c, error);
      }
      throw error;
    }
  });

  routes.post("/projects/:projectId/insights/:insightId/dismiss", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    try {
      const data = await meetingPages.dismissInsight({
        actor: c.var.actor,
        projectId: requireUuidParam(c.req.param("projectId"), "项目"),
        insightId: c.req.param("insightId"),
        locale
      });
      return c.json(pageEnvelope(data, locale));
    } catch (error) {
      if (error instanceof MeetingPageServiceError) {
        return meetingErrorResponse(c, error);
      }
      throw error;
    }
  });

  routes.post("/workitems/:workItemId/proposal-draft", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    try {
      const data = await meetingPages.draftToProposal({
        actor: c.var.actor,
        locale,
        workItemId: requireUuidParam(c.req.param("workItemId"), "事项")
      });
      return c.json(pageEnvelope(data, locale));
    } catch (error) {
      if (error instanceof MeetingPageServiceError) {
        return meetingErrorResponse(c, error);
      }
      throw error;
    }
  });

  return routes;
}
