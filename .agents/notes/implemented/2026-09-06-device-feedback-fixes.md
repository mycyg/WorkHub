# 真机走查六条反馈的修法与取舍（R27）

- Status: implemented
- Date: 2026-09-06
- Owner: claude-code

## Problem

0.2.0 桌面客户端真机走查撞到六条，覆盖语言、契约容错、跨面一致与文案渲染四类：

1. 昵称登录成功后主窗立刻切中文，桌宠卡片仍是英文（Your call / Approve / Delegate）夹着中文正文，重启客户端才对齐。
2. 英文系统上首启，连接服务器屏与登录屏永远是系统语言，`WORKHUB_LOCALE=zh-CN` 不起作用。
3. 一条 `agent_steps.phase` 是契约外值的行让 `/api/pages/workitems/:id` 整页 500，界面只剩「详情没加载出来 / 重试」。
4. 设置页的插件 / MCP 分区会静默整块消失——管理员既看不到分区也看不到任何一句错误。
5. 快捷入口「审批队列」写着「1 条待你拍板」时，工作台「待拍板」还是「都处理完了」。
6. 提议摘要里的 `24-48 小时` 渲成 `24 48 小时`。

其中 5 的原始判断（「两处数据来源不同：approval_requests vs 会话内提议链路」）经查不成立：两面读的本来就是同一个 `GET /api/pages/attention`，会话消息从不参与计数。

## Decision

- **语言（1、2）**：把壳层那份 `Mutex<WorkHubLocale>`（本就是「配置 → 系统语言」汇总后的单一事实源）变成三扇窗口共用的语言来源。新增 Rust 命令 `get_shell_locale`；webview boot 按「显式偏好（localStorage）> 壳层语言 > `navigator.language`」取值（`apps/desktop-webview/src/desktop-shell-locale.ts`）。主窗/工作台在身份语言落定后先 `set_shell_locale`、再广播新事件 `workhub-locale-changed`（payload 带 `source`，发起方跳过自己那一条）；桌宠就地重读重渲并重取当前卡文案，工作台走既有的 reload 生效路径。语言没变只同步壳层、不广播。
- **契约容错（3）**：`toAgentStepVm` 从 `as` 强转改成逐步 `safeParse`，解析不了的那一步丢掉并留结构化 warn（`work_item_agent_step_dropped_unparsable`），整页照常渲。军团面板的 `recent_step` 是同一列、同一类事故，一并收口（可空字段退成 `null`）。
- **分区消失（4）**：设置页 VM 新增 `failed_sections`（结构化字段）把「不该给你看」（字段缺席）与「该看但这次没取到」分开；桌面据此照渲这一区并仍去拉一次清单端点，网页渲一句说清现状的话。同时把 `/api/plugins`、`/api/mcp-servers` 的清单路径改成逐行容错——`compat_report` / `precheck_report` 是没有 CHECK 的 jsonb 且读回来只做 `as` 强转，`mcp_servers.command` 可空而读侧拿 `?? ""` 伪造了契约禁止的空串，任一情形此前都让整条端点 500。
- **计数（5）**：三处角标/副标题各写一遍 `vm.queue?.length ?? 0`，收成 `pending-decision-count.ts` 一个函数；工作台徽标的裸 `setInterval` 换成与主窗同一套 `startVisibilityAwarePolling` 并补 focus 补刷。
- **连字符（6）**：markdown 压平层收成 `packages/ui/src/markdown-text.ts` 的 `stripMarkdownMarkers`（此前四处各抄一份同样的正则），`-` 只在行首列表符/分隔线位置当标记。

## Alternatives considered

- 语言：让登录流程在广播 `workhub-logged-in` 之前先把身份语言落盘——登录那一刻还没有身份，`/me` 要在 reload 之后才拿得到，做不到。
- 语言优先级：让壳层语言压过 localStorage（`WORKHUB_LOCALE` 绝对权威）。放弃：`set_shell_locale` 是 best-effort 的 fire-and-forget，它一旦静默失败就会在下次 boot 覆盖用户自己选的语言。
- 契约容错：把 `agentStepPhaseSchema` 放宽成 `z.string()`。放弃——枚举是给两端 UI 出文案用的稳定键，放宽等于把脏值传染到展示层。
- 分区消失：给 `compat_report` / `precheck_report` 加 `optional()`、让读不出体检结论的行照样进清单。放弃：两端都按 verdict 出话，多一个「说不清」的态要在两端各铺一遍文案，收益不抵；本轮先让坏行不再拖垮整条端点。
- 分区消失：`mcp_servers.command` 契约放宽成可空。放弃——`transport` 目前只有 `stdio` 一种，stdio 行的启动命令确实必填，一条没有命令的 stdio 行是坏数据不是合法状态。
- 计数：在 attention VM 上加服务端 `queue_total` 让两面读同一个标量。暂缓：本轮的真实病因是刷新时机，加字段解决不了它，且会牵动契约与两端渲染。

## Consequences

- 清单端点的坏行会**消失**而不是报错：运维靠 `plugin_row_dropped_unparsable` / `mcp_server_row_dropped_unparsable` 两条结构化 warn 发现它。单行响应（安装/登记/启停之后）仍走会抛的那条路径——那时候的行是本次刚写的，走样就该是 500。
- `failed_sections` 目前只覆盖 plugins / mcp_servers；同一个 `/settings` 路由里 `permission_policies` 的 `catch {}` 是同一类，本轮未动（它的分区没有独立的失败渲染位）。
- `stripMarkdownMarkers` 的第五份拷贝在 `apps/api/src/workers/agent-runner.ts:1471`（通知摘要），不在本轮允许改动范围内，仍会吃掉连字符。
- `DesktopPetSurfaceRuntime` 多了一个只读 `locale`——桌宠当前语言从此可被断言。
- 工作台徽标在窗口隐藏时不再空打后端（与主窗同一取舍），重新可见/聚焦各补刷一次。
