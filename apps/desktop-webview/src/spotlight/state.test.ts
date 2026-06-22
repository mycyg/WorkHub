import assert from "node:assert/strict";
import { test } from "node:test";

import {
  capabilityForShellRoute,
  entityIdFromShellRoute,
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

test("capabilityForShellRoute maps tray/deep-link/pet routes to capabilities", () => {
  // 托盘「打开收件箱」= /inbox → 审批；「打开设置」= /settings。
  assert.equal(capabilityForShellRoute("/inbox"), "approvals");
  assert.equal(capabilityForShellRoute("/settings"), "settings");
  assert.equal(capabilityForShellRoute("/approvals"), "approvals");
  // 前缀匹配带 id 的详情路由。
  assert.equal(capabilityForShellRoute("/workitems/abc-123"), "workitem");
  assert.equal(capabilityForShellRoute("/drive?project_id=x"), "drive");
  assert.equal(capabilityForShellRoute("/dashboard/cost"), "cost");
  // 回主页或无匹配 → undefined（控制器据此回 launcher）。
  assert.equal(capabilityForShellRoute("/"), undefined);
  assert.equal(capabilityForShellRoute("/unknown-thing"), undefined);
});

test("entityIdFromShellRoute extracts the target entity id for deep-links (rank13)", () => {
  // 路径 id：前缀后首段。
  assert.equal(entityIdFromShellRoute("/workitems/abc-123"), "abc-123");
  assert.equal(entityIdFromShellRoute("/proposals/xyz"), "xyz");
  assert.equal(entityIdFromShellRoute("/agent-runs/run-9/extra"), "run-9");
  // 带 URL 编码的段要解码。
  assert.equal(entityIdFromShellRoute("/workitems/a%20b"), "a b");
  // 无路径 id 时回退查询参数（如网盘 project_id）。
  assert.equal(entityIdFromShellRoute("/drive?project_id=p1"), "p1");
  // 列表路由 / 无 id / 回主页 → undefined。
  assert.equal(entityIdFromShellRoute("/workitems"), undefined);
  assert.equal(entityIdFromShellRoute("/inbox"), undefined);
  assert.equal(entityIdFromShellRoute("/"), undefined);
});
