---
module: P-AI
layer: L2
status: 🚧
owner: workflow
related:
  - ../../prd/2026-06-04-workhub-prd.md            # §8.10 FR-EXPLAIN-001 / §8.1-8.2 FR-WORKER-002 / FR-ESC-001
  - ../README.md                                    # 模块地图 P-AI
  - ./confidence-risk-escalation.md                 # 字段权威(rationale_md / signals_json / verdict / trigger)
  - ../01-architecture/data-model.md                # 实体/字段 ER 收口
  - ../00-overview/glossary-dejargon.md             # 去黑话三档语气
  - app/services/knowledge.py                       # grep 语料/检索/强制引用(本篇主锚)
  - app/routers/assistant.py                        # 证据块注入 + 解析兜底 + generic 错误
  - app/prompts/assistant_system.md                 # "never invent project facts" 铁律
  - app/services/auto_agent.py                      # llm_review / AutoResult / push_bus trace 事件
  - app/services/meeting_agent.py                   # "Never directly modify a requirement" 先例
  - app/models.py                                   # KnowledgeAskRun / MeetingInsight / RevisionRequest
  - app/schemas.py                                  # KnowledgeSearchHit
---

# 可解释性与知识(Explainability & Knowledge)

> **一句话**:WorkHub 里 AI 做的每个会影响业务的判断——**为何派此人 / 为何升级 / 为何判不合格**——都必须同时产出**人话理由(reason)+ 可点开核对的证据(evidence)+ 可回放的过程(trace)**;证据只能来自 **grep 知识库**(延续 D-4「无向量库」范式),不允许凭空臆造事实。
>
> 本篇把这套机制讲透:规则、数据流、失败处理。它服务 PRD **FR-EXPLAIN-001 / FR-WORKER-002 / FR-ESC-001**(见 [PRD §8.10/§8.2/§8.1](../../prd/2026-06-04-workhub-prd.md))。
>
> **范围边界**:本篇只写"**如何解释 + 知识从哪来**"。决策本身怎么算(置信度公式、风险维度、分级阈值、三触发器)在 [confidence-risk-escalation.md](./confidence-risk-escalation.md);派活匹配逻辑在 [smart-staffing.md](./smart-staffing.md);Agent 循环与工具在 [agent-loop-and-tools.md](./agent-loop-and-tools.md)。本篇引用它们的产物,不重复其内部算法。术语以 [glossary-dejargon.md](../00-overview/glossary-dejargon.md) 为准,实体字段以 [data-model.md](../01-architecture/data-model.md) 为准,接口与事件以 [api-contract.md](../01-architecture/api-contract.md) 为准。
>
> **参照代码(已读以扎根)**:本篇所有 `auto_agent.py` / `knowledge.py` / `meeting_agent.py` 指 `app/services/` 下同名文件;`assistant.py` 指 `app/routers/assistant.py`;`assistant_system.md` 指 `app/prompts/assistant_system.md`;`models.py` / `schemas.py` 指 `app/` 根下。后文为简洁多用裸文件名,完整路径以本声明与 frontmatter `related` 为准。
>
> **字段名对齐声明**:`ConfidenceRecord` / `EscalationEvent` 的字段以 [confidence-risk-escalation.md](./confidence-risk-escalation.md) §2 与 [data-model.md](../01-architecture/data-model.md) 为权威。本篇的"可解释三元组"(reason+evidence+trace)是**呈现层概念**,落到权威字段上即:人话理由 = `ConfidenceRecord.rationale_md` / `EscalationEvent.reason_md`;结构化信号 = `signals_json`;升级交接件 = `EscalationEvent.handoff_md` / `handoff_json`。本篇不另造同义字段名(见第 2.2 节映射表)。

---

## 0. 为什么可解释性是 P0 而非锦上添花

PRD 的产品宪法第 5 条是一条法律:**「AI 绝不静默改生产态」——任何 AI 改动都可解释(为什么)、可回滚(快照)、经审批才汇入 main。** 这条法律延续自现有代码里一处真实约束:`meeting_agent.py` 的 system prompt 明文写着 *"Never directly modify a requirement. Only produce suggestions that a human can confirm."* WorkHub 把这条从"会议洞察"这一个场景,升格为**所有 AI 决策的全局默认**。

可解释性是这条法律的**前半句**(可回滚是后半句,见 [P-AUDIT / data-model](../01-architecture/data-model.md))。它直接服务三个产品风险(PRD §14):

- **信任崩塌**:AI 过度自信发垃圾 → 用户退回手动。透明的理由 + 证据让用户能**快速判断该不该信**,而不是盲目接受或盲目拒绝。
- **冷启动**:无历史数据时派活会失准 → 降级为「解释式推荐」(`smart-staffing`),**让人凭理由决定**,而非"AI 替你定"。这里可解释性是降级的*载体*。
- **升级精准度**(成功度量):要复盘"该升级时升没升、不该时有没有误升",前提是每次升级都留下了**为什么**。

> 反面教训也来自现有代码:`assistant.py` 注释强调"客户端只收到 generic、user-facing 的错误,不把 raw exception 放上线"——**可解释 ≠ 把内部细节(数值阈值、异常栈、git 黑话)倒给用户**。解释的对象是"判断依据",不是"实现内幕"。

---

## 1. 三个可解释决策面(What must be explained)

WorkHub 有三个 AI 自治决策点必须可解释。下表把每个决策、它的现有代码锚点、以及它要回答的"人话问题"对齐:

| 决策 | 用户问的问题 | 判定在哪 | 现有代码先例 |
|---|---|---|---|
| **为何派此人** | "凭什么推荐他做?" | [smart-staffing.md](./smart-staffing.md) | (新增)——延续 `MeetingInsightDecision.confidence_reason` 的"附理由"范式 |
| **为何升级** | "为什么这事 AI 不自己干、要找人?" | [confidence-risk-escalation.md](./confidence-risk-escalation.md) 三触发器 | `auto_agent.py` `AutoOutcome.reason` / `RevisionRequest.reason_md` |
| **为何判不合格** | "AI 说这交付物不行,哪不行?" | `llm_review`(`auto_agent.py:544`) | `llm_review` 已返回 `(meets_requirement, reason)` |

这三者共享**同一套可解释性原语**(第 2 节)。它们各自的"判定逻辑"在兄弟文档里;本篇只规定**判定的产物长什么样、存哪、怎么呈现**。

---

## 2. 可解释性原语:Reason + Evidence + Trace(How to explain)

任何一个 AI 决策的可解释产物 = 一个三元组。这不是新发明——它是现有 `KnowledgeAskRun` 的直接推广。

### 2.1 现有真实先例:`KnowledgeAskRun`

知识库问答(`models.py:128`)已经把"可解释回答"落成了三列:

```text
KnowledgeAskRun
├── answer_md       : 人话结论(Markdown)
├── citations_json  : 证据数组(KnowledgeSearchHit[],含 source_url / line_no / snippet)
└── trace_json      : 过程(本例:[{"tool":"grep_corpus","query":..., "hit_count":N}])
```

`services/knowledge.py:answer_from_hits()` 一次性返回这三者:`(answer_md, citations, trace)`。这就是 WorkHub 全局可解释性的**模板**。

### 2.2 推广为 `Rationale` 三元组(呈现层概念 → 权威字段)

WorkHub 把每个可解释决策的产物规范为一个 **`Rationale` 三元组**(reason + evidence + trace)。**`Rationale` 是呈现层概念,不是新表**——它落到 [confidence-risk-escalation.md](./confidence-risk-escalation.md) §2 与 [data-model.md](../01-architecture/data-model.md) 已收口的 `ConfidenceRecord` / `EscalationEvent` 字段上。下表把三元组逐项映射到**权威字段名**(左)、说明(中)、现有先例(右),**本篇不另造同义字段**:

| 权威字段(以 confidence-risk-escalation / data-model 为准) | 三元组角色 + 含义 | 现有先例 |
|---|---|---|
| `rationale_md`(`ConfidenceRecord`)/ `reason_md`(`EscalationEvent`) | **reason** = **人话**结论:一句到一段,用户语言,**不含数值阈值/黑话** | `KnowledgeAskRun.answer_md`、`MeetingInsightDecision.confidence_reason`、`AutoOutcome.reason` |
| `signals_json`(JSONB)— 其内一个 `citations` 子键 | **evidence** = 证据数组,每条 = `KnowledgeSearchHit`(`schemas.py:416`):`{source_type, source_url, line_no, snippet, …}`,**可点开跳原文** | `KnowledgeAskRun.citations_json` |
| `agent_run_id`(FK)→ `AgentRun.trace` | **trace** = 指向产出该结论的那次执行的可回放过程(第 4 节);零成本 run(如纯派活)可在 `signals_json.trace` 内联轻量步骤数组 | `KnowledgeAskRun.trace_json` |
| `signals_json.*`(其余键) | (可选)结构化输入信号摘要,如 review 是否过、清单命中率、匹配的技能标签——**供看板聚合,不直接展示数值给小白** | confidence-risk-escalation §2.1 `signals_json` |

> **为何不立独立字段 `summary_md`/`citations`/`signals`**:命门篇已把人话理由收口为 `rationale_md`/`reason_md`、把可审计依据收口为 `signals_json`。本篇若另起字段名会造成两份规格对同一列的命名分裂。故 `citations` 作为 `signals_json` 的一个约定子键存在,落库形态(独立 citations 表 vs 内嵌 JSON)仍是开放问题 **EX-1**,与 [data-model.md](../01-architecture/data-model.md) 共定。

**硬规则**:

1. **任何写入 `ConfidenceRecord` / `EscalationEvent` / 派活提议的决策,`rationale_md`(升级走 `reason_md`)必填、非空。** 这对应现有 `MeetingInsight.confidence_reason`(`models.py:302`)从一开始就是模型必填字段的做法。
2. **人话理由用用户语言**——延续 `assistant_system.md` 的 *"Mirror the user's language"* 与 `llm_review` REVIEW_SYSTEM 的 *"Write the reason in the user's language"*。
3. **人话理由去黑话**:不出现 merge / branch / 置信度=0.72 / doom-loop 等术语,只说"我比较有把握,但建议你扫一眼"。映射规则以 [glossary-dejargon.md](../00-overview/glossary-dejargon.md) 为权威。
4. **凡涉及项目事实的断言,必须能落到 `signals_json.citations`**;不能落证据的事实陈述视为臆造,见第 3.4 节的失败处理。

---

## 3. 知识范式:grep + 强制引用(无向量库)

证据(`citations`)的唯一来源是 **grep 知识库**。这是 PRD **D-4 [决策]** 的硬约束,WorkHub 完整延续现有 `services/knowledge.py` 的实现,不引入向量库 / embedding。

### 3.1 语料怎么来:DB → Markdown 镜像

`rebuild_knowledge_index()`(`knowledge.py:300`)把结构化业务数据**导出成扁平 Markdown 文件**,落到 `CORPUS_ROOT`(`{data_dir}/knowledge_corpus/<source_type>/<source_id>.md`)。覆盖的 `source_type` 一字不差来自 `_source_docs()`:

```text
project · requirement · chat · comment · activity ·
workspace_update · meeting · meeting_insight · drive_file · delivery
```

每条导出物同时写一行到 `KnowledgeDocument`(`models.py:110`),记录 `source_url`、`content_hash`(sha256)、`corpus_path`。索引刷新策略(现有,WorkHub 沿用):

- **不在每次搜索时重建**——`knowledge.py:437` 的注释把"每次搜索都 rebuild"列为已修复的 self-DoS;改由 `_periodic_knowledge_reindex`(5 分钟,`main.py` lifespan)+ 管理员手动 `POST /api/knowledge/reindex` 驱动。
- **去重 + append-only 心智**:`content_hash` 去重;陈旧行用"先删 DB row、commit、再 unlink 文件"的两阶段清理(`knowledge.py:326` 注释),避免 commit 失败后复活一个文件已不在的行。

> **WorkHub 演进点**:新增 `branch` / `proposal` / `spec_doc(README)` 等实体(见 [data-model.md](../01-architecture/data-model.md))后,`_source_docs()` 需相应扩列,让"为何升级/为何判不合格"能引用到提议正文与规格页。这是纯增量改动,范式不变。

### 3.2 检索:ripgrep 优先,纯 Python 兜底

`search_knowledge()`(`knowledge.py:425`)两段式:

1. **首选 `rg --json`**(`_rg_hits`,`knowledge.py:385`):对 `CORPUS_ROOT` 跑 ripgrep,`timeout=8s`,把命中行映射回 `KnowledgeDocument` 得到 `source_url` + `line_no`。
2. **兜底纯 Python**:`rg` 不在 PATH 或无命中时,用 `_tokens()` 切词(中英混合,`[\w一-鿿]{2,}`,最多 8 token)逐文件 `re.search`。

**两道安全过滤(WorkHub 必须延续)**:

- **软删除隔离**:archived / `deleted_at` 的项目一律排除(`_source_docs` 与 `search_knowledge` 的 join 条件)。
- **行级可见性**:`_requirement_visible()` → `can_view_requirement_record()` 按当前 user 过滤,**防跨用户泄漏**(对应 NFR-08)。这意味着:**同一条决策,呈现给不同审批人时,citations 可能因可见性不同而被裁剪**——解释必须在调用者身份下生成,不能缓存成"对所有人一样"。

### 3.3 强制引用:回答必须带证据,否则明说"没有依据"

`answer_from_hits()`(`knowledge.py:489`)是"强制引用"的样板,WorkHub 所有"为何"解释都遵循它的两条铁律:

- **有命中**:结论后必跟 `## 证据` 区块,逐条 `[标题](source_url) · source_type · 第 N 行` + snippet,**可点回原文核对**。
- **零命中**:**绝不编**——直接回 *"没有找到可靠依据。可以换一个更具体的关键词……"*。这与 `assistant_system.md` 的 *"If the evidence does not contain the answer, say so plainly; never invent project facts."* 完全一致。

`assistant.py:_evidence_block()`(`assistant.py:78`)演示了如何把 grep 命中**作为证据块注入 LLM 上下文**:取最近一句用户问题 grep → 格式化为 `# Project evidence (… cite the items you use)` → 拼进 user turn。WorkHub 的三个决策点(派活/升级/判不合格)在喂模型时,同样把相关 grep 命中作为 evidence block 注入,并要求模型在 `rationale_md` 里引用它们。

### 3.4 失败处理:解释链路本身的降级

可解释性是 P0,但它**不能反过来阻断主流程**。失败处理遵循现有代码的既定姿态:

| 失败 | 现有处理 | WorkHub 规则 |
|---|---|---|
| grep 子进程异常/超时(8s) | `_rg_hits` `except: return []`,落到 Python 兜底 | 同;兜底也空 → 进入"零命中"分支 |
| 语料缺失(刚写完还没 reindex) | `knowledge.py:447` 注释:接受"几分钟内搜不到",下次搜索补上 | 同;`rationale_md` 可注明"依据可能尚未入索引" |
| 决策模型输出无法解析 | `_safe_parse`(`assistant.py:54`)/ `llm_review` `except: return False, "复审输出无法解析"` | 解析失败 → **`rationale_md` 退化为原始文本兜底**(`assistant.py:145` "Never strand the user on a parse miss"),决策本身按保守档处理(见 confidence-risk-escalation) |
| 证据为空但模型仍下了事实断言 | (新增校验) | **拦截**:`signals_json.citations` 为空时,`rationale_md` 不得包含项目事实声明,只能给"无依据"措辞;违反则按零命中处理 |

> 注意区分**两类 trace**:`KnowledgeAskRun.trace_json` 在失败时仍如实记录 `hit_count:0`;而面向用户的错误一律 generic(`assistant.py:151` "assistant temporarily unavailable",full detail 只进 server log)。**trace 给审计看,错误文案给用户看。**

---

## 4. AgentRun trace 的产生与呈现(How to replay)

"为何判不合格"这类涉及 AI **执行过程**的解释,光有结论不够,还要能**回放每一步**。这对应 PRD **FR-WORKER-002**:每次 AgentRun 产生完整 trace(每步动作 + 工具输入输出)可供人审。

### 4.1 trace 怎么产生:从 `push_bus` 事件流落库

现有 `auto_agent.py` 的工人循环**已经在实时广播每一步**到 `push_bus`,topic = `req:<id>`:

```text
ai.started   {max_turns, timeout_s}          # run 开始
ai.thinking  {turn, text[:200]}              # 模型思考(thinking_delta)
ai.text      {turn, text[:200]}              # 模型自然语言输出
ai.tool_call {turn, name, input_preview[:200]}  # 每次工具调用 + 入参预览
ai.done      {turns}                         # run 结束
```

这股事件流今天**只用于前端实时渲染"AI 处理中…"**,是瞬时的(SSE,见 [api-contract.md](../01-architecture/api-contract.md) 事件清单与 `push_bus`)。WorkHub 的演进是把它**同时落库为 `AgentRun.trace`**(见 [data-model.md](../01-architecture/data-model.md) 的 `AgentRun` 实体,演进自 `auto_agent`),使其可事后回放、可审计、可作为 `Rationale` 三元组里 trace 角色的目标(经 `ConfidenceRecord.agent_run_id` / `EscalationEvent.agent_run_id` 关联)。

**一步 trace 记录的最小字段**(对齐现有事件 + 补齐工具结果):

| 字段 | 来源 |
|---|---|
| `step` / `turn` | `auto_agent` 循环计数(`for turn in range(1, MAX_TURNS+1)`) |
| `kind` | `thinking` / `text` / `tool_call` / `tool_result` / `submit` |
| `tool_name` + `input` | `ai.tool_call` 的 `name` / `input`(现广播时截断 200,落库存完整) |
| `tool_result` | 现循环里 `tool_results` 的 `content`(落库;长输出按 `COMMAND_OUTPUT_LIMIT=12000` 截断标注) |
| `ts` | 步骤时间戳 |

> **隐私**:落库的 trace 含工具读到的文件内容片段,按 `AgentRun` 归属的 WorkItem 做身份隔离(NFR-08),呈现时复用第 3.2 的可见性过滤。

### 4.2 终态与"为何不合格"的结构化结论

run 结束后,`auto_agent` 已产出结构化终态,直接喂进 trace 的头部摘要与人话理由(`rationale_md`):

- `AutoResult`(`auto_agent.py:364`):`success / reason / notes / turns / seconds / file_count`。`reason` 已是人话(如 *"达到最大轮次 15 未完成"*、*"AI 调用 submit 但产物目录为空"*)。
- `llm_review`(`auto_agent.py:544`)→ `(meets_requirement, reason)`:这就是**"为何判不合格"的权威理由来源**。REVIEW_SYSTEM 强制输出 `{"meets_requirement", "reason"}` 且 reason 用用户语言。
- `AutoOutcome`(`auto_agent.py:591`):合并执行 + 复审,`reason`(*"LLM 复审通过/不通过"*)+ `review_reason`。

**超预算的优雅降级(FR-WORKER-003)**:现有循环对 timeout / MAX_TURNS / 单轮 LLM 超时,都走 `_result(False, "…")` 返回**带原因的结构化结果**而非静默截断。WorkHub 在此之上,按 PRD 要求把它整理为「已做 / 未做 / 下一步」交接件——这属于 [agent-loop-and-tools.md](./agent-loop-and-tools.md) 的预算机制,本篇只声明:**该交接件即是升级时 `rationale_md` / `reason_md` 的内容来源之一**,与 [confidence-risk-escalation.md](./confidence-risk-escalation.md) 的 `EscalationEvent.handoff_md` / `handoff_json` 同源。

### 4.3 呈现:三种受众,三种粒度

同一份 trace,对不同受众呈现不同粒度(去黑话原则贯穿):

| 受众 | 看到的 | 载体 |
|---|---|---|
| **小白 / 提交者** | 只看 `rationale_md` 一句话 + (可选)"看看 AI 是怎么做的"折叠入口 | 桌宠 / web 工单页 |
| **负责人 / 审批人** | `rationale_md` + `signals_json.citations`(可点开核对) + 可展开的 trace 步骤列表 | web Proposal 审查页 |
| **管理员 / 复盘** | 全量 trace + `signals_json` 聚合 + 跨 run 的升级精准度 | [dashboards-and-metrics.md](../04-modules/dashboards-and-metrics.md) 看板(NFR-11) |

实时态沿用现有 SSE:web 订阅 `req:<id>`(WorkHub 命名见 [api-contract.md](../01-architecture/api-contract.md))渲染流式 `ai.thinking/ai.text/ai.tool_call`;事后态从落库的 `AgentRun.trace` 回放。两者同源,只是"现在进行时"vs"录像回放"。

---

## 5. 端到端数据流(把三层串起来)

以 **J3 升级路径**(PRD §9)里"AI 判不合格 → 升级"为例,可解释性数据流:

```text
AgentRun 执行
  │  ① 每步 → push_bus(req:<id>) ──实时──> web "AI 处理中…"
  │                              └─落库──> AgentRun.trace            [FR-WORKER-002]
  ▼
llm_review() → (meets_requirement=false, reason="缺少 X 字段…")     ← 为何不合格
  │
  ▼
ConfidenceRecord 生成(grade=low / verdict=escalate → 触发器 unqualified 命中)
  │  rationale_md            = 人话(由 reason + handoff 整理)
  │  signals_json.citations  = grep 知识库相关命中(强制引用)      [D-4]
  │  agent_run_id            → 指向上面的 AgentRun.trace
  ▼
EscalationEvent 创建 → WorkItem 切 pm_mode                          [FR-ESC-002]
  │  reason_md/handoff_md = 同源(为何升级 = 为何不合格 + 风险)
  ▼
AI 项目经理简报(FR-PM-001)+ 智能派活提议(为何派此人,各带同构 Rationale 三元组)
  ▼
呈现:小白看 rationale_md;负责人看 rationale_md+citations+trace    [§4.3]
```

注意三个"为何"在这条链上**复用同一个 `Rationale` 结构、同一套 grep 证据、同一份 trace 引用**——这正是把可解释性抽成原语(第 2 节)而非给每个决策各写一套的价值。决策的*阈值与触发逻辑*全部委托给 [confidence-risk-escalation.md](./confidence-risk-escalation.md);本篇保证的是:**无论哪个决策点,输出的解释结构一致、证据来源一致(grep)、可回放路径一致(trace)。**

---

## 6. 设计约束清单(给 plan 阶段的硬边界)

1. **无向量库**(D-4):证据只走 `services/knowledge.py` 的 grep 链路;扩展只允许加 `source_type`,不允许换检索范式。
2. **强制引用**:涉及项目事实的 `rationale_md` 必须有对应 `signals_json.citations`;零命中必须明说"无依据",禁止编造(`assistant_system.md` 铁律)。
3. **`rationale_md`(升级走 `reason_md`)必填、用用户语言、去黑话**(延续 `confidence_reason` / `llm_review` / `assistant_system.md`)。
4. **trace 必产**(FR-WORKER-002):AgentRun 每步落库,超预算也要带原因的结构化交接件而非静默截断(FR-WORKER-003)。
5. **身份隔离**:证据检索与 trace 呈现都在调用者身份下做可见性过滤(`can_view_requirement_record`,NFR-08)。
6. **解释 ≠ 暴露内幕**:数值阈值、异常栈、git 黑话不上线;用户文案 generic,细节进 server log / 审计 trace(`assistant.py` 既定姿态)。
7. **可解释不阻断主流程**:解释链路任一环失败都按第 3.4 表降级,决策按保守档继续。

---

## 7. 开放问题(汇总至 [07-open-questions.md](../07-open-questions.md))

- **EX-1** `citations` / trace 的落库形态:作为 `signals_json` 的内嵌子键 vs 独立 citations 表?倾向内嵌(对齐 `KnowledgeAskRun.citations_json/trace_json` 的内嵌先例),最终归属与 `signals_json` schema 待 [data-model.md](../01-architecture/data-model.md) + [confidence-risk-escalation.md](./confidence-risk-escalation.md) §2 共定。
- **EX-2** trace 留存与体积:长 run 的 trace 可能很大,保留期 / 截断策略 / 冷归档?
- **EX-3** `signals_json` 展示边界:看板里给管理员看多细的数值(命中率、置信分),而不破坏"对用户去黑话"?与 [dashboards-and-metrics.md](../04-modules/dashboards-and-metrics.md) 共定。
- **EX-4** 派活/升级证据的语料覆盖:需补 `branch/proposal/spec_doc` 进 `_source_docs()` 才能引用到——纳入 P2/P3 范围。
