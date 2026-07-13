import type { DrivePageVM } from "@workhub/contracts";

import { fetchDriveResource } from "../../spotlight/views/drive.js";

// WorkHub 桌面 · 工作台网盘标签的数据访问薄层。批 6 新增的两个端点（GET .../items/:id/versions、
// POST .../items/:id/versions/:versionId/restore）还没有专门的 WorkHubApiClient 具名方法——照
// chat/api.ts 顶部注释的先例（packages/api-client 是共享给 apps/web 的公共面，为一个只有工作台窗口
// 用的批次特性扩大它不值得），走 client.request<T> 这个既有的类型安全转发口。
// 文件/文件夹列表、上传、删除、恢复都是既有能力（严格复用 client.pages.drive / uploadDriveFile /
// deleteDriveItem / restoreDriveItem，不在这里重新声明）。预览/下载走 spotlight/views/drive.ts
// 导出的 fetchDriveResource/downloadDriveResource（同一套桌面 client-token 鉴权 + 401 自愈重试，
// 不重复实现——这两个端点返回的不是 {ok,data} JSON 信封统一走 client.request 会丢状态码信息）。

export type DriveVersionEntry = {
  id: string;
  version_no: number;
  filename: string;
  mime?: string;
  size_bytes: number;
  sha256?: string;
  created_at: string;
  created_by_label: string;
  current: boolean;
  // 只在请求者可管理网盘、且这一行不是当前版本时服务端才会给——前端据此判断要不要渲染「找回」按钮。
  restore_href?: string;
};

export type DriveVersionHistory = {
  item_id: string;
  filename: string;
  current_version_id?: string;
  versions: DriveVersionEntry[];
};

export type DriveVersionsApiClient = {
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
};

function driveItemVersionsPath(projectId: string, itemId: string): string {
  return `/api/drive/projects/${encodeURIComponent(projectId)}/items/${encodeURIComponent(itemId)}/versions`;
}

export function fetchDriveItemVersions(
  client: DriveVersionsApiClient,
  projectId: string,
  itemId: string,
  input: { limit?: number } = {}
): Promise<DriveVersionHistory> {
  const query = new URLSearchParams();
  if (input.limit !== undefined) {
    query.set("limit", String(input.limit));
  }
  const qs = query.toString();
  return client.request<DriveVersionHistory>(`${driveItemVersionsPath(projectId, itemId)}${qs ? `?${qs}` : ""}`);
}

// 回滚=追加新版本，不抹历史；返回刷新后的整页网盘 VM（与 uploadDriveFile/deleteDriveItem 同构，用
// import type 而不是重复声明，避免两份 DrivePageVM 形状漂移）。
export type DriveTextPreviewResult =
  | { ok: true; text: string; truncated: boolean; downloadHref: string }
  | { ok: false; unsupported: true }
  | { ok: false; unsupported: false; message: string };

function driveItemPreviewPath(projectId: string, itemId: string): string {
  return `/api/drive/projects/${encodeURIComponent(projectId)}/items/${encodeURIComponent(itemId)}/preview`;
}

// 415（drive_preview_unsupported）是「这类文件本来就不支持在线预览」的正常分支，不是错误——
// 调用方要能把它和真失败（网络错误/403 等）区分开，分别渲染「下载吧」vs「预览失败，重试」。
// client.request<T> 的信封解包在非 2xx 时统一抛错、丢状态码，这里改用低层 fetchDriveResource
// 自己读 response.status，与 spotlight 的 fetchDrivePreview 同一套鉴权但保留状态码判别。
export async function fetchDriveItemTextPreview(
  projectId: string,
  itemId: string,
  apiBaseUrl?: string
): Promise<DriveTextPreviewResult> {
  const href = driveItemPreviewPath(projectId, itemId);
  const response = await fetchDriveResource(href, {}, apiBaseUrl);
  let body: { ok?: boolean; data?: { text?: string; truncated?: boolean; download_href?: string }; error?: { message?: string } } = {};
  try {
    body = await response.json();
  } catch {
    // 非 JSON 响应体：落回下方通用错误分支，用一个诚实的默认信息而不是让调用方拿到 undefined。
  }
  if (response.status === 415) {
    return { ok: false, unsupported: true };
  }
  if (!response.ok || body.ok !== true || !body.data) {
    return { ok: false, unsupported: false, message: body.error?.message ?? "preview failed" };
  }
  return {
    ok: true,
    text: body.data.text ?? "",
    truncated: Boolean(body.data.truncated),
    downloadHref: body.data.download_href ?? href.replace(/\/preview$/u, "/download")
  };
}

export function rollbackDriveItemVersion(
  client: DriveVersionsApiClient,
  projectId: string,
  itemId: string,
  targetVersionId: string
): Promise<DrivePageVM> {
  return client.request<DrivePageVM>(`${driveItemVersionsPath(projectId, itemId)}/${encodeURIComponent(targetVersionId)}/restore`, {
    method: "POST"
  });
}
