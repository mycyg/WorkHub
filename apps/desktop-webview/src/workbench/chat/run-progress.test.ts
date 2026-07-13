import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ACTION_CARD_RUN_PROGRESS_MIN_REFETCH_INTERVAL_MS,
  actionCardItemRunProgressFromRuns,
  inferActionCardRunProgress,
  nextAllowedActionCardRunProgressFetchAtMs,
  shouldRefetchActionCardRunProgressNow
} from "./run-progress.js";

// —— inferActionCardRunProgress —— //

test("inferActionCardRunProgress maps a queued run to the claim stage", () => {
  assert.deepEqual(inferActionCardRunProgress({ runStatus: "queued", recentStepPhase: null }), {
    kind: "stage",
    stage: "claim"
  });
});

test("inferActionCardRunProgress maps a running run with no recorded step yet to the work stage", () => {
  assert.deepEqual(inferActionCardRunProgress({ runStatus: "running", recentStepPhase: null }), {
    kind: "stage",
    stage: "work"
  });
});

for (const phase of ["think", "tool_call", "tool_result"]) {
  test(`inferActionCardRunProgress maps a running run at step phase "${phase}" to the work stage`, () => {
    assert.deepEqual(inferActionCardRunProgress({ runStatus: "running", recentStepPhase: phase }), {
      kind: "stage",
      stage: "work"
    });
  });
}

test("inferActionCardRunProgress maps a running run at the final step phase to the produce stage", () => {
  assert.deepEqual(inferActionCardRunProgress({ runStatus: "running", recentStepPhase: "final" }), {
    kind: "stage",
    stage: "produce"
  });
});

test("inferActionCardRunProgress maps a succeeded run to the propose stage (the deliverable card already covers the terminal report)", () => {
  assert.deepEqual(inferActionCardRunProgress({ runStatus: "succeeded", recentStepPhase: "final" }), {
    kind: "stage",
    stage: "propose"
  });
});

test("inferActionCardRunProgress maps a failed run to the failed terminal state", () => {
  assert.deepEqual(inferActionCardRunProgress({ runStatus: "failed", recentStepPhase: "tool_call" }), {
    kind: "terminal",
    terminal: "failed"
  });
});

test("inferActionCardRunProgress maps an escalated run to the escalated terminal state", () => {
  assert.deepEqual(inferActionCardRunProgress({ runStatus: "escalated", recentStepPhase: null }), {
    kind: "terminal",
    terminal: "escalated"
  });
});

test("inferActionCardRunProgress refuses to invent a story for a cancelled run", () => {
  assert.equal(inferActionCardRunProgress({ runStatus: "cancelled", recentStepPhase: null }), undefined);
});

test("inferActionCardRunProgress refuses to invent a story for an unrecognized step phase", () => {
  assert.equal(inferActionCardRunProgress({ runStatus: "running", recentStepPhase: "some_future_phase" }), undefined);
});

test("inferActionCardRunProgress refuses to invent a story for an unrecognized run status", () => {
  assert.equal(inferActionCardRunProgress({ runStatus: "some_future_status", recentStepPhase: null }), undefined);
});

// —— actionCardItemRunProgressFromRuns —— //

test("actionCardItemRunProgressFromRuns finds the run sourced from the given item and infers its progress", () => {
  const runs = [
    { source_action_card_item_id: "other-item", status: "queued", recent_step: null },
    { source_action_card_item_id: "item-1", status: "running", recent_step: { phase: "tool_call" } }
  ];

  assert.deepEqual(actionCardItemRunProgressFromRuns("item-1", runs), { kind: "stage", stage: "work" });
});

test("actionCardItemRunProgressFromRuns returns undefined when no run is sourced from this item yet", () => {
  const runs = [{ source_action_card_item_id: "other-item", status: "running", recent_step: null }];

  assert.equal(actionCardItemRunProgressFromRuns("item-1", runs), undefined);
});

test("actionCardItemRunProgressFromRuns returns undefined for an empty run list", () => {
  assert.equal(actionCardItemRunProgressFromRuns("item-1", []), undefined);
});

// —— throttle gate —— //

test("shouldRefetchActionCardRunProgressNow allows the first-ever fetch immediately", () => {
  assert.equal(shouldRefetchActionCardRunProgressNow(undefined, 1_000), true);
});

test("shouldRefetchActionCardRunProgressNow blocks a refetch inside the minimum interval", () => {
  const lastFetchAtMs = 10_000;
  assert.equal(
    shouldRefetchActionCardRunProgressNow(lastFetchAtMs, lastFetchAtMs + ACTION_CARD_RUN_PROGRESS_MIN_REFETCH_INTERVAL_MS - 1),
    false
  );
});

test("shouldRefetchActionCardRunProgressNow allows a refetch exactly at the minimum interval boundary", () => {
  const lastFetchAtMs = 10_000;
  assert.equal(
    shouldRefetchActionCardRunProgressNow(lastFetchAtMs, lastFetchAtMs + ACTION_CARD_RUN_PROGRESS_MIN_REFETCH_INTERVAL_MS),
    true
  );
});

test("nextAllowedActionCardRunProgressFetchAtMs schedules the trailing retry exactly one interval after the last fetch", () => {
  assert.equal(nextAllowedActionCardRunProgressFetchAtMs(10_000), 10_000 + ACTION_CARD_RUN_PROGRESS_MIN_REFETCH_INTERVAL_MS);
});
