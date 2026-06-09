---
module: 05-clients
layer: C-WEB / C-DESKTOP / C-UIKIT
status: r1-44-landed
owner: workflow
date: 2026-06-10
visuals:
  - ./assets/audit/2026-06-10-r1-route-visual-qa/contact-sheet.png
  - ./assets/web/web-deliverable-change-request.png
  - ./assets/web/web-files-meetings-approvals-atlas.png
---

# R1.44 Route Line Editor

R1.44 关闭 R1.36-R1.43 留下的 route 级产品化缺口：`text_hunk_overrides` 已能后端写回，Replay 已能解释当时选择，但 Proposal 真实 route 里还缺一个可搜索、可按文件切换、可键盘操作、能提交完整逐段 payload 的轻量 line editor。

本切片继续遵守 AI-native 设计：用户不手打正文，不进入复杂代码编辑器；AI 先给融合稿和建议，用户只在必要的 hunk 上点选来源。

## 1. 概念对齐

| 原则 | R1.44 行为 |
|---|---|
| 点选优先 | 逐段只允许 `keep_current` / `accept_incoming` / `ai_fusion`，不新增自由文本正文写回 |
| AI 主力 | 默认选择来自 `recommended_option_id`，用户只改少数需要判断的段 |
| 变更申请像 PR 但非代码专用 | editor 挂在 Proposal 严肃页，目标可以是 `text_doc` / `spec_doc` 交付物 |
| 看板降级 | editor 只在真实文本冲突出现时渲染；多冲突批量区仍折叠 |
| 主窗严肃 | Web / desktop 主窗不显示 Cuu 本体，Cuu 只保留摘要和 deep-link |
| 中英双语 | 标题、搜索、应用按钮、hunk 决策文案覆盖 zh-CN / en-US |

开工前阅读基准：

- [`page-concepts.md`](./page-concepts.md)
- [`web-app.md`](./web-app.md)
- [`r1-route-visual-qa.md`](./r1-route-visual-qa.md)
- [`r1-text-hunk-materializer.md`](./r1-text-hunk-materializer.md)
- [`r1-replay-hunk-bulk-audit.md`](./r1-replay-hunk-bulk-audit.md)
- [`../06-roadmap/review-driven-r0-r4-detailed-construction-plan-2026-06-08.md`](../06-roadmap/review-driven-r0-r4-detailed-construction-plan-2026-06-08.md)

## 2. 用户交互合同

Proposal route 在 `conflicts[]` 中发现带 `quality_gate.text_diff3.type="line_text_diff3"` 且有 apply action 的文本冲突时，渲染 `data-route-line-editor="true"`。

| UI 区 | 行为 |
|---|---|
| 文件 tabs | 每个可逐段处理的文本 target 一个 tab；默认打开第一个 |
| 搜索 | `type=search` 在当前 tab 内按行文本过滤；DOM 记录 `data-line-editor-match-count` |
| 行预览 | 从 `quality_gate.text_patch_preview.hunks[].lines[]` 渲染增删/上下文行，长 patch 在滚动容器内处理 |
| Hunk 决策 | 每个 `conflict_ranges[]` hunk 渲染三种来源按钮，并有 `aria-pressed` 选中态 |
| 应用 | `data-line-editor-apply` anchor 写入完整 `text_hunk_overrides.hunks[]`，覆盖当前文件所有 hunk |
| 键盘 | hunk article 可聚焦；`ArrowDown` / `ArrowUp` 在当前 panel 内移动 hunk 焦点；按钮保持原生 Enter/Space 行为 |

## 3. Payload Contract

初始 payload 由 renderer 根据默认来源生成：

```json
{
  "confirm": true,
  "text_hunk_overrides": {
    "hunks": [
      {
        "hunk_index": 0,
        "start_line": 18,
        "end_line": 22,
        "decision": "ai_fusion"
      },
      {
        "hunk_index": 1,
        "start_line": 61,
        "end_line": 65,
        "decision": "ai_fusion"
      }
    ]
  }
}
```

浏览器 runtime 在用户点击 hunk 来源按钮后重写同一个 `data-request-json`，确保提交到 `/api/merge-proposals/:id/apply` 的 payload 仍覆盖全部 hunk。后端 R1.41 的 fail-closed 规则继续生效：缺 range、重复 hunk、range mismatch、未覆盖全部 conflict ranges、stale current/base/source 都拒绝。

## 4. 实现落点

| 层 | 文件 | R1.44 落点 |
|---|---|---|
| Shared renderer | `packages/ui/src/route-line-editor.ts` | 新增 line editor HTML / CSS renderer，消费 `ProposalConflict[]` |
| Proposal page | `packages/ui/src/proposal/render.ts` | 在冲突头部后、折叠批量区前渲染 route line editor |
| i18n | `packages/ui/src/i18n.ts` | 新增 `proposal.lineEditorTitle/Search/Apply` |
| Web runtime | `apps/web/src/browser.ts` | 事件委托处理 tab/search/hunk decision，并更新完整 apply payload |
| Desktop runtime | `apps/desktop-webview/src/browser.ts` | 与 Web 同步处理 line editor runtime |
| QA | `scripts/qa/r1-route-visual-qa.ts` | 新增 `route_line_editor`、tabs、search、apply payload DOM gates |
| Tests | `packages/ui/src/proposal/render.test.ts` | 覆盖 markers、双语文案、line rows、apply payload |

## 5. DOM Markers

R1.44 的稳定 markers：

- `data-route-line-editor="true"`
- `data-route-line-editor-file-count`
- `data-route-line-editor-hunk-count`
- `data-route-line-editor-row-count`
- `data-line-editor-tab`
- `data-line-editor-panel`
- `data-line-editor-search="true"`
- `data-line-editor-row="true"`
- `data-line-editor-hunk="true"`
- `data-line-editor-decision`
- `data-line-editor-decision-selected`
- `data-line-editor-apply="true"`

这些 markers 用于 route visual QA、后续 React route 迁移和 Playwright 交互检查。后续 React 组件必须保留这些语义，不能只换视觉。

## 6. 失败语义

| 场景 | 行为 |
|---|---|
| 无 `text_diff3` 或无 conflict ranges | 不渲染 line editor |
| 无 apply action | 不渲染 line editor，避免展示无法提交的假控件 |
| 搜索无匹配 | 当前 panel 的 rows 全部 hidden，match count 为 0；不影响 hunk 决策 |
| 用户只点一个 hunk | runtime 重写 payload 时仍携带所有 hunk，未点 hunk 保留默认来源 |
| 运行时 JS 未加载 | 初始 `data-request-json` 仍是完整 payload；页面降级为默认来源 apply |
| Cuu surface | 不展示 line editor；Cuu 只摘要/deep-link 到 Proposal |

## 7. 验收

本切片完成条件：

- Proposal HTML 出现 `data-route-line-editor="true"`、file tab、search input、line rows、hunk decisions 和 apply payload。
- `data-request-json` 含完整 `text_hunk_overrides.hunks[]`，不是单 hunk 临时模板。
- zh-CN / en-US 文案均通过 renderer test。
- Web 与 desktop browser runtime typecheck 通过。
- `pnpm qa:r1-route-visual` 的 DOM report gate 包含 line editor。
- 主窗仍无 Cuu 本体、无默认重看板词、无横向溢出。

## 8. 后续工作

| 阶段 | 工作 |
|---|---|
| R2 | 在 PG claim / 多 worker 下验证 line editor apply 与 text hunk materializer 不重复、不丢审计 |
| R4 | 把 line editor 迁移成真实 React route component，接 loading/error/forbidden VM 和 Playwright 交互测试 |
| Drive | 完整文件历史、redo、富预览、多文件 restore、Office/PPT/table diff 不属于 R1.44 |
| Cuu | 只追加 line editor 摘要和 deep-link，不把逐行控件放入 pet bubble |
