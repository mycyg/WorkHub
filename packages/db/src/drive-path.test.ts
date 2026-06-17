import assert from "node:assert/strict";
import test from "node:test";

import { resolveDriveFolderPath } from "./repositories/work-items.js";
import { isActivePathUniqueViolation } from "./repositories/drive.js";

test("findings[#low] isActivePathUniqueViolation only matches the active-path unique index 23505", () => {
  assert.equal(
    isActivePathUniqueViolation({ code: "23505", constraint: "project_drive_items_active_path_uq" }),
    true
  );
  // 其它唯一索引 / 外键 / 缺约束名 / 非对象都不算名字冲突。
  assert.equal(isActivePathUniqueViolation({ code: "23505", constraint: "some_other_uq" }), false);
  assert.equal(isActivePathUniqueViolation({ code: "23503" }), false);
  assert.equal(isActivePathUniqueViolation({ code: "23505" }), false);
  assert.equal(isActivePathUniqueViolation(new Error("boom")), false);
  assert.equal(isActivePathUniqueViolation(null), false);
});

type Node = { id: string; parentId: string | null; name: string };

function mapFetch(nodes: Node[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return async (id: string) => byId.get(id);
}

test("findings[#24] resolveDriveFolderPath walks the parent chain (bounded, no full project scan)", async () => {
  const nodes: Node[] = [
    { id: "a", parentId: null, name: "a" },
    { id: "b", parentId: "a", name: "b" },
    { id: "c", parentId: "b", name: "c" }
  ];
  assert.equal(await resolveDriveFolderPath(nodes[2]!, mapFetch(nodes)), "/a/b/c");
});

test("resolveDriveFolderPath returns /name for a root folder", async () => {
  const root: Node = { id: "r", parentId: null, name: "root" };
  assert.equal(await resolveDriveFolderPath(root, mapFetch([root])), "/root");
});

test("resolveDriveFolderPath stops if a parent row is missing", async () => {
  const leaf: Node = { id: "x", parentId: "gone", name: "x" };
  assert.equal(await resolveDriveFolderPath(leaf, mapFetch([leaf])), "/x");
});

test("resolveDriveFolderPath caps depth at 50 levels", async () => {
  const nodes: Node[] = [];
  for (let i = 0; i < 60; i += 1) {
    nodes.push({ id: `n${i}`, parentId: i === 0 ? null : `n${i - 1}`, name: `n${i}` });
  }
  const path = await resolveDriveFolderPath(nodes[59]!, mapFetch(nodes));
  assert.equal(path.split("/").filter(Boolean).length, 50);
});

test("resolveDriveFolderPath breaks parent cycles instead of looping forever", async () => {
  const nodes: Node[] = [
    { id: "a", parentId: "b", name: "a" },
    { id: "b", parentId: "a", name: "b" }
  ];
  // a -> b -> (a already seen) stop.
  assert.equal(await resolveDriveFolderPath(nodes[0]!, mapFetch(nodes)), "/b/a");
});
