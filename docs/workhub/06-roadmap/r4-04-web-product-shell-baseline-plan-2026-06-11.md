---
module: 06-roadmap
layer: R4 / C-WEB / product shell baseline
status: current
owner: workflow
date: 2026-06-11
visuals:
  - ../05-clients/assets/web/web-ai-first-home.png
  - ../05-clients/assets/web/web-workitem-detail.png
  - ../05-clients/assets/web/web-approval-center.png
  - ../05-clients/assets/web/web-deliverable-change-request.png
  - ../05-clients/assets/shared/r0-governance-boundary-concept.svg
evidence:
  - ../05-clients/assets/audit/2026-06-11-r4-web-product-shell-baseline/product-shell-baseline-report.json
  - ../05-clients/assets/audit/2026-06-11-r4-web-product-shell-baseline/contact-sheet.png
---

# R4.4 Web Product Shell Baseline

## 1. 开工阅读

本轮开工前已复读：

- [`r4-03-web-multi-record-page-vm-visual-qa-plan-2026-06-11.md`](./r4-03-web-multi-record-page-vm-visual-qa-plan-2026-06-11.md)
- [`recovery-r0-r4-roadmap-2026-06-08.md`](./recovery-r0-r4-roadmap-2026-06-08.md)
- [`review-driven-r0-r4-detailed-construction-plan-2026-06-08.md`](./review-driven-r0-r4-detailed-construction-plan-2026-06-08.md) 的 R4 段落
- [`../05-clients/web-app.md`](../05-clients/web-app.md)
- [`../05-clients/page-concepts.md`](../05-clients/page-concepts.md)
- [`../05-clients/shared-ui-kit.md`](../05-clients/shared-ui-kit.md)
- 概念图：`web-ai-first-home.png`、`web-workitem-detail.png`、`web-approval-center.png`、`web-deliverable-change-request.png`、`r0-governance-boundary-concept.svg`

概念约束：

- Web 主窗口保持严肃工作界面，不出现 Cuu 本体、Cuu 设置或角色预览。
- Ready route 继续先读 typed Page VM endpoint；REST Page VM 仍是真相源，SSE 只触发刷新。
- 导航必须是真实 path，不回退 hash route。
- AI-first Home、Approval Center、WorkItem Detail、Proposal Detail 需要进入同一个产品 shell baseline。
- desktop/mobile、zh-CN/en-US 均不得横向溢出；文本也不得撑出自身按钮、标题、段落或标签框。

## 2. 本轮范围

R4.4 是 Web 产品壳 baseline，不是完整 React route tree 迁移：

1. 新增 `packages/ui/src/gold-path/product-shell.ts`：
   - 渲染 `data-r4-product-shell="true"` 的 Web 产品壳。
   - 保留 `data-wh-locale`、`data-wh-page-key`、`data-wh-panel`、`data-wh-app-notice` 和 route map，避免破坏浏览器 boot hooks。
   - 提供顶部运行时、左侧 path nav、masthead、指标条、route panels 和右侧 rail。
2. `apps/web/src/routes.ts` 的 ready route 改用 `renderWebProductShell()`：
   - `/`、`/approvals`、`/workitems/:id`、`/proposals/:id` 等仍由原 loader 状态机进入 ready。
   - route-state 的 empty/error/forbidden 继续走 R4.1 helper。
3. 新增 `packages/ui/src/gold-path/product-shell.test.ts`：
   - 覆盖产品 shell marker、固定 chrome 双语、path href、无旧 `.wh-app-root`、无 Cuu、无默认 Kanban、移动端 CSS。
4. 新增 `scripts/qa/r4-web-product-shell-baseline.ts` 与 root `pnpm qa:r4-web-product-shell-baseline`：
   - 生成 Home / Approvals / WorkItem / Proposal 四屏 Chrome 截图与 contact sheet。
   - DOM gate 覆盖 product shell、endpoint-first、双语固定 chrome、path 导航、无 old preview shell、无 weekly fixture、无 Cuu、无 Kanban、无整页横向溢出。
   - 追加 `no_text_box_overflow`，逐个检查可见文本节点及其最近容器的几何 containment，防止标题、按钮、标签和段落撑出自己的框；只有明确 ellipsis 或 scroll 区域才允许裁切/滚动。

## 3. 验收证据

证据目录：

`docs/workhub/05-clients/assets/audit/2026-06-11-r4-web-product-shell-baseline/`

本轮通过的 gate：

- `screenshots_captured=true`
- `product_shell_present=true`
- `four_product_screens_covered=true`
- `ready_routes_use_page_vm_endpoints=true`
- `fixed_chrome_bilingual=true`
- `path_navigation_without_hash=true`
- `no_old_preview_shell=true`
- `no_weekly_fixture_copy_in_ready=true`
- `no_main_window_cuu=true`
- `no_default_kanban=true`
- `no_horizontal_overflow=true`
- `no_text_box_overflow=true`

关键 endpoint proof：

- `/`: `attention:zh-CN -> goldPath:zh-CN`
- `/approvals`: `approvals:en-US -> goldPath:en-US`
- `/workitems/r4-product-workitem`: `workItem:r4-product-workitem:zh-CN -> goldPath:zh-CN`
- `/proposals/r4-product-proposal`: `proposal:r4-product-proposal:en-US -> goldPath:en-US`

本轮针对用户截图反馈额外补强：

- 先让 `no_text_box_overflow` 真正失败，定位到 masthead `h1` 竖向文本盒差 3px。
- 修复产品壳标题 line-height 后重跑 QA，四个 case 的 `textOverflowCount=0`、`textOverflowSamples=[]`。
- 子 agent 只读复核后继续增强 gate：文本元素 rect 必须落在最近产品容器内；非 ellipsis 的 hidden/clip 不再被静默豁免。
- 移动端 nav 由 sticky 改为 static，避免后续滚动时被 sticky topbar 压住；R4.5 继续补真实滚动交互截图。
- R3 run card 的既有回归门 `pnpm qa:cuu-pet-run-card-overflow` 同轮复跑通过，failed run card 的 bubble `clientHeight=scrollHeight`、`clientWidth=scrollWidth`。

验证命令：

- `corepack pnpm --filter @workhub/ui test`
- `corepack pnpm --filter @workhub/ui typecheck`
- `corepack pnpm --filter @workhub/web test`
- `corepack pnpm --filter @workhub/web typecheck`
- `corepack pnpm qa:r4-web-product-shell-baseline`

## 4. PRD / 概念图一致性审查

符合：

- AI-first Home：产品壳把当前焦点和后台运行指标放到首屏，不再以单 demo card 作为唯一入口。
- Approval Center：审批 route 进入同一产品导航和 masthead，保持阻塞收件箱定位。
- WorkItem Detail / Proposal Detail：detail routes 仍由 typed endpoint 供数，并在同一产品壳里呈现验收、证据、变更和交付物。
- Web/桌宠边界：主窗无 Cuu body、无 Cuu settings、无角色预览；Cuu 仍只属于独立 pet window。
- 视觉质量：desktop/mobile 均无整页横向溢出、导航内部溢出和文本盒溢出。

不能宣称：

- 不能宣称完整 React SPA component route tree 已完成；当前仍是 shared HTML render helpers + Web product shell baseline。
- 不能宣称真实 PostgreSQL live daemon 多记录已做浏览器实机联调；当前是 deterministic Page VM QA surface。
- 不能宣称动态 VM 内容已全量服务端本地化；英文 shell 下的动态任务内容仍可能来自服务端原文。

## 5. Bug / Dataflow 审查

- Bug 审查：新增文本盒溢出 gate 后发现 `h1` 竖向 clipping，已通过增大 line-height 修复；只读复核后又补最近容器 containment gate，并把 mobile nav 改为非 sticky，重跑 report 后全部 `textOverflowCount=0`。
- 数据流审查：`loadWebRoute()` 仍先调用对应 Page VM endpoint，再读取 `goldPath` surface 作为 route panel render source；R4.4 没有把状态卡、权限错误或空态伪装成 ready。
- 边界审查：`renderGoldPathAppShell()` 保留给 desktop/shared 旧路径；Web ready route 明确切到 `renderWebProductShell()`，避免旧 preview shell 泄漏。
- 文档审查：本篇与 `web-app.md`、README、总路线图同步更新，后续 R4.5 不再重复宣称 R4.4 待做。

## 6. 后续详细计划

后续状态：R4.5 live browser / route interaction smoke 已落，详见 [`r4-05-web-live-route-interaction-smoke-plan-2026-06-11.md`](./r4-05-web-live-route-interaction-smoke-plan-2026-06-11.md)。

下一刀 R4.6：Rust system-string i18n。

1. Tauri tray、通知、错误、settings 系统串进入 locale contract。
2. Windows/Linux smoke 覆盖：
   - tray/menu 恢复文案。
   - settings/pass-through/hide-on-hover 系统提示。
   - system notification plan 中英文案。
3. 若 macOS 环境不可自动化，保留 macOS 实机待验边界，但代码合同和可跑 mock smoke 必须先落。
