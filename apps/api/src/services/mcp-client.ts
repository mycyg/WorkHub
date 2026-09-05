/**
 * MCP（Model Context Protocol，模型上下文协议）服务器的连接监督（R26 工包 M2，阶段 0）。
 *
 * 职责边界与 `plugin-host-client.ts` 逐字相同：**服务器提供能力实现，本文件之外的既有链路提供
 * 授权**。翻出来的 ToolSpec 走 `packages/tools` 的注册表，于是自动继承 canUse 双检、副作用工具
 * 的快照门、human-reserved 拦截与审批；这里只负责
 *   懒连接 / 连接缓存与 LRU / 空闲回收 / 有界重连预算 / 崩溃隔离 / 每次调用落审计 / 状态回写。
 *
 * ## 为什么不套插件宿主的子进程（设计稿 4.2）
 *
 * `plugin-host` 存在的唯一理由是「第三方 JS 必须在别的进程里 import」。MCP 服务器**本来就是**
 * 别的进程，第三方代码从不进我们的模块图；再套一层宿主会变成两跳 RPC、两层超时叠加，而且插件
 * 宿主的 env 白名单是「一个配置键都不给」的形状，MCP 服务器根本拿不到它必须的配置与凭据。
 * 生命周期也不同：插件宿主无状态、可随时 LRU 关掉重建；MCP 是有状态长连接，照「清单一变就换
 * 进程」的策略管会反复掐断在飞调用。
 *
 * ## 与插件宿主监督的三处刻意不同
 *
 * 1. **熔断粒度是「一台服务器」，不是「整个 MCP 面」。** 插件那侧崩溃超限会把整个插件面关掉
 *    （`plugin-host-client.ts` 的 `disabledReason`，一个坏插件带走全部插件）。这里的预算挂在
 *    每一台服务器上：一台 GitHub 服务器起不来，不该让文件系统服务器的工具跟着消失。
 * 2. **一台服务器连不上不让整次装配失败。** `toolSpecs()` 逐台 try/catch，连不上的那台记一条
 *    日志与一次状态回写，其余照常上线。
 * 3. **连接是有状态的，所以有空闲回收。** 长连接不像插件宿主那样每次都能重建，但也不该在
 *    一个没人用的工作区里养一辈子子进程：10 分钟没被用到就收掉，下次用到重新握手。
 *
 * ## 与 M0 仓储的治理约定
 *
 * `setEnabled(true)` 会把 `status` 落回 `connect_failed`（M0 有意的诚实状态：仓储层没做真实连接
 * 尝试，不冒充一个还没发生的验证结果）。**真实的连接结果由这里的 `updateConnectionResult` 写回**
 * ——M3 的治理动作在 `setEnabled` 之后必须调一次 `reload()`，否则那一行会一直停在
 * `connect_failed`。
 */
import {
  buildMcpChildEnv,
  describeMcpTools,
  renderMcpContent,
  toMcpToolSpecs,
  type McpServerTrustLevel,
  type McpToolDescriptor
} from "@workhub/mcp-client";
import {
  createMcpStdioSession,
  McpSessionError,
  spawnMcpServerProcess,
  type McpServerSpawn,
  type McpStdioSession
} from "@workhub/mcp-client/stdio";
import { errorToolResult, sanitizeModelFacingText, type AnyToolSpec, type ToolResult } from "@workhub/tools";

import { getDefaultStructuredLogger } from "../logging.js";
import { getDefaultAuditStores } from "./audit-stores.js";
import {
  createMcpServerRepository,
  getSharedDatabaseClient,
  type AuditLogRepository,
  type McpServerRepository,
  type McpServerRow,
  type WorkHubDatabaseClient
} from "@workhub/db";

/** DB 的 `tool_call_timeout_ms` 默认值与 CHECK 区间（迁移 0073）。这里再夹一次，不信任读回来的值。 */
export const MCP_TOOL_CALL_DEFAULT_TIMEOUT_MS = 60_000;
export const MCP_TOOL_CALL_TIMEOUT_MIN_MS = 1_000;
export const MCP_TOOL_CALL_TIMEOUT_MAX_MS = 300_000;

/**
 * 重连预算：同一台服务器 10 分钟内最多失败 3 次，第 4 次熔断并停止重试。
 * 比插件宿主的「5 分钟 3 次」放宽一档窗口，因为 MCP 服务器的失败常常是**外部**原因
 * （远端 API 抖动、凭据轮换中），重试一次的代价只是一个子进程。
 *
 * **连接失败与非预期退出计进同一份预算。** 只数「退出」的话，一台命令根本不存在的服务器会在
 * 每一次工具装配上重试一遍 spawn，永远不熔断——那正是最常见的配错形状。
 */
export const MCP_RECONNECT_WINDOW_MS = 10 * 60_000;
export const MCP_RECONNECT_LIMIT = 3;

/**
 * 同时活着的 MCP 子进程上限（跨工作区合计）。超了按最久未用关掉（LRU），下次用到时重新握手。
 * 比插件宿主的 4 高，因为这里的粒度是「一台服务器」而不是「一个工作区」：
 * 一个工作区装三台服务器是常态。
 */
export const MCP_MAX_LIVE_SESSIONS = 8;

/** 空闲多久回收子进程。回收不是失败：DB 里的状态不动，下次用到重新握手。 */
export const MCP_IDLE_RECLAIM_MS = 10 * 60_000;

/** 空闲扫描的间隔。定时器是 unref 的，绝不拖住 API 进程退出。 */
export const MCP_IDLE_SWEEP_INTERVAL_MS = 60_000;

/** 审计 detail 里参数/结果摘要的长度上限——审计表不是日志表。与插件那侧同值。 */
const AUDIT_SUMMARY_MAX_CHARS = 400;

/**
 * 错误信息进模型可见的工具结果前的上限。与 `renderMcpContent` 的 32KB 同口径：
 * 错误路径和成功路径面对的是同一个模型、同一道评审围栏，一条几十 MB 的 message 或一个字面的
 * `</outputs>` 在两条路上的危害完全一样。
 */
const MCP_ERROR_MESSAGE_MAX_CHARS = 32 * 1024;

/** `last_error` 落库的上限。DB 那一列是 text，但没必要把一整篇 stderr 灌进去。 */
const MCP_LAST_ERROR_MAX_CHARS = 1_000;

/** 一台 stdio MCP 服务器的连接配置。由 `McpServerSource` 从 DB 行翻出来。 */
export type McpServerConfig = {
  id: string;
  workspaceId: string;
  /** 本地配置的服务器名，构成模型可见工具名的命名空间。 */
  serverName: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  /** `{子进程 env 名: 服务端 env 名}`——指针不是值。 */
  secretRefs: Record<string, string>;
  cwd?: string;
  toolCallTimeoutMs: number;
  trustLevel: McpServerTrustLevel;
};

/**
 * 「这个工作区该连哪些 MCP 服务器」。默认返回空数组（**不接线就一台都不连、一次 PG 都不查**，
 * 全部既有单测行为逐字节不变）；`useMcpServerSource()` 之后是 `mcp_servers` 表里启用的行。
 * 与 `PluginPathSource` 同一条显式接线的先例。
 */
export type McpServerSource = (workspaceId: string | undefined) => Promise<McpServerConfig[]> | McpServerConfig[];

export type McpToolCallAudit = {
  workspaceId?: string;
  actorId?: string;
  runId?: string;
  workItemId?: string;
};

/** 给 M3（治理端点）与 M7（桌面设置页）的只读快照。 */
export type McpServerStatusSnapshot = {
  id: string;
  serverName: string;
  /**
   * 本进程看到的连接状态。**永远不会是 `disabled`**——来源只给启用的行，停用状态是 DB 的事实，
   * 由 M3 从行里读，不该由一个内存快照来回答。
   */
  status: Exclude<McpServerRow["status"], "disabled">;
  /** 上一次成功发现的工具数。 */
  toolCount: number;
  /** 当前是否有活着的子进程。空闲回收/LRU 关掉之后为 false，但状态仍然是 `connected`。 */
  live: boolean;
  /** 最近一次失败的英文诊断。 */
  lastError?: string;
  /** 重连预算耗尽的原因；有值表示在 `reload()` 之前不再重试这一台。 */
  blockedReason?: string;
  /** 上一次成功发现的公开工具名。 */
  toolIds: string[];
};

export type McpClientOptions = {
  /** 服务器清单来源；不传则一台都不连。 */
  serverSource?: McpServerSource;
  /** 注入点：测试里换成假 spawn。 */
  spawnProcess?: McpServerSpawn;
  /** 审计写入口；`false` 表示不写（单测/离线工具）。 */
  auditLogs?: Pick<AuditLogRepository, "createAuditLog"> | false;
  /** 连接结果回写入口；`false` 表示不写。 */
  connectionResults?: Pick<McpServerRepository, "updateConnectionResult"> | false;
  handshakeTimeoutMs?: number;
  maxLiveSessions?: number;
  idleReclaimMs?: number;
  /** 空闲扫描间隔；`false` 关掉定时器（测试直接调 `reapIdle()`）。 */
  idleSweepIntervalMs?: number | false;
  /** API 进程的 env（引用式密钥从这里取值）。缺省 `process.env`。 */
  envSource?: Record<string, string | undefined>;
  now?: () => Date;
  /** 单调时钟；测试注入以确定性地驱动空闲回收与重连窗口。 */
  monotonicNow?: () => number;
};

export type McpClient = {
  /** 该工作区可用的 MCP 工具。一台连不上不影响其余；一台都没有时返回空数组（不抛）。 */
  toolSpecs: (audit?: McpToolCallAudit) => Promise<AnyToolSpec[]>;
  /** 只读状态快照（不触发连接）。 */
  status: (workspaceId?: string) => McpServerStatusSnapshot[];
  /**
   * 热重载：关掉该工作区的全部连接、解除熔断，按最新清单重新握手并如实回报。
   * 启停/新增/移除/测试连接之后调用。
   */
  reload: (workspaceId?: string) => Promise<McpServerStatusSnapshot[]>;
  /** 空闲回收一轮。由内部定时器调用；测试直接驱动它，不依赖真实时间。 */
  reapIdle: () => Promise<void>;
  /** 优雅关闭全部子进程。 */
  close: () => Promise<void>;
};

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

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > MCP_LAST_ERROR_MAX_CHARS ? `${message.slice(0, MCP_LAST_ERROR_MAX_CHARS)}…` : message;
}

/** DB 的超时值再夹一次。CHECK 保证了区间，但读回来的行也可能来自一次手工 SQL。 */
function clampTimeout(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return MCP_TOOL_CALL_DEFAULT_TIMEOUT_MS;
  }
  return Math.min(MCP_TOOL_CALL_TIMEOUT_MAX_MS, Math.max(MCP_TOOL_CALL_TIMEOUT_MIN_MS, Math.trunc(value)));
}

/**
 * `mcp_servers` 的一行 → 连接配置。
 * `command` 为空的行直接跳过：阶段 0 只有 stdio，一行没有命令就是没法起的（HTTP 的
 * `url`/`auth_header_*` 列虽然建了，但被 `mcp_servers_transport_ck` 锁死成建了不能用）。
 */
export function toMcpServerConfig(row: McpServerRow): McpServerConfig | undefined {
  if (row.transport !== "stdio" || typeof row.command !== "string" || row.command.trim().length === 0) {
    return undefined;
  }
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    serverName: row.serverName,
    command: row.command,
    args: Array.isArray(row.argsJson) ? row.argsJson.filter((entry): entry is string => typeof entry === "string") : [],
    env: row.envJson ?? {},
    secretRefs: row.secretRefsJson ?? {},
    ...(typeof row.cwd === "string" && row.cwd.length > 0 ? { cwd: row.cwd } : {}),
    toolCallTimeoutMs: clampTimeout(row.toolCallTimeoutMs),
    trustLevel: row.trustLevel
  };
}

let defaultDbClient: WorkHubDatabaseClient | undefined;

/** 懒单例，与 `plugin-stores.ts` 同款：import 本模块不会碰 PG，只有真被调用时才建连接池。 */
function getDefaultMcpServerRepository(): McpServerRepository {
  defaultDbClient ??= getSharedDatabaseClient();
  return createMcpServerRepository(defaultDbClient.db);
}

/** DB 清单来源：某工作区里启用且未被停用的行（上次连接失败的也带上，下次重试可能就好了）。 */
export function createRepositoryMcpServerSource(deps: {
  repository?: Pick<McpServerRepository, "listEnabledForWorkspace">;
} = {}): McpServerSource {
  return async (workspaceId) => {
    if (!workspaceId) {
      return [];
    }
    const repository = deps.repository ?? getDefaultMcpServerRepository();
    const rows = await repository.listEnabledForWorkspace(workspaceId);
    const configs: McpServerConfig[] = [];
    for (const row of rows) {
      const config = toMcpServerConfig(row);
      if (config) {
        configs.push(config);
      }
    }
    return configs;
  };
}

type Connection = {
  /** 这条连接是按哪个工作区解析出来的。过滤用它，不用 key 的字符串前缀（工作区 id 是外来数据）。 */
  scope: string | undefined;
  config: McpServerConfig;
  session?: McpStdioSession | undefined;
  descriptors: McpToolDescriptor[];
  status: McpServerStatusSnapshot["status"];
  lastError?: string;
  blockedReason?: string;
  /** 单调时钟上的最后一次使用时刻。 */
  lastUsedAt: number;
  /** 窗口内的失败时刻（连接失败 + 非预期退出）。 */
  failures: number[];
  /** 正在连接中的那次尝试，避免并发装配把同一台服务器起两遍。 */
  connecting?: Promise<void> | undefined;
  /** 我们主动收掉的（空闲回收 / LRU / 配置变了 / 关停），退出不计预算。 */
  reclaimed: boolean;
};

function connectionKey(workspaceId: string | undefined, serverId: string) {
  return `${workspaceId ?? ""}::${serverId}`;
}

/** 配置变了就得换进程（换了命令/参数/密钥引用/信任级别的服务器不是同一台）。 */
function sameConfig(a: McpServerConfig, b: McpServerConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function createMcpClient(options: McpClientOptions = {}): McpClient {
  const logger = getDefaultStructuredLogger();
  const serverSource = options.serverSource;
  const spawnProcess = options.spawnProcess ?? spawnMcpServerProcess;
  const envSource = options.envSource ?? process.env;
  const maxLiveSessions = options.maxLiveSessions ?? MCP_MAX_LIVE_SESSIONS;
  const idleReclaimMs = options.idleReclaimMs ?? MCP_IDLE_RECLAIM_MS;
  const now = options.now ?? (() => new Date());
  const monotonicNow = options.monotonicNow ?? (() => Date.now());

  const connections = new Map<string, Connection>();
  let closed = false;
  let sweepTimer: NodeJS.Timeout | undefined;

  function liveSessionCount(): number {
    let count = 0;
    for (const [, connection] of connections) {
      if (connection.session?.isLive()) {
        count += 1;
      }
    }
    return count;
  }

  /** 主动收掉一个连接的子进程。不动 `status`/`descriptors`——回收不是失败，状态该保持诚实。 */
  async function reclaim(connection: Connection, reason: string) {
    const session = connection.session;
    if (!session) {
      return;
    }
    connection.reclaimed = true;
    connection.session = undefined;
    logger.info("mcp_session_reclaimed", {
      server_name: connection.config.serverName,
      workspace_id: connection.config.workspaceId,
      reason
    });
    await session.close();
  }

  function ensureSweepTimer() {
    if (options.idleSweepIntervalMs === false || sweepTimer || closed) {
      return;
    }
    const interval = options.idleSweepIntervalMs ?? MCP_IDLE_SWEEP_INTERVAL_MS;
    sweepTimer = setInterval(() => {
      void reapIdle().catch((error: unknown) => logger.warn("mcp_idle_sweep_failed", { error }));
    }, interval);
    sweepTimer.unref?.();
  }

  async function reapIdle(): Promise<void> {
    const at = monotonicNow();
    for (const [, connection] of connections) {
      if (connection.session && at - connection.lastUsedAt >= idleReclaimMs) {
        await reclaim(connection, "idle");
      }
    }
  }

  /** 超出上限时关掉最久未用的活连接。 */
  async function evictIfNeeded() {
    while (liveSessionCount() > maxLiveSessions) {
      let oldest: Connection | undefined;
      for (const [, connection] of connections) {
        if (!connection.session?.isLive()) {
          continue;
        }
        if (!oldest || connection.lastUsedAt < oldest.lastUsedAt) {
          oldest = connection;
        }
      }
      if (!oldest) {
        return;
      }
      await reclaim(oldest, "lru");
    }
  }

  async function writeConnectionResult(connection: Connection, input: {
    status: McpServerRow["status"];
    toolCount: number;
    tools: string[] | null;
    lastError: string | null;
  }) {
    if (options.connectionResults === false) {
      return;
    }
    const repository = options.connectionResults ?? getDefaultMcpServerRepository();
    try {
      await repository.updateConnectionResult({
        workspaceId: connection.config.workspaceId,
        id: connection.config.id,
        status: input.status,
        toolCount: input.toolCount,
        tools: input.tools,
        lastError: input.lastError,
        now: now()
      });
    } catch (error) {
      // 状态回写失败不该把一次能用的连接变成不能用——但必须留日志，否则「设置页显示连不上」
      // 与「真的连不上」分不清。
      logger.warn("mcp_connection_result_write_failed", {
        server_name: connection.config.serverName,
        error
      });
    }
  }

  /** 记一次失败并判熔断。返回是否刚刚熔断。 */
  function recordFailure(connection: Connection, detail: string): boolean {
    const at = monotonicNow();
    connection.failures.push(at);
    while (connection.failures.length > 0 && at - connection.failures[0]! > MCP_RECONNECT_WINDOW_MS) {
      connection.failures.shift();
    }
    if (connection.failures.length <= MCP_RECONNECT_LIMIT || connection.blockedReason) {
      return false;
    }
    connection.blockedReason = `mcp server '${connection.config.serverName}' failed ${connection.failures.length} times within ${MCP_RECONNECT_WINDOW_MS / 60_000} minutes; last error: ${detail}`;
    logger.warn("mcp_reconnect_budget_exhausted", {
      server_name: connection.config.serverName,
      workspace_id: connection.config.workspaceId,
      failures_in_window: connection.failures.length
    });
    return true;
  }

  function onSessionExit(connection: Connection, info: { code: number | null; signal: string | null; expected: boolean }) {
    // 先把会话取下来再清引用：stderr 尾部是解释「它为什么死了」的唯一线索，清完就没了。
    const dead = connection.session;
    connection.session = undefined;
    if (info.expected || connection.reclaimed || closed) {
      return;
    }
    const detail = `mcp server '${connection.config.serverName}' exited unexpectedly (code ${info.code ?? "null"}, signal ${info.signal ?? "null"})`;
    connection.status = "connect_failed";
    connection.lastError = detail;
    connection.descriptors = [];
    recordFailure(connection, detail);
    logger.warn("mcp_server_exited", {
      server_name: connection.config.serverName,
      workspace_id: connection.config.workspaceId,
      code: info.code,
      signal: info.signal,
      stderr_tail: summarize(dead?.stderrTail() ?? "")
    });
    void writeConnectionResult(connection, {
      status: "connect_failed",
      toolCount: 0,
      tools: null,
      lastError: connection.blockedReason ?? detail
    });
  }

  async function connect(connection: Connection): Promise<void> {
    const config = connection.config;
    connection.reclaimed = false;
    // 先记一次「刚用过」：LRU 挑最久未用的关，而这一台正在连——不刷新的话它可能被自己触发的
    // 那次 evict 当场关掉。
    connection.lastUsedAt = monotonicNow();
    let session: McpStdioSession | undefined;
    try {
      // 引用式密钥解析不到就 fail-closed（不拿空串起进程）——`buildMcpChildEnv` 直接抛。
      const env = buildMcpChildEnv({
        source: envSource,
        serverEnv: config.env,
        secretRefs: config.secretRefs
      });
      session = createMcpStdioSession({
        serverName: config.serverName,
        command: config.command,
        args: config.args,
        cwd: config.cwd,
        env,
        spawnProcess,
        ...(options.handshakeTimeoutMs === undefined ? {} : { handshakeTimeoutMs: options.handshakeTimeoutMs }),
        onExit: (info) => onSessionExit(connection, info),
        onLog: (event, fields) => logger.info(event, fields)
      });
      connection.session = session;
      await session.start();
      const tools = await session.listTools();
      const translation = describeMcpTools({
        serverName: config.serverName,
        trustLevel: config.trustLevel,
        tools
      });
      if (!translation.ok) {
        // 整份清单级别的问题（raw 名重复、公开名坍缩）：整代丢弃并把服务器标成连不上。
        // 留半套会让模型调到不是它以为的那个工具。
        throw new Error(`${translation.reason}: ${translation.detail}`);
      }
      for (const rejection of translation.rejected) {
        logger.warn("mcp_tool_rejected", {
          server_name: config.serverName,
          tool_name: rejection.rawName,
          reason: rejection.reason,
          detail: rejection.detail
        });
      }
      connection.descriptors = translation.descriptors;
      connection.status = "connected";
      delete connection.lastError;
      logger.info("mcp_server_connected", {
        server_name: config.serverName,
        workspace_id: config.workspaceId,
        tools: translation.descriptors.length,
        rejected: translation.rejected.length
      });
      await writeConnectionResult(connection, {
        status: "connected",
        toolCount: translation.descriptors.length,
        tools: translation.descriptors.map((descriptor) => descriptor.rawName),
        lastError: null
      });
      await evictIfNeeded();
    } catch (error) {
      const detail = errorText(error);
      connection.descriptors = [];
      connection.status = "connect_failed";
      connection.lastError = detail;
      recordFailure(connection, detail);
      connection.session = undefined;
      // 握手失败时会话自己已经收过一次尾；这里再关一次是幂等的，防的是「握手成功但列工具失败」
      // 那条路上留下的活进程。
      await session?.close();
      logger.warn("mcp_server_connect_failed", {
        server_name: config.serverName,
        workspace_id: config.workspaceId,
        reason: error instanceof McpSessionError ? error.reason : "unknown",
        detail,
        stderr_tail: summarize(session?.stderrTail() ?? "")
      });
      await writeConnectionResult(connection, {
        status: "connect_failed",
        toolCount: 0,
        tools: null,
        lastError: connection.blockedReason ?? detail
      });
      throw error;
    }
  }

  async function ensureConnected(connection: Connection): Promise<void> {
    if (closed) {
      throw new Error("mcp client is closed");
    }
    if (connection.blockedReason) {
      throw new Error(connection.blockedReason);
    }
    if (connection.session?.isLive()) {
      if (!connection.session.toolsDirty()) {
        return;
      }
      // 服务器说过它的清单变了：只在这里（下一次取清单时）刷新，绝不在一次执行中途换掉模型
      // 已经看过的工具清单。
      //
      // **刷新失败不往上抛**：这个函数同时是「调一个工具之前」的必经之路，让一次刷新失败把一次
      // 本来能成的调用变成错误，是拿次要路径的故障去伤主路径。留着上一份清单继续用，并记日志。
      try {
        const refreshed = await connection.session.listTools();
        const translation = describeMcpTools({
          serverName: connection.config.serverName,
          trustLevel: connection.config.trustLevel,
          tools: refreshed
        });
        if (translation.ok) {
          connection.descriptors = translation.descriptors;
          logger.info("mcp_tools_refreshed", {
            server_name: connection.config.serverName,
            tools: translation.descriptors.length
          });
          await writeConnectionResult(connection, {
            status: "connected",
            toolCount: translation.descriptors.length,
            tools: translation.descriptors.map((descriptor) => descriptor.rawName),
            lastError: null
          });
        } else {
          logger.warn("mcp_tools_refresh_rejected", {
            server_name: connection.config.serverName,
            reason: translation.reason,
            detail: translation.detail
          });
        }
      } catch (error) {
        logger.warn("mcp_tools_refresh_failed", {
          server_name: connection.config.serverName,
          error
        });
      }
      return;
    }
    if (connection.connecting) {
      return connection.connecting;
    }
    connection.connecting = connect(connection).finally(() => {
      delete connection.connecting;
    });
    return connection.connecting;
  }

  /** 把内存里的连接对齐到最新清单：清单里没有的收掉，配置变了的换一个新连接。 */
  async function syncConnections(workspaceId: string | undefined, configs: readonly McpServerConfig[]) {
    const wanted = new Map(configs.map((config) => [connectionKey(workspaceId, config.id), config]));
    for (const [key, connection] of [...connections]) {
      if (connection.scope !== workspaceId) {
        continue;
      }
      const config = wanted.get(key);
      if (!config) {
        connections.delete(key);
        await reclaim(connection, "removed_from_registry");
        continue;
      }
      if (!sameConfig(connection.config, config)) {
        connections.delete(key);
        await reclaim(connection, "config_changed");
      }
    }
    for (const config of configs) {
      const key = connectionKey(workspaceId, config.id);
      if (!connections.has(key)) {
        connections.set(key, {
          scope: workspaceId,
          config,
          descriptors: [],
          status: "connect_failed",
          lastUsedAt: monotonicNow(),
          failures: [],
          reclaimed: false
        });
      }
    }
  }

  async function resolveConfigs(workspaceId: string | undefined): Promise<McpServerConfig[]> {
    if (!serverSource) {
      return [];
    }
    try {
      return [...(await serverSource(workspaceId))];
    } catch (error) {
      // 清单读不出来（PG 抖动）不该让一次执行炸掉——这次执行就是没有 MCP 工具。
      logger.warn("mcp_registry_unavailable", { workspace_id: workspaceId, error });
      return [];
    }
  }

  async function writeAudit(input: {
    connection: Connection;
    descriptor: McpToolDescriptor;
    audit: McpToolCallAudit;
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
        // MCP 工具是 AI 在一次执行里调起来的，归 "ai"（与插件工具、快照审计同口径）；
        // 没有执行上下文（管理员手工试跑）才记 "system"。发起人仍然记 actorUserId。
        actorKind: input.audit.runId ? ("ai" as const) : ("system" as const),
        ...(input.audit.actorId ? { actorUserId: input.audit.actorId } : {}),
        ...(input.audit.workspaceId ? { workspaceId: input.audit.workspaceId } : {}),
        actorNickname: "mcp-client",
        entityType: "mcp_tool_invocation",
        entityId: `${input.descriptor.serverName}:${input.descriptor.rawName}`,
        action: "mcp.tool.called",
        detailJson: {
          mcp_server_id: input.connection.config.id,
          server_name: input.descriptor.serverName,
          tool_name: input.descriptor.rawName,
          tool_id: input.descriptor.toolId,
          ok: input.ok,
          duration_ms: input.durationMs,
          args_summary: summarize(input.args),
          result_summary: input.summary,
          capability: input.descriptor.minScope,
          called_at: now().toISOString(),
          ...(input.audit.runId ? { agent_run_id: input.audit.runId } : {}),
          ...(input.audit.workItemId ? { work_item_id: input.audit.workItemId } : {})
        }
      });
    } catch (error) {
      // 审计写失败不该把一次成功的工具调用变成失败（与 agent-runner 既有 fail-open 口径一致），
      // 但必须留结构化日志，否则「没有审计」和「没有调用」分不清。
      logger.warn("mcp_tool_audit_write_failed", { tool_id: input.descriptor.toolId, error });
    }
  }

  async function callTool(
    key: string,
    descriptor: McpToolDescriptor,
    args: Record<string, unknown>,
    audit: McpToolCallAudit
  ): Promise<ToolResult> {
    const startedAt = monotonicNow();
    const connection = connections.get(key);
    if (!connection) {
      // 装配之后这台服务器被移除/停用了。返回工具错误而不是抛异常——这次执行照常往下走。
      // 下面这句是**给模型看的工具结果**，不是界面文案（两端 UI 从不渲染它），所以行内豁免。
      const gone = `MCP 工具 ${descriptor.toolId} 没能完成：这台服务器已经不在当前清单里。`; // ui-i18n-allow
      return errorToolResult(gone);
    }
    try {
      await ensureConnected(connection);
      connection.lastUsedAt = monotonicNow();
      const session = connection.session;
      if (!session) {
        throw new Error(`mcp server '${descriptor.serverName}' is not running`);
      }
      const raw = await session.callTool({
        name: descriptor.rawName,
        args,
        timeoutMs: connection.config.toolCallTimeoutMs
      });
      // 中和围栏标签、非 text 块留占位、32KB 上限带截断标记，全在 M1 的这一个函数里。
      const result = renderMcpContent(raw);
      await writeAudit({
        connection,
        descriptor,
        audit,
        ok: result.ok,
        durationMs: monotonicNow() - startedAt,
        args,
        summary: summarize(result.content)
      });
      return result;
    } catch (error) {
      const message = errorText(error);
      await writeAudit({
        connection,
        descriptor,
        audit,
        ok: false,
        durationMs: monotonicNow() - startedAt,
        args,
        summary: summarize(message)
      });
      // 子进程崩了/超时了/连不上：返回**工具错误结果**而不是抛异常，这次执行照常往下走
      // （与插件宿主的崩溃隔离同口径）。第三方文本仍要过中和与上限：一条几十 MB 的 message
      // 或一个字面的 `</outputs>` 在错误路径上的危害和在成功路径上一模一样。
      const safeMessage = sanitizeModelFacingText(message, {
        maxChars: MCP_ERROR_MESSAGE_MAX_CHARS,
        neutralizeFenceTags: true
      });
      // 同上：给模型看的工具结果，不是界面文案。
      const failed = `MCP 工具 ${descriptor.toolId} 没能完成：${safeMessage}`; // ui-i18n-allow
      return errorToolResult(failed);
    }
  }

  function snapshotOf(connection: Connection): McpServerStatusSnapshot {
    return {
      id: connection.config.id,
      serverName: connection.config.serverName,
      status: connection.status,
      toolCount: connection.descriptors.length,
      live: connection.session?.isLive() === true,
      ...(connection.lastError ? { lastError: connection.lastError } : {}),
      ...(connection.blockedReason ? { blockedReason: connection.blockedReason } : {}),
      toolIds: connection.descriptors.map((descriptor) => descriptor.toolId)
    };
  }

  function snapshotsFor(workspaceId: string | undefined): McpServerStatusSnapshot[] {
    const rows: McpServerStatusSnapshot[] = [];
    for (const [, connection] of connections) {
      if (connection.scope === workspaceId) {
        rows.push(snapshotOf(connection));
      }
    }
    return rows;
  }

  async function connectAll(workspaceId: string | undefined): Promise<void> {
    const configs = await resolveConfigs(workspaceId);
    await syncConnections(workspaceId, configs);
    for (const config of configs) {
      const connection = connections.get(connectionKey(workspaceId, config.id));
      if (!connection) {
        continue;
      }
      try {
        await ensureConnected(connection);
        connection.lastUsedAt = monotonicNow();
      } catch (error) {
        // 一台连不上不影响其余。原因已经在 connect() 里落过日志与状态回写。
        logger.warn("mcp_server_unavailable", {
          server_name: config.serverName,
          workspace_id: workspaceId,
          error
        });
      }
    }
    ensureSweepTimer();
  }

  return {
    async toolSpecs(audit: McpToolCallAudit = {}) {
      if (closed || !serverSource) {
        return [];
      }
      await reapIdle();
      await connectAll(audit.workspaceId);
      const specs: AnyToolSpec[] = [];
      const seen = new Set<string>();
      for (const [key, connection] of connections) {
        if (connection.scope !== audit.workspaceId) {
          continue;
        }
        const usable: McpToolDescriptor[] = [];
        for (const descriptor of connection.descriptors) {
          if (seen.has(descriptor.toolId)) {
            // 数学上不该发生（服务器名工作区内唯一 + 指纹兜底），所以它响了就是命名规则被改坏了。
            // 丢掉重复的那个而不是让它顶掉先来的——公开名坍缩正是「调用送错目的地」的入口。
            logger.warn("mcp_tool_id_collision", {
              tool_id: descriptor.toolId,
              server_name: descriptor.serverName,
              workspace_id: audit.workspaceId
            });
            continue;
          }
          seen.add(descriptor.toolId);
          usable.push(descriptor);
        }
        specs.push(
          ...toMcpToolSpecs(usable, ({ descriptor, args, ctx }) =>
            callTool(key, descriptor, args, {
              ...audit,
              ...(ctx.actorId ? { actorId: ctx.actorId } : {}),
              ...(ctx.runId ? { runId: ctx.runId } : {}),
              ...(ctx.workItemId ? { workItemId: ctx.workItemId } : {})
            })
          )
        );
      }
      return specs;
    },
    status(workspaceId) {
      return snapshotsFor(workspaceId);
    },
    async reload(workspaceId) {
      for (const [key, connection] of [...connections]) {
        if (connection.scope !== workspaceId) {
          continue;
        }
        connections.delete(key);
        await reclaim(connection, "reload");
      }
      // 熔断过的服务器在管理员显式动过清单之后重新给一次机会——不然「装了台起不来的服务器」
      // 之后即使把它改好了也永远起不来，只能重启整个 API 进程。
      await connectAll(workspaceId);
      return snapshotsFor(workspaceId);
    },
    reapIdle,
    async close() {
      closed = true;
      if (sweepTimer) {
        clearInterval(sweepTimer);
        sweepTimer = undefined;
      }
      const live = [...connections.values()];
      connections.clear();
      await Promise.all(live.map((connection) => reclaim(connection, "shutdown")));
    }
  };
}

let defaultClient: McpClient | undefined;
let defaultServerSource: McpServerSource | undefined;

/**
 * 让默认客户端从 `mcp_servers` 表读清单。**只在 `server.ts` 真起进程时调**（M4 的接线点）——
 * 不接线的场景（全部既有单测、离线工具）一台服务器都不连，一次 PG 查询都不会发生。
 * 与 `usePluginRegistryPathSource()` 同一条先例。
 */
export function useMcpServerSource(repository?: Pick<McpServerRepository, "listEnabledForWorkspace">) {
  defaultServerSource = createRepositoryMcpServerSource(repository ? { repository } : {});
  // 已经建过单例就重建：接线发生在启动早期，此时不会有在飞调用。
  defaultClient = undefined;
}

/** 进程内单例：一个 API 进程只养一套 MCP 子进程。 */
export function getDefaultMcpClient(): McpClient {
  defaultClient ??= createMcpClient(defaultServerSource ? { serverSource: defaultServerSource } : {});
  return defaultClient;
}

/** `server.ts` 收尾时调用；没起过就是空操作。 */
export async function closeDefaultMcpClient() {
  const live = defaultClient;
  defaultClient = undefined;
  await live?.close();
}
