# 壳层体验批：深链导航通道、系统语言、应用数据目录、统一日志、托盘图标

- Status: implemented
- Date: 2026-09-05
- Owner: claude-code（R24 S3 走查报告 `r24-S3-walkthrough.md` 的严重 #6 / 严重 #4 / 低 L-07 / 低 L-02，
  与 S4 健康度台账 `r24-S4-desktop-health-backlog.md` 的 BX-01）

## Problem

真机走查（`desktop-walkthrough/`）在 Rust 壳层记了五条互不相干的账，共同点是「都只有打包成 `.app`
双击运行时才暴露」：

### 1. 深链与托盘导航在热态全失效（严重 #6，截图 `31-deeplink-notifications.png`）

`open workhub://open/{notifications,settings,approvals}` 在应用已经在跑时，只把 app 拉到前台，
**并把聚焦盒复位成 idle 搜索条**——不是「没反应」，是把用户当时正开着的能力（走查里上一步正开着设置页）
洗掉了。托盘「打开收件箱 / 设置」走同一条通道，走查里因此只做了推断、没能验证。

根因是两端合谋的一条竞态，两端各有一半：

- **Rust 半边**：`execute_window_control` 对 label=="main" 的**任何**计划都无条件
  `app.emit("navigate", route)` 广播一个裸字符串。而 `show_main_window()` 这种「只是把窗口显示出来」
  的计划带的 route 是根路径 `/`（`window_controls.rs` 的 `show_main_window`，序列化契约里也钉着
  `value["route"] == "/"`）。
- **webview 半边**：`handleDesktopSpotlightShellNavigate` 把「认不出的路由」一律当成
  `spotlight.reset()`——一个**破坏性默认值**。`capabilityForShellRoute("/")` 按设计返回 undefined，
  于是根路径正好落进这条复位分支。

macOS 上 `open workhub://…`（应用已在跑）会同时触发两件事：deep-link 插件的 `on_open_url`
（→ navigate `/settings`，正确），以及**应用被激活**导致的 `RunEvent::Reopen`（主窗此刻通常是隐藏态
——聚焦盒 Esc 即隐藏是常态 → `dock_reopen_plan` → `show_main_window_plan` → navigate `/`）。
第二条随后把第一条刚打开的能力洗掉。点托盘菜单同样会激活应用，同废。

同一条缺陷还在无声地影响另外三个入口：全局热键 Option+Space、托盘「打开 WorkHub」、工作台里的
「打开聚焦盒」按钮——它们每次都会清空盒子里正开着的东西。

三种状态的实际覆盖情况（修之前）：冷态靠 `take_pending_deep_link` 暂存重放，**本来就是通的**；
热态与「窗口隐藏」两态被上面这条竞态吃掉。所以这不是「事件没送到」，是「送到了又被另一条事件覆盖」。

### 2. Rust 壳的语言写死中文（严重 #4）

`config.rs` 的 `lan_default()` 用 `WorkHubLocale::default()`，而 `locale.rs` 的
`DEFAULT_WORKHUB_LOCALE = ZhCn`——壳层**从不读系统语言**。英文系统上托盘菜单整列中文
（`打开 WorkHub / 隐藏主窗 / 打开收件箱 / 设置 / 退出 WorkHub`）。`tauri.conf.json` 里 workbench 窗的
`title` 也直接写死「WorkHub 工作台」。

### 3. 应用数据文件散在 Application Support 根目录（L-07）

`pet-window-state.json` / `workhub-shell-config.json` 用 `BaseDirectory::Config`，在 macOS 上解析到
`~/Library/Application Support/` **根目录**，跟别的 app 的数据混在一起（实测本机根目录下就躺着
`pet-window-state.json`），卸载时也没人知道该删哪几个文件。

### 4. Rust 侧没有统一日志出口（BX-01）

诊断全是散落的 `eprintln!`（S4 台账记的是 main.rs 20 处 + sse_worker.rs 2 处，逐行数实为 26 + 2）。
开发时从终端跑还看得到，打包成 `.app` 双击启动后 stderr 没有任何人在读——用户报「深链没反应 / Cuu 一直离线」时，现场没有任何可回收
的证据。依赖树里只有 `log` / `tracing` 两个传递依赖（都没有配套 file appender），`tauri-plugin-log`
根本不在树里。

### 5. 托盘图标不符合 macOS 规范（L-02，截图 `32-menubar-tray.png`）

托盘直接复用 `app.default_window_icon()`：紫色圆角方块里塞两行 "Work Hub" 小字。菜单栏里跟旁边一水儿的
单色 template 图标格格不入，深色菜单栏下不会自适应反色，22pt 尺寸下那两行字读不出来。

## Decision

### 1. 把「显示窗口」和「导航到目标」拆成两件事

新增 `window_controls::ShellNavigatePayload` 与纯函数 `shell_navigate_payload(plan)`：

| 计划 | 是否发 navigate |
| --- | --- |
| `focus_main_route(_, "/settings")`（深链/托盘/系统通知） | 是，payload `{route, label, source, reason}` |
| `show_main_window(_)`（route = `/`） | **否**——显示窗口不是导航 |
| `hide_main_window(_)`（无 route） | 否 |
| 桌宠窗 / 工作台窗的任何计划 | 否（只有聚焦盒消费 navigate；工作台走 `deep-link` 通道） |

发送从 `app.emit`（全局广播）改成 `app.emit_to(label, …)` 指名收件人——桌宠/工作台从不消费 navigate，
事件面越窄越好。需要注意 Tauri 的这层过滤只作用于**显式限定了 target 的**监听器，JS 侧 `listen()` 默认
注册的是 `Any`，仍会收到；所以 payload 里同时带 `label`，接收端要自证时有据可依。payload 从裸字符串换成
结构体，也让接收端能判断这条导航是谁、为什么发的。

webview 侧把破坏性默认值翻过来，契约收敛成三条：

1. 路由能映射到能力 → 打开它（带实体 id）；
2. 路由恰是根路径 `/` → 回 launcher 主页（**唯一**一条会复位盒子的分支，且壳层已不再为「显示窗口」发它）；
3. 其余（解析不出、映射不到的路由如 `/workbench/…`、`/me`，或带 `show-main`/`hide-main` 原因的事件）
   → **什么都不做**，保留用户现场。

第 3 条里对 `reason` 的判断是对旧壳层的兜底（新壳层已经不发了），两道闸都在，任一端单独回滚也不会复现。

`parseDesktopShellNavigatePayload` 同时接受裸字符串（老壳层/桌宠的 `{route}`）与新结构体，并把
`source`/`reason` 透出来。

### 2. 语言：系统语言进来当默认层，显式配置仍然压过它

优先级（从低到高）：`DEFAULT_WORKHUB_LOCALE` < **系统语言** < `workhub-shell-config.json` 的 `locale`
< `WORKHUB_LOCALE` 环境变量。新增 `load_shell_config_from_json_env_and_system`，旧的两参签名保留并委托
给它（`system_locale = None`），既有调用/测试零改动。

系统语言的映射口径**刻意不同于**显式配置：`normalize_workhub_locale`（显式值）认不出时回落中文，而
`workhub_locale_from_system_tag`（系统值）是「zh\* → 中文，其余任何真实语言 → 英文」——一台法语系统
上回落中文正是这条发现本身。空串 / `C` / `POSIX` 返回 `None`，表示「这个来源不携带语言信息」，继续问
下一个。

来源顺序：**macOS AppleLanguages 优先于 POSIX 环境变量**。`.app` 被双击启动时继承不到 shell 的
`LANG`/`LC_ALL`，AppleLanguages 是 GUI 应用唯一可靠的来源；反过来，从终端启动时 `LANG` 可能与系统设置
不一致，此时也应以系统设置为准。读取用现成的 `defaults read -g AppleLanguages`（失败再试 `AppleLocale`），
只在启动时跑一次；解析是纯函数 `parse_macos_preferred_languages`。

窗口标题：声明层（`tauri.conf.json` + `windows.rs` 的 plan）只放**语言中立的产品名** `WorkHub`——那份
JSON 在读系统语言之前就被 Tauri 消费了，写死任何一种语言都会让另一种语言的用户看到外语标题。给人看的
标题改由 `workbench_window_title(locale)` 在建窗时设，`apply_shell_locale`（切语言）时刷新已开着的窗。

### 3. 应用数据目录：AppConfig + 启动时一次性迁移

两处路径改走 `BaseDirectory::AppConfig`，文件名收敛成 `SHELL_DATA_FILES` 一处定义。
`migrate_legacy_shell_data` 在 `.setup()` 里、**读配置之前**跑一次，逐个文件：旧路径存在且新路径不存在
才搬；新位置已有文件一律不覆盖（新位置才是真相，旧文件留在原地由用户自行清理）；跨卷 `rename` 失败退回
「复制 + 删除」。任何失败只记日志——迁移失败最坏结果是「服务器地址/桌宠位置回到默认」，绝不能因此让应用
起不来。

### 4. 自建最小日志出口 `shell_log`

`shell_log_info/warn/error(event, message)`：stderr 照旧 + 追加写 `BaseDirectory::AppLog` 下的
`workhub-YYYY-MM-DD.log`，最多保留 5 个文件。行形状 `<RFC3339 UTC> <LEVEL> <event> <message>`，
`event` 是稳定的 snake_case 机器名便于 grep，message 里的换行压成空格保证「一条日志就是一行」。

三条纪律：落盘全程 best-effort（写失败沉默、目录建不出来退回只有 stderr 的旧行为，日志系统自己坏掉绝不
影响应用）；翻篇（跨天/首次写）时才扫目录做清理，不是每行都扫；启动第一行日志里写上日志目录本身，
用户报障时「日志在哪」有答案。时间戳自算（Howard Hinnant `civil_from_days`），纯函数带单测。

基线（`d3657ecc`）上 main.rs 26 处 + sse_worker.rs 2 处 `eprintln!` 全部收敛。剩下的都是正确的例外：
main.rs 1 处（setup 里连日志目录都解析不出来时，此刻还没有别的出口）、shell_log.rs 3 处（自身的 stderr
镜像与 `init_shell_log_dir` 建目录失败）。S4 台账当时数的是「20 处」，实际逐行数为 26。

### 5. 托盘：macOS 单色 template 图标，像素算出来而不是打包 PNG

`tray_template_icon_rgba(size)` 纯函数生成 44×44（22pt @2x）RGBA：RGB 恒为 0、形状全在 alpha
（macOS template image 的契约，系统按菜单栏明暗自行填黑/填白），配 `icon_as_template(true)`。
图案取「hub」的字面含义：中心节点 + 四颗卫星 + 辐条，上下左右都对称。非 macOS 平台继续用彩色应用图标。

## Alternatives considered

- **深链：只改 webview（把 reset 分支删掉）**。能止血，但 Rust 侧仍会为每次「显示主窗」广播一条语义错误
  的 `navigate "/"`，下一个接收端还会踩。两端都改才算把「显示窗口 ≠ 导航」这条语义钉住。
- **深链：只改 Rust（不发根路径）**。同样能止血，但 webview 那个「认不出就复位」的破坏性默认值会继续吃掉
  桌宠卡片链接、未来新增的路由。
- **深链：给 `navigate` 加去重/时间窗压制竞态**。治标，且引入一个「多久算同一次」的魔法数字；根因是语义
  不分，不是时序。
- **保留「显示主窗时复位盒子」**（Option+Space / 工作台按钮的旧行为）。放弃了：它与深链竞态是同一条代码
  路径，保留就等于保留缺陷。副作用是热键唤回盒子时会停在上次的能力上而不是空搜索条——判断这是更好的
  行为（不丢用户的位置），且 ⌘K 本就是「清空回 launcher」的显式手势。
- **语言：给 `normalize_workhub_locale` 直接改默认值**。会连带改掉显式配置里写了未知值时的行为，且
  `falls_back_to_chinese_for_unknown_or_empty_locale` 这条既有契约是有意的。改成两个口径各自明确。
- **语言：加 `sys-locale` crate**。按本轮约定不新增 Cargo 依赖；`defaults` + 环境变量两条来源已覆盖三个
  平台的真实场景。
- **标题：按 locale 写两份 tauri.conf.json**，或在 JSON 里留中文再运行时改。前者是配置分叉；后者会让
  英文用户在窗口真正建好前的一瞬间看到中文标题，且声明层留一种自然语言本身就是坑。
- **日志：加 `tauri-plugin-log` / `tracing-subscriber`**。是最省事的方案，但都不在依赖树里，与本轮
  「不新增 Cargo 依赖」冲突。自建 helper 约 200 行且全部可单测，代价可接受；日后要换成插件，替换点只有
  `shell_log_*` 三个函数。
- **托盘图标：从应用图标派生单色版**（去色 + 阈值化）。试过这条思路后放弃：紫底 + 两行文字在 22pt 单色下
  无论怎么处理都不可读，得到的只会是一坨黑方块。
- **托盘图标：打包一张 PNG 资源**。`Image::from_bytes` 需要 tauri 的 `image-png` feature，等于往依赖树
  里加 `image`/`png` 一串 crate；`Image::new_owned` 直接收 RGBA 缓冲，纯函数还能单测形状不变量。
- **托盘图标：三颗卫星的 hub 标记**。先画了这版，菜单栏尺寸下上下不对称、且中心与卫星容易糊成一团；
  改四颗卫星后双轴对称、辐条更细，同尺寸下更清楚。

## Consequences

- **行为变更（有意）**：托盘「打开 WorkHub」、全局热键 Option+Space、Dock 图标点击、工作台的「打开聚焦盒」
  按钮，不再把聚焦盒复位成空搜索条——盒子会停在你离开时的那一屏。想要空盒子按 ⌘K。
- **契约变更**：`navigate` 事件的 payload 从裸字符串变成 `{route, label, source, reason}`。webview 侧
  两种形状都收，故壳层/前端可以分别回滚；但如果新增第三个消费者，请读结构体而不是假定字符串。
- `tauri_scaffold.rs` 里那条钉着 `app.emit("navigate", route.clone())` 的源码断言已改为钉新形状
  （`shell_navigate_payload` + `event_channel_name(ShellEvent::Navigate)`），并新增「不许再出现裸字符串
  广播」的反向断言。
- 首次运行新版本时，旧的 `pet-window-state.json` / `workhub-shell-config.json` 会从 Application Support
  根目录**移动**到 `com.mycyg.workhub/`。降级回旧版本会读不到它们（表现为服务器地址/桌宠位置回默认）。
- 日志文件落在 `~/Library/Logs/com.mycyg.workhub/`（macOS 的 `BaseDirectory::AppLog`），按天滚动、留 5 天。
  内容只有壳层自己的诊断；令牌一直是只记尾 4 位（既有纪律，未放宽）。
- **未做（留给后续）**：设置页的「打开日志目录」按钮。`spotlight/views/settings.ts` 属于本轮另一条并行
  线的施工范围，避免同文件冲突；壳层这边已经把日志目录写进启动第一行日志，先靠它兜底。要补的话是一个
  新 tauri command（自定义命令不需要额外 capability）+ 设置页一行 invoke。
- **未做**：`handle_deep_link_plan` 在热态也会写一份 `PendingShellDeepLink` 暂存（TTL 15s）。热态下主窗
  早已 boot 完、不会再调 `take_pending_deep_link`，所以这份暂存只会静静过期；但如果 15s 内某个窗口恰好
  reload（换服务器/切语言/登出都会 reload），它会被当成「这次」的深链重放一次。危害小（重放的是用户几秒前
  自己点的那条深链），但不干净，记在这里。
- **未做真机验证**：本批全部改动只跑了 `cargo test` / `cargo clippy` / webview 单测，没有重新打包 `.app`
  跑一遍走查。深链热态、托盘菜单三项、托盘图标观感、系统语言（需要一台英文系统或临时改 AppleLanguages）、
  数据迁移与日志落盘，都需要下一轮真机复验。
