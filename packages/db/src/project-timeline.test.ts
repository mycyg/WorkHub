import assert from "node:assert/strict";
import test from "node:test";

import type { WorkItemStatus } from "@workhub/contracts";

import {
  computeBlockingCounts,
  wouldCreateDependencyCycle,
  type DependencyEdge
} from "./repositories/project-timeline.js";

// edge { workItemId: A, dependsOnWorkItemId: B } 表示「A 依赖 B」（B 阻塞 A）。
function edge(workItemId: string, dependsOnWorkItemId: string): DependencyEdge {
  return { workItemId, dependsOnWorkItemId };
}

function openItem(id: string, status: WorkItemStatus = "ai_working") {
  return { id, status };
}

test("wouldCreateDependencyCycle rejects a direct 2-cycle", () => {
  const edges = [edge("A", "B")]; // A 依赖 B
  // 再加 B 依赖 A → B → A 已可达（A 依赖 B 的反面看：从 A 能走到 B，但方向是 forward: A→B）。
  // workItemId=B, dependsOn=A：从 A 出发正向走 A→B，命中 B → 环。
  assert.equal(wouldCreateDependencyCycle(edges, "B", "A"), true);
});

test("wouldCreateDependencyCycle rejects a transitive cycle across a chain", () => {
  const edges = [edge("A", "B"), edge("B", "C")]; // A→B→C
  // 加 C 依赖 A：从 A 正向 A→B→C，命中 C → 环。
  assert.equal(wouldCreateDependencyCycle(edges, "C", "A"), true);
});

test("wouldCreateDependencyCycle allows a redundant forward shortcut", () => {
  const edges = [edge("A", "B"), edge("B", "C")]; // A→B→C
  // 加 A 依赖 C（已经传递依赖 C 的冗余捷径）：从 C 正向无出边，走不到 A → 不成环。
  assert.equal(wouldCreateDependencyCycle(edges, "A", "C"), false);
});

test("wouldCreateDependencyCycle allows an unrelated edge and a fresh root", () => {
  const edges = [edge("A", "B")];
  assert.equal(wouldCreateDependencyCycle(edges, "C", "D"), false);
  // 空图上任何非自依赖边都安全。
  assert.equal(wouldCreateDependencyCycle([], "X", "Y"), false);
});

test("computeBlockingCounts counts direct + transitive downstream along a chain", () => {
  // A→B→C→D（A 依赖 B 依赖 C 依赖 D）。D 阻塞 C/B/A=3，C 阻塞 B/A=2，B 阻塞 A=1，A=0。
  const items = [openItem("A"), openItem("B"), openItem("C"), openItem("D")];
  const edges = [edge("A", "B"), edge("B", "C"), edge("C", "D")];
  const counts = computeBlockingCounts(items, edges);
  assert.equal(counts.get("D"), 3);
  assert.equal(counts.get("C"), 2);
  assert.equal(counts.get("B"), 1);
  assert.equal(counts.get("A"), 0);
});

test("computeBlockingCounts de-duplicates diamond reconvergence", () => {
  // 菱形：A 依赖 B、A 依赖 C；B 依赖 D、C 依赖 D。D 阻塞 B/C/A（A 经两条路只算一次）=3。
  const items = [openItem("A"), openItem("B"), openItem("C"), openItem("D")];
  const edges = [edge("A", "B"), edge("A", "C"), edge("B", "D"), edge("C", "D")];
  const counts = computeBlockingCounts(items, edges);
  assert.equal(counts.get("D"), 3);
  assert.equal(counts.get("B"), 1);
  assert.equal(counts.get("C"), 1);
  assert.equal(counts.get("A"), 0);
});

test("computeBlockingCounts keeps multiple roots independent", () => {
  // 两条不相干的链：A→B 与 C→D。B 阻塞 A=1，D 阻塞 C=1，其余 0。
  const items = [openItem("A"), openItem("B"), openItem("C"), openItem("D")];
  const edges = [edge("A", "B"), edge("C", "D")];
  const counts = computeBlockingCounts(items, edges);
  assert.equal(counts.get("B"), 1);
  assert.equal(counts.get("D"), 1);
  assert.equal(counts.get("A"), 0);
  assert.equal(counts.get("C"), 0);
});

test("computeBlockingCounts excludes finished downstream and skips finished nodes", () => {
  // B 被两件事依赖：A（进行中）和 E（已完成）。已完成的下游不再「等」B，故 B 只阻塞 A=1。
  // 已完成节点自身不出现在结果里（只对未完成项算 blocks_count）。
  const items = [openItem("A"), openItem("B"), { id: "E", status: "done" as WorkItemStatus }];
  const edges = [edge("A", "B"), edge("E", "B")];
  const counts = computeBlockingCounts(items, edges);
  assert.equal(counts.get("B"), 1);
  assert.equal(counts.get("A"), 0);
  assert.equal(counts.has("E"), false);
});

test("computeBlockingCounts ignores edges pointing at unknown (out-of-project) nodes", () => {
  // 边指向图外节点（已删/跨项目残留）：不计入闭包，只在已知节点集合内计数。
  const items = [openItem("A"), openItem("B")];
  const edges = [edge("A", "B"), edge("GHOST", "B")];
  const counts = computeBlockingCounts(items, edges);
  assert.equal(counts.get("B"), 1);
});
