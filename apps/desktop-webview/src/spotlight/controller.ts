// WorkHub 桌面 · Spotlight 控制器：把一个会生长的玻璃盒挂进主窗，就是整个 app。
// launcher（能力网格/搜索）↔ capability（能力内联页）在同一个盒子里 morph；选能力只切状态、不碰 hash。
// 每次渲染后测量内容高度 → 通过 resize 回调缩放原生窗口（盒子随内容生长/收缩，苹果聚焦风）。

import { escapeHtml } from "@workhub/web-runtime";
import type { WorkHubLocale } from "@workhub/ui/gold-path";

import { commandRegistry, type CommandId, type CommandMatch } from "../command-palette.js";
import { resolveCapabilityView } from "./registry.js";
import {
  initialSpotlightState,
  launcherMatches,
  openCapabilityId,
  spotlightReducer,
  topMatchId,
  type SpotlightState
} from "./state.js";
import type { SpotlightApiClient, SpotlightViewContext } from "./view-context.js";

export type SpotlightResizeFn = (width: number, height: number) => void;

export type MountSpotlightInput = {
  host: HTMLElement;
  client: SpotlightApiClient;
  locale: WorkHubLocale;
  // 角标（如 approvals: 待办数）。可后续更新。
  badges?: Partial<Record<CommandId, number>>;
  // 缩放原生窗口（browser.ts 注入 → invoke set_spotlight_size）。浏览器开发态可为空（no-op）。
  resize?: SpotlightResizeFn;
};

export type SpotlightHandle = {
  // 外部（如 Cuu 决策信箱点击）请求打开某能力。
  openCapability: (id: CommandId) => void;
  // 回到 launcher。
  reset: () => void;
  // 更新角标并（若在 launcher）刷新网格。
  setBadges: (badges: Partial<Record<CommandId, number>>) => void;
};

const SEARCH_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.3-4.3"/></svg>';
const BACK_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>';

function renderLauncherGrid(
  matches: CommandMatch[],
  locale: WorkHubLocale,
  badges: Partial<Record<CommandId, number>>
): string {
  const zh = locale === "zh-CN";
  if (matches.length === 0) {
    return `<div class="wh-spot-grid"><div class="wh-spot-empty-grid">${zh ? "没有匹配的能力，换个说法试试" : "No matching capability — try another phrase"}</div></div>`;
  }
  const loc = zh ? "zh-CN" : "en";
  const cards = matches
    .map(({ command }, index) => {
      const badge = badges[command.id];
      const badgeHtml = typeof badge === "number" && badge > 0 ? `<span class="wh-spot-cap-badge">${badge}</span>` : "";
      return `<button type="button" class="wh-spot-cap" data-spot-cap="${command.id}" data-active="${index === 0 ? "true" : "false"}">
        <span class="wh-spot-cap-icon">${command.icon}</span>
        <span class="wh-spot-cap-text">
          <span class="wh-spot-cap-label">${escapeHtml(command.label[loc])}</span>
          <span class="wh-spot-cap-hint">${escapeHtml(command.hint[loc])}</span>
        </span>
        ${badgeHtml}
      </button>`;
    })
    .join("");
  return `<div class="wh-spot-grid ds-stagger">${cards}</div>`;
}

export function mountSpotlight(input: MountSpotlightInput): SpotlightHandle {
  const { host, client, locale } = input;
  const doc = host.ownerDocument ?? document;
  const zh = locale === "zh-CN";
  let badges: Partial<Record<CommandId, number>> = { ...(input.badges ?? {}) };
  let state: SpotlightState = initialSpotlightState();
  let disposeView: (() => void) | undefined;

  const placeholder = zh ? "想做什么？派活 / 审批 / 网盘 / 项目…" : "What do you need? dispatch / approve / drive…";
  host.className = "wh-ds wh-spot-stage";
  host.innerHTML = `
    <div class="wh-spot ds-glass-strong ds-anim-spring-in" data-spot-box data-mode="launcher">
      <div class="wh-spot-top">
        <button type="button" class="wh-spot-back" data-spot-back aria-label="${zh ? "返回" : "Back"}">${BACK_ICON}</button>
        <div class="wh-spot-field-wrap">
          <span class="wh-spot-field-icon">${SEARCH_ICON}</span>
          <input class="wh-spot-field" type="search" data-spot-input placeholder="${escapeHtml(placeholder)}" aria-label="${escapeHtml(placeholder)}" />
        </div>
        <div class="wh-spot-titlewrap">
          <span class="wh-spot-title" data-spot-title></span>
          <span class="wh-spot-subtitle" data-spot-subtitle></span>
        </div>
        <kbd class="wh-spot-kbd">⌘K</kbd>
      </div>
      <div class="wh-spot-body" data-spot-body></div>
    </div>`;

  const box = host.querySelector<HTMLElement>("[data-spot-box]")!;
  const input2 = host.querySelector<HTMLInputElement>("[data-spot-input]")!;
  const body = host.querySelector<HTMLElement>("[data-spot-body]")!;
  const titleEl = host.querySelector<HTMLElement>("[data-spot-title]")!;
  const subtitleEl = host.querySelector<HTMLElement>("[data-spot-subtitle]")!;

  // —— 原生窗口缩放：测内容高度，clamp 到屏幕上限，超出则盒内滚动。去抖合并多次请求。 ——
  let resizeRaf = 0;
  const applyResize = () => {
    resizeRaf = 0;
    if (!input.resize) {
      return;
    }
    const stagePad = 24; // .wh-spot-stage 上下各 12px
    body.style.maxHeight = "none";
    const top = box.offsetHeight - body.offsetHeight; // 顶栏 + 边框
    const natural = box.offsetHeight + stagePad;
    const screenMax = Math.round((window.screen?.availHeight ?? 900) * 0.86);
    const winH = Math.max(180, Math.min(natural, screenMax));
    const bodyMax = Math.max(80, winH - stagePad - top);
    body.style.maxHeight = `${bodyMax}px`;
    const width = Math.max(360, Math.round(window.innerWidth));
    input.resize(width, winH);
  };
  const requestResize = () => {
    if (resizeRaf) {
      return;
    }
    resizeRaf = window.requestAnimationFrame(applyResize);
  };

  const renderLauncher = () => {
    if (disposeView) {
      disposeView();
      disposeView = undefined;
    }
    box.dataset.mode = "launcher";
    body.innerHTML = renderLauncherGrid(launcherMatches(state, locale), locale, badges);
    requestResize();
  };

  const renderCapability = (id: CommandId) => {
    if (disposeView) {
      disposeView();
      disposeView = undefined;
    }
    box.dataset.mode = "capability";
    const cmd = commandRegistry.find((c) => c.id === id);
    titleEl.textContent = cmd ? cmd.label[zh ? "zh-CN" : "en"] : id;
    subtitleEl.textContent = "";
    body.innerHTML = "";
    body.classList.add("ds-anim-fade-in");
    requestResize();
    const ctx: SpotlightViewContext = {
      client,
      locale,
      body,
      back: () => dispatch({ type: "back" }),
      setSubtitle: (text) => {
        subtitleEl.textContent = text;
      },
      toast: (message, tone) => showToast(message, tone),
      requestResize
    };
    const view = resolveCapabilityView(id);
    const result = view.mount(ctx);
    if (result instanceof Promise) {
      void result.then((cleanup) => {
        if (typeof cleanup === "function") {
          disposeView = cleanup;
        }
      });
    } else if (typeof result === "function") {
      disposeView = result;
    }
  };

  const render = () => {
    const capId = openCapabilityId(state);
    if (capId) {
      renderCapability(capId);
    } else {
      renderLauncher();
      // 回到 launcher 时聚焦输入。
      input2.focus();
    }
  };

  let toastTimer = 0;
  const showToast = (message: string, tone: "ok" | "error" | "info" = "info") => {
    box.querySelector(".wh-spot-toast")?.remove();
    const el = doc.createElement("div");
    el.className = `wh-spot-toast wh-spot-toast--${tone}`;
    el.textContent = message;
    box.appendChild(el);
    if (toastTimer) {
      window.clearTimeout(toastTimer);
    }
    toastTimer = window.setTimeout(() => el.remove(), 3200);
  };

  const dispatch = (action: Parameters<typeof spotlightReducer>[1]) => {
    const next = spotlightReducer(state, action);
    if (next === state) {
      return;
    }
    const prevMode = state.mode.kind;
    const prevCap = openCapabilityId(state);
    state = next;
    const nextCap = openCapabilityId(state);
    if (nextCap && nextCap !== prevCap) {
      renderCapability(nextCap);
    } else if (!nextCap && prevMode === "capability") {
      render();
    } else if (!nextCap) {
      // launcher 内查询变化：只换网格，保输入焦点。
      body.innerHTML = renderLauncherGrid(launcherMatches(state, locale), locale, badges);
      requestResize();
    }
  };

  // —— 交互 —— //
  input2.addEventListener("input", () => {
    dispatch({ type: "setQuery", query: input2.value });
  });

  host.querySelector<HTMLElement>("[data-spot-back]")?.addEventListener("click", () => {
    dispatch({ type: "back" });
  });

  body.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const cap = target.closest<HTMLElement>("[data-spot-cap]");
    if (cap?.dataset.spotCap) {
      dispatch({ type: "openCapability", id: cap.dataset.spotCap as CommandId });
    }
  });

  // 键盘：launcher 下 ↑↓ 选中、Enter 开最优；ESC 返回/清空；⌘K/Ctrl+K 回到搜索。
  const moveActive = (delta: number) => {
    const caps = Array.from(body.querySelectorAll<HTMLElement>("[data-spot-cap]"));
    if (caps.length === 0) {
      return;
    }
    let current = caps.findIndex((c) => c.dataset.active === "true");
    if (current < 0) {
      current = 0;
    }
    const nextIndex = (current + delta + caps.length) % caps.length;
    caps.forEach((c, i) => {
      c.dataset.active = String(i === nextIndex);
    });
    caps[nextIndex]?.scrollIntoView({ block: "nearest" });
  };

  input2.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === "Enter") {
      const active = body.querySelector<HTMLElement>('[data-spot-cap][data-active="true"]');
      const id = (active?.dataset.spotCap as CommandId | undefined) ?? topMatchId(state, locale);
      if (id) {
        event.preventDefault();
        dispatch({ type: "openCapability", id });
      }
    }
  });

  window.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && (event.key === "k" || event.key === "K")) {
      event.preventDefault();
      dispatch({ type: "reset" });
      render();
    } else if (event.key === "Escape") {
      if (openCapabilityId(state)) {
        event.preventDefault();
        dispatch({ type: "back" });
      } else if (input2.value) {
        event.preventDefault();
        input2.value = "";
        dispatch({ type: "setQuery", query: "" });
      }
    }
  });

  window.addEventListener("resize", () => requestResize());

  // 首屏：launcher。
  renderLauncher();
  input2.focus();

  return {
    openCapability: (id) => {
      dispatch({ type: "openCapability", id });
    },
    reset: () => {
      dispatch({ type: "reset" });
      render();
    },
    setBadges: (next) => {
      badges = { ...badges, ...next };
      if (!openCapabilityId(state)) {
        body.innerHTML = renderLauncherGrid(launcherMatches(state, locale), locale, badges);
        requestResize();
      }
    }
  };
}
