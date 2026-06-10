---
module: 05-clients
layer: C-PET / Tauri / Rust shell
status: current-plan
owner: workflow
date: 2026-06-10
visuals:
  - ./assets/desktop/desktop-rust-shell-gap-roadmap.png
  - ./assets/desktop/desktop-one-thing-work-desk.png
  - ./assets/cuu/cuu-desktop-approval-search.png
  - ./assets/cuu/cuu-option-first-clarify.png
---

# 桌面宠物客户端 C-PET（Tauri v2 + Rust）

> 当前权威口径：C-PET 是 WorkHub 的桌面瘦客户端。Rust shell 负责本地窗口、托盘、通知、deep-link、设备令牌、本地同步和系统能力；业务状态机、权限、AI 运行、页面 VM 仍由 TS-first daemon / contracts / webview 承担。Cuu 只在独立 `pet` window 出现，模型只允许黑猫/白猫 Live2D 二选项。
>
> **2026-06-08 纠偏**：R1 真实纵切通过前，C-PET 不再新增 Cuu 外观/动效/设置矩阵施工。Rust shell 的优先级转为支撑 R1/R2：设备令牌、真实 SSE、通知 deep-link、PG/Redis 后端联动与跨平台 smoke。Cuu 仅保留现有黑/白 Live2D 运行时和 R0 治理修正。

## 1. 产品边界

| 层 | 拥有什么 | 不拥有什么 |
|---|---|---|
| Rust shell | 窗口、托盘、通知、deep-link、SSE worker、设备 token、文件/同步本地能力 | WorkItem 状态机、审批策略、Cuu 动作语义、业务 DTO |
| Desktop webview | 严肃主窗页面、API client、locale、页面渲染、pet surface TS adapter | 系统权限、真实窗口几何、长期本地后台任务 |
| Cuu pet window | Live2D 桌宠、气泡、轻卡、点击/拖拽/hover 输入 | 完整看板、完整审批中心、项目管理主界面 |
| Web app | 派活、管理、审批、看板、成本、trace | 接活类高权限本地能力 |

## 2. 现有落点

| 文件 | 当前职责 |
|---|---|
| `client-tauri/src-tauri/src/main.rs` | Tauri runtime entry，创建 `main` / `pet`，pet 显式加载 `/pet.html`，注入 `window.__WORKHUB_SURFACE__` 与 QA 场景/语言，注册 commands / plugins / SSE worker |
| `client-tauri/src-tauri/src/pet_window.rs` | `pet` 几何、右下角定位、body/card 尺寸、work area 夹取、scale/opacity/pass-through/hide-on-hover |
| `client-tauri/src-tauri/src/pet_commands.rs` | `set_pet_window_mode`、`set_pet_window_settings`、`start_pet_window_drag`、`save_pet_window_position`、`sample_pet_cursor_near` |
| `client-tauri/src-tauri/src/tray.rs` | 托盘菜单合同：打开主窗、隐藏主窗、显示/隐藏 Cuu、恢复 Cuu 交互、打开收件箱、打开设置、退出 |
| `client-tauri/src-tauri/src/notify.rs` | high/urgent 系统通知计划和去重 |
| `client-tauri/src-tauri/src/deep_link.rs` | `workhub://` / legacy scheme 安全路由 |
| `client-tauri/src-tauri/src/sse_worker.rs` | 后台 SSE 连接、重连、事件广播 |
| `apps/desktop-webview/src/browser.ts` | 根据 Rust 注入 surface 分流主窗或 pet surface |
| `apps/desktop-webview/src/pet-surface.ts` | 独立 Cuu pet surface，只渲染 Live2D cat + 轻气泡；R3.13.3 已补 session/run card 的 webview boot 恢复 |
| `apps/desktop-webview/src/desktop-cuu-runtime.ts` | Cuu 卡片 action runtime；R3.1 已新增 `cuu-agent-launcher` 与 `cuu-start-agent` 三段真实 API 组合；R3.2 已补启动 helper、run stream 订阅和错误卡；R3.12 已补 WebView fetch SSE + active-run fallback refresh；R3.14 已补 launcher chip metadata -> WorkItem spec |
| `apps/desktop-webview/src/pet-window-bridge.ts` | TS 调用 Rust window commands，整合 pointer/drag/cursor sample |
| `apps/desktop-webview/src/cuu-cat-live2d-runtime.ts` | 黑猫/白猫 Live2D iframe/runtime 适配 |
| `packages/cuu/src/model-pack.ts` | 当前只注册黑猫/白猫模型包 |
| `docs/workhub/05-clients/assets/cuu/*.png` | 当前 Cuu 概念图，已同步为黑猫/白猫 Live2D 版 |
| `docs/workhub/05-clients/assets/audit/2026-06-08-cuu-live2d-model-preview/` | Hijiki / Tororo 浏览器模型源帧，供概念图和后续 Tauri capture 对照 |

## 3. 窗口规划

### 3.1 Main Window

| 属性 | 规划 |
|---|---|
| 用途 | 严肃工作主窗：工作台、需求、审批、成本、trace、设置 |
| 是否展示 Cuu | 否 |
| 路由来源 | `apps/desktop-webview` 与 Web app 同源 Page VM |
| deep-link | `workhub://workitem/:id`、`workhub://proposal/:id`、`workhub://inbox`、`workhub://settings` |
| 权限 | 可以展示本地设备状态，但高权限执行仍走服务端设备令牌校验 |

### 3.2 Pet Window

| 属性 | 规划 |
|---|---|
| label | `pet` |
| 入口路由 | `/pet.html`，与主窗 `/` 分离，避免 QA 和生产启动时误载主窗 bundle |
| 形态 | transparent、decorations false、always-on-top、skip-taskbar |
| 默认位置 | 当前屏幕 work area 右下角 |
| body-only 尺寸 | `260x340` logical px，作为透明全身舞台，不是白色卡片 |
| card 尺寸 | `520x640` logical px，从 body anchor 向左上展开轻气泡 |
| 内容 | Cuu Live2D + 一张轻气泡；card mode 时展开操作卡，full bubble 必须在透明窗口安全区内围绕 Cuu，当前 CSS gate 为 `left:88px; bottom:348px; width:300px; max-width:calc(100% - 128px)`，避免高 DPI/PrintWindow 右缘裁切 |
| 模型 | 黑猫默认，白猫可选 |
| hover | 鼠标靠近不移动窗口和全身锚点，只更新指针状态、表情/动作和视觉强调 |
| R3 launcher | 点击 Cuu body 且当前无业务卡片时，webview 展开 option-first Agent 启动卡；启动后 TS 订阅 run stream 并刷新 Cuu card；Rust 只负责窗口模式，不解析业务 intent |
| 不允许 | 白框/卡片底、主窗 UI、完整看板、旧实验 renderer、静态图片 fallback |

### 3.3 Tray

| 菜单 | 行为 |
|---|---|
| 打开 WorkHub | show/focus main window |
| 隐藏主窗 | hide main window |
| 显示/隐藏 Cuu | toggle pet window |
| 恢复 Cuu 交互 | 关闭 pass-through / hide-on-hover，恢复 opacity=100，并 show pet window |
| 收件箱 | deep-link `/inbox` |
| 设置 | deep-link `/settings`，也是 Cuu 设置恢复入口 |
| 退出 | graceful shutdown |

## 4. Rust IPC 契约

### 4.1 `set_pet_window_mode`

输入：

| 字段 | 类型 | 说明 |
|---|---|---|
| `mode` | `body_only | card` | body-only 只显示 Cuu；card 展开轻卡 |
| `reason` | string | `first_paint`、`card_open`、`card_close`、`reposition` |
| `anchor` | optional | 右下角锚点；无值时使用最近保存位置 |

输出：

| 字段 | 类型 | 说明 |
|---|---|---|
| `applied` | boolean | Rust 是否完成窗口调整 |
| `rect` | object | logical x/y/width/height |
| `scale_percent` | number | 当前缩放 |
| `opacity_percent` | number | 当前透明度 |
| `clamped` | boolean | 是否发生屏幕内夹取 |

### 4.2 `set_pet_window_settings`

输入：

| 字段 | 允许值 |
|---|---|
| `scale_percent` | `75 | 100 | 125 | 150` |
| `opacity_percent` | `60 | 80 | 100` |
| `pass_through` | boolean |
| `hide_on_hover` | boolean |

规则：

- `pass_through=true` 必须仍可通过托盘恢复。
- `hide_on_hover=true` 先走 soft hide，full hide 需要额外恢复策略验证。
- scale 后 body/card 仍以右下角为锚点，不漂移到屏外。
- 默认 hover 不触发 hide，不移动整只 Cuu；只有显式 `hide_on_hover=true` 才允许透明度和小幅 soft hide。

### 4.3 `sample_pet_cursor_near`

输出：

| 字段 | 说明 |
|---|---|
| `cursor_near` | 鼠标是否在 near radius 内 |
| `hovering_window` | 鼠标是否在 pet window 内 |
| `look_x_percent` / `look_y_percent` | `-100..100`，供 Live2D 视线/头部映射 |
| `near_radius` | 当前阈值 |

### 4.4 Drag

`start_pet_window_drag` 由 pet surface 的拖拽热区触发。释放后 `save_pet_window_position` 保存 body anchor。后续启动时恢复并做 work area 夹取。

## 5. Cuu Live2D 运行合同

模型白名单见 [`cuu-live2d-cat-options-current-plan.md`](./cuu-live2d-cat-options-current-plan.md)。

当前 Cuu 概念图已经同步到黑猫 Hijiki / 白猫 Tororo Live2D 模型；Rust/Tauri 验收不能再参照旧橘猫、手绘猫或临时改色稿。概念源帧只证明模型外观和浏览器模型页可用，Tauri `pet` window 仍必须单独验证透明窗口、右下角定位、完整显示、拖拽、pass-through、hide-on-hover 和 card mode。

`reference/VPet-main.zip`、`reference/像素猫meme.zip`、`reference/像素猫meme_扩充版.zip` 的审查结论已经记录在 [`desktop-pet-reference-package-audit-2026-06-08.md`](./desktop-pet-reference-package-audit-2026-06-08.md)。落地边界：

| 参考点 | Rust shell 落点 | TS/Cuu 落点 |
|---|---|---|
| VPet 透明窗口与点击穿透 | `pet_window.rs` / `pet_commands.rs` 管理 transparent、topmost、skip-taskbar、pass-through、restore interaction | `pet-surface.ts` 只同步偏好和状态，不直接猜测系统窗口能力 |
| VPet Start/Loop/End 动作 | Rust 不拥有业务动作，只保证窗口稳定和 capture | `packages/cuu/src/motion.ts` 规划 `enter` / `loop` / `exit` motion slot |
| VPet touch area / drag | Rust 提供 `start_pet_window_drag`、位置保存和 work area clamp | Live2D canvas 保持 hover/tap/drag 热区，hover 默认只 look-only |
| 像素猫 random_act | Rust 不参与随机动作决策 | `CuuBehaviorManifest.idle_random` 控制概率、冷却和可打断规则 |
| 像素猫 action sound | Rust 不默认播放声音 | P2 以后通过用户偏好开启，默认静音 |

禁止事项：

- 不复制 VPet 或像素猫图像、音效到 WorkHub 默认资产。
- 不把 VPet WPF 代码移植进 Tauri shell。
- 不让 Rust shell 拥有 AI 业务状态机；Rust 只负责窗口、托盘、通知、deep-link 和本地能力。
- 不再用 GIF/静态 PNG 作为默认 Cuu；Live2D 黑猫/白猫仍是唯一默认路线。

| 业务状态 | Cuu 动作语义 | 当前 Live2D 映射 |
|---|---|---|
| idle | 待机、眨眼、尾巴 | idle motion |
| thinking | 思考 | thinking/waiting motion |
| asking approval | 提醒、靠近、弹气泡 | alert motion + card |
| searching evidence | 检索 | look/search motion |
| syncing files | 同步 | busy motion |
| worried | 担心 | low-energy motion |
| celebrating | 完成 | celebration motion |
| offline | 睡觉/重连 | sleep/worry motion |

验收要求：

- 每个模型都要有真实多帧截图，不接受单帧 smoke。
- 捕获必须证明动作不是整体缩放。
- 首帧必须非空、全身可见、不是只露耳朵。
- 鼠标靠近必须通过 `look-only` capture：不点击、不拖拽、窗口 rect 全程一致。
- Pet surface 运行态只能 patch CSS variables / `data-*`，不能因 pointer tick 重建 Live2D iframe。
- card mode 不得裁切 Cuu 或气泡操作。

## 6. 主窗页面规划

主窗遵循 Web 端页面 VM，不额外发明桌面专属业务模型。

| 路由 | 页面 | 桌面差异 |
|---|---|---|
| `/` | 工作台 | 显示设备连接状态、SSE 状态、最近本地同步 |
| `/intake/:id` | 需求澄清 | option-first，同 Web；可由 Cuu 气泡 deep-link 打开 |
| `/approvals` | 审批中心 | 可由系统通知和 Cuu 气泡进入 |
| `/proposals/:id` | 交付物变更说明 | GitHub-like 说明，但适配多类型交付物 |
| `/workitems/:id` | 工作项详情 | 显示本地同步/文件证据入口 |
| `/agent-runs/:id/replay` | Replay | 调试/审计页面，桌面可带本地 trace 打开；R1.13 起同源展示 merge decision timeline |
| `/dashboard/cost` | 成本 | 与 P-COST Page VM 对齐 |
| `/settings` | 设置 | 语言、设备、AI runtime、桌面 shell；不展示 Cuu 形象 |

## 7. 本地能力路线

### 7.1 P1：可用桌宠

- 黑猫/白猫 Live2D 二选项可切换。
- Tauri pet window 首帧稳定、全身可见。
- hover/tap/drag 录屏通过。
- 托盘可恢复 pass-through 或隐藏状态。

### 7.2 P2：本地通知与 deep-link

- high/urgent SSE 事件弹系统通知。
- 点击通知打开安全站内路由。
- Cuu 气泡和系统通知不重复骚扰。
- 离线重连只给人话提示，不刷屏。

### 7.3 P3：本地同步与文件能力

- 设备令牌门接入。
- 网盘/项目文件可本地缓存。
- spec watch 把 README/规格变化同步给 daemon。
- 本地文件操作必须有权限策略与审计。

### 7.4 R3：Cuu Agent 出站入口

R3.1-R3.13.2 已落 TS webview 层、route-stack、boot click harness、第一份真实 Tauri launcher 证据、真实本机 HTTP dev-server launcher-to-run smoke、真实 Tauri run-stream completion capture、真实 Tauri run-failure terminal capture，以及真实 Tauri 401/403/offline error-state capture，详见 [`cuu-r3-agent-entry.md`](./cuu-r3-agent-entry.md)：

- `pet-surface.ts` 在用户点击 Cuu body 且当前无 card 时展示 launcher card。
- launcher 仅给可点选交付方向，不显示输入框。
- `desktop-cuu-runtime.ts` 把 `/api/cuu/start-agent` pseudo action 转成真实 `createSession -> createWorkItem -> startAgentRun`。
- 返回 `AgentRunLiveVM` 后用 `cardFromAgentRunLive()` 显示进度卡。
- R3.2 新增 `startDesktopCuuAgentFromLauncher()`、`subscribeDesktopCuuAgentRunStream()` 与 `cardFromDesktopCuuRuntimeError()`。
- pet surface 在启动成功后订阅 `AgentRunLiveVM.stream_href`，匹配 run 事件后重新拉 `GET /api/agent-runs/:id` 并刷新 Cuu 卡；终态会关闭订阅。
- budget exhausted、403/401、offline/network 和 generic error 已能映射为 Cuu 轻卡。
- R3.10 已证明真实 Tauri `pet` window 从 body-only 黑猫点击展开英文 launcher card：`docs/workhub/05-clients/assets/audit/2026-06-10-cuu-r3-10-sidecar/hijiki/launcher-en-US/`，包含 contact sheet、GIF/MP4、DOM report 与 motion diff report。
- R3.11 已证明 desktop Cuu runtime 通过 `createApiClient({ baseUrl:"http://127.0.0.1:<port>", getClientToken })` 访问真实 Hono HTTP server 后，仍能完成 launcher -> clarification -> confirmation -> WorkItem -> AgentRun。
- R3.12 已证明真实 Tauri `pet` window 可从 launcher 走到 run-stream completion：zh-CN 证据在 `docs/workhub/05-clients/assets/audit/2026-06-10-cuu-r3-run-stream/hijiki/run-stream-zh-pass/`，en-US 证据在 `docs/workhub/05-clients/assets/audit/2026-06-10-cuu-r3-run-stream/hijiki/run-stream-en-pass2/`。
- R3.13.1 已证明真实 Tauri `pet` window 可从 launcher 走到 failed AgentRun 的 `worried` trace card：zh-CN 证据在 `docs/workhub/05-clients/assets/audit/2026-06-10-cuu-r3-run-failure/hijiki/run-failure-zh-pass/`，en-US 证据在 `docs/workhub/05-clients/assets/audit/2026-06-10-cuu-r3-run-failure/hijiki/run-failure-en-pass/`；同轮修复了 run-failure trace card 的文本超框问题，最终帧确认 `Budget/预算` 与英文长 failure 文案均在卡片边界内。
- R3.13.2 已证明真实 Tauri `pet` window 可从 launcher 走到 permission/offline 错误态：401/403 的 zh-CN/en-US 证据与 stream-offline 的 zh-CN/en-US 证据均在 `docs/workhub/05-clients/assets/audit/2026-06-10-cuu-r3-error-states/hijiki/`；同轮补上 `right_edge_clip_gate`，六个 capture 的最终帧右边缘亮色像素均为 0。
- R3.13.3 已补 `pet` webview boot 恢复：当前 session question 保存 card snapshot，当前 AgentRun 保存 run id 并在刷新后通过 typed API `GET /api/agent-runs/:id` 重建 active/terminal card；active run 会重新订阅 stream，QA scenario 会跳过本地恢复以免污染截图脚本。
- R3.14 已补 launcher chip metadata 产品化：`delivery_kind` / `risk_hint` / `default_acceptance` 从 Cuu chip 进入 `CreateWorkItemRequest.cuu_launcher_spec`，再写入 WorkItem `planning_note` JSON 与默认 acceptance items；同轮补主窗 notice 与 pet bubble 长文本/按钮/chip 不超框样式门。

Rust 边界保持不变：Rust 不调用业务 API、不绕过 auth、不拥有 Agent 状态机。下一步 Rust/Tauri 需要继续补真实 reload capture、右键菜单/设置矩阵、pass-through 恢复与跨平台 capture。

### 7.5 P4：跨平台客户端

- Windows：透明 WebView2 截图、托盘、通知、安装包 smoke。
- macOS：transparent window、menu bar、notification、签名/公证。
- Linux：transparent window、tray/indicator 兼容、Wayland/X11 capture 策略。

## 8. QA 与验收

每轮 C-PET 模块完成后必须执行：

| 检查 | 命令 / 证据 |
|---|---|
| Cuu package tests | `pnpm --filter @workhub/cuu test` |
| desktop webview tests | `pnpm --filter @workhub/desktop-webview test` |
| Rust unit tests | `cargo test` in `client-tauri/src-tauri` |
| Tauri smoke | `scripts/qa/cuu-tauri-smoke.ps1` |
| Motion capture | `scripts/qa/cuu-tauri-motion-capture.ps1` |
| R3 launcher capture | `scripts/qa/cuu-tauri-motion-capture.ps1 -Scenario launcher -Locale en-US -FrameCount 32`，证据见 `assets/audit/2026-06-10-cuu-r3-10-sidecar/hijiki/launcher-en-US/` |
| R3 dev-server smoke | `corepack pnpm --filter @workhub/api qa:cuu-r3-dev-server-smoke`，验证真实本机 HTTP server + desktop Cuu runtime launcher-to-run |
| R3 run-stream smoke | `corepack pnpm --filter @workhub/api qa:cuu-r3-run-stream-smoke`，验证真实 HTTP + SSE/fallback run completion |
| R3 run-stream capture | `scripts/qa/cuu-tauri-motion-capture.ps1 -Scenario run-stream -Locale zh-CN/en-US -FrameCount 72`，证据见 `assets/audit/2026-06-10-cuu-r3-run-stream/hijiki/` |
| R3 run-failure smoke | `corepack pnpm --filter @workhub/api qa:cuu-r3-run-failure-smoke`，验证真实 HTTP SSE 连接 + REST fallback failed terminal |
| R3 run-failure capture | `scripts/qa/cuu-tauri-motion-capture.ps1 -Scenario run-failure -Locale zh-CN/en-US -FrameCount 72`，证据见 `assets/audit/2026-06-10-cuu-r3-run-failure/hijiki/` |
| Settings matrix | `scripts/qa/cuu-tauri-settings-capture.ps1` |
| Path hygiene | `git diff --name-only` 不含 `reference/` / `references/` |

真实视觉证据必须写入审计文档，不能只用测试命令替代。R3.10 的真实 Tauri launcher 验收已经保留 `cuu-motion-contact-sheet.png`、`cuu-motion-printwindow.gif`、`cuu-motion-printwindow.mp4`、`cuu-tauri-dom-report.json` 与 `motion-diff-report.json`。R3.12 的 zh-CN/en-US run-stream capture、R3.13.1 的 zh-CN/en-US run-failure capture、R3.13.2 的 zh-CN/en-US 401/403/offline capture 同样保留 contact sheet、GIF/MP4、DOM report 与 motion diff report；API/Tauri stdout/stderr 作为本地调试日志生成，不进入 Git 跟踪证据。业务 card 截图还必须人工查看最终帧，并要求 `right_edge_clip_gate.passed=true`，确认标题、状态、actions、Run progress/Budget 或 permission/offline 文案不被窗口边界裁切。

## 9. 当前缺口

| 缺口 | 状态 | 下一步 |
|---|---|---|
| 黑猫真实长驻录屏 | 已有 Hijiki P1.10 approval/look-only 32 帧 formal 证据 | 冻结为回归证据；R1 前不继续扩矩阵 |
| 黑/白 hover 固定锚点 | 已补 `look-only` Tauri 证据；P1.10 新增 motion_liveness + rect 稳定门 | 冻结为回归证据；R1 前只修真实回归 |
| 白猫真实长驻录屏 | 浏览器模型源帧已补；Tauri hover 已补 | 冻结；R3 后再补功能相关必要证据 |
| R3 Agent launcher / run-stream 真实 Tauri capture | 已补真实 `pet` window `launcher/en-US` capture、zh-CN/en-US run-stream completion capture、zh-CN/en-US run-failure terminal capture、zh-CN/en-US 401/403/offline capture；TS runtime、DOM render、run stream/error card tests、dev-server launcher-to-run smoke、run-stream smoke、run-failure smoke、error-fault smoke、R3.13.3 session/run restore 单测与 R3.14 chip metadata spec readback 已落 | 下一步补真实 reload capture 与跨平台 capture |
| 右键设置轻菜单 | 已补 pet window 右键菜单、黑/白切换、语言切换、悬停避让、打开设置、隐藏 Cuu | 补真实右键菜单截图 / DOM dump 和 settings matrix |
| 多屏恢复 | 未实测 | 模拟屏幕变化和离屏恢复 |
| full hide/pass-through 恢复 | 主窗 `/settings` 和托盘 `restore-pet-interaction` 源码恢复门已落 | 补真实 pass-through 恢复录屏和 settings matrix |
| Linux/macOS capture | 未补 | 建立跨平台截图策略 |
| 商用授权 | 未确认 | 联系授权或原创替换 |
| 主窗彻底严肃化 | 进行中 | 搜索截图确认无 Cuu 本体 |
| 鲜活动作状态机 | P1.6 `CuuBehaviorManifest` 源码合同已落；P1.7-P1.10 业务 motion capture、actual DOM、card framing、motion_liveness 已落 | 冻结；后续优先 R1 真 AgentLoop 和 R2 多 worker |

## 9.1 冻结后的 C-PET 优先级

| 优先级 | 工作 | 原因 |
|---|---|---|
| R1 支撑 | 真实 AgentRun / Proposal / Replay deep-link、merge decision timeline 与系统通知对接 | 让桌面端承接真纵切，而不是 fixture |
| R2 支撑 | 私有 SSE、订阅边界、跨 worker 事件与设备令牌验证 | 桌面端必须证明多 worker 后不丢/不泄漏 |
| R3 恢复 | Cuu 自然语言 / option-first 出站入口 | R3.1 已补 option-first launcher + 真实 API 链；R3.2 已补 TS run stream 回流和失败态；R3.10 已补真实 Tauri launcher/en-US capture；R3.11 已补 dev-server launcher-to-run smoke；R3.12 已补 zh-CN/en-US run-stream completion capture；R3.13.1 已补 zh-CN/en-US run-failure terminal capture；R3.13.2 已补 zh-CN/en-US 401/403/offline capture；R3.13.3 已补 webview boot session/run 恢复；R3.14 已补 chip metadata 进入 WorkItem spec；下一步补真实 reload capture |
| Deferred | 白猫全矩阵、更多动效、设置矩阵、外观调优 | R1 通过前冻结 |

## 10. 与其他文档的边界

- Cuu 形象与交互：[`cuu-desktop-pet-concept.md`](./cuu-desktop-pet-concept.md)
- 当前模型二选项：[`cuu-live2d-cat-options-current-plan.md`](./cuu-live2d-cat-options-current-plan.md)
- Pet 右键设置菜单：[`pet-right-click-settings-menu-p1-4.md`](./pet-right-click-settings-menu-p1-4.md)
- Pet settings 恢复门：[`pet-settings-recovery-p1-5.md`](./pet-settings-recovery-p1-5.md)
- Cuu behavior manifest：[`cuu-behavior-manifest-p1-6.md`](./cuu-behavior-manifest-p1-6.md)
- Cuu Tauri business motion capture：[`cuu-tauri-business-motion-capture-p1-7.md`](./cuu-tauri-business-motion-capture-p1-7.md)
- Cuu R3 Agent 入口：[`cuu-r3-agent-entry.md`](./cuu-r3-agent-entry.md)
- 桌宠参考包审查：[`desktop-pet-reference-package-audit-2026-06-08.md`](./desktop-pet-reference-package-audit-2026-06-08.md)
- 页面概念图索引：[`page-concepts.md`](./page-concepts.md)
- Web 页面规划：[`web-app.md`](./web-app.md)
- API / 事件：[`../01-architecture/api-contract.md`](../01-architecture/api-contract.md)
- 交付物与 Cuu payload：[`../../plans/p0-foundation/_experience-deliverable-contracts.md`](../../plans/p0-foundation/_experience-deliverable-contracts.md)
