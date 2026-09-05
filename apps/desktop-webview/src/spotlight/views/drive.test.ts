import assert from "node:assert/strict";
import { test } from "node:test";

import type { DriveItemVM, DrivePageVM } from "@workhub/contracts";

import { driveHtml, driveNoProjectsEmptyHtml, drivePreviewPanelHtml, driveResourceHref, driveTargetItemIdFromRoute, fetchDrivePreview } from "./drive.js";

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
  preview_href: `/api/drive/projects/62000000-0000-4000-8000-000000000020/items/${PLAIN_ID}/preview`,
  download_href: `/api/drive/projects/62000000-0000-4000-8000-000000000020/items/${PLAIN_ID}/download`,
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
  assert.ok(html.includes('type="file"'), "real file picker present");
  assert.ok(html.includes("data-drive-upload-picker"), "upload picker wired");
  assert.ok(!html.includes("插入示例文件"), "no sample upload copy");
  assert.ok(!html.includes("Insert sample file"), "no sample upload copy");
  // accepted-deliverable preview/download open as external links (read-only, no webview navigation)
  assert.ok(html.includes('href="/api/drive/projects/p/items/i/preview"') && html.includes('target="_blank"'), "preview link");
  assert.ok(html.includes('href="/api/drive/projects/p/items/i/download"'), "download link");
});

test("desktop drive lets users preview and download ordinary uploaded files", () => {
  const html = driveHtml(vm(), "", true);

  assert.ok(html.includes(`href="/api/drive/projects/62000000-0000-4000-8000-000000000020/items/${PLAIN_ID}/preview"`), "plain file preview");
  assert.ok(html.includes(`href="/api/drive/projects/62000000-0000-4000-8000-000000000020/items/${PLAIN_ID}/download"`), "plain file download");
  assert.match(html, /data-drive-resource="preview"[^>]+target="_blank"/u);
  assert.match(html, /data-drive-resource="download"[^>]+target="_blank"/u);
});

test("desktop drive visibly marks the selected item from a file deep-link", () => {
  const html = driveHtml(vm(), "", true);

  assert.match(html, new RegExp(`data-drive-item="${PLAIN_ID}"[^>]+data-drive-item-selected="true"`, "u"));
  assert.match(html, /aria-current="true"/u);
  assert.match(html, /当前/u);
});

test("desktop drive keeps the deep-linked selected item visible even when it is beyond the first page slice", () => {
  const manyItems = Array.from({ length: 45 }, (_, index) => ({
    ...plainFile,
    id: `70000000-0000-4000-8000-000000000${String(100 + index).padStart(3, "0")}`,
    name: `普通文件-${index + 1}.md`
  })) as DriveItemVM[];
  const selected = {
    ...plainFile,
    id: "70000000-0000-4000-8000-000000000777",
    name: "从项目最近文件打开.md"
  } as DriveItemVM;

  const html = driveHtml(vm({
    items: [...manyItems, selected],
    selected_item_id: selected.id
  }), "", true);

  assert.match(html, new RegExp(`data-drive-item="${selected.id}"[^>]+data-drive-item-selected="true"`, "u"));
  assert.match(html, /从项目最近文件打开\.md/u);
  assert.doesNotMatch(html, /普通文件-40\.md/u);
});

test("desktop drive rewrites API resource links to the desktop backend origin", () => {
  assert.equal(
    driveResourceHref("/api/drive/projects/p/items/i/preview", "http://127.0.0.1:8787/"),
    "http://127.0.0.1:8787/api/drive/projects/p/items/i/preview"
  );

  const html = driveHtml(vm(), "", true, "http://127.0.0.1:8787");
  assert.ok(
    html.includes(`href="http://127.0.0.1:8787/api/drive/projects/62000000-0000-4000-8000-000000000020/items/${PLAIN_ID}/preview"`),
    "desktop app uses the backend origin, not tauri://localhost/api"
  );
});

test("desktop drive extracts selected file ids from project-home deep-links", () => {
  assert.equal(
    driveTargetItemIdFromRoute("/drive?project_id=93000000-0000-4000-8000-000000000001&item_id=20000000-0000-4000-8000-000000000777"),
    "20000000-0000-4000-8000-000000000777"
  );
  assert.equal(
    driveTargetItemIdFromRoute("/drive?project_id=93000000-0000-4000-8000-000000000001&itemId=20000000-0000-4000-8000-000000000888"),
    "20000000-0000-4000-8000-000000000888"
  );
  assert.equal(driveTargetItemIdFromRoute("/drive?project_id=93000000-0000-4000-8000-000000000001"), undefined);
});

test("desktop drive renders an inline preview panel with a token-aware download action", () => {
  const html = drivePreviewPanelHtml({
    filename: "manual-note.md",
    mime: "text/markdown",
    size_bytes: 42,
    preview_type: "text",
    text: "# Manual note\n验收要点",
    truncated: false,
    download_href: "/api/drive/projects/p/items/i/download"
  }, true, "http://127.0.0.1:8787");

  assert.match(html, /data-drive-preview-panel="true"/u);
  assert.match(html, /预览：manual-note\.md/u);
  assert.match(html, /# Manual note/u);
  assert.match(html, /验收要点/u);
  assert.match(html, /class="wh-spot-row-sub wh-spot-drive-preview-text"/u);
  assert.doesNotMatch(html, /background:rgba\(255,255,255|background:#fff|background:white/iu);
  assert.match(html, /href="http:\/\/127\.0\.0\.1:8787\/api\/drive\/projects\/p\/items\/i\/download"/u);
  assert.match(html, /data-drive-resource="download"/u);
});

test("desktop drive preview refreshes a missing desktop token before retrying", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalFetch = globalThis.fetch;
  const stored = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => {
          stored.set(key, value);
        },
        removeItem: (key: string) => {
          stored.delete(key);
        }
      }
    }
  });

  const calls: { url: string; headers: Headers }[] = [];
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, headers: new Headers(init?.headers) });
      if (url.endsWith("/preview") && calls.length === 1) {
        return new Response(JSON.stringify({ ok: false, error: { code: "not_identified", message: "not identified" } }), { status: 401 });
      }
      if (url.endsWith("/api/auth/desktop-bootstrap")) {
        return new Response(JSON.stringify({ client_token: "fresh-desktop-token" }), { status: 201 });
      }
      return new Response(JSON.stringify({
        ok: true,
        data: {
          filename: "草稿.md",
          size_bytes: 12,
          preview_type: "text",
          text: "验收内容",
          download_href: "/api/drive/projects/p/items/i/download"
        }
      }), { status: 200 });
    }
  });

  try {
    const preview = await fetchDrivePreview("http://127.0.0.1:8787/api/drive/projects/p/items/i/preview", "http://127.0.0.1:8787");

    assert.equal(preview.text, "验收内容");
    assert.equal(stored.get("workhub_client_token"), "fresh-desktop-token");
    assert.equal(calls.length, 3);
    assert.equal(calls[2]?.headers.get("X-WorkHub-Client-Token"), "fresh-desktop-token");
    assert.equal(calls[2]?.headers.get("X-YQGL-Client-Token"), "fresh-desktop-token");
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
    Object.defineProperty(globalThis, "fetch", { configurable: true, value: originalFetch });
  }
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

test("desktop drive only shows recycle restore when the server exposes a restore_href", () => {
  const deletedPlain = {
    ...plainFile,
    id: "70000000-0000-4000-8000-0000000000d1",
    name: "已删草稿.md",
    deleted_at: "2026-06-23T00:00:00.000Z"
  } as unknown as DriveItemVM;
  const readOnly = driveHtml(vm({ can_manage: false, actions: {}, deleted_items: [deletedPlain] }), "", true);
  assert.match(readOnly, /已删草稿\.md/u);
  assert.doesNotMatch(readOnly, /data-drive-restore/u);

  const manager = driveHtml(vm({
    deleted_items: [{
      ...deletedPlain,
      restore_href: "/api/drive/projects/p/items/deleted/restore"
    } as unknown as DriveItemVM]
  }), "", true);
  assert.match(manager, /data-drive-restore="70000000-0000-4000-8000-0000000000d1"/u);
});

test("desktop drive no-project empty state offers a direct new-task action", () => {
  const zh = driveNoProjectsEmptyHtml(true);
  const en = driveNoProjectsEmptyHtml(false);

  assert.match(zh, /data-drive-open-intake="true"/u);
  assert.match(zh, /新任务/u);
  assert.match(en, /data-drive-open-intake="true"/u);
  assert.match(en, /New task/u);
});

test("R9.7 desktop drive no-project empty state avoids dispatch copy", () => {
  const zh = driveNoProjectsEmptyHtml(true);
  const en = driveNoProjectsEmptyHtml(false);

  assert.doesNotMatch(zh, /派活/u);
  assert.doesNotMatch(en, /Dispatch|dispatch/u);
  assert.match(zh, /交给 Cuu 一个任务/u);
  assert.match(en, /Create a task/u);
});

test("L-01 (R24 S3 walkthrough): drive no-project empty state uses an SVG face, not an emoji", () => {
  const html = driveNoProjectsEmptyHtml(true);

  assert.doesNotMatch(html, /[\u{1F300}-\u{1FAFF}]/u, "must not contain emoji");
  assert.match(html, /<div class="wh-spot-empty-face"><svg /u);
});
