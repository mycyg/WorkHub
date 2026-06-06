import assert from "node:assert/strict";
import test from "node:test";

import {
  createCuuIdleScheduler,
  cuuIdleMicroActionSpecs,
  type CuuIdleMicroAction
} from "./index.js";

const policy = {
  breathe_interval_ms: [3000, 3000] as const,
  blink_interval_ms: [8000, 8000] as const,
  tail_interval_ms: [5000, 5000] as const,
  look_interval_ms: [20000, 20000] as const,
  sleep_after_ms: 60000,
  sleeping_loop_interval_ms: 12000
};

test("Cuu idle scheduler emits deterministic breathe, tail, and blink micro actions", () => {
  const scheduler = createCuuIdleScheduler({ now_ms: 0, policy, random: () => 0 });

  assert.equal(scheduler.tick({ now_ms: 1000 }).reason, "not_due");
  assert.deepEqual(actionAt(scheduler, 3000), ["idle_breathe", "breathe_due"]);
  assert.deepEqual(actionAt(scheduler, 5000), ["idle_tail_sway", "tail_due"]);
  assert.deepEqual(actionAt(scheduler, 8000), ["idle_blink", "blink_due"]);
});

test("Cuu idle scheduler sleeps after inactivity and wakes on hover", () => {
  const scheduler = createCuuIdleScheduler({
    now_ms: 0,
    policy: { ...policy, sleep_after_ms: 1000, sleeping_loop_interval_ms: 500 },
    random: () => 0
  });

  const sleeping = scheduler.tick({ now_ms: 1000 });
  assert.equal(sleeping.action, "sleeping_curl");
  assert.equal(sleeping.reason, "sleep_timeout");
  assert.equal(sleeping.snapshot.asleep, true);

  const loop = scheduler.tick({ now_ms: 1500 });
  assert.equal(loop.action, "sleeping_curl");
  assert.equal(loop.reason, "sleeping_loop");

  const wake = scheduler.tick({ now_ms: 1600, interaction: "hover" });
  assert.equal(wake.action, "wake_up");
  assert.equal(wake.reason, "hover_wakeup");
  assert.equal(wake.snapshot.asleep, false);
});

test("Cuu idle scheduler maps direct interactions to pet-like feedback", () => {
  const scheduler = createCuuIdleScheduler({ now_ms: 0, policy, random: () => 0 });

  assert.equal(scheduler.observeInteraction("tap", 100).action, "tap_bubble");
  assert.equal(scheduler.observeInteraction("drag", 200).action, "drag_hold");
  assert.equal(scheduler.observeInteraction("hover", 300).action, "wave_hello");
  const release = scheduler.observeInteraction("release", 320);
  assert.equal(release.action, undefined);
  assert.equal(release.reason, "drag_released");
  assert.equal(release.snapshot.last_interaction_ms, 320);
});

test("Cuu idle scheduler lets active cards and reduced-motion own the visual state", () => {
  const scheduler = createCuuIdleScheduler({ now_ms: 0, policy, random: () => 0 });

  const active = scheduler.tick({ now_ms: 10000, active_card: true });
  const reduced = scheduler.tick({ now_ms: 10000, reduced_motion: true });

  assert.equal(active.action, undefined);
  assert.equal(active.reason, "active_card_controls_motion");
  assert.equal(reduced.action, undefined);
  assert.equal(reduced.reason, "reduced_motion_static");
});

test("Cuu idle micro action specs include the full alive-behavior P1 set", () => {
  const actions = Object.keys(cuuIdleMicroActionSpecs).sort() as CuuIdleMicroAction[];

  assert.deepEqual(actions, [
    "drag_hold",
    "idle_blink",
    "idle_breathe",
    "idle_tail_sway",
    "look_at_mouse",
    "sleeping_curl",
    "tap_bubble",
    "wake_up",
    "wave_hello"
  ].sort());
  assert.equal(cuuIdleMicroActionSpecs.sleeping_curl.loop, true);
  assert.equal(cuuIdleMicroActionSpecs.wake_up.loop, false);
});

function actionAt(scheduler: ReturnType<typeof createCuuIdleScheduler>, now_ms: number) {
  const decision = scheduler.tick({ now_ms });
  return [decision.action, decision.reason];
}
