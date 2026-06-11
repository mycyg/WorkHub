---
module: R4-proposal-advanced-route-ux-convergence
layer: C-WEB / C-UI / C-API / QA
status: planned
owner: workflow
date: 2026-06-11
visuals:
  - ../05-clients/assets/web/web-deliverable-change-request.png
  - ../05-clients/assets/web/web-workitem-detail.png
  - ../05-clients/assets/web/web-approval-center.png
depends_on:
  - r4-12-web-action-notice-locale-route-ux-plan-2026-06-11.md
  - r4-11-web-route-componentization-second-slice-plan-2026-06-11.md
  - ../05-clients/web-app.md
  - ../05-clients/page-concepts.md
---

# R4.13 Proposal Advanced Route UX Convergence Plan

## 1. 开工前必读

- [`r4-12-web-action-notice-locale-route-ux-plan-2026-06-11.md`](./r4-12-web-action-notice-locale-route-ux-plan-2026-06-11.md)
- [`r4-11-web-route-componentization-second-slice-plan-2026-06-11.md`](./r4-11-web-route-componentization-second-slice-plan-2026-06-11.md)
- [`web-app.md`](../05-clients/web-app.md)
- [`page-concepts.md`](../05-clients/page-concepts.md)
- 概念图：`web-deliverable-change-request.png`、`web-workitem-detail.png`、`web-approval-center.png`
- 代码入口：`packages/ui/src/gold-path/route-components.ts`、`packages/ui/src/proposal/render.ts`、`packages/ui/src/route-line-editor.ts`、`packages/ui/src/overlap-hunk-review.ts`、`packages/ui/src/subrecord-item-diff.ts`、`apps/web/src/browser.ts`、`apps/web/qa/r4-web-live-route-interaction.ts`

## 2. 背景

R4.10/R4.11 已把 Proposal 接为显式 route component，R4.12 已把 action / notice / reason gate / desktop gate 统一到本地化反馈合同。下一风险点是 Proposal 详情里的高级交互仍主要来自 shared rich helpers：conflict workbench、field editor、line editor、subrecord editor、candidate apply 等能力还没有完全收敛到 active-only Proposal route UX，也没有在 live browser smoke 中按真实 action path 做完整截图验收。

## 3. 目标

| Area | R4.13 目标 | 必守边界 |
|---|---|---|
| Conflict workbench | Proposal route component 能展示并操作冲突候选、逐项选择、批量折叠审查 | 不把页面变成 IDE，不暴露 Git 黑话给普通用户 |
| Structured editors | Field editor / line editor / subrecord diff 在 Proposal route 下保持可发现、可折叠、可审计 | 不创建隐藏全页 panels；仍为 active-only route component |
| Action feedback | Candidate apply、line/field/subrecord apply 复用 R4.12 notice contract | 未接线动作 fail-closed，不假成功 |
| Mobile QA | Proposal advanced route 在 mobile scroll 下不横向溢出，notice 不遮挡关键按钮 | 不靠缩小字号硬塞内容 |
| Data truth | 所有高级操作仍以 REST mutation + Page VM refresh 为真相 | SSE 只提示 refresh，不作为唯一数据源 |

## 4. 数据流

```mermaid
flowchart LR
  A["Proposal Page VM"] --> B["Proposal route component"]
  B --> C["advanced editor widgets"]
  C --> D["browser action dispatcher"]
  D --> E["typed REST mutation"]
  E --> F["R4.12 route notice"]
  E --> G["REST Page VM reload"]
  H["SSE proposal event"] --> G
```

## 5. 实施步骤

1. 复读本计划、R4.12 竣工记录、Web PRD 与 Proposal / WorkItem / Approval 概念图。
2. 审查 `packages/ui/src/proposal/render.ts` 已有高级 helper，列出现已支持的 conflict cards、bulk review、field editor、line editor、subrecord editor 与 action href。
3. 审查 `packages/ui/src/gold-path/route-components.ts` Proposal route component 与 shared proposal renderer 的差异，确定哪些高级块应直接迁入 route component，哪些继续复用 helper。
4. 给 Proposal route component 增加高级交互 section marker：`data-r4-proposal-conflicts`、`data-r4-proposal-field-editor`、`data-r4-proposal-line-editor`、`data-r4-proposal-subrecord-editor`。
5. 扩展 browser dispatcher 覆盖 button-style `data-action-href` / `data-request-json` 的安全分支，复用 R4.12 notice。
6. 对已接线 API 的 candidate apply / merge proposal apply 使用 typed API client；未接线 editor apply fail-closed，并保留请求 payload 在 DOM 中可审计。
7. 扩展 unit tests：route component marker、editor folded state、request JSON、action attrs、no Cuu/no Kanban/no secret。
8. 扩展 R4 live browser smoke：Proposal advanced desktop/mobile、candidate apply success、editor fail-closed、SSE refresh、no overflow、no duplicate route loader calls。
9. 更新 `web-app.md`、`page-concepts.md`、roadmap、详细计划、README，并制定 R4.14 后续计划。

## 6. QA Gate

必须全部通过：

- `pnpm --filter @workhub/ui test`
- `pnpm --filter @workhub/web test`
- `pnpm typecheck`
- `pnpm qa:r4-web-live-route-interaction` with R4.13 env
- `pnpm test`
- `git diff --check`
- no `reference` or `references` directories, and no secret scan matches

Browser gates 建议新增：

- `r4_13_proposal_advanced_route_sections=true`
- `r4_13_conflict_candidate_apply_notice=true`
- `r4_13_editor_fail_closed_notice=true`
- `r4_13_advanced_mobile_no_overflow=true`
- `r4_12_action_notice_regression=true`
- `r4_11_route_component_source_truth=true`
- `active_only_product_panels=true`
- `no_duplicate_route_loader_calls=true`

## 7. PRD / 概念图验收口径

- `web-deliverable-change-request.png`：Proposal 仍是变更申请，展示对象变化、证据、回滚和可选解决路径；高级编辑器必须折叠、有边界。
- `web-workitem-detail.png`：高级 Proposal 操作不能把 WorkItem 详情挤成工作台；WorkItem 只保留执行、验收、交付物、trace 的入口。
- `web-approval-center.png`：Approval 仍是阻塞收件箱；高级 Proposal 操作的结果通过 notice 回到用户，而不是制造第二个审批流。

## 8. 后续候选

R4.13 通过后进入 R4.14：Option Intake / Knowledge fallback route componentization。目标是把 option-first intake、knowledge search fallback 和 workitem creation 串成真实 route dataflow，同时保留 R4.12/R4.13 的 action feedback 与 no-overflow gates。
