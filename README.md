# WorkHub

> **业务版 GitHub × AI-native 工作中台。AI 是默认劳动力,人是审批者与异常处理者。**

WorkHub 让团队里"绝大多数事"由 AI 默认完成,人只在 AI **做不好 / 做不了 / 不该做**时介入;无论 AI 还是人的改动,都经「提议 → 审批 → 合并」汇入单一可信源(main)。

- **AI 一人两顶帽子**:默认是产出交付物的「工人」;受阻(不合格 / 用户不满意 / 用户禁止)时化身「项目经理」组织人推进。
- **去 git 黑话的协作**:协作者各有"工作副本",AI 拟好改动 → 负责人确认 → 采纳;用户看不到 merge / 分支 / 冲突。
- **入口**:桌面宠物 + Web,Agent 几乎能操作所有功能,让小白也能顺畅使用。

## 现状:S1 Day 2 已过，进入 active Day 3 expansion ✅

本仓库目前是 **产品规格文档树 + TS-first WorkHub 实现**。S1 序列 R5.9–R5.12 已把 onboarding、agent 能力强化、pilot 部署包、沙箱能力库与权限矩阵审计落完；R5.10-dry 与 R5.10-real 已证明需求到交付下载、真实 provider 质量/成本/时延、信息不足升级与预算护栏。S1 Pilot Launch Gate、S1 Day 0 真实入口、S1 Day 1 反馈观测、S1 Day 2 反馈硬化均已通过：第二用户非 admin 路径完成 WorkItem -> AgentRun -> Proposal merge -> Replay/Cost，Day2 修复 post-run WorkItem clarity 与 QA resume/idempotency，stale QA proposal 已正式打回，六指标 API/CLI 全 gates true，Day2 backup/restore 全留证。下一施工线是 active Day 3 expansion：邀请 1-3 个真实使用者，每人 1 件真实任务，继续采集 metrics/feedback。

- 📐 **规格树索引**:[`docs/workhub/`](docs/workhub/README.md) —— 145 篇(架构 / AI 引擎 / 协作 / 业务模块 / 客户端 / 路线图 / 成本治理 / 视觉 QA)
- 📋 **PRD(总纲)**:[`docs/prd/2026-06-04-workhub-prd.md`](docs/prd/2026-06-04-workhub-prd.md)
- 💡 **缘起(头脑风暴)**:[`docs/brainstorms/2026-06-04-workhub-ai-native-platform-brainstorm.md`](docs/brainstorms/2026-06-04-workhub-ai-native-platform-brainstorm.md)

**技术方向**:headless agent daemon + OpenAPI/SSE + PostgreSQL + Tauri 桌面端 / Web 瘦客户端(LAN-first,云就绪)。

### 最近里程碑

| 阶段 | 状态 | 说明 |
|---|---|---|
| R4.20-R4.21 | ✅ | app-level SSE、Page VM local refetch、Last-Event-ID/cursor、fixture chrome 退役与 shared web runtime 已落。 |
| R4.22-R4.23 | ✅ | Proposal structured field scalar 与 text hunk line editor 已成为真实可见 React mutation islands。 |
| R4.24 | ✅ | hash route 写入清理、README 状态治理、browser smoke CI 拆分计划与 R5.1 Drive 决策已落。 |
| R5.1 | ✅ | Drive Page VM/API/Web route 已落，承接 accepted deliverables、Drive versions、preview/download/restore 与 comment draft link。 |
| R5.2 | ✅ | Drive upload/recycle/operation log、project 权限门、shared mapper 与 46 步 browser gate 已落。 |
| R5.3 | ✅ | Drive comment-to-draft / WorkItem 草稿链路已落，47 步 browser gate 覆盖 request proof、notice、operation log 与无溢出。 |
| R5.4 | ✅ | Drive draft-to-proposal 已落，50 步 browser gate 覆盖 source context、proposal action/link 与 operation log。 |
| R5.5 | ✅ | Meeting insight-to-draft 已落，55 步 browser gate 覆盖 meeting page、draft、source context、proposal action/link 与移动端无溢出。 |
| R5.6-R5.8 | ✅ | Schedule/Notify、Knowledge grounding/dashboard health、66 步 browser smoke CI 化已落。 |
| R5.9-R5.12 | ✅ | Onboarding、Agent 能力强化、pilot deploy package、sandbox libraries/skills、permission matrix audit 已落；系统 pilot-ready。 |
| R5.10-dry | ✅ | `pnpm qa:r5-10-dry` 在本机 PG16 跑通：17 段 REST evidence、proposal merge、accepted deliverable download、usage/ledger/confidence。 |
| R5.10 real | ✅ | `pnpm qa:r5-10-real` 用 DeepSeek 真 provider 跑通 T1–T5+B1：T1–T4 质量全达标，T5 正确升级，B1 预算护栏，真实成本 `0.142346 CNY`。 |
| S1 Launch Gate | ✅ | Docker Desktop + pilot compose 现场门通过；dry/real、backup/restore、管理员注册、Cost/Settings 中英截图和 fresh pilot 稳定导航均留证，并修复旧 `r4-live-*` seed 链接泄漏。 |
| S1 Day 0 | ✅ | 真实 `/intake` 入口、Project bootstrap、WorkItem `DAY0PILOT-006`、AgentRun、Proposal merge、Replay/Cost、backup/restore 全绿；修复 worker 缺 WorkItem context 与 0 成本默认值。 |
| S1 Day 1 | ✅ | 第二用户非 admin 路径、Day1 真实任务 intent/free text、Proposal merge、Replay/Cost、六指标 API/CLI、feedback log、backup/restore 全绿。 |
| S1 Day 2 | ✅ | post-run WorkItem clarity、QA resume/idempotency、opened QA artifact triage、六指标 baseline、backup/restore 全绿。 |
| S1 Day 3 | active | 下一计划已立：邀请 1-3 个真实使用者，每人 1 件真实任务，继续 metrics delta、反馈 issue 化与 backup/restore。 |

## 本地开发

```bash
corepack enable
pnpm install
pnpm verify
pnpm dev
```

- API daemon 默认端口: `8787` (`GET /api/health`)。
- Web SPA 规划端口: `5173`。
- Tauri webview 规划端口: `1420`。
- 默认配置来自 [`packages/config`](packages/config);复制 [`.env.example`](.env.example) 到 `.env` 后填入本地密钥。
- PostgreSQL/Redis 可用 `docker compose up -d postgres redis` 启动;Drizzle 迁移命令为 `pnpm db:generate`、`pnpm db:check`、`pnpm db:migrate`。后续数据库验收优先本地构建/本地 PG+Redis 复跑。
- 当前 macOS 本机已可用免 sudo Postgres.app 16.14 runtime（放在项目父目录 `.runtime/`，不属于仓库）；R5.10-dry 与 R5.10-real 使用本地 PG16 验收通过。
- 当前 macOS 本机也已可用 Docker Desktop pilot 栈；S1 Launch Gate 使用 `docker compose --env-file .env.pilot -f docker-compose.pilot.yml up -d --build` 验收通过。
- 生产沙箱与 Agent 执行后续要求 Linux；数据库验收优先本地构建/本地 PG+Redis 复跑。R4 最新状态见上方里程碑表。

## 许可证与商业授权 ⚖️

本项目以 **[PolyForm Noncommercial License 1.0.0](LICENSE)** 发布 —— **源码公开,仅限非商业用途**(非 OSI 开源)。

> Required Notice: Copyright 2026 mycyg (https://github.com/mycyg/WorkHub)

- ✅ **允许**:个人学习、研究、实验、爱好项目,以及非营利 / 教育 / 公益 / 政府机构使用。
- ⛔ **禁止**:任何**商业化**或**真实企业生产场景**的使用。
- 📩 **商业 / 企业授权须经版权所有者书面许可。** 需要商用授权请通过 GitHub 联系 [@mycyg](https://github.com/mycyg)。
