# 批 EXEC · agent 代码执行与环境 —— 实现级设计稿（含威胁模型）

> 状态：设计定稿**待用户拍板**（2026-07-14，设计先行批纪律：不拍板不施工）。要点：run_command 现状 fail-closed 判定正确；pilot 容器隔离只对宿主成立（容器内 root+全网出网+可读 env 密钥）→L0 容器收敛为第一优先切片；L1=macOS seatbelt→Linux bwrap 探测降级，探测不到保持 fail-closed；安装通道=声明式清单→提议→审批→白名单源+egress 双闸，红线永不静默安装。

> 状态：设计先行 · 2026-07-14 起草 · 只读侦察产物，未施工
> 基线仓库：`/Users/apple/.codex/worktrees/WorkHub/r12-workbench-full`（main=44e9e0ca）
> 参考：`reference/openai-codex`（seatbelt/bwrap/landlock+seccomp 模型）
> 用户授权模型原话（2026-07-14）：**除了安装东西外，常规文件操作仅授权在项目文件夹进行。**
> 定位：本项目不商业化，内部使用 + 开源自托管；一切设计以「自托管友好 + fail-closed」为硬约束。
> **本稿供用户拍板后才开工。**

---

## 0. 现状核对（精确文件:行号）

### 0.1 run_command 已建的护栏（`packages/tools/src/sandbox.ts`）

| 护栏 | 位置 | 现状 |
|---|---|---|
| 命令白名单 | `allowedCommands` L8–19 | `python/python3/py/node/npm/pnpm/bun/pytest/ruff/tsc`。**无 pip/pip3/uv/uvx**。 |
| 裸名校验 | `ensureCommandAllowed` L30–55；核心 L41–43 | args[0] 必须是裸名——`path.isAbsolute(raw)` 或 `path.basename(raw)!==raw` 直接抛错。堵死「先 write_file 一个 `./python` 再 `./python` 跑」的白名单绕过（白名单按 basename 校验、spawn 却按原样执行）。 |
| null 字节 | L34 | 任一 arg 含 `\0` 抛错。 |
| 命令名归一 | `normalizeCommandName` L25–28 | basename → 小写 → 去 `.exe/.cmd/.bat/.ps1`。 |
| 装包/远程执行禁用 | L21–23、L50–54 | `npm/pnpm/bun` + `{install,i,add,ci}` 或 `{exec,x,dlx,run,create,init}` → 抛 "dependency installation / remote package execution is disabled"。理由：`npm exec/pnpm dlx/bun x/run/create/init` 都会从 registry 下载并执行任意包。 |
| 超时 | `runSandboxedCommand` L223 | `clamp(timeoutSeconds,1,60)`；默认 `budget.commandTimeoutSeconds=45`（types.ts L14）。到期 `SIGKILL`（L170–172）。 |
| 输出上限 | `nodeCommandRunner` L163–195 | 每流封顶 `MAX_STREAM_BYTES=2MB`，超限截断 + `SIGKILL`。防白名单命令（LLM 可控 `python3 -c "print('x'*N)"`）吐 GB 撑爆宿主内存（DoS）。 |
| 沙箱预算 | `enforceSandboxBudget` L127–136；`defaultSandboxBudget` types.ts L11–15 | `maxFiles=800`、`maxBytes=200MB`、`commandTimeoutSeconds=45`。每次 write/命令后校验。 |
| 环境隔离 | `sandboxEnv` L138–148 | `PYTHONPATH=HOME=TMPDIR=TEMP=TMP=workdir`、`NO_COLOR=1`、`spawn(shell:false)`。**关键缺口：`PATH=process.env.PATH`（宿主 PATH）**——解释器仍从宿主装载。 |

### 0.2 fail-closed 禁用开关：为什么禁、开关在哪

- 拦截点：`file-tools.ts` `run_command.execute` **L306–314**——`if (!ctx.commandRunner) return errorToolResult("run_command 已禁用…")`。
- 禁用理由（L306–309 注释，**已 live 验证可读 `/etc/hosts`**）：run_command 跑白名单解释器，cwd 在 workdir，但**进程不隔离**——无 chroot/namespace/seccomp，PATH 是宿主 PATH。未注入受控 runner 时底层回退到无约束的 `nodeCommandRunner`，可读写宿主任意路径，**击穿 safeResolvePath 这层防护**（safeResolvePath 只管文件工具与 cwd 参数，管不住子进程自己 open 的绝对路径）。
- 开关：`AGENT_RUN_ALLOW_UNSANDBOXED_COMMANDS`（`packages/config/src/env.ts` **L111–114**，默认 `false`）。为 true 时在 `agent-runner.ts` **L2952–2954** 注入无约束 `nodeCommandRunner`。注释明确：仅受信本地/单机 opt-in；多租户/生产保持 false 并注入**真正隔离的 runner**。
- **进程不隔离的具体风险面**：宿主 PATH 装载解释器 → 子进程可 `open('/etc/passwd')`/`open(os.environ['DATABASE_URL'] 相关文件)`/读 `~/.ssh`、`~/.aws`、`.env`；可 `socket()` 走宿主网络出网（外传）；可写 `~/.bashrc`/`~/.profile`/cron 做持久化；`fork` 出脱离预算/超时视界的后台进程。safeResolvePath、预算闸、超时闸**全部只作用于 WorkHub 自己的工具层，管不到子进程内部的 syscall**。

### 0.3 safeResolvePath 把文件工具钉死在 workdir 的机制（`sandbox.ts` L83–97）

- 词法守卫：`path.resolve(root, inputPath)` 后 `path.relative(root,target)` 若为 `..*` 或绝对路径 → 抛 "path escapes workdir"。
- 符号链接守卫：`realpathEscapes` L60–81——解析 target **最近的已存在祖先**的 realpath，确认仍在 `realpathSync(root)` 内；否则抛 "path escapes workdir via symlink"。workdir 不存在时（纯路径单测）跳过。
- 覆盖面：`file-tools.ts` 全部文件工具（list/read/write/write_base64/mkdir/move/delete/zip）+ `runSandboxedCommand` 的 `cwd` 参数（L222）都过 safeResolvePath。`sandboxStats` 遍历也不跟随 symlink（L109–111）防毒环。
- **边界**：这是**工具层**的路径钉死，不是**进程层**的隔离。run_command 一旦真跑起子进程，这层就失效——这正是 0.2 禁用的根因，也是本批要补的核心。

### 0.4 workdir 生命周期与「项目文件夹」语义

- **默认 workdir**（`agent-runner.ts` `defaultWorkdir` L745–747）：`mkdtemp(os.tmpdir(), "workhub-agent-${runId}-")`——**每个 run 一个临时目录，在 OS 临时区，不是项目网盘**。
- 目录内三区：
  - `project/` = **只读**镜像，`hydrateProjectWorkdir`（`workers/project-hydrate.ts`）把项目 Drive 现有文件物化进来（P-COLLAB M1）；逐文件过 safeResolvePath 防逃逸、预算上限防爆、fail-open。默认开（`AGENT_RUN_PROJECT_HYDRATE_ENABLED=true`，env.ts L117）。
  - `inputs/` = 本任务输入文件。
  - `outputs/` = **唯一可写产出区**；proposal manifest 只扫 `outputs/`。系统提示词明确「没有 outputs/ 产出 = 任务失败」（agent-runner.ts L783）。
- **谁建谁清**：queue 建（mkdtemp）；清理是 **TTL 兜底扫描**——`sweepStaleAgentWorkdirs`（L2823–2857）在 queue 初始化时 fire-and-forget 扫 `os.tmpdir()` 下 `workhub-agent-*`、mtime 超 `ttlMs=6h` 的 `rm -rf`。**注意：没有 run 完成即时 rm**，内存 `runWorkdirs` Map 在 RUN_CACHE_CAP 剔除时只删引用不删磁盘（L873）。→ 本批应补「run 结束即清 workdir」以缩短敏感产物驻留窗口（见 §5 切片）。
- **「项目文件夹」授权语义落到哪个路径边界**：WorkHub 的「项目文件夹」= 项目的 **Drive**（`project_drive`）。sandbox workdir 是**过渡暂存区**，它的 `project/` 是 Drive 的只读副本，`outputs/` 的产物**只经人工审批（proposal→approve→merge）才回灌 Drive**。因此用户授权「常规文件操作仅授权项目文件夹」的落地 = **把 run 的可写文件面钉死在 `outputs/`（本任务）+ 把可读面钉死在 `project/`（该项目 Drive 只读副本）+ `inputs/`**，绝不允许触碰 workdir 之外的宿主任意路径。safeResolvePath 已在工具层做到；本批要在**进程层**补上同等边界（§3）。

### 0.5 pilot 容器环境

- `Dockerfile`：`FROM node:22-slim`（**默认 root，无 USER 指令**）。预装 `python3 python3-pip fonts-noto-cjk` + pip：`python-docx 1.1.2 / openpyxl 3.1.5 / python-pptx 1.0.2 / matplotlib 3.9.4 / pandas 2.2.3 / numpy 2.1.3`（`--break-system-packages`）。单镜像 = API daemon + Web 静态产物。
- `docker-compose.pilot.yml`：`postgres:16` + `redis:7` + `workhub`。workhub 挂 `/app/data` 卷、默认 `APP_ENV=development`（LAN 信任）。**无 `read_only` 根 FS、无 `cap_drop`、无 `security_opt`、无 userns-remap、默认 bridge 网络（全出网）**；DB 口令走 env。
- `.env.pilot.example` L28：`AGENT_RUN_ALLOW_UNSANDBOXED_COMMANDS=true`——**pilot LAN 出厂即开 run_command，但是 UNSANDBOXED**，靠「容器边界 + LAN 单机信任」兜底。这就是现状 L0。
- **「容器部署 = 天然隔离」的真实边界**：容器边界隔离 agent 的 python **相对宿主**；但**容器内 agent 以 root 跑，能读容器内全 FS（含 `/app` 源码、env 里的 `DATABASE_URL`/`COOKIE_SECRET`/LLM key）、能全网出网**。所以「天然隔离」只对宿主成立，对**容器内的密钥与网络出网不成立**——L0 仍需补 §3 的容器内收敛（降权非 root、egress 收口、密钥不进 agent 可读面）。

### 0.6 受控安装通道的既有接缝

- 「提议→审批」纪律：`ProposalService`（`services/proposals.ts`：`createFromManifest`/`review`/`merge`，L140–）；审批路由 `packages/permissions/src/approval-routing.ts`；`human-reserved-guard`（`external_effect` 类工具升级人工）。这些是可复用的审批接缝。
- 装包现状 = **硬封**：白名单无 pip/uv；npm/pnpm/bun 的 install/add/ci 被 L50–54 拦；sandboxEnv 不给任何 registry 配置。要放开受控安装，需补三件：声明式清单、审批闸、以及**能真正约束「只连官方源 + 只写沙箱环境」的执行层**（registry 白名单靠 env 如 `PIP_INDEX_URL`/`npm_config_registry` + **网络出网收口**才能落地——只设 env 不锁网等于没锁）。

---

## 1. 威胁模型

信任边界：**LLM/agent 是半可信执行体**（受 prompt 注入影响，见 0.2 已中和的围栏注入面）；**workdir 内的 project/、inputs/ 内容不可信**（用户/Drive/会议纪要可控，可能藏注入指令）；**宿主 + 容器内的密钥/网络/源码是要保护的资产**。

| # | 攻击面 | 场景 | 现有缓解 | 本批新增缓解 |
|---|---|---|---|---|
| T1 | **跑恶意命令** | prompt 注入诱导 agent 用 run_command 跑破坏性命令 | 命令白名单（仅解释器）+ 裸名校验 + 无 shell 展开 + 装包/远程执行封禁 + 超时/输出/预算闸 | 进程级沙箱（L0 容器降权 / L1 平台沙箱）让「即使跑起来也困在 workdir + 断网」 |
| T2 | **读宿主敏感文件** | python `open('/etc/passwd')`、读 `~/.ssh`/`~/.aws`/`.env`/`DATABASE_URL` 指向物 | **无**（safeResolvePath 管不到子进程；已 live 验证可读 /etc/hosts）→ 故 fail-closed 禁用 | L1：seatbelt/bwrap `(deny default)` + 只读白名单仅限 workdir；L0：容器内降权非 root + 密钥移出 agent 可读面（独立进程/最小 env） |
| T3 | **外传数据** | 子进程 `socket()` 把 Drive/DB 数据 POST 到外部 | **无**（un-sandboxed runner 有宿主网络；容器有全出网） | L1：seccomp 网络过滤 / seatbelt 网络 deny-default；L0：容器 egress allowlist（默认 deny，仅放 registry 镜像 + LLM 端点） |
| T4 | **持久化后门** | 写 `~/.bashrc`/cron/`.profile`/写回 `/app` 源码 | workdir=HOME/TMPDIR（L138–148）把 HOME 指到 workdir，降低命中真实 HOME 概率；但宿主路径仍可写 | L1：写面仅 `outputs/`（seatbelt file-write* 只授 outputs/ 子路径）；L0：容器根 FS `read_only:true` + 仅 workdir 卷可写 |
| T5 | **资源耗尽** | fork 炸弹、填盘、吐 GB 输出、跑满 CPU | 输出 2MB 封顶 + SIGKILL、超时 60s 上限、字节/文件预算、写前预检 | L0/L1：cgroup/ulimit（pids/CPU/mem 限额）+ `outputs/` 磁盘配额；进程组 kill（杀整棵子进程树，不只首进程） |
| T6 | **装包供应链投毒** | 诱导装恶意包 / typosquat / 装完执行 postinstall | 装包硬封（allowlist 无 pip、npm install 拦） | 受控安装通道（§4）：声明式清单 + 人工审批 + 源白名单（pypi/npm 官方）+ 装进沙箱环境不污染宿主 + 永不静默安装 |
| T7 | **越沙箱写回业务** | 绕过 proposal 直接改 Drive/DB | 业务写/外部副作用类工具归 produce/integrate 角色；proposal→approve→merge；human-reserved-guard | 不变；本批不放开任何绕过审批的写路径（明确不做，§6） |

---

## 2. 隔离执行器分级与选型

核心思路：**能力从 fail-closed 逐级放开，每级都可探测、探测不到就降级到更保守级、最终兜底显式 opt-in + 文档写明风险**。run_command 的「敢默认开」= 至少落到 L0 或 L1。

### L0 —— 容器部署直接开（进程已相对宿主隔离，网络与容器内权限仍要收）

- 适用：pilot / docker-compose 自托管（本项目主路径）。
- 现状：容器边界已隔离宿主，但容器内 root + 全出网（0.5）。
- 收敛动作（compose/Dockerfile 层，**不改 run_command 代码**）：
  1. Dockerfile 加非 root `USER`（新建 `appuser`），agent 子进程以非 root 跑。
  2. compose 加 `read_only: true` 根 FS + `tmpfs`/命名卷仅挂 workdir 根可写。
  3. `cap_drop: [ALL]`、`security_opt: [no-new-privileges:true]`、`pids_limit`、`mem_limit`/`cpus`。
  4. **egress allowlist**：默认 deny 出网，仅放行 LLM 端点 + （受控安装时）registry 镜像。落地方式：独立 egress 代理容器 / compose network + iptables sidecar / 或至少文档写明「生产务必收 egress」。
- 判定：容器内检测到 `/.dockerenv` 或 cgroup 标记 → 视为 L0 就绪，run_command 默认开（但 §3 边界仍生效）。

### L1 —— 宿主裸跑 + 平台沙箱（借鉴 codex）

宿主 node 进程 spawn 受限子进程，用 OS 原生沙箱把子进程困在 workdir + 断网。

- **macOS：seatbelt（`sandbox-exec`）**。借鉴 codex `sandboxing/src/seatbelt.rs`：
  - 命令形态：`/usr/bin/sandbox-exec -p <SBPL策略> -D<KEY>=<路径> ... -- <解释器 args>`。**硬编码 `/usr/bin/sandbox-exec`** 防 PATH 注入替换（codex L30）。
  - 策略：`(deny default)` 闭合起步（codex `seatbelt_base_policy.sbpl`）+ `(allow file-read* (subpath (param "READ_ROOT")))` 只读 `project/`+`inputs/` + `(allow file-write* (subpath (param "OUT_ROOT")))` 仅 `outputs/` + 网络 deny-default（`seatbelt_network_policy.sbpl` 仅在放网时追加，且只放 loopback proxy）。用 `-D` 传参而非字符串拼路径（防注入）。
  - 探测：`statSync('/usr/bin/sandbox-exec')` 存在 + `uname darwin`。
- **Linux：bwrap（bubblewrap）优先，landlock+seccomp 兜底**。借鉴 codex `linux-sandbox/README.md` + `landlock.rs`：
  - bwrap：`--ro-bind / /`（根只读）+ `--bind <workdir/outputs> <...>`（唯一可写）+ `--ro-bind project inputs` + `--unshare-net`（断网）+ `--die-with-parent`。
  - 就地加固：`PR_SET_NO_NEW_PRIVS` + seccomp 网络过滤（禁 `socket/connect` 等，`landlock.rs` L39/L67）。
  - 探测优先级（照 codex）：PATH 上（cwd 之外）的 `bwrap` → 太老不支持 `--argv0` 走兼容路径 → 缺失则 landlock+seccomp legacy → 都不行则**拒绝 + 启动告警**。userns 不可用（WSL1 类）→ fail-closed 拒绝。
- **兜底 L1.opt-in**：两平台都探测不到隔离原语 → **保持 fail-closed**，仅当部署方显式置 `AGENT_RUN_ALLOW_UNSANDBOXED_COMMANDS=true`（沿用现有开关）才接无约束 runner，并在启动日志 + 部署文档醒目写明「未隔离，仅限受信单机」。

### 探测降级矩阵

| 环境探测结果 | 选型 | run_command 默认态 |
|---|---|---|
| 容器内（`/.dockerenv`）+ compose 已收 egress/权限 | L0 | **开** |
| macOS + `/usr/bin/sandbox-exec` 存在 | L1-seatbelt | **开** |
| Linux + bwrap 可用 + userns 可用 | L1-bwrap | **开** |
| Linux + 仅 landlock/seccomp 可用 | L1-landlock（legacy，读只读全盘、写限 outputs、断网） | **开（降级）** |
| 均探测不到 + 开关未置 | 无隔离 | **fail-closed 拒绝**（现状） |
| 均探测不到 + `ALLOW_UNSANDBOXED=true` | 无约束 nodeCommandRunner | **开（显式 opt-in + 文档风险）** |

**选型推荐**：本项目主路径是 docker 自托管 → **L0 优先落地（收敛 compose/Dockerfile，工包最小、最快让 run_command 敢默认开）**；L1 作为「开发者本机不进容器直接跑」的第二路径，**先做 macOS seatbelt（用户就是 macOS，reference 现成）**，Linux bwrap 随后。CommandRunner 抽象已就位（`types.ts` `CommandRunner` 接口 + 依赖注入 L2954），新隔离 runner 只是**多一个 runner 实现 + 一个探测器**，不动 run_command 调用点。

---

## 3. 文件边界落地（「常规文件操作仅授权项目文件夹」）

把用户授权翻译成两层同构边界：

1. **工具层（已有，复用）**：safeResolvePath 已把全部文件工具 + run_command 的 cwd 钉死在 workdir（0.3）。保持不动。
2. **进程层（本批新增）**：让 run_command 跑起的子进程也只能碰 workdir——
   - 可写面 = `outputs/`（本任务产出，唯一回灌 Drive 的路径，经审批）。
   - 只读面 = `project/`（该项目 Drive 只读副本）+ `inputs/`。
   - L0：容器 `read_only` 根 + 仅 workdir 卷可写；子进程 cwd/HOME/TMPDIR 已是 workdir。
   - L1：seatbelt/bwrap 把 file-write* 只授 `outputs/` 子路径、file-read* 只授 `project/`+`inputs/`（`-D` 参数传真实路径）。
   - 语义对齐：WorkHub「项目文件夹」= 项目 Drive；进程边界 = workdir 内的 `project/`(读)+`outputs/`(写)，**产物经 proposal→审批才落 Drive**——与用户「仅授权项目文件夹」严格一致，绝不给宿主任意路径。
3. **符号链接逃逸防护**：realpathEscapes（0.3）已在工具层挡符号链接；进程层由 seatbelt/bwrap 的路径 subpath 语义 + `--ro-bind` 兜底（子进程即便造 symlink，真实 vnode 仍被沙箱策略挡）。project-hydrate 物化时也已过 safeResolvePath（project-hydrate.ts L54）。

---

## 4. 受控安装通道

红线：**永不静默安装**。装依赖是独立于 run_command 的特批动作，走「声明式清单 → 提议卡 → 人工审批 → 沙箱内安装」四步，沿「AI 写生产必须走提议→审批」的既有纪律（0.6）。

- **声明式依赖清单**：agent 不直接跑 pip/npm，而是产出一份**受限子集清单**（`requirements` 子集：`包名==版本`；或 `package.json` deps 子集），写进 workdir。只允许「包名 + 精确版本 + 源」，不允许任意 install 命令行、不允许 git/url/本地路径依赖、不允许 `--index-url` 覆盖。
- **提议卡 + 人工审批**：清单转成一张审批卡（复用 ProposalService/attention 队列的接缝，类比 `external_effect` 人工保留），审阅者看到「要装哪些包、什么版本、什么源、为什么」，approve 才继续。默认 deny。
- **源白名单**：仅 pypi 官方（`https://pypi.org/simple`）+ npm 官方（`https://registry.npmjs.org`）。落地 = 安装步骤强制 `PIP_INDEX_URL`/`npm_config_registry` 指向白名单源 + **egress 只放行这两个域**（L0 容器 egress allowlist / L1 安装步骤临时放网且仅这两个 host）。**只设 env 不锁网无效**——必须与 §2 的 egress 收口配套。
- **装进沙箱环境不污染宿主**：装到 workdir 内的隔离环境（python `venv`/`--target=workdir/.pydeps` + `PYTHONPATH` 已指 workdir；node `npm install --prefix workdir`），装完随 workdir TTL 清理。**不 `--break-system-packages`、不装到全局**。
- **审批后执行**：安装本身也在隔离 runner（§2）内跑，仅安装步骤临时开「白名单源」出网，装完立即回落断网。
- 施工前提：受控安装通道**依赖 §2 的隔离执行器先落地**（没有 egress 收口 + 沙箱环境，装包无法「只连官方源 + 不污染宿主」）。故排在 §2 之后。

---

## 5. 施工切片（若用户批准后 / 预估工包·模型·围栏）

> 纪律：sonnet 施工 fan-out；集成串行收口；无 emoji/去黑话/文档回真；改产线行为同步改 PG smoke 断言；改 docs/*.md 计数同 commit 改 README。

| 切片 | 范围 | 体量 | 围栏 |
|---|---|---|---|
| E1 · 探测器 + runner 抽象 | 平台探测（容器/seatbelt/bwrap/landlock）→ 选 runner；`CommandRunner` 新实现挂载点 | 中 | 不动 run_command 调用点；探测失败一律回落 fail-closed；单测覆盖每条降级分支 |
| E2 · L0 容器收敛 | Dockerfile 非 root `USER` + compose `read_only`/`cap_drop`/`no-new-privileges`/`pids_limit`/egress allowlist；`.env.pilot` 口径更新 | 中 | pilot-stack-smoke 必须仍绿；DEPLOY.md §7 同步；不破坏现有 Office 交付能力（字体/库路径） |
| E3 · L1 macOS seatbelt runner | 移植 codex SBPL 骨架（deny-default + 读 project/inputs + 写 outputs + 断网）；`-p/-D/--` 命令构造；硬编码 `/usr/bin/sandbox-exec` | 中大 | 只在 darwin 启用；真机验证可读 project/ 不可读 `/etc/hosts`（回归 0.2 的 live 验证，反向断言）；断网验证 |
| E4 · L1 Linux bwrap runner | `--ro-bind / /` + `--bind outputs` + `--unshare-net` + `PR_SET_NO_NEW_PRIVS`+seccomp；探测降级 landlock | 中大 | userns 不可用 fail-closed；CI 若无 bwrap 则跳过实跑但保留单测 |
| E5 · workdir 即时清理 | run 结束（终态）即 rm workdir，TTL sweep 保留做兜底 | 小 | 不影响 snapshot/proposal 已读取的产物；漂移/重领语义不踩（结算后再清） |
| E6 · 资源围栏 | 进程组 kill（杀子进程树）+ ulimit/cgroup（pids/mem/cpu）+ outputs 磁盘配额 | 中 | 与现有超时/输出/预算闸叠加不冲突 |
| E7 · 受控安装通道 | 声明式清单契约 + 审批卡（复用 proposal/attention）+ 源白名单 + venv/--prefix 隔离安装 | 大 | **依赖 E1–E4 先落**；默认 deny；永不静默安装；单测覆盖「非白名单源/任意命令行/全局安装」全部拒绝 |

**建议施工序**：E1 → E2（最快让容器路径 run_command 敢默认开）→ E5/E6（资源与清理，独立可并行）→ E3 → E4 → E7（安装通道压轴，依赖隔离层）。

---

## 6. 明确不做（防 scope 漂移）

- **任意 shell**：永不放开 `sh -c`/shell 展开/白名单外命令。
- **宿主全盘访问**：run_command 子进程永不获得 workdir 之外的读写面（这是用户授权的硬边界）。
- **无审批安装**：装包永不静默；无声明式清单 + 人工审批不装。
- **绕过 proposal 的业务写**：不新增任何绕过「提议→审批→合并」直改 Drive/DB 的路径。
- **公网多租户默认开无隔离 run_command**：探测不到隔离原语时保持 fail-closed，不因「方便」默认放开。

---

## 7. 给用户的拍板要点（TL;DR）

- **威胁核心**：run_command 现状 fail-closed 是对的——进程不隔离时子进程能读宿主敏感文件（已 live 验证读到 /etc/hosts）、出网外传、持久化，safeResolvePath 只管工具层管不到子进程。
- **选型推荐**：L0 容器收敛优先（本项目主路径、工包最小），L1 先 macOS seatbelt（用户本机 + codex 现成参考）后 Linux bwrap；探测不到一律 fail-closed 显式 opt-in。
- **文件边界**：进程层补齐 = workdir 内 `outputs/`(写)+`project/`(读)，与工具层 safeResolvePath 同构，严格对齐用户「仅授权项目文件夹」。
- **安装通道**：声明式清单 → 提议卡 → 人工审批 → 源白名单 + 沙箱内 venv 安装，永不静默；依赖隔离层先落。
