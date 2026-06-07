import assert from "node:assert/strict";
import test from "node:test";

import { goldPathT, normalizeWorkHubLocale, workHubLocaleStorageKey } from "./i18n.js";

test("gold path i18n normalizes supported locale aliases", () => {
  assert.equal(normalizeWorkHubLocale("en"), "en-US");
  assert.equal(normalizeWorkHubLocale("en_US"), "en-US");
  assert.equal(normalizeWorkHubLocale("zh-Hans-CN"), "zh-CN");
  assert.equal(normalizeWorkHubLocale("zh_CN"), "zh-CN");
  assert.equal(normalizeWorkHubLocale("fr-FR"), "zh-CN");
});

test("gold path i18n exposes stable storage key and bilingual shell copy", () => {
  assert.equal(workHubLocaleStorageKey, "workhub.locale");
  assert.equal(goldPathT("zh-CN", "home.decisionTitle"), "需要你决定");
  assert.equal(goldPathT("en-US", "home.decisionTitle"), "Needs your decision");
  assert.equal(goldPathT("en-US", "boot.desktop.errorTitle"), "daemon is not connected");
});
