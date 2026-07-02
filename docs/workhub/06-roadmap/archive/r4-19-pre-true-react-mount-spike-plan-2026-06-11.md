---
module: R4-19-pre-true-react-mount-spike
layer: C-WEB / runtime / QA
status: completed
owner: workflow
date: 2026-06-11
visuals:
  - ../05-clients/assets/web/web-operations-pages-atlas.png
  - ../05-clients/assets/audit/2026-06-11-r4-19-pre-true-react-mount-spike-browser-smoke/contact-sheet.png
depends_on:
  - r4-mid-review-upgrade-audit-2026-06-11.md
  - r4-18-react-route-migration-expansion-plan-2026-06-11.md
  - r4-19-proposal-advanced-split-migration-plan-2026-06-11.md
  - ../05-clients/web-app.md
  - ../05-clients/page-concepts.md
---

# R4.19-pre True React Mount Spike Plan

## 1. 开工前必读

- [`r4-mid-review-upgrade-audit-2026-06-11.md`](./r4-mid-review-upgrade-audit-2026-06-11.md)
- [`r4-18-react-route-migration-expansion-plan-2026-06-11.md`](./r4-18-react-route-migration-expansion-plan-2026-06-11.md)
- [`r4-19-proposal-advanced-split-migration-plan-2026-06-11.md`](./r4-19-proposal-advanced-split-migration-plan-2026-06-11.md)
- [`web-app.md`](../05-clients/web-app.md)
- [`page-concepts.md`](../05-clients/page-concepts.md)
- 概念/证据：`web-operations-pages-atlas.png`、R4.18 contact sheet

## 2. 背景

R4 中期审查指出 R4.16-R4.18 的 "React-compatible" 仍是 HTML marker + props fingerprint，没有真实 React dependency、`createRoot()`、受控更新或事件共存证明。R4.19 的 Proposal advanced split migration 不能继续建立在未验证的运行时合同上，因此本轮先做最小 spike：只证明 Home route 可以真实挂载 React island、继续保留 HTML fallback、点击仍交给 delegated dispatcher、SSE 事件可以更新 React props 而不整页 `innerHTML` 重渲。

## 3. 目标

| Area | 本轮目标 | 边界 |
|---|---|---|
| True mount | `@workhub/web` 引入 React 18，Home hydration root 下使用 `createRoot()` 真挂载 probe | 不把 `packages/ui` 变成 React 包，不迁移全部视觉 |
| Fallback | 可见 Home 仍由现有 HTML fallback 渲染 | 不改变概念图、布局、copy 或 action 面 |
| Dispatcher | React 渲染的 probe link 通过 DOM bubbling 进入现有 delegated dispatcher | 不新增第二套 click/mutation handler |
| SSE props | Home 收到 SSE 时只重新取 Page VM 并 `root.render(newProps)` 更新 React probe | 只证明 Home props update 模型；完整可见局部渲染留给 R4.20 数据流地基 |

## 4. 实施记录

- `apps/web/package.json` / `pnpm-lock.yaml` 新增 `react@18.3.1`、`react-dom@18.3.1` 与类型包。
- 新增 `apps/web/src/react-route-mount.ts`：在 `#wh-r4-hydration-home` 下创建 hidden React mount host，通过 `createRoot()` + `flushSync()` 渲染 `HomeRouteComponent` probe，并记录 mount/update/dispatcher metrics。
- `apps/web/src/browser.ts` 在 ready render 后调用 `mountReactRouteIsland(..., "initial")`；Home SSE refresh 走 `refreshCurrentRouteFromLiveEvent()`，成功时标记 `data-r4-live-refresh-mode="react-props"`，不触发整页 `root.innerHTML = result.html`。
- `apps/web/src/routes.ts` 的 `webReactRouteTree` 为 Home 增加 `runtimeMount` 合同：`react-18-createRoot-probe`、`sse-react-render`、`delegated-click-bubble`、fallback preserved。
- `apps/web/qa/r4-web-live-route-interaction.ts` 新增两步 Home smoke：React dispatcher probe 和 Home SSE props update，并新增三道 R4.19-pre gates。

## 5. 验收结果

- `pnpm --filter @workhub/web typecheck`：通过。
- `pnpm --filter @workhub/web test`：20/20 通过。
- `pnpm qa:r4-web-live-route-interaction` with R4.19-pre env：41 步 Chrome smoke 通过，报告目录 [`../05-clients/assets/audit/2026-06-11-r4-19-pre-true-react-mount-spike-browser-smoke/`](../05-clients/assets/audit/2026-06-11-r4-19-pre-true-react-mount-spike-browser-smoke/)。
- 新 gates 全部为 true：`r4_19_pre_true_react_mount`、`r4_19_pre_dispatcher_coexistence`、`r4_19_pre_sse_props_update_without_full_render`。

## 6. Spike 结论

合同成立，但范围要写清楚：Home route 可以在现有 R4.16 hydration boundary 内真实 `createRoot` mount，同时保留 HTML fallback；React 渲染出的 probe click 能继续由现有 delegated dispatcher 处理；Home SSE 事件可以走 `react-props` 更新而不拆掉页面和 EventSource。

限制同样明确：本轮只挂载 hidden probe，不把可见 Home UI 迁成 React 组件；Proposal advanced mutation editors 仍有 DOM 编辑态丢失风险。R4.19 可以继续做 readonly split migration，但必须同时落 dirty edit SSE guard 与 no-new-fixture-chrome gate；R4.20 仍要集中处理 app 级 SSE 长连接、Page VM 局部 refetch 和 fixture chrome 退役。

## 7. 后续计划

1. R4.19：Proposal advanced split migration，readonly summary 进入 adapter，mutation-heavy editors 保留 fallback，并加 dirty edit SSE guard。
2. R4.20：数据流地基，app 级 SSE、局部 Page VM refetch、Last-Event-ID/断连续传、fixture chrome 退役。
3. R4.21：共享 web runtime，收敛 Web/desktop-webview dispatcher、notice、SSE refresh guard。
4. R4.22：再选择 Proposal mutation editor 的最低风险一段做真实 React 迁移。
