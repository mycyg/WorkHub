# 桌面端设备令牌迁移到 Rust 壳层托管存储

- Status: proposed
- Date: 2026-08-20
- Owner: fix-agent（桌面遗留批）

## Problem

桌面端设备令牌（client token）以**明文**存于 webview localStorage（`workhub_client_token`），且
main / pet / workbench 三个窗口同一 Tauri 数据源、同源共享（DSK-06）。后果：

- 任一窗口里任何能执行 JS 的代码（含潜在 XSS）都能读出令牌；持有令牌 = 这台设备的完整身份。
- 三窗各自读写同一份明文，读路径/写路径一度散落在 6+ 个模块（本轮已收敛到
  `apps/desktop-webview/src/desktop-client-token.ts` 单一 helper，并标注风险）。

本轮已做的缓解（不消除根因）：CSP `connect-src` 收敛到 `'self' + 本机回环 + ipc`
（tauri.conf.json），令牌即使被读到也难以经 fetch/EventSource 外泄到任意外部主机。

## Decision

提议把令牌的**权威存储**迁到 Rust 壳层（进程内存或 OS keychain），webview 不再持有明文：

1. 壳层已有 `set_client_token` 通道（managed `ShellClientToken`，供 Rust SSE worker 注入鉴权头）——
   存储侧地基已存在。
2. webview 的 API 请求改由壳层代理注入 `X-YQGL-Client-Token` 头，或 webview 改为持「会话句柄」
   而非令牌本体（所有鉴权请求经自定义 Tauri 命令/协议转发）。
3. 迁移后 localStorage 只留「已绑定」布尔标记，令牌本身不再出现在任何 webview 可读位置。

## Alternatives considered

- **维持 localStorage + 收紧 CSP（本轮已做）**：成本最低，但令牌仍可被同进程 JS 读取，
  XSS 一条就能把令牌经任意合法通道（如让 API 请求路径本身编码令牌回环到攻击者控制的本机端口）渗出的
  残余面仍在。只能算缓解。
- **迁到 Rust 侧 + webview 请求由壳层代理注入鉴权**：彻底，但工作量大——所有 fetch/SSE
  （desktop-cuu-runtime 的自制 fetch EventSource、workbench chat stream、drive 资源下载、
  头像 fetchDriveResource）都要改走代理通道，跨域/CORS/流式语义都要重验。本轮不修，记录决策。
- **OS keychain（tauri-plugin-stronghold / keyring）**：比内存托管更进一步（重启持久化且加密），
  但引入新原生依赖与平台差异，等代理通道落地后再评估。

## Consequences

- 在迁移完成前，`desktop-client-token.ts` 是令牌读写的唯一合法入口；新增令牌读写点必须走它。
- 任何「让 webview 重新持有令牌明文」的改动都视为回退，应在 review 时拦截。
- 迁移落地时要同步处理：登出清壳层令牌（现有 `clear_client_token` 通道）、token 重铸后
  三窗一致性（现有代际化逻辑）、QA 通道（`WORKHUB_CUU_QA_CLIENT_TOKEN` env 注入）。
