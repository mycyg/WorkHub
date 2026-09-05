// WorkHub 桌面 · 设备令牌（client token）localStorage 读写的单一收口（DSK-06）。
//
// ⚠️ 已知风险（本轮只收口 + 标注，不消除）：
// 设备令牌以**明文**存 localStorage，且 main / pet / workbench 三个窗口同一 Tauri 数据源、同源共享——
// 任一窗口里任何能跑 JS 的代码（含潜在的 XSS）都能读到它；持有令牌即等同这台设备的身份。
// 缓解现状（R24 S1 起变了）：CSP connect-src 曾只放行 'self' + 本机回环，把令牌外泄的门槛抬高了一点；
// 为了让桌面端能连自托管的远端服务器，那条限制已放开为 http:/https:（见 tauri.conf.json 与
// desktop-api-base.ts 顶部的取舍说明）。顶上来的是三道应用层补偿控制 C1/C2/C3（单 origin 钉死 /
// 地址只能人手敲 / 换服务器即清身份），它们挡的是「被诱导连到攻击者服务器」这条更现实的路。
// 真正的修复仍是把令牌迁到 Rust 壳层托管存储（壳层已有 set_client_token 通道管一份内存副本供 SSE
// worker 用）——迁移落地后 connect-src 的松紧对令牌外泄的影响趋近于零。提案见
// .agents/notes/proposed/2026-08-20-desktop-client-token-shell-storage.md。
//
// 收敛约定：桌面端所有窗口读写令牌都必须过这三个函数，不再各自手写键名——
// 键顺序（新键优先、兼容期回退 yqgl_* 旧键）只在这里定义一次。

const CLIENT_TOKEN_KEYS = ["workhub_client_token", "yqgl_client_token"] as const;

// 读：先读新键，兼容期回退旧的 yqgl_* 键。
export function readDesktopClientToken(storage: Pick<Storage, "getItem">): string | undefined {
  for (const key of CLIENT_TOKEN_KEYS) {
    const value = storage.getItem(key);
    if (value) {
      return value;
    }
  }
  return undefined;
}

// 写：只落新键（旧 yqgl_* 键进入退役期，不再镜像写入）。
export function writeDesktopClientToken(storage: Pick<Storage, "setItem">, token: string): void {
  storage.setItem(CLIENT_TOKEN_KEYS[0], token);
}

// 清：新旧两键都删（登出/令牌陈旧重铸）。
export function clearDesktopClientToken(storage: Pick<Storage, "removeItem">): void {
  for (const key of CLIENT_TOKEN_KEYS) {
    storage.removeItem(key);
  }
}
