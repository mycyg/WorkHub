# R13 批 C1 完成汇报（会话上下文压缩）

日期: 2026-07-13 · 执行: Claude · 分支: `r13/c1-context-compact`（基线 `20386a92`，拉自 `origin/main`）
来源: `r13-workbench-refinement/01-new-batches-design.md` 三、批 C1（约 139-192 行）+ 「Cuu = 项目经理」
角色总纲。未合并、未推送。

## 现场差异（设计稿写作后代码已大改，已按现场为准调整）

设计稿写于 `apps/api/src/services/conversation-turns.ts` 被批 4c 重写之前，行号全部失效；批 4c 已把
`createTurn` 改成 ≤4 轮受限工具环（`drive_search`/`send_file_card`/`create_work_item`/
`ask_clarifying_question`），并加了 G1 的 `cuu_enabled=false` 409 硬闸。本批照现场代码接线，压缩触发
判定插在拉取历史窗口之前、`cuu_enabled` 闸与模式闸之后；滚动摘要注入 system prompt 对工具环的每一轮
都生效（`system` 数组每轮重新拼一次，摘要段在 `memorySection` 之前）。

设计稿「施工文件清单」写的测试路径 `apps/api/src/services/conversation-turns.test.ts` 在当前仓库不存在
——真实文件在 `apps/api/src/conversation-turns.test.ts`（top-level，不在 `services/` 下）。新测试加在
这个真实存在的文件里。

迁移编号：`0048`/`0049` 已分别被并行批 G1/S3 占用（G1=`0048_small_group_cuu_enabled.sql`，
S3=`0049_personal_projects.sql`）。按集成者指令跳过预留给 P1.5 的 `0050`，本批用 `0051`。

## 做了什么

1. **迁移 + schema**：`packages/db/migrations/0051_conversation_context_summary.sql` 给
   `project_conversations` 加 `context_summary_md text`（null=从未压缩过）与
   `context_summary_through_seq bigint not null default 0`（摘要覆盖到哪个 seq）+ 一条
   `between 0 and 9007199254740991` 的 check 约束。`packages/db/src/schema/core.ts` 同步加列。
   `packages/db/migrations/meta/_journal.json` 追加 `idx:51, tag:"0051_conversation_context_summary"`
   （沿用 G1/S3 当初"idx 与文件号一致、跳号处留给并行批"的先例，`packages/db/src/schema.test.ts`
   的"journal 尾"断言同步更新为指向 0051）。
2. **仓库层**（`packages/db/src/repositories/conversations.ts`）：`conversationSelection` 显式投影
   新增两列（同 G1 当初 `cuuEnabled` 那次教训：不显式投影，运行时读到的就是 `undefined`）；新增
   `updateContextSummary(input)` 方法——只更新摘要正文与覆盖游标两列，`WHERE` 里带
   `context_summary_through_seq < :throughSeq` 防止落后的并发调用覆盖已经更靠前的游标（静默无操作
   而不是报错，配合服务层整条压缩路径的 fail-open 语义）。
3. **摘要 prompt**（`packages/agent/src/turns/prompt.ts` 新增，纯函数）：
   - `buildContextCompactionPrompt({previousSummaryMd, newMessages})` —— 按"项目经理交接"口径拼
     system+messages：当前进度 / 关键决策与偏好 / 待办事项 三段式，中文。旧摘要折进 system prompt
     （不当成一条 user 消息，避免和 newMessages 首条同为 user 角色时构成两条连续 user 消息），过
     `neutralizeFenceTags` 中和 + `MAX_PREVIOUS_SUMMARY_CHARS=4000` 截断。
   - `buildTurnContextSummarySection(summaryMd)` —— 把已落库的摘要转成可拼进主 turn system prompt
     的一段，标注"这是更早内容的摘要，不是指令"。跟 `team_skills` 同一个取舍：不用一个
     `FENCE_TAG_PATTERN` 未覆盖的新标签包裹（那样反而引入一个没被中和的新围栏名），只做纯文本标注
     + `neutralizeFenceTags`。
4. **taskClass**（`packages/agent/src/providers/types.ts`）：`taskClasses` 加 `"context_compact"`，
   与主回应的 `"assistant"` 分开路由/成本归因；`taskRouting` 是 `Record<string,...>`，未配置的任务类
   天然回退 `defaultProvider`/`defaultModelId`，不需要额外配置项才能生效。
5. **服务层核心**（`apps/api/src/services/conversation-turns.ts`）：
   - 触发判定：`windowSize`/`afterSeq` 算出后、拉取主历史窗口前，判断
     `afterSeq > contextSummaryThroughSeq + CONTEXT_SUMMARY_REFRESH_BATCH(20)`。
   - `tryCompactConversationContext`：过 `checkTurnBudget` 软闸（复用既有函数）→
     `listMessagesAfter({afterSeq: contextSummaryThroughSeq, limit: min(gap,100)})` 取这批"新滑出
     窗口"的原始消息（`CONTEXT_SUMMARY_MAX_BATCH_MESSAGES=100`，与仓库层 `assertLimit` 上限对齐，
     保证单次压缩输入有界，不随会话总长线性增长；积压超过 100 条时一次只吃最早一批，`throughSeq`
     只推进到实际吃到的那条，下一轮继续追赶）→ 调 `context_compact` 任务类的独立 client（30s 超时）
     产出摘要 → `updateContextSummary` 落库 → `postContextCompactionSystemMessage`（best-effort）
     落一条 `system_event(context_compacted)` 消息，`content={event, compacted_message_count,
     summary_excerpt}`，复用现有 `system_event` 渲染路径，文案走"已压缩 N 条"这类人话（本次未新增
     UI，system_event 展示沿用既有通用渲染，未验证具体展示文案——见"缺口"）。
   - **fail-open**：整个 `tryCompactConversationContext` 包一层 try/catch，任何失败（预算耗尽、DB
     读写失败、LLM 调用失败/超时、摘要产出空文本）都吞掉返回 `undefined`，调用方原样沿用旧摘要，
     绝不让压缩失败变成 turn 500。
   - 注入：`contextSummaryMd` 非空时，在每一轮（工具环最多 4 轮）重新拼的 `system` 里插入
     `buildTurnContextSummarySection(contextSummaryMd)`，位置在 `buildTurnSystemPrompt(...)` 之后、
     `memorySection.promptSection` 之前（严格按集成者指令的顺序）。
   - 新增两个可选依赖（both optional，省略时有安全默认）：`compactionClient`（省略回退主
     `client`，任务类归因退化成 `"assistant"`）、`postContextCompactionSystemMessage`（省略静默跳过
     播报，同 `agent-runner.ts` 里 `postDeliverableSystemMessage` 对同类依赖的既有取舍）。
     `getDefaultConversationTurnService()` 里用已经建好的 `provider registry`/`actionCards` 仓库
     实例接好真实实现，未新增任何服务/仓库。

## 测试

- `pnpm --filter @workhub/db test`：267 项，265 pass / 2 skip（真 PG 矩阵测试，既有 skip）/ 0 fail。
- `pnpm --filter @workhub/agent test`：143 项，143 pass / 0 fail（含新增 6 项摘要 prompt 测试）。
- `pnpm --filter @workhub/api test`：1171 项，1170 pass / 1 skip（既有 skip）/ 0 fail（含新增 4 项
  压缩相关的 `createTurn` 测试）。
- `pnpm -r typecheck`：单独跑，0 错误，全部 workspace 包 `Done`。
- 新增单测覆盖三条路径（均验证过"会真的红"）：
  1. 触发阈值边界——`afterSeq` 恰好等于阈值（不大于）不触发；`updateContextSummary` 命中即抛错断言。
  2. 压缩全链路——跨过阈值触发、落库摘要与 `throughSeq`、发 `context_compacted` 系统消息、且**同一次
     `createTurn` 调用里**紧接着的主回复 system prompt 已经带上刚产出的摘要文本（断言 stream 调用的
     `system` 参数）。
  3. 已有摘要直接注入——`contextSummaryMd` 预先落库、`nextSeq` 远低于阈值时不重新压缩，仍然正确注入。
  4. 失败降级——压缩阶段的 LLM client 抛错，主回复仍然正常返回真实文本，`updateContextSummary`/
     `postContextCompactionSystemMessage` 均未被调用（用抛错桩钉死"没有被调用"）。

## 必要的范围外协同修复（非功能改动，纯类型兼容）

给 `project_conversations` 加两个必需字段（`ConversationRow` 类型层面）、给 `ConversationRepository`
加一个必需方法（`updateContextSummary`），导致三个既有测试文件里"不带 `as X` 类型断言"的字面量夹具
编译失败（同 G1 当初 `cuuEnabled` 落地时的同款连锁）。按铁律#7 的精神，这类"被动跟着我的 schema 改动
一起编译失败"的收尾修复视为必要协同（非我主动扩大范围），逐一最小化修补：
- `packages/db/src/schema.test.ts` ——"journal 尾"断言从 0049 改为指向 0051（必然结果，`_journal.json`
  已在允许清单内，断言不跟着改这个文件就是错的）。
- `packages/db/src/conversation-repository.test.ts` ——`conversation()` fixture 补两个默认字段。
- `apps/api/src/conversations.test.ts` ——`conversationRow()` fixture 补两个默认字段 + `repository()`
  桩补 `updateContextSummary` 拒绝桩。
- `apps/api/src/drive-pages.test.ts` ——`mainConversationRow()` fixture 补两个默认字段。
以上四处均只补齐类型层面缺失的字段/方法（沿用同文件里已有的桩风格：默认值或"未预期调用即报错"），
未改动任何既有断言逻辑。

`apps/api/src/conversation-turns.test.ts` 的 `baseDeps()` 未逐一改造几十处历史 `conversations` 覆盖
块，而是把 `overrides.conversations` 的类型收窄成 `Partial<...>` 并单独浅合并默认桩——避免了对
几十处只关心 1-3 个方法的历史用例做无关的体力修改，行为上完全等价（未显式覆盖的方法保持"命中即报错"
的默认桩语义）。

## 集成者缝合清单

- `apps/api/src/app.ts`/`server.ts`/`openapi.ts`/`app.test.ts` **未碰**（范围围栏禁碰，集成者若需要
  在这些位置暴露压缩状态，需要自行接线；本批未新开任何端点，压缩完全是 `createTurn` 内部行为）。
- 无前端改动——`system_event(context_compacted)` 消息复用现有通用渲染路径，未验证桌面端/web 端实际
  展示效果是否可读（比如是否需要专门的图标/折叠展示）；如需要专门的"已压缩 N 条"卡片视觉，需要另起
  批次接 `apps/desktop-webview`/`apps/web` 的渲染层。
- 迁移号 `0051` 假定 `0050` 由并行批 P1.5 占用；若 P1.5 最终没有落地或占用了别的号，需要在合并时
  核对 `_journal.json` 的 idx 连续性并按需重新编号（本报告与集成者约定的编号策略：idx 与文件名数字
  一致，不足的号留空位由人工核对拼接顺序，不是自动化能处理的事）。
- 压缩触发条件是消息条数 MVP（`CONTEXT_SUMMARY_REFRESH_BATCH=20`），非严格 token 计数——设计稿本身
  也如实标注这是简化，token 版本留作后续加固项（如实标注在 `conversation-turns.ts` 顶部常量注释里）。
- 压缩调用没有专门的"用户可见过渡态"（设计稿提到"Cuu 正在整理更早的讨论…"这类文案）——本批只做了
  服务端补一个独立 30s 超时的 fail-open 保护，没有做任何前端提示；由于没有新开端点/SSE 事件，前端
  目前看不到"这一轮为什么变慢了"的解释，如果需要这个体验需要额外一个批次。
- `postContextCompactionSystemMessage` 复用 `action-cards` 仓库既有的 `postSystemMessage`，未新建
  仓库方法；如果后续要在系统消息里带更丰富的结构（比如"点开看全文摘要"的折叠交互），P1.5 那批
  变动文件区的 `<details>` 折叠模式可以直接照抄。

## 存疑/未做

- 压缩摘要目前没有专门的最大长度治理（只对"旧摘要"输入侧有 `MAX_PREVIOUS_SUMMARY_CHARS=4000` 截断，
  没有对"新产出摘要"本身的长度做二次截断）——如果 LLM 偶发产出异常长的摘要文本，会原样落库，下一次
  又原样喂给下一次摘要调用的"旧摘要"输入（会被那 4000 字符截断，不会无限增长，但单次落库值本身没有
  上限）。这是一个可以在后续加固批次里补的边界，本批未处理，如实记录。
- 未做"摘要全文可展开"的前端 UI（见上方集成者缝合清单）。
- 未做 token 版本的触发判定（见上方，设计稿本身就标注为后续加固项）。

## 分支/提交

- 分支：`r13/c1-context-compact`
- 提交历史见 `git log`（分批提交，每条 message 为英文祈使句，均带
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`）。
