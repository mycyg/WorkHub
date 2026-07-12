# 批 4b 完成汇报 · 产出卡回灌 + 全托管档 gate

日期：2026-07-12 · 执行：Claude Fable 5 · 分支：`r12/batch4b-outputs`（从 `r12/workbench-full` @ `8626328b` 切出）

## 做了什么

1. **模式五档第 5 档 gate（`apps/api/src/services/agent-run-confidence.ts`）**：置信度矩阵原本只要
   AI 评审给 grade 5（`review.grade===5`）+ 高置信/低风险，`evaluateAgentRunConfidence` 就能算出
   `verdict==="auto_merge"`；但这个 verdict 要不要真的生效，取决于调用方传的 `autoMergeAllowed`
   静态开关——而生产装配（`getDefaultAgentRunQueue()`）此前从不传这个开关，等于线上从未真正自动
   合并过一次（`downgradeAutoMerge` 永远把它降级成 `human_spotcheck`）。本批把这个静态开关改成**逐
   run 动态查**：新增 `modeResolver`（默认实现 `createAgentRunUserAiModeResolver`，读
   `user_ai_profiles` 仓库）在每次记录置信度时查 run 的 assignee（`run.actor_id`，等同
   `agent_runs.actor_user_id`）此刻的 `default_mode`，`mode===5` 才把 `autoMergeAllowed` 置真；
   mode<5（含从未定制过的默认档 3）一律 `false`。查不到工作区/仓库出错/未定制档位，一律 fail-closed
   回落默认档 3（不自动合并）。
2. **真正的自动合并动作（`apps/api/src/workers/agent-runner.ts`）**：发现现状比设计文档描述的更原
   始——`verdict==="auto_merge"` 此前是**纯装饰性标签**，`openProposalFromManifest` 对所有成功 run
   一律只开提议，从没有任何代码路径消费这个 verdict 去真的执行合并。本批把它接成真动作：
   `openProposalFromManifest` 现在拿到 `confidence.verdict`，`===  "auto_merge"` 时调用新增的
   `attemptAutoMerge`——AI 以 `{actor_kind:"ai", label:"WorkHub AI"}` 身份对刚开出的提议依次调用
   `proposalSink.review({decision:"approve"})` 再 `proposalSink.merge()`（复用既有
   `ProposalService.review/merge`，未新起合并逻辑）。失败（撞车/需要对底稿/仓库层任何拒绝）一律
   fail-open：吞掉错误、提议留在已开状态等人处理，绝不让"自动合并失败"倒退成"run 失败"。
   `AgentRunProposalSink` 类型相应放宽为 `Pick<ProposalService,"createFromManifest"> &
   Partial<Pick<ProposalService,"review"|"merge">>`——只给 `createFromManifest` 的旧测试/QA 脚本零改动
   仍能编译（`review`/`merge` 缺席时 `attemptAutoMerge` 直接短路返回 false，行为不变）。
3. **产出卡系统消息回灌**：`openProposalFromManifest` 在开完提议（无论是否自动合并）后调用新增的
   `postDeliverableSystemMessage`，往 run 的 `source_conversation_id` 会话里 post 一条
   `system_event`，`content: {event:'proposal_opened'|'proposal_auto_merged', proposal_id, run_id,
   title, adds, dels}`。发布口是新的可选依赖 `postSystemMessage`（类型
   `AgentRunConversationSystemMessagePoster`），生产装配复用批 3 已有的
   `createActionCardRepository(db).postSystemMessage`（照 `drive-pages.ts`
   `announceVersionRollback` 的同款调法，没有新起一套消息写路径）。best-effort：没有来源会话/没接
   这个依赖/发布失败，都不影响提议已经落库的结果，只是静默跳过播报。
4. **`adds`/`dels` 行级统计（新文件 `apps/api/src/services/deliverable-diff-stats.ts`）**：调研发现
   `DeliverableChangeManifest` 完全没有行级增删字段（manifest 构建只落 after 内容的
   sha256/300字摘录，`before_excerpt`/`sha256_before` 实际从不填充——见下方"我改过的断言"前的调研结论）。
   改用 sandbox workdir 里两份全量文件直接比：P-COLLAB M1 物化的 `workdir/project/`（改动前镜像）vs
   AI 产出的 `workdir/outputs/`（改动后）。极简前后缀裁剪算增删行数（不是真 LCS/Myers diff，注释里
   写明白了），单条改动读取上限 500K 字符、单张卡最多统计 20 条变更，读不到/超限静默跳过那一条，绝不
   报错拖垮已经成功的 run。
5. **前端产出卡渲染（`apps/desktop-webview/src/workbench/chat/render.ts`）**：`system_event` 消息的
   `content.event` 是 `proposal_opened`/`proposal_auto_merged` 时，渲成 editcard 样式的卡片（标题+
   `+adds/-dels` 双色数字），复用既有 `.wh-wb-chat-actioncard` 系列 CSS 类（没有改
   `workbench/css.ts`——那是范围围栏之外的共享文件，颜色用已有的 `--ds-success`/`--ds-danger`/
   `--ds-warn` token 内联）。`proposal_auto_merged` 变体显示「已自动采纳 · 全托管」；`proposal_opened`
   变体显示「已生成变更申请，等待人工确认后采纳」。其它 `system_event`（如批 6 的
   `drive_version_restored`）不受影响，照旧走普通折叠灰线。

## 改动文件清单

- `apps/api/src/services/agent-run-confidence.ts` —— 新增 `UserAiModeResolver` +
  `createAgentRunUserAiModeResolver`（默认读 ai-settings 仓库）；`AgentRunConfidenceRecorderOptions`
  加 `modeResolver`；裁决点逐 run 现查 mode 算 `autoMergeAllowed`；返回值加 `verdict` 字段。
- `apps/api/src/workers/agent-runner.ts` —— 新增 `AgentRunConversationSystemMessagePoster` 类型 +
  `postSystemMessage` 依赖；`AgentRunProposalSink` 放宽含可选 `review`/`merge`；新增
  `attemptAutoMerge`/`postDeliverableSystemMessage`；`openProposalFromManifest` 加 `verdict` 参数并
  在开完提议后接自动合并+系统消息；`recordRunConfidence` 返回值从 `string|undefined` 改成
  `{confidenceId?, verdict?}`（两个调用点同步改名 `preTerminalConfidenceId→preTerminalConfidence`/
  `confidenceId→confidence`）；`getDefaultAgentRunQueue()` 接入默认 `postSystemMessage`。
- `apps/api/src/services/deliverable-diff-stats.ts`（新）+ `.test.ts`（新，5 条）—— 行级增删估算器。
- `apps/api/src/services/agent-run-confidence.test.ts`（新，9 条）—— 3 条 gate 红线单测 +
  `autoMergeAllowed` 硬覆盖/modeResolver 抛错 fail-closed + `createAgentRunUserAiModeResolver` 默认
  实现的 4 条读路径单测。
- `apps/api/src/agent-runs.test.ts` —— 改 1 处既有 stub 的返回形状（见"我改过的断言"）；新增 2 条
  端到端集成测试（全托管档真自动合并 / 分级自动档只开提议，均含系统消息断言）。
- `apps/desktop-webview/src/workbench/chat/render.ts` —— 新增 `deliverableSystemEventKind`/
  `renderDeliverableCardHtml`，`renderMessageHtml` 按 `content.event` 分流。
- `apps/desktop-webview/src/workbench/chat/render.test.ts` —— 新增 3 条渲染单测（opened/auto_merged/
  非产出卡 system_event 不受影响）。
- `r12-desktop-workbench/reports/batch-4b-outputs.md`（本文件）。

## 自查输出

```
pnpm -r typecheck   → 16/16 workspace 全绿（含 apps/api、apps/desktop-webview、packages/agent 等）
apps/api 全量测试    → 1041 tests, 1040 pass, 0 fail, 1 skipped（既有 env-gated PG 矩阵占位，非本批引入）
                       批前 agent-runs.test.ts 87 → 批后 89（+2）；新增 agent-run-confidence.test.ts
                       9 条、deliverable-diff-stats.test.ts 5 条 —— 本批净增 16 条测试
apps/desktop-webview 全量测试 → 529 tests, 529 pass, 0 fail
                       render.test.ts 38 → 41（+3）
git status          → 干净，只有本批改动的 5 个既有文件 + 3 个新文件
```

未跑 `pnpm verify`/`pnpm lint`（含 `qa:r2-release-gate`、cuu-r3 系列 smoke）：这些需要起真实
PG/Redis/dev-server 基建，本批未接触路由挂载/迁移/schema，改动面已被 `pnpm -r typecheck` + 两个
package 的全量单测/集成测试覆盖，判断不值得为此起重基建；若需要可另行验收。

## 我改过的断言

- `apps/api/src/agent-runs.test.ts`（原 3413 行附近，"agent run route auto-pumps queued work when
  aborted mid-tool-call" 用例里的 inline `confidence` stub）：`return { confidenceId }` 改成
  `return { confidenceId, verdict: "human_spotcheck" }`。**理由**：`AgentRunConfidenceRecorder` 的
  返回类型本批新增了必填字段 `verdict`（调用方 `agent-runner.ts` 需要它来判断要不要自动合并），这
  纯粹是让一个类型不完整的 test double 满足新契约，不是放宽/绕过任何断言——这条用例本身断言的是
  `confidenceCalls`/`milestoneNotifications` 等中止语义，与 `verdict` 值无关，随便填一个合法枚举值
  即可，选 `"human_spotcheck"` 是因为它是收紧后的默认行为（未开全托管时的正常落点）。

## 行为变更说明（gate）

- **变更前**：置信度矩阵的 `auto_merge` verdict 只是记录在 `confidence_records` 表里的一个标签，展示
  在工作项详情页，从未驱动过任何真实合并动作；生产装配也从不传 `autoMergeAllowed`，即便有一天接上
  消费逻辑，`downgradeAutoMerge` 也会把它悄悄降级成 `human_spotcheck`。
- **变更后**：`verdict==="auto_merge"` 现在是真动作的触发条件，但触发资格从"静态全局开关"收紧成
  "grade5 复核 **且** 该 run 的 assignee 此刻把自己的 AI 模式调到第 5 档（全托管 · AI 审）"。这是双重
  收紧（不是放宽）：① 原先线上就没有任何 run 真正自动合并过（因为开关从没打开过）；② 现在打开了这
  条真实能力，但只对显式选了「全托管」的用户生效，其余用户（含从未碰过设置、停在默认第 3 档的绝大
  多数人）行为与变更前完全一致——只开提议，人工审核。
- **红线不动**：法务/财务/身份等高风险类别的强制升级红线，其真正实现在
  `apps/api/src/services/human-reserved-guard.ts`（`legal`/`finance`/`identity`/`publish`/`external`
  工具调用分类 + 工作项 `human_reserved` 标记），运作在**完全独立、更早**的阶段（run 成功产出交付物
  之前、工具调用时机），本批完全没有 touch 这层——它拦下的 run 永远走不到
  `openProposalFromManifest`/`confidence` 这一步，`mode===5` 无从影响它。既有覆盖（"agent run enqueue
  opens user_forbidden escalation for human-reserved worker work"）本批修改后仍然全绿，见上方自查。
  置信度矩阵自身内部还有一条 `riskLevel==="high"→escalate` 的分支（`matrixVerdict`），调研确认它在
  当前 `AgentLoopResult` 契约下对成功态 run **永远算不出 "high"**（`riskDimensionsFor` 的
  external/monetary/domain_gate 三个维度恒为 0，这是本批之前就存在的既有事实，不是本批引入或本批能修
  的问题）——`agent-run-confidence.test.ts` 的红线单测 3/3 因此改用真实可达的
  `grade==="low"→escalate` 分支验证"mode===5 不能凌驾置信度矩阵自身裁决"，并在文件头注释里如实写清
  了这个取舍，没有伪造一个当前代码库里达不到的场景。

## 范围外发现（不修，只报）

- `packages/agent/src/evaluation/confidence.ts` 的 `riskDimensionsFor` 里 `external`/`monetary`/
  `domain_gate` 三个风险维度硬编码为 0，`riskLevel==="high"` 分支对任何成功态 run 都是死代码——如果
  「高风险类别」将来要挂在置信度矩阵自身（而不是只靠 human-reserved-guard 这层独立拦截），需要专门
  一批把真实风险类别信号接进 `AgentLoopResult`/`DeliverableChangeManifest`。
- `openProposalFromManifest` 里 `attemptAutoMerge` 若 `review` 成功但 `merge` 因撞车/需要对底稿失败，
  提议会停在 `"reviewed"` 状态（不是 `"opened"`），但本批发出的产出卡仍走 `proposal_opened` 文案
  「已生成变更申请，等待人工确认后采纳」——语义上略不精确（其实已经过 AI 审，只是合并本身没成功），
  但不算错误信息，判断不值得为这个边界情况新开第三种消息变体。
- 「看提议」深链按钮（prototype editcard 上有）本批没做：跨窗口打开提议详情页需要工作台外壳
  （`apps/desktop-webview/src/workbench/shell.ts`）配合传递回调（照 `onOpenDriveFile` 的既有模式），
  但 `shell.ts` 在批次给定的范围围栏之外（只给了 `workbench/chat/**`）。渲染成一个不接线的按钮会违反
  铁律#3（不许假接线）；渲染成裸 `<a href="/proposals/:id">` 又缺乏证据证明工作台窗口的 webview 会正
  确处理这种跨窗口相对路径导航（本仓库目前 workbench/chat/rail/shell 里没有任何一处用纯 `<a href>`
  做站内跳转，全部走 button+data 属性+回调）——两条路都可能造出一个点了没反应或导航到白屏的按钮，
  故照批 2 行动卡的既有取舍（"完整的行动卡交互由后续批次接入这个窗口"），产出卡也用诚实的纯文字状态
  代替，留给下一批接线。

## 没做/存疑

- `postDeliverableSystemMessage` 里 `adds`/`dels` 是"两份全量文件前后缀裁剪"的粗粒度估算，不是真
  LCS/Myers diff——中段有多处不连续改动时会比真实 diff 偏大（见 `deliverable-diff-stats.ts` 顶部注释
  与单测里对这个局限的显式验证）。
- 全托管档的真机/真 LLM key 冒烟未做——本批测试全部是内存态集成测试（`createInMemoryProposalService`
  真跑了 review→merge 状态机，但没有接真 PG/真 DeepSeek key）。建议下一轮真 key 验收时补一条"协同会话
  切到第 5 档→AI 审→自动合并"的端到端演示。
- 未新增/修改任何 `packages/contracts` schema——调研确认 `system_event.content` 现有的
  `boundedConversationObjectContentSchema` 已经是无 enum 约束的通用有界 JSON，容纳新的
  `event`/`adds`/`dels` 字段不需要放宽任何契约。
