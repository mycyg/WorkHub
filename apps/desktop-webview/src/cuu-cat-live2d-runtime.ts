import {
  resolveCuuVisibleModelPack,
  type CuuIdleMicroAction,
  type CuuMotionClipState,
  type CuuModelPackSelectionReason,
  type CuuMotionHint
} from "@workhub/cuu";

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
  ".wh-cuu-cat-live2d{position:relative;display:block;width:var(--wh-cuu-cat-w);height:var(--wh-cuu-cat-h);pointer-events:none;isolation:isolate;overflow:hidden;flex:0 0 auto;filter:drop-shadow(0 14px 18px rgba(20,16,14,.24));transform-origin:50% 88%;transition:transform 120ms ease-out,filter 120ms ease-out}",
  ".wh-cuu-cat-live2d-frame{position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent;pointer-events:none;overflow:hidden}",
  ".wh-cuu-cat-live2d-fallback{display:none}",
  ".wh-cuu-cat-live2d[data-cuu-live2d-state=asking_approval_bounce],.wh-cuu-cat-live2d[data-cuu-live2d-state=tap_bubble]{animation:wh-cuu-cat-live2d-attention 1200ms ease-in-out infinite}",
  ".wh-cuu-cat-live2d[data-cuu-live2d-state=celebrating_jump],.wh-cuu-cat-live2d[data-cuu-live2d-state=wave_hello]{animation:wh-cuu-cat-live2d-celebrate 980ms ease-out infinite}",
  ".wh-cuu-cat-live2d[data-cuu-live2d-state=thinking_tail],.wh-cuu-cat-live2d[data-cuu-live2d-state=searching_evidence_peek],.wh-cuu-cat-live2d[data-cuu-live2d-state=syncing_files_spin]{animation:wh-cuu-cat-live2d-working 2200ms ease-in-out infinite}",
  ".wh-cuu-cat-live2d[data-cuu-live2d-state=worried_ears],.wh-cuu-cat-live2d[data-cuu-live2d-state=offline_sleep]{filter:drop-shadow(0 12px 16px rgba(20,16,14,.2)) saturate(.82);animation:wh-cuu-cat-live2d-worried 2600ms ease-in-out infinite}",
  ".wh-cuu-cat-live2d[data-cuu-live2d-state=drag_hold]{animation:wh-cuu-cat-live2d-drag 1000ms ease-in-out infinite}",
  ".wh-pet-surface[data-pet-cursor-near=true] .wh-cuu-cat-live2d{transform:translate(var(--wh-pet-look-head-x-px,0px),var(--wh-pet-look-head-y-px,0px)) rotate(var(--wh-pet-look-rotate-deg,0deg));filter:drop-shadow(0 16px 18px rgba(20,16,14,.26)) saturate(1.03)}",
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
  return renderDesktopCuuCatLive2D(motion.sprite_state, options);
}

export function renderDesktopCuuCatLive2DForIdleAction(
  state: CuuMotionClipState | CuuIdleMicroAction,
  options: DesktopCuuCatLive2DRenderOptions = {}
): DesktopCuuCatLive2DRender {
  return renderDesktopCuuCatLive2D(state, options);
}

function renderDesktopCuuCatLive2D(
  state: CuuMotionClipState | CuuIdleMicroAction,
  options: DesktopCuuCatLive2DRenderOptions
): DesktopCuuCatLive2DRender {
  const selection = resolveCuuVisibleModelPack({ requested_pack_id: options.requested_model_pack_id });
  const model = modelConfigForPack(selection.active_pack.pack_id);
  const displayWidth = options.display_width_px ?? 148;
  const displayHeight = Math.round(displayWidth * 1.34);
  const motionState = state as CuuMotionClipState;
  const style = [
    `--wh-cuu-cat-w:${displayWidth}px`,
    `--wh-cuu-cat-h:${displayHeight}px`
  ].join(";");
  const iframeUrl = documentRelativeAssetPath(model.iframe_url);
  const modelUrl = documentRelativeAssetPath(model.model_url);

  return {
    html: `<div class="wh-cuu-cat-live2d" data-cuu-live2d-runtime="live2d_cubism2_cat" data-cuu-live2d-status="approved_cat_option" data-cuu-live2d-model="${escapeHtml(model.model_key)}" data-cuu-live2d-appearance="${escapeHtml(model.appearance)}" data-cuu-live2d-state="${escapeHtml(state)}" data-cuu-live2d-motion="${escapeHtml(motionFileForState(motionState))}" data-cuu-live2d-model-url="${escapeHtml(modelUrl)}" data-cuu-live2d-frame-url="${escapeHtml(iframeUrl)}" data-cuu-live2d-layer-count="native_moc" data-cuu-model-pack="${escapeHtml(selection.active_pack.pack_id)}" data-cuu-model-pack-selection-reason="${escapeHtml(selection.reason)}" aria-label="${escapeHtml(labelForState(motionState, model.label))}" style="${escapeHtml(style)}"><iframe class="wh-cuu-cat-live2d-frame" title="${escapeHtml(model.label)}" src="${escapeHtml(iframeUrl)}" loading="eager"></iframe><span class="wh-cuu-cat-live2d-fallback" aria-hidden="true">Cuu</span></div>`,
    css: desktopCuuCatLive2DCss,
    runtime_kind: "live2d_cubism2_cat",
    status: "approved_cat_option",
    model_pack_id: selection.active_pack.pack_id,
    model_pack_selection_reason: selection.reason,
    state,
    motion_state: motionState,
    model_key: model.model_key,
    appearance: model.appearance,
    model_url: modelUrl,
    iframe_url: iframeUrl,
    duration_ms: durationForState(motionState)
  };
}

function modelConfigForPack(packId: string): (typeof catLive2DModels)[keyof typeof catLive2DModels] {
  return catLive2DModels[packId as keyof typeof catLive2DModels] ?? catLive2DModels["cuu-hijiki-live2d-cubism2"];
}

function motionFileForState(state: CuuMotionClipState) {
  switch (state) {
    case "celebrating_jump":
    case "wave_hello":
      return "mtn/06.mtn";
    case "asking_approval_bounce":
    case "tap_bubble":
      return "mtn/01.mtn";
    case "thinking_tail":
    case "searching_evidence_peek":
    case "syncing_files_spin":
      return "mtn/04.mtn";
    case "worried_ears":
    case "offline_sleep":
    case "sleeping_curl":
      return "mtn/08.mtn";
    case "drag_hold":
      return "mtn/05.mtn";
    default:
      return "mtn/00_idle.mtn";
  }
}

function durationForState(state: CuuMotionClipState) {
  if (state === "celebrating_jump" || state === "wave_hello") {
    return 980;
  }
  if (state === "asking_approval_bounce" || state === "tap_bubble") {
    return 1200;
  }
  if (state === "offline_sleep" || state === "sleeping_curl") {
    return 3200;
  }
  return 2200;
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
