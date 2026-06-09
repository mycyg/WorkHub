# R1.42 Multi-conflict Execution Audit

module: C-WEB / C-DESKTOP / API / DB  
layer: Proposal / Replay / Audit  
status: current  
owner: WorkHub

## 1. Why This Slice Exists

R1.38 已经把多冲突场景从“满屏表格工作台”收敛成折叠的批量检查区：默认仍让 AI 递出一件需要用户判断的事，用户只在明确需要时展开批量 keep / accept。R1.41 又把重叠文本 hunk 从 UI 点选意图升级成后端可执行写回。

R1.42 关闭的缺口是：批量按钮此前只复用 `accept_incoming_target_keys[]`，能执行但缺少“这是一次批量动作”的显式审计。失败时尤其不清楚用户是单点尝试失败，还是点击了“全部保留当前版本”后被冲突 gate 阻断。

本切片不引入重型看板，不做批量 AI fusion，不做逐行编辑器，也不绕过现有冲突保护。它只把现有 option-first 批量动作升级为可审计、可回放的数据事实。

## 2. Concept And QA References

开工前必须阅读这些现有概念与截图证据：

| Reference | 用途 |
|---|---|
| [`page-concepts.md`](./page-concepts.md) | Web / desktop 主窗保持严肃业务界面，不把 Cuu 放回页面 |
| [`prd-concept-reproduction-gap-audit.md`](./prd-concept-reproduction-gap-audit.md) | PRD 对“AI 递一件事、看板弱化、GitHub-like proposal”的当前差距 |
| [`r1-route-visual-qa.md`](./r1-route-visual-qa.md) | Proposal / Replay route 截图、移动端 overflow gate、多冲突折叠区证据 |
| [`assets/audit/2026-06-10-r1-route-visual-qa/contact-sheet.png`](./assets/audit/2026-06-10-r1-route-visual-qa/contact-sheet.png) | R1.39 真实 route contact sheet；验证主窗无 Cuu、无重看板默认词 |
| [`r1-text-hunk-materializer.md`](./r1-text-hunk-materializer.md) | R1.41 text hunk materialize 与后续 Replay hunk audit 的边界 |

## 3. UX Contract

| Surface | R1.42 行为 |
|---|---|
| Web Proposal | 多冲突时继续显示折叠批量检查区；按钮 request JSON 会带 `conflict_resolution.bulk_action` |
| Desktop main webview | 与 Web Proposal 共用 renderer；仍是严肃主窗，不出现 Cuu 本体 |
| Cuu pet window | 不承载批量列表；最多提示“有多项需要处理”并 deep-link 到 Proposal |
| Replay | 本切片先把成功 merge 的 `bulk_action` 写入 `proposal.merged.detail_json`，失败/成功都写 `audit_logs(action="proposal.bulk_action")`；用户可读 Replay 渲染顺延 |

### Option-first Rule

批量动作仍是按钮点击，不要求用户输入 JSON 或手打说明：

- `keep_current`：`accept_incoming_target_keys=[]`，表示保留正式版。若当前 proposal 还有未解决冲突，后端返回 409，但必须写 `proposal.bulk_action` 审计，说明这次批量保留被哪些 target 阻断。
- `accept_incoming`：`accept_incoming_target_keys=[全部 target_key]`，表示全部采用 incoming。若所有冲突都被该列表覆盖，merge 成功并写正式 accepted deliverable / Drive version / audit。

## 4. Public Contract

### Request

`POST /api/proposals/:id/merge`

```json
{
  "confirm": true,
  "conflict_resolution": {
    "accept_incoming_target_keys": ["delivery:/outputs/brief.md"],
    "bulk_action": {
      "action": "accept_incoming",
      "target_keys": ["delivery:/outputs/brief.md", "work_item:wi-1:task_items"],
      "conflict_count": 2
    }
  }
}
```

`bulk_action` 字段只描述用户点击的批量意图，真正是否可写仍由现有 merge gate 决定。不得因为声明了 `bulk_action` 就跳过 `sha256_before/version_before`、target 冲突、源文件校验、task plan scope、text hunk range 等保护。

### Contract Types

| Type | Owner |
|---|---|
| `mergeProposalBulkActionSchema` | `packages/contracts/src/domain/collaboration.ts` |
| `MergeProposalBulkAction` | `packages/contracts/src/domain/collaboration.ts` |
| `ProposalConflictResolution.bulkAction` | `apps/api/src/services/proposals.ts` |
| `ProposalMergeBulkActionInput` | `packages/db/src/repositories/proposals.ts` |

### Audit Payload

`audit_logs.action="proposal.bulk_action"`:

```json
{
  "work_item_id": "wi_123",
  "branch_id": "br_123",
  "bulk_action": {
    "action": "keep_current",
    "target_keys": ["delivery:/outputs/a.md", "delivery:/outputs/b.md"],
    "conflict_count": 2
  },
  "result": "conflict",
  "merge_attempt_id": "attempt_123",
  "accepted_incoming_target_keys": [],
  "resolved_conflict_target_keys": [],
  "blocked_target_keys": ["delivery:/outputs/a.md", "delivery:/outputs/b.md"],
  "target_keys": ["delivery:/outputs/a.md", "delivery:/outputs/b.md"]
}
```

成功 merge 时 `result="merged"`，并额外带 `merge_snapshot_id`；同时 `proposal.merged.detail_json` 会包含同一 `bulk_action` 摘要，方便后续 Replay 页面从正式 merge audit 中读取。

## 5. Implementation Map

| Layer | Files | R1.42 落点 |
|---|---|---|
| Contracts | `packages/contracts/src/domain/collaboration.ts` | 定义 `bulk_action` schema 并挂到 `mergeProposalRequestSchema.conflict_resolution` |
| UI renderer | `packages/ui/src/proposal/render.ts` | 批量 keep / accept request JSON 带 `bulk_action.action/target_keys/conflict_count` |
| API route | `apps/api/src/routes/proposals.ts` | snake_case payload 转为 service camelCase `bulkAction` |
| Service | `apps/api/src/services/proposals.ts` | 把 `conflictResolution.bulkAction` 透传给 repository |
| DB repository | `packages/db/src/repositories/proposals.ts` | conflict 与 merged 两条路径都写 `proposal.bulk_action` audit；成功 merge 的 `proposal.merged.detail_json` 附带 `bulk_action` |
| Tests | contracts / ui / api | 覆盖 request schema、HTML payload、service-to-repository passthrough |

## 6. Failure Semantics

| 场景 | 行为 |
|---|---|
| 多冲突点击 `keep_current` | 写 `merge_attempts(result="conflict")` 与 `proposal.bulk_action(result="conflict")`，返回 409 `merge_conflict` |
| 多冲突点击 `accept_incoming` 且 target 覆盖完整 | 正常 merge，写 accepted ledger、Drive version、snapshot、`proposal.merged` 与 `proposal.bulk_action(result="merged")` |
| bulk target 与真实冲突不完全一致 | 真实写入仍以 repository 计算的 `targetKeys/conflicts/resolvedConflicts` 为准，审计同时保留用户点击的 target 列表 |
| 源文件缺失、sha 不一致、task plan scope 缺失、text hunk range mismatch | 继续 fail-closed；`bulk_action` 不降低任何保护级别 |

## 7. Acceptance

本切片的验收条件：

- 多冲突批量按钮 HTML 中能看到 `bulk_action`、`action`、`target_keys`、`conflict_count`。
- `mergeProposalRequestSchema` 能 parse 批量 payload。
- API route 能把 `bulk_action` 转给 service，service 能转给 repository。
- repository 在 conflict 和 merged 路径都能写 `proposal.bulk_action` 审计。
- 成功 merge 的 `proposal.merged.detail_json` 带 `bulk_action` 摘要。
- 不新增 `reference` / `references` 提交。
- `corepack pnpm verify`、`git diff --check`、`reference_paths=0`、`secret_like_matches=0` 通过。

## 8. Remaining Work

| 阶段 | 工作 |
|---|---|
| R1.43 | Replay hunk decision audit：把 `text_hunk_decisions[]` 与 `bulk_action` 渲染为用户可读回放 |
| R1.44 | React route 级逐行选择/编辑产品化：文件 tabs、逐行编辑、长文搜索、键盘可达性 |
| R2 | PG claim / 多 worker / 事件 broker；确保批量审计在多实例下仍不丢、不重 |
| R4 | 全页面真实 route loading/error/forbidden 截图矩阵与 Drive 历史/redo UI |
