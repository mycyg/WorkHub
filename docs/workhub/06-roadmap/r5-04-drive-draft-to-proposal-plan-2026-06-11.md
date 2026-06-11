---
module: R5-drive-draft-to-proposal
layer: M-DRIVE / M-WORKITEM / P-COLLAB / P-AI / C-WEB
status: planned
owner: workflow
date: 2026-06-11
visuals:
  - ../05-clients/assets/web/web-drive-preview-change-draft.png
  - ../05-clients/assets/web/web-project-drive-meetings-knowledge.png
depends_on:
  - r5-03-drive-comment-to-draft-plan-2026-06-11.md
  - ../04-modules/projects-and-drive.md
  - ../04-modules/requirements-workitem.md
  - ../03-collaboration/branch-proposal-merge.md
  - ../01-architecture/data-model.md
  - ../01-architecture/api-contract.md
---

# R5.4 Drive Draft To Proposal Plan

## 1. 开工前必读

- [`r5-03-drive-comment-to-draft-plan-2026-06-11.md`](./r5-03-drive-comment-to-draft-plan-2026-06-11.md)：comment-to-draft 已落，draft WorkItem 是本轮输入。
- [`../04-modules/projects-and-drive.md`](../04-modules/projects-and-drive.md)：Drive 正式文件、版本、回收站、操作日志与评论触发 LLM 的产品边界。
- [`../04-modules/requirements-workitem.md`](../04-modules/requirements-workitem.md)：WorkItem 状态、澄清、Agent run、验收项与提议入口。
- [`../03-collaboration/branch-proposal-merge.md`](../03-collaboration/branch-proposal-merge.md)：正式资料变更必须走 proposal review/merge，不直接写 main。
- [`../01-architecture/data-model.md`](../01-architecture/data-model.md) 与 [`../01-architecture/api-contract.md`](../01-architecture/api-contract.md)：WorkItem、Proposal、AcceptedDeliverable、ProjectDriveVersion 与审计字段。

## 2. 目标

R5.4 把 R5.3 生成的 Drive draft WorkItem 接入 proposal 主线：用户从 Drive comment 打开的 draft 可以带着 Drive source context 启动 AI 草案，产出可审阅的 proposal/change preview，最终仍由审批/merge 写回 accepted deliverable 或 Drive version。

必须完成：

1. Source context：WorkItem Page VM 显示 Drive comment 来源、folder path、目标文件/accepted deliverable 引用，不把来源塞进不可读 planning note。
2. Draft action：为 Drive-created WorkItem 暴露“生成变更提议”入口，复用现有 AgentRun/Proposal 机制或最小 deterministic proposal seed。
3. Proposal manifest：proposal changes 必须明确 target Drive item/version 或 accepted deliverable，preview/download/restore href 保持同一合同。
4. Drive feedback：Drive Page VM 在 draft 已进入 proposal 后展示 proposal href / status，并在 operation log 记录 draft-to-proposal。
5. 审计与权限：WorkItem、Proposal、Drive comment/operation 均有 audit；project/WorkItem/proposal 权限 fail-closed。
6. QA：API/service/UI/browser smoke 覆盖 source context、draft action、proposal link、双语文案、无 overflow。

不做：

- 不直接从 Drive 页面编辑正式文件正文。
- 不实现大模型高质量全文重写；若 Agent provider 不稳定，先用 deterministic manifest seed 验证数据流。
- 不把 Cuu 放进 Web 主窗口。

## 3. 数据流

```
Drive comment draft WorkItem
  -> WorkItem source context visible
  -> create proposal draft action
  -> AgentRun or deterministic proposal seed
  -> Proposal manifest targets Drive item/version
  -> Drive comment links proposal/status
  -> review/merge remains the only formal writeback path
```

硬门：

- `draft_href` 只能打开产品 WorkItem route，不能跳 API action。
- Proposal target 必须带可审计的 source id，避免“看起来修改 Drive，实际没有落点”。
- Drive operation log 要能解释 comment -> draft -> proposal 的链路。
- 固定 UI 文案继续走 zh-CN/en-US；用户评论、文件名、证据摘录不翻译。

## 4. QA Gate

- DB/service：Drive source context 查询、draft-to-proposal operation、missing/deleted target fail-closed。
- API：WorkItem Page VM source context、proposal action、route envelope 200/403/404/409。
- UI：WorkItem source card、proposal action、Drive proposal link 与中英双语 labels。
- Web runtime：新增 action href parser 或复用现有 agent/proposal action，确保单 dispatcher。
- Browser smoke：从 Drive 生成草稿，打开 draft，再生成 proposal，返回 Drive 可见 proposal link/operation log。
- Final：`pnpm typecheck`、`pnpm test`、browser smoke、`git diff --check`、secret scan、no `reference/`。

## 5. R5.5 Handoff

R5.4 完成后，优先推进 Meeting insight to draft：会议洞察与 Drive evidence 共同生成 WorkItem/Proposal，补齐 R4 中期审查提到的 meeting 业务断档，同时复用 R5.3/R5.4 的 source context 与 proposal writeback 模式。
