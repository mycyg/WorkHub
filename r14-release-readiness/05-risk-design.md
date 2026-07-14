# R14 · 批 RISK 实现级设计（风险预警巡检）

> 集成裁定（2026-07-14）：批准设计。迁移号=0059（when=1783912000000，FEEDBACK 批占 0058）；施工顺序 RISK-A 服务端（sonnet）先发，RISK-B 桌面 UI（设置分区+digest 卡渲染）待 APPROVE-CHAT 与 FEEDBACK 的聊天渲染占地合入后再发（chat/render.ts 三方磁铁，串行合并）。

> 状态：施工设计草稿 · 2026-07-14 · 上游：00-plan.md §2 批 RISK（用户拍板范围）
> 侦察基础：scheduler 范式三例（conversation-observer/skill-curation/conversation-reply-judge）+ work_items/cost_ledger_entries schema + 通知/会话汇报既有管线 + project_ai_governance 既有设置落点
> 纪律：04 手册 13 条铁律不变；本稿只读侦察，未改动仓库任何文件。
> 迁移号：**0059**（`when=1783911000000`，按 0055→0057 的 `+1000000` 递增序推算；FEEDBACK 批预期占 0058。集成时若与并行批撞号，按 00-plan.md 末行「迁移号由集成者统一分配」重排，不影响本设计的列/查询内容）。

---

## 0. 范围裁定

00-plan §2 批 RISK 原文：

> 新 worker：定时巡检（复用 scheduler 范式 + isConfigured 守卫），PM 视角三类信号：工单停滞 N 天、deadline 临近未动工、项目成本异常放量。产出走既有主动汇报通道（会话内 Cuu 汇报消息 + 通知），限频合并（一天一次 digest 式，不逐条骚扰——这是批内固定策略，不是打扰预算升维）。全部阈值进 settings 可配，默认保守。

对「isConfigured 守卫」的裁定（侦察任务5的结论，见 §5）：**三类信号判定全部是确定性 SQL 规则，不调 LLM**——若照抄 observer/reply-judge 把整个 worker 挂在 `getDefaultProviderRegistry().isConfigured()` 后面，会导致「没配 LLM key 的自托管实例」连风险巡检这种零成本的规则判断都拿不到，这正是 FIX 批第8条要修的「无 key 自托管静默死」同类反模式。因此：

- **基础巡检（规则判定 + 模板话术）不受 isConfigured 门控**，任何自托管实例开箱可用。
- isConfigured 只用于**可选增强**：把 digest 从模板话术过一遍 LLM 润色成更自然的项目经理语气（v1 不做，见 §7）。「复用 isConfigured 守卫」这句拍板落在这个可选增强点上，不是落在整个 worker 上——与拍板原意（做巡检、不引入新的自托管拦路虎）一致，不是曲解范围。

---

## 1. 侦察结论

### 1.1 scheduler 范式（三例对照，见 `apps/api/src/workers/conversation-observer.ts:857-1034`、`agent-skill-curation.ts:88-425`、`conversation-reply-judge.ts:56-136`）

三例共同骨架：
- `createXScheduler(deps/options)` 返回 `{ tick, start, stop, stats }`；`running` 布尔重入守卫（并发 tick 直接返回零结果，不排队）。
- `start()`：`setInterval` + `timer.unref?.()`（不挡进程退出）；`intervalMs<=0` 时不启动（测试可关）。
- `stop()`：`clearInterval` 置 `undefined`，幂等。
- `tick()` 内部 try/catch：单条候选失败不连累其余（continue），整体异常才 `errorCount+1` 并 `onError?.(error)` 后 rethrow（供 `start()` 里的 `.catch` 记日志）。
- 薄 worker + 厚 service 的拆法（`conversation-reply-judge.ts` 范例最贴近 RISK：worker 只有 30 行调度节奏，真正逻辑在 `services/conversation-reply-judge.ts` 的 `runOnce()`，纯依赖注入、可单测）——**RISK 采用这个二层结构**：`services/risk-monitor.ts`（signal 判定 + digest 组装 + 发送，纯函数为主）+ `workers/risk-monitor.ts`（tick 调度壳）。
- `getDefaultXScheduler()` 单例 + 默认依赖装配，供 `server.ts` 调用。

### 1.2 server.ts 接线 + isConfigured 守卫（`apps/api/src/server.ts:1-105`）

```ts
const conversationObserverScheduler = getDefaultProviderRegistry().isConfigured()
  ? getDefaultConversationObserverScheduler()
  : undefined;
if (conversationObserverScheduler) {
  conversationObserverScheduler.start();
} else {
  logger.info("conversation_observer_disabled", { reason: "llm_provider_not_configured" });
}
```
`shutdown()` 里对称 `xScheduler?.stop()`。RISK 按 §0 裁定**不需要 isConfigured 判断**（除非做可选 LLM 润色），接线简化为：

```ts
const riskMonitorScheduler = getDefaultRiskMonitorScheduler();
riskMonitorScheduler.start();
// shutdown(): riskMonitorScheduler.stop();
```
与 `recoveryScheduler`/`sessionSweepScheduler` 同档（无条件启动的后台巡检），不与 `conversationObserverScheduler` 同档。

### 1.3 三类信号的数据可得性

**结论先行**：三个字段 WorkHub 全部**已经有**，零缺失，不需要为信号本身新加列。唯一需要的迁移是「阈值配置往哪存」（§2）。

- **工单停滞**：`packages/db/src/schema/core.ts:374-431` `work_items` 表已有 `updated_at`（`timestamps()` helper，`core.ts:93-98`，每次写入自动 `defaultNow()`/显式 `at`）与 `status`（`work_item_statuses` 枚举，`packages/contracts/src/enums.ts:3-16`：intake/ai_clarifying/spec_ready/ai_working/escalated/pm_mode/in_review/merged/done/cancelled）。`work-items.ts` 仓库多处 `.update(workItems).set({..., updatedAt: at})`（如 `packages/db/src/repositories/work-items.ts:694/723/750/962/1434`）证实状态流转会推进 `updated_at`。
  - **诚实定义的坑**：一个正在被军团执行的 `ai_working` 工单，如果 run 跑了很多轮但迟迟不改 `work_items` 本身的列，`updated_at` 可能好几天没动——这不是「停滞」，是「AI 正忙」。设计里必须排除「有 active agent_run 挂着」的项，见 §3.2。
- **deadline**：`work_items.due_at`（`core.ts:393`，`timestampTz("due_at")`，nullable）**已经存在**，不是缺失字段。目前唯一写入点是创建/编排工单时的可选估算（未逐一核实全部写点，但列本身早就在 schema 里，非本批新增）。「临近未动工」= `due_at` 在阈值窗口内 **且** `status` 处于「工作还没真正开始」的早期阶段（intake/ai_clarifying/spec_ready——`ai_working` 之前，见 `packages/contracts/src/enums.ts:20-31` 的状态机 `ai_working` 是第一个「已经在跑」的状态）。
- **项目成本异常放量**：`cost_ledger_entries`（`core.ts:1752-1797`）**没有 `project_id` 列**，但有 `work_item_id`（`core.ts:1761`）；`work_items.project_id`（`core.ts:379`）是 NOT NULL 外键。项目级成本 = `cost_ledger_entries JOIN work_items ON work_item_id GROUP BY work_items.project_id`，与既有 `listCostByAssigneeForWorkspace`（`packages/db/src/repositories/cost-ledger.ts:350-385`，LEFT JOIN agent_runs + GROUP BY 一次查询出账）同一手法——**不需要新列**。当前 `apps/api/src/pages/cost.ts` 的看板只有 `by_workitem`/`by_user`/`by_team`/`by_task_plan`/`by_objective`，没有 `by_project` 聚合，RISK 是第一个要按项目聚合成本的消费点，新增一个仓库查询函数即可（§3.4），不动 cost.ts 看板本身（范围围栏之外）。
  - `scope_kind='workitem'` 的行是「一次用量在 workitem 维度记的那一条」（`aggregateByScope` 的既有去重口径见 `apps/api/src/pages/cost.ts:411-441` 注释），按这个 scope 过滤 + JOIN 得到项目粒度，不会重复计费。
  - `period_bucket` 是 `now.toISOString().slice(0,10)`（UTC 日期，`packages/cost/src/ledger.ts:106`）——「日成本」天然以 UTC 自然日为桶，本设计的「昨日/近7日均值」窗口对比复用这个既有桶，不用另起时区换算。

### 1.4 主动汇报通道

- **会话内系统消息**：`services/run-conversation-report.ts`（S2，run 终态 PM 汇报）是最贴近的先例——挂进 `agent-runner.ts` 的 settled hook 链，调用注入的 `postSystemMessage({workspaceId, conversationId, content, at})`（类型见 `agent-runner.ts:291-296` 的 `AgentRunConversationSystemMessagePoster`），真正落库走 `createActionCardRepository(db).postSystemMessage({...message, senderType:"cuu"})`（`agent-runner.ts:2897-2898`，签名 `packages/db/src/repositories/action-cards.ts:566-573`：`{workspaceId, conversationId, senderType:"system"|"cuu", content, threadRootId?, at?}`）。RISK digest 要发到**项目主区会话**（不是某条具体 run 挂靠的会话）——主区会话可用 `project_conversations WHERE project_id=? AND kind='main' AND deleted_at IS NULL`（每项目恰好一条，唯一索引 `project_conversations_active_main_uq` 保证，见 `packages/db/src/repositories/projects.ts:83-130` 的 `ensureActiveMain`），可以在候选查询里一次 JOIN 拿到（§3.1），不需要新的「找主区」仓库方法。
  - **客户端渲染的坑**：S2/批4b 的 system_event 走 `renderSystemEventLineHtml`（单行折叠，`apps/desktop-webview/src/workbench/chat/render.ts:596-603`，读 `content.summary` 兜底），只适合一句话文案；一个三信号 digest（可能有多条停滞工单/多条临期工单/成本一行）塞进单行会很挤。批4b/S2 的做法是给「有专属结构」的事件加一个专门 case（`renderDeliverableCardHtml`/`renderRunSettledReportHtml`，`render.ts:444-519`）。RISK 照此新增 `renderRiskDigestCardHtml`（`content.event === 'risk_digest'`），卡片只展示三个计数 + 一句话摘要 + 「查看详情」跳 `/projects/:id`（web 项目主页已存在，`apps/web/src/routes.ts:129`），完整清单留给通知正文（§3.5），不在聊天气泡里铺开长列表。
- **通知**：`packages/db/src/repositories/notifications.ts:60-140` 的 `createOrUpdateNotification` 是唯一写口，`type`（varchar(64) 自由字符串，无 CHECK 约束，`core.ts:857`）、`severity`、`title`、`body`（text，可多行）、`target_url`、`project_id`、`dedupe_key` 都已就位，**不需要新列**。
  - dispatch_ask 通知（`workers/conversation-observer.ts:437-450`）是最贴近先例：`dedupeKey: "action-card-item:${itemId}:dispatch-ask"`，直接调仓库层 `createOrUpdateNotification`，**不经过** `services/notifications.ts` 的 `createNotificationService`（那层才会 `publishNotification` 发 SSE `notification.created`）。也就是说 dispatch_ask **不发实时 SSE**，客户端下次拉取通知列表才看得到——RISK 照抄同款省事路径，不新增 SSE 推送职责。
  - `apps/api/src/services/schedule-notify-pages.ts:182-194/209-248` 的通知收件箱页会把未匹配 `work_item`/`meeting_insight` 的类型兜底成 `{source_type:"system", label: row.type}`（`schedule-notify-pages.ts:247`），且按 `severity==='high'|'urgent'` 或 `type` 正则命中 `approval|ask|pending|insight|escalated|in_review|review|decision` 才落 `needs_decision` 桶，否则落 `fyi`（`schedule-notify-pages.ts:182-194`）。RISK digest 的 `type` 定为 `project.risk_digest`（不含上述关键词）、`severity` 定为 `normal` → 落 `fyi` 桶，**不新增 discriminated union 分支**，通知收件箱页零改动即可正确显示。
- **限频/去重的既有先例**：`notifications_user_dedupe_uq`（`core.ts:880-883`，`unique(user_id, dedupe_key) where dedupe_key is not null`）+ `createOrUpdateNotification` 的语义（`notifications.ts:62-140`）——同 `dedupeKey` 再来一次：内容不变 → 原样返回 `{created:false, resurfaced:false}`（真正的 no-op）；内容变了 → 更新同一行 `{created:false, resurfaced:true}`；`dedupeKey` 从未出现过 → 插入新行 `{created:true, resurfaced:false}`。**这就是「一天一次」的天然落点，不需要新表/新的「今天发过了吗」状态**：`dedupeKey = "risk-digest:${projectId}:${utcDateStr}"`，日期变了 key 自然变新——不用建 digest 记录表，也不用内存态（内存态在多 tick/单例进程下够用，但用 dedupeKey 更省事且天然扛得住进程重启）。

### 1.5 settings 可配落点

`project_ai_governance`（`core.ts:792-805`）：`observer_enabled`（bool 平列）、`silence_window_secs`（int 平列）、`quiet_hours_json`（jsonb，`AiQuietHours` 判别联合）、`granular_json`（jsonb，**`aiGranularSettingsSchema` 是 `.strict()` 的纯布尔开关集**：`create_work_item`/`dispatch_run`/`mutate_drive`/`send_notification`，见 `packages/contracts/src/domain/conversation.ts:50-58`——**不能塞数值阈值进去**，语义不符且会撞 `.strict()`）。

**推荐：项目级**，新增一个平行的 jsonb 列 `risk_monitor_json`（不复用 `granular_json`），理由：
1. 三类信号阈值天然是「这个项目的活儿量级」的函数（一个高频迭代项目 5 天不动可能真异常，一个季度节奏的项目 5 天很正常）——工作区级做不到这种颗粒度，且现有 governance 表本来就是项目级，风险巡检加进同一张表最省事，不需要新表。
2. `project_ai_governance` 已经是「PATCH 端点 + 读时 default 合并」的成熟模式（`apps/api/src/services/ai-settings.ts:290-301` 的 `governanceView`），RISK 只是多一个字段，端点/权限/审计全部复用，零新增路由。
3 `granular_json` 是严格的布尔开关集，语义上是「AI 能不能做 X」，跟「阈值是多少」不是一回事，硬塞进去要么破坏 `.strict()`，要么放宽 schema 变成 `Record<string, unknown>` 反而丢失类型安全——不如平行加一列干净。

### 1.6 LLM 是否需要

**结论：不需要，v1 全走确定性规则 + 模板话术。**
- 三个信号（停滞天数、deadline 窗口、成本比值）全部是可以精确算出的数字比较，任何一个用 LLM 判断都是拿不确定性换确定性能算出来的东西，且徒增延迟/成本/自托管门槛。
- 文案用模板拼接（"3 项工单已停滞超过 5 天""2 项临近截止未动工""项目今日成本 ¥128，是近 7 日日均的 3.2 倍"这类结构化模板，中文数字/名词直接插值），不是自由文本生成——参照 `services/run-conversation-report.ts`/`assigneeAutoSelectedNote`（`workers/conversation-observer.ts:356-365`）等既有系统消息的模板拼接手法，非 LLM 生成。
- **成本考量**：即使做 LLM 润色，也要过一次 `messages.create`（哪怕用便宜档模型）+ 记账（`UsageSource` 目前是 `"agent_step"|"review"|"compact"|"retry"|"eval"|"curation"`，`packages/cost/src/types.ts:93`，没有贴切的 digest/summary 类目，硬套 `agent_step` 会让 labor-split 面板把巡检成本记成「生产」，语义不准）——这个改动量（新 UsageSource 字面量 + 记账口径 + isConfigured 降级路径）配不上「把模板文案变得更顺口」这点收益。**推荐 v1 完全不做 LLM 增强**，把它列进 §7 明确不做，等真有人抱怨模板话术生硬再说。

---

## 2. 数据模型（迁移 0059）

`0059_project_risk_monitor.sql`，journal `idx=59`、`when=1783911000000`、`tag=0059_project_risk_monitor`。

```sql
-- R14 批 RISK：project_ai_governance 加一列存风险巡检阈值——照 quiet_hours_json/granular_json 的既有
-- jsonb-blob-with-default-merge 模式（读侧 DEFAULT_PROJECT_AI_GOVERNANCE 兜底），不新建表、不新建端点，
-- 只在既有 GET/PATCH /projects/:id/ai-governance 上加一个 additive 字段。
ALTER TABLE "project_ai_governance"
  ADD COLUMN IF NOT EXISTS "risk_monitor_json" jsonb NOT NULL DEFAULT '{}'::jsonb;
```
不需要 FK / CHECK（形状校验在 zod 层，参照 `quiet_hours_json`/`granular_json` 同样不在 DB 层加 jsonb schema 约束）。`packages/db/src/schema/core.ts:792-805` 对应加一行：
```ts
riskMonitorJson: jsonb("risk_monitor_json").$type<JsonObject>().notNull().default({}),
```
`packages/db/src/schema.test.ts` 尾部「migration journal ends with 00XX」断言要跟着改（冲突磁铁，见 §8）。

### 2.1 契约（`packages/contracts/src/domain/conversation.ts`）

```ts
export const riskMonitorSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    stall_days_threshold: z.number().int().min(1).max(90).optional(),
    deadline_lookahead_days: z.number().int().min(0).max(30).optional(),
    cost_spike_ratio_pct: z.number().int().min(100).max(2000).optional(),
    cost_spike_min_cny: z.number().finite().nonnegative().optional()
  })
  .strict();
export type RiskMonitorSettings = z.infer<typeof riskMonitorSettingsSchema>;

export const DEFAULT_RISK_MONITOR_SETTINGS = {
  enabled: true,
  stall_days_threshold: 5,
  deadline_lookahead_days: 2,
  cost_spike_ratio_pct: 300,
  cost_spike_min_cny: 20
} as const satisfies Required<RiskMonitorSettings>;
```
`DEFAULT_PROJECT_AI_GOVERNANCE`（`conversation.ts:126-136`）加 `risk_monitor: DEFAULT_RISK_MONITOR_SETTINGS`；`patchProjectAiGovernanceRequestSchema`（`conversation.ts:158-169`）加 `risk_monitor: riskMonitorSettingsSchema.optional()`；`projectAiGovernanceVmSchema`（`conversation.ts:272-282`）加 `risk_monitor: riskMonitorSettingsSchema`（读侧用完整默认值合并输出，字段全部有值，非 partial——跟 `granular_settings` 当前只输出用户设过的键不同，这里选择「读时补全默认」是因为设置 UI 要显示当前生效阈值，不是「哪些被覆盖了」）。

### 2.2 仓库层（`packages/db/src/repositories/ai-settings.ts`）

`ProjectAiGovernancePatch` 类型加 `riskMonitorJson?: RiskMonitorSettings`；`upsertProjectGovernance` 的 insert/update set 子句照 `granularJson`（`ai-settings.ts:154/204/220/240/253`）加对称一行：`...(patch.riskMonitorJson !== undefined ? { riskMonitorJson: { ...patch.riskMonitorJson } } : {})`；`governanceView`（`services/ai-settings.ts:290-301`）加 `risk_monitor: { ...DEFAULT_RISK_MONITOR_SETTINGS, ...(row?.riskMonitorJson ?? {}) }`。

---

## 3. 信号判定与 digest 组装（新文件 `packages/db/src/repositories/risk-monitor.ts` + `apps/api/src/services/risk-monitor.ts`）

### 3.1 候选项目查询（一次 SQL，含 governance + 主区会话，含「今天发过了吗」反连接）

```ts
// packages/db/src/repositories/risk-monitor.ts
export type RiskMonitorProjectCandidateRow = {
  projectId: string;
  projectName: string;
  workspaceId: string;
  ownerUserId: string;
  ownerNickname: string;
  mainConversationId: string | null; // main 会话理论上恒存在，null 防御性兜底（legacy 数据）
  riskMonitorJson: JsonObject | null;
};

async function listProjectsPendingDigest(
  db: WorkHubDb,
  input: { utcDate: string; limit: number }
): Promise<RiskMonitorProjectCandidateRow[]> {
  // WHERE 结构（伪代码，实现用 drizzle query builder）：
  // FROM projects p
  // LEFT JOIN project_ai_governance g ON g.project_id = p.id
  // LEFT JOIN project_conversations mc ON mc.project_id = p.id AND mc.kind = 'main' AND mc.deleted_at IS NULL
  // WHERE p.archived = false AND p.deleted_at IS NULL AND p.is_personal = false
  //   AND p.owner_user_id IS NOT NULL
  //   AND coalesce((g.risk_monitor_json->>'enabled')::boolean, true) = true
  //   AND NOT EXISTS (
  //     SELECT 1 FROM notifications n
  //     WHERE n.user_id = p.owner_user_id
  //       AND n.dedupe_key = 'risk-digest:' || p.id::text || ':' || :utcDate
  //   )
  // ORDER BY p.id
  // LIMIT :limit
}
```
- `is_personal = false`：个人空间只有 owner 一人，没有「PM 视角」这回事，排除（呼应侦察任务4「项目级 or 工作区级」——个人空间天然被排除，不需要额外开关）。
- `owner_user_id IS NOT NULL`：legacy 无主项目跳过（不硬造收件人），静默计数进 `stats().skipped_no_owner`。
- 反连接直接挡掉「今天已经发过且内容没变」——但内容变了会 `resurfaced` 而不是新 dedupeKey，反连接挡不住，见 §4 的「只在 `created===true` 才发会话消息」二次门。

### 3.2 工单停滞（一次批量查询，跨候选项目，阈值在应用层按项目分桶比较）

```ts
async function listOpenWorkItemAges(
  db: WorkHubDb,
  input: { projectIds: string[]; now: Date; capPerBatch: number }
): Promise<Array<{ projectId: string; id: string; code: string; title: string | null; status: WorkItemStatus; updatedAt: Date; dueAt: Date | null }>> {
  // FROM work_items wi
  // WHERE wi.project_id = ANY(:projectIds)
  //   AND wi.deleted_at IS NULL
  //   AND wi.status NOT IN ('done','cancelled','merged')
  //   AND NOT EXISTS (
  //     SELECT 1 FROM agent_runs ar
  //     WHERE ar.work_item_id = wi.id AND ar.status IN ('queued','running')
  //   )
  // ORDER BY wi.project_id, wi.updated_at ASC
  // LIMIT :capPerBatch  -- 安全网（如 500），不是逐项目 cap；超限即诚实少报，不做无界扫描
}
```
应用层按 `projectId` 分组后，对每组用**该项目自己的** `stall_days_threshold`/`deadline_lookahead_days`（来自 §3.1 拿到的 `riskMonitorJson`，缺省用 `DEFAULT_RISK_MONITOR_SETTINGS`）过滤：
- **停滞**：`status` 不在 `(done,cancelled,merged)` 且无 active run（SQL 已过滤）且 `now - updatedAt >= stall_days_threshold 天`。
- **deadline 临近未动工**：`due_at IS NOT NULL` 且 `due_at <= now + deadline_lookahead_days 天` 且 `status IN (intake, ai_clarifying, spec_ready)`（`ai_working` 起视为「已动工」，见 §1.3）。**一个工单可能同时触发两个信号**（停滞 5 天且 3 天后到期）——digest 里分两个桶分别列，不去重合并，如实呈现两种不同的风险维度。

### 3.3 排序与展示上限

每个信号桶展示条目数上限（如 5 条，超出显示「及其余 N 项」而非无限枚举）——`title`/`code` 已经在 §3.2 的查询里拿到，不需要二次查询。

### 3.4 项目成本异常放量（批量查询，按 (project_id, period_bucket) 分组）

```ts
async function listDailyCostByProjects(
  db: WorkHubDb,
  input: { projectIds: string[]; sinceBucket: string } // sinceBucket = 8 天前的 UTC 日期（今天+7日基线）
): Promise<Array<{ projectId: string; periodBucket: string; costCny: string }>> {
  // FROM cost_ledger_entries cle
  // JOIN work_items wi ON wi.id = cle.work_item_id
  // WHERE cle.scope_kind = 'workitem'
  //   AND wi.project_id = ANY(:projectIds)
  //   AND cle.period_bucket >= :sinceBucket
  // GROUP BY wi.project_id, cle.period_bucket
}
```
应用层每个项目：`todayCost = 今日桶(即 utcDate)之和`，`baselineAvg = 昨日及之前 7 天（不含今日）之和 / 有数据的天数`（无数据天数不计入分母，不是补零拉低均值）。判定放量：
- `baselineAvg > 0`：`todayCost / baselineAvg >= cost_spike_ratio_pct / 100` **且** `todayCost >= cost_spike_min_cny`（比例和绝对值floor 都要过，防止「昨天 ¥0.01 今天 ¥0.05」这种噪音被算成 500% 放量）。
- `baselineAvg == 0`（近 7 日无成本活动、今天冒出新支出）：视作「冷启动」，改用 `todayCost >= cost_spike_min_cny * 2`（比常规 floor 高一档，避免项目刚起步第一次跑 agent 就被判定「异常」）单独触发，digest 文案区分「近期无支出记录，今日新增 ¥X」与「今日 ¥X，是近7日均值的 N 倍」两种措辞，不用同一句话硬套两种情况（04 铁律：不编造、如实呈现)。

### 3.5 digest 组装与文案（模板拼接，非 LLM）

```ts
type RiskDigestSignal =
  | { kind: "stalled"; items: Array<{ code: string; title: string; daysIdle: number }>; totalCount: number }
  | { kind: "deadline"; items: Array<{ code: string; title: string; daysUntilDue: number }>; totalCount: number }
  | { kind: "cost_spike"; todayCostCny: string; baselineAvgCny: string | null; ratioPct: number | null };

function buildRiskDigest(input: {
  projectId: string;
  projectName: string;
  signals: RiskDigestSignal[]; // 空数组 = 无信号，调用方应跳过整个项目（不发空 digest）
}): { notificationTitle: string; notificationBody: string; chatSummary: string; chatCounts: { stalled: number; deadline: number; costSpike: boolean } }
```
- 通知 `title`：「${projectName} · 今日风险巡检」；`body`：每个命中的信号各一段（模板句见 §1.6 示例），多信号用换行分段（`body` 是 `text` 列，支持多行）。
- 聊天卡片 `chatSummary`：一句话（"今天巡检发现 3 项风险信号——2 项工单停滞、1 项临期未动工"这类合并计数句），不逐条列在聊天里（详情走通知/项目主页）。
- **无信号的项目不产出 digest**（`signals.length === 0` 时整个项目在这一天什么都不发，不发「一切正常」的噪音消息——这也是"限频合并、不逐条骚扰"精神的延伸：连"零信号"本身也不该是一条要用户读的消息）。

---

## 4. 发送与幂等（`apps/api/src/services/risk-monitor.ts` 的 `runOnce()`）

```ts
async function processProjectCandidate(deps, candidate, signals, at) {
  if (signals.length === 0) {
    return "no_signal";
  }
  const digest = buildRiskDigest({ projectId: candidate.projectId, projectName: candidate.projectName, signals });
  const utcDate = at.toISOString().slice(0, 10);
  const dedupeKey = `risk-digest:${candidate.projectId}:${utcDate}`;

  const result = await deps.notifications.createOrUpdateNotification({
    userId: candidate.ownerUserId,
    type: "project.risk_digest",
    severity: "normal",
    title: digest.notificationTitle,
    body: digest.notificationBody,
    targetUrl: `/projects/${candidate.projectId}`,
    projectId: candidate.projectId,
    dedupeKey
  }, at);

  // 只在「今天第一次真正建出这条通知」时才顺带发会话消息——同一天内信号变化只静默刷新通知正文，
  // 不重复打扰聊天区（这是「一天一次 digest」的第二道门，第一道门是 dedupeKey 本身）。
  if (result.created && candidate.mainConversationId) {
    try {
      await deps.postSystemMessage({
        workspaceId: candidate.workspaceId,
        conversationId: candidate.mainConversationId,
        senderType: "cuu",
        content: {
          event: "risk_digest",
          project_id: candidate.projectId,
          summary: digest.chatSummary,
          stalled_count: digest.chatCounts.stalled,
          deadline_count: digest.chatCounts.deadline,
          cost_spike: digest.chatCounts.costSpike,
          target_url: `/projects/${candidate.projectId}`
        },
        at
      });
    } catch (error) {
      // 会话播报是锦上添花——通知已经落库成功，播报失败只告警，不回滚通知、不重试
      // （同 run-conversation-report.ts 的既有取舍）。
      logger.warn("risk_digest_conversation_post_failed", { projectId: candidate.projectId, error });
    }
  }
  return result.created ? "sent" : "refreshed";
}
```
- 没有 `mainConversationId`（legacy 防御分支）：只发通知，不报错，计数进 `stats().skipped_no_conversation`。
- 通知写失败（DB 异常）：这条项目算 `failed`，不影响其余候选（tick 循环里 catch 单条）。

---

## 5. worker 结构与接线

### 5.1 `apps/api/src/services/risk-monitor.ts`

```ts
export type RiskMonitorRunResult = {
  scanned: number;      // 候选项目数（本 tick 拿到的，已排除"今天发过且内容不变"的）
  sent: number;         // 新建通知+播报的项目数
  refreshed: number;    // 内容变化、更新了通知但未重发播报的项目数
  no_signal: number;    // 扫了但三个信号都没命中
  skipped_no_owner: number;
  skipped_no_conversation: number;
  failed: number;
  started_at: string;
  finished_at: string;
};

export async function runOnce(deps: RiskMonitorDeps): Promise<RiskMonitorRunResult> { ... }
```
`RiskMonitorDeps` 全部可注入（仓库/`postSystemMessage`/`now`/`logger`/`maxProjectsPerTick`），单测直接构造假仓库跑 `runOnce()`，不碰真库——照 `services/conversation-reply-judge.ts` 的既有测试手法。

### 5.2 `apps/api/src/workers/risk-monitor.ts`

薄壳，照抄 `workers/conversation-reply-judge.ts` 的 30 行结构（`tick`/`start`/`stop`/`stats`，`running` 守卫，`timer.unref?.()`）。`DEFAULT_INTERVAL_MS`：**1 小时**（`60 * 60 * 1000`）——不需要 observer 那种 15s 高频（信号本身按天变化，1 小时探测一次足够及时发现"今天该发但还没发"的候选并在同一天内补上，24 次/天的扫描量对一个规则查询完全不是负担）。

```ts
export function getDefaultRiskMonitorScheduler(): RiskMonitorScheduler {
  // db = getSharedDatabaseClient().db
  // repository = createRiskMonitorRepository(db)
  // postSystemMessage = (msg) => createActionCardRepository(db).postSystemMessage(msg)
  // notifications = createNotificationRepository(db)
  // intervalMs = settings.riskMonitor?.intervalMs ?? DEFAULT_INTERVAL_MS （新增 settings 键，若嫌多可直接写死常量，不做 env 可调——巡检节奏不是运维会调的旋钮）
}
```

### 5.3 `server.ts` 接线（不经 isConfigured）

```ts
import { getDefaultRiskMonitorScheduler } from "./workers/risk-monitor.js";
// ...
const riskMonitorScheduler = getDefaultRiskMonitorScheduler();
riskMonitorScheduler.start();
// shutdown(): riskMonitorScheduler.stop();
```
挂在 `recoveryScheduler`/`sessionSweepScheduler` 那一档（无条件启动），不挂在 `conversationObserverScheduler` 那一档（isConfigured 门控）——对应 §0 的裁定。

---

## 6. 阈值默认值（保守，见 §2.1 `DEFAULT_RISK_MONITOR_SETTINGS`）

| 键 | 默认 | 理由 |
|---|---|---|
| `enabled` | `true` | 巡检零 LLM 成本，默认开对自托管用户友好；项目可单独关 |
| `stall_days_threshold` | 5 天 | 覆盖一个工作周仍不算离谱；1-2 天阈值在正常排期（周末/优先级切换）下噪音太大 |
| `deadline_lookahead_days` | 2 天 | 48 小时内到期且没开工才算「真的来不及了」，提前一周提醒又太早、意义不大 |
| `cost_spike_ratio_pct` | 300%（3倍） | 日常波动（如某天多跑几个 run）不至于到 3 倍，3 倍以上大概率是失控循环/参数配错 |
| `cost_spike_min_cny` | ¥20 | 团队日预算默认 ¥200（`BUDGET_DEFAULT_TEAM_DAILY_COST_CNY`，`packages/config/src/env.ts:96`）的 10%——低于这个绝对值的"倍数放量"是噪音，不是风险 |

---

## 7. 明确不做

- **打扰预算统一治理升维**：00-plan §4 非目标已钉死，本设计的"一天一次 dedupeKey 门 + 只在 created 时播报"是**批内固定策略**，不是新的通用打扰预算框架，不新增任何跨批复用的限频基础设施。
- **逐条即时推送**：三个信号任何一条命中都不会单独触发通知/消息，永远合并成当天一条 digest。
- **LLM 润色/生成话术**：v1 全模板拼接（§1.6）；isConfigured 门控在这批不落地任何实际代码路径，只在设计上预留（真要做时才引入 `UsageSource` 新类目等配套改动）。
- **已读回执式确认**（PM 要不要点"已处理"）：复用现有通知的 `read_at`/`archived_at` 即可，不新建状态机。
- **跨项目汇总视图**（"工作区级风险总览页"）：本批只做单项目 digest，工作区级汇总留给未来若有需求再立项（GH 批之后的项目健康面板方向更合适承接）。
- **成本信号覆盖非 workitem 支出**（curation/eval 等团队级账目）：项目成本口径限定 `scope_kind='workitem'` 能归到某个 `project_id` 的部分，团队级自进化开销不计入"项目"异常（本来就不是哪个项目的钱）。

---

## 8. 施工切片

| 工包 | 分支 | 模型 | 范围 |
|---|---|---|---|
| RISK-A risk-monitor-core | r14/risk-monitor | sonnet | 迁移 0059 + schema.ts 一行 + 契约（`riskMonitorSettingsSchema`/`DEFAULT_RISK_MONITOR_SETTINGS`/governance 三处 additive 字段）+ `packages/db/src/repositories/risk-monitor.ts`（§3.1/3.2/3.4 三个查询）+ `ai-settings.ts` 仓库/服务的 `riskMonitorJson` 读写 + `services/risk-monitor.ts`（`runOnce`/`buildRiskDigest`）+ `workers/risk-monitor.ts`（scheduler 壳）+ `server.ts` 接线 + 单测（假仓库跑 `runOnce` 覆盖：单信号/多信号/无信号跳过/冷启动成本/停滞项排除 active-run/已发过今天不重发/内容变化 refresh 不重播）
| RISK-B settings-ui | r14/risk-settings-ui | sonnet | 桌面 Spotlight 设置 `apps/desktop-webview/src/workbench/settings/{render,api,view}.ts` 加「风险巡检」小节（开关 + 4 个数值输入，照 `silence_window_seconds` 输入样式，`render.ts:140-164` 那一段旁边新增一块）+ `renderRiskDigestCardHtml`（`apps/desktop-webview/src/workbench/chat/render.ts` 新增 case，照 `renderRunSettledReportHtml` 手法）+ 桌面端渲染单测

**任务判断（回应"sonnet 够吗"）**：够。巡检逻辑是清晰的规则判断+既有仓库查询手法的直接复用（无算法难点、无并发状态机、无新协议），风险点集中在"别漏掉 active-run 排除""别把冷启动和放量混为一谈"这类边界条件，属于 sonnet 能稳定处理的范畴，不需要 opus 档。

**围栏**：不碰 `apps/api/src/pages/cost.ts`（不新增 `by_project` 看板字段，仅新增仓库查询函数供 worker 内部消费）；不碰通知收件箱页的 `NotificationSourceContextVM` 判别联合（`type` 命名刻意避开 `needs_decision` 关键词正则，落 `system`/`fyi` 兜底分支即可正确显示，见 §1.4）；不新增 SSE 事件类型；不动 `patchProjectAiGovernanceRequestSchema` 之外的任何 ai-settings 端点。

**冲突磁铁**（集成者手解，照 01-chat-design.md §7 同款清单）：
- `packages/db/src/schema.test.ts` 尾部「migration journal ends with 00XX」断言（当前钉在 0057，若 FEEDBACK 批的 0058 先合并，本批要把断言从「ends with 0058」改成「ends with 0059」，并在自己的测试里新增「migration 0059 adds risk_monitor_json...」断言，跟 0055/0056/0057 三个断言同款格式）。
- `packages/db/migrations/meta/_journal.json` 尾部追加条目（`idx:59, when:1783911000000, tag:"0059_project_risk_monitor"`）——若与 FEEDBACK 批（推定 0058）并行开发，两批各自在自己分支追加，集成者合并时按实际落地顺序重排 `when`（保持严格递增），非阻塞项。
- `packages/contracts/src/domain/conversation.ts` 里 `DEFAULT_PROJECT_AI_GOVERNANCE`/`patchProjectAiGovernanceRequestSchema`/`projectAiGovernanceVmSchema` 三处如果 FEEDBACK 批也在动 ai-settings 契约文件（不太可能，FEEDBACK 是独立的 `ai_feedback` 新表，大概率不碰这个文件），风险低。
- `server.ts` 的 scheduler 接线区（`apps/api/src/server.ts:33-67`）——只要不是同批次并行改这同一段，追加式插入不冲突。

---

## 9. 验收清单（供施工方自查）

1. 真库跑 `runOnce()`：一个项目同时有停滞工单 + 临期工单 + 成本放量，一次 tick 只产出一条通知 + 一条会话消息，`body`/`chatSummary` 三段信息都在。
2. 同一天第二次 tick、信号不变：通知 `resurfaced=false`（真正 no-op），会话消息不重发。
3. 同一天第二次 tick、多了一条新停滞工单：通知 `resurfaced=true`（正文刷新），会话消息依然不重发（只在当天第一次 `created` 时发）。
4. 跨天（UTC 日期变了）：`dedupeKey` 换新，重新走一遍"创建+播报"。
5. `ai_working` 且有 `agent_runs.status IN ('queued','running')` 挂着的工单，即使 `updated_at` 是三周前，不进停滞清单。
6. 项目关闭 `risk_monitor.enabled=false`：候选查询直接跳过，不产出任何数据。
7. 成本近 7 日无记录、今天首次产生 ¥15：不触发「冷启动」判定（floor 是 min_cny*2=¥40）；产生 ¥45 才触发，且文案走"近期无支出记录"分支而非"是均值的 N 倍"分支。
8. 个人空间项目（`is_personal=true`）：候选查询天然排除，不巡检。
9. `pnpm -r typecheck` + 各包测试 + 迁移链 scratch 真库 0000→0059 全绿（若 0058 已被 FEEDBACK 占用，替换成实际集成后的尾号）。
