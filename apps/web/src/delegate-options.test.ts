import assert from "node:assert/strict";
import test from "node:test";

import { buildDelegateOptionNodes } from "./delegate-options.js";

type FakeOption = { value: string; textContent: string | null };

test("delegate option builder keeps an HTML-shaped nickname as one literal option", () => {
  const created: FakeOption[] = [];
  const createOption = () => {
    const option: FakeOption = { value: "", textContent: null };
    created.push(option);
    return option;
  };
  const nickname = "Alice</option><option value=attacker selected>Attacker";

  const nodes = buildDelegateOptionNodes(createOption, [{
    id: "10000000-0000-4000-8000-0000000000aa",
    nickname,
    is_admin: false
  }], "zh-CN");

  assert.equal(nodes.length, 1);
  assert.equal(created.length, 1);
  assert.equal(nodes[0]?.value, "10000000-0000-4000-8000-0000000000aa");
  assert.equal(nodes[0]?.textContent, nickname);
});
