import {
  createCuuSpriteAtlasGridFrames,
  validateCuuSpriteAtlasManifest,
  type CuuSpriteAtlasManifest,
  type CuuSpriteAtlasManifestIssue
} from "@workhub/cuu";

const idleAtlasImage = new URL("./assets/cuu/atlas/cuu-p1-idle-breathe.png", import.meta.url).href;

export const desktopCuuP1AtlasManifestUrl = new URL("./assets/cuu/atlas/cuu.sprite.json", import.meta.url).href;

export const desktopCuuP1AtlasManifest = {
  version: 1,
  character: "Cuu",
  art_pack: "cuu-p1-green-screen-sample",
  default_state: "idle_breathe",
  atlas: {
    image_path: idleAtlasImage,
    source_green_path: "assets/cuu/source-green/idle_breathe/cuu-idle-breathe-sheet-v1-green.png",
    alpha_path: "assets/cuu/alpha/idle_breathe/cuu-idle-breathe-sheet-v1-alpha-clean.png",
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
    }
  }
} satisfies CuuSpriteAtlasManifest;

export function validateDesktopCuuP1AtlasManifest(): CuuSpriteAtlasManifestIssue[] {
  return validateCuuSpriteAtlasManifest(desktopCuuP1AtlasManifest);
}
