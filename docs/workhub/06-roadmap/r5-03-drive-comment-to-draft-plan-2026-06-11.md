---
module: R5-drive-comment-to-draft
layer: M-DRIVE / M-WORKITEM / P-COLLAB / C-WEB
status: planned
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
