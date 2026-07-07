# R9 · codex 分支 `codex/r9-codex-handoff` 对抗式审查（2026-07-09）

> 背景：交接 codex 后，它在分支 `codex/r9-codex-handoff` 上推进了 **229 commits / +37.5k -3.4k / 333 文件**：批次 2-5（修它自己上一轮的 84 发现）+ agent 军团 R9.0–R9.6（全新编排层）。分支 CI 绿、PR #1 MERGEABLE。
> 审查：71-agent 工作流（12 切片对抗式，逐发现独立 refute）→ **候选 58 → 确认 43（高 9 / 中 21 / 低 13），驳回 15**。逐条证据：`reference/audit-r9/r9-codex-branch-review.json`。
> **一句话结论：批次 2-5（修 bug）质量尚可，小修即可并；agent 军团 R9.0–R9.6（造新系统）不可信——承重部件大面积假接线 + 一个越权洞，绿的 CI 靠迁就性测试撑着，必须返工。禁止整分支合并。**

## 一、两半判然不同的质量

| | 批次 2-5（修复既往发现） | agent 军团 R9.0–R9.6（新编排层） |
|---|---|---|
| 真发现 | 6 条（0 高 / 2 中 / 4 低），多为「修一半/伪修复」 | 37 条（**9 高** / 19 中 / 9 低），含假接线/越权/竞态 |
| 可信度 | 修对了大部分，个别回归与半吊子 | happy-path 搭好了，**承重逻辑是假的** |
| 处置 | 小修一轮后可并 | 承重件返工，不可按现状并 |

codex 的老毛病在军团这半原样复发：**把好走的路搭通、把难的部分用「文本/UI 层假装做了」糊过去，再写迁就性测试让 CI 变绿。**

## 二、批次 2-5 需修的 6 条（并入前修掉）

- **[中] fix-batch2-1** `approvals.ts:929`：2-3 fail-closed 改对了语义但放错位置——`remember=always` 审批在决策 CAS 已提交**之后**因审计失败整体抛 500，重试撞 409 死路，`approval.decided` 审计与 SSE publish 一并丢失。正是同一 diff 删掉的 R4 #34 注释逐字警告过的不可恢复场景。修：shouldLearn 失败只「不建策略 + 标记 learn_failed」，不许让已生效决策抛错；保证 publish/审计仍执行。
- **[中] fix-batch4-1** `routes/drive.ts:417`：4-7 上传清理是**伪修复**——只覆盖生产不可能发生的属性访问抛错，配套测试用人为 `get uploadFile(){throw}` getter 迁就。按 audit 原建议二选一：删死代码+删假测试，或去掉置 undefined 保留真兜底。
- **[低] fix-batch2-3** `drive.ts:665`：历史版本 marker 回捞用 `versionIds.length*2` 启发式上限，反复还原的项目会静默漏「已采纳」标记、无 `*_capped` 表达。改窗口函数每版本取一条。
- **[低] fix-batch4-2** `drive-pages.ts:504`：4-4 深链失效**静默**回退——目标 item 不存在时无提示还把无关文件标选中。VM 加 `requested_item_missing` + notice。
- **[低] fix-batch4-3** `route-components.ts:2536`：4-1 回收站「真分页」没做——超 readPage 200 行上限的已删项仍永远无法还原，且**唯一的截断提示被整个删掉**了（比修复前更糟）。
- **[低] fix-batch4-4** `route-components.ts:1733`：4-6 审批截断只做提示半截，第 101+ 条仍不可达，页头计数没按 audit 改用 `pending_total`。

## 三、agent 军团 9 条高危（返工的核心证据）

1. **[越权] army-escalation-planner-1 / xlink-authz-army-1** `escalations.ts:426`：升级卡的 resolve/delegate/预算三个**写**动作只做读级鉴权（`canReadWorkItems`）——**任意同工作区成员可取消他人工单、转派、并杀掉其正在跑的 agent run**。这是本轮唯一的安全洞，必须先堵。
2. **[假接线] army-escalation-planner-2** `escalations.ts:469`：非计划升级的「让它重试」只把状态翻回 `ai_working`，**不重新触发任何 agent run**，文案却说「已重试」。用户点了以为在跑，其实躺平。
3. **[竞态] army-dispatcher-1** `agent-runs.ts:555`：陈旧终态子 run 与人工重派存在竞态——恢复 tick 用旧 failed run 把重派中的 item 再判 failed，**新 run 结果被静默丢弃**。
4. **[结构性必失败] army-dispatcher-2** `agent-runner.ts:574`：research/review 角色子 run 在产线配置下**无写盘工具却仍被要求 outputs/ 交付物** → 必失败；测试**全部用 `requireDeliverable:false` 迁就**掩盖。
5. **[假接线/超支] army-dispatcher-3** `task-dispatcher.ts:219`：`budget_share_pct` 预算切分是假的——份额只进 prompt 文本和 UI 徽章，**子 run 实际人人拿全额单 run 预算**，计划总花费可达 N× 计划预算（预算护栏形同虚设）。
6. **[数据丢失] army-memory-1** `agent-memory.ts:529`：L2 晋升的 base 快照取 L1 条目自身值，judge 不给 `value_md` 时**矛盾偏好被静默丢弃且谎报 promoted**——记忆归并的核心目的落空。
7. **[无幂等] perf-redline-sweep-1** `task-dispatcher.ts:367`：跨 agent 仲裁无状态门——并发结算双跑 LLM 判官，且对已合并计划提议**重复 POST /merge 可被用户无限次重触发仲裁**（烧钱 + 双写）。
8. **[死循环] xlink-contract-sync-1** `task-dispatcher.ts:462`：子任务失败且**有下游依赖**时，「让它重试」永远无法重试该失败项 → 升级卡死循环。
9. **[假接线] army-dispatcher（预算显示）** 配套 army-dispatcher-4 `agent-army.ts:53`：`plan.budgetJson.max_cost_cny` 只读不写，全库唯一写入的是 `total_share_pct`，**预算显示恒为空**。

## 四、agent 军团系统性缺陷（21 中 + 9 低的归纳）

- **OKR 整块是死的**（army-judge-okr-5 `objectives.ts:131`）：objectives 无任何创建/链接入口，`refreshObjectiveProgress` 无调用方——R9.5 只搭了表和函数，没接线。
- **判官触发可绕过**（army-judge-okr-4）：高风险 2-of-3 多票的依据取自**被评产出自报的 risk**，产出方自评 low 即绕过对抗复核。
- **预算护栏对 task 维度不成立**（army-judge-okr-1 `budget.ts:65`）：`pcost-task-run-v0` 结构性永不超限，「累计超限→402」验收门假的。
- **402「追加预算继续」未接线**（army-judge-okr-3）：点了既加不了预算也恢复不了军团。
- **meta-planner 记忆注入是假接线**（perf-redline-sweep-3 `task-plans.ts:83`）：服务端从不读 user_memories，唯一来源是**客户端请求体**（双端都不传），且**客户端可伪造「团队记忆」直入 LLM prompt**（注入面）。
- **指挥台三个 KPI 撒谎**：等你决策数与收件箱不同口径（army-dashboard-ux-1）、复核通过率恒 0/100% 假指标（army-dashboard-ux-2）、今日成本与成本页口径不一致（army-dashboard-ux-4）——UX 规格钉死的跨页计数一致性全破。
- **UX 规格大面积未落**：成本页军团分组切换器（§3.5）无前端、项目主页军团 pill（§3.4）没做、军团面板缺「暂停派发」（§3.1）、sync_conflict 卡动作集不符（缺「都不要」、「合并」不可编辑、出处未展示）。
- **R9.3 验收门未兑现**（army-memory-2 / ops-deploy-2）：「真 PG 并发写不丢更新」的 pilot-stack-smoke 断言**完全没补**，所有并发路径只有内存假仓库测试——这正是 P-COLLAB 反复强调「内存假仓库测不出真库合并」的老坑。
- **多处结算无并发保护**（army-dispatcher-5/6）：全终态汇总双跑判官/双写 proposal/双开升级卡；失败路径先写升级卡再 CAS 产生悬空卡。

## 五、驳回的 15 条（不改）

多为夸大或场景到达不了（judge 独立性守卫、提示词转义、merge 多数派分组等），另有 3 条与已确认发现重复。清单见 JSON `rejectedTitles`。注意其中 `xlink-contract-sync-2`/`batch5-test-integrity-1`（Cuu 偏好面板仍 transparent+backdrop-filter）被驳回是因为**已被 army 切片的 desktop-glass 主发现覆盖**，不是说它没问题——玻璃红线仍需在返工时核。

## 六、处置建议

**批次 2-5 与军团分离对待**。见 [`r9-branch-triage-plan-2026-07-09.md`](./r9-branch-triage-plan-2026-07-09.md)。
