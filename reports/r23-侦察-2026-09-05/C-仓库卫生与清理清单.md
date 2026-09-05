# WorkHub 仓库卫生侦察报告（只读）

侦察时间：2026-09-05 11:49 - 12:14（本地时区 +08:00）
侦察方式：全程只读 git/gh/ls/du/find/wc 命令，未执行任何 git 写操作、未改仓库文件、未跑 test/verify/qa、未起服务、未装依赖。

## 0. 最重要的发现：侦察期间主工作树被外部/并行操作切走了分支（请优先看这条）

- 任务下发时的背景是："main-integration 工作树里有一批 2026-08-20 未提交的合法改动，不要碰"。
- 11:49 左右，我在主仓（`/Users/apple/Desktop/开发项目/WorkHub`）首次 `git status --short` 看到 **122 个文件处于未提交状态**，当时分支是 `main-integration`（HEAD `7fbce789`）。
- 12:08 左右，我再次核对同一个仓库，发现：
  - 当前分支变成了 **`r23/land-0820-review-fix-batch`**（此前完全没听说过这个分支，`git branch -a` 首次枚举时也不存在于本地分支列表 —— 说明它是在本次侦察过程中新建的）。
  - 该分支只有 2 个提交，正好从 `main-integration` 当时的 HEAD（`7fbce789`）分叉出来：
    - `761ee1ac fix: R22 审查修复批 I/J/K/L/M 落地（API 安全与资源面/数据流/权限与内核/web 交互/桌面端）`
    - `1f3c7509 test(api): cost 看板夹具改用相对时钟，拆除 90 天窗口到期炸弹`（提交时间 2026-09-05 12:05:03，就是刚刚）
  - 工作树此刻 `git status --short` 变成 **0**（干净）。
  - 该分支已经推送到远端：`refs/remotes/origin/r23/land-0820-review-fix-batch` 与本地同 SHA。
- 结论：这不是我做的（我全程零写操作），而是**有人（用户本人或另一个并行 session）在我侦察的同时，把那 122 个未提交改动提交到了新分支 `r23/land-0820-review-fix-batch` 并 push 到了远端**，工作树随之变干净、分支随之切换。
- 影响：本报告里任何"截至 11:49"的主仓工作树描述（122 处未提交）已经过期，仅作时间线记录；`r23/land-0820-review-fix-batch` 是**当前最新鲜的活跃分支**，绝对不在任何清理建议范围内。**建议执行清理前，先自己跑一次 `git status` / `git branch --show-current` 确认主仓当前状态**，不要直接信任下面按 11:49 快照生成的数字。

---

## 1. worktree 蔓延排查

`git worktree list` 共 **87 个工位**（含主仓本身）。按分支合并状态 + 未提交改动分类：

| 类别 | 数量 | 说明 |
|---|---|---|
| (a) 已合并 origin/main 且工作树干净 | **78** | 可直接 `worktree remove` + `branch -d` |
| (a') detached HEAD 但提交已完全被 origin/main 包含（0 unique commits） | **3** | 只能 `worktree remove`（无分支可删，本来就是 detached） |
| (a'') 工位登记项已失效（gitdir 指向不存在路径，`prunable`） | **1** | `git worktree prune` 处理元数据即可 |
| (b) 已合并但工作树有未提交改动 | **1** | 分支安全，但要看一眼未提交内容再决定强删 |
| (c) 未合并（有独有提交，需人工拍板） | **3** | 见下表，逐条列出 |
| 主仓本身 | **1** | 不动 |
| **合计** | **87** | 78+3+1+1+3+1(主仓)=87，账对得上 |

### (a) 78 个安全删除工位（分支已合并、无未提交改动）

全部 78 条分布：
- `/Users/apple/.codex/worktrees/WorkHub/` 下 38 个（r11-batch0-delegation、r12-workbench-full、r13-a2-assignee-v2、r13-c1-context-compact、r13-p15-changed-files、r14-approve-chat/avatar/chat-core/chat-desktop-ui/chat-presence/drive-rollback/escalated/feedback-curation/feedback-desktop/feedback-server/feedback-web/gh-server/gh-ui/gh-worker/guidance/mem-desktop/mem-server/mem-web/mention-direct/notify-deeplink/oss/p111/perf/replay/risk-server/risk-ui/search-core/search-spotlight/search-web/web-avatars、r14fix-server/shell-recon/spotlight-glass/workbench）
- `/Users/apple/Desktop/开发项目/wh-r15/` 下 40 个（a-pipeline、a-wave2、a6、b-dm、b-ui、c-engine、cuu-toggle、d-proactive、d2、d4、e1、e2、e3、f-care、fix-dep、g-desktop、g-web、g1-members、g2-inbox-events、g3-army、g4-wiring、g5-ux、h1-web、h3-smoke、hotkey、loop2、loop2p1-p4、r19-doc、w1-chat、w2-kanban、w3-editor、w4a-instr、w4b1、w4b2、wave1 不含（wave1 在 b 类）、wb-inbox、web-mirror）

完整清单（路径 TAB 分支名）见下方脚本内嵌数据，此处不重复贴 78 行。

唯一需要留意的一条：`/Users/apple/.codex/worktrees/WorkHub/r12-workbench-full` 对应的本地分支叫 **`main`**（不是 main-integration），已合并、干净。建议只删 worktree 目录，本地 `main` 分支这个 ref 本身很小，留着也无妨，删不删都行（脚本里默认不删这个分支，只删 worktree）。

### (a') 3 个 detached HEAD、内容已完全被 origin/main 吸收（0 unique commits）

| 工位路径 | HEAD | 末次提交日期 | 提交主题 |
|---|---|---|---|
| `/Users/apple/.codex/worktrees/WorkHub/r14-full-review-20260715` | 9d362c72 | 2026-07-15 | docs(r14): full acceptance test manual for the QA handoff |
| `/Users/apple/Desktop/开发项目/WorkHub/.claude/worktrees/nervous-easley-b9f617` | ea15cd9f | 2026-07-13 | feat(desktop): 行动卡状态回流——SSE action_card.updated 解析+本地快照合并+撤销置灰划线渲染(00 §9) |
| `/Users/apple/Desktop/开发项目/WorkHub/.claude/worktrees/vigorous-ritchie-6062c2` | dc9466fa | 2026-07-13 | fix(api): app.onError 补 ConversationTurnServiceError 分支，turn 类型化错误不再压成 500 |

注：`nervous-easley-b9f617` 对应的记忆条目写着"未合...等用户点头"，但 git 层面这个提交此刻已经是 origin/main 的祖先——说明该记忆是旧快照，内容已经在后续轮次（很可能是 R14-R22 期间）被并入了 main。以 git 结果为准，这 3 个工位可以直接删 worktree；对应的分支名 `claude/nervous-easley-b9f617`、`claude/vigorous-ritchie-6062c2` 在"64 个已合并且无工位占用分支"清单里（因为 detached 状态下这两个分支名本身并没有被任何工位占用），一并可删。

### (a'') 1 个失效工位登记（元数据操作即可，无需真的删除文件）

`/private/tmp/claude-501/.../9d8c2d82.../scratchpad/wh-main-review`（分支 `fix/r21-review-hardening`，已合并）—— gitdir 指向的路径已不存在（大概率是某个更早 session 的临时 scratchpad 被系统清理了），`git worktree list` 直接标注为 `prunable`。执行 `git worktree prune` 即可清掉这条幽灵记录；分支 `fix/r21-review-hardening` 已合并，之后可以正常 `branch -d`（在 prune 之前 git 会因为"这个分支还被某工位占用"而拒绝删分支）。

### (b) 1 个已合并但工作树不干净，删前建议扫一眼

| 工位路径 | 分支 | 未提交改动数 | 备注 |
|---|---|---|---|
| `/Users/apple/Desktop/开发项目/wh-r15/wave1` | r15/wave1 | 43 | 分支内容已全部合并进 origin/main；43 处未提交改动可能是这个工位自己后来又做的实验性修改，删除前建议 `git -C .../wh-r15/wave1 status --short` 看一眼，确认不是什么没保存的东西，再决定普通删除还是 `--force`。 |

### (c) 需要拍板的工位（有独有提交，未合并）

| 工位路径 | 分支 | 独有提交数 | 未提交改动 | 末次提交日期 | 磁盘占用 | 备注 |
|---|---|---|---|---|---|---|
| `/Users/apple/.codex/visualizations/2026/07/29/.../workhub-r11-zero-trust-hardening` | codex/r11-zero-trust-hardening | 1（真独有，非等价） | **837** | 2026-08-04 | 4.5G | 见下方专项说明 |
| `/Users/apple/.codex/worktrees/WorkHub/r11-drive` | codex/r11-replay-resources-layout | 6（全部真独有） | **214** | 2026-07-11 | 7.7G | 见下方专项说明 |
| `/Users/apple/Desktop/开发项目/WorkHub/.claude/worktrees/beautiful-fermat-440e14` | （detached，对应分支 claude/beautiful-fermat-440e14） | 1（真独有） | 0 | 2026-07-13 | 计入 .claude/worktrees 共 1.5G | 见下方专项说明 |

**专项说明 · r11-zero-trust-hardening（4.5G）**：这个工位的 HEAD 提交本身（`7e79aed8`，"feat: complete AI-native autonomous delivery loop"）diff 是 435 files/+105334/-11957，看起来像一次性打包提交。但更值得注意的是它的 **837 处未提交改动**——用 `git status --short` 抽查后发现，这些未提交改动里出现了 `r12-desktop-workbench/`（94 处）、`r14-release-readiness/`（13）、`r15-proactive-upgrade/`（6）、`r19-iteration-review/`（4）等**主仓在 R12-R19 之后才会出现的根目录**，以及一份 `CLAUDE_HANDOFF_2026-08-04.md`。这个工位的分支本身是 R11 早期产物，不可能"自然长出"R19 的目录——合理解释是：这个 `~/.codex/visualizations/...` 路径曾被某次 codex 交接流程整仓复制/覆盖过一份更新的仓库快照用作"handoff 包"，从未提交，导致 git 把它全部识别成巨量未提交差异。**这更像是一份过期的交接快照垃圾，而不是真正独有的开发成果**，但因为分支上确实挂着 1 个未落地的提交，且我没有逐字核对 837 个文件是否真的和 main 完全一致，建议人工用 `diff -rq` 抽查几个目录后再删（不要只看 git status 的"AM/A/M"标记就下判断）。
**专项说明 · r11-drive（7.7G）**：6 个提交全部是"+"（真独有，非等价），末次提交 2026-07-11，标题多是 approvals/drive 相关的早期修复（如"preserve truthful decision outcomes"、"bind actions and preserve readable paths"）。214 处未提交改动同样以 apps/packages/client-tauri 为主。这批内容时间上早于 R12-R22 的大量后续重构，从功能名称看很可能已被后续版本重做，但由于内容体量较大（7.7G 磁盘），建议至少扫一眼 6 个提交的 diff 再决定是否丢弃。
**专项说明 · beautiful-fermat-440e14**：唯一提交 `ee0ab9ba feat(desktop): wire Cuu turns into workbench chat — collab sessions now get real replies`（2026-07-13），工作树本身干净（0 未提交）。用户记忆库里有条目明确提到这个 commit hash（`r12-turns-wiring-done.md`），说这是"协同会话 Cuu 真回复"的真机验证通过的成果。但 `git cherry` 显示这个提交在 origin/main 里没有等价物——也就是说**这份被验证过的工作可能从未真正合入 main**，或者已被后续 R14 的 chat-core/chat-desktop-ui/chat-presence（已确认合并）以不同实现覆盖。这个不上不下的状态最值得人工翻一眼：如果现在 main 上的桌面协同聊天确实能收到 Cuu 真实回复，就说明已被覆盖，可以放心删；如果不能，这 1 个提交可能是遗珠。

---

## 2. 远端与本地分支

- 本地分支总数：**154**
- 远端分支总数（不含 `origin/HEAD`）：**18**（含刚被发现的 `origin/r23/land-0820-review-fix-batch`，见第 0 节）

远端分支合并状态全表：

| 远端分支 | 状态 | 末次提交 |
|---|---|---|
| origin/codex/r9-codex-handoff | MERGED | 2026-07-06 |
| origin/codex/r9-stage-a-batch2-5-fixes | AHEAD(17) — PR #2 | 2026-07-06 |
| origin/codex/r9-stage-a-desktop-validation | AHEAD(10) — PR #4 | 2026-07-07 |
| origin/codex/r9-stage-a-main-safe | MERGED | 2026-07-06 |
| origin/codex/r9-stage-b-rework | MERGED | 2026-07-10 |
| origin/fix/r21-review-hardening | MERGED | 2026-07-27 |
| origin/main | （基线） | 2026-08-19 |
| origin/r12/workbench-full | MERGED | 2026-07-13 |
| origin/r14/test-infra | AHEAD(2) — PR #7 | 2026-07-15 |
| origin/r15/wave1 | MERGED | 2026-07-16 |
| origin/r18/h1-web-members | MERGED | 2026-07-17 |
| origin/r19/gap-review | MERGED | 2026-07-17 |
| origin/r20/wave1~wave5 | MERGED（5 个全部） | 2026-07-17~18 |
| origin/r23/land-0820-review-fix-batch | AHEAD(2) — **活跃分支，不要删** | 2026-09-05（今天） |

**本地分支未合并（9 个，需拍板）**：`claude/beautiful-fermat-440e14`、`codex/r11-approval-batch-results`、`codex/r11-drive-target-consistency`、`codex/r11-replay-resources-layout`、`codex/r11-zero-trust-hardening`、`codex/r9-stage-a-batch2-5-fixes`（PR2）、`codex/r9-stage-a-desktop-validation`（PR4）、`r14/test-infra`（PR7）、`r23/land-0820-review-fix-batch`（活跃，不要删）。其中前 3 个 + r11-zero-trust-hardening 已在上表的工位清单里展开；剩下的 `codex/r11-approval-batch-results`（2 个真独有提交，末次 2026-07-11，"preserve truthful decision outcomes"等）和 `codex/r11-drive-target-consistency`（1 个真独有提交，末次 2026-07-10）没有工位占用，纯粹是本地分支 ref，体积很小，风险也小，建议和 r11-drive/r11-zero-trust-hardening 一起判断（大概率是同一批 R11 早期分支的残留分叉）。

**本地分支已合并且无工位占用，可直接 `branch -d`：64 个**（含 5 个 `claude/*`、4 个 `codex/r9-*` 与 `codex/r11-release-hardening-loop`、14 个 `r12/*`、14 个 `r13/*`、26 个 `worktree-agent-*`）。完整清单见脚本内嵌数据。

---

## 3. 开放 PR 处置建议

| PR | 标题 | 状态 | 独有提交 | 真独有(非等价) vs 已等价落地 | CI | mergeable | 建议 |
|---|---|---|---|---|---|---|---|
| **#7** `r14/test-infra` | R14 P2 测试基建收口 | OPEN（非草稿） | 2 | **2 真独有 / 0 等价** | 8/8 SUCCESS（2026-07-15，未重跑） | CONFLICTING（DIRTY，与当前 main 有冲突） | **rebase 到当前 main、解决冲突后合并**。这是三个 PR 里最值钱的一个：内容是真正独有、从未落地的测试基建修复（契约漂移门禁 + Chrome 诊断吞错误），且用户自己的记忆库里明确记着这是"待拍板合并"的成果，不是废弃分支。 |
| **#4** `codex/r9-stage-a-desktop-validation` | R9 phase A desktop validation batch | OPEN（**草稿**） | 10 | **2 真独有 / 8 已等价落地** | 8/8 SUCCESS（2026-07-07，很旧） | CONFLICTING（DIRTY） | 建议**关闭**。8 个提交的内容已经以不同 commit hash 等价落地在 main；剩下 2 个真独有的（`test(db): replace source-grep repository guards`、`fix(desktop): keep search field text drags off window drag 待真机验证`）体量很小，可以先看一眼是否还有价值，值得的话手工 cherry-pick 后关闭 PR，不值得就直接关闭。 |
| **#2** `codex/r9-stage-a-batch2-5-fixes` | Stage A: batch 2-5 fixes | OPEN（**草稿**） | 17 | **12 真独有 / 5 已等价落地** | 8/8 SUCCESS（2026-07-06，很旧） | UNKNOWN（GitHub 从未算出合并状态，大概率因为太旧太大） | 建议**关闭**，但这 12 个"真独有"提交名字看着分量不轻（R9 元规划器提案流、子任务派发/树、agent-judge 跨 agent 仲裁+高风险多票、OKR 规划上下文、cost 预算范围、escalations 逃生舱、drive 历史标记排序）。核对当前主仓代码后发现 `apps/api/src/services/cross-agent-judge.ts`、`packages/db/src/repositories/task-plan-arbitration.ts`、`apps/api/src/services/objectives.ts`（+ 迁移 0036/0037/0040）、`apps/api/src/services/agent-memory.ts` **均已存在于当前 main**——有力证据说明这批 R9 早期草案后来被重新实现了一遍（不是同一个 commit，所以 cherry 才判定"非等价"，但功能上大概率已被覆盖）。可以较有把握地关闭，仍建议合并前有人扫一眼这 12 个提交，确认没有遗漏的边角逻辑。 |

12 个"真独有"提交清单（PR#2）：276f948f(drive标记排序) / a1bc9825(escalations逃生舱) / ad73c272(task-plans数据契约) / 1bacd6d5(元规划器提案流) / 5d281aaf(work items展示R9计划) / 5b018996(子任务派发) / 032823a9(子任务树展示) / 3772a43e(agent-memory隔离) / a8441113(跨agent仲裁) / 4b54b622(高风险多票) / 90e17c6b(OKR规划上下文) / c5f6f286(cost预算范围)。

---

## 4. stash

`git stash list` 共 2 条：

| stash | 摘要 | 建议 |
|---|---|---|
| `stash@{0}` "On main: generated capabilities.json (auto-regen on cargo build)" | 单文件 `client-tauri/src-tauri/gen/schemas/capabilities.json`，1 行改动，是 `cargo build` 自动重新生成的产物差异。 | **建议丢弃**（`git stash drop stash@{0}`）。这个文件本来就是构建产物，重新 `cargo build` 随时能再生成同样的 diff，没有保留价值。顺带看第 6 节——这个文件被 git 跟踪本身就值得商榷。 |
| `stash@{1}` "On r13/p3-settings: codex半成品:smoke升级R12表覆盖 (restored — accidentally popped from r12/workbench-full stash)" | 单文件 `apps/api/src/qa/r2-pg-redis-smoke.ts`，+1642/-61（几乎是重写），基于 2026-07-13 的旧提交（`292e2837`）。消息本身写明是"半成品"且是"不小心 pop 出来后又救回来的"。 | **需要拍板，不建议直接丢**。这是他人特意保下来的未完成工作，且体量不小（1600+ 行）。但底稿提交已经是 7 周前的，当前 `r2-pg-redis-smoke.ts` 大概率已经被后续 R14-R22 改过很多次，`git stash apply` 很可能冲突。建议：先 `git stash show -p stash@{1}` 通读一遍，判断这些改动的意图（看起来是给 smoke 脚本加 R12 相关表覆盖率统计）是否还有价值、当前脚本是否已经用别的方式覆盖了同样的诉求；有价值就手工挑出仍适用的部分，没价值再丢。 |

---

## 5. 根目录规划/资料目录

| 目录 | 大小 | 文件数 | git 跟踪 | 被 scripts/package.json/.github/docs/README 引用 | 备注 |
|---|---|---|---|---|---|
| `r9-agent-army/` | 72K | 7 | 7（全部跟踪） | 是，4 处（`docs/workhub/06-roadmap/*.md` 里的叙述性提及，非路径依赖） | 规划文档 |
| `r12-desktop-workbench/` | **142M** | 95 | 95（全部跟踪） | 否，0 处 | 体积异常大，见下方专项说明 |
| `r13-workbench-refinement/` | 72K | 2 | 2 | 否，0 处 | |
| `r14-release-readiness/` | 376K | 13 | 13 | 否，0 处 | |
| `r15-proactive-upgrade/` | 52K | 6 | 6 | 否，0 处 | |
| `r16-workbench-redesign/` | 136K | 4 | 4 | 否，0 处 | |
| `r19-iteration-review/` | 192K | 4 | 4 | 否，0 处 | |
| `reports/`（根目录） | 100K | 3 | 3 | 表面 67 处命中，逐一核实后**全部是 `docs/workhub/**/reports` 同名子串或正文提及，脚本/workflow 里没有一处真正路径依赖根目录 `reports/`** | |
| `reference/` | **2.3G** | 25825 | **0（完全未跟踪）** | 是，183 处，其中 `scripts/qa/r2-release-gate-report.ts` 明确把 `reference/**`、`references/**` 排除在 diff 门禁之外——**这是有意设计，不是遗漏** | `.gitignore` 第 2 行显式写明"参考代码:仅本地保留,绝不入库"。不是 git 卫生问题，纯粹本地磁盘占用，不建议动它（脚本依赖其排除规则） |
| `data/`（根目录） | 0B | 0 | 0 | 未检索到 | 空目录，无需处理 |
| `验收资料/`（根目录，中文名） | **168M** | 132（131 跟踪+1 个 .DS_Store 未跟踪） | 131 | 否，0 处 | 里面是 `桌面归档-2026-08-11/`，106 张 png + 19 张 jpg + 3 个 html + 2 个 md + 1 个 json，看内容是把 `~/Desktop/WorkHub-验收报告/`（记忆库提到的、原本在仓库外的验收报告）整份复制进了仓库并提交。体积大且零引用 |

**关于 docs.count 门禁的边界**：`scripts/qa/r2-release-gate-report.ts` 里的 "README document count matches docs/workhub markdown files" 门禁**只统计 `docs/workhub/*.md`**，不涉及仓库根目录下这些 `r9-agent-army/`、`r12-desktop-workbench/` 等目录。也就是说：
- 如果要把这些目录归档到 **`docs/workhub/` 内部**（比如 `docs/workhub/06-roadmap/archive/`），会增加 docs.count，需要同一 commit 更新 `docs/workhub/README.md` 里的"N 篇文档已落盘"，否则 CI 红。
- 如果归档到 **`docs/` 下但在 `docs/workhub/` 之外的新目录**（例如新建 `docs/archive-root/`），或者归档到仓库根目录的 `archive/` 之类新顶层目录，**不会触发 docs.count 门禁**，是更省事的路径。当前 `docs/` 一级下有 `brainstorms/`、`plans/`、`prd/`、`superpowers/`、`workhub/` 五个子目录，新增一个同级目录风险最低。

**专项说明 · r12-desktop-workbench（142M）**：几乎全部体积来自两个文件——`reports/R12-人工验收-20260713.zip`（70M）和 `reports/r12-acceptance-2026-07-13/evidence/F-02-titlebar-drag-20260713-1146.mov`（67M），这是一次人工验收留下的原始证据包（压缩包+录屏），被整个提交进了 git。这类二进制大文件一旦入库，即使以后从工作树删除，**历史里依然会永久保留这份体积**（除非重写历史）。建议：先把这两个大文件从当前 HEAD 移出（`git rm` 到仓库外部保存，或另建不参与门禁统计的归档位置），历史体积的事以后视情况再决定是否值得动 `git filter-repo`（这是高风险操作，需要独立评估，不建议放进日常清理脚本）。

**专项说明 · 验收资料/（168M）**：全部由图片/视频证据构成，同样是"一次性提交进仓库的验收快照"，且完全没有被任何脚本/门禁/文档引用。原始验收报告本身在仓库之外的 `~/Desktop/WorkHub-验收报告/` 已经存在（据记忆库记录），这份是重复归档。建议整体移出仓库（`git rm -r` 到 Desktop 或专门的归档盘），同样存在"历史里仍占体积"的问题。

---

## 6. git 跟踪的大文件（>500KB）

全仓库 `git ls-files` 中 >500KB 的文件共 **133 个**，按扩展名分布：png 122、gif 8、zip 1、mov 1、json 1。

Top 大户（>1MB）：

| 文件 | 大小 |
|---|---|
| `r12-desktop-workbench/reports/R12-人工验收-20260713.zip` | 70M |
| `r12-desktop-workbench/reports/r12-acceptance-2026-07-13/evidence/F-02-titlebar-drag-20260713-1146.mov` | 67M |
| `docs/workhub/05-clients/assets/audit/2026-06-10-cuu-r3-reload-restore/hijiki/reload-active-run-en-pass/cuu-motion-printwindow.gif` | 3.6M |
| `验收资料/桌面归档-2026-08-11/workhub-acceptance-assets/*.png`（约 60 个文件，每个 1.5-3.2M） | 合计约 120M |
| 其余 `docs/workhub/05-clients/assets/**/*.png|gif`（约 60 个文件，每个 0.5-1.5M） | 合计约 50-60M |

区分对待：
- `docs/workhub/05-clients/assets/**` 下的图片/动图，是文档体系本身的截图资产（`05-clients` 客户端文档的配图），数量多但单个都不算离谱（多数 0.5-1.5M），属于"文档配图的正常代价"，**不建议动**——除非仓库整体希望把大图迁到外部图床，那是另一个量级的决策，不适合塞进日常清理。
- `r12-desktop-workbench/*.zip|*.mov` 和 `验收资料/**/*.png|jpg` 这两坨（共约 260M）是本报告第 5 节已经点名的"一次性验收快照"，属于可清理对象。

`.gitignore` 检查结果：
- `data/` 目前是空目录，`.gitignore` 里没有专门规则，但因为目录本身是空的，不构成问题。
- `reference/` 已经被规则 `/reference/` 正确忽略（且脚本层面也排除了它），没有遗漏。
- **`client-tauri/src-tauri/gen/schemas/capabilities.json`（以及同目录下的 `acl-manifests.json`、`desktop-schema.json`、`macOS-schema.json`、`windows-schema.json`）目前被 git 跟踪，但这是 Tauri `cargo build` 时自动重新生成的产物**（stash@{0} 就是这个文件的重新生成噪音）。`client-tauri/src-tauri/` 下没有独立 `.gitignore`。建议评估是否要把 `client-tauri/src-tauri/gen/` 整体加入根 `.gitignore`——如果加了，好处是以后 `cargo build` 不会再在 `git status` 里制造噪音（避免类似 stash@{0} 重复出现）；坏处是如果团队依赖"生成物入库以保证跨机器一致"这个假设，去掉跟踪会改变现有行为，这是一个需要人决定的取舍，不建议我自作主张改 `.gitignore`。

---

## 7. `.github/workflows/*.yml` 清单

只有 **一个** workflow 文件：`.github/workflows/verify.yml`（325 行，name: `verify`）。

- 触发条件：`push` → `branches: [main]`；`pull_request` →（未限定分支，即针对任意 PR）。**没有 paths 过滤**，意味着任何 PR/push 都会触发全部 8 个 job，哪怕只改了一个 docs 文件。
- 8 个 job：`workspace`（`pnpm verify`，应该是 lint+typecheck+test 的主入口）、`web-live-route-smoke`、`rust-system-i18n`（含 `cargo fmt --check` + `cargo clippy -D warnings`）、`r1-pg-smoke`、`r2-pg-redis-smoke`、`pilot-stack-smoke`（docker compose 全栈冒烟）、`security-advisory`（`pnpm audit --audit-level high || true`，注意这里 `|| true` 意味着即使发现高危漏洞也不会让 job 失败，只是记录）、`migration-audit`。
- 缓存：7 个 job 用了 `actions/setup-node@v4` 自带的 `cache: pnpm`（`pilot-stack-smoke` 因为是纯 docker compose 流程没有走 node 缓存，属于正常，不是遗漏）；`rust-system-i18n` 另外用了 `Swatinem/rust-cache@v2` 做 cargo 缓存。缓存覆盖率良好。
- 没有发现明显重复的门禁（8 个 job 各司其职，未见两个 job 做同一件事）。
- 值得注意但**不属于"改工作流"范畴、仅作观察记录**：`security-advisory` job 里 `pnpm audit --audit-level high || true` 会吞掉所有失败（高危漏洞不会让 CI 变红，只是留痕），如果这不是有意为之，可能是一个静默的安全门禁缺口——但这是设计判断，不在本次侦察的"清理"范围内，仅记录供参考。

---

## 需要拍板的项（清单汇总，共 15 类/项，不含第 0 节的分支切换观察）

1. `codex/r11-zero-trust-hardening` 工位（4.5G，1 个真独有提交 + 837 处疑似"过期交接快照"的未提交改动）——建议先 `diff -rq` 抽查再删。
2. `r11-drive`（`codex/r11-replay-resources-layout`）工位（7.7G，6 个真独有提交 + 214 处未提交改动）——建议抽查 6 个提交内容。
3. `beautiful-fermat-440e14` 工位（detached，1 个真独有提交，可能是"验证过但从未合并"的桌面协同聊天功能）——建议人工确认当前 main 的桌面协同聊天是否已具备同等能力。
4. `codex/r11-approval-batch-results`（无工位，2 个真独有提交，2026-07-11）——建议和上面 3 条一起判断，大概率同批可处理。
5. `codex/r11-drive-target-consistency`（无工位，1 个真独有提交，2026-07-10）——同上。
6. `r15/wave1` 工位（已合并但 43 处未提交改动）——删前扫一眼未提交内容。
7. PR #7 `r14/test-infra`——建议 rebase 后合并（真正有价值、CI 曾全绿）。
8. PR #4 `codex/r9-stage-a-desktop-validation`——建议关闭，2 个真独有小提交可选择性提取。
9. PR #2 `codex/r9-stage-a-batch2-5-fixes`——建议关闭（有较强证据显示已被后续重做），12 个真独有提交建议合并前扫一眼。
10. stash@{1}（R12 表覆盖率 smoke 半成品，1600+ 行）——需要人读内容判断是否还有价值。
11. `r12-desktop-workbench/reports/*.zip|*.mov`（137M 已入库的验收录屏证据）——建议移出仓库，历史体积是否值得重写需要单独评估。
12. `验收资料/`（168M 已入库的验收截图，和仓库外的 `~/Desktop/WorkHub-验收报告/` 重复）——建议移出仓库。
13. `client-tauri/src-tauri/gen/` 是否应该加入 `.gitignore`（当前入库会导致每次 `cargo build` 都产生噪音 diff）——需要团队决定是否依赖"生成物入库保证跨机一致"这个假设。
14. **`r23/land-0820-review-fix-batch`——活跃分支，今天刚提交并推送，不要删、不要合并、不要动**，仅供知悉（见第 0 节）。
15. 根目录 7 个规划目录（r9-agent-army/r12-desktop-workbench/r13-workbench-refinement/r14-release-readiness/r15-proactive-upgrade/r16-workbench-redesign/r19-iteration-review）+ `reports/` + `验收资料/` 是否要统一归档到 `docs/` 下但在 `docs/workhub/` 之外的新目录——技术上零依赖、随时可以动，只是需要人决定归档到哪、以什么粒度归档（是否保留原目录名）。

---

## 一键可执行的安全清理脚本草案（仅含 (a) 类安全项：已合并、无独有提交、可正常处理的工位与分支）

**使用前必读**：
1. 这是草案，**没有被执行过**，请自行复核后再运行。
2. 运行前请先跑 `git worktree list` 和 `git status`，确认下面列出的路径仍然存在、分支名仍然一致（尤其是第 0 节提到的主仓分支切换，本脚本完全不涉及主仓，但保险起见还是建议先确认一次环境没有其他意外变化）。
3. 脚本对第 (a)(a')(a'') 类做 `worktree remove` / `prune` + `branch -d`；对 (b) 类（`r15/wave1`）只做了"打印提醒"，不会自动删；对 (c) 类完全不涉及。
4. `branch -d`（小写d）本身就是 git 内置的安全开关——如果某个分支其实还有未合并的改动，`-d` 会拒绝删除并报错，不会误删，所以即使下面列表有疏漏也有兜底。
5. 远端分支的删除（`git push origin --delete`）**没有**包含在这个脚本里，因为那是对共享仓库的写操作、影响其他协作者，建议单独执行，见脚本末尾的"可选：远端分支清理"部分（默认注释掉，需要手动取消注释才会执行）。

```bash
#!/bin/bash
# WorkHub 工位/分支安全清理脚本（草案，未执行）
# 仅处理：已确认合并进 origin/main 且（对工位而言）无未提交改动的项。
set -euo pipefail
cd "/Users/apple/Desktop/开发项目/WorkHub"

echo "===== 第一步：清掉失效的工位登记（gitdir 已不存在的那 1 条） ====="
git worktree prune -v

echo "===== 第二步：删除 78 个「已合并+干净」的工位 ====="
# 路径与分支一一对应；main-workbench-full 这条对应本地分支 "main"，脚本里跳过删除该分支（只删 worktree 目录）
while IFS=$'\t' read -r wt_path wt_branch; do
  [ -z "$wt_path" ] && continue
  if [ -d "$wt_path" ]; then
    echo "-- 删除工位: $wt_path (分支 $wt_branch)"
    git worktree remove "$wt_path"
  else
    echo "-- 跳过(路径已不存在): $wt_path"
  fi
  if [ "$wt_branch" != "main" ]; then
    git branch -d "$wt_branch" 2>&1 || echo "   (分支 $wt_branch 删除失败，可能仍有未合并内容，请人工核实)"
  else
    echo "   (跳过删除本地分支 'main'，按建议保留)"
  fi
done <<'EOF'
/Users/apple/.codex/worktrees/WorkHub/r11-batch0-delegation	codex/r11-batch0-delegation
/Users/apple/.codex/worktrees/WorkHub/r12-workbench-full	main
/Users/apple/.codex/worktrees/WorkHub/r13-a2-assignee-v2	r13/a2-assignee-v2
/Users/apple/.codex/worktrees/WorkHub/r13-c1-context-compact	r13/c1-context-compact
/Users/apple/.codex/worktrees/WorkHub/r13-p15-changed-files	r13/p15-changed-files
/Users/apple/.codex/worktrees/WorkHub/r14-approve-chat	r14/approve-chat
/Users/apple/.codex/worktrees/WorkHub/r14-avatar	r14/avatar
/Users/apple/.codex/worktrees/WorkHub/r14-chat-core	r14/chat-core
/Users/apple/.codex/worktrees/WorkHub/r14-chat-desktop-ui	r14/chat-desktop-ui
/Users/apple/.codex/worktrees/WorkHub/r14-chat-presence	r14/chat-presence
/Users/apple/.codex/worktrees/WorkHub/r14-drive-rollback	r14/drive-rollback-parity
/Users/apple/.codex/worktrees/WorkHub/r14-escalated	r14/gap2-escalated-status
/Users/apple/.codex/worktrees/WorkHub/r14-feedback-curation	r14/feedback-curation
/Users/apple/.codex/worktrees/WorkHub/r14-feedback-desktop	r14/feedback-desktop
/Users/apple/.codex/worktrees/WorkHub/r14-feedback-server	r14/feedback-server
/Users/apple/.codex/worktrees/WorkHub/r14-feedback-web	r14/feedback-web
/Users/apple/.codex/worktrees/WorkHub/r14-gh-server	r14/gh-server
/Users/apple/.codex/worktrees/WorkHub/r14-gh-ui	r14/gh-ui
/Users/apple/.codex/worktrees/WorkHub/r14-gh-worker	r14/gh-worker
/Users/apple/.codex/worktrees/WorkHub/r14-guidance	r14/guidance-cluster
/Users/apple/.codex/worktrees/WorkHub/r14-mem-desktop	r14/mem-desktop
/Users/apple/.codex/worktrees/WorkHub/r14-mem-server	r14/mem-server
/Users/apple/.codex/worktrees/WorkHub/r14-mem-web	r14/mem-web
/Users/apple/.codex/worktrees/WorkHub/r14-mention-direct	r14/mention-direct-trigger
/Users/apple/.codex/worktrees/WorkHub/r14-notify-deeplink	r14/notify-deeplink
/Users/apple/.codex/worktrees/WorkHub/r14-oss	r14/oss
/Users/apple/.codex/worktrees/WorkHub/r14-p111	r14/p1-11-turn-queue
/Users/apple/.codex/worktrees/WorkHub/r14-perf	r14/perf
/Users/apple/.codex/worktrees/WorkHub/r14-replay	r14/replay-componentize
/Users/apple/.codex/worktrees/WorkHub/r14-risk-server	r14/risk-server
/Users/apple/.codex/worktrees/WorkHub/r14-risk-ui	r14/risk-ui
/Users/apple/.codex/worktrees/WorkHub/r14-search-core	r14/search-core
/Users/apple/.codex/worktrees/WorkHub/r14-search-spotlight	r14/search-spotlight
/Users/apple/.codex/worktrees/WorkHub/r14-search-web	r14/search-web
/Users/apple/.codex/worktrees/WorkHub/r14-web-avatars	r14/web-avatars
/Users/apple/.codex/worktrees/WorkHub/r14fix-server	r14fix/server
/Users/apple/.codex/worktrees/WorkHub/r14fix-shell-recon	r14fix/shell-recon
/Users/apple/.codex/worktrees/WorkHub/r14fix-spotlight-glass	r14fix/spotlight-glass
/Users/apple/.codex/worktrees/WorkHub/r14fix-workbench	r14fix/workbench
/Users/apple/Desktop/开发项目/wh-r15/a-pipeline	r15/a-pipeline
/Users/apple/Desktop/开发项目/wh-r15/a-wave2	r15/a-wave2
/Users/apple/Desktop/开发项目/wh-r15/a6	r15/a6-frontend
/Users/apple/Desktop/开发项目/wh-r15/b-dm	r15/b-dm-backend
/Users/apple/Desktop/开发项目/wh-r15/b-ui	r15/b-ui
/Users/apple/Desktop/开发项目/wh-r15/c-engine	r15/c-engine-patches
/Users/apple/Desktop/开发项目/wh-r15/cuu-toggle	r15/cuu-toggle
/Users/apple/Desktop/开发项目/wh-r15/d-proactive	r15/d-proactive
/Users/apple/Desktop/开发项目/wh-r15/d2	r15/d2-cuu-speak
/Users/apple/Desktop/开发项目/wh-r15/d4	r15/d4-cards
/Users/apple/Desktop/开发项目/wh-r15/e1	r15/e1-timeline
/Users/apple/Desktop/开发项目/wh-r15/e2	r15/e2-gantt
/Users/apple/Desktop/开发项目/wh-r15/e3	r15/e3-planner
/Users/apple/Desktop/开发项目/wh-r15/f-care	r15/f-care
/Users/apple/Desktop/开发项目/wh-r15/fix-dep	r15/fix-events-dep
/Users/apple/Desktop/开发项目/wh-r15/g-desktop	r15/g-desktop
/Users/apple/Desktop/开发项目/wh-r15/g-web	r15/g-web
/Users/apple/Desktop/开发项目/wh-r15/g1-members	r17/g1-members
/Users/apple/Desktop/开发项目/wh-r15/g2-inbox-events	r17/g2-inbox-events
/Users/apple/Desktop/开发项目/wh-r15/g3-army	r17/g3-army
/Users/apple/Desktop/开发项目/wh-r15/g4-wiring	r17/g4-wiring
/Users/apple/Desktop/开发项目/wh-r15/g5-ux	r17/g5-ux
/Users/apple/Desktop/开发项目/wh-r15/h1-web	r18/h1-web-members
/Users/apple/Desktop/开发项目/wh-r15/h3-smoke	r18/h3-loop2-smoke
/Users/apple/Desktop/开发项目/wh-r15/hotkey	r15/hotkey
/Users/apple/Desktop/开发项目/wh-r15/loop2	r15/loop2-phase0
/Users/apple/Desktop/开发项目/wh-r15/loop2p1	r15/loop2-phase1
/Users/apple/Desktop/开发项目/wh-r15/loop2p2	r15/loop2-phase2
/Users/apple/Desktop/开发项目/wh-r15/loop2p3	r15/loop2-phase3
/Users/apple/Desktop/开发项目/wh-r15/loop2p4	r15/loop2-phase4
/Users/apple/Desktop/开发项目/wh-r15/r19-doc	r19/gap-review
/Users/apple/Desktop/开发项目/wh-r15/w1-chat	r16/w1-chat-stream
/Users/apple/Desktop/开发项目/wh-r15/w2-kanban	r16/w2-kanban-schedule
/Users/apple/Desktop/开发项目/wh-r15/w3-editor	r16/w3-files-editor
/Users/apple/Desktop/开发项目/wh-r15/w4a-instr	r16/w4a-instructions
/Users/apple/Desktop/开发项目/wh-r15/w4b1	r16/w4b1-instructions-ui
/Users/apple/Desktop/开发项目/wh-r15/w4b2	r16/w4b2-conversation-tabs
/Users/apple/Desktop/开发项目/wh-r15/wb-inbox	r15/wb-inbox
/Users/apple/Desktop/开发项目/wh-r15/web-mirror	r15/web-mirror
EOF

echo "===== 第三步：删除 3 个 detached 且内容已被 origin/main 完全吸收的工位 ====="
for wt_path in \
  "/Users/apple/.codex/worktrees/WorkHub/r14-full-review-20260715" \
  "/Users/apple/Desktop/开发项目/WorkHub/.claude/worktrees/nervous-easley-b9f617" \
  "/Users/apple/Desktop/开发项目/WorkHub/.claude/worktrees/vigorous-ritchie-6062c2"
do
  if [ -d "$wt_path" ]; then
    echo "-- 删除工位(detached): $wt_path"
    git worktree remove "$wt_path"
  else
    echo "-- 跳过(路径已不存在): $wt_path"
  fi
done

echo "===== 第四步：删除 64 个「已合并+无工位占用」的本地分支 ====="
while read -r b; do
  [ -z "$b" ] && continue
  git branch -d "$b" 2>&1 || echo "   (分支 $b 删除失败，可能仍有未合并内容，请人工核实)"
done <<'EOF'
claude/agitated-bose-7ad50e
claude/ecstatic-yalow-6d7cc0
claude/lucid-wilbur-363a8c
claude/nervous-easley-b9f617
claude/vigorous-ritchie-6062c2
codex/r11-release-hardening-loop
codex/r9-codex-handoff
codex/r9-stage-a-main-safe
codex/r9-stage-b-rework
r12/acceptance-server-fixes
r12/batch1-frontend
r12/batch2-chat
r12/batch3-server
r12/batch4a-turns
r12/batch4b-outputs
r12/batch5-server-read
r12/batch6-drive
r12/batch7-cuu
r12/batch8-hardening
r12/final-turns-wiring
r12/fix-actioncard-buttons
r12/mode-popover
r12/workbench-full
r13/4c-cuu-tools
r13/fix-item-settlement
r13/g1-small-groups
r13/h1-hardening
r13/new-batches-design
r13/p1-army-panel
r13/p2-decision-loop
r13/p3-settings
r13/p4-trust-chain
r13/s1-spotlight-ai
r13/s2-async-cuu
r13/s3-personal-space
r13/v1-light-glass
r13/v2-window-craft
worktree-agent-a0265783ada8274f7
worktree-agent-a3504c71388a003eb
worktree-agent-a417d235244ed21a5
worktree-agent-a44f419c31a39babc
worktree-agent-a515589a75aa1f026
worktree-agent-a6196547d594bf066
worktree-agent-a6346e7575f14a423
worktree-agent-a6a28440f7304cd3d
worktree-agent-a80d00637b44ab2ad
worktree-agent-a87db038e60dd8021
worktree-agent-a88d4c146e7128e5b
worktree-agent-a90ccf967f7d76692
worktree-agent-a9257afb0bb5a2243
worktree-agent-a99feb7ea787bda4c
worktree-agent-a9d17716206d07efa
worktree-agent-aa31c555f9a105ace
worktree-agent-aaa93eabbe1d67738
worktree-agent-aac63847fa6b6bc17
worktree-agent-ab22bf17beb70c1ae
worktree-agent-ad1d00b75bf13ab6f
worktree-agent-ad4c93536b81fa5b7
worktree-agent-ada6f240fd7802a7a
worktree-agent-ade07d24b58751bd9
worktree-agent-ae45bf64eeedf9b1f
worktree-agent-af8e9d1d6564a7e14
worktree-agent-af93e829d0f81ddb9
worktree-agent-afa40bd6d78aa58e8
EOF

echo "===== 第五步（仅提醒，不自动执行）：r15/wave1 已合并但有 43 处未提交改动 ====="
echo "请手动执行: git -C \"/Users/apple/Desktop/开发项目/wh-r15/wave1\" status --short  # 看一眼内容"
echo "确认无价值后手动执行: git worktree remove --force \"/Users/apple/Desktop/开发项目/wh-r15/wave1\" && git branch -d r15/wave1"

echo "===== 完成 ====="
git worktree list
echo "剩余本地分支数:"
git branch | wc -l
```

```bash
# 可选：远端分支清理（写操作，影响共享仓库，默认不建议随主脚本一起跑）
# 以下 13 个远端分支已确认合并进 origin/main，如需清理请自行逐条执行并确认协作者无人还依赖：
#   git push origin --delete codex/r9-codex-handoff
#   git push origin --delete codex/r9-stage-a-main-safe
#   git push origin --delete codex/r9-stage-b-rework
#   git push origin --delete fix/r21-review-hardening
#   git push origin --delete r12/workbench-full
#   git push origin --delete r15/wave1
#   git push origin --delete r18/h1-web-members
#   git push origin --delete r19/gap-review
#   git push origin --delete r20/wave1
#   git push origin --delete r20/wave2
#   git push origin --delete r20/wave3
#   git push origin --delete r20/wave4
#   git push origin --delete r20/wave5
# 不要删：origin/r23/land-0820-review-fix-batch（活跃分支，见第 0 节）、
#        origin/codex/r9-stage-a-batch2-5-fixes / origin/codex/r9-stage-a-desktop-validation / origin/r14/test-infra
#        （对应开放 PR #2/#4/#7，先按第 3 节处置 PR，PR 关闭或合并后这三个远端分支才谈得上删）
```

---

## 侦察方法留痕（供复核）

- worktree 扫描脚本与中间数据：`/private/tmp/claude-501/-Users-apple-Desktop------WorkHub/5c486431-85bb-4b0b-b28b-50f0c3746acc/scratchpad/scan-worktrees.sh`、`worktree-scan-results.tsv`（87 行全量数据，含每个工位的 merged/unique_commits/last_date/last_subject/uncommitted_count/prunable 字段）。
- 分支合并状态原始数据：`merged-branches.txt`（145 个已合并本地分支）、`truly-unmerged.txt`（9 个未合并本地分支）、`branches-with-worktree.txt`（83 个被工位占用的分支）、`merged-no-worktree.txt`（64 个可直接删的分支）。
- 所有判定均基于 `git merge-base`/`git rev-list --count`/`git cherry` 的组合：`rev-list --count origin/main..<ref>` 判断"是否有独有提交及数量"，`git cherry` 进一步区分"独有提交是否只是等价 patch 已经用别的 commit hash 落地"（`-` 前缀）还是"真正从未落地"（`+` 前缀）。
