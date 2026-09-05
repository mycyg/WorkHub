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
- 风险巡检（工单停滞/临期/成本异常/绑定仓库长期没有新提交）与 GitHub 轮询走确定性规则，**不依赖 LLM，照常运行**，与是否配置 key 无关。
- 团队技能夜间自学（§3.4）**不会启动**——服务端只打一行 `skill_curation_disabled` 日志（`reason` 写明是没配密钥还是被开关关掉），不会每夜白跑一遍再被打回。
- Web 端任意页面顶部、桌面聊天输入区顶部都会出现一条”AI 服务未配置”的横幅（读 `GET /api/health` 的
  `ai_provider_configured` 字段——与设置页显示的密钥状态同一来源）。**这条横幅只是提示，不拦发送**——
  如果这时候用户仍然直接找 Cuu 说话（1:1 协同会话或 @Cuu），
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

绑定之后，每日风险巡检会多出一条信号：**这个项目绑了仓库，但已经很久没有新提交**。「很久」的天数由
`GITHUB_STALE_DAYS` 决定（1–90，默认 7），是部署级设置，不逐项目配置。刚绑上的仓库、以及一次都还没
成功同步过的绑定，都不会被算进这条信号——那种时候我们其实并不知道仓库动没动。

## 3.4 团队技能夜间自学（默认开启）

运行队列闲下来时，AI 会回看已完成的工作（包括成员点过的差评），把可复用的做法蒸馏成团队技能，
成员在「团队技能」页就能看到攒下了什么。这条链路默认开启：

```bash
# .env.pilot 里想关掉时才需要这一行：
AGENT_RUN_SKILL_CURATION_ENABLED=false
# 两轮之间的间隔（毫秒），默认一天：
# AGENT_RUN_SKILL_CURATION_INTERVAL_MS=86400000
```

三重约束保证它不会烧钱或空转：没配 `LLM_API_KEY` 时根本不启动；只在运行队列空闲时才开跑；每轮仍受
当日蒸馏花费上限（`BUDGET_DEFAULT_CURATION_DAILY_COST_CNY`）约束，超额整轮跳过。

管理员不想等今晚的，可以在「团队技能」页点「立即自学一轮」（`POST /api/team-skills/curate-now`）——
非管理员没有这个按钮且调用会被拒；已经在跑时会明确告知「正在进行」，不会并发起第二轮。

## 3.5 把服务器地址给客户端

桌面客户端（见 README「下载桌面客户端」）默认连**本机** `http://127.0.0.1:8787`。只有客户端和服务器
在同一台机器上时这个默认值才对；团队里其他人的电脑上必须改成服务器地址。

**改法（每台客户端各做一次）**：客户端连不上时会弹出一张连接失败卡片——点「打开设置」，在「服务器
地址」里填 `http://<服务器IP>:8787`（或你的域名），点「保存并重试」。地址会记在这台机器上，下次启动
自动使用。

**地址写法要求**：必须是完整的 http/https 绝对地址，不能带用户名密码、查询串或 `#` 片段（末尾斜杠
会被自动去掉）。填错时保存会被拒绝，不会把脏值带进请求。

**桌面端的鉴权与 Web 端不同**：客户端与服务器不同源，拿不到浏览器 cookie，所以首次连接会走
`POST /api/auth/desktop-bootstrap` 换一枚设备令牌存在本机，之后每个请求带 `X-YQGL-Client-Token` 头。

**CORS 必须放行桌面端的来源，否则连了也白连**：服务端的 CORS 中间件（`apps/api/src/app.ts`
第 185-193 行左右，`corsAllowOrigins` / `isDevReflectableOrigin` / `app.use("/api/*", cors({...}))`
那一段）只有在 `CORS_ALLOW_ORIGINS=*`（通配/开发默认）时才会**自动**反射本机回环与桌面 `tauri`
来源；`.env.pilot.example` 默认就是 `*`，LAN 单机试运行不用改这里。但生产环境（`APP_ENV=production`）
**禁止 `CORS_ALLOW_ORIGINS` 包含 `*`**（fail-closed 配置守卫，见 `packages/config/src/env.ts` 第
442-445 行左右），此时 `corsAllowOrigins` 会被当成**精确白名单**直接使用，不再有任何自动反射——
桌面客户端的来源必须**显式**写进这份白名单，否则预检请求（preflight）直接被拒，客户端所有写请求
和 SSE 订阅都连不上，且报错信息只会是笼统的网络错误，不会指向 CORS。

桌面端的来源在不同系统上的字符串不一样（Tauri 2 各平台的 webview 起源不同）：

```bash
# .env.pilot 生产模式下需要显式列出（逗号分隔，与你自己的 web 来源写在一起）：
CORS_ALLOW_ORIGINS=https://your-domain.example,tauri://localhost,http://tauri.localhost
```

- `tauri://localhost` —— macOS（以及 Linux）桌面客户端的来源，自定义协议，永远不带端口。
- `http://tauri.localhost` —— Windows 桌面客户端的来源（Windows 上 WebView2 不支持自定义协议
  当顶层来源，Tauri 退化成这个伪 http 域名）。

两条都写上就对了，不需要按用户实际用的操作系统挑一条——多写不产生任何风险（这两个值都不是可路由的
公网地址，谁都伪造不出"从这个来源发起的浏览器请求"）。

**注意（当前版本的限制）**：打包后的客户端出于安全收敛，网络层还有第二道闸——`client-tauri/src-tauri/tauri.conf.json`
的 CSP `connect-src` 只放行本机回环——**远端服务器地址就算填了、CORS 也放行了，打包后的 webview 仍然连不出去**。
要让客户端连远端服务器，还需要放宽这条 CSP（属于另一条改动线，不在本节范围）。在那之前，桌面客户端
只支持"客户端与服务器同机"的用法；本节讲的 CORS 配置是让"服务器已经放宽 CSP 之后"能正常工作的必要
前提，现在配置好不吃亏。

**运维侧要配合的事**：
- 服务器要监听 `0.0.0.0`（pilot 的 compose 编排已经是），防火墙放行 8787；
- 暴露到公网时按 §8 切 `APP_ENV=production` + HTTPS + `AUTH_MODE=password`，此时客户端地址填
  `https://...`，客户端登录屏也会自动切成邮箱 + 密码。

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
| 会话消息 outbox 派发（`event_outbox` 每 30s drain 一轮） | `apps/api/src/services/event-outbox.ts` 的进程内 in-flight 闸——`listPending` 是普通 SELECT，无 `FOR UPDATE SKIP LOCKED`/租约 | 两个副本会各自捞到同一批 pending 行、对同一事件各 publish 一次；消费端按消息 id 去重 + 按 seq 排序，用户不会看到重复消息，但 SSE 推送量翻倍、发布统计失真。上多副本前要给 drain 加跨实例领取（行租约或 SKIP LOCKED） |

（对照项：主动性 intent 的投递/恢复扫描曾同属此类，R21 起已改为 PostgreSQL 层原子领取——`claimProactiveIntentForDelivery` 把行从 created 顶到 delivering 才许投递——多副本下天然安全，无需列入上表。）

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

**`AUTH_MODE` 在生产环境必须是 `password` 或 `hybrid`，不能是 `nickname`**（同一处 fail-closed 守卫，进程直接拒绝启动）——昵称模式没有口令/会话边界，cookie 即身份，不适合暴露到公网。设置：

```bash
# .env.pilot 加一行（或直接设为容器环境变量）：
AUTH_MODE=password
```

这两种模式下 web 和桌面端都改走邮箱 + 密码登录（`POST /api/auth/login`）；`/`（web）首次打开会自动探测到这个模式并渲染邮箱/密码表单，不再是昵称报到屏。**首个管理员怎么来**：这两种模式下没有"填昵称 + 勾选管理员 + 填 `ADMIN_CLAIM_SECRET`"这条路——改成在登录屏切到"注册"标签页，用邮箱 + 昵称 + 密码创建账号（`POST /api/auth/register`）；只要这个实例当前还没有任何管理员，**第一个完成注册的账号会被服务端自动提为管理员**，不需要额外操作。之后再注册的账号都是普通成员，管理员身份只能后续在设置页的成员管理里手动授予。

注意：配置守卫仍然要求 `ADMIN_CLAIM_SECRET` 在生产环境非空且 ≥16 位（这道检查不区分 `AUTH_MODE`），但这个值只在昵称模式的认领流程里会被读取——`password`/`hybrid` 模式下随便生成一个满足长度要求的随机串占位即可（`openssl rand -hex 16`），它不会被用到、也不会影响上面这条"第一个注册者自动成为管理员"的流程。

## 9. 日志口径

容器 stdout 输出 JSON Lines（`LOG_FORMAT=json`）：`server_started`、`http_request`（method/path/status/duration_ms/actor）、`unhandled_error`、`server_stopping`。接采集器直接喂；人工排查可临时设 `LOG_FORMAT=pretty`。

---

*CI 中的 `pilot-stack-smoke` job 对本部署包做真实验证：构建镜像 → 起全栈 → 迁移 → 健康检查 → 注册屏 → 注册 → 鉴权页面。文档与编排若 drift，CI 会先红。*
