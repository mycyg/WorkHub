import assert from "node:assert/strict";
import { test } from "node:test";

import {
  initialSpotlightState,
  isLauncher,
  launcherMatches,
  openCapabilityId,
  spotlightReducer,
  topMatchId
} from "./state.js";

test("initial state is the launcher with empty query", () => {
  const s = initialSpotlightState();
  assert.equal(isLauncher(s), true);
  assert.equal(s.query, "");
  assert.equal(openCapabilityId(s), undefined);
});

test("typing only filters in launcher mode", () => {
  let s = initialSpotlightState();
  s = spotlightReducer(s, { type: "setQuery", query: "审批" });
  assert.equal(s.query, "审批");
  assert.equal(isLauncher(s), true);
});

test("opening a capability is a pure mode switch (no hash, no side effects)", () => {
  const s = initialSpotlightState();
  const next = spotlightReducer(s, { type: "openCapability", id: "approvals" });
  assert.equal(openCapabilityId(next), "approvals");
  // 原状态不被改动（纯函数）。
  assert.equal(openCapabilityId(s), undefined);
});

test("in capability mode, setQuery is ignored (views own their own input)", () => {
  let s = spotlightReducer(initialSpotlightState(), { type: "openCapability", id: "drive" });
  const before = s;
  s = spotlightReducer(s, { type: "setQuery", query: "anything" });
  assert.equal(s, before);
});

test("back returns to a clean launcher", () => {
  let s = spotlightReducer(initialSpotlightState(), { type: "setQuery", query: "成本" });
  s = spotlightReducer(s, { type: "openCapability", id: "cost" });
  s = spotlightReducer(s, { type: "back" });
  assert.equal(isLauncher(s), true);
  assert.equal(s.query, "");
});

test("launcherMatches returns all capabilities for an empty query", () => {
  const s = initialSpotlightState();
  const matches = launcherMatches(s, "zh-CN");
  assert.equal(matches.length >= 11, true);
});

test("topMatchId resolves the best capability for a query", () => {
  const s = spotlightReducer(initialSpotlightState(), { type: "setQuery", query: "网盘" });
  assert.equal(topMatchId(s, "zh-CN"), "drive");
});

test("topMatchId is undefined in capability mode", () => {
  const s = spotlightReducer(initialSpotlightState(), { type: "openCapability", id: "approvals" });
  assert.equal(topMatchId(s, "zh-CN"), undefined);
});
