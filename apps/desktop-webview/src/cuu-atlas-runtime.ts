import {
  cuuAtlasClipForMotion,
  type CuuMotionHint,
  type CuuSpriteAtlasClip,
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
};

export const desktopCuuAtlasBaseCss = [
  ".wh-cuu-atlas{position:relative;display:grid;place-items:end center;width:var(--wh-cuu-atlas-display-w);height:var(--wh-cuu-atlas-display-h);isolation:isolate;pointer-events:none;flex:0 0 auto}",
  ".wh-cuu-atlas-frame{width:var(--wh-cuu-atlas-frame-w);height:var(--wh-cuu-atlas-frame-h);background-image:var(--wh-cuu-atlas-image);background-repeat:no-repeat;background-size:var(--wh-cuu-atlas-bg-w) var(--wh-cuu-atlas-bg-h);background-position:var(--wh-cuu-atlas-first-bg-pos);animation:var(--wh-cuu-atlas-animation) var(--wh-cuu-atlas-duration) steps(1,end) infinite;filter:drop-shadow(0 14px 18px rgba(35,27,20,.18));transform-origin:var(--wh-cuu-atlas-anchor-x) var(--wh-cuu-atlas-anchor-y)}",
  ".wh-cuu-atlas[data-loop=false] .wh-cuu-atlas-frame{animation-iteration-count:1}",
  ".wh-cuu-atlas[data-fallback=true]{opacity:.96}",
  "@media (prefers-reduced-motion: reduce){.wh-cuu-atlas-frame{animation:none!important;background-position:var(--wh-cuu-atlas-reduced-bg-pos)!important}}"
].join("");

export function renderDesktopCuuAtlasSprite(
  motion: CuuMotionHint,
  manifest: CuuSpriteAtlasManifest,
  options: DesktopCuuAtlasRenderOptions = {}
): DesktopCuuAtlasRender {
  const clip = cuuAtlasClipForMotion(motion, manifest);
  if (!clip) {
    throw new Error("Cuu atlas manifest must include a default clip.");
  }

  const firstFrame = clip.frames[0];
  if (!firstFrame) {
    throw new Error(`Cuu atlas clip ${clip.state} must include at least one frame.`);
  }

  const reducedFrame = clip.frames.find((frame) => frame.id === clip.reduced_motion_frame_id) ?? firstFrame;
  const displayWidth = options.display_width_px ?? 148;
  const scale = displayWidth / firstFrame.w;
  const displayHeight = Math.max(1, Math.round(firstFrame.h * scale));
  const durationMs = clip.frames.reduce((total, frame) => total + frame.duration_ms, 0);
  const keyframes = `wh-cuu-atlas-${clip.state}-${hashFrames(clip.frames)}`;
  const style = [
    `--wh-cuu-atlas-image:url("${cssString(manifest.atlas.image_path)}")`,
    `--wh-cuu-atlas-display-w:${displayWidth}px`,
    `--wh-cuu-atlas-display-h:${displayHeight}px`,
    `--wh-cuu-atlas-frame-w:${displayWidth}px`,
    `--wh-cuu-atlas-frame-h:${displayHeight}px`,
    `--wh-cuu-atlas-bg-w:${Math.round(manifest.atlas.width * scale)}px`,
    `--wh-cuu-atlas-bg-h:${Math.round(manifest.atlas.height * scale)}px`,
    `--wh-cuu-atlas-first-bg-pos:${backgroundPosition(firstFrame, scale)}`,
    `--wh-cuu-atlas-reduced-bg-pos:${backgroundPosition(reducedFrame, scale)}`,
    `--wh-cuu-atlas-duration:${Math.max(1, durationMs)}ms`,
    `--wh-cuu-atlas-animation:${keyframes}`,
    `--wh-cuu-atlas-anchor-x:${Math.round(clip.anchor.x * scale)}px`,
    `--wh-cuu-atlas-anchor-y:${Math.round(clip.anchor.y * scale)}px`
  ].join(";");
  const fallback = clip.state !== motion.sprite_state;

  return {
    clip,
    fallback,
    frame_count: clip.frames.length,
    duration_ms: durationMs,
    css: `${desktopCuuAtlasBaseCss}${buildAtlasKeyframes(keyframes, clip, scale)}`,
    html: `<div class="wh-cuu-atlas" data-cuu-atlas-state="${escapeHtml(clip.state)}" data-cuu-requested-state="${escapeHtml(motion.sprite_state)}" data-fallback="${fallback ? "true" : "false"}" data-loop="${clip.loop ? "true" : "false"}" data-frame-count="${clip.frames.length}" aria-label="${escapeHtml(motion.reduced_motion_fallback)}" style="${escapeHtml(style)}"><div class="wh-cuu-atlas-frame" data-frame-id="${escapeHtml(reducedFrame.id)}"></div></div>`
  };
}

function buildAtlasKeyframes(name: string, clip: CuuSpriteAtlasClip, scale: number) {
  const total = Math.max(1, clip.frames.reduce((sum, frame) => sum + frame.duration_ms, 0));
  let cursor = 0;
  const segments: string[] = [];
  for (const frame of clip.frames) {
    const start = cursor / total * 100;
    cursor += frame.duration_ms;
    const end = cursor / total * 100;
    const endClamp = Math.max(start, end - 0.001);
    segments.push(`${formatPercent(start)},${formatPercent(endClamp)}{background-position:${backgroundPosition(frame, scale)}}`);
  }
  const last = clip.frames.at(-1);
  if (last) {
    segments.push(`100%{background-position:${backgroundPosition(last, scale)}}`);
  }
  return `@keyframes ${name}{${segments.join("")}}`;
}

function backgroundPosition(frame: CuuSpriteAtlasFrame, scale: number) {
  return `${Math.round(-frame.x * scale)}px ${Math.round(-frame.y * scale)}px`;
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

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}
