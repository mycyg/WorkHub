# R9 · codex 分支处置与返工计划（2026-07-09）

> 输入：[`r9-codex-branch-review-2026-07-09.md`](./r9-codex-branch-review-2026-07-09.md)（43 确认发现）。
> 核心决策：**分支 `codex/r9-codex-handoff` 不整体合并。** 前 22 个 commit（批次 2-5，`7bbc19a7`→`2475b394`）修一轮即并；其后 agent 军团部分（`83e2a78a`→HEAD）**承重逻辑是假的，按切片返工，验收门全部视为未达标**。
> 读者：codex。红线 10 条（见 handoff-plan 第二节）全程有效——**本轮 43 发现里一半就是违反红线（假接线/迁就性测试/无 cap），把它们当反面教材。**

## 阶段 A · 落地批次 2-5（先做，纯 bug 修复，价值确定）

批次 2-5 的 22 个 commit（`7bbc19a7`..`2475b394`，含 desktop `待真机验证` 5 个）整体质量可用，只需修 6 个发现后并入 main。

### A.1 先修这 6 个（对照 branch-review 第二节，逐条一个 commit）
| 发现 | 修法 |
|---|---|
| fix-batch2-1 `approvals.ts:929` | shouldLearn 失败只「不建策略 + detail 标 learn_failed」，不许让已提交的决策抛 500；保证 approval.decided 审计与 SSE publish 仍执行。补测试：审计失败时决策仍返回成功 + 事件已发。 |
| fix-batch4-1 `routes/drive.ts:417` | 按 audit ux-web-drive-8 原建议：删死代码 + 删人为 getter 测试（服务层 cleanupRejectedUpload 已全责）。**不许再用假 getter 让死代码显得活着。** |
| fix-batch2-3 `drive.ts:665` | 回捞改窗口函数 `row_number() over (partition by drive_version_id order by created_at desc)=1`，每版本一条，配额与版本数一一对应。 |
| fix-batch4-2 `drive-pages.ts:504` | DrivePageVM 加 `requested_item_missing`；route-components 渲一条「找不到该文件，已回到默认视图」提示；回退不高亮无关文件。 |
| fix-batch4-3 `route-components.ts:2536` | 回收站真做完整视图/分页（第 6+ 条可还原），或至少把被删掉的截断提示恢复+如实说明「余下 N 项需展开」。当前状态比修复前更糟（提示都没了）。 |
| fix-batch4-4 `route-components.ts:1733` | 审批页头计数改用 `pending_total`；第 101+ 条给真实入口（分页/加载更多），不能只提示不可达。 |

### A.2 验证 + 落地
- 每个修复跑满 handoff-plan 第五节验证清单（typecheck + test + gate + 受影响 smoke）。
- **desktop 5 个 `待真机验证` commit**：并入前你（用户）本机 `.app` 跑一次，确认删缩放手柄/拖拽/Cuu 上下文接线/SVG 滤镜/tauri fallback 真机没炸（审查确认代码逻辑对，但玻璃/窗口行为无头测不出）。
- A 阶段落地方式：从分支 cherry-pick 这 22 个 commit + 6 个修复到 main（或把分支 rebase 掉军团部分后并）。**不带任何 `83e2a78a` 之后的军团 commit。**

## 阶段 B · agent 军团按切片返工（承重件重做，验收门重判）

军团部分**保留脚手架**（表/迁移/契约/部分真实接线），但以下承重逻辑**必须重做**才算切片完成。每个 R9.x 切片的原验收门 + 本轮对应发现的修复，**两者都过才算达标**。

### B-R9.0 逃生舱（当前最危险，含唯一越权洞，优先）
1. **[越权，先堵] escalations.ts:426**：resolve/delegate/预算三个写动作改为**写级鉴权**——校验操作者对该 work_item 有变更权（照抄 approvals 的 assertCanMutate 模式），不是 `canReadWorkItems`。补越权测试（他人不能取消/转派/杀 run）。
2. **[假接线] escalations.ts:469**：非计划升级「让它重试」必须**真重新 enqueue agent run**，不能只翻状态。文案与行为对齐。
3. **[死循环] task-dispatcher.ts:462 / xlink-contract-sync-1**：失败项有下游依赖时「重试」要能真重跑该项（重置 item 状态 + 重派），不能永远卡升级。
4. **[状态语义] escalations.ts / confidence.ts:532**：计划类升级 pm_mode/cancel 要真迁移工单状态且两个动作行为不同（现在 DB 层完全一样，「转成我来做」永不生效）。
5. 通知：升级发生给提交人+项目 owner 发通知（施工图要求，当前只写 event）。

### B-R9.1 计划
- **[原子性] proposals.ts:2172**：计划提议 merge 与 approvePlan 要原子（一个事务或补偿），杜绝「提议 merged + 工单 ai_working + 计划非 approved」死状态。
- **[注入面+假接线] task-plans.ts:83**：meta-planner 的记忆注入改为**服务端读 user_memories/team_skills**，禁止从客户端请求体取（当前可伪造团队记忆直入 prompt）。
- **[未直通] meta-planner.ts:337**：judge 返回 escalate 要直接升级给人，不能当 retry 再烧一轮 LLM。

### B-R9.2 派发（假接线重灾区）
- **[假接线，最重要] task-dispatcher.ts:219**：`budget_share_pct` 必须真切分子 run 预算——按份额算出子预算传进 enqueue 的 budget，不是只进 prompt 文本。补测试：N 个子 run 总预算 ≤ 计划预算。
- **[结构性必失败] agent-runner.ts:574**：research/review 角色要么给对应工具（研究给读取/检索、复核给 judge），要么对这类角色不要求 outputs/ 交付物（改判定而非 `requireDeliverable:false` 迁就）。想清楚每个角色的产物形态。
- **[竞态] agent-runs.ts:555**：陈旧终态子 run 与人工重派竞态——重派时给 item/run 一个 generation/epoch，恢复 tick 只认当前 epoch 的 run，旧 run 结果不覆盖新派。
- **[并发结算] task-dispatcher.ts:363/549**：全终态汇总加幂等门（CAS 或 advisory lock），杜绝双跑判官/双写 proposal/双开升级卡；失败路径先 CAS 后写卡。
- **[假接线] agent-army.ts:53 / dispatcher**：`plan.budgetJson.max_cost_cny` 要真写入（预算显示当前恒空）。

### B-R9.3 记忆
- **[数据丢失] agent-memory.ts:529**：晋升 base 快照取错——judge 不给 value_md 时不能静默丢矛盾偏好还谎报 promoted；无法归并就走 conflict 提议。
- **[假蒸馏] agent-memory.ts:271**：L1 提取要从 run 内容真蒸馏，不是硬编码模板句；且每次成功 run 内联触发 LLM 晋升 judge 有捏造「用户偏好」高置信写 L2 的风险，收紧触发条件。
- **[验收门未兑现] 0035 迁移 + verify.yml:186**：`user_memories.workspace_id` 要做**回填**（不只改索引）+ listForUser 对同 key 全局行/工作区行去重（shadow）；**pilot-stack-smoke 必须补真 PG 并发写不丢更新断言**（内存假仓库不算——P-COLLAB 老坑）。

### B-R9.4 仲裁
- **[可绕过] task-dispatcher-arbitration.ts:168**：高风险 2-of-3 的 risk 依据不能取自被评产出自报——由 planner 在计划阶段标注 + 人在计划提议里可改（施工图原意），产出方无法自评 low 绕过。
- **[无幂等] task-dispatcher.ts:367 / perf-redline-sweep-1**：仲裁加状态门——已合并计划提议重复 POST /merge 不能重触发；并发结算不双跑判官。

### B-R9.5 OKR + 预算
- **[整块死接线] objectives.ts:131**：objectives 要有创建/链接入口 + refreshObjectiveProgress 要有调用方（夜间聚合）。当前只有表和函数没接线。
- **[护栏假] budget.ts:65**：task 维度预算要真能超限触发 402（现在 `pcost-task-run-v0` 结构性永不超限）。
- **[未接线] escalations.ts:242**：402「追加预算继续」要真加预算+恢复军团派发。

### B-R9.6 指挥台（UX 规格符合度，最后做）
- **[跨页计数一致性] agent-army.ts:303/145/192**：KPI「等你决策数」与收件箱同口径；「复核通过率」接真 R9.4 判官数据（现在恒 0/100%）；「今日成本」与成本页同口径。UX 规格钉死这条，补跨页一致性测试。
- **[O(n²)] agent-army.ts:199**：today_cost 的 reduce 内 findIndex 去重改 Set/Map，别对 90 天全量账目做平方扫描。
- **UX 规格未落项**：成本页军团分组切换器（§3.5）、项目主页军团 pill（§3.4）、军团面板「暂停派发」（§3.1）、sync_conflict 卡动作集（§3.7：补「都不要」、「合并」可编辑、展示记忆出处）。
- 玻璃红线复核：Cuu 偏好面板等处若仍有 transparent+backdrop-filter，一并按批次 0-3 的白底规范修（真机验证）。

## 阶段顺序与提交粒度

```
阶段A（批次2-5：6修复→验证→本机验desktop 5项→cherry-pick 进 main）
  → B-R9.0（先堵越权洞，再修假接线/死循环）
  → B-R9.1 → B-R9.2（假接线重灾，预算切分最优先）
  → B-R9.3 → B-R9.4 → B-R9.5
  → B-R9.6（UX 符合度 + 跨页一致性）
  → 人工真机验收 + 再一轮对抗 review 才宣布军团收口
```

每个修复一个（或少量）commit，跑满验证清单，push 后 `gh run view --json jobs` 逐 job 核。**军团每个切片返工后，回到 ux-flow-spec 对应 surface 的验收清单逐条勾，四态（loading/empty/error/partial）齐才算完。**

## 铁律强化（本轮新增，针对军团暴露的模式）

1. **假接线零容忍**：任何「份额/预算/上下文/指标」进了 prompt 文本或 UI 徽章，就必须同时进真实执行路径（enqueue budget、DB 写入、鉴权判定）。写完问自己：「删掉这段文本，行为会变吗？不变=假接线。」
2. **迁就性测试即未完成**：`requireDeliverable:false`、内存假仓库测并发、人为 getter 抛错——这些让 CI 变绿但掩盖真 bug，等于没测。并发必须真 PG，角色产物必须按真配置测。
3. **写动作必须写级鉴权**：任何 resolve/cancel/delegate/retry/kill-run 都要校验操作者对目标的变更权，`canRead` 不是授权。
4. **新聚合/指标必须跨页对账**：dashboard 的每个数字都要和它在收件箱/成本页的同名来源同口径，写测试钉死。
5. **验收门里带「真 PG 断言」的，内存测试不顶数**（R9.2/9.3 明确要求 pilot-stack-smoke / r1-pg-smoke）。
