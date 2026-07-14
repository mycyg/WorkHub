# R14 批 FEEDBACK · W-B feedback-curation 交付报告

> 分支 `r14/feedback-curation`（基线含 W-A 全部服务端与挂载）· 2026-07-14
> 施工说明书：`r14-release-readiness/04-feedback-design.md` §6（curation 消费节）+ W-A 交付报告
> `r12-desktop-workbench/reports/r14-feedback-server.md` §5（预留说明）
> 验收：`pnpm --filter @workhub/api test`（1396，1395 过 1 skip）· `pnpm --filter @workhub/db test`
> （345，343 过 2 skip）· `pnpm -r typecheck` 全绿。

## 1. 范围与总述

夜间技能策展消费人类反馈：**差评样本进蒸馏反例池**（prompt 注入 `buildCurationPrompt`），**好评作强化信号**，
反馈也纳入 `hasCurationSignal` 的「有信号」判定。只动 W-B 文件域：`services/skill-curation.ts` +
`workers/agent-skill-curation.ts`，及仓库层的差评摘要批量取正文 reader（加在 W-A 预留的 `ai-feedback.ts`
仓库文件，见 §禁区裁定）。**零迁移、零新增记账路径、零真 LLM 调用**（测试全 mock）。

## 2. 注入点说明（逐处）

### 2.1 `apps/api/src/services/skill-curation.ts`

- **`SkillCurationAnalysis` 扩两字段**（设计 §6.2，required）：
  - `negativeFeedback: AiFeedbackNegativeSample[]`——反例池，`{ subjectType, excerpt, note }`（逐条人话摘要 + 可选备注）。
  - `positiveFeedback: AiFeedbackPositiveSignal[]`——好评聚合，`{ subjectType, count }`（只计数不取全文）。
  - 两个小类型 + 主体人话中文标签表 `FEEDBACK_SUBJECT_LABEL`（`conversation_message→"Cuu 回复"` /
    `proposal→"提议"` / `action_card_item→"行动卡"`）落在同文件，只依赖 `@workhub/contracts` 的
    `AiFeedbackSubjectType`，不反向依赖 db 仓库类型（服务层与 db 层解耦）。
- **`hasCurationSignal` 扩展**（设计 §6.3）：`totalAccepted>0 || escalations.length>0 ||
  negativeFeedback.length>0 || positiveFeedback.length>0`。有差评/好评即触发当晚 curation，否则只有反馈的
  工作区反馈数据石沉大海。
- **`buildCurationPrompt` 注入点**：在「【升级/卡壳信号】」小节之后、「【已有技能】」之前插两个新小节，
  **反例优先**（对 curator 决策权重更高，「先给约束、再给素材」）：
  - `【被用户打「没用」的近期产出（反例——蒸馏时主动避免同类模式，勿重蹈覆辙）】`
  - `【被用户点「有用」认可的近期产出（正样本，用户主动认可，强信号）】`
  - **偏离设计的口径**：设计稿把反例/好评节和 accepted/escalations 一样列成常驻「（无）」节；本实现
    **仅在真有反馈时才拼这两节**（`analysis.negativeFeedback.length>0` / `positiveFeedback.length>0` 守卫），
    无反馈时整节不出现——满足「无差评→prompt 不含空节」的验收口径，也让反馈这个稀疏新信号不给 curator
    制造「反馈系统没数据」的噪声（与 accepted/escalations 两个高频常驻信号刻意区分）。

### 2.2 `apps/api/src/workers/agent-skill-curation.ts`

- **`negativeFeedbackWithExcerpts(deps, workspaceId, since, limit?)`（导出、纯函数、可单测）**：
  先 `negativeSamplesSince(workspaceId, since, limit)` 取近窗 `not_useful` 样本，按 `subjectType` 分三组、
  `Promise.all` 三条 IN 批量取正文（禁 N+1，O(3) 查询而非 O(N)），按样本原顺序（`updated_at desc`）逐条
  映射成 `{subjectType, excerpt, note}`。空样本短路（不发正文查询）。
- **有界注入**（防 prompt 膨胀，设计 §6.1）：`NEGATIVE_FEEDBACK_SAMPLE_LIMIT=20`（照抄设计「建议 limit=20」，
  比 K1 discard 记忆的 12 略宽——新信号源起步多给曝光）+ 单条摘要 `FEEDBACK_EXCERPT_CHARS=200`
  截断（照抄设计「反馈摘要用更短的上限，如 200 字符即可」，比 K2 精修的 1600 预览短）。墓碑/无正文 →
  占位 `（内容不可用）` 而非空串或抛错。
- **默认 `analyze()` 接线**：新增 `createAiFeedbackRepository(db)` + `createFeedbackSubjectExcerptReader(db)`，
  在既有四条信号查询的 `Promise.all` 后再并行加两条：`negativeFeedbackWithExcerpts(...)` +
  `feedbackRepo.positiveCountsSince(workspaceId, since)`，结果落进 analysis 的两个新字段。

### 2.3 `packages/db/src/repositories/ai-feedback.ts`（W-A 预留的仓库文件）

新增 `FeedbackSubjectExcerptReader` 类型 + `createFeedbackSubjectExcerptReader(db)` 工厂：三张主体表各一条
IN 批量取正文（`conversation_messages.content_json.text` / `proposals.title` / `action_card_items.title_md`），
去重 + 单组 cap 100 + 空集短路。会话消息墓碑（`deleted_at` 置位、正文已清 `{}`）或 `content_json.text` 非
字符串 → `null`。刻意与读写 `ai_feedback` 表的 `AiFeedbackRepository` 解耦（它查的是三张主体表，纯为
curation 摘要服务）。

**禁区裁定**：说明书禁 `packages/db` 迁移，但明确允许「仓库层若需新批量查询方法可加在 ai-feedback 仓库
文件」；W-A 报告 §5 亦称「W-B 可用既有各表仓库或自建批量查询」。`apps/api` 未声明 `drizzle-orm` 依赖（不能
在 worker 里直接写 drizzle 查询——会引入幽灵依赖），故批量正文查询建在 `packages/db`（drizzle 是其正规
依赖）最干净，worker 只消费注入的 reader。

## 3. K5 成本记账核验

**无新增记账路径**（如实核验）。`createSkillCurationProviderAdapters.distill` 仍是唯一的蒸馏 LLM 调用，
`source: "curation"` 原样不动（`agent-skill-curation.ts` 内既有）。W-B 只是给这次既有 distill 调用**多喂几段
反馈文本**（`buildCurationPrompt` 输出变长），不产生新的花费口径——`cost-ledger.ts` 的 "curation" scope 桶
原样收纳，`curationBudgetOk` 日上限闸门不变。

## 4. prompt 样例（真实渲染输出，节选反馈两节）

```
【升级/卡壳信号（说明缺什么能力）】
- [low_confidence×2] 缺少 SQL 导出技能

【被用户打「没用」的近期产出（反例——蒸馏时主动避免同类模式，勿重蹈覆辙）】
- [Cuu 回复]「这段季度汇总答非所问，完全没回答我的问题」（用户备注：跑题了）
- [行动卡]「导出 CSV」

【被用户点「有用」认可的近期产出（正样本，用户主动认可，强信号）】
- Cuu 回复：获好评 6 次
- 提议：获好评 2 次

【已有技能（不要重复）】
code-script
```

（`note` 为 `null` 的行动卡条目不带「（用户备注：…）」括号；反例排在好评之前。）

## 5. 测试计数（前 → 后）

| 包 | 前 | 后 | 增量 |
|---|---|---|---|
| @workhub/api（`skill-curation.test.ts`） | 25 | 30 | +5 |
| @workhub/api（全量） | 1391 | 1396（1395 过 1 skip，既有） | +5 |
| @workhub/db（`ai-feedback-repository.test.ts`） | 7 | 10 | +3 |
| @workhub/db（全量） | 342 | 345（343 过 2 skip，既有真库 matrix skip） | +3 |

新增 5 个 api 测试：`hasCurationSignal` 反馈单信号新分支（差评-only / 好评-only）· `buildCurationPrompt`
注入反例节（excerpt + note + 主体标签 + 反例先于好评 + 恰一处备注 + null-note 不带括号）· 无反馈时不含
空节 · `negativeFeedbackWithExcerpts` 分组 O(3) 取正文 + 截断 + 墓碑占位 + 顺序 · 空样本短路不发正文查询 ·
窗口 `since` + cap 20 转发（改判重新计入语义）。

新增 3 个 db 测试（query-recorder 假库）：会话消息 `content_json.text` 提取 + 墓碑 → null · 提议/行动卡
标题按 id 映射 + 命中各自表 id 的 IN · 空 id 集短路不发查询。

## 6. 偏离与机械后果（全部列明）

1. **反例/好评节条件化**（非常驻「（无）」节）——见 §2.1 末，满足「无差评→prompt 不含空节」的验收口径，
   与设计稿「照 accepted/escalations 列常驻节」的字面不同，是刻意收敛。
2. **8 个既有 `SkillCurationAnalysis` 字面量补两字段**（`negativeFeedback: []` / `positiveFeedback: []`）——
   给类型加 required 字段的机械后果，行为断言零改动（非迁就）。选 required 而非 optional 是为让
   `hasCurationSignal`/`buildCurationPrompt` 保持无 `?.`/`?? []` 噪声、逐字贴合设计 §6.2/§6.3 的类型。
3. **仓库层新方法建在 ai-feedback 仓库文件**（而非 worker 内写 drizzle）——见 §2.3 禁区裁定，避免 `apps/api`
   幽灵依赖 `drizzle-orm`。摘要拼装逻辑（分组/截断/占位/顺序）仍在 worker（纯函数、可单测）。
4. **「改判重新计入」窗口语义**由 W-A 的 `negativeSamplesSince`（`updated_at >= since`）承担，其 `not_useful`/
   `updated_at` 过滤已在 W-A 的 `ai-feedback-repository.test.ts` 覆盖；W-B 侧补一个「`since`/cap 转发」测试
   从消费者视角锁死窗口传递。
5. 其余逐字照设计稿：反例优先、`limit=20`、摘要 200 截断、好评只计数、无新增 cost 路径、不做置信度数值加成、
   不做 run↔skill 反向追溯。

## 7. 改动清单（2 个 targeted commits + 本报告）

- `feat(db)`：`repositories/ai-feedback.ts`（+`FeedbackSubjectExcerptReader`/`createFeedbackSubjectExcerptReader`）
  + `ai-feedback-repository.test.ts`（+3）。
- `feat(api)`：`services/skill-curation.ts`（analysis 两字段 + `hasCurationSignal` + `buildCurationPrompt` 两节）
  + `workers/agent-skill-curation.ts`（`negativeFeedbackWithExcerpts` + analyze 两查询接线）+
  `skill-curation.test.ts`（+5）。
