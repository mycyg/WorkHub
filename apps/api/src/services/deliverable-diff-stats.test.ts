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
});
