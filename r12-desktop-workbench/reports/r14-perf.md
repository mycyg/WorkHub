# R14 批 PERF 完成汇报（长会话渲染性能）

> 分支 `r14/perf`（worktree `/Users/apple/.codex/worktrees/WorkHub/r14-perf`），三切片各一 commit。
> 施工说明书 = `r14-release-readiness/08-perf-design.md`（已定稿，头部集成裁定钉死范围）。
> 范围只动桌面单端 `apps/desktop-webview/src/workbench/chat/{view,timeline}.ts` 的渲染调度/窗口/锚定路径 +
> 对应单测；未碰 `render.ts` 源码（只在 `render.test.ts` 加了一个结构性哨兵测试）。

## 0. 交付摘要

| 项 | 值 |
|---|---|
| 切片 1（rAF 合帧） | `e583eb07` |
| 切片 2（窗封顶+回缩） | `ec181cda` |
| 切片 3（锚定补全） | `bc4d938b` |
| 报告 commit | 本文件（随后一 commit） |
| 桌面测试计数 | **1113 → 1130**（+17，全绿；基线 1113） |
| `pnpm -r typecheck` | 全 workspace 绿（api/db/ui/web-runtime/web/desktop-webview 全 Done） |
| 改过的既有断言 | **0 条**（详见 §3） |
| 新增 npm 依赖 | 无 |

三切片全部落地，无遗留必做项。

## 1. 三切片完成矩阵

| 切片 | 交付 | 单测（方案 A/B，CI 安全） | 状态 |
|---|---|---|---|
| ① rAF 合帧 | `createRenderScrollScheduler`（view.ts 模块级导出、可注入时钟，照 `pet-surface.ts` 先例）；五个高频被动触发点 `renderScroll()`→`scheduleRenderScroll()`；dispose 时 cancel | view.test.ts +5：合帧（N 次触发一帧一渲）/ 跨帧不丢 / dispose 取消 / setTimeout 兜底 / cancel 清兜底定时器 | ✓ |
| ② 窗封顶+回缩 | timeline.ts `MAX_MESSAGE_RENDER_WINDOW=900` / `capRenderWindowSize` / `maybeShrinkRenderWindowSize`；接线 `handleReachedTop`+`loadOlderHistory`（封顶）、`renderScroll` 贴底分支（回缩） | timeline.test.ts +7：cap 未超/超上限/自定义 cap；shrink 贴底回缩/不贴底不动/已默认不动/自定义 fallback | ✓ |
| ③ 锚定补全 | 合并 `renderScroll`+`renderScrollPreservingTopAnchor` 为唯一出口（不贴底统一高度差补偿）；timeline.ts `windowSizeAfterAppend`（不贴底追加冻结窗口起点）；`mergeMessages` 复用 SSE handler 的 `wasNearBottom` | timeline.test.ts +4：冻结增窗/贴底不动/净增 0 不动/仍受 900 封顶。render.test.ts +1：300 条混合窗口标签数 < 15000 结构哨兵 | ✓ |

**五个被动触发点**（全部改为合帧，逐一核对）：`mergeMessages`（新消息到达）、`applyIncomingReactionUpdate`（反应回声）、`applyIncomingMessageUpdated`（编辑/删除/置顶回声）、`read.updated` 分支（已读游标回声）、turn delta 分支（**Cuu 流式 delta，收益最大**）。

**保持同步 `renderScroll()` 的用户主动路径**（逐一核对未误伤）：`toggleReaction`/`toggleMessageFeedback` 乐观渲染、发送、编辑保存、删除确认、置顶/取消、`markProposalSettled`（外部低频）、`handleReachedTop`/`loadOlderHistory`/`jumpToMessage`（本就一次性主动操作）。`renderTurnStatus`（独立小状态条，非整窗）也保持即时。

## 2. 基准前后对比（跑设计稿 §1 perf-bench 方法论）

脚本复现了设计稿方法论（`scratchpad/perf-bench.mjs`，`node --import tsx` 直 import 仓库源码，只测 `render.ts` 纯字符串拼装这一层，不含浏览器 parse+layout+paint）：

| 渲染窗口条数 | 单次 build 耗时 | HTML 字节 | 标签数 |
|---|---|---|---|
| 300（默认） | ~13ms | 798KB | 9,600 |
| 900（本批新上限） | ~44ms | 2.39MB | 28,800 |
| 1800 | ~91ms | 4.79MB | 57,600 |
| 3000 | ~142ms | 7.98MB | 96,000 |

**读法**：与设计稿基线表同量级（设计稿 300→~15ms/786KB、900→~46ms/2.36MB）。**本批不改 `render.ts`，所以「单次渲染成本」曲线与基线一致、无回退**——这正是本批的核心论点：治的是**渲染频率**和**窗口大小随时长单调恶化**，不是单次渲染的 DOM 节点数。真正的前后差异是分析量级、只能真机（§4 方案 C）确认绝对毫秒：

- **频率（切片①）**：Cuu 一轮 20~40 chunk 的流式回复，原本每个 delta 都整窗重建一次（20~40 次 ×~13ms JS + 浏览器 parse/layout），合帧后收敛到「每帧最多一次」（≤60fps 节奏，⌈N/帧内到达数⌉ 次）。同理群聊里多人快速加反应/推进已读游标的回声轰炸也从「每条一渲」降到「每帧一渲」。
- **窗口上限（切片②）**：`renderWindowSize` 原本只增不减（三处 `+=`，进程生命周期内永不回落），长期不重启的常驻工作台只要翻过一次历史就把 300→无上限地背在每一次后续渲染上。封顶 900 后单次成本上界从「随时长发散」钉死在 ~44ms（表中 900 行），贴底回缩把常态拉回 300 行 ~13ms。
- **窗口起点冻结（切片③-b）**：修的是正确性 bug（见 §3 说明），不是耗时。

## 3. 改过的断言清单：**0 条**

**没有改动任何一条既有断言**，也没有出现「合帧后同步断言要 await 帧」的情况。原因（重要、值得记录）：

- 五个被动触发点全部在 `mountChatView` 的 imperative SSE handler 里，这些命令式 DOM 路径**本就没有单测覆盖**（`view.test.ts` 顶部注释明确：这个 workspace 的测试运行器没有真实 DOM/rAF，只测导出的纯函数）。因此把 `renderScroll()` 换成 `scheduleRenderScroll()`、合并两个渲染出口、改 `mergeMessages` 的窗口维护，都不被任何现有断言观测到——1113 条基线测试**逐字不变全绿**。
- `mergeMessages` 签名新增**可选**参 `nearBottomHint?`（不传即内部自算），向后兼容，5 个调用点无一破裂。
- 新增的 17 条测试全部是纯逻辑/纯函数/结构性哨兵（方案 A + B），不依赖 DOM/真实时间，CI 安全。

## 4. 真机待验项（方案 C，本批不跑，标人工）

按 `memory: workbench-browser-verify-harness`（隔离 PG:5433 + worktree API + localStorage `api_base` 覆写免 Tauri）+ Chrome DevTools Performance 面板，施工后需人工确认：

1. **合帧收益**：往一个会话灌 500~1000 条合成消息，模拟多人快速加反应/已读游标快速推进 + 触发一轮 Cuu 流式回复，录制 Performance，对照施工前后：Long Task(>50ms) 数量下降、流式期间不再逐字卡顿。这是唯一能验证「真实 `innerHTML=` 解析+布局+绘制」综合成本的手段（§2 纯基准只测了 JS 拼装层）。
2. **900 上限复核**：用真机综合成本复核 900 这个数（设计稿明确说它是「有理由的起点」，需真机确认浏览器 parse+layout 叠加后 900 窗口的翻页卡顿是否可接受，或需下调）。
3. **锚定不贴底行为**（切片③ 的一个诚实的裁定，需真机拍板）：合并后的 `renderScroll` 在不贴底时**统一走高度差补偿**（设计 §2.3-a 钉死「不管触发源」）。这套补偿是「保持距底部距离不变」，对**视口上方**的高度变化（older history、上方消息加反应/编辑）是精确正确的（这正是设计要修的 §0#4a 主诉）；对**视口下方**的变化（用户上翻时底部来了新消息）会把视口下移约一条消息高度。结合切片③-b 冻结窗口起点（保证正在读的最旧那条 DOM 节点不被抽走，修 §0#4b 那个「更糟的、正在看的内容消失」bug），综合表现不劣于现状（现状是掉最旧节点导致上跳）。若真机观感上「新消息到达时视口下方那一条高度补偿」需要收敛为「下方变化不补偿」，是一个纯 view.ts 内部的后续微调，不影响本批其余两切片。

## 5. 围栏与偏离

**围栏（全部遵守）**：只动 `apps/desktop-webview/src/workbench/chat/{view,timeline}.ts` 的渲染调度/窗口/锚定路径 + `{view,timeline,render}.test.ts`；**未碰 `render.ts` 源码**（工具条/reaction/反馈/产出卡/digest 卡的渲染内容函数原样不动，占地警告遵守），未碰 css，未新增依赖，未改 `DEFAULT_MESSAGE_RENDER_WINDOW`（仍 300）、未改 `windowRecentMessages` 签名。禁区（api/packages/web/spotlight/proposal|army|settings）零触碰。禁 `git add -A`（只 targeted add 自己的四个文件）；未跑 qa smoke/artifacts；未起后台进程。

**偏离（各有设计依据，逐条说明）**：

1. **`jumpToMessage` 不套 cap**（设计 §2.2 给了「二选一」，我选放行）：引用/置顶/跳到未读是「用户明确要求跳到某条消息」的一次性主动操作，目标就算在 900 条之外也必须够得到，套 cap 会让跳转静默落空。`loadOlderHistory` 循环内部封顶的只是渲染窗口（不是 `messages` 数组），`jumpToMessage` 自己那两处撑窗口无 cap 地把目标纳入 DOM；回底部时切片② 的回缩把这个临时大窗拉回默认值，不长期累积。
2. **切片③-b 用「实际净增到尾部的条数」而非 `incoming.length`**（设计 §2.3-b 代码片写的是 `incoming.length`）：改用 `messages.length` 去重前后的差值 `added`，这样自广播回声/补拉替换（净增 0）不会白撑窗口。行为更精确，是设计意图的忠实实现。
3. **`createRenderScrollScheduler` 返回 `{schedule, cancel}` 对象**（设计 §2.1 草图返回单个 schedule 函数）：为满足「dispose 取消」的可测语义（任务点名要求），补了 cancel 能力；`pending` 标志是权威闸门（即便已排的 rAF 回调仍被宿主触发，flush 也因 `!pending` 直接返回不渲），`cancelAnimationFrame`/`clearTimeout` 只是顺手回收句柄。

## 附：复现

```
cd apps/desktop-webview && pnpm test          # 1130 绿
pnpm -r typecheck                             # 全绿
cd apps/desktop-webview && node --import tsx <perf-bench.mjs>   # 单窗构建成本表（§2）
```
