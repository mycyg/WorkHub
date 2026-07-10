# WorkHub 普通用户视角系统性审查报告（R10 后续复核）

> 审查日期：2026-07-10
>
> 当前分支：`main`
>
> 当前基线：`29b8fcda42feeb8bb5e3c6ecde01941a0b9896e7`
>
> 审查范围：Web、Desktop Spotlight、Tauri/Rust、Cuu/Pet、功能闭环、UI/UX、设计语言、响应式、可访问性、失败恢复、可观测性与审查证据质量
>
> 报告性质：对 2026-07-10 旧审查报告之后 23 个 R10 提交的独立复核；不把旧报告原样重复
>
> 发布结论：**HOLD。当前确认 1 个 P0，普通用户试点不应扩面。**

---

## Remediation loop status

本节是原始审查之上的 living remediation ledger，只记录修复与 fresh 验证证据；上方原始审查基线、下方 P0-1 历史发现及整份报告的 `HOLD` 发布结论均保持不变。`FIXED_PENDING_REVIEW` 仅表示修复已有提交和本轮验证证据，仍须等待独立 task review 与 whole-batch review，不表示 Batch 0 或产品已完成。

| Finding | Status | Remediation commits | Fresh verification evidence |
|---|---|---|---|
| P0-1 | `FIXED_PENDING_REVIEW` | Task 1 directory scope: `110e415d4`; Task 1 fail-closed/repository hardening: `5aab1337b`; Task 2 delegate authorization: `58a3168a7`; Task 2 active-user directory hardening: `8865577cc`; Task 3 literal DOM options: `591510f7f` | `pnpm --filter @workhub/api test`: tests `850`, pass `850`, fail `0`, exit `0`.<br>`pnpm --filter @workhub/web test`: tests `68`, pass `68`, fail `0`, exit `0`.<br>`pnpm --filter @workhub/api typecheck`, `pnpm --filter @workhub/web typecheck`, and `pnpm --filter @workhub/db typecheck`: all exit `0`.<br>Fresh isolated Pilot PG/Redis command: `DATABASE_URL='postgresql+psycopg://workhub:workhub@127.0.0.1:55434/workhub_r11_batch0_task4' APP_ENV=test COOKIE_SECRET=local BROKER_BACKEND=redis BROKER_URL='redis://127.0.0.1:6381' WORKER_COUNT=2 pnpm qa:r2-pg-redis-smoke`; exit `0`, `workspace-scoped active member directory isolation ok`, final `ok: true`, owner SSE `200`, stranger SSE `403`, and `run_status: succeeded`.<br>Fresh cross-workspace exploit regression `pnpm --filter @workhub/api exec node --import tsx --test --test-name-pattern="delegate rejects an active user without an actor-workspace membership" src/approvals.test.ts`: matched `1`; TAP total `1`, pass `1`, skipped `0`, fail `0`, exit `0`; the regression produced no routed-user mutation, notification, SSE event, or `approval.delegated` success audit.<br>Fresh active-user fail-closed follow-up at `8865577cc`: focused directory/soft-delete/repository-throw tests TAP total `3`, pass `3`, fail `0`, exit `0`; focused OpenAPI contract TAP total `1`, pass `1`, fail `0`, exit `0`; full `src/approvals.test.ts` TAP total `67`, pass `67`, fail `0`, exit `0`; `pnpm --filter @workhub/api typecheck` exit `0`. All three active-user regressions assert unchanged routing, no notification create/archive, no SSE/bus event, no `approval.delegated` success audit, and no membership lookup before a proven active user; missing user-directory capability returns `503 delegate_user_directory_unavailable`, while an absent/soft-deleted active user remains the non-enumerating `404 delegate_target_not_found`.<br>`rg -n "listActiveRefs\b|select\.innerHTML = result\.users" packages/db/src apps/api/src apps/web/src`: no matches (expected `rg` exit `1`). |

## 1. 一句话结论

WorkHub 的 Web 表面已经从“工程后台”明显进化成了有产品感的玻璃化工作台，导航、Intake、审批选择、日历、设置拆分等 R10 改动也确实改善了第一印象；但它还没有形成一个可以让普通用户放心操作的、跨 Web/Desktop/Cuu 一致的产品。

现在最大的风险已经不是“卡片圆角是否统一”，而是：

1. 审批可以委派给当前工作区之外的全局用户，形成明确的数据泄露与审批黑洞风险。
2. Drive 在常见 1280px 笔记本宽度下会把文件名压成 0px，并把删除/上传目标退化成难以辨认的其他对象。
3. Web、Spotlight、Cuu 对项目范围、危险动作、登出、深链和配置的合同彼此不同。
4. 多处页面承诺了“导入后生成洞察”“查看全部”“当前选中对象”等完整闭环，实际只完成了部分数据写入或跳转。
5. 当前 82 步视觉门禁的 `contact-sheet.png` 实际只展示前两张 Onboarding；门禁仍报告 `fresh: true`，因此“全量视觉回归已通过”不成立。

从普通用户角度，这些问题会共同制造一种危险感受：**页面看起来已经能用，但用户无法确信动作到底作用于谁、哪个项目、哪个文件、哪个身份，以及失败后系统是否说了真话。**

---

## 2. 极挑剔主观评分

这些分数不是自动化指标，而是站在普通用户和高要求产品审查者视角，对当前基线的主观裁定。

| 维度 | 评分 | 结论 |
|---|---:|---|
| Web Ready 页面视觉完成度 | 7.2 / 10 | 玻璃语言已经成形，层级与品牌感有明显提升 |
| Web 功能可信度 | 4.8 / 10 | 核心路径仍有错误对象、假闭环、吞错和草稿丢失风险 |
| Desktop Spotlight 可操作性 | 5.4 / 10 | 启动器结构清楚，但状态真源、项目范围和离线语义不可靠 |
| Cuu/Pet 可操作性 | 4.8 / 10 | 有角色与入口，但危险动作、设置恢复、项目缓存和文档合同未收口 |
| 跨端一致性 | 3.8 / 10 | Web、Desktop、Rust、Cuu 各自保存一部分真相 |
| 响应式与信息密度 | 5.3 / 10 | 简单 fixture 好看，真实密集数据和非 Ready 状态会失控 |
| 可访问性 | 4.4 / 10 | 做过修复，但标题、角色、快捷键、状态播报、对比度仍是系统性缺口 |
| 失败语义与可观测性 | 4.1 / 10 | 仍有裸 catch、假空态、request id 丢失和视觉门禁假绿 |
| 当前普通用户发布就绪度 | 3.0 / 10 | 受 P0 与多项 P1 阻断 |

### 当前最好的部分

- Web 的 Indigo/玻璃卡片/左导航已经具备统一的第一层视觉语言，不再像多个独立工具拼起来。
- R10 已修复旧报告中的审批选中源错位、冲突失败伪装为零、通知偏好水合竞态、Web 登出假成功、日历日期控制和错误重试丢 query 等问题。
- Web Intake 现在有项目选择和真实 Option-first 路径；但该改进尚未同步到 Desktop/Cuu。
- 当前聚焦测试和 typecheck 全绿，说明局部合同稳定；问题主要位于跨层、跨端和真实数据密度边界。

---

## 3. 审查方法与证据等级

### 3.1 证据等级

| 标签 | 含义 |
|---|---|
| `LIVE` | 在当前前端或当前 Desktop WebView 页面实际复现 |
| `CODE` | 当前 HEAD 的完整调用链已闭合，可从输入走到错误结果 |
| `TEST` | 本轮 fresh 执行的测试或 typecheck |
| `ARTIFACT` | 当前仓库内最新截图、JSON 或 QA 产物经实际查看 |
| `UNVERIFIED` | 仍需真实原生窗口、系统通知、跨平台或硬件环境验证 |

### 3.2 本轮实际覆盖

- 当前 Web 前端：总览、Intake、Drive、审批空态、设置、404/非 Ready 壳。
- 当前 Desktop WebView：Spotlight 搜索、返回、Intake、审批、Settings、Cuu Pet 页面与右键菜单。
- Rust/Tauri：current code、Cargo tests，并实际启动了 Tauri 进程；原生窗口自动化未能可靠附着，视觉结论不冒充原生实机。
- 代码链：审批委派、批量审批、Proposal、Meeting、Knowledge、Drive、SSE、深链、系统通知、项目作用域、Cuu 设置与多屏恢复。
- 证据产物：最新 82-step JSON、contact sheet、桌面/移动 route screenshots。

### 3.3 环境限制

- Docker Hub 拉取 `node:22-slim` 元数据时出现 anonymous token `unexpected EOF`。本轮 Web 实机使用当前前端加本机已有的、R10 前缓存 API 镜像。
- 因此，**当前前端的布局/交互复现是实时证据；R10 新增 API 行为使用当前代码与 fresh tests 复核，不把旧容器行为当成当前 API 结论。**
- 内置浏览器未可靠切到 390px；移动结论来自当前 CSS/DOM 与最新仓库截图，不写成“本轮 390px 实机复现”。
- 未执行真实跨工作区恶意委派，避免主动制造数据泄露；P0 是当前代码链的确定性结论。

---

## 4. 严重性定义

| 等级 | 定义 |
|---|---|
| P0 | 明确越权/泄露、不可逆大范围数据风险或发布阻断事故 |
| P1 | 会造成错误对象、错误项目、误审批、数据丢失、核心闭环不可用或严重假绿 |
| P2 | 显著降低发现性、一致性、效率、恢复能力或无障碍体验，但通常有替代路径 |
| P3 | 设计债务、文案与文档漂移、次级视觉打磨 |

---

## 5. P0：必须立即阻断发布

### P0-1 审批委派可跨工作区泄露信息，并把审批送进黑洞

**证据：`CODE`，未执行真实泄露。**

#### 普通用户场景

某工作区的审批人展开“转交给同事”。下拉框应该只出现当前工作区内有资格处理该审批的成员。

#### 当前行为

1. Web 调用全局 `GET /api/users`：`apps/web/src/browser.ts:796-808`。
2. 路由只验证“已登录”，随后调用全局 `listActiveRefs()`，不传 org/workspace：`apps/api/src/routes/auth.ts:793-807`。
3. 仓库读取所有未删除用户、按昵称取前 200：`packages/db/src/repositories/users.ts:47-60`。
4. Approval delegate 只检查目标是活跃用户，并调用工作项可见性：`apps/api/src/services/approvals.ts:1099-1133`。
5. 对公开状态工作项，`canViewWorkItemRecord()` 对任意 user id 返回可见；它检查的是工作项所属 scope，不是目标用户 membership：`packages/permissions/src/resource-permissions.ts:126-143`。
6. 委派完成后，系统给目标用户创建包含标题、摘要和工作项 id 的持久通知，并发送 SSE attention：`apps/api/src/services/approvals.ts:1162-1195`。
7. Escalation 已经有正确对照做法：显式调用 `findActiveForUserWorkspace()`：`apps/api/src/services/escalations.ts:629-647`。

现有测试名为“rejects a target outside the actor workspace”，但它只是把 **work item** 放进了其他 workspace，没有建立“目标用户不属于当前 workspace”的 membership 场景：`apps/api/src/approvals.test.ts:818-866`。这个测试名给出了错误安全感。

#### 用户后果

- 当前工作区成员目录被泄露成全局目录。
- 审批摘要和 attention 可发给其他工作区用户。
- 原审批人的路由被移走；外部用户又可能因为自己工作区过滤看不到详情，形成审批黑洞。
- 前 200 限制还会让真正同事随机消失，进一步诱导错误委派。

#### 根因

“用户活跃”“能看到公开工作项”“属于当前工作区并有审批资格”被错误地当成了同一件事。身份目录、资源可见性和委派资格没有一个共享的授权合同。

#### 必须修复

1. `/api/users` 改为当前 workspace active membership 目录，禁止全局用户枚举。
2. Approval 与 Escalation 共用同一 membership/eligibility guard。
3. 排除当前审批人、请求发起人和没有有效 membership/role 的用户。
4. 授权校验完成后才允许 mutation、notification 和 SSE。
5. 新增真实四象限测试：同工作区有效、同工作区无角色、跨工作区活跃用户、已删除/停用 membership。
6. 记录 `actor_workspace_id / target_workspace_membership / approval_id / authorization_decision`，但日志不得包含完整审批内容。

#### 验收门槛

- 跨工作区目标永远不会出现在候选列表。
- 即使直接伪造 `to_user_id` 请求，也必须返回 404/422，审批路由不变，且无通知、无 SSE、无审计“成功”记录。
- 测试必须用真实 membership repository，而不是只构造另一个 workspace 的 work item。

---

## 6. P1：核心信任链与操作闭环

### P1-1 Drive 在 1280px 常见宽度下文件名压成 0px，删除/上传目标也不可信

**证据：`LIVE + CODE`。**

当前前端在 1280×720、真实多文件数据下，Drive 文件行出现一字一行的超长竖排。DOM 测量结果：

- `.wh-r4-drive-item-link`：宽 `0px`、高约 `1910px`。
- 文件行：宽约 `398px`、高约 `1923px`。
- 右侧 meta/action：宽约 `332px`。
- 实际 grid columns：`0px 332.484px`。

根因是产品壳在大于 1120px 时仍保留 `218px / main / 276px` 三列，Drive 主内容又套两列，文件行内部仍用 `minmax(0,1fr) auto`；响应式只看 viewport `860px`，不看真实容器宽度：

- `packages/ui/src/gold-path/product-shell.ts:307`
- `packages/ui/src/gold-path/route-components.ts:129-150`
- `packages/ui/src/gold-path/route-components.ts:208`

同页还存在目标歧义：当选中文件不可删除时，页面动作会回退到服务端给出的“最近手工文件”，而不是禁用当前对象动作；按钮只显示文件名，同名不同路径无法分辨：

- `packages/ui/src/gold-path/route-components.ts:2715-2749`
- `apps/api/src/services/drive-pages.ts:623-627`
- `apps/web/src/browser.ts:1348-1372`

上传目录下拉框也只展示 `folder.name`。实机数据出现五个同名 `outputs`，用户无法知道文件会进入哪个路径。

**必须修复：**

- 以容器查询或真实可用宽度切换行布局；action 区不能把名称列压到 0。
- 只对当前选中对象展示动作；不可删除就明确说明原因，不得偷偷换成另一文件。
- 所有文件/目录动作显示唯一 breadcrumb 或相对完整路径。
- 删除必须有目标路径确认，且确认页再次校验 id/path/version。
- QA fixture 至少包含 5 层目录、同名目录、长中文/英文文件名、多个 row actions 和 accepted/manual 两类文件。

### P1-2 委派昵称可伪造下拉选项

**证据：`CODE + headless reproduction`。**

`apps/web/src/browser.ts:804-808` 把 `nickname` 直接拼进 `select.innerHTML`。昵称合同只有长度限制：`packages/contracts/src/auth.ts:17`。恶意昵称可闭合 `<option>` 并插入一个额外的 selected option。

当前证据支持“标签/选项冒充和错误目标选择”，不夸大为脚本 XSS。

**必须修复：**用 `document.createElement("option")`、`.value` 和 `.textContent`；服务端仍必须重新验证目标 membership，前端安全渲染不能替代后端授权。

### P1-3 Replay 产物预览/下载仍是死入口

**证据：`CODE`。**

- Replay 链接没有 `drive_preview` 或 `data-native-resource-link`：`packages/ui/src/replay/render.ts:232-240`。
- Web 把 `/api/*` 统一分类为 API action：`apps/web/src/browser.ts:1077-1144`。
- 未知 action 最终停在 pending/unknown 提示：`apps/web/src/browser.ts:1769`。
- 已修好的 Workitem/Drive 入口使用了正确 marker：`packages/ui/src/gold-path/route-components.ts:2370,2401,2627`。

旧报告中的“资源链接被动作代理拦截”只被局部修复，Replay 被漏掉了。

**必须修复：**所有 preview/download 只由一个共享 resource-link helper 生成；测试必须验证点击后的浏览器行为，不是只断言 href 存在。

### P1-4 批量审批把所有错误吞成“已被处理”

**证据：`CODE`。**

`apps/api/src/routes/approvals.ts:167` 对逐项处理的任何异常裸 `catch`，全部归类为 skipped；Web 在 `apps/web/src/browser.ts:957` 把 skipped 统一解释成“已被处理”。鉴权失败、数据库故障、审计失败和真实竞态因此拥有同一用户文案。

这同时违反了 fail-fast 和可观测性要求：系统不仅没有暴露错误，还主动告诉用户一个并不真实的原因。

**必须修复：**

- 只把已知 409/CAS 竞态归为 benign skip。
- 返回逐项 `id/status/code/request_id`。
- 未知错误结构化记录，并在 UI 显示“部分成功：N 成功 / M 失败”。
- 增加 `respond-batch` 行为测试，覆盖 401、403、409、500 和 audit/database failure。

### P1-5 Proposal 打回无法表达真实意见，页面状态还会停在旧值

**证据：`CODE`。**

- 用户只能在三种泛化理由中选择，不能输入具体意见：`packages/web-runtime/src/notice.ts:357`。
- 该理由会直接成为下一轮 Agent correction：`apps/api/src/routes/proposals.ts:708`。
- reason submit 无 busy lock；成功后没有完整刷新 proposal 状态：`apps/web/src/browser.ts:1002`。
- approve/merge 只替换动作行，头部状态仍可能显示旧值：`apps/web/src/browser.ts:1629`、`packages/ui/src/gold-path/route-components.ts:2562`。
- rebase 补救请求再次失败时会从错误处理器抛出，用户得不到可恢复提示：`apps/web/src/browser.ts:566`。

**必须修复：**增加 Proposal 专属理由输入，预置理由只能作模板；所有 decision 动作共用一次性 busy/CAS 状态机，并依据 API 返回原子更新 header、actions、history 和 notice。

### P1-6 会议转写与项目名草稿不受 Dirty Guard 保护

**证据：`CODE`。**

会议导入允许输入最多 200,000 字，但 dirty allowlist 没有覆盖会议表单或项目名：

- `apps/web/src/browser.ts:1779-1833`
- `packages/ui/src/gold-path/route-components.ts:3063`
- `packages/ui/src/gold-path/route-components.ts:3745`

语言切换、导航或 SSE 重渲可能无提示清空一份长转写。

**必须修复：**从字段白名单改为表单级 `data-dirty-input`/统一 dirty registry；任何新可编辑表单默认受保护，除非显式 opt-out。测试覆盖 Meeting 200k transcript、project name、locale switch、route change 和 SSE refresh。

### P1-7 “导入会议”只存转写，却承诺会产生洞察和任务

**证据：`CODE`。**

UI 文案承诺“导入后确认洞察、生成任务”：`packages/ui/src/gold-path/route-components.ts:3063`。实际 repository 只创建 `meeting_records(status="transcribed")` 和审计记录：`packages/db/src/repositories/meetings.ts:173`。全仓没有 `meeting.transcript_imported` 或 `transcribed` 的消费方，页面服务只映射已经存在的 insights：`apps/api/src/services/meeting-pages.ts:255`。

**必须修复：**要么建立可观察的后台处理状态 `queued / processing / ready / failed` 并产出 insights，要么立即收回“会生成洞察”的承诺，提供明确的手工提取入口。不能用一条“导入成功”notice 把缺失闭环包装成成功。

### P1-8 Desktop/Cuu 的“取消子任务”一击进入终态

**证据：`CODE`。**

Web 使用 5 秒内二次点击确认：`apps/web/src/browser.ts:1522-1535`。Spotlight、Cuu runtime 和 pet 都直接提交取消：

- `apps/desktop-webview/src/spotlight/views/attention.ts:421,647`
- `apps/desktop-webview/src/desktop-cuu-runtime.ts:1700`
- `apps/desktop-webview/src/pet-surface.ts:1434`
- API 最终映射成 `cancelled`：`apps/api/src/services/escalations.ts:124`

**必须修复：**建立共享 destructive-action policy，不允许三端各写自己的确认逻辑。至少要有明确目标、后果、二次确认和短时间撤销/恢复策略。

### P1-9 Desktop 登出不是可靠的身份边界

**证据：`CODE`。**

- Settings 吞掉 logout API 错误后仍清 token：`apps/desktop-webview/src/spotlight/views/settings.ts:82`。
- Rust `set_client_token("")` 提前返回，不 notify、不取消活动 SSE：`client-tauri/src-tauri/src/main.rs:476`。
- 活动 worker 不监听 token change：`client-tauri/src-tauri/src/sse_worker.rs:91`。
- API 只在开流时鉴权：`apps/api/src/routes/push.ts:132`；stream loop 不复查身份：`apps/api/src/sse/stream.ts:36`。
- 可重新绑定的 UI 只在旧 `boot()`，当前入口始终 `bootSpotlight()`：`apps/desktop-webview/src/browser.ts:875,1358`。

结果是：旧身份连接可能继续接收私人推送直到断线；reload 后又进入没有可恢复身份状态的 Spotlight。

**必须修复：**使用版本化 cancellation/watch token 立即终止活动流；清 token 也必须广播；当前 Spotlight 明确建模 signed-out/rebind；测试覆盖 A 用户登录→活动 SSE→登出→流立即断开→绑定 B 用户→只收到 B 事件。

### P1-10 Desktop/Cuu 的项目上下文是隐式的

**证据：`LIVE + CODE`。**

Desktop Intake 实机只有“你想让 AI...”输入框和开始按钮，没有项目选择器或项目 chip。代码只在已有 target 时传 `project_id`：

- `apps/desktop-webview/src/spotlight/views/intake.ts:89,162`
- API 缺项目时静默选择 seed/首个项目：`apps/api/src/services/work-items.ts:1722`
- 零项目则直接 `project_not_found`：`apps/api/src/services/work-items.ts:1739`
- Cuu 缓存项目 30 分钟：`apps/desktop-webview/src/desktop-cuu-runtime.ts:165`
- pet 静默使用缓存：`apps/desktop-webview/src/pet-surface.ts:825`
- 页面却承诺 Cuu 会自动建立项目：`apps/desktop-webview/src/spotlight/views/drive.ts:282`

**必须修复：**全局入口先选择或确认项目并持续展示 project chip；离开项目 route 时清除/暂停旧 context；Desktop/Cuu 来源缺 `project_id` 时 API fail closed；零项目走现有 `bootstrapProject()` 的真实创建流程。

### P1-11 Rust 深链、系统通知与 Spotlight 路由合同断裂

**证据：`CODE`，系统通知点击未实机。**

- Rust 接受的 route set：`client-tauri/src-tauri/src/deep_link.rs:155`。
- Spotlight 映射缺少部分 route：`apps/desktop-webview/src/spotlight/state.ts:72`。
- Rust 生成 `approvalId`，WebView 不解析：`apps/desktop-webview/src/spotlight/state.ts:104`。
- 未知 route 会 reset：`apps/desktop-webview/src/spotlight-shell-navigation.ts:25`。
- notification plan 带 `window_control`，worker 实际只 show：`client-tauri/src-tauri/src/notify.rs:154`、`client-tauri/src-tauri/src/sse_worker.rs:224`。
- pet 启动时没有提供 `onSystemNotification` callback：`apps/desktop-webview/src/pet-surface.ts:1545`。

**必须修复：**Rust/TS 共用 typed route registry；补齐 `/notifications`、`approvalId` 等目标；完成 OS notification activation→window control→Spotlight specific target 的真实端到端测试。

### P1-12 主窗设置与 Rust worker 使用两套服务器/语言配置

**证据：`CODE`。**

WebView 将 server override 写入 localStorage：`apps/desktop-webview/src/browser.ts:136`。Rust 只在启动时从 file/env 读一次：`client-tauri/src-tauri/src/config.rs:67`，随后一次性启动 worker/tray：`client-tauri/src-tauri/src/main.rs:1430`；invoke 表没有 endpoint/locale setter：`client-tauri/src-tauri/src/main.rs:1494`。

用户会看到主窗已经连接新服务器/新语言，但 SSE、OS 通知和托盘仍停在旧服务器/旧语言，直到重启。

**必须修复：**统一持久化 shell config；endpoint/locale 变化时原子重启 SSE、tray 与 notification locale；设置页展示 Rust 实际正在使用的 endpoint/locale，而非仅展示 WebView localStorage。

### P1-13 82 步视觉门禁是假完整证据

**证据：`ARTIFACT + CODE`。**

最新 `live-route-interaction-report.json` 声明 82 steps、所有 gates true、`contact_sheet_fresh: true`。但实际查看：

- `contact-sheet.png` 只有 `1280×1800`。
- PNG 中只有前两张 Onboarding；后 80 个步骤完全不可见。
- 生成器固定 viewport 1280×1800，`Page.captureScreenshot` 没有 full-page capture：`apps/web/qa/r4-web-live-route-interaction.ts:3381-3389`。
- freshness 只比较存在性和 mtime：`apps/web/src/r4-smoke-contact-sheet.ts:19-48`。

这解释了为什么只有一个文件/一个目录的 Drive fixture 能全绿，却漏掉真实多 action 数据下 0px 文件名的严重回归。

**必须修复：**分页 contact sheet 或 full-page capture；门禁检查实际 figure 数、最后 step id、总高度和每张来源截图是否进入输出。测试数据必须包含密集/同名/长文案/多状态，而非只验证理想空态。

### P1-14 慢导航期间旧页面看起来可操作，实际已失去事件绑定

**证据：`CODE`。**

导航开始时先 abort 所有 Ready bindings，再保留旧 DOM，只加进度动画：`apps/web/src/browser.ts:2148`。旧 main 没有 `inert`、`aria-busy` 或 live status。旧 POST action 仍是 anchor，失去代理后可能退化为原生 GET。

**必须修复：**保留旧壳时把旧 main 原子设为 `inert aria-busy=true`；展示可读屏加载状态；新 DOM 与新 bindings 同一提交点恢复。进度 motion 尊重 reduced-motion。

### P1-15 A/X 是不可关闭的页面级单键审批

**证据：`CODE`。**

`apps/web/src/browser.ts:442` 在审批页任意非输入焦点下，把 `A` 直接映射为通过、`X` 映射为打回。用户不需要修饰键，也无法关闭或重映射。

对高风险审批，单字符不应是全页面热键。语音输入、输入法、辅助软件和误按都可能触发危险动作。

**必须修复：**只在明确聚焦的 approval workbench 内启用，或要求 `⌘/Ctrl + Shift + A/X`；设置中可关闭/重映射；第一次使用显示明确提示；仍要经过统一确认策略。

### P1-16 非 Ready 壳有完整按钮外观，但按钮全部失效

**证据：`LIVE + CODE`。**

404 页面实机仍展示语言、退出和导航控件，但点击 EN 后 `aria-pressed` 不变、中文页面不变。原因是状态壳会渲染控件：`packages/ui/src/gold-path/product-shell.ts:508`，而事件只在 `status === ready` 的 `bindReadyRoute()` 安装：

- `apps/web/src/browser.ts:2027-2040`
- `apps/web/src/browser.ts:2193`

403/404/empty/error 和移动 More 中，用户看到的是“假按钮”。

**必须修复：**拆分 shell-level binding 与 route-level binding；只要有身份壳，语言、退出、More、分组和原生导航必须始终可用。

---

## 7. P2：明显影响体验、一致性与恢复能力

### P2-1 普通成员的个人 Settings 和个人 Cost 被角色导航隐藏

`settings`、Cost、Agents、Skills 被整体放进 admin-only 分组：`packages/ui/src/gold-path/product-shell.ts:425-428`。但 Cost 页面支持个人用量：`packages/ui/src/gold-path/route-components.ts:3969`；Settings 明确包含个人语言和设备设置：`packages/ui/src/gold-path/route-components.ts:4179-4199`。

**建议：**Personal Settings 永久可见；Cost 对成员显示 own slice；只有组织诊断、组织成本和 Agent 管理进入 admin 组。

### P2-2 Scoped Knowledge 第二次搜索会丢失 scope

Loader 正确读取 `project_id/work_item_id`：`apps/web/src/routes.ts:1110-1128`；但渲染的搜索表单只有 `q`：`packages/ui/src/gold-path/route-components.ts:4137-4140`，服务端 full-search action 也不保留 scope：`apps/api/src/services/work-items.ts:2202`。

结果是用户从项目/工作项进入的第一次搜索正确，第二次提交突然变成全局搜索或权限错误。

**建议：**scope 成为 Knowledge search state 的一部分，表单、URL、API 和 retry 全链保留；UI 始终显示当前 scope chip 和清除入口。

### P2-3 列表截断仍然制造不可达内容

- Agent Team 子运行按创建时间升序只取最早 100 条，之后还用它计算“最新”状态和成本：`packages/db/src/repositories/work-items.ts:1119`、`apps/api/src/services/work-items.ts:1329`。
- Meetings 只展示 10 条，无分页/搜索：`packages/ui/src/gold-path/route-components.ts:2985`。
- Project Home 最多 50 个可见工作，无全量路由：`apps/api/src/services/project-home-pages.ts:44`。
- Drive 回收站提示用户从“具体文件链接”恢复，但被截断项没有发现入口：`packages/ui/src/gold-path/route-components.ts:2857`。

**建议：**任何截断都必须显示总数、当前范围和“查看全部/加载更多”；“最新”查询必须 DESC 或窗口化，不能先截取最旧再算最新。

### P2-4 首页“去审批中心看全部”并不是全部待处理

首页混合 escalation、conflict、approval 和 proposal review：`apps/api/src/routes/pages.ts:516`；溢出链接固定指向 `/approvals`：`packages/ui/src/gold-path/route-components.ts:989`，而该页只加载 approvals：`apps/api/src/routes/pages.ts:654`。

**建议：**建立真正统一的 Attention Center，或让每类“查看全部”跳到对应过滤后的队列；链接文案必须说清范围。

### P2-5 Intake 项目清单失败会静默退回 Pilot 项目

`apps/web/src/routes.ts:1349` 除身份失效外吞掉 `listProjects` 错误，随后 UI 仍可提交固定 `pilot-project`：`packages/ui/src/gold-path/route-components.ts:1456`。

**建议：**项目列表失败与“用户没有项目”必须是不同状态；失败时禁止无提示 fallback，展示 retry 和 request id。

### P2-6 客户端丢弃服务端 request id，用户无法提供可追踪凭据

API 生成 `X-Request-Id`：`apps/api/src/logging.ts:104`；`WorkHubApiError` 不读取/保存它：`packages/api-client/src/client.ts:20,274`；错误页只显示 status/code：`apps/web/src/routes.ts:1294`。

**建议：**所有错误对象携带 request id；用户 notice 可一键复制；服务端日志、SSE、后台任务和客户端错误统一使用 correlation id。

### P2-7 Spotlight 返回后输入框与 Enter 目标相反

**证据：`LIVE + CODE`。**

搜索“审批”进入审批，再返回：输入框仍显示“审批”，网格已经恢复全部，首项是“新任务”；此时 Enter 会打开 Intake。

根因是 `state.query` 和 DOM `input.value` 两个真源：

- back 只清 reducer：`apps/desktop-webview/src/spotlight/state.ts:39`
- render 按空 state 重绘：`apps/desktop-webview/src/spotlight/controller.ts:396`
- 只有 `resetLauncher()` 同时清 DOM：`apps/desktop-webview/src/spotlight/controller.ts:345`
- Enter 读取 active DOM：`apps/desktop-webview/src/spotlight/controller.ts:720`

**建议：**query 单一真源；加完整 DOM 回归：搜索→进入→返回→检查输入、列表、active item 和 Enter destination。

### P2-8 Desktop 冷启动/离线会显示空窗或假空态

boot shell 只有 CSS 与空 `data-spot-host`：`apps/desktop-webview/src/desktop-spotlight-boot.ts:6`。bootstrap、`me()` 和 listProjects 错误会被转成继续/空数组：

- `apps/desktop-webview/src/browser.ts:164,1269`
- `apps/desktop-webview/src/spotlight/views/drive.ts:334`
- `apps/desktop-webview/src/spotlight/views/dashboards.ts:808`

**建议：**显式建模 `booting / offline / unauthorized / empty`；错误绝不能转成“没有项目”；首帧显示品牌 skeleton、`role=status`、endpoint 和 retry。

### P2-9 Cuu 恢复设置已经成为死接线，tray 还会覆盖透明度

完整偏好面板仍在 `apps/desktop-webview/src/cuu-preferences.ts:253`，但只由旧 boot 调用：`apps/desktop-webview/src/browser.ts:1181`。当前 Settings 没有尺寸、透明度、点击穿透和恢复控件：`apps/desktop-webview/src/spotlight/views/settings.ts:16`。

Rust 恢复时保留 opacity：`client-tauri/src-tauri/src/main.rs:1206`；pet 接到 tray action 后又硬编码 100 并持久化：`apps/desktop-webview/src/pet-surface.ts:1518`。

**建议：**把偏好面板挂入当前 Spotlight Settings；tray 只传最终 settings，不让 WebView再次猜值；增加 Rust event→WebView state→localStorage 跨层测试。

### P2-10 Cuu launcher 的代码、测试与 current 文档互相矛盾

当前 launcher 是 free-text、`option_first=false`：`apps/desktop-webview/src/desktop-cuu-runtime.ts:391`；structured spec 只从 chips 生成：`apps/desktop-webview/src/desktop-cuu-runtime.ts:994`；测试已经固化自由文本：`apps/desktop-webview/src/desktop-cuu-runtime.test.ts:1010`。但 current 文档仍承诺 Option-first、无输入框：

- `docs/workhub/05-clients/desktop-pet-tauri.md:242`
- `docs/workhub/05-clients/cuu-r3-agent-entry.md:28`

**建议：**先做产品决策，再让代码、测试和 current docs 只保留一个合同；这是 Living Documentation 问题，不能继续同时宣称两种行为。

### P2-11 Desktop “覆盖全部能力”的测试是自引用，不是能力矩阵

Desktop registry 只有 13 项：`apps/desktop-webview/src/command-palette.ts:48`；测试只是与另一份手写 ID 列表比较：`apps/desktop-webview/src/command-palette.test.ts:11`。实际缺 meetings、project health；Team 没有 members；Notifications 只有 mute；Knowledge 在当前主窗里仍提示“去主窗口”。

**建议：**从 canonical route/capability manifest 生成 Desktop 覆盖矩阵；未支持能力要明确标注并提供真实跳转，测试名称不得宣称“全部”。

### P2-12 Cuu 保存了显示器名称，却不按该显示器恢复

placement 保存 `monitor_name`：`client-tauri/src-tauri/src/pet_commands.rs:66`；restore 忽略它，只在当前 work area clamp：`client-tauri/src-tauri/src/pet_commands.rs:83`、`client-tauri/src-tauri/src/main.rs:1435`。

**建议：**按 monitor name 匹配，其次最近显示器，最后 primary；覆盖双屏、不同 DPI、拔屏和拓扑变化测试。

### P2-13 Replay 仍是双框架、双右栏和全局 CSS

Replay 自带 frame/summary rail：`packages/ui/src/replay/render.ts:315`，被原样塞进 route component：`packages/ui/src/gold-path/route-components.ts:4259`，外层 product shell 又有 276px rail：`packages/ui/src/gold-path/product-shell.ts:573`。Proposal/Replay 还全局重定义 `:root/.wh-card/.wh-btn`：

- `packages/ui/src/proposal/render.ts:83`
- `packages/ui/src/replay/render.ts:35`

**建议：**Replay 数据映射成标准 route component，删除内层 frame/rail；legacy CSS 必须作用域化或直接引用共享 token。

### P2-14 非 Ready 响应式与当前导航仍有明显断层

- 390px Drive empty screenshot 中，导航和状态卡之间有约 400px 空洞：`docs/workhub/05-clients/assets/audit/2026-06-11-r4-web-live-route-interaction/16-empty-drive-no-project-mobile.png`。
- 状态布局只改列，没有定义 grid rows：`packages/ui/src/gold-path/product-shell.ts:552`。
- 未知路由强制 `key:"home"`：`apps/web/src/routes.ts:433`，导致 404 错把 Overview 标为当前页。
- mobile CSS 强制显示 group list 并让 toggle `pointer-events:none`，却不更新各组 `aria-expanded`：`packages/ui/src/gold-path/product-shell.ts:319`。

**建议：**状态壳定义真实 grid rows；404 允许没有 current nav；移动 More 展开时同步 ARIA，或移除不可操作 toggle 的语义与 tab stop。

### P2-15 可访问性修复仍不完整

系统性缺口包括：

- 66 处 `<h3 role="heading" aria-level="2">`，浏览器仍按 h3 暴露；例：`packages/ui/src/gold-path/route-components.ts:1746`。
- 审批行是可聚焦、可 Enter/Space 的 `article`，无 option/button 角色：`packages/ui/src/gold-path/route-components.ts:1836`。
- Proposal POST/DELETE anchor 没有 `role=button`：`packages/ui/src/proposal/render.ts:169`。
- React tabs 修了方向键，HTML fallback 仍只有 click：`packages/web-runtime/src/route-line-editor.ts:77`。
- Desktop Intake textarea 只有 placeholder：`apps/desktop-webview/src/spotlight/views/intake.ts:62`。
- Spotlight loading 缺 `role=status/aria-live`，combobox 固定 `aria-expanded=true`：`apps/desktop-webview/src/spotlight/controller.ts:79`。

**建议：**先修 DOM 原生语义，再补 ARIA；用 axe + keyboard path + VoiceOver 录屏作为验收，不再用字符串存在性代替可访问性。

### P2-16 Desktop 小字号语义色对比度不足

对纯白静态计算：

- `#8e8e93`：3.26:1
- `#0a84ff`：3.65:1
- `#30d158`：2.02:1
- `#ff453a`：3.41:1

这些颜色用于 10–12px chip、step 和 check 文本：`apps/desktop-webview/src/design-system.ts:12`、`apps/desktop-webview/src/spotlight/css.ts:93`。半透明玻璃不会自动保证更高对比度。

**建议：**拆分图形填充色和文本色；对最终合成背景跑自动对比度门禁。

---

## 8. P3：设计语言、文案与文档债务

### P3-1 Web 与 Desktop 仍不是同一设计系统

Web 使用 Segoe/Indigo `#4F46E5`：`packages/ui/src/gold-path/product-shell.ts:294`；Desktop 使用 SF/M PLUS/Apple blue `#0a84ff`：`apps/desktop-webview/src/design-system.ts:1`。Cuu 又以黑/白写实 Live2D 猫作为主视觉。

平台差异可以保留，但语义 token、危险动作、状态色、间距节奏、文案语气和交互合同必须共享。目前是三套并行人格。

**建议：**建立跨端 semantic-token schema；平台只映射字体、blur、motion 和窗口形态。

### P3-2 英文与金额格式仍有局部漂移

- 英文 Cost 同页同时出现 `¥4.2` 和 `CN¥4.2`：`packages/ui/src/gold-path/product-shell.ts:413`。
- Desktop formatter 固定默认中文 locale：`apps/desktop-webview/src/spotlight/views/dashboards.ts:39`。
- 英文信心文案出现 `auto-merge ok / spot-check`：`packages/ui/src/gold-path/route-components.ts:2343`，仍像工程术语。

最新英文 smoke 中的中文 fixture 属于测试证据缺口，不直接裁定为生产 i18n bug；但应补真正英文 fixture 门禁。

### P3-3 Cuu 产品文档与代码未随方向演进

Option-first、设置恢复、多屏落点、主窗能力覆盖等 current docs 与真实入口不一致。按照 Living Documentation 原则，修复代码时必须同步更新 `AGENTS.md` 指向的当前产品合同或相关 current docs，历史方案必须明确标为 snapshot。

---

## 9. 旧审查报告的闭环裁定

旧报告基于 `codex/r9-stage-b-rework`，当前 `main` 在其后已有 23 个提交。不能把旧报告继续当作当前缺陷清单，也不能因为 commit message 写着“已修”就直接关闭。

| 旧问题/方向 | 当前裁定 | 当前证据 |
|---|---|---|
| Web Intake 被旧 Pilot 文件带偏 | **Web 已修** | 项目选择、相关性门和 Option-first 已进入 R10 |
| Desktop/Cuu Intake 项目范围 | **仍未修** | 当前 Desktop 无项目 selector/chip，API 仍可选首项目 |
| 审批选择与动作目标错位 | **已关闭** | headline、reason、aria-current、href 与草稿已同步 |
| 冲突加载失败伪装为零 | **已关闭** | 当前有显式失败提示 |
| 通知静音覆盖旧设置 | **已关闭** | 有 hydration、失败锁定和 retry |
| Web 登出失败却显示已登出 | **已关闭** | 仅真实 401/not_identified 当完成 |
| Desktop 登出身份边界 | **新证据，仍 P1** | 活动 SSE 不因清 token 终止 |
| Calendar 无日期控制 | **已关闭** | 已有前后日期、Today、day/week |
| Error retry 丢 query | **已关闭** | retry 保留 pathname+search |
| 资源预览/下载 | **部分修复** | Workitem/Drive 已修，Replay 仍死 |
| 草稿保护 | **部分修复** | intake/proposal 等已覆盖，meeting/project name 漏掉 |
| 非 Ready 产品壳 | **仅视觉修复** | 壳存在，但按钮无绑定、404 current nav 错 |
| 审批委派 | **功能存在但引入 P0** | 目录和后端资格均未按 workspace membership |
| Meeting 接入 | **只完成存储** | 无处理消费方、无 insight pipeline |
| 导航角色化 | **部分修复** | 普通成员个人 Settings/Cost 被隐藏 |
| 列表截断 | **部分修复** | 多处仍无“查看全部”，Agent runs 甚至截最旧 100 |
| a11y 五条 | **部分修复** | 标题、角色、快捷键、状态播报和对比度仍未闭合 |
| 玻璃设计收编 | **Web 第一层完成** | Replay/Proposal legacy 与 Desktop/Cuu 未同源 |

### 已排除的旧猜测

- Spotlight Esc 一定越过内部详情直接回 launcher：当前有内部 back 与 dirty-input 二次 Esc。
- 新 token 后 SSE 必然等待完整 60 秒 backoff：非空新 token 会 notify 并唤醒 backoff；这不否定清 token 无法终止活动流。
- 完全没有 tray 恢复入口：Rust 有 tray action；问题是当前主窗恢复面板不可达且 opacity 合同冲突。
- 当前 Web/Desktop/Cuu/Rust 单元测试失败：本轮 fresh verification 全绿。

---

## 10. 根因级迭代建议

### Phase 0：先封住安全事故

1. 关闭或 feature-flag 审批委派。
2. 用 workspace membership directory 替代全局 `/api/users`。
3. Approval/Escalation 共用 delegate authorization policy。
4. 增加跨 workspace 回归和无副作用断言。

**退出条件：**P0 验收测试通过，安全审查确认候选目录、mutation、notification、SSE 四层都 fail closed。

### Phase 1：建立跨端“危险动作与对象范围”单一合同

统一以下概念：

- `ActorIdentity`：当前真实身份、token generation、活动 SSE generation。
- `ProjectContext`：显式 project id、来源、过期条件、UI chip。
- `ActionTarget`：对象 id、路径、版本、workspace、可执行原因。
- `DestructiveActionPolicy`：确认、busy、CAS、结果、撤销。
- `RouteTarget`：Rust/TS 共用 route registry、参数 schema、fallback。

优先修 Drive、Desktop logout、Desktop/Cuu project scope、cancel policy、deep-link 和 endpoint/locale split。

### Phase 2：把“部分成功”改成真实状态机

- Batch approval：逐项结果，不吞未知错误。
- Meeting import：`queued/processing/ready/failed`，而不是 transcribed 即完成。
- Proposal：comment、busy、CAS、header/action/history 原子更新。
- Slow navigation：旧页 inert，原子安装新 DOM 与 bindings。
- 所有客户端错误携带 request id。

### Phase 3：重做真实数据密度和视觉门禁

1. Contact sheet 按页生成，并校验 82/82 figure 真正进入 PNG/PDF。
2. fixture 必须包含：长标题、同名目录、多个 action、100+ runs、50+ items、空/错/慢/权限状态。
3. 增加 320/375/390/780/1120/1280/1365 宽度边界。
4. Drive/Replay/Proposal 使用容器查询，不只看 viewport。
5. Desktop/Cuu 必须补真实 Tauri 透明窗、Live2D、tray、系统通知、双屏和 VoiceOver 证据。

### Phase 4：收口设计系统和无障碍

- Web/Desktop/Cuu 共享 semantic tokens 与危险动作模式。
- Replay/Proposal 去掉全局 legacy CSS 和双 rail。
- 用真 `h2/button/listbox/option/status`，不再用 ARIA 模拟错误原生元素。
- 单字符审批快捷键改为可关闭的明确组合键。
- 所有小字语义色在最终玻璃合成背景上通过 WCAG 对比度门禁。
- 普通成员始终能发现个人 Settings 和个人 Cost。

---

## 11. 建议新增的验收测试

### 安全与权限

1. `approval-delegate-cross-workspace.test.ts`
   - 候选目录无跨 workspace 用户。
   - 伪造目标返回 404/422。
   - approval owner 不变。
   - notification/SSE/audit success 均为 0。
2. `desktop-logout-identity-boundary.test.ts`
   - logout 立即终止活动 SSE。
   - A→logout→B 不接收 A 事件。

### 对象正确性

3. `drive-realistic-density.test.ts`
   - 1280px 三列壳下名称列宽大于可读阈值。
   - 同名目录显示唯一路径。
   - selected item 与 delete/upload action id 完全一致。
4. `cross-client-destructive-action-contract.test.ts`
   - Web/Spotlight/Cuu 同一确认状态机和同一文案合同。
5. `cross-client-project-context.test.ts`
   - 缺 project id fail closed；切出项目后不复用旧缓存。

### 状态与恢复

6. `batch-approval-partial-failure.test.ts`
   - 401/403/409/500 分类正确，未知错误不叫“已处理”。
7. `meeting-import-state-machine.test.ts`
   - queued→processing→ready/failed，可重试且有 request id。
8. `dirty-form-registry.test.ts`
   - 所有 textarea/input/form 默认注册，新增表单漏注册时测试失败。
9. `spotlight-back-query-dom.test.ts`
   - 返回后 input、filter、active、Enter destination 一致。

### 视觉与无障碍

10. `contact-sheet-completeness.test.ts`
    - figure count = step count，最后 step id 可在输出中验证。
11. `non-ready-shell-interaction.test.ts`
    - 403/404/empty/error 下 locale/logout/More/group 均工作。
12. `keyboard-and-voiceover-gold-path.test.ts`
    - Intake→审批→Proposal→Drive，覆盖标题层级、焦点、live status、快捷键开关。

---

## 12. Fresh 验证记录

本轮执行结果：

| 范围 | 结果 |
|---|---:|
| `@workhub/web` | 67 / 67 pass |
| `@workhub/ui` | 130 / 130 pass |
| `@workhub/desktop-webview` | 269 / 269 pass |
| `@workhub/cuu` | 52 / 52 pass |
| `@workhub/web-runtime` | 28 / 28 pass |
| `@workhub/api-client` | 18 / 18 pass |
| `@workhub/api` | 844 / 844 pass |
| Rust/Tauri lib + main + scaffold | 101 / 101 pass |
| **合计** | **1509 / 1509 pass** |

Typecheck：Web、UI、Desktop WebView、Cuu、API 均 exit 0。

当前 QA JSON：

- `generated_at`: `2026-07-10T05:19:18.215Z`
- steps: `82`
- gates: 全 true
- 但 `contact-sheet.png` 实际只含前两步，因此视觉完整性 gate 结论无效。

这些绿灯证明单元/局部合同没有普遍崩坏，**不能证明跨工作区授权、跨端状态、真实数据密度、原生窗口和用户闭环正确。**

---

## 13. 明确未验证项

- macOS/Windows/Linux 系统通知点击后的真实 activation 行为。
- 多显示器、不同 DPI、拔插屏后的 Cuu 实际落点。
- R10 后原生 Tauri 透明窗的最终合成、Live2D 长时间运行、tray 权限恢复。
- VoiceOver/NVDA 的真实朗读顺序与焦点体验。
- Windows/Linux 打包、通知权限和托盘行为。
- 是否已经由产品明确批准 Cuu 从 Option-first 改为 free-text；当前代码与 current docs 矛盾。
- P0 的真实 exploit 未执行；代码路径已经足以阻断发布，但修复后仍需要隔离环境中的攻击回归。

---

## 14. 最终产品判断

如果只看静态首页和理想 fixture，WorkHub 已经像一款接近可发布的产品；如果按普通用户真实操作去检查“我现在是谁、在哪个项目、在改哪个对象、失败后系统有没有说真话”，它仍更像一个完成度很高但边界未收口的内部 Pilot。

建议不要继续用更多视觉 small fix 覆盖这些问题。下一轮应该围绕四个单一事实源展开：

1. **身份与工作区资格**
2. **项目与对象目标**
3. **动作状态机与失败语义**
4. **跨端路由/配置/设计合同**

先解决 P0 和 Phase 1，再做第二轮普通用户实机复核。只有当“看见的对象、提交的对象、服务端授权的对象、通知到达的对象”四者一致时，WorkHub 才具备真正的用户信任基础。
