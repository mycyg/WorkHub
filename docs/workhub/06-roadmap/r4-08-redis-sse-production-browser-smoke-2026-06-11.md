---
module: R4-web-redis-sse-production-browser-smoke
layer: C-WEB / C-DAEMON / Redis / DB / QA
status: ✅ accepted via remote Linux Redis/SSE smoke
owner: workflow
date: 2026-06-11
visuals:
  - ../05-clients/assets/web/web-ai-first-home.png
  - ../05-clients/assets/web/web-approval-center.png
  - ../05-clients/assets/web/web-workitem-detail.png
  - ../05-clients/assets/web/web-deliverable-change-request.png
evidence:
  - ../05-clients/assets/audit/2026-06-11-r4-web-redis-sse-production-browser-smoke/redis-sse-production-browser-report.json
  - ../05-clients/assets/audit/2026-06-11-r4-web-redis-sse-production-browser-smoke/contact-sheet.png
  - ../05-clients/assets/audit/2026-06-11-r4-web-redis-sse-production-browser-smoke/smoke-summary.md
---

# R4.8 Redis/SSE Production Browser Smoke

## 1. 开工阅读

本轮开工前已复读：

- [`../05-clients/web-app.md`](../05-clients/web-app.md)
- [`../05-clients/page-concepts.md`](../05-clients/page-concepts.md)
- [`../01-architecture/api-contract.md`](../01-architecture/api-contract.md)
- [`../02-ai-engine/r2-redis-broker-presence.md`](../02-ai-engine/r2-redis-broker-presence.md)
- [`../02-ai-engine/r2-topic-boundary.md`](../02-ai-engine/r2-topic-boundary.md)
- [`../02-ai-engine/r2-pg-redis-heartbeat-matrix.md`](../02-ai-engine/r2-pg-redis-heartbeat-matrix.md)
- [`../02-ai-engine/r2-release-gate.md`](../02-ai-engine/r2-release-gate.md)
- [`r4-07-web-live-api-pg-seed-smoke-2026-06-11.md`](./r4-07-web-live-api-pg-seed-smoke-2026-06-11.md)
- [`review-driven-r0-r4-detailed-construction-plan-2026-06-08.md`](./review-driven-r0-r4-detailed-construction-plan-2026-06-08.md) 的 R4 段落
- 概念图：`web-ai-first-home.png`、`web-approval-center.png`、`web-workitem-detail.png`、`web-deliverable-change-request.png`

只读子 agent 结论：R4.8 必须在 R4.7 的真实 API/PG 浏览器 gate 上增加 `BROKER_BACKEND=redis`、`BROKER_URL=redis://127.0.0.1:6379`、`WORKER_COUNT=2`，并证明浏览器 EventSource 经 Redis 收到跨 worker 事件后仍以 REST Page VM 为真相源重拉。

## 2. 本轮范围

R4.8 是 Redis/SSE production browser smoke，不是完整 React component route tree，也不是服务端动态双语内容完成。

已落代码：

1. `apps/web/src/browser.ts`
   - ready route 绑定原生 `EventSource(...,{ withCredentials:true })`。
   - 每个 route 默认订 `stream/me`；WorkItem / Proposal / Replay 追加订 `workitem`、`proposal`、`run` topic。
   - 收到 contract 内事件后写入只读 QA metrics，再 debounce 触发 `renderCurrentRoute()`，保证 SSE 只是增量提示，REST Page VM 仍是真相源。
2. `apps/web/qa/r4-web-redis-sse-browser-smoke.ts`
   - 复用 R4.7 seed，启动两个真实 API daemon：stream worker 与 action worker。
   - 验证 Redis broker 本身跨实例投递、production 多 worker 禁用 memory broker、topic auth、真实 Chrome EventSource、permission event 和 run event。
   - 截图覆盖 R4.7 原 13 步，并新增：
     - `14-approvals-after-redis-sse-permission-decided-empty.png`
     - `15-replay-after-redis-sse-agent-step-real-api.png`
   - 中途 route 失败会输出页面错误文本，避免只看到 `last value=error`。
3. `apps/api/src/workers/agent-runner.ts`
   - 修复多 worker 数据流 bug：`queue.get()` / `queue.trace()` / `queue.abort()` 不再盲信进程内旧缓存，而是与 persistence 读数比较 `updated_at` 与 trace length，择新后回写缓存。
   - 该修复保证“另一个 worker 写入 DB trace + Redis 发事件”后，当前 worker 的 Replay REST reconcile 能读到新 trace。
4. `apps/api/src/agent-runs.test.ts`
   - 新增 “agent run queue refreshes stale cached trace from persistence” 回归测试，模拟 worker A 缓存旧 run、worker B 通过 persistence 写入新 step。
5. 新增 root `pnpm qa:r4-web-redis-sse-browser-smoke` 与 Web 包脚本。

## 3. 当前验收状态

本机已通过：

```powershell
node node_modules\typescript\bin\tsc -p apps\api\tsconfig.json --noEmit
node node_modules\typescript\bin\tsc -p apps\web\tsconfig.json --noEmit
node node_modules\typescript\bin\tsc --noEmit --module NodeNext --moduleResolution NodeNext --target ES2022 --types node --skipLibCheck apps\web\qa\r4-web-redis-sse-browser-smoke.ts
node --import tsx --test apps\api\src\agent-runs.test.ts
node --import tsx --test apps\api\src\push.test.ts apps\api\src\broker.test.ts apps\api\src\notifications.test.ts
node --import tsx --test apps\web\src\*.test.ts
```

远端 Linux 验收：

- 测试机：`192.168.5.53`，Ubuntu 26.04，Node 22.22.1，pnpm 11.0.9，PostgreSQL 18.4，Chrome `/usr/bin/google-chrome`。
- 本轮已安装并启动 Redis 8.0.5，`redis-cli ping` 返回 `PONG`，服务为 `active`。
- 远端通过：

```bash
pnpm --filter @workhub/api typecheck
pnpm --filter @workhub/web typecheck
node --import tsx --test apps/api/src/agent-runs.test.ts
DATABASE_URL=postgresql+psycopg://workhub:workhub@127.0.0.1:5432/workhub \
BROKER_BACKEND=redis \
BROKER_URL=redis://127.0.0.1:6379 \
WORKER_COUNT=2 \
pnpm qa:r4-web-redis-sse-browser-smoke
```

R4.8 report：

- `ok=true`
- `steps=15`
- `redis_url=redis://127.0.0.1:6379`
- `cross_worker_permission_event_delivered=true`
- `redis_run_event_reconciled_replay=true`
- `topic_auth_owner_200_stranger_403=true`
- `browser_connected_to_sse=true`
- `no_horizontal_overflow=true`
- `no_text_box_overflow=true`
- `mobile_scroll_no_topbar_nav_overlap=true`

关键 live proof：

- Approval 页面先打开 `stream/me`；action worker 通过真实 `POST /api/approvals/:id/respond` 让 Redis 发 `permission.decided`；浏览器收到后重拉 `/api/pages/approvals`，route state 变为 `empty`。
- Replay 页面打开 `stream/me`、`stream/run/:id`、`stream/workitem/:id`；脚本向 Redis 的 `run:{id}` 发布 `agent_run.step`；浏览器收到后重拉 `/api/pages/agent-runs/:id/replay`，页面显示 `R4.8 Redis SSE replay refresh step from the production-like browser smoke.`。

## 4. PRD / 概念图一致性审查

符合：

- Web 主窗仍是严肃派活/审批/管理界面，没有 Cuu 本体、没有默认 Kanban、没有旧周报 fixture 泄漏。
- SSE 只做“有变化”的信号，真实页面内容仍由 C-DAEMON REST Page VM 回读，符合 headless daemon + thin client 边界。
- `stream/me`、资源 topic 和 admin-only `all` topic 权限继续 fail-closed，符合 R2 topic boundary。
- 用户截图暴露的文本越框风险继续作为阻塞 gate；移动 proposal、settings、Replay 和 route-state 截图均无文本盒溢出。
- 中英切换仍通过 `workhub.locale` 和 Page VM locale query，固定 chrome 保持双语。

不能宣称：

- 不能宣称完整 React component route tree 已完成；当前 ready route 仍复用 shared HTML renderer。
- 不能宣称服务端动态内容已按 locale 生成；动态 task/proposal/run 文案仍来自 seed/daemon 原文。
- 不能宣称 Linux/macOS 原生桌面端完整验收完成；R4.8 只覆盖 Web browser + Redis/SSE。

## 5. Bug / Dataflow 审查

- 发现并修复：R4.8 首轮远端烟测中，浏览器已经收到 `agent_run.step` 并触发 refresh，但 Replay 页面仍看不到新 step。根因是 API worker 的 `AgentRunQueue.get()` 优先使用进程内旧缓存，导致跨 worker Redis 事件后的 REST reconcile 读不到另一个 worker 写入的 DB trace。
- 修复方式：读 run 时同时读取 persistence，按 `updated_at` 与 trace length 择新；新增单测覆盖 stale cached trace。
- 验证结果：修复后远端 smoke 中 `eventCount=1`、`refreshCount=1`、`lastEvent=agent_run.step`、`lastStream=run`、`replayStepVisible=true`。
- 权限流：owner workitem stream 200，stranger workitem stream 403，非 admin global all stream 403。
- 进程流：stream API 与 action API 是不同 Node 进程，Redis 是跨 worker broker，不是 in-process event bus。
- 视觉流：contact sheet 与单图确认移动端文本、按钮、路径、长标题均未越框；Replay 最终截图显示新增 step。

## 6. 后续详细计划

R4.9 已按本计划完成，详见 [`r4-09-web-locale-page-vm-shell-metrics-2026-06-11.md`](./r4-09-web-locale-page-vm-shell-metrics-2026-06-11.md)：Page VM 系统生成标签已按 `locale` 输出，Replay/Cost shell metrics 已改为从 VM 结构字段取数，远端 Linux PG + Redis + Chrome locale metrics browser smoke 已通过。

R4.10 施工顺序建议：

1. **Web route renderer componentization first slice**
   - 选 Home / Approvals / Replay 三页，从 shared HTML renderer 收敛到真实 route component 或更细粒度 shared component。
   - 保留 R4.8/R4.9 的 EventSource + REST reconcile、locale、path navigation 与 overflow gate。
2. **Action / notice locale continuation**
   - 把 proposal opened/merged、budget warning、approval response toast、retry/request access 等动作反馈接入同一 locale contract。
   - 继续保留 raw error、resource id、user text、evidence excerpt、proposal manifest 原文。
3. **继续远端真实环境验收**
   - R4.10 仍使用远端 Linux PG + Redis + Chrome。
   - 继续 gate：no Cuu、no Kanban、no weekly、no hash、no horizontal overflow、no text box overflow、ready/empty/forbidden/error、locale reload、topic auth、Redis/SSE reconcile。
