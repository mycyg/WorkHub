/**
 * 默认的子进程启动口（工包 M2）。本包唯一碰 `node:child_process` 的地方。
 *
 * 三条不能改的默认值：
 *
 * - **不过 shell。** `spawn` 默认 `shell: false`，命令与参数逐个交给 execve，管理员填的
 *   `args` 里出现 `; rm -rf /` 只会变成一个普通的字符串参数。开 `shell: true` 会把整张表变成
 *   一条命令注入面。
 * - **env 是全量替换，不是叠加。** 传给 `spawn` 的 `env` 会**整个替换**父进程环境，
 *   这正是 `buildMcpChildEnv` 白名单口径能生效的前提；给它一个 `{...process.env, ...}` 就白做了。
 * - **`detached: false`（默认）。** 子进程跟着我们的进程组走，API 进程被 kill 时它不会活下来。
 */
import { spawn } from "node:child_process";

import type { McpChildProcessLike, McpServerSpawn } from "./session.js";

/**
 * 真实的 spawn。`cwd` 为空时落到 API 进程的工作目录——这是**如实的现状**，不是安全边界：
 * 阶段 0 的 MCP 服务器就是一个由管理员显式启动的第三方进程，以 API 进程的用户身份运行
 * （沙箱包裹是设计稿 4.4 第 4 条点名的阶段 1 工包）。管理员想收窄它看得见的目录，
 * 现在的手段是显式填 `cwd`。
 */
export const spawnMcpServerProcess: McpServerSpawn = (input) =>
  spawn(input.command, input.args, {
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    env: input.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  }) as unknown as McpChildProcessLike;
