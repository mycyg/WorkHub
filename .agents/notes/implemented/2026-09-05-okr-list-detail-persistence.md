# R23 F-01：OKR 目标列表/详情持久化

- Status: implemented
- Date: 2026-09-05
- Owner: claude（R23 F-01 施工，接手上一位工人未提交的仓库层/服务层/路由层改动并收口）

## Problem

服务端 objectives 此前只有 POST /api/objectives（创建）与 POST /api/objectives/:id/link（挂链）两个写端点，没有任何列出已有目标或查看目标详情的读端点。项目主页 OKR 面板因此把列表做成了会话内内存态——刷新页面就丢，注释里明说「服务端没有列全部已有目标的端点」；桌面端只有时间线行上的只读 OKR 徽标（读 objective_ids/objective_titles，这是另一条已存在且工作正常的机制，不经过本次新增的两个端点）。

## Decision

- **仓库层**（packages/db/src/repositories/objectives.ts）：加 `listObjectivesForWorkspace`（按工作区、按 updatedAt 倒序、cap+1 探测诚实上限）与 `readObjectiveDetail`（目标本体 + 关键结果 + 挂链工作项(联工作项表拿 code/title，过滤软删) + 挂链执行计划——`task_plans.objective_id` 这条既有列此前从未被任何查询读过）。详情查询与既有的 `readObjectiveProgressSnapshot`（夜间进度刷新热路径）刻意不复用同一条查询，避免为一个展示字段拖慢刷新循环。
- **端点**：GET `/api/objectives/:id`（详情）与 GET `/api/projects/:id/objectives`（列表，挂在项目路由下但目标是工作区级实体——objectives 表没有 project_id 列，这条路由只按 :id 做 uuid 格式校验，不做项目级过滤，返回该项目所在工作区的全部目标）。鉴权判定复用既有写端点的模式：未登录 401、`actor.workspaceId` 缺失 403（防御性分支，实际不可达，因为 `AuthActor.workspaceId` 类型上是必填 string；真正可达的 403 是 `resolveHumanActor` 在 memberships 仓库解析不到租户时抛的 `workspace_access_revoked`）。
- **OpenAPI + contracts**：两条路径同批补齐；`packages/contracts/src/enums.ts` 新增 `objectiveStatuses`/`keyResultStatuses`——这是镜像 `packages/db/src/schema/core.ts` 里表定义用的本地字面量联合，不是从 db 包反向导入（db 层为避免循环依赖没有依赖 contracts），两侧改值需要同步维护。
- **SDK**：`listObjectives(projectId)` / `getObjective(objectiveId)` 标**必填**（不是 `revertAgentRun?` 那种可选桩），跟 `createObjective`/`linkObjective` 同一批次的既定先例——代价是 apps/web、apps/desktop-webview 两处手写全量 `WorkHubApiClient` 字面量 mock（main.test.ts）要跟着补最小桩，已经补。
- **web 面板重构**：项目主页 OKR 面板从「会话内乐观追加」改为「挂载时真拉取 + 创建/挂链成功后整表重拉」——不再做本地 DOM 拼接，服务端列表是唯一真相源。纯字符串渲染抽成 `apps/web/src/objective-panel.ts`（不碰 DOM，单测直接覆盖空态/上限/双语/转义/详情三段假设 XSS 转义）；`browser.ts` 的 `bindProjectHomeObjectivesPanel` 只管取数与事件接线，且**改用事件委托挂在 `list` 容器上**——因为整表重拉会替换所有子节点，逐行绑定的监听器活不过一次重拉。详情按行懒加载 + 按 objective_id 缓存，链接成功会使该目标的缓存失效（避免展示挂链前的旧快照）。SSR 骨架（`packages/ui` route-components.ts）从「诚实空态（声明服务端没有列表端点）」改成「加载中」骨架，与 plansSection/membersSection 两个先例一致（GET 数据一律不在 SSR 内嵌）。
- **桌面时间线 tile**：核实后确认它消费的是另一条机制（`TimelineWorkItemVM.objective_ids`/`objective_titles`，服务端 `listObjectiveTitlesByIds` 早已 join 出真实标题），不是本次新增的列表/详情端点——工单点名的「若消费同一 VM 顺手接」条件不成立，未改动，避免为不相关的机制强行接线。
- **测试**：db 仓库层两个新方法的假仓库单测（含 cap 边界与「目标不存在即短路，不发三条联查」）；api 路由层新增 401/403（workspace_access_revoked，通过注入 memberships 假仓库复现，同 auth.test.ts 先例）/404（非法 uuid、目标不存在）/200（含 snake_case 映射与 capped）全覆盖，两条端点都测；api-client 端点契约测试；web 纯渲染函数测试。**未**新增 packages/contracts 层的独立 schema 解析测试——核实过 `domain/objective.ts` 的既有 create/link 契约也从未有过专门的 contracts 层测试，真实覆盖一直来自 api 路由测试与 api-client 测试，本次列表/详情两个新 schema 沿用同一覆盖路径，不引入新惯例。

## Alternatives considered

- **详情复用 `readObjectiveProgressSnapshot` 的查询**：否决——那条是夜间批量刷新进度的热路径，多联一张任务计划表会拖慢它，且它的返回形状（work item 只要 id/status）不够详情页渲染用（缺 code/title）。
- **SDK 方法标可选（`listObjectives?`）**：否决——这两个方法是本次功能的核心读入口，web 会直接调用，不是 revertAgentRun 那种「桌面才可达的边缘能力」；标必填能让类型系统在 mock 漏补桩时立刻报错，而不是运行时才发现。
- **web 端继续本地乐观拼接 + 后台悄悄重拉**：否决——工单明确要求「创建/挂链后重拉」，且本地拼接和服务端权威列表容易在挂链导致目标行为变化时（例如未来加了自动状态流转）产生不一致；改成整表重拉更简单也更不容易出现「两份数据对不上」的 bug。
- **桌面时间线 tile 顺手接真列表**：核实后条件不成立（见上），未做——避免为工单没点名成立的场景硬造工作量。

## Consequences

- `packages/contracts/src/enums.ts` 的 `objectiveStatuses`/`keyResultStatuses` 与 `packages/db/src/schema/core.ts` 表定义的字面量联合是两份独立声明，未来任一侧新增/改名状态值必须同步改另一侧，否则契约层 z.enum 会拒绝合法的服务端返回值（openapi/app.test.ts 的路由覆盖门不会捕获这种值域漂移，只捕获路径缺失）。
- `apps/web/src/main.test.ts` 与 `apps/desktop-webview/src/main.test.ts` 的手写 `WorkHubApiClient` 字面量 mock 现在多两个必填桩——之后任何人再给 `WorkHubApiClient` 加必填方法，都要记得同步这两个文件（这个坑之前 `createObjective`/`linkObjective` 那批已经踩过一次并留了注释，本次是第二次印证同一模式）。
- 项目主页 OKR 面板的挂链/详情按钮改成事件委托后，任何人往 `list` 容器里加新的可点击子元素都要在委托 handler 里加一个 `closest()` 分支，不能再假设「新建的行自带监听器」。
