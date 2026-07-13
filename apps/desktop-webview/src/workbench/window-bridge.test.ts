import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveWorkbenchWindowBridge } from "./window-bridge.js";

test("resolveWorkbenchWindowBridge returns undefined in a plain browser dev preview (no __TAURI__)", () => {
  assert.equal(resolveWorkbenchWindowBridge({}), undefined);
});

test("resolveWorkbenchWindowBridge returns undefined when __TAURI__ exposes no current window", () => {
  assert.equal(resolveWorkbenchWindowBridge({ __TAURI__: {} }), undefined);
});

test("resolveWorkbenchWindowBridge forwards startDragging/minimize/hide to the real Tauri window handle", async () => {
  const calls: string[] = [];
  const currentWindow = {
    label: "workbench",
    startDragging: () => {
      calls.push("startDragging");
    },
    minimize: () => {
      calls.push("minimize");
    },
    hide: () => {
      calls.push("hide");
    }
  };
  const bridge = resolveWorkbenchWindowBridge({
    __TAURI__: { window: { getCurrentWindow: () => currentWindow } }
  });
  assert.ok(bridge);
  await bridge?.startDragging?.();
  await bridge?.minimize?.();
  await bridge?.hide?.();
  assert.deepEqual(calls, ["startDragging", "minimize", "hide"]);
});

test("resolveWorkbenchWindowBridge falls back to getCurrentWebviewWindow when window.getCurrentWindow is absent", async () => {
  const calls: string[] = [];
  const currentWindow = {
    label: "workbench",
    hide: () => {
      calls.push("hide");
    }
  };
  const bridge = resolveWorkbenchWindowBridge({
    __TAURI__: { webviewWindow: { getCurrentWebviewWindow: () => currentWindow } }
  });
  assert.ok(bridge);
  assert.equal(bridge?.startDragging, undefined);
  assert.equal(bridge?.minimize, undefined);
  await bridge?.hide?.();
  assert.deepEqual(calls, ["hide"]);
});

test("resolveWorkbenchWindowBridge omits methods the current window handle does not expose", () => {
  const bridge = resolveWorkbenchWindowBridge({
    __TAURI__: { window: { getCurrentWindow: () => ({ label: "workbench" }) } }
  });
  // The handle exists but exposes none of the four methods → no bridge to offer.
  assert.equal(bridge, undefined);
});

// R12 批7:打扰矩阵靠 isFocused() 判断"用户是否正看着这个工作台窗口"。
test("resolveWorkbenchWindowBridge forwards isFocused to the real Tauri window handle", async () => {
  const currentWindow = {
    label: "workbench",
    isFocused: () => Promise.resolve(true)
  };
  const bridge = resolveWorkbenchWindowBridge({
    __TAURI__: { window: { getCurrentWindow: () => currentWindow } }
  });
  assert.ok(bridge);
  assert.equal(await bridge?.isFocused?.(), true);
});

test("resolveWorkbenchWindowBridge omits isFocused when the current window handle does not expose it", () => {
  const bridge = resolveWorkbenchWindowBridge({
    __TAURI__: { window: { getCurrentWindow: () => ({ label: "workbench", hide: () => {} }) } }
  });
  assert.ok(bridge);
  assert.equal(bridge?.isFocused, undefined);
});
