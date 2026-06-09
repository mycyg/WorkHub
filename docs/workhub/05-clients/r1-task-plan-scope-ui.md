# R1.40 Task Plan Scope UI

R1.40 关闭的缺口：当一个 WorkItem 已经存在多个 task plan，尤其是 `dispatch` 与 `worker` 多阶段并存时，`task_items` 结构化写回不能继续由后端猜“最新计划”。用户必须先点选目标 plan，系统才允许写入。

## 1. PRD 对齐

| 原则 | R1.40 行为 |
|---|---|
| AI 是主力 | 默认仍展示 AI 融合建议，不把任务拆成重型看板 |
| 用户点选，不打字 | Proposal 的子记录编辑区展示目标 plan 按钮，按钮 payload 直接携带 `task_plan_scope.target_plan_id` |
| 严肃主界面无 Cuu 本体 | Web/desktop 主窗只显示业务选择控件；Cuu 后续只做摘要 bubble 和 deep-link |
| 变更申请像 GitHub PR | `task_items` 写回前有明确 target plan，就像 PR merge 前必须明确目标分支/文件 |
| 可审计、可回放 | DB 写回只作用于选中的 plan；歧义场景返回稳定业务错误 `task_plan_scope_required` |

## 2. 已落地代码边界

| 层 | 已落地 |
|---|---|
| Contracts | `applyMergeProposalCandidateRequestSchema` 新增 `task_plan_scope.target_plan_id` |
| API route | `POST /api/merge-proposals/:id/apply` 解析并透传 `task_plan_scope` |
| Service | `applyMergeCandidate` 把 plan scope 绑定到 `resolvedStructuredFieldPatch.taskPlanScope` |
| DB repository | `task_items` patch 写回前解析 WorkItem 下所有 task plans；多 plan 无 scope 时拒绝；有 scope 时只重写目标 plan |
| UI | Proposal 子记录编辑区可渲染 `task_plan_scope.options[]`，生成“先选目标计划”按钮与 request template |
| Tests | contracts、UI、API in-memory repository 均覆盖 plan scope payload、按钮、歧义拒绝和定向写回 |

## 3. 计划数据契约

### 3.1 Apply request

```json
{
  "confirm": true,
  "task_plan_scope": {
    "target_plan_id": "10000000-0000-4000-8000-000000000418"
  }
}
```

可与 `structured_item_overrides` 组合：

```json
{
  "confirm": true,
  "task_plan_scope": {
    "target_plan_id": "10000000-0000-4000-8000-000000000418"
  },
  "structured_item_overrides": {
    "items": [
      {
        "field": "task_items",
        "item_id": "10000000-0000-4000-8000-000000000413",
        "decision": "accept_incoming"
      }
    ]
  }
}
```

### 3.2 Quality gate UI hint

Proposal renderer 从 `structured_record_patch.task_plan_scope`、`structured_field_patch_dry_run.task_plan_scope` 或 `dry_run.audit_payload.task_plan_scope` 读取 UI hint。建议后续 provider / merge mediator 写入：

```json
{
  "task_plan_scope": {
    "selected_plan_id": "10000000-0000-4000-8000-000000000418",
    "options": [
      {
        "id": "10000000-0000-4000-8000-000000000418",
        "label": "方案拆解计划",
        "stage": "dispatch",
        "status": "draft",
        "item_count": 1,
        "recommended": true
      },
      {
        "id": "10000000-0000-4000-8000-000000000419",
        "label": "执行计划",
        "stage": "worker",
        "status": "draft",
        "item_count": 3
      }
    ]
  }
}
```

## 4. 后端写回规则

| 场景 | 行为 |
|---|---|
| WorkItem 没有 task plan | 维持兼容：如 patch 写入非空 `task_items`，创建新的 `dispatch` draft plan |
| WorkItem 只有一个 task plan | 维持兼容：可直接写入该 plan |
| WorkItem 有多个 task plan 且无 scope | 拒绝，`409 task_plan_scope_required` |
| scope 指向不存在或不属于该 WorkItem 的 plan | 拒绝，`409 task_plan_scope_invalid` |
| scope 指向合法 plan | 只删除并重写该 plan 的 `work_item_task_items` |
| 当前目标 plan items 与 patch base / incoming 都不一致 | 拒绝，`409 structured_field_patch_conflict` |

## 5. 页面与 Cuu 行为

| Surface | 行为 |
|---|---|
| Web Proposal | 在高级子记录编辑区的 `task_items` 区块上方显示“先选目标计划”按钮组 |
| Desktop main webview | 与 Web Proposal 共享 renderer；主窗不出现 Cuu 本体 |
| Cuu pet window | 后续只显示轻量 bubble：“这次要写入哪个计划？”并 deep-link 到 Proposal；不展示表格和完整 diff |
| Replay | R1.40 暂不新增 Replay 展示；后续应把 `targetPlanId` 写入 field_merge audit 后再回放 |

## 6. 验收

本切片已跑通：

- `corepack pnpm --filter @workhub/contracts test`
- `corepack pnpm --filter @workhub/ui test`
- `corepack pnpm --filter @workhub/api test`
- `corepack pnpm --filter @workhub/db typecheck`
- `corepack pnpm --filter @workhub/api typecheck`
- `corepack pnpm --filter @workhub/ui typecheck`
- `corepack pnpm qa:r1-route-visual`，`route-visual-report.json:gates.task_plan_scope=true`

提交前仍需跑：

- `corepack pnpm verify`
- `git diff --check`
- `reference_paths=0`
- `secret_like_matches=0`

## 7. 后续切片

| 阶段 | 工作 |
|---|---|
| R1.41 | Text hunk materializer 已落：见 [`r1-text-hunk-materializer.md`](./r1-text-hunk-materializer.md)，`text_hunk_overrides` 已升级为 API/service/DB 正式逐段写回 |
| R1.42 | Multi-conflict execution audit 已落：见 [`r1-multi-conflict-execution-audit.md`](./r1-multi-conflict-execution-audit.md)，批量 keep/accept payload 写 `bulk_action` 审计 |
| R1.43 | Replay audit polish：把 `targetPlanId`、plan label、plan stage/status、`text_hunk_decisions` 与 `bulk_action` 渲染为可读回放 |
| R4 | 把 plan scope 场景纳入 route visual QA 和真实 loading/error/forbidden 状态矩阵 |
