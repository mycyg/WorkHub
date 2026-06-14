---
module: S1-pilot-readiness
layer: 全局 / 路线图
status: active
owner: workflow
date: 2026-06-12
depends_on:
  - r4-mid-review-upgrade-audit-2026-06-11.md
  - r5-08-browser-smoke-ci-plan-2026-06-12.md
  - ../07-open-questions.md
  - ../00-overview/vision-and-principles.md
---

# S1 Pilot-Readiness Roadmap —— 北极星迭代计划

> **北极星**：让一个真实团队（单人或三人皆可）用核心闭环——**提需求 → AI 干 → 升级 → 审批 → 合并 → 回放**——真干一周的活。这一周跑通的那天，WorkHub 的价值从文档变成事实。
> **定位**：R5.8 之后的权威施工顺序。它把 R4 中期审查总评指出的四个战略风险（面太宽 / 桌宠占比失衡 / 护城河推迟 / 给谁用最薄）转成一条可执行的验证路径：**所有工期优先服务"核心反转被真实使用验证"这一件事**。
> **三个已拍板的决策（2026-06-12）**：① pilot 不依赖特定人员，目标是"系统 pilot-ready"，但仍必须通过 S1 Launch Gate 后才能开周；② C-PET/Cuu **不冻结**，按原节奏并行，但不在 pilot 关键路径上；③ OQ-4 护城河走 **pilot 数据驱动**——先收集真实冲突数据，再开深化。
> **2026-06-13 补充**：S1 Launch Gate 已 **PASS**。首轮 NO-GO 是部署环境缺失；随后本机 Docker Desktop + `docker-compose.pilot.yml` 真实栈完成起栈、部署容器 dry/real、backup/restore、管理员注册、Cost/Settings 中英 UI 与 fresh pilot 导航复验。S1 Day 0 Real Work Entry 也已 **PASS**：真实 `/intake` 入口创建 `DAY0PILOT-006`，AgentRun succeeded，Proposal merged，Replay/Cost/backup/restore 全留证。S1 Day 1 Feedback + Observability 已 **PASS**：第二用户非 admin 路径、六指标 API/CLI、feedback log、backup/restore 全绿。S1 Day 2 Feedback Hardening 已 **PASS**：post-run WorkItem clarity、browser QA resume/idempotency、opened QA artifact triage、Day2 metrics baseline、backup/restore 全绿。
> **2026-06-15 补充**：Day3 邀人前恢复 pilot runtime：根因是 Postgres idle 连接被管理命令终止后 `pg.Pool` 无 `error` listener，Node 进程退出；已补默认 handler、重建 compose，三服务 healthy，`/api/health` ok。下一施工入口仍是 [`s1-pilot-day3-expansion-plan-2026-06-13.md`](./s1-pilot-day3-expansion-plan-2026-06-13.md)。

---

## 1. 为什么是现在（战略依据）

[R4 中期审查](./r4-mid-review-upgrade-audit-2026-06-11.md)总评的核心判断：这个项目的风险不是方向错，而是"洞察很好 → 摊子铺开 → 最难的事被自然推迟 → 外围打磨吞掉工期"。R5.1–R5.8 已把六业务模块全部立起来、把浏览器回归门送进 CI——**外围债务已基本清完，现在是把工期押回核心反转验证的最佳时点**：

- "AI 是默认劳动力，人是审批者"这个核心反转，至今没有被任何真实使用验证过；
- agent 引擎（4400 行）相对桌宠（5.4 万行）的投入失衡，矫正方式不是砍桌宠，而是**把劳动力做实并证明它**；
- 商业化缝隙（服务不会用 git、不信任 AI 直出的中小团队的去黑话治理层）窗口有限，pilot 是验证这个缝隙是否真实的最快路径。

## 2. 现状盘点（2026-06-12 核查）

### 2.1 核心闭环已是真实现，不是 demo

| 环节 | 现状 | 证据 |
|---|---|---|
| 提需求 | option-first intake → sessions → workitems 三段真实 API 链 | R3.3–R3.5、R4.14 |
| AI 干 | 真实 agent loop：provider registry → 工具沙箱 → snapshot → deliverable manifest → **自动开 proposal** | `apps/api/src/workers/agent-runner.ts:653-697` |
| 升级 | 置信度记录（R0 v1 默认策略）、escalation、handoff | `apps/api/src/services/agent-run-confidence.ts` |
| 审批/合并 | approval 路由、reason gate、冲突工作台（field/line/subrecord 编辑器，已 React 化）、accepted ledger + sha 冲突阻断 | R4.13/R4.22/R4.23、R1.41-R1.44 |
| 回放 | replay 页 + 审计事实 + restore | R4.18 |
| 多用户地基 | 昵称制 identify + `admin_secret` 提权、设备令牌门、多 worker（PG claim/lease + Redis） | `apps/api/src/routes/auth.ts:27-36`、R2.x |
| 回归安全 | 66 步浏览器 smoke 已进 CI（64 秒/次） | R5.8 |

### 2.2 Pilot 三大真实差距

| # | 差距 | 现状证据 | 消除于 |
|---|---|---|---|
| G1 | ~~**Web 端无注册流**~~ **已消除（R5.9）**：注册屏 + 登出 + deep link 保持，自动注册已删除 | [`r5-09-onboarding-minimal-plan-2026-06-12.md`](./r5-09-onboarding-minimal-plan-2026-06-12.md) 竣工记录 | ✅ |
| G2 | ~~**真实 LLM 质量/成本/时延仍待真 key 验证**~~ **已消除（R5.10）**：R5.10-dry 证明管线；R5.10-real 使用 DeepSeek 真 provider 跑完 T1–T5 + B1，T1–T4 人工质量 `4/4 >= 4`，T5 结构化升级，B1 预算护栏升级，真实成本 `0.142346 CNY / 30103 tokens / 6 runs` | [`r5-10-dry-agent-pipeline-report.json`](../05-clients/assets/audit/2026-06-13-r5-10-dry-agent-pipeline/r5-10-dry-agent-pipeline-report.json) + [`r5-10-real-llm-validation-report-2026-06-13.md`](../05-clients/assets/audit/2026-06-13-r5-10-real-key-evaluation/r5-10-real-llm-validation-report-2026-06-13.md) | ✅ |
| G3 | ~~**部署包不存在**~~ **已消除（R5.11）**：单镜像 + compose 全栈 + DEPLOY.md + 结构化日志 + CI `pilot-stack-smoke` 真实部署门（三跑抓出三个冷启动真 bug 含 admin 自举缺口） | [`r5-11-pilot-deploy-package-plan-2026-06-12.md`](./r5-11-pilot-deploy-package-plan-2026-06-12.md) 竣工记录 | ✅ |

## 3. 北极星成功指标（pilot 报告的骨架）

| 指标 | 定义 | 回灌目标 |
|---|---|---|
| 闭环完成件数 | pilot 期间走完 提需求→…→合并 全链的真实 WorkItem 数 | 北极星本体 |
| AI 直出采纳率 | 未经打回直接被审批合并的 proposal 占比 | 劳动力质量的第一手证据 |
| 升级精准度初值 | 升级给人的事项中"确实需要人"的占比 | 启动 OQ-2/OQ-3 真实校准 |
| 每件成本 | CNY / 已合并 WorkItem（cost ledger 真实计量） | 校准 OQ-7 预算默认值 |
| 冲突发生数与形态 | 并发编辑/覆盖写触发的 merge_conflict 实例 | **OQ-4 深化的输入数据** |
| 打扰密度 | 通知条数/人/天 与用户主观反馈 | OQ-5 桌宠/通知节流校准 |

## 4. 迭代序列

```
R5.9   Onboarding 最小闭环（P1-6）          ← ✅ 已竣工（2026-06-12，70 步 smoke 全过）
R5.10-pre Agent 能力强化                    ← ✅ 已竣工（2026-06-12）：压缩/截断/工人 prompt/重试/llm_review
R5.10  真实 LLM 端到端验证与评估报告        ← ✅ 已竣工（2026-06-13）：dry + 真 key 6-run 质量-成本-时延报告
R5.11  Pilot 部署包 + 最小可观测            ← ✅ 已竣工（2026-06-12，CI pilot-stack-smoke 全绿）
R5.12  权限矩阵审计（P1-4）                ← ✅ 已竣工（2026-06-12）：修 2 洞 + 常驻 fail-closed 门 → 系统 pilot-ready
S1-Gate Pilot Launch Gate                  ← ✅ 已竣工（2026-06-13）：Docker compose / dry-real / backup-restore / UI-i18n / fresh-nav gates 全绿
S1-D0  Day 0 Real Work Entry               ← ✅ 已竣工（2026-06-13）：真实 UI 入口、WorkItem/AgentRun/Proposal/Replay/Cost、backup/restore 全绿
S1-D1  Feedback + Observability            ← ✅ 已竣工（2026-06-13）：第二用户路径、六指标、反馈 log、ops loop、backup/restore 全绿
S1-D2  Feedback Hardening                  ← ✅ 已竣工（2026-06-13）：post-run clarity、QA resume/idempotency、opened QA artifact rejected、metrics/backup/restore 全绿
S1-RS  Runtime Stability                   ← ✅ 已竣工（2026-06-15）：修复 pg.Pool idle error 未监听导致的 pilot API 退出，compose health 恢复
S1-D3  Expansion                           ← active-day3：邀请 1-3 个真实使用者，每人 1 件真实任务，继续 metrics delta 和反馈 issue 化
S1     Pilot Week（Day 3 扩人中；turnkey 运营手册已进入 active-day3-expansion）
S1 后  数据驱动深化：OQ-4 合并语义/AI 调解（真实冲突数据）、OQ-2/3 阈值校准、pilot 报告决定 S2
```

各步要点（开工时各自另立详细 plan，本表只锁范围边界）：

| 步 | 必须完成 | 明确不做 |
|---|---|---|
| **R5.9** | Web 注册/切换用户（昵称+locale+可选 admin secret）、登出；替换自动 identify；QA smoke 改走脚本化注册 | 不做密码/OAuth/SSO（LAN-first 信任模型不变，D-3） |
| **R5.10** | ✅ dry 自检脚本已落；✅ 真 key 全链跑通并留证据：6 个真实 AgentRun、T1–T4 质量全达标、T5 不编造升级、B1 预算护栏触发、成本计量入 ledger、置信度落库，产出质量-成本-时延评估报告 | 不扩工具面、不调模型路由策略（只记录数据） |
| **R5.11** | docker-compose 全栈（api + web 静态 + pg + redis）、迁移编排、.env 模板、备份脚本、十分钟 DEPLOY 文档、pino 级结构化日志 | 不做云部署/多租户（P5 不变）、不做 APM |
| **R5.12** | "角色 × 路由"审计表（对照 security-and-permissions §4.2），写路径统一收口，fail-closed 缺省验证 | 不重写 permission 引擎，只接线与补洞 |
| **S1 Launch Gate** | ✅ 部署现场 compose 起栈、dry/real smoke、backup/restore、secret hygiene、主持人 operator loop；并修复 fresh pilot 稳定页旧 seed 导航 | 不新增业务模块；不把旧 smoke fixture 当真实入口 |
| **S1 Day 0** | ✅ 已落：真实用户从 UI 发起工作/项目种子的可见入口，主持人可见闭环，Day0 backup/restore | 不邀请多人；不扩业务面 |
| **S1 Day 1** | ✅ 已落：反馈入口、每日指标快照、第二用户路径、ops loop、Day1 backup/restore | 不新增业务模块；不并行开桌宠新面 |
| **S1 Day 2** | ✅ 已落：post-run WorkItem clarity、QA resume/idempotency、处理 opened QA artifact、继续每日指标、Day2 backup/restore | 不扩大用户前不带着已知摩擦硬推 |
| **S1 Runtime Stability** | ✅ 已落：修复 DB idle 连接错误未监听导致 API 退出；恢复 pilot compose health；新增后续长稳观察计划 | 不改业务数据流、不改 UI、不扩大 Day3 范围 |
| **S1 Day 3** | 邀请 1-3 个真实使用者，每人 1 件真实任务；每个 Proposal 必须 merge 或 reason reject；记录 metrics delta 与反馈 top issues | 不新增业务模块、不把 QA 中断当理由重复造数据 |
| **S1 Pilot Week** | 每日反馈回灌（issue 化）、周末 pilot 报告（§3 六指标 + 定性结论） | 不在 pilot 周内并行开新功能面 |

## 5. 双轨说明

- **C-PET/Cuu 轨**：不冻结，按原节奏推进（如 OS 通知 surface 复用 R5.6/R5.7 API 合同）。但桌宠工作**不进入 pilot-ready 的关键路径**，不阻塞也不被阻塞；pilot 若用桌宠接活，相关缺陷按正常优先级处理。
- **工程债轨**：React 迁移剩余段、smoke 五组拆分维持"机会性重构"定位（R5.8 实测单体 CI 64 秒，无急迫性）；中期审查 P2 项不主动排期。

## 6. Pilot 要回答的战略问题（写进 pilot 报告）

1. **核心反转成立吗**：真实用户是否愿意让 AI 默认干活、自己只审批？打回率和采纳率说话。
2. **护城河值得吗**：一周真实使用产生多少冲突？冲突体验是否是用户痛点？——决定 OQ-4 深化的投入力度与时点。
3. **缝隙是真的吗**：去黑话治理层（提议/审批/回放的人话呈现）对不会用 git 的用户是否真的可用？哪里仍在漏黑话？
4. **成本模型撑得住吗**：每件成本 vs 用户感知价值；OQ-7 配额默认值是否现实。

---

*本篇是 R5.8 之后的权威施工顺序。各步竣工后回写本篇 §4 状态；S1 pilot 报告产出后，由数据决定 S2 范围。*
