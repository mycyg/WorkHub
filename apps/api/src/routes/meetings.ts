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

export function createMeetingRoutes(deps: MeetingRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const meetingPages = deps.meetingPages ?? getDefaultMeetingPageService();

  routes.post("/projects/:projectId/insights/:insightId/draft", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    try {
      const data = await meetingPages.insightToDraft({
        actor: c.var.actor,
        projectId: c.req.param("projectId"),
        insightId: c.req.param("insightId")
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
        projectId: c.req.param("projectId"),
        insightId: c.req.param("insightId")
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
        workItemId: c.req.param("workItemId")
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
