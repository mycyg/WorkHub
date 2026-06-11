---
module: R4-proposal-line-editor-react-migration
layer: C-WEB / C-UIKIT / QA
status: completed
owner: workflow
date: 2026-06-11
visuals:
  - ../05-clients/assets/web/web-deliverable-change-request.png
  - ../05-clients/assets/audit/2026-06-11-r4-web-live-route-interaction/contact-sheet.png
depends_on:
  - r4-19-pre-true-react-mount-spike-plan-2026-06-11.md
  - r4-19-proposal-advanced-split-migration-plan-2026-06-11.md
  - r4-20-dataflow-foundation-plan-2026-06-11.md
  - r4-21-shared-web-runtime-plan-2026-06-11.md
  - r4-22-proposal-mutation-editor-migration-plan-2026-06-11.md
  - ../05-clients/r1-route-line-editor.md
  - ../05-clients/web-app.md
  - ../05-clients/page-concepts.md
---

# R4.23 Proposal Line Editor React Migration Plan

## 0. 竣工摘要（2026-06-11）

R4.23 已完成 Proposal line editor 的最小真实 React island：`text-hunk` hunk decision、search query 与当前文件 scope 进入 React controlled state，仍复用 Web delegated dispatcher 与 `@workhub/web-runtime` payload materializer。HTML line editor fallback 保留并在 React mount 后隐藏，未迁移的 structured field/subrecord/bulk workbench 边界继续可审计。

验收结果：本机 Chrome R4 live route interaction smoke 保持 42 步，新增 `r4_23_visible_react_line_editor`、`r4_23_hunk_state_survives_sse`、`r4_23_line_editor_payload_parity`、`r4_23_html_fallback_boundary_regression`、`r4_23_single_dispatcher_regression`、`r4_23_no_new_smoke_sprawl` 全部为 true。关键截图为 `06aa-proposal-dirty-edit-sse-guard-en-desktop.png` 与 `06b-proposal-line-editor-apply-success-en-desktop.png`。

## 1. 开工前必读

- [`r4-22-proposal-mutation-editor-migration-plan-2026-06-11.md`](./r4-22-proposal-mutation-editor-migration-plan-2026-06-11.md)：第一段 visible React mutation editor 的真实 mount、controlled state、dirty guard 与 fallback 结论。
- [`r1-route-line-editor.md`](../05-clients/r1-route-line-editor.md)：Proposal route line editor 的文件 tabs、搜索、逐段点选、scope 与 `text_hunk_overrides` payload 合同。
- [`web-app.md`](../05-clients/web-app.md)：R4.19-R4.22 前端运行时与 Proposal split/fallback 边界。
- [`page-concepts.md`](../05-clients/page-concepts.md)：`web-deliverable-change-request.png` 对 Proposal 详情页的产品边界；R4.19-R4.22 contact sheet 证据。

## 2. 背景

R4.22 只迁 structured field scalar editor，证明 React 18 visible island 可以保留用户输入、复用 delegated dispatcher，并在 SSE dirty path 下不丢 controlled state。R4.23 才开始碰最复杂的 Proposal line editor，但仍按小切片推进：只迁一个 text hunk conflict 的 decision/search/scope 子集，不一次性重写 bulk conflict workbench、subrecord editor 或整个 Proposal route。

## 3. 目标

| Area | R4.23 目标 | 必守边界 |
|---|---|---|
| React line editor island | 迁移单个 text hunk editor 的 decision / search / scope 控制 | 不迁整个 Proposal advanced workbench |
| Payload parity | React 产出的 `text_hunk_overrides` 与 HTML fallback 完全等价 | 不新增第二套 mutation API 或 dispatcher |
| Dirty SSE resilience | hunk decision、search query、scope choice 在 SSE 到达时不丢 | 不恢复整页 `innerHTML` 重渲 |
| Fallback boundary | 未迁移的 structured field、subrecord、bulk actions 继续保留 HTML fallback | 不删除 R4.13/R4.19 可审计 marker |
| Visual parity | Proposal 首屏仍是变更申请审阅面，line editor 仍是高级区能力 | 不变成代码 IDE、Kanban 或营销页 |

## 4. 实施步骤

1. 复读本计划必读文档与概念图，确认 R4.23 只处理 line editor 最小 React island。
2. 在 Proposal advanced section 增加 `data-r4-proposal-react-line-editor-host` 子根，HTML line editor fallback 先保留。
3. 从 typed conflict option 中提取 `text_diff3.conflict_ranges[]`、current/incoming/AI fusion summaries、target file、scope options 与 action href。
4. 新增 React line editor component，受控保存 hunk decision、search query 与 scope；更新现有 hidden payload 或 data-request-json contract。
5. 继续让 click/submit 走 Web delegated dispatcher 与 `@workhub/web-runtime` payload materializer，不让 component 直接 fetch。
6. SSE dirty path 保留 React controlled state，并在 report 中证明 mount count 不重置、decision/search/scope 不丢。
7. 扩展 unit tests：props extraction、payload parity、fallback preserved、single dispatcher。
8. 扩展 browser gates：visible React line editor、controlled hunk state survives SSE、payload parity、fallback boundary、no smoke sprawl。
9. 完工后更新 `web-app.md`、`page-concepts.md`、roadmap、README 与本计划竣工记录，再制定下一阶段 R4 收尾或 R4.24 计划。

## 5. QA Gate

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

- `r4_23_visible_react_line_editor=true`
- `r4_23_hunk_state_survives_sse=true`
- `r4_23_line_editor_payload_parity=true`
- `r4_23_html_fallback_boundary_regression=true`
- `r4_23_single_dispatcher_regression=true`
- `r4_23_no_new_smoke_sprawl=true`

## 6. PRD / 概念图验收口径

- Proposal 继续对齐 `web-deliverable-change-request.png`：变更申请、风险、checks、evidence、comments 与 review actions 是主轴；line editor 只服务于高级冲突处理。
- 保持去黑话：用户看到的是“保留正式版 / 采纳这次版本 / 使用 AI 融合稿 / 仅应用这段”等业务动作，不暴露 git branch/merge 术语。
- 双语固定文案继续走 locale contract；动态 patch 内容、用户正文、LLM rationale 保留原文。
- 主窗仍无 Cuu、无默认 Kanban、无 hash route、无 weekly fixture、无 secret-like 文本、无 horizontal/text overflow。

## 7. 后续候选

R4.23 完成后，优先进入 [`r4-24-web-runtime-finalization-plan-2026-06-11.md`](./r4-24-web-runtime-finalization-plan-2026-06-11.md)：hash route 兼容清理、README 状态行治理、browser smoke CI 化拆分、R5 第一条业务纵切拍板。subrecord/bulk editor 暂不另起迁移，除非 R4.24 的收尾审查发现它们仍是 R5 前阻塞风险。

## 8. 竣工记录

| 项 | 结果 |
|---|---|
| React line editor island | `apps/web/src/react-route-mount.ts` 新增 `ProposalLineEditor`，在 `data-r4-proposal-react-line-editor-host="text-hunk"` 下真实 `createRoot()` 挂载 |
| Controlled state | hunk decision、search query 与 active file panel 由 React state 保存；SSE dirty path 后仍保留 `keep_current` 与 `scope` |
| Payload parity | Apply 仍输出既有 `text_hunk_overrides.hunks[]`，覆盖 hunk index、start/end line 与 decision，不新增 API |
| Dispatcher | React action 继续走 `data-action-*` / delegated dispatcher / shared payload materializer，不直接 fetch |
| Fallback boundary | HTML line editor fallback preserved/hidden；structured field、subrecord、bulk workbench 继续保留原边界 |
| 视觉 | Proposal 首屏仍对齐 `web-deliverable-change-request.png`；高级编辑区不变成代码 IDE |

## 9. Bug / 数据流 / 概念图复核

- P0-1 React 迁移：R4.23 是第二段可见 React editor，不再停留在 data-attribute adapter；route tree 暴露 `lineEditor: "text-hunk"`。
- P0-2 编辑态丢失：`06aa` dirty SSE gate 证明 hunk decision/search 与 structured field 输入均未被事件清空。
- P0-4 SSE 数据流：仍沿 R4.20 app-level SSE + Page VM local refetch；事件只作为 reconcile trigger，不直接驱动业务 UI。
- P1-1 双端分叉：本轮不新增 component-local dispatcher，继续复用 R4.21 shared runtime；desktop-webview 没有复制新 parser。
- 概念图：Proposal 页面仍是变更申请审阅面；line editor 只服务高级冲突处理，不进 WorkItem/Home/Approval，也不进入桌宠气泡。
