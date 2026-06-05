import assert from "node:assert/strict";
import test from "node:test";

import { createP05GoldPathFixture } from "@workhub/agent/fixtures";

import { renderProposalDetail } from "./render.js";

test("proposal renderer keeps the change package shape visible", () => {
  const vm = createP05GoldPathFixture().proposalDetail;
  const rendered = renderProposalDetail(vm, "web");

  assert.equal(rendered.proposalId, vm.proposal_id);
  assert.equal(rendered.workItemId, vm.work_item_id);
  assert.equal(rendered.changeCount, vm.manifest.changes.length);
  assert.equal(rendered.evidenceCount, vm.evidence_refs.length);
  assert.equal(rendered.cuuState, "carrying_document");
  assert.equal(rendered.html.includes("Deliverable change request"), true);
  assert.equal(rendered.css.includes(".wh-proposal"), true);
  assert.equal(rendered.html.includes("这次改了什么"), true);
  assert.equal(rendered.html.includes("检查结果"), true);
  assert.equal(rendered.html.includes("回滚"), true);
  assert.equal(rendered.html.includes("data-requires-reason=\"true\""), true);
});

test("proposal renderer stays non-kanban and non-git while exposing deliverable kinds", () => {
  const vm = createP05GoldPathFixture().proposalDetail;
  const rendered = renderProposalDetail(vm, "desktop");

  assert.equal(rendered.surface, "desktop");
  assert.equal(rendered.html.includes("kanban"), false);
  assert.equal(rendered.html.includes("git"), false);
  assert.equal(rendered.html.includes("data-change-kind=\"text_doc\""), true);
  assert.equal(rendered.html.includes("data-action-id=\"approve\""), true);
  assert.equal(rendered.html.includes("data-action-id=\"request_changes\""), true);
});
