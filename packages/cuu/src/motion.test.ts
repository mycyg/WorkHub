import assert from "node:assert/strict";
import test from "node:test";

import { cuuStates } from "@workhub/contracts";

import {
  createCuuBehaviorManifest,
  cuuBehaviorStateForState,
  cuuDefaultLive2DRendererStateForClip,
  cuuMotionSlotForClip
} from "./index.js";

test("Cuu behavior manifest covers every contract state with start loop exit slots", () => {
  const manifest = createCuuBehaviorManifest({
    model_pack_id: "cuu-hijiki-live2d-cubism2",
    coverage: "partial"
  });

  assert.equal(manifest.version, 1);
  assert.equal(manifest.model_pack_id, "cuu-hijiki-live2d-cubism2");
  assert.deepEqual(Object.keys(manifest.states).sort(), [...cuuStates].sort());

  for (const state of cuuStates) {
    const behavior = cuuBehaviorStateForState(manifest, state);
    assert.equal(behavior.state, state);
    assert.equal(behavior.coverage, "partial");
    assert.equal(behavior.loop.length >= 1, true);
    assert.match(behavior.loop[0]?.renderer_state ?? "", /^mtn\//u);
    assert.equal(Number.isInteger(behavior.priority), true);
    if (state === "idle") {
      assert.equal(behavior.window_mode, "body_only");
      assert.equal(behavior.bubble_mode, "none");
      assert.equal(behavior.enter, undefined);
      assert.equal(behavior.exit, undefined);
    } else {
      assert.match(behavior.enter?.renderer_state ?? "", /^mtn\//u);
      assert.equal(behavior.exit?.motion, "idle_breathe");
    }
  }
});

test("Cuu behavior manifest keeps approval and evidence states card-first", () => {
  const manifest = createCuuBehaviorManifest({ model_pack_id: "cuu-tororo-live2d-cubism2" });

  assert.equal(manifest.states.asking_approval.window_mode, "card");
  assert.equal(manifest.states.asking_approval.bubble_mode, "card");
  assert.equal(manifest.states.asking_approval.priority, 90);
  assert.equal(manifest.states.asking_approval.loop[0]?.interruptible, false);
  assert.equal(manifest.states.searching_evidence.window_mode, "card");
  assert.equal(manifest.states.searching_evidence.loop[0]?.motion, "searching_evidence_peek");
  assert.equal(manifest.states.thinking.window_mode, "card");
  assert.equal(manifest.states.thinking.bubble_mode, "tip");
});

test("Cuu idle random pool expresses alive micro actions without adding a third visual", () => {
  const manifest = createCuuBehaviorManifest({ model_pack_id: "cuu-hijiki-live2d-cubism2" });
  const actions = manifest.idle_random.map((slot) => slot.action);

  assert.deepEqual(actions, [
    "idle_breathe",
    "idle_blink",
    "idle_tail_sway",
    "look_at_mouse",
    "wave_hello"
  ]);
  assert.equal(manifest.idle_random.every((slot) => slot.probability > 0 && slot.cooldown_ms >= 1200), true);
  assert.equal(manifest.idle_random.every((slot) => slot.renderer_state.startsWith("mtn/")), true);
});

test("Cuu Live2D renderer state mapping is centralized for model packs and desktop runtime", () => {
  assert.equal(cuuDefaultLive2DRendererStateForClip("asking_approval_bounce"), "mtn/01.mtn");
  assert.equal(cuuDefaultLive2DRendererStateForClip("searching_evidence_peek"), "mtn/04.mtn");
  assert.equal(cuuDefaultLive2DRendererStateForClip("celebrating_jump"), "mtn/06.mtn");
  assert.equal(cuuDefaultLive2DRendererStateForClip("offline_sleep"), "mtn/08.mtn");

  const slot = cuuMotionSlotForClip("tap_bubble", { loop: false, max_duration_ms: 1400 });
  assert.equal(slot.motion, "tap_bubble");
  assert.equal(slot.renderer_state, "mtn/01.mtn");
  assert.equal(slot.loop, false);
  assert.equal(slot.max_duration_ms, 1400);
});
