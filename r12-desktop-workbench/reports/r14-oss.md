# R14 批 OSS · 开源门面与卫生 · 完成汇报

> 分支：`r14/oss`（worktree `/Users/apple/.codex/worktrees/WorkHub/r14-oss`）
> 施工说明书：`r14-release-readiness/00-plan.md` §2 批 OSS
> 范围围栏：只动 `README*`、`CONTRIBUTING*`、`.env.example`/`.env.pilot.example`、`DEPLOY.md`、`docs/workhub/**`；未碰任何源代码/测试/迁移。

## 1. 做了什么

1. **README 重写为开源门面**（`README.md` 中文主 + `README.en.md` 英文，互链）：
   - 产品一句话改为「项目群聊 + AI 项目经理 Cuu：观察讨论 → 拎活派活 → 干完活人审批」，对齐 R12/R14 已落地的群聊主区产品形态（旧版一句话仍是 R6 时代「业务版 GitHub」的抽象框架，未提群聊）。
   - 快速自托管三步走：配置 `.env.pilot`（`COOKIE_SECRET`/`ADMIN_CLAIM_SECRET`）→ `docker compose ... up -d --build`（自动构建+自动迁移）→ 打开浏览器走 identify 登录。
   - 功能亮点六条（群聊完整度/全局搜索/记忆治理/反馈闭环/风险巡检/GitHub 集成）——逐条核对 `git log --oneline --merges` 与对应 `r12-desktop-workbench/reports/r14-{chat,search,mem,feedback,risk,gh}-*.md` 交付报告后才写，全部已合入本分支基线，不是路线图承诺。
   - 架构一图流：`apps/`、`client-tauri/`、`packages/` 逐目录一句话（文字版 monorepo 地图）。
   - 保留 LICENSE 说明（PolyForm NC = 可自用不可商用）、核心闭环 mermaid 图（沿用旧版，路径引用仍准确）。
   - 全文去 emoji（旧版有 🗺️✅📊🟡⏸️⚖️📐📋🧭💡📩⛔ 等十余处），改用纯文字/表格。
   - 补了一处此前不准确的说法：草稿中一度写「无 key 不会有静默假死或 500」，经子 agent 复核 `conversation-turns.ts` 后发现**直接找 Cuu 说话（1:1/@Cuu）在无 key 时确实会拿到同步 500**（`this轮 Cuu 没接上，请再试一次`），只是不会挂起/无响应；已改写为如实描述（横幅是提示性的，不拦发送；错误是即时可见的，不是静默死）。
2. **CONTRIBUTING.md**（新文件，英文）：开发环境（Node≥22/pnpm 11/docker PG+Redis）、测试跑法（Node 内置 test runner via tsx，非 vitest/jest；`pnpm -r typecheck` 在改测试后必跑）、迁移纪律（`0031` 起 `ADD COLUMN IF NOT EXISTS`/`CREATE INDEX IF NOT EXISTS`，运行时代码禁 schema mutation，`scripts/dev/check-migrations.ts` 机械把关）、范围与提交纪律（禁 `git add -A`/禁伪测试/禁假接线/limit+分页/uuid 守卫+SQL 内鉴权）、无 emoji 纪律（reaction 是唯一破例）、中文 UI 文案 + 去黑话约定、并行批次施工模式简介（引用 `r12-desktop-workbench/04-codex-execution-guide.md` 作范例）。
3. **`.env.example` 全量核对**：逐项比对 `packages/config/src/env.ts` 的 55 个 zod 字段，补齐此前缺失的 21 项（见下方差异表），每项一行注释；新增 `MAX_REQUEST_BODY_BYTES`（app.ts 直读、不在 zod schema 内，作为已注释的可选项列出）。用脚本把新文件解析为 KV 并跑 `envSchema.safeParse` 验证——全部字段类型合法，仅 `PROVIDER_DEEPSEEK_MODEL`（可选、默认回退 `LLM_MODEL`）故意留空未激活。**绝无真值**，全部是安全的默认值/占位符。
4. **docker-compose 自托管指南**：选择「升级现有部署文档」而非新增 `docs/workhub/` 文件（理由见 §3 偏离说明）——升级根目录 `DEPLOY.md`：
   - 新增 §3.2「没有大模型 key 时的行为」：如实写清哪些子系统不启动（观察者/判定器）、哪些无关（风险巡检/GitHub 轮询走确定性规则）、composer 横幅是提示性不拦发送、直接找 Cuu 说话会同步收到 500 而非卡死。
   - 新增 §3.3「GitHub 集成（可选）」：`GITHUB_TOKEN_ENC_KEY=$(openssl rand -base64 32)` 生成方法 + 为什么与 `COOKIE_SECRET` 分离 + 留空时的 fail-closed 行为。
   - 新增 §7「单实例假设（重要，横向扩容前必读）」：回复互斥闸/回话判定去重/军团执行队列三个子系统的进程内存状态表（子 agent 逐一核实 file:line 后写入，见 §2 证据）、`WORKER_COUNT`/`BROKER_BACKEND` 现有守卫管的是哪个维度（进程内 worker 池，不是跨容器副本）、当前唯一受支持的扩容路径是垂直扩容。
   - 原 §7/§8（安全口径/日志口径）顺延为 §8/§9。
   - 同步给 `.env.pilot.example` 补一段 `GITHUB_TOKEN_ENC_KEY`（注释、留空默认关闭），与 DEPLOY.md 新增节呼应。
5. **gitleaks 熵检测补扫**：见 §4。

## 2. 关键事实核实（两个子 agent 独立复核，避免 README/DEPLOY.md 写错）

- **单实例假设三处状态**（`Explore` 子 agent 复核）：
  - 回复互斥闸：`apps/api/src/services/conversation-turns.ts:743` `const activeTurns = new Set<string>()`，进程内闭包，代码自带注释承认「多进程部署下这不是完整闸」。
  - 回话判定去重：`apps/api/src/services/conversation-reply-judge.ts:121` `const lastJudgedByConversation = new Map<string, string>()`，头部注释与上面同归为一类已知缺口。
  - 军团/task-plan 执行队列：`apps/api/src/workers/agent-runner.ts` 的 `createInMemoryAgentRunQueue`（约 507 行起）——`runs`/`runWorkdirs`/`runAbortControllers`/`startingWorkItems` 等均为进程内 `Map`/`Set`；task-plan **记录本身**在 Postgres 是安全的，但「谁在真正执行、能不能中断」跨副本不同步。
  - 现有守卫核实：`packages/config/src/env.ts` 只挡 `WORKER_COUNT>1` 配 `BROKER_BACKEND=memory`（进程内 worker 池维度），没有任何代码挡「起第二个容器副本」（横向扩容维度）——DEPLOY.md 新增节据此把两个维度分开讲清楚。
- **无 key 时 turn 请求的真实行为**（第二个 `Explore` 子 agent 复核）：`createTurn` 无 `isConfigured()` 前置门，实际是走到 `client.messages.stream(...)` 真打 HTTP 才因空 `x-api-key` 被上游拒绝，`catch` 成同步 `500 conversation_turn_failed`（中文提示「这一轮 Cuu 没接上，请再试一次」）。`r14-guidance-cluster` 批（FIX#8）交付的只是前端 composer 横幅（读 `/api/health` 的 `ai_provider_configured`），横幅不拦发送，后端这条路径本身未改。README/DEPLOY.md 已按这个真实行为措辞，不是理想化描述。

## 3. `.env.example` 差异表（补齐的 21 项）

| Key | 默认值 | 说明来源 |
|---|---|---|
| `LOG_FORMAT` | `json` | `env.ts:41` |
| `AUTH_MODE` | `nickname` | `env.ts:72` |
| `SESSION_ABSOLUTE_TTL_HOURS` | `720` | `env.ts:73` + `auth.ts:10`（30 天） |
| `SESSION_IDLE_TTL_HOURS` | `168` | `env.ts:74` + `auth.ts:11`（7 天） |
| `LLM_MAX_TOKENS_PER_STEP` | `8192` | `env.ts:83` |
| `PROVIDER_DEEPSEEK_MODEL` | （注释示例，回退 `LLM_MODEL`） | `env.ts:86` |
| `BUDGET_DEFAULT_EVAL_DAILY_TOKENS` | `2000000` | `env.ts:95` |
| `BUDGET_DEFAULT_TASK_PLAN_COST_CNY` | `10` | `env.ts:98` |
| `BUDGET_DEFAULT_EVAL_DAILY_COST_CNY` | `80` | `env.ts:102` |
| `BUDGET_DEFAULT_CURATION_DAILY_COST_CNY` | `40` | `env.ts:104` |
| `AGENT_RUN_LEASE_MS` | `300000` | `env.ts:106` |
| `AGENT_RUN_HEARTBEAT_INTERVAL_MS` | `0` | `env.ts:107` |
| `AGENT_RUN_RECOVERY_INTERVAL_MS` | `30000` | `env.ts:108` |
| `AGENT_RUN_MAX_RECOVER_ATTEMPTS` | `3` | `env.ts:110` |
| `AGENT_RUN_ALLOW_UNSANDBOXED_COMMANDS` | `false` | `env.ts:114` |
| `AGENT_RUN_SKILL_CURATION_ENABLED` | `false` | `env.ts:115` |
| `AGENT_RUN_SKILL_CURATION_INTERVAL_MS` | `86400000` | `env.ts:116` |
| `AGENT_RUN_PROJECT_HYDRATE_ENABLED` | `true` | `env.ts:117` |
| `AGENT_RUN_PROJECT_HYDRATE_MAX_FILES` | `200` | `env.ts:118` |
| `AGENT_RUN_PROJECT_HYDRATE_MAX_BYTES` | `33554432` | `env.ts:119` |
| `MAX_REQUEST_BODY_BYTES`（注释可选） | `1048576` | `apps/api/src/app.ts:97-104`，直读 `process.env`，不在 zod schema 内 |

`GITHUB_TOKEN_ENC_KEY` 在本批开工前已由 R14 GH 批（`ef83dbeb`）补上，本批未改动其内容，只在 `.env.pilot.example` 与 `DEPLOY.md` 侧补了对应引用。

## 4. gitleaks 熵检测补扫结果

**本机没有 `gitleaks`**（`which gitleaks` 无输出，也没有 `brew`/`trufflehog`/`detect-secrets`）。按施工说明书的兜底指示，未从网络下载安装未知来源的二进制（这类操作在我的操作准则里是被禁止的：不下载/执行不可信来源的可执行文件），改用 **`git log -p --all` 全历史（1527 commit / 111 分支，排除 `pnpm-lock.yaml`）+ 自写 Python 脚本做已知前缀匹配 + Shannon 熵检测**：

- 已知高置信度前缀（`sk-`/`AKIA`/`ghp_`/`gho_`/`github_pat_`/`glpat-`/`xox[baprs]-`/`AIza`/`Bearer <token>`/PEM 私钥头/`postgresql://user:pass@`）：全历史命中 **179 处**，逐条核实全部是：
  - 测试夹具里的假 token（`ghp_1234567890abcdef1234`、`ghp_shouldneverappearhere1234`、`ghp_0123456789abcdefghij` 等，明显占位模式）；
  - UI/常量字符串恰好以 `sk-` 开头（`sk-plan-awaiting-approval`、`sk-cost-ratio-input` 等 skill/plan id，非 API key——这正是 `r2-release-gate-report.ts` 注释里已知的“sk- 子串误报”类别）；
  - 本地开发默认连接串 `postgresql://workhub:workhub@...`（密码就是字面量 `workhub`，仓库内到处出现，不是秘密）；
  - `.github/workflows/verify.yml` 里那道「Secret scan for committed private keys（advisory）」CI job 自己的 grep 匹配模式（`-e "-----BEGIN RSA PRIVATE KEY-----"` 等 5 行），不是真私钥。
- 高熵值 + 赋值语境（`KEY=`/`SECRET=`/`TOKEN=`/`PASSWORD=` 等紧邻一个高熵字符串）：全历史命中 **4 处**，逐条核实：
  - 2 处是同一条 GitHub PAT 测试夹具（`ghp_1234567890abcdef1234` / `ghp_0123456789abcdefghij`）；
  - 1 处是 `packages/config/src/env.test.ts` 里 `GITHUB_TOKEN_ENC_KEY` 32 字节校验的测试值 `MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=`——base64 解码是 `0123456789abcdef0123456789abcdef`，明显是顺序数字拼的假值，不是真随机密钥；
  - 1 处是正则本身的误报（匹配到 `tokenEncKey: parsed.GITHUB_TOKEN_ENC_KEY` 这行代码，值其实是变量引用不是字符串字面量）。
- **结论：全历史深扫未发现真实密钥。**
- **局限如实说明**：脚本还跑了一版「裸高熵 token（不要求出现在赋值语境里）」，全历史命中 14640 处——人工抽查后发现绝大多数是 camelCase 函数名/文件路径被正则的 base64 字符集（含 `/`）意外命中，噪声太大不构成有效信号，**已在报告里弃用这部分结果，不作为「已扫清」的证据**。这不是 gitleaks 那种带正则规则库+真值验证（如真的去调用 API 探活）的工具,只是本地关键词+熵的兜底手段,漏检风险高于 gitleaks——如果之后能装上 gitleaks,仍建议补跑一次官方工具作为更权威的核验。
- 现状对照：追踪文件与历史的 `sk-`/`AKIA`/`Bearer` 扫描在前一轮已做过并确认全净（`r14-release-readiness/00-plan.md` 原文);本轮是在此基础上加做熵检测,结论一致——干净。

## 5. Gate 验证结果

```
$ pnpm qa:r2-release-gate
Overall: PASS
README document count matches docs/workhub markdown files | PASS | README=185, actual=185
Pending diff has no secret-like API keys | PASS | secret_like_diff_count=0
（其余 10 项门全 PASS，含 CI workflow 静态门/迁移文档集/reference 目录门/git diff whitespace 门）
```

```
$ pnpm audit:portable-config   -> portable config audit passed
$ pnpm audit:target-paths      -> target path audit passed
$ pnpm audit:migrations        -> migration audit passed
$ pnpm -r typecheck            -> 16/16 workspace packages, 0 errors
$ pnpm verify                  -> exit 0（typecheck + test + lint 全绿，等同 CI workspace job 的命令）
```

`pnpm verify` 期间各包测试数（全部 0 fail；`db`/`api` 各有 2/1 条既有 skip，与本批无关，非本批引入）：

| 包 | tests | pass |
|---|---|---|
| packages/tools | 24 | 24 |
| packages/config | 15 | 15 |
| packages/contracts | 146 | 146 |
| packages/audit | 5 | 5 |
| packages/cost | 24 | 24 |
| packages/events | 18 | 18 |
| packages/permissions | 14 | 14 |
| packages/api-client | 23 | 23 |
| packages/cuu | 52 | 52 |
| packages/agent | 163 | 163 |
| packages/db | 355 | 353（2 skip） |
| packages/ui | 204 | 204 |
| apps/api | 1448 | 1447（1 skip） |
| packages/web-runtime | 28 | 28 |
| apps/web | 83 | 83 |
| apps/desktop-webview | 1113 | 1113 |

`pnpm verify` 过程中 `pnpm qa:r4-rust-system-i18n` 会重新生成三份带时间戳的证据文件（`client-tauri/src-tauri/gen/schemas/capabilities.json`、`docs/workhub/05-clients/assets/audit/2026-06-11-r4-rust-system-i18n/{rust-system-i18n-report.json,smoke-summary.md}`）——这是既有 QA 脚本的正常副作用，与本批无关，已用 `git checkout --` 还原，未纳入本批 commit。

## 6. 偏离说明

1. **部署文档选择「升级 `DEPLOY.md`」而非「新增 `docs/workhub/` 文档」**：施工说明书给了两个选项（"写 docs/workhub/ 下部署文档（或升级现有部署文档）"）。选升级 `DEPLOY.md` 的理由：
   - `DEPLOY.md` 已经是内容详实的现行部署文档（十分钟部署、备份恢复、故障排查、安全口径全在），新增一份 `docs/workhub/` 文档会与它重复或需要互相引用,增加维护面;
   - 新增 `docs/workhub/*.md` 会触发 `docs/workhub/README.md` 的「N 篇文档已落盘」计数门,需要同步改那一行——升级已有文档零风险地避开这个耦合;
   - 施工说明书原文本身把两者列为等价选项,不是强制新增。
   本批因此**完全没有触碰 `docs/workhub/` 下任何文件**,计数门全程保持 185=185 不变（已验证)。
2. **CONTRIBUTING.md 只有英文版**：施工说明书对 README 明确要求「英文为主中文并存」,对 CONTRIBUTING 未提出双语要求;考虑到 CONTRIBUTING.md 是 GitHub 标准贡献指南文件名（通常单语),且双语会引入第二份文件需要同步维护的负担,选择英文单文件,文中显式写明中文 UI 文案与去黑话约定供中文贡献者对齐。
3. **gitleaks 未安装且未现场安装**：本机 `which gitleaks` 为空,也没有 `brew`/其它包管理器可用。施工说明书允许兜底方案（"没有就用 git log -p 抽样+正则扫高熵串兜底并如实说明局限"),按此执行,细节与局限见 §4。未从网络下载安装该二进制——这类"下载并执行来源不可信的可执行文件"的操作在我的操作准则里是被禁止的,即使技术上可行也不会绕过。
4. **README 功能亮点六条的措辞**：施工说明书原文写「今天刚全部落地」,核实后属实（GH/RISK/FEEDBACK/SEARCH/MEM/CHAT 六批全部已 merge 进本分支基线,merge 时间戳集中在 2026-07-14),已保留这一措辞的精神但未逐字照抄,写成更适合门面文案的语气。

## 7. 改动文件清单

| 文件 | 改动 |
|---|---|
| `README.md` | 全文重写（中文主文档） |
| `README.en.md` | 全文重写（英文对照） |
| `CONTRIBUTING.md` | 新增 |
| `.env.example` | 补齐 21 项缺失字段 + 注释,重新分组 |
| `.env.pilot.example` | 补一段 `GITHUB_TOKEN_ENC_KEY`（注释,默认关闭） |
| `DEPLOY.md` | 新增 §3.2（无 key 行为）、§3.3（GitHub 集成 key 生成）、§7（单实例假设);原 §7/§8 顺延为 §8/§9 |
| `r12-desktop-workbench/reports/r14-oss.md` | 本报告（不在 docs/workhub/,不影响计数门） |
