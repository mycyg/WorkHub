import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveCapabilityView } from "./registry.js";

test("built capabilities resolve to their real inline view (not the placeholder)", () => {
  // 切片完成的能力：审批 + 派活 + 项目/成本/团队日历/知识检索。每个 view 都带回自己的 id。
  for (const id of ["approvals", "intake", "projects", "cost", "team", "knowledge", "drive", "replay"] as const) {
    assert.equal(resolveCapabilityView(id).id, id);
  }
});

test("not-yet-built capabilities resolve to a placeholder that still carries the id", () => {
  // 仍待做的能力先走统一玻璃占位（绝不退回旧全屏壳），但仍返回正确 id 以驱动盒子标题。
  for (const id of ["workitem", "proposals", "settings"] as const) {
    assert.equal(resolveCapabilityView(id).id, id);
  }
});
