# R14 FIX 批第 5 项完成汇报（replay 组件化，R10 余项）

日期: 2026-07-14 · 执行: Claude · 分支: `r14/replay-componentize`（拉自 `origin/main`，基线 `afc792d1`）
来源: R14 FIX 批第 5 项，立案自 R10 收尾遗留——`packages/ui/src/replay/render.ts` 没有收编进
gold-path 组件体系，样式/工具函数/i18n 模式与 route-components 不一致，维护是双轨制。

## 调查先行

### `replay/render.ts` 现状

- 文件：`packages/ui/src/replay/render.ts`（346 行，含内联 CSS）+ `render.test.ts`（332 行，2 条
  `test()`）+ `index.ts`（`export * from "./render.js"`）。
- 渲染什么：`renderAgentRunReplay(vm, surface, options)` 把一次 agent run 的回放数据
  （步骤/正式交付物/合并决策时间线/结构化字段审计/成本快照）渲成独立可挂载的 HTML 片段
  +CSS，`surface: "web" | "desktop"` 决定根 class（`wh-web`/`wh-desktop`），`ReplayRenderedPage`
  返回统计字段（`stepCount`/`acceptedDeliverableCount`/`mergeAttemptCount`/`structuredAuditCount`）
  供上层校验。
- 被谁调用：
  1. `apps/web/src/main.ts` 的 `/api/agent-runs/:id/replay` handler 直接调用；
  2. `packages/ui/src/gold-path/route-components.ts:4409` 的 `renderReplayRouteComponent`
     把它包一层 `wh-r4-route` 外壳（data attributes + react hydration marker）用于 web 的
     `/agent-runs/:id/replay` 真实路由；
  3. `apps/web/src/routes.ts` 的 loader 在拿到 `ReplayTraceVM` 后经 `renderWebRouteComponent`
     间接落到 (2)。
  这条链路本批**没有改动**（公开的 `renderAgentRunReplay` 函数签名 / `ReplayRenderedPage` 形状
  完全不变），因此 route-components.ts、apps/web 均不需要接线改动——已核实零改动。
- 既有测试：`render.test.ts` 两条用例，覆盖「隐藏推理内容与原始工具 payload 不外泄」+
  「结构化字段操作目标/写回审计/逐段选择回放/批量动作回放/L23 返回任务链接/L24 校验码截断展示」
  的完整信息断言，本批全部原样通过，**未改一条断言**。

### 意外发现：三条并行实现（比预期的「双轨」更严重）

追查 gold-path 组件体系的 i18n 范式时发现，`replay` 这个页面实际上有**三套并行渲染实现**：

1. `packages/ui/src/replay/render.ts` 的 `renderAgentRunReplay`——本批整改对象，真正接在 web 的
   `/agent-runs/:id/replay` 路由上，功能最完整（R9.7/L20-L24 的 hunk 决策审计、批量动作审计、
   富文本 patch viewer、diff3 重叠段复核、子记录逐项 diff、返回任务链接都只在这里）。
2. `packages/ui/src/gold-path/render.ts` 里另一个独立函数 `renderReplay`（约 590-673 行），是**更早
   期、已过时**的平行实现——用的 i18n 是 `goldPathT`（`packages/ui/src/gold-path/i18n.ts` 里已经有
   一整套现成的 `"replay.*"` key，含 `replay.keepCurrent`/`replay.acceptIncoming`/
   `replay.structuredPatchTitle` 等，与 (1) 里手写的中英文字面量高度重合甚至完全相同），但**没有**
   L20-L24 那批加固（无 hunk 审计、无批量动作审计、无返回任务链接），说明它在 (1) 持续迭代时被
   落下了。
3. `route-react-components.ts` 的 `createReplayReactRouteComponent`（React 包装层，转发 (1) 的
   输出，未深入排查）。

范围围栏明确禁止碰 `gold-path 其它文件`，(2) 不在本批可改动范围内，**未做任何修改**，仅记录为
范围外发现（见下方「范围外发现」一节）。

### gold-path 组件体系的范式（供本批对齐）

- **i18n**：两层键值词典 + 查表函数——顶层 `packages/ui/src/i18n.ts` 的 `copy` 字面量对象
  （`Record<string, Record<WorkHubLocale,string>>`，`satisfies` 约束）配 `uiT(locale,key)`/
  `uiCount(locale,n,zhUnit,enSingular)`，供任何页面复用真正通用的概念（状态/风险/证据/回滚/数量
  单复数……）；`gold-path/i18n.ts` 另有一层 `goldPathT` 词典，专供 gold-path 自己的静态渲染
  （上面第(2)条）使用。`packages/ui/src/proposal/render.ts`（与 replay 同构的姊妹模块：同样是
  `renderXxx(vm, surface, options)` 独立渲染器）**完全使用 `uiT` 查表**，没有任何一处手写
  `copy(locale, zh, en)` 式的内联双语字面量调用。
- **escapeHtml/safeHref**：每个独立渲染模块（proposal/render.ts、gold-path/render.ts、本次的
  replay/render.ts）都各自维护一份私有 `escapeHtml`/`safeHref`（三份实现逻辑完全一致，只是不共享
  ——这是既有的、刻意的模块自洽约定，不是要修的问题）。
- **卡片/空态/类名体系**：`wh-card`/`wh-row`/`wh-pill`/`wh-list`/`wh-actions`/`wh-btn`/`wh-subtle`/
  `wh-title`/`wh-kicker` 等原子类名全站共享；每个页面再加一层页面前缀壳类（`wh-proposal*`、
  `wh-replay*`），空态/无数据时用 `<p class="wh-subtle">文案</p>` 兜底或整段省略（有汇总计数兜底时）。
  **核对后发现 replay/render.ts 在类名/卡片/空态结构上早已与该范式一致**——真正的缺口只有 i18n
  函数形状这一项：整个文件用一个本地的 `copy(locale, zh, en)` 辅助函数在每个调用点内联中英文
  字面量，而不是「键 → 词典」的查表模式。

## 本批改动

只改了一个文件：`packages/ui/src/replay/render.ts`。

1. 删除本地 `function copy(locale, zh, en)` 辅助函数（散落 40+ 处内联双语字面量调用）。
2. 新增一个与 `packages/ui/src/i18n.ts` 的 `copy`/`uiT` 同形态的本地词典：
   `type ReplayCopy = Record<WorkHubLocale,string>` + `const replayCopy = {...} satisfies
   Record<string, ReplayCopy>` + `function t(locale, key): string`，收纳全部 replay 页面专属文案
   （kicker/title/空态摘要/各卡片标题/合并选项与决策标签/批量动作审计标签/hunk 决策审计标签/
   结构化字段检查标题等，共 37 个键）。
3. 对真正跨页通用、`../i18n.js` 已导出的概念直接复用共享函数（本文件此前就已导入
   `agentRunStatusLabel`/`agentStepPhaseLabel`/`agentStepPublicSummary`/`uiLocale`，本批新增导入
   `uiT`/`uiCount`）：
   - 「状态」卡片标题 → `uiT(locale,"generic.status")`（原来是本地 `copy(locale,"状态","Status")`，
     现在与全站其它「状态」标签共用同一份翻译源）；
   - 「步骤」卡片标题 → `uiT(locale,"generic.steps")`；
   - 冲突数量单复数（`N 处冲突`/`N conflict(s)`）→ `uiCount(locale, count, "处冲突", "conflict")`；
   - hunk 段数单复数（`N 段`/`N hunks`）→ `uiCount(locale, count, "段", "hunk")`。
4. 保留原有 `escapeHtml`/`safeHref`（与姊妹模块 proposal/render.ts 的私有实现一致，符合既定的
   模块自洽约定，不做跨模块共享）。
5. `mergeOptionLabel`/`mergeAttemptLabel`/`decisionLabel`/`lineRangeLabel`/新增的
   `bulkResultLine` 等动态标签函数从「调用 `copy()` 拼内联字面量」改为「调用 `t()` 查表」或（对
   `lineRangeLabel` 这类必须插值数字的场景）直接用 `locale === "zh-CN" ? ... : ...` 三元表达式，
   不再经过已删除的 `copy()`。

### 顺带修的一个潜在遗留 bug

主 kicker（`<span class="wh-kicker">`）此前无论中英文都渲染字面量英文 "Replay Work"（
`copy(locale, "Replay Work", "Replay Work")`——两个参数完全相同，中文用户看到的是裸英文）。
全仓库其它每一处提到这个页面的地方（`gold-path/i18n.ts` 的 `replay.kicker`、`gold-path/render.ts`
的 `pageTitles["zh-CN"].replay`、`apps/web/src/routes.ts` 第 554 行的面包屑标题）都统一用
「执行回放」。本次重建词典时顺手把中文键值改成「执行回放」，英文保持 "Replay Work" 不变——没有测试
断言这个具体字符串，改动风险为零，但让中文用户不再看到裸英文。已在此明确披露供人复核。

## 语义不变性核对

- `render.test.ts` 的两条既有用例（覆盖隐藏推理过滤、结构化字段操作目标、写回审计、逐段选择回放、
  批量动作回放、L23 返回任务链接、L24 校验码截断展示等全部信息断言）**未改一行断言，全部保持
  原样通过**。
- 逐一核对每个被替换调用点的输出字符串与替换前逐字节相同（`uiCount`/`t()` 的输出与原始模板字面量
  比对过空格、标点、单复数规则），只有上文明确披露的「Replay Work → 执行回放」一处文案变化。
- 类名、卡片结构、CSS（`replayCss`）、返回值形状（`ReplayRenderedPage`）全部未动。

## 自查

```
pnpm --filter @workhub/ui test     → 144 tests, 144 pass, 0 fail（含 replay 的 2 条用例）
pnpm --filter @workhub/web test    → 68 tests, 68 pass, 0 fail
pnpm -r typecheck                  → 16/17 workspaces（第 17 个是桌面 Rust crate，非 TS 项目），0 错误
git status                         → 只有 packages/ui/src/replay/render.ts 被改
```

## 我改过的断言

无——`render.test.ts` 未被修改，全部既有断言原样通过。

## 范围外发现（不修，只报）

1. **`packages/ui/src/gold-path/render.ts` 的 `renderReplay` 函数是一份过时的平行实现**
   （约 590-673 行），使用 `goldPathT` + `gold-path/i18n.ts` 里已经写好的完整 `"replay.*"` 词典，
   但缺少 L20-L24 一路加固的功能（hunk 决策审计、批量动作审计、结构化字段/子记录逐项 diff 的富
   渲染、L23 返回任务链接）。不确定这个函数当前是否还有实际调用方（`GoldPathRenderedPage` 家族
   是否仍被生产路径引用需要专项排查），如果已死代码建议清理；如果还在用，建议下一批把它替换成
   直接调用 `renderAgentRunReplay`（就像 `route-components.ts` 已经做的那样），避免两份实现继续
   分叉。范围围栏明确禁止本批touching gold-path 其它文件，未做任何修改。
2. **`packages/ui/src/structured-field-details.ts` 也有一份独立的、更原始的 ad hoc `text(locale,
   zh, en)` 内联字面量辅助函数**（与本批删除的 replay 本地 `copy()` 是同一种反模式），供
   `renderStructuredFieldOperationDetails`/`renderStructuredFieldAuditDetails` 使用，被 proposal
   与 replay 两个页面共同依赖。这个文件在 `packages/ui/src/` 顶层（不在 `replay/**` 范围内），
   本批未触碰，留给后续专项收编。
3. 未发现需要迁移文件或后端改动的缺口——本次纯前端渲染层重构。

## 没做/存疑

- 未把 replay 本地词典的键提升进共享的 `packages/ui/src/i18n.ts` 或
  `packages/ui/src/gold-path/i18n.ts`——两个文件均不在本批范围围栏内（前者虽未被显式列入禁碰清单，
  但也不在"只许改"清单里；后者被明确列为"gold-path 其它文件"禁止触碰）。当前实现选择在
  `replay/render.ts` 内部自建一份与共享词典同形态、同风格的本地词典，是在不扩大改动面前提下能做到
  的最接近"统一 i18n 函数"的方案。若后续要把 replay 词典真正合并进共享词典（消除与
  `gold-path/i18n.ts` 里已有 `"replay.*"` key 的重复），需要专门立项、明确允许改共享 i18n 文件。

## 提交

```
3a1f2085 refactor(ui): componentize replay renderer i18n to match gold-path pattern
```
