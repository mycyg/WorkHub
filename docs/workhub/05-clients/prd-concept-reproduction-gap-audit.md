---
module: 05-clients
layer: C-WEB / C-PET / Cuu / Rust shell
status: draft
owner: workflow
date: 2026-06-06
visuals:
  - ./assets/shared/prd-concept-gap-map.png
  - ./assets/cuu/cuu-runtime-gap-roadmap.png
  - ./assets/desktop/desktop-rust-shell-gap-roadmap.png
  - ./assets/web/web-real-ui-gap-roadmap.png
---

# PRD 与概念设计复现差距审计

> **一句话**：当前 WorkHub 已经打下 TS-first 契约、API、Page VM、Gold Path、Cuu 卡片、Cuu 6 clip 绿幕 motion pack seed、基础 idle scheduler、`/pet` webview surface、pet window 几何/拖拽桥、pet command scaffold、最小 Tauri runtime 入口和 Rust shell contract 的地基，但距离 PRD 与概念图里的完整体验还有明显距离：**Cuu 还没有 18 动作 full coverage 和真实 Tauri 透明窗口里的活体行为，Rust/Tauri 还没有成为生产桌面壳，Web 还不是完整 React SPA，概念图中的本地同步/托盘/透明桌宠窗/视觉 QA 尚未复现。**

本篇用于防止后续施工把「已有契约」误判为「体验已完成」。所有判断基于 2026-06-06 当前仓库：

- Web：`apps/web`
- 桌面 webview：`apps/desktop-webview`
- Rust shell contract：`client-tauri/src-tauri`
- Cuu adapter：`packages/cuu`
- 共享 UI render helpers：`packages/ui`
- 契约/API：`packages/contracts`、`apps/api`、`packages/api-client`

---

## 0. 概念图

### 0.1 总体差距地图

![PRD / 概念复现差距地图](./assets/shared/prd-concept-gap-map.png)

这张图只表达差距结构，不作为精确完成率。真实施工判断以本文表格和验收门为准。

### 0.2 Cuu 运行时差距路线

![Cuu runtime gap roadmap](./assets/cuu/cuu-runtime-gap-roadmap.png)

### 0.3 Rust / Tauri shell 差距路线

![Rust shell gap roadmap](./assets/desktop/desktop-rust-shell-gap-roadmap.png)

### 0.4 Web 真页面差距路线

![Web real UI gap roadmap](./assets/web/web-real-ui-gap-roadmap.png)

---

## 1. 结论摘要

### 1.1 离 P0.5 Gold Path 还有多远

P0.5 的「可点击纵切」已经有一批核心底座：

- `apps/api` 已有 `sessions`、`workitems`、`agent-runs`、`proposals`、`approvals`、`cost`、`replay`、`push` 等 route group。
- `packages/contracts` 已有页面 VM、事件、Cuu 状态、proposal、approval、replay、cost 等契约。
- `packages/ui` 已有 Gold Path / intake / workitem / proposal / agent-run 的 render helpers。
- `apps/web` 和 `apps/desktop-webview` 都能消费同一 Gold Path Page VM。
- `packages/cuu` 已能把事件 / 页面 VM 映射成 Cuu 卡片，并带 `CuuMotionHint`。

但 P0.5 仍缺这些会影响真实体验的东西：

- Web 端还偏「render helper + Gold Path shell」，不是完整可导航、可长期使用的 SPA。
- Cuu 已有卡片、motion hint、sprite manifest、controller MVP、6 clip 绿幕/alpha motion pack、基础 idle scheduler、`/pet` surface、pet window 几何合同、command scaffold 和 webview pointer/drag bridge，但真实形态仍缺 18 动作 full coverage、真实 Tauri runtime 执行、跨窗口鼠标采样、右下角独立 Tauri `pet` window 和视觉 QA。
- 桌面端是 webview adapter + Rust contract crate + Tauri config/capability scaffold + 最小 `build.rs` / `main.rs` runtime 入口，还不是可安装的 Tauri v2 桌面应用。
- `client-tauri/src-tauri` 当前已有 `tauri` / `tauri-build` 依赖、`tauri.conf.json` / capability scaffold、`build.rs`、`main.rs` pet command handler，并已把 mode resize/position/show、drag、save-position 执行到真实窗口 API；但还没有真实 cursor sampling、位置持久化、托盘、通知、deep-link、updater。
- 视觉 QA、Playwright 截图、透明窗口像素检查、Cuu 帧率/多屏/HiDPI 检查都未形成门禁。

### 1.2 离完整 PRD / 概念图复现还有多远

完整 PRD 复现比 P0.5 远得多。当前更接近「TS-first P0.5 骨架」，不是 P1-P5 完整产品：

| 范围 | 当前状态 | 距离完整概念的主要缺口 |
|---|---|---|
| 契约 / Page VM / typed client | 已具备主链路雏形 | OpenAPI 生成、全量页面 VM、权限脱敏、raw endpoint 仍需继续收敛 |
| AgentRun / proposal / replay / cost | P0.5 纵切已成形 | 真实 LLM loop、eval runner、side-effect 工具、全量快照回滚、模型成本账本还需加深 |
| Web | Gold Path shell + render helpers | 全量真实 React SPA、路由、状态、响应式、四态、视觉回归、Cuu 气泡整合 |
| Desktop webview | 能消费同一 VM、桥接 Cuu notice，支持 `/pet` surface 只加载 Cuu，并已有 pet pointer/drag bridge 与 Rust command scaffold 对齐 | 仍不是独立桌面体验；缺真实 Tauri pet runtime、本地动作面板、设置/诊断/同步中心 |
| Rust shell | config/http/sse/event/window planning/control planning crate + Tauri config/capability scaffold + 最小 Tauri `main.rs` command handler，pet mode/drag/save-position 已执行到窗口 API | 缺真实 cursor sampling、位置持久化、托盘、通知、deep-link、设备令牌 vault、本地 sync/delivery/updater |
| Cuu | 卡片、状态、motion hint、sprite runtime MVP、controller / badge / queue / preference panel MVP、6 clip 绿幕/alpha motion pack、基础 idle scheduler、`/pet` webview surface、pet window 几何/拖拽端口、pet command scaffold | 缺 GPT Image 18 动作 full coverage、右下角独立 Tauri `pet` 透明窗口、真实 Tauri window runtime、系统通知、展开卡 QA |
| 项目检索 / 知识库 | API/证据契约方向明确；Cuu `knowledge-search` 可调用 typed API 并回显 evidence card；`use_for_current_task` 可把 evidence refs 带回 WorkItem VM | 缺完整检索页、证据详情展开、权限内检索结果分页和真实知识库持久化 |
| 同步 / 本地交付 | 规划完整 | 当前 WorkHub 仓库未落真实本地 sync worker、冲突 resolver、delivery package |
| QA / 发布 | 单元测试与构建基础 | 缺端到端视觉 QA、桌宠透明窗口 QA、Tauri 安装包、updater/autostart 验证 |

---

## 2. 当前实现事实

### 2.1 已经落地

| 领域 | 当前代码 | 说明 |
|---|---|---|
| API route groups | `apps/api/src/routes/*` | 覆盖 auth、sessions、workitems、agent-runs、proposals、approvals、cost、audit、push 等 P0.5 核心路由 |
| Page assembler | `apps/api/src/pages/*` | Gold Path、proposal、replay、cost 等页面 VM 已有聚合层 |
| contracts | `packages/contracts/src/*` | 共享 DTO、page VM、event、domain schema 是前后端和 Cuu 的同源基础 |
| API client | `packages/api-client/src/*` | Web / desktop-webview 消费同一 client |
| Cuu cards | `packages/cuu/src/cards.ts` | 能从 session、workitem、proposal、agent live、event 生成 `CuuCard` |
| Cuu motion hints | `packages/cuu/src/motion.ts` | 已定义 `idle_breathe`、`thinking_tail`、`asking_approval_bounce` 等状态名，但只是 hint |
| Web shell | `apps/web/src/browser.ts` | 读取 `/api/pages/gold-path` 并渲染 shell，可做 P0.5 预览 |
| Desktop webview shell | `apps/desktop-webview/src/browser.ts` | 可读取同一 VM，支持 Cuu demo event 和 desktop notice；`/pet` 或 `?surface=pet` 会进入 pet surface |
| Desktop Cuu bridge | `apps/desktop-webview/src/desktop-cuu-runtime.ts` | 把 Tauri/mock listener 的 `push-event` / `sse-status` 转成 Cuu notice |
| Cuu sprite runtime MVP | `packages/cuu/src/sprite-manifest.ts`、`apps/desktop-webview/src/cuu-sprite-runtime.ts` | 已把 `CuuMotionHint.sprite_state` 接到可校验 manifest 和 procedural CSS sprite renderer；尚非正式图片资产 |
| Cuu motion pack | `packages/cuu/src/atlas-manifest.ts`、`apps/desktop-webview/src/cuu-atlas-assets.ts`、`apps/desktop-webview/src/cuu-atlas-runtime.ts`、`apps/desktop-webview/src/assets/cuu/*` | 已把 6 个 GPT Image 绿幕 sprite sheet 抠图为透明 PNG，并合成 `cuu-p1-motion-pack.png` / `cuu.sprite.json`；当前覆盖 `idle_breathe`、`thinking_tail`、`asking_approval_bounce`、`carrying_document_step`、`celebrating_jump`、`searching_evidence_peek` |
| Cuu pet surface | `apps/desktop-webview/src/pet-surface.ts` | 只渲染 Cuu atlas 本体和一张轻气泡，不加载 Gold Path 主壳；打回理由是固定按钮 |
| Cuu idle scheduler | `packages/cuu/src/idle-scheduler.ts` | 纯 TS 调度呼吸、眨眼、尾巴、看鼠标、睡觉、醒来、拖动、轻敲、挥手等微动作；当前先输出动作语义，视觉仍受 atlas 覆盖度限制 |
| Cuu pet geometry / commands / bridge | `client-tauri/src-tauri/src/pet_window.rs`、`client-tauri/src-tauri/src/pet_commands.rs`、`client-tauri/src-tauri/src/main.rs`、`apps/desktop-webview/src/pet-window-bridge.ts` | 已固定 body-only/card 双模式、右下角定位、展开锚点、work area clamp、鼠标接近判定、拖拽 plan、`set_pet_window_mode` / `start_pet_window_drag` / `save_pet_window_position` / `sample_pet_cursor_near` command 名，已在 `main.rs` 注册 command，mode resize/position/show、drag、save-position 已执行到 Tauri window API，并把 hover/drag/release 接进 pet surface；真实 cursor sampling 仍待落 |
| Cuu controller / badge / preference MVP | `packages/cuu/src/controller.ts`、`apps/desktop-webview/src/desktop-cuu-runtime.ts`、`apps/desktop-webview/src/cuu-preferences.ts`、`apps/desktop-webview/src/browser.ts` | 已把提醒收敛为 show / replace / queue / badge / drop 决策；desktop runtime 会尊重勿扰与队列策略；browser 侧已有 queue badge、超时后推进下一张卡、默认隐藏的提醒/声音/减少动效/队列上限偏好面板；`knowledge-search` action 可回显 evidence card，`use_for_current_task` 可绑定当前证据到 WorkItem |
| Rust contract crate | `client-tauri/src-tauri/src/*` | 有 config、HTTP request plan、SSE frame parser、event channel naming、`main` / `pet` window plan、show/hide/focus/toggle control plan、pet geometry/command plan |
| Tauri scaffold | `client-tauri/src-tauri/{Cargo.toml,build.rs,tauri.conf.json,capabilities/default.json,icons/icon.ico,src/main.rs,tests/tauri_scaffold.rs}` | 已把 desktop webview dev/build、`main` / `pet` window config、最小 capability、`withGlobalTauri:true`、Tauri Windows icon、`tauri::Builder` command handler、pet window API 执行和 scaffold contract tests 落到当前仓库；`cargo check` / `cargo test` 可通过 |

### 2.2 容易误判的地方

`desktop-pet-tauri.md` 仍保留大量旧项目迁移参照，例如 `client-tauri/web-src`、`tray.rs`、`sync.rs`、`spec_watch.rs`、`invoke_handler!`、`commands/*.rs`。这些是**旧「需求管理大师」实现经验或目标设计锚点**，不是当前 WorkHub 仓库已经存在的源文件。`tauri.conf.json` 现在已经是当前 WorkHub scaffold 的真实文件，但只代表配置入口，不代表 Tauri runtime 已经可运行。

当前 WorkHub 的真实状态是：

```text
client-tauri/src-tauri/
  Cargo.toml       # 已有 serde / tauri / tauri-build
  build.rs         # tauri_build::build()
  tauri.conf.json  # Tauri config scaffold,withGlobalTauri:true
  capabilities/default.json
  tests/tauri_scaffold.rs
  src/main.rs      # 最小 tauri::Builder + pet command handler
  src/config.rs
  src/events.rs
  src/http.rs
  src/lib.rs
  src/pet_commands.rs
  src/pet_window.rs
  src/sse.rs
  src/window_controls.rs
  src/windows.rs

apps/desktop-webview/
  src/browser.ts
  src/main.ts
  src/shell-events.ts
  src/desktop-cuu-runtime.ts
  src/cuu-sprite-runtime.ts
  src/cuu-atlas-assets.ts
  src/cuu-atlas-runtime.ts
  src/pet-surface.ts
  src/assets/cuu/
packages/cuu/
  src/idle-scheduler.ts
```

因此后续施工必须把旧锚点写成「Behavior source / 迁移参照」，把当前目标写成「Target TS/Rust paths」。

---

## 3. Cuu 差距审计

### 3.1 当前已具备

- `CuuState` 与状态名已在 contracts / Cuu package 内可用。
- `CuuMotionHint` 已覆盖所有 Cuu state。
- Cuu 卡片能覆盖澄清、审批、证据、预算、proposal、agent live、offline 等主场景。
- Desktop webview 已有 scripted event demo，可模拟 Cuu notice。
- 概念图已经固定 Cuu 的小猫形象、动作状态、资产生产流水线、动画架构选型。
- 已有 6 clip GPT Image 绿幕 sprite sheets、透明 alpha 图和 motion pack atlas，像素检查四角透明且所有 clip 可见绿边统计为 0。
- `/pet` webview surface 已能只显示 Cuu atlas 本体和轻气泡，是 Tauri `pet` window 的前端入口雏形。
- 基础 idle scheduler 已能 deterministic 触发呼吸、尾巴、眨眼、睡觉、醒来、拖动、释放和点击反馈；pet surface 已把 pointer hover/drag/release 接进 scheduler。

### 3.2 缺口

| 缺口 | 为什么重要 | 目标落点 |
|---|---|---|
| 真实小猫动画资产 | 6 clip motion pack seed 已落，但要复现概念图必须继续生成 18 动作绿幕帧并抠图成正式小猫多帧素材 | `apps/desktop-webview/src/assets/cuu/*` 或未来 `client-tauri/web-src/src/assets/cuu/*` |
| sprite manifest 生产资产化 | atlas schema / runtime JSON manifest 已落，但 full coverage atlas、anchor/fps/loop/reduced-motion 全量配置仍未完成 | `packages/cuu/src/atlas-manifest.ts`、`apps/desktop-webview/src/assets/cuu/*` |
| CuuController 生产化 | 策略、badge、队列推进、desktop preference panel MVP 已落；还需要 click/restore 细化、idle 降级、真实 Tauri Settings 承接和系统通知 | `packages/cuu/src/controller.ts`、`apps/desktop-webview/src/browser.ts`、未来 `apps/desktop-webview/src/cuu/*` |
| 动画 renderer | atlas renderer 已落 motion pack seed；idle scheduler 已落；仍需替换主窗 notice、补 full coverage atlas，后续可评估 Canvas/Rive | `apps/desktop-webview/src/cuu-atlas-runtime.ts`、`RiveCuu.tsx` |
| 独立 pet window | `/pet` surface、body-only/card 几何合同、command scaffold 和前端 bridge 已落；主窗隐藏后 Cuu 仍在桌面活动需要真实 Tauri runtime | `client-tauri/src-tauri/src/windows.rs`、`client-tauri/src-tauri/src/pet_window.rs`、`client-tauri/src-tauri/src/pet_commands.rs`、Tauri `pet` window、`apps/desktop-webview/src/pet-surface.ts` |
| 拖拽 / 收起 / 静音 / 勿扰 | 静音 / 勿扰 / 减少动效 / 队列上限已有 desktop webview 面板；拖拽 bridge 与 Rust drag plan 已落；收起、真实位置记忆仍待独立 pet window | Rust window state + TS preference |
| 活体 idle scheduler | 基础 scheduler、pointer hover/drag/release bridge 已落；仍缺真实跨窗口鼠标距离、真实窗口位置和 full coverage atlas 承接 | `apps/desktop-webview/src/pet-surface.ts`、`apps/desktop-webview/src/pet-window-bridge.ts`、`packages/cuu/src/idle-scheduler.ts` |
| 气泡卡动作真实提交 | Cuu 卡片按钮必须真正调用 API，不只是展示 | `apps/desktop-webview/src/desktop-cuu-runtime.ts` + `packages/api-client` |
| 视觉 / 性能 QA | 透明边缘、帧率、CPU/GPU、HiDPI、多屏必须可验收 | Playwright + Tauri smoke + pixel checks |

### 3.3 Cuu 施工路线

| 阶段 | 目标 | 产物 | 验收 |
|---|---|---|---|
| Cuu-P1a | 把 motion hint 绑定 sprite / atlas manifest | `defaultCuuSpriteManifest`、`CuuSpriteAtlasManifest`、`CuuSpriteState` 校验 | **已落 MVP + 6 clip seed**：每个 `CuuState` 有 procedural clip、fps、reduced-motion 文案；`idle_breathe`、`thinking_tail`、`asking_approval_bounce`、`carrying_document_step`、`celebrating_jump`、`searching_evidence_peek` 真实 atlas 已落；下一步按 [`cuu-green-screen-desktop-pet-solution.md`](./cuu-green-screen-desktop-pet-solution.md) 生成剩余动作帧并打 full coverage atlas |
| Cuu-P1b | 在 desktop webview 渲染可动 Cuu | `CuuController`、atlas renderer、bubble layer | **部分已落**：notice 内可渲染 procedural sprite，`/pet` surface 可渲染 motion pack atlas，controller 已能决策 show/queue/badge/drop，browser 已有 queue badge、超时推进和偏好面板，idle scheduler 与 pointer bridge 已接；下一步替换主窗 notice 为真实 frame animation、补 full coverage atlas、做视觉 QA |
| Cuu-P1c | 选项澄清 / 审批 / 证据气泡可点 | Cuu card action handler | 审批/下一题/知识检索回显/证据带回当前任务已落；待证据详情展开和完整检索页 |
| Cuu-P2a | 独立 `pet` window | Tauri window + open/hide command + `/pet` surface | `/pet` surface、body/card 几何 plan、拖拽/模式 bridge 已落；待真实 Tauri runtime 后证明主窗隐藏后 Cuu 仍显示，可拖动、可收起、位置可记忆 |
| Cuu-P2b | Rive state machine | `.riv` + runtime adapter | push-event 触发自然过渡，失败可降级到 sprite |
| Cuu-P3 | Live2D 评估 | `.moc3` 方案或放弃理由 | 只有在表情/陪伴感显著提升时进入 |

### 3.4 Cuu 资产生产细化

完整施工方案见 [`cuu-green-screen-desktop-pet-solution.md`](./cuu-green-screen-desktop-pet-solution.md)。本节只保留审计摘要。

1. **锁定角色规范**：橘色虎斑、奶油脸/爪、白蕾丝围兜、黑蝴蝶结、珍珠流苏、红珠。
2. **GPT Image 生成绿幕动作帧**：第一批至少 18 个动作，每个动作 6-12 帧，统一 `#00ff00` 背景和脚底 anchor。
3. **抠图 / 去底 / 对齐**：优先 chroma-key + despill；裁切后按动作统一 canvas 和脚底 anchor，避免动画抖动。
4. **一致性修正**：眼睛大小、围兜位置、蝴蝶结角度、流苏长度、尾巴方向。
5. **打包**：P1 用 sprite atlas；P2 用 Rive；P3 评估 Live2D。
6. **运行时 QA**：在 Tauri 透明窗口看边缘、阴影、点击区域、缩放、低电量、长时间常驻。

---

## 4. Rust / Tauri 客户端差距审计

### 4.1 当前已具备

- `client-tauri/src-tauri/src/config.rs`：server url、device token、device name 的基础结构。
- `http.rs`：daemon URL 和 device token header plan。
- `sse.rs`：SSE target、frame parser、push payload/status payload。
- `events.rs`：`push-event`、`sse-status`、`navigate`、`tray-action`、`system-notification` channel 命名。
- `windows.rs`：`main` / `pet` window plan contract，`pet` 固定 transparent、decorations false、always-on-top、skip taskbar。
- `window_controls.rs`：`show/hide/focus/toggle main/pet` 的 typed control plan；deep-link route 做安全校验，pet 操作不抢焦点。
- `tauri.conf.json`：声明 desktop webview 的 `devUrl=1420` / build dist、`main` 与 `pet` window config；`skipTaskbar` 暂留在 WorkHub 自有 plan，避免未确认字段提前进入 Tauri schema。
- `capabilities/default.json`：当前只给 `main` / `pet` `core:default`，文件系统、shell、process 等能力后续按模块最小化开启。
- `tests/tauri_scaffold.rs`：把配置与 `ShellWindowPlan` / capability 绑定成可测契约。
- `lib.rs` 明确 Rust 只拥有本地壳能力，不复制 permission / workitem status / domain DTO / Cuu animation state。

### 4.2 缺口

| 缺口 | 当前事实 | 目标 |
|---|---|---|
| Tauri v2 runtime | 已有 `tauri` / `tauri-build` 依赖、`tauri.conf.json` / capability scaffold、`build.rs`、`main.rs` command handler，pet mode/drag/save-position 已执行到 window API | 补 setup/tray/SSE/notification/deep-link、cursor sampling、位置持久化 |
| 主窗口 | 已有 `main` window plan + Tauri config + `show/hide/focus` control plan，当前无真实 Rust window 创建 | `main` window 承载 desktop webview |
| Cuu pet window | 已有 `pet` window plan + Tauri config + `show/hide/toggle` control plan，webview `/pet` surface、body/card 几何 plan、command scaffold 与拖拽 bridge 已落；当前无真实透明窗口创建；`skipTaskbar` 仍在 WorkHub plan | `pet` window：transparent / decorations false / always-on-top / skip taskbar |
| 托盘 | 当前有 event enum 与 window control plan，无真实 tray module | tray menu、未读/审批状态、show/hide Cuu、退出 |
| 系统通知 | 当前只有 channel 名 | OS notification plugin + high/urgent policy |
| deep-link | 当前有 route 安全校验与 focus main control plan，无真实 handler | `workhub://` 或迁移兼容 `yqgl://`，打开 workitem/proposal/approval |
| 设备令牌 vault | 当前只是内存结构 | 安全保存、token tail 展示、重新注册、失效恢复 |
| SSE worker | 当前只有 parser/plan | 后台连接 `/api/push/stream`、`/me`，emit 到 webview |
| local sync/delivery | 当前无本地 worker | 文件监听、路径 containment、下载/上传/冲突/交付打包 |
| updater/autostart | 当前无插件 | P5 接 updater + autostart，LAN-first manifest |
| diagnostics | 当前无 UI/runtime | SSE、server、token、filesystem、tray、Cuu runtime 检查 |

### 4.3 Rust shell 施工路线

| 阶段 | Rust 目标 | TS/webview 目标 | 验收 |
|---|---|---|---|
| Rust-P1a | 保持 contract crate，补 Tauri scaffold | desktop-webview 继续消费 API client | **window plan + window control plan + `tauri.conf.json` + capability scaffold + `tauri` dependency + `build.rs` + `main.rs` command handler 已落**；下一步 setup 和真实 window API 执行 |
| Rust-P1b | 实现 `push-event` / `sse-status` emit worker | `bindDesktopShellCuuRuntime` 订阅真实 Tauri listener | 真实 SSE 可触发 Cuu notice，不依赖 mock |
| Rust-P2a | 主窗 + pet window + tray | 设置页显示连接/token/pet 开关 | 消费已落的 pet 几何/bridge，证明主窗隐藏后 Cuu 常驻；托盘可显隐 |
| Rust-P2b | notification + deep-link + device vault | 页面响应 `navigate` | 系统通知点击能打开 proposal / approval |
| Rust-P3 | local sync / delivery / conflict | sync center / conflict resolver | 文件改动可形成 proposal 或 conflict choice |
| Rust-P5 | updater / autostart / diagnostics | 设置页更新与诊断 | 安装包、升级、开机自启可测试 |

### 4.4 端口和运行边界

| 服务 | 当前 / 目标端口 | 说明 |
|---|---|---|
| API daemon | `8787` | 唯一真相源，Rust 不读 DB |
| Web SPA | `5173` | 浏览器 surface |
| Desktop webview dev | `1420` | Tauri dev 时加载该 webview |
| Rust shell | 无固定 HTTP 端口 | 只持本地窗口/托盘/文件/通知能力 |

Rust 不应复制这些逻辑：

- permission policy
- workitem status machine
- approval routing
- domain DTO
- Cuu animation state machine

Rust 应只做：

- 本地能力执行
- 安全路径边界
- 设备令牌持有
- 事件转发
- 系统集成

---

## 5. Web 差距审计

### 5.1 当前已具备

- `apps/web/src/browser.ts` 能加载 Gold Path Page VM 并绑定基础导航。
- `apps/web/src/main.ts` 暴露 typed client helpers 和 Cuu card adapter。
- `packages/ui` 有多个 render helper，可作为真实 React 页面组件的前身。

### 5.2 缺口

| 页面 / 能力 | 当前 | 目标 |
|---|---|---|
| AI-first Home | Gold Path shell 内展示 | 真 SPA 首页：当前一件事、后台 run、预算/风险、Cuu 提醒 |
| Option Intake | render helper | 真实 route、step state、option action、free text fallback |
| WorkItem Detail | render helper | live trace、proposal、evidence、acceptance、状态四态 |
| Proposal Detail | render helper + API action | 非代码 PR 细分 target renderer、review/merge/rollback |
| Approval Center | VM / shell 支持 | 阻塞收件箱、过滤、委派、记住规则 |
| Replay Work | render helper | 人话 timeline、raw 脱敏展开、cost footer、snapshot/revert |
| Cost Dashboard | Page VM | 管理者全量 / 普通用户切片、预算策略、告警 |
| Knowledge fallback | API/概念 | 完整检索页作为 Cuu 检索气泡兜底 |
| Visual QA | 无稳定门禁 | desktop/mobile screenshot、空/错/载/无权限状态 |

### 5.3 Web 施工路线

| 阶段 | 目标 | 产物 | 验收 |
|---|---|---|---|
| Web-P1a | 把 render helper 收敛成 React components | `apps/web/src/routes/*`、`packages/ui` components | 可路由、可交互、类型同源 |
| Web-P1b | Gold Path 全页真实可点 | Home、Intake、WorkItem、Proposal、Approval、Replay | 用户能完成一次 option-first→proposal→review→merge |
| Web-P1c | 四态齐全 | loading / empty / error / permission | 每页 fixture 覆盖四态 |
| Web-P2 | Cuu bubble / Attention queue 整合 | Cuu compact helper | 浏览器中也能看到轻卡，但不抢桌宠主入口 |
| Web-P3 | 高级页面 | knowledge fallback、meeting/drive、cost admin | Cuu 轻检索和 Web 完整检索互通 |
| Web-QA | 视觉回归 | Playwright screenshots | 无重叠、无默认 Kanban、移动端可读 |

---

## 6. Gold Path 缺口与后续门禁

### 6.1 P0.5 还需补的关键点

| Gold Path 步骤 | 已有 | 待补 |
|---|---|---|
| 一句话输入 | `POST /api/sessions` | Web/Rust 真 route 与附件/项目上下文 |
| 选项澄清 | `QuestionCard` / render helper | Cuu 气泡和页面 action 真提交 |
| 创建 WorkItem | `POST /api/workitems` | 页面从 session 选项生成 workitem 的完整流 |
| AgentRun | route + live VM | 真实 runner / SSE / trace / abort / handoff |
| 预算 | `packages/cost` + cost pages | provider usage 全量接账本、budget event fixture |
| 证据 | evidence contract | Cuu-first 项目检索和证据卡 |
| Proposal | service + page | 多 target renderer、rollback、review reason 回灌 |
| Merge | API action | audit/snapshot/revert 和通知闭环 |
| Replay | `ReplayTraceVM` | raw endpoint、redaction、visual page、eval runner |

### 6.2 必须新增的验收门

- Web 与 desktop-webview 必须渲染同一 Page VM fixture。
- Cuu 至少能真实播放 `idle → thinking → asking_approval → carrying_document → celebrating`，并在 60 秒 idle 内出现呼吸、眨眼、尾巴、睡觉/看鼠标中的至少两类微动作。
- `CuuMotionHint.sprite_state` 必须能在 runtime 中找到对应资产。
- 桌宠窗口必须可拖动、可收起、可静音，且主窗隐藏后仍显示。
- Rust shell 不得复制权限 / 状态机 / DTO；所有业务裁决来自 daemon。
- Proposal 必须支持非代码 target，不得只做 code diff。
- Replay 至少展示 5 个关键步骤，含 evidence、snapshot、cost。
- 所有视觉页必须覆盖 loading / empty / error / permission。
- Playwright 截图需覆盖桌面和移动端；Tauri 透明窗口需做非空像素检查。

---

## 7. 后续计划 Backlog

| ID | 主题 | Owner path | 依赖 | 退出标准 |
|---|---|---|---|---|
| GAP-CUU-01 | Sprite manifest schema | `packages/cuu`、`packages/contracts` | Cuu state 已有 | **MVP + atlas schema 已落**：每个 state 有可校验 procedural clip，真实 atlas schema、runtime JSON 和 6 clip motion pack 已落；待 full coverage atlas、anchor 和生产 JSON 扩展 |
| GAP-CUU-02 | Sprite runtime | `apps/desktop-webview/src/cuu-sprite-runtime.ts`、`apps/desktop-webview/src/cuu-atlas-runtime.ts`、`packages/cuu/src/idle-scheduler.ts` | GAP-CUU-01 | **MVP 已落**：notice 可渲染 procedural sprite，pet surface 可渲染 motion pack atlas，基础 idle scheduler 与 pointer bridge 已落；待主窗替换、18 动作 atlas、真实 Tauri 输入与视觉 QA |
| GAP-CUU-02B | Controller visual completion | `packages/cuu/src/controller.ts`、`apps/desktop-webview/src/cuu-preferences.ts`、`apps/desktop-webview/src/browser.ts` | GAP-CUU-02 | **MVP 已落**：show / replace / queue / badge / drop 可测，desktop badge、超时推进和偏好面板已接；待真实 Tauri Settings 承接、系统通知、视觉 QA |
| GAP-CUU-03 | Cuu 气泡 action | `apps/desktop-webview/src/desktop-cuu-runtime.ts` | API client | **基础已落**：approval / next question / knowledge-search / use_for_current_task 可提交；evidence card 可带 `evidence_refs` 回 WorkItem VM；待证据详情展开与完整检索页 |
| GAP-CUU-04 | 独立 pet window | `client-tauri/src-tauri` + `apps/desktop-webview/src/pet-surface.ts` + `apps/desktop-webview/src/pet-window-bridge.ts` | Rust scaffold + 绿幕 atlas | **surface + 几何/命令/拖拽端口已落**；待真实 Tauri `pet` window 运行、主窗关闭/隐藏后 Cuu 在右下角常驻、可拖动、会 idle 微动作 |
| GAP-RUST-01 | Tauri v2 scaffold | `client-tauri/src-tauri` | 当前 contract crate | **window plan + window control plan + pet geometry/command plan + config/capability scaffold + 最小 Tauri `build.rs`/`main.rs` + pet window API 执行已落**；待补 setup/tray/SSE、cursor sampling、位置持久化 |
| GAP-RUST-02 | SSE worker emit | `client-tauri/src-tauri/src/sse_worker.rs` | GAP-RUST-01 | 真实 SSE 发到 desktop webview |
| GAP-RUST-03 | Tray / notification / deep-link | `client-tauri/src-tauri/src/{tray,notify,deep_link}.rs` | GAP-RUST-01 | 托盘和系统通知可唤起页面 |
| GAP-RUST-04 | Local sync / delivery | `client-tauri/src-tauri/src/{sync,delivery}.rs` | sync contract | 本地变更能走 proposal / conflict |
| GAP-WEB-01 | Real SPA routes | `apps/web/src/routes` | Page VM | Gold Path 全链路可点 |
| GAP-WEB-02 | Visual QA | `apps/web/tests`、`apps/desktop-webview/tests` | Real routes | 截图无重叠、四态完整 |
| GAP-GOLD-01 | Eval / Replay runner | `packages/agent`、`packages/audit` | Replay contract | fixtures 能生成 replay + cost footer |
| GAP-DOC-01 | 旧锚点标注 | `docs/workhub/05-clients/*` | 本审计 | Behavior source 与 current implementation 不混用 |

---

## 8. 修改相关文档的规则

后续若新增概念图或实现计划：

1. 概念图放在 `docs/workhub/05-clients/assets/{web|desktop|cuu|shared}`。
2. `page-concepts.md` 必须补索引。
3. 若涉及 Cuu 动画，`cuu-desktop-pet-concept.md` 必须补 runtime / asset / QA 说明。
4. 若涉及 Rust/Tauri，`desktop-pet-tauri.md` 必须同时写清「当前 WorkHub 代码」和「旧项目迁移参照」。
5. 若涉及 Web 页面，`web-app.md` 必须补 route、Page VM、Cuu 承接和四态。
6. 若涉及计划执行，PR 必须写 `Target TS paths` / `Target Rust paths`。

---

## 9. 最小下一步建议

推荐下一个施工切片不要直接追 Live2D，也不要先做复杂看板，而是：

1. **正式 Cuu 绿幕资产 + atlas + 视觉 QA**：在已跑通 `idle_breathe` 样张的基础上，生成剩余动作的绿幕帧，抠图、despill、anchor 对齐，替换 procedural sprite。
2. **GAP-CUU-04 + GAP-RUST-01**：让 Tauri 创建独立 `pet` window，消费已落的 body/card 几何 plan 和 webview bridge，默认右下角，加载 `/pet` 或 `?surface=pet`，主窗隐藏后 Cuu 仍常驻。
3. **GAP-RUST-02**：真实 SSE 推到 pet webview，事件驱动 Cuu 动作和气泡。
4. **GAP-WEB-01**：把 Gold Path shell 升级成真实 React SPA routes。
5. **GAP-WEB-02**：建立视觉 QA 门，防止概念还原时出现重叠、空白、移动端不可读。

这样能最快把「AI-native 地基」变成用户能感知的体验：Cuu 会动、用户能点、Web 能走完、Rust 壳开始真正承接桌面能力。
