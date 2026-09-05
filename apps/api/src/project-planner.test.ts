import assert from "node:assert/strict";
import test from "node:test";

import type { LlmActor, LlmCreateParams, ProviderRegistry, TaskClass } from "@workhub/agent/providers";

import {
  createProjectPlanner,
  createProjectPlannerService,
  hasDependencyCycle,
  validateProjectPlan,
  ProjectPlannerServiceError,
  type ProjectPlanDraftPayload,
  type ProjectPlanner
} from "./services/project-planner.js";
import type { AuthActor } from "./middleware/auth.js";
import {
  createFakeProjectPlannerRepository,
  fakeProject,
  fakeTimelineRepo,
  makeActor,
  projectId,
  workspaceId,
  userId
} from "./project-planner-testkit.js";

// ---- LLM 起草 + judge（RecordingRegistry，照抄 meta-planner 测试的既有模式，不跑真 key）----

type RecordedCall = { actor: LlmActor | undefined; task: TaskClass; params: LlmCreateParams };

class RecordingRegistry {
  public readonly calls: RecordedCall[] = [];
  constructor(private readonly responses: unknown[], private readonly configured = true) {}
  isConfigured() {
    return this.configured;
  }
  get(actor: LlmActor | undefined, task: TaskClass) {
    return {
      messages: {
        create: async (params: LlmCreateParams) => {
          this.calls.push({ actor, task, params });
          const response = this.responses.shift();
          if (!response) {
            throw new Error("unexpected LLM call");
          }
          return {
            id: `llm-${this.calls.length}`,
            content: [{ type: "text", text: JSON.stringify(response) }],
            usage: { inputTokens: 10, outputTokens: 20 }
          };
        }
      }
    };
  }
}

function validPlan() {
  return {
    milestones: [{ ref: "m1", title: "Phase 1", due_at: "2026-08-01T00:00:00Z", sort: 0 }],
    items: [
      { ref: "t1", title: "Research the topic", objective_md: "Gather 3 sources.", due_at: "2026-07-20T00:00:00Z", milestone_ref: "m1", depends_on_refs: [], assignee_suggestion: null },
      { ref: "t2", title: "Draft the plan doc", objective_md: "Write the plan.", due_at: "2026-07-25T00:00:00Z", milestone_ref: "m1", depends_on_refs: ["t1"], assignee_suggestion: "alice" }
    ],
    rationale_md: "Research first, then draft; both land under Phase 1."
  };
}

const plannerInput = {
  actor: { id: userId, userId, workspaceId, label: "PM" } satisfies LlmActor,
  locale: "en-US" as const,
  project: { id: projectId, name: "Launch WorkHub", workspaceId },
  intent: "Ship v1 by August with research then a plan doc.",
  currentState: ["Milestone: Kickoff [open]"]
};

test("E3a project planner drafts a plan, judge approves, returns auditable payload", async () => {
  const registry = new RecordingRegistry([
    validPlan(),
    { decision: "approve", confidence: "high", reasons: ["coherent"] }
  ]);
  const planner = createProjectPlanner({ providerRegistry: registry as unknown as ProviderRegistry });
  const draft = await planner.createDraft(plannerInput);

  assert.equal(registry.calls.length, 2);
  assert.deepEqual(registry.calls.map((call) => call.task), ["decompose", "decompose"]);
  assert.match(String(registry.calls[0]?.params.system), /strict JSON/i);
  // 项目现状喂进上下文，防止规划出重复项。
  assert.match(String(registry.calls[0]?.params.messages[0]?.content), /Milestone: Kickoff/u);
  assert.match(String(registry.calls[0]?.params.messages[0]?.content), /Ship v1 by August/u);
  assert.equal(draft.payload.milestones.length, 1);
  assert.equal(draft.payload.items.length, 2);
  assert.deepEqual(draft.payload.items[1]?.dependsOnRefs, ["t1"]);
  assert.equal(draft.payload.items[1]?.milestoneRef, "m1");
  assert.equal(draft.rationaleMd, "Research first, then draft; both land under Phase 1.");
});

test("E3a judge retry then approve reruns the draft once", async () => {
  const registry = new RecordingRegistry([
    validPlan(),
    { decision: "retry", confidence: "low", reasons: ["milestones too vague"] },
    validPlan(),
    { decision: "approve", confidence: "high", reasons: ["ok"] }
  ]);
  const planner = createProjectPlanner({ providerRegistry: registry as unknown as ProviderRegistry });
  const draft = await planner.createDraft(plannerInput);
  assert.equal(registry.calls.length, 4);
  assert.equal(draft.payload.items.length, 2);
});

test("E3a judge escalate goes straight to a human without burning another LLM round", async () => {
  const registry = new RecordingRegistry([
    validPlan(),
    { decision: "escalate", confidence: "low", reasons: ["scope ambiguous"] },
    validPlan(),
    { decision: "approve", confidence: "high", reasons: ["ok"] }
  ]);
  const planner = createProjectPlanner({ providerRegistry: registry as unknown as ProviderRegistry });
  await assert.rejects(
    planner.createDraft(plannerInput),
    (error: unknown) => error instanceof ProjectPlannerServiceError && error.code === "project_plan_needs_human" && error.status === 409
  );
  assert.equal(registry.calls.length, 2);
});

test("E3a a structurally broken draft retries then escalates without ever asking the judge", async () => {
  const cyclic = validPlan();
  cyclic.items[0]!.depends_on_refs = ["t2"]; // t1 <-> t2 cycle
  const registry = new RecordingRegistry([cyclic, cyclic]);
  const planner = createProjectPlanner({ providerRegistry: registry as unknown as ProviderRegistry });
  await assert.rejects(
    planner.createDraft(plannerInput),
    (error: unknown) => error instanceof ProjectPlannerServiceError && error.code === "project_plan_needs_human"
  );
  // 两次都结构不过（成环），judge 从没被调用。
  assert.equal(registry.calls.length, 2);
});

test("E3a a cyclic first draft that self-corrects on retry is accepted", async () => {
  const cyclic = validPlan();
  cyclic.items[0]!.depends_on_refs = ["t2"];
  const registry = new RecordingRegistry([
    cyclic,
    validPlan(),
    { decision: "approve", confidence: "high", reasons: ["ok"] }
  ]);
  const planner = createProjectPlanner({ providerRegistry: registry as unknown as ProviderRegistry });
  const draft = await planner.createDraft(plannerInput);
  // 第一次结构不过（无 judge 调用），第二次结构过 + judge approve。
  assert.equal(registry.calls.length, 3);
  assert.equal(draft.payload.items.length, 2);
});

test("E3a planner returns 503 when the LLM is not configured", async () => {
  const registry = new RecordingRegistry([], false);
  const planner = createProjectPlanner({ providerRegistry: registry as unknown as ProviderRegistry });
  await assert.rejects(
    planner.createDraft(plannerInput),
    (error: unknown) => error instanceof ProjectPlannerServiceError && error.code === "project_plan_llm_unavailable" && error.status === 503
  );
  assert.equal(registry.calls.length, 0);
});

// ---- 确定性校验（结构 / 环 / 日期不倒挂）----

test("E3a validateProjectPlan catches cycles, unknown refs, self-deps, and inverted dates", () => {
  assert.deepEqual(validateProjectPlan(validPlan() as never), []);

  const unknownMilestone = validPlan();
  unknownMilestone.items[0]!.milestone_ref = "ghost";
  assert.ok(validateProjectPlan(unknownMilestone as never).some((e) => /unknown milestone/u.test(e)));

  const unknownDep = validPlan();
  unknownDep.items[1]!.depends_on_refs = ["ghost"];
  assert.ok(validateProjectPlan(unknownDep as never).some((e) => /unknown item/u.test(e)));

  const selfDep = validPlan();
  selfDep.items[1]!.depends_on_refs = ["t2"];
  assert.ok(validateProjectPlan(selfDep as never).some((e) => /depends on itself/u.test(e)));

  // 依赖倒挂：t2 依赖 t1，但 t2 的 due 早于 t1 的 due。
  const invertedDep = validPlan();
  invertedDep.items[0]!.due_at = "2026-07-30T00:00:00Z";
  invertedDep.items[1]!.due_at = "2026-07-25T00:00:00Z";
  assert.ok(validateProjectPlan(invertedDep as never).some((e) => /due before its dependency/u.test(e)));

  // 里程碑倒挂：工作项 due 晚于其里程碑 due。
  const invertedMilestone = validPlan();
  invertedMilestone.milestones[0]!.due_at = "2026-07-10T00:00:00Z";
  invertedMilestone.items[1]!.due_at = "2026-07-25T00:00:00Z";
  assert.ok(validateProjectPlan(invertedMilestone as never).some((e) => /due after its milestone/u.test(e)));
});

test("E3a hasDependencyCycle detects a back edge", () => {
  assert.equal(hasDependencyCycle([
    { ref: "a", dependsOnRefs: ["b"] },
    { ref: "b", dependsOnRefs: [] }
  ]), false);
  assert.equal(hasDependencyCycle([
    { ref: "a", dependsOnRefs: ["b"] },
    { ref: "b", dependsOnRefs: ["a"] }
  ]), true);
});

// ---- createDraft 工作流 service ----

const samplePayload: ProjectPlanDraftPayload = {
  milestones: [{ ref: "m1", title: "Phase 1", dueAt: null, sort: 0 }],
  items: [
    { ref: "t1", title: "Research", objectiveMd: "Do research", dueAt: null, milestoneRef: "m1", dependsOnRefs: [], assigneeSuggestion: null },
    { ref: "t2", title: "Build", objectiveMd: "Build it", dueAt: null, milestoneRef: "m1", dependsOnRefs: ["t1"], assigneeSuggestion: "alice" }
  ]
};

function recordingPlanner(): { calls: unknown[]; planner: ProjectPlanner } {
  const calls: unknown[] = [];
  return {
    calls,
    planner: {
      async createDraft(input) {
        calls.push(input);
        return { payload: samplePayload, rationaleMd: "because", decompositionContext: { source: "project-planner" } };
      }
    }
  };
}

test("E3a createDraft stores a pending_review draft and feeds project state to the planner", async () => {
  const { repo, store } = createFakeProjectPlannerRepository();
  const { calls, planner } = recordingPlanner();
  const service = createProjectPlannerService({
    repo,
    projectRepo: { findProjectById: async (id) => (id === projectId ? fakeProject() : null) },
    timelineRepo: fakeTimelineRepo({
      milestones: [{ id: "mid", projectId, title: "Kickoff", dueAt: null, sort: 0, status: "open", createdAt: new Date(), updatedAt: new Date(), deletedAt: null }],
      items: [{ id: "wid", code: "L-1", title: "Existing task", status: "spec_ready" }]
    }),
    planner,
    id: (() => { let n = 0; return () => `00000000-0000-4000-8000-00000000010${n++}`; })()
  });

  const vm = await service.createDraft({ projectId, actor: makeActor(), intent: "  Ship v1  ", locale: "en-US" });
  assert.equal(vm.status, "pending_review");
  assert.equal(vm.intent_md, "Ship v1");
  assert.equal(vm.milestones.length, 1);
  assert.equal(vm.items.length, 2);
  assert.equal(vm.items[1]?.milestone_ref, "m1");
  assert.equal(store.size, 1);

  const plannerCall = calls[0] as { intent: string; currentState: string[] };
  assert.equal(plannerCall.intent, "Ship v1");
  assert.ok(plannerCall.currentState.some((line) => /Kickoff/u.test(line)));
  assert.ok(plannerCall.currentState.some((line) => /Existing task/u.test(line)));
});

test("E3a createDraft feeds the latest human rejection reason back into the next draft", async () => {
  const { repo, store } = createFakeProjectPlannerRepository();
  store.set("prev", {
    id: "prev", projectId, workspaceId, status: "rejected", intentMd: "old",
    payloadJson: { milestones: [], items: [] }, rationaleMd: null,
    reviewReasonMd: "Please add a QA milestone.", decompositionContextJson: {}, resultJson: null,
    createdByUserId: userId, reviewedByUserId: userId,
    createdAt: new Date(Date.now() - 1000), updatedAt: new Date(), reviewedAt: new Date(), materializedAt: null
  } as never);
  const { calls, planner } = recordingPlanner();
  const service = createProjectPlannerService({
    repo,
    projectRepo: { findProjectById: async () => fakeProject() },
    timelineRepo: fakeTimelineRepo(),
    planner
  });
  await service.createDraft({ projectId, actor: makeActor(), intent: "Ship v1" });
  const plannerCall = calls[0] as { rejectionFeedback?: string[] };
  assert.deepEqual(plannerCall.rejectionFeedback, ["Please add a QA milestone."]);
});

test("E3a createDraft enforces permission, project existence, workspace, and intent", async () => {
  const { repo } = createFakeProjectPlannerRepository();
  const { planner } = recordingPlanner();
  const base = { repo, timelineRepo: fakeTimelineRepo(), planner };

  // 无权（跨工作区非管理者）→ 403。
  const forbidden = createProjectPlannerService({ ...base, projectRepo: { findProjectById: async () => fakeProject() } });
  await assert.rejects(
    forbidden.createDraft({ projectId, actor: makeActor({ workspaceId: "99999999-0000-4000-8000-000000000999" }), intent: "x" }),
    (e: unknown) => e instanceof ProjectPlannerServiceError && e.status === 403
  );

  // 项目不存在 → 404。
  const missing = createProjectPlannerService({ ...base, projectRepo: { findProjectById: async () => null } });
  await assert.rejects(
    missing.createDraft({ projectId, actor: makeActor(), intent: "x" }),
    (e: unknown) => e instanceof ProjectPlannerServiceError && e.status === 404
  );

  // 项目 owner 但无工作区 → CORE-07 起租户栅栏 fail-closed，栅栏处即 403（admin 同——
  // projectScopeMatches 对 null workspaceId 一律不匹配；服务端 422 分支留作纵深防御）。
  const noWorkspace = createProjectPlannerService({
    ...base,
    projectRepo: { findProjectById: async () => fakeProject({ workspaceId: null, ownerUserId: userId }) }
  });
  await assert.rejects(
    noWorkspace.createDraft({ projectId, actor: { id: userId, userId } as AuthActor, intent: "x" }),
    (e: unknown) => e instanceof ProjectPlannerServiceError && e.status === 403
  );
  await assert.rejects(
    noWorkspace.createDraft({
      projectId,
      actor: { id: userId, userId, isAdmin: true, orgId: "00000000-0000-4000-8000-000000000001" } as AuthActor,
      intent: "x"
    }),
    (e: unknown) => e instanceof ProjectPlannerServiceError && e.status === 403
  );

  // 空意图 → 400。
  const empty = createProjectPlannerService({ ...base, projectRepo: { findProjectById: async () => fakeProject() } });
  await assert.rejects(
    empty.createDraft({ projectId, actor: makeActor(), intent: "   " }),
    (e: unknown) => e instanceof ProjectPlannerServiceError && e.code === "project_plan_intent_required" && e.status === 400
  );
});
