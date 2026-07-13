# R13 批 H1 完成汇报（健壮性与可达性）

日期: 2026-07-13 · 执行: Claude · 分支: `r13/h1-hardening`（基线 `dcd8dcbc`，拉自 `origin/main`）
来源: `r13-workbench-refinement/00-plan.md` 批 H1；病根见 `reports/self-review-2026-07-13.md` 立案的两条
P2 健壮性项 + 功能审查历史 backlog 里的键盘导航补丁 + 死代码清理。

## 做了什么

1. **SSE 客户端心跳看门狗**（`chat/stream.ts`）：服务端 `apps/api/src/sse/stream.ts` 的 `heartbeatMs`
   默认 30s（全仓库无路由覆盖这个默认值，只有 qa 冒烟脚本自定义过）。新增两个纯函数
   `computeHeartbeatWatchdogMs`（默认 30s×2.5=75s）与 `isHeartbeatWatchdogExpired`，`connectConversationStream`
   在连接一打开、以及此后每收到一帧（**含心跳注释帧本身**——`: ping` 从不到达 `onEvent`，但一样证明
   连接活着，`flushBuffer` 里对每个帧边界都会 `noteFrameReceived()`）时重置一个看门狗定时器；到点
   `controller?.abort()`，走既有 `runLoop` 的 catch→`scheduleReconnect` 路径，不新增分支。武装/拆除
   都收在 `openOnce` 的 `try/finally` 里，保证不会有一个属于"上一次连接"的定时器活到下一次重连去
   误伤新连接；`close()` 也补了 `clearWatchdog()`。
2. **观察者幂等派发**（`apps/api/src/workers/conversation-observer.ts`）：条目 id 从 `randomUUID()` 改为
   `deriveActionCardItemId(conversationId, analyzedToSeq, ordinal)`（新增于
   `packages/agent/src/observer/item-id.ts`，sha256 摘要截断 16 字节 + 打版本/变体位拼合法 UUID，
   跟 `packages/agent/src/deliverables/manifest.ts` 私有的 `deterministicUuid` 同一手法，独立一份不
   跨包导出）。`createOrAppendCard` 撞 items 表唯一约束（PG 23505）时不再让错误冒泡成分析失败——
   识别为幂等重复（同一批 `(conversationId, analyzedToSeq)` 此前已经落过库，这次重扫是水位线没推
   成功导致的），只推水位线挡住下一 tick 再扫同一批，`ConversationObserverTickResult` 新增
   `skipped_duplicate_write` 计数（不复用 `skipped_low_quality`，避免把"已经落过库"误读成"AI 判断
   没活儿"）。**未改 schema**。
3. **键盘可达性**：@ picker（`chat/composer` 的 mention 建议框）、改派 picker（行动卡"派给别人"）、
   模式弹层（AI 五档单聊）三处可选行列表，方向键上下移动高亮、Enter 选中、Escape 关闭；行都打了
   `tabindex="-1"`（`render.ts`）退出原生 Tab 顺序，由各自的 keydown 处理函数"管理焦点"。高亮索引
   状态机是两个纯函数（`view.ts` 新增导出 `movePickerHighlight`/`clampPickerHighlight`），DOM 接线
   分两种取舍：
   - **@ picker**：焦点留在 textarea 里（边打字边过滤，移走真实焦点会打断输入），composer 的
     keydown 处理函数在 `activeTrigger?.kind === "mention"` 时拦截方向键/Enter，Escape 对任意打开的
     picker（含"即将上线"的 #// 外壳）生效。
   - **改派 picker / 模式弹层**：新增/改造两个挂在 `document` 上的 keydown 处理函数
     （`handleDocumentReassignKeydown` 新增；`handleDocumentModeKeydown` 扩展），跟既有数字键 1-5
     快切共用同一条"焦点在可编辑区就放行"守卫；模式弹层一打开就把高亮定位到当前生效档位。
   - `render.ts` 新增导出 `reassignPickerMemberIds`（改派候选成员的过滤+封顶顺序），供 `view.ts`
     把方向键算出的下标换算成 Enter 要提交的用户 id，避免两处各写一份同样的 filter/cap 逻辑漂移。
   - 高亮视觉用内联 `outline`（不改 css.ts，范围围栏不许），选"outline"而不是"background"是为了
     跟模式弹层已有的 `--on`（当前生效档位）背景色不冲突叠加。
4. **死代码清理**：`shell.ts` 的 `renderProjectSummaryHtml`（批 1 遗留、批 2 起从未被 `renderCenter`
   调用，自审+本批二次核实全仓库无调用方）连同 `shell.test.ts` 里唯二消费它的两个测试
   + 专属的 `workbenchVm` fixture 一并删除；顺手清了 `shell.ts` 变成未使用的 `WorkbenchPageVM` 类型
   导入。

## 改动文件清单

- `apps/desktop-webview/src/workbench/chat/stream.ts` — 心跳看门狗（纯函数 + 接线）
- `apps/desktop-webview/src/workbench/chat/stream.test.ts` — 看门狗纯函数单测 + 两条真实小间隔计时器
  的接线集成测试（无帧超时重连 / 心跳注释帧续命不重连）
- `apps/api/src/workers/conversation-observer.ts` — 确定性 id 派生接线 + 23505 幂等吞掉 + 新计数字段
- `apps/api/src/conversation-observer.test.ts` — 新增 4 条：id 确定性重放、ordinal 区分、23505 幂等、
  非唯一冲突错误仍然冒泡
- `packages/agent/src/observer/item-id.ts`（新增）— `deriveActionCardItemId` 纯函数
- `packages/agent/src/observer/item-id.test.ts`（新增）— 6 条纯函数单测
- `packages/agent/src/observer/index.ts` — 新增 barrel 导出
- `apps/desktop-webview/src/workbench/chat/view.ts` — 高亮状态机纯函数 + @/改派/模式三处键盘接线
- `apps/desktop-webview/src/workbench/chat/view.test.ts` — 新增 10 条状态机纯函数单测
- `apps/desktop-webview/src/workbench/chat/render.ts` — 三处 picker 的 `tabindex="-1"` + 高亮渲染 +
  新导出 `reassignPickerMemberIds`
- `apps/desktop-webview/src/workbench/shell.ts` — 删 `renderProjectSummaryHtml` 死代码 + 未用类型导入
- `apps/desktop-webview/src/workbench/shell.test.ts` — 删对应两个测试 + 专属 fixture

## 自查输出

```
pnpm --filter @workhub/desktop-webview test   # 699 pass / 0 fail（改动前 690 pass；+9 条本批新增纯函数测试）
pnpm --filter @workhub/api test                # 1074 pass / 0 fail / 1 skip（既有真库门跳过，非本批引入）
pnpm --filter @workhub/agent test              # 82 pass / 0 fail（含新增 item-id 6 条）
pnpm -r typecheck                              # 16/16 workspace 全绿（第 17 个是 client-tauri Rust 项目，非 TS 包）
git status                                     # 只有范围围栏内的文件被改；无范围外脏文件
```

## 我改过的断言（如有）

- `apps/desktop-webview/src/workbench/chat/render.test.ts`：**没有改任何断言**——但在实现里刻意把
  `tabindex="-1"` 和高亮 `style` 属性插在模式弹层每一行的属性列表**末尾**（`data-wb-chat-mode-option`
  /`role`/`aria-checked` 之后），而不是紧跟在 `class="..."` 后面，就是为了不打断已有两条断言
  （`renderModePopoverHtml highlights the currently selected level and no other` /
  `renderModePopoverHtml always marks the fifth level with the warn class, selected or not`）里
  `class="..." data-wb-chat-mode-option="N"` 这种"属性字符串相邻"的正则匹配。这是调整我自己实现的
  属性顺序去兼容既有断言（断言本身一字未动），不是铁律第 1 条禁止的"改断言迁就实现"。

## 范围外发现（不修，只报）

- `apps/desktop-webview/src/workbench/chat/render.ts` 里 mention picker/reassign picker 的成员数量
  上限（`8`/`REASSIGN_PICKER_MEMBER_CAP=20`）在两个文件里各自硬编码了一份大数字口径（`view.ts` 的
  `MAX_PICKER_RESULTS=8` 恰好一致，纯属巧合式对齐，不是同一个常量）——本批只新增了
  `reassignPickerMemberIds` 这一个共享点位收窄"改派"这一路的重复，"@ 提及"那一路的 `8` 仍然是两处
  独立的字面量，值得后续找一个共享点位彻底去重（不在本批范围，未改）。
- 观察者的"先派发后建卡"这条自审 backlog 的根因（execute/decide 派发建的真实 work_item/agent_run/
  通知，不在 `createOrAppendCard` 的事务里、回不了滚）本批**没有**从根上解决——本批只让"落库这一步
  本身"的重复变成幂等（水位线推进 + 23505 不报错），如果 dispatch 阶段本身在 createOrAppendCard 之前
  就失败重试（比如 tick 被 kill 在 dispatch 和 createOrAppendCard 之间），仍然可能造出一次真实的
  重复 work_item/agent_run（只是这次它们不会再各自拿到不同的 id——同一批消息重扫时 dispatch 会算出
  跟上次相同的 itemId，但 dispatch 函数本身没有"这个 id 是否已经派发过"的前置查重，因为查重需要一次
  额外的 SELECT，且要往哪张表查、按什么口径查没有在任务书里定案，属于需要用户/集成者拍板的架构决策，
  未擅自扩大范围）。

## 没做/存疑

- 键盘接线的三处 DOM 行为（真实浏览器里方向键确实移动高亮、Enter 确实选中、Escape 确实关闭）**没有
  自动化测试覆盖**——这个 workspace 的测试运行器是 `node --import tsx --test`，无 jsdom，历史上
  `view.ts`/`shell.ts`/`rail.ts` 全部只测导出的纯函数，不测 DOM 接线（`view.test.ts` 顶部注释原话
  如此）。本批新增的高亮状态机纯函数（`movePickerHighlight`/`clampPickerHighlight`）有完整单测，
  但"按下 ArrowDown 时 `renderPicker()`/`renderScroll()` 确实被调用、DOM 里确实多出 outline 样式"这
  一层只能靠真机/预览手验，未做（桌面工作台窗口需要 Tauri webview，本环境没有起真机）。
- 改派 picker 的键盘导航挂在 `document` 上、靠 `openReassignItemId` 这个状态开关把关，**没有真的把
  DOM 焦点移到某一行**——鼠标点开它之后，焦点通常还停在触发它的"派给别人"按钮上（一次点击不会主动
  移走焦点），方向键/Enter 由全局监听器接管，这是"容器管理焦点"的一种实现（状态机决定谁被选中），
  不是字面意义上"每按一次方向键就把浏览器 focus 挪到下一个 `<button>`"的经典 roving tabindex。三处
  一致地选择了这个更轻的接线方式（@ picker 必须这样做，为了保持一致没有单独给改派/模式弹层做真实
  focus 搬移），如果后续验收要求"看得见的键盘焦点环"必须是浏览器原生 `:focus` 而不是内联 outline，
  需要额外一批真机迭代。
- `packages/agent/src/observer/item-id.ts` 的确定性派生假设"同一批消息重扫时 LLM 计划的第 N 条条目
  位置不变"——这是概率性假设（同一个 LLM 对同样的输入大概率给出相似的计划顺序，但不是保证），如果
  重扫时顺序变了，幂等只在"恰好撞见同一个 ordinal 的同一个 id"时生效；顺序变化的那部分条目会走
  正常插入路径（不是 bug，只是幂等覆盖率不是 100%，如实说明）。
