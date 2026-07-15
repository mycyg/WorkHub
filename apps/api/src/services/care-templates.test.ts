import assert from "node:assert/strict";
import test from "node:test";

import type { CareSignalType } from "@workhub/db";

import { careConversationText } from "./proactive-intents.js";

const SIGNAL_TYPES: CareSignalType[] = ["high_load", "late_night", "frustration"];

// 文案红线（负责人逐条审）：不评价工作表现、不施压、不卖惨、无 emoji、不引用具体信号细节。
const BANNED_FRAGMENTS = [
  "2 点", "两点", "凌晨", "逾期", "打回", "件工作", "提案", "绩效", "表现差", "必须", "赶紧", "快点"
];
// 无 emoji：粗筛常见表情区段。
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u;

test("careConversationText returns a non-empty human template for every signal type", () => {
  for (const signalType of SIGNAL_TYPES) {
    const text = careConversationText({ signalType, rotationKey: `care:u1:${signalType}:20260713` });
    assert.equal(typeof text, "string");
    assert.ok(text.length >= 8, `template for ${signalType} should read like a sentence`);
  }
});

test("careConversationText selection is deterministic for the same rotationKey (stable, not random)", () => {
  for (const signalType of SIGNAL_TYPES) {
    const key = `care:u1:${signalType}:20260713`;
    const a = careConversationText({ signalType, rotationKey: key });
    const b = careConversationText({ signalType, rotationKey: key });
    const c = careConversationText({ signalType, rotationKey: key });
    assert.equal(a, b);
    assert.equal(b, c);
  }
});

test("careConversationText rotates across different rotationKeys (more than one template exists)", () => {
  for (const signalType of SIGNAL_TYPES) {
    const seen = new Set<string>();
    for (let week = 0; week < 30; week += 1) {
      seen.add(careConversationText({ signalType, rotationKey: `care:u1:${signalType}:2026-w${week}` }));
    }
    assert.ok(seen.size >= 2, `${signalType} should rotate through multiple templates across keys`);
  }
});

test("careConversationText never leaks specific signal details, pressure, or emoji", () => {
  for (const signalType of SIGNAL_TYPES) {
    // 扫全部模板（用足够多的 key 覆盖每个下标）。
    const texts = new Set<string>();
    for (let i = 0; i < 60; i += 1) {
      texts.add(careConversationText({ signalType, rotationKey: `k${i}` }));
    }
    for (const text of texts) {
      assert.ok(!EMOJI_RE.test(text), `care copy must not contain emoji: ${text}`);
      for (const banned of BANNED_FRAGMENTS) {
        assert.ok(!text.includes(banned), `care copy must not mention "${banned}": ${text}`);
      }
    }
  }
});
