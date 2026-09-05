/**
 * 插件宿主子进程的生命周期与调用口（R24-P 阶段 0，方案 B' 的主进程那一半）。
 *
 * 职责边界写死在这里：**宿主提供能力实现，本文件之外的既有链路提供授权**。
 * 翻出来的 ToolSpec 走 `packages/tools` 的注册表，于是自动继承 canUse 双检、
 * 副作用工具的快照门、human-reserved 拦截与审批；这里只负责
 *   懒启动 / 握手 / 超时 / 崩溃隔离 / 按需重启（有上限）/ 优雅关闭 / 每次调用落审计。
 *
 * 崩溃隔离的口径（报告 6.4）：子进程挂了 → 在飞调用返回**工具错误**而不是抛异常，
 * 这次 run 照常往下走；重启超过上限就把整个插件面标为不可用，后续 run 直接没有插件工具。
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildPluginHostEnv,
  createFrameDecoder,
  encodeFrame,
  parsePluginPaths,
  toPluginToolSpecs,
  PLUGIN_HOST_PROTOCOL_VERSION,
  type CallToolResult,
  type ListToolsResult,
  type PluginHostRequest,
  type PluginHostResponse,
  type PluginLoadReport,
  type PluginToolDescriptor
} from "@workhub/plugin-host";
import { errorToolResult, okToolResult, type AnyToolSpec, type ToolResult } from "@workhub/tools";

import { getDefaultStructuredLogger } from "../logging.js";
import { getDefaultAuditStores } from "./audit-stores.js";
import type { AuditLogRepository } from "@workhub/db";

/** 单次插件工具调用的默认超时。插件可在 defineTool 里声明更短的，取两者较小值。 */
export const PLUGIN_TOOL_DEFAULT_TIMEOUT_MS = 30_000;
/** 握手（启动 + list_tools）超时。装不上就别拖着 run。 */
export const PLUGIN_HOST_HANDSHAKE_TIMEOUT_MS = 20_000;
/** 重启窗口与窗口内上限（报告 6.4：5 分钟 3 次）。 */
export const PLUGIN_HOST_RESTART_WINDOW_MS = 5 * 60_000;
export const PLUGIN_HOST_RESTART_LIMIT = 3;
/** 审计 detail 里参数/结果摘要的长度上限——审计表不是日志表。 */
const AUDIT_SUMMARY_MAX_CHARS = 400;

export type PluginHostSpawn = (input: {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
}) => ChildProcessWithoutNullStreams;

export type PluginHostClientOptions = {
  /** 插件本地路径清单。不传则读 `WORKHUB_PLUGIN_PATHS`。 */
  pluginPaths?: string[];
  /** 宿主入口（`packages/plugin-host/src/host.ts`）。不传则从包导出解析。 */
  hostEntryPath?: string;
  /** 子进程工作目录，默认仓库根。 */
  cwd?: string;
  /** 注入点：测试里换成假 spawn。 */
  spawnProcess?: PluginHostSpawn;
  /** 审计写入口；`false` 表示不写（单测/离线工具）。 */
  auditLogs?: Pick<AuditLogRepository, "createAuditLog"> | false;
  callTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  now?: () => Date;
};

export type PluginToolCallAudit = {
  workspaceId?: string;
  actorId?: string;
  runId?: string;
  workItemId?: string;
};

type Pending = {
  resolve: (value: ListToolsResult | CallToolResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

function repoRootFromHere() {
  // apps/api/src/services/plugin-host-client.ts → 仓库根
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
}

/**
 * `--import tsx`：`packages/*` 的 exports 直接指向 `.ts` 源码（全仓无 JS 产物，见报告 3.14），
 * 所以宿主子进程也得带 tsx 起。显式解析出 tsx 的路径而不是靠 cwd 里的裸 specifier——
 * 子进程 env 是白名单组装的，没有 NODE_PATH 之类的兜底。
 */
function resolveTsxImportSpecifier(): string {
  try {
    const require = createRequire(import.meta.url);
    return pathToFileURL(require.resolve("tsx")).href;
  } catch {
    return "tsx";
  }
}

function resolveHostEntryPath(): string {
  try {
    return fileURLToPath(import.meta.resolve("@workhub/plugin-host/host"));
  } catch {
    return path.join(repoRootFromHere(), "packages", "plugin-host", "src", "host.ts");
  }
}

function summarize(value: unknown) {
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = JSON.stringify(value) ?? String(value);
    } catch {
      text = String(value);
    }
  }
  return text.length > AUDIT_SUMMARY_MAX_CHARS ? `${text.slice(0, AUDIT_SUMMARY_MAX_CHARS)}…` : text;
}

export type PluginHostClient = {
  /** 插件工具的 WorkHub ToolSpec 列表；宿主起不来或没配插件时返回空数组（不抛）。 */
  toolSpecs: (audit?: PluginToolCallAudit) => Promise<AnyToolSpec[]>;
  /** 已加载插件的体检报告（含失败原因），给日志与阶段 1 的设置页用。 */
  loadReports: () => Promise<PluginLoadReport[]>;
  /** 当前是否可用（崩溃超限后为 false）。 */
  available: () => boolean;
  /** 优雅关闭：关 stdin 让子进程自退，超时再 SIGTERM。 */
  close: () => Promise<void>;
};

export function createPluginHostClient(options: PluginHostClientOptions = {}): PluginHostClient {
  const logger = getDefaultStructuredLogger();
  const cwd = options.cwd ?? repoRootFromHere();
  const callTimeoutMs = options.callTimeoutMs ?? PLUGIN_TOOL_DEFAULT_TIMEOUT_MS;
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? PLUGIN_HOST_HANDSHAKE_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());
  const spawnProcess: PluginHostSpawn =
    options.spawnProcess ??
    ((input) =>
      spawn(input.command, input.args, {
        cwd: input.cwd,
        env: input.env,
        stdio: ["pipe", "pipe", "pipe"]
      }) as ChildProcessWithoutNullStreams);

  let pluginPaths: string[];
  try {
    pluginPaths = options.pluginPaths ?? parsePluginPaths(process.env.WORKHUB_PLUGIN_PATHS);
  } catch (error) {
    // 配错了（写了 npm 包名/URL）不该让 API 起不来——记一条，然后当作没配插件。
    logger.warn("plugin_host_paths_invalid", { error });
    pluginPaths = [];
  }

  let child: ChildProcessWithoutNullStreams | undefined;
  let starting: Promise<ListToolsResult> | undefined;
  let listed: ListToolsResult | undefined;
  let disabledReason: string | undefined;
  let closed = false;
  let nextRequestId = 1;
  const pending = new Map<number, Pending>();
  const restartTimestamps: number[] = [];

  function failAllPending(message: string) {
    for (const [, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(message));
    }
    pending.clear();
  }

  function disable(reason: string) {
    disabledReason = reason;
    logger.warn("plugin_host_disabled", { reason });
  }

  function onExit(code: number | null, signal: NodeJS.Signals | null) {
    child = undefined;
    starting = undefined;
    listed = undefined;
    failAllPending("插件宿主已退出，这次调用没完成。");
    if (closed) {
      return;
    }
    const at = Date.now();
    restartTimestamps.push(at);
    while (restartTimestamps.length > 0 && at - restartTimestamps[0]! > PLUGIN_HOST_RESTART_WINDOW_MS) {
      restartTimestamps.shift();
    }
    logger.warn("plugin_host_exited", { code, signal, restarts_in_window: restartTimestamps.length });
    if (restartTimestamps.length > PLUGIN_HOST_RESTART_LIMIT) {
      disable(`插件宿主在 ${PLUGIN_HOST_RESTART_WINDOW_MS / 60_000} 分钟内重启超过 ${PLUGIN_HOST_RESTART_LIMIT} 次`);
    }
  }

  function send(request: PluginHostRequest, timeoutMs: number) {
    return new Promise<ListToolsResult | CallToolResult>((resolve, reject) => {
      const live = child;
      if (!live || !live.stdin.writable) {
        reject(new Error("插件宿主没有在运行。"));
        return;
      }
      const timer = setTimeout(() => {
        pending.delete(request.id);
        reject(new Error(`插件调用超时（${timeoutMs}ms）。`));
      }, timeoutMs);
      timer.unref?.();
      pending.set(request.id, { resolve, reject, timer });
      live.stdin.write(encodeFrame(request), (error) => {
        if (error) {
          const entry = pending.get(request.id);
          if (entry) {
            clearTimeout(entry.timer);
            pending.delete(request.id);
            entry.reject(error);
          }
        }
      });
    });
  }

  async function ensureStarted(): Promise<ListToolsResult> {
    if (disabledReason) {
      throw new Error(disabledReason);
    }
    if (listed) {
      return listed;
    }
    if (starting) {
      return starting;
    }
    starting = (async () => {
      const hostEntryPath = options.hostEntryPath ?? resolveHostEntryPath();
      const env = buildPluginHostEnv({ source: process.env, pluginPaths });
      const proc = spawnProcess({
        command: process.execPath,
        args: ["--import", resolveTsxImportSpecifier(), hostEntryPath],
        env,
        cwd
      });
      child = proc;
      const decoder = createFrameDecoder<PluginHostResponse>();
      proc.stdout.setEncoding("utf8");
      proc.stdout.on("data", (chunk: string) => {
        for (const response of decoder.push(chunk)) {
          const entry = pending.get(response.id);
          if (!entry) {
            continue;
          }
          clearTimeout(entry.timer);
          pending.delete(response.id);
          if (response.ok) {
            entry.resolve(response.result);
          } else {
            entry.reject(new Error(response.error.message));
          }
        }
      });
      proc.stderr.setEncoding("utf8");
      proc.stderr.on("data", (chunk: string) => {
        const text = chunk.trim();
        if (text.length > 0) {
          // 插件的 console.log 也被宿主改道到这里——当日志看，不当协议看。
          logger.warn("plugin_host_stderr", { text: summarize(text) });
        }
      });
      proc.on("error", (error) => {
        logger.warn("plugin_host_spawn_failed", { error });
        failAllPending("插件宿主启动失败。");
      });
      proc.on("exit", onExit);

      const result = (await send(
        { id: nextRequestId++, method: "list_tools" },
        handshakeTimeoutMs
      )) as ListToolsResult;
      if (result.protocolVersion !== PLUGIN_HOST_PROTOCOL_VERSION) {
        throw new Error(
          `插件宿主协议版本不匹配（期望 ${PLUGIN_HOST_PROTOCOL_VERSION}，收到 ${result.protocolVersion}）。`
        );
      }
      listed = result;
      for (const report of result.plugins) {
        if (report.ok) {
          logger.info("plugin_loaded", {
            plugin_id: report.pluginId,
            tools: report.toolCount,
            prompt_sections: report.promptSectionCount
          });
        } else {
          logger.warn("plugin_load_failed", { plugin_id: report.pluginId, path: report.path, error: report.error });
        }
      }
      return result;
    })().catch((error) => {
      starting = undefined;
      throw error;
    });
    return starting;
  }

  async function writeAudit(input: {
    descriptor: PluginToolDescriptor;
    audit: PluginToolCallAudit;
    ok: boolean;
    durationMs: number;
    args: unknown;
    summary: string;
  }) {
    if (options.auditLogs === false) {
      return;
    }
    const auditLogs = options.auditLogs ?? getDefaultAuditStores().auditLogs;
    try {
      await auditLogs.createAuditLog({
        // 插件工具是 AI 在一次 run 里调起来的，归 "ai"（与 agent-run 快照审计同口径）；
        // 没有 run 上下文（阶段 1 的人工试跑）才记 "system"。actorUserId 仍记发起人。
        actorKind: input.audit.runId ? ("ai" as const) : ("system" as const),
        ...(input.audit.actorId ? { actorUserId: input.audit.actorId } : {}),
        ...(input.audit.workspaceId ? { workspaceId: input.audit.workspaceId } : {}),
        actorNickname: "plugin-host",
        entityType: "plugin_invocation",
        entityId: `${input.descriptor.pluginId}:${input.descriptor.toolName}`,
        action: "plugin.tool.called",
        detailJson: {
          plugin_id: input.descriptor.pluginId,
          tool_name: input.descriptor.toolName,
          tool_id: input.descriptor.toolId,
          ok: input.ok,
          duration_ms: input.durationMs,
          args_summary: summarize(input.args),
          result_summary: input.summary,
          capability: `plugin:${input.descriptor.pluginId}:external_effect`,
          called_at: now().toISOString(),
          ...(input.audit.runId ? { agent_run_id: input.audit.runId } : {}),
          ...(input.audit.workItemId ? { work_item_id: input.audit.workItemId } : {})
        }
      });
    } catch (error) {
      // 审计写失败不该把一次成功的工具调用变成失败（与 agent-runner 既有 fail-open 口径一致），
      // 但必须留下结构化日志，否则「没有审计」和「没有调用」分不清。
      logger.warn("plugin_tool_audit_write_failed", { tool_id: input.descriptor.toolId, error });
    }
  }

  async function callTool(
    descriptor: PluginToolDescriptor,
    args: Record<string, unknown>,
    audit: PluginToolCallAudit
  ): Promise<ToolResult> {
    const startedAt = Date.now();
    const timeoutMs = descriptor.timeoutMs ? Math.min(descriptor.timeoutMs, callTimeoutMs) : callTimeoutMs;
    try {
      await ensureStarted();
      const result = (await send(
        { id: nextRequestId++, method: "call_tool", params: { toolId: descriptor.toolId, input: args } },
        timeoutMs
      )) as CallToolResult;
      await writeAudit({
        descriptor,
        audit,
        ok: true,
        durationMs: result.durationMs,
        args,
        summary: summarize(result.content)
      });
      return okToolResult(result.content, { data: result.data });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await writeAudit({
        descriptor,
        audit,
        ok: false,
        durationMs: Date.now() - startedAt,
        args,
        summary: summarize(message)
      });
      return errorToolResult(`插件工具 ${descriptor.toolName} 没能完成：${message}`);
    }
  }

  return {
    async toolSpecs(audit: PluginToolCallAudit = {}) {
      if (pluginPaths.length === 0 || disabledReason) {
        return [];
      }
      try {
        const result = await ensureStarted();
        return toPluginToolSpecs(result.tools, ({ descriptor, args, ctx }) =>
          callTool(descriptor, args, {
            ...audit,
            ...(ctx.actorId ? { actorId: ctx.actorId } : {}),
            ...(ctx.runId ? { runId: ctx.runId } : {}),
            ...(ctx.workItemId ? { workItemId: ctx.workItemId } : {})
          })
        );
      } catch (error) {
        // 宿主起不来不该让 run 起不来——这次 run 就是没有插件工具。
        logger.warn("plugin_host_unavailable", { error });
        return [];
      }
    },
    async loadReports() {
      if (pluginPaths.length === 0 || disabledReason) {
        return [];
      }
      try {
        return (await ensureStarted()).plugins;
      } catch {
        return [];
      }
    },
    available() {
      return !disabledReason && pluginPaths.length > 0;
    },
    async close() {
      closed = true;
      const live = child;
      if (!live) {
        return;
      }
      await new Promise<void>((resolve) => {
        const kill = setTimeout(() => {
          live.kill("SIGTERM");
          resolve();
        }, 2000);
        kill.unref?.();
        live.once("exit", () => {
          clearTimeout(kill);
          resolve();
        });
        live.stdin.end();
      });
      failAllPending("插件宿主已关闭。");
      child = undefined;
      starting = undefined;
      listed = undefined;
    }
  };
}

let defaultClient: PluginHostClient | undefined;

/** 进程内单例：一个 API 进程只养一个插件宿主子进程。 */
export function getDefaultPluginHostClient() {
  defaultClient ??= createPluginHostClient();
  return defaultClient;
}

/** server.ts 收尾时调用；没起过就是空操作。 */
export async function closeDefaultPluginHostClient() {
  const live = defaultClient;
  defaultClient = undefined;
  await live?.close();
}
