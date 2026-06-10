---
module: 06-roadmap
layer: R4 / C-WEB / route loader
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
  - ../05-clients/assets/audit/2026-06-11-r4-web-route-registry-loader/route-registry-loader-report.json
  - ../05-clients/assets/audit/2026-06-11-r4-web-route-registry-loader/contact-sheet.png
---

# R4.2 Web Route Registry + Loader

## 1. 开工阅读

本轮开工前已复读：

- [`recovery-r0-r4-roadmap-2026-06-08.md`](./recovery-r0-r4-roadmap-2026-06-08.md)
- [`review-driven-r0-r4-detailed-construction-plan-2026-06-08.md`](./review-driven-r0-r4-detailed-construction-plan-2026-06-08.md) 的 R4 与开工阅读清单
- [`r4-01-web-route-state-matrix-plan-2026-06-11.md`](./r4-01-web-route-state-matrix-plan-2026-06-11.md)
- [`../05-clients/web-app.md`](../05-clients/web-app.md)
- 概念图：`web-ai-first-home.png`、`web-workitem-detail.png`、`web-approval-center.png`、`web-deliverable-change-request.png`、`r0-governance-boundary-concept.svg`

概念约束：

- Web 主窗口继续是派活、管理、审批、成本和回放工作台；接活、干活、本地同步仍属于桌面客户端。
- 主窗口不得出现 Cuu 本体、Cuu settings、Cuu 资产或桌宠角色栏。
- Web 默认入口是 AI-first home，不回退成 Kanban。
- 中英双语与文本不出框是验收门，不是后续 polish。

## 2. 本轮范围

R4.2 只解决真实 URL route registry 与 loader 边界，不宣称完整 React SPA 已完成：

1. 新增 `apps/web/src/routes.ts`：
   - 注册 `/`、`/intake/:sessionId`、`/approvals`、`/workitems/:id`、`/proposals/:id`、`/agent-runs/:id/replay`、`/dashboard/cost`、`/settings`。
   - 统一 loader 状态：`idle/loading/ready/empty/error/forbidden`。
   - 把 `packages/ui/src/route-state.ts` 的状态卡接入真实 loader，而不是只在 QA matrix 中独立渲染。
2. 改造 `apps/web/src/browser.ts`：
   - 启动时按 `window.location.pathname` 匹配 route，而不是只加载 gold-path hash shell。
   - `/` 先读 `client.pages.attention({ locale })`，`/approvals` 先读 `client.pages.approvals({ locale })`，`/dashboard/cost` 先读 `client.pages.cost({ locale })`。
   - `not_identified` 仍交给 boot identity flow，不被 error state 吞掉。
   - ready shell 导航改为真实 path，并用 `history.pushState/popstate` 进入 route loader。
3. 改造 `packages/ui/src/gold-path/app-shell.ts`：
   - 新增 `linkMode: "hash" | "path"`，默认兼容旧 hash，Web route loader 使用 path。
4. 新增 `scripts/qa/r4-web-route-registry-loader.ts` 与 root `pnpm qa:r4-web-route-registry-loader`：
   - 用真实 route loader 生成 loading / ready / empty / error / forbidden 页面。
   - Chrome 截图 + DOM dump gate：typed Page VM endpoint 调用顺序、真实 path 导航、双语状态 copy、无 Cuu 主窗标记、无 Kanban、无横向溢出。

## 3. 验收证据

证据目录：

`docs/workhub/05-clients/assets/audit/2026-06-11-r4-web-route-registry-loader/`

本轮通过的 gate：

- `screenshots_captured=true`
- `registry_has_expected_routes=true`
- `ready_routes_use_page_vm_endpoints=true`
- `route_status_coverage=true`
- `bilingual_state_copy=true`
- `path_navigation_without_hash=true`
- `no_main_window_cuu=true`
- `no_default_kanban=true`
- `no_horizontal_overflow=true`

关键 endpoint proof：

- `/` ready case: `attention:zh-CN -> goldPath:zh-CN`
- `/approvals` ready case: `approvals:en-US -> goldPath:en-US`
- `/dashboard/cost` ready case: `cost:zh-CN -> goldPath:zh-CN`

验证命令：

- `corepack pnpm --filter @workhub/web test`：10/10 通过。
- `corepack pnpm --filter @workhub/web typecheck`：通过。
- `corepack pnpm --filter @workhub/ui test`：36/36 通过。
- `corepack pnpm --filter @workhub/ui typecheck`：通过。
- `corepack pnpm --filter @workhub/web build`：通过。
- `corepack pnpm qa:r4-web-route-registry-loader`：通过，生成 Chrome 截图与 JSON report。
- `corepack pnpm qa:r4-web-route-state-matrix`：通过，R4.1 matrix 回归未被 path link mode 破坏。
- `corepack pnpm verify`：通过，含全仓 typecheck/test、R2 release gate 与 Cuu R3 smoke。

## 4. PRD / 概念图一致性审查

符合：

- R4-1 四态：真实 route loader 已能渲染 loading / empty / error / forbidden。
- R4-2 真实数据入口：前三个高频 route 已先调用 typed Page VM endpoint，不再只读 `/api/pages/gold-path`。
- R4-3 设计边界：report gate 明确无 Cuu 主窗标记、无默认 Kanban、无横向溢出。
- 双语：状态卡 zh-CN / en-US 已覆盖；ready shell 继续复用 locale toggle 与 `PageRequestOptions.locale`。

不能宣称：

- 不能宣称完整 React SPA 已完成；当前仍复用共享 HTML render helpers 与 gold-path shell 作为 ready surface。
- 不能宣称多 work item / proposal / approval / cost usage 已完成产品级视觉验收。
- 不能宣称动态 VM 内容都已服务端本地化；用户原文、LLM 摘要、manifest 仍保持 daemon 原文边界。

## 5. 后续详细计划

后续状态：R4.3 multi-record Page VM visual QA 已落，详见 [`r4-03-web-multi-record-page-vm-visual-qa-plan-2026-06-11.md`](./r4-03-web-multi-record-page-vm-visual-qa-plan-2026-06-11.md)。以下是 R4.2 交给 R4.3 的原始计划，已由 R4.3 完成并继续交给 R4.4 product shell polish。

1. 建立 Web seed client 或复用 R1/R2 PG smoke，生成至少：
   - 2 条不同 work item。
   - 2 条 proposal，包含 normal + conflict / line-editor / structured patch 代表。
   - 2 条 approval request，覆盖 pending + empty。
   - 至少 1 条 cost notice 或 budget risk。
2. 扩展 `qa:r4-web-route-registry-loader`：
   - ready screenshots 不再只使用 `weekly_report_manifest_doc`。
   - 为 `/workitems/:id`、`/proposals/:id`、`/agent-runs/:id/replay` 补 ready + forbidden/not-found route-state case。
   - 继续 gate path navigation、no Cuu、no Kanban、no horizontal overflow。
3. 数据流审查：
   - Page VM endpoint 必须先于 fallback shell。
   - SSE 仍只作为后续增量提示，不在本轮冒充真相。
   - 权限失败必须落 forbidden state，404/空队列必须落 empty state。
4. 文档更新：
   - `web-app.md` 更新 R4.3 多记录视觉证据。
   - 两份 roadmap 更新 R4.3 完成边界。
   - 若新增文档，更新 README 文档总数与目录表。

后续 R4.4：product shell polish。

1. 从共享 HTML shell 逐步迁到真实 Web product shell，保持当前 route loader 状态机不变。
2. 按概念图重做 AI-first home / Approval Center / WorkItem Detail / Proposal Detail 的密度、分区和响应式 baseline。
3. 每个 route 的 desktop/mobile 截图必须继续通过无横向溢出和主窗无 Cuu gate。
