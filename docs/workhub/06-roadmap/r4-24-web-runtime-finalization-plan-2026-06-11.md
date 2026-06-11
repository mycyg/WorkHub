---
module: R4-web-runtime-finalization
layer: C-WEB / C-DESKTOP / QA / governance
status: completed
owner: workflow
date: 2026-06-11
visuals:
  - ../05-clients/assets/audit/2026-06-11-r4-web-live-route-interaction/contact-sheet.png
depends_on:
  - r4-mid-review-upgrade-audit-2026-06-11.md
  - r4-20-dataflow-foundation-plan-2026-06-11.md
  - r4-21-shared-web-runtime-plan-2026-06-11.md
  - r4-22-proposal-mutation-editor-migration-plan-2026-06-11.md
  - r4-23-proposal-line-editor-react-migration-plan-2026-06-11.md
  - ../05-clients/web-app.md
  - ../05-clients/page-concepts.md
---

# R4.24 Web Runtime Finalization Plan

## 1. 开工前必读

- [`r4-mid-review-upgrade-audit-2026-06-11.md`](./r4-mid-review-upgrade-audit-2026-06-11.md)：P2-1 hash route 兼容漂移、P2-5 README 状态行治理、P1-5 browser smoke CI 化与 P1-2 R5 业务纵切拍板。
- [`r4-20-dataflow-foundation-plan-2026-06-11.md`](./r4-20-dataflow-foundation-plan-2026-06-11.md)：app-level SSE、Page VM local refetch、cursor 与 fixture chrome 退役合同。
- [`r4-21-shared-web-runtime-plan-2026-06-11.md`](./r4-21-shared-web-runtime-plan-2026-06-11.md)：Web/desktop-webview shared dispatcher、notice、payload、dirty marker 与 live runtime 边界。
- [`r4-22-proposal-mutation-editor-migration-plan-2026-06-11.md`](./r4-22-proposal-mutation-editor-migration-plan-2026-06-11.md) 与 [`r4-23-proposal-line-editor-react-migration-plan-2026-06-11.md`](./r4-23-proposal-line-editor-react-migration-plan-2026-06-11.md)：visible React editor 的 fallback、dirty guard、single dispatcher 与 no-smoke-sprawl 结论。
- [`web-app.md`](../05-clients/web-app.md) 与 [`page-concepts.md`](../05-clients/page-concepts.md)：Web 主窗严肃工作台、无 Cuu、无 Kanban、无 hash、无 secret 与中英双语口径。

## 2. 背景

R4.19-pre 到 R4.23 已经关闭 Claude 中期审查的四个 P0：真 React mount、SSE dirty guard、fixture chrome 退役、EventSource 整建整拆。R4.24 不再继续扩张 Proposal editor，而是做 R4 收尾门：把仍会拖累 R5 的治理项和 QA 可持续性先清干净。

## 3. 目标

| Area | R4.24 目标 | 必守边界 |
|---|---|---|
| Hash route cleanup | 移除生产 hash route 写入/兼容漂移，保留 path navigation 为唯一产品口径 | 不破坏 browser history/back-forward 与 deep-link |
| README governance | 拆短根 README / docs README 状态行，最新状态移入表格或“最近里程碑”区 | 不丢失 R4.19-pre 至 R4.23 的审计链 |
| Browser smoke sustainability | 从 42 步单体 smoke 中提取可 CI 化的小 spec 清单，先落最小脚本或计划门 | 不删除 contact-sheet 里程碑视觉门 |
| R5 business slice decision | 拍板 R5 第一条业务纵切，建议优先 M-DRIVE | 不宣称 R4 已覆盖 drive/meeting/schedule 完整产品面 |
| Regression guard | 保留 R4.20-R4.23 的 SSE、dirty guard、React editor、fallback、single dispatcher 与 no-overflow gates | 不新增 subrecord/bulk editor 迁移，除非发现阻塞 bug |

## 4. 实施步骤

1. 复读本计划必读文档与 R4 live route contact sheet，确认 R4.24 是收尾治理，不是视觉改版。
2. 审计 `apps/web/src/routes.ts`、`apps/web/src/browser.ts`、`packages/web-runtime` 中的 hash route normalize/write path，删除或降级为 fail-closed legacy read，并补 no-hash-write gate。
3. 把 README 超长状态行拆成可维护结构：保留一句当前状态，新增最近 R4 里程碑表，docs index 同步文档计数与 R4.24 入口。
4. 将 `apps/web/qa/r4-web-live-route-interaction.ts` 的 gates 分层记录：保留 42 步 contact sheet，同时产出 CI 拆分清单或最小 headless spec。
5. 编写 R5 第一条业务纵切决策记录：默认建议 M-DRIVE，因为它承接 Proposal accepted deliverables、ProjectDriveVersion、OQ-4 合并语义与真实文件产品面。
6. 复跑 Web/runtime/desktop-webview/UI/workspace tests 与 R4 browser smoke，确认 R4.23 React line editor 无回归。
7. 更新 `web-app.md`、`page-concepts.md`、roadmap、README 与本计划竣工记录，再制定 R5 或 R4.25 后续详细计划。

## 5. QA Gate

必须通过：

- `pnpm --filter @workhub/web-runtime typecheck`
- `pnpm --filter @workhub/web-runtime test`
- `pnpm --filter @workhub/web typecheck`
- `pnpm --filter @workhub/web test`
- `pnpm --filter @workhub/ui typecheck`
- `pnpm --filter @workhub/ui test`
- `pnpm --filter @workhub/desktop-webview typecheck`
- `pnpm --filter @workhub/desktop-webview test`
- `pnpm typecheck`
- `pnpm test`
- `pnpm qa:r4-web-live-route-interaction`
- `git diff --check`
- no secret / no reference-folder diff scans

建议新增 gates：

- `r4_24_no_hash_write=true`
- `r4_24_readme_status_line_governed=true`
- `r4_24_smoke_ci_split_plan=true`
- `r4_24_r5_business_slice_decided=true`
- `r4_24_r4_23_react_line_editor_regression=true`

## 6. PRD / 概念图验收口径

- Web 主窗继续是派活、审批、证据、成本与交付物变更工作台；不进入营销页、默认 Kanban 或桌宠角色栏。
- path navigation 是当前产品口径；hash 只允许作为历史兼容读入，不能由生产导航写出。
- R5 业务纵切必须继续服务 PRD 的“AI 默认干活，人审批异常”主线，优先选择能把交付物、证据、版本与回滚串起来的模块。
- 双语固定文案继续走 locale contract；动态用户正文、证据摘录、LLM rationale 保留原文。

## 7. Browser Smoke CI Split Plan

R4 live route interaction smoke 继续保留 42 步 contact sheet 作为里程碑视觉门，但 R5 前必须拆成小 spec，避免每个新增业务面都把单体脚本线性拉长。

| Proposed spec | 覆盖步骤 / gates | CI 目标 |
|---|---|---|
| `r4-web-nav-locale.spec` | 01/02/03/04/05/06 path nav、history back/forward、locale reload、no hash write | 每次 Web route/runtime 改动都跑 |
| `r4-web-intake-knowledge.spec` | 01a-01d、12b-12d option intake、knowledge search、create work item | R5 comment-to-draft 与 knowledge 变更时跑 |
| `r4-web-proposal-actions.spec` | 06a-10、R4.22/R4.23/R4.24 Proposal React editor、dirty guard、payload parity、single dispatcher | Proposal/editor/runtime 变更必跑 |
| `r4-web-settings-cost-replay.spec` | 12/12a/13/14/15/15a Settings、Cost、Replay restore、secret-safe/device boundary | settings/cost/replay 变更必跑 |
| `r4-web-route-states.spec` | 16/17/18 ready/empty/forbidden/error、route-state action notice、no overflow | 新 route/component 必跑 |

拆分原则：

- 每个 spec 使用同一 mock API fixture builder，输出独立 JSON report 和少量截图。
- Contact sheet 仍作为 R4/R5 milestone evidence，不作为每次 CI 的唯一门。
- `r4_24_no_hash_write` 与 `r4_23` regression gates 先留在单体 smoke 中，R5.1 Drive spec 建立后再下沉到 route-runtime base spec。

## 8. R5 Business Slice Decision

R5 第一条业务纵切拍板为 **M-DRIVE**，详见 [`r5-01-drive-business-slice-decision-2026-06-11.md`](./r5-01-drive-business-slice-decision-2026-06-11.md)。

决策理由：

- Drive 已承接 R1 accepted deliverables、`ProjectDriveItem/Version`、download/text preview 与 restore。
- Drive 是 OQ-4 文档型 DOC 文本/二进制合并语义的现实产品面，能把 Proposal/Replay/证据/回滚串起来。
- Meeting/Schedule 依赖 ASR、provider、日历同步和提醒编排，R5 首轮返工面更大。
- `web-project-drive-meetings-knowledge.png` 与 `web-drive-preview-change-draft.png` 均把 Drive 作为“资料、会议、知识、变更草稿”的连接点。

## 9. 竣工记录

本轮已完成：

1. `apps/web/src/browser.ts` 停止生产导航写入 `#/...`；`setActivePage()` 只更新 active panel/aria current，`navigateWebRoute()` 只比较 pathname + search。
2. `apps/web/src/routes.ts` 不再把 hash 当 route truth；`resolveWebRoute("/#/approvals")` 回到 home，`webRouteHref("https://workhub.local/#/proposals/p-1?tab=diff")` 仍可把 legacy hash route 迁成 path route。
3. Web boot 增加 legacy hash canonicalization：启动时遇到 `#/...` 会 replace 到 path URL；普通 hash anchor 不再由生产导航保留或写出。
4. `apps/web/qa/r4-web-live-route-interaction.ts` 新增 `locationHash` audit、`r4_24_no_hash_write` 与 `r4_24_r4_23_react_line_editor_regression` gates。
5. 根 README 与 docs README 状态行已治理为短状态 + 最近里程碑表，文档计数更新到 117。
6. Browser smoke CI 拆分计划已登记，保留 contact sheet 作为 milestone visual gate。
7. R5.1 Drive 业务纵切决策文档已新增。

## 10. Bug / 数据流 / 概念审查

| 审查项 | 结论 |
|---|---|
| Bug review | hash route drift 已收敛：生产导航不再写 hash，legacy `#/` 只在 boot/canonical href 转换时读取；R4.23 React line editor gate 保留。 |
| Dataflow review | Web 仍以 Page VM/REST 为真相源；SSE 只触发 app-level local refetch 或 dirty notice，不直接把 event payload 写入 UI。 |
| PRD review | R4.24 不扩张 UI 面，而是降低 R5 返工风险；下一步 Drive 纵切继续服务“AI 产出交付物，人审批异常”。 |
| Concept review | 继续符合 `web-deliverable-change-request.png`、`web-project-drive-meetings-knowledge.png` 与 `web-drive-preview-change-draft.png`：主窗严肃、证据/版本/草稿入口清晰，无 Cuu 本体。 |
| i18n review | 固定 UI 文案仍走 `zh-CN/en-US` locale contract；用户正文、文件名、证据摘录与 LLM rationale 保留原文。 |

## 11. 后续详细计划

1. R5.1 开工前复读 [`projects-and-drive.md`](../04-modules/projects-and-drive.md)、[`branch-proposal-merge.md`](../03-collaboration/branch-proposal-merge.md)、[`data-model.md`](../01-architecture/data-model.md)、[`page-concepts.md`](../05-clients/page-concepts.md) Drive 概念图和本轮 R5 决策。
2. 先做 Drive Page VM + route registry + empty/forbidden/error/ready surface，不先搬完整旧网盘。
3. 再把 WorkItem/Replay accepted deliverables deep-link 到 Drive item/version detail，确保 preview/download/restore 的数据流闭环。
4. 最后补 R5.1 browser Drive spec 与文档/截图证据，再提交 main。
