---
module: 06-roadmap
layer: R4 / C-WEB / live browser route interaction
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
  - ../05-clients/assets/audit/2026-06-11-r4-web-live-route-interaction/live-route-interaction-report.json
  - ../05-clients/assets/audit/2026-06-11-r4-web-live-route-interaction/contact-sheet.png
---

# R4.5 Web Live Route Interaction Smoke

## 1. 开工阅读

本轮开工前已复读：

- [`r4-04-web-product-shell-baseline-plan-2026-06-11.md`](./r4-04-web-product-shell-baseline-plan-2026-06-11.md)
- [`recovery-r0-r4-roadmap-2026-06-08.md`](./recovery-r0-r4-roadmap-2026-06-08.md)
- [`review-driven-r0-r4-detailed-construction-plan-2026-06-08.md`](./review-driven-r0-r4-detailed-construction-plan-2026-06-08.md) 的 R4 段落
- [`../05-clients/web-app.md`](../05-clients/web-app.md)
- [`../05-clients/page-concepts.md`](../05-clients/page-concepts.md)
- 概念图：`web-ai-first-home.png`、`web-workitem-detail.png`、`web-approval-center.png`、`web-deliverable-change-request.png`、`r0-governance-boundary-concept.svg`

概念约束：

- R4.5 必须从静态 render proof 前进到真实浏览器事件链路。
- Web 主窗仍不能出现 Cuu、本体设置或默认 Kanban。
- path nav、browser back/forward、locale reload、ready 与四态切换都必须在 Vite dev server 中跑。
- 移动端滚动后继续确认无横向溢出、无文本盒溢出、无 topbar/nav 遮挡。
- REST Page VM 仍是真相源；mock API 只用于 deterministic live-browser smoke，不代表真实 PG live daemon 终局。

## 2. 本轮范围

R4.5 是 live browser route interaction smoke，不是完整 React route tree 迁移：

1. 修复 `apps/web/src/browser.ts` 的 ready route listener 生命周期：
   - 之前每次 ready render 都会在同一个 `root` 上重复绑定 locale / line editor / navigation listener。
   - 本轮新增 `AbortController` 管理 ready route bindings，进入 loading/error 或重新 ready 前先 abort。
   - QA 用 endpoint call count 防止重复 loader 回归。
2. 新增 `apps/web/qa/r4-web-live-route-interaction.ts`：
   - programmatic 启动 Vite dev server。
   - 同时启动本地 mock API server，覆盖 `GET /api/auth/me`、`PATCH /api/auth/preferences`、`GET /api/pages/*`、`GET /api/agent-runs/:id/replay`。
   - 通过 Chrome CDP 驱动真实 DOM click、history back/forward、locale toggle reload、direct route navigation 和移动端 scroll。
3. 新增 root `pnpm qa:r4-web-live-route-interaction`：
   - 转发到 `@workhub/web` 包，保持 Vite 依赖归属在 Web 模块内。
4. 生成 R4.5 截图与 report：
   - `01-home-zh-desktop`
   - `02-approvals-click-zh-desktop`
   - `03-workitem-click-zh-desktop`
   - `04-history-back-approvals`
   - `05-history-forward-workitem`
   - `06-locale-toggle-en-reload`
   - `07-empty-approvals-mobile`
   - `08-forbidden-workitem-desktop`
   - `09-unknown-route-error`
   - `10-proposal-mobile-scrolled`
5. 用户截图复核后补一处移动端文本边界修正：
   - `packages/ui/src/gold-path/render.ts` 的 proposal change row 不再直接显示 raw `target_kind=text_doc`。
   - change kind pill 改为 `deliverableTargetLabel()`，中文显示 `文档`、英文显示 `Text document`。
   - `.wh-row-meta` 在移动端落到下一行并允许换行，避免窄列里把 `text_doc` 挤成竖排碎字。

## 3. 验收证据

证据目录：

`docs/workhub/05-clients/assets/audit/2026-06-11-r4-web-live-route-interaction/`

本轮通过的 gate：

- `dev_server_started=true`
- `screenshots_captured=true`
- `path_nav_clicks=true`
- `history_back_forward=true`
- `locale_toggle_reload=true`
- `ready_empty_forbidden_error_routes=true`
- `ready_routes_use_page_vm_endpoints=true`
- `product_shell_stays_path_mode=true`
- `no_duplicate_route_loader_calls=true`
- `mobile_scroll_no_topbar_nav_overlap=true`
- `no_main_window_cuu=true`
- `no_default_kanban=true`
- `no_old_preview_shell=true`
- `no_weekly_fixture_copy=true`
- `no_hash_navigation=true`
- `no_horizontal_overflow=true`
- `no_text_box_overflow=true`

Endpoint count proof：

- `approvals=3`：click、history back、empty route 各一次。
- `workitem=3`：click、history forward、locale reload 后各一次。
- `workitemForbidden=1`：forbidden route 只触发一次。
- `proposal=1`：mobile scrolled proposal 只触发一次。
- `preferencePatch=1`：locale toggle 只 PATCH 一次。

验证命令：

- `corepack pnpm qa:r4-web-live-route-interaction`

## 4. PRD / 概念图一致性审查

符合：

- AI-first / Approval / WorkItem / Proposal 均通过真实浏览器路径进入产品壳，不再只看静态 HTML。
- 浏览器路径是 path navigation，未回退 `#/`。
- back/forward 会重新进入 loader，继续以 Page VM endpoint 为准。
- locale toggle 采用当前设计的 reload 方式；QA 确认 `PATCH /api/auth/preferences`、reload 后 `document.documentElement.lang=en-US`、active locale 按钮为 `en-US`，且后续 Page VM endpoint 带 `locale=en-US`。
- 主窗继续无 Cuu、无旧 preview shell、无 Kanban、无 weekly fixture 文案。
- 文本越框和移动端滚动遮挡进入阻塞门。
- 移动端 proposal 滚动截图已复核：`Text document` pill 完整落在行内，不再出现 `text_doc` 竖排碎字。

不能宣称：

- 不能宣称完整 React component route tree 已完成。
- 不能宣称真实 PostgreSQL live daemon / Redis / SSE production 环境已用浏览器跑完。
- 不能宣称 dynamic VM 内容已经服务端双语生成。

## 5. Bug / Dataflow 审查

- Bug 审查：修复 ready route 重复 listener 风险；R4.5 report `no_duplicate_route_loader_calls=true`。
- 数据流审查：live browser 仍先读 `/api/pages/{attention|approvals|workitems|proposals}`，再读 `/api/pages/gold-path`；状态页不伪装 ready。
- Locale 审查：client reload 后读取 `me.preferences.locale`，mock API 会持久化 PATCH 结果；如果未来服务端不回写 locale，R4.5 gate 会失败。
- 视觉审查：移动端滚动 proposal 仍 `topbarNavOverlap=false`、`no_horizontal_overflow=true`、`no_text_box_overflow=true`。
- UI 文案审查：proposal change row 使用用户可读的 deliverable kind label，不把 raw enum 作为可见 pill。
- 安全审查：mock API 不含真实 provider key；R2 release gate 继续检查 pending diff secret-like count 和 `reference/` discipline。

## 6. 后续详细计划

R4.6 已落：Rust system-string i18n。详见 [`r4-06-rust-system-string-i18n-plan-2026-06-11.md`](./r4-06-rust-system-string-i18n-plan-2026-06-11.md)。

1. 开工前复读：
   - [`../05-clients/desktop-pet-tauri.md`](../05-clients/desktop-pet-tauri.md)
   - [`../05-clients/i18n-locale-contract-p1-1.md`](../05-clients/i18n-locale-contract-p1-1.md)
   - [`../05-clients/pet-right-click-settings-menu-p1-4.md`](../05-clients/pet-right-click-settings-menu-p1-4.md)
   - [`../05-clients/pet-settings-recovery-p1-5.md`](../05-clients/pet-settings-recovery-p1-5.md)
2. 已把 Tauri tray、通知 fallback、deep-link / single-instance diagnostics 系统串纳入 Rust locale contract。
3. 已补 `cargo test` 与 `pnpm qa:r4-rust-system-i18n`，验证中英 label/fallback/diagnostics、SSE notification locale dataflow 和动态 payload 原文保留。
4. Windows/Linux/macOS 原生菜单截图仍作为后续跨平台实机 smoke，不替代本轮 Rust 代码合同。
