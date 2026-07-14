# R14 批 RISK · RISK-B risk-ui 施工汇报

- 分支：`r14/risk-ui`
- 施工说明书：`r14-release-readiness/05-risk-design.md` 前端节（§1.4 聊天卡设计裁定 + §2.1/§8 阈值配置）+
  `r12-desktop-workbench/reports/r14-risk-server.md`（服务端已挂载的 content_json 真实形状与
  `GET/PATCH /api/projects/:id/ai-governance` 契约）
- 上游依赖：`r14/risk-server`（迁移 0059 + 契约 `riskMonitorSettingsSchema`/`DEFAULT_RISK_MONITOR_SETTINGS`
  + `ProjectAiGovernanceVM.risk_monitor` 已在本 worktree 基线中）
- 验收自查：`pnpm --filter @workhub/desktop-webview test`（**1092/1092** 通过，基线 1079，+13）+
  `pnpm -r typecheck`（16 个 workspace 包全绿）

## 1. 做了什么

### 聊天 risk_digest 专属卡（`chat/render.ts`）

服务端 `apps/api/src/services/risk-monitor.ts` 往项目主区会话 post 的 `system_event` 实际 content 形状
只有 `{event:'risk_digest', project_id, summary, stalled_count, deadline_count, cost_spike, target_url}`
——完整清单（工单标题/停滞天数/成本数字）只在通知正文里，不在聊天消息里（05-risk-design.md §1.4 明确
拍板「卡片只展示三个计数 + 一句话摘要，不在气泡里铺开长列表」）。据此实现：

- `riskDigestContentFrom(content)`：判别函数，`event==='risk_digest'` 且 `summary`/`stalled_count`/
  `deadline_count`/`cost_spike` 四个字段形状都对时才返回结构化对象；任何一个字段缺失/类型不对（如
  `stalled_count` 不是数字、`cost_spike` 不是布尔）都诚实降级——返回 `undefined`，调用方回退既有
  `renderSystemEventLineHtml` 单行渲染（它本身会读 `content.summary`，只要 summary 还在就仍可读）。
- `renderRiskDigestCardHtml`：默认折叠态只渲 PM 一句话摘要（`content.summary`）+「展开明细」按钮；点开
  后按信号分三节——**只渲染实际触发的信号**（`stalled_count>0`/`deadline_count>0`/`cost_spike===true`
  各占一行「类型 · N 项」，没触发的信号不硬凑一行「0 项」，呼应设计整体的「无信号不产出噪音」精神）+
  一句「完整清单见通知列表」的诚实说明（没有铺开工单标题列表，因为服务端本就没把它们塞进这条聊天消息）
  + 时间戳。折叠/展开复用批8长文本折叠的同一套 `data-wb-chat-expand-message`/`data-wb-chat-collapse-
  message` 挂钩与 `ctx.expandedMessageIds` 状态（`view.ts` 已按 `message.id` 通用处理这两个 data-*
  钩子，**没有改 view.ts**，也没有加新的 ctx 字段）。
- 挂载点：`renderMessageHtml` 在 `run_settled_report` 判定之后、`renderSystemEventLineHtml` 兜底之前插入
  `riskDigestContentFrom`/`renderRiskDigestCardHtml` 分支——只加了这一个新分支，没有触碰
  `renderDeliverableCardHtml`/`renderProposalSettledLineHtml`/`renderRunSettledReportHtml`/反馈相关函数
  （FEEDBACK/APPROVE-CHAT 批的既有产出）。

### 项目设置 · 风险巡检分区（`settings/{render,api,view}.ts`）

阈值读写零新增路由，复用既有 `GET/PATCH /api/projects/:id/ai-governance`（`api.ts` 未改动，
`fetchProjectAiGovernance`/`patchProjectAiGovernance` 本就转发任意 patch 形状）：

- `render.ts` 新增 `riskMonitorGroupHtml`——照 `.wh-wb-pset-group` 的既有浅色玻璃卡片语言，追加在
  granular chips 分区之后：启停开关（`data-wb-risk-enabled`，复用既有 `switchHtml` helper）+ 四个数值
  输入（停滞天数阈值/deadline 前瞻天数/成本放量比例/成本放量下限，`data-wb-risk-{stall,deadline,cost-
  ratio,cost-min}-input`）+ 显式「保存阈值」按钮（`data-wb-risk-save`）。只读态（非负责人）四个输入照旧
  显示当前值但 `disabled`，开关不带写钩子，不渲保存按钮（同既有分区的只读收紧手法）。
- `RISK_MONITOR_BOUNDS` 常量导出：四个字段的 min/max 直接对齐 `riskMonitorSettingsSchema` 的
  `.min()/.max()`（`{1,90}`/`{0,30}`/`{100,2000}`/`{0,∞}`），`view.ts` 的客户端校验与 `<input min max>`
  共用同一份数字，不各定一套。
- `resolveRiskMonitorForDisplay`：VM 上 `governance.risk_monitor` 的 TS 类型仍是
  `riskMonitorSettingsSchema`（每个字段 `z.optional()`），虽然服务层读时已经完整默认值合并，类型上仍
  残留 `| undefined`——这里单独声明 `ResolvedRiskMonitorSettings`（不是 `Required<RiskMonitorSettings>`，
  那个只去掉 `?:` 修饰符去不掉值类型里的 `| undefined`，`risk-server` 报告里同一个坑的桌面端镜像）来
  兜底渲染与保存时的取值。
- `view.ts` 写路径纪律（照既有静默窗口/granular 两种既有模式二选一，而不是自创第三种）：
  - 启停开关：即改即 PATCH（同观察者开关，布尔值不需要校验）。
  - 四个阈值：显式「保存阈值」按钮触发（同静默窗口秒数，数值输入不能每次击键发 PATCH），点击时先按
    `RISK_MONITOR_BOUNDS` 逐字段校验，任何一项越界都不发 PATCH、只给行内错误提示（复用既有
    `errorText`/`showInlineError` 机制，没有另起一套局部错误状态）。
  - **两条写路径都发送全部五个键**（`enabled`+四个阈值），不是只发变化的那个——`risk_monitor` 是整列
    替换写（同 `granular_settings` 口径，见 `packages/db/src/repositories/ai-settings.ts` 的条件化
    spread），只发一个键会把用户之前设过的其它阈值悄悄清空。

### `css.ts`

追加 `.wh-wb-risk-set-fields`/`.wh-wb-risk-set-field`（设置分区四字段两列网格）+
`.wh-wb-risk-digest`/`-list`/`-item`（聊天卡警示色调，`--ds-warn` 而非 `--ds-danger`——这是「该看一眼」
的提醒，不是失败/危险，用红色会喧宾夺主）。全部新增于文件末尾，未修改任何既有 `.wh-wb-*` 规则串。

## 2. 偏离说明

1. **未渲染「查看详情」跳转按钮**。设计稿 §1.4 提到聊天卡「查看详情」跳 `/projects/:id`，但那是 web 路由
   （`apps/web/src/routes.ts:129`），desktop-webview 没有对应的项目主页路由/`target_url` 到内部路由的
   既有映射先例（`desktop-cuu-runtime.ts` 里 `target_url` 的现有消费方是桌宠通知深链，跟聊天卡内联按钮
   是两套不同的接线）。risk_digest 本就 post 在该项目自己的主区会话里，用户看到这张卡时已经身处该项目
   上下文，硬做一个可能打不开、或者语义不清的按钮违反 04 §4 铁律 3（看起来能点的必须真能点）。改为一句
   「完整清单见通知列表」的诚实文字说明，指向真正有完整清单的地方（通知收件箱）。这是设计留白处的
   保守收窄，不影响 §1.4「只展示三个计数 + 一句话摘要」的核心拍板。
2. **展开态按「只渲染实际触发的信号」而非固定渲染三行（含 0 项）**。设计原文「多信号分节...各自条目
   列表+计数」在服务端实际 content_json 形状里只有计数没有条目，且 05-risk-design.md §3.5 明确「无信号
   的项目不产出 digest」——把同一条「不为零信号制造噪音」的精神延伸到卡片内的子分节：一条 digest 至少有
   一个信号触发，但另外一两个可能是 0，渲一行「临期未动工 · 0 项」除了噪音没有信息量，不渲更符合
   「PM 例行同步的克制口吻」。
3. 其余逐字照设计稿：折叠默认态、复用既有 `expandedMessageIds` 挂钩不新增 view.ts 分支、阈值配置零新增
   路由、整列替换写口径、`wh-wb-risk-*` 前缀新规则追加不改既有串。

## 3. 测试

| 文件 | 新增 | 覆盖 |
|---|---|---|
| `chat/render.test.ts` | +5 | risk_digest 默认折叠单行摘要、展开态多信号分节（含 cost_spike）、展开态
  单信号不为未触发信号编造 0 项、缺字段/类型不对时诚实降级回单行渲染（含 summary 仍可读的验证）、
  不误判字段同名的无关 system_event（`drive_version_restored` 恰好带 `stalled_count` 也不会被认成
  risk_digest） |
| `settings/render.test.ts` | +4 | 可编辑态四个阈值+开关的真实 data 钩子、只读态显示当前值但零写钩子、
  保存中态按钮文案与 disabled、`resolveRiskMonitorForDisplay` 稀疏对象补全默认值 |
| `settings/view.test.ts` | +4 | 开关即改即 PATCH 且携带完整已有阈值（不只发 `{enabled}`）、保存按钮
  客户端校验越界字段（钉死具体错误文案）不发 PATCH、五个键全部通过校验后一次性 PATCH、只读态两个新钩子
  都不触发任何 PATCH |

`pnpm --filter @workhub/desktop-webview test`：1079 → **1092**（+13，与上表加总一致）。

## 4. 施工围栏核对

只动 `apps/desktop-webview/src/workbench/chat/render.ts`+`render.test.ts`、
`apps/desktop-webview/src/workbench/settings/render.ts`+`render.test.ts`、
`apps/desktop-webview/src/workbench/settings/view.ts`+`view.test.ts`、
`apps/desktop-webview/src/workbench/css.ts`（仅追加）。未碰 `apps/api/**`/`packages/db/**`/
`packages/contracts/**`/`apps/web/**`/`packages/ui/**`/`workbench/proposal/**`/`workbench/army/**`；
`settings/api.ts` 零改动（两个端点转发本就类型安全透传任意 patch 形状）；`chat/render.ts` 里反馈/产出卡/
工具条相关函数（`renderDeliverableCardHtml`/`renderProposalSettledLineHtml`/
`renderMessageToolbarHtml`/`renderMessageFeedbackBadgeHtml` 等）一处未动，只加了
`riskDigestContentFrom`/`renderRiskDigestCardHtml` 两个新函数与 `renderMessageHtml` 里的一个新分支；
`settings/render.ts`/`view.ts` 里 GitHub 绑定卡相关分区（并行 agent 的施工范围）未触碰。
