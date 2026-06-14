---
module: P-COLLAB-project-file-merge
layer: P-COLLAB
status: active
owner: engineering+design
date: 2026-06-14
depends_on:
  - r6-compounding-ai-labor-plan-2026-06-14.md
---

# P-COLLAB 项目级文件协作：全项目可读写 + 工作副本 + LLM 三方采纳 + 异步不丢更新

> **进度（2026-06-14, status=active）—— 增量 1（安全地基）已交付、CI 绿：**
> - **迁移号 0014**（非 0013；0013 被 S2 team_skills 占）→ `acceptedDeliverableChanges.project_id`(可空，兼容历史行) + 项目级索引 `(project_id,target_key,superseded_at)`。
> - **L2 采纳序列化锁已上**：真库 `repositories/proposals.ts` `merge()` 事务开头 `pg_advisory_xact_lock(hashtext('project-merge:'||projectId)::bigint)`——同项目采纳串行化（projectId 早已由 workItems join 取到）。两条 accepted-change 写入路径（merge + applyMergeProposalCandidate）都填 projectId。
> - 真 PG 验证：列/索引存在、advisory-lock SQL 合法执行；全量 `pnpm test` + `pnpm -r typecheck` 绿（迁移由 r1-pg-smoke 兜）。
> - **侦察关键结论（影响后续测试策略）**：`apps/api/src/proposals.test.ts` 用的是 **`MemoryProposalRepository`（内存假实现）**，不碰真库 `merge()`——所以真库的 advisory lock / 撞车并发**不被 api 套件覆盖**，CI 也没有真 PG 并发 harness。
> **增量 2（语义核心）已交付：L1 跨任务防覆盖 + L3 提交前复检。**
> - `readCurrentAccepted` 撞车判定键 `(workItemId,targetKey)` → **`(projectId,targetKey)`**（projectId 缺失回落任务级，向后兼容）；5 个相关读/作废点全部对齐 project 范围（merge / applyMergeProposalCandidate / 撞车预览），**读与作废同范围**（否则跨任务会作废错行）。
> - **L3 提交前复检**：merge() 作废当前态时 `.returning()` + sha256_after 断言，若 0 行作废（advisory lock 下不应发生的最后防线）→ 抛错中止整笔采纳，绝不脏写。
> - 历史行 `project_id` 一次性回填（dev DB 38→0；**生产升级需同样回填**，已记 handoff）。CI 新库无历史行、逐条带 projectId，无需回填。
> - **真 PG 实证**（真实回填数据）：project-scope 查询能看到 6 条跨任务当前真相，而旧的 workItem-scope（别的任务来问）看到 0——正是会丢更新的洞被堵上。
> - 回归：全量 `pnpm test`(api 161/db 15) + `pnpm -r typecheck` 绿；真库 merge 端到端由 **pilot-stack-smoke** CI 兜（real PG 真跑 agent→proposal→merge）。
> **增量 3（项目级文件范围 M1）已交付：AI 能读整个项目。**
> - `apps/api/src/workers/project-hydrate.ts`：`hydrateProjectWorkdir()` 把项目当前 Drive 文件物化进 `workdir/project/`（只读参考区，按 parentId 链重建目录树）；纯函数+可注入依赖；**预算上限**(默认 200 文件/32MB)防爆、每路径过 `safeResolvePath` 防逃逸、逐文件 try **fail-open**。`outputs/` 仍是唯一可写产出区（manifest 只扫 outputs/，互不干扰）。
> - 接进 `agent-runner` workdir 创建后（fail-open 包裹）；默认 hydrator `run→work_item→projectId→drive.readPage` 取材。**默认关闭** `AGENT_RUN_PROJECT_HYDRATE_ENABLED=false`（CI/pilot-stack 零行为变化），开启才生效。
> - 测试：4 个 CI-gated 单测（物化/路径逃逸/双预算上限/fail-open）；**真 PG 端到端实证**：开启后对真实 work_item 物化 38 文件/322KB、目录树正确、0 skip。全量 `pnpm test`(api 165) + typecheck 绿。
> - **仍未做（后续增量）**：① rebase「先对一下底稿」流 + `POST /:id/rebase` + merge 返回 `rebase_required`（现在底稿过期是抛错中止，未给友好 UX）；② project-scope 撞车同步进 `MemoryProposalRepository` 做 CI-gated 跨任务测试（现靠真 PG 本地实证 + pilot-stack-smoke 兜）；③ base 底稿快照(M2，配合 rebase)；④ 去黑话撞车卡 + 结构记录三方兜底；⑤ 撞车判定/作废的 project 范围回填迁移（供生产升级）。


> **北极星延伸**：让 AI 不再被困在一个任务的小盒子里——它能读写**整个项目（一个 project 下的全部资料）**；每一次改动都是一份独立的**工作副本**（带备份/快照），人确认后才**采纳**进项目；采纳这一步由 **LLM 做三方对照**（base/我的/你的），而不是闭眼覆盖；多人异步采纳时，**用旧底稿采纳绝不能盖掉别人刚加进去的东西**（不丢更新）。全部建立在现有 `sha256_before` 乐观并发 + diff3 + AI 融合稿 + 快照之上——**扩展，不重造**。
>
> **去黑话铁律（贯穿全文）**：用户界面里**没有** branch / merge / conflict / rebase 这些词。对外只说：**工作副本**（branch）、**采纳**（merge/accept）、**撞车了**（conflict）、**对一下底稿再采纳**（rebase/re-merge）。本文档内部为对齐代码会用英文术语，但所有面向用户的文案（VM / notice / 文案 key）必须翻译。

---

## 开工前必读

**真实文件 + 行号（已逐条核对当前 main）**

| 文件 | 行号 | 内容 |
|------|------|------|
| `apps/api/src/workers/agent-runner.ts` | 410–411 | `defaultWorkdir()` → `mkdtemp(path.join(os.tmpdir(), \`workhub-agent-${input.run.run_id}-\`))`；**每个 run 一个隔离 /tmp 沙箱**（要改的就是这里的取材范围） |
| `apps/api/src/workers/agent-runner.ts` | 748–752 | `const workdir = await (options.workdir ?? defaultWorkdir)(executionInput)` → 写回 `workdir_ref` |
| `apps/api/src/workers/agent-runner.ts` | 89 / 1025 | `workdir_ref?: string`；`getWorkdir(runId)` 解析链 |
| `packages/tools/src/sandbox.ts` | 46–66 | `safeResolvePath(workdir, inputPath)` 防逃逸——**所有文件工具的边界**，扩范围必须仍走它 |
| `packages/tools/src/sandbox.ts` | 86 | `enforceSandboxBudget(workdir, budget)`（maxFiles/maxBytes，范围扩大后要重估预算） |
| `packages/tools/src/file-tools.ts` | — | 9 个文件工具全部 `safeResolvePath(ctx.workdir, …)` 绑定 |
| `packages/agent/src/deliverables/manifest.ts` | 119–138 | `listOutputEntries()` 只扫 `workdir/outputs/`——manifest 取材范围 |
| `packages/agent/src/deliverables/manifest.ts` | 443–509 | `buildDeliverableChangeManifestFromOutputs()` 写 `manifest.base.snapshot_id`（采纳/回退基线） |
| `packages/db/src/schema/core.ts` | 138–161 | `projects` 表（**项目=workspaceId 下的 project；这就是"项目级范围"的边界**，不存在单独 projectGroup 表） |
| `packages/db/src/schema/core.ts` | 185–230 | `workItems` 表：`projectId`(非空 FK)、`version`、`mainBranchId`——任务隶属于 project |
| `packages/db/src/schema/core.ts` | 317–367 | `projectDriveItems` / `projectDriveVersions`（scoped to `projectId`）——**项目真相库；采纳后才写这里** |
| `packages/db/src/schema/core.ts` | 702–724 | `branches` 表：`workItemId`(非空)、`agentRunId`、`baseSnapshotId`、`headRef`、`version`、`status` |
| `packages/db/src/schema/core.ts` | 726–752 | `proposals` 表：`branchId`(非空)、`diffManifest`、`mergeSnapshotId`、`status` |
| `packages/db/src/schema/core.ts` | 772–810 | `acceptedDeliverableChanges` 表：`targetKey`、`acceptedVersion`、`baseVersionRef`、`sha256Before`、`sha256After`、`supersededAt`、`driveItemId/driveVersionId`——**乐观并发的真相** |
| `packages/db/src/schema/core.ts` | 812–838 | `mergeAttempts` 表：`mergeSnapshotId`、`conflictsJson`、`acceptedTargetKeys`、`result`、`conflictCount` |
| `packages/db/src/schema/core.ts` | 1097–1115 | `snapshots` 表：`workItemId`、`branchId`、`kind`、`ref`、`contentSha256`、`revertedAt` |
| `packages/db/src/repositories/proposals.ts` | 337–386 | `conflictsWithCurrentAccepted()`——**撞车判定核心逻辑**（见下方原文） |
| `packages/db/src/repositories/proposals.ts` | 388–403 | `readCurrentAccepted()` → `WHERE superseded_at IS NULL`（点时间最新态） |
| `packages/db/src/repositories/proposals.ts` | 2250–2514 | `merge()`：`db.transaction()` 内逐 targetKey 读最新态→判撞车→原子写入 |
| `packages/db/src/repositories/proposals.ts` | 2283–2301 | 写入前的逐条撞车检测 |
| `packages/db/src/repositories/proposals.ts` | 2445–2470 | `supersededAt` tombstone 标记（`WHERE superseded_at IS NULL` 守卫）+ `acceptedVersion = (prev ?? 0) + 1` |
| `apps/api/src/services/proposals.ts` | 1515 | service `merge(input)`（检测撞车→生成 AI 融合稿→处理） |
| `apps/api/src/services/proposals.ts` | 1541 / 1549 | `chooseMergeCandidate()` / `applyMergeCandidate()` |
| `apps/api/src/services/merge-fusion-candidates.ts` | 296–336 | `mergeUniqueHunks()` / `textDiff3Analysis()`（3 路文本 diff3，仅无重叠时自动合） |
| `apps/api/src/services/merge-fusion-candidates.ts` | 579–586 | `deterministicTextDiff3Supplements()`（先确定性自动合，LLM 只补缺口） |
| `apps/api/src/services/merge-fusion-candidates.ts` | 837–896 | `createLlmMergeFusionCandidateGenerator()`（LLM 三方融合 prompt + 解析） |
| `apps/api/src/routes/proposals.ts` | 420–472 | `POST /:id/merge` route |
| `apps/api/src/routes/proposals.ts` | 539–589 | `POST /merge-proposals/:id/choose` 与 `/apply` |
| `apps/api/src/services/agent-run-snapshots.ts` | 32–76 | `createAgentRunSnapshotHook()`：每步前建 `pre_step` 快照 |
| `packages/audit/src/snapshot-service.ts` | 12–48 | `takeSandboxFileSnapshot()` / `revert()` |
| `.github/workflows/verify.yml` | 26–53 | `web-live-route-smoke` job → `pnpm qa:r4-web-live-route-interaction` |
| `apps/web/qa/r4-web-live-route-interaction.ts` | — | 70 步 web live smoke（只卡 data-\* 结构 + 请求指纹 + notice 语义） |

**撞车判定原文**（`packages/db/src/repositories/proposals.ts:337-386`，这是不丢更新的地基，必须看懂再动）：

```ts
const incomingShaBefore = change.target_ref.sha256_before;
let conflicted = false;
if (incomingShaBefore) {
  conflicted = current.sha256After !== incomingShaBefore;        // 我的底稿 ≠ 当前最新 → 撞车
} else if (incomingVersionBefore) {
  conflicted = current.acceptedRef !== incomingVersionBefore;
} else if (change.change_type === "created" || change.change_type === "generated") {
  conflicted = !incomingShaAfter || current.sha256After !== incomingShaAfter; // 别人已建同名 → 撞车
} else {
  conflicted = true;
}
```

> 关键认知：当 `readCurrentAccepted()` 对某 `targetKey` 返回 **非 null** 时，说明已有人采纳过这个文件；任何 `created/generated` 改动只要不是恰好同内容，就判撞车——**这就是"别人刚加进去的东西不会被旧底稿盖掉"的现有半成品**。本规划要做的是把它从「单任务 work_item 内」抬升到「整个 project 内」，并补全缺的那块（见下"现状与差距"第 4 条）。

---

## 目标

用一段话说清协作 + 采纳安全模型：**AI agent 的取材与产出范围从"单个任务的隔离 /tmp 沙箱"扩展到"整个 project（同一 `projectId` 下的全部 Drive 资料）"**；它读项目全量、改动只落在一份**工作副本**里（每份工作副本带一个 base 快照作为底稿基线 + 改前备份）；人审查工作副本后点**采纳**，采纳这一步由 **LLM 做三方对照**（base 底稿 / 项目当前真相 / 工作副本产出），无重叠的自动合、有重叠的出**融合稿候选**给人确认，绝不闭眼覆盖；并发安全靠**每个 targetKey 的 `sha256_before` 乐观锁 + project 级采纳序列化**：采纳前在事务内重读该文件当前真相，若我的底稿 sha 与当前真相 sha 不一致（说明别人已经先采纳/新增过），则**判撞车、拒绝直采、要求"对一下底稿再采纳"（rebase）**，从而保证异步多人采纳下旧底稿永远盖不掉新内容（no lost-update）。

---

## 现状与差距

**已有（直接复用，别重造）：**

| 能力 | 在哪 | 状态 |
|------|------|------|
| `sha256_before` 乐观并发 | `acceptedDeliverableChanges.sha256Before/After` + `conflictsWithCurrentAccepted()` (`repositories/proposals.ts:337-386`) | ✅ 健全（单 work_item 范围） |
| 3 路 diff3 文本合并 | `textDiff3Analysis()` / `mergeUniqueHunks()` (`merge-fusion-candidates.ts:296-336`) | ✅ 无重叠自动合 |
| AI 融合稿候选 | `createLlmMergeFusionCandidateGenerator()` (`merge-fusion-candidates.ts:837-896`)；先确定性自动合，LLM 补缺口 (`:579-586`) | ✅ |
| 快照 / 备份 / 回退原语 | `snapshots` 表 (`core.ts:1097-1115`)、`takeSandboxFileSnapshot()/revert()` (`snapshot-service.ts:12-48`)、`pre_step` hook (`agent-run-snapshots.ts:32-76`) | ✅ 原语齐全 |
| 采纳事务原子性 | `merge()` 包在 `db.transaction()`，逐 targetKey 读最新态→判撞车→`supersededAt` tombstone + `acceptedVersion++` (`repositories/proposals.ts:2250-2514`) | ✅ |
| 工作副本 / 提议 / 采纳链 | `branches` → `proposals` → `acceptedDeliverableChanges` → `projectDriveVersions` | ✅ |

**对照用户 4 条需求的差距：**

1. **全项目可读写** ❌：`defaultWorkdir()` (`agent-runner.ts:410-411`) 每 run 一个空 `/tmp` 沙箱，**没有把 project 现有 Drive 资料喂进去**；`listOutputEntries()` (`manifest.ts:119-138`) 只扫 `outputs/`。agent 看不到同项目其他文件 → 无法真正"读写整个项目"。
2. **工作副本=带 base 快照的副本** ⚠️ 半成品：`branches.baseSnapshotId` 字段**存在但未被采纳判定使用**（recon 确认 baseSnapshotId 赋值/引用逻辑缺失）。今天没有"工作副本开工时拍一张项目底稿快照"的动作。
3. **LLM 三方采纳** ✅ 已具备，但仅在 work_item 内、且只对文本/结构字段；**结构记录（structured_record）无确定性 diff3 兜底**，全靠 LLM。
4. **异步不丢更新** ⚠️ 半成品：撞车判定逻辑正确，但 **(a)** 范围限于单 work_item 的 targetKey 命名空间，跨任务改同一项目文件检测不到；**(b)** `merge()` 无 `SELECT … FOR UPDATE` / proposal 级乐观锁，两个并发 merge 可能都读到 `reviewed` 同时进事务（recon 明确指出）；**(c)** `merge()` 事务开头判撞车但**提交前不复检**，且 `supersededAt` 是时间戳 tombstone 非原子标志，同微秒双采纳有竞态。

> 一句话定位差距：**地基对，但范围太小 + 缺底稿快照 + 缺采纳序列化锁**。本规划补这三块。

---

## 模型设计

### M1. 项目级文件范围（project-wide agent scope）

- **真相边界 = `projectId`**（`core.ts:138`）。WorkHub 没有单独的 projectGroup 表；"项目组/整个项目"在 schema 上就是一个 `project` 及其 `projectDriveItems`（`core.ts:317`）。run 通过 `work_items.projectId`（`core.ts:190`）解析所属项目。
- **开工填料**：`defaultWorkdir()` 仍 `mkdtemp` 出隔离沙箱（保留隔离性），但新增 **project hydrate 步骤**：把该 project 当前最新 `projectDriveVersions`（`superseded` 之外的最新版）按目录结构物化进 `workdir/project/`（只读基线区），`outputs/` 仍是 agent 唯一可写产出区。
- **边界不破**：所有文件工具仍走 `safeResolvePath(ctx.workdir, …)`（`sandbox.ts:46`）；只是 workdir 里现在多了一个只读 `project/` 树。`enforceSandboxBudget`（`sandbox.ts:86`）的 maxFiles/maxBytes 按 project 规模上调 + 加"大项目分片/按需拉取"降级（见施工 §3）。
- **去黑话**：用户看到的是"AI 正在参考这个项目里的资料"，不暴露 workdir/沙箱概念。

### M2. 工作副本 = 带 base 快照的副本（branch = 工作副本 + 底稿基线）

- 每次 run 创建 `branches` 行（已有），**新增动作**：run 启动时对所参考的 project 真相拍一张 `snapshots` 行（`kind='base'`，`ref='project:{projectId}@{drive_head_version}'`，`contentSha256` = 该次基线指纹），写回 `branches.baseSnapshotId`（**激活这个已存在但闲置的字段**，`core.ts:710`）。
- 这张 base 快照 = **底稿**。后续采纳的三方对照里，它就是 diff3 的 `base`；回退时它就是 revert 目标。
- **改前备份**：沿用 `pre_step` 快照 hook（`agent-run-snapshots.ts:32-76`）——agent 每步写文件前已自动拍快照，工作副本天然带备份，无需新机制。
- **去黑话**：UI 说"这是一份草稿（工作副本），还没进项目"；"撤销"= revert 到 base 快照。

### M3. 人确认 → LLM 三方采纳（human-approve → LLM 3-way merge）

复用现有三相模型（`services/proposals.ts:1515` `merge()` → `chooseMergeCandidate` → `applyMergeCandidate`），不改流程骨架：

1. 人在工作副本详情页点"采纳"。
2. `merge()` 事务内逐 `targetKey` 读 `readCurrentAccepted()` 当前真相，跑 `conflictsWithCurrentAccepted()`：
   - 不撞车 → 走 `deterministicTextDiff3Supplements()`（`:579-586`）确定性自动合。
   - 撞车 → 调 `createLlmMergeFusionCandidateGenerator()`（`:837-896`）产 **AI 融合稿候选**：base = 工作副本的 base 快照内容，current = 项目当前真相，incoming = 工作副本产出 → 真三方 reconcile。
3. 人看融合稿候选（卡片含 quality_gate + diff3 预览），`choose` 选稿、`apply` 落 `projectDriveVersions`（`core.ts:346`）+ 写 `acceptedDeliverableChanges`（`acceptedVersion++`、新 sha256）。
- **补缺**：为 `structured_record` 加确定性字段级 3 路兜底（base/current/incoming 三方按字段比对，无重叠字段自动合，重叠字段才上 LLM），消除"结构记录全靠 LLM"的差距 4③。
- **去黑话**：撞车卡标题"这里和别人撞车了"，三选项文案"用我的 / 用对方的 / 让 AI 帮你揉一稿"。

### M4. 并发安全 = 旧底稿绝不盖新内容（stale-base detection + no lost-update）

这是本规划的硬核。三层防护，逐层兜底：

- **L1 每文件乐观锁（已有，扩范围）**：采纳某 `targetKey` 时，事务内 `readCurrentAccepted()` 取当前真相的 `sha256After`，与我的工作副本该文件的 `incoming.sha256_before`（=我开工时的底稿 sha，来自 base 快照）比对。**不一致 = 别人在我之后先采纳过 → 判撞车，拒绝直采**。这正是 `:354` 的 `conflicted = current.sha256After !== incomingShaBefore`。
  - **新增删除（created/generated）的丢更新防护**：若我的工作副本"新建"了文件 X，但事务内发现 X 在项目真相里已存在（`current != null`），`:357-358` 已判撞车——**这就是"旧底稿采纳不会盖掉别人刚加进去的文件"**。本规划确保 `targetKey` 在 project 范围内全局唯一（见 §M5/数据流），让跨任务新增同名文件也能被这条捕获。
- **L2 采纳序列化锁（新增，补差距 4②）**：在 `merge()` 事务开头对**目标 project 的采纳临界区**加锁，串行化同项目的并发采纳。两种实现择一：
  - **(a) Postgres advisory lock**：`pg_advisory_xact_lock(hashtext('project-merge:'||projectId))`——事务级、自动随提交/回滚释放、零新表。**推荐**。
  - **(b) 行级悲观锁**：对 project 维度的"采纳游标"行 `SELECT … FOR UPDATE`。
  - 效果：消除"两个 merge 同时读到 reviewed 同时进事务"的竞态；同项目采纳排队进行，每个采纳都读到前一个的最新结果。
- **L3 提交前复检 + 原子 tombstone（新增，补差距 4③）**：`supersededAt` 标记沿用 `WHERE superseded_at IS NULL`（`:2445-2449`）守卫，**改为带行数断言**：`UPDATE … SET superseded_at=now() WHERE target_key=$1 AND superseded_at IS NULL AND sha256_after=$expectedCurrentSha` 且断言影响行数=预期；若 0 行说明真相在事务内被改（advisory lock 下不应发生，但作为最后防线），则 abort 整个采纳并报"撞车了，请对一下底稿"。

**rebase / re-merge 流（"对一下底稿再采纳"）**——当 L1 判定底稿过期：

1. 不直采。给用户一张"撞车了"卡，文案"项目里这个文件在你之后被人更新过，需要先对一下底稿"。
2. 后台对工作副本执行 **re-base**：取项目当前真相为新 base，重拍 base 快照、更新 `branches.baseSnapshotId` 与 `version++`（`branches.version`，`core.ts:711`）。
3. 用新 base 重跑 `merge()` 的三方融合：base=新真相、current=新真相、incoming=工作副本产出 → 出新融合稿候选给人确认。
4. 人确认后再走 L2/L3 采纳。全程不丢任何一方的内容；旧底稿被显式作废，不可能用它落盘。
- **去黑话**：用户只看到"先对一下底稿"按钮 + 一张新的融合稿；"rebase/version++"全在后台。

### M5. targetKey 的 project 全局命名空间（不丢更新的命名前提）

- 现 `acceptedDeliverableChanges.targetKey`（`core.ts:786`，长度 768）+ 索引 `(workItemId, targetKey, supersededAt)`（`core.ts:805`）是 **work_item 范围**。
- 为让"同项目跨任务改同一文件"能被 L1 捕获，`readCurrentAccepted()` 与撞车判定的查询键从 `(workItemId, targetKey)` **升级为 `(projectId, driveItemId/targetKey)`**：对落 Drive 的交付物，以 `projectDriveItems.id` 为权威 key（同一文件跨任务恒等）。`workItemId` 保留为审计/归属字段，不再是隔离边界。

---

## 数据流与契约

**字段扩展（迁移 `0013`，建立在 0012 之后）：**

| 表 | 改动 | 理由 |
|----|------|------|
| `branches` (`core.ts:702-724`) | 激活 `baseSnapshotId` 写入逻辑（字段已存在，无需 DDL）；`version` 用于 rebase 计数 | M2 底稿基线 / M4 rebase |
| `snapshots` (`core.ts:1097-1115`) | `kind` 新增枚举值 `'base'`（project 底稿）；`ref` 用 `project:{projectId}@{driveHead}` | M2 |
| `acceptedDeliverableChanges` (`core.ts:772-810`) | 新增 `projectId uuid`(FK→projects, 非空) + 新索引 `(project_id, target_key, superseded_at)`；保留 `(work_item_id,…)` 索引 | M5 project 级命名空间 |
| `mergeAttempts` (`core.ts:812-838`) | `result` 新增 `'rebased'`；`conflictsJson` 复用记录撞车明细 | M4 rebase 审计 |

**新表（迁移 `0013`，仅 1 张，可选）：**

- `project_merge_cursor`（仅当选 L2(b) 行锁而非 advisory lock 时需要）：`projectId`(unique FK)、`lockedAtVersion int`。选 advisory lock 则**不建此表**。

**Service / Repository：**

- `repositories/proposals.ts`
  - `readCurrentAccepted()` (`:388-403`)：查询键 `(workItemId,targetKey)` → `(projectId, targetKey)`。
  - `conflictsWithCurrentAccepted()` (`:337-386`)：逻辑不动，输入改 project 范围当前态。
  - `merge()` (`:2250-2514`)：事务开头加 `pg_advisory_xact_lock`（L2）；`supersededAt` 更新加 `sha256_after` 断言 + 行数检查（L3）；新增 `rebase()` 路径。
- `services/proposals.ts`
  - `merge()` (`:1515`) / `chooseMergeCandidate()` (`:1541`) / `applyMergeCandidate()` (`:1549`)：融合稿 base 改取 `branches.baseSnapshotId` 内容；新增 `rebaseProposal(proposalId)`。
  - `merge-fusion-candidates.ts`：新增 `structuredRecord3WayDryRun()`（结构记录字段级三方兜底，补差距 4③）。
- `workers/agent-runner.ts`
  - `defaultWorkdir()` (`:410`) 后追加 `hydrateProjectWorkdir(workdir, projectId)`：物化项目真相到 `workdir/project/`；run 启动时拍 base 快照写 `branches.baseSnapshotId`。

**Endpoints（route 形状尽量不变，保 smoke 绿）：**

- `POST /api/proposals/:id/merge` (`routes/proposals.ts:420-472`)：返回新增 `result: 'rebase_required'` 分支（撞车且底稿过期时）。
- `POST /api/proposals/:id/rebase`（**新增**）：触发"对一下底稿"，回新融合稿候选。
- `POST /api/merge-proposals/:id/choose` `/apply` (`:539-589`)：不变。
- **Contracts**：撞车/rebase 的 VM 文案全部去黑话（`工作副本/采纳/撞车了/先对一下底稿`）。

---

## 施工顺序

> 每步可独立验证、可独立提交；前 4 步不碰用户路由，smoke 天然绿。

1. **迁移 0013**：加 `acceptedDeliverableChanges.projectId` + `(project_id,target_key,superseded_at)` 索引；`snapshots.kind` 加 `'base'`；`mergeAttempts.result` 加 `'rebased'`。**验证**：`pnpm db:generate` diff 干净 + `pnpm db:migrate` 在 r1-pg-smoke 跑通。
2. **base 快照写入**：`agent-runner.ts` run 启动时拍 project 底稿快照→写 `branches.baseSnapshotId`。**验证**：单测断言每个 run 后 `branches.baseSnapshotId` 非空且 `snapshots.kind='base'` 存在。
3. **项目级 hydrate**：`hydrateProjectWorkdir()` 把 project Drive 物化进 `workdir/project/`（只读）；`enforceSandboxBudget` 上调 + 大项目按需拉取降级。**验证**：单测——agent 能 `read_file('project/某已存在文件')`；越界路径仍被 `safeResolvePath` 拒绝；预算超限触发降级而非崩溃。
4. **撞车判定升 project 范围**：`readCurrentAccepted()`/撞车查询键 → `(projectId,targetKey)`。**验证**：新单测——任务 A、任务 B 改同一 `driveItem`，B 用旧底稿采纳被判撞车（A 的内容不被覆盖）。
5. **采纳序列化锁 L2**：`merge()` 事务开头 `pg_advisory_xact_lock(hashtext('project-merge:'||projectId))`。**验证**：并发集成测试——两 goroutine 同时 merge 同项目，结果 acceptedVersion 严格递增、无丢失（assert 两次写入都在 lineage 里）。
6. **提交前复检 L3**：`supersededAt` 更新加 `sha256_after` 断言 + 行数=预期检查，0 行则 abort。**验证**：注入"事务中真相被改"场景，断言采纳 abort + 报撞车，无脏写。
7. **rebase 流**：`rebaseProposal()` + `POST /:id/rebase` + `merge` 返回 `rebase_required`。**验证**：集成测试——底稿过期 → merge 返 `rebase_required` → rebase → 新融合稿 → 采纳成功，两方内容都在。
8. **结构记录三方兜底**：`structuredRecord3WayDryRun()`。**验证**：单测——无重叠字段自动合、重叠字段才进 LLM 候选。
9. **去黑话文案 + VM**：撞车/rebase 卡全部 `工作副本/采纳/撞车了/先对一下底稿`；接 `proposal/render.ts` 撞车卡。**验证**：文案审计无 branch/merge/conflict 泄漏到用户面。
10. **端到端 + smoke**：跑全套 proposal/merge gate + 70 步 web smoke。**验证**：见 QA Gate。

---

## QA Gate

**必须保持绿（回归）：**

- **70 步 web live smoke**：`pnpm qa:r4-web-live-route-interaction`（`.github/workflows/verify.yml:26-53`）。它只卡 data-\* 结构标记 + 请求计数指纹 + notice 的 kind/actionId 语义——**所以**：新 route (`/rebase`) 不进现有 70 步的请求计数指纹路径；撞车卡的 data-\* 标记沿用现有 conflict 卡结构；去黑话只改可见文案不动 data-\* / fixture 字符串。
- **现有 proposal/merge gate**：`merge()` / `chooseMergeCandidate` / `applyMergeCandidate` 既有单测 + `conflictsWithCurrentAccepted` 测试全绿。
- **r1-pg-smoke / r2-pg-redis-smoke**：迁移 0013 不破坏。

**新增测试（每条对应一条施工验证）：**

1. `base-snapshot.spec`：每 run 后 `branches.baseSnapshotId` 非空 + `kind='base'` 快照存在。
2. `project-scope-hydrate.spec`：agent 可读项目内他任务文件；越界仍拒；预算降级不崩。
3. `cross-task-stale-base.spec`（**核心**）：A、B 改同一 driveItem，B 旧底稿采纳→判撞车→A 内容零丢失。
4. `concurrent-merge-serialization.spec`（**核心**）：并发同项目 merge → acceptedVersion 严格递增、两次写入都在 lineage（no lost-update）。
5. `pre-commit-recheck.spec`：事务内真相被改→采纳 abort、无脏写。
6. `rebase-flow.spec`：过期底稿→`rebase_required`→rebase→新融合稿→双方内容都在。
7. `structured-record-3way.spec`：无重叠字段自动合、重叠字段进 LLM。
8. `de-jargon-copy.spec`：撞车/rebase 用户面文案无 branch/merge/conflict 泄漏。

**门槛**：核心两条（#3、#4）是不丢更新的硬验收，必须先于 rebase/文案合入；任一红则整批不合。

---

## Handoff

- **给后端**：施工 1-8 是纯后端 + DB，可独立推进；优先 L1 范围升级（#4）+ L2 序列化锁（#5）+ L3 复检（#6）——这三条构成"异步不丢更新"的完整证明，建议同一 PR 带 `cross-task-stale-base` + `concurrent-merge-serialization` 两个核心测试一起合。advisory lock 优先于新表方案（零 schema 成本）。
- **给前端/设计**：施工 9 依赖后端 `rebase_required` / `POST /:id/rebase` 契约定稿；撞车卡复用 `proposal/render.ts` 现有 conflict 卡 data-\* 结构，只换文案为 `工作副本/采纳/撞车了/先对一下底稿`，避免动 smoke 指纹。
- **给 AI 引擎**：施工 3 的 `hydrateProjectWorkdir` 要和 `enforceSandboxBudget` 预算上限对齐——大项目需"按需拉取/分片"降级策略，避免每 run 全量物化炸 /tmp。
- **关键不变量（review 必查）**：(a) 所有文件工具仍走 `safeResolvePath`；(b) 采纳落盘前必经 L1+L2+L3 三层；(c) `supersededAt` tombstone 永远带 `WHERE superseded_at IS NULL` + sha 断言；(d) 用户面零黑话。
- **依赖**：本规划 `depends_on: r6-compounding-ai-labor-plan-2026-06-14.md`（共用 workspace/project 范围与 AgentRun+Proposal 审批模型；migration 编号接其 0012 之后取 0013）。
- **未决/留给下一轮**：跨 project 的资料共享（当前严格按 `projectId` 隔离，不做跨项目读）；version vector / 逻辑时钟（当前整数 `acceptedVersion` + advisory lock 足够单部署，多区域再议）；每 work_item 的并发工作副本上限（当前无限制，靠 L1/L2 兜底，未来可加软上限）。
