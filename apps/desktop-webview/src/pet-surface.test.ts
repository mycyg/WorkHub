import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { cuuMotionForState, validateCuuSpriteAtlasManifest, type CuuCard, type CuuSpriteAtlasManifest } from "@workhub/cuu";

import { desktopCuuP1AtlasManifest, desktopCuuP1AtlasManifestUrl, validateDesktopCuuP1AtlasManifest } from "./cuu-atlas-assets.js";
import { renderDesktopCuuAtlasSprite } from "./cuu-atlas-runtime.js";
import { renderDesktopPetSurface, resolveDesktopSurface } from "./pet-surface.js";

function approvalCard(): CuuCard {
  return {
    id: "approval-card",
    kind: "approval",
    state: "asking_approval",
    motion: cuuMotionForState("asking_approval"),
    title: "Cuu 等你审批",
    message: "点一个选项即可继续。",
    priority: "urgent",
    chips: [{ id: "file-only", label: "仅改文件", recommended: true }],
    actions: [
      {
        id: "approve",
        label: "同意",
        tone: "primary",
        method: "POST",
        href: "/api/approvals/approval-1/respond"
      },
      {
        id: "request_changes",
        label: "打回",
        tone: "danger",
        method: "POST",
        href: "/api/approvals/approval-1/respond",
        requires_reason: true
      }
    ]
  };
}

test("desktop Cuu P1 atlas manifest points at the generated transparent sample", () => {
  assert.deepEqual(validateDesktopCuuP1AtlasManifest(), []);
  assert.match(desktopCuuP1AtlasManifest.atlas.image_path, /cuu-p1-idle-breathe\.png/u);
  assert.match(desktopCuuP1AtlasManifestUrl, /cuu\.sprite\.json/u);
  assert.equal(desktopCuuP1AtlasManifest.clips.idle_breathe?.frames.length, 8);
});

test("desktop Cuu JSON sprite manifest validates against the shared atlas schema", () => {
  const manifest = JSON.parse(readFileSync(new URL("./assets/cuu/atlas/cuu.sprite.json", import.meta.url), "utf8")) as CuuSpriteAtlasManifest;

  assert.deepEqual(validateCuuSpriteAtlasManifest(manifest), []);
  assert.equal(manifest.atlas.image_path, "cuu-p1-idle-breathe.png");
  assert.equal(manifest.clips.idle_breathe?.reduced_motion_frame_id, "idle_breathe-000");
});

test("desktop Cuu atlas renderer emits keyframes from atlas rectangles", () => {
  const render = renderDesktopCuuAtlasSprite(cuuMotionForState("idle"), desktopCuuP1AtlasManifest);

  assert.equal(render.clip.state, "idle_breathe");
  assert.equal(render.fallback, false);
  assert.equal(render.frame_count, 8);
  assert.match(render.html, /data-cuu-atlas-state="idle_breathe"/u);
  assert.match(render.html, /data-frame-count="8"/u);
  assert.match(render.css, /@keyframes wh-cuu-atlas-idle_breathe/u);
  assert.match(render.css, /background-position:-444px -197px/u);
});

test("desktop Cuu atlas renderer marks fallback while the sample pack is partial", () => {
  const render = renderDesktopCuuAtlasSprite(cuuMotionForState("thinking"), desktopCuuP1AtlasManifest);

  assert.equal(render.clip.state, "idle_breathe");
  assert.equal(render.fallback, true);
  assert.match(render.html, /data-cuu-requested-state="thinking_tail"/u);
  assert.match(render.html, /data-fallback="true"/u);
});

test("desktop surface resolver sends Tauri pet routes to the pet surface", () => {
  assert.equal(resolveDesktopSurface({ pathname: "/pet", search: "" }), "pet");
  assert.equal(resolveDesktopSurface({ pathname: "/", search: "?surface=pet" }), "pet");
  assert.equal(resolveDesktopSurface({ pathname: "/", search: "?surface=main" }), "main");
});

test("pet surface renders Cuu without the main Gold Path shell", () => {
  const idle = renderDesktopPetSurface();
  const card = renderDesktopPetSurface({
    card: approvalCard(),
    status_text: "先点一个原因，Cuu 会带着它继续改。",
    include_reject_reasons: true
  });

  assert.match(idle.html, /data-wh-surface="pet"/u);
  assert.match(idle.html, /data-cuu-atlas-state="idle_breathe"/u);
  assert.match(idle.html, /data-cuu-manifest-url="[^"]*cuu\.sprite\.json/u);
  assert.doesNotMatch(idle.html, /wh-app-shell/u);
  assert.match(card.html, /data-cuu-card-id="approval-card"/u);
  assert.match(card.html, /data-cuu-atlas-fallback="true"/u);
  assert.match(card.html, /data-cuu-action-id="approve"/u);
  assert.match(card.html, /data-pet-reason="证据不足"/u);
  assert.doesNotMatch(card.html, /textarea/u);
});
