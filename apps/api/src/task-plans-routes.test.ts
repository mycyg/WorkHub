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
import { createProposalRoutes } from "./routes/proposals.js";
import { createTaskPlanRoutes } from "./routes/task-plans.js";
import {
  createTaskPlanMergeApprovalHandler,
  createTaskPlanWorkflowService,
  TaskPlanServiceError,
  type TaskPlanWorkflowRepository
} from "./services/task-plans.js";
import { ObjectiveServiceError } from "./services/objectives.js";
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
const objectiveId = "95000000-0000-4000-8000-000000000510";

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

class MemoryTaskPlans implements TaskPlanWorkflowRepository {
  public readonly rows = new Map<string, { status: TaskPlanStatus; input: CreateDraftTaskPlanInput }>();

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

  async approvePlan(input: { planId: string; workspaceId: string; approvedAt?: Date }): Promise<TaskPlanRow | null> {
    const row = this.rows.get(input.planId);
    if (!row || row.input.workspaceId !== input.workspaceId || row.status !== "draft") {
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

class MemoryObjectives {
  public readonly requests: Array<{ objectiveId: string; workspaceId: string }> = [];

  async getPlanningContext(input: { objectiveId: string; workspaceId: string }) {
    this.requests.push(input);
    return {
      objectiveId: input.objectiveId,
      title: "Q3 launch readiness",
      lines: [
        "Objective: Q3 launch readiness",
        "Description: Use OKR only as planning context.",
        "KR 1: Publish three evidence-backed launch notes (at_risk, 30%)"
      ]
    };
  }
}

test("R9.1 task-plan route creates a plan proposal and proposal merge approves the plan", async () => {
  const runtimeSettings = settings();
  const workItems = new WorkItems();
  const taskPlans = new MemoryTaskPlans();
  const objectives = new MemoryObjectives();
  const proposals = createInMemoryProposalService({
    now: () => now,
    id: ids([proposalId, branchId, reviewId, mergeSnapshotId]),
    onMerged: createTaskPlanMergeApprovalHandler({ taskPlans })
  });
  const plannerInputs: unknown[] = [];
  const service = createTaskPlanWorkflowService({
    taskPlans,
    objectives,
    proposals,
    id: ids([planId]),
    now: () => now,
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
              riskLevel: "high",
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
  app.route("/api/proposals", createProposalRoutes({ auth: authDeps(runtimeSettings), proposals, workItems }));
  const headers = {
    cookie: await cookie(runtimeSettings),
    "content-type": "application/json"
  };

  const created = await app.request(`/api/workitems/${workItemId}/task-plan`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      objective_id: objectiveId,
      memories: { user: ["偏好证据充分"], team: ["产出和复核分开"] }
    })
  });
  assert.equal(created.status, 201);
  const createdBody = await created.json() as {
    data: {
      plan_id: string;
      proposal_id: string;
      proposal: {
        title: string;
        diff_manifest: {
          changes: {
            target_ref: { entity_type: string; entity_id?: string };
            machine_summary?: {
              task_plan_items?: { title: string; role: string; budget_share_pct: number; risk_level: string; depends_on: string[] }[];
            };
          }[];
        };
      };
    };
  };
  assert.equal(createdBody.data.plan_id, planId);
  assert.equal(createdBody.data.proposal_id, proposalId);
  assert.equal(createdBody.data.proposal.title, "计划提议");
  assert.equal(createdBody.data.proposal.diff_manifest.changes[0]?.target_ref.entity_type, "task_plan");
  assert.equal(createdBody.data.proposal.diff_manifest.changes[0]?.target_ref.entity_id, planId);
  assert.equal(createdBody.data.proposal.diff_manifest.changes[0]?.machine_summary?.task_plan_items?.length, 3);
  assert.equal(createdBody.data.proposal.diff_manifest.changes[0]?.machine_summary?.task_plan_items?.[0]?.role, "research");
  assert.equal(createdBody.data.proposal.diff_manifest.changes[0]?.machine_summary?.task_plan_items?.[1]?.risk_level, "high");
  assert.equal(createdBody.data.proposal.diff_manifest.changes[0]?.machine_summary?.task_plan_items?.[1]?.depends_on[0], "95000000-0000-4000-8000-000000000601");
  assert.equal(taskPlans.rows.get(planId)?.status, "draft");
  assert.equal(taskPlans.rows.get(planId)?.input.objectiveId, objectiveId);
  assert.equal(taskPlans.rows.get(planId)?.input.items.length, 3);
  assert.equal(taskPlans.rows.get(planId)?.input.items[1]?.riskLevel, "high");
  assert.equal(taskPlans.rows.get(planId)?.input.budgetJson?.["max_tokens"], runtimeSettings.budgets.runTokens);
  assert.equal(taskPlans.rows.get(planId)?.input.budgetJson?.["max_cost_cny"], runtimeSettings.budgets.runCostCny);
  assert.equal(workItems.mutations.includes(workItemId), true);
  assert.deepEqual(objectives.requests, [{ objectiveId, workspaceId }]);
  assert.equal(plannerInputs.length, 1);
  assert.match(JSON.stringify(plannerInputs[0]), /Q3 launch readiness/u);

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
  assert.notEqual(workItems.status, "cancelled");
});

test("R9.5 task-plan route reports missing objective before planner or draft writes", async () => {
  const runtimeSettings = settings();
  const workItems = new WorkItems();
  const taskPlans = new MemoryTaskPlans();
  const objectiveRequests: Array<{ objectiveId: string; workspaceId: string }> = [];
  let plannerCalled = false;
  const service = createTaskPlanWorkflowService({
    taskPlans,
    objectives: {
      async getPlanningContext(input) {
        objectiveRequests.push(input);
        throw new ObjectiveServiceError(404, "objective_not_found", "没有找到这个目标，或它不属于当前工作区。");
      }
    },
    proposals: {
      async createFromManifest() {
        throw new Error("proposal service should not be called");
      }
    },
    planner: {
      async createDraft() {
        plannerCalled = true;
        throw new Error("planner should not be called");
      }
    }
  });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createTaskPlanRoutes({ auth: authDeps(runtimeSettings), service, workItems }));
  const headers = {
    cookie: await cookie(runtimeSettings),
    "content-type": "application/json"
  };

  const response = await app.request(`/api/workitems/${workItemId}/task-plan`, {
    method: "POST",
    headers,
    body: JSON.stringify({ objective_id: objectiveId })
  });

  assert.equal(response.status, 404);
  const body = await response.json() as { error: { code: string } };
  assert.equal(body.error.code, "objective_not_found");
  assert.deepEqual(objectiveRequests, [{ objectiveId, workspaceId }]);
  assert.equal(plannerCalled, false);
  assert.equal(taskPlans.rows.size, 0);
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

test("R9.1 task-plan workflow cancels its draft when proposal creation fails", async () => {
  const taskPlans = new MemoryTaskPlans();
  const service = createTaskPlanWorkflowService({
    taskPlans,
    proposals: {
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
