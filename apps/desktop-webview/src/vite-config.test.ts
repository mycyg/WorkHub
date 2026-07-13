import assert from "node:assert/strict";
import test from "node:test";

import viteConfig from "../vite.config.js";

test("desktop webview build uses relative asset URLs for the embedded Tauri webview", () => {
  assert.equal(viteConfig.base, "./");
  const input = viteConfig.build?.rollupOptions?.input as Record<string, string> | undefined;
  assert.match(input?.main ?? "", /index\.html$/u);
  assert.match(input?.pet ?? "", /pet\.html$/u);
  // R12 批 1：工作台窗口是独立的 Tauri webview（workbench.html → src/workbench/boot.ts），
  // 必须有自己的 rollup 入口，否则真机打包会 404。
  assert.match(input?.workbench ?? "", /workbench\.html$/u);
});
