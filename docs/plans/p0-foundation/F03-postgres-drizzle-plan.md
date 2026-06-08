---
component: F03
title: PostgreSQL + Drizzle migrations — 系统级实现 plan
status: draft
depends: [F1, F2]
date: 2026-06-05
origin: docs/plans/2026-06-05-feat-workhub-p0-foundation-master-plan.md
inventory: docs/plans/p0-foundation/_migration-inventory.md
specs:
  - docs/workhub/01-architecture/data-model.md
  - docs/workhub/01-architecture/tech-stack-and-migration.md
  - docs/plans/p0-foundation/_ts-first-module-port-page-alignment.md
---

# F03 PostgreSQL + Drizzle migrations — 系统级实现 plan

> 地基第一道门(F2 之后)。换底座(SQLite→PostgreSQL),把"运行期 `create_all` + 幂等 ALTER"换成"Drizzle schema + Drizzle Kit 版本化迁移",并做 SQLite→PG **类型审校**(消灭 naive `utcnow`、Text-JSON→JSONB、`String(32)`→UUID、bool、编号 SEQUENCE/行锁)。
> 关键不变式:本组件**只换库、立迁移、审类型**,不碰鉴权链/权限/沙箱/事件 bus(各归 F4/F6/F8/F5)。解除单 worker 的"另一半"(broker)是 F5——**F3 单独完成后仍 `--workers 1`,与 F5 成对发布才能开多 worker**(Master §6 铁律 3)。
> 代码根:相对路径锚点指向当前工作目录「需求管理大师」(`app/`);文档锚点指向 `D:/WorkHub/docs`。

---

## 目标

1. **换 engine**:`DATABASE_URL` 切 `postgresql://…`,旧 `settings.database_url` / SQLite PRAGMA 只作为行为锚点;新实现落 `packages/db` 的 pg client + Drizzle 实例,补 PG 连接池配置。
2. **立 Drizzle 迁移体系**:`packages/db/src/schema/*` + `drizzle.config.ts` + 首迁移(从空 PG 库可重建全 schema)。删除运行期 `Base.metadata.create_all` + `ensure_runtime_schema`(`app/main.py:251-252`)行为。
3. **SQLite→PG 类型审校**:naive `datetime.utcnow()`→`timestamptz`(aware UTC);Text-JSON→`JSONB`;`String(32)` UUID→PG 原生 `UUID`;`is_admin` bool 的裸 `DEFAULT 0`→`false`;`Project.next_seq` 编号自增→PG `SEQUENCE` 或行级锁(为多 worker 预备,**实际开多 worker 在 F5**)。
4. **去运行期 schema 变更**:仓内不再有 `create_all` / 运行期 `ALTER` / `CREATE TABLE IF NOT EXISTS`;一切 schema 变更走 Drizzle migrations(Master §6 铁律 2、§8「无 `create_all`/运行时 ALTER」)。
5. **保留崩溃恢复的业务语义,但摘掉 schema 副作用**:`_resume_stuck_jobs`(`app/main.py:102-224`)是**业务恢复**不是 schema,F3 只把它依赖的 naive `utcnow` 时间数学(`main.py:116` 15 分钟 cutoff)改成 aware,执行编排下沉留给 F8/F11。

---

## 范围(In / Out)

### In(F3 必须)

- `packages/db/src/client.ts`:PG client、transaction helper、pool 配置、health check。
- `packages/config`: `DATABASE_URL` 默认改 PG，新增 `db.poolSize` / `db.maxOverflow` / migration env 读取口径(F1 已起 settings 重构,F3 落 DB 相关键)。
- Drizzle 迁移体系：`packages/db/src/schema/*`、`drizzle.config.ts`、`packages/db/migrations/*` 首迁移(覆盖 F2 落定的全部实体)。
- 去运行期 schema 变更：旧 `create_all` + `ensure_runtime_schema` / `schema_migrations.py` 只作为行为来源，其 ALTER/回填/孤儿清理逻辑**翻译进 Drizzle 首迁移**,不丢。
- 类型审校：`datetime.utcnow()` 行为锚点 → TS `clock.now()` / PG `timestamptz`；旧 `String(32)` UUID → PG UUID；Text-JSON → JSONB；SQLite bool 默认值清零。
- `Project.next_seq` 编号自增的并发原语(SEQUENCE 或 `SELECT … FOR UPDATE`)落到 `packages/db/src/sequences.ts`。
- Drizzle migration 可重建、可回滚、drift check、stuck-job 时间逻辑回归的验收用例。
- 最小 CI 关卡：空 PG 执行 `pnpm --filter @workhub/db db:migrate`，随后执行 `pnpm --filter @workhub/db db:check` 或等价 drift gate。

### Out(明确推迟 / 归他组件)

- **broker 化 / Redis / LISTEN-NOTIFY**:F5。**`--workers N` 实际开启在 F5**,F3 完成后仍 `--workers 1`。
- **行级锁/乐观锁的强一致合并路径**(`SELECT … FOR UPDATE` 锁 WorkItem+main branch 串行化 merge):属 F8 引擎/F10 快照;F3 只为 `next_seq` 编号落最小并发原语(SEQUENCE 优先,不引入业务锁)。
- **`version` 乐观锁列的写入语义/CAS 重试**:列由 F2 加(`__mapper_args__ version_id_col`),CAS 写入逻辑在 F8/状态机;F3 只保证列在迁移里存在且类型对。
- **`requirements`→`work_items` 改名**:由 F2 在模型层落定(牵动 15+ 表 FK);F3 的首迁移**以 F2 最终表名为准**,不在本组件决定改名策略。
- **JSONB GIN 索引、`WHERE deleted_at IS NULL` 偏索引**:F3 首迁移建**基础索引**(沿用现有热点 index);GIN/偏索引作为查询优化随 F2/F8 实际查询需求增量加,不阻塞 F3。
- **`_resume_stuck_jobs` 执行编排下沉到 worker 心跳**:F8/F11(`tech-stack §5.1 步骤 5`)。F3 只改它的时间口径。
- **`auth.py:94` 不更新 `last_seen_at` 的 SQLite 单写锁 hack 放开**:归 F4(安全敏感,逐字移植边界)。F3 不动 `auth.py`。
- **provider/budget/broker 配置块**:F1/F7;F3 只加 DB 相关 settings 键。

---

## 现状 → 改动(按 PORT / REFACTOR / NEW 分组)

### PORT(基本原样搬,PG 下天然生效)

- **`pool_pre_ping=True` / `future=True`**(`app/db.py:13-17`):注释明说为"未来换 PG/MySQL"埋点;PG 下 `pool_pre_ping` 才真正生效(SQLite 上是 no-op)。原样保留。
- **`SessionLocal(autoflush=False, autocommit=False, expire_on_commit=False)`**(`app/db.py:42`)、**`get_db()`**(`app/db.py:45-50`):会话语义不变,PG 下沿用。`expire_on_commit=False` 对"commit 后仍读对象"(lifecycle queue/flush 模式)是必要前提,保留。
- **非 sqlite 的 `connect_args={}` 分支**(`app/db.py:8`):已 PG-ready,`startswith("sqlite")` 为假即空 dict,无需改这一行逻辑。
- **`uid()=uuid4().hex`**(`app/models.py:12-13`):应用层生成 ID 的策略保留(daemon 事务前预知 ID、客户端乐观创建);仅**列类型**升 UUID(见 REFACTOR),值不变。
- **`TimestampMixin` 的 `server_default=func.now()` + `onupdate=func.now()`**(`app/models.py:20-24`):语义保留;仅把列类型加 `timezone=True`(REFACTOR)。PG 的 `now()` 返回 `timestamptz`,与目标口径一致。
- **`size_bytes` 用 `BigInteger`**(已是 PG `bigint`):无需改。
- **现有 `UniqueConstraint` / 热点 index**(`uq_delivery_req_round`、`uq_requirement_assignment_user`、`uq_knowledge_source`、`uq_project_drive_version_no`、`status`/`*_user_id`/`deleted_at`/`dedupe_key` 等,散落 `app/models.py` + `schema_migrations.py`):**全部翻译进首迁移**,约束/索引一个不少。
- **`schema_migrations.py` 的回填/孤儿清理 SQL 逻辑**(`owner_user_id` 按 `created_at` 守卫回填 `:89-100`;`requirement_assignments` 从 `claimed_by_user_id` 回填 `:163-177`;`meeting_insights.created_requirement_id` 单候选回填 `:441-515`;5 处 FK 孤儿置 NULL `:729-753`):这些是**已验证的数据修复语义**,翻译为首迁移的 `op.execute(...)` 数据迁移步(若 P0 走新仓重建无历史数据,则降级为"幂等保留但空跑";若带老库迁移,则保留全逻辑)。**逐字移植 SQL 谓词**,勿"顺手简化"(Master §6 铁律 4 的同源精神:已调试的数据修复不重写)。

### REFACTOR(搬过来要改)

- **删 SQLite PRAGMA hook**(`app/db.py:22-39`):`journal_mode=WAL`/`synchronous=NORMAL`/`busy_timeout=5000`/`foreign_keys=ON` 全是 SQLite 专属。PG 默认强制 FK、无需 busy_timeout。整段 `event.listens_for(...connect)` 删除。
  > 风险锚:此 hook 删除后,FK 约束改由 PG 原生强制(更可靠)。但**现有代码里凡是"依赖 FK 不强制"的隐性写法**(如 `schema_migrations.py:723-753` 那批孤儿置 NULL,正是为应对"PRAGMA foreign_keys=ON 后旧孤儿行 UPDATE 会失败")必须在首迁移里**先清孤儿再建 FK**,否则 PG 建约束即报错。
- **engine 连接串 + pool**(`app/db.py:10-19` / `app/config.py:9`):旧 `sqlite:////srv/yqgl/data/yqgl.db` 是行为锚点；新实现落 `packages/config` + `packages/db/src/client.ts`，默认 `postgresql://…`，去 `/srv/yqgl` 硬编码，经 env schema 注入 pool size / max connections。
- **`TimestampMixin` 时区**(`app/models.py:21-23`):`DateTime` → `DateTime(timezone=True)`(`created_at`/`updated_at`)。所有 `Mapped[Optional[datetime]] = mapped_column(DateTime)` 的业务时间列(`*_at`:`availability_updated_at`/`claimed_at`/`done_at`/`delivered_at`/`accepted_at`/`due_at`/`start_at`/`last_seen_at`/`revoked_at`/`deleted_at` 等)统一加 `timezone=True`。
- **naive `datetime.utcnow()` 全仓清零 → aware UTC**(Master §6 铁律 2、§9 风险 2、`tech-stack §6.3 步骤 3`):
  - 新建 `app/utils/time.py::utcnow()` 返回 `datetime.now(timezone.utc)`(aware),全仓替换裸 `datetime.utcnow()`。
  - **命门锚点 `app/main.py:116`**:`cutoff = datetime.utcnow() - timedelta(minutes=15)` 用于 stuck-job 清扫。naive cutoff 与 PG 取回的 `timestamptz`(aware)比较会 `TypeError` 或(若 driver 静默)**比较结果错却不报错** → stuck-job 可能永不触发或全触发。改 aware 后此比较正确。`app/main.py:138` 的 `delivery_doc_ready_at = datetime.utcnow()` 同改。
  - 全仓其余落点(`_migration-inventory` 点名 `auth.py:167` 等)统一过 helper。**F3 负责 DB/启动半边(`db.py`/`main.py`/`schema_migrations` 翻译);`auth.py` 的时间写虽也要 aware,但属 F4 逐字移植边界——F3 在交接清单里登记,F4 落实**,避免两组件同改 `auth.py` 撞车。
- **`is_admin` bool 默认值**(`app/models.py:38` ORM 层 `default=False` 透明;`schema_migrations.py:29` 裸 SQL `BOOLEAN DEFAULT 0`):Drizzle schema 用 PG `boolean` + `default(false)`，不要写裸 `DEFAULT 0`(`tech-stack §6.3`:PG 是真 `boolean`)。
- **PK/FK 列 `String(32)` → PG `UUID`**(`app/models.py:30/60/74/96/317…` 全实体 PK + 各 FK):Drizzle schema 统一 `uuid` 列；应用层 ID 形态由 F2 contracts 定，F3 只确保 FK 类型完全一致。**迁移期**若带老库：`ALTER … TYPE uuid USING col::uuid`；新仓重建则首迁移直接以 UUID 列建表。
  > 注：是否仍保留 32-hex 字符串作为 contract 表达由 F2 定；F3 跟随 F2 的 DTO/DB 类型映射，不在本 plan 里另拍板。
- **Text-JSON → `JSONB`**(`content_json`/`citations_json`/`trace_json`/`participant_user_ids_json`/`detail_json`/`payload_json` 等,`data-model §1.5`):Drizzle schema 使用 `jsonb`；默认值从 `"[]"`/`"{}"`(字符串)改为 JSONB `'[]'::jsonb`/`'{}'::jsonb`。GIN 索引推迟(见 Out)。
- **`Project.next_seq` 编号自增**(`app/models.py:87`;分配点 `requirements.py:127-128`、`meetings.py:545-546`、`project_drive.py:1662-1663`,均 5-try IntegrityError 重试):现靠 SQLite 单写者 + `code` UNIQUE 兜底安全。PG 多 worker 下 `read next_seq → +1 → INSERT` 会撞号(`data-model §9.4`、`open-questions MG-5`)。**F3 落地选型**:推荐 PG `SEQUENCE`(每项目一序列或全局序列 + 项目前缀映射)——`MG-5` 建议用 SEQUENCE。降级方案:分配点改 `SELECT … FOR UPDATE` 锁项目行。**注意**:`code` 的 UNIQUE 约束 + 现有 5-try 重试是**正确性兜底**,即便上 SEQUENCE 也保留(防御编号策略边界)。**实际多 worker 压测在 F5**;F3 只把原语就位,使"将来开 worker 不撞号"成立。
- **删运行期 schema 变更**(`app/main.py:251-252`):
  - `Base.metadata.create_all(engine)` 行为 → 不迁入 TS 新仓。schema 由 Drizzle migration(部署/CI 步骤,或 daemon 启动时**校验** migration head 而非建表)产生。
  - `ensure_runtime_schema(engine)` → 删除,逻辑翻译进首迁移。
  - lifespan(`app/main.py:236-267`)的业务语义交给 F11 重排；TS daemon 启动只做 migration head 校验，不建表、不 ALTER。可选新增"启动时校验 Drizzle migrations 已到 head,否则 fail-closed 拒绝启动"(防 schema 漂移,Master §8 精神;多 worker 下尤其重要,留 hook 给 F11 lifespan 重排)。

### NEW(WorkHub 全新)

- **`drizzle.config.ts`**：读取 `packages/config` 的 DB URL，不在配置文件硬编码连接串；migration 输出到 `packages/db/migrations/*`。
- **`packages/db/src/schema/*`**：以 F2 落定的全部实体与 contracts 为单一真相，生成首版 Drizzle schema；含全部 UniqueConstraint/index、FK、枚举与 JSONB/UUID/timestamptz 类型。
- **`packages/db/migrations/0001_initial.sql` 首迁移**：从空 PG 建出全 schema；回填/孤儿清理 SQL 翻译自 `schema_migrations.py` 的已验证行为，带老库时生效；新仓重建时幂等空跑。**首迁移以 F2 最终表名/列为单一真相**，F3 不重新定义实体。
- **`packages/config` 新增键**：`db.poolSize`、`db.maxConnections`、migration mode；`DATABASE_URL` 默认值改 PG。
- **`packages/time` / `packages/db/src/time.ts`**(若 F1 未起)：aware UTC helper + TS runtime 时间口径。
- **租户回填步**(若 F2 已加 `Org`/`Workspace` 且现有行需 `workspace_id` NOT NULL):首迁移先建默认 Org/Workspace 行,回填现有 `Project`/`WorkItem` 等 `workspace_id`,再加 NOT NULL 约束(`data-model §9.5 步骤 2`)。**先回填后约束**的顺序铁律。
- **CI 迁移校验步**：空 PG → `pnpm --filter @workhub/db db:migrate` → schema inspect / drift check → seed fixture。可选 down migration 只作为补强，R0 后强制门是“空库可重建 + drift check 无差异”。脚本归 F1 CI 框架,F3 供命令。

---

## 实施步骤(有序可勾选)

> 前置:F2 已落定 Drizzle schema 与 contracts(实体、表名最终态、`version`/`deleted_at`/tenant 列、`requirements→work_items` 改名决策)。F3 在 F2 的 `packages/db/src/schema/*` 之上工作。

- [ ] **0. 起一个本地 PG**:开发机 docker/本地 PG;`.env` 设 `DATABASE_URL=postgresql://…`(开发文档同步,F1 范围,这里仅依赖)。
- [ ] **1. 落 DB package**:`packages/db/src/client.ts` 创建 PG client、transaction helper、health check；`packages/config` 加 pool / max connections / migration mode。
- [ ] **2. 时间口径统一**:建 TS aware UTC helper；Drizzle schema 中所有 `*_at` 列使用 `timestamp with time zone`；旧 `main.py:116/138` 的 stuck-job cutoff 作为测试 fixture 迁入 TS worker/daemon 时间逻辑。
- [ ] **3. 类型审校落 schema**:PK/FK → `uuid`；Text-JSON → `jsonb`；`is_admin` → `boolean default false`；SQLite-only 默认值清零；人工核对**无静默类型漂移**。
- [ ] **4. 初始化 Drizzle Kit**:创建 `drizzle.config.ts`、`packages/db/migrations/*` 输出目录、`packages/db/src/migrate.ts`，并把连接串从 config 注入。
- [ ] **5. 写首迁移 0001**:由 F2 schema 生成骨架 → **人工补**:(a) `schema_migrations.py` 的回填/孤儿清理 SQL 翻译为 migration SQL;(b) 顺序铁律——**先清孤儿、再建 FK**;(c) 租户回填先于 `workspace_id` NOT NULL;(d) `next_seq` 的 SEQUENCE 创建(若选 SEQUENCE 方案)。
- [ ] **6. `next_seq` 并发原语**:落 `packages/db/src/sequences.ts`，提供 PG `SEQUENCE` 或 `FOR UPDATE` 取号 helper；旧 3 处分配点只作为行为锚点；**保留 `code` UNIQUE + 重试**作兜底。
- [ ] **7. 摘运行期 schema**:TS daemon 不含 runtime `create_all` / `ALTER` / `CREATE TABLE IF NOT EXISTS`；旧 Python 行为不迁入生产路由；可选加“启动校验 Drizzle migration head”fail-closed。
- [ ] **8. 全库重建验证**:空 PG → `pnpm --filter @workhub/db db:migrate` → 应用启动 → 跑现有冒烟(创建项目/需求、claim、deliver 一条闭环)。随后执行 schema inspect / drift check。
- [ ] **9. 回归 stuck-job 时间逻辑**:构造 `updated_at` 跨 15 分钟 cutoff 的 `running` job(PG `timestamptz`),验证 TS 恢复逻辑在 aware cutoff 下**正确触发**(不漏不全触发,Master §9 风险 2)。
- [ ] **10. CI 迁移校验**:接入 F1 CI 框架，加 `pnpm --filter @workhub/db db:migrate` + `pnpm --filter @workhub/db db:check` 或等价 drift gate。
- [ ] **11. 确认仍 `--workers 1`**:F3 单独发布**不开多 worker**(进程内单例未 broker 化,Master §6 铁律 3);在 README/部署文档显式标注"多 worker 需 F5"。

---

## 数据与接口契约

> 跨组件共享处以 Master Plan + 规格(`data-model.md`/`tech-stack-and-migration.md`)为准。F3 不新增 API 端点、不新增事件 topic;契约面集中在**迁移 + 类型 + 并发原语**。

### 实体字段(F3 关切的类型契约,实体定义归 F2)

- **时间列**:全部 `timestamptz`(`DateTime(timezone=True)`),应用写入 aware UTC。**消灭 naive**(`data-model §9.3`、Master §6 铁律 2)。
- **主键/外键**:PG 原生 `UUID`,值仍为 32-hex(应用层 `uid()` 生成,`data-model §9.2`)。
- **JSON 列**:`JSONB`(`content_json`/`citations_json`/`trace_json`/`participant_user_ids_json`/`detail_json`/`payload_json` 及 F2 新增 `signals_json`/`diff_manifest`/`handoff_json`/`payload_json` 等),默认 `'[]'::jsonb`/`'{}'::jsonb`。
- **布尔**:PG `boolean`,`server_default=sa.false()`(`is_admin`/`archived` 等)。
- **`version` 乐观锁列**:F2 加列、F3 保证迁移里 `Integer NOT NULL DEFAULT 0` 在位;**CAS 写入语义归 F8**(`data-model §9.4`)。
- **编号 `next_seq`/`PROJ-NNN`**:PG `SEQUENCE`(或行锁)分配;`code` UNIQUE 兜底保留。

### Drizzle 迁移契约

- **版本目录**:`packages/db/migrations/*`;首迁移 `0001_initial`,migration 链单线起步。
- **可重建性**:空 PG 执行 migration 可完整重建(Master §8 功能门禁);CI 强制。
- **drift 校验**:`drizzle-kit check` 或等价 schema diff 必须为零，防 schema / migration 漂移。
- **schema 真相源**:`packages/db/src/schema/*`(F2);contracts 与 DB 类型映射必须一致。
- **执行边界**:迁移由**部署/CI 步骤**或运维显式跑；**应用启动只校验 head,不建表/不 ALTER**(替代现 `create_all`+`ensure_runtime_schema`)。

### API / 事件 topic

- **API**:无新增(F3 不动路由)。`requirements→workitem` 端点改名由 F2/F11 处理。
- **事件 topic / taxonomy**:无新增(归 F5/F8/F9,Master §6 铁律 8)。F3 不发事件。

---

## 验收用例(可测)

- [ ] **AC-1 全库重建**:空 PG 库执行 `pnpm --filter @workhub/db db:migrate` 成功,生成 F2 全部表/约束/索引；随后 schema inspect / drift check 成功(Master §8「空库可重建」)。
- [ ] **AC-2 无运行期 schema**:全仓 grep 无 `Base.metadata.create_all`、无 `ensure_runtime_schema`、无运行期 `ALTER TABLE`/`CREATE TABLE IF NOT EXISTS`(Master §8「无 `create_all`/运行时 ALTER」);`app/services/schema_migrations.py` 已删。
- [ ] **AC-3 时间口径**:全仓 grep 无裸 `datetime.utcnow(`(均经 aware helper);DB inspect 显示时间列均 `timestamp with time zone`。
- [ ] **AC-4 stuck-job 时间逻辑回归**:插入 `updated_at` = now-20min 的 `running` BackgroundJob(timestamptz)→ 启动 `_resume_stuck_jobs` → 该 job 被标 `failed`、其 requirement 解冻;插入 now-5min 的 `running` job → **不被**误清。验证 aware cutoff 比较正确(Master §9 风险 2)。
- [ ] **AC-5 类型审校**:DB inspect 确认:PK/FK 列为 `uuid`;`*_json` 列为 `jsonb`;`is_admin` 为 `boolean` 默认 `false`。Drizzle drift check 报告与 schema 零残差。
- [ ] **AC-6 编号并发原语**:并发(进程级或线程级模拟)对同一 project 连续分配 `code`,无重复、无 `code` UNIQUE 冲突逃逸;SEQUENCE/行锁路径覆盖。
- [ ] **AC-7 FK 强制 + 孤儿清理**:带老库迁移场景下,首迁移"先清孤儿后建 FK"使 Drizzle migration 不因悬空 FK 失败;迁移后跑引用完整性检查无悬空(`data-model §9.5 步骤 7`)。
- [ ] **AC-8 现有闭环不破**:PG 上跑一条 `intake→澄清→执行→交付→验收/打回` 闭环冒烟(`tech-stack §5.2` 不变量),通知 queue/flush(`expire_on_commit=False` 依赖)正常。
- [ ] **AC-9 仍单 worker**:`--workers 2` 启动文档明确标注"未解禁,需 F5";F3 验收以 `--workers 1` 为基线。

---

## 回滚与风险

### 回滚策略

- **代码层**:F3 是 engine/迁移/类型的集中改动,以**单 PR/分支**承载;回滚 = revert 分支,`database_url` 切回 SQLite、恢复 `create_all`+`schema_migrations.py`(保留旧文件于 git 历史,revert 即回)。
- **迁移层**:Drizzle migration 以“空库可重建 + drift check”为主门；若启用 down migration，则必须在 CI 冒烟。**带历史数据时**:迁移前 `pg_dump` 全量备份,失败 `pg_restore`。
- **数据层**:LAN-first MVP 多走**新仓重建**(`tech-stack §6.3 步骤 4`),无历史数据则回滚成本最低(丢弃 PG 重来)。

### 风险与缓解(本组件 Top)

1. **SQLite→PG 类型强转静默出错(naive datetime ↔ timestamptz)**(Master §9 风险 2,首要):naive `utcnow` 与 aware `timestamptz` 比较**结果错却不报错**,直接坏掉 stuck-job 清扫(`main.py:116`)。→ 全仓 `utcnow` 清零过 aware helper;时间列全 `timezone=True`;AC-3/AC-4 强制回归。
2. **删 PRAGMA 后 PG 原生强制 FK → 旧孤儿行建约束即失败**:`schema_migrations.py:723-753` 的孤儿置 NULL 是为应对此;首迁移必须**先清孤儿再建 FK**(AC-7)。漏则 Drizzle migration 在带数据库上直接报错。
3. **`next_seq` 多 worker 撞号**(`open-questions MG-5`):F3 落 SEQUENCE/行锁原语,但**真正多 worker 在 F5**——F3 阶段单 worker 不暴露此风险,易被忽略未落原语 → F5 开 worker 时撞号。→ AC-6 在 F3 即验证并发分配,不等 F5。
4. **schema 生成漏抓 / 误抓**:`String(32)`→UUID、Text→JSONB 等类型变更可能生成不理想 DDL(尤其带数据的 `USING` 转换)。→ **人工逐表核对**首迁移；Drizzle drift check 入 CI(AC-5)。
5. **误开多 worker(成对约束)**:F3 单独完成后若有人 `--workers N`,进程内单例(push_bus/presence/并发槽/去重)静默脑裂(Master §6 铁律 3、§9 风险 1)。→ 部署文档/lifespan 显式约束;F3 验收基线 `--workers 1`(AC-9)。
6. **`auth.py` 时间写双组件撞车**:F3 改时间口径会触及 `auth.py:167`,但 `auth.py` 属 F4 逐字移植边界(Master §6 铁律 4)。→ F3 **不直接改 `auth.py`**,在交接清单登记由 F4 落 aware,避免重写鉴权链。

---

## 依赖与被依赖

### 依赖(上游)

- **F2 实体与模型移植**(直接前置):F3 的首迁移以 F2 落定的 `packages/db/src/schema/*`(实体全集、表名最终态、`requirements→work_items` 改名决策、`version`/`deleted_at`/tenant 列、UUID/JSONB 列类型决策)为单一真相。**F2 未定稿前 F3 首迁移不能定稿**。
- **F1 仓库/配置**(间接):settings 重构框架(`database_url` 经 settings、pool 键)、CI 框架(F3 供迁移校验步)、`app/utils/time.py` 落点(若 F1 起)。

### 被依赖(下游)

- **F5 事件 bus→broker**:与 F3 **成对**解除单 worker(Master §6 铁律 3、§5.1 成对约束)。F3 提供 PG 行锁/SEQUENCE 地基 + 多 worker-ready engine;F5 提供 broker。**两者都到位才 `--workers N`**。
- **F8 Agent 引擎核心**:依赖 F3 的 PG 行锁/乐观锁地基(`version` 列在位、`FOR UPDATE` 可用)实现分离任务竞态护栏(start-CAS / settle-on-drift / revert-only-if-in-flight 从单 worker SQLite 迁到行锁/乐观锁)。
- **F10 审计/快照**:依赖 F3 的"同事务"能力(PG 事务)实现"快照与业务写同一事务""快照失败⇒拒绝副作用"(Master §6 铁律 6)。
- **F9 生命周期/通知**:依赖 F3 的 `timestamptz` 正确性(SLA/cutoff 时间数学)。
- **F11 daemon 拆分**:lifespan 重排(F3 已摘 schema 步骤、留 head 校验 hook),多 worker leader 选举建立在 F3+F5 地基上。

---

## Target TS paths

> 本组件施工时,旧 `app/db.py` / `services/schema_migrations.py` 只作为迁移行为来源;新仓默认使用 Drizzle Kit。

| 类别 | 目标路径 | 必须产物 | 审计门禁 |
|---|---|---|---|
| DB package | `packages/db/src/client.ts`, `packages/db/src/migrate.ts` | PG client、transaction helper、health check | 不再 runtime `create_all` / ALTER |
| migrations | `packages/db/drizzle.config.ts`, `packages/db/migrations/*` | 首版 migration、seed fixture、drift check | `drizzle-kit check` 或等价 drift gate |
| type mapping | `packages/db/src/types.ts` | UUID/JSONB/timestamptz/citext 口径 | SQLite-only 默认值清零 |
| concurrency primitives | `packages/db/src/locks.ts`, `packages/db/src/sequences.ts` | WorkItem 行锁、Project 编号 sequence | 2-worker 前置门禁只在 F3+F5 后解 |

**PR 必答**:列出每个从 SQLite/SQLAlchemy 行为锚点迁到 PG/Drizzle 的类型转换。若迁移期临时保留旧 Python migration tooling,必须明确为兼容层,不得成为新仓默认路径。
