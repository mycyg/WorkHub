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
  AgentRunnerError,
  getDefaultAgentRunQueue,
  type AgentRunQueue
} from "../workers/agent-runner.js";

const startAgentRunSchema = z.object({
  mode: z.enum(["worker", "pm"]).optional(),
  title: z.string().min(1).max(256).optional()
});

export type AgentRunRoutesDependencies = {
  auth?: AuthDependencySource;
  queue?: AgentRunQueue;
};

function handleRunnerError(error: unknown): never {
  if (error instanceof AgentRunnerError) {
    throw new HTTPException(error.status as 400, { message: error.message });
  }
  throw error;
}

export function createAgentRunRoutes(deps: AgentRunRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const queue = deps.queue ?? getDefaultAgentRunQueue();

  routes.post("/workitems/:id/agent-runs", createCurrentUserMiddleware(authSource), async (c) => {
    const payload = startAgentRunSchema.parse(await c.req.json().catch(() => ({})));
    try {
      const data = await queue.enqueue({
        workItemId: c.req.param("id"),
        actorId: c.var.actor.id,
        ...(payload.title ? { title: payload.title } : {}),
        ...(payload.mode ? { mode: payload.mode } : {})
      });
      return c.json({ ok: true, data }, 202);
    } catch (error) {
      handleRunnerError(error);
    }
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
    try {
      const data = await queue.trace(c.req.param("id"), Number.isFinite(after) ? after : 0);
      return c.json({ ok: true, data });
    } catch (error) {
      handleRunnerError(error);
    }
  });

  routes.post("/agent-runs/:id/abort", createCurrentUserMiddleware(authSource), async (c) => {
    try {
      const data = await queue.abort(c.req.param("id"), c.var.actor.id);
      return c.json({ ok: true, data });
    } catch (error) {
      handleRunnerError(error);
    }
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
    if (!run) {
      throw new HTTPException(404, { message: "没有找到这次 AI 执行。" });
    }
    return c.json({
      ok: true,
      data: {
        run,
        steps: run.trace,
        evidence_refs: [],
        snapshots: [],
        cost: {
          me: {
            total_tokens: run.usage.token_in + run.usage.token_out,
            estimated_cost_cny: run.usage.estimated_cost_cny,
            warning_ratio: 0
          },
          active_notices: []
        }
      }
    });
  });

  return routes;
}
