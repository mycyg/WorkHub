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

> **一句话**：当前 WorkHub 已经打下 TS-first 契约、API、Page VM、Gold Path、Cuu 卡片和 Rust shell contract 的地基，但距离 PRD 与概念图里的完整体验还有明显距离：**Cuu 还没有真正动起来，Rust/Tauri 还没有成为生产桌面壳，Web 还不是完整 React SPA，概念图中的本地同步/托盘/透明桌宠窗/视觉 QA 尚未复现。**

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
- Cuu 还是卡片与 motion hint，没有真实动画资产、sprite manifest、runtime controller。
- 桌面端是 webview adapter + Rust contract crate，还不是可安装的 Tauri v2 桌面应用。
- `client-tauri/src-tauri` 当前没有 `tauri` 依赖、没有 `tauri.conf.json`、没有真实窗口/托盘/通知/deep-link/updater。
- 视觉 QA、Playwright 截图、透明窗口像素检查、Cuu 帧率/多屏/HiDPI 检查都未形成门禁。

### 1.2 离完整 PRD / 概念图复现还有多远

完整 PRD 复现比 P0.5 远得多。当前更接近「TS-first P0.5 骨架」，不是 P1-P5 完整产品：

| 范围 | 当前状态 | 距离完整概念的主要缺口 |
|---|---|---|
| 契约 / Page VM / typed client | 已具备主链路雏形 | OpenAPI 生成、全量页面 VM、权限脱敏、raw endpoint 仍需继续收敛 |
| AgentRun / proposal / replay / cost | P0.5 纵切已成形 | 真实 LLM loop、eval runner、side-effect 工具、全量快照回滚、模型成本账本还需加深 |
| Web | Gold Path shell + render helpers | 全量真实 React SPA、路由、状态、响应式、四态、视觉回归、Cuu 气泡整合 |
| Desktop webview | 能消费同一 VM、桥接 Cuu notice | 仍不是独立桌面体验；缺真实 pet window、本地动作面板、设置/诊断/同步中心 |
| Rust shell | config/http/sse/event planning crate | 缺 Tauri runtime、窗口、托盘、通知、deep-link、设备令牌 vault、本地 sync/delivery/updater |
| Cuu | 卡片、状态、motion hint、sprite runtime MVP、controller MVP | 缺正式小猫动画资产、Rive/Live2D runtime、透明窗口、拖拽、可视化 badge、队列推进、展开卡 |
| 项目检索 / 知识库 | API/证据契约方向明确 | 缺 Cuu-first 检索气泡真实实现、证据卡交互、权限内检索结果分页 |
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
| Desktop webview shell | `apps/desktop-webview/src/browser.ts` | 可读取同一 VM，支持 Cuu demo event 和 desktop notice |
| Desktop Cuu bridge | `apps/desktop-webview/src/desktop-cuu-runtime.ts` | 把 Tauri/mock listener 的 `push-event` / `sse-status` 转成 Cuu notice |
| Cuu sprite runtime MVP | `packages/cuu/src/sprite-manifest.ts`、`apps/desktop-webview/src/cuu-sprite-runtime.ts` | 已把 `CuuMotionHint.sprite_state` 接到可校验 manifest 和 procedural CSS sprite renderer；尚非正式图片资产 |
| Cuu controller MVP | `packages/cuu/src/controller.ts`、`apps/desktop-webview/src/desktop-cuu-runtime.ts` | 已把提醒收敛为 show / replace / queue / badge / drop 决策；desktop runtime 会尊重勿扰与队列策略；尚缺 badge UI 与队列自动推进 |
| Rust contract crate | `client-tauri/src-tauri/src/*` | 有 config、HTTP request plan、SSE frame parser、event channel naming |

### 2.2 容易误判的地方

`desktop-pet-tauri.md` 仍保留大量旧项目迁移参照，例如 `client-tauri/web-src`、`tray.rs`、`sync.rs`、`spec_watch.rs`、`tauri.conf.json`、`invoke_handler!`、`commands/*.rs`。这些是**旧「需求管理大师」实现经验或目标设计锚点**，不是当前 WorkHub 仓库已经存在的源文件。

当前 WorkHub 的真实状态是：

```text
client-tauri/src-tauri/
  Cargo.toml       # 当前只有 serde / serde_json,无 tauri 依赖
  src/config.rs
  src/events.rs
  src/http.rs
  src/lib.rs
  src/sse.rs

apps/desktop-webview/
  src/browser.ts
  src/main.ts
  src/shell-events.ts
  src/desktop-cuu-runtime.ts
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

### 3.2 缺口

| 缺口 | 为什么重要 | 目标落点 |
|---|---|---|
| 真实小猫动画资产 | 当前 runtime 还是 procedural CSS，占位感强；要复现概念图必须替换为正式小猫帧 | `apps/desktop-webview/src/assets/cuu/*` 或未来 `client-tauri/web-src/src/assets/cuu/*` |
| sprite manifest 生产资产化 | schema / default manifest 已落，但需要接真实 frame image 路径和 asset bundle | `packages/cuu/src/sprite-manifest.ts`、`apps/desktop-webview/src/assets/cuu/*` |
| CuuController 可视化完成 | 纯策略 MVP 已落；还需要 badge 层、队列自动推进、dismiss/restore、idle 降级和设置页偏好 | `packages/cuu/src/controller.ts`、`apps/desktop-webview/src/browser.ts`、未来 `apps/desktop-webview/src/cuu/*` |
| 动画 renderer | 需要 CSS sprite / Canvas / Rive renderer | `apps/desktop-webview/src/cuu/SpriteCuu.tsx`、`RiveCuu.tsx` |
| 独立 pet window | 主窗隐藏后 Cuu 仍在桌面活动 | `client-tauri/src-tauri/src/windows.rs`、Tauri `pet` window |
| 拖拽 / 收起 / 静音 / 勿扰 | 不挡事，符合桌宠长期常驻 | Rust window state + TS preference |
| 气泡卡动作真实提交 | Cuu 卡片按钮必须真正调用 API，不只是展示 | `apps/desktop-webview/src/desktop-cuu-runtime.ts` + `packages/api-client` |
| 视觉 / 性能 QA | 透明边缘、帧率、CPU/GPU、HiDPI、多屏必须可验收 | Playwright + Tauri smoke + pixel checks |

### 3.3 Cuu 施工路线

| 阶段 | 目标 | 产物 | 验收 |
|---|---|---|---|
| Cuu-P1a | 把 motion hint 绑定 sprite manifest | `defaultCuuSpriteManifest`、`CuuSpriteState` 校验 | **已落 MVP**：每个 `CuuState` 有 clip、fps、reduced-motion 文案；下一步接正式图片资产 |
| Cuu-P1b | 在 desktop webview 渲染可动 Cuu | `CuuController`、`SpriteCuu`、bubble layer | **部分已落**：notice 内可渲染 procedural sprite，controller 已能决策 show/queue/badge/drop；下一步做真实 frame animation、badge UI 与队列推进 |
| Cuu-P1c | 选项澄清 / 审批 / 证据气泡可点 | Cuu card action handler | 主路径不长篇打字；打回原因用选项 chips |
| Cuu-P2a | 独立 `pet` window | Tauri window + open/hide command | 主窗隐藏后 Cuu 仍显示，可拖动、可收起 |
| Cuu-P2b | Rive state machine | `.riv` + runtime adapter | push-event 触发自然过渡，失败可降级到 sprite |
| Cuu-P3 | Live2D 评估 | `.moc3` 方案或放弃理由 | 只有在表情/陪伴感显著提升时进入 |

### 3.4 Cuu 资产生产细化

1. **锁定角色规范**：橘色虎斑、奶油脸/爪、白蕾丝围兜、黑蝴蝶结、珍珠流苏、红珠。
2. **GPT Image 生成关键状态帧**：每个状态先 4-8 张关键帧，使用纯色背景或直接透明 PNG。
3. **抠图 / 去底**：透明输出优先；若不透明，使用 chroma-key 背景 + 本地去底脚本；边缘用人工/图像工具修正。
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
- `lib.rs` 明确 Rust 只拥有本地壳能力，不复制 permission / workitem status / domain DTO / Cuu animation state。

### 4.2 缺口

| 缺口 | 当前事实 | 目标 |
|---|---|---|
| Tauri v2 runtime | `Cargo.toml` 当前无 `tauri` 依赖 | 新增真实 Tauri app crate、`tauri.conf.json`、capabilities |
| 主窗口 | 当前无 Rust window 创建 | `main` window 承载 desktop webview |
| Cuu pet window | 当前无透明窗口 | `pet` window：transparent / decorations false / always-on-top / skip taskbar |
| 托盘 | 当前只有 event enum | tray menu、未读/审批状态、show/hide Cuu、退出 |
| 系统通知 | 当前只有 channel 名 | OS notification plugin + high/urgent policy |
| deep-link | 当前无 handler | `workhub://` 或迁移兼容 `yqgl://`，打开 workitem/proposal/approval |
| 设备令牌 vault | 当前只是内存结构 | 安全保存、token tail 展示、重新注册、失效恢复 |
| SSE worker | 当前只有 parser/plan | 后台连接 `/api/push/stream`、`/me`，emit 到 webview |
| local sync/delivery | 当前无本地 worker | 文件监听、路径 containment、下载/上传/冲突/交付打包 |
| updater/autostart | 当前无插件 | P5 接 updater + autostart，LAN-first manifest |
| diagnostics | 当前无 UI/runtime | SSE、server、token、filesystem、tray、Cuu runtime 检查 |

### 4.3 Rust shell 施工路线

| 阶段 | Rust 目标 | TS/webview 目标 | 验收 |
|---|---|---|---|
| Rust-P1a | 保持 contract crate，补 Tauri scaffold | desktop-webview 继续消费 API client | `cargo test` + `pnpm --filter @workhub/desktop-webview test` |
| Rust-P1b | 实现 `push-event` / `sse-status` emit worker | `bindDesktopShellCuuRuntime` 订阅真实 Tauri listener | 真实 SSE 可触发 Cuu notice，不依赖 mock |
| Rust-P2a | 主窗 + pet window + tray | 设置页显示连接/token/pet 开关 | 主窗隐藏后 Cuu 常驻；托盘可显隐 |
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
- Cuu 至少能真实播放 `idle → thinking → asking_approval → carrying_document → celebrating`。
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
| GAP-CUU-01 | Sprite manifest schema | `packages/cuu`、`packages/contracts` | Cuu state 已有 | **MVP 已落**：每个 state 有可校验 clip；待生产资产路径 |
| GAP-CUU-02 | Sprite runtime | `apps/desktop-webview/src/cuu-sprite-runtime.ts` | GAP-CUU-01 | **MVP 已落**：notice 可渲染 procedural sprite；待真实 frame / atlas |
| GAP-CUU-02B | Controller visual completion | `packages/cuu/src/controller.ts`、`apps/desktop-webview/src/browser.ts` | GAP-CUU-02 | **策略 MVP 已落**：show / replace / queue / badge / drop 可测；待 badge UI、队列自动推进、dismiss/restore |
| GAP-CUU-03 | Cuu 气泡 action | `apps/desktop-webview/src/desktop-cuu-runtime.ts` | API client | **基础已落**：approval / next question 可提交；待 evidence/search chips 与桌宠展开卡 |
| GAP-CUU-04 | 独立 pet window | `client-tauri/src-tauri` | Rust scaffold | 主窗关闭/隐藏后 Cuu 常驻 |
| GAP-RUST-01 | Tauri v2 scaffold | `client-tauri/src-tauri` | 当前 contract crate | `tauri` 依赖、conf、capabilities、main window |
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

1. **GAP-CUU-02B + 正式资产**：把 controller 的 badge / queue / dismiss 接到页面，并把 procedural sprite 替换为 GPT Image 生成的透明帧。
2. **GAP-RUST-01 + GAP-RUST-02**：把 Rust contract crate 升级成最小 Tauri app，真实 SSE 推到 webview。
3. **GAP-CUU-04**：在 Tauri 里创建独立 `pet` window，让 Cuu 脱离主窗常驻。
4. **GAP-WEB-01**：把 Gold Path shell 升级成真实 React SPA routes。
5. **GAP-WEB-02**：建立视觉 QA 门，防止概念还原时出现重叠、空白、移动端不可读。

这样能最快把「AI-native 地基」变成用户能感知的体验：Cuu 会动、用户能点、Web 能走完、Rust 壳开始真正承接桌面能力。
