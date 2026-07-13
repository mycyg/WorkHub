# R13 · 工作台精修（视觉统一 + 军团面板 + 收尾补齐）规划

> 状态：规划 · 2026-07-13 起草 · 上游：R12（已合 main @ 34c27119，人工验收进行中）
> 触发：用户真机验收首轮反馈（浅色玻璃/窗口角角/窗口控制自适应/军团总览缺位）+ R12 功能审查第二三波 backlog
> 纪律：本文档只规划不施工；施工沿用 R12 的并行批次模式（04 手册铁律不变）

---

## 0. 用户反馈的病根诊断（本轮规划的起点）

| 反馈 | 病根 | 归入批次 |
|---|---|---|
| 军团总览还是「即将上线」 | 批 5 只交付了服务端读侧（/me/army、/conversations/:id/army 已挂载文档化），前端三区 UI 从未立项施工——功能审查 P0-4 已立案 | P1 |
| 期望和聚焦盒一样的浅色玻璃 | 工作台照深色原型实现：css.ts 用 `.wh-ds.wh-wb` 把 design-system.ts 的浅色 apple-glass token 整体覆盖成深色 + Rust 侧 vibrancy 用的是深色 HudWindow material。聚焦盒走的才是浅色基线 | V1 |
| 窗口边缘有奇怪的小角角 | 圆角工艺三层打架：原生 vibrancy 圆角(24) + CSS border-radius(24) + **CSS box-shadow（矩形投影在圆角外画出深色残角）**；webview 背景在原生裁剪外还有亚像素溢出 | V2 |
| 窗口控制自绘，应按 mac/windows 自适应 | workbench 窗 `decorations:false` 全自绘 min/close，无平台分支。macOS 该用原生红绿灯（Tauri 2 支持 titleBarStyle Overlay/透明标题栏），Windows 再谈 | V2 |

---

## 1. 批次划分

### 批 V1 · 浅色玻璃统一（用户当下最痛，第一优先）

**目标**：工作台与 Spotlight 聚焦盒同一视觉语言——浅色 apple-glass。

- Rust：workbench 窗 vibrancy material 从 `HudWindow` 换浅色系。候选按序真机试：`Sidebar` / `UnderWindowBackground` / `Popover` / `HeaderView`；appearance 先固定 light（跟随系统外观见 §3 开放问题）。聚焦盒用什么 material 就优先对齐什么。
- Webview：删掉/反转 css.ts 的 `.wh-ds.wh-wb` 深色 token 覆盖块，回归 design-system.ts 浅色基线；`.wh-wb-window` 的深色渐变兜底换成浅色半透兜底（vibrancy 失败时的浏览器/降级观感）。全部 `.wh-wb-*` 规则逐条过一遍对比度（深底白字 → 浅底深字，文字色/边框/hover 全要翻）。
- 聊天气泡、行动卡、产出卡、模式弹层、网盘、成员条——每个组件浅色化后真机截图对照聚焦盒（用 `screencapture` CLI，computer-use 抓不到 vibrancy 窗）。
- 原型基准同步：prototype/index.html 出浅色版（或声明聚焦盒为新视觉基准，原型只保留交互语义）。

**验收门**：真机截图——工作台与聚焦盒并排无违和；所有文本对比度可读；桌面壁纸透过毛玻璃可感知；typecheck+桌面测试全绿（css 钉点测试同步更新）。

### 批 V2 · 窗口工艺（角角 + 平台自适应控制 + 托盘入口）

- **小角角修复**：阴影交给原生（NSWindow hasShadow=true，删 CSS box-shadow）；圆角统一由原生层裁剪（vibrancy radius 为准），CSS radius 只做内容裁剪不再画边界。真机四角逐一验（用户截图里是右下角）。
- **平台自适应窗口控制**：macOS——workbench 窗改 `decorations:true + titleBarStyle:"Overlay"`（透明标题栏+原生红绿灯，trafficLightPosition 微调进玻璃），自绘 min/close 在 macOS 隐藏，拖拽区保留；Windows/Linux——保留现自绘方案（`decorations:false`），Rust 窗口构建处 `#[cfg(target_os)]` 分支。主窗/pet 窗不动。
- **托盘菜单加「打开工作台」**（功能审查 F-4）：与 open_settings 同款挂法，带上次选中项目。
- 顺手：workbench 窗登出感知（R11 身份线交叉点，若 R11 侧已有事件桥则订阅清理，没有则只立联合待办不硬做）。

**验收门**：真机四角无残角；macOS 见原生红绿灯且 hover 展开正常、全屏/最小化行为系统标准；托盘可唤起工作台；cargo test + 桌面测试全绿。

### 批 P1 · 军团面板前端三区（端点现成，纯前端）

- 右栏情境面板三区：输出（提议链接聚合）/ 军团（run 卡：猫名+状态+步骤摘要+成本+执行地徽标）/ 后台任务（诚实空态 not_yet_available 照契约渲染）；run 卡点击下钻详情（时间线+操作），「返回」保滚动位。数据：GET /conversations/:id/army（已挂载）。
- rail-foot 军团总览从占位变真页：GET /me/army 跨项目卡片流（按项目分组、游标分页、capped 提示）；点 run 跳既有 replay/trace。
- SSE：run 状态变化的实时刷新走既有会话事件 + 轮询兜底（army 端点无专属事件，规划里不新造事件，下拉刷新+行动卡事件触发重取即可）。
- 与聊天互通：行动卡条目「已开工」点击 → 右栏定位对应 run 卡。

**验收门**：三区真数据渲染；下钻/返回不丢状态；「即将上线」占位全数退役；空态照 00 §9；桌面测试全绿。

### 批 P2 · 拍板链路收尾（第二波遗留）

- 协同会话「+ 新建」入口（rail 真按钮 → POST /conversations kind=collab → 立即打开）。
- 通知契约加 `conversation_id`（额外可选字段，additive）→ dispatch_ask 气泡深链直达会话并高亮行动卡。
- turn 进行中第二条消息：canSend 禁用或本地单条排队自动重试（择一，倾向禁用+文案，最简诚实）。
- dispatch_ask 的 OS 通知严重度裁决：维持 normal（不打扰）但气泡必达——补「气泡错过后的追赶」（workbench 打开时对未读 dispatch_ask 通知补一条行内提示）。

**验收门**：从「Cuu 派活」到「张三接单开工」全程双端可走通、无死角；协同会话可 UI 创建。

### 批 P3 · 设置面补齐

- 桌面 Spotlight 设置视图加「AI」分区：五档默认（复用弹层组件）、接单策略三档、Granular 四开关、Cuu 主动性；项目治理（观察者开关/静默窗/安静时段）在工作台项目侧加「项目设置」入口，负责人可编辑，成员只读。
- web /settings 最小自救：default_mode + dispatch_policy 两项表单（PATCH /me/ai-profile 已有），其余项复用 desktopRequiredNotice「需要桌面客户端」提示模式，不再静默留白。

**验收门**：web-only 用户可自行脱离只观察档；治理参数可见可改；audit 记录变更。

### 批 P4 · 透明度与溯源（信任链）

- accepted_deliverables 加 reviewer_kind（human/ai），workitem 详情对 auto_merge+merged 给过去时提示「已由 AI 自动合并,无人工复核」。
- agent-army/cost KPI 加「AI 自动合并占比」。
- 观察者建的工单补 source_context（conversation_observer 分支，人话标注来源会话）。
- web /drive 版本区块补「回滚需桌面客户端」提示（两端能力不对称的诚实标注）。
- labor-split 裁决：00 §6 承诺的「成本按 assignee 记账」与现实（K5 生产/自进化拆分）不符——本批要么实现 per-assignee 记账（cost ledger 加 assignee 维度），要么改 00 文档收回承诺。**需用户拍板方向后施工。**

### 批 H1 · 健壮性与可达性（自审 P2 + 键盘补丁）

- SSE 客户端心跳看门狗（N 秒无帧主动断开重连，N 对齐服务端 heartbeat 间隔 ×2.5）。
- 观察者幂等派发：条目 id 由 (conversationId, analyzedToSeq, ordinal) 确定性派生，唯一约束天然防重。
- 键盘可达性：@ picker / 改派 picker / 模式弹层的方向键+tabindex（roving）。
- shell.ts 死代码 renderProjectSummaryHtml 清理。

---

## 2. 排序与里程碑

```
M1 = V1 + V2      视觉与窗口工艺（用户看得见的第一优先，真机迭代为主）
M2 = P1           军团面板（功能感知度最高的缺位）
M3 = P2 + P3      拍板收尾 + 设置面
M4 = P4 + H1      信任链 + 健壮性
```

- 每批仍按 R12 模式：并行 agent 分支 + 集成者验收合并 + 全量门 + CI 逐 job 核。
- V1/V2 特殊性：**真机迭代批**——vibrancy material 与圆角工艺没有测试可代真机，施工节奏是「小步改 → cargo 构建 → screencapture 截图 → 对照」，不适合全自动 agent 一次性交付，宜集成者驾驶+用户随手验。
- 测试团队首轮验收报告回来后，失败项修复插队到对应批次之前。

## 3. 开放问题（开工前请用户拍板）

1. **浅色是固定浅色，还是跟随系统外观？** 固定浅色最简（聚焦盒现状对齐）；跟随系统要求全套 token 双份+运行时切换，成本约多一半。建议先固定浅色，跟随系统列 future。
2. **Windows 支持的优先级？** 当前客户端只在 macOS 真机验证过；V2 的平台分支里 Windows 侧先保留自绘（不投入调试），还是本轮就要 Windows 真机过一遍？
3. **labor-split 方向**（批 P4）：实现按 assignee 记账，还是收回设计承诺？
4. **军团总览入口**：维持 rail-foot 摘要条点开，还是升级为左栏一级入口（原型是 rail-foot，现有占位同位）？

## 4. 不做（本轮明确出圈）

- 本地执行器（批 9 协议已冻结，仍后置）
- web 端会话/群聊 UI（桌面优先战略不变）
- 记忆冲突归并、meta-planner 等 R9 军团深水区
- `#` 会话引用 / `/` 技能的真实检索接线（维持「即将上线」，等技能体系下一波）
