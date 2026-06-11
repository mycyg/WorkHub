---
module: R5-drive-upload-recycle-operation-log
layer: M-DRIVE / P-AUDIT / P-COLLAB / C-WEB
status: planned
owner: workflow
date: 2026-06-11
visuals:
  - ../05-clients/assets/web/web-project-drive-meetings-knowledge.png
  - ../05-clients/assets/web/web-drive-preview-change-draft.png
depends_on:
  - r5-01-drive-business-slice-decision-2026-06-11.md
  - ../04-modules/projects-and-drive.md
  - ../03-collaboration/branch-proposal-merge.md
  - ../01-architecture/data-model.md
---

# R5.2 Drive Upload / Recycle / Operation Log Plan

## 1. 开工前必读

- [`r5-01-drive-business-slice-decision-2026-06-11.md`](./r5-01-drive-business-slice-decision-2026-06-11.md)：R5.1 已落边界、未完成项和验收证据。
- [`../04-modules/projects-and-drive.md`](../04-modules/projects-and-drive.md)：文件树、版本、回收站、操作日志、评论触发 LLM 的完整模块目标。
- [`../03-collaboration/branch-proposal-merge.md`](../03-collaboration/branch-proposal-merge.md)：Drive 写入必须可审计、可回滚，文档正式版本由 proposal/accepted deliverable 语义承载。
- [`../01-architecture/data-model.md`](../01-architecture/data-model.md)：`ProjectDriveOperation`、软删除字段、audit logs 与 restore 语义。

## 2. R5.2 目标

R5.2 把 R5.1 的只读 Drive 页面升级为可管理的项目资料面，但仍不让 Web 主窗绕过协作/审计主线。

必须完成：

1. 上传入口：最小单文件上传 API/UI，写入 `ProjectDriveItem` + `ProjectDriveVersion`，并记录 `ProjectDriveOperation`。
2. 回收站：软删除/恢复文件或文件夹，Drive Page VM 暴露 deleted counts 与 recycle panel；删除必须 fail-closed。
3. 操作日志：Drive Page VM 增加 operation timeline，展示 upload/delete/restore/rename 的 actor、time、target。
4. 共享 mapper：抽出 accepted deliverable -> VM mapper，消除 WorkItem service 与 Drive service 的 href 复制。
5. 权限门：Drive project 读取/写入至少校验 owner/admin 或 workspace policy；未授权返回 403 route state。
6. Browser gate：live route smoke 覆盖 upload fake/fail、recycle restore、operation log count、无 Cuu/无 secret/无 overflow。

不做：

- 大文件分片、断点续传、云对象存储 adapter。
- 离线双向同步。
- 评论自动生成 proposal 的完整流程；它留给 R5.3。

## 3. 数据流

```
Upload / delete / restore action
  -> Drive API command
  -> ProjectDriveItem / ProjectDriveVersion / soft delete
  -> ProjectDriveOperation + audit log
  -> Drive Page VM refetch
  -> Web route component
```

写操作硬门：

- 所有 mutation 都要记录 operation 和 audit。
- 删除/恢复必须校验 current state，状态漂移返回 409。
- 上传生成的普通版本不能伪装成 accepted deliverable；只有 proposal merge 后才能带 accepted deliverable source。
- 固定 UI 文案继续走 zh-CN/en-US，不翻译用户文件名、评论、证据摘录。

## 4. QA Gate

- Unit: DB repository command tests for upload/delete/restore/log rows.
- API: route tests for 403/409/200 and operation log Page VM shape.
- UI: Drive component tests for recycle/log panels, upload/recover actions, bilingual copy.
- Web: route loader tests for forbidden/empty/ready and action notices.
- Browser: update live route smoke with Drive upload/recycle/log proof and screenshot.
- Final: `pnpm typecheck`, `pnpm test`, browser smoke, `git diff --check`, secret scan, no `reference/`.

## 5. R5.3 Handoff

R5.2 完成后，R5.3 接 comment-to-intake / comment-to-proposal：Drive comment 不直接改正式资料，而是生成可审批的草稿或 proposal。
