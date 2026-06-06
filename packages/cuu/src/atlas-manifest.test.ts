import assert from "node:assert/strict";
import test from "node:test";

import {
  createCuuSpriteAtlasGridFrames,
  cuuAtlasClipForMotion,
  cuuMotionForState,
  validateCuuSpriteAtlasManifest,
  type CuuSpriteAtlasManifest
} from "./index.js";

const idleFrames = createCuuSpriteAtlasGridFrames({
  state: "idle_breathe",
  columns: 4,
  rows: 2,
  frame_count: 8,
  cell_width: 384,
  cell_height: 512,
  duration_ms: 125
});

const p1IdleAtlas = {
  version: 1,
  character: "Cuu",
  art_pack: "cuu-p1-green-screen-sample",
  default_state: "idle_breathe",
  atlas: {
    image_path: "/assets/cuu/atlas/cuu-p1-idle-breathe.png",
    source_green_path: "/assets/cuu/source-green/idle_breathe/cuu-idle-breathe-sheet-v1-green.png",
    alpha_path: "/assets/cuu/alpha/idle_breathe/cuu-idle-breathe-sheet-v1-alpha-clean.png",
    width: 1536,
    height: 1024,
    pixel_ratio: 1,
    format: "png"
  },
  clips: {
    idle_breathe: {
      state: "idle_breathe",
      fps: 8,
      loop: true,
      interruptible: true,
      priority: "idle",
      anchor: { x: 192, y: 480 },
      frames: idleFrames,
      reduced_motion_frame_id: "idle_breathe-000"
    }
  }
} satisfies CuuSpriteAtlasManifest;

test("P1 Cuu atlas manifest accepts a real idle green-screen sample pack", () => {
  const issues = validateCuuSpriteAtlasManifest(p1IdleAtlas);
  const clip = cuuAtlasClipForMotion(cuuMotionForState("idle"), p1IdleAtlas);

  assert.deepEqual(issues, []);
  assert.equal(clip?.frames.length, 8);
  assert.equal(clip?.frames.at(-1)?.x, 1152);
  assert.equal(clip?.frames.at(-1)?.y, 512);
});

test("atlas grid frame helper can place clips inside a larger packed atlas", () => {
  const frames = createCuuSpriteAtlasGridFrames({
    state: "thinking_tail",
    columns: 4,
    rows: 2,
    frame_count: 8,
    cell_width: 444,
    cell_height: 444,
    duration_ms: 100,
    origin_y: 1024
  });

  assert.deepEqual(frames[0], {
    id: "thinking_tail-000",
    x: 0,
    y: 1024,
    w: 444,
    h: 444,
    duration_ms: 100
  });
  assert.equal(frames.at(-1)?.x, 1332);
  assert.equal(frames.at(-1)?.y, 1468);
});

test("atlas manifest can enforce full motion coverage for production packs", () => {
  const issues = validateCuuSpriteAtlasManifest(p1IdleAtlas, {
    require_full_motion_coverage: true,
    require_idle_micro_action_coverage: true
  });

  assert.equal(issues.some((issue) => issue.path === "clips.thinking_tail"), true);
  assert.equal(issues.some((issue) => issue.path === "clips.asking_approval_bounce"), true);
  assert.equal(issues.some((issue) => issue.path === "clips.idle_blink"), true);
  assert.equal(issues.some((issue) => issue.path === "clips.drag_hold"), true);
});

test("atlas clip lookup falls back to the default clip while sample packs are partial", () => {
  const clip = cuuAtlasClipForMotion(cuuMotionForState("thinking"), p1IdleAtlas);

  assert.equal(clip?.state, "idle_breathe");
});

test("atlas manifest validation rejects out-of-bounds frames and bad reduced-motion ids", () => {
  const broken = {
    ...p1IdleAtlas,
    clips: {
      idle_breathe: {
        ...p1IdleAtlas.clips.idle_breathe,
        reduced_motion_frame_id: "missing-frame",
        frames: [
          ...p1IdleAtlas.clips.idle_breathe.frames.slice(0, -1),
          {
            ...p1IdleAtlas.clips.idle_breathe.frames.at(-1)!,
            x: 1400
          }
        ]
      }
    }
  } satisfies CuuSpriteAtlasManifest;

  const issues = validateCuuSpriteAtlasManifest(broken);

  assert.equal(issues.some((issue) => issue.path === "clips.idle_breathe.reduced_motion_frame_id"), true);
  assert.equal(issues.some((issue) => issue.path === "clips.idle_breathe.frames.7"), true);
});
