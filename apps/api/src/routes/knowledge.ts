import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  getDefaultWorkItemService,
  knowledgeSearchRequestSchema,
  WorkItemServiceError,
  type WorkItemService
} from "../services/work-items.js";

export type KnowledgeRoutesDependencies = {
  auth?: AuthDependencySource;
  workItems?: WorkItemService;
};

async function readJsonBody(req: { text: () => Promise<string> }) {
  const text = await req.text();
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HTTPException(400, { message: "知识库检索请求不是有效的 JSON。" });
  }
}

function handleWorkItemError(error: unknown): never {
  if (error instanceof WorkItemServiceError) {
    throw new HTTPException(error.status as 400, { message: error.message });
  }
  throw error;
}

export function createKnowledgeRoutes(deps: KnowledgeRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const workItems = deps.workItems ?? getDefaultWorkItemService();

  routes.post("/search", createCurrentUserMiddleware(authSource), async (c) => {
    const payload = knowledgeSearchRequestSchema.parse(await readJsonBody(c.req));
    try {
      const data = await workItems.searchKnowledge({ payload, actor: c.var.actor });
      return c.json({ ok: true, data });
    } catch (error) {
      handleWorkItemError(error);
    }
  });

  return routes;
}
