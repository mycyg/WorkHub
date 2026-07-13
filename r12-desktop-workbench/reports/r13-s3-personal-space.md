# R13 批 S3 完成汇报（个人空间）

日期: 2026-07-13 · 执行: Claude · 分支: `r13/s3-personal-space`（基线 `63aa2bae feat(r13): mount the
spotlight intent route`，拉自 `origin/main`，与 `main` 完全同步）
来源: `r13-workbench-refinement/01-new-batches-design.md` 第五节「批 S3 · 个人空间」+ 用户当次拍板
（个人空间 60s 观察者默认关；不做跨工作区统一视图）。
迁移编号：**0049_personal_projects.sql**（0048 留给并行批次，未占用）。

## 一句话

个人空间 = `projects.is_personal=true` 且 `owner_user_id=自己` 的一条普通 `projects` 行——主区会话/
网盘/工单全链路零改动直接复用；只加了三件真正新的东西：`is_personal` 列本身、"个人空间只对 owner 可见"
的 fail-closed 会话可见性条件（设计稿原以为"沿用现有鉴权链路"就够，实测并不够——见下）、以及桌面 rail
的「我的空间」独立分组。

## 做了什么

### 1. 数据模型

- `packages/db/migrations/0049_personal_projects.sql`：`projects` 加 `is_personal boolean not null
  default false` + 部分索引 `projects_personal_owner_idx on (owner_user_id) where is_personal`。
  `packages/db/migrations/meta/_journal.json` 追加 `idx:49` 条目（`idx:48` 留空给并行批次，这个
  worktree 里看不到那份迁移，两批 journal 尾在合并时由人工拼接，不是本测试要处理的事——见
  `packages/db/src/schema.test.ts` 里被相应改名的「migration journal ends with 0049 personal
  projects」测试的顶部注释）。
- `packages/db/src/schema/core.ts`：`projects` 表加 `isPersonal` 列 + 索引定义。

### 2. 仓库层（`packages/db/src/repositories/projects.ts`）

- `listForWorkspace`（团队项目列表）加 `eq(projects.isPersonal, false)` 过滤——个人空间从此不会混进
  团队项目列表/项目下拉选择器。
- 新增 `listPersonalForUser({workspaceId, ownerUserId})`：只回该用户名下、当前工作区内
  `is_personal=true` 的项目，按创建时间升序（「我的空间」在「我的空间 2」之前）。
- 新增 `bootstrapPersonalProject`：**不复用** `bootstrapPilotProject` 的 org/workspace upsert 与
  find-or-reuse 幂等语义——个人空间总是新建一条（用户点一次「+新建个人空间」就该多一个空间），slug
  撞车直接报「标识被占用」而不是静默复用别的项目。同一事务内：插入 `projects` 行 → 复用既有
  `ensureActiveMain` 建主区会话 → **新增** `ensurePersonalGovernanceOff`：插入一条
  `project_ai_governance` 行且 `observer_enabled=false`（用户拍板：个人空间 60s 观察者默认关；不插
  这行的话，读侧既有的 `coalesce(observer_enabled, true)` fallback 会把它当成开着，见
  `action-cards.ts`）。治理页仍可手动开（走既有 `upsertProjectGovernance`，未改）。

### 3. 会话可见性 fail-closed 加固（`packages/db/src/repositories/conversations.ts`）—— **设计稿的
一处乐观假设被证伪，这是本批唯一的真安全修复**

设计稿 §3 原话：「个人空间的工单/网盘/提议天然只有 owner 一人可见（沿用现有
`project→workspaceMembership` 鉴权链路……不需要新写权限代码）」。实测这个假设**不成立**：
`activeConversationCondition`/`readActiveProjectMembership`（`conversations.ts`）与 `findWorkbenchAccess`
（`packages/db/src/repositories/workbench.ts`）对"能不能看到一个项目"的判定是**纯工作区成员资格**——
这个仓库当前没有项目级成员模型，工作区里任何人都能看到工作区里的每一个项目。这意味着不加任何东西的话，
同事 B 打开 A 的个人空间主区聊天/翻消息/发协同会话，会像打开任何一个团队项目一样成功。

修复（都在已被 04 铁律范围围栏明确允许触碰的 `conversations.ts`，"conversations 若需"）：

- `activeConversationCondition`（被 `readVisibleAccess`/`listMessagesAfter`/`listMessagesBefore`/
  `listVisibleForProject` 的行查询共用同一份）加一条
  `or(eq(projects.isPersonal, false), eq(projects.ownerUserId, viewerUserId))`——个人空间只对 owner
  可见，团队项目（`is_personal=false`）这个条件恒真，行为完全不变。
- `readActiveProjectMembership`（`listVisibleForProject` 的前置判权）加同一条件——非 owner 在这一步
  就会被挡下（返回 null → 上层 `ConversationServiceError(404, "conversation_project_not_found")` →
  `workbench-pages.ts` 已有的 catch 分支转成 `workbench_not_found` 404），不会等到走进行查询、拿到
  0 条会话，再撞 `workbenchPageVmSchema` 的「必须恰好一个 main 会话」不变式而崩成 500。
- `lockActiveProject`（`createCollab` 建协同会话的锁）select 里带出 `isPersonal`，`createCollab`
  在拿到锁之后追加：`if (project.isPersonal && project.projectOwnerUserId !== creatorUserId)` →
  抛 `ConversationAccessDeniedError`（映射到既有的 404 `conversation_not_found`）——即便发起人是正常
  工作区成员，也不能在别人的个人空间下新建协同会话，落实「个人空间成员语义=仅本人」。
- 单测：`packages/db/src/conversation-repository.test.ts` 新增 2 条行为测试（非 owner 建群被拒 /
  owner 自己建群放行）+ 把 `isPersonal`/`ownerUserId` 的谓词检查揉进 `assertFullConversationAccessPredicates`
  共享断言（`replace_all` 改法，一次锁死单会话/消息翻页/项目内列表四处查询都必须带这条件，不是只补
  一处漏掉别处）。

### 4. 契约（`packages/contracts/src/domain/project.ts`）—— additive

- `projectVmSchema` 加 `is_personal: z.boolean().optional()`（省略/false=团队项目，true=个人空间；
  非 strict schema，纯新增可选字段，不影响任何既有 fixture/客户端）。
- 新增 `createPersonalProjectRequestSchema{name?}`（名字可省略，服务端自动命名）。
- 新增 `createPersonalProjectResultSchema`/`CreatePersonalProjectResult`——直接复用
  `bootstrapProjectResultSchema` 的形状（`{project, created, context_ready:true}`），个人空间创建
  语义上和团队项目 bootstrap 完全一致（建好即可用），不另开一份契约。
- 新增 `packages/contracts/src/project.test.ts`（3 条）：additive 兼容性 + 请求 schema 边界。

### 5. API 服务层（`apps/api/src/services/projects.ts`）

- `toProjectVm`/`toProjectListItemVm` 把 `is_personal` 从仓库行透传进 VM。
- 新增 `createPersonalProject`：先 `listPersonalForUser` 数出已有几个，名字缺省时按
  `nextPersonalProjectName`（0 个→「我的空间」，N 个→「我的空间 N+1」，同 rail.ts
  `nextCollabConversationTitle` 的既有取舍——不追求全局强一致，两次几乎同时创建可能撞同一序号，不影响
  可用性）。slug 用 `personal-${ownerUserId}-${timestamp base36}`（内部标识，rail.ts 只渲染
  `name`，不展示 slug；不用 `slugFromName(name)` 是因为默认名是纯中文，会退化成对纯中文文本取哈希，
  和"同一用户可以建多个默认同名个人空间"这条需求在语义上纠缠）。
- 新增 `listPersonalProjects`：workspaceId 用 actor 当前活跃工作区（用户拍板：不做跨工作区统一视图，
  多工作区用户在各自工作区里各有一批个人空间）。

### 6. API 路由——**故意没有挂进 `app.ts`**

- 新文件 `apps/api/src/routes/personal-projects.ts`：`createPersonalProjectRoutes()`，
  `GET`/`POST /me/personal-projects`（与既有 `/me/ai-profile`、`/me/army` 同一个前缀风格）。
  文件顶部写了完整挂载清单（见下「挂载清单」一节）。
  **这不是"假接线"**——路由器本身是完整、可测的真实现（`apps/api/src/personal-projects.test.ts`
  7 条测试直接拼一个最小 Hono app 挂载它验证真实行为，同 `projects.test.ts` 的既有测试写法），只是
  运行时的 `app` 对象暂时访问不到它。
  **踩雷记录**：最初我把这两个端点直接塞进已经被 `app.ts` 挂载的 `routes/projects.ts`（想避免碰
  `app.ts`），但这样端点在运行时立刻变成真实可达，而 `apps/api/src/app.test.ts` 里有一条
  「runtime API routes stay in lockstep with the OpenAPI document」的门——它内省 `app` 的真实路由树
  和 `openapi.ts` 声明做交叉核对，新增的运行时端点没有对应的 OpenAPI 描述会直接判定为 drift 并让这条
  测试变红。这条门恰恰解释了为什么范围围栏要求「禁碰 app.ts/openapi.ts」——这两个文件必须在同一次改动
  里一起更新，否则要么留白（我这次的做法），要么就得跟着一起改（越权）。回退成独立未挂载文件后这条门
  照常绿。

## 桌面端（`apps/desktop-webview/src/workbench/`）

- `rail.ts`：
  - 把项目行/树叶渲染从 `renderProjectTreeHtml` 的 `.map()` 里提出来一个纯函数
    `renderProjectRowHtml`（提取前后逐字节相同行为），供团队项目分组与新的「我的空间」分组共用——
    两个分组每一行长得完全一样（选中态/树叶/项目设置齿轮同一套规则），只是数据源和分组标题不同。
  - 新增 `renderPersonalSpaceSectionHtml`：rail 顶部独立分组（标题「我的空间」，class
    `wh-wb-rail-head--personal` 做视觉挂钩），数据源是 `store.personalProjects`（互斥于团队项目的
    `store.projects`，服务端两个端点各自过滤，前端不再去重/二次过滤），末尾一个真实的「+新建个人
    空间」入口。
  - 新增 `renderNewPersonalSpaceModalHtml`：独立于团队项目模态的简化版——只填名字（可留空，提交按钮
    不像团队项目模态那样要求非空才可点），文案不提团队语境（无「全员可聊」「成员邀请」），点明「个人
    空间只有你自己能看到……跳过团队邀请与治理设置」。
  - `mountWorkbenchRail`：新增 `loadPersonalProjects`（`client.request<...>("/api/me/personal-projects")`）
    与 `submitNewPersonalSpace`（POST 同一路径，`client.request` 而非新增 `WorkHubApiClient` 具名
    方法——同 `createCollabConversation` 顶部注释的既有取舍），挂载时与团队项目列表一起拉取，点击/
    输入事件路由（`data-wb-new-personal-space*`）接入既有 click/input 委托监听器。选中个人空间项目
    复用同一个 `onSelectProject` 回调——不需要 shell.ts 新增任何分支（选中之后走的还是既有
    workbench VM 拉取路径）。
- `store.ts`：新增 `personalProjects`/`personalProjectsLoad`/`newPersonalSpaceModalOpen` 三个字段，
  初始态与既有字段同款（空数组/`idle`/`false`）。
- `shell.ts`：**零改动**——selecting 一个个人空间项目复用已有的 `onSelectProject` 回调链路，不需要
  新的 centerTab 分支或新回调。

## 挂载清单（app.ts / openapi.ts，本批未碰，留给集成时一起做）

```ts
// apps/api/src/app.ts
import { createPersonalProjectRoutes } from "./routes/personal-projects.js";
// ……
app.route("/api", createPersonalProjectRoutes());
```

挂载后端点：`GET/POST /api/me/personal-projects`。同一次改动需要把这两个操作的 OpenAPI 描述补进
`apps/api/src/openapi.ts`（否则会撞 `app.test.ts` 的 lockstep 门），描述可参照 `routes/projects.ts`
既有的 `/api/projects`、`/api/projects/bootstrap` 两条写法（响应形状分别是 `projectListVmSchema`/
`bootstrapProjectResultSchema`——本批的两个端点复用同一对 VM/契约，literally 抄一遍改路径即可）。

## 改动文件清单

- `packages/db/migrations/0049_personal_projects.sql`（新增）
- `packages/db/migrations/meta/_journal.json`（追加 idx:49）
- `packages/db/src/schema/core.ts`（`projects.isPersonal` + 索引）
- `packages/db/src/repositories/projects.ts`（`listForWorkspace` 过滤 + `listPersonalForUser` +
  `bootstrapPersonalProject` + 共享查询/映射辅助函数重构）
- `packages/db/src/projects-r12.test.ts`（fixture 补 `isPersonal` + 4 条新测试）
- `packages/db/src/repositories/conversations.ts`（会话可见性 fail-closed 加固，见上）
- `packages/db/src/conversation-repository.test.ts`（2 条新行为测试 + 既有共享断言扩展）
- `packages/db/src/repositories/ai-settings.ts`（**机械补齐**：`projectSelection` 加 `isPersonal`
  列——加 NOT NULL 列牵连的编译修复，不是功能改动）
- `packages/db/src/schema.test.ts`（journal 尾测试改名/改断言到 0049）
- `packages/contracts/src/domain/project.ts`（`is_personal` 字段 + 两个新 schema）
- `packages/contracts/src/project.test.ts`（新增，3 条）
- `apps/api/src/services/projects.ts`（`createPersonalProject`/`listPersonalProjects` + VM 映射）
- `apps/api/src/routes/personal-projects.ts`（新增，未挂载）
- `apps/api/src/personal-projects.test.ts`（新增，7 条）
- `apps/api/src/projects.test.ts` / `apps/api/src/projects-slug.test.ts`（新增两个仓库/服务方法的
  fake 实现补齐）
- `apps/api/src/ai-settings-service.test.ts` / `conversation-observer.test.ts` / `drive-pages.test.ts`
  / `meeting-pages.test.ts` / `project-health-pages.test.ts` / `schedule-notify-pages.test.ts`
  （**机械补齐**：各自的 project fixture 补 `isPersonal: false`——同上，NOT NULL 加列牵连的编译修复，
  均只加一行，不改任何断言/行为）
- `apps/desktop-webview/src/workbench/rail.ts`（`renderProjectRowHtml` 提取 + `renderPersonalSpaceSectionHtml`
  + `renderNewPersonalSpaceModalHtml` + `mountWorkbenchRail` 接线）
- `apps/desktop-webview/src/workbench/rail.test.ts`（7 条新测试）
- `apps/desktop-webview/src/workbench/store.ts`（三个新字段）
- `apps/desktop-webview/src/workbench/store.test.ts`（初始态断言扩展）

## 自查输出

```
pnpm --filter @workhub/db test
  255 pass / 0 fail / 2 skip（既有真库门，无本地 PG 连接时既有行为，非本批引入）

pnpm --filter @workhub/api test
  1115 pass / 0 fail / 1 skip（同上既有真库门）

pnpm --filter @workhub/contracts test
  102 pass / 0 fail

pnpm --filter @workhub/desktop-webview test
  809 pass / 0 fail

pnpm -r typecheck
  16/16 workspace 全绿（第 17 个是 client-tauri Rust 项目，非 TS 包，不在这个命令范围内）

git status --short
  只有范围围栏内的文件被改 + 两个新文件（routes/personal-projects.ts、personal-projects.test.ts）+
  一个新契约测试文件（project.test.ts）；未 git add -A，逐个 targeted add。
```

## 我改过的断言（如有）

- `packages/db/src/schema.test.ts`：「migration journal ends with 0047 task plan status」改名为
  「migration journal ends with 0049 personal projects」并把期望的 `idx`/`tag` 从 47 改到 49——这是
  本批新增迁移导致的必然更新（这条测试的设计意图就是"锁住 journal 尾"，每次新迁移落地都要跟着挪一格，
  同 0046→0047 落地时的既有先例），不是迁就实现的断言篡改。

## 挂载清单之外的范围外发现（不修，只报）

设计稿 §4「不止一处团队级列表需要过滤」的踩雷提前预告了这类问题，我 grep 了一遍全部消费 `projects`
表的"选默认项目/全局聚合"查询，确认还有以下几处**没有**排除 `is_personal=true`（均在范围围栏之外，
未触碰）：

- `packages/db/src/repositories/drive.ts:278-301`（`findProject`，裸 `/drive` 无 `project_id` 时挑
  "最近活跃"项目）——如果用户的个人空间恰好是工作区里最近更新的项目，其他团队成员点全局「网盘」导航
  理论上会被引到它。不过就算被引导过去，`readVisibleAccess`/`findWorkbenchAccess` 这条鉴权链路本身
  在网盘页是走哪一套还需要确认（这次没有深挖 drive-pages.ts 的鉴权路径，只是定位到了这个"挑默认项目"
  函数没做 `is_personal` 过滤）。
- `packages/db/src/repositories/meetings.ts:110-127`（同款"裸 `/meetings` 挑默认项目"逻辑，同样没有
  `is_personal` 过滤）。
- `packages/db/src/repositories/work-items.ts:873-893`（`findFirstActiveProject`/
  `findFirstActiveProjectInWorkspace`，intake 兜底"随便挑一个活跃项目"）——如果个人空间恰好是最早
  创建的项目，理论上可能被选成某个 intake 兜底流程的默认落点（工单被错误地建进用户的私人空间）。
- `packages/db/src/repositories/project-health.ts:181-190`（项目健康仪表盘，管理员视角的全工作区
  项目聚合列表）——个人空间会作为一个"项目"出现在这个跨项目健康总览里，混在团队项目中间，管理员会
  看到本不该看到的个人空间条目及其健康指标。

这四处都是"挑默认/聚合展示"类查询，不是本批施工范围（`apps/api/src/pages`/`packages/db/src/repositories`
里 drive/meetings/work-items/project-health 这几个文件都不在批 S3 的范围围栏内），如实记录，建议作为
独立收尾任务处理（大概率是把 `eq(projects.isPersonal, false)` 加进这几处的 WHERE，工作量不大但涉及
文件较多，逐一验证也需要时间）。

## 没做/存疑

- **「个人空间成员语义=仅本人」的 UI 侧未完全落地**：设计稿要求"不渲染成员条邀请语义/成员数显示
  「私人」"。`workbench-pages.ts` 的 `workspace_members` 字段目前是"整个工作区的成员列表"（不是
  项目级成员——这个仓库压根没有项目级成员模型），`chat/view.ts` 会把这份列表渲染进聊天头部/@提及
  候选。要让个人空间的聊天头部显示"私人"而不是一串工作区同事的名字，需要改 `chat/view.ts`/
  `chat/render.ts`（两者都不在本批范围围栏内：范围围栏只列了 `rail.ts,store.ts,shell.ts`），本批
  没有做。功能上不影响正确性（拿到的还是 owner 自己能看到的同一份工作区成员名单，只是没有专门为
  个人空间场景做"仅本人"的特殊文案/裁剪），但离设计稿这条要求还有距离。
- **rail 的视觉区分留白**：设计稿要求「我的空间」分组"与项目树平级但视觉区分"。本批加了
  `wh-wb-rail-head--personal` 这个 CSS 挂钩类，但没有配对应的样式规则——桌面端的 CSS 定义在
  `apps/desktop-webview/src/workbench/css.ts`，不在本批范围围栏（`rail.ts,store.ts,shell.ts`）内，
  所以「我的空间」标题目前会继承 `wh-wb-rail-head` 的默认样式，视觉上和「项目」标题没有差异。功能
  完全正确（分组独立、数据源互斥、真实创建入口），只是缺少设计稿要求的视觉强调。
- **未做真机/预览验证**：本批全程只跑了单测 + typecheck，没有起真实 Tauri 客户端或浏览器预览手验
  「我的空间」分组的实际渲染效果（同 R12/R13 多个批次的既有惯例——desktop-webview 在浏览器预览里渲
  不出 Tauri 专属能力，真截图需要 `.app`）。
- **多工作区个人空间数量无上限**：`listPersonalForUser`/`bootstrapPersonalProject` 都没有对"一个
  用户能建多少个个人空间"设置硬顶——理论上可以无限点「+新建个人空间」建出大量空间。设计稿没有明确
  要求上限，且 04 铁律#4 针对的是"列表查询无上限"（`listPersonalForUser` 本身没有 limit，但个人
  空间列表只会是"该用户名下的少量项目"，量级和团队项目列表同构，不算无上限风险列表），所以没有主动
  加这个限制，如实记录供用户判断是否需要。
