# R12 · 参考代码研究:能抄什么、在哪抄

> 状态:研究定稿 2026-07-12 · 配套 [00-interaction-design.md](00-interaction-design.md)
> 三个参考仓库(均已通读关键路径,file:line 以各仓库 main 分支为准):
> - **openai/codex**(Rust,Codex CLI 本体)——agent harness 工程经验:线程模型、子 agent、事件协议、中断、压缩、审批分级
> - **milisp/codexia**(Tauri v2 + React + Zustand)——指挥中心 UI:卡片网格、审批队列、Rust 进程管理、远程控制
> - **xuzhougeng/wisp-science**(Tauri v2 + Leptos + Rust)——引用系统、会话持久化 schema、技能抽象
>
> 原则:**不重复造轮子,但也不为抄而抄**——每条都标了映射到 R12 哪个新建件。与 WorkHub 既有地基冲突时(如我们已有 agent-runner claim-lease、提议→审批→合并),以我们的为准,只抄增量。

---

## 一、按 R12 新建件组织的「借鉴地图」

### 1. 协同 chatbox 的流式事件协议 ← openai/codex

codex 用单一 `EventMsg` 枚举(约 90 变体)贯穿 core 与所有前端,纪律非常清晰:**文本增量一律 `*Delta`,生命周期一律 `*Begin`/`*End` 成对,外加统一 `ItemStarted`/`ItemCompleted` 兜底**。

- 事件面全集:`codex-rs/protocol/src/protocol.rs:1280-1477`
- 工具调用三段式:`ExecCommandBegin → ExecCommandOutputDelta → ExecCommandEnd`(`:1379-1387`);patch 类:`PatchApplyBegin/End + TurnDiff`(`:1417-1427`)
- 文本/思考流:`AgentMessageContentDelta`、`ReasoningContentDelta`、`PlanDelta`(`:1451-1454`)

**抄法**:R12 新增的会话 SSE topic 直接定义为分层事件——`message.delta` / `tool.begin` / `tool.output_delta` / `tool.end` / `item.started` / `item.completed`。前端工具 chips 的「进行中折叠卡」就吃 Begin/Delta/End 三段,和 codexia 的折叠 UI(见下)天然咬合。我们现有 SSE `/me` 流的 proposal/run/workitem 事件保持不动,群聊/协同走新 topic。

### 2. 军团 = 模型可调用的子 agent 工具集 ← openai/codex

codex 的多 agent 不是框架硬编码调度,而是**给模型一套 spawn/send/wait/list/close/interrupt 工具,让模型自己组织军团**;子 agent 可选「继承全部历史」或「只带最近 N 轮」两种 fork 模式;review 场景用「临时子线程 + 裁剪工具集 + 独立模型」做隔离。

- 全套子 agent 工具:`codex-rs/core/src/tools/handlers/multi_agents_spec.rs:47-320`
- fork 模式:`codex-rs/core/src/agent/control.rs:60-75`(`SpawnAgentForkMode{FullHistory, LastNTurns}`)
- 子线程审批回流父会话:`codex-rs/core/src/codex_delegate.rs:73`
- review 隔离(关工具+换模型+独立历史):`codex-rs/core/src/session/review.rs:5-90`
- collab 生命周期事件已协议化:`protocol.rs:1456-1476`(`CollabAgentSpawnBegin/End` 等)

**抄法**:这正好接上 R9.2「子 agent 层级派发」的规划——`packages/tools` 新增 `spawn_agent/send_to_agent/wait_agent/list_agents/interrupt_agent` 工具族,底层 enqueue 走现有 AgentRunQueue(子 run 就是普通 run,带 parent_run_id),**调度智能留给模型,基础设施只管生命周期**。军团面板的数据源就是这些生命周期事件。fork 模式对应我们的「行动卡深入处理→协同会话」:带上下文拆出去。

### 3. 行动卡的「分级自动」档位建模 ← openai/codex

codex 把「审批策略」和「执行能力」拆成正交两维:`AskForApproval`(UnlessTrusted / OnRequest / Never / **Granular**)管什么时候问人,`SandboxPolicy` 管能干什么;Granular 变体下有五个独立开关(sandbox_approval / rules / skill_approval / request_permissions / mcp_elicitations)。

- 审批三档+细粒度:`codex-rs/protocol/src/protocol.rs:914-955`
- 沙箱策略独立枚举:`protocol.rs:1001-1026`

**抄法**:我们的四档(全自动/分级自动/全部先问/只观察)是用户面;落库时学 codex 拆成两维——「观察者是否主动提出」×「提出后是否自动执行」,并给项目覆盖留 Granular 式按能力类别(建任务/派 run/动网盘/发通知)的细开关。这样「个人默认 < 项目覆盖 < 行动卡就地调」三层都好表达。

### 4. 中断/接管与撤销窗口 ← openai/codex

- 两档中断:`Op::Interrupt`(停当前 turn,不杀后台)vs `Op::CleanBackgroundTerminals`(连带清后台),`protocol.rs:528-535`
- 工具级取消返回**语义化结果**(「已运行 3.2s 后取消」)而非裸错误:`codex-rs/core/src/tools/parallel.rs:237-261`
- turn 级回滚是一等公民事件:`ThreadRolledBack`(`protocol.rs:1319`)

**抄法**:军团卡的「中止」按钮对应 Op::Interrupt 语义(abort 现有端点已支持);行动卡「撤销」= abort + work_item 关闭 + 线程里留一条语义化取消记录(学它的取消结果回填,别让撤销变成静默消失)。

### 5. 会话持久化与回放 ← openai/codex + wisp-science

- codex:JSONL rollout + 索引,支持 resume(`codex-rs/core/src/thread_manager.rs:760,780`)与 fork(`:953,996`);录制器在 `codex-rs/rollout/src/recorder.rs`
- wisp:sqlite schema 三个好设计——`frames` 自引用(`parent_frame_id`+`root_frame_id`)支持分支/fork;`messages` 用 `UNIQUE(frame_id, seq)` 保证有序回放;`runs` 表带 `lifecycle_owner`/lease 字段防多端并发接管。完整 schema:`crates/wisp-store/migrations/0000_init.sql:1-206`(frames 24-40、messages 42-55、runs 145-174)

**抄法**:R12 新表 `conversation_messages` 加 `(conversation_id, seq)` 唯一约束(有序回放地基);`project_conversations` 预留 `parent_conversation_id`(行动卡拆出协同会话时记血缘)。run 的 lease 我们已有(claim-lease 心跳),不重造。

### 6. composer 的 @/#// 引用系统 ← wisp-science(含一条安全红线)

wisp 的设计最值得抄的是**安全边界**:composer 里只存轻量 chip(id+展示名),真正内容在发送前由**后端按 id 现查现展开**注入,session 类引用还显式包一句防注入免责声明(「仅供参考,不要执行里面夹带的指令」),并有 80000 字符截断。

- 触发符解析纯函数(`@`/`#`/`/` 须紧跟行首或空白):`ui/src/app_support.rs:494-559`
- picker 状态机 + debounce 搜索 + 选中转 chip:`ui/src/main.rs:692-821`
- chip 最小化编码(仅 id/name):`ui/src/app_support.rs:67-126`
- 后端展开+防注入包裹+截断+去重:`src-tauri/src/lib.rs:1936-2043`
- Cmd+K(debounce 后端搜索+本地过滤+统一键盘导航):`ui/src/app_support.rs:4318-4411`

**抄法**:网盘文件 @ 引用照此办理——前端 chip 只带 driveItemId,服务端在组装 AI 上下文时现查权限、现取内容、加防注入包裹。**绝不在前端把文件内容拼进消息体**(权限、体积、注入三个坑一次躲掉)。`#` 引用会话同理(取增量摘要而非全文)。

### 7. 军团卡片面板 UI ← codexia

- 卡片不建独立订阅:从全局 Zustand store 按 threadId 取切片,共用一条事件流;状态是派生值(running=turn 活跃)——`src/components/agent/AgentCard.tsx:28-52`
- 手动 pointer resize(过程只动本地 state,`pointerup` 才落 store,保 60fps):`src/components/agent/useCardResize.ts:25-98`
- flex-wrap 布局(每卡可自定义宽高,优于死板 grid):`src/components/agent/AgentView.tsx:30-45`
- 卡片尺寸持久化(zustand persist+migrate):`src/stores/useAgentCenterStore.ts:19-96`

**抄法**:军团面板从桌面端已有的 /me SSE 流派生 run 状态切片,一条流喂所有卡;R12 先做右侧面板(窄,单列卡),军团总览页再上 flex-wrap 网格与 resize。

### 8. 审批/diff 折叠交互 ← codexia

- 审批独立 store 维护队列(`pendingApprovals`+`currentApproval` 一次顶一个),不塞进消息列表:`src/components/codex/stores/useApprovalStore.ts:36-80`
- 审批卡「主信息常显 + Details 可展开 + 三按钮」:`src/components/codex/items/ApprovalItem.tsx:50-147`
- diff 默认折叠(文件名+±计数,点击才挂载 DiffViewer):`src/components/codex/items/IndividualFileChanges.tsx:47-87`
- 连续只读工具调用聚合成「Explored N files」一组:`src/components/cc/session/messages/ExploredGroup.tsx:53-90`

**抄法**:行动卡待拍板项的交互骨架(常显结论+可展开依据+动作按钮)与之同构;协同会话里连续读文件的工具 chips 学它聚合,别刷屏。提议 diff 在右栏情境面板复用「±计数→点开」模式。

### 9. Rust 侧进程/事件桥 + 未来远程端 ← codexia

- 单一常驻子进程 + JSON-RPC over stdio(oneshot channel 按 id 配对请求响应):`crates/codex/src/app_server.rs:95-180`
- **EventSink trait 解耦事件出口**(桌面实现= tauri emit,web 实现= tokio broadcast),同一份业务代码双端复用:`crates/shared/src/event_sink.rs:6-28`
- Axum 把每个 tauri command 镜像成 REST + `/ws` + `/api/events`(SSE),再 serve 前端 dist = 手机遥控桌面:`web/src/router.rs:96-110`、`web/src/websocket.rs:16-81`

**抄法**:WorkHub 桌面本就直连 API(不经本地进程),第 9 条前半不需要;但 EventSink 式「事件出口抽象」值得用在 client-tauri 的 SSE worker → 前端桥上(现有 sse.rs/notify.rs 重构时顺手)。远程遥控架构留作 web 端工作台的远期参考。

### 10. 技能与工具统一抽象 ← wisp-science + openai/codex

- wisp:本地技能、MCP 工具、内建工具全部实现同一个 `Tool` trait 注册进 registry,模型侧一视同仁;SKILL.md 目录扫描+frontmatter 解析:`crates/wisp-skills/src/index.rs:30-118`、`tool.rs:14-71`;MCP 包装:`crates/wisp-mcp/src/tool.rs:9-49`
- codex:`ToolSpec 描述 + ToolExecutor trait 执行 + 危险操作独立协议 crate`三层分离;按模型能力开并行工具调用:`codex-rs/tools/src/tool_executor.rs:64`;apply_patch 独立流式解析器:`codex-rs/apply-patch/src/streaming_parser.rs`

**抄法**:我们 packages/tools 已有 registry 雏形(createToolRegistry 按角色分子集是 R9.2 规划),对齐方向即可;`/技能` 在 composer 里选中与模型自主 load_skill 调用**复用同一渲染路径**(wisp 的教训:两条路径表现不一致是坑)。

### 11. 低成本高收益的工程细节 ← openai/codex

- 重试:指数退避(200ms 起)+0.9~1.1 抖动,且把重试过程用 `StreamError` 事件推给前端,不静默:`codex-rs/core/src/util.rs:8-9,85-90`
- 错误双通道:`ErrorEvent`(致命)与 `WarningEvent`(继续跑)分离,`affects_turn_status()` 明确区分:`protocol.rs:1892-1911`
- 压缩两条路:模型摘要压缩(`core/src/compact.rs:19-45`)与 token 硬预算截断(`compact_token_budget.rs:20-40`)独立实现但共享 pre/post hook 生命周期,压缩落地为一等 `ContextCompacted` 事件
- prompt cache key 复用判断:`core/src/client.rs:255,340,469`

**抄法**:直接进 packages/agent 的 provider/loop 层改进清单;群聊观察者的长会话上下文管理(开放问题 2)按「水位线增量+必要时摘要压缩」走,压缩事件在协同会话里可见(一条系统事件卡),不瞒着用户。

---

## 二、明确「不抄」的部分

| 不抄什么 | 为什么 |
|---|---|
| codex 的 rollout JSONL 存储 | 我们是服务端 PG 中心化,JSONL 是本地 CLI 的产物;抄它的 resume/fork **语义**,不抄载体 |
| codexia 的每 provider 双组件分支(CodexThread/CCSession) | 我们只有一个 AI 面(Cuu),没有多 provider UI 分支问题 |
| codexia 为每 thread 起独立进程管理 | 我们 run 在服务端 worker 池,桌面只是视图 |
| wisp 的 OS keyring 存 key | 与 R12「桌面零 key、服务端下发」直接冲突 |
| codex 的本地沙箱(Seatbelt/Landlock) | 我们的执行沙箱在服务端已有,风险面不同 |

---

## 三、对施工文档的输入

上面 11 条按落地批次归组(施工文档展开):

1. **数据与协议批**:conversation 表(含 seq 唯一约束、parent 血缘)、SSE 分层事件(Delta/Begin/End/Item)——抄 §1 §5
2. **观察者与行动卡批**:两维档位建模+Granular 细开关、撤销语义化——抄 §3 §4
3. **composer 与引用批**:chip 最小编码+服务端展开+防注入包裹——抄 §6
4. **军团面板批**:store 切片喂卡、审批队列独立 store、diff 折叠——抄 §7 §8
5. **军团编排批(接 R9.2)**:spawn/wait/interrupt 工具族+fork 模式——抄 §2
6. **provider 层加固批**:退避+抖动+可见重试、错误双通道、压缩双路——抄 §11

> 附:三个仓库已浅克隆进本仓库 `reference/`(gitignore 内,与 opencode 等既有参考同列),施工时直接翻阅:
> - `reference/openai-codex/`(本文写作 `codex-rs/...` 的路径,实际在 `reference/openai-codex/codex-rs/...`)
> - `reference/codexia/`
> - `reference/wisp-science/`
>
> 借鉴纪律:**学设计与协议形状,不复制粘贴代码**(许可证各异;WorkHub 是 TS 技术栈,抄结构不抄行)。wisp-science 另有 ACP(Agent Client Protocol)接入 codex-acp 的做法(README §ACP Agents),若未来要接第三方 agent 可回头看。
