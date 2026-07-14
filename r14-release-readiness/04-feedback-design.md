# R14 · 批 FEEDBACK 实现级设计（AI 反馈闭环）

> 集成裁定（2026-07-14）：批准设计。迁移 0058=when 1783910000000（RISK 批 0059 顺延其后）。施工顺序：W-A feedback-server（opus）即发；W-B curation-consume 待 W-A 合入后发（类型依赖）；W-C 桌面 UI 待 APPROVE-CHAT 合入后发（chat/render.ts 占地串行）；W-D web UI 待 W-A 合入后可与 W-C 并行。

> 状态：施工设计草稿 · 2026-07-14 · 上游：00-plan.md §2 批 FEEDBACK（用户已拍板范围，见 00-plan.md:112-116）
> 侦察基础：夜间 curation 全链路（skill-curation.ts / agent-skill-curation.ts / team-skill.ts）+
> 会话消息/提议/行动卡三类主体的存储与 VM 构建链路 + 双端渲染现状（桌面 chat/render.ts、web
> route-components.ts + browser.ts）。
> 仓库 = `/Users/apple/.codex/worktrees/WorkHub/r12-workbench-full`（main，HEAD=`7a25c788`）。CHAT（0055）/
> MEM（0056）/SEARCH（0057）三批均已合入 main——本设计据此确认下一迁移号 = **0058**。
> 纪律：04 手册 13 条铁律不变；**不复用 CHAT 批 reaction 的 emoji 豁免**——反馈用字符 tile（✓/✗），
> 那道 emoji 豁免仅限 01-chat-design.md §6 的五键反应，见本文 §8。
> 本文档只读侦察 + 设计，未改仓库任何文件。

## 0. 范围裁定

照 00-plan 拍板范围：Cuu 文本回复、提议卡、行动卡上加「有用/没用」轻量反馈（字符 tile，不是 emoji）；
落 `ai_feedback` 表；夜间 curation 消费：差评样本进技能蒸馏的反例池、好评强化；成本记账沿 K5 分账；
不做打分制五星，二值 + 可选一句话备注。

**关键侦察结论（决定了本设计与 00-plan 字面表述的落地方式）：**

1. **三类反馈主体在双端的可见面完全不重叠，天然无需三端各建一套 UI**：
   - Cuu 文本回复 = `conversation_messages`（`sender_type='cuu' kind='text'`）——聊天**只在桌面**
     （R13 定调「聊天归桌面」，01-chat-design.md:23），web 不渲染消息流，故此类反馈**桌面独占**。
   - 行动卡条目 = `action_card_items`——同样只出现在桌面聊天的 `kind='action_card'` 消息里（渲染于
     `apps/desktop-webview/src/workbench/chat/render.ts:392` `renderActionCardSummaryHtml`）；桌面聊天里
     的提议深链目前是**死文本**（pm-review-2026-07-14.md §5 B1：「审批必须切 web」），故行动卡反馈同样
     **桌面独占**。
   - 提议卡 = `proposals`——审批只在 **web** 的 `/proposals/:id` 详情页发生（`apps/api/src/routes/
     pages.ts:729` 挂载、`packages/ui/src/gold-path/route-components.ts` 的
     `renderProposalRouteComponent` 渲染），桌面还看不到提议详情，故提议反馈**web 独占**。
   - 结论：本批**不存在**「同一主体双端都要实现反馈 UI」的重复施工，三个反馈入口各自只落一端。
     唯一的未来重叠点是 pm-review B1「群聊内看提议/审批」批——见 §10 施工围栏。
2. **读聚合的最省接线方案 = 只读「我自己」的判定，不做全员聚合**——与 CHAT 批 reaction（全员可见、
   社交信号、页级 grouped 查询返回全部 user_ids）刻意不同。反馈是训练数据信号 + 个人判断，不是社交表态，
   没有必要让队友互相看到谁打了差评（也避免团队内的评价压力）。因此：
   - 服务端只需要按 **当前 actor** 过滤的查询（`WHERE user_id = :actorId`），比 reaction 的
     "GROUP BY subject_id, key" 全员聚合更便宜——不需要新的分组/去重逻辑，直接命中
     `(subject_type, subject_id, user_id)` 唯一索引。
   - VM 里只出现 `my_feedback`/`feedback`（单个对象或 null），不是 `feedback: [{verdict, user_ids}]`
     数组——这直接决定了 §3 的契约形状与 §5 的接线方式。
3. **SSE 不需要**——不是因为「低频」，是因为反馈本来就没有跨用户可见面（见结论 2）。唯一的「跨端同步」
   场景是同一用户换设备/多开窗口看到自己之前的判定，属于「下次拉取自然拿到最新值」的低优先级场景，不值得
   为它开一个新事件类型（CHAT 批的四个新事件全部是「这条消息/会话的状态变了，所有看得到它的人都要更新」
   ——反馈没有这个「其他人也要更新」的前提）。落地：桌面/web 都用「乐观 UI + 下次消息/页面刷新时的服务端值
   兜底」，不接 `packages/contracts/src/enums.ts` 的 `eventTypes`。
4. **K5 成本记账不需要新增任何东西**——反馈本身是一次单纯的 DB 写（无 LLM 调用，零成本）。它在夜间
   curation 被消费时，花费已经记在**既有**的 `distill`/`refine` 两次 LLM 调用里（`apps/api/src/workers/
   agent-skill-curation.ts:446-467` `createSkillCurationProviderAdapters`，两处 `source: "curation"`）——
   给 prompt 多塞几段反馈文本不产生新的花费口径，`cost-ledger.ts:340-349` 的 "curation" scope 桶原样收纳。
   本批**不新增**任何 cost-ledger 写路径。
5. **反例池是全新的信号源，不是 K1 `discardedSkillSignals` 的复用**——K1（`packages/db/src/repositories/
   team-skill.ts:26-29,251-290`）记录的是「AI 自己蒸馏出来又被自验拒绝的技能提议」，语义是「AI 别再犯这个
   老错误」；FEEDBACK 批的反例池是「人类觉得 AI 某次具体产出不好」，语义完全不同（来源不同、主体不同、
   目的不同：前者防止 curator 重复浪费一次 LLM 调用去生成注定被拒的提议，后者给 curator 提供「真实世界里
   什么让人不满意」的证据）。两者在 curation prompt 里是**并列的两个独立小节**，不合并、不复用同一个函数。

## 1. 数据模型（迁移 0058）

`0058_ai_feedback.sql`，journal `idx=58`、`when=1783910000000`（照 0055→0057 每次 `+1000000` 的既有
间隔延续）、`tag=0058_ai_feedback`；`packages/db/src/schema.test.ts:665`
`"migration journal ends with 0057 search trgm indexes"` 改成 0058（施工时先跑一遍确认无人抢号，同
03-mem-design.md 的既有免责声明口径）。

新表 `ai_feedback`——设计上刻意贴近 `audit_logs`（`packages/db/src/schema/core.ts:1981-2006`）的多态
主体记录方式（`entity_type`+`entity_id` 无真实 FK、`workspace_id` 直接冗余列而非每次读时 join 三种不同
路径），理由：反馈的主体跨三张表（`conversation_messages`/`proposals`/`action_card_items`），单个字段
不可能挂到三张表任一个的真实外键上；`workspace_id` 直接落一份能让夜间 curation 的按工作区查询是一条
零 join 的裸索引扫描，而不是逐主体类型各写一套不同的 join 路径。

```
ai_feedback
  id                uuid primary key
  workspace_id      uuid not null references workspaces(id) on delete cascade
    -- 服务端从 actor.workspaceId 派生落盘，绝不信任客户端传入（同 03-mem-design.md §3.1 的既有口径）。
  subject_type      varchar(24) not null
    check (subject_type in ('conversation_message', 'proposal', 'action_card_item'))
  subject_id        uuid not null
    -- 故意不挂真实外键（多态引用，同 audit_logs.entity_id 的既有先例）；孤儿行的清理策略见下方 §2。
  user_id           uuid not null references users(id) on delete cascade
  verdict           varchar(16) not null check (verdict in ('useful', 'not_useful'))
  note              varchar(200)
    -- 可选一句话备注，硬顶 200 字符（施工里的字面要求）；复用 skill-curation.ts:66 的
    -- looksLikeInjection() 做指令注入短语拦截——note 最终会被喂进 curation prompt（§6），
    -- 人类输入不该比 AI 自己写的技能正文更松（同 03-mem-design.md §2.1 对 value_md 的同款理由）。
  created_at        timestamptz not null default now()
  updated_at        timestamptz not null default now()
    -- 改判（useful↔not_useful 或改备注）只更新这一行，不追加新行；夜间 curation 的 "since" 窗口按
    -- updated_at 判定新鲜度（一条反馈被改判 = 重新计入本轮信号，理由见 §6）。

  unique (subject_type, subject_id, user_id)  -- 幂等改判的地基：PUT 即 upsert。
  index (workspace_id, subject_type, verdict, updated_at)  -- 夜间 curation 的主查询路径。
  index (subject_type, subject_id)  -- 单主体读聚合（§5 的 listForSubjects/getForSubject）。
```

SQL 迁移写法照 0055 的 `message_reactions` 建表模板（`packages/db/migrations/0055_conversation_chat_
completeness.sql:61-70`：`CREATE TABLE IF NOT EXISTS` + inline `CHECK`，FK 用 `DO $$ IF NOT EXISTS
(SELECT 1 FROM pg_constraint...) THEN ALTER TABLE ADD CONSTRAINT`，索引用 `CREATE [UNIQUE] INDEX IF NOT
EXISTS`，全部 `--> statement-breakpoint` 分隔，单事务重放安全）。

drizzle schema 加在 `packages/db/src/schema/core.ts`，紧邻 `messageReactions`（:600-627）之后或
`auditLogs`（:1981）附近均可（集成者定，不影响正确性）；用同文件已有的 `id()`/`createdAt()`/
`updatedAt()`（:91-98）与 `check()`/`uniqueIndex()`/`index()` helper，风格照抄 `messageReactions`
（:600-627）。

**不改动** `conversation_messages`/`proposals`/`action_card_items` 三张表本身——反馈是纯 additive 的
旁挂表，零列变更，零风险回归。

## 2. 语义红线

- **主体存在性 + 可见性在服务层校验，不在数据库层**（多态引用没有真实 FK 能替你把关）：
  - `conversation_message`：目标必须 `sender_type='cuu' AND kind='text' AND deleted_at IS NULL`
    （只对 Cuu 的**活着的**文字回复开放；对用户自己的消息、系统消息、已删除消息一律 404——防止对着
    墓碑或人类消息打分，语义上没有意义）。可见性复用 `assertConversationAccess`
    （`apps/api/src/services/conversations.ts` 既有的会话可见性判定，同 CHAT 批端点的判式）。
  - `proposal`：目标必须存在；可见性复用 `canReadWorkItem(workItems, proposal.work_item_id, actor)`
    （`apps/api/src/routes/pages.ts:740`，GET `/proposals/:id` 已在用的同一个函数）。**不限制
    proposal.status**——`merged`/`rejected` 之后依然可以回头打分（"这次审批体验怎么样"是有效反馈，
    不因为已经决策完就作废）。
  - `action_card_item`：目标必须存在；可见性复用 `findItemForActor({itemId, workspaceId})`
    （`packages/db/src/repositories/action-cards.ts:334-350`，decide/undo 已在用的同一个方法）——这个
    方法只做 workspace 范围校验、不做会话级私密性二次校验，**本批照抄这个既有口径，不因为新增一个
    子功能就顺手收紧成更严格的标准**（同 03-mem-design.md 多处「延续现状口径，不趁机扩大/收紧」的
    既有纪律）。
  - **不限制条目 kind/status**——`execute`/`decide`/`observe` 三种 kind、任意 status 都可以打反馈
    （不像桌面渲染层只在终态展示按钮，见 §7.1；服务端保持宽松，UI 层自己收窄「什么时候值得展示入口」）。
- **幂等改判**：`PUT` 对同一 `(subject_type, subject_id, user_id)` 覆盖式更新 `verdict`/`note`/
  `updated_at`（`ON CONFLICT (subject_type, subject_id, user_id) DO UPDATE`）；`DELETE` 物理删这一行
  （不是软删——反馈没有审计留痕的产品需求，跟消息墓碑/记忆软删不是一回事：一条反馈的价值就是「当下的
  判断」，收回等于「当下的判断是没有反馈」，物理删更诚实，也不给孤儿行清理增加复杂度）。`DELETE` 幂等
  （不存在时返回现状，不报错，同 CHAT 批已建立的口径）。
- **note 校验**：`≤200` 字符（超限 400）+ `looksLikeInjection()` 拦截（含指令注入短语拒 400，理由见
  §1 数据模型注释）。空字符串等同「无备注」（存 `null`，不存空串——同 03-mem-design.md 对空值的一贯处理）。
- **孤儿行**：目标主体被物理删除的情况在这三张表里都不存在（`conversation_messages`/`action_card_items`
  只软删或不删；`proposals` 从不删除）——**本批不需要级联清理逻辑**，这是选择「无真实 FK」设计时刻意
  核实过的前提，不是留下的隐患。
- **错误类**：`AiFeedbackServiceError`（`status`/`code`/`message`，照
  `apps/api/src/services/memory-conflicts.ts:14-19` `MemoryConflictServiceError` 模板）。三个挂载点
  （消息路由/提议路由/行动卡路由）分别 `instanceof` 兜底成各自路由文件既有的错误映射，不新建
  `app.ts` 通用兜底——**唯一**需要动 `app.ts:272 onError` 的地方是给这一个新错误类补一个 `instanceof`
  分支（同 03-mem-design.md §3.3 的既有提醒）。

## 3. 契约（新文件 + additive 字段，all additive）

新文件 `packages/contracts/src/domain/ai-feedback.ts`（独立域文件，照 `domain/presence.ts` 的既有先例：
反馈是跨三个领域的横切概念，塞进 `conversation.ts`/`pages.ts` 任一个都会污染领域边界）：

```ts
export const aiFeedbackVerdictSchema = z.enum(["useful", "not_useful"]);
export type AiFeedbackVerdict = z.infer<typeof aiFeedbackVerdictSchema>;

export const aiFeedbackSubjectTypeSchema = z.enum([
  "conversation_message",
  "proposal",
  "action_card_item"
]);
export type AiFeedbackSubjectType = z.infer<typeof aiFeedbackSubjectTypeSchema>;

export const AI_FEEDBACK_NOTE_MAX_CHARS = 200;

// 「我自己」对某个主体的判定——不带 user_id（VM 语境下天然是当前 actor，见 00-plan §2 批 FEEDBACK
// 「读聚合最省接线」的裁定：只读自己，不做全员聚合，见 04-feedback-design-draft.md §0 结论 2）。
export const myAiFeedbackVmSchema = z.object({
  verdict: aiFeedbackVerdictSchema,
  note: z.string().max(AI_FEEDBACK_NOTE_MAX_CHARS).optional(),
  updated_at: isoDateTimeSchema
}).strict();
export type MyAiFeedbackVM = z.infer<typeof myAiFeedbackVmSchema>;

export const putAiFeedbackRequestSchema = z.object({
  verdict: aiFeedbackVerdictSchema,
  note: z.string().max(AI_FEEDBACK_NOTE_MAX_CHARS).optional()
}).strict();
export type PutAiFeedbackRequest = z.infer<typeof putAiFeedbackRequestSchema>;
```

`packages/contracts/src/index.ts:23-30` 附近加一行 `export * from "./domain/ai-feedback.js";`（照
`domain/presence.ts` 那行的既有格式）。

**additive VM 挂载点**（三处，全部 optional，旧客户端不认识这个键时零回归，照 CHAT 批 `edited_at`/
`pinned`/`reply_to`/`reactions` 的既有 additive 先例，`packages/contracts/src/domain/conversation.ts:
595-608` 的注释原话「openapi 只进 properties 不进 required，存量客户端读旧消息行为零回归」同样适用）：

1. **消息 VM**——`packages/contracts/src/domain/conversation.ts:588-608` 的 `conversationMessageBaseShape`
   加一行：
   ```ts
   my_feedback: myAiFeedbackVmSchema.optional(),
   ```
   只对 `sender_type==='cuu' && kind==='text'` 的活消息有意义，但**不**在 zod 层用 `superRefine` 强制
   （同 `pinned`/`reply_to` 的既有宽松处理——契约层允许出现在任何 kind，服务层保证只在合法主体上真的
   写入这个字段，契约层的收紧成本大于收益，参照 03-mem-design.md 屡次「纪律精神照搬，不强套」的取舍）。
2. **提议详情 VM**——`packages/contracts/src/pages.ts:1235-1255` `proposalDetailVmSchema` 加：
   ```ts
   feedback: z.object({
     my_verdict: aiFeedbackVerdictSchema.nullable(),
     my_note: z.string().max(AI_FEEDBACK_NOTE_MAX_CHARS).nullable(),
     mark_useful: actionSpecSchema,
     mark_not_useful: actionSpecSchema,
     clear: actionSpecSchema.optional()   // 只在已有判定时出现（"撤销反馈"）
   }).optional(),
   ```
   照抄 `review_actions`（:1242-1247）「服务端算好 href/method，客户端只管渲染点击」的既有风格——**不**
   像 §1 的 note 那样需要自由文本输入，两个动作按钮（mark_useful/mark_not_useful）用固定 `request_json`
   即可覆盖「无备注」的主路径；备注是渐进增强，见 §7.2。
3. **行动卡条目**——`ActionCardItemVM`（`apps/api/src/services/action-cards.ts:51-62`，纯 TS 类型非 zod
   schema）**不改**（decide/undo 响应不需要反馈字段，那是操作后的即时回执，不是聊天历史读取路径）。
   反馈只出现在**聊天消息流读取路径**：`kind==='action_card'` 消息的 `content.items[]` 数组（走
   `boundedConversationObjectContentSchema`，已是无强类型的通用 JSON object，见 §5.3——**这里不需要
   新增任何契约 schema**，`content.items[i].feedback` 就是普通 JSON 字段，跟 `content.items[i].id`/
   `title_md` 同等地位）。

## 4. HTTP 端点（三组，各自独立路由文件，不挂载）

三个主体的鉴权模型/可见性判定完全不同（会话可见性 vs work-item 可见性 vs workspace 成员），照
03-mem-design.md §3「两个实体分文件，理由：鉴权模型不同」的同款分拆纪律，**不**做一个通用
`PUT /api/feedback/:subjectType/:subjectId` 分发端点（那会把三套不同的鉴权判断硬拧进一个 if/switch，
正是 03-mem-design.md 明确警告过的反模式）。

### 4.1 消息反馈——新文件 `apps/api/src/routes/conversation-message-feedback.ts`

（独立于 `conversation-message-actions.ts`，理由：后者已经有编辑/删除/reaction/pin 五个端点，这批只加
反馈两个端点，混进同一个文件会让「批 CHAT 已完工」和「批 FEEDBACK 新增」的 diff 边界模糊，拆开更利于
`git blame`/回滚。挂载时两个文件在 `app.ts` 里紧邻注册即可。）照 `conversation-message-actions.ts:70-93`
reaction 端点的模板：

| 端点 | 语义 | 成败 |
|---|---|---|
| `PUT /api/conversations/{id}/messages/{messageId}/feedback` | body `{verdict, note?}`，幂等 upsert | 204 / 400(超长/含注入短语/坏 verdict) / 403(不可见) / 404(非 Cuu 文字消息/已删除/不存在) |
| `DELETE /api/conversations/{id}/messages/{messageId}/feedback` | 幂等撤销 | 204 / 403 / 404(会话不可见——不区分"没反馈"和"不存在"，都幂等 204) |

### 4.2 提议反馈——新文件 `apps/api/src/routes/proposal-feedback.ts`

| 端点 | 语义 | 成败 |
|---|---|---|
| `PUT /api/proposals/{id}/feedback` | body `{verdict, note?}` | 204 / 400 / 403(`canReadWorkItem` 未过) / 404 |
| `DELETE /api/proposals/{id}/feedback` | 幂等 | 204 / 403 / 404 |

**注意**：GET `/api/proposals/:id`（`apps/api/src/routes/pages.ts:729-744`）是**已挂载的活路由**，本批
需要**直接修改**它（不是「写好不挂、留给集成者」的模式）——`buildProposalDetailPage(proposal, locale)`
（`apps/api/src/pages/proposals.ts:97`）加第三个可选参数 `myFeedback?: MyAiFeedbackRow | null`，路由里
在调用前先查一次 `aiFeedback.getForSubject({subjectType:'proposal', subjectId: proposal.id, userId:
actor.userId})`，把结果传进去拼 `feedback` 字段（§3 第 2 点）。这是本批**唯一**直接改动已挂载路由文件
的地方，施工时需要格外小心不要碰坏 `canReadWorkItem` 那段既有 403 判断的位置（应在拿到 `myFeedback`
之前就短路返回，避免给无权限用户泄露"这条提议有没有人反馈过"）。

### 4.3 行动卡条目反馈——新文件 `apps/api/src/routes/action-card-item-feedback.ts`

（独立于 `action-cards.ts` 路由，理由同 4.1）：

| 端点 | 语义 | 成败 |
|---|---|---|
| `PUT /api/action-card-items/{id}/feedback` | body `{verdict, note?}` | 204 / 400 / 403(不在此工作区) / 404 |
| `DELETE /api/action-card-items/{id}/feedback` | 幂等 | 204 / 403 / 404 |

### 4.4 服务端仓库层——新文件 `packages/db/src/repositories/ai-feedback.ts`

```ts
export type AiFeedbackRow = {
  id: string;
  subjectType: AiFeedbackSubjectType;
  subjectId: string;
  userId: string;
  verdict: AiFeedbackVerdict;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AiFeedbackRepository = {
  upsert: (input: {
    workspaceId: string; subjectType: AiFeedbackSubjectType; subjectId: string;
    userId: string; verdict: AiFeedbackVerdict; note?: string | null; at?: Date;
  }) => Promise<AiFeedbackRow>;
  remove: (input: {
    subjectType: AiFeedbackSubjectType; subjectId: string; userId: string;
  }) => Promise<boolean>;  // true=真删了一行，false=幂等空操作（本没有）
  getForSubject: (input: {
    subjectType: AiFeedbackSubjectType; subjectId: string; userId: string;
  }) => Promise<AiFeedbackRow | null>;
  // 页级批量读——禁 N+1，照 listReactionsForMessages(conversations.ts:336-339) 同款签名风格。
  listForSubjects: (input: {
    subjectType: AiFeedbackSubjectType; subjectIds: string[]; userId: string;
  }) => Promise<Map<string, AiFeedbackRow>>;
  // 夜间 curation 专用（§6），按 workspace 直接查，零 join（workspace_id 冗余列的收益点）。
  negativeSamplesSince: (workspaceId: string, since: Date, limit: number) => Promise<AiFeedbackRow[]>;
  positiveCountsSince: (workspaceId: string, since: Date) =>
    Promise<{ subjectType: AiFeedbackSubjectType; count: number }[]>;
};
```

`upsert` 用 `INSERT ... ON CONFLICT (subject_type, subject_id, user_id) DO UPDATE SET verdict=excluded.
verdict, note=excluded.note, updated_at=excluded.updated_at`（drizzle `.onConflictDoUpdate`），单条语句
原子化，不需要 `agent-skill-curation.ts` 那种 advisory lock（唯一约束本身就是并发安全网）。

## 5. 读聚合接线（三处，各自独立，互不影响）

### 5.1 消息 VM——`apps/api/src/services/conversations.ts`

`enrichMessageRows`（:393-414）已经是「页级批量富化」的标准模式（并发拉 reactions + reply 预览，
Promise.all，各自有「集合为空就跳过查询」的守卫）。本批加**第三条**并行查询：

```ts
const [reactionsByMessage, replyTargets, feedbackByMessage] = await Promise.all([
  ...既有两条...,
  messageIds.length > 0
    ? aiFeedback.listForSubjects({ subjectType: "conversation_message", subjectIds: messageIds, userId: human.userId })
    : Promise.resolve(new Map<string, AiFeedbackRow>())
]);
```

`messageToVm`（:273-311）加一段：
```ts
if (enrichment.myFeedback) {
  vm["my_feedback"] = { verdict: enrichment.myFeedback.verdict, note: enrichment.myFeedback.note ?? undefined, updated_at: enrichment.myFeedback.updatedAt.toISOString() };
}
```
（`MessageEnrichment` 类型加一个 `myFeedback?: AiFeedbackRow` 字段。）**不需要**按 `sender_type==='cuu'`
过滤查询集合——查询用全部 `messageIds` 更简单（人类消息理论上永远不会有反馈行，因为写入端点已经在服务层
拒绝了非 Cuu-text 主体），省一次过滤不产生错误结果，只是查询集合略大，可接受。

### 5.2 提议 VM——单行读取，见 §4.2（`getForSubject`，不是批量，因为详情页一次只有一个 proposal）。

### 5.3 行动卡条目——消息 VM 构建时对 `kind==='action_card'` 消息做一次内容增强（**不写回 DB**，纯读时
合并，理由见下）：

`enrichMessageRows` 已经遍历 `rows`；本批加一步：从所有 `kind==='action_card'` 的行的
`content_json.items[]` 里收集 `item.id` 集合，批量查
`aiFeedback.listForSubjects({subjectType:'action_card_item', subjectIds: itemIds, userId})`，
然后在 `messageToVm` 对 `kind==='action_card'` 分支做：
```ts
if (row.kind === "action_card") {
  const content = row.contentJson as Record<string, unknown>;
  const items = Array.isArray(content["items"]) ? content["items"] : [];
  vm["content"] = {
    ...content,
    items: items.map((item) => {
      const itemId = (item as Record<string, unknown>)["id"];
      const fb = typeof itemId === "string" ? feedbackByItem.get(itemId) : undefined;
      return fb ? { ...item, feedback: { verdict: fb.verdict, note: fb.note ?? undefined } } : item;
    })
  };
}
```

**为什么读时合并、不写回 `buildActionCardMessageContent` 落库的 `content_json`**（`packages/db/src/
repositories/action-cards.ts:598,673,751`）：
- `content_json` 的 items 快照是**全会话共享**的一份 JSON（谁看这条消息看到的都是同一份），而反馈是
  **per-user** 的（同 §0 结论 2）。把 `feedback` 写进共享快照，要么变成「谁最后点了谁的判定盖过所有人」
  的错误语义，要么要把 items 里每个 item 的 feedback 字段也做成 `{verdict, user_ids}` 数组式聚合——那是
  在悄悄把「个人判断」升级成「社交聚合」，违背 §0 结论 2 的裁定。
- decide/undo 两处调用 `buildActionCardMessageContent` 的时机跟反馈写入完全解耦（决策/撤销才会重建
  content_json；打反馈不改变条目的 status/assignee，没有理由触发那条写路径），读时合并让这两条写路径
  永远互不感知，零协调成本、零竞态窗口。
- 代价：每次读消息列表多一次批量查询（已经是这个文件里第三次「集合为空就跳过」模式的重复应用，工程量
  很小）。

## 6. 夜间 curation 消费（反例池 + 好评强化）

### 6.1 服务端信号查询——`packages/db/src/repositories/team-skill.ts` 或独立注入（集成者定，两种都成立）

**负样本（反例池）**——`AiFeedbackRepository.negativeSamplesSince(workspaceId, since, limit)`
（`verdict='not_useful' AND updated_at >= since`，`ORDER BY updated_at DESC LIMIT :limit`，建议
`limit=20`，比 K1 的 `TEAM_SKILL_DISCARD_MEMORY_LIMIT=12`（`packages/contracts/src/domain/
team-skill.ts:64`）略宽——反例池是新信号源，起步给它更多曝光而非一开始就掐紧）。

拿到 `AiFeedbackRow[]` 之后，`agent-skill-curation.ts` 的 `analyze()`（:519-546）需要**逐条**补一段
「这条反馈具体在说什么」的人话摘要（否则 curator 只看到「有人打了差评」而不知道差评的是什么），三选一
按 `subjectType` 分别查：
- `conversation_message` → `content_json.text`（截断，参照 `skill-curation.ts:297`
  `REFINE_CONTENT_PREVIEW_CHARS` 同款截断纪律，反馈摘要用更短的上限，如 200 字符即可——不需要整段正文，
  够 curator 认出「是哪类回复」）；**若目标消息已被删（理论上 Cuu 消息不会被删，见 §2，但防御性判断）**，
  摘要显示「（消息内容不可用）」而不是空字符串或抛错。
- `proposal` → `proposals.title`（单列，不需要拉整个 diff manifest——同 `acceptedDeliverableSignals`
  只取 `targetKind` 不取全文的既有克制）。
- `action_card_item` → `action_card_items.title_md`。

三次查询用批量 `IN` 一次拉回（不是逐条查询——`negativeSamplesSince` 拿到的 20 条按 subjectType 分三组，
各自一条批量查询，仍然是 O(3) 次查询而非 O(20) 次，禁 N+1 纪律不变）。

**正样本（好评强化）**——`AiFeedbackRepository.positiveCountsSince(workspaceId, since)`，只返回
`{subjectType, count}[]` 聚合（照 `acceptedDeliverableSignals` 只取计数不取全文的同款克制——正面信号
只需要告诉 curator「这类产出正在被认可」，不需要逐条展示，避免 prompt 膨胀且没有对应收益）。

### 6.2 `SkillCurationAnalysis` 类型扩充——`apps/api/src/services/skill-curation.ts:32-44`

```ts
export type SkillCurationAnalysis = {
  // ...既有字段不变...
  negativeFeedback: { subjectType: AiFeedbackSubjectType; excerpt: string; note: string | null }[];
  positiveFeedback: { subjectType: AiFeedbackSubjectType; count: number }[];
};
```

### 6.3 prompt 注入点——`buildCurationPrompt`（`skill-curation.ts:126-162`）

在「【升级/卡壳信号】」小节之后、「【已有技能】」之前插两个新小节（顺序照 00-plan「差评…好评…」的原文
顺序，反例优先——它对 curator 的决策权重更高，理由跟 K1 discardedSkills 排在 escalations 之后是同一个
「先给约束、再给素材」的 prompt 组织习惯）：

```
【被打差评的近期产出（反例，勿重蹈覆辙）】
- [Cuu 回复] "……excerpt……"（用户备注：……note……）
- [提议] "……excerpt……"
（无备注的条目不带括号，note 为 null 时省略该段）

【获得好评的近期产出（用户主动认可，强信号）】
- Cuu 回复：获好评 6 次
- 提议：获好评 2 次
```

`hasCurationSignal()`（`skill-curation.ts:112-114`）**必须**扩充判断条件，否则一个只有反馈信号、没有
`acceptedDeliverableChanges`/`escalationEvents` 的工作区会永远不触发 LLM 调用、反馈数据石沉大海：

```ts
export function hasCurationSignal(analysis: SkillCurationAnalysis): boolean {
  return analysis.totalAccepted > 0 || analysis.escalations.length > 0
    || analysis.negativeFeedback.length > 0 || analysis.positiveFeedback.length > 0;
}
```

### 6.4 `agent-skill-curation.ts` 的 `analyze()`（:519-546）加两条并行查询

```ts
const [acceptedDeliverables, escalations, activeRows, discardedSkills, negativeFeedback, positiveFeedback] =
  await Promise.all([
    ...既有四条...,
    negativeFeedbackWithExcerpts(workspaceId, since),  // 封装 §6.1 的批量摘要拼装
    feedbackRepo.positiveCountsSince(workspaceId, since)
  ]);
```

### 6.5 「好评强化」的语义边界（明确不做的部分，防止过度设计）

00-plan 原话「好评强化」在本设计里落地为「给 curator 更多正向证据文本」，**不做**以下两件事（超出
「小中」体量、且需要目前不存在的基础设施）：
- **不做**「哪个 team_skill 影响了这条被点赞的产出」的反向追溯（当前没有 run↔skill 使用记录的关联表，
  要做这个需要在每次 worker 执行时记录"这次 prompt 注入了哪些技能"，是一个独立的可观测性项目，不在
  本批范围）。
- **不做**对已有技能 `confidence_score`/`sample_count` 的自动数值加成（正样本只作为 prompt 里的
  「文字证据」影响 curator 的**判断**，不直接改写任何数值字段——保持 `validateDistilledSkill`/
  `validateSkillEditPatch` 的既有硬性阈值不被绕过，防止反馈信号被刷分滥用）。

## 7. 双端 UI

### 7.1 桌面——`apps/desktop-webview/src/workbench/chat/render.ts`

**A. Cuu 文字消息的反馈入口**——挂进 hover 工具条 `renderMessageToolbarHtml`（:658-695）。当前该函数
签名 `(message, ctx, isSelf)`，对 Cuu 消息（`isSelf` 恒为 false）已经渲染「回复 + 五键反应 + 置顶」
三类共 7 个按钮（:663-693）。本批在**回复按钮之后、五键反应之前或之后均可**（建议紧跟五键反应之后，
视觉上归入"对这条消息的态度"分组）插入两个新按钮，仅当 `message.sender_type === 'cuu' && message.kind
=== 'text'` 时渲染：

```ts
if (message.sender_type === "cuu" && message.kind === "text") {
  const fb = message.my_feedback;
  const usefulOn = fb?.verdict === "useful";
  const notUsefulOn = fb?.verdict === "not_useful";
  parts.push(
    `<button type="button" class="wh-wb-chat-tool wh-wb-chat-tool--fb${usefulOn ? " wh-wb-chat-tool--fb-on" : ""}" data-wb-chat-feedback="useful" data-wb-chat-feedback-msg="${id}" aria-pressed="${usefulOn}" aria-label="${zh ? "有用" : "Useful"}" title="${zh ? "有用" : "Useful"}"><span class="wh-wb-chat-fb-glyph">✓</span></button>`,
    `<button type="button" class="wh-wb-chat-tool wh-wb-chat-tool--fb${notUsefulOn ? " wh-wb-chat-tool--fb-on" : ""}" data-wb-chat-feedback="not_useful" data-wb-chat-feedback-msg="${id}" aria-pressed="${notUsefulOn}" aria-label="${zh ? "没用" : "Not useful"}" title="${zh ? "没用" : "Not useful"}"><span class="wh-wb-chat-fb-glyph">✗</span></button>`
  );
}
```

交互（照 `reactions.ts` `toggleOwnReaction` 的乐观切换纪律，新文件 `chat/feedback.ts` 放纯逻辑函数）：
点未选中的键 = PUT 该 verdict；再点已选中的键 = DELETE（撤销）；点另一个键 = 直接 PUT 新 verdict
（覆盖式改判，不需要先 DELETE）。乐观 UI 失败回滚（同 CHAT 批 P1-11 收尾的既有纪律）。

**B. 持久态指示（不依赖 hover）**——`renderMessageHtml`（:722-765）在 `who` 行（:764，`editedLabel`
紧邻的位置）追加一个被动小 tile，只在 `message.my_feedback` 存在时渲染：
```ts
const feedbackBadge = message.my_feedback
  ? `<span class="wh-wb-chat-fb-badge wh-wb-chat-fb-badge--${message.my_feedback.verdict === "useful" ? "useful" : "not-useful"}">${message.my_feedback.verdict === "useful" ? "✓" : "✗"}</span>`
  : "";
```
拼进 `...${editedLabel}${feedbackBadge}</div>...`。这不是重复渲染——工具条按钮是**悬停时的操作入口**
（含 aria-pressed 状态），badge 是**始终可见的被动提醒**（用户不悬停也知道自己判定过这条消息）。两者
读同一个 `message.my_feedback` 字段，没有状态不一致的风险。

备注（note）的编辑走一个**极简**的二级交互：点击 badge（已有反馈时）弹出一个单行输入（同
`renderMessageEditBoxHtml`:699-705 的 textarea 结构，但 `rows=1` 且 `maxlength=200`），确认即
`PUT` 带上 `note`；不做备注是主路径的默认状态，不强迫用户每次都输入。

**C. 行动卡条目反馈**——`renderActionCardSummaryHtml`（:392-429）的 `list` 拼装（:417-425）里，只对
**终态**条目（`status` in `('done', 'escalated')`，且不是 `undone`——`undone` 已经整行置灰划线，反馈
没有意义；`waiting_decision`/`running` 还没有可评判的结果，不展示入口）追加同款字符 tile：
```ts
const feedbackHtml = (row.status === "done" || row.status === "escalated") && !undone
  ? renderActionCardItemFeedbackHtml(row, ctx, zh)
  : "";
return `<li class="${liClass}">...${statusHtml}${actionsHtml}${feedbackHtml}</li>`;
```
`renderActionCardItemFeedbackHtml` 复用同一套 ✓/✗ tile 标记（class 前缀改 `wh-wb-chat-actioncard-fb`
以免和消息级选择器混淆），数据源是 §5.3 合并进 `content.items[i].feedback` 的字段。**不做**备注输入
（行动卡条目本身已经很密集，见 §0 结论 1 与 §10 的占地表；备注需求主要在 Cuu 文字回复上——那才是最常见
的"AI 说了句不对的话"场景，行动卡条目的"有用没用"多数情况下靠二值本身已经够用）。

`ChatRenderContext`（:122-155）不需要新增字段——`message.my_feedback`/`content.items[i].feedback` 都
已经是消息 VM 自带的数据，跟 `message.reactions`/`message.pinned` 走同一条"数据在 VM 里，ctx 只放瞬态
UI 状态"的既有分工（唯一例外：如果备注编辑框要做成"瞬态展开态"，需要 `ctx.editingFeedbackMessageId?:
string` 一个字段，同 `ctx.editing`/`ctx.confirmDeleteMessageId` 的既有模式）。

### 7.2 web——`packages/ui/src/gold-path/route-components.ts` `renderProposalRouteComponent`

插入点：header 块（:2764-2774）的状态 pill（`data-r4-proposal-status`，:2773）之后，追加：
```ts
${vm.feedback ? renderProposalFeedbackHtml(vm.feedback, locale) : ""}
```
`renderProposalFeedbackHtml` 渲染两个 `<a data-action-id data-method data-request-json>` 链接（照
`swapProposalActionRow` 已建立的 `data-action-id`/`data-method`/`href` 三件套契约，`apps/web/src/
browser.ts:349-357`），`aria-pressed` 反映 `vm.feedback.my_verdict`；已判定时追加一个「撤销」小链接
（`vm.feedback.clear`，只在 `my_verdict !== null` 时出现）。

**接线现状核实**：`apps/web/src/browser.ts:1134` 起的 `api-action` 分发是**逐 `actionId`/`href` 模式
硬编码分支**的大函数（`proposalActionFromHref`/`approvalRespondIdFromHref`/
`mergeProposalCandidateApplyIdFromHref` 等各自独立判断，未见通用兜底分支——施工时需要在这条链上核实
是否存在真正的默认 fallback）。**不要**假设存在通用处理，直接加一个新分支识别
`/api/proposals/:id/feedback` 这个 href 形状（比照 `proposalActionFromHref` 写一个
`proposalFeedbackActionFromHref(href)` 辅助函数），调用新增的 `client.putProposalFeedback`/
`client.deleteProposalFeedback`（§7.3），成功后走**乐观本地 DOM class 切换**（不整页 `renderCurrentRoute`
——同 `reviewProposal`/`mergeProposal` 分支已经建立的「详情页原地更新，不重跑 loader」纪律，M12 备注
`apps/web/src/browser.ts:330-334`）。

备注输入走**独立**的小型绑定函数 `bindProposalFeedbackNotePanel`（照 `bindNotificationMutePanel`
:2082-2180 的模板：面板级 `querySelector` + 自己的 `addEventListener` + 自己的状态文案，不占用大
`api-action` 分发器），因为备注是自由文本输入，不适合塞进 `ActionSpec.request_json` 的固定 JSON 模型。
挂载位置：`apps/web/src/browser.ts` 里现有的 proposal 页 bind 函数群（若未来还没有独立的
`bindProposalPanel`，就近加一个新的顶层调用点，同 `bindMemoryPanel`（:2824，MEM 批已建立的最新范例）
的接入方式）。

### 7.3 客户端方法——`packages/api-client/src/client.ts`

紧邻 `reviewProposal`/`mergeProposal`（:502-511）与 `patchUserMemory`/`deleteUserMemory`（:605-611，
MEM 批已落地的直接可抄模板）：
```ts
putProposalFeedback: (id, payload) =>
  request(`/api/proposals/${encodeURIComponent(id)}/feedback`, { method: "PUT", body: JSON.stringify(payload) }),
deleteProposalFeedback: (id) =>
  request(`/api/proposals/${encodeURIComponent(id)}/feedback`, { method: "DELETE" }),
```

## 8. 字符 tile 设计（emoji 豁免边界之外的第三套视觉语言）

现有 UI 已经有三层「小图标」语言，反馈 tile 是第四层，边界必须说清楚：

1. **SVG 描边图标**（`apps/desktop-webview/src/workbench/icons.ts` `workbenchIcons`）——回复/编辑/删除/
   置顶等"动作类"按钮，多色阶、需要精细视觉打磨的场景。
2. **emoji 字形**（`REACTION_EMOJI`，`chat/render.ts:29-35`）——**唯一**豁免，仅限五键反应展示层，
   01-chat-design.md §6 明文划定边界，不得扩大。
3. **状态圆点 `●`**（`packages/ui/src/workitem/render.ts:149`、`route-components.ts:2365`、
   `spotlight/views/dashboards.ts:596`）——纯排版符号，表示"有一个待关注的点"，无方向性语义。
4. **本批新增：字符 tile `✓`/`✗`**——U+2713 CHECK MARK / U+2717 BALLOT X，两个纯排版符号（不带
   variation selector、不触发系统 emoji 字体渲染，与 `✔️`(U+2714+FE0F)/`❌`(U+274C) 那类彩色 emoji
   presentation 字符有本质区别），落在用户已明确认可的「排版符号 ✓ ● ⌘ 可以」白名单内（见用户偏好记忆
   `no-emoji-preference.md`）。选择原生字符而非再画一对 SVG 对勾/叉号的理由：反馈是「二元判断」这个
   语义本身就是文字符号最自然的表达（对勾/叉号是全球通用的判断符号，跟"删除用垃圾桶图标"这类需要
   隐喻的场景不同，不需要图形化）；同时**故意不采用**已存在的 `workbenchIcons.check`（SVG 对勾）——
   保持"反馈"这个新交互跟"编辑/删除/置顶"那组既有动作在视觉上可区分（不同的图标语言 = 不同的心智
   分组），符合 00-plan 原文「字符 tile 不是 emoji」这句话背后「新引入一种、且只有一种新视觉语言」的
   意图，而不是混用 SVG 系统里已有的元素。
5. CSS 类名新增建议：`wh-wb-chat-tool--fb`（工具条按钮变体）、`wh-wb-chat-fb-glyph`（字符本体，控制
   `font-size`/`line-height`，同 `wh-wb-chat-reaction-emoji`:423 的做法）、`wh-wb-chat-fb-badge`
   （持久态徽标）——全部落在 `apps/desktop-webview/src/workbench/css.ts`，紧邻既有
   `.wh-wb-chat-reaction*`/`.wh-wb-chat-tools*` 规则块（:401-424）之后，颜色语汇建议：`useful` 用
   `--ds-success`（同 `renderActionCardRunProgressTerminalHtml`:257 的既有绿色语汇），`not_useful` 用
   中性 `--ds-danger` 的弱化版（不要跟"删除"按钮抢同一个强烈的红色警示语义，建议 `opacity` 降低或用
   `--ds-warn` 而非满饱和度 `--ds-danger`——施工时视觉打磨，非本设计的强制约束）。

## 9. SSE 结论重述（不做）

见 §0 结论 3。落地确认：**不**在 `packages/contracts/src/enums.ts` `eventTypes` 新增任何反馈相关事件；
**不**在 `apps/api/src/broker`/`getDefaultPushBus` 侧发布任何反馈事件；桌面/web 均为「乐观 UI 立即生效
+ 下次该消息/该页面自然重新拉取时以服务端为准」，没有主动推送。

## 10. 施工切片

| 工包 | 分支 | 模型 | 范围 | 围栏 |
|---|---|---|---|---|
| W-A feedback-server | r14/feedback-server | opus | 迁移 0058 + `ai-feedback.ts` 仓库 + 三个路由文件（不挂载）+ 契约新文件 `domain/ai-feedback.ts` + `conversationMessageBaseShape`/`proposalDetailVmSchema` additive 字段 + `conversations.ts` 三处读聚合接线（§5.1/5.3）+ `pages/proposals.ts` `buildProposalDetailPage` 签名扩充（§4.2，**这是本批唯一改动已挂载路由的地方，需要单独核对 `apps/api/src/routes/pages.ts:729-744` 不破坏既有 403 短路顺序**）+ 测试 | 只动 `packages/db/src/{schema,repositories}`、`apps/api/src/{services,routes,pages/proposals.ts}`、`packages/contracts/src/{index.ts,pages.ts,domain/ai-feedback.ts,domain/conversation.ts}`；不碰 `app.ts`/`openapi.ts` |
| W-B curation-consume | r14/feedback-curation | opus | `skill-curation.ts` 的 `SkillCurationAnalysis`/`hasCurationSignal`/`buildCurationPrompt` 扩充（§6.2/6.3）+ `agent-skill-curation.ts` 的 `analyze()` 两条新查询（§6.4）+ 测试；**依赖 W-A 的 `AiFeedbackRepository` 类型落地，可并行写但最后要对齐一次类型** | 只动 `apps/api/src/{services/skill-curation.ts,workers/agent-skill-curation.ts}`、对应两个 `.test.ts` |
| W-C desktop-feedback-ui | r14/feedback-desktop | sonnet | §7.1 全部（工具条按钮 + 持久 badge + 行动卡条目 tile + 新文件 `chat/feedback.ts` 纯逻辑）+ CSS（§8.5）+ 测试 | **只动 `apps/desktop-webview/src/workbench/chat/**` + `apps/desktop-webview/src/workbench/css.ts`——见下方"与群聊内审批批的占地预警"** |
| W-D web-feedback-ui | r14/feedback-web | sonnet | §7.2 全部 + `client.ts` 两个新方法（§7.3）+ `browser.ts` 新分支/新绑定函数 + 测试 | 只动 `packages/ui/src/gold-path/route-components.ts`（仅 `renderProposalRouteComponent` 及其新增 helper）、`packages/api-client/src/client.ts`、`apps/web/src/browser.ts` |

冲突磁铁（集成者手解，照 CHAT/MEM 批同款清单）：`app.ts`（三处路由挂载 + 一处 `onError instanceof`
分支）、`openapi.ts`（三条新路径文档）、`app.test.ts` 路由白名单、`packages/db/src/schema.test.ts`
journal 尾断言（0058）、`apps/web/src/routes.test.ts`（若因 web 端新增 `data-r14-*` 属性触发任何计数
断言，施工时先跑一遍确认）。全量门=各包 test+typecheck+迁移链 scratch 真库 0000→0058+CI 逐 job 核
（同 04 手册纪律）。

### 与「群聊内审批」批的占地预警（pm-review-2026-07-14.md §5 B1）

该批（尚未定档到具体批次字母，00-plan §5 记为 B 级待插队项）计划给桌面聊天加一个**右栏情境面板**
内联提议 diff + 通过/打回（"建议右栏情境面板内联提议 diff+通过/打回"）。**修正侦察**：这个「右栏情境
面板」基础设施**已经存在**，不是要新建的组件——`apps/desktop-webview/src/workbench/drive/side-panel.ts`
顶部注释明确写着「工作台右栏『情境面板』…挂载一次、活到整个工作台窗口生命周期…这样聊天视图的 file_card
点击和网盘标签的文件点击才能共用同一份右栏内容与状态」，`store.ts:49` `sidePanelContent:
WorkbenchSidePanelContent` 是这套机制的不透明容器（`{ownerId, html}`），`drive/side-panel.ts` 只是
**当前唯一的消费者实现**，设计上就是给聊天视图复用预留的。据此推断，「群聊内审批」批大概率会新增一个
姊妹控制器（如 `chat/proposal-side-panel.ts`，仿 `drive/side-panel.ts` 的结构：拉数据→渲染→推进
`store.sidePanelContent`），并把 `renderDeliverableCardHtml`（`chat/render.ts:444-470`）里"提议详情页
由后续批次接入这个窗口"的占位文案换成一个打开右栏的点击句柄——这个函数**不在**本批 FEEDBACK 的改动
范围内（本批只动 `renderMessageToolbarHtml`/`renderMessageHtml`/`renderActionCardSummaryHtml` 三个
函数，见上表 W-C 围栏），两批理论上可以并行、互不冲突。

**唯一需要后续批次知晓的接口约定**：当"群聊内审批"批把提议内联进桌面聊天的右栏面板后，该面板渲染的
提议数据来自同一个 `GET /api/proposals/:id`（`proposalDetailVmSchema`），**届时会自动带上本批新增的
`feedback` 字段**——该批不需要重新设计提议反馈的数据模型或端点，只需要决定"要不要在右栏面板里也渲染
一遍 `renderProposalFeedbackHtml` 同款 tile"（一个纯 UI 复用决策，不是新的后端工作）。建议把
`renderProposalFeedbackHtml`（§7.2）设计成一个不依赖 web DOM 特有 API 的纯字符串拼装函数（同
`chat/render.ts` 全文件的既有约束"纯函数、可单测、无副作用"），这样如果未来桌面右栏面板想复用同一段
HTML 拼装逻辑，理论上可以把这个函数搬到 `packages/ui` 共享——但**本批不做**这个抽象（YAGNI，等真的有
第二个调用方再抽，现在只有 web 一处用）。

## 11. 明确不做（防范围漂移）

- 打分制/五星评价——00-plan 明文否决，二值 + 可选备注封顶。
- 反馈的全员可见聚合（"这条消息有 3 人觉得有用"这类社交计数展示）——见 §0 结论 2，与 reaction 刻意
  区分的产品语义。
- 反馈跨端实时同步（SSE）——见 §0 结论 3/§9。
- 正反馈到具体 team_skill 的置信度数值加成、run↔skill 使用关联追溯——见 §6.5，需要目前不存在的
  可观测性地基，超出本批体量。
- 行动卡条目的备注输入——见 §7.1C，只在 Cuu 文字消息上做备注，行动卡条目只做二值 tile。
- 反馈的软删除/审计留痕/历史版本——DELETE 即物理删，见 §2（与消息墓碑/记忆软删刻意不同的产品语义：
  反馈的价值只在"当下"，没有"删除后可恢复"或"审计谁曾经打过差评"的产品需求）。
- 管理员查看/管理团队成员反馈的后台面板——00-plan 没有点这个需求，且与 §0 结论 2 的隐私取向相悖，
  不顺手多做。
