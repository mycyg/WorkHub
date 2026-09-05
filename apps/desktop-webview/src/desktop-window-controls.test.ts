import assert from "node:assert/strict";
import test from "node:test";

import { dismissDesktopMainWindow, dragDesktopMainWindow, moveDesktopMainWindowBy, resizeDesktopMainWindow } from "./desktop-window-controls.js";

// D-01（R23 精简批）：这条用例原来住在 apps/desktop-webview/src/main.test.ts（main.ts 死 barrel 的自证
// 测试文件），但测的是 desktop-window-controls.ts 的真实行为——该模块没有自己的测试文件，main.ts 删除后
// 随之搬到这里，断言原样保留。

// R9.7: the old native-command assertion grepped browser.ts for invoke strings.
// That was wrong because source text did not prove the injected commands call Tauri with the right payloads.
test("desktop native window commands invoke movement without resize-drag plumbing", () => {
  const calls: Array<{ command: string; args?: Record<string, unknown> | undefined }> = [];
  const scope = {
    __TAURI__: {
      core: {
        invoke(command: string, args?: Record<string, unknown>) {
          calls.push({ command, args });
          return Promise.resolve();
        }
      }
    }
  };

  assert.equal(resizeDesktopMainWindow(480, 320, false, scope), true);
  assert.equal(dragDesktopMainWindow(scope), true);
  assert.equal(moveDesktopMainWindowBy(12, -8, scope), true);
  assert.equal(dismissDesktopMainWindow(scope), true);
  assert.equal(dragDesktopMainWindow({}), false);
  assert.deepEqual(calls, [
    { command: "set_spotlight_size", args: { width: 480, height: 320, reducedMotion: false } },
    { command: "start_main_window_drag", args: undefined },
    { command: "move_main_window_by", args: { deltaX: 12, deltaY: -8 } },
    { command: "hide_main_window", args: undefined }
  ]);
  assert.equal(calls.some((call) => call.command === "start_main_window_resize_drag"), false);
});

// R25（BX-06）：壳层的生长补间由 webview 递进来的 reducedMotion 关掉——这一位必须真的到得了
// invoke 载荷里，否则「减弱动态效果」开着的机器仍会看到 180ms 的补间。
test("spotlight resize forwards the reduced-motion flag so the shell can skip its growth tween", () => {
  const calls: Array<Record<string, unknown> | undefined> = [];
  const scope = {
    __TAURI__: {
      core: {
        invoke(_command: string, args?: Record<string, unknown>) {
          calls.push(args);
          return Promise.resolve();
        }
      }
    }
  };

  resizeDesktopMainWindow(720, 480, true, scope);
  resizeDesktopMainWindow(720, 64, undefined, scope);
  assert.deepEqual(calls, [
    { width: 720, height: 480, reducedMotion: true },
    // 省略该实参时按"照常补间"处理（老调用点不必逐个改）。
    { width: 720, height: 64, reducedMotion: false }
  ]);
});
