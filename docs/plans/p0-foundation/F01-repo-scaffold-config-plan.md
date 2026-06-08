---
component: F01
title: 仓库/构建脚手架 + 配置 — 系统级实现 plan
status: draft
depends: []
blocks: [F02, F03, F04, F05, F06, F07, F08, F09, F10, F11]
type: feat
date: 2026-06-05
master: ../2026-06-05-feat-workhub-p0-foundation-master-plan.md
inventory: ./_migration-inventory.md
specs:
  - ../../workhub/01-architecture/tech-stack-and-migration.md
  - ../../workhub/01-architecture/security-and-permissions.md
  - ./_ts-first-module-port-page-alignment.md
---

# F01 — 仓库/构建脚手架 + 配置(系统级 plan)

> P0「地基之地基」的第一块砖。本组件**不引入业务逻辑、不碰运行时行为**,只把现有
> 「需求管理大师」骨架改造成 **可移植的 TS-first greenfield 起点**:pnpm workspace、Node 22/Hono API、Drizzle 配置、env schema 收口、去 `/srv/yqgl`
> 硬编码、补 provider/budget/broker 配置块、Tauri/Web workspace 校准、最小 CI 扩展。
> 依赖图见 [Master §5.1](../2026-06-05-feat-workhub-p0-foundation-master-plan.md);本组件 **blocks 全部**,故求**小、稳、零行为变更**。
> 代码锚点均经实际核验(见 [迁移清单 §1](./_migration-inventory.md));文件路径相对当前工作目录(需求管理大师)。

---

## 目标

1. **可移植(Master §6 铁律 1):** 一切路径/URL/密钥经 `settings`;运行时代码里**零** `/srv/yqgl` 类绝对路径硬编码。当前开发机是 Windows,现状 `config.py:9-10` + `main.py:339` + `main.py:469` 的 POSIX 绝对路径在本机直接不可用——这是 F01 必须先拆的墙。
2. **配置面向 WorkHub 扩展(为后续组件预留接口,不实现逻辑):** `packages/config` 增 PG pool、broker URL、provider-registry、三级预算默认值的**env schema**(F03/F05/F07/F08 各自消费)。
3. **`DATABASE_URL` 默认翻面:** 默认值由 `sqlite:////srv/yqgl/...` 行为锚点改为 `postgresql://...`(Master §6 铁律 2、tech-stack §6.3 步骤 1),但**实际换库/删 PRAGMA/Drizzle migrations init 是 F03 的事**——F01 只改默认串与配置形。
4. **fail-closed 生产门逐字保留(Master §6 铁律 4 + 安全篇 §3.4):** `_validate_runtime_config`(`main.py:227`)是已验证的安全资产,F01 **原样保留**,新增配置项**不削弱**它。
5. **最小 CI:** 现仓**已有** `.github/workflows/verify.yml`(web typecheck + backend smoke + rust check);F01 **扩展**它增加 lint + 迁移校验占位 + 配置可移植性回归,而非从零起 CI。
6. **pnpm workspace 校准:** 新仓默认 `apps/*` + `packages/*` + `client-tauri`;现有 `shared/web/client-tauri`、`@yqgl/shared` 作为迁移锚点——F01 做命名/描述/脚本的 greenfield 校准与文档。

> 北极星验收:一个全新 clone 在 **Windows 与 Linux 上**都能 `pnpm install` + `pnpm typecheck` + Tauri/Rust check 起来、读取 TS env schema 不触碰任何 `/srv/yqgl` 路径、`verify` CI 全绿。

---

## 范围(Scope)

### In(F01 必做)

- **REFACTOR** `app/config.py`:去硬编码默认、加 PG pool / broker / provider-registry / budget 配置块、`database_url` 默认翻 PG、删误导注释。
- **REFACTOR** `app/main.py`:`DOWNLOADS_ROOT`(`:339`)与 `WEB_ROOT`(`:469`)从硬编码 `/srv/yqgl/...` 改为派生自 `settings`(新增 `downloads_dir` / `web_dist_dir` 设置项,默认相对 `data_dir`)。**仅做路径来源替换,不改 SPA 托管/下载逻辑本身**(剥离 SPA 是 F11)。
- **REFACTOR** `app/models.py:37`:删/修 `YQGL_ADMIN_NICKNAMES` 误导注释(全仓无消费者,安全篇 §2.4 已点名)。
- **PORT** pydantic-settings 模式、`_validate_runtime_config` fail-closed 门、npm workspace、`@yqgl/shared` —— 原样保留,仅在其上扩展。
- **NEW(仅配置 schema + 文档,不含逻辑):** provider-registry 配置块、三级预算默认、broker 连接配置、PG pool 配置;`.env.example` 模板;Windows/Linux 双平台 README 起步说明。
- **CI:** 扩 `verify.yml` 增 `ruff`/`tsc` lint 显式步、配置可移植性回归(导入 config 不触磁盘绝对路径)、Drizzle 迁移校验**占位**(F03 落地后填实)。

### Out(明确推迟,标注去向)

- **删 SQLite PRAGMA、换 PG engine、Drizzle Kit init + 首迁移** → **F03**(F01 只翻默认串与加 pool 配置形)。
- **剥离 SPA 静态托管(`main.py:469-498` 删除)** → **F11**(F01 只把 `WEB_ROOT` 来源去硬编码,保留挂载逻辑,确保迁移期闭环不断,tech-stack §5.2 不变量)。
- **provider 注册表实现(`app/llm/`、7 处改接)** → **F07**(F01 只落配置块)。
- **broker 适配器实现、Redis/LISTEN-NOTIFY** → **F05**(F01 只落连接配置串)。
- **AgentRun 预算逻辑、RunBudget** → **F08**(F01 只落三级预算默认值配置)。
- **Org/Workspace 实体与多租户配置消费** → **F02/P5**(F01 不建实体)。
- **OpenAPI 客户端生成、跨域 CORS/cookie 重解** → **F11**(F01 保留现有 `cors_allow_origins` 与生产门不动)。
- **真凭证替昵称、强制 HTTPS/HSTS、egress 封网** → **P1+/上云**(安全篇 §1.3 升级项 R1–R6,F01 不触碰)。

---

## 现状 → 改动(按 PORT / REFACTOR / NEW 分组)

### PORT(逐字/原样移植,不重写)

| # | 资产 | 锚点 | 处置 |
|---|---|---|---|
| P1 | pydantic-settings 单 `Settings` 类 | `app/config.py:6-46` | 保留类结构与 `model_config`(`:7`);仅**新增字段**,不改既有字段语义 |
| P2 | 生产 fail-closed 门 `_validate_runtime_config` | `app/main.py:227-233` | **逐字保留**(Master §6 铁律 4)。默认 cookie_secret 或 `CORS=*` → `RuntimeError`。新增项不得放松;若新增项也是"弱默认在生产即危险"(如空 broker URL 上多 worker),按相同 fail-closed 风格**追加校验**而非削弱 |
| P3 | npm workspaces + `@yqgl/shared` 真包 | `package.json:6-10`、`shared/package.json:2` | 已含 `shared/web/client-tauri`、`@yqgl/shared` 已被 web/tauri 依赖(`web/package.json:14`、`client-tauri/package.json:14`)。**保留**,仅校准描述/脚本 |
| P4 | 现有 CI 三 job | `.github/workflows/verify.yml`(web/backend/rust) | **保留并扩展**,不重写。`smoke_workflow.py`(offline TestClient,空 LLM key)是已有 backend smoke,继续用 |
| P5 | `scripts/set_admin.py` 带外授权 + `YQGL_BOOTSTRAP_NICKNAMES` | `scripts/set_admin.py:8/90` | 不动(安全敏感,F04 范畴);F01 只删 `models.py:37` 的误导注释 |

### REFACTOR(搬过来要改)

| # | 改动 | 锚点 | 要点 |
|---|---|---|---|
| R1 | `database_url` 默认翻 PG | `config.py:9` | `"sqlite:////srv/yqgl/data/yqgl.db"` → `"postgresql+psycopg://workhub:workhub@127.0.0.1:5432/workhub"`(占位,经 `.env` 覆盖)。**只翻默认串**;`db.py:8/22` 的 `startswith("sqlite")` 分支已 PG-ready(tech-stack §6.3 "几乎零改动"),实际换库 = F03 |
| R2 | `data_dir` 去 POSIX 硬编码 | `config.py:10` | `Path("/srv/yqgl/data")` → 默认相对路径(如 `Path("./data")` 或 `Path.cwd()/"data"`),经 `DATA_DIR` env 覆盖。Windows 开发机即可直接起 |
| R3 | `DOWNLOADS_ROOT` 去硬编码 | `main.py:339` | 新增 `settings.downloads_dir: Path`(默认 `data_dir/"downloads"` 或独立 env),`main.py` 改读 `settings.downloads_dir`。**逻辑不变**,仅来源替换 |
| R4 | `WEB_ROOT` 去硬编码 | `main.py:469` | 新增 `settings.web_dist_dir: Path | None`(默认 `None` ⇒ 现有 else 分支"前端走 dev server"提示生效)。`main.py:470` 的 `if WEB_ROOT.is_dir()` 守卫保留 ⇒ 行为对等。**保留 SPA 挂载**(剥离=F11) |
| R5 | 删误导注释 | `models.py:37` | 删 `YQGL_ADMIN_NICKNAMES` 提及(全仓无消费者,安全篇 §2.4 §130);唯一入口是 `YQGL_BOOTSTRAP_NICKNAMES` |
| R6 | `cors_allow_origins` 注释 | `config.py:43` | 值保留 `["*"]`(LAN 默认,被生产门 P2 兜底);仅补注释指向安全篇 R3 上云强制项。**不改 CORS 逻辑**(F11) |

### NEW(全新,F01 仅落配置 schema + 文档,零业务逻辑)

| # | 新增 | 落点 | 服务的下游组件 | 说明 |
|---|---|---|---|---|
| N1 | PG pool 配置块 | `config.py` 新字段 | F03 | `db_pool_size:int=5`、`db_max_overflow:int=10`、`db_pool_timeout:int=30`(tech-stack §6.3 步骤 1 "补 pool_size/max_overflow")。F01 只声明,F03 喂给 `create_engine` |
| N2 | broker 连接配置 | `config.py` 新字段 | F05 | `broker_url:str=""`、`broker_backend:str="memory"`(`memory`\|`redis`\|`pg_listen`)。空 + 多 worker 在生产 → P2 追加 fail-closed(防 split-brain,Master §6 铁律 3) |
| N3 | provider-registry 配置块 | `config.py` 新字段 / 嵌套模型 | F07 | 把现 `llm_base_url/model/api_key`(`config.py:22-24`)收编为 `providers` 结构的默认 `deepseek` 条目(端点+鉴权+模型+成本档占位);**保持向后兼容**(7 处现仍读旧字段,F07 才改接) |
| N4 | P-COST v0 预算 seed | `packages/config/src/cost.ts` / env schema | F08 / P-COST | 单 run `15 steps / 300s / 120000 tokens / 5 CNY`;用户日 `500000 tokens / 20 CNY`;团队日 `5000000 tokens / 200 CNY`;团队月 `50000000 tokens / 2000 CNY`。F01 只给可覆盖默认值,业务裁决在 `packages/cost` |
| N5 | 派生路径设置项 | `config.py` 新字段 | F01 自身(R3/R4) | `downloads_dir`、`web_dist_dir`,默认派生自 `data_dir` 或 `None` |
| N6 | `.env.example` | 新文件(根或 `app/`) | 全部 | 列全部 env 键 + Windows/Linux 注释样例;**不含真实密钥** |
| N7 | greenfield README 起步段 | `README` / `docs` | 全部 | Windows 与 Linux 双平台 `pnpm install` + `pnpm typecheck` + 起 Hono daemon 的最小步骤;声明"生产须 Linux(沙箱 rlimit POSIX-only,安全篇 §6.1)" |
| N8 | CI lint + 可移植性回归 + 迁移占位 | `verify.yml` 扩展 | F03 | 见下「实施步骤」§CI |

---

## 实施步骤(有序、可勾选)

### A. config 收口与去硬编码

- [ ] A1. `config.py`:`database_url` 默认翻 `postgresql+psycopg://...`(R1)。
- [ ] A2. `config.py`:`data_dir` 默认去 POSIX 绝对路径,改相对默认 + `DATA_DIR` 覆盖(R2)。
- [ ] A3. `config.py`:新增 `downloads_dir`、`web_dist_dir` 派生设置项(N5)。
- [ ] A4. `main.py:339`:`DOWNLOADS_ROOT` 改读 `settings.downloads_dir`(R3);保持 `/downloads` 路由与 GitHub Release fallback 逻辑不变。
- [ ] A5. `main.py:469-498`:`WEB_ROOT` 改读 `settings.web_dist_dir`;保留 `is_dir()` 守卫与 else 分支(R4)。**不删 SPA 托管**。
- [ ] A6. 全仓 grep 复核 `/srv/yqgl` 残留:确认仅注释/文档保留,运行时代码零命中(RISK 闭合)。

### B. WorkHub 配置块(schema-only)

- [ ] B1. PG pool 字段(N1)。
- [ ] B2. broker 连接字段(N2)。
- [ ] B3. provider-registry 配置块,向后兼容现 `llm_*` 字段(N3)。
- [ ] B4. 三级预算默认字段(N4)。
- [ ] B5. 生产门追加校验(P2 扩展):`app_env=production` 且 `broker_backend=memory`(或 `broker_url` 空)时,**若**计划多 worker → `RuntimeError`(Master §6 铁律 3:F3/F5 成对前不得多 worker;F01 先埋门,默认单 worker 不触发)。措辞中性,不削弱既有两条。

### C. 清理与文档

- [ ] C1. 删 `models.py:37` `YQGL_ADMIN_NICKNAMES` 误导注释(R5)。
- [ ] C2. `config.py:43` CORS 注释补指向(R6)。
- [ ] C3. 写 `.env.example`(N6),列全键、双平台样例、零真实密钥。
- [ ] C4. README/docs greenfield 起步段(N7),含"生产须 Linux"声明。

### D. CI 扩展(在 `verify.yml` 上增量)

- [ ] D1. `web` job:在现 `tsc -b` 之外,显式加 `ruff`/`tsc` 不影响——已有 typecheck 充分;新增 `shared` 包 typecheck 若缺则补。
- [ ] D2. `backend` job:加显式 `ruff check app/`(lint)步骤;`smoke_workflow.py` 保留。
- [ ] D3. 新增 **配置可移植性回归**:CI 在 Linux 且**不创建 `/srv/yqgl`** 的前提下 `python -c "import config"` + 起 TestClient lifespan,验证不依赖任何 POSIX 绝对路径(回归 R1–R4)。
- [ ] D4. 新增 **Drizzle 迁移校验占位** job(allow-failure 或 skip-if-no-migrations),F03 落地首迁移后改为强制(`pnpm --filter @workhub/db db:migrate` 从空 PG 重建)。

### E. 验证

- [ ] E1. 全新 clone 在 Windows + Linux 均能 `pnpm install` + `pnpm typecheck` + 起 Hono daemon(默认配置,空 LLM key)。
- [ ] E2. `verify` CI 全绿。
- [ ] E3. `import config` 与 daemon 启动**零**触碰 `/srv/yqgl`。

---

## 数据与接口契约

> F01 **不新增实体、不新增 API、不新增事件 topic、不写 Drizzle 迁移**。本节只锚定**配置契约**(跨组件共享处以 Master + 规格为准)。

### 配置键契约(`Settings`,供下游组件消费)

| 键(env / 字段) | 类型 | 默认 | 消费者 | 来源/约束 |
|---|---|---|---|---|
| `DATABASE_URL` / `database_url` | str | `postgresql+psycopg://...`(占位) | F03 | tech-stack §6.3 步骤 1;经 `.env` 覆盖 |
| `DATA_DIR` / `data_dir` | Path | 相对 `./data` | 全部(blob/工件) | 去 POSIX 硬编码 |
| `DOWNLOADS_DIR` / `downloads_dir` | Path | `data_dir/"downloads"` | F11(下载托管) | R3 |
| `WEB_DIST_DIR` / `web_dist_dir` | Path\|None | `None` | F11(SPA 剥离前过渡) | R4;`None` ⇒ dev-server 提示 |
| `DB_POOL_SIZE` 等 | int | 5/10/30 | F03 | N1,SQLAlchemy `create_engine` 参数 |
| `BROKER_URL` / `broker_url` | str | `""` | F05 | N2 |
| `BROKER_BACKEND` / `broker_backend` | enum | `memory` | F05 | `memory`\|`redis`\|`pg_listen` |
| `providers`(嵌套) | model | `{deepseek: {...}}` | F07 | N3,收编 `llm_base_url/model/api_key` |
| `BUDGET_RUN_MAX_STEPS` / `budget.run.max_steps` | int | `15` | F08 / P-COST | 单 run 硬步数上限;由 `BudgetPolicy` seed 覆盖,AgentLoop 不硬编码 |
| `BUDGET_RUN_TIMEOUT_S` / `budget.run.total_timeout_s` | int | `300` | F08 / P-COST | 单 run 总超时;结构化交接而非静默失败 |
| `BUDGET_RUN_MAX_TOKENS` / `budget.run.max_tokens` | int | `120000` | F08 / P-COST | input/output/retry/compact 均计入 |
| `BUDGET_RUN_MAX_COST_CNY` / `budget.run.max_cost_cny` | decimal string | `5` | F08 / P-COST | 单 run 硬成本上限 |
| `BUDGET_USER_DAY_TOKENS` / `budget.user.day.max_tokens` | int | `500000` | P-COST | 用户日配额 |
| `BUDGET_USER_DAY_COST_CNY` / `budget.user.day.max_cost_cny` | decimal string | `20` | P-COST | 用户日成本配额 |
| `BUDGET_TEAM_DAY_TOKENS` / `budget.team.day.max_tokens` | int | `5000000` | P-COST | 团队日配额 |
| `BUDGET_TEAM_DAY_COST_CNY` / `budget.team.day.max_cost_cny` | decimal string | `200` | P-COST | 团队日成本配额 |
| `BUDGET_TEAM_MONTH_TOKENS` / `budget.team.month.max_tokens` | int | `50000000` | P-COST | 团队月配额 |
| `BUDGET_TEAM_MONTH_COST_CNY` / `budget.team.month.max_cost_cny` | decimal string | `2000` | P-COST | 团队月成本配额 |
| `COOKIE_SECRET` / `cookie_secret` | str | `dev-change-me` | F04 + 生产门 | **不改**;生产门拒弱默认(`main.py:230`) |
| `ADMIN_CLAIM_SECRET` / `admin_claim_secret` | str | `""` | F04 | **不改**;安全篇 §2.3 提权门 |
| `CORS_ALLOW_ORIGINS` / `cors_allow_origins` | list[str] | `["*"]` | F11 + 生产门 | **不改**;生产门拒 `*`(`main.py:232`) |

### 生产门契约(fail-closed,逐字保留 + 受控追加)

- 现有两条**逐字保留**:弱 `cookie_secret` → `RuntimeError`(`main.py:230`);CORS `*` → `RuntimeError`(`main.py:232`)。
- F01 **受控追加**一条(B5):生产 + memory broker + 多 worker 意图 → `RuntimeError`(预埋,默认不触发)。追加遵循同一 fail-closed 风格,**不放松**既有任何一条(Master §6 铁律 4)。

---

## 验收用例(可测)

| # | 用例 | 期望 | 测法 |
|---|---|---|---|
| AC1 | **可移植性(Windows):** 全新 clone,无 `/srv/yqgl`,设默认配置起 daemon | 启动成功,lifespan 建 `./data/*` 子目录 | 本机起 + `pytest`/TestClient lifespan |
| AC2 | **可移植性(Linux CI):** `import config` + TestClient 不创建任何 POSIX 绝对路径 | 无 `/srv/yqgl` 访问;无 `FileNotFoundError` | D3 CI job |
| AC3 | **零硬编码回归:** 运行时代码 grep `/srv/yqgl` | 仅注释/文档命中,`config.py`/`main.py` 运行路径零命中 | grep 断言(CI 或测试) |
| AC4 | **生产门保留(弱 secret):** `app_env=production` + 默认 `cookie_secret` | 启动 `RuntimeError` | 单测调 `_validate_runtime_config` |
| AC5 | **生产门保留(CORS *):** `app_env=production` + `cors_allow_origins=["*"]` | 启动 `RuntimeError` | 单测 |
| AC6 | **生产门追加(broker):** `production` + `broker_backend=memory` + 多 worker 意图 | `RuntimeError` | 单测(B5) |
| AC7 | **DB 默认翻面:** 未设 `.env` 时 `settings.database_url` | 以 `postgresql+psycopg://` 开头 | 单测 |
| AC8 | **配置块存在:** `settings` 暴露 pool/broker/provider/budget 字段且类型正确 | 字段可读、默认合理 | 单测 |
| AC9 | **向后兼容:** F07 前 7 处 LLM 仍能读 `llm_base_url/model/api_key` | 旧字段保留、值不变 | 单测 + smoke |
| AC10 | **CI 全绿:** `verify.yml` 扩展后 web/backend/rust + 新 job | 全 pass(迁移占位可 skip) | CI |
| AC11 | **SPA 过渡不破:** `web_dist_dir=None` 时根路由返回 dev-server 提示 JSON;设有效目录时挂载 `/assets` | 行为与现状对等 | TestClient `GET /` |

---

## 回滚与风险

### 回滚

- F01 改动**纯配置/脚手架、零运行时行为变更**,回滚 = `git revert` 单提交即可,无数据迁移、无 schema 变更、无下游耦合断裂。
- `database_url` 默认翻 PG **不**立即换库(`db.py` 逻辑未动);若 F03 未就绪,设 `DATABASE_URL=sqlite:///...local.db` 经 `.env` 即回到 SQLite 可跑——开发期安全网。

### 风险

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| K1 | **硬编码绝对路径散落运行时代码(非仅 config)**(迁移清单 §1 首要风险):`DOWNLOADS_ROOT`(`main.py:339`)、`WEB_ROOT`(`main.py:469`)、DB 默认(`config.py:9`)、`data_dir`(`config.py:10`) | 高 | A1–A5 逐一替换 + A6/AC3 grep 回归把守;CI D3 在无 `/srv/yqgl` 环境冒烟 |
| K2 | **默认翻 PG 后本机起不来**(F03 未就绪、无本地 PG) | 中 | 回滚段开发期安全网:`.env` 设 SQLite;README(N7)注明 |
| K3 | **新增配置项削弱生产门** | 高(安全) | P2 逐字保留既有两条;B5 追加用相同 fail-closed 风格;AC4–AC6 回归 |
| K4 | **provider 配置块改动破坏现 7 处 LLM 读旧字段**(F07 前) | 中 | N3 强制向后兼容,旧 `llm_*` 字段保留;AC9 验证 |
| K5 | **误删 `YQGL_BOOTSTRAP_NICKNAMES`**(与 `YQGL_ADMIN_NICKNAMES` 混淆) | 中(安全) | R5 只删 `models.py:37` 注释;`scripts/set_admin.py:8/90` 的 BOOTSTRAP 入口**不碰**(安全篇 §2.4) |
| K6 | **Master §10 称"现仓无 CI",实际已有 `verify.yml`** | 低(规划偏差) | F01 走"扩展"而非"新建";本 plan 已据实校准,避免重复造或覆盖现有三 job |
| K7 | **SPA 托管在 F01 误删**(应是 F11) | 中 | R4 仅替换路径来源,保留 `main.py:470-498` 挂载逻辑;AC11 守对等 |

---

## 依赖与被依赖

- **依赖:** —(无前置;P0 的第一块砖)。
- **被依赖(blocks 全部):**
  - **F02** 实体移植在此骨架上建模。
  - **F03** 消费 `database_url`(PG 默认)、PG pool 配置(N1);F01 的 DB 默认翻面 + pool 配置形是 F03 换库前置。
  - **F05** 消费 `broker_url`/`broker_backend`(N2)。
  - **F07** 消费 provider-registry 配置块(N3),收编 `config.py:22-24`。
  - **F08** 消费三级预算默认(N4)。
  - **F11** 消费 `web_dist_dir`/`downloads_dir`(N5),并在 F01 去硬编码基础上**剥离** SPA 托管、重解跨域 CORS/cookie。
- **成对/顺序约束:** F01 不触发任何"单 worker→多 worker"动作(Master §6 铁律 3);B5 仅**预埋**多 worker fail-closed 门,真正解除单 worker 由 **F3+F5 成对**完成。

---

## Target TS paths

> 本组件施工时,旧 `app/config.py` 与现有根目录文件只作为 behavior source;新仓默认落 TS-first 路径。

| 类别 | 目标路径 | 必须产物 | 审计门禁 |
|---|---|---|---|
| root workspace | `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json` | Node 22 + pnpm workspace | `pnpm install --frozen-lockfile` 可跑 |
| config | `packages/config/src/env.ts`, `packages/config/src/ports.ts` | Zod env schema、端口表、默认值 | 无 `/srv/yqgl` 硬编码 |
| apps scaffold | `apps/api`, `apps/web`, `apps/desktop-webview` | API/Web/Tauri webview 最小入口 | 不托管 SPA 到 API daemon |
| CI/dev scripts | `.github/workflows/*`, `scripts/dev/*` | typecheck/test/audit 命令 | 不重写已有 CI 语义 |

**PR 必答**:Behavior source = `app/config.py` / 现有 CI/root package;Target TS paths 必须列上述目录。F01 不改业务 DTO、不改 DB schema、不解禁多 worker。
