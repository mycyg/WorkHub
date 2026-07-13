# R12 Batch 0 BLOCKED（已解除）— Task 0C4 workbench bootstrap

日期: 2026-07-12
停止点: Batch 0 / Task 0C4 `GET /api/pages/workbench/:projectId` 的 fresh PostgreSQL 验收
状态: **RESOLVED；根因修复已提交，0C4 已从失败节点恢复**

> 历史说明：下方第 1–8 节保留首次阻塞时的原始证据与措辞，不能被理解为当前仍处于停止状态。当前结论与续跑证据以本节为准。

## 0. 解除阻塞与续跑证据

用户随后明确授权“授权所有权限 继续推进goal”，并进一步要求“恢复施工，编辑文件和规则，即便同一阻塞已连续出现多次，仍然需要持续施工”。据此，原第 7 节要求的人为裁决已满足；没有扩大到 R12 之外的改动。

根因修复提交:

```text
8dec71c9 fix(r12): align paused task plan database contract
```

该提交只包含四个获授权的 cause-fix 文件:

- `packages/db/migrations/0047_task_plan_paused_status.sql`
- `packages/db/migrations/meta/_journal.json`
- `packages/db/src/schema/core.ts`
- `packages/db/src/schema.test.ts`

修复和验证结果:

- 先取得精确 RED：聚焦 schema/migration/journal **4 total / 1 pass / 3 fail**，失败仅为缺少命名 CHECK、0047 和 journal 47。
- 完成 0047 后同一命令 **4 / 4 pass**；`@workhub/db` typecheck 和 scoped `git diff --check` 均为 exit 0。
- 已发布 migration 0031 未改动，SHA-256 仍为 `549939f8541bde287e4663d11c66b109b73aa25ef9dd92ab6bd5761ff74aac09`。
- `WORKHUB_MIGRATION_AUDIT_REQUIRE_DB=true ... pnpm audit:migrations` 在 PostgreSQL 16 上通过，同时覆盖 fresh 0000..0047 与 existing 0031..0047 replay；审计 scratch 清理后 `pg_database` 无 `workhub_migration_audit_*` 残留。
- 第一次恢复 DB matrix 使用 `workhub_r12_0c4_db_1783832805525`，真实暴露了另一个 SQL alias 根因：**7 total / 6 pass / 1 fail**，PostgreSQL 原始 SQLSTATE 为 `42P01 relation "workbench_viewer_membership" does not exist`。未吞错；该库已清理。
- 根因是 raw SQL 中的 Drizzle alias 被编译成未声明的物理 relation。改用内层作用域的真实表引用后，在新库 `workhub_r12_0c4_db_1783833183163` 重跑 DB matrix 为 **7 / 7 pass**；该库已清理。
- API 真实撤权链在 `workhub_r12_0c4_api_1783833201002` 为 **11 / 11 pass**，验证 200 → membership revoke → uniform 404；该库已清理。
- 独立审查 migration/schema cause-fix 为 **APPROVED，0 Critical / 0 Important / 0 Minor**。

因此，`paused` 的 contract / Drizzle schema / PostgreSQL CHECK 漂移已完成根因修复；0C4 可以继续完成剩余 review findings、package/root gates、精确 staging 与提交。上述后续工作尚未等同于 Batch 0 完成，也不允许提前进入 Batch 1。

## 1. 阻塞结论

Task 0C4 的 contracts、repository recorder、service、route 和 OpenAPI focused 测试已绿，但 fresh PostgreSQL 16 在插入冻结为活跃状态的 `paused` task plan 时被真实数据库约束拒绝。代码/协议与迁移后的数据库现实冲突，且修复需要 migration/schema 变更，超出 Task 0C4 allowed files。

按照执行手册和用户硬规则，本任务已停止。没有删除 `paused`、没有削弱断言、没有用其它状态冒充、没有绕开数据库约束，也没有继续后续批次。

## 2. 单一根因证据

三处当前 SSOT/运行时代码都承认 `paused`:

- `packages/contracts/src/enums.ts:52-55`: `taskPlanStatuses` 包含 `paused`，注释明确“暂停不是取消”。
- `packages/db/src/repositories/task-plans.ts:155-156`: `DASHBOARD_PLAN_STATUSES = ["proposed", "approved", "dispatching", "paused"]`。
- `packages/db/src/repositories/task-plans.ts:679-713`: repository 有真实 pause/resume 写路径，分别写入/读取 `paused`。

但 fresh migration 的数据库约束不承认 `paused`:

- `packages/db/migrations/0031_task_plans.sql:16`:

```sql
CONSTRAINT "task_plans_status_ck"
CHECK ("status" IN ('draft','proposed','approved','dispatching','done','cancelled'))
```

fresh DB 中 `pg_get_constraintdef` 的实际结果:

```text
CHECK (((status)::text = ANY ((ARRAY['draft'::character varying,
'proposed'::character varying,'approved'::character varying,
'dispatching'::character varying,'done'::character varying,
'cancelled'::character varying])::text[])))
```

对该 fresh DB 直接插入 `paused` 的原始 PostgreSQL 失败:

```text
ERROR:  new row for relation "task_plans" violates check constraint "task_plans_status_ck"
DETAIL:  Failing row contains
(86000000-0000-4000-8000-000000009999,
 86000000-0000-4000-8000-000000003001,
 86000000-0000-4000-8000-000000000002,
 paused, null, {}, {},
 86000000-0000-4000-8000-000000001000,
 2026-07-12 01:03:42.943641+00,
 2026-07-12 01:03:42.943641+00).
```

这不是 fixture 或查询装配问题；数据库自身的 check constraint 与现行合同/写路径不一致。

## 3. RED / GREEN 证据

### Tests-only RED

- Contracts focused: **28 total / 24 pass / 4 fail**；四个新增 workbench 测试均因缺少 `workbenchPageVmSchema` 失败。
- DB focused: **5 total / 0 pass / 5 fail**；因缺少 `createWorkbenchRepository` 和导出的 `DASHBOARD_PLAN_STATUSES` 失败。
- API workbench focused: **9 total / 0 pass / 9 fail**；因 service module/route 尚不存在失败。
- App/OpenAPI: **40 total / 38 pass / 2 fail**；精确失败为 workbench OpenAPI path 缺失、parameter 列表为空。

所有初始 RED 都是预期缺实现，不是测试编译错误或随机失败。

### 最小实现后的 focused GREEN

- Contracts focused: **28 / 28 pass**。
- DB recorder focused: **6 / 6 pass**；加入 opt-in PG test 后默认运行是 **7 total / 6 pass / 1 skip**。
- API service + route focused: **10 / 10 pass**；加入 opt-in PG endpoint chain 后默认运行是 **11 total / 10 pass / 1 skip**。
- App/OpenAPI: **40 / 40 pass**。
- Touched-package typecheck:
  - `@workhub/contracts`: pass
  - `@workhub/db`: pass
  - `@workhub/api`: pass
- `git diff --check`: pass。

类型检查期间出现并诚实修复了两处测试类型错误，没有改弱行为断言:

- `noUncheckedIndexedAccess` 下 `fullMembers[0]` spread 使必填字段变 optional；改为完整显式 fixture。
- `exactOptionalPropertyTypes` 禁止测试传 `userId: undefined`；非 human case 改为只传 `kind: "system"`。

## 4. Fresh PostgreSQL 证据

专用 scratch DB:

```text
workhub_r12_0c4_20260712_0055
```

执行方式:

1. 在 Docker PostgreSQL 16 中创建专用 fresh DB。
2. 用完整 migration chain 迁移。
3. 运行 env-gated `packages/db/src/workbench-repository.test.ts` 真实矩阵。
4. recorder 六项先全部通过；真实 PG fixture 在批量插入计划状态时到 `paused` 被 `task_plans_status_ck` 拒绝，最终 **7 total / 6 pass / 1 fail**。
5. 用 `pg_get_constraintdef` 读取实际约束，并单独执行一条 `paused` insert，得到上面的原始 PG 错误。

原计划且已写入可重复测试的 PG 断言包括:

- 137 active members → exact `total=137`, `returned=100`, `capped=true`, self first、owner second；inactive membership/deleted user 不泄露。
- 非管理员可见活跃计划 `7`、管理员 `8`；覆盖 proposed/approved/dispatching/paused、排除 draft/done/cancelled、private submitter/claimant/assignment/stranger、多 assignment 不放大。
- 最近文件五可见一隐藏；覆盖 current-version link、无 link、任一 readable、all-unreadable、legacy `accepted.project_id IS NULL`、old-version link 不污染 current version。
- active workspace/project/membership、archived/deleted/revoked fail-closed。
- API 链使用签名 cookie + 真实 users repo + 真实 workbench repo，设计为 authenticated actor 下 200 → membership revoke → uniform 404，并验证撤权后 child source 零新增调用与响应无敏感字段。

因为 migration 约束先失败，不能声称上述真实矩阵或 endpoint chain 已通过。

## 5. 已尝试 / 明确未尝试

已尝试:

- 按 TDD 完成 contract/repository/service/route/OpenAPI RED→GREEN。
- 增加严格 VM、bounded limits、access preflight/recheck、canonical UUID identity、错误 identity 保留和无损计数校验。
- 增加 recorder SQL 结构证明和两个 env-gated、只允许 `workhub_r12_0c4_*` 专用库的可重复 PG tests。
- 在 fresh PostgreSQL 16 完整迁移后运行真实 fixture。
- 查询实际 constraint definition，并用最小直接 insert 独立复现根因。
- 清理 scratch DB。

明确未尝试:

- 未修改 migration 或 schema；Task 0C4 不授权这些文件。
- 未删除 `paused`，未改期待计数，未把 `paused` 换成其它状态。
- 未用 mock 冒充真实 PG 成功。
- 未运行 API PG chain；DB 前置真实门已经在同一根因上失败。
- 未运行 packages 全量测试、root `pnpm -r typecheck`、`pnpm test`、`pnpm verify` 或最终 batch gate；当前批尚未通过真实 PG 门。
- 未做独立最终 review、未 targeted stage、未 commit。
- 未进入 Batch 1 或任何后续批次。

## 6. Scratch DB 清理

已执行:

```sql
DROP DATABASE IF EXISTS workhub_r12_0c4_20260712_0055 WITH (FORCE);
```

结果: `DROP DATABASE`。随后从 `pg_database` 查询该名称返回空，确认专用 scratch DB 已删除。

## 7. 需要人裁决

需要明确授权是否增加一个独立的 Batch 0 cause-fix，再恢复 0C4。建议的根因修复范围:

1. 新增 replay-safe migration（建议 `0047`），drop/recreate `task_plans_status_ck`，使允许值与 contract SSOT 完全一致并包含 `paused`。
2. 同步 Drizzle schema 的 status check/单一来源表达，避免 schema、migration 和 repository 再次漂移。
3. 更新 migration journal。
4. 增加 migration 静态审计、fresh replay、existing replay 和真实 paused insert tests；不得只改 TypeScript schema。
5. 在新的 clean scratch DB 重新运行完整 DB PG matrix 与 API 200→撤权→404 chain。
6. 之后才恢复 Task 0C4 的 package/root gates、独立 review、targeted stage 和 commit。

在获得这个授权并完成 cause-fix 前，0C4 和整个顺序施工均保持停止。

## 8. 续跑只读审计补充

后续只读历史审计确认了漂移的引入点:

- `4510b35d6` 首次引入 migration 0031、task-plan contracts/schema/repository；当时六个合法状态与数据库 CHECK 一致。
- `685863d80` 增加 `paused` 的 contracts、pause/resume repository、route/UI 全链路，但提交说明误判为“varchar 无迁移”，没有检查 0031 已存在的枚举式 CHECK，也没有修改 migration/schema/journal。
- 因而根因不是 0C4 查询实现，而是 2026-07-07 起已存在、此前 recorder/mock 测试未触达的数据库约束漂移。

若获授权，最小 cause-fix 文件集应严格限制为:

- 新增 `packages/db/migrations/0047_task_plan_paused_status.sql`；禁止改写已发布的 0031。
- 更新 `packages/db/migrations/meta/_journal.json` 尾项为 0047。
- 在 `packages/db/src/schema/core.ts` 为 `taskPlans` 声明同名 `task_plans_status_ck`，不再只依赖 `$type<TaskPlanStatus>()` 的编译期类型。
- 在 `packages/db/src/schema.test.ts` 锁住 schema check、0047 状态全集/执行顺序和 journal 47。

0047 必须在旧约束仍有效时建立并验证包含 `paused` 的临时 CHECK，再 drop 旧正式约束并把临时约束 rename 为 `task_plans_status_ck`；完成态再次执行也必须成功。仓库的 migration audit 会在 fresh 0000..0047 后再次 replay 0031..0047，因此“只在空库能跑”不算修复。`ADD/DROP CONSTRAINT` 会持有较强表锁，获授权后的执行与报告需要明确低流量/维护窗口假设，锁等待或验证失败必须直接报错，不能吞掉。

该只读审计没有修改 migration/schema，没有恢复 0C4，也没有改变本报告的 BLOCKED 状态。
