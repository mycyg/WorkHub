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
import type { SpotlightApiClient, SpotlightTarget, SpotlightViewContext } from "./view-context.js";

export type SpotlightResizeFn = (width: number, height: number) => void;

export type MountSpotlightInput = {
  host: HTMLElement;
  client: SpotlightApiClient;
  locale: WorkHubLocale;
  // 角标（如 approvals: 待办数）。可后续更新。
  badges?: Partial<Record<CommandId, number>>;
  // 缩放原生窗口（browser.ts 注入 → invoke set_spotlight_size）。浏览器开发态可为空（no-op）。
  resize?: SpotlightResizeFn;
  // 关闭/隐藏盒子（browser.ts 注入 → invoke hide_main_window）。M2：让 launcher 顶层 Esc 真正关闭盒子，
  // 兑现 hello 卡「Esc 关闭」的承诺。浏览器开发态可为空（no-op）。
  dismiss?: () => void;
};

export type SpotlightHandle = {
  // 外部（如 Cuu 决策信箱点击、托盘/深链）请求打开某能力，可带目标实体 id（让目标 view 直接展开该项）。
  openCapability: (id: CommandId, target?: SpotlightTarget) => void;
  // 回到 launcher。
  reset: () => void;
  // 更新角标并（若在 launcher）刷新网格。
  setBadges: (badges: Partial<Record<CommandId, number>>) => void;
  // 卸载：断开 controller 自身的 window 监听器 + 当前 view，幂等。供未来重挂/多宿主场景。
  dispose: () => void;
};

const SEARCH_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.3-4.3"/></svg>';
const BACK_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>';

function renderLauncherGrid(
  matches: CommandMatch[],
  locale: WorkHubLocale,
  badges: Partial<Record<CommandId, number>>,
  showHello: boolean
): string {
  const zh = locale === "zh-CN";
  if (matches.length === 0) {
    return `<div class="wh-spot-grid"><div class="wh-spot-empty-grid">${zh ? "没有匹配的能力，换个说法试试" : "No matching capability — try another phrase"}</div></div>`;
  }
  // 空查询时给一无所知的新用户一句温和的引导：先亮身份(WorkHub·Cuu)，再说怎么用 + Esc 关闭提示
  // （搜索框无 header，保持聚焦盒观感；⌘K 已在右上角标出）。
  const hello = showHello
    ? `<div class="wh-spot-hello ds-anim-fade-in">${
        zh
          ? "WorkHub · 把活交给 Cuu，你来拍板<br>输入关键词，或选一个开始；Esc 关闭"
          : "WorkHub · hand work to Cuu, you decide<br>Type or pick one to start; Esc to close"
      }</div>`
    : "";
  const loc = zh ? "zh-CN" : "en";
  const cards = matches
    .map(({ command }, index) => {
      const badge = badges[command.id];
      // L7：角标(如待处理审批数)给无障碍标签,屏幕阅读器能播报「N 待处理」而非只读一个孤立数字。
      const badgeHtml = typeof badge === "number" && badge > 0 ? `<span class="wh-spot-cap-badge" aria-label="${badge} ${zh ? "待处理" : "pending"}">${badge}</span>` : "";
      const active = index === 0;
      // rank5：组合框/列表框 ARIA——每张能力卡是 option、可读 aria-selected；输入框(combobox)
      // 用 aria-activedescendant 指向当前项，箭头键移动时屏幕阅读器能播报，无需移动 DOM 焦点。
      return `<button type="button" id="wh-spot-opt-${index}" role="option" aria-selected="${active ? "true" : "false"}" class="wh-spot-cap" data-spot-cap="${command.id}" data-active="${active ? "true" : "false"}">
        <span class="wh-spot-cap-icon" aria-hidden="true">${command.icon}</span>
        <span class="wh-spot-cap-text">
          <span class="wh-spot-cap-label">${escapeHtml(command.label[loc])}</span>
          <span class="wh-spot-cap-hint">${escapeHtml(command.hint[loc])}</span>
        </span>
        ${badgeHtml}
      </button>`;
    })
    .join("");
  // M7：错落入场只在初始/空查询的 launcher 播一次；边打字边过滤时不要每个按键都重放 stagger（读起来发抖）。
  return `${hello}<div class="wh-spot-grid${showHello ? " ds-stagger" : ""}" id="wh-spot-listbox" role="listbox" aria-label="${zh ? "能力列表" : "Capabilities"}">${cards}</div>`;
}

export function mountSpotlight(input: MountSpotlightInput): SpotlightHandle {
  const { host, client, locale } = input;
  const doc = host.ownerDocument ?? document;
  const zh = locale === "zh-CN";
  let badges: Partial<Record<CommandId, number>> = { ...(input.badges ?? {}) };
  let state: SpotlightState = initialSpotlightState();
  // 苹果聚焦盒：没点击(搜索框未聚焦)且空查询时,盒子只露一条搜索框;点击聚焦或输入才展开能力网格。
  let searchActive = false;
  let disposeView: (() => void) | undefined;
  // 待消费的跳转目标实体：open(id, target) 设置 → 下一次 renderCapability 读入该能力 ctx 后清空（rank13/14）。
  let pendingTarget: SpotlightTarget | undefined;
  // controller 自身的 window 监听器（⌘K/ESC/resize）统一挂这个 signal，dispose 时一并断开（rank25）。
  const controllerAbort = new AbortController();

  const placeholder = zh ? "想做点什么？新任务 / 审批 / 网盘 / 项目…" : "What do you need? new task / approve / drive…";
  host.className = "wh-ds wh-spot-stage";
  host.innerHTML = `
    <div class="wh-spot ds-glass-strong ds-anim-spring-in" data-spot-box data-mode="launcher">
      <div class="wh-spot-top">
        <button type="button" class="wh-spot-back" data-spot-back aria-label="${zh ? "返回" : "Back"}">${BACK_ICON}</button>
        <div class="wh-spot-field-wrap">
          <span class="wh-spot-field-icon">${SEARCH_ICON}</span>
          <input class="wh-spot-field" type="search" data-spot-input role="combobox" aria-expanded="true" aria-controls="wh-spot-listbox" aria-autocomplete="list" placeholder="${escapeHtml(placeholder)}" aria-label="${escapeHtml(placeholder)}" />
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
  let lastSentW = 0;
  let lastSentH = 0;
  const applyResize = () => {
    resizeRaf = 0;
    if (!input.resize) {
      return;
    }
    const stagePad = 0; // .wh-spot-stage 现无 padding（盒子铺满透明窗，靠圆角 vibrancy 收边）
    body.style.maxHeight = "none";
    const top = box.offsetHeight - body.offsetHeight; // 顶栏 + 边框
    const natural = box.offsetHeight + stagePad;
    const screenMax = Math.round((window.screen?.availHeight ?? 900) * 0.86);
    // 收起态(只有搜索框)时窗口要缩到搜索条本身(~56px),不能被 180 的下限撑出一截空白(用户反馈"未点击只有搜索框")。
    // 下限取一个搜索条高度兜底,实际高度由 natural(随内容)决定。
    const minH = box.dataset.collapsed === "true" ? 52 : 120;
    const winH = Math.max(minH, Math.min(natural, screenMax));
    const bodyMax = Math.max(80, winH - stagePad - top);
    body.style.maxHeight = `${bodyMax}px`;
    const width = Math.max(360, Math.round(window.innerWidth));
    // M1：缓存上次下发尺寸——set_size 会回弹一个 window resize 事件，若不去重就会
    // set_size→resize→requestResize→set_size 抖动。尺寸没变就不再下发。
    if (width === lastSentW && winH === lastSentH) {
      return;
    }
    lastSentW = width;
    lastSentH = winH;
    input.resize(width, winH);
  };
  const requestResize = () => {
    if (resizeRaf) {
      return;
    }
    resizeRaf = window.requestAnimationFrame(applyResize);
  };

  // rank5：网格(重)渲后让 combobox 输入框的 aria-activedescendant 指向首个(默认高亮)能力项；无项则清除。
  const syncLauncherActiveDescendant = () => {
    const first = body.querySelector<HTMLElement>("[data-spot-cap]");
    if (first?.id) {
      input2.setAttribute("aria-activedescendant", first.id);
    } else {
      input2.removeAttribute("aria-activedescendant");
    }
  };

  const renderLauncher = () => {
    if (disposeView) {
      disposeView();
      disposeView = undefined;
    }
    box.dataset.mode = "launcher";
    // 未聚焦且空查询 → 收起,只留搜索框(data-collapsed=true);聚焦或有查询 → 展开能力网格。
    const expanded = searchActive || state.query.trim().length > 0;
    box.dataset.collapsed = expanded ? "false" : "true";
    body.innerHTML = expanded
      ? renderLauncherGrid(launcherMatches(state, locale), locale, badges, state.query.trim().length === 0)
      : "";
    syncLauncherActiveDescendant();
    requestResize();
  };

  const renderCapability = (id: CommandId) => {
    if (disposeView) {
      disposeView();
      disposeView = undefined;
    }
    // 消费一次性跳转目标（open()/深链设置的）：归属本次 mount 的 ctx.target，随后清空，避免泄漏到下个能力。
    const target = pendingTarget;
    pendingTarget = undefined;
    box.dataset.mode = "capability";
    const cmd = commandRegistry.find((c) => c.id === id);
    titleEl.textContent = cmd ? cmd.label[zh ? "zh-CN" : "en"] : id;
    subtitleEl.textContent = "";
    // H1：每个能力一个全新内容节点 + AbortController。view 把监听器挂在这个节点(ctx.body)上；
    // 切走能力时 replaceChildren 移除该节点（监听器随节点销毁，不在持久 body 上累积）+ abort 信号
    // 兜住任何挂到 window/document 的监听器。disposeView 同步建好，异步 mount 未 resolve 就切走也能清理。
    const viewRoot = doc.createElement("div");
    viewRoot.className = "ds-anim-fade-in";
    body.replaceChildren(viewRoot);
    requestResize();
    // L1：进入能力后搜索框被 display:none 隐藏,焦点会掉到 <body>,键盘用户失去锚点。把焦点移到内容容器——
    // 下一次 Tab 即落到视图第一个可交互元素,屏幕阅读器焦点也随之进入新内容。tabindex=-1 仅供编程聚焦、
    // 不进 Tab 序列;编程聚焦不触发 :focus-visible,不会给整块内容画焦点环。
    viewRoot.tabIndex = -1;
    viewRoot.focus?.({ preventScroll: true });
    const viewAbort = new AbortController();
    let viewCleanup: (() => void) | undefined;
    disposeView = () => {
      viewCleanup?.();
      viewAbort.abort();
    };
    const ctx: SpotlightViewContext = {
      client,
      locale,
      body: viewRoot,
      back: () => dispatch({ type: "back" }),
      open: (nextId, nextTarget) => openCapabilityWithTarget(nextId, nextTarget),
      ...(target ? { target } : {}),
      setSubtitle: (text) => {
        subtitleEl.textContent = text;
      },
      toast: (message, tone) => showToast(message, tone),
      requestResize,
      signal: viewAbort.signal
    };
    const view = resolveCapabilityView(id);
    const result = view.mount(ctx);
    if (result instanceof Promise) {
      void result.then((cleanup) => {
        if (typeof cleanup === "function") {
          viewCleanup = cleanup;
        }
      });
    } else if (typeof result === "function") {
      viewCleanup = result;
    }
  };

  const render = () => {
    const capId = openCapabilityId(state);
    if (capId) {
      renderCapability(capId);
    } else {
      // 从能力返回 launcher：视为已激活,展开网格 + 聚焦输入(无收起闪烁)。
      searchActive = true;
      renderLauncher();
      input2.focus();
    }
  };

  let toastTimer = 0;
  // #20 退场动画的内层定时器——单独跟踪,以便替换/dispose 时清掉,避免悬挂回调/竞态(虽各自无害,从严)。
  let toastInnerTimer = 0;
  const clearToastTimers = () => {
    if (toastTimer) {
      window.clearTimeout(toastTimer);
      toastTimer = 0;
    }
    if (toastInnerTimer) {
      window.clearTimeout(toastInnerTimer);
      toastInnerTimer = 0;
    }
  };
  const showToast = (message: string, tone: "ok" | "error" | "info" = "info") => {
    clearToastTimers();
    box.querySelector(".wh-spot-toast")?.remove();
    const el = doc.createElement("div");
    el.className = `wh-spot-toast wh-spot-toast--${tone}`;
    // rank6：动作回执/错误要被屏幕阅读器播报——错误用 assertive(alert)，成功/提示用 polite(status)。
    el.setAttribute("role", tone === "error" ? "alert" : "status");
    el.setAttribute("aria-live", tone === "error" ? "assertive" : "polite");
    el.textContent = message;
    box.appendChild(el);
    // #20：到期先播退场动画(约 1 帧)再移除,toast 不再生硬消失。reduced-motion 下动画近 0ms,行为不变。
    toastTimer = window.setTimeout(() => {
      el.classList.add("wh-spot-toast--leaving");
      toastInnerTimer = window.setTimeout(() => el.remove(), 220);
    }, 3200);
  };

  const dispatch = (action: Parameters<typeof spotlightReducer>[1]) => {
    const next = spotlightReducer(state, action);
    if (next === state) {
      return;
    }
    const prevMode = state.mode.kind;
    state = next;
    const nextCap = openCapabilityId(state);
    // rank6：同一能力被再次请求(桌宠/托盘/深链 navigate 到已打开的能力)也要重渲——
    // renderCapability 会先 disposeView 再全新挂载+重拉数据，否则外部入口看起来「点了没反应」。
    if (nextCap) {
      renderCapability(nextCap);
    } else if (!nextCap && prevMode === "capability") {
      render();
    } else if (!nextCap) {
      // launcher 内查询变化：只换网格，保输入焦点。
      body.innerHTML = renderLauncherGrid(launcherMatches(state, locale), locale, badges, state.query.trim().length === 0);
      syncLauncherActiveDescendant();
      requestResize();
    }
  };

  // 带目标实体打开某能力：先设 pendingTarget（renderCapability 会读入该能力 ctx.target），再 dispatch。
  const openCapabilityWithTarget = (id: CommandId, target?: SpotlightTarget) => {
    pendingTarget = target;
    dispatch({ type: "openCapability", id });
  };

  // —— 交互 —— //
  input2.addEventListener("input", () => {
    dispatch({ type: "setQuery", query: input2.value });
  });

  // 聚焦搜索框 → 展开能力网格(从"只有搜索框"的收起态生长开)。
  input2.addEventListener("focus", () => {
    if (openCapabilityId(state) || searchActive) {
      return;
    }
    searchActive = true;
    renderLauncher();
  });
  // 失焦且空查询 → 收回成"只有搜索框";但若焦点移到盒内(点能力卡)则保持展开,让卡片点击照常生效。
  input2.addEventListener("blur", (event) => {
    const next = event.relatedTarget;
    if (next instanceof Node && box.contains(next)) {
      return;
    }
    if (openCapabilityId(state) || !searchActive || state.query.trim().length > 0) {
      return;
    }
    searchActive = false;
    renderLauncher();
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
      const on = i === nextIndex;
      c.dataset.active = String(on);
      // rank5：同步 aria-selected + 让 combobox 输入框的 aria-activedescendant 指向当前项，屏幕阅读器随箭头播报。
      c.setAttribute("aria-selected", on ? "true" : "false");
    });
    const activeCap = caps[nextIndex];
    if (activeCap?.id) {
      input2.setAttribute("aria-activedescendant", activeCap.id);
    }
    activeCap?.scrollIntoView({ block: "nearest" });
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

  window.addEventListener(
    "keydown",
    (event) => {
      if ((event.metaKey || event.ctrlKey) && (event.key === "k" || event.key === "K")) {
        event.preventDefault();
        // rank20：清掉搜索框残留文本（否则框里旧词与下方全量网格对不上），dispatch 自己负责重渲，
        // 不再额外 render() 造成 launcher 连画两遍。
        input2.value = "";
        dispatch({ type: "reset" });
      } else if (event.key === "Escape") {
        if (openCapabilityId(state)) {
          event.preventDefault();
          // M3：若当前能力视图正处于内部详情(list→detail),先退一级——点它已渲染好的「返回列表」按钮,
          // 让 Esc 与屏幕上的面包屑返回逐级一致;只有视图没有内部详情层时,Esc 才退回 launcher(能力网格)。
          // 这些 data-*-back 仅在各 view 的 detail HTML 里出现,list 态查不到 → 自然退回顶层。
          const internalBack = body.querySelector<HTMLElement>(
            "[data-wi-back],[data-prop-back],[data-run-back],[data-back-to-projects]"
          );
          if (internalBack) {
            internalBack.click();
          } else {
            dispatch({ type: "back" });
          }
        } else if (input2.value) {
          event.preventDefault();
          input2.value = "";
          dispatch({ type: "setQuery", query: "" });
        } else {
          // M2：launcher 顶层（无能力打开、查询为空）按 Esc → 真正关闭盒子，兑现「Esc 关闭」承诺。
          event.preventDefault();
          input.dismiss?.();
        }
      }
    },
    { signal: controllerAbort.signal }
  );

  window.addEventListener("resize", () => requestResize(), { signal: controllerAbort.signal });

  // 首屏：launcher——保持"未点击=只有搜索框"的收起态(不自动聚焦),用户点搜索框才展开能力网格。
  renderLauncher();

  return {
    openCapability: (id, target) => {
      openCapabilityWithTarget(id, target);
    },
    reset: () => {
      input2.value = "";
      dispatch({ type: "reset" });
    },
    setBadges: (next) => {
      badges = { ...badges, ...next };
      if (!openCapabilityId(state)) {
        body.innerHTML = renderLauncherGrid(launcherMatches(state, locale), locale, badges, state.query.trim().length === 0);
        syncLauncherActiveDescendant();
        requestResize();
      }
    },
    dispose: () => {
      controllerAbort.abort();
      if (resizeRaf) {
        window.cancelAnimationFrame(resizeRaf);
        resizeRaf = 0;
      }
      clearToastTimers();
      disposeView?.();
      disposeView = undefined;
    }
  };
}
