---
module: R5-schedule-notify
layer: M-NOTIFY / M-WORKITEM / M-DRIVE / M-MEETING / P-PERM / C-WEB
status: planned
owner: workflow
date: 2026-06-11
visuals:
  - ../05-clients/assets/web/web-operations-pages-atlas.png
  - ../05-clients/assets/web/web-project-attention-workspace.png
depends_on:
  - r5-05-meeting-insight-to-draft-plan-2026-06-11.md
  - ../04-modules/tasks-reminders-notifications.md
  - ../04-modules/requirements-workitem.md
  - ../04-modules/projects-and-drive.md
  - ../04-modules/meetings-and-insights.md
  - ../01-architecture/data-model.md
  - ../01-architecture/api-contract.md
  - ../01-architecture/security-and-permissions.md
---

# R5.6 Schedule / Notify Plan

## 1. 开工前必读

- [`r5-05-meeting-insight-to-draft-plan-2026-06-11.md`](./r5-05-meeting-insight-to-draft-plan-2026-06-11.md)：Meeting insight 已能创建 WorkItem draft，并回链 proposal；R5.6 需要把这些“待确认/已创建/待审阅”事实投递到通知和日程视图。
- [`../04-modules/tasks-reminders-notifications.md`](../04-modules/tasks-reminders-notifications.md)：通知收件箱、提醒、日历、资源排期、去重、私有 `user:{id}` topic 与桌宠呈现边界。
- [`../04-modules/requirements-workitem.md`](../04-modules/requirements-workitem.md)：WorkItem 状态、截止时间、负责人、审批与待办来源。
- [`../04-modules/projects-and-drive.md`](../04-modules/projects-and-drive.md)：Drive comment/draft/proposal 操作日志可成为通知来源，但不能把 Drive 事件当成正式写回。
- [`../04-modules/meetings-and-insights.md`](../04-modules/meetings-and-insights.md)：pending/confirmed/dismissed insight 是通知中心需要聚合的高价值待办。
- [`../01-architecture/data-model.md`](../01-architecture/data-model.md)、[`../01-architecture/api-contract.md`](../01-architecture/api-contract.md)、[`../01-architecture/security-and-permissions.md`](../01-architecture/security-and-permissions.md)：Notification、ScheduleEvent、SSE topic、权限和统一错误。

概念图：

- `web-operations-pages-atlas.png`：R5.6 以 P10 Calendar 和 P11 Notifications Inbox 为主视觉锚点；密集、可扫描、列表/日历优先。
- `web-project-attention-workspace.png`：通知/提醒要回到项目 attention 与 next best action，而不是另起营销式页面或把 Cuu 放进 Web 主窗。

## 2. 目标

R5.6 补齐 R4 中期审查指出的 schedule/notify 业务断档：把 WorkItem、Drive、Meeting、Proposal 已产生的事实，汇入一个 typed Notification/Calendar Page VM，让用户能在 Web 中看到“现在需要我处理什么”和“接下来什么时候发生”，并为后续桌宠独立提醒 surface 留出同一 API 合同。

必须完成：

1. Notification Page VM：按 `needs_decision / fyi / done` 或等价 inbox 分组，聚合 approval、Drive draft/proposal、Meeting pending/confirmed insight、agent/proposal done。
2. Calendar / Schedule Page VM：展示 deterministic 日程块、截止时间、会议后续动作、WorkItem review 窗口；支持 selected date / week scope。
3. 通知生成与去重：从现有 WorkItem / Drive / Meeting service 事件生成通知，带 `dedupe_key`、`source_type`、`source_id`、`target_href`、`severity`、`status`。
4. 读/完成动作：`mark_read`、`mark_all_read`、`dismiss` 或 `complete` 至少覆盖 Notification Page；所有动作 fail-closed 并写 audit。
5. Web routes：新增 `/notifications` 和 `/calendar` 或同等 route keys，走 Page VM source truth、双语固定 UI、移动端无 overflow。
6. SSE 边界：REST 为真相源；SSE 只提示刷新；私有通知不发 `all`，只走 `me`/用户可见 topic。
7. Browser smoke：从 R5.5 后续链路触发通知，进入 inbox/calendar，读/完成通知，验证 request proof、route markers、计数和无溢出。

不做：

- 不在 R5.6 做完整资源排期算法、团队容量预测或自动排班，只落可审阅 Page VM 与基础动作。
- 不做 OS 通知、托盘徽章和 Cuu 气泡动效；这些归独立 desktop/pet surface，R5.6 只保证 API 与 Page VM 可复用。
- 不把通知当成事实源；通知是事实的投递和索引，WorkItem/Drive/Meeting/Proposal 仍是事实来源。

## 3. 数据流

```
Domain event / REST mutation
  -> notification factory with dedupe_key
  -> Notification Page VM
  -> user reads / dismisses / opens target
  -> optional Calendar Page VM block
  -> target WorkItem / Meeting / Drive / Proposal route remains source of truth
```

硬门：

- 通知正文和按钮固定文案必须 zh-CN/en-US；引用的会议转写、Drive 评论、proposal 摘要等内容不翻译。
- `target_href` 必须是产品 route，不能把用户送到 raw API action。
- `severity=high/urgent` 不等于自动修改状态；仍需要用户点击明确动作。
- `dedupe_key` 必须防止重复通知刷屏，同时内容变化时要允许重新变未读。
- 权限必须按 target resource fail-closed：看不到 WorkItem/Project/Meeting，就看不到对应通知详情。
- Browser smoke 要证明 `/api/pages/notifications`、`/api/pages/calendar` 和通知动作 request，而不只靠 DOM 文案。

## 4. 施工顺序

1. Contracts：定义 `NotificationPageVM`、`CalendarPageVM`、`NotificationItemVM`、`ScheduleBlockVM`、actions 与 source context。
2. DB/repository：复用或补齐 notifications/schedule tables；新增 deterministic seed/mappers；实现 dedupe/read/dismiss/complete。
3. Services/API：新增 Page services 和 routes，接入 auth/resource permission，OpenAPI 登记。
4. API client/runtime：typed client 方法、href parser、shared dispatcher notice。
5. UI/Web：route state、shell nav、route components、bilingual copy、desktop/mobile layout。
6. Tests：contracts/client/runtime/ui/api service tests。
7. Browser smoke：R4 live script 扩展 R5.6 gate，截图审查后更新文档。

## 5. QA Gate

- Contracts：schema 覆盖 inbox/calendar 空态、普通/紧急、read/done、source context。
- Service/API：dedupe、read all、dismiss/complete、permission denied、target missing、OpenAPI path。
- UI：Inbox 分组、Calendar 周视图、target links、双语固定文案、无 Cuu 主窗、无横向/文本盒溢出。
- Runtime：action parser/dispatcher 复用 shared runtime，不新增 Web/desktop 分叉。
- Browser smoke：进入 `/notifications` 和 `/calendar`，执行 read/dismiss，打开一个 R5.5 meeting-derived target，验证 request proof 与 no duplicate route loader calls。
- Final：`pnpm typecheck`、`pnpm test`、browser smoke、`git diff --check`、secret scan、no `reference/`。

## 6. R5.7 Handoff

R5.6 完成后，优先推进 Knowledge grounding / dashboard health 的下一条纵切：把通知与日程里的 target 反向连到 evidence search、project health 和 agent replay，形成“为什么提醒我、我该先看什么证据”的闭环。桌宠 OS 通知与 Cuu 主动提醒另开 desktop/pet 计划，不阻塞 Web R5 业务纵切。
