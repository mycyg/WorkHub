import { strict as assert } from "node:assert";
import { test } from "node:test";

import { liquidGlassCss } from "./liquid-glass.js";
import { spotlightCss } from "./spotlight/css.js";

const forbiddenPurple = /#5a45d8|#7c83ff|#b57bff|rgba\(124,131,255|rgba\(90,69,216/u;

test("desktop glass surfaces use Apple system blue/cyan instead of the old purple accent", () => {
  // DSK-01：decision-deck/team-calendar/projects-page/project-drive 已随死 boot() 一并删除；
  // WIRE-05：commandPaletteCss（死命令面板浮层样式）也已删——这份视觉语言校验只覆盖仍在生产的
  // surface（liquid-glass / spotlight）。
  const css = [
    liquidGlassCss,
    spotlightCss
  ].join("");

  assert.match(css, /#0a84ff/u);
  assert.match(css, /#64d2ff/u);
  assert.doesNotMatch(css, forbiddenPurple);
});

test("liquid glass app shell has Apple-blue primary controls", () => {
  assert.match(liquidGlassCss, /\.wh-app-mark\{[^}]*conic-gradient\(from 130deg,#0a84ff,#64d2ff,#30d158,#0a84ff\)/u);
  assert.match(liquidGlassCss, /\.wh-app-content \.wh-btn-primary\{[^}]*linear-gradient\(135deg,#0a84ff,#64d2ff\)/u);
});
