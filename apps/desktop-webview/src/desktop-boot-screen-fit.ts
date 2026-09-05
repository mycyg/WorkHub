// WorkHub 桌面 · boot 屏的原生窗口贴合（R24 H）。
//
// 现象（用户截图）：主窗首启渲出「欢迎使用 WorkHub」昵称屏，但原生窗口还是聚焦盒 idle 的细搜索条
// 尺寸（client-tauri/src-tauri/src/windows.rs 的 main_window_plan：720×64），卡片被窗口裁掉、只露出
// 一行标题。
//
// 根因：browser.ts 的三张 boot 屏（首启/重绑昵称屏、密码模式凭据门、连接服务器屏）都是直接
// `root.innerHTML = …` 渲进主窗根节点的，从不把内容尺寸同步给壳层——全仓只有 spotlight/controller.ts
// 的 applyResize 会量 box 高度并 invoke set_spotlight_size（经 desktop-window-controls.ts），而 boot 屏
// 根本没挂那个控制器。（登出后的重绑屏此前"看着正常"，只是因为聚焦盒在那之前已经展开过、窗口已经是
// 大的；首启时窗口还是出厂的 720×64，所以一裁到底。）
//
// 本模块把那条通道补给 boot 屏：量卡片内容高 → clamp → resize()（生产上就是同一个 set_spotlight_size），
// 并持续跟随内容变化：
//   - ResizeObserver：字体加载完、文案换行、异步内容让卡片自己变高变矮；
//   - MutationObserver：DOM 换血——凭据门切页签（hidden 属性）、错误行出现、连接屏的「测试连接」结果卡，
//     以及昵称屏探到密码模式后就地换成凭据门。
// 两者都汇到同一次去抖量测，量出同样尺寸就不再下发（同 applyResize 的 lastSent 去重：set_size 会回弹
// 一个 resize 事件，不去重会 set_size→resize→再 set_size 地抖）。
//
// 量高锚点刻意打在**卡片/面板本体**（desktopBootScreenFitAttribute）而不是撑满 100vh 的外壳上：外壳的
// min-height 跟着窗口走，量外壳会让窗口只长不缩（切到更矮的一屏时留一截空玻璃）。卡片四周留白由
// desktopBootScreenFitPaddingPx 单一来源同时喂给三张屏的外壳 padding 和这里的加法，两边不会漂移——
// 一旦漂移（CSS padding > 这里的 padding），窗口就会重新开始裁卡片边缘。
//
// 浏览器开发态没有 __TAURI__：resize 落到 desktop-window-controls.ts 的 no-op，本模块照常量高、不报错。

/** 窗口最小宽度（同 spotlight/controller.ts applyResize 的口径）。 */
export const desktopBootScreenFitMinWidthPx = 360;
/** 窗口最小高度（同 applyResize 展开态下限）。 */
export const desktopBootScreenFitMinHeightPx = 120;
/** 高度上限占屏比（同 applyResize：availHeight*0.86；超出的内容在窗内滚动，不长到屏幕外）。 */
export const desktopBootScreenFitScreenRatio = 0.86;
/** 取不到 screen.availHeight 时的兜底屏高（同 applyResize）。 */
export const desktopBootScreenFitFallbackScreenHeightPx = 900;
/** boot 卡片四周留白（px）：三张 boot 屏的外壳 padding 与本模块的加法共用它，否则窗口会裁掉卡片边缘。 */
export const desktopBootScreenFitPaddingPx = 32;
/** 量高锚点属性：打在卡片/面板本体上（不是撑满 100vh 的外壳）。 */
export const desktopBootScreenFitAttribute = "data-desktop-boot-fit";

/** 把内容尺寸下发给原生壳（生产上是 desktop-window-controls.ts 的 resizeDesktopMainWindow）。 */
export type DesktopBootScreenResizeFn = (width: number, height: number) => void;

// 这个 workspace 的测试运行器没有真实 DOM（node --import tsx --test），所以只声明量高真正用到的最小面
// ——HTMLElement 天然满足，单测可以喂一个普通对象。方法用方法语法声明（双变型），才好接住
// HTMLElement.querySelector 那个泛型签名。
export type DesktopBootScreenFitElement = {
  readonly offsetHeight?: number | undefined;
  readonly scrollHeight?: number | undefined;
  querySelector?(selectors: string): DesktopBootScreenFitElement | null;
};

export type DesktopBootScreenFitObserver = {
  observe(target: unknown, options?: unknown): void;
  disconnect(): void;
};

type DesktopBootScreenFitObserverCtor = new (callback: () => void) => DesktopBootScreenFitObserver;

/** 视图侧依赖（生产上是 window）：窗宽、屏高、下一帧调度、两个观察者构造器。 */
export type DesktopBootScreenFitView = {
  innerWidth?: number | undefined;
  screen?: { availHeight?: number | undefined } | undefined;
  requestAnimationFrame?: ((callback: () => void) => number) | undefined;
  ResizeObserver?: unknown;
  MutationObserver?: unknown;
};

export type DesktopBootScreenFitDocument = {
  defaultView?: DesktopBootScreenFitView | null | undefined;
};

export type DesktopBootScreenFitInput = {
  resize: DesktopBootScreenResizeFn;
  /** 屏幕（默认取 view.screen）——只用 availHeight 算高度上限。 */
  screen?: { availHeight?: number | undefined } | undefined;
  /** 文档（默认全局 document）——只用来取 defaultView。 */
  doc?: DesktopBootScreenFitDocument | undefined;
  /** 视图（默认 doc.defaultView / 全局 window）。 */
  view?: DesktopBootScreenFitView | undefined;
  /** 卡片四周留白，默认 desktopBootScreenFitPaddingPx（必须与 boot 屏外壳的 padding 一致）。 */
  padding?: number | undefined;
  minWidth?: number | undefined;
  minHeight?: number | undefined;
  maxHeightRatio?: number | undefined;
  /** 合并多次量测的调度（默认 requestAnimationFrame；没有就同步跑）。 */
  schedule?: ((run: () => void) => void) | undefined;
};

function resolveGlobalView(): DesktopBootScreenFitView | undefined {
  return typeof window === "undefined" ? undefined : (window as unknown as DesktopBootScreenFitView);
}

function resolveGlobalDocument(): DesktopBootScreenFitDocument | undefined {
  return typeof document === "undefined" ? undefined : (document as unknown as DesktopBootScreenFitDocument);
}

/**
 * 把主窗尺寸贴合到 boot 屏内容上，并跟随内容变化持续贴合。返回 disposer（摘掉观察者、之后不再下发）。
 * 同一个根节点上换屏时，调用方应当先 dispose 上一次——否则两套观察者会各自下发同一个尺寸。
 */
export function fitDesktopMainWindowToBootScreen(
  rootEl: DesktopBootScreenFitElement,
  input: DesktopBootScreenFitInput
): () => void {
  const doc = input.doc ?? resolveGlobalDocument();
  const view = input.view ?? doc?.defaultView ?? resolveGlobalView();
  const screenLike = input.screen ?? view?.screen;
  const padding = Math.max(0, input.padding ?? desktopBootScreenFitPaddingPx);
  const minWidth = input.minWidth ?? desktopBootScreenFitMinWidthPx;
  const minHeight = input.minHeight ?? desktopBootScreenFitMinHeightPx;
  const ratio = input.maxHeightRatio ?? desktopBootScreenFitScreenRatio;
  const schedule =
    input.schedule ??
    ((run: () => void) => {
      if (typeof view?.requestAnimationFrame === "function") {
        view.requestAnimationFrame(run);
        return;
      }
      run();
    });

  let lastSentWidth = 0;
  let lastSentHeight = 0;
  let pending = false;
  let disposed = false;

  // 锚点缺失（老屏/被换掉的 DOM）时退回根节点本身——宁可只会长不会缩，也不要完全不贴合。
  const measureTarget = (): DesktopBootScreenFitElement =>
    rootEl.querySelector?.(`[${desktopBootScreenFitAttribute}]`) ?? rootEl;

  const applyFit = () => {
    pending = false;
    if (disposed) {
      return;
    }
    const target = measureTarget();
    const content = target.offsetHeight || target.scrollHeight || 0;
    if (!(content > 0)) {
      // 还没有布局（首帧之前 / 没有真实 DOM 的环境）：不下发一个假尺寸，等观察者下一拍再量。
      return;
    }
    const screenMax = Math.round(
      (screenLike?.availHeight ?? desktopBootScreenFitFallbackScreenHeightPx) * ratio
    );
    const natural = Math.round(content + padding * 2);
    const height = Math.max(minHeight, Math.min(natural, screenMax));
    // 宽度沿用当前窗宽（同 applyResize）：boot 屏不改窗宽，免得 top-left 锚定的窗口横向跳一下。
    const width = Math.max(minWidth, Math.round(view?.innerWidth ?? minWidth));
    if (width === lastSentWidth && height === lastSentHeight) {
      return;
    }
    lastSentWidth = width;
    lastSentHeight = height;
    input.resize(width, height);
  };

  const requestFit = () => {
    if (disposed || pending) {
      return;
    }
    pending = true;
    schedule(applyFit);
  };

  const disposers: Array<() => void> = [];
  const observeWith = (candidate: unknown, options?: unknown): boolean => {
    if (typeof candidate !== "function") {
      return false;
    }
    try {
      const observer = new (candidate as DesktopBootScreenFitObserverCtor)(() => requestFit());
      observer.observe(rootEl, options);
      disposers.push(() => observer.disconnect());
      return true;
    } catch {
      // 观察者建不起来（环境不支持/参数不合）不该拖垮 boot 屏：首次贴合已经发生，之后不再跟随而已。
      return false;
    }
  };

  observeWith(view?.ResizeObserver);
  observeWith(view?.MutationObserver, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true
  });

  // 首次同步贴合：不等下一帧，窗口一出现就是对的尺寸（否则会闪一下细搜索条）。
  applyFit();

  return () => {
    if (disposed) {
      return;
    }
    disposed = true;
    for (const dispose of disposers.splice(0)) {
      try {
        dispose();
      } catch {
        // 摘监听失败不该抛给调用方。
      }
    }
  };
}
