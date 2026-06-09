---
module: P-AI
layer: L2
status: 🚧
owner: workflow
related:
  - ../../prd/2026-06-04-workhub-prd.md
  - ../README.md
  - ../01-architecture/system-architecture.md
  - ../01-architecture/data-model.md
  - ../01-architecture/api-contract.md
  - ../00-overview/glossary-dejargon.md
  - ./confidence-risk-escalation.md
references:
  - app/services/auto_agent.py
  - app/prompts/auto_agent.md
  - app/routers/auto.py
  - app/services/push_bus.py
---

# AI 工人引擎与工具系统(Agent Loop & Tools)

> 本篇定义 **L2 执行层** 的核心机制:一个 `AgentRun`(AI 自治执行)如何被一个 **headless** 的 worker loop 驱动到完成或受阻。深度=接口/机制级。
>
> 范围:工人执行循环 · 控制信号(`continue/stop/compact/escalate`)· 完成判定 · 工具契约 `{id, 描述, schema, execute}` 与注册表(按 actor 权限过滤)· 沙箱与预算 · doom-loop 检测 · 每步快照与回滚。
>
> **不在本篇**:置信度/风险评分与三触发器的裁决逻辑(见 [`confidence-risk-escalation.md`](./confidence-risk-escalation.md));经理模式编排(见 [`pm-mode-orchestration.md`](./pm-mode-orchestration.md));权限策略合并与审批路由(见 [`../01-architecture/security-and-permissions.md`](../01-architecture/security-and-permissions.md));实体全字段与状态机全转移(见 [`../01-architecture/data-model.md`](../01-architecture/data-model.md));事件全清单与鉴权(见 [`../01-architecture/api-contract.md`](../01-architecture/api-contract.md))。本篇只展开与执行循环强相关的契约切片,交叉处用相对链接引用,不重复长篇。
>
> 术语遵循 [`glossary-dejargon.md`](../00-overview/glossary-dejargon.md):对用户永远说"AI 在干活 / 改动 / 提交确认",**本篇是内部工程文档**,可用 `AgentRun / step / tool / snapshot` 等内部术语。

---

## 0. 现状锚点与演进策略

本引擎不是从零设计,而是把现有 `app/services/auto_agent.py`(file-only 需求的自动处理器)**抽出、泛化、headless 化**。下表是"现状 → WorkHub"的映射,后续小节均以现状代码为根:

| 概念 | 现状(`auto_agent.py` / `auto.py`) | WorkHub 演进 |
|---|---|---|
| 执行循环 | `run_auto()` 的 `for turn in range(1, MAX_TURNS+1)` | 泛化为 `AgentLoop.run()`,引入显式控制信号 |
| 一次执行 | 一次 `auto_process()` 调用 + `AutoOutcome` | 持久化为 **`AgentRun`** 实体(演进自 PRD §7) |
| 完成判定 | 调用 `submit` 工具 + `outputs/` 非空 | **AI 不再请求动作**(`end_turn` 且无 `tool_use`)即完成;`submit` 降级为可选的收尾标注 |
| 工具 | 模块级常量 `TOOLS`(9 个,Anthropic schema) | **`ToolRegistry`**:`{id, description, schema, execute}` + 按 actor 权限过滤 |
| 沙箱 | `_safe_path` + `_enforce_sandbox_budget` + `_sandbox_rlimits` | 保留,工具层 + 进程层双重边界不变 |
| 预算 | `MAX_TURNS=15` / `TOTAL_TIMEOUT_DEFAULT=300s` | 泛化为 `RunBudget`,每个 `AgentRun` **必须**有硬上限(FR-WORKER-003) |
| 复审 | `llm_review()`(第 4 个失败模式检查) | 喂入分级裁决,**不在本篇**,见 escalation 文档 |
| 回滚 | (无) | **新增**:每步 snapshot + revert(FR-WORKER-004,安全红线) |
| 事件 | `bus.publish("req:<id>", "ai.*", …)` | 泛化为 SSE/WS 事件流,topic `run:<run_id>`(见 §6) |
| 状态联动 | `auto.py` 直改 `Requirement.status` | 经统一 lifecycle 中枢(`services/lifecycle.py`)落库 |

> 现状循环的关键代码位:`auto_agent.py:374` `run_auto` · `:405` 主循环 · `:449` `submit` 分支 · `:457`–`:497` 工具 dispatch · `:499`–`:503` 停止判定 · `:535` `llm_review`。本篇所有"现状如此"均指这些位点。

### 0.1 当前 TS-first 实现状态（2026-06-08）

R1 当前代码切片已落：

- `packages/agent/src/loop/loop.ts` 在自然停止且 `outputs/` 有交付物时生成 `AgentLoopResult.manifest`。
- `apps/api/src/workers/agent-runner.ts` 成功执行后把 manifest 注入 `ProposalService.createFromManifest`，并发布 `proposal.opened` 事件；这替代旧 `submit` 唯一完成信号，符合“AI 不再请求动作即完成”的 PRD 口径。
- 默认 proposal 服务已由 `apps/api/src/services/proposals.ts` 接到 `packages/db/src/repositories/proposals.ts`，落 `branches/proposals/reviews`；测试可显式注入内存 service。
- `apps/api/src/routes/agent-runs.ts` 默认在 enqueue 后自动 pump `queue.run(run_id)`，不再要求客户端或测试调用 `runNext()` 才开始执行；测试可用 `autoRun:false` 隔离 queue 单元行为。
- `packages/db/src/repositories/agent-runs.ts` 与 `apps/api/src/services/agent-run-persistence.ts` 已接入 AgentRun/AgentStep write-through persistence；默认 queue 会把 run 状态、预算、usage、workdir、handoff、trace 写入 DB，且 `get/trace/workdir/listActive` 在内存 miss 时从 persistence 读回。
- `agent_steps` 已用 `seq` 做 trace 排序，取消错误的 `(agent_run_id, step_no)` 唯一约束；同一 step 内可同时保存 `tool_call/tool_result/think/final` 多条记录。
- 真实 PostgreSQL restart/replay smoke 已通过：一条 file-only run 在 Linux 测试机落 `agent_runs/agent_steps/proposals/snapshots/audit_logs` 后，新 queue 可读回 `/agent-runs/:id` 与 `/replay`。
- P0.5 fixture 已从生产业务 route 迁出：`/agent-runs/:id/replay` 不再有 fixture fallback；`sessions/workitems/knowledge/page workitem` 已接 R1 最小真实 service，只有 `/api/pages/gold-path` 保留 demo bundle。
- `apps/api/src/services/work-items.ts` 与 `packages/db/src/repositories/work-items.ts` 已接入 option-first intake、work item 创建/固化、knowledge evidence bubble、evidence binding 与 WorkItemDetailVM；Linux PG smoke 已覆盖 `session_status=200`、`work_item_status=spec_ready`、`evidence_refs=1`。
- CostLedger 默认 store 已 DB-backed：`usage_records` 保存 provider 原始 usage，`cost_ledger_entries` 按 workitem/user/team/eval scope 幂等归集；`/api/cost/usage` 与 `/api/pages/cost` 读 DB ledger，Linux PG smoke 覆盖 `usage_records=1`、`cost_ledger_entries=3` 与成本页汇总。
- Proposal merge/main 最小真实切片已落：DB repository 在 review/merge 时更新 `reviews/proposals/branches/work_items`；打回解锁 branch，采纳写 `work_items.status=merged/main_branch_id/accepted_at` 与 branch head/version；AgentRun 通知可通过 DB WorkItem context resolver 路由到 submitter/project owner/assignee 上下文。
- Proposal merge accepted ledger 已落：采纳时写 `accepted_deliverable_changes`、`snapshots(kind=merge)`、`audit_logs(action=proposal.merged)`，并对同一 target 的 current accepted row 做 sha/version 冲突 gate，避免静默覆盖正式版。
- AgentRun-backed delivery 正式文件落盘已落：Proposal merge 会从 `Branch.agent_run_id -> AgentRun.workdir_ref` 找到 `/outputs/...` 源文件，校验 sha 后复制到正式 storage root，并在同一 merge transaction 内写 `ProjectDriveItem/Version` 与 accepted row 的 `drive_item_id/drive_version_id`。
- Accepted deliverable 读取面已落：WorkItem detail page 返回 `accepted_deliverables[]`，正式文件支持 download 与文本 preview，storage path 不外泄。

R1 仍未完成：

- `AgentRunQueue` 执行协调仍有进程内 Map/Set；R2 前还不能宣称多 worker 安全，也不能依赖它做 claim/lease。
- Replay route 已可通过 queue 的 persistence fallback 读回 DB-backed run/trace，并已把 WorkItem page 的 `accepted_deliverables[]` 带入 ReplayTraceVM；merge accepted ledger、ProjectDriveVersion adoption、download/text-preview 与 audit 持久化已做实，但 AI 冲突调解与正式交付物 revert 执行入口仍需后续切片。
- BudgetPolicy 更新仍是内存 override，尚未持久化为 `budget_policies` 与审计日志；完整 P-COST 策略治理仍需后续切片。

后续施工必须先完成正式交付物 revert、AI 冲突调解、BudgetPolicy 持久化与完整审批中心，再回到 Web/Cuu 产品化。

---

## 1. 核心数据结构

> 字段类型用 Python/SQLAlchemy 记法表达意图,**权威定义在** [`data-model.md`](../01-architecture/data-model.md);本篇给执行循环直接读写的切片。`AgentRun` 演进自现状的 `@dataclass AutoResult/AutoOutcome`(`auto_agent.py:364/591`),由进程内瞬时结构升级为持久实体。

### 1.1 `AgentRun`(一次自治执行)

```text
AgentRun
  id:            str            # uid 主键
  work_item_id:  str            # FK → WorkItem(演进自 Requirement, models.py:314)
  branch_id:     str            # FK → Branch(AI 工人在哪个分支干;见 03-collaboration)
  actor_id:      str            # 谁的身份在执行(AI 系统账户或代某用户);决定可见工具集
  mode:          enum           # worker | pm    (一人两顶帽子;本篇只覆盖 worker)
  status:        enum           # queued | running | compacting | awaiting_approval
                                #   | delivered | escalated | failed | cancelled
  control:       enum           # 最近一次控制信号: continue | stop | compact | escalate
  budget:        RunBudget      # 见 §4.1(硬上限,FR-WORKER-003)
  usage:         RunUsage       # 累计步数/耗时/token/成本(见 §4.2)
  step_cursor:   int            # 当前 step 序号(= 现状的 turn)
  workdir:       str            # 沙箱根(演进自 settings.data_dir/auto/<req_id>)
  base_snapshot: str | None     # 执行前的基线快照 id(§7)
  final_notes:   str | None     # 收尾标注(演进自 submit.notes / AutoResult.notes)
  outcome_reason:str | None     # 人话结果(演进自 AutoResult.reason)
  created_at / updated_at / ended_at: datetime
```

`status` 状态流转见 §3.4;它是 `AgentRun` 自身的生命周期,**区别于** WorkItem 状态机(PRD §7.1,后者由 lifecycle 中枢驱动)。

### 1.2 `AgentStep`(一步 = 一次模型往返 + 其副作用)

`step` 是 trace 的最小单元(对应 FR-WORKER-002 "每步动作 + 工具输入输出可审")。一个 `AgentRun` 有序拥有 N 个 step:

```text
AgentStep
  id:            str
  run_id:        str            # FK → AgentRun
  index:         int            # 1-based,= 现状的 turn
  request:       json           # 发给模型的 messages 增量(可裁剪存档)
  assistant:     json           # 模型返回的 content blocks(thinking/text/tool_use)
  tool_calls:    list[ToolCall] # 本步发起的工具调用(见 1.3)
  control:       enum           # 本步推导出的控制信号
  snapshot_id:   str | None     # 本步副作用前打的快照(§7);只读步可为 None
  started_at / ended_at: datetime
  duration_ms:   int
  stop_reason:   str            # 透传模型 stop_reason: tool_use | end_turn | max_tokens | …
```

### 1.3 `ToolCall` / `ToolResult`

```text
ToolCall
  id:          str        # = Anthropic tool_use block.id(回执必须原样带回)
  tool_id:     str        # 注册表里的工具 id(= 现状的 block.name)
  input:       json       # 模型给的参数
  visible:     bool       # 该 actor 是否有权见此工具(注册表过滤结果;见 §5.3)

ToolResult
  tool_use_id: str        # 对应 ToolCall.id
  ok:          bool       # 成功 / 可恢复错误
  content:     str        # 执行输出或 "[error] …"(可恢复,回灌给模型)
  is_error:    bool       # 映射 Anthropic tool_result.is_error;true 不终止循环
```

> **现状对照**:`auto_agent.py:493` 构造的 `{"type":"tool_result","tool_use_id":block.id,"content":content}` 就是 `ToolResult` 的最小形态。现状把错误编码进 `content`(`"[error] …"`)而非 `is_error` 旗标——WorkHub 显式化 `is_error`,语义不变:**错误是可恢复的,回灌让模型自我纠偏,绝不崩**。

---

## 2. 工人执行循环(Worker Loop)

### 2.1 一句话模型

> 单循环驱动。每步:① 检查预算 → ② 装配工具 + 上下文 → ③ 调模型(streaming)→ ④ 解析返回、执行工具、打快照 → ⑤ 由"模型是否还要动作"推导控制信号 → 分支。**完成判定 = AI 不再请求动作**,而非显式 flag。(PRD §8.1)

借鉴 opencode `runLoop`。现状 `run_auto()`(`auto_agent.py:405`)已是这个形态,WorkHub 补齐显式控制信号与快照。

### 2.2 步循环伪代码(权威流程)

```text
run(agent_run):
    assemble system prompt (prompts/auto_agent.md 的演进)
    messages = [初始用户消息: WorkItem 标题 + 规格(summary_md)+ inputs/ 提示]
    publish run:<id> ai.started {budget}
    agent_run.base_snapshot = snapshot("base")          # §7 执行前基线

    loop step_index in 1..budget.max_steps:
        # ── ① 预算闸门(每步开头,先于任何花费)──
        signal = check_budget(agent_run)                 # §4.3
        if signal == compact:  compact_context(); continue
        if signal == escalate: return finalize(escalated, structured_handoff())   # §4.4
        # (stop 由完成判定产生,不在这里)

        # ── ② 装配 ──
        tools = registry.visible_for(agent_run.actor_id) # §5.3 按权限过滤
        # context = messages(+ 必要时已压缩的摘要)

        # ── ③ 调模型(streaming;max_tokens 大时 SDK 强制 stream)──
        try:
            resp = await with_per_step_timeout(
                model.stream(system, tools, messages), remaining_budget())
        except Timeout:        return finalize(failed, "单步 LLM 调用超时")
        except TransientError:  retry_with_backoff()      # NFR-06,见 §8.3
        except Exception as e: return finalize(failed, classify(e))

        messages.append(assistant := resp.content blocks)

        # ── ④ 执行工具 + 打快照 ──
        tool_results = []
        snap = None
        for block in assistant:
            emit_trace(block)                             # thinking/text/tool_use → §6
            if block.type == "tool_use":
                if block.tool_id not in tools:            # 越权/未知
                    tool_results.append(error(block, "tool not available"))
                    continue
                if requires_approval(block):              # ask 命中 → 阻塞原语
                    decision = await request_approval(block)   # §2.5
                    if decision.deny:
                        tool_results.append(error(block, decision.reason))  # 回灌
                        continue
                if has_side_effect(block) and snap is None:
                    snap = snapshot(f"step-{step_index}")  # §7 副作用前
                result = await registry.execute(block.tool_id, block.input, ctx)
                tool_results.append(result)
        persist AgentStep(index, request, assistant, tool_calls, snap)

        # ── ⑤ 控制信号推导(完成判定)──
        if tool_results:                                  # 还有动作 → 继续
            messages.append(user := tool_results)
            agent_run.control = continue; continue
        elif resp.stop_reason == "end_turn":              # 不再请求动作 → 完成
            agent_run.control = stop
            return finalize(delivered, final_text=assistant.text)
        else:                                             # max_tokens 等异常停顿
            handle_truncation()                           # §8.2

    # 跑满步数仍未停 → 视为受阻,结构化交接
    return finalize(escalated, structured_handoff())      # §4.4
```

### 2.3 完成判定(关键变更)

| | 现状(`auto_agent.py`) | WorkHub |
|---|---|---|
| 主判定 | 模型调用 `submit` 工具(`:449`) | **模型 `stop_reason == end_turn` 且本步无 `tool_use`**(= AI 不再请求动作) |
| `submit` 角色 | 唯一的完成信号 | 降级为**可选的收尾标注**(写 `final_notes`);不再是完成的充要条件 |
| 产物校验 | `_has_deliverables()` 查 `outputs/` 非空(`:451`) | 仍校验分支产物非空;**空产物 + 自然停止 → `failed`("AI 没产出交付物")** |
| 模型"裸停" | `stop_reason==end_turn` 且无工具 → `failed`("未调用 submit 就结束",`:501`) | `end_turn` 是**正常完成路径**;仅当无产物才判 `failed` |

> 为什么改:PRD §8.1 明确"完成判定 = AI 不再请求动作(产出最终交付而非再调工具),而非显式 flag"。`submit` 这种显式 flag 在现状下制造了一类假阴性——模型把交付写进 `outputs/` 后用自然语言收尾却忘了 `submit`,会被误判失败。WorkHub 以"无后续动作"为准,`submit` 仅用于让模型留一句结构化收尾(喂入交付文档,见 `auto.py:_auto_delivery_doc`)。

### 2.4 边界与失败:每步出口表

| 触发 | 现状位点 | WorkHub 处置 | `AgentRun.status` |
|---|---|---|---|
| 总耗时超预算 | `:406` | 结构化交接(§4.4),不静默截断 | `escalated` |
| 单步 LLM 超时 | `:426` | 终止本 run,记 `failed` | `failed` |
| LLM 调用异常 | `:428` | 分类(transient→重试;permanent→failed) | `failed` |
| 瞬时错误(429/5xx) | (现状直接 failed) | 退避重试,尊重 `Retry-After`(NFR-06) | `running` |
| 工具 schema 不合法 | `:490` `except` | `is_error=true` 回灌"请改输入",**循环继续** | `running` |
| 未知/越权工具 | `:488` | 同上,回灌 + 继续 | `running` |
| `max_tokens` 截断 | (现状未单列) | 触发 `compact` 或单步重试(§8.2) | `compacting`/`running` |
| 跑满 `max_steps` | `:505` | 结构化交接(§4.4) | `escalated` |
| 自然停止但无产物 | (现状 `submit` 才查) | 记 `failed`("AI 没产出交付物") | `failed` |
| WorkItem 被取消/状态漂移 | `auto.py:166/318` | run 收尾不落库交付,settle job(见 §3.5) | `cancelled` |

### 2.5 阻塞式审批原语(ask)

任何工具在"该决策那一刻"可对当前 actor `ask`,**阻塞 run 直至回复**(PRD §8.6,借鉴 opencode)。这是 `AgentRun` 进入 `awaiting_approval` 的唯一入口:

- 命中 `ask`(策略合并见 [`security-and-permissions.md`](../01-architecture/security-and-permissions.md))→ 发 `run:<id>` 的 `approval.requested` 事件 → loop `await` 一个 future。
- 批准 → 照常 `execute`;拒绝 → 构造 `is_error` 的 `ToolResult`,**理由回灌**(同打回回灌,见 [`confidence-risk-escalation.md`](./confidence-risk-escalation.md))。
- 超时无人响应 → 由审批路由 SLA 决定(升级 / 默认拒绝),见 [`review-and-approval.md`](../03-collaboration/review-and-approval.md)。

> 本篇只定义 loop 侧的"阻塞 + 回灌"原语;**谁该批、SLA、委派、"永远允许"沉淀** 全在 P-PERM 文档,勿在此重复。

---

## 3. 控制信号(Control Signals)

### 3.1 四信号语义

PRD §8.1 规定循环按 `continue / stop / compact / escalate` 分支。每步末尾必产出恰好一个信号:

| 信号 | 语义 | 触发源 | 现状对应 |
|---|---|---|---|
| `continue` | 还有动作要做,带工具结果进下一步 | 本步有 `tool_use` 且未受阻 | `:499` `if tool_results` |
| `stop` | AI 不再请求动作 = **完成** | `end_turn` 且无 `tool_use` | `:501`(现状语义相反,见 §2.3) |
| `compact` | 上下文将超窗,先压缩历史再续 | token 预算/窗口压力(§8.2) | (现状无,新增) |
| `escalate` | 受阻,转经理模式找人 | 预算耗尽 / doom-loop / 高风险卡死 | `:505` 跑满轮次(现状仅此一种) |

### 3.2 信号判定优先级(每步开头 + 末尾)

```text
开头闸门(花费前):  escalate(预算耗尽 §4.3 / doom-loop §3.3) > compact(窗口压力)
末尾推导(花费后):  stop(无动作请求) > continue(有动作请求)
                    异常路径不产出上述信号,直接 finalize(failed)(§2.4)
```

`escalate` 永远优先于 `compact`:预算已耗尽时压缩也无意义,直接交接。

### 3.3 doom-loop 检测(自动升级信号之一)

借鉴 opencode 的"连续 N 次相同动作判卡住"(PRD §8.2 额外自动升级信号,FR-ESC-004)。**现状无此检测**,WorkHub 新增:

```text
detect_doom_loop(run, window=N):
    sig = fingerprint(last_step)               # 见下
    push sig into run.recent_signatures (ring, len=N)
    if len == N and all(s == sig for s in run.recent_signatures):
        return escalate(reason="doom_loop", detail={signature, count:N})
    return None

fingerprint(step):
    # 工具调用序列(tool_id + 规范化 input)的稳定哈希;
    # 纯文本步用 text 的归一化哈希。规范化:去空白、排序 key、截断长 value。
    return sha256(canonical(step.tool_calls or step.assistant.text))
```

- **默认 `N = 3`**(连续 3 步指纹相同即判卡住),可经策略覆写。
- "相同动作"按**规范化 input** 比对:`read_file(a.py)` 重复读同一文件算相同;`write_file` 内容不同则不同(避免误杀正常迭代)。
- 命中 → `escalate`,`EscalationEvent.trigger = doom_loop`(裁决细节见 [`confidence-risk-escalation.md`](./confidence-risk-escalation.md))。

### 3.4 `AgentRun.status` 状态机

```text
queued ─┬─► running ─┬─► (end_turn,有产物) ──────► delivered
        │            ├─► (ask 命中) ──► awaiting_approval ─┬─► running   (批准/拒绝回灌)
        │            │                                     └─► escalated (SLA 升级)
        │            ├─► (窗口压力) ──► compacting ───────► running
        │            ├─► (预算耗尽/doom-loop/高风险) ─────► escalated
        │            ├─► (单步超时/永久错误/空产物) ──────► failed
        │            └─► (WorkItem 取消/漂移) ────────────► cancelled
        └─► cancelled
delivered / escalated / failed / cancelled = 终态
```

> 与 WorkItem 状态机(PRD §7.1)的关系:`delivered` → WorkItem 进入分级裁决(`auto_proposal` / `human_spotcheck` / `escalated`);`escalated` → WorkItem 进 `pm_mode`;`failed` → 现状是回退 `ready`(`auto.py:242`),WorkHub 下统一由 lifecycle 决定回退或升级。本篇不展开 WorkItem 侧转移,见 [`data-model.md`](../01-architecture/data-model.md)。

### 3.5 并发与竞态(沿用现状的硬约束)

执行循环是 detached 异步任务,落库时 WorkItem 可能已被改动。WorkHub 沿用现状已验证的护栏(`auto.py`):

- **启动 CAS**:`UPDATE … WHERE status IN (可启动态)`,`rowcount==0` → 409,杜绝两次并发触发同一 run(`auto.py:84`)。
- **收尾前状态复查**:落交付前确认 `AgentRun`/WorkItem 仍在 in-flight 态;漂移(如已 `cancelled`)→ 不写产物、不发 org 级通知、把 job settle 为"已结束但跳过"(`auto.py:166`)。
- **失败回退状态感知**:`_mark_auto_failed` 只在仍 in-flight 时回退,避免复活已取消项 / 覆盖已落库的交付(`auto.py:318`)。
- D-2 迁到 PostgreSQL 后,以上 CAS/复查可升级为**行级锁/乐观锁**(支撑多 Agent 并发,NFR-01)。

---

## 4. 预算、沙箱(Budget & Sandbox)

### 4.1 `RunBudget`(硬上限,FR-WORKER-003)

> **[决策]** 每个 `AgentRun` 必须有硬预算上限,超限不静默截断而是结构化交接。演进自现状的模块级常量。

```text
RunBudget
  max_steps:       int   = 15            # 现状 MAX_TURNS;= AgentStep 上限
  total_timeout_s: int   = 300           # 现状 TOTAL_TIMEOUT_DEFAULT(5min)
  per_step_timeout_s:int = 计算值          # 现状: max(30, total - elapsed)(auto_agent.py:424)
  max_tokens:      int                   # token 预算(成本治理,NFR-05;现状未限,新增)
  max_cost:        float                 # 成本上限(用户/团队/任务三级配额裁出;见 cost-governance)
  # ── 沙箱物理上限(现状常量,见 §4.2)──
  max_files:       int   = 800           # MAX_SANDBOX_FILES
  max_bytes:       int   = 200*1024*1024 # MAX_SANDBOX_BYTES
  command_timeout_s:int  = 45            # COMMAND_TIMEOUT(单条命令,上限硬截 60)
```

`max_tokens / max_cost` 由成本治理三级配额(用户/团队/任务)裁定,低风险任务可路由更便宜模型(NFR-05);裁决规则见 [`cost-governance.md`](./cost-governance.md),本篇只消费一个已算好的 `RunBudget`。

### 4.2 `RunUsage`(累计计量)

```text
RunUsage
  steps_used:   int      # = step_cursor
  seconds_used: float    # monotonic 计时(现状 time.monotonic(), auto_agent.py:384)
  tokens_in / tokens_out: int    # 从 P-COST usage sink / ledger 摘要读取,每次 model 响应先写 UsageRecord
  cost:         float    # 由 CostLedgerEntry 汇总,AgentLoop 不直接乘模型单价
  files_count / bytes_used: int  # _sandbox_stats() 实时统计(auto_agent.py:163)
```

`RunUsage` 是 AgentLoop 的执行期视图,不是成本真相源。provider registry 负责把每次真实模型调用写成 `UsageRecord`;P-COST 负责归集 `CostLedgerEntry` 与 `BudgetUsage`;AgentLoop 只读摘要做 `check_budget()`。

### 4.3 `check_budget()`(每步开头闸门)

```text
check_budget(run) -> Signal | None:
    if run.usage.seconds_used > budget.total_timeout_s:   return escalate("超时预算耗尽")
    if run.usage.steps_used   >= budget.max_steps:        return escalate("步数预算耗尽")
    if run.usage.cost         >= budget.max_cost:         return escalate("成本预算耗尽")
    if approaching_context_window(run):                   return compact   # §8.2
    return None
```

> **现状对照**:现状只在循环顶检查 `total_timeout`(`:406`)与靠 `range(MAX_TURNS)` 限步;超限直接 `_result(False, "总耗时超过预算")` 即失败。WorkHub 把"超预算"从 `failed` 改判为 `escalate` + 结构化交接(§4.4),符合 FR-WORKER-003"而非静默截断"。

### 4.4 结构化交接件(超预算 / 卡死时的产物)

预算耗尽或跑满步数 → **不静默截断**,强制产出「已做 / 未做 / 下一步」三段式结构化交接(借鉴 opencode `MAX_STEPS`,FR-WORKER-003)。这是给经理模式接力的输入:

```text
StructuredHandoff
  done:        list[str]    # 已完成的子步(从 trace 提炼)
  remaining:   list[str]    # 未完成项
  next_steps:  list[str]    # 建议的下一步
  blockers:    list[str]    # 卡点(缺数据 / 越权 / 工具不足)
  artifacts:   list[path]   # 已落分支的半成品
  budget_hit:  enum         # steps | timeout | cost | doom_loop
```

> 现状 prompts/auto_agent.md 规则 7 已有雏形:任务不可能时"仍写 `outputs/README.md` 交接说明并 `submit`"。WorkHub 把它从"模型自觉"升级为**引擎强制**:即便模型未配合,引擎也用 trace 自动生成 handoff,写入 `EscalationEvent`(见 [`confidence-risk-escalation.md`](./confidence-risk-escalation.md))。

### 4.5 沙箱:双层边界(原样沿用现状)

WorkHub 的安全模型直接继承现状,**不弱化**。两层边界:

**(a) 工具层路径前缀强制** —— `_safe_path()`(`auto_agent.py:154`):
- 一切工具入参路径 `resolve()` 后必须落在 `workdir` 内,否则 `ValueError("path escapes workdir")`。
- prompt 侧亦禁止 `../` 与绝对路径(`prompts/auto_agent.md` 规则 4)。

**(b) 进程层 rlimit + 命令白名单** —— `_sandbox_rlimits()`(`auto_agent.py:268`,POSIX `preexec_fn`):
- `RLIMIT_CPU=120s` / `RLIMIT_AS=2GiB` / `RLIMIT_FSIZE=256MiB` / `RLIMIT_NOFILE=512`。
- 限制真实解释器一旦 `run_command` 启动后能 open 绝对路径的爆炸半径(工具层前缀只管工具自身)。
- **命令白名单** `ALLOWED_COMMANDS`(`auto_agent.py:42`):`python/python3/py/node/npm/pnpm/bun/pytest/ruff/tsc`;无 shell(`shell=False`);依赖安装(`npm/pnpm/bun install/add/i`)被显式禁(`auto_agent.py:296`)。
- 受限环境变量:`PATH/PYTHONPATH/HOME/TMPDIR` 全指向 `workdir`(`auto_agent.py:304`),`NO_COLOR=1`。

**已知残留风险(继承现状文档)**:
- `RLIMIT_NPROC` **故意不设**——它是 per-UID 的,在繁忙服务器上会误伤 exec(`auto_agent.py:275` 注释)。
- **网络出口不阻断**——需 netns,现状在"可信 LAN + opt-in + 已认证作者"威胁模型下接受此残留(`auto_agent.py:276` 注释 + `prompts/auto_agent.md`)。**WorkHub D-3 上云前必须重审**(NFR-02,见 [`security-and-permissions.md`](../01-architecture/security-and-permissions.md))。

**预算实施点** —— `_enforce_sandbox_budget()`(`auto_agent.py:176`)在每个**写类**工具(`write_file/write_base64_file/move_path/run_command/zip_path`)执行后调用,超 `max_files/max_bytes` 即 `ValueError` → 转 `is_error` 回灌。

**run_command 必须 off-loop** —— `subprocess.run` 最长阻塞 60s,内联会冻结整个进程的所有 SSE 流与请求,故现状用 `asyncio.to_thread`(`auto_agent.py:479`);WorkHub 沿用,daemon 化后尤须保持。

---

## 5. 工具契约与注册表(Tool Contract & Registry)

### 5.1 最小契约 `{id, 描述, schema, execute}`

PRD §8.1 规定工具的四元契约。现状 `TOOLS`(`auto_agent.py:51`)只有前三项(`name/description/input_schema`,Anthropic 格式),`execute` 隐式散落在 `run_auto` 的 `if name == …` dispatch(`:457`)。WorkHub 收敛为显式注册项:

```text
ToolSpec
  id:          str                 # 稳定标识(= 现状 name);发给模型的工具名
  description: str                 # 给模型看的用途说明
  schema:      json-schema         # 入参校验(= 现状 input_schema)
  execute:     (input, ctx) -> ToolResult   # 纯函数式执行体;ctx 持有 workdir/actor/snapshot 句柄
  side_effect: bool                # 是否产生副作用(决定是否打快照,§7)
  min_scope:   PermScope           # 可见/可用所需最小权限(§5.3)
```

`ctx`(执行上下文)携带 `workdir / actor / run_id / snapshot_handle`,把现状 dispatch 里到处传的 `workdir` 收口。

### 5.2 内置工具表(复用现状 9 工具)

复用 `auto_agent.py` 现有工具(PRD §8.1 明列),`submit` 语义按 §2.3 降级:

| id | 描述 | 关键入参(schema) | side_effect | 实现位点 |
|---|---|---|---|---|
| `list_files` | 递归列目录 | `path?` | 否 | `_tool_list_files` `:184` |
| `read_file` | 读 UTF-8 文本 | `path*` | 否 | `_tool_read_file` `:200` |
| `write_file` | 写 UTF-8 文本(建父目录) | `path*, content*` | 是 | `_tool_write_file` `:212` |
| `write_base64_file` | 写二进制(base64) | `path*, base64_content*` | 是 | `_tool_write_base64_file` `:220` |
| `mkdir` | 建目录 | `path*` | 是 | `_tool_mkdir` `:229` |
| `move_path` | 移动/重命名 | `src*, dest*` | 是 | `_tool_move_path` `:235` |
| `delete_path` | 删文件/目录 | `path*` | 是 | `_tool_delete_path` `:246` |
| `run_command` | 跑白名单命令(无 shell) | `args*, cwd?, timeout_s?(1–60)` | 是 | `_tool_run_command` `:288` |
| `zip_path` | 打包为 zip | `src*, dest*` | 是 | `_tool_zip_path` `:341` |
| `submit` | 收尾标注(降级为可选) | `notes*` | 否 | `run_auto` 内联 `:449` |

> `*`=必填。WorkHub 新增工具(如读业务对象、提 Proposal、查知识库)在各自模块文档定义,统一注册进 `ToolRegistry`,**不在本篇枚举**。

### 5.3 注册表:按 actor 权限过滤可见工具

> PRD §8.1:"注册表按当前 actor 权限过滤模型可见的工具菜单"。这是 RBAC/分层 permission 在执行循环里的落点。

```text
ToolRegistry.visible_for(actor_id) -> list[ToolSpec]:
    policy = resolve_policy(actor_id)         # org→workspace→role→session 合并(P-PERM)
    return [t for t in all_tools
            if policy.allows_visibility(t.min_scope)]   # deny/不匹配则不进菜单
```

机制要点:

1. **可见 ≠ 可用**:`visible_for` 决定塞给模型的 `tools` 列表(模型连"有这个工具"都不知道,从源头降低越权与提示注入面)。即便绕过,`execute` 入口仍二次校验 `min_scope` + `ask` 闸门(§2.5)。
2. **未知/越权工具调用** → `is_error` 回灌"tool not available"(§2.4),循环继续,绝不崩。
3. **schema 校验失败** → 回灌"请修正输入"的可恢复错误(现状 `:490` 的 `except` 即此语义,WorkHub 提前到 dispatch 前用 `schema` 显式校验)。
4. **mode 相关**:`worker` 模式的工具集 ≠ `pm` 模式(经理模式有派活/排期/催办类工具,见 [`pm-mode-orchestration.md`](./pm-mode-orchestration.md));`visible_for` 同时按 `AgentRun.mode` 收窄。

> 分层策略的**合并算法、通配规则、"永远允许"沉淀** 是 P-PERM 的内容,见 [`security-and-permissions.md`](../01-architecture/security-and-permissions.md);本篇只定义"过滤发生在装配步、execute 二次校验"这一接入契约。

---

## 6. 事件契约(Trace & SSE)

### 6.1 topic 与传输

延续现状 `push_bus`(`app/services/push_bus.py`):in-process pub/sub,一订阅者一队列(`maxsize=256`,满则丢慢订阅者),30s 心跳保活 SSE。现状 topic 为 `req:<req_id>` 与 `all`(`auto_agent.py` 全程 publish 到 `req:<id>`)。

WorkHub 演进:
- 新增 **`run:<run_id>`** topic(per-AgentRun trace 流);WorkItem 级仍用 `work_item:<id>`(演进自 `req:<id>`);全局 `all`。
- D-2/daemon 化后,`push_bus` 升级为可跨进程的事件总线(如 PG `LISTEN/NOTIFY` 或外部 broker),契约不变,见 [`api-contract.md`](../01-architecture/api-contract.md)。
- 私有事件**按身份隔离**(NFR-08):`run:<id>` 仅该 run 的 owner/审批人可订阅。

### 6.2 事件清单(执行循环发出的)

> 演进自现状 `ai.*` 系列(`auto_agent.py` / `auto.py`)。`data` 给字段切片;全量事件类型清单在 [`api-contract.md`](../01-architecture/api-contract.md)。

| 事件 type | 何时 | data(切片) | 现状对应 |
|---|---|---|---|
| `agent_run.started` | run 开始 | `{run_id, budget}` | `ai.started`(`:400`) |
| `agent_run.step` | 模型 thinking / text / tool_call 的统一实时投影 | `{index, kind, text_or_tool_preview(截断)}` | `ai.thinking`/`ai.text`/`ai.tool_call`(`:438/:440/:444`) |
| `step.tool_result` | 工具回执 | `{index, tool_id, ok, content_preview}` | (现状未单发,新增) |
| `step.snapshot` | 打了快照 | `{index, snapshot_id}` | (新增,§7) |
| `permission.ask` | ask 阻塞 | `{approval_id, tool_id, summary, ttl}` | (新增,§2.5) |
| `agent_run.compacting` | 触发压缩 | `{index, reason}` | (新增,§8.2) |
| `agent_run.escalated` | 升级 | `{trigger, headline, handoff_ref}` | (派生自 `ai.failed`) |
| `proposal.opened` | 完成交付并生成提议 | `{proposal_id, manifest_ref}` | `ai.done`+`requirement.updated`(`:235`) |
| `agent_run.failed` | 失败 | `{reason, notes}` | `ai.failed`(`:259`) |
| `agent_run.step` (`kind="done"`) | run 收尾投影(用于 reconcile) | `{run_id, steps}` | `ai.done`(`:507`,`finally` 必发) |

> **截断纪律**:现状把 thinking/text/input 预览截到 200 字符再 publish(`:438/440/444`),避免长内容压垮 SSE 队列。WorkHub 保持:**事件载荷只放预览**,完整 trace 落 `AgentStep` 表,前端按需拉取。

### 6.3 trace 可审性(FR-WORKER-002)

每个 `AgentRun` 产生完整 trace(每步动作 + 工具输入输出)可供人审。落点:`AgentStep` 表(§1.2)持久化 `request/assistant/tool_calls/snapshot_id`;SSE 是实时投影,DB 是权威可审副本。审计按身份写 `AuditLog`(NFR-03,见 [`security-and-permissions.md`](../01-architecture/security-and-permissions.md))。

---

## 7. 每步快照与回滚(Snapshot & Revert)

> **[决策·安全红线]** AI 对业务数据的每次副作用都生成快照,任何步骤可 revert(PRD §8.1 / FR-WORKER-004 / NFR-04)。借鉴 opencode 的"每步 git 快照"。**现状无此能力,WorkHub 必须新增**。

### 7.1 快照对象与时机

| 副作用域 | 快照载体 | 时机 |
|---|---|---|
| 沙箱文件(`workdir`) | 工作树快照(内部 git/CoW,**对用户隐藏**为"改动版本") | 每步**首个 side_effect 工具执行前**(§2.2 ④) |
| 业务对象(WorkItem/Drive/记录) | 变更前镜像 + 反向操作(逻辑回滚) | 每次业务写操作前,落 `AuditLog` 反向补偿 |

机制:
- `base_snapshot`:run 启动时打基线(§2.2)。
- `AgentStep.snapshot_id`:该步副作用前的快照;**只读步(只 list/read)不打快照**(`side_effect=False`,省成本)。
- 文件域用内容寻址(沿用现状交付包的 `sha256` 去重思路,`auto.py:189`;`spec_watch.rs` 已有 sha256 append-only 同步地基)。

### 7.2 回滚契约

```text
revert(run, to: snapshot_id | step_index):
    assert run.status in {failed, escalated, delivered-未合并, awaiting_approval}
    restore workdir to snapshot                      # 文件域
    for each business write after target (倒序):      # 业务域
        apply inverse op from AuditLog
    emit run:<id> step.snapshot {reverted_to}
    write AuditLog(action=revert, actor, target)     # 回滚本身也审计
```

- **可回滚范围**:AI 的副作用尚未"合并入 main"前一律可回滚;已合并的改动回滚 = 走 Proposal 反向流程(见 [`branch-proposal-merge.md`](../03-collaboration/branch-proposal-merge.md)),不在本篇。
- **去黑话**:对用户呈现为"撤回到这一步之前 / 还原",绝不出现 snapshot/revert/commit 字样([`glossary-dejargon.md`](../00-overview/glossary-dejargon.md))。
- **幂等**:重复 revert 到同一目标无副作用(快照是确定状态,反向 op 带版本守卫)。

---

## 8. 上下文管理与可靠性

### 8.1 上下文装配

- system prompt = `prompts/auto_agent.md` 的演进(角色、输出语言纪律、工具说明、规则、交付质量);初始 user 消息 = WorkItem 标题 + 规格(`summary_md`)+ `inputs/` 附件提示(现状 `auto_agent.py:387`)。
- 附件预载:`_preload_inputs()` 把 WorkItem 附件去重命名后拷进 `inputs/`(`auto_agent.py:603`),视为只读源材料。
- 每步把上一步 `assistant` 与本步 `tool_results` append 进 `messages`(现状 `:433/500`),完整对话即上下文。

### 8.2 `compact`:上下文压缩(新增)

现状无压缩——靠 `MAX_TURNS=15` 短跑兜底;长任务一旦逼近窗口会 `max_tokens` 截断。WorkHub 引入 `compact` 信号:

```text
approaching_context_window(run):  # 闸门(§4.3)
    return estimated_tokens(messages) > window * COMPACT_THRESHOLD   # 默认 0.8

compact_context(run):
    summary = summarize(早期 step 的 messages)   # 保留近 K 步原文 + 早期摘要
    messages = [system-ctx, summary, *recent_k_steps]
    emit run:<id> agent_run.compacting
    # 压缩后回 running,继续下一步
```

`max_tokens` 截断(`stop_reason == max_tokens`)按 §2.4 处理:优先 `compact` 后单步重试;连续截断不收敛 → `escalate`。

### 8.3 瞬时错误重试(NFR-06)

现状 LLM 调用异常一律 `failed`(`auto_agent.py:428`)。WorkHub 区分:
- **瞬时**(429/5xx/连接重置):指数退避重试,**尊重 `Retry-After`**;计入 `max_steps` 不计入(或计入,按策略),退避期间 `AgentRun` 仍 `running`。
- **永久**(4xx 鉴权/入参/模型不存在):立即 `failed`,不重试。
- 重试耗尽 → 结构化交接(§4.4)或 `failed`,优雅降级为人话(NFR-06),绝不静默卡死。

---

## 9. 验收映射(本篇覆盖的 FR/NFR)

| 需求 | 落点 |
|---|---|
| **FR-WORKER-001**(默认派 AI 工人) | §2 worker loop;启动经 lifecycle/CAS(§3.5) |
| **FR-WORKER-002**(完整 trace 可审) | §1.2 `AgentStep`;§6 事件 + DB 权威副本 |
| **FR-WORKER-003**(超预算结构化交接) | §4.1 `RunBudget`;§4.4 `StructuredHandoff` |
| **FR-WORKER-004**(副作用可回滚) | §7 快照与 revert |
| **FR-ESC-004**(doom-loop/超预算自动升级) | §3.3 doom-loop;§4.3 预算闸门 → `escalate` |
| **FR-PERM-001**(分层 allow/deny/ask,默认 ask) | §2.5 阻塞原语;§5.3 注册表过滤(接入 P-PERM) |
| **NFR-01**(逃离单 worker) | §3.5 行级锁演进(D-2) |
| **NFR-02**(沙箱+权限+高风险门) | §4.5 双层边界;§2.5 ask |
| **NFR-03/04**(审计/回滚) | §6.3 审计;§7 回滚 |
| **NFR-05**(成本治理) | §4.1 `max_tokens/max_cost`(消费 [`cost-governance.md`](./cost-governance.md) 配额) |
| **NFR-06**(瞬时重试+优雅降级) | §8.3 |
| **NFR-07/08**(SSE 实时 + 身份隔离) | §6.1 topic + 隔离 |

---

## 10. 开放问题(关联 PRD §16)

1. **完成判定的产物校验粒度**:`end_turn` 无产物即 `failed`,但"有产物却答非所问"靠复审(escalation 文档)兜底——两者边界、是否需要"AI 自评已完成"信号?
2. **doom-loop 的 N 与指纹粒度**:默认 N=3 是否够稳?`write_file` 内容微调算不算"相同动作"?需真实 trace 标定。
3. **快照成本**:每步文件快照在大 `workdir` 下的开销;是否只对"净变更"增量快照、只读步彻底跳过(已倾向后者)。
4. **compact 阈值与摘要保真**:0.8 窗口阈值、保留近 K 步的 K 值;摘要丢信息导致回灌纠偏失效的风险。
5. **业务对象回滚的反向 op 完备性**:哪些业务写操作天然不可逆(如已发外部通知),需在 §7.2 标"不可回滚"并前置 `ask`。
6. **token/cost 计入预算的口径**:已由 [`cost-governance.md §5`](./cost-governance.md#5-计入口径) 收敛为真实花费均计入,nightly eval 单独记账;本篇后续只验证 `RunUsage` 是否正确消费。
