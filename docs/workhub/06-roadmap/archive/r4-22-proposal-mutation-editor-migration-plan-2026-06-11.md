---
module: R4-proposal-mutation-editor-migration
layer: C-WEB / C-UIKIT / C-DESKTOP-WEBVIEW / QA
status: completed
owner: workflow
date: 2026-06-11
visuals:
  - ../05-clients/assets/web/web-deliverable-change-request.png
  - ../05-clients/assets/web/web-operations-pages-atlas.png
  - ../05-clients/assets/audit/2026-06-11-r4-web-live-route-interaction/contact-sheet.png
depends_on:
  - r4-19-pre-true-react-mount-spike-plan-2026-06-11.md
  - r4-19-proposal-advanced-split-migration-plan-2026-06-11.md
  - r4-20-dataflow-foundation-plan-2026-06-11.md
  - r4-21-shared-web-runtime-plan-2026-06-11.md
  - r4-mid-review-upgrade-audit-2026-06-11.md
  - ../05-clients/web-app.md
  - ../05-clients/page-concepts.md
---

# R4.22 Proposal Mutation Editor Migration Plan

## 1. 开工前必读

- [`r4-19-pre-true-react-mount-spike-plan-2026-06-11.md`](./r4-19-pre-true-react-mount-spike-plan-2026-06-11.md)：真实 React mount、delegated dispatcher coexistence、Home SSE `react-props` 结论
- [`r4-19-proposal-advanced-split-migration-plan-2026-06-11.md`](./r4-19-proposal-advanced-split-migration-plan-2026-06-11.md)：Proposal split、HTML fallback boundary 与 dirty guard
- [`r4-20-dataflow-foundation-plan-2026-06-11.md`](./r4-20-dataflow-foundation-plan-2026-06-11.md)：app-level SSE、Page VM local refetch、cursor 与 fixture chrome 退役
- [`r4-21-shared-web-runtime-plan-2026-06-11.md`](./r4-21-shared-web-runtime-plan-2026-06-11.md)：`@workhub/web-runtime` dispatcher / notice / line editor / live runtime 边界
- [`web-app.md`](../05-clients/web-app.md) 与 [`page-concepts.md`](../05-clients/page-concepts.md)
- 概念/证据：`web-deliverable-change-request.png`、`web-operations-pages-atlas.png`、R4 live route interaction contact sheet

## 2. 背景

R4.19-pre 已证明真实 React 能在 hydration boundary 内挂载并与 delegated dispatcher 共存；R4.19 已给 Proposal advanced editors 加 dirty guard；R4.20 把 SSE 刷新改成 app-level runtime + REST reconcile；R4.21 又把 Web/Desktop 共享的 notice、payload、dirty 与 line editor 运行时抽包。R4.22 可以开始迁移第一个可见 mutation editor，但必须小切片推进：先证明受控状态不会被 SSE、route refresh、HTML fallback 或共享 dispatcher 打断，再扩大到整个 Proposal 工作台。

## 3. 目标

| Area | R4.22 目标 | 必守边界 |
|---|---|---|
| Visible React editor | 选择 Proposal mutation editor 的最低风险片段做真实 React controlled state | 不一次性重写整个 Proposal advanced workbench |
| Dispatcher bridge | React editor 提交仍走 `@workhub/web-runtime` 共享 payload / notice / fail-closed 合同 | 不新增第二套 mutation dispatcher |
| SSE resilience | 编辑中收到 SSE 时保持 controlled state，不丢选项/输入，并显示 dirty guard 或局部 props update | 不把 SSE payload 当真相源 |
| HTML fallback | 未迁移的 line editor / structured field / subrecord / custom field 继续保留 HTML fallback marker | 不破坏 R4.19 advanced fallback boundary |
| Concept parity | Proposal 仍是变更申请审阅面，首屏不变成 IDE、Kanban 或营销页 | 主窗无 Cuu、无 hash、无 weekly fixture、无 horizontal/text overflow |

## 4. 候选切片

优先候选：

1. **structured field scalar editor**：字段少、payload 结构明确，适合先验证 controlled input + reason/fail-closed + submit bridge。
2. **line editor single conflict summary controls**：贴近 P0-2 dirty 风险，但 hunk state 多，若第一候选太薄再选它。

不建议第一刀选整个 line editor：逐段 hunk、搜索、scope、custom reason 和多 target 冲突组合太多，容易把 R4.22 变成大重写。

## 5. 实施步骤

1. 复读 R4.19-pre/R4.19/R4.20/R4.21 竣工记录、Web 客户端文档、Proposal 概念图与 R4 contact sheet。
2. 在现有 Proposal hydration boundary 内选一个 mutation editor 子根，定义 typed props 与最小 React component。
3. 把该子根真实 `createRoot()` 挂载为可见 UI；未迁移区域继续由 HTML renderer 输出。
4. React component 内部用 controlled state 保存选择/输入；脏状态通过 shared dirty marker 写回 route metrics。
5. 提交时通过 shared runtime materializer 或等价 typed bridge 生成现有 action payload，并复用 Web 现有 API sequencing。
6. SSE clean path 仍可局部 refresh；dirty path 必须保留 React controlled state，并显示 `sse_dirty_guard` notice 或等价 shared notice。
7. 扩展 unit tests：component props/state、payload bridge、dirty marker、fallback boundary。
8. 扩展 browser smoke gate：证明该可见 editor 是真实 React、编辑态经 SSE 不丢、仍只有一个 dispatcher、未迁移 fallback 仍存在。
9. 完工后更新 `web-app.md`、`page-concepts.md`、roadmap、详细计划与 README，制定下一阶段 R4 收尾或 R4.23 计划。

## 6. QA Gate

必须通过：

- `pnpm --filter @workhub/web-runtime typecheck`
- `pnpm --filter @workhub/web-runtime test`
- `pnpm --filter @workhub/web typecheck`
- `pnpm --filter @workhub/web test`
- `pnpm --filter @workhub/ui typecheck`
- `pnpm --filter @workhub/ui test`
- `pnpm --filter @workhub/desktop-webview test`
- `pnpm typecheck`
- `pnpm test`
- `pnpm qa:r4-web-live-route-interaction`
- `git diff --check`
- no secret / no reference-folder diff scans

建议新增 browser gates：

- `r4_22_visible_react_mutation_editor=true`
- `r4_22_controlled_state_survives_sse=true`
- `r4_22_single_dispatcher_regression=true`
- `r4_22_html_fallback_boundary_regression=true`
- `r4_22_no_new_smoke_sprawl=true`

## 7. PRD / 概念图验收口径

- Proposal 仍对齐 `web-deliverable-change-request.png`：变更摘要、风险、checks、evidence、comments 与 review actions 是主轴；editor 只是高级工作区的一段。
- `web-operations-pages-atlas.png` 的 serious workspace 继续成立：不加 hero、装饰卡堆、默认 Kanban 或 Cuu 本体。
- 双语固定 notice、按钮和 fail-closed 文案继续走 locale/shared notice contract；用户输入、证据、manifest 和 LLM rationale 保留原文。
- React 迁移的验收不是 marker 存在，而是真实 `createRoot` 可见子树、受控状态、事件桥和 SSE 回归同时通过。

## 8. 后续候选

R4.22 完成后，若第一段 editor 证明稳定，下一步可以二选一：

- R4.23 继续迁 Proposal line editor 的 hunk decision/search/scope 片段；
- 或进入 R4 收尾门：hash 死代码清理、README 状态行治理、浏览器 smoke 拆分/CI 化方案与 R5 第一条业务纵切拍板。

## 9. 竣工记录（2026-06-11）

本轮选择 **structured field scalar editor** 作为第一段可见 React mutation editor，而不是直接迁整套 line editor。理由：字段级标量 patch 的 payload 明确、UI 面小，足以验证 true React controlled state、dirty SSE guard、HTML fallback boundary 与 shared dispatcher bridge，同时不会把 Proposal 首屏改成重型编辑器。

已落代码：

- `packages/ui/src/gold-path/route-components.ts`：在 Proposal advanced conflict review 内新增 `data-r4-proposal-react-mutation-editor-host="structured-field-scalar"` 子根，HTML fallback 仍先渲染并保留 marker。
- `apps/web/src/routes.ts`：`webReactRouteTree.proposal.hydration.runtimeMount` 升级为 `react-18-visible-mutation-editor`，ready root 暴露 `data-r4-route-tree-runtime-mutation-editor="structured-field-scalar"`。
- `apps/web/src/react-route-mount.ts`：新增 `ProposalMutationEditor` React component，读取 typed Proposal conflict operations，挂载真实 `createRoot()` 可见子树；textarea 使用 React controlled state；accept/keep/custom 按钮仍输出现有 `data-action-*` / `data-request-json*` 合同，交给现有 delegated dispatcher。
- `apps/web/qa/r4-web-live-route-interaction.ts`：新增 R4.22 browser audit 字段与 gates，复用既有 42 步 smoke，不让脚本继续线性膨胀。
- `apps/web/src/routes.test.ts` 与 `packages/ui/src/gold-path/route-components.test.ts`：覆盖 Proposal route tree runtime mount、React editor host、structured field payload、HTML fallback preserved boundary。

## 10. Bug / 数据流 / 概念复核

- Bug 审查：React editor mount 后隐藏原 HTML structured field fallback，但 report 同时记录 `fallbackPreserved=true` 与 `fallbackHidden=true`，证明 fallback 未删除、只在已挂载时隐藏；空 custom value 仍 fail-closed，custom apply 仍走单次 typed POST。
- 数据流审查：React component 不自行调用 API；它只生成现有 action dataset，点击仍由 Web delegated dispatcher -> `@workhub/web-runtime` payload materializer -> typed API client sequencing 执行。SSE 仍只作为 refresh/reconcile trigger，dirty route 仍显示 notice + 手动刷新，不把 event payload 当真相源。
- PRD / 概念图审查：Proposal 首屏继续对齐 `web-deliverable-change-request.png`，summary、risk、checks、evidence、comments 与 review actions 不变；React editor 只出现在高级区。页面仍对齐 `web-operations-pages-atlas.png` 的严肃工作台边界，无 Cuu 主窗、无营销 hero、无默认 Kanban。
- 双语审查：React editor 固定文案继续调用 `uiT(locale, "proposal.*")`，中英 locale contract 不新增散落硬编码；用户输入、manifest、LLM rationale 与证据文本继续保留原文。

## 11. 验收结果

- `pnpm --filter @workhub/web-runtime typecheck`
- `pnpm --filter @workhub/web-runtime test`：9/9
- `pnpm --filter @workhub/web typecheck`
- `pnpm --filter @workhub/web test`：21/21
- `pnpm --filter @workhub/ui typecheck`
- `pnpm --filter @workhub/ui test`：52/52
- `pnpm --filter @workhub/desktop-webview typecheck`
- `pnpm --filter @workhub/desktop-webview test`：85/85
- `pnpm typecheck`
- `pnpm test`
- `pnpm qa:r4-web-live-route-interaction`：42 steps，`ok=true`

R4.22 gates 全部通过：

- `r4_22_visible_react_mutation_editor=true`
- `r4_22_controlled_state_survives_sse=true`
- `r4_22_single_dispatcher_regression=true`
- `r4_22_html_fallback_boundary_regression=true`
- `r4_22_no_new_smoke_sprawl=true`

视觉证据目录：`../05-clients/assets/audit/2026-06-11-r4-web-live-route-interaction/`。重点截图为 `06a-proposal-advanced-review-en-desktop.png` 与 `06aa-proposal-dirty-edit-sse-guard-en-desktop.png`：前者证明 visible React editor 在高级区稳定呈现，后者证明输入 `R4.19 guarded custom title` 后收到 SSE 不丢 controlled state，并显示 dirty guard notice。

## 12. 后续计划

R4.22 已证明第一段可见 React mutation editor 可在现有 Proposal dataflow 下安全落地。下一步进入 [`r4-23-proposal-line-editor-react-migration-plan-2026-06-11.md`](./r4-23-proposal-line-editor-react-migration-plan-2026-06-11.md)：迁移 Proposal line editor 的 hunk decision / search / scope 最小切片，继续保持 shared dispatcher、dirty guard、HTML fallback 与 42 步 smoke 不膨胀。
