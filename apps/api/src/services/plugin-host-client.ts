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
 *
 * R24-P 阶段 1 加的两件事：
 * 1. **插件清单来自 DB**（`plugins` 表里该工作区启用的行），`WORKHUB_PLUGIN_PATHS` 降级为
 *    「开发/引导来源」，两者合并去重。DB 来源是**显式接线**的（`usePluginRegistryPathSource()`，
 *    只在 `server.ts` 真起进程时调）——没接线的场景（全部既有单测）行为逐字节不变，不碰 PG。
 * 2. **按工作区分宿主**。插件是工作区级治理对象，A 工作区装的插件不该出现在 B 工作区的 run 里，
 *    所以宿主子进程按工作区各起一个（同一份路径集合的工作区各自一个进程，不共用——共用会让
 *    「停用」的热重载互相牵连）。活跃宿主数有上限，超了按最久未用关掉（LRU），
 *    下次用到时重新握手。单工作区部署（常态）永远只有一个子进程。
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
import { getDefaultPluginRepository } from "./plugin-stores.js";
import type { AuditLogRepository, PluginRepository } from "@workhub/db";

/** 单次插件工具调用的默认超时。插件可在 defineTool 里声明更短的，取两者较小值。 */
export const PLUGIN_TOOL_DEFAULT_TIMEOUT_MS = 30_000;
/** 握手（启动 + list_tools）超时。装不上就别拖着 run。 */
export const PLUGIN_HOST_HANDSHAKE_TIMEOUT_MS = 20_000;
/** 重启窗口与窗口内上限（报告 6.4：5 分钟 3 次）。 */
export const PLUGIN_HOST_RESTART_WINDOW_MS = 5 * 60_000;
export const PLUGIN_HOST_RESTART_LIMIT = 3;
/**
 * 同时活着的宿主子进程上限（按工作区各一个）。超了关最久未用的那个——多租户部署里
 * 插件面不该无上限地长子进程。单工作区部署永远只用到 1。
 */
export const PLUGIN_HOST_MAX_LIVE_PROCESSES = 4;
/** 审计 detail 里参数/结果摘要的长度上限——审计表不是日志表。 */
const AUDIT_SUMMARY_MAX_CHARS = 400;

export type PluginHostSpawn = (input: {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
}) => ChildProcessWithoutNullStreams;

/**
 * 「这个工作区该加载哪些插件目录」。默认只有 `WORKHUB_PLUGIN_PATHS`；
 * `usePluginRegistryPathSource()` 之后是「引导路径 ∪ DB 里启用的行」。
 */
export type PluginPathSource = (workspaceId: string | undefined) => Promise<string[]> | string[];

export type PluginHostClientOptions = {
  /** 引导用的插件本地路径清单。不传则读 `WORKHUB_PLUGIN_PATHS`。 */
  pluginPaths?: string[];
  /** 按工作区解析插件路径（DB 清单）；不传则只用上面的引导路径。 */
  pluginPathSource?: PluginPathSource;
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
  maxLiveProcesses?: number;
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

/** 合并两个来源并去重，保持先后顺序（引导路径在前，便于开发时覆盖同名插件的加载次序）。 */
function dedupePaths(...groups: string[][]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const group of groups) {
    for (const entry of group) {
      const trimmed = entry.trim();
      if (trimmed.length === 0 || seen.has(trimmed)) {
        continue;
      }
      seen.add(trimmed);
      merged.push(trimmed);
    }
  }
  return merged;
}

/**
 * DB 清单来源：某工作区里 enabled 且未被停用的行。**加载失败的行照样带上**——
 * 「上次装不上」不等于「这次也装不上」（换了宿主版本/插件目录被修好），是否重试的判断
 * 留给宿主自己每次握手时如实报告，而不是在这里替用户永久放弃。
 */
export function createRegistryPluginPathSource(deps: {
  bootstrapPaths: string[];
  repository?: Pick<PluginRepository, "listEnabledForWorkspace">;
}): PluginPathSource {
  return async (workspaceId) => {
    if (!workspaceId) {
      return deps.bootstrapPaths;
    }
    const repository = deps.repository ?? getDefaultPluginRepository();
    const rows = await repository.listEnabledForWorkspace(workspaceId);
    return dedupePaths(deps.bootstrapPaths, rows.map((row) => row.sourcePath));
  };
}

export type PluginHostClient = {
  /** 插件工具的 WorkHub ToolSpec 列表；宿主起不来或没配插件时返回空数组（不抛）。 */
  toolSpecs: (audit?: PluginToolCallAudit) => Promise<AnyToolSpec[]>;
  /** 已加载插件的体检报告（含失败原因），给设置页与日志用。 */
  loadReports: (workspaceId?: string) => Promise<PluginLoadReport[]>;
  /**
   * 热重载：关掉该工作区的宿主，下次用到时按最新清单重新握手并如实回报加载结果。
   * 启停/安装/移除后调用；返回的就是重新握手后的报告（宿主起不来则为空数组，不抛）。
   */
  reload: (workspaceId?: string) => Promise<PluginLoadReport[]>;
  /** 来自 `WORKHUB_PLUGIN_PATHS` 的引导路径条数（这些不在清单表里，但确实会被加载）。 */
  bootstrapPathCount: () => number;
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
  const maxLiveProcesses = options.maxLiveProcesses ?? PLUGIN_HOST_MAX_LIVE_PROCESSES;
  const now = options.now ?? (() => new Date());
  const spawnProcess: PluginHostSpawn =
    options.spawnProcess ??
    ((input) =>
      spawn(input.command, input.args, {
        cwd: input.cwd,
        env: input.env,
        stdio: ["pipe", "pipe", "pipe"]
      }) as ChildProcessWithoutNullStreams);

  let bootstrapPaths: string[];
  try {
    bootstrapPaths = options.pluginPaths ?? parsePluginPaths(process.env.WORKHUB_PLUGIN_PATHS);
  } catch (error) {
    // 配错了（写了 npm 包名/URL）不该让 API 起不来——记一条，然后当作没配插件。
    logger.warn("plugin_host_paths_invalid", { error });
    bootstrapPaths = [];
  }
  const pathSource = options.pluginPathSource;

  /** 崩溃超限是**整个插件面**的熔断（报告 6.4），不是某个工作区的——不区分是谁把它烧掉的。 */
  let disabledReason: string | undefined;
  let closed = false;

  type HostProcess = {
    paths: string[];
    lastUsedAt: number;
    ensureStarted: () => Promise<ListToolsResult>;
    call: (toolId: string, input: unknown, timeoutMs: number) => Promise<CallToolResult>;
    close: () => Promise<void>;
  };

  /** 一个宿主子进程的全部状态。按工作区各建一个，互不共享 pending/重启计数。 */
  function createHostProcess(paths: string[]): HostProcess {
    let child: ChildProcessWithoutNullStreams | undefined;
    let starting: Promise<ListToolsResult> | undefined;
    let listed: ListToolsResult | undefined;
    let processClosed = false;
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

    function onExit(code: number | null, signal: NodeJS.Signals | null) {
      child = undefined;
      starting = undefined;
      listed = undefined;
      failAllPending("插件宿主已退出，这次调用没完成。");
      if (processClosed || closed) {
        return;
      }
      const at = Date.now();
      restartTimestamps.push(at);
      while (restartTimestamps.length > 0 && at - restartTimestamps[0]! > PLUGIN_HOST_RESTART_WINDOW_MS) {
        restartTimestamps.shift();
      }
      logger.warn("plugin_host_exited", { code, signal, restarts_in_window: restartTimestamps.length });
      if (restartTimestamps.length > PLUGIN_HOST_RESTART_LIMIT) {
        disabledReason = `插件宿主在 ${PLUGIN_HOST_RESTART_WINDOW_MS / 60_000} 分钟内重启超过 ${PLUGIN_HOST_RESTART_LIMIT} 次`;
        logger.warn("plugin_host_disabled", { reason: disabledReason });
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
        const env = buildPluginHostEnv({ source: process.env, pluginPaths: paths });
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

    return {
      paths,
      lastUsedAt: Date.now(),
      ensureStarted,
      async call(toolId, input, timeoutMs) {
        await ensureStarted();
        return (await send(
          { id: nextRequestId++, method: "call_tool", params: { toolId, input } },
          timeoutMs
        )) as CallToolResult;
      },
      async close() {
        processClosed = true;
        const live = child;
        if (live) {
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
        }
        failAllPending("插件宿主已关闭。");
        child = undefined;
        starting = undefined;
        listed = undefined;
      }
    };
  }

  /** 按工作区（无工作区上下文时用空串）各一个宿主。 */
  const hosts = new Map<string, HostProcess>();

  function scopeKeyOf(workspaceId: string | undefined) {
    return workspaceId ?? "";
  }

  async function resolvePaths(workspaceId: string | undefined): Promise<string[]> {
    if (!pathSource) {
      return bootstrapPaths;
    }
    try {
      return dedupePaths(await pathSource(workspaceId));
    } catch (error) {
      // 清单读不出来（PG 抖动）不该让 run 失去全部插件工具之外还炸掉——退回引导路径。
      logger.warn("plugin_registry_unavailable", { error });
      return bootstrapPaths;
    }
  }

  async function evictIfNeeded() {
    while (hosts.size > maxLiveProcesses) {
      let oldestKey: string | undefined;
      let oldestAt = Number.POSITIVE_INFINITY;
      for (const [key, host] of hosts) {
        if (host.lastUsedAt < oldestAt) {
          oldestAt = host.lastUsedAt;
          oldestKey = key;
        }
      }
      if (oldestKey === undefined) {
        return;
      }
      const evicted = hosts.get(oldestKey);
      hosts.delete(oldestKey);
      logger.info("plugin_host_evicted", { scope: oldestKey, live: hosts.size });
      await evicted?.close();
    }
  }

  /** 拿到该工作区当前该用的宿主；清单变了（装了新插件/停用了一个）就换一个新进程。 */
  async function hostFor(workspaceId: string | undefined): Promise<{ host: HostProcess; paths: string[] } | undefined> {
    if (closed || disabledReason) {
      return undefined;
    }
    const paths = await resolvePaths(workspaceId);
    if (paths.length === 0) {
      // 这个工作区一个插件都没装：不 spawn 任何子进程，也顺手把可能还开着的旧宿主收掉。
      const stale = hosts.get(scopeKeyOf(workspaceId));
      if (stale) {
        hosts.delete(scopeKeyOf(workspaceId));
        await stale.close();
      }
      return undefined;
    }
    const key = scopeKeyOf(workspaceId);
    const existing = hosts.get(key);
    if (existing && existing.paths.length === paths.length && existing.paths.every((entry, index) => entry === paths[index])) {
      existing.lastUsedAt = Date.now();
      return { host: existing, paths };
    }
    if (existing) {
      hosts.delete(key);
      await existing.close();
    }
    const created = createHostProcess(paths);
    hosts.set(key, created);
    await evictIfNeeded();
    return { host: created, paths };
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
      const resolved = await hostFor(audit.workspaceId);
      if (!resolved) {
        throw new Error(disabledReason ?? "插件宿主没有在运行。");
      }
      const result = await resolved.host.call(descriptor.toolId, args, timeoutMs);
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

  async function listFor(workspaceId: string | undefined): Promise<ListToolsResult | undefined> {
    const resolved = await hostFor(workspaceId);
    if (!resolved) {
      return undefined;
    }
    return resolved.host.ensureStarted();
  }

  return {
    async toolSpecs(audit: PluginToolCallAudit = {}) {
      try {
        const result = await listFor(audit.workspaceId);
        if (!result) {
          return [];
        }
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
    async loadReports(workspaceId) {
      try {
        return (await listFor(workspaceId))?.plugins ?? [];
      } catch {
        return [];
      }
    },
    async reload(workspaceId) {
      const key = scopeKeyOf(workspaceId);
      const live = hosts.get(key);
      if (live) {
        hosts.delete(key);
        await live.close();
      }
      // 熔断过的插件面在管理员显式动过清单之后重新给一次机会——不然「装了个坏插件把宿主烧了」
      // 之后，即使把它停用了也永远起不来，只能重启整个 API。
      disabledReason = undefined;
      return this.loadReports(workspaceId);
    },
    bootstrapPathCount() {
      return bootstrapPaths.length;
    },
    available() {
      return !disabledReason && (bootstrapPaths.length > 0 || Boolean(pathSource));
    },
    async close() {
      closed = true;
      const live = [...hosts.values()];
      hosts.clear();
      await Promise.all(live.map((host) => host.close()));
    }
  };
}

let defaultClient: PluginHostClient | undefined;
let defaultPathSource: PluginPathSource | undefined;

/**
 * 让默认宿主客户端从 `plugins` 表读清单。**只在 `server.ts` 真起进程时调**——
 * 单测/离线工具不接线就只认 `WORKHUB_PLUGIN_PATHS`，一次 PG 查询都不会发生。
 */
export function usePluginRegistryPathSource(
  repository?: Pick<PluginRepository, "listEnabledForWorkspace">
) {
  const bootstrapPaths = (() => {
    try {
      return parsePluginPaths(process.env.WORKHUB_PLUGIN_PATHS);
    } catch {
      return [];
    }
  })();
  defaultPathSource = createRegistryPluginPathSource({
    bootstrapPaths,
    ...(repository ? { repository } : {})
  });
  // 已经建过单例就重建：接线发生在启动早期，此时不会有在飞调用。
  defaultClient = undefined;
}

/** 进程内单例：一个 API 进程只养一套插件宿主子进程（按工作区分）。 */
export function getDefaultPluginHostClient() {
  defaultClient ??= createPluginHostClient(defaultPathSource ? { pluginPathSource: defaultPathSource } : {});
  return defaultClient;
}

/** server.ts 收尾时调用；没起过就是空操作。 */
export async function closeDefaultPluginHostClient() {
  const live = defaultClient;
  defaultClient = undefined;
  await live?.close();
}
