---
module: 05-clients
layer: C-PET（桌宠客户端 / 瘦客户端入口层 L4）
status: 🚧
owner: workflow
---

# 桌面宠物客户端（C-PET，Tauri v2 + Rust，页面规划）

> **范围**：`C-PET` 全量——Rust 侧能力清单（spec_watch / 双向 sync / 通知 / 托盘 / deep-link / 自动更新）、窗口类型（桌宠窗 / 主窗 / 托盘）、Tauri 事件、webview↔Rust IPC 契约、桌宠人格/状态/动效、webview 页面规划（接活 / 工作台 / 对话 / 同步状态），以及安装/更新。**本篇深度=页面规划级**：逐页给「布局（顶栏/侧栏/主区/面板/弹层）+ 关键组件 + 数据/API 绑定 + SSE 实时订阅 + 空/加载/错误/无权限四态 + 关键交互与跳转流 + web↔桌宠差异」，并尽量给「文字版 wireframe」。
>
> **定位**：本篇是 `C-PET` 这一**产品呈现模式**的端级规格。**后端契约**（路由/事件/鉴权）见 [`../01-architecture/api-contract.md`](../01-architecture/api-contract.md)；**进程边界与事件总线拓扑**见 [`../01-architecture/system-architecture.md`](../01-architecture/system-architecture.md)；**实体/状态机**见 [`../01-architecture/data-model.md`](../01-architecture/data-model.md)；**体验 payload / Cuu 状态 / 交付物变更包契约**见 [`_experience-deliverable-contracts.md`](../../plans/p0-foundation/_experience-deliverable-contracts.md)；**用户用语/去黑话**以 [`../00-overview/glossary-dejargon.md`](../00-overview/glossary-dejargon.md) 为权威；**Web 端页面规划**见 [`./web-app.md`](./web-app.md)（同源信息架构，本篇只写差异）；**共享设计系统/类型化 client** 见 [`./shared-ui-kit.md`](./shared-ui-kit.md)。交叉处用相对链接引用，不重复。
>
> **扎根口径（2026-06-06 修正）**：本篇最初从现有「需求管理大师」桌面客户端真实代码演进而来，文中的 `tray.rs`、`sync.rs`、`spec_watch.rs`、`deep_link.rs`、`commands/*.rs`、`client-tauri/web-src/*` 等属于**旧项目行为参照 / 目标能力锚点**。当前 WorkHub 仓库的真实实现是 `client-tauri/src-tauri/src/{config,events,http,lib,sse,windows}.rs`、`client-tauri/src-tauri/tauri.conf.json`、`client-tauri/src-tauri/capabilities/default.json` 的 Rust shell / Tauri scaffold，加上 `apps/desktop-webview` 的 TS webview adapter。后续施工必须把旧锚点写成 `Behavior source`，把当前要落的文件写成 `Target Rust/TS paths`，不得把旧项目文件误判为已在 WorkHub 主仓落地。
> **概念图**：客户端、桌宠、澄清与检索视觉方向见 [`page-concepts.md`](./page-concepts.md)，Cuu 形象规范见 [`cuu-desktop-pet-concept.md`](./cuu-desktop-pet-concept.md)。
> **独立桌宠与绿幕素材方案**：见 [`cuu-green-screen-desktop-pet-solution.md`](./cuu-green-screen-desktop-pet-solution.md)。Cuu 的最终工程形态是右下角独立透明 `pet` window，不是主窗内浮层；视觉资产使用 GPT Image 绿幕多帧图，抠图后进入 sprite atlas。
> **Live2D 高表现力方案**：见 [`cuu-live2d-layered-asset-plan.md`](./cuu-live2d-layered-asset-plan.md)。sprite atlas 是先跑通和失败降级层；长期目标优先是 Cuu 分层 PSD + Cubism 模型，GIF 只允许做临时预览。
> **当前截图 / 动作审计**：见 [`current-state-visual-audit-and-construction-plan-2026-06-07.md`](./current-state-visual-audit-and-construction-plan-2026-06-07.md)。2026-06-07 已对 Web、desktop webview、browser pet preview 和真实 Tauri `Cuu` 窗口做截图，并对 `Cuu` 顶层窗口做 32 帧 motion capture。首轮发现 card mode 事件卡裁切；第一轮 card layout 又暴露 Cuu 只露耳朵 / 局部的失败样例；随后又发现静态 fallback 呼吸/缩放不能算鲜活动作。同日已补 bridge placement 校验、compact fallback、full-body HiDPI 站位、离线人话卡、dev server sprite asset 路径修复、运行态禁用静态 fallback 和多帧 motion QA，最终事件卡窗口可扩到 `394 x 568`，Cuu 完整身体可见，body-only 第一屏有真实摇尾动作。2026-06-08 已把默认视觉切到 Bongo-style 低恐怖谷 renderer，完成 P1b 动作增强、真实 Tauri `PrintWindow` 抓取、P1c first-painted 首帧门禁和 BONGO-REF 默认模型包门禁：wave/search/sync/revise/celebrate 可辨，GIF/MP4 已产出，最新 frame 000 已是 body-only Cuu 全身可见，`cuu-bongo-p1` 是当前唯一 `approved_default`。Live2D 144 层 PSD v1 继续作为并行实验线，只有 Cubism 录屏和 `CuuModelPackManifest` 默认门都通过后才允许替换 Bongo 默认。

本篇小节：

0. 当前 WorkHub 实现快照（避免旧锚点误判）
1. C-PET 是什么 / 与 C-WEB 的根本差异（一图一表）
2. 窗口类型（桌宠窗 / 主窗 / 托盘 / 弹层）
3. Rust 侧能力清单（command / 后台 worker / 事件发射器）
4. webview↔Rust IPC 契约（invoke 命令表 + 事件订阅表）
5. 桌宠人格 / 状态机 / 动效
6. webview 页面规划（逐页：路由清单 + 四态 wireframe）
   - 6.0 路由总表 + 信息架构
   - 6.1 安装引导（Onboarding，4 步）
   - 6.2 工作台 / 大厅（Hub，接活 ↔ 派活 双 Space）
   - 6.3 工单详情（TaskDetail，含 AI 实时进度 / 交付 / 同步）
   - 6.4 对话（Clarify 澄清 + FloatingAssistant 桌宠对话 + 升级简报）
   - 6.5 同步状态（spec 投放 / 网盘同步 / 交付下载的进度面板）
   - 6.6 通知收件箱（Inbox）
   - 6.7 项目网盘 / 会议 / 其余视角页
   - 6.8 设置（Settings，设备/同步/外观）
7. 安装与更新（NSIS 安装、设备令牌门、自动更新缺口）
8. 与其他文档的边界

---

## 0. 当前 WorkHub 实现快照（2026-06-06）

![Rust shell gap roadmap](./assets/desktop/desktop-rust-shell-gap-roadmap.png)

当前 WorkHub 主仓已经有 C-PET 的**契约地基**，但尚未有生产 Tauri 桌面壳。

### 0.1 当前已落

| 文件 / 模块 | 当前职责 | 说明 |
|---|---|---|
| `client-tauri/src-tauri/src/lib.rs` | Rust shell ownership 声明 | 明确 Rust 拥有 base url、device token、tray、deep-link、system notification、sse worker、local file sync 等本地能力；也明确不拥有 permission / workitem 状态机 / domain DTO / Cuu animation state |
| `client-tauri/src-tauri/src/config.rs` | shell config DTO / loader | server url、client token、device name、token tail；支持从 Tauri Config `workhub-shell-config.json` 与 `WORKHUB_*` / legacy `YQGL_CLIENT_TOKEN` 环境变量加载，空 token 不视为可信设备 |
| `client-tauri/src-tauri/src/http.rs` | daemon request plan | URL 归一化、device token headers |
| `client-tauri/src-tauri/src/sse.rs` | SSE target / frame parser | 规划 global/me/workitem/run/session/proposal streams，把 frame 转 push payload/status payload；新增 startup target 选择（无设备 token 只连 global）和 chunk frame buffer |
| `client-tauri/src-tauri/src/sse_worker.rs` | SSE runtime worker | 用 `tauri::async_runtime::spawn` + `reqwest` rustls stream 后台连接 SSE，发 `connecting/open/retrying` status，按 chunk 解析后广播 `push-event`；默认 5s 重连 |
| `client-tauri/src-tauri/src/notify.rs` | system notification planner | 从私有 SSE payload 中筛出 high/urgent 事件，生成 `ShellSystemNotificationPlan`；全局流和普通通知不弹 OS 通知；预算、审批、proposal、run、workitem 均路由到安全站内页面；进程内 `ShellSystemNotificationDeduper` 避免 SSE 重放重复弹窗 |
| `client-tauri/src-tauri/src/events.rs` | shell event channel names | `push-event`、`sse-status`、`navigate`、`tray-action`、`system-notification` |
| `client-tauri/src-tauri/src/tray.rs` | tray menu contract | 固定 `workhub-main-tray`、tooltip、菜单 ID、菜单文案、`TrayMenuActionPlan`，把打开主窗/隐藏主窗/显示隐藏 Cuu/打开收件箱/退出映射到 window control 或 app exit；动态未读/审批计数尚未接 |
| `client-tauri/src-tauri/build.rs` | Tauri build entry | 调用 `tauri_build::build()`，使当前 crate 具备真实 Tauri build scaffold |
| `client-tauri/src-tauri/src/main.rs` | Tauri runtime entry scaffold | 接 `tauri::Builder`、`generate_context!`、`invoke_handler`，注册 pet/window command；setup 会先用 `WebviewWindowBuilder::from_config` 动态创建 `create:false` 的 `pet` window，并注入 `window.__WORKHUB_SURFACE__="pet"`；随后恢复/夹取 `pet-window-state.json` 并预定位 body-only Cuu，但不在 webview first paint 前 show；`set_pet_window_mode` 已执行 resize / position / show，且在 show/toggle、mode 切换时显式保持 `pet` always-on-top；`set_pet_window_settings` 已能同步 scale / opacity / pass-through，其中 scale 进入 body/card 几何，pass-through 执行 Tauri `set_ignore_cursor_events`；pet work area、window position 与 cursor sampling 已做 HiDPI physical→logical 换算，避免高缩放屏离屏；`start_pet_window_drag` 已执行 `start_dragging`，`save_pet_window_position` 已读取真实窗口位置并保存 body anchor，`sample_pet_cursor_near` 已读取真实 cursor 与 pet window rect；setup 已加载 shell config、安装 WorkHub 托盘/deep-link/notification/single-instance plugin，并按配置启动 SSE worker |
| `client-tauri/src-tauri/icons/icon.ico` | Tauri Windows resource icon | 从 Cuu alpha atlas 样张裁切生成的占位 app icon，满足 `tauri-build` Windows resource 要求；正式发布前替换为完整品牌图标 |
| `client-tauri/src-tauri/src/windows.rs` | window plan contract | `main` / `pet` 窗口计划，`pet` 采用 transparent / decorations false / always-on-top / skip taskbar |
| `client-tauri/src-tauri/src/window_controls.rs` | window control command contract | `show/hide/focus/toggle main/pet` 的 typed plan 与 command 名称；deep-link route 做安全校验，pet 操作不抢焦点 |
| `client-tauri/src-tauri/src/deep_link.rs` | deep-link route contract | 支持 `workhub://` 与旧 `yqgl://`，把 task/workitem/proposal/run/approval/inbox/settings/me/cost 等目标映射到安全站内 route，拒绝外链、路径穿越、编码斜杠与未知 target |
| `client-tauri/src-tauri/src/single_instance.rs` | single-instance launch contract | 从第二次启动的 argv/cwd 生成 `ShellSingleInstancePlan`；无协议 URL 时聚焦主窗，有 `workhub://` / `yqgl://` 时复用 `deep_link.rs` 生成安全站内跳转；恶意 WorkHub 协议 URL 留诊断而不执行 |
| `client-tauri/src-tauri/src/pet_window.rs` | Cuu pet window geometry contract | `body_only` / `card` 双模式尺寸、右下角定位、从小猫锚点向左上展开、屏幕内夹取、鼠标接近判定、拖拽 plan；新增 `PetWindowSettings`，支持 75/100/125/150 scale、60/80/100 opacity 和 pass-through，并让 scale 后的 body/card 仍保持同一右下角 anchor |
| `client-tauri/src-tauri/src/pet_commands.rs` | Cuu pet window command scaffold | 固定 `set_pet_window_mode`、`set_pet_window_settings`、`start_pet_window_drag`、`save_pet_window_position`、`sample_pet_cursor_near` command 名称和 typed plan，新增 body anchor 防漂移、active mode rect、cursor decision helper 与 settings confirmation plan |
| `client-tauri/src-tauri/tauri.conf.json` | Tauri config scaffold | 对齐 `apps/desktop-webview` dev/build 输出，声明 `main` / `pet` window；`pet` 配置为 `create:false`，由 Rust setup 动态创建并注入 pet surface flag；`withGlobalTauri:true` 对齐当前 `window.__TAURI__` bridge；`plugins.deep-link.desktop.schemes=["workhub","yqgl"]` 已写入；`skipTaskbar` 暂留在 WorkHub window plan，未写入 Tauri schema |
| `client-tauri/src-tauri/capabilities/default.json` | Tauri capability scaffold | `main` / `pet` 授予 `core:default` 和最小窗口拖拽权限 `core:window:allow-start-dragging`；文件/进程/shell 能力后续按模块最小化开启 |
| `client-tauri/src-tauri/tests/tauri_scaffold.rs` | scaffold contract tests | 校验 Tauri build target、window config 与 `ShellWindowPlan` 一致、capability 未提前放开高风险权限 |
| `apps/desktop-webview/src/main.ts` | 桌面 webview typed surface | 消费 `@workhub/api-client`、渲染 Gold Path / intake / workitem / proposal / agent live |
| `apps/desktop-webview/src/desktop-cuu-runtime.ts` | Cuu notice bridge | 从 Tauri/mock listener 订阅 `push-event` / `sse-status` / `system-notification`；push/status 生成 Cuu notice，system notification plan 交给后续偏好、历史与点击跳转处理 |
| `apps/desktop-webview/src/cuu-preferences.ts` | Cuu preference panel | 右上角轻入口，面板默认隐藏；本地存储 `attention_mode` / `sound_mode` / `reduced_motion` / `queue_limit`，把点击偏好写回 `CuuController` |
| `apps/desktop-webview/src/browser.ts` | webview preview shell | 读取 `/api/pages/gold-path`，支持 scripted Cuu demo；主窗已接 `workhub.locale` 中英双语切换，Gold Path 静态 chrome、Cuu 队列 badge、审批原因按钮、动作失败/未接线提示会随语言变化；启动时按 Rust injected `__WORKHUB_SURFACE__`、Tauri window label、`/pet`、`?surface=pet`、`#surface=pet` 或 `pet.html` 分流到 Cuu pet surface；生产 Tauri `pet` window 加载根 bundle 但由 Rust 初始化脚本选中 pet surface；主窗会订阅 Rust `navigate` 事件并切换到对应 Gold Path 面板 |
| `packages/ui/src/gold-path/i18n.ts` | shared client i18n foundation | 当前 TS-first shell 的 `WorkHubLocale`、`goldPathT()` 与 `workhub.locale` 单一真相源；Web 与 desktop webview 共用，后续真实 React routes / Cuu card / API Page VM 字段必须收敛到这里 |
| `apps/desktop-webview/src/pet-surface.ts` | Cuu pet webview surface | `pet` 窗口入口只渲染 Cuu atlas / Bongo 本体和一张轻气泡，不加载 Gold Path 主壳；card mode 只有在 Rust placement 确认后渲染 full card，未确认或失败时走 compact fallback；P1.2 已把 `CuuCard.kind` / `priority` / `sections` / `progress` / `evidence_refs` / `input` 渲染进轻卡，操作区前置，打回理由用固定按钮；P1.2b 已把选中的 clarification option 通过 `selected_option_ids` 提交给 session API；P1d-a 已输出 `data-pet-scale-percent`、`data-pet-opacity-percent`、`data-pet-pass-through` 和缩放后的窗口尺寸 CSS 变量；P1e-a 已输出 `data-pet-cursor-near` / `data-pet-hovered` / `data-pet-dragging`，供输入手感截图 QA 读取 |
| `apps/desktop-webview/src/pet-surface-qa.ts` | Cuu pet visual QA contract | 静态检查透明 root、CSS 变量驱动的右下角独立 surface、点击/拖拽热区、非主壳、Bongo 默认、真实多帧 atlas fallback、轻气泡、选项优先、heavy card context 和默认窗口手感属性 |
| `apps/desktop-webview/src/pet-window-bridge.ts` | Cuu pet webview input/window bridge | 解析 mock / Tauri-like bridge，支持 `body_only` / `card` 模式切换、`setSettings(scale/opacity/pass-through)`、`startDragging`、位置保存、Rust cursor sample command plan 与 browser fallback；现在支持 `__TAURI__.core.invoke` / legacy `__TAURI__.invoke`，并校验 `set_pet_window_mode` placement 和 `set_pet_window_settings` settings 返回值 |
| `packages/cuu/src/atlas-manifest.ts` | Cuu atlas contract | 真实 PNG/WebP atlas manifest schema、grid frame helper、partial/full coverage 校验 |
| `apps/desktop-webview/src/cuu-atlas-assets.ts` | Cuu motion pack asset manifest | 指向 `cuu-p1-motion-pack.png` atlas，并在 clip 上保留 source-green / alpha 路径 |
| `apps/desktop-webview/src/cuu-atlas-runtime.ts` | Cuu atlas renderer | 按 atlas frame rect 生成 clip sheet background sprite 或 `<img>` frame stack；dev server `/src/assets/...` 保持原路径，打包态 `/assets/...` 才相对化为 `./assets/...`；内联静态 Cuu fallback 只作为非运行态兜底，不可替代真实动作 |
| `packages/cuu/src/model-pack.ts` | Cuu model pack default gate | 对齐 BongoCat 的可替换模型思想，当前 `cuu-bongo-p1` 为唯一 `approved_default`；PSD draft 资产即使可渲染，也不能作为默认候选；P1d-a 后 scale / opacity / pass-through 已标为 supported |
| `apps/desktop-webview/src/assets/cuu/*` | Cuu generated asset pack | 已有 18 个动作 clip 的绿幕源图、透明 alpha 图、motion pack atlas 和 `static/cuu-static-fallback-v1-alpha-clean.png` 内联兜底图 |
| `packages/cuu/src/idle-scheduler.ts` | Cuu alive behavior scheduler | 纯 TS 调度呼吸、眨眼、尾巴、看鼠标、睡觉、醒来、拖动、轻敲、挥手等微动作；P1e-a 新增 `cursor_near` interaction，首次靠近立即 `look_at_mouse`；Rust 不拥有动画状态 |
| `scripts/qa/cuu-tauri-smoke.ps1` | Windows Tauri runtime smoke | 启动真实 debug app，定位 `Cuu` 顶层窗口，校验 visible/topmost/bottom-right，隐藏主窗，并用 `PrintWindow(PW_RENDERFULLCONTENT)` 对透明/layered WebView2 pet 窗口做像素检查；若 1420 未监听，会自动隐藏启动 `@workhub/desktop-webview` dev server，避免抓到 WebView 错误页 |
| `scripts/qa/cuu-tauri-motion-capture.ps1` | Windows Tauri motion capture | 启动真实 debug app，先用 `first-frame-probe.png` 等到 Cuu 橘色/有效视觉像素达标，再连续抓取 `Cuu` 顶层窗口 frames，输出 contact sheet、diff JSON、GIF/MP4；用于验证 Cuu 是否真实有动作、事件卡是否进入 card mode、是否被裁切 |

### 0.2 当前未落

| 能力 | 当前状态 | 后续目标 |
|---|---|---|
| Tauri v2 app runtime | 已有 `tauri` / `tauri-build` dependency、`build.rs`、`main.rs`、`tauri.conf.json` / capability scaffold；pet 启动预定位、first-painted 后 show、mode / drag / save-position / cursor sample command 已执行到真实 window / AppHandle API，body anchor 位置已保存到 Tauri Config `pet-window-state.json`；托盘基础菜单、SSE global worker、deep-link plugin、notification plugin 与 single-instance plugin 已在 setup 安装；启动时会读 `workhub-shell-config.json` 与环境变量 | 后续补设备注册/安全 vault、多屏恢复实测、安装包 smoke |
| 主窗 `main` | 已有 `ShellWindowPlan` + Tauri window config + `show/hide/focus` control plan；`main.rs` 已注册 `show_main_window` / `hide_main_window` / `focus_main_route` 并执行到真实 Tauri window API，安全 route 会通过 `navigate` 事件发给 webview；desktop webview 已解析 safe route string / `{route}` / `{path}` 并切换 Gold Path 面板；托盘左键/菜单、deep-link、system notification plan 和第二次启动均可显示/隐藏/聚焦主窗 | 承载 `apps/desktop-webview` build；后续补 OS notification click source 与 Linux/macOS smoke |
| 独立桌宠窗 `pet` | 已有 `ShellWindowPlan` + Tauri window config + `show/hide/toggle` control plan；生产 Tauri 由 Rust setup 动态创建 `create:false` 的 `pet` window 并注入 pet surface flag，浏览器调试保留 `/pet` / `?surface=pet` / `#surface=pet` / `pet.html`；`pet-surface-qa.ts` 已守住透明 root、右下角、非主壳、Bongo 默认、多帧 atlas fallback、选项优先和 heavy card context；`pet_window.rs` 已固定 body-only/card 几何、右下角定位、展开锚点、鼠标接近与拖拽 plan；`main.rs` 已把启动期 body-only 预定位、first-painted 后 show、pet show/hide/toggle、mode resize/position/show、drag、save-position、cursor sample 执行到真实 Tauri window / AppHandle API，并处理 HiDPI 坐标换算与运行期 topmost；托盘菜单可 toggle Cuu；2026-06-07 Windows debug smoke 已确认 `Cuu` 窗口 visible + topmost + 在右下角显示 Cuu 和气泡，且主窗隐藏后仍可见；card mode motion capture 已确认事件卡出现后窗口可扩到 `394 x 568`，最终 HiDPI 抓帧中 Cuu 完整身体可见、轻卡右侧有留白；2026-06-08 Bongo P1b/P1c 真实 Tauri capture 已产出 GIF/MP4，最新 frame 000 起 body-only 全身可见、frame 006 起 card mode 全身可见；同日 P1.2 browser CDP 抓帧确认审批轻卡能同时显示 Cuu 全身、按钮、变更摘要和风险摘要；`skipTaskbar` 仍在 WorkHub plan | transparent / decorations false / always-on-top / skip taskbar；后续补 P1.2 真实 Tauri card fixture capture、Live2D Cubism runtime、拖拽后截图、多屏恢复实测、安装包 smoke、系统通知点击和跨平台透明 capture；atlas/Hatch 仅 fallback |
| Cuu 绿幕资产 | 已有 18 clip motion pack，`CuuMotionHint.sprite_state` 与 idle / interaction micro action 均已 full coverage，均保留绿幕源图、透明 alpha、`cuu.sprite.json` 和内联静态兜底图 | 继续做 anchor 微调、WebP/PNG 压缩、alpha 边缘 QA 与性能检查 |
| 托盘 | 已有 `client-tauri/src-tauri/src/tray.rs` 菜单契约与 `main.rs` `TrayIconBuilder` runtime；左键打开 WorkHub，右键菜单支持打开/隐藏主窗、显示/隐藏 Cuu、打开收件箱、退出，并发 `tray-action` plan | 动态未读/审批状态、tooltip/title 更新、同步子菜单、通知点击联动 |
| SSE worker | 已有 `sse_worker.rs` runtime；setup 读取 shell config 后连接 `/api/push/stream`，按 SSE chunk 解析后发 `push-event`，连接态发 `sse-status`，断开 5s 重试；`/me` 仅在 config/file/env 有可信设备 token 时纳入 plan | 接设备注册/安全 vault 后的 worker restart，补 run/session/proposal 按需订阅和端到端 smoke |
| 系统通知 | 已有 `notify.rs` high/urgent 策略、进程内 dedupe、`tauri-plugin-notification` runtime、`system-notification` plan event；`sse_worker.rs` 只对私有流的预算耗尽、预算告警、审批请求、proposal、run/escalation、sync conflict 和 high/urgent notification 弹 OS 通知 | 通知点击联动、用户偏好/勿扰接线、去重持久化、安装包权限 smoke |
| deep-link / single-instance | 已有 `tauri-plugin-deep-link`、`tauri-plugin-single-instance`、`workhub://` / `yqgl://` scheme 配置、启动 URL / 运行时 URL listener、`deep_link.rs` route 白名单、第二次启动 argv/cwd plan、`deep-link` / `single-instance` / `navigate` 事件发射 | 安装包协议注册 smoke、更多业务 target 与通知点击联动 |
| 本地同步 / 交付 | 只有 ownership 声明 | sync worker、path containment、conflict resolver、delivery package |
| Cuu 偏好 / shell 设置 | desktop webview 内已有偏好面板和本地存储；P1d-a 新增尺寸 75/100/125/150、透明度 60/80/100、点击穿透；`pet-window-bridge.ts` 会把主窗偏好同步到独立 pet window，Rust 侧已有 `pet-window-state.json` 位置落盘、`workhub-shell-config.json` 读取入口和 `set_pet_window_settings` | 迁入真实 Tauri Settings / pet window，接设备注册、安全 vault、托盘显隐、hide-on-hover、多屏恢复实测和系统通知偏好 |
| 中英双语动态内容 | 主窗 Gold Path 静态 chrome 已支持 `zh-CN` / `en-US`，但 Cuu card payload、独立 pet 轻气泡、API Page VM 动态标题/摘要仍跟随 daemon 原文 | 后续给 `GET /api/pages/*`、Cuu card adapter、pet surface 轻卡动作按钮补 locale 字段和截图验收 |
| updater / autostart | 未接 | P5 接安装更新、自启动、诊断 |

结论：本文后续大量旧项目能力描述仍有价值，但它们是迁移参照和目标形态；当前 WorkHub 已把 `Tauri scaffold → pet window command → cursor/position/HiDPI → tray basics → SSE config loader/global-or-me worker → deep-link handler → webview navigate listener → high/urgent OS notification → single-instance focus/deep-link → pet surface static visual QA → Windows debug screenshot smoke` 接到真实代码与测试。下一步应继续补 `设备注册/安全 vault + worker restart → OS notification click source / preference bridge → local sync/delivery → automated Tauri pixel QA`。

更完整的差距与后续 backlog 见 [`prd-concept-reproduction-gap-audit.md`](./prd-concept-reproduction-gap-audit.md)。

---

## 1. C-PET 是什么 / 与 C-WEB 的根本差异

`C-PET`（[glossary §8](../00-overview/glossary-dejargon.md)「桌面宠物（Desktop Pet）」、`README §1` 的客户端代号）是**接活/干活专属的瘦客户端**：一个 Tauri v2 应用 = **Rust 壳**（窗口/托盘/文件同步/通知/deep-link/设备令牌持有者）+ **React webview**（与 `C-WEB` 共享 `@yqgl/shared` 设计系统，但承载桌面专属能力）。它不含业务逻辑——所有真相在 daemon（见 [`system-architecture.md`](../01-architecture/system-architecture.md)）。

**根本差异：设备令牌门**（[glossary §8](../00-overview/glossary-dejargon.md)「设备令牌门」、[`api-contract.md §3.2`](../01-architecture/api-contract.md)）。`C-WEB` 走 cookie，只能**派活/审批**；`C-PET` 持注册过的设备令牌（`X-YQGL-Client-Token`，`http.rs:73`），才能**接活/干活/同步**。这条不是 UI 偏好而是服务端硬约束：`clientFetch`（`lib/tauri.ts:111`）对同源请求注入令牌头，后端 `require_local_client` 据此放行 `claim`/`sync`/`delivery`。

```
┌──────────────────────── C-PET 进程（Tauri v2）────────────────────────┐
│                                                                       │
│  Rust 壳 (main.rs) ── load_shell_config(file/env) → setup workers       │
│   ├─ 后台 worker: sse_worker ─ global + token-gated /me → push-event   │
│   ├─ 后台 worker: reminders::spawn ─ 60s 轮询 due/unread → OS toast    │
│   ├─ 后台 worker: spec_watch ─ 监视 spec/ 文件夹 → 自动上传            │
│   ├─ tray::install ─ 托盘菜单（接单状态/同步/交付/设置/退出）         │
│   ├─ deep_link ─ workhub://open/* + yqgl://* → navigate + deep-link    │
│   └─ invoke_handler! ─ 40+ 命令（auth/requirements/sync/submitter/…）  │
│                                                                       │
│  WebView2 (web-src, React + react-router)                             │
│   ├─ App.tsx ─ TitleBar + Sidebar + <Routes> + FloatingAssistant      │
│   ├─ invoke()/useEvent() ── lib/tauri.ts ── IPC 桥                     │
│   └─ clientFetch()/clientJson() ── 直连 daemon HTTP（带令牌头）        │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
        │ invoke(cmd)              │ clientFetch(/api/*)        ▲ emit(event)
        ▼                          ▼                            │
   Rust commands ── reqwest ──► C-DAEMON（OpenAPI）── SSE ──────┘
```

| 维度 | C-WEB（浏览器） | C-PET（桌宠，本篇） | 锚点 |
|---|---|---|---|
| **权限层级** | 派活 / 审批 | + 接活 / 干活 / 同步（设备门） | `commands/auth.rs:94` `register_device`、`lib/tauri.ts:122` |
| **实时通道** | `EventSource` 直连 SSE | Rust `sse.rs` 解析字节流 → `emit("push-event")` → `useEvent` | `sse.rs:148`、`lib/tauri.ts:41` |
| **本地文件** | 无（仅上传选择器） | spec 投放自动上传 + 网盘下载同步 + 交付打包 | `spec_watch.rs`、`sync.rs`、`delivery.rs` |
| **常驻入口** | 浏览器标签 | 托盘 + 桌宠浮窗（隐藏到托盘不退出） | `tray.rs`、`TitleBar.tsx:53`（关闭=`hide()`） |
| **通知** | 页内 toast | 页内 toast **+ OS 系统通知**（右下角弹窗） | `App.tsx:66` `osNotify`、`reminders.rs:76` |
| **唤起** | URL | `workhub://` deep-link + 兼容 `yqgl://` + 托盘菜单 + 单实例聚焦；第二次启动带协议 URL 会复用 deep-link 白名单跳转 | `deep_link.rs`、`single_instance.rs`、`main.rs`、`tauri.conf.json` |
| **窗口** | 浏览器 chrome | 当前 scaffold：`main` 稳定主壳 + `pet` 透明桌宠窗配置；目标再升级主窗无边框/Mica | `windows.rs`、`tauri.conf.json` |
| **身份持久化** | cookie | 当前 WorkHub 已能启动读取 `workhub-shell-config.json` + env token；目标补 `config.json` / secure vault / sync root / dedup 态原子写 | `config.rs`、后续 `commands/config.rs` |

> **演进基线**：今天「桌宠」尚未独立成窗——它是右下角的 `FloatingAssistant`（`components/FloatingAssistant.tsx`）气泡 + 系统托盘（`tray.rs`）。WorkHub 的 C-PET 把这两者**升级为一等「桌宠」呈现层**（[glossary §8](../00-overview/glossary-dejargon.md) 标注 *(新增,L4)*），并补齐双向同步（现状 `sync.rs:227` 明注单向占位）与升级简报（PM 模式人话简报，`FR-PM-001`）。

---

## 2. 窗口类型

C-PET 用 **三类窗口 + 一类弹层**。当前 WorkHub scaffold 已在 `tauri.conf.json` 中声明 `main` / `pet` 两个窗口，但还没有真实 Tauri runtime；下方旧项目细节是行为参照，施工时以 0.1/0.2 的当前文件表为准。

### 2.1 主窗（`main`，目标 + 旧参照）

- **当前 WorkHub scaffold**：`main` window config = 1180×780、最小 960×640、`visible:true`、`focus:true`、`decorations:true`、`transparent:false`，先保证承载 `apps/desktop-webview` 的稳定主壳。
- **当前控制契约**：`show_main_window` / `hide_main_window` / `focus_main_route` 已落并注册为 Tauri command；route 必须是安全站内路径，拒绝空值、外链、`..`、反斜杠和换行；`focus_main_route` 会 show/focus 主窗并 emit `navigate`。
- **旧项目 / 目标形态参照**：无边框（`decorations:false`）、透明（`transparent:true`）、有阴影、`titleBarStyle:"Overlay"`、`hiddenTitle:true`，1280×800、最小 920×600、居中、**启动隐藏**（`visible:false`），用于后续主窗视觉升级。
- **毛玻璃**：`window::decorate`（`window.rs:11`）在 Win11 上 `apply_acrylic`（半透明实时模糊，回退 `apply_mica`），macOS 上 `apply_vibrancy(HudWindow)`；应用后才 `window.show()`（`window.rs:40`）——避免白闪。
- **自绘标题栏**：`TitleBar.tsx` 提供 `data-tauri-drag-region` 拖拽区 + 最小化/最大化/隐藏按钮 + 主题切换 + **SSE 连接绿点**（`TitleBar.tsx:26`，`sseConnected ? bg-success : bg-ink-faint`）。**关闭按钮 = `window.hide()` 而非退出**（`TitleBar.tsx:53`，「隐藏到托盘」）——只有托盘「退出」或 `app.exit(0)` 真退出（`tray.rs:44`）。
- **承载**：除桌宠对话外的全部 webview 页面（§6 路由）。

### 2.2 桌宠窗（`pet`，**新增**）

> 旧参照里的 `FloatingAssistant` 是**主窗内的浮层**（`fixed bottom-5 right-5`，`FloatingAssistant.tsx:236`），随主窗显隐。WorkHub 现在已经有独立 `pet` Tauri window、Rust injected pet surface、浏览器调试入口和 Windows debug `PrintWindow` 像素 smoke；后续必须把它继续做成可多屏恢复、可长期常驻的桌面窗口，主窗隐藏到托盘后桌宠仍在桌面承接提醒，这是「桌宠是常驻入口」的关键。

- **当前 WorkHub scaffold**：`pet` window 初始 config = 180×220、最小 160×180、`visible:false`、`focus:false`、`decorations:false`、`transparent:true`、`alwaysOnTop:true`；setup 会在恢复保存位置后按 body-only 模式预定位 Cuu，随后由 pet surface 首屏渲染后的 `set_pet_window_mode` 负责 show，避免启动时抢焦点和 blank 首帧；`skipTaskbar:true` 已在 `ShellWindowPlan` 中固定，但暂未写入 `tauri.conf.json`，等真实 Tauri dependency/schema 校验后再接。
- **当前几何合同**：`client-tauri/src-tauri/src/pet_window.rs` 已把 `body_only`（180×220）和 `card`（380×560）拆开，默认把 Cuu 放在主显示器 work area 右下角 24px，展开卡片时从小猫身体锚点向左上扩展，并对离屏位置做 clamp。P1d-a 已把 scale 纳入几何：75/100/125/150 四档会同步缩放 body/card 窗口，但仍保持同一 body anchor，避免桌宠被裁或展开漂移。
- **当前控制契约**：`show_pet_window` / `hide_pet_window` / `toggle_pet_window` 已落并注册为 Tauri command；所有 pet 操作 `focus:false`，保证 Cuu 提醒不抢用户当前输入焦点。
- **当前 webview surface**：`apps/desktop-webview/src/browser.ts` 会按 Rust injected `__WORKHUB_SURFACE__`、Tauri window label、`/pet`、`?surface=pet`、`#surface=pet` 或 `pet.html` 分流到 `pet-surface.ts`，该 surface 只渲染 Cuu atlas 本体和一张轻气泡，不加载 Gold Path 主壳；生产 Tauri `pet` window 加载根 bundle，由 Rust 初始化脚本选中 pet surface，避免刷新/静态路由 fallback 问题。
- **当前活体行为**：`packages/cuu/src/idle-scheduler.ts` 已提供基础 scheduler，`pet-surface.ts` 会在没有 active card 时 tick 并更新 `data-cuu-idle-action`，并按该 action 选择真实 atlas clip；P1e-a 后 `cursor_near` 首次进入附近区域会立即触发 `look_at_mouse`，surface 同时输出 `data-pet-cursor-near` / `data-pet-hovered` / `data-pet-dragging` 作为截图 QA 可读状态；`pet-surface-qa.ts` 已把透明 root、右下角独立 surface、点击/拖拽热区、非主壳、真实多帧 atlas、轻气泡、选项优先卡片和窗口手感属性做成静态门禁；`pet-window-bridge.ts` 已把 pointer hover / drag / release 与 Rust cursor sample 喂给 scheduler，并会调用 Tauri window `startDragging` 或 Rust command fallback；`pet_commands.rs` 已固定 `set_pet_window_mode`、`set_pet_window_settings`、`start_pet_window_drag`、`save_pet_window_position`、`sample_pet_cursor_near`；`main.rs` 已注册这些 command，并把启动期 body-only 预定位、first-painted 后 show、mode resize/position/show、settings scale/pass-through、drag、save-position、cursor sampling 执行到真实 Tauri window / AppHandle API，拖拽位置保存到 Tauri Config `pet-window-state.json`，启动时会 clamp 回当前 work area；所有 monitor work area、window outer position 和 cursor position 会从 physical px 转成 logical px，防止 HiDPI 离屏；运行期会显式设置 `set_always_on_top(true)`，保证 Cuu 不被主窗盖住。当前已完成 Windows debug `PrintWindow` 像素 smoke，会在隐藏主窗后校验 `Cuu` 顶层窗口 visible/topmost/bottom-right 和可见像素；仍缺 hover/near/drag 真实录屏、长时间运行 QA、安装包 smoke、跨平台透明 capture 和多屏恢复实测。
- **当前 motion capture 发现（2026-06-07）**：32 帧 `PrintWindow(PW_RENDERFULLCONTENT)` 抓取确认 Cuu body-only 窗口可被真实捕获；首轮发现离线卡片出现时 `pet` 窗口仍停在约 `194 x 228` 的 body-only 物理尺寸，导致卡片正文和 Cuu 被裁切；第一轮 card layout 发现 Cuu 只露耳朵 / 局部，不能算通过；card mode fresh build 抓帧确认窗口扩到 `394 x 568`、Cuu 完整身体可见、离线轻卡人话化且 HiDPI 右侧留白正常；后续又发现只显示 inline 静态 fallback 时看起来只有呼吸/缩放，也不能算通过。最终修复 dev asset path 后，body-only 第一屏能看到 `idle_tail_sway`，card mode 中也能看到真实 worried/offline 姿态。motion capture 脚本已经成为后续 Cuu QA 的固定门。
- **当前偏好面板**：`apps/desktop-webview/src/cuu-preferences.ts` 已提供右上角轻入口，面板默认隐藏；展开后可设置提醒模式（正常/安静/勿扰）、声音（开启/静音）、减少动效、队列上限、桌宠尺寸、透明度和点击穿透；偏好写入 localStorage 并同步到 `CuuController`，主窗会通过 `pet-window-bridge.ts` 立即调用 `set_pet_window_settings` 更新独立 pet window。
- **当前证据动作**：`desktop-cuu-runtime.ts` 已支持 `knowledge-search` action，点击「打开完整检索」会调用 typed `client.searchKnowledge`，把返回的 `EvidenceBubble` 再交给 Cuu controller 作为证据卡显示；点击「用这些证据继续」会把当前 evidence card 的 `evidence_refs` 通过 typed `client.useEvidenceForWorkItem` 提交到 `POST /api/workitems/{id}/evidence-bindings`，并把返回的 `WorkItemDetailVM` 回显成任务卡。真实知识库持久化、证据详情展开和完整检索页分页仍待后续。
- **形态（建议）**：独立右下角小窗，idle 约 160×180，展开轻卡约 380×560；`decorations:false`、`transparent:true`、`alwaysOnTop:true`、`skipTaskbar:true`、可拖拽、记忆位置（后续接 `tauri-plugin-window-state`）。
- **视觉资产（新增硬约束）**：P1 不再接受恐怖谷 PSD、抽象图标或 inline 静态 fallback 作为完成标准；当前默认使用 `bongo_cuu` 低恐怖谷 renderer，atlas / Hatch 作为 fallback，PSD / Live2D 作为实验线。Bongo P1b 已补挥手、检索、同步、打回、抱文件、庆祝和拖拽动作，并已通过 browser CDP 与真实 Tauri `PrintWindow` 多帧抓取；P1c 已补 first-painted 首帧门禁，frame 000 不再空白；BONGO-REF 已把 `CuuModelPackManifest` 接成默认门禁，`cuu-bongo-p1` 通过，PSD draft 默认候选失败；P1d-a 已补窗口尺寸、透明度和点击穿透契约；P1e-a 已补 cursor-near 输入响应合同。真实运行态必须显示可辨认的非缩放动作；静态 fallback 只能用于诊断或非运行兜底，不能作为 motion QA 通过依据。生产前继续做 hover/near/drag 录屏、动作幅度二轮、窗口设置截图、model pack loader、anchor 微调、WebP/PNG 压缩、alpha 边缘 QA、长时间 idle 性能检查。
- **两态**：
  - **收起态** = 一个会动的桌宠头像（§5 人格/动效），点一下展开对话；红点角标表示「有事找你」（待审批/升级/打回）。
  - **展开态** = 迷你对话面板（承载 §6.4 的 FloatingAssistant 对话 + 升级简报 + 审批询问卡）。
- **唤起/隐藏**：当前 `tray.rs` 已有「Show / hide Cuu」托盘项并在 `main.rs` 执行 `toggle_pet_window(Tray)`；deep-link `workhub://me` / 兼容 `yqgl://me` 已能打开主窗到个人入口，后续再补直接点亮桌宠和通知点击联动。
- **IPC**：桌宠窗与主窗共享同一 `push-event` 事件流（`emit` 默认广播到所有窗口）；当前 shell config 是启动期加载，后续 Settings/设备注册落地后再升级为共享可变 `ConfigState`，并在 token 更新后 restart 私有 SSE。
- **MVP 降级**：真实 Tauri runtime 已能启动独立 `pet` window；`/pet` / `?surface=pet` / `#surface=pet` / `pet.html` surface 继续作为 webview 预览和自动化测试入口；主窗 notice 的 procedural sprite 只保留为 fallback，不再作为桌宠完成标准。

### 2.3 系统托盘（基础已落 + 动态状态待补）

- **当前 WorkHub runtime**：`Cargo.toml` 已开启 Tauri `tray-icon` feature；`client-tauri/src-tauri/src/tray.rs` 固定 `WORKHUB_TRAY_ID="workhub-main-tray"` 与 `TrayMenuActionPlan`；`main.rs` setup 用 `TrayIconBuilder::with_id`、`MenuItemBuilder`、`MenuBuilder` 安装真实托盘，并复用默认窗口图标。
- **当前可复用契约**：托盘项映射到 `ShellWindowControlPlan`：打开主窗=`show_main_window(Tray)`，隐藏主窗=`hide_main_window(Tray)`，显示/隐藏桌宠=`toggle_pet_window(Tray)`，打开收件箱=`focus_main_route(Tray,"/inbox")`；退出项只执行 `app.exit(0)`，不伪装成业务窗口动作。
- **左键**：`show_menu_on_left_click(false)`，左键点击 tray icon 直接执行 `show_main_window(Tray)`，显示并聚焦主窗。
- **当前右键菜单**：
  ```
  Open WorkHub           -> show_main_window(Tray)
  Hide main window       -> hide_main_window(Tray)
  Show / hide Cuu        -> toggle_pet_window(Tray)
  Open inbox             -> focus_main_route(Tray, "/inbox")
  Quit WorkHub           -> app.exit(0)
  ```
- **当前事件**：非退出菜单项会执行窗口动作，并向 webview 广播 `tray-action`，payload 为 `TrayMenuActionPlan {id,label,kind,windowControl,exitsApp}`；如果动作包含 route，`execute_window_control` 还会发 `navigate` route string。
- **旧项目 / 目标动态菜单参照**（动态重建，`build_menu`，旧 `tray.rs:65`）：
  ```
  用户：<昵称|未登录>   (禁用，仅展示)
  ──────────────
  打开主窗口            → navigate("/")
  打开需求大厅          → navigate("/")
  打开待办收件箱        → navigate("/inbox")
  ──────────────
  立即拉新需求          → emit tray-action {pull_new}
  立即同步网盘          → emit tray-action {sync_drive}
  完成并交付…           → emit tray-action {do_deliver}
  ──────────────
  接单状态 ▸ 空闲/忙碌/自定义…   → set_availability / tray-action
  网盘同步 ▸ 关/仅下载           → set_drive_mode
  ⏸暂停同步 / ▶恢复同步          → toggle_pause
  ──────────────
  设置…                 → navigate("/settings")
  退出                  → app.exit(0)
  ```
- **未读角标（待补）**：Win11 无托盘红点公共 API，后续用 **tooltip + title 文案**承载（目标 `update_tray_unread`）；webview 侧可由 `refreshUnreadBadge` 防抖拉 `/api/notifications?status=unread` 后调用 Rust 更新。
- **WorkHub 扩展（待补）**：菜单新增「待审批 N」（`permission.ask` 计数）；「网盘同步」子菜单在双向同步落地后增「双向」项（现状 `two_way` 被强制降级）。

### 2.4 弹层（webview 内，非原生窗口）

由 webview 用 `@yqgl/shared` 组件渲染，覆盖在主窗/桌宠窗之上：

- **Toast**：`ToastHost`（`App.tsx:330`），全局右上角；`osNotify` 同时触发 OS 系统通知。
- **欢迎引导（WelcomeTour）**：`App.tsx:290`，首次进主壳自动开（`useFirstRun` 持久化），6 张卡（Sparkles/切换 Space/Bot/Bell/Folder/Command）。
- **审批询问卡 / 升级简报**：WorkHub 新增（`permission.ask` / `escalation.created` 事件驱动），优先在桌宠窗展开态呈现，详见 §6.4。
- **原生对话框**：后续接 `@tauri-apps/plugin-dialog` 时，再在 capability 中按需授权 `dialog:allow-open/save/message`；当前 `capabilities/default.json` 只保留 `core:default`。

---

## 3. Rust 侧能力清单

C-PET 的 Rust 壳 = **命令处理器**（被 webview `invoke` 同步调用）+ **后台 worker**（长驻、主动 `emit` 事件）+ **平台集成**（托盘/deep-link/窗口/通知）。下表给全量，均对应真实模块。

### 3.1 后台 worker（长驻，`setup` 启动）

| worker | 职责 | 启动 | 发射事件 | 锚点 |
|---|---|---|---|---|
| **SSE worker** | 当前 setup 先连 `/api/push/stream`（全局非 PII），有可信设备 token 时 plan 才加入 `/api/push/stream/me`；字节级解析 SSE 帧，统一转 `push-event`，并把 high/urgent 私有事件交给 `notify.rs` 规划 OS 通知 | `main.rs` → `spawn_default_shell_sse_workers` | `push-event`、`sse-status`（`connecting/open/retrying/closed`）、`system-notification` | `sse.rs`、`sse_worker.rs`、`notify.rs` |
| **提醒/通知轮询** | 60s tick 拉 `/api/reminders/due` + `/api/notifications?status=unread`，severity high/urgent → OS toast，本地 dedup（`known_reminders`/`known_notifications`，按 `id:updated_at` 去重，无 id 则跳过) | `lib.rs:72` `reminders::spawn` | `reminder`、`notification` + OS 通知 | `reminders.rs:13/28/105` |
| **spec_watch（按需）** | 监视 `{sync_root}/{slug}/{code}/spec/` 文件夹，文件落定后 sha256 去重、稳定性快照、分片上传为附件；append-only（本地删不删远端） | `start_spec_watcher` 命令（`submitter.rs:553`）→ `spec_watch::start`（`spec_watch.rs:122`） | `upload-progress`（pending/chunk/done/error） | `spec_watch.rs` 全文 |

> **共享配置铁律**：当前 WorkHub 已有启动期配置加载：Tauri Config `workhub-shell-config.json` + `WORKHUB_SERVER_URL` / `WORKHUB_DEVICE_NAME` / `WORKHUB_CLIENT_TOKEN` / legacy `YQGL_CLIENT_TOKEN` 环境变量。SSE worker 只在有可信 token 时连 `/me`，避免无 token 误打私有流。后续设备注册/设置落地后，后台 worker 与命令必须共享同一个可变配置状态，并在 token 更新后 restart 私有 SSE；历史 bug 是 worker 持快照副本，导致 `register_device` 写入的 `client_token` 对 SSE/reminders 不可见→鉴权头空、通知静默。

### 3.2 平台集成

| 能力 | 职责 | 锚点 |
|---|---|---|
| **托盘** | 基础菜单 + 左键聚焦 + 主窗/桌宠显隐 + 收件箱入口 + 退出；动态 tooltip 未读/审批计数待补 | `client-tauri/src-tauri/src/tray.rs`、`main.rs`（§2.3） |
| **deep-link** | `workhub://open/{kind}/{id}` / `workhub://open?route=/safe/path` / 兼容 `yqgl://{host}/...` → 校验白名单 target、清洗 traversal / encoded slash / 外链 → `emit("navigate")` + `emit("deep-link")` | `deep_link.rs`、`main.rs`、`tauri.conf.json` |
| **单实例** | 第二次启动 → 聚焦已有主窗 + 把 argv 里的 `workhub://` / `yqgl://` 转 deep-link plan；非法 WorkHub 协议 URL 保留诊断但不执行 | `single_instance.rs`、`main.rs`、`tauri-plugin-single-instance` |
| **窗口装饰** | Mica/Acrylic/vibrancy + 延迟 show | `window.rs`（§2.1） |
| **窗口状态记忆** | 位置/尺寸持久化 | `tauri_plugin_window_state`（`lib.rs:50`） |
| **OS 通知** | `tauri-plugin-notification` 系统 toast；只对 high/urgent 私有事件触发，先发 `system-notification` plan，再按权限展示 OS 通知 | `client-tauri/src-tauri/src/notify.rs`、`sse_worker.rs`、`main.rs` |
| **进程控制** | 退出/relaunch（自动更新重启用） | `tauri_plugin_process`（`lib.rs:51`） |
| **自启动** | 开机自启（**已声明依赖但未在 `lib.rs` 注册**——latent，WorkHub 待接线） | `Cargo.toml:23` `tauri-plugin-autostart`（未 `.plugin(...)`） |

### 3.3 命令分组（被 webview `invoke`）

全部注册于 `lib.rs:84-135` 的 `invoke_handler!`。按域分组（见 §4 详表）：

- **auth**：`identify` / `me` / `validate_device` / `register_device`（`commands/auth.rs`）
- **requirements（接活侧）**：`list_my` / `list_public_pool` / `get_requirement` / `claim` / `patch_status`（`commands/requirements.rs`）
- **workspace（个人工作面=Branch 雏形）**：`list_workspaces` / `patch_my_workspace` / `add_workspace_item` / `patch_workspace_item` / `add_workspace_update`（`commands/workspace.rs`）
- **submitter（派活侧 + 文件 + 管理）**：`list_my_projects` / `create_requirement` / `patch_planning` / `put_assignees` / `submit_requirement` / `finalize_and_submit` / `accept_requirement` / `request_revision` / `auto_process` / `chat_messages` / `post_chat_answer` / 网盘 / spec 监视 / 交付下载 / admin（`commands/submitter.rs`）
- **sync**：`trigger_sync`（单需求文件） / `trigger_drive_sync`（项目网盘）（`commands/sync.rs`）
- **delivery**：`start_delivery`（打包文件夹 → 分片上传）（`commands/delivery.rs`）
- **config/shell/tray**：当前 WorkHub 已落 `show_main_window` / `hide_main_window` / `focus_main_route` / `show_pet_window` / `hide_pet_window` / `toggle_pet_window` 和基础 tray menu；旧/目标命令还包括 `get_config` / `set_config` / `set_availability_status` / `test_server` / `open_folder` / `update_tray_unread`

### 3.4 安全护栏（Rust 侧，迁移期原样保留）

- **路径containment**：所有写盘命令把目标限定在 `sync_root` 内（`ensure_dir_inside_root`/`ensure_parent_inside_root`，`sync.rs:596/635`；`start_delivery` 也补了这道，`delivery.rs:38`）；`safe_component`/`safe_relative_path` 拒绝 `..`/`:`/分隔符（`sync.rs:767/787`）。
- **off-server 下载拒绝**：`resolve_server_url_base`（`sync.rs:498`）确保 download_url 同 scheme/host/port，否则拒绝。
- **原子文件替换**：下载/交付写 `.tmp` 再 rename，保留 backup，拒绝覆盖符号链接/目录（`replace_file_preserving_existing`，`sync.rs:648`）；config 用 `MoveFileExW(WRITE_THROUGH)` 原子替换（`config.rs:411`）。
- **操作互斥锁**：同一 req/project 的同步/上传/交付串行化（`RequirementOpGuard`/`ProjectDriveOpGuard`，`operation_locks.rs`）——避免双击撞车。
- **校验完整性**：下载校 size + sha256，不符删除（`sync.rs:171/181`、`submitter.rs:704/712`）。
- **picker 路径不 containment 的理由**：`upload_drive_item`/`upload_attachment` 的 `file_path` 来自原生 picker，是任意用户文件；防 XSS 伪造路径靠 CSP `script-src 'self'` + 零 `dangerouslySetInnerHTML`（`submitter.rs:371` 注释）。

> **WorkHub 演进**：上述护栏**全部保留**。双向同步（`sync.rs:227` 现单向）复用 `spec_watch` 的 sha256 去重 + append-only 思路，上传走 `sync-push`（`api-contract.md §2.13`），冲突回 `conflicts[]` 由 AI 调解、人择一，详见 [`../03-collaboration/sync-and-spec.md`](../03-collaboration/sync-and-spec.md)。

---

## 4. webview↔Rust IPC 契约

IPC 双向：**webview → Rust** 走 `invoke(cmd, args)`（`lib/tauri.ts:11`）；**Rust → webview** 走 `app.emit(event, payload)` + webview `useEvent(event, handler)`（`lib/tauri.ts:41`）。两者都有 dev/mock 降级（非 Tauri 环境 invoke 抛错、listen 返回 no-op；`__YQGL_MOCK_INVOKE__`/`__YQGL_MOCK_LISTEN__` 供 E2E）。

**关键设计**：业务读写**不全走 invoke**——直连 daemon 的 HTTP 走 `clientFetch`/`clientJson`（`lib/tauri.ts:111/144`），它在 Tauri 内**前缀配置的 `server_url`**（webview origin 是 `tauri://localhost`，裸 `/api` 会 404）并**注入令牌头 + credentials**。invoke 命令主要用于：① Rust 独占能力（文件/托盘/spec_watch/同步/打包）；② 需要 Rust 持有 cookie jar 的鉴权动作（identify/register_device）。

### 4.1 invoke 命令表（webview → Rust，全量）

> 参数名为 Tauri 自动 camelCase 转换后的 JS 侧名（`req_id`→`reqId` 等由 Tauri 处理；下表给 Rust 签名内部名）。返回除注明外为 `serde_json::Value`（透传 daemon 响应，前端按 `@yqgl/shared` 类型消费）。

| 命令 | 入参 | 出参 | 副作用 / 设备门 | 锚点 |
|---|---|---|---|---|
| `get_config` | — | `Config`（含 `server_url/nickname/client_token/sync_root/...`） | 读 ConfigState | `commands/config.rs:8` |
| `set_config` | `patch: Value` | `Config` | 校验+写盘；改 endpoint/身份清 dedup 态 | `commands/config.rs:57` |
| `set_availability_status` | `status, availability_text?` | `Config` | PUT `/api/users/me/status` + 写盘 | `commands/config.rs:211` |
| `test_server` | — | `{ok, status}` | GET `/api/health`（不带令牌） | `commands/config.rs:220` |
| `identify` | `nickname, admin_secret?` | `Identity{id,nickname,created,is_admin}` | POST `/api/auth/identify`（签 cookie 入 jar） | `commands/auth.rs:18` |
| `me` | — | `Identity?` | GET `/api/auth/me`（401→None，区分登出与坏响应） | `commands/auth.rs:45` |
| `validate_device` | — | `bool` | GET `/api/client-devices/current`（401/403→false） | `commands/auth.rs:77` |
| `register_device` | `device_name` | `DeviceToken{token,device_id}` | POST `/api/client-devices/register` + 持久化令牌 | `commands/auth.rs:94` |
| `list_my` | `assigned_to_me?, mine?` | 工单数组 | GET `/api/requirements?...` | `commands/requirements.rs:8` |
| `list_public_pool` | — | 工单数组 | GET `?status=ready` | `commands/requirements.rs:30` |
| `get_requirement` | `req_id` | 工单 | GET `/api/requirements/{id}` | `commands/requirements.rs:42` |
| `claim` | `req_id` | 工单 | POST `/claim` **【设备门】** | `commands/requirements.rs:57` |
| `patch_status` | `req_id, status` | 工单 | PATCH `/status`（worker 跃迁**【设备门】**） | `commands/requirements.rs:69` |
| `list_workspaces` | `req_id` | 工作面数组 | GET `/workspaces` | `commands/workspace.rs:7` |
| `patch_my_workspace` | `req_id, patch` | 工作面 | PATCH `/workspaces/me` | `commands/workspace.rs:22` |
| `add_workspace_item` | `req_id, title` | item | POST `/workspaces/me/items` | `commands/workspace.rs:39` |
| `patch_workspace_item` | `item_id, patch` | item | PATCH `/workspace-items/{id}` | `commands/workspace.rs:59` |
| `add_workspace_update` | `req_id, body` | update | POST `/workspaces/me/updates` | `commands/workspace.rs:76` |
| `list_my_projects` | — | 项目数组 | GET `/api/projects?state=active` | `commands/submitter.rs:43` |
| `list_users` | `search?` | 用户数组 | GET `/api/users?search=` | `commands/submitter.rs:55` |
| `create_requirement` | `project_id, body` | 工单 | POST `.../requirements` | `commands/submitter.rs:76` |
| `patch_planning` | `req_id, body` | 工单 | PATCH `/planning` | `commands/submitter.rs:93` |
| `patch_schedule` | `req_id, body` | 工单 | PATCH `/schedule` | `commands/submitter.rs:110` |
| `put_assignees` | `req_id, lead_user_id?, collaborator_user_ids[]` | 指派数组 | PUT `/assignees` | `commands/submitter.rs:127` |
| `submit_requirement` | `req_id` | 工单 | POST `/submit` + **停 spec 监视** | `commands/submitter.rs:148` |
| `finalize_and_submit` | `req_id, summary_md?, title?` | 工单 | finalize-summary + submit + 停监视 | `commands/submitter.rs:169` |
| `accept_requirement` | `req_id, note?` | 结果 | POST `/accept`（采纳/通过）**【设备门】** | `commands/submitter.rs:451` |
| `request_revision` | `req_id, reason_md` | 结果 | POST `/revisions`（**打回带理由**） | `commands/submitter.rs:729` |
| `auto_process` | `req_id` | 结果 | POST `/auto-process`（触发 AI 工人）+ 停监视 | `commands/submitter.rs:292` |
| `chat_messages` | `req_id` | 消息数组 | GET `/chat/messages` | `commands/submitter.rs:260` |
| `post_chat_answer` | `req_id, body` | 结果 | POST `/chat/answer` | `commands/submitter.rs:275` |
| `list_attachments` | `req_id` | 附件数组 | GET `/attachments` | `commands/submitter.rs:467` |
| `upload_attachment` | `req_id, file_path, op_id?` | 附件 | 分片上传**【op 锁】** → `upload-progress` | `commands/submitter.rs:486` |
| `download_delivery` | `req_id, delivery_id?` | `{delivery_id,round,saved_path}` | 校验+落盘交付 zip**【op 锁】** | `commands/submitter.rs:603` |
| `list_drive_root` | `project_id` | 网盘树 | GET `.../drive` | `commands/submitter.rs:356` |
| `upload_drive_item` | `project_id, file_path, op_id?` | 网盘项 | 分片上传**【op 锁】** → `drive-upload-progress` | `commands/submitter.rs:379` |
| `trigger_sync` | `req_id` | — | 拉 manifest + 下载文件 + ack**【op 锁】** → `sync-progress` | `commands/sync.rs:8` |
| `trigger_drive_sync` | `project_id, op_id?` | — | 单向下载网盘**【op 锁,需开启同步】** → `drive-sync-progress` | `commands/sync.rs:23` |
| `start_delivery` | `req_id, folder` | — | 打包文件夹+上传**【op 锁,sync_root 内】** → `delivery-progress` | `commands/delivery.rs:10` |
| `start_spec_watcher` | `req_id` | 文件夹路径 | 启动 spec 监视 | `commands/submitter.rs:553` |
| `stop_spec_watcher` | `req_id` | — | 停监视 | `commands/submitter.rs:564` |
| `spec_watcher_status` | `req_id` | `bool` | 查监视中 | `commands/submitter.rs:569` |
| `open_spec_folder` | `req_id` | — | 在文件管理器打开 spec 文件夹 | `commands/submitter.rs:574` |
| `open_folder` | `path` | — | 打开本地文件夹 | `commands/shell.rs` |
| `create_project`/`delete_project`/`delete_requirement`/`set_user_admin`/`delete_user` | — | — | 管理动作 | `commands/submitter.rs` |
| `update_tray_unread` | `count` | — | 改托盘 tooltip/title | `commands/submitter.rs:242` |

**WorkHub 新增命令（建议，对齐 §6.4 / api-contract）**：`open_session`（开桌宠对话 session，`api-contract.md §2.3`）、`send_session_message`、`respond_approval`（回审批 allow/deny+理由，`§2.8`）、`abort_agent_run`、`check_update`/`install_update`（自动更新，§7）。桌宠窗显隐已用 `show_pet_window` / `hide_pet_window` / `toggle_pet_window` 注册到当前 `main.rs`。新命令一律遵循 §3.1 共享 ConfigState 与 §3.4 护栏。

### 4.2 事件订阅表（Rust → webview，全量）

webview 用 `useEvent(name, handler)` 订阅。事件由 Rust `app.emit(name, payload)` 广播到所有窗口。

| 事件 | payload | 发射方 | webview 消费处 | 锚点 |
|---|---|---|---|---|
| `push-event` | `ShellPushEventPayload {event,data,stream_kind,stream_path}`（包裹后端 SSE 帧：`requirement.ready`/`requirement.updated`/`notification.created`/`ai.*` 等） | `sse_worker.rs` pump + `sse.rs` parser | `desktop-cuu-runtime.ts`、各页 reconcile | `sse.rs`、`sse_worker.rs` |
| `sse-status` | `ShellSseStatusPayload {stream_kind,stream_path,state,message?}`，state=`connecting/open/retrying/closed` | `sse_worker.rs` | `shell-events.ts` → Cuu offline card；TitleBar 后续可接 | `sse_worker.rs`、`shell-events.ts` |
| `navigate` | 当前 WorkHub 为 route string；webview 也接受 `{route}` / `{path}`，并拒绝外链、`..`、反斜杠和换行 | `main.rs` window control、deep-link、未来 OS notification click source | `browser.ts` 切换 Gold Path 面板；未知安全路由暂不强行渲染 | `apps/desktop-webview/src/browser.ts`、`apps/desktop-webview/src/shell-events.ts` |
| `deep-link` | `ShellDeepLinkPlan {rawUrl,scheme,route,windowControl}` | `main.rs` + `deep_link.rs` | （可选）页内深链处理；`navigate` 已负责主窗跳转 | `client-tauri/src-tauri/src/deep_link.rs` |
| `single-instance` | `ShellSingleInstancePlan {args,cwd,windowControl,deepLinks,rejectedDeepLinks}` | `main.rs` + `single_instance.rs` + `tauri-plugin-single-instance` | 诊断、后续通知点击/协议唤起排查；真实导航仍走 `navigate` / `deep-link` | `client-tauri/src-tauri/src/single_instance.rs` |
| `tray-action` | 当前 WorkHub 为 `TrayMenuActionPlan {id,label,kind,windowControl,exitsApp}`；旧/目标动态菜单可扩展 `{action: pull_new\|sync_drive\|do_deliver\|availability_*}` | `main.rs` tray handler + `tray.rs` contract | Cuu/主窗可用于 toast、导航和状态同步 | `client-tauri/src-tauri/src/tray.rs` |
| `system-notification` | `ShellSystemNotificationPlan {id,event,title,body,urgency,route,windowControl,streamKind,streamPath}`；只由 high/urgent 私有 SSE 事件生成 | `sse_worker.rs` + `notify.rs` | Cuu/主窗可用于 badge、通知历史、点击跳转与偏好拦截；OS toast 由 Rust 同步尝试展示 | `client-tauri/src-tauri/src/notify.rs` |
| `availability-change` | `{status, availability_text}` | `tray.rs:162` | 接单状态 UI 同步 | `tray.rs` |
| `reminder` | `{kind, title, requirement_id}` | `reminders.rs:82` | 提醒 UI | `reminders.rs` |
| `notification` | 通知对象 | `reminders.rs:148` | Inbox/角标 | `reminders.rs` |
| `upload-progress` | `{req_id, op_id?, phase, sent, total}` | `upload.rs:413`、`spec_watch.rs:345` | TaskDetail / spec 投放面板进度条 | `upload.rs` |
| `drive-upload-progress` | 同上结构 | `upload.rs`（经 `upload_drive_item`） | 网盘上传进度 | `submitter.rs:441` |
| `sync-progress` | `{req_id, phase, percent, message?}` | `sync.rs:216` | TaskDetail 同步进度 | `sync.rs:60` |
| `drive-sync-progress` | `{project_id, op_id?, phase, percent}` | `sync.rs:276/345/353` | 网盘同步进度 | `sync.rs` |
| `delivery-progress` | `{req_id, ...}`（打包/上传阶段） | `delivery.rs`（经 `upload`） | DeliveryWizard 进度 | `delivery.rs` |

**WorkHub 新增事件（建议）**：`agent-run-step`（对外化 `ai.*` trace）、`confidence-assessed`（人话档位，不暴露数值）、`escalation-created`（升级简报，点亮桌宠红点）、`permission-ask`（审批询问 → 桌宠/Inbox 卡片）、`proposal-*`/`conflict-detected`。这些与 daemon 的 SSE 事件（`api-contract.md §5.2`）一一对应，Rust 侧仍走 `sse.rs` 统一转 `push-event`（无需新 Tauri 事件名，按 `data.event` 分发即可）——保持现有「单一 `push-event` 入口」的简洁。

> **状态获取双通道（铁律，沿用 [`api-contract.md §7`](../01-architecture/api-contract.md)）**：**REST 拉取为真相，SSE/事件为增量提示**。SSE 会丢（背压队列满则丢，`push_bus` 侧）；webview 收到 `push-event` 后**按需重拉**对应资源 reconcile（如 `SidebarDispatch.tsx:74` 收 `requirement.updated` 后 `loadCounts()`），不把事件当唯一数据源。

---

## 5. 桌宠人格 / 状态 / 动效

> 桌宠是 WorkHub 「AI 是默认劳动力」的**拟人化入口**：它替你干活（工人模式），卡住了替你找人（PM 模式），全程说人话（[glossary §3](../00-overview/glossary-dejargon.md)）。**人格不进 git 黑话**——桌宠永远说「AI 拟好了，确认?」而非 `merge`/`PR`。

**形象基线**：WorkHub 桌宠默认命名为 **Cuu**，是一只橘色卡通小猫桌宠，而不是抽象状态符号。Cuu 的角色设定、概念图、动效状态表与交互原则见 [`cuu-desktop-pet-concept.md`](./cuu-desktop-pet-concept.md)。本篇的状态机与窗口/IPC 规格以 Cuu 为默认实现对象展开；后续如新增皮肤，也不得改变「一次只处理一件事、选项优先、证据可展开、可爱但可靠」这些交互原则。

### 5.1 人格基调

- **定位**：能干、克制、会请示。默认闷头干活，只在三种时刻主动出声：① 做好了请你扫一眼 / 采纳；② 拿不准请你拍板（审批/升级）；③ 你打回了它接着改（理由回灌）。
- **文案口径**：严格走 [glossary §3](../00-overview/glossary-dejargon.md) 三档语气——「我比较有把握 / 我大致有谱，建议你扫一眼 / 我不太确定，想请你拍板」；**绝不显示置信度数值或 `escalation`/`merge` 等内部词**（落地 §1.2 硬规则、`auto_agent.py` 的「user's language」约定）。
- **去打扰**：当前 Rust `notify.rs` 只允许私有流的 high/urgent 事件触发 OS 通知，global stream 与 normal notice 不打断；`ShellSystemNotificationDeduper` 已按 `id/event/route` 做进程内去重；后续补持久化去重、勿扰偏好与 click-through。「永远允许」学习（`api-contract.md §2.8` `remember:always`）让桌宠「以后这类不用再问」。

### 5.2 桌宠状态机（视觉态，映射真实事件）

> 桌宠的视觉态由 `push-event` 流驱动。状态枚举与用户标签**复用** `shared/src/design/status-vocab.ts`（[glossary §7](../00-overview/glossary-dejargon.md)），不另造一套。

| 桌宠态 | 触发（事件/状态） | 视觉 | 动效 | 文案示例 |
|---|---|---|---|---|
| **空闲** | 无活跃工单 | 静态头像，偶尔眨眼 | 轻微呼吸缩放 | 「在的，随时叫我」 |
| **干活中** | `ai.started`/`ai.thinking`/`ai.tool_call`；状态 `ai_processing` | 头像旁转圈 + 工具图标闪 | 旋转 loader（呼应 `AILiveView.tsx:42` 的 `animate-spin`） | 「AI 在帮你做…（第 N 步）」 |
| **做好了等确认** | 状态 `delivered`；`delivery.doc_ready` | 头像带 ✓ 角标，accent 色 | 弹一下 + 高亮 | 「做好了，扫一眼？通过 / 打回」 |
| **请你拍板** | `permission-ask`/`confidence-assessed`(低档) | 头像带 ? 角标，warn 色 | 脉动红点 | 「这步我拿不准，要继续吗？」 |
| **请人来接手** | `escalation-created`；状态 `escalated`/`pm_mode` | 头像带「找人」角标 | 脉动 | 「这个我请人来接手了，简报在这」 |
| **被打回·接着改** | 状态 `revision_requested`→续做 | 头像「重做」角标，error→accent | 渐变回干活态 | 「按你说的原因，我接着改」 |
| **撞车了** | `conflict-detected` | 头像「撞车」角标 | 抖动一次 | 「和别人的改动撞车了，AI 给了方案，你选一个」 |
| **离线/连不上** | `sse-status:disconnected` 持续 | 头像灰、半透明 | 无 | 「和服务器断开了，重连中…」 |

- **现状锚点**：今天 `AILiveView.tsx` 已把 `ai.started/thinking/text/tool_call/done/failed` 渲染成实时进度行（带 spinner/扳手/勾/警告图标）；`TitleBar.tsx:26` 用 `sseConnected` 绿点表达连接态。桌宠状态机 = 把这套「事件→视觉」的映射**收口到一个拟人形象**。

### 5.3 动效与实现约束

- **承载**：P1 用绿幕生图后的 PNG/WebP sprite atlas；CSS procedural sprite 只能用于开发占位。P2 可接 Rive state machine，P3/P4 再评估 Live2D。
- **性能**：桌宠窗 always-on-top 但极小、`skipTaskbar`；空闲态降帧/暂停动画避免占 GPU；连接断开停转圈。
- **可达性**：所有角标有 `aria-label`/`title`（沿用 `TitleBar`/`AILiveView` 的 `aria-hidden` + 文本并存做法）。
- **MVP 修正**：早期主窗浮层只用于验证业务卡片，不再作为桌宠体验验收。桌宠里程碑必须证明 Cuu 在独立 `pet` window 中右下角常驻，主窗隐藏后仍会动、会提醒、可拖动。

---

## 6. webview 页面规划（逐页）

### 6.0 路由总表 + 信息架构

路由在 `App.tsx:308-324`（react-router v6 扁平路由，避开嵌套 `<Routes>` 重匹配坑）。**主壳 = `TitleBar`(顶) + `Sidebar`(左) + `<Routes>`(主区) + `FloatingAssistant`(右下桌宠浮层)**（`App.tsx:287-332`）。未完成 onboarding 时**只有** `/onboarding` 可达（`App.tsx:296`，其余 `Navigate→/onboarding`）。

| 路由 | 页面组件 | Space 相关 | 设备门 | 锚点 | 本篇小节 |
|---|---|---|---|---|---|
| `/onboarding` | `Onboarding` | — | 建立设备门 | `routes/Onboarding.tsx` | §6.1 |
| `/` | `HubRouter`→`Hub`(接活)/`HubDispatch`(派活) | **双 Space** | 接活动作需 | `App.tsx:89`、`routes/Hub.tsx`/`HubDispatch.tsx` | §6.2 |
| `/r/new` | `NewRequirement` | 派活 | — | `routes/NewRequirement.tsx` | §6.2 |
| `/r/:id` | `TaskDetail` | 两侧 | 接活/交付需 | `routes/TaskDetail.tsx` | §6.3 |
| `/r/:id/clarify` | `Clarify` | 派活 | — | `routes/Clarify.tsx` | §6.4 |
| `/p` `/p/:projectId` | `ProjectDrive` | 派活为主 | 上传/同步需 | `routes/ProjectDrive.tsx` | §6.7 |
| `/p/:projectId/meetings` | `ProjectMeetings` | 派活 | — | `routes/ProjectMeetings.tsx` | §6.7 |
| `/inbox` | `Inbox` | 两侧 | — | `routes/Inbox.tsx` | §6.6 |
| `/settings` | `Settings` | 两侧 | — | `routes/Settings.tsx` | §6.8 |
| `/me/workload` | `MyWorkload` | 接活 | — | `routes/MyWorkload.tsx` | §6.7 |
| `/me/knowledge` | `Knowledge` | 接活 | — | `routes/Knowledge.tsx` | §6.7 |
| `/me/pulse` | `ProjectPulse` | 两侧 | — | `routes/ProjectPulse.tsx` | §6.7 |
| `/me/calendar` | `Calendar` | 接活 | — | `routes/Calendar.tsx` | §6.7 |

**双 Space 切换**（C-PET 特有信息架构，`App.tsx:89` `HubRouter` + `useSpace`）：同一 `/` 路由按 `space` 渲染「接活（work）」或「派活（dispatch）」两套侧栏+主区——URL 不变，内容切换。快捷键 `Ctrl+1`=接活 / `Ctrl+2`=派活（`App.tsx:112-122`，输入框内不拦截）；顶栏 `SpaceSwitcher` 药丸切换。侧栏分别是 `SidebarWork`（公共池/派给我的/进行中/待返工/近期交付 + 视角）与 `SidebarDispatch`（起草/待澄清/投递池/跟进中/待我验收/已通过 + 项目）。

> **与 Web 端差异**：C-WEB 信息架构同源但**砍掉接活侧的设备门动作**（claim/交付/同步按钮在 Web 上禁用或引导「请在桌面客户端操作」）。逐页差异在各小节「web↔桌宠差异」标注；Web 端完整规划见 [`./web-app.md`](./web-app.md)。

---

### 6.1 安装引导（Onboarding，4 步）

> 锚点 `routes/Onboarding.tsx`。**这是设备令牌门的建立现场**——走完才拿到 `client_token`，才能接活/干活/同步。

**布局**（无侧栏，居中卡片 + Stepper）：
```
┌──────────────── 主窗（TitleBar 仍在顶部）────────────────┐
│                  ✦  欢迎来到需求管理大师                   │
│              4 步把客户端连上服务器，开始接单              │
│   [① 服务地址]——[② 我是谁]——[③ 文件放哪]——[④ 完成]      │ ← Stepper
│  ┌────────────────────────────────────────────────────┐ │
│  │  当前步骤内容（min-h 280）                            │ │
│  └────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```
- **① 服务地址**：IP + 端口输入 → 「测试连接」(`invoke test_server` → GET `/api/health`)。成功显「✓ 服务器可达」，失败显「✗ 连不上，检查 IP/端口/防火墙」。**「下一步」按钮 disabled 直到 `serverVerified`**（`Onboarding.tsx:49`，且 endpoint 改动会 `invalidateEndpoint` 失效校验）。
- **② 我是谁**：昵称 + 管理员口令（可空）→ `invoke identify` + `set_config{nickname,cookie_token:"session"}` + **`register_device`**（拿令牌）。昵称占用提示「请用已有设备登录或联系管理员」。
- **③ 文件放哪**：本地工作目录（默认 `D:\工作需求`）+ 网盘同步模式（关 / 仅下载；**双向标注「保护性内测」未开放**，`Onboarding.tsx:280`）→ `set_config{sync_root,drive_sync_root,drive_sync_mode,drive_sync_enabled}`。
- **④ 完成**：勾选清单（已连接 / 已注册设备 / 工作目录 / 网盘同步模式）→「打开主窗口 →」调 `onComplete`（`App.tsx:260` `finishOnboarding`：`resetClientTokenCache` + 重读 config + `nav("/")`）。

**四态**：
- **加载**：每步按钮 `loading={busy}`，`busyRef` 防双击重入（`Onboarding.tsx:86`）。
- **空**：fresh install 无预填（`get_config` catch 静默，`Onboarding.tsx:78`）。
- **错误**：每步 try/catch → `toast(error)`；**关键修复**：`set_config` 失败**不**前进（旧 bug 会带坏配置进 Hub 致全 IPC 401，`Onboarding.tsx:171` 注释）。
- **无权限**：昵称是 admin 但无口令 → identify 抛错 → toast「登录失败」。

**跳转流**：完成 → `/`。**web↔桌宠差异**：Onboarding 是 **C-PET 独有**——C-WEB 用 cookie 即身份，无设备注册步骤；故只有桌宠能走完「拿令牌」这步，这正是设备门的物理体现。

---

### 6.2 工作台 / 大厅（Hub，接活 ↔ 派活）

> 同一 `/` 路由，`HubRouter`（`App.tsx:89`）按 Space 二选一。

**布局（通用骨架）**：
```
┌─ TitleBar：[SpaceSwitcher ●SSE点]      [主题][－][▢][✕→hide] ─┐
├──────────┬───────────────────────────────────────────────────┤
│ Sidebar  │  主区：工单分组列表（按 ?tab=/?dtab= 切分组）        │
│ (Work或   │   ┌─ TaskCard ─┐ ┌─ TaskCard ─┐ ...               │
│  Dispatch)│   │ code 标题   │ │            │                   │
│  分组导航 │   │ 状态徽章    │ │            │                   │
│  +视角/项目│   │ 负责人/DDL  │ │            │                   │
│          │   └────────────┘ └────────────┘                   │
├──────────┴───────────────────────────────────────────────────┤
│                                          [✦ 桌宠浮层(右下)]    │
└───────────────────────────────────────────────────────────────┘
```

**接活 Space（`SidebarWork` + `Hub`）**：
- 侧栏分组（`SidebarWork.tsx:19`）：公共池(`?tab=public`)/派给我的/进行中/待返工/近期交付；视角：我的负载/日程/历史检索/项目快报；底部：通知/设置。**激活态按 `tab` 值判断**（pathname 全是 `/`，`SidebarWork.tsx:43`）。
- 主区：工单卡列表（`TaskCard`），公共池里点卡 → 详情可「接单」(`claim`【设备门】)。
- 数据：`invoke list_public_pool` / `list_my{assigned_to_me}`。

**派活 Space（`SidebarDispatch` + `HubDispatch`）**：
- 侧栏分组（`SidebarDispatch.tsx:32`）：起草/待澄清/投递池/跟进中/**待我验收**(emphasize,珊瑚渐变角标)/已通过；顶部「+ 新建需求」→`/r/new`；项目入口。
- **角标实时**：侧栏**自取数据**（`list_my{mine}`）并 `useEvent("push-event")` 收 `requirement.updated/ready` 后 `loadCounts()`——**即使不在该页**，「待我验收」数也实时反映（`SidebarDispatch.tsx:74`）。

**四态**（列表通用）：
- **加载**：骨架/「加载中」。
- **空**：分组无工单 → 空提示（如「公共池暂时没有可接的活」）。
- **错误**：`clientJson` 4xx/5xx 抛错 → 页内错误条（`lib/tauri.ts:144` 注释强调用 `clientJson` 防 `setItems(error_body)` 崩树）。
- **无权限**：接活动作（claim）在无设备门时后端 403 → toast「这个操作要在桌面客户端里做」（C-PET 本身有门，故主要发生在 C-WEB）。

**关键交互/跳转**：托盘「立即拉新需求」→ `tray-action{pull_new}` → `App.tsx:179` toast + `nav("/inbox")`；「完成并交付」→ `setSpace("work")` + `nav("/?tab=mine")`（`App.tsx:187`）。点工单卡 → `/r/:id`。

**web↔桌宠差异**：双 Space + `Ctrl+1/2` 快捷键 + 托盘联动是 C-PET 体验；C-WEB 同样有派活/接活视图但接活侧动作受限（设备门）。

---

### 6.3 工单详情（TaskDetail）

> 锚点 `routes/TaskDetail.tsx`。接活/派活双方的工单工作面，**AI 实时进度 + 交付 + 同步**的主舞台。

**布局**：
```
┌─ 顶部：← 返回  code/标题  [状态徽章]  [操作区按角色变] ─────────┐
├───────────────────────────────┬───────────────────────────────┤
│ 主区（左）                     │ 面板（右）                     │
│  · 需求说明页(SpecDoc/summary) │  · 验收标准清单                │
│  · 附件列表 / spec 投放入口    │  · 个人工作面(workspace=Branch) │
│  · AILiveView（status=        │  · 交付历史（按 round）         │
│    ai_processing 时挂载）      │  · 同步/下载进度面板            │
│  · 交付包 / 评论                │                               │
└───────────────────────────────┴───────────────────────────────┘
```

**关键组件 + 数据/API**：
- **AILiveView**（`components/AILiveView.tsx`）：mount 于 `status==="ai_processing"`，渲染 `req:<id>` topic 的 `ai.*` 事件（started/thinking/text/tool_call/done/failed），逐行带时间戳+图标。这是「AI 都做了哪些步骤」（[glossary §3.2](../00-overview/glossary-dejargon.md) trace 人话）。
- **接活动作**：`claim`【设备门】→ `patch_status`(doing/...)；触发 AI：`auto_process`（POST `/auto-process`，原子 CAS `ready/summary_ready→ai_processing`，`api-contract.md §2.6`）。
- **交付（DeliveryWizard）**：选文件夹 → `start_delivery`（打包 zip + 分片上传，`delivery.rs`）→ `delivery-progress` 事件驱动进度；或 `upload_attachment` 传单文件。
- **同步**：`trigger_sync`（拉本工单 manifest + 下载附件，`sync.rs:68`）→ `sync-progress`。
- **审阅（派活侧）**：由 `components/ActionRailDispatch.tsx` 承载（验收/打回是显眼的 hero 卡片，`ActionRailDispatch.tsx:32` 头注 + `:206` hero banner「交付来了，等你验收」）：`accept_requirement`（通过/采纳，`ActionRailDispatch.tsx:133`，弹「验收通过」Modal 填 note）/ `request_revision`（**打回必带 `reason_md`**，`ActionRailDispatch.tsx:151` → 后端 `submitter.rs:729`，弹「打回返工」Modal 填理由）。理由**回灌**给 AI 续做（`api-contract.md §2.5`，`FR-ESC-003`）。
- **个人工作面**：`list_workspaces`/`patch_my_workspace`/`add_workspace_item`/...（`commands/workspace.rs`）——这是 Branch（[glossary §4 易混词](../00-overview/glossary-dejargon.md)：`RequirementWorkspace` = WorkHub「工作分支」雏形）。

**SSE 实时订阅**：`useEvent("push-event")` 过滤 `req:<id>`/本工单的 `ai.*`、`requirement.updated`、`comment.added`、`delivery.doc_ready`；收到后 reconcile（重拉详情）。`useEvent` 用 `handlerRef` 保证 `id`/`refresh` 闭包不陈旧（`lib/tauri.ts:46` 注释，TaskDetail 切换工单的真实坑）。

**四态**：
- **加载**：`get_requirement` 期间骨架。
- **空**：无附件/无交付/无评论各自空提示。
- **错误**：详情 404/403 → 错误页；同步/交付失败 → 进度面板 error 态（Rust 侧 `emit ...progress{phase:"error"}`）。
- **无权限**：非可见性门内 → 404；非接活人点交付按钮 → 后端 403。

**WorkHub 新增**：`confidence-assessed`→详情顶部「AI 把握程度」人话条（三档语气，不显数值）；`escalation-created`→「为什么需要人 + 建议谁 + 计划」简报卡（`FR-PM-001`）；`permission-ask`→审批询问卡（allow/deny+理由+「永远允许」）；proposal/conflict 区呈现「提交确认/撞车了选方案」。

**web↔桌宠差异**：接活、触发 AI、交付、同步按钮在 C-PET 可用（设备门）；C-WEB 上这些禁用并提示去桌面端。AILiveView/审阅两端一致。

---

### 6.4 对话（澄清 Clarify + 桌宠对话 FloatingAssistant + 升级简报）

C-PET 有**三种对话面**，都走 SSE 流式（`thinking/text/parsed/error/done` 帧）：

**(a) 澄清对话（Clarify，`routes/Clarify.tsx`）**——派活侧，把粗描述澄清成需求说明页：
- 布局：主区聊天流（用户/AI 气泡）+ 底部输入；右侧可呈现「正在成形的需求说明」。
- 数据：`chat_messages`（读历史）+ POST `/chat`（流式，webview 直接 fetch+ReadableStream，`submitter.rs:255` 注释说明流式不走 invoke）+ `post_chat_answer`；完成→`finalize_and_submit`。

**(b) 桌宠对话（FloatingAssistant，`components/FloatingAssistant.tsx`）**——常驻右下，问功能/问项目/提需求：
```
                                   ┌─ AI 助理 ───────────── ✕ ─┐
                                   │ 问功能·问项目·帮你提需求    │
                                   │ ┌────────────────────────┐ │
                                   │ │ (对话流，user右/AI左)    │ │
                                   │ │ AI 草稿 → [新建为需求]   │ │
                                   │ │ 思考中… (spinner+thinking)│ │
                                   │ └────────────────────────┘ │
                                   │ [textarea  Enter发送] [发送]│
                                   └────────────────────────────┘
                                              ✦ ← 收起态气泡(右下)
```
- 数据：POST `/api/assistant/chat`（流式，`FloatingAssistant.tsx:109`），带当前 `project_id`（从 `/p/<id>` 路由提取，grep 接地）；45s 超时（`DEFAULT_ASSISTANT_TIMEOUT_MS`）。
- 关键交互：AI 回 `draft_requirement` 时给「新建为需求」按钮 → `create_requirement` → `nav("/r/:id/clarify")`（`FloatingAssistant.tsx:194`，`creatingRef` 防双击双建）。停止生成：`stopSend` abort。
- **WorkHub 升级**：这就是**桌宠展开态**的内核——再叠加升级简报 + 审批询问。

**(c) 升级简报 / 审批询问（WorkHub 新增）**——桌宠主动出声：
- **升级简报**（`escalation-created`）：卡片呈现「为什么需要人 + 建议谁来做 + 计划」（不暴露 `escalation` 字眼，说「这个我请人来接手了」），对应 `EscalationEvent`（`api-contract.md §2.7`）。
- **审批询问**（`permission-ask`）：卡片「AI 想做 X，允许吗？」→ allow/deny + 可填理由 + 「以后这类不用再问我」（`remember:always`）→ `respond_approval`（POST `/api/approvals/{id}/respond`，`api-contract.md §2.8`）。deny 理由回灌 AI。

**四态**（对话通用）：加载=「思考中…」+ thinking 流（`FloatingAssistant.tsx:276`）；空=引导语（`:255`）；错误=「连接失败/超时」气泡（`:173`，区分 abort/timeout）；无权限=后端拒答时 AI 返回人话理由。

**web↔桌宠差异**：FloatingAssistant 两端都有；桌宠对话在 C-PET 是独立 always-on-top 窗（主窗隐藏仍在），C-WEB 是页内浮层随标签存活。升级简报/审批两端都收（按身份路由），但桌宠用 OS 通知 + 红点更醒目。

---

### 6.5 同步状态（spec 投放 / 网盘同步 / 交付下载）

> C-PET 独有——本地文件同步是桌宠的核心差异能力。没有独立「同步页」，而是**散布在相关页的进度面板 + 托盘入口**，由 Rust worker 发进度事件驱动。

**(a) spec 文件夹投放（spec_watch）**：
- 入口：TaskDetail 在 draft/clarifying/summary_ready 态显「打开 spec 文件夹」(`open_spec_folder`) + 「开始/停止监视」(`start_spec_watcher`/`stop_spec_watcher`，状态 `spec_watcher_status`)。
- 行为：用户把文件丢进 `{sync_root}/{slug}/{code}/spec/` → Rust 监视（debounce 1.5s + 稳定性快照）→ sha256 去重（跳过远端已有）→ 分片上传为附件 → `upload-progress` 事件（pending/chunk/done/error）。**append-only**（本地删不删远端，`spec_watch.rs` 头注）；状态离开可监视态自动停（`spec_watch.rs:487`）。
- 面板：spec 投放区列出 pending/uploading/done 文件，进度条由 `upload-progress` 的 `op_id`（`spec-watch-pending-{gen}-{hash}`）对应。

**(b) 项目网盘同步（单向下载）**：
- 入口：ProjectDrive 页内「同步」按钮 + 托盘「立即同步网盘」(`tray-action{sync_drive}`→`nav("/p")`，`App.tsx:182`)。
- 行为：`trigger_drive_sync`（**需 `drive_sync_enabled && !paused && mode!="off"`**，否则报错；`two_way` 被拒，`commands/sync.rs:37`）→ 拉 `/drive/manifest` → 逐项 sha256 缓存命中跳过、墓碑删本地、流式下载校验 → `drive-sync-progress`。可暂停（托盘 `toggle_pause`，`drive_sync_active` 检查贯穿下载循环可中断，`sync.rs:431`）。
- **现状=单向占位**（`sync.rs:227` 明注）。**WorkHub 演进→双向**：复用 sha256 去重 + append-only，本地改动经 `sync-push` 上传，冲突回 `conflicts[]` AI 调解（[`sync-and-spec.md`](../03-collaboration/sync-and-spec.md)）。

**(c) 交付下载 / 打包**：
- 下载：`download_delivery`（选 round 或最新，校验 size+sha256，落 `{sync_root}/{slug}/{code}/deliveries/round-N.zip`，`submitter.rs:603`）→ 可 `open_folder` 打开。
- 打包上传：`start_delivery`（zip 文件夹排除 `.git/node_modules/...` → 分片上传，`EXCLUDE` 表见 `delivery.rs:17`，含 `.venv/__pycache__/.idea/.vscode`；symlink/越界条目跳过）。

**四态**：加载=进度条 0；空=「还没有可同步的内容」；错误=进度面板 error（size/sha256 不符、off-server URL、同步被暂停/关闭、op 锁占用「正在同步中，请稍候」）；无权限=同步类后端 `require_local_client` 403。

**互斥**：同 req/project 的同步/上传/交付串行（`operation_locks.rs`），重入报人话「正在同步或交付中，请稍候」。

**web↔桌宠差异**：整块同步能力 **C-PET 独有**；C-WEB 无本地文件系统访问，只能在浏览器内下载单文件。

---

### 6.6 通知收件箱（Inbox）

> 锚点 `routes/Inbox.tsx`。

**布局**：单栏列表（通知卡：标题/正文/时间/severity 色 + 「去看看」跳转）。
**数据/API**：`/api/notifications`（列表）+ `/read`/`/read-all`（标记已读，`api-contract.md §2.12`）。通知**按身份私有**（`user:{id}` topic，严禁全局广播，`api-contract.md §5.3`）。
**SSE**：`notification.created`（`App.tsx:238`）→ 入列 + toast + OS 通知 + `refreshUnreadBadge`（更新托盘 tooltip）。
**四态**：加载=骨架；空=「没有新通知」；错误=`clientJson` 错误条；无权限=N/A（只发本人）。
**跳转**：点通知带 `requirement_id` → `/r/:id`；托盘「打开待办收件箱」→`nav("/inbox")`。
**web↔桌宠差异**：C-PET 额外把高优通知弹成 OS 系统通知（窗口最小化也能看到，`App.tsx:226`）+ 托盘未读文案；C-WEB 仅页内。

---

### 6.7 项目网盘 / 会议 / 其余视角页

> 这些页两端信息架构同源，C-PET 仅在「上传/同步」处接 Rust 能力。详细规划归 [`./web-app.md`](./web-app.md) 与对应模块文档；本篇只给桌宠差异锚点。

- **ProjectDrive（`/p`、`/p/:projectId`，`routes/ProjectDrive.tsx`）**：文件树 + 版本 + 回收站 + 操作日志 + 文件夹评论触发 LLM（模块见 [`../04-modules/projects-and-drive.md`](../04-modules/projects-and-drive.md)）。**桌宠差异**：`list_drive_root` 浏览；`upload_drive_item`（picker 选文件 → 分片上传，`conflict:rename` 永不阻塞）→ `drive-upload-progress`；`trigger_drive_sync` 下载到本地。
- **ProjectMeetings（`/p/:projectId/meetings`，`routes/ProjectMeetings.tsx`）**：录音/上传→ASR→纪要→洞察→需求草稿（模块见 [`../04-modules/meetings-and-insights.md`](../04-modules/meetings-and-insights.md)）。两端一致（上传走分片）。
- **MyWorkload / Calendar / Knowledge / ProjectPulse（`/me/*`）**：负载/日程/grep 引用问答/项目快报，纯读视图 + `clientJson`，两端一致。

**四态/SSE**：各页沿用「`clientJson` 防崩 + `push-event` reconcile（如 `drive.changed`/`meeting.ready`）」范式。

---

### 6.8 设置（Settings）

> 锚点 `routes/Settings.tsx`。C-PET 设置比 C-WEB 多「本地目录/同步/服务器地址」。
> **当前 WorkHub 状态**：Rust 已有启动期 `workhub-shell-config.json` + env loader，可让 SSE worker 在有 token 时连接 `/me`；但 webview Settings 写盘、设备注册、secure vault、worker restart 尚未落地。以下旧项目锚点仍作为行为目标。

**布局**：分组卡片，现状真实顺序为 身份+外观 / 接单状态 / 本地目录+网盘同步 / 服务器 / 帮助（重看引导）/ 关于 / 管理（`AdminPanel`，非管理员渲染 `null`，`Settings.tsx:437`）。
**数据/API**：目标 `get_config`/`set_config`（本地配置，`commands/config.rs`）+ `test_server` + `set_availability_status`（PUT `/api/users/me/status`）。当前真实只读入口为 Rust 启动期 `load_shell_config_from_json_and_env`；后续改 endpoint/身份时仍需清 dedup 态和令牌。
**关键交互**：
- 服务器地址/端口 → 目标 `set_config` + `resetClientTokenCache`（`lib/tauri.ts:133`，让下次 `clientFetch` 用新 baseUrl/token；`Settings.tsx:384`「保存并重新连接」）；当前开发/测试可写入 `workhub-shell-config.json` 或环境变量。
- 本地工作目录/网盘目录（`onBlur` 触发 `saveRootField`，`Settings.tsx:180`；后端 `validated_root` 校验非空，`commands/config.rs:31`）。
- 网盘同步模式（关/仅下载；两向被强制降级，`config.rs:155` `normalize_drive_mode`）+ 暂停开关（`Settings.tsx:352`，与托盘 `toggle_pause` 同源）。
- 接单状态（空闲/忙碌/自定义文案，`set_availability_status` → 同步后端 + 托盘菜单 `refresh_menu`）。
- 外观主题（auto/light/dark，`theme` 字段 + `useTheme`，`Settings.tsx:13`）。
- 重看新手引导（`useFirstRun` 的 `reset()`，`Settings.tsx:414`「再看一遍新手引导」→ App 级 `WelcomeTour` 在 `!tourSeen` 时重开，`App.tsx:106/276`）。
- 关于：版本/配置文件路径（`Settings.tsx:429`，纯展示）。

> **WorkHub 新增（设备管理，建议）**：现状 Settings **没有**设备列表/吊销 UI——客户端只有 `register_device`/`validate_device`（`commands/auth.rs:94/77`）用于建立/校验设备门，**无** `/api/client-devices/me` 列表或 `/{id}/revoke` 吊销调用（webview 与 Rust 侧均查无）。WorkHub 补「列设备 / 吊销」卡片，对齐 [`api-contract.md §2.2`](../01-architecture/api-contract.md)，新增 webview 调用 + 必要时 Rust 命令。

**四态**：加载=读 config；空=N/A；错误=校验失败 toast（端口越界/协议非 http(s)/URL 非法/目录空，`commands/config.rs:66-89`）；无权限=admin-only 项（如设他人 admin）非管理员隐藏（`AdminPanel` 返回 `null`）。
**web↔桌宠差异**：服务器地址/本地目录/网盘同步模式 **C-PET 独有**（C-WEB 无本地配置概念）；外观/接单状态两端都有；设备管理待 WorkHub 落地（见上方新增说明）。

---

## 7. 安装与更新

### 7.1 安装（NSIS）

- **当前 WorkHub scaffold**：`bundle.targets:["nsis"]` 已写入 `tauri.conf.json`，标识符为 `com.mycyg.workhub`，产品名 `WorkHub`。安装模式、语言、WebView2 bootstrapper、签名与图标尚未接。
- **旧项目 / 目标形态参照**：`installMode:"currentUser"`（免管理员）、语言 `SimpChinese`/`English`、WebView2 `embedBootstrapper`（按需拉运行时）。
- **分发**：daemon 托管安装包，客户端从 `/api/downloads/manifest` + `/downloads/*` 取（`api-contract.md §1` downloads 组）。
- **deep-link 注册**：当前 WorkHub 已接 `tauri-plugin-deep-link` 与 `tauri-plugin-single-instance`，`tauri.conf.json` 注册 `workhub://` 与兼容旧 `yqgl://`。开发态 Windows/Linux 会 `register_all()` 方便测试；第二次启动会聚焦既有主窗，并把 argv 里的协议 URL 复用 deep-link 白名单执行；后续还需安装包协议注册 smoke、macOS bundle smoke 与通知点击 smoke。
- **配置入口**：当前 WorkHub 会在 Tauri Config 目录读取 `workhub-shell-config.json`，字段为 `server_url` / `client_token` / `device_name`，并允许 `WORKHUB_SERVER_URL` / `WORKHUB_DEVICE_NAME` / `WORKHUB_CLIENT_TOKEN` / legacy `YQGL_CLIENT_TOKEN` 覆盖。后续再补旧 Python 客户端配置迁移、原子写盘、secure vault 与损坏配置恢复。

### 7.2 首次运行 → 设备门建立

启动 → `main.rs` 读 `workhub-shell-config.json`/env → 根据 token 决定 SSE global-only 或 global+`/me` → 进主壳。
- 当前：若无 token，只连 global；若有 token，所有 SSE 请求带 `X-WorkHub-Client-Token` + legacy `X-YQGL-Client-Token`。
- 目标：webview onboarding 识别用户 → 注册设备 → token 进入 secure vault / config state → restart 私有 SSE worker → 进主壳。

### 7.3 自动更新（**当前缺口 → WorkHub 待补**）

- **现状**：`Cargo.toml` 仍无 `tauri` / `tauri-plugin-updater` / `tauri-plugin-process` / `tauri-plugin-autostart` 依赖；`tauri.conf.json` 无 `updater` 配置，故目前无应用内自动更新。`tauri-plugin-process` / `autostart` 属后续目标，不应误判为当前已接。
- **WorkHub 演进（建议）**：
  - 接 `tauri-plugin-updater`：daemon 暴露 update manifest（与 `/api/downloads/manifest` 同源或扩展），客户端启动/定时 `check_update` → 有新版提示 → `install_update` → 用 `tauri_plugin_process` relaunch。新增命令 `check_update`/`install_update`（§4.1）+ 事件 `update-available`/`update-progress`。
  - LAN-first 形态下 update 源 = daemon 自身（无需公网 CDN）；云就绪时可移到对象存储/CDN（对齐 [`system-architecture.md §4`](../01-architecture/system-architecture.md)）。
  - 接线 `autostart` 插件实现「开机自启 + 静默到托盘」（桌宠常驻语义）。
  - **签名**：updater 需 artifact 签名密钥；LAN 内可先用自签，公网（P5）走正式签名 + 威胁模型重审（[`security-and-permissions.md`](../01-architecture/security-and-permissions.md)）。

---

## 8. 与其他文档的边界（避免重复）

| 想找 | 去哪 |
|---|---|
| daemon 路由组逐条、SSE 事件类型完整清单、鉴权依赖、设备令牌门契约 | [`../01-architecture/api-contract.md`](../01-architecture/api-contract.md) |
| 进程边界、事件总线拓扑、部署形态、桌宠↔daemon 数据流（含双向同步切分） | [`../01-architecture/system-architecture.md`](../01-architecture/system-architecture.md) |
| 实体字段、WorkItem 状态机全转移、软删除/审计、Branch/Proposal/AgentRun/Escalation | [`../01-architecture/data-model.md`](../01-architecture/data-model.md) |
| 用户用语 / 去黑话 / 状态标签映射 / AI 把握程度三档语气 | [`../00-overview/glossary-dejargon.md`](../00-overview/glossary-dejargon.md) |
| Web 端逐页规划（信息架构同源，本篇只写差异） | [`./web-app.md`](./web-app.md) |
| 设计 tokens、组件库、类型化 API client、共享 hooks/types | [`./shared-ui-kit.md`](./shared-ui-kit.md) |
| 双向同步协议、冲突 AI 调解、离线、README=规格活文档 | [`../03-collaboration/sync-and-spec.md`](../03-collaboration/sync-and-spec.md) |
| 审批阻塞原语、路由、SLA、委派、"永远允许"学习 | [`../03-collaboration/review-and-approval.md`](../03-collaboration/review-and-approval.md) |
| AI 工人循环/trace/置信度/风险/升级/doom-loop（桌宠状态机的事件源头） | [`../02-ai-engine/agent-loop-and-tools.md`](../02-ai-engine/agent-loop-and-tools.md) · [`../02-ai-engine/confidence-risk-escalation.md`](../02-ai-engine/confidence-risk-escalation.md) |
| 网盘 / 会议模块全功能（两端 UI） | [`../04-modules/projects-and-drive.md`](../04-modules/projects-and-drive.md) · [`../04-modules/meetings-and-insights.md`](../04-modules/meetings-and-insights.md) |

---

## 9. 实现架构路线（WorkHub 施工版）

### 9.1 总体分层

```text
C-PET Tauri process
  Rust shell
    - config/device token
    - SSE/reminder workers
    - tray/deep-link/notification/single-instance
    - local file/sync/delivery commands
  WebView main window
    - React routes
    - local work desk / settings / sync / delivery
  WebView pet window
    - Cuu runtime
    - lightweight bubbles/cards
    - event -> animation state mapping
  daemon
    - REST truth
    - SSE hints
    - agent/proposal/permission/sync APIs
```

Rust 只负责系统能力和安全边界；React 负责 UI、Cuu 动画状态和用户输入；daemon 仍是唯一真相源。

### 9.2 宠物窗口落地

- **窗口创建**：`pet` label 已在 scaffold 中存在，配置 `transparent:true`、`decorations:false`、`alwaysOnTop:true`、`visible:false`、`focus:false`；初始 body-only 尺寸为 180x220，展开卡片时按 `pet_window.rs` 的 `card` plan 扩到 380x560。P1d-a 后实际尺寸会再乘以用户选择的 75/100/125/150 scale，Rust 会保持 body anchor 不漂移。`tauri::Builder` / `generate_context!` / command handler 已落，`set_pet_window_mode` 已能执行 resize/position/show，`set_pet_window_settings` 已能执行 scaled placement 与 click-through；`skipTaskbar:true` 已在 WorkHub plan 固定，待真实 Tauri schema/runtime 接线。
- **权限**：若前端创建窗口，需要 Tauri capability 允许创建 webview window；更稳妥的 MVP 是 Rust setup 阶段创建 pet window，前端只发 `show_pet_window` / `hide_pet_window` / `toggle_pet_window` 命令。
- **点击模型**：idle 时窗口可小尺寸跟随 Cuu 外接矩形；展开时扩大交互区域。P1d-a 已接 `pass_through` 到 Tauri `set_ignore_cursor_events`，但交互规则仍需谨慎：后续 P1d-b 必须在 hover/card/drag 时设计临时关闭穿透，否则用户可能无法重新抓住 Cuu。
- **位置**：当前 `pet_window.rs` 已有右下角默认定位、从 body anchor 展开和 work area clamp；`main.rs` 已用自有 `pet-window-state.json` 保存 body anchor 与可选 monitor name，启动时恢复并按当前 work area clamp，失效则回到底部右侧；后续补多显示器实测和 Settings 可视化。
- **降噪**：desktop webview 已支持静音/勿扰/减少动效/队列上限；真实 Tauri 已有托盘显隐、拖拽位置、high/urgent 系统通知基础与进程内通知去重，继续补通知点击联动、偏好下沉和去重持久化。
- **surface 分流**：`main` window 加载完整 workbench；生产 `pet` window 加载同一根 bundle，但由 Rust initialization script 注入 `window.__WORKHUB_SURFACE__="pet"`，只启动 Cuu runtime、sprite atlas、bubble/card，不渲染 Gold Path 主壳。浏览器调试入口保留 `/pet`、`?surface=pet`、`#surface=pet` 和 `pet.html`。当前 `pet-window-bridge.ts` 已把 `body_only/card` 模式、settings、拖拽、位置保存和 cursor-near 采样端口暴露给 `pet_commands.rs`，并由 `main.rs` 执行到 Tauri window / AppHandle API。

### 9.3 客户端页面施工顺序

| 阶段 | Rust 壳 | React 主窗 | Cuu/pet | 验收 |
|---|---|---|---|---|
| P1 | 复用现有 `main`、托盘、SSE | 单件事 Hub、选项澄清、审批卡 | 绿幕 PNG/WebP atlas + `/pet` webview 预览 | 用户能不打字完成澄清和审批，Cuu 动作资产可播放 |
| P2 | 新增 `pet` window、窗口状态、open/hide 命令 | 设置页增加桌宠显隐/自启动/诊断 | 独立桌宠窗 + idle scheduler，Rive 可选 | 关闭主窗后 Cuu 仍可提醒，右下角常驻且有生命感 |
| P3 | permission/proposal IPC、deep-link route expansion + OS notification click source / dedup / preference bridge；webview `navigate` listener 已落 | 交付物变更包、审批中心联动 | 审批气泡 / 证据气泡 | 变更申请能通过/打回/记住规则，系统通知能唤起对应页面且尊重勿扰 |
| P4 | 双向 sync、冲突检测、delivery 安全校验 | 同步中心、冲突解决、交付向导 | sync/conflict 动作状态 | 本地/云端冲突可安全处理 |
| P5 | updater/autostart、崩溃日志、性能采样 | 设置/诊断/帮助完善 | 性能降级与可访问性 | 长时间常驻稳定 |

### 9.4 本地同步与冲突

![本地同步与冲突解决](./assets/desktop/desktop-sync-conflict-resolver.png)

实现边界：

- `sync_root` 下所有写盘操作继续做路径 containment。
- 同一项目/工作项使用 operation lock，禁止两个同步/交付任务并发撞车。
- 冲突对象统一成 `ConflictCandidate[]`：local、cloud、ai_suggested_merge。
- AI 合并建议必须带证据、风险、回滚计划；用户选择后再写入正式态。
- 低风险文本/表格变更可自动生成建议，高风险交付物只能请求确认。

### 9.5 部署、更新与诊断

![设备设置与部署入口](./assets/desktop/desktop-device-setup-update.png)

- **LAN-first**：安装包仍由 daemon `/downloads` 分发，首启配置 server address。
- **设备令牌**：onboarding 后注册设备；设置页展示设备信任态与 token 尾号，支持重新注册。
- **自启动**：接线 autostart 插件，默认可选，不强制。
- **更新**：P5 接 `tauri-plugin-updater` 或自有 manifest；LAN 内先由 daemon 托管 manifest 和安装包。
- **诊断**：设置页提供连接、文件系统、权限、磁盘空间、SSE、托盘、Cuu runtime 的检查项；日志落 `%APPDATA%/WorkHub` 或兼容现有 `%APPDATA%/yqgl`。

### 9.6 Cuu runtime 选型

桌宠动画技术的详细方案见 [`cuu-desktop-pet-concept.md`](./cuu-desktop-pet-concept.md) 与 [`cuu-live2d-layered-asset-plan.md`](./cuu-live2d-layered-asset-plan.md)。本端级规格只固定工程边界：

- P1 默认必须能不依赖专业绑定工具运行，因此当前采用 `bongo_cuu` DOM/CSS 低恐怖谷 renderer；详见 [`cuu-bongo-style-runtime-plan.md`](./cuu-bongo-style-runtime-plan.md)。P1b 已通过 browser 状态墙和真实 Tauri contact sheet 验证动作可读性；P1c 已通过 first-painted 首帧门禁，frame 000 不再是 blank；BONGO-REF 已把参考 BongoCat 的模型可替换思想收敛成 `CuuModelPackManifest`，默认包为 `cuu-bongo-p1`。
- Sprite atlas / Hatch pack 作为 fallback 与动作素材参考，不能替代默认可爱度验收。
- Live2D 是 Cuu 长期高表现力主线：用 GPT Image / 人工精修产出分层 PSD，Cubism 绑定后导出 `.model3.json`；但只有美术 QA、真实 Tauri 录屏和 `assertCuuModelPackCanBeDefault()` 都通过后，才允许替换 `bongo_cuu` 默认。
- Rive 可作为许可或工具链阻塞时的中间路线，因为 state machine 与 WorkHub 的事件映射天然契合。
- GIF 只作为 motion storyboard / 文档预览 / 临时演示，不能作为最终桌宠 renderer。
- Lottie 适合小动效和过渡，不建议承载复杂桌宠人格。

### 9.7 相关官方资料

- [Tauri v2 window API](https://v2.tauri.app/reference/javascript/api/namespacewindow/) / [window customization](https://v2.tauri.app/learn/window-customization/)：用于透明、无边框、多窗口、always-on-top 配置。
- [Rive Web runtime](https://rive.app/docs/runtimes/web) / [Rive React runtime](https://rive.app/docs/runtimes/react)：用于 `.riv`、state machine 和 input trigger。
- [`lottie-web`](https://github.com/airbnb/lottie-web)：用于 JSON 动画、SVG/Canvas/HTML renderer 与 `playSegments`。
- [Live2D Cubism SDK manual](https://docs.live2d.com/en/cubism-sdk-manual/top/) / [CubismWebFramework](https://github.com/Live2D/CubismWebFramework)：用于可选的高表现力 2D rig，需关注 Cubism Core 包和许可。

*本篇定位：C-PET 端级页面规划的单一来源。后端契约 → `api-contract.md`；架构形状 → `system-architecture.md`；术语口径 → `glossary-dejargon.md`；Web 端 → `web-app.md`。所有 IPC/命令/事件均扎根 `client-tauri/` 真实代码，新增项已显式标注 *(新增/建议)* 并对齐 api-contract。*
