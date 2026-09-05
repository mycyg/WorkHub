// WorkHub 桌面 · API 基地址（localStorage workhub_api_base）的统一读取/校验口（DSK-05）。
// 背景：桌面 webview 打包后同源是 tauri://（没有 /api），必须连一个显式后端地址；离线卡允许用户
// 覆盖这个地址。此前覆盖值原样落盘、读取端只 trim 不校验—— javascript:/data: 这类伪协议或
// 畸形串会被当基地址拼进每个请求。这里收敛为单一校验口：只接受 http/https 绝对地址（不带凭据/
// 查询串/hash），归一化掉末尾斜杠；非法值读取端按「未配置」回落本机默认，写入端拒存。
// 网络层还有第二道闸：tauri.conf.json 的 CSP connect-src 只放行 'self' + 本机回环 + ipc——
// 即使存进了非回环地址，打包后的 webview 也连不出去（见 tauri.conf.json 注释的取舍说明）。

import { defaultPorts } from "@workhub/config/ports";

export const DESKTOP_API_BASE_STORAGE_KEY = "workhub_api_base";

export function defaultDesktopApiBase(): string {
  return `http://127.0.0.1:${defaultPorts.api}`;
}

// 合法化用户输入的 API 基地址；非法返回 undefined。归一化：trim + 去末尾斜杠 + 丢弃尾路径之外的多余部分。
export function normalizeDesktopApiBase(raw: string | null | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return undefined;
  }
  // URL 里嵌用户名/密码（http://user:pass@host）或查询串/hash 不是基地址的合法形态，一律拒。
  if (url.username || url.password || url.search || url.hash) {
    return undefined;
  }
  const path = url.pathname.replace(/\/+$/u, "");
  return `${url.origin}${path}`;
}

// 读取端：存着的值非法（历史脏数据/手改）时按「未配置」处理，回落本机默认，绝不把脏值拼进请求。
export function resolveDesktopApiBaseFromStorage(
  storage: Pick<Storage, "getItem"> | undefined
): string {
  let stored: string | null = null;
  try {
    stored = storage?.getItem(DESKTOP_API_BASE_STORAGE_KEY) ?? null;
  } catch {
    stored = null;
  }
  return normalizeDesktopApiBase(stored) ?? defaultDesktopApiBase();
}
