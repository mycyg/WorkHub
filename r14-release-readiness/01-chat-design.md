# R14 · 批 CHAT 实现级设计（聊天基础完整度）

> 状态：施工设计 · 2026-07-14 定稿 · 上游：00-plan.md §2 批 CHAT（用户已拍板范围）
> 侦察基础：服务端数据模型 / SSE 契约管线 / 双端 UI 三路侦察 + PM 产品审视（pm-review-2026-07-14.md）
> 纪律：04 手册 13 条铁律不变；emoji 破例仅限 reaction 展示层（见 §6）。

## 0. 范围裁定（含 PM 审视吸收）

照 00-plan 拍板范围：编辑（15 分钟窗）/删除墓碑（不限时）/引用回复/emoji reaction（精选五键）/已读 N/M 聚合/presence 两态 + 桌宠彩蛋 stretch。

PM 审视吸收进本批（A 级顺路项）：
1. **置顶消息**（工作群标配，增量小）。
2. **未读分割线 + 跳到未读**（与已读游标同一套地基）。
3. **引用回复可点跳原消息**（锚点已存在）。
4. **观察者「正在整理」指示灯**（00-interaction-design §2.2 承诺过、从未落地；瞬态事件，stretch）。
5. **桌面 @picker/改派 picker 补头像挂载** + **撤 `/技能` 假 affordance 灰 chip**（`#会话` 保留灰态等 SEARCH 批）。
6. **web 端头像铺开**（审批人/工单负责人/run 执行者等人物出现点）。

PM 审视立案不动（B 级，记入 00-plan §6）：群聊内看提议/审批深链、「让 Cuu 接手这条」手动拎活、Cuu 记忆引用露出（归 MEM/FEEDBACK）、web 只读会话镜像。

PM 对「已读 N/M」的异议（与 00-interaction-design「刻意不做已读回执」冲突、群聊已读=监视压力）**如实记录、不改拍板**：按用户拍板做聚合式 N/M（只在自己发的最后一条消息上显示，不做逐人列表）；未读分割线同批落地。用户可随时复审砍掉 N/M 展示（服务端游标两者共用，砍展示零成本）。

web 端**不做**聊天页（R13 已定调「聊天归桌面」；web 只读会话镜像已立案 B 级）。

## 1. 数据模型（迁移 0055，集成者已分配）

`0055_conversation_chat_completeness.sql`，journal idx=55、when=1783907000000、tag 同文件名；
`packages/db/src/schema.test.ts` 尾断言 0054→0055 同步（属批准的契约变更，非迁就）。

`conversation_messages` 增列（全部 nullable，append 语义不变）：
- `edited_at timestamptz`
- `deleted_at timestamptz`、`deleted_by_user_id uuid references users(id) on delete set null`
- `reply_to_message_id uuid`＋deferred FK `(conversation_id, reply_to_message_id) -> (conversation_id, id)`（照 thread_root 同款，保证同会话）
- `pinned_at timestamptz`、`pinned_by_user_id uuid references users(id) on delete set null`
- 部分索引 `conversation_messages_pinned_idx on (conversation_id, seq) where pinned_at is not null`

新表 `message_reactions`：
- `id`、`message_id uuid not null references conversation_messages(id) on delete cascade`
- `conversation_id uuid not null`（冗余列，配合 (conversation_id, message_id) 复合 FK 保同会话；便于按会话清理/校验）
- `user_id uuid not null references users(id) on delete cascade`
- `reaction_key varchar(24) not null` ＋ check in ('approve','disagree','done','question','watch')
- unique (message_id, user_id, reaction_key)；index (message_id)

新表 `conversation_read_cursors`（**不动 conversation_participants**，避免 main 会话无参与者行/小群参与者语义纠缠）：
- `id`、`conversation_id uuid not null references project_conversations(id) on delete cascade`
- `user_id uuid not null references users(id) on delete cascade`
- `last_read_seq bigint not null default 0` ＋ check ≥0
- `updated_at`；unique (conversation_id, user_id)

## 2. 语义红线（服务端强制）

- 编辑：仅本人（`sender_type='user' && sender_user_id=自己`，沿 conversation-turns.ts:830 判式）、仅 `kind='text'`、`created_at+15min` 窗内、目标未删除。改 `content_json.text`（校验同创建）、置 `edited_at`。Cuu/system 消息不可编辑。
- 删除：仅本人消息、不限时。墓碑 = `deleted_at`+`deleted_by_user_id` 置位、`content_json` 清为 `{}`（file_card 不留文件名）。不物理删、seq 不回收。
- **VM 归一**：已删除消息在 VM 层一律输出 `kind:'text'、content:{text:''}、deleted_at 置位`（DB kind 列保留原值作审计）。
- **下游读者跳过墓碑**：turn history（historyDisplayText/buildHistory）、reply-judge 候选、观察者分析窗、C1 压缩摘要——凡把消息文本喂给 AI 的查询全部加 `deleted_at is null`（或墓碑短路）。编辑后的消息用当前文本（不回溯派生物，语义=派生物基于当时原文）。
- 引用：仅 `kind='text'` 的新消息可带 `reply_to_message_id`；目标须同会话、存在、未删除（对已删目标回 400）。目标事后被删→引用侧显示墓碑（读时 join 判定）。可引用 Cuu/system 消息。
- 置顶：会话可见者皆可置顶/取消（main=工作区成员，collab=参与者，复用 assertConversationAccess）；已删除消息不可置顶；置顶不限量但读取端点 cap 50。
- 已读游标：单调推进（收到更小值静默夹紧返回当前值），不得超过会话当前最大 seq（夹紧）。
- reaction：登录可见会话者皆可加/减；对已删除消息回 409；一人同 key 同消息至多一条（unique 兜底幂等）。
- 错误全部走 `ConversationServiceError` 扩 code（app.onError 既有映射，不新建错误类）。

## 3. HTTP 端点（施工=独立路由文件不挂载；挂载/openapi/app.test 白名单=集成者）

| 端点 | 语义 | 成败 |
|---|---|---|
| `PATCH /api/conversations/{id}/messages/{messageId}` | 编辑，body `{text}` | 200 全量消息 VM / 403 / 404 / 409(窗过期・已删除) |
| `DELETE /api/conversations/{id}/messages/{messageId}` | 墓碑删除 | 200 墓碑 VM（幂等：重复删返回现状）/ 403 / 404 |
| `PUT /api/conversations/{id}/messages/{messageId}/reactions/{key}` | 加 reaction（幂等） | 204 / 400(坏 key) / 404 / 409(已删除) |
| `DELETE /api/conversations/{id}/messages/{messageId}/reactions/{key}` | 减 reaction（幂等） | 204 / 404 |
| `PUT /api/conversations/{id}/messages/{messageId}/pin` | 置顶 | 204 / 404 / 409(已删除) |
| `DELETE /api/conversations/{id}/messages/{messageId}/pin` | 取消置顶（幂等） | 204 / 404 |
| `GET /api/conversations/{id}/pins` | 置顶清单，seq 降序 cap 50 | 200 `{messages:[VM]}` |
| `PUT /api/conversations/{id}/read` | body `{last_read_seq}`，单调夹紧 | 200 `{last_read_seq}` |
| `GET /api/conversations/{id}/receipts` | 全部读游标 | 200 `{receipts:[{user_id,last_read_seq}]}` |
| `GET /api/presence?user_ids=` | ≤50 个逗号分隔 uuid，同工作区过滤 | 200 `{presence:[{user_id,is_online,last_seen_at}]}` |

置顶清单走**新路径**而非 GET /messages 加 query（app.test.ts:448 批 0 形状测试钉死了 messages 端点的 query 集合，不去动它）。

## 4. 契约与 SSE（additive）

`eventTypes` 新增 4 名（enums.ts + r12-workbench.test.ts:1287 钉死清单同步扩充，属批准变更）：
- `conversation.message.updated`——编辑/删除/置顶/取消置顶后发布，payload 照 message.created（actor+data=**变更后全量消息 VM**）。客户端按 id 整条替换；本地无此 id → 视 snapshotStale 定点补拉。
- `conversation.reaction.updated`——payload `{conversation_id, message_id, reactions:[{key, user_ids}]}`（**全量聚合幂等替换**，不发增量）。
- `conversation.read.updated`——payload `{conversation_id, user_id, last_read_seq}`。
- `conversation.observer.analyzing`——瞬态（照 typing 模式：ts/expires_at/ttl_ms=30000 literal），观察者开始分析该会话时发布。

消息 VM（conversationMessageBaseShape）新增 optional 字段（openapi 只进 properties 不进 required）：
- `edited_at?`、`deleted_at?`、`pinned?:{at, by_user_id}`
- `reply_to?:{message_id, sender_type, sender_user_id, preview_text(≤80), deleted:boolean}`（读时 join 构建）
- `reactions?:[{key, user_ids}]`（页级一次 grouped 查询，禁 N+1）

reaction key 存储/契约层全 ASCII slug，**emoji 字形只存在于桌面渲染层映射表**：approve=👍 disagree=👎 done=✅ question=❓ watch=👀（不进 css.ts/icons.ts，两道 emoji 门不受影响）。

presence 契约新文件 `packages/contracts/src/domain/presence.ts`（不与会话域混写）。

## 5. 客户端（Wave 2，桌面单 agent）

- 消息行 hover 工具条（回复/反应五键/编辑/删除/置顶，按权限裁剪；触屏长按同菜单）；编辑=行内 textarea；「已编辑」灰标；墓碑=「此消息已删除」占位。
- 引用块渲染于气泡上方，点击跳原消息（滚动+高亮；不在窗口内→beforeSeq 加载）。composer 进入「正在回复 xxx」状态可取消。
- reaction 行渲染在气泡下（own 高亮可点切换）；乐观更新失败回滚。
- 置顶条：聊天区顶部可折叠 pin bar（GET /pins），点击跳转。
- 已读：进入会话/滚到底/窗口聚焦时节流（5s）PUT /read；未读分割线+「跳到未读」浮钮；自己发的最后一条消息下显示「已读 N/M」（他人游标≥seq 计数，M=成员条人数-1）；receipts 初始 GET+SSE read.updated 增量。
- presence：成员条头像加两态圆点（在线=实心/离线=无点），GET /api/presence 30s 轮询+重连时刷新；**render.test.ts:80「不许编造在线态」断言改为「真数据下才渲染」口径**（批准变更）。
- 观察者指示灯：消费 observer.analyzing，typing 指示行同款样式渲「Cuu 正在整理刚才的讨论…」，TTL 到期或行动卡到达即消。
- 桌宠彩蛋（stretch，失败静默）：interrupt-broadcast.ts 加 reaction 事件分支→本地 messages 反查目标消息 `sender_type==='cuu'`→emit workbench-interrupt 带情绪→desktop-cuu-runtime 映射 CuuState（approve/done→celebrating、question→worried、watch→thinking、disagree→worried）。
- 顺路：@picker/改派 picker 加 `data-wb-avatar-user-id` 进头像 hydrate；撤 `/技能` 灰 chip（`#会话` 保留）。
- P1-11 收尾：编辑/删除/reaction 全部乐观 UI+失败回滚+温和话术（沿 turn.ts 分类模式）。

## 6. emoji 纪律豁免边界

reaction 的 emoji 字形只允许出现在：桌面 render 层的 slug→字形映射常量 + 由它拼出的消息 HTML。禁入 css.ts、icons.ts、文档、其他 UI 文案。五键集合扩充须回本文档改表。

## 7. 施工切片

| 工包 | 分支 | 模型 | 范围 |
|---|---|---|---|
| W1-A chat-core | r14/chat-core | opus | 迁移 0055+repos+services+路由文件（不挂载）+契约 3 事件+VM 字段+下游墓碑过滤+测试 |
| W1-B presence-observer | r14/chat-presence | sonnet | presence 读端点+observer.analyzing 事件（契约+worker 发布）+测试 |
| W1-C web-avatars | r14/web-avatars | sonnet | web 人物出现点头像铺开（route-components+样式+测试） |
| W2-A desktop-chat-ui | r14/chat-desktop-ui | opus | §5 全部（Wave 1 合并后发车） |

冲突磁铁（app.ts/openapi.ts/app.test 白名单/contracts index/enums 钉死测试/journal 尾断言）照例集成者手解。全量门=各包 test+typecheck+迁移链 scratch 真库 0000→0055+CI 逐 job 核。
