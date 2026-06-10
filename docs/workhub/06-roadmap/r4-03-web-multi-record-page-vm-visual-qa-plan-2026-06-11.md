---
module: 06-roadmap
layer: R4 / C-WEB / multi-record visual QA
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
  - ../05-clients/assets/audit/2026-06-11-r4-web-multi-record-page-vm/multi-record-page-vm-report.json
  - ../05-clients/assets/audit/2026-06-11-r4-web-multi-record-page-vm/contact-sheet.png
---

# R4.3 Web Multi-record Page VM Visual QA

## 1. 开工阅读

本轮开工前已复读：

- [`r4-02-web-route-registry-loader-plan-2026-06-11.md`](./r4-02-web-route-registry-loader-plan-2026-06-11.md)
- [`recovery-r0-r4-roadmap-2026-06-08.md`](./recovery-r0-r4-roadmap-2026-06-08.md)
- [`review-driven-r0-r4-detailed-construction-plan-2026-06-08.md`](./review-driven-r0-r4-detailed-construction-plan-2026-06-08.md) 的 R4 段落
- [`../05-clients/web-app.md`](../05-clients/web-app.md)
- 概念图：`web-ai-first-home.png`、`web-workitem-detail.png`、`web-approval-center.png`、`web-deliverable-change-request.png`、`r0-governance-boundary-concept.svg`

概念约束：

- Web ready 页面必须证明不再只有“客户周报/weekly report”单 fixture 文案。
- 高频 ready routes 必须继续通过 typed Page VM endpoint，再进入 shared shell。
- detail routes `/workitems/:id`、`/proposals/:id`、`/agent-runs/:id/replay` 必须有 ready 视觉证据。
- 主窗继续无 Cuu 本体、无 Cuu settings、无默认 Kanban，mobile 不横向溢出。

## 2. 本轮范围

R4.3 是 route loader 的多记录视觉 QA，不是产品 shell 重写：

1. 扩展 `apps/web/src/routes.test.ts`：
   - 增加 `/workitems/:id`、`/proposals/:id`、`/agent-runs/:id/replay` 的 endpoint-first 测试。
2. 新增 `scripts/qa/r4-web-multi-record-page-vm.ts` 与 root `pnpm qa:r4-web-multi-record-page-vm`：
   - 构造去掉“客户周报/weekly”单场景痕迹的 multi-record Page VM surface。
   - ready 截图覆盖 `/`、`/approvals`、`/dashboard/cost`、`/workitems/:id`、`/proposals/:id`、`/agent-runs/:id/replay`。
   - 状态截图覆盖 empty approvals、forbidden workitem、missing proposal。
   - Chrome DOM gate 检查 endpoint 调用顺序、detail route 覆盖、多记录文案、无 weekly fixture 文案、真实 path 导航、无 Cuu 主窗标记、无 Kanban、无横向溢出。

## 3. 验收证据

证据目录：

`docs/workhub/05-clients/assets/audit/2026-06-11-r4-web-multi-record-page-vm/`

本轮通过的 gate：

- `screenshots_captured=true`
- `ready_routes_use_page_vm_endpoints=true`
- `detail_ready_routes_covered=true`
- `multi_record_copy_covered=true`
- `no_weekly_fixture_copy_in_ready=true`
- `empty_and_forbidden_states=true`
- `path_navigation_without_hash=true`
- `no_main_window_cuu=true`
- `no_default_kanban=true`
- `no_horizontal_overflow=true`

关键 endpoint proof：

- `/`: `attention:zh-CN -> goldPath:zh-CN`
- `/approvals`: `approvals:en-US -> goldPath:en-US`
- `/dashboard/cost`: `cost:zh-CN -> goldPath:zh-CN`
- `/workitems/r4-multi-workitem`: `workItem:r4-multi-workitem:en-US -> goldPath:en-US`
- `/proposals/r4-multi-proposal`: `proposal:r4-multi-proposal:zh-CN -> goldPath:zh-CN`
- `/agent-runs/r4-multi-run/replay`: `replayAgentRun:r4-multi-run -> goldPath:en-US`

验证命令：

- `corepack pnpm --filter @workhub/web test`：11/11 通过。
- `corepack pnpm qa:r4-web-multi-record-page-vm`：通过，生成 Chrome 截图与 JSON report。

## 4. PRD / 概念图一致性审查

符合：

- R4-2/R4-3：ready route 不再只证明 gold-path 单 fixture；多记录文案覆盖区域发布复盘、法务条款复核、预算复核包、跨区发布资料包、Proposal、Replay。
- Web/桌宠边界：report gate 明确无 Cuu 主窗标记；接活/干活仍不在 Web 主窗出现。
- 双语与响应式：zh-CN/en-US、desktop/mobile 均有截图；所有 case `no_horizontal_overflow=true`。
- 数据流：Page VM endpoint 在 ready route 中先于 `goldPath` shell template 调用；empty/forbidden 不伪装 ready。

不能宣称：

- 不能宣称真实 PostgreSQL 多记录 seed 已接入浏览器 live daemon；本轮是 deterministic Page VM QA surface。
- 不能宣称产品 shell 已完成；ready 页面仍复用 shared HTML render helpers。
- 不能宣称 dynamic VM 内容全量服务端本地化。

## 5. 后续详细计划

后续状态：R4.4 product shell baseline 已落，详见 [`r4-04-web-product-shell-baseline-plan-2026-06-11.md`](./r4-04-web-product-shell-baseline-plan-2026-06-11.md)。

下一刀 R4.5：live browser / route interaction smoke。

1. 启动真实 Web dev server，覆盖 path nav click、back/forward、locale toggle 后重进 loader。
2. 保留 R4.4 四屏 baseline，并补 ready route 与 empty/error/forbidden 状态页之间的浏览器跳转。
3. 继续 gate：
   - no Cuu main-window markers。
   - no default Kanban。
   - no horizontal overflow。
   - no text box overflow。
4. 数据流审查：
   - REST Page VM 仍是真相；SSE 只触发刷新。
   - forbidden / empty / error 继续走 R4 route-state helper。
   - Web 主窗不出现 worker-only/claim/receive-work 能力。
