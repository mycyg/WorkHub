---
module: R5-meeting-insight-to-draft
layer: M-MEETING / M-WORKITEM / M-DRIVE / P-AI / P-COLLAB / C-WEB
status: completed
owner: workflow
date: 2026-06-11
visuals:
  - ../05-clients/assets/web/web-meeting-insight-to-draft.png
  - ../05-clients/assets/web/web-project-drive-meetings-knowledge.png
depends_on:
  - r5-04-drive-draft-to-proposal-plan-2026-06-11.md
  - ../04-modules/meetings-and-insights.md
  - ../04-modules/requirements-workitem.md
  - ../04-modules/projects-and-drive.md
  - ../03-collaboration/branch-proposal-merge.md
  - ../01-architecture/data-model.md
  - ../01-architecture/api-contract.md
---

# R5.5 Meeting Insight To Draft Plan

## 1. 开工前必读

- [`r5-04-drive-draft-to-proposal-plan-2026-06-11.md`](./r5-04-drive-draft-to-proposal-plan-2026-06-11.md)：Drive source context、draft-to-proposal action 与 proposal writeback 模式已落，是会议来源复用的合同。
- [`../04-modules/meetings-and-insights.md`](../04-modules/meetings-and-insights.md)：会议上传、纪要、洞察、确认、忽略、SSE 与双端差异。
- [`../04-modules/requirements-workitem.md`](../04-modules/requirements-workitem.md)：会议洞察确认后必须进入 WorkItem 澄清主轴，并保留 `source_meeting_id`/解释理由。
- [`../04-modules/projects-and-drive.md`](../04-modules/projects-and-drive.md)：会议洞察可引用 Drive evidence；引用必须以文件/版本/证据条目呈现，不把来源揉进自由文本。
- [`../03-collaboration/branch-proposal-merge.md`](../03-collaboration/branch-proposal-merge.md)：洞察引发的正式资料改动仍走 proposal review/merge。
- [`../01-architecture/data-model.md`](../01-architecture/data-model.md) 与 [`../01-architecture/api-contract.md`](../01-architecture/api-contract.md)：MeetingRecord、MeetingInsight、WorkItem、Proposal、SSE topic 与审计字段。

概念图：

- `web-meeting-insight-to-draft.png`：会议页左侧列表、中心纪要/转写、右侧 Cuu 检出的 change requests 与 `Create draft`，且底部明确 approval-safe。
- `web-project-drive-meetings-knowledge.png`：项目资料工作台把 Drive、会议、知识与草稿建议并排呈现，会议洞察应能带 evidence 回到同一项目上下文。

## 2. 目标

R5.5 补齐 M-MEETING 的第一条产品纵切：把已有 schema 中的 meeting/insight 表变成可操作 Page VM/API/UI，让会议洞察可以生成 WorkItem draft，并复用 R5.4 的 source context 与后续 proposal action。

必须完成：

1. Meeting Page VM：项目内会议列表、选中会议详情、summary/transcript/minutes、insight cards、Drive evidence refs 与四态。
2. Insight action：pending insight 暴露 `create_draft` / `dismiss`，重复点击幂等，非 pending 或 source 丢失 fail-closed。
3. Draft creation：确认洞察创建 WorkItem draft，写 `source_meeting_id/source_insight_id` 或等价结构化 source context，保留 `confidence_reason` 与 evidence refs。
4. WorkItem source context：Detail VM 扩展 `source_type="meeting_insight"`，展示会议标题、时间、洞察类型、理由、转写摘录、关联 Drive evidence。
5. Drive/proposal 复用：meeting-created draft 后续可以继续使用 R5.4 的 proposal draft action；若引用 Drive evidence，proposal manifest 必须带 source ids。
6. 权限与审计：项目查看门、上传者/项目管理员确认门、draft/insight/audit log 一致；SSE 只作提示，REST 仍为真相源。
7. QA：API/service/UI/browser smoke 覆盖创建草稿、忽略、重复点击、双语文案、无 overflow、request proof。

不做：

- 不实现真实音频上传/ASR 分片链路的完整 UI；R5.5 可用 deterministic meeting fixture/text transcript 验证 insight-to-draft。
- 不把 Cuu 放进 Web 主窗口；概念图里的 Cuu 面板在当前 Web 产品面先抽象为右侧 action/insight panel。
- 不自动把会议洞察 merge 进正式资料；正式写回仍交给 proposal review/merge。

## 3. 数据流

```
Meeting Page
  -> select ready meeting
  -> pending MeetingInsight card
  -> POST create draft / dismiss
  -> WorkItem draft with meeting source context
  -> WorkItem detail shows meeting insight source
  -> optional R5.4 create proposal draft
  -> proposal review/merge remains formal writeback path
```

硬门：

- 洞察正文、会议纪要、转写摘录属于用户内容，不翻译；固定按钮/status/empty/error 文案必须 zh-CN/en-US。
- `confidence_reason` 或 fallback rationale 不可为空，否则不能生成 draft。
- Draft href 只能打开产品 WorkItem route，不能跳 API action。
- 会议洞察确认不能直接修改 WorkItem 正式字段、Drive 文件或 accepted deliverable。
- Browser smoke 需要证明 request body/source ids/audit-visible timeline，而不只看 UI 文案。

## 4. QA Gate

- DB/service：pending insight -> draft、dismiss、重复确认、source missing、permission denied、audit log。
- API：Meeting Page VM、WorkItem source context、200/403/404/409 envelope、OpenAPI path。
- UI：Meeting route layout、insight cards、source context card、双语 labels、desktop/mobile no overflow。
- Web runtime：insight action href parser/dispatcher 复用 shared runtime，不新增 Web/desktop 分叉。
- Browser smoke：进入 meeting route，创建 draft，打开 WorkItem source context，再触发 R5.4 proposal draft 复用链路。
- Final：`pnpm typecheck`、`pnpm test`、browser smoke、`git diff --check`、secret scan、no `reference/`。

## 5. 竣工记录

状态：✅ completed（2026-06-11）

落地范围：

- Contracts：新增 `MeetingPageVM`、`MeetingRecordVM`、`MeetingInsightVM`，并把 `WorkItem.source_context` 扩展为 `drive_comment | meeting_insight` 判别联合。
- DB/API：新增 meetings repository、Meeting Page service 与 `/api/pages/meetings`、`/api/meetings/projects/:projectId/insights/:insightId/{draft,dismiss}`、`/api/meetings/workitems/:workItemId/proposal-draft`，权限沿用 project view / uploader-admin manage 门，REST 仍是真相源。
- Web/UI：新增 `/meetings` route、bilingual product chrome、meeting route component、meeting source context card、shared runtime action parser/dispatcher，并修复 confirmed/dismissed insight 缺省 `actions` 时的 UI 崩溃。
- Proposal 复用：meeting-created WorkItem draft 暴露 `meeting_draft_to_proposal`，proposal 创建后 source context 与 meeting page 都回写 proposal link/status。
- QA：live browser smoke 从 50 步扩到 55 步，新增 `r5_5_meeting_insight_to_draft` gate；request proof 固定为 meetings GET 3、meeting WorkItem GET 2、draft mutation 1、proposal mutation 1、dismiss 0。

验收证据：

- `pnpm --filter @workhub/contracts test`
- `pnpm --filter @workhub/api-client test`
- `pnpm --filter @workhub/web-runtime test`
- `pnpm --filter @workhub/ui test -- route-components`（56/56）
- `pnpm --filter @workhub/api test -- meeting-pages app`
- `pnpm --filter @workhub/web qa:r4-live-route-interaction`：55 步，`r5_5_meeting_insight_to_draft=true`、`no_duplicate_route_loader_calls=true`、`no_horizontal_overflow=true`
- 截图：`../05-clients/assets/audit/2026-06-11-r4-web-live-route-interaction/15f-meetings-insight-en-desktop.png`、`15g-meeting-insight-draft-en-desktop.png`、`15h-meeting-workitem-source-en-desktop.png`、`15i-meeting-draft-proposal-en-desktop.png`、`15j-meetings-en-mobile-no-overflow.png`

PRD / 概念图审视：

- 符合 `web-meeting-insight-to-draft.png`：会议页保留会议列表、洞察卡、转写、纪要和 approval-safe 文案；pending insight 只有人工确认后才创建 draft。
- 符合 `web-project-drive-meetings-knowledge.png`：meeting source context 与 Drive evidence / WorkItem / proposal 主线共享项目上下文，没有把会议内容揉成不可追溯自由文本。
- 符合多语言硬门：固定 UI 和 status labels 中英双语；会议转写、纪要、洞察正文、AI rationale 等用户/AI 内容不翻译。
- 符合数据流硬门：confirmed insight 不直接改正式 Drive/accepted deliverable；正式资料写回仍走 proposal review/merge。

后续遗留：

- 真实音频上传/ASR 分片链路仍按计划留到后续会议 ingestion 模块。
- 桌宠主动提醒不进入 Web 主窗口；R5.6 只接通知/日程 Page VM 与 Web 运营页，Cuu 气泡动作另走独立 pet surface。

## 6. R5.6 Handoff

R5.5 完成后，优先推进 Schedule/Notify：把 Drive 与 Meeting 产生的真实 WorkItem、proposal 与待确认洞察接入提醒/通知中心，补齐 R4 中期审查提到的 schedule/notify 业务断档，并把桌宠主动提醒留给独立 Cuu/pet surface。
