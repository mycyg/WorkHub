import assert from "node:assert/strict";
import test from "node:test";

import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { loadSettings, type Settings } from "@workhub/config";
import type { TaskPlanStatus, WorkItemDetailVM } from "@workhub/contracts";
import type {
  ClientDeviceAuthRow,
  ClientDeviceRepository,
  CreateDraftTaskPlanInput,
  TaskPlanRow,
  UserAuthRow,
  UserRepository
} from "@workhub/db";

import { httpErrorCodeFor } from "./http-error-codes.js";
import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "./middleware/auth.js";
import { createProposalRoutes, createWorkItemProposalRoutes } from "./routes/proposals.js";
import { createTaskPlanRoutes } from "./routes/task-plans.js";
import {
  createTaskPlanMergeApprovalHandler,
  createTaskPlanReviewRejectionHandler,
  createTaskPlanWorkflowService,
  TaskPlanServiceError,
  type TaskPlanWorkflowRepository
} from "./services/task-plans.js";
import { createInMemoryProposalService, ProposalServiceError } from "./services/proposals.js";
import { WorkItemServiceError, type WorkItemService } from "./services/work-items.js";

const now = new Date("2026-07-03T00:00:00.000Z");
const userId = "95000000-0000-4000-8000-000000000501";
const workspaceId = "95000000-0000-4000-8000-000000000502";
const projectId = "95000000-0000-4000-8000-000000000503";
const workItemId = "95000000-0000-4000-8000-000000000504";
const planId = "95000000-0000-4000-8000-000000000505";
const proposalId = "95000000-0000-4000-8000-000000000506";
const branchId = "95000000-0000-4000-8000-000000000507";
const reviewId = "95000000-0000-4000-8000-000000000508";
const mergeSnapshotId = "95000000-0000-4000-8000-000000000509";
const foreignWorkItemId = "95000000-0000-4000-8000-000000000510";
const foreignPlanId = "95000000-0000-4000-8000-000000000511";
const objectiveId = "95000000-0000-4000-8000-000000000512";
const regeneratedPlanId = "95000000-0000-4000-8000-000000000513";
const regeneratedProposalId = "95000000-0000-4000-8000-000000000514";
const regeneratedBranchId = "95000000-0000-4000-8000-000000000515";

function user(): UserAuthRow {
  return {
    id: userId,
    nickname: "task-plan-reviewer",
    cookieToken: "cookie-task-plan-reviewer",
    preferredLocale: "zh-CN",
    availabilityStatus: "free",
    availabilityText: null,
    availabilityUpdatedAt: null,
    mutedNotificationTypes: [],
    isAdmin: false,
    deletedAt: null,
    deletedByUserId: null,
    createdAt: now,
    updatedAt: now
  };
}

class MemoryUsers implements UserRepository {
  async findActiveById(id: string) {
    return id === userId ? user() : null;
  }

  async findActiveByCookieToken(cookieToken: string) {
    return cookieToken === "cookie-task-plan-reviewer" ? user() : null;
  }

  async findActiveByNickname() {
    return null;
  }

  async createUser(): Promise<UserAuthRow> {
    throw new Error("not needed");
  }

  async getOrCreateActiveByNickname(): Promise<{ user: UserAuthRow; created: boolean }> {
    throw new Error("not needed");
  }

  async rotateCookieToken() {
    return null;
  }
}

class MemoryDevices implements ClientDeviceRepository {
  async findActiveByTokenHash() {
    return null;
  }

  async findActiveByTokenHashForUser() {
    return null;
  }

  async createClientDevice(): Promise<ClientDeviceAuthRow> {
    throw new Error("not needed");
  }

  async listByUser() {
    return [];
  }

  async touchLastSeen() {
    return null;
  }

  async revokeByIdForUser() {
    return null;
  }

  async revokeByTokenHash() {
    return null;
  }
}

function settings(): Settings {
  return loadSettings({
    APP_ENV: "test",
    COOKIE_SECRET: "test-cookie-secret"
  });
}

function authDeps(runtimeSettings: Settings): AuthDependencies {
  return {
    users: new MemoryUsers(),
    devices: new MemoryDevices(),
    settings: runtimeSettings,
    now: () => now
  };
}

async function cookie(runtimeSettings: Settings) {
  return generateSignedCookie(COOKIE_NAME, "cookie-task-plan-reviewer", runtimeSettings.auth.cookieSecret);
}

function withErrors(app: Hono<AuthEnv>) {
  app.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json({ ok: false, error: { code: "validation_error", message: "invalid payload" } }, 422);
    }
    if (error instanceof TaskPlanServiceError) {
      return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as 400);
    }
    if (error instanceof ProposalServiceError) {
      return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as 400);
    }
    if (error instanceof WorkItemServiceError) {
      return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as 400);
    }
    const coded = error as { status?: unknown; code?: unknown; message?: unknown };
    if (typeof coded.status === "number" && typeof coded.code === "string") {
      return c.json({
        ok: false,
        error: {
          code: coded.code,
          message: typeof coded.message === "string" ? coded.message : "operation failed"
        }
      }, coded.status as 400);
    }
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: httpErrorCodeFor(error), message: error.message } }, error.status);
    }
    throw error;
  });
  return app;
}

function ids(values: string[]) {
  let index = 0;
  return () => {
    const value = values[index];
    index += 1;
    if (!value) {
      throw new Error("id sequence exhausted");
    }
    return value;
  };
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function detail(status = "spec_ready"): WorkItemDetailVM {
  const iso = now.toISOString();
  return {
    workitem: {
      id: workItemId,
      code: "WH-950",
      project_id: projectId,
      workspace_id: workspaceId,
      submitter_user_id: userId,
      title: "调研并产出一篇短剧选题报告",
      raw_description: "请先调研短剧选题，再产出一篇可审的中文短报告。",
      status: status as WorkItemDetailVM["workitem"]["status"],
      priority: "normal",
      sync_state: "synced",
      version: 1,
      mode: "worker",
      human_reserved: false,
      created_at: iso,
      updated_at: iso
    },
    project_name: "R9 Lab",
    acceptance: [
      { body_md: "拆成 3-5 个原子子任务。" },
      { body_md: "每个子任务都有可验收标准。" }
    ],
    agent_trace_preview: [],
    accepted_deliverables: [],
    evidence_refs: [],
    actions: {}
  };
}

class WorkItems implements Pick<WorkItemService, "detailPage" | "assertCanMutateArtifacts"> {
  public status: WorkItemDetailVM["workitem"]["status"] = "spec_ready";
  public readonly mutations: string[] = [];

  async detailPage() {
    return detail(this.status);
  }

  async assertCanMutateArtifacts(input: { workItemId: string }) {
    this.mutations.push(input.workItemId);
  }
}

test("R9.7 task-plan route maps duplicate draft workflow errors without the test error shim", async () => {
  const runtimeSettings = settings();
  const workItems = new WorkItems();
  const app = new Hono<AuthEnv>();
  app.route("/api", createTaskPlanRoutes({
    auth: authDeps(runtimeSettings),
    workItems,
    service: {
      async createPlanProposal() {
        throw new TaskPlanServiceError(409, "task_plan_draft_in_progress", "任务计划正在生成，请稍后刷新查看。");
      }
    }
  }));
  const response = await app.request(`/api/workitems/${workItemId}/task-plan`, {
    method: "POST",
    headers: {
      cookie: await cookie(runtimeSettings),
      "content-type": "application/json"
    },
    body: JSON.stringify({})
  });

  assert.equal(response.status, 409);
  const body = await response.json() as { ok: boolean; error: { code: string; message: string } };
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "task_plan_draft_in_progress");
  assert.match(body.error.message, /正在生成/);
});

class MemoryTaskPlans implements TaskPlanWorkflowRepository {
  public readonly rows = new Map<string, { status: TaskPlanStatus; input: CreateDraftTaskPlanInput }>();

  async findDraftPlanForWorkItem(input: { workItemId: string; workspaceId: string }): Promise<TaskPlanRow | null> {
    for (const [planId, row] of this.rows) {
      if (row.status === "draft" && row.input.workItemId === input.workItemId && row.input.workspaceId === input.workspaceId) {
        return this.rowFor(planId, now);
      }
    }
    return null;
  }

  async createDraftPlan(input: CreateDraftTaskPlanInput) {
    this.rows.set(input.id, { status: "draft", input });
  }

  async cancelDraftPlan(input: { planId: string; workspaceId: string; cancelledAt?: Date }): Promise<TaskPlanRow | null> {
    const row = this.rows.get(input.planId);
    if (!row || row.input.workspaceId !== input.workspaceId || row.status !== "draft") {
      return null;
    }
    row.status = "cancelled";
    return this.rowFor(input.planId, input.cancelledAt ?? now);
  }

  async approvePlan(input: { planId: string; workspaceId: string; workItemId: string; approvedAt?: Date }): Promise<TaskPlanRow | null> {
    const row = this.rows.get(input.planId);
    if (!row || row.input.workspaceId !== input.workspaceId || row.input.workItemId !== input.workItemId || row.status !== "draft") {
      return null;
    }
    row.status = "approved";
    return this.rowFor(input.planId, input.approvedAt ?? now);
  }

  private rowFor(planId: string, updatedAt: Date): TaskPlanRow | null {
    const row = this.rows.get(planId);
    if (!row) {
      return null;
    }
    return {
      id: row.input.id,
      workItemId: row.input.workItemId,
      workspaceId: row.input.workspaceId,
      status: row.status,
      objectiveId: row.input.objectiveId ?? null,
      budgetJson: row.input.budgetJson ?? {},
      decompositionContextJson: row.input.decompositionContextJson ?? {},
      createdByUserId: row.input.createdByUserId,
      createdAt: row.input.now ?? now,
      updatedAt
    } as TaskPlanRow;
  }
}

test("R9.1 task-plan route creates a plan proposal and proposal merge approves the plan", async () => {
  const runtimeSettings = settings();
  const workItems = new WorkItems();
  const taskPlans = new MemoryTaskPlans();
  const proposals = createInMemoryProposalService({
    now: () => now,
    id: ids([proposalId, branchId, reviewId, mergeSnapshotId]),
    onMerged: createTaskPlanMergeApprovalHandler({ taskPlans })
  });
  const dispatchedPlans: Array<{ planId: string; workspaceId: string; orgId?: string; actorId?: string }> = [];
  const plannerInputs: unknown[] = [];
  const memoryReads: unknown[] = [];
  const service = createTaskPlanWorkflowService({
    taskPlans,
    proposals,
    id: ids([planId]),
    now: () => now,
    // B-R9.1-2：记忆一律服务端读——请求体里的伪造 memories 必须被无视。
    userMemories: {
      async listForUser(userId, options) {
        memoryReads.push({ userMemoryLookup: { userId, workspaceId: options?.workspaceId } });
        return [{ valueMd: "服务端用户记忆：偏好证据充分" } as never];
      }
    },
    teamSkills: {
      async listActive(listWorkspaceId) {
        memoryReads.push({ teamSkillLookup: { workspaceId: listWorkspaceId } });
        return [{ contentMd: "服务端团队技能：产出和复核分开" } as never];
      }
    },
    objectives: {
      async planningContextForWorkItem(input) {
        plannerInputs.push({ objectiveLookup: input });
        return { lines: ["Objective: Raise R9 review quality (40%)"], capped: false, objectiveId };
      }
    },
    planner: {
      async createDraft(input) {
        plannerInputs.push(input);
        return {
          items: [
            {
              id: "95000000-0000-4000-8000-000000000601",
              seq: 0,
              title: "调研短剧选题证据",
              role: "research",
              objectiveMd: "收集短剧选题相关证据。",
              acceptanceMd: "至少列出 3 条可核验来源。",
              budgetSharePct: 35,
              dependsOn: []
            },
            {
              id: "95000000-0000-4000-8000-000000000602",
              seq: 1,
              title: "产出短报告",
              role: "produce",
              objectiveMd: "基于证据写出中文短报告。",
              acceptanceMd: "报告包含结论、证据和下一步建议。",
              budgetSharePct: 45,
              dependsOn: ["95000000-0000-4000-8000-000000000601"]
            },
            {
              id: "95000000-0000-4000-8000-000000000603",
              seq: 2,
              title: "复核验收覆盖",
              role: "review",
              objectiveMd: "检查计划是否覆盖验收条件。",
              acceptanceMd: "每条验收条件都被映射到子任务。",
              budgetSharePct: 20,
              dependsOn: ["95000000-0000-4000-8000-000000000602"]
            }
          ],
          decompositionContext: { judge: "approved" }
        };
      }
    }
  });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createTaskPlanRoutes({ auth: authDeps(runtimeSettings), service, workItems }));
  app.route("/api/proposals", createProposalRoutes({
    auth: authDeps(runtimeSettings),
    proposals,
    workItems,
    taskPlanDispatcher: {
      async dispatch(input: { planId: string; workspaceId: string; orgId?: string; actorId?: string }) {
        dispatchedPlans.push(input);
        return { planId: input.planId, enqueuedItemIds: ["95000000-0000-4000-8000-000000000601"], skippedItemIds: [], casMissItemIds: [], completed: false };
      }
    }
  }));
  const headers = {
    cookie: await cookie(runtimeSettings),
    "content-type": "application/json"
  };

  const created = await app.request(`/api/workitems/${workItemId}/task-plan`, {
    method: "POST",
    headers,
    // B-R9.1-2 注入面回归：请求体伪造的 memories 必须被无视（服务端读的记忆才进 planner）。
    body: JSON.stringify({ memories: { user: ["伪造的注入偏好"], team: ["伪造的注入技能"] } })
  });
  assert.equal(created.status, 201);
  const createdBody = await created.json() as {
    data: {
      plan_id: string;
      proposal_id: string;
      proposal: {
        title: string;
        diff_manifest: {
          summary_md?: string;
          checks?: { detail?: string }[];
          rollback?: { description?: string };
          changes: { target_ref: { entity_type: string; entity_id?: string } }[];
        };
      };
    };
  };
  assert.equal(createdBody.data.plan_id, planId);
  assert.equal(createdBody.data.proposal_id, proposalId);
  assert.equal(createdBody.data.proposal.title, "计划提议");
  assert.doesNotMatch(JSON.stringify(createdBody.data.proposal.diff_manifest), /dispatch|派发|meta-planner|judge|判官/iu);
  assert.equal(createdBody.data.proposal.diff_manifest.changes[0]?.target_ref.entity_type, "task_plan");
  assert.equal(createdBody.data.proposal.diff_manifest.changes[0]?.target_ref.entity_id, planId);
  assert.equal(taskPlans.rows.get(planId)?.status, "draft");
  assert.equal(taskPlans.rows.get(planId)?.input.objectiveId, objectiveId);
  assert.equal(taskPlans.rows.get(planId)?.input.items.length, 3);
  assert.equal(workItems.mutations.includes(workItemId), true);
  assert.equal(plannerInputs.length, 2);
  assert.deepEqual(plannerInputs[0], { objectiveLookup: { workspaceId, workItemId } });
  const plannerMemories = (plannerInputs[1] as {
    memories?: { user?: string[]; team?: string[]; objectives?: string[] };
  }).memories;
  assert.deepEqual(plannerMemories?.objectives, ["Objective: Raise R9 review quality (40%)"]);
  // B-R9.1-2：planner 收到的 user/team 记忆来自服务端仓库，请求体伪造串一个都不能出现。
  assert.deepEqual(plannerMemories?.user, ["服务端用户记忆：偏好证据充分"]);
  assert.deepEqual(plannerMemories?.team, ["服务端团队技能：产出和复核分开"]);
  assert.doesNotMatch(JSON.stringify(plannerInputs), /伪造的注入/u);
  assert.deepEqual(memoryReads, [
    { userMemoryLookup: { userId, workspaceId } },
    { teamSkillLookup: { workspaceId } }
  ]);

  const reviewed = await app.request(`/api/proposals/${proposalId}/review`, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "approve" })
  });
  assert.equal(reviewed.status, 200);

  const merged = await app.request(`/api/proposals/${proposalId}/merge`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });
  assert.equal(merged.status, 200);
  assert.equal(taskPlans.rows.get(planId)?.status, "approved");
  assert.deepEqual(dispatchedPlans, [{ planId, workspaceId, orgId: "00000000-0000-4000-8000-000000000001", actorId: userId }]);
  assert.notEqual(workItems.status, "cancelled");
});

test("R9.7 task-plan merge does not report success when post-approval dispatch fails", async () => {
  const runtimeSettings = settings();
  const workItems = new WorkItems();
  const taskPlans = new MemoryTaskPlans();
  const proposals = createInMemoryProposalService({
    now: () => now,
    id: ids([proposalId, branchId, reviewId, mergeSnapshotId]),
    onMerged: createTaskPlanMergeApprovalHandler({ taskPlans })
  });
  const service = createTaskPlanWorkflowService({
    taskPlans,
    proposals,
    id: ids([planId]),
    now: () => now,
    planner: {
      async createDraft() {
        return {
          items: [{
            id: "95000000-0000-4000-8000-000000000611",
            seq: 0,
            title: "执行首个子任务",
            role: "produce" as const,
            objectiveMd: "验证合并后 dispatch 失败不会让 HTTP 响应伪装成未合并。",
            acceptanceMd: "合并结果和通知事件仍然可见。",
            budgetSharePct: 100,
            dependsOn: []
          }],
          decompositionContext: { judge: "approved" }
        };
      }
    }
  });
  const publishedEvents: string[] = [];
  const warnings: Array<{ message: string; detail: unknown }> = [];
  const dispatchedPlans: Array<{ planId: string; workspaceId: string; orgId?: string; actorId?: string }> = [];
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createTaskPlanRoutes({ auth: authDeps(runtimeSettings), service, workItems }));
  app.route("/api/proposals", createProposalRoutes({
    auth: authDeps(runtimeSettings),
    proposals,
    workItems,
    taskPlanDispatcher: {
      async dispatch(input) {
        dispatchedPlans.push(input);
        if (dispatchedPlans.length === 1) {
          throw Object.assign(new Error("dispatch unavailable"), { status: 503, code: "task_dispatch_failed" });
        }
        return {
          planId: input.planId,
          enqueuedItemIds: ["95000000-0000-4000-8000-000000000611"],
          skippedItemIds: [],
          casMissItemIds: [],
          completed: false
        };
      }
    },
    bus: {
      async publish(_topic, type) {
        publishedEvents.push(type);
      }
    },
    logger: {
      warn(message, detail) {
        warnings.push({ message, detail });
      }
    }
  }));
  const headers = {
    cookie: await cookie(runtimeSettings),
    "content-type": "application/json"
  };

  const created = await app.request(`/api/workitems/${workItemId}/task-plan`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });
  assert.equal(created.status, 201);
  const createdBody = await created.json() as { data: { proposal_id: string } };

  const reviewed = await app.request(`/api/proposals/${createdBody.data.proposal_id}/review`, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "approve" })
  });
  assert.equal(reviewed.status, 200);

  const merged = await app.request(`/api/proposals/${createdBody.data.proposal_id}/merge`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });

  // R9.7 redline: the old assertion expected HTTP 200 because the proposal merge was durable,
  // but that hid a failed child-run dispatch from the user and left no decision-inbox recovery path.
  assert.equal(merged.status, 503);
  const body = await merged.json() as { error: { code: string; message: string } };
  assert.equal(body.error.code, "task_plan_dispatch_failed");
  assert.equal(body.error.message, "任务计划已经批准，但子任务启动失败，请稍后刷新后重试。");
  assert.equal(body.error.message.includes("派发"), false);
  assert.equal(taskPlans.rows.get(planId)?.status, "approved");
  assert.deepEqual(
    publishedEvents.filter((type) => type === "proposal.merged" || type === "notification.created"),
    []
  );
  assert.equal(warnings[0]?.message, "WorkHub task-plan dispatch after proposal merge failed");

  const retry = await app.request(`/api/proposals/${createdBody.data.proposal_id}/merge`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });

  assert.equal(retry.status, 200);
  const retryBody = await retry.json() as { ok: true; data: { status: string; attention: { summary_text: string } } };
  assert.equal(retryBody.data.status, "merged");
  assert.equal(retryBody.data.attention.summary_text, "任务计划已批准，子任务会开始执行。");
  assert.deepEqual(dispatchedPlans, [
    { planId, workspaceId, orgId: "00000000-0000-4000-8000-000000000001", actorId: userId },
    { planId, workspaceId, orgId: "00000000-0000-4000-8000-000000000001", actorId: userId }
  ]);
  assert.deepEqual(
    publishedEvents.filter((type) => type === "proposal.merged" || type === "notification.created"),
    ["proposal.merged", "notification.created"]
  );
});

test("R9.7 task-plan merge can approve without dispatching when held", async () => {
  const runtimeSettings = settings();
  const workItems = new WorkItems();
  const taskPlans = new MemoryTaskPlans();
  const proposals = createInMemoryProposalService({
    now: () => now,
    id: ids([proposalId, branchId, reviewId, mergeSnapshotId]),
    onMerged: createTaskPlanMergeApprovalHandler({ taskPlans })
  });
  const service = createTaskPlanWorkflowService({
    taskPlans,
    proposals,
    id: ids([planId]),
    now: () => now,
    planner: {
      async createDraft() {
        return {
          items: [{
            id: "95000000-0000-4000-8000-000000000622",
            seq: 0,
            title: "执行首个子任务",
            role: "produce" as const,
            objectiveMd: "验证批准但暂缓时不会启动子任务。",
            acceptanceMd: "计划变成 approved，dispatcher 不被调用。",
            budgetSharePct: 100,
            dependsOn: []
          }],
          decompositionContext: { judge: "approved" }
        };
      }
    }
  });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createTaskPlanRoutes({ auth: authDeps(runtimeSettings), service, workItems }));
  app.route("/api/proposals", createProposalRoutes({
    auth: authDeps(runtimeSettings),
    proposals,
    workItems,
    taskPlanDispatcher: {
      async dispatch() {
        throw Object.assign(new Error("dispatch should not run for approve_hold"), { status: 503, code: "unexpected_dispatch" });
      }
    }
  }));
  const headers = {
    cookie: await cookie(runtimeSettings),
    "content-type": "application/json"
  };

  const created = await app.request(`/api/workitems/${workItemId}/task-plan`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });
  assert.equal(created.status, 201);
  const createdBody = await created.json() as { data: { proposal_id: string } };

  const reviewed = await app.request(`/api/proposals/${createdBody.data.proposal_id}/review`, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "approve" })
  });
  assert.equal(reviewed.status, 200);

  const merged = await app.request(`/api/proposals/${createdBody.data.proposal_id}/merge`, {
    method: "POST",
    headers,
    body: JSON.stringify({ dispatch: false })
  });

  assert.equal(merged.status, 200);
  const body = await merged.json() as {
    ok: true;
    data: {
      status: string;
      attention: {
        summary_text: string;
        actions: Array<{
          id: string;
          label: string;
          method: string;
          href: string;
          request_json?: Record<string, unknown>;
        }>;
      };
    };
  };
  assert.equal(body.data.status, "merged");
  assert.equal(body.data.attention.summary_text, "任务计划已批准，暂不开始执行。");
  const startAction = body.data.attention.actions.find((action) => action.id === "start_task_plan");
  assert.equal(startAction?.label, "开始执行计划");
  assert.equal(startAction?.method, "POST");
  assert.equal(startAction?.href, `/api/proposals/${createdBody.data.proposal_id}/merge`);
  assert.deepEqual(startAction?.request_json, { dispatch: true });
  assert.equal(JSON.stringify(body.data.attention.actions).includes("派发"), false);
  assert.equal(taskPlans.rows.get(planId)?.status, "approved");
});

test("R9.7 task-plan rejection cancels the draft so the work item can regenerate a plan", async () => {
  const runtimeSettings = settings();
  const workItems = new WorkItems();
  const taskPlans = new MemoryTaskPlans();
  const proposals = createInMemoryProposalService({
    now: () => now,
    id: ids([proposalId, branchId, reviewId, regeneratedProposalId, regeneratedBranchId]),
    onRejected: createTaskPlanReviewRejectionHandler({ taskPlans })
  });
  const plannerInputs: unknown[] = [];
  const service = createTaskPlanWorkflowService({
    taskPlans,
    proposals,
    id: ids([planId, regeneratedPlanId]),
    now: () => now,
    planner: {
      async createDraft(input) {
        plannerInputs.push(input);
        return {
          items: [{
            id: plannerInputs.length === 1
              ? "95000000-0000-4000-8000-000000000651"
              : "95000000-0000-4000-8000-000000000652",
            seq: 0,
            title: "重生成任务计划",
            role: "produce" as const,
            objectiveMd: "用户打回后按反馈重新生成任务计划。",
            acceptanceMd: "旧 draft 不再阻止新的任务计划。",
            budgetSharePct: 100,
            dependsOn: []
          }],
          decompositionContext: { judge: "approved" }
        };
      }
    }
  });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createTaskPlanRoutes({ auth: authDeps(runtimeSettings), service, workItems }));
  app.route("/api/proposals", createProposalRoutes({
    auth: authDeps(runtimeSettings),
    proposals,
    workItems,
    taskPlanDispatcher: false
  }));
  const headers = {
    cookie: await cookie(runtimeSettings),
    "content-type": "application/json"
  };

  const created = await app.request(`/api/workitems/${workItemId}/task-plan`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });
  assert.equal(created.status, 201);
  const createdBody = await created.json() as { data: { proposal_id: string; plan_id: string } };
  assert.equal(createdBody.data.plan_id, planId);
  assert.equal(taskPlans.rows.get(planId)?.status, "draft");

  const rejected = await app.request(`/api/proposals/${createdBody.data.proposal_id}/review`, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "request_changes", reason_md: "请把产出和复核拆得更清楚。" })
  });
  assert.equal(rejected.status, 200);

  const regenerated = await app.request(`/api/workitems/${workItemId}/task-plan`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });

  assert.equal(regenerated.status, 201);
  const regeneratedBody = await regenerated.json() as { data: { proposal_id: string; plan_id: string } };
  assert.equal(regeneratedBody.data.plan_id, regeneratedPlanId);
  assert.equal(regeneratedBody.data.proposal_id, regeneratedProposalId);
  assert.equal(taskPlans.rows.get(planId)?.status, "cancelled");
  assert.equal(taskPlans.rows.get(regeneratedPlanId)?.status, "draft");
  assert.equal(plannerInputs.length, 2);
  // R9.1 workbench-reject（ux-flow-spec §3.2）：打回理由必须回灌重拆 planner——
  // 服务端从 review 记录读，第一次生成时不存在、重拆时逐字带上。
  assert.equal(
    (plannerInputs[0] as { rejectionFeedback?: string[] }).rejectionFeedback,
    undefined
  );
  assert.deepEqual(
    (plannerInputs[1] as { rejectionFeedback?: string[] }).rejectionFeedback,
    ["请把产出和复核拆得更清楚。"]
  );
});

test("R9.1 task-plan merge fails loudly when approval does not update the plan", async () => {
  const runtimeSettings = settings();
  const workItems = new WorkItems();
  const taskPlans = new MemoryTaskPlans();
  const approvalRepo = {
    async approvePlan(): Promise<TaskPlanRow | null> {
      return null;
    }
  };
  const proposals = createInMemoryProposalService({
    now: () => now,
    id: ids([proposalId, branchId, reviewId, mergeSnapshotId]),
    onMerged: createTaskPlanMergeApprovalHandler({ taskPlans: approvalRepo })
  });
  const service = createTaskPlanWorkflowService({
    taskPlans,
    proposals,
    id: ids([planId]),
    now: () => now,
    planner: {
      async createDraft() {
        return {
          items: [{
            id: "95000000-0000-4000-8000-000000000701",
            seq: 0,
            title: "确认计划可审批",
            role: "review" as const,
            objectiveMd: "确认任务计划审批链路不会静默失败。",
            acceptanceMd: "审批失败时 HTTP 响应必须显式失败。",
            budgetSharePct: 100,
            dependsOn: []
          }],
          decompositionContext: { judge: "approved" }
        };
      }
    }
  });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createTaskPlanRoutes({ auth: authDeps(runtimeSettings), service, workItems }));
  app.route("/api/proposals", createProposalRoutes({ auth: authDeps(runtimeSettings), proposals, workItems }));
  const headers = {
    cookie: await cookie(runtimeSettings),
    "content-type": "application/json"
  };

  const created = await app.request(`/api/workitems/${workItemId}/task-plan`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });
  assert.equal(created.status, 201);
  const createdBody = await created.json() as { data: { proposal_id: string } };

  const reviewed = await app.request(`/api/proposals/${createdBody.data.proposal_id}/review`, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "approve" })
  });
  assert.equal(reviewed.status, 200);

  const merged = await app.request(`/api/proposals/${createdBody.data.proposal_id}/merge`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });

  assert.equal(merged.status, 409);
  const body = await merged.json() as { error: { code: string } };
  assert.equal(body.error.code, "task_plan_approval_failed");
  assert.equal(taskPlans.rows.get(planId)?.status, "draft");
});

test("R9.7 task-plan proposal merge cannot approve a plan from a different work item", async () => {
  const runtimeSettings = settings();
  const workItems = new WorkItems();
  const taskPlans = new MemoryTaskPlans();
  await taskPlans.createDraftPlan({
    id: planId,
    workItemId,
    workspaceId,
    budgetJson: {},
    decompositionContextJson: {},
    createdByUserId: userId,
    items: [],
    now
  });
  await taskPlans.createDraftPlan({
    id: foreignPlanId,
    workItemId: foreignWorkItemId,
    workspaceId,
    budgetJson: {},
    decompositionContextJson: {},
    createdByUserId: userId,
    items: [],
    now
  });
  const proposals = createInMemoryProposalService({
    now: () => now,
    id: ids([proposalId, branchId, reviewId, mergeSnapshotId]),
    onMerged: createTaskPlanMergeApprovalHandler({ taskPlans })
  });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createWorkItemProposalRoutes({ auth: authDeps(runtimeSettings), proposals, workItems }));
  app.route("/api/proposals", createProposalRoutes({ auth: authDeps(runtimeSettings), proposals, workItems }));
  const headers = {
    cookie: await cookie(runtimeSettings),
    "content-type": "application/json"
  };

  const created = await app.request(`/api/workitems/${workItemId}/proposals`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      manifest: {
        version: 0,
        work_item_id: workItemId,
        title: "篡改计划提议",
        summary_md: "这份提议挂在当前事项上，但 manifest 指向另一个事项的任务计划。",
        author: { actor_kind: "ai", label: "WorkHub Meta-Planner" },
        base: { created_at: now.toISOString() },
        changes: [{
          id: foreignPlanId,
          target_kind: "structured_record",
          target_ref: {
            entity_type: "task_plan",
            entity_id: foreignPlanId,
            path: `/workspaces/${workspaceId}/task-plans/${foreignPlanId}`
          },
          change_type: "generated",
          human_summary: "恶意指向另一个事项的任务计划。",
          machine_summary: {
            changed_fields: ["task_plan_items"],
            generated_content_md: "1. 外部事项计划"
          }
        }],
        checks: [],
        evidence_refs: [],
        risk: {
          level: "low",
          human_label: "低风险",
          reversible: true
        },
        rollback: {
          available: false,
          description: "测试用 manifest"
        },
        review: {
          suggested_decision: "needs_human",
          reason_required_on_reject: true
        }
      }
    })
  });
  assert.equal(created.status, 201);

  const reviewed = await app.request(`/api/proposals/${proposalId}/review`, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "approve" })
  });
  assert.equal(reviewed.status, 200);

  const merged = await app.request(`/api/proposals/${proposalId}/merge`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });

  assert.equal(merged.status, 409);
  const body = await merged.json() as { error: { code: string } };
  assert.equal(body.error.code, "task_plan_approval_failed");
  assert.equal(taskPlans.rows.get(planId)?.status, "draft");
  assert.equal(taskPlans.rows.get(foreignPlanId)?.status, "draft");
});

test("R9.1 task-plan workflow cancels its draft when proposal creation fails", async () => {
  const taskPlans = new MemoryTaskPlans();
  const service = createTaskPlanWorkflowService({
    taskPlans,
    proposals: {
      async listByWorkItem() {
        return [];
      },
      async createFromManifest() {
        throw new ProposalServiceError(409, "proposal_already_exists", "proposal already exists");
      }
    },
    id: ids([planId]),
    now: () => now,
    planner: {
      async createDraft() {
        return {
          items: [{
            id: "95000000-0000-4000-8000-000000000801",
            seq: 0,
            title: "生成计划草稿",
            role: "produce" as const,
            objectiveMd: "生成一个将被补偿取消的草稿。",
            acceptanceMd: "proposal 写入失败后草稿不保持 draft。",
            budgetSharePct: 100,
            dependsOn: []
          }],
          decompositionContext: { judge: "approved" }
        };
      }
    }
  });

  await assert.rejects(
    service.createPlanProposal({
      detail: detail(),
      actor: { id: userId, userId, workspaceId, label: "Planner PM" },
      locale: "zh-CN"
    }),
    (error: unknown) => error instanceof ProposalServiceError
      && error.status === 409
      && error.code === "proposal_already_exists"
  );
  assert.equal(taskPlans.rows.get(planId)?.status, "cancelled");
});

test("R9.7 task-plan workflow rejects a second draft request while the first planner call is still running", async () => {
  const taskPlans = new MemoryTaskPlans();
  const proposals = createInMemoryProposalService({
    now: () => now,
    id: ids([proposalId, branchId, reviewId, mergeSnapshotId])
  });
  const plannerStarted = deferred();
  const releasePlanner = deferred();
  let plannerCalls = 0;
  const service = createTaskPlanWorkflowService({
    taskPlans,
    proposals,
    id: ids([planId]),
    now: () => now,
    planner: {
      async createDraft() {
        plannerCalls += 1;
        plannerStarted.resolve();
        await releasePlanner.promise;
        return {
          items: [{
            id: "95000000-0000-4000-8000-000000000901",
            seq: 0,
            title: "整理 R9.7 验证结果",
            role: "produce" as const,
            objectiveMd: "整理真实用户验证暴露的结果。",
            acceptanceMd: "只生成一份待审计划。",
            budgetSharePct: 100,
            dependsOn: []
          }],
          decompositionContext: { source: "single-flight-test" }
        };
      }
    }
  });

  const first = service.createPlanProposal({
    detail: detail(),
    actor: { id: userId, userId, workspaceId, label: "Planner PM" },
    locale: "zh-CN"
  });
  await plannerStarted.promise;

  await assert.rejects(
    service.createPlanProposal({
      detail: detail(),
      actor: { id: userId, userId, workspaceId, label: "Planner PM" },
      locale: "zh-CN"
    }),
    (error: unknown) => error instanceof TaskPlanServiceError
      && error.status === 409
      && error.code === "task_plan_draft_in_progress"
  );
  assert.equal(plannerCalls, 1);

  releasePlanner.resolve();
  const firstResult = await first;
  assert.equal(firstResult.planId, planId);
  assert.equal(taskPlans.rows.size, 1);
});

test("R9.7 task-plan workflow rejects a new draft when the work item already has one", async () => {
  const taskPlans = new MemoryTaskPlans();
  await taskPlans.createDraftPlan({
    id: planId,
    workItemId,
    workspaceId,
    budgetJson: {},
    decompositionContextJson: {},
    createdByUserId: userId,
    items: [],
    now
  });
  let plannerCalls = 0;
  const service = createTaskPlanWorkflowService({
    taskPlans,
    proposals: createInMemoryProposalService({ now: () => now, id: ids([proposalId, branchId, reviewId, mergeSnapshotId]) }),
    id: ids([foreignPlanId]),
    now: () => now,
    planner: {
      async createDraft() {
        plannerCalls += 1;
        throw new Error("planner must not run when a draft already exists");
      }
    }
  });

  await assert.rejects(
    service.createPlanProposal({
      detail: detail(),
      actor: { id: userId, userId, workspaceId, label: "Planner PM" },
      locale: "zh-CN"
    }),
    (error: unknown) => error instanceof TaskPlanServiceError
      && error.status === 409
      && error.code === "task_plan_draft_exists"
  );
  assert.equal(plannerCalls, 0);
  assert.deepEqual([...taskPlans.rows.keys()], [planId]);
});
