import { allCuuMotionHints, type CuuMotionHint, type CuuSpriteState } from "./motion.js";

export type CuuProceduralPose =
  | "sit"
  | "think"
  | "bounce"
  | "carry"
  | "search"
  | "sync"
  | "worried"
  | "nod"
  | "jump"
  | "sleep";

export type CuuSpriteFrame = {
  id: string;
  duration_ms: number;
  pose: CuuProceduralPose;
  asset_path?: string;
  translate_y_px?: number;
  rotate_deg?: number;
  scale?: number;
  prop?: "document" | "magnifier" | "sync" | "warning" | "none";
};

export type CuuSpriteClip = {
  state: CuuSpriteState;
  fps: number;
  loop: boolean;
  frames: CuuSpriteFrame[];
  reduced_motion_frame_id: string;
};

export type CuuSpriteManifest = {
  version: 1;
  asset_base_path: string;
  default_state: CuuSpriteState;
  clips: Record<CuuSpriteState, CuuSpriteClip>;
};

export type CuuSpriteManifestIssue = {
  path: string;
  message: string;
};

function frame(
  state: CuuSpriteState,
  index: number,
  pose: CuuProceduralPose,
  duration_ms: number,
  input: Omit<CuuSpriteFrame, "id" | "pose" | "duration_ms"> = {}
): CuuSpriteFrame {
  return {
    id: `${state}-${index}`,
    pose,
    duration_ms,
    ...input
  };
}

function clip(
  state: CuuSpriteState,
  input: {
    fps: number;
    loop: boolean;
    frames: CuuSpriteFrame[];
  }
): CuuSpriteClip {
  return {
    state,
    fps: input.fps,
    loop: input.loop,
    frames: input.frames,
    reduced_motion_frame_id: input.frames[0]?.id ?? `${state}-0`
  };
}

export const defaultCuuSpriteManifest: CuuSpriteManifest = {
  version: 1,
  asset_base_path: "/assets/cuu/sprites",
  default_state: "idle_breathe",
  clips: {
    idle_breathe: clip("idle_breathe", {
      fps: 6,
      loop: true,
      frames: [
        frame("idle_breathe", 0, "sit", 180, { scale: 1 }),
        frame("idle_breathe", 1, "sit", 180, { translate_y_px: -2, scale: 1.01 }),
        frame("idle_breathe", 2, "sit", 180, { scale: 1 })
      ]
    }),
    thinking_tail: clip("thinking_tail", {
      fps: 7,
      loop: true,
      frames: [
        frame("thinking_tail", 0, "think", 150, { rotate_deg: -2 }),
        frame("thinking_tail", 1, "think", 150, { translate_y_px: -2 }),
        frame("thinking_tail", 2, "think", 150, { rotate_deg: 2 })
      ]
    }),
    asking_approval_bounce: clip("asking_approval_bounce", {
      fps: 8,
      loop: true,
      frames: [
        frame("asking_approval_bounce", 0, "bounce", 120, { translate_y_px: 0 }),
        frame("asking_approval_bounce", 1, "bounce", 120, { translate_y_px: -8, scale: 1.03 }),
        frame("asking_approval_bounce", 2, "bounce", 120, { translate_y_px: 0 })
      ]
    }),
    carrying_document_step: clip("carrying_document_step", {
      fps: 7,
      loop: true,
      frames: [
        frame("carrying_document_step", 0, "carry", 150, { prop: "document", rotate_deg: -2 }),
        frame("carrying_document_step", 1, "carry", 150, { prop: "document", translate_y_px: -4 }),
        frame("carrying_document_step", 2, "carry", 150, { prop: "document", rotate_deg: 2 })
      ]
    }),
    searching_evidence_peek: clip("searching_evidence_peek", {
      fps: 7,
      loop: true,
      frames: [
        frame("searching_evidence_peek", 0, "search", 140, { prop: "magnifier" }),
        frame("searching_evidence_peek", 1, "search", 140, { prop: "magnifier", rotate_deg: -5 }),
        frame("searching_evidence_peek", 2, "search", 140, { prop: "magnifier", rotate_deg: 5 })
      ]
    }),
    syncing_files_spin: clip("syncing_files_spin", {
      fps: 9,
      loop: true,
      frames: [
        frame("syncing_files_spin", 0, "sync", 110, { prop: "sync", rotate_deg: 0 }),
        frame("syncing_files_spin", 1, "sync", 110, { prop: "sync", rotate_deg: 8 }),
        frame("syncing_files_spin", 2, "sync", 110, { prop: "sync", rotate_deg: -8 })
      ]
    }),
    worried_ears: clip("worried_ears", {
      fps: 7,
      loop: true,
      frames: [
        frame("worried_ears", 0, "worried", 150, { prop: "warning" }),
        frame("worried_ears", 1, "worried", 150, { prop: "warning", rotate_deg: -3 }),
        frame("worried_ears", 2, "worried", 150, { prop: "warning", rotate_deg: 3 })
      ]
    }),
    revision_requested_nod: clip("revision_requested_nod", {
      fps: 8,
      loop: false,
      frames: [
        frame("revision_requested_nod", 0, "nod", 130, { translate_y_px: 0 }),
        frame("revision_requested_nod", 1, "nod", 130, { translate_y_px: 4 }),
        frame("revision_requested_nod", 2, "nod", 130, { translate_y_px: 0 })
      ]
    }),
    celebrating_jump: clip("celebrating_jump", {
      fps: 8,
      loop: false,
      frames: [
        frame("celebrating_jump", 0, "jump", 120, { translate_y_px: 0 }),
        frame("celebrating_jump", 1, "jump", 120, { translate_y_px: -12, scale: 1.04 }),
        frame("celebrating_jump", 2, "jump", 120, { translate_y_px: 0 })
      ]
    }),
    offline_sleep: clip("offline_sleep", {
      fps: 4,
      loop: true,
      frames: [
        frame("offline_sleep", 0, "sleep", 240, { scale: 0.98 }),
        frame("offline_sleep", 1, "sleep", 240, { translate_y_px: 1, scale: 0.98 })
      ]
    })
  }
};

export function cuuSpriteClipForMotion(
  motion: CuuMotionHint,
  manifest: CuuSpriteManifest = defaultCuuSpriteManifest
): CuuSpriteClip {
  return manifest.clips[motion.sprite_state] ?? manifest.clips[manifest.default_state];
}

export function validateCuuSpriteManifest(
  manifest: CuuSpriteManifest,
  hints: CuuMotionHint[] = allCuuMotionHints()
): CuuSpriteManifestIssue[] {
  const issues: CuuSpriteManifestIssue[] = [];
  if (manifest.version !== 1) {
    issues.push({ path: "version", message: "Cuu sprite manifest version must be 1." });
  }
  if (!manifest.clips[manifest.default_state]) {
    issues.push({ path: "default_state", message: "Default sprite state must exist in clips." });
  }

  for (const hint of hints) {
    const clipForHint = manifest.clips[hint.sprite_state];
    if (!clipForHint) {
      issues.push({
        path: `clips.${hint.sprite_state}`,
        message: `Missing sprite clip for Cuu state ${hint.state}.`
      });
      continue;
    }
    if (clipForHint.loop !== hint.loop) {
      issues.push({
        path: `clips.${hint.sprite_state}.loop`,
        message: `Loop flag must match motion hint for ${hint.state}.`
      });
    }
    if (!clipForHint.frames.length) {
      issues.push({
        path: `clips.${hint.sprite_state}.frames`,
        message: `Sprite clip for ${hint.state} must include at least one frame.`
      });
    }
    if (!clipForHint.frames.some((frameItem) => frameItem.id === clipForHint.reduced_motion_frame_id)) {
      issues.push({
        path: `clips.${hint.sprite_state}.reduced_motion_frame_id`,
        message: `Reduced motion frame for ${hint.state} must reference an existing frame.`
      });
    }
    for (const [index, frameItem] of clipForHint.frames.entries()) {
      if (frameItem.duration_ms <= 0) {
        issues.push({
          path: `clips.${hint.sprite_state}.frames.${index}.duration_ms`,
          message: "Frame duration must be positive."
        });
      }
    }
  }

  return issues;
}

export function assertValidCuuSpriteManifest(
  manifest: CuuSpriteManifest = defaultCuuSpriteManifest,
  hints: CuuMotionHint[] = allCuuMotionHints()
): void {
  const issues = validateCuuSpriteManifest(manifest, hints);
  if (issues.length) {
    throw new Error(`Invalid Cuu sprite manifest: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
  }
}
