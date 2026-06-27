# R9 · 记忆库:三层模型与冲突归并

> 这是整套 R9 最难、也最值得前置设计的一块。**隔离不难,协调难。** 本文给出三层记忆模型、读写边界、以及当多个子 agent 的记忆打架时的归并纪律——尽量复用 WorkHub 已有的 P-COLLAB 合并原语,不重造。

---

## 0. 现状:记忆会「覆盖」,不会「归并」

盘点结论(证据):

- **user_memories**(`services/user-memory.ts:76`、`schema/core.ts:1386`):三类 `preference(0.5)/correction(0.9)/recurring_context`,unique index 在 `(userId, category, key)`,**upsert 直接覆盖**。注入时 top-5 按 confidence×recency,带 `<user_memory>` 围栏 + 反注入中和。
- **team_skills**(`team-skill.ts`):workspace 级,one-active-per-key,promote 用 advisory lock 串行——**技能层有版本与原子性,记忆层没有**。
- **冲突归并能力存在,但不在记忆里**:P-COLLAB 的 base-snapshot / diff3 / rebase 只用在 `proposals` 和 `accepted_deliverable_changes`(`services/proposals.ts` 的 ai_fusion),**user_memories 没复用它**。

**致命缺口**(盘点原话):当两个 run 学到矛盾偏好(如「只要 PDF」vs「偏好 XLSX」),`(userId, category, key)` 上的 upsert **直接覆盖**,没有 diff3、没有 base 快照、没有冲突提议。军团把这个问题放大 N 倍——N 个子 agent 同时写记忆,后写覆盖先写,记忆会腐烂、相互矛盾、stale。

---

## 1. 三层记忆模型

R9 把记忆切成三层,**每层有明确的作用域、写者、信任度、冲突策略**:

| 层 | 名称 | 作用域 | 谁写 | 信任度 | 冲突策略 | 现状载体 |
|---|---|---|---|---|---|---|
| **L1** | 私有记忆(per-module) | 单个子 agent / 单条 run 树 | 该子 agent 自己 | 低(局部、易错) | 隔离即可,不外泄 | **新建** `agent_memory(agent_context_id)` |
| **L2** | 共享治理记忆(governance) | 工作区 / 任务计划级 | meta-planner + 人确认的纠错 | 高(策略级) | **diff3 归并 + 冲突提议** | 扩展 user_memories(correction)+ 新 team_memories |
| **L3** | 收割技能记忆(harvested) | 工作区 | 夜间 curation(蒸馏/精炼) | 中→高(经验证) | 已有:版本 + advisory lock | **复用** team_skills(K1/K2/K3) |

**读写边界(铁律):**
- 子 agent **读** L1(自己的)+ L2(治理)+ L3(技能);**只写 L1**。
- L1 → L2 的晋升,**必须过一道门**:meta-planner 聚合 + LLM-judge 校验 + 高置信或人确认。子 agent 不能直接往 L2 写。
- L2 → L3 的固化,走现有夜间 curation(已实现)。
- **方向单一**:L1 私有不互相可见(agent-for-task-X 的记忆对 agent-for-task-Y 不可见),避免一个子 agent 的局部错误污染全军。

这条「只写最低层,晋升才上探」的纪律,直接照搬 WorkHub 已验证的提议→审批→合并哲学到记忆域:**记忆改动也不悄悄写进「生产记忆」(L2/L3)。**

---

## 2. 冲突归并:把 P-COLLAB 搬到记忆层

L2 是唯一需要归并的层(L1 隔离、L3 已有串行)。复用 P-COLLAB 三件原语:

### 2.1 三路归并(diff3)
当子 agent A 和 B 都想改同一条 L2 记忆 `key=delivery_format`:

```
            base(祖先快照,上次 L2 已采纳的值)
           /                                  \
   A: "PDF only"                          B: "XLSX preferred"
           \                                  /
            └──────── diff3 归并 ────────┘
                         │
         ┌───────────────┴────────────────┐
   无交叠 → 自动合并                可调和?置信度差≥阈值 → 高者胜
                                    不可调和 → 生成「记忆冲突提议」上 attention
```

- **base 快照**:每条 L2 记忆存 `base_version`(`agent_memory.base_version`),晋升时记录祖先。复用 `accepted_deliverable_changes.manifestChangeJson` 的快照模式。
- **diff3**:复用 proposals 的 ai_fusion 归并器(`services/proposals.ts` 的 merge-fusion-candidates),输入从「文档段落」换成「记忆条目」。
- **不可调和** → 不覆盖,生成 `memory_conflict` 类型的 AttentionItem,带两个候选值 + 来源子 agent + 理由,让人「对一下底稿再采纳」(P-COLLAB 的 rebase 话术)。

### 2.2 冲突检测触发条件
- 同 `(scope, key)` 上,新写值与 L2 现值语义相反,**且**两者置信度差 < 阈值(都很自信 → 真冲突,不能简单高者胜)。
- 置信度差 ≥ 阈值 → 高者直接胜(低置信局部观察让位于高置信治理记忆)。

### 2.3 版本史
`agent_memory_versions` 记录每次晋升/归并的 (base, incoming, result, resolver),支撑回滚与审计——和 team_skills 的版本史同构,和 WorkHub「每处改动留得下快照可回滚」一致。

---

## 3. 记忆的注入与收割(接现有管线)

**注入**(读路径,扩展现有 `UserMemoryContextProvider`):
- 现:`listForUser()` top-5 by confidence×recency,`<user_memory>` 围栏。
- R9:provider 加 `agent_context_id` 参数 → 拼装 L1(本子 agent)+ L2(治理)+ L3(技能 catalog),分别围栏、分别标信任度(L2 用「策略/请遵循」措辞,L1 用「参考/局部观察」措辞)。**复用** `neutralizeFenceTags` 反注入。

**收割**(写路径):
- 子 agent 跑完 → 局部学习写 L1(`extractPreferenceMemory`,r6-m1 已设计未接线,在 `agent-runner.ts` finalize 块补)。
- 复盘/纠错(review `request_changes`,置信 0.9)→ 走 L1→L2 晋升门(`correctionFromReview` 已实现,扩展成晋升而非直接 upsert)。
- 夜间 → L2 高频模式蒸馏进 L3 team_skills(已实现)。

---

## 4. 多租户与隔离(安全前置)

- `user_memories.workspace_id` 现为 nullable 且 v0 全局存(workspace_id=null)。R9 **必须**填上并按租户过滤——`ListUserMemoriesOptions` 与 `listForUser()` 加 workspace_id 参数。
- L1 私有记忆钉死 `(workspace_id, agent_context_id)`,跨工作区绝不可见(R3 审查的跨工作区写洞,在记忆层会更隐蔽)。

---

## 5. 落地切片(对应 03 路线图的 R9.3)

1. 建 `agent_memory` + `agent_memory_versions` 表,L1 隔离先跑通(子 agent 各写各的,互不可见)。
2. 接 `extractPreferenceMemory` → L1 写入(补 finalize 钩子)。
3. L1→L2 晋升门:meta-planner 聚合 + judge 校验 + 高置信自动 / 否则人确认。
4. L2 冲突归并:搬 ai_fusion diff3,加冲突检测,不可调和 → `memory_conflict` AttentionItem。
5. 填 workspace_id 多租户隔离 + 回归测试。

**验收**:构造两个子 agent 写矛盾 L2 记忆 → 系统不静默覆盖,而是 diff3 自动合并(可调和)或弹冲突提议(不可调和);真 PG 并发下不丢更新(对照 P-COLLAB 的 pilot-stack-smoke 是唯一真库合并门)。

---

## 6. 一句话

> WorkHub 已经有「记忆」(user_memories 三类 + team_skills)和「归并原语」(P-COLLAB diff3),但**两者没接通**——记忆只会覆盖。R9 记忆库的全部工作,就是**把三层作用域切清楚、只许写最低层、晋升才上探,并把已有的 diff3 从 proposal 搬到 memory**。不前置设计这条,军团越大记忆烂得越快。
