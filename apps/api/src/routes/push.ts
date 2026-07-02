import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { getDefaultPushBus, getDefaultPresenceStore, type PresenceStore, type PushBus } from "../broker/index.js";
import { isUuidParam } from "./uuid-param.js";
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

function streamActor(user: { id: string; nickname: string; isAdmin: boolean; orgId: string; workspaceId: string }): AuthActor {
  return {
    kind: "human",
    id: user.id,
    label: user.nickname,
    userId: user.id,
    isAdmin: user.isAdmin,
    // findings[#tenancy]：用认证身份解析出的真实租户，不再硬编码 'stream'。
    orgId: user.orgId,
    workspaceId: user.workspaceId
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

function runScopeMatches(run: { org_id?: string; workspace_id?: string }, user: { orgId: string; workspaceId: string }) {
  if (run.workspace_id && run.workspace_id !== user.workspaceId) {
    return false;
  }
  if (run.org_id && run.org_id !== user.orgId) {
    return false;
  }
  return true;
}

function createDefaultTopicAccess(input: {
  agentRuns: AgentRunQueue;
  workItems: () => WorkItemService | undefined;
  proposals: () => ProposalService | undefined;
}): TopicAccessResolver {
  return {
    async canViewRun(user, id) {
      const run = await input.agentRuns.get(id);
      if (!run) {
        return false;
      }
      if (!runScopeMatches(run, user)) {
        return false;
      }
      if (run.actor_id === user.id || user.isAdmin) {
        return true;
      }
      return canReadByWorkItemService(input.workItems(), user, run.work_item_id);
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
    // EC-1：非 UUID 的 :id 会一路打到 PG uuid 列 → 22P02 → 500。这里先校验,和未授权一样回 403(不泄露存在性),
    // 与 12 个用 isUuidParam/requireUuidParam 守 :id 的兄弟路由对齐。下同 req/run/session/proposal。
    if (!isUuidParam(c.req.param("id"))) {
      throw new HTTPException(403, { message: "cannot stream this work item" });
    }
    const authDeps = resolveAuthDependencies(authSource);
    const user = await resolveStreamUser(c, authDeps);
    const topic = await resolveAuthorizedTopic(user, { kind: "workitem", id: c.req.param("id") }, access);
    return writeEventStream(c, bus, presence, topic, user, deps.stream);
  });

  routes.get("/stream/req/:id", async (c) => {
    if (!isUuidParam(c.req.param("id"))) {
      throw new HTTPException(403, { message: "cannot stream this work item" });
    }
    const authDeps = resolveAuthDependencies(authSource);
    const user = await resolveStreamUser(c, authDeps);
    const topic = await resolveAuthorizedTopic(user, { kind: "workitem", id: c.req.param("id") }, access);
    return writeEventStream(c, bus, presence, topic, user, deps.stream);
  });

  routes.get("/stream/run/:id", async (c) => {
    if (!isUuidParam(c.req.param("id"))) {
      throw new HTTPException(403, { message: "cannot stream this agent run" });
    }
    const authDeps = resolveAuthDependencies(authSource);
    const user = await resolveStreamUser(c, authDeps);
    const topic = await resolveAuthorizedTopic(user, { kind: "run", id: c.req.param("id") }, access);
    return writeEventStream(c, bus, presence, topic, user, deps.stream);
  });

  routes.get("/stream/session/:id", async (c) => {
    if (!isUuidParam(c.req.param("id"))) {
      throw new HTTPException(403, { message: "cannot stream this session" });
    }
    const authDeps = resolveAuthDependencies(authSource);
    const user = await resolveStreamUser(c, authDeps);
    const topic = await resolveAuthorizedTopic(user, { kind: "session", id: c.req.param("id") }, access);
    return writeEventStream(c, bus, presence, topic, user, deps.stream);
  });

  routes.get("/stream/proposal/:id", async (c) => {
    if (!isUuidParam(c.req.param("id"))) {
      throw new HTTPException(403, { message: "cannot stream this proposal" });
    }
    const authDeps = resolveAuthDependencies(authSource);
    const user = await resolveStreamUser(c, authDeps);
    const topic = await resolveAuthorizedTopic(user, { kind: "proposal", id: c.req.param("id") }, access);
    return writeEventStream(c, bus, presence, topic, user, deps.stream);
  });

  return routes;
}
