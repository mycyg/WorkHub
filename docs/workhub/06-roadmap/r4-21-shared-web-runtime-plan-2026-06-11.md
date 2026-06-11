---
module: R4-shared-web-runtime
layer: C-WEB / C-DESKTOP-WEBVIEW / C-UIKIT / QA
status: completed
owner: workflow
date: 2026-06-11
visuals:
  - ../05-clients/assets/web/web-operations-pages-atlas.png
  - ../05-clients/assets/audit/2026-06-11-r4-web-live-route-interaction/contact-sheet.png
depends_on:
  - r4-mid-review-upgrade-audit-2026-06-11.md
  - r4-20-dataflow-foundation-plan-2026-06-11.md
  - ../05-clients/web-app.md
  - ../05-clients/desktop-pet-tauri.md
  - ../05-clients/page-concepts.md
---

# R4.21 Shared Web Runtime Plan

## 1. 开工前必读

- [`r4-mid-review-upgrade-audit-2026-06-11.md`](./r4-mid-review-upgrade-audit-2026-06-11.md) P1-1、P1-5、P2-2、P2-3
- [`r4-20-dataflow-foundation-plan-2026-06-11.md`](./r4-20-dataflow-foundation-plan-2026-06-11.md) app-level SSE、cursor 与 fixture chrome 退役竣工记录
- [`web-app.md`](../05-clients/web-app.md)
- [`desktop-pet-tauri.md`](../05-clients/desktop-pet-tauri.md)
- [`page-concepts.md`](../05-clients/page-concepts.md)
- 概念/证据：`web-operations-pages-atlas.png`、R4.20 live route interaction contact sheet

## 2. 背景

R4.20 已把 Web 的数据流地基从 route render 级 EventSource 拆成 app-level SSE runtime，并退役 ready route 对 `/api/pages/gold-path` fixture chrome 的依赖。中期审查 P1-1 仍指出 Web 与 desktop-webview 的 browser dispatcher 已经分叉：desktop-webview 保留 R4.11 前旧拷贝，缺少 R4.12-R4.20 的 notice、dirty guard、SSE refresh、locale persistence 与 runtime metrics。R4.21 要把共享运行时边界收口，避免 R4.22 Proposal mutation editor 迁移时同时维护两套事件系统。

## 3. 目标

| Area | R4.21 目标 | 必守边界 |
|---|---|---|
| Shared dispatcher | 抽出 delegated action / payload fail-closed / route line editor / intake option / structured field dirty marker | 不改变现有 Web action payload 或 API 调用顺序 |
| Shared notice | 抽出 action success/error/pending、reason gate、desktop gate、SSE refresh、dirty guard、locale persistence failure 文案入口 | 中英固定 copy 继续走 locale contract，动态 payload 不硬翻译 |
| Shared live runtime | 把 R4.20 app-level SSE runtime 拆成可注入 client/route resolver 的 helper | 不降低 topic auth，不让 SSE payload 成为真相源 |
| Desktop alignment | desktop-webview 先接入共享 runtime 的无行为改变路径，修掉 R4.11 前旧 dispatcher drift | 不把 Cuu 本体或本地能力塞回 Web 主窗 |
| QA shape | 把 Web 42 步 smoke 拆出 shared-runtime 单测与最小 desktop-webview DOM regression | 不继续把所有 route family 都线性塞进单个 smoke |

## 4. 实施步骤

1. 复读 R4.20 竣工记录、中期审查 P1-1、Web/Desktop 客户端文档与概念图。
2. 对比 `apps/web/src/browser.ts` 与 `apps/desktop-webview/src/browser.ts`，列出重复函数、已分叉行为、桌面独有注入点。
3. 新建共享 runtime 包或 UI 子模块（候选：`packages/ui/src/web-runtime` 或 `packages/web-runtime`），先搬纯函数：href parser、payload extraction、dirty marker、notice VM factory、line editor helpers。
4. 抽 app-level live runtime 为可注入 helper：client streams、current route resolver、route refresh callback、dirty guard callback、metric writer。
5. Web 改为调用共享 runtime，保持 R4.20 browser gates 仍全 true。
6. desktop-webview 接共享 dispatcher/notice 的最小只读路径，补单测证明旧拷贝不再作为主真相源。
7. QA 拆门：保留 `pnpm qa:r4-web-live-route-interaction` 作为里程碑 smoke，同时新增 shared-runtime unit tests 和 desktop-webview route action regression。
8. 完成后更新 `web-app.md`、`desktop-pet-tauri.md`、`page-concepts.md`、roadmap、详细计划、README，并制定 R4.22 Proposal mutation editor migration 计划。

## 5. QA Gate

必须通过：

- `pnpm --filter @workhub/ui test`
- `pnpm --filter @workhub/web test`
- `pnpm --filter @workhub/desktop-webview test`
- `pnpm typecheck`
- `pnpm test`
- `pnpm qa:r4-web-live-route-interaction`
- `git diff --check`
- no secret / no reference-folder diff scans

建议新增 gates：

- `r4_21_shared_runtime_dispatcher_parity=true`
- `r4_21_shared_notice_locale_parity=true`
- `r4_21_desktop_webview_uses_shared_runtime=true`
- `r4_21_r4_20_sse_runtime_regression=true`
- `r4_21_dirty_guard_regression=true`
- `r4_21_no_new_browser_smoke_sprawl=true`

## 6. PRD / 概念图验收口径

- Web 和 desktop main window 都是严肃工作界面；Cuu 只在独立 pet window。
- 共享 runtime 是行为边界，不是新视觉系统；不得新增 hero、装饰背景、默认 Kanban 或桌宠设置面。
- Dispatcher 必须仍 fail-closed：缺 payload、缺 reason、缺 option、缺 custom value 时阻断并提示。
- SSE 仍只是 refresh/reconcile trigger；REST/Page VM 仍为真相源。
- 双语固定 copy 可共享；用户输入、证据摘录、proposal manifest、LLM rationale 保留原文。

## 7. 后续候选

R4.21 完成后进入 R4.22 Proposal mutation editor migration：选择 Proposal line editor 或 structured field editor 的最低风险片段，用 R4.19-pre/R4.20/R4.21 稳定后的 React/runtime 合同做真实迁移。

## 8. 竣工记录（2026-06-11）

R4.21 已落地 `@workhub/web-runtime`，把 Web 与 desktop-webview 之间最容易继续分叉的浏览器运行时能力收成共享包：

- `packages/web-runtime` 新增 shared helpers：HTML escape / CSS escape、browser locale persistence、structured route notice VM、action href parser、payload materializer、dirty route marker、route line editor DOM binding 与可注入 app-level live runtime。
- `apps/web/src/browser.ts` 改为调用 shared runtime，继续保留 Web 自己的 route orchestration、typed API sequencing 与 product shell render；R4.20 的 app-level EventSource reuse、Page VM local refetch、Last-Event-ID/cursor、dirty guard 与 Home `react-props` update 语义保持不变。
- `apps/desktop-webview/src/browser.ts` 接入 shared locale、notice、payload、line editor helper，删除旧拷贝里的 proposal action parser、merge conflict extractor 和 payload update 重复实现；locale persistence 失败现在 fail-closed 显示结构化 notice。
- desktop-webview 仍是 R4 主窗回归面和 P0.5/hash shell 过渡面，本轮不把 Cuu、本地能力或完整 Web Page VM route loader 塞回桌面主窗。
- Browser smoke 暴露 `r4SharedWebRuntime="@workhub/web-runtime"`、`r4SharedLiveRuntime=true`、`r4SharedActionRuntime="notice-payload-line-editor"`，并把 R4.21 gates 写入审计报告。

## 9. QA 结果

已通过：

- `pnpm --filter @workhub/web-runtime typecheck`
- `pnpm --filter @workhub/web-runtime test`：9/9
- `pnpm --filter @workhub/web typecheck`
- `pnpm --filter @workhub/web test`：20/20
- `pnpm --filter @workhub/ui test`：52/52
- `pnpm --filter @workhub/desktop-webview typecheck`
- `pnpm --filter @workhub/desktop-webview test`：85/85
- `pnpm typecheck`
- `pnpm test`
- `pnpm qa:r4-web-live-route-interaction`：42 steps，输出到 `../05-clients/assets/audit/2026-06-11-r4-web-live-route-interaction/`

新增 R4.21 gates 均为 true：

- `r4_21_shared_runtime_dispatcher_parity`
- `r4_21_shared_notice_locale_parity`
- `r4_21_r4_20_sse_runtime_regression`
- `r4_21_dirty_guard_regression`
- `r4_21_no_new_browser_smoke_sprawl`

## 10. Bug / 数据流 / PRD 与概念图复核

- Bug 审查：shared runtime 单测覆盖 action payload fail-closed、notice locale 与 live runtime cursor/reuse；desktop-webview 静态 regression 断言旧 parser/extractor 不再作为本地真相源。
- 数据流审查：SSE payload 仍只触发 refresh/reconcile；REST/Page VM 仍为 UI 真相源；dirty route 收到事件时仍降级 notice + 手动刷新，不清掉未提交 DOM 编辑态。
- PRD 对账：Web/desktop 主窗继续是严肃工作界面，Cuu 仍只在独立 pet window；共享 runtime 是行为边界，不是新视觉系统。
- 概念图对账：R4.20 contact sheet 复核未出现 hero、默认 Kanban、Cuu 本体、hash route、weekly demo 文案或文本/横向溢出。
- 限制：desktop-webview 已消除 dispatcher/notice/payload/line-editor 的旧拷贝主真相源，但还没有接 Web 的完整 app-level Page VM route loader；这留给 R4 收尾或 R5 双向同步 UI 前继续处理。

## 11. 后续详细计划

下一刀进入 [`r4-22-proposal-mutation-editor-migration-plan-2026-06-11.md`](./r4-22-proposal-mutation-editor-migration-plan-2026-06-11.md)：基于 R4.19-pre 的真 React mount、R4.20 的 app-level SSE/dataflow foundation 和 R4.21 的 shared runtime，选择 Proposal mutation editor 的最低风险片段做第一段真实可见 React controlled-state 迁移。
