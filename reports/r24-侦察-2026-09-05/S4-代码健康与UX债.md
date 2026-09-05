# S4 · 桌面端代码健康 + UX 债清单(2026-09-05)

范围:`/Users/apple/Desktop/开发项目/WorkHub`,分支 `main-integration` == `origin/main` @ `9f105dc0`(核实时干净,`pnpm --filter @workhub/desktop-webview build` 后 `git status --short` 再次确认为空)。
纪律:全程只读侦察。未做任何 git 写操作、未改仓库文件、未跑 pnpm test/verify/qa、未起服务器、未装依赖。唯一执行的写副作用命令是允许范围内的 `pnpm --filter @workhub/desktop-webview build`(产物落 gitignore 的 `apps/desktop-webview/dist/`)。
关联:不重复 `reports/r23-侦察-2026-09-05/`(A 产品缺口/B 代码精简/C 仓库卫生/D 施工单核实/E 依赖工具链)已覆盖内容,本报告专注桌面端(client-tauri + apps/desktop-webview)代码健康与 UX 债,与其互为补充。B 报告已指出的 `mountChatView`(chat/view.ts)超大函数、两个死 `main.ts` barrel,本报告只做交叉引用不重新举证。

---

## 零、方法论说明:「已修」判定标准

历史教训(用户明确提示):审查员常把已修项当未修。本报告对每条历史发现采用三级判定:
- **已修**:在当前代码里找到直接证据(实现代码 + 通常伴一条 `R1x-xx`/`DSK-xx` 等编号注释指向该发现),已列为「不再是债」。
- **仍开放**:在当前代码里核实同样的缺口依然存在(给出当前 file:line),计入 Top 20。
- **架构变更后不确定**:原始发现所指的文件/模块已被后续重构删除或替换(如 `decision-deck.ts`、`glass-window.ts` 已不存在),原问题随载体一起消失,但没有逐一验证「继任实现是否引入同类问题」——标注为「随重构消失,未逐一复核继任实现」,不计入 Top 20(除非另有独立证据)。

---

## 一、历史桌面 UX/工程债去重清单(逐条现状核实)

### 1.1 `reference/audit-r8/desktop-apple-feel-review.md`(2026-06-24,35 条:0H/17M/18L)

文档自带 checkbox 状态(`[x]`=已处理/`[~]`=MOOT或DEFER/`[ ]`=未处理),本次逐条用 `grep -n "^\- \["` 提取全部标记后,对**仍标 `[ ]`的 5 条**和**部分 `[~]`条**做了代码级复核:

| 编号 | 原状态 | 本次核实结论 | 证据 |
|---|---|---|---|
| M1 + L4 | `[ ]` 未处理 | **确认仍开放**——同一个根因(聚焦盒 resize 无动画),本报告合并为 BX-06 | `client-tauri/src-tauri/src/main.rs:550`(另 `:1329` 新增一处同款调用)`.set_size(LogicalSize::new(...))` 仍是瞬时跳变;`apps/desktop-webview/src/spotlight/css.ts:25` 的 `.wh-spot` 规则里没有任何 `height`/`transition` 声明 |
| L2 | `[ ]` 未处理 | **确认仍开放**,本报告列为 BX-07 | `spotlight/css.ts:56-58`:`.wh-spot-titlewrap{display:none}` / `[data-mode="capability"] .wh-spot-titlewrap{display:flex}` 仍是纯 `display` 切换,无 opacity/transform 过渡 |
| M11 | `[ ]` 未处理 | **架构演进后仍大概率开放**,本报告列为 BX-08 | `pet-surface.ts` 全文件唯一一处 `.innerHTML =` 赋值在 `:499`,包在 `replaceDesktopPetRootHtmlPreservingLive2DFrame` 里,只对 Live2D iframe 做了保留特判;存在 `patchDesktopPetSurfaceRuntimeState`(`:629`)做部分状态补丁,但气泡结构性重渲仍是整体重建,不是常驻节点 |
| L9 | `[ ]` 未处理 | **随重构消失,未逐一复核继任实现**——`decision-deck.ts` 整个文件已不存在(`find`/`grep` 全仓零命中 `decisionDeck`/`DecisionDeck`),原「卡片堆叠无滑动无键盘」的问题连同该文件一起被后续迭代替换掉,继任的 pet 气泡/attention 队列是否有同类缺口未验证 | `find apps/desktop-webview/src -iname "*decision*deck*"` 零结果 |
| M4/M5/L3 | `[~]` MOOT(2026-06-24 时已判「死代码,不值得修」) | **确认已彻底删除**,MOOT 判断兑现 | `apps/desktop-webview/src/glass-window.ts` 不存在(`ls` 报 No such file) |
| L8 | `[~]` DEFER→S12 | **确认已完全清理**(比原判断更彻底) | `command-palette.ts` 现 267 行,文件头注释:「WIRE-05:旧的玻璃命令面板渲染层(renderCommandPalette/commandPaletteCss/resolveCommandAction)…」已删,只剩 `commandRegistry`/`matchCommands` 两个活导出 |
| M6 | `[~]` DEFER(设计取舍,需真机判断) | 未复核(需要真机 UX 判断,非阻塞) | 不计入本次 backlog |
| M9 | `[~]` PARTIAL | **随 decision-deck.ts 消失而失去意义** | 同 L9 |
| L12 | `[~]` DEFER(需真机) | 未复核 | 不计入 |
| 其余 23 条(`M2/M3/M7/M8/M10/M12~M17/L1/L5~L7/L10/L11/L13~L18`) | `[x]` 已处理 | **抽查未见回归**,不再列入债务 | 抽样核实见上表外的 glass-window/decision-deck 删除即为佐证 |

**结论**:35 条里 3 条(M1/L4 合并、L2、M11)是仍在今天代码里可复核的真实开放债,已并入下方 Top 20(BX-06/07/08)。其余要么已修、要么随文件删除而失去载体。

### 1.2 `r16-workbench-redesign/`、`r12-desktop-workbench/`、`r13-workbench-refinement/`

**关键发现**:这三批设计文档里列出的**全部**功能分支(`r12/workbench-full`、`r12/acceptance-server-fixes`、`r12/fix-actioncard-buttons`、`r12/mode-popover`、`r13/4c-cuu-tools`、`r13/a2-assignee-v2`、`r13/c1-context-compact`、`r13/fix-item-settlement`、`r13/g1-small-groups`、`r13/h1-hardening`、`r13/new-batches-design`、`r13/p1-army-panel`、`r13/p15-changed-files`、`r13/p2-decision-loop`、`r13/p3-settings`、`r13/p4-trust-chain`、`r13/s1-spotlight-ai`、`r13/s2-async-cuu`、`r13/s3-personal-space`、`r13/v1-light-glass`)**均已 `git merge-base --is-ancestor <branch> HEAD` 确认是当前 HEAD 的祖先**——即 W1-W5/P1-P4/S1-S3/V1-V2/G1/H1/A2/C1 全部设计批次都已合并落地,不是纸面设计。

`r12-desktop-workbench/acceptance-test-brief.md` 附带的「已知问题清单」9 条,逐条核实现状:

| # | 问题 | 现状 |
|---|---|---|
| 1 | 协同会话没有 UI 创建入口 | **已修**——`workbench/rail.ts:248` 起「R13 批 P2:协同分组末尾加『+ 新建协同会话』真按钮」,`data-wb-new-collab-conversation` 按钮存在 |
| 4 | Cuu 回复中第二条消息不自动重试 | **维持原设计取舍**(而非 bug)——`workbench/chat/view.ts:3212` 起有意识地处理 409 `conversation_turn_busy`,注释显示这是已知边界而非疏漏 |
| 7 | 托盘菜单没有「打开工作台」项 | **已修**——`client-tauri/src-tauri/src/tray.rs:19-25`「R13 批 V2:托盘加『打开工作台』」,`TRAY_OPEN_WORKBENCH_ID` 常量与 handler 都在 |
| 8 | @ 选人器不支持键盘上下选择 | **已修**——`workbench/chat/view.ts:3498/3971/4014` 三处 picker(@提及/模式/改派)均有「R13 H1」标注的 `ArrowDown`/`ArrowUp` roving 处理 |

r16 设计文档末尾列的四个「后续候选」逐一核实:

| 候选 | 现状 | 证据 |
|---|---|---|
| 成员邀请/移出动作 | 已在 r17 G1 批次收口(见 06-gap-fix-plan.md) | — |
| 跨项目 tab 未读全局源 | **已修**,且做得比原候选更严谨 | `workbench/conversation-tabs/model.ts:25-26` 注释明示「unread 由 refreshTabs 从活数据单向刷入的镜像…这里绝不另开一路写 unread」——单一数据源,无双写 |
| 日程 markdown 渲染 | **确认仍未做**,计入 BX-13 | `workbench/schedule/render.ts` 全文件 `plan.intentDraft`/`draft` 相关文本均只走 `escapeHtml(...)`,无 markdown 解析 |
| 会话级模型选择器 | **确认从未实现**,计入 BX-14(需先拍板是否要做) | 全仓 `grep "model.*[Ss]elector\|session.*model"` 在 workbench/chat 下零命中 |

`r13-workbench-refinement/01-new-batches-design.md` 里 M0 的 5 项验收打回(ENV-01/D-01/E-01/F-01/F-02)均标注「已修」或「并入 V1 验收」,未见证据其后又回归,不重复核实。

### 1.3 `r19-iteration-review/02-ssot-2026-07-17.md` 中桌面/原生壳相关条目

Phase 2C(桌面 webview)+ Phase 2D(原生壳 Rust)+ 相关 Phase1 条目共约 15 条,用「`grep -rn "R19-[0-9]+" apps/desktop-webview/src client-tauri/src-tauri/src`(排除测试文件)」找**代码里明确留痕引用该编号的注释**作为「确认已修」的强证据:

**确认已修**(代码里有显式 `R19-N` 注释指向修复,共 11 条):R19-3(AI 改动 revert 按钮)、R19-5(自动通过策略撤销 UI)、R19-9(项目树未读重连补缺)、R19-11(presence 单一源)、R19-12(OS 通知深链)、R19-13(壳层 locale setter)、R19-16(Dock 点击恢复隐藏主窗,`main.rs:945-975` `RunEvent::Reopen`)、R19-23(网盘回收站)、R19-25(网盘行键盘可达)、R19-30(deep-link seq 透传)、R19-40(新私聊即时进左栏)。

**确认仍开放**(全仓零 `R19-N` 注释痕迹,独立 grep 复核过实现确实不存在,计入 Top 20):
- **R19-41** 无自动更新/开机自启/崩溃上报——`Cargo.toml`/`main.rs` 均无 `tauri-plugin-updater`/`tauri-plugin-autostart`/`sentry`/`panic::set_hook` 字样。计入 BX-11。
- **R19-42** `RUST_SHELL_OWNS` 声明 `local_file_sync` 但零实现——`lib.rs:31` 常量数组里仍列着这个字符串,但全仓 `grep "local_file_sync"` 只有这一处声明,没有对应的 Tauri command 或调用方。计入 BX-10。
- **R19-39** step.snapshot 事件白名单丢弃——未找到任何相关代码痕迹(既无修复注释也无原始白名单实现的直接证据),优先级本就是 L,未独立立项,建议下一轮侦察针对性复核。

### 1.4 `reports/审查台账-2026-08-19.md` 的 DSK-*/WIRE-*/MRG-2x

统计:DSK-01~14、WIRE-02~09、MRG-20~28 共 23 条全部标 `☑`。逐条抽查确认无回归。**重点复核了标 `☐`(未完成)的 WIRE-01**——"一套完整的桌面工作台只存在于未合并分支 fix/r21-review-hardening":

- **核实结论:WIRE-01 已在本次侦察时点解除**。`fix/r21-review-hardening` 现已是当前 HEAD 的祖先(`git merge-base --is-ancestor` 返回真),`apps/desktop-webview/src/workbench/` 目录在当前工作树里真实存在,123 个文件全部就位。这条台账当时(2026-08-19)记的"⚠️战略级分叉"风险,到 2026-09-05 已经通过合并解除,**审查台账本身没来得及更新这条的状态**,提醒后续读这份台账的人注意此条已过期。

台账里唯一一条明确带「取舍/待评估」备注、且尚未有后续动作的:
- **DSK-05** ☑ 的备注:「打包后连远端 https 后端的取舍已注释+待评估」。核实:`client-tauri/src-tauri/tauri.conf.json` 的 CSP `connect-src` 目前只有 `'self' ipc: http://ipc.localhost http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*`——**打包后的桌面客户端确实无法连接任何非本机地址**,这与今天并行侦察(`reports/r23-侦察-2026-09-05/A-产品与集成度缺口.md` SA-01)独立发现的"README 三步走用户拿不到桌面主功能"是同一个根因的两次独立命中,交叉印证成立。计入 BX-05。

### 1.5 `.agents/notes/proposed/2026-08-20-desktop-client-token-shell-storage.md`(令牌迁壳层提案)

**核实结论:提案仍是 `proposed` 状态,尚未实施。** `apps/desktop-webview/src/desktop-client-token.ts` 文件头注释原文承认:「设备令牌以**明文**存 localStorage……真正的修复是把令牌迁到 Rust 壳层托管存储(壳层已有 set_client_token 通道…)」——即当前只完成了提案里"备选方案 1"(CSP 收紧,已做)而非"决定方案"(壳层代管,未做)。壳层的 `set_client_token`/`ShellClientToken` 通道确实已存在(`main.rs` 里 `.manage(ShellClientToken::default())`),说明地基已具备,只是 webview 侧尚未切换成"只认会话句柄不碰令牌明文"的代理转发模式。计入 BX-04。

---

## 二、代码健康快检

### 2.1 Rust 壳(`client-tauri/src-tauri/src`,16 个文件共 7353 行)

**关键数字:生产代码里 `.expect(`/`.unwrap(`/`panic!`/`unreachable!`/`todo!`/`unimplemented!` 全部为 0。**

逐文件核实方法:每个文件只有一个 `#[cfg(test)] mod tests {` 块(全部位于文件尾部,`grep -n` 确认每个文件仅一处),把 `.expect(`/`.unwrap(` 的原始计数(11 处 `.expect(`、90 处 `.unwrap(`)按该行号是否落在 `mod tests` 之前拆分,结果**两者的生产代码计数全部是 0**——90 处 `.unwrap(` 和 11 处 `.expect(` 无一例外全部在测试断言里(如 `notify.rs` 37 处、`tray.rs` 18 处、`deep_link.rs` 11 处,均为单元测试)。`panic!`/`unreachable!`/`todo!`/`unimplemented!` 生产+测试合计都是 0。

这是一个**正面**信号:Rust 侧的错误处理纪律良好,没有"图省事直接 unwrap"的技术债,与 desktop-webview 侧(见下)形成对比。

**但对应的负面信号**:没有统一日志/错误上报出口。`grep` 全仓未发现 `tauri_plugin_log`/`env_logger`/`tracing_subscriber` 字样,`main()` 只注册了 `single-instance`/`deep-link`/`notification`/`global-shortcut` 四个插件,不含日志插件。所有错误路径走裸 `eprintln!`(`main.rs` 内 20 处,`sse_worker.rs` 内 2 处等),打包后的 `.app` 里这些输出对普通用户完全不可见,也没有落盘,出问题只能靠用户手动复现+接终端跑才能看到。

**窗口生命周期**(`main.rs:1930-1948` 的 `on_window_event` + `should_hide_instead_of_close`):
- **main 窗**:拦截 `CloseRequested` → `api.prevent_close()` + `window.hide()`——关闭按钮语义是"收进托盘"不是"退出",避免 Tauri v2 默认销毁 webview 后托盘/深链/通知再也唤不起主窗的老问题(注释引用了 `findings[#132/H15]`)。有单测 `should_hide_instead_of_close_covers_main_and_workbench_but_not_pet_or_unknown_labels`。
- **workbench 窗**:同 main 窗一样拦截 close 改为 hide(R13 批 V2 换原生红绿灯后,原生关闭按钮也会触发同样的默认销毁,故同款处理)。`create_workbench_window_if_missing` 保证"以为已经开着"的复用语义。
- **pet 窗**:`should_hide_instead_of_close("pet")` 为 `false`——close 拦截不覆盖 pet。pet 窗 `decorations:false`(见 tauri.conf.json),没有原生关闭按钮,这条一般不会被真实触发,但没有为 pet 补一条对称的"防御性拦截"(万一未来某处误发 close 请求,pet 会被真正销毁而非隐藏)。
- **Dock 图标点击恢复隐藏主窗**:已实现(`RunEvent::Reopen`,R19-16,`main.rs:945-975`),隐藏态下恢复、已可见态下不抢焦点,两个分支都有单测。

**single-instance / deep-link / notification 错误处理**:三个插件的注册处都用 `if let Err(error) = ... { eprintln!(...) }` 模式吞掉错误并打日志,不会导致整个 `.run()` panic——全局热键插件的注册甚至专门写了大段注释说明"绝不让热键被占用炸掉整个启动"。这是良好实践,唯一缺口是"打印去哪了"(见上面的日志出口问题)。

**capabilities 权限面**(`client-tauri/src-tauri/capabilities/`,仅 2 个文件):
- `default.json`(windows: `["main","pet"]`):`core:default` + `core:window:allow-start-dragging`。
- `workbench.json`(windows: `["workbench"]`):`core:default` + `allow-start-dragging` + `allow-hide` + `allow-minimize` + `allow-is-focused`,文件描述字段里写明了为什么单独建一份("Scoped to the workbench window only so main/pet ACLs stay unchanged")。
- 评估:**权限面本身是最小化的**,且做了按窗口的显式隔离,没有笼统全开。四个插件(single-instance/deep-link/notification/global-shortcut)在 capabilities 里都没有对应的 ACL 条目——说明它们只在 Rust 侧调用、没有把插件自己的 JS API 暴露给 webview 直接 invoke,这是更安全的模式(前端拿到的是自定义 `#[tauri::command]` 和自定义事件,不是插件原生 JS SDK)。

**打包与分发**(`tauri.conf.json`):CSP 的 `connect-src` 只放行 `'self' ipc: http://ipc.localhost http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*`(见上 BX-05);`bundle.macOS.hardenedRuntime: false` + `signingIdentity: "-"`(ad-hoc 签名)——按当前配置构建出的 `.app` 无法走标准 macOS 公证流程分发给非本机用户;`.github/workflows/verify.yml` 里也没有 `tauri build`/打包产物 job(与今日 A 报告 SA-01 独立印证一致)。

### 2.2 `apps/desktop-webview` 构建产物(`pnpm --filter @workhub/desktop-webview build`)

```
dist/index.html                          0.42 kB
dist/pet.html                            0.47 kB
dist/workbench.html                      0.49 kB
dist/assets/browser-CsDKGgNc.js        297.25 kB │ gzip:  83.35 kB
dist/assets/workbench-C-MmKm_n.js      470.62 kB │ gzip: 118.42 kB
dist/assets/desktop-login-DIj8KpMc.js  497.80 kB │ gzip: 128.65 kB
```
294 个模块,构建后**没有任何 chunk 超过 500kB**(最大 497.80kB,压线之下),但也**没有任何代码分割**——三个 JS 产物就是三整块,零 `import()` 动态加载。三个 HTML 各自的 `<script>` 引用(读 `dist/*.html` 实证):
- `index.html`(main/Spotlight 窗):`browser-*.js` + `desktop-login-*.js`
- `pet.html`(桌宠窗):`browser-*.js` + `desktop-login-*.js`(与 main 窗**共用同一个 browser.ts 入口**,运行时靠 `pet.html` 内联的 `window.__WORKHUB_SURFACE__ = "pet"` 让 `resolveDesktopSurface()` 分流到 `bootDesktopPetSurface` 还是 `bootSpotlight`)
- `workbench.html`(工作台窗):`workbench-*.js` + `desktop-login-*.js`(独立入口 `workbench/boot.ts`,同样靠内联 `window.__WORKHUB_SURFACE__ = "workbench"` 标记,虽然这个入口本身不走 `resolveDesktopSurface` 分流)

`desktop-login-*.js`(497.80kB,三个窗口**全部**引用)命名具有误导性——它不是"登录页面有这么大",而是 Rollup 把 `browser.ts` 与 `workbench/boot.ts` 共同静态 import 的依赖图(`desktop-login.ts` 本身只有 297 行,但它又引入了 `@workhub/api-client`、`desktop-client-token.ts` 等,共享依赖被 Rollup 提取成一个以其中某个入口模块命名的公共 chunk)自动摘出来,按图的某个模块起名。构建后 `git status --short` 复核为空,符合只读纪律。

**三窗共享与差异**:main/pet 共享 `browser.ts` 整个入口(通过运行时标记分流,而非构建时拆分),workbench 是独立入口文件。三者都静态依赖同一个"公共 vendor 图"(desktop-login chunk)。这个架构本身是合理的(共享鉴权/client 基建代码),但意味着**任何一个窗口打开都会把另外两个窗口用不到的代码一起加载**(比如 pet 窗打开时,`browser.ts` 里 Spotlight 的全部 view 代码也在同一个 297KB chunk 里,pet 用不到)。对 Tauri 本地加载场景影响有限,但如果之后要在意首屏渲染延迟,这是可优化点。

### 2.3 硬编码字符串 / i18n

**关键数字:全仓(非测试 .ts)内联 `zh ? "…" : "…"` 三元表达式 1066 处,而集中的 `cuuT()`/`workHubT()` 翻译帮助函数调用只有 111 处。**

即桌面端"支持中英双语"这件事,91% 靠逐处内联三元表达式实现,不是词典驱动。集中度最高的 15 个文件(按三元数排序):

| 文件 | 三元数 |
|---|---|
| `workbench/chat/render.ts` | 110 |
| `spotlight/views/dashboards.ts` | 96 |
| `spotlight/views/settings.ts` | 93 |
| `workbench/settings/render.ts` | 66 |
| `spotlight/views/attention.ts` | 62 |
| `workbench/army/render.ts` | 55 |
| `workbench/rail.ts` | 52 |
| `spotlight/views/memory.ts` | 46 |
| `spotlight/views/proposals.ts` | 45 |
| `spotlight/views/drive.ts` | 39 |
| `workbench/schedule/render.ts` | 36 |
| `workbench/drive/render.ts` | 36 |
| `workbench/timeline/render.ts` | 29 |
| `spotlight/views/workitem.ts` | 29 |
| `spotlight/views/meetings.ts` | 27 |

后果:新增第三种语言、统一某句文案措辞、或做文案审计,理论上要动上千个调用点而不是一张表。

### 2.4 键盘可达性 / aria 粗测

全仓(非测试)`aria-*` 属性 179 处、`role="..."` 55 处、`tabindex` 30 处、`addEventListener("keydown"...)` 13 处,覆盖 114 个非测试文件 / 44729 行。数量级上"存在但不均":集中在 R13 H1 批(@提及/模式/改派三个 picker 的 roving tabindex)、R19-25 批(网盘行 `role=button tabindex=0`)、以及 Spotlight 核心(启动器网格的 `aria-activedescendant`)。较新/较大的模块(如 `workbench/chat`、`workbench/army`)相对这两处的密度明显更低——不构成"某个具体交互点无法用键盘操作"的确诊,但值得下一轮做一次针对性专项审计而非本报告臆断覆盖率百分比。

### 2.5 断网 / 服务端重启 / 令牌失效的用户可见表现(逐窗口对照)

| 场景 | main + pet(共享 `browser.ts`) | workbench(独立 `boot.ts`) |
|---|---|---|
| **启动时连不上后端** | `bootSpotlight()` 整个 try 块的 `catch (error)`(`browser.ts` 内)调用 `renderDesktopOfflineCard()` → `bindDesktopOfflineCard()`(`desktop-offline-card.ts`),渲染「暂时连不上后端」玻璃卡片,带当前连接地址、改地址输入框、重试按钮 | **确认为不对称缺口**:`ensureWorkbenchClientToken(client).catch(() => ({identity:null, gate:"offline"}))` 确实计算出了 `gate:"offline"`,但 `boot()` 函数里只有 `if (auth.gate === "needs-credentials")` 这一个分支判断,**从未检查 `"offline"`**——网络失败时代码直接往下走 `const identity = auth.identity`(为 `null`)然后正常 `mountWorkbenchShell(...)`,不出现任何等价的"连不上后端"提示。计入 BX-03 |
| **令牌失效/登出(登出态)** | `gate === "logged-out"` 分支渲 `mountDesktopRebindScreen`(DSK-01 已修) | `isWorkbenchDesktopLoggedOut()` 检测 + `bindWorkbenchLoggedOutListener` 跨窗口登出广播,`shell.showLoggedOut()`,链路完整 |
| **密码/hybrid 模式登录门** | `gate === "needs-credentials"` → `mountDesktopCredentialGate`(P1-02/REL-5 已修) | 同款 `bindDesktopCredentialGate`,已修 |
| **运行中 SSE 断线重连** | `desktop-cuu-runtime.ts` 自制 fetch/EventSource,DSK-03 台账已确认重连修复 | 会话消息流走既有 reconcile 事件(设计文档承诺),未在本轮做端到端复核 |
| **未捕获运行时异常(致命错误)** | 无对应"渲染错误面板"机制(依赖各分支自身 try/catch) | 有专门的 `renderFatalBootError()` + 顶层 `window.addEventListener("error"/"unhandledrejection")` 兜底,渲染包含错误堆栈原文的可读面板并提示"截图发给开发",这一点工作台反而做得比 main/pet 更好 |

**结论**:两侧各有一个薄弱环节——workbench 缺"连不上后端"的启动期卡片(BX-03,真实回归/不对称,S 工作量,证据扎实),main/pet 缺 workbench 那种"致命异常兜底面板"(次要,可选跟进,未独立立项)。

### 2.6 测试分布

全仓 `apps/desktop-webview/src` 共 103 个 `*.test.ts`,`^\s*(it|test)\(` 计 **1529** 个用例(与任务描述的"1531"基本吻合,细微出入可能是最近几次提交增减)。按目录拆分:

| 区域 | 测试文件数 | 用例数 | 占比 |
|---|---|---|---|
| `spotlight/`(聚焦盒) | 21 | 267 | 17.5% |
| `workbench/`(工作台) | 55 | 1052 | 68.8% |
| 根目录(`pet-surface`/`desktop-cuu-runtime`/`cuu-*`/`browser`/`desktop-login` 等共享与桌宠层) | 27 | 210 | 13.7% |

工作台测试量随其 123 个源文件的体量成正比地占了近七成,是当前测试投入最集中的区域;桌宠/共享层测试相对其 `pet-surface.ts`(2558 行,全仓次大单文件)的复杂度而言,密度显著更薄。

**cuu-r3 浏览器可跑 smoke 家族覆盖面**:`apps/api/src/qa/cuu-r3-*.ts`(launcher-harness / run-stream-smoke / launcher-to-run-smoke / run-failure-smoke / tauri-run-stream-server / dev-server-launcher-smoke / reload-restore-smoke / error-fault-smoke)+ `apps/api/src/cuu-r3-launcher-harness.test.ts`,配合 `docs/workhub/05-clients/assets/audit/2026-06-1x-cuu-r3-*`(tray-recovery/settings-menu-recovery/pass-through-recovery/reload-restore/run-stream/run-failure/business-matrix/sidecar/linux-tray-smoke)—— **全部指向桌宠/启动器/run-stream 场景,零指向 workbench**。全仓 `find`/`grep` 未发现任何"workbench-r-系列"或同等浏览器级/真环境 smoke。workbench 的 1052 条测试**全部是 Node/jsdom 字符串级测试**(断言 innerHTML 片段),没有真实浏览器渲染或真 `.app` 冒烟兜底它"确实能启动并显示"。计入 BX-12。

---

## 三、Top 20 打磨 backlog

排序依据:用户可感知价值 > 修复确定性 > 工作量倒序。「量」用 S(<1天)/M(1-3天)/L(>3天)。「模型」是建议施工模型(sonnet=常规实现,opus=需要架构判断/大文件重构/多语言协同)。

| ID | 面 | 一句话 | 证据 | 修法 | 量 | 模型 |
|---|---|---|---|---|---|---|
| **BX-03** | 工作台 | workbench 窗口断网/连不上后端时直接静默挂载空壳,main/pet 有清晰离线卡而工作台没有 | `workbench/boot.ts` 计算出 `gate:"offline"` 却从未检查这个分支(只判断了 `needs-credentials`);对照 `browser.ts` 的 `bootSpotlight()` catch 块调用 `renderDesktopOfflineCard` | 把 `desktop-offline-card.ts` 的渲染逻辑在 `auth.gate === "offline"` 分支里复用/移植,提前 return,不再往下 mount shell | S | sonnet |
| **BX-06** | Spotlight | 聚焦盒 resize 仍是原生窗口硬跳变,自 R8(2026-06)起承诺的"灵动生长"从未兑现 | `client-tauri/src-tauri/src/main.rs:550,1329` `set_size` 无动画;`spotlight/css.ts:25` `.wh-spot` 无 height transition | Rust 侧对 `set_size` 加一个 ~200ms 补间循环,或前端对内层容器做 FLIP 高度动画,gate 在 `prefers-reduced-motion` 之后 | M | opus |
| **BX-09** | 全局(i18n) | 1066 处内联 `zh?"":""` 三元字符串而非集中词典(仅 111 处走共享 `cuuT`),文案维护/扩展新语言成本随文件数线性增长 | 计数与 top15 文件清单见 §2.3;最密集 `chat/render.ts`(110)/`dashboards.ts`(96)/`settings.ts`(93) | 先从密度最高的 2-3 个文件抽取集中 string table 做试点(不需要一次性全量迁移),验证模式后再推广 | M(试点)/L(全量) | sonnet |
| **BX-04** | 壳/安全 | 设备令牌仍以明文存 webview localStorage,2026-08-20 提案的"迁壳层托管"方案未落地 | `desktop-client-token.ts` 文件头自认仍是明文方案;`ShellClientToken`/`set_client_token` 通道已存在待接 | 落地提案"方案 2":webview 改持会话句柄,API 请求由壳层代理注入鉴权头(涉及 fetch/EventSource 多处改造,提案已列出范围) | L | opus |
| **BX-05** | 壳/分发 | 打包后 CSP 只放行 localhost,自托管远程服务器连不上;+ macOS ad-hoc 签名/hardenedRuntime 关闭,无正式分发流水线 | `tauri.conf.json` connect-src 仅 127.0.0.1/localhost;`bundle.macOS.hardenedRuntime:false`+`signingIdentity:"-"`;`.github/workflows/verify.yml` 无 `tauri build` job | 需先拍板(与今日 A 报告 SA-01 同根因):放行用户自配 https 主机 + 补打包/签名/公证流水线,或明确"桌面客户端仅限本机部署"并更新 README 措辞 | L | opus(需产品先拍板) |
| **BX-08** | 桌宠 | Cuu 决策气泡仍整体 innerHTML 重建,无常驻 DOM 节点,aria-live 播报可能因节点被摧毁重建而不可靠 | `pet-surface.ts:499` 唯一 innerHTML 赋值点,`patchDesktopPetSurfaceRuntimeState`(`:629`)只覆盖部分状态,气泡结构性变化仍整体重渲 | 参照现有 patch 函数模式,把气泡根节点保留为常驻,只 patch 内容,加入场过渡 | M | opus(2558 行大文件需谨慎) |
| **BX-07** | Spotlight | 顶部栏"搜索框↔标题"切换是 display 硬切,无 crossfade,和聚焦盒其它位置的弹簧质感不一致 | `spotlight/css.ts:56-58` 纯 `display:none/flex` 切换 | 改用 opacity 交叉淡入替代 display 切换(建议与 BX-06 同批做,同属 controller.ts/css.ts) | S | sonnet |
| **BX-19** | 工作台 | `workbench/chat/view.ts` 已达 4153 行(`mountChatView` 单函数约 3854 行,今日 B 报告已指出),继续在此文件叠功能边际风险持续上升 | 文件行数本次复核为 4153(高于 B 报告记录的 3854,说明还在增长);闭包内已按渲染头/成员/composer/数据/actionCards/messageActions 六簇聚集 | 按六簇边界拆分为独立模块(B 报告已给出切法),先重构再叠新功能 | L | opus |
| **BX-01** | 壳 | Rust 侧错误无统一日志出口,全靠散落 `eprintln!` 输出到 stderr,打包后用户/开发都看不到 | `main.rs` 内 20 处、`sse_worker.rs` 内 2 处 `eprintln!`;`Cargo.toml`/`main.rs` 无 `tauri-plugin-log`/`tracing_subscriber`/`env_logger` | 接入 `tauri-plugin-log`(文件 + stdout 双 sink),替换现有 `eprintln!` 为 `log::error!`/`log::warn!` | M | sonnet |
| **BX-12** | 测试基建 | cuu-r3 浏览器可跑 smoke 家族只覆盖桌宠/launcher/run-stream,workbench(123 文件/1052 用例)零真实环境验证 | `apps/api/src/qa/cuu-r3-*.ts` 全部指向 tray/settings/pass-through/reload/run-stream/run-failure;全仓无 workbench 对应项 | 仿 cuu-r3 模式或复用 `reference/wh-report/capture.mjs` 式 CDP 截图管道,建一个跑得起来的 workbench 启动+核心交互 smoke | L | opus |
| **BX-11** | 壳/分发 | 无自动更新/开机自启/崩溃上报(R19-41 遗留),桌面客户端长期只能靠手动分发+手动重启排障 | 全仓无 `tauri-plugin-updater`/`tauri-plugin-autostart`/`sentry`/`panic::set_hook` | 引入对应插件 + 轻量本地崩溃日志落盘,建议与 BX-05 一并规划(同属"可分发桌面客户端"主题) | L | opus |
| **BX-02** | 壳+工作台 | TS 侧同样没有统一错误上报,全仓非测试代码只有 5 处 `console.error`/`console.warn`,无 telemetry/crash-report 帮助函数 | grep 计数;全仓未找到 `reportError`/`logError`/`telemetry`/`Sentry` 等命名的共享模块 | 加一个轻量前端错误上报(写本地文件经 IPC,或至少统一 console.error 包装),与 BX-01 统一规划成"桌面端可观测性"专项 | M | sonnet |
| **BX-13** | 工作台/日程 | 项目日程计划文本只走 `escapeHtml`,不解析 markdown(r16 遗留候选,从未捡起) | `workbench/schedule/render.ts` 全部计划文本渲染只见 `escapeHtml(...)`,无 markdown 解析调用 | 接入既有 markdown 渲染依赖(若仓库其它地方已有)或引入轻量库 | S | sonnet |
| **BX-10** | 壳 | `RUST_SHELL_OWNS` 声明的 `local_file_sync` 能力从未实现(R19-42 遗留) | `lib.rs:31` 常量数组仍列着这个字符串,全仓无对应 command/调用方 | 需先决定方向:真实现该能力,或从声明清单移除并同步相关文档承诺 | S(移除)/L(实现) | sonnet |
| **BX-14** | 工作台/协同会话 | 会话级模型选择器从未实现(r16 标注"P2 可选",此后从未被任何批次捡起) | 全仓 `workbench/chat` 下 `grep "model.*[Ss]elector"` 零命中 | 需先拍板是否要做;若做,`ai-profile` 扩展 + composer 模型下拉,涉及 `chat/view.ts`(热点,建议排在 BX-19 重构之后) | M | sonnet(需先拍板) |
| **BX-17** | 全局/无障碍 | aria/role/tabindex 覆盖存在但集中于 Spotlight 核心与 R13/R19 专项修复过的路径,较新模块(army/chat 部分交互/schedule)密度明显更低 | §2.4 数字:179 aria-/55 role/30 tabindex/13 keydown,分布不均 | 针对消息操作条、army 卡片、schedule 日历等高频交互组件做一次专项 a11y 补丁,而非全局猜测式修改 | M | sonnet |
| **BX-16** | 构建 | vite 产物里三窗口共享的最大公共 chunk 被自动命名为"desktop-login"(498KB),名不副实,不利于后续按 chunk 体积做优化判断 | `dist/assets/desktop-login-*.js` 被 `index.html`/`pet.html`/`workbench.html` 三者同时引用,内容远超登录逻辑本身 | vite 配置里给这个共享依赖显式 `manualChunks` 命名(如 `vendor-shared`) | S | sonnet |
| **BX-15** | 桌宠/壳 | pet 窗口未被 `should_hide_instead_of_close` 覆盖,若未来任何路径误触发其 close 事件会被真销毁而非隐藏(目前因无原生关闭按钮而未触发,需求核实是否要补一条防御性拦截) | `main.rs` 测试 `should_hide_instead_of_close_covers_main_and_workbench_but_not_pet_or_unknown_labels` 显式断言 `!should_hide_instead_of_close("pet")`;`tauri.conf.json` pet 窗 `decorations:false` 无原生 chrome | 核实型任务:确认 pet 窗当前所有可能触发 close 的路径(托盘/快捷键/IPC)均不会打到这个事件;若存在遗漏路径,补一条对称拦截 | S | sonnet |
| **BX-18** | 壳 | 插件权限面核实为最小化且按窗口隔离(default.json/workbench.json 只用 core:* 权限),建议补一次显式确认:notification/deep-link/global-shortcut/single-instance 四插件在 capabilities 里均无 ACL 条目是否为有意设计(仅 Rust 侧调用,不暴露 JS SDK 给前端) | `capabilities/default.json`+`workbench.json` 内容见 §2.1;四插件均无对应权限字符串 | 核实型:留一条文档/注释显式记录"这四个插件的 JS API 从不直接暴露给 webview"是设计决策,防止后续有人以为是遗漏而加 ACL | XS | sonnet |
| **BX-20** | 桌宠 | `L9`(决策卡堆叠无滑动/键盘)原发现载体 `decision-deck.ts` 已被删除/重构,继任的 pet 气泡队列/attention 视图是否有同类"多条排队只能看第一条"缺口未验证 | `find`/`grep` 全仓零命中 `decisionDeck` | 下一轮针对当前 pet 气泡排队机制(`surfacePendingDecision`)与 `spotlight/views/attention.ts` 做一次继任实现的同类问题复核 | S(核实) | sonnet |

### 热点文件冲突表(同文件互斥 vs 可并行)

| 热点文件 | 当前行数 | 涉及的 backlog 项 | 并行/互斥建议 |
|---|---|---|---|
| `client-tauri/src-tauri/src/main.rs` | 2516 | BX-06(resize 动画)、BX-01(日志替换扫过全部 eprintln 含 main.rs)、BX-11(注册新插件)、BX-15(核实,几乎不改代码) | **互斥度最高**——BX-06/BX-01/BX-11 三者都要改 main.rs 不同区域,建议串行:先 BX-01(机械替换,风险最低)→ BX-11(插件注册,新增代码块)→ BX-06(resize 逻辑,风险最高)。BX-15 只读核实可随时插入 |
| `apps/desktop-webview/src/pet-surface.ts` | 2558 | BX-08(气泡常驻化重构)、BX-20(排队机制核实) | BX-20 先做(核实),其结论可能影响 BX-08 的方案设计,建议 BX-20 → BX-08 顺序 |
| `apps/desktop-webview/src/workbench/chat/view.ts` | 4153 | BX-19(拆分重构)、BX-14(模型选择器,需在 composer 区域加代码) | **强互斥**——BX-14 若在 BX-19 重构完成前动工,会让重构 diff 复杂化甚至冲突;建议 BX-19 先做完,BX-14(若拍板要做)排在其后 |
| `apps/desktop-webview/src/spotlight/views/settings.ts` | 1737 | BX-09(该文件贡献 93 处三元,若试点选中它) | 独立文件,与其它条目无冲突,可随时并行 |
| `apps/desktop-webview/src/browser.ts` | 413(R8 起已大幅精简) | 无直接条目(BX-03 改的是 `workbench/boot.ts` + `desktop-offline-card.ts`,不改 browser.ts 本身) | 无冲突 |

**可高度并行的一批**(互不共享文件):BX-03(workbench/boot.ts + desktop-offline-card.ts)、BX-07(spotlight/css.ts,小改)、BX-13(workbench/schedule/render.ts)、BX-16(vite.config)、BX-17(视具体组件文件而定,通常与上述不重叠)、BX-04(desktop-cuu-runtime.ts 等,范围大但文件独立于上述热点)。

**需要产品先拍板、不建议直接排期施工的**:BX-05(自托管远程连接策略)、BX-10(local_file_sync 方向)、BX-14(模型选择器是否要做)。

---

## 附:本次验证方法留痕

- Rust `.expect`/`.unwrap`/`panic!` 统计:对每个 `.rs` 文件定位其唯一 `#[cfg(test)] mod tests {` 起始行,按行号切分生产代码段与测试段分别计数(见 §2.1),非估算。
- i18n 三元计数:`grep -rc 'zh ? "' --include="*.ts" .`(排除 `*.test.ts`),逐文件计数取 top15,非抽样估算。
- 测试用例数:`grep -rhoE "^\s*(it|test)\(" --include="*.test.ts"` 按目录分别统计。
- vite chunk 体积:实跑 `pnpm --filter @workhub/desktop-webview build`,读构建器 stdout 与 `dist/` 产物;构建后 `git status --short` 确认为空(符合"只读侦察"纪律,产物在 gitignore 内)。
- 历史发现"已修/未修"判定:优先信任代码里显式的编号注释(如 `R19-N`/`R20 DSK-UX`/`R13 批 X`),其次用 `grep`/`find` 直接验证声称的实现是否存在;凡本报告标"确认仍开放"的条目均给出了当前 file:line 证据,不是照抄旧文档结论。
