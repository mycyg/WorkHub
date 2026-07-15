# R14 修复 · 桌面壳/构建三缺陷（BUG-01 / BUG-03 / BUG-06）

分支 `r14fix/shell-recon`（基线 main=9d362c72）。设计稿全文见
`scratchpad/r14fix-shell-design.md`（三 bug 逐条根因贴码 + 修复方案 + 风险 + 切片表）。

## 结论速览

| Bug | 级别 | 根因判定 | 处置 |
|---|---|---|---|
| BUG-01 .app 验签失败无法启动 | P0 | **配置缺失（可修）**：tauri.conf 无 `signingIdentity`、本机无 `APPLE_*` env → bundler `keychain()` 返回 `None` → 整包不签名 | **已施工**（配置 + 验签门禁脚本）；构建执行待 macOS 真机 |
| BUG-03 WebView/Rust SSE 服务端·Token 分裂 | P1 | HTTP base(localStorage) 与 SSE base(Rust env/file) 相互独立；`set_client_token` 无条件用 localStorage 旧 token 覆盖壳层，地址/身份非原子 | 只出设计（Rust 壳改动待人工真机） |
| BUG-06 登出与 SSE token 清除竞态 | P1 | 三处叠加：登出吞错+即发即忘 / Rust 空令牌分支 `notify_waiters` 前 return / worker 不取消在飞的流 | 只出设计（Rust 壳改动待人工真机） |

## BUG-01 已施工改动

铁证链：`tauri-bundler/src/bundle/macos/app.rs` + `sign.rs::keychain()` 在无签名身份时 `Ok(None)` → 跳过整包签名，
`cargo tauri build` 仍 exit 0 但 `.app` 无 `_CodeSignature`。`tauri-macos-sign/src/keychain.rs::sign()` 确认
`signingIdentity="-"` → `codesign --force -s - <path>` 由内向外 ad-hoc 签整包。无公证凭据时 `notarize_auth()` 报 Err 仅
`log::warn` 跳过，不阻断构建。配置键名经 `tauri-utils/src/config.rs` 确认（`signingIdentity` / `hardenedRuntime`）。

1. `client-tauri/src-tauri/tauri.conf.json` — `bundle.macOS` 增 `"signingIdentity": "-"` + `"hardenedRuntime": false`
   （精确复现用户已验证可用的平 ad-hoc；将来公证分发再换真身份 + 开 hardenedRuntime）。
2. `scripts/dev/build-macos-app.sh`（新增，可执行）— `cargo tauri build` + 缺 `_CodeSignature` 兜底 ad-hoc 重签 +
   `codesign --verify --deep --strict` 硬门禁 + `spctl` 诊断（仅「bundle format unrecognized」判红）；非 macOS 自动跳过。
3. `package.json` — 增 `build:desktop-macos`、`qa:desktop-macos-codesign-smoke` 两别名。

验证：`pnpm -r typecheck` 全绿；tauri.conf.json / package.json 合法 JSON；脚本 `bash -n` 通过。
**待人工真机**：本环境无法跑 `cargo tauri build`（macOS 工具链）。落地确认＝macOS 上 `pnpm build:desktop-macos` 门禁绿 + 双击起窗。

## BUG-03 / BUG-06 设计要点（详见设计稿）

- BUG-03：壳层持唯一权威只读连接配置（新 `get_runtime_connection` command），令牌带 server 归属+版本，
  `switch_server` 原子切地址+作废旧 token+重建订阅，收敛 `resolveDesktopApiBase/resolveWorkbenchApiBase` 两份拷贝。
- BUG-06：登出状态机——`await logout()` 成功才 `await set_client_token("")` 再清本地 reload，失败不假装完成；
  Rust 空令牌分支也 `notify_waiters` 并返回 Result；`pump_sse_response` 改可取消，令牌一变即切断在飞的旧身份流。
- 二者 Rust 壳改动均标**待人工真机**（Tauri invoke 契约 + SSE 时序只有 `.app` + 真后端能验），无真机不盲改。
