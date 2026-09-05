# 会议分析链路：转写 → AI 纪要 + 洞察 → 人确认

- Status: implemented
- Date: 2026-09-05
- Owner: claude (R23 SA-02)

## Problem

会议模块是死胡同。唯一入口「导入会议转写」只往 `meeting_records` 插一行 `status="transcribed"`；
全仓没有任何地方写 `meeting_insights`，也没有任何地方生成 `minutes_md`。于是下游全部空转：

- 页面标题叫「会议洞察」，洞察卡挂着「生成草稿 / 忽略」——但永远没有洞察可点；
- 通知类型 `meeting.insight.pending`、读路径的 `ensureMeetingInsightNotifications` 从来没有数据源；
- 全局搜索索引了 `minutes_md`（迁移 0057），这一列从未被填过；
- 用户导入之后看到的是「转写已导入」+「这次会议还没有纪要内容」，**没有任何线索说明还会不会有**。

规格（`docs/workhub/04-modules/meetings-and-insights.md`）承诺的是「转写 → AI 纪要 → AI 洞察 →
需求草稿（人确认）」。中间两段从没实现。

## Decision

新增 `apps/api/src/services/meeting-analysis.ts`（分析服务）+ `apps/api/src/workers/meeting-analysis.ts`
（巡检调度器），纪律照 `conversation-observer`：isConfigured 门控 / disableThinking / 预算软闸 / 幂等。

**1. 队列就是状态列，不加迁移。** `meeting_records.status` 已经是 varchar 且四个取值都有既定语义：
`transcribed`（待分析）→ `processing`（已认领、在跑）→ `ready` / `failed`。认领 = 带状态守卫的条件
UPDATE + RETURNING，天然是并发闸：两个巡检轮次、巡检与手动重跑同时进来，只有一个拿得到行。
`meeting_insights` 表与 `minutes_md` 列早就存在（`schema/core.ts`、迁移 0057），全程零迁移。

**2. `transcribed` 提升为可见状态。** 服务端 `meetingStatus()` 原本把它折叠进 `processing`，
导致「AI 正在分析」和「AI 从没被叫起来」在页面上完全一样。契约枚举加上 `transcribed`
（i18n 里「转写已导入」这条文案早就写好了，只是从来到不了前端）。

**3. AI 未配置时诚实，不做伪造降级。** 被迁移的 Python 版在无 key 时走 `_fallback`：关键词粗判
kind、把转写片段当纪要。这里**明确不抄**——伪纪要照样会进搜索、进证据链，读的人无从分辨它是不是
AI 真读懂了这场会。改成：provider 未配置时分析服务在认领之前就返回，**一个字段都不写**；页面 VM
带 `ai_analysis_configured=false`，顶部提示条直说「这个部署还没有配置 AI」，纪要区写「AI 还没有配置，
这场会议只保存了转写」，并撤下「重新生成纪要」按钮（配了才给点）。

**4. 输出契约（一次调用，严格 JSON）：**

```json
{"minutes_md":"...","insights":[{"kind":"new_requirement|requirement_change|normal_note",
  "title":"...","description":"...","confidence_reason":"..."}]}
```

- `kind` 三值直接沿用 db schema 与 `meetingInsightVmSchema` 里已有的枚举，不新造；
- `confidence_reason` 在 zod 层是**必填**。理由：仓库层 `insightToDraft` 明确「缺少判断理由不能生成
  草稿」（`meeting_insight_rationale_missing`），放行无理由洞察等于攒一堆点了必然 409 的死卡片；
- `insights` 上限 8，允许为空（一场没产出行动项的会也该有纪要）；
- 提示词三条硬约束：只用转写里的事实不许编、每条洞察必须给理由、永不直接改项目状态（只出建议给人确认）；
- 转写截断到 24k 字符并在提示词里**如实标注已截断**，不让模型假装读完了全文；
- 只容忍 ```` ```json ```` 围栏这一种偏差，别的畸形一律按解析失败处理——不做「尽力猜一下」的补救。

**5. 触发时机是两条路径、一把闸。** 导入落库后立刻排一次（不 await，导入请求不该被几十秒的 LLM
调用拖住）；后台巡检每轮兜底扫 `transcribed` 以及认领后卡死超时的 `processing`（进程崩在分析中途
留下的孤儿）。两条路径共用同一个条件 UPDATE，重复触发是安全的 no-op。

**6. 失败是终态，不自动重试。** 解析失败 / 调用异常 / 转写为空 → 落结构化日志 + 置 `failed`，
**不写纪要、不插洞察、不置 ready**（不留半截数据）。不自动重试是刻意的：一个稳定畸形的模型输出配上
自动重试会把 token 烧穿。出路是人点「重新生成纪要」——`POST /api/meetings/:meetingId/analyze`
（强制认领，`ready`/`failed` 都能重跑，同步等结果回一份新页面）。

**7. 通知复用既有 dedupeKey。** 分析完成时给上传者推 `meeting.insight.pending`，
dedupeKey 用 `meeting_insight:<insightId>`——与读路径 `ensureMeetingInsightNotifications` 完全同一把
key，两条路径不会互相刷掉对方，也不会重复出卡。

## Alternatives considered

- **新建 `meeting_analysis_jobs` 表做队列。** 否。状态列已经能表达全部四态，多一张表就多一份迁移、
  多一处状态会漂移的地方，也多一套要写的回收逻辑。范围纪律是「能不加迁移就不加」。
- **接原子预算预留（budget_reservations）而不是软闸。** 否，和观察者同一个理由：
  `budget_reservations.run_id` 是 NOT NULL 外键指向 `agent_runs`，而 `agent_runs.work_item_id` 也是
  NOT NULL。会议分析发生在任何工作项存在之前，接原子预留需要为每次分析伪造一个 work_item + agent_run，
  那是假接线。改用软闸（读团队用量快照判门槛），真实成本仍由 ProviderRegistry 的 usageSink 计入台账。
- **无 key 时走关键词伪纪要（照抄 Python 版 `_fallback`）。** 否，见 Decision 第 3 条。
- **解析失败后自动重试（像 project-planner 那样 attempt 0/1）。** 否。project-planner 是**人在等**的
  同步请求，重试一次就到头；会议分析在后台巡检里跑，自动重试会变成后台无声烧钱的循环。改成终态 +
  人工重跑按钮。
- **「重新生成纪要」异步返回、页面轮询。** 否。分析完成没有 SSE 事件（这批不接），异步返回会让用户
  盯着一个不会自己更新的页面。改成同步等完（单次调用，90s 超时上限），点了就看得见结果。
- **把提示词与解析放进 `packages/agent`（像 observer 那样）。** 否。observer 那套要被 worker 与
  多个消费点共用才拆包；会议分析只有一个消费点，照 `project-planner.ts` 的先例把提示词与 zod 契约
  留在 service 文件里，少一层包依赖。

## Consequences

- **`MeetingPageVM` 三处扩容**（都带 zod default，旧生产者不炸）：会议 `status` 枚举多了 `transcribed`、
  会议记录多了 `actions.reanalyze`、页面多了 `ai_analysis_configured`。但 `z.infer` 的**输出**类型是
  必填的，所以所有把字面量标注成 `MeetingPageVM` 的夹具都要补字段（本批已补 5 处：ui / web routes /
  contracts / web qa / api）。以后再加字段仍会撞这条。
- **`MeetingPageServiceError` 的 status 联合多了 503**（AI 未配置，与 project-planner 同档语义）。
- **服务层不去够全局单例**：`analysis` 是可选注入。不注入时页面按「AI 已配置」渲染、导入不排队分析、
  重新生成直接 409 `meeting_analysis_unsupported`。生产由 `getDefaultMeetingPageService()` 注入；
  这么设计是为了让单测不必连库。代价是「忘了注入」在类型上看不出来，只能靠 default 工厂这一处保证。
- **巡检受 `isConfigured` 门控**（server.ts，与观察者/回话判定器同档）：没配 key 的自托管实例不会启动
  它，会议就诚实停在「转写已导入」。
- **重跑会删掉上一轮还没被人处理的 pending 洞察**（`createdWorkItemId` 为空的那些）。confirmed /
  dismissed 是人做过的决定，绝不覆盖。这意味着「重新生成纪要」对已经确认过的洞察是增量的，页面上会
  同时留着旧的已确认卡和新一轮的待确认卡。
- **仍未做**：音频与 ASR（只有粘转写文本一条入口）、分析完成的 SSE 推送、桌面端会议视图。
