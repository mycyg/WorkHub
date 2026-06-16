import { createApiClient } from "@workhub/api-client/client";
import {
  cardFromAgentRunLive,
  createCuuController,
  createCuuIdleScheduler,
  cuuBubbleKindForState,
  cuuEmotionForState,
  cuuFormat,
  cuuMotionForState,
  cuuT,
  type CuuBubbleKind,
  type CuuCard,
  type CuuEmotion,
  type CuuController,
  type CuuControllerPreferences,
  type CuuIdleMicroAction,
  type CuuIdleScheduler,
  type CuuIdleSchedulerPolicy,
  type CuuLocaleOptions,
  type CuuMotionHint
} from "@workhub/cuu";
import { normalizeWorkHubLocale, workHubLocaleStorageKey, type AgentRunLiveVM, type WorkHubLocale } from "@workhub/contracts";

import {
  renderDesktopCuuCatLive2DForIdleAction,
  renderDesktopCuuCatLive2DForMotion,
  resolveDesktopCuuCatLive2DBehaviorState,
  setDesktopCuuCatLive2DBehaviorState,
  type DesktopCuuCatLive2DRender
} from "./cuu-cat-live2d-runtime.js";
import { writeDesktopPetQaDomSnapshot } from "./cuu-qa-dom-report.js";
import { liquidGlassHeadHtml } from "./liquid-glass.js";
import {
  desktopPetSettingsPayloadFromPreferences,
  desktopPetSettingsPreferencesFromPayload,
  loadCuuPreferences,
  saveCuuPreferences,
  type DesktopPetSettingsPayload
} from "./cuu-preferences.js";
import {
  bindDesktopShellCuuRuntime,
  cardFromDesktopCuuRuntimeError,
  createDesktopCuuAgentLauncherCard,
  resolveDesktopCuuAction,
  resolveDesktopShellEmitter,
  resolveDesktopShellListen,
  subscribeDesktopCuuAgentRunStream,
  submitDesktopCuuAction,
  type DesktopCuuActionRequest,
  type DesktopCuuRunStreamStatus,
  type DesktopCuuRunStreamSubscription,
  type DesktopShellEmitter,
  type DesktopShellListen,
  type DesktopShellUnlisten
} from "./desktop-cuu-runtime.js";
import { createDesktopPetQaShellListenFromGlobal, desktopPetQaScenarioFromGlobal } from "./cuu-qa-scenarios.js";
import {
  createDesktopPetPointerSensor,
  desktopPetPointerSnapshotFromSample,
  desktopPetWindowModeForCard,
  desktopPetWindowSettingsFromPreferences,
  normalizeDesktopPetPointerSnapshot,
  resolveDesktopPetWindowBridge,
  type DesktopPetPointerSensor,
  type DesktopPetPointerSnapshot,
  type DesktopPetWindowBridge,
  type DesktopPetWindowMode,
  type DesktopPetWindowSettings
} from "./pet-window-bridge.js";

export type DesktopSurface = "main" | "pet";

export type DesktopPetSurfaceRender = {
  html: string;
  css: string;
  live2d: DesktopCuuCatLive2DRender;
  visual_mode: "live2d_cat";
};

export type DesktopPetSurfaceRuntime = {
  controller: CuuController;
  idleScheduler: CuuIdleScheduler;
  pointerSensor?: DesktopPetPointerSensor;
  subscribed: boolean;
  dispose: () => Promise<void>;
};

export type DesktopPetSurfaceClient = ReturnType<typeof createApiClient>;

export const desktopPetRunRestoreStorageKey = "workhub.cuu.currentRun.v1";

type DesktopPetRestoreState =
  | {
      version: 1;
      entity_type: "agent_run";
      entity_id: string;
      href?: string | undefined;
      updated_at_ms: number;
    }
  | {
      version: 1;
      entity_type: "session";
      entity_id: string;
      href?: string | undefined;
      card: CuuCard;
      updated_at_ms: number;
    };

export const desktopPetSurfaceCss = [
  "html,body,#root{margin:0;width:100%;height:100%;background:rgba(0,0,0,0)!important;overflow:hidden}",
  "*,*::before,*::after{box-sizing:border-box}",
  "body{font-family:\"Aptos\",\"Segoe UI\",\"Microsoft YaHei\",\"PingFang SC\",\"Noto Sans CJK SC\",sans-serif;color:#222b38;background:rgba(0,0,0,0)!important}",
  ".wh-pet-surface{position:relative;display:block;box-sizing:border-box;width:var(--wh-pet-window-w,260px);height:var(--wh-pet-window-h,340px);border:0;background:rgba(0,0,0,0)!important;box-shadow:none;pointer-events:none;overflow:hidden;opacity:var(--wh-pet-opacity,1)}",
  ".wh-pet-surface[data-pet-window-mode=card]{width:var(--wh-pet-window-w,520px);height:var(--wh-pet-window-h,720px)}",
  ".wh-pet-body{position:absolute;right:calc(4px * var(--wh-pet-scale,1));bottom:calc(4px * var(--wh-pet-scale,1));width:calc(240px * var(--wh-pet-scale,1));height:calc(320px * var(--wh-pet-scale,1));display:flex;align-items:flex-end;justify-content:center;border:0;background:rgba(0,0,0,0)!important;box-shadow:none;padding:0;margin:0;appearance:none;cursor:grab;pointer-events:auto;opacity:var(--wh-pet-hide-opacity,1);transform:translate(calc(var(--wh-pet-avoid-x-px,0px) + var(--wh-pet-hide-x-px,0px)),calc(var(--wh-pet-avoid-y-px,0px) + var(--wh-pet-hide-y-px,0px))) scale(var(--wh-pet-hide-scale,1));transition:transform 160ms ease-out,opacity 160ms ease-out}",
  ".wh-pet-body::after{content:\"\";position:absolute;inset:0;z-index:3;background:rgba(0,0,0,0);pointer-events:auto}",
  ".wh-pet-body:active{cursor:grabbing}",
  ".wh-pet-surface[data-pet-hovered=true] .wh-pet-body{cursor:pointer}",
  ".wh-pet-surface[data-pet-dragging=true] .wh-pet-body{cursor:grabbing}",
  ".wh-pet-surface[data-pet-hover-avoidance=soft]:not([data-pet-dragging=true]) .wh-pet-body{transition-duration:120ms}",
  ".wh-pet-surface[data-pet-hover-hidden=true] .wh-pet-body{transition-duration:140ms}",
  ".wh-pet-bubble{position:absolute;right:calc(254px * var(--wh-pet-scale,1));bottom:calc(36px * var(--wh-pet-scale,1));box-sizing:border-box;width:min(286px,calc(100vw - 254px));min-width:0;display:grid;grid-template-columns:minmax(0,1fr);gap:8px;font-family:'M PLUS Rounded 1c','Noto Sans SC',inherit;border:1px solid rgba(255,255,255,.7);border-radius:16px;background:rgba(255,255,255,.72);box-shadow:0 22px 50px -18px rgba(70,54,140,.45),inset 0 1px 0 rgba(255,255,255,.7);padding:11px 13px;pointer-events:auto;backdrop-filter:blur(30px) saturate(180%);-webkit-backdrop-filter:blur(30px) saturate(180%);overflow-wrap:anywhere;word-break:break-word}",
  ".wh-pet-surface[data-pet-window-mode=card] .wh-pet-body{right:calc(72px * var(--wh-pet-scale,1));bottom:calc(48px * var(--wh-pet-scale,1));width:calc(240px * var(--wh-pet-scale,1));height:calc(320px * var(--wh-pet-scale,1))}",
  ".wh-pet-surface[data-pet-window-mode=card] .wh-pet-bubble{left:calc(88px * var(--wh-pet-scale,1));right:auto;top:auto;bottom:calc(392px * var(--wh-pet-scale,1));width:calc(300px * var(--wh-pet-scale,1));max-width:calc(100% - calc(128px * var(--wh-pet-scale,1)));max-height:calc(268px * var(--wh-pet-scale,1));overflow:hidden;padding:12px 14px}",
  ".wh-pet-surface[data-pet-window-mode=card] .wh-pet-bubble[data-pet-bubble-kind=bubble],.wh-pet-surface[data-pet-window-mode=card] .wh-pet-bubble[data-pet-bubble-kind=offline],.wh-pet-surface[data-pet-window-mode=card] .wh-pet-bubble[data-pet-bubble-kind=trace]{min-height:calc(268px * var(--wh-pet-scale,1))}",
  ".wh-pet-surface[data-pet-window-mode=card][data-pet-card-has-context=true] .wh-pet-bubble{left:calc(88px * var(--wh-pet-scale,1));right:auto;bottom:calc(392px * var(--wh-pet-scale,1));width:calc(300px * var(--wh-pet-scale,1));max-width:calc(100% - calc(128px * var(--wh-pet-scale,1)));min-height:0;max-height:min(calc(320px * var(--wh-pet-scale,1)),calc(100% - calc(400px * var(--wh-pet-scale,1))));overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-gutter:stable;gap:6px;padding:10px 12px 12px}",
  ".wh-pet-surface[data-pet-window-mode=card] .wh-pet-title{overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}",
  ".wh-pet-surface[data-pet-window-mode=card] .wh-pet-message{overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden}",
  ".wh-pet-surface[data-pet-card-has-context=true] .wh-pet-title{-webkit-line-clamp:2;font-size:13px;line-height:1.28}",
  ".wh-pet-surface[data-pet-card-has-context=true] .wh-pet-message{-webkit-line-clamp:2;font-size:11px;line-height:1.35}",
  ".wh-pet-surface[data-pet-window-mode=card] .wh-pet-actions{max-width:100%}",
  ".wh-pet-surface[data-pet-card-layout=compact] .wh-pet-body{right:calc(4px * var(--wh-pet-scale,1));bottom:calc(4px * var(--wh-pet-scale,1));width:calc(156px * var(--wh-pet-scale,1));height:calc(218px * var(--wh-pet-scale,1))}",
  ".wh-pet-surface[data-pet-card-layout=compact] .wh-pet-bubble{left:auto;right:calc(8px * var(--wh-pet-scale,1));top:auto;bottom:calc(224px * var(--wh-pet-scale,1));width:calc(150px * var(--wh-pet-scale,1));max-height:calc(86px * var(--wh-pet-scale,1));overflow:hidden;gap:5px;padding:7px 8px}",
  ".wh-pet-surface[data-pet-card-layout=compact] .wh-pet-title{font-size:12px;line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}",
  ".wh-pet-surface[data-pet-card-layout=compact] .wh-pet-kicker,.wh-pet-surface[data-pet-card-layout=compact] .wh-pet-status{font-size:10px}",
  ".wh-pet-surface[data-pet-card-layout=compact] .wh-pet-status{line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}",
  ".wh-pet-surface[data-pet-card-layout=compact] .wh-pet-action{font-size:11px;padding:5px 7px;max-width:112px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  ".wh-pet-bubble>*{min-width:0;max-width:100%}",
  ".wh-pet-kicker{display:flex;align-items:center;gap:7px;color:#667085;font-size:11px;font-weight:800;min-width:0;max-width:100%;flex-wrap:wrap}",
  ".wh-pet-dot{width:8px;height:8px;border-radius:999px;background:#ff9d58;box-shadow:0 0 0 3px rgba(255,157,88,.18)}",
  ".wh-pet-emotion{max-width:100%;color:#475467;font-size:10px;line-height:1;font-weight:850;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  ".wh-pet-bubble[data-pet-bubble-tone=approval]{background:rgba(255,247,228,.74);border-color:rgba(245,199,117,.55)}",
  ".wh-pet-bubble[data-pet-bubble-tone=approval] .wh-pet-emotion{color:#a15c07}",
  ".wh-pet-bubble[data-pet-bubble-tone=approval] .wh-pet-dot{background:#e0892a;box-shadow:0 0 0 3px rgba(224,137,42,.18)}",
  ".wh-pet-bubble[data-pet-bubble-tone=chat]{background:rgba(255,255,255,.72);border-color:rgba(255,255,255,.7)}",
  ".wh-pet-bubble[data-pet-bubble-tone=search]{background:rgba(228,238,255,.74);border-color:rgba(124,131,255,.4)}",
  ".wh-pet-bubble[data-pet-bubble-tone=search] .wh-pet-emotion{color:#1f6fb2}",
  ".wh-pet-bubble[data-pet-bubble-tone=search] .wh-pet-dot{background:#4f46e5;box-shadow:0 0 0 3px rgba(79,70,229,.18)}",
  ".wh-pet-bubble[data-pet-bubble-emotion=celebrating] .wh-pet-emotion{color:#15a05a}",
  ".wh-pet-bubble[data-pet-bubble-emotion=worried] .wh-pet-emotion{color:#b42318}",
  ".wh-pet-kind,.wh-pet-priority{max-width:100%;border:1px solid rgba(38,49,70,.12);border-radius:8px;background:#fff;padding:3px 6px;color:#344054;font-size:10px;line-height:1;font-weight:850;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  ".wh-pet-priority[data-priority=urgent],.wh-pet-priority[data-priority=high]{background:#fff4f3;border-color:rgba(238,107,95,.28);color:#b42318}",
  ".wh-pet-title{min-width:0;max-width:100%;width:100%;font-size:14px;line-height:1.35;font-weight:850;overflow-wrap:anywhere;word-break:break-word;white-space:normal}",
  ".wh-pet-message{min-width:0;max-width:100%;width:100%;margin:0;color:#667085;font-size:12px;line-height:1.45;font-weight:650;overflow-wrap:anywhere;word-break:break-word;white-space:normal}",
  ".wh-pet-context{display:grid;grid-template-columns:minmax(0,1fr);gap:7px;min-width:0;max-width:100%;width:100%}",
  ".wh-pet-progress{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;margin:0;padding:0;list-style:none;min-width:0;max-width:100%;width:100%}",
  ".wh-pet-progress-step{display:grid;gap:3px;min-width:0;color:#98a2b3;font-size:9px;font-weight:850;line-height:1.15}",
  ".wh-pet-progress-dot{height:4px;border-radius:8px;background:rgba(152,162,179,.24)}",
  ".wh-pet-progress-step[data-state=done] .wh-pet-progress-dot,.wh-pet-progress-step[data-state=active] .wh-pet-progress-dot{background:#355cff}",
  ".wh-pet-progress-step[data-state=active]{color:#344054}",
  ".wh-pet-progress-label{min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".wh-pet-section{display:grid;grid-template-columns:minmax(0,1fr);gap:3px;border-top:1px solid rgba(38,49,70,.1);padding-top:7px;min-width:0;max-width:100%;width:100%}",
  ".wh-pet-section-title,.wh-pet-evidence-title,.wh-pet-input-hint{min-width:0;max-width:100%;width:100%;color:#344054;font-size:11px;font-weight:900;line-height:1.2;white-space:normal;overflow-wrap:anywhere;word-break:break-word}",
  ".wh-pet-section-line,.wh-pet-evidence-item{min-width:0;max-width:100%;width:100%;color:#667085;font-size:11px;font-weight:700;line-height:1.35;overflow-wrap:anywhere;word-break:break-word;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}",
  ".wh-pet-surface[data-pet-card-has-context=true] .wh-pet-section{gap:2px;padding-top:5px}",
  ".wh-pet-surface[data-pet-card-has-context=true] .wh-pet-section-line,.wh-pet-surface[data-pet-card-has-context=true] .wh-pet-evidence-item{-webkit-line-clamp:1}",
  ".wh-pet-evidence{display:grid;grid-template-columns:minmax(0,1fr);gap:3px;border-top:1px solid rgba(38,49,70,.1);padding-top:7px;min-width:0;max-width:100%;width:100%}",
  ".wh-pet-input-hint{border-top:1px solid rgba(38,49,70,.1);padding-top:7px;color:#667085}",
  ".wh-pet-chips,.wh-pet-actions,.wh-pet-reasons{display:flex;gap:6px;flex-wrap:wrap;align-items:flex-start;min-width:0;max-width:100%;width:100%}",
  ".wh-pet-chip,.wh-pet-action,.wh-pet-reason{box-sizing:border-box;min-width:0;max-width:100%;border:1px solid rgba(38,49,70,.14);border-radius:8px;background:#fff;padding:6px 8px;color:#222b38;font:800 12px/1.2 \"Aptos\",\"Segoe UI\",\"Microsoft YaHei\",\"PingFang SC\",\"Noto Sans CJK SC\",sans-serif;text-align:left;text-decoration:none;white-space:normal;overflow-wrap:anywhere;word-break:break-word;appearance:none}",
  ".wh-pet-chip[data-pet-option-first=true]{cursor:pointer;text-align:left}",
  ".wh-pet-chip[data-tone=success]{background:#f0faf6;border-color:rgba(22,163,74,.2);color:#067647}",
  ".wh-pet-chip[data-tone=warning]{background:#fff7ed;border-color:rgba(245,158,11,.26);color:#a15c07}",
  ".wh-pet-chip[data-tone=danger]{background:#fff4f3;border-color:rgba(238,107,95,.34);color:#b42318}",
  ".wh-pet-chip[data-recommended=true]{border-color:rgba(53,92,255,.35);box-shadow:inset 3px 0 0 #355cff}",
  ".wh-pet-chip[data-selected=true]{background:#eef4ff;border-color:#355cff;color:#2444bf}",
  ".wh-pet-action[data-tone=primary],.wh-pet-reason{background:#355cff;border-color:#355cff;color:#fff}",
  ".wh-pet-action[data-tone=danger]{background:#fff4f3;border-color:rgba(238,107,95,.34);color:#b42318}",
  ".wh-pet-status{min-width:0;max-width:100%;width:100%;margin:0;color:#344054;font-size:12px;line-height:1.45;font-weight:750;overflow-wrap:anywhere;word-break:break-word;white-space:normal}",
  ".wh-pet-menu{position:absolute;right:88px;bottom:72px;z-index:8;box-sizing:border-box;width:164px;display:grid;gap:8px;border:1px solid rgba(38,49,70,.16);border-radius:8px;background:rgba(255,255,255,.96);box-shadow:0 18px 44px rgba(30,39,58,.2);padding:10px;pointer-events:auto;backdrop-filter:blur(10px);overflow:hidden}",
  ".wh-pet-menu[hidden]{display:none}",
  ".wh-pet-menu-title{font-size:12px;line-height:1.2;font-weight:900;color:#222b38}",
  ".wh-pet-menu-group{display:grid;gap:5px;min-width:0}",
  ".wh-pet-menu-label{font-size:10px;line-height:1.1;font-weight:900;color:#667085;text-transform:uppercase}",
  ".wh-pet-menu-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;min-width:0}",
  ".wh-pet-menu button{min-width:0;max-width:100%;border:1px solid rgba(38,49,70,.14);border-radius:8px;background:#fff;color:#222b38;padding:6px 8px;font:850 11px/1.15 \"Aptos\",\"Segoe UI\",\"Microsoft YaHei\",\"PingFang SC\",sans-serif;cursor:pointer;min-height:28px;white-space:normal;overflow-wrap:anywhere;word-break:break-word}",
  ".wh-pet-menu-row button{width:auto;min-width:0;flex:1 1 0;padding-left:6px;padding-right:6px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  ".wh-pet-menu button[aria-pressed=true]{border-color:rgba(53,92,255,.34);background:#eef4ff;color:#2444bf;box-shadow:inset 3px 0 0 #355cff}",
  ".wh-pet-menu button[data-pet-menu-danger=true]{background:#fff4f3;border-color:rgba(238,107,95,.3);color:#b42318}",
  ".wh-pet-menu-action{width:100%;text-align:left}"
].join("");

export const desktopPetInitialIdleAction: CuuIdleMicroAction = "idle_tail_sway";
export const desktopPetPointerSmoothingAlpha = 0.58;

export const desktopPetAliveIdlePolicy = {
  breathe_interval_ms: [2800, 4200],
  blink_interval_ms: [1200, 1800],
  tail_interval_ms: [2200, 3200],
  look_interval_ms: [3200, 4600],
  sleep_after_ms: 5 * 60 * 1000,
  sleeping_loop_interval_ms: 12000
} satisfies Partial<CuuIdleSchedulerPolicy>;

export type DesktopPetFirstPaintClock = {
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  setTimeout?: (callback: () => void, timeout: number) => number;
  clearTimeout?: (handle: number) => void;
};

export function scheduleDesktopPetFirstPaint(
  callback: () => void,
  clock: DesktopPetFirstPaintClock = globalThis as DesktopPetFirstPaintClock
): () => void {
  let cancelled = false;
  const run = () => {
    if (cancelled) {
      return;
    }
    cancelled = true;
    callback();
  };
  const timeout = clock.setTimeout?.(run, 64);
  const raf = clock.requestAnimationFrame;

  if (raf) {
    raf(() => {
      raf(run);
    });
  }

  return () => {
    cancelled = true;
    if (timeout !== undefined) {
      clock.clearTimeout?.(timeout);
    }
  };
}

export function createDesktopPetIdleScheduler(now_ms = Date.now()): CuuIdleScheduler {
  return createCuuIdleScheduler({
    now_ms,
    policy: desktopPetAliveIdlePolicy
  });
}

export function resolveDesktopSurface(input: { pathname?: string; search?: string; hash?: string } = {}): DesktopSurface {
  const target = globalThis as typeof globalThis & {
    __WORKHUB_SURFACE__?: string;
    __TAURI__?: {
      window?: { getCurrentWindow?: () => { label?: string } };
      webviewWindow?: { getCurrentWebviewWindow?: () => { label?: string } };
    };
    location?: Location;
  };
  const pathname = input.pathname ?? target.location?.pathname ?? "/";
  const search = input.search ?? target.location?.search ?? "";
  const hash = input.hash ?? target.location?.hash ?? "";
  const surface = new URLSearchParams(search).get("surface");
  return target.__WORKHUB_SURFACE__ === "pet" ||
    currentTauriWindowLabel(target) === "pet" ||
    surface === "pet" ||
    hash === "#surface=pet" ||
    pathname === "/pet"
    ? "pet"
    : "main";
}

function currentTauriWindowLabel(target: {
  __TAURI__?: {
    window?: { getCurrentWindow?: () => { label?: string } };
    webviewWindow?: { getCurrentWebviewWindow?: () => { label?: string } };
  };
}) {
  try {
    return target.__TAURI__?.window?.getCurrentWindow?.()?.label ??
      target.__TAURI__?.webviewWindow?.getCurrentWebviewWindow?.()?.label;
  } catch {
    return undefined;
  }
}

export function renderDesktopPetSurface(input: {
  card?: CuuCard | undefined;
  idle_action?: CuuIdleMicroAction | undefined;
  status_text?: string | undefined;
  include_reject_reasons?: boolean | undefined;
  display_width_px?: number | undefined;
  pet_window_settings?: DesktopPetWindowSettings | undefined;
  pointer_snapshot?: DesktopPetPointerSnapshot | undefined;
  pointer_smoothing_alpha?: number | undefined;
  window_mode_error?: string | undefined;
  window_mode_status?: "syncing" | "failed" | undefined;
  requested_model_pack_id?: string | undefined;
  locale?: CuuLocaleOptions["locale"];
} = {}): DesktopPetSurfaceRender {
  const locale = input.locale ?? desktopPetLocale();
  const compactStatusOnly = !input.card && Boolean(input.status_text);
  const compactCard = Boolean(input.card && input.window_mode_error) || compactStatusOnly;
  const windowMode = compactCard
    ? "body_only"
    : desktopPetWindowModeForCard(input.card, { requested_model_pack_id: input.requested_model_pack_id });
  const settings = input.pet_window_settings ?? defaultDesktopPetWindowSettings();
  const pointer = normalizeDesktopPetPointerSnapshot(input.pointer_snapshot ?? defaultDesktopPetPointerSnapshot());
  const pointerSmoothingAlpha = input.pointer_smoothing_alpha ?? desktopPetPointerSmoothingAlpha;
  const scaleRatio = settings.scale_percent / 100;
  const hoverHidden = settings.hide_on_hover && pointer.hovered && !pointer.dragging && windowMode === "body_only" && !input.card;
  const hideX = hoverHidden ? (pointer.avoidance_x || -0.45) * 42 * scaleRatio : 0;
  const hideY = hoverHidden ? (pointer.avoidance_y || 0.24) * 24 * scaleRatio : 0;
  const avoidX = hoverHidden ? pointer.avoidance_x * 22 * scaleRatio : 0;
  const avoidY = hoverHidden ? pointer.avoidance_y * 12 * scaleRatio : 0;
  const baseWindowSize = petWindowSize(windowMode);
  const scaledWindowSize = {
    width: Math.round(baseWindowSize.width * scaleRatio),
    height: Math.round(baseWindowSize.height * scaleRatio)
  };
  const motion = desktopPetVisibleMotion(input.card?.motion ?? cuuMotionForState("idle"), {
    has_card: Boolean(input.card),
    compact_card: compactCard
  }, locale);
  const displayWidth = input.display_width_px ?? Math.round((compactCard ? 150 : 230) * scaleRatio);
  const live2d = input.card
    ? renderDesktopCuuCatLive2DForMotion(motion, {
        display_width_px: displayWidth,
        requested_model_pack_id: input.requested_model_pack_id
      })
    : renderDesktopCuuCatLive2DForIdleAction(input.idle_action ?? "idle_breathe", {
        display_width_px: displayWidth,
        requested_model_pack_id: input.requested_model_pack_id
      });
  const visualMode = "live2d_cat";
  const suppressTransientCompactBubble = compactCard && input.window_mode_status === "syncing";
  const bubble = !suppressTransientCompactBubble && (input.card || input.status_text || input.include_reject_reasons)
    ? renderDesktopPetBubble({
        card: input.card,
        status_text: input.status_text,
        include_reject_reasons: input.include_reject_reasons,
        compact: compactCard,
        window_mode_error: input.window_mode_error
      }, locale)
    : "";
  const menu = renderDesktopPetSettingsMenu({
    locale,
    requested_model_pack_id: input.requested_model_pack_id,
    hide_on_hover: settings.hide_on_hover
  });
  const cardAttrs = input.card
    ? ` data-pet-card-kind="${escapeHtml(input.card.kind)}" data-pet-card-priority="${escapeHtml(input.card.priority)}" data-pet-card-has-context="${petCardHasContext(input.card) ? "true" : "false"}"`
    : "";
  const surfaceStyle = [
    `--wh-pet-scale:${scaleRatio}`,
    `--wh-pet-opacity:${settings.opacity_percent / 100}`,
    `--wh-pet-window-w:${scaledWindowSize.width}px`,
    `--wh-pet-window-h:${scaledWindowSize.height}px`,
    `--wh-pet-look-x:${formatPointerNumber(pointer.look_x)}`,
    `--wh-pet-look-y:${formatPointerNumber(pointer.look_y)}`,
    `--wh-pet-pointer-smoothing-alpha:${formatPointerNumber(pointerSmoothingAlpha)}`,
    `--wh-pet-avoid-x:${formatPointerNumber(pointer.avoidance_x)}`,
    `--wh-pet-avoid-y:${formatPointerNumber(pointer.avoidance_y)}`,
    `--wh-pet-avoid-x-px:${formatPointerNumber(avoidX)}px`,
    `--wh-pet-avoid-y-px:${formatPointerNumber(avoidY)}px`,
    `--wh-pet-hide-x-px:${formatPointerNumber(hideX)}px`,
    `--wh-pet-hide-y-px:${formatPointerNumber(hideY)}px`,
    `--wh-pet-hide-scale:${hoverHidden ? "0.92" : "1"}`,
    `--wh-pet-hide-opacity:${hoverHidden ? "0.36" : "1"}`,
    `--wh-pet-look-head-x-px:${formatPointerNumber(pointer.look_x * 9 * scaleRatio)}px`,
    `--wh-pet-look-head-y-px:${formatPointerNumber(pointer.look_y * 4 * scaleRatio)}px`,
    `--wh-pet-look-eye-x-px:${formatPointerNumber(pointer.look_x * 9 * scaleRatio)}px`,
    `--wh-pet-look-eye-y-px:${formatPointerNumber(pointer.look_y * 4 * scaleRatio)}px`,
    `--wh-pet-look-face-x-px:${formatPointerNumber(pointer.look_x * 4 * scaleRatio)}px`,
    `--wh-pet-look-face-y-px:${formatPointerNumber(pointer.look_y * 2 * scaleRatio)}px`,
    `--wh-pet-look-rotate-deg:${formatPointerNumber(pointer.look_x * 5)}deg`
  ].join(";");

  return {
    live2d,
    visual_mode: visualMode,
    css: `${desktopPetSurfaceCss}${live2d.css}`,
    html: `<section class="wh-pet-surface" style="${surfaceStyle}" data-wh-surface="pet" data-pet-window-mode="${windowMode}" data-pet-card-layout="${compactCard ? "compact" : input.card ? "full" : "body"}" data-pet-scale-percent="${settings.scale_percent}" data-pet-opacity-percent="${settings.opacity_percent}" data-pet-pass-through="${settings.pass_through ? "true" : "false"}" data-pet-hide-on-hover="${settings.hide_on_hover ? "true" : "false"}" data-pet-hover-hidden="${hoverHidden ? "true" : "false"}" data-pet-hover-hide-mode="${settings.hide_on_hover ? "soft" : "off"}" data-pet-window-width="${scaledWindowSize.width}" data-pet-window-height="${scaledWindowSize.height}" data-pet-cursor-near="${pointer.cursor_near ? "true" : "false"}" data-pet-hovered="${pointer.hovered ? "true" : "false"}" data-pet-dragging="${pointer.dragging ? "true" : "false"}" data-pet-look-x="${formatPointerNumber(pointer.look_x)}" data-pet-look-y="${formatPointerNumber(pointer.look_y)}" data-pet-hover-avoidance="${pointer.hover_avoidance}" data-pet-pointer-smoothing-alpha="${formatPointerNumber(pointerSmoothingAlpha)}"${pointer.last_pointer_ms !== undefined ? ` data-pet-last-pointer-ms="${escapeHtml(pointer.last_pointer_ms)}"` : ""}${cardAttrs}${input.window_mode_status ? ` data-pet-window-mode-status="${escapeHtml(input.window_mode_status)}"` : ""}${input.window_mode_error ? ` data-pet-window-mode-error="${escapeHtml(input.window_mode_error)}"` : ""} data-cuu-state="${escapeHtml(motion.state)}" data-cuu-idle-action="${escapeHtml(input.idle_action ?? "idle_breathe")}" data-cuu-visual-mode="${visualMode}" data-cuu-live2d-runtime="${escapeHtml(live2d.runtime_kind)}" data-cuu-live2d-status="${escapeHtml(live2d.status)}" data-cuu-live2d-model="${escapeHtml(live2d.model_key)}" data-cuu-live2d-appearance="${escapeHtml(live2d.appearance)}" data-cuu-live2d-motion="${escapeHtml(live2d.motion_state)}" data-cuu-live2d-renderer-state="${escapeHtml(live2d.renderer_state)}" data-cuu-live2d-layer-count="native_moc" data-cuu-behavior-manifest-version="${live2d.behavior_manifest_version}" data-cuu-behavior-state="${escapeHtml(live2d.behavior_state)}" data-cuu-behavior-phase="${escapeHtml(live2d.behavior_phase)}" data-cuu-behavior-coverage="${escapeHtml(live2d.behavior_coverage)}" data-cuu-behavior-priority="${escapeHtml(live2d.behavior_priority)}" data-cuu-behavior-expected-window-mode="${escapeHtml(live2d.behavior_window_mode)}" data-cuu-behavior-expected-bubble-mode="${escapeHtml(live2d.behavior_bubble_mode)}" data-cuu-live2d-frame-url="${escapeHtml(live2d.iframe_url)}" data-cuu-live2d-model-url="${escapeHtml(live2d.model_url)}" data-cuu-model-pack="${escapeHtml(live2d.model_pack_id)}" data-cuu-model-pack-selection-reason="${escapeHtml(live2d.model_pack_selection_reason)}">
      <button class="wh-pet-body" type="button" data-pet-drag-handle="true" aria-label="${escapeHtml(cuuT(locale, "pet.aria"))}">
        ${live2d.html}
      </button>
      ${menu}
      ${bubble}
    </section>`
  };
}

export function desktopPetLocale(input?: unknown): WorkHubLocale {
  const target = globalThis as typeof globalThis & {
    __WORKHUB_CUU_QA_LOCALE__?: unknown;
    localStorage?: Storage;
    navigator?: Navigator;
  };
  return normalizeWorkHubLocale(
    input
    ?? target.__WORKHUB_CUU_QA_LOCALE__
    ?? target.localStorage?.getItem(workHubLocaleStorageKey)
    ?? target.navigator?.language
  );
}

function renderDesktopPetSettingsMenu(input: {
  locale: WorkHubLocale;
  requested_model_pack_id?: string | undefined;
  hide_on_hover: boolean;
}) {
  const copy = desktopPetSettingsMenuCopy[input.locale];
  const selectedModel = input.requested_model_pack_id === "cuu-tororo-live2d-cubism2"
    ? "cuu-tororo-live2d-cubism2"
    : "cuu-hijiki-live2d-cubism2";
  const modelButton = (id: "cuu-hijiki-live2d-cubism2" | "cuu-tororo-live2d-cubism2", label: string) =>
    `<button type="button" data-pet-menu-model="${id}" aria-pressed="${selectedModel === id ? "true" : "false"}">${escapeHtml(label)}</button>`;
  const localeButton = (locale: WorkHubLocale, label: string) =>
    `<button type="button" data-pet-menu-locale="${locale}" aria-pressed="${input.locale === locale ? "true" : "false"}">${escapeHtml(label)}</button>`;

  return `<nav class="wh-pet-menu" data-pet-settings-menu="true" aria-label="${escapeHtml(copy.aria)}" hidden>
    <div class="wh-pet-menu-title">${escapeHtml(copy.title)}</div>
    <div class="wh-pet-menu-group">
      <div class="wh-pet-menu-label">${escapeHtml(copy.model)}</div>
      <div class="wh-pet-menu-row">
        ${modelButton("cuu-hijiki-live2d-cubism2", copy.blackCat)}
        ${modelButton("cuu-tororo-live2d-cubism2", copy.whiteCat)}
      </div>
    </div>
    <div class="wh-pet-menu-group">
      <div class="wh-pet-menu-label">${escapeHtml(copy.language)}</div>
      <div class="wh-pet-menu-row">
        ${localeButton("zh-CN", "中文")}
        ${localeButton("en-US", "EN")}
      </div>
    </div>
    <div class="wh-pet-menu-group">
      <button type="button" class="wh-pet-menu-action" data-pet-menu-toggle-hover="true" aria-pressed="${input.hide_on_hover ? "true" : "false"}">${escapeHtml(copy.hideOnHover)}</button>
      <button type="button" class="wh-pet-menu-action" data-pet-menu-open-settings="true">${escapeHtml(copy.openSettings)}</button>
      <button type="button" class="wh-pet-menu-action" data-pet-menu-hide="true" data-pet-menu-danger="true">${escapeHtml(copy.hideCuu)}</button>
    </div>
  </nav>`;
}

const desktopPetSettingsMenuCopy = {
  "zh-CN": {
    aria: "Cuu 桌宠设置菜单",
    title: "Cuu 设置",
    model: "形象",
    blackCat: "黑猫",
    whiteCat: "白猫",
    language: "语言",
    hideOnHover: "悬停避让",
    openSettings: "打开设置",
    hideCuu: "隐藏 Cuu",
    modelChanged: "Cuu 形象已更新。",
    localeChanged: "语言已更新。",
    hoverEnabled: "悬停避让已开启。",
    hoverDisabled: "悬停避让已关闭。",
    openSettingsFallback: "请从托盘打开设置。",
    hideFallback: "请从托盘隐藏 Cuu。",
    restoredFromTray: "已恢复交互。"
  },
  "en-US": {
    aria: "Cuu desktop pet settings menu",
    title: "Cuu settings",
    model: "Look",
    blackCat: "Black cat",
    whiteCat: "White cat",
    language: "Language",
    hideOnHover: "Dodge hover",
    openSettings: "Open settings",
    hideCuu: "Hide Cuu",
    modelChanged: "Cuu look updated.",
    localeChanged: "Language updated.",
    hoverEnabled: "Dodge hover is on.",
    hoverDisabled: "Dodge hover is off.",
    openSettingsFallback: "Open settings from the tray.",
    hideFallback: "Hide Cuu from the tray.",
    restoredFromTray: "Interaction restored."
  }
} as const;

function setPetSettingsMenuOpen(root: HTMLElement, open: boolean) {
  const surface = root.querySelector<HTMLElement>("[data-wh-surface=pet]");
  const menu = root.querySelector<HTMLElement>("[data-pet-settings-menu]");
  if (!surface || !menu) {
    return;
  }
  menu.hidden = !open;
  const transientBubble = root.querySelector<HTMLElement>("[data-pet-bubble][data-pet-bubble-transient=true]");
  if (transientBubble) {
    transientBubble.hidden = open;
  }
  surface.dataset.petMenuOpen = open ? "true" : "false";
  writeDesktopPetQaDomSnapshot(root, "patch");
}

function desktopTrayActionId(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const id = (payload as { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

export function defaultDesktopPetWindowSettings(): DesktopPetWindowSettings {
  return {
    scale_percent: 100,
    opacity_percent: 100,
    pass_through: false,
    hide_on_hover: false
  };
}

export function defaultDesktopPetPointerSnapshot(): DesktopPetPointerSnapshot {
  return normalizeDesktopPetPointerSnapshot({});
}

function patchDesktopPetSurfaceRuntimeState(
  root: HTMLElement,
  input: {
    idle_action: CuuIdleMicroAction;
    card?: CuuCard | undefined;
    pet_window_settings: DesktopPetWindowSettings;
    pointer_snapshot: DesktopPetPointerSnapshot;
    pointer_smoothing_alpha: number;
  }
): boolean {
  const surface = root.querySelector<HTMLElement>(".wh-pet-surface");
  if (!surface) {
    return false;
  }
  const settings = input.pet_window_settings;
  const pointer = normalizeDesktopPetPointerSnapshot(input.pointer_snapshot);
  const scaleRatio = settings.scale_percent / 100;
  const windowMode = surface.dataset.petWindowMode === "card" ? "card" : "body_only";
  const hoverHidden = settings.hide_on_hover && pointer.hovered && !pointer.dragging && windowMode === "body_only" && !input.card;
  const hideX = hoverHidden ? (pointer.avoidance_x || -0.45) * 42 * scaleRatio : 0;
  const hideY = hoverHidden ? (pointer.avoidance_y || 0.24) * 24 * scaleRatio : 0;
  const avoidX = hoverHidden ? pointer.avoidance_x * 22 * scaleRatio : 0;
  const avoidY = hoverHidden ? pointer.avoidance_y * 12 * scaleRatio : 0;
  const dynamicVars: Record<string, string> = {
    "--wh-pet-look-x": formatPointerNumber(pointer.look_x),
    "--wh-pet-look-y": formatPointerNumber(pointer.look_y),
    "--wh-pet-pointer-smoothing-alpha": formatPointerNumber(input.pointer_smoothing_alpha),
    "--wh-pet-avoid-x": formatPointerNumber(pointer.avoidance_x),
    "--wh-pet-avoid-y": formatPointerNumber(pointer.avoidance_y),
    "--wh-pet-avoid-x-px": `${formatPointerNumber(avoidX)}px`,
    "--wh-pet-avoid-y-px": `${formatPointerNumber(avoidY)}px`,
    "--wh-pet-hide-x-px": `${formatPointerNumber(hideX)}px`,
    "--wh-pet-hide-y-px": `${formatPointerNumber(hideY)}px`,
    "--wh-pet-hide-scale": hoverHidden ? "0.92" : "1",
    "--wh-pet-hide-opacity": hoverHidden ? "0.36" : "1",
    "--wh-pet-look-head-x-px": `${formatPointerNumber(pointer.look_x * 9 * scaleRatio)}px`,
    "--wh-pet-look-head-y-px": `${formatPointerNumber(pointer.look_y * 4 * scaleRatio)}px`,
    "--wh-pet-look-eye-x-px": `${formatPointerNumber(pointer.look_x * 9 * scaleRatio)}px`,
    "--wh-pet-look-eye-y-px": `${formatPointerNumber(pointer.look_y * 4 * scaleRatio)}px`,
    "--wh-pet-look-face-x-px": `${formatPointerNumber(pointer.look_x * 4 * scaleRatio)}px`,
    "--wh-pet-look-face-y-px": `${formatPointerNumber(pointer.look_y * 2 * scaleRatio)}px`,
    "--wh-pet-look-rotate-deg": `${formatPointerNumber(pointer.look_x * 5)}deg`
  };
  for (const [name, value] of Object.entries(dynamicVars)) {
    surface.style.setProperty(name, value);
  }
  surface.dataset.petCursorNear = pointer.cursor_near ? "true" : "false";
  surface.dataset.petHovered = pointer.hovered ? "true" : "false";
  surface.dataset.petDragging = pointer.dragging ? "true" : "false";
  surface.dataset.petLookX = formatPointerNumber(pointer.look_x);
  surface.dataset.petLookY = formatPointerNumber(pointer.look_y);
  surface.dataset.petHoverAvoidance = pointer.hover_avoidance;
  surface.dataset.petPointerSmoothingAlpha = formatPointerNumber(input.pointer_smoothing_alpha);
  surface.dataset.petHoverHidden = hoverHidden ? "true" : "false";
  if (pointer.last_pointer_ms !== undefined) {
    surface.dataset.petLastPointerMs = String(pointer.last_pointer_ms);
  } else {
    delete surface.dataset.petLastPointerMs;
  }
  if (!input.card) {
    const behavior = resolveDesktopCuuCatLive2DBehaviorState({
      state: "idle",
      motion_state: input.idle_action,
      phase: "idle_random",
      requested_model_pack_id: surface.dataset.cuuModelPack
    });
    surface.dataset.cuuIdleAction = input.idle_action;
    surface.dataset.cuuState = behavior.behavior_state;
    surface.dataset.cuuLive2dMotion = input.idle_action;
    surface.dataset.cuuLive2dRendererState = behavior.renderer_state;
    surface.dataset.cuuBehaviorManifestVersion = String(behavior.behavior_manifest_version);
    surface.dataset.cuuBehaviorState = behavior.behavior_state;
    surface.dataset.cuuBehaviorPhase = behavior.behavior_phase;
    surface.dataset.cuuBehaviorCoverage = behavior.behavior_coverage;
    surface.dataset.cuuBehaviorPriority = String(behavior.behavior_priority);
    surface.dataset.cuuBehaviorExpectedWindowMode = behavior.behavior_window_mode;
    surface.dataset.cuuBehaviorExpectedBubbleMode = behavior.behavior_bubble_mode;
    setDesktopCuuCatLive2DBehaviorState(root, {
      state: "idle",
      motion_state: input.idle_action,
      phase: "idle_random",
      requested_model_pack_id: surface.dataset.cuuModelPack
    });
  }
  return true;
}

function petWindowSize(mode: DesktopPetWindowMode) {
  return mode === "card"
    ? { width: 520, height: 720 }
    : { width: 260, height: 340 };
}

function desktopPetVisibleMotion(
  motion: CuuMotionHint,
  input: { has_card: boolean; compact_card: boolean },
  locale: WorkHubLocale
): CuuMotionHint {
  if (input.has_card && !input.compact_card && motion.sprite_state === "offline_sleep") {
    return {
      ...motion,
      sprite_state: "worried_ears",
      emphasis: "urgent",
      loop: true,
      reduced_motion_fallback: cuuT(locale, "pet.reducedMotionOffline")
    };
  }
  return motion;
}

function selectPetCardOption(card: CuuCard, optionId: string): { card: CuuCard; label?: string } {
  if (!card.chips?.length || !optionId) {
    return { card };
  }
  const multi = card.input?.mode === "multi_choice" || card.input?.mode === "rank";
  let selectedLabel: string | undefined;
  const chips = card.chips.map((chip) => {
    if (chip.id !== optionId) {
      return multi ? chip : { ...chip, selected: false };
    }
    selectedLabel = chip.label;
    return {
      ...chip,
      selected: multi ? !chip.selected : true
    };
  });
  return {
    card: {
      ...card,
      chips
    },
    ...(selectedLabel ? { label: selectedLabel } : {})
  };
}

function selectedOptionIdsFromCard(card: CuuCard | undefined) {
  return (card?.chips ?? []).filter((chip) => chip.selected).map((chip) => chip.id);
}

function primaryDesktopCuuAction(card: CuuCard, actionId: string): DesktopCuuActionRequest {
  const action = card.actions.find((candidate) => candidate.id === actionId);
  if (!action) {
    throw new Error(`Unable to find Cuu action ${actionId} for ${card.id}.`);
  }
  const resolved = action?.href
    ? resolveDesktopCuuAction(action.href, { actionId: action.id, card })
    : undefined;
  if (!resolved) {
    throw new Error(`Unable to resolve Cuu action ${actionId} for ${card.id}.`);
  }
  return resolved;
}

export async function bootDesktopPetSurface(
  root: HTMLElement,
  input: {
    listen?: DesktopShellListen | undefined;
    controller?: CuuController | undefined;
    idleScheduler?: CuuIdleScheduler | undefined;
    petWindowBridge?: DesktopPetWindowBridge | undefined;
    shellEmitter?: DesktopShellEmitter | undefined;
    client?: DesktopPetSurfaceClient | undefined;
  } = {}
): Promise<DesktopPetSurfaceRuntime> {
  let locale = desktopPetLocale();
  const controller = input.controller ?? createCuuController({ preferences: loadCuuPreferences() });
  const idleScheduler = input.idleScheduler ?? createDesktopPetIdleScheduler(Date.now());
  const petWindowBridge = input.petWindowBridge ?? resolveDesktopPetWindowBridge();
  const shellEmitter = input.shellEmitter ?? resolveDesktopShellEmitter();
  const qaScenario = desktopPetQaScenarioFromGlobal();
  const shellListen = input.listen ?? createDesktopPetQaShellListenFromGlobal() ?? resolveDesktopShellListen();
  const client = input.client ?? createApiClient({
    baseUrl: "",
    getClientToken: clientToken
  });
  let currentCard: CuuCard | undefined;
  // L#83：卡片内容只在 setCard 时变；用单调递增的版本号代表结构身份，避免每帧(4Hz) JSON.stringify 整张卡片。
  let cardRevision = 0;
  let idleAction: CuuIdleMicroAction = input.idleScheduler
    ? idleScheduler.snapshot().last_action ?? "idle_breathe"
    : desktopPetInitialIdleAction;
  let statusText: string | undefined;
  let pendingAction: DesktopCuuActionRequest | undefined;
  let runStreamSubscription: DesktopCuuRunStreamSubscription | undefined;
  let confirmedPetWindowMode: DesktopPetWindowMode | undefined;
  let syncingPetWindowMode: DesktopPetWindowMode | undefined;
  let failedPetWindowMode: DesktopPetWindowMode | undefined;
  let petWindowModeError: string | undefined;
  let confirmedPetWindowSettingsKey: string | undefined;
  let syncingPetWindowSettingsKey: string | undefined;
  let failedPetWindowSettingsKey: string | undefined;
  let pointerSnapshot = defaultDesktopPetPointerSnapshot();
  let lastCursorNear = false;
  let pointerSensor: DesktopPetPointerSensor | undefined;
  let renderGeneration = 0;
  let cancelPendingFirstPaintSync: (() => void) | undefined;
  let lastStructuralRenderKey: string | undefined;
  let lastRunStreamStatus: DesktopCuuRunStreamStatus | undefined;

  const applyRunStreamStatusAttributes = () => {
    const surface = root.querySelector<HTMLElement>("[data-wh-surface=pet]");
    if (!surface || !lastRunStreamStatus) {
      return;
    }
    surface.setAttribute("data-cuu-run-stream-state", lastRunStreamStatus.state);
    surface.setAttribute("data-cuu-run-stream-run-id", lastRunStreamStatus.runId);
    surface.setAttribute(
      "data-cuu-run-stream-event-type",
      lastRunStreamStatus.state === "event" ? lastRunStreamStatus.eventType : ""
    );
    surface.setAttribute(
      "data-cuu-run-stream-refreshed-status",
      lastRunStreamStatus.state === "refreshed" ? lastRunStreamStatus.status : ""
    );
    surface.setAttribute(
      "data-cuu-run-stream-message",
      lastRunStreamStatus.state === "error" ? lastRunStreamStatus.message : ""
    );
    surface.setAttribute(
      "data-cuu-run-stream-close-reason",
      lastRunStreamStatus.state === "closed" ? lastRunStreamStatus.reason : ""
    );
  };

  const render = () => {
    const petWindowSettings = desktopPetWindowSettingsFromPreferences(controller.snapshot().preferences);
    const preferences = controller.snapshot().preferences;
    const desiredMode = desktopPetWindowModeForCard(currentCard, { requested_model_pack_id: preferences.pet_model_pack_id });
    const compactCard = Boolean(currentCard && petWindowBridge && desiredMode === "card" && confirmedPetWindowMode !== "card");
    const windowModeError = compactCard ? petWindowModeError ?? cuuT(locale, "pet.windowModeExpanding") : undefined;
    const windowModeStatus = compactCard ? petWindowModeError ? "failed" : "syncing" : undefined;
    const structuralRenderKey = desktopPetStructuralRenderKey({
      card_revision: currentCard ? cardRevision : 0,
      card_id: currentCard?.id,
      status_text: statusText,
      include_reject_reasons: Boolean(pendingAction),
      pet_window_settings: petWindowSettings,
      requested_model_pack_id: preferences.pet_model_pack_id,
      compact_card: compactCard,
      window_mode_error: windowModeError,
      window_mode_status: windowModeStatus,
      locale
    });
    if (
      structuralRenderKey === lastStructuralRenderKey &&
      patchDesktopPetSurfaceRuntimeState(root, {
        idle_action: idleAction,
        card: currentCard,
        pet_window_settings: petWindowSettings,
        pointer_snapshot: pointerSnapshot,
        pointer_smoothing_alpha: desktopPetPointerSmoothingAlpha
      })
    ) {
      applyRunStreamStatusAttributes();
      writeDesktopPetQaDomSnapshot(root, "patch");
      syncPetWindowSettings(petWindowSettings);
      return;
    }

    renderGeneration += 1;
    const generation = renderGeneration;
    const surface = renderDesktopPetSurface({
      card: currentCard,
      idle_action: idleAction,
      status_text: statusText,
      include_reject_reasons: Boolean(pendingAction),
      pet_window_settings: petWindowSettings,
      requested_model_pack_id: preferences.pet_model_pack_id,
      pointer_snapshot: pointerSnapshot,
      window_mode_error: windowModeError,
      window_mode_status: windowModeStatus,
      locale
    });
    root.innerHTML = `${liquidGlassHeadHtml}<style>${surface.css}</style>${surface.html}`;
    applyRunStreamStatusAttributes();
    writeDesktopPetQaDomSnapshot(root, "render");
    lastStructuralRenderKey = structuralRenderKey;
    syncPetWindowSettings(petWindowSettings);
    cancelPendingFirstPaintSync?.();
    cancelPendingFirstPaintSync = scheduleDesktopPetFirstPaint(() => {
      if (generation !== renderGeneration) {
        return;
      }
      cancelPendingFirstPaintSync = undefined;
      syncPetWindowMode(desiredMode);
    });
  };

  const setCard = (card: CuuCard | undefined, status?: string, options: { persist?: boolean } = {}) => {
    const nextRunId = agentRunIdFromPetCard(card);
    if (runStreamSubscription && nextRunId !== runStreamSubscription.runId) {
      runStreamSubscription.close();
      runStreamSubscription = undefined;
    }
    if (card) {
      idleScheduler.observeWorkEvent(Date.now());
    }
    currentCard = card;
    cardRevision += 1;
    statusText = status;
    pendingAction = undefined;
    if (options.persist !== false) {
      writeDesktopPetRestoreState(card);
    }
    render();
  };

  const subscribeToAgentRun = (result: { agentRun?: Parameters<typeof subscribeDesktopCuuAgentRunStream>[0]["run"] }) => {
    if (!result.agentRun) {
      return;
    }
    runStreamSubscription?.close();
    const subscription = subscribeDesktopCuuAgentRunStream({
      client,
      run: result.agentRun,
      locale,
      onCard(card, message) {
        setCard(card, message);
      },
      onStatus(status) {
        lastRunStreamStatus = status;
        applyRunStreamStatusAttributes();
        writeDesktopPetQaDomSnapshot(root, "patch");
        if (status.state === "closed" && runStreamSubscription?.runId === status.runId) {
          runStreamSubscription = undefined;
        }
      }
    });
    runStreamSubscription = subscription.streamUrl ? subscription : undefined;
  };

  async function restoreDesktopPetCard() {
    const restore = readDesktopPetRestoreState();
    if (!restore || currentCard || desktopPetQaScenarioSkipsLocalRestore(qaScenario)) {
      return;
    }
    if (restore.entity_type === "session") {
      setCard(restore.card, cuuFormat(locale, "cuuStart.restored", { title: restore.card.title }), { persist: false });
      return;
    }
    try {
      const run = await client.getAgentRun(restore.entity_id);
      if (currentCard) {
        return;
      }
      setCard(cardFromAgentRunLive(run, { locale }), cuuFormat(locale, "cuuStart.restored", { title: run.title }));
      if (desktopPetAgentRunIsActive(run)) {
        subscribeToAgentRun({ agentRun: run });
      }
    } catch (error) {
      if (currentCard) {
        return;
      }
      setCard(cardFromDesktopCuuRuntimeError(error, { locale }), actionMessage(error, locale), { persist: false });
    }
  }

  const broadcastPetSettings = (
    preferences: CuuControllerPreferences,
    source: DesktopPetSettingsPayload["source"] = "pet-menu"
  ) => {
    const payload = desktopPetSettingsPayloadFromPreferences(preferences, source);
    const sent = shellEmitter?.emitTo?.("main", "pet-settings", payload);
    if (!shellEmitter?.emitTo && shellEmitter?.emit) {
      void Promise.resolve(shellEmitter.emit("pet-settings", payload)).catch(() => undefined);
      return;
    }
    void Promise.resolve(sent).catch(() => undefined);
  };

  const updatePetPreferences = (
    preferences: Partial<CuuControllerPreferences>,
    message?: string,
    options: { broadcast?: boolean; source?: DesktopPetSettingsPayload["source"] } = {}
  ) => {
    const snapshot = controller.setPreferences(preferences);
    saveCuuPreferences(snapshot.preferences);
    if (message) {
      statusText = message;
    }
    render();
    if (options.broadcast !== false) {
      broadcastPetSettings(snapshot.preferences, options.source);
    }
  };

  async function startRunStreamQaScenario() {
    try {
      const launcher = selectPetCardOption(createDesktopCuuAgentLauncherCard({ locale }), "document-draft").card;
      setCard(launcher);
      const launcherAction = primaryDesktopCuuAction(launcher, "start_agent_from_cuu");
      const clarification = await submitDesktopCuuAction({ client, action: launcherAction, locale });
      if (!clarification.card) {
        throw new Error("run-stream QA expected a clarification card.");
      }
      const scopeCard = selectPetCardOption(clarification.card, "document-draft").card;
      setCard(scopeCard, clarification.message);
      const scopeAction = primaryDesktopCuuAction(scopeCard, "submit_option");
      const confirmation = await submitDesktopCuuAction({ client, action: scopeAction, locale });
      if (!confirmation.card) {
        throw new Error("run-stream QA expected a confirmation card.");
      }
      const confirmCard = selectPetCardOption(confirmation.card, "create-workitem").card;
      setCard(confirmCard, confirmation.message);
      const confirmAction = primaryDesktopCuuAction(confirmCard, "submit_option");
      const started = await submitDesktopCuuAction({ client, action: confirmAction, locale });
      setCard(started.card ?? confirmCard, started.message);
      subscribeToAgentRun(started);
    } catch (error) {
      setCard(cardFromDesktopCuuRuntimeError(error, { locale }), actionMessage(error, locale));
    }
  }

  const setLocalePreference = (nextLocale: WorkHubLocale) => {
    locale = nextLocale;
    try {
      globalThis.localStorage?.setItem(workHubLocaleStorageKey, nextLocale);
    } catch {
      // Local storage may be unavailable in isolated test surfaces.
    }
    statusText = desktopPetSettingsMenuCopy[locale].localeChanged;
    void client.updatePreferences({ locale: nextLocale }).catch(() => undefined);
    render();
  };

  render();
  if (!desktopPetQaScenarioSkipsLocalRestore(qaScenario)) {
    void restoreDesktopPetCard();
  }

  pointerSensor = createDesktopPetPointerSensor(root, {
    bridge: petWindowBridge,
    onInteraction(interaction, nowMs) {
      pointerSnapshot = pointerSensor?.snapshot() ?? pointerSnapshot;
      lastCursorNear = pointerSnapshot.cursor_near;
      if (currentCard || controller.snapshot().preferences.reduced_motion) {
        render();
        return;
      }
      const decision = idleScheduler.observeInteraction(interaction, nowMs);
      if (decision.action) {
        idleAction = decision.action;
      }
      render();
    }
  });

  root.addEventListener("click", async (event) => {
    const menuTarget = event.target instanceof Element ? event.target : null;
    const modelButton = menuTarget?.closest<HTMLButtonElement>("[data-pet-menu-model]");
    if (modelButton) {
      event.preventDefault();
      setPetSettingsMenuOpen(root, false);
      const modelPackId = modelButton.dataset.petMenuModel === "cuu-tororo-live2d-cubism2"
        ? "cuu-tororo-live2d-cubism2"
        : "cuu-hijiki-live2d-cubism2";
      updatePetPreferences({ pet_model_pack_id: modelPackId }, desktopPetSettingsMenuCopy[locale].modelChanged);
      return;
    }

    const localeButton = menuTarget?.closest<HTMLButtonElement>("[data-pet-menu-locale]");
    if (localeButton) {
      event.preventDefault();
      setPetSettingsMenuOpen(root, false);
      setLocalePreference(normalizeWorkHubLocale(localeButton.dataset.petMenuLocale));
      return;
    }

    const hoverToggle = menuTarget?.closest<HTMLButtonElement>("[data-pet-menu-toggle-hover]");
    if (hoverToggle) {
      event.preventDefault();
      setPetSettingsMenuOpen(root, false);
      const enabled = controller.snapshot().preferences.pet_hide_on_hover;
      updatePetPreferences(
        { pet_hide_on_hover: !enabled },
        !enabled ? desktopPetSettingsMenuCopy[locale].hoverEnabled : desktopPetSettingsMenuCopy[locale].hoverDisabled
      );
      return;
    }

    const openSettingsButton = menuTarget?.closest<HTMLButtonElement>("[data-pet-menu-open-settings]");
    if (openSettingsButton) {
      event.preventDefault();
      setPetSettingsMenuOpen(root, false);
      if (!petWindowBridge?.focusMainRoute) {
        statusText = desktopPetSettingsMenuCopy[locale].openSettingsFallback;
        render();
        return;
      }
      try {
        await petWindowBridge.focusMainRoute("/settings");
      } catch {
        statusText = desktopPetSettingsMenuCopy[locale].openSettingsFallback;
        render();
      }
      return;
    }

    const hideButton = menuTarget?.closest<HTMLButtonElement>("[data-pet-menu-hide]");
    if (hideButton) {
      event.preventDefault();
      setPetSettingsMenuOpen(root, false);
      if (!petWindowBridge?.hidePetWindow) {
        statusText = desktopPetSettingsMenuCopy[locale].hideFallback;
        render();
        return;
      }
      try {
        await petWindowBridge.hidePetWindow();
      } catch {
        statusText = desktopPetSettingsMenuCopy[locale].hideFallback;
        render();
      }
      return;
    }

    if (menuTarget && !menuTarget.closest("[data-pet-settings-menu]")) {
      setPetSettingsMenuOpen(root, false);
    }

    const optionButton = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-pet-option-id]") : null;
    if (optionButton && currentCard?.input) {
      event.preventDefault();
      const selection = selectPetCardOption(currentCard, optionButton.dataset.petOptionId ?? "");
      currentCard = selection.card;
      statusText = selection.label
        ? cuuFormat(locale, "pet.selectedWithLabel", { label: selection.label })
        : cuuT(locale, "pet.selectedFallback");
      pendingAction = undefined;
      render();
      return;
    }

    const reasonButton = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-pet-reason]") : null;
    if (reasonButton && pendingAction) {
      try {
        const result = await submitDesktopCuuAction({
          client,
          action: pendingAction,
          reasonMd: reasonButton.dataset.petReason ?? cuuT(locale, "pet.reasonDefault"),
          locale
        });
        setCard(result.card ?? currentCard, result.message);
        subscribeToAgentRun(result);
      } catch (error) {
        setCard(cardFromDesktopCuuRuntimeError(error, { locale }), actionMessage(error, locale));
      }
      return;
    }

    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
    const petBody = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-pet-drag-handle]") : null;
    if (petBody && !anchor) {
      if (!currentCard) {
        setCard(createDesktopCuuAgentLauncherCard({ locale }));
        return;
      }
      const decision = idleScheduler.observeInteraction("tap", Date.now());
      if (decision.action) {
        idleAction = decision.action;
        render();
      }
      return;
    }
    if (!anchor) {
      return;
    }
    if (
      (anchor.dataset.cuuActionId === "submit_option" || anchor.dataset.cuuActionId === "start_agent_from_cuu")
      && currentCard?.input
      && (currentCard.chips?.length ?? 0) > 0
    ) {
      const selectedOptionIds = selectedOptionIdsFromCard(currentCard);
      if (selectedOptionIds.length === 0) {
        event.preventDefault();
        statusText = cuuT(locale, "pet.optionRequired");
        pendingAction = undefined;
        render();
        return;
      }
    }
    const action = resolveDesktopCuuAction(anchor.getAttribute("href") ?? "", {
      actionId: anchor.dataset.cuuActionId,
      requiresReason: anchor.dataset.requiresReason === "true",
      card: currentCard
    });
    if (!action) {
      return;
    }
    event.preventDefault();
    if (action.kind === "approval-response" && action.requiresReason && action.decision === "deny") {
      pendingAction = action;
      statusText = cuuT(locale, "pet.reasonRequired");
      render();
      return;
    }
    try {
      const result = await submitDesktopCuuAction({ client, action, locale });
      setCard(result.card ?? currentCard, result.message);
      subscribeToAgentRun(result);
    } catch (error) {
      setCard(cardFromDesktopCuuRuntimeError(error, { locale }), actionMessage(error, locale));
    }
  });

  root.addEventListener("contextmenu", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest("[data-wh-surface=pet]")) {
      return;
    }
    event.preventDefault();
    if (statusText && !currentCard) {
      statusText = undefined;
      render();
    }
    setPetSettingsMenuOpen(root, true);
  });

  let petSettingsUnlisten: DesktopShellUnlisten | undefined;
  const maybePetSettingsUnlisten = await shellListen?.("pet-settings", (event) => {
    const preferences = desktopPetSettingsPreferencesFromPayload(event.payload);
    if (!preferences) {
      return;
    }
    updatePetPreferences(preferences, undefined, { broadcast: false });
  });
  if (typeof maybePetSettingsUnlisten === "function") {
    petSettingsUnlisten = maybePetSettingsUnlisten;
  }

  let trayActionUnlisten: DesktopShellUnlisten | undefined;
  const maybeTrayActionUnlisten = await shellListen?.("tray-action", (event) => {
    if (desktopTrayActionId(event.payload) !== "restore-pet-interaction") {
      return;
    }
    updatePetPreferences(
      {
        pet_pass_through: false,
        pet_hide_on_hover: false,
        pet_opacity_percent: 100
      },
      desktopPetSettingsMenuCopy[locale].restoredFromTray,
      { source: "tray" }
    );
  });
  if (typeof maybeTrayActionUnlisten === "function") {
    trayActionUnlisten = maybeTrayActionUnlisten;
  }

  const runtime = await bindDesktopShellCuuRuntime({
    listen: shellListen,
    controller,
    notify(notice) {
      setCard(notice.card);
    },
    locale
  });
  let samplingCursor = false;
  if (desktopPetQaScenarioStartsRunApiFlow(qaScenario)) {
    window.setTimeout(() => {
      void startRunStreamQaScenario();
    }, 160);
  }
  const idleTimer = window.setInterval(() => {
    if (samplingCursor) {
      return;
    }
    samplingCursor = true;
    void tickIdle().finally(() => {
      samplingCursor = false;
    });
  }, 250);

  async function tickIdle() {
    const pointer = pointerSensor?.snapshot() ?? pointerSnapshot;
    const sampledPointer = await Promise.resolve(petWindowBridge?.sampleCursorNear?.()).catch(() => undefined);
    const nextPointerSnapshot = desktopPetPointerSnapshotFromSample(sampledPointer, pointer, {
      smoothing_alpha: desktopPetPointerSmoothingAlpha,
      snap_threshold: 0.018
    });
    const pointerChanged = !desktopPetPointerStateEqual(pointerSnapshot, nextPointerSnapshot);
    const cursorNear = nextPointerSnapshot.cursor_near;
    const enteredCursorNear = cursorNear && !lastCursorNear;
    pointerSnapshot = nextPointerSnapshot;
    lastCursorNear = cursorNear;
    if (nextPointerSnapshot.dragging) {
      const nextIdleAction = controller.snapshot().preferences.reduced_motion ? idleAction : "drag_hold";
      const actionChanged = idleAction !== nextIdleAction;
      idleAction = nextIdleAction;
      if (pointerChanged || actionChanged) {
        render();
      }
      return;
    }
    const decision = idleScheduler.tick({
      now_ms: Date.now(),
      active_card: Boolean(currentCard),
      cursor_near: cursorNear,
      ...(enteredCursorNear ? { interaction: "cursor_near" } : {}),
      reduced_motion: controller.snapshot().preferences.reduced_motion
    });
    if (decision.action) {
      idleAction = decision.action;
      render();
      return;
    }
    if (pointerChanged) {
      render();
    }
  }

  return {
    controller,
    idleScheduler,
    pointerSensor,
    subscribed: runtime.subscribed,
    async dispose() {
      window.clearInterval(idleTimer);
      cancelPendingFirstPaintSync?.();
      pointerSensor?.dispose();
      runStreamSubscription?.close();
      petSettingsUnlisten?.();
      trayActionUnlisten?.();
      await runtime.dispose();
    }
  };

  function syncPetWindowMode(mode: DesktopPetWindowMode) {
    if (!petWindowBridge) {
      confirmedPetWindowMode = mode;
      return;
    }
    if (confirmedPetWindowMode === mode || syncingPetWindowMode === mode) {
      return;
    }
    if (failedPetWindowMode === mode && petWindowModeError) {
      return;
    }
    syncingPetWindowMode = mode;
    failedPetWindowMode = undefined;
    petWindowModeError = undefined;
    void Promise.resolve(petWindowBridge.setMode?.(mode))
      .then(() => {
        if (syncingPetWindowMode !== mode) {
          return;
        }
        confirmedPetWindowMode = mode;
        syncingPetWindowMode = undefined;
        failedPetWindowMode = undefined;
        petWindowModeError = undefined;
        render();
      })
      .catch((error: unknown) => {
        if (syncingPetWindowMode !== mode) {
          return;
        }
        syncingPetWindowMode = undefined;
        failedPetWindowMode = mode;
        petWindowModeError = actionMessage(error, locale);
      render();
    });
  }

  function syncPetWindowSettings(settings: DesktopPetWindowSettings) {
    const key = desktopPetWindowSettingsKey(settings);
    if (!petWindowBridge) {
      confirmedPetWindowSettingsKey = key;
      return;
    }
    if (confirmedPetWindowSettingsKey === key || syncingPetWindowSettingsKey === key || failedPetWindowSettingsKey === key) {
      return;
    }
    syncingPetWindowSettingsKey = key;
    failedPetWindowSettingsKey = undefined;
    void Promise.resolve(petWindowBridge.setSettings?.(settings))
      .then(() => {
        if (syncingPetWindowSettingsKey !== key) {
          return;
        }
        confirmedPetWindowSettingsKey = key;
        syncingPetWindowSettingsKey = undefined;
        failedPetWindowSettingsKey = undefined;
      })
      .catch(() => {
        if (syncingPetWindowSettingsKey !== key) {
          return;
        }
        syncingPetWindowSettingsKey = undefined;
        failedPetWindowSettingsKey = key;
      });
  }
}

function desktopPetWindowSettingsKey(settings: DesktopPetWindowSettings) {
  return `${settings.scale_percent}:${settings.opacity_percent}:${settings.pass_through ? "1" : "0"}:${settings.hide_on_hover ? "1" : "0"}`;
}

function desktopPetStructuralRenderKey(input: {
  // L#83：用卡片版本号+id 代表结构身份，不再每帧序列化整张卡片（热路径 4Hz）。
  card_revision: number;
  card_id?: string | undefined;
  status_text?: string | undefined;
  include_reject_reasons: boolean;
  pet_window_settings: DesktopPetWindowSettings;
  requested_model_pack_id?: string | undefined;
  compact_card: boolean;
  window_mode_error?: string | undefined;
  window_mode_status?: "syncing" | "failed" | undefined;
  locale: WorkHubLocale;
}) {
  return [
    input.card_revision,
    input.card_id ?? "",
    input.status_text ?? "",
    input.include_reject_reasons ? "1" : "0",
    desktopPetWindowSettingsKey(input.pet_window_settings),
    input.requested_model_pack_id ?? "",
    input.compact_card ? "1" : "0",
    input.window_mode_error ?? "",
    input.window_mode_status ?? "",
    input.locale
  ].join("|");
}

function desktopPetPointerStateEqual(a: DesktopPetPointerSnapshot, b: DesktopPetPointerSnapshot) {
  return a.cursor_near === b.cursor_near &&
    a.hovered === b.hovered &&
    a.dragging === b.dragging &&
    a.hover_avoidance === b.hover_avoidance &&
    formatPointerNumber(a.look_x) === formatPointerNumber(b.look_x) &&
    formatPointerNumber(a.look_y) === formatPointerNumber(b.look_y) &&
    formatPointerNumber(a.avoidance_x) === formatPointerNumber(b.avoidance_x) &&
    formatPointerNumber(a.avoidance_y) === formatPointerNumber(b.avoidance_y);
}

function formatPointerNumber(value: number) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.001) {
    return "0";
  }
  return String(Math.round(value * 1000) / 1000);
}

function renderDesktopPetBubble(input: {
  card?: CuuCard | undefined;
  status_text?: string | undefined;
  include_reject_reasons?: boolean | undefined;
  compact?: boolean | undefined;
  window_mode_error?: string | undefined;
}, locale: WorkHubLocale) {
  const card = input.card;
  const compact = Boolean(input.compact);
  const kind = card && !compact ? `<span class="wh-pet-kind">${escapeHtml(petCardKindLabel(card.kind, locale))}</span>` : "";
  const priority =
    card && !compact && card.priority !== "normal"
      ? `<span class="wh-pet-priority" data-priority="${escapeHtml(card.priority)}">${escapeHtml(petPriorityLabel(card.priority, locale))}</span>`
      : "";
  const chips = compact ? "" : (card?.chips ?? []).slice(0, 4).map((chip) => renderPetChip(chip, card)).join("");
  const actions = (card?.actions ?? []).slice(0, compact ? 1 : 3).map(renderPetAction).join("");
  const progress = !compact && card?.progress?.length ? renderPetProgress(card.progress) : "";
  const sections = !compact && card?.sections?.length ? renderPetSections(card.sections) : "";
  const evidence = !compact && card?.evidence_refs?.length ? renderPetEvidence(card.evidence_refs, locale) : "";
  const inputHint = !compact && card?.input ? renderPetInputHint(card.input, locale) : "";
  const context = [progress, sections, evidence, inputHint].filter(Boolean).join("");
  const suppressStatusForContext = shouldSuppressPetStatusForContext(card, compact, context);
  const reasons = !compact && input.include_reject_reasons ? renderRejectReasons(locale) : "";
  const payloadAttrs = card?.payload_ref
    ? ` data-pet-payload-ref-entity-type="${escapeHtml(card.payload_ref.entity_type)}" data-pet-payload-ref-entity-id="${escapeHtml(card.payload_ref.entity_id)}"${card.payload_ref.href ? ` data-pet-payload-ref-href="${escapeHtml(safeHref(card.payload_ref.href))}"` : ""}`
    : "";
  const transientAttrs = input.status_text && !card ? ` data-pet-bubble-transient="true"` : "";
  // R6.P3：5 情绪 + 3 气泡（cream 审批 / white 对话 / light-blue 检索），由协议态收敛而来。
  // L#82：离线整卡（非 compact）时精灵已重映射为 worried，气泡情绪也用同一有效态，避免"忧虑猫 + 待命气泡"不一致。
  const effectiveState = card && !compact && card.state === "offline" ? "worried" : card?.state;
  const emotion = effectiveState ? cuuEmotionForState(effectiveState) : undefined;
  const tone = effectiveState ? cuuBubbleKindForState(effectiveState) : undefined;
  const emotionAttrs = emotion && tone ? ` data-pet-bubble-emotion="${emotion}" data-pet-bubble-tone="${tone}"` : "";
  const emotionLabel = emotion && !compact ? `<span class="wh-pet-emotion">${escapeHtml(petEmotionLabel(emotion, locale))}</span>` : "";
  return `<aside class="wh-pet-bubble" data-pet-bubble="true"${transientAttrs} ${card ? `data-cuu-card-id="${escapeHtml(card.id)}"` : ""}${card ? ` data-pet-bubble-kind="${escapeHtml(card.kind)}" data-pet-bubble-priority="${escapeHtml(card.priority)}"` : ""}${emotionAttrs}${payloadAttrs}>
    <div class="wh-pet-kicker"><span class="wh-pet-dot" aria-hidden="true"></span><span>Cuu</span>${emotionLabel}${kind}${priority}</div>
    ${card ? `<strong class="wh-pet-title">${escapeHtml(card.title)}</strong>` : ""}
    ${card && !compact ? `<p class="wh-pet-message">${escapeHtml(card.message)}</p>` : ""}
    ${input.status_text && (!compact || !card) && !suppressStatusForContext ? `<p class="wh-pet-status">${escapeHtml(input.status_text)}</p>` : ""}
    ${input.window_mode_error && !actions ? `<p class="wh-pet-status">${escapeHtml(input.window_mode_error)}</p>` : ""}
    ${chips ? `<div class="wh-pet-chips">${chips}</div>` : ""}
    ${actions ? `<div class="wh-pet-actions">${actions}</div>` : ""}
    ${reasons}
    ${context ? `<div class="wh-pet-context" data-pet-context="true">${context}</div>` : ""}
  </aside>`;
}

function petCardHasContext(card: CuuCard) {
  return Boolean(card.sections?.length || card.progress?.length || card.input || card.evidence_refs?.length);
}

function shouldSuppressPetStatusForContext(card: CuuCard | undefined, compact: boolean, context: string) {
  return Boolean(
    card &&
    !compact &&
    context &&
    (card.kind === "budget" || (card.kind === "trace" && card.state === "worried"))
  );
}

function renderPetChip(chip: NonNullable<CuuCard["chips"]>[number], card?: CuuCard | undefined) {
  const text = chip.description ? `${chip.label} · ${chip.description}` : chip.label;
  const optionAttrs =
    card?.kind === "question" || card?.input
      ? ` data-pet-option-id="${escapeHtml(chip.id)}" data-pet-option-first="true"`
      : "";
  const attrs = `class="wh-pet-chip" data-chip-id="${escapeHtml(chip.id)}" data-tone="${escapeHtml(chip.tone ?? "neutral")}" data-recommended="${chip.recommended ? "true" : "false"}" data-selected="${chip.selected ? "true" : "false"}"${optionAttrs}${chip.href ? ` data-chip-href="${escapeHtml(safeHref(chip.href))}"` : ""}`;
  if (optionAttrs) {
    return `<button ${attrs} type="button" aria-pressed="${chip.selected ? "true" : "false"}">${escapeHtml(text)}</button>`;
  }
  return `<span ${attrs}>${escapeHtml(text)}</span>`;
}

function renderPetAction(action: CuuCard["actions"][number]) {
  if (!action.href) {
    return `<span class="wh-pet-action" data-tone="${escapeHtml(action.tone)}">${escapeHtml(action.label)}</span>`;
  }
  return `<a class="wh-pet-action" href="${escapeHtml(safeHref(action.href))}" data-cuu-action-id="${escapeHtml(action.id)}" data-tone="${escapeHtml(action.tone)}" data-method="${escapeHtml(action.method ?? "GET")}" data-requires-reason="${action.requires_reason ? "true" : "false"}">${escapeHtml(action.label)}</a>`;
}

function renderRejectReasons(locale: WorkHubLocale) {
  const reasons = [
    cuuT(locale, "pet.reject.evidence"),
    cuuT(locale, "pet.reject.scope"),
    cuuT(locale, "pet.reject.format")
  ];
  return `<div class="wh-pet-reasons">${reasons
    .map((reason) => `<button class="wh-pet-reason" type="button" data-pet-reason="${escapeHtml(reason)}">${escapeHtml(reason)}</button>`)
    .join("")}</div>`;
}

function renderPetProgress(steps: NonNullable<CuuCard["progress"]>) {
  const items = steps.slice(0, 4).map(
    (step) =>
      `<li class="wh-pet-progress-step" data-state="${escapeHtml(step.state)}" data-index="${escapeHtml(step.index)}" data-step-key="${escapeHtml(step.key)}"><span class="wh-pet-progress-dot" aria-hidden="true"></span><span class="wh-pet-progress-label">${escapeHtml(step.label)}</span></li>`
  );
  return `<ol class="wh-pet-progress">${items.join("")}</ol>`;
}

function renderPetSections(sections: NonNullable<CuuCard["sections"]>) {
  return sections
    .slice(0, 2)
    .map((section) => {
      const lines = section.lines
        .filter(Boolean)
        .slice(0, 2)
        .map((line) => `<span class="wh-pet-section-line">${escapeHtml(line)}</span>`)
        .join("");
      return `<div class="wh-pet-section" data-pet-section-id="${escapeHtml(section.id)}"><span class="wh-pet-section-title">${escapeHtml(section.title)}</span>${lines}</div>`;
    })
    .join("");
}

function renderPetEvidence(evidenceRefs: NonNullable<CuuCard["evidence_refs"]>, locale: WorkHubLocale) {
  const refs = evidenceRefs.slice(0, 2);
  const hiddenCount = evidenceRefs.length - refs.length;
  const items = refs
    .map((ref) => `<span class="wh-pet-evidence-item" data-evidence-ref-id="${escapeHtml(ref.id)}">${escapeHtml(evidenceLabel(ref))}</span>`)
    .join("");
  const suffix = hiddenCount > 0
    ? `<span class="wh-pet-evidence-item">${escapeHtml(cuuFormat(locale, "pet.evidenceMore", { count: hiddenCount }))}</span>`
    : "";
  return `<div class="wh-pet-evidence" data-pet-evidence-count="${escapeHtml(evidenceRefs.length)}"><span class="wh-pet-evidence-title">${escapeHtml(cuuT(locale, "pet.evidenceTitle"))}</span>${items}${suffix}</div>`;
}

function renderPetInputHint(input: NonNullable<CuuCard["input"]>, locale: WorkHubLocale) {
  const text = input.option_first
    ? input.free_text_enabled
      ? cuuT(locale, "pet.input.optionWithText")
      : cuuT(locale, "pet.input.optionOnly")
    : cuuT(locale, "pet.input.textNeeded");
  return `<div class="wh-pet-input-hint" data-pet-input-mode="${escapeHtml(input.mode)}" data-pet-option-first="${input.option_first ? "true" : "false"}" data-pet-free-text-collapsed="${input.free_text_collapsed_by_default ? "true" : "false"}">${escapeHtml(text)}</div>`;
}

function evidenceLabel(ref: NonNullable<CuuCard["evidence_refs"]>[number]) {
  const locator = ref.locator?.path ?? (ref.locator?.page ? `p.${ref.locator.page}` : ref.locator?.sheet ?? "");
  return locator ? `${ref.title} · ${locator}` : ref.title;
}

function petEmotionLabel(emotion: CuuEmotion, locale: WorkHubLocale) {
  switch (emotion) {
    case "idle":
      return cuuT(locale, "pet.emotion.idle");
    case "thinking":
      return cuuT(locale, "pet.emotion.thinking");
    case "approval":
      return cuuT(locale, "pet.emotion.approval");
    case "worried":
      return cuuT(locale, "pet.emotion.worried");
    case "celebrating":
      return cuuT(locale, "pet.emotion.celebrating");
  }
}

function petCardKindLabel(kind: CuuCard["kind"], locale: WorkHubLocale) {
  switch (kind) {
    case "question":
      return cuuT(locale, "pet.kind.question");
    case "approval":
      return cuuT(locale, "pet.kind.approval");
    case "proposal":
      return cuuT(locale, "pet.kind.proposal");
    case "evidence":
      return cuuT(locale, "pet.kind.evidence");
    case "budget":
      return cuuT(locale, "pet.kind.budget");
    case "sync":
      return cuuT(locale, "pet.kind.sync");
    case "trace":
      return cuuT(locale, "pet.kind.trace");
    case "completion":
      return cuuT(locale, "pet.kind.completion");
    case "offline":
      return cuuT(locale, "pet.kind.offline");
    case "bubble":
      return cuuT(locale, "pet.kind.bubble");
  }
}

function petPriorityLabel(priority: CuuCard["priority"], locale: WorkHubLocale) {
  switch (priority) {
    case "urgent":
      return cuuT(locale, "pet.priority.urgent");
    case "high":
      return cuuT(locale, "pet.priority.high");
    case "low":
      return cuuT(locale, "pet.priority.low");
    case "normal":
      return cuuT(locale, "pet.priority.normal");
  }
}

function clientToken() {
  return globalThis.localStorage?.getItem("workhub_client_token") ?? globalThis.localStorage?.getItem("yqgl_client_token") ?? undefined;
}

function agentRunIdFromPetCard(card: CuuCard | undefined) {
  return card?.payload_ref?.entity_type === "agent_run" ? card.payload_ref.entity_id : undefined;
}

function desktopPetAgentRunIsActive(run: AgentRunLiveVM) {
  return run.status === "queued" || run.status === "running";
}

function writeDesktopPetRestoreState(card: CuuCard | undefined) {
  try {
    const state = desktopPetRestoreStateFromCard(card);
    if (!state) {
      globalThis.localStorage?.removeItem(desktopPetRunRestoreStorageKey);
      return;
    }
    globalThis.localStorage?.setItem(desktopPetRunRestoreStorageKey, JSON.stringify(state));
  } catch {
    // localStorage may be disabled in privacy-mode webviews or test DOMs.
  }
}

function readDesktopPetRestoreState(): DesktopPetRestoreState | undefined {
  let raw: string | null | undefined;
  try {
    raw = globalThis.localStorage?.getItem(desktopPetRunRestoreStorageKey);
  } catch {
    return undefined;
  }
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<DesktopPetRestoreState> | undefined;
    if (!parsed || parsed.version !== 1 || typeof parsed.entity_id !== "string" || !parsed.entity_id) {
      return undefined;
    }
    if (parsed.entity_type === "agent_run") {
      return {
        version: 1,
        entity_type: "agent_run",
        entity_id: parsed.entity_id,
        href: typeof parsed.href === "string" ? parsed.href : undefined,
        updated_at_ms: typeof parsed.updated_at_ms === "number" ? parsed.updated_at_ms : Date.now()
      };
    }
    if (parsed.entity_type === "session" && isRestorableCuuSessionCard(parsed.card, parsed.entity_id)) {
      return {
        version: 1,
        entity_type: "session",
        entity_id: parsed.entity_id,
        href: typeof parsed.href === "string" ? parsed.href : undefined,
        card: parsed.card,
        updated_at_ms: typeof parsed.updated_at_ms === "number" ? parsed.updated_at_ms : Date.now()
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function desktopPetRestoreStateFromCard(card: CuuCard | undefined): DesktopPetRestoreState | undefined {
  const ref = card?.payload_ref;
  if (!ref) {
    return undefined;
  }
  if (ref.entity_type === "agent_run") {
    return {
      version: 1,
      entity_type: "agent_run",
      entity_id: ref.entity_id,
      href: ref.href,
      updated_at_ms: Date.now()
    };
  }
  if (ref.entity_type === "session") {
    return {
      version: 1,
      entity_type: "session",
      entity_id: ref.entity_id,
      href: ref.href,
      card,
      updated_at_ms: Date.now()
    };
  }
  return undefined;
}

function isRestorableCuuSessionCard(value: unknown, sessionId: string): value is CuuCard {
  if (!value || typeof value !== "object") {
    return false;
  }
  const card = value as Partial<CuuCard>;
  return typeof card.id === "string" &&
    typeof card.title === "string" &&
    typeof card.message === "string" &&
    Array.isArray(card.actions) &&
    card.payload_ref?.entity_type === "session" &&
    card.payload_ref.entity_id === sessionId;
}

function actionMessage(error: unknown, locale: WorkHubLocale) {
  return error instanceof Error ? error.message : cuuT(locale, "pet.actionFail");
}

function desktopPetQaScenarioStartsRunApiFlow(scenario: ReturnType<typeof desktopPetQaScenarioFromGlobal>) {
  return scenario === "run-stream" ||
    scenario === "run-failure" ||
    scenario === "permission-401" ||
    scenario === "permission-403" ||
    scenario === "generic-runtime-error" ||
    scenario === "stream-offline";
}

function desktopPetQaScenarioUsesRestoreSeed(scenario: ReturnType<typeof desktopPetQaScenarioFromGlobal>) {
  return scenario === "reload-session" ||
    scenario === "reload-active-run" ||
    scenario === "reload-terminal-run";
}

function desktopPetQaScenarioSkipsLocalRestore(scenario: ReturnType<typeof desktopPetQaScenarioFromGlobal>) {
  return Boolean(scenario) && !desktopPetQaScenarioUsesRestoreSeed(scenario);
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

// 外部/契约来源的 href 可能带 javascript:/data: → 点击即 XSS。只放行相对路径与 http(s)/mailto，其余拦成 "#"。
function safeHref(value: unknown): string {
  const v = String(value ?? "").trim();
  if (v.startsWith("/") || /^(?:https?:|mailto:)/iu.test(v)) {
    return v;
  }
  return "#";
}
