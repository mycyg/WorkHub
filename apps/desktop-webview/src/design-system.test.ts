import { strict as assert } from "node:assert";
import { test } from "node:test";

import { appleGlassDesignSystemCss, designSystem } from "./design-system.js";

test("design system exposes scoped tokens under the .wh-ds root", () => {
  // 作用域隔离：所有 token 挂在 .wh-ds 上，绝不污染全局/共享 UI。
  assert.match(appleGlassDesignSystemCss, /\.wh-ds\{[^}]*--ds-accent:\s*#0a84ff/u);
  assert.match(appleGlassDesignSystemCss, /--ds-glass:\s*rgba\(255,255,255,\.52\)/u);
  assert.match(appleGlassDesignSystemCss, /--ds-spring:\s*cubic-bezier\(\.34,1\.56,\.64,1\)/u);
  // SF 圆体字栈（Apple 味）。
  assert.match(appleGlassDesignSystemCss, /-apple-system, "SF Pro Text"/u);
});

test("design system ships the glass surfaces with backdrop blur", () => {
  assert.match(appleGlassDesignSystemCss, /\.wh-ds \.ds-glass\{[^}]*backdrop-filter:blur\(var\(--ds-blur\)\) saturate\(180%\)/u);
  assert.match(appleGlassDesignSystemCss, /\.wh-ds \.ds-glass-strong\{[^}]*-webkit-backdrop-filter/u);
});

test("design system ships motion primitives + respects reduced-motion", () => {
  for (const kf of ["ds-spring-in", "ds-pop", "ds-slide-up", "ds-float"]) {
    assert.ok(appleGlassDesignSystemCss.includes(`@keyframes ${kf}`), `missing keyframes ${kf}`);
  }
  assert.match(appleGlassDesignSystemCss, /@media \(prefers-reduced-motion: reduce\)/u);
  // 错峰入场（灵动列表）。
  assert.match(appleGlassDesignSystemCss, /\.ds-stagger>\*:nth-child\(2\)\{animation-delay:40ms\}/u);
});

test("design system ships interactive micro-interactions (hover lift + press)", () => {
  assert.match(appleGlassDesignSystemCss, /\.ds-interactive:hover\{transform:translateY\(-1px\)\}/u);
  assert.match(appleGlassDesignSystemCss, /\.ds-pressable:active\{transform:scale\(\.94\)\}/u);
});

test("design system primary button uses Apple system blue glass instead of purple", () => {
  assert.match(appleGlassDesignSystemCss, /\.ds-btn-primary\{[^}]*linear-gradient\(135deg,#0a84ff,#64d2ff\)/u);
  assert.doesNotMatch(appleGlassDesignSystemCss, /#5a45d8|#7c83ff|#b57bff/u);
});

test("designSystem class contract matches the emitted CSS (no name drift)", () => {
  // 每个被组件依赖的类名都必须真的在 CSS 里有定义，防拼写漂移。
  const classSelectors: Array<keyof typeof designSystem> = [
    "glass",
    "glassStrong",
    "card",
    "panel",
    "interactive",
    "pressable",
    "btn",
    "btnPrimary",
    "pill",
    "field",
    "springIn",
    "pop",
    "stagger"
  ];
  assert.equal(designSystem.rootClass, "wh-ds");
  for (const key of classSelectors) {
    const cls = designSystem[key];
    assert.ok(
      appleGlassDesignSystemCss.includes(`.${cls}`),
      `class contract "${key}" -> .${cls} has no CSS rule`
    );
  }
});
