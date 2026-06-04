---
module: 00-overview
layer: L0-L5（全局口径 / 词汇宪法）
status: 🚧
owner: workflow
related:
  - ../../prd/2026-06-04-workhub-prd.md            # 上游 PRD（§4 去黑话、§8.5 协作映射表）
  - ../README.md                                    # 规格树索引（§0 frontmatter 约定、产品呈现模式表）
  - ../01-architecture/data-model.md               # 实体/状态机/字段锚点同源（本篇标签映射 ↔ 该篇字段）
---

# 术语与去黑话对照（Glossary & De-jargon）

> **本篇是 WorkHub 全文档树的「词汇宪法」。** 任何文档、任何 UI 文案、任何 AI 输出，凡涉及术语，以本篇为准。
> 上游：[PRD §4 去黑话](../../prd/2026-06-04-workhub-prd.md)（产品宪法第 4 条）、[PRD §8.5 协作映射表](../../prd/2026-06-04-workhub-prd.md)、[规格树索引](../README.md)。

WorkHub 有**两套词汇**,且必须严格分层:

- **内部词汇(Internal / Engineering)**:工程师、数据库、API、本规格树内部用。可以出现 git 概念、状态机枚举、英文技术名词。
- **用户词汇(User-facing / 人话)**:任何会被**用户**(小白/负责人/提交者/协作者)看到的地方——UI 文案、桌宠对话、通知、AI 给的理由、邮件——只能用人话。

> **去黑话第一定律**:用户永远看到的是「**AI 拟好了,确认?**」,绝不是 `merge` / `branch` / `conflict` / `confidence=0.82`。
> 这条直接落地自现有代码:`shared/src/design/status-vocab.ts` 已经把内部状态枚举(`delivered`、`accepted`)映射成用户标签(「已交付」「已完成」),WorkHub 把这层映射**升级为全局强制层**,覆盖所有协作/AI 术语。

本篇小节:

1. 怎么用这张词汇表(分层规则 + 落地约束)
2. Git 黑话 → 用户用语 权威映射(核心)
3. AI 模式术语的人话表达(工人 / 项目经理 / 升级 / 置信度)
4. 全量术语表 A:领域实体与业务对象
5. 全量术语表 B:AI 引擎与自治执行
6. 全量术语表 C:协作、审批与权限
7. 全量术语表 D:状态机与状态标签(权威映射)
8. 全量术语表 E:平台、客户端与基础设施
9. 缩写与代号速查
10. 写作与 UX 文案规约(给文档作者 + 给 AI 提示词)

---

## 1. 怎么用这张词汇表

### 1.1 三列模型

下文每张表尽量给出三列:

| 列 | 含义 | 出现在哪里 |
|---|---|---|
| **内部术语** | 工程/数据库/API 用的权威名 | 代码、`data-model.md`、`api-contract.md`、本规格树正文 |
| **用户用语(人话)** | 用户唯一该看到的说法 | UI、桌宠、通知、AI 理由、`status-vocab.ts` 标签 |
| **现有代码锚点** | 这个概念今天落在哪个真实文件/实体 | `app/…`(daemon)、`web/…`(C-WEB)、`client-tauri/…`(C-PET)、`shared/…`(C-UIKIT) |

> 没有「现有代码锚点」列的条目 = WorkHub **新增**概念(PRD 标注「新增/命门/护城河」),本篇会显式注明 *(新增)*。

### 1.2 分层硬规则(可被 lint / review 检查)

1. **用户面 = 零 git 黑话。** UI/桌宠/通知里出现 `branch`、`commit`、`PR`、`merge`、`conflict`、`diff`、`rebase`、`HEAD`、`repo` 任一英文/直译,即为缺陷。
2. **用户面 = 零内部状态枚举。** 不暴露 `summary_ready`、`ai_processing`、`revision_requested` 这类 snake_case;一律走 §7 的标签映射(承袭 `statusLabel()`,见 `shared/src/design/status-vocab.ts:42`)。
3. **用户面 = 零裸数值阈值。** 不显示「置信度 0.82」「风险 7/10」;只说人话档位(见 §3,落地 PRD `FR-ESC-001`)。
4. **AI 提示词 = 英文 + 内部术语;AI 输出 = 用户语言 + 人话。** 这是现有约定的延续:`auto_agent.py:535` 的 `REVIEW_SYSTEM` 已经要求「Write the reason in the user's language」。
5. **文档之间 = 内部术语,但首次出现给人话注解。** 本规格树正文用内部术语沟通(精确),但在每篇首次引入时用括号给出人话,交叉概念用相对链接指向本篇而非重复定义。

---

## 2. Git 黑话 → 用户用语(权威映射)

> 这是 PRD §8.5 映射表的**权威细化版**。WorkHub 内部用 git 心智组织协作(分支/提议/合并),但对用户**全程隐藏**。下表左→右是唯一允许的翻译方向。

| Git / 内部心智 | 内部术语(本树用) | 用户用语(人话,唯一可见) | 说明 / 落地锚点 |
|---|---|---|---|
| `branch` | **Branch(工作分支)** *(新增)* | **「我的工作副本」/「草稿」** | 某协作者或某 AI 工人对一个 WorkItem 的独立工作空间,互不阻塞。概念演进自现有 `RequirementWorkspace`(`models.py:378`,已是「每人一份 phase/进度」的雏形)。 |
| `commit` / `diff` | **改动集(changeset)** *(新增)* | **「改动」/「这次做的内容」** | 用户只感知「做了哪些改动」,不感知提交粒度。 |
| `open a PR` | **Proposal(提议)** *(新增,核心)* | **「提交给负责人确认」** | 一个分支请求汇入正式版的变更集 = 去黑话的 PR。脊梁骨是现有 `Delivery`(`models.py:515`,按 `round` 版本化的交付包)。 |
| `review` | **Review(审阅)** | **「查看 / 看一眼」** | — |
| `approve` / `accept` | **Approve(批准)** | **「确认 / 通过 / 采纳」** | 落地自现有验收:状态 `accepted`,用户标签**「已完成」**(`status-vocab.ts:38`);客户端按钮文案已是**「通过」**(`client-tauri/web-src/src/routes/HubDispatch.tsx`)。 |
| `reject` / `request changes` | **Reject / RevisionRequest(打回)** | **「打回(说原因)/ 退回重做」** | **必须带理由**。落地自现有 `RevisionRequest`(`models.py:535`,`reason_md` 非空)+ 状态 `revision_requested`,用户标签**「等你重做」**(`status-vocab.ts:37`)。 |
| `merge to main` | **Merge(合并入 main)** | **「采纳 / 汇入正式版」** | 用户只看到「采纳了」,不看到 `main`/`merge`。 |
| `main` / `trunk` | **main(单一可信源)** | **「正式版 / 当前定稿」** | 唯一真相源。对用户是「这个活现在的官方版本」。 |
| `conflict` | **Conflict(并发冲突)** *(新增)* | **「和别人的改动撞车了——AI 给了合并方案,选一个」** | 同一业务对象并发改动。AI 调解给建议,人择一/微调(`FR-COLLAB-003`)。**业务对象合并语义是护城河之一**(PRD §16 开放问题 4),详见 [branch-proposal-merge](../03-collaboration/branch-proposal-merge.md)。 |
| `revert` / `rollback` | **Snapshot revert(快照回滚)** *(新增,安全红线)* | **「撤销 / 还原到改之前」** | AI 每次副作用前存快照,可还原(`FR-WORKER-004`/`NFR-04`)。雏形:网盘已有版本号(`ProjectDriveVersion`,`models.py:192`)与可撤销操作日志(`ProjectDriveOperation` 的 `undone_at`,`models.py:222`)。 |
| `fork` / `derive` | **派生(derive)** | **「基于这个再开一个新活」** | 落地自现有 `Requirement.source_requirement_id`(`models.py:341`)。 |
| `repo` / `repository` | **Project / Workspace** | **「项目 / 工作区」** | 落地自现有 `Project`(`models.py:71`)。 |
| `clone` / `pull` / `push` | **Sync(同步)** | **「同步 / 把文件拿到本地 / 传上去」** | 双向同步(`FR-SYNC-*`)。现状是单向下载占位(`client-tauri/src-tauri/src/sync.rs:227` 注释明说 placeholder),WorkHub 补齐双向。 |
| `staging` / `working tree` | (不暴露) | **「还没提交的改动」** | — |
| `blame` / `log` / `history` | **ActivityLog / AuditLog** | **「谁改了什么 / 历史记录」** | 落地自现有 `ActivityLog`(`models.py:554`),WorkHub 升级为按身份的全量 `AuditLog`(`P-AUDIT`,新增)。 |
| `README` | **SpecDoc(规格页)** | **「需求说明页 / 这个活到底要做什么」** | 活文档,随澄清/交付自动更新(`FR-SPEC-*`)。地基是 `client-tauri/src-tauri/src/spec_watch.rs`(spec 文件夹 ↔ 服务器同步)。 |

> **反例(禁止出现在用户面)**:
> - ❌「你的 PR 已 merge 到 main」 → ✅「负责人采纳了你的改动,已汇入正式版」
> - ❌「检测到 merge conflict,请 rebase」 → ✅「你和小李的改动撞车了,AI 拟了个合并方案,你看选哪个」
> - ❌「该需求 status=revision_requested」 → ✅「这个活被打回了,附了原因,看一下」

---

## 3. AI 模式术语的人话表达

> WorkHub 的命门是「一人两顶帽子」的 Agent(PRD §1/§5)。这些是用户**会反复看到**的 AI 状态/角色词,人话表达必须统一。

### 3.1 两顶帽子:工人 / 项目经理

| 内部术语 | 用户用语(人话) | 说明 / 锚点 |
|---|---|---|
| **AI Worker(工人模式,默认态)** | **「AI 在帮你做」/「AI 助理在干活」** | AI 直接产出交付物。落地自 `auto_agent.py` 的 `run_auto`/`auto_process`(tool_use 自治循环)。现有用户标签已是**「AI 助理处理中」**(状态 `ai_processing`,`status-vocab.ts:34`)与**「AI 助理写交付文档中」**(`delivery_doc_pending`,`status-vocab.ts:35`)。 |
| **AI PM Mode(项目经理模式,受阻态)** | **「AI 帮你找人推进」/「AI 在安排谁来做」** | AI 受阻时转而组织人:派活、排期、提醒、盯进度、再审(PRD §8.3)。*(新增)* |
| **Actor(执行主体)** | **「谁在做」(可能是「AI 助理」或某个人名)** | 内部区分 AI / human actor;用户只看到具体名字或「AI 助理」。现有 `auto_agent.py` 注释已用 "AI worker" 指代。 |

> **口径统一**:对用户**不区分**「工人/经理」这两个内部词;用户只感知「AI 在做」还是「AI 在找人」。「模式切换」这个词不进用户面。

### 3.2 升级(Escalation)

| 内部术语 | 用户用语(人话) | 说明 / 锚点 |
|---|---|---|
| **Escalation(升级)** | **「AI 觉得这个得请人来」/「转人工接手」** | 工人模式 → 经理模式的切换。**「升级」二字不进用户面**(像投诉),改说「请人来/找人接手」。*(新增,命门)* |
| **EscalationEvent(升级事件)** | (不暴露;呈现为)**「为什么需要人 + 建议谁来做 + 计划」简报** | `FR-PM-001`。*(新增)* |
| **三个升级触发器** | 见下三行 | PRD §8.2 |
| └ 触发器①「不合格」 | **「AI 自查觉得还没达标」** | 落地自 `auto_agent.py:544` `llm_review`(返回 `meets_requirement: false`;评审提示词 `REVIEW_SYSTEM` 在 `auto_agent.py:535`)。 |
| └ 触发器②「用户不满意」 | **「你打回了,AI 按你说的原因接着改」** | 落地自 `RevisionRequest`(`models.py:535`)。理由**回灌**给 AI 续做,不重来(`FR-ESC-003`)。 |
| └ 触发器③「用户明确不让 AI 干」 | **「这个活你选了人来做」** | 新增「人工保留」开关(WorkItem/项目/用户三级,`FR-ESC-005`)。*(新增)* |
| **doom-loop(打转)** | **「AI 卡住了、在原地打转,叫人来」** | 连续 N 次相同动作判卡住(`FR-ESC-004`,借鉴 opencode)。现状是粗粒度的 `MAX_TURNS=15` 上限(`auto_agent.py:36`)。*(新增)* |
| **budget exhausted(预算耗尽)** | **「AI 做了一阵没收尾,先把『已做/没做/下一步』交给你」** | `FR-WORKER-003`/`FR-ESC-004`。现状:超 `MAX_TURNS`/`TOTAL_TIMEOUT_DEFAULT` 返回失败 `AutoResult`(`auto_agent.py:505`),WorkHub 升级为**结构化交接件**。 |
| **回灌(feedback loop / CorrectedError)** | (不暴露;表现为)**「AI 记住了你的意见,接着改」** | 打回理由/拒绝理由作为上下文喂回 AI。借鉴 opencode CorrectedError。 |

### 3.3 置信度与风险(裸数值绝不进用户面)

| 内部术语 | 用户用语(人话) | 说明 / 锚点 |
|---|---|---|
| **ConfidenceRecord(置信度记录)** | (不暴露记录本身) | 某次产出的置信度+风险+分级裁决+依据(`FR-ESC-001`)。*(新增,命门)* |
| **confidence(置信度,内部 `low/medium/high` 或分值)** | **「我比较有把握」/「我大致有谱,但建议你扫一眼」/「我不太确定,想请你拍板」** | **绝不显示数值/阈值**(`FR-ESC-001` 明文)。**现有精确先例**:`Requirement.estimate_confidence` 已是 `low\|medium\|high` 枚举(`schemas.py:227`、`models.py:333`)——WorkHub 沿用这套粗档,只是用人话渲染。 |
| **risk score(风险评分)** | **「这事影响面大/不好撤回,稳一点找人确认」** | 风险维度(可逆性/对外性/金额合规/影响人数)待与业务共定(PRD §16 开放问题 3)。*(新增)* |
| **分级裁决:高置信+低风险** | (用户视角)**「AI 做完了,已采纳」(可能连确认都免了)** | 直接生成 Proposal,按策略可自动合并。 |
| **分级裁决:中档** | **「AI 做好了,你快速扫一眼,通过或打回」** | 强制人工抽检(spotcheck)。 |
| **分级裁决:低置信/高风险/卡住** | **「这个 AI 拿不准,已经请人来接手」** | 升级转经理模式。 |
| **confidence_reason(置信度理由)** | **「我之所以这么判断,是因为…」(给证据)** | **现有先例**:`MeetingInsight.confidence_reason`(`models.py:302`)+ `meeting_agent.py:20` 的 `MeetingInsightDecision.confidence_reason` 字段已让 AI 自报判断理由;本地 fallback 还硬写「建议人工确认」(`meeting_agent.py:77`)。WorkHub 把「带人话理由+证据」推广到所有 AI 决策(`FR-EXPLAIN-001`)。 |

> **口径统一**:无论内部用 0–1 分值还是 `low/medium/high`,用户面**只有三种语气**:有把握 / 建议看一眼 / 拿不准请你定。这与现有 `estimate_confidence` 的三档天然对齐。

---

## 4. 全量术语表 A:领域实体与业务对象

> 与 [data-model.md](../01-architecture/data-model.md) 同源;此处给「名 + 一句话 + 人话 + 锚点」,字段细节见数据模型篇。

| 内部术语 | 一句话定义 | 用户用语 | 现有代码锚点 |
|---|---|---|---|
| **User** | 身份(昵称 / 令牌 / admin 标志) | 「成员 / 你 / 某人」 | `models.py:27`(昵称唯一、`cookie_token`、`is_admin`、软删除 `deleted_at`) |
| **UserProfile** | 技能自述、自我介绍、专长标签、可用度 | 「个人简介 / 我擅长什么」 | *(新增)*;可用度雏形 `User.availability_status`(`models.py:33`) |
| **CollaborationGraph** | 「谁擅长什么、与谁合作过、命中率」的聚合视图 | (不暴露;表现为)「AI 为什么推荐他」 | *(新增,聚合)*;聚合来源 `ActivityLog`(`models.py:554`) |
| **Org / Workspace** | 租户与工作区(治理/多租户预留) | 「组织 / 工作区」 | *(新增)*;现有有 `app/routers/workspaces.py`(注意:与 WorkItem 内的 `RequirementWorkspace` 不同概念,见下方「易混词」) |
| **Project** | 项目(slug / owner / 编号序列) | 「项目」 | `models.py:71`(`slug`、`owner_user_id`、`next_seq` 生成 `PROJ-001`) |
| **WorkItem** | **主轴**:状态机驱动的「一个活」 | 「需求 / 任务 / 这个活」 | 演进自 `Requirement`(`models.py:314`;`code`、`status`、`priority`、`due_at`) |
| **Assignment** | lead + N 协作者的指派 | 「负责人 / 协作者」 | `models.py:363`(`role` = `lead\|collaborator`) |
| **Delivery** | 交付包,按 `round` 版本化 | 「交付物 / 这一版」 | `models.py:515`(`package_sha256`、`round`、`delivery_doc_md`) |
| **AcceptanceCriteria** | 可对照的验收清单 | 「验收标准」 | `models.py:464`(`RequirementAcceptanceItem`,`status` = `open\|…`) |
| **SpecDoc(README)** | 需求规格展示页,活文档 | 「需求说明页」 | 演进自 spec 文件夹 + `client-tauri/src-tauri/src/spec_watch.rs` |
| **Document / DriveItem** | 网盘文件树 + 版本 + 操作日志 | 「项目网盘 / 文件」 | `models.py:167`(`ProjectDriveItem`,`kind`=`file\|folder`)/`:192`(版本)/`:214`(操作日志) |
| **MeetingRecord / MeetingInsight** | 录音→转写→纪要→洞察→需求草稿 | 「会议 / 会议要点 / 草稿建议」 | `models.py:269`/`:291` |
| **Notification / ScheduleEvent / Reminder** | 通知、排期、提醒、待办 | 「通知 / 日程 / 提醒」 | `models.py:146`(通知,带 `dedupe_key` 去重)/`:250`(排期) |
| **KnowledgeDocument / KnowledgeAskRun** | grep 语料 + 强制引用问答 | 「知识库 / 查证据」 | `models.py:110`/`:128`(`citations_json` 强制引用,`trace_json`) |
| **ActivityLog → AuditLog** | 谁/AI 做了什么(可回溯) | 「历史记录」 | `models.py:554` → 升级为按身份全量审计 *(新增)* |
| **BackgroundJob** | 异步任务(转写/AI 处理/索引)的进度载体 | (不暴露;表现为)「处理中…进度条」 | `models.py:93`(`status`=`queued\|…`,`progress_percent`) |

### 易混词澄清(同名不同义,作者必读)

- **Workspace(组织工作区,新增) ≠ RequirementWorkspace(`models.py:378`)**:前者是租户级容器(`Org/Workspace`),后者是**某成员在某 WorkItem 下的个人工作面**(phase/进度/阻塞原因),正是 WorkHub「**工作分支(Branch)**」的现实雏形。本树用 **Branch** 指后者的演进体,用 **Workspace** 指前者。
- **Delivery(交付包) ≠ Proposal(提议)**:Delivery 是「打成 zip 的产物」(`package_path`/`package_sha256`),Proposal 是「请求把这版汇入正式版的动作」。一个 Proposal 通常承载一个 Delivery + 改动说明。
- **Comment(`models.py:545`,需求评论) ≠ ProjectDriveComment(`models.py:228`,网盘评论触发 LLM)**:后者会过一遍 LLM 并可生成需求草稿(`status`=`pending_llm`)。

---

## 5. 全量术语表 B:AI 引擎与自治执行

> 与 [agent-loop-and-tools](../02-ai-engine/agent-loop-and-tools.md) / [confidence-risk-escalation](../02-ai-engine/confidence-risk-escalation.md) 同源。

| 内部术语 | 一句话定义 | 用户用语 | 现有代码锚点 |
|---|---|---|---|
| **AgentRun** | 一次 AI 自治执行(工人或经理),含完整 trace | 「AI 这次的处理过程」 | 演进自 `auto_agent.run_auto`(`auto_agent.py:374`);现回执 `AutoResult`(`auto_agent.py:365`)/`AutoOutcome`(`auto_agent.py:592`) |
| **runLoop / agent loop(执行循环)** | 单循环:每步装配工具+上下文、调模型、按控制信号分支 | (不暴露) | `auto_agent.py:405` 的 `for turn in range(1, MAX_TURNS+1)` |
| **control signal(控制信号)** | `continue / stop / compact / escalate` 的分支裁决 | (不暴露) | 现为隐式:`submit` → stop;`end_turn` 无产物 → fail(`auto_agent.py:501`)。WorkHub 显式化(借鉴 opencode) |
| **完成判定(done)** | AI 不再请求动作即完成,**非显式 flag** | (不暴露) | 现状用 `submit` 工具显式声明 + 产物目录非空校验(`_has_deliverables`,`auto_agent.py:510`) |
| **Tool(工具)** | 最小契约 `{id, 描述, 参数 schema, execute}` | (不暴露;表现为)「AI 在读文件/在跑脚本」 | `auto_agent.py:51` 的 `TOOLS`(list_files/read_file/write_file/run_command/zip_path/submit…) |
| **tool registry(工具注册表)** | 按「当前 actor 权限」过滤模型可见的工具菜单 | (不暴露) | *(新增,演进)*;现为静态 `TOOLS` 列表 |
| **CorrectedError(可恢复错误回灌)** | schema 校验失败 → 回「请改输入」而非崩 | (不暴露) | 现状:工具异常以 `[error] …` 文本回灌(`auto_agent.py:490`) |
| **Sandbox(沙箱)** | 路径限定 + 文件/大小上限 + 命令白名单 + rlimit | (不暴露;表现为)「AI 在安全隔离区里干活」 | `auto_agent.py`:`_safe_path`(`:154`)、`_enforce_sandbox_budget`(`:176`,`MAX_SANDBOX_FILES=800`/`200MB`)、`ALLOWED_COMMANDS`(`:42`)、`_sandbox_rlimits`(`:268`) |
| **Budget(预算)** | 每个 AgentRun 的硬上限(轮次/超时/token) | (不暴露;耗尽时给交接件) | `MAX_TURNS=15`、`TOTAL_TIMEOUT_DEFAULT=5min`、`COMMAND_TIMEOUT=45s`(`auto_agent.py:36-41`) |
| **LLM Review(AI 复审)** | 独立一次 LLM 调用判「产物是否真满足需求」 | **「AI 自己又检查了一遍」** | `auto_agent.py:544` `llm_review` → `{"meets_requirement": bool, "reason"}`(触发器①) |
| **trace** | 每步动作 + 工具输入输出的可审记录 | **「AI 都做了哪些步骤」** | 现以 SSE 事件流呈现(`ai.thinking`/`ai.tool_call`/`ai.done`,`auto_agent.py:438-507`);`KnowledgeAskRun.trace_json` 是落库雏形 |
| **Snapshot(快照)** | AI 每次副作用前的可回滚存档 | **「改之前的版本」** | *(新增,安全红线)*;现有可回滚雏形见 §2「revert」行 |
| **Provider(模型提供方)** | 统一注册表,DeepSeek-via-Anthropic 为其一 | (不暴露) | `auto_agent.py:34` `AsyncAnthropic(base_url=settings.llm_base_url)`;端点见 `config.py` |
| **置信度 / 风险 / 升级 / doom-loop / 回灌** | — | — | 见 §3(专表) |

---

## 6. 全量术语表 C:协作、审批与权限

> 与 [review-and-approval](../03-collaboration/review-and-approval.md) / [security-and-permissions](../01-architecture/security-and-permissions.md) 同源。

| 内部术语 | 一句话定义 | 用户用语 | 现有代码锚点 |
|---|---|---|---|
| **Branch / Proposal / Merge / Conflict / Review / Approve / Reject** | 去黑话协作六件套 | 见 §2 专表 | §2 |
| **Approval(审批 = 阻塞原语)** | 工具在「该决策那一刻」`ask` 人,阻塞至回复 | **「等你点头才继续」** | *(新增,借鉴 opencode)*;现有阻塞雏形是「设备令牌门」(见 §8) |
| **PermissionPolicy(分层策略)** | `org→workspace→role→session` 合并的 allow/deny/**ask** 规则 | (不暴露) | *(新增)*;现有 RBAC 雏形 `app/services/permissions.py`(`can_view_*`/`can_claim_*`/`can_work_*`) |
| **ask(默认就问)** | 未匹配规则时的默认动作 = 问人 | **「拿不准就先问你」** | `FR-PERM-001`(未匹配默认 ask) |
| **「永远允许」(always-allow 学习)** | 把一次放行沉淀为自动规则,减少打扰 | **「以后这类不用再问我」** | `FR-PERM-003` |
| **审批路由(approval routing)** | 决定「**谁该批**」(按角色/负责人/项目) | (不暴露;表现为)「这事该找谁拍板」 | *(新增,护城河;opencode 没有)* |
| **SLA / 超时 / 委派** | 未响应的超时上限、可转他人批 | **「太久没人批就升级/转给别人」** | *(新增)* |
| **RBAC / Role** | 角色(submitter/lead/collaborator/admin) | 「提交者 / 负责人 / 协作者 / 管理员」 | `models.py:370`(`role`=`lead\|collaborator`)、`User.is_admin`(`models.py:38`) |
| **AuditLog(按身份审计)** | AI/人动作全量按身份记录,可回滚 | 「历史记录 / 谁做了什么」 | 演进自 `ActivityLog`(`models.py:554`)、网盘 `ProjectDriveOperation`(`models.py:214`) |

---

## 7. 全量术语表 D:状态机与状态标签(权威映射)

> **这是用户最高频看到的词。** 内部状态枚举 → 用户标签的映射,**权威来源是 `shared/src/design/status-vocab.ts`**(`STATUS_VOCAB`/`statusLabel()`)。WorkHub 在 WorkItem 状态机演进时,**任何新状态都必须同步登记到该映射**,否则用户面会漏出 snake_case 枚举。

### 7.1 现有状态(已落地,直接复用映射)

| 内部状态枚举 | 用户标签(人话) | 语气/色调 | 锚点 |
|---|---|---|---|
| `draft` | **草稿** | 中性 | `status-vocab.ts:28` |
| `clarifying` | **沟通中** | info | `:29` |
| `summary_ready` | **待你投递** | warn | `:30` |
| `ready` | **等接单** | warn | `:31` |
| `claimed` | **已接单** | info | `:32` |
| `doing` | **进行中** | accent | `:33` |
| `ai_processing` | **AI 助理处理中** | accent-2(脉动) | `:34` |
| `delivery_doc_pending` | **AI 助理写交付文档中** | info(脉动) | `:35` |
| `delivered` | **已交付** | success | `:36` |
| `revision_requested` | **等你重做** | error | `:37` |
| `accepted` | **已完成** | success | `:38` |
| `cancelled` | **已取消** | 中性 | `:39` |

> **现有合法转移**(权威来源 `app/routers/requirements.py` 的 `allowed` 转移表):`draft→clarifying→summary_ready→ready→claimed→doing→…→delivered→accepted`,以及任意态可 `→cancelled`、`revision_requested→doing`(打回后续做)。WorkHub 在此之上叠加 AI 分级/升级态——**新增态的字段细节与全量转移图见 [data-model.md](../01-architecture/data-model.md),本篇只管标签映射不重复画图**。

### 7.2 WorkHub 新增状态(命门,需同步登记标签)

> PRD §7.1 给出演进后的状态机(`ai_working` / `escalated` / `pm_mode` / `in_review` / `merged` 等)。下表给**建议的用户标签**,作为 `STATUS_VOCAB` 扩展的口径基准;最终枚举名以 `data-model.md` 为准。

| 内部状态(PRD §7.1) | 建议用户标签(人话) | 对应现有标签思路 |
|---|---|---|
| `ai_working`(工人模式执行中) | **AI 在帮你做** | 承袭 `ai_processing`「AI 助理处理中」 |
| `human_spotcheck`(中档抽检) | **等你扫一眼确认** | 承袭 `delivered`「已交付」的待验收语气 |
| `escalated` / `pm_mode`(已升级/经理模式) | **AI 在请人来接手** | *(新增)* |
| `in_review`(负责人审 Proposal) | **等负责人确认** | 承袭待验收语气 |
| `merged`(已汇入 main) | **已采纳 / 已完成** | 承袭 `accepted`「已完成」 |

---

## 8. 全量术语表 E:平台、客户端与基础设施

> 与 [system-architecture](../01-architecture/system-architecture.md) / [README 产品呈现模式表](../README.md) 同源。

| 内部术语 | 一句话定义 | 用户用语 | 现有代码锚点 |
|---|---|---|---|
| **headless agent daemon** | 无 UI 的后端核心,唯一真相源 | (不暴露) | 代号 **C-DAEMON**;演进自现有 FastAPI `app/main.py` |
| **瘦客户端(thin client)** | 桌宠/web/未来移动端,都连同一 daemon | (不暴露) | 代号 **C-WEB**(`web/`)/ **C-PET**(`client-tauri/`) |
| **桌面宠物(Desktop Pet)** | 有人格、可对话、能代操作的常驻入口 | **「桌宠 / 助理」** | *(新增,L4)*;替代现有右下角弹窗 + 托盘(`client-tauri/src-tauri/src/tray.rs`/`notify.rs`) |
| **SSE / WS 事件流** | 进度/权限询问/结果以「流上事件」推送各端 | (不暴露;表现为实时更新) | `app/services/push_bus.py`(topic 形如 `req:<id>`,事件 `ai.thinking`/`ai.tool_call`…)、`client-tauri/src-tauri/src/sse.rs` |
| **OpenAPI 契约 + 类型化客户端** | daemon 暴露 OpenAPI,客户端用生成类型 | (不暴露) | 演进自 `shared/src/api/`(`client.ts`/`types.ts`) |
| **设备令牌门(device-token gate)** | 接活/干活类高权限操作要求**注册过的桌面客户端**,服务端校验 | (不暴露;表现为)「这个操作要在桌面客户端里做」 | **延续,关键**:`app/auth.py` `require_local_client`/`current_client_device`,header `X-YQGL-Client-Token`(`LOCAL_CLIENT_HEADER`,`auth.py:23`);设备表 `ClientDevice`(`models.py:57`,`client_token_hash`/`revoked_at`) |
| **昵称身份(nickname identity)** | 免密、LAN-only、cookie+签名令牌 | **「填个昵称就能用」** | `app/auth.py`(`COOKIE_NAME="yqgl_id"`、`itsdangerous` 签名);`User.cookie_token`(`models.py:32`) |
| **派活空间 / 接活空间(Dispatch / Work)** | 浏览器可派活;接活干活专属桌面端 | **「派活台 / 我的工单」** | 现有客户端路由 `client-tauri/web-src/src/routes/HubDispatch.tsx`/`Hub.tsx`/`TaskDetail.tsx` |
| **Sync root / Manifest** | 同步根目录 + 文件清单(sha256 去重) | (不暴露) | `client-tauri/src-tauri/src/sync.rs`(`Manifest`/`ManifestFile`,sha256 校验);`spec_watch.rs`(append-only 同步地基) |
| **软删除(soft delete)+ 墓碑(tombstone)** | 不真删,打 `deleted_at` 标记;昵称墓碑可释放重用 | **「移到回收站,可恢复」** | `User.deleted_at`+`display_name` 墓碑逻辑(`models.py:43-54`,追加「(已停用)」);`Project.deleted_at`(`models.py:85`);`web/src/components/ProjectStateConfirm.tsx:22` 文案「这是软删除:项目会进入回收站…可恢复」 |
| **PostgreSQL(D-2)** | 替换 SQLite,支撑多 Agent+多人并发与行级锁 | (不暴露) | *(迁移目标)*;现状 SQLite 单 writer(`db.py:22-39` 注释详述「database is locked」之痛 + WAL/busy_timeout 仅缓解;`auth.py:97` 同有印证)。迁移要点见 [data-model §9](../01-architecture/data-model.md) |

---

## 9. 缩写与代号速查

| 代号 / 缩写 | 全称 | 一句话 |
|---|---|---|
| **C-DAEMON / C-WEB / C-PET / C-UIKIT** | 客户端代号 | daemon 核心 / Web 应用 / 桌宠客户端 / 共享设计系统(见 [README §1](../README.md)) |
| **M-WORKITEM / M-DRIVE / M-MEETING / M-NOTIFY / M-KNOWLEDGE / M-DASHBOARD** | 业务功能模块代号 | 见 [README §2.1](../README.md) |
| **P-AI / P-COLLAB / P-IDENTITY / P-PERM / P-AUDIT / P-COST** | 平台横切能力代号 | 见 [README §2.2](../README.md) |
| **L0–L5** | 分层架构 | 身份/编排/执行/协作/入口/治理(见 [PRD §6](../../prd/2026-06-04-workhub-prd.md)) |
| **P0–P5** | 里程碑分期 | 地基/旗舰/PM+派活/协作+同步/桌宠/治理(见 [PRD §12](../../prd/2026-06-04-workhub-prd.md)) |
| **FR- / NFR- / D-** | 需求/非功能/决策编号 | 见 [PRD §0](../../prd/2026-06-04-workhub-prd.md) / [functional-requirements](../06-roadmap/functional-requirements.md) |
| **JTBD** | Jobs To Be Done | 用户「要把什么事办成」(见 [personas-and-jtbd](./personas-and-jtbd.md)) |
| **YQGL** | 「需求管理大师」拼音首字母 | 现有代码前缀(`yqgl_id` cookie、`X-YQGL-Client-Token`、`logger "yqgl.*"`);新仓品牌切到 **WorkHub**,迁移期标识符可能并存 |
| **lead / collaborator** | 指派角色 | 负责人 / 协作者(`models.py:370`) |
| **deliverables / outputs** | 交付物目录 | AI 沙箱里的 `outputs/`(`auto_agent.py:510`) |

---

## 10. 写作与 UX 文案规约

### 10.1 给文档作者(本规格树)

- 正文用**内部术语**(精确);每篇**首次**出现某术语时,用括号补人话,例:「Proposal(提议,即用户看到的『提交给负责人确认』)」。
- 需要解释某术语时,**不要重抄本表**——用相对链接指回本篇对应小节,例:`见 [glossary §2](../00-overview/glossary-dejargon.md)`。
- 引用现有代码一律用**真实路径 + 实体名/行号锚点**(如 `models.py:314`),禁止臆造接口。
- 状态枚举出现时,标注其用户标签出处 `status-vocab.ts`,避免两处定义漂移。

### 10.2 给 AI 提示词与 UI 文案(用户面)

落地 §1.2 硬规则,给提示词/文案写作者的 checklist:

1. **英文提示词、内部术语** → 喂模型;**用户语言、人话** → 给用户(承袭 `auto_agent.py:535` `REVIEW_SYSTEM` 的「user's language」约定)。
2. 凡要显示状态 → 走 `statusLabel()`,不拼 snake_case。
3. 凡要表达 AI 把握程度 → 用 §3.3 三档语气,**绝不显示数值**。
4. 凡涉及协作动作 → 用 §2 右列(草稿/改动/提交确认/采纳/打回说原因/撞车了 AI 给方案)。
5. 凡 AI 给结论(派活/升级/判分)→ **必附人话理由 + 证据引用**(承袭 `confidence_reason`,落地 `FR-EXPLAIN-001`)。
6. 「升级」「合并」「冲突」「分支」这些**内部词不进用户面**;按 §2/§3 翻成人话。

> **一句话收尾**:内部我们用 GitHub 的精确;对用户,我们只说「AI 拟好了,确认?」。这张表就是这两个世界之间唯一的翻译官。
