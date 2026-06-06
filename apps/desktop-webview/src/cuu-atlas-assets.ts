import {
  createCuuSpriteAtlasGridFrames,
  validateCuuSpriteAtlasManifest,
  type CuuSpriteAtlasManifest,
  type CuuSpriteAtlasManifestIssue
} from "@workhub/cuu";

const motionPackAtlasImage = new URL("./assets/cuu/atlas/cuu-p1-motion-pack.png", import.meta.url).href;

export const desktopCuuP1AtlasManifestUrl = new URL("./assets/cuu/atlas/cuu.sprite.json", import.meta.url).href;

export const desktopCuuP1AtlasManifest = {
  version: 1,
  character: "Cuu",
  art_pack: "cuu-p1-motion-pack",
  default_state: "idle_breathe",
  atlas: {
    image_path: motionPackAtlasImage,
    width: 1776,
    height: 5464,
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
      source_green_path: "assets/cuu/source-green/idle_breathe/cuu-idle-breathe-sheet-v1-green.png",
      alpha_path: "assets/cuu/alpha/idle_breathe/cuu-idle-breathe-sheet-v1-alpha-clean.png",
      frames: createCuuSpriteAtlasGridFrames({
        state: "idle_breathe",
        columns: 4,
        rows: 2,
        frame_count: 8,
        cell_width: 384,
        cell_height: 512,
        duration_ms: 125
      }),
      reduced_motion_frame_id: "idle_breathe-000"
    },
    thinking_tail: {
      state: "thinking_tail",
      fps: 10,
      loop: true,
      interruptible: true,
      priority: "normal",
      anchor: { x: 222, y: 418 },
      source_green_path: "assets/cuu/source-green/thinking_tail/cuu-thinking-tail-sheet-v1-green.png",
      alpha_path: "assets/cuu/alpha/thinking_tail/cuu-thinking-tail-sheet-v1-alpha-clean.png",
      frames: createCuuSpriteAtlasGridFrames({
        state: "thinking_tail",
        columns: 4,
        rows: 2,
        frame_count: 8,
        cell_width: 444,
        cell_height: 444,
        duration_ms: 100,
        origin_y: 1024
      }),
      reduced_motion_frame_id: "thinking_tail-000"
    },
    asking_approval_bounce: {
      state: "asking_approval_bounce",
      fps: 12,
      loop: true,
      interruptible: true,
      priority: "urgent",
      anchor: { x: 222, y: 418 },
      source_green_path: "assets/cuu/source-green/asking_approval_bounce/cuu-asking-approval-bounce-sheet-v1-green.png",
      alpha_path: "assets/cuu/alpha/asking_approval_bounce/cuu-asking-approval-bounce-sheet-v1-alpha-clean.png",
      frames: createCuuSpriteAtlasGridFrames({
        state: "asking_approval_bounce",
        columns: 4,
        rows: 2,
        frame_count: 8,
        cell_width: 444,
        cell_height: 444,
        duration_ms: 83,
        origin_y: 1912
      }),
      reduced_motion_frame_id: "asking_approval_bounce-000"
    },
    carrying_document_step: {
      state: "carrying_document_step",
      fps: 10,
      loop: true,
      interruptible: true,
      priority: "normal",
      anchor: { x: 222, y: 418 },
      source_green_path: "assets/cuu/source-green/carrying_document_step/cuu-carrying-document-step-sheet-v1-green.png",
      alpha_path: "assets/cuu/alpha/carrying_document_step/cuu-carrying-document-step-sheet-v1-alpha-clean.png",
      frames: createCuuSpriteAtlasGridFrames({
        state: "carrying_document_step",
        columns: 4,
        rows: 2,
        frame_count: 8,
        cell_width: 444,
        cell_height: 444,
        duration_ms: 100,
        origin_y: 2800
      }),
      reduced_motion_frame_id: "carrying_document_step-000"
    },
    celebrating_jump: {
      state: "celebrating_jump",
      fps: 12,
      loop: false,
      interruptible: true,
      priority: "normal",
      anchor: { x: 222, y: 418 },
      source_green_path: "assets/cuu/source-green/celebrating_jump/cuu-celebrating-jump-sheet-v1-green.png",
      alpha_path: "assets/cuu/alpha/celebrating_jump/cuu-celebrating-jump-sheet-v1-alpha-clean.png",
      frames: createCuuSpriteAtlasGridFrames({
        state: "celebrating_jump",
        columns: 4,
        rows: 2,
        frame_count: 8,
        cell_width: 444,
        cell_height: 444,
        duration_ms: 83,
        origin_y: 3688
      }),
      reduced_motion_frame_id: "celebrating_jump-000"
    },
    searching_evidence_peek: {
      state: "searching_evidence_peek",
      fps: 10,
      loop: true,
      interruptible: true,
      priority: "normal",
      anchor: { x: 222, y: 418 },
      source_green_path: "assets/cuu/source-green/searching_evidence_peek/cuu-searching-evidence-peek-sheet-v1-green.png",
      alpha_path: "assets/cuu/alpha/searching_evidence_peek/cuu-searching-evidence-peek-sheet-v1-alpha-clean.png",
      frames: createCuuSpriteAtlasGridFrames({
        state: "searching_evidence_peek",
        columns: 4,
        rows: 2,
        frame_count: 8,
        cell_width: 444,
        cell_height: 444,
        duration_ms: 100,
        origin_y: 4576
      }),
      reduced_motion_frame_id: "searching_evidence_peek-000"
    }
  }
} satisfies CuuSpriteAtlasManifest;

export function validateDesktopCuuP1AtlasManifest(): CuuSpriteAtlasManifestIssue[] {
  return validateCuuSpriteAtlasManifest(desktopCuuP1AtlasManifest);
}
