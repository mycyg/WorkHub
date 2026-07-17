import assert from "node:assert/strict";
import { test } from "node:test";

import type { DriveItemVM } from "@workhub/contracts";

import type { DriveVersionHistory } from "./api.js";
import {
  renderDriveBarHtml,
  renderDriveErrorHtml,
  renderDriveListHtml,
  renderDriveLoadingHtml,
  renderDriveRecycleHtml,
  renderDriveSidePanelHtml,
  type DriveSidePanelState
} from "./render.js";

function folderItem(overrides: Partial<DriveItemVM> = {}): DriveItemVM {
  return {
    id: "folder-1",
    project_id: "p1",
    name: "数据",
    kind: "folder",
    path: "/数据",
    depth: 0,
    children_count: 3,
    updated_at: "2026-07-10T09:00:00.000000Z",
    ...overrides
  };
}

function fileItem(overrides: Partial<DriveItemVM> = {}): DriveItemVM {
  return {
    id: "file-1",
    project_id: "p1",
    name: "report.md",
    kind: "file",
    path: "/report.md",
    depth: 0,
    children_count: 0,
    current_version_id: "v2",
    current_version: {
      id: "v2",
      item_id: "file-1",
      version_no: 2,
      filename: "report.md",
      size_bytes: 2048,
      created_at: "2026-07-12T09:00:00.000000Z",
      current: true,
      source: "manual_upload"
    },
    download_href: "/api/drive/projects/p1/items/file-1/download",
    updated_at: "2026-07-12T09:00:00.000000Z",
    ...overrides
  };
}

function history(overrides: Partial<DriveVersionHistory> = {}): DriveVersionHistory {
  return {
    item_id: "file-1",
    filename: "report.md",
    current_version_id: "v2",
    versions: [
      { id: "v2", version_no: 2, filename: "report.md", size_bytes: 2048, created_at: "2026-07-12T09:00:00.000000Z", created_by_label: "阿曼", current: true },
      {
        id: "v1",
        version_no: 1,
        filename: "report.md",
        size_bytes: 1024,
        created_at: "2026-07-10T09:00:00.000000Z",
        created_by_label: "阿曼",
        current: false,
        restore_href: "/api/drive/projects/p1/items/file-1/versions/v1/restore"
      }
    ],
    ...overrides
  };
}

// —— drive bar —— //

test("renderDriveBarHtml shows the git-化 note line verbatim and no git jargon", () => {
  const html = renderDriveBarHtml({
    locale: "zh-CN",
    breadcrumb: [{ id: undefined, name: "星尘短剧" }],
    canUpload: true
  });
  assert.match(html, /全部文件自动留版本 · 可回滚/u);
  assert.doesNotMatch(html, /\bbranch\b/iu);
  assert.doesNotMatch(html, /\brevert\b/iu);
  assert.doesNotMatch(html, /\brollback\b/iu);
});

test("renderDriveBarHtml renders a clickable breadcrumb for every ancestor except the last (current) segment", () => {
  const html = renderDriveBarHtml({
    locale: "zh-CN",
    breadcrumb: [
      { id: undefined, name: "星尘短剧" },
      { id: "folder-1", name: "数据" },
      { id: "folder-2", name: "周报" }
    ],
    canUpload: false
  });
  assert.match(html, /data-wb-drive-open-folder=""[^>]*>星尘短剧</u);
  assert.match(html, /data-wb-drive-open-folder="folder-1"[^>]*>数据</u);
  assert.match(html, /<b>周报<\/b>/u, "the last breadcrumb segment must be plain text, not another clickable link");
});

test("renderDriveBarHtml only offers the upload control when the actor can manage the drive", () => {
  const withUpload = renderDriveBarHtml({ locale: "zh-CN", breadcrumb: [{ id: undefined, name: "P" }], canUpload: true });
  const withoutUpload = renderDriveBarHtml({ locale: "zh-CN", breadcrumb: [{ id: undefined, name: "P" }], canUpload: false });
  assert.match(withUpload, /data-wb-drive-upload-picker/u);
  assert.doesNotMatch(withoutUpload, /data-wb-drive-upload-picker/u);
});

// —— drive list —— //

test("renderDriveListHtml shows an empty-state message instead of a bare empty list", () => {
  const html = renderDriveListHtml({ locale: "zh-CN", items: [], canManage: true });
  assert.match(html, /这里还没有文件/u);
  assert.doesNotMatch(html, /wh-wb-drive-row/u);
});

test("renderDriveListHtml lists folders before files regardless of input order", () => {
  const html = renderDriveListHtml({
    locale: "zh-CN",
    items: [fileItem({ id: "f1", name: "z-file.md" }), folderItem({ id: "d1", name: "a-folder" })],
    canManage: false
  });
  assert.ok(html.indexOf("a-folder") < html.indexOf("z-file.md"), "folders must render before files");
});

test("renderDriveListHtml gives folders a folder-open affordance and files a preview-open affordance", () => {
  const html = renderDriveListHtml({ locale: "zh-CN", items: [folderItem(), fileItem()], canManage: false });
  assert.match(html, /data-wb-drive-open-folder="folder-1"/u);
  assert.match(html, /data-wb-drive-open-item="file-1" data-wb-drive-open-item-name="report\.md"/u);
});

test("renderDriveListHtml offers a version-history entry for any file that has at least one version", () => {
  const html = renderDriveListHtml({ locale: "zh-CN", items: [fileItem()], canManage: false });
  assert.match(html, /data-wb-drive-open-versions="file-1"/u);
});

test("renderDriveListHtml does not offer a version-history entry for a file with no current version yet", () => {
  const html = renderDriveListHtml({
    locale: "zh-CN",
    items: [fileItem({ current_version_id: undefined, current_version: undefined, download_href: undefined })],
    canManage: false
  });
  assert.doesNotMatch(html, /data-wb-drive-open-versions/u);
});

test("renderDriveListHtml only renders a delete action when the actor can manage the drive and the server allows it", () => {
  const withDeleteHref = fileItem({ delete_href: "/api/drive/projects/p1/items/file-1/delete" });
  const asManager = renderDriveListHtml({ locale: "zh-CN", items: [withDeleteHref], canManage: true });
  const asViewer = renderDriveListHtml({ locale: "zh-CN", items: [withDeleteHref], canManage: false });
  const withoutHref = renderDriveListHtml({ locale: "zh-CN", items: [fileItem({ delete_href: undefined })], canManage: true });
  assert.match(asManager, /data-wb-drive-delete="file-1"/u);
  assert.doesNotMatch(asViewer, /data-wb-drive-delete=/u, "must not render a delete button the server did not authorize");
  assert.doesNotMatch(withoutHref, /data-wb-drive-delete=/u, "must not render a delete button with no delete_href to point at");
});

test("renderDriveListHtml flags AI-delivered files without claiming an ordinary upload is one", () => {
  const delivered = renderDriveListHtml({ locale: "zh-CN", items: [fileItem({ accepted_deliverable: { id: "a1", work_item_id: "w1", proposal_id: "p1", change_id: "c1", target_kind: "text_doc", target_key: "k", change_type: "created", accepted_version: 1, accepted_at: "2026-07-12T09:00:00.000000Z" } })], canManage: false });
  const ordinary = renderDriveListHtml({ locale: "zh-CN", items: [fileItem()], canManage: false });
  assert.match(delivered, /AI 交付/u);
  assert.doesNotMatch(ordinary, /AI 交付/u);
});

// —— R20 DSK-UX（R19-25）：网盘行键盘可达 —— //

test("renderDriveListHtml makes every row keyboard-focusable (role=button + tabindex) with an activation title", () => {
  const html = renderDriveListHtml({ locale: "zh-CN", items: [folderItem(), fileItem()], canManage: false });
  // 两行都要能被键盘聚焦——此前文件夹行是纯 <div>，键盘用户完全进不去子目录。
  const rowMatches = html.match(/class="wh-wb-drive-row"[^>]*role="button"[^>]*tabindex="0"/gu) ?? [];
  assert.equal(rowMatches.length, 2, "both folder and file rows must be focusable buttons");
  assert.match(html, /title="打开文件夹"/u);
  assert.match(html, /title="预览文件"/u);
});

// —— R20 DSK-UX（R19-23）：删除两段式确认 + 回收站 —— //

test("renderDriveListHtml labels the delete action 'move to trash' (honest soft-delete), not a bare 'delete'", () => {
  const item = fileItem({ delete_href: "/api/drive/projects/p1/items/file-1/delete" });
  const html = renderDriveListHtml({ locale: "zh-CN", items: [item], canManage: true });
  assert.match(html, /data-wb-drive-delete="file-1"/u);
  assert.match(html, /移到回收站/u);
  assert.doesNotMatch(html, />删除</u, "the bare misleading '删除' label must be gone");
});

test("renderDriveListHtml arms exactly the delete button whose item is armed, switching its copy to a confirm prompt", () => {
  const a = fileItem({ id: "file-a", delete_href: "/d/a" });
  const b = fileItem({ id: "file-b", delete_href: "/d/b" });
  const html = renderDriveListHtml({ locale: "zh-CN", items: [a, b], canManage: true, deleteArmedItemId: "file-a" });
  assert.match(html, /data-wb-drive-delete="file-a"[^>]*wh-wb-drive-delete-btn--armed|wh-wb-drive-delete-btn--armed[^>]*data-wb-drive-delete="file-a"/u);
  assert.match(html, /确定？再点一次/u);
  // 只有被武装的那一项换文案；另一项仍是普通「移到回收站」。
  const armedCount = (html.match(/确定？再点一次/gu) ?? []).length;
  assert.equal(armedCount, 1, "only the armed item shows the confirm prompt");
});

test("renderDriveBarHtml surfaces a recycle-bin entry only when there are deleted items", () => {
  const withDeleted = renderDriveBarHtml({ locale: "zh-CN", breadcrumb: [{ id: undefined, name: "P" }], canUpload: true, deletedCount: 3 });
  const none = renderDriveBarHtml({ locale: "zh-CN", breadcrumb: [{ id: undefined, name: "P" }], canUpload: true, deletedCount: 0 });
  assert.match(withDeleted, /data-wb-drive-recycle-open[^>]*>[^<]*回收站 · 3|回收站 · 3/u);
  assert.doesNotMatch(none, /data-wb-drive-recycle-open/u, "no recycle entry when the bin is empty");
});

test("renderDriveBarHtml in recycle mode shows a back affordance and the recycle title, no breadcrumb/upload", () => {
  const html = renderDriveBarHtml({ locale: "zh-CN", breadcrumb: [], canUpload: true, recycleActive: true });
  assert.match(html, /data-wb-drive-recycle-back/u);
  assert.match(html, /回收站/u);
  assert.doesNotMatch(html, /data-wb-drive-upload-picker/u, "upload is hidden in the recycle view");
});

test("renderDriveRecycleHtml lists deleted items each with a restore button when restore_href is present", () => {
  const deleted = fileItem({ id: "file-x", name: "gone.md", deleted_at: "2026-07-16T09:00:00.000000Z", restore_href: "/api/drive/projects/p1/items/file-x/restore" });
  const html = renderDriveRecycleHtml({ locale: "zh-CN", items: [deleted] });
  assert.match(html, /gone\.md/u);
  assert.match(html, /data-wb-drive-restore="file-x"/u);
  assert.match(html, /找回/u);
});

test("renderDriveRecycleHtml shows the blocked reason instead of a restore button when restore is blocked", () => {
  const blocked = fileItem({ id: "file-y", name: "stuck.md", restore_blocked_reason: "父级也在回收站，先还原它" });
  const html = renderDriveRecycleHtml({ locale: "zh-CN", items: [blocked] });
  assert.doesNotMatch(html, /data-wb-drive-restore="file-y"/u);
  assert.match(html, /父级也在回收站，先还原它/u);
});

test("renderDriveRecycleHtml shows an empty-state when the bin has nothing", () => {
  const html = renderDriveRecycleHtml({ locale: "zh-CN", items: [] });
  assert.match(html, /回收站是空的/u);
});

test("renderDriveRecycleHtml disables the restore button of the item currently being recovered", () => {
  const deleted = fileItem({ id: "file-z", name: "z.md", restore_href: "/r/z" });
  const html = renderDriveRecycleHtml({ locale: "zh-CN", items: [deleted], restoreBusyId: "file-z" });
  assert.match(html, /data-wb-drive-restore="file-z"[^>]*disabled/u);
  assert.match(html, /找回中…/u);
});

// —— loading/error —— //

test("renderDriveLoadingHtml and renderDriveErrorHtml render distinct, localized states", () => {
  assert.match(renderDriveLoadingHtml("zh-CN"), /正在拉网盘/u);
  assert.match(renderDriveLoadingHtml("en-US"), /Loading the drive/u);
  assert.match(renderDriveErrorHtml("zh-CN"), /data-wb-drive-retry/u);
});

// —— side panel: preview —— //

test("renderDriveSidePanelHtml idle state invites the user to click a file, without pretending anything is selected", () => {
  const html = renderDriveSidePanelHtml({ mode: "idle" }, "zh-CN");
  assert.match(html, /点文件查看预览/u);
});

test("renderDriveSidePanelHtml renders a text preview with a truncation notice only when actually truncated", () => {
  const truncated = renderDriveSidePanelHtml(
    { mode: "preview_text", itemName: "report.md", text: "hello", truncated: true, downloadHref: "/dl" },
    "zh-CN"
  );
  const full = renderDriveSidePanelHtml(
    { mode: "preview_text", itemName: "report.md", text: "hello", truncated: false },
    "zh-CN"
  );
  assert.match(truncated, /仅显示前一部分/u);
  assert.match(truncated, /href="\/dl"/u);
  assert.doesNotMatch(full, /仅显示前一部分/u);
  assert.doesNotMatch(full, /data-wb-drive-side-download/u, "no download link when the state carries none");
});

test("renderDriveSidePanelHtml escapes preview text so file content can't inject markup", () => {
  const html = renderDriveSidePanelHtml(
    { mode: "preview_text", itemName: "x.md", text: "<img src=x onerror=alert(1)>", truncated: false },
    "zh-CN"
  );
  assert.doesNotMatch(html, /<img/u);
  assert.match(html, /&lt;img/u);
});

test("renderDriveSidePanelHtml unsupported preview offers a download instead of pretending to render binary content", () => {
  const html = renderDriveSidePanelHtml({ mode: "preview_unsupported", itemName: "video.mp4", downloadHref: "/dl" }, "zh-CN");
  assert.match(html, /暂不支持在线预览/u);
  assert.match(html, /href="\/dl"/u);
});

// —— side panel: version history —— //

test("renderDriveSidePanelHtml versions_ready marks exactly the current version and offers recovery only for the others", () => {
  const html = renderDriveSidePanelHtml({ mode: "versions_ready", itemName: "report.md", history: history() }, "zh-CN");
  const currentRowIndex = html.indexOf("v2");
  const previousRowIndex = html.indexOf("v1");
  assert.ok(currentRowIndex < previousRowIndex);
  assert.match(html, /data-wb-drive-restore-version="v1"/u);
  assert.doesNotMatch(html, /data-wb-drive-restore-version="v2"/u, "the current version must not offer to recover itself");
  assert.match(html, /当前版本/u);
});

test("renderDriveSidePanelHtml versions_ready shows the operator and size for every version", () => {
  const html = renderDriveSidePanelHtml({ mode: "versions_ready", itemName: "report.md", history: history() }, "zh-CN");
  assert.match(html, /阿曼/u);
  assert.match(html, /1\.0 KB/u);
  assert.match(html, /2\.0 KB/u);
});

test("renderDriveSidePanelHtml disables only the version currently being recovered, with no git jargon in the button copy", () => {
  const html = renderDriveSidePanelHtml(
    {
      mode: "versions_ready",
      itemName: "report.md",
      history: history(),
      rollback: { versionId: "v1", busy: true }
    },
    "zh-CN"
  );
  assert.match(html, /data-wb-drive-restore-version="v1"[^>]*disabled/u);
  assert.match(html, /找回中…/u);
  assert.doesNotMatch(html, /\brevert\b/iu);
  assert.doesNotMatch(html, /\brollback\b/iu);
});

// R14（网盘回滚两端对齐）：回滚是覆盖性动作——之前一点「找回这个版本」就立刻发请求，没有任何确认。
// 武装态下按钮要换成「确定？再点一次」的措辞，并把真实服务端语义（新建版本、不抹历史）摆在旁边。

test("renderDriveSidePanelHtml arms the recovery button on the targeted version without disabling it or touching others", () => {
  const html = renderDriveSidePanelHtml(
    { mode: "versions_ready", itemName: "report.md", history: history(), armedVersionId: "v1" },
    "zh-CN"
  );
  assert.match(html, /class="[^"]*wh-wb-drive-restore-btn--armed[^"]*"[^>]*data-wb-drive-restore-version="v1"/u);
  assert.doesNotMatch(html, /data-wb-drive-restore-version="v1"[^>]*disabled/u, "armed is not the same as busy — the button must still be clickable to confirm");
  assert.match(html, /确定？再点一次找回/u);
  assert.match(html, /会把这一版的内容存成一个新的当前版本，原来的版本历史都还在/u);
});

test("renderDriveSidePanelHtml does not arm a version the user has not clicked", () => {
  const html = renderDriveSidePanelHtml(
    { mode: "versions_ready", itemName: "report.md", history: history() },
    "zh-CN"
  );
  assert.doesNotMatch(html, /wh-wb-drive-restore-btn--armed/u);
  assert.doesNotMatch(html, /确定？再点一次找回/u);
  assert.match(html, /找回这个版本/u);
});

test("renderDriveSidePanelHtml armed hint has an English translation with no git jargon", () => {
  const html = renderDriveSidePanelHtml(
    { mode: "versions_ready", itemName: "report.md", history: history(), armedVersionId: "v1" },
    "en-US"
  );
  assert.match(html, /Sure\? Click again to recover/u);
  assert.match(html, /This creates a new current version from this content — the rest of the history stays\./u);
  assert.doesNotMatch(html, /\brevert\b/iu);
  assert.doesNotMatch(html, /\brollback\b/iu);
});

test("renderDriveSidePanelHtml a busy rollback (second click already fired) takes priority over a stale armed flag", () => {
  const html = renderDriveSidePanelHtml(
    {
      mode: "versions_ready",
      itemName: "report.md",
      history: history(),
      armedVersionId: "v1",
      rollback: { versionId: "v1", busy: true }
    },
    "zh-CN"
  );
  assert.match(html, /找回中…/u);
  assert.doesNotMatch(html, /确定？再点一次找回/u);
});

test("renderDriveSidePanelHtml surfaces a per-version rollback error without losing the rest of the list", () => {
  const html = renderDriveSidePanelHtml(
    {
      mode: "versions_ready",
      itemName: "report.md",
      history: history(),
      rollback: { versionId: "v1", busy: false, error: "网络错误，请重试" }
    },
    "zh-CN"
  );
  assert.match(html, /网络错误，请重试/u);
  assert.match(html, /data-wb-drive-restore-version="v1"/u);
});

test("renderDriveSidePanelHtml confirms a successful recovery in plain language, not git jargon", () => {
  const html = renderDriveSidePanelHtml(
    { mode: "versions_ready", itemName: "report.md", history: history(), justRolledBackVersionNo: 1 },
    "zh-CN"
  );
  assert.match(html, /已找回 v1 的内容，追加成了新版本——原历史都还在。/u);
});

test("renderDriveSidePanelHtml versions_ready in English avoids Chinese-only copy leaking through", () => {
  const html = renderDriveSidePanelHtml({ mode: "versions_ready", itemName: "report.md", history: history() }, "en-US");
  assert.match(html, /Current/u);
  assert.match(html, /Version history/u);
});
