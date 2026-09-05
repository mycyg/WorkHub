import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createSnapshotService, buildManifestFacts, shouldAskGate, readSnapshotFile } from "./index.js";

async function tempDir(prefix: string) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

test("readSnapshotFile reads an ancestor file by relative path, guards traversal, and returns null when absent", async () => {
  const snapshotDir = await tempDir("workhub-audit-base-snap-");
  await mkdir(path.join(snapshotDir, "docs"), { recursive: true });
  await writeFile(path.join(snapshotDir, "docs", "spec.md"), "ancestor body\n", "utf8");

  const hit = await readSnapshotFile({ ref: snapshotDir }, "docs/spec.md");
  assert.equal(hit?.text, "ancestor body\n");
  assert.match(hit?.sha256 ?? "", /^[0-9a-f]{64}$/u);

  // 路径越界(..)一律视为不存在,绝不读到快照目录外的文件。
  assert.equal(await readSnapshotFile({ ref: snapshotDir }, "../escape.md"), null);
  // 不存在的文件返回 null（调用方据此回退到 accepted-history 祖先）。
  assert.equal(await readSnapshotFile({ ref: snapshotDir }, "docs/missing.md"), null);
});

test("SnapshotService takes and reverts a sandbox file snapshot", async () => {
  const workdir = await tempDir("workhub-audit-work-");
  const snapshotRoot = await tempDir("workhub-audit-snap-");
  await mkdir(path.join(workdir, "outputs"), { recursive: true });
  await writeFile(path.join(workdir, "outputs", "result.md"), "before", "utf8");
  const service = createSnapshotService({
    snapshotRoot,
    id: () => "a0000000-0000-4000-8000-000000000001",
    now: () => new Date("2026-06-05T00:00:00.000Z")
  });

  const snapshot = await service.takeSandboxFileSnapshot({
    workItemId: "a0000000-0000-4000-8000-000000000002",
    workdir,
    createdByKind: "ai"
  });
  await writeFile(path.join(workdir, "outputs", "result.md"), "after", "utf8");
  // 快照之后新增的文件：revert 后应被清掉（atomic swap 完整替换，不是叠加）。
  await writeFile(path.join(workdir, "outputs", "stray.md"), "added after snapshot", "utf8");
  await service.revert({ snapshot, workdir });

  assert.equal(snapshot.contentSha256?.length, 64);
  assert.equal(await readFile(path.join(workdir, "outputs", "result.md"), "utf8"), "before");
  // R2 audit#34：原子换入后工作区 == 快照内容，快照里没有的 stray.md 被移除。
  await assert.rejects(() => readFile(path.join(workdir, "outputs", "stray.md"), "utf8"));
});

test("R2 audit#34: revert atomically materializes into a not-yet-existing workdir", async () => {
  const base = await tempDir("workhub-audit-base-");
  const snapshotRoot = await tempDir("workhub-audit-snap2-");
  const sourceWorkdir = await tempDir("workhub-audit-src-");
  await mkdir(path.join(sourceWorkdir, "docs"), { recursive: true });
  await writeFile(path.join(sourceWorkdir, "docs", "plan.md"), "snapshot body", "utf8");
  const service = createSnapshotService({
    snapshotRoot,
    id: () => "a0000000-0000-4000-8000-0000000000aa",
    now: () => new Date("2026-06-05T00:00:00.000Z")
  });
  const snapshot = await service.takeSandboxFileSnapshot({
    workItemId: "a0000000-0000-4000-8000-0000000000ab",
    workdir: sourceWorkdir,
    createdByKind: "ai"
  });

  // 目标 workdir 尚不存在：revert 应原子建出并填入快照内容。
  const freshWorkdir = path.join(base, "fresh-workdir");
  await service.revert({ snapshot, workdir: freshWorkdir });
  assert.equal(await readFile(path.join(freshWorkdir, "docs", "plan.md"), "utf8"), "snapshot body");
});

test("external side effects require ask-gate", () => {
  assert.equal(shouldAskGate({ sideEffect: "external_effect" }), true);
  assert.equal(shouldAskGate({ sideEffect: "sandbox_file" }), false);
});

test("manifest facts expose rollback and irreversible reasons", () => {
  const facts = buildManifestFacts({
    snapshots: [
      {
        id: "a0000000-0000-4000-8000-000000000003",
        workItemId: "a0000000-0000-4000-8000-000000000002",
        kind: "pre_step",
        ref: "snap",
        createdByKind: "ai",
        createdAt: "2026-06-05T00:00:00.000Z"
      }
    ],
    auditLogs: [
      {
        id: "a0000000-0000-4000-8000-000000000004",
        actor: { actorKind: "ai" },
        entity: { entityType: "work_item", entityId: "a0000000-0000-4000-8000-000000000002" },
        action: "write_file",
        detailJson: {},
        createdAt: "2026-06-05T00:00:00.000Z"
      }
    ],
    sideEffects: [{ sideEffect: "external_effect", action: "send_notification" }]
  });

  assert.equal(facts.rollback.available, false);
  assert.deepEqual(facts.risk.irreversible_reasons, ["external_effect"]);
  assert.equal(facts.evidence_refs[0]?.source_type, "audit_log");
});

test("CORE-04 SnapshotService reuses the previous snapshot ref when workdir content is unchanged", async () => {
  // 每次 side-effect 工具调用前拍快照；相邻两次调用之间工作区大多零变化。旧实现仍整树拷贝
  // （最坏 ~3GB/run）。修复后 contentSha256 与上一份相同 → 复用 ref、不拷贝。
  const workdir = await tempDir("workhub-audit-dedup-work-");
  const snapshotRoot = await tempDir("workhub-audit-dedup-snap-");
  await mkdir(path.join(workdir, "outputs"), { recursive: true });
  await writeFile(path.join(workdir, "outputs", "result.md"), "v1", "utf8");
  const service = createSnapshotService({ snapshotRoot });

  const first = await service.takeSandboxFileSnapshot({
    workItemId: "a0000000-0000-4000-8000-0000000000c1",
    workdir,
    createdByKind: "ai"
  });
  const second = await service.takeSandboxFileSnapshot({
    workItemId: "a0000000-0000-4000-8000-0000000000c1",
    workdir,
    createdByKind: "ai"
  });

  // 新快照仍是独立身份（审计行一行一 id），但内容零变化 → 复用同一份目录拷贝。
  assert.notEqual(second.id, first.id);
  assert.equal(second.ref, first.ref);
  assert.equal(second.contentSha256, first.contentSha256);
  assert.equal((await readdir(snapshotRoot)).length, 1, "内容未变不得新增整树拷贝");
  // 复用的 ref 仍可用于 revert/readSnapshotFile（内容一致）。
  assert.equal(
    (await readSnapshotFile({ ref: second.ref }, "outputs/result.md"))?.text,
    "v1"
  );

  // 内容变化后恢复正常拷贝：新 ref、新目录。
  await writeFile(path.join(workdir, "outputs", "result.md"), "v2", "utf8");
  const third = await service.takeSandboxFileSnapshot({
    workItemId: "a0000000-0000-4000-8000-0000000000c1",
    workdir,
    createdByKind: "ai"
  });
  assert.notEqual(third.ref, first.ref);
  assert.notEqual(third.contentSha256, first.contentSha256);
  assert.equal((await readdir(snapshotRoot)).length, 2);
  assert.equal((await readSnapshotFile({ ref: third.ref }, "outputs/result.md"))?.text, "v2");

  // 变化后继续拍：再零变化时复用的是最新这份（v2）的 ref。
  const fourth = await service.takeSandboxFileSnapshot({
    workItemId: "a0000000-0000-4000-8000-0000000000c1",
    workdir,
    createdByKind: "ai"
  });
  assert.equal(fourth.ref, third.ref);
  assert.equal((await readdir(snapshotRoot)).length, 2);
});

test("B10 excludeDirs：.spill/ 不进快照、不进内容哈希，revert 也不把它删掉", async () => {
  const workdir = await tempDir("workhub-audit-spill-work-");
  const snapshotRoot = await tempDir("workhub-audit-spill-snap-");
  await mkdir(path.join(workdir, "outputs"), { recursive: true });
  await mkdir(path.join(workdir, ".spill"), { recursive: true });
  await writeFile(path.join(workdir, "outputs", "result.md"), "v1", "utf8");
  await writeFile(path.join(workdir, ".spill", "0001-read_file.txt"), "huge tool result v1", "utf8");
  const service = createSnapshotService({ snapshotRoot });
  const workItemId = "a0000000-0000-4000-8000-0000000000d1";

  const first = await service.takeSandboxFileSnapshot({ workItemId, workdir, createdByKind: "ai", excludeDirs: [".spill"] });
  // 快照目录里没有 .spill/，outputs/ 照旧在。
  assert.deepEqual((await readdir(first.ref)).sort(), ["outputs"]);
  assert.equal((await readSnapshotFile({ ref: first.ref }, "outputs/result.md"))?.text, "v1");
  assert.equal(await readSnapshotFile({ ref: first.ref }, ".spill/0001-read_file.txt"), null);

  // .spill/ 内容变了：contentSha256 不变，CORE-04 去重仍复用上一份 ref、不新增整树拷贝。
  await writeFile(path.join(workdir, ".spill", "0001-read_file.txt"), "huge tool result v2 (changed)", "utf8");
  await writeFile(path.join(workdir, ".spill", "0002-run_command.txt"), "another", "utf8");
  const second = await service.takeSandboxFileSnapshot({ workItemId, workdir, createdByKind: "ai", excludeDirs: [".spill"] });
  assert.equal(second.contentSha256, first.contentSha256);
  assert.equal(second.ref, first.ref);
  assert.equal((await readdir(snapshotRoot)).length, 1);

  // outputs/ 变了才是新内容。
  await writeFile(path.join(workdir, "outputs", "result.md"), "v2", "utf8");
  const third = await service.takeSandboxFileSnapshot({ workItemId, workdir, createdByKind: "ai", excludeDirs: [".spill"] });
  assert.notEqual(third.contentSha256, first.contentSha256);

  // 还原到第一份：outputs/ 回到 v1；当前的 .spill/ 原样保留——快照里没有它不等于要删它。
  await service.revert({ snapshot: first, workdir, excludeDirs: [".spill"] });
  assert.equal(await readFile(path.join(workdir, "outputs", "result.md"), "utf8"), "v1");
  assert.equal(await readFile(path.join(workdir, ".spill", "0001-read_file.txt"), "utf8"), "huge tool result v2 (changed)");
  assert.equal(await readFile(path.join(workdir, ".spill", "0002-run_command.txt"), "utf8"), "another");

  // 不带 excludeDirs 时行为不变：.spill/ 照常进快照。
  const plain = await service.takeSandboxFileSnapshot({ workItemId, workdir, createdByKind: "ai" });
  assert.equal((await readSnapshotFile({ ref: plain.ref }, ".spill/0002-run_command.txt"))?.text, "another");

  // 排除名单只认顶层目录名：带路径分隔符的条目直接拒绝，而不是静默无效。
  await assert.rejects(
    () => service.takeSandboxFileSnapshot({ workItemId, workdir, createdByKind: "ai", excludeDirs: ["outputs/nested"] }),
    /top-level directory names/u
  );
});
