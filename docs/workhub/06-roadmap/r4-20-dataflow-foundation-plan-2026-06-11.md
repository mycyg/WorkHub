---
module: R4-dataflow-foundation
layer: C-WEB / C-DAEMON / C-EVENTS / QA
status: planned
owner: workflow
date: 2026-06-11
visuals:
  - ../05-clients/assets/web/web-operations-pages-atlas.png
  - ../05-clients/assets/audit/2026-06-11-r4-19-proposal-advanced-split-migration-browser-smoke/contact-sheet.png
depends_on:
  - r4-mid-review-upgrade-audit-2026-06-11.md
  - r4-19-pre-true-react-mount-spike-plan-2026-06-11.md
  - r4-19-proposal-advanced-split-migration-plan-2026-06-11.md
  - r4-08-redis-sse-production-browser-smoke-2026-06-11.md
  - ../05-clients/web-app.md
  - ../05-clients/page-concepts.md
---

# R4.20 Dataflow Foundation Plan

## 1. 开工前必读

- [`r4-mid-review-upgrade-audit-2026-06-11.md`](./r4-mid-review-upgrade-audit-2026-06-11.md) P0-3/P0-4 与 P1-3/P1-5
- [`r4-19-proposal-advanced-split-migration-plan-2026-06-11.md`](./r4-19-proposal-advanced-split-migration-plan-2026-06-11.md) R4.19 dirty guard 竣工记录
- [`r4-19-pre-true-react-mount-spike-plan-2026-06-11.md`](./r4-19-pre-true-react-mount-spike-plan-2026-06-11.md) true React mount 与 `react-props` update proof
- [`r4-08-redis-sse-production-browser-smoke-2026-06-11.md`](./r4-08-redis-sse-production-browser-smoke-2026-06-11.md) Redis broker、topic auth 与 REST reconcile 证据
- [`web-app.md`](../05-clients/web-app.md)
- [`page-concepts.md`](../05-clients/page-concepts.md)
- 概念/证据：`web-operations-pages-atlas.png`、R4.19 Proposal split migration contact sheet、R4.8 Redis/SSE contact sheet

## 2. 背景

R4.19 已完成 Proposal readonly split adapter，并用 dirty guard 阻断“编辑中收到 SSE 后整页重渲导致 DOM 编辑态丢失”的 P0 风险。但这只是止血：当前 Web 仍在每次 route render 后重建 1-3 条 EventSource，收到事件后全量重拉 `/api/pages/gold-path` + 当前 Page VM，再整页 `innerHTML` 替换。R4.20 要把数据流地基改成 app 级长连接与局部 Page VM refresh，并开始退役 fixture chrome。

## 3. 目标

| Area | R4.20 目标 | 必守边界 |
|---|---|---|
| App-level SSE | Web boot 建立稳定 SSE runtime，route 切换只更新 topic set / listener mapping | 不降低 R4.8 topic auth、Redis broker、多 worker reconcile gates |
| Local Page VM refetch | 收到事件只重拉当前 route 所需 Page VM 或 React props，shell/nav/chrome 不跟随重拉 | 不让 SSE payload 成为唯一真相源，REST/Page VM 仍为 truth |
| Last-Event-ID / cursor | 客户端记录最近 event id；断线重连携带 cursor；服务端 event stream 明确可续传/不可续传边界 | 不伪造“绝不丢事件”的承诺；缺 cursor 时必须 fail-safe reconcile |
| Fixture chrome retirement | Shell/nav/routes 从 `/api/pages/gold-path` fixture 剥离为真实 chrome source（前端常量或轻量 shell endpoint） | 不破坏双语 fixed chrome、path navigation、active-only panel、no weekly fixture gates |
| QA shape | 把 R4.19 dirty guard、R4.19-pre `react-props`、R4.8 Redis/SSE regression 放到同一 browser smoke | 不把 42 步单体 smoke 继续无界线性扩张；开始为 R4.21 拆分 CI Playwright 做准备 |

## 4. 数据流目标图

```mermaid
flowchart LR
  A["Web boot"] --> B["stable SSE runtime"]
  B --> C["stream/me + active resource topics"]
  C --> D["event router"]
  D --> E["current route Page VM refetch"]
  D --> F["React props update when mounted"]
  E --> G["active panel patch/render"]
  F --> G
  H["shell/nav chrome source"] --> G
```

## 5. 实施步骤

1. 复读本计划、R4.19 竣工记录、R4 中期审查、R4.8 Redis/SSE plan、Web PRD 与 page concepts。
2. 审查 `apps/web/src/browser.ts` 的 EventSource 生命周期、`refreshCurrentRouteFromLiveEvent()`、`renderCurrentRoute()` 和 dirty metrics，列出可移动到 app runtime 的状态。
3. 新建或抽出 Web live runtime helper，管理 stable EventSource、topic set、last event metadata、route dirty guard、notice scheduling。
4. 改造 route refresh：Home 优先保留 R4.19-pre `react-props` path；其他 route 先做 current Page VM refetch + active route render，避免重新拉 gold-path chrome。
5. 退役生产 chrome 对 `/api/pages/gold-path` fixture 的依赖：抽真实 shell/nav/chrome source，保留 `/api/pages/gold-path` 作为 fixture/test surface。
6. 服务端 SSE 如已有 event id/cursor 能力则接入 `Last-Event-ID`；若缺失，先补明确的 cursor 字段和 reconnect reconcile 策略，并写入开放问题回收记录。
7. QA 拆门：保留 R4.19 smoke 的核心路径，同时新增 R4.20 gates；评估把 route family 拆到后续 Playwright CI spec 的最小边界。
8. 完成后更新 `web-app.md`、`page-concepts.md`、roadmap、详细计划、README，并制定 R4.21 shared runtime 后续计划。

## 6. QA Gate

必须通过：

- `pnpm --filter @workhub/web test`
- `pnpm --filter @workhub/ui test`
- `pnpm --filter @workhub/api test`（如服务端 SSE/cursor 有改动）
- `pnpm --filter @workhub/api-client test`（如 Page VM/client 合同有改动）
- `pnpm typecheck`
- `pnpm test`
- `pnpm qa:r4-web-live-route-interaction` with R4.20 env
- `git diff --check`
- no secret / no reference-folder diff scans

建议新增 browser gates：

- `r4_20_app_level_sse_runtime=true`
- `r4_20_route_switch_does_not_rebuild_all_event_sources=true`
- `r4_20_page_vm_local_refetch=true`
- `r4_20_shell_chrome_no_gold_path_fixture_dependency=true`
- `r4_20_last_event_id_or_cursor_contract=true`
- `r4_20_dirty_guard_regression=true`
- `r4_20_home_react_props_update_regression=true`
- `r4_20_redis_sse_reconcile_regression=true`
- `r4_20_no_new_fixture_chrome=true`

## 7. PRD / 概念图验收口径

- Web 仍是瘦客户端：REST/Page VM 为真相源，SSE 只负责提示和触发 reconcile。
- 主窗保持严肃工作界面，不引入 Cuu、营销 hero、默认 Kanban 或装饰性 dashboard。
- 双语 fixed chrome 必须来自 locale contract 或真实 shell source，不能继续依赖中文 fixture 正则替换成英文。
- 动态 proposal manifest、证据摘录、用户输入、LLM rationale 保留源文本，不在客户端硬翻译。
- 任何刷新模型改动都必须证明 Proposal dirty edit 不丢状态，且不破坏 path navigation、active-only panel、no horizontal/text overflow。

## 8. 后续候选

R4.20 完成后进入 R4.21 shared web runtime：把 Web 与 desktop-webview 的 dispatcher、notice、locale、dirty guard、SSE refresh 运行时收敛成共享包，再选择 R4.22 Proposal mutation editor 的最低风险一段做真实迁移。
