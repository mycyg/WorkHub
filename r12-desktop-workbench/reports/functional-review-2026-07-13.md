# R12 功能/交互层审查（桌面 + web 合并裁决）

日期: 2026-07-13 · 方式: 两个只读审查 agent 分端扫描,集成者交叉合并 · 基线: r12/workbench-full @ 6e14d551

## 总判定

R12 的「骨架」是健康的:群聊/turns/网盘/军团读侧的已交付面上没有发现假接线或数据错误。
但有**两个系统性窟窿**和**一批过期承诺**:

1. **「Cuu 找人拍板」闭环双端断裂**——派活问询有问无答,决策卡两套状态机互不知情,是 R12 核心叙事的功能级断头。
2. **配置面欠账**——服务端建了 5 类配置模型(五档模式/接单策略/Granular/Cuu 主动性+模型档/项目治理),UI 只交付了 1 个(五档,且只在桌面协同 composer);web 用户对全部 5 类零入口,存在「只观察档 409 死锁无法自救」的真实场景。

## 主题式合并清单

### A. 拍板闭环断裂(P0,双端印证)

| # | 现象 | 证据 |
|---|---|---|
| A1 | dispatch_ask 问询「有问无答」:通知 severity=normal 不弹系统横幅;Cuu 气泡丢弃 workItemId/targetUrl 只深链到主区;行动卡渲染无任何按钮;POST /action-card-items/:id/decide 全仓库零调用方 | conversation-observer.ts:342 / notify.rs:227-234 / desktop-cuu-runtime.ts:915-940 / chat/render.ts:166-169 |
| A2 | decide 类条目借用通用 escalation 卡:文案是「卡住了/让它重试/转成我来做」——语义完全不匹配「AI 拿不准请你拍板」;resolve() 不回写 action_card_items → 聊天里的卡永久停在「待拍板」 | escalations.ts:190-216, 486-567 |
| A3 | 反向死锁:web 先 resolve 掉升级后,正规 decide 端点因 requireUnresolvedEscalation 前置检查 409 already_resolved——卡变成永远点不动的死卡 | action-cards.ts:164-171 |

**修法**:行动卡渲染补「交给我干/派给X/先不动」按钮调 decide 端点;escalations.resolve() 识别 handoffJson.action_card_item_id 时联动收口条目状态(或把此类卡的 web 动作重定向到 decide 端点);Cuu 气泡深链带会话/条目定位。

### B. 配置面欠账(P0/P1)

| # | 现象 | 证据 |
|---|---|---|
| B1 | 只观察 409 文案指向不存在的「设置 · AI」——桌面唯一设置视图只有语言/运行状态/登出 | turn.ts:69,77 / spotlight/views/settings.ts:16-40 |
| B2 | dispatch_policy(接单策略)/granular/cuu_proactivity/model_tier 两端均无任何 UI | grep 零命中 |
| B3 | 项目治理(观察者开关/静默窗/安静时段)桌面零代码路径,连只读展示都没有——直接影响观察者行为的参数完全不可见 | grep project_ai_governance 在 desktop-webview 零命中 |
| B4 | web /settings 对 5 类配置零呈现零入口,且连既有 desktopRequiredNotice「需要桌面客户端」提示模式都没复用(纯静默留白);mode=1 的 web-only 用户被 409 永久拒绝且无法自救 | pages/settings.ts:85-88 / route-components.ts:4211 |

**修法**:桌面 settings 补「AI」分区(五档默认/接单策略/Cuu 主动性,治理项至少只读);409 文案改为就地触发模式弹层;web /settings 至少补 desktopRequiredNotice 提示,最好接 PATCH /me/ai-profile 最小表单。

### C. 过期承诺占位(P1,一次性清理)

- rail.ts:112「批 5 开放」、chat/render.ts:484/654「批 4 起接入」、shell.ts:143「接在批 5」——批次全部已过去,承诺指向虚无。军团两端点(/me/army、/conversations/:id/army)已挂载文档化但零消费者。
- **修法**:占位文案去批次号;军团三区 UI 立项为下一迭代头号项(端点现成)。

### D. 全托管透明度(P1,信任链)

- 自动合并的提议在 web 不可感知:approvals 队列永远不出现(合并先于可见)、accepted_deliverables 无 reviewer_kind、置信度 pill 用未来时「可自动采纳」描述已发生的事实;战绩/成本页不区分自动合并与人审产出。
- **修法**:workitem 详情对 auto_merge+merged 补过去时提示「已由 AI 自动合并,无人工复核」;accepted_deliverables 加 reviewer_kind;army/cost KPI 加「AI 自动合并占比」。

### E. 来历不明与两端不对称(P1)

- 观察者建的工单 submitter=assignee 本人、无 source_context/evidence——web 详情页呈现为「貌似自己提交的无来源任务」(source_context 只支持 drive_comment/meeting_insight 两种)。
- 网盘版本回滚桌面独有;web /drive 的版本区块是另一套只读字段,无恢复按钮也无「需要桌面」提示。
- **修法**:source_context 补 conversation_observer 分支(人话标注来源会话);web 版本区块补桌面提示或接只读版本列表端点。

### F. 打磨清单(P2)

1. 新建项目撞名静默复用(created=false 不提示) — rail.ts:237-248
2. Cuu 回复中发第二条消息被晾住:canSend 不看 turnActive,409 busy 只有灰字无重试 — chat/render.ts:473
3. 深链 conversation_id 全链路打通却在终点被忽略(pendingConversationId 无消费者) — store.ts:28,59
4. 托盘菜单无「打开工作台」入口(常驻窗隐藏后难找回) — main.rs:1242-1281
5. 通知类型 action_card_item.dispatch_ask 裸枚举渲染「Action Card Item Dispatch Ask」 — route-components.ts:1115-1158
6. 模式弹层/@ picker 键盘不可达(无 tabindex/方向键) — render.ts
7. shell.ts renderProjectSummaryHtml 死代码 — shell.ts:113-136
8. isFocused() 失败默认前台的兜底建议真机复核 — interrupt-broadcast.ts:96-99
9. 工作台窗登出感知缺口(R11 身份线既有,只记录)

### 审查纠误

- web 报告确认「按 assignee 记账(labor-split)」并未实现——cost.ts 的 buildLaborSplit 是生产/自进化拆分(K5),与按执行者分账是两码事;00 设计稿 §6 的「成本 labor-split 记到张三名下」目前无代码支撑,列为设计-实现缺口。

## 修复分层建议

- **第一波(发布前必修,~1-2 个切片)**:A1+A2+A3(拍板闭环缝合)、B1(幽灵入口文案+就地弹层)、C(过期文案清理)、F5(裸枚举)。
- **第二波(下迭代头部)**:军团三区 UI(端点现成)、B3/B4 设置面(桌面 AI 分区+web 最小自救)、D(全托管透明度)、E(来历标注+网盘对称)。
- **第三波**:F 其余打磨 + labor-split 设计缺口裁决。
