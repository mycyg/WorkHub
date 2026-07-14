# R14 批 MEM · W-A mem-server 施工汇报

- 分支：`r14/mem-server`
- 提交：`272531d2`（代码）· 本汇报另起一 commit
- 施工说明书：`r14-release-readiness/03-mem-design.md`（逐节执行）
- 验收自查：`@workhub/db` / `@workhub/contracts` / `@workhub/api` test + `pnpm -r typecheck` 全绿（见文末计数）

## 1. 做了什么

### §1 数据模型（迁移 0056）
- 新增 `packages/db/migrations/0056_memory_edit_provenance.sql`：`user_memories` 加两列
  `edited_by_user_id uuid`（FK→`users(id)` on delete set null）+ `edited_at timestamptz`。均可空、
  `ADD COLUMN IF NOT EXISTS` + 条件化 `ADD CONSTRAINT`（pg_constraint 存在性守卫，照 0055 的 FK 回补
  idiom），replay-safe。AI/夜间晋升写入的记忆此二列恒为 NULL，诚实区分「AI 学到的」与「人改过的」。
- `packages/db/migrations/meta/_journal.json`：追加 `idx=56 / when=1783908000000 / tag
  0056_memory_edit_provenance`。
- `packages/db/src/schema/core.ts`：`userMemories` 同步 `editedByUserId`/`editedAt` 两列。
- `packages/db/src/schema.test.ts`：尾断言 `0055`→`0056`（批准变更）；新增 0056 内容断言（两列
  ADD COLUMN IF NOT EXISTS、均可空、FK on delete set null、schema graph 对齐）。

### §1 仓库新方法（不复用会产生副作用的既有方法）
- `repositories/user-memory.ts`
  - `getForUser(userId, id, scope?)`：按 id + userId + workspace 可见性取单条，**不过滤 deletedAt**
    （detail 据其判 404、patch 据其判「已删除」409）。
  - `updateValueForUser(input)`：只改 `value_md` + 留痕（`edited_by/edited_at`）+ `updated_at`；
    **绝不复用 upsert 的 confidence+0.1 强化**。竞态兜底用 `expectedValueMd`（同文件既有
    `updateMemoryIfCurrent` 写法），而非 SQL 层 `eq(updated_at)`——见「偏离」。
  - `resolveRunProvenance(runIds)`：单次批量 `inArray` + LEFT JOIN `agent_runs → work_items →
    project_conversations`，空输入短路（无 N+1，记忆硬顶 50 条集合有界）。
- `repositories/team-skill.ts`
  - `getById(workspaceId, id)`：按 id + workspaceId 取单条（任意版本/状态），workspace 归属服务端强制。

### §2/§3 服务（两个 ServiceError 类）
- `services/user-memory-governance.ts`（`UserMemoryGovernanceServiceError`）
  - 列表/详情/编辑/删除严格「本人可读写」（`requireHumanActor` 校验 kind=human + userId，非人/无 userId→403）；
    管理员也不代读/代改。
  - 编辑：`looksLikeInjection`（复用 `skill-curation.ts`）+ 空白/超长(>2000)→**400**；`updatedAt.getTime()`
    版本比对→409；已删除→409；不存在→404；竞态兜底落空→409。写入 `edited_by_user_id`=自己。
  - 删除：软删幂等（`softDeleteForUser` 落空后 `getForUser` 区分「已删」→200 与「不存在」→404）。
  - 出处三级降级（§2.3）：run join → `correction && key ^proposal:` 反解 → 诚实缺省（省略 `provenance`）；
    `edited_at` 作为独立字段叠加（前端渲染「最近由你于 X 修改」）。
- `services/team-skill-governance.ts`（`TeamSkillGovernanceServiceError`）
  - 列表/详情：**全员可读**（无 admin 门），含 `content_md` 全文 + `status`（含 deprecated 历史版本）+
    K2 精修 provenance（`provenanceFrom` 逻辑照抄，因该函数在 `pages/team-skills.ts` 未导出且在本工包围栏外）。
  - 编辑/停用：**仅 `actor.isAdmin`**（`users` 全局布尔，**不是** `workspace_memberships.role`，§5）。
  - PATCH：`:id` 非 active→404（历史版本只读）；组装完整 `SkillEditPatch`（confidence_score 硬编码 1、
    rationale 缺省「管理员手动编辑」）→**逐字复用 `validateSkillEditPatch`**（七道闸门）；`stale_base_version`→409、
    其余原因→400；`promote()` 生成 `createdByKind:"human"` 版本、`sourceKind` 保留原值、`samples_json` 带
    `edited_by_user_id`；审计 `team_skill.manually_edited`（best-effort）。
  - 停用：复用 `deprecate()`，reason 缺省「由 {nickname} 手动停用」；已 deprecated 幂等返回现状（不报 409）；
    审计 `team_skill.manually_deprecated`。

### §3 路由（工厂导出，**不挂载**）
- `routes/user-memory-governance.ts`：`GET /me/memories`（?category）、`GET/PATCH/DELETE /me/memories/:id`。
- `routes/team-skill-governance.ts`：`GET /team-skills/manage`、`GET/PATCH /team-skills/manage/:id`、
  `POST /team-skills/manage/:id/deactivate`。
- 两文件头部均留集成者缝合指引；uuid 形参非法→404（`isUuidParam`）。

### §4 契约（additive，pages.ts）
新增 6 个 schema：`userMemoryManagementItemVmSchema`、`userMemoryManagementPageVmSchema`、
`teamSkillManagementItemVmSchema`（`teamSkillVmSchema.extend`）、`teamSkillManagementPageVmSchema`、
`patchUserMemoryRequestSchema`、`patchTeamSkillRequestSchema`（复用 `skillEditOpSchema`/`TEAM_SKILL_MAX_EDIT_OPS`）
+ 辅助 `userMemoryProvenanceSchema`。未新建独立 domain 文件（本设计选择），故 `contracts/src/index.ts` 未动。

## 2. 集成者挂载清单（禁区文件，需集成者缝合）

### 2.1 `apps/api/src/app.ts`
两处 `app.route`（放在其它 `app.route("/api", ...)` 旁）：
```ts
import { createUserMemoryGovernanceRoutes } from "./routes/user-memory-governance.js";
import { createTeamSkillGovernanceRoutes } from "./routes/team-skill-governance.js";
// ...
app.route("/api", createUserMemoryGovernanceRoutes());
app.route("/api", createTeamSkillGovernanceRoutes());
```
两处 `onError` `instanceof` 分支（照 `UserProfileServiceError`/`UserAvatarServiceError` 同款单独 if 块，
否则 400/403/404/409 会被兜底压成无语义码的 500）：
```ts
import { UserMemoryGovernanceServiceError } from "./services/user-memory-governance.js";
import { TeamSkillGovernanceServiceError } from "./services/team-skill-governance.js";
// ...在 app.onError 内：
if (error instanceof UserMemoryGovernanceServiceError || error instanceof TeamSkillGovernanceServiceError) {
  return c.json(
    { ok: false, error: { code: error.code, message: error.message } },
    error.status as 400
  );
}
```
（两类 `status` 均为 `number`；沿用 `ConversationTurnServiceError` 分支的 `error.status as 400` 断言写法。
可合并成一个 if，也可拆两个，行为一致。）

### 2.2 `apps/api/src/openapi.ts`
补 8 条路径文档（envelope 均为 `{ ok: true, data }`）：
- `GET /api/me/memories` → `{ data: userMemoryManagementPageVmSchema }`（`?category=preference|correction|recurring_context` 可选）
- `GET /api/me/memories/:id` → `{ data: userMemoryManagementItemVmSchema }`（404）
- `PATCH /api/me/memories/:id`（body `patchUserMemoryRequestSchema`）→ item VM（400/404/409）
- `DELETE /api/me/memories/:id` → `{ data: { deleted: true } }`（404）
- `GET /api/team-skills/manage` → `{ data: teamSkillManagementPageVmSchema }`
- `GET /api/team-skills/manage/:id` → `{ data: teamSkillManagementItemVmSchema }`（404）
- `PATCH /api/team-skills/manage/:id`（body `patchTeamSkillRequestSchema`）→ item VM（400/403/404/409）
- `POST /api/team-skills/manage/:id/deactivate`（body `{ reason?: string }`）→ `{ data: { deprecated: true } }`（403/404）

### 2.3 `apps/api/src/app.test.ts`
路由白名单加这 8 条路径（若该测试对已挂载路由做穷举断言）。

### 2.4 冲突磁铁（与并行批同解）
- `packages/db/migrations/meta/_journal.json` 尾（本批占 0056，SEARCH 批顺延 0057——集成裁定）。
- `packages/db/src/schema.test.ts` journal 尾断言（本批已改成 0056）。
- `contracts/src/index.ts` 未触发（本批未新建 domain 文件）。

## 3. 测试计数（前 → 后）

| 包 | 前 | 后 | 新增 | 备注 |
|---|---|---|---|---|
| `@workhub/contracts` | 121 | 127 | +6 | `r14-mem.test.ts` |
| `@workhub/db` | 316 | 325 | +9 | governance 仓库 8 + schema 0056 内容断言 1；2 skipped 为既有 PG 依赖 |
| `@workhub/api` | 1280 | 1315 | +35 | service 10+10 / routes 8+7；1 skipped 为既有 |

三层穷举覆盖：水平越权（非人/无 userId→403、跨租户 fence）、并发 409、注入拦截、管理员门、幂等、
出处三级降级、消费侧隔离（软删后不返回）、结构 422 vs 语义 400 分野。`pnpm -r typecheck` 全绿。

## 4. 偏离说明

1. **乐观并发兜底用 `expectedValueMd` 而非 SQL `eq(updated_at)`**（`updateValueForUser`）。
   设计 §2.1 指向 memory-conflicts 的 `updatedAt.getTime()` 比对——该「用户级版本校验」我照做在 service 层。
   但 memory-conflicts 的仓库 SQL 层 `eq(updated_at)` 兜底对 `user_memories` 不安全：AI 插入的记忆
   `updated_at` 走 `defaultNow()`（微秒精度），客户端回传的 `expected_updated_at` 是毫秒精度，SQL 层相等
   比较会在**首次编辑 AI 学到的记忆时必然误报 409**。故仓库竞态兜底改用同文件既有 `updateMemoryIfCurrent`
   的 `eq(value_md, expectedValueMd)` 写法——精度无关、功能等价（并发改动则落空→409）。

2. **超长/注入 → 400 由 service 拦，路由 body schema 刻意放宽**。设计 §3.1 表格（「文档表格为准」）要求
   超长/注入→**400**，但 zod 校验失败在全局 onError 里是 422。为忠实表格，`value_md` 的长度/注入/空白校验
   放在 service 返回类型化 400；路由 body 只做结构校验（非字符串 value_md / 非 ISO expected_updated_at→422）。
   导出的 `patchUserMemoryRequestSchema`（带 `max(2000)`，§4 要求）是**客户端契约**，服务端不用它做硬解析。

3. **`team_skill.manually_deprecated` 审计为新增**。设计 §3.2 只点名 PATCH 的 `team_skill.manually_edited`
   审计；停用是 kill-switch 型治理写动作，为可追溯我加了同款 best-effort 审计（reason 已含操作者昵称）。
   低风险、与「把谁何时改了哪个技能落进 audit_logs」的设计意图一致。

4. **人工编辑版本的 `confidence_score` 存 1**。照设计 §3.2「confidence_score 硬编码为 1」组装 patch，并按 K2
   worker 模板（promote 存 `patch.confidence_score`）把 1 传入 `promote()`。语义=人类背书即满信心（也让它在
   `evictActiveOverCap` 的 confidence 排序里最不易被驱逐）。如需保留原技能 confidence，集成者可一行改。

5. **`proposals.test.ts` 补两列 `null`**（fence 边界说明）。加 schema 列后 `UserMemoryRow`（`$inferSelect`）
   多了 `editedByUserId`/`editedAt`，该测试内联构造完整 row 字面量的 fake `upsert` 触发 apps/api typecheck 报
   缺字段——纯机械后果，补 `editedByUserId: null, editedAt: null` 两行，无行为改动。该文件在 `apps/api/src/`
   根（非 `services/routes/` 子目录），为守住我的 typecheck 验收门不可避免，如实列明。

6. **未做（防漂移，同设计 §8）**：团队技能回滚 HTTP 端点、提案深链存在性校验、用户记忆回收站视图、
   管理员审计他人用户记忆、memory_conflicts 管理面。前端（W-B/W-C）与挂载（集成者）均不在本工包。
