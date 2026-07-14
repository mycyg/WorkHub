# R14 批 GH · 工包 GH-A gh-server-core 交付报告

> 分支 r14/gh-server · 2026-07-14 · 设计稿：r14-release-readiness/07-gh-design.md（头部集成裁定已定稿）
> 范围：服务端核心（加密 + 数据模型 + 绑定端点 + GitHub 客户端）。轮询 worker 按设计稿 §8 切片归 GH-B，本工包不做。

## 1. 交付物清单（4 个 targeted commit）

| commit | 内容 |
|---|---|
| feat(contracts) | `packages/contracts/src/domain/github.ts` 新域 + `github.test.ts` + index 导出 |
| feat(config) | `GITHUB_TOKEN_ENC_KEY` env（additive，默认空串）+ `settings.github.tokenEncKey` + `.env.example` |
| feat(db) | 迁移 `0060_project_github_bindings.sql` + journal 尾（idx=60, when=1783914000000）+ schema 两张表 + `repositories/github-bindings.ts` + 单测 + schema.test 尾断言钉 0060、表 graph 68→70 |
| feat(api) | `services/secret-box.ts`（AES-256-GCM）+ `services/github-client.ts`（裸 REST）+ `services/github-bindings.ts`（绑定服务）+ `routes/github-bindings.ts`（未挂载）+ 三个测试文件 |

## 2. 端点表（`apps/api/src/routes/github-bindings.ts`，未挂载）

| 端点 | 语义 | 权限 | 成败 |
|---|---|---|---|
| `GET /api/projects/:id/github-binding` | 读绑定状态（永不含 PAT 明文/密文） | 项目可见者（canViewProjectDrive） | 200 `GithubBindingStatusVM`（未绑定 `bound:false`）/ 401 / 404（不存在或不可见，藏存在性；非法 uuid 同 404） |
| `PUT /api/projects/:id/github-binding` | 绑定或更新（换 repo/换 PAT 均重置水位） | 仅 project owner | 201（新建）/ 200（更新）/ 401 / 403（可见非 owner）/ 404 / 422（repo 格式错走全局 zod 422；真连验证失败 `github_binding_connection_failed`，不写任何行）/ 503（未配置加密密钥，fail-closed） |
| `DELETE /api/projects/:id/github-binding` | 解绑=物理删行（密文销毁，活动表 cascade） | 仅 project owner | 204 / 401 / 403 / 404（含「本就没绑」）。不需要加密密钥（密钥丢失也能销毁） |
| `POST /api/projects/:id/github-binding/test` | 测试连接（body 带临时 PAT 不落库；空 body 用已存 PAT） | 仅 project owner | 200 `GithubTestConnectionResult`（连接失败=`ok:false`+人话原因，非 HTTP 错误）/ 401 / 403 / 404 / 422（临时 PAT 无 repo 可测）/ 503（空 body 需解密而密钥未配置） |

错误映射在路由模块内自带（照 drive.ts 手法），挂载时无需改 `app.onError`；请求体 ZodError 走 app.ts 既有全局 422。

## 3. 加密方案落地说明

- `apps/api/src/services/secret-box.ts`：纯函数 `createSecretBox(keyBase64)` → `{seal, open}`。
  AES-256-GCM，主密钥=env `GITHUB_TOKEN_ENC_KEY`（必须解码为恰好 32 字节，否则 `SecretBoxKeyError` 显式抛错）；
  每次 seal 随机 96-bit IV；open 侧钉死 IV=12 字节、authTag=16 字节（短标签截断攻击直接拒）。
- 落库=密文三列 `pat_ciphertext/pat_iv/pat_auth_tag`（bytea，复用头像批的 customType），不拼接单字符串。
- fail-closed：env 未配置 → 服务构造时 `secretBox=undefined` → PUT/存量重测 503 `github_binding_encryption_unconfigured`；
  密钥配置错误（非 32 字节）→ `getDefaultGithubBindingsService()` 首次调用显式抛错，绝不静默降级明文存储。
- 安全红线 7 条落点：
  1. 明文只在 `upsertBinding` 验证/加密与 `testConnection` 解密两个调用栈内瞬时存在；日志只打显式字段（测试钉死）。
  2. `githubBindingStatusVmSchema` 结构性无 token 字段（contracts 测试扫描键集合），zod strip 剔除误传键。
  3. 密钥（env）与数据（DB dump）分开保管。
  4. 未配置即 503，无明文兜底（测试断言 repo 层 0 写入）。
  5. 客户端零密钥：VM/响应无 token 位，无新增 SSE 事件。
  6. 临时 PAT 只用于当次 getRepo，函数返回不持有引用，不落库（测试断言 upsert 未被调）。
  7. DELETE 物理删行（迁移断言 `PRIMARY KEY ... ON DELETE cascade` + 活动表 cascade FK 形状）。

## 4. 挂载 snippet（留给集成者，app.ts/openapi.ts 是本工包禁区）

```ts
// apps/api/src/app.ts
import { createGithubBindingRoutes } from "./routes/github-bindings.js";
// ...（与 aiSettingsRoutes 同一挂载段）
app.route("/api", createGithubBindingRoutes());
```

无需改 `app.onError`（路由自带错误映射）。openapi.ts 若要登记四端点，schema 名：
`githubBindingRequestSchema` / `githubTestConnectionRequestSchema` / `githubBindingStatusVmSchema` / `githubTestConnectionResultSchema`（均自 `@workhub/contracts`）。

## 5. GH-B（轮询 worker）需要的类型与查询清单

全部已从 `@workhub/db` 与 `apps/api/src/services/github-client.ts` 导出：

- 仓库（`createGithubBindingRepository(db)`，类型 `GithubBindingRepository`）：
  - `listEnabledBindings(): Promise<GithubBindingRow[]>`（enabled=true 全量，不分页）
  - `upsertActivity(input: UpsertGithubActivityInput)`（幂等：三列冲突键 DO UPDATE 只动 title/state/authorLogin）
  - `recordSyncSuccess(projectId, {commitsSince?, issuesSince?, etagJson?}, at)`（推进水位+清 last_error；未提供的水位不动）
  - `recordSyncFailure(projectId, humanError, at)`（只落人话摘要，不推进水位）
  - `countActivitiesSince` / `listRecentActivitiesByProject`（GH-C 也用）
- 客户端（`createGithubClient({fetchImpl?, now?, sleep?, maxAttempts?, maxDelayMs?})`，类型 `GithubClient`）：
  - `listCommitsSince(repo, pat, {since?, etag?, perPage?})` → `{items: GithubCommitItem[], notModified, newEtag?, rateLimitRemaining?}`
  - `listIssuesSince(...)` → `GithubIssueItem[]`，条目带 `is_pull_request` 布尔（issues 端点 PR 子集已分流，落库 kind 由 worker 决定）
  - 客户端内部已处理：ETag If-None-Match、304 不解析 body、限流短路等待（X-RateLimit-Reset）、
    429/5xx/网络错误退避（复用 `nextRetryDecision`）、等待钳顶 60s
  - `humanizeGithubError(error)`：落 `last_error` 前收敛人话（无 token/堆栈）
- 加密（`apps/api/src/services/secret-box.ts`）：`createSecretBox(settings.github.tokenEncKey)`，
  worker 空转判定=「tokenEncKey 为空 → runOnce 直接返回空结果」（07-gh-design §4.3）
- 服务错误类型：`GithubBindingServiceError`（status 403|404|422|503）

## 6. GH-C（项目主页/设置卡）需要的类型与查询清单

- 契约：`GithubBindingStatusVM`（绑定卡）、`GithubActivityVM`（活动条目，含 kind/title/html_url/occurred_at/author_login?/state?）、
  `GithubBindingRequest` / `GithubTestConnectionRequest` / `GithubTestConnectionResult`（表单）
- 查询：`listRecentActivitiesByProject(projectId, limit)`（cap 8 由 VM 层裁）、`countActivitiesSince(projectId, since)`
- 端点即 §2 四条；PAT 输入用 password 型 input 且从不回填（VM 无 token 字段可回填）

## 7. 测试计数（前 → 后）

| 包 | 前 | 后 | 增量 |
|---|---|---|---|
| @workhub/db | 327（325 pass + 2 skip） | 335（333 pass + 2 skip） | +8（仓库收口/幂等/水位语义） |
| @workhub/contracts | 132 | 137 | +5（schema 形状+token 结构排除） |
| @workhub/config | 14 | 15 | +1（tokenEncKey 默认/透传/唯一落点） |
| @workhub/api | 1345（1344 pass + 1 skip） | 1380（1379 pass + 1 skip） | +35（secret-box 8 + client 12 + 路由/服务 15） |

`pnpm -r typecheck` 全绿；`pnpm audit:migrations`（静态重放安全门）通过。真库 0000→0060 replay 留集成阶段（本分支 journal 57→60 有洞是预期，见 §8）。

## 8. 偏离与说明

1. **journal 洞（57→60）**：按任务书/集成裁定执行——0058（FEEDBACK）/0059（RISK）在并行分支占号，
   本分支尾断言直接钉 0060，集成者合并时归一。`when=1783914000000` 以头部集成裁定为准
   （设计稿正文 §2 的 1783913000000 是定稿前旧值，裁定覆盖之）。
2. **活动索引用升序复合索引**（设计稿写 `occurred_at DESC`）：照 0017 notifications 先例，
   Postgres btree 反向扫描等价满足 `ORDER BY occurred_at DESC LIMIT n`，且与 drizzle schema 声明
   逐字节一致避免快照漂移。语义零差别。
3. **DELETE 不要求加密密钥**：设计表格未给 DELETE 列 503；判断为「密钥丢失时更要能销毁密文行」，
   fail-closed 只约束新密文写入与解密路径。
4. **test 端点补了 422 `github_binding_repo_required`**：设计 §3.2 允许 body 带临时 PAT，但未绑定
   项目上首次测试必须知道测哪个 repo——契约给了可选 `repo_full_name`，两者都缺时诚实 422 而非猜测。
5. **worker（`services/github-sync.ts` + `workers/github-sync.ts`）未做**：设计 §8 切片明确归 GH-B；
   GH-B 所需的仓库原语与客户端类型已在本工包备齐（§5）。
6. **relations/core.ts 未加两张新表**：照 CHAT 批先例（message_reactions 也未加），本批查询全走
   显式 select/join，不用 drizzle 关系查询 API。
7. **未动禁区**：app.ts/openapi.ts/app.test.ts/server.ts、desktop/web/ui、conversations/proposals/
   workers、ai_feedback/risk 相关全部零改动。
