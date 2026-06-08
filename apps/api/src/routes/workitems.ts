import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";

import {
  createWorkItemRequestSchema,
  useEvidenceForTaskRequestSchema
} from "@workhub/contracts";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";

export type WorkItemRoutesDependencies = {
  auth?: AuthDependencySource;
};

const serviceUnavailableMessage = "真实工作项服务尚未接入；演示 fixture 只保留在 /api/pages/gold-path 页面包。";

async function readJsonBody(c: Context) {
  const text = await c.req.text();
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HTTPException(400, { message: "工作项请求不是有效的 JSON。" });
  }
}

export function createWorkItemRoutes(deps: WorkItemRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;

  routes.post("/workitems", createCurrentUserMiddleware(authSource), async (c) => {
    createWorkItemRequestSchema.parse(await readJsonBody(c));
    throw new HTTPException(501, { message: serviceUnavailableMessage });
  });

  routes.post("/workitems/:id/evidence-bindings", createCurrentUserMiddleware(authSource), async (c) => {
    useEvidenceForTaskRequestSchema.parse(await readJsonBody(c));
    throw new HTTPException(501, { message: serviceUnavailableMessage });
  });

  return routes;
}
