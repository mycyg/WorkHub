---
module: R5-drive-upload-recycle-operation-log
layer: M-DRIVE / P-AUDIT / P-COLLAB / C-WEB
status: completed
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

- DB/schema: migration gate for the active-path unique index and Drive soft-delete/version/operation fields.
- API/service: route tests for 403/409/200, exact conflict codes, mutation payloads, and operation log Page VM shape.
- UI: Drive component tests for recycle/log panels, upload/recover actions, delete CAS payload, bilingual copy.
- Web: route loader tests for `project_id`, forbidden/empty/ready, and action notices.
- Browser: update live route smoke with Drive upload/recycle/log proof, delete CAS request proof, and screenshot.
- Final: `pnpm typecheck`, `pnpm test`, browser smoke, `git diff --check`, secret scan, no `reference/`.

## 5. R5.3 Handoff

R5.2 完成后，R5.3 接 comment-to-intake / comment-to-proposal：Drive comment 不直接改正式资料，而是生成可审批的草稿或 proposal。后续计划见 [`r5-03-drive-comment-to-draft-plan-2026-06-11.md`](./r5-03-drive-comment-to-draft-plan-2026-06-11.md)。

## 6. 竣工记录（2026-06-11）

完成项：

1. Contracts 增补 `deleted_items`、`operations`、`can_manage`、Drive mutation actions 与 summary counts。
2. DB repository 增补 `uploadFile`、`softDeleteItem`、`restoreDeletedItem`，写入 `ProjectDriveItem`、`ProjectDriveVersion`、`ProjectDriveOperation` 与 `AuditLog`。
3. API 增补 `/api/drive/projects/:projectId/files`、`/items/:itemId/delete`、`/items/:itemId/restore`，冲突语义保留 409 code。
4. 权限包增补 `canViewProjectDrive` / `canManageProjectDrive`，项目 owner/admin/same-workspace 作为当前最小 workspace policy。
5. Web client 与 shared runtime 增补 Drive action href parser，主窗口点击 upload/delete/restore 后 refetch Drive Page VM。
6. UI 增补上传、移入回收站、恢复、Recycle、Operation log 双语入口和 R5 审计标记。
7. accepted deliverable -> VM mapper 已抽到共享 service，WorkItem 与 Drive 不再重复拼 href。
8. 审查返工项已收束：Web route 传递 `project_id`、delete action 绑定最新可删手工文件并带 `expected_current_version_id`、browser smoke 校验 delete CAS body、DB migration 增补 active-path partial unique index。

PRD/概念图复核：

- `web-project-drive-meetings-knowledge.png` 要求 Drive 与知识/会议同处项目资料工作台；本轮保持 Drive 主页面、文件树、版本史、评论草稿与右侧工作入口。
- `web-drive-preview-change-draft.png` 要求正式资料变更可追踪且由协作流承接；本轮上传/删除/恢复全部进入 operation timeline 和 audit，accepted deliverable 删除仍 fail-closed。
- 固定文案继续双语；用户文件名、评论正文和证据摘录不做机器翻译。

已知边界：

- 上传是最小 JSON/text-backed 单文件入口，不含 multipart、chunk upload、云对象存储和断点续传。
- same-workspace policy 仍是 MVP 级 project gate，细粒度成员/角色 ACL 留给后续权限收敛。
- active-path 唯一性已新增数据库级 partial unique index；当前 DB 包仍缺少真实临时 Postgres integration harness，仓储行级行为由 API/service fake repo tests、schema/migration gate 与 browser smoke 共同覆盖。
- comment-to-draft/comment-to-proposal 不在 R5.2 内实现，已转入 R5.3。

验收证据：

- `pnpm --filter @workhub/permissions test`
- `pnpm --filter @workhub/contracts test`
- `pnpm --filter @workhub/api-client test`
- `pnpm --filter @workhub/web-runtime test`
- `pnpm --filter @workhub/ui test`
- `pnpm --filter @workhub/db test`
- `pnpm --filter @workhub/api test`
- `pnpm --filter @workhub/web test`
- `pnpm --filter @workhub/web typecheck`
- `pnpm --filter @workhub/desktop-webview test`
- `pnpm --filter @workhub/desktop-webview typecheck`
- `pnpm --filter @workhub/web qa:r4-live-route-interaction`：46 步通过，新增 R5.2 gate `r5_2_drive_upload_recycle_operation_log=true`，关键截图为 `15c-drive-upload-success-en-desktop.png`、`15d-drive-delete-success-en-desktop.png`、`15e-drive-restore-success-en-desktop.png`。
