---
module: 00-overview
layer: L0-L5（全局总纲）
status: 🚧
owner: workflow
related:
  - ../../prd/2026-06-04-workhub-prd.md            # 上游 PRD（§3 愿景定位、§5 产品宪法）
  - ../README.md                                    # 规格树索引（模块地图 + 本篇范围界定）
  - ./glossary-dejargon.md                          # 术语去黑话对照（权威版）
  - ./personas-and-jtbd.md                          # 画像与 JTBD
  - ../01-architecture/system-architecture.md       # daemon + clients 总图
  - ../01-architecture/data-model.md                # 全量实体 + WorkItem 状态机
  - ../01-architecture/api-contract.md              # OpenAPI 路由组 + 事件类型
---

# WorkHub —— 愿景与产品宪法

> **本篇是 WorkHub 的「宪法层」文档**:愿景、北极星、产品宪法×5、定位、非目标。
> 它把 [PRD §3 / §5](../../prd/2026-06-04-workhub-prd.md) 展开为**可被全树引用的权威版**——
> 后续任何模块文档遇到「为什么这么设计」的归因,都应回链到本篇的某一条宪法,而非各自重新论证。
> 术语统一以 [glossary-dejargon.md](./glossary-dejargon.md) 为准;架构落地细节见 [01-architecture/](../01-architecture/system-architecture.md)。

---

## 0. 一句话与本篇的地位

**WorkHub = 业务版 GitHub × AI-native 工作中台。AI 是默认劳动力(直接产出交付物),人是审批者与异常处理者。**

这是一次**角色反转**:把现有「需求管理大师」从"**人干活、AI 打下手**"翻转为"**AI 干活、人把关**"。
本篇定义这次反转的**价值主张(愿景)、唯一度量(北极星)、不可违背的设计裁决基准(宪法×5)、对内/对外定位、以及 v1 明确不做的事(非目标)**。

> **本篇是裁决基准,不是功能清单。** 当下游设计出现冲突(例如"为了体验要不要让 AI 自动合并"),以本篇宪法为最高裁决依据;若宪法之间冲突,以**北极星**为终极仲裁。

---

## 1. 愿景(Vision)

### 1.1 完备叙述

今天的协作工具(无论需求管理大师还是飞书 / Notion / Jira)有一个共同的隐含前提:**人是默认劳动力**。工具负责记录、流转、提醒、可视化,但"把活干出来"这件事始终落在人身上,AI 至多是答疑与起草的助手。在现有「需求管理大师」里,这一点写得很具体:助手只能澄清需求和起草摘要,真正能产出交付物的自治执行器 [`auto_agent`](../../../app/services/auto_agent.py) **仅对 file-only 类需求可选启用**——AI 从未占据默认执行路径(见 [PRD §2.2 痛点 1](../../prd/2026-06-04-workhub-prd.md))。

**WorkHub 的愿景是把这个前提翻转过来**:在一个团队的日常工作中,**绝大多数"事"由 AI 默认完成**——AI 不是建议者,而是第一执行人;它直接产出文档、分析、方案、代码等数字交付物。**人退居为审批者与异常处理者**:只在 AI 做不好、做不了、不该做时才介入。

但"让 AI 干活"若没有护栏,等于把生产态交给一个会过度自信的黑箱——这正是信任崩塌、产品猝死的最大风险(见 [PRD §14](../../prd/2026-06-04-workhub-prd.md))。因此愿景的第二半同样关键:**无论 AI 还是人做的改动,都必须经过统一的「提议 → 审批 → 合并」汇入单一可信源**。这套机制不是新发明,而是 GitHub 的 Pull Request 协作模型——只是 WorkHub 把它**搬到业务对象上**,并**对用户彻底隐藏一切 git 黑话**:用户看到的永远是「AI 拟好了,确认?」,而不是 branch / commit / merge / conflict。

> **为什么现在能做成(关键洞察)**:现有产品的 `deliver → 负责人「通过 / 打回」` 循环**本质上已经是一次 PR review**——只是没命名、也没让 AI 坐上驾驶位。打回带理由的纠偏机制有 [`RevisionRequest`](../../../app/models.py)(`models.py:535`),交付按轮次版本化有 [`Delivery`](../../../app/models.py)(`models.py:515`,`UniqueConstraint(requirement_id, round)`),AI 自评质量有 [`llm_review`](../../../app/services/auto_agent.py)(`auto_agent.py:544`),人在环确认有 [`MeetingInsight`](../../../app/models.py) 草稿待人确认流(`models.py:291`)。WorkHub = **给这套已造好的脊梁骨命名 + 让 AI 默认驾驶 + 补齐多人协作与治理**,而非从零发明。

### 1.2 愿景的三个支柱

| 支柱 | 含义 | 与现有代码的关系 |
|---|---|---|
| **AI 默认驾驶** | 每个环节默认"AI 提议 / AI 执行",而非等人发起 | 把 [`auto_agent`](../../../app/services/auto_agent.py) 从"file-only 可选"升格为 WorkItem 的**默认执行路径** |
| **统一汇流(单一可信源)** | 一切改动经「提议→审批→合并」汇入 main | 把 `deliver → 通过/打回` 循环([`lifecycle.py`](../../../app/services/lifecycle.py) + [`RevisionRequest`](../../../app/models.py))显式化为 Branch / Proposal / Review |
| **去黑话** | 对用户永远是人话,绝不暴露技术术语 | 现有 UI 已无 git 术语;WorkHub 把这条升级为**全局强制约束**(见 [宪法 4](#43-宪法-4-去黑话devisible-jargon)) |

### 1.3 愿景的边界(它不是什么)

愿景是"**让 AI 默认把数字活干完、人只把关**",**不是**"取代人"、"全自动无人工厂"、"AI 替你做任何事"。WorkHub 的 AI 受三种情形约束并**主动让位于人**:① 产出不合格 ② 用户不满意 ③ 用户明确不让 AI 干。这三种情形是宪法 2 的"换帽条件",详见 [§4.2](#42-宪法-2-一人两顶帽子two-hats-one-agent)。

---

## 2. 北极星(North Star)

### 2.1 北极星指标

> **让一个团队里"绝大多数事"由 AI 默认完成,人只在 AI 做不好 / 做不了 / 不该做时介入;且无论 AI 还是人改动,都经"提议 → 审批 → 合并"汇入单一可信源(main)。**(原文见 [PRD §3.1](../../prd/2026-06-04-workhub-prd.md))

把它落成**一个可测的数**:

> **自治率(Autonomy Rate)= 无人逐步执行即完成并合并的 WorkItem 占比。**

- **分子**:在一个统计周期内,从 intake 到 `merged`/`done` 全程**没有发生 EscalationEvent(未转人工执行)**、且最终被合并入 main 的 WorkItem 数。
- **分母**:同周期内进入执行阶段的 WorkItem 总数。
- 见 [PRD §13 成功度量](../../prd/2026-06-04-workhub-prd.md) 的"自治率(北极星)"。

### 2.2 北极星的护栏指标(防止"刷分")

自治率单独看会激励 AI 过度自信(强行不升级以保住分数),因此北极星**必须与一组护栏指标联读**,任何一个恶化都视为自治率"注水":

| 护栏指标 | 定义 | 为什么是护栏 | 出处 |
|---|---|---|---|
| **合并后回滚率** | 已合并的 Proposal 事后被 revert 的比例 | 高自治率若伴随高回滚 = AI 在发垃圾 | [PRD §13 信任](../../prd/2026-06-04-workhub-prd.md) |
| **打回率** | Proposal 被负责人打回的比例 | 衡量产出一次过关质量 | 源自 [`RevisionRequest`](../../../app/models.py) |
| **升级精准度** | 该升级时升级、不该时不升级(precision / recall) | 防止"为保自治率该升不升" | [PRD §13](../../prd/2026-06-04-workhub-prd.md) |

> **裁决口径**:当"提升自治率"与"降低回滚/打回率"冲突时,**优先保信任(护栏)**——宁可少几个自动完成,也不能让用户因一次糟糕的自动合并而退回手动模式。这条直接源自 [PRD §14 头号风险"信任崩塌"](../../prd/2026-06-04-workhub-prd.md)。

### 2.3 配套度量(北极星的解释变量)

自治率是结果;下列是它背后的驱动 / 成本变量,见 [PRD §13](../../prd/2026-06-04-workhub-prd.md):效率(需求平均交付时长下降)、小白激活(onboarding 完成率、首个 AI 任务成功率)、成本(每条已交付需求的 AI token 成本——因为"AI 默认劳动力 = token 大户",见 [宪法配套约束 NFR-05](#5-宪法与非功能约束的对应))。

---

## 3. 定位(Positioning)

> 定位是"**一句话讲清我们是谁**"。对内、对外两种说法,服务不同受众,但指向同一愿景。

### 3.1 对内一句话:**业务版 GitHub**

- **受众**:团队内部、工程与产品同事、投资人技术尽调。
- **要点**:WorkHub 把 GitHub 的协作内核(分支隔离、PR 提议、review 把关、合并入主干、单一可信源)**搬到业务对象上**(需求 / 文档 / 方案 / 结构化记录),并让 **AI 成为默认的"提交者"**。
- **依据**:现有的 `deliver → 通过/打回` 循环就是 PR review 的雏形(见 [PRD §2.3 洞察](../../prd/2026-06-04-workhub-prd.md))。

### 3.2 对外一句话:**会自己干活的 AI 工作平台**

- **受众**:终端用户、采购方、小白同学。
- **要点**:用户**不需要懂 GitHub、不需要懂 AI**。他们看到的是一个"会自己把活干完、干不完会找人推进、做完了请你点头"的工作平台。
- **依据**:对外定位**刻意不提 GitHub / branch / merge**——这是宪法 4「去黑话」的直接体现。对外说"会自己干活",对内说"业务版 GitHub",两者不矛盾:**同一引擎,两种讲法**。

> **两句话的关系(防止口径漂移)**:对内强调**协作内核**(怎么保证可信),对外强调**价值结果**(对你有什么用)。文档树内部讨论架构 / 数据模型时用对内说法;任何面向用户的文案 / UI 字样必须用对外说法且**零术语**。

---

## 4. 产品宪法 ×5(Product Constitution)

> **这五条贯穿所有功能。任何设计冲突以此为裁决基准**(原文见 [PRD §5](../../prd/2026-06-04-workhub-prd.md))。
> 每条给出:**条文 → 内涵 → 现有代码锚点 → 对下游的硬约束 → 反例(违宪的样子)**。
> 全树引用时请用锚点链接,例如 `[宪法 5](vision-and-principles.md#45-宪法-5-ai-绝不静默改生产态no-silent-production-writes)`。

### 4.1 宪法 1 · AI-native 默认驾驶(AI-Native by Default)

> **每个环节默认"AI 提议 / AI 执行",人确认。**

- **内涵**:AI 不是被动的助手,而是流程的**第一发起人与第一执行人**。intake、澄清、派活、排期、执行、主审——每个环节的**默认动作**都是 AI 先做出"提议"或直接"产出",人只需在结果上确认 / 调整 / 打回。"等人发起"是例外,不是常态。
- **现有代码锚点**:[`auto_agent.run_auto`](../../../app/services/auto_agent.py)(`auto_agent.py:374`)已能驱动 tool_use 循环直到产出交付物;[`MeetingInsight`](../../../app/models.py)(`models.py:291`)已是"AI 提议 → 人确认"的草稿流。WorkHub 把这种模式从个别功能**升格为全局默认**。
- **对下游硬约束**:
  1. 任何新功能的"主路径"设计,**默认动作必须是 AI 提议 / 执行**;"需要人先点一下"要单独说明理由。
  2. 完成判定借鉴 opencode:**AI 不再请求动作(产出最终交付而非再调工具)即视为完成**,而非依赖显式 flag(见 [PRD §8.1](../../prd/2026-06-04-workhub-prd.md))。
- **违宪反例**:把 AI 设计成"用户点'让 AI 帮忙'按钮才出手"的可选加速器(这正是今天 `auto_agent` 的状态,WorkHub 要终结它)。

### 4.2 宪法 2 · 一人两顶帽子(Two Hats, One Agent)

> **AI 默认是工人;受阻即变项目经理。切换条件 = 升级条件。**

- **内涵**:同一个 Agent 有两顶帽子。**默认戴"工人帽"**:直接产出交付物([PRD §8.1 L2 执行层](../../prd/2026-06-04-workhub-prd.md))。**受阻时戴"项目经理帽"**:不硬扛,转而组织人完成——派活、拆解、排期、提醒、盯进度、再审([PRD §8.3 L1 编排层](../../prd/2026-06-04-workhub-prd.md))。**何时换帽 = 何时升级**,由置信度 / 风险分级裁定。
- **三个换帽(升级)触发器**(对应现有零件,见 [PRD §8.2](../../prd/2026-06-04-workhub-prd.md)):
  1. **不合格** ← [`llm_review`](../../../app/services/auto_agent.py) 判分不过(`auto_agent.py:544`,返回 `meets_requirement: false`)。
  2. **用户不满意** ← 负责人打回([`RevisionRequest`](../../../app/models.py),`models.py:535`)。**打回必须带理由,理由回灌给 AI 触发自我纠偏**(见 [宪法 3](#43-宪法-3-人是审批者-异常处理者))。
  3. **用户明确不让 AI 干** ← 新增"人工保留"开关(WorkItem / 项目 / 用户 三级)。
- **额外自动升级信号(借鉴 opencode)**:**doom-loop**(连续 N 次相同动作判"卡住")、**预算耗尽**(对应 [`auto_agent.MAX_TURNS`](../../../app/services/auto_agent.py) = 15、`TOTAL_TIMEOUT_DEFAULT` = 5 分钟)。
- **对下游硬约束**:升级**不是失败**,而是设计内的一等状态转移。WorkItem 状态机必须含 `escalated → pm_mode` 路径(见 [PRD §7.1](../../prd/2026-06-04-workhub-prd.md));经理模式下 AI **不静默替人决策**——派活、催办都是"提议→人确认"。详见 [confidence-risk-escalation.md](../02-ai-engine/confidence-risk-escalation.md)(命门)与 [pm-mode-orchestration.md](../02-ai-engine/pm-mode-orchestration.md)。
- **违宪反例**:AI 卡住后**静默截断**或"假装完成"交付半成品(现有 `auto_agent` 达到 `MAX_TURNS` 时返回失败 `result`——WorkHub 要把它升级为**结构化交接件 +换帽找人**,而非默默放弃)。

### 4.3 宪法 3 · 人是审批者 + 异常处理者(Humans Approve & Handle Exceptions)

> **人是审批者 + 异常处理者,不是默认劳动力。**

- **内涵**:这是宪法 1 的镜像。把人从"每步推进的劳动力"中解放出来,只承担两类高价值动作:**(a) 审批**(对 AI 提议点头 / 打回)、**(b) 异常处理**(AI 升级后接手该领域的人去做)。小白尤其受益:不必学工具、不必懂流程,只需在被问到时回答。
- **现有代码锚点**:[`lifecycle.queue_status_notifications`](../../../app/services/lifecycle.py)(`lifecycle.py:104`)已是"里程碑→通知正确的人"的中枢(claimed / delivered / accepted / revision_requested);打回带理由由 [`RevisionRequest.reason_md`](../../../app/models.py)(`models.py:542`,`nullable=False`——理由是**强制字段**)承载。
- **对下游硬约束**:
  1. **打回必须带理由**(延续 `reason_md` 的非空约束),且**理由作为上下文回灌**给 AI,使其在**同一分支续做而非重来**(见 [PRD §8.2 FR-ESC-003](../../prd/2026-06-04-workhub-prd.md))。
  2. 审批是**阻塞原语**(借鉴 opencode):任何工具在"该决策那一刻"可 `ask` 人,阻塞至回复;详见 [review-and-approval.md](../03-collaboration/review-and-approval.md)。
  3. 关键路径必须"**可一句话完成、可撤销**"(见 [NFR-10 易用](../../prd/2026-06-04-workhub-prd.md))。
- **违宪反例**:要求负责人"从头自己写"而不是"审 AI 拟好的";或打回时允许不写理由(导致 AI 无从纠偏,只能盲目重来)。

### 4.4 宪法 4 · 去黑话(De-Jargon)

> **对用户永远是「AI 拟好了,确认?」,绝不暴露 merge / 分支 / 冲突 / 置信度阈值等术语。**

- **内涵**:WorkHub 内部是"业务版 GitHub",但**用户永远看不到 git 黑话**。心智映射对用户隐藏(权威全量映射见 [glossary-dejargon.md](./glossary-dejargon.md);此处仅引用,不重复长篇):

  | 内部(git 心智) | 用户看到的 |
  |---|---|
  | branch | "我的工作副本 / 草稿" |
  | commit / diff | "改动" |
  | open PR | "提交给负责人确认" |
  | review / approve | "确认" / "打回(说原因)" |
  | merge to main | "采纳 / 汇入正式版" |
  | conflict | "和别人的改动撞了,AI 给了合并方案,选一个" |
  | confidence threshold | (永不暴露数值)"我比较有把握,但建议你扫一眼" |

  (映射出处:[PRD §8.5](../../prd/2026-06-04-workhub-prd.md) / [§17.1](../../prd/2026-06-04-workhub-prd.md))
- **内外措辞分离**:**对内文档 / 架构 / 数据模型**正常使用 branch / proposal / merge 等术语([data-model.md](../01-architecture/data-model.md) 用它们命名实体);**对外 UI / 文案**必须零术语。这与 [§3](#3-定位positioning) 的对内/对外两句话是同一原则。**置信度数值阈值同样属于黑话**——对用户只给"人话理由 + 把握程度的定性表达"(见 [PRD §8.2 FR-ESC-001](../../prd/2026-06-04-workhub-prd.md))。
- **对下游硬约束**:[FR-COLLAB-004](../../prd/2026-06-04-workhub-prd.md)「全程 UI 不出现 git 术语」是**验收级硬指标**;所有面向用户的字符串须过"黑话检查"。冲突解决也包裹成"撞车了,AI 给了方案,你选一个"(见 [branch-proposal-merge.md](../03-collaboration/branch-proposal-merge.md))。
- **违宪反例**:UI 弹出"检测到 merge conflict,请手动 resolve";或"本次产出置信度 0.62,低于阈值 0.7"。

### 4.5 宪法 5 · AI 绝不静默改生产态(No Silent Production Writes)

> **任何 AI 改动都可解释(为什么)、可回滚(快照)、经审批才汇入 main。**(延续现有 [`MeetingInsight`](../../../app/models.py) `models.py:291` 的法律,升级为全局默认)

- **内涵**:这是 WorkHub 的**安全红线**,也是信任的地基。AI 对生产态(单一可信源 main、业务数据)的**任何**副作用都必须满足三个条件,缺一不可:
  1. **可解释**:每个判断(为何这样产出、为何推荐此人、为何升级、为何判不合格)都给**人话理由 + 证据引用**(延续 grep + 强制引用范式,见 [PRD §8.10](../../prd/2026-06-04-workhub-prd.md))。
  2. **可回滚**:AI 的每次副作用动作都生成执行前**快照**,任何步骤可 revert(借鉴 opencode 的"每步快照",见 [PRD §8.1 FR-WORKER-004](../../prd/2026-06-04-workhub-prd.md))。
  3. **经审批**:改动以 Proposal 形式提交,**审过才合并 main**;高置信低风险可按策略自动合并,但仍留痕、可回滚。
- **现有代码锚点(这条不是空喊,代码里已有四处雏形)**:
  - [`MeetingInsight`](../../../app/models.py)(`models.py:291`):AI 产出的洞察是**草稿**,带 `status="pending"` + `confidence_reason`,**人确认(`confirmed_by_user_id`)后才生成正式需求**——AI 不直接落库生产态。这正是 PRD 援引为"现有的法律"的那一处。
  - [`ProjectDriveOperation`](../../../app/models.py)(`models.py:214`):网盘操作带 `payload_json` + `undone_at`,**已是"可回滚操作日志"的雏形**。
  - [`ProjectDriveComment`](../../../app/models.py)(`models.py:228`):评论触发 LLM 时落 `llm_kind` + `llm_reason`(**可解释**),产出 `draft_requirement_id`(**草稿不是成品**)。
  - 软删除范式(`User.deleted_at` / `Project.deleted_at` / `ProjectDriveItem.deleted_at`):全库**不做硬删除**,保留可追溯 / 可恢复——是"可回滚"在数据层的体现(见 [`models.py` User 软删除注释](../../../app/models.py))。
- **对下游硬约束**:对应 [NFR-03 可审计](../../prd/2026-06-04-workhub-prd.md)、[NFR-04 可回滚](../../prd/2026-06-04-workhub-prd.md);新增 `AuditLog`(按身份全量审计)与 AI 副作用快照机制,详见 [security-and-permissions.md](../01-architecture/security-and-permissions.md) 与 03-collaboration。**威胁模型必须从"可信局域网"重审**(尤其若上云),见 [NFR-02](../../prd/2026-06-04-workhub-prd.md)。
- **违宪反例**:AI 直接 `UPDATE` 一条业务记录而不留快照 / 不走 Proposal;或产出一个结论却给不出"为什么"和证据。

### 4.6 宪法之间的优先级(冲突仲裁顺序)

当两条宪法在具体设计中相互拉扯时,按下列优先级裁决(高者胜),最终仲裁是**北极星 + 其护栏**:

1. **宪法 5(不静默改生产态)** —— 安全红线,**永不让步**。可解释 / 可回滚 / 经审批高于一切体验诉求。
2. **宪法 3(人是审批者 / 异常处理者)** —— 失控时人必须能接管。
3. **宪法 2(两顶帽子)** —— 受阻即换帽,升级是一等状态。
4. **宪法 1(AI 默认驾驶)** —— 在不违背 5/3/2 的前提下,尽量让 AI 多干。
5. **宪法 4(去黑话)** —— 表达层约束,贯穿所有对外触点,但不应为"避免术语"而牺牲 5/3 的安全与可控(例如:不能为了"不吓到用户"而隐瞒一次高风险自动改动的存在)。

> 例:"为提升自治率(北极星分子),要不要让 AI 自动合并中等置信度的产出?"——**不**。宪法 5 + 北极星护栏(回滚率)要求中档**强制人工抽检**(见 [PRD §8.2 分级裁决表](../../prd/2026-06-04-workhub-prd.md)),自治率让位于信任。

---

## 5. 宪法与非功能约束的对应

宪法是"价值法律",[PRD §10 NFR](../../prd/2026-06-04-workhub-prd.md) 是它的"工程兑现"。下表把每条宪法映射到必须满足的 NFR,供下游做架构 / 安全设计时双向核对:

| 宪法 | 直接兑现的 NFR | 说明 |
|---|---|---|
| 1 AI 默认驾驶 | NFR-01 并发、NFR-05 成本治理 | AI 当默认劳动力 → 多 Agent 并发(逃离 SQLite 单 worker,见 [D-2](#7-地基决策对宪法的影响必读)) + token 大户需三级预算 |
| 2 两顶帽子 | NFR-06 可靠性、NFR-11 可观测 | 卡住 / 超预算**优雅降级为人话交接**;升级 / 置信度 / 成本可视化 |
| 3 人是审批者 | NFR-07 实时、NFR-08 隐私、NFR-10 易用 | 审批阻塞经 SSE 推送;私有事件按身份隔离;关键路径零术语可撤销 |
| 4 去黑话 | NFR-09 国际化、NFR-10 易用 | 提示词英文、对用户输出其语言;界面中文优先、零术语 |
| 5 不静默改生产态 | NFR-02 安全、NFR-03 可审计、NFR-04 可回滚、NFR-08 隐私 | 沙箱 + 权限策略 + 高风险人工门 + 按身份审计 + 快照 revert |

---

## 6. 非目标(Non-Goals · v1 明确不做)

> 非目标是**反向边界**,与宪法同等重要:它防止范围蔓延(见 [PRD §14 风险"全都要"](../../prd/2026-06-04-workhub-prd.md)),让 P1 旗舰能先把"反转"证明出来。原文见 [PRD §3.3](../../prd/2026-06-04-workhub-prd.md)。

| 非目标 | 含义 | 为什么不做 / 边界 | 决策出处 |
|---|---|---|---|
| **不做通用 IM / 文档协同编辑器** | 不与飞书 / Notion 正面竞争实时多人编辑体验 | WorkHub 的协作单元是"提议→审批→合并",不是字符级 OT/CRDT 实时编辑 | [PRD §3.3](../../prd/2026-06-04-workhub-prd.md) |
| **不做向量检索 [决策]** | 延续 grep + **强制引用**的知识范式,不引入向量库 | 现有 [`KnowledgeDocument`](../../../app/models.py)(`models.py:110`,`corpus_path` + `content_hash`)+ [`KnowledgeAskRun`](../../../app/models.py)(`citations_json` 强制引用)已验证可用 | [PRD §3.3 / D-4](../../prd/2026-06-04-workhub-prd.md) |
| **不做"AI 替你做线下 / 需专业资质判断的事"** | L2 执行层**只覆盖数字可交付物** | 线下 / 法律 / 医疗等需资质的判断不在自治范围;受阻即升级给人 | [PRD §3.3](../../prd/2026-06-04-workhub-prd.md) |
| **v1 不追求多租户公网 SaaS** | LAN-first MVP + 云就绪架构;多租户公网**延到 P5** | 先在可信局域网证明"反转";威胁模型上云前重审([NFR-02](../../prd/2026-06-04-workhub-prd.md)) | [PRD §3.3 / D-3](../../prd/2026-06-04-workhub-prd.md);[README §4](../README.md) |

> **非目标 ≠ 永不做**:它们是 **v1 的边界**。例如多租户在 [phasing-p0-p5.md](../06-roadmap/phasing-p0-p5.md) 的 P5 才进入范围。

---

## 7. 地基决策对宪法的影响(必读)

本篇受三条已敲定地基决策约束(见 [README §4](../README.md) 与 [PRD §15](../../prd/2026-06-04-workhub-prd.md));它们不改变愿景 / 宪法的内容,但决定其**落地形态**:

- **D-1 新仓 = 迁移现有「需求管理大师」地基再演进**(非重写):复用已验证的状态机 / [`auto_agent`](../../../app/services/auto_agent.py) / [`lifecycle`](../../../app/services/lifecycle.py) / [`spec_watch`](../../../client-tauri/src-tauri/src/spec_watch.rs) / 安全模型,重构为 **headless agent daemon + 瘦客户端**。→ 宪法各条的"现有代码锚点"因此可直接继承,而非纸上谈兵。
- **D-2 数据库 = PostgreSQL**(替换 SQLite):支撑**多 Agent + 多人并发**与业务对象**合并 / 行级锁**。→ 直接服务宪法 1(AI 默认劳动力 = 高并发)与 [NFR-01](../../prd/2026-06-04-workhub-prd.md);现有 [`auth.py` 注释](../../../app/auth.py) 已坦承 SQLite 单写锁导致的 "database is locked" 痛点,印证必须迁移。
- **D-3 部署 = LAN-first MVP + 云就绪架构**:延续**设备令牌门**——接活 / 干活类高权限操作要求桌面客户端(服务端校验 [`require_local_client`](../../../app/auth.py),浏览器只能派活 / 审批);多租户公网延到 P5(见 [非目标](#6-非目标non-goals--v1-明确不做))。

> **架构如何兑现宪法**:headless daemon + OpenAPI + SSE/WS + 类型化客户端(借鉴 opencode)是宪法的"承载体"——权限询问 / 进度 / 结果皆为**流上事件**(现有 [`push_bus`](../../../app/services/push_bus.py) 的 `req:<id>` / `all` 主题是其雏形)。完整论证见 [system-architecture.md](../01-architecture/system-architecture.md)。

---

## 8. 本篇 → 全树的引用约定

为保证"可被全树引用的权威版"落到实处:

1. **归因回链**:任何模块文档解释"为何如此设计",应链接到本篇某条宪法的锚点(如 `#45-宪法-5-...`),而非自行重述。
2. **术语**:一律以 [glossary-dejargon.md](./glossary-dejargon.md) 为准;本篇出现的 git 心智映射仅为引用,不作权威定义。
3. **冲突裁决**:设计评审中的取舍,引用 [§4.6 宪法优先级](#46-宪法之间的优先级冲突仲裁顺序) + [§2.2 北极星护栏](#22-北极星的护栏指标防止刷分)。
4. **FR/NFR 追溯**:功能需求清单见 [functional-requirements.md](../06-roadmap/functional-requirements.md);本篇 [§5](#5-宪法与非功能约束的对应) 提供"宪法 ↔ NFR"的双向核对表。

---

*上游:[PRD §3 / §5](../../prd/2026-06-04-workhub-prd.md) · [规格树索引](../README.md)。下游:本篇被 01-architecture / 02-ai-engine / 03-collaboration 各篇作为"为什么"的归因源引用。*
