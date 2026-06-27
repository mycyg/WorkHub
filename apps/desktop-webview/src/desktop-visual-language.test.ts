import { strict as assert } from "node:assert";
import { test } from "node:test";

import { commandPaletteCss } from "./command-palette.js";
import { decisionDeckCss } from "./decision-deck.js";
import { liquidGlassCss } from "./liquid-glass.js";
import { projectDriveCss } from "./project-drive.js";
import { projectsPageCss } from "./projects-page.js";
import { spotlightCss } from "./spotlight/css.js";
import { teamCalendarCss } from "./team-calendar.js";

const forbiddenPurple = /#5a45d8|#7c83ff|#b57bff|rgba\(124,131,255|rgba\(90,69,216/u;

test("desktop glass surfaces use Apple system blue/cyan instead of the old purple accent", () => {
  const css = [
    commandPaletteCss,
    decisionDeckCss,
    liquidGlassCss,
    projectDriveCss,
    projectsPageCss,
    spotlightCss,
    teamCalendarCss
  ].join("");

  assert.match(css, /#0a84ff/u);
  assert.match(css, /#64d2ff/u);
  assert.doesNotMatch(css, forbiddenPurple);
});

test("liquid glass app shell has Apple-blue primary controls", () => {
  assert.match(liquidGlassCss, /\.wh-app-mark\{[^}]*conic-gradient\(from 130deg,#0a84ff,#64d2ff,#30d158,#0a84ff\)/u);
  assert.match(liquidGlassCss, /\.wh-app-content \.wh-btn-primary\{[^}]*linear-gradient\(135deg,#0a84ff,#64d2ff\)/u);
});
