import assert from "node:assert/strict";
import { test } from "node:test";

import { cuuT } from "@workhub/cuu";
import { goldPathT } from "@workhub/ui/gold-path";

// CHAT-10：桌宠（@workhub/cuu）与 web 端（@workhub/ui gold-path）的状态文案同 key 对齐——
// 以 web 端为准。这条测试把「同一件事两端说同一句话」钉成回归守卫，改任何一端都会在这里撞上。
const STATE_KEYS = [
  "state.idle",
  "state.thinking",
  "state.asking_approval",
  "state.carrying_document",
  "state.searching_evidence",
  "state.syncing_files",
  "state.worried",
  "state.revision_requested",
  "state.celebrating",
  "state.offline"
] as const;

test("cuu pet state labels match the web gold-path labels for every shared state key", () => {
  for (const locale of ["zh-CN", "en-US"] as const) {
    for (const key of STATE_KEYS) {
      assert.equal(
        cuuT(locale, key),
        goldPathT(locale, key),
        `${locale} ${key} must read the same on the pet and on web`
      );
    }
  }
  // 钉几个关键文案，防「两端一起改歪了」测试还绿。
  assert.equal(cuuT("zh-CN", "state.thinking"), "整理中");
  assert.equal(cuuT("zh-CN", "state.asking_approval"), "等你点一下");
  assert.equal(cuuT("en-US", "state.thinking"), "Organizing");
});
