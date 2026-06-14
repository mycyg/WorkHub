---
module: R6-M1-user-memory
layer: P-DATA / P-AI / C-WEB
status: planned
owner: design+engineering
date: 2026-06-14
depends_on:
  - r6-compounding-ai-labor-plan-2026-06-14.md
  - ../01-architecture/security-and-permissions.md
---

# R6.M1 用户 Memory 系统设计：个人级复利（第一阶段 · 读路径）

> **目标**：建立用户个人级的 memory 库，纪录偏好、修正口径、常用上下文。AI 执行时注入已知偏好，直接减少重复人工澄清，驱动「AI 工作量 ← 学习用户风格」的复利。v0 只做读路径和规则提取写入——无 LLM 蒸馏，可控且轻量。

## 开工前必读

### 代码锚点（务必确认）

- **users 表结构**：`packages/db/src/schema/core.ts:47-67`（id / nickname / preferredLocale / 无 workspace_id 字段）
- **workspaces 定义**：`packages/db/src/schema/core.ts:85-100`（orgId / name / slug）
- **reviews 表 reasonMd 字段**：`core.ts:762`（提审批意见的原始源）
- **Agent 启动 worker prompt**：`apps/api/src/workers/agent-runner.ts:423-437`（defaultWorkerSystemPrompt）
- **初始用户消息构造**：`agent-runner.ts:440-456`（defaultInitialUserMessage，执行入口点）
- **Run 终止 finalize**：`agent-runner.ts:709-894`（executeRun 完整流程，proposal 生成点在 :819）
- **Proposal review 服务**：`apps/api/src/services/proposals.ts:103-108`（review 方法，reasonMd 参数）
- **R6 主计划 §4 Memory 部分**：`r6-compounding-ai-labor-plan-2026-06-14.md:49-62`（表结构、写读策略、限额机制）
- **70 步 web smoke**：`apps/web/qa/r4-web-live-route-interaction.ts`（保住 data-r4-* 标记）
- **最新迁移**：`packages/db/migrations/0011_bitter_magneto.sql`（迁移 0012 应接在此后）

### 本计划边界

**只做**（v0）：
1. 表设计 + migration 0012（additive only）
2. 合同 domain/user-memory.ts + repository upsert/listForUser/touch/prune
3. 规则提取：审批纠正写 correction、run 收尾写 preference
4. 读路径：run 启动时注入 top-N memory 到 prompt
5. 用户个人设置页的查看 + 删除操作

**暂不做**（后续迭代）：
- LLM 蒸馏写入（成本高）
- memory 的 proposal/审批流（用户自主删，人类事后可查）
- workspace-scoped 偏好（v0 全局 user_id only）

---

## 目标与承诺

**MVP 核心承诺**：
- 不增加现有 QA gate 的负担（70 步 smoke 保住 data-r4-* 标记）
- v0 规则提取，成本可控（无新 token 开销用于内容生成）
- 用户可见可删，底线透明
- 失败降级优雅：memory 缺失不中断 run 执行

**质量指标**：
- 单用户 memory 硬上限 50 条（防爆）
- confidence≥0.6 + 使用频率 top 算法进行驱逐
- 过期清理：curation scheduler 中集中做 prune
- 每 run 注入 top-5 偏好到 prompt（token 开销 ~200 tokens）

---

## 数据流与契约

### 新表 user_memories（迁移 0012）

```typescript
export const userMemories = pgTable(
  "user_memories",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    // workspace_id 为 null = 全局跨 workspace 偏好（v0 所有记忆均为全局）
    // 预留 workspace_id 用于多租户（future）
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    category: varchar("category", { length: 32 })
      .$type<"preference" | "correction" | "recurring_context">()
      .notNull(),
    // "preference" = AI 学到的用户风格（e.g. "preferred_language": "markdown-only"）
    // "correction" = 用户审批纠正的口径（e.g. "delivery_format": "PDF not DOCX"）
    // "recurring_context" = 常出现的 work_item 上下文片段（留作扩展）
    key: varchar("key", { length: 256 }).notNull(),
    value_md: text("value_md").notNull(),
    confidence: doublePrecision("confidence").notNull().default(0.5),
    // 0.0 ~ 1.0，低分候选易被驱逐；correction 类默认 0.9；preference 从 event 推导
    sourceRunId: uuid("source_run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    lastUsedAt: timestampTz("last_used_at"),
    // touch() 每次注入 prompt 时更新，用于 LRU 驱逐
    expiresAt: timestampTz("expires_at"),
    // 自动清理字段，v0 只在 scheduler 中用
    ...timestamps()
  },
  (table) => [
    uniqueIndex("user_memories_key_uq")
      .on(table.userId, table.category, table.key)
      .where(sql`${table.deletedAt} is null`),
    index("user_memories_user_id_idx").on(table.userId),
    index("user_memories_workspace_id_idx").on(table.workspaceId),
    index("user_memories_category_idx").on(table.category),
    index("user_memories_confidence_idx").on(table.confidence),
    index("user_memories_last_used_at_idx").on(table.lastUsedAt),
    index("user_memories_expires_at_idx").on(table.expiresAt),
    index("user_memories_deleted_at_idx").on(table.deletedAt)
  ]
);
```

**Drizzle 迁移指引**：
- 文件：`packages/db/migrations/0012_user_memories.sql`（命名沿用现有格式 `0012_<randomword>.sql`）
- SQL 生成由 Drizzle 自动处理（run `drizzle-kit generate`）
- `meta/0012_snapshot.json` + `_journal.json` 自动更新

---

### 合同 domain/user-memory.ts

**文件位置**：`packages/contracts/src/domain/user-memory.ts`

```typescript
import { z } from "zod";
import { idSchema, isoDateTimeSchema, timestampFieldsSchema } from "./common.js";

export const userMemoryCategorySchema = z.enum([
  "preference",      // AI 学到的用户编码风格、交付物格式等
  "correction",      // 用户审批反馈纠正的口径
  "recurring_context" // 常见上下文（预留）
]);
export type UserMemoryCategory = z.infer<typeof userMemoryCategorySchema>;

export const userMemorySchema = timestampFieldsSchema.extend({
  id: idSchema,
  user_id: idSchema,
  workspace_id: idSchema.optional(), // null = 全局
  category: userMemoryCategorySchema,
  key: z.string().min(1).max(256),
  value_md: z.string().min(1),
  confidence: z.number().min(0).max(1).default(0.5),
  source_run_id: idSchema.optional(),
  last_used_at: isoDateTimeSchema.optional(),
  expires_at: isoDateTimeSchema.optional(),
  deleted_at: isoDateTimeSchema.optional()
});
export type UserMemory = z.infer<typeof userMemorySchema>;

export const userMemoryInputSchema = z.object({
  category: userMemoryCategorySchema,
  key: z.string().min(1).max(256),
  value_md: z.string().min(1),
  confidence: z.number().min(0).max(1).default(0.5),
  sourceRunId: idSchema.optional(),
  expiresAt: isoDateTimeSchema.optional()
});
export type UserMemoryInput = z.infer<typeof userMemoryInputSchema>;

export const listUserMemoriesOptionsSchema = z.object({
  category: userMemoryCategorySchema.optional(),
  limit: z.number().int().positive().default(5),
  minConfidence: z.number().min(0).max(1).default(0.5)
});
export type ListUserMemoriesOptions = z.infer<typeof listUserMemoriesOptionsSchema>;
```

---

### Repository user-memory.ts

**文件位置**：`packages/db/src/repositories/user-memory.ts`

```typescript
import { eq, and, gte, lte, desc, limit, sql, isNull, asc } from "drizzle-orm";
import { userMemories } from "../schema/core.js";
import type { UserMemory, UserMemoryInput, ListUserMemoriesOptions } from "@workhub/contracts";
import type { WorkHubDatabaseClient } from "./types.js";

export class UserMemoryRepository {
  constructor(private db: WorkHubDatabaseClient) {}

  /**
   * upsert: 用 (user_id, category, key) 唯一索引自动去重覆盖
   * - 新建或更新同 user/category/key 的记忆
   * - confidence 推送更新（后续若是从审批/run 来可提升分数）
   */
  async upsert(input: {
    userId: string;
    memory: UserMemoryInput;
    now: Date;
  }): Promise<UserMemory> {
    const { userId, memory, now } = input;
    const result = await this.db
      .insert(userMemories)
      .values({
        id: randomUUID(),
        userId,
        workspaceId: null, // v0 全局
        category: memory.category,
        key: memory.key,
        value_md: memory.value_md,
        confidence: memory.confidence,
        sourceRunId: memory.sourceRunId,
        expiresAt: memory.expiresAt,
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: [
          userMemories.userId,
          userMemories.category,
          userMemories.key
        ],
        set: {
          value_md: memory.value_md,
          confidence: memory.confidence,
          sourceRunId: memory.sourceRunId,
          expiresAt: memory.expiresAt,
          updatedAt: now
        }
      })
      .returning();
    return result[0]!;
  }

  /**
   * listForUser: 按 confidence × recency 排序拉用户记忆
   * - 排序：confidence desc, last_used_at desc nulls last
   * - 应用 minConfidence 过滤 + limit（默认 5）
   */
  async listForUser(input: {
    userId: string;
    options?: ListUserMemoriesOptions;
    now: Date;
  }): Promise<UserMemory[]> {
    const { userId, options = {}, now } = input;
    const { category, limit: limitCount = 5, minConfidence = 0.5 } = options;

    const conditions = [
      eq(userMemories.userId, userId),
      isNull(userMemories.deletedAt),
      gte(userMemories.confidence, minConfidence)
    ];
    if (category) {
      conditions.push(eq(userMemories.category, category));
    }

    return this.db
      .select()
      .from(userMemories)
      .where(and(...conditions))
      .orderBy(
        desc(userMemories.confidence),
        desc(userMemories.lastUsedAt)
      )
      .limit(limitCount);
  }

  /**
   * touch: 更新 last_used_at（每次注入 prompt 时调用）
   */
  async touch(input: {
    memoryId: string;
    now: Date;
  }): Promise<void> {
    const { memoryId, now } = input;
    await this.db
      .update(userMemories)
      .set({ lastUsedAt: now })
      .where(eq(userMemories.id, memoryId));
  }

  /**
   * prune: soft-delete 过期 + 低分记忆（用于 curation scheduler）
   * - 删除 expires_at < now 的所有记忆
   * - 如果超过限额，删除最低分最少用的
   */
  async prune(input: {
    userId: string;
    maxActive: number; // 单用户上限，建议 50
    now: Date;
  }): Promise<{ deleted_count: number }> {
    const { userId, maxActive, now } = input;

    // Step 1: 硬删过期
    const expiredResult = await this.db
      .update(userMemories)
      .set({ deletedAt: now })
      .where(
        and(
          eq(userMemories.userId, userId),
          isNull(userMemories.deletedAt),
          lte(userMemories.expiresAt, now)
        )
      );
    const expiredCount = expiredResult.rowCount ?? 0;

    // Step 2: 查当前活跃数
    const activeMemories = await this.db
      .select({ id: userMemories.id })
      .from(userMemories)
      .where(
        and(
          eq(userMemories.userId, userId),
          isNull(userMemories.deletedAt)
        )
      );
    const activeCount = activeMemories.length;

    // Step 3: 如果超限，按 confidence×recency 驱逐
    let evictedCount = 0;
    if (activeCount > maxActive) {
      const toEvict = activeCount - maxActive;
      const evictCandidates = await this.db
        .select({ id: userMemories.id })
        .from(userMemories)
        .where(
          and(
            eq(userMemories.userId, userId),
            isNull(userMemories.deletedAt)
          )
        )
        .orderBy(
          asc(userMemories.confidence),
          asc(userMemories.lastUsedAt) // nulls last 自动排后
        )
        .limit(toEvict);

      if (evictCandidates.length > 0) {
        const evictIds = evictCandidates.map((m) => m.id);
        await this.db
          .update(userMemories)
          .set({ deletedAt: now })
          .where(
            and(
              eq(userMemories.userId, userId),
              sql`${userMemories.id} = any(${evictIds})`
            )
          );
        evictedCount = evictIds.length;
      }
    }

    return { deleted_count: expiredCount + evictedCount };
  }
}

export function createUserMemoryRepository(db: WorkHubDatabaseClient): UserMemoryRepository {
  return new UserMemoryRepository(db);
}
```

---

### 写入路径（规则提取，v0 两个来源）

#### 1) 审批纠正 → correction memory

**集成点**：`packages/db/src/repositories/proposals.ts` → `review()` 方法

当审批者提交 `reasonMd` 时，触发规则抽取：

```typescript
// 伪代码，真实集成在 proposalService.review() 后或独立 hook
async function extractCorrectionMemory(input: {
  reviewId: string;
  reviewerUserId: string;
  reasonMd: string;
  proposalId: string;
  workItemId: string;
  db: WorkHubDatabaseClient;
  now: Date;
}) {
  // v0 规则：扫一行一行的 reasonMd，找 key: value 模式
  // 例：
  //   "格式纠正：交付物应使用 PDF，不要 DOCX"
  //   -> key="delivery_format", value="PDF only, avoid DOCX"
  //   -> category="correction", confidence=0.9 (高，来自人类审批)
  
  const patterns = [
    { regex: /格式[：:]\s*(.+)/gi, key: "delivery_format" },
    { regex: /语言[：:]\s*(.+)/gi, key: "language_preference" },
    { regex: /风格[：:]\s*(.+)/gi, key: "style_preference" },
    // 可扩展更多规则...
  ];

  const memoryRepo = createUserMemoryRepository(db);
  for (const pattern of patterns) {
    const matches = reasonMd.matchAll(pattern.regex);
    for (const match of matches) {
      if (match[1]) {
        await memoryRepo.upsert({
          userId: reviewerUserId,
          memory: {
            category: "correction",
            key: pattern.key,
            value_md: match[1].trim(),
            confidence: 0.9, // 高分，人类纠正
            sourceRunId: undefined // 审批 不关联 run
          },
          now
        });
      }
    }
  }
}
```

**调用点**：`apps/api/src/services/proposals.ts` 中 `review()` 实现后（line ~400-500），新增：

```typescript
// 审批意见可能产生用户 memory
if (reasonMd && decision === "request_changes") {
  // 异步，不阻塞审批返回
  setImmediate(() => 
    extractCorrectionMemory({
      reviewerUserId: actor.actor_user_id,
      reasonMd,
      // ... 其他字段
    }).catch(err => logger.error("Memory extract failed", err))
  );
}
```

#### 2) Run 收尾 → preference memory

**集成点**：`apps/api/src/workers/agent-runner.ts:820` → `executeRun()` 成功分支

当 agent run 完成 finalize 时，从成功指标推导偏好：

```typescript
async function extractPreferenceMemory(input: {
  run: AgentRunQueueRecord;
  result: AgentLoopResult;
  db: WorkHubDatabaseClient;
  now: Date;
}) {
  if (!input.run.actor_user_id) return; // 只提取人类交互者的偏好

  const memoryRepo = createUserMemoryRepository(db);
  const run = input.run;
  const result = input.result;

  // 规则 1：若 run 成功 & 置信度高 & steps 少 
  // -> "preferred_conciseness": 0.7
  if (
    result.status === "succeeded"
    && result.confidence?.grade === "high"
    && run.usage.steps_used <= 3
  ) {
    await memoryRepo.upsert({
      userId: run.actor_user_id,
      memory: {
        category: "preference",
        key: "concise_approach",
        value_md: "User prefers concise, direct approach with fewer steps.",
        confidence: 0.7,
        sourceRunId: run.run_id
      },
      now: input.now
    });
  }

  // 规则 2：若 run 成功 & 交付物全采纳（merged）
  // -> "high_quality_output": 0.8
  if (result.status === "succeeded" && result.manifest?.title) {
    // 可查 accepted_deliverable_changes 数 vs manifest changes 数
    // 此处简化，真实实现需数 DB 中的采纳情况
    await memoryRepo.upsert({
      userId: run.actor_user_id,
      memory: {
        category: "preference",
        key: "output_quality",
        value_md: "Outputs consistently passed review without major revisions.",
        confidence: 0.75,
        sourceRunId: run.run_id
      },
      now: input.now
    });
  }

  // 规则 3：若 run 失败原因涉及特定工具不可用
  // -> "preferred_tool_subset": 0.5（低分，需验证）
  // （示例，实现由需求定）
}
```

**调用点**：`agent-runner.ts` 的 `executeRun()` :820 附近，成功分支：

```typescript
const drifted = driftedRun(current.run_id);
if (drifted) {
  return drifted;
}
await openProposalFromManifest(current, result);
current = updateRun(finalizeExecutedRun(current, result, now()));
await persistRunWithTrace(current);
await emitFinalRunEvent(current, result);
await recordRunConfidence(current, result);
// 新增：提取偏好 memory
await extractPreferenceMemory({
  run: current,
  result,
  db: persistence.db, // 需暴露 db 引用或独立注入
  now
}).catch(err => logger.error("Preference memory extract failed", err));
await notifyRunMilestone(current, result.reason);
return current;
```

---

## 读路径：Run 启动时注入 Memory

**集成点**：`apps/api/src/workers/agent-runner.ts:440-456` → `defaultInitialUserMessage()`

修改初始消息构造，在「WorkHub 数据库中的真实工单上下文」段**之后**、「请按以下方式工作」**之前**插入用户偏好：

```typescript
async function defaultInitialUserMessage(
  run: AgentRunQueueRecord, 
  resolvedWorkItemContext?: string,
  options?: {
    db: WorkHubDatabaseClient;
    userId: string;
    now: Date;
  }
): Promise<string> {
  const lines: string[] = [
    `任务：${run.title}`,
    `work_item_id: ${run.work_item_id}`
  ];

  if (resolvedWorkItemContext) {
    lines.push("", "WorkHub 数据库中的真实工单上下文：", resolvedWorkItemContext);
  }

  // 新增：注入用户已知偏好
  if (options?.db && options.userId) {
    const memoryRepo = createUserMemoryRepository(options.db);
    const memories = await memoryRepo.listForUser({
      userId: options.userId,
      options: { limit: 5, minConfidence: 0.5 },
      now: options.now
    });

    if (memories.length > 0) {
      lines.push("", "你对这位用户的了解：");
      for (const mem of memories) {
        lines.push(`- ${mem.key}: ${mem.value_md}`);
        // 异步 touch，不阻塞 prompt 返回
        setImmediate(() =>
          memoryRepo
            .touch({ memoryId: mem.id, now: options.now })
            .catch(err => logger.warn("Memory touch failed", err))
        );
      }
    }
  }

  lines.push(
    "",
    "请按以下方式工作：",
    "1. 先用 list_files / read_file 了解工作目录里已有的材料（如有）。",
    "2. 围绕任务目标生成交付物，写入 outputs/ 目录。",
    "3. 完成后自然结束，并给出人话总结（做了什么 / 产出在哪 / 未尽事项）。"
  );

  return lines.join("\n");
}
```

**调用点修改**：`executeRun()` :781-783

```typescript
const resolvedWorkItemContext = await workItemContext?.(current);
// 新增参数
const initialUserMessage = options.initialUserMessage
  ? await options.initialUserMessage(current, resolvedWorkItemContext, {
      db: persistence?.db,
      userId: current.actor_user_id,
      now
    })
  : await defaultInitialUserMessage(current, resolvedWorkItemContext, {
      db: persistence?.db,
      userId: current.actor_user_id,
      now
    });
```

---

## 用户界面：Settings 页面

### 新增 Memory 管理面板

**路由**：`/settings/memory` （或作为 Settings 的一个 tab）

**功能**：
1. **列表**：当前用户所有 active memory（分类标签）
2. **看**：悬停显示 `source_run_id`、`confidence` 数值、`last_used_at`
3. **删**：单条删除（soft-delete → `deletedAt` 更新）
4. **统计**：「当前 N/50 条记忆」提示

**VM 合同**：新增 `packages/contracts/src/pages.ts`

```typescript
export const userMemorySettingItemVmSchema = z.object({
  id: idSchema,
  category: userMemoryCategorySchema,
  key: z.string(),
  valueMd: z.string(),
  confidence: z.number().min(0).max(1),
  lastUsedAt: isoDateTimeSchema.optional(),
  sourceRunId: idSchema.optional()
});
export type UserMemorySettingItemVM = z.infer<typeof userMemorySettingItemVmSchema>;

export const settingsPageVmSchema = z.object({
  // ... 现有字段
  userMemories: z.array(userMemorySettingItemVmSchema).optional()
  // optional = smoke 安全
});
```

**API 端点**：

- `GET /api/me/memories?category=preference&limit=20`
  - 返回当前用户的 memory 列表
- `DELETE /api/me/memories/:id`
  - soft-delete 一条 memory
  - 权限：只能删自己的

**实现**：新建 route `apps/api/src/routes/me-memories.ts`

```typescript
export async function createMeMemoriesRoutes(app: Express) {
  app.get("/api/me/memories", authRequired, async (req, res) => {
    const userId = req.user.id;
    const category = req.query.category as string | undefined;
    const limit = parseInt(req.query.limit as string) || 20;
    
    const memoryRepo = createUserMemoryRepository(db);
    const memories = await memoryRepo.listForUser({
      userId,
      options: { category: category as any, limit, minConfidence: 0.0 },
      now: new Date()
    });
    
    res.json({
      items: memories.map(m => ({
        id: m.id,
        category: m.category,
        key: m.key,
        value_md: m.value_md,
        confidence: m.confidence,
        last_used_at: m.lastUsedAt?.toISOString(),
        source_run_id: m.sourceRunId
      }))
    });
  });

  app.delete("/api/me/memories/:id", authRequired, async (req, res) => {
    const userId = req.user.id;
    const memoryId = req.params.id;

    // 验证所有权
    const memory = await db
      .select()
      .from(userMemories)
      .where(
        and(
          eq(userMemories.id, memoryId),
          eq(userMemories.userId, userId),
          isNull(userMemories.deletedAt)
        )
      )
      .then(rows => rows[0]);

    if (!memory) {
      return res.status(404).json({ error: "memory_not_found" });
    }

    await db
      .update(userMemories)
      .set({ deletedAt: new Date() })
      .where(eq(userMemories.id, memoryId));

    res.json({ ok: true });
  });
}
```

---

## 后台维护：Curation Scheduler 中的 prune

**文件**：`apps/api/src/workers/skill-curation-scheduler.ts`（R6.S2 中新建，M1 中复用其逻辑）

在 scheduler 的每日闲时清理循环中调用：

```typescript
async function dailyMemoryMaintenance() {
  // 所有用户快速遍历 + prune
  const allUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(isNull(users.deletedAt));

  const memoryRepo = createUserMemoryRepository(db);
  const maxMemoriesPerUser = 50;

  for (const user of allUsers) {
    await memoryRepo.prune({
      userId: user.id,
      maxActive: maxMemoriesPerUser,
      now: new Date()
    }).catch(err => {
      logger.error(`Memory prune failed for user ${user.id}`, err);
    });
  }
}

// 在 scheduler 主循环调用
setInterval(async () => {
  if (shouldRunDaily("memory_maintenance")) {
    await dailyMemoryMaintenance();
  }
}, 30 * 60 * 1000); // 30 分钟检查一次
```

---

## 施工顺序（7 步，每步独立可验）

1. **Migration 0012 生成**
   - 运行 `drizzle-kit generate` 生成 SQL
   - 确认 `packages/db/migrations/0012_*.sql` 生成正确（CREATE TABLE user_memories + 索引）
   - 验证：`meta/0012_snapshot.json` 更新、`_journal.json` 新增记录

2. **合同 + 类型**
   - 新建 `packages/contracts/src/domain/user-memory.ts`（上文完整代码）
   - 导出到 `packages/contracts/src/index.ts`
   - 更新 settings page VM（optional `userMemories` 字段）
   - 验证：`pnpm typecheck` 全绿

3. **Repository 实现**
   - 新建 `packages/db/src/repositories/user-memory.ts`（上文完整代码）
   - 导出到 `packages/db/src/repositories/index.ts`
   - 单元测试 upsert / listForUser / touch / prune（mock db）
   - 验证：`pnpm test -- user-memory.test.ts`

4. **写入路径：审批纠正**
   - 在 `apps/api/src/services/proposals.ts` 的 `review()` 方法后新增 `extractCorrectionMemory()`
   - 集成到提审流程（异步，setImmediate）
   - 验证：提交审批意见 → 查数据库 user_memories 表中有新行

5. **写入路径：Run 收尾**
   - 在 `apps/api/src/workers/agent-runner.ts` 的 executeRun() :820 后新增 `extractPreferenceMemory()`
   - 集成到 run finalize（异步）
   - 验证：run 成功完成 → user_memories 表中有新行（confidence ~0.7）

6. **读路径：Prompt 注入**
   - 修改 `defaultInitialUserMessage()` 签名，新增 options 参数
   - 拉 top-5 memory、格式化、插入初始消息
   - 异步 touch last_used_at
   - 集成到 executeRun() :781-783 的调用
   - 验证：本地测试 agent-runner，观察初始消息中是否包含 memory 内容

7. **UI + API 端点**
   - 新建 `apps/api/src/routes/me-memories.ts`（GET list / DELETE）
   - 集成到路由注册
   - Web 前端新增 settings/memory 面板（可选图形展示）
   - 验证：`curl /api/me/memories` 返回用户记忆列表，DELETE 成功

---

## QA Gate

### 保护现有 70 步 smoke

✅ **硬约束**：
- 不修改任何现有 `data-r4-*` 标记
- 不改 `defaultInitialUserMessage` 的行为（只增内容，不改机制）
- 不改 proposal/review 的 API 签名（只加异步 side-effect）
- Memory 缺失、repository 查询失败等错误** 降级静默**（log 但继续执行，不中断 run）

**验证**：`pnpm qa:r4-web-live-route-interaction` 全 70 步 + 全 115 gates 仍为 true

### 新增单元测试

```bash
# Repository 单元
packages/db/src/repositories/__tests__/user-memory.test.ts
- upsert: 新建 + 覆盖
- listForUser: 分类过滤 + 排序 + limit
- touch: last_used_at 更新
- prune: 过期清理 + LRU 驱逐

# 合同验证
packages/contracts/src/__tests__/user-memory.test.ts
- userMemorySchema 序列化反序列化
- listUserMemoriesOptionsSchema 字段验证

# Services 集成
apps/api/src/services/__tests__/memory-extraction.test.ts
- extractCorrectionMemory: reasonMd 规则匹配
- extractPreferenceMemory: run 结果 → memory 转换

运行：pnpm test -- user-memory
```

### 集成测试

1. **E2E 流程验证**
   ```
   启动 agent run (actor_id = test-user-1)
     -> 成功完成（高置信度）
     -> preference memory 生成 ✅
   
   启动第二个 run (同 test-user-1)
     -> 初始 prompt 包含前一个 run 的 memory ✅
   
   审批该 run 的 proposal，写入 reasonMd = "格式：仅 PDF"
     -> correction memory 生成 ✅
   
   启动第三个 run (同用户)
     -> prompt 中既有 preference 也有 correction ✅
   ```

2. **UI 验证**
   ```
   访问 /settings/memory
     -> 列表显示当前用户所有 memory ✅
   
   删除一条 memory
     -> 库中标记 deleted_at ✅
     -> 列表刷新后消失 ✅
   
   超限场景（50+ memory）
     -> prune job 运行后驱逐最低分 ✅
   ```

3. **故障降级**
   ```
   repository.listForUser() 异常
     -> run 仍正常执行，初始消息无 memory 段 ✅
     -> error log 记录异常 ✅
   
   touch last_used_at 失败
     -> 不阻塞 run，后台 catch ✅
   ```

### 性能 & 成本检查

- **prompt token 增量**：top-5 memory + 标签 ≈ 200 tokens/run（可接受）
- **DB 查询**：listForUser 单次 <10ms（有索引）
- **后台 prune**：每日一次、用户 N × 3 个 SQL（线性，无锁）

---

## Handoff

### 交付清单（v0）

- ✅ Migration 0012 + schema 确认
- ✅ 合同 + repository 代码
- ✅ 审批纠正 → memory（规则提取）
- ✅ Run 收尾 → memory（规则提取）
- ✅ Prompt 注入（读路径）
- ✅ `/api/me/memories` 端点 + 删除
- ✅ Settings UI（可选高保真）
- ✅ 单元 + 集成测试
- ✅ 70 步 smoke 全绿

### 下一阶段（v1+）

1. **S3 闲时自迭代**（R6.S3 计划）
   - Skill 自迭代时联合 memory 数据（如「用户常要求 PDF」→ skill 注意点）
   - memory 与 skill 的协同学习

2. **LLM 蒸馏写入**（成本控制后）
   - 高置信运行末尾，用轻量 Claude 蒸馏「用户这次学到了什么」
   - 比规则提取更智能，但需成本评估

3. **Workspace 级偏好分离**（多租户准备）
   - `user_memories.workspace_id` 从 null → 实值
   - 团队内的偏好与全局偏好分离

4. **Memory 的 Proposal + 审批**（高价值纠正）
   - 若 memory 被多次用且后续被人类否决，可走 Proposal 升级为明确指令
   - 人类主动「我要这条 memory」的工作流

---

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| Memory 过时 / 错误信息误导 | 用户 Settings 可删；confidence 反映可信度；v0 规则提取 fail-closed |
| 超限爆炸 | 硬上限 50 + LRU 驱逐 + 24h prune |
| Prompt 注入失败阻塞 run | 异步 catch，降级无 memory 段继续 |
| 审批 reasonMd 规则识别不准 | v0 保守，低分或未匹配的丢弃；人工可在 Settings 补充 |
| 隐私泄漏（memory 含敏感内容） | 用户专属表、只读当前用户的、audit_logs 记录删除操作 |

---

## 文案与卖萌语气

> "个人 AI 记忆库"·「我是 AI 工人，记得了你的 5 条风格偏好」
>
> Settings → Memory：「👤 我对你的了解」列表
> - Preference（绿）：「偏好精简步骤」
> - Correction（橙）：「矫正：交付物用 PDF」
> - 右上「×」删除误解的记忆
> - 底部「50/50 记忆已满，等我学到新技能时自动调整」

Prompt 中：
```
你对这位用户的了解：
- preferred_approach: 用户偏好直接、步数少的方案
- delivery_format: 仅 PDF，不要 DOCX
- output_quality: 用户产出质量高，很少需要大幅修改
```

---

**负责人**：Engineering + Data  
**预计工期**：1 week（步骤 1-3 可并行）  
**依赖**：迁移 0012、R6 主计划中的 Skill 系统（若步骤 2 选择 workspace-scoped）
