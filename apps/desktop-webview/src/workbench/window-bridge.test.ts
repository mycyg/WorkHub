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
  // The handle exists but exposes none of the three methods → no bridge to offer.
  assert.equal(bridge, undefined);
});
