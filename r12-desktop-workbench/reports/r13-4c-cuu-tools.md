# R13 批4c 完成汇报（Cuu 对话工具面 + 回话判定器）

日期: 2026-07-13 · 执行: Claude · 分支: `r13/4c-cuu-tools`（基线 `63aa2bae`，拉自 `origin/main`）
来源: `r13-workbench-refinement/01-new-batches-design.md` 一、批4c + 00-plan.md §6 N9（回话判定器）
+ 「Cuu = 项目经理」角色总纲。未合并、未推送。

## 做了什么

1. **受限工具环**（`packages/agent/src/turns/tools.ts` 新文件 + `apps/api/src/services/
   conversation-turns.ts` 核心重写）：`createTurn` 从单发流式升级为最多 4 轮模型调用的小型
   agentic 循环。四个工具：`drive_search`（只读检索，复用既有 `DrivePageService.page()`）、
   `send_file_card`（复用 `DrivePageService.file()` 权限校验后落一条真实 `file_card` 消息）、
   `create_work_item`（复用既有 `WorkItemService.createWorkItem`，仅在澄清位满足时对模型可见）、
   `ask_clarifying_question`（终止型工具，见下）。硬顶 3 次工具调用 + 1 轮强制无工具收尾轮，
   `allowTools` 门槛保证有限轮内必然终止（不依赖模型"自觉不再调用"）。每次工具调用落一条
   `tool_note` 透明日志（复用既有 DB kind，未新增迁移）。预算软闸从"只在开头查一次"修订为
   "每一次额外的模型调用前重新检查"（design"踩雷"点名的已知缺口）。半截/参数不对的 `tool_use`
   一律生成配对的错误 `tool_result`（不是事后摘除悬空块），单测覆盖了这条路径。
2. **系统 prompt 重写**（`packages/agent/src/turns/prompt.ts`）：批4a"不要声称已经修改了文件、
   发起了任务"的边界语言与新工具能力冲突，重写为"精确开放只读检索/发文件卡/建工单三件事，同时
   保留不能改文件内容/不能合并/不能审批的红线"。`buildTurnSystemPrompt` 新增可选
   `pendingClarification` 参数，注入"这是你上次提问的回答"提示。
3. **澄清反问**（消息流位置推导，无旁路状态字段）：`findPendingClarification` 检查历史窗口里
   紧邻触发消息之前的一条是否是 Cuu 发的、带 `is_clarifying_question=true` 标记的 `text`
   消息——满足则解锁 `create_work_item` 工具（双重红线：工具可见性 + 服务端执行前二次校验，
   纵深防御模型无视工具清单直接编出调用名的情形）。
4. **回话判定器**（`packages/agent/src/reply-judge/` 新包）：`rules.ts`（@Cuu 词边界匹配 +
   命令式请求 + 纯寒暄三条规则前置，纯函数）、`throttle.ts`（30s 限频合并 + 幂等判定水位线，
   纯函数）、`prompt.ts`（便宜档 LLM 分类 prompt/parse，PM 判断口径）、`judge.ts`（编排：
   cuu_enabled 门禁 > 单聊必回特例 > 规则前置 > LLM 兜底，保守默认"不回"）。服务端接线
   `apps/api/src/services/conversation-reply-judge.ts`（扫真小群候选 → 判定 → 复用既有
   `createTurn` 触发回复，用"最后发言人"合成 `AuthActor`）+ 薄壳调度
   `apps/api/src/workers/conversation-reply-judge.ts`（照抄 conversation-observer.ts 的
   tick/start/stop/stats 形态）。
5. **前端最小接线**（`apps/desktop-webview/src/workbench/chat/{render,view}.ts`）：澄清追问渲染
   独立视觉（"Cuu 在问"标签 + 左侧强调条），`clarify_options` 渲染成真实可点的选项按钮（点击
   直接填进输入框并聚焦，不是摆设）；@ picker 加 Cuu sentinel 候选（排最前、用猫头像变体）。
   全部行内样式，未碰 `css.ts`/`icons.ts`（不在本批范围围栏内）。「Cuu 正在看」判定期间指示——
   诚实砍掉：判定器是服务端异步 tick，没有一个"正在判定"的实时信号可以推给前端（不像 turn 是
   请求-响应式的），要做需要新的 SSE 事件或轮询，超出本批范围，未做。

## 改动文件清单

**新增**：
- `packages/agent/src/turns/tools.ts` / `tools.test.ts` — 工具 schema + 纯解析（13 项测试）
- `packages/agent/src/reply-judge/{types,rules,throttle,prompt,judge,index}.ts` +
  对应 4 份 `.test.ts` — 判定器纯逻辑（rules 12 项 + throttle 5 项 + prompt 7 项 + judge 10 项）
- `apps/api/src/services/conversation-reply-judge.ts` / `.test.ts` — 判定器服务端接线（9 项测试）
- `apps/api/src/workers/conversation-reply-judge.ts` / `.test.ts` — 定时调度薄壳（5 项测试）

**修改**：
- `packages/agent/src/turns/{prompt.ts,index.ts}` — 系统 prompt 重写 + 导出新模块
- `packages/agent/src/turns/prompt.test.ts` — 断言随 prompt 重写更新（见下"我改过的断言"）
- `packages/agent/package.json` — 加 `./reply-judge` 子路径导出（不在字面范围围栏内，见下方说明）
- `packages/contracts/src/domain/conversation.ts` — `conversationTextContentSchema` 加三个
  additive 可选字段（`is_clarifying_question`/`clarify_options`/`clarify_placeholder`）
- `packages/db/src/repositories/conversations.ts` — `createCuuMessage` 输入类型扩成判别联合
  （text/file_card/tool_note，全是既有 DB kind，未改 schema），新增 additive 方法
  `listReplyJudgeCandidates`
- `packages/db/src/conversation-repository.test.ts` — 补 7 处 `kind: "text"` 显式字段（接口
  扩成判别联合后的必要机械更新）+ 新增 8 项测试覆盖新分支/新方法
- `packages/db/src/test-query-recorder.ts` — 补 `.having()` 透传方法（不在字面范围围栏内，见下方说明）
- `apps/api/src/services/conversation-turns.ts` — 核心重写（见上）
- `apps/api/src/conversation-turns.test.ts` — `baseDeps` 补 `drive`/`workItems` 桩 + `createCuuMessage`
  回显 `kind`；新增 10 项工具环测试
- `apps/api/src/conversations.test.ts` — 补 `listReplyJudgeCandidates` 拒绝桩（`ConversationRepository`
  接口新增必填方法后的必要机械更新，未改任何既有断言）
- `apps/desktop-webview/src/workbench/chat/{render.ts,view.ts,render.test.ts}` — 澄清追问渲染 +
  Cuu sentinel + 5 项新测试

## 三处"字面范围围栏外"的必要例外（已限定到最小）

1. `packages/agent/package.json` 加一行 `./reply-judge` 子路径导出——没有这一行，
   `apps/api` 侧完全无法 `import from "@workhub/agent/reply-judge"`，新包等于死代码。
2. `apps/api/src/conversations.test.ts` 补一个拒绝桩方法——`ConversationRepository` 接口新增
   必填方法 `listReplyJudgeCandidates` 后，这个文件里一个和 conversation-turns 完全无关的假仓库
   对象字面量类型不再满足接口，不补就 typecheck 红。只加了方法桩，没有改动这个文件里任何一条
   既有断言。
3. `packages/db/src/test-query-recorder.ts` 加 `.having()` 透传——这个仓库范围内共用的假 DB
   query builder 之前没有任何调用方用过 `.having()`，`listReplyJudgeCandidates` 是第一个用它的
   （聚合过滤 participantCount>1 + 时间窗口）。不加就没法给这个新方法写单测。

以上三处都是"新增必要的最小支撑"，没有修改任何既有断言的判定逻辑，也没有触碰 schema/迁移/
app.ts/openapi.ts。

## 我改过的断言（如有）

`packages/agent/src/turns/prompt.test.ts` 的第一个测试——设计稿"踩雷"明确要求重写批4a"不要
声称已经修改了文件/发起了任务"这段边界语言（因为现在真的有工具了）。旧断言
`/不要在回复里声称自己已经修改了文件/` 测的正是这句被要求删除的话，不可能不改就通过。改为
断言新边界的实际内容（仍然禁止"修改文件内容/合并变更/批准提议"，新增断言"默认不提
create_work_item，只有带 pendingClarification 时才提"）。新增一个测试覆盖
`pendingClarification` 分支。这是 design 要求的重写，不是迁就实现的偷懒改法。

## 关键设计取舍（与设计稿的偏离，均为范围围栏驱动，已在代码注释里逐条写明）

1. **澄清追问不新增 DB kind**：设计稿原提议新增 `clarifying_question` kind（需要迁移）。本批
   范围围栏明确"禁碰 schema/迁移"，改为在既有 `kind='text'` 上加三个 additive 可选字段
   （`is_clarifying_question`/`clarify_options`/`clarify_placeholder`）。零迁移，语义等价。
2. **发起澄清追问是一次工具调用，不是自由文本探测**：设计稿建议"服务端检测模型的自由文本回复
   是不是在提问"。这种文本模式匹配脆弱且不可靠，改为给模型一个显式的终止型工具
   `ask_clarifying_question`——调用即代表"这一轮就是在问问题"，服务端据此打标记，不用猜。
3. **drive_search 复用现成的 `DrivePageService.page()`，没有新写一个更窄的
   `drive-search-tool.ts`**：设计稿建议专门写一个窄函数包一层 ILIKE 原语，避免 `page()` 组装
   整页 VM（文件夹树/面包屑/评论）的开销。但本批范围围栏里 `apps/api/src/services/` 只列出了
   `conversation-turns.ts` 和 `conversation-reply*.ts`（新），没有把 `drive-search-tool.ts`
   这个新文件名纳入允许清单，也不允许碰 `packages/db/src/repositories/drive.ts` 去加一个更窄的
   仓库方法。复用现成的、已经做好 `canViewProjectDrive` 鉴权的 `page()`/`file()`（`conversations.ts`
   的 file_card 路径本来就在用）是范围围栏内唯一安全的选择——功能正确，只是每次 drive_search
   调用会多组装一些本批用不到的字段。这是一个可优化的性能点，不是缺口，已在
   `conversation-turns.ts` 的 deps 类型注释里写明。
4. **回话判定器只服务"真小群"（participantCount>1），不碰 1:1**：G1 落地之前，
   `rail.ts` 建协同会话时 `participant_user_ids` 恒为空数组，所有既有 collab 会话
   `participantCount` 恒为 1——`listReplyJudgeCandidates` 因此在当前仓库状态下恒返回空列表。
   这是刻意设计，不是巧合：1:1 单聊已经 100%由桌面端既有的"发消息后自动请一轮 turn"路径处理
   （`chat/turn.ts` 的 `shouldRequestConversationTurn`，对所有 collab 会话恒真），如果判定器也
   对 1:1 会话生效，会和这条既有路径重复触发 turn（重复计费，甚至出现两条 Cuu 回复）。等 G1
   的建群 UI 落地、真正出现 `participantCount>1` 的会话，这条候选扫描自然开始生效，不需要额外
   改代码。
5. **`cuu_enabled` 当注入布尔处理**：`ConversationReplyJudgeServiceDeps.cuuEnabledForConversation`
   默认恒真（`async () => true`）。G1 的迁移（`project_conversations` 加 `cuu_enabled` 列）落地后，
   只需要把这个依赖换成一次真实的列读取，`judge.ts` 的判定逻辑和优先级顺序完全不用改。
6. **便宜档 LLM 分类没有真正的第二档模型可选**：读了 `packages/config/src/providers.ts` 的
   `createProviderRegistryConfig()`——今天只注册了一个 provider（deepseek）、一个 model
   （"default"），`taskRouting` 是空对象。"选低档"这个路由机制在结构上已经存在（`TaskClass` →
   provider/model 的映射表），但目前没有第二档更便宜的模型可路由到。没有新增/占用一个新的
   `TaskClass`（那需要改 `packages/agent/src/providers/types.ts`，不在批4c/reply-judge 的范围
   围栏内），复用 turn 本身已经在用的 `"assistant"` 任务类。真正的经济性靠三层叠加：只在规则
   前置给不出结论时才调用（多数消息命中规则短路）+ 极低 `maxTokens`（60）+ 独立的预算软闸
   （`checkReplyJudgeBudget`）+ 30s 限频合并。等 `taskRouting` 真正接入第二档模型，只需要在
   服务端把 task 换掉，`prompt.ts`/`judge.ts` 不用跟着变。

## 自查输出

```
pnpm --filter @workhub/agent test            → 138 pass / 0 fail
pnpm --filter @workhub/api test               → 1132 pass / 0 fail / 1 skip（真 PG 矩阵，非本批新增）
pnpm --filter @workhub/db test                 → 256 pass / 0 fail / 2 skip（真 PG 矩阵，非本批新增）
pnpm --filter @workhub/desktop-webview test    → 807 pass / 0 fail
pnpm -r typecheck                              → 16/16 workspace 项目全绿
```

测试数量对比（本批新增）：
- `packages/agent`：104 → 138（+34：tools 13 + rules 12 + throttle 5 + prompt(reply-judge) 7 +
  judge 10 + turns/prompt.test.ts 新增 1、原有 1 条改写）
- `apps/api`：1119 → 1133（+14：conversation-turns.test.ts +10，
  conversation-reply-judge.test.ts 新 9，conversation-reply-judge(worker).test.ts 新 5——
  注：总数按套件独立跑法计不完全叠加，见上方最终 `pnpm --filter test` 汇总为准）
- `packages/db`：251 → 258（+7：createCuuMessage 新分支 3 + listReplyJudgeCandidates 4）
- `apps/desktop-webview`：802 → 807（+5：澄清追问渲染 4 + mention picker sentinel 1）

真 LLM 冒烟：未做（任务书要求"待人工"）。判定器的便宜档 LLM 调用路径（`defaultLlmClassifierFactory`）
和工具环的真实 provider 调用路径都只在假依赖下测过，没有跑过真实 DeepSeek key。

## 挂载清单

- **无新增 HTTP 端点**：4c 的工具环复用既有 `POST /conversations/:id/turns`，响应形状
  `{turn_id, message}` 不变（只是 `message.kind` 现在可能是 `text`/`file_card`）。
- **回话判定器 worker 尚未自动启动**——需要在 `apps/api/src/server.ts`（范围围栏禁止本批直接
  改）里加一行，紧邻既有观察者调度器挂载处（该文件第 49-55 行）：

  ```ts
  import { getDefaultConversationReplyJudgeScheduler } from "./workers/conversation-reply-judge.js";
  // ...
  const conversationReplyJudgeScheduler = getDefaultProviderRegistry().isConfigured()
    ? getDefaultConversationReplyJudgeScheduler()
    : undefined;
  conversationReplyJudgeScheduler?.start();
  ```

  没有这一行，判定器代码全部就位、全部测试通过，但进程不会真的定时跑它——这是刻意的：本批
  范围围栏明确列出"禁碰 app.ts"，`server.ts` 虽然没被点名禁止，但也没有被列入允许清单，出于
  "范围外的问题写进汇报、不顺手改"的铁律#7，没有加这一行。

## 缺口 / 存疑（不修，只报）

1. **openapi.ts 的文本消息内容 schema 没有同步补上三个新 additive 字段**——`openapi.ts` 是手写
   的（不是从 zod 自动派生），本批范围围栏禁止碰它。响应新增可选字段不破坏现有消费者，是纯粹
   的文档滞后，不是运行时问题。
2. **判定器的便宜档 LLM 分类不带历史上下文**（`recentMessages` 恒传空数组）——完整实现应该在
   真正进入 LLM 分类分支时按需拉一小段会话历史喂给模型，本批为了不引入额外的 N+1 查询模式先
   简化掉，只看最新一条消息本身判断。
3. **回话判定器的限频/幂等水位线是进程内内存态**——与 `conversation-turns.ts` 的 `activeTurns`
   Set、`conversation-observer.ts` 的 tick 统计同一类已知缺口，多进程部署/进程重启会丢失。
4. **drive_search 复用较重的 `DrivePageService.page()`**（见上方"关键设计取舍#3"）——功能正确，
   性能上有优化空间（专门的窄检索函数），范围围栏driven 的取舍。
5. **"Cuu 正在看"判定期间指示——诚实砍掉，未做**（见上方"做了什么#5"）。
6. **合成 `AuthActor` 用于回话判定器触发的 turn，`orgId` 留空字符串**——经过 `permissions` 包
   `canViewProjectDrive`/`canManageProjectDrive` 源码核实：非 admin actor 的项目权限判定只在
   `project.orgId` 和 `actor.orgId` 都非空时才比较两者，留空视为跳过该项检查、落回工作区匹配
   （本来就会通过）。已验证安全，不是遗漏，但如果未来这条权限函数改了语义，这里需要跟着复核。
7. **单聊会话若把 AI 档位设成"只观察"，回话判定器会因为 createTurn 内部的 mode=1 检查而 409**——
   这条现有护栏在"最后发言人"合成身份的场景下语义略微模糊（到底谁的档位该生效），本批未特别
   处理，异常被外层 try/catch 计入 `failed`，不会崩溃整个 tick，但也没有专门测试这个边界情形。
8. **真实 LLM 冒烟未做**（任务书要求"待人工"，见上）。

## 不做（本批明确出圈，来自设计稿/任务书）

- 桌面端"Cuu 正在看"过程可视化的完整实现（见缺口#5）。
- G1 的建群 UI、`cuu_enabled` 迁移、参与者多选（G1 并行批范围）。
- server.ts 挂载判定器调度（见挂载清单）。
- openapi.ts 同步（见缺口#1）。
