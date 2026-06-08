import assert from "node:assert/strict";
import test from "node:test";

import { cuuMotionForState } from "@workhub/cuu";

import {
  renderDesktopCuuCatLive2DForIdleAction,
  renderDesktopCuuCatLive2DForMotion,
  resolveDesktopCuuCatLive2DBehaviorState,
  setDesktopCuuCatLive2DBehaviorState
} from "./cuu-cat-live2d-runtime.js";

test("desktop Live2D runtime resolves behavior manifest state for approval cards", () => {
  const behavior = resolveDesktopCuuCatLive2DBehaviorState({
    state: "asking_approval",
    motion_state: "asking_approval_bounce",
    requested_model_pack_id: "cuu-hijiki-live2d-cubism2"
  });

  assert.equal(behavior.behavior_manifest_version, 1);
  assert.equal(behavior.behavior_state, "asking_approval");
  assert.equal(behavior.behavior_phase, "loop");
  assert.equal(behavior.behavior_window_mode, "card");
  assert.equal(behavior.behavior_bubble_mode, "card");
  assert.equal(behavior.behavior_priority, 90);
  assert.equal(behavior.motion_state, "asking_approval_bounce");
  assert.equal(behavior.renderer_state, "mtn/01.mtn");
  assert.equal(behavior.loop, true);
  assert.equal(behavior.interruptible, false);
});

test("desktop Live2D runtime renders behavior data without introducing another Cuu model", () => {
  const approval = renderDesktopCuuCatLive2DForMotion(cuuMotionForState("asking_approval"));
  const idle = renderDesktopCuuCatLive2DForIdleAction("idle_tail_sway", {
    requested_model_pack_id: "cuu-tororo-live2d-cubism2"
  });

  assert.equal(approval.model_pack_id, "cuu-hijiki-live2d-cubism2");
  assert.equal(approval.behavior_state, "asking_approval");
  assert.equal(approval.behavior_phase, "loop");
  assert.equal(approval.renderer_state, "mtn/01.mtn");
  assert.match(approval.html, /data-cuu-behavior-state="asking_approval"/u);
  assert.match(approval.html, /data-cuu-live2d-motion="asking_approval_bounce"/u);
  assert.match(approval.html, /data-cuu-live2d-renderer-state="mtn\/01\.mtn"/u);
  assert.match(approval.html, /data-cuu-behavior-expected-window-mode="card"/u);

  assert.equal(idle.model_pack_id, "cuu-tororo-live2d-cubism2");
  assert.equal(idle.behavior_state, "idle");
  assert.equal(idle.behavior_phase, "idle_random");
  assert.equal(idle.motion_state, "idle_tail_sway");
  assert.equal(idle.renderer_state, "mtn/00_idle.mtn");
  assert.match(idle.html, /data-cuu-live2d-model="tororo"/u);
  assert.doesNotMatch(`${approval.html}${idle.html}`, /orange|legacy-cuu-pack|experimental_draft_probe/u);
});

test("desktop Live2D behavior patch only updates dataset and preserves iframe markup", () => {
  const live2d = {
    dataset: {} as Record<string, string>
  };
  const root = {
    innerHTML: '<div class="wh-cuu-cat-live2d"><iframe class="wh-cuu-cat-live2d-frame" src="./cuu/live2d/hijiki/cuu-hijiki.html"></iframe></div>',
    querySelector(selector: string) {
      assert.equal(selector, ".wh-cuu-cat-live2d");
      return live2d;
    }
  } as unknown as ParentNode & { innerHTML: string };
  const before = root.innerHTML;

  assert.equal(setDesktopCuuCatLive2DBehaviorState(root, {
    state: "idle",
    motion_state: "look_at_mouse",
    phase: "idle_random"
  }), true);

  assert.equal(root.innerHTML, before);
  assert.equal(live2d.dataset.cuuBehaviorState, "idle");
  assert.equal(live2d.dataset.cuuBehaviorPhase, "idle_random");
  assert.equal(live2d.dataset.cuuLive2dMotion, "look_at_mouse");
  assert.equal(live2d.dataset.cuuLive2dRendererState, "mtn/00_idle.mtn");
  assert.equal(live2d.dataset.cuuBehaviorExpectedWindowMode, "body_only");
});
