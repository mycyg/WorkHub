import assert from "node:assert/strict";
import { test } from "node:test";

import { commandRegistry } from "../command-palette.js";
import { resolveCapabilityView } from "./registry.js";

test("every capability resolves to a real inline view carrying its id", () => {
  // R9.6 adds Agent Army on top of the original 11 abilities; assert the live
  // registry size instead of freezing the old count in the test name/comment.
  for (const command of commandRegistry) {
    assert.equal(resolveCapabilityView(command.id).id, command.id);
  }
});
