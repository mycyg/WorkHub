import assert from "node:assert/strict";
import test from "node:test";

import { browserLocale } from "./locale.js";

test("browserLocale reads a stored locale preference", () => {
  const storage = {
    getItem: () => "en-US"
  } as unknown as Storage;
  assert.equal(browserLocale({ storage, navigatorLanguage: "zh-CN" }), "en-US");
});

test("browserLocale falls back to navigator language when nothing is stored", () => {
  const storage = {
    getItem: () => null
  } as unknown as Storage;
  assert.equal(browserLocale({ storage, navigatorLanguage: "en-GB" }), "en-US");
});

test("browserLocale tolerates a throwing storage getter (private mode / disabled storage)", () => {
  // L#69：隐私模式/禁用存储下 getItem 可能抛错——不应中断 bootstrap，退化为 navigator 语言。
  const storage = {
    getItem: () => {
      throw new Error("storage disabled");
    }
  } as unknown as Storage;
  assert.equal(browserLocale({ storage, navigatorLanguage: "zh-CN" }), "zh-CN");
});

test("browserLocale tolerates undefined storage (SSR / non-DOM)", () => {
  assert.equal(browserLocale({ storage: undefined, navigatorLanguage: "zh-CN" }), "zh-CN");
});
