# 批次 A:统一调度器 + 提醒/通知管道

目标:建一次水管,审批提醒、私聊通知、后续主动性投递三家共用。全部是后端管道 + 少量工作台 UI,与批次 C(引擎)零文件重叠,可并行。

## A1 统一调度器(Pulse)

**现状**:`agent-run-recovery.ts` / `session-sweep.ts` / `agent-skill-curation.ts` 三个手搓 setInterval,形状雷同(tick/start/stop/stats)但没抽共享;`background_jobs` 表(`packages/db/src/schema/core.ts:280-301`)有 FK 引用但零实现。

**做法**:
- 新建 `apps/api/src/workers/pulse-scheduler.ts`:通用周期任务注册器。任务契约 `{ name, intervalMs, tick(ctx), maxDrainPerTick? }`,内建互斥(单实例先用进程内锁,多实例场景复用 agent-run 的 claim-lease 模式)、错误隔离(单任务抛错不拖垮兄弟任务,抄 SIR-1 心跳自停的教训)、`stats()` 暴露给健康页。
- 三个存量 worker 不强迁,新任务一律挂 pulse。`background_jobs` 表本批不复活(一次性任务队列语义,与周期 tick 不同;等批次 D 有真实一次性任务需求再定,避免为抽象而抽象)。
- 环境开关:`PULSE_SCHEDULER_ENABLED`,默认开;测试里可手动 `tick()`。

## A2 审批 SLA 接线 + 提醒阶梯

**现状**:`expireDueApprovals`(`approvals.ts:1270-1310`)已实现 escalate_pm / notify_reviewer 分流,无调用方。通知表有 `dedupe_key` 唯一约束,无重复提醒字段。

**做法**:
- pulse 注册 `approval-sla` 任务(5 分钟一 tick)调 `expireDueApprovals`。
- 通知表加列:`next_remind_at timestamptz`、`reminder_count int default 0`(迁移)。阶梯策略先硬编码:创建后未读未处理 → 24h 一提,最多 3 次,之后升级(approval 类走既有 escalate_pm 分流)。每次提醒不是新插一条,而是同 dedupe_key 行 `resurfaced` + `reminder_count++` → 复用现有 `publishNotification` 推 SSE(`notifications.ts:149-161` 的复活语义正好匹配)。
- 被提醒人动作:通知上加「知道了/暂停提醒」→ 写 `next_remind_at = null`(抑制)。这是"叮嘱得体"的机制底线,批次 D 的 DDL 阶梯同款复用。

## A3 会话 digest 卡(对话内持续提醒)

**现状**:聊天已有 `system_event` 消息类型与「落定行」回灌;行动卡有"不删卡留痕"先例。

**做法**:
- 新 system_event 子类型 `pending_digest`:每会话至多一张,内容为「待你拍板 N 件,最久 X 天」+ 跳转。pulse 的 approval-sla tick 顺带维护:有变化时**更新原消息内容并重新置底**(更新 `seq` 或删旧插新,保 id 稳定优先,方案施工时定),而不是刷屏新消息。
- 投放范围:仅项目 main 会话(团队待办属团队语境);私聊/协同不投。

## A4 未读聚合 + rail 红点

**现状**:`conversation_read_cursors` 数据地基在;左栏数字是 `next_seq`(消息总数)不是未读数;`conversationVmSchema` 无 `unread_count` 字段。

**做法**:
- `conversationVmSchema` 加 `unread_count`(合同 + VM 组装,`workbench-pages.ts` 会话列表处 JOIN read cursor 算差值,注意 N+1——一条 SQL 聚合出全部会话的未读)。
- rail 树叶红点/加粗:未读 > 0 时数字变未读数样式;`conversation.message.created` SSE 到达时前端增量刷新(已在会话内则不计)。
- 顺带修「已读 N/M」分母 bug(`chat/view.ts:606` 用 workspace_members → 改 conversation_participants)。虽然逻辑属批次 B 前置,但改动点在同一片代码,归 A 一次做掉。

## A5 消息通知 → OS 桥

**现状**:会话消息零通知;client-tauri `notify.rs:106-322` 的 SSE→OS 通知桥成熟(urgency 映射/去重/深链),只是没人喂它。

**做法**:
- 新通知类型 `conversation.message`(私聊/协同会话的新消息)与 `conversation.mention`(任何会话里 @你)。生成规则:**收件人不在线,或在线但未打开该会话**才落通知(presence store + SSE 订阅态判断;都满足则只推轻量 SSE 让红点动)。dedupe_key 按 `conversation:{id}:user:{uid}` 聚合(同会话多条未读只一条通知,计数累加复活)。
- 静音:复用 `isMutedForRecipient` 类型静音;会话级免打扰(participant 行加 `muted_at`)本批可选,列入验收非阻断项。
- eventTypes 加对应枚举,桌面 notify.rs 映射深链到「打开该会话」。

## A6 聊天产出卡内联批准

**现状**:产出卡只有「看提议」深链,批准在右栏(`workbench/chat/render.ts:493-533`)。

**做法**:产出卡直接加批准/打回按钮(动作复用 `panel.ts` 的 reviewProposalWithoutMerge / 打回),合并仍留右栏(合并要看 diff,不宜盲点)。落定后既有「落定行」广播不变。

## 验收门

- 单测:pulse 注册/互斥/错误隔离;提醒阶梯状态机(0→1→2→3→升级/抑制);unread_count SQL 聚合正确性(含墓碑消息不计)。
- 真 PG smoke:审批挂 24h(时间注入)→ 通知复活 + reminder_count=1;digest 卡更新不刷屏。
- 桌面手验:锁屏/后台收私聊 → OS 通知 → 点击深链进会话;红点消退。
- 全程 `pnpm -r typecheck`(测试用 tsx 不查类型的老坑)。
