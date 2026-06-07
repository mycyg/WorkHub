import {
  cuuLive2DMotionForSpriteState,
  validateCuuLive2DPsdDraftLayers,
  type CuuLive2DMotionId,
  type CuuMotionHint,
  type CuuSpriteAtlasClipState
} from "@workhub/cuu";

import {
  desktopCuuLive2DPsdDraftLayers,
  desktopCuuLive2DPsdDraftManifestUrl,
  desktopCuuLive2DPsdDraftReportUrl,
  desktopCuuLive2DPsdDraftSummary,
  type DesktopCuuLive2DPsdDraftLayer
} from "./cuu-live2d-psd-draft-assets.js";

export type DesktopCuuLive2DPsdDraftRender = {
  html: string;
  css: string;
  runtime_kind: "psd_draft_probe";
  status: typeof desktopCuuLive2DPsdDraftSummary.status;
  artifact: typeof desktopCuuLive2DPsdDraftSummary.artifact;
  motion_id: CuuLive2DMotionId;
  fallback_sprite_clip: CuuSpriteAtlasClipState;
  layer_count: number;
  visible_layer_count: number;
  animated_layer_count: number;
  expression_layer_count: number;
  duration_ms: number;
};

export type DesktopCuuLive2DPsdDraftRenderOptions = {
  display_width_px?: number;
  layers?: DesktopCuuLive2DPsdDraftLayer[];
  manifest_url?: string;
  report_url?: string;
};

const expressionLayerNames = new Set([
  "Eye_L_Closed",
  "Eye_R_Closed",
  "Eye_L_WorriedLine",
  "Eye_R_WorriedLine",
  "Mouth_OpenSmall",
  "Mouth_Surprised",
  "Mouth_Smile"
]);

const animatedBindTargets = new Set([
  "Tail_Base",
  "Tail_01",
  "Tail_02",
  "Tail_03",
  "Tail_Tip",
  "Ear_L",
  "Ear_R",
  "Eye_L",
  "Eye_R",
  "Mouth",
  "LaceBib",
  "Bow_L",
  "Bow_R",
  "Bow_Center",
  "Tassel_L_01",
  "Tassel_L_02",
  "Tassel_L_03",
  "Tassel_R_01",
  "Tassel_R_02",
  "Tassel_R_03",
  "Pearl_L",
  "Pearl_R",
  "RedBead_L",
  "RedBead_R",
  "Paw_L_Front",
  "Paw_R_Front"
]);

const desktopCuuPsdDraftCss = [
  ".wh-cuu-psd{position:relative;display:block;width:var(--wh-cuu-psd-w);height:var(--wh-cuu-psd-h);isolation:isolate;pointer-events:none;flex:0 0 auto;filter:drop-shadow(0 14px 18px rgba(35,27,20,.18));transform-origin:var(--wh-cuu-psd-anchor-x) var(--wh-cuu-psd-anchor-y)}",
  ".wh-cuu-psd-layer{position:absolute;display:block;left:var(--wh-psd-layer-x);top:var(--wh-psd-layer-y);z-index:var(--wh-psd-layer-z);width:var(--wh-psd-layer-w);height:var(--wh-psd-layer-h);opacity:var(--wh-psd-layer-opacity);transform-origin:var(--wh-psd-layer-origin-x) var(--wh-psd-layer-origin-y);pointer-events:none;user-select:none;will-change:transform,opacity}",
  ".wh-cuu-psd[data-cuu-live2d-motion=idle] [data-psd-bind-target^=Tail],.wh-cuu-psd[data-cuu-live2d-motion=look] [data-psd-bind-target^=Tail]{animation:wh-cuu-psd-tail-idle var(--wh-psd-tail-duration) ease-in-out infinite}",
  ".wh-cuu-psd [data-psd-bind-target=Tail_Base]{--wh-psd-tail-duration:3000ms}",
  ".wh-cuu-psd [data-psd-bind-target=Tail_01]{--wh-psd-tail-duration:2700ms}",
  ".wh-cuu-psd [data-psd-bind-target=Tail_02]{--wh-psd-tail-duration:2350ms}",
  ".wh-cuu-psd [data-psd-bind-target=Tail_03]{--wh-psd-tail-duration:2100ms}",
  ".wh-cuu-psd [data-psd-bind-target=Tail_Tip]{--wh-psd-tail-duration:1900ms}",
  ".wh-cuu-psd[data-cuu-live2d-motion=thinking] [data-psd-bind-target^=Tail],.wh-cuu-psd[data-cuu-live2d-motion=review] [data-psd-bind-target^=Tail]{animation:wh-cuu-psd-tail-thinking 1700ms ease-in-out infinite}",
  ".wh-cuu-psd[data-cuu-live2d-motion=worried] [data-psd-bind-target^=Tail],.wh-cuu-psd[data-cuu-live2d-motion=offline] [data-psd-bind-target^=Tail]{animation:wh-cuu-psd-tail-worried 2400ms ease-in-out infinite}",
  ".wh-cuu-psd [data-psd-bind-target=Ear_L]{animation:wh-cuu-psd-ear-l 4200ms ease-in-out infinite}",
  ".wh-cuu-psd [data-psd-bind-target=Ear_R]{animation:wh-cuu-psd-ear-r 3900ms ease-in-out infinite}",
  ".wh-cuu-psd[data-cuu-live2d-motion=worried] [data-psd-bind-target=Ear_L],.wh-cuu-psd[data-cuu-live2d-motion=offline] [data-psd-bind-target=Ear_L]{animation:wh-cuu-psd-ear-l-worried 1300ms ease-in-out infinite}",
  ".wh-cuu-psd[data-cuu-live2d-motion=worried] [data-psd-bind-target=Ear_R],.wh-cuu-psd[data-cuu-live2d-motion=offline] [data-psd-bind-target=Ear_R]{animation:wh-cuu-psd-ear-r-worried 1300ms ease-in-out infinite}",
  ".wh-cuu-psd [data-psd-bind-target=LaceBib]{animation:wh-cuu-psd-bib-idle 3200ms ease-in-out infinite}",
  ".wh-cuu-psd [data-psd-bind-target=Bow_L],.wh-cuu-psd [data-psd-bind-target=Bow_R],.wh-cuu-psd [data-psd-bind-target=Bow_Center]{animation:wh-cuu-psd-bow-idle 2600ms ease-in-out infinite}",
  ".wh-cuu-psd[data-cuu-live2d-motion=approval] [data-psd-bind-target^=Bow],.wh-cuu-psd[data-cuu-live2d-motion=tap] [data-psd-bind-target^=Bow],.wh-cuu-psd[data-cuu-live2d-motion=celebrate] [data-psd-bind-target^=Bow]{animation:wh-cuu-psd-bow-pop 820ms ease-out infinite}",
  ".wh-cuu-psd [data-psd-bind-target^=Tassel_L],.wh-cuu-psd [data-psd-bind-target=Pearl_L],.wh-cuu-psd [data-psd-bind-target=RedBead_L]{animation:wh-cuu-psd-tassel-l var(--wh-psd-tassel-duration) ease-in-out infinite}",
  ".wh-cuu-psd [data-psd-bind-target^=Tassel_R],.wh-cuu-psd [data-psd-bind-target=Pearl_R],.wh-cuu-psd [data-psd-bind-target=RedBead_R]{animation:wh-cuu-psd-tassel-r var(--wh-psd-tassel-duration) ease-in-out infinite}",
  ".wh-cuu-psd [data-psd-bind-target$=_01]{--wh-psd-tassel-duration:3100ms}",
  ".wh-cuu-psd [data-psd-bind-target$=_02]{--wh-psd-tassel-duration:2800ms}",
  ".wh-cuu-psd [data-psd-bind-target$=_03]{--wh-psd-tassel-duration:2500ms}",
  ".wh-cuu-psd [data-psd-bind-target=Pearl_L],.wh-cuu-psd [data-psd-bind-target=Pearl_R]{--wh-psd-tassel-duration:2300ms}",
  ".wh-cuu-psd [data-psd-bind-target=RedBead_L],.wh-cuu-psd [data-psd-bind-target=RedBead_R]{--wh-psd-tassel-duration:2100ms}",
  ".wh-cuu-psd[data-cuu-live2d-motion=approval] [data-psd-bind-target=Paw_L_Front],.wh-cuu-psd[data-cuu-live2d-motion=tap] [data-psd-bind-target=Paw_L_Front]{animation:wh-cuu-psd-paw-tap 900ms ease-in-out infinite}",
  ".wh-cuu-psd [data-psd-layer=Eye_L_Closed],.wh-cuu-psd [data-psd-layer=Eye_R_Closed]{opacity:0}",
  ".wh-cuu-psd [data-psd-eye-open=true]{animation:wh-cuu-psd-eye-open-idle 5200ms ease-in-out infinite}",
  ".wh-cuu-psd[data-cuu-live2d-motion=blink] [data-psd-eye-open=true]{animation:wh-cuu-psd-eye-open-blink 760ms ease-in-out infinite}",
  ".wh-cuu-psd[data-cuu-live2d-motion=blink] [data-psd-layer=Eye_L_Closed],.wh-cuu-psd[data-cuu-live2d-motion=blink] [data-psd-layer=Eye_R_Closed]{animation:wh-cuu-psd-eye-closed-blink 760ms ease-in-out infinite}",
  ".wh-cuu-psd[data-cuu-live2d-motion=idle] [data-psd-layer=Eye_L_Closed],.wh-cuu-psd[data-cuu-live2d-motion=idle] [data-psd-layer=Eye_R_Closed]{animation:wh-cuu-psd-eye-closed-idle 5200ms ease-in-out infinite}",
  ".wh-cuu-psd[data-cuu-live2d-motion=worried] [data-psd-layer=Eye_L_WorriedLine],.wh-cuu-psd[data-cuu-live2d-motion=worried] [data-psd-layer=Eye_R_WorriedLine]{opacity:1;animation:wh-cuu-psd-worried-eye 1600ms ease-in-out infinite}",
  ".wh-cuu-psd [data-psd-layer=Mouth_OpenSmall],.wh-cuu-psd [data-psd-layer=Mouth_Surprised],.wh-cuu-psd [data-psd-layer=Mouth_Smile]{opacity:0}",
  ".wh-cuu-psd[data-cuu-live2d-motion=approval] [data-psd-layer=Mouth_OpenSmall],.wh-cuu-psd[data-cuu-live2d-motion=thinking] [data-psd-layer=Mouth_OpenSmall]{opacity:1;animation:wh-cuu-psd-mouth-talk 1100ms ease-in-out infinite}",
  ".wh-cuu-psd[data-cuu-live2d-motion=celebrate] [data-psd-layer=Mouth_Smile]{opacity:1;animation:wh-cuu-psd-mouth-smile 900ms ease-in-out infinite}",
  ".wh-cuu-psd[data-cuu-live2d-motion=approval] [data-psd-layer=Mouth_Line_Closed],.wh-cuu-psd[data-cuu-live2d-motion=thinking] [data-psd-layer=Mouth_Line_Closed],.wh-cuu-psd[data-cuu-live2d-motion=celebrate] [data-psd-layer=Mouth_Line_Closed]{opacity:0}",
  "@keyframes wh-cuu-psd-tail-idle{0%,100%{transform:rotate(-8deg) translateX(-1px)}50%{transform:rotate(13deg) translateY(-2px)}}",
  "@keyframes wh-cuu-psd-tail-thinking{0%,100%{transform:rotate(-14deg)}36%{transform:rotate(20deg) translateY(-2px)}72%{transform:rotate(-4deg)}}",
  "@keyframes wh-cuu-psd-tail-worried{0%,100%{transform:rotate(-18deg) translateX(-2px)}50%{transform:rotate(-8deg) translateX(2px)}}",
  "@keyframes wh-cuu-psd-ear-l{0%,100%{transform:rotate(0deg)}46%{transform:rotate(-5deg) translateY(-1px)}72%{transform:rotate(2deg)}}",
  "@keyframes wh-cuu-psd-ear-r{0%,100%{transform:rotate(0deg)}48%{transform:rotate(5deg) translateY(-1px)}74%{transform:rotate(-2deg)}}",
  "@keyframes wh-cuu-psd-ear-l-worried{0%,100%{transform:rotate(-12deg) translateY(3px)}50%{transform:rotate(-5deg)}}",
  "@keyframes wh-cuu-psd-ear-r-worried{0%,100%{transform:rotate(12deg) translateY(3px)}50%{transform:rotate(5deg)}}",
  "@keyframes wh-cuu-psd-bib-idle{0%,100%{transform:rotate(0deg)}50%{transform:rotate(-1.2deg)}}",
  "@keyframes wh-cuu-psd-bow-idle{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-1px) scale(1.015)}}",
  "@keyframes wh-cuu-psd-bow-pop{0%,100%{transform:translateY(0) scale(1)}38%{transform:translateY(-4px) scale(1.08)}68%{transform:translateY(1px) scale(.98)}}",
  "@keyframes wh-cuu-psd-tassel-l{0%,100%{transform:rotate(-7deg) translateX(-1px)}50%{transform:rotate(9deg) translateX(1px)}}",
  "@keyframes wh-cuu-psd-tassel-r{0%,100%{transform:rotate(8deg) translateX(1px)}50%{transform:rotate(-9deg) translateX(-1px)}}",
  "@keyframes wh-cuu-psd-paw-tap{0%,100%{transform:translateY(0)}36%{transform:translateY(-11px)}62%{transform:translateY(2px)}}",
  "@keyframes wh-cuu-psd-eye-open-idle{0%,88%,95%,100%{opacity:var(--wh-psd-layer-opacity)}90%,93%{opacity:0}}",
  "@keyframes wh-cuu-psd-eye-closed-idle{0%,88%,95%,100%{opacity:0}90%,93%{opacity:1}}",
  "@keyframes wh-cuu-psd-eye-open-blink{0%,28%,100%{opacity:var(--wh-psd-layer-opacity)}42%,60%{opacity:0}}",
  "@keyframes wh-cuu-psd-eye-closed-blink{0%,28%,100%{opacity:0}42%,60%{opacity:1}}",
  "@keyframes wh-cuu-psd-worried-eye{0%,100%{transform:translateY(0)}50%{transform:translateY(1px)}}",
  "@keyframes wh-cuu-psd-mouth-talk{0%,100%{transform:scaleY(.82)}50%{transform:scaleY(1.05)}}",
  "@keyframes wh-cuu-psd-mouth-smile{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}",
  "@media (prefers-reduced-motion: reduce){.wh-cuu-psd-layer{animation:none!important}.wh-cuu-psd [data-psd-layer=Eye_L_Closed],.wh-cuu-psd [data-psd-layer=Eye_R_Closed],.wh-cuu-psd [data-psd-layer=Mouth_OpenSmall],.wh-cuu-psd [data-psd-layer=Mouth_Smile],.wh-cuu-psd [data-psd-layer=Mouth_Surprised]{opacity:0!important}}"
].join("");

export function renderDesktopCuuLive2DPsdDraftForMotion(
  motion: CuuMotionHint,
  options: DesktopCuuLive2DPsdDraftRenderOptions = {}
): DesktopCuuLive2DPsdDraftRender {
  return renderDesktopCuuLive2DPsdDraft(cuuLive2DMotionForSpriteState(motion.sprite_state), motion.sprite_state, options);
}

export function renderDesktopCuuLive2DPsdDraftForState(
  state: CuuSpriteAtlasClipState,
  options: DesktopCuuLive2DPsdDraftRenderOptions = {}
): DesktopCuuLive2DPsdDraftRender {
  return renderDesktopCuuLive2DPsdDraft(cuuLive2DMotionForSpriteState(state), state, options);
}

export function renderDesktopCuuLive2DPsdDraft(
  motionId: CuuLive2DMotionId,
  fallbackSpriteClip: CuuSpriteAtlasClipState = fallbackSpriteForMotion(motionId),
  options: DesktopCuuLive2DPsdDraftRenderOptions = {}
): DesktopCuuLive2DPsdDraftRender {
  const layers = options.layers ?? desktopCuuLive2DPsdDraftLayers;
  const issues = validateCuuLive2DPsdDraftLayers(layers);
  if (issues.length > 0) {
    throw new Error(`Cuu PSD draft runtime probe failed validation: ${issues.map((issue) => issue.code).join(", ")}`);
  }

  const displayWidth = options.display_width_px ?? 148;
  const scale = displayWidth / desktopCuuLive2DPsdDraftSummary.canvas.width;
  const displayHeight = Math.round(desktopCuuLive2DPsdDraftSummary.canvas.height * scale);
  const visibleLayerCount = layers.filter((layer) => layer.default_visible).length;
  const expressionLayerCount = layers.filter((layer) => expressionLayerNames.has(layer.name)).length;
  const animatedLayerCount = layers.filter((layer) => layer.bind_target && animatedBindTargets.has(layer.bind_target)).length;
  const style = [
    `--wh-cuu-psd-w:${displayWidth}px`,
    `--wh-cuu-psd-h:${displayHeight}px`,
    `--wh-cuu-psd-anchor-x:${Math.round(desktopCuuLive2DPsdDraftSummary.canvas.anchor_x * scale)}px`,
    `--wh-cuu-psd-anchor-y:${Math.round(desktopCuuLive2DPsdDraftSummary.canvas.anchor_y * scale)}px`
  ].join(";");
  const renderedLayers = layers
    .slice()
    .sort((left, right) => left.z_index - right.z_index)
    .map((layer) => renderLayer(layer, scale))
    .join("");

  return {
    runtime_kind: "psd_draft_probe",
    status: desktopCuuLive2DPsdDraftSummary.status,
    artifact: desktopCuuLive2DPsdDraftSummary.artifact,
    motion_id: motionId,
    fallback_sprite_clip: fallbackSpriteClip,
    layer_count: desktopCuuLive2DPsdDraftSummary.layer_count,
    visible_layer_count: visibleLayerCount,
    animated_layer_count: animatedLayerCount,
    expression_layer_count: expressionLayerCount,
    duration_ms: durationForMotion(motionId),
    css: desktopCuuPsdDraftCss,
    html: `<div class="wh-cuu-psd" data-cuu-live2d-runtime="psd_draft_probe" data-cuu-live2d-status="${desktopCuuLive2DPsdDraftSummary.status}" data-cuu-live2d-artifact="${desktopCuuLive2DPsdDraftSummary.artifact}" data-cuu-live2d-motion="${escapeHtml(motionId)}" data-cuu-live2d-fallback-sprite="${escapeHtml(fallbackSpriteClip)}" data-cuu-live2d-layer-count="${desktopCuuLive2DPsdDraftSummary.layer_count}" data-cuu-live2d-visible-layer-count="${visibleLayerCount}" data-cuu-live2d-animated-layer-count="${animatedLayerCount}" data-cuu-live2d-expression-layer-count="${expressionLayerCount}" data-cuu-live2d-manifest-url="${escapeHtml(documentRelativeAssetPath(options.manifest_url ?? desktopCuuLive2DPsdDraftManifestUrl))}" data-cuu-live2d-report-url="${escapeHtml(documentRelativeAssetPath(options.report_url ?? desktopCuuLive2DPsdDraftReportUrl))}" aria-label="${escapeHtml(labelForMotion(motionId))}" style="${escapeHtml(style)}">${renderedLayers}</div>`
  };
}

function renderLayer(layer: DesktopCuuLive2DPsdDraftLayer, scale: number) {
  const bindTarget = layer.bind_target ?? "";
  const style = [
    `--wh-psd-layer-x:${Math.round(layer.x * scale)}px`,
    `--wh-psd-layer-y:${Math.round(layer.y * scale)}px`,
    `--wh-psd-layer-w:${Math.round(layer.width * scale)}px`,
    `--wh-psd-layer-h:${Math.round(layer.height * scale)}px`,
    `--wh-psd-layer-z:${layer.z_index}`,
    `--wh-psd-layer-opacity:${roundOpacity(layer.opacity)}`,
    `--wh-psd-layer-origin-x:${Math.round(originXFor(layer) * scale)}px`,
    `--wh-psd-layer-origin-y:${Math.round(originYFor(layer) * scale)}px`
  ].join(";");
  const eyeOpen = /^Eye_[LR]_(White|Iris|Pupil|Highlight_01|UpperLid|LowerLid)$/u.test(layer.name) ? ' data-psd-eye-open="true"' : "";
  const expression = expressionLayerNames.has(layer.name) ? ' data-psd-expression-layer="true"' : "";
  return `<img class="wh-cuu-psd-layer" src="${escapeHtml(documentRelativeAssetPath(layer.image_path))}" alt="" aria-hidden="true" draggable="false" data-psd-layer="${escapeHtml(layer.name)}" data-psd-group="${escapeHtml(layer.group)}" data-psd-bind-target="${escapeHtml(bindTarget)}" data-psd-default-visible="${layer.default_visible ? "true" : "false"}"${eyeOpen}${expression} style="${escapeHtml(style)}">`;
}

function originXFor(layer: DesktopCuuLive2DPsdDraftLayer) {
  if (layer.bind_target?.startsWith("Tail")) {
    return 8;
  }
  if (layer.bind_target?.startsWith("Tassel") || layer.bind_target?.startsWith("Pearl") || layer.bind_target?.startsWith("RedBead")) {
    return layer.width / 2;
  }
  if (layer.bind_target === "Ear_L") {
    return layer.width * 0.72;
  }
  if (layer.bind_target === "Ear_R") {
    return layer.width * 0.28;
  }
  return layer.width / 2;
}

function originYFor(layer: DesktopCuuLive2DPsdDraftLayer) {
  if (layer.bind_target?.startsWith("Tail")) {
    return layer.height * 0.52;
  }
  if (layer.bind_target?.startsWith("Tassel") || layer.bind_target?.startsWith("Pearl") || layer.bind_target?.startsWith("RedBead")) {
    return 0;
  }
  if (layer.bind_target?.startsWith("Ear")) {
    return layer.height * 0.86;
  }
  return layer.height / 2;
}

function roundOpacity(opacity: number) {
  return (opacity / 255).toFixed(3).replace(/0+$/u, "").replace(/\.$/u, "");
}

function durationForMotion(motion: CuuLive2DMotionId) {
  const durations: Record<CuuLive2DMotionId, number> = {
    idle: 5200,
    blink: 760,
    look: 1800,
    thinking: 2800,
    approval: 1100,
    review: 2800,
    worried: 1500,
    celebrate: 960,
    drag: 1300,
    tap: 900,
    offline: 3200
  };
  return durations[motion];
}

function fallbackSpriteForMotion(motion: CuuLive2DMotionId): CuuSpriteAtlasClipState {
  const mapping: Record<CuuLive2DMotionId, CuuSpriteAtlasClipState> = {
    idle: "idle_breathe",
    blink: "idle_blink",
    look: "look_at_mouse",
    thinking: "thinking_tail",
    approval: "asking_approval_bounce",
    review: "searching_evidence_peek",
    worried: "worried_ears",
    celebrate: "celebrating_jump",
    drag: "drag_hold",
    tap: "tap_bubble",
    offline: "offline_sleep"
  };
  return mapping[motion];
}

function labelForMotion(motion: CuuLive2DMotionId) {
  const labels: Record<CuuLive2DMotionId, string> = {
    idle: "Cuu PSD 分层草案正在用尾巴、耳朵、流苏和眼睛做待机动作。",
    blink: "Cuu 用 PSD 眼睛图层眨眼。",
    look: "Cuu 用 PSD 眼睛和耳朵图层看向附近。",
    thinking: "Cuu 用 PSD 尾巴和嘴型图层表示正在思考。",
    approval: "Cuu 用 PSD 爪子、蝴蝶结和嘴型图层提醒你审批。",
    review: "Cuu 用 PSD 尾巴和眼神图层检查证据。",
    worried: "Cuu 用 PSD 耳朵、尾巴和担心眼线提醒风险。",
    celebrate: "Cuu 用 PSD 蝴蝶结和嘴型图层庆祝。",
    drag: "Cuu 正被拖动。",
    tap: "Cuu 用 PSD 爪子图层回应点击。",
    offline: "Cuu 用 PSD 耳朵和尾巴图层低存在感等待重连。"
  };
  return labels[motion];
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
      if (assetUrl.pathname.startsWith("/assets/")) {
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
