# R14 批 SEARCH · 工包 W2 search-spotlight 交付报告

分支：`r14/search-spotlight` · 施工说明书：`r14-release-readiness/02-search-design.md` §5（能力注册/视图交互/意图分类 stretch）
上游依赖：`r12-desktop-workbench/reports/r14-search-core.md`（W1，服务端 `GET /api/search` 已挂载，契约 = `packages/contracts/src/domain/search.ts`）

## 1. 做了什么

### 能力注册（3 处，全在允许范围内）
- `apps/desktop-webview/src/command-palette.ts`：`CommandId` 联合新增 `"search"`；`commandRegistry` 新增条目（`label:"搜索全部"/"Search all"`、`hint:"跨会话·网盘·工单·会议"`、`keywords:["搜索","查找","全局","search","find","global"]`、图标沿用设计给定的放大镜 svg）。注册顺序**刻意插在 `knowledge` 之前**——两者的 keywords 都含「搜索/search」，`matchCommands` 打平分时按注册表 index 兜底，让新的全局搜索赢旧的项目内知识检索（决策见下方偏离说明）。
- `apps/desktop-webview/src/spotlight/registry.ts`：`builtViews` 新增 `search: createSearchView`。
- `apps/desktop-webview/src/spotlight/views/search.ts`（新文件，506 行）：实现 `SpotlightCapabilityView`。

### 视图交互（`spotlight/views/search.ts`）
- **mount 即聚焦**：`ctx.body.querySelector("[data-search-input]")?.focus()`；初始态渲染引导提示（非空态占位，无 emoji）。
- **防抖 300ms**：`SEARCH_DEBOUNCE_MS=300`；`<2` 字符不发请求（本地即挡，省一次网络往返，服务端也会拒），`>64` 字符本地也拦（对齐 `SEARCH_QUERY_MIN_LENGTH`/`SEARCH_QUERY_MAX_LENGTH`，单一事实源来自契约常量）。单调代次 `fetchGen` 防旧请求覆盖新结果；切到短查询会让在途请求的结果作废。
- **取数**：api-client 目前还没有 `search()` 方法（那是 W3 web-search-page 工包的活，本工包禁碰 `packages/**`）——沿用 `drive.ts` 已明确导出、供跨 view 复用的鉴权 fetch helper（`fetchDriveResource`/`driveResourceApiBase`/`driveResourceHref`，同一套 token 自愈逻辑），直接打 `GET /api/search?q=&limit=10`（不传 `scopes`，服务端缺省即返全四组）。响应用 `searchResultsVmSchema.safeParse` 校验后才渲染，防契约漂移。
- **分组渲染**：恒按 `SEARCH_SCOPE_ORDER` 渲染四组（会话/网盘/工单/会议，中文标题），命中数与 `has_more`（渲「还有更多，换更精确的词」）在标题行；命中 0 的组不消失，灰显「无匹配」——用户能看出四类都真搜了，不是漏了一类；全 4 组皆空再加一条「没有找到和「q」匹配的内容」的诚实横幅。snippet 用 `<mark>` 高亮命中词（服务端给纯文本，客户端先转义再定位高亮，双重防注入，见 `highlightSnippet` 的穷举单测）。
- **空结果/短查询/加载/失败**：短查询渲引导文案；加载态复用既有 `.wh-spot-loading` 玻璃 spinner；失败渲 `spotlightErrorHtml` + 重试（`data-spot-retry` 委托，同既有 views 惯例）。

### 结果直达（诚实分级，见设计 §6）
| scope | 机制 | 精度 |
|---|---|---|
| 会话 | `resolveDesktopTauriInvoke()` + `stashPendingWorkbenchDeepLink({projectId, conversationId})`（无 seq，只读 stash 已支持的字段）后 `invoke("open_workbench",{projectId})` | 会话级（打开该会话）。成功/失败/无 Tauri 桥（浏览器预览）均给 toast 回执，不假装。 |
| 网盘 | `ctx.open("drive", { id: projectId, route: "?item_id=<id>" })`——复用 `drive.ts` 既有的 `driveTargetItemIdFromRoute` 深链解析 | **文件级**真实深链（切项目+高亮选中项）。 |
| 工单 | `ctx.open("workitem", { id: workItemId })`——`workitem.ts` 已支持 `ctx.target?.id` 直开详情 | **条目级**真实深链。 |
| 会议 | 同会话机制，但只 `stashPendingWorkbenchDeepLink({projectId})`（不传 conversationId） | **项目级降级**——`team`/日历能力视图不消费 `ctx.target`，没有「打开某条会议」的现成机制，诚实降级为「在工作台打开该项目」，行内文案（`会议详情暂不能从搜索直达，点开将在工作台打开该项目`）与点击后 toast（`已在工作台打开该项目，会议详情请在里面查看`）都明说，不假装精确跳转。 |

### 键盘可达
- 上下键（`ArrowDown`/`ArrowUp`）在结果行间移动高亮（`data-search-active`，复用 drive 已选中项同款 accent 描边视觉），支持首次按键从头/尾进入、越界环绕（`nextSearchActiveIndex` 纯函数单测覆盖）。
- 回车打开当前高亮行（无高亮时默认第一条）；中文输入法组合态（`isComposing`/`keyCode===229`）忽略，与顶层搜索框同款守卫。
- Esc 未在本视图另写逻辑——本视图没有 list→detail 内部层，顶层 controller 的既有 window keydown 监听器（`SPOTLIGHT_INTERNAL_BACK_SELECTOR` 查不到内部返回元素）会自然退回 launcher，符合「照既有 views 键盘模式」。

### 意图分类 stretch（未完成，如实说明）
设计 §5.3 要求扩 `packages/agent/src/spotlight-intent/schema.ts`（服务端意图枚举）+ `apps/desktop-webview/src/spotlight/ask-cuu.ts`（客户端联合类型）两处联动才能让「帮我找 X」被分类为 `search` 意图并 prefill 查询。前者在 `packages/**`，是本工包**明确禁区**；只改客户端一侧会产生一个服务端永远不会返回、因而无法被真实路径触发的 TS 分支——判断为「未落地的死代码」而非「稳健的前向兼容」，故未做。核心入口（能力视图本身，通过输入框直接搜）已完整；此项按任务说明「做不完如实报告，不设门」处理，不拖批。

## 2. 已知的一处必要越界（非 spotlight/**，但是穷举编译的直接后果）

`apps/desktop-webview/src/browser.ts` 的 `COMMAND_ROUTE: Record<CommandId, string>`——文件自身注释已言明这是**死代码**（`boot()`/`mountCommandHome()` 早被 `bootSpotlight()` 取代，没有任何调用点，但仍编译进 bundle，`Record<CommandId,string>` 仍强制穷举）。扩 `CommandId` 联合后 `pnpm -r typecheck` 直接报缺键，属于「正当扩展」允许改动 command-palette.ts 之后不可避免的连锁——只加了一行占位 `search: "/dashboard/search"`，不改行为（该表本就无调用点）。除此之外未触碰 `apps/desktop-webview/src/workbench/**`、`apps/api/**`、`packages/**`、`apps/web/**`、`client-tauri/**` 任何文件（对 `workbench/pending-deep-link.ts`/`desktop-window-controls.ts` 仅 import 复用其已导出函数，未修改）。

## 3. 测试

- 新文件 `apps/desktop-webview/src/spotlight/views/search.test.ts`：32 条（纯函数：请求构造/scope 标题/matched_in 标签/会议状态词表/snippet 高亮转义防注入/查询长度边界文案/分组渲染顺序与计数/空态诚实/降级文案/行 dataset 精确性；`resolveSearchRowAction` 四类穷举；`nextSearchActiveIndex`/`moveSearchActive` 键盘数学与 DOM 接线；`mount()` 接线：聚焦、短查询免请求、防抖 300ms 真实拉取并渲染、失败重试、四类点击路由、Tauri 缺失时的诚实降级 toast、上下键+回车、IME 组合态忽略）。
- `apps/desktop-webview/src/command-palette.test.ts`：穷举 id 清单加入 `"search"`；新增「查找/全局/find/global」无歧义命中断言 + 「搜索/search 打平分时新命令赢知识检索、知识检索保留自己独有词」的 tie-break 回归测试。
- `apps/desktop-webview/src/spotlight/registry.ts` 的既有穷举测试（`registry.test.ts`）无需改动——它遍历 `commandRegistry` 逐条断言 `resolveCapabilityView(id).id===id`，新条目自动被覆盖。
- `apps/desktop-webview/src/spotlight/css.ts` 新增 3 条规则（结果分组间距、键盘高亮行、`<mark>` 高亮底色），未触碰任何既有 `css.test.ts` 断言。

| 包 | 基线 | 现状 | 新增 |
|---|---|---|---|
| @workhub/desktop-webview | 966 | 999 | +33（search.test.ts 32 + command-palette.test.ts 1） |

`pnpm --filter @workhub/desktop-webview test` 连续 3 次全绿（999/999，无 flake）；`pnpm -r typecheck` 全绿（16/17 有 typecheck 脚本的包全过）。

## 4. 完成矩阵

| 要点 | 状态 |
|---|---|
| 1. 能力注册 3 处 | 完成 |
| 2. mount 聚焦 + 防抖 300ms + 分组渲染 + has_more 提示 + 空态 + `<2` 字免请求 | 完成 |
| 3. 结果直达（会话/网盘/工单真深链，会议诚实降级） | 完成（会议按设计明确的降级路径处置，非缺口） |
| 4. 键盘可达（上下移动/回车/Esc） | 完成 |
| 5. 意图分类 stretch | 未完成——服务端半在 `packages/agent/**` 禁区，做了会留死代码，如实跳过 |

## 5. 偏离说明

1. **搜索/search 关键词与 knowledge 命令冲突的 tie-break**：设计 §5.1 给出的 `search` 命令关键词字面包含「搜索/search」，与既有 `knowledge` 命令的关键词列表本就重叠（`knowledge` 早有 "搜索"/"search"）。`matchCommands` 打分对完全相等的关键词命中一律记 100 分，同分按注册表 index 兜底。为了让用户输入通用的「搜索」/"search" 时落到更广的新能力而非旧的项目内知识检索，把 `search` 条目排在 `knowledge` 之前（原本 `replay→knowledge→cost` 改为 `replay→search→knowledge→cost`），并加了回归测试钉死这个顺序。knowledge 独有词（"知识检索"/"wiki"/"检索"）不受影响。
2. **深链目标未随行携带 `label`**：`drive.ts`/`workitem.ts` 当前均不消费 `ctx.target?.label`（只用 `id`/`route`），故没有传——避免传一个目标 view 不读的死参数。
3. **意图分类 stretch 完全跳过**（见上文第 1 节末尾），非拖批缺口，按任务说明的「不设门」处理。
