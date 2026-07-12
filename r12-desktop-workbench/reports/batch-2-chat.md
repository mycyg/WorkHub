# 批 2 完成汇报（主区群聊 MVP）

日期: 2026-07-12 · 执行: Claude · 分支: `r12/batch2-chat`（从 `r12/workbench-full` 拉出，HEAD 含 `25ba7624` wave-1 integration seams + `356dac83` wave-1 acceptance docs）

范围声明：本批只做 `apps/desktop-webview/**`、`apps/api/src/routes/conversation-typing.ts`（+ 它的测试）、本报告文件。未碰 `packages/api-client/**`（评估后判定不需要——见下方「关键取舍」第 1 条）、`app.ts`、`openapi.ts`、schema/迁移、`packages/db`、`packages/contracts`、`client-tauri/**`、`qa` 脚本。

## 做了什么

1. **`apps/desktop-webview/src/workbench/chat/` 新目录（10 个源文件 + 8 个 colocated 测试文件）**：主区群聊完整前端——消息流（按 seq 升序、日期分隔、system_event 折叠行、file_card/action_card/tool_note 各自的最小渲染）、成员条（吃 workbench VM 的 `workspace_members`，不编造在线状态）、composer（文本发送 + `@` 成员/网盘文件 picker 真实可用 + `#`/`/` picker 外壳「即将可用」灰态）、SSE 接线（手写 fetch+ReadableStream 客户端，指数退避+抖动重连，重连后用本地最高 seq 补缺口）、typing 节流（2s 一次）、发送中乐观渲染（失败可重试）。
2. **`apps/desktop-webview/src/workbench/pending-deep-link.ts` + 测试**：深链冷启动竞态的前端侧兜底（wave-1 报告遗留项 #5，明确点名"批2 接 SSE/store 时一并处理"）。
3. **`apps/api/src/routes/conversation-typing.ts` + 测试**：typing SSE 生产者路由，故意不挂载（照 `conversation-army.ts` 的既成先例）。
4. **`shell.ts`/`rail.ts`/`boot.ts`/`workbench-open.ts`/`icons.ts`/`css.ts` 的最小化接线改动**（逐项在下面「改过的既有文件」列出）。

不做/明确降级的部分已在下面「缺口」列出，全部照实说明，没有假装完成。

## 新增文件清单

### `apps/desktop-webview/src/workbench/chat/`（新目录）

| 文件 | 一句话 |
|---|---|
| `trigger-parser.ts` + test | `@`/`#`/`/` 触发符解析纯函数，照 wisp `app_support.rs:494-559` 的边界规则（紧跟行首/空白才算触发；`/` 只在消息最开头触发，斜杠命令语义） |
| `timeline.ts` + test | 消息按 seq 排序去重、按天分组、时间格式化——纯函数 |
| `typing-state.ts` + test | typing 瞬态状态（3s TTL）的 upsert/prune 纯函数 |
| `events.ts` + test | 用契约的真实 zod schema（`conversationMessageCreatedEventSchema`/`conversationPresenceTypingEventSchema`）校验 SSE 收到的事件，不匹配当前会话/校验不过一律静默丢弃（不是 ad hoc 摸字段） |
| `api.ts` + test | 消息分页/发送/typing ping 的数据访问薄层，走 `client.request<T>()`（见下方「关键取舍」第 1 条）；`fetchAllConversationMessagesFromStart` 实现「首屏一次性正向拉到当前」的历史加载策略，带防御性 `maxPages` 上限 |
| `render.ts` + test | 全部纯 HTML 渲染函数：成员条/日期分隔/消息气泡（按 kind 分发）/typing 提示/连接横幅/空态/composer/`@` picker/`#`&`/` 「即将可用」picker/乐观发送中气泡 |
| `stream.ts` + test | 手写 fetch+ReadableStream 的 SSE 客户端：指数退避+抖动重连、frame 解析、`onReconnected` 回调 |
| `view.ts` + test（部分） | imperative 挂载层，把以上纯函数接起来（挂载数据拉取/DOM 事件/SSE 订阅/typing 节流/防抖文件搜索）。`mountChatView` 本身无直接单测（见下方说明），只测导出的两个纯函数 `addAttachment`/`removeAttachment` |

### 其它新文件

- `apps/desktop-webview/src/workbench/pending-deep-link.ts` + `pending-deep-link.test.ts`：深链冷启动竞态兜底。
- `apps/api/src/routes/conversation-typing.ts` + `conversation-typing.test.ts`：typing 生产者路由（详见下方专节）。

## 改过的既有文件（逐处说明）

- **`apps/desktop-webview/src/workbench/shell.ts`**（+约80行）：
  - `WorkbenchShellApiClient` 类型加 `ChatViewApiClient`（结构上等于加了 `request`/`pages.drive`）+ `Pick<..,"request"|"streams">`——中栏渲染真群聊需要 `client.request`（消息/typing 走它，理由见下方「关键取舍」）和 `client.streams.conversation(id)`（拼 SSE URL）。
  - 新增 `mountWorkbenchShell` 的可选入参 `getClientToken`——SSE 手写客户端要设 `X-YQGL-Client-Token` 头（`EventSource` 加不了自定义头，这是本批用 fetch+ReadableStream 而非原生 `EventSource` 的唯一原因）；`boot.ts` 显式传入它自己的 `clientToken()`，没传时 shell.ts 用一个同款兜底默认值（顶部 `defaultClientTokenReader`，和 `desktop-cuu-runtime.ts` 的 `desktopCuuBrowserClientToken` 是同款 6 行 helper 的第三份独立实现——三边故意不抽共享模块，避免制造跨 surface 的耦合）。
  - **`renderCenter` 改动是本批的核心接线**：项目选中且 VM 就绪、且能定位到主会话时，中栏改为挂载真实 `chat/view.ts`（`mountChatView`），取代批 1 的数字摘要占位。用 `chatMountKey`（`projectId:conversationId`）防止 store 的无关字段变化（如侧栏收放）把已挂载的 chat 视图拆了重建——那样会打断用户正在打的字、重新连一次 SSE。`renderProjectSummaryHtml` 函数本身**没有删除**（仍在文件里、仍有单测，只是不再被 `renderCenter` 调用）——批 1 报告已经预告"批 2 把对应视图接进来"，这是有意的最小 diff 选择（删除会牵连改 `shell.test.ts` 的既有测试，权衡后判定"留着一个已知未调用的旧占位函数"比"额外改动一份测试文件"更符合"最小化"的指示；已作为范围外发现列在下面）。
  - `dispose()` 加一步 `disposeChat()`。

- **`apps/desktop-webview/src/workbench/rail.ts`**（+约20行，-8行）：会话点击路由——「主区」树叶从批 1 的只读 `<div>` 升级成真 `<button data-wb-open-main-chat>`（照批 1 报告的预告"批 2/6 把对应视图接进来时再升级成可点"）；点击调用新增的可选回调 `onOpenMainConversation`，`shell.ts` 把它接到 `chatHandle?.focusComposer()`（不重新拉数据/不重连 SSE，中栏本来就是这个项目的 chat 视图）。「网盘」树叶保持不变（仍是批 6 的事，仍非交互）。

- **`apps/desktop-webview/src/workbench/boot.ts`**（+约30行）：
  - 新增导出 `applyPendingWorkbenchDeepLink(shell, storage?, now?)`：`boot()` 挂载 shell 后调用一次，消费 `pending-deep-link.ts` 的 localStorage stash（见下方专节）。
  - `boot()` 显式把 `clientToken` 传给 `mountWorkbenchShell` 的 `getClientToken`。

- **`apps/desktop-webview/src/spotlight/views/workbench-open.ts`**（+8行）：在 `invoke("open_workbench", ...)` **之前**同步调用 `stashPendingWorkbenchDeepLink({ projectId })`——深链冷启动竞态兜底的写入端。

- **`apps/desktop-webview/src/workbench/icons.ts`**（+1行）：加 `send` 图标（composer 发送按钮）。

- **`apps/desktop-webview/src/workbench/css.ts`**（+约120行）：新增 `.wh-wb-chat-*` 命名空间下的全部群聊/composer/picker 样式；`.wh-wb-center--chat` 修饰符让中栏切成 flex 列布局自管滚动；`.wh-wb-leaf--live` 给「主区」树叶按钮的 hover 反馈。

## typing 端点（`apps/api/src/routes/conversation-typing.ts`）

- `POST /conversations/:id/typing`：uuid 参数守卫 → `requireCurrentUser` 鉴权 → 复用 `ConversationService.assertConversationAccess`（和 `conversations.ts`/`conversation-army.ts` 同一份会话可见性判定，没有另开一条鉴权 SQL）→ 每 (会话,用户) 1s 内去重（`TypingDedupeGate`，内存表带硬上限驱逐，避免无界增长）→ 发布 `conversation.presence.typing` SSE 事件（`makeWorkHubEvent` + `parseOutputContract` 严格过 `conversationPresenceTypingEventSchema`）→ broker 发布失败尽力而为（记警告，不报错，和 `createMessage` 对 message-created 发布失败的既有处理方式一致）。**typing 只发 SSE，绝不落库**——有专门测试断言"传入的 conversations service 除了 `assertConversationAccess` 全会抛错，路由仍然成功"来证明这一点。
- **故意不挂载**：`app.ts` 没有改动，照 `conversation-army.ts` 当初的先例（该文件的注释仍留着"故意不挂载"，尽管它后来被 wave-1 集成者挂上了——这就是这个模式的设计意图：批次作者写好不挂，集成者统一挂）。

### 给集成者的挂载清单

```ts
// apps/api/src/app.ts
import { createConversationTypingRoutes } from "./routes/conversation-typing.js";
// ...
app.route("/api", createConversationTypingRoutes());
```
无需 openapi 手写 schema 变更之外的其它接线（`conversationPresenceTypingEventSchema` 已在批 0 存在于契约里，事件命名/topic 规则也已固定）。若仓库的 openapi 覆盖门（wave-1 报告提到的"覆盖门白名单 +4 端点"）要求新端点显式登记，这个 `POST /conversations/:id/typing` 需要补一条。

## 深链冷启动竞态修复（wave-1 报告遗留 #5）

**根因**（`client-tauri/src-tauri/src/main.rs` `handle_deep_link_url`，只读确认，未改动）：`create_workbench_window_if_missing` 只等原生窗口对象创建完成（`WebviewWindowBuilder::build()` 返回），不等 webview 真正跑到 `bindWorkbenchDeepLinkListener()` 订阅 `"deep-link"` 事件那一步，随后立刻 `app.emit(...)`。冷启动（窗口此前不存在）时这次 emit 几乎总是在前端订阅之前发生，Tauri 事件总线不重放，事件就丢了——用户从 Spotlight「打开工作台」带 `projectId` 冷启动时，窗口会落在空项目列表而不是自动选中该项目。

**前端侧能覆盖的修法**（`client-tauri/**` 本批禁止改动，只能在前端补）：`workhub://workbench` 的三个窗口（main/pet/workbench）在 dev/prod 都共享同一个 origin（`tauri.conf.json` 的三个 `windows` 条目只是不同 `url` path，不是不同 origin），所以 `localStorage` 跨窗口共享。`workbench-open.ts`（Spotlight「打开工作台」的发起窗口）在调用 `invoke("open_workbench", ...)` **之前**，同步把目标 `projectId`（+ 可选 `conversationId`）写进 localStorage（`stashPendingWorkbenchDeepLink`，15s TTL，一次性消费）；`boot.ts` 在挂载 shell 之后立即消费一次（`applyPendingWorkbenchDeepLink`）。这条路径完全绕开了会丢的那次 `emit`——本身是同步 localStorage 读写，不存在 IPC 往返窗口。和已有的 `bindWorkbenchDeepLinkListener`（订阅未来事件，服务"窗口已存在、这次只是复用/切换项目"的场景）互补，两条路径分别覆盖冷启动和热切换。

**覆盖不到的场景（诚实说明）**：应用完全没启动、操作系统直接用 `workhub://` URL 唤起（不经过本 App 自己的 Spotlight UI）——这条路径没有"发起窗口"能提前写 localStorage，Rust 侧仍会在前端订阅前把事件发出去，照样丢。这需要 Rust 侧补一个"窗口就绪后重放最后一条 deep-link"的机制（批1报告已经建议过），不在本批范围（`client-tauri/**` 禁止改动）。

## 关键取舍

1. **没有改动 `packages/api-client`**。批 0 的会话消息端点（`GET/POST /api/conversations/:id/messages`）和批 2 新增的 typing 端点都没有专门的 `WorkHubApiClient` 具名方法——评估后判定不新增：`packages/api-client` 是共享给 `apps/web` 的公共面，为一个只有工作台窗口用的批次特性扩大它的公共接口面（且要求其它 workspace 的完整 `PageClient`/`WorkHubApiClient` 字面量 mock 跟着补桩）不值得。`request<T>` 已经是接口上现成的转发口，`apps/web/src/browser.ts:1099` 的 `client.request<DrivePreviewPayload>(href)` 是同款先例。`chat/api.ts` 只是给它包一层类型安全的薄封装。真要走 api-client 具名方法，未来批次随时可以在不破坏本批代码的前提下补上。
2. **反向历史翻页需要 `beforeSeq`，批 0 只给了正向 `afterSeq`——不改 API，诚实降级**。首屏加载策略：`fetchAllConversationMessagesFromStart` 从 `afterSeq=0` 逐页正向推进拉到"当前"（`has_more=false`），一次性吃下全部历史再渲染；只在 mount 时做一次，不支持"向上翻页补更早的历史"。带 `maxPages`（默认 100 页 = 上限 1 万条消息）防御性上限——这不是产品设计的截断阈值，是防服务端契约回归（`next_after_seq` 不推进）导致的死循环兜底；命中时 UI 显示诚实的 `renderHistoryTruncatedNoticeHtml` 提示。**真实缺口**：这个策略对超长会话（>1万条消息）的首屏加载是 O(会话长度) 的，且命中防御上限时只能展示"最早的一部分"而不是"最新的"（因为只能正向走）——建议批 8 补一个 `beforeSeq` 反向游标端点，这样首屏可以直接拉最新一页 + 真正支持"向上翻页"补历史，而不是现在这种"全量正向游走"。
3. **`#` 会话引用与 `/` 技能唤起只做 picker 外壳**，`renderComingSoonPickerHtml` 渲染一个明确标"即将可用 · 批 4 起接入"的灰态面板，不发真实搜索请求、不插入任何结构化 chip——用户仍可以正常把 `#`/`/` 字符当纯文本继续打字。这是产品指令里明确要求的降级（不是我自行简化）：批 0 其实已经有真实的 `GET /projects/:id/conversations` 端点可以支撑 `#` 的真实搜索，但既然指令明确要求"只做 picker UI + 插入纯文本占位"并强调"不做假 affordance"，我选择了最保守的诠释——不去构建一个"看起来能搜但语义上什么都不做"的中间态，直接诚实标注"即将可用"。
4. **`@` 成员提及是纯文本便利，不是结构化引用**：composer 选中一个成员时，只是把 `"@昵称 "` 字面文本插入输入框（供接收方阅读时被 `render.ts` 的 `highlightMentions` 高亮），不产生任何结构化字段——`conversationTextContentSchema` 只有 `{text}` 一个字段，没有 mentions 数组。真正需要"服务端现查权限、现取内容"的安全通道只用于文件引用（`file_card` 消息，`content` 只存 `drive_item_id`，服务端在 `createMessage` 里现查 drive 权限并取 `snapshot_name`——这部分批 0 就已经实现，本批直接复用）。
5. **附件/文本一次发送可能拆成多条消息**：composer 若同时有已选文件附件和正文文本，"发送"会顺序产出 N 个 `file_card` 消息 + 1 个 `text` 消息（各自独立的乐观发送记录，各自可以独立重试），不是一条"混合消息"——因为 `createConversationMessageRequestSchema` 是判别联合，一条消息只能是一种 kind，无法用单次 POST 表达"文本+多个文件"。
6. **`renderComposerHtml` 的 `sending`/`sendError` 两个 prop 在 `view.ts` 里始终传 `false`/不传**：真正的"发送中"/"发送失败"状态用逐条消息的乐观气泡（`renderPendingOutgoingHtml`）承载，composer 本身不因为有消息在发送就锁死输入框（允许连续发送/排队）。这两个 prop 是 `render.ts` 里保留的、真实可用的纯函数（有测试），只是 `view.ts` 目前没有触发它们的具体场景——不是假接线（没有渲染出一个用户能看见但没被使用的按钮/横幅），只是预留了一条尚未被触发的合法状态分支，供后续批次或产品需要时接上。

## 自查输出

```
$ pnpm --filter @workhub/desktop-webview test
1..447
# tests 447
# pass 447
# fail 0

$ pnpm --filter @workhub/api test
1..975
# tests 975
# pass 974
# fail 0
# skipped 1   ← 既有的 PG 门控测试，无本地 PG 时按既有约定跳过，非本批引入

$ pnpm --filter @workhub/api-client test
1..19
# tests 19
# pass 19
# fail 0        ← 未改动这个包，数量与批1报告一致（0 delta）

$ pnpm -r typecheck
16/16 workspace 全 Done，0 error（含 apps/api / apps/web / apps/desktop-webview / packages/api-client 等全部）

$ git status --porcelain
（全部改动落在 apps/desktop-webview/**、apps/api/src/routes/conversation-typing.{ts,test.ts}、
  本报告文件——无范围外文件）
```

测试数量对比：`@workhub/desktop-webview` 322 → 447（**+125**：`chat/` 8 个新模块 108 条 + `pending-deep-link.test.ts` 11 条 + `boot.test.ts`/`workbench-open.test.ts`/`rail.test.ts`/`css.test.ts` 扩了 6 条新断言）。`@workhub/api` 963 → 975（**+12**，`conversation-typing.test.ts`；963 是从当前分支扣除本批新增后反推的基线，wave-1 报告记录的"947+"是集成时的粗略下限）。`@workhub/api-client` 19（**+0**，未改动，见「关键取舍」第 1 条）。

未跑 PG smoke——不在本批指令给的自查命令清单里（`pnpm --filter @workhub/desktop-webview test`、`--filter @workhub/api test`、`--filter @workhub/api-client test`、`pnpm -r typecheck`），只有涉库批次(0/3/4/5/6)才要求；本批是纯前端+一个不落库的 SSE 生产者路由，没有新迁移/schema 改动。

## 我改过的断言

- **`apps/desktop-webview/src/workbench/rail.test.ts`**：`"renderProjectTreeHtml marks the selected project active and shows its real conversation/drive leaves"` 移除了末尾一条 `assert.doesNotMatch(html, /data-wb-select-project="...101"/)`——这条断言本身在改动后依然为真（我加的属性叫 `data-wb-open-main-chat`，不是它检查的 `data-wb-select-project`），但它的注释"Leaves are informational only — no click affordance markers"在本批之后对「主区」叶子不再成立，留着容易误导。拆成两条新测试：`"the main-conversation leaf is a real, clickable button once batch 2 wires the chat view"`（断言真的有 `<button data-wb-open-main-chat>`）+ `"the drive leaf is still informational-only (no view to route to until batch 6)"`（断言网盘叶子依然没有任何 `data-wb-open*` 属性）——这是**加强**断言覆盖，不是放宽。批 1 报告本就预告了"批 2/6 把对应视图接进来时再升级成可点"，这次升级在计划内。

## 范围外发现（不修，只报）

- `apps/desktop-webview/src/workbench/shell.ts` 的 `renderProjectSummaryHtml` 现在是死代码（有导出、有单测，但不再被 `renderCenter` 调用）——见上方「改过的既有文件」第一条的说明。留着是本批"最小化改动"的取舍，值得未来清理批次决定要不要删（连带删 `shell.test.ts` 里对应两条测试）。
- `client-tauri/src-tauri/capabilities/default.json`/`workbench.json` 的 ACL 真机校验——wave-1 报告已记录"待人工"，本批未涉及。
- 军团总览、网盘视图接入工作台窗口——分别是批 5/批 6 的事，`.wh-wb-army-sum`/网盘树叶保持批 1 的只读状态不变。

## 没做 / 存疑（待人工）

- **真 PG 双用户互聊冒烟**：02 计划原文批 2 验收门写"两个真用户互聊、传文件、@引用，SSE 断线重连后 reconcile 补齐不丢序"——这需要真实运行的 API + PG + 两个真实鉴权会话，超出本次自动化自查（单测+typecheck）能覆盖的范围，需要人工用真机/两个浏览器 profile 走一遍。
- **真机 SSE 行为**：`chat/stream.ts` 的手写 fetch+ReadableStream 客户端在 Node 环境下用合成 `ReadableStream` 测试过完整的连接/断线/重连/frame 解析逻辑（14 条真实行为测试，非 mock），但真实 Tauri webview 环境（`fetch` 实现细节、`X-YQGL-Client-Token` 头是否真的能穿透到本机 API）需要人工用 `.app` 验证。
- **`mountChatView` 没有直接单测**：这个 workspace 的测试运行器（`node --import tsx --test`）没有真实 DOM（无 jsdom），`shell.test.ts`/`rail.test.ts`/`boot.test.ts` 对各自的 `mount*` 函数同样只测其中的纯函数——这是本仓库既有的、贯穿三批的测试策略，不是本批引入的缺口。所有能拆出来的逻辑（事件解析、消息排序分组、SSE 重连退避、渲染函数、附件去重）都已经拆成纯函数单测过；`mountChatView` 本体只是把它们接起来的胶水代码，靠人工真机走查验证 DOM 事件确实接对了。
- **`@` picker 键盘导航未实现**：目前只能用鼠标点选 picker 里的成员/文件行，方向键/Enter 选中未做（Enter 键固定语义是"发送消息"）。这是为了控制本批范围新增的一个已知 UX 简化，未在原始指令里被要求，值得后续小批次补上。
- **拖拽文件上传未实现**：02 计划原文的批 2 描述包含"拖文件=调 drive 上传+发 file_card"，但本次收到的具体施工指令（第 2 条）枚举 composer 能力时没有包含它，只列了文本发送 + `@` picker + `#`/`/` 占位 + 回车发送 + 失败重试 + 乐观渲染。鉴于指令是更具体的授权来源，且批次范围/时间预算已经很大，我选择不做，在此明确披露（不是遗漏，是范围裁剪）——`@` picker 选文件+发 `file_card` 已经覆盖了"引用已有网盘文件"的核心场景，缺的只是"上传一个全新文件"这一步。

## 结论

批 2 主区群聊 MVP 前端完成：消息流（翻页/日期分隔/各 kind 渲染/系统事件折叠）+ composer（文本 + `@` 真实 picker + `#`/`/` 诚实占位 + 回车发送 + 失败重试 + 乐观渲染）+ SSE 接线（断线重连+缺口补齐）+ typing 节流全部落地，`pnpm -r typecheck` 与三个相关 workspace 测试全绿（新增 137 条测试：desktop-webview +125、api +12），`git status` 无范围外文件。批 1 遗留的深链冷启动竞态已用前端侧 localStorage stash 兜底（覆盖"本 App 内发起"场景，OS 级冷启动仍需 Rust 侧配合，已披露）。typing 路由未挂载，等待集成者按上方清单接入 `app.ts`。不进批 3/4，等待人工验收。
