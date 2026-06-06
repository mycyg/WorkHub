import assert from "node:assert/strict";
import test from "node:test";

import viteConfig from "../vite.config.js";

test("desktop webview build uses relative asset URLs for the embedded Tauri webview", () => {
  assert.equal(viteConfig.base, "./");
  const input = viteConfig.build?.rollupOptions?.input as Record<string, string> | undefined;
  assert.match(input?.main ?? "", /index\.html$/u);
  assert.match(input?.pet ?? "", /pet\.html$/u);
});
