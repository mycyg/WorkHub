# R13 批 P1.5 · 右栏变动文件区 —— 完成汇报

> 分支：`r13/p15-changed-files`（从 `origin/main @ 20386a92` 拉出）
> 依据：`r13-workbench-refinement/01-new-batches-design.md` 第二节（批 P1.5，约 83-138 行）+ `r12-desktop-workbench/04-codex-execution-guide.md` §4 十三条铁律
> 迁移编号：`0050_proposal_diff_stats.sql`（设计稿草稿写的 0048 已被 G1/S3 两个并行批占用，指令覆盖为 0050；本批未越界）

## 做了什么

1. **数据地基**：`proposals` 加 `diff_stats_json jsonb`（nullable，无默认值）——迁移 `0050_proposal_diff_stats.sql`（`ADD COLUMN IF NOT EXISTS`，单纯可空列不需要 `NOT VALID/VALIDATE` 两段式）+ `schema/core.ts` 新增 `ProposalDiffStats`/`ProposalDiffStatsFile` 类型 + `_journal.json` 追加 idx=50 条目。
2. **`estimateDeliverableDiffStats` 改造为同时返回聚合与 per-file 明细**（`apps/api/src/services/deliverable-diff-stats.ts`）：新返回形状 `{ adds, dels, files: DeliverableDiffStatsFile[] }`——`adds`/`dels` 字段名与既有调用方完全兼容（零迁移成本），`files[]` 是同一次遍历里顺手产出的第二个视图，保证两条消费路径（产出卡系统消息聚合数字 / 右栏 per-file 明细求和）永远一致。单条文件读不到（新建/被删/非文本/超限/路径不安全）时该条目**不带 `adds`/`dels` 字段**（而不是写 0），如实体现"这条改动没能计入统计"。既有 `MAX_CHANGES_DIFFED=20` 上限原样覆盖到 `files[]`。
3. **agent-runner.ts 顺手持久化**：`postDeliverableSystemMessage` 里 workdir 仍存活时，新增可选注入点 `diffStatsWriter`（独立于既有 `AgentRunProposalSink`，不强行给 `ProposalService` 加方法——直接走 `@workhub/db` 仓库层做旁路写，与 `getDefaultRunConversationReportHook()` 的接线思路一致），把 `{ total: {adds, dels}, files }` 写进 `proposals.diff_stats_json`。**写入失败 fail-open**（只警告，绝不影响已有的产出卡系统消息播报）；**没有 workdir 时不写**（留 null，比冒充全零统计更诚实）。生产默认wiring：`getDefaultAgentRunQueue()` 接 `createProposalRepository(getSharedDatabaseClient().db).updateDiffStats`。
4. **仓库层**：`packages/db/src/repositories/proposals.ts` 新增 `updateDiffStats`（单纯一列 `UPDATE...WHERE id=`，不带 CAS/租约守卫——这是一份旁路播报数据，不参与 proposal 状态机）。**该方法在 `ProposalRepository` 类型上标为可选**，避免强迫仓库外的既有测试假实现（`apps/api/src/proposals.test.ts` 的 `MemoryProposalRepository`，超出本批范围）都补一份空实现。
5. **读侧**：`listOutputLinksForConversation`（`packages/db/src/repositories/conversation-runs.ts`）select 里加 `diffStatsJson` 列（不需要额外一次查询）；`apps/api/src/services/conversation-army.ts` 的 VM 映射把它转成 `changed_files`（有意丢弃内部 `change_id`，只暴露 `path?/change_type/adds?/dels?`，去重靠 `path` 在前端做）——`diffStatsJson` 为 `null` 时**整个 `changed_files` 字段不出现**（不是空数组）。
6. **契约**：`packages/contracts/src/pages.ts` 新增 `armyChangedFileVmSchema`（`change_type` 复用 `deliverableChangeSchema.shape.change_type`，不重复定义一份可能漂移的枚举）；`armyOutputLinkVmSchema`（`.strict()`）加可选字段 `changed_files: z.array(armyChangedFileVmSchema).max(20).optional()`。
7. **桌面渲染**：`apps/desktop-webview/src/workbench/army/render.ts` 右栏第 4 区"变动文件"——插入顺序 `outputsHtml → changedFilesHtml（新）→ runsHtml → backgroundHtml`；聚合当前会话所有 `outputs[].changed_files` 按 `path` 去重（`collectArmyChangedFiles`，导出供单测；`outputs.items` 本就按 `updated_at desc` 排列，第一次遇到某 path 即最新一条，"先到者赢"）；每行文件名 + `workbenchIcons.file` 图标 + change_type 人话化徽标 + `+N -M`（缺失时显示"改动详情不可用"，绝不显示 `+0 -0`）；点击展开复用输出区同款 `<details>` 折叠（不新开深链，04 铁律#3）；命中 20 条统计上限时给出"可能还有更多改动没有逐条统计"提示（一个诚实但不精确的启发式，见下"缺口存疑"）。**没有为这批新增 CSS**——样式复用既有 `.wh-wb-army-out-*` 类，视觉与输出区一致，见下"缺口存疑"。

## 改动文件清单

- `packages/db/src/schema/core.ts`（`ProposalDiffStats`/`ProposalDiffStatsFile` 类型 + `proposals.diffStatsJson` 列）
- `packages/db/migrations/0050_proposal_diff_stats.sql`（新文件）
- `packages/db/migrations/meta/_journal.json`（追加 idx=50 条目）
- `apps/api/src/services/deliverable-diff-stats.ts`（`estimateDeliverableDiffStats` 改造，新增 `files[]`）
- `apps/api/src/services/deliverable-diff-stats.test.ts`（新增 4 条：files[] 形状/adds-dels 缺省语义/截断）
- `apps/api/src/workers/agent-runner.ts`（`AgentRunProposalDiffStatsWriter` 类型、`diffStatsWriter` 选项、`postDeliverableSystemMessage` 顺手持久化、生产默认 wiring）
- `apps/api/src/agent-runs.test.ts`（新增 2 条：写入数字与系统消息一致 / 写入失败 fail-open）
- `packages/db/src/repositories/proposals.ts`（`ProposalRepository.updateDiffStats` 可选方法 + 实现）
- `packages/db/src/proposals-repository.test.ts`（新增 1 条：UPDATE 语句形状）
- `packages/db/src/repositories/conversation-runs.ts`（`listOutputLinksForConversation` select 扩展 + `ConversationRunOutputLink.diffStatsJson`）
- `packages/db/src/conversation-runs-repository.test.ts`（新增 1 条：populated diff_stats_json 透传；既有 1 条断言补 select 校验）
- `apps/api/src/services/conversation-army.ts`（`changedFileToVm` 映射 + outputs 拼接）
- `apps/api/src/services/conversation-army.test.ts`（fixture 补 `diffStatsJson: null`；新增 2 条：populated 映射 / null 时字段整体不出现）
- `packages/contracts/src/pages.ts`（`armyChangedFileVmSchema` 新增 + `armyOutputLinkVmSchema` 扩展）
- `apps/desktop-webview/src/workbench/army/render.ts`（`collectArmyChangedFiles` + `renderArmyChangedFilesSectionHtml` + 拼接顺序）
- `apps/desktop-webview/src/workbench/army/render.test.ts`（新增 7 条：去重/无 path 独立成条/形状/缺省语义/空态/截断提示/未截断不提示）
- `packages/db/src/schema.test.ts`（**必要 ripple**：更新"journal 结尾"断言 0049→0050；新增 0050 迁移内容 + 列属性断言，替换掉的旧断言原是 S3 批留下的占位）

### ripple（机械补字段，无行为断言变化，参照 G1 批同类先例）

`proposals` 是一张被多处测试直接构造 `ProposalRow` 形状 fixture 的表，加一个新列（即便可空）在 TypeScript 的结构类型下会让这些 fixture 缺一个必需 key。以下 3 个文件各补了一行 `diffStatsJson: null,`（无任何断言变化）：

- `apps/api/src/drive-pages.test.ts`（3 处 `pageRows.commentProposals.push({...})`）
- `apps/api/src/meeting-pages.test.ts`（1 处 `pageRows.insightProposals.push({...})`）
- `apps/api/src/proposals.test.ts`（1 处 `MemoryProposalRepository.createFromManifest` 内部 fixture）

这类 ripple 补字段在 G1 批的汇报里有先例（`r13-g1-small-groups.md` 的"改动文件清单"显式列出对 `drive-pages.test.ts`/`workbench-pages.test.ts` 等文件的同类补字段），本批照此惯例处理，未越权做任何功能改动。

## 自查输出

```
pnpm --filter @workhub/db test              → tests 270 / pass 268 / fail 0 / skip 2（真 PG 矩阵，env 门控，未跑）
pnpm --filter @workhub/api test             → tests 1174 / pass 1173 / fail 0 / skip 1
pnpm --filter @workhub/desktop-webview test → tests 835 / pass 835 / fail 0
pnpm --filter @workhub/contracts test       → tests 102 / pass 102 / fail 0
pnpm -r typecheck                           → 16/16 workspace projects: Done，exit 0
```

**测试数量前后对比**（用 `git stash` 拉出 origin/main 基线单独跑过一遍确认）：

| 包 | before | after | Δ |
|---|---|---|---|
| @workhub/db | 267 | 270 | +3 |
| @workhub/api | 1167 | 1174 | +7 |
| @workhub/desktop-webview | 828 | 835 | +7 |
| @workhub/contracts | 102 | 102 | +0（只扩了 schema，没碰契约测试文件） |

新增合计 17 条真断言（`git diff -- '*.test.ts'` 显示 +18/-1，减 1 是 `schema.test.ts` 里那条被替换掉的"journal 结尾"断言）。全部是会失败的真断言（先写会红的场景再验证绿），没有 `assert(true)` 式空测。

## 我改过的断言（如有）

- `packages/db/src/schema.test.ts` 的 `"migration journal ends with 0049 personal projects"` 改名为 `"...0050 proposal diff stats"`，期望值从 `{idx:49, tag:"0049_personal_projects"}` 改成 `{idx:50, tag:"0050_proposal_diff_stats"}`。**理由**：这条断言的注释本就写明"谁的迁移落在最后，谁把它推进一格"——是一条按设计天然会被下一个落地的批次顺延的断言，不是我在迁就实现，是 0050 迁移本就该成为新的 journal 尾。

## 集成者缝合清单

无需集成者配合——本批未触碰 `app.ts`/`openapi.ts`/`server.ts`/`app.test.ts`，`GET /conversations/:id/army` 路由已经挂载在 `apps/api/src/app.ts:243`（`createConversationArmyRoutes()`，历史批次留下的挂载，本批新增字段是纯 additive，旧客户端忽略新字段即可向后兼容），不需要新的挂载动作。

如果集成者做跨批合并时因为并行批次的迁移顺序冲撞导致 0050 需要重新编号，只需同步改三处：`packages/db/migrations/0050_proposal_diff_stats.sql` 文件名、`schema.test.ts` 里那条"journal ends with 0050..."断言的 idx/tag、`_journal.json` 的对应 entry。

## 缺口存疑（只报不修）

1. **截断提示是启发式，不是精确判定**：右栏"可能还有更多改动没有逐条统计"的提示，判定条件是"某个输出的 `changed_files.length` 恰好命中 20"（`MAX_CHANGES_DIFFED`）。如果一个提议恰好正好有 20 处改动（没有被真正截断），会被误判成"可能被截断"；反过来，由于持久化时 `files[]` 本就已经被裁到 20 条，没有任何字段携带"原始 changes 总数"，无法做到 100% 精确判定。设计稿验收门只要求"有提示"，这里如实标注这个已知不精确性，不追加新字段解决（会超出本批范围，且新增字段需要再过一轮 `.strict()` 契约+fixture 改动）。
2. **`armyChangedFileVmSchema` 的 `path` 字段是 optional**：`deliverableChangeSchema.target_ref.path` 本身可选（如 `entity_type` 是 `work_item`/`task_plan` 等结构化目标时可能没有文件路径）。这批渲染层对无 `path` 的条目做了防御（显示"（未知文件）"、去重时各自独立成条不误合并），但这是一个理论边界——目前所有真实产出（`buildDeliverableChangeManifestFromOutputs`）永远会给 `path`，这条分支目前无法用真实 run 触发，只在单测里构造。
3. **没有为"变动文件"区新增 CSS**：`apps/desktop-webview/src/workbench/css.ts` 不在本批施工文件清单里，未触碰。渲染复用了既有 `.wh-wb-army-out-*` 类（与输出区视觉一致），功能完整、可点开折叠，但如果设计上想让"变动文件"区在视觉上与"输出"区有区分度（比如不同的强调色），需要另开一批补 CSS。
4. **`packages/contracts/src/r12-workbench.test.ts` 未改动**：设计稿第六节施工清单提到"及相关 fixture"，但实际核查该测试文件不涉及 `armyOutputLinkVmSchema`/`conversationArmyPanelVmSchema` 的任何 fixture（grep 全文件确认零命中），本批新增的 `changed_files` 可选字段没有触发这个文件里任何既有断言，故未改动，也不需要改动。
5. **未做"回填"脚本**：历史 proposal 的 `diff_stats_json` 永远是 `null`（`workdir` 早已被清理，读不到），这是设计稿明确要求的行为（"不写一次性回填脚本"），不是遗漏。
