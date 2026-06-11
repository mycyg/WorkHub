---
module: R4-react-route-migration-expansion
layer: C-WEB / C-UI / QA
status: completed
owner: workflow
date: 2026-06-11
visuals:
  - ../05-clients/assets/web/web-operations-pages-atlas.png
  - ../05-clients/assets/audit/2026-06-11-r4-17-react-route-component-first-migration-browser-smoke/contact-sheet.png
  - ../05-clients/assets/audit/2026-06-11-r4-18-react-route-migration-expansion-browser-smoke/contact-sheet.png
depends_on:
  - r4-17-react-route-component-first-migration-plan-2026-06-11.md
  - r4-16-react-route-tree-hydration-boundary-plan-2026-06-11.md
  - ../05-clients/web-app.md
  - ../05-clients/page-concepts.md
---

# R4.18 React Route Migration Expansion Plan

## 1. 开工前必读

- [`r4-17-react-route-component-first-migration-plan-2026-06-11.md`](./r4-17-react-route-component-first-migration-plan-2026-06-11.md)
- [`r4-16-react-route-tree-hydration-boundary-plan-2026-06-11.md`](./r4-16-react-route-tree-hydration-boundary-plan-2026-06-11.md)
- [`web-app.md`](../05-clients/web-app.md)
- [`page-concepts.md`](../05-clients/page-concepts.md)
- 代码入口：`packages/ui/src/gold-path/route-react-components.ts`、`packages/ui/src/gold-path/route-components.ts`、`apps/web/src/routes.ts`、`apps/web/qa/r4-web-live-route-interaction.ts`
- 概念/证据：`web-operations-pages-atlas.png`、R4.17 React route component first migration contact sheet

## 2. 背景

R4.17 已把 Home / Settings 迁入 React-compatible component adapter，并证明 typed Page VM props、HTML fallback、route tree marker、hydration marker、action count 和 Settings boundary 可以在同一 browser smoke 中保持一致。R4.18 扩大迁移范围，但仍不碰最高风险的 Proposal advanced editors，先选择 Cost / Replay 这类中等复杂度、低 mutation 风险 route。

## 3. 目标

| Area | R4.18 目标 | 必守边界 |
|---|---|---|
| Expansion | 将 Cost / Replay 接入同一 React-compatible component adapter | 不一次性迁移 Proposal advanced / Intake / Knowledge |
| Props parity | Cost / Replay adapter props 来自 typed Page VM 与 existing renderer output，不从 DOM 反推 | 不复制旧 fixture 文案、不硬翻译动态正文 |
| Actions | Replay accepted deliverable href、Cost budget notice action count 与 HTML fallback 一致 | 不新增第二套 dispatcher，不让同一点击双发 |
| QA | Browser smoke 继续覆盖 R4.17 gates，并新增 Cost / Replay component parity | 不降低 R4.10-R4.17 regression gates |

## 4. 数据流

```mermaid
flowchart LR
  A["typed Page VM loader"] --> B["route tree node"]
  B --> C["React-compatible props adapter"]
  C --> D["HTML fallback renderer"]
  D --> E["hydration boundary"]
  E --> F["delegated browser action dispatcher"]
```

## 5. 实施步骤

1. 复读本计划、R4.17 竣工记录、Web PRD、page concepts 和 R4.17 browser report。
2. 选择 Cost / Replay 作为扩展迁移 route，先不碰 Proposal advanced、Intake、Knowledge。
3. 为 Cost / Replay 定义 props adapter：Page VM、locale、route key、primary action hrefs、route-specific count markers 必须可审计。
4. 在 `webReactRouteTree` 标出新 component adapter，并保持 Home / Settings R4.17 markers。
5. 扩展 unit tests：Cost / Replay props parity、action count parity、hydration marker parity、no secret/no Cuu regression。
6. 扩展 browser smoke：新增 R4.18 component marker、Cost / Replay fallback parity、action dispatcher single path、R4.17 regression。
7. 更新 `web-app.md`、`page-concepts.md`、roadmap、详细计划、README，并制定 R4.19 后续计划。

## 6. QA Gate

必须全部通过：

- `pnpm --filter @workhub/ui test`
- `pnpm --filter @workhub/web test`
- `pnpm --filter @workhub/api-client test`
- `pnpm typecheck`
- `pnpm qa:r4-web-live-route-interaction` with R4.18 env
- `pnpm test`
- `git diff --check`
- no `reference` or `references` directories, and no secret scan matches

建议新增 browser gates：

- `r4_18_cost_react_component_marker=true`
- `r4_18_replay_react_component_marker=true`
- `r4_18_cost_replay_html_fallback_parity=true`
- `r4_18_action_dispatcher_single_path=true`
- `r4_18_replay_nonzero_deliverable_action_parity=true`
- `r4_17_first_migration_regression=true`

## 7. PRD / 概念图验收口径

- Cost 仍是成本治理页，不变成营销 dashboard，也不泄露 provider secret/base URL。
- Replay 仍是审计和恢复工作台，不变成代码 IDE，也不把 Cuu 气泡塞回主窗。
- Web 主窗继续无 Cuu、无默认 Kanban、无 hash route、无 weekly demo、无横向/文本溢出。

## 8. 竣工记录

2026-06-11 已完成 R4.18 React route migration expansion。

实现范围：

- `packages/ui/src/gold-path/route-react-components.ts` 新增 `CostRouteComponent` / `ReplayRouteComponent` typed adapter props、component name、primary hrefs 与 fingerprint。
- `packages/ui/src/gold-path/route-components.ts` 将 Cost / Replay section、hydration root、route tree marker 接入同一 React-compatible metadata；Cost props 来自 `CostDashboardVM`，Replay props 来自 `renderAgentRunReplay()` 输出。
- `apps/web/src/routes.ts` 将 `webReactRouteTree` 的 migrated route 扩展为 Home / Replay / Cost / Settings。
- `apps/web/src/browser.ts` 补齐 Replay accepted deliverable restore 的 typed client dispatcher，`restore_deliverable` 单击走 `restoreAcceptedDeliverable()`，不再停留在 pending。
- `apps/web/qa/r4-web-live-route-interaction.ts` 新增 Cost / Replay R4.18 gates、Replay route data、非零 accepted deliverable action parity 和 restore POST proof。

验收结果：

- `pnpm --filter @workhub/ui test`：51/51 通过。
- `pnpm --filter @workhub/web test`：19/19 通过。
- `pnpm typecheck`：通过。
- `pnpm qa:r4-web-live-route-interaction` with R4.18 env：39 步 Chrome smoke 通过，报告目录 [`../05-clients/assets/audit/2026-06-11-r4-18-react-route-migration-expansion-browser-smoke/`](../05-clients/assets/audit/2026-06-11-r4-18-react-route-migration-expansion-browser-smoke/)，所有 R4.10-R4.18 gates 均为 true。

Bug / 数据流审查：

- Cost `reactComponentActionCount=1`、hydration action count、hydration panel action count 与 budget notice href 一致；`104000 / ¥4.2 / budget=3 / model=1 / notice=1` 均来自 Cost Page VM。
- Replay `reactComponentActionCount=3`、hydration action count、hydration panel action count 与 accepted deliverable preview/download/restore href 一致；restore click 只产生 1 次 `/api/workitems/:id/deliverables/:id/restore` POST。
- 本轮仍不引入 React runtime dependency，不调用 `hydrateRoot()`，不新增第二套 action dispatcher；Proposal advanced / Intake / Knowledge 未迁移。
- Browser report 与截图确认 active-only panel、Page VM truth、Settings boundary、no Cuu/no Kanban/no weekly/no hash/no secret/no horizontal overflow/no text overflow 均保持。

## 9. 后续候选

R4.18 通过后进入 R4.19：评估 Proposal advanced 的拆分迁移，先把 conflict summary / readonly review sections 与 mutation-heavy editors 分层，再决定是否逐段迁移。
