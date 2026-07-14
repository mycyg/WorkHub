# R14 批 CHAT · 工包 W1-A chat-core 完成汇报

> 分支 `r14/chat-core`（从 main 拉）。范围＝01-chat-design.md §1 数据模型 + §2 语义红线 + §3 端点 + §4
> 契约中属于 chat-core 的部分。设计文档：`r14-release-readiness/01-chat-design.md`。

## 1. 做了什么（人话）

给「聊天基础完整度」补齐后端：消息**编辑**（15 分钟窗、仅本人、仅文字）、**墓碑删除**（不物理删、
正文清空、渲染「此消息已删除」）、**引用回复**（读写两端）、**精选五键 emoji 反应**（存 ASCII slug，
emoji 字形不入契约/schema）、**已读游标**（聚合式「已读 N/M」+ 未读分割线的地基）、**置顶**。三条
additive SSE 事件广播变更。**下游墓碑过滤**：凡把消息文本喂给 AI 的读路径全部跳过已删消息。新增两个
路由文件但**不挂载**（挂载由集成者做）。

## 2. 改动文件清单

### packages/db
- `migrations/0055_conversation_chat_completeness.sql`（新）：journal idx=55、when=1783907000000。
  conversation_messages 加 6 列（全 nullable）+ 引用回复复合 FK `(conversation_id, reply_to_message_id)
  -> (conversation_id, id)`（无 onDelete，消息只软删，引用边保住）+ pinned 部分索引；新表
  `message_reactions`（reaction_key check 五键、unique 三元组、(conversation_id, message_id) 复合 FK 保同会话）
  与 `conversation_read_cursors`（last_read_seq ≥0、unique(conversation_id, user_id)）。重放安全（IF NOT
  EXISTS + DO $$ 守卫，照 0046/0054 惯例）。
- `src/schema/core.ts`：conversationMessages 加列 + 引用回复 deferred FK + pinned 部分索引；两张新表 +
  workHubTables 注册。
- `src/repositories/conversations.ts`：11 个新方法（editMessage/deleteMessage/pinMessage/unpinMessage/
  addReaction/removeReaction/advanceReadCursor/listReceipts/listPins/listReactionsForMessages/
  listReplyPreviews）+ createUserMessage 加 reply_to 目标校验；listReplyJudgeCandidates 两条查询补
  `deleted_at is null`。新增 6 个错误类 + ConversationReplyTargetError。
- `src/test-query-recorder.ts`：加 `delete(table)` builder（removeReaction 用 db.delete，此前假 DB 无 delete）。
- `src/schema.test.ts`（**批准变更**）：journal 尾断言 0054→0055；F02 表数 66→68（新增两表的机械后果）；
  加 0055 迁移断言。
- `src/conversation-repository.test.ts`：message/cuuMessage fixture 补 6 列；27 个新方法/引用写路径测试 +
  reply-judge 墓碑过滤断言。

### packages/contracts
- `src/enums.ts`：eventTypes 加 conversation.message.updated / .reaction.updated / .read.updated。
- `src/domain/conversation.ts`：conversationReactionKeySchema（五键 ASCII）；消息 VM base 加 optional
  edited_at/deleted_at/pinned/reply_to(preview≤80)/reactions；`.superRefine` 强制墓碑归一（deleted_at ⟺
  kind='text' 且 content.text=''，活文字消息仍强制非空）；text 变体 content 放宽空串（`.extend`，创建侧
  min(1) 不变）；editConversationMessageRequestSchema / advanceReadCursorRequestSchema / receipts·cursor·
  pins VM；createConversationMessageRequestSchema text 变体加 reply_to_message_id。
- `src/events.ts`：三个事件 schema（message.updated 用 human actor 且**不做** message.created 的
  actor↔sender 配对校验——支持置顶 Cuu 消息时 actor=置顶者/sender=cuu；reaction.updated/read.updated 极简
  payload 照 delta/typing 风格）。
- `src/r12-workbench.test.ts`（**批准变更**）：事件名钉死清单 9→12。
- `src/r14-chat.test.ts`（新）：反应键/VM 新字段/墓碑不变量/三事件的正反例。

### apps/api
- `src/services/conversations.ts`：9 个服务方法 + 语义红线映射（编辑 15min 窗 / 本人 / 墓碑归一 /
  引用 400 / 置顶可见者皆可 / reaction 坏键 400 / 已读夹紧）；VM 富化（reactions 聚合 + reply 预览，页级
  各一条查询，禁 N+1）；三条 SSE 发布（照既有 makeWorkHubEvent + parseOutputContract + bus.publish 失败仅
  warn）；createMessage 支持 reply_to。
- `src/services/conversation-turns.ts`：historyDisplayText 短路 deleted（覆盖 turn 历史 buildHistory + C1
  压缩输入，两条都走 buildHistory）；澄清追问线索读也加墓碑守卫。
- `src/workers/conversation-observer.ts`：messageDisplayText 短路 deleted（**刻意在展示层短路而非查询层滤**，
  保 analyzedToSeq watermark 用真实最大 seq 推进，不因尾部墓碑卡死重扫）。
- `src/routes/conversation-message-actions.ts`（新，**不挂载**）：PATCH/DELETE message、PUT/DELETE
  reactions/{key}、PUT/DELETE pin、GET pins。
- `src/routes/conversation-read.ts`（新，**不挂载**）：PUT read、GET receipts。
- `src/routes/conversation-chat-actions.test.ts`（新）：两个路由文件的 HTTP 层测试。
- 既有测试 fixture/stub 补齐（ConversationMessageRow 加 6 列的机械后果）：conversations.test.ts /
  conversation-routes.test.ts / routes/conversation-typing.test.ts / conversation-observer.test.ts /
  conversation-turns.test.ts / action-cards-service.test.ts。conversations.test.ts / conversation-turns.test.ts
  加下游墓碑过滤行为测试。

## 3. 自查输出（测试计数前后对比）

| 包 | 命令 | 前 | 后 | 结果 |
|---|---|---|---|---|
| db | `pnpm --filter @workhub/db test` | 288 | 316 (314 pass / 2 skip) | 绿 |
| contracts | `pnpm --filter @workhub/contracts test` | 113 | 120 | 绿 |
| api | `pnpm --filter @workhub/api test` | 1244 | 1266 (1265 pass / 1 skip) | 绿 |
| all | `pnpm -r typecheck` | — | 0 错 | 绿 |

## 4. 改过的断言（仅设计批准的两处 + 机械后果）

- `schema.test.ts` journal 尾断言 0054→0055（设计 §1 批准）。
- `r12-workbench.test.ts` 事件名钉死清单 9→12（设计 §4 批准）。
- `schema.test.ts` F02 表数 66→68：这是新增 message_reactions + conversation_read_cursors 两张表的**机械
  后果**（设计 §1 明列新表），非迁就实现。

## 5. 集成者挂载清单（chat-core 不碰 app.ts / openapi.ts / app.test.ts）

### 5.1 app.ts —— 挂载两个路由工厂

```ts
// import 区（与既有 conversation 路由 import 并列）
import { createConversationMessageActionRoutes } from "./routes/conversation-message-actions.js";
import { createConversationReadRoutes } from "./routes/conversation-read.js";

// 路由挂载区（紧跟 createConversationTypingRoutes 之后即可，都是 /api 前缀）
app.route("/api", createConversationMessageActionRoutes());
app.route("/api", createConversationReadRoutes());
```
两个工厂内部已 `getDefaultConversationService()` 兜底，无需传依赖。错误映射复用既有
`app.onError` 里的 `ConversationServiceError` 分支（状态 400/403/404/409），无需新增。

### 5.2 app.test.ts —— expectedRoutes 白名单加 9 条

```ts
["patch",  "/api/conversations/{id}/messages/{messageId}"],
["delete", "/api/conversations/{id}/messages/{messageId}"],
["put",    "/api/conversations/{id}/messages/{messageId}/reactions/{key}"],
["delete", "/api/conversations/{id}/messages/{messageId}/reactions/{key}"],
["put",    "/api/conversations/{id}/messages/{messageId}/pin"],
["delete", "/api/conversations/{id}/messages/{messageId}/pin"],
["get",    "/api/conversations/{id}/pins"],
["put",    "/api/conversations/{id}/read"],
["get",    "/api/conversations/{id}/receipts"],
```
（app.test 会把每条 expectedRoute 与 openapi paths 交叉核对——openapi 未同步会红。）

### 5.3 openapi.ts —— 要点（openapi 是手写 JSON schema，非 zod 派生，不同步不会被 typecheck 逮到）

1. **消息 VM 响应**（`conversationMessageResponseVariant` 的 properties，`additionalProperties:false`）加 5 个
   optional（**不进 required**）：
   - `edited_at`: dateTimeStringSchema
   - `deleted_at`: dateTimeStringSchema
   - `pinned`: `{ type:"object", required:["at","by_user_id"], properties:{ at: dateTimeStringSchema,
     by_user_id: conversationNullableUuidSchema }, additionalProperties:false }`
   - `reply_to`: `{ type:"object", required:["message_id","sender_type","sender_user_id","preview_text",
     "deleted"], properties:{ message_id: uuidStringSchema, sender_type:{enum:["user","cuu","system"]},
     sender_user_id: conversationNullableUuidSchema, preview_text:{type:"string",maxLength:80},
     deleted:{type:"boolean"} }, additionalProperties:false }`
   - `reactions`: `{ type:"array", maxItems:5, items:{ type:"object", required:["key","user_ids"],
     properties:{ key:{enum:["approve","disagree","done","question","watch"]}, user_ids:{type:"array",
     items:uuidStringSchema} }, additionalProperties:false } }`
   注意：文字消息响应 content 现在允许空串（墓碑 `{text:""}`），若 openapi 的 text content 定了 minLength，
   需放宽（否则墓碑响应校验会红）。
2. **创建消息请求体**（POST /messages 的 text 变体）加 optional `reply_to_message_id: uuidStringSchema`。
3. **9 条新路径**加进 paths（形状照上面端点表；204 端点用 `{ "204": { description } }` 无 body）：
   - `PATCH /api/conversations/{id}/messages/{messageId}` req `{text}` → 200 消息 VM
   - `DELETE /api/conversations/{id}/messages/{messageId}` → 200 墓碑 VM
   - `PUT|DELETE /api/conversations/{id}/messages/{messageId}/reactions/{key}` → 204
   - `PUT|DELETE /api/conversations/{id}/messages/{messageId}/pin` → 204
   - `GET /api/conversations/{id}/pins` → 200 `{ messages: [VM] }`（maxItems 50）
   - `PUT /api/conversations/{id}/read` req `{last_read_seq}` → 200 `{last_read_seq}`
   - `GET /api/conversations/{id}/receipts` → 200 `{ receipts:[{user_id,last_read_seq}] }`（maxItems 500）
4. 若 openapi 有 SSE 事件类型枚举（asyncapi/事件目录），补三个新事件名。

## 6. 围栏外发现 / 没动的东西

- **W1-B（presence-observer）留白**：`conversation.observer.analyzing` 事件与 GET /api/presence 未碰（另一工包）；
  contracts/domain/presence.ts 未建。message.updated 事件我加了，observer.analyzing 归 W1-B。
- **删除顺带取消置顶**：deleteMessage 除墓碑三件套外还清了 pinned_at/pinned_by_user_id（设计只写「置顶列」
  但「已删除消息不可置顶」的精神要求墓碑不留在置顶栏；listPins 也额外滤 deleted 双保险）。这是设计的合理
  延伸，非偏离。
- **引用回复写路径**：设计 §2 明列引用创建校验（同会话/存在/未删除→400），但 §1 db 范围行文只提「reply 预览
  join」（读侧）。我把写侧（createUserMessage 加 reply_to + 校验 + createConversationMessageRequestSchema
  加字段）也做了——否则引用回复只读不可写＝半成品。属 W1-A 的 services/repos/contracts 范围内。
- **openapi/app.ts/app.test 白名单**未碰（禁区，见 §5 交给集成者）。
- **客户端（Wave 2 桌面 UI）** 全部未碰（§5 属 W2-A）。

## 7. 设计偏离及理由

无实质偏离。两处判断记录：
1. message.updated 事件**不做** message.created 的 actor↔sender 配对校验——因为置顶/编辑/删除的 actor 是
   执行者（human），data 可能是 Cuu 消息（置顶 Cuu 的话），配对校验会误杀。设计 §4「照 message.created」
   理解为「同 envelope 形状（actor+data）」，非「同 superRefine」。
2. 观察者墓碑过滤放在 messageDisplayText 短路（而非 listMessagesForAnalysis 查询加 deleted is null）——保
   watermark（analyzedToSeq＝返回行真实最大 seq）正确，避免尾部墓碑让 watermark 卡住反复重扫。设计 §2
   括注「（或墓碑短路）」明确允许这条路径。
