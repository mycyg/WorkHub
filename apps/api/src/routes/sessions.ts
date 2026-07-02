import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  createSessionRequestSchema,
  eventTypes,
  nextQuestionRequestSchema,
  normalizeWorkHubLocale,
  type SessionVM,
  type WorkHubLocale
} from "@workhub/contracts";
import { makeWorkHubEvent, topics } from "@workhub/events";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthActor,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import { getDefaultPushBus, type PushBus } from "../broker/index.js";
import { getDefaultStructuredLogger } from "../logging.js";
import {
  getDefaultWorkItemService,
  type WorkItemService
} from "../services/work-items.js";
import { readJsonObject } from "./json-body.js";
import { isUuidParam } from "./uuid-param.js";

export type SessionRoutesDependencies = {
  auth?: AuthDependencySource;
  workItems?: WorkItemService;
  bus?: PushBus | false;
};

// 与 workitems/proposals/agent-runs 一致:非 uuid 的 session id 直接 404,别透传到 PG uuid 列引发 22P02→未处理 500。
function requireSessionId(value: string): string {
  if (!isUuidParam(value)) {
    throw new HTTPException(404, { message: "没有找到这个会话。" });
  }
  return value;
}

function handleWorkItemError(error: unknown): never {
  throw error;
}

function requestLocale(c: { req: { query: (key: string) => string | undefined; header: (key: string) => string | undefined } }): WorkHubLocale {
  return normalizeWorkHubLocale(c.req.query("locale") ?? c.req.header("Accept-Language"));
}

async function publishSessionQuestion(
  bus: PushBus | undefined,
  session: SessionVM,
  actor: AuthActor
) {
  if (!bus) {
    return;
  }
  const activeStep = session.question.progress.find((step) => step.state === "active");
  const topic = topics.session(session.session_id).topic;
  const data = {
    session_id: session.session_id,
    ...(session.work_item_id ? { work_item_id: session.work_item_id } : {}),
    question_id: session.question.id,
    input_mode: session.question.input_mode,
    ...(activeStep?.key ? { progress_key: activeStep.key } : {}),
    ...(activeStep?.label ? { progress_label: activeStep.label } : {})
  };
  try {
    await bus.publish(topic, eventTypes.sessionQuestion, makeWorkHubEvent({
      type: eventTypes.sessionQuestion,
      topic,
      actor: {
        actor_kind: "human",
        actor_user_id: actor.userId ?? actor.id,
        label: actor.label
      },
      ...(session.work_item_id ? { work_item_id: session.work_item_id } : {}),
      session_id: session.session_id,
      preview_text: session.question.title,
      cuu_state: "asking_approval",
      data
    }));
  } catch (error) {
    getDefaultStructuredLogger().warn("session_question_event_publish_failed", {
      sessionId: session.session_id,
      error
    });
  }
}

export function createSessionRoutes(deps: SessionRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const workItems = deps.workItems ?? getDefaultWorkItemService();
  const bus = deps.bus === false ? undefined : deps.bus ?? getDefaultPushBus();

  routes.post("/sessions", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    const rawPayload = await readJsonObject(c);
    const rawWorkItemId = rawPayload.work_item_id;
    try {
      if (typeof rawWorkItemId === "string" && rawWorkItemId.trim() && isUuidParam(rawWorkItemId)) {
        await workItems.assertCanMutateWorkItem({ workItemId: rawWorkItemId, actor: c.var.actor });
      }
      const payload = createSessionRequestSchema.parse(rawPayload);
      const data = await workItems.createSession({ payload, actor: c.var.actor, locale });
      await publishSessionQuestion(bus, data, c.var.actor);
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
    const sessionId = requireSessionId(c.req.param("id"));
    const locale = requestLocale(c);
    try {
      await workItems.assertCanMutateWorkItem({ workItemId: sessionId, actor: c.var.actor });
      const payload = nextQuestionRequestSchema.parse(await readJsonObject(c));
      const data = await workItems.nextQuestion({
        sessionId,
        payload,
        actor: c.var.actor,
        locale
      });
      await publishSessionQuestion(bus, data, c.var.actor);
      return c.json({ ok: true, data, meta: { locale } });
    } catch (error) {
      handleWorkItemError(error);
    }
  });

  return routes;
}
