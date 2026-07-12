# R12 · 桌面工作台施工计划(分批拆解)

> 状态:计划定稿待开工确认 · 2026-07-12
> 上游:[00-interaction-design.md](00-interaction-design.md)(交互定稿,含三轮用户纠偏)· [01-reference-codebases.md](01-reference-codebases.md)(参考仓库借鉴地图)· 原型 `prototype/index.html`
> 迭代编号 R12 暂定(R11 发布加固进行中,分支勿混)。本文件是唯一施工蓝本:每批 = 可独立合并的切片组,批内任务用 checkbox 跟踪。
> **实现者(codex)从 [04-codex-execution-guide.md](04-codex-execution-guide.md) 进入**——那里有铁律、每批的 goal 命令、自查与汇报格式;参考代码已 clone 在 `reference/{openai-codex,codexia,wisp-science}`。

---

## 0. 全局约束(每一批都适用)

**产品红线**
1. AI 写生产必走 提议→审批→合并;主区全自动派活的一切产出落地为提议或版本化文件,绝无直写。
2. 法务/财务/身份类高风险动作永远升级给人,任何模式档位(含全托管)不可关闭此规则。
3. 跨工作区隔离照旧:所有新表带 workspace_id 或经 project 归属推导,所有新端点过 membership 鉴权(SQL 内做,不做全局 cap 后过滤——DF-2 的教训)。
4. 桌面零 key:客户端代码不得出现 provider key 读取路径;AI 配置只从 `GET /api/me/ai-profile` 消费。
5. 预算硬闸照旧:观察者分析、协同 turn、军团 run 全部走 cost reservation;观察者分析计入项目成本(labor-split 记 Cuu)。
6. 去黑话:用户面词汇用「工作副本/提议/采纳/撞车」;把握度只用三话术。UI 不用 emoji(SVG 图标或字符 tile)。

**工程纪律**(历史踩坑,违者必红)
- 新增 `*.test.ts` 写完必跑 `pnpm -r typecheck`(tsx 跑测试不查类型,CI tsc 才逮)。
- 涉库改动必过 PG smoke(真库门);改产线行为同步改 smoke 断言。
- 推送后 `gh run view --json jobs` 逐 job 核 conclusion,不信 `gh run watch` 退出码。
- 只 targeted `git add` 自己改的文件,绝不 `git add -A`。
- web 路由如有增删要同步 routes.test 计数 + shellPageOrder + smoke 计数(本迭代 web 改动少,但 batch 9 文档回真时注意 README 「N 篇文档已落盘」计数门只管 docs/workhub/*.md——r12-desktop-workbench/ 不在门内,勿动计数)。
- 桌面 UI 无法在浏览器 preview 渲染 Tauri 效果(vibrancy/透明窗),切片验收 = typecheck + 单测 + (视觉批)本机 .app 真机截图(`screencapture` CLI,勿点录屏权限框)。
- 毛玻璃只能靠原生 vibrancy(HudWindow),CSS backdrop-filter 在透明 Tauri 窗是空操作;不透明兜底用 .92 实底。
- 实现期若派 subagent:钉死文件范围、禁跑 qa smoke/重生成 artifacts、禁 arm 后台任务(R4-5 教训);fan-out 用经济模型。

**参考规范总纲**(细则见 01,各批引用)
- 事件协议:文本 `*Delta`、生命周期 `*Begin/*End` 成对、`item.started/completed` 兜底 —— codex `protocol.rs:1280-1477`
- 引用安全:前端只存 chip(id+名),后端发送前现查现展开+防注入包裹+截断 —— wisp `lib.rs:1936-2043`
- 有序回放:`UNIQUE(conversation_id, seq)` —— wisp `0000_init.sql:42-55`
- 面板订阅:一条事件流,store 按 id 切片派生,不为每卡开通道 —— codexia `AgentCard.tsx:28-52`
- 中断语义化:取消返回「已运行 Xs 后取消」结果回填,不裸报错 —— codex `parallel.rs:237-261`
- 重试可见:指数退避+抖动+StreamError 事件推前端,不静默 —— codex `util.rs:85-90`

---

## 1. 总览:批次与依赖

```
批0 数据与协议地基 ──┬─→ 批2 主区群聊 MVP ──→ 批3 观察者+行动卡 ──→ 批5 军团面板
                    │                                   │
批1 工作台主窗外壳 ──┘        批4 协同会话+模式五档 ←────┘
                                      │
批6 网盘整合(依赖批1) ←───────────────┘
批7 Cuu 联动与通知(依赖批3/5)
批8 收尾加固+真机验收+文档(依赖全部)
```

批0/批1 可并行;批2 起串行为主(都吃批0 协议)。每批独立 PR、CI 全绿才进下一批;批3 与批4 顺序可互换。

---

## 2. 批 0 · 数据与协议地基(2 切片)

**目标**:会话/消息/AI 档案端点与行动卡存储/协议地基齐,SSE 会话事件可推,群聊数据闭环可用 curl 演示。行动卡 decide/undo 的运行时语义依赖观察者、派发和 abort,归批3实现。

### 表设计(迁移 1 个文件,drizzle schema 进 `packages/db/src/schema/core.ts`)

```
project_conversations
  id uuid pk · project_id fk · kind varchar('main'|'collab') · title varchar(256)
  parent_conversation_id uuid nullable(行动卡拆出的血缘)
  source_message_id uuid nullable · visibility varchar('project'|'private')
  workspace_id uuid not null fk(租户 SQL 过滤) · next_seq bigint default 0(原子分配消息序号)
  created_by uuid nullable fk users(仅兼容存量无 owner 项目;新建项目必填) · timestamps · soft delete
  UNIQUE(project_id) WHERE kind='main' AND deleted_at IS NULL

conversation_participants(仅 collab 用;main 隐含全项目成员)
  conversation_id fk · user_id fk · role('owner'|'member') · timestamps
  UNIQUE(conversation_id, user_id)

conversation_messages
  id uuid pk · conversation_id fk · seq bigint
  sender_type varchar('user'|'cuu'|'system') · sender_user_id uuid nullable
  kind varchar('text'|'file_card'|'action_card'|'system_event'|'tool_note')
  content_json jsonb(结构随 kind;file_card 只存 driveItemId+快照名,不存内容——引用安全规范)
  thread_root_id uuid nullable(行动卡线程) · created_at
  UNIQUE(conversation_id, seq)  ← wisp 规范,有序回放地基

action_cards
  id uuid pk · conversation_id fk · message_id fk · status('active'|'superseded')
  analyzed_to_seq bigint(水位线) · timestamps

action_card_items
  id uuid pk · workspace_id/project_id/conversation_id not null(复合租户/会话边界)
  action_card_id fk · ordinal int
  kind('execute'|'decide'|'observe') · title_md text
  confidence('high'|'mid'|'low') · work_item_id nullable · run_id nullable
  assignee_user_id nullable · status('running'|'done'|'undone'|'waiting_decision'|'dismissed'|'escalated')
  undo_deadline_at timestamptz nullable · timestamps
  复合 FK 保证 action_card/work_item/run 与本项同 conversation/project/workspace;run_id 非空时 work_item_id 必须非空

conversation_observer_state
  conversation_id pk · last_analyzed_seq bigint · active_card_id nullable
  consecutive_failures int default 0 · updated_at

user_ai_profiles
  workspace_id fk + user_id fk · UNIQUE(workspace_id, user_id)
  default_mode smallint(1-5, default 3) · granular_json jsonb(`create_work_item`/`dispatch_run`/`mutate_drive`/`send_notification` 四个可选 bool,缺键=继承)
  dispatch_policy varchar('auto'|'ask'|'manual', default 'auto')  ← 接单策略(03 §0)
  cuu_proactivity varchar('quiet'|'balanced'|'proactive', default 'balanced') · model_tier_pref varchar nullable · timestamps

(agent_runs 扩展列,随批0迁移一并加:execution_hint varchar('server'|'local'|'any') default 'server'
 · source_conversation_id uuid nullable · source_action_card_item_id uuid nullable;复合 FK 绑定来源 workspace/conversation,
 source_action_card_item_id 非空时 source_conversation_id 必须非空。裸 source_conversation 与 run work_item 同项目因
 agent_runs 无 project_id 无法纯 FK 证明,repository/route 必须 fail-closed 校验)

project_ai_governance
  project_id pk · observer_enabled bool default true
  silence_window_secs int default 60 · quiet_hours_json jsonb default `{enabled:false}` · granular_json 同上 · timestamps
  quiet_hours 启用态必须给 runtime 支持的 IANA timezone、0..1439 的 start/end minute 与 1..7 个不重复 weekday(0..6);
  `start_minute == end_minute` 视为无效输入并直接拒绝,不静默解释成全天或零时长。
```

### 端点(新 `apps/api/src/routes/conversations.ts` + pages VM)

- `GET /api/projects/:id/conversations`(树:main+collab 列表)
- `POST /api/projects/:id/conversations`(建协同;main 由建项目原子创建——扩展现有 projects 创建为同事务建 main 会话,create-or-reuse 路径都要补齐 active main)
- `GET /api/conversations/:id/messages?afterSeq=&limit=`(分页游标=seq)
- `POST /api/conversations/:id/messages`(text/file_card chip;服务端校验 chip 的 drive 权限)
- `GET/PATCH /api/me/ai-profile`(下发 provider 档位/预算摘要/模式默认;PATCH 只收偏好字段)
- `GET/PATCH /api/projects/:id/ai-governance`(负责人)
- `GET /api/pages/workbench/:projectId`(有界 bootstrap VM:项目元信息+首屏会话(limit 50)+当前工作区 active membership 切片(limit 100)+项目级可见活跃计划精确计数+最近可见项目文件(limit 5);不返回会话输出/runs/后台任务)

批0 只冻结 `action_cards/action_card_items` 的存储与协议,不提供空壳 decide/undo 路由。`POST /api/action-card-items/:id/decide|undo` 随批3 的观察者、派发、abort 与语义化线程留痕一起交付。

### SSE(扩展 `apps/api/src/sse/`)

- 事件层已实现 topic 族 `conversation` 与严格 `conversation.message.created` payload/生产者(整条已校验消息,含 `seq`),工作台用 `/api/push/stream/conversation/:id` 只订当前会话;现有 `/me` 仍只订个人 topic。其余名字当前只保留名称,没有假 `unknown` payload 或运行时生产者:typing 归批2,`conversation.action_card.updated` 与 `conversation.item.started/completed` 归批3,需要真 turn/LLM 通道的 `conversation.message.delta` 与 `conversation.tool.begin/output_delta/end` 归批4。
- topic-access:按会话可见性鉴权(main=项目所属 workspace 的 active membership,collab=参与者且租户一致);沿用 EC-1 uuid 守卫。broker 不存回放日志,断线恢复必须用 `GET messages?afterSeq=` 补缺口,不得把 `Last-Event-ID` 写成假 reconcile。
- `conversation.presence.typing` 当前只实现严格保留契约(服务端用户身份、固定 3000ms 过期);本批没有生产者,运行时 typing 要到批2 presence/typing 接线后才可宣称可用。typing 瞬态且永不参与 reconcile。

### 任务

- [x] 迁移+schema+repository(含 seq 分配:原子 `UPDATE project_conversations SET next_seq=next_seq+1 RETURNING next_seq`;`UNIQUE(conversation_id,seq)` 是最终防线,不使用会并发撞号的裸 `max(seq)+1`;迁移回填 workspace 非空的 active 存量项目,不为 workspace 缺失的脏项目伪造租户)
- [x] routes + 鉴权 + uuid 守卫 + json-body 校验;repository 单测 + 路由测试
- [x] SSE topic + access + message-created 生产者 + DB reconcile 契约;created/typing 事件 shape 单测(其余事件名仅保留)
- [x] PG smoke 增断言:建项目→main 会话自动存在→发消息→afterSeq 拉取有序(scratch 库全绿,见 reports/batch-0.md)
- [x] `pnpm -r typecheck` 全绿(本地全仓);CI 待分支推送后逐 job 核 conclusion——批 1 推送时一并核,未核前不宣称 CI 绿

**踩雷**:wisp 只提供 seq 唯一约束,没有可复用的并发分配实现;本仓用 PG 原子计数并保留唯一约束兜底,错误不得吞。file_card 绝不落文件内容。
**验收门**:curl 全链路演示(建项目→列会话→发消息→SSE 收到→行动卡表可手插演示);PG smoke 绿。

---

## 3. 批 1 · 工作台主窗外壳(2 切片)

**目标**:Tauri 起独立 workbench 窗(玻璃),三栏外壳+左栏项目树可用,Spotlight/深链可唤起。

- Rust:`client-tauri/src-tauri` 增 workbench WebviewWindow(原生 vibrancy,复用 HudWindow 配置与 R10 玻璃约束);tauri command `open_workbench(project_id?, conversation_id?)`;深链 `workhub://workbench/...` 路由到它。
- 前端:`apps/desktop-webview/src/workbench/`(纯 TS DOM,风格与 spotlight views 一致):`shell.ts`(三栏骨架+右栏收放)、`rail.ts`(项目树/军团总览入口/新建项目模态)、`store.ts`(单一事件流→按会话/run 切片,codexia 规范 01 §7)。
- Spotlight:registry 增「打开 XX 工作台」结果与新建项目 command;跳转走既有 navigate 能力。
- 样式:ds-glass token 复用;原型 `prototype/index.html` 的布局/间距为视觉基准(SVG 图标搬运为共享 symbol 表)。

- [ ] Rust 窗口+command+深链(cargo test;窗口参数有 inline 测试)
- [ ] 三栏外壳+项目树(吃批0 workbench VM)+空态
- [ ] Spotlight 入口两条 + 新建项目模态(调 projects 创建,原子建 main 会话)
- [ ] 单测 + typecheck;**真机 .app 起窗截图**(vibrancy 浏览器验不了)

**踩雷**:透明窗 CSS blur 无效(用原生 vibrancy);新窗与既有 identity/SSE worker 的关系——workbench 窗复用主进程 token,身份边界遵批0 之外正在进行的 R11 identity 约束,不自建第二 token 源。
**验收门**:本机 `open_workbench` 从 Spotlight 唤起,三栏渲染真数据(项目树),截图存档。

---

## 4. 批 2 · 主区群聊 MVP(2-3 切片)

**目标**:全员群聊真可聊:消息流+成员条+composer+SSE 实时+文件卡,多端一致。

- 消息流视图 `workbench/views/chat.ts`:day 分隔、消息气泡、系统事件聚合折叠、文件卡(点击→右栏预览,复用 drive 预览);向上翻页(afterSeq 反向)。
- 成员条:头像+在线(presence 由 SSE session 事件派生)+「正在输入」;不做已读回执。
- composer:文本+ `@` 文件/成员 picker(debounce 搜 drive/成员;chip 只存 id——wisp 规范 01 §6)、`#` 会话、`/` 技能(本批只做 chip 插入,技能展开在批4);拖文件=调 drive 上传+发 file_card。
- Cuu 被 @ 时的普通回答:走批4 的 turn 通道,本批先占位(被 @ 只回「我记下了」系统note?否——本批不接 LLM,@Cuu 暂不响应,避免半吊子;发消息不阻塞)。

- [ ] 消息流+翻页+文件卡+系统事件折叠
- [ ] composer+三种 chip picker+拖拽上传
- [ ] presence/typing 瞬态事件接入
- [ ] 单测(视图纯函数+picker 解析,解析器学 wisp `app_support.rs:494-559` 的纯函数+单测形态);typecheck
- [ ] PG smoke:双用户互发消息实时可见

**验收门**:两个真用户(双浏览器 profile 或双机)在主区互聊、传文件、@引用,SSE 断线重连后 reconcile 补齐不丢序。

---

## 5. 批 3 · 静默观察者 + 行动卡(3 切片)

**目标**:讨论停 60s,Cuu 自动拎活直干;决策项 @负责人进 attention;撤销窗可用。

- worker `apps/api/src/workers/conversation-observer.ts`(仿 agent-runner 的 claim-lease 模式):扫描 观察开启 && 有新消息(seq>水位线) && 静默≥窗口 && 非安静时段 的 main 会话 → 预算 reservation → LLM 分析(输入=水位线以来增量+被引用上下文;输出结构化 plan:items[{kind, title, confidence, suggestedAssignee}])→ 建/追加行动卡。
- 派发:execute 类 → 建 work_item + 按受派人 `dispatch_policy` 分叉(auto=直接建工作副本 branch+enqueue;ask=通知受派人等接单;manual=挂任务列表)——完整链路见 03 §2C;decide 类 → attention 决策收件箱建卡(复用 escalation/approvals 卡模式)+ 群聊 @负责人;observe 类只落卡文。**接单即建工作副本**:run 全程产物锚在副本,人可中途查看/接管,合并仍走审核。
- 追加语义:active 卡存在则 items 追加+卡 message 原地更新(SSE `action_card.updated`);防重复=水位线,无新增讨论不触发。
- 决策与撤销端点在本批实现:`POST /api/action-card-items/:id/decide` 绑定被 @ 负责人/项目负责人权限;`POST /api/action-card-items/:id/undo` 在窗口内执行 abort run + 关闭 work_item + 语义化线程留痕(codex 规范 01 §4),并与 UI 同批验收。
- 行动卡 UI:卡+条目 chips(三话术)+线程(run 事件回贴,终局才冒主流摘要)。

- [ ] worker+水位线+安静时段+预算+失败静默(连续失败进 governance 健康提示,绝不群里刷错)
- [ ] 分析 prompt+结构化输出 schema+judge 自检(低质 plan 丢弃)——prompt 进 packages/agent,带真 key 冒烟一次(经济模型)
- [ ] execute 派发+decide 进 attention(同步改 attention 页断言与 PG smoke)
- [ ] 行动卡/线程 UI+撤销交互
- [ ] 全链路 PG smoke:发言→停 60s(测试时钟可缩)→出卡→run 跑→线程回贴→提议链接出现

**踩雷**:attention 首页改动要同步 `proposal-review-attention.test.ts` 与 smoke(R9.0 教训);观察者与 agent-runner 抢 DB 连接池注意配额;60s 定时器在服务端(多端一致),桌面不做本地定时。
**验收门**:真 LLM 演示一次完整「讨论→行动卡→自动开工→提议待审」,截图+成本记录(预期 <¥0.05/次)。

---

## 6. 批 4 · 协同会话 + 模式五档(3 切片)

**目标**:成员与 Cuu 单聊真能干活:流式回复、工具 chips、产出卡、记忆引用、我的模式。

- turn 通道:`POST /api/conversations/:id/turns` → 轻量 run(kind='chat_turn',复用 AgentRunQueue/预算/审计,军团面板可见)→ SSE 流式(delta/tool 三段式,codex 规范 01 §1)。中断=abort 端点,语义化回填。
- 工具 chips UI:进行中折叠卡吃 Begin/Delta/End;连续只读调用聚合「查阅了 N 个文件」(codexia `ExploredGroup` 模式 01 §8)。
- 产出卡:turn 产出文档改动 → 卡「已起草 XX +a -b」+撤销/交给审核(审核=openProposalFromManifest 复用)。
- 记忆引用:turn 注入的 user_memories/team_skills 以来源清单随响应返回,UI 折叠「N 条记忆引用」。
- 模式五档:ai-profile 接 UI(设置页区块+composer 就地调+数字键);档位语义接 turn/派发管线——1/2 档拦执行,4 档全执行,5 档接 auto_merge verdict(仅 grade5,高风险类别硬升级);Granular 细开关本批落存储+执行侧检查,设置 UI 可后置。
- `#` 会话引用与 `/` 技能在 turn 侧展开(服务端现查+防注入包裹+截断,wisp 规范 01 §6;技能渲染与模型自主 load_skill 复用同一路径,01 §10)。
- 「深入处理」:行动卡条目→建 collab 会话(带血缘+上下文 fork,codex fork 语义 01 §2 的 LastNTurns 思路)。

- [ ] turn 通道+流式+中断+重试可见(退避+抖动+StreamError,01 §11)
- [ ] chips/产出卡/记忆引用 UI
- [ ] 模式档位全链路(存储→执行侧 gate→UI)+ 5 档红线单测(高风险类别在 5 档仍升级)
- [ ] 引用展开三类+防注入包裹单测
- [ ] 真 key 冒烟:一次协同对话产出提议;PG smoke 增 turn 链路

**验收门**:演示「在协同会话让 Cuu 改文档→产出卡→交给审核→提议页可见」;切 5 档演示 AI 审自动合并(低风险样例)+高风险仍升级。

---

## 7. 批 5 · 军团面板(情境面板)(2 切片)

**目标**:右栏三区(输出/军团/后台任务)真数据实时,run 卡下钻详情,per-assignee 执行身份闭环。

- 数据:在真实溯源存在后扩展 workbench VM(会话维度 runs=来源 message/action_card 关联;输出=该会话产出的 drive 版本+提议);后台任务只有在本批补齐/确认真实 scheduled-task 数据模型与项目归属后才可加入,不得拿 `background_jobs`、schedule events 或项目最近文件冒充;另加 `GET /api/conversations/:id/army`。
- runs 需要 per-conversation 列表:agent_runs 加 `source_conversation_id/source_action_card_item_id`(批0 预留列,本批接线)。
- 执行身份:enqueue 时按 assignee 注入其 memories/技能上下文/预算 scope,成本 labor-split 记 assignee(复用 K5);被派人 /me 流收 run 事件→其军团可见+Cuu 气泡(批7 接)。
- UI:三区列表+卡(名字代号:词表生成猫名,存 run 元数据)+详情下钻(时间线=agent_steps 摘要;操作=abort/handoff/replay 既有端点)+过滤。
- 军团总览(轻):左栏入口→按项目分组同款卡片流(读我可见项目 runs 聚合端点,带 cap+分页,防 N+1——R9 审查通病)。

- [ ] runs 溯源列+VM+army 端点(逐 actor 鉴权进 SQL)
- [ ] per-assignee 身份注入+成本归属(真 PG 测)
- [ ] 面板三区+详情+总览 UI;store 切片(01 §7 规范)
- [ ] 猫名代号生成(确定性:runId 哈希→词表,可测)

**验收门**:主区行动卡派给 B 用户→B 的工作台军团出现该 run(执行身份 B、成本记 B)→A 仍可看进度;详情时间线与 replay 一致。

---

## 8. 批 6 · 网盘整合 + git 化呈现(2 切片)

**目标**:网盘常驻标签,聊天互通,版本/回滚用户面可见。

- drive 能力视图迁移进工作台标签(spotlight 内保留,同组件复用);上传目录「聊天上传」自动建。
- 聊天互通:file_card 点击→右栏预览(文本/图片直预览);拖入聊天=上传+发卡;合并后交付物自动归档+系统事件卡。
- git 化呈现:文件行/卡「版本历史」入口(project_drive_versions 列表+回滚动作,回滚=新版本不抹历史);提议合并处「回滚这次采纳」入口(snapshots 复用);文案全程去黑话(「找回之前的版本」)。
- [ ] 视图迁移+互通+预览
- [ ] 版本历史+回滚 UI+端点缺口补齐(先盘 drive.ts 现有版本端点,缺 rollback 则补,走提议红线:回滚也是一次可审计操作)
- [ ] smoke:上传→聊天卡→预览→版本列表→回滚

**验收门**:演示「AI 改坏文件→版本历史一键找回」;这是「敢全自动」的信任演示,录屏存档。

---

## 9. 批 7 · Cuu 联动与通知去重(1-2 切片)

**目标**:桌宠/气泡/系统通知与工作台联动,不双重打扰。

- 抑制规则:workbench 前台聚焦→事件仅窗内呈现;后台/最小化→桌宠气泡+系统通知;点气泡深链拉起窗定位会话/行动卡(深链批1 已有)。
- 被派活方通知:「阿曼在星尘派了个活给我」气泡话术(二次元度对齐 R7 文案规范)。
- 桌宠状态呼应(彩蛋级):项目有 run 跑→偶发专注动作;有决策卡→举牌。
- 注意与 R11 identity/通知 generation 工作的边界:通知 dedupe 遵其 generation 语义,不另起炉灶。
- [ ] 前台检测+路由规则+深链定位
- [ ] 气泡话术+桌宠状态钩子
- [ ] 双端打扰矩阵测试(前台/后台 × 消息/行动卡/派活/提议)

**验收门**:真机演示四象限打扰矩阵符合预期。

---

## 10. 批 8 · 收尾加固 + 验收(2 切片)

- 空态全套(00 §9 表:新项目开场白/断线横幅/撤销态/观察者健康提示/无权深链)。
- 回放:行动卡线程→run replay 跳转;协同会话历史回放(seq 保证)。
- 压缩:长会话观察者输入超限→摘要压缩,压缩事件可见(01 §11);协同 turn 同。
- 性能:消息列表虚拟滚动阈值;军团总览分页 cap。
- 全量 gate:`pnpm verify`+lint+release-gate;PG smoke 全链路;真机图文验收报告(复用 `reference/wh-report/capture.mjs` 管道,桌面部分 screencapture)。
- 文档回真:docs/workhub 增补桌面工作台章节时**同 commit 改 README 计数**。
- [ ] 空态+回放+压缩+性能
- [ ] 验收报告(图文,含四条演示线:群聊闭环/单聊产出/派活跨人/版本回滚)
- [ ] 开放问题清算(00 §11 余项逐条落决议或立 followup)

---

## 10.5 批 9 · 本地执行器(后置,M5,可独立立项)

**目标**:桌面端成为第二执行面,降服务端算力压力;协议本迭代冻结(03 §2E),实现后置。

- 桌面执行器(Tauri 侧常驻,仅用户在线+设置开启):claim 限定 `assignee=本人 && execution_hint∈{'local','any'}`,复用同一 AgentRunQueue 的 SKIP LOCKED+心跳租约;断连→租约过期→服务端 worker 自然接管。
- `POST /api/llm-proxy`:服务端 key + 预算 reservation + 审计 + 限流;桌面零 key 红线不破。可选本地模型档(ollama)——产物同样过服务端 judge。
- 产物上传带 run lease token 签名;**judge/合并/预算/观察者永远只在服务端**(信任边界表见 03 §3)。
- [ ] 协议 contract test 先行(本迭代内可做):claim 过滤/租约接管/产物签名三条
- [ ] 执行器 Rust/TS 实现 + llm-proxy + 本地模型档(后置)

**验收门**:同一 run 断网中断后被服务端接管续跑;本地执行的产物审核合并全程与服务端执行不可区分。

## 11. 明确不做(本迭代)

| 不做 | 原因 |
|---|---|
| web 端工作台 | 桌面先行;web 仅保证新数据在既有页面可见(会话消息 web 只读列表可后补) |
| meta-planner 自动拆解 | R9.1 范畴;行动卡的 items 是观察者单层拎活,不做 DAG 拆解 |
| 子 agent spawn 工具族 | R9.2 范畴;本迭代军团=平铺 runs,表结构已留 parent 血缘 |
| 已读回执/消息撤回编辑 | 刻意不做回执;撤回编辑后置(版本化让风险可控) |
| 语音/富文本 composer | 纯文本+chip 够跑通全链路 |
| 移动/远程遥控端 | codexia 的 EventSink+Axum 镜像方案留档(01 §9),远期 |
| 本地执行器的实现 | 批 9 后置(M5);但协议(claim 过滤/租约/签名/llm-proxy shape)本迭代冻结并出 contract test |

---

## 12. 里程碑与节奏

- M1(批0+1):地基+外壳,curl+空壳窗演示 —— 2 PR
- M2(批2+3):**群聊+观察者 = 本迭代灵魂**,真 LLM 演示 —— 2-3 PR
- M3(批4+5):单聊+军团,模式五档全链路 —— 2-3 PR
- M4(批6+7+8):网盘/Cuu/加固,图文验收报告交付 —— 2-3 PR
- M5(批9,可选/可独立立项):本地执行器 —— 协议 contract test 在 M1 随批0 落,免得后面返工

每个 PR:典型 2-5 文件簇、含测试、CI 8 job 全绿才合;M2 结束做一次中期用户验收(真机),方向偏了在 M3 前纠。
