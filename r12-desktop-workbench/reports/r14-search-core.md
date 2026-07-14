# R14 批 SEARCH · 工包 W1 search-core 交付报告

分支：`r14/search-core` · 施工说明书：`r14-release-readiness/02-search-design.md`（逐节执行）
集成裁定遵守：①迁移号 = **0057**（journal 直接 55→57，0056 让给并行 MEM 批）②网盘/会议 scope = **保守版围栏**（个人空间一律 owner-only，对齐会话 scope，fail-closed）。

## 1. 做了什么

### 数据模型（迁移 0057）
- `packages/db/migrations/0057_search_trgm_indexes.sql`：`CREATE EXTENSION IF NOT EXISTS pg_trgm` + 五个 GIN 表达式/部分索引，全部 `CREATE INDEX IF NOT EXISTS ... USING gin (...)`（migration-audit 硬门 check-migrations.ts:224）。零加表零加列。不用并发建索引（单事务重放）。
  - `conversation_messages_text_trgm_idx`：`(content_json ->> 'text') gin_trgm_ops` WHERE `kind='text' AND deleted_at IS NULL`（部分表达式索引）
  - `work_items_search_trgm_idx`：`(coalesce(title,'')||' '||coalesce(raw_description,'')) gin_trgm_ops` WHERE `deleted_at IS NULL`
  - `meeting_records_search_trgm_idx`：`(coalesce(title,'')||' '||coalesce(minutes_md,'')) gin_trgm_ops`（无软删列）
  - `project_drive_items_name_trgm_idx`：`name gin_trgm_ops` WHERE `deleted_at IS NULL`
  - `project_drive_versions_parsed_text_trgm_idx`：`parsed_text gin_trgm_ops`
- `packages/db/migrations/meta/_journal.json`：追加 `{idx:57, version:"7", when:1783909000000, tag:"0057_search_trgm_indexes", breakpoints:true}`。
- `packages/db/src/schema.test.ts`：journal 尾断言从 0055 改钉 **0057**（设计批准的契约变更）；新增「migration 0057 builds pg_trgm plus five replay-safe GIN indexes」内容断言（IF NOT EXISTS×5 / gin_trgm_ops×5 / 无 CONCURRENTLY / 无 ADD COLUMN / 无 CREATE TABLE）。

### 仓库（鉴权全进 SQL 逐 actor）
- `packages/db/src/repositories/search.ts` `createSearchRepository(db)`：四 scope 查询函数，鉴权谓词直接内联进 WHERE（照 project-health.ts DF-2 范本），LIMIT 施加在已围栏行集上，绝不 load 全量再过滤。
  - **会话**：照抄 `activeConversationCondition`（单工作区 + 项目 active + 个人空间 owner-only + main 全员/collab 仅参与者）+ `kind='text'` + `deleted_at IS NULL` + trgm。
  - **网盘**：`canViewProjectDrive` 语义（admin 同 org / 非 admin 同工作区或 owner）**追加**保守个人空间围栏 `(is_personal=false OR owner=actor)`（含 admin）+ `deleted_at IS NULL` + 名/正文 trgm（leftJoin 当前版 parsed_text）。
  - **工单**：照抄 `canViewWorkItemRecord` + project-health `workItemScopeConditions`（含 `exists(work_item_assignments...)` 的 assignee EXISTS）+ `deleted_at IS NULL` + 项目 active + trgm。
  - **会议**：同网盘围栏（`canViewProjectMeetings` = drive 别名 + 个人空间守卫）；meeting_records 无软删列，如实不滤。
  - LIKE：服务层转义后的 `pattern` 参数化传入，仓库 `ILIKE ${pattern} ESCAPE '\'`；recency 倒序（会话/会议 created_at desc、工单/网盘 updated_at desc）+ id 兜底稳定序。

### 服务
- `apps/api/src/services/search.ts` `createSearchService(repo)` / `getDefaultSearchService()`：
  - q 校验（trim、2–64 字符，越界抛 `HTTPException(400)` 人话，走 app.onError 既有分支，不新建错误类）。
  - scopes 校验（枚举子集、未知值丢弃、全非法/空串 400、去重、恒按固定 scope 顺序输出、缺省=全四）。
  - limit 夹紧（1–25，默认 10，非数字回退默认）。
  - `escapeLikePattern` / `buildLikePattern`（先转义 `\` 再 `%` `_`）、`buildSnippet`（命中处开窗、折叠空白、两端省略号、硬 cap 160、空/未命中如实降级）——均纯函数，穷举单测。
  - `limit+1` 探测 has_more（多取一行、命中置 has_more 并丢末行、逐 scope 独立不共享 cap）；VM 组装 `parseOutputContract(searchResultsVmSchema, ...)`；matched_in（name/title 优先于正文）与 conversations 的 deep_link{project,conversation,seq} 在服务层派生。

### 路由（独立文件，**不挂载**）
- `apps/api/src/routes/search.ts` `createSearchRoutes(deps)`：`GET /search`（挂载后 = `/api/search?q=&scopes=&limit=`），`requireCurrentUser`，透传原始 query 串给服务层，返回 `{ ok:true, data }`。挂载归集成者（照 presence/conversation-typing 先例）。

### 契约
- `packages/contracts/src/domain/search.ts`：`searchScopeSchema`、`SEARCH_SCOPE_ORDER`、请求边界常量、`searchRequestSchema`、四 scope 结果 schema、按 scope 判别联合的 `searchGroupSchema`、`searchResultsVmSchema`（strict）。`packages/contracts/src/index.ts` 导出。

### 测试
- `packages/contracts/src/search.test.ts`（5）：scope 枚举/固定顺序、边界常量、判别联合按 scope 收严、strict 拒未知字段。（注：放在 `src/` 顶层——contracts 测试 glob 为非递归 `src/*.test.ts`。）
- `apps/api/src/services/search.test.ts`（26）：q 校验（CJK 2 字/≥3 字/越界/trim/空）、LIKE 转义、snippet（首/中/尾命中、无命中、空白折叠、空/null、长度 cap）、scopes 校验、limit 夹紧、服务编排（固定顺序、只返回请求 scope、limit+1→has_more、空结果诚实、四 scope VM 契约、matched_in/deep_link、admin 租户透传）。
- `apps/api/src/routes/search.test.ts`（4）：未登录 401 先于服务调用、`{ok:true,data}` 信封 + actor/query 透传、非法 q/scopes 的 400 经 app.onError。
- **真库冒烟** `apps/api/src/qa/r14-search-smoke.ts`（防呆正则 `workhub_r14_[a-z0-9_]*smoke`）：跑迁移 0000→0057 → 种四数据源 + B 的个人空间项目（围栏反例）→ 四 scope 断言命中与围栏。

## 2. 冒烟输出（本机 docker workhub-postgres-1，scratch 库 workhub_r14_search_smoke）

```
{"ok":true,"conversations":1,"drive":2,"work_items":2,"meetings":1,"three_char_cjk":1,"drive_has_more_at_limit1":true,"like_escape_hits":["毛利率50%明细.xlsx"],"empty_groups":[0,0,0,0]}
```

断言覆盖（全绿）：
- 会话：命中 team 主群可见 text 消息 1 条；**墓碑（deleted_at）/ 非 text kind（system_event）/ B 个人空间会话** 全滤除；deep_link 带 seq。
- 网盘：team 命中 name 与 body 各 1（matched_in 正确）；**B 个人空间网盘 / 墓碑 / `50off`** 全不在。
- 工单：公开状态 + **assignee EXISTS** 各 1；**private 非本人** 滤除。
- 会议：team 命中 1（matched_in=minutes）；**B 个人空间会议** 围栏挡掉。
- CJK ≥3 字（完播率）命中；`limit=1` 下 has_more=true；**LIKE 元字符转义**（搜 `50%` 只中字面量 `50%`，不中 `50off`）；空词查询四组 `results:[]`/`has_more:false`。

迁移落库核验：`pg_extension` 有 pg_trgm；5 个 `%trgm%` GIN 索引全建；`drizzle.__drizzle_migrations` 应用 57 条（链尾 0057）。

## 3. 挂载清单（集成者收口，本工包禁区）

```ts
// apps/api/src/app.ts
import { createSearchRoutes } from "./routes/search.js";
// …与 presence/conversation-* 路由同区：
app.route("/api", createSearchRoutes());   // → GET /api/search
```

- `apps/api/src/openapi.ts`：新增 `GET /api/search` path。查询参数 `q`（必填）、`scopes`（可选 csv）、`limit`（可选 int）；响应 `data = { query, groups[] }`，每 group `required: [scope, has_more, results]`，结果对象新增字段按「properties 全进、required 只放形状必备」惯例。
- `apps/api/src/app.test.ts`：把 `/api/search` 加进端点白名单。
- 迁移链：scratch 真库 0000→0057 重放（migration-audit）+ CI 逐 job 核 conclusion。
- 与并行批的 journal/schema.test 尾断言冲突：集成者手解（本批尾断言已钉 0057）。
- 计数门（r4 route matrix / registry / web smoke +1）属 W3 web-search-page，本工包无涉及。

## 4. 测试计数前后

| 包 | 前 | 后 | 新增 |
|---|---|---|---|
| @workhub/contracts | 121 | 126 | +5 |
| @workhub/db | 316（314 pass/2 skip） | 317（315 pass/2 skip） | +1 |
| @workhub/api | 1280（1279 pass/1 skip） | 1310（1309 pass/1 skip） | +30（service 26 + route 4） |

`pnpm -r typecheck` 全绿。（前值 = 后值 − 本批新增。）

## 5. 偏离说明

1. **q 最大长度取 64（非 200）**：设计文档 §2 与 §4 表格两处均写 `2–64 字符`；本工包任务的「要点重申（文档为准）」条目文字写「max 200」，与其所指的文档冲突。依「文档为准」判定取 **64**。集成者/用户如要放宽到 200，改动仅一行：`packages/contracts/src/domain/search.ts` 的 `SEARCH_QUERY_MAX_LENGTH` + 服务层错误文案常量随之。
2. **journal 55→57 空一号**：0056 让给并行 MEM 批（集成裁定）。drizzle 按 journal 顺序应用不按 idx 连续性，55→57 无碍（真库重放已验证应用 57 条）。schema.test 尾断言钉 0057（设计批准的契约变更，非迁就）。
3. **工单 scope 不加个人空间围栏**：设计 §2 与头部裁定只对**网盘/会议**追加个人空间 owner-only 守卫；工单沿用 `canViewWorkItemRecord`（status/submitter/assignee 判定），与既有工单列表/详情端点同口径，未引入新围栏。
4. **会话 deep_link 携带 seq 但精确滚动消费不在本包**：`deep_link.{project,conversation,seq}` 已给全；桌面 workbench 侧「进入时按 seq 滚动+高亮」是跨包依赖（桌面聊天 UI agent 在 `workbench/**` 做），本工包不碰 `workbench/**`（§6）。
5. **snippet 服务端纯函数取全文开窗**：drive 正文/会议纪要（≤64KB 内联）整段回服务层再 `buildSnippet`（遵设计「服务端纯函数 buildSnippet」）；外置大文件正文不索引（诚实限制，文件名永远可搜）。
6. 契约测试落 `packages/contracts/src/search.test.ts`（顶层 src），因该包测试 glob 为非递归 `src/*.test.ts`，`src/domain/*.test.ts` 不被收集。
