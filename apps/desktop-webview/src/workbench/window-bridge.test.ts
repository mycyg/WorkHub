import assert from "node:assert/strict";
import { test } from "node:test";

import { isMacOsWebview, resolveWorkbenchWindowBridge } from "./window-bridge.js";

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

// R13 批 V2:自绘 min/close 在 macOS 隐藏（原生红绿灯接管）靠这个判定——见 window-bridge.ts 顶部注释。

test("isMacOsWebview is false with no navigator at all (e.g. a bare object in tests)", () => {
  assert.equal(isMacOsWebview({}), false);
});

test("isMacOsWebview prefers navigator.userAgentData.platform when present", () => {
  assert.equal(isMacOsWebview({ navigator: { userAgentData: { platform: "macOS" } } }), true);
  assert.equal(isMacOsWebview({ navigator: { userAgentData: { platform: "Windows" } } }), false);
});

test("isMacOsWebview falls back to navigator.platform", () => {
  assert.equal(isMacOsWebview({ navigator: { platform: "MacIntel" } }), true);
  assert.equal(isMacOsWebview({ navigator: { platform: "Win32" } }), false);
  assert.equal(isMacOsWebview({ navigator: { platform: "Linux x86_64" } }), false);
});

test("isMacOsWebview falls back to navigator.userAgent as a last resort", () => {
  assert.equal(
    isMacOsWebview({
      navigator: { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15" }
    }),
    true
  );
  assert.equal(
    isMacOsWebview({ navigator: { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } }),
    false
  );
});

test("isMacOsWebview treats an empty-string platform/userAgentData as absent and keeps checking fallbacks", () => {
  assert.equal(
    isMacOsWebview({
      navigator: {
        userAgentData: { platform: "" },
        platform: "",
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"
      }
    }),
    true
  );
});
