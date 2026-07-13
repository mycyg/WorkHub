import { Hono } from "hono";

import {
  conversationListQuerySchema,
  conversationMessageListQuerySchema,
  createConversationMessageRequestSchema,
  createConversationRequestSchema
} from "@workhub/contracts";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  ConversationServiceError,
  getDefaultConversationService,
  type ConversationService
} from "../services/conversations.js";
import { readJsonObject } from "./json-body.js";
import { isUuidParam } from "./uuid-param.js";

export type ConversationRoutesDependencies = {
  auth?: AuthDependencySource;
  conversations?: ConversationService;
};

function requireProjectId(value: string) {
  if (!isUuidParam(value)) {
    throw new ConversationServiceError(404, "conversation_project_not_found", "没有找到这个项目会话区。");
  }
  return value;
}

function requireConversationId(value: string) {
  if (!isUuidParam(value)) {
    throw new ConversationServiceError(404, "conversation_not_found", "没有找到这个会话。");
  }
  return value;
}

export function createConversationRoutes(deps: ConversationRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const conversations = deps.conversations ?? getDefaultConversationService();
  const requireCurrentUser = createCurrentUserMiddleware(authSource);

  routes.get("/projects/:id/conversations", requireCurrentUser, async (c) => {
    const projectId = requireProjectId(c.req.param("id"));
    const query = conversationListQuerySchema.parse(c.req.query());
    const data = await conversations.listConversations({ actor: c.var.actor, projectId, query });
    return c.json({ ok: true, data });
  });

  routes.post("/projects/:id/conversations", requireCurrentUser, async (c) => {
    const projectId = requireProjectId(c.req.param("id"));
    await conversations.assertProjectAccess({ actor: c.var.actor, projectId });
    const payload = createConversationRequestSchema.parse(await readJsonObject(c));
    const data = await conversations.createConversation({ actor: c.var.actor, projectId, payload });
    return c.json({ ok: true, data }, 201);
  });

  routes.get("/conversations/:id/messages", requireCurrentUser, async (c) => {
    const conversationId = requireConversationId(c.req.param("id"));
    const query = conversationMessageListQuerySchema.parse(c.req.query());
    const data = await conversations.listMessages({ actor: c.var.actor, conversationId, query });
    return c.json({ ok: true, data });
  });

  routes.post("/conversations/:id/messages", requireCurrentUser, async (c) => {
    const conversationId = requireConversationId(c.req.param("id"));
    await conversations.assertConversationAccess({ actor: c.var.actor, conversationId });
    const payload = createConversationMessageRequestSchema.parse(await readJsonObject(c));
    const data = await conversations.createMessage({ actor: c.var.actor, conversationId, payload });
    return c.json({ ok: true, data }, 201);
  });

  return routes;
}
