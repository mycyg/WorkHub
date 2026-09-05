import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { cuuMotionForState } from "@workhub/cuu";

import {
  renderDesktopCuuCatLive2DForIdleAction,
  renderDesktopCuuCatLive2DForMotion,
  resolveDesktopCuuCatLive2DBehaviorState,
  setDesktopCuuCatLive2DBehaviorState
} from "./cuu-cat-live2d-runtime.js";

const testDir = dirname(fileURLToPath(import.meta.url));

test("desktop Live2D runtime resolves behavior manifest state for approval cards", () => {
  const behavior = resolveDesktopCuuCatLive2DBehaviorState({
    state: "asking_approval",
    motion_state: "asking_approval_bounce",
    requested_model_pack_id: "cuu-hijiki-live2d-cubism2"
  });

  assert.equal(behavior.behavior_manifest_version, 1);
  assert.equal(behavior.behavior_state, "asking_approval");
  assert.equal(behavior.behavior_phase, "loop");
  assert.equal(behavior.behavior_window_mode, "card");
  assert.equal(behavior.behavior_bubble_mode, "card");
  assert.equal(behavior.behavior_priority, 90);
  assert.equal(behavior.motion_state, "asking_approval_bounce");
  assert.equal(behavior.renderer_state, "mtn/01.mtn");
  assert.equal(behavior.loop, true);
  assert.equal(behavior.interruptible, false);
});

test("desktop Live2D runtime renders behavior data without introducing another Cuu model", () => {
  const approval = renderDesktopCuuCatLive2DForMotion(cuuMotionForState("asking_approval"));
  const idle = renderDesktopCuuCatLive2DForIdleAction("idle_tail_sway", {
    requested_model_pack_id: "cuu-tororo-live2d-cubism2"
  });

  assert.equal(approval.model_pack_id, "cuu-hijiki-live2d-cubism2");
  assert.equal(approval.behavior_state, "asking_approval");
  assert.equal(approval.behavior_phase, "loop");
  assert.equal(approval.renderer_state, "mtn/01.mtn");
  assert.match(approval.html, /data-cuu-behavior-state="asking_approval"/u);
  assert.match(approval.html, /data-cuu-live2d-motion="asking_approval_bounce"/u);
  assert.match(approval.html, /data-cuu-live2d-renderer-state="mtn\/01\.mtn"/u);
  assert.match(approval.html, /data-cuu-behavior-expected-window-mode="card"/u);

  assert.equal(idle.model_pack_id, "cuu-tororo-live2d-cubism2");
  assert.equal(idle.behavior_state, "idle");
  assert.equal(idle.behavior_phase, "idle_random");
  assert.equal(idle.motion_state, "idle_tail_sway");
  assert.equal(idle.renderer_state, "mtn/00_idle.mtn");
  assert.match(idle.html, /data-cuu-live2d-model="tororo"/u);
  assert.doesNotMatch(`${approval.html}${idle.html}`, /orange|legacy-cuu-pack|experimental_draft_probe/u);
});

test("desktop Live2D behavior patch only updates dataset and preserves iframe markup", () => {
  const live2d = {
    dataset: {} as Record<string, string>
  };
  const root = {
    innerHTML: '<div class="wh-cuu-cat-live2d"><iframe class="wh-cuu-cat-live2d-frame" src="./cuu/live2d/hijiki/cuu-hijiki.html"></iframe></div>',
    querySelector(selector: string) {
      assert.equal(selector, ".wh-cuu-cat-live2d");
      return live2d;
    }
  } as unknown as ParentNode & { innerHTML: string };
  const before = root.innerHTML;

  assert.equal(setDesktopCuuCatLive2DBehaviorState(root, {
    state: "idle",
    motion_state: "look_at_mouse",
    phase: "idle_random"
  }), true);

  assert.equal(root.innerHTML, before);
  assert.equal(live2d.dataset.cuuBehaviorState, "idle");
  assert.equal(live2d.dataset.cuuBehaviorPhase, "idle_random");
  assert.equal(live2d.dataset.cuuLive2dMotion, "look_at_mouse");
  assert.equal(live2d.dataset.cuuLive2dRendererState, "mtn/00_idle.mtn");
  assert.equal(live2d.dataset.cuuBehaviorExpectedWindowMode, "body_only");
});

test("desktop Live2D model pages keep canvas framing proportional across pet scale settings", () => {
  for (const modelPage of [
    "../public/cuu/live2d/hijiki/cuu-hijiki.html",
    "../public/cuu/live2d/tororo/cuu-tororo.html"
  ]) {
    const html = readFileSync(resolve(testDir, modelPage), "utf8");

    assert.match(html, /bottom:\s*-35%;/u);
    assert.match(html, /width:\s*91\.304%;/u);
    assert.match(html, /height:\s*175%;/u);
    assert.doesNotMatch(html, /bottom:\s*-112px|width:\s*210px|height:\s*560px/u);
  }
});

// DSK-04：tauri.conf.json 的 CSP 是 `script-src 'self'`——模型页里的内联 <script> 会被拦死
//（dev 走 vite 无 CSP 所以只有打包后才暴露，桌宠直接黑屏）。回归守卫：模型页只准引用外部 .js，
// 且引导脚本真实存在于同目录。
test("desktop Live2D model pages carry no inline scripts (CSP script-src 'self')", () => {
  for (const modelPage of [
    { html: "../public/cuu/live2d/hijiki/cuu-hijiki.html", boot: "../public/cuu/live2d/hijiki/cuu-hijiki-boot.js" },
    { html: "../public/cuu/live2d/tororo/cuu-tororo.html", boot: "../public/cuu/live2d/tororo/cuu-tororo-boot.js" }
  ]) {
    const html = readFileSync(resolve(testDir, modelPage.html), "utf8");

    // 无内联脚本：剥掉所有 <script src="..."></script> 后不应再出现任何 <script 标签。
    const withoutExternal = html.replace(/<script\s+src="[^"]*"\s*>\s*<\/script>/gu, "");
    assert.doesNotMatch(withoutExternal, /<script/iu, `${modelPage.html} must not carry inline scripts (CSP script-src 'self')`);
    assert.match(html, /<script src="\.\/live2d\.js"><\/script>/u);
    // 引导脚本被引用且真实存在。
    const bootSrc = /<script src="(\.\/cuu-(?:hijiki|tororo)-boot\.js)"><\/script>/u.exec(html)?.[1];
    assert.ok(bootSrc, `${modelPage.html} must reference its external boot script`);
    const bootJs = readFileSync(resolve(testDir, modelPage.boot), "utf8");
    assert.match(bootJs, /loadlive2d\("live2d"/u);
    // 状态经 <html data-live2d-status> 暴露给 QA capture；DSK-13：postMessage 死通道已删，不许复活。
    assert.match(bootJs, /dataset\.live2dStatus/u);
    assert.doesNotMatch(bootJs, /postMessage/u);
  }
});
