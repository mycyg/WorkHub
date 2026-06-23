import assert from "node:assert/strict";
import { test } from "node:test";

import type { DrivePageVM } from "@workhub/contracts";

import { driveHtml } from "./drive.js";

const ITEM_ID = "70000000-0000-4000-8000-000000000001";
const VERSION_ID = "70000000-0000-4000-8000-0000000000a1";

function vm(over: Partial<DrivePageVM> = {}): DrivePageVM {
  return {
    generated_at: "2026-06-23T00:00:00.000Z",
    summary: {
      item_count: 1,
      file_count: 1,
      folder_count: 0,
      deleted_item_count: 0,
      version_count: 1,
      accepted_deliverable_count: 1,
      pending_comment_count: 0,
      operation_count: 0
    },
    can_manage: true,
    selected_item_id: ITEM_ID,
    items: [
      {
        id: ITEM_ID,
        project_id: "62000000-0000-4000-8000-000000000020",
        name: "客户复盘.md",
        kind: "file",
        path: "/客户复盘.md",
        depth: 0,
        current_version_id: VERSION_ID,
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
      }
    ],
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
  // per-file delete carries the item id + expected current version (optimistic concurrency)
  assert.ok(html.includes(`data-drive-delete="${ITEM_ID}"`), "delete button carries item id");
  assert.ok(html.includes(`data-drive-delete-version="${VERSION_ID}"`), "delete carries expected version");
  // upload affordance present (server returned upload_file action)
  assert.ok(html.includes("data-drive-upload"), "upload button present");
  // accepted-deliverable preview/download open as external links (no webview navigation)
  assert.ok(html.includes('href="/api/drive/projects/p/items/i/preview"') && html.includes('target="_blank"'), "preview link");
  assert.ok(html.includes('href="/api/drive/projects/p/items/i/download"'), "download link");
});

test("HIGH #1 desktop drive hides write actions for a read-only (non-manager) viewer", () => {
  const html = driveHtml(vm({ can_manage: false, actions: {} }), "", true);
  assert.ok(!html.includes("data-drive-delete"), "no delete buttons when read-only");
  assert.ok(!html.includes("data-drive-upload"), "no upload button when no upload_file action");
  // still shows the files (read access) + the AI-deliverable links remain (preview/download are read-only)
  assert.ok(html.includes("客户复盘.md"), "files still listed");
});
