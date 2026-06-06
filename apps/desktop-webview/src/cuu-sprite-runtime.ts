import {
  cuuSpriteClipForMotion,
  defaultCuuSpriteManifest,
  type CuuMotionHint,
  type CuuSpriteClip,
  type CuuSpriteFrame,
  type CuuSpriteManifest
} from "@workhub/cuu";

export type DesktopCuuSpriteRender = {
  html: string;
  css: string;
  clip: CuuSpriteClip;
};

export const desktopCuuSpriteCss = [
  ".wh-cuu-sprite{--wh-cuu-duration:1200ms;position:relative;width:86px;height:92px;display:grid;place-items:end center;isolation:isolate;flex:0 0 auto}",
  ".wh-cuu-sprite-stage{position:relative;width:76px;height:82px;transform-origin:50% 100%;animation:wh-cuu-breathe var(--wh-cuu-duration) ease-in-out infinite}",
  ".wh-cuu-sprite[data-loop=false] .wh-cuu-sprite-stage{animation-iteration-count:1}",
  ".wh-cuu-sprite[data-emphasis=urgent] .wh-cuu-sprite-stage{animation-name:wh-cuu-bounce}",
  ".wh-cuu-sprite[data-emphasis=busy] .wh-cuu-sprite-stage{animation-name:wh-cuu-busy}",
  ".wh-cuu-sprite[data-emphasis=celebratory] .wh-cuu-sprite-stage{animation-name:wh-cuu-jump}",
  ".wh-cuu-tail{position:absolute;right:2px;bottom:20px;width:30px;height:44px;border:8px solid #d97b31;border-left-color:transparent;border-bottom-color:transparent;border-radius:50%;transform:rotate(18deg);opacity:.92}",
  ".wh-cuu-body{position:absolute;left:15px;bottom:4px;width:48px;height:52px;border-radius:48% 48% 44% 44%;background:linear-gradient(135deg,#f7b15e,#d98235 58%,#c96f2b);box-shadow:inset 8px -7px 0 rgba(116,63,25,.1),0 10px 22px rgba(42,31,22,.16)}",
  ".wh-cuu-bib{position:absolute;left:22px;bottom:23px;width:34px;height:24px;border-radius:50% 50% 44% 44%;background:rgba(255,255,255,.88);border:1px solid rgba(237,226,212,.9);box-shadow:0 2px 8px rgba(255,255,255,.6)}",
  ".wh-cuu-head{position:absolute;left:13px;top:3px;width:52px;height:48px;border-radius:48% 48% 45% 45%;background:linear-gradient(145deg,#ffc477,#e98b3d 64%,#cf7430);box-shadow:inset 7px -5px 0 rgba(117,61,24,.1),0 7px 18px rgba(45,32,20,.14)}",
  ".wh-cuu-ear{position:absolute;top:-10px;width:18px;height:22px;background:#ea9145;clip-path:polygon(50% 0,100% 100%,0 100%);border-radius:6px}",
  ".wh-cuu-ear.left{left:5px;transform:rotate(-16deg)}",
  ".wh-cuu-ear.right{right:5px;transform:rotate(16deg)}",
  ".wh-cuu-eye{position:absolute;top:18px;width:8px;height:11px;border-radius:50%;background:#2a2118;box-shadow:1px 1px 0 rgba(255,255,255,.7) inset}",
  ".wh-cuu-eye.left{left:15px}.wh-cuu-eye.right{right:15px}",
  ".wh-cuu-muzzle{position:absolute;left:18px;top:29px;width:16px;height:10px;border-radius:50%;background:rgba(255,232,199,.82)}",
  ".wh-cuu-bow{position:absolute;left:25px;top:44px;width:26px;height:13px}",
  ".wh-cuu-bow:before,.wh-cuu-bow:after{content:\"\";position:absolute;top:1px;width:11px;height:10px;background:#1f2633;border-radius:50% 8px 50% 8px}",
  ".wh-cuu-bow:before{left:0;transform:rotate(18deg)}.wh-cuu-bow:after{right:0;transform:scaleX(-1) rotate(18deg)}",
  ".wh-cuu-bow span{position:absolute;left:11px;top:3px;width:5px;height:6px;border-radius:50%;background:#323846}",
  ".wh-cuu-prop{position:absolute;right:-4px;bottom:28px;min-width:22px;min-height:22px;display:grid;place-items:center;border-radius:8px;background:#fff;border:1px solid rgba(31,38,51,.15);box-shadow:0 5px 14px rgba(31,38,51,.14);font-size:16px}",
  ".wh-cuu-prop[data-prop=none]{display:none}",
  ".wh-cuu-sprite[data-pose=think] .wh-cuu-prop{right:0;top:-2px;bottom:auto;border-radius:999px}",
  ".wh-cuu-sprite[data-pose=worried] .wh-cuu-ear{transform:rotate(0deg) translateY(4px)}",
  ".wh-cuu-sprite[data-pose=sleep] .wh-cuu-eye{height:2px;top:23px;border-radius:999px}",
  ".wh-cuu-sprite[data-pose=sleep] .wh-cuu-stage-shadow{opacity:.08}",
  ".wh-cuu-stage-shadow{position:absolute;left:12px;right:12px;bottom:0;height:10px;border-radius:50%;background:rgba(40,30,20,.16);filter:blur(1px);z-index:-1}",
  "@keyframes wh-cuu-breathe{0%,100%{transform:var(--wh-cuu-frame-transform) translateY(0) scale(1)}50%{transform:var(--wh-cuu-frame-transform) translateY(-2px) scale(1.01)}}",
  "@keyframes wh-cuu-busy{0%,100%{transform:var(--wh-cuu-frame-transform) rotate(-1deg) translateY(0)}50%{transform:var(--wh-cuu-frame-transform) rotate(2deg) translateY(-4px)}}",
  "@keyframes wh-cuu-bounce{0%,100%{transform:var(--wh-cuu-frame-transform) translateY(0) scale(1)}45%{transform:var(--wh-cuu-frame-transform) translateY(-8px) scale(1.035)}}",
  "@keyframes wh-cuu-jump{0%,100%{transform:var(--wh-cuu-frame-transform) translateY(0) scale(1)}40%{transform:var(--wh-cuu-frame-transform) translateY(-13px) scale(1.05)}}",
  "@media (prefers-reduced-motion: reduce){.wh-cuu-sprite-stage{animation:none!important}}"
].join("");

export function renderDesktopCuuSprite(
  motion: CuuMotionHint,
  manifest: CuuSpriteManifest = defaultCuuSpriteManifest
): DesktopCuuSpriteRender {
  const clip = cuuSpriteClipForMotion(motion, manifest);
  const frame = reducedMotionFrame(clip);
  const durationMs = clip.frames.reduce((total, item) => total + item.duration_ms, 0);
  const prop = frame.prop ?? propForPose(frame.pose);
  const transform = [
    frame.translate_y_px ? `translateY(${frame.translate_y_px}px)` : "",
    frame.rotate_deg ? `rotate(${frame.rotate_deg}deg)` : "",
    frame.scale ? `scale(${frame.scale})` : ""
  ]
    .filter(Boolean)
    .join(" ");
  const style = `--wh-cuu-duration:${Math.max(durationMs, 1)}ms;--wh-cuu-frame-transform:${transform || "translateY(0)"}`;

  return {
    clip,
    css: desktopCuuSpriteCss,
    html: `<div class="wh-cuu-sprite" data-cuu-sprite-state="${escapeHtml(clip.state)}" data-pose="${escapeHtml(frame.pose)}" data-emphasis="${escapeHtml(motion.emphasis)}" data-loop="${clip.loop ? "true" : "false"}" aria-label="${escapeHtml(motion.reduced_motion_fallback)}" style="${escapeHtml(style)}">
      <div class="wh-cuu-sprite-stage" data-frame-id="${escapeHtml(frame.id)}">
        <span class="wh-cuu-stage-shadow" aria-hidden="true"></span>
        <span class="wh-cuu-tail" aria-hidden="true"></span>
        <span class="wh-cuu-body" aria-hidden="true"></span>
        <span class="wh-cuu-bib" aria-hidden="true"></span>
        <span class="wh-cuu-head" aria-hidden="true">
          <span class="wh-cuu-ear left" aria-hidden="true"></span>
          <span class="wh-cuu-ear right" aria-hidden="true"></span>
          <span class="wh-cuu-eye left" aria-hidden="true"></span>
          <span class="wh-cuu-eye right" aria-hidden="true"></span>
          <span class="wh-cuu-muzzle" aria-hidden="true"></span>
        </span>
        <span class="wh-cuu-bow" aria-hidden="true"><span></span></span>
        <span class="wh-cuu-prop" data-prop="${escapeHtml(prop)}" aria-hidden="true">${escapeHtml(propGlyph(prop))}</span>
      </div>
    </div>`
  };
}

function reducedMotionFrame(clip: CuuSpriteClip): CuuSpriteFrame {
  return clip.frames.find((frame) => frame.id === clip.reduced_motion_frame_id) ?? clip.frames[0]!;
}

function propForPose(pose: CuuSpriteFrame["pose"]): NonNullable<CuuSpriteFrame["prop"]> {
  switch (pose) {
    case "carry":
      return "document";
    case "search":
      return "magnifier";
    case "sync":
      return "sync";
    case "worried":
      return "warning";
    default:
      return "none";
  }
}

function propGlyph(prop: NonNullable<CuuSpriteFrame["prop"]>) {
  switch (prop) {
    case "document":
      return "doc";
    case "magnifier":
      return "find";
    case "sync":
      return "sync";
    case "warning":
      return "!";
    case "none":
      return "";
  }
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}
