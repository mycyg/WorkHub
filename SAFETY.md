# 安全与免责 · Safety and Disclaimers

简体中文 ｜ [English](#english)

本文件说明 WorkHub 当前的成熟度、沙箱能挡住什么与挡不住什么，以及使用者需要自己承担的部分。
漏洞报告流程见 [SECURITY.md](SECURITY.md)。

## 1. 实验状态

WorkHub 是一个**实验性的开发者预览版**，不是安全产品，也不是生产就绪的产品。

- 它**没有经过任何第三方安全审计**。
- 它会执行大语言模型生成的内容：模型写的文件、模型选的命令、模型拟的提议。模型可能出错，也可能被它读到的内容（工单正文、上传的资料、网盘文件、第三方插件）操纵。
- 接口、数据结构、默认配置都可能在没有迁移路径的情况下变更。

不要把它当作安全边界，也不要把它作为处理不受信任工作负载的唯一控制手段。

## 2. 沙箱的局限

WorkHub 的命令沙箱按平台分成两档，**每次执行都会如实上报自己属于哪一档**（`full` / `partial`）：

| 平台 | 后端 | 完整度 | 实际约束 |
| --- | --- | --- | --- |
| macOS | Seatbelt（`sandbox-exec`） | `full` | 以「拒绝一切」起手；写只允许工作目录与本进程临时目录；出网一律拒绝；读只允许系统运行库、解释器安装前缀与工作目录。子进程继承同一策略。 |
| Linux / Windows | 无操作系统级后端 | —— | **默认拒绝执行**（结果里带 `SANDBOX_UNAVAILABLE`）。部署方显式打开 `AGENT_RUN_ALLOW_UNSANDBOXED_COMMANDS` 才降级到下一行那档。 |
| 任意平台（显式降级） | 用户态软沙箱 | `partial` | 只有命令白名单、路径围栏与磁盘预算。**不是安全边界**：子进程可读写宿主路径、可出网。 |

即便在 `full` 那一档，也请注意：

- **正确执行的限制也保护不了本项目本身被允许访问的资源。** 沙箱管的是命令子进程，管不了 WorkHub 服务端自己——它持有数据库凭据、模型接口密钥与网盘文件的访问权，模型通过工具调用间接使用的正是这些权限。
- 系统只读资料（例如 `/private/etc` 下的配置）在 `full` 档下仍可被命令读取；被挡住的是用户数据目录、工作目录以外的写入与全部出网。
- `sandbox-exec` 已被 Apple 标记为 deprecated；它在未来的 macOS 版本上可能失效。失效时后端探测会拿不到它，于是回到「默认拒绝执行」。
- 沙箱不约束模型对**业务数据**的操作。工单、提议、网盘、通知这些走的是审批与权限体系（见 `docs/workhub/01-architecture/security-and-permissions.md`），不是沙箱。
- 沙箱不做资源公平性保证：超时、输出上限与磁盘预算是防失控的粗闸，不是抗拒绝服务的防线。

## 3. 负责任地使用

1. **只在受信环境里部署**。默认形态假设部署者信任所有已注册成员；它不是面向公网的多租户产品。
2. **不要把无法承受泄露或损坏的数据交给它**。给 AI 工人的资料，应当假设会出现在模型的上下文里。
3. **保留人类审批**。审批、人类保留工具、预算闸都是刻意的减速带，请不要为了跑得快而全部关掉。
4. **在没有操作系统级沙箱的平台上，保持 `AGENT_RUN_ALLOW_UNSANDBOXED_COMMANDS=false`**。宁可 `run_command` 不可用，也不要无边界执行；确需命令执行时，请自行注入容器/命名空间级别的隔离执行器。
5. **自己做备份与出口**。本项目不提供任何数据持久性或可恢复性承诺。

## 4. 无担保

本项目按「现状」提供，不附带任何形式的明示或默示担保，包括但不限于适销性、特定用途适用性与非侵权担保。使用本项目所产生的风险由使用者自行承担；作者与贡献者不对任何直接、间接、偶然或后果性损害负责。许可条款以仓库根目录的 [LICENSE](LICENSE)（PolyForm Noncommercial 1.0.0）为准，本文件不构成对其的修改。

## 5. 漏洞披露

请**不要**通过公开 Issue、PR 或社交媒体披露未修复的安全问题。报告渠道、响应时限与协调披露约定见 [SECURITY.md](SECURITY.md)。

---

## English

This document states WorkHub's maturity, what the sandbox does and does not stop, and what users carry themselves. For vulnerability reports, see [SECURITY.md](SECURITY.md).

### 1. Experimental status

WorkHub is an **experimental developer preview**. It is not a security product and it is not production-ready.

- It has **not been security audited** by anyone.
- It executes content produced by a large language model: files the model writes, commands the model picks, proposals the model drafts. The model can be wrong, and it can be manipulated by the content it reads (work item text, uploaded material, drive files, third-party plugins).
- Interfaces, data shapes, and defaults may change without a migration path.

Do not treat it as a security boundary, and do not make it your only control for untrusted workloads.

### 2. Sandbox limitations

The command sandbox has two rungs, and **every execution reports which rung it actually got** (`full` or `partial`):

| Platform | Backend | Enforcement | What is actually constrained |
| --- | --- | --- | --- |
| macOS | Seatbelt (`sandbox-exec`) | `full` | Deny-by-default; writes allowed only in the run workspace and the process temp directory; all network denied; reads limited to system runtime paths, the interpreter prefix, and the workspace. Child processes inherit the same policy. |
| Linux / Windows | No operating-system backend | — | **Execution is refused by default** (the result carries `SANDBOX_UNAVAILABLE`). Only an explicit `AGENT_RUN_ALLOW_UNSANDBOXED_COMMANDS` degrades to the rung below. |
| Any platform (explicit degrade) | User-space soft sandbox | `partial` | Command allowlist, path fence, and disk budget only. **Not a security boundary**: child processes can read and write host paths and reach the network. |

Even on the `full` rung:

- **Correctly enforced restrictions still do not protect the resources this project is itself allowed to reach.** The sandbox constrains command subprocesses, not the WorkHub server, which holds database credentials, model API keys, and drive access — the very permissions the model uses indirectly through tool calls.
- System read-only material (configuration under `/private/etc`, for instance) remains readable by commands on the `full` rung. What is blocked is user data directories, writes outside the workspace, and all network egress.
- `sandbox-exec` is deprecated by Apple and may stop working on a future macOS release. When it does, backend detection will not find it and execution falls back to being refused.
- The sandbox does not constrain what the model does to **business data**. Work items, proposals, drive files, and notifications go through the approval and permission system (see `docs/workhub/01-architecture/security-and-permissions.md`), not the sandbox.
- The sandbox makes no fairness guarantee. Timeouts, output caps, and disk budgets are coarse brakes against runaway commands, not a denial-of-service defense.

### 3. Responsible use

1. **Deploy only in a trusted environment.** The default shape assumes the operator trusts every registered member; it is not an internet-facing multi-tenant product.
2. **Do not give it data you cannot afford to leak or lose.** Assume anything handed to an AI worker will appear in a model context window.
3. **Keep humans in the approval path.** Approvals, human-reserved tools, and budget gates are deliberate speed bumps; do not switch them all off for throughput.
4. **Keep `AGENT_RUN_ALLOW_UNSANDBOXED_COMMANDS=false` on platforms without an operating-system sandbox.** Prefer an unavailable `run_command` over unbounded execution; if you need command execution there, inject your own container- or namespace-level isolated runner.
5. **Own your backups and your exit.** This project makes no durability or recoverability promise.

### 4. No warranty

This project is provided "as is", without warranty of any kind, express or implied, including but not limited to merchantability, fitness for a particular purpose, and non-infringement. You assume the entire risk of using it; the authors and contributors are not liable for any direct, indirect, incidental, or consequential damages. The governing license is [LICENSE](LICENSE) (PolyForm Noncommercial 1.0.0) at the repository root, and this document does not modify it.

### 5. Vulnerability disclosure

Please do **not** disclose unfixed security issues through public Issues, PRs, or social media. Reporting channels, response windows, and the coordinated-disclosure agreement are in [SECURITY.md](SECURITY.md).
