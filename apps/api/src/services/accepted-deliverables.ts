import type { AcceptedDeliverableVM } from "@workhub/contracts";
import type { DriveAcceptedDeliverableRow } from "@workhub/db";

function isPreviewableText(mime?: string | null, filename?: string | null) {
  const lower = (filename ?? "").toLowerCase();
  return !!mime?.startsWith("text/")
    || mime === "application/json"
    || mime === "application/xml"
    || mime === "application/yaml"
    || mime === "application/x-yaml"
    || lower.endsWith(".md")
    || lower.endsWith(".json")
    || lower.endsWith(".csv")
    || lower.endsWith(".txt")
    || lower.endsWith(".tsv")
    || lower.endsWith(".html")
    || lower.endsWith(".xml")
    || lower.endsWith(".yaml")
    || lower.endsWith(".yml");
}

export function acceptedDeliverableToVm(
  row: DriveAcceptedDeliverableRow,
  options: { includeRestore?: boolean } = {}
): AcceptedDeliverableVM {
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
    vm.project_id = row.driveItem.projectId;
    vm.drive_item_id = row.driveItem.id;
    vm.drive_href = `/drive?${new URLSearchParams({
      project_id: row.driveItem.projectId,
      item_id: row.driveItem.id
    }).toString()}`;
  }
  if (driveVersion) {
    vm.drive_version_id = driveVersion.id;
    vm.filename = filename ?? driveVersion.filename;
    if (driveVersion.mime) {
      vm.mime = driveVersion.mime;
    }
    vm.size_bytes = driveVersion.sizeBytes;
    vm.download_href = `/api/workitems/${accepted.workItemId}/deliverables/${accepted.id}/download`;
    const canRestore = row.canRestore ?? accepted.acceptedVersion > 1;
    if (options.includeRestore !== false && canRestore) {
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
