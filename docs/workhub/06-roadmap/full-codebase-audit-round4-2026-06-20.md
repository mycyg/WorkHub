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

3 个「当前默认部署即有真实价值」的 must-have：后台失败结构化日志覆盖、通知静音偏好 UI、全局搜索框。其余排进 [`team-readiness-gap-roadmap-2026-06-19.md`](./team-readiness-gap-roadmap-2026-06-19.md)：密码重置（缺邮件投递基建）、多租户 Phase4/5（cost_ledger workspace_id / NULL 回填，上第二工作区前置）、OIDC/MFA/admin console/外部集成/全局搜索/metrics 栈/AI eval 栈（多周 + 需产品决策）。

## 与前轮关系

复验 [`full-codebase-audit-round3-2026-06-19.md`](./full-codebase-audit-round3-2026-06-19.md) 等已修项未回归。R4 的新发现集中在并发/生命周期（agent-run 状态机协调）、提示词围栏逃逸、provider 流式超时语义、跨工作项 P-COLLAB 口径一致性——这些是更深一层、需要链路追踪才暴露的薄弱处。
