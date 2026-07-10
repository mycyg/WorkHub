# WorkHub 普通用户视角系统性审查报告

> 审查日期：2026-07-10  
> 审查分支：`codex/r9-stage-b-rework`  
> 审查范围：功能闭环、页面 UI/UX 一致性、设计语言、操作便利性、可访问性、失败与恢复语义  
> 审查方式：只读代码审查 + 本地 Pilot 真实页面走查 + 390px 移动宽度检查 + 聚焦测试  
> 本轮结论：未发现 P0；确认多项会影响普通用户信任和任务正确性的 P1 问题

---

## 1. 执行摘要

WorkHub 已经具备较完整的产品表面：项目、提需求、工作项、任务计划、AI 执行、审批、正式采纳、网盘、会议、通知、日程、成本、知识、技能和设置均有正式入口。登录后的 Ready 页面也形成了相对稳定的卡片、指标、状态和中英文设计语言。

当前主要风险不在“页面不好看”，而在以下信任链断点：

1. 新任务可能被同一 Pilot 项目中的旧文件带偏，AI 澄清内容与用户刚输入的需求无关。
2. 审批队列切换事项后，标题、详情、动作目标、`aria-current` 和打回理由可能指向不同事项。
3. 部分下载、预览和证据入口会被 Web 动作代理拦截，但没有真正执行请求。
4. 提议冲突加载失败会被呈现成“没有冲突”，部分检查和证据还会静默截断。
5. 执行中的操作被提示为“暂不可用”；任一挂起请求又可能锁死整页所有 API 动作。
6. 语言切换会无提示丢失未提交草稿。
7. 通知静音偏好存在异步水合竞态，可能覆盖用户原有设置。
8. 登出失败后仍显示登录页，服务端会话可能继续有效。

因此，当前版本适合继续内部验证，但不建议在修复 P1 信任问题前扩大普通用户试点。

---

## 2. 审查边界与方法

### 2.1 代码与页面范围

本轮覆盖当前正式 Web 路由及 Desktop Spotlight/Cuu 关键入口，包括：

- 身份与首启：Onboarding、语言切换、登出。
- 工作入口：总览、项目列表、项目主页、提需求、工作项。
- AI 执行：任务计划、Agent Run、Replay、军团看板。
- 决策链：审批中心、提议审阅、冲突处理、正式采纳。
- 内容链：网盘、文件版本、会议洞察、知识检索。
- 运营链：通知、日程、项目健康、成本、技能、设置。
- Desktop：Spotlight 初始状态、能力列表、Intake、审批、Drive、仪表盘和 Cuu pet。

当前 Web 正式注册表共有 18 个产品路由。主要入口位于：

- `apps/web/src/routes.ts`
- `apps/web/src/browser.ts`
- `packages/ui/src/gold-path/product-shell.ts`
- `packages/ui/src/gold-path/route-components.ts`
- `apps/desktop-webview/src/spotlight/`
- `apps/api/src/services/`

### 2.2 真实用户走查

本轮启动本地 Pilot Docker 环境，并以普通用户 `ReviewTester-0710` 走查：

- Onboarding 与中英文切换。
- 总览、项目、提需求、审批、会议、日程、设置。
- 真实新任务创建和 AI 澄清。
- 无权限 Replay 状态。
- 390 × 844 移动宽度导航与“更多”菜单。
- 未提交文本在语言切换前后的保留情况。

为验证真实 Intake，创建了本地测试会话：

`66e22124-d58e-4c0e-af22-6b55916257f3`

用户输入为：

> Review 验证：检查异步动作状态提示，不继续创建正式任务。

系统随后展示的澄清问题却是：

> Day 1 Pilot 反馈摘要缺少原始操作记录

并引用旧项目文件：

`AI Deliverables/PILOTPROJECT-002/outputs/day-1-pilot-feedback-digest.md`

这构成了本轮最重要的真实复现证据。

### 2.3 严重性定义

| 等级 | 定义 |
|---|---|
| P0 | 造成大范围不可用、不可逆数据损坏或明确安全事故，必须立即阻断发布 |
| P1 | 可能导致错误任务、误批、状态误导、用户设置丢失，或阻断核心闭环 |
| P2 | 明显降低可发现性、一致性、效率或无障碍体验，但通常存在替代路径 |
| P3 | 设计债务、文档漂移和次级打磨项 |

本轮没有确认 P0。

---

## 3. P1：需要优先修复的问题

### P1-1 新任务被旧项目文件带偏，且首轮澄清不是真正的“选项优先”

#### 用户场景

普通用户点击全局“提需求”，输入一个全新的任务，希望系统围绕这句话澄清范围。

#### 实际行为

- `/intake` 固定创建或复用 slug 为 `pilot-project` 的共享 Pilot 项目。
- 系统读取该项目内最多 12 个文件作为澄清上下文。
- 当用户没有点名文件时，相关性排序仍会返回旧文件。
- LLM 输出只要命中某个项目文件或用户意图之一就可通过校验；不要求同时与当前意图相关。
- 首轮问题固定为 `input_mode: "long_text"`、`options: []`、`recommended_option_ids: []`。

真实走查中，新任务被旧的 Day 1 Pilot 文件完全带偏。

#### 根因证据

- `packages/ui/src/gold-path/route-components.ts:1456-1476`：全局入口固定复用 Pilot 项目。
- `apps/api/src/services/work-items.ts:735-769`：加载并排序项目文件，最多取 12 个。
- `apps/api/src/services/work-items.ts:816-840`：Prompt 同时强调用户需求和项目文件。
- `apps/api/src/services/work-items.ts:860-871`：命中文件或意图任一即可通过。
- `apps/api/src/services/work-items.ts:1579-1593`：首轮澄清固定为空选项长文本。
- `docs/workhub/05-clients/page-concepts.md:298`：概念要求首屏 Option Cards，文本输入只作为折叠兜底。

#### 用户影响

- 用户不知道系统正在处理另一个历史任务。
- 错误上下文会继续进入规划、执行和交付物，直到后续人工发现。
- “先选方向”的产品承诺与真实交互不一致。

#### 建议

1. 全局 Intake 必须先显式选择项目，或创建独立项目；不得静默复用共享 Pilot。
2. 只有用户点名文件，或相关性超过明确门槛时，才把文件送入澄清上下文。
3. Grounding 校验必须要求回答与当前用户意图相关；引用文件不能替代意图命中。
4. LLM 澄清契约应生成真实 `options[]` 和推荐项；自由文本保持补充入口。
5. 增加真实回归用例：项目含旧文件、新请求与旧文件无关时，澄清不得引用旧文件。

---

### P1-2 审批切换后，页面上下文与动作目标可能错位

#### 用户场景

审批中心存在事项 A 和 B。用户查看 A、输入打回理由，再切换到 B 并执行动作。

#### 实际行为

- 初始 `h1`、原因和操作区由第一条 `primary` 事项生成。
- 切换行只更新选中样式、详情显隐和 approve/deny URL。
- `h1`、顶部原因、操作说明和 `aria-current` 没有同步更新。
- 右侧只有一个共享打回 textarea，切换事项时不会清空或分事项保存。

结果可能同时出现：A 的标题、B 的详情、指向 B 的按钮和 A 的打回理由。

#### 根因证据

- `packages/ui/src/gold-path/route-components.ts:1801-1886`
- `apps/web/src/browser.ts:459-470`
- `apps/web/src/browser.ts:683-707`
- `apps/web/src/browser.ts:877-900`

#### 用户影响

- 误批或误打回。
- 错误理由进入 B 的审计记录和 AI 纠偏上下文。
- 读屏用户仍会被告知 A 是当前事项。

#### 建议

以唯一 `selectedApprovalId` 作为审批页状态源，标题、详情、动作、理由、`aria-current` 和焦点必须从同一个选中对象派生。切换事项时应明确清空草稿，或按事项保存并显示草稿归属。

---

### P1-3 下载、预览和证据链接被拦截后没有真正执行

#### 用户场景

- 在工作项中下载已采纳交付物。
- 在提议中打开变更预览。
- 在知识结果中打开工作项证据。

#### 实际行为

所有 `/api/*` 链接都会被统一识别成 `api-action` 并 `preventDefault()`。但未注册的资源链接最终只显示 pending，没有发起原生导航或下载请求。

Agent manifest 默认生成的 `/api/agent/outputs/download` 和 `/api/agent/outputs/preview` 在生产 API 中也没有对应路由；即使绕过前端拦截仍无法落地。

#### 根因证据

- `packages/ui/src/gold-path/app-shell.ts:155-170`
- `apps/web/src/browser.ts:932-998`
- `apps/web/src/browser.ts:1608-1627`
- `packages/ui/src/gold-path/route-components.ts:2339-2372`
- `packages/ui/src/gold-path/route-components.ts:4072-4079`
- `packages/agent/src/deliverables/manifest.ts:65-75`
- `apps/api/src/app.ts:204-227`

#### 建议

- 资源链接和 mutation action 使用不同的显式类型，不应只凭 `/api/` 前缀判断。
- 所有下载链接统一使用已存在的 `data-native-resource-link` 或专门 resource handler。
- Manifest 不得生成未注册路由；生产 runner 必须提供真实 preview/download URL。
- 增加工作项下载、Proposal 预览、Knowledge 证据三个浏览器级回归测试。

---

### P1-4 提议冲突失败被伪装成“没有冲突”，决策依据还会静默截断

#### 实际行为

- Proposal 主数据加载成功后，冲突接口除 `not_identified` 外的异常都被捕获并替换为 `[]`。
- Manifest checks 只显示前三条。
- Evidence 只显示前五条。
- Proposal 摘要在 320 字后直接截断。
- 页面没有稳定的“另有 N 条”或“冲突信息加载失败”提示。

#### 根因证据

- `apps/web/src/routes.ts:1149-1164`
- `packages/ui/src/gold-path/route-components.ts:2482-2486`
- `packages/ui/src/gold-path/route-components.ts:2537-2552`
- `packages/ui/src/gold-path/route-components.ts:1919-1931`
- `packages/agent/src/deliverables/manifest.ts:382-410`

#### 用户影响

审阅者可能在信息不完整时认为提议已经没有冲突、所有检查均通过，从而做出错误决定。

#### 建议

- 冲突请求失败必须进入显式 partial/error 状态，禁止降级为零冲突。
- 所有截断都显示总数、已展示数和“查看全部”。
- 关键安全检查不得默认折叠到不可见区域。

---

### P1-5 执行中的动作被提示为“暂不可用”，挂起请求会锁死整页

#### 实际行为

上传、审批、打回、开始 Intake、创建任务计划和启动 Agent Run 等真实请求执行时，共用的 pending 文案却是：

> 这个功能还在开发中，暂时不可用。

Web 创建 API Client 时没有传入已经实现的 `requestTimeoutMs`；同时所有 API 动作共享一个 `llmActionBusy`，只有请求返回后的 `finally` 才释放。

#### 根因证据

- `packages/ui/src/gold-path/i18n.ts:404-418`
- `packages/web-runtime/src/notice.ts:190-199`
- `apps/web/src/browser.ts:988-998`
- `apps/web/src/browser.ts:1021-1068`
- `apps/web/src/browser.ts:2149-2151`
- `packages/api-client/src/client.ts:233-300`

#### 用户影响

- 用户会误以为功能没有实现，重复点击或离开页面。
- 任一永不返回的请求可让后续所有动作持续失效，直到刷新页面。

#### 建议

将状态拆成 `in_progress`、`unsupported`、`queued`、`retryable_error`，分别使用真实文案。Web 必须启用请求超时，动作锁应至少按 action/target 分区，而不是整页全局共享。

---

### P1-6 切换语言会无提示丢失未提交草稿

#### 真实复现

在 `/intake` 输入：

`未提交草稿 REVIEW-0710-LANG`

点击 EN 后页面完整 reload，文本框为空。切回中文也无法恢复。

#### 根因证据

- `apps/web/src/browser.ts:399-418`：语言切换直接保存偏好并 reload。
- `apps/web/src/browser.ts:1819-1854`：dirty guard 只覆盖导航和 popstate。

#### 建议

- 语言切换纳入统一 dirty guard。
- 优先使用无刷新 locale rerender。
- 若必须 reload，先把 Intake、审批理由、评论和冲突编辑草稿持久化到 session storage。

---

### P1-7 通知静音偏好可能覆盖已有设置

#### 实际行为

- SSR 首先渲染所有未勾选 checkbox。
- 页面随后异步 GET 当前偏好。
- GET 失败被静默吞掉。
- 任一 change 都会把当前 DOM 中的勾选项作为完整数组 PUT。
- 服务端 PUT 是整体替换而非增量修改。

#### 根因证据

- `packages/ui/src/gold-path/route-components.ts:3154-3166`
- `apps/web/src/browser.ts:1926-1964`
- `apps/desktop-webview/src/spotlight/views/dashboards.ts:608-646`
- `apps/api/src/services/notifications.ts:456-474`

#### 用户影响

用户只想新增静音 C，却可能无提示取消已经保存的 A/B，之后重新收到原本不想接收的通知。

#### 建议

偏好加载完成前禁用控件；加载失败显示错误和重试。保存应使用版本号或 PATCH 增量语义，并对并发写入做序列化。

---

### P1-8 登出失败仍显示“已登出”

#### 实际行为

登出请求的网络失败或 5xx 被捕获后，页面仍无条件显示 Onboarding。客户端视觉状态被清除，但服务端 Cookie 可能继续有效；刷新后用户可能重新进入。

#### 根因证据

- `apps/web/src/browser.ts:670-680`
- `apps/web/src/browser.ts:2034-2063`

#### 建议

登出失败必须显示显式错误，并说明服务端会话可能仍有效；不要把 Onboarding 当成成功证据。共享设备场景应提供清除本地凭证和重试服务端撤销的明确动作。

---

## 4. P2：功能闭环与易用性问题

### P2-1 一级导航过载，且缺少角色化信息架构

普通用户桌面宽度下直接看到 14 个一级入口：总览、项目、提需求、审批、网盘、会议、通知、日程、项目健康、成本、军团、知识、技能、设置。

问题包括：

- 工作入口、团队运营和管理员诊断混在同一层。
- ReviewTester 普通用户也看到成本、军团、技能和技术设置。
- 总览的“打开网盘”“新建任务”会静默指向 `projectList[0]`，按钮没有显示目标项目名。
- 全局 Intake 又固定落到 Pilot 项目，形成两套隐式项目选择规则。

证据：

- `apps/web/src/routes.ts:488-535`
- `packages/ui/src/gold-path/product-shell.ts:401-412`
- `packages/ui/src/gold-path/route-components.ts:1242-1275`

建议按“工作／团队／管理”分组，并根据角色和近期任务渐进披露。任何跨项目动作都必须显示目标项目或先要求用户选择。

---

### P2-2 会议页面没有会议接入入口

会议页面可以查看会议、确认或忽略洞察、把洞察转成草稿，但空态没有：

- 创建会议。
- 上传录音。
- 导入转写文本。
- 接入外部会议链接。

API 也只有洞察处理和草稿转提议，没有会议创建或导入路由。

证据：

- `packages/ui/src/gold-path/route-components.ts:2923-3045`
- `apps/api/src/routes/meetings.ts:54-112`

对普通用户而言，这是一个无法自助产生数据的只读孤岛。

---

### P2-3 日程页面无法浏览其他日期

路由已经支持 `?date=` 和 `?view=day|week`，但页面没有上一周、下一周、今天、日视图或周视图控件。用户只能修改 URL 才能查看其他时间。

证据：

- `apps/web/src/routes.ts:1226-1238`
- `packages/ui/src/gold-path/route-components.ts:3340-3372`

---

### P2-4 设置页主要是系统诊断，不是用户设置

页面大部分内容是：

- runtime environment。
- worker 数量。
- Redis、数据库状态。
- AI provider、model、key/base URL 状态。
- 本地执行边界。

普通用户可修改的内容很少，语言设置又位于顶栏。建议拆成“个人设置”和仅管理员可见的“系统诊断”。

证据：`packages/ui/src/gold-path/route-components.ts:4110-4183`。

---

### P2-5 委派能力在所有用户界面中被隐藏

PRD、API 和 typed client 都支持审批/升级委派，但 Web 和 Desktop 因没有选人器而直接过滤 `/delegate` 动作。

证据：

- `packages/ui/src/gold-path/route-components.ts:942-950`
- `packages/api-client/src/client.ts:430-455`
- `docs/prd/2026-06-04-workhub-prd.md:245-255`

这会阻断请假、轮值、负责人离线和 SLA 转交场景。

---

### P2-6 Web 非 Ready 状态会丢失整个产品壳

登录后的 Ready 页面使用顶栏、左导航、主内容和右侧上下文栏；loading、error、403、404 却渲染成独立裸页。

真实走查 `/agent-runs/:id/replay` 的无权限状态时，页面只剩：

- “你没有权限查看”。
- 一条返回链接。

顶栏、用户身份、主导航和上下文全部消失，视觉上像跳出 WorkHub。

证据：

- `apps/web/src/routes.ts:1341-1399`
- `apps/web/src/browser.ts:1994-2010`
- `packages/ui/src/gold-path/product-shell.ts:426-487`

---

### P2-7 Replay 是旧完整页面嵌套进新产品壳

Replay renderer 自带背景、标题、双栏和右侧摘要；外层 product shell 又提供左导航、主内容和 276px 右栏，形成双框架、双摘要与响应式断层。

证据：

- `packages/ui/src/gold-path/route-components.ts:4187-4199`
- `packages/ui/src/replay/render.ts:35-53`
- `packages/ui/src/replay/render.ts:275-338`
- `packages/ui/src/gold-path/product-shell.ts:469-484`

建议把 Replay 数据映射到标准 Route Component，而不是直接嵌入 legacy whole-page renderer。

---

### P2-8 设计语言存在明确合同违约与 token 漂移

#### AI 把握度显示数字

当前工作项直接渲染：

`AI 置信 ${Math.round(score * 100)}%`

但产品 README、术语规范和需求明确要求只显示人话，绝不显示数值。

证据：

- `packages/ui/src/gold-path/route-components.ts:2317-2321`
- `README.md:43`
- `docs/workhub/00-overview/glossary-dejargon.md:122-131`
- `docs/workhub/04-modules/requirements-workitem.md:311-317`

#### 同一 Web 页面存在多代 CSS

- Product shell 使用 `--wh-product-*`。
- Proposal 注入 legacy `proposalCss`，重新定义 `:root`、`.wh-card`、`.wh-btn`。
- Replay 再带一套背景、字体和布局。
- 路由链接使用未定义的 `--wh-product-accent`，回退成另一种蓝。

证据：

- `packages/ui/src/gold-path/product-shell.ts:279-296`
- `packages/ui/src/proposal/render.ts:83-105`
- `packages/ui/src/gold-path/route-components.ts:134-138`

---

### P2-9 Desktop 启动首帧为空白

Desktop boot shell 只挂载透明空 host，随后等待 token 和 `/me` 两次异步调用，真正 Spotlight 之后才出现。慢网或鉴权异常时，用户先看到透明或空白窗口。

证据：

- `apps/desktop-webview/src/desktop-spotlight-boot.ts:6-8`
- `apps/desktop-webview/src/browser.ts:1261-1308`
- `apps/desktop-webview/src/spotlight/css.ts:10-12`

建议首帧立即显示品牌化 loading/offline shell，并把鉴权阶段写成可观测状态。

---

### P2-10 无障碍问题会阻断核心任务

主要问题：

1. 审批行使用可聚焦 `article`，但没有 button/option 角色，鼠标指针仍是 `default`。
2. 多处使用 `<h3 role="heading" aria-level="2">`，真实浏览器仍报告 level 3，页面大量从 h1 直接跳 h3。
3. Proposal 多文件 tabs 只有 click，没有 ArrowLeft/Right、Home/End。
4. Desktop Intake 会默认预选推荐答案，但按钮没有 `aria-pressed` 或 radio 语义。
5. Web muted 文本 `#9AA0AC` 对白色约为 2.63:1，低于普通文本 4.5:1。
6. 多个 textarea 只依赖 placeholder 或未关联的相邻文字。
7. 全局单字符 A/X 审批快捷键不可关闭或重映射，可能误触通过。

证据：

- `packages/ui/src/gold-path/route-components.ts:1820-1828`
- `apps/web/src/react-route-mount.ts:568-606`
- `apps/desktop-webview/src/spotlight/views/intake.ts:14-59`
- `packages/ui/src/gold-path/product-shell.ts:279-292`
- `apps/web/src/browser.ts:420-448`

---

### P2-11 列表截断后没有可达入口

- 项目主页最多返回 50 条工作，超出部分只有说明，没有“查看全部”。
- 总览决策队列只展示四条，没有完整队列入口。
- Desktop Drive 只显示前 40 个文件，无搜索、更多或截断提示。
- Meetings 只列 10 场会议，后续会议不可从页面到达。

证据：

- `apps/api/src/services/project-home-pages.ts:44-49`
- `packages/ui/src/gold-path/route-components.ts:984-1007`
- `packages/ui/src/gold-path/route-components.ts:3708-3739`
- `apps/desktop-webview/src/spotlight/views/drive.ts:248-279`
- `packages/ui/src/gold-path/route-components.ts:2945-2955`

---

### P2-12 错误重试会丢失查询上下文

错误态 retry 只使用 pathname，不保留 search parameters。以下页面点击重试后可能打开错误对象：

- `/drive?project_id&item_id`
- `/meetings?project_id&m`
- `/calendar?date&view`
- `/knowledge/search?q&project_id`
- `/approvals?offset`

证据：`apps/web/src/routes.ts:1424-1453`。

---

## 5. P3：设计与文档债务

### P3-1 多代 renderer 并存

`packages/ui` 同时存在 app shell、product shell、gold-path base、proposal、replay、agent-run 等多代 renderer；它们重复声明 `:root` 和 `.wh-card/.wh-btn/.wh-title` 等通用类。

代表位置：

- `packages/ui/src/gold-path/app-shell.ts`
- `packages/ui/src/gold-path/render.ts`
- `packages/ui/src/gold-path/product-shell.ts`
- `packages/ui/src/proposal/render.ts`
- `packages/ui/src/replay/render.ts`

这会让小修改在不同页面产生不可预测的视觉漂移。

### P3-2 Living Documentation 已经漂移

- 根目录 `pnpm dev` 实际只启动 API，但 README 写“同时拉起 API / Web”。
- README 的迁移说明停留在 `0000-0019`，仓库实际已经到 `0045`。
- 旧 UI/E2E 报告仍宣称 15 条完整路由，当前正式注册表已有 18 条。

证据：

- `package.json:12-17`
- `README.md:99-125`
- `docs/workhub/05-clients/all-page-ui-shape-test-report-2026-06-20.md`
- `docs/workhub/05-clients/e2e-test-report-2026-06-20.md`

### P3-3 当前测试缺少跨组件状态合同

现有测试大量覆盖 HTML 字符串、Page VM 和静态标记，但以下真实交互没有被锁定：

- Intake 意图与项目文件的关联准确性。
- 审批切换后标题、动作、理由、`aria-current` 同步。
- 通知偏好 GET 慢、失败和首次点击竞态。
- 语言切换时草稿保护。
- Proposal 冲突接口失败的 partial/error 状态。
- 资源链接是否真实下载或预览。
- 慢导航期间旧页面是否 inert。
- Proposal tabs 的键盘操作。

---

## 6. 已做得好的部分

### 6.1 产品与功能

- 18 条正式路由覆盖了从项目、任务、AI 执行到审批和正式采纳的主要路径。
- “审阅通过”和“采纳正式版”是两个独立动作，信任边界正确。
- 403、404、普通错误和身份失效在路由层有明确类型。
- 项目主页、Drive、Meetings 等页面具备项目上下文和返回路径。
- Typed API Client 对 envelope、error details、AbortSignal 和可选 timeout 的实现清晰。
- SSE 连续失败达到阈值后会停止盲目重连，并提供恢复提示。

### 6.2 Web 视觉与响应式

- Ready 页面已经形成稳定的 route header、grid、card、row、meta 和 actions 语法。
- 固定文案中英文覆盖较完整。
- 390px 移动宽度下，首批导航和“更多/收起”菜单可正常使用。
- 长文本普遍使用 `min-width: 0`、`overflow-wrap` 和单列断点避免溢出。
- 新路由不会同时渲染所有隐藏 panel。

### 6.3 Desktop

- `.wh-ds` 对字体、语义色、玻璃层级、圆角、间距、阴影和动效进行了作用域隔离。
- Spotlight 展开后具备 combobox/listbox、`aria-activedescendant`、上下键和 Esc 分层返回。
- 已有 `focus-visible`、`prefers-reduced-motion` 和视觉语言测试。
- Web 平面化设计与 Desktop Apple glass 的平台差异是明确决策，不把差异本身视为缺陷。

---

## 7. 推荐迭代顺序

### Phase 0：恢复信任链

优先处理：

1. Intake 项目选择、文件相关性和意图 grounding。
2. 审批选中对象的单一状态源。
3. 下载、预览和证据资源链接。
4. Proposal 冲突失败语义和完整决策依据。
5. Web 请求超时与动作锁隔离。

完成标准：普通用户不会被带入错误任务，不会对错误对象做审批，也不会把加载失败理解成没有数据。

### Phase 1：保护用户输入与设置

1. 语言切换纳入 dirty guard。
2. 通知偏好 hydration 和并发保存。
3. 登出失败真实性。
4. 慢导航期间旧页面 `inert + aria-busy`。
5. 所有 pending/success/error 文案重新按真实状态分类。

### Phase 2：补齐普通用户闭环

1. 重组导航并做角色化披露。
2. 会议导入/上传入口。
3. 日程日期和视图控制。
4. 委派选人器。
5. 项目、工作项、会议和 Drive 列表的完整入口。
6. 把设置拆为个人设置与管理员诊断。

### Phase 3：统一设计系统与无障碍

1. 非 Ready 状态回归 product shell。
2. Replay、Proposal 从 legacy whole-page renderer 迁移到标准 route component。
3. 合并 Web token 和通用组件规则。
4. 修复标题层级、审批语义、tabs 键盘模型、字段标签和颜色对比度。
5. Desktop 增加可见首帧和读屏 loading/error 公告。

### Phase 4：恢复单一事实源

1. 修正 `pnpm dev` 与 README。
2. 更新迁移范围和 18 路由报告。
3. 让 QA 报告从当前路由注册表动态生成。
4. 为所有 P1 增加浏览器级或服务集成级回归测试。

---

## 8. 建议新增的验收用例

### Intake

- 项目有旧文件、请求与旧文件无关时，澄清不得引用旧文件。
- 用户点名文件时，澄清必须同时引用文件和当前意图。
- 首轮问题必须包含至少一个人类可读选项；自由文本只是补充。
- 全局入口必须显式选择项目。

### Approvals

- 鼠标、Enter、Space 切换到第二项后，`h1`、详情、动作 URL、`aria-current` 和焦点保持一致。
- A 的打回理由不得提交给 B。
- 单字符快捷键可关闭、重映射或只在审批组件聚焦时生效。

### Proposal

- 冲突接口 403/500 时显示 partial/error，不得显示零冲突。
- 所有检查和证据显示总数与展开入口。
- 多文件 tabs 支持 ArrowLeft/Right、Home/End。

### Preferences 与草稿

- 通知偏好 GET 慢、失败和首次点击时保留旧值。
- 中英文切换保留 Intake、审批理由、Drive 评论和冲突编辑草稿。
- 并发保存按最新用户意图落库。

### 资源链接

- WorkItem accepted deliverable 可以真实下载。
- Proposal preview 可以真实打开。
- Knowledge evidence 打开产品页面而不是 JSON Page VM。
- Manifest 不产生未注册路由。

### 响应式与无障碍

- 320、375、390、780、1120px 检查英文长导航和触控目标。
- 非 Ready 状态保留主导航和用户身份。
- VoiceOver 能识别选中审批、默认 Intake 选项、loading 和 error。
- 普通文本对比度达到 4.5:1。

---

## 9. 验证记录

本轮新鲜运行以下聚焦测试：

| 包 | 结果 |
|---|---:|
| `@workhub/web` | 67 / 67 |
| `@workhub/ui` | 137 / 137 |
| `@workhub/desktop-webview` | 269 / 269 |
| `@workhub/web-runtime` | 28 / 28 |
| `@workhub/api-client` | 18 / 18 |
| **合计** | **519 / 519** |

五条测试命令均返回 exit code 0。

这些结果证明现有单元边界稳定，但不代表上述 P1 已被覆盖。P1 主要集中于跨组件状态同步、真实 LLM 上下文、异步竞态、资源导航和错误语义。

---

## 10. 工作树与环境说明

审查开始前，当前分支已有 12 个修改文件：

- `apps/api/src/agent-runs.test.ts`
- `apps/api/src/routes/pages.ts`
- `apps/api/src/services/approvals.ts`
- `apps/api/src/services/work-items.ts`
- `apps/api/src/workitems.test.ts`
- `apps/desktop-webview/src/spotlight/views/attention.ts`
- `apps/desktop-webview/src/spotlight/views/dashboards.ts`
- `apps/desktop-webview/src/spotlight/views/drive.ts`
- `apps/web/src/browser.ts`
- `packages/db/src/repositories/projects.ts`
- `packages/ui/src/gold-path/product-shell.ts`
- `packages/ui/src/gold-path/route-components.ts`

这些既有修改被视为当前待审版本，本轮没有改动它们。

本轮真实页面走查在本地 Pilot 数据库中新增了测试用户 `ReviewTester-0710` 和测试会话 `66e22124-d58e-4c0e-af22-6b55916257f3`。Docker 容器在审查后已经停止，未删除或重置既有数据卷。

除本审查报告外，本轮没有修改产品代码。
