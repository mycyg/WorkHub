import {
  createCuuSpriteAtlasGridFrames,
  validateCuuSpriteAtlasManifest,
  type CuuSpriteAtlasClipState,
  type CuuSpriteAtlasManifest,
  type CuuSpriteAtlasManifestIssue
} from "@workhub/cuu";

const motionPackAtlasImage = new URL("./assets/cuu/atlas/cuu-p1-motion-pack.png", import.meta.url).href;
const askingApprovalBounceSheet = new URL("./assets/cuu/alpha/asking_approval_bounce/cuu-asking-approval-bounce-sheet-v1-alpha-clean.png", import.meta.url).href;
const carryingDocumentStepSheet = new URL("./assets/cuu/alpha/carrying_document_step/cuu-carrying-document-step-sheet-v1-alpha-clean.png", import.meta.url).href;
const celebratingJumpSheet = new URL("./assets/cuu/alpha/celebrating_jump/cuu-celebrating-jump-sheet-v1-alpha-clean.png", import.meta.url).href;
const dragHoldSheet = new URL("./assets/cuu/alpha/drag_hold/cuu-drag-hold-sheet-v1-alpha-clean.png", import.meta.url).href;
const idleBlinkSheet = new URL("./assets/cuu/alpha/idle_blink/cuu-idle-blink-sheet-v1-alpha-clean.png", import.meta.url).href;
const idleBreatheSheet = new URL("./assets/cuu/alpha/idle_breathe/cuu-idle-breathe-sheet-v1-alpha-clean.png", import.meta.url).href;
const idleTailSwaySheet = new URL("./assets/cuu/alpha/idle_tail_sway/cuu-idle-tail-sway-sheet-v1-alpha-clean.png", import.meta.url).href;
const lookAtMouseSheet = new URL("./assets/cuu/alpha/look_at_mouse/cuu-look-at-mouse-sheet-v1-alpha-clean.png", import.meta.url).href;
const offlineSleepSheet = new URL("./assets/cuu/alpha/offline_sleep/cuu-offline-sleep-sheet-v1-alpha-clean.png", import.meta.url).href;
const revisionRequestedNodSheet = new URL("./assets/cuu/alpha/revision_requested_nod/cuu-revision-requested-nod-sheet-v1-alpha-clean.png", import.meta.url).href;
const searchingEvidencePeekSheet = new URL("./assets/cuu/alpha/searching_evidence_peek/cuu-searching-evidence-peek-sheet-v1-alpha-clean.png", import.meta.url).href;
const sleepingCurlSheet = new URL("./assets/cuu/alpha/sleeping_curl/cuu-sleeping-curl-sheet-v1-alpha-clean.png", import.meta.url).href;
const syncingFilesSpinSheet = new URL("./assets/cuu/alpha/syncing_files_spin/cuu-syncing-files-spin-sheet-v1-alpha-clean.png", import.meta.url).href;
const tapBubbleSheet = new URL("./assets/cuu/alpha/tap_bubble/cuu-tap-bubble-sheet-v1-alpha-clean.png", import.meta.url).href;
const thinkingTailSheet = new URL("./assets/cuu/alpha/thinking_tail/cuu-thinking-tail-sheet-v1-alpha-clean.png", import.meta.url).href;
const wakeUpSheet = new URL("./assets/cuu/alpha/wake_up/cuu-wake-up-sheet-v1-alpha-clean.png", import.meta.url).href;
const waveHelloSheet = new URL("./assets/cuu/alpha/wave_hello/cuu-wave-hello-sheet-v1-alpha-clean.png", import.meta.url).href;
const worriedEarsSheet = new URL("./assets/cuu/alpha/worried_ears/cuu-worried-ears-sheet-v1-alpha-clean.png", import.meta.url).href;
const staticFallbackImage = new URL("./assets/cuu/static/cuu-static-fallback-v1-alpha-clean.png?inline", import.meta.url).href;

export const desktopCuuP1AtlasManifestUrl = new URL("./assets/cuu/atlas/cuu.sprite.json", import.meta.url).href;

export type DesktopCuuP1ClipSheetImage = {
  image_path: string;
  width: number;
  height: number;
  origin_x: number;
  origin_y: number;
};

export type DesktopCuuP1StaticFallbackImage = {
  image_path: string;
  width: number;
  height: number;
};

export const desktopCuuP1AtlasManifest = {
  version: 1,
  character: "Cuu",
  art_pack: "cuu-p1-motion-pack",
  default_state: "idle_breathe",
  atlas: {
    image_path: motionPackAtlasImage,
    width: 1776,
    height: 16120,
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
    },
    syncing_files_spin: {
      state: "syncing_files_spin",
      fps: 10,
      loop: true,
      interruptible: true,
      priority: "normal",
      anchor: { x: 222, y: 418 },
      source_green_path: "assets/cuu/source-green/syncing_files_spin/cuu-syncing-files-spin-sheet-v1-green.png",
      alpha_path: "assets/cuu/alpha/syncing_files_spin/cuu-syncing-files-spin-sheet-v1-alpha-clean.png",
      frames: createCuuSpriteAtlasGridFrames({
        state: "syncing_files_spin",
        columns: 4,
        rows: 2,
        frame_count: 8,
        cell_width: 444,
        cell_height: 444,
        duration_ms: 100,
        origin_y: 5464
      }),
      reduced_motion_frame_id: "syncing_files_spin-000"
    },
    worried_ears: {
      state: "worried_ears",
      fps: 8,
      loop: true,
      interruptible: true,
      priority: "urgent",
      anchor: { x: 222, y: 418 },
      source_green_path: "assets/cuu/source-green/worried_ears/cuu-worried-ears-sheet-v1-green.png",
      alpha_path: "assets/cuu/alpha/worried_ears/cuu-worried-ears-sheet-v1-alpha-clean.png",
      frames: createCuuSpriteAtlasGridFrames({
        state: "worried_ears",
        columns: 4,
        rows: 2,
        frame_count: 8,
        cell_width: 444,
        cell_height: 444,
        duration_ms: 125,
        origin_y: 6352
      }),
      reduced_motion_frame_id: "worried_ears-000"
    },
    revision_requested_nod: {
      state: "revision_requested_nod",
      fps: 10,
      loop: false,
      interruptible: true,
      priority: "normal",
      anchor: { x: 222, y: 418 },
      source_green_path: "assets/cuu/source-green/revision_requested_nod/cuu-revision-requested-nod-sheet-v1-green.png",
      alpha_path: "assets/cuu/alpha/revision_requested_nod/cuu-revision-requested-nod-sheet-v1-alpha-clean.png",
      frames: createCuuSpriteAtlasGridFrames({
        state: "revision_requested_nod",
        columns: 4,
        rows: 2,
        frame_count: 8,
        cell_width: 444,
        cell_height: 444,
        duration_ms: 100,
        origin_y: 7240
      }),
      reduced_motion_frame_id: "revision_requested_nod-000"
    },
    offline_sleep: {
      state: "offline_sleep",
      fps: 6,
      loop: true,
      interruptible: true,
      priority: "idle",
      anchor: { x: 222, y: 418 },
      source_green_path: "assets/cuu/source-green/offline_sleep/cuu-offline-sleep-sheet-v1-green.png",
      alpha_path: "assets/cuu/alpha/offline_sleep/cuu-offline-sleep-sheet-v1-alpha-clean.png",
      frames: createCuuSpriteAtlasGridFrames({
        state: "offline_sleep",
        columns: 4,
        rows: 2,
        frame_count: 8,
        cell_width: 444,
        cell_height: 444,
        duration_ms: 167,
        origin_y: 8128
      }),
      reduced_motion_frame_id: "offline_sleep-000"
    },
    idle_blink: {
      state: "idle_blink",
      fps: 10,
      loop: false,
      interruptible: true,
      priority: "idle",
      anchor: { x: 222, y: 418 },
      source_green_path: "assets/cuu/source-green/idle_blink/cuu-idle-blink-sheet-v1-green.png",
      alpha_path: "assets/cuu/alpha/idle_blink/cuu-idle-blink-sheet-v1-alpha-clean.png",
      frames: createCuuSpriteAtlasGridFrames({
        state: "idle_blink",
        columns: 4,
        rows: 2,
        frame_count: 8,
        cell_width: 444,
        cell_height: 444,
        duration_ms: 100,
        origin_y: 9016
      }),
      reduced_motion_frame_id: "idle_blink-000"
    },
    idle_tail_sway: {
      state: "idle_tail_sway",
      fps: 8,
      loop: true,
      interruptible: true,
      priority: "idle",
      anchor: { x: 222, y: 418 },
      source_green_path: "assets/cuu/source-green/idle_tail_sway/cuu-idle-tail-sway-sheet-v1-green.png",
      alpha_path: "assets/cuu/alpha/idle_tail_sway/cuu-idle-tail-sway-sheet-v1-alpha-clean.png",
      frames: createCuuSpriteAtlasGridFrames({
        state: "idle_tail_sway",
        columns: 4,
        rows: 2,
        frame_count: 8,
        cell_width: 444,
        cell_height: 444,
        duration_ms: 125,
        origin_y: 9904
      }),
      reduced_motion_frame_id: "idle_tail_sway-000"
    },
    look_at_mouse: {
      state: "look_at_mouse",
      fps: 10,
      loop: false,
      interruptible: true,
      priority: "idle",
      anchor: { x: 222, y: 418 },
      source_green_path: "assets/cuu/source-green/look_at_mouse/cuu-look-at-mouse-sheet-v1-green.png",
      alpha_path: "assets/cuu/alpha/look_at_mouse/cuu-look-at-mouse-sheet-v1-alpha-clean.png",
      frames: createCuuSpriteAtlasGridFrames({
        state: "look_at_mouse",
        columns: 4,
        rows: 2,
        frame_count: 8,
        cell_width: 444,
        cell_height: 444,
        duration_ms: 100,
        origin_y: 10792
      }),
      reduced_motion_frame_id: "look_at_mouse-000"
    },
    sleeping_curl: {
      state: "sleeping_curl",
      fps: 6,
      loop: true,
      interruptible: true,
      priority: "idle",
      anchor: { x: 222, y: 418 },
      source_green_path: "assets/cuu/source-green/sleeping_curl/cuu-sleeping-curl-sheet-v1-green.png",
      alpha_path: "assets/cuu/alpha/sleeping_curl/cuu-sleeping-curl-sheet-v1-alpha-clean.png",
      frames: createCuuSpriteAtlasGridFrames({
        state: "sleeping_curl",
        columns: 4,
        rows: 2,
        frame_count: 8,
        cell_width: 444,
        cell_height: 444,
        duration_ms: 167,
        origin_y: 11680
      }),
      reduced_motion_frame_id: "sleeping_curl-000"
    },
    wake_up: {
      state: "wake_up",
      fps: 10,
      loop: false,
      interruptible: true,
      priority: "normal",
      anchor: { x: 222, y: 418 },
      source_green_path: "assets/cuu/source-green/wake_up/cuu-wake-up-sheet-v1-green.png",
      alpha_path: "assets/cuu/alpha/wake_up/cuu-wake-up-sheet-v1-alpha-clean.png",
      frames: createCuuSpriteAtlasGridFrames({
        state: "wake_up",
        columns: 4,
        rows: 2,
        frame_count: 8,
        cell_width: 444,
        cell_height: 444,
        duration_ms: 100,
        origin_y: 12568
      }),
      reduced_motion_frame_id: "wake_up-000"
    },
    drag_hold: {
      state: "drag_hold",
      fps: 8,
      loop: true,
      interruptible: true,
      priority: "normal",
      anchor: { x: 222, y: 418 },
      source_green_path: "assets/cuu/source-green/drag_hold/cuu-drag-hold-sheet-v1-green.png",
      alpha_path: "assets/cuu/alpha/drag_hold/cuu-drag-hold-sheet-v1-alpha-clean.png",
      frames: createCuuSpriteAtlasGridFrames({
        state: "drag_hold",
        columns: 4,
        rows: 2,
        frame_count: 8,
        cell_width: 444,
        cell_height: 444,
        duration_ms: 125,
        origin_y: 13456
      }),
      reduced_motion_frame_id: "drag_hold-000"
    },
    tap_bubble: {
      state: "tap_bubble",
      fps: 12,
      loop: false,
      interruptible: true,
      priority: "normal",
      anchor: { x: 222, y: 418 },
      source_green_path: "assets/cuu/source-green/tap_bubble/cuu-tap-bubble-sheet-v1-green.png",
      alpha_path: "assets/cuu/alpha/tap_bubble/cuu-tap-bubble-sheet-v1-alpha-clean.png",
      frames: createCuuSpriteAtlasGridFrames({
        state: "tap_bubble",
        columns: 4,
        rows: 2,
        frame_count: 8,
        cell_width: 444,
        cell_height: 444,
        duration_ms: 83,
        origin_y: 14344
      }),
      reduced_motion_frame_id: "tap_bubble-000"
    },
    wave_hello: {
      state: "wave_hello",
      fps: 10,
      loop: false,
      interruptible: true,
      priority: "normal",
      anchor: { x: 222, y: 418 },
      source_green_path: "assets/cuu/source-green/wave_hello/cuu-wave-hello-sheet-v1-green.png",
      alpha_path: "assets/cuu/alpha/wave_hello/cuu-wave-hello-sheet-v1-alpha-clean.png",
      frames: createCuuSpriteAtlasGridFrames({
        state: "wave_hello",
        columns: 4,
        rows: 2,
        frame_count: 8,
        cell_width: 444,
        cell_height: 444,
        duration_ms: 100,
        origin_y: 15232
      }),
      reduced_motion_frame_id: "wave_hello-000"
    }
  }
} satisfies CuuSpriteAtlasManifest;

export function validateDesktopCuuP1AtlasManifest(): CuuSpriteAtlasManifestIssue[] {
  return validateCuuSpriteAtlasManifest(desktopCuuP1AtlasManifest);
}

export const desktopCuuP1ClipSheetImages = {
  idle_breathe: clipSheetImage("idle_breathe", idleBreatheSheet),
  thinking_tail: clipSheetImage("thinking_tail", thinkingTailSheet),
  asking_approval_bounce: clipSheetImage("asking_approval_bounce", askingApprovalBounceSheet),
  carrying_document_step: clipSheetImage("carrying_document_step", carryingDocumentStepSheet),
  celebrating_jump: clipSheetImage("celebrating_jump", celebratingJumpSheet),
  searching_evidence_peek: clipSheetImage("searching_evidence_peek", searchingEvidencePeekSheet),
  syncing_files_spin: clipSheetImage("syncing_files_spin", syncingFilesSpinSheet),
  worried_ears: clipSheetImage("worried_ears", worriedEarsSheet),
  revision_requested_nod: clipSheetImage("revision_requested_nod", revisionRequestedNodSheet),
  offline_sleep: clipSheetImage("offline_sleep", offlineSleepSheet),
  idle_blink: clipSheetImage("idle_blink", idleBlinkSheet),
  idle_tail_sway: clipSheetImage("idle_tail_sway", idleTailSwaySheet),
  look_at_mouse: clipSheetImage("look_at_mouse", lookAtMouseSheet),
  sleeping_curl: clipSheetImage("sleeping_curl", sleepingCurlSheet),
  wake_up: clipSheetImage("wake_up", wakeUpSheet),
  drag_hold: clipSheetImage("drag_hold", dragHoldSheet),
  tap_bubble: clipSheetImage("tap_bubble", tapBubbleSheet),
  wave_hello: clipSheetImage("wave_hello", waveHelloSheet)
} satisfies Partial<Record<CuuSpriteAtlasClipState, DesktopCuuP1ClipSheetImage>>;

export const desktopCuuP1StaticFallbackImage = {
  image_path: staticFallbackImage,
  width: 340,
  height: 420
} satisfies DesktopCuuP1StaticFallbackImage;

function clipSheetImage(state: CuuSpriteAtlasClipState, image_path: string): DesktopCuuP1ClipSheetImage {
  const clip = desktopCuuP1AtlasManifest.clips[state];
  if (!clip) {
    throw new Error(`Missing Cuu clip ${state}`);
  }
  const minX = Math.min(...clip.frames.map((frame) => frame.x));
  const minY = Math.min(...clip.frames.map((frame) => frame.y));
  const maxRight = Math.max(...clip.frames.map((frame) => frame.x + frame.w));
  const maxBottom = Math.max(...clip.frames.map((frame) => frame.y + frame.h));

  return {
    image_path,
    width: maxRight - minX,
    height: maxBottom - minY,
    origin_x: minX,
    origin_y: minY
  };
}
