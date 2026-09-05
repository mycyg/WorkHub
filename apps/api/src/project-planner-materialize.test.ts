import assert from "node:assert/strict";
import test from "node:test";

import {
  createProjectPlannerService,
  ProjectPlannerServiceError,
  type ProjectPlanner,
  type ProjectPlannerService
} from "./services/project-planner.js";
import type { ProjectPlanDraftRow, ProjectPlanDraftStatus } from "@workhub/db";
import {
  createFakeProjectPlannerRepository,
  fakeProject,
  fakeTimelineRepo,
  makeActor,
  projectId,
  workspaceId,
  userId
} from "./project-planner-testkit.js";

const draftId = "33333333-0000-4000-8000-000000000001";

const unusedPlanner: ProjectPlanner = {
  async createDraft() {
    throw new Error("planner should not be called in materialize tests");
  }
};

type SeedOptions = {
  status?: ProjectPlanDraftStatus;
  payload?: Record<string, unknown>;
  resultJson?: Record<string, unknown> | null;
};

function seedDraft(store: Map<string, ProjectPlanDraftRow>, options: SeedOptions = {}) {
  const now = new Date();
  store.set(draftId, {
    id: draftId,
    projectId,
    workspaceId,
    status: options.status ?? "approved",
    intentMd: "Ship v1",
    payloadJson: options.payload ?? {
      milestones: [{ ref: "m1", title: "Phase 1", due_at: null, sort: 0 }],
      items: [
        { ref: "t1", title: "Research", objective_md: "Gather sources", due_at: null, milestone_ref: "m1", depends_on_refs: [], assignee_suggestion: null },
        { ref: "t2", title: "Draft", objective_md: "Write it", due_at: null, milestone_ref: "m1", depends_on_refs: ["t1"], assignee_suggestion: "alice" }
      ]
    },
    rationaleMd: "because",
    reviewReasonMd: null,
    decompositionContextJson: {},
    resultJson: options.resultJson ?? null,
    createdByUserId: userId,
    reviewedByUserId: userId,
    createdAt: now,
    updatedAt: now,
    reviewedAt: now,
    materializedAt: options.status === "materialized" ? now : null
  } as ProjectPlanDraftRow);
}

function sequentialId() {
  let n = 0;
  return () => `44444444-0000-4000-8000-00000000000${n++}`;
}

function makeService(harness: ReturnType<typeof createFakeProjectPlannerRepository>, id = sequentialId()): ProjectPlannerService {
  return createProjectPlannerService({
    repo: harness.repo,
    projectRepo: { findProjectById: async () => fakeProject() },
    timelineRepo: fakeTimelineRepo(),
    planner: unusedPlanner,
    id
  });
}

test("E3c materialize resolves refs to ids and creates milestones, work items, and dependencies", async () => {
  const harness = createFakeProjectPlannerRepository();
  seedDraft(harness.store);
  // ids: 0=m1, 1=t1, 2=t2（service 先里程碑后工作项，按 payload 顺序生成）。
  const { draft, result } = await makeService(harness).materialize({ draftId, actor: makeActor() });

  assert.equal(draft.status, "materialized");
  assert.equal(result.milestoneIds.length, 1);
  assert.equal(result.workItemIds.length, 2);
  assert.equal(result.dependencyCount, 1);

  assert.equal(harness.materializeCalls.length, 1);
  const call = harness.materializeCalls[0]!;
  assert.equal(call.submitterUserId, userId);
  assert.equal(call.milestones.length, 1);
  assert.equal(call.workItems.length, 2);
  // 工作项挂在解析后的里程碑 id 上，且用合法初始态 spec_ready，objective_md 落 objectiveMd。
  assert.equal(call.workItems[0]?.milestoneId, call.milestones[0]?.id);
  assert.equal(call.workItems[0]?.status, "spec_ready");
  assert.equal(call.workItems[0]?.objectiveMd, "Gather sources");
  // 依赖边解析成真 id：t2 依赖 t1。
  assert.equal(call.dependencies.length, 1);
  assert.equal(call.dependencies[0]?.workItemId, call.workItems[1]?.id);
  assert.equal(call.dependencies[0]?.dependsOnWorkItemId, call.workItems[0]?.id);
  // 物化结果 id 清单存回草案。
  assert.deepEqual(draft.result?.work_item_ids, result.workItemIds);
});

test("E3c materialize rolls back and rejects when a cycle slips past the judge", async () => {
  const harness = createFakeProjectPlannerRepository();
  seedDraft(harness.store, {
    payload: {
      milestones: [],
      items: [
        { ref: "a", title: "A", objective_md: "a", due_at: null, milestone_ref: null, depends_on_refs: ["b"], assignee_suggestion: null },
        { ref: "b", title: "B", objective_md: "b", due_at: null, milestone_ref: null, depends_on_refs: ["a"], assignee_suggestion: null }
      ]
    }
  });
  await assert.rejects(
    makeService(harness).materialize({ draftId, actor: makeActor() }),
    (e: unknown) => e instanceof ProjectPlannerServiceError && e.code === "project_plan_cycle_detected" && e.status === 409
  );
  // 整体不物化：repo.materialize 从没被调用，无任何工作项创建。
  assert.equal(harness.materializeCalls.length, 0);
  // 草案被打回 rejected，带原因。
  const draft = harness.store.get(draftId)!;
  assert.equal(draft.status, "rejected");
  // A2-68：打回原因写业务口径的人话，不出现「物化 / 成环 / judge 漏网」这些内部词。
  assert.match(draft.reviewReasonMd ?? "", /互相依赖成了死循环/u);
  assert.doesNotMatch(draft.reviewReasonMd ?? "", /物化|成环|judge/iu);
});

test("E3c materialize is idempotent: an already-materialized draft returns its stored result", async () => {
  const harness = createFakeProjectPlannerRepository();
  seedDraft(harness.store, {
    status: "materialized",
    resultJson: {
      milestone_ids: ["m-id-1"],
      work_item_ids: ["w-id-1", "w-id-2"],
      dependency_count: 1
    }
  });
  const { draft, result } = await makeService(harness).materialize({ draftId, actor: makeActor() });
  assert.equal(draft.status, "materialized");
  assert.deepEqual(result.workItemIds, ["w-id-1", "w-id-2"]);
  assert.equal(result.dependencyCount, 1);
  // 幂等短路：不再重复建。
  assert.equal(harness.materializeCalls.length, 0);
});

test("E3c materialize refuses a draft that is not approved", async () => {
  const harness = createFakeProjectPlannerRepository();
  seedDraft(harness.store, { status: "pending_review" });
  await assert.rejects(
    makeService(harness).materialize({ draftId, actor: makeActor() }),
    (e: unknown) => e instanceof ProjectPlannerServiceError && e.code === "project_plan_not_approved" && e.status === 409
  );
  assert.equal(harness.materializeCalls.length, 0);
});

test("E3c materialize is gated by project management permission", async () => {
  const harness = createFakeProjectPlannerRepository();
  seedDraft(harness.store);
  await assert.rejects(
    makeService(harness).materialize({ draftId, actor: makeActor({ workspaceId: "99999999-0000-4000-8000-000000000999" }) }),
    (e: unknown) => e instanceof ProjectPlannerServiceError && e.status === 403
  );
  assert.equal(harness.materializeCalls.length, 0);
});
