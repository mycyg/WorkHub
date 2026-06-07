import { createApiClient } from "@workhub/api-client/client";
import {
  createCuuController,
  createCuuIdleScheduler,
  cuuMotionForState,
  type CuuCard,
  type CuuController,
  type CuuIdleMicroAction,
  type CuuIdleScheduler,
  type CuuIdleSchedulerPolicy,
  type CuuMotionHint
} from "@workhub/cuu";

import { desktopCuuP1AtlasManifest, desktopCuuP1AtlasManifestUrl, desktopCuuP1ClipSheetImages } from "./cuu-atlas-assets.js";
import {
  renderDesktopCuuAtlasSprite,
  renderDesktopCuuAtlasState,
  type DesktopCuuAtlasRender
} from "./cuu-atlas-runtime.js";
import {
  renderDesktopCuuBongoForIdleAction,
  renderDesktopCuuBongoForMotion,
  type DesktopCuuBongoRender
} from "./cuu-bongo-runtime.js";
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
  desktopPetWindowModeForCard,
  resolveDesktopPetWindowBridge,
  type DesktopPetPointerSensor,
  type DesktopPetWindowBridge,
  type DesktopPetWindowMode
} from "./pet-window-bridge.js";

export type DesktopSurface = "main" | "pet";

export type DesktopPetSurfaceRender = {
  html: string;
  css: string;
  sprite: DesktopCuuAtlasRender;
  bongo: DesktopCuuBongoRender;
  visual_mode: "bongo_cuu" | "live2d_psd_draft" | "live2d_prototype" | "sprite_atlas";
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
  "body{font-family:\"Aptos\",\"Segoe UI\",sans-serif;color:#222b38}",
  ".wh-pet-surface{position:relative;display:block;box-sizing:border-box;width:180px;height:220px;background:transparent;pointer-events:none;overflow:hidden}",
  ".wh-pet-surface[data-pet-window-mode=card]{width:380px;height:560px}",
  ".wh-pet-body{position:absolute;right:8px;bottom:8px;width:148px;height:197px;display:flex;align-items:flex-end;justify-content:center;border:0;background:transparent;padding:0;margin:0;appearance:none;cursor:grab;pointer-events:auto}",
  ".wh-pet-body:active{cursor:grabbing}",
  ".wh-pet-bubble{position:absolute;right:132px;bottom:28px;box-sizing:border-box;width:min(250px,calc(100vw - 148px));display:grid;gap:8px;border:1px solid rgba(38,49,70,.14);border-radius:8px;background:rgba(255,255,255,.94);box-shadow:0 18px 42px rgba(30,39,58,.18);padding:10px 12px;pointer-events:auto;backdrop-filter:blur(10px)}",
  ".wh-pet-surface[data-pet-window-mode=card] .wh-pet-body{right:64px;bottom:96px;width:150px;height:210px}",
  ".wh-pet-surface[data-pet-window-mode=card] .wh-pet-bubble{left:16px;right:auto;top:16px;bottom:auto;width:260px;max-height:320px;overflow:hidden;padding:12px 14px}",
  ".wh-pet-surface[data-pet-window-mode=card] .wh-pet-title{overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}",
  ".wh-pet-surface[data-pet-window-mode=card] .wh-pet-message{overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden}",
  ".wh-pet-surface[data-pet-window-mode=card] .wh-pet-actions{max-width:100%}",
  ".wh-pet-surface[data-pet-card-layout=compact] .wh-pet-body{right:4px;bottom:4px;width:118px;height:157px}",
  ".wh-pet-surface[data-pet-card-layout=compact] .wh-pet-bubble{left:8px;right:auto;top:8px;bottom:auto;width:124px;max-height:86px;overflow:hidden;gap:5px;padding:7px 8px}",
  ".wh-pet-surface[data-pet-card-layout=compact] .wh-pet-title{font-size:12px;line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}",
  ".wh-pet-surface[data-pet-card-layout=compact] .wh-pet-kicker,.wh-pet-surface[data-pet-card-layout=compact] .wh-pet-status{font-size:10px}",
  ".wh-pet-surface[data-pet-card-layout=compact] .wh-pet-action{font-size:11px;padding:5px 7px;max-width:112px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  ".wh-pet-kicker{display:flex;align-items:center;gap:7px;color:#667085;font-size:11px;font-weight:800}",
  ".wh-pet-dot{width:8px;height:8px;border-radius:999px;background:#ff9d58;box-shadow:0 0 0 3px rgba(255,157,88,.18)}",
  ".wh-pet-title{font-size:14px;line-height:1.35;font-weight:850}",
  ".wh-pet-message{margin:0;color:#667085;font-size:12px;line-height:1.45;font-weight:650}",
  ".wh-pet-chips,.wh-pet-actions,.wh-pet-reasons{display:flex;gap:6px;flex-wrap:wrap}",
  ".wh-pet-chip,.wh-pet-action,.wh-pet-reason{border:1px solid rgba(38,49,70,.14);border-radius:8px;background:#fff;padding:6px 8px;color:#222b38;font:800 12px/1.2 \"Aptos\",\"Segoe UI\",sans-serif;text-decoration:none}",
  ".wh-pet-action[data-tone=primary],.wh-pet-reason{background:#355cff;border-color:#355cff;color:#fff}",
  ".wh-pet-action[data-tone=danger]{background:#fff4f3;border-color:rgba(238,107,95,.34);color:#b42318}",
  ".wh-pet-status{margin:0;color:#344054;font-size:12px;line-height:1.45;font-weight:750}"
].join("");

export const desktopPetInitialIdleAction: CuuIdleMicroAction = "idle_tail_sway";

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
  window_mode_error?: string | undefined;
  window_mode_status?: "syncing" | "failed" | undefined;
} = {}): DesktopPetSurfaceRender {
  const compactCard = Boolean(input.card && input.window_mode_error);
  const windowMode = compactCard ? "body_only" : desktopPetWindowModeForCard(input.card);
  const motion = desktopPetVisibleMotion(input.card?.motion ?? cuuMotionForState("idle"), {
    has_card: Boolean(input.card),
    compact_card: compactCard
  });
  const displayWidth = input.display_width_px ?? (compactCard ? 92 : input.card ? 138 : 148);
  const sprite = input.card
    ? renderDesktopCuuAtlasSprite(motion, desktopCuuP1AtlasManifest, {
        display_width_px: displayWidth,
        clip_images: desktopCuuP1ClipSheetImages,
        prefer_background_clip_sheet: true
      })
    : renderDesktopCuuAtlasState(input.idle_action ?? "idle_breathe", desktopCuuP1AtlasManifest, {
        display_width_px: displayWidth,
        clip_images: desktopCuuP1ClipSheetImages,
        prefer_background_clip_sheet: true
      });
  const bongo = input.card
    ? renderDesktopCuuBongoForMotion(motion, { display_width_px: displayWidth })
    : renderDesktopCuuBongoForIdleAction(input.idle_action ?? "idle_breathe", { display_width_px: displayWidth });
  const visualMode = "bongo_cuu";
  const bubble = input.card || input.status_text || input.include_reject_reasons
    ? renderDesktopPetBubble({
        card: input.card,
        status_text: input.status_text,
        include_reject_reasons: input.include_reject_reasons,
        compact: compactCard,
        window_mode_error: input.window_mode_error
      })
    : "";

  return {
    sprite,
    bongo,
    visual_mode: visualMode,
    css: `${desktopPetSurfaceCss}${bongo.css}${sprite.css}`,
    html: `<section class="wh-pet-surface" data-wh-surface="pet" data-pet-window-mode="${windowMode}" data-pet-card-layout="${compactCard ? "compact" : input.card ? "full" : "body"}"${input.window_mode_status ? ` data-pet-window-mode-status="${escapeHtml(input.window_mode_status)}"` : ""}${input.window_mode_error ? ` data-pet-window-mode-error="${escapeHtml(input.window_mode_error)}"` : ""} data-cuu-state="${escapeHtml(motion.state)}" data-cuu-idle-action="${escapeHtml(input.idle_action ?? "idle_breathe")}" data-cuu-visual-mode="${visualMode}" data-cuu-bongo-status="${escapeHtml(bongo.status)}" data-cuu-bongo-motion="${escapeHtml(bongo.motion_state)}" data-cuu-bongo-component-count="${escapeHtml(bongo.component_count)}" data-cuu-live2d-status="experiment_hidden" data-cuu-live2d-motion="" data-cuu-live2d-layer-count="0" data-cuu-atlas-fallback="${sprite.fallback ? "true" : "false"}" data-cuu-manifest-url="${escapeHtml(desktopCuuP1AtlasManifestUrl)}">
      <button class="wh-pet-body" type="button" data-pet-drag-handle="true" aria-label="Cuu 桌宠">
        ${bongo.html}
      </button>
      ${bubble}
    </section>`
  };
}

function desktopPetVisibleMotion(motion: CuuMotionHint, input: { has_card: boolean; compact_card: boolean }): CuuMotionHint {
  if (input.has_card && !input.compact_card && motion.sprite_state === "offline_sleep") {
    return {
      ...motion,
      sprite_state: "worried_ears",
      emphasis: "urgent",
      loop: true,
      reduced_motion_fallback: "Cuu 遇到连接问题，正在提醒你。"
    };
  }
  return motion;
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
  let renderGeneration = 0;
  let cancelPendingFirstPaintSync: (() => void) | undefined;

  const render = () => {
    renderGeneration += 1;
    const generation = renderGeneration;
    const desiredMode = desktopPetWindowModeForCard(currentCard);
    const compactCard = Boolean(currentCard && petWindowBridge && desiredMode === "card" && confirmedPetWindowMode !== "card");
    const surface = renderDesktopPetSurface({
      card: currentCard,
      idle_action: idleAction,
      status_text: statusText,
      include_reject_reasons: Boolean(pendingAction),
      window_mode_error: compactCard ? petWindowModeError ?? "Cuu 轻卡窗口正在展开。" : undefined,
      window_mode_status: compactCard ? petWindowModeError ? "failed" : "syncing" : undefined
    });
    root.innerHTML = `<style>${surface.css}</style>${surface.html}`;
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

  const pointerSensor = createDesktopPetPointerSensor(root, {
    bridge: petWindowBridge,
    onInteraction(interaction, nowMs) {
      if (currentCard || controller.snapshot().preferences.reduced_motion) {
        return;
      }
      const decision = idleScheduler.observeInteraction(interaction, nowMs);
      if (decision.action) {
        idleAction = decision.action;
        render();
      }
    }
  });

  root.addEventListener("click", async (event) => {
    const reasonButton = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-pet-reason]") : null;
    if (reasonButton && pendingAction) {
      try {
        const result = await submitDesktopCuuAction({
          client,
          action: pendingAction,
          reasonMd: reasonButton.dataset.petReason ?? "需要调整"
        });
        setCard(result.card ?? currentCard, result.message);
      } catch (error) {
        statusText = actionMessage(error);
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
      statusText = "先点一个原因，Cuu 会带着它继续改。";
      render();
      return;
    }
    try {
      const result = await submitDesktopCuuAction({ client, action });
      setCard(result.card ?? currentCard, result.message);
    } catch (error) {
      statusText = actionMessage(error);
      render();
    }
  });

  const runtime = await bindDesktopShellCuuRuntime({
    listen: input.listen ?? resolveDesktopShellListen(),
    controller,
    notify(notice) {
      setCard(notice.card);
    }
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
  }, 1000);

  async function tickIdle() {
    const pointer = pointerSensor.snapshot();
    const sampledCursorNear = await Promise.resolve(petWindowBridge?.sampleCursorNear?.()).catch(() => undefined);
    const decision = idleScheduler.tick({
      now_ms: Date.now(),
      active_card: Boolean(currentCard),
      cursor_near: sampledCursorNear ?? pointer.cursor_near,
      reduced_motion: controller.snapshot().preferences.reduced_motion
    });
    if (decision.action) {
      idleAction = decision.action;
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
      pointerSensor.dispose();
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
        petWindowModeError = actionMessage(error);
        render();
      });
  }
}

function renderDesktopPetBubble(input: {
  card?: CuuCard | undefined;
  status_text?: string | undefined;
  include_reject_reasons?: boolean | undefined;
  compact?: boolean | undefined;
  window_mode_error?: string | undefined;
}) {
  const card = input.card;
  const compact = Boolean(input.compact);
  const chips = compact ? "" : (card?.chips ?? []).slice(0, 3).map(renderPetChip).join("");
  const actions = (card?.actions ?? []).slice(0, compact ? 1 : 3).map(renderPetAction).join("");
  const reasons = !compact && input.include_reject_reasons ? renderRejectReasons() : "";
  return `<aside class="wh-pet-bubble" data-pet-bubble="true" ${card ? `data-cuu-card-id="${escapeHtml(card.id)}"` : ""}>
    <div class="wh-pet-kicker"><span class="wh-pet-dot" aria-hidden="true"></span><span>Cuu</span></div>
    ${card ? `<strong class="wh-pet-title">${escapeHtml(card.title)}</strong>` : ""}
    ${card && !compact ? `<p class="wh-pet-message">${escapeHtml(card.message)}</p>` : ""}
    ${input.status_text && !compact ? `<p class="wh-pet-status">${escapeHtml(input.status_text)}</p>` : ""}
    ${input.window_mode_error && !actions ? `<p class="wh-pet-status">${escapeHtml(input.window_mode_error)}</p>` : ""}
    ${chips ? `<div class="wh-pet-chips">${chips}</div>` : ""}
    ${actions ? `<div class="wh-pet-actions">${actions}</div>` : ""}
    ${reasons}
  </aside>`;
}

function renderPetChip(chip: NonNullable<CuuCard["chips"]>[number]) {
  return `<span class="wh-pet-chip" data-chip-id="${escapeHtml(chip.id)}">${escapeHtml(chip.label)}</span>`;
}

function renderPetAction(action: CuuCard["actions"][number]) {
  if (!action.href) {
    return `<span class="wh-pet-action" data-tone="${escapeHtml(action.tone)}">${escapeHtml(action.label)}</span>`;
  }
  return `<a class="wh-pet-action" href="${escapeHtml(action.href)}" data-cuu-action-id="${escapeHtml(action.id)}" data-tone="${escapeHtml(action.tone)}" data-method="${escapeHtml(action.method ?? "GET")}" data-requires-reason="${action.requires_reason ? "true" : "false"}">${escapeHtml(action.label)}</a>`;
}

function renderRejectReasons() {
  return '<div class="wh-pet-reasons"><button class="wh-pet-reason" type="button" data-pet-reason="证据不足">证据不足</button><button class="wh-pet-reason" type="button" data-pet-reason="范围太大">范围太大</button><button class="wh-pet-reason" type="button" data-pet-reason="交付格式要改">交付格式要改</button></div>';
}

function clientToken() {
  return globalThis.localStorage?.getItem("workhub_client_token") ?? globalThis.localStorage?.getItem("yqgl_client_token") ?? undefined;
}

function actionMessage(error: unknown) {
  return error instanceof Error ? error.message : "动作提交失败，请稍后再试。";
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}
