# WorkHub Pilot 部署（十分钟，LAN 单机）

> 适用：S1 试运行（单机 LAN，1–10 人）。多租户/公网部署不在本文范围（见 `docs/workhub/06-roadmap/phasing-p0-p5.md` P5）。
> 架构：单镜像 = API daemon + Web 静态产物（同源，无 CORS 配置负担）+ PostgreSQL 16 + Redis 7。

## 0. 前置要求

- 一台 LAN 可达的机器（Linux/macOS，2C4G 起步够 pilot 用）
- Docker 24+（含 `docker compose` 插件）
- 本仓库代码（`git clone` 或解压）

## 1. 配置（约 2 分钟）

```bash
cp .env.pilot.example .env.pilot
# 必改两项：
#   COOKIE_SECRET=$(openssl rand -hex 32)
#   ADMIN_CLAIM_SECRET=<给管理员的口令>
$EDITOR .env.pilot
```

Cost 默认按 DeepSeek input/output `2/8` CNY per MTok 估算；如果 `.env.pilot` 显式设置 `PROVIDER_DEEPSEEK_COST_*`，会覆盖默认值。Pilot Gate 要求真实 AgentRun 在 `/dashboard/cost` 中显示非零成本。

## 2. 起栈（首次构建约 3–5 分钟）

```bash
docker compose --env-file .env.pilot -f docker-compose.pilot.yml up -d --build
# 看到 workhub 容器 healthy 即就绪：
docker compose --env-file .env.pilot -f docker-compose.pilot.yml ps
# 跟日志（JSON Lines）：
docker compose --env-file .env.pilot -f docker-compose.pilot.yml logs -f workhub
```

数据库迁移在容器启动时自动执行（`pnpm db:migrate`），无需手工步骤。`--env-file .env.pilot` 同时给容器环境与 compose 变量插值使用，确保 `POSTGRES_PASSWORD` / `WORKHUB_PORT` 与 `.env.pilot` 一致。

## 3. 首次使用

1. 浏览器打开 `http://<这台机器的IP>:8787/`，看到**注册屏**。
2. 管理员：填昵称 → 展开"我是管理员" → 填 `ADMIN_CLAIM_SECRET` → 进入。
3. 其他成员：直接填昵称进入（LAN 信任模式，无密码）。
4. 顶栏右侧可见当前用户与"退出"。

## 3.1 AI 工人的交付能力面

镜像预装（工人沙箱白名单库，R5.11.1）：`pandas / numpy / matplotlib / python-docx / openpyxl / python-pptx` + Noto CJK 字体。即 AI 工人可直接交付 **Word、Excel、PPT、统计图表（中文标签）、数据分析报告、可运行脚本**。工人内置七个预设技能（docx/xlsx/pptx/图表/分析/报告/脚本），涉及对应交付物时会先加载技能合同再动手，避免库 API 误用。沙箱仍禁网、禁装包。

> 注意：`run_command`（工人跑 python/node 产出上述交付物的能力）默认 **fail-closed（关）**——未隔离的命令执行器可访问宿主路径，因此不默认开启。LAN 单机试运行是受信环境，`.env.pilot.example` 已置 `AGENT_RUN_ALLOW_UNSANDBOXED_COMMANDS=true` 打开它；**多租户/公网部署务必保持 false**，并由部署方注入真正隔离的 runner（容器/namespace/firejail）。

## 3.2 没有大模型 key 时的行为

`LLM_API_KEY` 留空（或干脆不填 `.env.pilot` 里那行）时：

- 群聊、工单、审批、网盘、看板等**不依赖 AI 的功能照常可用**。
- 主区静默观察者（拎活）与回话判定器（该不该主动搭话）**都不会启动**——服务端只打一行
  `conversation_observer_disabled` / `conversation_reply_judge_disabled` 日志，不会反复重试打空转的 LLM 请求。
- 风险巡检（工单停滞/临期/成本异常）与 GitHub 轮询走确定性规则，**不依赖 LLM，照常运行**，与是否配置 key 无关。
- Web/桌面 composer 顶部会出现一条“AI 服务未配置”的横幅（读 `GET /api/health` 的 `ai_provider_configured`
  字段）。**这条横幅只是提示，不拦发送**——如果这时候用户仍然直接找 Cuu 说话（1:1 协同会话或 @Cuu），
  会同步收到一条明确的失败响应（“这一轮 Cuu 没接上，请再试一次”，HTTP 500），而不是卡死、超时或没反应。
  这是已知的、可接受的降级行为：错误是即时且可见的，不是静默假死。

填上 `LLM_API_KEY` 后 `docker compose ... up -d --build` 重建 `workhub` 容器即可点亮 AI 能力，无需额外步骤。

## 3.3 GitHub 集成（可选）

项目绑定 GitHub 仓库后，commit/PR/issue 动态会作为客观信号进入 Cuu 的项目感知。这项功能需要一个专门的加密主密钥：

```bash
# .env.pilot 加一行：
GITHUB_TOKEN_ENC_KEY=$(openssl rand -base64 32)
```

`GITHUB_TOKEN_ENC_KEY` 用 AES-256-GCM 加密落库的项目级 GitHub PAT，**故意与 `COOKIE_SECRET` 分离**——两者
威胁模型和轮换节奏不同（会话伪造 vs 解密全部项目的 GitHub 令牌）。留空时绑定端点直接 fail-closed 返回
503，绝不会把令牌明文落库；GitHub 轮询 worker 照常启动但每轮拉取零结果，只在首次打一行 warn 日志。

## 4. 备份与恢复

```bash
# 备份（默认写 ../workhub-backups/，保留 14 份；建议加进 cron）
bash scripts/ops/backup-pg.sh

# 恢复到当前栈（会覆盖现库，先确认！）
gunzip -c ../workhub-backups/workhub-<时间戳>.sql.gz | \
  docker compose --env-file .env.pilot -f docker-compose.pilot.yml exec -T postgres psql -U workhub -d workhub

# 恢复 dry check：用独立 compose project，避免覆盖当前 pilot 数据。
docker compose --env-file .env.pilot -p workhub_restore -f docker-compose.pilot.yml up -d postgres
gunzip -c ../workhub-backups/workhub-<时间戳>.sql.gz | \
  docker compose --env-file .env.pilot -p workhub_restore -f docker-compose.pilot.yml exec -T postgres psql -U workhub -d workhub
docker compose --env-file .env.pilot -p workhub_restore -f docker-compose.pilot.yml down -v
```

## 5. 升级

```bash
git pull
docker compose --env-file .env.pilot -f docker-compose.pilot.yml up -d --build   # 迁移随启动自动跑
```

## 6. 故障排查

| 症状 | 排查 |
|---|---|
| 页面打不开 | `docker compose --env-file .env.pilot -f docker-compose.pilot.yml ps` 看 workhub 是否 healthy；`logs workhub` 找 `server_started` 事件 |
| 一直停在注册屏提交失败 | 日志找 `http_request` 中 `/api/auth/identify` 的 status；403 = 管理员口令不对 |
| 起不来且日志含 migrate 错误 | 确认 postgres healthy 后 `docker compose --env-file .env.pilot -f docker-compose.pilot.yml restart workhub` |
| 想清库重来 | `docker compose --env-file .env.pilot -f docker-compose.pilot.yml down -v`（**删除全部数据**，慎用） |
| AI 工人不可用 | `.env.pilot` 填 `LLM_API_KEY` 后 `up -d` 重建；无 key 时其余功能（注册/事项/审批/看板）不受影响 |

## 7. 单实例假设（重要，横向扩容前必读）

**本部署包只支持单个 `workhub` 容器/进程。** `docker-compose.pilot.yml` 起一个 `workhub` 服务副本，这不是
偶然——以下几个子系统的关键状态活在**进程内存**里，起第二个副本（或在负载均衡器后面水平扩容）会导致
静默的正确性问题（重复触发、竞态、状态丢失），而不是报错拒绝：

| 子系统 | 内存状态 | 多副本下会发生什么 |
|---|---|---|
| 回复互斥闸（同一会话不许并发出两轮 Cuu 回应） | `conversation-turns.ts` 里一个进程内 `Set`，按会话 id 加锁 | 闸门只挡得住同一个进程内的并发请求；两个副本各自能放行一条，同一会话可能同时跑出两轮回应 |
| 回话判定去重（判定器/@Cuu 直通两条路径都不重复触发同一条消息） | `conversation-reply-judge.ts` 里一个进程内 `Map`（会话→已判定到的最后消息 id） | 每个副本各记各的水位线；最坏情况是同一条触发消息被两个副本各判一次，重复触发（不是丢失） |
| 军团/task-plan 执行队列（当前在跑哪个 run、它的沙箱工作目录、中断句柄） | `agent-runner.ts` 的 `createInMemoryAgentRunQueue`——`Map`/`Set` 记录运行中 run、workdir、abort controller | 每个副本各自认领、各自调度；task-plan 记录本身在 PostgreSQL 里是安全的，但"谁正在真正执行、能不能中断它"这件事跨副本不同步 |

`WORKER_COUNT`（单进程内的 worker 池大小）与 `BROKER_BACKEND=redis` 已有配置层面的 fail-closed 守卫
（`packages/config/src/env.ts` `validateRuntimeConfig`：生产环境下 `WORKER_COUNT>1` 配 `BROKER_BACKEND=memory`
直接拒绝启动）——但这道守卫管的是**单个容器进程内**要不要开多个 worker，跟这里说的**起几个容器/几个副本**
是两个维度，配对了 Redis 也不代表可以水平扩容。**如果你的部署需要处理超过单机承载的负载，先把上表三个
子系统迁到共享存储（Postgres/Redis）再谈多副本；本仓库目前没有做这件事，这是已知、记录在案的限制，不是
一个可以靠调参绕开的开关。** 垂直扩容（给这台机器更多 CPU/内存,`WORKER_COUNT` 配合 `BROKER_BACKEND=redis`
调大进程内 worker 数)是当前唯一受支持的扩容路径。

## 8. 安全口径（必读）

Pilot 栈默认 `APP_ENV=development` —— 对应规格树的 **LAN-first 信任模型**（D-3）：同网即信任、昵称报到、无密码、cookie 走 http。这是给可信局域网内 1–10 人试运行的口径。

**如果要暴露到公网/HTTPS**：设 `APP_ENV=production`，此时配置守卫会强制要求强 `COOKIE_SECRET`、`COOKIE_SECURE=true`（需 HTTPS）、收紧 `CORS_ALLOW_ORIGINS`（不许 `*`）——任何一项不满足进程直接拒绝启动（fail-closed）。完整威胁模型重审清单见 `docs/workhub/01-architecture/security-and-permissions.md` §1.3。

## 9. 日志口径

容器 stdout 输出 JSON Lines（`LOG_FORMAT=json`）：`server_started`、`http_request`（method/path/status/duration_ms/actor）、`unhandled_error`、`server_stopping`。接采集器直接喂；人工排查可临时设 `LOG_FORMAT=pretty`。

---

*CI 中的 `pilot-stack-smoke` job 对本部署包做真实验证：构建镜像 → 起全栈 → 迁移 → 健康检查 → 注册屏 → 注册 → 鉴权页面。文档与编排若 drift，CI 会先红。*
