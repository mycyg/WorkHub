---
module: 05-clients
layer: C-WEB / C-PET / C-UIKIT
status: current
owner: workflow
date: 2026-06-08
---

# P1.2 Non-GoldPath Render Helpers I18n

> 当前口径：P1.2 只处理非 Gold Path typed render helpers 的**固定 UI 文案**和**可见 enum 标签**。用户输入、LLM 摘要、证据摘录、proposal manifest、action.label 和事件输出继续保持 daemon 原文，不在客户端假翻译。

## 1. 本轮目标

P1.1 已经让 locale 进入 contracts、API Page VM 和 Cuu/pet 固定文案。P1.2 继续把同一 locale contract 接到未来真实 routes 会复用的非 Gold Path helpers：

- `renderIntakeSession()`
- `renderWorkItemDetail()`
- `renderProposalDetail()`
- `renderAgentRunLive()`

目标不是重做页面视觉，而是把硬编码中文按钮、空态、状态卡和 raw enum 可见文本收敛成可测试词表。

## 2. Target TS paths

| 层 | Target paths | 当前职责 |
|---|---|---|
| Shared helper i18n | `packages/ui/src/i18n.ts` | 非 Gold Path fixed-copy 词表、enum label、人话 fallback、count formatter |
| Intake helper | `packages/ui/src/intake/render.ts` | `Option intake` / `AI recommended` / free-text / continue / progress aria 双语 |
| WorkItem helper | `packages/ui/src/workitem/render.ts` | status、acceptance、evidence、trace empty、rail 文案双语；可见 `ai_working` 改成人话 label |
| Proposal helper | `packages/ui/src/proposal/render.ts` | change/check/evidence/rollback/comments 固定文案双语；可见 `text_doc`、`generated`、`passed` 改成人话 label |
| AgentRun helper | `packages/ui/src/agent-run/render.ts` | live trace、status、handoff、replay/back/cancel、phase labels 双语；可见 `running`、`tool_result` 改成人话 label |
| Web facade | `apps/web/src/main.ts` | `renderWeb*` / `loadWeb*` 支持 optional `locale` 并传给 helper 或 Page VM client |
| Desktop facade | `apps/desktop-webview/src/main.ts` | `renderDesktop*` / `loadDesktop*` 支持 optional `locale`；Cuu card adapter 继续用 `packages/cuu` 词表 |

## 3. API shape

Helper 签名保持向后兼容：

```ts
renderWorkItemDetail(vm, "web");
renderWorkItemDetail(vm, "web", { locale: "en-US" });

renderWebWorkItemDetail(client, workItemId);
renderWebWorkItemDetail(client, workItemId, "en-US");
```

所有 locale 最终仍走 `packages/contracts/src/locale.ts` 的 `normalizeWorkHubLocale()`。

## 4. Visible enum label policy

页面 HTML 中仍保留 raw enum 作为 `data-*` 或返回值，供测试、自动化和状态机使用；但用户可见文案必须是人话。

| Raw value | 中文可见 | English visible |
|---|---|---|
| `ai_working` | `AI 正在处理` | `AI working` |
| `budget_exhausted` | `预算已用尽` | `Budget exhausted` |
| `tool_result` | `工具结果` | `Tool result` |
| `text_doc` | `文档` | `Text document` |
| `generated` | `生成` | `Generated` |
| `passed` | `通过` | `Passed` |

未知 enum 不崩溃，使用 `value.replace(/_/g, " ")` 作为降级显示，避免直接泄漏 snake_case。

## 5. Cuu / main-window boundary

P1.2 没有把 Cuu 形象放回 Web 或 desktop 主窗。原 helper rail 的可见标题统一改为 `AI 状态 / AI status`；`cuuState` 仍作为返回结构保留，用于独立 pet / Cuu adapter 做状态映射。

## 6. Tests / gates

已覆盖：

- `@workhub/ui`
  - intake 英文 fixed chrome：`AI recommended`、`Other / add context`、`Continue`
  - workitem 英文 fixed labels：`Live AI work`、`Acceptance checklist`、`AI working`，且可见 HTML 不出现 `ai_working`
  - proposal 英文 fixed labels：`Deliverable change request`、`What changed`、`Text document`、`Generated`
  - agent-run 英文 fixed labels：`Live AI work`、`Cancel run`、`Running`、`Thinking`
- `@workhub/web`
  - Web facade optional locale 可传到 intake/workitem/proposal/agent-run helper
- `@workhub/desktop-webview`
  - Desktop facade optional locale 可传到 main-window helper；Cuu card adapter locale 仍保持独立

本轮验收命令：

```powershell
pnpm --filter @workhub/ui test
pnpm --filter @workhub/ui build
pnpm --filter @workhub/web test
pnpm --filter @workhub/web build
pnpm --filter @workhub/desktop-webview test
pnpm --filter @workhub/desktop-webview build
git diff --check
```

## 7. 后续计划

| 阶段 | 工作 | 验收 |
|---|---|---|
| P1.3 User locale preference | 增 `me.locale` / user preference schema / settings action；登录后跨设备同步语言 | Web、desktop 主窗、pet 三端首屏语言一致 |
| P1.4 Visual regression | 给 Gold Path 与非 Gold Path helper 做中英 screenshot/DOM dump，检查文字不溢出 | 英文固定文案不挤压按钮、卡片、rail；主窗无 Cuu 形象 |
| P1.5 Server-generated multilingual VM | Agent / daemon 在生成 summary、proposal、evidence digest 时接 locale | 英文新任务的 summary 可由服务端生成英文；历史中文内容保留原文 |
| P1.6 OpenAPI contract | `openapi.json` 写入 `locale` query 与 `meta.locale` | codegen 后 Page VM client 不丢 locale |
| P1.7 Route components | 真实 React routes 迁移时复用同一 helper i18n，不重新散落硬编码 | `apps/web/src/routes/*` 和 `apps/desktop-webview` 不出现新固定中文散点 |
