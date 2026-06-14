---
module: R6-compounding-ai-labor
layer: P-AI / C-WEB / C-PET / DATA
status: planned
owner: design+engineering
date: 2026-06-14
depends_on:
  - prd-concept-compliance-audit-2026-06-13.md
  - ../05-clients/page-concepts.md
  - r5-11-1-sandbox-libraries-and-skills-plan-2026-06-12.md
---

# R6 复利劳动力：AI 战绩 + 团队 Skill 自迭代 + 用户 Memory + 决策收件箱视觉重做

> **北极星延伸**：让 AI 劳动力随时间**复利增长**，人类工作量逐步下降。四条线互相咬合——**决策收件箱**让"AI 已替你过滤复杂度"在 UI 上成立；**战绩**度量复利效果；**Skill 自迭代**是团队级复利；**Memory**是用户级复利。全部建立在现有 `load_skill`+`SKILL.md`+AgentRun+Proposal 审批模型之上，不重造轮子。
>
> 触发：用户用 Claude design 出了高保真稿（决策收件箱方向），并要求新增"AI 处理了多少活"、引入团队级 skill 自迭代体系、用户个人级 memory 体系。

## 0. 三条贯穿全文的硬约束（来自代码现状）

1. **「团队」= workspace**。`workspaces` 表已存在（`packages/db/src/schema/core.ts:85`），全系统 `teamId` 统一是 `settings.auth.defaultWorkspaceId`（`packages/config/src/auth.ts:7`）。当前单部署单 workspace，多租户路径已埋好。团队级 Skill 挂 `workspace_id`，今天=全员共享一库，未来多租户零改 schema。
2. **闲时调度今天不存在**。`background_jobs` 表有了（`core.ts:162`）但无 dispatcher/cron/next_run_at。唯一后台循环是 `AgentRunRecoveryScheduler`（`apps/api/src/workers/agent-run-recovery.ts`）的 `setInterval`。Skill 自迭代的「每天闲时」复刻此模式，**不引 cron**。
3. **70 步 web smoke**（`.github/workflows/verify.yml` → `apps/web/qa/r4-web-live-route-interaction.ts`）只卡 **data-\* 结构标记 + 请求计数指纹 + notice 的 kind/actionId 语义**，几乎不卡可见文案。→ 视觉重做 + 卖萌文案空间很大，只要保住 data-\* 标记、不改请求形状、不动 fixture 字符串。

## 1. 客户端分工定调（决策收件箱方向）

- **Web = 全局状态 + 审查 + 审批详情**：首页走概念图方向①「决策收件箱」（一张大 CR 决策卡 + AI 进行中状态表 + 3 metric chip），气质取方向⑤「环境感知」（安静状态板）。
- **桌宠 Cuu = 决策入口 + 对话**：方向②对话流是它的交互模型；只重做气泡（cream 审批 / chat 对话 / light-blue 检索）与情绪映射（10 态→5 态 idle/thinking/approval/worried/celebrating）。**Live2D 黑猫/白猫资产保留不动**，设计稿里的线框猫只是占位。
- **Rust/Tauri = 系统管线**：窗口/托盘/deep-link/SSE 桥接，边界已干净（`lib.rs` `RUST_SHELL_OWNS`）。

## 2. AI 战绩 /「今天 AI 干了多少活」

数据源**全部已存在，零新表出第一版**：`buildPilotDay1MetricsSnapshot`（`apps/api/src/services/pilot-day1-metrics.ts:146`）已把原始行读出（agent_runs / accepted_deliverable_changes / proposals merged / cost）。

- **自主率** = `agent_runs.status='succeeded'` ÷ 全部 finished runs；**AI 直出件数** = `accepted_deliverable_changes`（supersededAt is null）按窗计数。两个派生字段，无新查询。
- **新轻量公开端点** `GET /api/ai-worklog/today`（非 admin，pilot metrics 是 admin-only）→ 新服务 `apps/api/src/services/ai-worklog-metrics.ts` 复用 `PilotMetricsRepository.readDay1MetricsRows()`，只导出非敏感聚合（runs_today / autonomy_rate / accepted_today / saved_hours_estimate），**不含成本明细**。
- **home VM 加 optional 字段** `worklog?: aiWorklogVmSchema`（`packages/contracts/src/pages.ts:39`）——optional = smoke 安全，数据缺失不渲染。
- **Surface**：决策收件箱首页一条横幅「今天 AI 干了 **N** 件 · 自主率 **X%** · 约省 **H** 小时」，接 `apps/web/src/routes.ts:591` 的 `metricsForSurface(home)`。

## 3. Skill 自迭代体系（团队级 / workspace-scoped）

扩展不替换：现有 7 个 `SKILL.md` + `load_skill`（`packages/tools/src/skills.ts`）保留为「内置 L0 技能」；团队技能叠一层 DB。

- **新表 `team_skills`**（迁移 `0012`）：`workspace_id`（团队边界）/ `skill_key` / `name` / `when_to_use` / `content_md` / `status`(draft|proposed|active|deprecated) / `version` / `source_kind`(distilled|authored) / `proposal_id`。合同 `packages/contracts/src/domain/skill-curation.ts`；repo `packages/db/src/repositories/team-skills.ts`。
- **合并视图**：`listSkills/loadSkillContent/skillCatalogForPrompt/createSkillTool` 升级为「文件系统 ∪ DB(按 workspace active)」，按 run 的 `work_items.workspaceId` 注入（`agent-runner.ts:336/423/440`）。fail-closed 行为保留。
- **闲时整理 job**：新建 `apps/api/src/workers/skill-curation-scheduler.ts`，照 `AgentRunRecoveryScheduler` 结构（setInterval + 24h 节流 + 队列空闲检测 + `timer.unref()`）。挖 artifact：`accepted_deliverable_changes`(正样本) / `agent_steps`(动作模式) / `proposals+reviews+confidence_records`(高质量/反模式) / `escalation_events`(缺技能信号)。
- **候选→自动晋升（AI 自迭代，无人工前置审批）** —— 已按用户决策定稿：蒸馏出 `SKILL.md` 草稿后，若 `confidence ≥ 阈值` 且通过**自验门**（frontmatter schema + 内容 lint + 可选 dry-run）→ 直接 `promote()`（status=active + 版本递增，旧版 deprecated），**无需 Proposal/人类审批**。理由：skill 是 AI 内部能力（不是生产交付物），自迭代风险远低于自动合并交付物，宪法"人是审批者"约束的是生产写入而非内部技能库。低分/未过自验的候选丢弃 + 记 reason（下次蒸馏避开）。全程 `audit_logs`（`actorKind='ai'`, `action='skill.distilled'/'skill.promoted'/'skill.deprecated'`）。**人类兜底 = 事后 kill-switch**：团队技能设置页可查看/停用/回退任一技能版本（非前置审批）。

## 4. Memory 系统（用户个人 ID 级 / user-scoped）

| | Skill（团队级） | Memory（用户级） |
|---|---|---|
| key | `workspace_id` | `user_id` |
| 内容 | 可复用的方法/库用法/模板 | 个人偏好/口径/纠正/常用上下文 |
| 谁 vet | PM/人类审批（走 Proposal） | 用户自己（轻量，可见可删，不走 Proposal） |
| 注入 | worker prompt 技能目录 | worker prompt「用户画像」段 + clarification |

- **新表 `user_memories`**（迁移 `0012` 同批）：`user_id` / `workspace_id?`（全局 vs 团队内偏好）/ `category`(preference|correction|recurring_context) / `key` / `value_md` / `confidence` / `source_run_id` / `last_used_at` / `expires_at`；`unique(user_id, category, key)` 天然去重覆盖。合同 `packages/contracts/src/domain/user-memory.ts`；repo `user-memory.ts`（upsert/listForUser/touch/prune）。
- **写**：审批纠正（`reviews.reasonMd` → correction）+ run 收尾稳定偏好（→ preference），upsert by key 提 confidence。v0 规则提取（便宜），不每次跑 LLM。
- **读**：run 启动构造 prompt 时按 `run.actor_id` 拉 top-N 注入「该用户既定偏好」段（`agent-runner.ts:440`），clarification 前先查 memory 已知偏好不再问——**直接减少重复人工**。
- **限额**：每用户硬上限（如 50 条 active），超限按 `confidence×recency` 驱逐；`expires_at` + curation scheduler 顺带 prune；用户个人设置可见可删。

## 5. 分阶段构建计划（按 杠杆÷依赖）

| 阶段 | 内容 | 风险 | 依赖 |
|---|---|---|---|
| **V0 设计 token** | 落高保真调色板（靛蓝 `#4F46E5` + 语义色）到 `goldPathCss`/`webRouteComponentCss`/`productShellCss`，只换变量值不动 DOM | 零 | 无 |
| **A0 AI 战绩** | 派生 2 metric + `/api/ai-worklog/today` + home optional `worklog` 横幅 | 低 | 无（独立于所有开放问题）|
| **W1 决策收件箱首页** | 重写 `renderHomeRouteComponent` 视觉为 CR 决策卡 + AI 进行中表 + 战绩横幅 + 卖萌文案；保住所有 `data-r4-home-*` 标记 + React fingerprint | 中 | V0、A0 |
| **M1 Memory 读路径** | `user_memories` 表 + repo + prompt 注入（先只读偏好）；写入先规则提取 | 中 | 迁移 0012 |
| **S2 Skill 合并视图** | `team_skills` 表 + `load_skill` 合并视图 + 人工创作 & AI 蒸馏候选，**自动晋升**（confidence + 自验门控，无人工前置）+ 团队技能设置页 kill-switch | 中 | 迁移 0012 |
| **W2 审批中心三栏** | `renderApprovals` → 概念图④三栏（list+SLA / 变更详情 / 我的操作+置信环+timeline）| 中 | V0 |
| **P3 桌宠三气泡** | `renderDesktopPetBubble` 砍成 3 形态 + 情绪 10→5（`motion.ts`/`experience.ts`）；Live2D 资产不动 | 中（隔离，走 Tauri smoke）| V0 |
| **S3 闲时自迭代** | daily curation scheduler（setInterval）+ artifact 蒸馏 + 候选 Proposal + memory prune | 高（唯一新后台循环）| S2、M1 |
| **C4 卖萌文案全量** | `i18n.ts`/`product-shell.ts` 颜文字 pass，含 fixture 同步 | 中 | 各页定稿后 |

## 6. 需要拍板的开放问题（含建议默认）

1. **team 实体**：建议「团队 = workspace」（现状单租户，多租户路径已埋）。除非你心中的团队是 org 下多团队，否则按此推进。
2. **闲时调度**：建议 setInterval + 24h 节流 + 队列空闲检测，**不引 cron**（同 recovery scheduler，零新依赖）。
3. **新技能把关**：✅ **已定 = AI 全自动迭代、无人工前置审批**（confidence 阈值 + 自验门控自动晋升；人类只保留事后 kill-switch / 回退）。理由见 §3。
4. **省下人力换算**：v0 写死一个保守单件基线常量并标注"估算"。
5. **Memory 写入**：v0 规则提取（便宜可控）；LLM 蒸馏更聪明但增 token 成本。

*本文档为新子系统的权威设计，按 V0→A0→W1 的顺序滚动施工，每阶段照惯例另立 plan + QA Gate + 不破现有门禁。*
