---
module: 05-clients
layer: C-WEB / C-DESKTOP / API / Contracts
status: r1-43-landed
owner: workflow
date: 2026-06-10
visuals:
  - ./assets/audit/2026-06-10-r1-route-visual-qa/contact-sheet.png
---

# R1.43 Replay Hunk / Bulk Audit

R1.43 关闭 R1.41 与 R1.42 留下的解释缺口：数据库已经记录了文本 hunk 逐段选择和批量 keep / accept 意图，但 Replay 页面此前还没有把这些机器字段翻译成“当时用户到底选了什么”的可读审计。

本切片继续保持 PRD 方向：Replay 负责解释历史决策，不变成重型编辑器、看板或 Cuu surface。

## 1. 概念对齐

| 原则 | R1.43 行为 |
|---|---|
| AI 默认处理复杂度 | Replay 只突出少数真正影响 merge 的人工选择 |
| GitHub-like proposal | text hunk 与 bulk action 都作为业务审计事实展示，不限代码 diff |
| 点选优先 | 来源仍来自已有点击决策：`keep_current`、`accept_incoming`、`ai_fusion` |
| 主窗严肃 | Web 与 desktop 主窗只显示审计摘要，不显示 Cuu 本体 |
| Cuu 轻量 | Cuu 只做摘要和 deep-link，不承载完整 hunk / bulk 列表 |
| 中英双语 | 新可见文案覆盖 zh-CN / en-US renderer 测试 |

开工前阅读基准：

- [`page-concepts.md`](./page-concepts.md)
- [`r1-route-visual-qa.md`](./r1-route-visual-qa.md)
- [`r1-text-hunk-materializer.md`](./r1-text-hunk-materializer.md)
- [`r1-multi-conflict-execution-audit.md`](./r1-multi-conflict-execution-audit.md)
- [`../06-roadmap/review-driven-r0-r4-detailed-construction-plan-2026-06-08.md`](../06-roadmap/review-driven-r0-r4-detailed-construction-plan-2026-06-08.md)

## 2. 数据来源

Replay 仍以 `merge_attempts + merge_proposals` 组装 `merge_timeline[]`。R1.43 新增 attempt 级 proposal audit 绑定：

1. 读取 `listAuditLogsForEntity("proposal", proposal_id)`。
2. 只保留 `detail_json.merge_attempt_id === merge_attempt.id` 的 audit rows。
3. 从 `proposal.merged.detail_json.text_hunk_decisions[]` 读取逐段选择。
4. 优先从 `audit_logs(action="proposal.bulk_action")` 读取批量动作详情。
5. 若没有 `proposal.bulk_action` row，则回退读取 `proposal.merged.detail_json.bulk_action` 摘要。

这样不会扩大 generic `audit_logs[]` 返回面；面向用户的 merge 事实会挂在造成它的 `ReplayMergeAttemptVM` 上。

## 3. Public VM Contract

`ReplayMergeAttemptVM` 新增：

```ts
type ReplayTextHunkDecisionVM = {
  hunk_index: number;
  start_line: number;
  end_line: number;
  decision: "keep_current" | "accept_incoming" | "ai_fusion";
};

type ReplayBulkActionVM = {
  action: "keep_current" | "accept_incoming";
  target_keys: string[];
  conflict_count?: number;
  result?: string;
  accepted_incoming_target_keys: string[];
  resolved_conflict_target_keys: string[];
  blocked_target_keys: string[];
  audit_id?: string;
};
```

| 字段 | 用途 |
|---|---|
| `text_hunk_decisions[]` | 每个重叠文本段最终采用的来源 |
| `text_hunk_count` | merge audit 中记录的原始 hunk 数 |
| `text_hunk_output_sha256` | 逐段 materialize 后的最终文本校验值 |
| `bulk_action` | 用户点击的批量 keep / accept 动作、结果和影响范围 |

## 4. 实现落点

| 层 | 文件 | R1.43 落点 |
|---|---|---|
| Contracts | `packages/contracts/src/pages.ts` | 新增 `ReplayTextHunkDecisionVM`、`ReplayBulkActionVM`，扩展 `ReplayMergeAttemptVM` |
| API page builder | `apps/api/src/pages/replay.ts` | 将 audit detail 归一化为 Replay VM 字段，畸形字段 fail-soft |
| API route | `apps/api/src/routes/agent-runs.ts` | 读取 proposal audit rows，并按 `merge_attempt_id` 过滤到当前 attempt |
| UI renderer | `packages/ui/src/replay/render.ts` | 渲染 hunk / bulk 两个审计区，覆盖 zh-CN / en-US |
| Tests | contracts / api / ui | 覆盖 schema parse、replay response、双语 HTML markers |

## 5. UI Contract

`text_hunk_decisions.length > 0` 时渲染 text hunk audit：

- section marker：`data-replay-text-hunk-decision-audit="true"`。
- count marker：`data-replay-text-hunk-decision-count`。
- row marker：`data-replay-text-hunk-decision`。
- source marker：`data-replay-text-hunk-source`。
- 标题：`逐段选择回放` / `Hunk decision replay`。
- 行号：`第 8-11 行` / `Lines 8-11`。

`bulk_action` 存在时渲染 bulk audit：

- section marker：`data-replay-bulk-action-audit="true"`。
- action marker：`data-replay-bulk-action`。
- result marker：`data-replay-bulk-result`。
- 标题：`批量动作回放` / `Bulk action replay`。
- 行：点击范围、采纳范围、已处理、被阻断。

移动端下 `.wh-replay-audit-row` 收为单列，继续遵守 R1.39 的 no-horizontal-overflow route contract。

## 6. 失败语义

| 场景 | 行为 |
|---|---|
| 缺 proposal audit rows | 仍渲染 attempt / decisions；hunk / bulk 审计区省略 |
| 某条 hunk decision 畸形 | 跳过该条，不让整个 Replay 失败 |
| 缺 `proposal.bulk_action` row | 回退读取 `proposal.merged.detail_json.bulk_action` |
| output sha 不是 64 字符 | 不返回 `text_hunk_output_sha256` |
| Cuu surface | 不展示完整 diff 或 bulk list，只保留摘要和 deep-link |

## 7. 验收

本切片完成条件：

- `GET /api/agent-runs/:id/replay` 在 text hunk merge audit 后返回 `merge_timeline[].text_hunk_decisions[]`。
- `GET /api/agent-runs/:id/replay` 在 bulk keep / accept audit 后返回 `merge_timeline[].bulk_action`。
- Replay HTML 显示中英双语 hunk / bulk audit section，并带稳定 `data-*` markers。
- Web / desktop 主窗不出现 Cuu 本体。
- 不改 `reference/` / `references/`。
- 提交前通过 `corepack pnpm verify`、`git diff --check`、`reference_paths=0`、`secret_like_matches=0`。

## 8. 后续工作

| 阶段 | 工作 |
|---|---|
| R1.44 | React route line editor：文件 tabs、逐行编辑、长文搜索、键盘可达性 |
| R2 | 在 PG claim / 多 worker 下验证 hunk / bulk audit 不丢、不重 |
| R4 | 把 Replay hunk / bulk audit 纳入真实 loading / error / forbidden 截图矩阵 |
| Drive | 完整文件历史、redo、富预览和多文件 restore 不属于 R1.43 |
