# 批 0 完成汇报(数据与协议地基)

日期: 2026-07-12 · 执行: codex(主体) + Claude(接力收尾与验收) · 分支: r12/workbench-full

## 做了什么

- codex 交付批 0 主体(20 commits):迁移 0046(8 张表:project_conversations / conversation_participants / conversation_messages / action_cards / action_card_items / conversation_observer_state / user_ai_profiles / project_ai_governance,含 dispatch_policy、agent_runs 的 execution_hint/source_conversation_id/source_action_card_item_id 扩展列与复合 FK)、conversation/ai-settings/workbench 三套 repository+service+route、`GET /api/pages/workbench/:projectId` 有界 VM、SSE conversation topic 族与 message-created 生产者、OpenAPI、批 9 本地执行协议契约(contracts/domain/local-execution.ts + r12-workbench.test.ts 28 条,含 claim 过滤/租约/签名)。
- codex 途中触发真实存量漂移并按铁律停工:迁移 0031 的 task_plans CHECK 不含 `paused`,与 2026-07-07 起的 contracts/repository 现实冲突;获用户授权后以 0047 迁移根因修复(完整证据见 [BLOCKED.md](BLOCKED.md),状态已解除)。
- Claude 接力收尾:补 PG smoke「R12 会话地基」节(建项目→main 会话原子存在且复用不重复→双成员发消息 seq 严格递增→afterSeq=0 全量有序/afterSeq 游标跳过已读→外人无成员身份 fail-closed 返回 null),勾批 0 清单,出本报告。

## 验收证据(Claude 独立复核)

- 全仓 `pnpm -r typecheck`:通过(exit 0)。
- 全量 `pnpm test`:通过(exit 0;尾部 workspace apps/web 67/67,全程无 fail)。
- PG+Redis smoke:scratch 库 `workhub_r12_batch0_smoke`(PostgreSQL 16 容器)从 0000..0047 全量迁移后运行,7 个分节全 ok,总结果 `ok:true`;新增 R12 节输出 `R12 conversation foundation (project→main→messages→afterSeq) ok`。scratch 库已 `DROP ... WITH (FORCE)` 清理。
- 迁移内容抽查:0046 含全部 8 表与 17 处关键列命中(dispatch_policy/execution_hint/source_conversation_id);路由已挂载 app.ts;`UNIQUE(conversation_id, seq)` 在位。

## 我改过的断言

无。smoke 为纯新增分节;02 计划批 0 清单打勾并对 CI 条目如实改写(见下)。

## 没做/存疑

- **CI 未核**:分支尚未推送,「CI 全绿」不算完成;批 1 推送时按仓库纪律 `gh run view --json jobs` 逐 job 核 conclusion。
- **curl 全链路演示**:HTTP 层已有路由测试(签名 cookie 全链),repository 层已有 smoke;live curl 演示留到批 2 有 preview 环境时一并做,不作为批 0 通过的前提。
- **codex 半成品处置**:其未提交的 smoke 大重写(1642 行,spawn 真实 server 的端到端 harness)已存 stash(`codex半成品:smoke升级R12表覆盖`),方向有价值但超出批 0 验收门要求;批 2 做 SSE 端到端时再评估采用与否,不盲收。

## 结论

批 0 完成,批 1(工作台主窗外壳)可开工。
