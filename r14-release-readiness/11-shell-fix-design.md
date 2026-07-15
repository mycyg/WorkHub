# R14 修复 · 桌面壳/构建三缺陷（BUG-01 / BUG-03 / BUG-06）根因 + 修复设计

分支 `r14fix/shell-recon`（worktree），基线 main=9d362c72。环境：cargo-tauri 2.11.3，tauri crate 2.11.2，
tauri-bundler 2.9.x / tauri-macos-sign 2.3.4（cargo registry 缓存源确认）。

三缺陷都在“Rust 壳 ↔ WebView ↔ 构建产物”边界上，风险各不同：
- **BUG-01** 是纯构建配置缺失，根因铁证、修法一步到位，**已施工**（下）。
- **BUG-03 / BUG-06** 是运行时连接/身份状态机，涉 Rust 逻辑，**只出设计不盲改**（无真机不动 Rust 壳）。

---

## BUG-01 [P0] 正式 .app 验签失败无法启动 —— 已施工

### 根因（铁证）

`.app` 由手动 `cargo tauri build` 产出（仓库无 package.json 脚本封装，产物在
`client-tauri/src-tauri/target/release/bundle/macos/WorkHub.app`）。tauri-bundler 的 macOS 签名判定：

`tauri-bundler/src/bundle/macos/app.rs`：
```rust
} else if let Some(keychain) =
    super::sign::keychain(settings.macos().signing_identity.as_deref())?
{
    ... remove_extra_attr(&app_bundle_path)?;
    sign(&keychain, sign_paths, settings)?;   // 只有拿到 keychain 才签
}
```
`tauri-bundler/src/bundle/macos/sign.rs::keychain()`：
```rust
if let (Some(cert), Some(pw)) = (var_os("APPLE_CERTIFICATE"), var_os("APPLE_CERTIFICATE_PASSWORD")) {
    ... // CI 证书路径
} else if let Some(identity) = identity {           // = bundle.macOS.signingIdentity / APPLE_SIGNING_IDENTITY
    Ok(Some(Keychain::with_signing_identity(identity)))
} else {
    Ok(None)                                          // ← 当前命中：整包不签名
}
```

当前 `tauri.conf.json` 的 `bundle.macOS` **只有 `infoPlist`，没有 `signingIdentity`**，本机也没有
`APPLE_SIGNING_IDENTITY` / `APPLE_CERTIFICATE`。于是 `keychain()` 返回 `Ok(None)` → bundler **完全跳过签名**，
`cargo tauri build` 仍 exit 0。产出的 `WorkHub.app` **没有 `Contents/_CodeSignature/CodeResources`**。
Apple Silicon 上 linker 仍会给 Mach-O 可执行体打一个 ad-hoc 标记（arm64 运行的硬性要求），但 **bundle 层无封印**：
- `codesign --verify` → 「code has no resources but signature indicates they must be present」
- `spctl` → 「bundle format unrecognized」
- 启动即被 AMFI SIGKILL(137)
- 裸跑 `target/release/workhub-client-tauri` 可以（那是可执行体自身的 linker ad-hoc），复制 .app 后手动
  `codesign --force --deep --sign -` 补上 bundle 封印即可验签可启动 —— 与上述判定完全吻合。

**判定：配置缺失（可修），非“本机无证书环境限制”。** 无 Apple 证书时的正确 ad-hoc 签名机制存在且一等公民支持。

### 为什么 `signingIdentity: "-"` 就是正解

`tauri-macos-sign/src/keychain.rs::sign()` 对每个目标执行：
```rust
let identity = match &self.signing_identity { SigningIdentity::Identifier(i) => i.clone(), ... };
let mut args = vec!["--force", "-s", &identity];      // identity="-" → `codesign --force -s - <path>`
if hardened_runtime { args.push("--options"); args.push("runtime"); }
```
`codesign -s -` 正是 ad-hoc 签名。bundler 会**由内向外**签（frameworks → sidecar → .app bundle），
生成完整 `_CodeSignature/CodeResources` —— 这比手动 `--deep`（已被 Apple 弃用）更正规。

无公证凭据时 `notarize_auth()` 返回 Err（非 `MissingTeamId`），bundler 只 `log::warn!("skipping app notarization")`
继续，**不会因此让构建失败**（app.rs:143-149 已确认）。故加 `signingIdentity` 不引入公证副作用。

`hardenedRuntime` 默认 `true` → 会多带 `--options runtime`。本地/开发 ad-hoc 包**不公证**，hardened runtime
无收益且可能引入库校验/JIT 意外；且用户已验证可用的手动修法是**平 ad-hoc（无 --options runtime）**。为**精确复现**
已验证可用状态、把启动风险压到最低，同时设 `hardenedRuntime: false`。将来配真 Developer ID + 公证时，
把 `signingIdentity` 换成真实身份并重新开 `hardenedRuntime` 即可。

配置键名确认（`tauri-utils/src/config.rs`）：`pub signing_identity: Option<String>`，serde 名 `signingIdentity`
（kebab 别名 `signing-identity`）；`hardened_runtime` 默认 `default_true`，serde 名 `hardenedRuntime`。

### 已施工的改动（本分支）

1. `client-tauri/src-tauri/tauri.conf.json` — `bundle.macOS` 增：
   ```json
   "signingIdentity": "-",
   "hardenedRuntime": false
   ```
   → `cargo tauri build` 自身即 ad-hoc 由内向外签整包，一步到位。

2. `scripts/dev/build-macos-app.sh`（新增，可执行）— 构建 + 验签 smoke 门禁：
   - `cargo tauri build`（透传 `$@`）；
   - 若 bundle 仍缺 `_CodeSignature` → 兜底 `codesign --force --deep --sign -`；
   - `codesign --verify --deep --strict` 必须过，否则非零退出（BUG-01 回归即红）；
   - `spctl` 只作诊断（ad-hoc 必然 rejected/未公证，属预期），仅当再现「bundle format unrecognized」才判失败；
   - `WORKHUB_MACOS_BUILD_SKIP_BUILD=1` 可只验已存在的 .app；非 macOS 平台自动跳过（exit 0）。

3. `package.json` 增两个脚本别名：
   - `build:desktop-macos` → 跑构建+验签；
   - `qa:desktop-macos-codesign-smoke` → 只验签（`WORKHUB_MACOS_BUILD_SKIP_BUILD=1`）。

**typecheck 全绿**（未碰 TS 逻辑）。JSON 均合法，bash 语法 OK。
**待人工真机**：本环境不能跑 `cargo tauri build`（macOS 原生工具链 + 时间）。落地确认＝在 macOS 上跑
`pnpm build:desktop-macos`，看门禁绿 + 双击 .app 能起窗。若 hardenedRuntime 关掉后仍希望公证分发，那是另一条
（配 Developer ID）线，不在本 P0 范围。

---

## BUG-03 [P1] WebView 与 Rust SSE 服务端/Token 分裂 —— 只出设计

### 连接配置的全部来源（盘点）

**WebView 侧（HTTP，走 fetch）**
- 服务地址 `resolveDesktopApiBase()`（`apps/desktop-webview/src/browser.ts:136-142`；工作台窗另有一份拷贝
  `workbench/boot.ts:34-40`）：`localStorage["workhub_api_base"]` 覆盖，否则默认 `http://127.0.0.1:8787`。
- 令牌 `clientToken()`（`browser.ts:128-130` / `boot.ts:22-31`）：`localStorage["workhub_client_token"]`
  → 回退 `["yqgl_client_token"]`；没有则 `bootstrapDesktop()` 现拿一个塞回 localStorage。

**Rust 壳侧（SSE，走 reqwest）**
- 服务地址 `WorkHubShellConfig.server_url`（`config.rs`）：`workhub-shell-config.json` 文件 → env
  `WORKHUB_SERVER_URL` 覆盖，默认 `http://127.0.0.1:8787`；SSE 目标 URL 在 `setup()` 一次性算进
  `subscription.url`（`sse.rs::plan_shell_sse_subscription`），**启动后不再变**。
- 令牌 `ShellClientToken`（`sse_worker.rs:26-27`）：启动读 file/env 的 `client_token`，随后被 WebView 经
  `set_client_token`（`main.rs:478-502`）**运行时覆盖**为 localStorage 里的令牌；SSE worker 每次重连前重读它注头。

### 根因（分裂点）

两条链的**地址来源相互独立**，令牌来源却被 WebView 单方向压过壳层：

1. **地址分裂**：HTTP base 认 `localStorage["workhub_api_base"]`，SSE base 认 Rust `server_url`（env/file）。
   若某次调试把 `workhub_api_base` 指到后端 B，而 Rust env/config 仍是默认/后端 A → **HTTP 打 B、SSE 打 A**。
2. **身份分裂**：WebView 对着 B 做 `bootstrapDesktop()` 拿到 **B 签发**的 token，存 localStorage 并经
   `pushClientTokenToShell → set_client_token` 推给 Rust；Rust SSE 于是**拿着 B 的 token 连 A**（对 A 是无效/错身份）。
   即便地址一致，`set_client_token` 也**无条件**用 localStorage 里的**旧 token** 覆盖 env 里刻意下发的可信设备 token
   （`main.rs:497-499` 直接 `*guard = Some(...)`，不核对来源/后端）——env 令牌被 localStorage 静默清洗。
3. **无原子切换**：地址与身份不是一起翻的。改地址（localStorage）不重铸 token，改 token 不校验它属于哪个后端。

### 设计：单一、只读、原子的 runtime connection config（壳层为权威）

目标：桌面运行时连接配置**由 Rust 壳唯一持有并暴露给 WebView 只读**；令牌归属（属于哪个 server identity）明确、带版本；
服务地址与身份**原子切换**；**禁止** localStorage 在未核对 server identity 时覆盖壳层配置。

**D-1 壳层暴露只读连接配置（新 command）**
- 新增 `#[tauri::command] get_runtime_connection() -> RuntimeConnection { server_url, identity_ref, token_version }`。
  `server_url` 取自 `WorkHubShellConfig`（唯一权威）；`identity_ref` = 当前 token 绑定的后端指纹（见 D-3）；
  `token_version` 单调递增（每次 token 变更 +1）。
- WebView 的 `resolveDesktopApiBase()` **改为优先读这个 command 的 `server_url`**，localStorage 仅作 command 不可用
  （纯浏览器 dev）时的回退；不再让 localStorage 覆盖壳层地址。工作台窗 `boot.ts` 那份拷贝同改（两处要一致）。

**D-2 令牌带 server 归属 + 版本**
- `ShellClientToken` 从 `(Mutex<Option<String>>, Notify)` 升级为持 `Option<TokenSlot { token, server_url, version }>`。
- `set_client_token` 收令牌时**必须带来源 server_url**（WebView 把它 bootstrap 用的 base 一起传）。若与壳层
  `server_url` **不一致 → 拒绝写入并回错**（WebView 据此提示“请在设置里切换服务器，而不是只改 localStorage”）。
  → 根除“B 的 token 连 A”。

**D-3 地址+身份原子切换（唯一改地址入口）**
- 新增 `switch_server(server_url)` command：壳层内**原子**地 (a) 更新 `server_url`，(b) 作废旧 token（version+1），
  (c) 触发 SSE worker 用新 URL 重建订阅（当前 `subscription.url` 是启动时算死的，需让 worker 能重算，见风险）。
  WebView 换后端只能走它，不能再私改 localStorage。切完 WebView 重新 bootstrap 对新后端拿 token 再 `set_client_token`
  （带新 server_url，D-2 校验通过）。

**D-4 收敛地址来源**
- `resolveDesktopApiBase()` 与 `resolveWorkbenchApiBase()` 两份**同逻辑拷贝**收敛成一个共享 helper（现已各写一份，
  易漂移）；语义改为“壳层 command 优先，localStorage 回退”。

### 风险评估
- **中高**：`subscription.url` 目前在 `setup()` 一次性算死，SSE worker 循环内不重读地址。D-3 要让 worker 支持
  “地址变更→丢弃旧订阅、按新 URL 重建” —— 是 `run_sse_subscription` 结构改动（新增地址变更信号，或重启 worker 集合）。
- **中**：`set_client_token` 签名要加 `server_url` 参数（破坏 WebView↔Rust 契约），browser.ts / boot.ts / settings.ts
  三处调用点齐改。
- **低**：`get_runtime_connection` / `resolveDesktopApiBase` 收敛是纯增量。
- 全部**需真机验证**（Tauri invoke 契约 + 真实跨后端切换只有 .app 能验），Rust 改动不在无真机环境盲写。

---

## BUG-06 [P1] 登出与 Rust SSE token 清除竞态 —— 只出设计

### 根因（三处叠加，登出“假装完成”且旧流不断）

**① WebView 登出吞错 + fire-and-forget（`spotlight/views/settings.ts:733-761`）**
```ts
void ctx.client.logout()
  .catch(() => undefined)          // 服务端吊销失败被吞
  .then(() => {                    // 无论成功失败都往下走
    localStorage.removeItem("workhub_client_token"); ...
    localStorage.setItem("workhub_desktop_logged_out","1");
    invoke("set_client_token", { token: "" }).catch(() => undefined);  // 不 await，即发即忘
    window.location.reload();      // 立刻 reload，不等 set_client_token 落地
  });
```
→ 服务端 `logout`（`apps/api/src/routes/auth.ts:717` 会 `devices.revokeByTokenHash` 吊销设备令牌）若失败（网络/500），
本地照样清干净并 reload，**装作已登出**，但服务端设备令牌其实还有效。且 `set_client_token("")` 不被等待，
reload 可能先发生。

**② Rust 空令牌分支在 `notify_waiters()` 前 return（`main.rs:479-501`）**
```rust
fn set_client_token(state, token) {
    if trimmed.is_empty() {
        *guard = None;
        return;                    // ← 早退，下面的 notify_waiters() 到不了
    }
    ...
    state.1.notify_waiters();      // 只有“设新令牌”才唤醒 worker
}
```
→ 清空令牌时 worker **不被唤醒**。

**③ SSE worker 只在流结束后才进 select，当前连接不被取消（`sse_worker.rs:83-138`）**
- worker 只在**每轮循环顶部**（开连接前，line 92-95）重读令牌；令牌变更的 `notify.notified()` 只能打断
  **退避 sleep**（line 131-135），**打断不了正在 `pump_sse_response` 的活流**。
→ 登出后一条已经打开的、带旧身份的 `/api/push/stream/me` 会**一直跑到服务端主动断/网络掉**为止，
期间旧身份的通知/决策事件仍在推。

### 设计：有确认的登出状态机（服务端吊销 + 壳清 token + 立即取消/重连现有 SSE），失败不假装完成

**S-1 WebView 登出按结果分流（不再吞错、不再即发即忘）**
- `await ctx.client.logout()`：
  - **成功** → `await invoke("set_client_token", { token: "" })`（等它 resolve）→ 清 localStorage + 落登出标记 → reload。
  - **失败** → **不清本地、不 reload**，toast「登出未完成，请重试」（可留“强制本地登出”二次确认，明确告知服务端可能仍有效）。
- 关键：先确认服务端吊销 + 壳层已清 token，**再**清本地状态；顺序反了就是“假装完成”。

**S-2 `set_client_token` 空分支也要唤醒（Rust）**
- 把 `notify_waiters()` 移到**两条分支之后统一调用**（清空/设值都唤醒），让 worker 立刻醒来按新（空）令牌重连——
  空令牌重连会 401，worker 进退避并保持“未鉴权”，不再带旧身份跑。**同时**返回 `Result` 让 WebView 能 await 到确认
  （现在是 `fn`(无返回)，S-1 要能 await 到“壳已清”）。

**S-3 令牌变更能取消**在飞**的流（Rust，核心）**
- `run_sse_subscription` 的 `pump_sse_response` 改为**可取消**：在 `pump` 外层 `tokio::select!` 同时 await
  `pump` 与 `token_changed.notified()`；令牌一变（含清空）→ **立即 drop 当前 response、跳出 pump 去重连**，
  而不是等流自然结束。这样登出后旧身份的活流被**主动切断**，不留竞态窗口。
- 变体：worker 每次重连前对比“令牌是否与本连接开连时一致”，不一致即主动断，兜底 select 漏网。

**S-4 幂等的服务端登出（可选加固）**
- 服务端 `logout` 对“令牌已吊销/已失效”返回**幂等成功**（而非错误），避免 S-1 里重试登出因为“已经吊销过”反被判失败。
  当前 `revokeByTokenHash` 已尽力而为，确认它对已吊销 token 不抛错即可（读代码：不抛，返回值可空）——大概率无需改。

### 风险评估
- **中高**：S-3 改 `run_sse_subscription` 的 pump 为可取消，是 worker 生命周期结构改动（select! 组合 + drop 流），
  要小心不 double-spawn / 不泄漏连接；必须真机验证“登出即断流、旧身份零残留事件”。
- **中**：S-2 让 `set_client_token` 返回 Result 破坏契约，三处调用点（browser/boot/settings）齐改；S-1 改登出交互流。
- **低**：S-4 多半只是确认现状。
- 全部**需真机验证**（真实 SSE 连接 + 登出时序只有 .app + 真后端能复现），Rust 不盲改。

---

## 施工切片建议（可安全自动化 vs 待人工真机）

| 切片 | 可自动化施工？ | 说明 |
|---|---|---|
| **BUG-01 tauri.conf signingIdentity + hardenedRuntime** | ✅ 已施工 | 纯声明式配置，根因铁证；构建产物本身需 macOS 真机确认 |
| **BUG-01 build+验签 smoke 脚本 + package.json 别名** | ✅ 已施工 | bash 语法 OK / typecheck 绿；**脚本实际执行待 macOS 真机**（本环境无 cargo tauri build） |
| **BUG-03 D-4 收敛 resolveDesktopApiBase/resolveWorkbenchApiBase 共享 helper** | ⚠️ 半自动 | 纯 TS 重构可施工 + 单测，但语义改“壳优先”依赖 D-1 command，建议同批 |
| **BUG-03 D-1/D-2/D-3（Rust command + 令牌归属 + 原子切换 + worker 重算地址）** | ❌ 待人工真机 | Rust 壳逻辑 + Tauri invoke 契约，无真机不盲改 |
| **BUG-06 S-1 WebView 登出按结果分流** | ⚠️ 半自动 | 纯 TS + 可加单测，但要 await S-2 的 Result，建议与 S-2 同批上真机 |
| **BUG-06 S-2 set_client_token 统一 notify + 返回 Result** | ❌ 待人工真机 | Rust + 契约变更 |
| **BUG-06 S-3 pump 可取消（登出即断流）** | ❌ 待人工真机 | worker 生命周期结构改动，核心，必须真机验时序 |

**总原则**：BUG-01 已落地（配置+门禁脚本，唯一待办是 macOS 上跑一次 `pnpm build:desktop-macos` 确认门禁绿+能起窗）。
BUG-03/06 的 Rust 壳改动全部标**待人工真机**——设计已给出具体改点、契约变化、风险等级，交由能起 `.app` 的执行者按切片落地并真机验时序。
