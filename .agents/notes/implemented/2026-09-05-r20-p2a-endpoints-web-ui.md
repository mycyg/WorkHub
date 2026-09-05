# R20 P2A 七个纯后端端点上 web 界面

- Status: implemented
- Date: 2026-09-05
- Owner: claude-code（R23 P4，分支 r23/p4-r20-endpoints-ui）

## Problem

R20 P2A 落了七个端点，服务层、审计、权限判定一应俱全，但两端一个入口都没有——按
`.agents/notes/implemented/2026-08-20-land-all-reserved-features.md` 的完成标准（端点＋服务＋至少一端
UI＋测试），它们全部处在「界面未上线」的不合格态：

- `POST /api/workitems/:id/assign`、`/claim`（指派、认领）
- `GET`/`POST /api/workitems/:id/comments`（讨论）
- `POST /api/projects/:id/archive`、`/delete`（项目归档、删除）
- `GET /api/workspace/audit`（工作区审计，仅管理员）

同时 api-client 里这七个端点一个类型化方法都没有，前端就算想调也调不到。

## Decision

**一、能不能做，由服务端算，前端不猜。** 三处新按钮的资格全部由服务端随页面 VM 下发，且**复用写端点
用的同一个谓词**：

- `WorkItemDetailVM.can_claim` / `can_assign` ← `canClaimWorkItem` / `canManageWorkItemAssignees`
  （`@workhub/permissions`，与 `services/work-item-assignment.ts` 同一把尺子，作用域同样只按 workspace）。
- `ProjectHomePageVM.can_manage_lifecycle` ← 把 `project-ops.ts` 里原本内嵌的 `canManageLifecycle`
  提到模块层导出为 `canManageProjectLifecycle`，项目主页 VM 直接调它。

前端据此决定按钮渲不渲，没资格就整块不渲。理由：两处各写一份判定必然漂移，最终形态不是「看得见、
点下去 403」就是「有权限却没入口」，两种都比没有按钮更糟。三个字段都是可选（additive），旧夹具不带
时前端按「不渲」处理，不会凭空多出假入口。

**二、指派名单必须端出来（本轮补的最大一处缺口）。** `assign` 写的是 `work_item_assignments`，
**不是** `claimed_by_*`。详情页原本只渲「现在谁在跟」（认领人），指派成功后页面毫无变化——这就是个
看不出结果的假动作。故：

- `StoredWorkItemDetailRows.assignments` 增加可选 `nickname`，PG 查询左连 `users`（与
  `claimedByNickname` 同源取法）。左连接：账号被硬删时 `nickname` 为 null，**指派行本身仍要显示**，
  不能因为名字缺席就把被指派人吞掉；界面渲「已停用的成员」而不是裸 uuid。
- `WorkItemDetailVM.assignees`（可选，最多 50 条）：lead 排在 collaborator 之前，同角色内按展示名
  稳定排序（刷新两次顺序不变）。历史脏行的未知 role 收口成 `collaborator`——不让一条脏数据把整页
  VM 校验打挂、导致详情页整个渲不出来。空名单**省略字段**（诚实缺省，同 `github_activities` 的手法），
  不端一个空数组让前端渲空壳。

**三、评论按需水合，不塞进页面 VM。** 详情页 VM 不带评论——一段讨论不该把整页 VM 撑大。列表由
`browser.ts` 客户端拉取，失败给可见告警 ＋ 可点重试，**绝不用「还没有人留言」糊弄一次真实的取数失败**
（沿用 `bindWorkItemAuditTimelinePanel` 的既有纪律）。服务端一次最多回 200 条，界面默认展开最近 8 条，
更早的用一颗**明说条数**的「展开更早的 N 条」本地展开（不再发请求），不做无提示的静默截断。

**四、破坏性动作两段确认＋先跳转再报喜。** 归档/删除走既有 `armConfirmButton`（第一次点只换文案，
5 秒窗口内再点才发请求），两个动作的确认文案必须不同，否则武装态下用户分不清点的是哪个。成功后
**先 `await navigateWebRoute("/projects")` 再挂提示**：`navigateWebRoute` 会重渲整页，提示挂在跳转
之前会被这次重渲连根抹掉，用户只看到项目凭空消失、没有任何交代（这条是本轮修的一个真 bug，既有的
「新建项目→项目主页」分支本来就是这个顺序）。

**五、工作区审计放进已有的 /settings 管理员区，不新开路由。** 非管理员连 GET 都是 403，故整块只在
`isAdmin` 时渲（同成员分区/预算策略分区）。服务端只回 `{limit, offset, count}`、没有 total，因此
「还有没有下一页」按「这一页装满了没」判断、游标＝`offset + count`；最后一页恰好装满时会多问一次、
拿到空页收尾——**宁可多问一次，也不能在还有记录时把「加载更多」藏掉**。这段差一位就漏记录或死循环的
算术抽进 `apps/web/src/workspace-audit.ts` 单测钉死。

**六、桌面端本轮不接。** 完成标准是「至少一端 UI」，本批交 web；桌面端的对应入口留作后续，
`apps/desktop-webview` 只补了穷举 mock 的存根（不补则整包 typecheck 红）。

## Alternatives considered

- **前端自己判权限**（照抄一份 admin/owner 规则）：否决，判定必然漂移，见决策一。
- **详情页 VM 里内嵌评论列表**：否决，讨论可以很长，会把每次开详情页的负载和延迟都抬上去；且评论
  更新频率与页面其余部分完全不同。
- **指派名单只渲 user_id、不做 users 左连接**：否决。裸 uuid 对读者没有意义，且正是本仓库历次审查
  反复点名的「原值泄漏」。左连接是一次查询内的附带列，代价可忽略。
- **`assignees` 用 `.default([])` 而非可选**：否决。`.default` 会让 `z.infer` 的输出类型变成必填，
  所有手写 `WorkItemDetailVM` 字面量的夹具都要跟着改；且「空数组」与「没有指派」在界面上要渲成同一
  个样子，那就没必要多端一个字段出去。
- **工作区审计单开一条 `/audit` 路由**：否决。新增路由要同步路由注册表、shellPageOrder 与 smoke 计数，
  为一张管理员表格付这份代价不值——它本来就属于设置里的治理面。
- **归档/删除后留在项目主页**：否决。服务端 `findProjectById` 只回活跃项目，留在原地下一次水合就是
  404；回项目列表才是诚实落点。

## Consequences

- 七个端点全部脱离「界面未上线」态，api-client 补齐七个类型化方法（含审计流查询串构造器——**工作区
  不由客户端传**，服务端恒取自认证身份）。
- `work_item.assigned` / `work_item.claimed` / `project.archived` / `project.deleted` 四个审计动作此前
  没有任何界面读它们，本轮在审计行渲染里补了中英标签；`entity_type` 也查表翻成人话再显示。
- 详情页每次渲染多一次评论拉取、管理员设置页多一次审计拉取，两者都 fail-soft，不进首屏 loader、
  不影响路由就绪判定。
- 遗留：桌面端（desktop-webview）这七个动作仍无入口；工作区审计的过滤器（按操作者/动作/时间段）
  客户端方法已支持，界面本轮只做了分页，没做筛选表单。
