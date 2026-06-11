---
module: 05-clients
layer: C-WEB
status: 🚧
owner: workflow
---

# 客户端：Web 应用（页面规划）

> **范围**：`C-WEB`（React + Vite + TS 浏览器 SPA）的**信息架构 + 路由/页面清单 + 每页布局/组件/数据绑定/SSE 订阅/四态 + 导航流 + 响应式 + web↔桌宠差异**。本篇深度=**页面设计规划级**（逐页 wireframe + 绑定表）。
> **定位**：本篇只管「Web 端长什么样、订什么流、绑哪个接口」。**接口形状**（路由组/事件清单/鉴权依赖）见 [`../01-architecture/api-contract.md`](../01-architecture/api-contract.md)；**实体字段/状态机**见 [`../01-architecture/data-model.md`](../01-architecture/data-model.md)；**进程边界/事件总线拓扑**见 [`../01-architecture/system-architecture.md`](../01-architecture/system-architecture.md)；**桌宠端**见 [`./desktop-pet-tauri.md`](./desktop-pet-tauri.md)；**共享组件/tokens/API client**见 [`./shared-ui-kit.md`](./shared-ui-kit.md)；**体验 payload / Cuu 状态 / 交付物变更包契约**见 [`_experience-deliverable-contracts.md`](../../plans/p0-foundation/_experience-deliverable-contracts.md)；**用户用语/去黑话**以 [`../00-overview/glossary-dejargon.md`](../00-overview/glossary-dejargon.md) 为权威。交叉处只引用、不复述。
> **扎根口径（2026-06-06 修正）**：`web/src/App.tsx`、`web/src/pages/*`、`shared/src/*` 等路径属于旧项目行为参照。当前 WorkHub 主仓真实 Web 代码在 `apps/web`，共享 API client 在 `packages/api-client`，共享 render helpers 在 `packages/ui`，共享契约在 `packages/contracts`。后续施工必须把旧路径写成 `Behavior source`，把当前要落的文件写成 `Target TS paths`，不得把旧项目页面误判为已在 WorkHub 主仓复现。
> **概念图**：页面视觉方向与探索图见 [`page-concepts.md`](./page-concepts.md)。

---

## 当前 WorkHub 实现快照（2026-06-06）

![Web real UI gap roadmap](./assets/web/web-real-ui-gap-roadmap.png)

当前 Web 已有 P0.5 纵切地基，但还不是完整真实 SPA：

| 当前已落 | 真实路径 | 说明 |
|---|---|---|
| Gold Path shell | `apps/web/src/browser.ts` | 读取 `/api/pages/gold-path`，渲染共享 shell，绑定基础导航和 proposal action |
| Web typed surface | `apps/web/src/main.ts` | 暴露 `loadWebGoldPathSurface`、`renderWebIntakeSession`、`renderWebWorkItemDetail`、`renderWebProposalDetail`、`renderWebAgentRunLive` 等 helpers |
| Shared render helpers | `packages/ui/src/*` | Gold Path、intake、workitem、proposal、agent-run 的 HTML render helpers |
| Bilingual locale contract | `packages/contracts/src/locale.ts`、`packages/ui/src/gold-path/i18n.ts`、`apps/web/src/browser.ts` | 已支持 `zh-CN` / `en-US` normalize、`workhub.locale` 持久化、Gold Path 静态 chrome 与运行时提示本地化 |
| R4 route-state foundation | `packages/ui/src/route-state.ts`、`scripts/qa/r4-web-route-state-matrix.ts` | 已覆盖 home/intake/approvals/workitem/proposal/replay/cost/settings 的中英 loading/empty/error/forbidden 状态卡、desktop/mobile Chrome 截图与无横向溢出 gate |
| R4 route registry + loader | `apps/web/src/routes.ts`、`apps/web/src/browser.ts`、`scripts/qa/r4-web-route-registry-loader.ts` | 已把 URL route registry、`idle/loading/ready/empty/error/forbidden` 状态机、真实 path 导航和前三个 Page VM endpoint 接入浏览器 boot |
| R4 product shell baseline | `packages/ui/src/gold-path/product-shell.ts`、`apps/web/src/routes.ts`、`scripts/qa/r4-web-product-shell-baseline.ts` | Web ready route 已切到产品壳 baseline，覆盖 Home / Approvals / WorkItem / Proposal 的 desktop/mobile 截图、双语固定 chrome、path nav、无 Cuu/无 Kanban、无横向与文本盒溢出 |
| R4 live route interaction | `apps/web/src/browser.ts`、`apps/web/qa/r4-web-live-route-interaction.ts` | 已用 Vite dev server + mock API + Chrome CDP 跑 path nav、back/forward、locale reload、ready/empty/forbidden/error、mobile scroll，并 gate 重复 listener、文本越框和导航遮挡 |
| R4 Rust system-string i18n | `client-tauri/src-tauri/src/locale.rs`、`tray.rs`、`notify.rs`、`deep_link.rs`、`single_instance.rs`、`scripts/qa/r4-rust-system-i18n.ts` | R4.6 已把 Rust shell 固定系统串纳入 `zh-CN/en-US` contract：tray/menu/tooltip、notification fallback、deep-link/single-instance diagnostics 双语，动态 payload/raw URL/ID 原文保留 |
| API client | `packages/api-client/src/*` | Web / desktop-webview 共用 typed client；Page VM 请求可带 `PageRequestOptions.locale` |
| Contracts | `packages/contracts/src/*` | Page VM、event、Cuu card、proposal、cost、replay、locale 同源 |

当前缺口：

- 真实 route registry 与 loader 已落到 `apps/web/src/routes.ts`，ready route 已换成 R4.4 产品壳 baseline，但还不是完整 React component route tree。
- 现有产品壳已脱离 P0.5 preview 外观；后续仍需把 shared HTML render helpers 迁到真实 Web component route tree。
- `AI-first Home`、`Option Intake`、`WorkItem Detail`、`Proposal Detail`、`Approval Center`、`Replay Work`、`Cost Dashboard`、`Knowledge fallback` 仍需要真实页面组件和四态。
- Cuu 不应进入 Web 主界面；主力 Cuu 归独立桌宠窗口，Web 只展示严肃页面、审批、证据、成本和 trace。
- Page VM 请求已带 `locale` 并回显 `meta.locale`，但动态任务标题、摘要、证据、proposal manifest 仍由 daemon 原文决定；后续要让服务端按 locale 生成可本地化摘要，而不是在客户端临时硬翻译。
- R4.1 已形成第一版 route-state matrix 门禁；R4.2 已把状态接入真实 route loader，并让 `/`、`/approvals`、`/dashboard/cost` 先读 typed Page VM endpoint；R4.3 已补多记录 ready/detail route 截图；R4.4 已补产品 shell baseline 与文本盒溢出门禁；R4.5 已补 Vite live browser route interaction smoke；R4.6 已补 Rust system-string i18n。真实 component route tree、真实 API/PG seed 浏览器 smoke、Redis/SSE production 浏览器联调与完整服务端动态本地化仍待后续。

完整差距和后续施工顺序见 [`prd-concept-reproduction-gap-audit.md`](./prd-concept-reproduction-gap-audit.md)。

### 0.1 P1.0 双语运行时底座（2026-06-07 已落）

Web 端语言切换遵循“AI-native 但不打扰”的原则：控件只占右上角一个轻量 segmented control，不新增设置页阻塞用户，也不把用户带进复杂偏好表单。

| 项 | 当前实现 | 后续目标 |
|---|---|---|
| 语言来源 | `window.localStorage["workhub.locale"]`，缺省回退 `navigator.language`，再回退 `zh-CN` | 登录后同步到用户偏好，跨设备共享 |
| 可选语言 | `zh-CN` / `en-US` | 先只承诺中英，避免词表扩散 |
| UI 落点 | `packages/ui/src/gold-path/app-shell.ts` 右上角 `中 / EN` | 真实 React shell 迁移后复用同一 `WorkHubLocale` |
| 页面静态文案 | `packages/ui/src/gold-path/render.ts` 通过 `goldPathT(locale,key)` 渲染 | 全部真实 routes 抽 `copy key`，禁止散落硬编码 |
| 运行时提示 | `apps/web/src/browser.ts` 的选项选择、打回原因、动作失败、动作未接线 | 后续 toast / command menu / settings 全部接同一词表 |
| API 动态字段 | `GET /api/pages/*` 支持 `locale` query，API envelope 回 `meta.locale`，但 VM 内容仍展示 daemon 原文 | `me.locale` 驱动服务端 Page VM；Agent/daemon 生成 summary 时按 locale 输出 |
| 验收测试 | `@workhub/ui`、`@workhub/web` 测试已覆盖英文 chrome | 增 Playwright 截图对比中/英两个 viewport，确认无溢出 |

验收口径：切换英文后，静态框架必须出现 `Needs your decision` / `Budget and cost` / `Language`，并且导航、审批原因按钮、错误提示不应残留中文。动态任务内容若仍是中文，必须在文档和后续计划中明确它来自 API VM，不能把它算作本地化完成。

### 0.2 P1.1 Locale Contract Propagation（2026-06-08 已落）

本轮把 locale 从 UI 词表提升为跨端合同。详细施工说明见 [`i18n-locale-contract-p1-1.md`](./i18n-locale-contract-p1-1.md)。

| 项 | 当前实现 | 后续目标 |
|---|---|---|
| 合同来源 | `packages/contracts/src/locale.ts` 拥有 `WorkHubLocale`、`workHubLocaleStorageKey`、`normalizeWorkHubLocale()` | 写入 OpenAPI / codegen，避免手写 client 漏字段 |
| Page request | `packages/api-client` 的 `pages.*` 方法接受 `{ locale }`；Web loader 会传当前 locale | 非 Gold Path 页面迁到真实 routes 后统一使用 typed client |
| Page response | `apps/api/src/routes/pages.ts` 读取 `?locale=` / `Accept-Language` 并回 `meta.locale` | 用户偏好 `me.locale` 作为服务端默认 |
| Cuu 文案边界 | Cuu card adapter、desktop shell bridge、pet 轻气泡固定文案双语 | Live2D pet card fixture 做中英截图验收 |
| 动态内容边界 | 用户原文、LLM 摘要、证据摘录、proposal manifest 不在客户端假翻译 | Agent/daemon 生成可本地化摘要时接 locale |

### 0.3 P1.2 非 Gold Path render helpers（2026-06-08 已落）

P1.2 把中英双语从 Gold Path shell 延伸到未来真实 routes 会复用的 typed render helpers。详细说明见 [`i18n-nongoldpath-render-helpers-p1-2.md`](./i18n-nongoldpath-render-helpers-p1-2.md)。

| 项 | 当前实现 | 后续目标 |
|---|---|---|
| Helper 词表 | `packages/ui/src/i18n.ts` 提供非 Gold Path fixed-copy、enum label、count formatter | 真实 React routes 迁移时复用，不重新散落硬编码 |
| Intake | `renderIntakeSession(...,{ locale })` 支持 `AI recommended` / `Continue` / free-text 固定标签 | 服务端按 locale 生成 question body / option 文案 |
| WorkItem | `renderWorkItemDetail(...,{ locale })` 支持 `Live AI work` / `Acceptance checklist`；可见 `ai_working` 改为 `AI working` | 视觉截图确认状态 badge 不溢出 |
| Proposal | `renderProposalDetail(...,{ locale })` 支持 `What changed` / `Check results`；可见 `text_doc`、`generated` 等 enum 人话化 | action.label 后续由服务端 Page VM 按 locale 输出 |
| AgentRun | `renderAgentRunLive(...,{ locale })` 支持 `Cancel run` / `View replay` / `Tool result` / `Running` 等固定标签 | replay/trace 真实页面接同一词表 |
| Web facade | `apps/web/src/main.ts` 的 `renderWeb*` / `loadWeb*` 可传 locale | browser route 层从 `workhub.locale` 贯穿所有真实页面 |

### 0.4 R1.10 Proposal conflict cards（2026-06-09 已落）

本轮把 R1.9 的冲突 API 接到 Web/Desktop 主界面，但保持 Web 严肃无 Cuu：

| 项 | 当前实现 | 后续目标 |
|---|---|---|
| 页面预读冲突 | `renderWebProposalDetail()` 先读 `GET /api/workitems/:id/conflicts`，过滤当前 proposal 后传入 `renderProposalDetail(...,{ conflicts })` | React route 产品化后复用同一 typed loader |
| merge 时冲突 | `apps/web/src/browser.ts` 捕获 `ApiErr.code="merge_conflict"`，从 `error.details.conflicts[]` 渲染 `renderProposalConflictCards()` | Toast/notice 升级为正式 inline panel，不依赖 P0.5 shell |
| 选项 payload | 冲突按钮携带 typed action。`accept_incoming` 继续用 `data-request-json` 调用 `client.mergeProposal(proposalId, payload)`；R1.17 起可执行的 `ai_fusion` 显示「采用 AI 融合稿」，点击 `/api/merge-proposals/{id}/apply` 并调用 `client.applyMergeProposalCandidate(id,{confirm:true})`，服务端在未选择时自动写入 `chosen_*` 后采纳正式交付物。R1.11-R1.16 已把 blocked/merged attempt、候选方案、accepted incoming target keys、候选选择和 Markdown 融合稿物化落审计 | 多冲突逐项选择工作台、字段级 AI 融合 patch |
| 用户用语 | 「和别人的改动撞车了」「保留正式版」「采纳这次版本」「AI 融合建议」「采用 AI 融合稿」 | 字段级/文本级写回仍保持 option-first |
| 边界 | Web/Desktop 主窗只显示严肃冲突卡；Cuu 本体仍只在独立 pet window | Playwright 截图验证主窗无 Cuu |

### 0.5 R1.13 Replay decision timeline（2026-06-09 已落）

Replay Work 不再只显示步骤、成本、快照和正式交付物。当前 `packages/ui/src/gold-path/render.ts` 会从 `ReplayTraceVM.merge_timeline[]` 渲染严肃“决策记录”区，展示：

- attempt 结果：`merged` 显示为“已采纳”，`conflict` 显示为“遇到撞车”。
- 冲突目标：显示 `conflict_key` / `target_keys`，例如 `delivery:/outputs/result.md`。
- 候选方案：`keep_current` 显示为“保留正式版”，`accept_incoming` 显示为“采纳这次版本”，可 apply 的 `ai_fusion` 显示为“采用 AI 融合稿”；只读 replay 中仍可显示“AI 融合建议/AI fusion draft”。
- 审计状态：候选可标记“推荐”和“已选择”；未选择时显示“未选择”；R1.15 起 `ai_fusion` 也可以形成选择记录；R1.16 起 apply 后会在新的 merged attempt 中显示 `chosen_option_key="ai_fusion"`；R1.17 起从冲突卡直接 apply 时，原 conflict row 也会先写 `chosen_option_key="ai_fusion"`，并通过 `accepted_deliverables[]` 看到物化后的融合稿。Replay 仍是只读解释页。
- 双语：固定 chrome 已接 `packages/ui/src/gold-path/i18n.ts`，zh-CN / en-US 均有测试；动态 rationale 保留服务端原文，不在客户端硬翻译。

边界：这是只读 replay 解释面，不是新的看板或冲突工作台；Web/Desktop 主窗仍不出现 Cuu 本体。

### 0.6 R4.1 Web route-state matrix foundation（2026-06-11 已落）

本轮把 R4 的“四态 + 双语 + 无 Cuu 主窗 + 不横向溢出”从文字要求变成可复跑 QA foundation。详细计划与验收见 [`../06-roadmap/r4-01-web-route-state-matrix-plan-2026-06-11.md`](../06-roadmap/r4-01-web-route-state-matrix-plan-2026-06-11.md)。

| 项 | 当前实现 | 后续目标 |
|---|---|---|
| 状态卡 helper | `packages/ui/src/route-state.ts` 固定 `loading/empty/error/forbidden` 与 `home/intake/approvals/workitem/proposal/replay/cost/settings` | 接入 `apps/web` 真实 route loader，而不是只在 QA matrix 中渲染 |
| 双语 | zh-CN / en-US 固定状态 copy 已覆盖；`@workhub/ui` 测试防止 Cuu / kanban 词泄漏 | 动态 Page VM 摘要由服务端按 locale 生成 |
| 视觉 QA | `pnpm qa:r4-web-route-state-matrix` 生成 desktop/mobile Chrome 截图和 `route-state-matrix-report.json` | 每个真实 route 都补 ready + 四态截图 baseline |
| 边界 | R4.1 不能证明真实 React SPA 完成，也不能证明多条真实后端数据已渲染 | R4.2 建真实 route registry；R4.3 接多 work item / proposal / approval seed |

### 0.7 R4.2 Web route registry + loader（2026-06-11 已落）

本轮把 R4.1 的静态四态基础接入浏览器入口。详细计划与验收见 [`../06-roadmap/r4-02-web-route-registry-loader-plan-2026-06-11.md`](../06-roadmap/r4-02-web-route-registry-loader-plan-2026-06-11.md)。

| 项 | 当前实现 | 后续目标 |
|---|---|---|
| Route registry | `apps/web/src/routes.ts` 注册 `/`、`/intake/:sessionId`、`/approvals`、`/workitems/:id`、`/proposals/:id`、`/agent-runs/:id/replay`、`/dashboard/cost`、`/settings` | R4.3 为 detail routes 增加真实多记录 ready/forbidden/not-found 视觉 QA |
| Loader 状态机 | `idle/loading/ready/empty/error/forbidden` 已接 `renderRouteStateCard()`；403 -> forbidden，404/空队列 -> empty，普通错误 -> error | 局部 skeleton 与 retry action 做成正式产品组件 |
| 真实 Page VM | `/` 先读 `client.pages.attention()`，`/approvals` 先读 `client.pages.approvals()`，`/dashboard/cost` 先读 `client.pages.cost()`，再用 shared shell 渲染 ready 页面 | 去掉对 gold-path fixture shell 的 ready fallback，迁到真实 component route tree |
| 导航 | `GoldPathAppShell.linkMode="path"`，browser 用 `history.pushState/popstate` 重进 loader；QA gate 确认无 `href="#/"` | 后续接 command menu、deep link 和 SSE-driven refresh |
| 视觉 QA | `pnpm qa:r4-web-route-registry-loader` 生成 loading/ready/empty/error/forbidden 的 Chrome 截图与 DOM report | R4.3 ready case 必须覆盖多 work item / proposal / approval / cost usage |

边界：R4.2 不是完整 React SPA；它证明的是 URL route registry、typed Page VM loader、真实 path navigation 与 route-state 边界已进入浏览器 boot。动态 VM 文案仍按 daemon 原文呈现，不在客户端假翻译。

### 0.8 R4.3 Web multi-record Page VM visual QA（2026-06-11 已落）

本轮把 R4.2 的 route loader 证据从单场景 preview 推进到多记录 Page VM visual QA。详细计划与验收见 [`../06-roadmap/r4-03-web-multi-record-page-vm-visual-qa-plan-2026-06-11.md`](../06-roadmap/r4-03-web-multi-record-page-vm-visual-qa-plan-2026-06-11.md)。

| 项 | 当前实现 | 后续目标 |
|---|---|---|
| 多记录 ready case | `pnpm qa:r4-web-multi-record-page-vm` 覆盖 `/`、`/approvals`、`/dashboard/cost`、`/workitems/:id`、`/proposals/:id`、`/agent-runs/:id/replay` | R4.4 迁到真实产品 shell 后保留同一 coverage |
| 单 fixture 去除 | QA surface 替换 `客户周报/weekly` 文案，gate `no_weekly_fixture_copy_in_ready=true` | 后续改用真实 PG seed 或 live daemon 多记录 |
| detail route proof | Web 单测已覆盖 workitem/proposal/replay endpoint-first；QA report 记录 endpoint call 顺序 | 加入 live browser dev-server smoke |
| 状态 fallback | empty approvals、forbidden workitem、missing proposal 均通过 route-state screenshot | 后续每个产品页都补局部 skeleton / retry / request access |
| 视觉边界 | 继续 gate `no_main_window_cuu`、`no_default_kanban`、`no_horizontal_overflow` | R4.4 建 desktop/mobile/zh/en visual baseline |

边界：R4.3 仍是 deterministic Page VM QA surface，不等同于真实 PostgreSQL 多记录 live daemon。产品 shell 组件化和完整交互仍由 R4.4 继续。

### 0.9 R4.4 Web product shell baseline（2026-06-11 已落）

本轮把 R4.3 的 ready route 从旧 preview shell 切到 Web 产品壳 baseline。详细计划与验收见 [`../06-roadmap/r4-04-web-product-shell-baseline-plan-2026-06-11.md`](../06-roadmap/r4-04-web-product-shell-baseline-plan-2026-06-11.md)。

| 项 | 当前实现 | 后续目标 |
|---|---|---|
| Product shell renderer | `packages/ui/src/gold-path/product-shell.ts` 渲染 topbar、path nav、masthead、metrics、route panels、right rail，并保留 `data-wh-*` browser hooks | 迁到真实 Web component route tree，减少 shared HTML helper 依赖 |
| Web ready route | `apps/web/src/routes.ts` 的 ready path 改用 `renderWebProductShell()`；empty/error/forbidden 继续走 route-state helper | 接真实 dev-server interaction smoke 与 SSE refresh |
| 视觉 QA | `pnpm qa:r4-web-product-shell-baseline` 覆盖 Home / Approvals / WorkItem / Proposal 四屏、desktop/mobile、zh/en、Chrome screenshot/contact sheet | 后续扩展到 Replay / Cost / Settings 与 live daemon seed |
| 文本与导航边界 | report gate `no_horizontal_overflow=true`、`navHorizontalOverflow=false`、`no_text_box_overflow=true`、四个 case `textOverflowCount=0` | 所有新增页面继续把文本盒溢出作为阻塞门 |
| 产品边界 | 主窗无 Cuu、无 Cuu settings、无 default Kanban；path 导航无 `#/` 泄漏 | Web 只保留派活/审批/管理，接活/干活继续留在桌宠端 |

边界：R4.4 不是完整 React SPA，也不是 live PostgreSQL 多记录实机联调；英文 shell 下的动态任务内容仍来自 API VM 原文，不能当作服务端动态本地化完成。

### 0.10 R4.5 Web live route interaction smoke（2026-06-11 已落）

本轮把 R4.4 的截图基线推进到真实浏览器事件链路。详细计划与验收见 [`../06-roadmap/r4-05-web-live-route-interaction-smoke-plan-2026-06-11.md`](../06-roadmap/r4-05-web-live-route-interaction-smoke-plan-2026-06-11.md)。

| 项 | 当前实现 | 后续目标 |
|---|---|---|
| Listener 生命周期 | `apps/web/src/browser.ts` 用 `AbortController` 管理 ready route bindings，进入 loading/error 或重新 ready 前先 abort | 后续 React route tree 迁移时保持单一事件边界 |
| Live smoke | `pnpm qa:r4-web-live-route-interaction` 启动 Vite dev server、mock API 和 Chrome CDP | 接真实 API/PG seed 与 SSE refresh |
| 交互覆盖 | path nav click、history back/forward、locale toggle reload、ready/empty/forbidden/error、mobile proposal scroll | 增加 action/notice、retry/request access、SSE-driven refresh |
| 数据流门 | report 记录 Page VM endpoint count：`approvals=3`、`workitem=3`、`preferencePatch=1`，防重复 listener 回归 | 后续 live daemon 下继续保留 endpoint call count |
| 视觉边界 | `no_main_window_cuu`、`no_default_kanban`、`no_old_preview_shell`、`no_weekly_fixture_copy`、`no_horizontal_overflow`、`no_text_box_overflow`、`mobile_scroll_no_topbar_nav_overlap` 全为 true；mobile proposal change pill 已由 raw `text_doc` 改为 `Text document` 并换行落位 | 所有新增 Web route 继续用同一门禁 |

边界：R4.5 仍是 mock API live-browser smoke，不等同于真实 PostgreSQL / Redis / SSE production 浏览器验收；动态 VM 内容仍未完成服务端双语生成。

### 0.11 R4.6 Rust system-string i18n（2026-06-11 已落）

本轮把 Web/desktop/pet 已有 locale contract 延伸到 Rust shell 系统层。详细计划与验收见 [`../06-roadmap/r4-06-rust-system-string-i18n-plan-2026-06-11.md`](../06-roadmap/r4-06-rust-system-string-i18n-plan-2026-06-11.md)。

| 项 | 当前实现 | 后续目标 |
|---|---|---|
| Rust locale contract | `client-tauri/src-tauri/src/locale.rs` 定义 `WorkHubLocale`、`WORKHUB_LOCALE`、normalize 规则 | 后续如要热切换 OS tray label，需要从 WebView preference event 反向刷新原生菜单 |
| Tray/menu | `tray_menu_items(locale)`、`tray_tooltip(locale)` 输出中英 label/tooltip；action id、route、focus 不变 | Windows/Linux/macOS 原生菜单截图继续作为跨平台实机 smoke |
| Notification fallback | `system_notification_plan_from_push_payload_for_locale()` 只本地化 fallback title/body | 服务端按 locale 生成动态 notification summary |
| Diagnostics | `describe_deep_link_error()` 和 `single_instance_plan_from_args_for_locale()` 本地化错误类型描述 | UI 层如展示 diagnostics，继续保留 raw URL/target 供审计 |
| QA gate | `pnpm qa:r4-rust-system-i18n` 跑 cargo tests 并静态检查系统串合同，已接入 `pnpm verify` | 后续 R4.7/R4.8 保留 R2 release gate 与 no-reference discipline |

边界：R4.6 不等同于完整 Web route tree 或服务端动态本地化；它解决的是 Rust shell 固定系统串单语风险。

---

## 0. 一句话与三条 Web 端地基

**C-WEB = 派活/管理/审批的瘦视图 + 一条事件流。** 它不含业务逻辑（业务真相在 C-DAEMON），只做「发请求 + 订 SSE + 渲染 + 去黑话」。

落定本篇的三条前提（来自 [README §1](../README.md) 与现有代码）：

- **D-WEB-1 设备令牌门切分**：浏览器**只能派活/审批/管理**；**接活、干活、个人工作区、本地拆解**是接单方动作，**仅桌宠端**（C-PET）呈现。这是现有代码的硬约定——`App.tsx:154` 注释「接单方动作仅在桌面客户端发生」、`RequirementDetail.tsx:46` 的 `desktopOnly` tab、`isDesktopRuntime()`（`shared/src/api/client.ts:8`）门控。
- **D-WEB-2 双通道状态**：**REST 拉取为真相，SSE 为增量提示**（api-contract §7）。现有页面普遍是「SSE/轮询触发 → 重拉 REST reconcile」，绝不把 SSE 当唯一数据源（`Dashboard.tsx:122` 收到任意事件就 `refresh()`；`RequirementDetail.tsx:166` 收到 `latestStatus` 就 `refresh()`）。
- **D-WEB-3 去黑话渲染**：API 层保留技术名（`proposal`/`branch`/`merge`），**翻译在客户端完成**。状态枚举→人话标签**唯一走** `statusLabel()`（`status-vocab.ts:42`），严禁拼 snake_case；置信度/风险只用三档语气、绝不显示数值（glossary §3.3）。

> **WorkHub 演进的判断**：现有 Web 已经是「瘦的」（system-architecture M16），迁移=**接 OpenAPI 类型化 client + 统一事件订阅 + 补 WorkHub 新增页（审批中心 / 提议详情 / 升级与置信度呈现）**，不重写既有页面骨架。本篇在「现有页」基础上标注「WorkHub 新增/演进」。

---

## 1. 信息架构（IA）

### 1.1 顶层导航（4 主入口 + 1 二级看板菜单）

权威来源 `App.tsx:185` 的 `TopNav` + `:299` 的 `BoardsMenu`。顶栏是**粘性玻璃条**（`sticky top-0 z-40 glass-quiet`），左品牌+主导航，右搜索/外观/身份/帮助/设置。

```
┌─ TopNav (sticky, glass) ───────────────────────────────────────────────┐
│ [▣ 需求管理大师]  项目 ▼看板  日程  通知        [⌘K 搜索…] [☀]  [@昵称] [?] [⚙] │
└────────────────────────────────────────────────────────────────────────┘
                        │
              看板▼(BoardsMenu, 派活方工具)
                ├─ 派活看板   /dashboard
                ├─ 资源排期   /planning
                ├─ 项目健康度 /health
                └───────────
                └─ 历史搜索   /knowledge
```

- **4 主入口**：项目（`/`）· 看板（下拉）· 日程（`/calendar`）· 通知（`/notifications`）。
- **二级「看板」下拉**（派活方工具）：派活看板 / 资源排期 / 项目健康度 / 历史搜索。`App.tsx:182` 注释明确：「删除原来的『派活看板/本地工作台』主入口——接单方动作仅在桌面客户端发生」，故这些 PM 工具收进二级菜单。
- **全局 ⌘K 命令面板**（`CommandMenu`，`App.tsx:131`）：导航跳转（首页/看板/排期/健康/历史搜索/日程/通知）+ 操作（设置/再看新手引导）。
- **全局叠加层**：`ClientDownloadBanner`（顶部横幅，提示装桌宠端去接活）、`ToastHost`（通知 toast 宿主）、`SettingsDialog`、`WelcomeTour`（首跑引导，`useFirstRun` 持久化 `seen`）。

> **WorkHub 新增主入口建议**：在「通知」旁增「审批」（`/approvals`，§2.13），因为审批=阻塞原语是 Web 端头等动作（api-contract §2.8）；命令面板同步加一条。

### 1.2 信息层级（三层下钻）

```
L1 项目列表 (/)                          ← 一切的入口
   └ L2 项目工作台 (/p/:id) ─ tab: 需求 | 网盘 | 会议 | 知识库 | 排期 | 健康
        ├ 提需求 (/p/:id/new)            ← 5 步向导
        ├ 项目网盘 (/p/:id/drive)
        ├ 项目会议 (/p/:id/meetings)
        └ L3 需求详情 (/r/:id) ─ tab: 概览 | 拆解 | 对话 | 附件 | 交付物 | 评论 | 活动
             └ 澄清对话 (/r/:id/clarify) ← AI 流式问答 → 总结 → 投递
全局横切（不挂项目）：
   /dashboard /planning /health /knowledge /calendar /notifications
   [WorkHub 新增] /approvals  /proposals/:id  (升级与置信度呈现内嵌于 /r/:id)
```

下钻入口在两处汇聚：项目卡（`/p/:id`）与需求卡（`/r/:id`）。横切看板/排期/健康/知识库都支持 `?project_id=` 过滤回到单项目上下文（`ProjectView.tsx:167-178` 的 tab 链接即带此参）。

---

## 2. 路由与页面清单（逐页）

权威路由表 `App.tsx:152-173`（`react-router-dom` `BrowserRouter`）。下表全量；「身份」列指访问/动作面（Web 一律先过昵称登录门，`App.tsx:78`）。

| # | 路由 | 页面组件 | 一句话职责 | 主要 API（client.ts） | SSE 订阅 | web↔桌宠差异 |
|---|---|---|---|---|---|---|
| P0 | （登录门） | `NicknameDialog` | 填昵称即身份（LAN 免密） | `identify`/`me` | — | 一致；桌宠另持设备令牌 |
| P1 | `/` | `Home` | 项目列表 + 新建 + 归档/删除/回收站 | `listProjects`/`createProject`/`archive/delete/restoreProject` | — | 一致 |
| P2 | `/p/:id` | `ProjectView` | 项目工作台（需求列表 + 6 tab 入口） | `getProject`/`listRequirements` | （建议 `all`/`workitem`） | 一致 |
| P3 | `/p/:id/new` | `NewRequirement` | 提需求 5 步向导 → 建草稿 | `createRequirement`/`listAttachments` | — | 一致 |
| P4 | `/r/:id/clarify` | `Clarify` | AI 流式澄清问答 → 总结卡 → 投递 | `chat`(SSE)/`postAnswer`/`autoProcess`/`submitRequirement` | **chat 流**（POST SSE） | 一致 |
| P5 | `/r/:id` | `RequirementDetail` | 需求详情（7~8 tab） | `getRequirement`/`listAttachments`/`listTaskPlans`/`listAcceptanceItems`/`me` | **`req:{id}`** | **「我的工作区」tab 仅桌宠**；接活/开始做按钮仅桌宠 |
| P6 | `/dashboard`、`/local-workbench` | `Dashboard` | 派活看板（5 桶）/桌宠端=本地工作台 | `listRequirements`(7 状态扇出) | **`all`**（任意事件触发重拉） | 标题/语气切换；同组件 |
| P7 | `/planning` | `PlanningPage` | 资源排期/负载 | `workload`/`listProjects` | — | 一致 |
| P8 | `/health` | `HealthPage` | 项目健康度 | `projectHealth`/`listProjects` | — | 一致 |
| P9 | `/knowledge` | `KnowledgePage` | 历史搜索 + 强制引用问答 | `searchKnowledge`/`askKnowledge`/`getKnowledgeRun`(轮询) | —（轮询 run） | 一致 |
| P10 | `/calendar` | `CalendarPage` | 日程（周/月/列表） | `listCalendarEvents`/`createCalendarEvent`/`deleteCalendarEvent`/`listUsers` | — | 一致 |
| P11 | `/notifications` | `NotificationsPage` | 通知收件箱（未读/全部） | `listNotifications`/`readNotification`/`readAllNotifications` | **`/stream/me`**（toast，全局挂载） | 一致；桌宠另有托盘/系统通知 |
| P12 | `/drive` | `DriveHome` | 网盘项目选择页 | `listProjects` | — | 一致 |
| P13 | `/p/:id/drive` | `ProjectDrive` | 项目网盘（树/列表/平铺 + 回收站 + 留言板） | `listDrive`/`driveTree`/上传分片/`paste/copy/cut/delete/restore/undo`/`*DriveComment` | （建议 `drive.*`） | 一致；桌宠另有本地双向同步开关 |
| P14 | `/p/:id/meetings` | `ProjectMeetings` | 会议（上传→ASR→纪要→洞察→草稿） | `listMeetings`/上传分片/`getMeeting`/`getJob`(轮询)/`confirm/dismissMeetingInsight` | （job 轮询） | 一致 |
| P15 | `*` | `NotFound` | 404 兜底（回首页） | — | — | 一致 |
| **W1** | `/approvals` **[新]** | `ApprovalsCenter` | 审批阻塞收件箱（allow/deny+理由，永远允许） | `GET /approvals`/`respond`/`delegate` | **`user:{id}`**（`permission.ask`） | Web 主场；桌宠以系统通知补强 |
| **W2** | `/proposals/:id` **[新]** | `ProposalDetail` | 提议（去黑话 PR）详情 + 通过/打回/采纳 | `GET /proposals/{id}`/`review`/`merge` | **`workitem:{id}`** | Web 主场（负责人审批） |

> **演进映射**：`Dashboard` 在 WorkHub 增「AI 在帮你做 / 等你扫一眼 / AI 在请人来接手」桶（承袭 §3.2 标签）；`RequirementDetail` 增「置信度/升级」呈现区与「提议」tab；`NewRequirement`/`Clarify` 的 `autoProcess` 入口演进为 `agent-run`（api-contract §2.6），但页面骨架不动。

---

## 3. 全局布局规范（壳与四态）

### 3.1 页面壳

- **容器**：`narrow-container`（窄页，列表/表单类：P1/P2/P3/P5）；`app-container`（宽页，看板/网盘/会议/知识/日程：P6–P14）。`RequirementDetail` 用 `narrow-container max-w-6xl` 折中。
- **壳结构**：所有页都在 `Shell`（`App.tsx:143`）内 = `ClientDownloadBanner` + `TopNav` + `<Routes>` + `CommandMenu`。**无左侧全局侧栏**——侧栏是**页内局部**的（澄清页左 meta 栏、网盘左树栏、会议左列表栏、知识/日程左输入栏）。
- **主题**：`ThemeToggle`（`App.tsx:264`）三态 auto/light/dark，走 `useTheme` + tokens.css。

### 3.2 四态约定（空 / 加载 / 错误 / 无权限）

现有代码已有统一范式，WorkHub 沿用：

| 态 | 现有实现范式 | 代码锚点 |
|---|---|---|
| **加载** | 简短文案「加载中…」占位（不上骨架屏的轻页）；或局部 spinner（`Loader2 animate-spin`）+ 进度条 | `RequirementDetail.tsx:185`、`ProjectMeetings.tsx:356` |
| **空** | `empty-state` 类 + 图标 + 一句**带语气的人话** + 行动按钮（如「建一个开始」） | `Home.tsx:202`、`Dashboard.tsx:217`、`ProjectDrive.tsx:651` |
| **错误** | 红框 `border-red-200 bg-red-50 text-red-700` + 错误文案 + **重试按钮**；列表错误与空态**必须可区分**（注释专门强调，否则 load 失败被误读为「空」） | `RequirementDetail.tsx:173`、`ProjectView.tsx:64`、`DriveHome.tsx:35` |
| **无权限** | Web 通过**隐藏动作**实现（按钮不渲染）+ 后端 403 兜底；可见性门让私有需求他人 404 | `RequirementDetail.tsx:204`（`canClaim`/`canManageAssignees`）、api-contract §6.2 `403/404` |

> **取消竞态护栏（贯穿全站）**：几乎每个页都用「**单调 token / seq ref**」防止旧请求覆盖新状态（快速切换 `/r/A→/r/B`、6s 轮询与 SSE 重叠、搜索连打）。例：`RequirementDetail.tsx:102 refreshTokenRef`、`Dashboard.tsx:50 refreshTokenRef`、`Clarify.tsx:78`、`ProjectDrive.tsx:118 reloadTokenRef`。**这是现有代码踩坑沉淀的契约，WorkHub 新页必须照搬**。

### 3.3 SSE 订阅总规范

权威：`useReqStream`（GET `/api/push/stream/req/{id}`，`shared/src/hooks/useReqStream.ts`）、`useNotificationToasts`（GET `/api/push/stream/me`，`web/src/hooks/useNotificationToasts.ts`）、`Dashboard` 内联 `/api/push/stream`、`useChatStream`（POST `/api/requirements/{id}/chat` 的流式响应，`shared/src/hooks/useChatStream.ts`）。共性：

- **逐行 `data:` 解析**（多行 payload 按 `\n` 重组，剥一个前导空格），`event:` 取类型；`heartbeat` 不触发 handler。
- **指数退避重连**（`Dashboard.tsx:102`、`useNotificationToasts.ts:29`），1s→上限 30s；`connected` 状态外显（看板「实时连接/已断开」）。
- **AbortController + reader.cancel()** 清理，路由切换不串流（`useChatStream.ts:140` 注释：route change mid-stream 不能让旧需求的 parsed 画到新页）。
- **收到事件 → 重拉 REST**（D-WEB-2）：`Dashboard.tsx:124 refresh()`、`RequirementDetail.tsx:166`。

事件类型清单与 topic 隔离权威在 [api-contract §5](../01-architecture/api-contract.md)；本篇只标「哪页订哪个 topic」。

---

## 4. 逐页详解（布局 + 组件 + 绑定 + SSE + 四态 + 交互流）

> 每页给：**文字 wireframe**、关键组件、数据/API 绑定、SSE 订阅、四态、关键交互与跳转流、web↔桌宠差异。

### P0. 登录门 — `NicknameDialog`（`App.tsx:78`）

**布局**：全屏居中卡片（无壳）。在 `loading` 时先显「正在打开…」（`App.tsx:71`），`me==null` 时显昵称对话框。

```
┌──────────── app-shell (grid place-items-center) ────────────┐
│                  ┌────────────────────────┐                 │
│                  │  填个昵称就能用          │                 │
│                  │  [______________]       │                 │
│                  │  (admin? 口令输入)       │                 │
│                  │            [ 进入 ]      │                 │
│                  └────────────────────────┘                 │
└─────────────────────────────────────────────────────────────┘
```

- **绑定**：`identify(nickname, adminSecret?)`（client.ts:42）→ 签 cookie；成功后 `me` 有值，`WelcomeTour` 在首跑自动弹（`App.tsx:68`）。
- **四态**：加载=「正在打开…」；错误=对话框内联（认领 admin 昵称缺口令→403，文案见 api-contract §2.1）。
- **web↔桌宠**：一致；**桌宠**额外在登录后注册设备令牌（`X-YQGL-Client-Token`），Web 不需要。术语见 [glossary §8「昵称身份」](../00-overview/glossary-dejargon.md)。

---

### P1. 项目列表 — `Home`（`web/src/pages/Home.tsx`）

**布局**：`narrow-container`。顶部标题区 + 「新建项目」按钮（toggle 内联表单）；状态 tab（正常/已归档/回收站）；项目卡列表。

```
┌─ narrow-container ──────────────────────────────────────────┐
│ 项目                                        [ + 新建项目 ]   │
│ 把需求按项目收口…                                            │
│ (creating? ┌ 内联表单：项目名 | slug  [创建] ┐)             │
│ [正常] [已归档] [回收站]                                     │
│ ┌ paper-surface (divide-y) ───────────────────────────────┐ │
│ │ ▣ 项目名  [slug] [已归档?] [回收站?]   [打开→][提需求][归档][删除] │ │
│ │   描述…  @owner                                          │ │
│ │ … (空态: 圆图标 + 「还没有项目」+ 「建一个开始」)         │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

- **组件**：内联新建表单（name/slug）；状态 tab；项目行（`Link to /p/:id`、`/p/:id/new`、归档/删除/恢复按钮）；`ProjectStateConfirm`（归档/删除/恢复确认弹层，含「软删除可恢复/30 天清理」文案）。
- **绑定**：`listProjects(state)`、`createProject`、`archiveProject`/`deleteProject`/`restoreProject`（client.ts:61-70）。`projectMatchesState` 本地按 state 过滤。
- **SSE**：无（项目列表非高频实时；靠操作后 `refresh()`）。
- **四态**：空=按 state 分文案（`Home.tsx:206-216`，三种态各一句）；加载=列表为空+无错误；错误=红框+（在/不在创建态两种位置）；无权限=删除/归档由后端校验（submitter/admin）。
- **交互流**：建项目 → `refresh()`；点项目名/「打开」→ `/p/:id`；「提一条新需求」→ `/p/:id/new`；归档/删除/恢复 → 弹 `ProjectStateConfirm` → 确认 → `refresh(targetState)`。
- **取消护栏**：`refreshTokenRef`/`stateRef`/`actionSeqRef`（`Home.tsx:34-57`）防 state 切换与 action 竞态。
- **web↔桌宠**：一致。

---

### P2. 项目工作台 — `ProjectView`（`web/src/pages/ProjectView.tsx`）

**布局**：`narrow-container`。返回链 + 项目标题/slug/状态 pill + 项目操作；**6 tab 横栏**（需求/网盘/会议/知识库/排期/健康，后三个带 `?project_id=` 跳横切页）；需求列表（每行进度条 + 状态徽标）。

```
┌─ narrow-container ──────────────────────────────────────────┐
│ ← 全部项目                                                   │
│ 项目名  [slug] [已归档?]            [提需求][归档][删除]      │
│ [需求] [网盘] [会议] [知识库] [排期] [健康]   ← tab nav      │
│ ┌ paper-surface 需求列表 ─────────────────────────────────┐ │
│ │ ▤ CODE 标题            @submitter  负责人X+2  创建时间    │ │
│ │   进度 ▓▓▓░░ 45%                              [状态徽标]→ │ │
│ │ … (空: 「还没有需求」)                                   │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

- **组件**：tab nav（`ProjectView.tsx:154`，需求是站内 tab，网盘/会议是子路由，知识/排期/健康是横切页带 `?project_id`）；需求行（`Link to /r/:id` + 进度条 `STATUS_PROGRESS` 思路 + `StatusBadge`）；`ProjectStateConfirm`。
- **绑定**：`getProject(id)`、`listRequirements({project_id})`（client.ts）。
- **SSE**：现状无；**WorkHub 建议**订 `workitem:{id}`/`all` 让列表状态徽标实时跳（对齐 Dashboard 模式）。
- **四态**：空=「还没有需求」；加载=「加载中…」；错误=红框+「重试」+「回项目列表」；无权限=私有需求列表项后端过滤。
- **交互流**：tab 切换；点需求 → `/r/:id`；删除项目成功 → `nav("/")`（`ProjectView.tsx:92`）。
- **web↔桌宠**：一致。

---

### P3. 提需求向导 — `NewRequirement`（`web/src/pages/NewRequirement.tsx`）

**布局**：`narrow-container max-w-4xl`。`Stepper`（5 步：想说的事/谁来做/截止时间/附件/跟 AI 聊聊）+ 单卡片分步内容。

```
┌─ narrow-container max-w-4xl ────────────────────────────────┐
│ 提一条新需求 / <当前步标题>                                  │
│ ●──●──●──○──○   Stepper (可回跳，不可前跳)                  │
│ ┌ paper-surface ─────────────────────────────────────────┐ │
│ │ step0 想说的事: [大文本域] [🎤语音] [优先级 chips]        │ │
│ │ step1 谁来做:   <AssigneeSelector lead+协作者>           │ │
│ │ step2 截止:     [开始?][截止*] [工时?][信心]             │ │
│ │ step3 附件:     <FileUpload> + 已传列表(已解析?)         │ │
│ │ step4 跟AI聊:   ✨「差不多了」[下一步：跟 AI 聊聊]        │ │
│ │              [上一步]                    [下一步/保存并继续] │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

- **组件**：`Stepper`（`@yqgl/shared`，`onJump` 只允许回跳）；`AssigneeSelector`（lead+协作者）；`VoiceButton`（语音转文字填描述）；`FileUpload`（分片上传，`onBusyChange` 阻断切步）；优先级 chips。
- **绑定**：**草稿在第 2 步（填完截止）后创建** `createRequirement(projectId, {...})`（`NewRequirement.tsx:145`），返回 `reqId`；附件在第 3 步走 `FileUpload`。
- **SSE**：无。
- **四态**：错误=红框（每步校验：step0 必填描述、step2 必填截止、上传中禁切步）；加载=按钮「保存中…/附件上传中」；空/无权限=N/A。
- **关键交互**：「附件还在上传中」会阻断 next（`blockIfUploading`）；step4「下一步：跟 AI 聊聊」→ `nav('/r/:reqId/clarify')`。
- **web↔桌宠**：一致（提需求是派活方动作，两端都可）。

---

### P4. 澄清对话 — `Clarify`（`web/src/pages/Clarify.tsx`）★SSE 重头

**布局**：双栏 `lg:grid-cols-[280px_minmax(0,1fr)]`。**左 sticky meta 栏**（返回/编号/状态/接单人管理/附件/「够了，给我总结」）；**右聊天线程**（历史气泡 + 实时流气泡 + 问题卡/总结卡）。

```
┌─ app-container grid[280 | 1fr] ─────────────────────────────┐
│ ┌ aside(sticky) ─────┐ ┌ section 聊天线程 ───────────────┐ │
│ │ ← 项目              │ │ 🤖 气泡(历史)  …  你: 气泡(右)   │ │
│ │ CODE / 标题         │ │ ── LiveBubble: 「AI 助理思考中」 │ │
│ │ [状态徽标]          │ │     thinking(details) + text    │ │
│ │ 接单人 [管理]       │ │ ── QuestionCard:                │ │
│ │  公开池 / pills     │ │     问题 + 选项[..] + 其他[输入] │ │
│ │ 附件 (已解析?)      │ │   或 SummaryCard:               │ │
│ │ [够了，给我总结]    │ │     最终需求/复杂度/AI可处理     │ │
│ └────────────────────┘ │     摘要 + 投递DDL + ☑让AI先试  │ │
│                        │     [让 AI 助理先试 / 投递给负责人] │ │
│                        └─────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

- **组件**：`Bubble`（历史消息）、`LiveBubble`（流式 thinking/text）、`QuestionCard`（`ask_choice`/`ask_open` + `VoiceButton`）、`SummaryCard`（总结 + DDL + 「让 AI 先试」复选 + 投递）、`AssigneeSelector`、`SpeakButton`（TTS 朗读，summary 自动播）、`StatusBadge`。
- **绑定 + SSE**：`useChatStream(reqId)`——**POST `/api/requirements/{id}/chat` 的流式响应**（事件 `thinking`/`text`/`parsed`/`error`/`done`，`useChatStream.ts:81`）；`postAnswer`（答一轮后 `stream.reset()`+再 `run()`）；`stream.done` → `refresh()` 重拉 `getRequirement`/`listAttachments`/`listChatMessages`。投递分两路：`autoProcess(id)`（让 AI 先试）或 `submitRequirement(id)`（投给负责人）→ `nav('/r/:id')`。
- **四态**：加载=「加载中…」；空=自动起第一轮（`Clarify.tsx:166` `history.length===0` 且 draft/clarifying 时 auto-run）；错误=`stream.error` 红框 / `loadErr` 红框+重试；无权限=非 submitter 看不到「管理接单人」。
- **关键交互流**：进入页自动起对话 → AI 问 → 选/答 → 多轮 → 「够了给我总结」`forceSummarize` → 总结卡 → 选 DDL + 是否让 AI 先试 → 投递 → 跳 `/r/:id`。`RequirementDetail` 若状态仍是 draft/clarifying/summary_ready 会**自动回跳到本页**（`RequirementDetail.tsx:167`）。
- **取消护栏**：`refreshTokenRef`/`streamActionTokenRef`/`reqIdRef`（`Clarify.tsx:73-78`）；`useChatStream` 自身在 `req_id` 变更/卸载 abort（`useChatStream.ts:140`）。
- **web↔桌宠**：澄清是派活方动作，**两端一致**；桌宠走 `clientFetch`（带 base URL + 令牌，`useChatStream` 的 `customFetch` 参数，`useChatStream.ts:18` 注释）。

---

### P5. 需求详情 — `RequirementDetail`（`web/src/pages/RequirementDetail.tsx`）★web↔桌宠差异最大

**布局**：`narrow-container max-w-6xl`。返回链 + **header（编号/标题/状态/负责人/截止/工作区进度条/接单人 pills/动作按钮）** + 处理中时的 `AILiveView` 黑底终端 + **tab nav**（概览/拆解/对话历史/附件/交付物/评论/活动；桌宠多「我的工作区」）+ tab 内容。

```
┌─ narrow-container max-w-6xl ────────────────────────────────┐
│ ← project_slug                                              │
│ CODE                                                        │
│ 标题(大)                                                    │
│ [状态徽标] by 提交者  负责人X+2  创建时间                   │
│ [截止 pill(逾期红/今日黄/正常绿)]                           │
│ 工作区进度 ▓▓▓▓░ 45% · N 阻塞                               │
│ [公开池 / lead⭐ + 协作者 pills]      [改派][接这单][开始做][桌宠继续→][🔊] │
│ ── (ai_processing 时) AILiveView: 黑底终端 ai.* 逐行 ──     │
│ [概览][我的工作区*][拆解][对话历史][附件(n)][交付物][评论][活动] │
│ ┌ tab 内容 ──────────────────────────────────────────────┐ │
│ │ 概览: 工时/信心/验收数 卡 + planning note + 验收清单 + 描述│ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

- **tab 清单**（`RequirementDetail.tsx:42` `ALL_DETAIL_TABS`）：
  - 概览（工时/信心/验收数三卡 + planning note + 验收标准 + 需求描述 `summary_md`）。
  - **我的工作区**（`desktopOnly`，`WorkspaceBoard`：参与者/平均进度/阻塞统计 + 每人 `WorkspaceCard` 含 phase/进度/清单/动态，**只桌宠可编辑**）。
  - 拆解（`DecompositionPanel`：两阶段 Agent 拆解——投递前拆验收[派活方]、接单后拆个人清单[接单方,桌宠]，都需人工「确认写入」）。
  - 对话历史（`ChatHistory` 只读回放）、附件（下载）、交付物（`DeliverablesTab`，`canReview = me===submitter`）、评论（`CommentsPanel`）、活动（`ActivityTimeline`）。
- **绑定**：`getRequirement`/`listAttachments`/`listRequirementWorkspaces`(仅桌宠)/`listTaskPlans`/`listAcceptanceItems`/`me`；动作 `claimRequirement`/`patchStatus('doing')`/`updateAssignees`。
- **SSE**：`useReqStream(id)` 订 **`req:{id}`**——`latestStatus`(来自 `requirement.updated`) 驱动状态实时切 + 触发 `refresh()`；`events`(ai.*) 喂 `AILiveView`（`AILiveView.tsx:9` 只滤 `ai.*`，渲染 started/thinking/text/tool_call/done/failed 逐行）。
- **四态**：加载=「加载中…」；错误=`loadErr` 红框+重试（注释强调：没有它 404/401 会永远卡「加载中」）；空=各 tab 内 `empty-state`（无附件/无对话/无拆解/工作区）；无权限=动作按钮条件渲染（`canClaim`/`canStartDoing`/`canManageAssignees`，`RequirementDetail.tsx:204-207`）。
- **关键交互流**：状态=draft/clarifying/summary_ready → 自动跳 `/r/:id/clarify`；接活/开始做仅桌宠（Web 显示「在桌面客户端继续 →」深链 `yqgl://r/:id`，`RequirementDetail.tsx:390`）；改派接单人 → `AssigneeSelector` → 保存 → `refresh()`。
- **web↔桌宠差异（本页核心）**：
  - **「我的工作区」tab**：Web 隐藏（`desktopOnly`），桌宠显示且本人可编辑进度/清单/动态。
  - **接这单 / 开始做**：`canClaim`/`canStartDoing` 都要 `desktopRuntime===true`（`RequirementDetail.tsx:204-205`）；Web 上接单人看到「在桌面客户端继续」按钮。
  - **拆解**：投递拆解（dispatch）派活方可在 Web 触发；个人清单（worker）仅桌宠（`DecompositionPanel.tsx:598` `canWorker = isDesktop && ...`），Web 显示「个人清单在本地工作台生成」。
- **WorkHub 演进**：header 下增「**AI 把握程度 + 升级**」呈现区（三档语气，不显数值，glossary §3.3；数据来自 `GET /workitems/{id}/confidence`、`escalation.created` 事件）；tab 增「**提议**」（替代/并入「交付物」，承接 `proposal.opened/reviewed/merged` 事件，详见 W2）。

---

### P6. 派活看板 — `Dashboard`（`web/src/pages/Dashboard.tsx`）★全局 SSE

**布局**：`app-container`。header（标题 + 实时状态 + 最近同步 + 6s 自动刷新 + 「所有项目」）+ **5 桶看板**（响应式 1→2→3→5 列）。

```
┌─ app-container ─────────────────────────────────────────────┐
│ 派活看板  ⟳每6s · 最近同步 hh:mm:ss · [实时连接/已断开]  [所有项目]│
│ ┌等接单┐ ┌AI助理处理中┐ ┌进行中┐ ┌等你重做┐ ┌等验收┐        │
│ │卡(n)│ │ 卡(n)      │ │卡(n) │ │ 卡(n) │ │卡(n)│           │
│ │ CODE│ │ 进度▓▓     │ │      │ │       │ │     │           │
│ │ 标题│ │            │ │      │ │       │ │     │           │
│ │ @人 │ │            │ │      │ │       │ │     │           │
│ │ 负责人│ (空: 「暂时没有…」每桶一句)                        │
│ └────┘ └────────────┘ └─────┘ └───────┘ └────┘            │
└─────────────────────────────────────────────────────────────┘
```

- **组件**：`BucketCard`（5 桶：ready / ai_processing / claimed+doing / revision_requested / delivery_doc_pending+delivered）；`Card`（需求卡：编号/优先级点/状态徽标/标题/接单人/年龄/进度条）；按 `byUrgency` 排序。
- **绑定**：`listRequirements({status})` **7 个状态并行扇出**（`DASHBOARD_STATUSES`），合并去重。
- **SSE**：R2.4 后 **`/api/push/stream`（`all` topic）仅 admin 可订**；普通 Web 页面订 `stream/me` 或 `stream/workitem/:id` / 后续 `project:{id}` scoped stream。任意非 heartbeat 事件 → `refresh()`（`Dashboard.tsx:124`）；指数退避重连，`connected` 外显。另有 **6s `setInterval` 兜底轮询** + **tab 隐藏暂停**（`visibilitychange`，省 7 路扇出）。
- **四态**：空=每桶独立空文案；加载=首拉前桶为空；错误=顶部红框；无权限=N/A（看公共池）。
- **交互流**：点卡 → `/r/:id`。
- **web↔桌宠**：**同组件双标题**——`desktopRuntime` 时标题/eyebrow=「本地工作台」，Web=「派活看板」（`Dashboard.tsx:149`、`BucketCard` `webTitles`）。路由 `/dashboard` 与 `/local-workbench` 都指向本组件（`App.tsx:155-156`）。桌宠端这是「我的工单」聚焦视图的雏形。

---

### P7. 资源排期 — `PlanningPage`（`web/src/pages/PlanningPage.tsx`）

**布局**：`app-container`。header（标题 + 项目过滤下拉）+ 4 汇总卡（范围/估算工时/满载人员/阻塞）+ 人员负载卡网格（`2xl:grid-cols-2`）。

```
┌─ app-container ─────────────────────────────────────────────┐
│ 排期/负载                              [▾ 全部项目/某项目]   │
│ [范围] [估算工时h] [满载人员] [阻塞]   ← 4 汇总卡            │
│ ┌ 人员卡 ──────────────────────┐ ┌ 人员卡 ──────────────┐ │
│ │ ●在线 昵称 [空闲/忙碌]   load%│ │ …                    │ │
│ │ N任务 · X/Yh · 逾期 · 阻塞    │ │                      │ │
│ │ 负载条 ▓▓▓▓▓░ (>100 红)       │ │                      │ │
│ │ └ 需求行(Link /r/:id) 状态/DDL/进度% │                  │ │
│ └──────────────────────────────┘ └──────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

- **绑定**：`workload({project_id})` + `listProjects`（client.ts）。负载色阶 `tone(load_percent)`。
- **SSE**：无（靠进入/切项目重拉）。
- **四态**：加载=「加载排期...」；空=人员「暂时没排上活」；错误=红框；无权限=N/A。
- **交互流**：项目下拉过滤（同步 `?project_id=` URL）；点需求 → `/r/:id`。
- **取消护栏**：`loadTokenRef`（`PlanningPage.tsx:27`）防慢响应覆盖。
- **web↔桌宠**：一致（PM/派活方工具，Web 主场）。

---

### P8. 项目健康度 — `HealthPage`（`web/src/pages/HealthPage.tsx`）

**布局**：`app-container`。header（标题 + 项目过滤）+ 4 汇总卡（平均分/风险项目/逾期/项目数）+ 项目健康卡网格（`xl:grid-cols-2`）。

```
┌─ app-container ─────────────────────────────────────────────┐
│ 项目健康度                              [▾ 全部/某项目]      │
│ [平均健康分] [风险项目] [逾期需求] [项目数]                  │
│ ┌ 项目卡 ──────────────────────────────────────────────┐   │
│ │ ♥ 项目名 [risk_level]                          分数(大)│   │
│ │ 分数条 ▓▓▓▓▓▓▓░ (≥80绿/≥60橙/<60红)                  │   │
│ │ [风险] [30天吞吐] [当前负载h]   ← Metric                │   │
│ │ ┌ 风险预警 ┐ ┌ 效率统计(活跃/完成/周期/变动) ┐         │   │
│ │ [需求][排期][知识库] ← 跳转                            │   │
│ └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

- **绑定**：`projectHealth()` + `listProjects`。`scoreTone` 色阶；过滤不存在项目时自动切「全部」+ 提示（`HealthPage.tsx:35`）。
- **SSE**：无。
- **四态**：空=过滤后无卡（`displayRows` 空）；加载=（轻，无显式占位）；错误=红框；无权限=N/A。
- **交互流**：项目过滤；卡内「需求/排期/知识库」→ 各横切页带 `?project_id`。
- **web↔桌宠**：一致（健康分只敲桌子、不改状态，文案 `HealthPage.tsx:69`）。**WorkHub 演进**：本页是 M-DASHBOARD 落点，增「自治率/升级精准度/回滚率/成本」看板（`GET /dashboard/autonomy`、`/dashboard/cost`，api-contract §2.14；指标定义见 [dashboards-and-metrics](../04-modules/dashboards-and-metrics.md)）。

---

### P9. 历史搜索 — `KnowledgePage`（`web/src/pages/KnowledgePage.tsx`）

**布局**：`app-container`。header（标题 + 项目过滤）+ 双栏 `xl:grid-cols-[1.1fr | 0.9fr]`：**左 grep 命中列表**，**右 Agent 问答**（强制引用）。

```
┌─ app-container ─────────────────────────────────────────────┐
│ 历史搜索                                [▾ 全部/某项目]      │
│ ┌ 左: grep 检索 ──────────┐ ┌ 右: Agent 问答 ─────────────┐ │
│ │ [搜索框........] [搜索]  │ │ 🤖 Agent 问答               │ │
│ │ 当前只搜: 项目名         │ │ [问题文本域]                │ │
│ │ ┌ 命中卡 ──────────┐    │ │ [让 AI 助理找证据]          │ │
│ │ │ [source] L行号    │    │ │ run? → [status][n条证据]    │ │
│ │ │ 标题  [打开证据]  │    │ │   answer_md (流式刷新)      │ │
│ │ │ 代码段 snippet    │    │ │ 提示: 只基于历史回答        │ │
│ │ └──────────────────┘    │ │                             │ │
│ │ (空: 「还没有命中…」)   │ │                             │ │
│ └────────────────────────┘ └─────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

- **组件**：搜索框（Enter 触发，防输入法 composing）；命中卡（`source_type`/行号/标题/`internalLink` 站内跳证据/snippet）；问答区（问题域 + run 结果 `answer_md` + 引用数）。
- **绑定**：`searchKnowledge({q, project_id, limit})`；`askKnowledge` → 拿 `run_id` → **`getKnowledgeRun(id)` 轮询**（`pollKnowledgeRun`，间隔 1s，上限 120 次，可被 `window.__YQGL_KNOWLEDGE_POLL_*` 覆盖）；URL 同步 `?q&project_id&run_id`，支持分享/回放。
- **SSE**：无（用轮询拉 run；强制引用范式见 [explainability](../02-ai-engine/explainability.md)）。
- **四态**：空=「还没有命中」；加载=「搜索中…/正在查找证据…」；错误=`searchErr`/`askErr` 红框；超时=run 置 failed + 「处理时间过长」（`KnowledgePage.tsx:84`）。
- **取消护栏**：`searchSeqRef`/`runSeqRef`/`askTokenRef`（多入口防重入、防卸载后 setState，`KnowledgePage.tsx:258`）。
- **web↔桌宠**：一致（桌宠有 Knowledge twin，`askTokenRef` 同构）。

---

### P10. 日程 — `CalendarPage`（`web/src/pages/CalendarPage.tsx`）

**布局**：`app-container`。header（标题 + 周/月/列表切换）+ 双栏 `xl:grid-cols-[360px | 1fr]`：左「预约日程」表单，右事件列表（按 view 过滤窗口）。

```
┌─ app-container ─────────────────────────────────────────────┐
│ 日程表                                      [周][月][列表]   │
│ ┌ 左 预约 ────────┐ ┌ 右 事项 ────────────────────────────┐ │
│ │ [标题..]        │ │ 本周/本月/全部事项        [n 件]    │ │
│ │ [截止时间]      │ │ ┌ 事件卡(tone:逾期红/今日黄/正常绿) ┐│ │
│ │ 参与者(勾选列表)│ │ │ 标题  时间·人数            [🗑]    ││ │
│ │ [保存日程]      │ │ │ 描述                              ││ │
│ └─────────────────┘ │ └───────────────────────────────────┘│ │
│                     │ (空: 「这段时间没有日程」)            │ │
└─────────────────────────────────────────────────────────────┘
```

- **绑定**：`listCalendarEvents({start,end})`（±31/+62 天窗口）+ `listUsers`；`createCalendarEvent`（新建后 pin 进可见集）；`deleteCalendarEvent`（需 confirm，`requirement_due` 类型不可删）。
- **SSE**：无。
- **四态**：空=「这段时间没有日程」；加载=（轻）；错误=红框；无权限=N/A。
- **交互流**：周/月/列表切窗口（`visibleEvents` 本地按 view 过滤 + pin 永显）；建/删事件后 `load()`。
- **web↔桌宠**：一致；**桌宠**额外把 DDL 接入本地提醒/托盘（M-NOTIFY，见 [desktop-pet-tauri](./desktop-pet-tauri.md)）。

---

### P11. 通知中心 — `NotificationsPage`（`web/src/pages/NotificationsPage.tsx`）★私有 SSE

**布局**：`app-container max-w-5xl`。header（标题 + 「全部已读」）+ tab（未读/全部）+ 通知列表。

```
┌─ app-container max-w-5xl ───────────────────────────────────┐
│ 通知中心                                    [全部已读]       │
│ [未读] [全部]                                               │
│ ┌ paper-surface (divide-y) ───────────────────────────────┐ │
│ │ [severity] 时间                                          │ │
│ │ 标题(粗)                              [去看看→][已读]    │ │
│ │ 正文(可多行)                                             │ │
│ │ … (空: 「暂时没有通知。系统终于学会闭嘴了。」)           │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

- **绑定**：`listNotifications(status)`、`readNotification(id)`、`readAllNotifications`；`target_url` 站内/站外链。
- **SSE**：本页**列表本身不订流**；**全局 `useNotificationToasts`（`/api/push/stream/me`，`user:{id}` 私有 topic）在壳里挂载一次**，收 `notification.created` 弹 toast（高危→warn 色）。**这是为了让等验收的提交者无需刷新就收到信号**（`useNotificationToasts.ts:14` 注释：补 Web 与桌宠 `/stream/me` 的 parity）。进通知页仍 `load()` 拉全量为真相。
- **四态**：空=「暂时没有通知」；加载=按钮禁用态；错误=红框（标记失败/全部已读失败分别提示）；无权限=`user:{id}` 严格按身份隔离（api-contract §5.3，历史曾因发 `all` 泄漏，已固化）。
- **交互流**：tab 切未读/全部；点「已读」→ `readNotification` → `load()`；「去看看」→ 目标页。
- **web↔桌宠**：Web 用 toast；**桌宠**额外走系统通知/托盘+deep-link（同一 `notification.created` 事件，呈现层不同）。

---

### P12. 网盘选择页 — `DriveHome`（`web/src/pages/DriveHome.tsx`）

**布局**：`narrow-container`。标题 + 项目列表（每项 `Link to /p/:id/drive`）。

```
┌─ narrow-container ──────────────────────────────────────────┐
│ 🖴 项目网盘                                                  │
│ 先选项目，再进对应网盘…                                      │
│ ┌ paper-surface (divide-y) ───────────────────────────────┐ │
│ │ ▣ 项目名 / slug                                       →  │ │
│ │ … (空: 「还没有项目，先建一个项目再用网盘」)             │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

- **绑定**：`listProjects()`。
- **SSE**：无。
- **四态**：空=「还没有项目…」；错误=「项目加载失败」+重试（注释强调错误≠空，`DriveHome.tsx:18`）；加载=（短）；无权限=N/A。
- **web↔桌宠**：一致。

---

### P13. 项目网盘 — `ProjectDrive`（`web/src/pages/ProjectDrive.tsx`）★复杂交互

**布局**：`app-container`。面包屑 header + 项目 tab（需求/网盘/会议）+ 双栏 `lg:grid-cols-[260px | 1fr]`：左文件夹树，右文件区（工具条 + 列表/平铺/树 三视图）+ 底部文件夹留言板 + 预览 `Modal`。

```
┌─ app-container (整页可拖拽上传) ────────────────────────────┐
│ 🖴 项目名 / 面包屑 > 子文件夹 [回收站?]    [回收站][撤回]    │
│ [需求][网盘][会议]                                          │
│ ┌ 左树 260 ──┐ ┌ 右 文件区 ───────────────────────────────┐ │
│ │ 🖴 项目网盘 │ │ [搜索] [新建夹][上传][复制][剪切][粘贴]  │ │
│ │ ▸ 文件夹    │ │        [下载][删除]      [列/平/树]切换  │ │
│ │ ▸ …         │ │ (busy/err/clipboard 状态条)             │ │
│ │             │ │ ┌ 列表: ☐名称|大小|版本|更新|操作 ┐     │ │
│ │             │ │ │ ☐ 📁/📄 名称  …  [👁][⬇][✎]      │     │ │
│ │             │ │ └────────────────────────────────┘     │ │
│ │             │ │ (空: 「拖文件进来，或新建文件夹」)       │ │
│ └────────────┘ └─────────────────────────────────────────┘ │
│ ┌ 文件夹留言板 (LLM 过滤→可生成需求草稿) ──────────────────┐ │
│ │ [留言文本域] [留言]   留言卡: 作者/正文/LLM理由/[去澄清] │ │
│ └─────────────────────────────────────────────────────────┘ │
│ (预览 Modal: PDF/HTML沙盒/代码/markdown + 下载)             │
└─────────────────────────────────────────────────────────────┘
```

- **组件**：左树 `TreeButton`（递归）；三视图（list 表格 / grid 卡 / tree 扁平）；工具条（新建夹/上传/复制/剪切/粘贴/下载/删除/恢复/视图切换）；状态条（busy spinner / clipboard / err 可关）；留言板（文本域 + 留言卡 + 「去澄清」深链）；预览 `Modal`（`@yqgl/shared`）。
- **绑定**：`listDrive({parent_id,search,trash})` + `driveTree` + `listProjects`；分片上传 `initDriveUpload`(冲突 prompt replace/rename/cancel)→`uploadDriveChunk`→`finalizeDriveUpload`（5MB/片）；`createDriveFolder`/`patchDriveItem`(改名)/`pasteDriveItems`/`bulkDeleteDriveItems`/`bulkRestoreDriveItems`/`undoDrive`/`bulkDownloadDrive`/`previewDriveItem`/`driveDownloadUrl`；留言 `listDriveComments`/`addDriveComment`（过 LLM，可产草稿，状态 `draft_created`/`review_failed`/已入板）。
- **SSE**：现状无；**WorkHub 建议**订 `drive.changed`/`drive.comment`（api-contract §5.2）让多人协作时文件树/留言实时刷。
- **四态**：空=「这里还没有文件」/树空/留言空各一句；加载=`busy` 状态条（「上传 x / 打包下载 / 复制中…」）；错误=可关红 pill；无权限=trash 态隐藏改名/删除，后端校验。
- **键盘交互**：Ctrl+C/X/V（复制/剪切/粘贴）、Ctrl+Z（撤回）、Delete（删/回收站态恢复）、F2（改名）——`ProjectDrive.tsx:446`，且在输入框/弹层内禁用。整页拖拽上传（`onDrop`）。
- **取消护栏**：`reloadTokenRef`/`uploadTokenRef`/`busyActionTokenRef`/`commentActionTokenRef` + `viewKey`（`projectId|parentId|search|trash`）确保视图切换后旧动作不落（`ProjectDrive.tsx:118-174`）。
- **web↔桌宠**：核心一致；**桌宠**额外有「**本地双向同步开关**」（现状单向占位 `sync.rs:227`，WorkHub 补齐双向，留言板已有「同步：客户端本地开关控制」pill 占位，`ProjectDrive.tsx:768`）。回收站/版本/撤销的软删除范式见 [data-model](../01-architecture/data-model.md)。

---

### P14. 项目会议 — `ProjectMeetings`（`web/src/pages/ProjectMeetings.tsx`）

**布局**：`app-container`。header + 项目 tab + 双栏 `xl:grid-cols-[360px | 1fr]`：左（导入卡 + 会议列表），右（会议详情：状态/进度 + ASR 转写 + 纪要 + 需求评估洞察）。

```
┌─ app-container ─────────────────────────────────────────────┐
│ 🎙 项目名 会议要点              [刷新]                       │
│ [需求][网盘][会议]                                          │
│ ┌ 左 360 ──────────┐ ┌ 右 详情 ─────────────────────────┐ │
│ │ 导入会议录音       │ │ 会议标题 (处理中: spinner+进度%) │ │
│ │ [标题][拖/选文件]  │ │  失败: 红框                      │ │
│ │ ── 会议列表 ──     │ │ ┌ ASR转写 ┐ ┌ 会议纪要 ┐         │ │
│ │ ▸ 标题 [已生成/失败/处理中] │ │ (pre) │ │ (pre)   │       │ │
│ │   时间·上传人      │ │ ── 需求评估(洞察) ──             │ │
│ │ (空:「还没有会议」)│ │ [新增需求/变更/普通] [状态]      │ │
│ │                    │ │  标题/描述/LLM理由               │ │
│ │                    │ │  [去澄清][进入评估/重试][忽略]   │ │
│ └────────────────────┘ └──────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

- **组件**：导入卡（标题输入 + 拖拽/选文件，支持 audio + .txt/.md fixture）；会议列表（状态 pill）；详情区（进度条 + 转写 pre + 纪要 pre）；洞察卡（kind/status + 确认/忽略/去澄清，含创建中/重试态机）。
- **绑定**：`listMeetings` + `listProjects`；分片上传 `initMeetingUpload`→`uploadMeetingChunk`→`finalizeMeetingUpload`；`getMeeting`(刷新单条)；**`getJob(job_id)` 1.5s 轮询**（`active.status==='processing'` 时，`ProjectMeetings.tsx:118`）；`confirmMeetingInsight`/`dismissMeetingInsight`（洞察→需求草稿，人确认）。
- **SSE**：本页用 **job 轮询**而非 SSE（`meeting.ready`/`meeting.insight_confirmed` 事件可被全局看板感知，但本页靠轮询拉 job 进度）。
- **四态**：空=「还没有会议录音」/「选一个会议」/「暂时没有识别出…」；加载=进度条+`job.message`+百分比；错误=失败红框（`job.error`）；无权限=N/A。
- **交互流**：上传 → 轮询进度 → ready → 看转写/纪要 → 洞察「进入评估」`confirm` → 生成需求草稿 → 「去澄清」`/r/:id/clarify`。
- **取消护栏**：`loadTokenRef`/`uploadTokenRef`/`actionTokenRef`/`selectionTokenRef`/`activeMeetingRef`（快速切项目/切会议防串，`ProjectMeetings.tsx:36-41`）。
- **web↔桌宠**：一致（会议是派活方/记录方动作）。

---

### W1. 审批中心 — `ApprovalsCenter`（`/approvals`）**[WorkHub 新增]**

> 落地 api-contract §2.8 + [review-and-approval](../03-collaboration/review-and-approval.md)。审批=**阻塞原语**：Agent 在「该决策那一刻」`ask` 人，阻塞至回复；对客户端表现为一条 `permission.ask` 事件 + 一个待响应资源。

**布局**：`app-container max-w-5xl`，结构对齐 `NotificationsPage`（tab：待我批/全部）+ 审批卡列表。

```
┌─ app-container max-w-5xl ───────────────────────────────────┐
│ 审批                                                        │
│ [待我批] [全部]                                            │
│ ┌ 审批卡 ──────────────────────────────────────────────┐   │
│ │ [来源工单 CODE] 倒计时(SLA)                            │   │
│ │ 「AI 想做 <人话动作摘要>，要点头才继续」              │   │
│ │ (拒绝输入: 理由——会回灌给 AI 续做)                    │   │
│ │ [允许] [允许·以后这类不用再问我] [打回(说原因)] [转给别人] │   │
│ └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

- **绑定**：`GET /approvals?pending=true`、`POST /approvals/{id}/respond {decision, reason_md?, remember:"once"|"always"}`、`POST /approvals/{id}/delegate`。
- **SSE**：订 **`user:{id}`** 收 `permission.ask`（+ 全局 toast 提示），收到即插入/刷新列表；回复后阻塞解除（Agent 续跑）。
- **四态**：空=「没有等你点头的事」；加载/错误=同 NotificationsPage；无权限=路由层只发给被路由审批人（审批路由是护城河，opencode 无）。
- **去黑话**：全程人话——「等你点头才继续」「以后这类不用再问我」「打回（说原因）」（glossary §3.2/§6）；**绝不**出现 `permission`/`policy`/`allow/deny` 英文。
- **web↔桌宠**：**Web 主场**（审批是浏览器可达动作，不需设备门）；桌宠以系统通知+deep-link 补强同一资源。

---

### W2. 提议详情 — `ProposalDetail`（`/proposals/:id`）**[WorkHub 新增]**

> 去黑话 PR 的详情页。落地 api-contract §2.5 + [branch-proposal-merge](../03-collaboration/branch-proposal-merge.md)。脊梁骨是现有 `Delivery`+`RevisionRequest`（`DeliverablesTab` 的演进），心智映射见 [glossary §2](../00-overview/glossary-dejargon.md)：proposal=「提交给负责人确认」、approve=「采纳/汇入正式版」、reject=「打回（说原因）」。

**布局**：`narrow-container max-w-5xl`。header（关联工单/提议人/把握程度三档语气）+ 改动摘要 + 验收命中 + 审批动作；冲突时显「撞车了，AI 给了方案」择一。

```
┌─ narrow-container max-w-5xl ────────────────────────────────┐
│ ← 工单 CODE                                                 │
│ 「<提议人>提交了一版，等你确认」  [把握: 我大致有谱…]        │
│ ┌ 这次做的内容(改动摘要 + 交付物预览/下载) ┐                │
│ ┌ 验收标准命中: ☑/☐ 清单 ┐                                  │
│ (冲突? 「和别人的改动撞车了——AI 拟了方案，选一个」[方案A/B]) │
│ [采纳(汇入正式版)]  [打回(必填原因)]                        │
└─────────────────────────────────────────────────────────────┘
```

- **绑定**：`GET /proposals/{id}`（含 diff 摘要 + ConfidenceRecord 引用）、`POST /proposals/{id}/review {decision, reason_md?}`、`POST /proposals/{id}/merge`、`GET /workitems/{id}/conflicts`。**当前 R1.10-R1.13 TS-first 纵切**：`GET /workitems/{id}/conflicts` 返回的 deterministic `keep_current / accept_incoming` 两选一会在 Proposal 页面与 merge 409 notice 中渲染为可点击卡片；按钮的 `request_json` 会原样传给 `mergeProposal()`；后台已将 attempt、candidate 与 chosen option 落库，`GET /api/agent-runs/:id/replay` 已读取 `merge_attempts + merge_proposals` 并在 replay 页面展示历史。**打回必带理由**（空理由 400），理由**回灌**给 AI 同分支续做（FR-ESC-003）。
- **SSE**：订 **`workitem:{id}`** 收 `proposal.opened/reviewed/merged`、`conflict.detected`；高置信低风险可策略自动合并（用户视角=「AI 做完了，已采纳」）。
- **四态**：空/加载/错误=同详情页范式；无权限=仅 reviewer（负责人）可通过/打回。
- **web↔桌宠**：**Web 主场**（审批/采纳是派活方动作）。本页可作为 `RequirementDetail` 的「提议」tab 内嵌，亦可独立深链。

---

## 5. 导航流（关键跳转图）

```
登录门 ──→ / (项目列表)
  │           ├─新建项目→ refresh
  │           └─项目→ /p/:id (工作台)
  │                     ├─ tab 网盘 → /p/:id/drive ──→ 留言生成草稿 → /r/:id/clarify
  │                     ├─ tab 会议 → /p/:id/meetings ─ 洞察确认 → /r/:id/clarify
  │                     ├─ 提需求 → /p/:id/new (5步) → /r/:id/clarify
  │                     └─ 需求 → /r/:id (详情)
  │                                 ├─(draft/clarifying/summary_ready) 自动跳→ /r/:id/clarify
  │                                 ├─ 澄清完投递(autoProcess|submit) → /r/:id
  │                                 ├─[Web] 接单人→「在桌面客户端继续」 yqgl://r/:id
  │                                 └─[WorkHub] 提议 tab / 升级呈现 → /proposals/:id
  ├─ 看板▼ → /dashboard(派活看板) ─卡→ /r/:id
  │         → /planning ─需求→ /r/:id
  │         → /health ─→ /p/:id | /planning | /knowledge
  │         → /knowledge ─命中「打开证据」→ 站内 /r、/p/:id/drive…
  ├─ /calendar  ├─ /notifications ─「去看看」→ target_url
  └─[WorkHub] /approvals ─→ 关联工单 / /proposals/:id
全局：⌘K 命令面板跳任意主页面；ClientDownloadBanner 引导装桌宠端接活。
```

**跨页一致规则**：
- 横切页（看板/排期/健康/知识）都接受 `?project_id=` 回到单项目上下文。
- 任何「这个活还没澄清完」的入口都收敛到 `/r/:id/clarify`（详情页自动回跳是兜底）。
- 接活/干活类动作在 Web 一律降级为「在桌面客户端继续」深链（`yqgl://`），不在 Web 完成（D-WEB-1）。

---

## 6. 响应式策略

现有代码用 Tailwind 断点（`sm 640 / md 768 / lg 1024 / xl 1280 / 2xl 1536`），最大宽 `max-w-[1760px]`（顶栏，`App.tsx:198`）。规律：

| 区域 | 移动（<sm） | 平板（md/lg） | 桌面（xl/2xl） | 锚点 |
|---|---|---|---|---|
| 顶栏 | 主导航图标紧凑、搜索文案隐藏、昵称 `max-w-[48vw]` 截断 | 渐显文案 | 全展开 | `App.tsx:198-228` |
| 派活看板 | 1 列 | `md:2 / xl:3` | `2xl:5`（`repeat(5,minmax(260px,1fr))`） | `Dashboard.tsx:175` |
| 澄清/网盘/会议/知识/日程 | 单列堆叠（侧栏在上） | — | `lg/xl:[固定侧栏 + 1fr]` 双栏 | `Clarify.tsx:275`、`ProjectDrive.tsx:538`、`ProjectMeetings.tsx:267`、`KnowledgePage.tsx:315`、`CalendarPage.tsx:171` |
| 需求详情 header/动作 | 纵向堆叠 | — | `lg:flex-row` 横排，tab nav 横向可滚（`scrollbar-thin-warm overflow-x-auto`） | `RequirementDetail.tsx:316/450` |
| 卡网格（排期/健康） | 1 列 | — | `xl/2xl:2` | `PlanningPage.tsx:106`、`HealthPage.tsx:100` |
| 列表行 / 工具条 | `flex-col` 堆叠、按钮 `w-full` | `sm:flex-row` | — | `Home.tsx:243`、`ProjectDrive.tsx:555` |

**通用手法**：`flex-col gap → sm:flex-row`、按钮移动端 `w-full sm:w-auto`、长文本 `truncate`/`line-clamp`/`break-words`、横向滚动区 `scrollbar-thin-warm`、表格 `min-w-[760px]` + 外层 `overflow-auto`（网盘列表）。**无独立移动端布局**——同一组件响应式收拢。

---

## 7. web↔桌宠差异（汇总）

> 同一 `@yqgl/shared` 组件 + API client，靠 `isDesktopRuntime()`（`shared/src/api/client.ts:8`：`localStorage.yqgl_runtime==='desktop' && window.__TAURI_INTERNALS__`）分叉。桌宠端详见 [`./desktop-pet-tauri.md`](./desktop-pet-tauri.md)。

| 维度 | C-WEB（浏览器） | C-PET（桌宠） | 锚点 |
|---|---|---|---|
| **接活/干活/同步** | 禁止——显「在桌面客户端继续」深链 | 允许（持设备令牌过门） | `RequirementDetail.tsx:204/390`、auth 设备门 api-contract §3.2 |
| **「我的工作区」tab** | 隐藏（`desktopOnly`） | 显示且本人可编辑 | `RequirementDetail.tsx:46/513` |
| **个人清单拆解（worker）** | 显「在本地工作台生成」 | 可触发 | `RequirementDetail.tsx:598/683` |
| **看板语义** | 「派活看板」 | 「本地工作台」（聚焦我的工单雏形） | `Dashboard.tsx:149` |
| **鉴权投递** | cookie（`yqgl_id`） | cookie + `X-YQGL-Client-Token`（`withCommon`） | `client.ts:25` |
| **SSE fetch** | 原生同源 `fetch` | `clientFetch`（带 base URL + 令牌，origin 是 `tauri://localhost`） | `useReqStream.ts:31`、`useChatStream.ts:18` |
| **通知呈现** | toast（`/stream/me`） | 系统通知/托盘 + deep-link（同一 `notification.created`） | `useNotificationToasts.ts` + tray/notify.rs |
| **本地双向同步** | 无（云端文件视图） | 有（spec_watch/sync，现状单向→WorkHub 双向） | `ProjectDrive.tsx:768` 占位 |
| **入口形态** | 顶栏导航 | 桌宠常驻 + 托盘 + deep-link | system-architecture §1 |

---

## 8. 与其他文档的边界（避免重复）

| 想找 | 去哪 |
|---|---|
| 路由组逐条、事件类型全清单、鉴权依赖、错误码 | [`../01-architecture/api-contract.md`](../01-architecture/api-contract.md) |
| 实体字段、状态机全转移、软删除/审计 | [`../01-architecture/data-model.md`](../01-architecture/data-model.md) |
| 进程边界、事件总线 topic 拓扑、部署 | [`../01-architecture/system-architecture.md`](../01-architecture/system-architecture.md) |
| 桌宠 Rust 能力（托盘/通知/deep-link/spec_watch/双向同步）、webview↔Rust 边界 | [`./desktop-pet-tauri.md`](./desktop-pet-tauri.md) |
| 设计 tokens、共享组件库、API client、共享 hooks | [`./shared-ui-kit.md`](./shared-ui-kit.md) |
| 审批阻塞原语、路由、SLA、委派、「永远允许」学习 | [`../03-collaboration/review-and-approval.md`](../03-collaboration/review-and-approval.md) |
| 分支/提议/合并数据流、冲突 AI 调解 | [`../03-collaboration/branch-proposal-merge.md`](../03-collaboration/branch-proposal-merge.md) |
| 各看板指标定义（自治率/升级精准度/成本） | [`../04-modules/dashboards-and-metrics.md`](../04-modules/dashboards-and-metrics.md) |
| 状态枚举→人话标签权威映射、置信度三档语气、去黑话 | [`../00-overview/glossary-dejargon.md`](../00-overview/glossary-dejargon.md) |

---

## 9. 实现架构路线（WorkHub 施工版）

### 9.1 Web 端角色边界

C-WEB 继续保持「瘦视图」：

- 不接活、不交付、不做本地同步。
- 负责项目、资料、审批、提议、管理和完整检索兜底。
- 复杂操作尽量转成「需要你决定的一件事」。
- 与 Cuu 的关系：Web 提供完整页面，Cuu 负责轻入口、提醒、证据气泡和选项澄清。

### 9.2 页面施工优先级

| 优先级 | 页面/能力 | 施工目标 | 概念图 |
|---|---|---|---|
| P1 | 项目工作台 | 由项目上下文 + Needs attention + AI background rows 构成，替代默认看板 | `web-project-attention-workspace.png` |
| P1 | 选项优先提需求 | 让小白用选项完成 80% 输入，文本输入折叠为兜底 | `web-option-first-intake-wizard.png` |
| P1 | 选项优先澄清 | 把聊天墙改为 QuestionCard + OptionCard + progress stack | `cuu-option-first-clarify.png` |
| P2 | 审批中心 / 提议详情 | 支持任意交付物变更包、证据、风险、回滚、打回 | `web-approval-center.png` / `web-deliverable-change-request.png` |
| P2 | 会议洞察 | 会议 → 洞察 → 需求草稿，AI 不直接改正式态 | `web-meeting-insight-to-draft.png` |
| P2 | 网盘预览 | 文件预览 + 评论 + Cuu 变更草稿提示 | `web-drive-preview-change-draft.png` |
| P3 | 运营/健康/成本 | 作为负责人兜底视图，不做默认首页 | `web-operations-pages-atlas.png` |

### 9.3 组件拆分建议

新增页面不要直接在 page 里堆 JSX，应先沉到 C-UIKIT 或本端 feature component：

```text
web/src/pages/
  ProjectView.tsx
  NewRequirement.tsx
  Clarify.tsx
  ApprovalsCenter.tsx
  ProposalDetail.tsx

web/src/features/
  attention/
    NeedsAttentionStack.tsx
    BackgroundWorkRows.tsx
  intake/
    OptionFirstWizard.tsx
    IntakeSummaryPanel.tsx
  proposal/
    ProposalSummaryCard.tsx
    DeliverableFileList.tsx
    EvidencePanel.tsx
    RollbackPanel.tsx
  meetings/
    MeetingInsightDraftPanel.tsx
  drive/
    ChangeDraftSuggestion.tsx

shared/src/components/
  OneThingCard
  ApprovalCard
  OptionCard
  EvidenceChip
  RiskBadge
  RollbackPanel
```

### 9.4 数据与事件流

- 页面加载仍以 REST 为真相：`GET project/workitem/proposal/drive/meeting`。
- SSE 只作为增量提示：收到 `proposal.opened`、`permission.ask`、`meeting.insight.ready`、`drive.changed` 后重拉对应 REST。
- Cuu 气泡与 Web 页面共享同一事件来源，但显示不同：
  - Web：完整页面、完整列表、完整审核记录。
  - Cuu：一张轻卡、一个问题、三个选项、少量证据。

### 9.5 选项优先澄清模型

提需求和澄清统一使用 `QuestionCard` 数据结构：

```ts
type ClarifyQuestion = {
  id: string;
  title: string;
  reason?: string;
  options: Array<{
    id: string;
    label: string;
    description?: string;
    recommended?: boolean;
    payload?: unknown;
  }>;
  other?: { enabled: boolean; placeholder: string };
  progress: Array<{ key: string; label: string; state: "done" | "active" | "pending" }>;
};
```

前端只渲染选项，不自己推理；AI/daemon 负责生成问题和推荐项。用户选择后提交 answer，daemon 返回下一题或 summary。

### 9.6 项目检索归属

知识检索在 Web 仍保留完整页，但默认用户入口应在 Cuu：

- Cuu chips：找相关文件 / 总结上次会议 / 这次改了什么。
- Web 知识页：完整搜索、筛选、索引状态、历史 run。
- 两者共用 `EvidencePanel`，且必须显示来源、日期、可打开链接。

### 9.7 验收标准

- 小白能不打字完成提需求和澄清主路径。
- Web 默认页不出现多列 Kanban。
- 每个 AI 建议都能看到证据或说明「没有找到证据」。
- 交付物变更申请能覆盖 `.docx/.pptx/.xlsx/image/folder`。
- 浏览器端看到接活/同步/交付动作时，只能引导到 Rust 客户端。

*本篇定位：C-WEB 页面规划的单一来源。接口级 → `api-contract.md`；桌宠端 → `desktop-pet-tauri.md`；组件级 → `shared-ui-kit.md`。所有页面/绑定均扎根 `web/src/*` 与 `shared/src/*` 现有真实代码。*
