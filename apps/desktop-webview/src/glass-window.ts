// WorkHub R8 客户端 · 临时玻璃窗框架（desktop-only）。
// 「窗口为补充」：从 Cuu/命令面板按需召出一个临时玻璃浮层窗（in-webview overlay，非真 Tauri 窗——更轻、
// 可弹性动画、可即时关闭），承载某个能力的详情（网盘/项目/diff/回放/成本/知识/团队…）。关闭即回到 Cuu。
// 渲染是纯函数（可单测）；控制器是薄 DOM 层（背景点击/关闭键/ESC + spring 进出动画）。
// 用设计系统类名（design-system.ts）。不进共享 @workhub/ui。

import { designSystem } from "./design-system.js";

export type GlassWindowSpec = {
  key: string;
  title: string;
  bodyHtml: string;
  /** 宽窗（diff/回放等需要更多横向空间）。 */
  wide?: boolean;
  /** 标题旁的可选 kicker（如能力分类）。 */
  kicker?: string;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}

const closeIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

// 纯渲染：背景遮罩 + 居中玻璃窗（标题栏 + 关闭 + 可滚动正文）。bodyHtml 由调用方负责（通常已转义/可信渲染）。
export function renderGlassWindow(spec: GlassWindowSpec, closeLabel = "关闭"): string {
  const ds = designSystem;
  const kicker = spec.kicker ? `<span class="wh-gw-kicker">${escapeHtml(spec.kicker)}</span>` : "";
  return `<div class="wh-gw-backdrop ds-anim-fade-in" data-glass-backdrop data-glass-window="${escapeHtml(spec.key)}">
    <section class="wh-gw ${ds.glassStrong} ${ds.springIn}${spec.wide ? " wh-gw--wide" : ""}" role="dialog" aria-modal="true" aria-label="${escapeHtml(spec.title)}">
      <header class="wh-gw-bar">
        <div class="wh-gw-titles">${kicker}<h2 class="wh-gw-title">${escapeHtml(spec.title)}</h2></div>
        <button type="button" class="wh-gw-close ${ds.pressable}" data-glass-close aria-label="${escapeHtml(closeLabel)}">${closeIcon}</button>
      </header>
      <div class="wh-gw-body" data-glass-body>${spec.bodyHtml}</div>
    </section>
  </div>`;
}

export type GlassWindowController = {
  open: (spec: GlassWindowSpec) => void;
  setBody: (html: string) => void;
  close: () => void;
  isOpen: () => boolean;
  currentKey: () => string | undefined;
};

type ControllerOptions = {
  closeLabel?: string;
  onClose?: (key: string | undefined) => void;
  /** 注入便于测试；默认用全局 document。 */
  doc?: Document;
};

// 薄 DOM 控制器：把窗挂到 host 上，处理背景/关闭/ESC 关闭与进出动画。host 应是覆盖全窗的容器。
export function createGlassWindowController(host: HTMLElement, options: ControllerOptions = {}): GlassWindowController {
  const doc = options.doc ?? host.ownerDocument ?? (globalThis as { document?: Document }).document;
  let current: string | undefined;

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && current) {
      close();
    }
  };

  function bind() {
    host.addEventListener("click", onHostClick);
    doc?.addEventListener("keydown", onKeydown);
  }
  function unbind() {
    host.removeEventListener("click", onHostClick);
    doc?.removeEventListener("keydown", onKeydown);
  }
  function onHostClick(event: MouseEvent) {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }
    // 点关闭按钮或点背景空白（不是窗体内部）→ 关闭。
    if (target.closest("[data-glass-close]") || target.hasAttribute("data-glass-backdrop")) {
      close();
    }
  }

  function open(spec: GlassWindowSpec) {
    host.innerHTML = renderGlassWindow(spec, options.closeLabel ?? "关闭");
    host.removeAttribute("hidden");
    current = spec.key;
  }

  function setBody(html: string) {
    const body = host.querySelector<HTMLElement>("[data-glass-body]");
    if (body) {
      body.innerHTML = html;
    }
  }

  function close() {
    if (!current) {
      return;
    }
    const closed = current;
    current = undefined;
    host.innerHTML = "";
    host.setAttribute("hidden", "");
    options.onClose?.(closed);
  }

  bind();
  // 暴露 unbind 供整窗销毁（当前桌面 webview 生命周期 = 窗体生命周期，通常无需调用）。
  void unbind;

  return {
    open,
    setBody,
    close,
    isOpen: () => current !== undefined,
    currentKey: () => current
  };
}

export const glassWindowCss = [
  ".wh-gw-backdrop{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:5vh 24px;box-sizing:border-box;background:rgba(40,30,70,.22);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)}",
  ".wh-gw-backdrop[hidden]{display:none}",
  ".wh-gw{width:min(720px,calc(100vw - 48px));max-height:90vh;display:flex;flex-direction:column;border-radius:var(--ds-radius-xl);overflow:hidden;padding:0}",
  ".wh-gw--wide{width:min(1040px,calc(100vw - 48px))}",
  ".wh-gw-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;border-bottom:1px solid var(--ds-glass-hairline)}",
  ".wh-gw-titles{display:flex;flex-direction:column;gap:2px;min-width:0}",
  ".wh-gw-kicker{font:700 11px/1 var(--ds-font);letter-spacing:.4px;color:var(--ds-accent);text-transform:uppercase}",
  ".wh-gw-title{margin:0;font:650 18px/1.3 var(--ds-font);color:var(--ds-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".wh-gw-close{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;flex:0 0 auto;border:0;border-radius:var(--ds-radius-pill);background:rgba(255,255,255,.5);color:var(--ds-ink-muted);cursor:pointer}",
  ".wh-gw-close:hover{background:rgba(255,255,255,.8);color:var(--ds-ink)}",
  ".wh-gw-close svg{width:18px;height:18px}",
  ".wh-gw-body{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:18px}"
].join("");
