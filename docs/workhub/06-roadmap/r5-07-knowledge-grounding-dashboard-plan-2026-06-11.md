---
module: R5-knowledge-grounding-dashboard
layer: M-KNOWLEDGE / M-DASHBOARD / M-NOTIFY / P-AI / P-PERM / C-WEB
status: planned
owner: workflow
date: 2026-06-11
visuals:
  - ../05-clients/assets/web/web-operations-pages-atlas.png
  - ../05-clients/assets/web/web-project-attention-workspace.png
depends_on:
  - r5-06-schedule-notify-plan-2026-06-11.md
  - ../04-modules/knowledge-base.md
  - ../04-modules/dashboards-and-metrics.md
  - ../02-ai-engine/explainability.md
  - ../01-architecture/api-contract.md
  - ../01-architecture/security-and-permissions.md
---

# R5.7 Knowledge Grounding / Dashboard Health Plan

## 1. 开工前必读

- [`r5-06-schedule-notify-plan-2026-06-11.md`](./r5-06-schedule-notify-plan-2026-06-11.md)：通知/日历已把 WorkItem、Drive、Meeting、Proposal 事实投递成 inbox/calendar；R5.7 要回答“为什么提醒我、我该先看什么证据”。
- [`../04-modules/knowledge-base.md`](../04-modules/knowledge-base.md)：grep 语料 + 强制引用问答；`EvidenceBubble`、citations 行级权限（KB-2 硬约束：citations 按访问者过滤）。
- [`../04-modules/dashboards-and-metrics.md`](../04-modules/dashboards-and-metrics.md)：项目健康、自治率、升级精准度的指标定义；EX-3/OQ-DASH-3 分层口径——**admin/owner 看数值，普通用户看人话档位**。
- [`../02-ai-engine/explainability.md`](../02-ai-engine/explainability.md)：决策可解释、grep 引用、trace 呈现；通知 reason 必须可下钻。
- [`../01-architecture/security-and-permissions.md`](../01-architecture/security-and-permissions.md)：健康看板的可见范围与资源 fail-closed。

概念图：

- `web-operations-pages-atlas.png`：P12 Project Health 为主视觉锚点；健康页是"操作入口"不是营销图表墙。
- `web-project-attention-workspace.png`：evidence/健康信息回流到 attention 与 next best action。

## 2. 目标

R5.7 把已有的事实流（通知、日程、run、proposal）反向接到证据与健康视角，形成闭环：用户从通知/日历点进来，能看到**为什么**（reason + evidence）和**项目整体健不健康**（health），而不是孤立的一条提醒。

必须完成：

1. **Notification grounding**：`NotificationItemVM` 扩展 `reason_text` 与 `evidence_refs`（指向 knowledge search / replay / drive version 的产品 route href）；通知详情可一键跳到预填上下文的 `/knowledge/search?...` 或 `/agent-runs/:id/replay`。
2. **Project Health Page VM**：`/api/pages/health`（或 `/dashboard/health` route key）聚合每项目：open WorkItem 数、待审批数、超期 schedule block 数、failed/escalated run 数、预算燃烧档位；deterministic、可测试。
3. **分层呈现**：admin/owner 看数值与全项目榜；普通用户只看自己参与项目 + 人话档位（健康/需要关注/告急），不显裸置信度数字（宪法 4）。
4. **Web routes**：新增 `/dashboard/health` route，走 Page VM source truth、双语固定 UI、移动端无 overflow；health 卡片的 action 指向已有产品 route（workitem/approvals/cost/replay）。
5. **Evidence 回链**：knowledge search 支持 `source_ref` 查询参数（来自通知/health 卡），结果页显示"由哪条通知/哪个健康信号带你来"的上下文条。
6. **权限**：health 聚合按项目可见性 fail-closed；citations 行级过滤沿用 KB-2 约束。

不做：

- 不做趋势图表库/可视化引擎；v0 用计数 + 档位 + 列表。
- 不做自治率/升级精准度的全量历史回算；只落当前窗口（近 30 天直接聚合，OQ-DASH-4 v0 口径）。
- 不动 Cuu/桌宠呈现；C-PET 只复用同一 API 合同。

## 3. 数据流

```
Notification / Schedule target
  -> reason_text + evidence_refs (产品 route href)
  -> /knowledge/search?source_ref=... 预填上下文 / /agent-runs/:id/replay
Project facts (workitems / approvals / schedule / runs / cost ledger)
  -> Health Page VM (deterministic aggregation, 权限过滤)
  -> /dashboard/health route (admin 数值 / 用户人话档位)
  -> 卡片 action 回到 workitem / approvals / cost / replay 主线
```

硬门：

- 固定文案 zh-CN/en-US；引用的业务正文不翻译。
- evidence/health 卡 action 一律产品 route，不送 raw API。
- 健康档位映射规则进 contracts 并可单测；不在 UI 层算分。
- 普通用户响应里不出现其他用户的数值型成本/命中率（NFR-08）。
- Browser smoke 要证明 `/api/pages/health` request proof 与通知→evidence 跳转链，而不只靠 DOM 文案。

## 4. 施工顺序

1. Contracts：`ProjectHealthPageVM`、`ProjectHealthCardVM`、健康档位 enum 与映射规则；`NotificationItemVM` 扩展 grounding 字段。
2. DB/repository：health 聚合查询（复用现有 repositories，新增只读聚合方法）；通知 grounding 字段写入点回查 R5.6 factory。
3. Services/API：health page service + `/api/pages/health` 路由 + OpenAPI；knowledge search `source_ref` 参数。
4. API client/runtime：typed client 方法、href parser、shared dispatcher notice。
5. UI/Web：`/dashboard/health` route component、通知详情 grounding 区、knowledge 上下文条；双语、desktop/mobile。
6. Tests：contracts/client/runtime/ui/api service tests。
7. Browser smoke：扩展 R5.7 gate（health route、notification→evidence 跳转、分层呈现、无溢出），截图审查后回写文档。

## 5. QA Gate

- Contracts：health 档位映射、空项目、单项目、多项目、权限裁剪场景全覆盖。
- Service/API：聚合正确性、admin vs 普通用户分层、permission denied、OpenAPI path。
- UI：health 卡、档位人话文案、通知 grounding 区、无 Cuu 主窗、无横向/文本盒溢出。
- Runtime：action parser/dispatcher 复用 shared runtime，不新增分叉。
- Browser smoke：进入 `/dashboard/health`，从一条通知跳到预填 knowledge search 与 replay，验证 request proof 与 no duplicate route loader calls。
- Final：`pnpm typecheck`、`pnpm test`、browser smoke、`git diff --check`、secret scan、no `reference/`。

## 6. R5.8 Handoff

R5.7 完成后，候选方向按价值排序：① **R4 中期审查 P1-5 的 CI 化第一段**（把 browser smoke 拆 headless Playwright 进 CI，步数已到 63，曲线必须收口）；② Identity/onboarding 最小闭环（P1-6，替换 "P0.5 Reviewer" 自动注册）；③ 桌宠 OS 通知 surface（复用 R5.6/R5.7 API 合同）。建议 ①，因为它保护此后所有纵切的回归安全。
