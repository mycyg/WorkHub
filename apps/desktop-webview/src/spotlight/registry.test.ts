import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveCapabilityView } from "./registry.js";

test("built capabilities resolve to their real inline view (not the placeholder)", () => {
  // 切片完成的能力：审批 + 派活/澄清。每个 view 都带回自己的 id。
  assert.equal(resolveCapabilityView("approvals").id, "approvals");
  assert.equal(resolveCapabilityView("intake").id, "intake");
});

test("not-yet-built capabilities resolve to a placeholder that still carries the id", () => {
  // S5–S11 未做的能力先走统一玻璃占位（绝不退回旧全屏壳），但仍返回正确 id 以驱动盒子标题。
  for (const id of ["drive", "projects", "cost", "replay", "knowledge", "team", "workitem", "proposals", "settings"] as const) {
    assert.equal(resolveCapabilityView(id).id, id);
  }
});
