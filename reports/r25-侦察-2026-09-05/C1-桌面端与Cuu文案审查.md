# A1 文案审查 · 桌面客户端 / Rust 原生壳 / Cuu 人设

分支 `r25/integration-4`，只读审查，未改动任何文件。

## 一句话结论

桌面端没有「AI 叙述自己在干什么」的问题（Cuu 卡片模板甚至已经内建了剥离模型自述的守卫），真正的问题是**内部实现词大面积渗进用户可见文案**——68 处「正在拉…／没拉到」的开发口语、`派 run`／`物化`／`agent-run`／`diff`／`manifest`／`聚焦盒`／`dsh` 这类内部名，加上同一个东西在客户端里有三四种叫法（工作项／工单／任务、军团／小队、变更申请／提议／改动／变更提案）。

---

## 桌面 · 聚焦盒（主窗）

### 高

**`apps/desktop-webview/src/command-palette.ts:79`**
原文：`label: { "zh-CN": "看改动 / diff", en: "Review changes" }`
分类 B ｜ 建议：中「看改动」／英保持 `Review changes`
首屏 12 张能力卡之一，中文标签塞进了开发词 diff，英文侧反而干净。

**`apps/desktop-webview/src/command-palette.ts:80`**
原文：`hint: { "zh-CN": "AI 改动的 diff、审阅与合并", en: "Diff, review and merge" }`
分类 B ｜ 建议：中「逐行看 AI 改了什么，再决定合不合」／英 `See what changed line by line, then merge`
副标题正是解释这张卡做什么的位置，diff 在这里对非工程用户为零信息。

**`apps/desktop-webview/src/spotlight/views/settings.ts:138`**（并见 `workbench/settings/render.ts:58`、`workbench/chat/render.ts:1977`）
原文：`dispatch_run: { zh: "派 run", en: "Dispatch runs" }`
分类 B ｜ 建议：中「派活给 AI」／英 `Start AI runs`
「AI 能做什么」是用户实打实会点的权限开关，中文标签里直接混着内部实体名 run；同一张表在三个文件里各存一份。

### 中

**`spotlight/views/placeholder.ts:23`** — `"这个能力正在接入苹果聚焦盒，马上就好。"` / `"Wiring this capability into the box — almost there."`
分类 B ｜ 建议：中「这个入口暂时打不开，先从其它入口试试。」／英 `This entry isn't available right now — try another one.`
「苹果聚焦盒」是内部设计代号，「正在接入…马上就好」是施工进度而非产品状态。（同文件 `:18` 的 `"即将上线" / "Coming soon"` 是同一问题的低配版，属分类 A、低。）

**`spotlight/controller.ts:1063`** — `"项目已创建，这个预览环境打不开工作台窗口。"` / `"Project created — this preview can't open the workbench window."`
分类 B ｜ 建议：中「项目已创建。在 WorkHub 桌面应用里打开它的工作台。」／英 `Project created. Open its workbench from the WorkHub desktop app.`
「预览环境 / this preview」指的是开发用的浏览器预览。同问题见 `spotlight/views/workbench-open.ts:33`（还多了「原生窗口 / native window」）。

**`spotlight/views/attention.ts:244`** — `"决策来源未完全加载"` / `"Decision sources are partially loaded"`
分类 A ｜ 建议：中「有几条待拍板暂时没能加载」／英 `Some decisions couldn't be loaded`
「来源 / sources」是聚合多个后端接口的实现概念。同句式：`attention.ts:398`「部分待办未加载」、`dashboards.ts:195`「决策数据未完全加载」。

**`spotlight/views/attention.ts:478`** — `"冲突选项缺少必要参数"` / `"This conflict option is missing details"`
分类 B ｜ 建议：中「这个冲突处理不了，去主窗口的改动详情里处理」／英 `This conflict can't be handled here — open the change detail instead`
「必要参数」是接口字段的说法，用户读完不知道下一步。同句 `attention.ts:485/597`、`proposals.ts:362/411/418`。

**`spotlight/views/attention.ts:605`** — `"这类请到对应能力处理"` / `"Handle this in its own capability"`
分类 B ｜ 建议：中「这条要在它自己的页面里处理」／英 `Handle this on its own page`
「能力 / capability」是 `spotlight/registry.ts` 的架构名。同词 `workbench/inbox/view.ts:134`。

**`spotlight/views/replay.ts:281`** — 中`"运行时间线"` ／ 英 `"Run trace"`
分类 B ｜ 建议：英改 `Run timeline`
`trace` 在 `scripts/dev/check-copy-terms.ts` 禁词表里，中文侧已按要求改成「时间线」，英文侧漏了。同文件 `:269 "Loading trace…"`、`:294 "Couldn't load trace"`；`packages/cuu/src/i18n.ts:594 "Cuu organized this execution trace."` 同病。

**`spotlight/views/workitem.ts:93`** — `"仅显示前 100 个子运行"` / `"Showing first 100 child runs"`
分类 B ｜ 建议：中「只显示前 100 个子任务」／英 `Showing the first 100 subtasks`
「子运行 / child run」是 agent run 树的内部结构名。同 `:100`。

**`spotlight/views/dashboards.ts:352`** — `"还有 ${hidden} 条进行中工作未在此处显示（可能是列表截断或权限过滤）。"` / `"+${hidden} more open items are not shown here (list cap or visibility filter)."`
分类 B ｜ 建议：去掉括号，中「还有 ${hidden} 条进行中的工作没有显示在这里。」／英 `${hidden} more open items aren't shown here.`
括号里是把实现上无法区分的两种原因摊给用户；该文件 348-349 行的代码注释已经把理由写清楚了，那才是它该待的地方。

**`spotlight/views/dashboards.ts:694`** — `"静音设置没读取到——为避免覆盖你已有的静音，静音按钮暂时不可用。"`
分类 B ｜ 建议：中「静音设置没加载出来，暂时不能修改。稍后重试。」／英 `Mute settings didn't load, so they can't be changed right now. Try again shortly.`
「为避免覆盖…」是把设计权衡写进了界面。

**`spotlight/views/dashboards.ts:837`** — `` `激活 ${n} · AI 沉淀 ${n} · 精修 ${n}` `` / `` `${n} active · ${n} AI-authored · ${n} refined` ``
分类 B ｜ 建议：中「生效 ${n} · AI 写的 ${n} · 人工精修 ${n}」
「沉淀」是禁词表里的 AI 味套话；且中文「AI 沉淀」与英文「AI-authored」不是一个意思。同词 `dashboards.ts:874`「证据会沉淀在项目里」、`:891`「搜索沉淀的知识」、`command-palette.ts:138`「搜索沉淀的知识与证据」。

**`spotlight/views/memory.ts:279`** — `"AI 蒸馏生成"` / `"Distilled by AI"`
分类 B ｜ 建议：中「AI 自己总结的」／英 `Summarized by AI`
「蒸馏」是禁词表点名的 ML 内部词（要求改说「AI 自学/总结」）。英文 `distill` 同病，`:259` 的 `"it will distill your team's playbook here"` 也是。

**`spotlight/views/settings.ts:82`** — `"AI 助手还没配置——需要管理员在服务器的 .env 文件里设置 LLM_API_KEY 并重启服务后才能使用。"`
分类 B ｜ 建议：中「AI 助手还没配置。请让管理员在服务器上配置模型密钥并重启服务。」／英 `The AI assistant isn't set up yet. Ask an admin to configure a model key on the server and restart it.`
环境变量名与文件路径属于部署文档（旁边已经有「查看部署说明」按钮）。同一件事 `spotlight/views/intake.ts:165` 说得像产品文案，两处口径不一。

**`spotlight/views/settings.ts:139`** — `mutate_drive: { zh: "动网盘", en: "Touch drive" }`
分类 B ｜ 建议：中「改网盘文件」／英 `Modify drive files`。英文 `Touch` 是 mutate 的直译残留。同表 `workbench/settings/render.ts:59`。

**`spotlight/views/settings.ts:114`** — `"指派即建工作副本，agent 立即开工，Cuu 只是告知一声"`
分类 B ｜ 建议：中「派过来就立刻开工，Cuu 只告知一声」。中文里留着未翻译的 `agent`，「工作副本」是实现概念。

**`spotlight/views/settings.ts:337`** — `placeholder="范围 ID" / "Scope ID"`
分类 B ｜ 建议：中「组织 / 工作区 / 角色 / 会话的标识」／英 `Org, workspace, role, or session identifier`
直接把内部字段名当输入提示。同词 `:296-299` 四条说明、`:1622` 校验提示。

**`spotlight/views/settings.ts:341`** — `"优先级达到 1000 的自动拒绝会跨范围强制熔断，压过更窄范围的自动通过——非紧急封禁不要设这么高。"`
分类 B ｜ 建议：中「优先级 1000 及以上会一票否决所有范围里的自动通过，只在需要紧急全面停用时才这么设。」／英 `Priority 1000 or above overrides every auto-approve rule everywhere. Use it only for an emergency stop.`

**`spotlight/views/settings.ts:578`** — `"它没有按 dsh 的惯例声明打包清单，不一定是个能装的插件。"` / `"It declares no dsh bundle manifest, so it may not be a packaged plugin at all."`
分类 B ｜ 建议：中「它没有声明插件打包信息，不一定能装。」／英 `It declares no plugin bundle info, so it may not install.`
`dsh` 是 deepseek-harness 的内部缩写，界面上无处解释。

### 低

- `command-palette.ts:120` — `"AI 运行的时间线与快照" / "Run timeline and snapshots"`：建议中「AI 每一步做了什么，可回退」／英 `Every step the AI took, with rollback points`。
- `spotlight/views/replay.ts:117` — `"撤销会把文件还原到这份快照，并覆盖之后的改动。"`：「快照」→「还原点」。同词 `replay.ts:116`、`labels.ts:102-105`、`proposals.ts:127`、`proposal/render.ts:142`、`editor/render.ts:199`、`packages/cuu/src/i18n.ts:294/295`。
- `spotlight/views/workitem.ts:115/:272` — `"生成变更草稿" / "Create proposal draft"`：英文按内部实体名叫 proposal，中文叫「变更」，同一按钮两端不一致。
- `spotlight/views/memory.ts:69` — 中「已停用」／英 `Deprecated`：英文留了工程词，建议 `Retired`。
- `spotlight/views/memory.ts:140` — `"没有通过置信度校验。"`：建议「Cuu 对这条改动还没有足够把握，补一点依据再保存。」
- `spotlight/views/settings.ts:567` — `"（它要 X，我们捆的是 Y）"`：「我们捆的是 / we bundle」是开发者第一人称。
- `spotlight/views/settings.ts:732` — `"另有 N 个插件目录来自服务端的环境变量…"`：改说「由服务器直接加载」。
- `spotlight/labels.ts:18` — 中「人工处理」／英 `PM mode`：英文用了枚举字面。同 `kanban/render.ts:116`、`timeline/render.ts:167`。
- `spotlight/labels.ts:102-105` — `"Pre-step snapshot"` 等四条：pre_step 是内部枚举，直译后读不懂。

---

## 桌面 · 工作台（Workbench）

### 高

**`workbench/settings/render.ts:635`**
原文：`"该项目的所有 Cuu 对话与 agent-run 都会读到这段指令；与系统工作纪律冲突时以纪律为准。"`
分类 B ｜ 建议：中「这个项目里 Cuu 的所有对话和任务执行都会遵循这段指令；与平台安全规则冲突时以平台规则为准。」／英 `Cuu follows these instructions in every chat and task run in this project. Platform safety rules win in a conflict.`
`agent-run` 是内部实体名；`check-copy-terms.ts` 已把 `AgentRun|agent_run` 列为禁词，但正则不匹配连字符写法，所以漏检。

**`workbench/chat/render.ts:1977`**
原文：`"按能力细分：建任务 / 派 run / 动网盘 / 发通知…"` / `"Break down by capability: create task / dispatch run / touch drive / send notification…"`
分类 B ｜ 建议：中「按事项细分：建任务 / 派活给 AI / 改网盘文件 / 发通知…」／英 `By action: create tasks / start AI runs / modify drive files / send notifications…`
模式弹层紧挨输入框，是最常见的控件之一。

**`workbench/schedule/render.ts:399`**
原文：`"物化到时间线"` / `"Materialize to timeline"`
分类 B ｜ 建议：中「写入时间线」／英 `Add to the timeline`
「物化 / materialize」是数据库词，却落在项目计划审批流的主按钮上。同词：`schedule/render.ts:57`（状态标签「已物化 / Materialized」）、`:369` 结果提示、`schedule/view.ts:350/359`。

### 中

**`workbench/shell.ts:133`** — `aria-label` 与 `title` 都是 `"打开聚焦盒" / "Open Spotlight"`
分类 B ｜ 建议：中「打开快捷入口」／英 `Open quick launcher`。「聚焦盒」是内部设计代号。

**`workbench/shell.ts:852`** — `"这个客户端不支持工作台数据" / "This client does not support workbench data"`
分类 B ｜ 建议：中「这个版本的 WorkHub 打不开工作台，请更新后再试」／英 `This version of WorkHub can't open the workbench — update and try again`。

**`workbench/files/render.ts:91`** — `"变动 = 提议 manifest 的变更集（待审 / 已合），点文件看逐句对照。"` / `"Changed = proposal manifest change set; open a file for the line-by-line diff."`
分类 A ｜ 建议：中「这里是待审和已合入的变更涉及的文件，点文件看逐句对照。」／英 `These are the files touched by open and merged changes. Open one for the line-by-line comparison.`
「X = Y」的定义句式是在解释界面自己，`manifest` 又是未翻译的内部结构名。

**`workbench/chat/render.ts:1959`** — `"只影响你的协同会话；主区观察者由项目治理管。按 1-5 快切"`
分类 B ｜ 建议：中「只影响你的协同会话；项目主区的 Cuu 行为在项目设置里调。按 1-5 快速切换」。「主区观察者」「项目治理」是内部模块名。

**`workbench/settings/render.ts:247`** — `"AI 治理——只影响这个项目的主区观察者与项目级 AI 行为；个人单聊模式在 设置 · AI 里调。"`
分类 B ｜ 建议：中「这些设置只影响 Cuu 在这个项目里的行为；你和 Cuu 单聊的模式在 设置 · AI 里调。」

**`workbench/settings/render.ts:176`** — `"deadline 前瞻天数" / "Deadline lookahead"`
分类 B ｜ 建议：中「提前多少天开始提醒」。中文标签里留着一个未翻译的英文词。同串 `settings/view.ts:662`。

**`workbench/army/render.ts:385-394`** — `"审批超时巡检" / "Approval SLA sweep"`、`"通知提醒阶梯"`、`"主动提醒补投" / "Proactive nudge retry"` 等
分类 B ｜ 建议：把这一段整体重写成用户视角（如「审批超时提醒 / Overdue approval reminders」），或把「定时任务」整块收进管理员视图。
这是把后台定时任务的内部名逐条译给用户看；SLA/sweep/阶梯/补投都是实现词。

**`workbench/army/render.ts:422`** — `"后台调度器当前未启用。" / "The background scheduler is currently disabled."`
分类 B ｜ 建议：中「这台服务器上的定时提醒没有开启。」／英 `Scheduled reminders are turned off on this server.`

**`workbench/army/render.ts:449`** — `"主动性动态" / "Proactivity"`
分类 B ｜ 建议：中「Cuu 主动做的事」／英 `What Cuu did on its own`。同词 `:451/:467`；`:415` 的 `"已克制" / "Held back"` 也是内部状态词。

**`workbench/army/render.ts:456`** — `const stage = item.stage ? \` · ${escapeHtml(item.stage)}\` : "";`
分类 B ｜ 建议：给 stage 建映射表，未映射时不渲染。
把后端 stage 标识原样拼在标签后面，用户会看到裸英文 id。

**`workbench/boot.ts:435`** — `"把下面这段原样发给开发,或直接截图。"`
分类 B ｜ 建议：中「把下面这段发给技术支持，或直接截图。」／英 `Send this to support, or take a screenshot.`
「发给开发」是团队内部视角；另外整块崩溃面板（`:434-436`）只有中文，英文用户会看到中文标题配英文堆栈。

**`workbench/rail.ts:1421`** — `` `已生成邀请并复制 token，发给 ${email} 即可加入。` ``
分类 B ｜ 建议：中「邀请码已复制，发给 ${email} 即可加入。」。`token` 未翻译，而登录页 `desktop-login.ts:555` 同一样东西叫「邀请令牌」。`:1424` 同病。

### 低

- `workbench/chat/render.ts:1424` — `create_work_item: { zh: "建工单", en: "Created a task" }`：术语不一致，且中文是祈使、英文是过去时。
- `workbench/settings/render.ts:168` — `"工单停滞天数阈值" / "Stall threshold"`：建议「多少天没进展算停滞」。同串 `settings/view.ts:654`。
- `workbench/editor/render.ts:174` — `"无法比对改动前的版本（快照已不可读），下面只展示提议后的内容。"`：括号里是失败原因的实现描述。

---

## 桌宠 · Cuu 人设与卡片文案

### 中

**`apps/desktop-webview/src/desktop-cuu-runtime.ts:960`** — `message: "开发预览：daemon 连接不稳定，Cuu 正在重试。"`
分类 B ｜ 建议：中「连接不太稳，Cuu 正在重连。」／英 `The connection is unstable — Cuu is reconnecting.`
「开发预览」是构建阶段标签，`daemon` 是未翻译的进程名。它在 `createDesktopCuuDemoScript` 里，当前无产线调用点（只被测试引用）——建议连同这个死导出一起处理。

**`packages/cuu/src/i18n.ts:411`** — `"界面只显示工具调用和当前状态。"` / `"Only tool calls and current status are shown."`
分类 A ｜ 建议：中「你的需求原文不会显示在这里。」／英 `Your request text is never shown here.`
这句在解释界面自己显示什么；它真正想表达的是隐私保证，直接说保证。

**`packages/cuu/src/i18n.ts:407`** — `"AI 正在阅读需求和项目文件，稍后只展示反问结果。"`
分类 A ｜ 建议：中「Cuu 正在读你的需求和项目文件，找出需要跟你确认的关键点。」／英 `Cuu is reading your request and the project files to find what it needs to confirm with you.`
后半句在预告界面接下来会渲染什么。

**`packages/cuu/src/i18n.ts:410`** — `"正在调用澄清模型生成反问"` / `"Calling the clarifier model"`
分类 B ｜ 建议：中「正在想该问你什么」／英 `Working out what to ask you`。分析屏三条状态之一，主路径可见。

**`packages/cuu/src/i18n.ts:277`** — `"点「查看变更申请」会打开变更详情，里面有总结、改动和确认按钮。"`
分类 A ｜ 建议：中「打开变更申请，看完总结和改动再决定。」／英 `Open the change request, read the summary and the changes, then decide.`
整句在描述点击后界面长什么样，英文里还夹了 diff。

**`packages/cuu/src/i18n.ts:415`** — `"Cuu 当前缺少启动 AI 执行的客户端能力。"` / `"Cuu is missing the client capability to start an AI run."`
分类 B ｜ 建议：中「这个版本的 WorkHub 还不能从这里启动 AI，请更新后再试。」

**`packages/cuu/src/i18n.ts:564`** — 中「AI 自学预算」／英 `Curation budget`
分类 B ｜ 建议：英改 `AI self-learning budget`。中文已译成人话，英文留着内部子系统名。`:571 "Team curation scope"`、`:565 "Eval budget"` 同病。

**`cuu-preferences.ts:606/:635`** — `"实验锁定" / "Experiment locked"`
分类 B ｜ 建议：中「暂未开放」／英 `Not available yet`。

**`cuu-preferences.ts:663`** — `"管理独立桌宠窗口的可恢复交互。这里不显示桌宠形象；形象切换留在独立桌宠右键菜单里。"`
分类 A ｜ 建议：中「调整桌宠窗口的大小、透明度和点击穿透。换形象请右键点桌宠。」／英 `Adjust the pet window's size, opacity, and click-through. To change its look, right-click the pet.`

**`cuu-preferences.ts:671`** — `"只做软隐藏和透明度变化，不移动整只桌宠的锚点。"` / `"Uses soft hiding and opacity only; the pet anchor must not move."`
分类 B ｜ 建议：中「鼠标靠近时桌宠会淡出，位置不变。」／英 `The pet fades out when your pointer comes close; it stays where it is.`
英文的 `must not move` 是把需求原话（规格）搬进了界面。

**`cuu-preferences.ts:683`** — `"桌面桥接不可用，请从系统托盘恢复。"`
分类 B ｜ 建议：中「这里改不了桌宠窗口，请从系统托盘恢复。」

### 低

- `packages/cuu/src/i18n.ts:409` — `"正在读取项目网盘上下文" / "Reading project-drive context"`：「上下文」是喂给模型的那份材料的内部叫法。
- `packages/cuu/src/i18n.ts:439` — `"Cuu 轻卡窗口正在展开。" / "Cuu is expanding the light card window."`：「轻卡窗口」是组件内部命名，且这是给屏幕阅读器播报的。
- `packages/cuu/src/i18n.ts:294/295` — `"留有回滚快照（需人工恢复）" / "Rollback snapshot kept (manual restore)"`。
- `packages/cuu/src/cards.ts:403` — 中「降级模型继续」／英 `Use a cheaper model`：中文是内部档位说法，英文已是用户语言。
- `cuu-preferences.ts:603` — `"Cuu 模型包" / "Cuu model pack"`：可见标签 `:602` 已叫「形象」，只有 aria-label 漏了。
- `cuu-qa-scenarios.ts:248` — `"Cuu 需要你批准这次 file-only 变更。"`：`file-only` 是禁词表明确点名的「设计文档语言泄漏」。同文件 `:130` 的英文 QA 备注还带 `daemon` 与 `should show` 的规格口吻。仅 QA 参数下触发。
- `pet-surface.ts:1295` — `"以 workhub-app-upload.txt 的 smoke 记录作为验收标准，输出给验收同学。"`：`smoke` 是内部测试术语。由 `pet-surface.ts:1910` 的 QA 场景门控制，但仍会渲进真实卡片。

---

## Rust 原生壳（托盘 / 系统通知 / 窗口）

托盘菜单（`tray.rs:146-167`）、窗口标题（`windows.rs:53/81/113`、`tauri.conf.json`）整体干净，中英双语齐全。三处小问题：

- **中** `notify.rs:403-405` — `"新的变更提案" / "New change proposal"`：见下方术语分裂条目。
- **低** `tray.rs:149` — 中「隐藏主窗」／英 `Hide main window`：中文用了内部省略说法，建议「隐藏主窗口」。
- **低** `notify.rs:433` — `"打开成本看板，选择更省的执行路径。" / "...choose a cheaper execution path."`：「执行路径」是调度实现词，建议「换个更省的做法 / pick a cheaper option」。
- **低** `notify.rs:407` — `"AI 运行失败" / "AI run failed"`：Cuu 词典统一说「执行」，系统通知说「运行」。

---

## 系统性问题（跨面，建议整批处理）

**S-1 「正在拉…／没拉到／拉不到」（分类 B，高）** — 68 处、19 个文件。这是开发口里的 fetch/pull，不是用户语言，而且它占据了每个视图的加载态和错误态。取全集：
```
grep -rn '正在拉\|没拉到\|拉不到' apps/desktop-webview/src --include='*.ts' | grep -v '\.test\.ts:'
```
统一改法建议：加载态「正在加载…」，错误态「XX 没加载出来，稍后重试」。

**S-2 同一实体四种叫法（分类 B，中）**
| 实体 | 现有说法 |
|---|---|
| work item | 「工作项 / 任务」`command-palette.ts:87`、「工作项」`intake.ts:75/108`、「工单」`search.ts:55` `chat/render.ts:1014/1424` `settings/render.ts:168`、「工作项」`schedule/render.ts:337` |
| agent army | 「Cuu 的小队 / squads」`command-palette.ts:95` `dashboards.ts:211`、「军团 / Army」`rail.ts:443` `army/render.ts:336` `proposal/render.ts:174` `dashboards.ts:208/712` `workitem.ts:42-51` |
| proposal | 「变更申请」`packages/cuu/src/i18n.ts:284`、「提议」`inbox/view.ts:52`、「改动」`command-palette.ts:79`、「变更提案」`notify.rs:403` |

**S-3 未映射枚举直出（分类 B，中）** — `spotlight/labels.ts:6` 的 `pick()` 在查不到时 `return value`（原始枚举值）；`army/render.ts:399`（backgroundTaskLabel）、`:411`（proactiveKindLabel）同样兜底；`army/render.ts:456` 更是把 `item.stage` 原样拼在标签后。建议统一回退到中性词而不是 id。

**S-4 原始 error.message 顶替产品文案（分类 B，中）** — `spotlight/controller.ts:1073`、`spotlight/views/drive.ts:402/413`、`workbench/rail.ts:1145/1190/1265/1310/1370`、`drive/side-panel.ts:138/164/225`、`proposal/panel.ts:116`、`army/render.ts:525`。

---

## 覆盖清单

| 范围 | 文件数 | 扫描方式 |
|---|---|---|
| `apps/desktop-webview/src/**`（含 spotlight/views 全 14 个、workbench 全 12 个子目录、pet-surface、desktop-* 系列） | 128 个非测试 `.ts` | 逐文件抽出 2162 行「非注释且含中文」的行 + 英文侧关键词扫描（trace/snapshot/manifest/diff/curation/eval/deprecated/payload/endpoint/daemon/capability/preview） |
| `packages/cuu/src/**` | 8 个非测试 `.ts`（i18n.ts 全 720 行逐条读） | 同上 |
| `client-tauri/src-tauri/src/**` | 18 个 `.rs`（tray / notify / windows / locale / spotlight_window / pet_window 重点） | 全量字符串字面量抽取 |
| `apps/desktop-webview/public/**` | 2 个 live2d boot js + 2 个 html | 全量中文扫描 → 零用户可见文案 |

其中 `cuu-qa-dom-report.ts` 只产遥测 JSON、不渲染任何界面文字，`spotlight/css.ts`、`workbench/css.ts`、`icons.ts`、各 `api.ts`/`events.ts`/`store.ts` 无用户可见文案。

命中统计：**78 条**（高 7、中 49、低 22；分类 A 7 条、B 71 条、**C 0 条、D 0 条**）。

---

## 不算违规但值得斟酌

- **`packages/cuu/src/cards.ts:161-195` 是一处做得对的防线**：`isModelSelfNarrationTitle` / `stripProposalOpenedPrefix` / `publicProposalSummary` 会主动剥掉模型自述（「接下来我」「我已经」「let me now provide」）并归一动词，`pet-surface.ts:2485-2489` 有同一套。这正是为什么本轮 C 类（agent 叙述落进交付物）一条都没有。建议把这个守卫的适用面记进文案纪律文档。
- `spotlight/views/dashboards.ts:177` 「自治率 / Autonomy」、`:523`「自我精进占比 / Self-improvement」：是有意的产品指标，但两个词都需要旁注才能理解，建议加一句悬停解释。
- `workbench/shell.ts:151`「情境面板 / Context panel」、`settings/render.ts:256`「静默观察者 / Silence observer」：属于功能命名而非黑话泄漏，可保留；只是要和 `chat/render.ts:1959` 的「主区观察者」统一。
- `kanban/render.ts:179-221` 一组拖拽拦截说明（「评审是 AI 跑完自动进入的——…」）确实在解释系统机制，但它们是操作受阻时的帮助文本，属于豁免情形。
- `workbench/boot.ts:431-437` 崩溃面板会把原始堆栈亮给用户：按「明确的开发者调试面板」豁免不算违规，但它没有语言开关（只有中文）。
- `packages/cuu/src/i18n.ts:404` 的 `cuuStart.defaultIntent`（"从 Cuu 桌宠入口创建一个 AI 可执行事项，先根据用户需求和项目文件反问关键澄清点。"）是一句指令口吻的文本，且全仓没有任何引用点——死键，建议删除而不是改写。
- `spotlight/views/meetings.ts:176`、`dashboards.ts:685/845` 引导用户「去网页版…」：是诚实的能力边界说明，不算违规。
- `notificationTypeLabel` 来自 `packages/ui`（不在本次审查范围），桌面端 `dashboards.ts:664/690/804/805` 直接复用它——那份词表的措辞质量会等比例传导到桌面端。

---

## 禁词门缺口（对照 `scripts/dev/check-copy-terms.ts`）

**缺口一：扫描范围太窄。** 该脚本只扫 5 个词典文件（`packages/ui/src/gold-path/i18n.ts`、`route-components.ts`、`packages/ui/src/i18n.ts`、`apps/api/src/pages/i18n.ts`、`packages/cuu/src/i18n.ts`）。桌面端 128 个源文件里的 2162 行中文文案**一行都没被扫过**——本轮发现的「沉淀」（4 处）、「蒸馏」（1 处）、「file-only」（1 处）全部落在扫描范围外。

**缺口二：纯英文行整片漏检。** 脚本第 62 行 `if (!/[一-鿿]/.test(line)) return;` 只查含中文的行，所以 `"Run trace"`、`"Loading trace…"`、`"Couldn't load trace"`、`"Cuu organized this execution trace."`、`"Curation budget"`、`"Eval budget"` 全部通过。

**缺口三：`agent_run` 正则不覆盖连字符写法。** `/AgentRun|agent_run(?!_)/` 不匹配 `workbench/settings/render.ts:635` 的 `agent-run`。

**第 5 条纪律（解释型文案）目前一个词都没进词表。** 建议补进 BANNED 的短语：

| 建议禁词 | 理由 | 本轮实证 |
|---|---|---|
| `我将｜我们可以｜本页面｜本页用于｜此处展示｜用于说明｜用于展示` | 第 5 条点名的解释型开头 | 本轮桌面端零命中，属预防性 |
| `界面只显示｜这里会显示｜稍后只展示｜会打开.{0,6}详情` | 对界面自身的解说 | `cuu/i18n.ts:407/411/277`、`cuu-preferences.ts:663` |
| `即将上线｜Coming soon｜正在接入｜敬请期待` | 非最终态 / 路线图语言 | `placeholder.ts:18/23` |
| `预览环境｜this preview\b` | 开发运行方式泄漏 | `controller.ts:1063`、`workbench-open.ts:33` |
| `开发预览｜发给开发` | 构建阶段 / 内部视角 | `desktop-cuu-runtime.ts:960`、`boot.ts:435` |
| `聚焦盒｜苹果聚焦盒` | 内部设计代号 | `shell.ts:133`、`placeholder.ts:23` |
| `agent[-_ ]?run\b`（放宽现有规则）｜`\bdaemon\b｜\bmanifest\b｜\bdiff\b｜\bfixture\b｜\bmock\b｜dsh\b` | 内部实体/结构名 | `settings/render.ts:635`、`files/render.ts:91`、`command-palette.ts:79/80`、`settings.ts:578` |
| `派 ?run｜dispatch run｜子运行｜child run` | 内部实体名混排 | `settings.ts:138`、`settings/render.ts:58`、`chat/render.ts:1977`、`workitem.ts:93/100` |
| `物化｜materiali[sz]e` | 数据库词 | `schedule/render.ts:57/369/399`、`schedule/view.ts:350/359` |
| `正在拉(?!伸)｜没拉到｜拉不到` | 开发口语 | 68 处 |
| `范围 ?ID｜Scope ID｜必要参数｜missing details` | 接口字段名直出 | `settings.ts:337/296-299/1622`、`attention.ts:478/485/597` |
| `调度器｜scheduler｜主动性｜proactivity｜巡检｜sweep` | 后台子系统名 | `army/render.ts:385/422/449` |
| `客户端能力｜client capability｜桌面桥接｜bridge unavailable` | 能力协商 / 通道实现词 | `cuu/i18n.ts:415`、`cuu-preferences.ts:683` |
| `实验锁定｜Experiment locked` | 功能开关内部状态 | `cuu-preferences.ts:606/635` |
| `为(?:了)?避免.{0,12}(?:所以|，).{0,20}不可用｜可能是.{0,12}(?:截断|过滤)` | 设计理由 / 实现推理泄漏 | `dashboards.ts:694/352` |

同时建议把 DICTIONARIES 从「5 个词典文件」改成「整个 `apps/desktop-webview/src` + `packages/cuu/src` 的非测试 `.ts`，只扫字符串字面量」，并去掉「必须含中文」的前置过滤。
