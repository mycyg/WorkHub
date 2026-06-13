---
module: S1-pilot-week-runbook
layer: 运营 / 验证
status: active-day2-hardening
owner: workflow
date: 2026-06-12
depends_on:
  - s1-pilot-readiness-roadmap-2026-06-12.md
  - r5-10-real-llm-validation-plan-2026-06-12.md
  - ../../../DEPLOY.md
---

# S1 Pilot Week 运营手册（turnkey）

> 目的：把"人到位即启动"从口号变成 turnkey。本篇是主持人(你)的逐步操作手册——从起飞前检查到周末报告，全程不需要再做产品/工程决策。
> 前置：系统代码已 pilot-ready（S1 R5.9–R5.12 全竣工）。R5.10-dry 与 R5.10-real 均已通过；**S1 Pilot Launch Gate、Day 0 真实工作入口、Day 1 反馈观测均已全绿**。
> 2026-06-13：Launch Gate 已在 Docker Desktop + pilot compose 真实栈通过，见 [`s1-pilot-launch-gate-report-2026-06-13.md`](../05-clients/assets/audit/2026-06-13-s1-pilot-launch-gate/s1-pilot-launch-gate-report-2026-06-13.md)。Day 0 真实入口见 [`s1-pilot-day0-real-work-entry-report-2026-06-13.md`](../05-clients/assets/audit/2026-06-13-s1-day0-real-work-entry/s1-pilot-day0-real-work-entry-report-2026-06-13.md)。Day 1 反馈观测见 [`s1-pilot-day1-feedback-and-observability-report-2026-06-13.md`](../05-clients/assets/audit/2026-06-13-s1-day1-feedback-and-observability/s1-pilot-day1-feedback-and-observability-report-2026-06-13.md)。当前进入 [`s1-pilot-day2-feedback-hardening-plan-2026-06-13.md`](./s1-pilot-day2-feedback-hardening-plan-2026-06-13.md)。

## 0. 这一周要回答什么（贴墙上）

1. **核心反转成立吗** — 用户愿意让 AI 默认干活、自己只审批吗？(看打回率/采纳率)
2. **护城河值得吗** — 一周产生多少冲突？冲突体验是不是真痛点？(决定 OQ-4 投入)
3. **缝隙是真的吗** — 去黑话呈现对不会用 git 的人真的可用吗？哪里还在漏黑话？
4. **成本撑得住吗** — 每件成本 vs 感知价值？

## 1. 起飞前检查（pilot 前 1 天，约 30 分钟）

- [x] S1 Launch Gate 全绿，报告状态不是 NO-GO。
- [ ] 一台 LAN 机器，Docker 24+，按 [`DEPLOY.md`](../../../DEPLOY.md) 起栈，`docker compose --env-file .env.pilot -f docker-compose.pilot.yml ps` 全 healthy。
- [ ] `.env.pilot` 填了强 `COOKIE_SECRET`、`ADMIN_CLAIM_SECRET`、`LLM_API_KEY`。
- [ ] 在部署现场或 workhub 容器内跑一次 `pnpm qa:r5-10-dry`（key 无关）确认管线通；基线证据见 `2026-06-13-r5-10-dry-agent-pipeline`。
- [ ] 在部署现场或 workhub 容器内跑一次 `pnpm qa:r5-10-real`，至少 `R5_10_REAL_TASK_LIMIT=1 pnpm qa:r5-10-real`，确认真 provider 可用；基线证据见 `2026-06-13-r5-10-real-key-evaluation`。
- [x] 浏览器开 `http://<ip>:8787/`，管理员用 `ADMIN_CLAIM_SECRET` 认领 admin；Cost/Settings 中英 UI 已留证。
- [x] 按 Day 0 计划补齐“建 1–2 个真实项目 / 从 UI 发起第一件工作”的可见入口，并跑主持人可见闭环（WorkItem `DAY0PILOT-006`、run `3bb9bd88-85e7-4f4e-bb26-f8ebcff5eb77`、proposal `2cff8131-400f-4a19-9dd6-01a5daa06e9c`）。
- [x] `bash scripts/ops/backup-pg.sh /private/tmp/workhub-backups` 或生产等价仓库外目录跑通一次，确认备份可用。
- [x] 用 `docker compose --env-file .env.pilot -p workhub_restore -f docker-compose.pilot.yml ...` 独立 project 做 restore dry check，不能覆盖当前 pilot 数据。
- [x] 准备一个反馈收集入口：[`s1-pilot-day1-feedback-log-2026-06-13.md`](../05-clients/assets/audit/2026-06-13-s1-day1-feedback-and-observability/s1-pilot-day1-feedback-log-2026-06-13.md)。

## 2. Day 0：导入真实工作（约 1 小时）

- 让每个使用者各自注册（昵称报到，admin 不用管别人）。
- **关键：用真实待办喂系统**，不要造假任务。每人挑 2–3 件本周真要做的数字活(写文档/做表/出图/清数据)提交为 WorkItem。
- 主持人示范一次完整闭环：提需求 → 看 AI 干 → 在审批中心审 → 合并 → 回放页看它怎么做的。让大家知道"AI 干、你审"长什么样。
- 当前可见入口：打开 `/intake`，填写 `Real task`，点击 `Start work intake`；系统会先准备 `Pilot Project` context，再进入 option-first intake。不要用旧 smoke fixture 或直接访问旧 `r4-live-*` 链接。
- Day 0 已验证的真实路径：`/intake` -> session -> `DAY0PILOT-006` -> AgentRun -> Proposal direct review/merge -> `/agent-runs/:id/replay` -> `/dashboard/cost`。
- 注意：Proposal direct review/merge 不会产生 `approval_requests` 行；指标采集要以 proposal review/merge/audit 为准。

## 2.1 Day 1：反馈与观测（约 1 小时启动，之后每天 15 分钟）

- Day 1 已按 [`s1-pilot-day1-feedback-and-observability-plan-2026-06-13.md`](./s1-pilot-day1-feedback-and-observability-plan-2026-06-13.md) 完成，报告见 [`s1-pilot-day1-feedback-and-observability-report-2026-06-13.md`](../05-clients/assets/audit/2026-06-13-s1-day1-feedback-and-observability/s1-pilot-day1-feedback-and-observability-report-2026-06-13.md)。
- 已验证非 admin 第二用户真实路径：WorkItem `4afa12db-0a9a-448a-a0be-9bda4725c0e7` -> Run `1ea4dd8f-a466-45b4-b3d7-683a1dcf5544` -> Proposal `09b45408-6e19-4e79-bb98-68b6d953fcd8` -> Replay/Cost。
- 反馈记录使用 [`s1-pilot-day1-feedback-log-2026-06-13.md`](../05-clients/assets/audit/2026-06-13-s1-day1-feedback-and-observability/s1-pilot-day1-feedback-log-2026-06-13.md)，每条必须绑定 WorkItem/Proposal/Run/截图，打 `blocker / usability / surprise / backlog`。
- 每日六项指标使用 `GET /api/pilot/day1/metrics`（admin-only）或容器内 `S1_DAY1_REQUIRE_GATES=1 pnpm --filter @workhub/api qa:s1-day1-metrics`。
- Day 1 backup/restore 已通过：`/private/tmp/workhub-backups/workhub-20260613-160144.sql.gz`，隔离 restore query 返回 run `succeeded` / proposal `merged` / accepted_count `1`。

## 2.2 Day 2：反馈硬化（先修摩擦，再扩人）

- 按 [`s1-pilot-day2-feedback-hardening-plan-2026-06-13.md`](./s1-pilot-day2-feedback-hardening-plan-2026-06-13.md) 推进。
- 先修 post-run WorkItem clarity：用户启动 run 后必须看见 Proposal/Replay 下一步或明确刷新动作。
- 把 Day1 临时 browser QA 收敛为可 resume/idempotent 的 repo QA，避免 stale notice 造成重复数据。
- 处理 Day1 false-negative 留下的 opened proposal `7ade705e-3438-4edb-9c56-349b80176f3e`，再邀请下一批真实用户。

## 3. 每日节奏（每天约 15 分钟）

| 时点 | 动作 |
|---|---|
| 早 | 看 `/dashboard/health` 各项目健康档位；看通知中心待审 |
| 全天 | 使用者正常提活、审批；遇到问题随手记进反馈表(一句话+截图即可) |
| 晚 | 主持人扫一遍当天 AgentRun：采集 §5 指标；把每条反馈 issue 化(标 bug/可用性/惊喜) |
| 日志 | `docker compose --env-file .env.pilot -f docker-compose.pilot.yml logs workhub` 看 `http_request`/`unhandled_error`，异常即记 |
| 备份 | `bash scripts/ops/backup-pg.sh /private/tmp/workhub-backups 14`；当天结束用隔离 `workhub_restore` project 做 dry check |

**红线**：pilot 周内**不并行开新功能面**。只修阻断性 bug(影响当天使用的)，其余 issue 攒到周末。

## 4. 反馈分类（每条反馈打一个标签）

- 🔴 **阻断** — 当天用不下去 → 当天修
- 🟡 **可用性** — 能用但别扭/费解/漏黑话 → 攒，喂 S2
- 🟢 **惊喜** — AI 干得超预期 → 记下来，是"反转成立"的证据
- ⚪ **需求** — "要是还能…" → 攒进 backlog，不当周做

## 5. 指标采集（每天累加，周末汇总）

| 指标 | 怎么采 | 喂给谁 |
|---|---|---|
| 闭环完成件数 | `GET /api/pilot/day1/metrics` 的 `closed_loop_count` | 北极星本体 |
| AI 直出采纳率 | `proposal_adoption_rate`：`proposals.reviewed_at/merged_at`，不只看 approval center | 反转是否成立 |
| 升级次数 | `escalation_events + approval_requests`；主观精准度写入反馈 log | OQ-2/3 校准 |
| 每件成本 | `cost_per_merged_item_cny`；与 `/dashboard/cost` 总 CNY 对账 | OQ-7 校准 |
| 冲突发生数 | `merge_attempts.result=conflict` 与 conflict instances | **OQ-4 是否值得做** |
| 打扰密度 | `notifications_created / active_user_count` + 主观"烦不烦" | OQ-5 校准 |

命令：

```bash
docker compose --env-file .env.pilot -f docker-compose.pilot.yml exec -T workhub \
  sh -lc 'S1_DAY1_REQUIRE_GATES=1 pnpm --filter @workhub/api qa:s1-day1-metrics'
```

## 6. 周末 Pilot 报告（产出物 `docs/.../s1-pilot-report-<date>.md`）

```
## 一周概览
使用者数 / 项目数 / 闭环完成件数 / 总成本

## 六指标实测
(§5 表的一周汇总值)

## 四个战略问题的回答
1. 核心反转成立吗 — 数据 + 判断
2. 护城河值得吗 — 冲突数据 + 判断
3. 缝隙是真的吗 — 漏黑话清单 + 判断
4. 成本撑得住吗 — 每件成本 + 判断

## Issue 分类汇总
🔴已修 / 🟡可用性(条数+top3) / 🟢惊喜(条数+亮点) / ⚪需求backlog

## S2 建议
基于以上，下一阶段最该做什么(护城河 OQ-4 / 可用性打磨 / 某模块深化)
```

## 7. 这份报告决定 S2

S1 的设计就是"先证明再扩张"。pilot 报告里：

- 若**反转成立 + 冲突是真痛点** → S2 优先 OQ-4 护城河（合并语义 + AI 调解），用 pilot 的真实冲突数据开工。
- 若**反转成立 + 可用性是瓶颈** → S2 优先去黑话/交互打磨。
- 若**反转不成立** → 暂停扩张，先搞清楚是模型质量、交付面、还是产品形态的问题——这恰恰是 pilot 最该早发现的事，比推完才发现便宜得多。

---

*本篇是 turnkey 运营脚本。pilot 报告产出后，回写 S1 roadmap 并据其决定 S2 范围。*
