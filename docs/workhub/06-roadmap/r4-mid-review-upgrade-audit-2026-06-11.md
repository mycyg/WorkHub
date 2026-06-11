---
module: R4-mid-review-upgrade-audit
layer: 全局 / C-WEB / C-DAEMON / C-PET / QA
status: active
owner: workflow
date: 2026-06-11
depends_on:
  - recovery-r0-r4-roadmap-2026-06-08.md
  - r4-18-react-route-migration-expansion-plan-2026-06-11.md
  - r4-19-proposal-advanced-split-migration-plan-2026-06-11.md
  - ../07-open-questions.md
---

# R4.18 竣工节点 · 项目中期审查与升级点清单（防大返工）

> **定位**：R4.18 竣工、R4.19 开工前的全项目中期 review。覆盖整体设计/概念一致性、Web 前端与 React 迁移策略、交互、数据流、后端引擎、多端共享、QA 与路线图。目标只有一个：**找出"现在不改、推完必返工"的结构性问题**，并给出插入 R4.19 之后施工顺序的具体建议。
> **方法**：逐文件读真实源码 + 对照规格树（README / 07-open-questions / R4.x plans），每条 finding 带 `文件:行号` 证据。severity：**P0 = 不现在改后面必返工/方向级**；**P1 = R4 收尾或 R5（生产化）前必须修**；**P2 = 登记在案的改进点**。

---

## 0. 一句话结论

地基（contracts/DB/事件/CI）质量很高，方向级风险集中在 **Web 前端运行时**：所谓 "React 迁移" 至今没有一行真 React，DOM-as-state + SSE 全量重渲的运行时模型与 React 目标互斥，fixture 仍是生产 chrome 的真相源。这三件事互相纠缠，**应在 R4.19 之前先用一个 spike 拍板**，否则 R4.19/R4.20 的 split migration 会在错误地基上继续加码。

---

## 1. 做得好、必须保持的设计（防误改）

| # | 保持项 | 证据 |
|---|---|---|
| S1 | **Contracts-first typed Page VM**：`packages/contracts` 17 篇领域合同 + 每路由 typed VM endpoint + loader 四态状态机（`idle/loading/ready/empty/error/forbidden`），是全仓最值钱的合同层 | `apps/web/src/routes.ts:30`、`packages/contracts/src/pages.ts` |
| S2 | **SSE topic fail-closed 授权**：`all` admin-only，资源 topic 逐一鉴权，默认拒绝 | `apps/api/src/sse/topic-access.ts:23-40` |
| S3 | **CI 三层门**：workspace verify + 真实 PG smoke + PG/Redis 双 worker smoke，docker-compose 一键起依赖 | `.github/workflows/verify.yml` |
| S4 | **单一委托分发器 + fail-closed payload**：Web 端动作全部走一个 delegated click dispatcher，payload 缺失即拦截（reason/field/intake option gate） | `apps/web/src/browser.ts:800-1022` |
| S5 | **DB schema 完整且超前**：47 张表已覆盖全部六业务模块 + 横切（audit/cost/confidence/snapshot/permission），软删除与审计字段成体系 | `packages/db/src/schema/core.ts:47-1193` |
| S6 | **文档纪律**：每个 R4.x 一篇 plan + 验收门 + 竣工回写，可追溯性极好 | `06-roadmap/r4-*.md` |
| S7 | **Agent loop 横切件已成形**：budget/doom-loop/handoff/provider registry/confidence 评估都有真实现 | `packages/agent/src/loop/control.ts`、`apps/api/src/services/agent-run-confidence.ts` |

---

## 2. P0 · 方向级，R4.19 前必须拍板

### P0-1 "React 迁移" 至今没有 React —— adapter 合同未经真实验证

**现状**：全仓库（所有 `package.json`）**零 React 依赖、零 React import**。R4.16–R4.18 交付的 "React-compatible route component" 实际是：props 工厂 + 指纹字符串 + 一组 `data-r4-react-component-*` marker 属性（`packages/ui/src/gold-path/route-react-components.ts:329-342`），由 HTML-string renderer 印到 DOM 上，再由 39 步 smoke 断言这些属性存在。真正的 React 挂载——`createRoot`、事件接管、受控状态、与现有 delegated dispatcher 的共存——**从未被运行过一次**。

**为什么是 P0**：R4.19/R4.20 计划继续按这套 adapter 合同扩 Proposal advanced。如果真 React 落地时发现合同不成立（极可能，见 P0-2：现有运行时把状态存在 DOM 里，与 React 的 state-driven 渲染互斥），则 route-react-components.ts、webReactRouteTree（`apps/web/src/routes.ts:160-219`）、以及所有断言 marker 的 QA gate 都要重写——这正是用户最担心的"推完大返工"。

**建议（R4.19 开工前插 spike，1 个迭代）**：
1. 真装 React 18，把已有 `HomeRouteComponent` props 用 `createRoot` 挂载进 R4.16 hydration boundary；
2. 验证三件事：props 从 typed VM 注入是否够用；React 子树内的点击如何回到 delegated dispatcher（或反过来 dispatcher 让位）；SSE 刷新时 React 子树如何接收新 props 而不是被 `innerHTML` 整体抹掉；
3. 用 spike 结论修订 adapter 合同，再开 R4.19。
**若 spike 证明合同成立**，R4.18 的全部脚手架原样保值；**若不成立**，现在改 4 个路由的成本远小于 R4.20 后改 9 个路由 + Proposal advanced。

**回写状态（2026-06-11 R4.19-pre）**：已完成 [`r4-19-pre-true-react-mount-spike-plan-2026-06-11.md`](./r4-19-pre-true-react-mount-spike-plan-2026-06-11.md)。结论是最小合同成立：Home route 已用 React 18 `createRoot()` 在 hydration boundary 内真挂载 hidden probe；probe click 已进入现有 delegated dispatcher；Home SSE 事件已走 `react-props` 更新而不整页重渲。限制是可见 UI 仍是 HTML fallback，Proposal editors 的编辑态风险仍由 R4.19 dirty guard 和 R4.20 数据流地基继续处理。

### P0-2 SSE 全量重渲会摧毁用户编辑中状态（数据丢失级）

**现状**：任何订阅流上的任何事件 → 220ms debounce → `renderCurrentRoute()` → 全页 `root.innerHTML = result.html`（`apps/web/src/browser.ts:1054-1074`、`1132-1148`）。而用户的编辑状态全部存在 DOM data 属性里：line editor 的逐 hunk 点选（`browser.ts:667-686`）、intake 多选（`browser.ts:535-563`）、structured field 自定义输入框（`browser.ts:485-493`）。

**后果**：用户在 Proposal 冲突工作台点了一半 hunk 决策、或正在 textarea 里打字时，同 work item 上任何 agent run 心跳/状态事件都会**整页重渲、清空所有未提交的选择和输入**。Proposal 路由同时订阅 proposal + workitem 两条流（`browser.ts:141-149`），这恰是事件最密的页面。R4.19 计划把 mutation editors 留在 HTML fallback——意味着该缺陷在 R4.19 之后依然存在并被固化。

**建议**：R4.19 范围内即加 **dirty guard**：route 内存在"未提交编辑"（有选中 hunk / 非空 custom input / intake 已选项）时，SSE 刷新降级为 notice 提示 + 手动刷新按钮，不自动重渲；并把它做成 browser smoke 的新 gate（模拟编辑中收事件，断言选择不丢）。长期解法随 P0-1 的 React 化把编辑状态从 DOM 移入组件 state。

**回写状态（2026-06-11 R4.19）**：已完成 dirty guard。Proposal line decision、line search、custom field 与 intake option 会把 active route 标记为 dirty；收到 `proposal.merged` SSE 时 refresh mode 为 `dirty-deferred`，显示 `sse_dirty_guard` notice，保留 `keep_current`、`scope` 与 `R4.19 guarded custom title` 三个未提交 DOM 编辑态。本修复是止血，R4.20 仍需把它纳入 app 级 SSE runtime。

### P0-3 生产 chrome 的真相源仍是 P0.5 fixture + 正则文案替换

**现状**：每次路由加载都先请求 `/api/pages/gold-path`，该端点的实现是 `createP05GoldPathFixture()`（demo fixture）+ `productCopy()` 正则替换（`周报→复盘包`、`weekly→regional`）+ 一张手工维护的中→英翻译 `Map`（`apps/api/src/pages/gold-path.ts:11-30` 及 `generatedEnglishCopy`；接线见 `apps/api/src/routes/pages.ts:136-141`）。routes.ts 再把真实 page VM 叠加覆盖当前路由的 VM（`apps/web/src/routes.ts:460-528`）。

**为什么是 P0**：
- 导航 shell、route map、非当前页 VM 的真相源是 demo fixture——"R4.3 已 gate 无 weekly fixture 文案"靠的是正则替换而非真数据，**fixture 一改文案，正则和翻译 Map 就 silently 漏**；
- 每次导航/每次 SSE 刷新都多一次 fixture 请求（双请求模式，见 P1-3）；
- 与 i18n locale 合同（`05-clients/i18n-locale-contract-p1-1.md`）方向冲突：系统文案应走 locale 合同，不应走"fixture 中文 → 硬编码英文 Map"。

**建议**：把 shell/nav/routes 从 fixture 剥离为真实 chrome 来源（前端常量或轻量 `/api/pages/shell` 端点），page VM 全部按路由直取；fixture 退回测试与 P0.5 回归专用。可与 R4.20 合并施工，但**退役计划现在就要写进 R4.19/R4.20 plan**，避免新 gate 继续往 fixture 上挂。

**回写状态（2026-06-11 R4.19）**：R4.19 未退役 fixture chrome，但已新增冻结门 `r4_19_no_new_fixture_chrome=true`，锁定本轮 browser smoke 中 `goldPath=18`、`proposal=2`、`proposalConflicts=2`，避免继续扩大 `/api/pages/gold-path` 依赖。退役计划已独立写入 [`r4-20-dataflow-foundation-plan-2026-06-11.md`](./r4-20-dataflow-foundation-plan-2026-06-11.md)。

**回写状态（2026-06-11 R4.20）**：已完成 fixture chrome 退役第一段。`apps/web/src/routes.ts` ready route 不再调用 `/api/pages/gold-path`，生产 Web route 由 active typed Page VM + product shell locale copy + route registry source 组装；R4.20 browser smoke 证明 `goldPath=0`、`r4_20_shell_chrome_no_gold_path_fixture_dependency=true`、无 weekly fixture 文案。

### P0-4 SSE 连接随每次渲染整建整拆 + 事件触发全量 refetch

**现状**：`bindReadyRoute` 在**每次**路由渲染后重建所有 EventSource（1–3 条），上一轮全部 abort 关闭（`apps/web/src/browser.ts:1119-1130`、`1087`）；每个事件的处理是整页双请求 refetch（gold-path template + page VM）再 `innerHTML` 重渲。即：**收到一个事件 → 拆掉所有连接 → 重连 → 很快又收到事件**，连接抖动随事件频率放大，断连窗口内的事件直接丢失（无 last-event-id 续传）。

**为什么是 P0**：这是数据流的地基模式，R2 辛苦做的 Redis broker/topic 边界在客户端被"全量重渲"模式抵消；活跃 run 场景（agent 心跳/步进事件密集）下服务端 SSE 握手压力与客户端闪烁都会随用户数线性恶化。推完再改 = 改掉整个前端刷新模型。

**建议**：与 P0-1 spike 同窗拍板目标模型——**app 级长连接**（boot 建一次，按路由订/退 topic），事件只触发**当前路由 page VM 的局部 refetch**（shell 不动），并补 `Last-Event-ID` 续传语义（服务端 `apps/api/src/sse/stream.ts` 一并收口）。

**回写状态（2026-06-11 R4.20）**：已完成 app-level SSE 第一段。`apps/web/src/browser.ts` 维护 EventSource map 并按 URL 复用，route switch 只同步 target set；Proposal stream 在 42 步 smoke 中只打开 1 次，clean SSE refresh mode 为 `page-vm-render`，dirty route 仍为 `dirty-deferred`，Home 仍为 `react-props`。`packages/events/src/sse.ts` 支持 `id:`，`apps/api/src/sse/stream.ts` 读取 `Last-Event-ID` / `last_event_id` 并回显 `resume_mode`。当前语义是 cursor + REST reconcile，不承诺 broker 历史 replay。

---

## 3. P1 · R4 收尾 / R5（生产化）前必须修

### P1-1 Web 与 Desktop 分发器已分叉（双端共享名存实亡的开始）

`apps/desktop-webview/src/browser.ts` 是 web `browser.ts` 的旧拷贝：约 20 个同名函数（escapeHtml / proposalActionFromHref / conflictsFromMergeError / line editor 全套 / bindGoldPathNavigation）重复实现，且停在 R4.11 前的形态——没有 AbortController 清理、没有 intake/evidence/restore/desktop-gate/SSE-notice 等 R4.12–R4.15 演进（对比 `apps/desktop-webview/src/browser.ts:150-360` 与 `apps/web/src/browser.ts`）。桌面端同样消费 `@workhub/ui` 渲染器（`apps/desktop-webview/src/main.ts:5-10`），React 化只在 Web 推进的话，两端会变成两套 UI 栈。

**建议（R4.21 候选）**：把 dispatcher + notice + 编辑器交互抽成共享 runtime 包（如 `packages/web-runtime`），Web/Desktop 注入差异（device token、pet bridge、locale 来源）；React spike 结论同步评估桌面 webview 是否同走 React。**返工面**：拖到桌面端下一轮功能（R5 双向同步 UI）再做，要同时迁两套已分叉的代码。

**回写状态（2026-06-11 R4.21）**：已完成 [`r4-21-shared-web-runtime-plan-2026-06-11.md`](./r4-21-shared-web-runtime-plan-2026-06-11.md)。新增 `packages/web-runtime`，Web 与 desktop-webview 已共享 locale、structured notice、action payload materializer、dirty marker、route line editor binding 与可注入 live runtime；desktop-webview 旧 proposal parser、merge conflict extractor、line editor payload updater 不再作为本地主真相源。限制是 desktop-webview 仍未完整接入 Web app-level Page VM route loader，后续 R4/R5 主窗产品化继续处理。

**回写状态（2026-06-11 R4.22）**：已完成 [`r4-22-proposal-mutation-editor-migration-plan-2026-06-11.md`](./r4-22-proposal-mutation-editor-migration-plan-2026-06-11.md)。Proposal structured field scalar editor 已成为第一段真实可见 React mutation editor；`ProposalMutationEditor` 在 Proposal advanced host 下用 `createRoot()` 挂载，textarea controlled state 在 dirty SSE 后不丢，accept/keep/custom 仍走 delegated dispatcher 与 shared payload materializer，HTML fallback preserved/hidden boundary 可审计。限制是 line editor hunk decision/search/scope 仍未迁，进入 R4.23。

**回写状态（2026-06-11 R4.23）**：已完成 [`r4-23-proposal-line-editor-react-migration-plan-2026-06-11.md`](./r4-23-proposal-line-editor-react-migration-plan-2026-06-11.md)。Proposal line editor 的 text hunk decision/search/current file panel 已成为第二段真实可见 React mutation island；`ProposalLineEditor` 在 Proposal advanced host 下用 `createRoot()` 挂载，dirty SSE 后 hunk decision 与 search query 不丢，apply payload 仍是既有 `text_hunk_overrides.hunks[]`，HTML fallback preserved/hidden boundary 可审计。R4.24 转入 Web runtime finalization，不继续扩大 editor 迁移面。

### P1-2 业务面断档：六模块只有约一半有 API/页面

DB schema 已建 drive/meeting/schedule 全套表（`packages/db/src/schema/core.ts:317-483`），但 `apps/api/src/routes/` **没有** drive/meeting/schedule/dashboard(经营面) 路由；Web 9 条路由覆盖 WorkItem/Proposal/Approval/Cost/Replay/Knowledge/Settings，**没有**项目网盘、会议洞察、任务提醒中心页。规格树里 M-DRIVE/M-MEETING 标 ✅ 的是"规格"，不是实现。

**建议**：R4 收尾时显式拍板"R5 第一条业务纵切是哪个模块"（建议 M-DRIVE：它是 OQ-4 合并语义的现实雏形载体，且 Python 锚点最厚），把断档写进 roadmap，避免"R4 推完 = 产品可用"的预期落空。

**回写状态（2026-06-11 R4.24）**：已新增 [`r5-01-drive-business-slice-decision-2026-06-11.md`](./r5-01-drive-business-slice-decision-2026-06-11.md)，R5 第一条业务纵切拍板为 M-DRIVE。理由是 Drive 已承接 accepted deliverables、`ProjectDriveItem/Version`、download/text preview、restore 与 OQ-4 文档合并语义；Meeting/Schedule 仍登记为后续业务断档。

### P1-3 每路由双请求模式

每次 `loadRouteSurface` 都 `await loadGoldPathTemplate()` + page VM 两次串行请求（`apps/web/src/routes.ts:469/477/484/491/504/508/514/521/525`）。随 P0-3 fixture 退役一并消掉；若 shell 改为前端常量，导航只剩一次 VM 请求。

### P1-4 权限横切未中间件化，写路径策略接线不完整

资源读权限是各路由手写 `assertCanReadWorkItem`（`apps/api/src/routes/proposals.ts:310/483`）；`@workhub/permissions` 的 allow/deny/ask 策略引擎只接在 approvals 服务（`apps/api/src/services/approvals.ts:31`）。merge/review/restore 等写路径是否全部过了"分层 permission + 风险门"需要一次系统对账。

**建议（R5 前）**：做一次"权限矩阵 × 路由"审计表（对照 `01-architecture/security-and-permissions.md §4.2` 角色矩阵），把资源检查收成 Hono 中间件/服务层统一入口；fail-closed 缺省。

### P1-5 浏览器回归全靠本机 Chrome 人肉/脚本 smoke，不在 CI

39 步交互 smoke 是 2591 行脚本驱动**本机 Chrome 真实二进制**（`apps/web/qa/r4-web-live-route-interaction.ts:1042` chromeCandidates），CI（verify.yml）只有 unit/PG/Redis。每个 R4.x 线性加步数：11→13→22→29→36→38→39。**这个曲线撑不到 R5**：步数越多越脆，且 main 上没有任何浏览器级回归门。

**建议（R4.20 起分两步）**：① 把现有 smoke 按路由拆成 headless Playwright spec 进 CI（Linux Chrome 已被 R4.7-R4.9 远端 smoke 验证可行）；② 本机 contact-sheet 截图门保留，但降频为"里程碑发布门"而非每步必跑。

**回写状态（2026-06-11 R4.24）**：R4.24 已在 [`r4-24-web-runtime-finalization-plan-2026-06-11.md`](./r4-24-web-runtime-finalization-plan-2026-06-11.md) 登记五组拆分目标：`nav-locale`、`intake-knowledge`、`proposal-actions`、`settings-cost-replay`、`route-states`。单体 42 步 smoke 暂保留 contact sheet 与 R4.24 gates；CI 化实现仍是 R5 前置项。

### P1-6 身份是 demo 残留：自动注册 "P0.5 Reviewer"

Web boot 遇到 `not_identified` 自动 `client.identify({ nickname: "P0.5 Reviewer" })`（`apps/web/src/browser.ts:1176`）。LAN-first 可接受，但它绕过了 onboarding/画像（PJ-1）且写死英文昵称。R5 前需要最小 identify/onboarding 闭环（昵称 + locale + 角色），并把 demo 自动注册移除。

### P1-7 locale 切换 = 全页 reload

`bindLocaleSwitch` 成功后 `window.location.reload()`（`apps/web/src/browser.ts:179-187`）。配合 P0-4 的连接重建，切语言的成本是全站冷启。React 化后应是 state 切换；短期可接受，但不要再往 reload 语义上挂新 gate。

---

## 4. P2 · 登记在案

| # | 问题 | 证据 | 处置 |
|---|---|---|---|
| P2-1 | hash route 兼容是死代码与口径漂移：R4 验收说"无 hash route"，但 normalize 仍解析 `#/`，`setActivePage` 仍写 `window.history.replaceState(..., '#${route}')` | `apps/web/src/routes.ts:240-246`、`apps/web/src/browser.ts:393-397` | **R4.24 已处理**：生产导航不再写 hash，hash 不再作为 route truth，legacy `#/` 只在 canonicalization 转 path；新增 `r4_24_no_hash_write` gate |
| P2-2 | 手写 HTML 字符串的 XSS 面：依赖每处手工 `escapeHtml`（三处重复实现），server 文本经 `insertAdjacentHTML` 入 DOM | `apps/web/src/browser.ts:378`、`routes.ts:230`、`desktop-webview/src/browser.ts:129` | React 化天然消除；迁移前不再新增裸 innerHTML 注入点 |
| P2-3 | 渲染层双轨并存：`packages/ui/src/replay/render.ts`、`agent-run`、`intake` 等旧 renderer 与 route-components 并行，桌面端还在直接用 | `apps/desktop-webview/src/main.ts:5-10` | 随 P1-1 共享 runtime 一并收敛 |
| P2-4 | 可观测性空白：无错误上报/结构化日志聚合/前端异常采集，生产化前补 | （全仓无相关依赖） | R5 前置项 |
| P2-5 | README 状态行已成 4000+ 字单行，可读性塌陷 | `docs/workhub/README.md:6` | **R4.24 已处理**：根 README 与 docs README 均改成短状态 + 最近里程碑表，规格树计数更新到 117 |
| P2-6 | 未提交的 R4.18 变更挂在工作区（16 个文件 + 2 个新目录） | `git status` | 已于 R4.19-pre 开工前提交 R4.18；R4.19 完成后继续一步一 commit |

---

## 5. 插入施工顺序的建议（R4.19 之后怎么排）

```
R4.19-pre (spike, 新增, ~1 迭代)   真 React mount proof：Home route 真挂载 + dispatcher 共存 + SSE props 更新
                                   ↳ 产出：修订版 adapter 合同，写回 r4-19 plan §3
R4.19   (已完成)                    Proposal readonly split migration
                                   + gate: 编辑中 SSE 刷新不丢状态 (P0-2 dirty guard)
                                   + gate: 不新增 fixture-chrome 依赖 (P0-3 冻结线)
R4.20   (已完成)                    数据流地基：app 级 SSE 长连接 + page VM 局部 refetch + Last-Event-ID
                                   + fixture chrome 退役 (P0-3/P1-3 一并消)
R4.21   (已完成)                    共享 web runtime 包：dispatcher/notice/编辑器抽包，Desktop 对齐 (P1-1)
R4.22   (已完成)                    Proposal structured field scalar editor 第一段真 React 迁移
R4.23   (已完成)                    Proposal line editor hunk decision/search/current file panel React 迁移
R4.24   (已完成)                    R4 收尾门：P2-1 hash 清理、P2-5 README 治理、P1-5 smoke CI 拆分计划、业务纵切优先级拍板 (P1-2)
R5.1    (下一步)                    M-DRIVE business slice：Drive Page VM、version history、preview/download/restore、OQ-4 DOC 指针语义
R5 前置清单                        权限矩阵审计 (P1-4)、Playwright CI 化 (P1-5)、onboarding (P1-6)、可观测性 (P2-4)
```

**判断依据**：P0-1/P0-2/P0-4 三件事共享同一个技术决策（前端运行时模型），分开修会互相返工，所以 spike 先行、R4.20 集中动数据流地基；P0-3 是它们的数据源前提。Proposal mutation editors 的真迁移（原 R4.20 候选）**必须排在 spike 与 dirty guard 之后**，否则是在已知会重写的模式上加最复杂的页面。

---

## 6. 与现有开放问题的衔接

- P0-4 的 `Last-Event-ID` 续传与 [`07-open-questions.md`](../07-open-questions.md) **SY-1**（单调序列 cursor）同源，建议一并收口；
- P1-4 权限审计对应 **RA-2/RA-4** 的角色与白名单拍板，审计表可顺带产出拍板材料；
- P1-2 业务纵切若选 M-DRIVE，直接推进 **OQ-4**（合并语义 DOC 二进制指针路径）；
- P1-6 onboarding 与 **PJ-1**（单条渐进式 onboarding）合并设计。

---

*本篇为 R4 中期权威升级清单。R4.19-pre 至 R4.24 gate 已逐条回写；任何一条升级为施工项时按惯例另立 r4-xx / r5-xx plan。*
