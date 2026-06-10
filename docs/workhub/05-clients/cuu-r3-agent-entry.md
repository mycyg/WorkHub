---
module: 05-clients
layer: C-PET / Cuu / Agent entry
status: current
owner: workflow
date: 2026-06-10
visuals:
  - ./assets/cuu/cuu-desktop-approval-search.png
  - ./assets/cuu/cuu-option-first-clarify.png
  - ./assets/shared/endpoint-page-cuu-alignment.png
---

# Cuu R3 Agent 入口施工计划

## 1. 目标

R3 补 `FR-PET-002`：Cuu 不只是提醒和审批入口，也能从独立桌宠窗口发起真实 AI 工作。

当前原则：

- Cuu 仍只存在于独立透明 Tauri `pet` window。
- Web 与 desktop 主窗继续保持严肃工作界面，不显示 Cuu 本体。
- 不新增猫模型、不改色、不扩展外观动作矩阵。
- 用户优先点选，不默认打字。
- Cuu 出站必须复用 Web 同一套 typed API：`/api/sessions`、`/api/workitems`、`/api/workitems/:id/agent-runs`。
- Cuu 不拥有权限旁路；所有请求继续走 API client、auth、WorkItem/Proposal/Approval gate。

## 2. R3.1 已落切片：option-first 启动卡

本轮已完成第一刀：点击 Cuu body 时，如果当前没有业务卡片，pet surface 会展开一个 option-first 启动卡。

| 项 | 已落行为 |
|---|---|
| 卡片工厂 | `createDesktopCuuAgentLauncherCard()` |
| 卡片位置 | `apps/desktop-webview/src/desktop-cuu-runtime.ts` |
| 展开入口 | `apps/desktop-webview/src/pet-surface.ts`，点击 `[data-pet-drag-handle]` 且无当前 card 时显示 launcher |
| 选项 | `document-draft`、`structured-data`、`code-template` |
| 输入策略 | `input.mode="single_choice"`、`option_first=true`、`free_text_enabled=false` |
| 提交动作 | `start_agent_from_cuu` -> `/api/cuu/start-agent` |
| 中英双语 | `packages/cuu/src/i18n.ts` 新增 `cuuStart.*` 文案 |
| 公共导出 | `apps/desktop-webview/src/main.ts` 导出 launcher/action helpers |

R3.1 deliberately uses a local pseudo endpoint path (`/api/cuu/start-agent`) only inside the webview runtime resolver. It is not a backend route and does not bypass the daemon. The submit handler converts it into real API calls.

## 3. R3.2 已落切片：run stream 回流与错误卡

R3.2 补上第一版“启动后 Cuu 继续跟进”的 TS 合同。它不宣称真实 Tauri 视觉验收完成；当前完成的是 webview runtime 与 pet surface 可复用的订阅、刷新和错误映射。

| 项 | R3.2 行为 |
|---|---|
| 启动 helper | 新增 `startDesktopCuuAgentFromLauncher()`，封装 `createSession -> createWorkItem -> startAgentRun` |
| submit 返回 | `submitDesktopCuuAction()` 对 `cuu-start-agent` 返回 `agentRun`，供 pet surface 订阅 `stream_href` |
| run stream | 新增 `subscribeDesktopCuuAgentRunStream()`，使用 `EventSource(run.stream_href)`，过滤 `topic=run:{id}` / `run_id` 事件 |
| card refresh | 每个匹配 run 事件触发 `client.getAgentRun(run_id)`，再用 `cardFromAgentRunLive()` 更新 Cuu |
| 终态关闭 | `succeeded` / `failed` / `escalated` / `budget_exhausted` / `cancelled` 等非 `queued/running` 状态关闭订阅 |
| 错误卡 | 新增 `cardFromDesktopCuuRuntimeError()`，把 `budget_exhausted`、401/403、offline/network、generic error 映射为 Cuu 轻卡 |
| pet surface | 启动成功后持有 run subscription；切换到非同 run card 或 dispose 时关闭旧订阅 |
| 公共导出 | `apps/desktop-webview/src/main.ts` 导出 R3.2 helper / subscription / error card types |

R3.2 仍保持边界：Rust shell 不解析 intent、不直接调业务 API、不拥有 AgentRun 状态机；真实 daemon SSE、真实 pet window 截图和录屏仍是下一刀。

## 3.5 R3.3 已落切片：SessionVM question 回退

R3.3 补上“不能绕过澄清”的关键分支。真实 API 的 `POST /api/sessions` 可能返回带 `question.options[]` 的 `SessionVM`，这代表后端要求用户继续点选口径。Cuu 不能因为用户已经在 launcher 点过一次选项，就直接 `createWorkItem -> startAgentRun`。

| 项 | R3.3 行为 |
|---|---|
| 后端澄清判定 | `startDesktopCuuAgentFromLauncher()` 在 `createSession()` 后检查 `session.question.options.length > 0` |
| Cuu 返回 | 如果需要澄清，返回 `outcome="clarification"`、`cardFromSessionVm(session)`，不调用 `createWorkItem()` / `startAgentRun()` |
| 折叠输入 | `free_text.enabled=true` 只表示可选补充输入，不单独触发阻断；主路径仍是 `options[]` |
| 下一题 | `submitDesktopCuuAction()` 对 `session-next-question` 接收真实 API `SessionVM`，返回 `cardFromSessionVm(session)`，桌宠继续显示下一题 |
| 启动成功 | 只有无后端澄清时才返回 `outcome="started"`、`workItem`、`run`、`cardFromAgentRunLive(run)` |
| 中英双语 | 新增 `cuuStart.clarificationNeeded` |

该切片直接对应概念图 `cuu-option-first-clarify.png`：一次只问一个问题，默认点选，不把用户推回打字框，也不把 Cuu 放进主窗。

## 3.6 R3.4 已落切片：确认后启动 AgentRun

R3.4 把确认题里的 `create-workitem` 选项接成真实 typed action。Cuu 不再只能停在澄清卡：当用户在确认题里点选“创建事项”时，桌宠会沿用同一个 session，先记录澄清答案，再固化 WorkItem，最后启动 AgentRun。

| 项 | R3.4 行为 |
|---|---|
| 触发条件 | `session-next-question.selectedOptionIds` 包含 `create-workitem` |
| 记录选择 | 先调用 `nextQuestion(session_id, {selected_option_ids})`，保留用户确认事实 |
| 固化事项 | 再调用 `createWorkItem({session_id, selected_option_ids, kickoff_agent:true})` |
| 启动执行 | 用返回的 `workitem.id/title` 调用 `startAgentRun(workitem.id, {title})` |
| Cuu 返回 | 返回 `cardFromAgentRunLive(run)` 与 `agentRun`，pet surface 继续订阅 run stream |
| 权限边界 | 仍走 typed API client；缺少 `createWorkItem` 或 `startAgentRun` capability 时 fail closed |

这一步完成了 Cuu 从“点选澄清”到“真实 AI 执行”的最小闭环。后续 R3.5 需要先证明该闭环不是 mock client 内循环，再继续补真实 Tauri pet window 截图/录屏。

## 3.7 R3.5 已落切片：launcher-to-run route-stack smoke

R3.5 先补上 API route-stack 级别的真实链路验收：不再只用 desktop-webview mock client 证明 Cuu helper，而是在 `@workhub/api` 包内搭建 Hono route stack，复用真实 `sessions -> workitems -> agent-runs` routes、typed API client、desktop Cuu runtime action resolver 与 card renderer，跑通：

```text
launcher card -> createSession -> clarification SessionVM -> nextQuestion -> confirmation SessionVM -> createWorkItem -> startAgentRun -> AgentRun Cuu card
```

本切片同步修正一个真实契约错误：`POST /api/sessions/:id/next-question` 的服务端实际返回 `SessionVM`，但 API client 与 desktop runtime 旧类型按 `QuestionCard` 处理。当前已统一为：

| 层 | R3.5 行为 |
|---|---|
| API route/service | `nextQuestion()` 返回 `SessionVM`，保持会话、topic、stream 与 question 一起返回 |
| API client | `WorkHubApiClient.nextQuestion()` 类型改为 `Promise<SessionVM>` |
| desktop runtime | `submitDesktopCuuAction()` 对下一题走 `cardFromSessionVm(session)` |
| smoke | `apps/api/src/qa/cuu-r3-launcher-to-run-smoke.ts` 通过真实 Hono route stack 和 typed client 证明链路 |
| root gate | `pnpm lint` 已串入 `pnpm qa:cuu-r3-launcher-smoke`，避免后续回退 |

本切片仍不宣称真实 Tauri 视觉完成：当前 smoke 是 API route-stack + desktop runtime 的进程内验证，不是实际桌面窗口点击、daemon SSE、截图或 motion capture。

## 3.8 R3.6 已落切片：双语边界 + session 选择历史

R3.6 先补两个会影响真实用户判断的低层缺口：Cuu 英文环境不能继续露出中文 fallback，且 option-first 的前一轮交付方向不能在最终创建事项时丢失。当前切片不新增 Cuu 外观，不把 Cuu 放回主窗，也不宣称真实 Tauri 点击/截图完成。

| 层 | R3.6 行为 |
|---|---|
| Cuu event fallback | `cardFromEvent(en-US)` 对未知、无 preview 的默认事件返回 `WorkHub update` / `Cuu received a new status update.`，不再透出中文默认 attention |
| AgentRun budget state | `AgentRunLiveVM.status="budget_exhausted"` 转 `kind="budget"`、`state="asking_approval"`，标题和 message 走 `cuuStart` / `budget` 双语文案 |
| Replay cost | `cardFromReplayTrace()` 的 remaining budget 行改走 `cuuFormat(locale, "cost.remaining")`，不再硬编码“剩余” |
| runtime error | `cardFromDesktopCuuRuntimeError()` 对 budget / permission / offline / generic 固定错误使用本地化 fallback；不把中文服务端 message 直接塞进英文 Cuu 卡 |
| DB session history | `WorkItemDataRepository.listSessionSelectedOptionIds()` 从 `clarification_answer` chat history 读取 `selected_option_ids` 与 `selectedOptionKey` 并去重 |
| createWorkItem finalization | `createWorkItem({session_id})` 合并历史选择与当前确认选择，`workitem_finalized` 和 planning note 保留完整 option path |
| route-stack smoke | `qa:cuu-r3-launcher-smoke` 现在回读 work item，断言 `planning_note="selected_options: document-draft,create-workitem"` |

R3.6 关闭的是数据流与双语边界，不覆盖真实桌面窗口视觉。下一步必须把同一链路升级到 dev server / Tauri pet window 级别，并补刷新恢复。

## 3.9 R3.7 已落切片：pet runtime flow harness

R3.7 先补一层可复跑的 pet runtime flow harness，证明 Cuu pet bubble 的真实 card render、option-first chip selection、typed action resolver 与 `submitDesktopCuuAction()` 可以连续跑完：

```text
launcher card -> select document-draft -> createSession -> clarification card -> select document-draft -> nextQuestion -> confirmation card -> select create-workitem -> nextQuestion -> createWorkItem -> startAgentRun -> trace card
```

本切片使用 `renderDesktopPetSurface()` 检查每一步的 pet bubble DOM 属性，并复用真实 `resolveDesktopCuuAction()` / `submitDesktopCuuAction()`。它不新增 UI、不改 Cuu 外观、不冒充真实 Tauri window click；真实 dev server / Tauri screenshot 仍是下一刀。

| 层 | R3.7 行为 |
|---|---|
| launcher render | 断言 `data-cuu-card-id="cuu-agent-launcher"`、`data-pet-option-id="document-draft"`、无 `textarea/input` |
| option selection | 断言已选 chip 渲染为 `data-selected="true"` |
| clarification | fake typed client 返回 `SessionVM.question.options[]` 后，Cuu 渲染 session question card |
| confirmation | `submit_option` 后渲染 `create-workitem` 确认卡 |
| run card | `create-workitem` 后调用 `nextQuestion -> createWorkItem -> startAgentRun`，最终渲染 `data-pet-bubble-kind="trace"`、`data-cuu-state="thinking"` |
| API order | 测试记录并断言 `createSession`、两次 `nextQuestion`、`createWorkItem`、`startAgentRun` 的 payload 顺序 |

## 3.10 R3.8 已落切片：boot client injection seam

R3.8 补一个很小的 boot 级接入缝隙：`bootDesktopPetSurface()` 支持可选 `client` 注入，默认仍创建原来的 `createApiClient({ baseUrl:"", getClientToken })`。这让后续真实 boot click harness、dev-server smoke 或 Tauri evidence 脚本可以复用同一个 pet runtime 入口，而不是只能绕到 helper 或静态 renderer。

| 层 | R3.8 行为 |
|---|---|
| runtime boot | `bootDesktopPetSurface(root, { client })` 可注入 typed client |
| 默认行为 | 未传 `client` 时仍走原有 `createApiClient()`，生产路径不变 |
| stream / preference | 注入 client 同时供 `submitDesktopCuuAction()`、`subscribeDesktopCuuAgentRunStream()`、`updatePreferences()` 使用 |
| public export | `main.ts` 导出 `DesktopPetSurfaceClient` 类型，供 QA/dev-server harness 使用 |

本切片仍不宣称真实 Tauri 视觉完成；它只移除“boot click harness 不能注入可控 typed client”的阻塞。

## 3.11 R3.9 已落切片：boot click harness

R3.9 把 R3.7 的 runtime harness 向真实 pet boot 入口推进一层：测试从 `bootDesktopPetSurface(root, { client })` 启动，经过 production click event delegation，而不是直接调用 renderer / action helper。

```text
idle body -> body click -> launcher card -> option click -> submit anchor -> clarification -> confirm -> run card
```

| 层 | R3.9 行为 |
|---|---|
| boot 入口 | 使用 `bootDesktopPetSurface()` 真实初始化 controller、idle scheduler、pointer sensor 与 click listener |
| fake DOM 范围 | 只提供 `Element` / `Node`、`root.innerHTML`、`closest()`、click listener、无真实定时器的 `window.setInterval()` |
| launcher 展开 | 点击 `data-pet-drag-handle` 后渲染 `cuu-agent-launcher`，且仍无 `textarea/input` |
| option-first 选择 | 点击 `data-pet-option-id="document-draft"` 后通过生产 click handler 写回 `data-selected="true"` |
| action submit | 点击真实 action anchor 触发 `submitDesktopCuuAction()`，依次进入澄清卡、确认卡与 AgentRun trace card |
| API 顺序 | 同一 fake typed client 断言 `createSession -> nextQuestion -> nextQuestion -> createWorkItem -> startAgentRun` |

本切片不冒充真实 Tauri window 截图，也不覆盖真实 dev server / SSE 回流。它关闭的是“boot 后真实 click handler 是否会串起同一条链路”的缺口。

## 4. 字段级契约

### 4.1 Cuu launcher card

```ts
type CuuLauncherCard = CuuCard & {
  id: "cuu-agent-launcher";
  kind: "question";
  state: "asking_approval";
  input: {
    mode: "single_choice";
    option_first: true;
    free_text_enabled: false;
    free_text_collapsed_by_default: true;
  };
  actions: [{
    id: "start_agent_from_cuu";
    method: "POST";
    href: "/api/cuu/start-agent";
    payload: {
      title: string;
      intent_text: string;
    };
  }];
};
```

### 4.2 Runtime action

`resolveDesktopCuuAction()` maps the card action to:

```ts
type DesktopCuuStartAgentAction = {
  kind: "cuu-start-agent";
  title: string;
  intentText: string;
  selectedOptionIds?: string[];
  projectId?: string;
  runTitle?: string;
  mode?: "worker" | "pm";
};
```

`intentText` is composed from:

1. action payload `intent_text`;
2. selected chip label/description;
3. URL query fallback, only for future deep-link or test harness use.

If no chip is selected, submit fails with the existing `pet.optionRequired` message. This preserves the "先点选项" principle.

### 4.3 Real API chain

`submitDesktopCuuAction()` executes with a clarification gate:

```mermaid
sequenceDiagram
  participant Pet as Cuu pet window
  participant Runtime as desktop-cuu-runtime
  participant API as WorkHub API
  participant Queue as AgentRun queue

  Pet->>Runtime: start_agent_from_cuu + selected chip
  Runtime->>API: POST /api/sessions {title,intent_text,project_id?}
  API-->>Runtime: SessionVM {session_id,question}
  alt question.options.length > 0
    Runtime-->>Pet: cardFromSessionVm(session)
  else no backend clarification
    Runtime->>API: POST /api/workitems {session_id,title,raw_description,selected_option_ids,kickoff_agent:true}
    API-->>Runtime: WorkItemDetailVM
    Runtime->>API: POST /api/workitems/:id/agent-runs {title,mode?}
    API-->>Runtime: AgentRunLiveVM
    Runtime-->>Pet: cardFromAgentRunLive(run)
  end
```

返回给 Cuu 的 card 有两种合法形态：

- `outcome="clarification"`：`payload_ref.entity_type="session"`，action 继续指向 `/api/sessions/:id/next-question`。
- `outcome="started"`：`payload_ref.entity_type="agent_run"`，用于后续 replay、abort、open task。

### 4.4 Run stream subscription

```ts
type DesktopCuuRunStreamSubscription = {
  runId: string;
  streamUrl?: string;
  close: () => void;
};

subscribeDesktopCuuAgentRunStream({
  client, // getAgentRun + streamUrl
  run,    // AgentRunLiveVM from startAgentRun()
  onCard(card, message) {
    // pet surface setCard(card, message)
  }
});
```

事件处理规则：

1. 只接受 `topic === "run:{run_id}"`、`event.run_id === run_id` 或 `event.data.run_id === run_id` 的事件。
2. 收到 run 事件后不信任 event payload 直接渲染，而是重新拉 `GET /api/agent-runs/:id`。
3. 拉回的 `AgentRunLiveVM` 仍走 `cardFromAgentRunLive()`，保持 Web / Desktop / Cuu 同一 DTO。
4. 终态自动关闭订阅，避免旧 run 继续抢占 Cuu。
5. EventSource 不可用时只报告 unavailable，不伪造成功。

### 4.5 Runtime error card

```ts
cardFromDesktopCuuRuntimeError(error, { locale, run? })
```

| 错误 | Cuu card |
|---|---|
| `WorkHubApiError.code="budget_exhausted"` | `kind="budget"`、`state="asking_approval"` |
| 401 / 403 / `permission_denied` | `kind="bubble"`、`state="worried"` |
| `TypeError` / network / EventSource error | `kind="offline"`、`state="offline"` |
| 其他异常 | `kind="bubble"`、`state="worried"` |

如果已知 `run`，错误卡会保留 `payload_ref.entity_type="agent_run"`，并提供“查看回放 / 打开事项”动作。

## 5. Rust / Tauri 边界

R3.1 仍由 TS webview runtime 处理业务 action。Rust shell 不解析 intent、不创建 work item、不启动 AgentRun。

Rust 只负责：

- `pet` 透明窗口几何；
- body/card mode 切换；
- drag；
- cursor near sample；
- tray 恢复；
- SSE/system notification 转发。

下一步如果要把点击 Cuu body 的首卡展示做成更强的系统行为，Rust 也只能发 `tray-action` 或 `push-event` 给 webview，不直接调用业务 API。

## 6. 当前验证

已通过：

- `corepack pnpm --filter @workhub/desktop-webview test`
- `corepack pnpm --filter @workhub/desktop-webview typecheck`
- `corepack pnpm --filter @workhub/api typecheck`
- `corepack pnpm --filter @workhub/db typecheck`
- `corepack pnpm --filter @workhub/cuu typecheck`
- `corepack pnpm --filter @workhub/cuu test`
- `corepack pnpm --filter @workhub/desktop-webview test`
- `corepack pnpm qa:cuu-r3-launcher-smoke`
- `corepack pnpm lint`

新增测试覆盖：

| 测试 | 覆盖 |
|---|---|
| `desktop Cuu actions start a real agent run from an option-first launcher card` | selected chip -> `createSession` -> `createWorkItem` -> `startAgentRun` -> AgentRun Cuu card |
| `pet surface renders the Cuu outbound agent launcher as option-first without text input` | launcher card DOM、无 `textarea/input`、可点击 action |
| `desktop Cuu launcher helper returns session, work item, run, and Cuu card` | helper 直接返回 session/workItem/run/card/message |
| `desktop Cuu launcher stops at backend clarification instead of bypassing the question` | `SessionVM.question.options[]` -> `cardFromSessionVm()`，且不调用 `createWorkItem()` / `startAgentRun()` |
| `desktop Cuu run stream refreshes agent cards and closes on terminal status` | EventSource run event -> `getAgentRun()` -> Cuu card refresh -> terminal close |
| `desktop Cuu run stream fallback maps failed runs to worried replay cards` | active-run fallback refresh -> failed AgentRun -> `worried` trace card + replay action |
| `desktop Cuu runtime maps API and stream failures to Cuu cards` | budget / permission / offline error card 分类 |
| `desktop Cuu actions advance option-first clarification sessions` | `nextQuestion()` -> `SessionVM` -> `cardFromSessionVm()`，澄清链路不断流 |
| `desktop Cuu actions finalize confirmed sessions and start the agent run` | `create-workitem` -> `nextQuestion()` -> `createWorkItem()` -> `startAgentRun()` -> AgentRun Cuu card |
| `qa:cuu-r3-launcher-smoke` | 真实 Hono route stack + typed API client + desktop runtime 跑通 launcher -> clarification -> confirmation -> AgentRun |
| `budget-exhausted live agent runs use budget Cuu cards` | `budget_exhausted` AgentRun -> budget Cuu card、英文固定文案、primary replay action |
| `replay cost cards localize remaining budget labels` | Replay cost section 不再出现硬编码中文 `剩余` |
| `generic English events use localized fallback instead of Chinese attention defaults` | en-US 未知事件 fallback 不含 CJK |
| `desktop Cuu runtime maps API and stream failures to Cuu cards` | budget / permission / offline / generic 错误卡英文环境不透出中文服务端 message |
| `pet runtime harness advances launcher selections through clarification into a run card` | pet render + option selection + typed runtime action 连续跑通 launcher -> clarification -> confirmation -> AgentRun |
| `pet surface boot flow opens launcher, resolves clarification, confirms, and renders a run card` | `bootDesktopPetSurface()` + production click delegation 跑通 body click -> launcher -> clarification -> confirmation -> AgentRun |
| `WorkHubEvent envelope creates browser-safe UUID ids` | `packages/events` 不再把 `node:crypto` 静态带进浏览器/Tauri pet 入口 |
| `pet surface renders only the Live2D cat runtime without main shell or fallback sprites` | 断言 Live2D iframe 不吃掉 body 点击，body overlay 负责打开 launcher |

本轮 Cuu test 当前为 33/33 通过，events test 当前为 12/12 通过，desktop-webview test 当前为 72/72 通过；R2 release gate 在 root `pnpm lint` 中为 PASS；`corepack pnpm verify` 通过。

## 7. 与概念图对齐

| 概念要求 | 当前状态 |
|---|---|
| Cuu 独立 pet window | 保持，未把 Cuu 放回主窗 |
| 选项优先澄清 | launcher 与后端 `SessionVM.question` 都走 option-first Cuu 气泡 |
| 主力是 AI，不是看板 | Cuu 能从澄清确认直接进入 AgentRun；需要澄清时只展示用户必须看到的问题 |
| 桌宠要像入口而不是装饰 | R3.10 已用真实 Tauri `pet` window 证明 body-only -> launcher card 展开；R3.11 已用真实本机 HTTP dev server 证明同一 launcher-to-run 数据流不只是进程内 route stack |
| 任务时候有对应动作 | R3.2 已把 run stream 刷新接回 `cardFromAgentRunLive()`，Cuu 可从 thinking 变为 celebrating/worried/offline；R3.6 已补 budget exhausted 预算态；R3.13.1 已用真实 Tauri run-failure 证明 failed AgentRun 会进入 `worried` trace card；R3.13.2 已用真实 Tauri capture 证明 401/403 进入 permission/worried 轻卡，stream offline 进入 offline card |
| 中英双语边界 | R3.10 已补真实 Tauri `pet` window en-US launcher capture；R3.6 已补未知事件 fallback、runtime error、Replay cost、budget exhausted AgentRun 的 en-US 测试；R3.13.1 已补 en-US run-failure capture；R3.13.2 已补 401/403/offline 的 zh-CN 与 en-US capture |
| 黑猫/白猫 Live2D 二选项 | 未改变模型白名单与外观 |

## 8. R3.10 已落：真实 Tauri launcher capture

本切片把 R3.9 的 fake DOM boot harness 升级为真实 Tauri `pet` window launcher capture。它仍不新增 Cuu 外观、不改变黑/白 Live2D 二选项，不把 Cuu 放回主窗。

改动：

- `client-tauri/src-tauri/src/main.rs`
  - 手动创建 `pet` window 时显式使用 `WebviewUrl::App("pet.html")`，避免 WebView2 target 退回 `about:blank`。
  - QA 环境允许 `WORKHUB_CUU_QA_SCENARIO=launcher` 与 `WORKHUB_CUU_QA_LOCALE=en-US`，并注入 DOM report flag。
- `apps/desktop-webview/src/pet-surface.ts`
  - `desktopPetLocale()` 支持 QA locale injection。
  - `wh-pet-body::after` 加透明点击 overlay，保证 Live2D iframe 上方的 body tap 命中 launcher 入口。
- `packages/events/src/envelope.ts`
  - 去掉浏览器入口不兼容的 `node:crypto` 静态导入，改为 `globalThis.crypto` / `getRandomValues` / fallback 生成 UUID。
- `scripts/qa/cuu-tauri-motion-capture.ps1`
  - `launcher` 进入 QA scenario allowlist。
  - 真实 Tauri `pet` window 捕获时使用 WebView2 CDP mouse event 驱动 body tap，并继续用 PrintWindow frames + DOM report 作为验收证据。
  - 报告记录 `webview2_cdp_enabled=true` 与 `scenario_events[0].input_driver="webview2_cdp"`。

验收证据：

- `docs/workhub/05-clients/assets/audit/2026-06-10-cuu-r3-10-sidecar/hijiki/launcher-en-US/motion-diff-report.json`
  - `passed=true`
  - `motion_gate_passed=true`
  - `actual_dom_matches_expected=true`
  - `cuu_qa_preferences.pet_locale="en-US"`
  - `cuu_qa_preferences.pet_qa_scenario="launcher"`
  - `scenario_events[0].action="tap_body_open_launcher"`
  - `scenario_events[0].input_driver="webview2_cdp"`
  - `actual_dom_report.bubble.data.data_cuu_card_id="cuu-agent-launcher"`
  - `actual_dom_report.primary_action.data.data_cuu_action_id="start_agent_from_cuu"`
  - `actual_dom_report.primary_chip.data.data_pet_option_id="document-draft"`
- `docs/workhub/05-clients/assets/audit/2026-06-10-cuu-r3-10-sidecar/hijiki/launcher-en-US/cuu-motion-contact-sheet.png`
  - frame 000-002 为 body-only 黑猫；frame 003 起展开英文 launcher card。
- 同目录保留 `cuu-motion-printwindow.gif`、`cuu-motion-printwindow.mp4`、`cuu-tauri-dom-report.json`、32 帧 `frames/` 与 `first-frame-probe.png`。

验证：

- `corepack pnpm --filter @workhub/events test`：12/12 通过。
- `corepack pnpm --filter @workhub/events typecheck`：通过。
- `corepack pnpm --filter @workhub/desktop-webview typecheck`：通过。
- `corepack pnpm --filter @workhub/desktop-webview test`：69/69 通过。
- `cargo test --manifest-path client-tauri/src-tauri/Cargo.toml`：66 + 9 + 3 通过。
- `powershell -ExecutionPolicy Bypass -File scripts/qa/cuu-tauri-motion-capture.ps1 -SkipBuild -Scenario launcher -Locale en-US -FrameCount 32 -IntervalMs 180 -OutDir docs/workhub/05-clients/assets/audit/2026-06-10-cuu-r3-10-sidecar/hijiki/launcher-en-US`：通过。

## 9. R3.11 已落：真实 API dev-server launcher-to-run smoke

本切片把 R3.5 的进程内 `app.request()` route-stack smoke 升级为真实本机 HTTP server 验收。它仍不冒充真实 Tauri window 截图，也不新增 Cuu 外观；目标是证明桌面 Cuu runtime 通过 typed API client 访问真实监听端口后，仍能完成 option-first launcher -> backend clarification -> confirmation -> WorkItem -> AgentRun。

改动：

- `apps/api/src/qa/cuu-r3-launcher-harness.ts`
  - 抽出共享 smoke harness：client-token auth 桩、真实 `sessions/workitems/agent-runs` routes、内存 WorkItem service、内存 AgentRun queue、Cuu launcher/action 断言。
  - 统一断言 launcher input 为 `mode="single_choice"`、`option_first=true`、`free_text_enabled=false`。
- `apps/api/src/qa/cuu-r3-dev-server-launcher-smoke.ts`
  - 用 `@hono/node-server` 在 `127.0.0.1:0` 启动真实 Hono HTTP server。
  - `createApiClient({ baseUrl, getClientToken })` 不传 `fetchFn`，请求经 Node 原生 `fetch` 进入本机 API server。
  - 验证 `/api/health`、`createSession`、`nextQuestion`、`createWorkItem`、`startAgentRun`、`getAgentRun` 和 `streamUrl()`。
- `apps/api/src/qa/cuu-r3-launcher-to-run-smoke.ts`
  - 保留进程内 route-stack smoke，但复用同一 harness，避免两套断言漂移。
- `packages/api-client/src/client.ts`
  - 收紧 envelope 判断，只把真正的 `{ ok, data/error }` 视为 WorkHub envelope；裸 `/api/health` payload 不再被误解包成 `undefined`。
- `package.json` / `apps/api/package.json`
  - 新增 `qa:cuu-r3-dev-server-smoke`，并接入 root `pnpm lint` / `pnpm verify`。

验收证据：

- `corepack pnpm --filter @workhub/api qa:cuu-r3-launcher-smoke`：通过，`transport="in-process-hono"`，回读 `planning_note="selected_options: document-draft,create-workitem"`。
- `corepack pnpm --filter @workhub/api qa:cuu-r3-dev-server-smoke`：通过，`transport="http-dev-server"`，`api_base_url="http://127.0.0.1:<ephemeral>"`，`stream_url` 指向同一真实监听端口。
- `corepack pnpm --filter @workhub/api-client test`：9/9 通过，包含裸 health payload 回归测试。
- `corepack pnpm --filter @workhub/api typecheck` / `test`：通过，API 测试 100/100。
- `corepack pnpm --filter @workhub/desktop-webview typecheck` / `test`：通过，desktop webview 测试 69/69。

数据流审视：

```text
Tauri/pet runtime action contract
  -> WorkHubApiClient(baseUrl=http://127.0.0.1:<port>, client-token)
  -> real Hono HTTP server
  -> sessions route
  -> SessionVM clarification card
  -> nextQuestion confirmation
  -> WorkItem creation with merged option history
  -> AgentRun enqueue
  -> getAgentRun readback + stream URL contract
```

PRD/概念图一致性：

- 符合 `cuu-option-first-clarify.png`：默认点选、一步一问、无输入框默认占位。
- 符合 `cuu-desktop-approval-search.png` / `endpoint-page-cuu-alignment.png`：Cuu 是独立 pet surface 入口，主窗不承载 Cuu 本体。
- 符合 TS-first runtime 概念：Rust/Tauri 不拥有业务 API 或 Agent 状态；server、contracts、typed client 和 webview runtime 仍是边界。

## 10. 尚未完成

R3.12 已补真实 Tauri `pet` window run-stream completion 终态截图/录屏与中英双语证据；R3.13.1 已补真实 Tauri `run-failure` 终态截图/录屏与中英双语证据；R3.13.2 已补真实 Tauri 401/403 与 stream offline 错误态中英双语证据；R3.13.3 已补 pet webview boot 层 session/run 恢复。仍不能宣称 R3 完成：launcher chip metadata 产品化和真实 reload capture 回归仍未验收。

| 缺口 | 计划 |
|---|---|
| 真实 Tauri 点击截图 | R3.10 已补真实 `pet` window launcher/en-US capture；R3.12 已补 zh-CN/en-US run-stream completion capture；R3.13.1 已补 zh-CN/en-US run-failure capture；R3.13.2 已补 zh-CN/en-US 401/403/offline capture |
| 真实 daemon SSE 回流 | R3.2 已落 EventSource + `getAgentRun()` 合同；R3.11 已补本机 HTTP server launcher-to-run；R3.12 已补 Tauri pet window 内 stream 订阅 + fallback refresh 的 DOM/capture 证据 |
| 失败态 | R3.2 已落 budget/403/offline/generic card mapping；R3.13.1 已落真实 run failure smoke + Tauri capture；R3.13.2 已落 401/403/offline route-stack fault smoke + 真实 Tauri capture |
| 真实确认后启动 | R3.5 已落 API route-stack smoke，R3.9 已落 boot click harness，R3.11 已落真实 dev-server smoke，R3.12 已落 Tauri run-stream 终态 capture |
| option payload 更细 | 每个 chip 可带 `delivery_kind` / `risk_hint` / `default_acceptance`，进入 WorkItem spec |
| 真实端到端 smoke | R3.5 已补进程内 Hono route-stack；R3.11 已补 API dev server；R3.12 已补 run-stream smoke 与 Tauri capture；R3.13.1 已补 run-failure smoke 与 Tauri capture；R3.13.2 已补 error fault route-stack smoke 与 Tauri capture |
| 可恢复状态 | R3.13.3 已补 `bootDesktopPetSurface()` 刷新/重启恢复：session question 用本地 card snapshot 恢复，AgentRun 用 `GET /api/agent-runs/:id` 重新拉取并恢复 active/terminal card；后续补真实 Tauri reload capture |
| 真实双语截图 | R3.10 已补真实 pet window 英文 launcher 截图；R3.12 已补 zh-CN 与 en-US run-stream completion 截图；R3.13.1 已补 zh-CN 与 en-US run-failure 截图；R3.13.2 已补 zh-CN 与 en-US 401/403/offline 截图 |
| 选择历史产品化 | R3.6 已合并 selected option IDs 到 planning note；后续可把 `delivery_kind` / `risk_hint` 结构化进 WorkItem spec |

## 11. R3.12 已落切片：真实 Tauri run-stream capture + 回流证据

R3.12 关闭 R3.11 后最关键的可视缺口：Cuu 不再只由 dev-server smoke 证明“能启动 run”，而是在真实 Tauri `pet` window 里从 option-first launcher 走到 AgentRun completion card，并把 DOM report、contact sheet、GIF/MP4 和 motion diff 一起落盘。capture 运行时也会在本地生成 API/Tauri stdout/stderr，便于调试，但 Git 跟踪证据以审计图像、视频和 JSON report 为准。范围只覆盖 R3 数据流与 capture 可信度，不新增模型、改色、动效或设置矩阵。

改动：

| 层 | R3.12 行为 |
|---|---|
| API QA server | `apps/api/src/qa/cuu-r3-tauri-run-stream-server.ts` 启动 `127.0.0.1:8787` 本机 Hono server，挂载真实 session/workitem/agent-run/push routes |
| HTTP/SSE smoke | `apps/api/src/qa/cuu-r3-run-stream-smoke.ts` 走真实 HTTP + SSE，等待 `agent_run.step kind=done` 与最终 `status=succeeded` |
| desktop runtime | `DesktopCuuFetchEventSource` 在 WebView 有 client token 时用 `fetch()` 订阅 SSE，并带 `X-WorkHub-Client-Token` / `X-YQGL-Client-Token` |
| run refresh | `subscribeDesktopCuuAgentRunStream()` 在 SSE 外增加 active-run fallback refresh，终态关闭订阅并刷新 completion card |
| pet surface | `run-stream` QA scenario 使用真实 `client` 与现有 Cuu action runtime：launcher -> clarification -> confirmation -> WorkItem -> AgentRun -> stream card |
| DOM report | `pet` root 输出 `data-cuu-run-stream-state`、`data-cuu-run-stream-run-id`、`data-cuu-run-stream-event-type`、`data-cuu-run-stream-refreshed-status`、`data-cuu-run-stream-close-reason` |
| Tauri shell | Rust 只注入 QA scenario/locale/client token；不调用业务 API、不拥有 session/run 状态 |
| capture script | `scripts/qa/cuu-tauri-motion-capture.ps1 -Scenario run-stream` 自动启动/探测 R3.12 API server，并保留 stream enabled |

验收证据：

| 证据 | 结果 |
|---|---|
| `corepack pnpm --filter @workhub/api qa:cuu-r3-run-stream-smoke` | 通过，最终 `final_status="succeeded"` |
| `corepack pnpm --filter @workhub/desktop-webview typecheck` | 通过 |
| `corepack pnpm --filter @workhub/desktop-webview test` | 71/71 通过 |
| zh-CN Tauri capture | `docs/workhub/05-clients/assets/audit/2026-06-10-cuu-r3-run-stream/hijiki/run-stream-zh-pass/` |
| en-US Tauri capture | `docs/workhub/05-clients/assets/audit/2026-06-10-cuu-r3-run-stream/hijiki/run-stream-en-pass2/` |

两个 capture 目录均保留 `cuu-motion-contact-sheet.png`、`cuu-motion-printwindow.gif`、`cuu-motion-printwindow.mp4`、`cuu-tauri-dom-report.json` 与 `motion-diff-report.json`。`motion-diff-report.json` 均满足 `passed=true`、`motion_gate_passed=true`、`actual_dom_matches_expected=true`、`sse_disabled_for_scenario=false`；DOM report 终态均显示 `data_cuu_state="celebrating"`、`data_pet_card_kind="completion"`、`data_cuu_run_stream_state="closed"`、`data_cuu_run_stream_close_reason="terminal_status"`、primary action 为 `view_replay`。

Bug / 数据流审查：

| 项 | 结论 |
|---|---|
| 已修 bug | 首轮真实 capture 中后端已经 `run_done succeeded`，但 WebView card 停在 queued/thinking；R3.12 加入 active-run fallback refresh，并把 run-stream 状态写入 DOM report，防止 SSE 事件缺失时卡片不终态刷新 |
| 数据流 | `pet` window QA click flow -> typed API client -> `/api/sessions` -> `/api/workitems` -> `/api/workitems/:id/agent-runs` -> in-process queue delayed run -> PushBus SSE -> desktop runtime stream subscribe/fallback refresh -> `GET /api/agent-runs/:id` -> completion card |
| PRD/概念图 | 仍符合 `cuu-option-first-clarify.png` 的 option-first；符合 `cuu-desktop-approval-search.png` 与 `endpoint-page-cuu-alignment.png` 的独立 pet window；主窗无 Cuu 本体 |
| Rust 边界 | Rust/Tauri 只负责窗口、QA preference 与 token 注入；业务 API、Agent 状态机和 DOM card 更新仍在 TS-first runtime |
| 禁止项 | 未新增模型、改色、动效、设置矩阵；未提交 `reference/` |

复跑命令：

```powershell
corepack pnpm --filter @workhub/api qa:cuu-r3-run-stream-smoke
corepack pnpm --filter @workhub/desktop-webview typecheck
corepack pnpm --filter @workhub/desktop-webview test
powershell -ExecutionPolicy Bypass -File scripts\qa\cuu-tauri-motion-capture.ps1 -Scenario run-stream -Locale zh-CN -ModelPackId cuu-hijiki-live2d-cubism2 -FrameCount 72 -IntervalMs 180 -OutDir docs\workhub\05-clients\assets\audit\2026-06-10-cuu-r3-run-stream\hijiki\run-stream-zh-pass
powershell -ExecutionPolicy Bypass -File scripts\qa\cuu-tauri-motion-capture.ps1 -Scenario run-stream -Locale en-US -ModelPackId cuu-hijiki-live2d-cubism2 -FrameCount 72 -IntervalMs 180 -OutDir docs\workhub\05-clients\assets\audit\2026-06-10-cuu-r3-run-stream\hijiki\run-stream-en-pass2
```

## 12. R3.13.1 已落切片：真实 Tauri run-failure capture

R3.13.1 先关闭 failure/offline 计划里的第一条真实终态：AgentRun provider 失败后，Cuu 必须在真实 Tauri `pet` window 里进入 `worried` trace card，并保留 replay 入口。范围仍只覆盖 R3 数据流与 capture 可信度，不新增模型、改色、动效或设置矩阵。

改动：

| 层 | R3.13.1 行为 |
|---|---|
| API QA harness | `createCuuR3SmokeApp({ runOutcome:"failed" })` 让同一 session/workitem/agent-run/push route stack 生成 failed AgentRun |
| HTTP/SSE + fallback smoke | `apps/api/src/qa/cuu-r3-run-failure-smoke.ts` 建立真实 HTTP SSE 连接，并通过 `GET /api/agent-runs/:id` fallback 验证最终 `status="failed"` 与 failure trace |
| desktop runtime | 新增测试覆盖 active-run fallback refresh：无 terminal SSE 事件时，failed AgentRun 必须刷新为 `state="worried"`、`kind="trace"`、primary action `view_replay` |
| pet surface | `run-failure` QA scenario 复用真实 `client` 与 Cuu action runtime：launcher -> clarification -> confirmation -> WorkItem -> AgentRun -> failed terminal card；同时修复 context-heavy trace card 的高 DPI 截图溢出，把含进度/预算的业务卡收敛到安全左锚、`minmax(0,1fr)` grid 和可滚动上限内 |
| Tauri shell | Rust QA allowlist 增加 `run-failure`；仍只注入 scenario/locale/client token，不调用业务 API |
| capture script | `scripts/qa/cuu-tauri-motion-capture.ps1 -Scenario run-failure` 自动启动 run-stream QA server，并通过 `WORKHUB_CUU_QA_RUN_OUTCOME=failed` 切换失败终态 |

验收证据：

| 证据 | 结果 |
|---|---|
| `corepack pnpm --filter @workhub/api qa:cuu-r3-run-failure-smoke` | 通过，SSE `connected`，REST fallback 最终 `final_status="failed"` |
| `corepack pnpm --filter @workhub/desktop-webview typecheck` | 通过 |
| `corepack pnpm --filter @workhub/desktop-webview test` | 72/72 通过 |
| zh-CN Tauri capture | `docs/workhub/05-clients/assets/audit/2026-06-10-cuu-r3-run-failure/hijiki/run-failure-zh-pass/` |
| en-US Tauri capture | `docs/workhub/05-clients/assets/audit/2026-06-10-cuu-r3-run-failure/hijiki/run-failure-en-pass/` |

两个 capture 目录均保留 `cuu-motion-contact-sheet.png`、`cuu-motion-printwindow.gif`、`cuu-motion-printwindow.mp4`、`cuu-tauri-dom-report.json` 与 `motion-diff-report.json`。`motion-diff-report.json` 均满足 `passed=true`、`motion_gate_passed=true`、`actual_dom_matches_expected=true`、`sse_disabled_for_scenario=false`；DOM report 终态均显示 `data_cuu_state="worried"`、`data_pet_card_kind="trace"`、`data_cuu_live2d_motion="worried_ears"`、`data_cuu_run_stream_state="closed"`、`data_cuu_run_stream_close_reason="terminal_status"`、primary action 为 `view_replay`。人工复核最终帧：zh-CN 与 en-US 的 `Run progress/执行进度`、`Budget/预算`、replay/back actions 和长英文 failure 文案均完整留在卡片边界内，右边框没有被 PrintWindow 裁切。

Bug / 数据流审查：

| 项 | 结论 |
|---|---|
| 已识别时序 | 内存 PushBus 不回放历史 run events；failure 比 success 更快到终态时，API smoke 可能只看到 SSE `connected`。R3.12 的 active-run fallback refresh 是正确兜底，R3.13.1 用 smoke 与 Tauri DOM 证明 fallback 能把 failed run 刷成 `worried` card。 |
| 已修 UI bug | 用户截图发现 failed trace card 底部 `Budget` 和英文长行会被旧的 288px/268px 固定卡片裁切。修复为 context-heavy 业务卡专用 300px 安全左锚布局、`grid-template-columns:minmax(0,1fr)`、长文本 `overflow-wrap:anywhere` 与 320px 垂直上限；重新生成 zh-CN/en-US 真实 Tauri frames 后确认无文本超框。 |
| 数据流 | `pet` window QA click flow -> typed API client -> `/api/sessions` -> `/api/workitems` -> `/api/workitems/:id/agent-runs` -> delayed run with forced provider failure -> PushBus SSE connected + fallback refresh -> `GET /api/agent-runs/:id` -> worried trace card |
| PRD/概念图 | 仍符合 option-first；Cuu 仍是独立 pet window；失败时给轻卡和 replay 入口，不把 Cuu 放回主窗 |
| Rust 边界 | Rust/Tauri 只负责窗口、QA preference 与 token 注入；业务 API、Agent 状态机和 DOM card 更新仍在 TS-first runtime |
| 禁止项 | 未新增模型、改色、动效、设置矩阵；未提交 `reference/` |

复跑命令：

```powershell
corepack pnpm --filter @workhub/api qa:cuu-r3-run-failure-smoke
corepack pnpm --filter @workhub/desktop-webview typecheck
corepack pnpm --filter @workhub/desktop-webview test
powershell -ExecutionPolicy Bypass -File scripts\qa\cuu-tauri-motion-capture.ps1 -Scenario run-failure -Locale zh-CN -ModelPackId cuu-hijiki-live2d-cubism2 -FrameCount 72 -IntervalMs 180 -OutDir docs\workhub\05-clients\assets\audit\2026-06-10-cuu-r3-run-failure\hijiki\run-failure-zh-pass
powershell -ExecutionPolicy Bypass -File scripts\qa\cuu-tauri-motion-capture.ps1 -Scenario run-failure -Locale en-US -ModelPackId cuu-hijiki-live2d-cubism2 -FrameCount 72 -IntervalMs 180 -OutDir docs\workhub\05-clients\assets\audit\2026-06-10-cuu-r3-run-failure\hijiki\run-failure-en-pass
```

## 13. R3.13.2 已落切片：真实 Tauri 401/403/offline capture

R3.13.2 关闭权限与网络错误态的真实窗口缺口。范围仍只覆盖 R3 数据流、错误映射、视觉裁切和 capture 可信度；不新增 Cuu 模型、不改色、不扩设置矩阵。

改动：

| 层 | R3.13.2 行为 |
|---|---|
| API QA harness | `createCuuR3SmokeApp({ apiFault })` 支持 `permission-401`、`permission-403`、`stream-offline`；`/api/health` 暴露 `api_fault` |
| error fault smoke | `apps/api/src/qa/cuu-r3-error-fault-smoke.ts` 通过真实 route stack + typed client 验证 401/403 -> `bubble/worried`，503 offline -> `offline/offline`，且保留 `payload_ref.entity_type="agent_run"` 与 `view_replay` |
| desktop runtime | `network_unavailable` / `stream_unavailable` / `offline` / `disconnected` 统一进入 offline 分支；permission error 仍进入 worried 轻卡 |
| pet surface | `permission-401` / `permission-403` / `stream-offline` QA scenario 复用真实 launcher -> clarification -> confirmation -> WorkItem -> AgentRun flow；气泡 DOM 暴露 `data-pet-payload-ref-*` |
| Tauri shell | Rust QA allowlist 增加三个错误态 scenario；仍只注入 scenario/locale/client token |
| capture script | `WORKHUB_CUU_QA_API_FAULT` 驱动本机 QA server；新增 right-edge light-pixel gate，真实 PNG 右边缘出现白色卡片裁切即失败；同时修复 stale QA server 子进程端口清理 |
| card layout | 普通 card bubble 从右锚改为 `left:88px;width:300px` 安全区，避免高 DPI/PrintWindow 下 DOM 通过但右侧实际裁切 |

验收证据：

| 证据 | 结果 |
|---|---|
| `corepack pnpm qa:cuu-r3-error-fault-smoke` | 通过；401=`unauthorized`、403=`permission_denied`、offline=`network_unavailable` |
| `corepack pnpm --filter @workhub/desktop-webview test` | 72/72 通过 |
| `cargo test --manifest-path client-tauri\src-tauri\Cargo.toml cuu_qa_preferences_env_accepts_qa_capture_scenarios` | 通过 |
| 401 zh-CN capture | `docs/workhub/05-clients/assets/audit/2026-06-10-cuu-r3-error-states/hijiki/permission-401-zh-pass/` |
| 401 en-US capture | `docs/workhub/05-clients/assets/audit/2026-06-10-cuu-r3-error-states/hijiki/permission-401-en-pass/` |
| 403 zh-CN capture | `docs/workhub/05-clients/assets/audit/2026-06-10-cuu-r3-error-states/hijiki/permission-403-zh-pass/` |
| 403 en-US capture | `docs/workhub/05-clients/assets/audit/2026-06-10-cuu-r3-error-states/hijiki/permission-403-en-pass/` |
| offline zh-CN capture | `docs/workhub/05-clients/assets/audit/2026-06-10-cuu-r3-error-states/hijiki/stream-offline-zh-pass/` |
| offline en-US capture | `docs/workhub/05-clients/assets/audit/2026-06-10-cuu-r3-error-states/hijiki/stream-offline-en-pass/` |

六个 capture 目录均保留 `cuu-motion-contact-sheet.png`、`cuu-motion-printwindow.gif`、`cuu-motion-printwindow.mp4`、`cuu-tauri-dom-report.json`、`first-frame-probe.png` 与 `motion-diff-report.json`。`motion-diff-report.json` 均满足 `passed=true`、`motion_gate_passed=true`、`actual_dom_matches_expected=true`、`right_edge_clip_gate.passed=true`、`right_edge_clip_gate.max_right_edge_light_pixels=0`。权限态 DOM 终态显示 `data_cuu_state="worried"`、`data_pet_card_kind="bubble"`、`data_cuu_live2d_motion="worried_ears"`、primary action `view_replay`；offline 终态显示 `data_cuu_state="offline"`、`data_pet_card_kind="offline"`、primary action `view_replay`。人工复核最终帧：中英文 permission/offline 文案、chip 与 actions 均完整留在卡片边界内，右边框未被 PrintWindow 裁切。

Bug / 数据流审查：

| 项 | 结论 |
|---|---|
| 已修 UI bug | 用户截图指出轻卡右侧文本被窗口裁切；R3.13.2 发现 DOM rect gate 不能覆盖高 DPI/PrintWindow 真实像素裁切，已新增右边缘亮色像素门并把普通 card bubble 改为安全左锚 |
| 数据流 | `pet` window QA click flow -> typed API client -> `/api/sessions` -> `/api/workitems` -> `/api/workitems/:id/agent-runs` -> forced API fault -> `cardFromDesktopCuuRuntimeError(error,{run})` -> permission/offline card |
| PRD/概念图 | 仍符合 option-first；Cuu 仍是独立 transparent `pet` window；错误态用轻卡和 replay/open task 入口，不把 Cuu 放回主窗 |
| 中英双语 | zh-CN/en-US 真实 frames 均已覆盖；英文不透出中文 fallback |

## 14. R3.13.3 已落切片：pet window session/run 恢复

R3.13.3 关闭 `pet` webview 刷新或重启后丢失当前 Cuu 上下文的缺口。范围只覆盖当前 card 的最小恢复，不新增 Cuu 外观、不新增 Rust 业务状态机、不改变黑猫/白猫模型白名单。

改动：

| 层 | R3.13.3 行为 |
|---|---|
| pet surface persistence | `setCard()` 在当前卡带 `payload_ref.entity_type="session"` 或 `agent_run` 时写入 `workhub.cuu.currentRun.v1`；切到无 payload 的 launcher/普通卡时清理旧恢复引用 |
| session restore | 当前卡是 SessionVM question 时保存 card snapshot；刷新后先恢复同一 option-first 问题卡，下一步点击仍走原 `submit_option` typed action |
| AgentRun restore | 当前卡是 AgentRun 时只保存 run id；刷新后调用 `client.getAgentRun(run_id)`，再用 `cardFromAgentRunLive()` 重建 active/terminal card，避免用旧快照伪装状态 |
| stream recovery | 如果恢复到 `queued/running`，继续调用 `subscribeDesktopCuuAgentRunStream()` 订阅或 fallback refresh；如果恢复到 `succeeded/failed/escalated/budget_exhausted/cancelled`，只显示终态卡并保留 replay/open task |
| QA boundary | 有 `__WORKHUB_CUU_QA_SCENARIO__` 时跳过本地恢复，避免污染 R3.12/R3.13.1/R3.13.2 的 deterministic capture |
| i18n | 新增 `cuuStart.restored` zh-CN/en-US 文案 |
| public export | `apps/desktop-webview/src/main.ts` 导出 `desktopPetRunRestoreStorageKey` 供后续 QA harness 复用同一 key |

验收：

- `corepack pnpm --filter @workhub/desktop-webview test`：75/75 通过，覆盖 session question restore、active AgentRun restore、terminal AgentRun restore。
- `corepack pnpm --filter @workhub/desktop-webview typecheck`：通过。
- `corepack pnpm --filter @workhub/cuu test`：33/33 通过。

复核：

| 项 | 结论 |
|---|---|
| bug 审查 | 恢复读取 fail-closed；localStorage 禁用或 JSON 损坏不会打断 pet boot；用户先点击产生新 current card 时，异步恢复结果会被丢弃 |
| 数据流 | `pet` card -> versioned local restore ref -> boot -> session snapshot 或 typed API `GET /api/agent-runs/:id` -> `cardFromAgentRunLive()` -> active run 重新订阅 stream |
| PRD/概念图 | 符合 TS-first runtime 与 endpoint/page/Cuu 独立映射：Rust 不读写业务状态，Cuu 仍只在独立 transparent `pet` window 展示 |
| UI/文本边界 | 本轮不改 bubble 布局；R3.13.2 的安全左锚与 `right_edge_clip_gate` 继续作为后续真实 capture 回归门 |
| 中英双语 | 恢复状态文案已补 zh-CN/en-US；现有英文固定卡测试继续通过 |

## 15. 下一刀 R3.14

R3 后续顺序：

1. 把 launcher chip metadata 产品化：`delivery_kind` / `risk_hint` / `default_acceptance` 进入 WorkItem spec，不再只落 planning note。
2. 补真实 Tauri reload capture：复用 `desktopPetRunRestoreStorageKey` seed 或完整点击后重载 `pet` window，证明 session/active run/terminal run 在真实窗口中恢复且不裁切。
3. 保留 R3.12/R3.13.1/R3.13.2 回归：run-stream completion、run-failure、401/403/offline 的 zh-CN/en-US capture 目录必须继续通过 `motion-diff-report.json`、DOM attrs gate 与 `right_edge_clip_gate`。
4. 继续检查主窗无 Cuu、reference path hygiene、secret-like diff，最后跑 full `pnpm verify`、Rust full tests、R2 release gate，并提交。
