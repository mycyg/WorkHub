import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { estimateDeliverableDiffStats } from "./deliverable-diff-stats.js";

function change(targetPath: string) {
  return {
    id: "70000000-0000-4000-8000-000000000001",
    target_kind: "text_doc" as const,
    target_ref: { entity_type: "external" as const, path: targetPath },
    change_type: "updated" as const,
    human_summary: "改了一下"
  };
}

async function makeWorkdir() {
  return mkdtemp(path.join(os.tmpdir(), "workhub-deliverable-diff-stats-test-"));
}

test("estimateDeliverableDiffStats counts added/removed lines between project/ and outputs/ mirrors", async () => {
  const workdir = await makeWorkdir();
  await mkdir(path.join(workdir, "project"), { recursive: true });
  await mkdir(path.join(workdir, "outputs"), { recursive: true });
  await writeFile(path.join(workdir, "project", "result.md"), "line1\nline2\nline3", "utf8");
  await writeFile(path.join(workdir, "outputs", "result.md"), "line1\nline2 changed\nline3", "utf8");

  const stats = await estimateDeliverableDiffStats({
    workdir,
    manifest: { changes: [change("/outputs/result.md")] }
  });

  // 共同前缀 line1、共同后缀 line3 都裁掉，中段只剩 "line2" → "line2 changed" 这一处改动。
  assert.equal(stats.adds, 1);
  assert.equal(stats.dels, 1);
});

test("estimateDeliverableDiffStats treats a brand-new file (no project/ mirror) as pure addition", async () => {
  const workdir = await makeWorkdir();
  await mkdir(path.join(workdir, "outputs"), { recursive: true });
  await writeFile(path.join(workdir, "outputs", "new.md"), "a\nb\nc", "utf8");

  const stats = await estimateDeliverableDiffStats({
    workdir,
    manifest: { changes: [change("/outputs/new.md")] }
  });

  assert.equal(stats.adds, 3);
  assert.equal(stats.dels, 0);
});

test("estimateDeliverableDiffStats is a no-op fail-open when neither mirror is readable", async () => {
  const workdir = await makeWorkdir();

  const stats = await estimateDeliverableDiffStats({
    workdir,
    manifest: { changes: [change("/outputs/missing.md")] }
  });

  assert.equal(stats.adds, 0);
  assert.equal(stats.dels, 0);
});

test("estimateDeliverableDiffStats skips changes with an unsafe or missing path", async () => {
  const workdir = await makeWorkdir();
  await mkdir(path.join(workdir, "outputs"), { recursive: true });
  await writeFile(path.join(workdir, "outputs", "ok.md"), "x\n", "utf8");

  const stats = await estimateDeliverableDiffStats({
    workdir,
    manifest: {
      changes: [
        change("../../etc/passwd"),
        { ...change("/outputs/ok.md"), target_ref: { entity_type: "external" as const } }
      ]
    }
  });

  assert.equal(stats.adds, 0);
  assert.equal(stats.dels, 0);
});

test("estimateDeliverableDiffStats caps the number of changes it diffs", async () => {
  const workdir = await makeWorkdir();
  await mkdir(path.join(workdir, "outputs"), { recursive: true });
  const changes = [];
  for (let index = 0; index < 25; index += 1) {
    const name = `f${index}.md`;
    await writeFile(path.join(workdir, "outputs", name), "one line", "utf8");
    changes.push(change(`/outputs/${name}`));
  }

  const stats = await estimateDeliverableDiffStats({ workdir, manifest: { changes } });

  // 只统计前 20 条（MAX_CHANGES_DIFFED），每条 +1 行。
  assert.equal(stats.adds, 20);
  // R13 批 P1.5：files[] 与聚合总数来自同一次被截断的遍历，长度也该是 20，不是 25。
  assert.equal(stats.files.length, 20);
});

// R13 批 P1.5：右栏"变动文件"需要 per-file 明细——下面几条钉死 files[] 的形状与"缺省不是 0"语义。
test("estimateDeliverableDiffStats reports a files[] entry per change with the same per-file adds/dels as the aggregate", async () => {
  const workdir = await makeWorkdir();
  await mkdir(path.join(workdir, "project"), { recursive: true });
  await mkdir(path.join(workdir, "outputs"), { recursive: true });
  await writeFile(path.join(workdir, "project", "result.md"), "line1\nline2\nline3", "utf8");
  await writeFile(path.join(workdir, "outputs", "result.md"), "line1\nline2 changed\nline3", "utf8");

  const oneChange = change("/outputs/result.md");
  const stats = await estimateDeliverableDiffStats({
    workdir,
    manifest: { changes: [oneChange] }
  });

  assert.equal(stats.files.length, 1);
  assert.deepEqual(stats.files[0], {
    change_id: oneChange.id,
    path: "/outputs/result.md",
    change_type: "updated",
    adds: 1,
    dels: 1
  });
  // 两条消费路径（产出卡系统消息的聚合数字 / 右栏 per-file 明细求和）必须对得上。
  assert.equal(stats.files.reduce((sum, file) => sum + (file.adds ?? 0), 0), stats.adds);
  assert.equal(stats.files.reduce((sum, file) => sum + (file.dels ?? 0), 0), stats.dels);
});

test("estimateDeliverableDiffStats omits adds/dels on a files[] entry it could not diff, instead of faking 0", async () => {
  const workdir = await makeWorkdir();

  const stats = await estimateDeliverableDiffStats({
    workdir,
    manifest: { changes: [change("/outputs/missing.md")] }
  });

  assert.equal(stats.files.length, 1);
  assert.equal("adds" in stats.files[0]!, false, "adds must be entirely absent, not present-and-zero");
  assert.equal("dels" in stats.files[0]!, false, "dels must be entirely absent, not present-and-zero");
  assert.equal(stats.files[0]?.change_type, "updated");
  assert.equal(stats.files[0]?.path, "/outputs/missing.md");
});

test("estimateDeliverableDiffStats still records a files[] entry (without a path) for a change with an unsafe/missing path", async () => {
  const workdir = await makeWorkdir();

  const unsafeChange = { ...change("../../etc/passwd") };
  const stats = await estimateDeliverableDiffStats({
    workdir,
    manifest: { changes: [unsafeChange] }
  });

  assert.equal(stats.files.length, 1);
  assert.equal(stats.files[0]?.change_id, unsafeChange.id);
  // 路径本身对显示无害（提议详情页本就会展示 target_ref.path），但这条改动没法安全读文件比对，
  // 因此没有 adds/dels——这里只钉死"缺省不是 0"这条不变量，不测 path 具体取值。
  assert.equal("adds" in stats.files[0]!, false);
  assert.equal("dels" in stats.files[0]!, false);
});
