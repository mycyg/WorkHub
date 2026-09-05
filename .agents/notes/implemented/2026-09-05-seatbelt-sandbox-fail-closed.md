# 命令沙箱：macOS Seatbelt 后端 + fail-closed 默认

- Status: implemented
- Date: 2026-09-05
- Owner: claude-fable（R26 B8）

## Problem

`packages/tools/src/sandbox.ts` 的命令沙箱**全在用户态**：命令白名单、词法路径围栏、
`realpathSync` 软链检查、磁盘/输出预算，加上一个原样透传宿主 `PATH` 的 env。它自己的注释
（CORE-16）就写明这不是安全边界——无 chroot、无命名空间、无 seccomp、**没有任何出网封锁**，
而且历史审查已 live 验证过：无约束回退能读 `/etc/hosts`。

唯一的硬停是 `run_command` 在没有注入 `commandRunner` 时报错，开关
`AGENT_RUN_ALLOW_UNSANDBOXED_COMMANDS` 的语义是「允许**无约束**执行」。也就是说，这个开关只有
两种状态：能力关掉，或者把宿主机交给模型生成的命令。中间没有档位。

同时还有两个附带问题：

1. 沙箱拒绝在结果里就是一句 `Operation not permitted`。模型会把它当成命令写错，然后不停换写法
   绕——这是真实的失控路径，不是理论风险。
2. 仓库是 PUBLIC 的、跑模型生成的代码、有一个自己承认不是安全边界的沙箱，却只有
   `SECURITY.md`（纯漏洞披露流程），**没有任何免责与能力口径**。

## Decision

借 deepseek-harness `packages/sandbox` 的三条契约（只借契约与思想，profile 由本机实测收敛）：

1. **三档模式**（`packages/tools/src/types.ts`）：`read-only` / `workspace-write` /
   `danger-full-access`。agent run 默认 `workspace-write`（工人要能把交付物写进 `outputs/`）；
   `danger-full-access` 完全不包裹，只有显式配置才取得到。
2. **macOS Seatbelt 后端**（新增 `packages/tools/src/seatbelt.ts`）：`nodeCommandRunner` 在
   spawn 之前把 argv 包成 `sandbox-exec -p '<profile>' -- <argv>`。profile 以 `(deny default)`
   起手 + `(deny network*)`，其余全是显式 allow：读放行系统运行库、解释器安装前缀与工作目录，
   写只放行工作目录与本进程临时目录（`read-only` 一条写白名单都不给）。
3. **fail-closed**：`resolveSandboxBackend` 按「平台 × 开关 × 模式」决策。没有可用后端且没显式
   允许降级 → 拒绝执行并回 `SANDBOX_UNAVAILABLE`，命令根本不跑。
   `AGENT_RUN_ALLOW_UNSANDBOXED_COMMANDS` 语义随之从「允许无约束」改成「**允许降级到软沙箱
   （partial）**」。
4. **完整度上报**：每次执行返回 `enforcement`（`full`=Seatbelt / `partial`=软沙箱）与
   `backend`，让消费者区分「沙箱坏了」和「命令被拒」。包裹器自身失败（profile 语法错）与目标程序
   不存在（`execvp()`）分开归类：前者是沙箱故障要 fail-closed，后者是命令的问题。
5. **拒绝话术写死**：识别出拒绝签名后，把结果翻成
   `[sandbox: <操作> denied by policy] 这是沙箱策略拒绝，不是命令写错……不要换写法绕过`，
   并把同一句精神加进 agent run 工作纪律第 7 条（`agent-run-prompt.ts`，已 `gen:expected` 重生成基线）。
6. **`SAFETY.md`**：中英双语五段——实验状态 / 沙箱局限（逐档写清约束什么、不约束什么）/
   负责任使用 / 无担保 / 漏洞披露指向 `SECURITY.md`。

profile 里每一条 allow 都是实测收敛的最小集，其中三条反直觉、删掉就炸：`(literal "/")`（不放行根
目录连 `/bin/echo` 都起不来，退出码 134）、`(literal "/var")`（`/var` 是符号链接，解析前缀要读链接
本体）、以及宿主临时目录的写权限（macOS 的 `/usr/bin/python3` 是 Command Line Tools 的 shim，
起来时 xcrun 要往 `confstr(_CS_DARWIN_USER_TEMP_DIR)` 写缓存，那个位置不受 `TMPDIR` 影响）。

## Alternatives considered

- **照抄 deepseek-harness 的 `(allow default) + (deny file-write*)`**：它只做写围栏，不封网、不限读。
  我们的威胁模型里出网是最贵的一条（外发/回连），读宿主家目录是第二贵的，所以选了更严的
  `(deny default)`，代价是要逐条实测放行。
- **Linux 也上 bwrap / Landlock**：dsh 为此维护了一个原生 npm 包 + 三平台预构建 + 独立发布流水线
  （`native/landlock-run/` 51 个文件）。我们是桌面优先、macOS 为主战场，没有那个用户群，
  Linux 先 fail-closed，需要时由部署方注入容器级 runner。
- **保持 macOS 上 `run_command` 默认关闭**（沿用旧的注入条件）：那样 Seatbelt 白做了——真沙箱到位
  之后仍然默认不可用，等于把能力锁死在开关后面。选择让 macOS 默认可用，把「默认拒绝」留给
  真正没有边界的平台。**这是一处默认行为变更**，见 Consequences。
- **read-only 档也放行宿主临时目录的写**：能让 `/usr/bin/python3` 在该档下不报 xcrun 缓存错，
  但一个能写临时目录的 `read-only` 是名不副实的；与 dsh 的 `writableRoots` 保持同口径（read-only
  一个写根目录都没有），把这条局限写进注释与 `SAFETY.md`。
- **只把拒绝提示放进工具结果、不进系统提示词**：拒绝提示是事后的，模型在遇到之前不知道边界在哪；
  两条通道都要，才既有事前预期也有事后归因。

## Consequences

- **默认行为变更**：macOS + `AGENT_RUN_ALLOW_UNSANDBOXED_COMMANDS=false` 从「`run_command` 不可用」
  变成「`run_command` 在 Seatbelt 下可用」。Linux/Windows 两种开关取值的行为都与此前等价
  （false=拒绝执行，true=软沙箱），CI 与试点栈不受影响。
- `read-only` 档下 macOS 系统自带的 `/usr/bin/python3` 会往 stderr 打一行 xcrun 缓存写失败；命令本身
  在缓存已存在时仍能跑，冷缓存时会失败。Homebrew / 自装的 python3 与 node 不受影响。
- `sandbox-exec` 已被 Apple 标记 deprecated。它哪天消失，后端探测就拿不到它，于是回落到
  「默认拒绝执行」——不会静默变成无约束执行，但 `run_command` 会不可用。
- profile 是**实测最小集**，改动它（尤其是删 allow）必须重跑 `packages/tools/src/seatbelt.test.ts` 的
  真机集成用例。那几条守卫已验证「可复现地变红」：把后端从 `seatbelt` 退回 `soft` 后 4 条立即失败。
- `.env.example` / `.env.pilot.example` / `DEPLOY.md` 里关于该开关的旧措辞（「允许无约束执行」）尚未
  同步，属于本次范围外的文案跟进项。
