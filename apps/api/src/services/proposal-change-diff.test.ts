import assert from "node:assert/strict";
import test from "node:test";

import type { DeliverableChange } from "@workhub/contracts";

import { buildProposalChangeDiffVm } from "./proposal-change-diff.js";

function change(overrides: Partial<DeliverableChange> = {}): DeliverableChange {
  return {
    id: "70000000-0000-4000-8000-000000000001",
    target_kind: "text_doc",
    target_ref: { entity_type: "drive_item", path: "/outputs/report.md" },
    change_type: "updated",
    human_summary: "改了一下报告",
    machine_summary: { generated_content_md: "intro\nnew middle\ntail" },
    ...overrides
  };
}

const baseInput = {
  proposalId: "10000000-0000-4000-8000-000000000001",
  status: "opened" as const,
  title: "周报草稿"
};

test("buildProposalChangeDiffVm diffs base against proposed and marks base available", () => {
  const vm = buildProposalChangeDiffVm({
    ...baseInput,
    change: change(),
    baseText: "intro\nold middle\ntail"
  });
  assert.equal(vm.base_available, true);
  assert.equal(vm.filename, "report.md");
  assert.equal(vm.path, "/outputs/report.md");
  assert.equal(vm.status, "opened");
  assert.deepEqual(vm.segments, [
    { type: "context", lines: ["intro"] },
    { type: "del", lines: ["old middle"] },
    { type: "add", lines: ["new middle"] },
    { type: "context", lines: ["tail"] }
  ]);
});

test("buildProposalChangeDiffVm treats a created change as all-add even with null base", () => {
  const vm = buildProposalChangeDiffVm({
    ...baseInput,
    change: change({ change_type: "created", machine_summary: { generated_content_md: "brand\nnew" } }),
    baseText: null
  });
  assert.equal(vm.base_available, true);
  assert.deepEqual(vm.segments, [{ type: "add", lines: ["brand", "new"] }]);
});

test("buildProposalChangeDiffVm degrades honestly when base cannot be resolved (no fake all-add)", () => {
  const vm = buildProposalChangeDiffVm({
    ...baseInput,
    change: change({ machine_summary: { generated_content_md: "proposed line" } }),
    baseText: null
  });
  assert.equal(vm.base_available, false);
  // proposed shown as plain context, not painted green — the editor renders a "base unavailable" banner.
  assert.deepEqual(vm.segments, [{ type: "context", lines: ["proposed line"] }]);
});

test("buildProposalChangeDiffVm falls back to the entity type when the path has no leaf", () => {
  const vm = buildProposalChangeDiffVm({
    ...baseInput,
    change: change({ target_ref: { entity_type: "spec_doc" }, machine_summary: { generated_content_md: "x" } }),
    baseText: null
  });
  assert.equal(vm.filename, "spec_doc");
  assert.equal(vm.path, "");
});
