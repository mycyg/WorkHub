# R14 批 GH · 工包 GH-B gh-worker 交付报告

> 分支 r14/gh-worker · 2026-07-14 · 设计稿：r14-release-readiness/07-gh-design.md §4（轮询 worker）+
> GH-A 交付报告 r12-desktop-workbench/reports/r14-gh-server.md §5（仓库原语/客户端类型清单）
> 范围：GitHub 仓库轮询 worker（薄调度壳 + 厚 service）+ 项目主页 VM 的 GitHub 活动区块。

## 1. 交付物清单（4 个 targeted commit）

| 文件 | 内容 |
|---|---|
| `apps/api/src/services/github-poll.ts`（新） | `createGithubSyncService`/`runOnce()`——厚 service 层：到期判定、逐绑定拉 commits/issues、活动 upsert、水位/ETag 推进、失败降级、加密密钥缺失静默跳过 |
| `apps/api/src/services/github-poll.test.ts`（新） | 7 例：水位推进+ETag 捕获 / 304 空转保留旧 ETag / 单绑定失败不连累其余 / 到期节奏(健康 vs 失败退避) / 密钥缺失零结果+只 warn 一次 / 去重幂等 / 限流退避透传(真 client+fetchImpl mock) |
| `apps/api/src/workers/github-poll.ts`（新） | `createGithubSyncScheduler`——薄调度壳：`{tick,start,stop,stats}` + 重入守卫 + `setInterval().unref()`，照抄 `conversation-reply-judge.ts` 结构 |
| `apps/api/src/workers/github-poll.test.ts`（新） | 5 例：委派+累计统计 / tick 重入安全 / 失败记录+rethrow / start/stop 假定时器接线 / intervalMs<=0 不调度 |
| `apps/api/src/services/project-home-pages.ts` | 新增可选依赖 `githubActivities`（`Pick<GithubBindingRepository,"listRecentActivitiesByProject">`）+ VM 新增 `github_activities?` 区块，取数失败/未注入/无活动均静默省略字段（同军团 pill 手法） |
| `apps/api/src/project-home-pages.test.ts` | 新增 4 例（含原有基线测试补一条“未注入时字段不出现”断言）：有活动时出现且字段映射正确 / cap 8 / 绑定但零活动时省略 / 取数抛错时降级且不拖垮主页其余部分 |
| `packages/contracts/src/pages.ts` | `projectHomePageVmSchema` 新增 `github_activities: z.array(githubActivityVmSchema).optional()`（additive，复用 GH-A 已定义的 schema） |
| `packages/db/src/github-bindings.test.ts` | 补一例 `listEnabledBindings` 的 SQL 层测试（`enabled=true` WHERE 断言）——GH-A 交付时这条查询本身没有测试覆盖，是 worker 每 tick 的候选来源，属于我方消费面的空白，顺手补上 |

## 2. 轮询节奏与退避

- **两个时间维度分开**：
  - **tick 频率 = 5 分钟**（`workers/github-poll.ts` 的 `DEFAULT_TICK_INTERVAL_MS`）——多快发现"有绑定到期该同步了"。
  - **同步间隔 = 15 分钟**（`services/github-poll.ts` 的 `DEFAULT_SYNC_INTERVAL_MS`）——每个绑定多久真正打一次 GitHub，基于 `binding.lastSyncedAt`。
  - 最坏延迟 20 分钟（tick 周期 + 同步间隔），照设计稿 §4.3 判断可接受。
- **失败退避拉长（新增判断，设计稿未给出精确算法，本工包按其"连续失败退避拉长"字面要求落地）**：处于失败态（`lastError`+`lastErrorAt` 均非空）的绑定改用 `DEFAULT_FAILURE_BACKOFF_MS = 60 分钟`，以 `lastErrorAt` 为锚点，而非继续套用健康节奏的 `lastSyncedAt`+15 分钟。
  - **原因**：`recordSyncFailure` 不推进 `lastSyncedAt`（设计稿 §4.2/验收4 明确要求"水位不推进"）。若到期判定继续只看 `lastSyncedAt`，一个持续失败的绑定（PAT 失效/仓库改名）会让 `now - lastSyncedAt` 只增不减，永远 `>= 15 分钟` 成立——等于每 5 分钟 tick 就重打一次，把 tick 频率当成了重试频率，浪费配额、反复产生同一个失败。改用 `lastErrorAt` 作为失败态的锚点后，恢复节奏正常：任一次 `recordSyncSuccess` 会清空 `lastError`/`lastErrorAt`（GH-A 仓库层既有行为），下一 tick 立刻回到健康节奏判定。
  - 测试 `only due bindings are synced: healthy 15-minute cadence and failure backoff are separate clocks`（`services/github-poll.test.ts`）用 4 个绑定覆盖：近期健康(未到期)/到期健康/近期失败(退避未到)/早期失败(退避已过) 四种组合，断言只有后两者中"到期"的两个被真正同步。
- **限流退避=完全透传，不重新实现**：GH-A 的 `github-client.ts` 内部已经处理 `X-RateLimit-Remaining:0` 短路等待 + `nextRetryDecision` 的 429/5xx/网络错误重试，worker/service 层不做任何额外判断——`syncOneProject` 直接 `await client.listCommitsSince(...)`，客户端内部的 `sleep` 阻塞完，或者 resolve 或者 throw，worker 只负责 catch 后记录失败。测试 `the client's rate-limit backoff is honored transparently` 用真实 `createGithubClient` + `fetchImpl` mock（403+`X-RateLimit-Reset` → 200）验证这条透传关系，不重复断言客户端内部算法本身（那是 `github-client.test.ts` 的territory）。
- **加密密钥未配置＝ fail-closed 静默跳过**：`runOnce()` 一进来先查 `secretBox`，未配置时**连 `listEnabledBindings()` 都不调**（不查绑定表，不发任何请求），返回 `{scanned:0,synced:0,skipped_not_due:0,failed:0,...}`，只在第一次命中时 `logger.warn` 一次（模块级闭包变量 `warnedUnconfigured`），后续 tick 不再刷屏。与 GH-A `github-bindings.ts` 的 503 fail-closed 同一口径。
- **水位推进语义**：commits/issues 各自独立 `since` 水位，取本批条目 `occurred_at`/`updated_at` 的最大值；**空批次（含 304 命中）不推进对应水位**（防 clock skew 漏拉边界数据，设计稿 §4.2 步骤5）；ETag 命中(304)不返回新 ETag 时保留上一次的值；`last_synced_at` 无论本批是否有新增活动都无条件推进（"检查过一次"本身就是成功的一轮同步）。
- **幂等**：`upsertActivity` 落到 `(project_id, kind, external_id)` 唯一约束（GH-A 仓库层），worker 侧对 PR 子集正确分流 `kind`（issues 端点 `is_pull_request` 已由客户端标注），`externalId` 统一转字符串，同一批数据重复同步不会在活动表堆出重复行。

## 3. 挂载 snippet（留给集成者，`server.ts` 是本工包禁区）

```ts
// apps/api/src/server.ts
import { getDefaultGithubSyncScheduler } from "./workers/github-poll.js";
// ...

// 挂在 recoveryScheduler/sessionSweepScheduler/riskMonitorScheduler 同一档：无条件 start()，
// 不经 isConfigured 门控（GH 轮询是纯 HTTP 轮询，不调 LLM）。加密密钥未配置时 runOnce() 内部
// 自行空转，不影响 scheduler 能不能 start()（07-gh-design §0 结论2/§4.3）。
const githubSyncScheduler = getDefaultGithubSyncScheduler();
githubSyncScheduler.start();

// shutdown 处：
githubSyncScheduler.stop();
```

无需改 `app.ts`/`openapi.ts`（worker 不挂路由）。

## 4. 项目主页 `github_activities` 区块设计取舍

任务书给的字段名是 `github_activities?`（不是设计稿草案里的 `github?: {repo_full_name, recent_activity, ...}` 富对象）。本工包按字面执行：**`github_activities` 直接是 `GithubActivityVM[]`**（复用 GH-A 已定义的 `githubActivityVmSchema`，不另包一层 `repo_full_name`/`sync_status`/`last_synced_at` 元信息——那些已经在 `GET /api/projects/:id/github-binding` 的 `GithubBindingStatusVM` 里存在，绑定卡组件走那个端点即可，不需要在项目主页 VM 里重复一份）。

- **省略语义**：未绑定 repo、绑定了但暂无活动、取数失败——三种情况都省略整个字段（不是空数组占位），因为在这个精简形状下三者对前端渲染层是同一件事："没有活动可展示"。这比设计稿草案的"未绑定省略/绑定无活动渲染空态"区分更简单，因为区分绑定状态的信息本来就该走绑定卡端点而不是这里。
- **cap = 8**：照设计稿 §5.1"GitHub 活动条目更短所以给多一点"的判断，`RECENT_GITHUB_ACTIVITY_LIMIT = 8`（对比 `recent_files` 的 5）。裁剪逻辑在 VM 组装处（`fetchRecentGithubActivities`），与 GH-A 报告 §6 "cap 8 由 VM 层裁"一致。
- **取数失败降级**：`try/catch` 吞错返回空数组，照抄军团 pill（`armyProgress`）的既有手法，纳入首屏 `Promise.all` 一起并行取数（用内部 try/catch 包裹，保证不会让 `Promise.all` 因这一路失败而 reject 掉整个页面）。
- **依赖注入**：`ProjectHomePageServiceDependencies.githubActivities?: Pick<GithubBindingRepository, "listRecentActivitiesByProject">`——可选注入，缺省时字段不出现，`getDefaultProjectHomePageService()` 用 `createGithubBindingRepository(db)` 接上。

## 5. 测试计数（前 → 后，`pnpm --filter <pkg> test`）

| 包 | 前 | 后 | 增量 |
|---|---|---|---|
| @workhub/api | 1427（1426 pass + 1 skip） | 1443（1442 pass + 1 skip） | +16（github-poll service 7 + github-poll worker 5 + project-home-pages 4） |
| @workhub/db | 351（349 pass + 2 skip） | 352（350 pass + 2 skip） | +1（`listEnabledBindings` SQL 层断言） |
| @workhub/contracts | 146 | 146 | +0（复用 GH-A 已测试的 `githubActivityVmSchema`，只是在 `pages.ts` 里多包一层 `.array().optional()`，未新增独立断言点） |

`pnpm -r typecheck` 全绿（16/17 workspace 项目参与 typecheck，`apps/desktop-webview` 的 Rust crate 不在 tsc 范围内，行为与其余批次一致）。全程未跑 qa smoke/artifacts、未起后台进程、未打真网（全部 `fetchImpl` mock）。

## 6. 偏离与说明

1. **文件名**：任务书明确指定 `workers/github-poll.ts`（不是设计稿草案的 `workers/github-sync.ts`），本工包照办；配套 service 按既有"worker/service 同 basename"惯例命名为 `services/github-poll.ts`（同 `conversation-reply-judge.ts`/`risk-monitor.ts` 的先例），设计稿草案里的 `services/github-sync.ts` 未采用。
2. **失败退避的具体数值（60 分钟）与判定锚点（`lastErrorAt`）是本工包的设计补完**，设计稿 §1.3/§4 只给了"连续失败退避拉长"的方向性要求，未给算法。选择 `lastErrorAt` 而非"计数连续失败次数"是因为现有 schema（`0060` 迁移）没有失败计数列，不新增迁移（工包零迁移纪律）的前提下，`lastErrorAt` 是唯一能表达"最近一次失败发生在何时"的既有字段，足以实现"失败态绑定用更长间隔重试"这个目标，不需要额外计数状态。
3. **`github_activities` 字段形状收窄**：按任务书字面执行为扁平数组而非设计稿草案的富对象（含 `repo_full_name`/`sync_status`），理由见 §4。若集成阶段确认前端确实需要在项目主页直接展示"绑定/同步状态"而不额外调绑定端点，可在后续批次把这个字段升级为对象包裹，向后兼容（当前调用方按数组消费即可平滑升级）。
4. **`listEnabledBindings` 补测**：GH-A 报告未提及对这条查询单独测试，本工包作为其消费方，顺手在 GH-A 的既有测试文件 `packages/db/src/github-bindings.test.ts` 里补了一例（用既有 `createQueryRecorder` 假仓库手法，未改任何既有断言/未碰迁移文件），确认"enabled=false 跳过"这条纪律确实钉在 SQL WHERE 里而不是靠 worker 侧二次过滤。
5. **未做**：PR 链接进提议卡（设计稿 §0 结论1 已排除）、`project_health` 页 `github_stale` 信号（§5.2，留白）、RISK digest 第四种信号（§5.3，留白）、`related_work_item_id` 回填（§3.5/§5.4 stretch，未启用——`upsertActivity` 调用未传该字段，仓库层已支持但本工包不消费）、webhook 接收端（拍板不做）。
6. **未动禁区**：`app.ts`/`openapi.ts`/`app.test.ts`/`server.ts`、`apps/desktop-webview/**`、`apps/web/**`、`packages/ui/**`、`packages/db` 迁移、`services/conversations.ts`、`workers/risk-monitor.ts`、skill-curation 相关全部零改动（`git status` 可核）。
