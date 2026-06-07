import assert from "node:assert/strict";
import test from "node:test";

import {
  desktopCuuLive2DPsdDraftLayers,
  desktopCuuLive2DPsdDraftSummary
} from "./cuu-live2d-psd-draft-assets.js";
import {
  renderDesktopCuuLive2DPsdDraft,
  renderDesktopCuuLive2DPsdDraftForMotion,
  renderDesktopCuuLive2DPsdDraftForState
} from "./cuu-live2d-psd-draft-runtime.js";

test("desktop Cuu PSD draft probe renders generated layer PNGs instead of the 8-layer crop fixture", () => {
  const render = renderDesktopCuuLive2DPsdDraftForState("idle_tail_sway");

  assert.equal(render.runtime_kind, "psd_draft_probe");
  assert.equal(render.status, "draft_created_not_visual_pass");
  assert.equal(render.layer_count, 144);
  assert.equal(render.visible_layer_count, 65);
  assert.equal(render.expression_layer_count, 7);
  assert.ok(render.animated_layer_count >= 40);
  assert.equal(render.fallback_sprite_clip, "idle_tail_sway");
  assert.match(render.html, /data-cuu-live2d-runtime="psd_draft_probe"/u);
  assert.match(render.html, /data-cuu-live2d-layer-count="144"/u);
  assert.match(render.html, /data-cuu-live2d-visible-layer-count="65"/u);
  assert.match(render.html, /data-psd-layer="Eye_L_Closed"/u);
  assert.match(render.html, /data-psd-layer="Mouth_OpenSmall"/u);
  assert.match(render.html, /data-psd-layer="Tail_01"/u);
  assert.match(render.html, /data-psd-layer="Tassel_L_String_01"/u);
  assert.match(render.html, /data-psd-bind-target="Tassel_R_03"/u);
  assert.match(render.html, /generated-psd-draft-v1\/layers\/Eye_L_Closed\.png/u);
  assert.doesNotMatch(render.html, /cuu-layered-rig-v0/u);
});

test("desktop Cuu PSD draft probe exposes independent blink, mouth, tail, ear, and tassel animation contracts", () => {
  const idle = renderDesktopCuuLive2DPsdDraftForState("idle_blink");
  const approval = renderDesktopCuuLive2DPsdDraftForMotion({
    state: "asking_approval",
    sprite_state: "asking_approval_bounce",
    emphasis: "urgent",
    loop: true,
    reduced_motion_fallback: "Cuu 等你审批。"
  });

  assert.equal(idle.motion_id, "blink");
  assert.match(idle.css, /@keyframes wh-cuu-psd-eye-closed-blink/u);
  assert.match(idle.css, /@keyframes wh-cuu-psd-tail-idle/u);
  assert.match(idle.css, /@keyframes wh-cuu-psd-ear-l/u);
  assert.match(idle.css, /@keyframes wh-cuu-psd-tassel-l/u);
  assert.doesNotMatch(idle.css, /steps\(1,end\)/u);
  assert.equal(approval.motion_id, "approval");
  assert.match(approval.css, /wh-cuu-psd-paw-tap/u);
  assert.match(approval.css, /Mouth_OpenSmall/u);
  assert.match(approval.html, /data-cuu-live2d-fallback-sprite="asking_approval_bounce"/u);
});

test("desktop Cuu PSD draft probe validates required runtime layers before rendering", () => {
  const brokenLayers = desktopCuuLive2DPsdDraftLayers.filter((layer) => layer.name !== "Tail_02");

  assert.throws(
    () => renderDesktopCuuLive2DPsdDraft("idle", "idle_breathe", { layers: brokenLayers }),
    /missing_psd_layer/u
  );
});

test("desktop Cuu PSD draft asset summary stays aligned with runtime allowlist", () => {
  const names = desktopCuuLive2DPsdDraftLayers.map((layer) => layer.name);

  assert.equal(desktopCuuLive2DPsdDraftSummary.layer_count, 144);
  assert.equal(desktopCuuLive2DPsdDraftSummary.runtime_probe_layer_count, desktopCuuLive2DPsdDraftLayers.length);
  assert.equal(new Set(names).size, names.length);
  assert.equal(desktopCuuLive2DPsdDraftLayers.filter((layer) => layer.default_visible).length, 65);
  assert.ok(names.includes("Eye_R_Closed"));
  assert.ok(names.includes("Mouth_Smile"));
  assert.ok(names.includes("Tail_Tip"));
  assert.ok(names.includes("GoldBead_R_01"));
});
