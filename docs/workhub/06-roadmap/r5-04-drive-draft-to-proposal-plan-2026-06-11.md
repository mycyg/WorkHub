---
module: R5-drive-draft-to-proposal
layer: M-DRIVE / M-WORKITEM / P-COLLAB / P-AI / C-WEB
status: completed
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

后续计划见 [`r5-05-meeting-insight-to-draft-plan-2026-06-11.md`](./r5-05-meeting-insight-to-draft-plan-2026-06-11.md)。

## 6. 竣工记录（2026-06-11）

完成项：

1. Contracts 增补 `WorkItem.source_context`、Drive comment `proposal_id/proposal_href/proposal_status`、`create_proposal_draft` action 与 `draft_to_proposal` operation enum。
2. DB repository 能从 WorkItem 反查 Drive source comment/folder，并在 `recordDraftProposal` 事务中更新 comment status、写 proposal link、Drive operation 与 audit log。
3. API 增补 `POST /api/drive/workitems/:workItemId/proposal-draft` 与 OpenAPI path；服务层沿用 WorkItem/Project 权限门，重复触发返回既有 proposal，缺失 source/越权 fail-closed。
4. WorkItem Detail Page VM 显示 Drive comment source context、folder/file/comment body/status，并只在 Drive 草稿且尚无 proposal 时暴露“生成变更提议”入口。
5. Drive Page VM 在 comment card 上展示 `proposal_created`、proposal href/status，并把 comment-to-draft-to-proposal 链路写入 operation timeline。
6. API client、web-runtime action parser、Web/desktop surface catalog 与 browser dispatcher 接入同一个 draft-to-proposal action，不新增 fixture chrome 分叉。
7. UI 增补 source context card、proposal action、Drive proposal link 与 zh-CN/en-US labels；Drive comment row 调整为稳定堆叠布局，避免窄列文字竖排。
8. Browser smoke 从 Drive comment 生成 draft、打开 WorkItem、生成 proposal、返回 Drive 校验 proposal link/operation log，新增 R5.4 gate。

PRD/概念图复核：

- `web-drive-preview-change-draft.png` 要求 Drive 资料变更先进入草稿/提议/审批；本轮从 draft WorkItem 产出 proposal manifest，不直接改正式 Drive 文件。
- `branch-proposal-merge.md` 的“正式资料写回只走 proposal review/merge”得到保留：R5.4 只创建 proposal/change preview，merge/writeback 仍由既有审批主线承接。
- `web-project-drive-meetings-knowledge.png` 要求项目资料、会议、知识与行动入口互联；本轮 Drive comment 已能回链 WorkItem 与 proposal，让右侧工作入口可追溯。
- `requirements-workitem.md` 的来源可解释性得到补强：Drive-created WorkItem 不再把来源埋在 planning note，而是在 Page VM 上作为结构化 source context 渲染。
- 固定 UI 文案继续支持 zh-CN/en-US；项目名、folder path、文件名、评论正文与 proposal 标题等用户内容不翻译。

已知边界：

- R5.4 使用 deterministic proposal manifest seed 验证端到端合同，不调用真实 LLM 做高质量全文重写。
- Proposal merge 后写回 accepted deliverable / Drive version 的增强仍沿用既有 proposal 主线，未在 Drive 页面新增直接编辑正式文件能力。
- Source context 本轮覆盖 `drive_comment`；会议洞察、Schedule/Notify 等其他来源在后续模块按同一合同扩展。
- 细粒度项目成员 ACL 仍沿用 R5.2 owner/admin/same-workspace 管理门，后续再收窄为项目成员角色门。

验收证据：

- `pnpm --filter @workhub/db typecheck`
- `pnpm --filter @workhub/contracts test`
- `pnpm --filter @workhub/api-client test`
- `pnpm --filter @workhub/web-runtime test`
- `pnpm --filter @workhub/ui test`
- `pnpm --filter @workhub/api test`
- `pnpm --filter @workhub/web test`
- `pnpm --filter @workhub/desktop-webview test`
- `pnpm --filter @workhub/api typecheck`
- `pnpm --filter @workhub/web typecheck`
- `pnpm typecheck`
- `pnpm test`
- `pnpm --filter @workhub/web qa:r4-live-route-interaction`：50 步通过，新增 R5.4 gate `r5_4_drive_draft_to_proposal=true`，关键截图为 `15bc-drive-open-workitem-draft-en-desktop.png`、`15bd-drive-draft-to-proposal-success-en-desktop.png`、`15be-drive-proposal-link-en-desktop.png`。
- `git diff --check`
- secret scan：未发现测试 LLM key 写入仓库。
- `reference/` 未进入 git index。
