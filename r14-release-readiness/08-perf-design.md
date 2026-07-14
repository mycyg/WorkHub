# R14 · 批 PERF 实现级设计草案（长会话性能）— 侦察 + 裁定

> 集成裁定（2026-07-14）：批准缩水方案——砍 web 侧（无会话页，死前提）与真虚拟化（频率才是病根+仓库无 jsdom 无法验证布局正确性），做三切片：①五个高频被动触发点 rAF 合帧（注入时钟模式）②渲染窗封顶 ~900+回底部回缩 ③高度差锚定扩展到五触发点+非底部时冻结窗口起点（修「新消息把正读消息挤出 DOM」真 bug）。单工包 opus 一次交付，切片序=①→②→③。

> 状态：侦察 + 裁定草案（只读агent 产出，未改动仓库任何文件）· 2026-07-14
> 侦察基础：`apps/desktop-webview/src/workbench/chat/{timeline,render,view}.ts` 全文通读（timeline.ts 418
> 行/render.ts 1527 行/view.ts 3059 行）+ 合成消息渲染基准（本机跑通，见 §1.1）+ `apps/web/src/routes.ts`
> 全 18 条 route pattern 核实 + `packages/ui/src/replay/render.ts` 通读 + 既有 pet-surface.ts/spotlight
> controller.ts 的 rAF 注入先例核实。
> 纪律：仓库=`/Users/apple/.codex/worktrees/WorkHub/r12-workbench-full`（main=44e9e0ca）；本稿只读侦察，
> 未写一行仓库代码。

---

## 0. 范围裁定（对照 00-plan.md §2 批 PERF 原文，如实收窄）

> 原文：「桌面工作台 + web 会话页消息列表虚拟化（自写窗口化渲染，不引重依赖）；滚动锚定（新消息在
> 底部时跟随、用户上翻时不跳）。上下文压缩（R13 批 C1）解决了 AI 侧，本批解决人侧 DOM。图片/文件卡
> 懒加载顺路。」

四处收窄，逐条给出核实依据：

1. **「web 会话页」不存在，本批 web 侧标的判定为空，砍掉**。核实 `apps/web/src/routes.ts` 的全部 18 条
   `pattern:` 路由（`/`、`/projects`、`/projects/:id`、`/intake/:sessionId`、`/approvals`、
   `/workitems/:id`、`/proposals/:id`、`/drive`、`/meetings`、`/notifications`、`/calendar`、
   `/dashboard/health`、`/agent-runs/:id/replay`、`/dashboard/cost`、`/dashboard/agents`、
   `/knowledge/search`、`/dashboard/search`、`/dashboard/skills`、`/settings`、`/settings/memory`），
   没有任何 `/conversations`、`/chat`、`/sessions` 一类路由——web 端从来没有一个渲染会话消息列表的页面。
   唯一沾边的是 `/agent-runs/:id/replay`（`packages/ui/src/replay/render.ts`），但它是**单次 AgentRun
   的只读 trace 页**：服务端/loader 一次性拼出完整 HTML（步骤+补丁 diff+结构化审计），没有分页/懒加载/
   持续增长的概念，篇幅上限是一个 run 的步骤数（通常几十步），不是聊天消息流那种可以无限增长的列表。
   00-plan 写「web 会话页」时描述的目标物在当前代码库里不存在，不是「还没做」，而是「压根没有」——
   本批不该无中生有造一个页面来满足这句话，也不该把 replay 页强行套进「消息列表虚拟化」的问题域
   （量级和访问模式都不匹配，见 §2.5）。

2. **「消息列表虚拟化」的前提「DOM 未窗口化」不成立，但真正的瓶颈也不是虚拟化能解决的那种瓶颈**。
   R12 批 8 已经做了 DOM 窗口化：`timeline.ts:404-418` 的 `windowRecentMessages`（默认窗口
   `DEFAULT_MESSAGE_RENDER_WINDOW=300`，只挂载最近 N 条，更早的留在内存不进 DOM）+
   `view.ts` 的 `handleReachedTop`/`loadOlderHistory` 本地展开/翻页。这本身是合理的「简单窗口化」，
   不需要重做。但排查 `view.ts` 发现 **真正的性能瓶颈是渲染触发频率，不是单次渲染的 DOM 节点数**：
   `render.ts` 是纯字符串拼装（无 diff/无 patch），`view.ts` 里约 50 处调用点里，除了本机直接操作
   （发送/翻页/编辑/删除等）之外，**几类高频的被动事件也全部触发同一个 `renderScroll()`**，它无差别
   `el.innerHTML = buildScrollBodyHtml()` 整窗重建：
   - `mergeMessages`（新消息到达，`view.ts:1017-1023`）；
   - `applyIncomingReactionUpdate`（任何人加/取消反应的 SSE 回流，`view.ts:1922-1949`）；
   - `applyIncomingMessageUpdated`（编辑/删除/置顶回流，`view.ts:1907-1920`）；
   - `read.updated`（他人已读游标推进，`view.ts:1994-2004`——群聊里任何一个成员滚到底都会广播）；
   - **Cuu 流式回复的每一个 delta chunk**（`view.ts:2051-2058`，`turnActive` 期间收到一帧就
     `renderScroll()` 一次，`turn.ts` 的 `appendTurnDelta` 完全没有节流/合帧）。
   基准实测（`scratchpad/perf-bench.mjs`，合成消息含 text/action_card/file_card 混合、反应/反馈/@提及
   都开启，逼近真实气泡复杂度，只测 `render.ts` 纯字符串拼装这一层，不含浏览器 parse+layout+paint）：

   | 渲染窗口条数 | 单次 build 耗时 | HTML 字节数 | 标签数（≈DOM 节点数） |
   |---|---|---|---|
   | 300（默认） | ~15ms | 786KB | 8,858 |
   | 900 | ~46ms | 2.36MB | 26,611 |
   | 1800 | ~85ms | 4.72MB | 53,246 |
   | 3000 | ~141ms | 7.87MB | 88,732 |

   即便在默认 300 窗口，仅 JS 字符串拼装就有 ~15ms（浏览器实际 `innerHTML=` 还要加 HTML parse + DOM
   构建 + 样式计算 + 布局 + 绘制，经验上同量级或更慢）。这 15ms+ 在 Cuu 流式回复期间**是每个 delta
   chunk 都要付一次**——一次典型的 20~40 chunk 回复，就是 20~40 次主线程整窗重建，逐字卡顿感在长会话
   里几乎必然可感知。这是本批真正该修的问题，跟「要不要上真虚拟滚动」是两件事：虚拟滚动降低的是
   「单次渲染」的 DOM 节点数，但如果渲染频率本身失控，降低单次成本只是把卡顿间隔拉长，治标不治本。

3. **`renderWindowSize` 只增不减，是第 2 点问题的时间维度放大器**。全仓库搜索
   `renderWindowSize\s*=`，命中的赋值只有 3 处（`handleReachedTop:1151`、`loadOlderHistory:1190`、
   `jumpToMessage:1816/1845`），全部是 `+=`（`RENDER_WINDOW_EXPAND_STEP=150`），没有任何一处减小它。
   意味着：一个长期不重启的桌面客户端进程（这正是 WorkHub 主区群聊的典型使用形态——项目里的常驻
   工作台），只要用户翻过一次历史、或跳转过一次旧引用/旧置顶消息，这个会话的渲染窗口在**整个客户端
   进程生命周期内**只会越滚越大，永不回落。结合第 2 点，「每次小变更整窗重建」的成本随会话使用时长
   单调恶化——用得越久越卡，而不是稳定在一个可接受的常数成本上。

4. **滚动锚定「用户上翻时不跳」目前只覆盖了两条路径，其余高频路径完全没做，且有一个更隐蔽的「悄悄
   丢失当前阅读位置」缺口**。`renderScrollPreservingTopAnchor()`（`view.ts:822-830`，用
   `beforeHeight`/`beforeTop` 的差值补偿 `scrollTop`）目前只在 `handleReachedTop` 本地展开和
   `loadOlderHistory` 两条「向上翻页」路径里调用。上面第 2 点列的五类高频事件（新消息到达/反应回流/
   已读回流/编辑删除置顶回流/turn delta）全部走的是普通 `renderScroll()`——它的锚定逻辑只有一个
   `wasNearBottom`（`view.ts:793`）分支：贴底则重新贴底，**不贴底则完全不处理 scrollTop**。这意味着
   用户正在往上翻读历史时，只要这几类事件里任何一个触发（新增的反应行/已读摘要行/编辑后文本长度变化
   都会改变上方内容高度），视觉上可能整体跳动。更隐蔽的一层：`windowRecentMessages` 语义是「取
   `messages` 数组末尾 N 条」（`timeline.ts:411-418`，`start = messages.length - size`）——一旦本地
   `messages.length` 超过 `renderWindowSize`（长会话里翻过历史之后很容易达到），**每来一条新消息，
   窗口起点也会跟着往后挪一条**，也就是说用户如果正好停留在窗口最旧端附近阅读，会被无声地「抽走」
   最上面那条消息的 DOM 节点——这不是「跳动」，是「正在看的内容消失」，比视觉跳动更糟，且正是原计划
   「用户上翻时不跳」这半句要防的场景，目前完全没有防住。

5. **「图片/文件卡懒加载顺路」——核实后这类内容不存在，不是「待懒加载」而是「压根没有可懒加载的
   东西」**。`render.ts:765-786` 的 `messageBodyHtml` 按 `message.kind` 分派，`file_card` 分支
   （`render.ts:769-773`）只渲染一个图标（`workbenchIcons.folder`，纯 SVG path，不是图片）+ 文件名的
   按钮，点击才在右栏打开预览（`workbench/drive/side-panel.ts`）——**消息气泡本身没有任何 `<img>`**。
   仓库里唯一的 `<img>` 是头像：`avatarTileHtml`（`render.ts:79-88`）在色块 tile 上打
   `data-wb-avatar-user-id` 标记，`view.ts:331-350` 的 `hydrateAvatarPhotos` 在真实 DOM 挂载**之后**才
   异步 `fetch` + 缓存（`avatarPhotoCache`，模块级 Promise 缓存，命中不重新请求）再叠一张 `<img>` 上去
   ——这本身已经是「非阻塞、事后挂载」的懒加载模式，不需要额外工作。唯一相关的边际成本是：第 2 点
   的高频整窗重建会连带让 `hydrateAvatarPhotos` 每次都重新 `querySelectorAll` 全窗口的头像 tile 并
   `appendChild` 一次 `<img>`（缓存命中不重新拉字节，但 DOM 写入本身重复），这是第 2 点问题的衍生成本
   而非独立线索，修第 2 点会顺带把它降到该有的频率，不必单独立项。

**结论**：本批从「消息列表虚拟化（桌面+web）」缩水为「桌面单端 · 渲染触发频率治理（合帧节流）+
窗口增长上限与回落 + 补齐滚动锚定的真实缺口」，不新建真虚拟滚动（transform 定位+测高缓存），不碰
web（无标的），不做图片/文件懒加载（无此内容）。理由见 §2 每一项的成本/收益核算与 §3「无法验证」的
测试基建约束。

---

## 1. 复现基准脚本（供集成者复跑）

`scratchpad/perf-bench.mjs`（本次侦察产物，未放进仓库）用真实的 `renderMessageHtml`/
`groupMessagesByDay`/`windowRecentMessages`（直接 `import` 仓库源码 `.ts` 文件，`node --import tsx`
执行，走仓库现成的 pnpm workspace 依赖解析），构造 6000 条包含 text/action_card/file_card 混合、部分
带反应/反馈/长文本的合成消息，对 `{300,900,1800,3000,6000}` 五档窗口分别测「重复调用 `renderMessageHtml`
拼出整窗 HTML」的平均耗时与产物体积/标签数。复跑方式：

```
cd apps/desktop-webview && node --import tsx <path-to-bench-script>
```

（脚本本身很短，施工者可按 §0 表格里的方法论直接照抄一份到 scratchpad 复现，不必依赖我这次的临时
文件路径。）

---

## 2. 设计

### 2.1 渲染合帧（最高优先级，收益最大、风险最低）

新增一个不导出到 `mountChatView` 之外的调度 wrapper（放 `view.ts` 内部即可，不需要新文件）：

```ts
type ChatScheduleClock = {
  requestAnimationFrame?: (cb: FrameRequestCallback) => number;
  setTimeout?: (cb: () => void, ms: number) => number;
};

function createRenderScrollScheduler(
  run: () => void,
  clock: ChatScheduleClock = globalThis as ChatScheduleClock
): () => void {
  let pending = false;
  return () => {
    if (pending) {
      return; // 已经排了一帧，本次调用只是把"要不要渲"标记保持为真，不重复排队。
    }
    pending = true;
    const flush = () => {
      pending = false;
      run();
    };
    const raf = clock.requestAnimationFrame;
    if (raf) {
      raf(flush);
    } else {
      clock.setTimeout?.(flush, 16);
    }
  };
}
```

这个模式直接照抄仓库已有先例（`pet-surface.ts:294-310` 的 `scheduleDesktopPetFirstPaint`、
`spotlight/controller.ts:324` 的 `window.requestAnimationFrame` 用法）——桌面 webview 是真实
Chromium/WebKit 内核，`window.requestAnimationFrame` 保证存在，`setTimeout` 只是防御性兜底（测试环境
没有 `window` 时不炸）。

`mountChatView` 挂载时创建一次：`const scheduleRenderScroll = createRenderScrollScheduler(renderScroll);`，
然后把 §0 第 2 点列的五个高频调用点的 `renderScroll()` 换成 `scheduleRenderScroll()`：

- `mergeMessages`（`view.ts:1022`）
- `applyIncomingReactionUpdate`（`view.ts:1944`）
- `applyIncomingMessageUpdated`（`view.ts:1911`）
- `read.updated` 分支（`view.ts:2000`）
- turn delta 分支（`view.ts:2055`）

**保持同步 `renderScroll()` 不变的路径**（本机直接操作，用户需要立刻看到反馈，不能有一帧延迟）：
`toggleReaction`/`toggleMessageFeedback` 的乐观渲染（`view.ts:1432-1460`/`1465-`）、发送消息、编辑保存、
删除确认、置顶/取消置顶、`handleReachedTop`/`loadOlderHistory`/`jumpToMessage`（这几个已经走
`renderScrollPreservingTopAnchor`，本身就是用户主动触发的一次性操作，不是高频轰炸）。核实过
`toggleReaction` 与 `applyIncomingReactionUpdate` 是完全独立的两条调用路径（前者本机乐观点击，后者
SSE 回流，含自己动作的服务端回声）——只节流后者不影响自己点反应的即时手感。

预期收益：turn delta 场景下，20~40 次/回复的整窗重建收敛到「每帧最多一次」（≤60fps 节奏），且因为
`run()`（也就是真正的 `renderScroll`）在 flush 时刻才读取最新状态（`turnDeltaState.chunks` 等），拼出来
的仍然是最新内容，不丢字——只是把「来一个字重建一次」变成「攒够一帧的量重建一次」，观感上流式文字
依然连续（60fps 下人眼分辨不出 1~2 帧的合并延迟），但主线程负载从「N 次整窗重建」降到「⌈N/帧内到达数⌉
次」。

可测试性：`createRenderScrollScheduler` 本身不碰 DOM，是纯逻辑（"给一个 mock clock，调用 N 次返回的
调度函数，验证只有 flush 被调用后才真正执行一次 `run`，flush 前的重复调用不重复排队"）——可以直接用
`node:test` + 手写 mock `{ requestAnimationFrame: (cb) => { queued.push(cb); return 1; } }` 覆盖，不需要
jsdom。

### 2.2 渲染窗口上限 + 回落到默认值

新增两个纯函数进 `timeline.ts`（挨着 `windowRecentMessages`，同样的注释规范）：

```ts
// 窗口只增不减会让长会话里"翻过一次历史"这个动作的代价长期背在每一次后续渲染上——加一个上限，
// 超过上限就不再放大（宁可让最上面那批消息重新折叠回"本地未展开"态，用户可以再点一次展开）。
export const MAX_MESSAGE_RENDER_WINDOW = 900;

export function capRenderWindowSize(size: number, cap: number = MAX_MESSAGE_RENDER_WINDOW): number {
  return Math.min(size, cap);
}

// 用户真的贴底回到"看最新"的状态时，没有理由继续背着一个被翻页撑大的窗口——收回默认值，下一次翻页
// 需求发生时会重新按需撑大，不是一次性代价。
export function maybeShrinkRenderWindowSize(
  currentSize: number,
  wasNearBottom: boolean,
  fallback: number = DEFAULT_MESSAGE_RENDER_WINDOW
): number {
  return wasNearBottom && currentSize > fallback ? fallback : currentSize;
}
```

上限取 900 的理由：对照 §1 基准表，900 窗口纯字符串拼装 ~46ms——已经超过一帧预算，但这类触发只发生在
「用户主动翻页/跳转」这种低频、且本身已经有 loading 态铺垫的操作上（不是被 §2.1 节流的高频路径），
偶发 46ms（结合浏览器 parse+layout 可能到 100ms+ 量级）是「翻页时轻微卡一下」，比默认 300 的量级大 3
倍，覆盖「跳一次旧引用+来回翻几页」的常见操作而不必新拉一次内存重建；再往上（1800/3000）耗时曲线
接近线性但绝对值已经不可接受，没有必要放开。这个数字需要 §3 提到的真机验证复核，先当一个有理由的
起点，不是拍脑袋。

接线点：
- `handleReachedTop`（`view.ts:1151`）：`renderWindowSize = capRenderWindowSize(renderWindowSize + RENDER_WINDOW_EXPAND_STEP)`。
- `loadOlderHistory`（`view.ts:1190`）：同上用 `capRenderWindowSize` 包一层。
- `jumpToMessage`（`view.ts:1816`/`1845`）：这两处是"为了让目标消息进窗口"而计算的
  `neededFromEnd + RENDER_WINDOW_EXPAND_STEP`，如果目标消息本身就在 900 条之外（理论上可能，比如跳到
  一条很老的置顶消息），加 cap 会导致目标消息够不到窗口——这种情况下诚实地不撑窗口、退化成"滚到
  未命中"是可以接受的（04 §4 铁律 3 的延伸：没把握精确定位就不硬来），但更稳妥的处理是 cap 只作用于
  §2.1 的高频/日常路径，`jumpToMessage` 这种"用户明确要求跳到某条消息"的场景允许突破 cap（用户主动
  要求，且是一次性操作，不会重复触发）——留给施工者按实际测试结果二选一，两种都在纯函数层面很容易
  切换（`capRenderWindowSize` 要不要在这两个调用点包一层）。
- `renderScroll` 贴底分支（`view.ts:812-814`，`if (wasNearBottom) { el.scrollTop = ... }` 之后）：追加
  `renderWindowSize = maybeShrinkRenderWindowSize(renderWindowSize, wasNearBottom);`。

### 2.3 补齐滚动锚定的真实缺口

两件事分开处理：

**a) 高频路径的高度差补偿**（§0 第 4 点前半）：把 `renderScrollPreservingTopAnchor` 的补偿手法从
「只服务向上翻页」泛化成 `renderScroll` 自身在「不贴底」分支下的标准行为——即把现有的两段函数合并为
一个 `renderScroll(options?: { preserveTopAnchor?: boolean })`，`wasNearBottom` 为 false 时统一走
`beforeHeight`/`beforeTop` 差值补偿（不管触发源是 loadOlderHistory 还是 reaction 回流还是 turn delta），
`wasNearBottom` 为 true 时维持贴底。这样 §2.1 里改成 `scheduleRenderScroll` 的那五条路径，flush 时刻
执行的就是这个已经补偿过锚点的版本，不需要在每个调用点分别决定"要不要保锚点"。

**b) 窗口起点悄悄前移的问题**（§0 第 4 点后半，更严重的那个）：`windowRecentMessages` 本身保持纯函数
不变（不改签名），修法落在调用方维持窗口大小的方式上——`mergeMessages` 在「不贴底」时，追加消息带来的
`renderWindowSize` 应该跟着新增消息数一起长（镜像 `loadOlderHistory` 已经在用的
`renderWindowSize += page.messages.length` 手法，只是方向相反：`loadOlderHistory` 是往顶部塞旧消息时
把窗口往旧的方向撑大，这里是往底部追加新消息时把窗口往新的方向撑大），让 `start = messages.length -
renderWindowSize` 的 `start` 保持不变——用户当前视口里的消息集合不会因为底部来了条新消息就丢失最上面
那条。贴底状态下不需要这个补偿（用户本来就要看最新的，窗口自然覆盖到底），结合 §2.2 的回落，贴底时
`renderWindowSize` 会被拉回默认值，不会无限累积。

```ts
// mergeMessages 内，紧跟 messages = sortAndDedupeMessages(...) 之后：
if (!wasNearBottom) {
  renderWindowSize = capRenderWindowSize(renderWindowSize + incoming.length);
}
```

（`wasNearBottom` 需要在 `mergeMessages` 调用前，跟 SSE handler 里已有的
`const wasNearBottom = scrollEl!.scrollHeight - ... < NEAR_BOTTOM_PX;`——`view.ts:1962` 那一行——共享,
不必重复计算。）

### 2.4 hydrateAvatarPhotos

不单独立项。§2.1 把高频路径的渲染频率降下来之后，`hydrateAvatarPhotos` 的重复调用频率会跟着降到同
一个量级；它本身缓存命中不重新拉字节，边际成本只是 `querySelectorAll` + 若干次 `appendChild`，量级
（真实用户数是几十而不是几百）不值得为它单独设计"跳过已挂载 tile"的判断逻辑（每次都是全新 DOM，
`isConnected` 判断已经在防悬空引用，见 `view.ts:339`）。如果 §2.1 上线后真机验证仍能观测到它是热点
（见 §3 方案 D），再回头做，不放进本批必做清单。

### 2.5 为什么不做真虚拟滚动（transform 定位 + 测高缓存）

真虚拟滚动需要：只挂载视口附近的少量 DOM 节点，用 `position: absolute` + `transform: translateY()`
把它们摆到滚动容器里正确的像素位置，同时维护一份"每条消息实际渲染高度"的缓存（因为消息高度不定：
长文本折叠/展开、action_card 条目数量、reply 引用块、reaction 行、编辑框弹出、风险 digest 展开/收起
都会改变单条消息的高度），高度缓存需要用真实 `getBoundingClientRect()`/`ResizeObserver` 测量才准，
测不准会导致滚动条跳动或空白闪烁。

不做的理由，三条叠加：

1. **成本收益不对称**：§0 第 2 点已经证明"渲染频率"是主要矛盾，不是"单次渲染节点数"——300 节点的
   默认窗口在被节流之后，剩余的渲染次数已经是低频（本机操作/新消息到达/偶发回落），单次 15ms 的成本
   在这个频率下可以接受。真虚拟滚动能把单次成本从 15ms 压到 1-2ms，但如果这个渲染一分钟只发生几次，
   压缩单次成本的边际收益很小。
2. **架构改造面过大**：`render.ts` 是纯字符串拼装、`view.ts` 里约 50 处调用点全部假设"状态变了就整窗
   重建"这个心智模型（`renderScroll`/`renderScrollPreservingTopAnchor` 是仅有的两个"渲染出口"）。切到
   真虚拟滚动意味着这 50 处调用点全部要改造成"只更新受影响的那几条消息对应的 DOM 节点"（增量 patch，
   而不是整窗重建），这是一次接近重写的改动，风险跟 §0 原计划设想的"顺手做掉"完全不成比例。
3. **本仓库的测试基建撑不住**（见 §3）：没有 jsdom/真实浏览器布局引擎，`mountChatView` 的 imperative
   DOM 部分历来就没有单测覆盖（`view.test.ts` 顶部注释明确写了"这个 workspace 的测试运行器没有真实
   DOM…只测导出的纯函数"）。真虚拟滚动的核心正确性恰恰依赖真实布局测量（测高缓存、
   `IntersectionObserver` 触发时机、`translateY` 像素精度），这类逻辑写出来之后，本仓库的自动化测试
   完全没有能力回归保护它，每一次后续改动都要靠人工真机复核，风险/收益比很差。§2.1-2.3 的方案全部是
   纯函数或可注入 mock clock 的调度逻辑，可以被 `node:test` 完整覆盖，这是刻意的取舍。

---

## 3. 性能验证方法（无真机怎么测）

已核实：本 workspace 无 jsdom/happy-dom（`view.test.ts:13-16` 顶部注释 + `apps/desktop-webview/
package.json` 的 `test` 脚本是 `node --import tsx --test`，全仓库 `package.json`/`pnpm-lock.yaml` 都
搜不到 jsdom/happy-dom），`mountChatView` 的 imperative DOM 从未被单测覆盖，只测导出的纯函数——这个
约束直接决定了 §2 的方案取舍（优先纯函数/可注入 clock 的调度逻辑），也决定了验证方法必须分层：

**方案 A（可信、可 CI 化）：合帧调度逻辑的纯单测**——`createRenderScrollScheduler` 用手写 mock clock
（`{ requestAnimationFrame: (cb) => { queue.push(cb); return 1; } }`）驱动，断言"连续调用 N 次调度函数，
在 flush 之前 `run` 从未被调用；手动触发一次排队的 `cb`，`run` 恰好被调用 1 次；flush 之后再调用一次
调度函数，会重新排队"。这类断言 100% 确定、不依赖真实 DOM/时间，是本批唯一能给出强保证的部分。
`capRenderWindowSize`/`maybeShrinkRenderWindowSize` 同理，纯函数边界条件（未超上限不变/超上限截断/
贴底回落/不贴底不回落）直接断言。

**方案 B（粗粒度回归哨兵，不追求精确）：render 输出的结构性断言**——沿用 §1 的基准脚本方法论，转成
仓内 `render.test.ts` 里的用例：对一份固定的合成消息窗口，断言输出标签数（`match(/<[a-zA-Z][^>]*>/g)`
计数）不超过一个上限（比如"300 条混合消息窗口标签数 < 15000"），作为"有人不小心把工具条从 10 个按钮
涨到 50 个"或"折叠判断改坏导致长文本不再折叠"的哨兵。**不建议断言绝对毫秒数**——CI 硬件方差会导致这
类断言 flaky（这也是为什么本设计不建议把 §1 的基准脚本直接搬进 CI gate，只作为施工前后人工对比的
记录脚本）。如果要断言"耗时随窗口大小接近线性、没有意外的超线性行为"，可以断言"600 条耗时 / 300 条
耗时 < 3"这种比值型断言，比绝对值稳，但仍然建议放在一个可以单独跳过/标记 slow 的用例里，不进主 CI
关键路径。

**方案 C（唯一能验证真实浏览器成本，只能人工做）**：`memory: workbench-browser-verify-harness` 已经
有一套"隔离 PG:5433 + worktree API:8791 + localStorage `api_base` 覆写，免 Tauri 端到端"的验证套路。
施工完成后，在这套环境里：①写一个种子脚本往一个会话里灌 500~1000 条合成消息（循环调用发送 API 或
直接插 DB，走 seq 递增）；②模拟"多人快速加反应/已读游标快速推进"的负载（并发调用 reaction/read
API）；③配合 Chrome DevTools Performance 面板录制，人工确认：合帧后 Long Task（>50ms）数量明显下降、
流式回复期间不再逐字符卡顿（对照施工前后两份 profile）。这是唯一能验证"真实 `innerHTML=` 解析 +
布局 + 绘制"综合成本的手段——§1 的纯基准只测了 JS 字符串构建这一层，经验上浏览器 parse+layout 层通常
比纯字符串构建更慢，必须真机确认叠加后的总量级，尤其用来复核 §2.2 的 900 上限取值是否需要调整。

**明确承认无法验证的部分**：正因为没有 headless 浏览器/jsdom，**本批不应该引入任何依赖真实
layout/paint 时序正确性的实现**——这是 §2.5 拒绝真虚拟滚动的第三条理由的具体化。§2.1-2.3 的方案全部
可以在"调度决策"这个抽象层面被纯函数测试完整覆盖，真机验证（方案 C）只是用来确认"数字选得对不对"
（比如 900 这个上限），不是用来补正确性的洞——如果一个方案的正确性只能靠方案 C 兜底，说明这个方案
选错了实现路径。

---

## 4. 施工切片 + 围栏

**切片 1（渲染合帧，最高优先级，独立可发）**：
- 新增 `createRenderScrollScheduler`（`view.ts` 内部，不导出）+ 对应纯逻辑单测（用 mock clock）。
- 把 `mergeMessages`/`applyIncomingReactionUpdate`/`applyIncomingMessageUpdated`/`read.updated` 分支/
  turn delta 分支的 `renderScroll()` 换成 `scheduleRenderScroll()`。
- 围栏：不碰 `render.ts`（纯函数不变，输出 HTML 不变，只是调用频率变了）；不新增 npm 依赖；本机直接
  操作路径（发送/翻页/反应点击/编辑/删除/置顶）保持同步 `renderScroll()` 不变，逐一核对没有误伤。
- 验证：方案 A（调度逻辑纯单测，CI 可跑）+ 方案 C（真机 Performance 面板，人工，施工后跑一次）。

**切片 2（窗口上限 + 回落，`timeline.ts` 纯函数 + `view.ts` 接线）**：
- `timeline.ts` 新增 `MAX_MESSAGE_RENDER_WINDOW`/`capRenderWindowSize`/`maybeShrinkRenderWindowSize`
  （风格照抄 `windowRecentMessages` 的中文注释规范），配 `timeline.test.ts` 覆盖边界。
- `view.ts` 接入 `handleReachedTop`/`loadOlderHistory`/`jumpToMessage`（cap）+ `renderScroll` 贴底分支
  （回落）。
- 围栏：不改 `DEFAULT_MESSAGE_RENDER_WINDOW` 既有值 300；不改 `windowRecentMessages` 签名。
- 依赖：可与切片 1 并行（接触的是 `view.ts` 里不同的行为面：切片 1 改"渲染何时触发"，切片 2 改
  "窗口多大"），但建议施工顺序上切片 1 先合，切片 2 的真机验证（方案 C）在切片 1 已经落地的基础上做
  更有意义（不然测出来的卡顿混杂了两个问题）。

**切片 3（滚动锚定补齐，依赖切片 1）**：
- `renderScroll`/`renderScrollPreservingTopAnchor` 合并为一个函数，`wasNearBottom=false` 时统一走高度
  差补偿。
- `mergeMessages` 在不贴底时把 `renderWindowSize` 跟着新增消息数一起长（§2.3-b）。
- 围栏：只改 `view.ts` 内部两个渲染出口函数的合并与 `mergeMessages` 的窗口维护逻辑；不改
  `render.ts`/`timeline.ts` 对外签名。
- 依赖切片 1 的理由：先把高频路径的调用次数降下来，再让每次调用都做锚点补偿的开销才划算——如果先做
  锚点补偿、后做合帧，中间会有一段时间是"每个 delta chunk 都做一次高度差补偿计算"，多余开销。

**不做（对应 §0 裁定，不建施工任务）**：
- 真虚拟滚动（transform 定位 + 测高缓存）——见 §2.5。
- web 侧虚拟化——无标的，`/agent-runs/:id/replay` 不属于这个问题域（若真有人反馈这个页面长 run 场景
  下体积过大，那是"超大 trace 折叠/分页"的独立课题，不该塞进 PERF 批）。
- 图片/文件卡懒加载——不存在这类内容（§0 第 5 点），头像 hydrate 已经是事后挂载的懒加载模式。

---

## 附：本次侦察未触碰、但对施工者有用的既有先例

- rAF 注入模式先例：`apps/desktop-webview/src/pet-surface.ts:288-318`
  （`scheduleDesktopPetFirstPaint`，可注入 clock，纯逻辑单测过）、
  `apps/desktop-webview/src/spotlight/controller.ts:324`（直接用 `window.requestAnimationFrame`）。
- 窗口化先例：`apps/desktop-webview/src/workbench/chat/timeline.ts:400-418`
  （`windowRecentMessages`/`DEFAULT_MESSAGE_RENDER_WINDOW`，R12 批 8 落地，本批 §2.2 的
  `capRenderWindowSize`/`maybeShrinkRenderWindowSize` 直接挨着它写）。
- 真机验证套路：`memory: workbench-browser-verify-harness`（隔离 PG:5433 + worktree API:8791 +
  localStorage `api_base` 覆写，免 Tauri 端到端；四个坑：membership 要手工插入/沙箱断网要 disable/
  deepseek.env key 带引号/点击坐标按截图像素缩放）。
