---
module: R4-web-live-api-pg-seed
layer: C-WEB / C-DAEMON / DB / QA
status: ✅ accepted via remote Linux PG smoke
owner: workflow
date: 2026-06-11
visuals:
  - ../05-clients/assets/web/web-ai-first-home.png
  - ../05-clients/assets/web/web-approval-center.png
  - ../05-clients/assets/web/web-workitem-detail.png
  - ../05-clients/assets/web/web-deliverable-change-request.png
evidence:
  - ../05-clients/assets/audit/2026-06-11-r4-web-live-route-interaction/live-route-interaction-report.json
  - ../05-clients/assets/audit/2026-06-11-cuu-run-card-overflow-regression/failed-run-card.png
  - ../05-clients/assets/audit/2026-06-11-r4-web-live-api-pg-seed/live-api-pg-seed-report.json
  - ../05-clients/assets/audit/2026-06-11-r4-web-live-api-pg-seed/contact-sheet.png
---

# R4.7 Web Live API / PG Seed Smoke

## 1. 开工阅读

本轮开工前已复读：

- [`../05-clients/web-app.md`](../05-clients/web-app.md)
- [`../05-clients/page-concepts.md`](../05-clients/page-concepts.md)
- [`../01-architecture/api-contract.md`](../01-architecture/api-contract.md)
- [`../02-ai-engine/r2-release-gate.md`](../02-ai-engine/r2-release-gate.md)
- [`r4-06-rust-system-string-i18n-plan-2026-06-11.md`](./r4-06-rust-system-string-i18n-plan-2026-06-11.md)
- [`review-driven-r0-r4-detailed-construction-plan-2026-06-08.md`](./review-driven-r0-r4-detailed-construction-plan-2026-06-08.md) 的 R4 段落
- 概念图：`web-ai-first-home.png`、`web-approval-center.png`、`web-workitem-detail.png`、`web-deliverable-change-request.png`

只读子 agent 补充确认：R4.7 必须启动真实 `apps/api/src/server.ts` TCP daemon，先迁移并写入确定性 PG seed，再让 Vite/Chrome 从浏览器路径访问真实 API；Redis/SSE production 浏览器联调留到 R4.8。

## 2. 本轮范围

R4.7 是 Web live API / Postgres seed smoke，不是完整 React route tree、不是 Redis/SSE production smoke，也不是服务端动态双语生成完成。

已落代码：

1. 新增 `packages/db/src/r4-web-seed.ts`：
   - 写入 R4.7 专用 work item / branch / agent run / proposal / approval / evidence / cost ledger 行。
   - 复用或创建浏览器默认 `P0.5 Reviewer` 用户，确保 `/agent-runs/:id/replay` 与 `/approvals` 的真实权限检查通过。
   - 保持 P0.5 gold-path route ID：`workItem=000...104`、`run=000...107`、`proposal=000...108`，让现有 shell 导航直接落到真实 DB 记录。
   - 写入一个受限 work item 和一个缺失 proposal ID，用于真实 API 的 `forbidden` / `empty` route-state gate。
2. 新增 `apps/web/qa/r4-web-live-api-pg-seed.ts`：
   - 跑 `runMigrations()` 与 `seedR4WebLiveApiPg()`。
   - 启动真实 API daemon、Vite dev server 与 Chrome CDP。
   - 覆盖 `/`、`/approvals`、`/workitems/:id`、`/proposals/:id`、`/agent-runs/:id/replay`、`/dashboard/cost`、`/settings`。
   - 保留 path nav click、history back/forward、locale toggle reload、ready/empty/forbidden/error、mobile proposal scroll。
   - 保留 no Cuu、no Kanban、no old preview shell、no weekly fixture copy、no hash navigation、no horizontal overflow、no text box overflow。
   - 修复远端 QA 发现的 tsx 子进程继承问题：API daemon 子进程显式设置绝对 `TSX_TSCONFIG_PATH`，避免父进程 `--tsconfig ../../tsconfig.base.json` 在 repo root 下被解析到错误目录。
3. 新增 `pnpm qa:r4-web-live-api-pg-seed`。
4. `apps/web/vite.config.ts` 支持 `WORKHUB_WEB_API_PROXY_TARGET`，方便真实 API 端口隔离。
5. `apps/api/src/pages/gold-path.ts` 对 Web shell 模板做产品化清洗，避免旧 demo 的 `Cuu` / `周报` / `weekly` 文案泄漏到主 Web。

## 3. 当前验收状态

已通过：

```powershell
corepack pnpm --filter @workhub/db typecheck
corepack pnpm --filter @workhub/web typecheck
corepack pnpm exec tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --types node --skipLibCheck --allowSyntheticDefaultImports apps/web/qa/r4-web-live-api-pg-seed.ts packages/db/src/r4-web-seed.ts
corepack pnpm --filter @workhub/api test
corepack pnpm qa:cuu-pet-run-card-overflow
corepack pnpm qa:r4-web-live-route-interaction
corepack pnpm verify
```

补充门禁：

- `@workhub/api test`：101/101 通过，确认 gold-path 产品化清洗没有破坏 API contract。
- 主 Web shell 可见文本漏词检查：`leak=false`，正文不再出现 `Cuu`、`客户周报/周报`、`weekly report/weekly`。
- `pnpm verify`：通过；R2 release gate 同步 PASS，README 文档计数 `83/83`、`reference` 未进入 diff、pending diff 无 secret-like API key。
- 远端 Linux 验收：`192.168.5.53` / `mycyg`，Ubuntu 26.04，PostgreSQL 18.4，Node 22.22.1，pnpm 11.0.9，Chrome `/usr/bin/google-chrome`。
- 远端命令通过：`APP_ENV=development DATABASE_URL=postgresql://workhub:workhub@127.0.0.1:5432/workhub ... pnpm qa:r4-web-live-api-pg-seed`。
- 远端 report：`ok=true`、`steps=13`、`api_target=http://127.0.0.1:42667`。
- R4.7 gates 全部为 true：`pg_seed_applied`、`api_server_started`、`vite_dev_server_started`、`screenshots_captured`、`ready_routes_use_live_api_endpoints`、`locale_toggle_reload`、`path_nav_clicks`、`history_back_forward`、`empty_and_forbidden_from_real_api`、`no_main_window_cuu`、`no_default_kanban`、`no_old_preview_shell`、`no_weekly_fixture_copy`、`no_hash_navigation`、`no_horizontal_overflow`、`no_text_box_overflow`、`mobile_scroll_no_topbar_nav_overlap`。
- 请求证明全部为 true：`authMe`、`identify`、`localePatch`、`attentionZh`、`approvals`、`workitemZh`、`workitemEn`、`proposal`、`replay`、`cost`、`settingsGoldPath`、`missingProposalEmpty`、`forbiddenWorkItem`。

已确认的用户截图问题：

- `qa:cuu-pet-run-card-overflow` 使用截图同源长文案 `Cuu R3 run-failure QA forced provider failure`。
- 结果：`bubble_no_horizontal_overflow=true`、`bubble_no_vertical_overflow=true`、`no_text_clipped_by_bubble=true`、`budget_visible_with_padding=true`。
- 当前截图证据：`../05-clients/assets/audit/2026-06-11-cuu-run-card-overflow-regression/failed-run-card.png`。

本机 Windows 仍未通过：

```powershell
corepack pnpm qa:r4-web-live-api-pg-seed
```

失败原因不是业务断言，而是本机环境没有 PostgreSQL：

```text
connect ECONNREFUSED 127.0.0.1:5432
```

2026-06-11 复跑仍停在同一环境点：Drizzle migration 执行 `CREATE SCHEMA IF NOT EXISTS "drizzle"` 时连接 `127.0.0.1:5432` 被拒绝。

已检查：

- Windows 服务中未发现 PostgreSQL。
- 本机没有 `docker` 命令，无法用仓库 `docker-compose.yml` 启动 `postgres:16`。
- 本机没有 `psql` / `pg_ctl` / `postgres`。
- WSL 没有默认发行版。
- 用户提供的 `192.168.5.53:22` SSH 端口探测 20 秒未返回，当前不能作为稳定验收路径。
- 2026-06-11 追加排障：Chocolatey 本地包列表没有 PostgreSQL；`choco install postgresql16 --params '/Password:workhub /Port:5432'` 与 `choco install postgresql --version=16.14.0 --params-global` 均未安装成功，社区源返回 `503/504`，且当前 shell 不是管理员。
- 2026-06-11 追加网络探测：`192.168.5.53:22`、`192.168.5.53:5432` 超时；`community.chocolatey.org:443` 解析到 `198.18.2.3` 且 TCP 失败。
- 2026-06-11 追加依赖检查：当前 root `node_modules` 没有 `pglite`、`pg-mem` 或 embedded Postgres 包；不能把真实 PG gate 降级成内存模拟。

因此 R4.7 当前状态是：**本机 Windows PG runtime 仍不可用，但远端 Linux 真实 API/PG browser smoke 已通过并拉回 report/contact sheet，可标记为 accepted。**

## 4. PRD / 概念图一致性审查

符合：

- Web 仍是派活/管理/审批瘦视图；真实业务读取走 C-DAEMON Page VM / REST endpoint。
- 默认一件事优先：Home 从 `/api/pages/attention` 读取 active run，Approval 从 `/api/pages/approvals` 读取待处理项。
- WorkItem、Proposal、Replay、Cost 均已在远端 R4.7 smoke 中走真实 DB-backed service，不再只依赖 mock surface。
- `Cuu` 仍只属于桌宠；主 Web shell 对旧 gold-path fixture 文案做产品化替换。
- 文本越框被提升为 smoke gate；密集卡片、移动端 proposal scroll、route-state card 都会检查 horizontal/text containment。

不能宣称：

- 不能宣称 Redis/SSE production browser refresh 已完成。
- 不能宣称 `/settings` 已有独立 Page VM；当前仍是 route-only fallback。
- 不能宣称服务端动态 VM 内容已按 locale 生成；R4.7 只证明 locale query / reload 链路。

## 5. Bug / Dataflow 审查

- 权限流：种子 run 的 `actorUserId`、approval 的 `routedToUserId`、work item 的 submitter/claimed user 都对齐浏览器默认用户，避免回放/审批被真实 auth gate 拒绝。
- 数据流：`seedR4WebLiveApiPg()` 写 PG 行；QA 启动 `apps/api/src/server.ts`；Vite proxy 指向真实 API；Chrome 通过 path route 驱动 `apps/web/src/routes.ts`。
- 成本流：seed 同时写 `usage_records` 与 user/team/workitem 三条 `cost_ledger_entries`，让 `/api/pages/cost` 能聚合真实 ledger。
- 文案流：gold-path shell 只清洗主 Web 可见旧 demo 文案；动态 DB seed 文案本身使用产品化 regional launch review，不依赖客户端硬翻译。
- 环境流：本机 Postgres 不可用时，脚本在迁移前置失败，不会伪造成功截图或降级到 mock API；远端 Linux PG 可用时，脚本完成迁移/seed/API/Vite/Chrome 全链路并产出截图。

## 6. 后续详细计划

R4.8 已在 [`r4-08-redis-sse-production-browser-smoke-2026-06-11.md`](./r4-08-redis-sse-production-browser-smoke-2026-06-11.md) 落地：远端 Linux 已补 Redis，真实 PG + Redis + 双 API worker + Chrome EventSource 15 步 smoke 通过。

R4.9 施工顺序：

1. 动态双语 Page VM：让 Home / WorkItem / Proposal / Replay / Cost 的固定摘要、状态、metric title/value 可按 `locale` 输出。
2. Shell 指标一致性：修正 Replay 等页面顶部 metric 与正文内容不一致的问题；有 step/decision/snapshot 时不再显示无意义的 0 值。
3. 继续沿用 R4.8 gates：
   - no Cuu / no Kanban / no old shell / no weekly fixture copy。
   - no horizontal overflow / no text box overflow / mobile scroll no topbar nav overlap。
   - route-state ready/empty/forbidden/error 和 path navigation/history/locale reload。
   - Redis/SSE topic auth、browser EventSource、跨 worker event delivered、REST reconcile。
4. 本机 Windows 可选收尾：
   - 若后续恢复 Docker 或 PostgreSQL 安装源，再补本机 `pnpm qa:r4-web-live-api-pg-seed` 复跑证据；这不是 R4.8 开工前置，因为远端 Linux 真实验收已闭环。
