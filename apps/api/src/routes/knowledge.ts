import { Hono } from "hono";
import { normalizeWorkHubLocale, type WorkHubLocale } from "@workhub/contracts";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  getDefaultWorkItemService,
  knowledgeSearchRequestSchema,
  type WorkItemService
} from "../services/work-items.js";
import { readJsonObject } from "./json-body.js";
import { isUuidParam } from "./uuid-param.js";

export type KnowledgeRoutesDependencies = {
  auth?: AuthDependencySource;
  workItems?: WorkItemService;
};

function handleWorkItemError(error: unknown): never {
  throw error;
}

function requestLocale(c: { req: { query: (key: string) => string | undefined; header: (key: string) => string | undefined } }): WorkHubLocale {
  return normalizeWorkHubLocale(c.req.query("locale") ?? c.req.header("Accept-Language"));
}

export function createKnowledgeRoutes(deps: KnowledgeRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const workItems = deps.workItems ?? getDefaultWorkItemService();

  routes.post("/search", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    const rawPayload = await readJsonObject(c);
    const rawWorkItemId = rawPayload.work_item_id;
    try {
      if (typeof rawWorkItemId === "string" && isUuidParam(rawWorkItemId)) {
        await workItems.detailPage({ workItemId: rawWorkItemId, actor: c.var.actor, locale });
      }
      const payload = knowledgeSearchRequestSchema.parse(rawPayload);
      const data = await workItems.searchKnowledge({ payload, actor: c.var.actor, locale });
      return c.json({ ok: true, data, meta: { locale } });
    } catch (error) {
      handleWorkItemError(error);
    }
  });

  return routes;
}
