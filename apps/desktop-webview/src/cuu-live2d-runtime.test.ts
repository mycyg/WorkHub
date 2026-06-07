import assert from "node:assert/strict";
import test from "node:test";

import { cuuMotionForState } from "@workhub/cuu";

import {
  renderDesktopCuuLive2DPrototype,
  renderDesktopCuuLive2DPrototypeForMotion,
  renderDesktopCuuLive2DPrototypeForState
} from "./cuu-live2d-runtime.js";

test("desktop Cuu Live2D prototype renders same-source layered idle motion", () => {
  const render = renderDesktopCuuLive2DPrototypeForState("idle_tail_sway");

  assert.equal(render.runtime_kind, "prototype_layered");
  assert.equal(render.status, "prototype_layered");
  assert.equal(render.motion_id, "idle");
  assert.equal(render.layer_count, 8);
  assert.equal(render.fallback_sprite_clip, "idle_breathe");
  assert.match(render.html, /data-cuu-live2d-runtime="prototype_layered"/u);
  assert.match(render.html, /data-cuu-live2d-motion="idle"/u);
  assert.match(render.html, /data-cuu-live2d-layer-count="8"/u);
  assert.match(render.html, /data-live2d-layer="tail"/u);
  assert.match(render.html, /data-live2d-layer="head"/u);
  assert.match(render.html, /data-live2d-eye="l"/u);
  assert.match(render.css, /@keyframes wh-cuu-live2d-tail-idle/u);
  assert.match(render.css, /prefers-reduced-motion: reduce/u);
  assert.doesNotMatch(render.css, /steps\(1,end\)/u);
});

test("desktop Cuu Live2D prototype maps business motions to layered states", () => {
  const approval = renderDesktopCuuLive2DPrototypeForMotion(cuuMotionForState("asking_approval"));
  const worried = renderDesktopCuuLive2DPrototypeForMotion(cuuMotionForState("offline"));
  const tap = renderDesktopCuuLive2DPrototypeForState("tap_bubble");

  assert.equal(approval.motion_id, "approval");
  assert.match(approval.html, /data-cuu-live2d-fallback-sprite="asking_approval_bounce"/u);
  assert.match(approval.css, /wh-cuu-live2d-root-hop/u);
  assert.equal(worried.motion_id, "offline");
  assert.match(worried.html, /data-cuu-live2d-fallback-sprite="offline_sleep"/u);
  assert.match(worried.css, /wh-cuu-live2d-eye-sleep/u);
  assert.equal(tap.motion_id, "tap");
  assert.match(tap.css, /wh-cuu-live2d-paw-tap/u);
});

test("desktop Cuu Live2D prototype marks non-looping motions for finite playback", () => {
  const render = renderDesktopCuuLive2DPrototype("celebrate");

  assert.equal(render.motion.loop, false);
  assert.match(render.html, /data-loop="false"/u);
  assert.match(render.css, /animation-fill-mode:both/u);
});
