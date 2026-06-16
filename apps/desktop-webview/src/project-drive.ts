// R7 P4 · 项目「文件」下钻视图(桌面专属,液态玻璃)。
// 纯渲染:把 DrivePageVM 渲染成只读文件浏览——返回按钮 + 项目名 + 概览计数 + 按层级缩进的
// 文件/文件夹列表(文件显示大小与版本号)。返回按钮带 data-proj-back(纯 button,无 href,
// 不会被 bindGoldPathNavigation 劫持),browser.ts 自己的监听处理「返回项目列表」。
// 数据来自 GET /api/pages/drive?project_id=(client.pages.drive),后端已实现。
// 本版只读:不放下载/预览链接(那会被 nav 管线当 api-action 劫持,且二进制下载需桌面桥,留作后续)。
// 不进共享 @workhub/ui;只在桌面注入,Web 与 web-live-route-smoke 不受影响。

import type { DrivePageVM, DriveItemVM, WorkHubLocale } from "@workhub/contracts";
import { escapeHtml } from "@workhub/web-runtime";

function formatBytes(bytes: number, zh: boolean): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  void zh;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function renderItem(item: DriveItemVM, zh: boolean): string {
  const isFolder = item.kind === "folder";
  const indent = Math.min(item.depth, 6) * 16;
  const icon = isFolder ? "🗂" : "📄";
  let meta = "";
  if (isFolder) {
    meta = `<span class="wh-pdrive-meta">${item.children_count} ${zh ? "项" : "items"}</span>`;
  } else if (item.current_version) {
    const version = item.current_version;
    meta = `<span class="wh-pdrive-meta">${escapeHtml(formatBytes(version.size_bytes, zh))} · v${version.version_no}</span>`;
  }
  return `<div class="wh-pdrive-row" data-pdrive-kind="${item.kind}" style="padding-left:${16 + indent}px">
    <span class="wh-pdrive-icon">${icon}</span>
    <span class="wh-pdrive-name">${escapeHtml(item.name)}</span>
    ${meta}
  </div>`;
}

function emptyState(zh: boolean): string {
  return `<div class="wh-pdrive-empty">
    <div class="wh-pdrive-empty-face gl-avatar">(=｀ω´=)ﾉ</div>
    <h3 class="wh-pdrive-empty-title">${zh ? "这个项目还没有文件" : "No files here yet"}</h3>
    <p class="wh-pdrive-empty-sub">${zh ? "AI 交付或你上传后，文件会出现在这里 (=^･ω･^=)" : "AI deliverables and your uploads will show up here (=^･ω･^=)"}</p>
  </div>`;
}

export function renderProjectDriveHtml(input: {
  drive: DrivePageVM;
  projectName: string;
  locale: WorkHubLocale;
}): string {
  const zh = input.locale === "zh-CN";
  const drive = input.drive;
  const name = drive.project?.name ?? input.projectName;
  const back = `<button type="button" class="wh-pdrive-back gl-press" data-proj-back>${zh ? "← 返回项目" : "← Back to projects"}</button>`;
  const liveItems = drive.items.filter((item) => !item.deleted_at);
  const chips = `<div class="wh-pdrive-chips">
    <span class="wh-pdrive-chip"><b>${drive.summary.file_count}</b>${zh ? "文件" : "files"}</span>
    <span class="wh-pdrive-chip"><b>${drive.summary.folder_count}</b>${zh ? "文件夹" : "folders"}</span>
    ${drive.summary.accepted_deliverable_count > 0 ? `<span class="wh-pdrive-chip wh-pdrive-chip--accent"><b>${drive.summary.accepted_deliverable_count}</b>${zh ? "AI 交付" : "AI delivered"}</span>` : ""}
  </div>`;
  const body = liveItems.length === 0
    ? emptyState(zh)
    : `<div class="wh-pdrive-list">${liveItems.map((item) => renderItem(item, zh)).join("")}</div>`;
  return `<div class="wh-pdrive" data-pdrive-project="${escapeHtml(drive.project?.id ?? "")}">
    <header class="wh-pdrive-head">
      ${back}
      <div class="wh-pdrive-headline">
        <h2 class="wh-pdrive-title">${escapeHtml(name)}</h2>
        ${chips}
      </div>
    </header>
    ${body}
  </div>`;
}

// 项目文件下钻液态玻璃样式(桌面注入)。
export const projectDriveCss = [
  ".wh-pdrive{max-width:680px;margin:0 auto;font-family:'M PLUS Rounded 1c','Noto Sans SC',sans-serif}",
  ".wh-pdrive-head{margin-bottom:16px}",
  ".wh-pdrive-back{border:1px solid rgba(255,255,255,.8);border-radius:12px;background:rgba(255,255,255,.5);color:#5d567e;font:800 13px/1 'Noto Sans SC',sans-serif;padding:9px 14px;cursor:pointer;backdrop-filter:blur(20px) saturate(160%);-webkit-backdrop-filter:blur(20px) saturate(160%)}",
  ".wh-pdrive-back:hover{background:rgba(255,255,255,.7)}",
  ".wh-pdrive-headline{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:14px}",
  ".wh-pdrive-title{margin:0;font-size:20px;font-weight:900;color:#2c2746;overflow-wrap:anywhere}",
  ".wh-pdrive-chips{display:flex;gap:8px;flex-wrap:wrap}",
  ".wh-pdrive-chip{font:700 12px/1 'Noto Sans SC',sans-serif;color:#6b6488;background:rgba(255,255,255,.55);border:1px solid rgba(255,255,255,.7);border-radius:11px;padding:7px 11px}.wh-pdrive-chip b{color:#7c83ff;font-size:14px;margin-right:4px}",
  ".wh-pdrive-chip--accent b{color:#1faf86}",
  ".wh-pdrive-list{border-radius:20px;overflow:hidden;background:rgba(255,255,255,.55);backdrop-filter:blur(32px) saturate(180%);-webkit-backdrop-filter:blur(32px) saturate(180%);border:1px solid rgba(255,255,255,.75);box-shadow:0 24px 54px -30px rgba(70,54,140,.55),inset 0 1px 0 rgba(255,255,255,.75)}",
  ".wh-pdrive-row{display:flex;align-items:center;gap:11px;padding:12px 18px;border-top:1px solid rgba(124,131,255,.1)}",
  ".wh-pdrive-row:first-child{border-top:0}",
  ".wh-pdrive-row[data-pdrive-kind=folder] .wh-pdrive-name{font-weight:800}",
  ".wh-pdrive-icon{font-size:17px;flex:0 0 auto}",
  ".wh-pdrive-name{flex:1;min-width:0;font:600 14px/1.4 'Noto Sans SC',sans-serif;color:#2c2746;overflow-wrap:anywhere}",
  ".wh-pdrive-meta{flex:0 0 auto;font:700 12px/1 'M PLUS Rounded 1c','Noto Sans SC',sans-serif;color:#8b84ad;white-space:nowrap}",
  ".wh-pdrive-empty{max-width:560px;margin:8px auto 0;border-radius:24px;padding:46px 30px;text-align:center;background:rgba(255,255,255,.5);backdrop-filter:blur(30px) saturate(170%);-webkit-backdrop-filter:blur(30px) saturate(170%);border:1px solid rgba(255,255,255,.75);box-shadow:0 26px 60px -28px rgba(70,54,140,.5),inset 0 1px 0 rgba(255,255,255,.7)}",
  ".wh-pdrive-empty-face{font:700 32px/1 'M PLUS Rounded 1c',sans-serif}",
  ".wh-pdrive-empty-title{margin:16px 0 0;font-size:19px;font-weight:900;color:#2c2746}",
  ".wh-pdrive-empty-sub{margin:10px 0 0;font-size:13.5px;line-height:1.6;color:#6b6488}"
].join("");
