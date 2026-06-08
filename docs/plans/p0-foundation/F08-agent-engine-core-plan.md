---
component: F08
title: Agent 引擎核心(AgentLoop / ToolRegistry / 沙箱 / 预算 / AgentRun 持久化)— 系统级实现 plan
status: draft
depends: [F3, F5, F6, F7]
type: feat
date: 2026-06-05
origin: docs/plans/2026-06-05-feat-workhub-p0-foundation-master-plan.md
specs:
  - docs/workhub/02-ai-engine/agent-loop-and-tools.md
  - docs/workhub/02-ai-engine/confidence-risk-escalation.md
  - docs/plans/p0-foundation/_experience-deliverable-contracts.md
  - docs/plans/p0-foundation/_ts-first-module-port-page-alignment.md
inventory: docs/plans/p0-foundation/_migration-inventory.md §8 / §3
---

# F08 · Agent 引擎核心 — 系统级实现 plan

> 本组件是 P0 关键路径 `F1→F2→F3→{F5,F6,F7}→F8→{F9,F10}→F11` 的 **汇聚点**:把现有
> `app/services/auto_agent.py`(file-only 需求自动处理器)+ `app/routers/auto.py`(进程内
> `asyncio.create_task` 编排)**抽出、泛化、headless 化、持久化**为可被多 worker 并发驱动的
> Agent 引擎核心。安全敏感资产(沙箱前缀 / rlimit / 命令白名单 / 三竞态护栏)按 Master §6.4
> **逐字移植,禁止顺手重构**。
> **TS-first 修正**:旧 `auto_agent.py` 是行为锚点;新仓实现落 `packages/agent` / `packages/tools` / `apps/api/src/workers`,默认 TypeScript AgentLoop,Python 仅作可选文档 worker。
>
> 所有"现状如此"均以真实代码 `file:line` 为锚。权威字段定义在 data-model.md / agent-loop-and-tools.md,
> 本 plan 只给执行循环直接读写的切片;跨组件共享处以 Master §6 九铁律 + 规格为准。

---

## 目标

1. 把 `run_auto()`(`app/services/auto_agent.py:374`)的 `for turn in range(1, MAX_TURNS+1)`
   循环(`:405`)泛化为可复用的 **`AgentLoop`**,引入显式控制信号 `continue / stop / compact / escalate`
   (规格 agent-loop §3),完成判定从"调 `submit` 工具"(`:449`)改为"`end_turn` 且无 `tool_use`"
   (规格 agent-loop §2.3)。
2. 把模块级常量 `TOOLS`(`:51`,9 工具)+ 内联 `if name == …` dispatch(`:457`–`:497`)收敛为
   **`ToolRegistry`**(`{id, description, schema, execute, side_effect, min_scope}`,规格 §5.1),
   并按 actor 权限过滤可见工具(接入 F6,规格 §5.3)。
3. **整套沙箱逐字移植**:`_safe_path`(`:154`)/ `_enforce_sandbox_budget`(`:176`)/
   `_sandbox_rlimits`(`:268`,POSIX preexec_fn)/ `ALLOWED_COMMANDS`(`:42`)/ env 收窄(`:304`)/
   依赖安装禁令(`:296`),常量泛化为每运行 `RunBudget`(规格 §4.1)但数值不变。
4. 把瞬时 dataclass `AutoResult`(`:364`)/ `AutoOutcome`(`:591`)升级为持久实体
   **`AgentRun` / `AgentStep`**(规格 §1),trace 可审、可重放(FR-WORKER-002)。
5. 把 AI 执行从请求进程 `asyncio.create_task(_run_and_finalize)`(`app/routers/auto.py:103`)
   **移出为入队 + worker 取出** 的可恢复 `AgentRun`,**同时把现仅靠单 worker SQLite 的三竞态护栏
   迁到 PG 行锁/乐观锁**(Master §6.3 单→多 worker 成对铁律)。
6. 超预算/跑满步数从静默 `failed`(`:407/505`)改为 **`escalate` + 结构化交接件**
   `StructuredHandoff`(规格 §4.4,FR-WORKER-003)。
7. 新增 doom-loop 检测(规格 §3.3,FR-ESC-004)、瞬时错误退避重试尊重 `Retry-After`
   (规格 §8.3,NFR-06)、`compact` 上下文压缩(规格 §8.2)。
8. 事件 topic 从 `req:<id>` 演进为 `run:<run_id>`(规格 §6),经 F5 broker 跨 worker 扇出,
   订阅边界重强制隐私门(Master §6.5)。
9. 产物不只落 `outputs/` 文件,还要生成可审的 **`DeliverableChangeManifest` 草案**(写入 `Proposal.diff_manifest` 或交 F10/F11 消费),支持文档/表格/PPT/图片/文件夹/结构化记录,避免后续 Proposal UI 退化成代码 diff。

---

## 范围(Scope)

### In(F08 必做)

- `AgentLoop`(步循环 + 控制信号 + 完成判定 + 边界/失败出口表,规格 §2.2/§2.4/§3)。
- `ToolRegistry` + 9 个内置 `ToolSpec`(规格 §5.2),`visible_for(actor)` 过滤 + `execute` 二次校验。
- 沙箱/预算 **逐字移植**:`_safe_path` / `_enforce_sandbox_budget` / `_sandbox_rlimits` /
  `ALLOWED_COMMANDS` / 依赖安装禁令 / env 收窄 / `run_command` 经 `asyncio.to_thread`(`:479`)。
- `RunBudget` / `RunUsage`(规格 §4.1/§4.2),`check_budget()` 每步开头闸门(规格 §4.3)。
- `AgentRun` / `AgentStep` / `ToolCall` / `ToolResult` 实体与持久化(规格 §1),含 `AgentRun` 状态机
  (规格 §3.4)。
- 控制信号引擎:`continue / stop / compact / escalate`,优先级 `escalate > compact`(开头)、
  `stop > continue`(末尾)(规格 §3.2)。
- doom-loop 检测(指纹最近 N 步,默认 N=3,规格 §3.3)。
- 超预算/跑满步数 → `escalate` + `StructuredHandoff`(规格 §4.4)。
- 瞬时错误退避重试 + `Retry-After`(规格 §8.3)。
- `compact` 上下文压缩(规格 §8.2)。
- **AI 出请求进程进队列**:`POST /api/workitems/{id}/agent-runs`(api-contract §2.6)入 `AgentRun` 队列 → worker 取出执行;
  **三竞态护栏迁 PG 行锁/乐观锁**(start-CAS `auto.py:84`、settle-on-drift `auto.py:166`、
  revert-only-if-in-flight `auto.py:318`,规格 §3.5)。
- `llm_review`(`:544`)逐字移植为升级触发①的零件接口(裁决逻辑不在本组件,见 §依赖)。
- 事件 topic `run:<run_id>` + 截断纪律(预览 ≤200 字符,完整 trace 落 `AgentStep`,规格 §6.2)。
- `DeliverableChangeManifest` 草案生成:扫描 `outputs/`、AgentStep tool results、F10 snapshot/check refs,形成 `_experience-deliverable-contracts.md` §3 的最小 manifest;P0 不做完整 diff,但必须覆盖 fixture 类型。
- 单步快照 **钩子点**(`AgentStep.snapshot_id` 字段 + `side_effect` 工具执行前调用 F10 的
  `snapshot()`;**快照实现在 F10**,本组件只埋调用点与 fail-closed 红线接入,规格 §7 / Master §6.6)。
- token/cost 计量埋点(从 provider 注册表 F7 的 usage 累加进 `RunUsage`,规格 §4.2)。

### Out(明确推迟到 P1+)

- **置信度连续评分 + 风险二维裁决矩阵**(`ConfidenceRecord` 聚合算法、五维风险、阈值表、
  `verdict ∈ {auto_merge, human_spotcheck, escalate}`)——属 **P1 旗舰**,见
  `confidence-risk-escalation.md`;本组件只移植 `llm_review` 二值判分作为零件,**不**扩成连续置信度。
- **经理模式编排**(升级后派给谁、`pm` mode 工具集)——P2,见 `pm-mode-orchestration.md`;
  `AgentRun.mode` 字段建库但 `pm` 分支不实现。
- **打回带理由回灌闭环**(`RevisionRequest.reason_md` 注入下一轮 `messages`)——P1,
  confidence-risk-escalation §7.2;本组件 `AgentLoop` 的 `messages` 装配处预留注入点但不接线。
- **业务对象逆操作回滚 / 通用 Snapshot 实体**——属 **F10**;本组件只埋 `snapshot()` 调用点与
  "快照失败⇒拒绝副作用"接入,不实现快照载体/revert 契约。
- **HumanOnlyPolicy 三级开关**(`user_forbidden` 触发器)——P1,在 WorkItem 入 `ai_working` 前检查,
  属生命周期/权限,不在本组件循环内。
- **`compact` 的摘要保真调优 / token 计入口径**——MVP 实现阈值触发 + 朴素"保留近 K 步 + 早期摘要",
  调优是开放问题(agent-loop §10.3/§10.4/§10.6)。
- **多 Agent 智能派活 / 分支-提议-合并语义**——P2/P3(F8 只产出落分支的产物,不做合并)。
- **沙箱网络出口阻断(netns)**——继承现状残留风险,trusted-LAN 威胁模型接受(`auto_agent.py:276`);
  **D-3 上云前必须重审**(NFR-02),不在 P0。

---

## 现状 → 改动(按 PORT / REFACTOR / NEW 分组)

> 目标模块布局(新):`app/agent/loop.py`(AgentLoop)、`app/agent/registry.py`(ToolRegistry+ToolSpec)、
> `app/agent/sandbox.py`(逐字移植的沙箱/预算)、`app/agent/budget.py`(RunBudget/RunUsage/check_budget)、
> `app/agent/control.py`(控制信号 + doom-loop)、`app/agent/persistence.py`(AgentRun/AgentStep 读写 + 行锁)、
> `app/agent/queue.py`(入队 + worker 取出)、`app/routers/agent_run.py`(替 `auto.py`)。
> `auto_agent.py` / `auto.py` 拆解后删除(F11 客户端改接同步改名端点)。

### PORT(安全敏感 — 逐字移植,禁止重写)

| # | 现状锚点 | 迁移动作 | 铁律 |
|---|---|---|---|
| P1 | `_safe_path()` `auto_agent.py:154` | 原样移入 `app/agent/sandbox.py`,签名/语义不变(`resolve()` 后必须落 `workdir` 内,否则 `ValueError`) | §6.4 |
| P2 | `_sandbox_rlimits()` + `_set_rlimit()` `auto_agent.py:257/268` | 原样移植(`RLIMIT_CPU=120` / `RLIMIT_AS=2GiB` / `RLIMIT_FSIZE=256MiB` / `RLIMIT_NOFILE=512`;`RLIMIT_NPROC` 故意不设;POSIX-only,Windows no-op) | §6.4 |
| P3 | `ALLOWED_COMMANDS` `auto_agent.py:42` + 依赖安装禁令 `:296` + 命令白名单校验 `:294` + null-byte 检查 `:301` + env 收窄 `:304`(`PATH/PYTHONPATH/HOME/TMPDIR→workdir`,`NO_COLOR=1`) | 原样移植,`shell=False` 不变 | §6.4 |
| P4 | `_enforce_sandbox_budget()` `auto_agent.py:176` + `_sandbox_stats()` `:163` | 原样移植;在每个**写类**工具后调用(`write_file/write_base64_file/move_path/run_command/zip_path/mkdir`),超 `max_files/max_bytes` → `ValueError` → 转 `is_error` 回灌 | §6.4 |
| P5 | `run_command` 经 `asyncio.to_thread`(`auto_agent.py:479`,注释 `:475`) | 必须保持 off-loop;`subprocess.run` 最长阻塞 60s,内联会冻结所有 SSE 流/请求 | §6.3(多 worker 不放松) |
| P6 | 9 工具实现体 `_tool_*`(`:184`–`:359`) | 逐字移入 registry 的 `execute`;路径前缀/budget 调用点不变 | §6.4 |
| P7 | `llm_review()` `auto_agent.py:544` + `REVIEW_SYSTEM` `:535` + 容错解析 `:574-586`(剥 ```` ```json ````、`json.loads` 失败判最低分) | 原样移植为升级触发①零件;改接 F7 provider 注册表(替 `_client`) | §6.9 |
| P8 | 三竞态护栏逻辑 `auto.py:84`(start-CAS)、`:166`(settle-on-drift)、`:318`(revert-if-in-flight) | **语义逐字保留**,仅把 SQLite 隐式单写锁替换为 PG `SELECT … FOR UPDATE` / `version` 乐观锁(规格 §3.5,见 NEW N6) | §6.3 / §6.4 |
| P9 | `_preload_inputs()` `auto_agent.py:603`(附件去重命名拷进 `inputs/`) | 原样移植为只读源材料预载;附件源从 `Attachment`(`auto.py:123`)改 WorkItem 附件 | — |
| P10 | queue-in-tx / flush-post-commit 通知铁律(`auto.py:223-234` 调 `queue_status_notifications` / `flush_status_notifications`,`lifecycle.py:104/164`) | 原样沿用:事务内 `queue`,commit 后 `flush`;私有按身份 `user:{id}` 永不 `all` | §6.7 |

### REFACTOR(泛化 — 行为等价或受控演进)

| # | 现状锚点 | 改动 |
|---|---|---|
| R1 | `run_auto()` `auto_agent.py:374` 主循环 `:405` | → `AgentLoop.run(agent_run)`(规格 §2.2 伪代码),每步产出恰好一个控制信号 |
| R2 | 完成判定:`submit` 分支 `:449` + `end_turn` 无工具判 `failed` `:501` | → `end_turn` 且无 `tool_use` = **完成(`stop`)**;`submit` 降级为可选收尾标注(写 `final_notes`);空产物 + 自然停止 → `failed`("AI 没产出交付物",规格 §2.3) |
| R3 | `TOOLS` 常量 `:51` + dispatch `:457` | → `ToolRegistry` + `ToolSpec`(规格 §5.1);schema 校验提前到 dispatch 前;未知/越权 → `is_error` 回灌"tool not available",循环继续(`:488` 语义保留) |
| R4 | 模块级 `_client = AsyncAnthropic(...)` `auto_agent.py:34` + `messages.stream` `:413` + `messages.create`(review)`:558` | → 经 **F7 `registry.get(actor, task)`**;`.stream`/`.create` 调用签名不变;每响应 `usage` 累加进 `RunUsage`(§6.9 provider 单出口) |
| R5 | 常量 `MAX_TURNS=15` `:36` / `TOTAL_TIMEOUT_DEFAULT=300` `:37` / `COMMAND_TIMEOUT=45` `:40` / `MAX_SANDBOX_FILES/BYTES` `:38-39` | → 每运行 `RunBudget`(规格 §4.1),**默认值不变**;`per_step_timeout = max(30, total - elapsed)`(`:424`)保留 |
| R6 | 超预算 `_result(False,"总耗时超过预算")` `:407` + 跑满轮次 `:505` | → `escalate` + `StructuredHandoff`(规格 §4.4),**不静默截断**;`AgentRun.status = escalated` |
| R7 | 事件 `ai.*` 全发 `req:{id}`(`:400/438/440/444/507`) | → topic `run:<run_id>`(per-run trace)+ `workitem:<id>`(演进自 `req:<id>`,api-contract §5.3 拼写无下划线);经 F5 broker;私有按身份隔离(Master §6.5) |
| R8 | `auto.py` 直写 `Requirement.status = "delivered"/"ready"`(`:212/244`) | → 经统一 lifecycle 中枢落库(规格 §0 表 / agent-loop §3.4 与 WorkItem 状态机的关系);本组件只产出 `AgentRun.status` 终态,WorkItem 转移交 F9/lifecycle |
| R9 | `_resume_stuck_jobs` 的 `ai_processing` 15 分钟 cutoff 清扫(`main.py:116/166`,naive `utcnow`) | → 语义移入 **AgentRun worker 心跳 + lease 过期回收**;多 worker 下需 leader 选举(F11);时间用 `timestamptz`(Master §6.2,消灭 naive `utcnow`) |
| R10 | `requirement_id` 命名(`auto.py` 全程) | → `work_item_id`(Master `requirements→work_items` 改名,F2 牵动 15+ 表 FK) |

### NEW(净新增 — 规格要求,现状无)

| # | 新增 | 规格依据 |
|---|---|---|
| N1 | `AgentRun` / `AgentStep` / `ToolCall` / `ToolResult` 实体 + Drizzle 迁移(替瞬时 dataclass `AutoResult`/`AutoOutcome`) | agent-loop §1,FR-WORKER-002 |
| N2 | 显式控制信号引擎 `continue/stop/compact/escalate` + 优先级判定(`app/agent/control.py`) | agent-loop §3.1/§3.2 |
| N3 | doom-loop 检测:`fingerprint(step)`(工具序列 + 规范化 input 的稳定哈希)+ ring(len=N,默认 3),连续 N 步同指纹 → `escalate` | agent-loop §3.3,FR-ESC-004 |
| N4 | `compact` 上下文压缩:`approaching_context_window`(阈值 0.8)+ `compact_context`(保留近 K 步 + 早期摘要) | agent-loop §8.2 |
| N5 | 瞬时错误(429/5xx/连接重置)退避重试 + 尊重 `Retry-After`;永久(4xx)立即 `failed` | agent-loop §8.3,NFR-06 |
| N6 | **AgentRun 队列**(入队 + worker 取出,替 `asyncio.create_task`)+ **行锁/乐观锁竞态护栏**(`SELECT … FOR UPDATE` + `version`)+ lease 心跳 | inventory §3 RISK / §8 RISK,规格 §3.5,Master §6.3 |
| N7 | `StructuredHandoff`(done/remaining/next_steps/blockers/artifacts/budget_hit),引擎用 trace 自动生成(即便模型未配合) | agent-loop §4.4,FR-WORKER-003 |
| N8 | 单步快照**钩子点**:`AgentStep.snapshot_id` + `side_effect` 工具执行前调 F10 `snapshot()`;快照失败 → 拒绝副作用(fail-closed) | agent-loop §7,Master §6.6(实现在 F10) |
| N9 | token/cost 计量:`RunUsage.tokens_in/out/cost` 从 provider 响应 usage 累加;`check_budget` 增 `max_cost` 闸门 | agent-loop §4.2/§4.3,NFR-05 |
| N10 | AI actor 一等身份接入:`registry.visible_for(actor_id)` 用真 actor(替现 `auto.py:224` 伪造 `User(id="ai-auto")`),由 F4 `require_actor` 注入 | inventory §5 REFACTOR,规格 §5.3 |
| N11 | `DeliverableChangeManifest` 草案生成器:`outputs/` + business writes + snapshot/check refs → `Proposal.diff_manifest` JSONB;至少覆盖 docx/pptx/xlsx/image/folder/structured_record fixture | `_experience-deliverable-contracts.md` §3 |
| N12 | `ToolSpec.side_effect` 细分:`none|sandbox_file|business_write|external_effect`;F10 未就位时 side-effect 工具硬拒绝,只读工具可跑 | `_experience-deliverable-contracts.md` §5 |

---

## 数据与接口契约

> 权威字段定义在 data-model.md / agent-loop-and-tools.md §1;此处给执行循环直接读写的切片 +
> 本组件落地的迁移/接口/事件。跨组件共享(WorkItem 状态机、ConfidenceRecord、Snapshot、PermissionPolicy)
> 以 Master + 对应规格为准。

### 实体字段(本组件新建,Drizzle 迁移落库)

**`AgentRun`**(演进自 `AutoResult`/`AutoOutcome`,agent-loop §1.1):
```
id            str(32) PK = uid()
work_item_id  FK → WorkItem(演进自 Requirement, models.py:314)
branch_id     FK → Branch(F2 新增;P0 可先 nullable,单分支默认)
actor_id      FK → actor(AI 系统账户或代某用户;决定可见工具集)
mode          enum  worker | pm        # P0 仅 worker
status        enum  queued|running|compacting|awaiting_approval|delivered|escalated|failed|cancelled
control        enum  continue|stop|compact|escalate   # 最近一次
budget        JSONB (RunBudget)        # max_steps/total_timeout_s/per_step_timeout_s/max_tokens/max_cost/max_files/max_bytes/command_timeout_s
usage         JSONB (RunUsage)         # steps_used/seconds_used/tokens_in/tokens_out/cost/files_count/bytes_used
step_cursor   int                      # = 现状 turn
workdir       str                      # 沙箱根(演进自 settings.data_dir/auto/<req_id>)
base_snapshot str | null               # 执行前基线快照 id(F10)
final_notes   str | null               # 演进自 submit.notes / AutoResult.notes
outcome_reason str | null              # 演进自 AutoResult.reason
lease_owner   str | null               # worker 心跳租约(N6,替 15 分钟 cutoff)
lease_expires_at timestamptz | null
version       int                      # 乐观锁(Master §6.2)
created_at / updated_at / ended_at: timestamptz
```

**`AgentStep`**(agent-loop §1.2,trace 最小单元,FR-WORKER-002):
```
id          str(32) PK
run_id      FK → AgentRun
index       int                  # 1-based,= 现状 turn
request     JSONB                # 发给模型的 messages 增量(可裁剪存档)
assistant   JSONB                # 模型返回 content blocks(thinking/text/tool_use)
tool_calls  JSONB (list[ToolCall])
control     enum                 # 本步推导的控制信号
snapshot_id str | null           # 副作用前快照(N8);只读步为 null
stop_reason str                  # 透传模型 stop_reason: tool_use|end_turn|max_tokens|…
started_at / ended_at: timestamptz
duration_ms int
```

`ToolCall {id, tool_id, input(JSONB), visible}` / `ToolResult {tool_use_id, ok, content, is_error}`
(agent-loop §1.3)。**现状对照**:`auto_agent.py:493` 构造的 `{type:tool_result, tool_use_id, content}`
即 `ToolResult` 最小形态;现把错误编码进 `content`("[error] …"),本组件显式化 `is_error`,语义不变
(错误可恢复、回灌、绝不崩)。

**`ToolSpec`**(agent-loop §5.1,registry 注册项):`{id, description, schema, execute(input,ctx)→ToolResult,
side_effect: bool, min_scope: PermScope}`;`ctx` 携带 `workdir/actor/run_id/snapshot_handle`。

### Drizzle migration(Master §6.2)

- 新表 `agent_runs` / `agent_steps`,全部 `timestamptz`(禁 naive `utcnow`)、JSON 列用 `JSONB`、
  PK `String(32)`→PG `UUID`(随 F3 类型审校口径)。
- 可变实体带 `version`(乐观锁)、`deleted_at`(软删)。
- 索引:`agent_runs(work_item_id)`、`agent_runs(status, lease_expires_at)`(stuck 清扫偏索引,替 R9 的
  cutoff 全表扫)、`agent_steps(run_id, index)`、`agent_runs(branch_id)`;`WHERE deleted_at IS NULL` 偏索引。
- 无 `create_all` / 运行时 ALTER(Master §8 功能门禁)。

### API(**路径以 [api-contract §2.6] `agent-run` 路由组为单一真相**;F11 客户端改接同步,改名 `requirements→workitem`)

> 路径口径对齐(改正点):api-contract §1/§2.6 的 `agent-run` 组用 **RESTful 集合复数** `/api/workitems/{id}/agent-runs`、`/api/agent-runs/{id}`;F08 此前用单数 `/workitem/{id}/run`、`/agent-run/{run_id}` 已纠正为契约拼写。`abort` 动词亦对齐契约(§2.6 用 `/abort`)。

| 端点 | 替代 | 语义 |
|---|---|---|
| `POST /api/workitems/{id}/agent-runs` | `POST /api/requirements/{id}/auto-process`(`auto.py:54`) | `{mode?}` 校验 + **start-CAS 行锁** → 建 `AgentRun(queued)` 入队 → 202 + `{ok, status, run_id, job_id}`(不再 `asyncio.create_task`) |
| `GET /api/agent-runs/{id}` | (新) | 读 `AgentRun`(状态、预算用量、ConfidenceRecord 引用) |
| `GET /api/agent-runs/{id}/trace` | (新) | 读 steps trace(`?after=<step>`,可重放,FR-WORKER-002) |
| `POST /api/agent-runs/{id}/abort` | (新) | 协作取消(settle-on-drift);submitter/admin |
| `GET /api/agent-runs/{id}/handoff` | (新) | 读 `StructuredHandoff`(escalated 时) |

> **ask 审批回复不在本组件出端点**:走 **F6** 的 `POST /api/approvals/{id}/respond`(api-contract §2.8,带 `decision/reason_md/remember`);F08 只在 worker loop 内消费裁决到达信号(`awaiting_approval` → resume / `is_error` 回灌),审批路由/SLA 在 F6。
> start-CAS 契约**逐字保留**:`UPDATE … WHERE status IN (可启动态) ... rowcount==0 → 409`
> (`auto.py:84-93`),仅落地为行锁/乐观锁。

### 事件 topic + type(经 F5 broker 扇出;**SSE 事件 type 权威以 [api-contract §5.2] 为准**,topic 隔离以 §5.3 为准)

> 命名口径:早期文档里的 `agent.run.step` / `proposal.ready` 属概念别名。**F08 落地以 `_experience-deliverable-contracts.md` §4 的正式事件名为准**,下表用正式拼写。topic 命名(`run:<run_id>`/`workitem:<id>`/`user:<id>`)以 api-contract §5.3 + F05 topic 注册表为准;F05 只提供 topic+扇出+订阅鉴权,事件由 F08 发布。

| 事件 type | topic | data 切片 | 现状对应 |
|---|---|---|---|
| `agent_run.started` | `run:<run_id>` | `{run_id, budget}` | `ai.started` `:400` |
| `agent_run.step`(逐步 trace) | `run:<run_id>` | `{index, kind, preview(≤200)}` | `ai.thinking/text/tool_call` `:438/440/444` |
| `step.tool_result` | `run:<run_id>` | `{index, tool_id, ok, content_preview}` | (新增) |
| `step.snapshot` | `run:<run_id>` | `{index, snapshot_id}` | (新增,N8) |
| `permission.ask` | `session:<id>` + `user:<被路由审批人 id>` | `{approval_id, tool_id, input, reason, ttl}` | (新增,接 F6) |
| `agent_run.compacting` | `run:<run_id>` | `{index, reason}` | (新增,N4) |
| `agent_run.escalated` | `workitem:<id>` + 目标人 `user:<id>`(脱敏) | `{trigger, headline, handoff_ref}` | 派生自 `ai.failed` |
| `proposal.opened` | `workitem:<id>` + `user:<approver>` | `{proposal_id, manifest_ref, summary}` | manifest 草案就绪(N11) |
| `proposal.merged` | `run:<run_id>` + `workitem:<id>` | `{final_notes, file_count}` | `ai.done`+`requirement.updated` `:235` |
| `agent_run.failed` | `run:<run_id>` | `{reason, notes}` | `ai.failed` `:259` |
| `agent_run.step`(done 收尾,成败均发) | `run:<run_id>` | `{run_id, steps}` | `ai.done` `:507`(`finally` 必发) |

> **`permission.ask` topic 对齐(改正点)**:api-contract §5.3 与 F09 明确——`permission.ask` 走 `session:<id>` + 被路由审批人 `user:<id>`,**不另立 `permission:*` 命名空间**;F08 接 F6 的审批阻塞原语时按此发布(此前误写 `permission:<approver>` 已纠正)。`agent_run.escalated` 走 `workitem:<id>` + 目标人 `user:<id>`,**不发 `all`**(含 `trigger` 等私有细节);若需 org 级感知,另发脱敏 `headline`(不含 trigger 原值)。
> 截断纪律(Master §6.8 / agent-loop §6.2):事件载荷只放预览(≤200 字符,沿用 `:438`);完整 trace 落
> `AgentStep`,前端按需拉。隐私门(Master §6.5):`run:<id>` 仅 owner/审批人可订阅,在**订阅边界**重强制
> `can_view`,禁"全量发 Redis 客户端过滤"。`proposal.opened`/`knowledge.evidence.ready` 等由 F10/P1 对应组件发,不在本组件。

---

## 实施步骤(有序可勾选)

### 阶段 A — 沙箱/工具逐字移植(无行为变更,先建回归基线)
- [ ] A1. 新建 `app/agent/sandbox.py`,**逐字移植** `_safe_path` / `_sandbox_stats` /
      `_enforce_sandbox_budget` / `_set_rlimit` / `_sandbox_rlimits` / `ALLOWED_COMMANDS` /
      `_tool_run_command`(含依赖安装禁令、null-byte、env 收窄、`to_thread`)(PORT P1–P6)。
- [ ] A2. 新建 `app/agent/registry.py`:`ToolSpec` + `ToolRegistry`;9 个内置工具 `execute` 体从
      `_tool_*`(`:184-359`)原样搬入(REFACTOR R3,PORT P6)。
- [ ] A3. 移植 `_preload_inputs`(P9)。
- [ ] A4. **回归测试基线**:沙箱逃逸(`../`、绝对路径 → `ValueError`)、命令白名单拒绝、依赖安装拒绝、
      文件/字节预算超限、`to_thread` 不阻塞(Master §8 沙箱逐字移植门禁)。

### 阶段 B — 实体 + 持久化 + Drizzle migration
- [ ] B1. 定义 `AgentRun` / `AgentStep` 模型(F2 风格,带 `version`/`deleted_at`/`timestamptz`)。
- [ ] B2. 写 Drizzle 迁移(up/down 可逆,Master §10 测试策略);加索引(见数据契约)。
- [ ] B3. `app/agent/persistence.py`:run/step CRUD + `version` 乐观锁封装。

### 阶段 C — AgentLoop + 控制信号 + 预算(核心)
- [ ] C1. `app/agent/budget.py`:`RunBudget`(默认值 = 现状常量,R5)/ `RunUsage` / `check_budget()`
      闸门(规格 §4.3)。
- [ ] C2. `app/agent/control.py`:四信号判定 + 优先级(`escalate>compact` 开头、`stop>continue` 末尾,
      规格 §3.2)+ doom-loop `fingerprint`/ring(N3)。
- [ ] C3. `app/agent/loop.py`:`AgentLoop.run()` 按规格 §2.2 伪代码;完成判定改 `end_turn` 无工具(R2);
      provider 经 F7 注册表(R4)+ usage 累加(N9);每步 persist `AgentStep`。
- [ ] C4. 边界/失败出口表(规格 §2.4)全覆盖:单步超时 → `failed`;瞬时 429/5xx → 退避 + `Retry-After`
      (N5);schema 不合法/越权 → `is_error` 回灌 + 继续;`max_tokens` → `compact`/重试。
- [ ] C5. `compact` 实现(N4):阈值 0.8 + 保留近 K 步 + 早期摘要 + 发 `run.compacting`。
- [ ] C6. 超预算/跑满步数 → `escalate` + `StructuredHandoff`(N7,引擎用 trace 自动生成)。
- [ ] C7. 单步快照钩子(N8):`side_effect` 工具执行前调 F10 `snapshot()`;**快照失败 → 拒绝副作用**
      (fail-closed,Master §6.6);写 `AgentStep.snapshot_id`;只读步跳过。
- [ ] C8. `ToolSpec.side_effect` 细分(N12):`none` 工具可在 F10 未就位时跑;`sandbox_file/business_write/external_effect` 在 F10 stub 失败时硬拒绝;`external_effect` 默认 ask-gate。
- [ ] C9. `DeliverableChangeManifest` 草案生成(N11):完成时扫描 `outputs/` 与业务写 trace,生成 manifest JSON;无法识别的产物也必须有 sha/download/human_summary。

### 阶段 D — 出请求进程进队列 + 三竞态护栏(单→多 worker)
- [ ] D1. `app/agent/queue.py`:入队(Redis/PG,与 F5 broker 复用)+ worker 取出 + lease 心跳。
- [ ] D2. `app/routers/agent_run.py`:`POST /api/workitems/{id}/agent-runs` 做 **start-CAS 行锁**(P8/N6,逐字保留
      `auto.py:84` 的 `WHERE status IN (…)` + `rowcount==0→409`),建 `AgentRun(queued)` 入队。
- [ ] D3. worker finalize 路径移植 settle-on-drift(`auto.py:166`)与 revert-if-in-flight(`auto.py:318`)
      为**行锁/乐观锁**复查:落交付前确认 run/WorkItem 仍 in-flight,漂移则不写产物/不发 org 通知/settle 为
      "已结束但跳过"(规格 §3.5)。
- [ ] D4. lease 过期回收替 `_resume_stuck_jobs` 的 15 分钟 cutoff(R9);多 worker leader 选举挂接 F11。
- [ ] D5. WorkItem 状态转移经 lifecycle 中枢(R8),通知走 queue-in-tx/flush-post-commit(P10);AgentRun
      终态 → WorkItem 转移交 F9。

### 阶段 E — 事件 + actor + review 接线
- [ ] E1. 事件改 topic `run:<run_id>` + 截断纪律(R7),经 F5 broker;订阅边界重强制隐私门。
- [ ] E2. AI actor 一等身份(N10):`visible_for(actor_id)` + `execute` 二次 `min_scope`/`ask` 校验
      (接 F6);替 `auto.py:224` 伪造 actor。
- [ ] E3. `llm_review` 移植(P7)接 provider 注册表,作升级触发①零件(裁决在 P1)。
- [ ] E4. 事件 type 全部引用 F05 正式事件常量;grep 新增代码无 `agent.run.started`/`proposal.ready` 旧概念名。
- [ ] E5. 删除 `auto_agent.py` / `auto.py`;F11 同步改名端点 + 客户端 hook。

### 阶段 F — 集成验收
- [ ] F1. 端到端:一条 WorkItem 经引擎产出 → `llm_review` 判分 → `AgentRun/AgentStep` 持久化且可重放
      (Master §8)。
- [ ] F2. 2-worker 冒烟:并发触发同一 WorkItem,start-CAS 行锁仅一个成功(另 409);无重复 run/通知。
- [ ] F3. 超预算/doom-loop → `escalated` + `StructuredHandoff`,非静默 fail。

---

## 验收用例(可测)

1. **完成判定改写**:模型把交付写入 `outputs/` 后 `end_turn` 不调 `submit` → 判 **delivered**(现状会误判
   `failed`,`:501/503`);`end_turn` 且 `outputs/` 空 → `failed`("AI 没产出交付物")。
2. **沙箱逐字移植回归**(Master §8):`read_file("../../etc/passwd")` / 绝对路径 → `ValueError("path escapes
   workdir")`,转 `is_error` 回灌、循环不崩;`run_command(["rm","-rf"])` → "command not allowlisted";
   `npm install` → "dependency installation is disabled";写文件超 `MAX_SANDBOX_FILES/BYTES` → budget `ValueError`。
3. **控制信号优先级**:预算耗尽 + 窗口压力同时命中 → 产出 `escalate`(非 `compact`,规格 §3.2);
   本步有 `tool_use` → `continue`;`end_turn` 无工具 → `stop`。
4. **doom-loop**:构造连续 3 步 `read_file(同一文件)` → `escalate(reason=doom_loop)`;`write_file` 内容不同的
   3 步 → **不**触发(规范化 input 区分,规格 §3.3)。
5. **超预算结构化交接**(FR-WORKER-003):跑满 `max_steps` 或超 `total_timeout_s` → `AgentRun.status=escalated`
   + `StructuredHandoff{done/remaining/next_steps/blockers/artifacts/budget_hit}` 非空(即便模型未自觉写交接)。
6. **瞬时重试**(NFR-06):mock provider 返回 429 + `Retry-After: 2` → 退避重试,`AgentRun` 保持 `running`,
   不立即 `failed`;4xx 鉴权错 → 立即 `failed` 不重试。
7. **start-CAS 行锁(多 worker)**:2 个并发 `POST /api/workitems/{id}/agent-runs` → 恰一个建 run(200),另一个 409;
   不产生重复 `AgentRun` / 重复通知(逐字保留 `auto.py:84` 语义,迁行锁后仍成立)。
8. **settle-on-drift**:run 执行中把 WorkItem 置 `cancelled` → finalize **不**写产物、**不**发 org 通知、
   run settle 为 `cancelled`(规格 §3.5,`auto.py:166`)。
9. **revert-if-in-flight**:delivery 已 commit 后 finalize 末段抛错 → `_mark_auto_failed` 不覆盖
   `delivered`、只 settle job(逐字保留 `auto.py:318` 语义)。
10. **trace 可审/可重放**(FR-WORKER-002):一次 run 后 `GET /api/agent-runs/{id}/trace` 返回有序 steps,含
    `request/assistant/tool_calls/stop_reason`;事件预览 ≤200 字符,完整内容只在 DB。
11. **provider 单出口**(Master §6.9 / §8):grep 本组件无裸 `AsyncAnthropic(`;`RunUsage.tokens_in/out/cost`
    随每次调用累加。
12. **快照 fail-closed 钩子**(Master §6.6):mock F10 `snapshot()` 抛错 → `side_effect` 工具被拒绝执行、
    回 `is_error`,**不**落副作用(快照实现在 F10,本用例验钩子接入)。
13. **review 容错移植**:`llm_review` 收到非 JSON 输出 → 判最低分(保守),不崩(逐字保留 `:585`)。
14. **lease 回收**:worker 持 run lease 后崩溃 → lease 过期被另一 worker 回收转终态(替 15 分钟 cutoff,R9);
    无 run 永久卡 `running`。
15. **交付物 manifest fixture**:构造 docx/pptx/xlsx/image/folder/structured_record 六类产物/业务写,完成后 `DeliverableChangeManifest` 含对应 `target_kind`、sha/preview/download、risk、rollback/checks。
16. **正式事件名**:新增 publish 点只发 `agent_run.started`/`agent_run.step`/`agent_run.escalated`/`proposal.opened` 等正式名;旧概念名只在 alias 测试/注释出现。

---

## 回滚与风险

**回滚策略**:本组件全程在新模块 `app/agent/*` + 新端点 `agent_run.py` 落地,`auto_agent.py`/`auto.py`
直到阶段 E4 才删除。任一阶段失败可回退到旧路径(旧端点暂留双跑)。Drizzle 迁移 up/down 可逆
(Master §10),回滚即 `downgrade`。发布前 daemon `--workers 1`(Master §6.3),2-worker 冒烟过门禁后再开 N。

| 风险 | 缓解 |
|---|---|
| **沙箱 rlimit 仅 POSIX**(`auto_agent.py:22/280` Windows no-op) → 生产无进程层边界 | **生产须 Linux**(inventory §8 RISK);CI 在 Linux 跑沙箱回归;Windows 仅开发,文档明示;部署门禁校验 `resource` 可用 |
| **三竞态护栏从单 worker SQLite 隐式锁迁 PG 行锁**,迁错 → 多 worker 下重复执行/孤儿状态 | 逐字保留语义(P8),仅换锁原语;precedence 用例 7/8/9 覆盖;2-worker 冒烟为门禁 |
| **完成判定改写**(submit→end_turn)可能放过"答非所问但有产物" | 产物非空仍校验;质量由 `llm_review`(P1 置信度)兜底;开放问题(agent-loop §10.1)标注,P0 仅做产物存在性 |
| **快照红线接入 F10 未就位** → side_effect 工具无快照即落库,违 Master §6.6 | 本组件埋 fail-closed 钩子(N8);F10 未上线前 `side_effect` 工具的 snapshot() 返回桩 → 桩失败即拒绝(宁拒不漏);用例 12 守 |
| **broker 化跨用户事件泄漏**(NFR-08 有前科) | `run:<id>` 订阅边界重强制 `can_view`(Master §6.5);org 级只发脱敏 `agent_run.escalated`;不"全量发客户端过滤" |
| **naive `utcnow` 迁 timestamptz** 静默出错(stuck 清扫永不/全触发) | R9 lease 用 `timestamptz`;F3 时间审校口径;用例 14 守 lease 回收 |
| **token/cost 计入口径未定**(重试/压缩自身 token 是否计) | MVP 全计入 `max_cost`,标为开放问题(agent-loop §10.6),P1 调 |
| **doom-loop 误判合法重试** | 指纹规范化排除已知幂等/退避重试;N 可经策略覆写(默认 3);用例 4 守 |
| **AgentRun 队列与 F5 broker 耦合**:F5 未就位则无跨 worker | F8 依赖 F5(汇聚点);F5 未上线时队列退化为 PG 表轮询 + `--workers 1`,不阻塞单 worker 端到端冒烟 |

---

## 依赖与被依赖

**依赖(上游,F08 是汇聚点):**
- **F3 PostgreSQL+Drizzle** — `AgentRun/AgentStep` 落库、行锁/乐观锁、`timestamptz`、JSONB(成对解除单 worker)。
- **F5 事件 bus→broker** — `run:<run_id>` 跨 worker 扇出 + 订阅边界隐私门 + AgentRun 队列后端。
- **F6 权限引擎** — `ToolRegistry.visible_for(actor)` 过滤 + `execute` 二次 `min_scope`/`ask` 阻塞原语
  (`awaiting_approval` 入口);审批路由/SLA/合并算法在 F6,本组件只接"过滤 + 阻塞 + 回灌"契约。
- **F7 LLM provider 注册表** — `registry.get(actor, task)` 替 `_client`(R4);token/cost 计量喂 `RunUsage`。
- **F4 鉴权身份**(间接,经 F6)— AI actor 一等身份 `require_actor`(N10)。
- **F2 实体模型** — `requirements→work_items` 改名(R10)、`Branch` FK、`version`/`deleted_at` 列。

**被依赖(下游):**
- **F9 生命周期/通知** — 消费 `AgentRun` 终态(delivered/escalated/failed/cancelled)驱动 WorkItem 状态转移
  + 登记 `escalated/pm_mode/in_review/merged` 进 `_MILESTONES`(R8/P10)。
- **F10 审计/快照/回滚** — 实现本组件埋的 `snapshot()` 钩子(N8)+ `revert` 契约 + 同事务快照红线;
  `AuditLog` 记 AI 副作用。
- **F11 daemon 拆分/客户端改接** — 暴露 `/api/workitems/{id}/agent-runs`、`/api/agent-runs/{id}`、SSE `run:<id>`;改名端点
  + OpenAPI 类型化客户端;周期任务 leader 选举(D4)。
- **P1 confidence-risk-escalation** — 在本组件 `llm_review`(P7)+ `AgentStep` trace 之上扩连续置信度 +
  风险二维裁决 + 回灌闭环 + doom-loop/budget 触发器裁决(本组件只产 `escalate` 信号 + handoff,不裁决)。
- **P2 pm-mode-orchestration** — 消费 `AgentRun.mode=pm` + `EscalationEvent`(本组件建 `mode` 字段但不实现 pm)。

---

## Target TS paths

> 本组件施工时,旧 `auto_agent.py` / `routers/auto.py` / `llm_review` 是 loop 与工具行为来源;新实现落 TS AgentLoop、ToolRegistry、queue worker 与 typed page/route。

| 类别 | 目标路径 | 必须产物 | 审计门禁 |
|---|---|---|---|
| loop | `packages/agent/src/loop/*` | `AgentLoop`, control signals, structured handoff | 超预算不静默 failed |
| tools | `packages/tools/src/*` | ToolSpec、schema parse、sandbox file tools | side-effect 前 permission/snapshot gate |
| runner | `apps/api/src/workers/agent-runner.ts`, `apps/api/src/routes/agent-runs.ts` | queue runner、start/resume/cancel endpoints | AgentStep 持久化 |
| replay/page contracts | `packages/contracts/src/agent.ts`, `apps/api/src/pages/agent-runs.ts` | `AgentRunTraceVM`, `ReplayTraceVM`, `BudgetNotice` | Replay fixture 过门 |
| cost consumption | `packages/cost/src/decision.ts` | consume `BudgetDecision` → `RunBudget` | AgentLoop 不硬编码三级配额 |

**PR 必答**:列出本 PR 解禁的 tool side_effect 等级。F10 未就位前所有写类工具必须 fail-closed。
