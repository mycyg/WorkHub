# 侦察 B：代码精简 / 去重 / 架构简化

- 侦察范围：`/Users/apple/Desktop/开发项目/WorkHub`，分支 `main-integration`，按当前工作树文件内容（含 2026-08-20 未提交改动）审。
- 纪律：全程只读。所有行号/计数均本人 grep 核过。**所有 rg 均带 `--glob '!.claude/**' --glob '!reference/**'`**——`.claude/worktrees/` 下有三份旧工作树副本（nervous-easley-b9f617 / vigorous-ritchie-6062c2 / beautiful-fermat-440e14），不排除会大面积假阳性。
- 尊重档案：`.agents/notes/implemented/2026-08-20-reserved-endpoints-and-sdk-policy.md` 与 `land-all-reserved-features.md` 已拍板「零调用端点/SDK 方法保留、预留功能全部落地」——**本报告不提议删任何端点或 api-client 方法**。`.agents/notes/rejected/2026-08-19-no-display-layer-copy-regex.md` 已否决展示层正则洗文案，本报告的文案收口一律指向「源头单一词典」方向。

## Top 10 摘要

| ID | 收益 | 风险 | 一句话 | 主要证据 | 工作量 | 模型 |
|---|---|---|---|---|---|---|
| T-00 | -1700 行 | 低 | API 路由测试的鉴权脚手架被复制 41 份，逐字相同 | `function authDeps` 41 文件 / `class MemoryUsers` 43 / `settings(): Settings` 40；两文件 180 行前言 diff 仅 54 行差异且全是常量改名 | M | sonnet |
| D-01 | -2561 行 | 低 | 两个 `main.ts` 死 barrel + 其自证测试，HTML 入口从不加载 | `apps/web/src/main.ts`(194)+`main.test.ts`(823)、`apps/desktop-webview/src/main.ts`(283)+`main.test.ts`(1261)；四个 html 入口全指 browser.ts/boot.ts；代码注释自称「死 barrel」(desktop main.ts:192) | S | sonnet |
| X-01 | 磁盘 -195M | 中 | `docs/workhub/.../assets/audit` 1899 个入库文件占 195M，而 docs.count 门只数 .md | `r2-release-gate-report.ts:54,184` 只 `walk` 数 md；docs/workhub 186 md vs 1907 非 md；但 67 个 md 有 488 处 audit 图链 | M | sonnet |
| T-01 | -770 行 | 低 | 路由守卫「401/404/422/typed 错误」四联测试跨 10 文件逐字重复 | `"requires authentication before reaching the service"` 14 命中/10 文件；46 用例实测跨度 921 行 | M | sonnet |
| S-01 | 拆 3396 行单函数 | 中 | `mountChatView` 是全仓最大单函数，闭包内已按职责聚簇可直接切 | `workbench/chat/view.ts:459`→3854；内含 renderHead/members/composer/data/actionCards/messageActions 六簇（行号见正文） | L | opus |
| S-02 | 拆 2049 行单函数 | 中高 | `createInMemoryAgentRunQueue` 含 56 个嵌套函数，其中 1000+ 行是零耦合纯函数 | `agent-runner.ts:522`→2570；`executeRun` 单体 1613-2017；预算映射区 2572-2982 已在闭包外可直接搬 | L | opus |
| R-01 | -235 行 | 低 | `escapeHtml` 31 份、`safeHref` 8 份定义，规范实现早就在 web-runtime | `rg "^(export )?function escapeHtml\("` = 31 处（packages/ui 17、desktop 7、web 1、QA 5、规范 1） | M | sonnet |
| X-02/X-03 | 磁盘 -305M | 低 | 一个 70M zip + 一个 67M mov + 168M 验收图，全部零代码引用 | `r12-desktop-workbench/reports/R12-人工验收-20260713.zip` 70MB、`F-02-titlebar-drag.mov` 67MB；`验收资料/` 168M 且 `rg "验收资料/"` 全仓 0 命中 | S | sonnet |
| L-01 | 少维护一条引擎 | 中高 | loop2 已是对话轮次的生产路径、agent-run 仍 off；但 loop2 复用 loop.ts 的 finalizeL3 等，翻转后只死 365 行 | `env.ts:125` agent-run 默认 off / `:132` 对话默认 on；`loop2/config-builder.ts:53-64` import 自 `../loop/`；`AgentLoop` 类 `loop/loop.ts:1177-1542` | L | opus |
| T-07 | -1200 行 + 摩擦归零 | 中 | 0 个快照测试，却有 251 处 innerHTML 正则 + 117 处 `[^>]*` 属性顺序胶水 | `pet-surface.test.ts:709` 用 `href="([^"]+)"[^>]*data-cuu-action-id=` 从 innerHTML 抠元素；`route-components.test.ts:2422` 断言 `<h3 role="heading" aria-level="2">会话</h3>` | L | opus |

---

## 台账已 ☑ 项复核（不重复报）

| 台账项 | 复核结论 |
|---|---|
| DSK-14（browser.ts 约 350 行旧 gold-path 壳） | **真删干净**。`apps/desktop-webview/src/browser.ts` 现 413 行（原 1214+）。 |
| WIRE-03（死 boot 牵连 6+ 独占模块） | **部分留尾**。`command-palette.ts` 仍在（254 行）且被 `spotlight/views/workbench-open.ts:10` 引用其 `CommandId` 类型；但两个 `main.ts` 死 barrel 仍在（见 D-01）。 |
| WIRE-04（`restore_pet_window_interaction`） | **台账这条本身是误报，且命令仍在**。`client-tauri/src-tauri/src/main.rs:1582` 定义、`:2044` 经 `workhub_invoke_handler!` 注册、`:1876` 有注释说明「QA 专用命令」；**真有调用方**：`scripts/qa/cuu-tauri-motion-capture.ps1:346` `await invoke("restore_pet_window_interaction")`。台账 WIRE-04 写的「前端零 invoke」漏看了 `.ps1`。**不要删**。 |
| WIRE-05（玻璃命令面板 UI 死） | **真删干净**。`rg "renderCommandPalette\|resolveCommandAction"` 全仓只剩 2 条说明注释；`rg "wh-cmd-launcher"` 0 命中。剩下的 `command-palette.ts` 是活的 Spotlight 能力注册表（见 D-02）。 |
| WIRE-06（cuu 侧 `cardFromProposalDetail`/`cardsFromProposalConflicts`） | **真删干净**。主树只剩 `apps/desktop-webview/src/main.ts:192` 一条说明注释。 |

---

## 一、死代码

### D-01 | 两个 main.ts「死 barrel」+ 其自证测试 | 收益 2561 行 | 风险 低 | S | sonnet

**证据（全部亲验）**：
- `apps/web/src/main.ts` 194 行，导出 `webSurface` 等。唯一引用者：`apps/web/src/main.test.ts:22`（823 行）。
- `apps/desktop-webview/src/main.ts` 283 行，导出 `desktopWebviewSurface` 等。唯一引用者：`apps/desktop-webview/src/main.test.ts:40`（1261 行）。
- HTML 入口全部不指向它：`apps/web/index.html:10` → `/src/browser.ts`；`apps/desktop-webview/index.html:10` → `/src/browser.ts`；`apps/desktop-webview/pet.html:13` → `/src/browser.ts`；`apps/desktop-webview/workbench.html:13` → `/src/workbench/boot.ts`。`apps/desktop-webview/vite.config.ts` rollupOptions.input 只列这三个 html。
- grep `webSurface|desktopWebviewSurface`（排除 .claude/reference）全仓命中只落在这两个 main.ts 与其 test。
- **代码自己承认**：`apps/desktop-webview/src/main.ts:192` 注释原文含「它们只被这个死 barrel自己引用」。

**做法**：删 4 个文件（2 源 + 2 测试）。唯一需要保留的是 `main.test.ts` 里对「surface 覆盖了哪些 API path」的契约断言语义——那是在测死常量本身，不是在测产品，可直接丢；若要保守，把 `webSurface.pages` 里真实存在的路径清单迁到 `apps/web/src/routes.test.ts` 的一条 smoke 断言里（约 20 行）。

**风险**：低。删除后 `@workhub/cuu`、`@workhub/ui/*` 若因此掉到零引用需连带核查（`renderProposalDetail` 除 main.ts 外还被 `apps/web/src/main.ts:8` 与 `apps/desktop-webview/src/main.ts:9` 引用——**这两处都是死 barrel**，删后 `@workhub/ui/proposal` 的 `renderProposalDetail` 可能真变孤儿，需连带 grep 后再决定）。

### D-02 | `command-palette.ts` —— 复核后**是活代码**，只是名字骗人 | 收益 0 行（建议改名） | 风险 低 | S | sonnet

WIRE-05 已彻底清干净：`rg "renderCommandPalette|resolveCommandAction"` 全仓只剩两条说明注释（`command-palette.ts:5`、`command-palette.test.ts:95`），`rg "wh-cmd-launcher"` **0 命中**。文件现存 254 行的导出是 `CommandId`(:8)、`CommandActionKind`(:34)、`DesktopCommand`(:36)、`CommandMatch`(:45)、`commandRegistry`(:58)、`matchCommands`(:243)——**全部在用**：`CommandId` 被 11 个文件消费（`spotlight/{controller,registry,state,ask-cuu,view-context}.ts` + `spotlight/views/{placeholder,attention,dashboards,workbench-open}.ts` + `spotlight-shell-navigation.ts`）。

**唯一问题是命名**：它现在是 Spotlight 的能力注册表，不是"命令面板"。建议改名 `spotlight/command-registry.ts` 并入 `spotlight/`（与 `spotlight/registry.ts` 52 行合并）。**零可删行数，纯认知成本。**

### D-03 | `packages/db/src/relations/core.ts` 整文件 330 行 | 收益 330 行 | 风险 低 | S | sonnet

drizzle 的 relational query API（`db.query.X.findMany/findFirst`）在本仓**从未被使用**：
- `rg "\.query\.[a-zA-Z]+\.(findMany|findFirst)"`（排除 .claude/reference）= **0 命中**
- `rg "drizzle\("` 全仓 4 处命中，全部形如 `drizzle(pool, { schema })`（`packages/db/src/client.ts:64` + 3 个 test），**从不传 `relations`**
- 该文件唯一「引用」是 barrel：`packages/db/src/index.ts:2` `export * from "./relations/index.js"`，转出口后无终端消费者

**连带**：`scripts/dev/check-target-paths.ts:35` 硬编码 `"packages/db/src/relations/core.ts"`，删文件必须同 commit 改这个守卫脚本（不然 `pnpm audit:target-paths` 红）。

### D-04 | `packages/db/src/locks.ts` 整文件 32 行 | 收益 32 行 | 风险 低 | S | sonnet

`DbExecutor` / `lockWorkItemForUpdate` / `lockProjectForUpdate` / `lockMainBranchForUpdate` 四个导出，全仓非定义处命中 **0**（我亲验：`rg "lockWorkItemForUpdate|lockProjectForUpdate|lockMainBranchForUpdate|DbExecutor"` 只回本文件 + 两处路径清单）。行锁在仓储层是就地 `for update` 写的（如 `repositories/conversations.ts:897 lockActiveProject`），从没走这个模块。

**连带**：`scripts/dev/check-target-paths.ts:39` 与 `packages/tools/src/migration-audit.test.ts:22` 都硬编码该路径，需同 commit 改。

### D-05 | `set_shell_locale` 前端零 invoke——但这是「接线欠账」不是死代码 | 收益 0（应补接线） | 风险 — | — | —

`client-tauri/src-tauri/src/main.rs:588` 定义、`:1892` 注册，全仓**前端 invoke 命中 0**（`rg "set_shell_locale|setShellLocale"`：main.rs×3、`sse_worker.rs:188` 注释、r19 文档×3，无 .ts/.ps1 调用）。

**但它不该删**：`r19-iteration-review/00-gap-review-2026-07-17.md:117` 的 R19-13 明确要求「webview 切语言时调它」来解原生壳 locale 启动即冻结。Rust 半边落了、webview 半边没接——按 `.agents/notes/implemented/2026-08-20-land-all-reserved-features.md`（不得存在「界面未上线」），**这是要补接线的欠账，归其他侦察兵的功能缺口清单，不归精简清单**。

### D-06 | 其余零引用导出（子代理索引法核出，逐条已验证据） | 收益 约 130 行 | 风险 低 | S | sonnet

判定方法（可复现）：建全仓标识符词频索引 `rg -o '[A-Za-z_][A-Za-z0-9_]{2,}' apps packages client-tauri scripts --glob '!.claude/**' --glob '!reference/**' | sort | uniq -c`，与 2548 个 `packages/*/src/**` 导出声明 join；**词频==1 即该标识符在整个活代码树里只出现在自己的定义行**。

**确认死**（可直接删）：

| 符号 | 位置 | 行数 |
|---|---|---|
| `can*Requirement` 7 个别名（WorkItem→Requirement 改名兼容层，**未标 @deprecated 且零调用**） | `packages/permissions/src/resource-permissions.ts:261-267` | 7 |
| `MeasuredCallContext` + `MeasuredCallResult` | `packages/agent/src/providers/types.ts:102,:109` | 10 |
| `piMessageToWorkhub` + `isAssistantMessage` | `packages/agent/src/loop2/adapters/messages.ts:347,:354` | 8 |
| `cardsFromCostDashboard` | `packages/cuu/src/cards.ts:1145` | 6 |
| `EventPreview` + `EventData` | `packages/events/src/types.ts:11,:9` | 6 |
| `renderGoldPathBootDocument` | `packages/ui/src/gold-path/app-shell.ts:223` | 4 |
| `ACTIVE_ASSIGNMENT_STATUSES` + `assignmentUserIds` | `packages/permissions/src/assignments.ts:4,:6` | 4（**同文件 `hasExplicitAssignees`/`isAssignedUser`/`leadAssignment`/`ASSIGNMENT_ROLES` 是活的，不可整文件删**） |
| `RuntimePortName` | `packages/config/src/ports.ts:11` | 1 |
| 死 CSS：`wh-wb-summary` 组 8 个类 | `apps/desktop-webview/src/workbench/css.ts:180-190` | 11 |
| 死 CSS：`wh-wb-side-toggle` | `apps/desktop-webview/src/workbench/css.ts:204` | 1 |
| 死 CSS：`wh-wb-sc-plan-tag` | `apps/desktop-webview/src/workbench/css.ts:1319` | 1 |

**仅测试可达**（导出只被自己的 `*.test.ts` 用；建议改成不导出 + 测试内联，或连测试一起删）：`listStaleReposSinceThreshold`（`packages/db/src/repositories/github-bindings.ts:319`，35 行）、`sqliteToPostgresTypeMap`（`packages/db/src/types.ts:7`，27 行）、`assertCuuModelPackCanBeDefault`（`packages/cuu/src/model-pack.ts:326`，10 行）、`allowWithDefaultBudget`（`packages/cost/src/budget.ts:197`，9 行）、`toPublicProviderConfig`（`packages/config/src/providers.ts:61`，9 行）、`visibleTools`（`packages/permissions/src/evaluate.ts:179`，8 行）、`parseRunEventSse`（`packages/api-client/src/sse.ts:27`，4 行）、`isPostgresUrl`（`packages/db/src/types.ts:57`，4 行）、`shouldAskGate`（`packages/audit/src/policy.ts:21`，3 行）、`listCuuModelPacks`（`packages/cuu/src/model-pack.ts:198`，3 行）、`ConversationVM`（`packages/contracts/src/domain/conversation.ts:580`，1 行）。

**存疑不动**：`packages/agent/src/loop2/vendor/` 下的 `AgentState`(types.ts:352)、`ProviderResponse`(ai-types.ts:48)、`createAssistantMessageEventStream`(event-stream.ts:92) —— vendor 目录是 pi 引擎的 vendored 副本（见 `loop2/NOTICE.md`），删了会和上游漂移，**不建议动**。

### D-07 | 契约包 122 个零引用 `z.infer` 类型别名 | 收益 122 行 | 风险 低（但价值低） | S | sonnet

`packages/contracts/src/` 共 **397** 个 `export type X = z.infer<...>`（`rg -c "^export type [A-Za-z0-9_]+ = z\.infer"` 求和），其中 122 个全仓词频=1。我抽验 4 个全部命中=1：`AuthContext`(auth.ts:238)、`ProposalStatus`(enums.ts:101)、`WorkItemSourceContextVM`(pages.ts:1065)、`ConversationMessageCreatedEvent`(events.ts:167)。**注意：对应的 schema 本身是活的，只能删类型别名行**。

**判断**：122 行、每行独立，收益极低；且契约包性质接近 SDK 公开面（与 `.agents/notes/implemented/2026-08-20-reserved-endpoints-and-sdk-policy.md` 对 api-client 的口径同源）。**建议不做**，或只在其他契约改动顺手时清理。列出仅为完整性。

### D-08 | 明确「不是死代码」的几类——防止后续审查员再误报

- **57 个 `--modifier` CSS 类**：css.ts 外零字面量命中，但基类走模板字面量拼接（`wh-spot-card-bar--${tone}` at `spotlight/views/attention.ts:204`、`wh-wb-tl-status--${...}` at `workbench/timeline/render.ts:287`、`wh-wb-army-rc--${variant}` at `workbench/army/render.ts:188`）。**活的**。
- **22 个 Tauri 命令**（除 `set_shell_locale` 外）全部有前端 invoke，含 QA 专用的 `restore_pet_window_interaction`(.ps1) 与 `write_cuu_qa_dom_report`（`apps/desktop-webview/src/cuu-qa-dom-report.ts`）。
- **`packages/contracts/src/enums.ts` 已标 `@deprecated` 的 8 个事件类型**：`conversationToolBegin/End/OutputDelta`、`conversationItemStarted/Completed` 命中各=1 且全在 `.test.ts`；`usageRecorded` 命中=1 在 gold-path 夹具。注释描述与实测一致，无未标注的死事件类型。**按纪律不计入死代码**。
- **端点 / api-client 零调用方法**：`.agents/notes/implemented/2026-08-20-reserved-endpoints-and-sdk-policy.md` 已拍板保留。**明确记在此，防止后续审查员再提。**

---

## 二、重复实现（可下沉共用）

### R-01 | `escapeHtml` 31 份定义 | 收益 ~185 行 + 长期一致性 | 风险 低 | M | sonnet

规范实现已存在：`packages/web-runtime/src/html.ts:1`（同文件还有 `safeHref:12`、`cssEscape`、`eventListenerOptions`）。

grep `^(export )?function escapeHtml\(`（排除 .claude/reference）= **31 处定义**，其中 30 处是复制：
- `packages/ui/` 内 **17 份**：`workitem/render.ts:56`、`onboarding.ts:60`、`gold-path/route-components.ts:1152`、`gold-path/product-shell.ts:343`、`agent-run/render.ts:45`、`gold-path/app-shell.ts:44`、`intake/render.ts:41`、`structured-field-details.ts:7`、`invite-accept.ts:66`、`route-line-editor.ts:66`、`replay/render.ts:58`、`rich-patch-viewer.ts:49`、`subrecord-item-diff.ts:53`、`proposal/render.ts:107`、`route-state.ts:201`、`overlap-hunk-review.ts:45`、`gold-path/render.ts:71`
- `apps/desktop-webview/src/` **6 份**：`desktop-offline-card.ts:26`、`desktop-login.ts:138`、`desktop-rebind.ts:25`、`desktop-cuu-runtime.ts:2247`、`cuu-preferences.ts:712`、`cuu-cat-live2d-runtime.ts:279`、`pet-surface.ts:2512`（实为 7）
- `apps/web/src/routes.ts:440` 1 份
- QA 脚本 **5 份**：`apps/web/qa/{r4-web-redis-sse-browser-smoke.ts:107, r4-web-locale-metrics-browser-smoke.ts:57, r4-web-live-api-pg-seed.ts:91, s1-day2-pilot-browser-dry-run.ts:69, r4-web-live-route-interaction.ts:397}`

每份 6–8 行。**注意**：`packages/ui` 复制的原因大概率是不想让 ui 依赖 web-runtime（依赖方向）。正确做法不是让 ui 依赖 web-runtime，而是把 `escapeHtml/safeHref/cssEscape` 下沉到 `@workhub/contracts` 或新建极小的 `@workhub/html-escape`，两边都 import 它；`web-runtime/html.ts` 保留 re-export 保持向后兼容。**这是本条唯一的架构判断点，需先定依赖方向。**

### R-02 | `safeHref` 8 份 + 两个「规范实现」并存 | 收益 ~50 行 | 风险 低 | S | sonnet

`packages/web-runtime/src/html.ts:12` 与 `packages/ui/src/safe-href.ts:5` **本身就是两份规范实现**。另外 6 份复制：`apps/desktop-webview/src/pet-surface.ts:2523`、`packages/ui/src/gold-path/route-components.ts:1163`、`apps/desktop-webview/src/desktop-cuu-runtime.ts:2256`、`packages/ui/src/replay/render.ts:68`、`packages/ui/src/proposal/render.ts:118`、`packages/ui/src/route-state.ts:211`。与 R-01 同批做。

### R-03 | API 路由层四组 helper 复制 | 收益 ~210 行 | 风险 低 | M | sonnet

`apps/api/src/routes/` 下已有共用件（`uuid-param.ts`、`json-body.ts`、`http-error-codes.ts`），但这四个没收：

| helper | 份数 | 是否逐字相同 | 位置示例 |
|---|---|---|---|
| `requestLocale` | **10** | **逐字节相同**（体都是 `return normalizeWorkHubLocale(c.req.query("locale") ?? c.req.header("Accept-Language"));`，连类型注解都一样） | `sessions.ts:47`、`pages.ts:158`、`knowledge.ts:27`、`drive-versions.ts:28`、`escalations.ts:34`、`proposals.ts:367`、`meetings.ts:31`、`workitems.ts:64`、`agent-runs.ts:99`、`drive.ts:62` |
| `requireConversationId` | **10** | 结构相同、仅抛出的 Error 类与 code/文案不同 | `conversation-cuu.ts:28`、`conversation-message-feedback.ts:30`、`conversation-typing.ts:81`、`conversation-read.ts:28`、`conversation-rename.ts:29`、`conversation-turns.ts:27`、`conversation-participants.ts:34`、`conversations.ts:36`、`conversation-army.ts:27`、`conversation-message-actions.ts:31` |
| `requireProjectId` | 7 | 同上 | `project-planner.ts:36`、`projects.ts:31`、`github-bindings.ts:33`、`project-timeline.ts:49`、`conversations.ts:29`、`project-instructions.ts:26`、`ai-settings.ts:27` |
| `requireUuidParam` | 4 | 同上 | `drive-versions.ts:34`、`meetings.ts:55`、`agent-runs.ts:115`、`drive.ts:87` |

**做法**：`requestLocale` 直接抽到 `routes/request-locale.ts`（-54 行，零判断）。后三组抽成 `makeUuidGuard(ErrorCtor, code, message)` 工厂（每处调用点从 5–7 行降到 1 行，约 -140 行）。

**并发提示**：文案串「没有找到这个项目。」在 13 个不同源文件中出现、「没有找到这个会话。」13 个、「没有找到这个事项。」6 个、「没有找到这个变更申请。」5 个（精确 grep：Chinese 字面串跨文件去重后计数）。收 guard 的同时这些串自然归一，与 rejected note 的「源头单一词典」方向一致。

### R-04 | `parseCny` / `formatCny` 18 份 | 收益 ~90 行 | 风险 低 | S | sonnet

grep `^(export )?function (formatCny|parseCny)\(` = 18 处：`packages/cost/src/{reservation.ts:92/106, ledger.ts:364/369, decision.ts:388/393}`、`packages/agent/src/loop/loop.ts:66/71`、`packages/agent/src/loop2/config-builder.ts:89/94`、`packages/agent/src/loop2/adapters/result.ts:58/63`、`apps/api/src/services/{risk-monitor.ts:60, pilot-day1-metrics.ts:87/92}`、`apps/api/src/pages/{cost.ts:562/567, agent-army.ts:47}`。

**做法**：`@workhub/cost` 已是所有调用方的合法依赖方向，导出 `parseCny/formatCny` 即可。**风险点**：需逐份 diff 精度/舍入语义（`packages/cost` 三份自己就在同包内复制三遍，先在包内收口是零风险的第一步）。

### R-05 | QA 脚本 `chromeCandidates` + `findChrome` 11 份 | 收益 ~290 行 | 风险 低 | S | sonnet

**逐字节相同**（我 diff 了 `scripts/qa/r4-web-route-state-matrix.ts:201`、`apps/web/qa/r4-web-redis-sse-browser-smoke.ts:143`、`apps/web/qa/r4-web-live-route-interaction.ts:2447` 三份，完全一致，含 Windows/mac/Linux 路径顺序与 `.filter((candidate): candidate is string => ...)` 写法）。

11 处 `chromeCandidates`（各 13 行）+ 11 处 `findChrome`（各约 14 行）：`scripts/qa/{cuu-pet-run-card-overflow-qa.ts:87/101, r4-web-route-registry-loader.ts:213/227, r4-web-product-shell-baseline.ts:126/140, r4-web-multi-record-page-vm.ts:430/444, r4-web-route-state-matrix.ts:201/215, r1-route-visual-qa.ts:803/817}`、`apps/web/qa/{r4-web-locale-metrics-browser-smoke.ts:87/101, s1-day2-pilot-browser-dry-run.ts:105/119, r4-web-live-route-interaction.ts:2447/2461, r4-web-redis-sse-browser-smoke.ts:143/157, r4-web-live-api-pg-seed.ts:127/141}`。

**荒诞点**：`apps/web/src/chrome-launch.ts` 已经是共享模块（导出 `CdpClient:11`、`launchChrome:179`），而且 `apps/web/qa/r4-web-live-route-interaction.ts:15` **正在 import 它**——却还在同文件 2447 行自己写一份 `chromeCandidates`。把这两个 helper 挪进 `chrome-launch.ts` 一起导出即可，`scripts/qa/*` 侧需要一条 workspace 可达路径（`@workhub/audit` 或新建 `packages/qa-harness`）。

### R-06 | 桌面端三份 SSE 客户端 | 收益 ~150 行 + 重连语义统一 | 风险 中 | M | opus

三份并存：
1. `packages/web-runtime/src/live-runtime.ts`（323 行，原生 `EventSource`，带 errorStreak 放弃阈值 + `connectedCount` 重连对账）——**web 用**
2. `apps/desktop-webview/src/desktop-cuu-runtime.ts:1843` `DesktopCuuFetchEventSource`（约 1843–1990，含指数退避 1s→60s，`DESKTOP_CUU_FETCH_BASE_RECONNECT_MS`/`MAX` 常量）——**桌宠/主窗用**
3. `apps/desktop-webview/src/workbench/chat/stream.ts`（301 行，同样 fetch+ReadableStream + 退避重连 + 重连后按 seq 补缺口）——**工作台聊天用**

**代码自己写了理由**（`workbench/chat/stream.ts:1-5` 原文大意）：EventSource 加不了 `X-YQGL-Client-Token` 头；且 `DesktopCuuFetchEventSource` 不导出、也没有本模块要的「退避重连 + 按最高 seq 补缺口」语义，所以重写一份。

**评估**：理由成立但结论可改。真正共用的是「fetch+ReadableStream 的 SSE 帧解析 + 指数退避状态机 + open/error 事件语义」（约 120–150 行），差异只在「重连后做什么对账」——那本就该是回调。做法：把 2 的类导出并参数化 `onReconnected` 回调，3 改为使用它并只保留 `reconcileGap` 业务逻辑。**风险中**：这是断网自愈路径，`desktop-cuu-runtime.test.ts`（3061 行）与 chat 侧测试都压在上面，改动需要两侧测试同时绿。

### R-07 | 头像裁剪弹窗两端各写一份 DOM 编排 | 收益 ~200 行 | 风险 中 | M | sonnet

- `apps/web/src/avatar-crop-modal.ts`（319 行，`openAvatarCropModal`，class 前缀 `wh-avatar-crop-*`，见 :155）
- `apps/desktop-webview/src/spotlight/views/settings.ts:471` `openSpotlightAvatarCropModal`（到 :683，约 212 行，class 前缀 `wh-spot-avatar-crop-*`，见 :485）
- 纯几何已共用：`packages/ui/src/avatar/avatar-crop.ts`（128 行，`packages/ui/src/index.ts:1` 转出口）

`settings.ts:371` 的注释明说是「两端薄 DOM 层各写一份」的有意选择。**可改**：把 DOM 编排提到 `packages/ui`，class 前缀作为参数（`{ prefix: "wh-avatar-crop" | "wh-spot-avatar-crop" }`）。风险中——桌面端有 Tauri 环境差异，且 `spotlight/views/avatar-crop-modal.test.ts`（198 行）钉了 DOM 结构。

### R-08 | `granularLabel` / `granularEffective` 逐字复制 | 收益 ~20 行 | 风险 低 | S | sonnet

`apps/desktop-webview/src/spotlight/views/settings.ts:108`（`granularLabel`）与 `apps/desktop-webview/src/workbench/settings/render.ts:55`（`projectGranularLabel`）**函数体逐字相同**（同一张 `create_work_item/dispatch_run/mutate_drive/send_notification` → 建任务/派 run/动网盘/发通知 表）；`:120` vs `:66` 的 `granularEffective` 也是同一句 `!== false`。同一个 app 内部的两份，无依赖方向问题，直接抽到 `apps/desktop-webview/src/ai-granular-labels.ts`。

### R-09 | 客户端错误码→文案映射器 ~10 份 | 收益 ~60 行 + 一致性 | 风险 低 | M | sonnet

`packages/web-runtime/src/notice.ts:95` `actionMessage(error, locale)` 已是 web 侧规范。桌面侧另有 8 份各自小表：`spotlight/views/memory.ts:145/155/159`、`workbench/editor/view.ts:559`、`workbench/timeline/api.ts:98`、`workbench/kanban/api.ts:34`、`desktop-cuu-runtime.ts:2115`、`workbench/chat/render.ts:202`；web 侧还有 `apps/web/src/browser.ts:5531`、`apps/web/src/settings-devices.ts:91`。每份表内容不同（不是纯复制），可省行数有限，但**收敛成一个 `errorCopy(error, locale, table)` 工厂 + 各自只留表**是结构收益。

### R-10 | 四张 i18n 词典并存、CJK 串有实际交叉 | 收益 结构性 | 风险 中 | L | opus

- `packages/ui/src/i18n.ts`（572 行，`uiT`）
- `packages/ui/src/gold-path/i18n.ts`（652 行，`goldPathT`）
- `packages/ui/src/gold-path/route-components.ts:587–1150`（563 行的 `routeCopy`，`routeT`）
- `apps/api/src/pages/i18n.ts`（128 行，`pageT`）

我按「文件内所有含 CJK 的字符串字面量去重后取交集」量了：`ui/i18n.ts` ∩ `gold-path/i18n.ts` = **35 串**；`gold-path/i18n.ts` ∩ `route-components.routeCopy` = **16 串**（含「下载」「已采纳」「待处理」「需要你决定」「查看变更申请」「预算」等产品名词）；`ui/i18n.ts` ∩ `routeCopy` = **32 串**。
`ui/i18n.ts:21` 自己留了证据注释：「与 gold-path 词典的 intake.kicker（『新任务』）同名不同义——改名消歧」。

**做法**：不建议大合并（rejected note 已否决展示层洗词，且四张表服务不同层）。建议只做**术语层**：把「产品名词」（下载/已采纳/待处理/需要你决定/军团/变更申请…约 40–60 条）提到 `@workhub/contracts` 的术语表模块作单一事实源，四张表 import 它——这正是 rejected note 里写明的「采纳方向」。风险中：改动面广，需配合 `pnpm audit:copy-terms` 门禁。

---

## 三、超大文件与拆分缝

### 前 15 大源码文件（非测试；行数亲验）

| # | 文件 | 行数 |
|---|---|---|
| 1 | `apps/api/src/openapi.ts` | 10037 |
| 2 | `packages/ui/src/gold-path/route-components.ts` | 5919 |
| 3 | `apps/web/src/browser.ts` | 5658 |
| 4 | `apps/web/qa/r4-web-live-route-interaction.ts` | 5538（QA 脚本） |
| 5 | `apps/desktop-webview/src/workbench/chat/view.ts` | 3854 |
| 6 | `packages/db/src/repositories/proposals.ts` | 3184 |
| 7 | `apps/api/src/workers/agent-runner.ts` | 3138 |
| 8 | `apps/api/src/services/work-items.ts` | 2901 |
| 9 | `apps/api/src/qa/r1-pg-agent-run-smoke.ts` | 2874（QA 脚本） |
| 10 | `packages/db/src/repositories/conversations.ts` | 2830 |
| 11 | `packages/db/src/schema/core.ts` | 2560 |
| 12 | `apps/desktop-webview/src/pet-surface.ts` | 2529 |
| 13 | `client-tauri/src-tauri/src/main.rs` | 2500 |
| 14 | `apps/api/src/services/proposals.ts` | 2374 |
| 15 | `apps/desktop-webview/src/desktop-cuu-runtime.ts` | 2262 |

（含测试则 `apps/api/src/agent-runs.test.ts` 8082、`packages/ui/.../route-components.test.ts` 4555、`apps/api/src/proposals.test.ts` 4773、`apps/api/src/drive-pages.test.ts` 4528 挤进前十。）

### S-01 | `mountChatView` 单函数 3396 行 | 风险 中 | L | opus

`apps/desktop-webview/src/workbench/chat/view.ts:459` 起、到文件末 3854 行闭合（我核了 3845–3854 的收尾 `markProposalSettled` + `};` + `}`）。**这是全仓最大的单函数**。前 458 行是可测纯函数区（`addAttachment:267`、`createRenderScrollScheduler:299`、`movePickerHighlight:354`、`hydrateAvatarPhotos:438` 等已经是好实践）。

**自然拆分缝（闭包内已按职责聚簇，行号即边界）**：
| 段 | 行范围 | 内容 | 建议去处 |
|---|---|---|---|
| a | 707–1043 | 渲染骨架：`renderCtx/renderHead/renderBanner/renderCatchup` | `chat/render-head.ts` |
| b | 840–1015 | 成员管理：`viewerIsConversationOwner`…`enterLeftConversationTerminalState`（含 `openMemberManage/addMember/removeMember`） | `chat/members.ts` |
| c | 1104–1446 | 输入区与瞬态：typing/turnStatus/modeHint/aiProviderBanner/picker/composer/modePopover | `chat/composer.ts` |
| d | 1462–1793 | 数据加载与对账：`loadHistory/mergeMessages/loadPins/loadReceipts/loadPresence/loadParticipants/doMarkRead/loadOlderHistory/reconcileGap` | `chat/data.ts` |
| e | 1793–2026 | 行动卡：`refreshActionCardMessage`…`submitActionCardUndo` | `chat/action-cards.ts` |
| f | 2026–2400+ | 消息级交互：reaction/feedback/edit/delete/reply/pin/jump | `chat/message-actions.ts` |

拆法：每段抽成 `createXxx(deps)` 返回方法对象，`mountChatView` 退化成装配器（目标 ≤400 行）。**风险中**：闭包共享大量可变状态（`disposed`、`settledProposalIds`、渲染节流器），必须显式建 store 传入，否则会引入竞态。建议先做 e（行动卡，边界最干净、状态最少）。

### S-02 | `createInMemoryAgentRunQueue` 单函数 2049 行 | 风险 中高 | L | opus

`apps/api/src/workers/agent-runner.ts:522`–`2570`（我核了 2564–2572 的 `};` + `}` + `type QueueBudgetScope`）。内含 56+ 个嵌套函数。**内层 `executeRun` 自己就是 1613–2017 约 404 行**。

**拆分缝**（按已成型的聚簇）：
| 段 | 行范围 | 主题 |
|---|---|---|
| a | 662–714 | 工具可见性/副作用分级（`canUseDefaultToolForRole`、`rememberVisibleToolSideEffects`、`defaultToolRegistryFor`） |
| b | 768–930 | 默认 provider 装配（`defaultWorkdir/defaultClient/defaultReviewClient/defaultCompactionClient/defaultWorkerSystemPrompt/defaultInitialUserMessage`）——**几乎无闭包依赖，最容易先抽** |
| c | 931–1075 | 持久化写路径（`updateRun/persistCreatedRun/persistRun/persistRunWithTrace/queueTracePersistence`） |
| d | 1076–1272 | 租约/心跳/死信（`refreshClaim/auditRecoveredClaims/openDeadLetterEscalation/restoreDeadLetterRetrySurface/startClaimHeartbeat`） |
| e | 1337–1492 | 事件广播（`emitRunEvent/emitFinalRunEvent/emitRunStatusEvent/emitProposalOpenedEvent`） |
| f | 1493–1612 | 交付物落地（`postDeliverableSystemMessage/attemptAutoMerge/openProposalFromManifest`） |
| g | 1613–2017 | `executeRun` 主体 |
| h | 2572–2982 | 已在闭包外的预算映射区（`toQueueBudget*`/`toPublicBudget*`，约 410 行）——**已经是纯函数，可直接整段搬到 `workers/agent-run-budget.ts`，零风险** |

**先做 h 与 b**（纯函数、零闭包耦合），能立刻把文件砍掉约 600 行；c–g 需要显式 deps 对象，风险中高（`agent-runs.test.ts` 8082 行几乎全压在这上面）。

### S-03 | `openapi.ts` 10037 行 | 风险 低 | M | sonnet

结构（亲验）：
- 1–7237：schema 片段 + response builder 常量（`jsonRequestBody:1`、`pathUuidParameter:15`、`jsonOkResponse:103`、`jsonErrorStatusResponse:217`、`fileDownloadResponse:247`… 以及每域的 response 常量）
- 7238：`export function getOpenApiDocument()`
- 7245：`paths: {` 开始，到 10030 结束 = **约 2790 行 175 条路径**（`grep -c '"/api/'` = 175）

**拆分缝**：按 `tags`（system / drive / proposals / conversations / approvals / agent-runs / auth / pages / pilot …）拆成 `openapi/paths/*.ts`，每个导出一个 `Record<string, ...>`；`getOpenApiDocument()` 做 spread 合并。共享 builder 留在 `openapi/builders.ts`。**风险低**（纯数据对象），但 `apps/api/src/app.test.ts`/`route-auth-posture.test.ts` 会读它，需保证合并后深相等。

### S-04 | `route-components.ts` 5919 行 | 风险 低中 | M | sonnet

结构（亲验）：
- 1–140 imports/types
- **141–304** `export const webRouteComponentCss`（164 行 CSS 数组）→ `route-components.css.ts`
- **587–1150** `const routeCopy`（563 行双语词典）→ `route-copy.ts`
- 1152–1490 共享渲染 helper（`escapeHtml:1152`、`safeHref:1163`、`renderActions:1262`、各种 `xxxLabel`）→ `route-labels.ts`
- **1491–5845 = 24 个 `renderXxxRouteComponent`**，一路一函数，边界天然：home:1491 / intakeStart:1737 / intake:1831 / approvals:2065 / workItem:2679 / proposal:2931 / drive:3144 / meeting:3440 / notifications:3734 / health:3825 / calendar:3907 / agentArmy:4026 / teamSkills:4181 / memory:4350 / projects:4381 / projectHome:4476 / projectTimeline:4670 / cost:4803 / knowledge:5177 / conversation:5466 / search:5540 / settings:5719 / replay:5805
- 5846–5919 `renderWebRouteComponent` / `renderWebRouteComponents` 分发器

**做法**：先切 CSS + copy + labels 三块（-1290 行，零逻辑风险），再按路由切成 `routes/<name>.ts`。**注意**：`route-components.test.ts` 4555 行大量断言渲染出的 HTML 串，切文件本身不该动断言，但若顺手改结构就会大面积红——**拆分与重构必须分两个 PR**。

### S-05 | `apps/web/src/browser.ts` 5658 行，含 1400 行单函数 | 风险 中 | L | opus

- `bindGoldPathNavigation` = **631–2030（1400 行）**（核了 2028–2036 的收尾）——一个巨型委托事件处理器，内部按动作分支。拆法：按动作族（approval / proposal / drive / meeting / notification / taskPlan / escalation / memory）切成 handler 表，`bindGoldPathNavigation` 只做「取 href → 查表 → 派发」。`packages/web-runtime/src/action-payload.ts` 已经提供了 30 个 `xxxFromHref` 解析器（:28–:231），handler 表天然对齐它们。
- 2295–5206 是 **20+ 个 `bindXxxPanel`**，边界天然，可整批外迁到 `apps/web/src/panels/*.ts`：`bindAvatarTiles:2295`、`bindNotificationMutePanel:2319`、`bindHomeProjectsRetry:2438`、`bindProjectHomePlansPanel:2464`、`bindWorkItemAuditTimelinePanel:2558`、`bindProjectHomeInstructionsPanel:2606`、`bindMyConversationsPanel:2751`、`bindProjectHomeMembersPanel:2788`、`bindProjectHomeObjectivesPanel:2867`、`bindConversationParticipantsPanel:3045`、`bindSettingsBudgetPolicyPanel:3334`、`bindSettingsMembersPanel:3578`、`bindSettingsMembersRoster:3615`、`bindSettingsInvites:3813`、`bindSearchRoutePanel:4034`、`bindSettingsAiProfilePanel:4213`、`bindSettingsMyProfilePanel:4355`、`bindSettingsDevicesPanel:4521`、`bindSettingsAvatarPanel:4641`、`bindMemoryPanel:4773`、`bindProposalFeedbackNotePanel:4793`、`bindMemoryProfileItems:4885`、`bindMemorySkillItems:5029`
- 5284–5551 是 onboarding + invite-accept 两块独立屏，可整体外迁。

**先做 panel 外迁**（每个 panel 只依赖 `client/locale/signal`，几乎零共享状态），能把 browser.ts 砍到约 2700 行；再拆 `bindGoldPathNavigation`。

### S-06 | 四个 `createXxxRepository` 巨型闭包 | 风险 中 | L | opus

| 文件 | 工厂函数 | 行范围 | 单函数行数 |
|---|---|---|---|
| `packages/db/src/repositories/conversations.ts` | `createConversationRepository` | 1146–2830 | **1685** |
| `packages/db/src/repositories/proposals.ts` | `createProposalRepository` | 1632–3184 | **1553** |
| `packages/db/src/repositories/drive.ts` | `createDriveRepository` | 547–1765 | 1219 |
| `packages/db/src/repositories/work-items.ts` | `createWorkItemRepository` | 574–1713 | 1140 |

四个文件的前半段都已经是纯 helper（如 `conversations.ts` 的 `lockActiveProject:897`/`lockActiveMembershipSet:923`/`aggregateMessageReactions:1115`；`proposals.ts` 的 `mergeProposalCandidates:645`/`aiFusionResolvedChange:742`），后半段是一个把它们串起来的巨型对象字面量。**拆法**：按领域动词切成多个 `createXxxSlice(db)`，工厂做 `{...slice1, ...slice2}`。`packages/db` 的测试（16k 行）多走接口层而非内部函数，风险可控。

### S-07 | `packages/db/src/schema/core.ts` 2560 行 | 风险 低 | S | sonnet

单文件 drizzle schema。按域拆 `schema/{conversations,proposals,drive,work-items,agent-runs,...}.ts` + `schema/index.ts` re-export。**必须核对 `pnpm audit:migrations` 门禁**（`scripts/dev/check-migrations.ts`）是否按文件名解析 schema。

---

## 四、遗留双轨：`packages/agent` loop vs loop2

### 事实（全部亲验）

- **两条独立开关**（`packages/config/src/env.ts`）：
  - `CONVERSATION_TURN_LOOP2_MODE` 默认 **`"on"`**（:132）——**Cuu 对话轮次已经全量走 loop2**，legacy 是回退口。
  - `AGENT_RUN_LOOP2_MODE` 默认 **`"off"`**（:125）——**agent-run 仍走 legacy `loop.ts`**。
- 生产接线点：`apps/api/src/workers/agent-runner.ts:1853-1855`
  ```
  const result = loop2Mode === "off"
    ? …
    : await runAgentLoopDispatch(loopInput, loop2Mode, (i) => loop.run(i));
  ```
  与 `apps/api/src/services/conversation-turns.ts:1752/1760`。
- **loop2 不是替代品，是叠加层**。`packages/agent/src/loop2/config-builder.ts:53-64` 直接从 `../loop/loop.js` import `finalizeL3 / settleRunException / summarizeStepsForCompaction / tryGenerateStructuredSummary`，从 `../loop/control.js` import `checkLoopBudget / controlFromAssistant / createInitialUsage / DoomLoopDetector`，从 `../loop/handoff.js` import `buildStructuredHandoff`。config-builder 头部注释表里 L3 一行原文口径是「reuse `loop.ts` `finalizeL3`（single source）」。
- 所以**即使把 `AGENT_RUN_LOOP2_MODE` 翻成 on，`loop/loop.ts`（1542 行）也删不掉**——真正会变死的只有 `AgentLoop` 类 + `createAgentLoop`（`loop/loop.ts:1177–1542`，约 **365 行**）与其 `runBody` 私有链。`loop/control.ts`(162)、`loop/handoff.ts`(42)、`loop/types.ts`(175) 以及 `loop.ts` 的 1–1176 全部是共用资产。

### 翻转阻塞的真实规模

`env.ts:130-131` 的注释自述阻塞是「约 40 条 agent-run 单测断言 legacy 行为」。我实测：
- `apps/api/src/agent-runs.test.ts` 共 **112 个 `test(` 用例**、8082 行。
- 其中 grep `loop\.|AgentLoop|steps\[` = **37 处命中**——与「约 40 条」量级吻合，但**这是命中数不是用例数**，真正需要迁的用例数应更少。
- 该文件已有 **9 处 `loop2Mode` 注入点**（含 `agent-runs.test.ts:3523` 的 `for (const loop2Mode of ["off","on"])` 双跑模式）——**双跑范式已经建好了**，迁移不是从零开始。
- `apps/api/src/conversation-turns.test.ts` 有 **16 处 `loop2Mode`**，且 `:2793` 专门保留了一条 `loop2(off)` 的 legacy 分支测试——**这是对话侧翻 on 之后的正确留法（保留一条守回退口），agent-run 侧照抄即可**。

### L-01 | 建议路径 | 收益 长期少维护一条引擎 | 风险 中高 | L | opus

1. 先把 `AGENT_RUN_LOOP2_MODE` 在 CI 里跑一轮 `shadow-assert`（`config-builder.ts:883` 的 dispatch 已支持双跑 + `assertLoopCoreEquivalent`），确认零 diff。
2. 把 `agent-runs.test.ts` 里断言 legacy 内部结构的用例改成 `for (const loop2Mode of ["off","on"])` 双跑（照 :3523 的现成范式）。
3. schema 默认翻 `on`，保留 1–2 条 `off` 用例守回退口（照 `conversation-turns.test.ts:2793`）。
4. **只**删 `loop/loop.ts:1177–1542` 的 `AgentLoop` 类与仅它调用的私有函数；`loop/control.ts`、`loop/handoff.ts`、`loop/types.ts` 与 `loop.ts` 上半段一行不动。
5. 顺手把 `loop.ts` 上半段（共用资产）改名/移到 `packages/agent/src/loop-core/`，让「loop = legacy」的误导性名字消失——这是当前双轨最大的认知成本。

**不建议现在做**：翻转本身是行为变更，不属于"精简"，应单独排期。

---

## 五、测试

### T-00 | API 路由测试的鉴权脚手架 41 份复制 | 收益 约 1700 行 | 风险 低 | M | sonnet

**这是全仓最大的单笔可精简量。** 精确计数（我亲验，排除 .claude/reference）：

| 模式 | 命中文件数 |
|---|---|
| `function authDeps` | **41** |
| `class MemoryUsers` | **43** |
| `function settings(): Settings` | **40** |
| `generateSignedCookie(COOKIE_NAME` | **49** |
| `implements ClientDeviceRepository` | 42 |

**逐字对照实证**：`diff <(sed -n '1,180p' apps/api/src/routes/conversation-rename.test.ts) <(sed -n '1,182p' apps/api/src/routes/conversation-cuu.test.ts)` = **54 行差异（27 对）**，即 180 行前言中约 153 行完全相同；差异 100% 是常量改名（`COOKIE_SECRET: "r14fix-rename-route-secret"` → `"r15-cuu-toggle-route-secret"`、`cookieToken: "cookie-r14fix-owner"` → `"cookie-r15-cuu-owner"`）与被测工厂名（`createConversationRenameRoutes` → `createConversationCuuRoutes`）。

41 个 `authDeps` 文件的首个 `test()` 之前的前言合计 **10511 行（均值 256 行/文件）**，其中严格重复的脚手架（`MemoryUsers`/`MemoryDevices`/`settings`/`authDeps`/`user`/`cookie` 六个块）合计 **1943 行**。

**做法**：抽 `apps/api/src/test-support/auth-harness.ts`，导出 `createAuthedRouteApp({ cookieSecret, cookieToken, routes })`，每文件保留约 6 行配置。**风险低**——纯脚手架，零行为覆盖损失。**建议先做这条**：它同时是 S-02（agent-runner 拆分）与 S-03（openapi 拆分）的前置减摩擦项。

### T-01 | 路由守卫「四联测试」跨 10 个文件逐字重复 | 收益 约 770 行 | 风险 低 | M | sonnet

同一条通用规则在每个路由测试文件各写一遍。精确计数：
- `"requires authentication before reaching the service"` → 14 命中 / 10 文件
- `"without entering the service"`（非法 UUID → 404） → 10 命中 / 10 文件
- `"preserves the service's typed"` → 17 命中 / 8 文件
- `"422s before the service"` → 5 命中 / 5 文件

覆盖文件：`apps/api/src/routes/{workspace-members,conversation-rename,conversation-cuu,conversation-turns,conversation-typing,conversation-participants,conversation-army,dm,drive-versions,spotlight-intent}.test.ts` + `apps/api/src/{conversation-routes,action-card-routes}.test.ts`。这 46 个用例实测跨度合计 **921 行**（rename 119 / cuu 138 / participants 159 / turns 135 / dm 106 / drive-versions 44 / spotlight-intent 93 / workspace-members 86 / typing 41）。

**做法**：表驱动 `describeRouteGuards(appFactory, { unauthedPaths, uuidPaths, bodyPaths, typedErrors })`，约 150 行覆盖全部。**风险低**。

### T-02 | 两个死 barrel 的自证测试 2084 行 | 收益 2084 行 | 风险 低 | S | sonnet

`apps/web/src/main.test.ts`(823) + `apps/desktop-webview/src/main.test.ts`(1261)。它们唯一的被测对象是 D-01 里那两个零生产引用的 `main.ts`。断言形如 `assert.equal(webSurface.pages.includes("/api/pages/gold-path"), true)`（`main.test.ts:702`）——**在测一个死常量数组包含哪些字符串**，对产品零保护。随 D-01 一起删。

### T-03 | db 层租户围栏断言 142 处逐方法手写 | 收益 约 250–350 行 | 风险 低 | M | sonnet

`rg "queryReferences\([^,]+,\s*\w+\.workspaceId\)|queryParamValues\([^)]*\)\.includes\(workspaceId\)"` 在 `packages/db/**/*.test.ts` = **142 命中 / 21 文件**。分布：`task-plans.test.ts` 58、`confidence.test.ts` 23、`agent-memory.test.ts` 16、`objectives.test.ts` 14、`budget-reservations.test.ts` 9、`user-memory.test.ts` 6。逐字重复行示例：`assert.ok(queryParamValues(query?.where).includes(workspaceId));` 出现 14 次跨 8 文件；`assert.deepEqual(transactions, [{ outcome: "resolved" }]);` 出现 34 次。

**做法**：抽 `assertTenantFenced(query, table)` 断言助手 + 一张「哪些方法必须带围栏」的清单表。**这条要小心**：租户隔离是安全断言，合并时不能降低覆盖粒度——建议助手保留「每个方法名逐条报错」的能力。

### T-04 | 同一行为在 render 层与 view 层双测 | 收益 约 130 行 | 风险 低 | S | sonnet

`apps/desktop-webview/src/workbench/settings/render.test.ts`（545 行，纯 HTML 串断言）与 `.../view.test.ts`（1126 行，挂载 DOM 后测真行为）有 9 对同规则双测：GitHub 未绑定占位（render:181 ↔ view:424）、已绑定展示（:192 ↔ :439）、加载失败 retry（:175 ↔ :471）、PAT 永不回显（:276 ↔ :500）、owner-only 只读态（:128 ↔ :216）、risk monitor 只读（:319 ↔ :797）、instructions 只读（:409/:424 ↔ :1072）、forbidden 无 textarea（:438 ↔ :950）、错误态 scoped retry（:454 ↔ :1028）。view 侧测「发不发 PATCH」是真行为，render 侧只是重述同一段 HTML——**删 render 侧这 9 个**。

### T-05 | gold-path 渲染断言在 ui 内部 + apps/web 三处重复 | 收益 约 120 行 | 风险 低 | S | sonnet

逐字相同的断言行跨文件：`packages/ui/src/gold-path/render.test.ts:94` ↔ `route-components.test.ts:3330`（`<strong>Tool approval</strong>`）、`:91 ↔ :3316`、`:93 ↔ :3329`、`:97 ↔ :3273`、`:75 ↔ :3345`；`apps/web/src/routes.test.ts:2310-2312 ↔ route-components.test.ts:3714-3716`（notifications 三条 data-*）、`routes.test.ts:2314-2316 ↔ :3839-3841`（calendar 三条）。整块重复：「不泄漏 raw approval facts」`render.test.ts:80-99`(20 行) ↔ `route-components.test.ts:3303-3341`(39 行)；「page_info 截断」`render.test.ts:67-78` ↔ `:3343-3353`。差别只是入口从 `renderGoldPathSurface` 换成 `renderWebRouteComponents`。

### T-06 | drive 版本 / workspace roster 三层重测 | 收益 约 210 行 | 风险 低 | S | sonnet

drive 版本历史：同一规则在仓储层（`packages/db/src/drive-versions-repository.test.ts:106/121/131/198/244`）、服务层（`apps/api/src/drive-pages.test.ts:4258/4268/4342/4356`）、路由层（`apps/api/src/routes/drive-versions.test.ts:246/290/309/358/403/417`）各测一遍。
workspace roster 分页/403：契约层（`packages/contracts/src/workspace-roster.test.ts:12/17/21`）、仓储层（`packages/db/src/memberships-roster.test.ts:86/102`）、路由层（`apps/api/src/routes/workspace-members.test.ts:185/458/481`）、服务层（`apps/api/src/services/workspace-members.test.ts:264`）四层。

### T-07 | 脆性测试：0 个快照，但 1400+ 处等价的手写正则 | 收益 约 1200 行 + 重构摩擦归零 | 风险 中 | L | opus

**好消息**：`rg "toMatchSnapshot|toMatchInlineSnapshot"` 全仓 **0 命中**，没有快照债。
**坏消息**：等价脆性以手写正则形式散布。精确计数（`*.test.ts`，排除 .claude/reference）：

| 模式 | 命中 |
|---|---|
| `assert\.(match\|doesNotMatch)\([^,]*innerHTML` | **251**（`pet-surface.test.ts` 118 / `workbench/settings/view.test.ts` 51 / `spotlight/views/settings.test.ts` 45 / 其余 8 文件 37） |
| `[^>]*` 属性顺序胶水 | **117** |
| `assert.*` 行含 ≥8 连续中文字 | 341 |
| `includes("<` 精确标签串 | 44 |

**最脆的 10 处**（每条都锁死了「属性书写顺序」或「标签+class+文案」三重耦合，改渲染必红且报错指不到根因）：

1. **`apps/desktop-webview/src/pet-surface.test.ts:709`** —— 最脆。假 DOM 的 `querySelector` 自己用正则从 innerHTML 抠元素：
   ```
   new RegExp(`href="([^"]+)"[^>]*data-cuu-action-id="${actionId}"`, "u").exec(this.innerHTML)?.[1]
   ```
   要求渲染产物里 `href` 必须排在 `data-cuu-action-id` 之前；一旦交换属性顺序，假 DOM 静默返回 `null`，整个「Enter 发送」测试族以非行为原因红掉。该文件另有 118 处 `assert.match(root.innerHTML, ...)` 全部压在这套假 DOM 上。
2. `apps/desktop-webview/src/workbench/chat/render.test.ts:1995` —— `/class="wh-wb-mode-lvl wh-wb-mode-lvl--on wh-wb-mode-lvl--warn" data-wb-chat-mode-option="5"/`：锁死 class 内三个 token 的顺序 + class 与 data 属性的相对顺序。
3. `.../chat/render.test.ts:2246`、`:2252` —— class 顺序 + 属性顺序 + 字形 `✓`/`✗` 三重耦合。
4. `packages/ui/src/gold-path/route-components.test.ts:1360` —— `'data-action-id="create_task_plan" role="button" data-method="POST"'` 三属性精确顺序。
5. `packages/ui/src/gold-path/route-components.test.ts:2422-2425` —— `"<h3 role=\"heading\" aria-level=\"2\">会话</h3>"` ×4，标签名+属性顺序+中文文案四重耦合。
6. `apps/desktop-webview/src/workbench/settings/render.test.ts:419` —— `/<pre class="wh-wb-pset-instr-readonly" data-wb-instr-readonly="true">别用黑话<\/pre>/`。
7. `apps/web/src/routes.test.ts:1930-1934` —— `"<strong>5</strong><span>Active skills</span>"`：断言两个兄弟节点之间**没有空白**，加一个缩进即红。
8. `apps/desktop-webview/src/spotlight/views/settings.test.ts:237-239` —— `/data-set-ai-mode="4" data-sel="true"/` 等；`:425/:459/:466/:533/:573` 另把顺序耦合与中文文案绑一起。
9. `apps/desktop-webview/src/workbench/rail.test.ts:186/:210/:233` —— 先用正则手切 `<button ...>` 片段再匹配裸 ` sel`，还用了 `![0]` 非空断言，结构一变就是 `TypeError` 而非有意义的断言失败。
10. `apps/desktop-webview/src/workbench/settings/view.test.ts:260/:263/:270/:308/:613` —— `/data-on="false"[^>]*data-wb-pset-observer/` + 整句中文错误文案。

**做法**：去掉全部 117 处 `[^>]*` 胶水，改用 `data-*` 语义选择器 + 单属性断言助手（如 `assertAttr(root, '[data-wb-chat-mode-option="5"]', 'class', /--on/)`）。**风险中**：pet-surface 那套假 DOM 得先换成真 DOM 环境（或最小 DOM 实现），是独立工作量。**先做 2/3/6/7 这类纯字符串断言**，改断言写法不改被测代码，零行为风险。

### T-08 | 测试/源码比例失衡的观察 | 无直接可省行数 | — | — | —

`apps/api` 源 73k / 测 84k（1.15:1）、`apps/desktop-webview` 43k / 30k、`packages/db` 28k / 16k。api 侧倒挂主要来自四个巨型测试文件：`agent-runs.test.ts` 8082 + `proposals.test.ts` 4773 + `drive-pages.test.ts` 4528 + `app.test.ts` 3772 = **21155 行、占 api 测试 25%**。这四个文件是任何 api 重构的最大摩擦源，建议在做 S-02 之前先做一轮拆分（按被测端点分文件），否则重构必然撞上「改一行红一片」。

---

## 六、仓库根目录规划/资料区

### 现状（`du -sh` + `git ls-files | wc -l`，亲测）

| 目录 | 磁盘 | 入库文件数 | 代码引用 | 判定 |
|---|---|---|---|---|
| `reference/` | **2.3G** | **0** | — | 已被 `.gitignore` 第 2 行 `/reference/` 排除，且 `scripts/qa/r2-release-gate-report.ts:71-84` 有 `trackedReferencePaths()` 门禁守着「不得入库」。**纯本地，不动**。 |
| `docs/` | **231M** | 2105 | 门禁读 `docs/workhub/README.md` | 见 X-01 |
| `验收资料/` | **168M** | 131 | **0 处代码引用、0 处 docs 引用** | 可整体归档 |
| `r12-desktop-workbench/` | **142M** | 95 | 19 处 / 17 个源文件 | 141M 全在 `reports/`，见 X-02 |
| `r14-release-readiness/` | 376K | 13 | 10 处 / 8 个源文件 | 纯文本，留 |
| `r19-iteration-review/` | 192K | 4 | 0 处 | 可归档 |
| `r16-workbench-redesign/` | 136K | 4 | 0 处 | 可归档 |
| `reports/` | 100K | 3 | （见下） | 留 |
| `r9-agent-army/` | 72K | 7 | 0 处代码 / 3 个 docs md 引用 | 可归档（需同步改 3 处 md 链接） |
| `r13-workbench-refinement/` | 72K | 2 | 10 处 / 10 个源文件 | 纯文本，留 |
| `r15-proactive-upgrade/` | 52K | 6 | 3 处 / 3 个源文件 | 纯文本，留 |
| `data/` | **0B** | **0** | 0 | 只剩空目录 `data/snapshots/agent-runs/40000000-…00de`，本地运行残留，可直接删 |

**门禁事实**（`scripts/qa/r2-release-gate-report.ts` 亲读）：
- `docs.count` 门（:184）只做一件事：`countDocs()`（:54，walk `docs/workhub` 数 `.md`）必须等于 `docs/workhub/README.md` 里 `**N 篇文档已落盘**` 的 N，且 ≥60。当前 **N=186、实际 .md=186**，一致。
- **只有 `.md` 计数**——所以移动/删除 `docs/workhub` 下的**非 md 资产不影响这道门**。
- `requiredDocs`（:189-198）钉死 9 条 `docs/workhub/{02-ai-engine,06-roadmap}/*.md` 路径，不可移。
- `staleDocMatches()`（:104）扫 `docs/workhub` 全部 md 找过期措辞。
- 另有 `changedReferencePaths()`/`trackedReferencePaths()`（:71-84）守 `reference/` 不入库、`secretLikeDiffCount()`（:87）扫 `sk-` 密钥。
- `.github/workflows/verify.yml` 的 `web-live-route-smoke` job（upload-artifact 段）写死读 `docs/workhub/05-clients/assets/audit/2026-06-11-r4-web-live-route-interaction/{contact-sheet.png, live-route-interaction-report.json, smoke-summary.md}`——**这条 audit 子目录是 CI 产物路径，不能当纯静态资产处理**。`scripts/qa/cuu-pet-browser-capture.mjs:10` 同理写死 `docs/workhub/05-clients/assets/audit/2026-06-08-cuu-live2d-cat-runtime`。

### X-01 | `docs/workhub/05-clients/assets/audit` 195M / 1899 个入库文件 | 收益 磁盘 195M、`git clone` 大幅变快 | 风险 中 | M | sonnet

- `docs/workhub` 共 186 个 `.md` + **1907 个非 md**；其中 `05-clients/assets` 227M，`assets/audit` 单目录 **195M / 64 个子目录 / 1899 个入库文件**。
- 全仓入库文件总量 **579MB**，`.git` **1.5G**。前两大单文件：`r12-desktop-workbench/reports/R12-人工验收-20260713.zip`（**70MB**）、`.../F-02-titlebar-drag-20260713-1146.mov`（**67MB**）。
- **约束**：67 个 md 文件里有 **488 处** `assets/audit/...` 引用（`rg -o "assets/audit/[A-Za-z0-9._/-]+" docs/workhub --glob '*.md' | wc -l` = 488）。直接删会产生 488 条死图链。

**做法（按风险从低到高）**：
1. 只处理**未被任何 md 引用**的 audit 子目录（先算差集），移到 `docs/workhub/05-clients/assets/audit/` 之外的 `artifacts/`（新建 + gitignore）。零门禁影响、零死链。
2. 两个 CI 写死的 audit 子目录（`2026-06-11-r4-web-live-route-interaction`、`2026-06-08-cuu-live2d-cat-runtime`）**保留目录路径**，但把历史快照清掉、只留 CI 每次重写的那几个文件。
3. 若要根治 `.git` 的 1.5G，只能 `git filter-repo` 重写历史或迁 Git LFS——**这是需要用户拍板的破坏性操作，本报告只提出不建议自动执行**。

### X-02 | `r12-desktop-workbench/reports` 141M（zip 70M + mov 67M） | 收益 磁盘 137M | 风险 低 | S | sonnet

`r12-desktop-workbench` 95 个入库文件里，141M 集中在 `reports/`（一个 70MB 验收 zip + 一个 67MB 屏录 mov）。而对该目录的 19 处代码引用全部指向 `reports/*.md` 设计稿（如 `apps/desktop-webview/src/spotlight/views/memory.ts:7` 引 `r12-desktop-workbench/reports/r14-mem-server.md`、`packages/contracts/src/events.ts:175` 引 `batch-4a-turns.md`、`packages/db/src/conversation-runs-repository.test.ts:369` 引 `batch-5-server-read.md`）。**md 必须留在原路径**（否则 19 条注释指向失效），**zip/mov 可直接移出仓库**。零门禁影响。

### X-03 | `验收资料/`、`r16-`、`r19-` 可整体归档 | 收益 磁盘 168M+ | 风险 低 | S | sonnet

`验收资料/`（168M，131 入库文件，全在 `桌面归档-2026-08-11/`）**零代码引用、零 docs 引用**（我对 9 个根目录逐个跑了 `rg -c "<dir>/"`）。`r16-workbench-redesign/`(136K/4)、`r19-iteration-review/`(192K/4) 同样零引用。`r9-agent-army/`(72K/7) 零代码引用但有 3 个 docs md 引用，移动需同步改链接。

**做法**：新建 `archive/`（或按用户偏好放 `docs/archive/`）统一收纳；`验收资料` 的 168M 图片建议先移出仓库再入 archive 索引 md。**注意**：若移进 `docs/workhub/` 会破坏 `docs.count` 门（md 计数变化必须同 commit 改 README 的 186）——**归档目标必须选在 `docs/workhub/` 之外**。

### X-04 | `data/` 空目录残留 | 收益 0 行（整洁） | 风险 低 | S | sonnet

`data/snapshots/agent-runs/40000000-0000-4000-8000-0000000000de` 是空目录、0 字节、0 入库文件。删。

---

## 七、架构层：桌面端三个并行 surface

不属于「删几行」，但是本次侦察发现的最大结构性重复，记在此供拍板。

`apps/desktop-webview/vite.config.ts` 的 rollupOptions.input 有三个入口：`index.html`（→ `src/browser.ts`，Spotlight 玻璃盒）、`pet.html`（→ 同一个 `src/browser.ts`，桌宠）、`workbench.html`（→ `src/workbench/boot.ts`，工作台窗口）。

- `spotlight/` 非测试代码 **8156 行**，`views/` 下有 attention(752) / dashboards(1006) / drive(483) / intake(268) / memory(849) / proposals(530) / replay(224) / search(522) / settings(1229) / workitem(314)
- `workbench/` 非测试代码 **25441 行**，有 army / chat / drive / editor / files / inbox / kanban / proposal / schedule / settings / timeline

**重叠面**：proposals（spotlight 530 ↔ workbench 605）、drive（483 ↔ 728）、settings（1229 ↔ 1620）、attention↔inbox、dashboards↔army、workitem↔kanban。

**代码自陈的理由**（`workbench/proposal/render.ts:1-7` 大意）：工作台窗口只装 `appleGlassDesignSystemCss + workbenchCss`（`wh-wb-*`），没有 spotlight 的 `wh-spot-*` 样式，所以「绝不 import spotlight 的 detailHtml，而是用全新的 `wh-wb-prop-*` 类原生重写一份详情模板，复用的只有 ProposalDetailVM 数据形状 + `@workhub/ui/proposal` 的去黑话纯函数」。`workbench/boot.ts:1-5` 同样写明「故意不 import ./browser.ts」。

**评估**：CSS 隔离的理由成立，但「因为样式不同所以数据装配、状态机、动作编排也各写一份」不成立。这两层里 **VM→显示态映射 + 动作编排（approve/deny/merge 的 busy/理由器/错误分类）** 是同一套逻辑（`workbench/proposal/render.ts` 的 `ProposalActionNotice` / `ProposalDetailUiState` 与 `spotlight/views/proposals.ts` 的对应物概念一一对应）。建议方向：把「行为层」（状态机 + 动作 + 错误分类）抽到 `apps/desktop-webview/src/shared/<domain>/`，两边只各留模板函数。**不建议合并 CSS 或删掉任一 surface——那是产品决策，不是精简。**

---

## 八、优先级建议（按「收益/风险」排序）

**第一梯队（低风险、收益大，可并行发车）**
1. T-00 API 鉴权脚手架收口（-1700）
2. D-01+T-02 两个死 barrel（-2561）
3. T-01 路由守卫四联测试表驱动（-770）
4. X-01/X-02/X-03 仓库瘦身（磁盘 -500M 量级，代码 0 行）

**第二梯队（低风险、中收益）**
5. R-03 路由 helper 收口（-210）、R-05 QA chromeCandidates（-290）、R-01/R-02 escapeHtml/safeHref（-235，需先定依赖方向）
6. D-03/D-04 relations+locks 整文件（-362，需同步改 check-target-paths.ts）
7. S-02h + S-02b agent-runner 纯函数外迁（-600，零闭包耦合）
8. S-04 route-components 切 CSS/copy/labels 三块（-1290）
9. T-04/T-05/T-06 三层重测收敛（-460）

**第三梯队（需要设计判断，opus 级）**
10. S-01 mountChatView 3396 行拆分
11. S-05 browser.ts panel 外迁 + bindGoldPathNavigation 拆分
12. S-06 四个 repository 巨型闭包切片
13. R-06 桌面三份 SSE 客户端归一
14. T-07 脆性断言改造
15. 第七节的桌面三 surface 行为层下沉

**明确不做 / 需用户拍板**
- 删任何端点或 api-client 方法（已拍板保留）
- `AGENT_RUN_LOOP2_MODE` 翻转（行为变更，独立排期）
- `git filter-repo` / LFS 重写历史（破坏性）
- D-07 契约 122 个类型别名（收益太低）
- 删掉 spotlight 或 workbench 任一 surface（产品决策）
