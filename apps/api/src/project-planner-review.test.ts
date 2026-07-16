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

const draftId = "22222222-0000-4000-8000-000000000001";

const unusedPlanner: ProjectPlanner = {
  async createDraft() {
    throw new Error("planner should not be called in review tests");
  }
};

function seedDraft(store: Map<string, ProjectPlanDraftRow>, status: ProjectPlanDraftStatus) {
  const now = new Date();
  store.set(draftId, {
    id: draftId,
    projectId,
    workspaceId,
    status,
    intentMd: "Ship v1",
    payloadJson: { milestones: [], items: [] },
    rationaleMd: "because",
    reviewReasonMd: null,
    decompositionContextJson: {},
    resultJson: null,
    createdByUserId: userId,
    reviewedByUserId: null,
    createdAt: now,
    updatedAt: now,
    reviewedAt: null,
    materializedAt: null
  } as ProjectPlanDraftRow);
}

function makeService(repo: ReturnType<typeof createFakeProjectPlannerRepository>["repo"], project = fakeProject()): ProjectPlannerService {
  return createProjectPlannerService({
    repo,
    projectRepo: { findProjectById: async () => project },
    timelineRepo: fakeTimelineRepo(),
    planner: unusedPlanner
  });
}

test("E3b approve moves pending_review to approved and records the reviewer", async () => {
  const { repo, store } = createFakeProjectPlannerRepository();
  seedDraft(store, "pending_review");
  const vm = await makeService(repo).approveDraft({ draftId, actor: makeActor() });
  assert.equal(vm.status, "approved");
  assert.equal(vm.reviewed_by, userId);
  assert.ok(vm.reviewed_at);
});

test("E3b approve is idempotent on an already-approved draft", async () => {
  const { repo, store } = createFakeProjectPlannerRepository();
  seedDraft(store, "approved");
  const vm = await makeService(repo).approveDraft({ draftId, actor: makeActor() });
  assert.equal(vm.status, "approved");
});

test("E3b approve conflicts on a terminal draft (rejected / materialized)", async () => {
  for (const status of ["rejected", "materialized"] as const) {
    const { repo, store } = createFakeProjectPlannerRepository();
    seedDraft(store, status);
    await assert.rejects(
      makeService(repo).approveDraft({ draftId, actor: makeActor() }),
      (e: unknown) => e instanceof ProjectPlannerServiceError && e.code === "project_plan_review_conflict" && e.status === 409
    );
  }
});

test("E3b reject requires a reason", async () => {
  const { repo, store } = createFakeProjectPlannerRepository();
  seedDraft(store, "pending_review");
  await assert.rejects(
    makeService(repo).rejectDraft({ draftId, actor: makeActor(), reasonMd: "   " }),
    (e: unknown) => e instanceof ProjectPlannerServiceError && e.code === "project_plan_reject_reason_required" && e.status === 400
  );
});

test("E3b reject moves pending_review to rejected and stores the reason", async () => {
  const { repo, store } = createFakeProjectPlannerRepository();
  seedDraft(store, "pending_review");
  const vm = await makeService(repo).rejectDraft({ draftId, actor: makeActor(), reasonMd: "Milestones are too coarse." });
  assert.equal(vm.status, "rejected");
  assert.equal(vm.review_reason_md, "Milestones are too coarse.");
  assert.equal(vm.reviewed_by, userId);
});

test("E3b reject conflicts when the draft is no longer pending", async () => {
  const { repo, store } = createFakeProjectPlannerRepository();
  seedDraft(store, "approved");
  await assert.rejects(
    makeService(repo).rejectDraft({ draftId, actor: makeActor(), reasonMd: "too late" }),
    (e: unknown) => e instanceof ProjectPlannerServiceError && e.code === "project_plan_review_conflict" && e.status === 409
  );
});

test("E3b review is gated by project management permission and draft existence", async () => {
  const { repo, store } = createFakeProjectPlannerRepository();
  seedDraft(store, "pending_review");

  // 跨工作区非管理者 → 403。
  await assert.rejects(
    makeService(repo).approveDraft({ draftId, actor: makeActor({ workspaceId: "99999999-0000-4000-8000-000000000999" }) }),
    (e: unknown) => e instanceof ProjectPlannerServiceError && e.status === 403
  );

  // 草案不存在 → 404。
  const { repo: emptyRepo } = createFakeProjectPlannerRepository();
  await assert.rejects(
    makeService(emptyRepo).getDraft({ draftId, actor: makeActor() }),
    (e: unknown) => e instanceof ProjectPlannerServiceError && e.code === "project_plan_draft_not_found" && e.status === 404
  );
});
