/**
 * 插件宿主子进程的生命周期与调用口（R24-P 阶段 0，方案 B' 的主进程那一半）。
 *
 * 职责边界写死在这里：**宿主提供能力实现，本文件之外的既有链路提供授权**。
 * 翻出来的 ToolSpec 走 `packages/tools` 的注册表，于是自动继承 canUse 双检、
 * 副作用工具的快照门、human-reserved 拦截与审批；这里只负责
 *   懒启动 / 握手 / 超时 / 崩溃隔离 / 按需重启（有上限）/ 优雅关闭 / 每次调用落审计。
 *
 * 崩溃隔离的口径（报告 6.4 + R26 X）：子进程挂了 → 在飞调用返回**工具错误**而不是抛异常，
 * 这次 run 照常往下走；反复崩溃则熔断。熔断**按插件**（R26 X）——一个坏插件只关自己，
 * 同工作区的其它插件照常上线；只有归因不到某一个插件的崩溃才落回整个插件面的熔断。
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
  pluginToolMinScope,
  resolvePluginToolSideEffect,
  toPluginToolSpecs,
  PLUGIN_HOST_PROTOCOL_VERSION,
  type PluginTrustLevel,
  type CallToolResult,
  type ListToolsResult,
  type PluginHostRequest,
  type PluginHostResponse,
  type PluginLoadReport,
  type PluginToolDescriptor
} from "@workhub/plugin-host";
import {
  errorToolResult,
  okToolResult,
  sanitizeModelFacingText,
  type AnyToolSpec,
  type ToolResult
} from "@workhub/tools";

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
/**
 * 插件抛出的错误消息进模型可见通道前的长度上限。与 `translate.ts` 的
 * `PLUGIN_RESULT_MAX_CHARS` 同一档：正常返回值和抛出的错误是同一类第三方数据，
 * 走的也是同一条「进 ToolResult.content → 被工人抄进 outputs/ → 被装进围栏」的路。
 */
const PLUGIN_ERROR_MAX_CHARS = 32 * 1024;

export type PluginHostSpawn = (input: {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
}) => ChildProcessWithoutNullStreams;

/** 清单里的一条：一个插件目录 + 管理员对它的信任断言。 */
export type PluginRegistryEntry = { path: string; trustLevel: PluginTrustLevel };

/** 清单来源允许给的形状。裸路径 = 没人表过态 = `external_effect`。 */
export type PluginRegistryInput = readonly (string | PluginRegistryEntry)[];

/**
 * 「这个工作区该加载哪些插件目录、各自被断言成什么」。默认只有 `WORKHUB_PLUGIN_PATHS`；
 * `usePluginRegistryPathSource()` 之后是「引导路径 ∪ DB 里启用的行」。
 *
 * 允许直接给字符串是为了调用方省事：**裸路径一律按 `external_effect`**——
 * 环境变量里的引导路径没有任何人对它表过态，按最高风险跑。
 */
export type PluginPathSource = (
  workspaceId: string | undefined
) => Promise<PluginRegistryInput> | PluginRegistryInput;

/**
 * 熔断落库口：一个插件被单独熔断时把它写回 `plugins` 表（status='crashed'）。
 * 与 `pluginPathSource` 同款纪律——**不接线就一次 PG 都不碰**，进程内的隔离照样生效。
 */
export type PluginCrashSink = (input: {
  workspaceId: string;
  sourcePath: string;
  pluginId?: string;
  reason: string;
  at: Date;
}) => Promise<void> | void;

export type PluginHostClientOptions = {
  /** 引导用的插件本地路径清单。不传则读 `WORKHUB_PLUGIN_PATHS`。 */
  pluginPaths?: string[];
  /** 按工作区解析插件路径（DB 清单）；不传则只用上面的引导路径。 */
  pluginPathSource?: PluginPathSource;
  /** 单插件熔断落库口；不传则只在进程内隔离（不碰 PG）。 */
  pluginCrashSink?: PluginCrashSink;
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

/**
 * 合并两个来源并去重，保持先后顺序（引导路径在前，便于开发时覆盖同名插件的加载次序）。
 * 同一个目录出现两次时**先到的那一条赢**，包括它的信任级别——引导路径在前，所以
 * 「同一个目录既在环境变量里又在表里」时按环境变量那条的 `external_effect` 算，
 * 取两者中更保守的那一个不需要额外判断（引导路径永远是最保守的那一档）。
 */
function dedupeEntries(...groups: PluginRegistryInput[]): PluginRegistryEntry[] {
  const seen = new Set<string>();
  const merged: PluginRegistryEntry[] = [];
  for (const group of groups) {
    for (const entry of group) {
      const normalized: PluginRegistryEntry =
        typeof entry === "string" ? { path: entry.trim(), trustLevel: "external_effect" } : { ...entry, path: entry.path.trim() };
      if (normalized.path.length === 0 || seen.has(normalized.path)) {
        continue;
      }
      seen.add(normalized.path);
      merged.push(normalized);
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
      return dedupeEntries(deps.bootstrapPaths);
    }
    const repository = deps.repository ?? getDefaultPluginRepository();
    const rows = await repository.listEnabledForWorkspace(workspaceId);
    return dedupeEntries(
      deps.bootstrapPaths,
      rows.map((row) => ({ path: row.sourcePath, trustLevel: row.trustLevel }))
    );
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
  /** 当前是否可用（整插件面熔断后为 false；单个插件被熔断不影响这一条）。 */
  available: () => boolean;
  /** 被单独熔断的插件目录——设置页/日志用，也是单测唯一需要的观测口。 */
  quarantinedPaths: () => string[];
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

  /**
   * **归因不到某一个插件**时才落到这一层：整个插件面的熔断（报告 6.4 的原口径）。
   * 能归因的崩溃走下面按插件的 `quarantine`，一个坏插件不再连累同工作区的其它插件。
   */
  let disabledReason: string | undefined;
  let closed = false;

  /**
   * 被单独熔断的插件（键是它的目录绝对路径）。
   *
   * 为什么按路径而不是按包名：`plugins` 表的唯一索引就是 `(workspace_id, source_path)`，
   * 两个不同目录完全可以是同一个包名的两个版本；路径是这一层唯一能对回一行记录的键。
   * 包名（`pluginId`）只用来说人话与写日志。
   */
  const quarantine = new Map<string, { pluginId?: string; reason: string; at: Date }>();

  type HostProcess = {
    entries: PluginRegistryEntry[];
    lastUsedAt: number;
    ensureStarted: () => Promise<ListToolsResult>;
    call: (toolId: string, input: unknown, timeoutMs: number) => Promise<CallToolResult>;
    close: () => Promise<void>;
  };

  /** 一个宿主子进程的全部状态。按工作区各建一个，互不共享 pending/重启计数。 */
  function createHostProcess(entries: PluginRegistryEntry[], workspaceId: string | undefined): HostProcess {
    const paths = entries.map((entry) => entry.path);
    let child: ChildProcessWithoutNullStreams | undefined;
    let starting: Promise<ListToolsResult> | undefined;
    let listed: ListToolsResult | undefined;
    let processClosed = false;
    let nextRequestId = 1;
    const pending = new Map<number, Pending>();
    /** 在飞的 `call_tool` 各属于哪个插件目录——崩溃归因就靠这一份。 */
    const inFlightPaths = new Map<number, string>();
    /** 归因不到插件的崩溃时间戳（整插件面熔断的计数）。 */
    const unattributedRestarts: number[] = [];
    /** 按插件目录的崩溃时间戳。 */
    const restartsByPath = new Map<string, number[]>();

    function failAllPending(message: string) {
      for (const [, entry] of pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error(message));
      }
      pending.clear();
      inFlightPaths.clear();
    }

    /** 这条工具 id 属于哪个插件目录。握手报告给出 pluginId ↔ path，描述符给出 toolId ↔ pluginId。 */
    function pathOfTool(toolId: string): string | undefined {
      const descriptor = listed?.tools.find((tool) => tool.toolId === toolId);
      if (!descriptor) {
        return undefined;
      }
      return listed?.plugins.find((report) => report.pluginId === descriptor.pluginId)?.path;
    }

    function pluginIdOfPath(path: string): string | undefined {
      return listed?.plugins.find((report) => report.path === path)?.pluginId;
    }

    /** 窗口内计数并回答「超了没有」。共用一份滑动窗口逻辑，两个计数器口径必须一致。 */
    function recordRestart(timestamps: number[], at: number) {
      timestamps.push(at);
      while (timestamps.length > 0 && at - timestamps[0]! > PLUGIN_HOST_RESTART_WINDOW_MS) {
        timestamps.shift();
      }
      return timestamps.length > PLUGIN_HOST_RESTART_LIMIT;
    }

    /**
     * 把这次崩溃归因到某一个插件目录。两条判据，都不猜：
     *  1. 崩的时候只有一个插件的调用在飞——那就是它；
     *  2. 这个宿主本来就只装了一个插件——除了它没有别的可能。
     * 其余（多个插件的调用同时在飞、或者根本没有在飞调用比如握手期崩溃）**不归因**，
     * 落回整个插件面的熔断。宁可保守，也不要把锅扣在一个无辜插件头上。
     */
    function attributeCrash(): string | undefined {
      const suspects = new Set(inFlightPaths.values());
      if (suspects.size === 1) {
        return [...suspects][0];
      }
      if (suspects.size === 0 && paths.length === 1) {
        return paths[0];
      }
      return undefined;
    }

    function onExit(code: number | null, signal: NodeJS.Signals | null) {
      const suspect = processClosed || closed ? undefined : attributeCrash();
      const suspectPluginId = suspect ? pluginIdOfPath(suspect) : undefined;
      child = undefined;
      starting = undefined;
      const wasListed = listed;
      listed = undefined;
      failAllPending("插件宿主已退出，这次调用没完成。");
      if (processClosed || closed) {
        return;
      }
      const at = Date.now();
      if (suspect) {
        const timestamps = restartsByPath.get(suspect) ?? [];
        restartsByPath.set(suspect, timestamps);
        const over = recordRestart(timestamps, at);
        logger.warn("plugin_host_exited", {
          code,
          signal,
          plugin_path: suspect,
          ...(suspectPluginId ? { plugin_id: suspectPluginId } : {}),
          restarts_in_window: timestamps.length
        });
        if (over) {
          const reason = `插件在 ${PLUGIN_HOST_RESTART_WINDOW_MS / 60_000} 分钟内把宿主弄崩超过 ${PLUGIN_HOST_RESTART_LIMIT} 次`;
          quarantine.set(suspect, {
            ...(suspectPluginId ? { pluginId: suspectPluginId } : {}),
            reason,
            at: now()
          });
          logger.warn("plugin_quarantined", {
            plugin_path: suspect,
            ...(suspectPluginId ? { plugin_id: suspectPluginId } : {}),
            reason
          });
          void reportCrash({
            workspaceId,
            sourcePath: suspect,
            ...(suspectPluginId ? { pluginId: suspectPluginId } : {}),
            reason
          });
        }
        return;
      }
      const over = recordRestart(unattributedRestarts, at);
      logger.warn("plugin_host_exited", {
        code,
        signal,
        restarts_in_window: unattributedRestarts.length,
        plugin_count: wasListed?.plugins.length ?? paths.length
      });
      if (over) {
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
          inFlightPaths.delete(request.id);
          reject(new Error(`插件调用超时（${timeoutMs}ms）。`));
        }, timeoutMs);
        timer.unref?.();
        pending.set(request.id, { resolve, reject, timer });
        if (request.method === "call_tool") {
          const owner = pathOfTool(request.params.toolId);
          if (owner) {
            inFlightPaths.set(request.id, owner);
          }
        }
        live.stdin.write(encodeFrame(request), (error) => {
          if (error) {
            const entry = pending.get(request.id);
            if (entry) {
              clearTimeout(entry.timer);
              pending.delete(request.id);
              inFlightPaths.delete(request.id);
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
            inFlightPaths.delete(response.id);
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
      entries,
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

  /** 熔断掉的插件从清单里摘掉——它已经把宿主弄崩过，再带上只会一次次重演。 */
  function withoutQuarantined(entries: PluginRegistryEntry[]): PluginRegistryEntry[] {
    if (quarantine.size === 0) {
      return entries;
    }
    return entries.filter((entry) => !quarantine.has(entry.path));
  }

  async function resolveEntries(workspaceId: string | undefined): Promise<PluginRegistryEntry[]> {
    if (!pathSource) {
      return withoutQuarantined(dedupeEntries(bootstrapPaths));
    }
    try {
      return withoutQuarantined(dedupeEntries(await pathSource(workspaceId)));
    } catch (error) {
      // 清单读不出来（PG 抖动）不该让 run 失去全部插件工具之外还炸掉——退回引导路径。
      logger.warn("plugin_registry_unavailable", { error });
      return withoutQuarantined(dedupeEntries(bootstrapPaths));
    }
  }

  /** 熔断落库：接了 sink 才写，没接就只在进程内隔离（同 pluginPathSource 的「不接线不碰 PG」纪律）。 */
  async function reportCrash(input: {
    workspaceId: string | undefined;
    sourcePath: string;
    pluginId?: string;
    reason: string;
  }) {
    const sink = options.pluginCrashSink;
    if (!sink || !input.workspaceId) {
      return;
    }
    try {
      await sink({
        workspaceId: input.workspaceId,
        sourcePath: input.sourcePath,
        ...(input.pluginId ? { pluginId: input.pluginId } : {}),
        reason: input.reason,
        at: now()
      });
    } catch (error) {
      // 落库失败不该把「已经生效的进程内隔离」变成失败——但必须留日志，否则设置页会一直说它好着。
      logger.warn("plugin_crash_status_write_failed", { plugin_path: input.sourcePath, error });
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

  /**
   * 拿到该工作区当前该用的宿主；**目录清单**变了（装了新插件/停用了一个/某个被熔断了）就换一个新进程。
   * 只改信任级别不换进程：信任是主进程这一侧的分级参数，子进程加载的是同一批目录，
   * 为它重启一次会白白掐断在飞调用（`toolSpecs()` 每次都按最新 entries 重算分级）。
   */
  async function hostFor(
    workspaceId: string | undefined
  ): Promise<{ host: HostProcess; entries: PluginRegistryEntry[] } | undefined> {
    if (closed || disabledReason) {
      return undefined;
    }
    const entries = await resolveEntries(workspaceId);
    if (entries.length === 0) {
      // 这个工作区一个插件都没装（或者装的都被熔断了）：不 spawn 任何子进程，也顺手把旧宿主收掉。
      const stale = hosts.get(scopeKeyOf(workspaceId));
      if (stale) {
        hosts.delete(scopeKeyOf(workspaceId));
        await stale.close();
      }
      return undefined;
    }
    const key = scopeKeyOf(workspaceId);
    const existing = hosts.get(key);
    if (
      existing &&
      existing.entries.length === entries.length &&
      existing.entries.every((entry, index) => entry.path === entries[index]?.path)
    ) {
      existing.lastUsedAt = Date.now();
      // 信任级别可能变了，回给调用方的是最新的那一份。
      existing.entries = entries;
      return { host: existing, entries };
    }
    if (existing) {
      hosts.delete(key);
      await existing.close();
    }
    const created = createHostProcess(entries, workspaceId);
    hosts.set(key, created);
    await evictIfNeeded();
    return { host: created, entries };
  }

  async function writeAudit(input: {
    descriptor: PluginToolDescriptor;
    audit: PluginToolCallAudit;
    ok: boolean;
    durationMs: number;
    args: unknown;
    summary: string;
    trustLevel: PluginTrustLevel;
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
          // 与这次调用真正生效的分级同源（`to-tool-spec.ts` 的 pluginToolMinScope），
          // 不是一个写死的字符串——审计里的 capability 必须就是当时那一档。
          capability: pluginToolMinScope(
            input.descriptor.pluginId,
            resolvePluginToolSideEffect({
              trustLevel: input.trustLevel,
              selfReportedReadOnly: input.descriptor.selfReportedReadOnly
            })
          ),
          trust_level: input.trustLevel,
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
    audit: PluginToolCallAudit,
    trustLevel: PluginTrustLevel
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
        summary: summarize(result.content),
        trustLevel
      });
      return okToolResult(result.content, { data: result.data });
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      // 插件**抛错**这条路不经过 `translate.ts` 的 renderToolContent，但它同样把一段第三方文本
      // 送进模型可见通道（工具结果）。R26 M1b 的 Note 把这条列成「发现但未修的相邻缺口」——
      // 这里补上同一份中和：围栏标签中和 + 长度上限，口径与正常返回值完全一致。
      const message = sanitizeModelFacingText(raw, {
        maxChars: PLUGIN_ERROR_MAX_CHARS,
        neutralizeFenceTags: true
      });
      await writeAudit({
        descriptor,
        audit,
        ok: false,
        durationMs: Date.now() - startedAt,
        args,
        summary: summarize(message),
        trustLevel
      });
      return errorToolResult(`插件工具 ${descriptor.toolName} 没能完成：${message}`);
    }
  }

  async function listFor(
    workspaceId: string | undefined
  ): Promise<{ result: ListToolsResult; entries: PluginRegistryEntry[] } | undefined> {
    const resolved = await hostFor(workspaceId);
    if (!resolved) {
      return undefined;
    }
    return { result: await resolved.host.ensureStarted(), entries: resolved.entries };
  }

  /**
   * 描述符 → 这个插件被断言成什么。链路是 `toolId → pluginId`（描述符自带）
   * → `path`（握手报告里的 pluginId ↔ path）→ `trustLevel`（清单条目）。
   * 任何一环对不上都退回 `external_effect`——查不出授权就是没有授权。
   */
  function trustLevelLookup(result: ListToolsResult, entries: PluginRegistryEntry[]) {
    const trustByPath = new Map(entries.map((entry) => [entry.path, entry.trustLevel]));
    const pathByPluginId = new Map(result.plugins.map((report) => [report.pluginId, report.path]));
    return (descriptor: PluginToolDescriptor): PluginTrustLevel => {
      const path = pathByPluginId.get(descriptor.pluginId);
      return (path ? trustByPath.get(path) : undefined) ?? "external_effect";
    };
  }

  return {
    async toolSpecs(audit: PluginToolCallAudit = {}) {
      try {
        const listing = await listFor(audit.workspaceId);
        if (!listing) {
          return [];
        }
        const trustOf = trustLevelLookup(listing.result, listing.entries);
        return toPluginToolSpecs(
          listing.result.tools,
          ({ descriptor, args, ctx }) =>
            callTool(
              descriptor,
              args,
              {
                ...audit,
                ...(ctx.actorId ? { actorId: ctx.actorId } : {}),
                ...(ctx.runId ? { runId: ctx.runId } : {}),
                ...(ctx.workItemId ? { workItemId: ctx.workItemId } : {})
              },
              trustOf(descriptor)
            ),
          trustOf
        );
      } catch (error) {
        // 宿主起不来不该让 run 起不来——这次 run 就是没有插件工具。
        logger.warn("plugin_host_unavailable", { error });
        return [];
      }
    },
    async loadReports(workspaceId) {
      try {
        return (await listFor(workspaceId))?.result.plugins ?? [];
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
      // 熔断过的插件在管理员显式动过清单之后重新给一次机会——不然「装了个坏插件把宿主烧了」
      // 之后，即使把它停用了也永远起不来，只能重启整个 API。整插件面的熔断与按插件的隔离
      // 一起解除：管理员刚刚亲手改过清单，这一轮该按新清单如实重试一次，结果如实回报。
      disabledReason = undefined;
      quarantine.clear();
      return this.loadReports(workspaceId);
    },
    quarantinedPaths() {
      return [...quarantine.keys()];
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
let defaultCrashSink: PluginCrashSink | undefined;

/**
 * 让默认宿主客户端从 `plugins` 表读清单。**只在 `server.ts` 真起进程时调**——
 * 单测/离线工具不接线就只认 `WORKHUB_PLUGIN_PATHS`，一次 PG 查询都不会发生。
 */
export function usePluginRegistryPathSource(
  repository?: Pick<PluginRepository, "listEnabledForWorkspace" | "markCrashed">
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
  // 熔断落库跟清单来源同一次接线：读清单的部署才有表可写。
  defaultCrashSink = async (input) => {
    const store = repository ?? getDefaultPluginRepository();
    await store.markCrashed({
      workspaceId: input.workspaceId,
      sourcePath: input.sourcePath,
      loadReport: {
        ok: false,
        tool_count: 0,
        prompt_section_count: 0,
        error: input.reason,
        loaded_at: input.at.toISOString()
      },
      now: input.at
    });
  };
  // 已经建过单例就重建：接线发生在启动早期，此时不会有在飞调用。
  defaultClient = undefined;
}

/** 进程内单例：一个 API 进程只养一套插件宿主子进程（按工作区分）。 */
export function getDefaultPluginHostClient() {
  defaultClient ??= createPluginHostClient({
    ...(defaultPathSource ? { pluginPathSource: defaultPathSource } : {}),
    ...(defaultCrashSink ? { pluginCrashSink: defaultCrashSink } : {})
  });
  return defaultClient;
}

/** server.ts 收尾时调用；没起过就是空操作。 */
export async function closeDefaultPluginHostClient() {
  const live = defaultClient;
  defaultClient = undefined;
  await live?.close();
}
