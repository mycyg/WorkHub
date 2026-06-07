import {
  cuuLive2DMotionForSpriteState,
  type CuuLive2DLayerId,
  type CuuLive2DManifest,
  type CuuLive2DMotion,
  type CuuLive2DMotionId,
  type CuuMotionHint,
  type CuuSpriteAtlasClipState
} from "@workhub/cuu";

import {
  desktopCuuLive2DPrototypeLayerImages,
  desktopCuuLive2DPrototypeManifest,
  desktopCuuLive2DPrototypeManifestUrl,
  validateDesktopCuuLive2DPrototypeManifest,
  type DesktopCuuLive2DLayerImage
} from "./cuu-live2d-assets.js";

export type DesktopCuuLive2DRender = {
  html: string;
  css: string;
  manifest: CuuLive2DManifest;
  runtime_kind: "prototype_layered";
  status: CuuLive2DManifest["status"];
  motion: CuuLive2DMotion;
  motion_id: CuuLive2DMotionId;
  fallback_sprite_clip: CuuSpriteAtlasClipState;
  layer_count: number;
  duration_ms: number;
};

export type DesktopCuuLive2DRenderOptions = {
  display_width_px?: number;
  manifest?: CuuLive2DManifest;
  manifest_url?: string;
  layer_images?: Record<CuuLive2DLayerId, DesktopCuuLive2DLayerImage>;
};

const desktopCuuLive2DBaseCss = [
  ".wh-cuu-live2d{position:relative;display:block;width:var(--wh-cuu-live2d-w);height:var(--wh-cuu-live2d-h);isolation:isolate;pointer-events:none;flex:0 0 auto;filter:drop-shadow(0 14px 18px rgba(35,27,20,.18));transform-origin:var(--wh-cuu-live2d-anchor-x) var(--wh-cuu-live2d-anchor-y);animation:var(--wh-cuu-live2d-root-animation) var(--wh-cuu-live2d-root-duration) ease-in-out infinite}",
  ".wh-cuu-live2d-layer{position:absolute;display:block;left:var(--wh-cuu-layer-x);top:var(--wh-cuu-layer-y);z-index:var(--wh-cuu-layer-z);width:var(--wh-cuu-layer-w);height:var(--wh-cuu-layer-h);transform-origin:var(--wh-cuu-layer-pivot-x) var(--wh-cuu-layer-pivot-y);pointer-events:none;user-select:none;will-change:transform,opacity}",
  ".wh-cuu-live2d-layer[data-live2d-layer=tail]{animation:var(--wh-cuu-live2d-tail-animation) var(--wh-cuu-live2d-tail-duration) ease-in-out infinite}",
  ".wh-cuu-live2d-layer[data-live2d-layer=head]{animation:var(--wh-cuu-live2d-head-animation) var(--wh-cuu-live2d-head-duration) ease-in-out infinite}",
  ".wh-cuu-live2d-layer[data-live2d-layer=lace_bib]{animation:var(--wh-cuu-live2d-bib-animation) var(--wh-cuu-live2d-bib-duration) ease-in-out infinite}",
  ".wh-cuu-live2d-layer[data-live2d-layer=bow]{animation:var(--wh-cuu-live2d-bow-animation) var(--wh-cuu-live2d-bow-duration) ease-in-out infinite}",
  ".wh-cuu-live2d-layer[data-live2d-layer=tassel_l]{animation:var(--wh-cuu-live2d-tassel-l-animation) var(--wh-cuu-live2d-tassel-duration) ease-in-out infinite}",
  ".wh-cuu-live2d-layer[data-live2d-layer=tassel_r]{animation:var(--wh-cuu-live2d-tassel-r-animation) var(--wh-cuu-live2d-tassel-duration) ease-in-out infinite}",
  ".wh-cuu-live2d-layer[data-live2d-layer=front_paws]{animation:var(--wh-cuu-live2d-paw-animation) var(--wh-cuu-live2d-paw-duration) ease-in-out infinite}",
  ".wh-cuu-live2d-eye{position:absolute;z-index:80;left:var(--wh-cuu-eye-x);top:var(--wh-cuu-eye-y);width:var(--wh-cuu-eye-w);height:var(--wh-cuu-eye-h);border-radius:999px;background:linear-gradient(180deg,#f4b069 0%,#d37a38 100%);opacity:0;transform:rotate(var(--wh-cuu-eye-rotate)) scaleY(.1);transform-origin:50% 50%;animation:var(--wh-cuu-live2d-eye-animation) var(--wh-cuu-live2d-eye-duration) ease-in-out infinite;box-shadow:0 1px 0 rgba(255,255,255,.45) inset;pointer-events:none}",
  ".wh-cuu-live2d[data-loop=false]{animation-iteration-count:1;animation-fill-mode:both}",
  ".wh-cuu-live2d[data-loop=false] .wh-cuu-live2d-layer,.wh-cuu-live2d[data-loop=false] .wh-cuu-live2d-eye{animation-iteration-count:1;animation-fill-mode:both}",
  ".wh-cuu-live2d{--wh-cuu-live2d-root-animation:wh-cuu-live2d-root-idle;--wh-cuu-live2d-root-duration:2400ms;--wh-cuu-live2d-tail-animation:wh-cuu-live2d-tail-idle;--wh-cuu-live2d-tail-duration:2600ms;--wh-cuu-live2d-head-animation:wh-cuu-live2d-head-idle;--wh-cuu-live2d-head-duration:4200ms;--wh-cuu-live2d-bib-animation:wh-cuu-live2d-bib-idle;--wh-cuu-live2d-bib-duration:3100ms;--wh-cuu-live2d-bow-animation:wh-cuu-live2d-bow-idle;--wh-cuu-live2d-bow-duration:2400ms;--wh-cuu-live2d-tassel-l-animation:wh-cuu-live2d-tassel-l-idle;--wh-cuu-live2d-tassel-r-animation:wh-cuu-live2d-tassel-r-idle;--wh-cuu-live2d-tassel-duration:3200ms;--wh-cuu-live2d-paw-animation:wh-cuu-live2d-paw-idle;--wh-cuu-live2d-paw-duration:3600ms;--wh-cuu-live2d-eye-animation:wh-cuu-live2d-eye-idle;--wh-cuu-live2d-eye-duration:5200ms}",
  ".wh-cuu-live2d[data-cuu-live2d-motion=approval],.wh-cuu-live2d[data-cuu-live2d-motion=tap]{--wh-cuu-live2d-root-animation:wh-cuu-live2d-root-hop;--wh-cuu-live2d-root-duration:1100ms;--wh-cuu-live2d-bow-animation:wh-cuu-live2d-bow-pop;--wh-cuu-live2d-bow-duration:800ms;--wh-cuu-live2d-paw-animation:wh-cuu-live2d-paw-tap;--wh-cuu-live2d-paw-duration:860ms;--wh-cuu-live2d-tassel-duration:1100ms}",
  ".wh-cuu-live2d[data-cuu-live2d-motion=thinking],.wh-cuu-live2d[data-cuu-live2d-motion=review]{--wh-cuu-live2d-head-animation:wh-cuu-live2d-head-thinking;--wh-cuu-live2d-head-duration:2800ms;--wh-cuu-live2d-tail-animation:wh-cuu-live2d-tail-thinking;--wh-cuu-live2d-tail-duration:1900ms;--wh-cuu-live2d-bib-duration:2400ms}",
  ".wh-cuu-live2d[data-cuu-live2d-motion=worried]{--wh-cuu-live2d-root-animation:wh-cuu-live2d-root-worried;--wh-cuu-live2d-root-duration:900ms;--wh-cuu-live2d-head-animation:wh-cuu-live2d-head-worried;--wh-cuu-live2d-head-duration:1500ms;--wh-cuu-live2d-tail-animation:wh-cuu-live2d-tail-tuck;--wh-cuu-live2d-tail-duration:1700ms}",
  ".wh-cuu-live2d[data-cuu-live2d-motion=look]{--wh-cuu-live2d-head-animation:wh-cuu-live2d-head-look;--wh-cuu-live2d-head-duration:1800ms;--wh-cuu-live2d-eye-animation:wh-cuu-live2d-eye-look;--wh-cuu-live2d-eye-duration:1800ms}",
  ".wh-cuu-live2d[data-cuu-live2d-motion=blink]{--wh-cuu-live2d-eye-animation:wh-cuu-live2d-eye-blink-now;--wh-cuu-live2d-eye-duration:760ms}",
  ".wh-cuu-live2d[data-cuu-live2d-motion=celebrate]{--wh-cuu-live2d-root-animation:wh-cuu-live2d-root-celebrate;--wh-cuu-live2d-root-duration:960ms;--wh-cuu-live2d-bow-animation:wh-cuu-live2d-bow-pop;--wh-cuu-live2d-bow-duration:620ms;--wh-cuu-live2d-paw-animation:wh-cuu-live2d-paw-tap;--wh-cuu-live2d-paw-duration:620ms}",
  ".wh-cuu-live2d[data-cuu-live2d-motion=drag]{--wh-cuu-live2d-root-animation:wh-cuu-live2d-root-drag;--wh-cuu-live2d-root-duration:1300ms;--wh-cuu-live2d-tail-animation:wh-cuu-live2d-tail-drag;--wh-cuu-live2d-tail-duration:1300ms}",
  ".wh-cuu-live2d[data-cuu-live2d-motion=offline]{--wh-cuu-live2d-root-animation:wh-cuu-live2d-root-offline;--wh-cuu-live2d-root-duration:3200ms;--wh-cuu-live2d-head-animation:wh-cuu-live2d-head-offline;--wh-cuu-live2d-head-duration:3200ms;--wh-cuu-live2d-eye-animation:wh-cuu-live2d-eye-sleep;--wh-cuu-live2d-eye-duration:3200ms}",
  "@keyframes wh-cuu-live2d-root-idle{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-2px) scale(1.012)}}",
  "@keyframes wh-cuu-live2d-root-hop{0%,100%{transform:translateY(0) scale(1)}38%{transform:translateY(-7px) scale(1.025)}72%{transform:translateY(1px) scale(.995)}}",
  "@keyframes wh-cuu-live2d-root-worried{0%,100%{transform:translateX(0) translateY(0)}30%{transform:translateX(-1.5px) translateY(-1px)}62%{transform:translateX(1.5px) translateY(-1px)}}",
  "@keyframes wh-cuu-live2d-root-celebrate{0%,100%{transform:translateY(0) rotate(0deg)}42%{transform:translateY(-10px) rotate(-2deg)}68%{transform:translateY(-2px) rotate(2deg)}}",
  "@keyframes wh-cuu-live2d-root-drag{0%,100%{transform:rotate(-1deg)}50%{transform:rotate(2deg)}}",
  "@keyframes wh-cuu-live2d-root-offline{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(2px) scale(.99)}}",
  "@keyframes wh-cuu-live2d-tail-idle{0%,100%{transform:rotate(-5deg)}50%{transform:rotate(8deg) translateY(-1px)}}",
  "@keyframes wh-cuu-live2d-tail-thinking{0%,100%{transform:rotate(-10deg)}35%{transform:rotate(13deg)}70%{transform:rotate(-3deg)}}",
  "@keyframes wh-cuu-live2d-tail-tuck{0%,100%{transform:rotate(-16deg) translateX(-2px)}50%{transform:rotate(-8deg) translateX(-1px)}}",
  "@keyframes wh-cuu-live2d-tail-drag{0%,100%{transform:rotate(14deg)}50%{transform:rotate(-12deg)}}",
  "@keyframes wh-cuu-live2d-head-idle{0%,100%{transform:rotate(0deg) translateY(0)}45%{transform:rotate(-1.5deg) translateY(-1px)}72%{transform:rotate(1deg) translateY(0)}}",
  "@keyframes wh-cuu-live2d-head-thinking{0%,100%{transform:rotate(-2deg)}50%{transform:rotate(4deg) translateY(-1px)}}",
  "@keyframes wh-cuu-live2d-head-worried{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(1.5deg) translateY(1px)}}",
  "@keyframes wh-cuu-live2d-head-look{0%,100%{transform:translateX(0) rotate(0deg)}45%{transform:translateX(4px) rotate(2deg)}75%{transform:translateX(-2px) rotate(-1deg)}}",
  "@keyframes wh-cuu-live2d-head-offline{0%,100%{transform:rotate(0deg) translateY(0)}50%{transform:rotate(-2deg) translateY(2px)}}",
  "@keyframes wh-cuu-live2d-bib-idle{0%,100%{transform:rotate(0deg)}50%{transform:rotate(-1.3deg)}}",
  "@keyframes wh-cuu-live2d-bow-idle{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-1px) scale(1.015)}}",
  "@keyframes wh-cuu-live2d-bow-pop{0%,100%{transform:translateY(0) scale(1)}36%{transform:translateY(-4px) scale(1.08)}68%{transform:translateY(1px) scale(.98)}}",
  "@keyframes wh-cuu-live2d-tassel-l-idle{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(5deg)}}",
  "@keyframes wh-cuu-live2d-tassel-r-idle{0%,100%{transform:rotate(4deg)}50%{transform:rotate(-5deg)}}",
  "@keyframes wh-cuu-live2d-paw-idle{0%,100%{transform:translateY(0)}54%{transform:translateY(-.8px)}}",
  "@keyframes wh-cuu-live2d-paw-tap{0%,100%{transform:translateY(0)}34%{transform:translateY(-5px)}58%{transform:translateY(1px)}}",
  "@keyframes wh-cuu-live2d-eye-idle{0%,88%,95%,100%{opacity:0;transform:rotate(var(--wh-cuu-eye-rotate)) scaleY(.1)}90%,93%{opacity:.96;transform:rotate(var(--wh-cuu-eye-rotate)) scaleY(1)}}",
  "@keyframes wh-cuu-live2d-eye-blink-now{0%,28%,100%{opacity:0;transform:rotate(var(--wh-cuu-eye-rotate)) scaleY(.1)}42%,60%{opacity:.96;transform:rotate(var(--wh-cuu-eye-rotate)) scaleY(1)}}",
  "@keyframes wh-cuu-live2d-eye-look{0%,100%{opacity:0;transform:translateX(0) rotate(var(--wh-cuu-eye-rotate)) scaleY(.1)}48%{opacity:.18;transform:translateX(2px) rotate(var(--wh-cuu-eye-rotate)) scaleY(.2)}}",
  "@keyframes wh-cuu-live2d-eye-sleep{0%,100%{opacity:.82;transform:rotate(var(--wh-cuu-eye-rotate)) scaleY(.85)}50%{opacity:.9;transform:rotate(var(--wh-cuu-eye-rotate)) scaleY(1)}}",
  "@media (prefers-reduced-motion: reduce){.wh-cuu-live2d,.wh-cuu-live2d-layer,.wh-cuu-live2d-eye{animation:none!important}.wh-cuu-live2d-eye{opacity:0!important}}"
].join("");

export function renderDesktopCuuLive2DPrototypeForMotion(
  motion: CuuMotionHint,
  options: DesktopCuuLive2DRenderOptions = {}
): DesktopCuuLive2DRender {
  return renderDesktopCuuLive2DPrototype(cuuLive2DMotionForSpriteState(motion.sprite_state), options);
}

export function renderDesktopCuuLive2DPrototypeForState(
  state: CuuSpriteAtlasClipState,
  options: DesktopCuuLive2DRenderOptions = {}
): DesktopCuuLive2DRender {
  return renderDesktopCuuLive2DPrototype(cuuLive2DMotionForSpriteState(state), options);
}

export function renderDesktopCuuLive2DPrototype(
  motionId: CuuLive2DMotionId,
  options: DesktopCuuLive2DRenderOptions = {}
): DesktopCuuLive2DRender {
  const manifest = options.manifest ?? desktopCuuLive2DPrototypeManifest;
  const issues = validateDesktopCuuLive2DPrototypeManifest();
  if (issues.length > 0) {
    throw new Error(`Cuu Live2D prototype manifest failed validation: ${issues.map((issue) => issue.code).join(", ")}`);
  }
  const layerImages = options.layer_images ?? desktopCuuLive2DPrototypeLayerImages;
  const motion = manifest.motions[motionId];
  const displayWidth = options.display_width_px ?? 148;
  const scale = displayWidth / manifest.stage.width;
  const displayHeight = Math.round(manifest.stage.height * scale);
  const style = [
    `--wh-cuu-live2d-w:${displayWidth}px`,
    `--wh-cuu-live2d-h:${displayHeight}px`,
    `--wh-cuu-live2d-anchor-x:${Math.round(manifest.stage.anchor_x * scale)}px`,
    `--wh-cuu-live2d-anchor-y:${Math.round(manifest.stage.anchor_y * scale)}px`
  ].join(";");
  const layers = manifest.layers
    .slice()
    .sort((left, right) => left.z_index - right.z_index)
    .map((layer) => renderLayer(layer, scale, layerImages[layer.id]))
    .join("");
  const eyes = [
    renderEye("l", 146, 124, -7, scale),
    renderEye("r", 198, 128, 7, scale)
  ].join("");

  return {
    manifest,
    runtime_kind: "prototype_layered",
    status: manifest.status,
    motion,
    motion_id: motion.id,
    fallback_sprite_clip: motion.fallback_sprite_clip,
    layer_count: manifest.layers.length,
    duration_ms: durationForMotion(motion.id),
    css: desktopCuuLive2DBaseCss,
    html: `<div class="wh-cuu-live2d" data-cuu-live2d-runtime="prototype_layered" data-cuu-live2d-status="${escapeHtml(manifest.status)}" data-cuu-live2d-artifact="${escapeHtml(manifest.artifact)}" data-cuu-live2d-motion="${escapeHtml(motion.id)}" data-cuu-live2d-fallback-sprite="${escapeHtml(motion.fallback_sprite_clip)}" data-cuu-live2d-layer-count="${manifest.layers.length}" data-cuu-live2d-manifest-url="${escapeHtml(documentRelativeAssetPath(options.manifest_url ?? desktopCuuLive2DPrototypeManifestUrl))}" data-loop="${motion.loop ? "true" : "false"}" aria-label="${escapeHtml(labelForMotion(motion.id))}" style="${escapeHtml(style)}">${layers}${eyes}</div>`
  };
}

function renderLayer(
  layer: CuuLive2DManifest["layers"][number],
  scale: number,
  image: DesktopCuuLive2DLayerImage
) {
  const style = [
    `--wh-cuu-layer-x:${Math.round(layer.x * scale)}px`,
    `--wh-cuu-layer-y:${Math.round(layer.y * scale)}px`,
    `--wh-cuu-layer-w:${Math.round(layer.width * scale)}px`,
    `--wh-cuu-layer-h:${Math.round(layer.height * scale)}px`,
    `--wh-cuu-layer-pivot-x:${Math.round(layer.pivot_x * scale)}px`,
    `--wh-cuu-layer-pivot-y:${Math.round(layer.pivot_y * scale)}px`,
    `--wh-cuu-layer-z:${layer.z_index}`
  ].join(";");
  return `<img class="wh-cuu-live2d-layer" src="${escapeHtml(documentRelativeAssetPath(image.image_path))}" alt="" aria-hidden="true" draggable="false" data-live2d-layer="${escapeHtml(layer.id)}" data-live2d-bone="${escapeHtml(layer.bone)}" data-source-layer="${escapeHtml(layer.source_layer)}" style="${escapeHtml(style)}">`;
}

function renderEye(side: "l" | "r", x: number, y: number, rotation: number, scale: number) {
  const width = 18;
  const height = 6;
  const style = [
    `--wh-cuu-eye-x:${Math.round(x * scale)}px`,
    `--wh-cuu-eye-y:${Math.round(y * scale)}px`,
    `--wh-cuu-eye-w:${Math.round(width * scale)}px`,
    `--wh-cuu-eye-h:${Math.max(2, Math.round(height * scale))}px`,
    `--wh-cuu-eye-rotate:${rotation}deg`
  ].join(";");
  return `<span class="wh-cuu-live2d-eye" data-live2d-eye="${side}" aria-hidden="true" style="${escapeHtml(style)}"></span>`;
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
    tap: 860,
    offline: 3200
  };
  return durations[motion];
}

function labelForMotion(motion: CuuLive2DMotionId) {
  const labels: Record<CuuLive2DMotionId, string> = {
    idle: "Cuu 在桌面右下角轻轻呼吸、摆尾和眨眼。",
    blink: "Cuu 眨了眨眼。",
    look: "Cuu 看向鼠标。",
    thinking: "Cuu 正在思考。",
    approval: "Cuu 等你点选审批。",
    review: "Cuu 正在检查证据。",
    worried: "Cuu 遇到问题，正在提醒你。",
    celebrate: "Cuu 很开心地跳了一下。",
    drag: "Cuu 正被拖动。",
    tap: "Cuu 回应你的点击。",
    offline: "Cuu 正在困困地等待重连。"
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
