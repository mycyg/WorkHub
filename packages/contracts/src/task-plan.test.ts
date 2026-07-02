import assert from "node:assert/strict";
import test from "node:test";

import {
  taskPlanItemRoleSchema,
  taskPlanItemStatusSchema,
  taskPlanStatusSchema,
  taskPlanVmSchema
} from "./index.js";

const planId = "91000000-0000-4000-8000-000000000001";
const researchItemId = "91000000-0000-4000-8000-000000000011";
const produceItemId = "91000000-0000-4000-8000-000000000012";

test("R9.1 task plan VM carries auditable roles, acceptance, dependencies, and budget shares", () => {
  const parsed = taskPlanVmSchema.parse({
    id: planId,
    work_item_id: "91000000-0000-4000-8000-000000000002",
    workspace_id: "91000000-0000-4000-8000-000000000003",
    status: "proposed",
    objective_id: null,
    budget_json: { total_share_pct: 100, max_tokens: 24000 },
    decomposition_context_json: { source: "meta_planner", memory_refs: 2 },
    created_by: "91000000-0000-4000-8000-000000000004",
    created_at: "2026-07-03T00:00:00.000Z",
    updated_at: "2026-07-03T00:01:00.000Z",
    items_capped: false,
    items: [
      {
        id: researchItemId,
        plan_id: planId,
        parent_item_id: null,
        seq: 1,
        title: "整理竞品证据",
        role: "research",
        objective_md: "查清三类竞品的最新打法。",
        acceptance_md: "列出至少 3 条可核验来源。",
        budget_share_pct: 35,
        depends_on: [],
        status: "pending",
        created_at: "2026-07-03T00:00:00.000Z",
        updated_at: "2026-07-03T00:00:00.000Z"
      },
      {
        id: produceItemId,
        plan_id: planId,
        parent_item_id: null,
        seq: 2,
        title: "产出短报告",
        role: "produce",
        objective_md: "把证据整理成短报告。",
        acceptance_md: "报告包含结论、证据和下一步建议。",
        budget_share_pct: 65,
        depends_on: [researchItemId],
        status: "pending",
        created_at: "2026-07-03T00:00:00.000Z",
        updated_at: "2026-07-03T00:00:00.000Z"
      }
    ]
  });

  assert.equal(parsed.status, "proposed");
  assert.equal(parsed.items[0]?.role, "research");
  assert.deepEqual(parsed.items[1]?.depends_on, [researchItemId]);
  assert.equal(parsed.items[1]?.budget_share_pct, 65);
});

test("R9.1 task plan enums reject raw planner-only labels at the contract boundary", () => {
  assert.equal(taskPlanStatusSchema.parse("approved"), "approved");
  assert.equal(taskPlanItemRoleSchema.parse("integrate"), "integrate");
  assert.equal(taskPlanItemStatusSchema.parse("dispatched"), "dispatched");

  assert.throws(() => taskPlanStatusSchema.parse("running"));
  assert.throws(() => taskPlanItemRoleSchema.parse("manager"));
  assert.throws(() => taskPlanItemStatusSchema.parse("blocked"));
  assert.throws(() => taskPlanVmSchema.parse({
    id: planId,
    work_item_id: "91000000-0000-4000-8000-000000000002",
    workspace_id: "91000000-0000-4000-8000-000000000003",
    status: "draft",
    budget_json: {},
    decomposition_context_json: {},
    created_by: "91000000-0000-4000-8000-000000000004",
    created_at: "2026-07-03T00:00:00.000Z",
    updated_at: "2026-07-03T00:01:00.000Z",
    items: [{
      id: researchItemId,
      plan_id: planId,
      seq: 1,
      title: "bad budget",
      role: "research",
      objective_md: "x",
      acceptance_md: "x",
      budget_share_pct: 101,
      depends_on: [],
      status: "pending",
      created_at: "2026-07-03T00:00:00.000Z",
      updated_at: "2026-07-03T00:00:00.000Z"
    }]
  }));
});
