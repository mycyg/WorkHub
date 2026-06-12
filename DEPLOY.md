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

## 2. 起栈（首次构建约 3–5 分钟）

```bash
docker compose -f docker-compose.pilot.yml up -d --build
# 看到 workhub 容器 healthy 即就绪：
docker compose -f docker-compose.pilot.yml ps
# 跟日志（JSON Lines）：
docker compose -f docker-compose.pilot.yml logs -f workhub
```

数据库迁移在容器启动时自动执行（`pnpm db:migrate`），无需手工步骤。

## 3. 首次使用

1. 浏览器打开 `http://<这台机器的IP>:8787/`，看到**注册屏**。
2. 管理员：填昵称 → 展开"我是管理员" → 填 `ADMIN_CLAIM_SECRET` → 进入。
3. 其他成员：直接填昵称进入（LAN 信任模式，无密码）。
4. 顶栏右侧可见当前用户与"退出"。

## 3.1 AI 工人的交付能力面

镜像预装（工人沙箱白名单库，R5.11.1）：`pandas / numpy / matplotlib / python-docx / openpyxl / python-pptx` + Noto CJK 字体。即 AI 工人可直接交付 **Word、Excel、PPT、统计图表（中文标签）、数据分析报告、可运行脚本**。工人内置七个预设技能（docx/xlsx/pptx/图表/分析/报告/脚本），涉及对应交付物时会先加载技能合同再动手，避免库 API 误用。沙箱仍禁网、禁装包。

## 4. 备份与恢复

```bash
# 备份（默认写 ./backups/，保留 14 份；建议加进 cron）
bash scripts/ops/backup-pg.sh

# 恢复（目标栈须先起好；会覆盖现库，先确认！）
gunzip -c backups/workhub-<时间戳>.sql.gz | \
  docker compose -f docker-compose.pilot.yml exec -T postgres psql -U workhub -d workhub
```

## 5. 升级

```bash
git pull
docker compose -f docker-compose.pilot.yml up -d --build   # 迁移随启动自动跑
```

## 6. 故障排查

| 症状 | 排查 |
|---|---|
| 页面打不开 | `docker compose -f docker-compose.pilot.yml ps` 看 workhub 是否 healthy；`logs workhub` 找 `server_started` 事件 |
| 一直停在注册屏提交失败 | 日志找 `http_request` 中 `/api/auth/identify` 的 status；403 = 管理员口令不对 |
| 起不来且日志含 migrate 错误 | 确认 postgres healthy 后 `docker compose -f docker-compose.pilot.yml restart workhub` |
| 想清库重来 | `docker compose -f docker-compose.pilot.yml down -v`（**删除全部数据**，慎用） |
| AI 工人不可用 | `.env.pilot` 填 `LLM_API_KEY` 后 `up -d` 重建；无 key 时其余功能（注册/事项/审批/看板）不受影响 |

## 7. 安全口径（必读）

Pilot 栈默认 `APP_ENV=development` —— 对应规格树的 **LAN-first 信任模型**（D-3）：同网即信任、昵称报到、无密码、cookie 走 http。这是给可信局域网内 1–10 人试运行的口径。

**如果要暴露到公网/HTTPS**：设 `APP_ENV=production`，此时配置守卫会强制要求强 `COOKIE_SECRET`、`COOKIE_SECURE=true`（需 HTTPS）、收紧 `CORS_ALLOW_ORIGINS`（不许 `*`）——任何一项不满足进程直接拒绝启动（fail-closed）。完整威胁模型重审清单见 `docs/workhub/01-architecture/security-and-permissions.md` §1.3。

## 8. 日志口径

容器 stdout 输出 JSON Lines（`LOG_FORMAT=json`）：`server_started`、`http_request`（method/path/status/duration_ms/actor）、`unhandled_error`、`server_stopping`。接采集器直接喂；人工排查可临时设 `LOG_FORMAT=pretty`。

---

*CI 中的 `pilot-stack-smoke` job 对本部署包做真实验证：构建镜像 → 起全栈 → 迁移 → 健康检查 → 注册屏 → 注册 → 鉴权页面。文档与编排若 drift，CI 会先红。*
