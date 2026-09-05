# 壳层服务器地址交给运行时：set_server_url / get_server_url + SSE 端点代际

- Status: implemented
- Date: 2026-09-05
- Owner: claude-code（R24 S5 的 Rust 侧；侦察报告 `r24-S1-entry-connection.md` §2、§5、§7.3、§7.4 与 P1 的 E-06）

## Problem

**壳层自持第二份服务器地址，而且没有任何界面能改它。**

桌面端有两份「服务器在哪」的真相：

- webview 侧 = localStorage `workhub_api_base`（`apps/desktop-webview/src/desktop-api-base.ts:11`），
  离线卡里可以改。
- 壳层侧 = `WorkHubShellConfig.server_url`，只能来自 OS 配置目录里的 `workhub-shell-config.json`
  或环境变量 `WORKHUB_SERVER_URL`（`config.rs:5,92-94`），而且在 `.setup()` 里**按值捕获一次**就烘死了
  （`main.rs` 原 :1978 `spawn_default_shell_sse_workers(handle, shell_config)`）。全仓命令清单里
  没有任何 `set_server_url`。

两份地址可以永久分叉。这不是「少一点功能」：托盘/Dock 角标、系统通知、Cuu 上线状态**全部**只由壳层那条
SSE 供给（`sse_worker.rs`）。用户在离线卡里把地址改成自托管服务器、webview 连上了，壳层仍死打
`127.0.0.1:8787` —— 角标恒 0、系统通知恒不响、桌宠恒「重连中」，而且没有任何一处告诉他为什么。

第二层问题：壳层这份地址过去只做 `normalize_server_url`（trim + 去尾斜杠），因为它唯一的来源是运维
手写的配置。一旦它变成**由 webview 传进来的用户输入**，这道校验就明显不够了。

## Decision

### 1. 壳层不再自持第二份地址，改为「运行时单一真相 + webview 推」

新增 Tauri 命令 `set_server_url`，它是壳层地址的**唯一写入口**；`get_server_url` 让 webview 能核对
两边连的是不是同一台。壳层仍保留 `workhub-shell-config.json` / `WORKHUB_SERVER_URL` 作为**启动来源**
（无头/运维场景要用），但运行期的真相在 `.manage()` 的 `ShellServerUrl` 里。

`set_server_url` 的顺序是刻意的：**校验 → 落盘 → 清令牌 + 改运行时 → 广播**。

- **先落盘再改运行时**：写盘失败则整条命令失败、什么都不变。反过来会留下「这次连新服务器、重启又回
  旧的」——一种只有下次启动才暴露的分裂态。
- **落盘按 key 打补丁**（`shell_config_json_with_server_url`），不把文件反序列化成
  `WorkHubShellConfigFile` 再整份写回：这份文件是运维可手改的，整份重写会把它不认识的键悄悄抹掉。
- **换服务器同时清掉壳层持有的 client token**，落盘那份 `client_token` 也一并删。换服务器等于换身份域，
  A 服务器铸的设备令牌对 B 毫无意义；留着它，下次启动 `plan_daemon_request` 会把旧令牌烘焙进新服务器的
  SSE 鉴权头——拿 A 的凭据去敲 B。webview 侧也会清一遍，双保险。
- **广播失败不上抛**。地址此刻已经落盘并生效，回 Err 会让 webview 以为切换失败、不去更新自己那份
  api base —— 那正好是本批要消灭的分叉。降级后果只是另外两窗要等各自重启才跟上（= 改动前的行为）。

校验用 `normalize_shell_server_url`，与 webview 的 `normalizeDesktopApiBase`
（`desktop-api-base.ts:18-38`）**逐条对齐**：只收 http/https 绝对地址，拒空/畸形/带凭据/带查询串或 hash，
归一为 `origin + path` 去尾斜杠。两端必须对同一个输入给出**同一个字符串**，否则口径分叉会让 E-06 以更
隐蔽的形式回来。两处对齐细节写进了注释：`Url::parse` 与 JS 的 `new URL` 都把 scheme 小写化；只有 `?`/`#`
而无内容时 JS 的 `search`/`hash` 取到空串（放行），故 Rust 侧也只拒非空的 query/fragment。

命令仍然独立校验一遍（webview 已经校验过）：命令是进程边界，不能假设调用方一定是自家那段 JS。

### 2. 重建策略：照搬既有的身份代际，加一条端点代际

`ShellServerUrl` 与既有的 `ShellClientToken` 同构：`Mutex<{ url, generation }>` + `Arc<Notify>`，
`set` 在锁内提交代际、出锁后 `notify_waiters()`。

worker 侧两件事：

- **每次(重)连前重读地址并重拼订阅 URL**（`join_daemon_url(&server.url, &subscription.path)`）。
  `subscription.url` 从此只是启动快照，仅在拿不到 state 的降级路径上兜底。
- **pump 循环按代际对 `StreamGenerations { token, server }` 比对**，任一变化即 `Superseded`、立刻中止
  当前连接重建。只把新地址放进槽里是不够的——旧服务器的 `/stream/me` 会一直灌到 TCP 偶然断，用户已经
  切走了还在收旧服务器的通知。这与 SEC P0-02 当初对「退出/换号」的判断是同一条纪律，所以复用它的形状
  而不是另发明一套。

两个 `notified()` future 都在 pump 循环**外**创建并 pin 住、醒来后才重新武装。这不是风格问题：
`Notify::notified()` 首次 poll 才登记等待者，若每轮新建，处理完一块到重新进 `select!` 之间到达的通知
就会丢，idle 流会迟迟不掉头——正是 SEC P0-02 修掉的那个毛病。挂起/退避两处的等待可以每轮新建
（`wait_for_runtime_change`），因为那里有兜底 `sleep` 保证有界。

代际是唯一真相，通知只是唤醒提示：即便通知有极小竞态窗口漏掉，下一块/下一拍的代际比对仍能兜住。

### 3. capabilities 不动

Tauri v2 的 ACL 只管**插件**命令；应用自己 `generate_handler!` 出来的命令不走权限表。既有的
`set_client_token`、`open_workbench` 等二十来条同样没有任何 capability 条目，真实 `.app` 上工作正常。
故 `capabilities/*.json` 不需要为这两条新命令加任何东西——加了反而是无谓地扩大运行时权限面
（`default.json` 的权限集还有测试逐条钉死）。scaffold 里补了一条测试把这个结论写下来。

### 4. macOS 深链核实（S1 报告 E-13）：**不需要修，现有配置已经是官方形态**

三条证据，都亲自验过：

1. **真实产物**。`client-tauri/src-tauri/target/release/bundle/macos/WorkHub.app/Contents/Info.plist`
   里确实有 `CFBundleURLTypes → [{ CFBundleURLSchemes: ["workhub", "yqgl"], CFBundleTypeRole: Editor,
   CFBundleURLName: "com.mycyg.workhub workhub" }]`。同一份 plist 里还留着手写文件那条 `LSRequiresCarbon`
   —— 说明 `bundle.macOS.infoPlist` 是**合并**进打包器生成的结果，不是替换它。
2. **插件源码**。`tauri-plugin-deep-link` 2.4.9 的 `DesktopProtocol` 字段带着 `// Used in tauri-bundler`
   注释；`tauri_utils::config::DeepLinkProtocol` 的 `name`/`role` 直说映射到 `CFBundleTypeName`/
   `CFBundleTypeRole`。desktop schemes 的 macOS 归宿就是打包器。插件自己的 `build.rs` 只处理
   `config.mobile`（写 iOS gen 工程的 plist / Android manifest），与 macOS 桌面产物无关。
3. **`register_all()` 的 Win/Linux cfg 守卫也是对的**：插件的 `register()` 在 macOS 上明确返回
   `UnsupportedPlatform`（LaunchServices 只从 app bundle 读注册信息，不接受运行时注册）。

所以**不该**往手写 `Info.plist` 里补一份 `CFBundleURLTypes`：合并时手写文件的键会盖掉打包器生成的那份，
scheme 从此得靠人肉两处同步——那才是引入缺陷。scaffold 里加了一条测试把这条结论钉死（断言
`plugins.deep-link.desktop.schemes` 还在，且手写 plist 里没有 `CFBundleURLTypes`）。

## Alternatives considered

- **只靠「换服务器顺带清令牌」来中止旧连接**，不引入端点代际。清令牌本来就会递增身份代际并 notify，
  活跃 pump 因此也会掉头，代码能少一半。被否：这让「换服务器能断开旧连接」这件事依赖于一个**副作用**。
  哪天有人决定换服务器不该清令牌（比如同一套 SSO 下的多台服务器），断连就会静默失效，而且没有任何测试
  会红。端点代际让这条不变量自己成立。
- **让 `ShellServerUrl` 复用 `ShellClientToken` 的那个 `Notify`**。少一个 `select!` 分支，但两件不同的
  事共用一个唤醒源之后，「令牌变了」和「地址变了」在诊断日志里就分不开了。被否。
- **把地址塞进 `Mutex<WorkHubShellConfig>` 整份托管**（locale 也在里面）。一次改完看着更整齐，但 locale
  已经有自己的 `Mutex<WorkHubLocale>` 和 `set_shell_locale`，合并等于顺手重构一个没坏的东西，还要
  牵动 R19-13 那批 i18n 门禁的断言。被否——本批只动地址。
- **每次重连时重新 `plan_shell_sse_worker` 生成整份订阅计划**，而不是只重拼 URL。看起来更「正统」，
  但计划里还烘焙着 config 的 client_token 头，重新生成会把已经被清掉的旧令牌又烘回来。被否。
- **`set_server_url` 里顺手 reload 三窗**（壳层直接调 `window.eval("location.reload()")`）。省掉 webview
  侧的订阅代码，但壳层替 webview 决定「什么时候重载」会踩到它自己的登录/引导状态机。被否：广播出去，
  由各窗自己决定，照既有 `workhub-logged-out` 的模式。
- **往手写 `Info.plist` 里补 `CFBundleURLTypes`**（S1 报告 E-13 的字面建议）。核实后被否，理由见上。
- **错误文案做成中英双语**（照 tray/notify/deep-link 那套 `*_for_locale`）。被否：这几条是命令的诊断串，
  用户可见的连接失败文案由 webview 的连接屏负责（它本来就要把 `normalizeDesktopApiBase` 的拒绝理由说清楚）；
  壳层这边与既有的 `"main window is not available"` 等命令错误保持同一形态。

## Consequences

- **壳层地址的写入口只有 `set_server_url` 这一个。** 任何新的「改服务器」路径都必须走它，不要再去直接改
  `workhub-shell-config.json` 或另起一份运行时地址——那正是本批消灭的东西。
- **`WORKHUB_SERVER_URL` 仍然在启动时压过配置文件**（`load_shell_config_from_json_and_env` 的既定优先级，
  未改）。设了它的机器上，运行期切换生效、下次启动会被顶回去。命令里留了一行诊断日志说明这件事，没有
  去偷偷改运维自己设的优先级。
- **换服务器会清掉壳层的设备令牌**，所以切换之后 SSE 必然先落到「挂起等令牌」状态，直到 webview 在新
  服务器上重新 bootstrap 并 `set_client_token`。这是设计意图（不拿 A 的凭据敲 B），不是回归。
- **webview 侧契约**（另一条线实现）：`invoke("set_server_url", { url })` → `{ url }`（归一化后）
  或 `Err(string)`；`invoke("get_server_url")` → `{ url: string | null }`；事件
  `workhub-server-changed` 载荷 `{ url }`。改这三样任何一处都要两侧同步。
- **本批只解决「壳层跟不跟得上」。** 打包后 CSP `connect-src` 只放行回环那条 P0（S1 报告 E-01）不在本批
  范围内——它没修之前，webview 仍然连不出去非回环地址，壳层的 SSE 却已经可以了。两边都修完，自托管
  服务器才真正可用。
