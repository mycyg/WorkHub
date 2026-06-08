import { createApiClient } from "@workhub/api-client/client";
import {
  createCuuController,
  createCuuIdleScheduler,
  cuuFormat,
  cuuMotionForState,
  cuuT,
  type CuuCard,
  type CuuController,
  type CuuIdleMicroAction,
  type CuuIdleScheduler,
  type CuuIdleSchedulerPolicy,
  type CuuLocaleOptions,
  type CuuMotionHint
} from "@workhub/cuu";
import { normalizeWorkHubLocale, workHubLocaleStorageKey, type WorkHubLocale } from "@workhub/contracts";

import {
  renderDesktopCuuCatLive2DForIdleAction,
  renderDesktopCuuCatLive2DForMotion,
  type DesktopCuuCatLive2DRender
} from "./cuu-cat-live2d-runtime.js";
import { loadCuuPreferences } from "./cuu-preferences.js";
import {
  bindDesktopShellCuuRuntime,
  resolveDesktopCuuAction,
  resolveDesktopShellListen,
  submitDesktopCuuAction,
  type DesktopCuuActionRequest,
  type DesktopShellListen
} from "./desktop-cuu-runtime.js";
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

export const desktopPetSurfaceCss = [
  "html,body,#root{margin:0;width:100%;height:100%;background:transparent;overflow:hidden}",
  "body{font-family:\"Aptos\",\"Segoe UI\",\"Microsoft YaHei\",\"PingFang SC\",\"Noto Sans CJK SC\",sans-serif;color:#222b38}",
  ".wh-pet-surface{position:relative;display:block;box-sizing:border-box;width:var(--wh-pet-window-w,180px);height:var(--wh-pet-window-h,220px);background:transparent;pointer-events:none;overflow:hidden;opacity:var(--wh-pet-opacity,1)}",
  ".wh-pet-surface[data-pet-window-mode=card]{width:var(--wh-pet-window-w,380px);height:var(--wh-pet-window-h,560px)}",
  ".wh-pet-body{position:absolute;right:calc(8px * var(--wh-pet-scale,1));bottom:calc(8px * var(--wh-pet-scale,1));width:calc(148px * var(--wh-pet-scale,1));height:calc(197px * var(--wh-pet-scale,1));display:flex;align-items:flex-end;justify-content:center;border:0;background:transparent;padding:0;margin:0;appearance:none;cursor:grab;pointer-events:auto;opacity:var(--wh-pet-hide-opacity,1);transform:translate(calc(var(--wh-pet-avoid-x-px,0px) + var(--wh-pet-hide-x-px,0px)),calc(var(--wh-pet-avoid-y-px,0px) + var(--wh-pet-hide-y-px,0px))) scale(var(--wh-pet-hide-scale,1));transition:transform 160ms ease-out,opacity 160ms ease-out}",
  ".wh-pet-body:active{cursor:grabbing}",
  ".wh-pet-surface[data-pet-hovered=true] .wh-pet-body{cursor:pointer}",
  ".wh-pet-surface[data-pet-dragging=true] .wh-pet-body{cursor:grabbing}",
  ".wh-pet-surface[data-pet-hover-avoidance=soft]:not([data-pet-dragging=true]) .wh-pet-body{transition-duration:120ms}",
  ".wh-pet-surface[data-pet-hover-hidden=true] .wh-pet-body{transition-duration:140ms}",
  ".wh-pet-bubble{position:absolute;right:132px;bottom:28px;box-sizing:border-box;width:min(250px,calc(100vw - 148px));display:grid;gap:8px;border:1px solid rgba(38,49,70,.14);border-radius:8px;background:rgba(255,255,255,.94);box-shadow:0 18px 42px rgba(30,39,58,.18);padding:10px 12px;pointer-events:auto;backdrop-filter:blur(10px)}",
  ".wh-pet-surface[data-pet-window-mode=card] .wh-pet-body{right:calc(64px * var(--wh-pet-scale,1));bottom:calc(96px * var(--wh-pet-scale,1));width:calc(150px * var(--wh-pet-scale,1));height:calc(210px * var(--wh-pet-scale,1))}",
  ".wh-pet-surface[data-pet-window-mode=card] .wh-pet-bubble{left:calc(16px * var(--wh-pet-scale,1));right:auto;top:calc(16px * var(--wh-pet-scale,1));bottom:auto;width:calc(260px * var(--wh-pet-scale,1));max-height:calc(320px * var(--wh-pet-scale,1));overflow:hidden;padding:12px 14px}",
  ".wh-pet-surface[data-pet-window-mode=card] .wh-pet-title{overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}",
  ".wh-pet-surface[data-pet-window-mode=card] .wh-pet-message{overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden}",
  ".wh-pet-surface[data-pet-card-has-context=true] .wh-pet-message{-webkit-line-clamp:3}",
  ".wh-pet-surface[data-pet-window-mode=card] .wh-pet-actions{max-width:100%}",
  ".wh-pet-surface[data-pet-card-layout=compact] .wh-pet-body{right:calc(4px * var(--wh-pet-scale,1));bottom:calc(4px * var(--wh-pet-scale,1));width:calc(118px * var(--wh-pet-scale,1));height:calc(157px * var(--wh-pet-scale,1))}",
  ".wh-pet-surface[data-pet-card-layout=compact] .wh-pet-bubble{left:calc(8px * var(--wh-pet-scale,1));right:auto;top:calc(8px * var(--wh-pet-scale,1));bottom:auto;width:calc(124px * var(--wh-pet-scale,1));max-height:calc(86px * var(--wh-pet-scale,1));overflow:hidden;gap:5px;padding:7px 8px}",
  ".wh-pet-surface[data-pet-card-layout=compact] .wh-pet-title{font-size:12px;line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}",
  ".wh-pet-surface[data-pet-card-layout=compact] .wh-pet-kicker,.wh-pet-surface[data-pet-card-layout=compact] .wh-pet-status{font-size:10px}",
  ".wh-pet-surface[data-pet-card-layout=compact] .wh-pet-action{font-size:11px;padding:5px 7px;max-width:112px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  ".wh-pet-kicker{display:flex;align-items:center;gap:7px;color:#667085;font-size:11px;font-weight:800;min-width:0}",
  ".wh-pet-dot{width:8px;height:8px;border-radius:999px;background:#ff9d58;box-shadow:0 0 0 3px rgba(255,157,88,.18)}",
  ".wh-pet-kind,.wh-pet-priority{border:1px solid rgba(38,49,70,.12);border-radius:8px;background:#fff;padding:3px 6px;color:#344054;font-size:10px;line-height:1;font-weight:850;white-space:nowrap}",
  ".wh-pet-priority[data-priority=urgent],.wh-pet-priority[data-priority=high]{background:#fff4f3;border-color:rgba(238,107,95,.28);color:#b42318}",
  ".wh-pet-title{font-size:14px;line-height:1.35;font-weight:850}",
  ".wh-pet-message{margin:0;color:#667085;font-size:12px;line-height:1.45;font-weight:650}",
  ".wh-pet-context{display:grid;gap:7px;min-width:0}",
  ".wh-pet-progress{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;margin:0;padding:0;list-style:none}",
  ".wh-pet-progress-step{display:grid;gap:3px;min-width:0;color:#98a2b3;font-size:9px;font-weight:850;line-height:1.15}",
  ".wh-pet-progress-dot{height:4px;border-radius:8px;background:rgba(152,162,179,.24)}",
  ".wh-pet-progress-step[data-state=done] .wh-pet-progress-dot,.wh-pet-progress-step[data-state=active] .wh-pet-progress-dot{background:#355cff}",
  ".wh-pet-progress-step[data-state=active]{color:#344054}",
  ".wh-pet-progress-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".wh-pet-section{display:grid;gap:3px;border-top:1px solid rgba(38,49,70,.1);padding-top:7px;min-width:0}",
  ".wh-pet-section-title,.wh-pet-evidence-title,.wh-pet-input-hint{color:#344054;font-size:11px;font-weight:900;line-height:1.2}",
  ".wh-pet-section-line,.wh-pet-evidence-item{color:#667085;font-size:11px;font-weight:700;line-height:1.35;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}",
  ".wh-pet-evidence{display:grid;gap:3px;border-top:1px solid rgba(38,49,70,.1);padding-top:7px;min-width:0}",
  ".wh-pet-input-hint{border-top:1px solid rgba(38,49,70,.1);padding-top:7px;color:#667085}",
  ".wh-pet-chips,.wh-pet-actions,.wh-pet-reasons{display:flex;gap:6px;flex-wrap:wrap;min-width:0}",
  ".wh-pet-chip,.wh-pet-action,.wh-pet-reason{border:1px solid rgba(38,49,70,.14);border-radius:8px;background:#fff;padding:6px 8px;color:#222b38;font:800 12px/1.2 \"Aptos\",\"Segoe UI\",\"Microsoft YaHei\",\"PingFang SC\",\"Noto Sans CJK SC\",sans-serif;text-decoration:none;max-width:100%;overflow-wrap:anywhere;appearance:none}",
  ".wh-pet-chip[data-pet-option-first=true]{cursor:pointer;text-align:left}",
  ".wh-pet-chip[data-tone=success]{background:#f0faf6;border-color:rgba(22,163,74,.2);color:#067647}",
  ".wh-pet-chip[data-tone=warning]{background:#fff7ed;border-color:rgba(245,158,11,.26);color:#a15c07}",
  ".wh-pet-chip[data-tone=danger]{background:#fff4f3;border-color:rgba(238,107,95,.34);color:#b42318}",
  ".wh-pet-chip[data-recommended=true]{border-color:rgba(53,92,255,.35);box-shadow:inset 3px 0 0 #355cff}",
  ".wh-pet-chip[data-selected=true]{background:#eef4ff;border-color:#355cff;color:#2444bf}",
  ".wh-pet-action[data-tone=primary],.wh-pet-reason{background:#355cff;border-color:#355cff;color:#fff}",
  ".wh-pet-action[data-tone=danger]{background:#fff4f3;border-color:rgba(238,107,95,.34);color:#b42318}",
  ".wh-pet-status{margin:0;color:#344054;font-size:12px;line-height:1.45;font-weight:750}"
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
  const compactCard = Boolean(input.card && input.window_mode_error);
  const windowMode = compactCard ? "body_only" : desktopPetWindowModeForCard(input.card);
  const settings = input.pet_window_settings ?? defaultDesktopPetWindowSettings();
  const pointer = normalizeDesktopPetPointerSnapshot(input.pointer_snapshot ?? defaultDesktopPetPointerSnapshot());
  const pointerSmoothingAlpha = input.pointer_smoothing_alpha ?? desktopPetPointerSmoothingAlpha;
  const scaleRatio = settings.scale_percent / 100;
  const hoverHidden = settings.hide_on_hover && pointer.hovered && !pointer.dragging && windowMode === "body_only" && !input.card;
  const hideX = hoverHidden ? (pointer.avoidance_x || -0.45) * 42 * scaleRatio : 0;
  const hideY = hoverHidden ? (pointer.avoidance_y || 0.24) * 24 * scaleRatio : 0;
  const baseWindowSize = petWindowSize(windowMode);
  const scaledWindowSize = {
    width: Math.round(baseWindowSize.width * scaleRatio),
    height: Math.round(baseWindowSize.height * scaleRatio)
  };
  const motion = desktopPetVisibleMotion(input.card?.motion ?? cuuMotionForState("idle"), {
    has_card: Boolean(input.card),
    compact_card: compactCard
  }, locale);
  const displayWidth = input.display_width_px ?? Math.round((compactCard ? 92 : input.card ? 138 : 148) * scaleRatio);
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
  const bubble = input.card || input.status_text || input.include_reject_reasons
    ? renderDesktopPetBubble({
        card: input.card,
        status_text: input.status_text,
        include_reject_reasons: input.include_reject_reasons,
        compact: compactCard,
        window_mode_error: input.window_mode_error
      }, locale)
    : "";
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
    `--wh-pet-avoid-x-px:${formatPointerNumber(pointer.avoidance_x * 22 * scaleRatio)}px`,
    `--wh-pet-avoid-y-px:${formatPointerNumber(pointer.avoidance_y * 12 * scaleRatio)}px`,
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
    html: `<section class="wh-pet-surface" style="${surfaceStyle}" data-wh-surface="pet" data-pet-window-mode="${windowMode}" data-pet-card-layout="${compactCard ? "compact" : input.card ? "full" : "body"}" data-pet-scale-percent="${settings.scale_percent}" data-pet-opacity-percent="${settings.opacity_percent}" data-pet-pass-through="${settings.pass_through ? "true" : "false"}" data-pet-hide-on-hover="${settings.hide_on_hover ? "true" : "false"}" data-pet-hover-hidden="${hoverHidden ? "true" : "false"}" data-pet-hover-hide-mode="${settings.hide_on_hover ? "soft" : "off"}" data-pet-window-width="${scaledWindowSize.width}" data-pet-window-height="${scaledWindowSize.height}" data-pet-cursor-near="${pointer.cursor_near ? "true" : "false"}" data-pet-hovered="${pointer.hovered ? "true" : "false"}" data-pet-dragging="${pointer.dragging ? "true" : "false"}" data-pet-look-x="${formatPointerNumber(pointer.look_x)}" data-pet-look-y="${formatPointerNumber(pointer.look_y)}" data-pet-hover-avoidance="${pointer.hover_avoidance}" data-pet-pointer-smoothing-alpha="${formatPointerNumber(pointerSmoothingAlpha)}"${pointer.last_pointer_ms !== undefined ? ` data-pet-last-pointer-ms="${escapeHtml(pointer.last_pointer_ms)}"` : ""}${cardAttrs}${input.window_mode_status ? ` data-pet-window-mode-status="${escapeHtml(input.window_mode_status)}"` : ""}${input.window_mode_error ? ` data-pet-window-mode-error="${escapeHtml(input.window_mode_error)}"` : ""} data-cuu-state="${escapeHtml(motion.state)}" data-cuu-idle-action="${escapeHtml(input.idle_action ?? "idle_breathe")}" data-cuu-visual-mode="${visualMode}" data-cuu-live2d-runtime="${escapeHtml(live2d.runtime_kind)}" data-cuu-live2d-status="${escapeHtml(live2d.status)}" data-cuu-live2d-model="${escapeHtml(live2d.model_key)}" data-cuu-live2d-appearance="${escapeHtml(live2d.appearance)}" data-cuu-live2d-motion="${escapeHtml(live2d.motion_state)}" data-cuu-live2d-layer-count="native_moc" data-cuu-live2d-frame-url="${escapeHtml(live2d.iframe_url)}" data-cuu-live2d-model-url="${escapeHtml(live2d.model_url)}" data-cuu-model-pack="${escapeHtml(live2d.model_pack_id)}" data-cuu-model-pack-selection-reason="${escapeHtml(live2d.model_pack_selection_reason)}">
      <button class="wh-pet-body" type="button" data-pet-drag-handle="true" aria-label="${escapeHtml(cuuT(locale, "pet.aria"))}">
        ${live2d.html}
      </button>
      ${bubble}
    </section>`
  };
}

export function desktopPetLocale(input?: unknown): WorkHubLocale {
  const target = globalThis as typeof globalThis & {
    localStorage?: Storage;
    navigator?: Navigator;
  };
  return normalizeWorkHubLocale(input ?? target.localStorage?.getItem(workHubLocaleStorageKey) ?? target.navigator?.language);
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

function petWindowSize(mode: DesktopPetWindowMode) {
  return mode === "card"
    ? { width: 380, height: 560 }
    : { width: 180, height: 220 };
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

export async function bootDesktopPetSurface(
  root: HTMLElement,
  input: {
    listen?: DesktopShellListen | undefined;
    controller?: CuuController | undefined;
    idleScheduler?: CuuIdleScheduler | undefined;
    petWindowBridge?: DesktopPetWindowBridge | undefined;
  } = {}
): Promise<DesktopPetSurfaceRuntime> {
  const locale = desktopPetLocale();
  const controller = input.controller ?? createCuuController({ preferences: loadCuuPreferences() });
  const idleScheduler = input.idleScheduler ?? createDesktopPetIdleScheduler(Date.now());
  const petWindowBridge = input.petWindowBridge ?? resolveDesktopPetWindowBridge();
  const client = createApiClient({
    baseUrl: "",
    getClientToken: clientToken
  });
  let currentCard: CuuCard | undefined;
  let idleAction: CuuIdleMicroAction = input.idleScheduler
    ? idleScheduler.snapshot().last_action ?? "idle_breathe"
    : desktopPetInitialIdleAction;
  let statusText: string | undefined;
  let pendingAction: DesktopCuuActionRequest | undefined;
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

  const render = () => {
    renderGeneration += 1;
    const generation = renderGeneration;
    const petWindowSettings = desktopPetWindowSettingsFromPreferences(controller.snapshot().preferences);
    const desiredMode = desktopPetWindowModeForCard(currentCard);
    const compactCard = Boolean(currentCard && petWindowBridge && desiredMode === "card" && confirmedPetWindowMode !== "card");
    const surface = renderDesktopPetSurface({
      card: currentCard,
      idle_action: idleAction,
      status_text: statusText,
      include_reject_reasons: Boolean(pendingAction),
      pet_window_settings: petWindowSettings,
      requested_model_pack_id: controller.snapshot().preferences.pet_model_pack_id,
      pointer_snapshot: pointerSnapshot,
      window_mode_error: compactCard ? petWindowModeError ?? cuuT(locale, "pet.windowModeExpanding") : undefined,
      window_mode_status: compactCard ? petWindowModeError ? "failed" : "syncing" : undefined,
      locale
    });
    root.innerHTML = `<style>${surface.css}</style>${surface.html}`;
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

  const setCard = (card: CuuCard | undefined, status?: string) => {
    if (card) {
      idleScheduler.observeWorkEvent(Date.now());
    }
    currentCard = card;
    statusText = status;
    pendingAction = undefined;
    render();
  };

  render();

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
      } catch (error) {
        statusText = actionMessage(error, locale);
        render();
      }
      return;
    }

    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
    const petBody = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-pet-drag-handle]") : null;
    if (petBody && !anchor) {
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
    if (anchor.dataset.cuuActionId === "submit_option" && currentCard?.input && (currentCard.chips?.length ?? 0) > 0) {
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
    } catch (error) {
      statusText = actionMessage(error, locale);
      render();
    }
  });

  const runtime = await bindDesktopShellCuuRuntime({
    listen: input.listen ?? resolveDesktopShellListen(),
    controller,
    notify(notice) {
      setCard(notice.card);
    },
    locale
  });
  let samplingCursor = false;
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
  const reasons = !compact && input.include_reject_reasons ? renderRejectReasons(locale) : "";
  return `<aside class="wh-pet-bubble" data-pet-bubble="true" ${card ? `data-cuu-card-id="${escapeHtml(card.id)}"` : ""}${card ? ` data-pet-bubble-kind="${escapeHtml(card.kind)}" data-pet-bubble-priority="${escapeHtml(card.priority)}"` : ""}>
    <div class="wh-pet-kicker"><span class="wh-pet-dot" aria-hidden="true"></span><span>Cuu</span>${kind}${priority}</div>
    ${card ? `<strong class="wh-pet-title">${escapeHtml(card.title)}</strong>` : ""}
    ${card && !compact ? `<p class="wh-pet-message">${escapeHtml(card.message)}</p>` : ""}
    ${input.status_text && !compact ? `<p class="wh-pet-status">${escapeHtml(input.status_text)}</p>` : ""}
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

function renderPetChip(chip: NonNullable<CuuCard["chips"]>[number], card?: CuuCard | undefined) {
  const text = chip.description ? `${chip.label} · ${chip.description}` : chip.label;
  const optionAttrs =
    card?.kind === "question" || card?.input
      ? ` data-pet-option-id="${escapeHtml(chip.id)}" data-pet-option-first="true"`
      : "";
  const attrs = `class="wh-pet-chip" data-chip-id="${escapeHtml(chip.id)}" data-tone="${escapeHtml(chip.tone ?? "neutral")}" data-recommended="${chip.recommended ? "true" : "false"}" data-selected="${chip.selected ? "true" : "false"}"${optionAttrs}${chip.href ? ` data-chip-href="${escapeHtml(chip.href)}"` : ""}`;
  if (optionAttrs) {
    return `<button ${attrs} type="button" aria-pressed="${chip.selected ? "true" : "false"}">${escapeHtml(text)}</button>`;
  }
  return `<span ${attrs}>${escapeHtml(text)}</span>`;
}

function renderPetAction(action: CuuCard["actions"][number]) {
  if (!action.href) {
    return `<span class="wh-pet-action" data-tone="${escapeHtml(action.tone)}">${escapeHtml(action.label)}</span>`;
  }
  return `<a class="wh-pet-action" href="${escapeHtml(action.href)}" data-cuu-action-id="${escapeHtml(action.id)}" data-tone="${escapeHtml(action.tone)}" data-method="${escapeHtml(action.method ?? "GET")}" data-requires-reason="${action.requires_reason ? "true" : "false"}">${escapeHtml(action.label)}</a>`;
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

function actionMessage(error: unknown, locale: WorkHubLocale) {
  return error instanceof Error ? error.message : cuuT(locale, "pet.actionFail");
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}
