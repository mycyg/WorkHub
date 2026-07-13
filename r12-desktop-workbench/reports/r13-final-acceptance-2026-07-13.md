# R13 终验总账（2026-07-13，集成者亲验）

> 范围：用户点名的「每个端每个功能 + 人到人/Cuu 到人数据打通」矩阵。
> 环境：本机长命 PG（docker workhub-postgres-1，已迁到 0053）+ 当前码 API:8787 + 真 DeepSeek key
> （deepseek-v4-pro via /anthropic）+ `cargo tauri build` 正规出包 + 浏览器免 Tauri 管道（4174 dist + localStorage api_base 覆写）。
> 本轮真 key 总开销：13 次 LLM 调用 / 1.8 万 token / 约 ¥0.079（cost_ledger 实测）。

## 一、数据打通矩阵（全部真库真 key，非 mock）

| 链路 | 结果 | 证据 |
|---|---|---|
| identify 建号+默认工作区 membership（ENV-01+0053） | 过 | 验收甲/验收乙两用户 identify 后 /auth/me 正常、org 解析到默认工作区 |
| 人→人（小群正反向） | 过 | A 建「终验小群」拉 B；A 发 B 看得到（4 条全量可见），B 反向发 seq5 A 侧可见 |
| 被 @ 必回（4c 工具环 + 回话判定器） | 过 | @Cuu 找文件 → **判定器自动触发**（无需客户端请求）→ tool_note(drive_search 检索"验收"无命中) + 诚实文本回复落库 |
| 未 @ 闲聊不插嘴（PM 判定） | 过 | 「中午吃什么」挂 60 秒+多个 tick 无人接茬 |
| cuu_enabled=false 强静默（G1） | 过 | 静默群 @Cuu 后 turn 409 `conversation_turn_cuu_disabled`（中文文案）；判定器也不回（会话里恒无 cuu 消息） |
| 个人空间（S3）建/开通 | 过 | POST /me/personal-projects 201，is_personal=true，context_ready=true |
| **个人空间单聊必回** | **修复后过** | 终验逮到 P1 级缺口（见三-1），修复后真 key 复验：不 @ 也 201 回复（13.7s） |
| 上下文压缩（C1） | 过 | 灌 75 条后触发 turn：through_seq 0→30（滚动增量有界）、摘要 526 字落库、`context_compacted` 系统消息带真实条数、Cuu 总结正常返回 |
| /me/profile GET/PATCH（A2） | 过 | PATCH title/bio/skill_tags 后 GET 读回一致 |
| S3 隐私边界 | 过 | 个人空间不进双方团队项目列表；A 摸 B 的个人 main 会话 404 fail-closed |
| 军团/变动文件读路径（P1.5） | 过（读侧） | GET /conversations/:id/army 200，空态诚实；库内历史 proposal diff_stats null=「详情不可用」路径 |
| 成本记账 | 过 | cost_ledger_entries 13 条 agent_step 全落账 |

## 二、双端可视核对

- **桌面真机**（cargo tauri build 出包 + WORKHUB_QA_OPEN_WORKBENCH + screencapture）：浅色玻璃、原生红绿灯、
  左栏「我的空间/新建个人空间」、军团总览一级入口、右栏情境面板、聚焦盒唤起工作台后回到首页搜索态——全部确认。
- **工作台 UI 端到端**（浏览器免 Tauri 管道，连 8787 真 API）：建群弹窗（选人复选框 + 「Cuu 参与这个会话」默认勾选）→
  建群成功（成员条「3 位成员 + Cuu · 全员群聊」）→ @Cuu 发消息 → Cuu 回复气泡真渲染；右栏「输出/变动文件/军团/后台任务」
  四区含 P1.5 新区块诚实空态；composer 三 chips（@文件·成员 / #会话 / /技能）+「我的模式」chip 在线。
- **web 端**：/settings「我的资料」表单（A2）有单测+API 双验，路由 smoke 门通过（改词后）；web 无聊天 UI（按设计，
  聊天归桌面工作台），跨端一致性以 API 层双 cookie 双向读写验证为准。

## 三、终验逮到并当场修掉的缺陷

1. **个人空间单聊必回语义断裂（P1，已修 4d003f01）**：选中个人空间打开的是 main 会话，但客户端只对 collab 自动请
   turn、判定器只扫真小群、turns 端点拒 main——个人空间里和 Cuu 说话石沉大海。修复三层：DB 访问记录带
   `projectIsPersonal`、turns 放行「个人项目 main」且必回（判定器无权否决、cuu_enabled 闸仍最高）、桌面端
   `shouldRequestConversationTurn` 镜像放行。api/db/桌面 +5 测试钉死语义。
2. **pilot-stack-smoke 连红 8 提交的病根（P0，已修 754d0b52）**：identify 补 membership 撞空 workspaces 表 FK→500。
   修=0053 幂等种默认 org/工作区 + auth FK 违约降级 + 回归测试。e2863a34 起 CI 8/8 逐 job 回绿。
3. **0051 迁移不满足重放安全（已修 252ac677）**：migration-audit replay 阶段撞 ADD CONSTRAINT 重复。改 pg_constraint
   DO 块守卫（0040/0043/0046 先例），本地真 PG audit 含 replay 全过。
4. **A2 web 文案泄漏桌面人设名（已修 bf850b2e）**：web 路由 smoke 钉死「web 不出现 Cuu」，A2 资料卡两种语言都写了
   Cuu。按 web 词汇改「AI 助手」。
5. **journal 尾断言漂移（我自己踩的，已修 e2863a34）**：推 0053 没跑 db 测试；断言钉到 0053 并注明合并波次中稳定。

## 四、如实标注的验收缺口（不冒充已验）

- **P1.5 写路径未做真机全链**：diff_stats 的 workdir 活时写入靠单测覆盖（agent 报告 +17 断言）；没有跑一次完整的真
  agent run→proposal 来生成带 changed_files 的右栏真数据（真 run 走沙箱数分钟+真 key，留给用户实测或后续补）。
- **A2 派活评分的观察者消费端**：prompt 注入候选名单+点名优先有单测钉死，但没有构造一次真观察者派活来看名单实际生效。
- **压缩的追赶收敛**（积压>100 时分批追平）只验证了第一批 30 条推进，未灌到多批追赶。
- **web /settings 表单 UI 没有截图级核对**（浏览器面板对 5175 新源的策略检查未放行）；有单测+smoke 门兜底。
- **turn UI 流式气泡在个人空间单聊的桌面真机观感**未逐帧核对（修复后的自动请 turn 行为有单测，SSE delta 渲染复用 collab 已验路径）。

## 五、CI 时间线

- 68a77a02 起 pilot-stack-smoke 连红（历史病根）→ e2863a34 修复后 8/8 全绿（逐 job 核）。
- fb0a10c8/e78fcacf：migration-audit 红（0051 重放）+ web-live smoke 红（Cuu 文案）→ 252ac677/bf850b2e 两修。
- 最终以 bf850b2e 的 run 全绿为收口标志（推送时在跑）。
