import type { AcceptedDeliverableVM } from "@workhub/contracts";
import type { DriveAcceptedDeliverableRow } from "@workhub/db";

function isPreviewableText(mime?: string | null, filename?: string | null) {
  const lower = (filename ?? "").toLowerCase();
  return !!mime?.startsWith("text/")
    || mime === "application/json"
    || lower.endsWith(".md")
    || lower.endsWith(".json")
    || lower.endsWith(".csv")
    || lower.endsWith(".txt");
}

export function acceptedDeliverableToVm(row: DriveAcceptedDeliverableRow): AcceptedDeliverableVM {
  const accepted = row.accepted;
  const driveVersion = row.driveVersion;
  const filename = driveVersion?.filename ?? (accepted.targetPath ? accepted.targetPath.split(/[\\/]/u).pop() : undefined);
  const vm: AcceptedDeliverableVM = {
    id: accepted.id,
    work_item_id: accepted.workItemId,
    proposal_id: accepted.proposalId,
    change_id: accepted.changeId,
    target_kind: accepted.targetKind,
    target_key: accepted.targetKey,
    change_type: accepted.changeType,
    accepted_version: accepted.acceptedVersion,
    accepted_at: accepted.createdAt.toISOString()
  };
  if (accepted.targetPath) {
    vm.target_path = accepted.targetPath;
  }
  if (accepted.sha256After) {
    vm.sha256 = accepted.sha256After;
  }
  if (row.driveItem?.id) {
    vm.drive_item_id = row.driveItem.id;
  }
  if (driveVersion) {
    vm.drive_version_id = driveVersion.id;
    vm.filename = filename ?? driveVersion.filename;
    if (driveVersion.mime) {
      vm.mime = driveVersion.mime;
    }
    vm.size_bytes = driveVersion.sizeBytes;
    vm.download_href = `/api/workitems/${accepted.workItemId}/deliverables/${accepted.id}/download`;
    if (accepted.acceptedVersion > 1) {
      vm.restore_href = `/api/workitems/${accepted.workItemId}/deliverables/${accepted.id}/restore`;
    }
    if (isPreviewableText(driveVersion.mime, driveVersion.filename)) {
      vm.preview_href = `/api/workitems/${accepted.workItemId}/deliverables/${accepted.id}/preview`;
    }
  } else if (filename) {
    vm.filename = filename;
  }
  return vm;
}
