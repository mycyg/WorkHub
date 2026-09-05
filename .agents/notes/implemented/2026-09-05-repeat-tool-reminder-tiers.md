# 重复动作先劝再断（三档提醒 3 / 5 / 8）

- Status: implemented
- Date: 2026-09-05
- Owner: claude-code

## Problem

`DoomLoopDetector`（`packages/agent/src/loop/control.ts`）一判定出重复，两套引擎就当场
`escalated` + `StructuredHandoff`：一条运行结束、一个人被叫醒。默认窗口是 3，也就是模型
连着做三次同一件事就没有第二次机会——哪怕它只是在等一个文件写完、或者刚好卡在一个自己
能想明白的死角。deepseek-harness 的 `packages/guard/repeat-tool-reminder` 在同样的位置
先给模型两次自救机会（阈值 3 / 5 / 8，观察但绝不否决），这正是我们缺的那一层。

同时这是双引擎仓库：传统 `loop/loop.ts` 是 AgentRun 的生产默认，`loop2/config-builder.ts`
是会话轮次的生产默认，两者由 `shadow-assert` 的 loop-core 投影互相校对。任何循环行为改动
只改一边就会让等价性检查变红。

## Decision

**这是行为变更，不是修 bug。** 判定口径（SHA-256 指纹、全同窗口、周期 2 交替）一字未改，
改的是命中之后怎么办：

- 新增 `packages/agent/src/loop/doom-loop-reminder.ts`：三档阈值、动作摘要（工具名 +
  键排序后的参数预览，单条截到 500 字符）、三档话术。全是纯函数，不读时钟不读环境。
  文件头注明借鉴来源与 MIT 许可——借的是做法不是源码（本工作树没有那份源码）。
- `DoomLoopDetector.push()` 的返回值从「指纹或 null」升级成 `DoomLoopSignal | null`，
  带上档位、连续重复步数、重复形态与参与重复的动作。档位只在**跨过**阈值那一步发一次
  （3 发第一档、5 发第二档、8 发第三档；4、6、7 不重复打扰），重复链路断掉即清零，
  下一条链路重新从第一档劝起。
- 阈值默认 `[3, 5, 8]`，由判定窗口 `doomLoopWindow` 加固定偏移 `[0, 2, 5]` 推出，
  构造器可整体覆盖。这样把窗口调大时三档整体平移，不会出现「窗口还没开始判定、
  阈值就已经越过」的错位。
- 两套引擎消费同一份实现：`loop.ts` 在该步的 `tool_result` 之后追加一条 user 消息；
  `loop2/config-builder.ts` 把同一段正文经 `getSteeringMessages` 在下一轮模型请求之前
  注入。等价性用例断言两套引擎的完整对话线逐条相同（含提醒文本、角色与位置）。
- 第三档仍走原来的 `escalated` + `StructuredHandoff` 路径，`DOOM_LOOP_ESCALATION_REASON`
  由两侧共用，避免文案分叉。
- 话术明说自己不是人发的（「这条提醒由运行环境自动发出，不是人发给你的话」），
  三档正文与档位触发时机一起被 `packages/agent/expected/doom-loop-reminder.*` 的
  逐字节 golden 钉住。

## Alternatives considered

- **只在 `loop.ts` 上做，`loop2` 留到下一轮**：`shadow-assert` 的 loop-core 投影会直接变红，
  而且两套引擎注入的模型可见文本一旦分叉，后面没人能靠 golden 分辨谁改坏了。否决。
- **提醒作为一个 text 块追加进 `tool_result` 那条 user 消息**（Claude Code 的写法）：
  `loop.ts` 侧可行，但 `loop2` 侧要做到同样的线上形状就得改 `loop2/adapters/messages.ts`
  的合并规则（把紧跟 toolResult 的纯文本 user 消息并进同一条），那是共享适配器、范围外。
  改成两侧都追加一条独立的 user 消息：Anthropic Messages API 会把连续的同角色回合合成
  一个回合，模型看到的内容一致，而两套引擎的线上形状逐字节相同。
- **在纯文本 `max_tokens` 截断（`control === "compact"`）那条路上也注入提醒**：那条路本来
  就要发一条纠偏提示、压缩次数自带上限，再叠一条提醒既冗余，在 `loop2` 侧还会把 pi 的内层
  循环续住、让 `getFollowUpMessages` 永远不被调用（压缩因此不触发）。只在工具路径注入。
- **为提醒新增一个事件类型**（好让前端看得见「劝过几次」）：要动 `@workhub/contracts` 的
  事件枚举与 openapi，范围外。提醒本身在对话线里，需要时再补事件。
- **档位阈值写成与窗口无关的字面量 `[3, 5, 8]`**：`doomLoopWindow` 调到 5 时窗口在第 5 步
  才开始判定，而第一档阈值 3 永远够不着，等于跳过第一档。改成由窗口推导。

## Consequences

- **多烧步数**：最坏情况下一条重复链路要跑到第 8 步才升级，对默认 `maxSteps: 15` 是约 33%
  的步数预算（此前是第 3 步）。预算路径本身不受影响：步数/超时/token/成本任一先耗尽仍按
  原路径收尾（`budgetHit: "steps"` 等），已由 `loop.test.ts` 与 `equivalence.test.ts` 各一条
  用例钉住。真要收紧，调 `budget.doomLoopWindow` 即可整体前移三档。
- `DoomLoopDetector.push()` 的返回类型变了。仓内调用点只有两处（两套引擎），都已改；
  外部若有人只判 truthy 仍然可用，但拿到的是对象不是指纹字符串。
- 检测器现在按第三档阈值保留签名窗口（默认 8 条，此前 4 条），并额外保存每步的工具名与
  截断后的参数预览。参数预览按单条 500 字符封顶，内存量级可忽略；**指纹仍用全串**，
  所以「前 500 字相同、尾部不同」的大文件不会因此被误判。
- 提醒是模型可见文本：以后改这三档任何一个字，`packages/agent/expected/doom-loop-reminder.*`
  会红——这正是要的效果，重生成前先把 diff 读一遍。
- dsh 那条「用户插话即重置计数」没有实现：AgentRun 跑起来之后没有人插话这回事。将来
  loop2 接管 AgentRun 并打通跑中插话时，重置点要补上。
