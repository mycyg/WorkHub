import {
  cuuAtlasClipForMotion,
  type CuuMotionHint,
  type CuuSpriteAtlasClip,
  type CuuSpriteAtlasClipState,
  type CuuSpriteAtlasFrame,
  type CuuSpriteAtlasManifest
} from "@workhub/cuu";

export type DesktopCuuAtlasRender = {
  html: string;
  css: string;
  clip: CuuSpriteAtlasClip;
  fallback: boolean;
  frame_count: number;
  duration_ms: number;
};

export type DesktopCuuAtlasRenderOptions = {
  display_width_px?: number;
  clip_images?: Partial<Record<CuuSpriteAtlasClipState, DesktopCuuAtlasClipImage>>;
  fallback_image?: DesktopCuuAtlasFallbackImage;
  prefer_background_clip_sheet?: boolean;
};

export type DesktopCuuAtlasClipImage = {
  image_path: string;
  width: number;
  height: number;
  origin_x: number;
  origin_y: number;
};

export type DesktopCuuAtlasFallbackImage = {
  image_path: string;
  width: number;
  height: number;
};

export const desktopCuuAtlasBaseCss = [
  ".wh-cuu-atlas{position:relative;display:grid;place-items:end center;width:var(--wh-cuu-atlas-display-w);height:var(--wh-cuu-atlas-display-h);isolation:isolate;pointer-events:none;flex:0 0 auto}",
  ".wh-cuu-atlas-frame{position:relative;z-index:3;width:var(--wh-cuu-atlas-frame-w);height:var(--wh-cuu-atlas-frame-h);background-image:var(--wh-cuu-atlas-image);background-repeat:no-repeat;background-size:var(--wh-cuu-atlas-bg-w) var(--wh-cuu-atlas-bg-h);background-position:var(--wh-cuu-atlas-first-bg-pos);animation:var(--wh-cuu-atlas-animation) var(--wh-cuu-atlas-duration) steps(1,end) infinite;filter:drop-shadow(0 14px 18px rgba(35,27,20,.18));transform-origin:var(--wh-cuu-atlas-anchor-x) var(--wh-cuu-atlas-anchor-y)}",
  ".wh-cuu-atlas-static-fallback{position:absolute;right:0;bottom:0;z-index:2;display:block;width:var(--wh-cuu-fallback-w);height:var(--wh-cuu-fallback-h);filter:drop-shadow(0 14px 18px rgba(35,27,20,.18));animation:wh-cuu-static-breathe 2200ms ease-in-out infinite;transform-origin:50% 92%;pointer-events:none;user-select:none}",
  ".wh-cuu-atlas-img-stack{position:relative;z-index:3;width:var(--wh-cuu-atlas-frame-w);height:var(--wh-cuu-atlas-frame-h);overflow:hidden;filter:drop-shadow(0 14px 18px rgba(35,27,20,.18));transform-origin:var(--wh-cuu-atlas-anchor-x) var(--wh-cuu-atlas-anchor-y)}",
  ".wh-cuu-atlas-img-frame{position:absolute;display:block;max-width:none;width:var(--wh-cuu-atlas-bg-w);height:var(--wh-cuu-atlas-bg-h);left:var(--wh-cuu-frame-left);top:var(--wh-cuu-frame-top);opacity:0;animation:var(--wh-cuu-frame-animation) var(--wh-cuu-atlas-duration) steps(1,end) infinite;pointer-events:none;user-select:none}",
  ".wh-cuu-atlas-img-frame:not([data-loaded=true]){display:none}",
  ".wh-cuu-atlas[data-cuu-render-mode=img_stack]:not([data-frames-ready=true]) .wh-cuu-atlas-img-frame{animation:none!important}",
  ".wh-cuu-atlas[data-cuu-render-mode=img_stack][data-frames-ready=true] .wh-cuu-atlas-static-fallback{opacity:0;animation:none}",
  ".wh-cuu-atlas[data-loop=false] .wh-cuu-atlas-frame{animation-iteration-count:1;animation-fill-mode:both}",
  ".wh-cuu-atlas[data-loop=false] .wh-cuu-atlas-img-frame{animation-iteration-count:1;animation-fill-mode:both}",
  ".wh-cuu-atlas[data-fallback=true]{opacity:.96}",
  "@keyframes wh-cuu-static-breathe{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-3px) scale(1.018)}}",
  "@media (prefers-reduced-motion: reduce){.wh-cuu-atlas-frame{animation:none!important;background-position:var(--wh-cuu-atlas-reduced-bg-pos)!important}.wh-cuu-atlas-static-fallback{animation:none!important}.wh-cuu-atlas-img-frame{animation:none!important;opacity:0!important}.wh-cuu-atlas-img-frame[data-loaded=true][data-reduced=true]{opacity:1!important}}"
].join("");

export function renderDesktopCuuAtlasSprite(
  motion: CuuMotionHint,
  manifest: CuuSpriteAtlasManifest,
  options: DesktopCuuAtlasRenderOptions = {}
): DesktopCuuAtlasRender {
  return renderDesktopCuuAtlasClipState(motion.sprite_state, motion.reduced_motion_fallback, manifest, options, () =>
    cuuAtlasClipForMotion(motion, manifest)
  );
}

export function renderDesktopCuuAtlasState(
  state: CuuSpriteAtlasClipState,
  manifest: CuuSpriteAtlasManifest,
  options: DesktopCuuAtlasRenderOptions = {}
): DesktopCuuAtlasRender {
  return renderDesktopCuuAtlasClipState(state, cuuAtlasStateLabel(state), manifest, options);
}

function renderDesktopCuuAtlasClipState(
  state: CuuSpriteAtlasClipState,
  reducedMotionFallback: string,
  manifest: CuuSpriteAtlasManifest,
  options: DesktopCuuAtlasRenderOptions,
  resolveClip: () => CuuSpriteAtlasClip | undefined = () => manifest.clips[state] ?? manifest.clips[manifest.default_state]
): DesktopCuuAtlasRender {
  const clip = resolveClip();
  if (!clip) {
    throw new Error("Cuu atlas manifest must include a default clip.");
  }

  const firstFrame = clip.frames[0];
  if (!firstFrame) {
    throw new Error(`Cuu atlas clip ${clip.state} must include at least one frame.`);
  }

  const reducedFrame = clip.frames.find((frame) => frame.id === clip.reduced_motion_frame_id) ?? firstFrame;
  const clipImage = options.clip_images?.[clip.state];
  const imagePath = documentRelativeAssetPath(clipImage?.image_path ?? manifest.atlas.image_path);
  const fallbackImage = options.fallback_image;
  const fallbackImagePath = fallbackImage ? documentRelativeAssetPath(fallbackImage.image_path) : undefined;
  const displayWidth = options.display_width_px ?? 148;
  const scale = displayWidth / firstFrame.w;
  const displayHeight = Math.max(1, Math.round(firstFrame.h * scale));
  const fallbackScale = fallbackImage ? displayWidth / fallbackImage.width : 1;
  const durationMs = clip.frames.reduce((total, frame) => total + frame.duration_ms, 0);
  const keyframes = `wh-cuu-atlas-${clip.state}-${hashFrames(clip.frames)}`;
  const renderMode = clipImage && !options.prefer_background_clip_sheet ? "img_stack" : "background";
  const style = [
    `--wh-cuu-atlas-image:url("${cssString(imagePath)}")`,
    `--wh-cuu-atlas-display-w:${displayWidth}px`,
    `--wh-cuu-atlas-display-h:${displayHeight}px`,
    `--wh-cuu-atlas-frame-w:${displayWidth}px`,
    `--wh-cuu-atlas-frame-h:${displayHeight}px`,
    `--wh-cuu-atlas-bg-w:${Math.round((clipImage?.width ?? manifest.atlas.width) * scale)}px`,
    `--wh-cuu-atlas-bg-h:${Math.round((clipImage?.height ?? manifest.atlas.height) * scale)}px`,
    `--wh-cuu-atlas-first-bg-pos:${backgroundPosition(firstFrame, scale, clipImage)}`,
    `--wh-cuu-atlas-reduced-bg-pos:${backgroundPosition(reducedFrame, scale, clipImage)}`,
    `--wh-cuu-atlas-duration:${Math.max(1, durationMs)}ms`,
    `--wh-cuu-atlas-animation:${keyframes}`,
    `--wh-cuu-atlas-anchor-x:${Math.round(clip.anchor.x * scale)}px`,
    `--wh-cuu-atlas-anchor-y:${Math.round(clip.anchor.y * scale)}px`,
    `--wh-cuu-fallback-w:${Math.round((fallbackImage?.width ?? firstFrame.w) * fallbackScale)}px`,
    `--wh-cuu-fallback-h:${Math.round((fallbackImage?.height ?? firstFrame.h) * fallbackScale)}px`
  ].join(";");
  const fallback = clip.state !== state;

  return {
    clip,
    fallback,
    frame_count: clip.frames.length,
    duration_ms: durationMs,
    css: `${desktopCuuAtlasBaseCss}${renderMode === "img_stack" ? buildImageFrameKeyframes(keyframes, clip) : buildAtlasKeyframes(keyframes, clip, scale, clipImage)}`,
    html: `<div class="wh-cuu-atlas" data-cuu-atlas-state="${escapeHtml(clip.state)}" data-cuu-requested-state="${escapeHtml(state)}" data-fallback="${fallback ? "true" : "false"}" data-loop="${clip.loop ? "true" : "false"}" data-frame-count="${clip.frames.length}" data-cuu-image-mode="${clipImage ? "clip_sheet" : "atlas"}" data-cuu-render-mode="${renderMode}" data-cuu-static-fallback="${fallbackImagePath ? "true" : "false"}" aria-label="${escapeHtml(reducedMotionFallback)}" style="${escapeHtml(style)}">${fallbackImagePath ? `<img class="wh-cuu-atlas-static-fallback" src="${escapeHtml(fallbackImagePath)}" alt="" aria-hidden="true" draggable="false">` : ""}${renderMode === "img_stack" && clipImage ? renderImageFrameStack(keyframes, clip, reducedFrame, scale, clipImage, imagePath) : `<div class="wh-cuu-atlas-frame" data-frame-id="${escapeHtml(reducedFrame.id)}"></div>`}</div>`
  };
}

function cuuAtlasStateLabel(state: CuuSpriteAtlasClipState) {
  const labels: Partial<Record<CuuSpriteAtlasClipState, string>> = {
    idle_breathe: "Cuu 安静待命。",
    idle_blink: "Cuu 眨了眨眼。",
    idle_tail_sway: "Cuu 轻轻摆尾。",
    look_at_mouse: "Cuu 看向鼠标。",
    sleeping_curl: "Cuu 正在打盹。",
    wake_up: "Cuu 醒来了。",
    drag_hold: "Cuu 被轻轻拖动。",
    tap_bubble: "Cuu 回应了点击。",
    wave_hello: "Cuu 向你挥手。"
  };
  return labels[state] ?? "Cuu 正在工作。";
}

function buildAtlasKeyframes(
  name: string,
  clip: CuuSpriteAtlasClip,
  scale: number,
  clipImage: DesktopCuuAtlasClipImage | undefined
) {
  const total = Math.max(1, clip.frames.reduce((sum, frame) => sum + frame.duration_ms, 0));
  let cursor = 0;
  const segments: string[] = [];
  for (const frame of clip.frames) {
    const start = cursor / total * 100;
    cursor += frame.duration_ms;
    const end = cursor / total * 100;
    const endClamp = Math.max(start, end - 0.001);
    segments.push(`${formatPercent(start)},${formatPercent(endClamp)}{background-position:${backgroundPosition(frame, scale, clipImage)}}`);
  }
  const last = clip.frames.at(-1);
  if (last) {
    segments.push(`100%{background-position:${backgroundPosition(last, scale, clipImage)}}`);
  }
  return `@keyframes ${name}{${segments.join("")}}`;
}

function renderImageFrameStack(
  keyframes: string,
  clip: CuuSpriteAtlasClip,
  reducedFrame: CuuSpriteAtlasFrame,
  scale: number,
  clipImage: DesktopCuuAtlasClipImage,
  imagePath: string
) {
  const imageWidth = Math.round(clipImage.width * scale);
  const imageHeight = Math.round(clipImage.height * scale);
  return `<div class="wh-cuu-atlas-img-stack">${clip.frames.map((frame, index) => {
    const frameKeyframes = `${keyframes}-frame-${index}`;
    const frameStyle = [
      `--wh-cuu-frame-left:${Math.round(-(frame.x - clipImage.origin_x) * scale)}px`,
      `--wh-cuu-frame-top:${Math.round(-(frame.y - clipImage.origin_y) * scale)}px`,
      `--wh-cuu-atlas-bg-w:${imageWidth}px`,
      `--wh-cuu-atlas-bg-h:${imageHeight}px`,
      `--wh-cuu-frame-animation:${frameKeyframes}`
    ].join(";");
    return `<img class="wh-cuu-atlas-img-frame" src="${escapeHtml(imagePath)}" alt="" aria-hidden="true" draggable="false" data-frame-id="${escapeHtml(frame.id)}" data-reduced="${frame.id === reducedFrame.id ? "true" : "false"}" onload="this.dataset.loaded='true';var p=this.closest('.wh-cuu-atlas');if(p)p.dataset.framesReady='true'" onerror="this.dataset.failed='true'" style="${escapeHtml(frameStyle)}">`;
  }).join("")}</div>`;
}

function buildImageFrameKeyframes(name: string, clip: CuuSpriteAtlasClip) {
  const total = Math.max(1, clip.frames.reduce((sum, frame) => sum + frame.duration_ms, 0));
  let cursor = 0;
  const keyframes: string[] = [];
  for (const [index, frame] of clip.frames.entries()) {
    const start = cursor / total * 100;
    cursor += frame.duration_ms;
    const end = cursor / total * 100;
    const before = Math.max(0, start - 0.001);
    const after = Math.min(100, end + 0.001);
    const finalHold = !clip.loop && index === clip.frames.length - 1;
    const segments = [
      `0%,${formatPercent(before)}{opacity:0}`,
      `${formatPercent(start)},${formatPercent(end)}{opacity:1}`,
      finalHold ? `100%{opacity:1}` : `${formatPercent(after)},100%{opacity:0}`
    ];
    keyframes.push(`@keyframes ${name}-frame-${index}{${segments.join("")}}`);
  }
  return keyframes.join("");
}

function backgroundPosition(frame: CuuSpriteAtlasFrame, scale: number, clipImage: DesktopCuuAtlasClipImage | undefined) {
  const originX = clipImage?.origin_x ?? 0;
  const originY = clipImage?.origin_y ?? 0;
  return `${Math.round(-(frame.x - originX) * scale)}px ${Math.round(-(frame.y - originY) * scale)}px`;
}

function formatPercent(value: number) {
  return `${Number(value.toFixed(3))}%`;
}

function hashFrames(frames: CuuSpriteAtlasFrame[]) {
  const source = frames.map((frame) => `${frame.id}:${frame.x},${frame.y},${frame.w},${frame.h},${frame.duration_ms}`).join("|");
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function cssString(value: string) {
  return value.replace(/\\/gu, "/").replace(/"/gu, '\\"');
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
