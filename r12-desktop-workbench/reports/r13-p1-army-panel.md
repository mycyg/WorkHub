# R13 批 P1 完成汇报 · 军团面板前端三区 + 军团总览一级入口

> 分支：`r13/p1-army-panel`（从 `origin/main` @ `804ee276` 拉出）。纯前端批次——服务端端点（`GET
> /api/conversations/:id/army`、`GET /api/me/army`）R12 批 5 就写好挂载了，这批只补前端消费方。

## 做了什么

1. 新增 `apps/desktop-webview/src/workbench/army/` 目录（`api.ts` / `render.ts` / `panel.ts` /
   `overview.ts` + 三个 colocated 测试文件）：
   - `panel.ts`（`mountArmyContextPanel`）：会话情境面板的军团内容控制器，三区（输出/军团/后台任务）
     + run 卡点击下钻详情（meta chips + recent_step 放大 +「看回放」按钮）+「返回」保滚动位。
   - `overview.ts`（`mountArmyOverviewView`）：军团总览中栏视图，`GET /me/army` 按 `project_name`
     分组的卡片流 + 手动「刷新」按钮 + 游标「加载更多」。
   - `render.ts`：全部无副作用的纯渲染函数（含 `mergeArmyRunPages`/`groupArmyOverviewRunsByProject`
     两个可单测的纯逻辑函数），三区/空态/capped/下钻/猫名/执行地全部覆盖。
   - `api.ts`：两个只读端点 + `getAgentRun`（run 详情下钻复用的既有具名方法）的薄封装，走
     `client.request<T>`，不扩大 `packages/api-client` 的公共方法面。
2. 接线：
   - `shell.ts`：情境面板默认态从「即将上线」占位换成真三区——`armyPanel` 与既有 `driveSidePanel`
     共挂 `sideBodyEl`，靠 `store.sidePanelContent.ownerId` 互斥（文件预览覆盖军团面板，军团面板
     被动刷新不覆盖文件预览——见 `panel.ts` 顶部注释）。`centerTab` 新增 `"army-overview"`。刷新策略：
     面板挂载拉一次（`showForConversation`，在 `chatMountKey` 真正更新的同一处调用）+ 收到
     `conversation.action_card.updated` 事件时后台静默重拉（复用 chat/view.ts 已有的
     `onConversationEvent` 转发口，不新开 SSE 连接）；总览视图手动刷新按钮，不轮询。
   - `rail.ts`：新增「军团总览」左栏一级入口（`renderArmyOverviewNavHtml`，与项目列表平级、独立分组，
     真按钮→`onOpenArmyOverview`），rail-foot 旧的「即将上线」摘要条退役。
   - `store.ts`：`WorkbenchCenterTab` 加 `"army-overview"`。
3. `css.ts` 加 `.wh-wb-army-*`/`.wh-wb-rail-group`/`.wh-wb-army-nav` 全套浅色样式；删掉
   `renderSidePanelPlaceholderHtml`（shell.ts）与其测试，改用 `renderArmySidePanelIdleHtml`
   （army/render.ts 导出，面板内部空态与 shell 外层「没有会话情境」兜底共用同一句文案）。
4. colocated 测试矩阵：`render.test.ts`（三区/空态/capped/下钻/猫名/执行地/合并去重/分组）+
   `api.test.ts`（路径拼接/游标参数/转发既有 `getAgentRun`）。

## 关键设计决定

- **「看回放」深链落地为真实调用，不是占位。** 04 手册要求「接不上就诚实禁用」，但排查发现
  Spotlight 的回放视图（`spotlight/views/replay.ts`）本来就是靠 `client.getAgentRun(runId)` 拿完整
  `AgentRunLiveVM.trace` 渲时间线的——`WorkHubApiClient` 上 `getAgentRun` 是既有具名方法，不是新协议。
  run 详情下钻的「看回放」按钮直接复用这同一个端点，在情境面板内联展开完整时间线，而不是尝试跨窗口
  深链到 Spotlight（没有这样的桥，`client-tauri` 又在范围外）。这是一个真实可用的功能，不是假接线。
- **输出区「点击暂只展示 proposal_href 文案」用原生 `<details>/<summary>` 实现**，不是一个看起来能跳
  但什么都不做的 `<a href>`——04 §4 铁律 3 的具体落地。
- **军团总览的 run 卡本批刻意不做下钻**（P1 任务条目里只对会话情境面板提了下钻要求，总览条目只提了
  分组+分页+空态）。`renderArmyRunCardHtml` 的 `interactive` 参数已经把「可点 vs 静态展示」的开关做好
  了——总览传 `interactive:false`（纯 `<div>`，无 `cursor:pointer`、无 `data-wb-army-open-run`），
  不是遗漏，未来批次要加只需把这个开关翻过来 + 加一个点击处理器。
- **后台静默刷新不会挤掉一个用户正在看的文件预览。** `armyPanel.handleRawConversationEvent` 收到
  `conversation.action_card.updated` 后会重新拉数据，但只有在当前 `sidePanelContent.ownerId !==
  "drive"` 时才真的写回 DOM（否则只更新内部缓存，等下次用户主动切会话时再体现）——用户主动导航
  （`showForConversation`）则总是强制发布，这是「drive 预览态互斥切换的既有 store 机制沿用」的具体
  实现方式。

## 改动文件清单

- `apps/desktop-webview/src/workbench/army/api.ts`（新）：两个只读端点 + `getAgentRun` 薄封装。
- `apps/desktop-webview/src/workbench/army/render.ts`（新）：纯渲染函数 + 合并/分组两个纯逻辑函数。
- `apps/desktop-webview/src/workbench/army/panel.ts`（新）：会话情境面板控制器。
- `apps/desktop-webview/src/workbench/army/overview.ts`（新）：军团总览中栏视图控制器。
- `apps/desktop-webview/src/workbench/army/api.test.ts`、`render.test.ts`（新）：colocated 测试。
- `apps/desktop-webview/src/workbench/shell.ts`：接线 armyPanel/armyOverview，删
  `renderSidePanelPlaceholderHtml`，`renderCenter`/`renderSide` 改造，`onConversationEvent` 统一转发。
- `apps/desktop-webview/src/workbench/shell.test.ts`：移除已删除函数的测试。
- `apps/desktop-webview/src/workbench/rail.ts`：新增 `renderArmyOverviewNavHtml` + `onOpenArmyOverview`
  接线，`renderRailFootHtml` 退役旧摘要条，`centerTab` 参数类型改用 `WorkbenchCenterTab`。
- `apps/desktop-webview/src/workbench/rail.test.ts`：更新/新增对应断言。
- `apps/desktop-webview/src/workbench/store.ts`：`WorkbenchCenterTab` 加 `"army-overview"`。
- `apps/desktop-webview/src/workbench/css.ts`：新增军团面板/总览/rail 入口的浅色样式；删旧
  `.wh-wb-army-sum*` 规则。

## 自查输出

```
pnpm --filter @workhub/desktop-webview typecheck   # 0 错
pnpm --filter @workhub/desktop-webview test        # 652 → 678（新增 26 条全绿），0 fail
pnpm -r typecheck                                  # 全仓库 16 个 workspace 全绿（含 apps/api、packages/contracts 等，本批未改动但确认未被间接破坏）
git status                                          # 只有 workbench/**（css.ts/rail.ts/rail.test.ts/
                                                     # shell.ts/shell.test.ts/store.ts/army/**）被改动，
                                                     # 无范围外文件
```

另外用真实的渲染函数 + 真实 `workbenchCss`/`appleGlassDesignSystemCss` 生成了一版静态 HTML 截图自查
（三区列表/下钻详情(空闲/已拉到回放)/军团总览分组/rail 新入口），在 Browser 面板里过了一遍浅色配色的
可读性（badge 对比度、执行地/状态徽标颜色、空态文案），生成脚本未提交（临时文件，验证完已删除）。
真机 Tauri vibrancy/交互验收仍需要人工用 `.app` 走一遍——这是本仓库过去所有工作台批次的一贯做法
（`drive/view.ts`、`drive/side-panel.ts` 这两个最接近的先例也是零 DOM 单测，只有 render.ts 层面的
纯函数测试），不是这批的新缺口。

## 我改过的断言（说明理由）

- `rail.test.ts`：`renderRailFootHtml` 的两条测试（断言「军团总览」/「即将上线」文案存在、断言不是
  按钮）被替换成「rail-foot 不再携带已退役的摘要条」+ 新增两条 `renderArmyOverviewNavHtml` 的测试
  （断言它是真按钮、断言 active 态）。理由：这是 02 计划 P1 与用户拍板 4 的明确产品变更——军团总览
  从 rail-foot 里一条不可点的预告条升级成左栏一级入口，旧断言描述的正是要被替换掉的行为，不是我为了
  绕过测试而改。
- `shell.test.ts`：删除了 `renderSidePanelPlaceholderHtml is an honest 'not built yet' notice` 这条
  测试（连同该函数一起删除）。理由：P1 任务原话「删掉旧占位相关(renderSidePanelPlaceholderHtml
  等)与其测试」，这是任务书明确要求的清理项，替代文案（`renderArmySidePanelIdleHtml`）的行为在
  `army/render.test.ts` 里有等价覆盖。

## 范围外发现（不修，只报）

- `window-bridge.ts` 顶部注释提到的 `client-tauri/src-tauri/capabilities/default.json` 尚未把
  `"workbench"` 加进 `windows` 列表——这个缺口早于本批存在，本批新增的 `onConversationEvent`/军团面板
  逻辑不依赖它（纯前端状态机+ fetch，不需要 Tauri IPC），但真机上 `armyPanel` 的行为仍然会受这个既有
  缺口影响到的是 `windowBridge.isFocused()`/`startDragging` 等既有能力，与本批无关，不重复记录。
- 文件预览目前没有「关闭预览、手动切回军团面板」的按钮（`driveSidePanel` 从批 6 起就是这样：只有
  切项目/打开网盘标签会调 `showIdle()`）——本批的军团面板完全遵循这个既有交互模型，没有引入新缺口，
  但如果后续想让用户主动"退出预览回到会话情境"，需要在 `drive/side-panel.ts` 加一个显式的关闭动作
  （范围外，需要单独立项）。

## 没做 / 存疑

- 军团总览的 run 卡本批不支持点击下钻（见上面「关键设计决定」）——按任务书字面要求实现，若要下钻
  详情，下一批可以直接复用 `renderArmyRunDetailHtml`/`fetchAgentRunTrace`，改动量很小。
- 真机 `.app` 交互验收（三区数据真实渲染、下钻/返回滚动位手感、军团总览翻页手感）没有做——环境里没有
  Tauri 运行时，只能做到 typecheck + colocated 纯函数测试 + 静态 HTML 视觉自查这三层，和这个仓库里
  所有桌面工作台批次的既定验收边界一致。
