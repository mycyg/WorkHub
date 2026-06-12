---
module: R5-pilot-deploy-package
layer: 部署 / CI / API / 可观测
status: completed
owner: workflow
date: 2026-06-12
depends_on:
  - s1-pilot-readiness-roadmap-2026-06-12.md
  - ../01-architecture/system-architecture.md
  - ../01-architecture/tech-stack-and-migration.md
---

# R5.11 Pilot 部署包 Plan（S1 第三刀，消除 G3）

## 1. 背景

S1 roadmap G3：部署包不存在——`docker-compose.yml` 只有 PG/Redis，无 API/Web 服务编排、无 .env 模板、无 TS 栈 DEPLOY 文档、无结构化日志。pilot 团队（LAN 单机）需要"十分钟从零到能用"。

现状核查（2026-06-12）：`apps/api` 的 `start` 已走 tsx（无需独立编译产物）；`@hono/node-server` 自带 `serveStatic`；web 构建产物 `apps/web/dist`；`API_HOST`/`PORT` env 已在 config。

## 2. 目标

| # | 必须完成 | 边界 |
|---|---|---|
| P1 | **单源静态服务**：API 进程在设置 `WEB_DIST_DIR` 时直接服务 Web 构建产物（serveStatic + SPA fallback：非 `/api`/`/openapi` 路径回 index.html）。Web 与 API 同源——无 CORS、SSE 同源、cookie 直通 | 不引 nginx；dev 模式（Vite 代理）不受影响 |
| P2 | **结构化日志（中期审查 P2-4 第一段）**：零依赖 JSON Lines logger——请求日志（method/path/status/duration_ms/actor）、未处理错误、启动/关停事件；`LOG_FORMAT=json|pretty`（默认 json） | 不引 pino/APM；不做日志轮转（交给 docker） |
| P3 | **镜像与编排**：多阶段 `Dockerfile`（pnpm 装依赖 → 构建 web dist → 运行期 tsx 起 API+静态）；`docker-compose.pilot.yml`：postgres + redis + workhub（先跑 `db:migrate` 再起服务），健康检查 + named volumes + `env_file` | 不动现有开发用 `docker-compose.yml` |
| P4 | **`.env.pilot.example`**：全部必填/可选项带中文注释（COOKIE_SECRET、ADMIN_CLAIM_SECRET、LLM_API_KEY 占位、broker、预算默认值） | — |
| P5 | **备份**：`scripts/ops/backup-pg.sh`（docker exec pg_dump，按日期命名，保留 N 份）+ 恢复说明 | 不做定时调度（文档给 cron 一行示例） |
| P6 | **`DEPLOY.md`**（仓库根）：十分钟部署文档——前置要求、三步起栈、首个管理员注册、备份/恢复、升级、故障排查 | LAN-first；云/多租户不在范围（P5 不变） |
| P7 | **CI 真实部署门 `pilot-stack-smoke`**：GitHub Actions 构建镜像 → compose up 全栈 → 迁移完成 → `/api/health` 200 → `GET /` 返回注册屏 HTML → identify → 鉴权后 attention page 200。**本机无 docker，CI 是该包的权威验证**（与 R5.8 smoke 同理） | 失败上传容器日志 artifact |

## 3. QA Gate

- 本机（无 docker 可验部分）：`pnpm --filter @workhub/web build` 产物存在；本地 node 起 API + `WEB_DIST_DIR` → `curl /` 得注册屏、`/api/health` 200、SPA fallback 路由 200；JSON 日志行可解析；backup 脚本 `bash -n` 语法检查；
- `pnpm typecheck`、`pnpm test`、`pnpm lint`、browser smoke 70 步回归、release gate；
- CI：`pilot-stack-smoke` job 首跑绿（P7 即验收）。

## 4. 竣工记录

状态：✅ completed（2026-06-12）

落地范围（P1–P7 全部完成）：

- **P1 单源静态服务**：`apps/api/src/app.ts` `attachWebStatic()`——SPA fallback、路径穿越防护（distRoot+sep 前缀校验）、按扩展名 MIME；根路径在挂载 dist 后服务注册屏、未挂载保留 API banner。
- **P2 结构化日志**：`apps/api/src/logging.ts` 零依赖 JSON Lines（`http_request` method/path/status/duration_ms/actor、`unhandled_error`、`server_started`/`server_stopping`、`web_static_attached`），`LOG_FORMAT=json|pretty`。
- **P3–P6**：单镜像 `Dockerfile`（.dockerignore 挡 reference/client-tauri 共 11G 上下文）、`docker-compose.pilot.yml`（PG+Redis+workhub，启动自动迁移+三层健康检查）、`.env.pilot.example`（中文注释模板）、`scripts/ops/backup-pg.sh`（日期命名+保留轮转）、根目录 `DEPLOY.md`（含"安全口径"专节：pilot=development/LAN 信任模型，production 守卫 fail-closed 不放松）。
- **P7 CI 部署门**：`pilot-stack-smoke` job——构建镜像→起全栈→容器 healthy→health/注册屏 SPA/deep link/admin 认领/鉴权 Page VM/未鉴权 fail-closed 七段断言，失败上传容器日志 artifact。

**部署门三跑抓出三个真问题**（每个都会让 pilot 当天卡死，本机验证全部漏掉）：

1. `.env.pilot.example` 被 `.gitignore` 的 `.env.*` 规则静默吞掉（模板根本不在仓库里）→ 白名单修复；
2. 部署形态下 `/` 返回 API banner 而非注册屏（Hono 按注册序匹配，banner 先于 SPA catch-all）→ 根路由感知 web dist + 真实 app 回归测试（并发现 Hono 路由器首请求后冻结的约束）；
3. **admin 无法自举**：`admin_secret` 此前只守卫"已是 admin 的昵称登录"，系统不存在产生第一个管理员的路径，而注册屏/DEPLOY 已承诺认领语义 → 注册时口令匹配 `ADMIN_CLAIM_SECRET` 即提权；**口令错误 403 fail-closed**（修订 R5.9 计划中"错误口令静默降级"的原口径——显式声称管理员必须验证通过）。

辅助加固：两个 smoke job 增加 `timeout-minutes`（一次 runner flake 曾挂死 16 分钟）。

验收证据：

- CI run `27422701783`（commit `06bf56b6`）七 job 全绿；`pilot-stack-smoke` 端到端约 1 分 40 秒（含镜像构建）。
- 本机：API+`WEB_DIST_DIR` 实跑（`/` 注册屏、deep link、资产 MIME、JSON 日志逐行可解析）；api 套件 134 pass（新增 web-static×4、admin claim×3）；全包 typecheck/test 绿；release gate PASS。

## 5. Handoff

R5.11 后进入 R5.12 权限矩阵审计（多用户同实例前的安全收口）；R5.10 真 key 验证待 `LLM_API_KEY`（用户暂缓，已记录）。部署包就绪 + 权限审计完成 = pilot-ready，人到位即可启动 S1 Pilot Week。
