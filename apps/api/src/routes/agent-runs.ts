import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  getDefaultAgentRunQueue,
  type AgentRunQueue
} from "../workers/agent-runner.js";
import { buildReplayTracePage } from "../pages/replay.js";
import {
  getP05GoldPathFixture,
  isP05AgentRunId
} from "../pages/gold-path.js";

const startAgentRunSchema = z.object({
  mode: z.enum(["worker", "pm"]).optional(),
  title: z.string().min(1).max(256).optional()
});

export type AgentRunRoutesDependencies = {
  auth?: AuthDependencySource;
  queue?: AgentRunQueue;
};

export function createAgentRunRoutes(deps: AgentRunRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const queue = deps.queue ?? getDefaultAgentRunQueue();

  routes.post("/workitems/:id/agent-runs", createCurrentUserMiddleware(authSource), async (c) => {
    const payload = startAgentRunSchema.parse(await c.req.json().catch(() => ({})));
    const data = await queue.enqueue({
      workItemId: c.req.param("id"),
      actorId: c.var.actor.id,
      ...(payload.title ? { title: payload.title } : {}),
      ...(payload.mode ? { mode: payload.mode } : {})
    });
    return c.json({ ok: true, data }, 202);
  });

  routes.get("/agent-runs/:id", createCurrentUserMiddleware(authSource), async (c) => {
    const data = await queue.get(c.req.param("id"));
    if (!data) {
      throw new HTTPException(404, { message: "没有找到这次 AI 执行。" });
    }
    return c.json({ ok: true, data });
  });

  routes.get("/agent-runs/:id/trace", createCurrentUserMiddleware(authSource), async (c) => {
    const afterRaw = c.req.query("after");
    const after = afterRaw ? Number.parseInt(afterRaw, 10) : 0;
    const data = await queue.trace(c.req.param("id"), Number.isFinite(after) ? after : 0);
    return c.json({ ok: true, data });
  });

  routes.post("/agent-runs/:id/abort", createCurrentUserMiddleware(authSource), async (c) => {
    const data = await queue.abort(c.req.param("id"), c.var.actor.id);
    return c.json({ ok: true, data });
  });

  routes.get("/agent-runs/:id/handoff", createCurrentUserMiddleware(authSource), async (c) => {
    const run = await queue.get(c.req.param("id"));
    if (!run) {
      throw new HTTPException(404, { message: "没有找到这次 AI 执行。" });
    }
    return c.json({ ok: true, data: run.handoff ?? null });
  });

  routes.get("/agent-runs/:id/replay", createCurrentUserMiddleware(authSource), async (c) => {
    const run = await queue.get(c.req.param("id"));
    if (!run && isP05AgentRunId(c.req.param("id"))) {
      return c.json({ ok: true, data: getP05GoldPathFixture().replay });
    }
    if (!run) {
      throw new HTTPException(404, { message: "没有找到这次 AI 执行。" });
    }
    return c.json({ ok: true, data: buildReplayTracePage({ run }) });
  });

  return routes;
}
