# R14 · 批 MEM 实现级设计（记忆可见可治理）

> 状态：施工设计草稿 · 2026-07-14 · 上游：00-plan.md §2 批 MEM（用户已拍板范围，原话「可以诶」）
> 侦察基础：`packages/db/src/schema/core.ts`（user_memories/team_skills 现状）+ 服务端读写链路 7 处
> + web `/settings`/`/dashboard/skills` 现状 + 桌面 Spotlight `settings` 视图 + admin 判定先例。
> 集成裁定（2026-07-14）：迁移号对调——MEM 占 0056（when=1783908000000），SEARCH 批顺延 0057（MEM 迁移小且先落地，避免 journal 空洞）。正文中原 0057 表述已全部归一为 0056。
> 纪律：04 手册 13 条铁律不变；仓库=`/Users/apple/.codex/worktrees/WorkHub/r12-workbench-full`（main，
> HEAD=`d41dbdc8`，CHAT 批 W1-A `conversation-message-actions.ts` 已挂载，SEARCH 批未见迁移，故 0056 空缺、
> 0057 是 MEM 可用的下一个号）。本文档只读侦察 + 设计，未改仓库任何文件。

## 0. 范围裁定

照 00-plan 拍板范围：读写管理面（列表/详情/编辑/删除/停用）+ 出处字段 + web 设置区页 + 桌面 Spotlight 同款
分区，分「关于我」（用户记忆）/「团队技能」两 tab，团队技能编辑权=管理员、成员只读。

**关键侦察结论（决定了本设计与 00-plan 字面表述的三处出入，逐条说明）：**

1. **`user_memories` 和 `team_skills` 的既有列已经覆盖了大半「出处」需求**——不是从零开始补字段。
   - `user_memories`（`packages/db/src/schema/core.ts:2011-2042`）已有 `source_run_id`（FK→`agent_runs`）、
     `created_at`（=首次学到时间，`upsert()` 复用同 key 时不重置它，只有 `insertMemory` 首次插入才写）、
     `deleted_at`（软删，消费侧已排除）。
   - `team_skills`（同文件 :2121-2148）已有 `source_run_id`、`status`（draft/active/**deprecated**——「停用」
     已有现成状态位）、`deprecated_reason`/`deprecated_at`、`samples_json`（K2 精修时存
     `refined_from_version`/`ops`/`rationale_md`，`apps/api/src/pages/team-skills.ts:18-34` 已读出来做
     `provenance` 展示）。
   - 结论：**真正缺的不是「有没有出处字段」，而是「PATCH 人工编辑时怎么留痕」**——这是唯一需要新迁移的地方
     （见 §1）。00-plan 里「存储若缺出处字段则补 additive 迁移」的表述成立，只是缺口比预想的窄。

2. **`team_skills.source_run_id` 实际上是个死列**——唯一写者 `apps/api/src/workers/agent-skill-curation.ts`
   的两处 `repository.promote()` 调用（:162-176 精修 / :249-261 新增）**从未传 `sourceRunId`**（技能策展是
   独立 worker 直调 LLM，不经过 `agent-runner.ts` 的 run 生命周期，没有真实 `agent_runs` 行可挂）。团队技能
   的出处故事应该讲 `created_at` + `sample_count` + `confidence_score` + `samples_json`（被接受交付物数/
   升级信号数）+ K2 `provenance`，不是 `source_run_id`（历史上永远是 NULL，展示层不应该假装能从它读出东西）。

3. **`user_memories.source_run_id` 并非处处都有**——两条写路径的对比：
   - `apps/api/src/services/agent-memory.ts:506-515`（L1→L2 夜间晋升）：**会**传 `sourceRunId`（来自
     `agent_memory` 行自己的 `source_run_id`，链路上溯到真实 run）。
   - `apps/api/src/services/proposals.ts:2056-2074`（审批打回沉淀 correction 记忆，`correctionFromReview`
     定义于 `apps/api/src/services/user-memory.ts:40-62`）：**不**传 `sourceRunId`——这类记忆天生没有 run
     背书，因为它是人的审批意见，不是 AI 执行产出。但这类记忆的 `key` 字段字面就是
     `` `proposal:${proposalId}` ``（`user-memory.ts:58`），出处可以诚实地从 `category==='correction' &&
     key.startsWith('proposal:')` 反解出「来自你对提案 X 的审批意见」，不需要新列。
   - 结论：`source_run_id` 为空 ≠ 出处不明，展示层要按「run 出处 → key 反解出处 → 确实不明」三级降级，
     绝不能对 NULL 直接展示空白或瞎编。

## 1. 数据模型（迁移 0056，仅此一处新增列）

`0056_memory_edit_provenance.sql`，journal idx=56、when=1783908000000、tag 同文件名；
`packages/db/src/schema.test.ts:665` 尾断言「migration journal ends with 0055」要改成 0056
（若 SEARCH 批已抢先落 0056，尾断言到时以实际链为准，由集成者核对——本设计占 0056 这个号（集成者已裁定，SEARCH 顺延 0057））。

`user_memories` 增列（nullable，additive，不影响任何既有查询）：
- `edited_by_user_id uuid references users(id) on delete set null`——人工 PATCH 编辑正文的操作者；
  AI/夜间晋升写入的记忆此列始终为 NULL（诚实区分「AI 学到的」与「人改过的」）。
- `edited_at timestamptz`——配合上一列，人工编辑发生的时间。

**`team_skills` 本批不加列**——人工编辑走 §3 的「借道 K2 版本化机制」方案，复用现有
`promote()`/`version`/`created_by_kind`/`samples_json`，不需要新字段（理由见 §3.2）。

不新建表；不动 `agent_memory`/`agent_memory_versions`（那是 work-item 上下文记忆 L1 层，与本批的用户级
L2 记忆管理面不是同一回事，混进来会扩大范围）。

## 2. 语义红线

### 2.1 用户记忆（「关于我」tab）

- 列表/详情只读者=**本人**（`user_memories.user_id === actor.userId`）。这是纯私有面板，不像团队技能有
  「成员只读」的公开可见语义——用户只能管理自己的记忆，管理员也不能代读/代改他人记忆（04 手册纪律：
  不无理由扩大数据可见面）。若产品后续想要「管理员审计用户记忆」，是另一个决策，本批不做。
- 编辑：仅 `value_md` 可改；`category`/`key` 不可改（改 key 等于换了一条记忆的身份，应该走删除+新增，
  不是编辑）。乐观并发：请求带 `expected_updated_at`（照 `apps/api/src/services/memory-conflicts.ts:174`
  `row.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()` 的既有比对写法），不符→409。
  写入时置 `edited_by_user_id=自己`、`edited_at=now`；**不触发 `upsert()` 的 confidence+0.1 强化逻辑**
  （那是给 AI 反复学到同一偏好时用的强化信号，人工编辑不是「又学到一次」，语义不同，需要新的仓库方法而不是
  复用 `upsert`）。`value_md` 长度上限沿用 `correctionFromReview` 已有的 400 字截断经验，但这里是用户主动
  编辑不是自动摘要，给宽松上限 2000 字符（防注入 worker prompt 时膨胀，同时不至于打断正常表达）；超限
  400。复用 `apps/api/src/services/skill-curation.ts:66` 的 `looksLikeInjection()`（已是通用文本函数，非
  技能专属）做同款指令注入短语拦截——`value_md` 同样会经 `buildUserMemoryPromptSection()`
  （`user-memory.ts:23-37`）注入 worker prompt，人工编辑输入不该比 AI 自己写的正文更松。
- 删除：软删（复用既有 `softDeleteForUser(userId, id, at?, scope)`，`packages/db/src/repositories/
  user-memory.ts:289-302`），不新增语义。UI 文案「删除后 Cuu 将忘记这条」是诚实的——`listForUser()` 已经
  `isNull(deletedAt)` 过滤（:238），删除后立刻从下一次 prompt 注入里消失。物理行保留（审计/防误删恢复的
  既有纪律，同 CHAT 批消息墓碑同一哲学），但管理面 UI 不做「回收站」视图（不在拍板范围内，避免过度设计）。
- **没有独立的「停用」动作**——对用户记忆而言，「停用」和「删除」在消费侧效果完全相同（都是从
  `listForUser()` 消失），产品语义上也没有「团队技能 draft/active/deprecated 那种版本沿革」的必要，
  强行做出两个语义相同的按钮只会让用户困惑该点哪个。00-plan 里「列表/详情/编辑/删除/停用」是对 MEM 批
  两个子面板的合并表述，不是要求每个子面板都长出全部五个动作——本设计对用户记忆只做列表/详情/编辑/删除
  四个，团队技能只做列表/详情/编辑/停用四个（无「删除」，理由见下）。

### 2.2 团队技能（「团队技能」tab）

- 列表/详情：**全体已登录成员可读**（现状——GET `/skills` 路由 `apps/api/src/routes/pages.ts:994-1001`
  只挂了 `createCurrentUserMiddleware`，没有 isAdmin 门槛；侧栏导航把 `skills` 分进了
  `packages/ui/src/gold-path/product-shell.ts:438` 的 `adminOnly:true` 分组，那只是**导航可发现性**，
  不是访问控制——本设计延续「路由对全员开放，管理面的『编辑/停用』动作才做 isAdmin 门槛」的现状口径，
  不趁机收紧既有的只读开放性）。管理面列表比现有消费页多两样：**含 `content_md` 全文**（现有
  `teamSkillVmSchema` `packages/contracts/src/pages.ts:70-87` 不带正文，管理面编辑需要）+ **含
  `deprecated` 状态的历史版本**（现有 `/skills` 只给 `listActive`；管理面用已有的
  `listForWorkspace(workspaceId)` `packages/db/src/repositories/team-skill.ts:135-141`，本就返回全部版本，
  按 `skill_key asc, version desc` 排序，零新增仓库方法）。
- 编辑：**仅管理员**（`actor.isAdmin`，鉴权判定见 §5）。**没有自由文本整篇覆写**——沿用 K2 纪律，见 §3.2。
- 停用：**仅管理员**，复用既有 `deprecate(workspaceId, id, reason, at?)`
  （`team-skill.ts:153-161`），reason 默认给 `"由 ${nickname} 手动停用"`（可选 body 带自定义 reason 覆盖
  默认值）。停用后 `listActive()`（planner 消费口径，`task-plans.ts:283`）立刻不再捞到它，跟 AI 自己
  deprecate 的语义完全一致——不是新语义，是把既有 kill-switch 开给人类从 UI 点，而不只是靠代码内部调用。
- **没有独立的「删除」动作**——团队技能没有物理删除也没有软删列，删除会打断 `(workspace_id, skill_key,
  version)` 唯一约束与版本沿革（后续版本、`refined_from_version` 链会指向一个消失的行）。停用已经是这个
  实体模型里「最强的收回动作」，比照用户记忆那侧的推理，不强行造一个语义重复或者要改 schema 才能做对的
  「删除」按钮。
- **回滚**（`rollbackTo(workspaceId, skillKey, version, at?)`，`team-skill.ts:163-194`）**已存在但本批不
  建 HTTP 端点**——00-plan 没有点这个需求，属于会诱发范围漂移的「顺手多做」。设计上留一句话：如果用户
  后续要「撤销停用/回到某个历史版本」，这个仓库方法已经现成，加一个 `POST .../rollback` 是小活，留给
  FEEDBACK 或后续复审批次按需点名，本批不预先建。

### 2.3 出处展示（诚实语义，不编造）

服务端拼装 `provenance` 时按以下优先级（任一步拿不到就诚实跳到下一步，最终没有就整个 `provenance`
字段省略，前端渲染「早期记录，出处不明」而不是留空白或者显示 `null` 字样）：

**用户记忆：**
1. `source_run_id` 非空 → LEFT JOIN `agent_runs`（取 `title`/`work_item_id`/`source_conversation_id`/
   `created_at`，schema 见 `packages/db/src/schema/core.ts:1597-1637`）→ 有 `source_conversation_id` 再
   LEFT JOIN `project_conversations.title`（:433-463）拼「来自会话《X》的一次 AI 执行」；只有
   `work_item_id` 没有会话则拼「来自任务《work_items.title》的一次 AI 执行」（`work_items.title` 可空，
   再退化为「来自一次 AI 执行 · {agent_runs.created_at}」）。
2. `source_run_id` 为空但 `category==='correction' && key` 匹配 `^proposal:` → 反解 `proposalId`，拼
   「来自你对某次变更申请的审批意见」（不强行深链到提议详情页——提议可能已被后续流程改变状态，只诚实说明
   来源类型，不承诺可跳转；若产品想要可点击深链，需要校验提议仍存在，这是可以后置的小增强，不阻塞本批）。
3. 都不满足 → 不返回 `provenance`，前端显示「早期记录，出处不明」。
4. **`edited_by_user_id` 非空时叠加一行「最近由你于 {edited_at} 修改」**——这与「学习出处」是两件事
   （学到什么 vs 后来被人改过），不要合并成一句话掩盖掉编辑痕迹。

**团队技能：**
- 主展示：`created_at`（首次晋升时间）+ `sample_count` + `confidence_score` + `source_kind`
  （distilled/authored）+ `created_by_kind`（ai/human）——这几列已经是 `teamSkillVmSchema` 现有字段，
  管理面直接复用，不用发明新东西。
- K2 精修 provenance（`refined_from_version`/`op_count`/`rationale_md`）：复用
  `apps/api/src/pages/team-skills.ts:18-34` 的 `provenanceFrom()` 现成逻辑，管理面 VM 照抄这段（或者
  提出这个函数给两个页面共用，视集成者取舍，不强制）。
- 人工编辑后的版本：`created_by_kind==='human'` 即可判断「这个版本是管理员手改的」，不需要额外查询——
  这是 §3.2 方案（借道 `promote()` 生成新版本）的直接收益。

## 3. HTTP 端点

施工=独立路由文件不挂载（`apps/api/src/routes/user-memory-governance.ts` +
`apps/api/src/routes/team-skill-governance.ts`，两个实体分文件，理由：鉴权模型不同——前者「本人可读写」，
后者「全员可读、管理员可写」，混一个文件容易把鉴权判断写串）；挂载/openapi/app.test 白名单=集成者。
路由文件头部照 `apps/api/src/routes/user-profile.ts:17-23` 的既有写法留下集成者缝合指引
（`app.ts` import+`app.route` 行、`openapi.ts` 路径文档占位）。

### 3.1 用户记忆端点

| 端点 | 语义 | 成败 |
|---|---|---|
| `GET /api/me/memories?category=` | 列表，本人全部未删除记忆（≤`USER_MEMORY_MAX_ACTIVE_PER_USER`=50，同既有硬顶），`category` 可选过滤 | 200 `{memories:[VM], totals:{active}}` |
| `GET /api/me/memories/:id` | 详情 | 200 VM / 404（不存在或非本人） |
| `PATCH /api/me/memories/:id` | 编辑，body `{value_md, expected_updated_at}` | 200 VM / 400（超长/含注入短语） / 404 / 409（并发冲突/已删除） |
| `DELETE /api/me/memories/:id` | 软删（幂等：重复删返回现状 200，不报错） | 200 `{deleted:true}` / 404 |

鉴权：`requireCurrentUser` 中间件 + 路由内部强制 `eq(userMemories.userId, actor.userId)`（不接受任何
「代他人操作」的参数，杜绝水平越权）。`workspace_id` 从 `actor.workspaceId` 派生，不接受客户端传入
（同 `apps/api/src/routes/pages.ts:996-998` 的既有口径：workspace 归属永远服务端算，不信任客户端）。

### 3.2 团队技能端点

| 端点 | 语义 | 成败 |
|---|---|---|
| `GET /api/team-skills/manage` | 列表，本工作区全部版本（active+deprecated），`listForWorkspace()` 原样返回，按 skill_key asc/version desc | 200 `{skills:[VM]}` |
| `GET /api/team-skills/manage/:id` | 详情（含 `content_md` 全文） | 200 VM / 404 |
| `PATCH /api/team-skills/manage/:id` | **仅管理员**，K2 受限编辑补丁，body `{ops, base_version, rationale_md?}` | 200 新版本 VM / 400（op 校验失败/体积超限/含冲突标记/含注入短语） / 403（非管理员） / 404 / 409（`base_version` 与当前激活版本不符——并发编辑撞车） |
| `POST /api/team-skills/manage/:id/deactivate` | **仅管理员**，停用（=`deprecate`），body `{reason?}` | 200 `{deprecated:true}` / 403 / 404 / 409（已是 deprecated，幂等返回现状而非报错——参考 CHAT 批的幂等收尾口径） |

**PATCH 语义细节（沿用 K2 纪律，不是另起一套校验）：**

`:id` 定位的必须是**当前激活版本**（`status==='active'`）——对已 deprecated 的历史版本发 PATCH 直接 404
（历史版本只读，要改只能改当前激活版本，产生新版本）。请求体复用
`packages/contracts/src/domain/team-skill.ts:98-116` 的 `skillEditOpSchema`/`ops` 结构（`add_section`/
`modify_section`/`remove_section`，段落级、最多 `TEAM_SKILL_MAX_EDIT_OPS`=3 个 op），`base_version`
做乐观并发（必须等于当前激活版本号，否则 409——语义与 AI 精修的 `validateSkillEditPatch`
`skill-curation.ts:264` 完全一致，是同一段代码）。

服务端处理：
1. 把 HTTP body 组装成一个完整 `SkillEditPatch`（`skill_key` 从 URL 对应的行取，`confidence_score`
   硬编码为 `1`——人工编辑没有「置信度」这个概念，给满分让它必过 `TEAM_SKILL_MIN_CONFIDENCE` 门槛而不是
   为人类编辑单独造一套校验函数；`rationale_md` 缺省给 `"管理员手动编辑"`）。
2. 调用现成的 `validateSkillEditPatch(patch, {activeVersion, currentContentMd})`
   （`skill-curation.ts:256-294`）——**逐字复用**，不新写校验逻辑。这一步天然带上：`base_version` 校验、
   `applySkillEditPatch` 应用结果非空校验、防空转（改了等于没改）、frontmatter 合法性、体积上限
   `TEAM_SKILL_MAX_CONTENT_CHARS`、git 冲突标记、`looksLikeInjection`——七道闸门一次性拿到，人工编辑和
   AI 编辑走同一套底线,不会出现「人工能绕过 AI 绕不过的坑」的不一致。
3. 校验通过后调用现成的 `repository.promote()`（`team-skill.ts:77-125`）生成新版本，
   `createdByKind: "human"`、`sourceKind` **保留原技能的既有值不覆盖**（内容血统不因为这次是人改的就
   谎称「原创」——若技能本来是 AI 蒸馏的，人工精修一版仍然写 `distilled`，只是 `created_by_kind` 从
   `ai` 变成 `human`，这两个字段本来就是分开记录「从哪来」和「谁点的这一下」两件事）。`samples_json` 写
   `{refined_from_version, ops: appliedOps, rationale_md, edited_by_user_id: actor.userId}`——照抄
   `agent-skill-curation.ts:171-175` 的既有写法，只多一个 `edited_by_user_id` 字段区分人工/AI 精修
   （前端展示时据此判断，不需要新列）。
4. 审计：照 `agent-skill-curation.ts:112-121` 的 `auditSkillCurationAction` 同款接一条
   `action: "team_skill.manually_edited"`，`actorKind: "human"`，把「谁在什么时候手动改了哪个技能」
   落进已有的 `audit_logs`（不新建审计机制）。

**为什么不对用户记忆也套用同一个 K2 ops 结构：** K2 的段落级 ops（`## 标题` 分节）假设的是结构化的
`SKILL.md` 多段文档；`user_memories.value_md` 是一句话到几段话的自由文本偏好描述（`correctionFromReview`
截断在 400 字），没有「段落」这个结构可切。强套 ops 结构会逼用户为了改一句话去构造一个只有一个
`modify_section` 的假补丁，纯粹增加交互摩擦而没有对应的收益（K2 的核心价值——爆炸半径可控的段落级
diff——对一句话文本没有意义）。本设计对用户记忆保留「整段替换 + 乐观并发」的简单模型，但仍然借了 K2 的
两条纪律：**校验闸门复用**（`looksLikeInjection`）+ **base 版本乐观并发**（`expected_updated_at` 对应
K2 的 `base_version`，形式不同，防撞车的功能等价）——这是本设计对 00-plan「PATCH 走受限编辑补丁模式沿
K2 纪律」的落地方式：纪律精神照搬，结构不强行套用到不匹配的数据形状上。

### 3.3 服务端错误类

新增 `UserMemoryGovernanceServiceError`/`TeamSkillGovernanceServiceError`（各自 `status`/`code`/
`message`，照 `apps/api/src/services/memory-conflicts.ts:14-19` 的 `MemoryConflictServiceError` 模板）。
**集成者必须在 `apps/api/src/app.ts:272` 的 `onError` 里补两个 `instanceof` 分支**——这里不是通用兜底
（`apps/api/src/app.ts:406-431` 附近可见，`UserAvatarServiceError`/`UserProfileServiceError` 等每个都是
单独手写的 `if` 块），漏了会被压成没有语义码的 500，前端拿不到 `403`/`409` 的具体 `code` 做出对应文案。

## 4. 契约（新文件，additive）

`packages/contracts/src/pages.ts` 新增（与既有 `teamSkillVmSchema` 相邻）：
- `userMemoryManagementItemVmSchema`：`id`/`category`/`key`/`value_md`/`confidence`/`workspace_scoped`
  （bool，`workspace_id!==null`）/`created_at`/`updated_at`/`last_used_at?`/`edited_at?`/
  `provenance?:{kind:"agent_run"|"review_correction", label?, run_id?, conversation_id?, proposal_id?}`。
- `userMemoryManagementPageVmSchema`：`{generated_at, memories:[...], totals:{active}}`。
- `teamSkillManagementItemVmSchema`：在既有 `teamSkillVmSchema` 基础上加 `id`/`content_md`/`status`/
  `deprecated_reason?`/`deprecated_at?`/`source_run_id?`（历史遗留，允许出现但前端不展示——诚实反映
  schema，不因为「用不上」就在契约层隐藏一个可能非空的列；本设计已论证它现在恒为 NULL，但契约不该替
  未来的写路径打包票）。
- `teamSkillManagementPageVmSchema`：`{generated_at, skills:[...]}`。
- `patchUserMemoryRequestSchema`：`{value_md: z.string().min(1).max(2000), expected_updated_at: isoDateTimeSchema}`。
- `patchTeamSkillRequestSchema`：`{ops: z.array(skillEditOpSchema).min(1).max(TEAM_SKILL_MAX_EDIT_OPS),
  base_version: z.number().int().positive(), rationale_md: z.string().optional()}`（直接复用
  `packages/contracts/src/domain/team-skill.ts:98-106` 的 `skillEditOpSchema`，不重新定义）。

不新建独立的 `memory-governance.ts` domain 文件——这批的 VM 是「页面组合」性质（列表+详情+统计），跟
`teamSkillVmSchema` 已经落座 `pages.ts` 的先例一致；两个实体各自的底层记录 schema
（`userMemoryRecordSchema`/`teamSkillRecordSchema`）已经在 `domain/user-memory.ts`/`domain/team-skill.ts`
存在，管理面 VM 是在其基础上做视图投影，不是重新定义领域模型。

## 5. 管理员判定

复用现状：`actor.isAdmin`（`apps/api/src/middleware/auth.ts:44-53` `AuthActor.isAdmin`，由
`createHumanActor`/`resolveHumanActor`（:298-330）从 `user.isAdmin` 直接透传——这是 **`users` 表上的全局
布尔列**（`packages/db/src/schema/core.ts:118` `isAdmin: boolean("is_admin")`），**不是**
`workspace_memberships.role`（`packages/db/src/repositories/memberships.ts:12`
`MembershipRole = "member"|"admin"|"owner"`——这个字段目前只用于展示工作台成员角色
`apps/api/src/services/workbench-pages.ts:129-158`，没有任何权限判定读它）。全仓库既有的 admin 门槛
（`apps/api/src/services/approvals.ts:1298,1337`、`drive-pages.ts:348`、`action-cards.ts:95-96`）全部走
`actor.isAdmin` 这一条路径，本批的团队技能编辑/停用端点照此口径，**不要**误用
`workspace_memberships.role==='admin'`（那是另一套目前是摆设的字段，混用会做出一个全仓库唯一、行为不一致
的权限判定点）。

## 6. 前端（web + 桌面两路，Wave 2）

### 6.1 web

新路由 `key: "memory"`，路径建议 `/settings/memory`（挂在 `/settings` 之下呼应「设置区」措辞，不是像
`/dashboard/skills` 那样另立门户——现有 `/settings` 本身就是本批要旁挂的落点）。需要同步改的文件（照
CHAT/AVATAR 批已知的坑位）：
- `apps/web/src/routes.ts`：`shellPageOrder`（:489-508）加 `"memory"`；`shellDefaultRoutes`（:518-537）
  加 `memory: "/settings/memory"`；`shellPageTitles`（zh :539-560 / en :561-580）各加一行；顶部
  `GoldPathRenderedPage["key"]` 联合类型（`packages/ui/src/gold-path/route-components.ts:4525-4544`
  附近 `WebRouteComponentInput`）加 `{key:"memory"; memory: {userMemories, teamSkills}}` 变体；正则/
  pattern 注册表（`routes.ts` 里 `skills`/`settings` 那批 `{key, pattern, apiBaseLabel, regex}` 条目旁边）
  加一条。
- `packages/ui/src/gold-path/product-shell.ts:428-439`：`productNavGroups` 里给 `memory` 选一个分组——
  **不要**塞进 `adminOnly:true` 的 `admin` 组（团队技能 tab 虽然编辑要管理员，但整个页面对普通成员也要
  可读只读，塞进 admin 组会让普通成员连「关于我」都点不到导航入口，虽然直接改 URL 仍能访问但发现性为
  零）；建议放进 `team`（:437，`collapsible:true`，已经装了 notifications/calendar/health 这类「个人+
  团队」混合可见性的页面，语义最贴近）。
- `apps/web/src/routes.test.ts`：文档里提到的「728」是既有路由总数断言，新增路由后这个数字要跟着改——
  施工者需先跑一遍现有测试确认当前实际断言值（不要凭记忆里的旧数字硬编，本侦察未逐行验证这个具体数字，
  只确认了"存在这类计数断言、历史上踩过坑"这件事，交给施工阶段用测试失败信息核实）。
- i18n：`packages/ui/src/gold-path/i18n.ts` 加 `nav.memory`/`masthead.memory` 等 key（照 `nav.skills`
  `route-components.ts` 里 zh/en 两份的既有格式）。

页面渲染沿用 `renderSettingsMyProfileCard`/`renderSettingsAiAssistantCard` 那套「服务端渲染 disabled
skeleton + `apps/web/src/browser.ts` 里的 `bindXxxPanel` 拉取真值后解禁」水合竞态收口纪律
（`route-components.ts:4382-4394` 注释里写明的模式），不要用会闪烁假数据的写法。两个 tab 用简单的
`<nav role="tablist">` + query param `?tab=profile|skills` 切换（默认 `profile`），不引入新的路由 key
分裂两个页面——两个 tab 共享同一个「设置区」外壳与返回路径。

### 6.2 桌面 Spotlight

**不要**把记忆管理塞进现有 `createSettingsView()`（`apps/desktop-webview/src/spotlight/views/settings.ts`）
的 `settingsHtml()` 内联区块——那个视图已经装了语言/运行状态/AI 助手/头像/资料五个分区，管理面是
列表+详情+编辑的多层交互（同 `drive.ts`/`proposals.ts` 那种「list→detail」结构），硬塞进同一个
`innerHTML` 全量重绘的扁平区块会让交互状态机复杂到失控。

改为**新增一个独立 Spotlight 能力视图** `id: "memory"`：
- `apps/desktop-webview/src/command-palette.ts:9-` 的 `CommandId` 联合类型加 `"memory"`；参照 `:152-157`
  `settings` 命令条目的写法（`keywords`/`action`）加一条「Cuu 的记忆」命令（`action: {kind:
  "open-window", target: "memory"}` 或直接内联，视 `open-window` vs 内联能力的既有分工而定——`settings`
  本身是 `open-window`，说明设置类走独立窗口，本视图若要保持「设置区旁挂」的产品语义，也应该是
  `open-window` 而非普通能力网格项，但具体走哪条要看施工时 `open-window` target 的路由能力是否支持
  tab 深链，这里留给施工阶段判断，不预先武断）。
- `apps/desktop-webview/src/spotlight/registry.ts:26-42` 的 `builtViews` 加 `memory: createMemoryView`。
- 新文件 `apps/desktop-webview/src/spotlight/views/memory.ts`，实现 `SpotlightCapabilityView`
  （契约见 `view-context.ts:47-53`）：mount 时先渲 tab 切换头（关于我/团队技能，`ctx.setSubtitle`
  显示当前 tab），list→detail 用 `ctx.body.innerHTML` 重绘（同 `drive.ts` 既有模式）。
- **入口挂载点**：在 `settings.ts` 的 `settingsHtml()`（:251-279）里加一行普通的导航 row（同 :265-270
  「桌面客户端」那种纯展示 row 的样式，但可点击），点击后调 `ctx.open("memory")`（`view-context.ts:28`
  的 `open(id, target?)` 跨能力跳转 API），这样「从设置区能找到记忆管理」的产品语义（00-plan 措辞「落点
  在 R13 批 P3 的 AI 分区旁」）靠一个跳转链接实现，而不是真把内容塞进同一个视图对象里。

删除/停用的二次确认**不用 `window.confirm()`**（这套 UI 语言里没见到原生弹窗，统一走「点击一次进入
`armed` 态、限时窗口内再点一次才真正触发」的既有模式——参照
`apps/desktop-webview/src/workbench/drive/render.ts:155-201` 和 `side-panel.ts:43-77` 的
`armedVersionId`/`armedRollbackTimer` 写法：第一次点删除按钮，按钮变成警示样式并显示「确定删除？Cuu 将
忘记这条」的提示行 + 一个几秒自动回退的定时器；限时窗口内再点一次才真正发 `DELETE`/`deactivate`
请求）。web 端同款文案，UI 载体可以是按钮态切换或者一个轻量确认行，同样不用原生 `confirm()`。

## 7. 施工切片

| 工包 | 分支 | 模型 | 范围 | 围栏 |
|---|---|---|---|---|
| W-A mem-server | r14/mem-server | opus | 迁移 0057 + 两个仓库新方法（用户记忆 `getForUser`/`updateValueForUser`，团队技能 `getById`）+ 两个 service（含两个 ServiceError 类）+ 两个路由文件（不挂载）+ 契约 6 个 schema + 测试 | 只动 `packages/db/src/{schema,repositories}`、`apps/api/src/{services,routes}`、`packages/contracts/src/pages.ts`；不碰 `app.ts`/`openapi.ts` |
| W-B web-memory-page | r14/mem-web | sonnet | `/settings/memory` 路由注册 + 页面渲染 + 两 tab 交互 + i18n + routes.test 计数同步 | 只动 `apps/web/src/routes.ts`、`apps/web/src/routes.test.ts`、`packages/ui/src/gold-path/{route-components,product-shell,i18n}.ts`；等 W-A 的契约类型落地后再发车（类型依赖，不是运行时依赖，可并行写但最后要对齐一次类型） |
| W-C desktop-memory-view | r14/mem-desktop | sonnet | 新 Spotlight 能力视图 + command-palette 注册 + registry 接线 + settings.ts 入口 row | **只许动 `apps/desktop-webview/src/{command-palette.ts, spotlight/**}`——`apps/desktop-webview/src/workbench/**` 当前有其他 agent 在动（据任务背景），本工包不得触碰该目录任何文件** |

冲突磁铁（集成者手解，照 CHAT 批同款清单）：`app.ts` 两处 `onError instanceof` 分支 + 两处路由挂载、
`openapi.ts` 四条新路径文档、`app.test.ts` 路由白名单、`packages/db/src/schema.test.ts` journal 尾断言
（0056，SEARCH 批顺延 0057）、`packages/contracts/src/index.ts`（若新增
独立 domain 文件才需要，本设计选择不新增，大概率不触发这条）。全量门=各包 test+typecheck+迁移链 scratch
真库 0000→0056+CI 逐 job 核（同 04 手册纪律）。

## 8. 本设计明确不做（防范围漂移）

- 团队技能回滚 HTTP 端点（仓库方法已存在，未点名不建，见 §2.2）。
- 提案深链校验后跳转（出处里的 `proposal:` 反解只给文字说明，不做可点击深链的存在性校验）。
- 用户记忆「回收站」视图（软删后即从管理面消失，不做可恢复的已删除列表）。
- 管理员审计他人用户记忆（用户记忆管理面严格本人可见，不因为「有 isAdmin」就顺手加一个跨用户视图）。
- 记忆冲突（`memory_conflicts` 表）管理面——那是另一套既有流程（`apps/api/src/services/
  memory-conflicts.ts`），有自己的 `resolve` 交互，不在本批「列表/编辑/删除/停用」的字面范围内，混进来
  会让本批边界失控。
