import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createSnapshotService, buildManifestFacts, shouldAskGate } from "./index.js";

async function tempDir(prefix: string) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

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
  await service.revert({ snapshot, workdir });

  assert.equal(snapshot.contentSha256?.length, 64);
  assert.equal(await readFile(path.join(workdir, "outputs", "result.md"), "utf8"), "before");
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
