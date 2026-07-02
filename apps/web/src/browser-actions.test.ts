import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const browserSource = readFileSync(new URL("./browser.ts", import.meta.url), "utf8");

function browserActionBlock(startMarker: string, endMarker: string) {
  const start = browserSource.indexOf(startMarker);
  const end = browserSource.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing browser action block ${startMarker}`);
  assert.notEqual(end, -1, `missing browser action end marker ${endMarker}`);
  return browserSource.slice(start, end);
}

test("accepted deliverable restore opens the restored drive file before showing success", () => {
  const block = browserActionBlock("const acceptedDeliverableRestore = acceptedDeliverableRestoreFromHref(href);", "const driveUpload = driveUploadFromHref(href);");

  assert.match(block, /result\.accepted_deliverable\.drive_href/u);
  assert.match(block, /await navigateWebRoute\(result\.accepted_deliverable\.drive_href, client, locale\);/u);
  assert.match(block, /showRouteNotice\(root, actionSuccessNotice/u);
  assert.doesNotMatch(block, /showRouteNotice\(shellRoot, actionSuccessNotice/u);
});

test("drive preview is rendered in-place instead of opening the API JSON envelope", () => {
  const block = browserActionBlock("if (actionId === \"drive_preview\") {", "if (isNativeResourceLink(actionTarget)) {");

  assert.match(block, /event\.preventDefault\(\);/u);
  assert.match(block, /await client\.request<DrivePreviewPayload>\(href\);/u);
  assert.match(block, /data-r5-drive-preview-panel/u);
  assert.match(block, /renderDrivePreviewPanel/u);
});
