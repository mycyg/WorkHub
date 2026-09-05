# 两段式上下文压缩（先免费剪枝再摘要）+ 超大工具结果落盘

- Status: implemented
- Date: 2026-09-05
- Owner: claude-code

## Problem

两个问题在同一处：

**一、每次压缩都是一次真金白银的模型调用。** `compactThreshold`（默认 0.8）一命中，
两套引擎都直接 `compactNow` → `tryGenerateStructuredSummary`——一次独立计费的
`context_compact` 请求（1500 max tokens），失败才退化成机械摘要。可是「该压缩了」这个
判定用的是 `usage.totalTokens`（整条运行的**累计**用量），不是「现在的历史有多大」；
历史里往往只是几条老掉牙的大工具结果在占地方，剪掉它们的中段就够了，根本不用请模型
写一段摘要。deepseek-harness 的 `compaction-tool-result-pruner` 正是先做这一道不花钱的
剪枝，剪完压力够了就跳过摘要。

**二、工具结果只截不存。** `truncateForContext` 把超过 8000 字符的结果砍成头 75% + 尾 15%，
**原文直接丢弃**。给模型的恢复路径是「重读该文件或用 run_command 抽取」——对 `read_file`
勉强成立，对 `run_command` 的一次性输出就是死路：那段输出这辈子不会再出现第二次。
dsh 的 `spill-policy` 把超限结果存进 spill store、只给模型 head/tail + 一个定位符，
模型可以自己去读。我们本来就有沙箱文件工具，落盘比造一个存储服务缝便宜得多。

## Decision

**这是行为变更，不是修 bug。** 新增 `packages/agent/src/loop/context-pruning.ts`：剪枝计划、
截断/剪枝话术、落盘器、压力判定全在这一份纯函数模块里，两套引擎（`loop/loop.ts` 与
`loop2/config-builder.ts`）各写一层薄投影去调它，文本与判定绝不双份。

**第一段——免费剪枝。**

- 只在压缩触发时跑：压力线以下的会话一个字不动（dsh 的顺序纪律照抄）。
- 把历史里**保留窗口之外**、**超过单条预算**（默认 2000 字符，与摘要转写的单条上限同口径）
  的 `tool_result` 剪成头 75% + 中英双语标记 + 尾 15%。保留窗口 = `ceil(总条数 × 0.16)`
  且至少 1 条（`retainRatio` 取自 dsh）：最近那几条正是模型当前在推理的东西。
- 配对守卫是**结构性**的，不是靠检查得来的：剪的是槽位里的字符串，消息一条不增不删、
  `tool_use_id` 不动、顺序不动，因此 `tool_use` 与它的 `tool_result` 不可能被切开。
- 剪完重算上下文压力（`字符数 / 2` 估 token，保守取 2 是宁可高估、不可低估），
  低于 `contextWindowTokens × compactThreshold` 就**不发摘要请求**；否则照常走 `compactNow`
  （剪枝结果保留，只是让那次摘要更便宜）。
- 判「够了」要同时满足两条：**这次真剪到了东西**、**剪后估算回到压缩线以下**。第一条是
  为了让「历史里没有超预算结果」的运行行为与改动前逐字一致。
- 剪枝**不计**压缩次数：这一次没花钱，计进去只会白白饿死后面真正需要的摘要压缩；但压缩线
  照常前推，否则下一步会立刻再判一次。
- 遥测：`agent_run.compacting` 事件的 `summary_kind` 多了第三态 `"pruned"`，并带
  `pruned_results` / `pruned_chars` / `context_chars`。

**第二段——落盘（spill）。**

- 超过单条上下文预算的结果先写进 `<workdir>/.spill/<四位步号>-<工具名>.txt`（同一步同名工具
  依次加 `-2`、`-3`），模型看到的截断文本末尾附中英各一句定位提示，可以直接 `read_file` 取回原文。
- 没有 workdir 或落盘失败（磁盘满/权限/目录被删）→ 退回既有的纯截断话术，运行照常。
  单次 run 落盘总量封顶 16 MiB，超了就停止落盘。
- `step.toolResults` 与 trace 始终是**完整原文**，只有写进对话的那一份被截断。
- `.spill/` 在 workdir 根下，而交付物的三条采集路径（`collectOutputExcerpts`、
  交付物清单、变动行数统计）都只走 `workdir/outputs`——落盘文件因此天然不会被当成交付物，
  并由一条「只落了盘的运行仍过不了交付物门」的用例钉住。沙箱路径围栏（`safeResolvePath`）
  对 workdir 内任意路径放行、没有点号目录的特例，`read_file .spill/...` 无需改动即可读到，
  也有用例覆盖。

模型可见文本（两种截断话术、定位提示、两种剪枝正文）与剪枝真值表由
`packages/agent/expected/context-pruning.*` 的逐字节 golden 钉住。

## Alternatives considered

- **剪枝排在「压缩次数耗尽」升级判定之前**（能靠不花钱的剪枝撑过去就不叫醒人，和 B6
  「先劝再断」同一条纪律）：`loop.ts` 里两行就能做到，但 `loop2` 的耗尽判定在
  `shouldStopAfterTurn`——那里拿不到即将发出的历史，`transformContext` 根本执行不到。
  强行同步要么把耗尽判定挪进 pi 的上下文钩子、要么让两侧的事件序列错位。双引擎逐字同步
  优先于多救一次，两边都保持「先判耗尽、再剪枝」。剪枝让摘要变少，本来就会让这条路更难走到。
- **在 `max_tokens` 溢出自愈那条路上也剪枝**：那条路是「模型这次输出太长」，自愈依赖摘要 +
  尾部裁剪，而且随后那条提示明说「基于摘要中的进度继续」——跳过摘要会让这句话变成假话。
  只在 `context_window` 触发上剪。
- **按输出长度判「这条已经剪过了」**：剪完的文本是「头 + 双语标记 + 尾」，标记本身几百字符，
  长度天然略超预算，按长度判会一轮轮再剪下去。改成识别剪枝标记前缀，幂等。
- **spill 定位提示写进中段标记里**：中段标记会被第二段剪枝盖掉，定位符就跟着没了。
  放在整条结果的末尾，剪枝时整段保留。
- **压力估算按整段历史的 JSON 长度算**：两套引擎的 wire 形状本就不同（`tool_use`/`input`
  对 `toolCall`/`arguments`），同一段历史会算出不同的数、在「够不够」上分叉。改成只计
  会进模型上下文的**文本**——纯字符串内容、`text`/`thinking` 正文、工具名加参数 JSON 长度、
  工具结果正文——两侧口径逐条对齐，并把 `context_chars` 放进事件投影，一旦漂移等价性检查立刻红。
- **落盘目录放进 `outputs/`**（省得再解释一个目录）：会被交付物清单、评审摘录、变动行数统计
  三处当成产出，等于让运行凭一堆中间输出假装交付。放在 workdir 根下的 `.spill/`。
- **把 `.spill/` 从 `pre_step` 快照里排除**：快照的整树拷贝在 `packages/audit/src/file-snapshot.ts`
  的 `listFiles`，没有排除口子，加口子超出本次改动范围。见下方 Consequences。

## Consequences

- **超大工具结果的截断话术变了**（有 workdir 时）：从「需要完整内容请重读该文件或用
  run_command 抽取」改成「截断正文 + `.spill/…` 定位提示」。旧话术仍是落盘不可用时的分支，
  两种都在 golden 里。`loop.test.ts` 里断言旧话术的那条用例按新行为改写。
- **摘要请求变少**：历史里有超预算老结果、且剪完压力回到线下的运行不再发 `context_compact`
  请求。省下的是模型调用；代价是这类运行不再产生结构化滚动摘要（`rollingSummary` 不推进），
  真到需要压缩时仍会从当时的历史重新生成。
- **`.spill/` 计入沙箱字节预算**（`sandboxStats` 走整棵树），也会被 `pre_step` 全树快照拷贝。
  单 run 16 MiB 上限把这件事框住了，但快照体积确实会变大。**遗留项**：给
  `packages/audit` 的 `listFiles` 加一个排除目录参数、由 `agent-run-snapshots.ts` 传
  `[".spill"]`，是最小且正确的收尾，本次改动范围不含 `packages/audit` 故未做。
- **模型现在能读到 `.spill/`**：那是它自己这次运行的工具输出，不含跨运行、跨工作区的数据，
  沙箱围栏照旧只放行 workdir 内。
- `AgentLoopBudget` 新增三个可选旋钮：`pruneToolResultChars`、`pruneRetainRatio`、
  `spillMaxTotalBytes`，都有默认值，不配就是上面的行为。
