import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { deliverableChangeManifestSchema, type EvidenceRef } from "@workhub/contracts";

import { buildDeliverableChangeManifestFromOutputs } from "./manifest.js";

const workItemId = "50000000-0000-4000-8000-000000000101";
const snapshotId = "60000000-0000-4000-8000-000000000101";
const evidenceRef: EvidenceRef = {
  id: "70000000-0000-4000-8000-000000000101",
  source_type: "agent_step",
  source_id: "step-1",
  title: "Agent step wrote outputs",
  excerpt: "write_file outputs/weekly-report.md",
  confidence_hint: "found"
};

async function tempWorkdir() {
  return mkdtemp(path.join(os.tmpdir(), "workhub-manifest-"));
}

async function writeFixtureOutputs(workdir: string) {
  const outputs = path.join(workdir, "outputs");
  await mkdir(path.join(outputs, "folder-delivery"), { recursive: true });
  await writeFile(path.join(outputs, "weekly-report.md"), "# Weekly Report\nDone", "utf8");
  await writeFile(path.join(outputs, "config.yaml"), "mode: draft\n", "utf8");
  await writeFile(path.join(outputs, "sheet.csv"), "name,value\nalpha,1\nbeta,2\n", "utf8");
  await writeFile(path.join(outputs, "proposal.docx"), Buffer.from("docx-placeholder"));
  await writeFile(path.join(outputs, "story.pptx"), Buffer.from("pptx-placeholder"));
  await writeFile(path.join(outputs, "bundle.bin"), Buffer.from([0, 1, 2, 3]));
  await writeFile(path.join(outputs, "folder-delivery", "readme.txt"), "nested", "utf8");
  await writeFile(
    path.join(outputs, "cuu.png"),
    Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000049454e44ae426082", "hex")
  );
}

test("builds a DeliverableChangeManifest draft from varied outputs", async () => {
  const workdir = await tempWorkdir();
  await writeFixtureOutputs(workdir);

  const manifest = await buildDeliverableChangeManifestFromOutputs({
    workdir,
    workItemId,
    snapshotId,
    evidenceRefs: [evidenceRef],
    createdAt: new Date("2026-06-06T10:00:00.000Z")
  });

  assert.doesNotThrow(() => deliverableChangeManifestSchema.parse(manifest));
  assert.equal(manifest.work_item_id, workItemId);
  assert.equal(manifest.base.snapshot_id, snapshotId);
  assert.equal(manifest.rollback.available, true);
  assert.equal(manifest.risk.reversible, true);
  assert.equal(manifest.evidence_refs.length, 1);

  const targetKinds = new Set(manifest.changes.map((change) => change.target_kind));
  assert.equal(targetKinds.has("text_doc"), true);
  assert.equal(targetKinds.has("structured_record"), true);
  assert.equal(targetKinds.has("spreadsheet"), true);
  assert.equal(targetKinds.has("binary_doc"), true);
  assert.equal(targetKinds.has("slide_deck"), true);
  assert.equal(targetKinds.has("image"), true);
  assert.equal(targetKinds.has("folder"), true);

  const fileChanges = manifest.changes.filter((change) => change.target_kind !== "folder");
  assert.equal(fileChanges.every((change) => change.target_ref.sha256_after?.length === 64), true);
  assert.equal(fileChanges.every((change) => change.preview_ref?.href), true);

  const imageChange = manifest.changes.find((change) => change.target_ref.path === "/outputs/cuu.png");
  assert.equal(imageChange?.machine_summary?.image_size_after, "1x1");

  const csvChange = manifest.changes.find((change) => change.target_ref.path === "/outputs/sheet.csv");
  assert.equal(csvChange?.machine_summary?.row_count_delta, 3);

  const unknownBinaryChange = manifest.changes.find((change) => change.target_ref.path === "/outputs/bundle.bin");
  assert.equal(unknownBinaryChange?.preview_ref?.kind, "download");
  assert.equal(unknownBinaryChange?.target_ref.sha256_after?.length, 64);

  const checks = new Set(manifest.checks.map((check) => check.id));
  assert.equal(checks.has("snapshot_exists"), true);
  assert.equal(checks.has("artifact_exists"), true);
  assert.equal(checks.has("evidence_linked"), true);
  assert.equal(checks.has("revert_available"), true);
});

test("keeps missing evidence explicit instead of fabricating refs", async () => {
  const workdir = await tempWorkdir();
  await mkdir(path.join(workdir, "outputs"), { recursive: true });
  await writeFile(path.join(workdir, "outputs", "notes.md"), "draft", "utf8");

  const manifest = await buildDeliverableChangeManifestFromOutputs({
    workdir,
    workItemId,
    createdAt: "2026-06-06T10:00:00.000Z"
  });

  const evidenceCheck = manifest.checks.find((check) => check.id === "evidence_linked");
  const snapshotCheck = manifest.checks.find((check) => check.id === "snapshot_exists");

  assert.equal(manifest.evidence_refs.length, 0);
  assert.equal(manifest.changes.every((change) => (change.evidence_refs ?? []).length === 0), true);
  assert.equal(evidenceCheck?.status, "skipped");
  assert.match(evidenceCheck?.detail ?? "", /不编造来源/);
  assert.equal(snapshotCheck?.status, "warning");
  assert.equal(manifest.rollback.available, false);
  assert.equal(manifest.risk.reversible, false);
});

test("throws when outputs has no deliverables", async () => {
  const workdir = await tempWorkdir();
  await mkdir(path.join(workdir, "outputs"), { recursive: true });

  await assert.rejects(
    () => buildDeliverableChangeManifestFromOutputs({ workdir, workItemId }),
    /No deliverables found under outputs/
  );
});
