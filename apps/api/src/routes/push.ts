import { Hono } from "hono";

import { getDefaultPushBus, getDefaultPresenceStore, type PresenceStore, type PushBus } from "../broker/index.js";
import {
  getDefaultAuthDependencies,
  resolveAuthDependencies,
  resolveStreamUser,
  type AuthActor,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import { resolveAuthorizedTopic, type TopicAccessResolver } from "../sse/topic-access.js";
import { writeEventStream, type WriteEventStreamOptions } from "../sse/stream.js";
import {
  getDefaultProposalService,
  type ProposalService
} from "../services/proposals.js";
import {
  getDefaultWorkItemService,
  WorkItemServiceError,
  type WorkItemService
} from "../services/work-items.js";
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
  workItems?: WorkItemService | false;
  proposals?: ProposalService | false;
  stream?: WriteEventStreamOptions;
};

function streamActor(user: { id: string; nickname: string; isAdmin: boolean }): AuthActor {
  return {
    kind: "human",
    id: user.id,
    label: user.nickname,
    userId: user.id,
    isAdmin: user.isAdmin,
    orgId: "stream",
    workspaceId: "stream"
  };
}

function canReadByWorkItemService(workItems: WorkItemService | undefined, user: Parameters<NonNullable<TopicAccessResolver["canViewWorkItem"]>>[0], workItemId: string) {
  if (!workItems) {
    return Promise.resolve(false);
  }
  return workItems.detailPage({ workItemId, actor: streamActor(user) })
    .then(() => true)
    .catch((error) => {
      if (error instanceof WorkItemServiceError && (error.status === 403 || error.status === 404)) {
        return false;
      }
      throw error;
    });
}

function createDefaultTopicAccess(input: {
  agentRuns: AgentRunQueue;
  workItems: () => WorkItemService | undefined;
  proposals: () => ProposalService | undefined;
}): TopicAccessResolver {
  return {
    async canViewRun(user, id) {
      const run = await input.agentRuns.get(id);
      return Boolean(run && (run.actor_id === user.id || user.isAdmin));
    },
    canViewWorkItem(user, id) {
      return canReadByWorkItemService(input.workItems(), user, id);
    },
    canViewSession(user, id) {
      return canReadByWorkItemService(input.workItems(), user, id);
    },
    async canViewProposal(user, id) {
      const proposal = await input.proposals()?.get(id);
      if (!proposal) {
        return false;
      }
      return canReadByWorkItemService(input.workItems(), user, proposal.work_item_id);
    }
  };
}

export function createPushRoutes(deps: PushRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();

  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const bus = deps.bus ?? getDefaultPushBus();
  const presence = deps.presence ?? getDefaultPresenceStore();
  const access = deps.access ?? createDefaultTopicAccess({
    agentRuns: deps.agentRuns ?? getDefaultAgentRunQueue(),
    workItems: () => deps.workItems === false ? undefined : deps.workItems ?? getDefaultWorkItemService(),
    proposals: () => deps.proposals === false ? undefined : deps.proposals ?? getDefaultProposalService()
  });

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
