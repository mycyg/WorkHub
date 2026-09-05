import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  desktopBootScreenFitAttribute,
  desktopBootScreenFitMinWidthPx,
  desktopBootScreenFitPaddingPx,
  fitDesktopMainWindowToBootScreen,
  type DesktopBootScreenFitElement,
  type DesktopBootScreenFitView
} from "./desktop-boot-screen-fit.js";
import { renderDesktopConnectScreenHtml } from "./desktop-connect-screen.js";
import { renderDesktopCredentialGateHtml } from "./desktop-login.js";
import { renderDesktopRebindScreenHtml } from "./desktop-rebind.js";

// R24 H：boot 屏（首启昵称屏 / 凭据门 / 连接服务器屏）在主窗里的窗口贴合。
// 这个 workspace 的测试运行器没有真实 DOM（node --import tsx --test）——全部走模块自带的注入口：
// 假卡片（只有 offsetHeight）、假 view（innerWidth/screen/两个观察者构造器）、同步 schedule。

type FakeObserverLog = {
  callbacks: Array<() => void>;
  observed: Array<{ target: unknown; options: unknown }>;
  disconnected: number;
};

function fakeObserverLog(): FakeObserverLog {
  return { callbacks: [], observed: [], disconnected: 0 };
}

function fakeObserverCtor(log: FakeObserverLog) {
  return class FakeObserver {
    constructor(callback: () => void) {
      log.callbacks.push(callback);
    }

    observe(target: unknown, options?: unknown): void {
      log.observed.push({ target, options: options ?? null });
    }

    disconnect(): void {
      log.disconnected += 1;
    }
  };
}

/** 假 boot 屏：#root 里挂一张带量高锚点的卡片（可换掉/去掉，模拟换屏与「还没布局」）。 */
function fakeBootScreen(cardHeight: number | null, rootHeight = 0) {
  const state: { card: { offsetHeight: number } | null } = {
    card: cardHeight === null ? null : { offsetHeight: cardHeight }
  };
  const root: DesktopBootScreenFitElement = {
    offsetHeight: rootHeight,
    querySelector(selectors: string) {
      assert.equal(selectors, `[${desktopBootScreenFitAttribute}]`);
      return state.card;
    }
  };
  return { root, state };
}

function fakeView(overrides: Partial<DesktopBootScreenFitView> = {}): DesktopBootScreenFitView {
  return { innerWidth: 720, ...overrides };
}

test("fitDesktopMainWindowToBootScreen sizes the main window to the boot card plus its shell padding", () => {
  const calls: Array<[number, number]> = [];
  const { root } = fakeBootScreen(260);
  fitDesktopMainWindowToBootScreen(root, {
    resize: (width, height) => calls.push([width, height]),
    screen: { availHeight: 1000 },
    view: fakeView(),
    schedule: (run) => run()
  });
  // 首次贴合是同步的（否则窗口会先闪一帧 720×64 的细搜索条）。
  assert.deepEqual(calls, [[720, 260 + desktopBootScreenFitPaddingPx * 2]]);
});

test("fitDesktopMainWindowToBootScreen clamps a tall boot card to 86% of the available screen height", () => {
  const calls: Array<[number, number]> = [];
  const { root } = fakeBootScreen(2000);
  fitDesktopMainWindowToBootScreen(root, {
    resize: (width, height) => calls.push([width, height]),
    screen: { availHeight: 1000 },
    view: fakeView(),
    schedule: (run) => run()
  });
  // 超出上限的内容在窗内滚动，不把窗口长到屏幕外（同 spotlight/controller.ts 的 applyResize）。
  assert.deepEqual(calls, [[720, 860]]);
});

test("fitDesktopMainWindowToBootScreen keeps the current window width but never goes under the minimum", () => {
  const narrow: Array<[number, number]> = [];
  fitDesktopMainWindowToBootScreen(fakeBootScreen(200).root, {
    resize: (width, height) => narrow.push([width, height]),
    screen: { availHeight: 1000 },
    view: fakeView({ innerWidth: 180 }),
    schedule: (run) => run()
  });
  assert.equal(narrow[0]?.[0], desktopBootScreenFitMinWidthPx);

  const wide: Array<[number, number]> = [];
  fitDesktopMainWindowToBootScreen(fakeBootScreen(200).root, {
    resize: (width, height) => wide.push([width, height]),
    screen: { availHeight: 1000 },
    view: fakeView({ innerWidth: 900 }),
    schedule: (run) => run()
  });
  assert.equal(wide[0]?.[0], 900);
});

test("fitDesktopMainWindowToBootScreen does not re-send an unchanged size", () => {
  const calls: Array<[number, number]> = [];
  const resizeLog = fakeObserverLog();
  const { root } = fakeBootScreen(260);
  fitDesktopMainWindowToBootScreen(root, {
    resize: (width, height) => calls.push([width, height]),
    screen: { availHeight: 1000 },
    view: fakeView({ ResizeObserver: fakeObserverCtor(resizeLog) }),
    schedule: (run) => run()
  });
  // set_size 会回弹一个 resize 事件；不去重就会 set_size→resize→set_size 地抖（同 applyResize 的 lastSent）。
  resizeLog.callbacks[0]?.();
  resizeLog.callbacks[0]?.();
  assert.equal(calls.length, 1);
});

test("fitDesktopMainWindowToBootScreen re-measures when the boot screen swaps its DOM", () => {
  const calls: Array<[number, number]> = [];
  const mutationLog = fakeObserverLog();
  const { root, state } = fakeBootScreen(240);
  fitDesktopMainWindowToBootScreen(root, {
    resize: (width, height) => calls.push([width, height]),
    screen: { availHeight: 1000 },
    view: fakeView({ MutationObserver: fakeObserverCtor(mutationLog) }),
    schedule: (run) => run()
  });
  // 昵称屏探到密码模式后就地换成（更高的）凭据门 / 凭据门切页签 / 连接屏冒出结果卡。
  state.card = { offsetHeight: 420 };
  mutationLog.callbacks[0]?.();
  assert.deepEqual(calls, [
    [720, 240 + desktopBootScreenFitPaddingPx * 2],
    [720, 420 + desktopBootScreenFitPaddingPx * 2]
  ]);
  // 换血要连属性/文本一起看：凭据门切页签只是把另一个 panel 的 hidden 属性摘掉。
  assert.deepEqual(mutationLog.observed[0]?.options, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true
  });
});

test("fitDesktopMainWindowToBootScreen re-measures when the card itself resizes", () => {
  const calls: Array<[number, number]> = [];
  const resizeLog = fakeObserverLog();
  const { root, state } = fakeBootScreen(240);
  fitDesktopMainWindowToBootScreen(root, {
    resize: (width, height) => calls.push([width, height]),
    screen: { availHeight: 1000 },
    view: fakeView({ ResizeObserver: fakeObserverCtor(resizeLog) }),
    schedule: (run) => run()
  });
  assert.equal(resizeLog.observed[0]?.target, root);
  // 字体加载完/文案换行让卡片自己变高。
  state.card = { offsetHeight: 300 };
  resizeLog.callbacks[0]?.();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], [720, 300 + desktopBootScreenFitPaddingPx * 2]);
});

test("fitDesktopMainWindowToBootScreen coalesces observer bursts into one measurement", () => {
  const calls: Array<[number, number]> = [];
  const pendingRuns: Array<() => void> = [];
  const resizeLog = fakeObserverLog();
  const { root, state } = fakeBootScreen(240);
  fitDesktopMainWindowToBootScreen(root, {
    resize: (width, height) => calls.push([width, height]),
    screen: { availHeight: 1000 },
    view: fakeView({ ResizeObserver: fakeObserverCtor(resizeLog) }),
    schedule: (run) => pendingRuns.push(run)
  });
  state.card = { offsetHeight: 300 };
  resizeLog.callbacks[0]?.();
  resizeLog.callbacks[0]?.();
  resizeLog.callbacks[0]?.();
  assert.equal(pendingRuns.length, 1, "多次触发只排一次量测");
  pendingRuns[0]?.();
  assert.equal(calls.length, 2);
});

test("fitDesktopMainWindowToBootScreen waits instead of sending a size for a card with no layout yet", () => {
  const calls: Array<[number, number]> = [];
  const resizeLog = fakeObserverLog();
  const { root, state } = fakeBootScreen(0);
  fitDesktopMainWindowToBootScreen(root, {
    resize: (width, height) => calls.push([width, height]),
    screen: { availHeight: 1000 },
    view: fakeView({ ResizeObserver: fakeObserverCtor(resizeLog) }),
    schedule: (run) => run()
  });
  assert.deepEqual(calls, [], "量不到高度就不下发一个假尺寸");
  state.card = { offsetHeight: 240 };
  resizeLog.callbacks[0]?.();
  assert.deepEqual(calls, [[720, 240 + desktopBootScreenFitPaddingPx * 2]]);
});

test("fitDesktopMainWindowToBootScreen falls back to the root node when the fit anchor is missing", () => {
  const calls: Array<[number, number]> = [];
  const { root } = fakeBootScreen(null, 300);
  fitDesktopMainWindowToBootScreen(root, {
    resize: (width, height) => calls.push([width, height]),
    screen: { availHeight: 1000 },
    view: fakeView(),
    schedule: (run) => run()
  });
  assert.deepEqual(calls, [[720, 300 + desktopBootScreenFitPaddingPx * 2]]);
});

test("fitDesktopMainWindowToBootScreen dispose detaches both observers and stops resizing", () => {
  const calls: Array<[number, number]> = [];
  const resizeLog = fakeObserverLog();
  const mutationLog = fakeObserverLog();
  const { root, state } = fakeBootScreen(240);
  const dispose = fitDesktopMainWindowToBootScreen(root, {
    resize: (width, height) => calls.push([width, height]),
    screen: { availHeight: 1000 },
    view: fakeView({
      ResizeObserver: fakeObserverCtor(resizeLog),
      MutationObserver: fakeObserverCtor(mutationLog)
    }),
    schedule: (run) => run()
  });
  dispose();
  assert.equal(resizeLog.disconnected, 1);
  assert.equal(mutationLog.disconnected, 1);
  // 摘干净之后即使观察者还漏进来一拍，也不再下发（换屏时旧观察者不会和新的抢着改窗口）。
  state.card = { offsetHeight: 500 };
  resizeLog.callbacks[0]?.();
  mutationLog.callbacks[0]?.();
  assert.equal(calls.length, 1);
  dispose();
  assert.equal(resizeLog.disconnected, 1, "重复 dispose 是幂等的");
});

test("fitDesktopMainWindowToBootScreen degrades to a single measurement when observers are unavailable", () => {
  const calls: Array<[number, number]> = [];
  const { root } = fakeBootScreen(240);
  const dispose = fitDesktopMainWindowToBootScreen(root, {
    resize: (width, height) => calls.push([width, height]),
    screen: { availHeight: 1000 },
    // 浏览器开发态/精简环境没有观察者：首次贴合照样发生，之后只是不再跟随。
    view: fakeView(),
    schedule: (run) => run()
  });
  assert.equal(calls.length, 1);
  dispose();
});

// —— 接线契约：三张 boot 屏的量高锚点 + 外壳 padding 必须与本模块的加法同源 ——
// CSS 的 padding 一旦大过 desktopBootScreenFitPaddingPx，窗口就会重新开始裁卡片边缘（正是这次要修的
// 现象）；锚点一旦掉了，量高会退回根节点、窗口只长不缩。两条都在这里钉死。

function ruleBody(css: string, className: string): string {
  const match = new RegExp(`\\.${className}\\{([^}]*)\\}`, "u").exec(css);
  assert.ok(match?.[1], `找不到 .${className} 规则`);
  return match[1] ?? "";
}

function rulePadding(css: string, className: string): string | undefined {
  return /(?:^|;)padding:([^;]+)/u.exec(ruleBody(css, className))?.[1];
}

const bootScreens: Array<{ name: string; shell: string; html: string }> = [
  {
    name: "首启/重绑昵称屏",
    shell: "wh-desktop-rebind-shell",
    html: renderDesktopRebindScreenHtml({ locale: "zh-CN", context: "first-run" })
  },
  {
    name: "密码模式凭据门",
    shell: "wh-desktop-login-shell",
    html: renderDesktopCredentialGateHtml({ locale: "zh-CN", context: "first-run" })
  },
  {
    name: "连接服务器屏",
    shell: "wh-connect-shell",
    html: renderDesktopConnectScreenHtml({ locale: "zh-CN" })
  }
];

for (const screen of bootScreens) {
  test(`${screen.shell} carries the boot-screen fit anchor and the shared shell padding`, () => {
    assert.match(
      screen.html,
      new RegExp(`<[a-z]+ ${desktopBootScreenFitAttribute}[ >]`, "u"),
      `${screen.name} 缺量高锚点`
    );
    assert.equal(
      rulePadding(screen.html, screen.shell),
      `${desktopBootScreenFitPaddingPx}px`,
      `${screen.name} 外壳 padding 必须与 desktopBootScreenFitPaddingPx 同源`
    );
    // 三张屏都会整个替换掉 boot 首帧壳（连同 spotlightCss 的 margin 归零一起），自己不补就会吃到
    // UA 默认的 8px body margin：卡片偏移 + 出滚动条 + 窗口比内容矮 8px。
    assert.match(screen.html, /html,body,#root\{margin:0/u, `${screen.name} 没有归零 body margin`);
  });
}

function ruleRadius(css: string, className: string): string | undefined {
  return /(?:^|;)border-radius:([^;]+)/u.exec(ruleBody(css, className))?.[1];
}

test("boot screens keep one rounded-corner language across the three of them", () => {
  // 三张屏都是「原生窗里的一整块卡/面板」，圆角要一致——否则首启换屏时圆角会跳一下。
  const radii = [
    ruleRadius(bootScreens[0]?.html ?? "", "wh-desktop-rebind-card"),
    ruleRadius(bootScreens[1]?.html ?? "", "wh-desktop-login-card"),
    ruleRadius(bootScreens[2]?.html ?? "", "wh-connect-panel")
  ];
  assert.deepEqual(radii, ["22px", "22px", "22px"]);
});
