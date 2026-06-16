import assert from "node:assert/strict";
import test from "node:test";

import type { DriveItemVM, DrivePageVM } from "@workhub/contracts";

import { renderProjectDriveHtml, projectDriveCss } from "./project-drive.js";

function fileItem(partial: Partial<DriveItemVM> = {}): DriveItemVM {
  return {
    id: "70000000-0000-4000-8000-000000000001",
    project_id: "62000000-0000-4000-8000-000000000020",
    name: "Q2-周报.md",
    kind: "file",
    path: "/Q2-周报.md",
    depth: 0,
    children_count: 0,
    updated_at: "2026-06-15T00:00:00.000Z",
    current_version: {
      id: "71000000-0000-4000-8000-000000000001",
      item_id: "70000000-0000-4000-8000-000000000001",
      version_no: 2,
      filename: "Q2-周报.md",
      size_bytes: 2048,
      created_at: "2026-06-15T00:00:00.000Z",
      current: true,
      source: "accepted_deliverable"
    },
    ...partial
  };
}

function folderItem(partial: Partial<DriveItemVM> = {}): DriveItemVM {
  return {
    id: "70000000-0000-4000-8000-000000000010",
    project_id: "62000000-0000-4000-8000-000000000020",
    name: "素材",
    kind: "folder",
    path: "/素材",
    depth: 0,
    children_count: 4,
    updated_at: "2026-06-15T00:00:00.000Z",
    ...partial
  };
}

function drive(items: DriveItemVM[], partial: Partial<DrivePageVM> = {}): DrivePageVM {
  const files = items.filter((i) => i.kind === "file");
  const folders = items.filter((i) => i.kind === "folder");
  return {
    generated_at: "2026-06-15T00:00:00.000Z",
    project: { id: "62000000-0000-4000-8000-000000000020", name: "渠道增长", slug: "growth", status: "active" },
    summary: {
      item_count: items.length,
      file_count: files.length,
      folder_count: folders.length,
      deleted_item_count: 0,
      version_count: files.length,
      accepted_deliverable_count: files.filter((f) => f.current_version?.source === "accepted_deliverable").length,
      pending_comment_count: 0,
      operation_count: 0
    },
    can_manage: false,
    items,
    deleted_items: [],
    versions: [],
    accepted_deliverables: [],
    comments: [],
    operations: [],
    actions: {},
    ...partial
  };
}

test("project drive renders the empty state when the project has no files", () => {
  const html = renderProjectDriveHtml({ drive: drive([], { empty_state: "no_drive_items" }), projectName: "渠道增长", locale: "zh-CN" });
  assert.match(html, /没有文件/u);
  assert.match(html, /data-proj-back/u);
  assert.doesNotMatch(html, /wh-pdrive-list/u);
});

test("project drive renders a back button, project name, summary chips and file/folder rows", () => {
  const html = renderProjectDriveHtml({ drive: drive([folderItem(), fileItem()]), projectName: "渠道增长", locale: "zh-CN" });
  // 返回按钮是纯 button(无 href),不会被 bindGoldPathNavigation 劫持
  assert.match(html, /<button type="button" class="wh-pdrive-back gl-press" data-proj-back>← 返回项目<\/button>/u);
  assert.match(html, /wh-pdrive-title">渠道增长</u);
  assert.match(html, /wh-pdrive-chip"><b>1<\/b>文件/u);
  assert.match(html, /wh-pdrive-chip"><b>1<\/b>文件夹/u);
  // 文件夹行带 children_count;文件行带大小(KB)+版本号
  assert.match(html, /data-pdrive-kind="folder"[^>]*>[\s\S]*?素材[\s\S]*?4 项/u);
  assert.match(html, /Q2-周报\.md[\s\S]*?2\.0 KB · v2/u);
  // AI 交付计数 chip(source=accepted_deliverable)
  assert.match(html, /wh-pdrive-chip--accent"><b>1<\/b>AI 交付/u);
});

test("project drive indents by depth and formats bytes + localizes (en)", () => {
  const html = renderProjectDriveHtml({
    drive: drive([fileItem({ depth: 2, name: "deep.txt", current_version: { id: "x", item_id: "y", version_no: 1, filename: "deep.txt", size_bytes: 1048576, created_at: "2026-06-15T00:00:00.000Z", current: true, source: "manual_upload" } })]),
    projectName: "Growth",
    locale: "en-US"
  });
  // depth 2 → padding-left 16 + 32 = 48px
  assert.match(html, /style="padding-left:48px"/u);
  assert.match(html, /1\.0 MB · v1/u);
  assert.match(html, /← Back to projects/u);
  assert.match(html, /<b>1<\/b>files/u);
  assert.ok(projectDriveCss.includes(".wh-pdrive-row{"));
});
