import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultDesktopApiBase,
  normalizeDesktopApiBase,
  resolveDesktopApiBaseFromStorage
} from "./desktop-api-base.js";

// DSK-05：workhub_api_base 只接受 http/https 绝对地址并归一化；非法值读取端按未配置回落。

function fakeStorage(values: Record<string, string>): Pick<Storage, "getItem"> {
  return { getItem: (key) => values[key] ?? null };
}

test("normalizeDesktopApiBase accepts http/https and strips trailing slashes", () => {
  assert.equal(normalizeDesktopApiBase("http://127.0.0.1:8787"), "http://127.0.0.1:8787");
  assert.equal(normalizeDesktopApiBase("  https://workhub.example///  "), "https://workhub.example");
  assert.equal(normalizeDesktopApiBase("http://192.168.1.5:9000/"), "http://192.168.1.5:9000");
  assert.equal(normalizeDesktopApiBase("https://workhub.example/api/"), "https://workhub.example/api");
});

test("normalizeDesktopApiBase rejects non-http(s) schemes and malformed values", () => {
  assert.equal(normalizeDesktopApiBase("javascript:alert(1)"), undefined);
  assert.equal(normalizeDesktopApiBase("file:///etc/passwd"), undefined);
  assert.equal(normalizeDesktopApiBase("data:text/html,<h1>"), undefined);
  assert.equal(normalizeDesktopApiBase("workhub.example"), undefined, "no scheme = not an absolute base");
  assert.equal(normalizeDesktopApiBase("not a url"), undefined);
  assert.equal(normalizeDesktopApiBase(""), undefined);
  assert.equal(normalizeDesktopApiBase("   "), undefined);
  assert.equal(normalizeDesktopApiBase(null), undefined);
  assert.equal(normalizeDesktopApiBase(undefined), undefined);
});

test("normalizeDesktopApiBase rejects URLs with credentials, query or hash", () => {
  assert.equal(normalizeDesktopApiBase("http://user:pass@workhub.example"), undefined);
  assert.equal(normalizeDesktopApiBase("http://workhub.example/?token=abc"), undefined);
  assert.equal(normalizeDesktopApiBase("http://workhub.example/#frag"), undefined);
});

test("resolveDesktopApiBaseFromStorage falls back to the loopback default on missing or invalid values", () => {
  const fallback = defaultDesktopApiBase();
  assert.equal(resolveDesktopApiBaseFromStorage(fakeStorage({})), fallback);
  assert.equal(
    resolveDesktopApiBaseFromStorage(fakeStorage({ workhub_api_base: "javascript:alert(1)" })),
    fallback,
    "a poisoned stored value must not be used as the API base"
  );
  assert.equal(
    resolveDesktopApiBaseFromStorage(fakeStorage({ workhub_api_base: "https://workhub.example/" })),
    "https://workhub.example"
  );
  // storage 访问本身抛错（隐私模式）也回落默认。
  assert.equal(
    resolveDesktopApiBaseFromStorage({
      getItem() {
        throw new Error("denied");
      }
    }),
    fallback
  );
  assert.equal(resolveDesktopApiBaseFromStorage(undefined), fallback);
});
