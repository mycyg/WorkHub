import assert from "node:assert/strict";
import test from "node:test";

import {
  taskPlanItemRoles,
  taskPlanItemStatuses,
  taskPlanStatuses
} from "@workhub/contracts";

import {
  taskPlanItemRoleLabel,
  taskPlanItemStatusLabel,
  taskPlanStatusLabel
} from "./i18n.js";

test("R9.1 task plan enum labels are bilingual and do not leak raw machine values", () => {
  for (const status of taskPlanStatuses) {
    assert.notEqual(taskPlanStatusLabel("zh-CN", status), status);
    assert.notEqual(taskPlanStatusLabel("en-US", status), status);
  }
  for (const role of taskPlanItemRoles) {
    assert.notEqual(taskPlanItemRoleLabel("zh-CN", role), role);
    assert.notEqual(taskPlanItemRoleLabel("en-US", role), role);
  }
  for (const status of taskPlanItemStatuses) {
    assert.notEqual(taskPlanItemStatusLabel("zh-CN", status), status);
    assert.notEqual(taskPlanItemStatusLabel("en-US", status), status);
  }
});

test("R9.7 task plan labels use user-facing progress language instead of dispatch internals", () => {
  assert.equal(taskPlanStatusLabel("zh-CN", "dispatching").includes("派发"), false);
  assert.equal(taskPlanStatusLabel("en-US", "dispatching").includes("Dispatch"), false);
  assert.equal(taskPlanItemStatusLabel("zh-CN", "pending").includes("派发"), false);
  assert.equal(taskPlanItemStatusLabel("en-US", "dispatched").includes("Dispatch"), false);
});
