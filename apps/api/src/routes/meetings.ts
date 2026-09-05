import { Hono, type Context } from "hono";
import { z } from "zod";

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
import { readJsonObject } from "./json-body.js";
import { serviceT } from "../services/locales.js";

// R10-P2-2：导入会议转写请求体。
const importMeetingTranscriptSchema = z.object({
  title: z.string().trim().min(1).max(256),
  transcript_text: z.string().trim().min(1).max(200000)
});

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
// 500；非法即抛 MeetingPageServiceError(404)，经既有 catch 走 meetingErrorResponse，并保留领域错误码。
function requireUuidParam(value: string, label: string, code = "meeting_not_found"): string {
  if (!isUuidParam(value)) {
    throw new MeetingPageServiceError(404, `没有找到这个${label}。`, code);
  }
  return value;
}

export function createMeetingRoutes(deps: MeetingRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const meetingPages = deps.meetingPages ?? getDefaultMeetingPageService();

  // R10-P2-2：导入会议转写（标题+文本）——会议页从只读孤岛变成可自助进数据。
  routes.post("/projects/:projectId/import", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    try {
      const payload = importMeetingTranscriptSchema.parse(await readJsonObject(c));
      const data = await meetingPages.importTranscript({
        actor: c.var.actor,
        projectId: requireUuidParam(c.req.param("projectId"), "项目"),
        title: payload.title,
        transcriptText: payload.transcript_text,
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

  // SA-02：重新生成纪要。路径只有两段（:meetingId/analyze），与上面 projects/... 三段起步的
  // 几条不会撞车。同步等分析跑完再回页面——用户点了就该看见结果，而不是一个「已提交」的空承诺。
  routes.post("/:meetingId/analyze", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    try {
      const data = await meetingPages.reanalyzeMeeting({
        actor: c.var.actor,
        meetingId: requireUuidParam(c.req.param("meetingId"), "会议"),
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

  routes.post("/projects/:projectId/insights/:insightId/draft", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    try {
      const data = await meetingPages.insightToDraft({
        actor: c.var.actor,
        projectId: requireUuidParam(c.req.param("projectId"), "项目"),
        insightId: requireUuidParam(c.req.param("insightId"), "会议洞察", "meeting_insight_not_found"),
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
        insightId: requireUuidParam(c.req.param("insightId"), "会议洞察", "meeting_insight_not_found"),
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
        workItemId: requireUuidParam(c.req.param("workItemId"), serviceT("zh-CN", "taskLabel"))
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
