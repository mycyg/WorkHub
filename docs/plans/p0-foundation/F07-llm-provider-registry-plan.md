---
component: F07
title: LLM provider 注册表 — 系统级实现 plan
status: draft
depends: [F1]
date: 2026-06-05
origin: docs/plans/2026-06-05-feat-workhub-p0-foundation-master-plan.md
inventory: docs/plans/p0-foundation/_migration-inventory.md §7
spec: docs/workhub/01-architecture/tech-stack-and-migration.md §4
---

# F07 LLM provider 注册表 — 系统级实现 plan

> 上游:[Master Plan §5/§5.1/§6/§8](../2026-06-05-feat-workhub-p0-foundation-master-plan.md) · [迁移清单 §7](./_migration-inventory.md) · [技术选型 §4](../../workhub/01-architecture/tech-stack-and-migration.md)。
> 本组件 = Master Plan 表中的 **F7**:`registry.get(actor, task)` 单出口、改接全部 7 处裸 `AsyncAnthropic`、模型路由骨架(低风险走廉价,NFR-05)、每调用 token/成本计量喂三级预算。
> 依赖 **F1**(配置块落地);**不依赖 DB**,可与 F3–F5 并行(Master §5.1)。
> 铁律对齐:本组件直接落地 Master §6.9「**provider 单出口**」;并为 §6.1「可移植」「配置经 settings」与 §6.8「事件 taxonomy」埋点。安全敏感面(API key 注入)按 §6.4「逐字移植」处理。

---

## 目标

把现有 7 处各自 `new` 的 `AsyncAnthropic(base_url=settings.llm_base_url, api_key=settings.llm_api_key)` 收敛成**单一 provider 注册表**(`app/llm/`),系统其余只向注册表要「一个能跑 `messages` 的 client」,保持**模型无关**。落成后:

1. **单出口(Master §6.9):** 全仓 LLM 调用都经 `registry.get(actor, task)`;`grep` 无残留裸 `AsyncAnthropic(` 实例化(Master §8 功能门禁第 3 条)。
2. **provider 元数据集中:** 端点 / 鉴权 / 模型 / 能力(streaming / tools / context window)/ 成本档收成一处声明,新增 provider = 加一条注册条目,调用方零改。
3. **模型路由骨架(NFR-05):** 按任务风险/复杂度把低风险任务路由到更廉价模型;P0 提供**骨架 + 默认直通**,真正的多模型成本优化策略留 P1+。
4. **token/成本计量喂三级预算:** 每次调用产出 `UsageRecord`(input/output tokens + 估算成本),通过**注入式 sink**喂给 P0 的预算计量入口;预算**强制裁决(enforcement)**本身属 F8/P-COST,本组件只保证「每调用必计量、计量可被消费」。

非目标:不改 DeepSeek-via-Anthropic 接入形态(仍是 `AsyncAnthropic(base_url, api_key)`),不改任何调用点的 `.stream`/`.create` 签名,不引入 DB 表(计量落库属 F8 AgentRun / F10 审计)。

---

## 范围(Scope)

### In(P0 必须)
- `app/llm/` 注册表模块:`Provider` / `ModelSpec`(能力+成本档)/ `ProviderRegistry` / `registry.get(actor, task) -> LlmClient`。
- `LlmClient` 薄包装:暴露 `messages.stream(...)` 与 `messages.create(...)`,签名与 `anthropic` SDK 一致(调用方机械替换),在出口处采集 usage。
- **改接全部 7 处**裸 `AsyncAnthropic`(逐文件领任务,见「现状→改动」)。
- F1 配置块:`config.py` 增 provider-registry 声明(provider 列表 + 默认 provider + 模型路由档 + 成本档),向后兼容现有 `llm_base_url/model/api_key`。
- 模型路由骨架:`TaskClass`(风险/复杂度档)→ `ModelSpec` 选择函数,P0 默认全部走 `default` 模型。
- token/成本计量:`UsageRecord` + 可注入 `UsageSink`(默认 no-op + 结构化日志);从 `.create` 的 `resp.usage` 与 `.stream` 的 `get_final_message().usage` 采集。
- 瞬时错误重试骨架(尊重 `Retry-After`):注册表层提供**可选**退避包装,默认关闭(保持现有「失败即上抛」语义不变),为 F8 接管重试预留挂点。

### Out(明确推迟到 P1+)
- **预算的强制裁决/阻断**(超预算→结构化交接):属 **F8 Agent 引擎核心 + P-COST**;本组件只产计量,不做 enforcement。
- **计量落库 / 成本看板 / 度量**:属 F10 审计 + P4 度量;P0 仅 in-process sink + 结构化日志埋点。
- **真正的多 provider/多模型路由策略**(Anthropic 原生 / OpenAI 兼容端点、按 token 价动态选模):P0 只留可扩展骨架与一个 `deepseek` 条目。
- **per-actor/per-workspace 配额配置面**(Org/Workspace scoping):依赖 F2/F6,P0 仅在 `registry.get` 签名上预留 `actor` 参数。
- **流式 usage 的逐 token 实时累计**:P0 取流结束后 `final_message.usage` 即可;增量计量留 P1+。

---

## 现状→改动(按 PORT / REFACTOR / NEW 分组)

> 锚点全部经实际代码核验(迁移清单 §7)。7 处调用点 = 2 种模式:`messages.stream`(3 处)与 `messages.create`(4 处)。

### PORT(原样搬,形态不变)
- **P-1 接入形态:** `AsyncAnthropic(base_url=settings.llm_base_url, api_key=settings.llm_api_key)`(`app/services/auto_agent.py:34`)是 DeepSeek-via-Anthropic 的唯一正确形态,**注册表内部仍 new 这一个**;不改 SDK、不改端点契约(规格 §4.2「接入形态不变」)。
- **P-2 调用签名:** `.stream(model, max_tokens, system, [tools,] messages)` 与 `.create(model, max_tokens, system, messages)` 签名在调用点**一字不改**,只把 `_client` 换成 `registry.get(...)` 返回的 client(规格 §4.2,Master §6.9)。
- **P-3 安全敏感(Master §6.4):** API key 仅从 `settings` 注入,**永不落日志/事件/usage record**;现状 key 只在 client 构造期出现(`auto_agent.py:34` 等),注册表收敛后唯一出现处是 `app/llm/` 内部,缩小暴露面——逐字搬,不顺手改鉴权流。
- **P-4 缺 key 降级:** 4 处 `.create` 调用点现有 `if not settings.llm_api_key: return _fallback(...)`(`meeting_agent.py:100`、`drive_comment_agent.py:64`、`task_decomposition.py:104`;`delivery_doc.py` 同族)。该「无 key 即走 fallback」语义**保留**;注册表提供 `registry.is_configured(provider)` 让调用点保持等价判断,不破坏现有降级路径。

### REFACTOR(搬过来要改)
- **R-1 模块级 `_client` → 注册表取用(7 处):** 删除每个模块顶部的 `_client = AsyncAnthropic(...)`,改为在调用处 `client = registry.get(actor, task)`。逐文件:
  - `app/services/auto_agent.py:34`(模块级 `_client`)→ `run_auto` 内 `messages.stream`(`auto_agent.py:413`,tool_use loop)+ `llm_review` 内 `messages.create`(`auto_agent.py:558`)。**同文件两种模式都要改**。
  - `app/services/llm_agent.py:24`(模块级 `_client`)→ `_stream_once` 内 `messages.stream`(`llm_agent.py:154`,澄清流)。
  - `app/services/meeting_agent.py:12` → `messages.create`(`meeting_agent.py:103`)。
  - `app/services/drive_comment_agent.py:12` → `messages.create`(`drive_comment_agent.py:67`)。
  - `app/services/delivery_doc.py:23` → `messages.create`(`delivery_doc.py:78`)。
  - `app/services/task_decomposition.py:29` → `messages.create`(`task_decomposition.py:107`)。
  - `app/routers/assistant.py:29` → `messages.stream`(`assistant.py:126`)。
- **R-2 `model=settings.llm_model` 散落 → 路由决定:** 现 7 处都硬写 `model=settings.llm_model`(如 `auto_agent.py:414`、`llm_agent.py:155`、`assistant.py:127`、`meeting_agent.py:104`)。改为**不再由调用点传 model**:调用点声明 `task=TaskClass.X`,由 `LlmClient`(已绑定 `ModelSpec`)注入 `model`。调用点 `messages.stream(...)` 不再出现 `model=` 实参(或显式 `model=client.model`),消除「7 处各写一份模型名」。
- **R-3 配置块扩展(F1 协作):** `app/config.py`(现 `llm_base_url/model/api_key` 于 `:22-24`、`cors_allow_origins` 于 `:43`)增 provider-registry 声明块。保持向后兼容:若未提供新块,从旧三字段合成一个 `deepseek` 默认 provider(零配置可跑)。详见「数据与接口契约」。
- **R-4 actor 合成对接:** 现 AI 运行用伪造 `User(id="ai-auto", nickname=f"AI ({settings.llm_model})")`(`app/routers/auto.py:224`)。`registry.get(actor, task)` 的 `actor` 形参 P0 仅用于**日志/usage 归属维度**(不做权限,权限属 F6);调用点把现有 actor 字符串/User 传入即可,Org/Workspace scoping 留待 F2/F6。

### NEW(WorkHub 全新)
- **N-1 `app/llm/` 注册表模块**(无现成代码,清单 §7 NEW):`Provider`(端点+鉴权+SDK 形态)、`ModelSpec`(model 名 + 能力位 streaming/tools/context_window + 成本档 input/output 单价)、`ProviderRegistry`、模块单例 `registry`、`registry.get(actor, task)`。
- **N-2 `LlmClient` 薄包装:** 持有底层 `AsyncAnthropic` + 绑定的 `ModelSpec` + `UsageSink`;`.messages.stream(...)`/`.messages.create(...)` 透传,出口处构造 `UsageRecord` 投 sink。**关键约束:** 包装层对 `.stream` 必须返回原生 stream context manager(`auto_agent.py:413`、`assistant.py:126`、`llm_agent.py:154` 都用 `async with ... as stream`),不能破坏 `get_final_message()` / `async for event` 语义。
- **N-3 模型路由骨架:** `TaskClass`(枚举:如 `CLARIFY`/`WORKER`/`REVIEW`/`MEETING`/`DRIVE_COMMENT`/`DELIVERY_DOC`/`DECOMPOSE`/`ASSISTANT`,或更粗的 `LOW_RISK`/`STANDARD`/`HIGH`)→ `select_model(task) -> ModelSpec`。P0 实现:全部映射到 `default` 模型(等价现状),但**路由点已存在**,P1 改映射即生效(NFR-05)。
- **N-4 token/成本计量:** `UsageRecord{provider, model, task, actor, input_tokens, output_tokens, est_cost, ts}`;`UsageSink` 协议(`record(usage)`)。P0 默认 sink = 结构化日志(`logger.info("llm.usage", extra={...})`)+ 可被 F8/P-COST 替换的注入点。成本估算 = `ModelSpec` 成本档 × tokens。**事件埋点(Master §6.8):** 计量可选发 `agent.run.step` 维度的 usage 字段(由 F8 在 run 上下文聚合;本组件只产数据,不直接发 `run:{id}`,避免越界 F5/F8)。
- **N-5 瞬时错误重试骨架(Retry-After):** 现状所有 LLM 错误直接上抛/转 `failed`(`auto_agent.py:428` `except Exception` → `failed`;无 `Retry-After` 处理,清单 §7/§8)。注册表提供 `with_retry`(尊重 `anthropic.APIStatusError` 的 `Retry-After`、指数退避、上限)作为**可选包装,P0 默认不启用**(保持现有语义),挂点交 F8 在 AgentLoop 内决定何时重试(Master §7「错误传播」)。

---

## 实施步骤(有序、可勾选)

> 顺序设计:先建注册表与契约(不碰调用点)→ 逐文件机械改接(每改一处即可独立验证)→ 计量与路由骨架接入 → 全量校验单出口。每步保持闭环可跑(现有 7 条 LLM 路径任何时刻都能工作)。

- [ ] **S0 前置(F1):** 在 `app/config.py` 落 provider-registry 配置块(R-3 / N-1 契约),保留旧三字段向后兼容;补 `.env.example` 注释。
- [ ] **S1 建注册表骨架(N-1/N-2):** 新建 `app/llm/__init__.py`(导出 `registry`)、`app/llm/registry.py`(`Provider`/`ModelSpec`/`ProviderRegistry`/`registry.get`)、`app/llm/client.py`(`LlmClient` 薄包装)。内部仍 `AsyncAnthropic(base_url, api_key)`。单测:`registry.get(actor, TaskClass.X)` 返回可用 client,`.model` 等于路由结果。
- [ ] **S2 计量与路由骨架(N-3/N-4):** 实现 `select_model(task)`(P0 全直通 default)、`UsageRecord`/`UsageSink`(默认日志 sink)、`LlmClient` 出口采集 usage。单测:create/stream 两路均产 `UsageRecord`,key 不出现在 record 字段。
- [ ] **S3 改接 `.create` 4 处(机械,低风险先行):**
  - [ ] `meeting_agent.py:12 + :103`(保留 `:100` 无 key fallback → `registry.is_configured`)
  - [ ] `drive_comment_agent.py:12 + :67`(保留 `:64` fallback)
  - [ ] `delivery_doc.py:23 + :78`
  - [ ] `task_decomposition.py:29 + :107`(保留 `:104` fallback)
- [ ] **S4 改接 `.stream` 3 处(注意 context manager 语义,P-2/N-2):**
  - [ ] `llm_agent.py:24 + :154`(`async with ... as stream` + `async for event`)
  - [ ] `routers/assistant.py:29 + :126`(SSE 流,`async with ... as stream`)
  - [ ] `auto_agent.py:34 + :413`(tool_use loop,`get_final_message()`)**且**`auto_agent.py:558` 的 `llm_review` `messages.create`(同文件双模式)
- [ ] **S5 去 `model=settings.llm_model` 散落(R-2):** 7 处调用点改由 client 注入 model;`grep -n "model=settings.llm_model" app/` 应清零(或仅剩注册表内部一处)。
- [ ] **S6 单出口校验(Master §8 第 3 条):** `grep -rn "AsyncAnthropic(" app/` 仅命中 `app/llm/`;`grep -rn "from anthropic import AsyncAnthropic" app/services app/routers` 应清零。补一条**仓库守卫测试**(test 断言 `app/services`、`app/routers` 下无 `AsyncAnthropic(` 字面量)防回归。
- [ ] **S7 回归:** 跑现有 7 条路径的最小回归(澄清流、worker loop、review、会议、网盘评论、交付文档、任务分解、助手),确认 SSE thinking/text 事件、JSON 解析、无 key fallback 全部不变。

---

## 数据与接口契约

> 跨组件共享处以 Master + 规格为准:**预算 enforcement** 归 F8/P-COST(本组件只产 usage);**事件 topic/类型** 归 F5(本组件只在 usage 上打 task/actor 维度,由 F8 聚合进 `agent.run.step`);**actor 身份** 归 F4(本组件只取归属维度,不做鉴权)。

### 实体 / 内存结构(P0 不落库)
```python
# app/llm/registry.py
@dataclass(frozen=True)
class ModelSpec:
    model: str                 # e.g. "deepseek-v4-pro"
    streaming: bool = True
    tools: bool = True
    context_window: int = 128_000
    cost_in_per_mtok: float = 0.0   # 成本档:输入 每百万 token 单价
    cost_out_per_mtok: float = 0.0  # 成本档:输出 每百万 token 单价

@dataclass(frozen=True)
class Provider:
    name: str                  # "deepseek"
    base_url: str              # settings.llm_base_url
    api_key: str               # settings.llm_api_key（仅内部持有，永不外泄）
    models: dict[str, ModelSpec]
    default_model: str

@dataclass(frozen=True)
class UsageRecord:
    provider: str; model: str; task: str; actor: str | None
    input_tokens: int; output_tokens: int
    est_cost: float            # = (in*cost_in + out*cost_out)/1e6
    ts: datetime               # timezone-aware（Master §6.2 timestamptz 口径）
```

### 配置 schema(F1,`app/config.py` 增量;向后兼容)
- 新增(可选块):`llm_default_provider: str = "deepseek"`、`llm_providers`(provider→{base_url,api_key,models,default_model,成本档})、`llm_task_routing`(TaskClass→model 名,缺省全 default)。
- **向后兼容铁律:** 若 `llm_providers` 未配置,从现有 `llm_base_url/llm_model/llm_api_key`(`config.py:22-24`)合成单 `deepseek` provider + 单 `default` ModelSpec → 零配置等价现状。成本档默认 0(计量产 record 但 est_cost=0,不阻断)。
- 仍遵守 F1 生产门:不引入新的 `*` 通配/默认密钥豁免;key 缺失沿用现有「fallback / 不调用」语义。

### API(注册表对内接口,非 HTTP)
```python
registry.get(actor: str | None, task: TaskClass) -> LlmClient
registry.is_configured(provider: str | None = None) -> bool   # 替代散落的 `if not settings.llm_api_key`
LlmClient.messages.stream(*, max_tokens, system, messages, tools=None) -> AsyncStreamCtx  # model 由 client 注入
LlmClient.messages.create(*, max_tokens, system, messages) -> Message
registry.set_usage_sink(sink: UsageSink) -> None              # F8/P-COST 注入计量消费者
```
> **P0 不新增任何对外 HTTP 端点**;daemon API 面变化属 F11。

### Alembic
- **本组件无迁移**(P0 计量不落库)。若 P1 将 `UsageRecord` 持久化,迁移归 F8 AgentRun/AgentStep 或 F10 审计的迁移,不在 F07 内新建表。

### 事件 topic(对齐 Master §6.8 taxonomy)
- 本组件**不直接 publish**。usage 维度(task/model/tokens/cost)作为字段,由 **F8** 在 `agent_run.step` 事件(SSE 事件 type 权威以 [api-contract §5.2] 为准;对应 Master §6.8 taxonomy 的 `agent.run.step`)上携带;`auto_agent.py` 现有 `ai.tool_call`/`ai.text` 事件(`req:{id}`)不受影响(其 topic 改名 `req:{id}`→`run:{run_id}` 属 F8,经 **F5** broker 扇出)。

---

## 验收用例(可测)

> 对齐 Master §8 功能门禁第 3 条与 §6.9。

- [ ] **AC-1 单出口(grep 红线):** `grep -rn "AsyncAnthropic(" app/services app/routers` 无命中;唯一命中在 `app/llm/`。守卫测试常驻 CI(F1 最小 CI)。
- [ ] **AC-2 七路径等价:** 改接后 7 条 LLM 路径行为不变 —— 澄清流仍发 `thinking`/`text`/`parsed` 事件(`llm_agent` 契约)、worker loop 仍走 tool_use(`auto_agent`)、`llm_review` 仍返回 `(bool, reason)`、4 个 `.create` 路径产物结构不变。
- [ ] **AC-3 无 key 降级保留:** 清空 `llm_api_key`,`meeting_agent`/`drive_comment_agent`/`task_decomposition` 仍走各自 `_fallback`(`:100`/`:64`/`:104`),不抛异常。
- [ ] **AC-4 计量产出:** 一次 `.create` 与一次 `.stream` 调用各产恰好一条 `UsageRecord`,`input_tokens`/`output_tokens` 来自 `resp.usage` / `final_message.usage`,`est_cost` = 成本档算式;注入测试 sink 可捕获。
- [ ] **AC-5 key 不泄漏:** `UsageRecord` 序列化与默认日志 sink 输出中**不含** api_key 子串;断言测试。
- [ ] **AC-6 路由骨架可切换:** 把 `llm_task_routing[WORKER]` 指向另一 model 名,`registry.get(actor, WORKER).model` 即变;默认配置下全部 = `default_model`(等价现状)。
- [ ] **AC-7 stream 语义完整:** 包装后的 `.stream` 仍支持 `async with ... as s: await s.get_final_message()`(auto_agent)与 `async for event in s`(llm_agent/assistant),无回归。
- [ ] **AC-8 向后兼容零配置:** 不提供 `llm_providers`,仅旧三字段,注册表自合成 `deepseek/default`,7 路径全通。

---

## 回滚与风险

### 回滚
- 改动是**纯进程内、无 DB 迁移、无 API 面变化**,回滚 = revert 代码:`app/llm/` 删除 + 7 文件恢复模块级 `_client`。配置块向后兼容,旧 `.env` 无需改。可**逐文件回滚**(每个调用点独立),不存在「半迁移即坏」的不可逆点。
- 因 7 处独立、签名不变,可灰度:先改 4 个 `.create`(低风险、非流),验证后再改 3 个 `.stream`(含 SSE 与 tool_use,语义最敏感)。

### 风险
- **R-A 面广易半成(清单 §7 首要风险):** 7 文件 2 模式,漏一处即**静默绕过治理**(无编译错、无运行错,只是该调用不计量/不路由)。**缓解:** S6 grep 红线 + AC-1 守卫测试常驻 CI;实施步骤逐文件勾选,不允许「批量一把梭」。
- **R-B stream 包装破坏 SDK 语义:** 三处 `.stream` 依赖 `async with` + `get_final_message()`/`async for`。包装若返回非原生 context manager 会**静默改变流行为**(thinking 事件丢失 / final message 拿不到)。**缓解:** `LlmClient.stream` 直接透传底层 stream context(只在 `get_final_message`/流结束钩子里采 usage),AC-7 专测。
- **R-C key 泄漏新面:** 计量/路由引入新的对象(UsageRecord、日志),误把 key 带进 record/日志即新泄漏面(违 Master §6.4/§6.5 精神)。**缓解:** Provider 持 key 不进任何可序列化输出;AC-5 断言。
- **R-D 越界 F8/F5:** 「计量喂预算」易顺手把 enforcement / 事件 publish 一起做,导致与 F8/F5 边界冲突或重复。**缓解:** 本组件只产 `UsageRecord` + 暴露 `set_usage_sink` 注入点;enforcement 与 `run:{id}` publish 明确划给 F8/F5(本 plan「Out」+「事件 topic」已声明)。
- **R-E 时间口径(Master §6.2):** `UsageRecord.ts` 必须 timezone-aware,勿沿用现仓遍布的 naive `datetime.utcnow()`(清单 §2 RISK),否则 P1 落库与 timestamptz 冲突。**缓解:** record 用 aware now;单测断言 tzinfo 非空。

---

## 依赖与被依赖

### 依赖(本组件需要)
- **F1 仓库/配置:** provider-registry 配置块、`pydantic-settings`、F1 最小 CI(承载 AC-1 守卫测试)。这是唯一硬依赖(Master §5.1:F7 仅依赖 F1,不依赖 DB,可与 F3–F5 并行)。

### 被依赖(谁需要本组件)
- **F8 Agent 引擎核心:** 通过 `registry.get(actor, task)` 取 client;接管**重试决策**(消费 N-5 骨架)与**预算 enforcement / usage sink 注入**(消费 N-4);worker loop 与 `llm_review` 是本组件最敏感的改接点(`auto_agent.py:413/:558`)。
- **F10 审计 / P4 度量:** 若 P1+ 将 usage 落库 / 上看板,以本组件 `UsageRecord` 为数据源。
- **F9 / 其余 service 路径:** 会议、网盘评论、交付文档、任务分解、澄清、助手 6 条非 worker 路径在 P0 即改接完成,后续这些 service 的任何演进都经注册表。
- **P-COST(P1+):** 三级预算(用户/团队/任务)以本组件计量为输入(规格 §4.2「预算挂钩」)。

### 协同约束
- **与 F8 边界:** 本组件提供「取 client + 产计量 + 路由骨架 + 重试骨架」;F8 提供「何时重试 / 是否超预算阻断 / 把 usage 聚合进 AgentRun」。两者通过 `set_usage_sink` 与 `with_retry` 挂点解耦,可独立推进。
- **与 F1 边界:** 配置 schema 的 owner 是 F1;本组件提供字段诉求(provider/model/成本档/路由表),F1 落进 `config.py` 并守生产门。
