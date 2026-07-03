import assert from "node:assert/strict";
import test from "node:test";

import {
  buildObjectivePlanningLines,
  createObjectiveService,
  type ObjectiveProgressSnapshot,
  type ObjectiveRepository
} from "./services/objectives.js";

const now = new Date("2026-07-03T08:00:00.000Z");
const workspaceId = "97000000-0000-4000-8000-000000000001";
const objectiveId = "97000000-0000-4000-8000-000000000002";
const workItemId = "97000000-0000-4000-8000-000000000003";

const objective: ObjectiveProgressSnapshot["objective"] = {
  id: objectiveId,
  workspaceId,
  title: "Raise R9 review quality",
  descriptionMd: "Use OKRs as planning input, not a workflow blocker.",
  ownerUserId: null,
  status: "active",
  progressPercent: 40,
  progressUpdatedAt: now,
  createdAt: now,
  updatedAt: now
};

const keyResult: ObjectiveProgressSnapshot["keyResults"][number] = {
  id: "97000000-0000-4000-8000-000000000011",
  objectiveId,
  workspaceId,
  seq: 1,
  title: "Every slice has adversarial review notes",
  targetValue: "100",
  currentValue: "40",
  unit: "%",
  status: "active",
  progressPercent: 40,
  createdAt: now,
  updatedAt: now
};

type ListPlanningContextInput = Parameters<ObjectiveRepository["listPlanningContextForWorkItem"]>[0];
type UpdateObjectiveProgressInput = Parameters<ObjectiveRepository["updateObjectiveProgress"]>[0];

test("R9.5 objective planning lines are concise and honest about capped context", () => {
  const lines = buildObjectivePlanningLines({
    objectives: [{
      objective,
      keyResults: [keyResult]
    }],
    objectivesCapped: true,
    keyResultsCapped: false
  });

  assert.equal(lines.capped, true);
  assert.equal(lines.objectiveId, objectiveId);
  assert.equal(lines.lines.length, 3);
  assert.match(lines.lines[0] ?? "", /Objective: Raise R9 review quality/);
  assert.match(lines.lines[0] ?? "", /40%/);
  assert.match(lines.lines[1] ?? "", /KR 1: Every slice has adversarial review notes/);
  assert.match(lines.lines[2] ?? "", /capped/u);
});

test("R9.5 objective service keeps unlinked work items non-blocking", async () => {
  const calls: unknown[] = [];
  const service = createObjectiveService({
    objectives: {
      async listPlanningContextForWorkItem(input: ListPlanningContextInput) {
        calls.push(input);
        return { objectives: [], objectivesCapped: false, keyResultsCapped: false };
      }
    } as unknown as ObjectiveRepository
  });

  const context = await service.planningContextForWorkItem({ workspaceId, workItemId });

  assert.deepEqual(calls, [{ workspaceId, workItemId }]);
  assert.deepEqual(context, { lines: [], capped: false });
});

test("R9.5 objective service refreshes objective progress from key results", async () => {
  const updates: unknown[] = [];
  const snapshot: ObjectiveProgressSnapshot = {
    objective,
    keyResults: [
      { ...keyResult, progressPercent: 25 },
      { ...keyResult, id: "97000000-0000-4000-8000-000000000012", seq: 2, progressPercent: 75 }
    ],
    linkedWorkItems: [],
    keyResultsCapped: false,
    workItemsCapped: false
  };
  const service = createObjectiveService({
    objectives: {
      async readObjectiveProgressSnapshot() {
        return snapshot;
      },
      async updateObjectiveProgress(input: UpdateObjectiveProgressInput) {
        updates.push(input);
        return { ...objective, progressPercent: input.progressPercent, progressUpdatedAt: input.progressUpdatedAt };
      }
    } as unknown as ObjectiveRepository,
    now: () => now
  });

  const result = await service.refreshObjectiveProgress({ workspaceId, objectiveId });

  assert.equal(result?.progressPercent, 50);
  assert.deepEqual(updates, [{
    workspaceId,
    objectiveId,
    progressPercent: 50,
    progressUpdatedAt: now
  }]);
});

test("R9.5 objective service falls back to linked work item completion when key results are absent", async () => {
  const updates: unknown[] = [];
  const service = createObjectiveService({
    objectives: {
      async readObjectiveProgressSnapshot() {
        return {
          objective,
          keyResults: [],
          linkedWorkItems: [
            { id: "97000000-0000-4000-8000-000000000021", status: "done" },
            { id: "97000000-0000-4000-8000-000000000022", status: "ai_working" }
          ],
          keyResultsCapped: false,
          workItemsCapped: false
        };
      },
      async updateObjectiveProgress(input: UpdateObjectiveProgressInput) {
        updates.push(input);
        return { ...objective, progressPercent: input.progressPercent, progressUpdatedAt: input.progressUpdatedAt };
      }
    } as unknown as ObjectiveRepository,
    now: () => now
  });

  const result = await service.refreshObjectiveProgress({ workspaceId, objectiveId });

  assert.equal(result?.progressPercent, 50);
  assert.equal((updates[0] as { progressPercent?: number }).progressPercent, 50);
});
