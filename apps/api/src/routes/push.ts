import { Hono } from "hono";

import { getDefaultPushBus, getDefaultPresenceStore, type PresenceStore, type PushBus } from "../broker/index.js";
import {
  getDefaultAuthDependencies,
  resolveAuthDependencies,
  resolveStreamUser,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import { resolveAuthorizedTopic, type TopicAccessResolver } from "../sse/topic-access.js";
import { writeEventStream, type WriteEventStreamOptions } from "../sse/stream.js";
import {
  getDefaultAgentRunQueue,
  type AgentRunQueue
} from "../workers/agent-runner.js";

export type PushRoutesDependencies = {
  auth?: AuthDependencySource;
  bus?: PushBus;
  presence?: PresenceStore;
  access?: TopicAccessResolver;
  agentRuns?: AgentRunQueue;
  stream?: WriteEventStreamOptions;
};

function createDefaultTopicAccess(agentRuns: AgentRunQueue): TopicAccessResolver {
  return {
    async canViewRun(user, id) {
      const run = await agentRuns.get(id);
      return Boolean(run && (run.actor_id === user.id || user.isAdmin));
    }
  };
}

export function createPushRoutes(deps: PushRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();

  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const bus = deps.bus ?? getDefaultPushBus();
  const presence = deps.presence ?? getDefaultPresenceStore();
  const access = deps.access ?? createDefaultTopicAccess(deps.agentRuns ?? getDefaultAgentRunQueue());

  routes.get("/stream", async (c) => {
    const authDeps = resolveAuthDependencies(authSource);
    const user = await resolveStreamUser(c, authDeps);
    const topic = await resolveAuthorizedTopic(user, { kind: "all" }, access);
    return writeEventStream(c, bus, presence, topic, user, deps.stream);
  });

  routes.get("/stream/me", async (c) => {
    const authDeps = resolveAuthDependencies(authSource);
    const user = await resolveStreamUser(c, authDeps);
    const topic = await resolveAuthorizedTopic(user, { kind: "me" }, access);
    return writeEventStream(c, bus, presence, topic, user, deps.stream);
  });

  routes.get("/stream/workitem/:id", async (c) => {
    const authDeps = resolveAuthDependencies(authSource);
    const user = await resolveStreamUser(c, authDeps);
    const topic = await resolveAuthorizedTopic(user, { kind: "workitem", id: c.req.param("id") }, access);
    return writeEventStream(c, bus, presence, topic, user, deps.stream);
  });

  routes.get("/stream/req/:id", async (c) => {
    const authDeps = resolveAuthDependencies(authSource);
    const user = await resolveStreamUser(c, authDeps);
    const topic = await resolveAuthorizedTopic(user, { kind: "workitem", id: c.req.param("id") }, access);
    return writeEventStream(c, bus, presence, topic, user, deps.stream);
  });

  routes.get("/stream/run/:id", async (c) => {
    const authDeps = resolveAuthDependencies(authSource);
    const user = await resolveStreamUser(c, authDeps);
    const topic = await resolveAuthorizedTopic(user, { kind: "run", id: c.req.param("id") }, access);
    return writeEventStream(c, bus, presence, topic, user, deps.stream);
  });

  routes.get("/stream/session/:id", async (c) => {
    const authDeps = resolveAuthDependencies(authSource);
    const user = await resolveStreamUser(c, authDeps);
    const topic = await resolveAuthorizedTopic(user, { kind: "session", id: c.req.param("id") }, access);
    return writeEventStream(c, bus, presence, topic, user, deps.stream);
  });

  routes.get("/stream/proposal/:id", async (c) => {
    const authDeps = resolveAuthDependencies(authSource);
    const user = await resolveStreamUser(c, authDeps);
    const topic = await resolveAuthorizedTopic(user, { kind: "proposal", id: c.req.param("id") }, access);
    return writeEventStream(c, bus, presence, topic, user, deps.stream);
  });

  return routes;
}
