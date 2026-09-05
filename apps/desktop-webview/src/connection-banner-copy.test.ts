import assert from "node:assert/strict";
import { test } from "node:test";

import { desktopConnectionBannerText } from "./connection-banner-copy.js";

test("desktopConnectionBannerText returns undefined when connected (nothing to show)", () => {
  assert.equal(desktopConnectionBannerText("connected", "zh-CN"), undefined);
  assert.equal(desktopConnectionBannerText("connected", "en-US"), undefined);
});

test("desktopConnectionBannerText reconnecting/offline copy follows locale", () => {
  assert.equal(desktopConnectionBannerText("reconnecting", "zh-CN"), "服务器连不上，正在重连…");
  assert.equal(desktopConnectionBannerText("reconnecting", "en-US"), "Can't reach the server — reconnecting…");
  assert.equal(desktopConnectionBannerText("offline", "zh-CN"), "已离线");
  assert.equal(desktopConnectionBannerText("offline", "en-US"), "Offline");
});
