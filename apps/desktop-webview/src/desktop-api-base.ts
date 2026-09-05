// WorkHub 桌面 · API 基地址（localStorage workhub_api_base）的统一读取/校验口（DSK-05）。
// 背景：桌面 webview 打包后同源是 tauri://（没有 /api），必须连一个显式后端地址；离线卡允许用户
// 覆盖这个地址。此前覆盖值原样落盘、读取端只 trim 不校验—— javascript:/data: 这类伪协议或
// 畸形串会被当基地址拼进每个请求。这里收敛为单一校验口：只接受 http/https 绝对地址（不带凭据/
// 查询串/hash），归一化掉末尾斜杠；非法值读取端按「未配置」回落本机默认，写入端拒存。
// R24 S1（自托管远端服务器）：打包后的 CSP connect-src 曾只放行 'self' + 本机回环 + ipc，等于把
// 「团队服务器不在本机」这个主场景锁死（局域网 IP 与公司域名一律连不出去）。现已放开为
// `http: https: ws: wss:`（client-tauri/src-tauri/tauri.conf.json；script-src 'self' / object-src 'none'
// 等入口指令一字未动）。CSP 这道**出口闸**放开后，替代它的是三道应用层补偿控制：
//   C1 单 origin 钉死——所有带令牌的请求/流地址的目标 origin 必须等于当前配置的服务器地址 origin
//      （packages/api-client 的 resolveWorkHubApiUrl；网盘资源另见 spotlight/views/drive.ts 的
//      assertDriveResourceSameOrigin；桌面 run 流的先例是 DSK-08）。
//   C2 地址只能来自**用户键盘输入**——连接服务器屏（desktop-connect-screen.ts）的输入框是唯一来源，
//      绝不从深链、剪贴板、window.name 或任何服务端响应体里自动采纳；改地址必须走
//      「测试连接 → 看到这台服务器的信息 → 显式确认」三步。
//   C3 换服务器即清身份——地址一变立刻清设备令牌并通知壳层，绝不把 A 服务器的令牌发给 B。
// 终局仍是把令牌迁出 webview（.agents/notes/proposed/2026-08-20-desktop-client-token-shell-storage.md）。

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
