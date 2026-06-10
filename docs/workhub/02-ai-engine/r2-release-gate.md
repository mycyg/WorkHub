# R2.7 Release Gate

> 状态: current
> 日期: 2026-06-10
> 范围: 把 R0/R1/R2 的静态门、CI smoke、文档口径和提交纪律收成一个可复跑的验收报告。

---

## 1. 为什么需要 R2.7

R2.1-R2.6 已分别补齐：

| 切片 | 已落能力 |
|---|---|
| R2.1 | PostgreSQL claim/lease，`FOR UPDATE SKIP LOCKED`，stuck recovery primitive |
| R2.2 | 同 work item active run 唯一，DB 原子 enqueue，route `runNext()` drain |
| R2.3 | Redis PushBus / Presence 跨 worker v0，unsubscribe 竞态门 |
| R2.4 | SSE topic boundary，`all` admin-only，资源 topic fail-closed |
| R2.5 | 长 provider call interval heartbeat，真实 PG + Redis CI smoke |
| R2.6 | daemon recovery scheduler，Proposal/Approval REST/Page WorkItem 资源权限收口 |

这些能力如果只散落在单测、smoke 和文档里，后续进入 R3 Cuu 出站入口时容易出现两类问题：

1. 新增交互时绕过真实 R1/R2 链路，用 fixture 或页面假数据冒充闭环。
2. 修改 CI / 文档时漏掉 R1/R2 smoke，导致“多 worker 地基”退化而不自知。

R2.7 的目标是建立一个最小 release gate：每次 `pnpm verify` 都输出一张可读表，并在关键证据缺失时直接失败。

---

## 2. 脚本入口

| 命令 | 用途 |
|---|---|
| `pnpm qa:r2-release-gate` | 单独生成 R2 release gate report |
| `pnpm verify` | 通过 `pnpm lint` 自动运行 release gate |

实现文件：

| 文件 | 职责 |
|---|---|
| `scripts/qa/r2-release-gate-report.ts` | 读取 package、workflow、docs、git diff，生成 pass/fail Markdown 表 |
| `package.json` | 暴露 `qa:r2-release-gate`，并把它接入 `lint` |
| `.github/workflows/verify.yml` | 保持 `workspace` / `r1-pg-smoke` / `r2-pg-redis-smoke` job |

脚本不访问网络，不读取外部服务，不打印疑似密钥内容；密钥检查只输出数量。

---

## 3. Gate 清单

| Gate | 失败条件 | 证据 |
|---|---|---|
| package scripts | 根 `package.json` 没有 `qa:r2-release-gate`，或 `lint` 未调用它，或 `verify` 未调用 `lint` | `package.json.scripts` |
| workspace CI | `.github/workflows/verify.yml` 缺 `workspace` job、Node 22 或 `pnpm verify` | workflow 文本 |
| R1 PG smoke | workflow 缺 `r1-pg-smoke`、Postgres 16 或 `pnpm qa:r1-pg-smoke` | workflow 文本 |
| R2 PG+Redis smoke | workflow 缺 `r2-pg-redis-smoke`、Postgres 16、Redis 7、`BROKER_BACKEND=redis`、`WORKER_COUNT=2` 或 `pnpm qa:r2-pg-redis-smoke` | workflow 文本 |
| docs count | README 顶部文档数量与 `docs/workhub/**/*.md` 实际数量不一致，或少于 R2.7 后的 60 篇；2026-06-10 R3.1 后当前为 61 篇 | README + 文件树 |
| required docs | R2.1-R2.7 文档或纠偏路线文档缺失 | 文件存在性 |
| required runtime paths | recovery、topic、proposal/approval/page gates、R1/R2 smoke 入口、配置和 DB repo 缺失 | 文件存在性 |
| stale docs | 文档仍出现 R2.6 未落、后台调度未接、旧文档总数等过期说法 | docs grep |
| diff check | staged 或 unstaged diff 有尾随空格等格式错误 | `git diff --check` / `git diff --cached --check` |
| reference discipline | `reference` / `references` 出现在 tracked 或 pending delivery | `git ls-files` + pending diff |
| secret-like diff | pending diff 中出现 `sk-...` 形态密钥 | diff count only |

---

## 4. 报告形状

脚本输出 Markdown 表，CI log 与本地终端都能直接读：

```text
# WorkHub R2 Release Gate Report

Overall: PASS

| Gate | Result | Evidence |
|---|---|---|
| Workspace CI runs pnpm verify on Node 22 | PASS | verify.yml workspace job |
```

如果任一 gate 失败，脚本抛出 `R2 release gate failed: <gate ids>`，`pnpm verify` 失败。

---

## 5. 边界

R2.7 证明的是“R2 地基的验收入口没有散掉”，不是替代真实 smoke：

| 不做 | 原因 |
|---|---|
| 不在 release gate 内启动 Postgres/Redis | CI 已有独立 `r1-pg-smoke` / `r2-pg-redis-smoke` service job；release gate 只检查 job 接线持续存在 |
| 不查询 GitHub Actions API | 本地和 CI 都应离线可跑；GitHub run 结果由提交后人工/机器人读取 |
| 不生成截图 | R2 是后端地基与权限边界；截图矩阵属于 R1 route visual QA / R4 产品化 |
| 不修改 Cuu 外观 | R3 之前继续冻结模型、动效、设置矩阵 |

---

## 6. 完成后下一步

R2.7 完成后，R2 多 worker / 订阅 / recovery / REST resource auth 的地基首版可以作为进入 R3 的前置条件。R3 开始只做 Cuu 出站 Agent 入口：点 Cuu 后通过真实 session/intake/workitem/agent-run/proposal API 触发链路，并通过 SSE/CuuState 回流；不得绕过 R1/R2 权限和 proposal/review 规则。
