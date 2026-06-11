---
module: R4-proposal-advanced-split-migration
layer: C-WEB / C-UI / QA
status: completed
owner: workflow
date: 2026-06-11
visuals:
  - ../05-clients/assets/web/web-operations-pages-atlas.png
  - ../05-clients/assets/audit/2026-06-11-r4-18-react-route-migration-expansion-browser-smoke/contact-sheet.png
  - ../05-clients/assets/audit/2026-06-11-r4-19-proposal-advanced-split-migration-browser-smoke/contact-sheet.png
depends_on:
  - r4-mid-review-upgrade-audit-2026-06-11.md
  - r4-19-pre-true-react-mount-spike-plan-2026-06-11.md
  - r4-18-react-route-migration-expansion-plan-2026-06-11.md
  - r4-13-proposal-advanced-route-ux-convergence-plan-2026-06-11.md
  - r4-16-react-route-tree-hydration-boundary-plan-2026-06-11.md
  - ../05-clients/web-app.md
  - ../05-clients/page-concepts.md
---

# R4.19 Proposal Advanced Split Migration Plan

## 1. 开工前必读

- [`r4-mid-review-upgrade-audit-2026-06-11.md`](./r4-mid-review-upgrade-audit-2026-06-11.md) —— **前置硬门来源**：R4.19-pre 已完成真 React mount spike（P0-1），本计划继续承接编辑态 dirty guard 与 fixture-chrome 冻结两个 gate（见 §6）
- [`r4-19-pre-true-react-mount-spike-plan-2026-06-11.md`](./r4-19-pre-true-react-mount-spike-plan-2026-06-11.md)
- [`r4-18-react-route-migration-expansion-plan-2026-06-11.md`](./r4-18-react-route-migration-expansion-plan-2026-06-11.md)
- [`r4-13-proposal-advanced-route-ux-convergence-plan-2026-06-11.md`](./r4-13-proposal-advanced-route-ux-convergence-plan-2026-06-11.md)
- [`r4-16-react-route-tree-hydration-boundary-plan-2026-06-11.md`](./r4-16-react-route-tree-hydration-boundary-plan-2026-06-11.md)
- [`web-app.md`](../05-clients/web-app.md)
- [`page-concepts.md`](../05-clients/page-concepts.md)
- 代码入口：`packages/ui/src/gold-path/route-react-components.ts`、`packages/ui/src/gold-path/route-components.ts`、`packages/ui/src/proposal/`、`apps/web/src/browser.ts`、`apps/web/qa/r4-web-live-route-interaction.ts`
- 概念/证据：`web-operations-pages-atlas.png`、R4.18 React route migration expansion contact sheet

## 2. 背景

R4.18 已把 Cost / Replay 迁入 React-compatible component adapter，并补齐 Replay accepted deliverable restore 的 single dispatcher proof。下一步不能直接把 Proposal advanced 全量迁移成一个“大组件”：Proposal advanced 包含 line editor、structured field editor、subrecord editor、bulk conflict actions 与 custom field fail-closed，mutation 面比 Home/Settings/Cost/Replay 高很多。R4.19 先做 split migration：把 readonly summary / review metadata / conflict count adapter 化，把 mutation-heavy editors 留在现有 HTML fallback renderer。

## 3. 目标

R4.19-pre spike 结论（2026-06-11 已回写）：Home route 已在现有 R4.16 hydration boundary 内用 React 18 `createRoot()` 真挂载 hidden probe，HTML fallback 视觉保持不变；React 渲染的 probe click 已证明可冒泡到现有 delegated dispatcher；Home SSE 事件已证明可走 `react-props` 更新路径，不触发整页 `innerHTML` 重渲和 EventSource 重建。R4.19 可以继续按 split migration 开工，但 mutation-heavy editors 必须保留 fallback，并必须新增 dirty edit SSE guard。

| Area | R4.19 目标 | 必守边界 |
|---|---|---|
| Split adapter | 为 Proposal route 增加 React-compatible split adapter，只承接 readonly summary、checks、change/conflict counts、primary action hrefs | 不迁移 line editor、structured field editor、subrecord editor 的 mutation UI |
| Advanced boundary | 明确 `ProposalRouteComponent` 与 `ProposalAdvancedEditorsFallback` 的边界 marker | 不让 editors 自行 fetch、不从 DOM 文案反推 props |
| Actions | approve/request changes/merge、advanced apply、line editor、field editor、subrecord editor 仍走现有 delegated dispatcher | 不新增第二套 click handler，不改变 R4.13 fail-closed payload |
| QA | 保留 R4.13 advanced gates 与 R4.18 component gates，并新增 split boundary gates | 不降低 no overflow、active-only、Settings boundary、Replay restore gates |

## 4. 数据流

```mermaid
flowchart LR
  A["Proposal Page VM + conflicts API"] --> B["Proposal split adapter"]
  B --> C["readonly props fingerprint"]
  A --> D["existing advanced HTML fallback editors"]
  C --> E["hydration route markers"]
  D --> F["delegated action dispatcher"]
  F --> G["review / merge / apply payload proof"]
```

## 5. 实施步骤

1. 复读本计划、R4.18 竣工记录、R4.13 advanced plan、Web PRD 与 page concepts。
2. 审查 `renderProposalRouteComponent()`、`renderProposalConflictCards()`、line editor、structured field editor、subrecord editor 的 props/data flow，列出 readonly 与 mutation-heavy 边界。
3. 在 `route-react-components.ts` 增加 Proposal split adapter props：proposal id、work item id、status、change/check/evidence/comment/conflict counts、review action hrefs、advanced editor fallback flag。
4. 在 Proposal route section 增加 `data-r4-react-component-*` 与 `data-r4-proposal-advanced-fallback-*` marker；`webReactRouteTree` 标记 Proposal 进入 split migration。
5. 单测覆盖 Proposal split adapter props parity、advanced editor fallback 存在、R4.13 payload/fail-closed regression、R4.18 Cost/Replay/Home/Settings regression。
6. Browser smoke 新增 R4.19 gates：Proposal split component marker、advanced fallback boundary、readonly props parity、mutation dispatcher regression、R4.18 replay restore regression。
7. 完成后更新 `web-app.md`、`page-concepts.md`、roadmap、详细计划、README，并制定 R4.20 后续计划。

## 6. QA Gate

必须全部通过：

- `pnpm --filter @workhub/ui test`
- `pnpm --filter @workhub/web test`
- `pnpm --filter @workhub/api-client test`
- `pnpm typecheck`
- `pnpm qa:r4-web-live-route-interaction` with R4.19 env
- `pnpm test`
- `git diff --check`
- no `reference` or `references` directories, and no secret scan matches

建议新增 browser gates：

- `r4_19_proposal_split_component_marker=true`
- `r4_19_proposal_advanced_fallback_boundary=true`
- `r4_19_proposal_readonly_props_parity=true`
- `r4_19_mutation_dispatcher_regression=true`
- `r4_18_replay_restore_regression=true`
- `r4_19_dirty_edit_sse_guard=true`（中期审查 P0-2：line editor/intake/custom field 有未提交编辑时，SSE 事件不得触发整页重渲清空编辑态，降级为 notice + 手动刷新）
- `r4_19_no_new_fixture_chrome=true`（中期审查 P0-3 冻结线：本步不得新增对 `/api/pages/gold-path` fixture surface 的依赖或 gate）

## 7. PRD / 概念图验收口径

- Proposal 仍是“AI 产物审阅与合并”页面，不变成代码 IDE，也不把用户推回 git 黑话。
- Readonly summary 可以 adapter 化；所有 mutation-heavy editors 必须先作为 fallback boundary 保留，直到后续逐段拆迁。
- 固定 chrome 继续双语；动态 proposal manifest、冲突正文、LLM rationale 保留服务端原文。
- Web 主窗继续无 Cuu、无默认 Kanban、无 hash route、无 weekly demo、无 secret-like 文本、无 horizontal/text overflow。

## 8. 后续候选

R4.19 通过后不直接进入 mutation editor 迁移。按中期审查建议，R4.20 先集中修数据流地基：app 级 SSE 长连接、Page VM 局部 refetch、Last-Event-ID/断连续传与 fixture chrome 退役；R4.21 再抽共享 web runtime，收敛 Web/desktop 分叉 dispatcher；R4.22 才选择 Proposal mutation editor 中风险最低的一段做真实迁移。

## 9. 竣工记录（2026-06-11）

本轮已完成 Proposal advanced split migration，且保持 R4.13 advanced editors 的 mutation 行为不搬家：

| Area | 已落实现 | 竣工判定 |
|---|---|---|
| Proposal split adapter | `ProposalRouteComponent` 已加入 `route-react-components.ts`，props 来自 `ProposalDetailVM` 与 conflicts API：proposal/work item id、状态、change/check/evidence/comment/conflict count、review action hrefs 与 advanced fallback action count | `r4_19_proposal_split_component_marker=true`、`r4_19_proposal_readonly_props_parity=true` |
| Advanced fallback boundary | `renderProposalRouteComponent()` 保留 line editor、structured field editor、subrecord editor、custom field editor 的 HTML fallback，并输出 `proposal-advanced-editors-html-fallback` marker | `r4_19_proposal_advanced_fallback_boundary=true`，advanced fallback action count 为 8 |
| Dirty edit SSE guard | Web runtime 记录 intake option、Proposal line decision、line search、custom field 输入的 dirty state；SSE 事件遇到未提交编辑时不整页重渲，改为 warning notice + 手动刷新动作 | `r4_19_dirty_edit_sse_guard=true`，line decision/search/custom field 值在事件后保持 |
| Fixture chrome 冻结 | R4.19 smoke 锁定 `/api/pages/gold-path` 请求次数，不新增 chrome fixture 依赖；Proposal/Conflicts endpoint count 也被固定 | `r4_19_no_new_fixture_chrome=true`，`goldPath=18`、`proposal=2`、`proposalConflicts=2` |
| Regression | R4.13 advanced payload、R4.14 intake/knowledge、R4.15 settings boundary、R4.16 hydration、R4.17/18 adapters、R4.19-pre true React mount 均作为本轮回归门 | R4.19 Chrome smoke 42 步通过 |

新增浏览器证据目录：

- `../05-clients/assets/audit/2026-06-11-r4-19-proposal-advanced-split-migration-browser-smoke/`
- dirty guard 关键截图：`06aa-proposal-dirty-edit-sse-guard-en-desktop.png`
- report：`proposal-advanced-split-migration-report.json`

关键 dirty guard 证据：

```json
{
  "notice.kind": "sse_dirty_guard",
  "notice.eventType": "proposal.merged",
  "notice.stream": "proposal",
  "live.refreshMode": "dirty-deferred",
  "live.dirtyRoute": "proposal",
  "live.dirtyReason": "proposal_custom_field",
  "routeData.proposalLineEditorSelectedDecision": "keep_current",
  "routeData.proposalLineEditorSearchValue": "scope",
  "routeData.proposalCustomFieldValue": "R4.19 guarded custom title"
}
```

## 10. 验收结果

已通过：

- `pnpm --filter @workhub/ui test`
- `pnpm --filter @workhub/web test`
- `pnpm --filter @workhub/ui typecheck`
- `pnpm --filter @workhub/web typecheck`
- `pnpm --filter @workhub/api-client test`
- `pnpm typecheck`
- `pnpm test`
- `pnpm qa:r4-web-live-route-interaction` with `WORKHUB_R4_WEB_ROUTE_SMOKE_TITLE="R4.19 Proposal Advanced Split Migration Browser Smoke"`

待提交前继续执行：

- `git diff --check`
- no secret / no reference-folder diff scans

## 11. Bug / 数据流 / PRD / 概念图审查

- Bug 审查：R4.13 的 Proposal review/merge/apply dispatcher 没有分叉，advanced editor payload 仍走同一 delegated action dispatcher；custom field 空值 fail-closed 与 Replay restore single dispatcher 回归继续通过。
- 数据流审查：Proposal readonly adapter 只读取 typed Page VM 与 conflicts API 的结构化值，不从 DOM 文案反推 props；mutation-heavy editors 继续作为 HTML fallback，不自行 fetch，也不引入第二套状态源。
- SSE 审查：dirty guard 是 R4.19 范围的止血，不是终局。它避免编辑态丢失，但仍保留当前多 EventSource + full route refresh 模型；R4.20 必须继续做 app 级长连接、局部 Page VM refetch 与 Last-Event-ID。
- PRD 审查：Proposal 仍是“AI 产物审阅与合并”页，用户看到的是变更申请、风险、证据、检查和处理选项，不暴露 Git 黑话，也不把页面变成 IDE。
- 概念图审查：对齐 `web-deliverable-change-request.png` 与 `web-operations-pages-atlas.png`；dirty notice 位于右下角，不遮挡主要 review actions；主窗继续无 Cuu、无 Kanban、无 weekly demo、无 hash route、无 horizontal/text overflow。

## 12. 后续详细计划

R4.20 已拆成独立计划 [`r4-20-dataflow-foundation-plan-2026-06-11.md`](./r4-20-dataflow-foundation-plan-2026-06-11.md)。R4.20 开工前必须复读本计划竣工记录、R4 中期审查、R4.19-pre spike、`web-app.md`、`page-concepts.md`，再处理：

1. app 级 SSE 长连接，路由切换只变 topic，不重建整个 EventSource 群。
2. 当前路由 Page VM 局部 refetch，shell/nav/chrome 不再依赖 `/api/pages/gold-path` fixture。
3. Last-Event-ID / event cursor 续传合同，与 `07-open-questions.md` 的 SY-1 收敛。
4. 将 R4.19 dirty guard、R4.19-pre `react-props` path 与 R4.8 Redis/SSE smoke 纳入 R4.20 regression。
