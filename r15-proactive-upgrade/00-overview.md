# R15 主动性升级总纲

2026-07-15 起草。基于五路代码侦察(审批链路 / 主动性基建 / pi 深读与逐项映射 / 私聊 presence 家底)+ 用户拍板。

## 背景与目标

用户提出的能力诉求:

1. 审批/合并的对话内持续提醒(现状:一次性通知 + 30s 轮询角标,`expireDueApprovals` 写好了但无调度器调用)。
2. Agent 主动项目管理:主动追 DDL、按甘特图追进度、主动规划、把控节奏、按时找人、反复叮嘱。
3. 对成员的主动关怀:闲聊、问候、基于记忆的安慰。
4. 人对人私聊 + 在线状态("看谁在线,直接私聊")。
5. 意图识别/工具调用优化,参考 pi(MIT,已 clone 至 `~/Desktop/开发项目/reference-pi`),用户要求"彻底升级"而非逐条打补丁。

## 已拍板的决策

| 决策点 | 结论 |
|---|---|
| 私聊容器 | 每工作区一个隐藏 DM 容器项目(复用个人空间围栏模式),不做 `project_id` nullable 大迁移 |
| 私聊里的 Cuu | 默认不在场(`cuu_enabled=false`),可随时请进来 |
| 批次并行 | 批次 A(管道)与批次 C(pi 引擎)并行开工,互不重叠 |
| 子 agent 模型 | 施工/侦察一律 sonnet 或 opus,不用 fable |

## 核心架构:主动性四层

不是单一 heartbeat,是「脉搏 + 事件」双源汇入一条决策管线:

1. **Pulse 层**:统一调度器(复活 `background_jobs` 死表,lease/心跳模式抄 `agent-run-recovery.ts`),每 5-15 分钟工作区级 tick。
2. **信号层**(纯规则零 LLM):DDL 临近/逾期、审批超 SLA、工作项停滞、成员久未互动、记忆关怀触发点。双源:pulse 扫描 + 现有 SSE 事件。
3. **ProactiveIntent 决策层**:信号 → 结构化意图(kind/目标人/紧迫度/抑制键),规则闸先行(静默时段、每人每日频控、抑制键去重、用户可调频率设置)。LLM 只管措辞,不管要不要打扰。
4. **投递层**(分级):硬提醒走通知+SSE+OS 桥;会话内走 digest 卡原地更新;Cuu 主动开口走新 turns 入口(必须带 intent id 审计,仅 collab/私聊,团队主区永不闲聊)。

## 批次总表

| 批次 | 内容 | 依赖 | 设计文档 |
|---|---|---|---|
| A 管道 | 统一调度器 + expireDueApprovals 接线 + 提醒阶梯 + 未读聚合/红点 + 消息通知→OS 桥 + 聊天卡内联批准 | 无 | 01 |
| B 私聊 | DM 容器 + dm_key 查重 + 成员 roster + 点头像开聊 + 已读分母修复 | A(通知管道) | 02 |
| C pi 引擎 | 彻底引入评估中(loop/harness 整体 vs 九条逐项),先行项:工具描述双通道/结构化压缩/截断逐个 fail | 无,与 A 并行 | 03(待引擎方案回来定稿) |
| D 主动性 MVP | ProactiveIntent 管线 + 追 DDL 阶梯(T-3d→T-1d→逾期→升级 PM)+ 行动卡找人 + Cuu 主动消息入口 + 频率/静默设置 | A、B(投递通道) | 待写 |
| E 项目管理深化 | 里程碑/依赖数据模型 + 甘特 + 规划 agent 走 proposal 流(复用 meta-planner)+ OKR 双端 UI(后端已闭环,双端零入口) | D | 待写 |
| F 关怀闲聊 | 记忆写入源拓宽(工作负荷/深夜提交/连续打回信号)+ 关怀扫描 + opt-in/频控 | D、B | 待写,刻意最后 |
| G 双端止血 | 桌面死 chip/空壳/登出广播/忙态 + web 裸串/SSE 窄化/引导文案(审计 Top 精选) | 无,可随时并行 | 04 §五 |

双端交互规划(定位裁定/双壳收敛/SSE 拓扑修复/新能力落位)见 04。桌面审计最大发现:workbench 窗口关闭时会话新消息在桌面全链路零信号(SSE 拓扑缺口),修法并入批次 A 的 A4/A5,并追加托盘/Dock 角标与 pet 联动验收。

## 侦察结论存档(关键事实,写码前复核)

- 合并审批链路已通:工作台右栏 approve/deny/merge 全接线(`workbench/proposal/panel.ts`);工具审批(ApprovalRequest kind=tool)与 proposals review→merge 是两套不相通系统;`approvalKinds` 的 proposal/revision + `routeApprover()` 是死代码。
- `expireDueApprovals`(`apps/api/src/services/approvals.ts:1270`)无任何调度器调用。
- 三个各自为政的 setInterval worker(recovery/sweep/curation),无通用 scheduler;`background_jobs` 表是零实现死表。
- 通知:dedupe_key 幂等 + SSE + client-tauri notify.rs OS 桥成熟,但无重复提醒/升级阶梯;会话消息从不产生通知。
- Cuu turns 必须绑 `user_message_id`,纯被动;正在生成时第二条消息 409 busy。
- conversation-observer(主区静默观察者)可发结构化事件,不能说自由文本。
- `user_memories` 写入源只有审批打回一种;读取仅本人下次 run 注入。
- 项目无日期/里程碑表;`work_items.due_at` 有;逾期判定算法在 `schedule-notify-pages.ts` 现成但只读。
- escalated 状态全链路已通(触发→落库→SSE→attention→resolve/delegate/retry)。
- presence:Redis/内存 store,120s TTL,`GET /api/presence?user_ids`(≤50,工作区过滤);绿点只在已打开会话的头部成员条。
- 私聊数据层已可表达(collab + 2 人 + cuu_enabled=false),消息全套能力通;缺入口/查重/未读/通知。
- 选人数据源禁用 `GET /api/users`(无工作区过滤,跨租户泄漏);用 workbench VM 的 workspace_members(cap 100)。
- 「已读 N/M」分母 bug:用全工作区成员而非会话参与者(`chat/view.ts:606`)。
