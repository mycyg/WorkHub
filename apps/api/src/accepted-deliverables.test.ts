import assert from "node:assert/strict";
import test from "node:test";

import type { DriveAcceptedDeliverableRow } from "@workhub/db";

import { acceptedDeliverableToVm } from "./services/accepted-deliverables.js";

const baseDate = new Date("2026-06-28T00:00:00.000Z");

test("accepted deliverable VM carries the restored file's drive route", () => {
  const workItemId = "72000000-0000-4000-8000-000000000005";
  const proposalId = "72000000-0000-4000-8000-000000000006";
  const changeId = "72000000-0000-4000-8000-000000000007";
  const itemId = "72000000-0000-4000-8000-000000000008";
  const projectId = "72000000-0000-4000-8000-000000000009";
  const versionId = "72000000-0000-4000-8000-000000000010";
  const userId = "72000000-0000-4000-8000-000000000011";
  const row: DriveAcceptedDeliverableRow = {
    accepted: {
      id: "72000000-0000-4000-8000-000000000004",
      workItemId,
      projectId: null,
      proposalId,
      branchId: null,
      changeId,
      targetKind: "text_doc",
      targetEntityType: "drive_item",
      targetEntityId: itemId,
      targetPath: "/outputs/result.yaml",
      targetKey: "delivery:/outputs/result.yaml",
      changeType: "updated",
      acceptedVersion: 2,
      baseVersionRef: null,
      acceptedRef: versionId,
      driveItemId: itemId,
      driveVersionId: versionId,
      sha256Before: null,
      sha256After: "a".repeat(64),
      previewRefJson: { kind: "text", href: "/preview/result" },
      manifestChangeJson: {
        id: changeId,
        target_kind: "text_doc",
        target_ref: {
          entity_type: "drive_item",
          entity_id: itemId,
          path: "/outputs/result.yaml",
          sha256_after: "a".repeat(64)
        },
        change_type: "updated",
        human_summary: "更新结果文档",
        machine_summary: { changed_fields: ["body"] }
      },
      supersededAt: null,
      createdAt: baseDate,
      updatedAt: baseDate
    },
    driveItem: {
      id: itemId,
      projectId,
      parentId: null,
      kind: "file",
      name: "result.yaml",
      currentVersionId: versionId,
      deletedAt: null,
      deletedByUserId: null,
      createdByUserId: userId,
      updatedByUserId: userId,
      createdAt: baseDate,
      updatedAt: baseDate
    },
    driveVersion: {
      id: versionId,
      itemId,
      versionNo: 2,
      filename: "result.yaml",
      mime: "application/yaml",
      sizeBytes: 128,
      storagePath: "drive/result.yaml",
      sha256: "a".repeat(64),
      parsedText: "结果内容",
      parsedTextPath: null,
      createdByUserId: userId,
      createdAt: baseDate,
      updatedAt: baseDate
    }
  };

  const vm = acceptedDeliverableToVm(row);

  assert.equal(vm.project_id, projectId);
  assert.equal(
    vm.drive_href,
    `/drive?project_id=${projectId}&item_id=${itemId}`
  );
  assert.equal(vm.preview_href, `/api/workitems/${workItemId}/deliverables/${row.accepted.id}/preview`);
});

test("accepted deliverable VM hides restore when the repository marks it non-restorable", () => {
  const workItemId = "72000000-0000-4000-8000-000000000005";
  const acceptedId = "72000000-0000-4000-8000-000000000104";
  const row: DriveAcceptedDeliverableRow & { canRestore: false } = {
    accepted: {
      id: acceptedId,
      workItemId,
      projectId: null,
      proposalId: "72000000-0000-4000-8000-000000000106",
      branchId: null,
      changeId: "72000000-0000-4000-8000-000000000107",
      targetKind: "text_doc",
      targetEntityType: "drive_item",
      targetEntityId: "72000000-0000-4000-8000-000000000108",
      targetPath: "/outputs/result.yaml",
      targetKey: "delivery:/outputs/result.yaml",
      changeType: "updated",
      acceptedVersion: 2,
      baseVersionRef: null,
      acceptedRef: "72000000-0000-4000-8000-000000000110",
      driveItemId: "72000000-0000-4000-8000-000000000108",
      driveVersionId: "72000000-0000-4000-8000-000000000110",
      sha256Before: null,
      sha256After: "b".repeat(64),
      previewRefJson: null,
      manifestChangeJson: {
        id: "change",
        target_kind: "text_doc",
        target_ref: {
          entity_type: "drive_item",
          entity_id: "72000000-0000-4000-8000-000000000108",
          path: "/outputs/result.yaml"
        },
        change_type: "updated",
        human_summary: "更新结果文档"
      },
      supersededAt: null,
      createdAt: baseDate,
      updatedAt: baseDate
    },
    driveItem: null,
    driveVersion: {
      id: "72000000-0000-4000-8000-000000000110",
      itemId: "72000000-0000-4000-8000-000000000108",
      versionNo: 2,
      filename: "result.yaml",
      mime: "application/yaml",
      sizeBytes: 128,
      storagePath: "drive/result.yaml",
      sha256: "b".repeat(64),
      parsedText: "结果内容",
      parsedTextPath: null,
      createdByUserId: "72000000-0000-4000-8000-000000000111",
      createdAt: baseDate,
      updatedAt: baseDate
    },
    canRestore: false
  };

  const vm = acceptedDeliverableToVm(row);

  assert.equal(vm.download_href, `/api/workitems/${workItemId}/deliverables/${acceptedId}/download`);
  assert.equal(vm.restore_href, undefined);
});

// R13 批 P4（全托管透明度：reviewer_kind 溯源）：reviewer_kind 是调用方（work-items 服务，从批量反查
// 的评审记录里）算好传进来的可选项——这里只验证 acceptedDeliverableToVm 忠实透传，不重新推导。
test("accepted deliverable VM carries reviewer_kind when the caller supplies it, and omits it otherwise", () => {
  const workItemId = "72000000-0000-4000-8000-000000000005";
  const acceptedId = "72000000-0000-4000-8000-000000000204";
  const row: DriveAcceptedDeliverableRow = {
    accepted: {
      id: acceptedId,
      workItemId,
      projectId: null,
      proposalId: "72000000-0000-4000-8000-000000000206",
      branchId: null,
      changeId: "72000000-0000-4000-8000-000000000207",
      targetKind: "text_doc",
      targetEntityType: "drive_item",
      targetEntityId: "72000000-0000-4000-8000-000000000208",
      targetPath: "/outputs/result.yaml",
      targetKey: "delivery:/outputs/result.yaml",
      changeType: "updated",
      acceptedVersion: 1,
      baseVersionRef: null,
      acceptedRef: "72000000-0000-4000-8000-000000000210",
      driveItemId: "72000000-0000-4000-8000-000000000208",
      driveVersionId: "72000000-0000-4000-8000-000000000210",
      sha256Before: null,
      sha256After: "c".repeat(64),
      previewRefJson: null,
      manifestChangeJson: {
        id: "change",
        target_kind: "text_doc",
        target_ref: {
          entity_type: "drive_item",
          entity_id: "72000000-0000-4000-8000-000000000208",
          path: "/outputs/result.yaml"
        },
        change_type: "updated",
        human_summary: "更新结果文档"
      },
      supersededAt: null,
      createdAt: baseDate,
      updatedAt: baseDate
    },
    driveItem: null,
    driveVersion: null
  };

  const aiVm = acceptedDeliverableToVm(row, { reviewerKind: "ai" });
  assert.equal(aiVm.reviewer_kind, "ai");

  const humanVm = acceptedDeliverableToVm(row, { reviewerKind: "human" });
  assert.equal(humanVm.reviewer_kind, "human");

  const unknownVm = acceptedDeliverableToVm(row);
  assert.equal(unknownVm.reviewer_kind, undefined);
});
