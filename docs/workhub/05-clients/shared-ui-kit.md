---
module: 05-clients / C-UIKIT
layer: L4（入口层 / 跨端共享设计系统）
status: ✅ 初稿
owner: workflow
---

# 客户端：共享设计系统（C-UIKIT · `@yqgl/shared`）

> **一句话**：C-WEB（[web-app](./web-app.md)）与 C-PET（[desktop-pet-tauri](./desktop-pet-tauri.md)）**不各画各的轮子**——两端共用同一包 `@yqgl/shared`：同一套设计 token、同一组件库、同一 API client、同一批 hooks/types。本篇是这层「跨端唯一真相源」的页面规划级规格。
>
> 上游：[规格树索引 §1 产品呈现模式](../README.md)（C-UIKIT 代号）、[去黑话词汇表 §7](../00-overview/glossary-dejargon.md)（状态标签权威来源就在本包 `status-vocab.ts`）、[system-architecture](../01-architecture/system-architecture.md)（daemon+thin client 边界）、[api-contract](../01-architecture/api-contract.md)（OpenAPI 路由 + SSE 事件）、[data-model](../01-architecture/data-model.md)（实体字段）。
>
> **扎根**：本篇所有断言均指向真实代码 `shared/src/**`（现包名 `@yqgl/shared`，见 `shared/package.json:2`）。迁移到 WorkHub 后包名可能切到 `@workhub/shared`，但 export 形态延续——本篇即「现状 + WorkHub 增补」两层叠写。

本篇小节：

1. C-UIKIT 是什么 / 包结构与导出面
2. 设计 tokens（Aurora Glass：颜色/玻璃/阴影/间距/字阶/动效 + Space/主题切换机制）
3. 组件库清单（逐组件：用途 + props 要点 + 四态归属 + 两端复用）
4. API client（`api.*` 全量端点 + `withCommon` 鉴权 + 桌宠 `clientFetch` 注入）
5. 共享 hooks（逐个：用途 + 数据/SSE 绑定 + 两端差异）
6. 共享 types（实体类型面 + `AgentParsed`/`PushEvent` 等流式契约）
7. 跨端复用约定（什么必须共享、什么留给端、四态规约、SSE 订阅规约、去黑话强制层）
8. "页面规划"视角：壳层 wireframe 中 C-UIKIT 的落位（两端 App Shell 逐槽）
9. WorkHub 增补清单（审批阻塞原语 UI、置信度三档、升级简报、冲突调解、快照回滚入口）
10. 开放问题

---

## 1. C-UIKIT 是什么 / 包结构与导出面

C-UIKIT 不是一个「应用」，而是一个**私有 workspace 包**，被两端前端 `import` 进去。它没有自己的路由、没有自己的页面壳；它的「页面」是**组件画廊**与**契约**——两端的每一个真实页面都是把这些组件 + hooks + API client **组装**出来的。

### 1.1 物理结构（真实目录）

```
shared/
├─ package.json                 # name "@yqgl/shared", type module, exports map
└─ src/
   ├─ index.ts                  # 顶层桶：re-export api + hooks + ui + status-vocab
   ├─ api/
   │  ├─ index.ts               # export * types; export { api, isDesktopRuntime }; export { parseServerDate }
   │  ├─ client.ts              # ★ api.* 全量端点 + withCommon 鉴权 + json<T> 包装
   │  ├─ types.ts               # ★ 全量领域类型 + AgentParsed/PushEvent 等流式契约
   │  └─ time.ts                # parseServerDate（naive-UTC → 本地时区修正）
   ├─ hooks/
   │  ├─ index.ts               # 8 个 hook 的桶
   │  ├─ useIdentity.ts         # me / identify
   │  ├─ useChatStream.ts       # ★ 澄清对话 SSE（thinking/text/parsed/error/done）
   │  ├─ useReqStream.ts        # ★ 需求详情 SSE（requirement.updated/ai.* 累积）
   │  ├─ useTheme.ts            # auto/light/dark，写 <html data-theme>
   │  ├─ useSpace.ts            # work/dispatch 滤镜，写 <html data-space> + View Transition
   │  ├─ useSettings.ts         # tts 偏好（localStorage + 同标签 pubsub）
   │  ├─ useViewerRole.ts       # 角色判定纯函数 viewerRole/isSubmitter/isAssignee/isAdmin（非 hook，文件名沿用旧约定）
   │  └─ useFirstRun.ts         # 首跑引导「看过没」标志
   ├─ ui/
   │  ├─ index.ts               # 组件桶（原子 + 复合）
   │  ├─ cn.ts                  # classnames 合并工具
   │  ├─ bodyScrollLock.ts      # Modal/Drawer 共用的引用计数滚动锁
   │  └─ *.tsx                  # 24 个组件文件（见 §3）
   └─ design/
      ├─ tokens.css             # ★ Aurora Glass 全量 CSS 变量 + 玻璃类 + 动画
      ├─ tailwind-preset.ts     # 把 token 映射成 Tailwind 主题（两端 presets: [preset]）
      └─ status-vocab.ts        # ★ 状态枚举 → 用户标签（去黑话权威层）
```

### 1.2 导出面（`exports` 子路径，`shared/package.json:9`）

两端用**子路径深导入**，避免一次拖入全部：

| 子路径 | 内容 | 谁用 | 锚点 |
|---|---|---|---|
| `@yqgl/shared` | 顶层桶（api+hooks+ui+status-vocab） | 业务组件日常 import | `index.ts:4-7` |
| `@yqgl/shared/api` | 仅 client + types + time | 纯数据层 | `api/index.ts` |
| `@yqgl/shared/hooks` | 仅 hooks | — | `hooks/index.ts` |
| `@yqgl/shared/ui` | 仅组件 | — | `ui/index.ts` |
| `@yqgl/shared/design/tokens.css` | CSS 变量（**app root import 一次**） | `main.tsx` | 注释 `tokens.css:4` |
| `@yqgl/shared/design/tailwind-preset` | Tailwind preset | `tailwind.config.ts` | `tailwind-preset.ts:156` |
| `@yqgl/shared/design/status-vocab` | 标签映射 | 通知/桌宠等需要 label 但不想拖 UI | `package.json:16` |

> **依赖姿态**（`package.json:21`）：`react`/`react-dom` 是 **peerDependencies**（不自带，用宿主的，避免 React 双实例）；自身仅 dev 依赖 `typescript` + `@types/react*`。组件里用到 `lucide-react`（如 `WelcomeTour.tsx:2`）由**调用端**提供——见 §3 的「图标注入约定」。

---

## 2. 设计 tokens（Aurora Glass）

设计系统代号 **Aurora Glass**（电光紫 + 珊瑚粉的玻璃拟态），全部 token 落在 `tokens.css`，由 `tailwind-preset.ts` 暴露给 Tailwind。**两端零差异共用**。

### 2.1 落地机制（三件套）

1. **CSS 变量**（`tokens.css:7`）：所有值定义在 `:root` / `[data-theme="..."]` / `[data-space="..."]`。
2. **Tailwind preset**（`tailwind-preset.ts:10`）：`colors.accent → var(--accent)`、`boxShadow.e2 → var(--shadow-2)`…即写 `bg-accent shadow-e2` 等于引用变量；`darkMode: ["class", '[data-theme="dark"]']`（`:11`）。
3. **玻璃语义类**（`tokens.css:217`）：`.glass / .glass-strong / .glass-quiet / .glass-sunken` 直接组装 `surface + blur + shadow + radius`，组件大量 `@apply`/直接挂这些类。

### 2.2 Token 清单（节选自 `tokens.css`，给设计/实现对齐用）

| 组 | 关键 token | 值（light） | 暗色覆盖 | 锚点 |
|---|---|---|---|---|
| 画布 | `--bg-canvas / -2 / -3` | `#f2eef6` 等 → body 用三层 radial-gradient | `#11111a` 等 | `:9` / `:178` / `:101` |
| 玻璃面 | `--surface / -strong / -quiet / -sunken` | `rgba(255,255,255,.62)`… | 深色半透 | `:15` / `:105` |
| 文字 | `--ink / -soft / -muted / -faint` | `#1b1b22`… | 反相 | `:21` / `:110` |
| 线 | `--line / -strong / --hairline` | 低透黑 | 低透白 | `:27` / `:115` |
| 主色 | `--accent`(电光紫 `#6b5bff`) / `--accent-2`(珊瑚 `#ff6e8e`) + `-hover` + `-soft` | — | `#8b7bff` / `#ff8aa5` | `:32` / `:119` |
| 语义 | `--success/warn/error/info` + 各 `-soft` | 绿/橙/红/蓝 | 提亮 | `:39` / `:125` |
| 圆角 | `--radius-xs…xl / -pill` | 6→28px / 9999 | — | `:49` |
| 阴影 | `--shadow-1…5`（5 级 elevation） | 渐重 | — | `:57` |
| 模糊 | `--blur-1…4` | `blur(8px) saturate(135%)`→`blur(40px)` | — | `:68` |
| 间距 | `--space-1…16` | 4px 基准 | — | `:74` |
| 字体 | `--font-sans`(Inter+PingFang…) / `--font-mono`(JetBrains…) | — | — | `:86` |
| 动效 | `--ease-out-soft / -spring / -in-out-glide` + `--dur-fast/base/slow`(150/250/400ms) | — | — | `:92` |
| 字阶 | preset `fontSize`: `display/h1..h4/body/body-sm/caption/eyebrow` | 含 lineHeight+字重 | — | `tailwind-preset.ts:95` |

### 2.3 两个「滤镜/主题」开关（与 hook 绑定）

- **主题**（`useTheme`，§5）：写 `<html data-theme="light|dark">` + `data-theme-mode`，`auto` 跟随 `prefers-color-scheme`（`tokens.css:100` 暗色块、`useTheme.ts:21` apply）。
- **Space 滤镜**（`useSpace`，§5）：写 `<html data-space="work|dispatch">`，**仅换主色**——`dispatch` 把 `--accent` 从电光紫切珊瑚（`tokens.css:142`），其余 token 不动。切换时跑 `document.startViewTransition()`（`useSpace.ts:61`），配合 `::view-transition-old/new(yqgl-sidebar|yqgl-hub|yqgl-space-chip)`（`tokens.css:157`）让侧栏/主区**形变过渡**而非硬切。

### 2.4 内建动画 + 无障碍兜底

- 动画类：`.anim-fade-up / .anim-slide-right / .anim-scale-in / .anim-pulse-accent / .shimmer`（`tokens.css:289`），preset 同名 keyframes（`tailwind-preset.ts:122`）。
- **`prefers-reduced-motion`**：全局把动画/过渡压到 `0.01ms`（`tokens.css:191`）——四态里的「脉动加载」对该类用户自动降级。
- **`@supports not (backdrop-filter)`**：旧 Edge/Safari 把玻璃面降级为高不透明实色（`tokens.css:203`），保证可读。

---

## 3. 组件库清单（逐组件）

全部从 `@yqgl/shared/ui` 桶导出（`ui/index.ts`），分**原子**与**复合**两层。每个组件标注：用途 / 关键 props / 在「四态」中的角色 / 两端复用方式。`cn`（`cn.ts`）是底座工具——所有组件用它合并 className，调用端可随处 `className` 覆写。

### 3.1 原子组件

| 组件 | 用途 | 关键 props（要点） | 四态角色 | 锚点 |
|---|---|---|---|---|
| **Button** | 主操作按钮 | `variant`: primary/secondary/ghost/accent/danger/link/icon；`size` xs–lg；`loading`(内置 Spinner，自动 disabled)；`leftIcon/rightIcon` | 加载态：按钮 `loading` 转圈；空态 action 槽 | `Button.tsx:44` |
| **Card** (+Header/Title/Body/Footer) | 玻璃卡片容器 | `variant` glass/-strong/-quiet/-sunken；`padding` none/sm/md/lg；`interactive`(键盘可达，Enter/Space 触发 onClick) | 列表项常用；可作骨架/空态外壳 | `Card.tsx:20` |
| **Panel** | 下沉式子分区（无玻璃） | 直接 `glass-sunken p-4` | 卡内分组 | `Panel.tsx:5` |
| **Input** | 单行输入 | `prefixSlot/suffixSlot`；`error`(下方红字 + 红框)；`containerClassName` | 错误态：`error` 字符串 | `Input.tsx:4` |
| **Textarea** | 多行输入 | `autosize`(随内容长高)；`error` | 同上 | `Textarea.tsx:4` |
| **Select** | 原生下拉（内联 chevron data-URI） | `error` | — | `Select.tsx:4` |
| **Checkbox / Radio / Switch** | 勾选/单选/开关 | 原生 input + 玻璃描边；`label`/`description` | — | `Toggle.tsx:16/40/69` |
| **Badge / Pill** | 标签/胶囊 | `tone`: neutral/info/warn/accent/accent-2/success/error；`size`；`pulse`(长任务脉动) | 状态可视化基元 | `Badge.tsx:38/58` |
| **StatusBadge** | **需求状态徽标** | `status`(枚举字符串)；自动查 `STATUS_VOCAB` 取 label+tone+pulse；查不到回退原文 | **去黑话落地点** | `StatusBadge.tsx:10` |
| **Avatar / AvatarGroup** | 头像（昵称哈希渐变 6 色） | `nickname`(取首字/首两字母)；`online`(右下角圆点)；`src`；Group `max`+`+N` | 协作者呈现 | `Avatar.tsx:45/86` |
| **Tabs** (+List/Tab/Panel) | 标签页（Context 驱动） | `variant` underline/pill/glass；受控 `value/onChange` | — | `Tabs.tsx:20` |
| **EmptyState** | **空态**专用 | `icon/title/description/action`；外壳 `glass-sunken`+淡入 | **四态之「空」** | `EmptyState.tsx:12` |
| **Progress / CircularProgress** | 进度条/环 | `value`0–100；`tone`；`showLabel`/`label` | 加载/进度可视化 | `Progress.tsx:20/44` |
| **Skeleton / SkeletonText** | **骨架屏** | `height/width/rounded`；Text 版 `lines`(末行短) | **四态之「加载」** | `Skeleton.tsx:14/19` |
| **Tooltip** | 轻量提示（hover+focus 双触发，无 portal） | `label/placement/delay` | — | `Tooltip.tsx:16` |

### 3.2 复合组件

| 组件 | 用途 | 关键 props（要点） | 四态/交互角色 | 锚点 |
|---|---|---|---|---|
| **Modal** | 居中弹层 | `open/onClose`；`size` sm–xl；`title/description/footer`；`dismissOnBackdrop`；**ESC 关闭 + 焦点陷阱 + 焦点还原**；走引用计数滚动锁 | 确认/向导/命令面板外壳 | `Modal.tsx:27` |
| **Drawer** | 侧滑抽屉 | `side` right/left；`width`(Tailwind 类)；`title/footer`；ESC 关 | 详情/筛选侧栏 | `Drawer.tsx:17` |
| **ToastHost / toast()** | 全局轻提示（右下、portal、栈式） | `toast({tone,title,description,action,duration})`；`ToastHost` 近 root 挂一次（`max` 默认 4）；**栈式 push**容多 host | 异步结果/SSE 推送呈现 | `Toast.tsx:34/44` |
| **Stepper** | 步骤指示 | `steps[]`；`current`；`onJump`(≤current 可跳) | 多步流程（新建需求向导） | `Stepper.tsx:19` |
| **DropdownMenu** (+Item/Divider/Label) | 弹出菜单（clone trigger 注入 aria） | `trigger`；`align` start/end；Item `destructive`/`disabled` | 顶栏「看板」等二级菜单 | `DropdownMenu.tsx:13` |
| **Combobox** | 可搜索单选（泛型 `<T>`） | `value/onChange/options`；`clearable`；`searchInline`；`renderValue`；键盘上下/Enter/Tab；`emptyText`(内建空态) | 负责人/项目选择 | `Combobox.tsx:27` |
| **CommandMenu / useCommandMenu** | ⌘K 命令面板 | items `{id,label,group,searchText,onSelect,icon,hint}`；`useCommandMenu()` 绑 Ctrl/⌘+K | 全局跳转入口（见 §8 两端 Shell） | `CommandMenu.tsx:29/139` |
| **RouteTransition** | 路由切换淡入/View Transition | `routeKey`(通常 pathname) | 页面切换动效 | `RouteTransition.tsx:15` |
| **WelcomeTour / defaultWelcomeSlides** | 首跑引导 | `slides[]`(端各异)；`defaultWelcomeSlides("client"\|"web", icons)`——**client 版多「文件同步/托盘通知」两页**，web 版换成「通知与待办+下载客户端」 | 首跑 onboarding | `WelcomeTour.tsx:49/179` |

> **图标注入约定**：组件**不硬编码业务图标**——`WelcomeTour` 的 `defaultWelcomeSlides(variant, icons)` 要求调用端传入**六个** lucide 节点 `Sparkles / SwitchHorizontal / Bot / Bell / Folder / Command`（`WelcomeTour.tsx:181-188`）。两端各自传图标（web：`App.tsx:82-89`，把 `SwitchHorizontal` 映成 `ArrowLeftRight`；桌宠：`App.tsx:278-285`），kit 只定义结构与文案。这条约定让 kit 不绑定具体图标库。

> **CSS 类的「双轨」现状**：kit 自身的 24 个组件用 Tailwind 原子类（`bg-accent`/`text-ink`…）。但两端老页面里还存在 `button-ghost`/`pill`/`paper-surface`/`app-shell` 这类**应用级语义类**（见 `web/src/App.tsx:215/225`），它们不在 kit 内、由各端 `index.css` 定义。**WorkHub 收敛方向**：高频语义类（按钮、pill、卡面）应上提进 kit 或统一走 `Button`/`Badge`/`Card`，消除两端漂移（开放问题 §10-OQ1）。

---

## 4. API client（`@yqgl/shared/api`）

`api`（`client.ts:41`）是一个**扁平方法对象**——每个方法对应一个 daemon REST 端点，返回 `Promise<T>`，`T` 来自 `types.ts`。两端共用同一份；与 [api-contract](../01-architecture/api-contract.md) 同源（本篇给「前端调用面」，路由组与鉴权中间件以 api-contract 为准）。

### 4.1 三个底座函数

| 函数 | 职责 | 锚点 |
|---|---|---|
| `isDesktopRuntime()` | 判桌宠运行时：`localStorage.yqgl_runtime==="desktop"` **且** `window.__TAURI_INTERNALS__` 存在 | `client.ts:8` |
| `withCommon(init)` | 给每次 fetch 注入 `credentials:"include"` + **设备令牌头** `X-YQGL-Client-Token`（仅桌宠运行时从 `localStorage.yqgl_client_token` 取）——这就是[设备令牌门](../00-overview/glossary-dejargon.md)在客户端侧的落点 | `client.ts:25` / `localClientToken` `:16` |
| `json<T>(input, init)` | `fetch + withCommon`，`!r.ok` 抛 `Error("<status> <text>…")`，否则 `r.json() as T` | `client.ts:32` |

> **桌宠的真相**：webview origin 是 `tauri://localhost`，裸 `fetch('/api/...')` 会 404。所以**流式接口**（SSE）不走 `api.*`，而由桌宠注入 `clientFetch`（`@/lib/tauri`，预拼后端 baseURL + 鉴权）给 `useReqStream/useChatStream`（见 §5）。普通 REST 在桌宠侧则由各页通过 `clientJson` 包装（如桌宠 `App.tsx:36/56`），与 web 直用 `api.*` 形成两端差异——**WorkHub 收敛方向**：让 `api.*` 内部可配置 baseURL/fetch，两端统一（开放问题 §10-OQ2）。

### 4.2 端点分组（全量，按模块）

> 下表覆盖 `client.ts:42-393` 全部方法。映射到 [README §2.1 业务模块](../README.md)。

| 模块 | 方法（节选关键） | 返回类型 |
|---|---|---|
| **身份** P-IDENTITY | `identify` `me` `listUsers` `updateMyStatus` | `Identity` / `UserOption[]` |
| **项目** M-DRIVE | `listProjects(state)` `getProject` `createProject` `archive/restore/deleteProject` | `Project` |
| **网盘** M-DRIVE | `listDrive` `driveTree` `driveManifest` `driveChanges(since)` `createDriveFolder` `initDriveUpload`→`uploadDriveChunk`→`finalizeDriveUpload`（分片）`previewDriveItem` `driveDownloadUrl` `patch/paste/delete/restore/bulk*` `undoDrive` `list/addDriveComment` `bulkDownloadDrive` | `DriveList/Item/Tree/Manifest/Preview/Comment` |
| **需求** M-WORKITEM | `createRequirement` `listRequirements({mine,assigned_to_me,status})` `getRequirement` `list/updateAssignees` `updateRequirementSchedule/Planning` `patchStatus` `submitRequirement` `autoProcess` | `Requirement` |
| 评论/活动/交付 | `list/addComment` `listActivity` `listDeliveries` `acceptDelivery` `requestRevision(reason_md)` `claimRequirement` | `Comment/Activity/Delivery` |
| 附件 | `listAttachments` `uploadSimple(FormData)` | `Attachment` |
| 澄清对话（落库） | `listChatMessages` `postAnswer({selected_option_key/other_text/text})` | `StoredChatMessage` |
| **任务/排期** M-NOTIFY | `listCalendarEvents` `create/patch/deleteCalendarEvent` `dueReminders` `workload` `list/read/readAllNotifications` | `ScheduleEvent/Reminder/UserWorkload/Notification` |
| 工作面（Branch 雏形） | `listRequirementWorkspaces` `patchMyWorkspace` `create/patch/deleteWorkspaceItem` `addWorkspaceUpdate` | `RequirementWorkspace/WorkspaceItem` |
| **会议** M-MEETING | `listMeetings` `initMeetingUpload`→chunk→finalize `getMeeting` `patchMeeting` `confirm/dismissMeetingInsight` | `Meeting/MeetingInsight` |
| **知识库** M-KNOWLEDGE | `searchKnowledge` `askKnowledge`(异步起 job) `getKnowledgeRun` | `KnowledgeSearchHit/AskRun` |
| **看板/度量** M-DASHBOARD | `projectHealth` `getProjectHealth` | `ProjectHealth` |
| 任务拆解（AI 派活雏形） | `listTaskPlans` `createTaskPlan(stage)` `confirmTaskPlan` `dismissTaskPlan` `listAcceptanceItems` | `TaskPlan/RequirementAcceptanceItem` |

> **异步 job 模式**：`askKnowledge`/会议上传 finalize 等返回 `{job_id}`，前端轮询 `getJob(id)`（`client.ts:294`）读 `BackgroundJob.progress_percent`，UI 呈现「处理中…进度条」（不暴露 job 黑话，见 [glossary A 表 BackgroundJob](../00-overview/glossary-dejargon.md)）。

### 4.3 时间处理（`parseServerDate`，`time.ts:12`）

后端 `datetime.utcnow().isoformat()` 是 **naive UTC**（无 `Z`）。裸 `new Date()` 会按本地时区解释，CST 用户每个时间早 8h。`parseServerDate` 幂等补 `Z`、并把 `Invalid Date` 收敛成 `null`。**所有时间渲染必须过它**——这是两端共用的「时间正确性」契约。

---

## 5. 共享 hooks（`@yqgl/shared/hooks`）

`hooks/index.ts` 共导出 7 个真 hook + 1 组角色判定纯函数（`useViewerRole.ts` 文件名带 `use` 但导出的是普通函数，不是 hook——见末行）。**两类**：①数据/流式（绑 API/SSE）②UI 偏好（绑 localStorage + `<html>` 属性）。

| Hook | 类 | 用途 / 返回 | 数据/SSE 绑定 | 两端差异 | 锚点 |
|---|---|---|---|---|---|
| **useIdentity** | 数据 | `{me, identify, loading}`；挂载即 `api.me()` | REST `/api/auth/me`、`/identify` | web 直用；桌宠走原生 `invoke("identify")` 后再读（桌宠 `App.tsx:146`），故桌宠**不一定**用此 hook | `useIdentity.ts:5` |
| **useChatStream** | 流式 | `{thinking,text,parsed,error,done,running, run(), cancel(), reset()}`；驱动**澄清对话**逐字流 | `POST /api/requirements/:id/chat` SSE，事件 `thinking`/`text`/`parsed`(→`AgentParsed`)/`error`/`done`；`runSeqRef` 防串档 | **接受 `customFetch`**——桌宠传 `clientFetch`，web 用原生 fetch | `useChatStream.ts:20` |
| **useReqStream** | 流式 | `{events[], latestStatus}`；累积**需求详情**实时事件（最多留 200 条 `:52`） | `GET /api/push/stream/req/:id` SSE；遇 `requirement.updated` 抽 `status` 更新 `latestStatus` | 同上 `customFetch`（注释 `useReqStream.ts:9`：桌宠 origin 非后端） | `useReqStream.ts:17` |
| **useTheme** | UI | `{mode, setMode, resolved}` auto/light/dark | — | 无差异（写 `<html data-theme>`） | `useTheme.ts:40` |
| **useSpace** | UI | `{space, setSpace}` work/dispatch | — | **桌宠为主**（接活/派活双滤镜 + Ctrl+1/2，桌宠 `App.tsx:112`）；web 端 dispatch 为主、切换提示「仅桌面客户端」（`WelcomeTour.tsx:219`） | `useSpace.ts:38` |
| **useSettings** | UI | `{settings, update}`（`ttsAutoplay/ttsVoice`） | localStorage + 同标签 pubsub | 共用 | `useSettings.ts:35` |
| **viewerRole / isSubmitter / isAssignee / isAdmin**（`useViewerRole.ts`，**导出的是纯函数不是 hook**） | 纯函数 | `viewerRole(req,me)` 返回最高优先级角色（admin>submitter>assignee>observer，`:37`）+ 三个布尔谓词可叠加判定 | — | 共用——**角色判定单一真相源**（注释 `useViewerRole.ts:1`：各处别再各自推导） | `useViewerRole.ts:21/32/37` |
| **useFirstRun** | UI | `{seen, markSeen, reset}`（版本化 key `:v1`，跨标签同步） | localStorage | 共用；两端各自决定引导 slides | `useFirstRun.ts:40` |

> **SSE 解析共性**（两个 stream hook 共有，值得在 WorkHub 抽公共解析器，§10-OQ3）：手写 SSE line parser——`buf.indexOf("\n")` 切行、`replace(/\r$/,"")` 去 CRLF 的 CR、`event:`/`data:` 前缀解析、空行 `flush`、卸载时 `reader.cancel()+ctrl.abort()` 释放 body lock（`useReqStream.ts:62-85`、`useChatStream.ts:103-129`）。

---

## 6. 共享 types（`@yqgl/shared/api` types.ts）

`types.ts` 是**前后端契约的前端镜像**（与 [data-model](../01-architecture/data-model.md) 同源；字段权威以 data-model 为准，本篇给「前端会消费哪些形状」）。分三族：

### 6.1 领域实体类型（直接映射 daemon 实体）

`Identity` `UserOption` `RequirementAssignee` `Project` `DriveItem`(+List/Tree/Preview/Manifest/UploadInit/Comment) `Requirement` `BackgroundJob` `WorkspaceItem` `ProgressUpdate` `RequirementWorkspace` `Attachment` `Comment` `Activity` `Delivery` `ScheduleEvent` `Reminder` `Meeting`(+`MeetingInsight`) `RequirementAcceptanceItem` `TaskPlan`(+Item) `KnowledgeSearchHit`(+`AskRun`) `WorkloadRequirement` `UserWorkload` `Notification` `ProjectHealth`（`types.ts:1-477`）。

### 6.2 状态/枚举（去黑话的源）

- `Requirement["status"]`（`types.ts:130`）= 12 态联合，**正是 `STATUS_VOCAB` 的 key 类型**（`status-vocab.ts:16` `StatusKey = Requirement["status"]`）——类型层保证「状态枚举一改，标签映射编译报缺」。
- `estimate_confidence: "low"|"medium"|"high"`（`types.ts:135`）——置信度三档**已是现有精确先例**，WorkHub 的「有把握/看一眼/拿不准」三档语气直接落在它上（见 [glossary §3.3](../00-overview/glossary-dejargon.md)）。

### 6.3 流式/AI 契约类型（与 hooks 配对）

| 类型 | 形状要点 | 配对 | 锚点 |
|---|---|---|---|
| `AgentParsed` | 判别联合：`ask_choice`(选项+allow_other) / `ask_open`(开放问) / `summarize`(title+summary_md+complexity+ai_doable+ai_reason) | `useChatStream.parsed` | `types.ts:236` |
| `AskChoicePayload/AskOpenPayload/SummarizePayload` | 上者各分支 payload | 澄清 UI 渲染分支 | `types.ts:216/223/228` |
| `StoredChatMessage` | 落库消息（role/kind/content/selected_option_key） | `listChatMessages` 回放 | `types.ts:241` |
| `PushEvent` | `{event,data,at}`（SSE 累积单元） | `useReqStream.events` | `useReqStream.ts:3` |

> `SummarizePayload.ai_doable/ai_reason`（`types.ts:232`）与 `MeetingInsight.confidence_reason`（`types.ts:319`）是 WorkHub「**AI 决策必附人话理由**」（`FR-EXPLAIN-001`）的现有锚点——置信度/可解释类型已经在了。

---

## 7. 跨端复用约定

这是 C-UIKIT 的「宪法」——界定**什么必须共享、什么留给端、四态怎么写、SSE 怎么订、去黑话怎么强制**。

### 7.1 共享 vs 留给端

| 必须走 C-UIKIT（两端同形） | 留给各端自实现 |
|---|---|
| 设计 token / Tailwind preset / 玻璃类（视觉一致） | App Shell 骨架（顶栏 vs 侧栏，见 §8） |
| 原子+复合组件（按钮/卡/弹层/徽标…） | 路由表（web `BrowserRouter`+多页 vs 桌宠扁平路由+Space 切 Hub） |
| `api.*` 端点 + types（契约一致） | 原生能力（桌宠托盘/通知/deep-link/同步——见 [desktop-pet-tauri](./desktop-pet-tauri.md)） |
| `status-vocab`（去黑话标签） | 各端独有页面（web 看板群 / 桌宠 FloatingAssistant 桌宠人格） |
| 流式 hooks + SSE 解析 | `clientFetch`/`clientJson`/`invoke` 等运行时桥（桌宠 `@/lib/tauri`） |
| 时间解析 `parseServerDate` | 首跑引导的 slides 内容（端各异，但壳走 `WelcomeTour`） |

### 7.2 四态规约（空 / 加载 / 错误 / 无权限）

C-UIKIT **提供四态基元**，每个真实页面**必须**覆盖四态：

| 态 | 用什么组件 | 文案规约 | 现状/锚点 |
|---|---|---|---|
| **加载** | `Skeleton`/`SkeletonText`（结构占位，优于转圈）；行内异步用 `Button loading` | 不写「Loading…」，用骨架 | `Skeleton.tsx`；`Button.tsx:70` Spinner |
| **空** | `EmptyState`（icon+title+description+action） | 人话 + 给下一步动作（如「还没有需求，去新建」） | `EmptyState.tsx`；`Combobox` 内建 `emptyText`、`CommandMenu` 内建「什么也没找到」(`CommandMenu.tsx:96`) |
| **错误** | `toast({tone:"error"})` 兜底；表单内联 `Input/Textarea/Select error`；`json()` 抛出的 Error 统一被页面 catch→toast | 人话错误（不暴露 status 码/堆栈给用户面） | `Toast.tsx`；`client.ts:34` 抛错 |
| **无权限** | 设备令牌门触发时呈现「**这个操作要在桌面客户端里做**」引导（不报 403 黑话）；按 `viewerRole()`/`isSubmitter/isAssignee/isAdmin`（`useViewerRole.ts`）隐藏/禁用越权操作 | 见 [glossary E 表 设备令牌门](../00-overview/glossary-dejargon.md) | web 端 `ClientDownloadBanner`（`web/App.tsx:145`）；`useViewerRole.ts` |

> **WorkHub 增补**：四态之上加**「等待审批」态**——审批阻塞原语（§9）会让某些操作进入「等你点头」的挂起视觉（建议 `Badge pulse` + 操作禁用 + 简报卡），落 `FR-PERM-001`。

### 7.3 SSE 实时订阅规约

- **两条主流**：①澄清对话 `useChatStream`（写时流式，逐字 thinking/text）②需求详情 `useReqStream`（读时订阅，`ai.thinking/ai.tool_call/ai.done/requirement.updated` 等）。事件类型清单以 [api-contract](../01-architecture/api-contract.md) 为准；topic 形如 `req:<id>`（[glossary E 表 SSE](../00-overview/glossary-dejargon.md)）。
- **桌宠多一条**：进程级 `/stream/me`，由 Rust 侧 `sse.rs` 持有、`emit` 成 webview 事件（桌宠 `App.tsx:213` `useEvent("push-event")`），驱动**系统托盘红点 + Win11 弹窗**（见 [desktop-pet-tauri](./desktop-pet-tauri.md)）；web 端等价能力是 `useNotificationToasts`（`web/App.tsx:129`）走浏览器内 toast。
- **必须 `customFetch` 可注入**：任何新流式 hook 都要像现有两个一样接 `customFetch`，否则桌宠 webview origin 下必 404。
- **生命周期**：`req_id` 变更/卸载即 `abort + reader.cancel()`，防「旧需求的 parsed 事件画到新页面」（注释 `useChatStream.ts:138`）。

### 7.4 去黑话强制层（C-UIKIT 的护城河责任）

- **`status-vocab.ts` 是[去黑话词汇表 §7](../00-overview/glossary-dejargon.md) 的代码真相源**。任何 WorkItem 新状态（`ai_working/escalated/pm_mode/in_review/merged`…）**必须同步登记** `STATUS_VOCAB` + `STATUS_PROGRESS`（`status-vocab.ts:58`），否则用户面漏 snake_case。
- 所有状态渲染**只走 `StatusBadge`/`statusLabel()`**，禁止页面里手拼枚举。
- 置信度**只渲染三档语气**（§6.2），绝不显示数值。

---

## 8. "页面规划"视角：壳层 wireframe 中 C-UIKIT 的落位

C-UIKIT 没有自己的页面，但它**决定每个页面的槽位用什么件**。下面给两端 App Shell 的文字版 wireframe，并标注每个槽位 → C-UIKIT 组件/hook 的绑定。逐页面规划见 [web-app](./web-app.md) 与 [desktop-pet-tauri](./desktop-pet-tauri.md)；本篇只画**共享件如何落槽**。

### 8.1 C-WEB App Shell（顶栏式，派活/审批为主）

真实壳：`web/src/App.tsx`。

```
┌──────────────────────────────────────────────────────────────────────┐
│ [ClientDownloadBanner] ← web 专属：引导下载桌宠（无权限态的"去桌面端做")  │
├──────────────────────────────────────────────────────────────────────┤
│ TopNav (sticky, glass-quiet)                                           │
│  ◐ Logo「需求管理大师」 │ 项目 [看板▾] 日程 通知 │  [⌘K搜索] ☀主题 (昵称) ?引导 ⚙设置 │
│      └ NavItem            └ DropdownMenu        └ CommandMenu  └ThemeToggle              │
├──────────────────────────────────────────────────────────────────────┤
│ <Routes> 主区（每页自管四态）                                            │
│   / 项目首页 · /dashboard 派活看板 · /planning 排期 · /health 健康       │
│   /p/:id 项目 · /r/:id 需求详情 · /r/:id/clarify 澄清 · /notifications … │
│   *  → NotFound（友好 404，非白屏）                                      │
├──────────────────────────────────────────────────────────────────────┤
│ [ToastHost] 右下角 · [WelcomeTour 弹层] · [SettingsDialog 弹层]          │
└──────────────────────────────────────────────────────────────────────┘
```

槽位 → C-UIKIT 绑定：

| 槽 | 用件（C-UIKIT） | 数据/SSE |
|---|---|---|
| 顶栏「看板▾」 | `DropdownMenu`+`DropdownItem/Label/Divider`（`App.tsx:303`） | — |
| ⌘K | `CommandMenu`+`useCommandMenu`（`App.tsx:127/175`，导航命令在 `App.tsx:131`） | — |
| 主题切换 | `useTheme`（`App.tsx:265`） | localStorage |
| 首跑引导 | `WelcomeTour`+`defaultWelcomeSlides("web", …)`+`useFirstRun`（`App.tsx:64/82/105`） | localStorage |
| 全局提示 | `ToastHost`+`useNotificationToasts`→`toast()`（`App.tsx:111/129`） | 浏览器内通知流 |
| 身份门 | `useIdentity`→无 `me` 时 `NicknameDialog`（`App.tsx:78`） | `/api/auth/me` |
| 每页主体 | `Card/Badge/StatusBadge/EmptyState/Skeleton/Modal/Drawer…` | 各页 `api.*` |

### 8.2 C-PET App Shell（侧栏式，接活/干活为主 + 桌宠悬浮）

真实壳：`client-tauri/web-src/src/App.tsx`。

```
┌────────────────────────────────────────────────────────────────────┐
│ TitleBar（自绘标题栏 + SSE 连接指示灯 sseConnected）                    │
├──────────┬─────────────────────────────────────────────────────────┤
│ Sidebar  │ 主区 <Routes>（扁平路由；/ 由 HubRouter 按 Space 切）        │
│ (data-   │   / → space=work ? <Hub 接活> : <HubDispatch 派活>          │
│  space   │   /r/:id 工单详情 · /r/:id/clarify 澄清 · /r/new 新建        │
│  换主色) │   /p[/:id] 项目网盘 · /inbox 通知 · /settings · /me/*        │
│ 接活/派活 │                                                            │
│ 滤镜切换  │                                                            │
│ Ctrl+1/2 │                                                            │
├──────────┴─────────────────────────────────────────────────────────┤
│ [FloatingAssistant 桌宠悬浮] · [WelcomeTour("client")] · [ToastHost]   │
└────────────────────────────────────────────────────────────────────┘
   ▲ 原生侧（Rust）：托盘红点 / Win11 弹窗 / deep-link / 同步 ← /stream/me
```

槽位 → C-UIKIT 绑定（差异重点）：

| 槽 | 用件（C-UIKIT） | 与 web 的差异 |
|---|---|---|
| Space 滤镜 | `useSpace`（`App.tsx:98/112`，Ctrl+1/2 切换） | **桌宠为主场**；web 仅 dispatch、切换提示「仅桌面客户端」 |
| `/` 主区 | `HubRouter` 按 `space` 渲染 Hub/HubDispatch（`App.tsx:89`） | web 用 `BrowserRouter`+多顶级页 |
| 首跑引导 | `WelcomeTour`+`defaultWelcomeSlides("client", …)`（`App.tsx:278`） | **多「文件同步/托盘通知」两页** |
| 推送 | `useEvent("push-event")`→`toast()`+`osNotify()`+托盘红点（`App.tsx:213/238`） | web 仅浏览器内 toast，无 OS 弹窗/托盘 |
| 鉴权 | `invoke("identify"/"register_device")`+`clientFetch`/`clientJson`（`App.tsx:36/146`） | web 直用 `api.*`+cookie |
| 流式 | `useChatStream/useReqStream` 传 `clientFetch` | web 用原生 fetch |

> **结论**：两端**主体内容件 100% 共享**（同一批 Card/Badge/Modal/StatusBadge/EmptyState/Skeleton…、同一 `api.*`、同一 types、同一流式 hooks、同一 token）；**差异收敛在「壳 + 运行时桥 + 原生能力」三处**。这正是 [system-architecture](../01-architecture/system-architecture.md) 「headless daemon + 瘦客户端」在前端的具体兑现。

---

## 9. WorkHub 增补清单（C-UIKIT 要新长出的件）

WorkHub 的命门（AI 自治 + 分层审批 + 去黑话协作）需要 C-UIKIT 增补以下**跨端共享**件。每条标注落地的 FR / glossary 锚点：

| 新增件 | 用途 | 复用既有基元 | 锚点 |
|---|---|---|---|
| **ApprovalPrompt（审批阻塞卡）** | 「等你点头才继续」——阻塞原语的 UI：呈现 AI 想做的动作 + allow/deny/ask 三按钮 | `Modal`/`Drawer` 外壳 + `Button(accent/danger/secondary)` + 新「等待」态 | [glossary C 表 Approval](../00-overview/glossary-dejargon.md)、`FR-PERM-001` |
| **ConfidenceTone（置信度三档渲染）** | 把 `low/medium/high` 渲成「有把握/建议看一眼/拿不准请你定」三档语气（**绝不显数值**） | `Badge` tone 映射；扩展 `status-vocab` 思路 | [glossary §3.3](../00-overview/glossary-dejargon.md)、`FR-ESC-001` |
| **EscalationBrief（升级简报卡）** | 「AI 在请人来接手」：为什么需要人 + 建议谁来做 + 计划 | `Card`+`Avatar`(建议人)+`Stepper`(计划) | [glossary §3.2](../00-overview/glossary-dejargon.md)、`FR-PM-001` |
| **ConflictResolver（冲突调解器）** | 「和别人撞车了——AI 给了方案，选一个」：并排候选 + 选择/微调 | `Tabs`/`Card` + `Button` | [glossary §2 conflict](../00-overview/glossary-dejargon.md)、`FR-COLLAB-003` |
| **SnapshotRevert（还原入口）** | 「撤销/还原到改之前」：AI 副作用前快照列表 + 还原确认 | `DropdownMenu`/`Modal` + 版本号（雏形 `ProjectDriveVersion`） | [glossary §2 revert](../00-overview/glossary-dejargon.md)、`FR-WORKER-004` |
| **AgentTrace（执行步骤回看）** | 「AI 都做了哪些步骤」：把 `useReqStream` 的 `ai.*` 事件渲成可读 trace | 复用 `useReqStream.events` + `Card/Badge` | [glossary B 表 trace](../00-overview/glossary-dejargon.md)、`FR-EXPLAIN-001` |
| **新增 status 标签** | `ai_working/human_spotcheck/escalated/pm_mode/in_review/merged` 登记进 `STATUS_VOCAB` | 直接扩 `status-vocab.ts:27` | [glossary §7.2](../00-overview/glossary-dejargon.md) |

> 这些件的**类型**应进 `types.ts`（如 `ConfidenceRecord`/`EscalationEvent`/`PermissionPolicy`），与 [data-model](../01-architecture/data-model.md) 同步；**端点**进 `api.*`，与 [api-contract](../01-architecture/api-contract.md) 同步。原则不变：**新能力先落 C-UIKIT 共享层，两端零重复**。

---

## 10. 开放问题

| 编号 | 问题 | 现状 | 倾向 |
|---|---|---|---|
| **OQ1** | 应用级语义类（`button-ghost/pill/paper-surface/app-shell`）散落两端 `index.css`，与 kit 的 `Button/Badge/Card` 并存漂移 | 现状双轨（§3.2） | 高频件上提 kit，逐步以组件替换裸类 |
| **OQ2** | `api.*` 在桌宠侧不能直用（origin 问题），各页另包 `clientJson`；两端 REST 调用面不统一 | 桌宠绕道（§4.1） | 让 `api` 内部可配置 baseURL+fetch，两端统一入口 |
| **OQ3** | 两个 stream hook 手写重复 SSE line parser | 复制粘贴（§5 末） | 抽 `parseSSE()` 公共解析器，新流式 hook 复用 |
| **OQ4** | 组件库无可视化文档/Storybook，新人靠读源 | 无 | 评估接 Storybook 或最小自托管画廊 |
| **OQ5** | 包名 `@yqgl/shared` 与 WorkHub 品牌不一致 | 迁移期并存（见 [glossary §9 YQGL](../00-overview/glossary-dejargon.md)） | 切 `@workhub/shared`，保留 export 形态 |
