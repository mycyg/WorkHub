import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { normalizeWorkHubLocale } from "@workhub/contracts";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthActor,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  getDefaultTaskPlanWorkflowService,
  TaskPlanServiceError,
  type TaskPlanWorkflowService
} from "../services/task-plans.js";
import {
  getDefaultWorkItemService,
  type WorkItemService
} from "../services/work-items.js";
import { getDefaultTaskDispatcher, type TaskDispatcher } from "../services/task-dispatcher.js";
import { getDefaultAgentRunQueue } from "../workers/agent-runner.js";
import {
  createTaskPlanRepository,
  getSharedDatabaseClient
} from "@workhub/db";
import { readJsonObject } from "./json-body.js";
import { isUuidParam } from "./uuid-param.js";

// B-R9.1-2（branch-review 注入面）：请求体禁止携带 memories——那是可伪造的
// 「团队记忆」直入 planner prompt 的注入面。记忆一律服务端读 user_memories/team_skills。
// body 里多余字段（含旧客户端残留的 memories）静默忽略，保持向后兼容。
const taskPlanRequestSchema = z.object({}).passthrough().default({});

type TaskPlanRepositoryForRoutes = Pick<
  ReturnType<typeof createTaskPlanRepository>,
  "getPlanWithItems" | "pausePlan" | "resumePlan"
>;

export type TaskPlanRoutesDependencies = {
  auth?: AuthDependencySource;
  service?: TaskPlanWorkflowService;
  workItems?: Pick<WorkItemService, "detailPage" | "assertCanMutateArtifacts"> | false;
  // B-R9.6 §3.1：暂停/恢复派发的存储与恢复后立即续跑的派发器。
  plans?: TaskPlanRepositoryForRoutes;
  taskDispatcher?: Pick<TaskDispatcher, "dispatch"> | false;
};

function requireWorkItemId(value: string) {
  if (!isUuidParam(value)) {
    throw new HTTPException(404, { message: "没有找到这个事项。" });
  }
  return value;
}

function requirePlanId(value: string) {
  if (!isUuidParam(value)) {
    throw new HTTPException(404, { message: "没有找到这个任务计划。" });
  }
  return value;
}

function actorForPlanner(actor: AuthActor) {
  return {
    id: actor.userId ?? actor.id,
    userId: actor.userId ?? actor.id,
    ...(actor.workspaceId ? { workspaceId: actor.workspaceId } : {}),
    label: actor.label
  };
}

export function createTaskPlanRoutes(deps: TaskPlanRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const service = deps.service ?? getDefaultTaskPlanWorkflowService();
  const workItems = deps.workItems === false ? undefined : deps.workItems ?? getDefaultWorkItemService();
  let defaultPlans: TaskPlanRepositoryForRoutes | undefined;
  const plans = () => {
    if (deps.plans) {
      return deps.plans;
    }
    defaultPlans ??= createTaskPlanRepository(getSharedDatabaseClient().db);
    return defaultPlans;
  };
  const dispatcher = () => (deps.taskDispatcher === false
    ? undefined
    : deps.taskDispatcher ?? getDefaultTaskDispatcher(getDefaultAgentRunQueue()));

  // B-R9.6 §3.1：暂停/恢复共享的「找计划 + 写级鉴权」前置。鉴权走工作项 mutate 门
  // （与 B-R9.0-1 升级写动作同一道 fence），找不到/跨工作区一律 404 不泄露存在性。
  async function requireMutablePlan(c: { req: { param: (key: string) => string }; var: { actor: AuthActor } }) {
    if (!workItems) {
      throw new HTTPException(403, { message: "没有权限修改这个事项。" });
    }
    const planId = requirePlanId(c.req.param("planId"));
    const workspaceId = c.var.actor.workspaceId;
    if (!workspaceId) {
      throw new HTTPException(404, { message: "没有找到这个任务计划。" });
    }
    const loaded = await plans().getPlanWithItems({ planId, workspaceId, itemLimit: 0 });
    if (!loaded) {
      throw new HTTPException(404, { message: "没有找到这个任务计划。" });
    }
    await workItems.assertCanMutateArtifacts({ workItemId: loaded.plan.workItemId, actor: c.var.actor });
    return { planId, workspaceId, plan: loaded.plan };
  }

  routes.post("/task-plans/:planId/pause", createCurrentUserMiddleware(authSource), async (c) => {
    const { planId, workspaceId } = await requireMutablePlan(c);
    const paused = await plans().pausePlan({ planId, workspaceId });
    if (!paused) {
      return c.json({
        ok: false,
        error: { code: "task_plan_pause_conflict", message: "这个军团当前不在派发中，无法暂停。刷新看看最新状态。" }
      }, 409);
    }
    return c.json({ ok: true, data: { plan_id: planId, status: paused.status } });
  });

  routes.post("/task-plans/:planId/resume", createCurrentUserMiddleware(authSource), async (c) => {
    const { planId, workspaceId } = await requireMutablePlan(c);
    const resumed = await plans().resumePlan({ planId, workspaceId });
    if (!resumed) {
      return c.json({
        ok: false,
        error: { code: "task_plan_resume_conflict", message: "这个军团不在暂停状态，无法恢复。刷新看看最新状态。" }
      }, 409);
    }
    // 恢复后立即踢一次派发让就绪子任务续跑；踢失败回滚到 paused 并 503，
    // 保持按钮语义幂等（再点一次即重试），不留「显示已恢复但没人动」的假状态。
    const kick = dispatcher();
    if (kick) {
      try {
        await kick.dispatch({ planId, workspaceId });
      } catch {
        await plans().pausePlan({ planId, workspaceId });
        return c.json({
          ok: false,
          error: { code: "task_plan_resume_dispatch_failed", message: "恢复失败，请稍后再点一次。" }
        }, 503);
      }
    }
    return c.json({ ok: true, data: { plan_id: planId, status: resumed.status } });
  });

  routes.post("/workitems/:id/task-plan", createCurrentUserMiddleware(authSource), async (c) => {
    if (!workItems) {
      throw new HTTPException(403, { message: "没有权限修改这个事项。" });
    }
    const workItemId = requireWorkItemId(c.req.param("id"));
    await workItems.assertCanMutateArtifacts({ workItemId, actor: c.var.actor });
    taskPlanRequestSchema.parse(await readJsonObject(c));
    const detail = await workItems.detailPage({ workItemId, actor: c.var.actor });
    let result;
    try {
      result = await service.createPlanProposal({
        detail,
        actor: actorForPlanner(c.var.actor),
        locale: normalizeWorkHubLocale(c.req.query("locale") ?? c.req.header("Accept-Language"))
      });
    } catch (error) {
      if (error instanceof TaskPlanServiceError) {
        return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as 400);
      }
      throw error;
    }
    const { reviews: _reviews, ...proposal } = result.proposal;
    return c.json({
      ok: true,
      data: {
        plan_id: result.planId,
        proposal_id: proposal.id,
        proposal_href: `/proposals/${proposal.id}`,
        proposal
      }
    }, 201);
  });

  return routes;
}
