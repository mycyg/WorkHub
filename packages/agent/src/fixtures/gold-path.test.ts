import assert from "node:assert/strict";
import test from "node:test";

import { eventTypes } from "@workhub/contracts";
import { toAttentionItem, toCuuState } from "@workhub/events";

import { createP05GoldPathFixture, validateP05GoldPathFixture } from "./gold-path.js";

test("P0.5 gold path fixture satisfies shared page, event, replay, and cost contracts", () => {
  const fixture = validateP05GoldPathFixture();

  assert.equal(fixture.id, "weekly_report_manifest_doc");
  assert.equal(fixture.question.free_text.collapsed_by_default, true);
  assert.equal(fixture.question.options.length >= 2, true);
  assert.notEqual(fixture.question.input_mode, "long_text");
  assert.equal(fixture.replay.steps.length >= fixture.evalGate.minReplaySteps, true);
  assert.equal(fixture.proposalDetail.review_actions.request_changes.requires_reason, true);
  assert.equal(fixture.manifest.review.reason_required_on_reject, true);
});

test("P0.5 manifest is a non-code PR with evidence, checks, and rollback", () => {
  const fixture = createP05GoldPathFixture();
  const targetKinds = fixture.manifest.changes.map((change) => change.target_kind);
  const checkIds = new Set(fixture.manifest.checks.map((check) => check.id));

  assert.deepEqual(targetKinds, ["text_doc", "text_doc"]);
  assert.equal(fixture.manifest.summary_md.includes("## 变更摘要"), true);
  assert.equal(fixture.manifest.evidence_refs.length, 3);
  assert.equal(fixture.manifest.rollback.available, true);
  assert.equal(fixture.manifest.risk.reversible, true);
  assert.equal(checkIds.has("snapshot_exists"), true);
  assert.equal(checkIds.has("artifact_exists"), true);
  assert.equal(checkIds.has("evidence_linked"), true);
  assert.equal(checkIds.has("revert_available"), true);
});

test("P0.5 fixture refuses hallucinated evidence source ids", () => {
  const fixture = createP05GoldPathFixture();
  const allowed = new Set(fixture.evidenceSourceIds);
  const refs = [
    ...fixture.evidenceBubble.evidence_refs,
    ...fixture.manifest.evidence_refs,
    ...fixture.manifest.changes.flatMap((change) => change.evidence_refs ?? []),
    ...fixture.proposalDetail.evidence_refs,
    ...fixture.workItemDetail.evidence_refs,
    ...fixture.replay.evidence_refs
  ];

  assert.equal(refs.length > 0, true);
  for (const ref of refs) {
    assert.equal(allowed.has(ref.source_id), true, `Unexpected evidence source id: ${ref.source_id}`);
  }
});

test("P0.5 budget threshold produces a warning event and replay cost footer", () => {
  const fixture = createP05GoldPathFixture();
  const warningEvents = fixture.events.filter((event) => event.type === eventTypes.budgetWarning);
  const workItemUsage = fixture.costSummary.scopes.find((usage) => usage.scope.kind === "workitem");
  const warningNotice = fixture.costSummary.active_notices[0];

  assert.equal((workItemUsage?.warning_ratio ?? 0) >= fixture.evalGate.warningRatioThreshold, true);
  assert.equal(warningNotice?.severity, "warning");
  assert.equal(warningNotice?.code, "budget_warning");
  assert.equal((warningNotice?.options?.length ?? 0) >= 2, true);
  assert.equal(warningEvents.length, 1);
  assert.equal(fixture.replay.cost?.active_notices.length, 1);
  assert.equal(fixture.usageRecord.estimatedCostCny, workItemUsage?.estimated_cost_cny);
  assert.equal(fixture.ledgerEntry.estimatedCostCny, fixture.usageRecord.estimatedCostCny);
});

test("P0.5 events drive the expected Cuu state progression and attention cards", () => {
  const fixture = createP05GoldPathFixture();
  const states = fixture.events.map((event) => toCuuState(event));
  const ordered = fixture.evalGate.requiredCuuStates.map((state) => states.indexOf(state));

  for (const state of fixture.evalGate.requiredCuuStates) {
    assert.equal(states.includes(state), true, `Missing Cuu state: ${state}`);
  }
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (previous === undefined || current === undefined) {
      throw new Error(`Missing Cuu state index at ${index}`);
    }
    assert.equal(previous < current, true, `Cuu state order broke at ${index}`);
  }

  const attentionItems = fixture.events.map((event) => toAttentionItem(event)).filter((item) => item !== undefined);
  assert.equal(attentionItems.some((item) => item.kind === "clarification"), true);
  assert.equal(attentionItems.some((item) => item.kind === "proposal_review"), true);
  assert.equal(attentionItems.some((item) => item.kind === "delivery_ready"), true);
});
