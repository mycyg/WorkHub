# R17 卡点修复计划(依据 05-gap-review 42 条确认发现)

2026-07-16 用户令:文档先行→流水线推进(opus/sonnet 子 agent)→全部完成后推 GitHub main。发现编号引用 05-gap-review-2026-07-16.md。

## 两个分叉点拍板(负责人代决,理由留档,可逆)

**拍板 A(#3 项目成员模型):不新建「项目团队」数据层。** 理由:当前产品单工作区形态下,工作区花名册≈项目候选池,新建层收益有限而成本 L 级;先把管理动作补齐(加人/退群/移出/邀请/成员移出路由),「项目成员」以「会话参与者的可管理化」落地。若未来多项目隔离需求变强再建层,本批的参与者管理端点可完整复用。

**拍板 B(#8 军团后台任务区):接真数据。** 理由:批 D 的 pulse/追DDL/关怀系统真实在跑却完全不可见,与用户对"军团状态"的关注直接冲突;接 pulse stats + 最近 proactive intents 展示,把主动性系统摆上台面。

## 批次与文件所有权(批 1-4 即刻并行,批 5 等批 2 的 refresh 钩子)

| 批 | 范围(发现#) | 独占文件域 | 工人 |
|---|---|---|---|
| G1 群成员管理 | #1 加人端点+UI/#16 退群移出/#14 邀请 UI 接线/#15 成员移出路由/#2 项目设置成员区+兑现弹窗承诺/#3 按拍板 A 落注释 | conversations participants 路由与服务/invites/memberships 路由/settings 成员区/chat 成员条 | opus |
| G2 决策推送链 | #4 execute 卡失败落 escalation/#5 escalation.opened 进 user topic/#6 shell.ts:629 白名单放宽/#17 收件箱 refresh() 自刷/#18 digest 扩源/#25#31 死事件死 kind 清理/顺带 #37#38 tab 快捷键(shell.ts 独占) | shell.ts/inbox/observer/human-reserved-guard/approval-digest/escalations 发布处 | opus |
| G3 军团实时性 | #7 run 生命周期进面板/#19 abort 入口/#20 escalated 徽标+跳转/#21 总览下钻/#32 过期提示/#33 返回重拉/#34 死标签/#8 后台任务区接真(拍板 B,含 pulse stats 只读端点) | army/*/agent-runs 事件发布处/pulse stats 新端点 | opus |
| G4 后端接线 | #9 E3 草案双端入口(最大件)/#10 关怀开关 UI/#22 通知标签映射/#23 web 静音清单/#35 桌面静音文案/#36 OKR 标题/#24 web 指令入口 | web route-components/通知偏好双端/timeline VM 小 additive/plan-drafts UI | opus |
| G5 UX 收尾 | #12 编辑器 merge_conflict 面板/#13 多文件切换/#26 日程无日期列/#27 看板筛选/#28 月周切换/#29 收件箱筛选+批量/#30 deep-link seq | editor/files/schedule/kanban/spotlight attention(承批 2 钩子)/pending-deep-link | 等批 2 |

主流程:各批施工→负责人逐单审查+复验→合入 r15/wave1→全部收口跑全量集成+本地 smoke→推远端→PR CI 全绿→并 main。PR#8(R15+R16 主体)CI 重跑中,绿即先并;修复批走后续 PR。

低危未入批(#31 部分/#34 已并入;其余低危如 tab 中键#37-38 并入 G2):全部覆盖。fe-orphans 维度 finder 当轮爆掉,其领地由 G1-G5 的"不假接线"纪律兜底,暂不补扫。
