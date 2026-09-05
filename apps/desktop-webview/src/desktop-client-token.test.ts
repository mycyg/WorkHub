import assert from "node:assert/strict";
import test from "node:test";

import {
  clearDesktopClientToken,
  readDesktopClientToken,
  writeDesktopClientToken
} from "./desktop-client-token.js";

// DSK-06：令牌读写的单一收口——键顺序（新键优先、兼容期回退 yqgl_* 旧键）只在这里定义一次。

function fakeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key)
  };
}

test("readDesktopClientToken reads the new key first, then falls back to the legacy yqgl key", () => {
  assert.equal(readDesktopClientToken(fakeStorage({ workhub_client_token: "new-token" })), "new-token");
  assert.equal(readDesktopClientToken(fakeStorage({ yqgl_client_token: "legacy-token" })), "legacy-token");
  assert.equal(
    readDesktopClientToken(fakeStorage({ workhub_client_token: "new-token", yqgl_client_token: "legacy-token" })),
    "new-token"
  );
  assert.equal(readDesktopClientToken(fakeStorage()), undefined);
});

test("writeDesktopClientToken writes only the new key (legacy key is being retired)", () => {
  const storage = fakeStorage({ yqgl_client_token: "legacy-token" });
  writeDesktopClientToken(storage, "fresh-token");
  assert.equal(storage.values.get("workhub_client_token"), "fresh-token");
  assert.equal(storage.values.get("yqgl_client_token"), "legacy-token", "write must not mirror into the legacy key");
});

test("clearDesktopClientToken removes both keys", () => {
  const storage = fakeStorage({ workhub_client_token: "a", yqgl_client_token: "b" });
  clearDesktopClientToken(storage);
  assert.equal(readDesktopClientToken(storage), undefined);
});
