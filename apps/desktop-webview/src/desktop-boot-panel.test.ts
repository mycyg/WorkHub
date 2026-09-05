import { strict as assert } from "node:assert";
import { test } from "node:test";

import { designSystem } from "./design-system.js";
import {
  desktopBootPanel,
  desktopBootPanelClass,
  desktopBootPanelShellClass,
  renderDesktopBootPanelHtml
} from "./desktop-boot-panel.js";
import { desktopBootScreenFitAttribute } from "./desktop-boot-screen-fit.js";
import { renderDesktopConnectScreenHtml } from "./desktop-connect-screen.js";
import { renderDesktopCredentialGateHtml } from "./desktop-login.js";
import { renderDesktopRebindScreenHtml } from "./desktop-rebind.js";

// R24 I（走查 M-09）：主窗首启的三张屏必须是同一张玻璃面板。
// 此前只有连接屏是液态玻璃，昵称首启屏与凭据门是 rgba(255,255,255,.86) 的白卡 + backdrop-filter——
// 而 backdrop-filter 在透明 + 原生 vibrancy 的 Tauri 主窗里是空操作，用户看到的是灰底上一张白纸。
// 这个文件把「三张屏共用一份面板」钉死：玻璃层、高光描边、量高锚点、设计系统注入、深色可读，
// 以及各屏赖以接线的 data-* 钩子一个都不能少。

const screens: Array<{ name: string; html: string; hooks: string[] }> = [
  {
    name: "首启/重绑昵称屏",
    html: renderDesktopRebindScreenHtml({ locale: "zh-CN", context: "first-run" }),
    hooks: [
      "data-desktop-rebind-form",
      "data-desktop-rebind-nickname",
      "data-desktop-rebind ",
      "data-desktop-rebind-error"
    ]
  },
  {
    name: "密码模式凭据门",
    html: renderDesktopCredentialGateHtml({ locale: "zh-CN", context: "first-run" }),
    hooks: [
      "data-desktop-login-form",
      "data-desktop-login-email",
      "data-desktop-login-password",
      "data-desktop-login-submit",
      "data-desktop-login-error",
      'data-desktop-login-tab="signin"',
      'data-desktop-login-tab="register"',
      'data-desktop-login-tab="invite"',
      'data-desktop-login-panel="signin"',
      "data-desktop-register-form",
      "data-desktop-register-email",
      "data-desktop-register-nickname",
      "data-desktop-register-password",
      "data-desktop-register-submit",
      "data-desktop-register-error",
      "data-desktop-invite-form",
      "data-desktop-invite-token",
      "data-desktop-invite-nickname",
      "data-desktop-invite-password",
      "data-desktop-invite-submit",
      "data-desktop-invite-error"
    ]
  },
  {
    name: "连接服务器屏",
    html: renderDesktopConnectScreenHtml({ locale: "zh-CN" }),
    hooks: [
      "data-desktop-connect-form",
      "data-desktop-connect-address",
      "data-desktop-connect-test",
      "data-desktop-connect-confirm",
      "data-desktop-connect-status"
    ]
  }
];

for (const screen of screens) {
  test(`${screen.name} renders through the shared liquid-glass boot panel`, () => {
    // 玻璃三件套：折射/雾面层（spotlight 口径）+ 高光描边 + 内容层。缺任何一层都会掉回平面卡。
    assert.match(screen.html, /wh-liquid-glass-warp wh-liquid-glass-warp--spotlight/u, "缺玻璃层");
    assert.match(screen.html, /<span class="wh-liquid-glass-rim" aria-hidden="true"><\/span>/u, "缺高光描边");
    assert.match(screen.html, /<div class="wh-liquid-glass-content">/u, "缺玻璃内容层");
    // 外壳类 + 面板类都来自共享模块（各屏自己的类名只是定位钩子）。
    assert.ok(screen.html.includes(`class="${designSystem.rootClass} ${desktopBootPanelShellClass}`), "外壳缺共享类");
    assert.ok(screen.html.includes(`class="${desktopBootPanelClass}"`), "缺共享面板类");
    // 圆体字 <link>：三张屏都自带注入（此前只有连接屏有，另两张写了字体却从不加载）。
    assert.match(screen.html, /fonts\.googleapis\.com\/css2\?family=M\+PLUS\+Rounded\+1c/u, "缺圆体字注入");
  });

  test(`${screen.name} keeps the window-fit anchor on the shared panel`, () => {
    // 贴合逻辑（desktop-boot-screen-fit.ts）量的就是这个锚点；掉了会退回量根节点，窗口只长不缩。
    assert.match(
      screen.html,
      new RegExp(`<section ${desktopBootScreenFitAttribute} class="${desktopBootPanelClass}"`, "u"),
      "量高锚点必须打在共享面板本体上"
    );
  });

  test(`${screen.name} injects the design system so its utility classes are live`, () => {
    // W-H 交接：三张屏模板里早就写着 ds-pressable，但从没注入过 appleGlassDesignSystemCss——一直是死类。
    assert.match(screen.html, /--ds-spring:\s*cubic-bezier\(\.34,1\.56,\.64,1\)/u, "缺设计系统 token");
    assert.match(screen.html, /\.wh-ds \.ds-pressable:active\{transform:scale\(\.94\)\}/u, "缺 ds-pressable 定义");
    assert.match(screen.html, /class="[^"]*ds-pressable[^"]*"/u, "面板里应当有按压回弹的按钮");
  });

  test(`${screen.name} drops the flat white card and stays readable in dark appearance`, () => {
    // 旧白卡的两个特征值：.86 白底 + 18px backdrop-filter（后者在透明 vibrancy 窗里根本不生效）。
    assert.doesNotMatch(screen.html, /rgba\(255,255,255,\.86\)/u, "还留着旧白卡底色");
    assert.doesNotMatch(screen.html, /backdrop-filter:blur\(18px\)/u, "还留着失效的 backdrop-filter 白卡");
    // 深色可读：文字色走 CanvasText/color-mix，且有一段深色外观下的补偿（白光晕换暗光晕）。
    assert.match(screen.html, /color:CanvasText/u, "文字色必须跟随系统外观");
    assert.match(screen.html, /@media \(prefers-color-scheme: dark\)/u, "缺深色外观补偿");
    assert.match(
      screen.html,
      /@media \(prefers-color-scheme: dark\)\{[^@]*text-shadow:0 1px 12px rgba\(0,0,0,/u,
      "深色下必须把白色文字光晕换成暗光晕"
    );
  });

  test(`${screen.name} keeps every data hook its wiring queries`, () => {
    for (const hook of screen.hooks) {
      assert.ok(screen.html.includes(hook), `${screen.name} 少了接线钩子 ${hook}`);
    }
  });
}

test("the three boot screens share one panel geometry", () => {
  // 宽度/圆角/内边距只在共享模块里定义一次——三张屏渲出来的值必须逐字相同，否则换屏会跳。
  const geometry = screens.map((screen) => ({
    width: /width:min\(540px,100%\)/u.test(screen.html),
    radius: /border-radius:22px/u.test(screen.html),
    padding: /padding:30px 30px 26px/u.test(screen.html)
  }));
  assert.deepEqual(geometry, [
    { width: true, radius: true, padding: true },
    { width: true, radius: true, padding: true },
    { width: true, radius: true, padding: true }
  ]);
  // 420px 白卡时代的宽度上限不该再出现在任何一张屏里。
  for (const screen of screens) {
    assert.doesNotMatch(screen.html, /max-width:min\(420px/u, `${screen.name} 还钉着旧的 420px 卡宽`);
  }
});

test("renderDesktopBootPanelHtml puts the caller's content inside the glass, after the brand mark", () => {
  const html = renderDesktopBootPanelHtml({ inner: "<h1>hello</h1>", shellClass: "wh-demo-shell" });
  assert.ok(
    html.includes(
      `<div class="wh-liquid-glass-content"><div class="${desktopBootPanel.mark}" aria-hidden="true"></div><h1>hello</h1></div>`
    ),
    "内容必须落在玻璃内容层里、品牌方块之后"
  );
  // 外壳可以额外挂各屏自己的类钩子。
  assert.ok(html.includes(`${desktopBootPanelShellClass} wh-demo-shell"`), "外壳缺调用方的类钩子");
});

test("renderDesktopBootPanelHtml appends per-screen css after the shared css so it can override", () => {
  const html = renderDesktopBootPanelHtml({ inner: "", extraCss: ".wh-demo{color:red}" });
  const sharedAt = html.indexOf(`.${desktopBootPanelClass}{`);
  const extraAt = html.indexOf(".wh-demo{color:red}");
  assert.ok(sharedAt >= 0 && extraAt > sharedAt, "各屏补充样式必须排在共享样式之后");
});

test("renderDesktopBootPanelHtml forwards extra panel attributes (connect screen's aria-live)", () => {
  const html = renderDesktopBootPanelHtml({ inner: "", panelAttrs: 'aria-live="polite"' });
  assert.match(html, new RegExp(`class="${desktopBootPanelClass}" aria-live="polite"`, "u"));
  // 连接屏的结果卡靠它播报，别的屏不传就不该出现这个属性。
  assert.doesNotMatch(renderDesktopBootPanelHtml({ inner: "" }), /aria-live/u);
});
