import assert from "node:assert/strict";
import test from "node:test";

import {
  applyGlassAlphaOverride,
  GLASS_ALPHA_GLOBAL_KEY,
  GLASS_ALPHA_STORAGE_KEY,
  glassAlphaCustomProperties,
  readGlassAlphaSource,
  resolveGlassAlphaOverride
} from "./desktop-glass-alpha.js";

function fakeHost() {
  const written: Array<[string, string]> = [];
  return {
    written,
    style: {
      setProperty(name: string, value: string) {
        written.push([name, value]);
      }
    }
  };
}

test("没置位时解析结果为 null，宿主元素一个字节都不动", () => {
  assert.equal(resolveGlassAlphaOverride({}), null);
  assert.equal(resolveGlassAlphaOverride({ globalValue: undefined, storedValue: null }), null);
  const host = fakeHost();
  assert.equal(applyGlassAlphaOverride(host, {}), null);
  assert.deepEqual(host.written, []);
});

test("全局值优先于本地存储；字符串与数字都收", () => {
  assert.equal(resolveGlassAlphaOverride({ globalValue: 0.5, storedValue: "0.9" }), 0.5);
  assert.equal(resolveGlassAlphaOverride({ storedValue: " 0.45 " }), 0.45);
  assert.equal(resolveGlassAlphaOverride({ globalValue: "0.62" }), 0.62);
});

test("越界/垃圾值一律当作没置位——全透明盒子读不了字", () => {
  for (const bad of [0, -0.2, 1.4, Number.NaN, "abc", true, {}, []]) {
    assert.equal(resolveGlassAlphaOverride({ globalValue: bad }), null, `should reject ${String(bad)}`);
  }
});

test("覆写写的是渐变两端 + ds-glass-strong，底端按 .77 比例更透一档", () => {
  assert.deepEqual(glassAlphaCustomProperties(0.5), [
    ["--wh-spot-glass-top", "rgba(255,255,255,0.5)"],
    ["--wh-spot-glass-bottom", "rgba(255,255,255,0.39)"],
    ["--ds-glass-strong", "rgba(255,255,255,0.5)"]
  ]);
  const host = fakeHost();
  assert.equal(applyGlassAlphaOverride(host, { globalValue: 0.45 }), 0.45);
  assert.deepEqual(host.written, [
    ["--wh-spot-glass-top", "rgba(255,255,255,0.45)"],
    ["--wh-spot-glass-bottom", "rgba(255,255,255,0.35)"],
    ["--ds-glass-strong", "rgba(255,255,255,0.45)"]
  ]);
});

test("默认 .78 走覆写路径时与 css.ts 里写死的默认值一致（.78 / .6）", () => {
  assert.deepEqual(glassAlphaCustomProperties(0.78), [
    ["--wh-spot-glass-top", "rgba(255,255,255,0.78)"],
    ["--wh-spot-glass-bottom", "rgba(255,255,255,0.6)"],
    ["--ds-glass-strong", "rgba(255,255,255,0.78)"]
  ]);
});

test("读取源：window 缺席或 localStorage 抛错都不炸", () => {
  assert.deepEqual(readGlassAlphaSource(undefined), {});
  assert.deepEqual(readGlassAlphaSource(null), {});
  const throwing = {
    localStorage: {
      getItem() {
        throw new Error("storage disabled");
      }
    }
  };
  assert.deepEqual(readGlassAlphaSource(throwing), { globalValue: undefined, storedValue: undefined });
  const seeded: Record<string, unknown> = {
    localStorage: { getItem: (key: string) => (key === GLASS_ALPHA_STORAGE_KEY ? "0.4" : null) }
  };
  seeded[GLASS_ALPHA_GLOBAL_KEY] = 0.55;
  assert.deepEqual(readGlassAlphaSource(seeded), { globalValue: 0.55, storedValue: "0.4" });
});
