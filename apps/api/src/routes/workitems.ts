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
import {
  getDefaultWorkItemService,
  WorkItemServiceError,
  type WorkItemService
} from "../services/work-items.js";

export type WorkItemRoutesDependencies = {
  auth?: AuthDependencySource;
  workItems?: WorkItemService;
};

function handleWorkItemError(error: unknown): never {
  if (error instanceof WorkItemServiceError) {
    throw new HTTPException(error.status as 400, { message: error.message });
  }
  throw error;
}

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
  const workItems = deps.workItems ?? getDefaultWorkItemService();

  routes.post("/workitems", createCurrentUserMiddleware(authSource), async (c) => {
    const payload = createWorkItemRequestSchema.parse(await readJsonBody(c));
    try {
      const data = await workItems.createWorkItem({ payload, actor: c.var.actor });
      return c.json({ ok: true, data }, 201);
    } catch (error) {
      handleWorkItemError(error);
    }
  });

  routes.post("/workitems/:id/evidence-bindings", createCurrentUserMiddleware(authSource), async (c) => {
    const payload = useEvidenceForTaskRequestSchema.parse(await readJsonBody(c));
    try {
      const data = await workItems.bindEvidence({
        workItemId: c.req.param("id"),
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
