import assert from "node:assert/strict";
import { test } from "node:test";

import type { DriveItemVM, DrivePageVM } from "@workhub/contracts";

import { driveHtml } from "./drive.js";

const DELIV_ID = "70000000-0000-4000-8000-000000000001";
const PLAIN_ID = "70000000-0000-4000-8000-000000000002";
const PLAIN_VERSION = "70000000-0000-4000-8000-0000000000a2";

const deliverableFile: DriveItemVM = {
  id: DELIV_ID,
  project_id: "62000000-0000-4000-8000-000000000020",
  name: "客户复盘.md",
  kind: "file",
  path: "/客户复盘.md",
  depth: 0,
  current_version_id: "70000000-0000-4000-8000-0000000000a1",
  children_count: 0,
  updated_at: "2026-06-23T00:00:00.000Z",
  accepted_deliverable: {
    id: "70000000-0000-4000-8000-0000000000b1",
    target_kind: "drive_file",
    target_key: "/客户复盘.md",
    accepted_version: 2,
    preview_href: "/api/drive/projects/p/items/i/preview",
    download_href: "/api/drive/projects/p/items/i/download",
    accepted_at: "2026-06-23T00:00:00.000Z"
  }
} as unknown as DriveItemVM;

const plainFile: DriveItemVM = {
  id: PLAIN_ID,
  project_id: "62000000-0000-4000-8000-000000000020",
  name: "草稿.md",
  kind: "file",
  path: "/草稿.md",
  depth: 0,
  current_version_id: PLAIN_VERSION,
  children_count: 0,
  updated_at: "2026-06-23T00:00:00.000Z"
} as unknown as DriveItemVM;

function vm(over: Partial<DrivePageVM> = {}): DrivePageVM {
  return {
    generated_at: "2026-06-23T00:00:00.000Z",
    summary: { item_count: 2, file_count: 2, folder_count: 0, deleted_item_count: 0, version_count: 2, accepted_deliverable_count: 1, pending_comment_count: 0, operation_count: 0 },
    can_manage: true,
    selected_item_id: PLAIN_ID,
    items: [deliverableFile, plainFile],
    deleted_items: [],
    versions: [],
    accepted_deliverables: [],
    comments: [],
    operations: [],
    actions: {
      upload_file: { id: "upload_file", label: "Upload", method: "POST", href: "/api/drive/projects/p/files" },
      delete_item: { id: "delete_item", label: "Delete", method: "POST", href: "/api/drive/projects/p/items/i/delete" }
    },
    ...over
  } as DrivePageVM;
}

test("HIGH #1 desktop drive renders write actions when the user can manage", () => {
  const html = driveHtml(vm(), "", true);
  // a plain file gets a delete (item id + expected current version for optimistic concurrency)
  assert.ok(html.includes(`data-drive-delete="${PLAIN_ID}"`), "delete on a plain file");
  assert.ok(html.includes(`data-drive-delete-version="${PLAIN_VERSION}"`), "delete carries expected version");
  assert.ok(html.includes("data-drive-upload"), "upload button present");
  // accepted-deliverable preview/download open as external links (read-only, no webview navigation)
  assert.ok(html.includes('href="/api/drive/projects/p/items/i/preview"') && html.includes('target="_blank"'), "preview link");
  assert.ok(html.includes('href="/api/drive/projects/p/items/i/download"'), "download link");
});

test("#2 desktop drive hides Delete on items the server would reject (accepted deliverable + non-empty folder)", () => {
  // an accepted-deliverable file is locked server-side → no delete button for it
  assert.ok(!driveHtml(vm(), "", true).includes(`data-drive-delete="${DELIV_ID}"`), "no delete on accepted deliverable");
  // a non-empty folder is rejected server-side → no delete button for it
  const folder = { ...plainFile, id: "70000000-0000-4000-8000-000000000003", kind: "folder", children_count: 3 } as unknown as DriveItemVM;
  const html = driveHtml(vm({ items: [folder] }), "", true);
  assert.ok(!html.includes('data-drive-delete='), "no delete on a non-empty folder");
});

test("HIGH #1 desktop drive hides write actions for a read-only (non-manager) viewer", () => {
  const html = driveHtml(vm({ can_manage: false, actions: {} }), "", true);
  assert.ok(!html.includes("data-drive-delete"), "no delete buttons when read-only");
  assert.ok(!html.includes("data-drive-upload"), "no upload button when no upload_file action");
  assert.ok(html.includes("客户复盘.md"), "files still listed");
});
