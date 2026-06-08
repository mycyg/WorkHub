import {
  cuuBehaviorStateForState,
  cuuDefaultMotionDurationForClip,
  cuuMotionSlotForClip,
  resolveCuuVisibleModelPack,
  type CuuBehaviorBubbleMode,
  type CuuBehaviorCoverage,
  type CuuBehaviorPhase,
  type CuuBehaviorWindowMode,
  type CuuIdleMicroAction,
  type CuuMotionClipState,
  type CuuModelPackSelectionReason,
  type CuuMotionHint
} from "@workhub/cuu";
import type { CuuState } from "@workhub/contracts";

export type DesktopCuuCatLive2DModelKey = "hijiki" | "tororo";
export type DesktopCuuCatLive2DAppearance = "black_cat" | "white_cat";

export type DesktopCuuCatLive2DRender = {
  html: string;
  css: string;
  runtime_kind: "live2d_cubism2_cat";
  status: "approved_cat_option";
  model_pack_id: string;
  model_pack_selection_reason: CuuModelPackSelectionReason;
  state: CuuMotionClipState | CuuIdleMicroAction;
  motion_state: CuuMotionClipState;
  renderer_state: string;
  behavior_manifest_version: 1;
  behavior_state: CuuState;
  behavior_phase: CuuBehaviorPhase;
  behavior_coverage: CuuBehaviorCoverage;
  behavior_priority: number;
  behavior_window_mode: CuuBehaviorWindowMode;
  behavior_bubble_mode: CuuBehaviorBubbleMode;
  model_key: DesktopCuuCatLive2DModelKey;
  appearance: DesktopCuuCatLive2DAppearance;
  model_url: string;
  iframe_url: string;
  duration_ms: number;
};

export type DesktopCuuCatLive2DRenderOptions = {
  display_width_px?: number;
  requested_model_pack_id?: string | null | undefined;
};

export type DesktopCuuCatLive2DBehaviorState = {
  model_pack_id: string;
  model_pack_selection_reason: CuuModelPackSelectionReason;
  behavior_manifest_version: 1;
  behavior_state: CuuState;
  behavior_phase: CuuBehaviorPhase;
  behavior_coverage: CuuBehaviorCoverage;
  behavior_priority: number;
  behavior_window_mode: CuuBehaviorWindowMode;
  behavior_bubble_mode: CuuBehaviorBubbleMode;
  motion_state: CuuMotionClipState;
  renderer_state: string;
  duration_ms: number;
  interruptible: boolean;
  loop: boolean;
};

const catLive2DModels = {
  "cuu-hijiki-live2d-cubism2": {
    model_key: "hijiki",
    appearance: "black_cat",
    iframe_url: "./cuu/live2d/hijiki/cuu-hijiki.html",
    model_url: "./cuu/live2d/hijiki/cuu-hijiki.model.json",
    label: "Cuu black cat Live2D"
  },
  "cuu-tororo-live2d-cubism2": {
    model_key: "tororo",
    appearance: "white_cat",
    iframe_url: "./cuu/live2d/tororo/cuu-tororo.html",
    model_url: "./cuu/live2d/tororo/cuu-tororo.model.json",
    label: "Cuu white cat Live2D"
  }
} as const;

const desktopCuuCatLive2DCss = [
  ".wh-cuu-cat-live2d{position:relative;display:block;width:var(--wh-cuu-cat-w);height:var(--wh-cuu-cat-h);border:0;background:rgba(0,0,0,0)!important;pointer-events:none;isolation:isolate;overflow:hidden;flex:0 0 auto;filter:drop-shadow(0 14px 18px rgba(20,16,14,.24));transform-origin:50% 88%;transition:transform 120ms ease-out,filter 120ms ease-out}",
  ".wh-cuu-cat-live2d-frame{position:absolute;inset:0;width:100%;height:100%;border:0;background:rgba(0,0,0,0)!important;pointer-events:none;overflow:hidden}",
  ".wh-cuu-cat-live2d-fallback{display:none}",
  ".wh-cuu-cat-live2d[data-cuu-live2d-state=asking_approval_bounce],.wh-cuu-cat-live2d[data-cuu-live2d-state=tap_bubble]{animation:wh-cuu-cat-live2d-attention 1200ms ease-in-out infinite}",
  ".wh-cuu-cat-live2d[data-cuu-live2d-state=celebrating_jump],.wh-cuu-cat-live2d[data-cuu-live2d-state=wave_hello]{animation:wh-cuu-cat-live2d-celebrate 980ms ease-out infinite}",
  ".wh-cuu-cat-live2d[data-cuu-live2d-state=thinking_tail],.wh-cuu-cat-live2d[data-cuu-live2d-state=searching_evidence_peek],.wh-cuu-cat-live2d[data-cuu-live2d-state=syncing_files_spin]{animation:wh-cuu-cat-live2d-working 2200ms ease-in-out infinite}",
  ".wh-cuu-cat-live2d[data-cuu-live2d-state=worried_ears],.wh-cuu-cat-live2d[data-cuu-live2d-state=offline_sleep]{filter:drop-shadow(0 12px 16px rgba(20,16,14,.2)) saturate(.82);animation:wh-cuu-cat-live2d-worried 2600ms ease-in-out infinite}",
  ".wh-cuu-cat-live2d[data-cuu-live2d-state=drag_hold]{animation:wh-cuu-cat-live2d-drag 1000ms ease-in-out infinite}",
  ".wh-pet-surface[data-pet-cursor-near=true] .wh-cuu-cat-live2d{filter:drop-shadow(0 16px 18px rgba(20,16,14,.26)) saturate(1.03)}",
  "@keyframes wh-cuu-cat-live2d-attention{0%,100%{transform:translateY(0) scale(1)}42%{transform:translateY(-6px) scale(1.018)}72%{transform:translateY(1px) scale(.995)}}",
  "@keyframes wh-cuu-cat-live2d-celebrate{0%,100%{transform:translateY(0) rotate(0deg)}45%{transform:translateY(-9px) rotate(-2deg)}70%{transform:translateY(-1px) rotate(2deg)}}",
  "@keyframes wh-cuu-cat-live2d-working{0%,100%{transform:translateY(0) rotate(0deg)}50%{transform:translateY(-2px) rotate(1.5deg)}}",
  "@keyframes wh-cuu-cat-live2d-worried{0%,100%{transform:translateY(0) rotate(-1deg)}50%{transform:translateY(2px) rotate(1deg)}}",
  "@keyframes wh-cuu-cat-live2d-drag{0%,100%{transform:rotate(-1deg)}50%{transform:rotate(2deg)}}",
  "@media (prefers-reduced-motion: reduce){.wh-cuu-cat-live2d{animation:none!important}.wh-cuu-cat-live2d-frame{opacity:.96}}"
].join("");

export function renderDesktopCuuCatLive2DForMotion(
  motion: CuuMotionHint,
  options: DesktopCuuCatLive2DRenderOptions = {}
): DesktopCuuCatLive2DRender {
  return renderDesktopCuuCatLive2D(motion.sprite_state, {
    ...options,
    behavior_state: motion.state,
    behavior_phase: "loop"
  });
}

export function renderDesktopCuuCatLive2DForIdleAction(
  state: CuuMotionClipState | CuuIdleMicroAction,
  options: DesktopCuuCatLive2DRenderOptions = {}
): DesktopCuuCatLive2DRender {
  return renderDesktopCuuCatLive2D(state, {
    ...options,
    behavior_state: "idle",
    behavior_phase: "idle_random"
  });
}

export function resolveDesktopCuuCatLive2DBehaviorState(input: {
  state: CuuState;
  motion_state?: CuuMotionClipState | undefined;
  phase?: CuuBehaviorPhase | undefined;
  requested_model_pack_id?: string | null | undefined;
}): DesktopCuuCatLive2DBehaviorState {
  const selection = resolveCuuVisibleModelPack({ requested_pack_id: input.requested_model_pack_id });
  const behavior = cuuBehaviorStateForState(selection.active_pack.behavior_manifest, input.state);
  const phase = input.phase ?? "loop";
  const motionState = input.motion_state ?? behavior.loop[0]?.motion ?? "idle_breathe";
  const slot = phase === "idle_random"
    ? selection.active_pack.behavior_manifest.idle_random.find((candidate) => candidate.motion === motionState)
    : phase === "enter"
      ? behavior.enter
      : phase === "exit"
        ? behavior.exit
        : behavior.loop.find((candidate) => candidate.motion === motionState) ?? behavior.loop[0];
  const resolvedSlot = slot ?? cuuMotionSlotForClip(motionState, { coverage: behavior.coverage });
  return {
    model_pack_id: selection.active_pack.pack_id,
    model_pack_selection_reason: selection.reason,
    behavior_manifest_version: selection.active_pack.behavior_manifest.version,
    behavior_state: input.state,
    behavior_phase: phase,
    behavior_coverage: resolvedSlot.coverage,
    behavior_priority: behavior.priority,
    behavior_window_mode: behavior.window_mode,
    behavior_bubble_mode: behavior.bubble_mode,
    motion_state: motionState,
    renderer_state: resolvedSlot.renderer_state,
    duration_ms: resolvedSlot.min_duration_ms ?? cuuDefaultMotionDurationForClip(motionState),
    interruptible: resolvedSlot.interruptible,
    loop: resolvedSlot.loop
  };
}

export function setDesktopCuuCatLive2DBehaviorState(
  root: ParentNode,
  input: {
    state: CuuState;
    motion_state?: CuuMotionClipState | undefined;
    phase?: CuuBehaviorPhase | undefined;
    requested_model_pack_id?: string | null | undefined;
  }
): boolean {
  const target = root.querySelector<HTMLElement>(".wh-cuu-cat-live2d");
  if (!target) {
    return false;
  }
  const behavior = resolveDesktopCuuCatLive2DBehaviorState(input);
  target.dataset.cuuBehaviorManifestVersion = String(behavior.behavior_manifest_version);
  target.dataset.cuuBehaviorState = behavior.behavior_state;
  target.dataset.cuuBehaviorPhase = behavior.behavior_phase;
  target.dataset.cuuBehaviorCoverage = behavior.behavior_coverage;
  target.dataset.cuuBehaviorPriority = String(behavior.behavior_priority);
  target.dataset.cuuBehaviorExpectedWindowMode = behavior.behavior_window_mode;
  target.dataset.cuuBehaviorExpectedBubbleMode = behavior.behavior_bubble_mode;
  target.dataset.cuuLive2dState = behavior.motion_state;
  target.dataset.cuuLive2dMotion = behavior.motion_state;
  target.dataset.cuuLive2dRendererState = behavior.renderer_state;
  target.dataset.cuuLive2dLoop = behavior.loop ? "true" : "false";
  target.dataset.cuuLive2dInterruptible = behavior.interruptible ? "true" : "false";
  return true;
}

function renderDesktopCuuCatLive2D(
  state: CuuMotionClipState | CuuIdleMicroAction,
  options: DesktopCuuCatLive2DRenderOptions & {
    behavior_state: CuuState;
    behavior_phase: CuuBehaviorPhase;
  }
): DesktopCuuCatLive2DRender {
  const selection = resolveCuuVisibleModelPack({ requested_pack_id: options.requested_model_pack_id });
  const model = modelConfigForPack(selection.active_pack.pack_id);
  const displayWidth = options.display_width_px ?? 230;
  const displayHeight = Math.round(displayWidth * 1.39);
  const motionState = state as CuuMotionClipState;
  const style = [
    `--wh-cuu-cat-w:${displayWidth}px`,
    `--wh-cuu-cat-h:${displayHeight}px`
  ].join(";");
  const iframeUrl = documentRelativeAssetPath(model.iframe_url);
  const modelUrl = documentRelativeAssetPath(model.model_url);
  const behavior = resolveDesktopCuuCatLive2DBehaviorState({
    state: options.behavior_state,
    motion_state: motionState,
    phase: options.behavior_phase,
    requested_model_pack_id: selection.active_pack.pack_id
  });

  return {
    html: `<div class="wh-cuu-cat-live2d" data-cuu-live2d-runtime="live2d_cubism2_cat" data-cuu-live2d-status="approved_cat_option" data-cuu-live2d-framing="transparent_full_body" data-cuu-live2d-model="${escapeHtml(model.model_key)}" data-cuu-live2d-appearance="${escapeHtml(model.appearance)}" data-cuu-live2d-state="${escapeHtml(state)}" data-cuu-live2d-motion="${escapeHtml(behavior.motion_state)}" data-cuu-live2d-renderer-state="${escapeHtml(behavior.renderer_state)}" data-cuu-live2d-loop="${behavior.loop ? "true" : "false"}" data-cuu-live2d-interruptible="${behavior.interruptible ? "true" : "false"}" data-cuu-live2d-model-url="${escapeHtml(modelUrl)}" data-cuu-live2d-frame-url="${escapeHtml(iframeUrl)}" data-cuu-live2d-layer-count="native_moc" data-cuu-behavior-manifest-version="${behavior.behavior_manifest_version}" data-cuu-behavior-state="${escapeHtml(behavior.behavior_state)}" data-cuu-behavior-phase="${escapeHtml(behavior.behavior_phase)}" data-cuu-behavior-coverage="${escapeHtml(behavior.behavior_coverage)}" data-cuu-behavior-priority="${escapeHtml(behavior.behavior_priority)}" data-cuu-behavior-expected-window-mode="${escapeHtml(behavior.behavior_window_mode)}" data-cuu-behavior-expected-bubble-mode="${escapeHtml(behavior.behavior_bubble_mode)}" data-cuu-model-pack="${escapeHtml(selection.active_pack.pack_id)}" data-cuu-model-pack-selection-reason="${escapeHtml(selection.reason)}" aria-label="${escapeHtml(labelForState(motionState, model.label))}" style="${escapeHtml(style)}"><iframe class="wh-cuu-cat-live2d-frame" title="${escapeHtml(model.label)}" src="${escapeHtml(iframeUrl)}" loading="eager"></iframe><span class="wh-cuu-cat-live2d-fallback" aria-hidden="true">Cuu</span></div>`,
    css: desktopCuuCatLive2DCss,
    runtime_kind: "live2d_cubism2_cat",
    status: "approved_cat_option",
    model_pack_id: selection.active_pack.pack_id,
    model_pack_selection_reason: selection.reason,
    state,
    motion_state: motionState,
    renderer_state: behavior.renderer_state,
    behavior_manifest_version: behavior.behavior_manifest_version,
    behavior_state: behavior.behavior_state,
    behavior_phase: behavior.behavior_phase,
    behavior_coverage: behavior.behavior_coverage,
    behavior_priority: behavior.behavior_priority,
    behavior_window_mode: behavior.behavior_window_mode,
    behavior_bubble_mode: behavior.behavior_bubble_mode,
    model_key: model.model_key,
    appearance: model.appearance,
    model_url: modelUrl,
    iframe_url: iframeUrl,
    duration_ms: behavior.duration_ms
  };
}

function modelConfigForPack(packId: string): (typeof catLive2DModels)[keyof typeof catLive2DModels] {
  return catLive2DModels[packId as keyof typeof catLive2DModels] ?? catLive2DModels["cuu-hijiki-live2d-cubism2"];
}

function labelForState(state: CuuMotionClipState, modelLabel: string) {
  if (state === "asking_approval_bounce") {
    return `${modelLabel} is asking for approval.`;
  }
  if (state === "searching_evidence_peek") {
    return `${modelLabel} is checking evidence.`;
  }
  if (state === "celebrating_jump") {
    return `${modelLabel} is celebrating.`;
  }
  if (state === "offline_sleep") {
    return `${modelLabel} is waiting while offline.`;
  }
  return `${modelLabel} is idling.`;
}

function documentRelativeAssetPath(value: string) {
  try {
    const locationHref = globalThis.location?.href;
    if (!locationHref) {
      return value;
    }
    const assetUrl = new URL(value, locationHref);
    const documentUrl = new URL(locationHref);
    if (assetUrl.origin === documentUrl.origin) {
      const assetPath = `${assetUrl.pathname}${assetUrl.search}${assetUrl.hash}`;
      if (assetUrl.pathname.startsWith("/assets/") || assetUrl.pathname.startsWith("/cuu/")) {
        return `.${assetPath}`;
      }
      return assetPath;
    }
  } catch {
    return value;
  }
  return value;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}
