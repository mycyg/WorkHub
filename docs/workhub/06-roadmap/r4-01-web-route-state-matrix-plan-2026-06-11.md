---
module: 06-roadmap
layer: R4 / C-WEB / QA
status: current
owner: workflow
date: 2026-06-11
visuals:
  - ../05-clients/assets/web/web-ai-first-home.png
  - ../05-clients/assets/web/web-workitem-detail.png
  - ../05-clients/assets/web/web-approval-center.png
  - ../05-clients/assets/web/web-deliverable-change-request.png
  - ../05-clients/assets/web/web-real-ui-gap-roadmap.png
  - ../05-clients/assets/shared/r0-governance-boundary-concept.svg
evidence:
  - ../05-clients/assets/audit/2026-06-11-r4-web-route-state-matrix/route-state-matrix-report.json
  - ../05-clients/assets/audit/2026-06-11-r4-web-route-state-matrix/contact-sheet.png
---

# R4.1 Web Route-State Matrix Foundation

## 1. 开工阅读

本轮开工前已复读：

- [`recovery-r0-r4-roadmap-2026-06-08.md`](./recovery-r0-r4-roadmap-2026-06-08.md)
- [`review-driven-r0-r4-detailed-construction-plan-2026-06-08.md`](./review-driven-r0-r4-detailed-construction-plan-2026-06-08.md) 的 R4 与开工阅读清单
- [`../05-clients/web-app.md`](../05-clients/web-app.md)
- [`../05-clients/page-concepts.md`](../05-clients/page-concepts.md)
- 概念图：`web-ai-first-home.png`、`web-workitem-detail.png`、`web-approval-center.png`、`web-deliverable-change-request.png`、`web-real-ui-gap-roadmap.png`、`r0-governance-boundary-concept.svg`

概念约束：

- Web 主窗是严肃工作台，不出现 Cuu 本体、Cuu settings、Cuu 资产或桌宠角色栏。
- 默认首页递一件最需要判断的事，看板只能是兜底。
- R4 高频页必须中英双语，并有 loading / empty / error / forbidden 四态。
- 文本不能横向溢出，特别是 mobile viewport 和长英文状态文案。

## 2. 当前代码事实

- `apps/web/src/browser.ts` 仍是 Gold Path shell，不是完整 React route tree。
- `packages/ui/src/gold-path/*` 已能渲染 home / intake / approvals / workitem / proposal / replay / cost / settings 的 ready shell。
- R1.39 `qa:r1-route-visual` 已验证 Proposal / Replay 的复杂 patch UI，但没有覆盖 R4 所列全部页面四态。
- API 已有 `/api/pages/attention`、`/api/pages/approvals`、`/api/pages/workitems/:id`、`/api/pages/proposals/:id`、`/api/pages/cost` 等 Page VM 基础；真实 React route 产品化仍未落地。

## 3. 本轮范围

本轮只做 R4.1 QA foundation，不把 fixture 或 preview shell 夸大成真实 SPA 完成：

1. 新增 `packages/ui/src/route-state.ts`：
   - 固定 R4 高频 route key：`home/intake/approvals/workitem/proposal/replay/cost/settings`。
   - 固定四态：`loading/empty/error/forbidden`。
   - 提供中英双语状态卡和 responsive CSS。
2. 新增 `scripts/qa/r4-web-route-state-matrix.ts`：
   - 生成 ready Web shell 的 zh-CN desktop 与 en-US mobile 截图。
   - 生成 route-state matrix 的 zh-CN desktop 与 en-US mobile 截图。
   - 通过 Chrome DOM dump gate 检查：四态覆盖、双语 copy、无 Cuu 主窗标记、无 default Kanban 文案、无横向溢出。
3. 新增 root 脚本：
   - `pnpm qa:r4-web-route-state-matrix`

## 4. 验收证据

证据目录：

`docs/workhub/05-clients/assets/audit/2026-06-11-r4-web-route-state-matrix/`

本轮通过的 gate：

- `screenshots_captured=true`
- `ready_shell_pages=true`
- `route_state_coverage=true`
- `bilingual_state_copy=true`
- `no_main_window_cuu=true`
- `no_default_kanban=true`
- `no_horizontal_overflow=true`

验证命令：

- `corepack pnpm --filter @workhub/ui test`：36/36 通过。
- `corepack pnpm --filter @workhub/ui typecheck`：通过。
- `corepack pnpm --filter @workhub/web test`：4/4 通过。
- `corepack pnpm --filter @workhub/web typecheck`：通过。
- `corepack pnpm qa:r4-web-route-state-matrix`：通过，生成 Chrome 截图与 JSON report。

## 5. PRD / 概念图一致性审查

- 符合 R4-1：高频页四态已有可复跑 QA foundation。
- 符合 R4-3：四态 fixed copy 已有 zh-CN / en-US，ready shell 继续复用 locale toggle。
- 符合 R0 主窗边界：报告 gate 明确 `no_main_window_cuu=true`。
- 符合用户截图反馈：状态卡和 ready shell 在 desktop/mobile 均 gate `no_horizontal_overflow=true`。

不能宣称：

- 不能宣称真实 React SPA 已完成。
- 不能宣称每个 route 已接真实多条后端数据。
- 不能宣称动态 VM 内容已服务端按 locale 生成；当前 ready shell 仍有用户/daemon 原文边界。

## 6. 后续详细计划

后续状态：R4.2 真实 route registry + loader 已落，详见 [`r4-02-web-route-registry-loader-plan-2026-06-11.md`](./r4-02-web-route-registry-loader-plan-2026-06-11.md)。以下是 R4.1 交给 R4.2 的原始计划，已由 R4.2 完成并继续交给 R4.3 多记录视觉 QA。

1. 在 `apps/web/src` 建立真实 route registry，而不是只靠 hash 切换 Gold Path shell。
2. 将每个 route 的 loader 状态抽为同一状态机：`idle/loading/ready/empty/error/forbidden`。
3. 将 `renderRouteStateCard()` 接进 browser boot 的真实错误/权限/空态，而不是仅 QA matrix。
4. 对 `/`, `/approvals`, `/dashboard/cost` 先接真实 Page VM endpoint，保留 typed client 和 locale query。
5. 增加 DOM/Chrome gate：每个真实 route 至少一组 ready + 四态截图；mobile 仍必须无横向溢出。

后续 R4.3：从 fixture preview 转真实多记录数据。

1. 用 R1/R2 真实 seed 或 PG smoke 输出生成至少两条不同 work item / proposal / approval / cost usage。
2. 禁止把 `weekly_report_manifest_doc` 当作 R4 完成证据。
3. ready screenshot 必须覆盖多 work_item/proposal，不再只有“客户周报”单硬编码。

后续 R4.4：Web app product shell。

1. 复现概念图中的 AI-first home、approval center、workitem detail、proposal detail 的密度和信息分区。
2. 保持 8px 内卡片 radius、紧凑工作台布局、无 hero/营销页。
3. 建立 route visual baseline，后续 UI 变更必须更新 screenshot evidence。
