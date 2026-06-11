---
module: R4-web-runtime-finalization
layer: C-WEB / C-DESKTOP / QA / governance
status: planned
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
