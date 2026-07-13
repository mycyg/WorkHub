# R13 批 A2 完成汇报（派人推荐 v2）

日期: 2026-07-13 · 执行: Claude · 分支: `r13/a2-assignee-v2`（基线 `origin/main @ 20386a92`）
来源: `r13-workbench-refinement/01-new-batches-design.md` 第四节「批 A2 · 派人推荐 v2」+ 用户当次拍板
（不加轮转/公平性惩罚因子；历史交付只算给 `role='lead'`；点名优先语义铁律）。
迁移编号：**0052_user_profiles_title.sql**（按用户指令覆盖设计稿草稿的 0048——0048/0049 已被 G1/S3
占用且已合 main，0050/0051 留给这个 worktree 看不到的其它并行批次，跳过不占用）。

## 一句话

`user_profiles` 此前是零接线死表（有列无代码）——补齐 `title` 字段 + repository/contracts/
service/route 四层实现，让观察者派活时能参考"资料完整度 + 历史交付量（对数尺度）+ 近期性衰减 +
技能标签重合度"打分的候选名单，而不是纯裸奔瞎猜昵称；点名优先语义不回归（补了专门的对抗测试）。

## 做了什么

### 1. 数据模型

- `packages/db/migrations/0052_user_profiles_title.sql`：`user_profiles` 加 `title varchar(128)`
  （可空，历史行不受影响）。`packages/db/migrations/meta/_journal.json` 追加 `idx:52` 条目（`idx:50/51`
  留空给并行批次，这个 worktree 里看不到那两份迁移）。
- `packages/db/src/schema/core.ts`：`userProfiles` 表加 `title` 列。
- `packages/db/src/schema.test.ts`："migration journal ends with 0049 personal projects" 改名/
  改断言为 "…ends with 0052 user profiles title"（本批新增迁移导致 journal 尾必然前移，同
  0046→0047→0049 落地时的既有先例，不是迁就实现的断言篡改）+ 新增一条 0052 迁移内容/schema 列属性
  断言。

### 2. 仓库层（新文件 `packages/db/src/repositories/user-profiles.ts`）

- `findByUserId(userId)`：单行读取。
- `upsert({userId, patch, at})`：`insert...onConflictDoUpdate`（target=`user_profiles_user_id_uq`
  既有唯一索引），只更新 patch 里显式出现的字段；空 patch/未知字段分别抛
  `UserProfileEmptyPatchError`/`UserProfileInvalidPatchError`。
- `listCandidatesForProject({projectId, limit})`：单条聚合 SQL——`projects` → `workspace_memberships`
  （active 成员）→ left join `userProfiles`（资料）→ left join `workItemAssignments`（`role='lead'`
  过滤）→ left join `workItems`（同项目）→ left join `acceptedDeliverableChanges`，`group by` 出
  `{userId, nickname, title, bioMd, skillTags, acceptedDeliverableCount, lastAcceptedAt}`。带 limit
  上限（默认 50，硬顶 200，非法值抛 `UserProfileRepositoryInputError`），不在循环里发查询（04 铁律#4）。
  **一个可复核的范围选择，非设计文档强制**：候选池（谁能被推荐）是"项目所在工作区的全体 active
  成员"，但"历史交付得怎么样"限定在**这个项目自己**的交付记录内（`work_items.project_id = 目标
  project`），不是这人在工作区其它项目的全量战绩——理由见文件顶部注释，如实记录供后续判断是否需要
  改成工作区全量。
- 导出到 `packages/db/src/index.ts`（barrel export，供 `@workhub/db` 消费方使用）。
- 新增测试 `packages/db/src/user-profiles-repository.test.ts`（8 条，假 DB query-recorder 风格，
  同 `ai-settings.test.ts` 既有套路）：findByUserId 命中/未命中、upsert 插入值/onConflict
  set 只含被改字段/空 patch 拒绝/未知字段拒绝、listCandidatesForProject 的 join/where/limit 断言 +
  limit 边界（0/500/1.5 全拒）。

### 3. 契约层（新文件 `packages/contracts/src/domain/user-profile.ts`）

- `userProfileVmSchema{user_id, nickname, title, bio_md, skill_tags, onboarded_at}`（`.strict()`）。
- `patchUserProfileRequestSchema{title?, bio_md?, skill_tags?}`（`.strict()` + 至少一个字段的
  refine；title/bio_md 用 `null` 显式清空，空字符串直接拒绝——逼用户走 null 语义，不留"空字符串算不算
  清空"的歧义）。
- **不复用**`packages/contracts/src/domain/identity.ts` 里已存在但全仓库零引用的
  `userProfileSchema`/`UserProfile`（那是原样镜像 DB 行的另一份死契约，无 `title` 字段，命名相似但
  是两个从未使用过的东西）——独立设计，避免把两份从未被用过的契约绞在一起（见文件顶部注释，identity.ts
  本身不在本批范围内，未触碰，只在报告里点出这条既有的重名死代码，供后续判断是否要清理）。
- 导出到 `packages/contracts/src/index.ts`。
- 新增测试 `packages/contracts/src/user-profile.test.ts`（10 条）：VM strict/nullable/cap 边界，
  patch 的部分字段/清空 null/空 patch 拒绝/未知字段拒绝/空白字符串拒绝/技能标签上限。

### 4. API 服务层与路由（新文件）

- `apps/api/src/services/user-profile.ts`：`getMyProfile`/`patchMyProfile`，`requireHumanActor`
  只要求真人 actor + 非空 `userId`（`user_profiles` 表本身不按 workspace 分区，比既有
  `ai-settings.ts` 的工作区成员校验更轻——这是"我是谁"和"AI 该怎么替我干活"两张表天生的语义差异）；
  `nickname` 直接取 `actor.label`（= `users.nickname`，同现有约定），不额外查库。
  `UserProfileServiceError`（403）为唯一自定义错误类型。
- `apps/api/src/routes/user-profile.ts`：`GET/PATCH /me/profile`，走既有
  `createCurrentUserMiddleware`/`readJsonObject` 套路，PATCH 先过 zod 校验再进服务层。
  **故意没有挂进 `app.ts`**——文件顶部写了完整挂载/OpenAPI 片段（见下「集成者缝合清单」），范围围栏
  明确禁止碰 `app.ts`/`openapi.ts`/`server.ts`/`app.test.ts`。
- 新增测试：`apps/api/src/user-profile-service.test.ts`（7 条：nickname 来自 actor、未填资料返回
  诚实 null、部分 patch 转发、null 清空、非人类/空 userId 拒绝、written-row 契约漂移报
  `InternalContractError`、仓库异常原样透传）+ `apps/api/src/user-profile-routes.test.ts`（5 条：
  未鉴权 401、GET 正常返回、PATCH 恶意/非对象/空 patch/未知字段的错误区分、PATCH 转发 payload、
  typed service error 映射状态码）——同 `ai-settings-routes.test.ts`/`ai-settings-service.test.ts`
  既有写法（假 users/devices 仓库 + 签名 cookie）。

### 5. 观察者升级（`apps/api/src/workers/conversation-observer.ts` + `packages/agent/src/observer/`）

- 新文件 `packages/agent/src/observer/assignee-scoring.ts`：纯函数 `scoreCandidate({hasProfile,
  hasTitle, acceptedDeliverableCount, daysSinceLastAccepted, skillTagOverlapWithTask}): number`——
  四项按用户拍板的取舍相加，**不含轮转/公平性惩罚因子**：资料完整度（10/5 两级）+ 历史交付量
  对数尺度（`log2(1+N)*20`，防止头部人选靠交付量垄断所有候选第一名）+ 近期性指数衰减（半衰期 30
  天，从未交付=0 分不重复惩罚）+ 技能标签重合度（`skillTagOverlapRatio`，朴素子串匹配，clamp 到
  [0,1]）。`rankCandidates` 排序 + `CANDIDATE_ROSTER_PROMPT_MAX=8`。
  新增测试 `packages/agent/src/observer/assignee-scoring.test.ts`（17 条）：单调性/对数衰减/近期性
  衰减/clamp 边界/NaN 防御/验收门 #2（5 次交付的老成员 > 零资料新人）全部穷举覆盖。
- `packages/agent/src/observer/prompt.ts`：`buildObserverUserPrompt` 新增可选入参
  `candidateRoster: ObserverCandidateRosterEntry[]`——不传/空数组时完全不新增任何 prompt 分段（对
  没有这个能力的既有调用方零影响）；候选名单渲染用**「项目经理挑人」口吻**（"你的角色是项目经理——
  给 execute/decide 条目标 suggested_assignee_nickname 时，优先看讨论里有没有人已经被明确点名……
  只有讨论里没点名，或点的名字明显不是任何真实成员时，才从下面这份名单里挑最合适的人"），呼应
  `reply-judge/prompt.ts`/`turns/prompt.ts` 已有的同一套 Cuu 角色总纲文案。名单/每人技能列表都有硬
  上限。新增 4 条测试（`observer.test.ts`）：空名单不新增分段、渲染口吻+点名优先文案、名单/技能双重
  截断。
- `conversation-observer.ts`：
  - `ConversationObserverDeps` 新增必填依赖 `userProfiles: Pick<UserProfileRepository,
    "listCandidatesForProject">`；`getDefaultConversationObserverScheduler` 注入
    `createUserProfileRepository(db)`。
  - 新增 `buildAssigneeRoster`：每次分析构建一次候选名单（任务文本近似为这批讨论的拼接文本——分析
    这一刻还没有 plan.items，没法逐条目按各自任务文本重排序，这是设计文档记录在案的简化，不是遗漏），
    同一份排序结果同时喂给 prompt 展示与 `resolveAssignee` 兜底。
  - `resolveAssignee` 改造：返回值新增 `resolvedVia: "nickname" | "roster_score" |
    "project_owner"`，**优先级顺序严格不变**——LLM 明确点名且命中真实用户 → 原样采用（不降级，
    不因为名单存在而被压过去）；没点名或点的名字查无此人 → 退化到名单里分数最高者；名单也是空
    → 维持现有"项目负责人"兜底。三者互斥，顺序写死在代码注释里。
  - `dispatchExecuteItem`/`dispatchDecideItem` 新增 `roster` 形参，透传给 `resolveAssignee`；当
    `resolvedVia === "roster_score"` 时追加一句系统消息（execute：新增一条此前不存在的
    `assignee_auto_selected` 系统事件；decide：给既有的"这件事我拿不准"系统消息追加后缀）——文案统一
    为"根据资料与历史交付选中"，对应设计稿"评分结果不神秘化"的交互要求，只在算法自选时出现，LLM
    点名/项目负责人兜底都不触发。

### 6. Web `/settings` 表单（`packages/ui/src/gold-path/route-components.ts` + `apps/web/src/browser.ts`）

现场定位：web `/settings` 页的实际渲染逻辑不在 `apps/web/src/` 里（那边只是薄薄一层 loader/路由分派），
真正的 HTML 生成在 `packages/ui/src/gold-path/route-components.ts`（`renderSettingsRouteComponent`），
按设计稿"具体既有路由组件需施工时现场定位"的指示，落点在这里而不是字面上的 `apps/web/src/`。

- `renderSettingsMyProfileCard`：新增"我的资料"卡片，紧跟既有"AI 助手"卡片之后，同一套 R10-P1-7
  水合竞态收口纪律——SSR 渲染 title/bio_md/skill_tags 三个输入为 `disabled`，由客户端水合后解禁；
  文案含"以后 Cuu 派活时会参考这些信息"的说明。
- `apps/web/src/browser.ts`：新增 `bindSettingsMyProfilePanel`，与既有 `bindSettingsAiProfilePanel`
  同款结构（GET 回填解锁/失败锁定+重试、`change` 事件触发 PATCH+乐观更新+失败回滚），已接入
  `bindReadyRoute`。
- 新增测试：`packages/ui/src/gold-path/route-components.test.ts`（1 条，同 R13-P3 AI 助手卡的既有
  测试风格：锁定态标记 + 文案）。

### 7. 桌面 Spotlight 设置视图（`apps/desktop-webview/src/spotlight/views/settings.ts` +
   `apps/desktop-webview/src/spotlight/css.ts`）

- 落点：P3 已规划的"AI 分区"旁边——`profileSectionHtml` 紧跟 `aiSectionHtml` 之后渲染。
- 三个自由文本字段（title/bio_md/skill_tags）用 **`focusout`**（不是 `click`，也不是逐字符
  `input`）触发保存——同一份 innerHTML 全量重绘架构下，`input` 事件会在用户还在打字时就把 DOM
  重建、打断输入焦点；`focusout` 意味着用户已经离开字段，此时重绘没有体验代价（同 AI 分区按钮点击
  场景一致的"交互已结束才重绘"取舍）。`focusout` 会冒泡（`blur` 不会），因此能用同一个委托监听器。
  乐观更新 + PATCH + 失败回滚，与 `patchAiProfile` 同构的 `patchProfile`。
- `css.ts` 新增 `.wh-spot-freetext--line`（单行变体，去掉 textarea 专属的
  `min-height`/`resize`），给职位头衔/技能标签这两个单行输入用，复用既有 `.wh-spot-freetext` 的
  边框/字体/焦点态，不新造一套视觉语言。
- 新增测试（`settings.test.ts`，5 条新增 + 既有 5 条全部修复兼容）：渲染当前值、focusout 改值触发
  PATCH（仅该字段）、值未变不触发 PATCH、PATCH 失败回滚+错误提示、profile fetch 失败不阻塞其余
  设置区块 + 提供独立重试。**为了让新增的并行 profile fetch 不污染既有 5 条 AI 分区测试的
  mock/计数逻辑，把这 5 条既有测试的 `client.request` 假实现改成按 path 分流**（不是改断言迁就
  实现——AI 分区那 5 条测试原本的断言/期望值一个字节都没动，只是 mock 现在需要正确处理"两个不同
  GET 端点会在同一次 mount 里被并行调用"这个新事实）。`FakeElement` 补 `value` 属性，`FakeBody`
  补 `focusout` 事件委托支持（既有 `FakeElement`/`FakeBody` 类结构不变，纯增量扩展）。

## 集成者缝合清单

### 1. `apps/api/src/app.ts`（挂载）

```ts
import { createUserProfileRoutes } from "./routes/user-profile.js";
// … 与既有 createAiSettingsRoutes() 同一批 import 分组
app.route("/api", createUserProfileRoutes());
```

挂载后端点：`GET/PATCH /api/me/profile`。

### 2. `apps/api/src/openapi.ts`（路径文档）

参照既有 `/api/me/ai-profile` 写法（`apps/api/src/openapi.ts:6707` 附近），新增：

```ts
"/api/me/profile": {
  get: {
    tags: ["user-profile"],
    summary: "Read the current user's profile (title/bio/skill tags)",
    ...jsonDataResponse(userProfileVmSchemaAsJsonSchema) // 参照既有 userAiProfileReadResponses 写法
  },
  patch: {
    tags: ["user-profile"],
    summary: "Update the current user's profile",
    ...jsonRequestBody(patchUserProfileRequestBodySchema),
    ...jsonDataResponse(userProfileVmSchemaAsJsonSchema)
  }
}
```

不需要 `pathUuidParameter`（无路径参数，同 `/api/me/ai-profile`）。

### 3. `apps/api/src/app.test.ts`（覆盖白名单）

若该文件存在"runtime API routes stay in lockstep with the OpenAPI document"一类的路由树/OpenAPI
交叉核对门（S3 批次汇报提到过这类门的存在），挂载 + 补文档必须在同一次改动里做，否则会红。

## 自查输出

```
pnpm --filter @workhub/db test           276 total / 274 pass / 0 fail / 2 skip（既有真库门，非本批引入）
pnpm --filter @workhub/api test          1186 total / 1185 pass / 0 fail / 1 skip（同上）
pnpm --filter @workhub/agent test        158 pass / 0 fail
pnpm --filter @workhub/contracts test    112 pass / 0 fail
pnpm --filter @workhub/web test          68 pass / 0 fail
pnpm --filter @workhub/ui test           144 pass / 0 fail（route-components.ts 在这个包里）
pnpm --filter @workhub/desktop-webview test   833 pass / 0 fail

pnpm -r typecheck                        16/16 workspace 全绿
```

新增测试合计：db 25 条（repo 8 + schema.test 1）、contracts 10 条、agent 21 条（scoring 17 +
prompt 4）、api 12 条（service 7 + route 5）+ conversation-observer.test.ts 7 条、ui 1 条、
desktop-webview 5 条。合计约 81 条新单测，全部纯函数/假仓库/假 DB query-recorder 风格，无需真 PG。

## 我改过的断言（如有）

- `packages/db/src/schema.test.ts`："migration journal ends with 0049 personal projects" 改名为
  "…ends with 0052 user profiles title"，`idx`/`tag` 期望值从 49 改到 52——本批新增迁移导致的
  必然更新（这条测试的设计意图就是锁住 journal 尾，每次新迁移落地都要跟着挪一格），不是迁就实现的
  断言篡改。
- `apps/desktop-webview/src/spotlight/views/settings.test.ts`：既有 5 条测试的 `client.request`
  假实现从"无条件返回同一个 AI profile"或"按 method 分流"改成"先按 path 判断是否是
  `/api/me/profile`，否则落回原有逻辑"——原因见上文第 7 节末尾。所有原有断言的期望值本身未改动
  一个字节，只是让 mock 正确处理了"现在一次 mount 会并行发两个不同 GET"这个新事实。

## 范围外发现（不修，只报）

- `packages/contracts/src/domain/identity.ts` 里的 `userProfileSchema`/`UserProfile`
  是一份此前就存在、全仓库零引用的死契约（原样镜像 `user_profiles` DB 行，无 `title` 字段），与本批
  新建的 `userProfileVmSchema`/`UserProfileVM`（`domain/user-profile.ts`）命名相似但是两个独立、
  互不引用的类型。`identity.ts` 不在本批范围围栏内，未触碰；建议后续单独判断这份死契约是否该删除
  或与本批的 VM 合并。
- `apps/api/src/workers/conversation-observer.ts` 的 `buildObserverUserPrompt` 调用点一直把
  `candidate.projectId`（一个 UUID）传给 `projectName` 形参（`content: buildObserverUserPrompt({
  projectName: candidate.projectId, …})`）——这是本批之前就存在的既有代码，看起来像是"本该传项目
  名字却传了项目 ID"的疏漏，但不在本批改动范围内（不属于 A2 的施工文件清单），如实记录不修。

## 没做/存疑

- **`listCandidatesForProject` 的历史交付信号范围**是"该项目自己的交付记录"而非"该用户在整个
  工作区的全量交付战绩"——是一个可复核但未与用户再次确认的实现选择（见上文第 2 节），设计稿本身对
  这一点没有明确到字面级别。如果产品意图是"看这个人整体是否靠谱"而非"看他在这个项目里是否靠谱"，
  这里需要改成按 workspace 而不是按 project 聚合，改动集中在
  `packages/db/src/repositories/user-profiles.ts` 一处 SQL。
- **用户已明确拍板不做**（非缺口，如实记录避免被误读为遗漏）：不加轮转/公平性惩罚因子——`scoreCandidate`
  的四项都是设计稿"待拍板"清单里已经拍定的部分，"防止头部人选垄断所有新任务"的轮转项设计稿原文
  就没要求做。
- **未做真机/预览验证**：本批全程只跑了单测 + typecheck，没有起真实 Tauri 客户端或浏览器预览手验
  Web `/settings`"我的资料"卡片、桌面 Spotlight 设置视图的实际渲染/交互效果（同 R12/R13 多个批次的
  既有惯例）。
- **观察者候选名单的技能重合度是"朴素子串匹配"**（设计稿原话"朴素重合度"）——不做分词/embedding，
  短技能标签如果恰好是任务文本里某个更长单词的子串会有假阳性（如候选技能"go"会被"讨论"这类恰好包含
  "go"子串的英文词命中，虽然中文任务文本触发这个边界情况的概率很低）；如实记录，未做加固。
