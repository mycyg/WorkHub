---
module: 05-clients
layer: C-WEB / C-DESKTOP / C-PET / Cuu
status: audit
owner: workflow
date: 2026-06-07
visuals:
  - ./assets/audit/2026-06-07-current-state/current-state-contact-sheet.png
  - ./assets/audit/2026-06-07-cuu-motion/cuu-motion-contact-sheet.png
  - ./assets/audit/2026-06-07-cuu-motion/cuu-motion-printwindow.gif
  - ./assets/web/web-ai-first-home.png
  - ./assets/web/web-option-first-intake-wizard.png
  - ./assets/desktop/desktop-one-thing-work-desk.png
  - ./assets/cuu/cuu-desktop-approval-search.png
---

# 当前真实截图审计与后续施工计划

> 本文是 2026-06-07 的真实 UI / 桌宠截图审计。目的不是复述 PRD，而是把「现在实际长什么样」与「概念图希望长什么样」放在同一张桌子上，给后续施工一个能验收的路线。
>
> 核心结论：当前 WorkHub 已有 TS-first Page VM、Gold Path shell、Cuu card、Tauri pet window、Windows `PrintWindow` smoke 和若干真实 Cuu 图形资产，但整体仍是 **P0.5 预览壳**，不是概念图里的完整 AI-native 产品。Web / desktop 主窗仍偏测试面板；Cuu 已能在桌面独立出现，但动作表现和卡片展开还没有达到「QQ 宠物式活体入口」。

---

## 0. 本轮截图与录像资产

### 0.1 当前页面总览

![当前页面截图总览](./assets/audit/2026-06-07-current-state/current-state-contact-sheet.png)

截图来源：

| 截图 | URL / 来源 | 用途 |
|---|---|---|
| `web-home.png` | `http://127.0.0.1:5173/#/` | Web Gold Path 首页 |
| `web-intake.png` | `http://127.0.0.1:5173/#/intake/...` | Web 选项澄清页 |
| `web-approvals.png` | `http://127.0.0.1:5173/#/approvals` | Web 审批中心入口 |
| `web-workitem.png` | `http://127.0.0.1:5173/#/workitems/...` | Web 工作项详情 |
| `web-proposal.png` | `http://127.0.0.1:5173/#/proposals/...` | Web 交付物变更申请 |
| `web-replay.png` | `http://127.0.0.1:5173/#/agent-runs/.../replay` | Web replay |
| `web-cost.png` | `http://127.0.0.1:5173/#/dashboard/cost` | Web 成本页 |
| `desktop-home.png` | `http://127.0.0.1:1420/#/` | desktop webview 主窗首页 |
| `desktop-cuu-demo.png` | `http://127.0.0.1:1420/?cuuDemo=1#/` | desktop webview 内 Cuu demo |
| `pet-browser-preview.png` | `http://127.0.0.1:1420/pet.html` | browser pet surface 预览 |
| `tauri-pet-printwindow.png` | Tauri `Cuu` hwnd `PrintWindow` | 真实独立桌宠窗口截图 |

### 0.2 Cuu 动作多帧抓取

![Cuu motion contact sheet](./assets/audit/2026-06-07-cuu-motion/cuu-motion-contact-sheet.png)

动图文件：

- GIF：`docs/workhub/05-clients/assets/audit/2026-06-07-cuu-motion/cuu-motion-printwindow.gif`
- MP4：`docs/workhub/05-clients/assets/audit/2026-06-07-cuu-motion/cuu-motion-printwindow.mp4`
- 原始帧：`docs/workhub/05-clients/assets/audit/2026-06-07-cuu-motion/frames/frame-000.png` 到 `frame-031.png`
- 像素报告：`docs/workhub/05-clients/assets/audit/2026-06-07-cuu-motion/motion-diff-report.json`

本轮抓取参数：

| 项 | 值 |
|---|---|
| 捕获对象 | 真实 Tauri `Cuu` 顶层窗口 |
| 捕获方式 | Win32 `PrintWindow(PW_RENDERFULLCONTENT)` |
| 帧数 | 32 |
| 间隔 | 180ms |
| 总时长 | 约 5.76 秒 |
| 窗口物理尺寸 | 194 x 228 |
| 最大相对首帧平均差异 | `40.637` |
| 最大相邻帧平均差异 | `40.528` |
| 最大相对首帧变化像素 | `11882` |
| 最大相邻帧变化像素 | `11817` |

解释：

- 前半段确实有轻微动作，主要表现为 Cuu 的呼吸/缩放/轮廓边缘变化。
- 第 20 帧附近出现 `SSE stream returned HTTP 401` 的离线卡片，窗口仍停在 body-only 小尺寸，气泡和 Cuu 被挤在 194 x 228 范围内。
- 这说明单张 smoke 截图只能证明「启动时可见」，不能证明「长时间活着、遇到事件时布局正确」。
- 后续 QA 必须把多帧截图 / GIF / 像素差异作为桌宠验收门。

---

## 1. 设计基线

本轮审计采用这些概念图作为目标，不把当前实现截图误读为最终 UI。

### 1.1 Web AI-first 首页目标

![Web AI-first 首页](./assets/web/web-ai-first-home.png)

目标特征：

- 默认页是 AI 整理后的注意力中心，不是全量看板。
- 中央第一屏展示「需要你决定」「AI 正在做」「风险」。
- 看板入口只是高级视图按钮，不是首页主体。
- 右侧 Assistant / Cuu 区域承担摘要、下一步、证据上下文。
- 顶部有自然语言输入入口，用户可以直接说目标。

### 1.2 Web 选项优先提需求目标

![Web 选项优先提需求](./assets/web/web-option-first-intake-wizard.png)

目标特征：

- 主交互是选项卡，不是大文本框。
- 有 stepper、附件、截止时间、负责人、验收项。
- Cuu 推荐项以气泡承接，文字输入折叠为「其他 / 补充」。
- 右侧有 Request Summary 和 AI confidence，用户知道自己已经给了什么信息。

### 1.3 Rust 客户端单件事干活桌目标

![单件事干活桌](./assets/desktop/desktop-one-thing-work-desk.png)

目标特征：

- 主窗不是 Web shell 原样复刻，而是一个本地桌面工作面板。
- 默认只处理当前一个决定或一个本地动作。
- 顶部有连接状态、托盘状态、窗口控制、工作空间切换。
- 中心卡片是可审批 / 可打回 / 可查看证据的变更包。
- 底部保留后台同步、AI 正在做、本地文件状态。

### 1.4 Cuu 桌面审批与项目检索目标

![Cuu 桌面审批与项目检索](./assets/cuu/cuu-desktop-approval-search.png)

目标特征：

- Cuu 是桌面右下角独立存在的可爱小猫，不活在主窗里面。
- Cuu 有动作轨迹、主动靠近、挥手、提示，不只是静态图。
- 轻卡可展开为审批 / 证据 / 项目检索，不需要打开完整主窗。
- 复杂任务再 deep-link 到 WorkHub 主窗。

---

## 2. 当前实现总体判断

| 范围 | 当前截图事实 | 与概念图的距离 | 严重度 |
|---|---|---|---|
| Web 首页 | 有 Gold Path 左栏、中心单卡、右侧 Cuu 证据卡 | 还不是 AI-first Command Center；缺顶部自然语言输入、任务流、风险流、Next best actions、右侧 assistant 结构 | P1 |
| Web intake | 有选项卡和按钮 | 方向正确，但缺 stepper、附件/DDL/负责人/验收项、request summary、Cuu 推荐气泡和折叠文本输入 | P1 |
| Web proposal | 有交付物卡、按钮、部分输出 | 接近 PR-like 方向，但缺文件/证据/评论/风险/回滚的完整结构和可视 diff | P1 |
| Web replay | 有 trace/replay 页面 | 仍偏数据面板，缺人话 timeline、cost footer、snapshot/revert、脱敏 raw 展开 | P2 |
| Web cost | 有预算卡 | 只是基础页面，缺策略编辑、usage trend、告警说明、团队/用户视图切换 | P2 |
| Desktop 主窗 | 基本与 Web shell 一致 | 缺 Rust 客户端设计哲学：单件事干活桌、本地执行、同步、设备、托盘、诊断 | P1 |
| 主窗内 Cuu | 右侧是抽象小猫/卡片 | 不符合最终 Cuu 角色，主窗内只能做轻同步，不能替代独立桌宠 | P1 |
| 独立 Cuu | 能独立出现，启动可见，主窗隐藏后仍可见 | 形象有参考照特征，但动作弱；事件卡片触发后窗口不扩展导致内容被裁；还不够活 | P0 |
| Motion QA | 本轮新增 32 帧抓取 | 已发现单张截图漏掉的问题；需要纳入 repo QA | P0 |
| Hatch Pet 路线 | 本文与绿幕方案已写入 P1.1 路线 | 可以作为 Live2D 前的高质量宠物包路线，显著改善「抽象」问题 | P1 |

一句话：**当前产品的技术地基好于体验完成度；体验上还像一套可点击 PRD 样机。下一阶段必须先把 Cuu 和单件事主路径做“像产品”，再铺全页面。**

---

## 3. 页面逐项差距

### 3.1 AI-first Home

当前截图：`assets/audit/2026-06-07-current-state/web-home.png`

![当前 Web 首页](./assets/audit/2026-06-07-current-state/web-home.png)

当前优点：

- 左侧 Gold Path 导航清楚。
- 中央能显示当前待审批事项。
- 右侧 Cuu 区域已有证据卡意识。
- 按钮可以表达「打开审批 / 同意 / 打回」。

当前问题：

- 第一屏大量空白，信息层级不像一个成熟工作台。
- 标题「Cuu 等你审批客户周报模板」更像测试 fixture，不像 WorkHub 首页。
- 「AI 正在做」「需要你决定」「当前入口」只是三张等权小卡，没有工作流状态和优先级。
- 没有顶部输入框，用户无法直接告诉 WorkHub 要做什么。
- 没有「Next best actions」和「Evidence & context」的右侧推进行为。
- 左侧导航暴露 motion state 字符串，如 `carrying_document`、`asking_approval`，这对小白非常不友好。
- 视觉语言与概念图差距大：当前是浅色 demo shell，概念图是成熟 SaaS attention center。

目标改造：

| 位置 | 目标 |
|---|---|
| 顶部 | 加全局 command input：「告诉 WorkHub 你想完成什么...」 |
| 主区第一块 | `Needs your decision`，按优先级展示 1-3 个需要用户点的事项 |
| 主区第二块 | `AI is working on`，展示后台 run，不做重看板 |
| 主区第三块 | `Risks to notice`，只显示需要人类注意的风险 |
| 右侧 | `Cuu / WorkHub Assistant`，包括今日摘要、下一步、证据上下文 |
| 左侧 | motion state 不可见，只显示页面名和必要 badge |

验收标准：

- 1440px 桌面截图第一屏必须同时看到当前决定、后台 run、风险和 Cuu 证据。
- 不出现 `snake_case` motion state。
- 看板入口不是默认主体，只作为二级按钮。
- 首页不要求用户理解项目管理术语即可点下一步。

### 3.2 Option Intake

当前截图：`assets/audit/2026-06-07-current-state/web-intake.png`

![当前 Web Intake](./assets/audit/2026-06-07-current-state/web-intake.png)

当前优点：

- 已经不是聊天墙，主路径是点选项。
- 有推荐选项和继续按钮。
- 页面简单，不重。

当前问题：

- 选项只有 3 个，且语义偏模板，不像真实需求收集。
- 缺 stepper，用户不知道后续还要补什么。
- 缺附件、Deadline、Reviewer、Acceptance check 这些真实交付信息。
- 缺右侧 Request Summary，用户不能确认已填字段。
- Cuu 没有真实出现，推荐不是小猫气泡。
- 「其他 / 补充」未折叠承接。

目标改造：

| 模块 | 目标 |
|---|---|
| Stepper | `What do you need? -> Add details -> Attach files -> Review & submit -> AI clarification` |
| Option cards | 5 个一级意图：创建/更新、分析/研究、自动化/构建、审阅/批准、其他 |
| Details | DDL、附件、负责人、验收项，默认轻量可点 |
| Cuu 推荐 | 小猫在已选卡旁提示「我建议选这个」 |
| Summary | 右侧实时累积项目、类型、DDL、reviewers、acceptance checks |
| Free text | 折叠在底部，标签为「其他 / 补充」 |

验收标准：

- 首屏不出现大文本输入。
- 375px 移动端选项卡不横向溢出。
- 用户不用打字即可完成一条最小需求草稿。

### 3.3 Approval Center

当前截图：`assets/audit/2026-06-07-current-state/web-approvals.png`

当前优点：

- 已有审批卡、通过/打回按钮。
- 与 Gold Path 的 proposal/action 契约已有连接。

当前问题：

- 审批中心不是阻塞收件箱，缺筛选、排序、来源、负责人、风险。
- 缺「记住规则」「委派」「打回理由」的一等入口。
- 缺批量但轻量的 pending queue。
- 缺 Cuu 桌宠与审批中心之间的状态同步。

目标改造：

- 左侧：待我审批、我发起、已处理、规则。
- 中间：按 urgency 和风险排序的审批列表。
- 右侧：选中项摘要、证据、风险、可回滚性。
- 动作：通过、打回并选原因、委派、记住一次/总是。

验收标准：

- 审批卡必须可完全由按钮完成，不强迫打字。
- 打回必须有 3 个推荐理由 + 「其他」。
- Cuu 轻卡点击「打开审批」能定位到同一条审批。

### 3.4 WorkItem Detail

当前截图：`assets/audit/2026-06-07-current-state/web-workitem.png`

当前优点：

- 能展示工作项详情和 AI 执行轨迹。
- 有验收项意识。
- 与 proposal/replay/cost 链路有关联。

当前问题：

- 信息结构偏 render helper，缺真实详情页节奏。
- 缺状态四态、权限态、编辑态。
- 缺「AI 现在在做什么」的实时流。
- 缺交付物预览、变更包入口和风险解释。
- Cuu 的状态没有在详情页形成可感知的协作层。

目标改造：

| 区域 | 目标 |
|---|---|
| Header | 标题、状态、人话下一步、负责人、DDL、风险 |
| Current Focus | 当前需要处理的一件事 |
| AI Trace | 事件流、工具调用、证据、成本 |
| Acceptance | 验收项可勾选，可绑定证据 |
| Deliverables | 文件/文档/PPT/表格/图片预览 |
| Proposal timeline | 变更申请、审批、merge、rollback |
| Cuu | 只弹关键轻卡，不变成聊天墙 |

### 3.5 Proposal Detail / 非代码 PR

当前截图：`assets/audit/2026-06-07-current-state/web-proposal.png`

当前优点：

- 当前页面最接近概念：已有交付物变更申请、输出物、动作按钮。
- 已经不是代码 diff 限定，有文档/报告意识。

当前问题：

- 缺 GitHub PR 式结构：说明、文件、证据、评论、检查、回滚。
- 文件变化没有 renderer 区分：文档、表格、PPT、图片、文件夹。
- 缺风险和审核意见的清晰区域。
- 通过/打回按钮还不够贴近负责人决策。

目标改造：

| Tab | 内容 |
|---|---|
| Overview | AI summary、why now、risk、rollback |
| Files | 按 target type 展示变更，不限代码 |
| Evidence | 会议、网盘、历史任务、用户评论 |
| Checks | 验收项、policy、预算、权限 |
| Discussion | 审核评论与 Cuu 打回理由 |

验收标准：

- 文件 target renderer 至少覆盖 `docx/md/xlsx/csv/pptx/image/folder/json/config/code`。
- LLM 生成 PR 说明必须字段化：summary、files_changed、evidence_refs、risk、rollback、review_questions。
- 用户能一眼判断「同意后会改什么」。

### 3.6 Replay / Cost

当前问题：

- Replay 仍像日志面板，不像给人看的复盘。
- Cost 仍像预算 fixture，不像治理页面。

目标：

- Replay：人话 timeline + tool trace + evidence + snapshot + rollback + cost footer。
- Cost：普通用户看自己额度；管理员看团队策略、usage trend、告警、模型路由影响。

---

## 4. 桌宠 Cuu 当前动作审计

### 4.1 已证明的事实

| 项 | 当前结论 |
|---|---|
| 独立窗口 | 已有真实 Tauri `pet` window |
| 主窗隐藏后常驻 | smoke 通过 |
| 右下角定位 | smoke 通过 |
| 可见像素 | smoke 通过 |
| 多帧动作 | 多帧抓取显示前半段有轻微呼吸/轮廓变化 |
| 事件后布局 | 本轮发现离线卡片触发后窗口仍 body-only，卡片被裁 |
| 视觉可爱度 | 参考照特征有了，但当前不是概念图里的 Q 版活体宠物 |

### 4.2 Motion Capture 发现的问题

#### CUX-MOTION-001：事件卡片触发后窗口没有扩展

证据：

- `frame-000` 到 `frame-018`：Cuu 可见，有轻微动效。
- `frame-020` 起：离线卡片出现，内容被挤在 194 x 228 的小窗口里。
- `motion-diff-report.json` 在第 20 帧出现最大相邻帧差异，说明不是稳定 idle，而是事件 UI 突然进入。

可能根因：

- `pet-surface.ts` 已调用 `syncPetWindowMode("card")`，但 Tauri bridge 的 `setMode` 可能没有真正可用。
- `resolveDesktopPetWindowBridge()` 可能只解析到了 window `startDragging`，没有解析到 `__TAURI__.core.invoke`，导致 `set_pet_window_mode` 未执行。
- `syncPetWindowMode()` 对 `setMode` 是 fire-and-forget，失败没有状态、日志和 fallback。
- 即使 Rust command 成功，前端也没有等待 resize 后再渲染 card 布局，截图可能抓到过渡裁切。

修复方向：

1. 在 desktop webview 内新增 `resolveTauriInvoke()`，同时支持 `window.__TAURI__.core.invoke`、`window.__TAURI__.invoke`、`window.__TAURI_INTERNALS__.invoke` 或通过 bundler 引入 `@tauri-apps/api/core`。
2. `syncPetWindowMode()` 必须 catch error 并写入 `data-pet-window-mode-error`，测试能断言失败。
3. card 进入时先请求 Rust resize，再渲染 card 或至少保留 body-only safe mini bubble。
4. smoke 增加 `Wait-ForPetCardWindowSize`：触发一张卡后，窗口必须扩展到接近 380 x 560。
5. 如果 resize 失败，pet surface 必须走 compact card layout，不允许内容被裁到不可读。

验收：

- 触发 `sse-status:closed/401` 后，`Cuu` 窗口尺寸从约 180 x 220 扩到约 380 x 560。
- card 截图中标题、正文、按钮、Cuu 本体都完整可见。
- `PrintWindow` 多帧 contact sheet 中不能出现大面积黑/透明空白掩盖卡片。

#### CUX-MOTION-002：当前动作太弱，不像活体桌宠

证据：

- 动作主要是轻微 scale / breathe，无法表达走动、挥手、跳跃、审批、检索、同步。
- 概念图里的 Cuu 有明显身体动作、尾巴、表情、气泡互动；当前更像静态贴纸。
- 当前 main shell 内 Cuu 仍是抽象橘色图标，和独立 pet 的参考照风格不一致。

修复方向：

- 短期走 Hatch Pet 风格的固定 8 x 9 spritesheet，先让 Cuu 有 idle / waiting / review / failed / running / waving / jumping / dragging states。
- 中期把 WorkHub 18 状态映射到更清晰的小动作包。
- 长期走 Live2D PSD / Cubism，处理眼睛、耳朵、尾巴、流苏、呼吸、看鼠标。

---

## 5. Hatch Pet 路线可行性

用户提到的 [Hatch Pet recipe](https://github.com/freestylefly/CodexGuide/blob/main/docs%2Frecipes%2Fhatch-pet-photo.md) 很适合 WorkHub 当前阶段。它的价值不在于取代 Live2D，而在于提供一套 **可验证的宠物包生产规格**。

### 5.1 Hatch Pet 合同

Codex Hatch Pet 本地合同：

```text
spritesheet: 1536 x 1872 PNG/WebP
grid: 8 columns x 9 rows
cell: 192 x 208
background: transparent
unused cells: fully transparent

${CODEX_HOME}/pets/<pet-name>/
  pet.json
  spritesheet.webp
```

默认状态行：

| Hatch state | WorkHub Cuu 映射 |
|---|---|
| `idle` | `idle_breathe` / `idle_blink` |
| `running-right` | 拖拽向右 / 桌面走动 |
| `running-left` | 拖拽向左 / 桌面走动 |
| `waving` | `wave_hello` / 提醒用户 |
| `jumping` | `celebrating_jump` |
| `failed` | `offline_sleep` / `worried_ears` |
| `waiting` | `asking_approval_bounce` |
| `running` | `thinking_tail` / `syncing_files_spin` |
| `review` | `revision_requested_nod` / proposal review |

### 5.2 为什么它能改善现在的 Cuu

当前 WorkHub 的 18 clip motion pack 有几个问题：

- 单个 PNG 行太大，bundle 里很多 1MB+ 图，另有 20MB atlas。
- 动作生成来自不同批次，角色一致性有风险。
- runtime 既要处理大 atlas，又要处理 clip sheet fallback，复杂度偏高。
- 当前独立 pet 的视觉更像照片剪出来的小猫，Q 版宠物感不足。

Hatch Pet 路线的优势：

- 固定 192 x 208 cell，适合桌面右下角小宠物。
- 8 x 9 网格天然适合 CSS background-position 或 Canvas renderer。
- 透明 unused cells 可被自动校验。
- 9 个状态足够覆盖「活着」「等待用户」「出错」「审查」「庆祝」。
- 可以用用户参考照做 canonical base，再生成一致的 Q 版状态行。

### 5.3 WorkHub Cuu Hatch Pack 规格

目标新增资产：

```text
apps/desktop-webview/src/assets/cuu/hatch/
  cuu-hatch-v1/
    pet.json
    spritesheet.webp
    spritesheet.png                # 可选调试源
    contact-sheet.png
    motion-preview.gif
    qa-report.json
    source/
      canonical-base.png           # 原创 Q 版基准图，不放用户原照片
      row-idle.png
      row-waiting.png
      ...
```

Manifest shape：

```ts
export type CuuHatchPetManifest = {
  id: "cuu-hatch-v1";
  display_name: "Cuu";
  source: "hatch-pet";
  spritesheet_path: string;
  grid: {
    columns: 8;
    rows: 9;
    cell_width: 192;
    cell_height: 208;
  };
  states: Record<
    "idle" | "running_right" | "running_left" | "waving" | "jumping" | "failed" | "waiting" | "running" | "review",
    {
      row: number;
      frames: number;
      fps: number;
      loop: boolean;
      maps_to: string[];
    }
  >;
};
```

Renderer target：

```text
apps/desktop-webview/src/cuu-hatch-assets.ts
apps/desktop-webview/src/cuu-hatch-runtime.ts
apps/desktop-webview/src/pet-surface.ts
packages/cuu/src/hatch-state-map.ts
```

### 5.4 生成规则

Cuu Hatch Pack 的 prompt 必须锁定这些视觉特征：

- Q 版橘色虎斑小猫。
- 大眼睛，亲近但不幼稚。
- 白色蕾丝围兜。
- 黑色蝴蝶结。
- 珍珠流苏和小红珠。
- 全身可读，脚底 anchor 稳定。
- 透明或纯 chroma-key 背景。
- 不要文字、UI、气泡、阴影、场景、额外小猫。

不提交内容：

- 用户提供的原始参考照片。
- 失败生图批次。
- 本地临时 `reference` / `references` 目录。

可提交内容：

- 原创 Q 版 Cuu spritesheet。
- contact sheet / GIF preview。
- QA 报告。
- manifest 和 runtime。

### 5.5 与 Live2D 的关系

| 阶段 | 目标 | 为什么 |
|---|---|---|
| P1.1 Hatch Pack | 快速把 Cuu 从「静态/抽象」变成可爱的多动作宠物 | 成本低、格式固定、QA 容易 |
| P1.2 Hatch runtime | 替换当前 pet body 的大图/静态 fallback | 解决体积和一致性 |
| P2 Live2D PSD | 生成正式分层 PSD、补画遮挡、Cubism 绑定 | 提升眼神、耳朵、尾巴、流苏和鼠标互动 |
| P3 Hybrid runtime | Live2D 主表现，Hatch sprite fallback | 高表现力 + 可靠降级 |

结论：**Hatch Pet 是当前最适合的下一步，不是退回 GIF，而是给 Live2D 前的 Cuu 一个完整宠物包。**

---

## 6. 后续施工计划

### 6.1 P0 立即修复：Cuu card mode 与 motion QA

目标：先修掉「事件卡片被小窗裁切」。

| ID | 任务 | Target paths | 验收 |
|---|---|---|---|
| CUX-P0-01 | Tauri invoke bridge 审计 | `apps/desktop-webview/src/pet-window-bridge.ts` | 能可靠调用 `set_pet_window_mode` |
| CUX-P0-02 | card mode resize await / fallback | `apps/desktop-webview/src/pet-surface.ts` | card 渲染前窗口扩展，失败走 compact layout |
| CUX-P0-03 | Rust command diagnostic | `client-tauri/src-tauri/src/main.rs` | `set_pet_window_mode` 成功/失败可测试 |
| CUX-P0-04 | 多帧 motion capture QA 脚本 | `scripts/qa/cuu-tauri-motion-capture.ps1` | 输出 frames、contact sheet、GIF/MP4、diff report |
| CUX-P0-05 | smoke 扩展 card 验收 | `scripts/qa/cuu-tauri-smoke.ps1` | 触发 card 后窗口尺寸和可见像素都通过 |

必须新增测试：

- `pet-window-bridge.test.ts`：当 `invoke` 不存在时，`setMode` 缺失必须被显式报告，不允许静默。
- `pet-surface.test.ts`：card mode 可渲染 compact fallback，并带 `data-pet-window-mode-error`。
- Rust test：`set_pet_window_mode` command plan 的 route/size/position 与 active mode 对齐。

### 6.2 P1.1：Cuu Hatch Pack

目标：用 Hatch Pet 合同生成一个更可爱、更一致、更像桌宠的 Cuu v1。

步骤：

1. 准备 `docs/workhub/05-clients/assets/audit/2026-06-07-cuu-motion` 作为当前差距证据。
2. 生成 `cuu-hatch-v1` canonical base，形象参考用户猫照片但输出原创 Q 版，不提交原照片。
3. 生成 9 行动作：idle、running-right、running-left、waving、jumping、failed、waiting、running、review。
4. 合成 `1536x1872` spritesheet。
5. 输出 `pet.json`、contact sheet、motion preview、QA report。
6. 将 WorkHub Cuu states 映射到 Hatch states。
7. 在 `pet-surface.ts` 默认使用 Hatch renderer，旧 18 clip 保留为 fallback 或开发对照。

目标文件：

```text
packages/cuu/src/hatch-state-map.ts
apps/desktop-webview/src/cuu-hatch-assets.ts
apps/desktop-webview/src/cuu-hatch-runtime.ts
apps/desktop-webview/src/assets/cuu/hatch/cuu-hatch-v1/*
apps/desktop-webview/src/pet-surface.ts
docs/workhub/05-clients/cuu-desktop-pet-concept.md
docs/workhub/05-clients/cuu-green-screen-desktop-pet-solution.md
```

验收：

- `idle` 6 秒内至少有两类微变化：呼吸/眨眼/尾巴。
- `waiting` 明显表示「需要用户点」。
- `review` 明显表示「在审查/看交付物」。
- `failed` 不使用红叉或文字，表达离线/出错但不吓人。
- 所有 cells 四角透明，unused cells 完全透明。
- 角色一致性通过 contact sheet 肉眼审查。
- Tauri motion capture 不再出现静态 5 秒。

### 6.3 P1.2：桌宠轻卡重做

目标：让 Cuu 气泡像概念图，而不是把 Web notice 挤进小窗。

页面 / 卡片类型：

| 卡片 | 内容 | 动作 |
|---|---|---|
| Approval card | 摘要、风险、证据数、文件数 | 通过、打回、打开详情 |
| Clarify card | 一个问题、3-5 个选项 | 选择、其他、稍后 |
| Evidence card | 证据摘要、来源 chip | 用这些证据、打开完整检索 |
| Offline card | 离线说明、重连状态 | 打开设置、稍后 |
| Budget card | 当前额度、影响 | 降级模型、打开成本页 |

布局原则：

- body-only：只显示 Cuu 本体 + 极短 badge，不显示长文本。
- card：窗口扩到 `380 x 560`，Cuu 固定右下，卡片从左上展开。
- compact fallback：如果 resize 失败，最多 1 行标题 + 1 个按钮，不渲染长正文。
- 不允许横向溢出，不允许按钮被 Cuu 遮挡。

Target paths：

```text
apps/desktop-webview/src/pet-card-layout.ts
apps/desktop-webview/src/pet-surface.ts
apps/desktop-webview/src/pet-surface-qa.ts
apps/desktop-webview/src/pet-surface.test.ts
```

### 6.4 P1.3：Web 真页面路线

目标：把 Gold Path shell 从 render helper demo 变成真实 SPA。

优先顺序：

1. `apps/web/src/routes/home.tsx`：AI-first Home。
2. `apps/web/src/routes/intake.tsx`：Option Intake。
3. `apps/web/src/routes/proposal.tsx`：非代码 PR。
4. `apps/web/src/routes/workitem.tsx`：WorkItem Detail。
5. `apps/web/src/routes/replay.tsx`：Replay Work。
6. `apps/web/src/routes/cost.tsx`：Cost Dashboard。

共享组件：

```text
packages/ui/src/components/attention-card.ts
packages/ui/src/components/option-card.ts
packages/ui/src/components/cuu-side-panel.ts
packages/ui/src/components/proposal-change-renderer.ts
packages/ui/src/components/replay-timeline.ts
packages/ui/src/components/budget-summary.ts
```

验收：

- 首页 1440px 截图接近 `web-ai-first-home.png`。
- Intake 1440px 截图接近 `web-option-first-intake-wizard.png`。
- 移动端 375px 截图无横向滚动。
- 页面四态齐全：loading / empty / error / permission。
- 看板不是默认首页。

### 6.5 P1.4：Rust 主窗单件事干活桌

目标：desktop main window 不再只是 Web shell，而是符合 Rust 客户端概念。

Target Rust：

```text
client-tauri/src-tauri/src/window_controls.rs
client-tauri/src-tauri/src/tray.rs
client-tauri/src-tauri/src/config.rs
client-tauri/src-tauri/src/notify.rs
client-tauri/src-tauri/src/sse_worker.rs
```

Target TS：

```text
apps/desktop-webview/src/routes/one-thing-desk.ts
apps/desktop-webview/src/routes/settings.ts
apps/desktop-webview/src/routes/sync-center.ts
apps/desktop-webview/src/routes/diagnostics.ts
```

主窗页面：

| 页面 | 目标 |
|---|---|
| One Thing Desk | 当前需要用户决定的一件事 |
| Inbox | 审批、打回、冲突、预算、离线 |
| Local Files | 本地目录、同步状态、文件变更 |
| Settings | 设备 token、server、Cuu、通知、启动项 |
| Diagnostics | SSE、API、权限、pet runtime、日志 |

验收：

- 主窗隐藏后 Cuu 仍在。
- Cuu 点击复杂卡片可 deep-link 打开对应主窗页面。
- 设置页可切换 Cuu 显隐、勿扰、声音、减少动效。
- 托盘 tooltip 能显示连接 / 待审批状态。

### 6.6 P2：Live2D 主线

Live2D 不立刻阻塞 P1，但必须并行准备。

步骤：

1. 基于 Cuu Hatch canonical base，生成正面高分辨率生产图。
2. 按 `cuu-live2d-layered-asset-plan.md` 拆分 PSD。
3. 补画遮挡区域：围兜后身体、尾巴根、爪子后胸毛、蝴蝶结后蕾丝。
4. Cubism 绑定参数：呼吸、眼睛、眼皮、嘴、耳朵、尾巴、流苏。
5. 导出 `.model3.json`、`.moc3`、textures、physics、motions。
6. Tauri pet surface 加 `cuu-live2d-runtime.ts`。
7. Hatch sprite 作为 fallback。

验收：

- 眼睛会看鼠标。
- 尾巴和流苏有轻物理。
- idle CPU/GPU 可接受。
- reduced-motion 下停用复杂动作。

---

## 7. QA 与截图门禁

### 7.1 新增截图门

| QA | 输出 | 必须检查 |
|---|---|---|
| Web screenshot | `docs/.../assets/audit/<date>/web-*.png` | 首页、intake、proposal、replay、cost |
| Desktop screenshot | `desktop-*.png` | 主窗、Cuu demo、settings、sync |
| Pet startup smoke | `tauri-pet-printwindow.png` | 可见、topmost、右下角 |
| Pet motion capture | frames + GIF + MP4 + diff JSON | 5 秒内不是静态；事件卡不裁切 |
| Mobile screenshot | 375px PNG | 无横向滚动、按钮不溢出 |
| Concept comparison | Markdown audit | 当前 vs 概念差距更新 |

### 7.2 Motion QA 通过阈值

建议初始阈值：

| 指标 | 阈值 |
|---|---|
| idle 5 秒变化帧 | 至少 8 帧相对前一帧 `changed_pixels_gt8 > 300` |
| idle 最大变化 | `max_vs_first_changed_pixels_gt8 > 1000` |
| 事件卡尺寸 | card mode 宽 >= 360，高 >= 520 |
| Cuu 可见像素 | orange pixels >= 80，visual pixels >= 180 |
| 空白帧 | 不允许连续 3 帧 visual pixels < 180 |

### 7.3 文档更新门

每轮 UI / Cuu / Rust 主窗施工后必须更新：

1. 本文或新的 `current-state-visual-audit-<date>.md`。
2. `page-concepts.md` 的审计资产索引。
3. `prd-concept-reproduction-gap-audit.md` 的差距状态。
4. 涉及 Cuu 时更新 `cuu-desktop-pet-concept.md`。
5. 涉及 Rust 时更新 `desktop-pet-tauri.md`。

---

## 8. 下一轮推荐施工切片

不要先铺更多页面。当前最影响「像不像产品」的是 Cuu 和首页。

推荐顺序：

1. **修 CUX-MOTION-001**：card mode resize / invoke bridge / compact fallback / 多帧 QA。
2. **做 Cuu Hatch Pack v1**：把 Cuu 从静态照片感升级成 Q 版多动作宠物。
3. **替换 pet body renderer**：默认使用 Hatch sprite，旧 18 clip 保留 fallback。
4. **重做 pet card layout**：审批、澄清、证据、离线、预算五类轻卡。
5. **Web Home 真页面**：按 AI-first concept 改首屏。
6. **Option Intake 真页面**：补 stepper、附件、summary、Cuu 推荐。
7. **Desktop One Thing Desk**：主窗变成本地单件事干活桌。

这条路径最符合项目设计哲学：**用户先看到 Cuu 活起来，再看到 WorkHub 把复杂任务收成几个可点选择，而不是先学会一堆看板。**
