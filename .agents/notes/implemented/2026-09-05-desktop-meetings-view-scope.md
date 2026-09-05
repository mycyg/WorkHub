# F-09 桌面会议视图：范围与几个非显然的实现决策

- Status: implemented
- Date: 2026-09-05
- Owner: kimi-code（接棒 F-09，scout-D-wiring.md 同节缺口）

## Problem

桌面此前完全没有会议视图，搜索命中会议只能诚实降级为「打开工作台看项目」。
补齐一个真正的会议能力视图时，有几处不显然的取舍——不写下来后面的人容易
重新踩一遍或者反向「修复」成 bug。

## Decision

1. **不做导入转写 UI。** web `/meetings` 页有「＋ 导入会议转写」表单
   （`client.importMeetingTranscript`），桌面本批没有对应入口——空态文案
   诚实指路「去网页版导入」，同 drive.ts 回收站/超量列表指去网页版的口径。
   原任务四点里没有列「导入」，SA-02（会议模块整条 AI 生成链路是死的）也
   是另一个更大的缺口，不在本批范围内顺手做掉。
2. **洞察卡不渲 evidence_refs。** 服务端目前对每条洞察恒生成**唯一一条**
   指回同一场会议自己的证据（`meeting-pages.ts buildInsightVm`：
   `evidence_refs: [{ source_id: meeting.id, href: /meetings?project_id=... }]`），
   在「已经在看这场会议」的语境下渲一条指回自己的证据是噪音而非信息。
   attention.ts 渲证据是因为那些证据可能来自当前看不到的其它来源
   （drive 文件/其它会话），语境不同，不能照抄。
3. **洞察写动作（生成草稿/忽略）完成后不直接拿它的返回值重渲，而是显式
   `load()` 重新请求同一个 `selectedMeetingId`。** 这是本批唯一容易埋雷的
   决策点：`createMeetingInsightDraft`/`dismissMeetingInsight` 两个接口
   都返回一整张 `MeetingPageVM`，看起来可以直接拿来重渲省一次请求——但
   服务端 `meeting-pages.ts pageAfterMutation` 调 `buildMeetingPage` 时
   `selectedMeetingId` 参数恒传 `undefined`（只有 GET `/api/pages/meetings`
   的 `page()` 路径会把查询串的 `m=` 传下去）。直接用写接口的返回值渲会
   在用户对着「非默认第一场」会议点生成草稿/忽略时，把视图静默弹回项目
   默认会议——一个不容易在人工验收时发现（大多数验收只测第一场会议）
   但会让真实多会议项目里的用户感到「点了个东西页面莫名跳走」的 bug。
4. **draft_href/proposal_href 复用 `attention.ts` 已导出的
   `classifyAttentionActionHref`**，没有为同样形态的 `/workitems/:id`、
   `/proposals/:id` 再写一份正则（`workitem.ts` 自己的 `agentTeamActionTarget`
   是更早的重复实现，本批不去动它——不在 F-09 范围内顺手重构别的视图）。
   洞察的写动作（create_draft/dismiss）则解析走
   `@workhub/web-runtime` 的 `meetingInsightActionFromHref`（与 web
   `browser.ts` 解析同一个 href 用同一个函数），落到桌面已有但此前零调用
   的 SDK 方法——没有引入第三套「通用 href 分发引擎」（`attention.ts` 的
   `runAction` 是审批/提议域内多种动作形态的专用分发器，语义耦合较深，
   会议只有两个动作且都已有专用 SDK 方法，抄类型安全的直调更合适）。

## Alternatives considered

- 把会议做成工作台的一个标签页而不是 Spotlight 能力视图：原任务已指定
  「与现有项目内页面一致的位置，参考 views/ 里 replay、drive 等只读视图」，
  否决。
- 洞察卡动作完成后直接用返回的 `MeetingPageVM` 重渲（省一次网络往返）：
  见 Decision #3，因「静默跳回默认会议」的行为缺陷否决。
- 顺手把 `workitem.ts` 的 `agentTeamActionTarget` 也换成
  `classifyAttentionActionHref`：会扩大本批 diff 到不相关文件，否决
  （留给专门的去重批次）。

## Consequences

- 若日后服务端把 `insightToDraft`/`dismissInsight` 改成也接受/回传
  `selectedMeetingId`，桌面这里的显式 `load()` 重拉可以简化为直接用返回值
  ——但在那之前不能这样"优化"。
- 会议数据的生成链路（转写→AI 纪要/洞察）是否真的产出过内容，不影响本
  视图正确性——字段缺省时的空态文案已经按会议 status（processing/failed/
  真的没有）分别给出诚实提示，SA-02 落地后无需改动本视图代码。
