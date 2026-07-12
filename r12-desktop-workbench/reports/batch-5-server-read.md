# 批 5 完成汇报(军团面板 · 服务端读侧切片)

日期: 2026-07-12 · 执行: Claude · 分支: `r12/batch5-server-read`(从 `r12/workbench-full` @ `31f022c2` 切出)

> 范围声明:这是批 5 的**只读**切片——军团面板的数据聚合。派发写路径(execute/decide 分叉、
> per-assignee 执行身份注入、成本 labor-split 记 assignee)不在这个分支,归另一个并行分支。

## 做了什么

1. `packages/db/src/repositories/conversation-runs.ts`(新):
   - `listRunsForConversation(workspaceId, viewerUserId, conversationId, {limit, cursor})` ——
     鉴权**复用** `createConversationRepository(db).findVisibleAccessRecord`(conversations 仓库同一套
     「会话可见成员」判定,不是另写一份可能漂移的等价 SQL),不可见返回 `null`(短路,不查
     `agent_runs`)。可见时按 `source_conversation_id` 拉卡片字段:id/status/goal 摘要(取
     `objective_md` 优先,回落 `title`,截 200 字+省略号)/assignee(`action_card_items.assignee_user_id`
     COALESCE `agent_runs.actor_user_id`)/成本(`cost_estimate` 直读)/最近一步(**一条相关子查询**
     `jsonb_build_object(...)` 拿 `agent_steps` 最新一行,不逐 run 再查)/`execution_hint`。默认 cap 20、
     上限 50,`(created_at, id)` 复合游标倒序分页。顺带把内部已做的这次 access 判定的
     `conversation.projectId` 一并返回给服务层用,避免服务层为了拿 project_id 再发一次查询。
   - `listArmyOverviewForUser(workspaceId, viewerUserId, {limit, cursor})` —— 「我名下+我派出」=
     `actor_user_id = viewer` OR `action_card_items.assignee_user_id = viewer` OR
     `EXISTS work_item_assignments(work_item_id, viewer)`;逐 actor 鉴权**烤进同一条 SQL**(`agent_runs`
     → `work_items` → `projects` → `workspace_memberships`(viewer 的 active membership 作为 INNER JOIN
     条件,不是查完再过滤)→ `action_card_items` LEFT JOIN),单条查询覆盖所有可见项目,不按项目
     分别发查询。同一套 cap/游标。
   - `listOutputLinksForConversation(workspaceId, conversationId, {limit})` —— 军团面板「输出区」的
     数据源:`proposals` → `branches`(`agent_run_id`)→ `agent_runs`(`source_conversation_id`),一条
     查询把这个会话下所有 run 产出的提议链接聚合出来。**设计取舍**:这个方法信任调用方已经通过
     `listRunsForConversation` 做过一次会话可见性判定(与 `services/workbench-pages.ts` 里
     `findWorkbenchAccess` 之后同页多个子读共享已验证 `projectId`/`workspaceId` 的既有先例一致),自身
     只把 `workspaceId` 写进 WHERE 做租户围栏,不重复整套成员判定——集成前请再核一遍这个假设在你的
     调用路径里成立。
   - 单测 `packages/db/src/conversation-runs-repository.test.ts`(recorder 模式,照
     `workbench-repository.test.ts`):10 条,覆盖鉴权短路(不可见时只发 1 条查询,`agent_runs`
     绝不会被摸到)、N+1 复核(会话面板 2 条查询、军团总览 1 条查询,不随返回行数增长)、cap/游标
     分页、goal 摘要回落、最近一步的畸形 JSON 防御性丢弃、输入校验(limit 越界/游标畸形在发查询前
     拒绝)。**env-gated 真 PG 矩阵未实现**(见下「缺口」),留了一个 `skip:` 占位测试指回本报告,
     不是伪测试——它 `assert.fail` 说明未实现,不会被误当已验证。
2. `packages/contracts/src/domain/cat-codename.ts`(新)+ `packages/contracts/src/cat-codename.test.ts`(新):
   - `catCodename(runId: string): string` —— FNV-1a 32 位哈希(纯 JS,无 `node:crypto`,因为
     `@workhub/contracts` 会被 `apps/desktop-webview` 的 Tauri webview 直接引入,不能假设有 node 内置
     模块)→ 对 40 个纯中文猫名词表取模。同 id 永远同名(确定性)、空串/纯空白防御性回退到词表首位
     且回退值本身稳定、200 个不同 id 至少分布到 10 个不同名字上(非常量函数的最低验证)。
3. `packages/contracts/src/pages.ts`(只增,新增于文件末尾,附「批 5」分节注释标出边界):
   - `armyRunCardVmSchema` / `armyOverviewRunCardVmSchema`(共享字段用 `armyRunCardBaseShape` 组合,
     总览款多 `project_id`/`project_name`,00 文档§4「点开是按项目分组的同款卡片流」)。
   - `armyRunRecentStepVmSchema`、`armyRunListCursorVmSchema`、`armyRunListQuerySchema`(请求侧,
     `afterCreatedAt`/`afterId`/`limit` 同 `conversationListQuerySchema` 惯例,cap 收紧到 1..50、默认 20)。
   - `conversationArmyRunListVmSchema` / `armyOverviewRunListVmSchema`(`buildArmyRunListVmSchema` 工厂
     函数生成,`capped`⇔`next_cursor` 非空、`runs` 为空⇔`empty_state="no_army_runs"` 两条不变式各自
     `superRefine` 校验)。
   - `armyOutputLinkVmSchema`/`armyOutputsVmSchema`(输出区,`proposal_href` 复用仓库既有
     `/proposals/${id}` 约定)。
   - `armyBackgroundTasksVmSchema` —— **`items` schema 层钉死 `.max(0)`**,`empty_state` 钉死字面量
     `"not_yet_available"`。这不是漏做,是刻意的诚实占位:02 计划批 5 节原话「后台任务只有在本批
     补齐/确认真实 scheduled-task 数据模型与项目归属后才可加入,不得拿 background_jobs、schedule
     events 或项目最近文件冒充」——这批没有这样一个数据源,schema 本身就不允许塞假数据进去。
   - `conversationArmyPanelVmSchema`(`GET /conversations/:id/army` 的顶层 VM,`runs`/`outputs`/
     `background_tasks` 三区,外加一条不变式:`runs` 里每张卡的 `source_conversation_id` 若非空必须
     等于面板自己的 `conversation_id`)、`armyOverviewPageVmSchema`(`GET /me/army` 顶层 VM)。
   - import 侧只做了两处**追加**:`enums.js` 多导入 `agentStepPhaseSchema`,`domain/conversation.js`
     多导入 `executionHintSchema`;都是给已有 import 语句加一个具名导入,没有删改任何既有导出。
4. `apps/api/src/services/conversation-army.ts`(新)+ `.test.ts`(新,8 条):
   - `createConversationArmyService({ repo, now? })` 输出 `conversationArmyPanel` 与 `armyOverview`
     两个方法,`catCodename` 在这一层现算并挂到每张卡上。
   - 404 统一 fail-closed:仓库返回 `null`(会话不可见)与非人类 actor,两者都抛同一个
     `ConversationArmyServiceError(404, "conversation_army_not_found", ...)`,不泄露「到底是不存在还是
     没权限」——照批 0 `workbench-pages.ts` 的 `workbenchNotFound()` 处理惯例。
   - 测试覆盖:VM 装配字段对齐(含猫名代号、最近一步映射、输出区 href 拼接)、空 runs 触发
     `empty_state`、非人类 actor 在碰仓库前就被拒、游标只在两半都在时才透传、总览款项目分组字段
     透传、**装配出的行不符合契约时 `InternalContractError` 而不是带着垃圾数据 200**(用一个不在
     `agentRunStatuses` 枚举里的假 status 触发)。
5. `apps/api/src/routes/conversation-army.ts`(新)+ `.test.ts`(新,8 条):
   - 导出 `createConversationArmyRoutes(deps)`,**不挂载**进 `app.ts`(见下「挂载清单」)。
   - `GET /conversations/:id/army`、`GET /me/army`,uuid 参数守卫照 `routes/uuid-param.ts`
     既有用法(非法 id 与合法但不存在同一个 404 形状)。
   - 测试覆盖:未登录 401(不碰 service)、非法 uuid 404(不碰 service)、查询参数解析并原样透传
     给 service、limit 越界/半个游标 422、service 的 404/500(契约漂移)原样透传。
6. `packages/db/src/index.ts`、`packages/contracts/src/index.ts`:各加一行 `export * from "..."`。

## 我做的一处设计延伸(超出字面任务清单,但是任务清单本身要求的字段需要它)

任务要求 `conversation-army.ts` 的面板 VM 带「输出=该会话 runs 的 deliverable/proposal 链接聚合」,
但既有 `packages/db/src/repositories/proposals.ts` 只有按单个 work item 查的 `listByWorkItem`,没有
「按会话批量查」的方法,而它又不在我的改动范围内。我没有绕过这条约束去改 `proposals.ts`,而是在
自己的 `conversation-runs.ts` 里新写了 `listOutputLinksForConversation`,直接对 `proposals` ⋈ `branches`
⋈ `agent_runs` 发**一条**查询(过滤 `agent_runs.source_conversation_id`),完全绕开对每个 work item
再查一次 `listByWorkItem` 的 N+1 陷阱。这是范围内的最小侵入实现,请集成者确认这个设计选择可接受。

## 挂载清单(给集成者)

1. `apps/api/src/app.ts`:
   - `import { createConversationArmyRoutes } from "./routes/conversation-army.js";`
   - 在 `app.route("/api", createConversationRoutes());` 附近加一行
     `app.route("/api", createConversationArmyRoutes());`(与 `conversations.ts` 同款挂法,默认
     `deps` 走 `getDefaultConversationArmyService()`)。
2. `apps/api/src/openapi.ts`:两个新端点(`GET /conversations/:id/army`、`GET /me/army`)与其响应
   schema(`conversationArmyPanelVmSchema`/`armyOverviewPageVmSchema`)未登记——不在我的改动范围
   (铁律 §4 明确排除 openapi.ts),集成时请补。
3. run 详情下钻**没有新做端点**——按计划复用既有 `GET /agent-runs/:id/trace`(鉴权已经在
   `routes/agent-runs.ts` 里做好,`assertCanReadRun` 认 `actor_id`/`work_item_id` 可读性,派发写路径
   落地后这条鉴权自然也认新的 assignee 身份,不需要为军团面板单独开一条)。VM 里的 `id` 字段就是
   run id,前端直接拼 `/agent-runs/${id}/trace` 跳转即可。
4. `armyRunListQuerySchema` 的 `limit` 默认 20、上限 50——如果前端一屏想展示比 50 更多的军团卡,
   要走分页,不要在集成时把 schema 的 `.max(50)` 悄悄放宽绕过仓库层的 cap。
5. `outputs` 区当前固定 20 条 cap(硬编码在 `services/conversation-army.ts` 里),没有走
   `armyRunListQuerySchema`,如果要做成可配置需要单独设计。

## 缺口(不修,只报)

- **后台任务数据源不存在**:`background_tasks` 永远是空数组 + `not_yet_available`(schema 层
  `.max(0)` 钉死)。02 计划原话已经讲明白了不接的理由;真要接,需要先有一个「project-scoped 的
  scheduled task」模型(现有 `background_jobs` 表是全局的、不挂项目/会话归属,`schedule-notify` 那
  一族是给会议/日程用的,两者都不能直接冒充)。这是个需要单独立项的缺口,不是我漏做。
- **`listOutputLinksForConversation` 的鉴权假设**:如上文「设计延伸」所述,它信任调用方已经做过
  会话可见性判定,自己只做租户围栏,不重复整套成员判定。集成 review 时请重点核对这条(虽然当前
  唯一调用方 `services/conversation-army.ts` 的 `conversationArmyPanel` 确实总是先调
  `listRunsForConversation` 拿到非 null 结果才会走到它)。
- **`listRunsForConversation`/`listArmyOverviewForUser` 只有 recorder 模式单测,没写 env-gated 真
  PG 矩阵**(任务里这条本来就标注「可选」)。recorder 测试验证的是查询形状(join/where/limit/
  orderBy 引用哪些列、鉴权短路、N+1 数量)与仓库层 JS 侧的行映射逻辑(goal 摘要回落、最近一步的
  防御性丢弃),**没有**验证真实 Postgres 对 `jsonb_build_object`/`coalesce`/`to_char` 这几个 SQL
  表达式的实际返回值语义(比如 pg 驱动是否真的把计算出来的 `jsonb` 表达式自动解析成 JS 对象——
  这是我基于「这个仓库其它 jsonb 列都被自动解析成对象」的观察做的推断,没有真机验证过)。建议
  集成时至少跑一次真实场景验证这条推断。
- **`assignee_user_id` 的语义**:这批 `action_card_items.assignee_user_id` 是派发写路径(并行分支)
  接的列,我只读它。在那条分支落地并把 `assignee_user_id` 真正写上之前,`listRunsForConversation`
  返回的 assignee 会一直回落到 `agent_runs.actor_user_id`(发起者,不是受派人)——这是预期行为
  (COALESCE 兜底),但集成两条分支时要确认字段语义对上了,UI 别把「发起者」误标成「受派人」。
- **`cat_codename` 没有持久化**:每次装配 VM 现算(纯函数,便宜),没有存进 `agent_runs` 或任何
  表。00 文档没有要求持久化,只要求「确定性」,现算已经满足;如果未来要在通知/线程回贴里也用
  同一个名字,直接调同一个 `catCodename(runId)` 就行,不需要额外同步机制。

## 自查输出

```
pnpm --filter @workhub/db test        → 194 tests, 192 pass, 0 fail, 2 skip(含本批 10 pass + 1 skip)
pnpm --filter @workhub/contracts test → 93 tests, 93 pass, 0 fail(含本批 5 pass)
pnpm --filter @workhub/api test       → 919 tests, 918 pass, 0 fail, 1 skip(含本批 16 pass)
pnpm -r typecheck                     → 16/16 workspace 项目 Done,0 错误
git status                            → 只有本批范围内文件(3 处 export 行追加 + 1 处 pages.ts 追加
                                          + 8 个新文件),无范围外改动
```

新增测试净增 32 条(db 11 条含 1 个占位 skip、contracts 5 条、api 16 条),均为「先写会红后写绿」
的真断言(鉴权短路用「查询次数」硬断言、N+1 复核用「只发 1/2 条查询」硬断言、契约漂移用真实构造
一个非法 status 触发 `InternalContractError` 而非 mock 一个假错误类型)。

## 没做/存疑

- 见上「缺口」一节,不重复。
- 没有触碰 `app.ts`/`openapi.ts`/schema/迁移/既有断言/desktop-webview/client-tauri/qa 脚本,按范围
  围栏要求。
- 没有实现 SSE 订阅接线(01 §7「面板订阅用一条事件流按 id 切片」)——这是前端/UI 批次的活,我这批
  只交付 REST 读端点。

## 结论

批 5 服务端读侧切片完成,自查全绿,范围内改动无越界。等待集成者挂载路由并核对上面两处设计假设。
