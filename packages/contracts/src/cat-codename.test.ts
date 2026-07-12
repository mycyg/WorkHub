import assert from "node:assert/strict";
import test from "node:test";

import { CAT_CODENAMES, catCodename } from "./domain/cat-codename.js";

function fixtureRunId(sequence: number) {
  return `7${String(sequence).padStart(7, "0")}-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

test("cat codename word list is non-trivial and duplicate-free", () => {
  assert.ok(CAT_CODENAMES.length >= 32, "word list must have at least 32 cat names");
  assert.equal(new Set(CAT_CODENAMES).size, CAT_CODENAMES.length, "word list must not contain duplicates");
  for (const name of CAT_CODENAMES) {
    assert.equal(typeof name, "string");
    assert.ok(name.length > 0, "cat name must be non-empty");
    assert.doesNotMatch(name, /\p{Emoji_Presentation}/u, "cat name must not contain emoji");
  }
});

test("same run id always maps to the same cat codename", () => {
  const runId = fixtureRunId(1);
  const first = catCodename(runId);
  const second = catCodename(runId);
  const third = catCodename(runId);
  assert.equal(first, second);
  assert.equal(second, third);
  assert.ok(CAT_CODENAMES.includes(first as (typeof CAT_CODENAMES)[number]));
});

test("distinct run ids spread across the word list instead of collapsing to one name", () => {
  const names = new Set<string>();
  for (let index = 0; index < 200; index += 1) {
    names.add(catCodename(fixtureRunId(index)));
  }
  // 200 次调用应该覆盖词表里相当一部分名字；不要求均匀，但绝不能全部落在同一个名字上
  // （那样就不是哈希分布，而是常量函数了）。
  assert.ok(names.size >= 10, `expected at least 10 distinct cat codenames, got ${names.size}`);
  assert.ok(names.size <= CAT_CODENAMES.length);
});

test("cat codename is deterministic across process-like repeated calls for the exact same string", () => {
  const a = catCodename("11111111-1111-4111-8111-111111111111");
  const b = catCodename("11111111-1111-4111-8111-111111111111");
  assert.equal(a, b);
  const different = catCodename("22222222-2222-4222-8222-222222222222");
  // 不强求不同 id 一定得到不同名字（哈希桶可能碰撞），只要求函数不是恒等映射到同一个值。
  assert.ok(CAT_CODENAMES.includes(different as (typeof CAT_CODENAMES)[number]));
});

test("empty or whitespace-only run id is defended with a stable fallback instead of throwing", () => {
  assert.doesNotThrow(() => catCodename(""));
  assert.doesNotThrow(() => catCodename("   "));
  const empty1 = catCodename("");
  const empty2 = catCodename("");
  const whitespace = catCodename("   ");
  assert.equal(empty1, empty2, "empty-string fallback must be stable across calls");
  assert.equal(empty1, whitespace, "whitespace-only input normalizes to the same fallback as empty");
  assert.equal(empty1, CAT_CODENAMES[0]);
});
