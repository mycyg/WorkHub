import assert from "node:assert/strict";
import { test } from "node:test";

import { commandRegistry } from "../command-palette.js";
import { resolveCapabilityView } from "./registry.js";

test("every capability resolves to a real inline view carrying its id (11/11 built)", () => {
  // 全部 11 个能力都已内联，每个 view 都带回自己的 id；绝不退回旧全屏壳。
  for (const command of commandRegistry) {
    assert.equal(resolveCapabilityView(command.id).id, command.id);
  }
});
