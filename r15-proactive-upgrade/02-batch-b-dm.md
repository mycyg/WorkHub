# 批次 B:人对人私聊 + 在线状态

目标:「看谁在线,点头像私聊」。数据层与消息管道已通(collab 会话 + 2 参与者 + `cuu_enabled=false`,消息/编辑/删除/引用/置顶/反应/已读/SSE 全套工作,权限已验证无管理员后门),本批做入口、容器、查重、roster 四件事。依赖批次 A 的通知管道(否则接收方无感知)。

## B1 DM 容器项目(已拍板方案)

**问题**:`project_conversations.project_id` NOT NULL(迁移 0046 全线复合 FK),没有脱离项目的会话容器。

**做法**:
- 每工作区惰性创建一个系统容器项目(`is_dm_container=true` 新列,或复用 `is_personal` 模式加新枚举——施工时看 projects 表现状取窄者),首次有人发起 DM 时原子创建,复用「项目 main 会话原子创建」的既有先例。
- 围栏:容器项目不出现在项目列表/项目树(rail 过滤),不可归档、不可加工作项;可见性沿用 collab 参与者判定(`visibleConversationCondition`),容器本身不给任何人"项目级"入口。
- 明确不做:`project_id` nullable 迁移(改动面大,收益等价)。

## B2 会话查重(dm_key)

**问题**:`createCollab` 每次直接 INSERT,无同两人查重(`conversations.ts:932-1060`);点头像开聊会越点越多。

**做法**:
- `project_conversations` 加 `dm_key text` 列 + 部分唯一索引(`WHERE dm_key IS NOT NULL`)。`dm_key = 'dm:' + sorted([userA, userB]).join(':')`,workspace 维度天然由容器项目限定。
- 新服务方法 `openOrCreateDm(actor, targetUserId)`:查 dm_key → 有则返回既有会话;无则事务内建会话 + 2 参与者 + `cuu_enabled=false`,冲突(并发双开)时捕获唯一约束冲突改查询返回。**DM 会话固定 2 人不可拉人**(要拉人=另建协同会话,入口引导),kind 仍用 `collab`,靠 `dm_key IS NOT NULL` 区分,不加新 kind 枚举(避免炸 CHECK 约束与全部 kind 分支)。
- 端点:`POST /api/dm/open`,body `{ user_id }`;校验目标与 actor 同工作区(workspace_memberships)。

## B3 成员 roster(「看谁在线」)

**数据源**:workbench VM 的 `workspace_members`(cap 100,严格工作区过滤)+ `GET /api/presence?user_ids`(≤50 一批,分批查)。**禁用 `GET /api/users`**(auth.ts:849,无工作区过滤,跨租户泄漏昵称/admin 态——既有债务,顺手在该端点注释上加警示)。

**做法**:
- rail 新增「成员」分组或 Cmd+K 新 tab:头像 + 昵称 + 在线绿点(复用 `avatarTileHtml` 的绿点),在线者排前,30s 轮询 + SSE 重连即时刷(复用 `presence-state.ts` 节奏)。
- 超 100 人工作区:本批接受 cap(显示「前 100 名」),分页/搜索列为后续项——与既有 capped 三件套口径一致。
- 点成员行 → `openOrCreateDm` → 打开会话。自己那行不显示或点击进个人空间。

## B4 点头像开聊(全局手势)

**现状**:所有头像纯展示(`data-wb-avatar-user-id` 只用于叠照片,零点击行为)。

**做法**:
- 统一头像点击 → 资料 popover(昵称/角色/在线态 + 「发私聊」按钮 + 后续可挂"TA 的工作项");聊天气泡、成员条、建群选人器外的头像全走同一 popover。选人器内保持勾选语义不变。
- popover「发私聊」→ B2 端点。对自己显示「个人空间」。

## B5 Cuu 在私聊中(默认不在,已拍板)

- DM 创建即 `cuu_enabled=false`。会话头部开关可请 Cuu 进来(复用 G1 硬开关语义:false 时服务端 409 拒绝回话判定)。
- 请进来之后 @Cuu / 自动 turn 行为与协同会话一致;再关掉即退场。私聊内容永不进入 Cuu 观察者(conversation-observer 只挂主区,现状即如此,验收时断言)。
- 这是批次 F(主动关怀)的预留投递通道:Cuu 的问候/关怀走「用户曾主动开启 Cuu 的私聊」,永不进团队主区。

## B6 通知与未读(依赖批次 A)

- DM 新消息即 A5 的 `conversation.message` 通知(收件人离线/未看该会话时);rail 红点即 A4 的 unread_count。
- 验收含端到端:A 给 B 发第一条 DM → B 桌面 OS 通知 → 点击深链落在该会话,红点消退,已读 1/1(分母修复后)。

## 边界与暂缓

- web 端不做(web 无聊天 UI,R14 已有「web 只读会话镜像」B 级待办,双端交互规划见 04)。
- 已读回执维持聚合式 N/M 既有拍板,不做逐人列表。
- 跨工作区 DM 不存在(目标必须同工作区)。

## 验收门

- 单测:dm_key 归一化/并发唯一冲突回退;openOrCreateDm 幂等;容器项目惰性创建原子性;presence 分批查询。
- 真 PG smoke:双人互发 → 已读游标 → 编辑/删除/引用在 DM 内全通;Cuu 开关 409 语义。
- 权限断言:第三人(含 admin)读不到 DM 会话/消息/搜索结果;DM 不出现在项目树。
- 桌面手验 + `pnpm -r typecheck`。
