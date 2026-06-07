import type { CuuIdleMicroAction, CuuMotionHint, CuuSpriteAtlasClipState } from "@workhub/cuu";

export type DesktopCuuBongoRender = {
  html: string;
  css: string;
  runtime_kind: "bongo_cuu";
  status: "p1_default_low_uncanny";
  state: CuuSpriteAtlasClipState | CuuIdleMicroAction;
  motion_state: CuuSpriteAtlasClipState;
  component_count: number;
  duration_ms: number;
};

export type DesktopCuuBongoRenderOptions = {
  display_width_px?: number;
};

const componentCount = 31;

const desktopCuuBongoCss = [
  ".wh-cuu-bongo{position:relative;display:block;width:var(--wh-cuu-bongo-w);height:var(--wh-cuu-bongo-h);pointer-events:none;isolation:isolate;filter:drop-shadow(0 14px 16px rgba(35,27,20,.18));transform-origin:50% 88%}",
  ".wh-cuu-bongo *{box-sizing:border-box}",
  ".wh-cuu-bongo-shadow{position:absolute;left:16%;right:12%;bottom:2%;height:10%;border-radius:999px;background:rgba(51,39,29,.12)}",
  ".wh-cuu-bongo-tail{position:absolute;right:4%;bottom:28%;width:34%;height:29%;border:10px solid #d97d31;border-left:0;border-bottom:0;border-radius:0 70% 0 0;transform-origin:8% 88%;animation:wh-cuu-bongo-tail 2900ms ease-in-out infinite;z-index:1}",
  ".wh-cuu-bongo-body{position:absolute;left:24%;bottom:7%;width:55%;height:52%;border:3px solid #8f5227;border-radius:48% 50% 42% 44%;background:linear-gradient(150deg,#f6a047 0%,#df8235 62%,#ca6f28 100%);z-index:3}",
  ".wh-cuu-bongo-cream{position:absolute;left:26%;right:20%;bottom:0;width:54%;height:62%;border-radius:48% 52% 44% 42%;background:#ffe8c9}",
  ".wh-cuu-bongo-head{position:absolute;left:17%;top:8%;width:66%;height:47%;border:3px solid #8f5227;border-radius:48% 48% 42% 42%;background:linear-gradient(150deg,#f7a24a 0%,#e08434 68%,#d1742c 100%);z-index:6;animation:wh-cuu-bongo-head 4200ms ease-in-out infinite}",
  ".wh-cuu-bongo-ear{position:absolute;top:-15%;width:24%;height:32%;border:3px solid #8f5227;background:#e88436;border-radius:24% 76% 20% 76%;z-index:-1;transform-origin:50% 88%;animation:wh-cuu-bongo-ear 4200ms ease-in-out infinite}",
  ".wh-cuu-bongo-ear-l{left:8%;transform:rotate(-24deg)}",
  ".wh-cuu-bongo-ear-r{right:8%;transform:scaleX(-1) rotate(-24deg);animation-name:wh-cuu-bongo-ear-r}",
  ".wh-cuu-bongo-ear::after{content:\"\";position:absolute;left:28%;top:25%;width:46%;height:52%;border-radius:50%;background:#ffd0be}",
  ".wh-cuu-bongo-stripe{position:absolute;top:7%;width:4%;height:18%;border-radius:999px;background:#b96528;opacity:.72}",
  ".wh-cuu-bongo-stripe-a{left:43%;transform:rotate(-13deg)}",
  ".wh-cuu-bongo-stripe-b{left:50%;height:21%}",
  ".wh-cuu-bongo-stripe-c{left:57%;transform:rotate(13deg)}",
  ".wh-cuu-bongo-face-cream{position:absolute;left:24%;top:45%;width:52%;height:35%;border-radius:44% 44% 48% 48%;background:#ffe8c9}",
  ".wh-cuu-bongo-eye{position:absolute;top:35%;width:13%;height:16%;border:3px solid #33251c;border-radius:50%;background:#314935;overflow:hidden;animation:wh-cuu-bongo-eye-open 5200ms ease-in-out infinite}",
  ".wh-cuu-bongo-eye-l{left:30%}",
  ".wh-cuu-bongo-eye-r{right:30%}",
  ".wh-cuu-bongo-eye::after{content:\"\";position:absolute;left:21%;top:17%;width:28%;height:28%;border-radius:50%;background:#fff}",
  ".wh-cuu-bongo-nose{position:absolute;left:47%;top:55%;width:7%;height:6%;border-radius:50% 50% 62% 62%;background:#8d4a54}",
  ".wh-cuu-bongo-mouth{position:absolute;left:45%;top:63%;width:10%;height:7%;border-bottom:2px solid #5f3729;border-radius:0 0 999px 999px}",
  ".wh-cuu-bongo-whisker{position:absolute;top:60%;width:23%;height:2px;background:#8f5227;opacity:.72}",
  ".wh-cuu-bongo-whisker-l{left:8%;transform:rotate(8deg)}",
  ".wh-cuu-bongo-whisker-r{right:8%;transform:rotate(-8deg)}",
  ".wh-cuu-bongo-bib{position:absolute;left:29%;bottom:31%;width:42%;height:18%;border:2px solid rgba(143,82,39,.55);border-radius:0 0 46% 46%;background:radial-gradient(circle at 12% 100%,#fff 0 17%,transparent 18%),radial-gradient(circle at 31% 100%,#fff 0 17%,transparent 18%),radial-gradient(circle at 50% 100%,#fff 0 17%,transparent 18%),radial-gradient(circle at 69% 100%,#fff 0 17%,transparent 18%),radial-gradient(circle at 88% 100%,#fff 0 17%,transparent 18%),#fff8ef;z-index:8;animation:wh-cuu-bongo-bib 3000ms ease-in-out infinite}",
  ".wh-cuu-bongo-bow{position:absolute;left:42%;bottom:37%;width:16%;height:10%;z-index:9;animation:wh-cuu-bongo-bow 2800ms ease-in-out infinite}",
  ".wh-cuu-bongo-bow::before,.wh-cuu-bongo-bow::after{content:\"\";position:absolute;top:16%;width:44%;height:70%;border-radius:48% 18% 48% 18%;background:#23202a}",
  ".wh-cuu-bongo-bow::before{left:0;transform:rotate(12deg)}",
  ".wh-cuu-bongo-bow::after{right:0;transform:scaleX(-1) rotate(12deg)}",
  ".wh-cuu-bongo-bow-knot{position:absolute;left:38%;top:25%;width:24%;height:50%;border-radius:50%;background:#34313b}",
  ".wh-cuu-bongo-desk{position:absolute;left:10%;right:8%;bottom:3%;height:21%;border:3px solid rgba(91,63,42,.26);border-radius:18px;background:linear-gradient(180deg,#fff7ec 0%,#f0ddc8 100%);z-index:7}",
  ".wh-cuu-bongo-doc{position:absolute;left:40%;bottom:16%;width:20%;height:17%;border:2px solid #b8a08c;border-radius:5px;background:linear-gradient(180deg,#fff 0%,#eef4ff 100%);box-shadow:0 2px 0 rgba(91,63,42,.12);z-index:12;opacity:0;transform:translateY(9px) rotate(-5deg)}",
  ".wh-cuu-bongo-doc::before,.wh-cuu-bongo-doc::after{content:\"\";position:absolute;left:18%;right:18%;height:2px;border-radius:999px;background:#9ab0df}",
  ".wh-cuu-bongo-doc::before{top:34%}",
  ".wh-cuu-bongo-doc::after{top:52%}",
  ".wh-cuu-bongo-paw{position:absolute;bottom:13%;width:21%;height:18%;border:3px solid #8f5227;border-radius:42% 42% 48% 48%;background:#ffe8c9;z-index:13;transform-origin:50% 92%;animation:wh-cuu-bongo-paw-idle 3600ms ease-in-out infinite}",
  ".wh-cuu-bongo-paw-l{left:25%}",
  ".wh-cuu-bongo-paw-r{right:25%;animation-delay:180ms}",
  ".wh-cuu-bongo-bead{position:absolute;width:5%;height:5%;border-radius:50%;background:#c84545;border:1px solid rgba(91,33,33,.28);z-index:10;animation:wh-cuu-bongo-bead 2400ms ease-in-out infinite}",
  ".wh-cuu-bongo-bead-l{left:29%;bottom:30%}",
  ".wh-cuu-bongo-bead-r{right:29%;bottom:30%;animation-delay:170ms}",
  ".wh-cuu-bongo-search-glass{position:absolute;left:58%;top:30%;width:18%;height:18%;border:3px solid #5c719d;border-radius:50%;z-index:16;opacity:0;transform:translateY(8px) rotate(-18deg)}",
  ".wh-cuu-bongo-search-glass::after{content:\"\";position:absolute;right:-28%;bottom:-20%;width:38%;height:3px;border-radius:999px;background:#5c719d;transform:rotate(45deg);transform-origin:left center}",
  ".wh-cuu-bongo-search-ray{position:absolute;left:62%;top:22%;width:10%;height:3px;border-radius:999px;background:#f2c94c;z-index:15;opacity:0;transform-origin:left center}",
  ".wh-cuu-bongo-search-ray-a{transform:rotate(-24deg)}",
  ".wh-cuu-bongo-search-ray-b{top:26%;transform:rotate(-6deg)}",
  ".wh-cuu-bongo-search-ray-c{top:30%;transform:rotate(18deg)}",
  ".wh-cuu-bongo-sync-ring{position:absolute;left:62%;top:19%;width:20%;height:20%;border:3px solid #65a77d;border-left-color:transparent;border-radius:50%;z-index:15;opacity:0}",
  ".wh-cuu-bongo-sync-ring::after{content:\"\";position:absolute;right:-6%;top:6%;width:0;height:0;border-left:7px solid #65a77d;border-top:5px solid transparent;border-bottom:5px solid transparent;transform:rotate(18deg)}",
  ".wh-cuu-bongo-spark{position:absolute;width:5%;height:5%;border-radius:50%;background:#f2c94c;box-shadow:0 0 0 3px rgba(242,201,76,.24);z-index:18;opacity:0}",
  ".wh-cuu-bongo-spark-l{left:18%;top:18%}",
  ".wh-cuu-bongo-spark-r{right:14%;top:24%;animation-delay:130ms}",
  ".wh-cuu-bongo[data-cuu-bongo-state=asking_approval_bounce] .wh-cuu-bongo-paw-l,.wh-cuu-bongo[data-cuu-bongo-state=tap_bubble] .wh-cuu-bongo-paw-l{animation:wh-cuu-bongo-paw-hit-l 720ms ease-in-out infinite}",
  ".wh-cuu-bongo[data-cuu-bongo-state=asking_approval_bounce] .wh-cuu-bongo-paw-r,.wh-cuu-bongo[data-cuu-bongo-state=tap_bubble] .wh-cuu-bongo-paw-r{animation:wh-cuu-bongo-paw-hit-r 720ms ease-in-out infinite}",
  ".wh-cuu-bongo[data-cuu-bongo-state=thinking_tail] .wh-cuu-bongo-tail,.wh-cuu-bongo[data-cuu-bongo-state=searching_evidence_peek] .wh-cuu-bongo-tail{animation:wh-cuu-bongo-tail-thinking 1450ms ease-in-out infinite}",
  ".wh-cuu-bongo[data-cuu-bongo-state=worried_ears] .wh-cuu-bongo-ear-l,.wh-cuu-bongo[data-cuu-bongo-state=offline_sleep] .wh-cuu-bongo-ear-l{animation:wh-cuu-bongo-ear-worried-l 1350ms ease-in-out infinite}",
  ".wh-cuu-bongo[data-cuu-bongo-state=worried_ears] .wh-cuu-bongo-ear-r,.wh-cuu-bongo[data-cuu-bongo-state=offline_sleep] .wh-cuu-bongo-ear-r{animation:wh-cuu-bongo-ear-worried-r 1350ms ease-in-out infinite}",
  ".wh-cuu-bongo[data-cuu-bongo-state=carrying_document_step] .wh-cuu-bongo-doc,.wh-cuu-bongo[data-cuu-bongo-state=asking_approval_bounce] .wh-cuu-bongo-doc{opacity:1;animation:wh-cuu-bongo-doc-pop 1200ms ease-in-out infinite}",
  ".wh-cuu-bongo[data-cuu-bongo-state=celebrating_jump]{animation:wh-cuu-bongo-celebrate 880ms ease-out infinite}",
  ".wh-cuu-bongo[data-cuu-bongo-state=celebrating_jump] .wh-cuu-bongo-spark{animation:wh-cuu-bongo-spark 880ms ease-out infinite}",
  ".wh-cuu-bongo[data-cuu-bongo-state=wave_hello] .wh-cuu-bongo-paw-r{z-index:17;animation:wh-cuu-bongo-wave 980ms ease-in-out infinite}",
  ".wh-cuu-bongo[data-cuu-bongo-state=wave_hello] .wh-cuu-bongo-head{animation:wh-cuu-bongo-head-wave 980ms ease-in-out infinite}",
  ".wh-cuu-bongo[data-cuu-bongo-state=wave_hello] .wh-cuu-bongo-tail{animation:wh-cuu-bongo-tail-wave 980ms ease-in-out infinite}",
  ".wh-cuu-bongo[data-cuu-bongo-state=carrying_document_step] .wh-cuu-bongo-doc{left:35%;bottom:19%;width:30%;height:22%;animation:wh-cuu-bongo-doc-carry 1180ms ease-in-out infinite}",
  ".wh-cuu-bongo[data-cuu-bongo-state=carrying_document_step] .wh-cuu-bongo-paw-l{animation:wh-cuu-bongo-paw-hold-l 1180ms ease-in-out infinite}",
  ".wh-cuu-bongo[data-cuu-bongo-state=carrying_document_step] .wh-cuu-bongo-paw-r{animation:wh-cuu-bongo-paw-hold-r 1180ms ease-in-out infinite}",
  ".wh-cuu-bongo[data-cuu-bongo-state=searching_evidence_peek] .wh-cuu-bongo-search-glass{opacity:1;animation:wh-cuu-bongo-search-peek 1450ms ease-in-out infinite}",
  ".wh-cuu-bongo[data-cuu-bongo-state=searching_evidence_peek] .wh-cuu-bongo-search-ray{animation:wh-cuu-bongo-search-ray 1450ms ease-in-out infinite}",
  ".wh-cuu-bongo[data-cuu-bongo-state=searching_evidence_peek] .wh-cuu-bongo-eye{animation:wh-cuu-bongo-search-eye 1450ms ease-in-out infinite}",
  ".wh-cuu-bongo[data-cuu-bongo-state=syncing_files_spin] .wh-cuu-bongo-sync-ring{opacity:1;animation:wh-cuu-bongo-sync-ring 920ms linear infinite}",
  ".wh-cuu-bongo[data-cuu-bongo-state=syncing_files_spin] .wh-cuu-bongo-tail{animation:wh-cuu-bongo-tail-thinking 920ms ease-in-out infinite}",
  ".wh-cuu-bongo[data-cuu-bongo-state=revision_requested_nod] .wh-cuu-bongo-head{animation:wh-cuu-bongo-revision-nod 760ms ease-in-out infinite}",
  ".wh-cuu-bongo[data-cuu-bongo-state=revision_requested_nod] .wh-cuu-bongo-doc{opacity:1;border-color:#d56b5f;animation:wh-cuu-bongo-doc-revise 980ms ease-in-out infinite}",
  ".wh-cuu-bongo[data-cuu-bongo-state=drag_hold] .wh-cuu-bongo-paw-l,.wh-cuu-bongo[data-cuu-bongo-state=drag_hold] .wh-cuu-bongo-paw-r{animation:wh-cuu-bongo-grip 760ms ease-in-out infinite}",
  ".wh-cuu-bongo[data-cuu-bongo-state=drag_hold] .wh-cuu-bongo-tail{animation:wh-cuu-bongo-tail-brace 760ms ease-in-out infinite}",
  ".wh-cuu-bongo[data-cuu-bongo-state=look_at_mouse] .wh-cuu-bongo-head{animation:wh-cuu-bongo-look-head 1600ms ease-in-out infinite}",
  ".wh-cuu-bongo[data-cuu-bongo-state=look_at_mouse] .wh-cuu-bongo-eye{animation:wh-cuu-bongo-look-eye 1600ms ease-in-out infinite}",
  ".wh-cuu-bongo[data-cuu-bongo-requested-state=wake_up]{animation:wh-cuu-bongo-wake 980ms ease-out infinite}",
  ".wh-cuu-bongo[data-cuu-bongo-requested-state=sleeping_curl] .wh-cuu-bongo-tail{animation:wh-cuu-bongo-sleep-tail 2600ms ease-in-out infinite}",
  ".wh-cuu-bongo[data-cuu-bongo-state=offline_sleep] .wh-cuu-bongo-eye{height:4%;top:42%;background:#33251c;animation:none}",
  ".wh-cuu-bongo[data-cuu-bongo-state=offline_sleep] .wh-cuu-bongo-mouth{width:13%;left:43%;border-bottom-color:#7d6654}",
  "@keyframes wh-cuu-bongo-tail{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(12deg) translateY(-2px)}}",
  "@keyframes wh-cuu-bongo-tail-thinking{0%,100%{transform:rotate(-10deg)}50%{transform:rotate(18deg) translateY(-3px)}}",
  "@keyframes wh-cuu-bongo-tail-wave{0%,100%{transform:rotate(-8deg)}50%{transform:rotate(23deg) translateY(-4px)}}",
  "@keyframes wh-cuu-bongo-tail-brace{0%,100%{transform:rotate(-18deg) translateY(2px)}50%{transform:rotate(-8deg) translateY(-1px)}}",
  "@keyframes wh-cuu-bongo-sleep-tail{0%,100%{transform:rotate(-20deg) translateY(3px)}50%{transform:rotate(-14deg) translateY(1px)}}",
  "@keyframes wh-cuu-bongo-head{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}",
  "@keyframes wh-cuu-bongo-head-wave{0%,100%{transform:translateY(0) rotate(0deg)}45%{transform:translateY(-4px) rotate(-4deg)}}",
  "@keyframes wh-cuu-bongo-look-head{0%,100%{transform:translateX(0) rotate(0deg)}50%{transform:translateX(5px) rotate(2deg)}}",
  "@keyframes wh-cuu-bongo-revision-nod{0%,100%{transform:translateY(0) rotate(0deg)}35%{transform:translateY(5px) rotate(2deg)}65%{transform:translateY(-2px) rotate(-1deg)}}",
  "@keyframes wh-cuu-bongo-ear{0%,100%{transform:rotate(-24deg)}50%{transform:rotate(-18deg) translateY(-1px)}}",
  "@keyframes wh-cuu-bongo-ear-r{0%,100%{transform:scaleX(-1) rotate(-24deg)}50%{transform:scaleX(-1) rotate(-18deg) translateY(-1px)}}",
  "@keyframes wh-cuu-bongo-ear-worried-l{0%,100%{transform:rotate(-42deg) translateY(4px)}50%{transform:rotate(-32deg) translateY(2px)}}",
  "@keyframes wh-cuu-bongo-ear-worried-r{0%,100%{transform:scaleX(-1) rotate(-42deg) translateY(4px)}50%{transform:scaleX(-1) rotate(-32deg) translateY(2px)}}",
  "@keyframes wh-cuu-bongo-eye-open{0%,88%,95%,100%{transform:scaleY(1)}90%,93%{transform:scaleY(.08)}}",
  "@keyframes wh-cuu-bongo-look-eye{0%,100%{transform:translateX(0) scaleY(1)}50%{transform:translateX(4px) scaleY(1)}}",
  "@keyframes wh-cuu-bongo-search-eye{0%,100%{transform:translateX(0) scaleY(1)}35%{transform:translateX(5px) scaleY(1)}70%{transform:translateX(-2px) scaleY(1)}}",
  "@keyframes wh-cuu-bongo-bib{0%,100%{transform:rotate(0deg)}50%{transform:rotate(-1.3deg)}}",
  "@keyframes wh-cuu-bongo-bow{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-1px) scale(1.04)}}",
  "@keyframes wh-cuu-bongo-bead{0%,100%{transform:translateY(0)}50%{transform:translateY(4px)}}",
  "@keyframes wh-cuu-bongo-paw-idle{0%,100%{transform:translateY(0)}50%{transform:translateY(-1px)}}",
  "@keyframes wh-cuu-bongo-paw-hit-l{0%,100%{transform:translateY(0) rotate(0deg)}42%{transform:translateY(-12px) rotate(-8deg)}70%{transform:translateY(1px)}}",
  "@keyframes wh-cuu-bongo-paw-hit-r{0%,100%{transform:translateY(0) rotate(0deg)}42%{transform:translateY(-12px) rotate(8deg)}70%{transform:translateY(1px)}}",
  "@keyframes wh-cuu-bongo-wave{0%,100%{transform:translate(0,0) rotate(0deg)}28%{transform:translate(18px,-56px) rotate(24deg)}50%{transform:translate(22px,-62px) rotate(-18deg)}72%{transform:translate(18px,-56px) rotate(22deg)}}",
  "@keyframes wh-cuu-bongo-paw-hold-l{0%,100%{transform:translate(2px,-8px) rotate(-10deg)}50%{transform:translate(-1px,-11px) rotate(-4deg)}}",
  "@keyframes wh-cuu-bongo-paw-hold-r{0%,100%{transform:translate(-2px,-8px) rotate(10deg)}50%{transform:translate(1px,-11px) rotate(4deg)}}",
  "@keyframes wh-cuu-bongo-grip{0%,100%{transform:translateY(3px) scaleY(.9)}50%{transform:translateY(0) scaleY(1)}}",
  "@keyframes wh-cuu-bongo-doc-pop{0%,100%{transform:translateY(5px) rotate(-5deg)}45%{transform:translateY(-7px) rotate(4deg)}}",
  "@keyframes wh-cuu-bongo-doc-carry{0%,100%{transform:translateY(-2px) rotate(-2deg)}50%{transform:translateY(-9px) rotate(3deg)}}",
  "@keyframes wh-cuu-bongo-doc-revise{0%,100%{transform:translateY(5px) rotate(-8deg)}50%{transform:translateY(-5px) rotate(7deg)}}",
  "@keyframes wh-cuu-bongo-search-peek{0%,100%{transform:translateY(8px) rotate(-18deg)}36%{transform:translateY(-6px) translateX(4px) rotate(-8deg)}72%{transform:translateY(-2px) translateX(-2px) rotate(-24deg)}}",
  "@keyframes wh-cuu-bongo-search-ray{0%,25%,100%{opacity:0;transform:scaleX(.2)}35%,70%{opacity:1;transform:scaleX(1)}}",
  "@keyframes wh-cuu-bongo-sync-ring{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}",
  "@keyframes wh-cuu-bongo-spark{0%,100%{opacity:0;transform:translateY(8px) scale(.4)}38%{opacity:1;transform:translateY(-7px) scale(1)}}",
  "@keyframes wh-cuu-bongo-celebrate{0%,100%{transform:translateY(0) rotate(0deg)}38%{transform:translateY(-13px) rotate(-3deg)}68%{transform:translateY(1px) rotate(2deg)}}",
  "@keyframes wh-cuu-bongo-wake{0%{transform:scale(.96) translateY(4px)}45%{transform:scale(1.04) translateY(-5px)}100%{transform:scale(1) translateY(0)}}",
  "@media (prefers-reduced-motion: reduce){.wh-cuu-bongo,.wh-cuu-bongo *{animation:none!important}}"
].join("");

export function renderDesktopCuuBongoForMotion(
  motion: CuuMotionHint,
  options: DesktopCuuBongoRenderOptions = {}
): DesktopCuuBongoRender {
  return renderDesktopCuuBongo(motion.sprite_state, motion.sprite_state, options);
}

export function renderDesktopCuuBongoForIdleAction(
  action: CuuIdleMicroAction,
  options: DesktopCuuBongoRenderOptions = {}
): DesktopCuuBongoRender {
  return renderDesktopCuuBongo(action, idleActionToMotionState(action), options);
}

function renderDesktopCuuBongo(
  state: CuuSpriteAtlasClipState | CuuIdleMicroAction,
  motionState: CuuSpriteAtlasClipState,
  options: DesktopCuuBongoRenderOptions
): DesktopCuuBongoRender {
  const displayWidth = options.display_width_px ?? 148;
  const displayHeight = Math.round(displayWidth * 1.16);
  const style = `--wh-cuu-bongo-w:${displayWidth}px;--wh-cuu-bongo-h:${displayHeight}px`;

  return {
    runtime_kind: "bongo_cuu",
    status: "p1_default_low_uncanny",
    state,
    motion_state: motionState,
    component_count: componentCount,
    duration_ms: durationForState(motionState),
    css: desktopCuuBongoCss,
    html: `<div class="wh-cuu-bongo" data-cuu-bongo-runtime="bongo_cuu" data-cuu-bongo-status="p1_default_low_uncanny" data-cuu-bongo-state="${escapeHtml(motionState)}" data-cuu-bongo-requested-state="${escapeHtml(state)}" data-cuu-bongo-component-count="${componentCount}" aria-label="${escapeHtml(labelForState(motionState))}" style="${escapeHtml(style)}">
      <span class="wh-cuu-bongo-shadow"></span>
      <span class="wh-cuu-bongo-tail"></span>
      <span class="wh-cuu-bongo-body"><span class="wh-cuu-bongo-cream"></span></span>
      <span class="wh-cuu-bongo-head">
        <span class="wh-cuu-bongo-ear wh-cuu-bongo-ear-l"></span>
        <span class="wh-cuu-bongo-ear wh-cuu-bongo-ear-r"></span>
        <span class="wh-cuu-bongo-stripe wh-cuu-bongo-stripe-a"></span>
        <span class="wh-cuu-bongo-stripe wh-cuu-bongo-stripe-b"></span>
        <span class="wh-cuu-bongo-stripe wh-cuu-bongo-stripe-c"></span>
        <span class="wh-cuu-bongo-face-cream"></span>
        <span class="wh-cuu-bongo-eye wh-cuu-bongo-eye-l"></span>
        <span class="wh-cuu-bongo-eye wh-cuu-bongo-eye-r"></span>
        <span class="wh-cuu-bongo-nose"></span>
        <span class="wh-cuu-bongo-mouth"></span>
        <span class="wh-cuu-bongo-whisker wh-cuu-bongo-whisker-l"></span>
        <span class="wh-cuu-bongo-whisker wh-cuu-bongo-whisker-r"></span>
      </span>
      <span class="wh-cuu-bongo-bib"></span>
      <span class="wh-cuu-bongo-bow"><span class="wh-cuu-bongo-bow-knot"></span></span>
      <span class="wh-cuu-bongo-bead wh-cuu-bongo-bead-l"></span>
      <span class="wh-cuu-bongo-bead wh-cuu-bongo-bead-r"></span>
      <span class="wh-cuu-bongo-search-glass"></span>
      <span class="wh-cuu-bongo-search-ray wh-cuu-bongo-search-ray-a"></span>
      <span class="wh-cuu-bongo-search-ray wh-cuu-bongo-search-ray-b"></span>
      <span class="wh-cuu-bongo-search-ray wh-cuu-bongo-search-ray-c"></span>
      <span class="wh-cuu-bongo-sync-ring"></span>
      <span class="wh-cuu-bongo-spark wh-cuu-bongo-spark-l"></span>
      <span class="wh-cuu-bongo-spark wh-cuu-bongo-spark-r"></span>
      <span class="wh-cuu-bongo-doc"></span>
      <span class="wh-cuu-bongo-desk"></span>
      <span class="wh-cuu-bongo-paw wh-cuu-bongo-paw-l"></span>
      <span class="wh-cuu-bongo-paw wh-cuu-bongo-paw-r"></span>
    </div>`
  };
}

function idleActionToMotionState(action: CuuIdleMicroAction): CuuSpriteAtlasClipState {
  const mapping: Partial<Record<CuuIdleMicroAction, CuuSpriteAtlasClipState>> = {
    idle_breathe: "idle_breathe",
    idle_blink: "idle_blink",
    idle_tail_sway: "idle_tail_sway",
    look_at_mouse: "look_at_mouse",
    sleeping_curl: "offline_sleep",
    wake_up: "idle_breathe",
    drag_hold: "drag_hold",
    tap_bubble: "tap_bubble",
    wave_hello: "wave_hello"
  };
  return mapping[action] ?? "idle_breathe";
}

function durationForState(state: CuuSpriteAtlasClipState) {
  if (state === "asking_approval_bounce" || state === "tap_bubble") {
    return 720;
  }
  if (state === "revision_requested_nod" || state === "drag_hold") {
    return 760;
  }
  if (state === "celebrating_jump") {
    return 880;
  }
  if (state === "syncing_files_spin") {
    return 920;
  }
  if (state === "wave_hello") {
    return 980;
  }
  if (state === "carrying_document_step") {
    return 1180;
  }
  if (state === "thinking_tail" || state === "searching_evidence_peek") {
    return 1450;
  }
  return 5200;
}

function labelForState(state: CuuSpriteAtlasClipState) {
  const labels: Partial<Record<CuuSpriteAtlasClipState, string>> = {
    idle_breathe: "Cuu is quietly waiting.",
    idle_blink: "Cuu is blinking.",
    idle_tail_sway: "Cuu is swaying its tail.",
    look_at_mouse: "Cuu is looking nearby.",
    asking_approval_bounce: "Cuu is tapping the desk for approval.",
    thinking_tail: "Cuu is thinking.",
    searching_evidence_peek: "Cuu is checking evidence.",
    carrying_document_step: "Cuu is holding a document.",
    syncing_files_spin: "Cuu is syncing files.",
    worried_ears: "Cuu is worried.",
    revision_requested_nod: "Cuu is ready to revise.",
    celebrating_jump: "Cuu is celebrating.",
    offline_sleep: "Cuu is waiting offline.",
    drag_hold: "Cuu is holding position.",
    tap_bubble: "Cuu is tapping.",
    wave_hello: "Cuu is waving hello."
  };
  return labels[state] ?? "Cuu desktop pet.";
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}
