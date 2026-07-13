# R13 · 六个新批设计稿（4c / P1.5 / C1 / A2 / S3 / G1）

> 状态：设计 · 2026-07-13 起草 · 只读代码 + 出稿，零代码改动
> 对应 00-plan.md §6（2026-07-13 晚用户二次需求追加）与「Cuu 角色总纲：Cuu = 项目经理」
> 基线：`origin/main @ 3a9a70d9`（merge(r13): integrate the hardening batch）
> 写作纪律：本文档只规划不施工；施工沿用 R12/R13 已有的并行批次模式（`r12-desktop-workbench/04-codex-execution-guide.md` §4 十三条铁律不变，下文简称「04 铁律#N」）
> 迁移编号说明：下文六节各给了一份独立的迁移草稿，编号统一暂记为 `0048_*`（当前仓库最新迁移是 `packages/db/migrations/0047_task_plan_paused_status.sql`，`meta/_journal.json` 最后一条 `idx=47`）。六份迁移彼此没有依赖关系、字段互不相关，谁先落地谁占用 0048，后落地的批次施工时顺延到 0049/0050...——这不是本设计需要预先协调的事，按落地顺序走 `drizzle-kit generate` 即可。

---

## 前置发现（影响多节的共性事实，先说一次，下文各节引用）

1. **`project_conversations.kind` 只有 `'main' | 'collab'` 两种**（`packages/contracts/src/domain/conversation.ts:5`，DB check 见 `packages/db/src/schema/core.ts:414`）。所有「协同会话」「1:1 单聊」「小群」在数据层今天已经是同一个 `kind='collab'`，区别只在 `conversation_participants` 的行数——群聊不需要新 kind，这是本轮六个批次里最重要的一条「其实已经具备」的事实，A2/G1/S3 都建立在它上面。
2. **turns 是无状态的**：`apps/api/src/services/conversation-turns.ts` 的 `createTurn` 每次调用都从 DB 重新拉最近 `DEFAULT_HISTORY_WINDOW=50` 条消息（`conversation-turns.ts:70,357-358`）重建上下文，进程里不保留任何跨轮会话状态（除了 `activeTurns` 这个纯并发闸，`conversation-turns.ts:310,322-325`）。这意味着 4c 的「待澄清状态」、C1 的「压缩进度」都不能放内存，只能落 DB 或从消息流位置推导。
3. **`userProfiles` 表是完全没有接线的死表**：`packages/db/src/schema/core.ts:264-279` 定义了 `bioMd/skillsText/skillTags/availabilityPref/onboardedAt`，但全仓库 `grep -rl "userProfiles"` 在 `apps/api/src`、`packages/db/src/repositories` 下零命中——没有 repository、没有 service、没有路由、没有 UI。A2 一节据此重新框定工作量。
4. **04 铁律#3「不许假接线」/ 铁律#4「所有循环内不许发 N+1 查询、所有列表带上限」** 在下文每一节的踩雷/验收门里都直接适用，不重复引用全文。

---

## 一、批 4c · Cuu 对话工具面（N2 发文件 + N3 澄清进对话）

### 1. 数据模型

**现有表盘点**：
- `conversation_messages.kind` check 约束目前是 `('text','file_card','action_card','system_event','tool_note')`（`packages/db/src/schema/core.ts:495-498`）。`file_card` 内容形状已经定义好：`{ drive_item_id, snapshot_name }`（`packages/db/src/repositories/conversations.ts:79`），且 `tool_note` 这个 kind 已经存在并被 `historyDisplayText` 渲染成「（一次工具调用）」（`conversation-turns.ts:192-193`）——工具调用的透明日志展示位其实已经有了，只是从未被 Cuu 侧写入过。
- `createCuuMessage`（`packages/db/src/repositories/conversations.ts:86-96`，服务侧调用见 `conversation-turns.ts:456-467`）**当前只接受 `kind:'text'`**，签名里 `contentJson` 是写死的 `{text, memory_citations?}` 形状，不是判别联合类型——要发 `file_card`/`tool_note`/新增的 `clarifying_question`，这个方法签名必须先扩成判别联合（对齐 `CreateUserMessageInput` 已经是判别联合的写法，`conversations.ts:76-80`）。
- **@ 提及完全没有结构化表示**：`apps/desktop-webview/src/workbench/chat/view.ts` 的 mention picker（`view.ts:232-234,1007-1029`）只列人类成员和文件两类候选，`pickMember` 把 `@${nickname} ` 当纯文本插进 textarea（`view.ts:1016`），消息落库后就是普通 `text` 内容里的一段字符串，没有 user_id 级别的结构化标记。"被 @ 必回" 里的「被 @」在这个系统里只能是**文本子串匹配**，不是结构化事件——这是本节最大的一条实现约束，见踩雷。
- 工单澄清现状（`apps/api/src/services/work-items.ts`）是一个**完全独立的有界上下文**：`chat_messages` 表（`schema/core.ts:1210-1225`）挂在已存在的 `work_item_id` 上，`role/kind/selectedOptionKey/userOtherText` 这套列专为「工单向导式澄清」设计（`clarificationQuestionDraftSchema` 等，`work-items.ts:477-573`），前提是工单已经建好。协同会话发生澄清时**还没有 work_item**，不能也不该往 `chat_messages` 塞行——两者是不同表、不同生命周期，硬复用会把两套鉴权/归属模型绞在一起。

**缺什么迁移**：
- `conversation_messages_kind_ck` 加一个新值 `'clarifying_question'`（内容形状 `{question, options?, placeholder?}`，结构上向 `clarificationQuestionDraftSchema` 看齐但独立定义，不 import 工单那份类型——避免误耦合两个有界上下文）。
- 草稿：`packages/db/migrations/0048_conversation_message_kind_clarify.sql`，沿用 `0047_task_plan_paused_status.sql` 的 `DROP CONSTRAINT → ADD ... NOT VALID → VALIDATE` 零停机写法。
- `packages/contracts/src/domain/conversation.ts:14-20` 的 `conversationMessageKindSchema` 同步加值。

### 2. 端点契约草案

不新开路由——工具环发生在既有 `POST /conversations/:id/turns`（`apps/api/src/routes/conversation-turns.ts:41`）内部，响应形状 `{turn_id, message}` 不变，只是 `message.kind` 现在可能是 `file_card`/`clarifying_question` 而不只是 `text`。

- 新增内部类型 `packages/agent/src/turns/tools.ts`（新文件）：定义三个工具的 JSON Schema——
  - `drive_search({query: string})` → 只读，返回 top 5 `{item_id, filename, mime, updated_at}`。
  - `send_file_card({drive_item_id: string})` → 落一条 `kind='file_card'` 的 Cuu 消息。
  - `create_work_item({title, summary, clarification_answer?})` → 仅在「上一轮 Cuu 提过 clarifying_question 且这轮是它的直接回复」时才允许调用（见交互要点）。
- `LlmCreateParams.tools?: unknown[]` 字段本就存在（`packages/agent/src/providers/types.ts:43`），但 `TurnLlmClient.messages.stream`（`conversation-turns.ts:109-119`）从未把 `tools` 传下去——需要扩展这个类型和调用点（`conversation-turns.ts:423-429`）。
- `drive_search` 工具不直接调 `DrivePageService.page()`（那个方法组装整页 VM：文件夹树/面包屑/评论，太重）。改为在 `DriveRepository` 已有的 ILIKE 搜索原语上（`packages/db/src/repositories/drive.ts:165,571-572`，`nameQuery` 转义逻辑已经在那）包一层窄函数，权限门槛与网盘页一致：`canViewProjectDrive`（`apps/api/src/services/drive-pages.ts:37` 引入的同一个权限判定）。

### 3. 交互要点

- **单轮内的受限工具循环**：一次 `createTurn` 调用内最多执行 3 次工具调用（硬顶，防失控），每次工具调用落一条 `kind='tool_note'` 消息作为透明日志（复用现有的 `tool_note` 渲染分支），`drive_search` 的原始结果本身不落库（只是模型下一步推理的输入），只有模型决定 `send_file_card` 时才真正落一条用户可见的 `file_card` 消息。
- **澄清位——不做旁路状态字段，从消息流位置推导**（这是分叉问题的推荐答案，见下）：Cuu 判断信息不够时，不调用 `create_work_item`，而是发一条 `kind='clarifying_question'` 消息。下一轮 `createTurn` 建 prompt 时检测「历史最后一条消息是 cuu 发的 `clarifying_question`，且这一轮的触发消息就是它的下一条」——满足则在 system prompt 里显式告知模型「这是你上次提问的回答，信息足够就调用 create_work_item」。不新增任何 `pending_intake_state` 列，状态 100% 从 `conversation_messages` 的顺序读出，与「turns 本来就无状态、每次从 DB 重建」的既有架构一致（前置发现 #2）。
- **@Cuu 检测**：由于 mention 是纯文本插入，建议把 Cuu 作为一个 sentinel 成员塞进 `mentionMembers` 列表（`view.ts:232-234`），让用户在 UI 里能用同一套 `@` 交互点出「@Cuu」，但落库后仍是纯文本 `"@Cuu "` 前缀——服务端检测该消息文本是否包含 Cuu 显示名（默认 `"Cuu"`，大小写不敏感，需求词边界），这是必回判定的最高优先级信号（回话判定见批 G1 一节，4c 只负责工具环本身）。

### 4. 踩雷

- **`buildTurnSystemPrompt()` 现有边界语言与新能力直接冲突**：`packages/agent/src/turns/prompt.ts:69-70` 明确写着「这一轮只是对话，不代表你已经拿到执行权限……不要在回复里声称自己已经修改了文件、发起了任务」。4c 必须重写这段——精确开放「只读检索 / 发文件卡 / 建工单」三件事，同时保留「不能改文件内容、不能合并、不能审批」的红线，不能整段删掉。
- **流处理完全没有 `tool_use` 支持**：`extractDeltaText`/`extractFinalText`（`conversation-turns.ts:223-243`）只认 `text_delta`/`type==="text"` 的内容块。要支持工具调用，需要仿 `packages/agent/src/loop/loop.ts` 里已经写好的 `tool_use`/`tool_result` 配对与截断保护（`loop.ts:415-474` 的 `dropDanglingToolUse`），否则半截 `tool_use` 会让下一次 provider 调用直接 400——这是本批工程量最大的一块，不是加个参数那么简单。
- **60s 超时可能不够**：`DEFAULT_TURN_TIMEOUT_MS=60_000`（`conversation-turns.ts:72`）是为单次纯文本流式回复设计的；多次工具调用 + 多轮模型推理会显著拉长单个 turn 占用时间，需要重新评估这个常量或改成按工具调用数动态计算。
- **预算软闸只在开头检查一次**：`checkTurnBudget`（`conversation-turns.ts:245-263,382-389`）目前只在 turn 开始时查一次团队用量快照。多工具调用循环意味着一次 turn 可能产生多次 LLM 计费，需要在每次工具调用前重新检查，否则预算耗尽后的调用只是记账超支，不会被拦。
- **`create_work_item` 主动突破既有红线**：`conversation-turns.ts:55-56` 的批注原话是「turn 不建 agent_run 也不建 work_item——聊天轮次造空工单是污染」。4c 是对这条设计决策的一次**有意修订**（受 N7「Cuu 自主发布任务」驱动），必须在批次汇报里显式点出这是修订而非误越界，并确保只在「明确的、经过澄清的创建意图」下才触发，不能让模型顺嘴建工单。
- **@Cuu 文本匹配是脆弱的启发式**：昵称可自定义、用户可能提到"cuu"这个词但不是想 @ 她——这条已知局限如实记录，不追求完美，只要求带词边界的匹配（不能是任意子串出现就命中）。

### 5. 验收门

- 在真实 workspace 的 collab 会话里说"帮我找一下 xx 合同"，Cuu 回复里出现一条 `file_card` 消息，`drive_item_id` 指向该用户确有权限查看的真实文件；无权限或搜不到时诚实回话，不编造文件。
- 说一句意图含糊的建任务请求 → Cuu 先发 `clarifying_question` → 用户直接回复（不需要 @）→ Cuu 真的建出一个 `work_item`（能在项目工单列表里看到）。
- 注入假 LLM client，断言：半截 `tool_use`（无匹配 `tool_result`）不会让下一次调用 400（复用/移植 `loop.ts` 的 dangling 检测单测思路）。
- 工具调用透明日志（`tool_note` 消息）在 UI 可见，用户能看到"Cuu 检索了网盘"这类中间态。
- typecheck + 新增单测（工具循环、澄清位状态推导、system prompt 边界重写不回归"不能编辑文件"既有测试）全绿。

### 6. 施工文件清单

- `packages/agent/src/turns/prompt.ts`（重写系统 prompt 边界）
- `packages/agent/src/turns/tools.ts`（新文件：工具 schema + 纯函数参数解析）
- `packages/db/src/repositories/conversations.ts`（`createCuuMessage` 输入类型改判别联合，放开 `file_card`/`tool_note`/`clarifying_question`）
- `packages/db/migrations/0048_conversation_message_kind_clarify.sql`
- `packages/contracts/src/domain/conversation.ts:14-20`（`conversationMessageKindSchema` 加值）
- `apps/api/src/services/conversation-turns.ts`（核心：工具环、预算逐次重检查、@Cuu 文本检测、澄清位推导）
- 新文件 `apps/api/src/services/drive-search-tool.ts`（只读检索窄包装，复用 `drive.ts:165,571-572` 的 ILIKE 原语 + `canViewProjectDrive`）
- `apps/desktop-webview/src/workbench/chat/view.ts` / `render.ts`（渲染 `clarifying_question` 消息样式；`mentionMembers` 加 Cuu sentinel）
- `apps/api/src/services/conversation-turns.test.ts`、新文件 `packages/agent/src/turns/tools.test.ts`

---

## 二、批 P1.5 · 右栏变动文件区

### 1. 数据模型

**现有表盘点**：
- `proposals.diffManifest`（`packages/db/src/schema/core.ts:1297`）已存 `DeliverableChangeManifest.changes[]`，每条含 `target_ref.path`、`change_type`、`human_summary`（`packages/contracts/src/experience.ts:192-234,245-281`）——文件级信息本就在。
- **adds/dels 目前只有单次聚合，没有持久化，没有 per-file**：`apps/api/src/services/deliverable-diff-stats.ts` 全文件是唯一的计算逻辑——`estimateDeliverableDiffStats({workdir, manifest})` 现读 sandbox workdir 里的「改动前/改动后」两份全量文件直接比行（`MAX_CHANGES_DIFFED=20` 条上限，`deliverable-diff-stats.ts:17`），返回**一个** `{adds, dels}` 总数。唯一调用点在 `apps/api/src/workers/agent-runner.ts:1379-1394` 的 `postDeliverableSystemMessage`，只在 `proposal_opened`/`proposal_auto_merged` 那一刻算一次，塞进一条 `system_event` 消息的 `content_json`（`{event, proposal_id, run_id, title, adds, dels}`），此后不重算、不落表。
- **关键坑（详见踩雷）**：`workdir` 是 ephemeral sandbox 路径，run 结束后大概率被清理；右栏面板是"随时点开随时看"的常驻 UI，不能在渲染时依赖 `estimateDeliverableDiffStats` 现读 workdir。
- `GET /conversations/:id/army` 的 `listOutputLinksForConversation`（`packages/db/src/repositories/conversation-runs.ts:391-410`）**已经** `innerJoin(proposals, ...)`，只是 select 列表（397-405）只挑了 `title/status/updatedAt`，没把 `diffManifest`/新列一起选出——这是最小可扩展点，不需要新 join。

**缺什么迁移**：
- `proposals` 新增列 `diff_stats_json jsonb`（nullable，历史行/未跑过统计的允许为 null，前端按"不可用"渲染而不是冒充 0）。形状：`{ total: {adds, dels}, files: [{change_id, path, change_type, adds?, dels?}] }`。
- 草稿：`packages/db/migrations/0048_proposal_diff_stats.sql`（单纯 `ADD COLUMN`，无需 `NOT VALID/VALIDATE` 两段式，因为是可空列不是约束）。

### 2. 端点契约草案

- 扩展 `armyOutputLinkVmSchema`（`packages/contracts/src/pages.ts:1518-1529`）新增可选字段 `changed_files: z.array(armyChangedFileVmSchema).max(20).optional()`；新增 `armyChangedFileVmSchema = {path, change_type, adds: number.optional(), dels: number.optional()}`（`adds/dels` 缺省即"这条改动没能计入统计"，不是 0）。
- `listOutputLinksForConversation` 的 select（`conversation-runs.ts:397-405`）加一列 `diffStatsJson: proposals.diffStatsJson`；`apps/api/src/services/conversation-army.ts` 的 VM 映射层把它转成 `changed_files`。
- 不新开路由——仍是既有的 `GET /conversations/:id/army`，additive 字段，旧客户端忽略新字段即可向后兼容。

### 3. 交互要点

- 右栏新增第 4 区"变动文件"，与军团区并列，插入顺序：`renderArmyPanelListHtml`（`apps/desktop-webview/src/workbench/army/render.ts:224-239`）里 `outputsHtml → **changedFilesHtml（新）** → runsHtml → backgroundHtml`——紧跟输出区之后，因为文件正是输出区里各个提议产出的具体物。
- 聚合当前会话所有 `outputs[].changed_files`，按 `path` 去重（同一文件被多个提议改过时取最新一条），每行：文件名 + 图标（按 `change_type` 挑，复用 `workbenchIcons.file`）、change_type 徽标人话化（新建/更新/删除/重命名/移动/替换/生成）、`+N -M`（缺失时显示"改动详情不可用"而非 0/0）；点击展开复用现有输出区 `<details>` 折叠模式（`render.ts:157-167`），不新开深链（04 铁律#3：没接线不能装能点）。
- 与网盘侧栏"最近文件"的边界：这里只展示已经进入提议的 AI 产出改动，不是网盘全量最近文件列表。

### 4. 踩雷

- **workdir ephemeral，绝不能读时重算**：必须在 `estimateDeliverableDiffStats` 已经在算聚合数字的同一处（`agent-runner.ts:1379-1394`，workdir 此时仍存活）顺手算出 per-file 明细并写入 `proposals.diff_stats_json`，而不是等右栏被打开时才去读一个大概率已经不存在的目录。
- **现有 `MAX_CHANGES_DIFFED=20`/`MAX_DIFF_CHARS=500_000` 上限必须原样搬进持久化路径**，否则大 manifest 在这个新增的持久化点上重犯"发无上限重活"（04 铁律#4）。
- **`armyOutputLinkVmSchema` 当前是 `.strict()`**——新增字段必须走 `optional()`，且要同步补 `packages/contracts/src/r12-workbench.test.ts` 等既有契约测试的 fixture，否则严格模式会直接拒绝新字段导致既有测试炸。
- **老 proposal 没有回填**：`diff_stats_json` 为 null 的历史输出，右栏统一展示"改动详情不可用（该产出早于统计功能上线）"，不写一次性回填脚本——回填需要读早已被清理的 workdir，本来就做不到，诚实标注比强行拟合更省事也更可信。
- **两条计算路径可能对不上**：产出卡系统消息里的 `{adds,dels}`聚合数字（`agent-runner.ts:1392-1393`）和右栏新的 per-file 明细求和理论上必须一致（都来自同一次 `estimateDeliverableDiffStats` 调用改造出的两个返回值），验收时要交叉核对，防止两条路径各自算出不同数字。

### 5. 验收门

- 一次新 run 走完 `run→proposal_opened` 全程后，右栏"变动文件"区出现该 proposal 的逐文件列表，行数 = `changes.length`（或被 `MAX_CHANGES_DIFFED` 截断时有"更多改动未逐条统计"提示），adds/dels 明细求和与既有产出卡系统消息里的聚合数字一致。
- 覆盖三种边界的渲染单测：`changed_files` 整体缺失（老 proposal）/ 部分文件缺 adds-dels / 超过 20 条截断。
- typecheck + 桌面测试 + contracts 契约测试全绿。

### 6. 施工文件清单

- `packages/db/src/schema/core.ts`（`proposals` 加 `diffStatsJson` 列）
- `packages/db/migrations/0048_proposal_diff_stats.sql`
- `apps/api/src/services/deliverable-diff-stats.ts`（改造为同时返回 per-file 明细，不只是聚合总数）
- `apps/api/src/workers/agent-runner.ts:1379-1394`（顺手把 per-file 明细写回 `proposals.diff_stats_json`）
- `packages/db/src/repositories/proposals.ts`（如需要，新增一个更新 diff_stats 的方法）
- `packages/db/src/repositories/conversation-runs.ts:397-405`（`listOutputLinksForConversation` select 扩展）
- `apps/api/src/services/conversation-army.ts`（VM 映射）
- `packages/contracts/src/pages.ts:1518-1529`（`armyOutputLinkVmSchema` 扩展 + 新 `armyChangedFileVmSchema`）
- `apps/desktop-webview/src/workbench/army/render.ts:150-174,224-239`（新渲染函数 + 拼接顺序）
- `apps/desktop-webview/src/workbench/army/render.test.ts`（新用例）
- `packages/contracts/src/r12-workbench.test.ts` 及相关 fixture（更新契约测试）

---

## 三、批 C1 · 会话上下文压缩

### 1. 数据模型

**现有表盘点/现状**：
- `apps/api/src/services/conversation-turns.ts:70,357-358`：`DEFAULT_HISTORY_WINDOW=50`，每轮 `createTurn` 都是纯计数滑窗（`afterSeq = max(0, nextSeq-1-windowSize)`）。**没有 token 估算、没有摘要、没有压缩事件、没有任何"较早内容已丢失"的用户提示**——这是纯静默截断，不是压缩。
- **仓库里已经有一套压缩机制，但服务的是另一个场景**：`packages/agent/src/loop/loop.ts` 的 `compactConversation()`（`loop.ts:476-498`）用于 agent-run（worker 执行任务）场景——触发阈值 `contextWindowTokens * compactThreshold`（默认 `0.8`，`loop.ts:758`）基于**真实累计 token 用量**（`usage.totalTokens`，由 provider 返回的用量逐步累加，`loop.ts:741,756-758`）；摘要策略是**本地确定性摘要**（`summarizeStepsForCompaction`，机械列出 step/工具调用记录，**不调用 LLM**，`loop.ts` 中该函数）；保留最后 `keepTailEntries`（默认 6）条消息且对齐到 assistant 边界 + `dropDanglingToolUse` 防悬空（`loop.ts:451-474,482-489`）；`maxCompactions` 硬顶（默认 2 次，用尽即失败而非无限压缩，`loop.ts:751,792,974`）；触发时发 `eventTypes.agentRunCompacting`（`"agent_run.compacting"`，`packages/contracts/src/enums.ts:169`）事件，带用户可见文案"上下文已压缩（第 N 次，触发=xxx）"（`loop.ts:768`）。
- **为什么不能直接照搬 loop.ts 的方案给 turns**：agent-run 的历史是结构化的工具调用步骤，机械罗列"跑了什么工具"就是一份够用的摘要；conversation turn 的历史是自然语言对话，决策/偏好/共识这类语义信息机械罗列不够，需要真正的抽象摘要——这正是 codex 参考模型更贴合的地方。
- **codex（`reference/openai-codex/codex-rs`）参考**：触发阈值 = 模型 `context_window` 的 **90%**（`auto_compact_token_limit()` 默认取 `context_window * 9/10`，`protocol/src/openai_models.rs:452-459`；`effective_context_window_percent` 默认 95%，同文件 348-350）。摘要策略：向模型自身发一条固定 prompt（`SUMMARIZATION_PROMPT`，`prompts/templates/compact/prompt.md`：要求产出"当前进度和关键决策 / 重要上下文-约束-用户偏好 / 待办事项 / 续接所需的关键数据"四段式 handoff），模型的回答本身就是摘要文本。重建历史 = `[被保留的 initial_context]` + `[从尾部按 token 预算（20000 tokens，`COMPACT_USER_MESSAGE_MAX_TOKENS`，`core/src/compact.rs:53`）回选的最近若干条原始用户消息]` + `[摘要文本作为最后一条 user 消息，前面加 SUMMARY_PREFIX 说明"这是另一个模型产出的摘要"]`（`core/src/compact.rs:585-659`，`prompts/templates/compact/summary_prefix.md`）。压缩次数/窗口 id 用 `AutoCompactWindow` 结构追踪（`core/src/state/auto_compact_window.rs`），但这是**进程内内存态**——不适用于 WorkHub turn 无状态、每次从 DB 重建的架构（前置发现 #2）。

**缺什么迁移**：
- `project_conversations` 增加两列：`context_summary_md text`（滚动摘要正文，null=从未压缩过）、`context_summary_through_seq bigint not null default 0`（摘要覆盖到哪个 seq）。
- 草稿：`packages/db/migrations/0048_conversation_context_summary.sql`。

### 2. 端点契约草案

不新增端点。`createTurn`（`conversation-turns.ts:313` 起）在拉取历史窗口之前先判断是否需要刷新摘要：

- 触发条件：`nextSeq - 1 - windowSize（新窗口起点）> context_summary_through_seq + REFRESH_BATCH`（建议 `REFRESH_BATCH=20`，攒够一批阈值再刷新一次，不是每轮都摘要，避免每条消息都触发一次额外 LLM 调用）。
- 触发后：① 取出 `[context_summary_through_seq, 新窗口起点)` 区间内这次新滑出窗口的原始消息；② 调一次 LLM（复用 `ProviderRegistry`，taskClass 建议新增 `"context_compact"`，需要在 `packages/agent/src/providers/types.ts:4-14` 的 `taskClasses` 数组里落地）用中文化的三段式摘要 prompt（当前进度/关键决策与偏好/待办事项），输入 = 旧 `context_summary_md`（若有）+ 这批新滑出的消息，输出 = 更新后的滚动摘要；③ 落库：更新 `project_conversations.context_summary_md/context_summary_through_seq`，并插入一条 `conversation_messages`（`kind='system_event'`，`sender_type='system'`，`content={event:'context_compacted', compacted_message_count, summary_excerpt}`）——复用现有 `system_event` 渲染分支，用户能在滚动列表里看到"已压缩 N 条历史消息"。
- `buildTurnSystemPrompt`/`buildTurnMessages`（`packages/agent/src/turns/prompt.ts`）新增一段：若 `context_summary_md` 非空，作为独立 prompt 分段插在 `memorySection` 之前，标注"这是本会话更早内容的摘要，供你了解背景"。

### 3. 交互要点

- 触发压缩共享同一次用户发起的 HTTP 往返（多一次内部 LLM 调用会让这一轮明显变慢）——需要有一个用户可见的过渡态（如"Cuu 正在整理更早的讨论…"），不能让这一轮无解释地变慢。
- "已压缩 N 条"系统消息直接复用现有 `system_event` 渲染路径，无需新 UI 组件；若要展示摘要全文，可参照军团面板输出区的 `<details>` 折叠模式（P1.5 一节同款做法）。
- 压缩是**滚动/增量**的（每次只吃掉新滑出窗口的那一批，不是从头整段重新摘要），单次 LLM 调用输入长度有界，不随会话总长度线性增长。

### 4. 踩雷（含关键的问题重新框定）

- **这不是 codex 意义上的"超限崩溃"问题**：WorkHub 的历史窗口本来就是硬截断的 50 条，从不会真的撑爆 context window。真正的问题是"超出 50 条之外的内容被静默永久遗忘，且用户毫无感知"——如果只是简单在滑窗前面加一句摘要而不解决"什么时候刷新/覆盖到哪"，并不会真的让 Cuu 看见更早内容之外的任何新东西。压缩方案必须冲着**保留可感知的连续性**设计，而不是照搬 codex 的"防止 400 报错"目标——这是理解本批的第一前提。
- **触发点用消息条数而非严格 token 计数**：仓库里目前没有任何面向"自然语言会话历史"的 token 估算工具（`loop.ts` 里的机制服务于完全不同的数据形状——工具调用步骤）。本设计建议先用消息数做 MVP（`REFRESH_BATCH=20`），token 版本作为后续加固项，不在本批打包，如实标注这个简化。
- **摘要调用本身要过预算闸/记账**：额外的 LLM 调用同样要走 `checkTurnBudget` 软闸（`conversation-turns.ts:245-263`）和 `cost_ledger_entries` 记账，否则压缩变成账外开销；新增的 `"context_compact"` taskClass 会影响 provider-registry 的路由与用量归因，需要显式加进 `taskClasses` 列表。
- **并发天然安全**：同会话的多个 turn 已经被 `activeTurns` 会话级忙碌闸互斥（`conversation-turns.ts:304-325`），压缩不会有并发竞态，不需要额外加锁。
- **摘要失败必须 fail-open**：摘要 LLM 调用失败不能挡住这一轮真正的用户对话——退回"这次先不压缩，沿用旧摘要（或没有摘要）"，下次再试，绝不能让摘要失败变成整个 turn 500。

### 5. 验收门

- 构造一个 70+ 条消息的协同会话，验证窗口起点越过阈值时触发一次压缩：`context_summary_md` 非空、`conversation_messages` 出现一条 `system_event(context_compacted)`、后续 turn 的 system prompt 里能看到摘要内容（注入假 LLM client 断言 system 参数包含摘要文本）。
- 压缩失败（假 LLM 抛错）不影响当轮 turn 正常返回真实回复。
- typecheck + 新增单测（压缩触发阈值、摘要落库、失败降级三种路径）全绿。

### 6. 施工文件清单

- `packages/db/src/schema/core.ts`（`project_conversations` 加两列）
- `packages/db/migrations/0048_conversation_context_summary.sql`
- `packages/db/src/repositories/conversations.ts`（新增 `updateContextSummary` 方法；`findVisibleAccessRecord` 返回值带出摘要字段）
- `packages/agent/src/turns/prompt.ts`（新增摘要 prompt 构造函数 + system prompt 拼接摘要段）
- `packages/agent/src/providers/types.ts:4-14`（`taskClasses` 加 `"context_compact"`）
- `apps/api/src/services/conversation-turns.ts`（压缩触发判定与落库主逻辑）
- `apps/api/src/services/conversation-turns.test.ts`、`packages/agent/src/turns/prompt.test.ts`（新用例）

---

## 四、批 A2 · 派人推荐 v2

### 1. 数据模型

**现有表盘点（含最重要的一条发现）**：
- **`user_profiles` 表（`packages/db/src/schema/core.ts:264-279`：`bioMd/skillsText/skillTags/availabilityPref/onboardedAt`）是一张纯 schema 层面的死表**——全仓库检索 `apps/api/src`、`packages/db/src/repositories` 对 `userProfiles` 零引用：没有 repository、没有 service、没有路由、没有任何 UI。这比"缺 title 字段"严重得多：整个"个人资料"功能从未真正建成过，A2 的工作量要按"新建一个功能"估，不是"扩展一个已有功能"。
- `bioMd` 已经承担"个人介绍"的角色，不需要新增；确实缺的是 `title`（职位/角色头衔）。
- **历史交付信号需要两次 join**：`accepted_deliverable_changes` 表（`schema/core.ts:1334-1383`）记录逐文件级采纳，**没有 assignee 列**；需要经 `workItemId` → `work_item_assignments`（`schema/core.ts:937-953`，`role in ('lead','collaborator')`，角色枚举定义在 `packages/permissions/src/assignments.ts:3`）取 `role='lead'` 的 `userId` 作为该工单交付的归属人。
- **当前"派活"完全没有资料/历史信号参与**：`packages/agent/src/observer/prompt.ts` 的 `buildObserverUserPrompt`（61-81 行）只把讨论文本喂给模型，`suggested_assignee_nickname`（`observer/schema.ts:15,23`）纯粹是模型从聊天文本里"猜"到的一个名字；`resolveAssignee`（`apps/api/src/workers/conversation-observer.ts:263-282`）先按 LLM 猜的昵称查真实用户，查不到就退化成"项目负责人"兜底——没有任何候选人名单或评分传给模型，是纯裸奔状态。

**缺什么迁移**：
- `packages/db/migrations/0048_user_profiles_title.sql`：`user_profiles` 加 `title varchar(128)`。
- **不新增统计表**：交付质量/数量是可从 `accepted_deliverable_changes` + `work_item_assignments` 实时聚合的派生数据，另开一张统计表会引入"和源表不一致"的二次数据风险，改为一条按需聚合的查询函数（见下）。

### 2. 端点契约草案

- 新文件 `packages/db/src/repositories/user-profiles.ts`（此前不存在）：`findByUserId`、`upsert`、`listCandidatesForProject(projectId)`（返回该项目/工作区全体 active 成员的 `{userId, nickname, title, bioMd, skillTags, acceptedDeliverableCount, lastAcceptedAt}`，聚合查询 join `accepted_deliverable_changes` + `work_item_assignments` + `workspace_memberships`，按 04 铁律#4 加 limit）。
- 新文件 `packages/contracts/src/domain/user-profile.ts`：`userProfileVmSchema{user_id, nickname, title, bio_md, skill_tags, onboarded_at}`；`patchUserProfileRequestSchema{title?, bio_md?, skill_tags?}`。
- 新端点 `GET/PATCH /me/profile`（独立于既有 `PATCH /me/ai-profile`——那是"AI 行为策略"，这个是"我是谁"，语义不同，不该混进一张表/一个端点）。
- 新文件 `packages/agent/src/observer/assignee-scoring.ts`：纯函数 `scoreCandidate({hasProfile, hasTitle, acceptedDeliverableCount, daysSinceLastAccepted, skillTagOverlapWithTask}): number`——资料完整度 + 历史交付量（对数尺度，防止头部人选垄断） + 近期性（衰减） + 技能标签与任务文本的朴素重合度，纯函数，方便单测穷举边界。
- 观察者升级消费点：`buildObserverUserPrompt`（`observer/prompt.ts:61-81`）新增可选入参 `candidateRoster: {nickname, title, topSkills, score}[]`（按 score 降序取 top 5-8，遵守 04 铁律#4），拼进 prompt 作为候选人名单参考；`resolveAssignee`（`conversation-observer.ts:263-282`）改造：**LLM 明确点名且命中真实用户→原样采用（不降级）；LLM 没给出名字或给出的名字查无此人→退化到名单里分数最高者；名单也是空→维持现有"项目负责人"兜底**。

### 3. 交互要点

- 注册/设置页补填资料：web `/settings`（或桌面 Spotlight 设置视图，批 P3 已规划落点）新增"我的资料"分区——`title` 输入框 + `bioMd` 多行文本 + `skill_tags` 标签输入；已有的 `/onboarding` 路由（团队技能路由页迭代记录提过"settings→onboarding flake"，说明这条路由确实存在）里加一步引导，非强制，附"以后 Cuu 派活会参考这些信息"的说明文案。
- 评分结果不神秘化：观察者采用了分数最高候选人（而非 LLM 直接点名）时，行动卡追加一句"根据资料与历史交付选中"，避免用户觉得"AI 凭空点了我的名"。

### 4. 踩雷

- **`user_profiles` 零接线是最大风险点**——工作量按新功能估，不能低估成"加个字段"。
- **历史交付归因存在产品歧义**：`work_item_assignments` 允许一个 `lead` + 多个 `collaborator`，"历史交付质量/数量"算给谁？本设计建议**只算给 `lead`**（职责最主体的人），`collaborator` 暂不计分，避免过度设计——这是可以直接采纳的默认值，不算待拍板项。
- **不能破坏现有"点名优先"语义**：用户在聊天里明确点名张三，必须还是张三，算法分数只在"没点名/点名查无此人"时介入，否则会出现"我明明说了让张三做，AI 却派给分数最高的李四"这种违反直觉的回归——补单测钉死这条优先级。
- **评分不应架空公平性（待拍板，见文末汇总）**：若评分最高者无条件胜出会导致"万年高分者躺赢所有新任务，新人永远分不到活"，建议派活候选排序里加一个轮转/惩罚因子，但具体权重是产品判断，本设计不擅自替用户定死。

### 5. 验收门

- 新用户在设置页填 `title+bio` 后，`GET /me/profile` 能读到刚填的值；观察者下一次派活候选名单里出现这个人的 `title`（注入假 `candidateRoster` 断言 prompt 文本包含它）。
- 有 5 次 accepted deliverable 记录的老成员，评分函数对其历史交付分量 > 零资料新用户，单测直接断言 `scoreCandidate` 排序结果。
- LLM 明确点名的候选人即便分数不是最高也被优先采纳（既有语义不回归）——补单测覆盖。
- typecheck + 新单测（scoring 纯函数穷举 + `resolveAssignee` 优先级）全绿。

### 6. 施工文件清单

- `packages/db/src/schema/core.ts`（`userProfiles` 加 `title` 列）
- `packages/db/migrations/0048_user_profiles_title.sql`
- `packages/db/src/repositories/user-profiles.ts`（新文件）
- `packages/contracts/src/domain/user-profile.ts`（新文件）
- `apps/api/src/routes/user-profile.ts` + `apps/api/src/services/user-profile.ts`（新端点）
- `packages/agent/src/observer/assignee-scoring.ts`（新文件 + 单测）
- `packages/agent/src/observer/prompt.ts`（`buildObserverUserPrompt` 加 `candidateRoster` 入参）
- `apps/api/src/workers/conversation-observer.ts:263-282`（`resolveAssignee` 消费评分排序候选名单）
- `apps/web/src/`（`/settings` 或 `/onboarding` 补"我的资料"表单，具体既有路由组件需施工时现场定位）
- `apps/desktop-webview/src/spotlight/`（桌面设置视图同款分区，落点见批 P3 已规划的"AI 分区"旁边）

---

## 五、批 S3 · 个人空间

### 1. 数据模型（方案对比与推荐）

**方案 B（`kind='personal'`，会话完全脱离项目）的成本**：`project_conversations.projectId` 是 `NOT NULL` 外键（`packages/db/src/schema/core.ts:389-455`），深度嵌入至少 5 组复合唯一约束/deferred FK（`project_conversations_id_project_uq`、`project_conversations_id_project_workspace_uq`、`project_conversations_parent_project_fk` 等）；`createCollab` 建群事务强制要求 `lockActiveProject` 查到一个有效项目（`packages/db/src/repositories/conversations.ts:578-609`）。把会话和项目解耦需要把 `projectId` 改 nullable 并重写这一整组约束，牵连现有鉴权代码路径（`findVisibleAccessRecord` 等），风险和工作量都显著偏高。

**方案 A（个人空间 = 特殊 `projects` 行）的成本极低**：`projects.workspaceId` 本就允许为 null（`schema/core.ts:285`），`ownerUserId` 已存在（290 行）——只需加一个 `is_personal boolean` 列，个人空间 = `owner_user_id=该用户、is_personal=true` 的一条 `projects` 行，其余（`createCollab`/`findVisibleAccessRecord`/turns/军团面板等）**全部零改动直接复用**。

**推荐：方案 A 的变体**——不是"一人一个个人项目"，而是"个人空间 = 任意数量 `is_personal=true` 且 `owner_user_id=自己` 的项目"，天然支持需求里"个人 AI 工作台（多个）"（如"周报""读论文""私人待办"各开一个）。个人项目下的 `main` 会话就是该个人空间的默认 1:1 Cuu 线程，还可以在其下开更多 `collab` 子会话，但不需要"拉其他真人成员"这层语义——UI 层不提供邀请入口即可，不需要数据库层面强制。

**缺什么迁移**：
- `packages/db/migrations/0048_projects_is_personal.sql`：`ALTER TABLE projects ADD COLUMN is_personal boolean not null default false`；配一条部分索引 `projects_personal_owner_idx on (owner_user_id) where is_personal`（列个人空间列表用）。
- `project_conversations` 无需任何改动。

### 2. 端点契约草案

- 新端点 `POST /me/personal-projects`：内部调用既有 bootstrap 项目的逻辑（`packages/db/src/repositories/projects.ts` 的 bootstrap 路径），但 `is_personal=true`、`workspace_id=`用户当前活跃工作区，跳过团队项目该有的成员邀请/治理设置步骤。
- 新端点 `GET /me/personal-projects`：`listForWorkspace`（`projects.ts:103-127`）的变体，条件改为 `eq(projects.ownerUserId, userId) and eq(projects.isPersonal, true)`。
- **唯一必须触碰的现有查询**：`listForWorkspace`（`projects.ts:103-127`，团队项目列表）要加 `and(eq(projects.isPersonal, false))` 过滤，否则个人空间会混进团队项目列表。

### 3. 交互要点

- rail 顶部新增"我的空间"分组，与项目树平级但视觉区分（无团队成员头像、无"军团总览"跨项目入口）；创建入口"+ 新建个人空间"只填名字，不需要选工作区/邀请成员。
- 与聚焦盒/Cuu 的关系：个人空间的默认 `main` 会话就是"1:1 Cuu"语境；聚焦盒（批 S1）在个人空间语境下的意图路由可以更宽松，但工单创建/交付合并仍走既有提议/审批线，只是"审批人"就是用户自己。
- 与团队项目的边界：个人空间的工单/网盘/提议天然只有 owner 一人可见（沿用现有 `project→workspaceMembership` 鉴权链路，个人项目的"团队"事实上只有一人），不需要新写权限代码。

### 4. 踩雷

- **多工作区归属问题（待拍板，见文末汇总）**：多工作区用户的个人空间挂在哪个工作区？本设计建议挂在用户当前活跃/默认工作区，多工作区各自可以有该用户的一批个人空间（不做跨工作区统一视图），保持与现有 `workspaceMemberships` 隔离模型一致。
- **个人项目会被 60s 主区观察者扫到（待拍板，见文末汇总）**：`main` 会话不区分是否个人，个人空间的私人闲聊被拆成行动卡是否合适？建议给 `is_personal` 项目的 `project_ai_governance` 不同默认档（更长 `silence_window` 或干脆默认关闭观察者，改用 4c 的回话判定语义）——这是需要用户拍板的产品分叉点。
- **不止一处"团队级列表"需要过滤**：本设计只定位了 `projects.ts:103-127` 这一处最核心的，施工时需要 grep 全部消费 `projects` 表的团队级聚合查询（成本页 `by_task_plan`、网盘页项目选择器等）逐一确认是否需要加 `is_personal=false` 过滤。

### 5. 验收门

- 新建个人空间后不出现在团队项目列表/项目下拉选择器里，只出现在"我的空间"分组；该空间的 `main` 会话可以正常对话（复用现有 turns 全链路，零新代码验证）。
- 另一个团队成员（含同工作区 admin）访问别人的个人空间返回 404（与 `conversationArmyNotFound` 同款 fail-closed 语义）。
- typecheck + 新增契约/仓库测试（`is_personal` 过滤、owner-only 鉴权）全绿。

### 6. 施工文件清单

- `packages/db/src/schema/core.ts`（`projects` 加 `isPersonal` 列 + 索引）
- `packages/db/migrations/0048_projects_is_personal.sql`
- `packages/db/src/repositories/projects.ts:103-127`（`listForWorkspace` 加过滤 + 新增 `listPersonalForUser`）
- `apps/api/src/routes/projects.ts` / `apps/api/src/services/projects.ts`（新端点）
- `apps/desktop-webview/src/workbench/rail.ts` / `product-shell.ts`（"我的空间"分组渲染 + 创建入口）
- `packages/contracts/src/domain/project.ts` 或等价位置（project VM 加 `is_personal` 字段供前端判定分组归属）

---

## 六、批 G1 · 小群

### 1. 数据模型

**现有表盘点（核心结论：地基已经 100% 具备）**：
- `project_conversations.kind` 早已支持 `'collab'`（check 见 `schema/core.ts:414`），`conversation_participants`（457-473 行）本就支持任意数量参与者——`createCollab` 的 `assertCollabInput` 已允许最多 99 人（`repositories/conversations.ts:239-247`）。"建群"这件事在数据/服务层其实已经具备，不需要任何新概念。
- **真正的接线缺口在前端**：`createCollabConversation`（`apps/desktop-webview/src/workbench/rail.ts:77-86`）当前硬编码只传 `title`，从不传 `participant_user_ids`——而服务端请求 schema `createConversationRequestSchema`（`packages/contracts/src/domain/conversation.ts:357-366`）早就有 `participant_user_ids: z.array(idSchema).max(99).default([])` 字段。这是最小接线缺口，不是新功能。
- **观察者已经天然排除 collab**：`listObserverCandidates`（`packages/db/src/repositories/action-cards.ts:114-156`）的 WHERE 子句硬编码 `eq(projectConversations.kind, "main")`（142 行）——collab 类型（含未来的多人小群）在这条查询里已经被排除，这是**已经存在的守卫点**，不需要新代码。
- **缺失的唯一新概念**：`cuu_enabled` 布尔（是否让 Cuu 参与这个会话）——当前 `project_conversations` 无此列，Cuu 是否说话完全由 4c 的回话判定控制，但没有会话级"一键静音"顶层开关。

**缺什么迁移**：
- `packages/db/migrations/0048_conversation_cuu_enabled.sql`：`project_conversations` 加 `cuu_enabled boolean not null default true`。

### 2. 端点契约草案

- `createConversationRequestSchema`（`domain/conversation.ts:357-366`）增加可选字段 `cuu_enabled: z.boolean().default(true)`；`conversationVmSchema`（409-425 行）增加 `cuu_enabled: z.boolean()` 输出字段。
- `createCollab`（`repositories/conversations.ts:578` 起）建群事务把 `cuu_enabled` 一并写入插入语句。
- `createTurn` 的 access 判定段（`conversation-turns.ts:328-342` 附近）：若 `access.conversation.cuu_enabled === false`，直接 409（新错误码 `conversation_turn_cuu_disabled`），优先级高于 mode/回话判定——`cuu_enabled=false` 是最高优先级的静音开关。

### 3. 交互要点

- 建群 UI 长在 P2 已经真实存在的"+ 新建协同会话"入口上（`rail.ts:359-386` 附近的 `mountWorkbenchRail` 点击处理）——把当前"只填标题"的极简模态升级为：标题 + 成员多选（列出当前项目 `workspace_members`）+ Cuu 开关（默认开）；提交时把选中的 `userIds` 塞进 `participant_user_ids`、开关值塞进 `cuu_enabled`。
- **回话判定接线复用 4c**：group（participants>1）与 1:1（participants=1）复用同一个判定函数，1:1 时判定器直接短路成"必回"（"单聊=必回特例"是判定器的一个输入维度，不是另一套逻辑）。
- **observer 不进小群**：`listObserverCandidates` 已经硬编码 `kind='main'`（前置发现），不需要新代码，只需要补一条回归测试钉死这个事实。

### 4. 踩雷

- **`cuu_enabled=false` 和"回话判定说不该回"是两种不同的静默，不能共用一个信号**：前者是用户显式一键关闭，后者是 AI 自己判断这波不该插嘴。如果混用，用户手动关掉的群换个话题模式后 AI 又开始说话，开关会显得不可靠。
- **限频合并判定**（00-plan.md §6 原话）：群规模变大后（如 20+ 人的项目群），若每条新消息都触发一次判定（哪怕是便宜档），高频发言场景可能造成判定调用风暴——需要限频：同一会话在 N 秒窗口内的多条连续消息只触发一次判定（取最后一条为判定对象）。
- **角色管理不在本批范围**：`conversation_participants.role`（`'owner'|'member'`）现有语义是为 1:1 协同会话设计的（owner=发起人）；群聊场景的"踢人/转让群主"不做，本批只做"建群时一次性选好成员"，成员变更需要在验收门/施工清单里显式排除，防止范围蔓延。
- **多人昵称解析不是风险点**：`buildHistory` 的 `senderLabel` 解析（`conversation-turns.ts:391-392`）本来就是按 `senderUserId` 查昵称，这条链路对多人群聊天然成立，不需要额外改造——可以直接在验收门验证而非列为风险。

### 5. 验收门

- 在"+ 新建协同会话"模态里选 3 个成员建群，`conversation_participants` 出现 4 行（创建者 + 3 人），会话详情能读到 `cuu_enabled` 字段。
- 把 `cuu_enabled` 关掉后，即便有人 @Cuu，`POST /conversations/:id/turns` 也返回 409 `conversation_turn_cuu_disabled`，不产生任何 Cuu 回复。
- 群里连续发 5 条无人 @Cuu 的消息，验证 4c 判定器只被调用一次（限频）；同时用回归测试断言 60s 观察者的候选扫描 SQL 不会选中这个 collab 会话（钉死现有 `kind='main'` 过滤）。
- typecheck + 新增单测（`cuu_enabled` 网关、限频合并、observer 排除 collab 的回归测试）全绿。

### 6. 施工文件清单

- `packages/db/src/schema/core.ts`（`project_conversations` 加 `cuuEnabled` 列）
- `packages/db/migrations/0048_conversation_cuu_enabled.sql`
- `packages/contracts/src/domain/conversation.ts:357-366,409-425`（请求/VM schema 加字段）
- `packages/db/src/repositories/conversations.ts:578` 起（`createCollab` 写入 `cuu_enabled`）
- `apps/api/src/services/conversation-turns.ts:328-342` 附近（`cuu_enabled` 网关判定，新错误码）
- `apps/desktop-webview/src/workbench/rail.ts:77-107,359-386`（建群模态：成员多选 + Cuu 开关 UI）
- `packages/db/src/repositories/action-cards.ts:142-153`（补回归测试，代码本身不用改）
- 依赖：回话判定器需要 4c 先落地（或与 4c 并行协商函数接口）

---

## 七、待用户拍板的分叉清单（汇总）

1. **4c**：@Cuu 检测是文本子串匹配（脆弱启发式），是否接受这个已知局限，还是要投入更多做结构化 mention？
2. **A2**：历史交付评分是否需要"轮转/惩罚因子"防止头部人选垄断所有新任务？具体权重本设计未定死。
3. **S3**：个人空间是否要默认关闭/放宽 60s 主区观察者（私人闲聊被拆成行动卡是否合适）？
4. **S3**：多工作区用户的个人空间是否需要跨工作区统一视图，还是各工作区分别拥有？
5. **G1**：`cuu_enabled` 关闭后是否需要保留"临时提及也不回"的强静默语义确认（已在设计里定为最高优先级，需用户确认这是期望行为而非可被回话判定绕过）。

---

## 自查记录

- 六节引用的 file:line 均在写作时逐一 Read 验证（`conversation-turns.ts`、`conversations.ts`、`experience.ts`、`pages.ts`、`core.ts`、`loop.ts`、`observer/*.ts`、`action-cards.ts`、`rail.ts`、`view.ts`、`deliverable-diff-stats.ts`、`agent-runner.ts`、`domain/conversation.ts`、`enums.ts`、`providers/types.ts`、`assignments.ts`、`projects.ts`、以及 `reference/openai-codex/codex-rs` 下的 `compact.rs`/`compact_token_budget.rs`/`state/auto_compact_window.rs`/`openai_models.rs`/`prompts/templates/compact/*.md`），未凭记忆杜撰路径或行号。
- 六份迁移草稿彼此独立、字段不重叠，编号冲突仅是记账问题，已在文首说明处理方式。
- 未做任何代码改动；仅新增本文档一个文件。
