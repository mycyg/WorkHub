# 升级转交端到端：谁能看见「转交他人」，转交之后接手人能做什么

- Status: implemented
- Date: 2026-09-05
- Owner: claude-code（R23 F-04）

## Problem

POST `/api/escalations/:id/delegate`、服务层 `delegate()`、SDK `delegateEscalation` 三样齐全，却端到端零入口：

- 服务端**从不在升级卡上发 delegate 动作**——升级卡只发 resolve 与预算动作；
- 三端还各自把 delegate 动作剥掉（web 通用卡 `isUnsupportedWebAction`、桌面 `isUnsupportedDesktopAction`、桌宠 `stripUnsupportedPetActions`），理由都是「没有选人 UI，渲出来就是个死按钮」。

对照组：审批转交（`/api/approvals/:id/delegate`）在 web 早已全通，有真选人器。

## Decision

### 1. 动作只发给「点下去不会 403」的人

升级卡补 `escalation_delegate` 动作（POST + `/api/escalations/:id/delegate`，形状照审批转交），但**按行判定是否发**：

- 判据＝对该工单的写权限，与 delegate 端点自身的鉴权同源。为此给 WorkItemService 加 `canMutateWorkItems`（`canReadWorkItems` 的写权限孪生体，同一次 `findWorkItemAccessRecords`，整页一次批量查询）。
- 单条与批量两条路径共用抽出来的纯判定 `canMutateWorkItemAccessRow`——两处判定漂移一次，就会出现「卡上有按钮、点下去 403」的死按钮。
- 依赖声明里 `canMutateWorkItems` 是 `Partial`：旧夹具照常编译，缺它时按「拿不准就不发」降级。

### 2. 转交之后，接手人真的能处理

`ensureMutableEscalation` 放行 `suggested_lead_user_id === actor`（仍要求他能读这个工单，工作区栅栏不变）。否则转交是空转：接手人收到通知、看得见卡片，每个动作却 403。已有牵头人时按钮改口叫「改派他人」——同一个动作，两种处境。

### 3. 留痕与通知是提交后的尽力而为

审计（`escalation.delegated`，detail 记 from/to/操作人）与通知接手人（复用 `workitem.escalated` 类型，不新造前端不认识的枚举值）都在转交落库之后做，失败只告警。转交本身已经落库，不该因为副作用把用户挡在 500 上。

### 4. 三端入口

- **公共层**：`@workhub/web-runtime` 新增 `delegate.ts`（href 分类 + SDK 分派 + 回执文案读取）与 `workspace-roster.ts`（花名册翻页，从 `apps/web` 搬来，原处只留再导出）。谁去调哪个 SDK 方法只能有一处答案，否则两端会在「approvals 也能转交吗」这类问题上分叉。href 分类**只认两条精确路径**，不用 `/\/delegate$/` 泛匹配——将来别的资源加 delegate 端点不会被静默路由到错误的方法。
- **web**：通用卡不再剥动作，改为动作行下面挂一份选人器（与审批工作台共用同一份结构，data 属性统一 `data-wh-delegate*`）；确认转交按 href 分派。
- **桌面聚焦盒**：按钮留着，点它就地展开选人层（与打回理由层同款：actionrow 的兄弟节点），成员懒加载。**`runAction` 的 delegate 分支必须排在通用分类之前**——否则新动作会先被末尾那句「这类请到对应能力处理」的兜底 toast 接住，等于白发（侦察 D 的 C3）。
- **桌宠**：气泡里塞不下一份花名册下拉，但也不该像以前那样整个剥掉。改为把主窗口的决策队列打开到这张卡（`/approvals?id=<决策 id>`），选人在那边完成；收件箱认 `target.id`，首屏渲完把那张卡滚进视野并高亮**一次**（之后的刷新不再把人拽回去）。

## Alternatives considered

- **无差别发 delegate 动作，靠端点 403 兜底**：否决。决策队列上的按钮是承诺，点下去才知道不能点是最差的一种。
- **转交只改 `suggested_lead_user_id`，不放行写权限**：否决。等于把事情丢给一个什么都做不了的人。
- **桌宠内联选人器**：否决。气泡是一句话的尺寸，一份可能上百人的花名册不该塞进去；主窗有现成的选人层。
- **web/桌面各写一份 href 分派**：否决，见上。

## Consequences

- 新增 `WorkItemService.canMutateWorkItems`——实现该接口的夹具都要补这个方法（本批已补三处）。
- 决策卡列表每页多一次批量写权限查询（与既有可见性查询同形状，不是 N+1）。
- 桌宠的转交是「导航到主窗」而非就地完成，这是有意的：转交需要选人，选人需要空间。
