import type { WorkHubLocale } from "@workhub/ui/gold-path";
import { escapeHtml, safeHref } from "@workhub/web-runtime";

export type DrivePreviewPayload = {
  filename?: string | undefined;
  mime?: string | undefined;
  size_bytes?: number | undefined;
  preview_type?: string | undefined;
  text?: string | undefined;
  truncated?: boolean | undefined;
  download_href?: string | undefined;
};

export function drivePreviewTitle(preview: DrivePreviewPayload, locale: WorkHubLocale) {
  const filename = preview.filename?.trim();
  if (locale === "en-US") {
    return filename ? `Preview: ${filename}` : "File preview";
  }
  return filename ? `预览：${filename}` : "文件预览";
}

function drivePreviewFallbackText(locale: WorkHubLocale) {
  return locale === "en-US"
    ? "This file has no text preview. Download it to inspect the original."
    : "这个文件暂无文本预览，请下载原文件查看。";
}

function drivePreviewTypeLabel(previewType: string | undefined, locale: WorkHubLocale) {
  const normalized = previewType?.trim().toLowerCase();
  if (!normalized) {
    return "";
  }
  if (normalized === "text") {
    return locale === "en-US" ? "Text preview" : "文本预览";
  }
  if (normalized === "cached_text") {
    return locale === "en-US" ? "Cached text preview" : "缓存文本预览";
  }
  return locale === "en-US" ? "Preview available" : "可预览";
}

function drivePreviewSizeLabel(sizeBytes: number | undefined, locale: WorkHubLocale) {
  if (typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes)) {
    return "";
  }
  const size = Math.max(0, Math.trunc(sizeBytes));
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    const value = size / 1024;
    return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(locale === "zh-CN" ? 0 : 1)} KB`;
  }
  const value = size / 1024 / 1024;
  return `${value.toFixed(1)} MB`;
}

export function drivePreviewPanelHtml(preview: DrivePreviewPayload, locale: WorkHubLocale) {
  const meta = [
    drivePreviewTypeLabel(preview.preview_type, locale),
    drivePreviewSizeLabel(preview.size_bytes, locale),
    preview.truncated ? (locale === "en-US" ? "Truncated" : "已截断") : ""
  ].filter(Boolean).join(" · ");
  const download = preview.download_href
    ? `<a class="wh-btn" href="${escapeHtml(safeHref(preview.download_href))}" data-action-id="drive_download" data-native-resource-link="true" target="_blank" rel="noreferrer">${escapeHtml(locale === "en-US" ? "Download" : "下载")}</a>`
    : "";
  const text = typeof preview.text === "string" && preview.text.length > 0
    ? preview.text
    : drivePreviewFallbackText(locale);
  return `<h3>${escapeHtml(drivePreviewTitle(preview, locale))}</h3>${meta ? `<p>${escapeHtml(meta)}</p>` : ""}<pre class="wh-r5-drive-preview-body">${escapeHtml(text)}</pre>${download ? `<div class="wh-r4-route-actions">${download}</div>` : ""}`;
}
