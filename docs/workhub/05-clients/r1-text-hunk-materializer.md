---
module: 05-clients
layer: C-WEB / C-DESKTOP / API / DB
status: r1-41-landed
owner: workflow
date: 2026-06-10
visuals:
  - ./assets/audit/2026-06-10-r1-route-visual-qa/contact-sheet.png
---

# R1.41 Text Hunk Materializer

R1.41 关闭的缺口：R1.36 已让 Proposal / Replay 能显示重叠文本 hunk，并生成 `text_hunk_overrides` 点选意图；但后端此前仍只能整体采用 AI fusion。现在 `POST /api/merge-proposals/:id/apply` 可以正式接收逐段 hunk 决策，按 current / incoming / AI fusion 逐段 materialize 最终文本，再写入正式 Drive version 和 merge audit。

## 1. PRD 对齐

| 原则 | R1.41 行为 |
|---|---|
| 用户点选，不打字 | 用户只需在每个重叠段点“保留正式版 / 采纳这次版本 / 采用 AI 融合稿” |
| AI 是主力 | AI fusion 仍是推荐候选；逐段选择只处理确实冲突的少数 hunk |
| 变更申请像 GitHub PR | 文本冲突从“整篇覆盖”升级为逐段 hunk 决策，且每段选择可回放 |
| 不写脏文件 | 输出正文拒绝 `<<<<<<<` / `=======` / `>>>>>>>` 冲突标记 |
| 可审计 | `proposal.merged.detail_json` 记录 overrides、decisions、conflict ranges 与 base/current/incoming/output sha |

## 2. 已落地代码边界

| 层 | 已落地 |
|---|---|
| Contracts | `ApplyMergeProposalCandidateRequest.text_hunk_overrides.hunks[]`，每项含 `hunk_index/start_line/end_line/decision` |
| API route | `POST /api/merge-proposals/:id/apply` 解析并透传 `text_hunk_overrides` |
| Service | 读取 full base/current/incoming/AI fusion 文本，按 `quality_gate.text_diff3.conflict_ranges[]` 校验覆盖范围 |
| Materializer | `apps/api/src/services/text-hunk-materializer.ts` 基于 line diff hunks 组装最终文本，非冲突区自动合并，冲突区按用户选择落段 |
| DB repository | 复用 accepted deliverable / Drive version / snapshot / merge attempt 链路，并在 `proposal.merged` audit 写入 text hunk patch 详情 |
| Tests | contracts 覆盖 payload 与非法 range；API service 覆盖 range mismatch 拒绝、incoming 段采纳、最终文件内容不是整篇 AI fusion |

## 3. Apply request

```json
{
  "confirm": true,
  "text_hunk_overrides": {
    "hunks": [
      {
        "hunk_index": 0,
        "start_line": 18,
        "end_line": 22,
        "decision": "accept_incoming"
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

`decision` 只允许：

| decision | 写入来源 |
|---|---|
| `keep_current` | 当前正式文本对应 hunk |
| `accept_incoming` | 本次提交文本对应 hunk |
| `ai_fusion` | AI 融合稿对应 hunk |

## 4. 后端写回规则

| 场景 | 行为 |
|---|---|
| `target_kind` 不是 `text_doc/spec_doc` | 拒绝，`409 text_hunk_target_unsupported` |
| 缺 `quality_gate.text_diff3.conflict_ranges[]` | 拒绝，`409 text_hunk_ranges_missing` |
| override hunk 重复 | 拒绝，`409 text_hunk_override_duplicate` |
| override range 与 quality gate 不一致 | 拒绝，`409 text_hunk_range_mismatch` |
| 未覆盖全部 conflict ranges | 拒绝，`409 text_hunk_override_missing` |
| base/current/incoming 文件缺失、sha stale 或源文件变化 | 拒绝，保持 proposal 未合并 |
| materialize 后仍含冲突 marker | 拒绝，`409 merge_candidate_contains_conflict_markers` |
| 校验通过 | 生成最终文本，写正式 Drive version、accepted ledger、snapshot、merge attempt 和 `proposal.merged` audit |

## 5. 审计 payload

`proposal.merged.detail_json` 会追加：

```json
{
  "text_hunk_overrides": {
    "hunks": [
      {
        "hunk_index": 0,
        "start_line": 18,
        "end_line": 22,
        "decision": "accept_incoming"
      }
    ]
  },
  "text_hunk_decisions": [
    {
      "hunkIndex": 0,
      "startLine": 18,
      "endLine": 22,
      "decision": "accept_incoming"
    }
  ],
  "text_hunk_conflict_ranges": [
    {
      "hunkIndex": 0,
      "startLine": 18,
      "endLine": 22
    }
  ],
  "text_hunk_count": 1,
  "text_hunk_base_sha256": "...",
  "text_hunk_current_sha256": "...",
  "text_hunk_incoming_sha256": "...",
  "text_hunk_output_sha256": "..."
}
```

## 6. 页面与 Cuu 行为

| Surface | 行为 |
|---|---|
| Web Proposal | R1.36 已生成 `text_hunk_overrides` request template；R1.41 后这些按钮可真实写回 |
| Desktop main webview | 与 Web Proposal 共享 renderer；主窗仍严肃、无 Cuu 本体 |
| Replay | 当前能展示 hunk review 与 candidate quality gate；R1.42 已补批量动作审计，R1.43 应把 audit 中实际 `text_hunk_decisions` 与批量动作显式回放成“当时每段/每批选了什么” |
| Cuu pet window | 只给轻量摘要和 deep-link，不展示完整 diff，不承担逐行编辑器 |

## 7. 验收

本切片已跑通：

- `corepack pnpm --filter @workhub/contracts test`
- `corepack pnpm --filter @workhub/api test`
- `corepack pnpm --filter @workhub/db typecheck`
- `corepack pnpm --filter @workhub/api typecheck`

提交前仍需跑：

- `corepack pnpm verify`
- `git diff --check`
- `reference_paths=0`
- `secret_like_matches=0`

## 8. 后续切片

| 阶段 | 工作 |
|---|---|
| R1.42 | Multi-conflict execution audit 已落：见 [`r1-multi-conflict-execution-audit.md`](./r1-multi-conflict-execution-audit.md)，批量 keep/accept payload 会写 `bulk_action` 审计 |
| R1.43 | Replay hunk decision audit：把 `text_hunk_decisions` 与 `bulk_action` 渲染为可读回放，说明每段/每批最终来源 |
| R1.44 | React route 级逐行选择/编辑产品化：文件 tabs、逐行编辑、长文搜索、键盘可达性 |
| R4 | 把 text hunk materializer 场景纳入真实 loading/error/forbidden 截图矩阵 |
