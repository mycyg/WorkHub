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

- `app/db.py`:engine 换 PG、删 PRAGMA hook、加 pool 配置。
- `app/config.py`:`database_url` 默认改 PG、新增 `db_pool_size`/`db_max_overflow`(F1 已起 settings 重构,F3 落 DB 相关键)。
- Alembic 脚手架:`alembic.ini`、`migrations/env.py`、`migrations/versions/0001_*.py` 首迁移(覆盖 F2 落定的全部实体)。
- 删 `app/main.py:251-252` 的 `create_all` + `ensure_runtime_schema`;删 `app/services/schema_migrations.py`(其 ALTER/回填/孤儿清理逻辑**翻译进首迁移**,不丢)。
- 类型审校:全仓 `datetime.utcnow()` → aware UTC 助手;`TimestampMixin` 改 `DateTime(timezone=True)`;模型 PK/FK 列 `String(32)`→PG `UUID`;Text-JSON 列→`JSONB`;`is_admin` 默认值审校。
- `Project.next_seq` 编号自增的并发原语(SEQUENCE 或 `SELECT … FOR UPDATE`)落地(3 处分配点)。
- Alembic up/down 可逆性、从空库重建、stuck-job 时间逻辑回归的验收用例。
- 最小 CI 关卡:`alembic upgrade head` 在空 PG 上跑通(Master §10「最小 CI:迁移校验」,归 F1 CI 框架,F3 提供迁移校验步骤)。

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
- **engine 连接串 + pool**(`app/db.py:10-19` / `app/config.py:9`):`config.py:9` 默认 `sqlite:////srv/yqgl/data/yqgl.db` → `postgresql+psycopg://…`(去 `/srv/yqgl` 硬编码,经 settings,Master §6 铁律 1);`create_engine` 增 `pool_size=settings.db_pool_size`、`max_overflow=settings.db_max_overflow`。driver 用 `psycopg`(v3,与 `_migration-inventory §1` REFACTOR 一致)。
- **`TimestampMixin` 时区**(`app/models.py:21-23`):`DateTime` → `DateTime(timezone=True)`(`created_at`/`updated_at`)。所有 `Mapped[Optional[datetime]] = mapped_column(DateTime)` 的业务时间列(`*_at`:`availability_updated_at`/`claimed_at`/`done_at`/`delivered_at`/`accepted_at`/`due_at`/`start_at`/`last_seen_at`/`revoked_at`/`deleted_at` 等)统一加 `timezone=True`。
- **naive `datetime.utcnow()` 全仓清零 → aware UTC**(Master §6 铁律 2、§9 风险 2、`tech-stack §6.3 步骤 3`):
  - 新建 `app/utils/time.py::utcnow()` 返回 `datetime.now(timezone.utc)`(aware),全仓替换裸 `datetime.utcnow()`。
  - **命门锚点 `app/main.py:116`**:`cutoff = datetime.utcnow() - timedelta(minutes=15)` 用于 stuck-job 清扫。naive cutoff 与 PG 取回的 `timestamptz`(aware)比较会 `TypeError` 或(若 driver 静默)**比较结果错却不报错** → stuck-job 可能永不触发或全触发。改 aware 后此比较正确。`app/main.py:138` 的 `delivery_doc_ready_at = datetime.utcnow()` 同改。
  - 全仓其余落点(`_migration-inventory` 点名 `auth.py:167` 等)统一过 helper。**F3 负责 DB/启动半边(`db.py`/`main.py`/`schema_migrations` 翻译);`auth.py` 的时间写虽也要 aware,但属 F4 逐字移植边界——F3 在交接清单里登记,F4 落实**,避免两组件同改 `auth.py` 撞车。
- **`is_admin` bool 默认值**(`app/models.py:38` ORM 层 `default=False` 透明;`schema_migrations.py:29` 裸 SQL `BOOLEAN DEFAULT 0`):首迁移用 SQLAlchemy `Boolean` + `server_default=sa.false()`,不要写裸 `DEFAULT 0`(`tech-stack §6.3`:PG 是真 `boolean`)。
- **PK/FK 列 `String(32)` → PG `UUID`**(`app/models.py:30/60/74/96/317…` 全实体 PK + 各 FK):列类型升 `sqlalchemy.dialects.postgresql.UUID(as_uuid=False)`(应用层仍传 32-hex 字符串,`data-model §9.2`)。**迁移期**若带老库:`ALTER … TYPE uuid USING col::uuid`;新仓重建则首迁移直接以 UUID 列建表。FK 列同步改 UUID,否则类型不匹配建 FK 失败。
  > 注:`data-model §9.2` 允许 `as_uuid=False`(应用层仍是 hex 字符串,改动面最小)。是否启 `as_uuid=True` 由 F2 模型层定调;F3 首迁移**跟随 F2 的列类型决定**,本 plan 不替 F2 拍板。
- **Text-JSON → `JSONB`**(`content_json`/`citations_json`/`trace_json`/`participant_user_ids_json`/`detail_json`/`payload_json` 等,`data-model §1.5`):列类型 `Text` → `postgresql.JSONB`。**应用层手动 `json.loads/dumps` 落点**(如 `llm_agent.py` 手动 `json.loads`)需配合 F2 改读写(交给 ORM 直接存取 dict/list)。F3 保证迁移里列类型对、默认值从 `"[]"`/`"{}"`(字符串)改为 JSONB `'[]'::jsonb`/`'{}'::jsonb`。GIN 索引推迟(见 Out)。
- **`Project.next_seq` 编号自增**(`app/models.py:87`;分配点 `requirements.py:127-128`、`meetings.py:545-546`、`project_drive.py:1662-1663`,均 5-try IntegrityError 重试):现靠 SQLite 单写者 + `code` UNIQUE 兜底安全。PG 多 worker 下 `read next_seq → +1 → INSERT` 会撞号(`data-model §9.4`、`open-questions MG-5`)。**F3 落地选型**:推荐 PG `SEQUENCE`(每项目一序列或全局序列 + 项目前缀映射)——`MG-5` 建议用 SEQUENCE。降级方案:分配点改 `SELECT … FOR UPDATE` 锁项目行。**注意**:`code` 的 UNIQUE 约束 + 现有 5-try 重试是**正确性兜底**,即便上 SEQUENCE 也保留(防御编号策略边界)。**实际多 worker 压测在 F5**;F3 只把原语就位,使"将来开 worker 不撞号"成立。
- **删运行期 schema 变更**(`app/main.py:251-252`):
  - `Base.metadata.create_all(engine)` → 删除。schema 由 `alembic upgrade head`(部署/CI 步骤,或 lifespan 启动时**校验** head 而非建表)产生。
  - `ensure_runtime_schema(engine)` → 删除,逻辑翻译进首迁移。
  - lifespan(`app/main.py:236-267`)保留 data-dir mkdir、`cleanup_stale_partials`、`_resume_stuck_jobs`、周期任务;**仅移除 schema 建/补两行**。可选新增"启动时校验 `alembic current == head`,否则 fail-closed 拒绝启动"(防 schema 漂移,Master §8 精神;多 worker 下尤其重要,留 hook 给 F11 lifespan 重排)。

### NEW(WorkHub 全新)

- **`alembic.ini`**:`script_location = migrations`、`sqlalchemy.url` 从 `settings.database_url` 注入(env.py 内覆盖,不在 ini 里硬编码连接串,Master §6 铁律 1)。
- **`migrations/env.py`**:`target_metadata = Base.metadata`(import `app.models.Base`);offline/online 两模式;`compare_type=True`、`compare_server_default=True`(让 autogenerate 抓类型/默认值漂移,辅助后续迁移)。注入 `settings.database_url`。
- **`migrations/versions/0001_initial.py` 首迁移**:`upgrade()` 建 F2 落定的**全部实体**(以 F2 核验为准 = **41 张表**:28 现有类 − 2 演进吸收(`RevisionRequest`→`Review`、`ActivityLog`→`AuditLog`)+ 15 新增 = `Org/Workspace/UserProfile/Branch/Proposal/Review/SpecDoc/AgentRun/AgentStep/ConfidenceRecord/EscalationEvent/Snapshot/PermissionPolicy/ApprovalRequest/AuditLog`;Master §5 的「35 实体」为含人侧子表的概数,实体数以 F2 单一真相为准),含全部 UniqueConstraint/index;`op.execute(...)` 跑回填/孤儿清理(翻译自 `schema_migrations.py`,带老库时生效);`downgrade()` 反向 drop(up/down 可逆,Master §10 测试策略要求)。**首迁移以 F2 最终表名/列为单一真相**——F3 不重新定义实体,只把 F2 的 `Base.metadata` 固化为版本化迁移。
- **`app/config.py` 新增键**:`db_pool_size: int`、`db_max_overflow: int`(F1 settings 重构框架下);`database_url` 默认值改 PG。
- **`app/utils/time.py`**(若 F1 未起):`utcnow()` aware 助手 + 全仓替换。
- **租户回填步**(若 F2 已加 `Org`/`Workspace` 且现有行需 `workspace_id` NOT NULL):首迁移先建默认 Org/Workspace 行,回填现有 `Project`/`WorkItem` 等 `workspace_id`,再加 NOT NULL 约束(`data-model §9.5 步骤 2`)。**先回填后约束**的顺序铁律。
- **CI 迁移校验步**:`alembic upgrade head`(空 PG)→ `alembic downgrade base` → 再 `upgrade head` 可逆冒烟;可选 `alembic check`(autogenerate 无残差,确保模型与迁移同步)。脚本归 F1 CI 框架,F3 供命令。

---

## 实施步骤(有序可勾选)

> 前置:F2 已落定模型层(实体、表名最终态、`version`/`deleted_at`/tenant 列、`requirements→work_items` 改名决策)。F3 在 F2 的 `Base.metadata` 之上工作。

- [ ] **0. 起一个本地 PG**:开发机 docker/本地 PG;`.env` 设 `DATABASE_URL=postgresql+psycopg://…`(开发文档同步,F1 范围,这里仅依赖)。
- [ ] **1. 换 engine**:`app/db.py` 删 PRAGMA hook(`:22-39`);`create_engine` 加 `pool_size`/`max_overflow`;`config.py:9` 默认改 PG;`config.py` 加 `db_pool_size`/`db_max_overflow`;确认 `connect_args` 分支对 PG 为空。
- [ ] **2. 时间口径统一**:建 `utcnow()` aware 助手;`TimestampMixin` 列加 `timezone=True`;全仓业务 `*_at` 列加 `timezone=True`;全仓 `datetime.utcnow()` 过 helper。**重点改 `main.py:116/138` 的 stuck-job cutoff**;在交接清单登记 `auth.py` 时间写(F4 落实)。
- [ ] **3. 类型审校落模型**:PK/FK `String(32)`→`UUID`(跟随 F2 决策);Text-JSON→`JSONB`(默认值改 jsonb 字面量);`is_admin` `server_default=sa.false()`。运行 `alembic revision --autogenerate` 预览,人工核对**无静默类型漂移**。
- [ ] **4. 初始化 Alembic**:`alembic init migrations`;改 `env.py`(target_metadata=Base.metadata、注入 settings.url、compare_type/server_default=True);`alembic.ini` 的 url 留给 env.py 注入。
- [ ] **5. 写首迁移 0001**:由 autogenerate 生成骨架 → **人工补**:(a) `schema_migrations.py` 的回填/孤儿清理 SQL 翻译为 `op.execute`;(b) 顺序铁律——**先清孤儿、再建 FK**(对应删 PRAGMA 后 PG 强制 FK);(c) 租户回填先于 `workspace_id` NOT NULL;(d) `next_seq` 的 SEQUENCE 创建(若选 SEQUENCE 方案);(e) `downgrade()` 反向。
- [ ] **6. `next_seq` 并发原语**:落 PG `SEQUENCE`(或 `FOR UPDATE`);改 3 处分配点(`requirements.py:127`、`meetings.py:545`、`project_drive.py:1662`)取号方式;**保留 `code` UNIQUE + 5-try 重试**作兜底。
- [ ] **7. 摘运行期 schema**:删 `main.py:251-252`(`create_all`+`ensure_runtime_schema`);删 `app/services/schema_migrations.py`;lifespan 仅保业务步骤;可选加"启动校验 alembic head"fail-closed。
- [ ] **8. 全库重建验证**:空 PG → `alembic upgrade head` → 应用启动 → 跑现有冒烟(创建项目/需求、claim、deliver 一条闭环)。`alembic downgrade base` → `upgrade head` 可逆冒烟。
- [ ] **9. 回归 stuck-job 时间逻辑**:构造 `updated_at` 跨 15 分钟 cutoff 的 `running` job(PG `timestamptz`),验证 `_resume_stuck_jobs` 在 aware cutoff 下**正确触发**(不漏不全触发,Master §9 风险 2)。
- [ ] **10. CI 迁移校验**:接入 F1 CI 框架,加 `alembic upgrade head` + 可逆 + `alembic check` 步骤。
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

### Alembic 契约

- **版本目录**:`migrations/versions/`;首迁移 `0001_initial`,revision 链单线起步。
- **可逆性**:每条迁移 `upgrade`+`downgrade` 成对(Master §10「up/down 可逆测试」)。
- **head 校验**:`alembic upgrade head` 从空库可完整重建(Master §8 功能门禁);CI 强制。
- **schema 真相源**:`app.models.Base.metadata`(F2);env.py 的 `target_metadata` 指向它;`alembic check` 防模型/迁移漂移。
- **执行边界**:迁移由**部署/CI 步骤**或运维显式跑;**应用启动只校验 head,不建表/不 ALTER**(替代现 `create_all`+`ensure_runtime_schema`)。

### API / 事件 topic

- **API**:无新增(F3 不动路由)。`requirements→workitem` 端点改名由 F2/F11 处理。
- **事件 topic / taxonomy**:无新增(归 F5/F8/F9,Master §6 铁律 8)。F3 不发事件。

---

## 验收用例(可测)

- [ ] **AC-1 全库重建**:空 PG 库执行 `alembic upgrade head` 成功,生成 F2 全部表/约束/索引;`alembic downgrade base` 清空成功;再 `upgrade head` 幂等成功(Master §8「`alembic upgrade head` 从空库可重建」)。
- [ ] **AC-2 无运行期 schema**:全仓 grep 无 `Base.metadata.create_all`、无 `ensure_runtime_schema`、无运行期 `ALTER TABLE`/`CREATE TABLE IF NOT EXISTS`(Master §8「无 `create_all`/运行时 ALTER」);`app/services/schema_migrations.py` 已删。
- [ ] **AC-3 时间口径**:全仓 grep 无裸 `datetime.utcnow(`(均经 aware helper);DB inspect 显示时间列均 `timestamp with time zone`。
- [ ] **AC-4 stuck-job 时间逻辑回归**:插入 `updated_at` = now-20min 的 `running` BackgroundJob(timestamptz)→ 启动 `_resume_stuck_jobs` → 该 job 被标 `failed`、其 requirement 解冻;插入 now-5min 的 `running` job → **不被**误清。验证 aware cutoff 比较正确(Master §9 风险 2)。
- [ ] **AC-5 类型审校**:DB inspect 确认:PK/FK 列为 `uuid`;`*_json` 列为 `jsonb`;`is_admin` 为 `boolean` 默认 `false`。autogenerate `alembic check` 报告与模型零残差。
- [ ] **AC-6 编号并发原语**:并发(进程级或线程级模拟)对同一 project 连续分配 `code`,无重复、无 `code` UNIQUE 冲突逃逸;SEQUENCE/行锁路径覆盖。
- [ ] **AC-7 FK 强制 + 孤儿清理**:带老库迁移场景下,首迁移"先清孤儿后建 FK"使 `alembic upgrade head` 不因悬空 FK 失败;迁移后跑引用完整性检查无悬空(`data-model §9.5 步骤 7`)。
- [ ] **AC-8 现有闭环不破**:PG 上跑一条 `intake→澄清→执行→交付→验收/打回` 闭环冒烟(`tech-stack §5.2` 不变量),通知 queue/flush(`expire_on_commit=False` 依赖)正常。
- [ ] **AC-9 仍单 worker**:`--workers 2` 启动文档明确标注"未解禁,需 F5";F3 验收以 `--workers 1` 为基线。

---

## 回滚与风险

### 回滚策略

- **代码层**:F3 是 engine/迁移/类型的集中改动,以**单 PR/分支**承载;回滚 = revert 分支,`database_url` 切回 SQLite、恢复 `create_all`+`schema_migrations.py`(保留旧文件于 git 历史,revert 即回)。
- **迁移层**:每条 Alembic 迁移 `downgrade` 可逆;`alembic downgrade <rev>` 回退 schema。**带历史数据时**:迁移前 `pg_dump` 全量备份,失败 `pg_restore`。
- **数据层**:LAN-first MVP 多走**新仓重建**(`tech-stack §6.3 步骤 4`),无历史数据则回滚成本最低(丢弃 PG 重来)。

### 风险与缓解(本组件 Top)

1. **SQLite→PG 类型强转静默出错(naive datetime ↔ timestamptz)**(Master §9 风险 2,首要):naive `utcnow` 与 aware `timestamptz` 比较**结果错却不报错**,直接坏掉 stuck-job 清扫(`main.py:116`)。→ 全仓 `utcnow` 清零过 aware helper;时间列全 `timezone=True`;AC-3/AC-4 强制回归。
2. **删 PRAGMA 后 PG 原生强制 FK → 旧孤儿行建约束即失败**:`schema_migrations.py:723-753` 的孤儿置 NULL 是为应对此;首迁移必须**先清孤儿再建 FK**(AC-7)。漏则 `upgrade head` 在带数据库上直接报错。
3. **`next_seq` 多 worker 撞号**(`open-questions MG-5`):F3 落 SEQUENCE/行锁原语,但**真正多 worker 在 F5**——F3 阶段单 worker 不暴露此风险,易被忽略未落原语 → F5 开 worker 时撞号。→ AC-6 在 F3 即验证并发分配,不等 F5。
4. **autogenerate 漏抓 / 误抓**:`String(32)`→UUID、Text→JSONB 等类型变更 autogenerate 可能生成不理想 DDL(尤其带数据的 `USING` 转换)。→ `compare_type=True` + **人工逐表核对**首迁移;`alembic check` 入 CI(AC-5)。
5. **误开多 worker(成对约束)**:F3 单独完成后若有人 `--workers N`,进程内单例(push_bus/presence/并发槽/去重)静默脑裂(Master §6 铁律 3、§9 风险 1)。→ 部署文档/lifespan 显式约束;F3 验收基线 `--workers 1`(AC-9)。
6. **`auth.py` 时间写双组件撞车**:F3 改时间口径会触及 `auth.py:167`,但 `auth.py` 属 F4 逐字移植边界(Master §6 铁律 4)。→ F3 **不直接改 `auth.py`**,在交接清单登记由 F4 落 aware,避免重写鉴权链。

---

## 依赖与被依赖

### 依赖(上游)

- **F2 实体与模型移植**(直接前置):F3 的首迁移以 F2 落定的 `Base.metadata`(实体全集、表名最终态、`requirements→work_items` 改名决策、`version`/`deleted_at`/tenant 列、UUID/JSONB 列类型决策)为单一真相。**F2 未定稿前 F3 首迁移不能定稿**。
- **F1 仓库/配置**(间接):settings 重构框架(`database_url` 经 settings、pool 键)、CI 框架(F3 供迁移校验步)、`app/utils/time.py` 落点(若 F1 起)。

### 被依赖(下游)

- **F5 事件 bus→broker**:与 F3 **成对**解除单 worker(Master §6 铁律 3、§5.1 成对约束)。F3 提供 PG 行锁/SEQUENCE 地基 + 多 worker-ready engine;F5 提供 broker。**两者都到位才 `--workers N`**。
- **F8 Agent 引擎核心**:依赖 F3 的 PG 行锁/乐观锁地基(`version` 列在位、`FOR UPDATE` 可用)实现分离任务竞态护栏(start-CAS / settle-on-drift / revert-only-if-in-flight 从单 worker SQLite 迁到行锁/乐观锁)。
- **F10 审计/快照**:依赖 F3 的"同事务"能力(PG 事务)实现"快照与业务写同一事务""快照失败⇒拒绝副作用"(Master §6 铁律 6)。
- **F9 生命周期/通知**:依赖 F3 的 `timestamptz` 正确性(SLA/cutoff 时间数学)。
- **F11 daemon 拆分**:lifespan 重排(F3 已摘 schema 步骤、留 head 校验 hook),多 worker leader 选举建立在 F3+F5 地基上。
