# R14fix · 批 A：桌面协同会话交互缺陷修复

分支 `r14fix/workbench`（base main=9d362c72）。四项验收缺陷全部修复，全绿。

## 完成矩阵

| # | 缺陷 | 状态 | 关键落点 |
|---|------|------|----------|
| 1 | 建群弹窗成员多选行排版错乱（用户实拍） | ✓ | `css.ts` 补齐 `.wh-wb-new-collab-*` 全套 flex 规则 |
| 2 | 缺「单独和 Cuu 聊」明确入口 | ✓ | `rail.ts` 协同分组顶部「和 Cuu 单独聊」快捷入口 |
| 3 | 会话重命名（服务端 + 桌面 UI） | ✓ | 新端点 `conversation-rename.ts`（不挂载）+ 叶子悬停铅笔 + 小弹窗 |
| 4 | BUG-05 读游标失败永久丢失 | ✓ | `read-state.ts` attempted/acked 状态机 + `view.ts` 重试/日志 |

## 逐项说明

### 缺陷 1 — 建群弹窗排版
根因确认：`rail.ts:renderNewCollabModalHtml` 里的 `.wh-wb-new-collab-member-row`（label 含
checkbox + 头像 tile + 名字）以及 `.wh-wb-new-collab-members` / `.wh-wb-new-collab-cuu-toggle` /
`.wh-wb-new-collab-members-label` / `.wh-wb-new-collab-member-empty` / `.wh-wb-new-collab` /
`.wh-wb-new-collab-error` 在 `css.ts` 里**一条样式都没有** —— label 默认 inline，三个元素换行错乱。
- `css.ts` 追加了整组 `wh-wb-new-collab-*` 规则（未改任何既有规则串），每行 `display:flex;align-items:center;gap`。
- **浏览器实测抓到一个单测漏掉的真 bug**：名字 span 规则 `.wh-wb-new-collab-member-row span{flex:1 1 auto}`
  优先级压过头像 span 自己的 `.wh-wb-chat-avatar{flex:0 0 auto;width:22px}`，把头像拉成横向椭圆。
  已改为 `span:not(.wh-wb-chat-avatar)`，头像恢复 22px 圆。渲染 CSS+markup 到静态页人工核对通过（见验证）。
- `css.test.ts` 加了 2 条断言（member-row / cuu-toggle 是 flex 行；rename 铅笔 hover/focus 显隐）。

### 缺陷 2 — 单独和 Cuu 聊
- `rail.ts` 协同分组「+ 新建协同会话」上方加「和 Cuu 单独聊」按钮（`data-wb-new-solo-cuu`，橙色 cat 图标）。
- 一键调 `createCollabConversation`（`participantUserIds:[]`、`cuuEnabled:true`、`visibility:private`），
  建好立即 `onOpenCollabConversation` 打开。in-flight/error 复用 `newCollabSubmitting/newCollabError`。

### 缺陷 3 — 会话重命名
**服务端（工厂已导出，未挂载，等集成）**：
- 契约：`renameConversationRequestSchema`（`{title}` min1/max256，strict）+ `renameConversationResultVmSchema`
  （`{conversation}`，定义在 `conversationVmSchema` 之后避免 TDZ）。additive。
- 仓库：`ConversationRepository.renameConversation`（`packages/db`，**无迁移**，title 列已存在）——
  workspace+未删除围栏的原子 `UPDATE ... SET title ... RETURNING`，命中 0 行抛 `ConversationAccessDeniedError`（→404）。
- 服务：`ConversationService.renameConversation` 红线——① 会话可见（`visibleConversation` 404）；
  ② 仅 `kind==='collab'`（main 主区 403 `conversation_rename_forbidden`）；③ 仅参与者/owner
  （`participantRole !== null`，否则 403）。
- 路由：`apps/api/src/routes/conversation-rename.ts` → `PATCH /api/conversations/:id`，uuid 守卫 + body 校验 + `{ok,data}`。
- **事件**：本仓库无 `conversation.updated` 事件（事件面只到 message/reaction/read 三类）。按最简路径处理——
  不广播，客户端就地更新左栏树叶（`renameCollabConversationInVm`），下次拉会话树再校准。聊天头部不显示会话
  标题（`mountChatView` 只吃 projectName），故改名对已打开会话无陈旧标题问题，无需 shell 改动。

**桌面 UI**：
- 每条协同会话叶子加悬停/键盘聚焦才现身的铅笔（`data-wb-rename-collab` + `data-wb-rename-collab-title`，
  兄弟节点不套在 open 按钮里）。
- 点铅笔开重命名小弹窗（`renderRenameCollabModalHtml`，复用 `.wh-wb-modal*` 外壳）→ 输入 → PATCH →
  `renameCollabConversationInVm` 就地刷新左栏。

### 缺陷 4 — BUG-05 读游标失败永久丢失
根因：`view.ts:doMarkRead` 请求发出前就 `lastSentReadSeq=seq` 再 `.catch(()=>undefined)`，失败后
`seq <= lastSentReadSeq` 把同一个（及更小）seq 永久挡住。
- `read-state.ts` 抽出纯状态机：`ReadCursorSendState{ackedSeq, inFlightSeq}` +
  `shouldSendReadCursor / markReadCursorSent / markReadCursorAcked / markReadCursorFailed /
  readCursorSendStateFromAcked`。**只有服务端确认才推进 acked**；失败只清 in-flight、绝不推 acked。
- `view.ts`：`doMarkRead` 用状态机；成功后 `maybeMarkRead()` 自查是否有更新消息要接着报；失败回滚在途 +
  `logReadCursorFailure(conversation, seq, error)` 结构化日志 + 重排重试。新增 `online` 事件监听（网络恢复
  重试，dispose 清理），与既有 `focus` 重试同路。
- 单测（`read-state.test.ts`）含关键回归断言：失败后 acked 不推进、同一 seq `shouldSendReadCursor` 仍为 true。

## 重命名端点挂载 snippet（给集成者）

`apps/api/src/app.ts`（白名单，未改）——在既有会话读端点附近加：

```ts
import { createConversationRenameRoutes } from "./routes/conversation-rename.js";
// ... 与 createConversationReadRoutes() 同一档，放它旁边即可：
app.route("/api", createConversationReadRoutes());
app.route("/api", createConversationRenameRoutes()); // ← 新增：PATCH /api/conversations/:id
```

- 路由是 `PATCH /conversations/:id`（无子路径），与既有 `conversation-message-actions` /
  `conversation-read`（都挂 `/conversations/:id/...` 子路径）无碰撞。
- openapi（白名单）：`PATCH /conversations/{id}` request=`renameConversationRequestSchema`，
  200 response=`renameConversationResultVmSchema`，403 `conversation_rename_forbidden` / 404
  `conversation_not_found`。契约 schema 均已 additive 导出，可直接引用。
- app.test（白名单）：如枚举路由总数/openapi 计数，需 +1 条 PATCH 路由。

## 测试计数（全绿）

| 套件 | 结果 | 备注 |
|------|------|------|
| `@workhub/desktop-webview` | **1144 pass / 0 fail** | 基线 1130 → +14（rail solo/rename 9 + read-state BUG-05 4 + css 2，扣重叠）|
| `@workhub/api` | **1457 pass / 1 skip / 0 fail** | 含 rename 路由 6 + service 4 |
| `@workhub/contracts` | **148 pass / 0 fail** | 含 rename 契约 2 |
| `@workhub/db` | **356 pass / 2 skip / 0 fail** | 含 rename 仓库 3 |
| `pnpm -r typecheck` | **全绿** | 15 包全过 |

## 验证方式
- 单测 + 全量 typecheck（桌面 webview 无 Tauri 不能真机渲染，同既有约束）。
- CSS 修复走浏览器实测：把 `workbenchCss` + `renderNewCollabModalHtml` / `renderProjectTreeHtml` 渲染成静态页
  在 Browser pane 核对——成员行对齐工整、头像恢复圆形、左栏 solo Cuu 橙猫入口 + 会话铅笔均正确（这一步抓到
  并修掉了缺陷 1 的头像椭圆 bug）。

## 偏离 / 说明
- **无 `conversation.updated` 事件**：按任务约定走「客户端就地刷新」最简路径，未新造事件（见缺陷 3）。
- **动了 `packages/db`（非迁移）**：加了 `renameConversation` 仓库方法与 `RenameConversationInput` 类型。
  禁区仅禁「迁移」，title 列已存在；这是写 title 的必要接缝，非迁移。
- **动了三个既有测试文件加拒绝桩**：`ConversationService`/`ConversationRepository` 接口新增必需方法后，
  `conversations.test.ts`（repo 桩）、`conversation-routes.test.ts` / `conversation-typing.test.ts`（service 桩）
  的全字面量假实现必须补桩，否则 typecheck 红。均只加一条 `throw` 拒绝桩，未改既有断言。
- 未碰白名单（app.ts/openapi/app.test）、未加迁移、未碰 proposal|army|settings、未碰 chat/render.ts 的
  反馈/产出卡/digest 函数。
