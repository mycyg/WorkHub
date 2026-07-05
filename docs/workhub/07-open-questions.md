---
module: 07-open-questions
layer: L4（全局总纲 / 收敛追踪）
status: 🚧
owner: workflow
---

# 开放问题汇总与收敛状态（Open Questions Tracker）

> **本篇是 WorkHub 全文档树的「未决事项单一来源」。** 它把两类开放问题收口到一处并逐条给出**收敛状态 + 建议**：
> 1. **PRD §16** 列出的 7 个进 plan 前需收敛的问题（[PRD §16](../prd/2026-06-04-workhub-prd.md)）；
> 2. **各篇规格文档自报、并显式声明「汇总至 07-open-questions」** 的遗留问题（`agent-loop-and-tools §10`、`review-and-approval §11`、`explainability §7`、`knowledge-base §11.2`、`personas-and-jtbd §10`、`confidence-risk-escalation`、`branch-proposal-merge §5`、`security-and-permissions §6.3`、`sync-and-spec` 的 cursor/单调序列等）。
>
> 上游：[PRD §15 决策清单 / §16 开放问题](../prd/2026-06-04-workhub-prd.md) · [规格树索引](./README.md) · [愿景与产品宪法](./00-overview/vision-and-principles.md)。
> 术语去黑话以 [`00-overview/glossary-dejargon.md`](./00-overview/glossary-dejargon.md) 为权威；任何"建议"都不得违反 [产品宪法 ×5](./00-overview/vision-and-principles.md#4-产品宪法-5product-constitution)（冲突时北极星护栏仲裁）。
> **本篇不重复算法/字段定义**：每条开放问题给"问题陈述 + 影响面 + 现状基线（扎根真实代码）+ 收敛状态 + 建议 + 归属篇"，深设计仍以归属篇为权威，本篇只做交叉收敛与追踪。

---

## 0. 怎么读这张表

### 0.1 收敛状态图例

| 标记 | 含义 | 谁来推 |
|---|---|---|
| ✅ **已收敛（决策落定）** | 已有明确决策（PRD `[决策]` 或地基 D-x），本篇仅登记备查 | — |
| 🟢 **建议已给，待确认** | 规格树已给出有充分理由的推荐默认值，等拍板（多为产品/业务方一句话即可定） | owner / 业务方 |
| 🟡 **方向已定，参数待标定** | 机制设计完成，但阈值/权重/初值需用真实数据或业务方标定 | 业务方 + 数据 |
| 🟠 **设计待落定** | 落点已明（指向某篇），但字段/边界/实现路径尚未最终定型，依赖下游篇收口 | 归属篇 owner |
| 🔵 **延后（按分期）** | 明确推迟到某阶段（P2–P5），MVP 不阻塞 | 按 roadmap |

### 0.2 问题编号体系

- **OQ-1 ~ OQ-7**：直接对应 [PRD §16](../prd/2026-06-04-workhub-prd.md) 的 7 个问题（编号与 PRD 一致，便于回溯）。
- **各篇前缀编号**（沿用各篇自报）：`RA-*`（review-and-approval）、`EX-*`（explainability）、`KB-*`（knowledge-base）、`AL-*`（agent-loop-and-tools §10，本篇为其编号）、`PJ-*`（personas-and-jtbd §10）、`SY-*`（sync-and-spec）。
- 一个 PRD 问题常被多篇细化（如 OQ-2/3 由 confidence-risk-escalation 落地）；本篇在该问题下汇总所有相关篇的细分。

### 0.3 一句话总览（截至本篇撰写）

- **地基三决策已落定**（D-1 = 参考既有 Python/FastAPI 行为的 **TS-first 重写与演进** / D-2 PostgreSQL / D-3 LAN-first），原 PRD `[建议·待确认]` / `[开放]` 现已转 `[决策]`——OQ-1 关闭。
- **命门级机制（置信度/风险/升级、对象合并、审批路由）的 R0 施工口径已完成**：OQ-2/OQ-3 v1 默认策略与责任人已落到 [`confidence-risk-escalation.md §0.1`](./02-ai-engine/confidence-risk-escalation.md#01-r0-v1-默认策略先施工后校准)，不再阻塞 R1；R5.10-real 已提供首批真实校准样本（T1–T4 人工质量 `4/4 >= 4`，T5 信息不足正确升级，B1 预算耗尽升级）。
- **真正还要"拍板"的产品级问题集中在 OQ-5（桌宠人格/打扰边界）**；OQ-6 的 L2 首发 file-only 子类已落到 `FR-WORKER-008`，OQ-7 的 v0 默认配额已落到 `cost-governance.md`。
- **文档落点复核（本次修订重点）**：原列为"待写"的 `05-clients/*`、`06-roadmap/*`、`dashboards-and-metrics.md` 与 P-COST 专篇**均已落盘**，相关开放问题的"无处落定"障碍解除。

---

## 1. PRD §16 七大开放问题（逐条收敛）

### OQ-1 · D-1 / D-3：新仓迁移 vs 重写？部署 LAN vs 云？

| 维度 | 内容 |
|---|---|
| **PRD 原文** | "D-1 / D-3 需你拍板：新仓是迁移还是重写？部署 LAN vs 云？"（[PRD §16.1](../prd/2026-06-04-workhub-prd.md)） |
| **收敛状态** | ✅ **已收敛** |
| **决策** | **D-1 = 参考既有 Python/FastAPI 行为锚点的 TS-first 重写与演进**；**D-3 = LAN-first MVP + 云就绪架构，多租户公网延到 P5**。见 [README §4 地基决策](./README.md)、本篇导言的"已敲定地基决策"、[vision-and-principles §7](./00-overview/vision-and-principles.md#7-地基决策对宪法的影响必读)。 |
| **决策依据（扎根代码）** | 现有 `auto_agent` / `lifecycle` / `spec_watch` / `auth` 是行为资产，不是目标运行时。新仓施工以 TypeScript/Hono/Drizzle/contracts 为默认路径，旧 `app/*.py` 只用来说明已验证过的状态机、沙箱、事件、鉴权与恢复语义。LAN-first 依据：`app/auth.py:1` "LAN-only use"、`permissions.py:1` "still LAN/nickname based"——现有信任前提就是可信局域网。 |
| **落地** | 迁移工序见 [`tech-stack-and-migration.md §5/§8`](./01-architecture/tech-stack-and-migration.md)；进程切分见 [`system-architecture.md §7`](./01-architecture/system-architecture.md)；云就绪的威胁模型重审清单见 [`security-and-permissions.md §1.3`](./01-architecture/security-and-permissions.md)（R1–R6）。 |
| **残余子问题** | 见 §3 的 **迁移执行级开放问题**（Drizzle 首版迁移、SQLite→PG 类型审校、`Requirement`→`WorkItem` 物理改名 vs 仅 contract/ORM 改名）——属"执行细节待 plan 定"，不阻塞决策。 |

---

### OQ-2 · 置信度怎么算：用哪些信号、各档阈值、谁来标定？

| 维度 | 内容 |
|---|---|
| **PRD 原文** | "置信度怎么算：用哪些信号、各档阈值、谁来标定？（8.2）"（[PRD §16.2](../prd/2026-06-04-workhub-prd.md)） |
| **收敛状态** | ✅ **R0 v1 默认已收敛；R1 后按真实数据校准** |
| **机制已定（信号与算法）** | 四来源已锁，落在 [`confidence-risk-escalation.md §3`](./02-ai-engine/confidence-risk-escalation.md)：① AI 自评（辅，**只降不升**防过度自信）② `llm_review` 判分（主，现成零件 `auto_agent.py:544`，由二值升级为五档量表）③ 验收清单逐条命中率（主，`RequirementAcceptanceItem.status`，`models.py:464`）④ 历史校准（随数据，`CollaborationGraph.hit_rate` 的切片，Laplace 平滑）。PRD §8.2 建议"v1 以 ②③ 为主、① 为辅、④ 随数据积累接入"已被采纳。 |
| **R0 默认（已落）** | `policy_version = confidence-risk-v0.1-r0-2026-06-08`；owner = WorkHub product owner（mycyg）+ workflow implementation steward；四来源权重 `review=0.50 / acceptance=0.35 / self=0.15`；置信档 `high≥0.85`、`medium∈[0.60,0.85)`、`low<0.60`；历史校准最小样本 `N=20`。 |
| **现状基线（诚实标注）** | 今天 `auto_agent.py` 只有 `llm_review` 一个**二值**判分，失败一律 `status→ready` 转人工（`app/routers/auto.py:244`，`r.status = "ready"`），**没有连续置信度、没有风险维度、没有分级裁决**。这是 P1 旗舰的核心新增，非复述。 |
| **R5.10 首批样本** | 2026-06-13 R5.10-real 使用 DeepSeek 真 provider 跑完 T1–T5 + B1；T1–T4 人工质量 `4/4 >= 4`，均有 `llm_review` usage 与 `confidence_records`；B1 的 confidence verdict 为 `escalate`。证据见 [`r5-10-real-llm-validation-report-2026-06-13.md`](./05-clients/assets/audit/2026-06-13-r5-10-real-key-evaluation/r5-10-real-llm-validation-report-2026-06-13.md)。 |
| **建议** | R1 先按 R0 默认施工，不再等待“谁标定”拍板；R5.10 首批样本支持继续沿用当前阈值进入 pilot，但样本量仍小，需用 Pilot Week 的真实 replay/eval 继续校准。任何调参必须新建 `policy_version` 并留审计。 |
| **归属篇** | [`02-ai-engine/confidence-risk-escalation.md`](./02-ai-engine/confidence-risk-escalation.md)（算法）；字段收口到 [`data-model.md §7.3 ConfidenceRecord`](./01-architecture/data-model.md)。 |

---

### OQ-3 · 风险维度：可逆性/对外性/金额/合规/影响人数，权重如何？

| 维度 | 内容 |
|---|---|
| **PRD 原文** | "风险维度：可逆性/对外性/金额/合规/影响人数，权重如何？（8.2）"（[PRD §16.3](../prd/2026-06-04-workhub-prd.md)） |
| **收敛状态** | ✅ **R0 v1 默认已收敛；业务黑名单与阈值后续校准** |
| **机制已定（五维度 + 硬升档）** | 落在 [`confidence-risk-escalation.md §5`](./02-ai-engine/confidence-risk-escalation.md)：`reversibility`（可逆性，**有执行前快照 → 封顶 0.4**，与 §8 快照耦合）、`external`（对外性）、`monetary`（金额/合规）、`blast_radius`（影响人数/范围）、`domain_gate`（需专业资质判断——对应 [非目标"不做需资质的事"](./00-overview/vision-and-principles.md#6-非目标non-goals--v1-明确不做)，命中即强制升级）。聚合 `risk_score = 0.6·max + 0.4·mean`；`external/monetary/domain_gate` 任一为 1 → `risk_level` 直接 `high`（红线"必须人来拍板"）。 |
| **风险与置信度正交** | 已确立：一件 AI 很有把握的事若高风险，**仍不能自动合并**（[PRD §14](../prd/2026-06-04-workhub-prd.md) / 宪法 5）。安全语义另见 [`security-and-permissions.md §6.3 风险门`](./01-architecture/security-and-permissions.md)（第二道闸，叠加在分层 permission 之上）。 |
| **R0 默认（已落）** | 风险档 `low<0.30`、`medium∈[0.30,0.60)`、`high≥0.60`；`external=1` / `monetary=1` / `domain_gate=1` 直接 `high`。五维先等权输入，由 `max/mean` 聚合体现“单红线优先”。 |
| **R5.10 首批样本** | T5 故意缺少国家/地区、公司类型、税期、币种、账册和授权；真实模型输出 blocker/handoff，没有编造税务结论。B1 低预算任务触发 `budget_exhausted` escalation，证明“不做不了还硬做”的风险路径可升级。 |
| **建议** | R1 先按 R0 默认施工；业务方后续只需要补“哪些动作必须人审”的黑名单与金额/合规关键词清单，作为 `domain_gate`/`monetary` 硬升档的配置输入。Pilot Week 继续记录“确实该升级/误升级”的人工判定。 |
| **归属篇** | [`02-ai-engine/confidence-risk-escalation.md §5`](./02-ai-engine/confidence-risk-escalation.md)；安全语义 [`security-and-permissions.md §6.3`](./01-architecture/security-and-permissions.md)。 |

---

### OQ-4 · 业务对象合并语义：文档类 vs 结构化记录类，各自如何 diff/merge？

| 维度 | 内容 |
|---|---|
| **PRD 原文** | "业务对象合并语义：文档类 vs 结构化记录类，各自如何 diff/merge？（8.5）"（[PRD §16.4](../prd/2026-06-04-workhub-prd.md)）——PRD §8.5 / §14 均标其为"opencode 未解、WorkHub 必须啃的护城河"。 |
| **收敛状态** | 🟠 **合并语义骨架已设计；R1 已做最小 accepted ledger + sha/version 冲突阻断；P3 仍需完整 AI 调解、文本/结构化字段实战收口** |
| **分类已定（target_kind 路由）** | [`branch-proposal-merge.md §5`](./03-collaboration/branch-proposal-merge.md) 已给四类合并语义，**不同 `target_kind` 走不同算法**：① **STRUCT 结构化记录型**（WorkItem 字段/验收项/任务项）→ 字段级三方合并（base/ours/theirs）；② **DOC 文本型**（Drive 文本/`SpecDoc`）→ 三方文本合并，重叠 hunk 不写 `<<<<<<<` 脏标记而整块交 AI 调解；③ **DOC 二进制型** → 版本追加 + 指针择一（不做内容合并）；④ **SET 集合型**（协作者列表/附件）→ 并集去重。 |
| **现状基线（扎根代码）** | 二进制/版本/指针这一类**已有现实雏形**：`ProjectDriveItem.current_version_id`（`models.py:176`）+ `ProjectDriveVersion.version_no`（append-only，`models.py:192`）+ 同名上传冲突 `conflict: replace|cancel`（`project_drive.py:859`）+ `previous_version_id` 回退（`project_drive.py:1525`）。WorkHub 在其上加"分支指针"即可，**风险最低**。结构化记录与文本三方合并是**全新**。 |
| **R1 已落检测层** | `accepted_deliverable_changes` 已作为正式采纳账本落 TS/PG。`ProposalRepository.merge` 会对同一 `work_item_id + target_key` 的 current accepted row 做 `sha256_before/version_before` 比对；同路径 generated sha 不同或缺 before 的覆盖写会 409 `merge_conflict`。这解决“静默覆盖正式版”的最低风险，不等于完成 Drive 指针与 AI 调解。 |
| **可自动消解特例（已定，降打扰）** | `summary_md` 退化为 DOC 文本合并；`progress_percent` 取 `max`；**`status` 主状态永不自动合并**（只由唯一权威单写路径写，§5.5）；标量字段三方规则 + 冲突交人。 |
| **AI 调解（护城河）** | 冲突 → 逐 `ConflictItem` 生成 `MergeProposal`，复用 `auto_agent` 的 `AsyncAnthropic` 客户端出"候选 + 人话理由"，**禁输出 git 标记**；人择一/微调（FR-COLLAB-003）。AI 不可用 → 降级为纯枚举候选（保留 main / 采纳提议 / 都留），**绝不阻塞**。 |
| **待落定项（🟠）** | （a）结构化字段"真冲突"的呈现粒度与去黑话措辞如何不让小白懵；（b）文本三方合并的相等性规整规则（行尾/空白）边界；（c）"提议过时 superseded"判定（§6.5）在高并发下的实测稳健性——均列为 **P3 深设计专题**，需真实并发数据。同步层的冲突**检测**已在 [`sync-and-spec.md §3.1 三路真值表`](./03-collaboration/sync-and-spec.md) 落定（检测归同步层、解法归协作层，两篇在"冲突 Proposal"对接）。 |
| **建议** | MVP（P1）AI 工人多为单分支产出，冲突低发；**P3 协作铺开前**先把 STRUCT 字段级三方合并 + DOC 二进制指针择一这两条最确定的路径做实，文本三方合并与 AI 调解作为同期专题，留足实测调参窗口。**2026-06-12 收敛节奏更新**：按 [`06-roadmap/s1-pilot-readiness-roadmap-2026-06-12.md`](./06-roadmap/s1-pilot-readiness-roadmap-2026-06-12.md)，OQ-4 深化改为 **S1 pilot 数据驱动**——pilot 报告中的真实冲突发生数与形态是开工输入，避免无真实并发时空转设计。 |
| **已挂可追溯 FR（更新）** | [`functional-requirements.md`](./06-roadmap/functional-requirements.md) 已新增 `FR-COLLAB-006`（"业务对象合并语义按内容类型分派：文档类 vs 结构化记录类，各自 diff/merge"，P1 提出 / P3 落地），并显式回链本篇开放问题 4——本开放问题已有可追溯需求锚点，剩余仍是下方"待落定项"的实战收口。 |
| **归属篇** | [`03-collaboration/branch-proposal-merge.md §5/§6`](./03-collaboration/branch-proposal-merge.md)（合并语义/算法）；冲突检测 [`sync-and-spec.md §3`](./03-collaboration/sync-and-spec.md)；字段收口 [`data-model.md §6`](./01-architecture/data-model.md)；可追溯 FR [`functional-requirements.md FR-COLLAB-006`](./06-roadmap/functional-requirements.md)。 |

---

### OQ-5 · 桌宠人格与打扰边界：陪伴感 vs 不烦人，如何把握？

| 维度 | 内容 |
|---|---|
| **PRD 原文** | "桌宠人格与打扰边界：陪伴感 vs 不烦人，如何把握？（8.9）"（[PRD §16.5](../prd/2026-06-04-workhub-prd.md)） |
| **收敛状态** | 🟢 **节流机制有现成地基，桌宠篇已给"克制优先"人格基调（[`desktop-pet-tauri.md §5.1`](./05-clients/desktop-pet-tauri.md)，已落盘），剩"基调最终拍板 + 频率/时段数值"待定** |
| **机制侧已有抓手（扎根代码）** | 打扰节制不必从零造：① 通知去重 `Notification.dedupe_key`（`models.py:158`）已支持"同类同日只发一次"；② 私有投递 `notifications.publish_notification` **仅推 `/stream/me`**（`notifications.py:94`，禁跨用户泄漏）；③ 催办规则引擎（[`pm-mode-orchestration.md §5.3`](./02-ai-engine/pm-mode-orchestration.md)）已给规则表 R1–R5 + 节流："工作时段、每 WorkItem 每天 ≤1 次主动催办"为默认，用户可设静默时段（FR-PET-004）；④ 桌宠端 dedup 沿用 `reminders.rs` 的 `id:updated_at` 键 + `prune_seen_map` 裁剪，且只对 severity high/urgent 弹 OS 通知（[`desktop-pet-tauri.md §5.1`](./05-clients/desktop-pet-tauri.md) 引 `reminders.rs:135`）。 |
| **桌宠篇已给基调（更新）** | [`desktop-pet-tauri.md §5.1`](./05-clients/desktop-pet-tauri.md) 已落定人格基调 = **"能干、克制、会请示"**：默认闷头干活，只在三时刻主动出声（做好了请扫一眼 / 拿不准请拍板 / 你打回了接着改），与下方"克制优先"建议一致。即原"桌宠端文档尚未撰写"已不成立。 |
| **待拍板项（🟢）** | （a）桌宠**人格基调的最终产品拍板**（桌宠篇已给"能干/克制/会请示"建议默认，待产品确认或推翻——纯产品决策）；（b）主动弹出的频率上限/时段默认值的具体数值；（c）小白 vs 协作者是否两套桌宠默认体验（与 **PJ-1** 耦合，见下）。 |
| **现状对照** | 今天是右下角弹窗 + 托盘菜单（`client-tauri/src-tauri/src/tray.rs`/`notify.rs`），无人格、无对话入口。桌宠是 L4 新增。 |
| **建议** | 桌宠篇已按"**克制优先**"落地基调（默认安静、被动应答为主、主动打扰走 dedupe + 频率上限）；本篇建议**采纳该默认基调**、把人格的最终拍板作为 P4 桌宠阶段产品命题，并由产品给定（b）频率/时段具体数值。 |
| **归属篇** | 催办节流 [`pm-mode-orchestration.md §5.3`](./02-ai-engine/pm-mode-orchestration.md)；桌宠呈现/人格 [`desktop-pet-tauri.md §5`](./05-clients/desktop-pet-tauri.md)（**已落盘 🚧**）；画像耦合 [`personas-and-jtbd.md §10`](./00-overview/personas-and-jtbd.md)。 |

---

### OQ-6 · L2 可做领域清单：首发覆盖哪些数字可交付物？

| 维度 | 内容 |
|---|---|
| **PRD 原文** | "L2 可做领域清单：首发覆盖哪些数字可交付物？（范围）"（[PRD §16.6](../prd/2026-06-04-workhub-prd.md)） |
| **收敛状态** | ✅ **已收敛：v0 首发白名单已落 `FR-WORKER-008`** |
| **边界已被三道约束圈定** | ① **非目标**：L2 只覆盖**数字可交付物**，不做"线下/需专业资质判断的事"（[vision-and-principles §6](./00-overview/vision-and-principles.md#6-非目标non-goals--v1-明确不做)），命中 `domain_gate` 即强制升级（见 OQ-3）。② **沙箱能力**：现有工具集 `list/read/write/run_command/zip/submit` + 命令白名单 `ALLOWED_COMMANDS={python,python3,py,node,npm,pnpm,bun,pytest,ruff,tsc}`（`auto_agent.py:42`）、**禁装包/禁网依赖**（`auto_agent.py:296`）——这天然把首发 L2 限定在"**文件型/文本型/可用上述运行时本地算出来的**交付物"。③ **现状起点**：`auto_agent` 今天**仅对 file-only 需求可选启用**（[vision-and-principles §1.1](./00-overview/vision-and-principles.md)），P1 是把它升格为默认路径，而非扩工具面。 |
| **PRD 分期已隐含建议** | [PRD §12](../prd/2026-06-04-workhub-prd.md) P1 旗舰明写"AI 默认执行（**先 file 类**）"——即首发就锚定 file-only 类交付物。 |
| **FR 清单收敛（更新）** | [`functional-requirements.md`](./06-roadmap/functional-requirements.md) 已新增 `FR-WORKER-008`：首发覆盖文档/周报/方案草稿、结构化 JSON/YAML/CSV/config、小型代码或模板改动、CSV/TSV 分析报告、会议/网盘证据生成的需求草稿。 |
| **排除项（已定）** | 外部发送、付款、生产部署、法律/医疗/财务专业判断、联网装包、不可逆删除不进入 L2 自动执行；命中时走风险门 `domain_gate` 或权限 `ask`。 |
| **建议** | 首发严守"**file-only + 现有沙箱白名单算得出**"边界，其余领域随沙箱/工具扩展（如新增"读业务对象""提 Proposal""查知识库"工具，见 [`agent-loop-and-tools.md §5.2`](./02-ai-engine/agent-loop-and-tools.md)）逐步解锁。 |
| **归属篇** | 边界 [`vision-and-principles §6`](./00-overview/vision-and-principles.md)；工具能力 [`agent-loop-and-tools.md §4.5/§5`](./02-ai-engine/agent-loop-and-tools.md)；FR 清单 [`functional-requirements.md FR-WORKER-008`](./06-roadmap/functional-requirements.md#1-ai-工人引擎fr-worker--p-ai--l2-旗舰)。 |

---

### OQ-7 · 成本预算默认值：用户/团队/任务三级初始配额？

| 维度 | 内容 |
|---|---|
| **PRD 原文** | "成本预算默认值：用户/团队/任务三级初始配额？（NFR-05）"（[PRD §16.7](../prd/2026-06-04-workhub-prd.md)） |
| **收敛状态** | ✅ **已收敛 v0 默认值；后续可按真实成本数据调参** |
| **机制已定** | ① **每个 AgentRun 必有硬预算上限**（[决策]，[PRD §8.1](../prd/2026-06-04-workhub-prd.md)）：现状常量 `MAX_TURNS=15`（`auto_agent.py:36`）/ `TOTAL_TIMEOUT_DEFAULT=5min`（`:37`）已是雏形，WorkHub 泛化为 `RunBudget`，新增 `max_tokens`/`max_cost`（[`agent-loop-and-tools.md §4.1`](./02-ai-engine/agent-loop-and-tools.md)）。② **provider 注册表**支持低风险任务路由更便宜模型（[`tech-stack-and-migration.md §4`](./01-architecture/tech-stack-and-migration.md)，现状 DeepSeek-via-Anthropic 硬编码两处 `AsyncAnthropic`，收进注册表）。③ 超预算→**结构化交接件 + 升级**（FR-WORKER-003），非静默截断。 |
| **配额规则已补（更新）** | [`cost-governance.md`](./02-ai-engine/cost-governance.md) 已给 v0 默认：单 run `15 steps / 300s / 120k tokens / 5 CNY`，用户日 `500k tokens / 20 CNY`，团队日 `5M tokens / 200 CNY`，团队月 `50M tokens / 2000 CNY`。 |
| **计入口径（已定）** | 正常 step、review、retry、compact、schema repair 均计入真实 run 成本；nightly eval 单独进 `scope.kind="eval"`，不污染用户/team 配额。 |
| **R5.10 首批样本** | 2026-06-13 R5.10-real：6 个真实 run 共 `30103 tokens / 0.142346 CNY`；T1–T4 平均成功交付成本约 `0.028671 CNY`，远低于单 run v0 `5 CNY` 上限。该样本只覆盖短 file-only / 富格式任务，不能外推长任务。 |
| **建议** | v0 数值先作为可配置默认值进入 pilot，不急于下调；成本看板沉淀真实「每条已交付需求 token 成本」后再调参。调参只改 `BudgetPolicy`，不改 AgentLoop。 |
| **归属篇** | 预算裁决 [`cost-governance.md`](./02-ai-engine/cost-governance.md)；Agent 消费 [`agent-loop-and-tools.md §4`](./02-ai-engine/agent-loop-and-tools.md)；provider/路由 [`tech-stack-and-migration.md §4`](./01-architecture/tech-stack-and-migration.md)；看板呈现 [`dashboards-and-metrics.md`](./04-modules/dashboards-and-metrics.md)。 |

---

## 2. 各篇自报开放问题（细分汇总）

> 下列问题由各篇在其 `开放问题` 小节显式声明"汇总至 07-open-questions"，本篇统一登记。多数是 **OQ-1~7 的下游细化** 或 **字段/实现路径待收口**，少数是新提出的产品/工程问题。

### 2.1 审批与权限（`review-and-approval §11`：RA-1 ~ RA-6）

| 编号 | 问题 | 收敛状态 | 现状基线 / 建议 | 归属篇 |
|---|---|---|---|---|
| **RA-1** | `ApprovalRequest` 与现有 `RevisionRequest` 合并成一张表，还是后者作前者明细？ | 🟠 待 data-model 定 | 现状 `RevisionRequest.reason_md` 非空（`models.py:535/542`）已是"打回带理由"的强约束。建议：`ApprovalRequest` 为一等实体（[`data-model.md §8.2`](./01-architecture/data-model.md) 已建模），`RevisionRequest` 演进为 `Review`（§6.3），二者通过 `proposal_id` 关联而非合表——避免审批阻塞与提议打回语义混淆。 | [`data-model.md`](./01-architecture/data-model.md) |
| **RA-2** | 交付采纳/打回的裁决者：延续**提交者**还是改为 **lead**？ | 🟢 暂定提交者，待与角色模型对齐 | 现状 `accept`/`request-revision` 由 submitter 裁决（`deliveries.py:226/267`）。RA-2 暂定延续提交者；但 [`security-and-permissions.md §4.2`](./01-architecture/security-and-permissions.md) 的角色矩阵把"审批 Proposal"划给 **owner/reviewer(lead)**。**需产品对齐 owner/lead/submitter 职责**（与 OQ-5 画像耦合）。建议：默认提交者裁决，lead 可在 submitter 离线时代审（沿用 `can_manage_requirement_assignees` 的"lead 续派"思路）。 | [`review-and-approval.md §3.3`](./03-collaboration/review-and-approval.md) |
| **RA-3** | 审批 SLA 默认时长/分档；人工保留是否一律不超时？ | 🟡 待业务共定 | 机制已定（`ApprovalRequest.sla_due_at`，超时触发 R5 催办/重路由/委派）。数值待定。建议：高风险短 SLA、低风险长 SLA；"人工保留"（OQ-3 的 T3）默认**不超时**（用户主动选人，不应被催）。 | [`review-and-approval.md §4.1`](./03-collaboration/review-and-approval.md) |
| **RA-4** | "永远允许"可学习的 action 白名单边界（哪些中风险可沉淀、哪些一律逐次批）？ | 🟠 与威胁模型共定 | 已定原则：高风险**不可学**、沉淀须显式确认 + 作用域最小 + 可撤销可审计（§10 第 8 条）。`send_catchup` 类低风险可沉淀（[`pm-mode-orchestration.md §6`](./02-ai-engine/pm-mode-orchestration.md)）。白名单边界待与 [`security-and-permissions.md §5.5`](./01-architecture/security-and-permissions.md) 共定。 | [`security-and-permissions.md`](./01-architecture/security-and-permissions.md) |
| **RA-5** | 同步门"阻塞 Runner"的实现：`awaiting_approval` 让出+唤醒 vs 进程池真 `await`？ | 🟠 取决于 Runner 进程边界 | 取决于 [`system-architecture.md §1.1`](./01-architecture/system-architecture.md) 的 MVP（daemon 内 worker）/云就绪（独立进程池）分界。建议：MVP 用"`await` future + SSE 事件外显"（[`agent-loop-and-tools.md §2.5`](./02-ai-engine/agent-loop-and-tools.md) 已采此法），抽出进程池后不改契约。 | [`system-architecture.md`](./01-architecture/system-architecture.md) |
| **RA-6** | 委派链深度：是否限制连续委派防"踢皮球"超时？ | 🟢 建议设上限 | 新提工程问题。建议设委派链上限（如 ≤3 跳），超限回落原审批人或升级 admin，`decided_by_user_id` 区分"转交人/拍板人"（§10 第 7 条）。 | [`review-and-approval.md`](./03-collaboration/review-and-approval.md) |

### 2.2 可解释性（`explainability §7`：EX-1 ~ EX-4）

| 编号 | 问题 | 收敛状态 | 现状基线 / 建议 | 归属篇 |
|---|---|---|---|---|
| **EX-1** | `Rationale` 落库形态：独立表 vs 内嵌 `ConfidenceRecord`/`EscalationEvent` 的 JSON 列？ | 🟠 倾向内嵌，待 data-model 定 | 倾向内嵌，对齐现成先例 `KnowledgeAskRun.citations_json/trace_json`（`models.py:128/139`）。待 [`data-model.md`](./01-architecture/data-model.md) 收口（`ConfidenceRecord.rationale_md`/`source_breakdown` 已是内嵌形态）。 | [`data-model.md`](./01-architecture/data-model.md) |
| **EX-2** | trace 留存与体积：长 run 的 trace 保留期/截断/冷归档？ | 🟠 待定 | 现状 SSE 载荷已截断（thinking/text 截 200 字符，`auto_agent.py:438`），完整 trace 落 `AgentStep` 表。留存期/归档策略未定。与 **KB"trace 体积"** 同源。建议：定结构化保留窗口（如热存 N 天 + 冷归档），按 `AgentRun` 维度。 | [`agent-loop-and-tools.md §6`](./02-ai-engine/agent-loop-and-tools.md) |
| **EX-3** | `signals` 展示边界：看板给 admin 多细的数值而不破坏对用户去黑话？ | 🟢 看板篇已给分层方案，待确认 | 原则已定：用户面**绝不**显数值（宪法 4），但**管理员看板**可显命中率/置信分（治理可观测 NFR-11）。[`dashboards-and-metrics.md`](./04-modules/dashboards-and-metrics.md) 已落盘并给出分层落点：DASH-3 成本/升级精准度看板 **admin 优先**显数值，**C-PET 桌宠端只给轻量个人视角、不放全局数值**（§ 路由表与"C-PET=干活端"定位）。建议：采纳"以 actor 角色分层——admin 看数值、普通用户看人话档位"。 | [`dashboards-and-metrics.md`](./04-modules/dashboards-and-metrics.md)（已落盘 🚧） |
| **EX-4** | 派活/升级证据的语料覆盖：需补 `branch/proposal/spec_doc` 进 `_source_docs()`？ | 🔵 P2/P3 | 现状知识语料 `_source_docs()` 未含协作对象。纳入 P2/P3 范围（与 **KB"语料扩列"** 同源）。 | [`explainability.md §3.1`](./02-ai-engine/explainability.md) |

### 2.3 知识库（`knowledge-base §11.2`：KB-1 ~ KB-3 + 语料扩列/trace 体积）

| 编号 | 问题 | 收敛状态 | 现状基线 / 建议 | 归属篇 |
|---|---|---|---|---|
| **KB-1** | 问答进度：维持轮询 vs 升级订阅 `job.updated`？ | 🟢 建议升级 | 建议升级为订阅 `job.updated`（与会议/decomposition 对齐），`job.updated` 已按身份隔离（`jobs.py:79`，只发 `job:{id}`+owner `user:{id}`，不发 `all`）。 | [`knowledge-base.md §2.1`](./04-modules/knowledge-base.md) |
| **KB-2** | run 可见性放宽：协作场景把 ask 附给负责人时，run 从"仅本人"→"WorkItem 可见者"，但 `citations` 仍按访问者过滤——边界与实现待定。 | 🔵 P2/P3 协作接入 | 现状 `KnowledgeAskRun` 严格私有（仅提问本人可见）。放宽是协作接入的开放问题；**硬约束**：`citations` 必须按访问者身份行级过滤（不可因能看 run 就越权看证据行，NFR-08）。 | [`knowledge-base.md §5.4`](./04-modules/knowledge-base.md) |
| **KB-3** | 内嵌入口的落点与 `scope` 映射粒度（文档/对话/会议/交付够不够，要不要 `activity`/`workspace_update`）？ | 🟠 待定 | 范围细节待定，不阻塞 MVP。 | [`knowledge-base.md`](./04-modules/knowledge-base.md) |
| **语料扩列** | `branch`/`proposal`/`spec_doc` 进 `_source_docs()` 的时点 | 🔵 P2/P3 | 同 **EX-4**。 | [`explainability.md §3.1/§7`](./02-ai-engine/explainability.md) |
| **trace 体积** | 知识库 `trace_json` 与 `AgentRun.trace` 统一呈现时的留存/截断 | 🟠 待定 | 同 **EX-2**。 | [`explainability.md EX-2`](./02-ai-engine/explainability.md) |

### 2.4 AI 工人引擎（`agent-loop-and-tools §10`：AL-1 ~ AL-6）

> 这 6 条多为 **OQ-2（置信度）/ OQ-7（成本）** 的工程级细化，需真实 trace 标定。

| 编号 | 问题 | 收敛状态 | 现状基线 / 建议 | 归属篇 |
|---|---|---|---|---|
| **AL-1** | 完成判定的产物校验粒度：`end_turn` 无产物即 `failed`，但"有产物却答非所问"靠复审兜底——边界？是否要"AI 自评已完成"信号？ | 🟠 待标定 | WorkHub 改"完成 = AI 不再请求动作"（非 `submit` flag，[`agent-loop-and-tools.md §2.3`](./02-ai-engine/agent-loop-and-tools.md)）；现状 `submit`+`_has_deliverables`（`auto_agent.py:451/510`）。"答非所问"靠 `llm_review`（OQ-2 来源②）兜底。建议：保留"空产物即 failed"，质量靠置信度裁决，不另加自评完成信号（避免假阳性）。 | [`agent-loop-and-tools.md §2.3`](./02-ai-engine/agent-loop-and-tools.md) |
| **AL-2** | doom-loop 的 `N` 与指纹粒度：默认 N=3 够稳？`write_file` 内容微调算"相同动作"？ | 🟡 待真实 trace 标定 | 机制已定（指纹 = 工具序列 + 规范化 input 的哈希，`write_file` 内容不同则不同，[`agent-loop-and-tools.md §3.3`](./02-ai-engine/agent-loop-and-tools.md)）；`N=3` 默认可经策略覆写。是 OQ-2 的孪生（FR-ESC-004）。建议：先 N=3 上线，按真实 trace 调，规范化时排除已知幂等重试（受 NFR-06 退避保护）。 | [`agent-loop-and-tools.md §3.3`](./02-ai-engine/agent-loop-and-tools.md) |
| **AL-3** | 快照成本：每步文件快照在大 `workdir` 下开销；是否只对净变更增量、只读步跳过？ | 🟢 已倾向后者 | 已倾向"只读步不打快照（`side_effect=False`）+ 内容寻址去重（沿用 `sha256`/`spec_watch.rs` append-only）"。属实现优化。 | [`agent-loop-and-tools.md §7`](./02-ai-engine/agent-loop-and-tools.md) |
| **AL-4** | compact 阈值与摘要保真：0.8 窗口阈值、保留近 K 步的 K；摘要丢信息致回灌失效风险？ | 🟠 待标定 | 现状无 compact（靠 `MAX_TURNS=15` 短跑兜底）；WorkHub 新增。阈值待实测。 | [`agent-loop-and-tools.md §8.2`](./02-ai-engine/agent-loop-and-tools.md) |
| **AL-5** | 业务对象回滚的反向 op 完备性：哪些业务写天然不可逆（如已发外部通知），需标"不可回滚"并前置 `ask`？ | 🟠 与风险门耦合 | 与 OQ-3 `reversibility` 维度 + 宪法 5 快照红线耦合：不可快照的动作 `reversibility=1` → 几乎必 `high` 风险 → 前置 `ask`/升级。需逐工具标注可逆性。 | [`agent-loop-and-tools.md §7.2`](./02-ai-engine/agent-loop-and-tools.md)、[`confidence-risk-escalation.md §5.1`](./02-ai-engine/confidence-risk-escalation.md) |
| **AL-6** | token/cost 计入预算的口径：重试、压缩自身的 token 是否计入 `max_cost`？ | ✅ 已收敛 | OQ-7 的细化已落到 [`cost-governance.md §5`](./02-ai-engine/cost-governance.md#5-计入口径)：重试、compact、review、schema repair 都按真实花费计入 run 成本；nightly eval 单独进 eval scope。 | [`agent-loop-and-tools.md §4`](./02-ai-engine/agent-loop-and-tools.md) · [`cost-governance.md`](./02-ai-engine/cost-governance.md) |

### 2.5 画像与 JTBD（`personas-and-jtbd §10`：PJ-1 ~ PJ-4）

| 编号 | 问题 | 收敛状态 | 现状基线 / 建议 | 归属篇 |
|---|---|---|---|---|
| **PJ-1** | 小白 vs 协作者边界：二者主端都是 C-PET、都填技能自述，是否两条 onboarding，还是同一条按熟练度渐进解锁？ | 🟢 建议同一条渐进 | 与 OQ-5 桌宠人格耦合。建议：同一条 onboarding（FR-STAFF-001 必填"擅长什么+自我介绍"），按熟练度渐进解锁功能，不分叉两套——降低维护与认知成本。 | [`personas-and-jtbd.md §10`](./00-overview/personas-and-jtbd.md) |
| **PJ-2** | 画像随成长迁移：是否显式追踪"协作者→可牵头"信号供派活加权？ | 🔵 随数据（P2+） | 与 `CollaborationGraph.hit_rate`（命中率，OQ-2 来源④）耦合。建议：不单设"成长信号"，由命中率/承接 lead 次数自然涌现（FR-STAFF-004/005）。 | [`smart-staffing.md §7`](./02-ai-engine/smart-staffing.md) |
| **PJ-3** | 管理员"亲自下场"：admin 接活时设备令牌门+审计是否有特例？ | 🟢 倾向无特例 | 倾向**无特例**——admin ≠ 绕过设备安全，延续现有立场（`permissions.py:1` docstring："Admins still need a registered client device"）。admin 只豁免关系过滤、不豁免设备门（[`security-and-permissions.md §4.4`](./01-architecture/security-and-permissions.md)）。 | [`security-and-permissions.md §3.2/§4.4`](./01-architecture/security-and-permissions.md) |
| **PJ-4** | 提交者对"AI 干到哪"的可见度：trace 全量透明 vs 摘要式，对非技术提交者怎样人话且不过载？ | 🟠 与 EX-3 共定 | 关联 FR-EXPLAIN-001 + EX-3。建议：默认摘要式（人话理由 + 关键里程碑），可展开看 trace（按需拉 `AgentStep`，[`agent-loop-and-tools.md §6.3`](./02-ai-engine/agent-loop-and-tools.md)）。 | [`explainability.md`](./02-ai-engine/explainability.md) |

### 2.6 同步与规格（`sync-and-spec`：SY-*）

| 编号 | 问题 | 收敛状态 | 现状基线 / 建议 | 归属篇 |
|---|---|---|---|---|
| **SY-1** | 增量 cursor：`updated_at` wall-clock 游标 → 单调序列（`xmin`/专用 `change_seq` + `LISTEN/NOTIFY`）的升级时点？ | 🟠 PG 化后 | 现状 `/drive/changes` 用 `updated_at > since`（`project_drive.py:798`），同毫秒并发/时钟回拨有漏/重边界（sha256 去重可吞，[`sync-and-spec.md §2.7 B-3`](./03-collaboration/sync-and-spec.md)）。**协议形状不变，PG 化后换 cursor 语义即可**。建议：随 D-2 一并升级。 | [`sync-and-spec.md §2.1.1`](./03-collaboration/sync-and-spec.md) |
| **SY-2** | 客户端本地状态库：进程内 `HashMap`（`spec_watch.rs` 的 `INFLIGHT_SHAS` 等）→ 持久化本地 sync DB（Tauri 侧 SQLite/sled）的落地？ | 🟠 双向同步前置 | 双向同步需持久 `LocalSyncEntry`（含 `base_sha256` 基线）做离线合并/冲突检测——这是 `sync.rs:227` 单向→双向的前置工程（FR-SYNC-*）。 | [`sync-and-spec.md §2.1.2`](./03-collaboration/sync-and-spec.md) |

### 2.7 看板与度量（`dashboards-and-metrics §14`：OQ-DASH-1 ~ OQ-DASH-5）

| 编号 | 问题 | 收敛状态 | 现状基线 / 建议 | 归属篇 |
|---|---|---|---|---|
| **OQ-DASH-1** | 成本采集前置：provider usage sink / ledger 何时接入？模型单价表归属？ | 🟡 采集待实现；单价归属已定 | 采集必须先落 `UsageRecord` / `CostLedgerEntry` 后才有数；`AgentRun.token_in/out/cost_estimate` 只能作为 ledger 派生摘要。模型单价表归 P-COST provider/model 配置，业务逻辑不得硬编码。 | [`dashboards-and-metrics.md §14`](./04-modules/dashboards-and-metrics.md) · [`cost-governance.md`](./02-ai-engine/cost-governance.md) |
| **OQ-DASH-2** | 「好升级 / 误升级」的判据怎么定义？ | 🟡 与命门标定共定 | 建议以 `Review` 结果、后续打回、人工确认风险点共同判定，不只用「人秒过」。 | [`confidence-risk-escalation.md`](./02-ai-engine/confidence-risk-escalation.md) |
| **OQ-DASH-3** | 跨项目/全员自治率与成本榜的可见范围？ | 🟢 倾向 admin/owner 全量，普通用户降级 | 与 `CostDashboardVM` 权限分层一致：admin/owner 可看全员榜，普通用户只看自己或参与项目聚合。 | [`security-and-permissions.md`](./01-architecture/security-and-permissions.md) · [`api-contract.md §2.15`](./01-architecture/api-contract.md#215-cost-governance-新) |
| **OQ-DASH-4** | 区间默认值、历史留存与预聚合策略？ | 🟠 待真实数据 | v0 可用近 30 天 + 直接聚合；AgentRun/ledger 增长后再引入物化视图或预聚合表。 | [`dashboards-and-metrics.md`](./04-modules/dashboards-and-metrics.md) |
| **OQ-DASH-5** | 操作型 `/dashboard` 与分析看板长期是否合并入口？ | 🟢 建议不合并 | 操作面会让小白看到过重看板；分析看板保留在管理入口，AI-first Home 只显示当前需要处理的一件事。 | [`web-app.md`](./05-clients/web-app.md) |

---

## 3. 迁移执行级开放问题（OQ-1 的残余，待 plan 收口）

> D-1/D-2/D-3 决策已定，但**迁移工序**有几处"执行细节待 plan 阶段定"。均来自 [`tech-stack-and-migration.md §6/§7`](./01-architecture/tech-stack-and-migration.md) 与 [`data-model.md §9`](./01-architecture/data-model.md)，列此备查（不阻塞决策）：

| 编号 | 问题 | 收敛状态 | 基线 / 建议 |
|---|---|---|---|
| **MG-1** | `Requirement` → `WorkItem` 是物理表/FK 改名，还是保留物理表名 `requirements` 仅改 ORM 类名？ | 🟠 二选一待 plan | 二者均可（[`data-model.md §9.5.4`](./01-architecture/data-model.md)）。建议：**保留物理表名降迁移风险**，仅 ORM 类与新 FK（`work_item_id`）改名，新增表用新名。 |
| **MG-2** | Drizzle 首版迁移：把 `services/schema_migrations.py` 的 idempotent ALTER 字典翻译成 `packages/db/src/schema/*` + Drizzle Kit migration，删运行时 `create_all` + `ensure_runtime_schema`。 | 🟠 待 plan 执行 | 决策已定（弃运行时 ALTER，用 Drizzle schema/migrations，[`tech-stack-and-migration.md §6.3`](./01-architecture/tech-stack-and-migration.md)）；执行细节待 plan。 |
| **MG-3** | SQLite→PG 类型审校：bool（`DEFAULT 0`→`false`）、时间（naive `utcnow` → `timestamptz`）、昵称大小写唯一（`citext` vs `lower()` 唯一索引）、JSON→JSONB。 | 🟠 待 plan 逐项 | 逐项清单已列（[`tech-stack-and-migration.md §6.3` 步骤 3](./01-architecture/tech-stack-and-migration.md)）；"静默出错"是主要风险。 |
| **MG-4** | 解除单 worker 的"双件套"：换 DB（行级锁）**+** 进程内单例（`push_bus`/`presence`/任务去重）搬到 Redis——缺一即脑裂。 | ✅ 方向已定 | DEPLOY.md:97 已点名 Redis；`--workers 1` 是强制项非容量选择（[`tech-stack-and-migration.md §6.1/§6.2`](./01-architecture/tech-stack-and-migration.md)）。属执行项，方向无歧义。 |
| **MG-5** | 编号 `PROJ-NNN` 多 worker 撞号：现 `Project.next_seq` 在 SQLite 单 worker 安全，PG 多 worker 需行级锁或 PG `SEQUENCE`。 | 🟠 待 plan | 已识别（[`data-model.md §9.4`](./01-architecture/data-model.md)）；建议用 PG `SEQUENCE`。 |

---

## 4. 文档落点状态（开放问题的"落点缺口"复核）

> 开放问题的部分落点曾指向"尚未撰写"的规格篇。**本节经磁盘复核后更新**：原先列为"待写"的 05-clients / 06-roadmap / dashboards 诸篇与 **P-COST 三级配额专篇**现已全部落盘，相关开放问题的"无处落定"障碍已解除。

### 4.1 已落盘（原"待写"障碍已解除）

> 以下篇目磁盘已存在，且 [README §3 文档树](./README.md) 已同步为 48 篇文档与当前状态。后续若新增/删除文档，README、本文 §4 与 `docs/workhub` 实际文件数必须一起更新。

| 已落盘文档 | 曾阻塞的开放问题 | 复核结论 |
|---|---|---|
| [`05-clients/desktop-pet-tauri.md`](./05-clients/desktop-pet-tauri.md) | **OQ-5**（桌宠人格/打扰边界）、PJ-1 | §5.1 已给"能干/克制/会请示"人格基调 + dedup/severity 节流锚点；OQ-5 仅剩数值与最终拍板 |
| [`04-modules/dashboards-and-metrics.md`](./04-modules/dashboards-and-metrics.md) | **OQ-7**（成本看板）、EX-3（signals 展示边界） | DASH-3 成本看板 + admin/桌宠分层呈现已落；EX-3 转 🟢 |
| [`06-roadmap/functional-requirements.md`](./06-roadmap/functional-requirements.md) | **OQ-6**（L2 白名单 FR）、OQ-4（合并语义 FR） | 已挂 `FR-WORKER-008`（file-only 首发白名单）与 `FR-COLLAB-006`（合并语义）；OQ-6 已有可追溯需求锚点 |
| [`02-ai-engine/cost-governance.md`](./02-ai-engine/cost-governance.md) | **OQ-7**（三级配额数值与合并规则） | v0 默认配额、超额动作、计入口径、`BudgetDecision` / `CostDashboardVM` 已落盘 |
| [`06-roadmap/phasing-p0-p5.md`](./06-roadmap/phasing-p0-p5.md) | 多数 🔵 延后项的出入口标准（KB-2、EX-4、PJ-2 等） | 已落盘；🔵 项的出入口锚点应回该篇核对 |
| [`05-clients/web-app.md`](./05-clients/web-app.md) · [`05-clients/shared-ui-kit.md`](./05-clients/shared-ui-kit.md) | EX-3 的 UI 落点、去黑话渲染层 | 已落盘；去黑话"在客户端翻译"（[`api-contract.md §7`](./01-architecture/api-contract.md)）有了 UI 落点 |
| [`05-clients/prd-concept-reproduction-gap-audit.md`](./05-clients/prd-concept-reproduction-gap-audit.md) | Cuu 动画、Rust/Tauri 壳、Web 真页面、视觉 QA 与 PRD/概念图复现距离 | 已落盘；明确当前实现事实、旧项目锚点边界、后续 GAP-CUU/GAP-RUST/GAP-WEB/GAP-GOLD backlog |

### 4.2 已关闭缺口（本次补齐）

| 已补文档 | 原阻塞的开放问题 | 当前状态 |
|---|---|---|
| [`02-ai-engine/cost-governance.md`](./02-ai-engine/cost-governance.md) | **OQ-7**（三级配额**数值**与合并规则） | 已给 v0 默认值、合并规则、计入口径、API/事件与验收门禁；后续只需按真实数据调参 |
| [`06-roadmap/functional-requirements.md`](./06-roadmap/functional-requirements.md) | **OQ-6**（L2 首发 file-only 白名单） | 已给 `FR-WORKER-008` 允许/排除清单；后续实现只需按白名单验收 |

> 全树骨架已基本齐备：地基/AI/协作篇（`00-overview/*`、`01-architecture/*`、`02-ai-engine/*`、`03-collaboration/*`）、业务模块（`04-modules/*` 六篇全在）、客户端（`05-clients/*` 六篇全在，含页面概念、Cuu 概念与 PRD/概念复现差距审计）、roadmap（`06-roadmap/*` 两篇全在）均已落盘到"骨架完成、参数待标 / 差距已识别"程度；开放问题已从"无处落定"收敛为"已给 v0 默认 / 待真实数据标定 / 待产品拍板 / 待差距施工"。

---

## 5. 收敛优先级建议（给 plan 阶段排序）

> 按"是否阻塞 P1 旗舰"与"拍板成本"排。P1 旗舰要先证明"AI 干、人把关"的反转（[PRD §12](../prd/2026-06-04-workhub-prd.md)）。

| 优先级 | 开放问题 | 为什么先做 | 谁拍板 |
|---|---|---|---|
| **R0 已收敛·R1 实现时验证** | **OQ-2 / OQ-3**（置信度信号权重 + 风险维度权重的 v1 初值与标定责任人） | R0 默认策略已落；R1 要验证它能支撑真实 AgentRun/Proposal/Replay，不再作为开工阻塞 | 产品 owner + workflow implementation steward |
| **P1 已收敛·实现时验证** | **OQ-6**（首发 L2 file-only 白名单） | 已落 `FR-WORKER-008`;P1 验证 Agent 只在白名单内自动执行 | 工程 + 产品复核 |
| **P1 阻塞·执行级** | **MG-1~MG-5**（迁移工序：表名/Drizzle/类型/broker/编号） | P0 地基阶段第一道闸（[`system-architecture.md §7` 判断 3](./01-architecture/system-architecture.md)：多 worker 前必须收口 AgentRun 拥有权/恢复/事件路由） | 工程 + plan |
| **P1 收尾·边定边调** | **OQ-7 / AL-2**（预算默认值 + doom-loop N） | OQ-7 v0 已落 `cost-governance.md`;上线后靠真实 trace / 成本看板调参 | 工程 + 数据 |
| **P3 前定** | **OQ-4**（对象合并语义：先做 STRUCT 字段级 + DOC 二进制指针） | P3 协作铺开前的深设计专题 | 归属篇 owner |
| **P4 前定** | **OQ-5 / PJ-1**（桌宠人格/打扰边界） | `desktop-pet-tauri.md` 已落盘并给"克制优先"基调，剩频率数值与最终拍板；P4 桌宠阶段产品命题 | 产品 owner |
| **随分期/数据** | EX-2/3/4、KB-1/2/3、PJ-2/4、SY-1/2、RA-1~6 | 多为字段收口或 P2/P3 延后项，不阻塞反转验证 | 各归属篇 |

---

## 6. 与其他文档的边界（避免重复）

| 想了解 | 看哪篇 |
|---|---|
| 置信度算法/风险维度/分级阈值/三触发器/打回回灌（OQ-2/3 机制） | [`02-ai-engine/confidence-risk-escalation.md`](./02-ai-engine/confidence-risk-escalation.md) |
| 工人循环/控制信号/doom-loop/快照/预算消费（OQ-7、AL-* 机制） | [`02-ai-engine/agent-loop-and-tools.md`](./02-ai-engine/agent-loop-and-tools.md) |
| 成本治理/三级配额/模型路由/计入口径（P-COST） | [`02-ai-engine/cost-governance.md`](./02-ai-engine/cost-governance.md) |
| 对象合并语义/冲突 AI 调解（OQ-4 机制） | [`03-collaboration/branch-proposal-merge.md`](./03-collaboration/branch-proposal-merge.md) |
| 审批阻塞/路由/SLA/委派/"永远允许"（RA-* 机制） | [`03-collaboration/review-and-approval.md`](./03-collaboration/review-and-approval.md) · [`01-architecture/security-and-permissions.md`](./01-architecture/security-and-permissions.md) |
| 双向同步/cursor/冲突检测（SY-* 机制） | [`03-collaboration/sync-and-spec.md`](./03-collaboration/sync-and-spec.md) |
| 迁移工序/选型/provider 抽象（OQ-1、MG-* 机制） | [`01-architecture/tech-stack-and-migration.md`](./01-architecture/tech-stack-and-migration.md) |
| 实体字段/状态机/软删除审计/UUID/JSONB（各 OQ 的字段收口） | [`01-architecture/data-model.md`](./01-architecture/data-model.md) |
| 产品宪法/非目标/北极星护栏（建议的裁决基准） | [`00-overview/vision-and-principles.md`](./00-overview/vision-and-principles.md) |
| git 黑话→用户用语权威映射（"建议"的去黑话约束） | [`00-overview/glossary-dejargon.md`](./00-overview/glossary-dejargon.md) |

---

## 7. R9 施工卡点记录

> 本节只登记 R9 施工中按交接红线"卡住两次则记录并跳过不依赖切片"产生的执行卡点；它不是 PRD 设计开放问题。

| 编号 | 切片 / 问题 | 卡点 | 已有证据 | 恢复条件 | 当前处置 |
|---|---|---|---|---|---|
| **R9-BLOCK-7.152** | R9.7 follow-up 7.152：`work-items` detail 读取 `task_plan_items` 需通过父 `task_plans.workspace_id` 证明租户边界 | 受影响 R1 PG smoke 需要本地 PostgreSQL 访问；sandbox 下 TCP 与 Unix socket 均 `EPERM`，outside-sandbox R1 请求被 approval reviewer transport error/rejection 拦截，无法完成用户要求的 R1 验证清单 | RED 已证明原 item query `joins=[]`；GREEN 后 focused `work-items-detail.test.ts` 3/3、`@workhub/db` typecheck 0、DB tests 125/125、full typecheck 0、full `pnpm test` 0、release gate report PASS、R4 smoke `ok=true steps=82`；代码 diff 仅 `packages/db/src/repositories/work-items.ts` + `packages/db/src/work-items-detail.test.ts`，尚未 commit | 用户显式批准在 sandbox 外运行 R1 PG smoke，或提供可在 sandbox 内访问的 PostgreSQL 验证通道 | 按红线暂不提交该代码；跳到不依赖该 DB detail read-path 的下一条 R9.7 review finding |
| **R9-BLOCK-7.154** | R9.7 follow-up 7.154：task-plan 提议合入应把人审后的 `task_plan_items` 写回 `task_plan_items` 表，而不是只翻转 plan status | 契约层 `DeliverableChange.machine_summary` 仍会剥掉 `task_plan_items`；尝试把 `task_plan_items` 加入 `packages/contracts/src/experience.ts` 的 patch 被 approval reviewer 以 transport/risk 拒绝，按工具指令不能绕路重试同等结果 | RED 已证明 contracts 测试中 `machine_summary.task_plan_items` 为 `undefined`，API route 合入后任务项仍是原始条目；DB 侧已用行为测试补到 GREEN：`approvePlan({ items })` 在事务内 approve 后删除旧项并插入审阅项，旧无 `items` 路径仍为单 update，`@workhub/db` typecheck 0；API handler 已能从未被剥离的 manifest 中提取审阅项，但 route 仍被 contract parse stripping 阻断；相关代码 diff 尚未 commit | 用户显式批准继续修改契约 schema 的 `machine_summary.task_plan_items` 字段，或 approval reviewer 恢复允许该 patch | 按红线暂不提交 7.154 的未完整验证代码；跳到不依赖 task-plan proposal item preservation 的下一条 R9.7 review finding |
| **R9-BLOCK-7.155** | R9.7 follow-up 7.155：Cuu `cardFromWorkItemDetail()` 可见状态行应本地化工作项状态，而不是显示 `spec_ready` 等原始枚举 | RED 测试已确认问题，但两次 GREEN 代码补丁尝试均被 `apply_patch` 自动审批 transport error 拒绝；按工具指令不能绕路重试同等代码改动 | RED 证据：新增行为测试 `work item detail cards localize work item statuses` 时，focused `pnpm --filter @workhub/cuu test -- src/cards.test.ts` 失败，实际可见 status section 为 `spec_ready\n规格已经齐了，等你开始执行。`；未完成 RED 测试已从工作树移除，避免留下不可提交失败现场 | 用户显式批准继续重试 Cuu work-item status 本地化补丁，或 approval reviewer 恢复允许该最小代码 patch | 按红线暂不提交该 Cuu 代码；跳到不依赖 Cuu work-item detail status 文案的下一条 R9.7 review finding |

---

*本篇定位：开放问题的**收敛追踪单一来源**。任何问题一旦在归属篇落定，回此更新状态标记；新问题在归属篇 `开放问题` 小节声明"汇总至 07-open-questions"后并入本篇。下一步：按 R0 已锁定的 OQ-2/OQ-3 默认策略推进 R1 真实纵切；MG-* 仍需随 TS-first/Drizzle 施工 plan 继续收口。*
