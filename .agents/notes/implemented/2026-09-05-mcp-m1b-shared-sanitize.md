# 共享「模型可见文本」中和与上限：packages/tools/sanitizeModelFacingText

- Status: implemented
- Date: 2026-09-05
- Owner: claude-code

## Problem

`sanitizePluginText`（`packages/plugin-host/src/to-tool-spec.ts`）此前是插件工具描述符文案的
唯一中和点：去 C0 控制字符、砍到 4000 字符上限。R25 M-MCP 客户端设计（`packages/mcp-client`，
另一工包 M1 在建）确认它会有第二个消费者——MCP 服务器的 `Tool.description` 同样是第三方文案、
同样要喂进模型可见通道，逻辑该复用而不是抄一份。

同一份设计（4.4 安全 第 2 条、5.2）还指出插件那侧当时有两个同源缺口，MCP 接入会把它们放大：

1. 插件工具**执行结果**（`translate.ts` 的 `renderToolContent`，喂给 `apps/api` 的
   `plugin-host-client.ts` 再回传模型）完全不过任何中和——不像描述符文案，结果里一段字面的
   `</outputs>` 能在被工人抄进 `outputs/`、又被 `packages/agent/src/loop/loop.ts` 的
   `fenced()`/`collectOutputExcerpts` 装进围栏后，提前闭合围栏、伪造其它围栏冒充指令。
2. 同一条结果路径**没有长度上限**——`read_file`（`file-tools.ts`）读文件都有 2MB 上限，
   插件想返回多少字节就进多少，一次调用能把 agent 宿主内存、审计日志、快照全撑爆。

（三个同源缺口里的第 3 条——插件熔断是整插件面级别，一个坏插件关掉全部插件——设计文档建议
单独开工包，本轮不做。）

## Decision

新增 `packages/tools/src/model-facing-text.ts`，导出纯函数
`sanitizeModelFacingText(text, options?: number | SanitizeModelFacingTextOptions)`：

- `maxChars`：超过此长度才截断；缺省 `DEFAULT_MODEL_FACING_TEXT_MAX_CHARS`
  （`2 * 1024 * 1024`，字符版的 `read_file` 2MB 上限——量级先例，不是字节精确对应）。
  也可以像 `sanitizeModelFacingText(desc, 4000)` 这样直接传数字，等价于 `{ maxChars: 4000 }`
  （对齐 R25 M-MCP 设计 4.2「逐字段映射表」`description` 一行给出的调用形态，方便 M1 直接抄）。
- `truncation`："tail"（砍到上限加一个省略号，`sanitizePluginText` 的既有行为原样保留）或
  "head-tail"（新缺省档：头 75%、尾 15%，中段换成一条中英各一句的说明，测辞风格照抄
  `packages/agent/src/loop/loop.ts` 的 `truncateForContext`——给一条真实可行的路径而不是
  「见 trace」这类兜不住的承诺）。
- `stripControlChars`：去 C0 控制字符与 DEL、保留换行/回车/制表，缺省 `true`，正则语义与
  `sanitizePluginText` 旧版完全一致（用 `String.fromCharCode` 拼字符类而不是写字面 `\uXXXX`
  转义序列构造——纯粹是这一批工具调用管线的转写稳定性考量，不是语义选择）。
- `neutralizeFenceTags` / `fenceTagNames`：围栏标签中和（`<`/`>` → `‹`/`›`，覆盖登记表全部
  标签与 `candidate_N`），缺省 **关闭**。

`packages/plugin-host` 两处改动：

- `to-tool-spec.ts` 的 `sanitizePluginText` 改成薄封装：
  `sanitizeModelFacingText(value, { maxChars, truncation: "tail" })`（不开
  `neutralizeFenceTags`——描述符文案不进围栏，这一点行为必须逐字不变）。
  验证：原 `to-tool-spec.test.ts` 全部 9 条用例不改一行断言，照样全绿；
  `pnpm gen:expected` 后 `git status` 无变化。
- `translate.ts` 的 `renderToolContent` 拆成「原始拼接」（改名 `renderToolContentRaw`，函数体
  不变）+ 唯一导出、唯一返回口的外壳，在这一个收口处做
  `sanitizeModelFacingText(raw, { maxChars: PLUGIN_RESULT_MAX_CHARS, neutralizeFenceTags: true })`
  （`PLUGIN_RESULT_MAX_CHARS = 32 * 1024`，对齐设计文档给 MCP `content[]` 定的 32KB 档）。
  单一收口而不是在每个内部分支各自处理——AGENTS.md 评审规则「决策在做出它的那个操作里落地」，
  也顺带保证 render 抛错/非 text 占位/循环引用回退等既有分支同样受保护，不只是 happy path。

**围栏标签清单的单一事实源问题**：`packages/agent/src/loop/loop.ts` 的 `FENCE_TAG_NAMES` 才是
真正的登记表（该文件头部注释明确要求「所有把不可信内容夹进围栏的拼接点都必须在这里登记」）。
`packages/agent` 依赖 `@workhub/tools`（方向已核实），理想状态应该是 loop.ts 改成从
`@workhub/tools` 重导出这份表，把两份表收成一份。**本工包的文件白名单不含 `packages/agent`**，
做不了那次迁移，因此退而求其次：`model-facing-text.ts` 导出一份 `DEFAULT_FENCE_TAG_NAMES`
**快照拷贝**（当前 9 个标签，与 loop.ts 逐字一致），`sanitizeModelFacingText` 把标签清单做成
显式参数（`fenceTagNames`，不传时退回这份拷贝）——调用方真要对齐别的清单可以自己注入，
不强制共享一份没法验证同步的隐式状态。

## Alternatives considered

- **把 `FENCE_TAG_NAMES` 的单一事实源现在就挪到 `packages/tools`，loop.ts 改成重导出**：
  技术上依赖方向允许（agent→tools 单向），但本工包的文件白名单明确不含 `packages/agent`，
  做了就是越界施工。留给后续一个允许碰 `packages/agent` 的小工包去做——那时把
  `model-facing-text.ts` 的 `DEFAULT_FENCE_TAG_NAMES` 删掉，改成从同一份表读，两处调用点
  （这里的默认值、loop.ts 的 `FENCE_TAG_PATTERN`）都不用动签名。
- **不给共享函数任何默认围栏标签清单，强制每个调用方自己传**：更「纯粹」，但会让
  `plugin-host` 这个当前唯一的调用方也要自己攒一份 9 项清单——等于制造第二份需要同步的拷贝，
  且没有换来任何额外的正确性（`plugin-host` 本来就该用与 loop.ts 一致的口径）。选择给出
  一个具名导出的默认值，参数仍然是开放的注入点，两头都不吃亏。
- **结果上限直接照抄 `read_file` 的 2MB**：设计文档明确给 MCP `content[]` 定的是 32KB
  （量级上贴近「一次工具调用结果」而不是「一整个文件」），插件结果与 MCP 结果是同一类风险，
  用同一个数字；2MB 只作为「没人显式指定时」的兜底缺省值保留，两个真实调用点都显式覆盖它。
- **`truncation` 缺省仍设成 "tail"（旧行为）**：会让新调用方（工具结果、未来 MCP 结果）
  拿到「只保留头部」这种对长输出不友好的默认值，还得每次显式覆盖。改成 "head-tail" 是新缺省，
  唯一需要保旧行为的调用点（`sanitizePluginText`）显式传 `truncation: "tail"` 覆盖，两头都不隐晦。

## Consequences

- **已知负债——两份围栏标签表需要人工同步**：往 `packages/agent/src/loop/loop.ts` 的
  `FENCE_TAG_NAMES` 加新标签时（该文件头部注释已经在提醒这件事本身），必须同时把
  `packages/tools/src/model-facing-text.ts` 的 `DEFAULT_FENCE_TAG_NAMES` 也加一份，否则插件/
  未来 MCP 的结果中和会悄悄漏掉新标签而没有任何报错。两处都留了互相指向对方的注释，但没有
  自动化校验兜底（比如一个跨包相等性单测）——加那个校验需要某一侧依赖对方，同样卡在
  `packages/tools` 不能依赖 `packages/agent` 这条方向上，只能等未来的重导出迁移。
- **M1（`packages/mcp-client`）落地时的合并点**：`to-tool-spec.ts`（MCP 版，描述符文案）应调用
  `sanitizeModelFacingText(desc, 4000)`；`content.ts`（`CallToolResult` → `ToolResult.content`）
  应调用 `sanitizeModelFacingText(joinedText, { maxChars: 32 * 1024, neutralizeFenceTags: true })`
  ——都从 `@workhub/tools` import，不要各写一份。
- **发现但按设计文档范围未修的相邻缺口**：`apps/api/src/services/plugin-host-client.ts` 的
  `callTool` 在插件 `execute()` **抛错**（而不是正常返回值）时，把 `error.message` 原样塞进
  `errorToolResult(...)`（约第 567 行），这条路径不经过 `renderToolContent`，因此不受本次改动
  保护——一个恶意/写坏的插件理论上能通过抛错而不是返回值，达到同样的围栏标签注入或超长内容效果。
  R25 M-MCP 设计 5.2 明确只点名「插件工具结果」（即 `renderToolContent`）两条缺口，未提这条
  错误消息路径；本工包的文件白名单也把 `plugin-host-client.ts` 限定为「仅当结果路径必须在那里
  接上限时才碰」，这条不属于「结果路径」。留作后续独立小修——已在完工报告里同步标记。
- **行为不变的验证面**：`sanitizePluginText` 的 9 条既有单测、`pnpm gen:expected`
  （`packages/agent` + `apps/api` 两个 golden 生成器）均无变化；新增行为只加测试、不改任何
  既有断言。
