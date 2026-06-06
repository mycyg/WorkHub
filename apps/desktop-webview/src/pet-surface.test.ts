import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { cuuMotionForState, validateCuuSpriteAtlasManifest, type CuuCard, type CuuSpriteAtlasManifest } from "@workhub/cuu";

import { desktopCuuP1AtlasManifest, desktopCuuP1AtlasManifestUrl, validateDesktopCuuP1AtlasManifest } from "./cuu-atlas-assets.js";
import { renderDesktopCuuAtlasSprite, renderDesktopCuuAtlasState } from "./cuu-atlas-runtime.js";
import { renderDesktopPetSurface, resolveDesktopSurface } from "./pet-surface.js";
import { desktopPetWindowModeForCard, resolveDesktopPetWindowBridge } from "./pet-window-bridge.js";

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
  assert.match(desktopCuuP1AtlasManifest.atlas.image_path, /cuu-p1-motion-pack\.png/u);
  assert.match(desktopCuuP1AtlasManifestUrl, /cuu\.sprite\.json/u);
  assert.equal(desktopCuuP1AtlasManifest.clips.idle_breathe?.frames.length, 8);
  assert.equal(desktopCuuP1AtlasManifest.clips.thinking_tail?.frames.at(0)?.y, 1024);
  assert.equal(desktopCuuP1AtlasManifest.clips.asking_approval_bounce?.priority, "urgent");
  assert.equal(desktopCuuP1AtlasManifest.clips.syncing_files_spin?.frames.at(0)?.y, 5464);
  assert.equal(desktopCuuP1AtlasManifest.clips.offline_sleep?.frames.at(0)?.y, 8128);
  assert.equal(desktopCuuP1AtlasManifest.clips.idle_blink?.frames.at(0)?.y, 9016);
  assert.equal(desktopCuuP1AtlasManifest.clips.wave_hello?.frames.at(0)?.y, 15232);
});

test("desktop Cuu JSON sprite manifest validates against the shared atlas schema", () => {
  const manifest = JSON.parse(readFileSync(new URL("./assets/cuu/atlas/cuu.sprite.json", import.meta.url), "utf8")) as CuuSpriteAtlasManifest;

  assert.deepEqual(validateCuuSpriteAtlasManifest(manifest), []);
  assert.deepEqual(validateCuuSpriteAtlasManifest(manifest, { require_full_motion_coverage: true }), []);
  assert.deepEqual(validateCuuSpriteAtlasManifest(manifest, { require_idle_micro_action_coverage: true }), []);
  assert.equal(manifest.atlas.image_path, "cuu-p1-motion-pack.png");
  assert.equal(manifest.clips.idle_breathe?.reduced_motion_frame_id, "idle_breathe-000");
  assert.equal(Object.keys(manifest.clips).length, 18);
  assert.equal(manifest.clips.searching_evidence_peek?.frames.at(0)?.y, 4576);
  assert.equal(manifest.clips.offline_sleep?.priority, "idle");
  assert.equal(manifest.clips.idle_tail_sway?.frames.at(0)?.y, 9904);
  assert.equal(manifest.clips.drag_hold?.priority, "normal");
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

test("desktop Cuu atlas renderer uses generated business motion clips", () => {
  const render = renderDesktopCuuAtlasSprite(cuuMotionForState("thinking"), desktopCuuP1AtlasManifest);

  assert.equal(render.clip.state, "thinking_tail");
  assert.equal(render.fallback, false);
  assert.match(render.html, /data-cuu-requested-state="thinking_tail"/u);
  assert.match(render.html, /data-fallback="false"/u);
});

test("desktop Cuu atlas renderer has business-state full coverage in the P1 pack", () => {
  const render = renderDesktopCuuAtlasSprite(cuuMotionForState("worried"), desktopCuuP1AtlasManifest);

  assert.equal(render.clip.state, "worried_ears");
  assert.equal(render.fallback, false);
  assert.match(render.html, /data-cuu-requested-state="worried_ears"/u);
  assert.match(render.html, /data-fallback="false"/u);
});

test("desktop Cuu atlas renderer uses generated idle micro action clips", () => {
  const render = renderDesktopCuuAtlasState("idle_tail_sway", desktopCuuP1AtlasManifest);

  assert.equal(render.clip.state, "idle_tail_sway");
  assert.equal(render.fallback, false);
  assert.match(render.html, /data-cuu-requested-state="idle_tail_sway"/u);
});

test("desktop surface resolver sends Tauri pet routes to the pet surface", () => {
  assert.equal(resolveDesktopSurface({ pathname: "/pet", search: "" }), "pet");
  assert.equal(resolveDesktopSurface({ pathname: "/", search: "?surface=pet" }), "pet");
  assert.equal(resolveDesktopSurface({ pathname: "/", search: "?surface=main" }), "main");
});

test("pet surface renders Cuu without the main Gold Path shell", () => {
  const idle = renderDesktopPetSurface({ idle_action: "idle_tail_sway" });
  const card = renderDesktopPetSurface({
    card: approvalCard(),
    status_text: "先点一个原因，Cuu 会带着它继续改。",
    include_reject_reasons: true
  });

  assert.match(idle.html, /data-wh-surface="pet"/u);
  assert.match(idle.html, /data-pet-window-mode="body_only"/u);
  assert.match(idle.html, /data-cuu-idle-action="idle_tail_sway"/u);
  assert.match(idle.html, /data-cuu-atlas-state="idle_tail_sway"/u);
  assert.match(idle.html, /data-cuu-manifest-url="[^"]*cuu\.sprite\.json/u);
  assert.doesNotMatch(idle.html, /wh-app-shell/u);
  assert.match(card.html, /data-cuu-card-id="approval-card"/u);
  assert.match(card.html, /data-pet-window-mode="card"/u);
  assert.match(card.html, /data-cuu-atlas-fallback="false"/u);
  assert.match(card.html, /data-cuu-action-id="approve"/u);
  assert.match(card.html, /data-pet-reason="证据不足"/u);
  assert.doesNotMatch(card.html, /textarea/u);
});

test("pet window bridge resolves body/card modes and Tauri-like commands", async () => {
  const calls: string[] = [];
  const mockBridge = {
    setMode(mode: "body_only" | "card") {
      calls.push(`mode:${mode}`);
    }
  };
  assert.equal(desktopPetWindowModeForCard(undefined), "body_only");
  assert.equal(desktopPetWindowModeForCard(approvalCard()), "card");
  assert.equal(resolveDesktopPetWindowBridge({ __WORKHUB_PET__: mockBridge }), mockBridge);

  const tauri = resolveDesktopPetWindowBridge({
    __TAURI__: {
      core: {
        async invoke(command: string, args?: Record<string, unknown>) {
          calls.push(`${command}:${args?.mode ?? ""}`);
          return command === "sample_pet_cursor_near";
        }
      },
      window: {
        getCurrentWindow() {
          return {
            startDragging() {
              calls.push("startDragging");
            }
          };
        }
      }
    }
  });

  await tauri?.setMode?.("card");
  await tauri?.startDragging?.();
  assert.equal(await tauri?.sampleCursorNear?.(), true);
  assert.deepEqual(calls, ["set_pet_window_mode:card", "startDragging", "sample_pet_cursor_near:"]);
});

test("pet window bridge can start dragging through the Rust command fallback", async () => {
  const calls: string[] = [];
  const bridge = resolveDesktopPetWindowBridge({
    __TAURI__: {
      core: {
        async invoke(command: string) {
          calls.push(command);
          return false;
        }
      }
    }
  });

  await bridge?.startDragging?.();
  await bridge?.savePosition?.();
  assert.deepEqual(calls, ["start_pet_window_drag", "save_pet_window_position"]);
});

test("pet window bridge accepts Rust cursor sample command plans", async () => {
  const bridge = resolveDesktopPetWindowBridge({
    __TAURI__: {
      core: {
        async invoke(command: string) {
          assert.equal(command, "sample_pet_cursor_near");
          return {
            pointer: {
              insideWindow: false,
              cursorNear: true,
              distanceToWindowPx: 24
            }
          };
        }
      }
    }
  });

  assert.equal(await bridge?.sampleCursorNear?.(), true);
});
