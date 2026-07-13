# R13 批 G1 · 小群 —— 完成汇报

> 分支：`r13/g1-small-groups`（从 `origin/main @ 63aa2bae` 拉出）
> 依据：`r13-workbench-refinement/01-new-batches-design.md` 第六节（批 G1）+ `00-plan.md` Cuu 角色总纲
> 迁移编号：`0048_small_group_cuu_enabled.sql`（并行批 4c 占用 0049，本批未越界）

## 做了什么

1. **数据地基**：`project_conversations` 加 `cuu_enabled boolean not null default true`（迁移 0048 + `schema/core.ts` + journal）。地基本身早已支持小群（`conversation_participants` 天然多人、`createCollab` 早支持 `participantUserIds`），这次只补了唯一缺的一列。
2. **契约（additive）**：`createConversationRequestSchema` 加 `cuu_enabled: z.boolean().default(true)`；`conversationVmSchema` 加 `cuu_enabled: z.boolean()`（输出侧必填，服务端总能产出具体值）。
3. **仓库层**：`createCollab` 写入 `cuuEnabled`（可选入参，省略时仓库退回 `true`，与列默认值/契约默认值三处一致）；`findVisibleAccessRecord` 新增 `participantCount`（真实参与者行数，来自一次额外的、有界的 `count(*)` 查询——只加在这一个方法上，`listMessagesAfter/Before` 复用的内部 `readVisibleAccess` 不背这次多余查询，那是高频轮询路径）。
4. **服务端回话语义（`conversation-turns.ts`）**：
   - **cuu_enabled 硬闸**：`access.conversation.cuuEnabled === false` → 409 `conversation_turn_cuu_disabled`，排在 mode 检查、@ 提及、判定器**之前**——用户拍板的"强静默不可绕过"，即便触发消息里 @Cuu 也不例外（专门写了回归测试钉死这条优先级）。
   - **"被 @ 必回"**：新增导出纯函数 `mentionsCuu(text, displayName="Cuu")`（大小写不敏感、带词边界，"reticuum"/"Cuuxyz" 不误命中）。触发消息命中提及时**跳过判定器**直接回应，任何未来判定器都无法覆盖这条。
   - **判定器接缝**：新增 `ConversationTurnRespondDecider` 类型 + `deps.respondDecider` 可选注入点；没提及时才会问它，问了且它说 false 就 409 `conversation_turn_not_warranted`。默认实现 `defaultConversationTurnRespondDecider` 永远返回 `true`——4c 批次落地前零回归（今天所有协同会话，1:1 还是小群，只要客户端发起 turn 请求就还是一定有回应）。**1:1 的"必回"特例没有在 createTurn 里硬编码**——按设计原文，这是未来真判定器自己的职责，我只保证默认判定器（永远 true）不会破坏它；专门写了一条测试证明"就算是 participantCount=1，注入的判定器返回 false 也会被听从"，钉死"只有 @ 是硬覆盖，1:1 不是"这条边界。
5. **前端 · 建群模态**（`rail.ts`）：把批 P2 的"点一下用自动标题建一条只有自己的会话"升级成真模态——标题输入 + 成员多选（工作区成员，按 `is_self` 排除自己）+ Cuu 参与开关（默认开）。提交时把 `participant_user_ids`/`cuu_enabled` 传给 `createCollabConversation`（两个新参数都是可选的，省略时请求体与升级前完全一致，不破坏既有调用方）。
6. **前端 · 错误提示**（`chat/turn.ts`）：新增 `conversation_turn_cuu_disabled`/`conversation_turn_not_warranted` 两条中英文温和提示，顺手更正了同一段注释里一条过时的说法（原注释说 app.ts 没接 `ConversationTurnServiceError` 的专属分支会被 500 兜底吞码——实际上 app.ts 早就接了，注释记错了）。
7. **回归测试（钉死既有事实，不改代码）**：
   - `packages/db/src/action-cards-repository.test.ts`：新测试断言 `listObserverCandidates` 的 WHERE 子句绑定值只含 `'main'`，从不含 `'collab'`——证明 60 秒主区观察者从数据库查询层面就与"cuu_enabled 是否为 true 的小群"无关，永远不会把小群拉去拆行动卡。
   - `apps/desktop-webview/src/workbench/chat/render.test.ts`：新测试证明 `renderMessageHtml`/`senderLabel` 对 3 个不同真人发言人各自解析到正确昵称——小群消息流的多人昵称解析本来就是一次 `Map` 查找，不需要为群聊场景做任何改造（设计稿"多人昵称解析不是风险点"一节的结论）。

## 改动文件清单

- `packages/db/migrations/0048_small_group_cuu_enabled.sql`（新文件）
- `packages/db/migrations/meta/_journal.json`（追加 idx=48 条目）
- `packages/db/src/schema/core.ts`（`projectConversations.cuuEnabled` 列）
- `packages/db/src/schema.test.ts`（更新"journal 结尾"断言到 0048；新增 0048 迁移内容 + 列属性断言）
- `packages/db/src/repositories/conversations.ts`（`conversationSelection` 加列；`CreateCollabConversationInput.cuuEnabled` 可选；`createCollab` 写入；`ConversationAccessRecord.participantCount` + `findVisibleAccessRecord` 新增一次有界 count 查询）
- `packages/db/src/conversation-repository.test.ts`（fixture 补 `cuuEnabled`；新增 cuu_enabled 默认值/显式 false 的写入测试）
- `packages/db/src/conversation-runs-repository.test.ts`（ripple：`findVisibleAccessRecord` 多一次查询，4 个既有测试补响应数组/改断言，见下）
- `packages/db/src/action-cards-repository.test.ts`（新增 observer 排除小群的回归测试）
- `packages/contracts/src/domain/conversation.ts`（`createConversationRequestSchema`/`conversationVmSchema` 加 `cuu_enabled`）
- `packages/contracts/src/r12-workbench.test.ts`（ripple：多处 fixture 补 `cuu_enabled`；新增 default/显式 false 断言）
- `apps/api/src/services/conversations.ts`（`conversationToVm` 输出 `cuu_enabled`；`createConversation` 透传给仓库层）
- `apps/api/src/conversations.test.ts`（ripple fixture 补字段；新增显式 `cuu_enabled:false` 透传测试）
- `apps/api/src/conversation-routes.test.ts`、`apps/api/src/workbench-pages.test.ts`、`apps/api/src/drive-pages.test.ts`（ripple：fixture 补 `cuu_enabled`/`cuuEnabled`，无行为断言变化）
- `apps/api/src/services/conversation-turns.ts`（cuu_enabled 硬闸 + `mentionsCuu` + 判定器接缝 + `respondDecider` 依赖注入点）
- `apps/api/src/conversation-turns.test.ts`（新增硬闸优先级、@提及覆盖、判定器接缝、`mentionsCuu` 边界共 13 条测试）
- `apps/desktop-webview/src/workbench/rail.ts`（建群模态：`renderNewCollabModalHtml`/`NewCollabModalUiState`/`createCollabConversation` 扩参/挂载事件）
- `apps/desktop-webview/src/workbench/rail.test.ts`（ripple fixture；新增建群模态渲染测试共 10 条）
- `apps/desktop-webview/src/workbench/chat/turn.ts`（两条新错误码的中英文提示 + 更正一条过时注释）
- `apps/desktop-webview/src/workbench/chat/turn.test.ts`（新增 4 条错误提示测试）
- `apps/desktop-webview/src/workbench/chat/render.test.ts`（新增多人昵称解析回归测试）

## 自查输出

```
pnpm -r typecheck                          → 16/16 workspace projects: Done，0 error
pnpm --filter @workhub/db test             → tests 254 / pass 252 / fail 0 / skip 2（真 PG 矩阵，本机已单独验证见下）
pnpm --filter @workhub/api test            → tests 1121 / pass 1120 / fail 0 / skip 1
pnpm --filter @workhub/contracts test      → tests 99 / pass 99 / fail 0
pnpm --filter @workhub/desktop-webview test→ tests 816 / pass 816 / fail 0
```

测试数量变化（新增，均为真断言，无 `assert(true)` 式空测）：db +7、api +18（conversation-turns 13 + conversations 1 + 其余为 ripple 修复未增删断言数）、contracts +2、desktop-webview +23（rail 10 + turn.test 4 + render.test 1，另有既有测试因 ripple fixture 补字段但断言数不变）。

**真库验证**（`workhub-postgres-1` 容器，scratch 库 `wh_g1_scratch`，验完已 DROP）：

```
$ DATABASE_URL=postgresql://workhub:workhub@localhost:5432/wh_g1_scratch node --import tsx src/migrate.ts
WorkHub database migrations applied   # 0000→0048 全量迁移链在真 PG 上一次跑通

$ psql ... information_schema.columns WHERE table_name='project_conversations' AND column_name='cuu_enabled'
 column_name | data_type | is_nullable | column_default
 cuu_enabled | boolean   | NO          | true            # 与设计/迁移文本完全一致
```

## 我改过的断言（如有，附理由）

1. `packages/db/src/schema.test.ts`："migration journal ends with 0047 task plan status" → 改名并把期望值从 `{idx:47, tag:"0047_..."}` 改成 `{idx:48, tag:"0048_small_group_cuu_enabled"}`。理由：这条测试的语义是"钉住 journal 当前的最后一条"，每次合法新增迁移都要把它推进到新的尾巴——这正是 0047 自己当初对 0046 版本做的同一件事，不是迁就实现而是维护一个必然随时间演进的断言。
2. `packages/db/src/conversation-runs-repository.test.ts`：4 处 `createQueryRecorder([...])` 调用插入了一条 `[{ value: 1 }]` 响应，其中 1 处同时把 `queries.length` 断言从 `2` 改成 `3`（连带改了断言失败提示文案）。理由：`findVisibleAccessRecord` 现在会为 `participantCount`（回话判定的"1:1 vs 小群"维度）多发一次**有界**的 `count(*)` 查询——仍是 O(1) 次固定查询，不是循环触发的 N+1，但确实是这次改动引入的真实新查询，断言必须如实反映，不能装作没有它。

## 挂载清单（给集成者）

以下改动**因为超出本批范围围栏（禁碰 `app.ts`/`openapi.ts`）没有落地**，需要集成时补上：

1. **`apps/api/src/openapi.ts`**：
   - `conversationResponseSchema`（约 4433 行起）：`properties` 加 `cuu_enabled: { type: "boolean" }`，`required` 数组加 `"cuu_enabled"`。
   - `createConversationRequestBodySchema`（约 4717 行起）：`properties` 加 `cuu_enabled: { type: "boolean", default: true }`（保持可选，不进 `required`）。
   - `conversationTurnResponses` 的 `"409"` 分支（约 5206 行）：错误码数组加 `"conversation_turn_cuu_disabled"`、`"conversation_turn_not_warranted"`（后者当前默认判定器不会触发，但代码路径已存在，建议一并声明）。
2. **`apps/api/src/app.ts`**：**不需要改动**——`ConversationTurnServiceError` 已经有通用透传分支（第 386-401 行左右），新错误码自动生效，已用路由测试验证。
3. **迁移编号冲突**：0048 是本批显式分配到的编号；`4c` 并行批用 0049。若还有其它未知的并行批同样落在 0048，按设计稿约定的规则处理——先落地者占 0048，后落地者顺延，journal 需要人工重新排序衔接。

## 范围外发现（不修，只报）

1. **成员条头部仍显示全部工作区成员 + 硬编码"全员群聊"文案**（`apps/desktop-webview/src/workbench/chat/render.ts` 的 `renderMemberBarHtml`，`view.ts` 调用点传入的 `input.members` 是整个工作区成员列表，不是这个会话的真实参与者）——这是 P2 落地时就有的既有问题，小群功能让它更显眼（3 人小群的头部会画出工作区全体成员并宣称"全员群聊"）。修复需要给会话补一条"真实参与者列表"的读路径，装配点在 `shell.ts`（调用 `mountChatView` 的地方）——`shell.ts` 不在本批文件范围内，故未动。建议后续小批：给 `conversationVmSchema`/`listConversations` 加一个有界的参与者摘要字段，`shell.ts` 接线传给 `mountChatView`。
2. **建群模态没有专属 CSS**——`apps/desktop-webview/src/workbench/css.ts` 不在本批范围内。模态外壳（遮罩/卡片/标题/输入框/按钮）复用了"新建项目"模态已有的 `.wh-wb-modal*` 类，视觉一致；但成员复选行（`.wh-wb-new-collab-member-row`）、Cuu 开关（`.wh-wb-new-collab-cuu-toggle`）、空态提示（`.wh-wb-new-collab-member-empty`）三个新类目前吃浏览器默认样式，能用但不精致，需要一个小的 CSS 收尾批次。
3. **限频合并（判定器调用限流）未实现**——设计稿验收门提到"群里连续发 5 条无人 @Cuu 的消息,验证判定器只被调用一次"，这属于 4c 批次的判定器算法本身（规则前置+小模型），本批只留了调用接缝（`respondDecider`），不做限流/合并——如实标注，不冒充已完成。
4. **生产行为暂未改变**——`getDefaultConversationTurnService()` 没有配置 `respondDecider`（用默认实现，永远放行），桌面客户端 `shouldRequestConversationTurn` 也没有改动（仍然只按 `conversationKind==='collab'` 门控，不看参与人数/提及）。也就是说：小群功能落地后，**Cuu 今天仍然会回应小群里的每一条消息**，不会因为"没人 @她"而沉默——这是有意的过渡态（判定器是 4c 的活），不是遗漏，但用户实机试用小群时会看到"Cuu 很话痨"，需要心理预期对齐或等 4c 落地。

## 没做 / 存疑

- 4c 判定器本身（规则前置 + 小模型、限频合并、预算意识）——按范围围栏明确不做，只留接缝。
- 成员条头部真实参与者渲染——见"范围外发现 1"，需要 `shell.ts` 配合，超出本批文件边界。
- 建群模态的 CSS 收尾——见"范围外发现 2"。
- `openapi.ts`/`app.ts` 需要的两处补丁——见"挂载清单"，已详细列出具体位置和内容，留给集成者落地。
