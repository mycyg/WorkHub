import type { DriveUploadFileRequest } from "@workhub/api-client";
import type { AcceptedDeliverableRestoreResult } from "@workhub/contracts";
import type { WorkHubLocale } from "@workhub/ui/gold-path";

export type AcceptedDeliverableRestoreFollowUp = {
  kind: "refresh_current";
  noticeBody: string;
};

export function driveUploadParentIdFromPicker(picker: Pick<HTMLInputElement, "closest">): string | undefined {
  const value = picker
    .closest("[data-drive-upload-control]")
    ?.querySelector<HTMLSelectElement>("[data-drive-upload-parent-select]")
    ?.value
    .trim();
  return value || undefined;
}

export function driveUploadPayloadFromPicker(
  picker: Pick<HTMLInputElement, "closest">,
  file: Blob
): Extract<DriveUploadFileRequest, { file: Blob }> {
  const parentId = driveUploadParentIdFromPicker(picker);
  return parentId ? { file, parent_id: parentId } : { file };
}

export function acceptedDeliverableRestoreFollowUp(
  result: AcceptedDeliverableRestoreResult,
  locale: WorkHubLocale,
  fallbackNoticeBody: string
): AcceptedDeliverableRestoreFollowUp {
  const filename = result.accepted_deliverable.filename?.trim();
  return {
    kind: "refresh_current",
    noticeBody: filename
      ? (locale === "zh-CN" ? `已恢复：${filename}` : `Restored: ${filename}`)
      : fallbackNoticeBody
  };
}
