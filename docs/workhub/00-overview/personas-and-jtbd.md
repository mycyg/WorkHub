---
module: 00-overview
layer: L0-identity
status: 🚧
owner: workflow
related:
  - ../../prd/2026-06-04-workhub-prd.md
  - ../README.md
  - ./vision-and-principles.md
  - ./glossary-dejargon.md
  - ../01-architecture/security-and-permissions.md
  - ../02-ai-engine/confidence-risk-escalation.md
  - ../03-collaboration/branch-proposal-merge.md
  - ../05-clients/desktop-pet-tauri.md
---

# 用户画像与 JTBD（Personas & Jobs-To-Be-Done）

> 本篇从 [PRD §4「目标用户与画像」](../../prd/2026-06-04-workhub-prd.md) 展开为「完备叙述级」，把五类画像写到**可被设计/验收追溯**的深度：每个画像给出一句话定位、真实场景叙事、痛点（锚定现有「需求管理大师」代码）、JTBD（含主任务与支线任务）、成功标准（可度量）、与各模块/各端的接触点。
>
> **术语口径**:本篇严格遵守 PRD 第 4 条产品宪法「去黑话」——对用户永远说「工作副本 / 改动 / 提交确认 / 采纳 / 撞车了 AI 给了方案」,绝不出现 branch/merge/PR/conflict/置信度阈值。详细映射见 [glossary-dejargon.md](./glossary-dejargon.md)(权威版,撰写中);本篇引用映射处不再重复长表。
>
> **现有代码引用约定**:文中 `app/...:行号`、`web/...`、`client-tauri/...` 均指向当前仓库真实文件,作为 WorkHub 迁移(D-1)的事实起点;标「**新增**」处为 WorkHub 才有的能力,标「演进」处为现有零件升级。

---

## 0. 为什么先写画像

WorkHub 的核心是一次**角色反转**:AI 默认干活、人退居审批与异常处理(PRD §1/§5)。这意味着「谁在用」决定了「AI 该替他做到哪一步、何时该把他拽进来」。画像不是营销话术,而是 **L0 身份层** 的需求源——

- 现有产品里「身份」极薄:一个 `User`(昵称 + cookie_token + `is_admin`,见 `app/models.py:27`)。WorkHub 要在其上叠加 `UserProfile`(技能自述/自我介绍)与 `CollaborationGraph`(命中率/协作史)喂给所有 AI 决策(PRD §6 L0、§8.4 智能派活)。
- 画像直接决定**权限画像(actor)**:AI 工具菜单按「当前 actor 权限」过滤(PRD §8.1),而 actor 的角色来自这里。
- 画像决定**升级路由**:打回理由回灌给谁、审批请求路由给谁(PRD §8.2/§8.6),取决于此人在该 WorkItem 上扮演 submitter / lead / collaborator / approver 中的哪一个。

> ⚠️ **重要区分:画像 ≠ 系统角色**。一个真人会在不同 WorkItem 上戴不同帽子(同一个人在 A 工单是负责人、在 B 工单是协作者)。下面五类画像描述的是**典型主导身份 + 主场景**;系统侧的角色绑定是 per-WorkItem 的 `RequirementAssignment.role`(`lead | collaborator`,见 `app/models.py:363-375`)叠加全局 `is_admin` 标记。RBAC 的完整定义在 [security-and-permissions.md](../01-architecture/security-and-permissions.md)。

---

## 1. 画像总览(一图速查)

| 画像 | 一句话 | 现有系统对应身份 | 主场景空间 | 主端 | AI 对其的默认关系 | 首要 JTBD |
|---|---|---|---|---|---|---|
| **P1 小白同学** | 不懂工具、怕流程,只想说句人话把事办了 | 普通 `User`,常是 collaborator/submitter | 接活/Work(也可派活) | 桌宠 C-PET | AI 替他干大部分活 + 代他操作 | "我只想说句话,剩下的别让我学" |
| **P2 负责人** | 要结果、要把关、怕失控 | `RequirementAssignment.role = lead` / `Project.owner_user_id` | 派活/Dispatch + 审批 | Web C-WEB | AI 拟好,他只需「确认 / 打回」 | "AI 拟好的我点头或打回,别让我从头做" |
| **P3 业务提交者** | 把模糊口头需求变成有人负责的事 | `Requirement.submitter_user_id` | 派活/Dispatch | Web C-WEB | AI 澄清 → 自动派活 → 自动推进 | "我有个模糊的活,希望它自动有人/有 AI 负责到完成" |
| **P4 协作者** | 并行干自己那块、不踩别人 | `RequirementAssignment.role = collaborator` | 接活/Work | 桌宠 C-PET | 各有「工作副本」,提议汇入,互不阻塞 | "我并行干我那块,提交给负责人确认,别和别人撞车" |
| **P5 管理员** | 治理、成本、审计 | `User.is_admin = True`(`app/models.py:38`) | 全局 + 看板 | Web C-WEB | AI 受其设的策略/预算约束;越界即问他 | "我要能治理谁能干什么、烧多少、出了事查得到谁" |

> 与 [README.md「产品呈现模式」](../README.md) 的对应:**C-WEB**(浏览器)服务负责人/提交者/管理员;**C-PET**(桌面宠物)服务协作人/小白——延续现有「**派活浏览器可用、接活/干活需桌面客户端**」的设备令牌门(`require_local_client`,见 `app/auth.py:183`、`app/services/permissions.py:114` `can_work_requirement`)。

---

## 2. P1 — 小白同学(Novice / "说人话就办事")

### 2.1 一句话定位
不懂工具、怕流程、怕点错;最大诉求是**「我只想说一句话,剩下的别让我学」**(PRD §4 关键 JTBD)。是 WorkHub「**小白也能用**」承诺(PRD §1、NFR-10)的试金石。

### 2.2 场景叙事(端到端)
> 小李刚入职,被拉进团队的 WorkHub。他第一次打开**桌面宠物**(C-PET):
>
> 1. **Onboarding 4 步**(现有 `client-tauri/web-src/src/routes/Onboarding.tsx`):填服务地址 → 填昵称(「我是谁」)→ 选本地工作目录 → 完成。WorkHub 在此 **新增第 5 类必填项**:「擅长什么 + 一句话自我介绍」(PRD FR-STAFF-001),写入 `UserProfile`。
> 2. 桌宠冒出来打招呼(演进自现有右下角 `FloatingAssistant`,见 `client-tauri/web-src/src/components/FloatingAssistant.tsx`),用一句话教他:「想做啥直接跟我说」。
> 3. 小李不知道「需求」「工单」在哪个菜单,他直接对桌宠说:「**帮我把上周那个活的进度问一下,顺便催一下负责人**」(PRD J6)。
> 4. 桌宠(= headless daemon 的瘦客户端)调 Agent:查到该 WorkItem 状态、起草一条催办,回他一句「**我拟好了,确认发吗?**」。小李点「确认」,完成——全程没碰过任何叫「工单详情页」的东西。
> 5. 第二天有个活派给小李协作。AI 工人先把能做的部分(file 类交付物)做了,做不动的部分升级,桌宠提示:「**这块我拿不准,你瞅一眼/补一句?**」小李补一句话即可。

### 2.3 痛点(锚定现有产品的真实缺口)
| 痛点 | 现状证据 | WorkHub 解法 |
|---|---|---|
| 上手成本高、要学功能在哪 | 现有 C-PET 有 Hub/Inbox/Clarify/MyWorkload/TaskDetail 等多路由(`client-tauri/web-src/src/routes/`),小白需自己找 | 桌宠自然语言代操作几乎所有功能(PRD FR-PET-002、L4) |
| 每步都要人推进 | 现有闭环「认领→交付→验收」每步靠人(PRD §2.2 痛点 2) | AI 默认驾驶,小白只在受阻点被拉入(PRD §5 第 1/3 条) |
| 打扰方式原始、像系统弹窗 | 现有右下角弹窗/托盘(`client-tauri/src-tauri/src/notify.rs`、`tray.rs`) | 有人格、可对话的桌宠,有节制提醒(PRD FR-PET-003/004) |
| 怕点错、怕不可逆 | — | 关键路径可撤销(NFR-10);AI 副作用有快照可回滚(NFR-04、PRD §8.1) |
| 看不懂术语 | 现有 UI 已较口语化,但仍有「认领/交付/验收」 | 全程零 git 黑话(PRD FR-COLLAB-004);AI 决策给「人话」理由 |

### 2.4 JTBD
- **主任务**:"当我有个活要办,我想**只用一句话**把它交出去,这样我不必学这个系统的结构。"
- **支线**:
  - "当 AI 替我做了某事,我想用**人话**知道它做了什么、能不能撤,这样我敢点确认。"
  - "当系统要提醒我,我想要个**像同事一样**的提示,而不是冷冰冰的系统弹窗。"
  - "当我被派去协作但不会做,我想 AI **先把能做的做了**,只问我它真卡住的那一点。"

### 2.5 成功标准(可度量)
- **onboarding 完成率**(含「技能自述」必填项填写率)高(PRD §13 小白激活)。
- **首个 AI 任务成功率**:小白下达的第一条桌宠指令成功完成的占比(PRD §13)。
- **零术语校验**:小白主路径上任一界面文案不出现 merge/branch/PR/置信度等(NFR-10 可作为 UI 文案 lint 规则)。
- **一句话完成率**:可由单条自然语言指令(无需追问功能位置)闭环的任务占比。

### 2.6 模块/端接触点
- **入口层(L4 / C-PET)**:桌宠对话框 = 主入口。演进自 `FloatingAssistant.tsx`(现已是 SSE 流式 `/api/assistant/chat`、能 grep 接地、能把描述转成需求草稿并交接给澄清流程,见 `app/routers/assistant.py`)。
- **M-NOTIFY**:提醒/通知经桌宠呈现,替代 `notify.rs`/`tray.rs` 弹窗。
- **P-AI**:AI 工人(L2)替他干;受阻升级(L1)把他作为「被询问的人」拉入,问题以人话呈现(PRD §8.2 FR-ESC-001)。
- **L0 身份**:onboarding 的「技能自述」喂智能派活。
- **安全门**:接活/干活需桌面客户端 + 设备令牌(`app/auth.py:183` `require_local_client`)——小白天然在 C-PET,符合门禁。

---

## 3. P2 — 负责人(Owner / Reviewer / "把关人")

### 3.1 一句话定位
想要**结果**、要**把关**、**怕失控**;核心 JTBD 是**「AI 拟好的我只需点头或打回,不想从头做」**(PRD §4)。是「人 = 审批者 + 异常处理者」(PRD §5 第 3 条)的化身。

### 3.2 场景叙事
> 老王是某项目 Owner(现有 `Project.owner_user_id`,`app/models.py:83`),同时是好几条 WorkItem 的负责人(`RequirementAssignment.role = lead`)。他的一天:
>
> 1. 打开 **Web**(C-WEB),Dashboard 列出「**等我确认**」的一排卡片(演进自现有交付验收:`delivered` → 通过/打回,见 `app/services/lifecycle.py:39` 的 `delivered` 里程碑「{code} 交付了,等你验收」)。
> 2. 点开一条:AI 工人已经把交付物做好,附一个 **ConfidenceRecord**(**新增**)说人话:「**我比较有把握,但建议你扫一眼第 2 段**」(PRD FR-ESC-001,不暴露数值)。老王扫一眼,点「**采纳**」(= 去黑话的 merge to main,见 [glossary](./glossary-dejargon.md))。
> 3. 另一条 AI 做得不行。老王点「**打回**」并**写明原因**:「数据口径错了,应按财年」。原因被**回灌**给 AI,AI 在**同一个工作副本**续做(PRD FR-ESC-003、§8.2 触发器 2,演进自现有 `RevisionRequest` + `app/services/lifecycle.py:60` `revision_requested`「{code} 需要返工」)。
> 4. 第三条 AI 主动升级了:「这事影响面大/我拿不准,**建议派给小张牵头、小李协作**(因为他俩做过类似的、命中率高)」。老王**一键确认或改派**(PRD §8.4 FR-STAFF-002/003)。
> 5. 高风险动作(如对外发布、改生产数据)时,AI 在「该决策那一刻」**阻塞并问他**:「**这步要不要我做?**」(PRD §8.6 审批 = 阻塞原语)。

### 3.3 痛点
| 痛点 | 现状证据 | WorkHub 解法 |
|---|---|---|
| AI 只「建议」,自己仍要从头做 | 现有助手只答疑/起草,`auto_agent` 仅 file-only 可选启用(PRD §2.2 痛点 1) | AI 默认产出完整交付物,负责人只审(PRD §8.1 FR-WORKER-001) |
| 怕 AI 自作主张、不可控 | — | AI 绝不静默改生产态;改动可解释、可回滚、经审批才汇入 main(PRD §5 第 5 条,延续 `app/models.py` 既有「AI 不静默」法律,升级为全局默认) |
| 打回后 AI 停摆、要重来 | 现有 `RevisionRequest` 只记理由,无回灌闭环 | 打回**必须带理由**,理由回灌触发同副本自我纠偏(FR-ESC-003) |
| 不知道该信 AI 几分 | — | ConfidenceRecord 给「人话把握度 + 依据 + 风险」(FR-ESC-001) |
| 一个个审太累 | 现有逐条 PATCH /status | 高置信低风险按策略**自动合并/抽检**,只把中低档推到他面前(PRD §8.2 分级) |

### 3.4 JTBD
- **主任务**:"当 AI 完成一件活,我想**快速判断该采纳还是打回**,这样我用最少精力守住质量。"
- **支线**:
  - "当我打回时,我想**写一句原因就让 AI 自己改好**,而不是自己动手或反复解释。"(回灌)
  - "当一件活该有人接手,我想 AI **建议人选并说明理由**,我点头即可。"(智能派活)
  - "当某步动作有风险,我想在它**发生之前**被问,而不是事后发现。"(阻塞审批)
  - "当 AI 干完,我想知道它**怎么干的、能不能回退**,这样我放心采纳。"(trace + 快照)

### 3.5 成功标准(可度量)
- **审批吞吐 / 单次审批耗时下降**:高置信低风险自动合并占比 ↑,推到人面前的只剩真正需要判断的(PRD §13 自治率)。
- **合并后回滚率、打回率下降**(PRD §13 信任):证明 AI 产出质量被信任。
- **升级精准度**(precision/recall):该升级到他的都升了、不该打扰的没打扰(PRD §13)。
- **打回→重新交付时长下降**:回灌纠偏闭环有效。

### 3.6 模块/端接触点
- **C-WEB**:主战场。Dashboard「等我确认」队列、RequirementDetail 的审批动作(演进自现有 `web/src/pages/Dashboard.tsx`、`web/src/pages/RequirementDetail.tsx`、组件 `web/src/components/DeliverablesTab.tsx`)。
- **P-COLLAB / 03-collaboration**:对 Proposal 的「采纳 / 打回(带理由)」(见 [branch-proposal-merge.md](../03-collaboration/branch-proposal-merge.md)、[review-and-approval.md](../03-collaboration/review-and-approval.md))。
- **P-AI / 02-ai-engine**:消费 ConfidenceRecord 的分级裁决(见 [confidence-risk-escalation.md](../02-ai-engine/confidence-risk-escalation.md));智能派活的「确认/改派」入口(见 [smart-staffing.md](../02-ai-engine/smart-staffing.md))。
- **P-PERM**:作为审批路由的**默认目标人**(按 lead/owner 路由,PRD FR-PERM-002)。
- **可解释性**:每个 AI 判断附人话理由 + 证据(PRD FR-EXPLAIN-001,演进自现有 `web/src/components/AILiveView.tsx` 实时 trace 视图)。

---

## 4. P3 — 业务提交者(Dispatcher / "把模糊变成有人负责")

### 4.1 一句话定位
脑子里有个**模糊的活**,要把它变成「**有人/有 AI 负责并推进到完成**」的事;核心 JTBD 是**「我有个模糊的活,希望它自动有人/有 AI 负责并推进到完成」**(PRD §4 关键 JTBD 第 1 条)。对应现有 `Requirement.submitter_user_id`。

> **与负责人的区别**:提交者关心「**这事被接住了吗、在动吗**」;负责人关心「**做得对不对、要不要放行**」。同一人可兼任,但 JTBD 不同。提交者常在浏览器侧(派活空间),无需桌面客户端即可提交(现有 `app/routers/requirements.py` 提交不要求 `require_local_client`)。

### 4.2 场景叙事
> 产品经理小赵在工位上,想起一个事:「**得给客户出个 Q2 复盘材料,但我还没想清楚要啥**」。
>
> 1. 打开 **Web** → 新建需求(现有 `web/src/pages/NewRequirement.tsx`),口头/文字把模糊想法丢进去。
> 2. **AI 澄清**:像现在的澄清聊天一样追问「给谁看?什么时候要?算交付的标准是啥?谁牵头?DDL?」(演进自现有澄清流程:`web/src/pages/Clarify.tsx`、`app/models.py:498` `ChatMessage` 的 `question_choice/question_open` 类型)。
> 3. 澄清完,AI **生成规格(README)**作为这条 WorkItem 的活文档单一可信源(PRD §8.8 FR-SPEC-001,演进自现有 spec 文件夹 + `client-tauri/src-tauri/src/spec_watch.rs`),并把验收清单列出来(演进自 `RequirementAcceptanceItem`,`app/models.py:464`)。
> 4. **AI 自动推进**:能直接干的 → AI 工人干;需要人 → AI 转项目经理模式,**提议**负责人+协作人(智能派活),小赵或负责人确认。
> 5. 小赵该收到的节点通知一个不少:被接走(`claimed`)、交付待验收、通过验收(现有 `app/services/lifecycle.py:31-66` 已为 submitter 发这些里程碑通知)。WorkHub 让这些通知也能经桌宠/Web 实时到达(NFR-07 SSE,演进自 `app/services/push_bus.py`)。

### 4.3 痛点
| 痛点 | 现状证据 | WorkHub 解法 |
|---|---|---|
| 模糊想法没人接、自己还得追着推 | 现有「入池→认领」靠人主动认领(PRD §2.2 痛点 2/3) | intake→澄清→**智能派活**→自动推进(PRD L1、§8.3/§8.4) |
| 提交后不知道有没有动 | 现有有 `claimed/delivered` 通知,但缺「AI 在干、干到哪」的可见性 | AgentRun trace 实时可见(PRD FR-WORKER-002、NFR-11);桌宠可问状态(J6) |
| 验收标准没说清,交付货不对板 | 现有 `RequirementAcceptanceItem` 已存在但需人维护 | README=规格页随澄清自动生成验收清单,AI 与人都对照它(FR-SPEC-001) |
| 双向同步缺失,改了本地没回流 | 现有 `client-tauri/src-tauri/src/sync.rs:227` 双向是占位(PRD §2.2 痛点 4) | 本地↔云双向同步(PRD §8.7 FR-SYNC-001) |

### 4.4 JTBD
- **主任务**:"当我有个**还没想清**的需求,我想把它一说,系统就帮我**问清楚、定标准、找到负责的人/AI 并推到完成**。"
- **支线**:
  - "当我提交后,我想**随时能问『进行到哪了』**并得到人话回答。"(状态可见性)
  - "当需求被澄清,我想要一份**自动维护的规格页**当作大家对齐的依据。"(README=规格)
  - "当节点推进(被接、交付、通过),我想**主动收到通知**,不必盯着看。"(lifecycle 通知)

### 4.5 成功标准(可度量)
- **需求平均交付时长下降**(PRD §13 效率)。
- **自治率**:提交的需求中「无人逐步推进即完成」的占比(北极星,PRD §13)。
- **澄清→规格转化率**:模糊提交被成功澄清并生成可执行规格的比例。
- **通知触达 & 无遗漏**:关键里程碑通知 100% 触达提交者(延续 `lifecycle.py` 已修复的「submitter 从不收到通知」缺陷,见该文件 docstring)。

### 4.6 模块/端接触点
- **C-WEB**:新建需求、澄清聊天、规格页查看(`NewRequirement.tsx`、`Clarify.tsx`)。
- **M-WORKITEM**:主轴状态机的发起者(`app/models.py:314/328`)。
- **P-AI**:被 AI 澄清(L1 intake)、被智能派活分配负责人(§8.4)。
- **M-NOTIFY**:lifecycle 里程碑通知接收方(`app/services/lifecycle.py`)。
- **P-COLLAB / sync**:README=规格活文档(见 [sync-and-spec.md](../03-collaboration/sync-and-spec.md));双向同步(若其本地也编辑)。

---

## 5. P4 — 协作者(Collaborator / "并行干我那块,不踩别人")

### 5.1 一句话定位
被分到某 WorkItem 上**和别人一起干**,要**并行推进自己负责的部分、不被别人阻塞、也不踩别人**;对应现有 `RequirementAssignment.role = collaborator`(`app/models.py:370`)。核心诉求是 PRD §8.5 的「分支 → 提议 → 合并」并行协作,但**全程不见 git 黑话**(FR-COLLAB-004)。

### 5.2 场景叙事
> 设计师小陈和文案小周被派到同一条 WorkItem(多协作者由 `RequirementAssignment` 支持,lead + N collaborators)。
>
> 1. 二人各在**自己的「工作副本」**里干(= 去黑话的 branch,**新增** `Branch` 实体,PRD §7、FR-COLLAB-001),互不阻塞——这是对现有「认领即独占」(现有同一 `Requirement` 的 workspace 是 per-user 的 `RequirementWorkspace`,`app/models.py:378`)的演进。
> 2. 小陈干完自己那块,点「**提交给负责人确认**」(= open PR,**新增** `Proposal` 实体,FR-COLLAB-002)。负责人审过→「**采纳**」汇入正式版(main)。
> 3. 小周改的内容和小陈刚被采纳的**撞了**。WorkHub 不甩给他「conflict」,而是:「**你和小陈的改动撞了,AI 给了一个合并方案,你选一个/微调一下**」(PRD §8.5 冲突 AI 调解、FR-COLLAB-003)。
> 4. 小陈的活有一部分能让 AI 代劳——AI 工人在他的工作副本里先做,做不动的升级问他。**人和 AI 工人是对等的「分支持有者」**(PRD §8.1:多协作者及多 AI 工人各在自己分支)。
> 5. 小陈在外网咖啡馆离线改了点东西,回公司联网后自动同步并解冲突(PRD FR-SYNC-003 离线;演进自 `spec_watch.rs` 的 sha256 去重 append-only 同步)。

### 5.3 痛点
| 痛点 | 现状证据 | WorkHub 解法 |
|---|---|---|
| 协作是线性的、没有并行心智 | 现有有版本号/验收,但无「分支/提议/合并」(PRD §2.3 洞察) | 去黑话的并行分支-提议-合并(PRD L3、§8.5) |
| 改动撞车没人调解 | 现有无并发合并语义 | AI 给合并建议、人择一(FR-COLLAB-003;业务对象合并语义是护城河,PRD §16 开放问题 4) |
| 干活必须在线、本地改动回不去 | `sync.rs:227` 双向占位、仅下载(`Onboarding.tsx` 只开放「仅下载」) | 双向同步 + 离线编辑后合并(PRD §8.7) |
| 不会用 git 但被迫面对其概念 | — | 全程零术语(FR-COLLAB-004) |
| 接活/干活有设备门槛 | 现有 `require_local_client` 强制桌面客户端(`app/auth.py:183`) | **延续(刻意保留)**:接活/干活需桌面客户端 + 设备令牌(README 设备令牌门),协作者天然在 C-PET |

### 5.4 JTBD
- **主任务**:"当我和别人一起做一件活,我想**在自己的副本里安心推进我负责的部分**,提交给负责人确认即可,不被别人卡住。"
- **支线**:
  - "当我的改动和别人撞了,我想 **AI 直接给我一个合并方案**让我选,而不是丢给我一堆冲突标记。"
  - "当我在没网的地方改了东西,我想**联网后自动同步**且不丢、不乱。"
  - "当我那块有 AI 能干的部分,我想 **AI 先替我干**,只在它真卡住时找我。"

### 5.5 成功标准(可度量)
- **并行无阻塞**:多协作者同时推进同一 WorkItem 的占比 ↑,且彼此阻塞等待时长 ↓(验证 PRD P3「多人并行」价值,§12)。
- **冲突自动化解率**:撞车场景中由 AI 合并建议直接被采纳(无需人工手动 merge)的占比。
- **同步可靠性**:双向同步无丢失/无错乱(sha256 校验通过率);离线改动联网后成功合并率。
- **零术语校验**:协作主路径不出现 branch/merge/conflict 字样(FR-COLLAB-004)。

### 5.6 模块/端接触点
- **C-PET**:接活/干活主端(`client-tauri/web-src/src/routes/Inbox.tsx`、`MyWorkload.tsx`、`TaskDetail.tsx`;`SidebarWork.tsx` 工作空间侧栏)。
- **P-COLLAB / 03-collaboration**:分支-提议-合并的核心使用者(见 [branch-proposal-merge.md](../03-collaboration/branch-proposal-merge.md));冲突 AI 调解。
- **sync**:双向同步 + 离线(见 [sync-and-spec.md](../03-collaboration/sync-and-spec.md);Rust 侧 `spec_watch.rs`、`sync.rs`)。
- **P-AI**:AI 工人作为对等分支持有者协作;受阻向其升级。
- **安全门**:设备令牌门(`can_work_requirement` `app/services/permissions.py:114`、`require_local_client` `app/auth.py:183`)。

---

## 6. P5 — 管理员(Admin / "治理、成本、审计")

### 6.1 一句话定位
关心**治理、成本、审计**:谁能干什么、AI 烧多少 token、出了事查得到谁。对应现有全局 `User.is_admin`(`app/models.py:38`)。是 PRD 治理层(L5)与三大护城河(审批路由 / 对象合并 / 组织治理)的需求源。

### 6.2 场景叙事
> 团队负责工具的管理员老孙:
>
> 1. 他在新设备上用**管理员口令**登录(现有 onboarding 已有「管理员口令」字段,见 `Onboarding.tsx` step 1 `adminSecret`;后端 `app/routers/auth.py` identify 校验)。
> 2. 现状下他的特权是 `permissions.py` 里的短路:admin 对读路径绕过一切关系过滤(能审计任何历史/归档项目),对写路径绕过关系过滤但仍受 project-active 约束(见 `app/services/permissions.py` 模块 docstring 的 Admin scope)。**但他仍需注册设备令牌才能执行 claim/sync/delivery**——admin ≠ 绕过设备安全。
> 3. WorkHub 把这套薄 admin **演进为完整 RBAC + 分层 allow/deny/ask 策略**(PRD §8.6、L5):他配 `org → workspace → role → session` 合并的权限规则,**未匹配默认 ask**(FR-PERM-001)。
> 4. 他设**三级预算**(用户/团队/任务),低风险任务路由到更便宜的模型(PRD NFR-05、§11 LLM 抽象;现有 `app/config.py` 已是统一 provider 端点 DeepSeek-via-Anthropic)。
> 5. AI 的**每个动作按身份写入 AuditLog**(**新增**,PRD FR-PERM-004、NFR-03),可追溯、可回滚(NFR-04 快照)。出事时他能查「谁/哪个 AI、什么时候、做了什么、能否回退」。
> 6. 他用**看板**(M-DASHBOARD)看自治率、升级精准度、每条交付的 token 成本(PRD §13、NFR-11)。

### 6.3 痛点
| 痛点 | 现状证据 | WorkHub 解法 |
|---|---|---|
| 权限模型过薄(只有 admin/非 admin 二元) | 现有仅 `is_admin` 布尔 + 关系过滤(`app/services/permissions.py`) | 完整 RBAC + 分层 allow/deny/ask 策略(FR-PERM-001) |
| AI 当默认劳动力 = token 大户,无预算闸 | 现有 `auto_agent` 只有单次 `MAX_TURNS=15`/超时(`app/services/auto_agent.py:36-37`),无三级预算 | 用户/团队/任务三级预算配额 + 低风险用廉价模型(NFR-05) |
| 审计不成体系 | 现有审计零散:`ActivityLog`(`app/models.py:554`,仅 requirement 级)、`ProjectDriveOperation`(`app/models.py:214`,可 undo) | 按身份的全量 AuditLog,统一可追溯可回滚(FR-PERM-004、NFR-03/04) |
| 没人决定「谁该批」、超时无人管 | — | 审批路由(按角色/负责人/项目)+ 超时 SLA + 可委派(FR-PERM-002/003;护城河,opencode 未解) |
| 上云后威胁模型仍按「可信局域网」 | 现有 LAN/免登录(`app/auth.py` docstring「no password; LAN-only use」) | 威胁模型从「可信局域网」重审(NFR-02;见 [security-and-permissions.md](../01-architecture/security-and-permissions.md)) |
| 看不到成本/自治/升级全局态 | 现有无成本/自治看板 | M-DASHBOARD 看板(NFR-11) |

### 6.4 JTBD
- **主任务**:"作为管理员,我想**精确控制谁(人或 AI)能做什么、能烧多少**,并在**出事时查到责任人/可回滚**,这样我能让 AI 大胆干活而组织风险可控。"
- **支线**:
  - "当 AI 想做越权/高风险动作,我想它**默认先问**,而不是先斩后奏。"(默认 ask)
  - "当审批请求发出,我想它**自动路由到对的人**,长时间没响应能升级/委派。"(审批路由 + SLA)
  - "当成本接近预算,我想被**提前告警**并能让低风险任务降级到便宜模型。"(成本治理)
  - "当我要复盘,我想看到**自治率、升级精准度、每条需求的 token 成本**。"(看板)

### 6.5 成功标准(可度量)
- **越权/高风险动作零静默**:所有此类动作经审批门(FR-PERM-001 覆盖率 = 100%)。
- **审计完整性**:AI/人的每个副作用动作 100% 有 AuditLog + 可回滚快照(NFR-03/04)。
- **成本可控**:每条已交付需求的 AI token 成本可见且在预算内(PRD §13、NFR-05);预算耗尽优雅降级而非静默截断(NFR-06、PRD FR-WORKER-003)。
- **审批 SLA 达成率**:审批请求在 SLA 内被响应/委派的占比(FR-PERM-003)。

### 6.6 模块/端接触点
- **C-WEB**:管理面板(现有 `client-tauri/web-src/src/components/AdminPanel.tsx` 雏形)、看板(`web/src/pages/Dashboard.tsx`、`HealthPage.tsx` 演进为 M-DASHBOARD)。
- **P-PERM / P-AUDIT / P-COST**(横切能力,见 [README.md §2.2](../README.md)):分层策略 + 审批路由 + 全量审计 + 三级预算。
- **01-architecture/security-and-permissions.md**:威胁模型、设备令牌门、RBAC 的权威定义。
- **L0 身份**:Org/Workspace/角色的管理者(PRD §6 L0、§7 Org/Workspace 实体,**新增**)。
- **设备治理**:现有 `client_devices` 表 + `app/routers/client_devices.py`(发/吊销设备令牌)是其治理面的事实起点。

---

## 7. 跨画像:同一个人的多顶帽子

PRD §1 的「**一人两顶帽子**」讲的是 **AI** 在工人/经理间切换;而在**人**这一侧,同一真人也常在不同 WorkItem 上戴不同帽子。设计时必须区分「人」与「他此刻在此 WorkItem 上的角色」:

| 场景 | 同一人,不同帽子 | 系统侧落点 |
|---|---|---|
| 老王提了需求 A,又被派去牵头需求 B | A 上是 **P3 提交者**,B 上是 **P2 负责人** | `Requirement.submitter_user_id` vs `RequirementAssignment.role=lead` |
| 小陈在需求 C 牵头、在需求 D 打下手 | C 上是 **P2 负责人**,D 上是 **P4 协作者** | 同一 user,两条不同的 `RequirementAssignment` |
| 管理员老孙也亲自接活 | 全局 **P5 管理员** + 某工单 **P4 协作者** | `is_admin=True` 叠加 per-WorkItem 角色 |
| 小白小李做熟了,开始牵头 | 从 **P1** 成长为 **P2** | 画像是连续谱,非固定标签 |

**设计含义**:
1. **权限按「此刻角色」算,不按「这个人是谁」算**——这正是现有 `permissions.py` 的做法(`is_submitter` / `is_assignee` / `lead_assignment` per-requirement 判定),WorkHub 在其上叠 RBAC。
2. **桌宠/Web 不是「按人锁端」**:习惯上小白/协作者在 C-PET、负责人/提交者/管理员在 C-WEB,但**真正的硬约束是「接活/干活需桌面客户端」**(设备令牌门),而非画像本身。一个负责人若要亲自接活,也得在 C-PET。
3. **画像是 JTBD 的载体,不是数据库枚举**:数据库里没有「persona」字段;画像驱动的是**默认体验编排**(给小白桌宠优先、给负责人审批队列优先)与 **AI 决策上下文**(L0 身份喂派活)。

---

## 8. 画像 × 模块接触点矩阵(速查)

> ●=主要使用者/核心场景 ○=次要接触 —=基本不接触。模块代号见 [README.md §2](../README.md)。

| 模块 / 能力 | P1 小白 | P2 负责人 | P3 提交者 | P4 协作者 | P5 管理员 |
|---|:---:|:---:|:---:|:---:|:---:|
| M-WORKITEM(工作项主轴) | ○ | ● | ● | ● | ○ |
| M-DRIVE(项目+网盘) | ○ | ● | ○ | ● | ○ |
| M-MEETING(会议→洞察) | — | ○ | ● | ○ | — |
| M-NOTIFY(任务/提醒/通知) | ● | ● | ● | ● | ○ |
| M-KNOWLEDGE(知识库问答) | ○ | ○ | ○ | ○ | — |
| M-DASHBOARD(看板/度量) | — | ○ | ○ | — | ● |
| P-AI(工人/经理/分级/派活) | ●(被服务) | ●(审 + 确认派活) | ●(被澄清/派活) | ●(对等协作) | ○(设策略约束) |
| P-COLLAB(分支-提议-合并/同步) | ○ | ●(审批 merge) | ○(规格页) | ●(核心) | ○ |
| P-IDENTITY(身份/技能档案/协作图) | ●(填自述) | ○ | ○ | ●(填自述) | ●(管理 Org/角色) |
| P-PERM(分层策略/审批路由/SLA) | — | ●(被路由审批) | — | — | ●(配置者) |
| P-AUDIT(审计/回滚) | — | ○(看 trace) | ○ | ○ | ●(核心) |
| P-COST(三级预算/模型路由) | — | — | — | — | ●(核心) |
| C-WEB(浏览器端) | ○ | ● | ● | ○ | ● |
| C-PET(桌面宠物端) | ● | ○ | ○ | ● | ○ |

---

## 9. 与上游/同级文档的衔接

- **上游裁决**:本篇任何与 [PRD](../../prd/2026-06-04-workhub-prd.md) §4/§5 冲突处,以 PRD 为准;本篇是 PRD §4 的「完备叙述级」展开,不引入新决策。
- **术语**:去黑话映射的权威版在 [glossary-dejargon.md](./glossary-dejargon.md)(撰写中);本篇用到的「工作副本/改动/提交确认/采纳/撞车」均指向该表,不重复定义。
- **角色 → 权限**:画像到系统角色与 RBAC 的精确映射,见 [01-architecture/security-and-permissions.md](../01-architecture/security-and-permissions.md);本篇只给「典型主导身份」,不定义策略语法。
- **画像 → AI 行为**:各画像「AI 对其默认关系」的机制细节,见 [02-ai-engine/](../02-ai-engine/)(工人循环、置信度/风险/升级、智能派活、可解释)。
- **画像 → 协作流**:协作者/负责人的分支-提议-合并体验细节,见 [03-collaboration/](../03-collaboration/)。
- **画像 → 端**:小白/协作者的桌宠体验,见 [05-clients/desktop-pet-tauri.md](../05-clients/desktop-pet-tauri.md);负责人/提交者/管理员的 Web 信息架构,见 [05-clients/web-app.md](../05-clients/web-app.md)。

---

## 10. 开放问题(汇入 [07-open-questions.md](../07-open-questions.md))

1. **小白 vs 协作者的边界**:二者主端都是 C-PET、都填技能自述,产品上是否需要区分两条 onboarding,还是同一条按熟练度渐进解锁?(对应 PRD §16 开放问题 5 桌宠人格)
2. **画像随成长迁移**:是否需要显式追踪「某人从协作者成长为可牵头」的信号(供智能派活加权)?这与 `CollaborationGraph`(命中率)耦合(PRD §8.4 FR-STAFF-004/005)。
3. **管理员的「亲自下场」体验**:admin 接活时(P5+P4 叠加),设备令牌门 + 审计是否对其有特例?(倾向:无特例,admin ≠ 绕过设备安全,延续现有 `permissions.py` 立场)
4. **提交者对「AI 干到哪」的可见度边界**:trace 全量透明 vs 摘要式,对非技术提交者怎样才「人话且不过载」?(关联 PRD FR-EXPLAIN-001)
