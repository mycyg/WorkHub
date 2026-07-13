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

### 批 S1 · 聚焦盒 AI 入口（2026-07-13 用户新增方向）

**目标**：Spotlight 聚焦盒从「命令面板」升级为 AI 入口——输入自然语言，AI 自动决策该干什么。

- 意图路由：输入不匹配已知命令时走 LLM 意图分类（服务端端点,复用 turns 的轻量直调形态）→ 四类动作:**打开页面**（深链到聚焦盒能力/工作台会话）、**新增项目**（预填新建模态）、**任务管理**（建 work_item/查我的任务/改状态,走既有端点）、**简单问答**（直接流式回答,盒内内联,不建会话）。
- 交互:保持聚焦盒「生长」气质——识别中呼吸态,决策后盒子 morph 成对应能力/答案;每次动作有「AI 理解为:XX」的可撤回确认条（低把握先确认,高把握直做,复用置信度话术）。
- 红线不变:写操作全走既有提议/审批线;问答不落库不建会话（区别于协同会话）。
- 依赖:意图分类 prompt 进 packages/agent;桌面零 key 照旧走服务端。

### 批 S2 · Cuu 异步化与进度可视（2026-07-13 用户新增方向）

**目标**：任务与对话彻底解耦——对话不干涉后台任务，后台任务进度随时清晰可见。

- **通道分离**:协同会话的 turn（同步对话）与派发出去的任务（异步 run）互不阻塞——对话进行中后台任务照跑,任务事件不打断正在流式的回复（排队到 turn 落定后集中呈现）。
- **进度可视**:任务从行动卡/对话派生后,聊天里的「已开工」升级为**活的进度条目**——阶段流（认领→读料→产出→提议→合并）实时推进,点击展开右栏 run 详情（依赖 P1 的军团面板组件）。观察者/turn/run 三种 AI 活动在 UI 上有一致的「谁在干什么、到哪一步了」语言。
- **对话内任务操作不等待**:在对话里让 Cuu「顺便干个活」时,Cuu 立即回话确认并后台派 run（不占对话通道）,完成后以产出卡回灌——turn busy 闸只管对话本身,不再是任务瓶颈。
- 设计产物:先出一版「异步心智模型」交互稿（对话流/任务流分栏示意）再施工,避免直接上代码。

## 2. 排序与里程碑

```
M0 = 验收打回修复    （见 §5,已在进行,先于一切）
M1 = V1 + V2      视觉与窗口工艺（用户看得见的第一优先，真机迭代为主）
M2 = P1           军团面板（功能感知度最高的缺位,S2 的进度可视依赖它）
M3 = P2 + P3 + S1 拍板收尾 + 设置面 + 聚焦盒 AI 入口
M4 = P4 + H1 + S2 信任链（含 labor-split 真做）+ 健壮性 + Cuu 异步化
```

- 每批仍按 R12 模式：并行 agent 分支 + 集成者验收合并 + 全量门 + CI 逐 job 核。
- V1/V2 特殊性：**真机迭代批**——vibrancy material 与圆角工艺没有测试可代真机，施工节奏是「小步改 → cargo 构建 → screencapture 截图 → 对照」，不适合全自动 agent 一次性交付，宜集成者驾驶+用户随手验。
- 测试团队首轮验收报告回来后，失败项修复插队到对应批次之前。

## 3. 开放问题（2026-07-13 用户已全部拍板）

1. 浅色玻璃：**固定浅色**（跟随系统列 future，不做双套 token）。
2. Windows：**暂时只 macOS**（V2 平台分支里 Windows 保留自绘不投调试）。
3. labor-split：**真做**——实现按 assignee 记账（cost ledger 增执行者维度，成本/战绩页跟进口径），批 P4 从「二选一」改为确定实现。
4. 军团总览：**升级左栏一级入口**（与项目列表平级，rail-foot 摘要条退役或保留为快捷镜像，施工时定）。

## 5. M0 · R12 人工验收打回修复（2026-07-13 报告,五项分诊）

| 验收项 | 病根（已读码定位） | 归属与状态 |
|---|---|---|
| ENV-01 A/B/G 双账号无 membership | /identify 只建用户不建成员行（password 注册路径有正确先例）,conversations 鉴权全 404 | 服务端修复分支施工中:identify/desktop-bootstrap 幂等确保默认工作区 active membership |
| D-01 模式弹层打不开 | chip 点击→composer innerHTML 重建→同一点击冒泡到「点外关闭」时 target 已拆下→误判点外,弹层开了又关 | **已修**（isConnected 守卫,main） |
| E-01 同名上传 409 | 上传仓库层同名即 409,「同名→新版本」从未实现（版本行此前只有回滚产生） | 服务端修复分支施工中:同名活跃文件→追加版本（沿 rollbackToVersion 惯例）,撞文件夹仍 409 |
| F-01 毛玻璃不透景 | 深色近实底(.92/.94)叠 HudWindow;本就要在 V1 换浅色 material+薄底重做 | **并入 V1**（M1 首项）,不做深色下的二次修 |
| F-02 标题栏拖不动 | `-webkit-app-region` 是 Electron 私有属性,WKWebView 不认;window-bridge 的 startDragging 从未接线 | **已修**（titlebar mousedown→startDragging,main） |

修复完成判定:测试团队按原任务书对 A/B/D/E/F-02/G 复测通过;F-01 随 V1 验收。

## 4. 不做（本轮明确出圈）

- 本地执行器（批 9 协议已冻结，仍后置）
- web 端会话/群聊 UI（桌面优先战略不变）
- 记忆冲突归并、meta-planner 等 R9 军团深水区
- `#` 会话引用 / `/` 技能的真实检索接线（维持「即将上线」，等技能体系下一波）

## 6. 2026-07-13 晚 · 用户二次需求追加（真机试用反馈,已拍板方向待设计细化）

| # | 需求 | 批次归属 |
|---|---|---|
| N1 | **单人 AI 工作平台**（个人空间,可多个——非项目绑定的 1:1 Cuu 工作区） | 新批 S3·个人空间（设计先行:个人区与项目区的关系/数据模型 kind='personal'） |
| N2 | **Cuu 直接发文件**:群聊/私聊里用户自然语言要文件,Cuu 检索网盘直接发 file_card | 批 4c·Cuu 对话工具面（turns 加最小工具:网盘检索+发文件卡,红线=只读检索+发卡不动文件） |
| N3 | **澄清需求进对话**:桌宠决策气泡的「反问关键点→建事项」流程要在会话里呈现 | 批 4c 同批（澄清 turn 复用 intake 澄清语义,问答落会话消息） |
| N4 | **右栏加「变动文件」区**:参考 Codex/Claude 面板——军团+变动文件并列 | 批 P1.5（输出区升级:提议的 per-file 变动列表,diff 统计已有 adds/dels 底子） |
| N5 | **上下文管理优化**:看现状(turns 历史窗 50 条)→参考 codex 压缩设计(阈值触发 auto-compaction+摘要+压缩事件用户可见) | 新批 C1·会话上下文压缩（reference/openai-codex 的 compaction 实现先读再设计） |
| N6 | **Cuu 群聊自主做任务+主动汇报进度** | S2 已涵盖（进度可视+异步汇报）,验收时对齐此表述 |
| N7 | **Cuu 自主发布任务/转派**:自己干不了或不达标→发任务或找指定人;**找谁**=注册个人介绍+title+历史交付物综合判断 | 新批 A2·派人推荐 v2（userProfiles 字段盘点,缺 title/介绍则补迁移;评分=资料+历史 accepted deliverables;观察者 suggested_assignee 升级消费它） |
| N8 | **本地模式 agent 系统能力**(bash 等) | 并入批 9·本地执行器范围（工具面+审批分级参考 codex sandbox/approval,01 §3 已有映射底子） |

另有真机打磨两小项:聚焦盒唤起工作台后 reset 回首页搜索态;原生红绿灯模式下隐藏标题文字。归入 Wave C 集成后的收尾小批。
