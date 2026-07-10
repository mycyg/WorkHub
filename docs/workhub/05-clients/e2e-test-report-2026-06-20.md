# WorkHub 端到端测试总报告 2026-06-20

> **历史快照（2026-06-20）**：本报告基于当时的 15 条正式路由；现行注册表已扩至 18 条（projects / project-home / agents 等后续加入）。以 `apps/web/src/routes.ts` 的 shellPageOrder 为准。

## 结论

本轮按“服务端 + 本地客户端 + CUU UI + UI 交互 + 数据同步 + 每个页面 UI 形态”的目标完成系统性回归。Web、API、DB、Postgres live seed、Redis/SSE、CUU、desktop webview、Tauri Rust 壳与 macOS `.app` bundle 均通过；真实外部 LLM 评测已接入用户提供的 DeepSeek Anthropic-compatible 配置（密钥只作为环境变量注入，未写入仓库/报告），但当前真实模型链路在 R5.10 T3 富格式任务失败，应作为待修复问题保留。

关键状态：

| 范围 | 结果 | 说明 |
| --- | --- | --- |
| Web 全页面 UI | PASS | 15 条注册路由 ready + loading/empty/error/forbidden 全覆盖；live UI 72 步 |
| 服务端/API | PASS | `@workhub/api` 321 tests；`@workhub/db` 34 tests |
| 数据同步 | PASS | Postgres seed smoke 14 步；Redis/SSE production browser smoke 16 步 |
| CUU UI/客户端 | PASS | CUU smoke、pet overflow、desktop webview、Tauri test/build/app bundle 均通过 |
| 真实 LLM | FAIL | `deepseek-v4-pro` 真实评测在 T3 未产出 PNG/PPTX；dry pipeline 通过 |

## 本轮修复/补齐

| 文件 | 变更 |
| --- | --- |
| `apps/web/qa/r4-web-live-route-interaction.ts` | 补齐 `/dashboard/skills` live route、mock endpoint、DOM 审计、桌面/移动截图和 `r8_skills_route_component` gate；live step 数更新为 72 |
| `scripts/qa/r4-web-route-state-matrix.ts` | route-state summary 改为从完整 `r4WebRouteKeys` 动态列出 15 页 |
| `apps/web/qa/r4-web-live-api-pg-seed.ts` | live PG smoke 纳入 `/dashboard/skills` 与 `/api/pages/skills`，并禁止旧 gold-path fallback |
| `apps/web/qa/r4-web-redis-sse-browser-smoke.ts` | Redis/SSE smoke 纳入 skills route；修正生产 broker 校验和 topic 权限 proof |
| `apps/api/src/qa/r5-10-dry-agent-pipeline.ts` | 默认 seed user 改为 upsert 当前进程 cookie token，避免持久化 DB 随机 seed token 漂移导致 401 |
| `apps/api/src/qa/r5-10-real-key-evaluation.ts` | 同步 seed upsert 修复；真实 LLM 评测不再卡在认证预检 |

## 页面与按钮覆盖清单

| 页面 | 主要功能/按钮/控件 | 测试落点 |
| --- | --- | --- |
| Home `/` | 决策卡主动作、进入 intake、后台 run 状态、证据列表、SSE props 刷新 | live route `01*`，SSE props update，route-state matrix |
| Intake `/intake/:sessionId` | start intent 文本框、`start_intake`、选项卡、free text、`intake_continue`、`create_workitem` | live `01a-01d`、empty fail-closed、submit/create success、移动无溢出 |
| Approvals `/approvals` | 审批行选择、查看任务、`approve`、`deny`、理由快捷按钮、remember checkbox、评论提交表单 | live 覆盖 approve/deny/reason gate；评论表单已读代码和处理器，非本轮 live 点击 |
| WorkItem `/workitems/:id` | open proposal、open replay、create proposal draft、start agent run、source context 链接 | live workitem route、drive/meeting source 回跳、post-run clarity |
| Proposal `/proposals/:id` | `approve`、`request_changes`、`merge`、理由 gate、line editor、structured field editor、subrecord/custom field apply、dirty SSE guard | live `06a-10`、advanced editor payload parity、merge/review notices |
| Drive `/drive` | upload sample、delete、restore、preview/download/accepted restore、comment to draft、open draft/proposal、draft to proposal | live `15b-15e`、comment draft、draft proposal、operation log |
| Meetings `/meetings` | meeting list、create draft、dismiss、open draft/proposal、meeting workitem source、draft proposal | live `15f-15j`、移动无溢出 |
| Notifications `/notifications` | open、mark read、dismiss、mark all read、complete、grounding evidence links | live `15k-15p`、evidence jump |
| Calendar `/calendar` | schedule blocks、open target | live `15q-15r`、移动无溢出 |
| Health `/dashboard/health` | project cards、open project、health signal links、member band view | live `15s-15t` |
| Replay `/agent-runs/:id/replay` | restore deliverable、merge attempt/replay trace、SSE reconciliation | live `15-15a`、Redis/SSE replay reconciliation |
| Cost `/dashboard/cost` | budget scopes、risk notices、model breakdown、labor split、budget warning notice | live `12/12a`、PG/Redis live API |
| Knowledge `/knowledge/search` | open evidence、use for current task/evidence binding、missing evidence fallback | live `12b-12c`、notification source ref |
| Skills `/dashboard/skills` | skill cards、active/AI-authored/refined totals、refinement badge、empty-state marker | live `15v-15w`、route-state matrix |
| Settings `/settings` | locale switch/persistence、runtime/LLM/language/device panels、desktop-only restore gate | live `13-14a`、secret-safe and desktop boundary gates |
| Shell/global | path navigation, history back/forward, locale toggle, no hash write, onboarding identity/logout paths | live route interaction and web unit tests |
| CUU pet/client | option-first launcher, clarification, confirmation, run stream, failure/offline/error cards, reload restore, pet run-card overflow | CUU smoke suite and pet screenshot gate |

## 执行命令

| 命令 | 结果 | 备注 |
| --- | --- | --- |
| `pnpm qa:r4-web-route-state-matrix` | PASS | 15 路由 x 4 状态，zh-CN/en-US，桌面/移动截图 |
| `pnpm qa:r4-web-live-route-interaction` | PASS, 72 steps | 全页面 ready UI、按钮/表单、SSE、移动端无溢出 |
| `pnpm --filter @workhub/web test` | PASS, 29 tests | route loader、Page VM、route-state |
| `pnpm --filter @workhub/ui test` | PASS, 77 tests | route components、skills、proposal/replay/workitem UI |
| `pnpm qa:r4-web-live-api-pg-seed` | PASS, 14 steps | 真实本机 API + Postgres seed |
| `docker compose exec -T redis redis-cli ping` | PASS | 返回 `PONG`；Redis 容器保持运行供后续 smoke 使用 |
| `pnpm qa:r4-web-redis-sse-browser-smoke` | PASS, 16 steps | Redis broker、跨 worker event、Replay reconciliation |
| `pnpm --filter @workhub/api test` | PASS, 321 tests | 本轮 seed QA 修复后重跑通过 |
| `pnpm --filter @workhub/db test` | PASS, 34 tests | DB repositories/schema |
| `pnpm qa:r5-10-dry` | PASS | fake provider dry pipeline、ledger/confidence/download proof |
| `pnpm qa:r5-10-real` | FAIL at T3 | 真实 DeepSeek `deepseek-v4-pro`；T3 未产出 PNG/PPTX |
| `pnpm qa:cuu-r3-launcher-smoke` | PASS | launcher、clarification、confirmation、WorkItem/AgentRun |
| `pnpm qa:cuu-r3-dev-server-smoke` | PASS | 真实本机 HTTP server、client-token auth |
| `pnpm qa:cuu-r3-run-stream-smoke` | PASS | fetch SSE、run succeeded |
| `pnpm qa:cuu-r3-run-failure-smoke` | PASS | REST fallback、failed run card |
| `pnpm qa:cuu-r3-reload-restore-smoke` | PASS | session/active run/terminal run restore |
| `pnpm qa:cuu-r3-error-fault-smoke` | PASS | 401/403/offline/502 映射 |
| `pnpm qa:cuu-pet-run-card-overflow` | PASS | pet run-card overflow screenshot gates |
| `pnpm --filter @workhub/cuu test` | PASS, 37 tests | Cuu logic package |
| `pnpm --filter @workhub/desktop-webview test` | PASS, 106 tests | desktop webview runtime and Cuu action pipeline |
| `pnpm --filter @workhub/desktop-webview build` | PASS | webview bundle |
| `cargo test --manifest-path client-tauri/src-tauri/Cargo.toml` | PASS, 90 tests | Tauri Rust shell |
| `cargo build --manifest-path client-tauri/src-tauri/Cargo.toml` | PASS | native shell dev profile |
| `cargo tauri build --debug --no-bundle --ci` | PASS | debug native binary |
| `cargo tauri build --debug --bundles app --no-sign --ci` | PASS | macOS `.app` bundle |

## 真实 LLM 失败记录

真实评测命令使用的密钥未写入仓库/报告。第一次运行在认证预检前失败，根因是持久化 DB 中默认 seed user 与进程随机 cookie token 不一致；已通过 dry/real QA seed upsert 修复。第二次运行加入专用 Python venv、`AGENT_RUN_ALLOW_UNSANDBOXED_COMMANDS=true` 和可写 Matplotlib cache 后，仍在 T3 失败：

- provider: `deepseek`
- model: `deepseek-v4-pro`
- endpoint shape: Anthropic-compatible DeepSeek base URL
- failure: `T3 assessment failed: 富格式文件缺失或为空`
- evidence: latest T3 workdir contained `outputs/build_chart.py`, `outputs/build_pptx.py`, `outputs/t3-weekly-metrics-outline.md`, `outputs/t3-weekly-metrics-chart-data.csv`, but the agent run did not create `outputs/t3-weekly-metrics-chart.png` or `outputs/t3-weekly-metrics.pptx`
- local dependency check: running those generated scripts manually with `/Users/apple/Desktop/开发项目/.runtime/r5-10-eval-venv/bin/python3` produced `t3-weekly-metrics-chart.png` (41K) and `t3-weekly-metrics.pptx` (68K)
- extra observation: several merge-fusion mediator attempts hit `stop_reason=max_tokens` and correctly fell back to deterministic diff3, but this fallback was not the direct T3 assertion failure

判断：真实 LLM 验收失败点不是本机 Python 依赖，也不是认证；更像是 `deepseek-v4-pro` 在 T3 中写出生成脚本后没有实际调用 `run_command` 执行，或没有把执行产物留在指定 `outputs/` 路径。建议后续修复方向是：对富格式任务增加 agent loop 的“脚本已写但目标产物缺失”自恢复检查，自动运行/重试生成脚本或明确升级。

## 证据路径

- `docs/workhub/05-clients/all-page-ui-shape-test-report-2026-06-20.md`
- `docs/workhub/05-clients/cuu-client-test-report-2026-06-20.md`
- `docs/workhub/05-clients/assets/audit/2026-06-11-r4-web-live-route-interaction/`
- `docs/workhub/05-clients/assets/audit/2026-06-11-r4-web-route-state-matrix/`
- `docs/workhub/05-clients/assets/audit/2026-06-11-r4-web-live-api-pg-seed/`
- `docs/workhub/05-clients/assets/audit/2026-06-11-r4-web-redis-sse-production-browser-smoke/`
- `docs/workhub/05-clients/assets/audit/2026-06-11-cuu-run-card-overflow-regression/`
- `docs/workhub/05-clients/assets/audit/2026-06-13-r5-10-dry-agent-pipeline/`
- `client-tauri/src-tauri/target/debug/workhub-client-tauri`
- `client-tauri/src-tauri/target/debug/bundle/macos/WorkHub.app`

## 最终判断

除真实外部 LLM R5.10 T3 外，本轮端到端测试通过。Web 页面覆盖已扩到完整 15 路由，服务端/DB/Redis/Postgres 数据同步和本地客户端/Tauri 均有自动化证据。真实 LLM 链路已跑到模型实际产出阶段，并暴露了一个需要修复的富格式交付物缺口。
