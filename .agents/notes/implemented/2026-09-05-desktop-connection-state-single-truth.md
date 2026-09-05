# 桌面端连接状态单一真相 + 工作台自己的登录广播

- Status: implemented
- Date: 2026-09-05
- Owner: R25 Q（桌面连接状态一致性）

## Problem

`r24-S5-reverify.md` 项 9（真机复验，后端 kill 之后逐窗观察）记录三窗对同一件事各说各话：

- 工作台左下角固定写「WorkHub Desktop · 已连接」——`workbench/rail.ts` 的 `viewerLabel` 只要
  `state.vm` 加载成功过就硬编码这四个字，从不追问"现在还连得上吗"；
- 主窗聚焦盒零提示——后端死了之后主窗照常显示"Inbox is empty"，没有任何一处判断连接状态；
- 桌宠说"离线"，但这个判断来自 `desktop-cuu-runtime.ts` 里 `sse-status`（Rust SSE worker 的
  per-subscription、协议粒度原始信号：Connecting/Open/Retrying/Closed）翻出来的一张
  `state: "offline"` 的 CuuCard。这张卡片是本轮真正的第二个缺陷（L-06，`r24-S5-reverify.md`/
  `r24-S3-walkthrough.md` 都记录过）：非 idle 态卡片一律被 `packages/cuu/src/motion.ts` 的
  `windowModeForState` 判成 `"card"` 模式，把桌宠窗从 260×340 撑到 520×720、原生窗口跟着挪位置，
  盖住屏幕中部内容——一个"服务器暂时连不上"的被动状态提示，代价是抢窗口、抢位置。

三处判断各写一遍、各自靠不同信号猜，逻辑早就漂移；且没有一个"单一事实源"能在窗口 boot 那一刻
就给出当前状态——只能等下一条相关事件路过才第一次知道。

另有一处不对称：登录成功后跨窗广播 `workhub-logged-in`（`.agents/notes/implemented/
2026-09-05-desktop-connect-screen-and-csp.md` 的追补段）此前只有主窗的凭据门/重绑屏会发起；
工作台窗口如果开着密码/hybrid 模式自己的凭据门（`workbench/boot.ts` 的 `bindDesktopCredentialGate`
分支）并在那里登录成功，此前只 `window.location.reload()` 自己，主窗/桌宠收不到信号。

## Decision

**新增壳层广播的"连接状态单一真相"**：Rust SSE worker（`client-tauri/src-tauri/src/sse_worker.rs`）
在每次状态迁移时把内部 `ShellSseConnectionState`（Connecting/Open/Retrying/Closed）机械收敛成对外
三态 `ShellConnectionState`（connected/reconnecting/offline，`sse.rs`），通过新事件
`workhub-connection-changed`（`events.rs` 的 `ShellEvent::ConnectionChanged`）广播，payload
`{ state, server_url, since_ms, attempt }`。新命令 `get_connection_state` 读同一份运行时状态
（`ShellConnectionStatus`，`sse_worker.rs`）供窗口 boot 时拉初值，不必等第一次真实迁移。

状态机的两个关键判定都是纯函数，落在 `sse.rs`：

- `shell_connection_state_for(sse_state, consecutive_failures)`：`Open` → `Connected`；`Closed` →
  `Offline`（协议层面尚未真正用到这个分支，纯粹为了 match 穷尽——一旦未来用上，行为已经是对的）；
  `Connecting`/`Retrying` 在 `consecutive_failures` 越过 `CONNECTION_OFFLINE_AFTER_ATTEMPTS`（=3）
  前是 `Reconnecting`，之后是 `Offline`。5s 基准退避下 3 次失败约合 35s，给瞬时抖动/短暂重启留出
  不喊"离线"的宽限，又不会让真正断线的用户等太久。
- `next_shell_connection_payload(previous, sse_state, consecutive_failures, server_url, now_ms)`：
  三态摘要、`attempt` 或 `server_url` 任一变了才 `Some`（一次真正的迁移），否则 `None`（不重复广播）。
  `since_ms` 只在三态摘要本身变化时前进；`attempt` 在 `offline` 之后定格在跨过阈值那一刻的值（离线
  文案不展示计次，没必要为不会显示的数字继续广播）。

**挂起等 client token 期间不写**（`SseConnectAction::Suspend`，即这台设备还没登录）：那是"还没登录"，
不是"连不上"，三窗的连接横幅/卡片只在登录后的常规 chrome 里渲，不需要用这个槽位区分两种"暂时没有
判定"的原因。

**三窗改从这一个事件取状态**，删各自的猜测逻辑，boot 时都先调 `get_connection_state` 补初值再订阅：

- **工作台**（`workbench/store.ts` 新增 `connectionState` 字段，`workbench/boot.ts` 拉取 + 订阅
  `bindWorkbenchConnectionChangedListener`）：`workbench/rail.ts` 的 `viewerLabel` 从硬编码"已连接"
  改成读 `state.connectionState?.state` 渲"已连接/重连中/离线"（`undefined` 时仍兜底"已连接"——
  vm 能加载成功本身就是连通性证据，好过在应用刚起的极短空窗期显示一个更消极的猜测）。
- **主窗**（聚焦盒）：新增顶部细条 `.wh-spot-connection-banner`，与既有"AI 服务未配置"横幅
  （`.wh-spot-ai-banner`）同样式（同一套 warn 语义色/内边距/边框），只在盒子展开态显示。文案来自
  新文件 `connection-banner-copy.ts` 的 `desktopConnectionBannerText`（connected 不渲，reconnecting/
  offline 各一句）。`SpotlightHandle` 新增 `setConnectionState` 方法，`browser.ts` 的 `bootSpotlight`
  拉取 + 订阅后调用它。
- **桌宠**：**不**复用 CuuCard 管线（那正是 L-06 的根因）。新增纯函数
  `desktopPetConnectionStatusText(payload, locale)`（`pet-surface.ts`），产出一行文本
  「连不上服务器 `<地址>` · 重连中（第 N 次）/已离线」，走 `renderDesktopPetSurface` 既有的
  "无卡片、只有 `status_text`"紧凑气泡路径（`compactStatusOnly`）——这条路径此前就已经把窗口尺寸
  钉死在 body_only（260×340），有既有测试锁着，本批不改这部分渲染逻辑，只改"喂给它什么文本"。
  `connectionStatus` 是独立于 `statusText` 的变量（后者是右键菜单会清空的瞬态动作反馈，两者不能
  共用同一个槽位，否则打开设置菜单会意外清掉"服务器连不上"的提示）；`render()` 里的合并规则是
  `statusText` 优先，否则在没有真实卡片占用气泡时才退回连接提示。

**撤下 sse-status 驱动的离线卡**：`desktop-cuu-runtime.ts` 的 `bindDesktopShellCuuRuntime` 此前在
`sse-status` 的 handler 里调 `bridge.handleSseStatusPayload`（配 `retryingDelayMs` 防抖 +
`dismissCardIfPresent` 复原）把原始信号翻成 CuuCard。这条产卡路径整个删掉；`sse-status` 订阅本身
保留，只保留 INF-08 的"断线重连成功→全量重拉对账"计数逻辑（`onSseReconnected`），这与显示无关。
`shell-events.ts` 里 `desktopCuuCardFromShellSseStatus`/`parseDesktopShellSseStatusPayload` 等纯函数
与各自既有单测原样保留——不再被生产代码调用，但仍是独立正确、有自己覆盖率的工具函数，是否彻底删除
留给后续单独判断（未在本批清理）。

**工作台自己的登录成功也广播**：`workhub-logged-in` 的 payload 补了 `{ source: "main" | "workbench" }`
（`desktop-cuu-runtime.ts` 的 `DesktopShellEventName` 顶注）。`workbench/boot.ts` 新增
`reloadAfterWorkbenchLogin`，复用 `desktop-login.ts` 的 `completeDesktopLoginSuccess`（同
`runDesktopLogout`/`applyDesktopServerChoice` 一样的"effects 注入 + 顺序即安全属性"取舍），广播时带
`source:"workbench"`，接给 `bindDesktopCredentialGate` 的 `onSuccess`。**防自循环**：广播窗口自己已经
在走 `completeDesktopLoginSuccess` 的直接 `reload()`，若同时又订阅了自己发起的这条广播会打一次空转
的双重刷新——`bindWorkbenchLoggedInListener` 签名改为把 `source` 透传给回调，工作台侧
`source !== "workbench"` 才 reload；主窗（`browser.ts`）此前从不自我订阅这个事件（自己就是唯一的
广播源），现在广播源不止一个，补上订阅，`source !== "main"` 才 reload，`reloadAfterDesktopLogin`
广播时也带上 `source:"main"`。桌宠从不广播这个事件，既有的无条件 reload 订阅不需要看 `source`。

## Alternatives considered

- **桌宠离线提示继续走 CuuCard 管线，只是把 `windowModeForState` 里"offline"态整体特批成
  body_only。** 拒绝：`CuuState "offline"` 同时被 `createDesktopPetLoggedOutCard`（登出/首启引导，
  260×340 之外还想展示完整说明文案）复用，两者共享同一个 state 值但产品意图不同（一个想要小、一个
  想要大）；`compactCard`（决定是否精简正文/chips/actions）与 `windowMode`（决定窗口像素尺寸）是两个
  独立派生量，只改 `windowModeForState` 而不联动 `compactCard` 会让"小窗口、却渲满版正文"这种破损
  布局悄悄出现在登出/首启卡上——一个没被要求改动的既有功能会被连带破坏。选择完全绕开 CuuCard 管线，
  用已有且已测试过的"无卡片状态文本"路径，风险面最小。
- **连接横幅在 reconnecting/offline 上用不同色阶（比如 offline 用 danger 红）。** 拒绝：任务原话要求
  主窗横幅"与 AI 未配置横幅同样式"，且 S5 复验记录的既有行为就是单一 warn 色阶的琥珀条——不引入未被
  要求的视觉分级。
- **`attempt` 达到 `CONNECTION_OFFLINE_AFTER_ATTEMPTS` 后继续随 `consecutive_failures` 累加进
  payload。** 拒绝：`offline` 文案本就不展示计次，继续累加只会让"什么都没变"的 tick 被
  `next_shell_connection_payload` 误判成迁移、反复广播/反复触发三窗重渲，纯属浪费；改为在
  `offline` 期间把 `attempt` 定格在跨过阈值那一刻的值。
- **`bindDesktopShellCuuRuntime` 里连 `desktopCuuCardFromShellSseStatus`/相关 i18n key
  （`packages/cuu` 的 `offline.*`）一并删除。** 缓办：这些是独立正确、仍有自己单测覆盖的纯函数，
  删除牵涉 `shell-events.test.ts`/`desktop-cuu-runtime.test.ts` 多处断言且不影响本批的功能目标（三窗
  已经不再调用它们），留给后续单独的死代码清理批次判断是否连测试一起清空。

## Consequences

- 三窗现在共用同一份 Rust 端权威判定，不会再出现"工作台说已连接、桌宠说离线"的场景；但三窗的
  boot-time 拉取 (`get_connection_state`) 都是 best-effort（`readDesktopConnectionState` 失败/无
  `__TAURI__` 时静默保持"未知"），浏览器开发态预览永远不会显示连接横幅——这是既有取舍的延续，不是
  新引入的降级。
- `ShellConnectionStatus` 目前只由启动时唯一订阅的 `/api/push/stream/me` 驱动（`startup_shell_sse_targets`
  只返回一个目标）——三态摘要等价于"这条唯一 SSE 连接的状态"。如果未来 Rust 侧新增第二条并行 SSE
  订阅（当前代码里 `spawn_shell_sse_workers` 的通用能力存在但未被使用），`emit_connection_transition`
  需要重新设计成"多路聚合"而不是简单地让每条订阅各自写同一个槽位——现在的实现没有为这种情况做防御。
- `retryingDelayMs`（`bindDesktopShellCuuRuntime` 的选项）与只为它存在的
  `desktopPetRuntimeRetryingDelayMs` 常量一并删除；`handleDesktopPetRuntimeNotice`/
  `handleDesktopPetRuntimeDecision`（id 前缀判定 `sse-status:` 是否 transient）保留——通用、无害，
  即使现在没有任何卡片会带这个 id 前缀。
- 新增的 `.wh-spot-connection-banner` 与既有 `.wh-spot-ai-banner` 是两个独立元素/类名（不共享），
  因为两条事实相互独立（连不上服务器 vs 没配置 AI 密钥），有可能同时出现。
- 真机未验：本批全程只跑了 `cargo test`/`cargo clippy`（Rust）与 `node --test`/`tsc`（TS），
  没有用 `pnpm build:desktop-macos` 打包成 `.app` 用真实断网/killed-backend 场景验证过三窗视觉
  （颜色、文案换行、聚焦盒横幅在真实玻璃材质上的观感、桌宠气泡在 body_only 尺寸下能否放得下这行
  更长的文本）。下一次真机复验（继 `r24-S5-reverify.md`）应覆盖：kill 后端观察三窗是否真的同步显示
  reconnecting→offline、桌宠气泡文本换行/溢出、登录时工作台/主窗互相 reload 不闪烁。
