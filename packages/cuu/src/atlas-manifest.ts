import { allCuuMotionHints, type CuuMotionHint, type CuuSpriteState } from "./motion.js";

export type CuuSpriteAtlasFormat = "png" | "webp";

export type CuuSpriteAtlasPriority = "idle" | "normal" | "urgent";

export type CuuSpriteAtlasImage = {
  image_path: string;
  width: number;
  height: number;
  pixel_ratio: 1 | 2;
  format: CuuSpriteAtlasFormat;
  source_green_path?: string;
  alpha_path?: string;
};

export type CuuSpriteAtlasAnchor = {
  x: number;
  y: number;
};

export type CuuSpriteAtlasFrame = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  duration_ms: number;
};

export type CuuSpriteAtlasClip = {
  state: CuuSpriteState;
  fps: number;
  loop: boolean;
  interruptible: boolean;
  priority: CuuSpriteAtlasPriority;
  anchor: CuuSpriteAtlasAnchor;
  frames: CuuSpriteAtlasFrame[];
  reduced_motion_frame_id: string;
  source_green_path?: string;
  alpha_path?: string;
};

export type CuuSpriteAtlasManifest = {
  version: 1;
  character: "Cuu";
  art_pack: string;
  default_state: CuuSpriteState;
  atlas: CuuSpriteAtlasImage;
  clips: Partial<Record<CuuSpriteState, CuuSpriteAtlasClip>>;
};

export type CuuSpriteAtlasManifestIssue = {
  path: string;
  message: string;
};

export type CuuSpriteAtlasValidationOptions = {
  require_full_motion_coverage?: boolean;
  hints?: CuuMotionHint[];
};

export type CuuSpriteAtlasGridInput = {
  state: CuuSpriteState;
  columns: number;
  rows: number;
  frame_count: number;
  cell_width: number;
  cell_height: number;
  duration_ms: number;
  id_prefix?: string;
  origin_x?: number;
  origin_y?: number;
};

export function createCuuSpriteAtlasGridFrames(input: CuuSpriteAtlasGridInput): CuuSpriteAtlasFrame[] {
  const frames: CuuSpriteAtlasFrame[] = [];
  const maxCells = input.columns * input.rows;
  const count = Math.min(input.frame_count, maxCells);
  for (let index = 0; index < count; index += 1) {
    const column = index % input.columns;
    const row = Math.floor(index / input.columns);
    frames.push({
      id: `${input.id_prefix ?? input.state}-${String(index).padStart(3, "0")}`,
      x: (input.origin_x ?? 0) + column * input.cell_width,
      y: (input.origin_y ?? 0) + row * input.cell_height,
      w: input.cell_width,
      h: input.cell_height,
      duration_ms: input.duration_ms
    });
  }
  return frames;
}

export function cuuAtlasClipForMotion(
  motion: CuuMotionHint,
  manifest: CuuSpriteAtlasManifest
): CuuSpriteAtlasClip | undefined {
  return manifest.clips[motion.sprite_state] ?? manifest.clips[manifest.default_state];
}

export function validateCuuSpriteAtlasManifest(
  manifest: CuuSpriteAtlasManifest,
  options: CuuSpriteAtlasValidationOptions = {}
): CuuSpriteAtlasManifestIssue[] {
  const issues: CuuSpriteAtlasManifestIssue[] = [];
  const hints = options.hints ?? allCuuMotionHints();
  if (manifest.version !== 1) {
    issues.push({ path: "version", message: "Cuu atlas manifest version must be 1." });
  }
  if (manifest.character !== "Cuu") {
    issues.push({ path: "character", message: "Cuu atlas manifest must describe Cuu." });
  }
  if (!manifest.art_pack.trim()) {
    issues.push({ path: "art_pack", message: "Cuu atlas manifest needs an art pack id." });
  }
  if (!manifest.atlas.image_path.trim()) {
    issues.push({ path: "atlas.image_path", message: "Atlas image path is required." });
  }
  if (manifest.atlas.width <= 0 || manifest.atlas.height <= 0) {
    issues.push({ path: "atlas", message: "Atlas width and height must be positive." });
  }
  if (!manifest.clips[manifest.default_state]) {
    issues.push({ path: "default_state", message: "Default atlas state must exist in clips." });
  }

  if (options.require_full_motion_coverage) {
    for (const hint of hints) {
      if (!manifest.clips[hint.sprite_state]) {
        issues.push({
          path: `clips.${hint.sprite_state}`,
          message: `Missing atlas clip for Cuu state ${hint.state}.`
        });
      }
    }
  }

  for (const [state, clip] of Object.entries(manifest.clips) as [CuuSpriteState, CuuSpriteAtlasClip | undefined][]) {
    if (!clip) {
      continue;
    }
    if (clip.state !== state) {
      issues.push({ path: `clips.${state}.state`, message: "Clip state must match its manifest key." });
    }
    if (clip.fps <= 0) {
      issues.push({ path: `clips.${state}.fps`, message: "Clip fps must be positive." });
    }
    if (!clip.frames.length) {
      issues.push({ path: `clips.${state}.frames`, message: "Clip must include at least one atlas frame." });
      continue;
    }
    if (!clip.frames.some((frame) => frame.id === clip.reduced_motion_frame_id)) {
      issues.push({
        path: `clips.${state}.reduced_motion_frame_id`,
        message: "Reduced motion frame must reference an existing atlas frame."
      });
    }
    validateAnchor(issues, state, clip.anchor);
    for (const [index, frame] of clip.frames.entries()) {
      validateFrame(issues, manifest, state, index, frame);
    }
  }

  return issues;
}

export function assertValidCuuSpriteAtlasManifest(
  manifest: CuuSpriteAtlasManifest,
  options: CuuSpriteAtlasValidationOptions = {}
): void {
  const issues = validateCuuSpriteAtlasManifest(manifest, options);
  if (issues.length) {
    throw new Error(`Invalid Cuu atlas manifest: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
  }
}

function validateAnchor(
  issues: CuuSpriteAtlasManifestIssue[],
  state: CuuSpriteState,
  anchor: CuuSpriteAtlasAnchor
) {
  if (anchor.x < 0 || anchor.y < 0) {
    issues.push({ path: `clips.${state}.anchor`, message: "Anchor coordinates must be non-negative." });
  }
}

function validateFrame(
  issues: CuuSpriteAtlasManifestIssue[],
  manifest: CuuSpriteAtlasManifest,
  state: CuuSpriteState,
  index: number,
  frame: CuuSpriteAtlasFrame
) {
  const path = `clips.${state}.frames.${index}`;
  if (!frame.id.trim()) {
    issues.push({ path: `${path}.id`, message: "Frame id is required." });
  }
  if (frame.duration_ms <= 0) {
    issues.push({ path: `${path}.duration_ms`, message: "Frame duration must be positive." });
  }
  if (frame.x < 0 || frame.y < 0 || frame.w <= 0 || frame.h <= 0) {
    issues.push({ path, message: "Frame rectangle must be positive and non-negative." });
  }
  if (frame.x + frame.w > manifest.atlas.width || frame.y + frame.h > manifest.atlas.height) {
    issues.push({ path, message: "Frame rectangle must stay inside the atlas image." });
  }
}
