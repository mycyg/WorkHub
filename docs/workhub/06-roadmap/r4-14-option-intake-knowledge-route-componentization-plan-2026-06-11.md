---
module: R4-option-intake-knowledge-route-componentization
layer: C-WEB / C-UI / C-API / QA
status: planned
owner: workflow
date: 2026-06-11
visuals:
  - ../05-clients/assets/web/web-option-first-intake-wizard.png
  - ../05-clients/assets/web/web-project-drive-meetings-knowledge.png
  - ../05-clients/assets/web/web-project-attention-workspace.png
depends_on:
  - r4-13-proposal-advanced-route-ux-convergence-plan-2026-06-11.md
  - r4-12-web-action-notice-locale-route-ux-plan-2026-06-11.md
  - ../05-clients/web-app.md
  - ../05-clients/page-concepts.md
---

# R4.14 Option Intake / Knowledge Route Componentization Plan

## 1. 开工前必读

- [`r4-13-proposal-advanced-route-ux-convergence-plan-2026-06-11.md`](./r4-13-proposal-advanced-route-ux-convergence-plan-2026-06-11.md)
- [`r4-12-web-action-notice-locale-route-ux-plan-2026-06-11.md`](./r4-12-web-action-notice-locale-route-ux-plan-2026-06-11.md)
- [`web-app.md`](../05-clients/web-app.md)
- [`page-concepts.md`](../05-clients/page-concepts.md)
- [`knowledge-base.md`](../04-modules/knowledge-base.md)
- [`requirements-workitem.md`](../04-modules/requirements-workitem.md)
- 概念图：`web-option-first-intake-wizard.png`、`web-project-drive-meetings-knowledge.png`、`web-project-attention-workspace.png`
- 代码入口：`packages/ui/src/gold-path/route-components.ts`、`packages/ui/src/intake/`、`apps/web/src/routes.ts`、`apps/web/src/browser.ts`、`apps/web/qa/r4-web-live-route-interaction.ts`

## 2. 背景

R4.10-R4.13 已把主要 ready routes 和 action notice dataflow 收敛到 active-only Web product shell。下一块缺口是 Intake / Knowledge fallback：用户从 option-first intake 进入 work item creation，或从知识检索兜底找到证据时，仍需要更明确的 route component、path navigation、双语固定文案和 browser smoke 证据。

## 3. 目标

| Area | R4.14 目标 | 必守边界 |
|---|---|---|
| Option Intake | `/intake/:sessionId` 渲染显式 route component，保留 option-first、collapsed free text、progress stack | 不变成聊天墙，不默认要求用户打字 |
| WorkItem creation | Intake 选择提交后进入 typed API dataflow，并用 R4.12 notice / route state 表示成功、失败、需澄清 | 不在浏览器端模拟 AI 推理 |
| Knowledge fallback | 知识/证据检索 fallback 作为 Web route component 或显式 section，展示来源、日期、可打开链接 | 不替代 Cuu 轻 chips，不把搜索页变默认首页 |
| Locale | 固定文案 zh-CN/en-US；动态证据和用户输入保持 VM 原文 | 不把用户原文机器翻译成伪双语 |
| QA | Browser smoke 覆盖 intake desktop/mobile、knowledge fallback、submit/fail-closed、route-state 和 no-overflow | 不降低 R4.10-R4.13 regression gates |

## 4. 数据流

```mermaid
flowchart LR
  A["Intake route"] --> B["Session / Question Page VM"]
  B --> C["option-first route component"]
  C --> D["browser action dispatcher"]
  D --> E["typed REST mutation"]
  E --> F["WorkItem / next question Page VM"]
  G["Knowledge fallback route"] --> H["Evidence / search Page VM"]
  H --> I["evidence list route component"]
```

## 5. 实施步骤

1. 复读本计划、R4.13 竣工记录、Web PRD、Knowledge / WorkItem 文档与三张概念图。
2. 审查现有 `renderIntakeSession()`、`QuestionCard` / option helpers 与 Web route loader 对 `/intake/:sessionId` 的支持程度。
3. 给 Intake route 增加显式 route component marker：`data-r4-route-component="intake"`、`data-r4-intake-option-count`、`data-r4-intake-free-text-collapsed`、`data-r4-intake-progress-count`。
4. 审查知识检索 / evidence fallback Page VM 和当前 routes；若已有 typed Page VM，接为显式 route component；若尚未成形，先以 no-fake-data route-state + planned section 记录阻塞，不制造假搜索结果。
5. 扩展 browser dispatcher：Intake continue / option submit 复用 R4.12 notice；缺必要选项时 fail-closed，不发 mutation。
6. 扩展 unit tests：route component marker、双语固定文案、free text collapsed、payload attrs、no Cuu/no Kanban/no secret。
7. 扩展 `qa:r4-web-live-route-interaction`：Intake desktop/mobile、knowledge fallback、submit success/fail-closed、history/path navigation、locale reload、no duplicate loader calls。
8. 更新 `web-app.md`、`page-concepts.md`、roadmap、详细计划、README，并制定 R4.15 后续计划。

## 6. QA Gate

必须全部通过：

- `pnpm --filter @workhub/ui test`
- `pnpm --filter @workhub/web test`
- `pnpm typecheck`
- `pnpm qa:r4-web-live-route-interaction` with R4.14 env
- `pnpm test`
- `git diff --check`
- no `reference` or `references` directories, and no secret scan matches

Browser gates 建议新增：

- `r4_14_intake_route_component=true`
- `r4_14_option_first_no_chat_wall=true`
- `r4_14_intake_submit_notice=true`
- `r4_14_intake_fail_closed=true`
- `r4_14_knowledge_fallback_route=true`
- `r4_14_mobile_no_overflow=true`
- `r4_13_proposal_advanced_regression=true`
- `no_duplicate_route_loader_calls=true`

## 7. PRD / 概念图验收口径

- `web-option-first-intake-wizard.png`：Intake 首屏必须是选项优先；文本输入只作为折叠兜底。
- `web-project-drive-meetings-knowledge.png`：Knowledge fallback 展示来源和可打开链接，不做无来源回答。
- `web-project-attention-workspace.png`：Intake / Knowledge 不能把默认首页带回多列 Kanban；Home 仍是一件最需要判断的事。

## 8. 后续候选

R4.14 通过后进入 R4.15：Web settings / locale persistence / device boundary hardening。目标是把语言偏好、桌面能力门、运行时状态和错误恢复统一到 typed settings surface，并继续保留主窗无 Cuu、本地能力不在 Web 执行的边界。
