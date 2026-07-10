# 全页面 UI 形态测试报告 2026-06-20

> **历史快照（2026-06-20）**：本报告基于当时的 15 条正式路由；现行注册表已扩至 18 条（projects / project-home / agents 等后续加入）。以 `apps/web/src/routes.ts` 的 shellPageOrder 为准。

## 结论

本轮按“每一个页面的 UI 形态都要覆盖”的要求，补齐并重跑 Web 端全页面 UI 自动化。15 个注册路由均已覆盖 ready 页面形态；同一组 15 个路由也在 route-state matrix 中覆盖 loading、empty、error、forbidden 四类状态。live UI 交互共 72 步，包含桌面/移动截图、API Page VM 取数证明、SSE、表单/按钮交互、无横向溢出和无文本框溢出 gate。

本轮发现并补齐的缺口：

- `/dashboard/skills` 原先只在 route-state matrix 覆盖；本轮已补上 live UI 桌面/移动截图、`/api/pages/skills` mock、DOM totals 审计、`r8_skills_route_component` gate。
- route-state matrix 摘要已从旧的 8 个页面更新为完整 15 个页面。

## 覆盖路由

| 路由 key | 路径 | ready live UI | loading/empty/error/forbidden |
| --- | --- | --- | --- |
| home | `/` | PASS | PASS |
| intake | `/intake/:sessionId` | PASS | PASS |
| approvals | `/approvals` | PASS | PASS |
| workitem | `/workitems/:id` | PASS | PASS |
| proposal | `/proposals/:id` | PASS | PASS |
| drive | `/drive` | PASS | PASS |
| meetings | `/meetings` | PASS | PASS |
| notifications | `/notifications` | PASS | PASS |
| calendar | `/calendar` | PASS | PASS |
| health | `/dashboard/health` | PASS | PASS |
| replay | `/agent-runs/:id/replay` | PASS | PASS |
| cost | `/dashboard/cost` | PASS | PASS |
| knowledge | `/knowledge/search` | PASS | PASS |
| skills | `/dashboard/skills` | PASS | PASS |
| settings | `/settings` | PASS | PASS |

## 执行命令

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `pnpm qa:r4-web-route-state-matrix` | PASS | 15 路由 x 4 状态，zh-CN/en-US，桌面/移动截图，无 CUU 泄漏、无 Kanban、无横向溢出 |
| `pnpm qa:r4-web-live-route-interaction` | PASS, 72 steps | 全页面 ready UI、路径导航、history、locale、SSE、按钮/表单动作、移动端无溢出 |
| `pnpm --filter @workhub/web test` | PASS, 29 tests | route loader、Page VM、route-state、settings、drive/meetings/notifications/calendar 等 |
| `pnpm --filter @workhub/ui test` | PASS, 77 tests | route component、skills、health、CUU/run renderer、proposal/replay/workitem UI |

## 关键 Gate

| Gate | 结果 |
| --- | --- |
| `route_state_coverage` | PASS |
| `ready_routes_use_page_vm_endpoints` | PASS |
| `r8_skills_route_component` | PASS |
| `r4_11_route_specific_markers` | PASS |
| `r4_11_vm_dom_value_match` | PASS |
| `r4_16_route_adapter_page_vm_truth` | PASS |
| `r4_24_no_hash_write` | PASS |
| `no_horizontal_overflow` | PASS |
| `no_text_box_overflow` | PASS |
| `no_main_window_cuu` | PASS |
| `no_default_kanban` | PASS |

## 证据

- live UI report: `docs/workhub/05-clients/assets/audit/2026-06-11-r4-web-live-route-interaction/live-route-interaction-report.json`
- live UI contact sheet: `docs/workhub/05-clients/assets/audit/2026-06-11-r4-web-live-route-interaction/contact-sheet.png`
- live UI summary: `docs/workhub/05-clients/assets/audit/2026-06-11-r4-web-live-route-interaction/smoke-summary.md`
- route-state report: `docs/workhub/05-clients/assets/audit/2026-06-11-r4-web-route-state-matrix/route-state-matrix-report.json`
- route-state contact sheet: `docs/workhub/05-clients/assets/audit/2026-06-11-r4-web-route-state-matrix/contact-sheet.png`
- route-state summary: `docs/workhub/05-clients/assets/audit/2026-06-11-r4-web-route-state-matrix/smoke-summary.md`

## 判断

Web UI 不是仅靠单个页面 smoke 判断通过：本轮以路由注册表和 `r4WebRouteKeys` 为基准，对每条页面路由都覆盖了 ready 和非 ready 状态；live 交互又验证了真实 Page VM 取数、动作提交、SSE 刷新、移动端布局和文本溢出。当前没有发现新的全页面 UI 形态阻断问题。
