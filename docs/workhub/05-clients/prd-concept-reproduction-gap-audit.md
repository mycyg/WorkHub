---
module: 05-clients
layer: C-WEB / C-PET / Cuu / Rust shell
status: draft
owner: workflow
date: 2026-06-06
visuals:
  - ./assets/shared/prd-concept-gap-map.png
  - ./assets/cuu/cuu-runtime-gap-roadmap.png
  - ./assets/cuu/cuu-live2d-layer-breakdown-concept.png
  - ./assets/cuu/cuu-live2d-front-model-concept.png
  - ./assets/cuu/cuu-live2d-psd-production-board.png
  - ./assets/desktop/desktop-rust-shell-gap-roadmap.png
  - ./assets/web/web-real-ui-gap-roadmap.png
  - ./assets/audit/2026-06-07-current-state/current-state-contact-sheet.png
  - ./assets/audit/2026-06-07-cuu-motion/cuu-motion-contact-sheet.png
  - ./assets/audit/2026-06-07-cuu-card-mode-fix/cuu-motion-contact-sheet-after-card-layout.png
  - ./assets/audit/2026-06-07-cuu-card-mode-fix/cuu-motion-contact-sheet-after-full-body-hidpi-fix.png
  - ./assets/audit/2026-06-08-cuu-psd-draft-probe/pet-psd-draft-cdp-contact-sheet-grid.png
  - ./assets/audit/2026-06-08-cuu-bongo-p1b-runtime/pet-bongo-p1b-gallery-contact-sheet-grid.png
  - ./assets/audit/2026-06-08-cuu-bongo-p1c-first-paint/cuu-motion-contact-sheet.png
---

# PRD 与概念设计复现差距审计

> **一句话**：当前 WorkHub 已经打下 TS-first 契约、API、Page VM、Gold Path、Cuu 卡片、Cuu 18 clip 绿幕 motion pack、基础 idle scheduler、Rust injected pet surface、pet window 几何/拖拽桥、pet command scaffold、启动期 pet body-only 预定位、first-painted 后 show、真实 cursor sampling、`pet-window-state.json` 位置落盘、pet surface 静态视觉 QA、Windows Tauri `PrintWindow` 像素 smoke、最小 Tauri runtime 入口、基础 tray menu、SSE global worker 和 Rust shell contract 的地基，但距离 PRD 与概念图里的完整体验还有明显距离：**Cuu 已有业务状态与 idle / interaction 微动作 full coverage，并能从 Rust 读取 cursor proximity、恢复上次 body anchor 并在首屏渲染后显示 body-only 透明桌宠；Rust/Tauri 已能安装基础托盘、执行主窗/桌宠显隐、连接全局 SSE、转发事件并弹 high/urgent OS 通知；2026-06-07 已通过 Windows debug smoke，确认独立 `Cuu` 窗口 visible/topmost、主窗隐藏后仍可见且在右下角显示 Cuu 和气泡。同日多帧 motion capture 发现 `CUX-MOTION-001`：事件卡片触发后窗口没有扩展，气泡被 body-only 小窗裁切；第一轮 card layout 又暴露只露耳朵 / 局部的失败样例；随后已完成 card mode bridge / placement / compact fallback / full-body HiDPI 站位 / 离线人话卡修复，复核显示窗口可扩到 `394 x 568` 且 Cuu 完整身体可见。随后用户复核确认 8 层裁片 prototype 肉眼差异不足、非 PSD/Cubism，不算鲜活感通过。本轮已新增 GPT Image 绿幕零件板、144 层 `generated-psd-draft-v1` 和 `psd_draft_probe` 运行探针，证明“批量生成部件 -> 抠图编号 -> 调整大小拼接 -> 运行时分层渲染”可行；但因 PSD draft 有恐怖谷风险，默认视觉已切到 `bongo_cuu` 低恐怖谷 renderer。2026-06-08 又补了 Bongo P1b 动作增强、真实 Tauri `PrintWindow` 录屏和 P1c first-frame gate：wave/search/sync/revise/celebrate 可辨，GIF/MP4 已产出，最新 frame 000 已是 body-only Cuu 全身可见。仍缺 Bongo 动作二轮幅度、窗口设置、PSD 清理、遮挡补画、Cubism 绑定、多屏恢复实测、通知点击/偏好、动态未读/审批托盘状态、设备 token 后的私有 SSE 重启、跨平台透明 capture、长期运行 QA 与生产压缩，Web 还不是完整 React SPA，概念图中的本地同步尚未复现。**

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

### 0.5 当前真实截图 / Cuu 动作审计

对应文档：[`current-state-visual-audit-and-construction-plan-2026-06-07.md`](./current-state-visual-audit-and-construction-plan-2026-06-07.md)

![当前页面截图总览](./assets/audit/2026-06-07-current-state/current-state-contact-sheet.png)

![Cuu motion contact sheet](./assets/audit/2026-06-07-cuu-motion/cuu-motion-contact-sheet.png)

![Cuu card mode 修复后动作抓取](./assets/audit/2026-06-07-cuu-card-mode-fix/cuu-motion-contact-sheet-after-card-layout.png)

![Cuu card mode HiDPI 完整身体修复后动作抓取](./assets/audit/2026-06-07-cuu-card-mode-fix/cuu-motion-contact-sheet-after-full-body-hidpi-fix.png)

![Cuu Bongo-style 低恐怖谷默认截图](./assets/audit/2026-06-08-cuu-bongo-runtime/pet-bongo-cuu-cdp-contact-sheet-grid.png)

![Cuu Bongo P1b state gallery](./assets/audit/2026-06-08-cuu-bongo-p1b-runtime/pet-bongo-p1b-gallery-contact-sheet-grid.png)

![Cuu Bongo P1b real Tauri motion](./assets/audit/2026-06-08-cuu-bongo-p1b-tauri/cuu-motion-contact-sheet.png)

![Cuu Bongo P1c first-painted real Tauri motion](./assets/audit/2026-06-08-cuu-bongo-p1c-first-paint/cuu-motion-contact-sheet.png)

本轮真实截图确认：Web 与 desktop 主窗仍是 P0.5 shell；Cuu 能独立出现在右下角。首轮 motion capture 暴露事件卡片触发后未进入 card mode；第一轮修复暴露 Cuu 只露耳朵 / 局部；最终 HiDPI fresh 抓帧确认窗口扩展、Cuu 完整身体、离线人话卡和右侧安全留白均已收口。随后 8 层裁片 prototype 被判定为视觉不通过。本轮新增的 `generated-psd-draft-v1` 和 `psd_draft_probe` 证明“生成零件 -> 抠图编号 -> 调整大小拼接 -> PSD 分层运行”可行；但用户复核认为 PSD draft 有恐怖谷风险，因此默认视觉已切到 `bongo_cuu` 低恐怖谷 renderer。随后 Bongo P1b 已补挥手、检索、同步、打回、抱文件、庆祝和拖拽动作，并通过 browser 状态墙与真实 Tauri GIF/MP4 录屏；P1c 已补 first-painted 首帧门禁，新 contact sheet 的 frame 000 不再是 blank。Live2D 继续清理 PSD、导入 Cubism，而不是把未精修 PSD 默认展示给用户。

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
- Cuu 已有卡片、motion hint、sprite manifest、controller MVP、18 clip 绿幕/alpha motion pack、基础 idle scheduler、Rust injected pet surface、浏览器调试 surface、pet surface 静态视觉 QA、pet window 几何合同、command scaffold、webview pointer/drag bridge、Windows debug `PrintWindow` 像素 smoke、内联静态兜底图、Bongo-style 默认 renderer、Bongo P1b 动作增强、Bongo P1c first-painted 首帧门禁、真实 Tauri Bongo GIF/MP4、Live2D 分层拆件概念图、正面基准稿、PSD 生产板、`contract_only` 图层 manifest、144 层 PSD draft 和 `psd_draft_probe`；`CuuMotionHint.sprite_state` 业务状态与 idle / interaction 微动作已 full coverage，但真实形态仍缺 Bongo 动作二轮幅度、窗口设置、精修 Live2D 分层 PSD / Cubism rig / runtime、anchor / 压缩 / 性能 / 多屏 QA。
- 桌面端是 webview adapter + Rust contract crate + Tauri config/capability scaffold + 最小 `build.rs` / `main.rs` runtime 入口，还不是可安装的 Tauri v2 桌面应用。
- `client-tauri/src-tauri` 当前已有 `tauri` / `tauri-build` 依赖、`tauri.conf.json` / capability scaffold、`build.rs`、`main.rs` pet command handler、启动期 shell config file/env loader、基础 tray setup、基础 SSE worker、deep-link plugin、notification plugin 和 single-instance plugin，并已把 mode resize/position/show、drag、save-position、cursor sampling、tray 左键/右键窗口动作、SSE global stream、token-gated `/me` stream plan、`workhub://` / `yqgl://` deep-link 路由转发、high/urgent OS 通知、第二次启动聚焦/协议 URL 处理执行到真实 Tauri API，位置保存到 Tauri Config `pet-window-state.json`；但还没有设备注册/secure vault/token 更新后的私有 SSE restart、多屏恢复实测、动态未读/审批托盘状态、通知点击/偏好、updater。
- pet surface 输出级静态视觉 QA 和 Windows debug Tauri 像素 smoke 已形成门禁；Playwright alpha 边缘 fixture、跨平台透明 capture、Cuu 帧率/多屏/HiDPI 检查尚未形成门禁。

### 1.2 离完整 PRD / 概念图复现还有多远

完整 PRD 复现比 P0.5 远得多。当前更接近「TS-first P0.5 骨架」，不是 P1-P5 完整产品：

| 范围 | 当前状态 | 距离完整概念的主要缺口 |
|---|---|---|
| 契约 / Page VM / typed client | 已具备主链路雏形 | OpenAPI 生成、全量页面 VM、权限脱敏、raw endpoint 仍需继续收敛 |
| AgentRun / proposal / replay / cost | P0.5 纵切已成形 | 真实 LLM loop、eval runner、side-effect 工具、全量快照回滚、模型成本账本还需加深 |
| Web | Gold Path shell + render helpers | 全量真实 React SPA、路由、状态、响应式、四态、视觉回归、Cuu 气泡整合 |
| Desktop webview | 能消费同一 VM、桥接 Cuu notice，支持 Rust injected pet surface 与浏览器调试 pet surface 只加载 Cuu，并已有 pet pointer/drag bridge、safe `navigate` listener 与 Rust command scaffold 对齐 | 仍缺本地动作面板、设置/诊断、同步中心、跨平台透明 capture 和长期运行 QA |
| Rust shell | config/http/sse/event/window planning/control planning crate + Tauri config/capability scaffold + 最小 Tauri `main.rs` command handler，pet 启动显示/mode/drag/save-position/cursor-sample 已执行到窗口 / AppHandle API，位置已落盘，shell config file/env loader 已接，基础 tray menu 已安装并执行窗口动作，SSE global worker 已能转发 `push-event`/`sse-status`，有 token 时计划 `/me` 私有流，deep-link 已能转 `navigate`/`deep-link` 且 desktop webview 已消费 safe `navigate` route，high/urgent OS 通知和 single-instance 聚焦/协议 URL plan 已落 | 缺设备注册/secure vault/token 更新后私有 SSE restart、多屏恢复实测、动态托盘状态、OS 通知点击来源/偏好/去重、本地 sync/delivery/updater |
| Cuu | 卡片、状态、motion hint、sprite runtime MVP、controller / badge / queue / preference panel MVP、18 clip 绿幕/alpha motion pack、基础 idle scheduler、Rust injected pet surface、浏览器调试 pet surface、pet window 几何/拖拽端口、pet command scaffold、启动期 body-only 预定位、first-painted 后 show、Rust cursor sample、位置落盘、HiDPI 坐标换算、运行期 topmost、Windows debug `PrintWindow` 像素 smoke、card mode 窗口扩展 / 完整身体 / HiDPI 边距 / 离线人话卡修复、内联静态兜底图、high/urgent 系统通知 plan、Bongo-style 默认 renderer、Bongo P1b 动作增强、Bongo P1c 首帧门禁、真实 Tauri Bongo GIF/MP4、Live2D 分层概念图、正面基准稿、PSD 生产板、绿幕零件板、144 层 `generated-psd-draft-v1`、`psd_draft_probe` 与施工专篇 | Cuu 已通过本轮“不能只露耳朵”和“首帧不能 blank”的 P0 门槛，也已证明批量部件拼接能进入运行时；PSD draft 因恐怖谷风险只保留实验线。仍缺 Bongo 动作二轮幅度、窗口设置、PSD 清理、遮挡补画、正式 Cubism/runtime、多屏恢复实测、通知点击/偏好、跨平台透明 capture、长期运行与性能 QA、资产压缩；Hatch/atlas 仅 fallback |
| 项目检索 / 知识库 | API/证据契约方向明确；Cuu `knowledge-search` 可调用 typed API 并回显 evidence card；`use_for_current_task` 可把 evidence refs 带回 WorkItem VM | 缺完整检索页、证据详情展开、权限内检索结果分页和真实知识库持久化 |
| 同步 / 本地交付 | 规划完整 | 当前 WorkHub 仓库未落真实本地 sync worker、冲突 resolver、delivery package |
| QA / 发布 | 单元测试、构建基础、pet surface 静态视觉 QA、Windows debug Tauri 像素 smoke | 缺端到端视觉 QA、alpha 边缘 QA、跨平台透明 capture、Tauri 安装包、updater/autostart 验证 |

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
| Desktop webview shell | `apps/desktop-webview/src/browser.ts` | 可读取同一 VM，支持 Cuu demo event 和 desktop notice；Rust injected `__WORKHUB_SURFACE__`、Tauri window label、`/pet`、`?surface=pet`、`#surface=pet` 或 `pet.html` 会进入 pet surface；主窗已订阅 safe `navigate` route 并切到 Gold Path 面板 |
| Desktop Cuu bridge | `apps/desktop-webview/src/desktop-cuu-runtime.ts` | 把 Tauri/mock listener 的 `push-event` / `sse-status` 转成 Cuu notice |
| Cuu sprite runtime MVP | `packages/cuu/src/sprite-manifest.ts`、`apps/desktop-webview/src/cuu-sprite-runtime.ts` | 已把 `CuuMotionHint.sprite_state` 接到可校验 manifest 和 procedural CSS sprite renderer；尚非正式图片资产 |
| Cuu motion pack | `packages/cuu/src/atlas-manifest.ts`、`apps/desktop-webview/src/cuu-atlas-assets.ts`、`apps/desktop-webview/src/cuu-atlas-runtime.ts`、`apps/desktop-webview/src/assets/cuu/*` | 已把 18 个 GPT Image 绿幕 sprite sheet 抠图为透明 PNG，并合成 `cuu-p1-motion-pack.png` / `cuu.sprite.json`；当前覆盖全部 `CuuMotionHint.sprite_state` 业务状态与 idle / interaction micro action；内联静态 fallback 保证 Tauri/WebView2 大图加载异常时仍有可见 Cuu |
| Cuu pet surface | `apps/desktop-webview/src/pet-surface.ts` | 只渲染 Cuu atlas 本体和一张轻气泡，不加载 Gold Path 主壳；打回理由是固定按钮 |
| Cuu pet visual QA | `apps/desktop-webview/src/pet-surface-qa.ts` | 静态检查透明 root、右下角独立 surface、点击/拖拽热区、非主壳、真实多帧 atlas、card mode 轻气泡和选项优先 |
| Cuu idle scheduler | `packages/cuu/src/idle-scheduler.ts` | 纯 TS 调度呼吸、眨眼、尾巴、看鼠标、睡觉、醒来、拖动、轻敲、挥手等微动作；当前先输出动作语义，视觉仍受 atlas 覆盖度限制 |
| Cuu pet geometry / commands / bridge | `client-tauri/src-tauri/src/pet_window.rs`、`client-tauri/src-tauri/src/pet_commands.rs`、`client-tauri/src-tauri/src/main.rs`、`apps/desktop-webview/src/pet-window-bridge.ts` | 已固定 body-only/card 双模式、右下角定位、展开锚点、work area clamp、鼠标接近判定、拖拽 plan、`set_pet_window_mode` / `start_pet_window_drag` / `save_pet_window_position` / `sample_pet_cursor_near` command 名，已在 `main.rs` 注册 command；setup 会动态创建 `create:false` 的 `pet` window 并注入 pet surface flag；启动期 body-only 显示、mode resize/position/show、drag、save-position 已执行到 Tauri window API，cursor sampling 已执行到 Tauri AppHandle，body anchor 防漂移与 `pet-window-state.json` 落盘已落，并把 hover/drag/release/cursor sample 接进 pet surface |
| Cuu controller / badge / preference MVP | `packages/cuu/src/controller.ts`、`apps/desktop-webview/src/desktop-cuu-runtime.ts`、`apps/desktop-webview/src/cuu-preferences.ts`、`apps/desktop-webview/src/browser.ts` | 已把提醒收敛为 show / replace / queue / badge / drop 决策；desktop runtime 会尊重勿扰与队列策略；browser 侧已有 queue badge、超时后推进下一张卡、默认隐藏的提醒/声音/减少动效/队列上限偏好面板；`knowledge-search` action 可回显 evidence card，`use_for_current_task` 可绑定当前证据到 WorkItem |
| Rust contract crate | `client-tauri/src-tauri/src/*` | 有 config、HTTP request plan、SSE frame parser、event channel naming、`main` / `pet` window plan、show/hide/focus/toggle control plan 与真实 Tauri command、pet geometry/command plan |
| Tauri scaffold | `client-tauri/src-tauri/{Cargo.toml,build.rs,tauri.conf.json,capabilities/default.json,icons/icon.ico,src/main.rs,tests/tauri_scaffold.rs}` | 已把 desktop webview dev/build、`main` / `pet` window config、最小 capability、`withGlobalTauri:true`、Tauri Windows icon、`tauri::Builder` command handler、pet window API 执行和 scaffold contract tests 落到当前仓库；`cargo check` / `cargo test` 可通过 |

### 2.2 容易误判的地方

`desktop-pet-tauri.md` 仍保留大量旧项目迁移参照，例如 `client-tauri/web-src`、旧复杂动态菜单版 `tray.rs`、`sync.rs`、`spec_watch.rs`、`invoke_handler!`、`commands/*.rs`。这些是**旧「需求管理大师」实现经验或目标设计锚点**，不是当前 WorkHub 仓库已经全部存在的源文件。当前 WorkHub 已新增自己的 `client-tauri/src-tauri/src/tray.rs`，但它只代表基础托盘契约与窗口动作入口，不等于旧项目里的未读/同步/接单状态动态菜单已经完整迁移。`tauri.conf.json` 现在已经是当前 WorkHub scaffold 的真实文件，但只代表配置入口，不代表完整生产桌面壳已完成。

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
  src/sse_worker.rs
  src/tray.rs
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
- `cuu-live2d-layered-asset-plan.md`、`cuu-live2d-layer-breakdown-concept.png`、`cuu-live2d-front-model-concept.png`、`cuu-live2d-psd-production-board.png` 和 `cuu-live2d-v0-layer-manifest.json` 已把 Live2D 分层 PSD / Cubism / GIF 兜底规则写成可施工合同。
- 已有 18 clip GPT Image 绿幕 sprite sheets、透明 alpha 图和 motion pack atlas，像素检查四角透明且所有 clip 可见绿边统计为 0。
- Rust injected pet surface 与 `/pet` / `?surface=pet` / `#surface=pet` / `pet.html` 浏览器调试入口已能只显示 Cuu atlas 本体和轻气泡，是 Tauri `pet` window 的前端入口。
- 基础 idle scheduler 已能 deterministic 触发呼吸、尾巴、眨眼、睡觉、醒来、拖动、释放和点击反馈；pet surface 已把 pointer hover/drag/release 接进 scheduler。2026-06-07 已修复 Tauri dev server sprite asset 路径，真实 `Cuu` 顶层窗口 motion capture 已看到 body-only `idle_tail_sway` 和 card mode worried/offline 姿态；只显示静态 fallback、只靠缩放或只露耳朵均判失败。

### 3.2 缺口

| 缺口 | 为什么重要 | 目标落点 |
|---|---|---|
| 真实小猫动画资产 | 18 clip motion pack 已落，业务状态与 idle / interaction micro action 均 full coverage；Bongo-style 默认 renderer、Bongo P1b 动作增强、P1c first-painted 首帧门禁和真实 Tauri GIF/MP4 已落；Live2D 分层概念图、正面基准稿、PSD 生产板、`contract_only` manifest 和 `psd_draft_probe` 已落；要复现概念图仍需 Bongo 动作二轮幅度、窗口设置、正式 PSD、Cubism rig、anchor 微调、透明边缘 QA、WebP/PNG 压缩、帧率与长驻性能验证 | `apps/desktop-webview/src/cuu-bongo-runtime.ts`、`apps/desktop-webview/src/assets/cuu/*`、`apps/desktop-webview/src/assets/cuu/live2d/*` 或未来 `client-tauri/web-src/src/assets/cuu/*` |
| sprite manifest 生产资产化 | atlas schema / runtime JSON manifest / business 与 micro-action full coverage 已落；pet surface 静态视觉 QA、Windows debug `PrintWindow` smoke 和 motion capture 已落；内联静态 fallback 仅作兜底，不作为运行态 motion pass；anchor/fps/loop/reduced-motion、压缩产物、版本化命名、alpha 边缘和跨平台 capture fixture 仍需补齐 | `packages/cuu/src/atlas-manifest.ts`、`apps/desktop-webview/src/assets/cuu/*` |
| CuuController 生产化 | 策略、badge、队列推进、desktop preference panel MVP 已落；还需要 click/restore 细化、idle 降级、真实 Tauri Settings 承接和系统通知 | `packages/cuu/src/controller.ts`、`apps/desktop-webview/src/browser.ts`、未来 `apps/desktop-webview/src/cuu/*` |
| 动画 renderer | `bongo_cuu` 已成为默认 renderer；atlas renderer 已落 18 clip motion pack并作为 fallback；idle scheduler 无卡片时会选择真实动作语义；pet surface QA 会拦截 PSD 默认暴露、fallback/主壳/非选项优先回退；Windows debug smoke 已验证真实 pet 窗口可见像素，motion capture 已验证 dev sprite path 修复后的非缩放动作；Bongo P1b 已补 wave/search/sync/revise/carry/celebrate/drag，并通过 browser 状态墙和真实 Tauri GIF/MP4；P1c 已通过 first-frame gate；仍需主窗 notice 替换、动作幅度二轮、alpha 边缘和跨平台透明 capture | `apps/desktop-webview/src/cuu-bongo-runtime.ts`、`apps/desktop-webview/src/cuu-atlas-runtime.ts`、`apps/desktop-webview/src/pet-surface-qa.ts` |
| 独立 pet window | Rust 动态创建 `create:false` 的 `pet` window、injected pet surface、browser/debug surface、body-only/card 几何合同、command scaffold、前端 bridge、主窗隐藏后像素 smoke 已落；仍缺多屏恢复实测、安装包 smoke 和跨平台透明 capture | `client-tauri/src-tauri/src/windows.rs`、`client-tauri/src-tauri/src/pet_window.rs`、`client-tauri/src-tauri/src/pet_commands.rs`、Tauri `pet` window、`apps/desktop-webview/src/pet-surface.ts`、`scripts/qa/cuu-tauri-smoke.ps1` |
| 拖拽 / 收起 / 静音 / 勿扰 | 静音 / 勿扰 / 减少动效 / 队列上限已有 desktop webview 面板；拖拽 bridge、Rust drag plan 和真实位置记忆已落；收起细节与真实 Tauri Settings 承接仍待补 | Rust window state + TS preference |
| 活体 idle scheduler | 基础 scheduler、pointer hover/drag/release bridge、Rust cursor sample 已落，且 idle / interaction 动作已可映射到真实 atlas clip；磁盘位置恢复已落；仍缺系统 idle 采样、多屏实测和长驻 QA | `apps/desktop-webview/src/pet-surface.ts`、`apps/desktop-webview/src/pet-window-bridge.ts`、`packages/cuu/src/idle-scheduler.ts` |
| 气泡卡动作真实提交 | Cuu 卡片按钮必须真正调用 API，不只是展示 | `apps/desktop-webview/src/desktop-cuu-runtime.ts` + `packages/api-client` |
| 视觉 / 性能 QA | pet surface 静态合同已能验透明语义、右下角独立 surface、真实 atlas 和选项优先；Windows debug smoke 已能对真实 `Cuu` hwnd 做像素检查；透明边缘、帧率、CPU/GPU、HiDPI、多屏和跨平台 capture 仍必须在真实 Tauri 窗口验收 | Playwright + Tauri smoke + pixel checks |

### 3.3 Cuu 施工路线

| 阶段 | 目标 | 产物 | 验收 |
|---|---|---|---|
| Cuu-P1a | 把 motion hint 绑定 sprite / atlas manifest | `defaultCuuSpriteManifest`、`CuuSpriteAtlasManifest`、`CuuSpriteState` 校验 | **业务状态与 micro-action full coverage 已落**：每个 `CuuState` 有 procedural clip、fps、reduced-motion 文案，18 个真实 atlas clip 已落，并可通过 `require_full_motion_coverage` 与 `require_idle_micro_action_coverage`；下一步做 anchor/压缩/QA 与主窗替换 |
| Cuu-P1b | 在 desktop webview 渲染可动 Cuu | `CuuController`、atlas renderer、bubble layer、pet surface QA | **P1 已落**：notice 内可渲染 procedural sprite，pet surface 可渲染 18 clip motion pack atlas，controller 已能决策 show/queue/badge/drop，browser 已有 queue badge、超时推进和偏好面板，idle scheduler 与 pointer bridge 已接，pet surface 静态视觉合同、Windows `PrintWindow` smoke、motion capture、dev asset path 修复和非缩放动作验收已落；下一步替换主窗 notice 为真实 frame animation、做 alpha 边缘和跨平台透明 capture QA |
| Cuu-P1c | 选项澄清 / 审批 / 证据气泡可点 | Cuu card action handler | 审批/下一题/知识检索回显/证据带回当前任务已落；待证据详情展开和完整检索页 |
| Cuu-P2a | 独立 `pet` window | Tauri window + open/hide command + pet surface | **基础已落**：Rust 动态创建真实透明 `pet` window，注入 pet surface flag，body/card 几何、拖拽/模式 bridge、位置记忆、主窗隐藏后可见像素 smoke 已落；待收起细节、多屏恢复、安装包 smoke 和跨平台透明 capture |
| Cuu-P2b | Rive state machine | `.riv` + runtime adapter | push-event 触发自然过渡，失败可降级到 sprite |
| Cuu-P3 | Live2D 分层模型 | 分层 PSD、Cubism `.moc3` / `.model3.json`、Tauri runtime adapter | Cuu 的呼吸、眨眼、看鼠标、耳朵、尾巴、流苏可由事件触发，加载失败可降级 sprite |

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

- `client-tauri/src-tauri/src/config.rs`：server url、device token、device name 的基础结构；支持 Tauri Config `workhub-shell-config.json` 与 `WORKHUB_*` / legacy `YQGL_CLIENT_TOKEN` 环境变量加载，空 token 不算可信设备。
- `http.rs`：daemon URL 和 device token header plan。
- `sse.rs`：SSE target、frame parser、chunk buffer、push payload/status payload、startup target 选择。
- `sse_worker.rs`：真实后台 SSE worker，使用 `tauri::async_runtime::spawn` + `reqwest` rustls stream，按 shell config 连接 global stream；有可信设备 token 时才加入 `/me`，按 chunk 解析并 emit `push-event` / `sse-status`；收到 high/urgent 私有事件时调用 `notify.rs` 生成 system notification plan。
- `notify.rs`：系统通知策略、进程内 dedupe 和 Tauri plugin adapter；全局流、普通 notice 不弹 OS 通知，预算耗尽/告警、审批、proposal、run/escalation、sync conflict 和 high/urgent notification 可形成 `ShellSystemNotificationPlan`，SSE 重放不会重复弹同一 `id/event/route`。
- `events.rs`：`push-event`、`sse-status`、`navigate`、`deep-link`、`tray-action`、`system-notification`、`single-instance` channel 命名；desktop webview 已解析 safe `navigate` route string / `{route}` / `{path}`。
- `windows.rs`：`main` / `pet` window plan contract，`pet` 固定 transparent、decorations false、always-on-top、skip taskbar。
- `window_controls.rs`：`show/hide/focus/toggle main/pet` 的 typed control plan 与 command 名称；deep-link route 做安全校验，pet 操作不抢焦点；`main.rs` 已注册同名 Tauri command 并执行到真实 window API。
- `deep_link.rs`：`workhub://` / `yqgl://` route 白名单、target 映射与 path traversal 防护；`main.rs` 已接 `tauri-plugin-deep-link`，启动 URL / 运行时 URL 会执行主窗聚焦并发 `deep-link` 事件。
- `single_instance.rs`：第二次启动 argv/cwd 解析、主窗聚焦 plan、`workhub://` / `yqgl://` URL 提取与非法协议 URL 诊断；`main.rs` 已接 `tauri-plugin-single-instance` 并复用 deep-link 执行路径。
- `tray.rs`：基础 tray menu contract，固定 `workhub-main-tray`、tooltip、五个菜单项和 `TrayMenuActionPlan`；`main.rs` 已用 `TrayIconBuilder` 安装真实托盘，左键打开主窗，右键菜单可打开/隐藏主窗、显示/隐藏 Cuu、打开收件箱、退出。
- `tauri.conf.json`：声明 desktop webview 的 `devUrl=1420` / build dist、`main` 与 `pet` window config；`skipTaskbar` 暂留在 WorkHub 自有 plan，避免未确认字段提前进入 Tauri schema。
- `capabilities/default.json`：当前只给 `main` / `pet` `core:default`，文件系统、shell、process 等能力后续按模块最小化开启。
- `tests/tauri_scaffold.rs`：把配置与 `ShellWindowPlan` / capability 绑定成可测契约。
- `lib.rs` 明确 Rust 只拥有本地壳能力，不复制 permission / workitem status / domain DTO / Cuu animation state。
- `main.rs` 已注册 `tauri-plugin-notification`，OS notification 由 Rust 侧按 `notify.rs` plan 请求权限并展示。

### 4.2 缺口

| 缺口 | 当前事实 | 目标 |
|---|---|---|
| Tauri v2 runtime | 已有 `tauri` / `tauri-build` 依赖、`tauri.conf.json` / capability scaffold、`build.rs`、`main.rs` command handler；`pet` window config `create:false`，setup 动态创建并注入 pet surface flag；pet 启动显示/mode/drag/save-position 已执行到 window API，cursor sampling 已执行到 AppHandle，body anchor 位置已写入 `pet-window-state.json`，shell config file/env loader、基础托盘、SSE global-or-me worker、deep-link plugin、notification plugin 与 single-instance plugin 已在 setup 安装 | 补设备注册/secure vault/token 更新后 worker restart、多屏恢复实测、安装包 smoke |
| 主窗口 | 已有 `main` window plan + Tauri config + `show/hide/focus` control plan；`main.rs` 已注册 `show_main_window` / `hide_main_window` / `focus_main_route` 并执行到真实 Tauri window API；desktop webview 已消费 safe `navigate`；托盘、菜单、deep-link、system notification plan 和第二次启动可打开/隐藏/聚焦主窗 | `main` window 承载 desktop webview；后续补 OS notification click source 和跨平台 smoke |
| Cuu pet window | 已有 `pet` window plan + Tauri config + `show/hide/toggle` control plan；生产 Tauri 由 Rust 动态创建 `create:false` pet window 并注入 surface flag，浏览器调试保留 `/pet` / `?surface=pet` / `#surface=pet` / `pet.html`；body/card 几何 plan、command scaffold 与拖拽 bridge 已落；`main.rs` 已在 setup 启动显示 body-only Cuu，并注册 `show_pet_window` / `hide_pet_window` / `toggle_pet_window` 执行到真实 Tauri window API；托盘可 toggle Cuu；Windows debug smoke 已证明主窗隐藏后 `Cuu` 窗口仍可见；`skipTaskbar` 仍在 WorkHub plan | `pet` window：transparent / decorations false / always-on-top / skip taskbar；后续补多屏恢复实测、安装包 smoke 和跨平台透明 capture |
| 托盘 | 已有 `src/tray.rs` contract 与 `main.rs` Tauri `TrayIconBuilder` runtime；左键打开 WorkHub，右键菜单支持打开/隐藏主窗、显示/隐藏 Cuu、打开收件箱、退出，并广播 `tray-action` plan | 未读/审批状态、tooltip/title 更新、同步子菜单、通知点击联动 |
| 系统通知 | 已有 `notify.rs` high/urgent policy、进程内 dedupe、`tauri-plugin-notification` runtime、`system-notification` plan event；`sse_worker.rs` 只对私有流的预算/审批/proposal/run/conflict/high notice 触发；webview 已能消费后续点击产生的 safe `navigate` | OS notification click source、勿扰/偏好接线、去重持久化、安装包权限 smoke |
| deep-link / single-instance | 已接 `tauri-plugin-deep-link` 与 `tauri-plugin-single-instance`、scheme 配置、启动/运行时 URL listener、route 白名单、第二次启动 argv/cwd plan 和 `navigate`/`deep-link`/`single-instance` 事件；支持 `workhub://open/task/{id}`、proposal、run replay、approval、inbox、settings、me、cost 和兼容 `yqgl://r|p|inbox...` | 安装包协议注册 smoke、通知点击联动和更多业务 target |
| 设备令牌 vault | 当前可从 config file/env 读取 token 并只展示 tail；尚未安全保存 | 安全保存、token tail 展示、重新注册、失效恢复 |
| SSE worker | 已有 `sse_worker.rs` runtime；当前 setup 从 shell config file/env 读取配置，连接 `/api/push/stream`，发 `push-event` 和 `sse-status`，5s retry；`/me` 仅在 config 有可信 token 时进入 plan | 接设备注册/secure vault 后的 ConfigState 和 worker restart，补 run/session/proposal 按需订阅和端到端 smoke |
| local sync/delivery | 当前无本地 worker | 文件监听、路径 containment、下载/上传/冲突/交付打包 |
| updater/autostart | 当前无插件 | P5 接 updater + autostart，LAN-first manifest |
| diagnostics | 当前无 UI/runtime | SSE、server、token、filesystem、tray、Cuu runtime 检查 |

### 4.3 Rust shell 施工路线

| 阶段 | Rust 目标 | TS/webview 目标 | 验收 |
|---|---|---|---|
| Rust-P1a | 保持 contract crate，补 Tauri scaffold | desktop-webview 继续消费 API client | **window plan + window control plan + `tauri.conf.json` + capability scaffold + `tauri` dependency + `build.rs` + `main.rs` command handler + window control API + 基础 tray menu + SSE global worker + deep-link handler + high/urgent system notification + single-instance 执行已落**；下一步真实配置/设备 token、click-through、偏好与持久化接线 |
| Rust-P1b | 实现 `push-event` / `sse-status` emit worker | `bindDesktopShellCuuRuntime` 订阅真实 Tauri listener | **基础已落**：global SSE 可触发 Cuu notice，不依赖 mock；config file/env token 可让启动期计划 `/me`；待设备注册/secure vault 后 `/me` restart 与 E2E smoke |
| Rust-P2a | 主窗 + pet window + tray | 设置页显示连接/token/pet 开关 | **启动期 pet body-only 显示 + 主窗隐藏后 Cuu 像素 smoke 已落**；继续补托盘状态动态、多屏可恢复、安装包 smoke 和 Settings 承接 |
| Rust-P2b | OS notification click source / dedup / preference bridge + device vault；deep-link route expansion | **webview 响应 safe `navigate` 已落**；继续接通知点击来源与偏好 | 系统通知点击能打开 proposal / approval，勿扰时只入队不弹窗，二次启动协议 URL 在安装包 smoke 中确认 |
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
- Cuu card mode 中角色必须完整、可爱、稳定地站在右下角；只露耳朵、裁尾、裁爪、脚底 anchor 漂移都判失败。
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
| GAP-CUU-01 | Sprite manifest schema | `packages/cuu`、`packages/contracts` | Cuu state 已有 | **MVP + full coverage 已落**：每个 state 有可校验 procedural clip，真实 atlas schema、runtime JSON、18 clip motion pack、内联静态 fallback 和 pet surface 静态视觉 QA 已落；待 anchor、压缩产物、生产 JSON 扩展、alpha 边缘和跨平台 capture QA |
| GAP-CUU-02 | Sprite runtime | `apps/desktop-webview/src/cuu-sprite-runtime.ts`、`apps/desktop-webview/src/cuu-atlas-runtime.ts`、`apps/desktop-webview/src/pet-surface-qa.ts`、`packages/cuu/src/idle-scheduler.ts` | GAP-CUU-01 | **MVP 已落**：notice 可渲染 procedural sprite，pet surface 可渲染 18 clip motion pack atlas，基础 idle scheduler 与 pointer bridge 已落，idle micro action 可选真实 atlas clip，静态 QA 会拦截非透明/非独立/非选项优先回退，Windows debug smoke 会验证真实 pet window 可见像素；待主窗替换、跨平台 Tauri 输入与透明 capture QA |
| GAP-CUU-02B | Controller visual completion | `packages/cuu/src/controller.ts`、`apps/desktop-webview/src/cuu-preferences.ts`、`apps/desktop-webview/src/browser.ts` | GAP-CUU-02 | **MVP 已落**：show / replace / queue / badge / drop 可测，desktop badge、超时推进和偏好面板已接；待真实 Tauri Settings 承接、通知点击/偏好和真实窗口视觉 QA |
| GAP-CUU-03 | Cuu 气泡 action | `apps/desktop-webview/src/desktop-cuu-runtime.ts` | API client | **基础已落**：approval / next question / knowledge-search / use_for_current_task 可提交；evidence card 可带 `evidence_refs` 回 WorkItem VM；待证据详情展开与完整检索页 |
| GAP-CUU-04 | 独立 pet window | `client-tauri/src-tauri` + `apps/desktop-webview/src/pet-surface.ts` + `apps/desktop-webview/src/pet-surface-qa.ts` + `apps/desktop-webview/src/pet-window-bridge.ts` + `scripts/qa/cuu-tauri-smoke.ps1` | Rust scaffold + 绿幕 atlas | **surface + 静态视觉 QA + 几何/命令/拖拽端口 + 真实 Tauri `pet` window startup + HiDPI 坐标换算 + runtime topmost + Windows debug `PrintWindow` 像素 smoke 已落**；待可拖动截图、多屏恢复实测、安装包 smoke、跨平台透明 capture 和长期 idle 性能 QA |
| CUX-MOTION-001 | card mode resize / 裁切修复 | `apps/desktop-webview/src/pet-window-bridge.ts`、`apps/desktop-webview/src/pet-surface.ts`、`apps/desktop-webview/src/shell-events.ts`、`client-tauri/src-tauri/src/main.rs`、`scripts/qa/cuu-tauri-motion-capture.ps1` | GAP-CUU-04 | **已修**：事件卡触发后 `pet` 窗口可进入 card mode，invoke/placement 失败会走 compact fallback；最终 fresh 抓帧证明 Cuu 完整身体可见、card bubble 有 HiDPI 安全边距、离线卡不暴露 raw SSE error |
| CUX-MOTION-002 | 非缩放鲜活感 / 真实动作资源 | `apps/desktop-webview/src/cuu-atlas-runtime.ts`、`apps/desktop-webview/src/pet-surface.ts`、`apps/desktop-webview/src/pet-surface.test.ts`、`scripts/qa/cuu-tauri-motion-capture.ps1` | CUX-MOTION-001 fixed | **已修 P1**：dev server `/src/assets/...` 不再被误改成 `./assets/...`，pet surface 运行态不依赖 inline 静态 fallback，body-only 默认 `idle_tail_sway`，真实 Tauri contact sheet 可见摇尾和 card mode 姿态；只露耳朵、只缩放、只显示 fallback 均判失败 |
| CUX-BONGO-001 | Bongo-style 低恐怖谷默认 Cuu | `apps/desktop-webview/src/cuu-bongo-runtime.ts`、`apps/desktop-webview/src/pet-surface.ts`、`docs/workhub/05-clients/cuu-bongo-style-runtime-plan.md` | CUX-MOTION-002 | **已落 P1 默认**：默认 `data-cuu-visual-mode="bongo_cuu"`，browser contact sheet 与 DOM 证明 PSD layer 不再默认暴露 |
| CUX-BONGO-002 | Bongo P1b 动作增强与真实 Tauri 录屏 | `apps/desktop-webview/src/cuu-bongo-runtime.ts`、`apps/desktop-webview/src/pet-surface.test.ts`、`apps/desktop-webview/src/pet-surface-qa.ts`、`scripts/qa/cuu-tauri-motion-capture.ps1` | CUX-BONGO-001 | **已落 P1b**：31 组件、search/sync/spark 道具层、wave/search/sync/revise/carry/celebrate/drag 可辨；browser 状态墙与真实 Tauri GIF/MP4 已产出 |
| CUX-BONGO-003 | Bongo P1c first-painted 首帧稳定 | `client-tauri/src-tauri/src/main.rs`、`apps/desktop-webview/src/pet-surface.ts`、`apps/desktop-webview/src/pet-surface.test.ts`、`scripts/qa/cuu-tauri-motion-capture.ps1` | CUX-BONGO-002 | **已修**：Rust 启动只预定位 `pet` window，pet surface 首屏后同步窗口模式；motion capture 先等 `first_frame_gate` 达标后才写 frame 000，真实 Tauri contact sheet frame 000 已是 Cuu 全身可见 |
| GAP-CUU-05 | Live2D 分层模型 | `docs/workhub/05-clients/cuu-live2d-layered-asset-plan.md`、`apps/desktop-webview/src/assets/cuu/live2d`、未来 `apps/desktop-webview/src/cuu-live2d-runtime.ts` | Cuu 形象规范 + Bongo / sprite 降级层 | **分层概念图 + 正面基准稿 + PSD 生产板 + 绿幕零件板 + 144 层 PSD draft v1 + `contract_only`/prototype manifest + PSD probe 测试门禁已落**；因恐怖谷风险为实验线，待 PSD 清理、遮挡补画、Cubism 绑定、`.model3.json` 导出、Tauri runtime 与 Bongo fallback |
| GAP-CUU-06 | Hatch Pet 多动作包 fallback | `apps/desktop-webview/src/assets/cuu/hatch/cuu-hatch-v1/*`、`packages/cuu/src/hatch-state-map.ts`、`apps/desktop-webview/src/cuu-hatch-runtime.ts` | Cubism 短期阻塞或 fallback 需求 | 按 8 x 9 / 192 x 208 / 9 state 合同生成 Cuu Q 版 spritesheet、`pet.json`、contact sheet、GIF 预览和 QA report；只作为 fallback / motion storyboard，不替代 Live2D 主线 |
| GAP-RUST-01 | Tauri v2 scaffold | `client-tauri/src-tauri` | 当前 contract crate | **window plan + window control plan + window control commands + pet geometry/command plan + config/capability scaffold + 最小 Tauri `build.rs`/`main.rs` + dynamic pet creation + Rust injected pet surface + pet startup display + HiDPI physical→logical 换算 + runtime topmost + pet window API + cursor sampling + `pet-window-state.json` 位置落盘 + 基础 tray menu + Windows Tauri 像素 smoke 已落**；待补多屏恢复实测、安装包 smoke 和跨平台 capture |
| GAP-RUST-02 | SSE worker emit | `client-tauri/src-tauri/src/sse_worker.rs` | GAP-RUST-01 | **基础已落**：global stream 真实连接/重试/emit；待真实配置、token 后私有流 restart、run/session/proposal 按需订阅 |
| GAP-RUST-03 | Tray / notification / deep-link / single-instance | `client-tauri/src-tauri/src/{tray,notify,deep_link,single_instance}.rs`、`apps/desktop-webview/src/{browser,shell-events}.ts` | GAP-RUST-01 | **Tray basics + deep-link basics + webview navigate listener + high/urgent system notification basics + process dedupe + single-instance basics 已落**；待补动态未读/审批菜单、OS notification click source / persistent dedup / preference bridge、安装包协议和系统通知权限 smoke |
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

1. **Pet card P1.2**：离线轻卡已先做人话化；继续把审批 / 澄清 / 证据 / 预算轻卡打磨成人话卡，并让卡片出现前先触发对应 Bongo 动作。
2. **Bongo P1d 动作与窗口体验**：在 first-painted 首帧已修的基础上，继续补缩放、透明度、贴边、hover 避让、显示/隐藏快捷入口，并加大抱文件 / 审批敲桌 / 完成庆祝的动作幅度。
3. **GAP-CUU-05 Live2D PSD + Cubism**：card mode 只露耳朵已作为 P0 bug 修复并保留回归样例；8 层裁片 prototype 和未精修 PSD draft 都不能默认展示。继续清理 `generated-psd-draft-v1`、补画遮挡、导入 Cubism 并录屏验证眨眼、呼吸、尾巴、流苏和任务动作；只有美术 QA 通过后才允许替换 Bongo 默认。
4. **GAP-CUU-04 + GAP-RUST-01**：在独立 `pet` window 已可见、card mode geometry 和 first-painted 首帧已修的基础上，继续补拖拽后位置截图、多屏恢复、安装包 smoke 和跨平台透明 capture。
5. **GAP-RUST-02**：真实 SSE 推到 pet webview，事件驱动 Cuu 动作和气泡。
6. **GAP-WEB-01**：把 Gold Path shell 升级成真实 React SPA routes，先做 AI-first Home 和 option-first Intake。
6. **GAP-WEB-02**：建立视觉 QA 门，防止概念还原时出现重叠、空白、移动端不可读。

这样能最快把「AI-native 地基」变成用户能感知的体验：Cuu 会动、用户能点、Web 能走完、Rust 壳开始真正承接桌面能力。
