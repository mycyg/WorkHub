# R24 S3 走查修复批：Spotlight/设置页易用性（阻断#3/严重#8/M-01/03/04/05/06/10/11 + L-01/03/04/05/09）

- Status: implemented
- Date: 2026-09-05
- Owner: claude（r24/c-spotlight-usability 工位）

## Problem

R24 S3 真机走查（r24-S3-walkthrough.md）在桌面端 Spotlight 聚焦盒与设置页发现一批易用性问题，
本批处置其中派给本工位的一组：主 CTA 失败必然吞掉服务端原因、假的「新建项目」入口、⌘K 徽章
与真实全局热键不符、toast 退场留灰带、结果状态机与查询脱节、AI 未配置在设置页死路、情境面板
暴露内部调度器 id、界面残留 emoji 等。逐条问题定位见走查报告第三节；本文件只记录**非显然的
实现取舍**，不重复走查报告已经写清楚的现象描述。

## Decision

**阻断 #3 + M-04/S-05 共同的根因：`resetShell` 改接 `resetLauncher()`**

- `views/intake.ts` 的 `createSession` 失败处理原来无条件吞掉服务端 `error.message`，弹一句
  「重试」——而项目不存在 / AI 未配置这两种情况重试永远不会成功。改为按 `WorkHubApiError.code`
  分流：`project_not_found` → 专门文案 + 按钮直达 `ctx.open("new_project")`；
  `clarification_llm_unavailable`（或任何 503）→ 专门文案 + 按钮直达 `ctx.open("settings")`；
  其它未知码 → 把 `error.message` 原样透传给 toast（不再是"开场失败，请重试"这句注定失败的话）。
  刻意**没有**照抄 `packages/web-runtime/src/notice.ts` 的 `actionMessage`
  那套「英文界面读到中文错误串→通用兜底+错误码」的 CJK 探测逻辑——那是更大范围的服务端错误
  串 i18n 缺口（`views/memory.ts` 的 `friendlyErrorMessage` 注释里也承认这个事实），本批只解决
  "阻断#3" 点名的两条已知死路 + 把其余码从"生造假重试"改成"至少给出原文"，不做大范围复制一套
  探测式兜底——那会引入新的、未经这批验证的分支组合，超出走查报告点名的范围。
- **`registry.ts` 的 `new_project` 曾映到 `createWorkbenchOpenView(id, {bare:true})`**——那个 view
  只 `invoke("open_workbench", {})` 打开一个空窗口，不建任何项目（严重 #8）。改为
  `views/new-project.ts` 的盒子内联表单：填名字 → `client.bootstrapProject({name})` →
  成功后 `invoke("open_workbench", {projectId})` 打开这个新项目的工作台窗口 → `ctx.resetShell?.()`
  收回聚焦盒。**没有删除** `workbench-open.ts` 里的 `bare` 选项和它的既有测试——它现在只被自己的
  单测直接调用（不再被 registry 引用），是刻意保留的小块死代码，删除属于超出本工单范围的清理，
  记在这里以免被误当成遗漏。
- `resetShell` 原来走 `dispatch({type:"reset"})` → 通用 `render()` 的 launcher 分支，那条路径会
  强制 `searchActive=true`（展开成压住刚打开的工作台的全高网格，S-05 的另一半现象）且从不清空
  `input2.value`（M-04：`state.query` 已经归零但输入框还留着上一次打的字，网格却按空查询显示
  全量能力表，两者对不上）。改接 `resetLauncher()`——这是 Cmd+K / 顶层 Esc / `SpotlightHandle.reset`
  早就在用的"真正退回 idle 条"实现，本身就会清空输入框 + 不强制展开。**一个改动同时解决了两个
  报告编号（S-05 的"网格压住工作台"部分 + M-04 的"输入框与网格对不上"）**，因为它们本来就是同一处
  代码的两个症状。`new-project.ts` 的成功路径复用同一个 `ctx.resetShell?.()`。

**M-01：⌘K 徽章 → ⌥Space**

- 只改了徽章文案 + 给它加了 `title` 说明"隐藏后也能用这个键唤起"；**没有**动本地的 Cmd+K
  键盘处理（`resetLauncher()`，见 controller.ts 里 window keydown 分支）——那是窗口已经打开时
  的一个真实、独立可用的辅助快捷键（清空查询回到干净网格），走查报告没有把它列为问题，改名徽章
  不等于要拔掉这个功能。

**M-06：AI 未配置 → 说明 + 部署文档链接（没有做成 target=_blank）**

- `dashboards.ts` 里已经有一条现成的教训（`data-open-gh-activity` 的处理注释）：这个 Tauri
  webview 的 CSP/webview 配置对外部链接**没有承接**——`target=_blank` 点了没反应，`main.rs`/
  `Cargo.toml` 都没有注册任何"打开系统浏览器"的 invoke 命令或 `tauri-plugin-opener`/
  `tauri-plugin-shell`。如果我直接放一个 `<a href="https://github.com/..." target="_blank">`，
  这就是在制造与本批要修的"假可点"同一类问题。退而求其次：改成一个按钮，点击把
  `https://github.com/mycyg/WorkHub/blob/main/DEPLOY.md` 写进剪贴板（复用
  `workbench/chat/view.ts` 里已经在用、被验证工作的 `navigator.clipboard.writeText` 模式）并
  用 toast 确认，剪贴板不可用时 toast 里至少把链接原文亮出来。**没有**新增 Rust 侧的
  "打开系统浏览器" invoke 命令——那需要新依赖（`tauri-plugin-opener` 或手写
  `std::process::Command::new("open")`）、改 `Cargo.toml`/`main.rs`/`capabilities/*.json`，
  超出本工单的前端 TS 范围，且本机 cargo 构建不在本批验证命令内，贸然加一个没编译验证过的 Rust
  改动风险远大于收益。
- 设置页给不出"一键配置"按钮——`LLM_API_KEY` 是服务端 `.env`，桌面客户端进程连不到那台服务器的
  文件系统，这不是一个可以在前端补全的操作，文案如实说"需要管理员在服务器上做"，不假装能当场解决。

**L-01：emoji → 内联 SVG（两个例外故意不动）**

- `dashboards.ts`/`drive.ts` 里 5 处空态"脸"（文件夹/勾选/铃铛/日历/放大镜）从 emoji 换成内联
  SVG，复用 `command-palette.ts` 已有的同款图标线稿（`FOLDER_ICON` 在 `drive.ts` 本来就存在，
  直接复用；`dashboards.ts` 新增等价的 `faceIcon()` 小助手）。
- **故意没有动** `workbench/chat/render.ts` 的 `REACTION_EMOJI`（👍/👎/✅/❓/👀）——源码里的注释
  明确写着"emoji 只允许出现在这一个映射常量与它拼出的消息 HTML 里……扩充五键集合须回
  01-chat-design.md §6 改表"，这是产品此前**已经拍板**的例外（本机记忆里也记着"reaction破例
  emoji"），不是本批走查发现的新问题，动它属于推翻既有决策而不是修复缺陷。
- **故意没有动** `workbench/css.ts`/`chat/render.ts`/`chat/view.ts` 里的 ✓/✗ 字符 tile——那些
  代码本身的注释就写着"非 emoji，见 04-feedback-design.md §8"，是本产品口径里"字符 tile"这个
  合规选项的既有落地范例，不是待修的 emoji。
- `intake.ts` 的 `(=^･ω･^=)✓` 猫脸 kaomoji（连同 `workitem.ts`/`meetings.ts`/`memory.ts`/
  `replay.ts` 里同款的其它猫脸变体）本来就不是 emoji（是纯文本颜文字），本批新增的两张失败卡片
  沿用同一个 `(=^･ω･^=)` 而不是发明新样式。

**L-03：占位符真实公司名 → 中性示例**

- 除了走查报告点名的 `workbench/rail.ts` 占位符字符串本身，**也**顺手把 `rail.test.ts` 里三处
  把同一个真名当"用户已输入的示例值"使用的测试 fixture 换成了仓库里已有的中性名
  （`客户复盘项目`，`intake.test.ts` 里本来就在用）——这些是测试数据不是产品占位符，严格讲不在
  "占位符"这个词的字面范围内，但同一个真实公司名字符串出现在公开仓库里，无论是不是 UI 占位符
  都不合适，顺手一起清干净成本很低。历史 git 记录里这个名字已经不可撤销地存在，但至少不在这次
  改动后的 HEAD 里再新增一处引用（连本文件自己的说明性注释都换成了不点名的转述）。

**L-04/L-05：设置页 CSS——新增修饰类而非改全局规则**

- `.wh-spot-row-sub` 默认单行截断（`white-space:nowrap;text-overflow:ellipsis`）是给"行副标题"
  这种本该短的文本设计的；被设备列表说明段这种多句解释文字借用后就会被裁成一行省略号（L-04）。
  没有直接改 `.wh-spot-row-sub` 本身（那会让全部真正该截断的行副标题意外换行、打乱很多其它
  视图的行高节奏），新增了 `.wh-spot-row-sub--wrap` 修饰类，只加到这一处 + 本批新增的 M-06
  说明段上。
- L-05（账户/登出行贴着窗口底边）同理没有改 `.wh-spot-body` 的全局内边距（会牵动所有能力视图的
  上下留白），只在设置页模板末尾加了一个 14px 的 `.wh-spot-set-bottom-spacer`。

**M-10：情境面板生 id**

- `apps/desktop-webview/src/workbench/army/render.ts` 的 `BACKGROUND_TASK_LABEL` 表只补了
  `pulse-scheduler.ts` 后来新注册、表里漏掉的两个任务名（`clarification-chase`/
  `proactive-intent-recovery`）的人话标签，没有改整套查表/回退机制——回退到原串的兜底逻辑本身
  是对的（"未映射的名字诚实回退原串，不编造"），只是这张表没跟上后端新增的任务，属于漏译而非
  设计缺陷。

**M-11：验证性质，非新增修复**

- 空意图不发请求的校验（`intake.ts` 的 `data-start` 分支）在本工位接手前就已经存在
  （`c8062f99 fix(desktop): intake Start requires a non-empty intent (L18)`，早于本次走查的
  基线 commit）。本批只**补了一个回归测试**锁死这个行为，没有改动校验逻辑本身——走查报告里
  M-11 的截图很可能是走查当时打包的 `.app` 使用了较旧的前端 bundle（增量构建残留），不代表
  当前源码里这条校验缺失。

## Alternatives considered

- **阻断 #3**：让 `project_not_found`/`clarification_llm_unavailable` 也走"透传原文"这条通用
  路径，不单独给按钮——否决，服务端这两条消息要么是纯中文硬编码（`project_not_found` 的
  "还没有可用项目，无法创建任务。" 没有英文变体）要么措辞面向"这次请求为什么失败"而不是"接下来
  怎么办"，直接透传解决不了"死胡同"的本质问题，走查报告也明确要求"按错误码给行动"。
- **严重 #8**：project 创建成功后留在 intake 一侧的会话流里（不跳工作台）——否决，这条路径的
  起点通常是用户在 launcher 或 ask-cuu 里点"新建项目"，目的就是要一个可以立刻开始协作的工作台
  窗口（命令面板文案本身也是"自动配好群聊、网盘和 Cuu"），留在聚焦盒里不能体现这几件事已经配好。
- **M-06**：给一个"打开系统浏览器"的 Rust invoke 命令——否决，见 Decision 里的风险分析（新依赖 +
  未经 cargo 验证 + 超出前端范围）。
- **M-06**：什么都不做，只是把"Not set up"改成"需要管理员配置"这一句话，不给链接——否决，走查
  报告明确要求"「查看部署说明」链接"，纯文字没有降低"我到底该去哪看"的困惑。
- **L-01**：把 emoji 换成简短文字标签（如 dashboards.ts:189 现有的纯文本"Cuu"那种）而不是 SVG——
  部分采纳：新增的两张 intake 失败卡片用了文字/kaomoji 路线（与 intake.ts 自己的既有视觉语言
  一致），但 5 处"空态脸"图标本来就有对应的线稿图标语汇（command-palette.ts 的能力图标），SVG
  路线零新增设计语言、纯粹是把已有图标挪一个位置用。

## Consequences

- `views/new-project.ts` 是新文件，`resolveCapabilityView("new_project")` 现在返回它而不是
  `workbench-open.ts` 的 `bare` 分支；后者的 `{bare:true}` 组合仍然存在且仍有自己的单测，但生产
  代码里再无调用方——未来若真要删，直接删 `createWorkbenchOpenView` 里 `options.bare` 相关分支
  + `workbench-open.test.ts` 里名字含"new project"/"bare"的几个用例即可，不影响 `workbench` id
  的既有行为。
- `ctx.resetShell` 现在等价于 `resetLauncher()`：任何未来新增的"动作完成后收回聚焦盒"的 view
  （目前只有 `workbench-open.ts` 和 `new-project.ts` 用到）都会得到"清空输入框 + 收起为 idle
  条"的行为，而不是"展开成全高网格"——这是所有未来消费方都应该预期的新语义，不是这两个 view
  各自的特例。
- `.wh-spot-row-sub--wrap`/`.wh-spot-inline-link`/`.wh-spot-set-bottom-spacer`/
  `.wh-spot-empty-face svg` 是四个新增的通用 CSS 钩子，后续任何视图需要"可换行的说明段"/
  "行内文字链接"/"内容区底部余量"/"空态用 SVG 脸"都应该直接复用，不要再各自发明一套。
- 走查报告里 M-02（聚焦盒位置漂移）、M-07（设备列表同名无法分辨）、M-08（昵称模式合并成同一账号）、
  M-09（登录/重绑屏视觉断层）、L-02（托盘图标）、L-06（桌宠离线卡自作主张放大）、L-07（应用数据
  文件散落）、L-08（首启无引导）以及阻断/严重里的 B-01/B-02/S-01/S-02/S-03/S-04 均不在本工位
  范围内（走查报告分给了并行的其它工位或未派发），未处置。
