import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { AcceptedDeliverableRestoreResult } from "@workhub/contracts";

import { acceptedDeliverableRestoreFollowUp, driveUploadPayloadFromPicker } from "./drive-actions.js";

const browserSource = readFileSync(new URL("./browser.ts", import.meta.url), "utf8");

function browserActionBlock(startMarker: string, endMarker: string) {
  const start = browserSource.indexOf(startMarker);
  const end = browserSource.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing browser action block ${startMarker}`);
  assert.notEqual(end, -1, `missing browser action end marker ${endMarker}`);
  return browserSource.slice(start, end);
}

test("accepted deliverable restore refreshes the current route instead of jumping to drive", () => {
  const result = {
    accepted_deliverable: {
      id: "94000000-0000-4000-8000-000000000004",
      work_item_id: "94000000-0000-4000-8000-000000000005",
      proposal_id: "94000000-0000-4000-8000-000000000006",
      change_id: "94000000-0000-4000-8000-000000000007",
      target_kind: "text_doc",
      target_key: "drive:/deliverables/client-review.md",
      change_type: "updated",
      accepted_version: 2,
      filename: "client-review.md",
      drive_href: "/drive?project_id=94000000-0000-4000-8000-000000000001&item_id=94000000-0000-4000-8000-000000000002",
      restore_href: "/api/workitems/94000000-0000-4000-8000-000000000005/deliverables/94000000-0000-4000-8000-000000000004/restore",
      accepted_at: "2026-06-11T09:00:00.000Z"
    }
  } satisfies AcceptedDeliverableRestoreResult;

  const followUp = acceptedDeliverableRestoreFollowUp(result, "en-US", "Restored deliverable");

  assert.deepEqual(followUp, {
    kind: "refresh_current",
    noticeBody: "Restored: client-review.md"
  });
});

test("drive upload picker payload carries the selected parent folder id", () => {
  const file = new Blob(["folder upload"], { type: "text/plain" });
  const picker = {
    closest: () => ({
      querySelector: () => ({ value: "94000000-0000-4000-8000-000000000020" })
    })
  } as unknown as HTMLInputElement;

  const payload = driveUploadPayloadFromPicker(picker, file);

  assert.equal(payload.file, file);
  assert.equal(payload.parent_id, "94000000-0000-4000-8000-000000000020");
});

test("drive preview is rendered in-place instead of opening the API JSON envelope", () => {
  const block = browserActionBlock("if (actionId === \"drive_preview\") {", "if (isNativeResourceLink(actionTarget)) {");

  assert.match(block, /event\.preventDefault\(\);/u);
  assert.match(block, /await client\.request<DrivePreviewPayload>\(href\);/u);
  assert.match(block, /data-r5-drive-preview-panel/u);
  assert.match(block, /renderDrivePreviewPanel/u);
});
