import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveDesktopRequestLocale } from "./desktop-locale-source.js";

// R24 S4 桌面端接线：resolveDesktopRequestLocale 只服务 spotlight/views/drive.ts 的令牌自愈路径
// （其它调用点直接转发 boot 时已解析好的 locale，见模块顶注）。这里只锁死映射优先级本身——
// 每个用例都显式传 storage/navigatorLanguage，绝不依赖真实 globalThis.navigator（Node 测试运行器
// 自带一个非空的 navigator.language，值随运行环境的系统区域设置变化，断言不能踩这个不确定性）。

function fakeGetItemStorage(value: string | null): Pick<Storage, "getItem"> {
  return { getItem: () => value };
}

test("resolveDesktopRequestLocale prefers a saved locale preference over navigator.language", () => {
  const storage = fakeGetItemStorage("en-US");
  assert.equal(resolveDesktopRequestLocale({ storage, navigatorLanguage: "zh-CN" }), "en-US");
});

test("resolveDesktopRequestLocale falls back to navigator.language when nothing is stored", () => {
  const storage = fakeGetItemStorage(null);
  assert.equal(resolveDesktopRequestLocale({ storage, navigatorLanguage: "en-GB" }), "en-US");
  assert.equal(resolveDesktopRequestLocale({ storage, navigatorLanguage: "zh-Hans-CN" }), "zh-CN");
});

test("resolveDesktopRequestLocale buckets any non-Chinese navigator language into en-US, including unrecognized values", () => {
  const storage = fakeGetItemStorage(null);
  assert.equal(resolveDesktopRequestLocale({ storage, navigatorLanguage: "fr-FR" }), "en-US");
  assert.equal(resolveDesktopRequestLocale({ storage, navigatorLanguage: "ja-JP" }), "en-US");
});

test("resolveDesktopRequestLocale falls back to the default when neither storage nor navigator language is available", () => {
  const storage = fakeGetItemStorage(null);
  // 用空字符串（而非 undefined）显式模拟「没有 navigator.language 信号」——undefined 会被 `??`
  // 当作「没传，用真实 globalThis.navigator.language」，那个值在 Node 测试运行器里非空且随宿主
  // 系统区域设置变化，会悄悄绕过这条分支要测的「两者皆无」路径。
  assert.equal(resolveDesktopRequestLocale({ storage, navigatorLanguage: "" }), "zh-CN");
});

test("resolveDesktopRequestLocale tolerates a throwing storage getter (private mode / disabled storage)", () => {
  const storage: Pick<Storage, "getItem"> = {
    getItem: () => {
      throw new Error("storage disabled");
    }
  };
  assert.equal(resolveDesktopRequestLocale({ storage, navigatorLanguage: "en-US" }), "en-US");
});

test("resolveDesktopRequestLocale tolerates an undefined storage (no window.localStorage)", () => {
  assert.equal(resolveDesktopRequestLocale({ storage: undefined, navigatorLanguage: "zh-CN" }), "zh-CN");
});
