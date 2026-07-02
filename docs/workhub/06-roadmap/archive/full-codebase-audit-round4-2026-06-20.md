---
module: roadmap
layer: cross-cutting
status: ✅初稿
owner: audit
---

# 第四轮全量代码审查 + 团队就绪度分析（R4，2026-06-20）

> 触发：「再次完整审查代码，每一行每一个文件都需要仔细审查，从 web 到客户端，交叉审核代码链路、提示词质量，挖掘问题/潜在问题/不严谨之处/薄弱之处，必要时用真实 apikey 实测，并分析正式作为团队应用还需哪些功能。」

## 方法

ultracode 多智能体 Workflow（`wf_2e62ebee-579`，**137 agent / ~8M tokens / 54 分钟**）：24 个审查单元 = 19 个逐行文件组（api routes/services/workers/sse、packages agent/db/contracts/permissions/cost/events/ui/cuu/web-runtime、apps/web + desktop-webview、client-tauri Rust）+ 4 个跨文件链路追踪（intake→run→proposal / approval→merge→ledger / auth→租户→SSE / provider→置信度→review）+ 1 个提示词专项 → **每条发现都由一个对抗式验证员重新打开真实代码核验**（是否真、是否可达、是否已被 R1/R2/R3 修过）→ 6 维度团队就绪缺口分析（现实核查）。每 agent 都喂了 R1/R2/R3 已修清单去重。

**结果**：107 条原始发现 → 对抗验证确认 **39 条真**（**1 高 / 10 中 / 28 低**，0 critical）+ **56 个缺口**。完整结构化数据 `reference/audit4/r4.json`（gitignored）。

## 处置总览

**39 真发现：38 修复（全程 main CI 绿，13 个 commit）+ 1 缓办（#38，需决策）。**

| 严重度 | 数量 | 处置 |
| --- | --- | --- |
| HIGH | 1 | 已修（globMatch ReDoS） |
| MEDIUM | 10 | 全修 |
| LOW | 28 | 27 修 + 1 缓办（#38） |

### 逐批 commit

| 批次 | commit | 内容 |
| --- | --- | --- |
| R4-1 | `81efba34` | routes UUID 路由参数校验补漏（auth/client-devices/pages/notifications/audit/workitems/agent-runs/proposals，畸形 id 500→404）+ proposals authz-before-parse；新建 `routes/uuid-param.ts` 共享 `isUuidParam` |
| R4-2 | `907220f2` | **HIGH** `packages/permissions/evaluate.ts` globMatch ReDoS：折叠相邻通配（`**`≡`*`，消除灾难性回溯）+ 回归门测试 |
| R4-3a | `8114bb22` | recovery drain 只计 requeued / human-reserved guard 幂等 / confidence rationale 对 succeeded+reviewFailed 诚实化 |
| R4-3b | `c8f2b4e1` | agent-run 状态机协调：`transitionWorkItemStatus` 返 `{transitioned}` 判别符 + `notifyRunMilestone` 单一终态写者（失败 run 通知不被吞 / 成功+开提议不被误 escalate / POST agent-runs 不卡 spec_ready / 死信转 escalated+通知） |
| R4-4 | `23ff27ce` | 提示词围栏逃逸中和（共享 `neutralizeFenceTags`：worker/review/user-memory 块）+ conflict-marker 锚定检测 + merge-fusion merged_text 键约束 |
| R4-5 | `c48b8c5f` | presence 活跃流 `refreshStream` 续期（不误判离线）+ 审批 publish best-effort（推送故障不翻已提交决策）+ SSE 心跳 fail-open |
| R4-6a | `c8fc0b70` | `checkLoopBudget` maxCostCny<=0 视为不限（与 cost 包同口径）+ pilot snapshot 单次 now() |
| R4-6b | `13cd7cdd` | cost-ledger recordUsage 两表入一事务 + driveItemPath 按需查父链 + curation 当日预算 SQL 聚合 + zip 写前校预算 |
| R4-7 | `8e68bc91` | provider 流式改空闲超时（不砍健康长流）+ 释放已消费 stream 事件 + abort-aware retry sleep + run 级 signal 透传 |
| R4-8 | `0f7d8712` | skill-edit heading 注入（缩进 `## ` + section 含换行）双向封堵 + 回归测试 |
| R4-9a | `47f2eb57` | restore 取项目级上一版（P-COLLAB 口径）+ 413 响应也带安全头 + 会议 mutation 透传 locale |
| R4-9b | `21a6c51e` / `0973964e` | Rust SSE 接收 buffer 上限（防内存耗尽）；web 乐观评论 `isConnected` 守卫 + React 编辑态接入 SSE 刷新 dirty-guard |
| R4-9c | `d1ab0455` | 审批 respond 的 learned-policy + audit 改 post-commit best-effort（决策已提交不再因副作用失败翻成 500/409） |

### 缓办：#38 项目代码前缀碰撞（LOW，需决策）

`packages/db/src/sequences.ts` 把项目 slug 规范化（剥非字母数字 + 截 12 + 大写）成 work_item code 前缀，序列号 per-project；不同 slug 可规范化成同前缀 → `work_items_code_uq`（全局唯一）冲突 500。
**为何缓办**：正确修法是产品/架构决策——改人读 `PREFIX-SEQ` 码格式、加 per-project code 唯一性迁移、或在创建事务里加 collision-retry，三者皆非纯码小改。可利用性低（需两个不同 slug 恰好规范化成同 12 字符前缀；pilot 项目数少）。建议在确定 code 命名规范时一并处理。

## 端到端测试（诚实，2026-06-20）

本机无 Docker/PG/Redis，**全栈管线 e2e 受阻**；以 CI 的 `r1-pg-smoke` / `r2-pg-redis-smoke` / `pilot-stack-smoke` 为全栈端到端真门（已绿）。
**provider 级 live 实测**：用真 DeepSeek key（`deepseek-v4-pro`，base `https://api.deepseek.com/anthropic`）经 `packages/agent` 真实 `createAnthropicCompatibleTransport` 真打，验证 R4-7 改动 —— **3/3 PASS**：
- create 非流：`PONG`，1281ms，in=13/out=27 tokens；
- stream 流式：160 events、完成于 2358ms（健康流在 30s 空闲超时下正常跑完 → **#32 不砍健康流 + #33 事件消费**正确）；
- 1ms timeoutMs → `llm_request_timeout: "LLM stream idle for 1ms"`（**#31/#32 abort 路径完好**，且消息证实新空闲超时代码生效）。

key 全程不回显/不入库；临时脚本跑后删除。

## 团队就绪缺口（56）

3 个「当前默认部署即有真实价值」的 must-have + 其余排进 [`team-readiness-gap-roadmap-2026-06-19.md`](./team-readiness-gap-roadmap-2026-06-19.md)。

### 3 个 must-have-now 处置（2026-06-20，用户授权自主修）

| 缺口 | 状态 | 说明 |
| --- | --- | --- |
| ① 后台失败结构化日志 | ✅ 已修（`7244e75c` + `b8ecfc2b`） | logging.ts 加 `getDefaultStructuredLogger()` 惰性单例；workers（recovery/session-sweep/skill-curation tick）+ agent-runner 全 15 处 + sse/stream + approvals + confidence 的裸 console.warn 全部接入 JSON 日志管道（stable snake_case event + {error}），采集器可按 level/event 告警聚合 |
| ② 通知静音偏好 UI | ✅ 已修（`dbcc782a`，web-smoke 绿） | 后端 GET/PUT `/api/notifications/preferences`（迁移 0027 `muted_notification_types`）已就绪；本轮补齐 UI。**落点选通知页而非设置页**：设置页是 React 水合岛（DOM 注入易被 re-render 抹掉、且当时有并行会话在改设置页），通知页是纯 HTML 路由组件、本就有 browser.ts 动作绑定，且「在通知旁边静音通知」更可发现。**实现**：`route-components.ts` 在通知页头部后 SSR 一个折叠 `<details>` 静音面板（折叠默认收起→不占版面/不触溢出门，布局安全 CSS），开关默认全不勾（诚实 default-off）；`browser.ts` 通知路由 ready 后水合——GET 回填勾选态、change 调 PUT，读/写失败都不挡页面（绑在路由 AbortSignal 上）；类型清单**精确对齐后端真正 `flushDraft` 按 `draft.type` 静音的 8 个 dotted 类型**（events/lifecycle.ts 6 个 `workitem.*` 里程碑 + `comment.mention` + `meeting.insight.pending`）——错/多一个类型就是骗用户。补 `@workhub/api-client` 两个方法 + `main.ts` webSurface.pages 声明。首推一次 web-smoke 因 Chrome CDP 连接 flake 红、`gh run rerun --failed` 后 8 job 全绿。**严禁定高/line-clamp**（[[workhub-web-smoke-overflow-gate]]）。 |
| ③ 全局搜索框 | ✅ 已修（`2cd581b2`，web-smoke 绿） | knowledge 后端读 `?q=`（client.searchKnowledge）已可用，仅缺输入框。**实现**（落点修正：用户实际看到的是 `route-components.ts` 的 `renderKnowledgeRouteComponent`——web 路由渲染走它，而非 `render.ts` 的 gold-path `renderKnowledge`/桌面变体）：在知识页头部后加布局安全的原生 GET 搜索表单（`<form method="get" action="/knowledge/search"><input type="search" name="q">`，input 用 `vm.query_text` 回填），原生 GET 落 `/knowledge/search?q=…`、`resolveWebRoute`+SSR loader 已能处理、无需 JS 接线；flex-wrap+min-width:0+box-sizing+无定高过 CJK 溢出门；中英文案。 |

### #38 项目码前缀碰撞（自主决策：维持缓办 + 推荐）

评估了「formatProjectCode 前缀碰撞加 projectId 短哈希后缀」纯码改，但它会**全局改变人读码格式**（`PREFIX-001`→`PREFIXxx-001`），前缀不再干净映射项目 slug，对一个低可利用性的边缘（需两个不同 slug 规范化成同 12 字符前缀、pilot 项目数少）不成比例。**自主决策：维持缓办**，推荐在下次确定「工作项编码命名规范」时一并处理——首选给 `work_items` 加 `(project_id, code)` 维度的唯一性、或让前缀派生自项目唯一标识，而非临时改格式。

### 其余 ~53 缺口（roadmap，多为 epic/需决策/外部阻塞——不盲建）

密码重置（阻塞于缺邮件投递基建）、多租户 Phase4/5（cost_ledger workspace_id / NULL 回填，刻意分阶段、上第二工作区前置）、per-workspace RBAC（membership.role 目前是死列）、OIDC/SSO、MFA、admin 控制台、外部集成（Slack/邮件/日历/webhook）、metrics/可观测性栈、AI 质量 eval/回归集、数据保留/导出、移动端/可访问性——均为多周工程 + 需产品决策（接哪些 provider/集成、RBAC 模型、保留策略）。不在无人值守下 fake-build；待用户按 roadmap 逐个 scope。

## 与前轮关系

复验 [`full-codebase-audit-round3-2026-06-19.md`](./full-codebase-audit-round3-2026-06-19.md) 等已修项未回归。R4 的新发现集中在并发/生命周期（agent-run 状态机协调）、提示词围栏逃逸、provider 流式超时语义、跨工作项 P-COLLAB 口径一致性——这些是更深一层、需要链路追踪才暴露的薄弱处。
