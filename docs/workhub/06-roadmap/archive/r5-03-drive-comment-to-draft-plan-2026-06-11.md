---
module: R5-drive-comment-to-draft
layer: M-DRIVE / M-WORKITEM / P-COLLAB / C-WEB
status: completed
owner: workflow
date: 2026-06-11
visuals:
  - ../05-clients/assets/web/web-drive-preview-change-draft.png
  - ../05-clients/assets/web/web-project-drive-meetings-knowledge.png
depends_on:
  - r5-02-drive-upload-recycle-operation-log-plan-2026-06-11.md
  - ../04-modules/projects-and-drive.md
  - ../03-collaboration/branch-proposal-merge.md
  - ../04-modules/requirements-workitem.md
---

# R5.3 Drive Comment To Draft Plan

## 1. 开工前必读

- [`r5-02-drive-upload-recycle-operation-log-plan-2026-06-11.md`](./r5-02-drive-upload-recycle-operation-log-plan-2026-06-11.md)：R5.2 已落 upload/recycle/operation log 与 project gate。
- [`../04-modules/projects-and-drive.md`](../04-modules/projects-and-drive.md)：Drive comment 是资料上下文里的“下一步行动”入口。
- [`../04-modules/requirements-workitem.md`](../04-modules/requirements-workitem.md)：comment 生成的草稿必须进入 option-first work item/intake 流，而不是直接变正式需求。
- [`../03-collaboration/branch-proposal-merge.md`](../03-collaboration/branch-proposal-merge.md)：任何正式资料改动仍通过 proposal/accepted deliverable 承接。

## 2. 目标

R5.3 把 R5.1/R5.2 已展示的 Drive comment 从静态 draft link 升级为可执行链路：用户在 Drive 评论里点“生成草稿”，系统创建可审计的 work item draft 或 intake session，并把 comment 状态更新为 `draft_created`。

必须完成：

1. API command：从 `ProjectDriveComment` 创建 work item draft/intake session，重复点击 fail-closed 或返回既有 draft。
2. 数据流：写入 work item / session、更新 comment status、写 audit log，并在 Drive Page VM refetch 后展示 draft link。
3. UI：Drive comment card 暴露 `comment_to_draft` action，成功后保持 Drive 页面并显示 notice。
4. 权限：沿用 `canManageProjectDrive`，comment 所属 project 必须可管理。
5. QA：unit/API/UI/web/browser smoke 覆盖 comment-to-draft、重复点击、无 overflow、双语文案。

不做：

- 不自动修改正式 Drive 文件。
- 不自动 merge proposal。
- 不接入真实 LLM 生成完整正文；先用结构化 draft payload，把 LLM 扩写留给后续 Agent run。

## 3. 数据流

```
Drive comment action
  -> POST /api/drive/projects/:projectId/comments/:commentId/draft
  -> permission gate
  -> create WorkItem or intake Session draft
  -> update ProjectDriveComment.draft_work_item_id/status
  -> audit log
  -> Drive Page VM refetch
  -> Web route notice + draft link
```

## 4. QA Gate

- DB/service tests：创建 draft、重复点击、missing/deleted project、permission denied。
- API tests：200/403/404/409 envelope 与 exact error code。
- UI tests：comment action、draft link、中文/英文按钮。
- Browser smoke：在 `/drive` 点击 comment-to-draft，确认 request、notice、comment status 与 draft href。
- Final：`pnpm typecheck`、`pnpm test`、browser smoke、`git diff --check`、secret scan、no `reference/`。

## 5. R5.4 Handoff

R5.3 后继续推进 Drive preview/change draft 的 proposal 化：从 draft work item 触发 proposal manifest，最终由审批/merge 写回 accepted deliverable，而不是让 Drive 页面直接改正式文件。

后续计划见 [`r5-04-drive-draft-to-proposal-plan-2026-06-11.md`](./r5-04-drive-draft-to-proposal-plan-2026-06-11.md)。

## 6. 竣工记录（2026-06-11）

完成项：

1. Contracts 增补 per-comment `draft_action`，Drive operation enum 增补 `comment_to_draft`，并把 `draft_href` 收敛为产品路由 `/workitems/:id`。
2. DB repository 增补 `commentToDraft` 事务：校验 active project/comment/pending status，创建 `ai_clarifying` WorkItem 与首条 user intent chat message，更新 `ProjectDriveComment.status/draftWorkItemId`，写 `ProjectDriveOperation` 与两条 audit log。
3. API 增补 `POST /api/drive/projects/:projectId/comments/:commentId/draft`，沿用 human actor、`canManageProjectDrive`、404/409 fail-closed envelope。
4. Drive Page VM 在 top-level actions 与每条 pending comment 上同时暴露 `comment_to_draft`，重复已生成 comment 展示 `draft_href`。
5. API client、Web runtime href parser、Web/desktop surface catalog 与 browser dispatcher 均接入 comment draft action；Web 主窗保持无 Cuu 入口。
6. UI 增补中英双语 `Create draft` / `Open draft`、comment status 人话标签，并在 comment card 内保持紧凑布局。
7. Browser smoke 增补 `15bb-drive-comment-to-draft-success-en-desktop`，R5.3 gate 校验 request proof、notice、operation count、无横向与文本盒溢出。

PRD/概念图复核：

- `web-drive-preview-change-draft.png` 要求资料变更从“草稿/提议/审批”进入正式版本；本轮只把 Drive comment 变成 WorkItem 草稿，不直接修改 Drive 文件。
- `web-project-drive-meetings-knowledge.png` 要求 Drive 是项目知识与后续行动入口；本轮 comment card 已从静态文本变成可审计 action，并回写 Drive operation log。
- `requirements-workitem.md` 的 option-first / AI 澄清主线得到保留：新 WorkItem 初始为 `ai_clarifying`，后续仍由 intake/agent/proposal 流承接。
- 固定 UI 文案继续支持 zh-CN/en-US；项目名、文件名、评论正文等用户内容不翻译。

已知边界：

- R5.3 创建 WorkItem 草稿和 intent message，不调用真实 LLM 扩写，也不自动启动 Agent run。
- 重复点击返回既有 draft；非 `pending_llm` 评论不允许生成草稿；若 comment 标记为 `draft_created` 但 draft WorkItem 丢失或软删除，返回 409。
- 细粒度项目成员 ACL 仍是后续权限收敛项；本轮沿用 R5.2 owner/admin/same-workspace 管理门。
- draft work item 到 proposal manifest、Drive preview/change draft、accepted deliverable 写回留给 R5.4。

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
- `pnpm --filter @workhub/desktop-webview typecheck`
- `pnpm --filter @workhub/db check`
- `pnpm typecheck`
- `pnpm test`
- `pnpm --filter @workhub/web qa:r4-live-route-interaction`：47 步通过，新增 R5.3 gate `r5_3_drive_comment_to_draft=true`，关键截图为 `15bb-drive-comment-to-draft-success-en-desktop.png`。
