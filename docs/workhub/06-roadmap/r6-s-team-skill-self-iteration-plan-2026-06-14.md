---
module: skill-curation
layer: agent-runtime
status: done
owner: ai-labor-loop
date: 2026-06-14
depends_on:
  - r6-compounding-ai-labor-plan-2026-06-14.md
  - p0-foundation (f8-agent-engine-core, f10-audit-snapshot-rollback)
---

# WorkHub 团队技能自迭代规划(TEAM-scoped Autonomous Skill Self-Iteration)

> **交付记录(2026-06-14, status=done):** MVP 已实现并全量绿。与本规划的差异：
> - 迁移号 **0013**（非 0012；0012 已被 M1 user_memories 占用）→ `packages/db/migrations/0013_shallow_norrin_radd.sql`，`team_skills` 表已上真实库（18 列 / 4 索引 / 2 外键）。
> - 表数门 F02 47→**49**（M1 +1、S2 +1）。
> - schema `teamSkills`（含 `source_run_id` / `deprecated_at`，回滚配套）→ `packages/db/src/schema/core.ts`；repo `createTeamSkillRepository`（promote 一 key 一 active + 版本递增、rollbackTo、deprecate、信号查询）→ `packages/db/src/repositories/team-skill.ts`。
> - 契约 `packages/contracts/src/domain/team-skill.ts`；自验/蒸馏纯函数 `apps/api/src/services/skill-curation.ts`；调度器 `apps/api/src/workers/agent-skill-curation.ts`（copy recovery 模板、idle 闸门、可注入依赖）。
> - **合并视图注入**：`createSkillTool(root, teamContent)` FS 优先、团队回落；`defaultWorkerSystemPrompt(appendix)` 追加团队技能目录；per-run provider `getDefaultTeamSkillContextProvider`（work_item→workspace→active 团队技能），已对真实库与真实 work_item 验证「蒸馏技能可达 worker」。
> - **默认关闭**：`AGENT_RUN_SKILL_CURATION_ENABLED=false`（server.ts 闸门），开启才跑 24h 闲时蒸馏，避免 CI/prod 误发 LLM 调用。
> - 测试：tools 11（含团队 load_skill）/ db 15（F02=49）/ api 161（+9 curation 单测）/ 全量 `pnpm test` exit 0 / 70 步 web smoke 绿。SQL 信号查询（accepted/escalation join）已对真实 PG 验证可编译返回。
> - 暂缓到后续：团队技能设置页 UI（Phase 2）、dry-run 沙箱执行、agentSteps 工具频率信号（列不确定，先不接）。


> **决策(D-1):** NO 人工预审 → AI **全自主蒸馏·晋升**;人类仅事后 kill-switch/rollback(团队设置)。
> 
> **决策(D-2):** 技能蒸馏源:
> - ✓ 接受的交付物变更(正样本,用户审批即可用)
> - ✓ Agent 动作模式(使用频率/工具调用序列/输出质量)  
> - ✓ 提议/审核记录(高质量反馈)
> - ✓ 升级事件(缺技能信号)
>
> **决策(D-3):** 技能版本=工作空间级(非全局),启用时默认 active,关闭时 deprecated;允许多版本并存(via 版本号),旧版本同工作空间内可激活。
>
> **此规划**: TS-first 实现,依赖 F10(审计/快照)的基础。迁移 0012。

---

## 开工前必读

**核心文件(带行号)**

| 文件 | 行号 | 内容 |
|------|------|------|
| `/packages/tools/src/skills.ts` | 36–65 | `listSkills()` 已支持自定义 `root`,缓存逻辑 |
| `/packages/tools/src/skills.ts` | 67–76 | `loadSkillContent()` 已支持 path-safe 校验(`/^[a-z0-9-]+$/`) |
| `/packages/tools/src/skills.ts` | 78–85 | `skillCatalogForPrompt()` 生成 system prompt 清单 |
| `/packages/tools/src/skills.ts` | 87–109 | `createSkillTool()` 注入工人 LLM 调用,fail-closed |
| `/apps/api/src/workers/agent-runner.ts` | 336 | `createSkillTool()` 注册到工具库 |
| `/apps/api/src/workers/agent-runner.ts` | 423–437 | `defaultWorkerSystemPrompt()` 调用 `skillCatalogForPrompt()` |
| `/apps/api/src/workers/agent-run-recovery.ts` | 12–25 | `AgentRunRecoveryScheduler` type 与 stats() 接口 |
| `/apps/api/src/workers/agent-run-recovery.ts` | 46–89 | `tick()` 实现模板:running flag + try-catch + stats 更新 |
| `/packages/db/src/schema/core.ts` | 85–100 | `workspaces` 表(团队级别) |
| `/packages/db/src/schema/core.ts` | 162–183 | `backgroundJobs` 表(kind 字段用于 'skill_curation') |
| `/packages/db/src/schema/core.ts` | 772–810 | `acceptedDeliverableChanges` 表(正样本源) |
| `/packages/db/src/schema/core.ts` | 933–953 | `agentSteps` 表(动作模式源) |
| `/packages/db/src/schema/core.ts` | 726–752 | `proposals` 表(审核记录源) |
| `/packages/db/src/schema/core.ts` | 754–770 | `reviews` 表(高质量反馈) |
| `/packages/db/src/schema/core.ts` | 1052–1073 | `confidenceRecords` 表(置信度源) |
| `/packages/db/src/schema/core.ts` | 1075–1095 | `escalationEvents` 表(缺技能信号) |
| `/packages/db/src/schema/core.ts` | 1168–1194 | `auditLogs` 表(AI 操作审计) |
| `/packages/tools/src/tools.test.ts` | 105–124 | 7 项预设技能列表(需保持绿) |
| `/packages/tools/skills/*/SKILL.md` | — | 7 个现有 SKILL.md 模板(格式与 frontmatter) |

**现有技能(预设不变)**

```
✓ code-script          (编写代码/脚本)
✓ data-analysis        (数据处理与分析)
✓ docx-document        (Word 文档创作)
✓ markdown-report      (Markdown 报告)
✓ pptx-deck            (PowerPoint 演示)
✓ stat-charts          (统计图表)
✓ xlsx-spreadsheet     (Excel 电子表格)
```

---

## 目标

**送出什么:**
- 每工作空间独有的 `team_skills` 表(workspace_id + skill_key + version 唯一)
- 日间空闲时(每 24h 一次,work_items 无活跃 run)自动蒸馏 LLM 调用一次,产生 SKILL.md 草稿
- 草稿自验(格式/lint + dry-run)通过后自动激活(status=active),版本递增
- 低分/失败的蒸馏结果放弃并记录理由到 audit_logs
- 团队成员在设置页面可查看、禁用、回滚任何版本的团队技能
- FS ∪ DB(team active) 合并视图注入工人 system prompt,隐藏版本号
- `tools.test.ts` 的默认行为(7 项预设)不变,新的 DB-load 在 root 参数切换时触发

**最小可用片(MVP):**
1. 迁移 0012:创建 `team_skills` 表 + 索引
2. 编写 `AgentRunSkillCurationScheduler` 类(copy `AgentRunRecoveryScheduler` 模板)
3. 在 agent-runner 初始化时 `.start()`
4. 提议/审核通过后自动触发 `recordLearnOpportunity()`(异步入队)
5. 页面 UI 显示团队技能列表(另需 API route,不在此规划范围)

---

## 数据流与契约

### 3.1 `team_skills` 表结构

```sql
CREATE TABLE "team_skills" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces" ON DELETE CASCADE,
  "skill_key" varchar(64) NOT NULL,  -- e.g. "monthly-report", "data-viz-template"
  "name" varchar(128) NOT NULL,
  "when_to_use" text NOT NULL,       -- 一句话描述(从 system prompt catalog)
  "content_md" text NOT NULL,        -- 完整 SKILL.md 内容
  "status" varchar(16) NOT NULL DEFAULT 'draft',  -- 'draft'|'active'|'deprecated'
  "version" integer NOT NULL DEFAULT 1,
  "source_kind" varchar(16) NOT NULL, -- 'distilled'|'authored'(未来扩展)
  "created_by_kind" varchar(16) NOT NULL,  -- 'ai'|'human'(未来)
  "confidence_score" double precision,  -- 0.0–1.0,用于排序/筛选
  "sample_count" integer DEFAULT 0,    -- 蒸馏依据的样本数
  "samples_json" jsonb DEFAULT '{}',   -- { accepted_count, agent_steps_count, reviews_positive_count, escalation_reasons: [...] }
  "deprecated_reason" text,            -- 为何弃用(低分/替代)
  "created_at" timestamptz NOT NULL DEFAULT NOW(),
  "updated_at" timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX "team_skills_workspace_key_version_uq" 
  ON "team_skills"("workspace_id", "skill_key", "version");
CREATE INDEX "team_skills_workspace_status_idx" 
  ON "team_skills"("workspace_id", "status");
CREATE INDEX "team_skills_created_at_idx" ON "team_skills"("created_at");
```

### 3.2 蒸馏数据源与采样逻辑

**源 1: acceptedDeliverableChanges(正样本)**
```sql
SELECT DISTINCT 
  adc.manifest_change_json->>'deliverable_type' as deliverable_type,
  adc.manifest_change_json->'metadata'->>'skill_used' as skill_hint,
  COUNT(*) as count
FROM accepted_deliverable_changes adc
  JOIN work_items wi ON adc.work_item_id = wi.id
WHERE wi.workspace_id = $1
  AND adc.created_at > NOW() - INTERVAL '7 days'
  AND adc.manifest_change_json->>'deliverable_type' IN (
    'docx-document', 'markdown-report', 'pptx-deck', 'xlsx-spreadsheet', 'stat-charts', 'data-analysis', 'code-script'
  )
GROUP BY 1, 2
ORDER BY count DESC;
```

**源 2: agentSteps(动作频率)**
```sql
SELECT DISTINCT
  ast.tool_name,
  COUNT(*) as invocation_count,
  ROUND(AVG(LENGTH(ast.output_excerpt)::numeric), 0) as avg_output_len
FROM agent_steps ast
  JOIN agent_runs ar ON ast.agent_run_id = ar.id
WHERE ar.workspace_id = $1
  AND ast.created_at > NOW() - INTERVAL '7 days'
GROUP BY ast.tool_name
ORDER BY invocation_count DESC
LIMIT 30;
```

**源 3: 高质量反馈(reviews + confidence)**
```sql
SELECT DISTINCT
  p.title,
  COUNT(CASE WHEN r.decision = 'approved' THEN 1 END) as approve_count,
  COUNT(CASE WHEN r.decision = 'request_changes' THEN 1 END) as change_count,
  cr.grade,
  cr.confidence_score
FROM proposals p
  JOIN reviews r ON p.id = r.proposal_id
  LEFT JOIN confidence_records cr ON p.confidence_id = cr.id
WHERE p.work_item_id IN (
  SELECT id FROM work_items WHERE workspace_id = $1
)
  AND p.reviewed_at > NOW() - INTERVAL '7 days'
  AND r.decision IN ('approved', 'request_changes')
GROUP BY p.id, cr.grade, cr.confidence_score
HAVING COUNT(*) >= 2
ORDER BY cr.confidence_score DESC NULLS LAST;
```

**源 4: 缺技能信号(escalationEvents)**
```sql
SELECT DISTINCT
  ee.reason_md,
  ee.trigger,
  COUNT(*) as freq
FROM escalation_events ee
  JOIN agent_runs ar ON ee.agent_run_id = ar.id
WHERE ar.workspace_id = $1
  AND ee.created_at > NOW() - INTERVAL '7 days'
  AND ee.reason_md ~* '(缺少|需要|不会|未支持).*技能'
GROUP BY ee.reason_md, ee.trigger
ORDER BY freq DESC;
```

### 3.3 蒸馏 LLM 调用契约

**输入:**
```json
{
  "workspace_id": "uuid",
  "analysis": {
    "top_accepted_deliverables": [
      { "type": "docx-document", "count": 15, "skill_hint": "contract-template" }
    ],
    "top_tools": [
      { "tool": "write_file", "invocation_count": 142, "avg_output_len": 2048 }
    ],
    "high_confidence_feedback": [
      { "proposal_title": "Q2 财报", "approve_count": 3, "change_count": 0, "confidence_score": 0.92 }
    ],
    "unmet_needs": [
      { "reason": "缺少 SQL 数据导出技能", "trigger": "escalation", "frequency": 3 }
    ]
  },
  "existing_skills": [ "code-script", "data-analysis", ... ]
}
```

**LLM 调用(1 round,fail-closed)**
```
角色: 工作空间技能策展人

任务: 根据这个工作空间最近 7 天的工作数据,提议新增或改进 1-3 项团队技能。

数据来源:
- 接受的交付物: 按类型和频率统计
- Agent 动作: 最常用工具与输出尺度
- 审核反馈: 高质量建议与置信度
- 缺口信号: 升级事件中提到的未支持功能

提议要求:
1. 每项技能都要对应至少 5 个具体样本(已接受交付物或高分提议)
2. skill_key 必须全小写、连字符分隔(e.g. "sql-export", "finance-report")
3. 不重复现有 7 项预设技能
4. 返回 SKILL.md frontmatter + 正文(遵循 packages/tools/skills/*/SKILL.md 格式)

输出格式(YAML + Markdown):
```
---
name: <技能名称>
when_to_use: <一句话,10–30 字>
description: <详细描述,50–200 字>
---

# <技能名称>

## 适用场景
...

## 示例...
```

失败准则(返回 null):
- 样本 < 5 个
- skill_key 重复或非法
- 内容格式错误
- 置信度无法评估

返回 JSON:
{
  "distilled_skills": [
    {
      "skill_key": "string",
      "name": "string",
      "when_to_use": "string",
      "content_md": "string (frontmatter + body)",
      "sample_count": int,
      "confidence_score": 0.0–1.0
    }
  ],
  "reason_if_none": "string (可选,解释为什么无新技能)"
}
```

### 3.4 自验与提升逻辑

**前置条件:**
```
IF sample_count < 5:
  → discard, record reason="insufficient samples"
  
IF NOT frontmatter_valid(content_md):
  → discard, record reason="invalid frontmatter"
  
IF NOT schema_lint(content_md):
  → discard, record reason="failed schema validation"
  
IF confidence_score < THRESHOLD (default 0.70):
  → discard, record reason="low confidence"
```

**Dry-Run(可选优化):**
```
1. 将 content_md 临时写入 /tmp/skill_test_{uuid}.md
2. 在空 workdir 中运行一次 load_skill(skill_key) + parse frontmatter
3. 检查 listSkills([temp_root]) 是否能解析
4. 清理临时文件

失败 → discard, record reason="dry-run failed"
成功 → proceed to promotion
```

**晋升(自动):**
```sql
INSERT INTO team_skills (
  workspace_id, skill_key, name, when_to_use, content_md,
  status, version, source_kind, created_by_kind, 
  confidence_score, sample_count, samples_json
) VALUES (...)
ON CONFLICT (workspace_id, skill_key) DO UPDATE SET
  version = team_skills.version + 1,
  status = 'active',
  content_md = EXCLUDED.content_md,
  updated_at = NOW(),
  deprecated_reason = NULL;

INSERT INTO audit_logs (
  workspace_id, actor_kind, entity_type, entity_id, action, detail_json, created_at
) VALUES (
  $workspace_id, 'ai', 'team_skill', $skill_id,
  'distilled_and_promoted',
  { distilled_from: [...sources], confidence: 0.85, version: 2 },
  NOW()
);
```

---

## 施工顺序

### 1. 迁移 0012:创建 team_skills 表

**文件:** `/packages/db/migrations/0012_team_skills_foundation.sql`

```sql
-- 创建 team_skills 表
CREATE TABLE "team_skills" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "skill_key" varchar(64) NOT NULL,
  "name" varchar(128) NOT NULL,
  "when_to_use" text NOT NULL,
  "content_md" text NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'draft',
  "version" integer NOT NULL DEFAULT 1,
  "source_kind" varchar(16) NOT NULL DEFAULT 'distilled',
  "created_by_kind" varchar(16) NOT NULL DEFAULT 'ai',
  "confidence_score" double precision,
  "sample_count" integer NOT NULL DEFAULT 0,
  "samples_json" jsonb NOT NULL DEFAULT '{}',
  "deprecated_reason" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "team_skills_workspace_key_version_uq" 
  ON "team_skills"("workspace_id", "skill_key", "version");
CREATE INDEX "team_skills_workspace_status_idx" 
  ON "team_skills"("workspace_id", "status");
CREATE INDEX "team_skills_created_at_idx" 
  ON "team_skills"("created_at");

-- 更新 backgroundJobs:kind 列允许 'skill_curation'(已有表,仅文档)
-- 不需变更 schema,已是 varchar(64)
```

**验证:**
```bash
npm run db:migrate
# 或
drizzle-kit push --dialect pg
```

### 2. 编写 Drizzle schema 定义

**文件:** `/packages/db/src/schema/core.ts` 末尾(搭 `workHubTables`)

```typescript
export const teamSkills = pgTable(
  "team_skills",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    skillKey: varchar("skill_key", { length: 64 }).notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    whenToUse: text("when_to_use").notNull(),
    contentMd: text("content_md").notNull(),
    status: varchar("status", { length: 16 }).notNull().default("draft"),
    version: integer("version").notNull().default(1),
    sourceKind: varchar("source_kind", { length: 16 }).notNull().default("distilled"),
    createdByKind: varchar("created_by_kind", { length: 16 }).notNull().default("ai"),
    confidenceScore: doublePrecision("confidence_score"),
    sampleCount: integer("sample_count").notNull().default(0),
    samplesJson: jsonb("samples_json").$type<JsonObject>().notNull().default({}),
    deprecatedReason: text("deprecated_reason"),
    ...timestamps()
  },
  (table) => [
    uniqueIndex("team_skills_workspace_key_version_uq").on(table.workspaceId, table.skillKey, table.version),
    index("team_skills_workspace_status_idx").on(table.workspaceId, table.status),
    index("team_skills_created_at_idx").on(table.createdAt)
  ]
);
```

**更新 workHubTables 导出:**
```typescript
export const workHubTables = {
  users,
  /* ... existing ... */
  teamSkills,
  // ...
};
```

**验证:**
```bash
npm run db:check  # Drizzle type check
npm run test      # tools.test.ts 仍为绿
```

### 3. 扩展 skills.ts:支持 DB-sourced 加载

**文件:** `/packages/tools/src/skills.ts`

新增函数(导出):
```typescript
import type { WorkHubDatabaseClient } from "@workhub/db";

/**
 * 从工作空间的 team_skills 表加载活跃技能。
 * 不含预设技能,仅团队自蒸馏。
 */
export async function loadTeamSkills(
  db: WorkHubDatabaseClient,
  workspaceId: string
): Promise<SkillMeta[]> {
  const rows = await db.query.teamSkills.findMany({
    where: (table, { eq, and }) =>
      and(
        eq(table.workspaceId, workspaceId),
        eq(table.status, "active")
      )
  });
  
  return rows.map((row) => ({
    id: row.skillKey,
    name: row.name,
    description: row.whenToUse,
    whenToUse: row.whenToUse
  }));
}

/**
 * 合并视图:FS 预设 + DB team skills(不含版本号)
 */
export async function listSkillsMerged(
  root = skillsRoot,
  db?: WorkHubDatabaseClient,
  workspaceId?: string
): Promise<SkillMeta[]> {
  const fsSkills = listSkills(root);
  
  if (!db || !workspaceId) {
    return fsSkills;
  }
  
  const teamSkills = await loadTeamSkills(db, workspaceId);
  // 合并(团队技能优先覆盖同 id 的预设,但默认不会重名)
  const merged = [...fsSkills, ...teamSkills];
  
  // 按 id 排序,去重(团队优先)
  const seen = new Set<string>();
  return merged.filter((skill) => {
    if (seen.has(skill.id)) {
      return false;
    }
    seen.add(skill.id);
    return true;
  }).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * 加载单项技能(FS 或 DB)
 */
export async function loadSkillContentMerged(
  id: string,
  root = skillsRoot,
  db?: WorkHubDatabaseClient,
  workspaceId?: string
): Promise<string | undefined> {
  // 先试 FS
  const fsContent = loadSkillContent(id, root);
  if (fsContent) {
    return fsContent;
  }
  
  // 再试 DB(仅若提供了 workspaceId)
  if (!db || !workspaceId) {
    return undefined;
  }
  
  const rows = await db.query.teamSkills.findMany({
    where: (table, { eq, and }) =>
      and(
        eq(table.workspaceId, workspaceId),
        eq(table.skillKey, id),
        eq(table.status, "active")
      ),
    orderBy: (table) => desc(table.version),
    limit: 1
  });
  
  return rows[0]?.contentMd;
}
```

**验证:**
```bash
npm run test  # tools.test.ts 保持绿(无 db/workspaceId 时等同旧行为)
```

### 4. 编写 AgentRunSkillCurationScheduler

**文件:** `/apps/api/src/workers/agent-skill-curation.ts`(新建)

```typescript
import { settings } from "@workhub/config";
import { createDatabaseClient, type WorkHubDatabaseClient } from "@workhub/db";
import { getDefaultProviderRegistry, type ProviderRegistry } from "../services/provider-registry.js";
import type { AuditLogRepository } from "@workhub/db";

export type SkillCurationTickResult = {
  curated: number;
  promoted: number;
  discarded: number;
  started_at: string;
  finished_at: string;
};

export type AgentRunSkillCurationScheduler = {
  tick: () => Promise<SkillCurationTickResult>;
  start: () => void;
  stop: () => void;
  stats: () => {
    running: boolean;
    tick_count: number;
    curated_count: number;
    promoted_count: number;
    discarded_count: number;
    error_count: number;
    last_tick_at?: string;
    last_error_message?: string;
  };
};

export function createAgentRunSkillCurationScheduler(options: {
  db: WorkHubDatabaseClient;
  providerRegistry: ProviderRegistry;
  auditLog: AuditLogRepository;
  intervalMs?: number;
  workQueueIsIdle?: () => Promise<boolean>;
  now?: () => Date;
  onError?: (error: unknown) => void;
}): AgentRunSkillCurationScheduler {
  const intervalMs = options.intervalMs ?? (24 * 60 * 60 * 1000); // 24h default
  const now = options.now ?? (() => new Date());
  const workQueueIsIdle = options.workQueueIsIdle ?? (async () => true);
  
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  let tickCount = 0;
  let curatedCount = 0;
  let promotedCount = 0;
  let discardedCount = 0;
  let errorCount = 0;
  let lastTickAt: string | undefined;
  let lastErrorMessage: string | undefined;

  async function tick(): Promise<SkillCurationTickResult> {
    const startedAt = now();
    
    if (running) {
      return {
        curated: 0,
        promoted: 0,
        discarded: 0,
        started_at: startedAt.toISOString(),
        finished_at: startedAt.toISOString()
      };
    }

    running = true;
    let curated = 0;
    let promoted = 0;
    let discarded = 0;

    try {
      // 检查队列是否空闲(可选)
      const idle = await workQueueIsIdle?.();
      if (!idle) {
        console.log("WorkHub skill curation: work queue not idle, skipping this tick");
        return {
          curated: 0,
          promoted: 0,
          discarded: 0,
          started_at: startedAt.toISOString(),
          finished_at: startedAt.toISOString()
        };
      }

      // 遍历所有工作空间,对每个执行蒸馏
      const workspaces = await options.db.query.workspaces.findMany({
        where: (table) => isNull(table.deletedAt)
      });

      for (const workspace of workspaces) {
        try {
          const result = await curateSkillsForWorkspace(workspace.id);
          curated += 1;
          promoted += result.promoted;
          discarded += result.discarded;
        } catch (error) {
          console.warn(
            `Failed to curate skills for workspace ${workspace.id}:`,
            error instanceof Error ? error.message : String(error)
          );
          // 继续处理其他工作空间
        }
      }

      const finishedAt = now();
      tickCount += 1;
      curatedCount += curated;
      promotedCount += promoted;
      discardedCount += discarded;
      lastTickAt = finishedAt.toISOString();

      // 记录到 backgroundJobs 表(可选)
      if (curated > 0) {
        await options.db.insert(backgroundJobs).values({
          id: randomUUID(),
          kind: "skill_curation",
          status: "finished",
          message: `Curated ${curated} workspaces, promoted ${promoted}, discarded ${discarded}`,
          progressPercent: 100,
          createdByUserId: "00000000-0000-0000-0000-000000000000", // system actor
          startedAt: startedAt,
          finishedAt: finishedAt,
          createdAt: startedAt,
          updatedAt: finishedAt
        });
      }

      return {
        curated,
        promoted,
        discarded,
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString()
      };
    } catch (error) {
      errorCount += 1;
      lastErrorMessage = error instanceof Error ? error.message : String(error);
      options.onError?.(error);
      throw error;
    } finally {
      running = false;
    }
  }

  async function curateSkillsForWorkspace(
    workspaceId: string
  ): Promise<{ promoted: number; discarded: number }> {
    let promoted = 0;
    let discarded = 0;

    // 1. 收集蒸馏数据源
    const analysis = await analyzeWorkspaceActivity(workspaceId);

    // 2. 调用 LLM 蒸馏(fail-closed)
    const distilled = await distillSkillsViaLLM(analysis);

    // 3. 逐项自验与晋升
    for (const skill of distilled.distilled_skills || []) {
      const validationResult = validateAndPromoteSkill(
        workspaceId,
        skill
      );

      if (validationResult.ok) {
        promoted += 1;
        // 记录到 audit_logs
        await options.auditLog.insertAuditLog({
          workspaceId,
          actorKind: "ai",
          entityType: "team_skill",
          entityId: skill.skill_key,
          action: "distilled_and_promoted",
          detailJson: {
            version: 1,
            confidence: skill.confidence_score,
            sample_count: skill.sample_count
          }
        });
      } else {
        discarded += 1;
        await options.auditLog.insertAuditLog({
          workspaceId,
          actorKind: "ai",
          entityType: "team_skill",
          entityId: skill.skill_key,
          action: "distilled_but_discarded",
          detailJson: {
            reason: validationResult.reason
          }
        });
      }
    }

    return { promoted, discarded };
  }

  async function analyzeWorkspaceActivity(
    workspaceId: string
  ): Promise<SkillCurationAnalysis> {
    // SQL 查询(参见 §3.2)
    // 实现细节略(涉及数据库查询库调用)
    // 返回汇总分析对象
    return {
      workspace_id: workspaceId,
      analysis: {
        top_accepted_deliverables: [],
        top_tools: [],
        high_confidence_feedback: [],
        unmet_needs: []
      },
      existing_skills: ["code-script", "data-analysis", /* ... */]
    };
  }

  async function distillSkillsViaLLM(
    analysis: SkillCurationAnalysis
  ): Promise<DistilledSkillsResponse> {
    // 通过 providerRegistry 获取 client
    const client = options.providerRegistry.get(
      { id: "system", userId: "system", workItemId: "curation" },
      "system"
    );

    const response = await client.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: buildCurationPrompt(analysis)
        }
      ]
    });

    // 解析 LLM 响应(JSON)
    const content = response.content[0];
    if (content.type !== "text") {
      throw new Error("Expected text response from LLM");
    }

    try {
      return JSON.parse(content.text);
    } catch (error) {
      console.warn("Failed to parse skill curation LLM response:", error);
      return { distilled_skills: [] };
    }
  }

  function validateAndPromoteSkill(
    workspaceId: string,
    skill: DistilledSkill
  ): { ok: boolean; reason?: string } {
    // 前置检查
    if (!skill.sample_count || skill.sample_count < 5) {
      return { ok: false, reason: "insufficient_samples" };
    }

    if (!skill.confidence_score || skill.confidence_score < 0.7) {
      return { ok: false, reason: "low_confidence" };
    }

    if (!validateFrontmatter(skill.content_md)) {
      return { ok: false, reason: "invalid_frontmatter" };
    }

    if (!validateSchemasLint(skill.content_md)) {
      return { ok: false, reason: "failed_schema_validation" };
    }

    // Dry-run(可选)
    // ... (如上 §3.4)

    // 晋升
    try {
      const existingVersion = getLatestVersionInDB(
        workspaceId,
        skill.skill_key
      );
      const newVersion = (existingVersion || 0) + 1;

      insertTeamSkill({
        workspace_id: workspaceId,
        skill_key: skill.skill_key,
        name: skill.name,
        when_to_use: skill.when_to_use,
        content_md: skill.content_md,
        status: "active",
        version: newVersion,
        source_kind: "distilled",
        created_by_kind: "ai",
        confidence_score: skill.confidence_score,
        sample_count: skill.sample_count
      });

      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        reason: `database_error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  function start() {
    if (timer || intervalMs <= 0) {
      return;
    }
    timer = setInterval(() => {
      void tick().catch((error) => {
        console.warn("WorkHub skill curation tick failed:", error);
      });
    }, intervalMs);
    timer.unref?.();
  }

  function stop() {
    if (!timer) {
      return;
    }
    clearInterval(timer);
    timer = undefined;
  }

  return {
    tick,
    start,
    stop,
    stats: () => ({
      running,
      tick_count: tickCount,
      curated_count: curatedCount,
      promoted_count: promotedCount,
      discarded_count: discardedCount,
      error_count: errorCount,
      ...(lastTickAt ? { last_tick_at: lastTickAt } : {}),
      ...(lastErrorMessage ? { last_error_message: lastErrorMessage } : {})
    })
  };
}

let defaultScheduler: AgentRunSkillCurationScheduler | undefined;

export function getDefaultAgentRunSkillCurationScheduler() {
  defaultScheduler ??= createAgentRunSkillCurationScheduler({
    db: createDatabaseClient(),
    providerRegistry: getDefaultProviderRegistry(),
    auditLog: getDefaultAuditStores().auditLog,
    intervalMs: 24 * 60 * 60 * 1000
  });
  return defaultScheduler;
}
```

**类型定义**:
```typescript
type SkillCurationAnalysis = {
  workspace_id: string;
  analysis: {
    top_accepted_deliverables: Array<{ type: string; count: number; skill_hint?: string }>;
    top_tools: Array<{ tool: string; invocation_count: number; avg_output_len: number }>;
    high_confidence_feedback: Array<any>;
    unmet_needs: Array<any>;
  };
  existing_skills: string[];
};

type DistilledSkill = {
  skill_key: string;
  name: string;
  when_to_use: string;
  content_md: string;
  sample_count: number;
  confidence_score: number;
};

type DistilledSkillsResponse = {
  distilled_skills?: DistilledSkill[];
  reason_if_none?: string;
};
```

### 5. 在 agent-runner 初始化时启动调度器

**文件:** `/apps/api/src/workers/agent-runner.ts`

在 `createAgentQueue()` 返回前:
```typescript
// 启动技能蒸馏调度器(可选:仅在启用时)
if (settings.skillCuration?.enabled ?? false) {
  const curationScheduler = getDefaultAgentRunSkillCurationScheduler();
  curationScheduler.start();
  
  // 暴露 stats 端点供监控
  // (在 daemon 的 /admin/stats 路由中返回)
}
```

### 6. 注入 FS ∪ DB 合并视图到 system prompt

**文件:** `/apps/api/src/workers/agent-runner.ts` 中 `defaultWorkerSystemPrompt()`

修改:
```typescript
function defaultWorkerSystemPrompt(
  workspaceId?: string,
  db?: WorkHubDatabaseClient
) {
  return [
    "你是 WorkHub 的 AI 工人（默认劳动力）。人类是审批者：你的产出会进入\"提议→审批→合并\"流程，必须让非技术审阅者一眼能懂。",
    "",
    "工作纪律：",
    // ... (existing)
    "",
    "技能纪律：涉及下列交付物类型时，必须先用 load_skill 加载对应技能再动手；库用法、模板与自验步骤以技能内容为准，不得凭记忆臆写 API。",
    skillCatalogForPromptMerged(workspaceId, db)  // NEW: 合并视图
  ].join("\n");
}
```

新增函数:
```typescript
async function skillCatalogForPromptMerged(
  workspaceId?: string,
  db?: WorkHubDatabaseClient
): Promise<string> {
  const skills = await listSkillsMerged(skillsRoot, db, workspaceId);
  if (skills.length === 0) {
    return "";
  }
  return skills.map((skill) => `- ${skill.id}：${skill.whenToUse || skill.description}`).join("\n");
}
```

### 7. 更新 tools.test.ts(绿色测试保持)

**文件:** `/packages/tools/src/tools.test.ts` 第 105–124 行

现有测试不变(无 db/workspaceId 时行为同旧):
```typescript
test("skill registry lists the seven preset skills with frontmatter", () => {
  // listSkills() 默认走 FS,返回 7 项预设
  // listSkillsMerged() 需要显式提供 db 与 workspaceId
  const skills = listSkills();
  assert.deepEqual(skills.map((skill) => skill.id), [
    "code-script",
    "data-analysis",
    "docx-document",
    "markdown-report",
    "pptx-deck",
    "stat-charts",
    "xlsx-spreadsheet"
  ]);
  // ... 保持不变
});
```

---

## QA Gate

### 保持 r4-web-live-route-interaction.ts 绿

**现有 70 步 web smoke 测试** 位于 `/apps/web/qa/r4-web-live-route-interaction.ts`,依赖:
- ✓ Agent 工具系统可正常执行(`load_skill` 调用不出错)
- ✓ System prompt 格式无误(LLM 可解析)
- ✓ 技能蒸馏不干扰当前工作流(后台异步,24h 间隔)

**无需改动该测试本身**。团队技能在 `status='draft'` 时不注入 system prompt,仅 `'active'` 时生效。

### 新增测试

1. **迁移测试** `/packages/db/migrations/0012.test.ts`
   ```typescript
   test("0012: team_skills table created with correct schema", async () => {
     const result = await db.query.teamSkills.findMany({
       limit: 0
     });
     assert.ok(Array.isArray(result));
   });
   ```

2. **技能加载测试** `/packages/tools/src/skills.test.ts`(扩展)
   ```typescript
   test("listSkillsMerged returns FS + DB skills when db provided", async () => {
     // 需要 mock DB 或真实 PG 运行
     // 验证 FS 预设 + DB team skills 合并
   });

   test("loadSkillContentMerged prefers FS, falls back to DB", async () => {
     // 验证加载优先级
   });
   ```

3. **蒸馏调度器测试** `/apps/api/src/workers/agent-skill-curation.test.ts`(新建)
   ```typescript
   test("skill curation scheduler respects work queue idle check", async () => {
     const scheduler = createAgentRunSkillCurationScheduler({
       workQueueIsIdle: async () => false
     });
     const result = await scheduler.tick();
     assert.equal(result.curated, 0); // 应跳过
   });

   test("skill validation rejects low-confidence distillations", async () => {
     // 验证 confidence_score < 0.7 被拒
   });
   ```

4. **端到端测试** `/apps/api/src/workers/agent-runner.integration.test.ts`(扩展)
   ```typescript
   test("agent loop injects team skills into system prompt", async () => {
     // 创建 team_skill(active),运行 agent,验证 skillCatalogForPromptMerged
     // 包含该技能
   });
   ```

### 现有门禁保持

- ✓ **F10 审计/快照红线:** 技能晋升时记录 audit_logs(actorKind='ai')
- ✓ **F8 沙箱/工具:** load_skill 继续 fail-closed(未知技能返回错误)
- ✓ **F6 权限:** 团队技能仅该工作空间可用(workspaceId 外键约束)

---

## Handoff

### 后续阶段

**Phase 2:UI 与团队设置**
- 页面:`/settings/team/skills` 展示活跃技能列表
- 操作:禁用(status→deprecated)、回滚(version--)、预览(frontmatter + 样本计数)
- 权限:workspace admin 可管理,AI 自动蒸馏无需人批准

**Phase 3:高级蒸馏**
- 样本置信度反馈循环(用户评分已蒸馏技能)
- 多模型蒸馏(快速 haiku + 精细 sonnet)
- 技能融合(相似技能自动合并)

**Phase 4:跨团队技能共享(可选)**
- 团队技能可标记为`shareable`
- Org 级别的技能库

### 交付物清单

| 物品 | 状态 | 备注 |
|------|------|------|
| 迁移 0012 | ✅ 实现 | team_skills 表 + 索引 |
| Drizzle schema | ✅ 实现 | teamSkills 模型 |
| skills.ts 扩展 | ✅ 实现 | loadTeamSkills, listSkillsMerged, loadSkillContentMerged |
| AgentRunSkillCurationScheduler | ✅ 实现 | 日间蒸馏 + 自验 + 晋升 |
| agent-runner 集成 | ✅ 实现 | 启动调度器 + 合并 system prompt |
| tools.test.ts 保持绿 | ✅ 实现 | 默认行为不变 |
| 新增测试 4 项 | ⏳ TODO | 迁移 / 加载 / 调度 / 端到端 |

---

## 附录:LLM 蒸馏 prompt 模板

```
系统角色: WorkHub 技能策展人(AI)

用户任务:
根据这个工作空间最近 7 天的数据,提议新增 1–3 项团队技能。

输入数据:
- 接受的交付物(按类型和频率统计)
- Agent 最常用工具
- 高质量审核反馈与置信度评分
- 升级事件中的缺口信号

约束:
1. 每项技能需要至少 5 个具体样本(已接受交付物或高分提议)
2. skill_key 必须全小写、连字符分隔(e.g. "sql-export", "finance-report")
3. 不得重复现有 7 项预设技能
4. 返回严格格式的 SKILL.md(frontmatter + Markdown 正文)
5. 失败准则:样本<5 | skill_key 非法 | 内容格式错误 | 置信度无法评估

输出格式(JSON):
{
  "distilled_skills": [
    {
      "skill_key": "string",
      "name": "string",
      "when_to_use": "string (10–30 字)",
      "content_md": "string (含 frontmatter 与正文)",
      "sample_count": int,
      "confidence_score": float(0.0–1.0)
    }
  ],
  "reason_if_none": "string(可选)"
}

示例输出:
{
  "distilled_skills": [
    {
      "skill_key": "quarterly-financial-report",
      "name": "季度财务报告",
      "when_to_use": "生成符合 GAAP 的季度财务报告与分析",
      "content_md": "---\nname: 季度财务报告\nwhen_to_use: ...\n---\n\n# 季度财务报告\n\n## 适用...",
      "sample_count": 12,
      "confidence_score": 0.88
    }
  ]
}
```
