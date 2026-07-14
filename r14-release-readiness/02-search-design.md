# R14 · 批 SEARCH 实现级设计（全局搜索）

> 集成裁定（2026-07-14）：①迁移号顺延为 0057（0056 已让给先落地的 MEM 批，when=1783909000000）②网盘/会议搜索围栏的待拍板项按**保守版**批准——聚合搜索对个人空间内容一律 owner-only 守卫，对齐会话 scope 的既有围栏，防跨面泄漏（fail-closed 原则，用户如认为过严可后放宽）。

> 状态：施工设计草案 · 2026-07-14 · 上游：00-plan.md §2 批 SEARCH（用户已拍板范围）+ §4 非目标
> 侦察基础：迁移/CI 镜像 · 四数据源表列 · 四 scope 逐 actor 鉴权 · 聚焦盒能力注册 · web 路由注册面 · 深链形状
> 纪律：04 手册 13 条铁律不变；本批**零新部署依赖**（PG 原生 pg_trgm，硬约束）；无 emoji/去黑话/文档回真。
> 拍板红线（不可违背）：pg_trgm GIN 做 CJK 子串；覆盖=会话消息/网盘名+正文/工单标题+描述/会议纪要；
> 统一 `GET /api/search`；逐 scope 各自 limit + 鉴权**进 SQL 逐 actor**（复用项目健康 DF-2，禁全局 cap 饿死）；
> 入口=聚焦盒「搜索全部」能力内联 + web 顶栏搜索页；结果分组渲染点击直达。语义检索/zhparser 明确不做（§4）。

---

## 0. 侦察结论（否决性检查先行）

**pg_trgm 可用 — 无否决性发现。** 三处 PG 全部 `postgres:16` 官方镜像（`.github/workflows/verify.yml`
r1-pg-smoke:85 / r2-pg-redis-smoke:122 / migration-audit:289；`docker-compose.yml:3`；`docker-compose.pilot.yml:5`）。
pg_trgm 与 citext 同为官方镜像自带 contrib，`CREATE EXTENSION IF NOT EXISTS` 有既有先例：
`packages/db/migrations/0023_auth_credentials_sessions.sql:8` 建 citext，注释明写"官方 postgres 镜像含此 contrib"。
migration-audit（`scripts/dev/check-migrations.ts`）在 scratch DB 上整链重跑 0000→最新（`freshMigrationFiles` = 全部），
citext 那条已在每次 CI 重放通过 → pg_trgm 同理必过。

**migration-audit 的两条硬规则（0057 必须遵守，`check-migrations.ts:221/224`）：**
- ADD COLUMN 必须 `ADD COLUMN IF NOT EXISTS`（本批不加列，无关）。
- `CREATE [UNIQUE] INDEX` 必须带 `IF NOT EXISTS` —— **GIN 索引也走这条正则**（`^CREATE\s+(?:UNIQUE\s+)?INDEX\b`），
  故所有 `CREATE INDEX ... USING gin` 必须写成 `CREATE INDEX IF NOT EXISTS ... USING gin (...)`。
- `CREATE EXTENSION` 不被审计拦（只查 ADD COLUMN / CREATE INDEX 两类），但会在 replay 真跑 → 必须真能建（能）。

**迁移号 0057（集成裁定后顺延）：** `_journal.json` 末尾 idx=55（0055，when=1783907000000）。0057 when=1783909000000（+1e6，与 0055→0054 步进一致）。

**四数据源可搜文本与围栏列（`packages/db/src/schema/core.ts`）：**

| scope | 表 | 可搜文本列 | 租户/围栏列 | 墓碑 |
|---|---|---|---|---|
| conversations | `conversation_messages`:533 | `content_json->>'text'`（仅 `kind='text'`；shape 见 conversation-turns.ts:1036 `{text,...}`） | 经 `project_conversations`:433 的 `workspace_id`/`project_id`/`visibility`；collab 靠 `conversation_participants`:515 | `deleted_at`:553（必滤） |
| drive 文件名 | `project_drive_items`:887 | `name` varchar(256):893 | `project_id`:891 | `deleted_at`:898（必滤） |
| drive 正文 | `project_drive_versions`:916 | `parsed_text` text:927（当前版=`items.current_version_id`→`versions.id`） | 随 item 的 project | item 墓碑即可 |
| work_items | `work_items`:374 | `title` varchar(256):384 + `raw_description` text:385（拍板=标题+描述，不含 summary_md/planning_note） | `project_id`:379、`workspace_id`:380 | `deleted_at`:412（必滤） |
| meetings | `meeting_records`:1021 | `title` varchar(256):1028 + `minutes_md` text:1034（"纪要"=minutes；不含 `transcript_text`，见 §2 取舍） | `project_id`:1025 | 无软删列 |

**drive 正文体量：** 内联 `parsed_text` 由摄取策略约束在 ~64KB（`work-items.ts:693`：`sizeBytes <= 64*1024` 才走内联，
超限走外置 `parsed_text_path`）。**诚实限制：MVP 只索引内联 `parsed_text`，外置大文件正文不可搜**（文件名永远可搜）。写进空态/文档。

**四 scope 鉴权现状（逐 actor，可全量下推 SQL）：**
- 会话：`conversations.ts:553 activeConversationCondition` = 工作区成员 + `isNull(deletedAt)` + 项目 active +
  个人空间只 owner 可见（`or(isPersonal=false, ownerUserId=viewer)`:572）+ `visibleConversationCondition`:546（main 全员 / collab 仅参与者）。
- 网盘/会议：`packages/permissions/src/resource-permissions.ts:67 canViewProjectDrive`（会议=`canViewProjectMeetings`:101 别名同款）
  = 项目 active + （admin→同 org；否则 `workspaceId===actor.workspaceId` **或** `ownerUserId===actor`）。**注意：canViewProjectDrive 不按 isPersonal 围栏**（见 §2 隐私红线）。
- 工单：`resource-permissions.ts:126 canViewWorkItemRecord` = scope 匹配 + （admin→真 / submitter/assignee→真 / 否则 status∉`{intake,ai_clarifying,spec_ready}`）。
- **DF-2 SQL 下推范本**：`packages/db/src/repositories/project-health.ts:73 projectScopeConditions` 与 `:104 workItemScopeConditions`
  已把上述 project/workItem 鉴权逐 actor 写成 SQL（含 `exists(...work_item_assignments...)`:122 的 assignee EXISTS）——本批直接照抄改写，**不 load 全量再过滤**。

**聚焦盒能力注册（3 处，全在 `apps/desktop-webview/src/spotlight/**` 与 `command-palette.ts`）：**
`command-palette.ts:9 CommandId` 联合 + `:53 commandRegistry` 条目 + `spotlight/registry.ts:26 builtViews` 映射 + 新增 `spotlight/views/search.ts`。
`view-context.ts` 定义 `SpotlightCapabilityView`/`SpotlightViewContext`（含 `client`/`open(id,target)`/`toast`/`signal`）。
意图分类端点 `POST /api/spotlight/intent`（`routes/spotlight-intent.ts`）现分类 `open_page|new_project|create_task|answer`（`spotlight/ask-cuu.ts:20`）——扩一类 `search` 为 stretch（见 §5.3），核心入口是能力视图本身。

**web 路由注册面（team-skills 记忆踩坑清单命中，均须同 commit）：**
`apps/web/src/routes.ts`:routeMatchers(:180 区，:232 `satisfies`)、`shellPageOrder`:489、`shellDefaultRoutes`:518、`shellPageTitles`:539、`routeComponentsForSurface`:957；
`packages/ui/src/gold-path/render.ts`:`GoldPathRenderedPage["key"]` 联合:29、`pageTitles`:137、新增 `renderSearch`（照 `renderKnowledge`:710）、`render.test.ts` key 清单:51；
`packages/ui/src/gold-path/app-shell.ts`:routeMap 解析（knowledge 特判:92/147 是范本）；`product-shell.ts`:导航分组:436、`nextForPage`:340；
`packages/ui/src/route-state.ts`:双语 label:97/117。smoke 计数门：`apps/web/src/routes.test.ts` 与 `scripts/qa/r4-web-route-state-matrix.ts:501`（expectedCards=keys×stateKinds）、`r4-web-route-registry-loader.ts` —— 集成者统一 +1。

**深链形状（item 6）：**
- 会话：桌面深链 `/workbench/<projectId>[/<conversationId>]`（`workbench/cuu-bubble-deeplink.ts:33 buildWorkbenchDeepLinkHref`；
  Rust `open_workbench` 段校验拒 `/ \ ? #`）。冷启动竞态兜底 = `workbench/pending-deep-link.ts` 的 localStorage stash，
  当前 payload = `{projectId, conversationId?}`，**无 seq 字段**。→ 见 §6 深链定位（会话结果精确到 seq 需前端 stash 扩 seq + workbench 侧消费，跨包依赖，明确边界）。
- **web 无会话镜像**（R13 定调"聊天归桌面"，web 只读镜像仅 B 级立案未落）→ web 会话结果只能深链到桌面 workbench 或降级为"仅桌面可打开"提示。
- 网盘文件：drive 能力 `open("drive", {id: itemId})`（桌面）；web `/drive?...`（`shellDefaultRoutes.drive="/drive"`）。
- 工单详情：`open("workitem", {id})`（桌面 SpotlightTarget）；web `/`（workitem detail-only shell）。

---

## 1. 数据模型（迁移 0057，集成者已预分配）

`0057_search_trgm_indexes.sql`，journal idx=57、when=**1783909000000**、tag 同文件名；
`packages/db/src/schema.test.ts` 尾断言（合并时以实际链尾为准，本批号=0057） 同步（属批准的契约变更，非迁就）。
**本批零加表零加列** —— 只建扩展 + 五个表达式/部分 GIN 索引（drizzle schema 侧用 `sql` 原样声明索引，或纯 SQL 迁移 + schema 注释；
推荐纯 SQL 迁移，schema.ts 不声明 gin 索引以免 drizzle-kit 快照漂移，照 0023 citext 手写 SQL 先例）。

```sql
-- R14 批 SEARCH：pg_trgm CJK 子串检索的扩展 + 五个 GIN 索引。零新部署依赖（官方 postgres 镜像自带 pg_trgm）。
-- 排序=recency desc + ILIKE '%q%' 子串匹配（诚实二值 contains，非 similarity 阈值，见设计 §3）。
-- trgm GIN 只加速 ≥3 字符子串；1–2 字符（含 2 字 CJK 词）落 seqscan，靠逐 scope 围栏 join + LIMIT 兜住成本。
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint

-- 会话消息正文：部分表达式索引，只覆盖真正可搜的 text 且未删除的行（其余 kind 的 content_json 无 'text' 键，
-- ->> 返回 NULL；墓碑 content_json 已清 {}）。jsonb ->> 是 IMMUTABLE，可入表达式索引。
CREATE INDEX IF NOT EXISTS "conversation_messages_text_trgm_idx"
  ON "conversation_messages" USING gin ((content_json ->> 'text') gin_trgm_ops)
  WHERE kind = 'text' AND deleted_at IS NULL;--> statement-breakpoint

-- 工单：标题+描述合并表达式（coalesce/|| 均 IMMUTABLE），一条谓词一个索引覆盖两列；部分索引滤墓碑。
CREATE INDEX IF NOT EXISTS "work_items_search_trgm_idx"
  ON "work_items" USING gin ((coalesce(title,'') || ' ' || coalesce(raw_description,'')) gin_trgm_ops)
  WHERE deleted_at IS NULL;--> statement-breakpoint

-- 会议：标题+纪要合并表达式（无软删列，无部分谓词）。
CREATE INDEX IF NOT EXISTS "meeting_records_search_trgm_idx"
  ON "meeting_records" USING gin ((coalesce(title,'') || ' ' || coalesce(minutes_md,'')) gin_trgm_ops);--> statement-breakpoint

-- 网盘文件名：部分索引滤墓碑。
CREATE INDEX IF NOT EXISTS "project_drive_items_name_trgm_idx"
  ON "project_drive_items" USING gin (name gin_trgm_ops)
  WHERE deleted_at IS NULL;--> statement-breakpoint

-- 网盘正文：索引所有版本的 parsed_text（查询只 join 当前版；全版建索引简单且无害，内联 parsed_text ~64KB 上限）。
CREATE INDEX IF NOT EXISTS "project_drive_versions_parsed_text_trgm_idx"
  ON "project_drive_versions" USING gin (parsed_text gin_trgm_ops);
```

**immutability 核查（表达式索引硬门）：** `content_json ->> 'text'`（jsonb `->>` = `jsonb_object_field_text`，IMMUTABLE ✓）、
`coalesce(a,'') || ' ' || coalesce(b,'')`（coalesce + textcat 均 IMMUTABLE ✓）、裸列 `name`/`parsed_text` ✓。
部分索引谓词 `kind='text'`/`deleted_at IS NULL` 均 IMMUTABLE ✓。**CONCURRENTLY 不用**（migration runner 单事务重放，CONCURRENTLY 不能进事务；
自托管数据量小，普通建索引可接受；大库首建阻塞是已知取舍，写进部署文档）。扩展须在索引前建（同文件先建，statement-breakpoint 顺序执行）✓。

---

## 2. 语义红线（服务端强制）

- **围栏进 SQL 逐 actor，不做全局 cap 再过滤**（DF-2 铁律）。每 scope 的 WHERE 直接内联 §0 的鉴权谓词，`LIMIT` 施加在**已围栏**的行集上。
- **会话 scope** = 照抄 `activeConversationCondition`（含个人空间 owner 围栏 + main/collab 参与者判定）+ `messages.kind='text'` + `messages.deleted_at IS NULL` + trgm 谓词。
- **工单 scope** = 照抄 `workItemScopeConditions`（workspace 匹配 + status∉private ∨ submitter ∨ claimed ∨ assignee-EXISTS）+ `work_items.deleted_at IS NULL` + 项目 active + trgm 谓词。
- **网盘/会议 scope 隐私红线（必须拍板的判断项）**：现有 `canViewProjectDrive` **不按 isPersonal 围栏**（同工作区成员即可见他人个人空间网盘）。
  但 `activeConversationCondition` 对个人空间是 owner-only。搜索是**聚合面**，若沿用 canViewProjectDrive 原样，会把他人个人空间的文件名/正文/会议纪要
  经全局搜索抖给整个工作区 —— 相对会话 scope 是**新的跨面隐私回归**。**推荐（保守超集）**：网盘/会议搜索围栏在 canViewProjectDrive 基础上
  **追加 `(projects.is_personal = false OR projects.owner_user_id = actor.userId)`**，与会话 scope 对齐。此为设计判断，标红请集成者/用户确认；
  若否决则退回严格照抄 canViewProjectDrive（在设计里默认取保守版）。
- **q 处理**：trim；min 2 字符、max 64 字符（越界 400，人话）。**LIKE 元字符转义**（`%` `_` `\`）后再拼 `'%'||escaped||'%'`，
  用 `ILIKE ... ESCAPE '\'`；防用户输入 `50%` 被当通配符（正确性+注入面收口）。全程参数化（不字符串拼接进 SQL）。
- **排序**：每 scope 按 recency 倒序（会话/会议 `created_at desc`，工单/网盘 `updated_at desc`；会话跨会话仍用 created_at desc）。**不用 `similarity()` 阈值**（见 §3 取舍）。
- **逐 scope limit cap**：默认 10 / scope，max 25（请求 `limit` 夹紧）；总响应 ≤ 4×25=100。取 `limit+1` 探测 `has_more`（多取 1 行，命中则置 has_more 并丢弃末行）。
- **空结果诚实**：命中 0 行 → 该 group `results:[]`、`has_more:false`；不编造、不脚手架。全 scope 皆空 → 客户端"未找到匹配"。
- **snippet**：服务端纯函数 `buildSnippet(text, q, radius=60)` 在首个匹配位置开窗、cap ~160 字符、两端加省略号；title/name 命中直接返回全值（短）。穷举单测。
- **错误**：非法 q/scopes → 400；未鉴权 → 401（`requireCurrentUser`）。用既有 `app.onError` 映射，不新建错误类。

---

## 3. 排序策略推荐与取舍（拍板项）

**推荐：`ILIKE '%q%'` 子串匹配（trgm GIN 加速）+ recency 倒序。不用 `similarity()`/`word_similarity()` 阈值排序。**

取舍说明：
- CJK 子串场景下 `similarity()` 依赖 trigram 相似度阈值（`pg_trgm.similarity_threshold`），对中文短词行为不稳、需调参、可解释性差；
  用户心智是"哪条**包含**我打的词" —— 二值 contains（ILIKE）更诚实、结果稳定、无隐藏阈值。
- **trgm GIN 的 ≥3 字符硬限**（诚实披露）：pg_trgm 按 3 连字符生成 trigram，**query < 3 字符（含最常见的 2 字 CJK 词）无法用 trgm 索引**，
  规划器退化为对**已围栏行集**的 seqscan + recheck。这是 pg_trgm 固有限制，非本设计缺陷。兜底：min q=2（挡掉 1 字符的超宽扫描+噪音），
  且每 scope 的 join 围栏 + LIMIT 把 2 字符 seqscan 的成本压在小行集上；自托管单实例小数据可接受。≥3 字符 query 走索引加速。
- recency 倒序在工作工具里最有用且确定性强；代价=高相关的旧内容排在弱相关的新内容之后（可接受，MVP）。
- **未来低成本精修（不在本批）**：title/name 命中优先于正文命中的 tiebreak（`ORDER BY (title ILIKE ...) DESC, updated_at DESC`），零新索引；语义检索见 §4 二期。

---

## 4. HTTP 端点与契约（施工=独立路由文件不挂载；挂载/openapi/app.test 白名单=集成者）

`GET /api/search?q=<string>&scopes=<csv>&limit=<int?>`，`requireCurrentUser`，用 `c.var.actor`。

| 参数 | 校验 | 默认 |
|---|---|---|
| `q` | trim 后 2–64 字符，否则 400 | 无（必填） |
| `scopes` | 逗号分隔，取值 ⊆ `conversations,drive,work_items,meetings`；未知值丢弃；全非法→400 | 缺省=全四 scope |
| `limit` | 1–25 整数，夹紧 | 10 |

zod 请求 schema 落 `packages/contracts/src/domain/search.ts`（新文件，不与会话域混写，照 CHAT 批 presence 契约单开先例）。

**响应 VM（`searchResultsVmSchema`）：**
```jsonc
{
  "query": "预算",
  "groups": [
    {
      "scope": "conversations",
      "has_more": true,
      "results": [
        { "message_id": "...", "conversation_id": "...", "project_id": "...",
          "project_name": "增长项目", "conversation_title": "主群聊", "seq": 128,
          "sender_type": "user", "sender_user_id": "...", "sender_label": "阿珍",
          "snippet": "…这季度的预算还没批…", "created_at": "..." ,
          "deep_link": { "project_id": "...", "conversation_id": "...", "seq": 128 } }
      ]
    },
    { "scope": "drive", "has_more": false, "results": [
        { "item_id": "...", "project_id": "...", "project_name": "...", "name": "Q3预算.xlsx",
          "kind": "file", "matched_in": "name", "snippet": "Q3预算.xlsx", "updated_at": "..." } ] },
    { "scope": "work_items", "has_more": false, "results": [
        { "work_item_id": "...", "code": "WI-42", "project_id": "...", "project_name": "...",
          "title": "编制预算表", "status": "ai_working", "matched_in": "title",
          "snippet": "编制预算表", "updated_at": "..." } ] },
    { "scope": "meetings", "has_more": false, "results": [
        { "meeting_id": "...", "project_id": "...", "project_name": "...", "title": "季度评审",
          "status": "ready", "matched_in": "minutes", "snippet": "…预算口径统一为…", "created_at": "..." } ] }
  ]
}
```
- `groups` 恒按固定 scope 顺序输出，即使某 scope 请求外或空（空则 `results:[]`）。仅返回**请求的** scope。
- `matched_in` ∈ `name|body|title|description|text|minutes`（客户端可标"命中于文件名/正文"）。
- `deep_link` 只在 conversations scope 给（其它 scope 客户端按既有 open()/route 直达，见 §5/§6）。
- openapi.ts 只进 properties（新增 optional 字段惯例），required 只放 `scope`/`has_more`/`results`。

---

## 5. 客户端入口一：聚焦盒「搜索全部」能力（工包 W2，**只许动 `apps/desktop-webview/src/spotlight/**` 与 `command-palette.ts`**）

### 5.1 能力注册（3 处）
- `command-palette.ts:9`：`CommandId` 联合加 `"search"`。
- `command-palette.ts:53 commandRegistry`：加 `{ id:"search", label:{zh:"搜索全部", en:"Search all"}, hint:{zh:"跨会话·网盘·工单·会议", en:"Across chat, drive, tasks, meetings"}, keywords:["搜索","查找","全局","search","find","global"], icon: ic('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.3-4.3"/>'), action:{kind:"open-window", target:"search"} }`（与既有 `knowledge` 放大镜图标区分：knowledge=知识/证据，search=全局跨源；文案上明确"全部"）。
- `spotlight/registry.ts:26 builtViews`：`search: createSearchView`；新增 `spotlight/views/search.ts`。

### 5.2 视图交互草案（`spotlight/views/search.ts`，实现 `SpotlightCapabilityView`）
- mount：渲搜索输入框（`role="search"`，自动聚焦）+ 空态提示"输入关键词，搜遍会话·网盘·工单·会议"。
- 输入 debounce ~250ms（≥2 字符才发）→ `ctx.client.search(q, scopes=all, {signal: ctx.signal})`（api-client 新增方法，见 §7）。loading 骨架，失败走 `spotlightErrorHtml` + 重试闭包。
- 结果**分组渲染**：四个可折叠分区（会话/网盘/工单/会议），每组标题带命中数与"还有更多"（has_more 时提示"精确关键词以缩小范围"，MVP 不做翻页）。空组灰显"无匹配"。
- 每条：主标题（项目名 · 上下文，如"增长项目 · 主群聊"）+ snippet（命中词高亮，用 `<mark>` 或强调类；高亮在客户端按 q 定位，服务端已给 snippet 文本）。
- **回车/点击直达**：
  - 会话 → `ctx.open` 不覆盖 workbench；会话直达走 workbench 深链：调用与 `spotlight/views/workbench-open.ts` 同款路径 `stashPendingWorkbenchDeepLink({projectId, conversationId, seq})` + `invoke("open_workbench",{projectId})`（seq 字段见 §6 跨包边界）。
  - 网盘 → `ctx.open("drive", { id: item_id, label: project_name })`。
  - 工单 → `ctx.open("workitem", { id: work_item_id, label: project_name })`。
  - 会议 → `ctx.open("team", { id: meeting_id })` 或 drive/会议视图（施工时核对 meeting 详情落在哪个能力视图；team 视图含日历/会议）。
- 键盘全程：上下键在结果间移动、回车打开、ESC 返回 launcher；重渲后 `ctx.refocusBody()`；监听器全挂 `ctx.signal`。
- 玻璃风复用 design-system 类名，不复用 gold-path 视觉，不走 hash 全屏壳（view-context 契约铁律）。

### 5.3 意图分类扩类（stretch，不设门）
`packages/agent/src/spotlight-intent/schema.ts` 加 `search` 意图 + `apps/desktop-webview/src/spotlight/ask-cuu.ts:20` 联合加 `{ intent:"search"; query:string }`，
让"帮我找 X"这类自然语句被分类为 search 并跳进本能力（prefill q）。核心入口是能力视图；此项做不完不拖批。

---

## 6. 深链定位（跨包边界，明确禁区）

- **网盘/工单**：既有 `SpotlightTarget{id}` + `ctx.open()` 直接支持，无缺口。
- **会话精确到 seq**：现有 workbench 深链与 stash payload **无 seq**（`cuu-bubble-deeplink.ts:24`、`pending-deep-link.ts:112`）。
  - 本工包**可动**的部分（在 `spotlight/**`）：调 `stashPendingWorkbenchDeepLink` 时**多写一个可选 `seq`**（stash 是前端 localStorage，schema 在 `pending-deep-link.ts` —— 但该文件在 `workbench/` 目录，**桌面聊天 UI agent 正在动 `workbench/**`，禁撞**）。
  - **裁定**：会话结果 MVP 深链只到 `{projectId, conversationId}`（既有能力，打开会话即可），**seq 精确滚动列为跨包依赖**：由桌面聊天 UI agent 在其 workbench 消息列表里补"进入时若 stash 带 seq 则滚动+高亮"（他们本就在做 reply 跳原消息的"滚动+高亮/beforeSeq 加载"，见 01-chat-design.md §5，天然复用）。本设计**不**在 spotlight 工包里改 `workbench/**`。集成时二者对齐 stash 的 seq 字段名（建议 `seq?:number`）。
- **web 会话结果**：web 无聊天页。MVP 处置=web 搜索页对会话命中显示"在桌面工作台中打开"提示（不给死链），或折叠该组并注"会话搜索请用桌面端"。诚实降级，不假接线。

---

## 7. 客户端入口二：web 顶栏搜索页（工包 W3）

- **api-client**（`packages/api-client/src/client.ts`）新增方法：
  `search: (q, scopes, options) => request(\`/api/search?\${new URLSearchParams({ q, ...(scopes?{scopes:scopes.join(",")}:{}), ...(limit?{limit:String(limit)}:{}) })}\`, options)`（GET，复用既有 `request<T>` + `withPageLocale` 可选）。
- **新页面 key `"search"`**（照 team-skills 记忆的踩坑清单同 commit 全改）：
  - `apps/web/src/routes.ts`：routeMatchers 加 `{ key:"search", pattern:"/dashboard/search", apiBaseLabel:"/api/search", regex:/^\/dashboard\/search$/u, paramNames:[] }`；`shellPageOrder` 加 `"search"`；`shellDefaultRoutes.search="/dashboard/search"`；`shellPageTitles` 双语；`routeComponentsForSurface` 映射到新 route-component。
  - `packages/ui/src/gold-path/render.ts`：`GoldPathRenderedPage["key"]` 联合加 `"search"`；`pageTitles` 双语；新增 `renderSearch()`（照 `renderKnowledge`:710 —— 服务端只渲搜索框外壳 + 空态，结果由客户端 route-component fetch `/api/search` 后注入）；`render.test.ts` key 清单同步。
  - `packages/ui/src/gold-path/app-shell.ts`：routeMap 加 search（照 knowledge 特判 :92/:147）；`product-shell.ts`：导航分组（建议顶栏独立位而非塞 assets 组，呼应"顶栏搜索页"）、`nextForPage`；`route-state.ts` 双语 label。
- **顶栏入口**：product-shell header 加一个搜索 affordance（输入框/按钮），提交 → 导航 `/dashboard/search?q=...`。搜索页 route-component：
  读 `?q=`、渲输入框（回填 q）、client-side `client.search(q)` → 四分组渲染（同 §5.2 分组/snippet/has_more 语义）；点击直达：网盘→`/drive`、工单→workitem detail 路由、会议→`/meetings`、会话→桌面提示（§6）。
- **不做**：web 聊天页（R13 定调）；web 结果分页（MVP 只 has_more 提示）。
- CSS 内联进 route-component（web smoke 的定高 line-clamp 溢出门：**禁定高 -webkit-line-clamp**，见 workhub-web-smoke-overflow-gate 记忆）。

---

## 8. 施工切片（三工包 + 集成者收口）

| 工包 | 分支 | 模型 | 范围 | 禁区 |
|---|---|---|---|---|
| **W1 search-core** | r14/search-core | opus | 迁移 0057（扩展+5 GIN 索引）；`packages/db/src/repositories/search.ts`（四 scope 查询，逐 actor SQL 围栏照抄 project-health）；`apps/api/src/services/search.ts`（q/scopes 校验、LIKE 转义、snippet 纯函数、limit+1 探测、VM 组装）；`apps/api/src/routes/search.ts`（**独立路由文件不挂载**）；`packages/contracts/src/domain/search.ts`（zod 请求+VM）；穷举单测（含 CJK 2 字/≥3 字、LIKE 元字符、墓碑滤除、个人空间围栏、assignee EXISTS、空结果、has_more） | 不挂载 app.ts / 不改 openapi.ts / 不改 app.test 白名单（集成者）；不动 CHAT 批 0055 及聊天 repo/service |
| **W2 spotlight-search** | r14/search-spotlight | sonnet | `command-palette.ts`（+search 能力）；`spotlight/registry.ts`（+映射）；`spotlight/views/search.ts`（新）；ask-cuu/intent 扩类 stretch；测试（registry/命令匹配/view 渲染） | **只许动 `apps/desktop-webview/src/spotlight/**` + `command-palette.ts`**；**严禁动 `apps/desktop-webview/src/workbench/**`（桌面聊天 UI agent 施工中）**；seq 精确滚动不在本包（§6） |
| **W3 web-search-page** | r14/search-web | sonnet | api-client `search()` 方法；web 新页面 key（routes.ts + render.ts + app-shell.ts + product-shell.ts + route-state.ts + 顶栏入口 + route-component）；render.test/routes.test 同步；测试 | 不改 W1 契约形状；web smoke 溢出门（禁定高 clamp）；smoke 计数集成者统一 +1 |
| 集成者 | — | — | 挂载 `/api/search`（app.ts）、openapi.ts、app.test 端点白名单、r4 route matrix/registry 计数、迁移链 scratch 真库 0000→0057 重放、CI 逐 job 核 conclusion、README 文档计数（如新增文档） | 冲突磁铁全归此 |

全量门：各包 test + `pnpm -r typecheck`（tsx 测试不严格查类型，务必补 typecheck，见记忆）+ migration-audit 真库重放 + web smoke。

---

## 9. 发车顺序建议

1. **W1 search-core 先发**（独占关键路径）：契约 VM + 端点是 W2/W3 的共同依赖；迁移 0057 越早进越早暴露 pg_trgm/immutability 真库问题。
   建议在隔离 PG（记忆：5433 + worktree API）用真数据先冒烟一条 CJK 2 字 + ≥3 字 query，确认 trgm 索引命中/seqscan 行为与围栏正确。
2. **W2、W3 并行**（W1 合并或契约冻结后）：两者互不碰文件（spotlight/** vs web/gold-path），可同时施工。
3. **集成者收口**：挂载 + openapi + 各计数门 + 迁移链重放 + 双端真机验（桌面聚焦盒搜索直达 / web 顶栏搜索页 → 四分组点击直达）。
4. 会话 seq 精确滚动与桌面聊天 UI agent 对齐 stash `seq` 字段后再合（不阻塞主链路，MVP 可先只到会话级）。

**待用户/集成者拍板一项**（§2 隐私红线）：网盘/会议搜索围栏是否追加"个人空间 owner-only"守卫（本设计默认取保守版，与会话 scope 对齐，防聚合搜索把他人个人空间内容抖给全工作区）。
