import { createApiClient } from "@workhub/api-client/client";
import {
  createCuuController,
  createCuuIdleScheduler,
  cuuMotionForState,
  type CuuCard,
  type CuuController,
  type CuuIdleMicroAction,
  type CuuIdleScheduler
} from "@workhub/cuu";

import { desktopCuuP1AtlasManifest, desktopCuuP1AtlasManifestUrl } from "./cuu-atlas-assets.js";
import {
  renderDesktopCuuAtlasSprite,
  renderDesktopCuuAtlasState,
  type DesktopCuuAtlasRender
} from "./cuu-atlas-runtime.js";
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
  ".wh-pet-surface{position:fixed;inset:0;display:grid;place-items:end end;box-sizing:border-box;padding:8px;background:transparent;pointer-events:none}",
  ".wh-pet-body{display:grid;place-items:end center;border:0;background:transparent;padding:0;margin:0;cursor:grab;pointer-events:auto}",
  ".wh-pet-body:active{cursor:grabbing}",
  ".wh-pet-bubble{position:absolute;right:132px;bottom:28px;width:min(250px,calc(100vw - 148px));display:grid;gap:8px;border:1px solid rgba(38,49,70,.14);border-radius:8px;background:rgba(255,255,255,.94);box-shadow:0 18px 42px rgba(30,39,58,.18);padding:10px 12px;pointer-events:auto;backdrop-filter:blur(10px)}",
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

export function resolveDesktopSurface(input: { pathname?: string; search?: string } = {}): DesktopSurface {
  const target = globalThis as typeof globalThis & { location?: Location };
  const pathname = input.pathname ?? target.location?.pathname ?? "/";
  const search = input.search ?? target.location?.search ?? "";
  const surface = new URLSearchParams(search).get("surface");
  return surface === "pet" || pathname === "/pet" ? "pet" : "main";
}

export function renderDesktopPetSurface(input: {
  card?: CuuCard | undefined;
  idle_action?: CuuIdleMicroAction | undefined;
  status_text?: string | undefined;
  include_reject_reasons?: boolean | undefined;
  display_width_px?: number | undefined;
} = {}): DesktopPetSurfaceRender {
  const motion = input.card?.motion ?? cuuMotionForState("idle");
  const sprite = input.card
    ? renderDesktopCuuAtlasSprite(motion, desktopCuuP1AtlasManifest, {
        display_width_px: input.display_width_px ?? 118
      })
    : renderDesktopCuuAtlasState(input.idle_action ?? "idle_breathe", desktopCuuP1AtlasManifest, {
        display_width_px: input.display_width_px ?? 148
      });
  const bubble = input.card || input.status_text || input.include_reject_reasons
    ? renderDesktopPetBubble({
        card: input.card,
        status_text: input.status_text,
        include_reject_reasons: input.include_reject_reasons
      })
    : "";

  return {
    sprite,
    css: `${desktopPetSurfaceCss}${sprite.css}`,
    html: `<section class="wh-pet-surface" data-wh-surface="pet" data-pet-window-mode="${desktopPetWindowModeForCard(input.card)}" data-cuu-state="${escapeHtml(motion.state)}" data-cuu-idle-action="${escapeHtml(input.idle_action ?? "idle_breathe")}" data-cuu-atlas-fallback="${sprite.fallback ? "true" : "false"}" data-cuu-manifest-url="${escapeHtml(desktopCuuP1AtlasManifestUrl)}">
      <button class="wh-pet-body" type="button" data-pet-drag-handle="true" aria-label="Cuu 桌宠">
        ${sprite.html}
      </button>
      ${bubble}
    </section>`
  };
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
  const idleScheduler = input.idleScheduler ?? createCuuIdleScheduler({ now_ms: Date.now() });
  const petWindowBridge = input.petWindowBridge ?? resolveDesktopPetWindowBridge();
  const client = createApiClient({
    baseUrl: "",
    getClientToken: clientToken
  });
  let currentCard: CuuCard | undefined;
  let idleAction: CuuIdleMicroAction = idleScheduler.snapshot().last_action ?? "idle_breathe";
  let statusText: string | undefined;
  let pendingAction: DesktopCuuActionRequest | undefined;
  let currentPetWindowMode: DesktopPetWindowMode | undefined;

  const render = () => {
    const surface = renderDesktopPetSurface({
      card: currentCard,
      idle_action: idleAction,
      status_text: statusText,
      include_reject_reasons: Boolean(pendingAction)
    });
    root.innerHTML = `<style>${surface.css}</style>${surface.html}`;
    syncPetWindowMode(desktopPetWindowModeForCard(currentCard));
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
      pointerSensor.dispose();
      await runtime.dispose();
    }
  };

  function syncPetWindowMode(mode: DesktopPetWindowMode) {
    if (currentPetWindowMode === mode) {
      return;
    }
    currentPetWindowMode = mode;
    void petWindowBridge?.setMode?.(mode);
  }
}

function renderDesktopPetBubble(input: {
  card?: CuuCard | undefined;
  status_text?: string | undefined;
  include_reject_reasons?: boolean | undefined;
}) {
  const card = input.card;
  const chips = (card?.chips ?? []).slice(0, 3).map(renderPetChip).join("");
  const actions = (card?.actions ?? []).slice(0, 3).map(renderPetAction).join("");
  const reasons = input.include_reject_reasons ? renderRejectReasons() : "";
  return `<aside class="wh-pet-bubble" data-pet-bubble="true" ${card ? `data-cuu-card-id="${escapeHtml(card.id)}"` : ""}>
    <div class="wh-pet-kicker"><span class="wh-pet-dot" aria-hidden="true"></span><span>Cuu</span></div>
    ${card ? `<strong class="wh-pet-title">${escapeHtml(card.title)}</strong>` : ""}
    ${card ? `<p class="wh-pet-message">${escapeHtml(card.message)}</p>` : ""}
    ${input.status_text ? `<p class="wh-pet-status">${escapeHtml(input.status_text)}</p>` : ""}
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
