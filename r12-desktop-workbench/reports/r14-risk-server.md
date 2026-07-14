# R14 批 RISK · RISK-A risk-server 施工汇报

- 分支：`r14/risk-server`
- 提交：`e54d9f30`（contracts）→ `deaa0b41`（db）→ `3bc61793`（api 服务+worker）→ `0fc8833d`（机械牵连收口）；本汇报另起一 commit
- 施工说明书：`r14-release-readiness/05-risk-design.md`（逐节执行，头部集成裁定：迁移号 0059）
- 验收自查：`@workhub/db` / `@workhub/contracts` / `@workhub/api` / `@workhub/desktop-webview` test + `pnpm -r typecheck` 全绿（计数见文末）

## 1. 做了什么

### §2 数据模型（迁移 0059）
- `packages/db/migrations/0059_project_risk_monitor.sql`：`project_ai_governance` 加
  `risk_monitor_json jsonb NOT NULL DEFAULT '{}'::jsonb`（ADD COLUMN IF NOT EXISTS，replay-safe，
  过 check-migrations 静态门）。不新建表、不新建 FK/CHECK（形状校验在 zod 层，照 quiet_hours_json 先例）。
- journal 追加 `idx=59 / when=1783912000000 / tag=0059_project_risk_monitor`——**0058 刻意留空**
  （并行 FEEDBACK 批的号），合并时集成者按实际落地顺序归一 `when`。
- `schema.test.ts` 尾断言 `0057`→`0059`（批准变更）+ 新增 0059 内容断言（列名/NOT NULL/默认 `{}`/PgJsonb）。

### §2.1 契约（additive）
`packages/contracts/src/domain/conversation.ts`：
- `riskMonitorSettingsSchema`（strict + bounded，全字段 optional=PATCH 语义）+
  `DEFAULT_RISK_MONITOR_SETTINGS`（enabled=true / 停滞 5 天 / 前瞻 2 天 / 放量 300% / 下限 ¥20）。
- `DEFAULT_PROJECT_AI_GOVERNANCE` / `patchProjectAiGovernanceRequestSchema` /
  `projectAiGovernanceVmSchema` 三处 additive `risk_monitor`；**VM 侧读时补全默认（每键有值，非 partial）**，
  与 `granular_settings` 的「只回显设过的键」刻意不同口径（设置 UI 要显示当前生效阈值）。
- 新测试文件 `r14-risk.test.ts`（4 条）；`r12-workbench.test.ts` 两处既有 deepEqual 补新字段。

### §3 三信号判定口径（仓库层 `packages/db/src/repositories/risk-monitor.ts` + 服务层应用判定）
三条只读批量查询，全部零 N+1、带 cap：
1. **候选项目**（`listProjectsPendingDigest`）：`projects` LEFT JOIN governance + LEFT JOIN 主区会话
   （`kind='main' AND deleted_at IS NULL`），SQL 内直接排除：归档/软删/`is_personal=true`/无 owner/
   无 workspace/`coalesce((risk_monitor_json->>'enabled')::boolean, true)=false`，外加
   `NOT EXISTS(notifications WHERE dedupe_key='risk-digest:'||id||':'||utcDate)` 反连接挡掉「今天已发」。
2. **工单停滞 + 临期**（`listOpenWorkItemAges`）：`status NOT IN (done,cancelled,merged)` 且
   `NOT EXISTS(agent_runs WHERE work_item_id=.. AND status IN ('queued','running'))`——**有 active run
   挂着的工单即使 updated_at 三周没动也不算停滞（是「AI 正忙」）**；批量 cap 500（诚实少报不无界扫）。
   应用层按项目自己的阈值分桶：
   - 停滞：`now - updated_at >= stall_days_threshold 天`；
   - 临期未动工：`due_at <= now + deadline_lookahead_days 天` **且** `status IN (intake, ai_clarifying,
     spec_ready)`（`ai_working` 起视为已动工）；同一工单可同时进两桶，不去重（两种风险维度如实呈现）。
3. **成本放量**（`listDailyCostByProjects`）：`cost_ledger_entries JOIN work_items`（表本身无 project_id）、
   `scope_kind='workitem'` 单一口径防重复计费、`GROUP BY (project_id, period_bucket)`、近 8 天窗口。
   应用层：`todayCost / baselineAvg(有数据天数为分母，不补零)` 双闸门（`>= ratio_pct/100` 且
   `todayCost >= min_cny`）；**冷启动分支**（近 7 日零支出）改用 `todayCost >= min_cny*2` 更高门槛，
   文案分开措辞不硬套倍数句。

### §3.5/§4 digest 组装与发送（`apps/api/src/services/risk-monitor.ts`）
- 模板拼接（非 LLM）；每信号桶最多列 5 条+「及其余 N 项」（文案层再钉一次 cap，不信任调用方）；
  无信号项目当天什么都不发（零信号本身不是一条要人读的消息）。
- 通知：`createOrUpdateNotification`，`type=project.risk_digest`（刻意避开通知收件箱 needs_decision
  正则关键词→落 fyi 桶，schedule-notify-pages 零改动）、`severity=normal`、
  `dedupeKey=risk-digest:{projectId}:{utcDate}`、`targetUrl=/projects/{id}`。
- 会话播报：**仅 `created===true` 时**往主区会话发 `postSystemMessage`（senderType=cuu，
  `content.event='risk_digest'`+summary+三计数+target_url）——同日内容变化只静默刷新通知正文
  （resurfaced），绝不重发聊天消息（一天一次的第二道门；第一道门是 dedupeKey 反连接）。
  播报失败只 warn 不回滚通知（同 run-conversation-report 取舍）；无主区会话（legacy）只发通知计数
  `skipped_no_conversation`；单项目失败 catch 住不连累批内其余候选。

**digest 样例文案**（模板产出，称职 PM 的例行同步口吻）：
- 通知标题：`星尘短剧 · 今日风险巡检`
- 通知正文（多信号分段）：
  ```
  工单停滞（2 项）：WI-9（接入支付）已停滞 6 天；WI-4（数据看板）已停滞 5 天
  临期未动工（1 项）：WI-12（上线检查）将于 1 天后到期仍未动工
  项目成本：今日 ¥128，是近 7 日日均（¥40）的 3.2 倍。
  ```
  冷启动分支：`项目成本：近期无支出记录，今日新增 ¥45。`
  过期分支：`WI-12（上线检查）已过期 2 天仍未动工`
- 聊天卡一句话：`今天巡检发现 4 项风险信号——2 项工单停滞、1 项临期未动工、成本异常放量`
  （计数按「项」累计，成本是项目级信号恒记 1）。

### §5 worker（`apps/api/src/workers/risk-monitor.ts`）
照 `conversation-reply-judge.ts` 的薄壳：`{tick,start,stop,stats}`、`running` 重入守卫（并发 tick
返回零结果不排队）、`intervalMs<=0` 不启动、`timer.unref?.()`、tick 异常计数后 rethrow 供 start 的
catch 记日志。`DEFAULT_INTERVAL_MS = 1 小时`。**不依赖 LLM、不挂 isConfigured**（§0 裁定：无 key
自托管开箱可用——服务 deps 类型里压根没有 provider 字段，有测试钉死这一点）。

### 阈值配置读写
设计稿明确「零新增路由」：复用既有 `GET/PATCH /projects/:id/ai-governance`（owner-only 既有权限），
本批只加 additive 字段——`packages/db/src/repositories/ai-settings.ts`（patch keys/selection/
insert-update 条件化 spread 对称）+ `apps/api/src/services/ai-settings.ts`（`governanceView` 读时默认
合并 + PATCH `risk_monitor`→`riskMonitorJson` 映射）。riskMonitorJson 读侧 `safeParse` 防御（脏 jsonb
不炸 tick，退化为全默认值）。

## 2. 集成者挂载清单

### 2.1 `apps/api/src/server.ts`（唯一待接线点）
挂在 `recoveryScheduler`/`sessionSweepScheduler` 那一档（**无条件启动**），不要挂进
`conversationObserverScheduler` 的 isConfigured 分支：

```ts
import { getDefaultRiskMonitorScheduler } from "./workers/risk-monitor.js";

// R14 批 RISK：风险巡检——纯规则判定不调 LLM，无条件启动（不做 isConfigured 门控）。
const riskMonitorScheduler = getDefaultRiskMonitorScheduler();
riskMonitorScheduler.start();

// shutdown() 里对称：
riskMonitorScheduler.stop();
```

### 2.2 已在本批收口、无需集成者动手的点
- `openapi.ts`/`app.test.ts`：governance PATCH/response 的 `risk_monitor` 文档与门已同步（见偏离 1）。
- 通知收件箱（schedule-notify-pages）：`project.risk_digest`+normal 落 `fyi` 桶的既有兜底分支，零改动验证过。
- 聊天渲染 `content.event='risk_digest'` 的专属卡片（`renderRiskDigestCardHtml`）归 **RISK-B** 工包；
  落地前桌面端会走 `renderSystemEventLineHtml` 的单行兜底（content 里给了 `summary` 键，兜底可读）。

### 2.3 冲突磁铁（与并行批同解）
- `packages/db/migrations/meta/_journal.json` 尾：本批 `idx=59`，FEEDBACK 批推定 0058——集成时按实际
  落地顺序重排 `when`（保持严格递增）。
- `packages/db/src/schema.test.ts` 尾断言：本批已钉 `0059`；若 FEEDBACK 先合，其 0058 内容断言与本批
  尾断言直接叠加即可（尾号恒 0059）。
- `packages/contracts/src/domain/conversation.ts`：本批只 additive 三处 governance 相关 schema，与
  FEEDBACK（独立 ai_feedback 表）理论无重叠。

## 3. 测试计数（前 → 后）

| 包 | 前 | 后 | 新增 | 备注 |
|---|---|---|---|---|
| `@workhub/contracts` | 132 | 136 | +4 | `r14-risk.test.ts` |
| `@workhub/db` | 326 | 334 | +8 | risk-monitor 仓库 6 + ai-settings riskMonitorJson upsert 1 + schema 0059 内容断言 1；2 skipped 为既有 PG 依赖 |
| `@workhub/api` | 1345 | 1372 | +27 | service 21（digest 文案/三信号正反例含排除谓词/幂等两道门/跨天 key/防御分支/失败隔离/无 LLM 依赖）+ worker 5（重入守卫/stats/假定时器/0 间隔禁用）+ ai-settings service 1；1 skipped 为既有 |
| `@workhub/desktop-webview` | 1025 | 1025 | 0 | 仅 fixture 机械补齐，无行为改动 |

覆盖任务书点名的全部场景：三信号正反例（含 active-run 排除、ai_working 不算临期未动工、冷启动 vs
放量分野、噪音双闸门）、digest 幂等（同日 resurfaced=false 真 no-op / resurfaced=true 刷新不重播 /
跨 UTC 天 key 换新）、worker 重入守卫、无 key 环境不哑火（deps 无 provider 依赖钉死）。
`pnpm -r typecheck` 全绿。

## 4. 偏离说明

1. **`openapi.ts` + `app.test.ts` 各一处 additive 改动（禁区文件）**。契约加 `risk_monitor` 后，
   `app.test.ts` 的「OpenAPI JSON request bodies stay aligned with zod input contracts」漂移门 +
   「governance response required 列表」断言必红——不改则 `@workhub/api` 测试无法全绿（验收硬门），
   改断言迁就又被纪律禁止且不对（文档是产品面、真的陈旧了）。故做了最小 additive 收口：openapi 加
   `riskMonitorSettingsSchema` JSON 形状 + PATCH body/response 各一个属性引用；app.test 的 required
   列表补一项。两处 hunk 都很小且远离路由挂载区，与集成者的 server.ts 接线不冲突。
2. **`apps/desktop-webview` 两个测试 fixture 机械补齐（禁区目录）**。`ProjectAiGovernanceVM` 加必填
   字段后 settings 的 render/view 测试内联 VM 字面量编译不过（`pnpm -r typecheck` 验收门）——照 MEM 批
   `proposals.test.ts` 同款先例补 `risk_monitor` 完整默认值对象，零行为改动；真正的设置分区 UI 归 RISK-B。
3. **候选查询多加一条 `workspace_id IS NOT NULL` 谓词**（设计伪代码没写）。schema 上 `projects.workspace_id`
   历史可空，加这道过滤让返回类型诚实标 `string` 而非断言；活跃项目恒有值，行为无差。
4. **`skipped_no_owner` 结构上恒 0**。设计的 stats 键保留了，但 owner 过滤已在 SQL 里做掉（也是设计
   §3.1 的写法），服务层这个计数只是不信任上游的防御兜底，如实注明。
5. **项目级配置读写端点：零新增**。设计 §2 拍板复用既有 ai-governance GET/PATCH，本批只做 additive
   字段（读侧默认值合并 + 落库能力），没有独立的 risk 配置路由——与任务书「设计稿没列就只做读侧默认值+
   落库能力」一致，如实报告。
6. **未做（防漂移，同设计 §7）**：LLM 润色（isConfigured 只在设计上预留，零代码路径）、逐条即时推送、
   工作区级风险总览、非 workitem 成本口径（curation/eval 团队账不算项目的钱）、已读回执状态机、
   打扰预算升维。桌面设置分区 + risk_digest 聊天卡渲染归 RISK-B（等 APPROVE-CHAT/FEEDBACK 的
   chat/render.ts 占地合入后串行发车，见头部集成裁定）。
