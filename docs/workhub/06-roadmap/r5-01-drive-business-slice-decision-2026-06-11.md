---
module: R5-drive-business-slice
layer: M-DRIVE / P-COLLAB / C-WEB / C-DESKTOP
status: planned
owner: workflow
date: 2026-06-11
visuals:
  - ../05-clients/assets/web/web-project-drive-meetings-knowledge.png
  - ../05-clients/assets/web/web-drive-preview-change-draft.png
depends_on:
  - ../04-modules/projects-and-drive.md
  - ../03-collaboration/branch-proposal-merge.md
  - ../01-architecture/data-model.md
  - ../05-clients/web-app.md
  - ../05-clients/page-concepts.md
  - r4-24-web-runtime-finalization-plan-2026-06-11.md
---

# R5.1 Drive Business Slice Decision

## 1. Decision

R5 第一条业务纵切选择 **M-DRIVE 项目资料 / 网盘**，而不是先做 Meeting 或 Schedule。

原因很直接：Drive 已经是 Proposal accepted deliverables、ProjectDriveItem/Version、restore、Replay evidence 与 OQ-4 文档类合并语义的现实承载层。它最能继续证明 PRD 的主线：AI 默认产出交付物，人只审批异常、冲突和回滚。

## 2. 开工前必读

- [`../04-modules/projects-and-drive.md`](../04-modules/projects-and-drive.md)：Drive 文件树、版本、回收站、操作日志、评论触发 LLM、Web/desktop 差异。
- [`../03-collaboration/branch-proposal-merge.md`](../03-collaboration/branch-proposal-merge.md)：文档型 DOC 文本/二进制、版本追加、指针选择、AI 调解与还原语义。
- [`../01-architecture/data-model.md`](../01-architecture/data-model.md)：`ProjectDriveItem`、`ProjectDriveVersion`、`accepted_deliverable_changes`、Drive restore 与 audit。
- [`../05-clients/web-app.md`](../05-clients/web-app.md)：Web 主窗产品壳、route loader、SSE/Page VM runtime 与双语边界。
- [`../05-clients/page-concepts.md`](../05-clients/page-concepts.md)：`web-project-drive-meetings-knowledge.png` 与 `web-drive-preview-change-draft.png`。
- [`r4-24-web-runtime-finalization-plan-2026-06-11.md`](./r4-24-web-runtime-finalization-plan-2026-06-11.md)：R4 runtime 收尾后的 QA 继承门。

## 3. Why Drive First

| 判断项 | Drive 结论 |
|---|---|
| PRD 主线 | AI 产出文件、版本、证据和变更申请，负责人审批后进入正式资料库。 |
| 已有地基 | R1 已把 accepted deliverables 写入 `ProjectDriveItem/Version`，WorkItem/Replay 已能展示下载、文本预览和 restore。 |
| OQ-4 价值 | Drive 是 DOC 文本三方合并和 DOC 二进制版本指针择一的首个真实产品面。 |
| 返工风险 | 比 Meeting/Schedule 更少依赖尚未落地的录音、ASR、日历 provider 与提醒编排。 |
| 概念图一致性 | 现有 Drive 概念图要求“文件评论、版本变化、文件夹重命名可生成变更草稿”，正好接 Proposal/Intake。 |

## 4. R5.1 首轮范围

R5.1 先做“可用的 Drive 产品面”，不是一次性复刻旧项目 800 行网盘：

1. Drive route/Page VM：项目资料列表、当前版本、文件夹层级、accepted deliverables 来源标记、空/错/无权限态。
2. Accepted deliverables to Drive：从 WorkItem/Replay 的 accepted deliverables deep-link 到 Drive item/version 页面。
3. Preview/download/restore：沿用已落的下载、文本预览和最小 restore 语义，Drive 页面给出同一操作入口与审计提示。
4. Version history：先展示版本列表、当前指针、来源 proposal/agent run；二进制文件只做版本选择，不做内容合并。
5. Comment to draft spike：文件评论只生成 intake/proposal 草稿入口，不让 AI 直接改正式资料。
6. Web/desktop-webview 同 runtime：继续走 R4.21 `@workhub/web-runtime` 的 notice/action/dirty/live 合同。

Out of scope for R5.1：

- 完整分片上传、复制剪切粘贴撤回、回收站批量管理。
- 会议 ASR、日历排期、通知规则大改。
- 完整云对象存储 adapter 与离线双向同步。
- 把 Drive 页面做成默认重型 Kanban 或 marketing hero。

## 5. Dataflow Contract

```
Proposal merged
  -> accepted_deliverable_changes
  -> ProjectDriveItem.current_version_id
  -> ProjectDriveVersion
  -> Drive Page VM
  -> Web/desktop route component
  -> optional restore/comment-to-draft action
```

硬门：

- Drive 页面不得读 P0.5 `/api/pages/gold-path` fixture chrome。
- SSE 只触发当前 route Page VM refetch，不直接用事件 payload 改 DOM。
- restore 必须校验 current version 仍等于要还原的 accepted row，否则 409。
- 用户评论、文件名、证据摘录保留原文；固定 UI 文案必须走 zh-CN/en-US locale contract。
- Web 主窗无 Cuu、本地 secret、默认 Kanban、hash route、weekly demo copy 与文本溢出。

## 6. QA Gate

R5.1 最小验收：

- `@workhub/api` / `@workhub/db` tests 覆盖 Drive Page VM、version history、restore conflict、comment draft action。
- `@workhub/web` tests 覆盖 route registry、loader、Page VM rendering、legacy hash 不作为 route truth。
- `@workhub/ui` tests 覆盖 Drive route component 的双语 fixed copy、empty/error/forbidden、no Cuu/no Kanban/no secret。
- Browser smoke 拆分后至少一条 Drive spec：Drive list -> version detail -> preview/download link -> restore fail-closed -> locale toggle。
- 视觉证据对照 `web-project-drive-meetings-knowledge.png` 和 `web-drive-preview-change-draft.png`：严肃资料工作台、证据/版本/草稿入口清晰，不把 Cuu 放进主窗。

## 7. 后续计划

R5.1 完成后再决定：

- R5.2 Drive upload/recycle/operation log。
- R5.3 comment-to-intake / comment-to-proposal deeper automation。
- R5.4 Meeting insight to draft，复用 Drive evidence 与 proposal flow。
- R5.5 Schedule/Notify，以 Drive/Meeting 已产生的真实 work items 作为提醒来源。
