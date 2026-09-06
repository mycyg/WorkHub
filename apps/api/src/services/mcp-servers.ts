/**
 * MCP（Model Context Protocol，模型上下文协议）服务器的治理服务（R26 工包 M3，阶段 0）。
 *
 * 职责边界一句话：**这一层管「清单上有哪些服务器、谁能改、改完落什么账」，连接本身归 M2**
 * （`./mcp-client.ts`）。本文件从不 spawn 子进程、不说 JSON-RPC，只在动过清单之后调一次
 * `reload()` 让 M2 按新清单重新握手，再把它写回行里的结果读出来。
 *
 * 形状逐条照 `./plugins.ts`（R24-P 阶段 1 的插件治理），四条纪律原样继承：
 *
 * 1. **只有管理员**。添加一台 MCP 服务器 = 在这台机器上多起一个长期存在的子进程，它以当前用户
 *    身份跑、能读写该用户能碰的文件、能出网。这不是「配置一个集成」，是引入一个执行面。
 * 2. **先体检再登记**。静态体检不执行任何东西（字符串判定 + 一次 `access()`），拒绝的每一类各有
 *    自己的错误码，两端界面按码出话，而不是把英文诊断甩给用户。
 * 3. **凭据不落这张表**。`env` 只收非密键（凭据形状的键在体检就被拒）；真正的密钥走
 *    `secret_refs` 存**指针**，值由 API 进程在 spawn 时从自己的环境里取。
 * 4. **每个写动作都落审计**：`mcp_server.added / enabled / disabled / updated / reloaded / removed`。
 *
 * ## 与插件治理的三处刻意不同
 *
 * 1. **多一个「测试连接」**（`POST /:id/reload`）。插件的加载是一次性的，MCP 是有状态长连接，
 *    「现在还连得上吗」是一个用户随时会问、也随时会变的问题，必须有独立入口。
 * 2. **多一个「改配置」**（`PATCH`）。信任级别与单次调用超时是这一版真正的调节旋钮：把一台服务器
 *    从 `external_effect` 降到 `read_only` 是管理员对它的断言，不该逼人删了重加。
 * 3. **登记之后行上的状态不是「登记成功」而是「还没验证过」**。M0 的仓储层刻意让
 *    `setEnabled(true)` 把 `status` 落回 `connect_failed`（不冒充一个还没发生的验证结果），
 *    **真实结果由 M2 的 `updateConnectionResult` 写回**——所以本文件每个写动作之后都
 *    「reload 一次、再把行读一遍」，读到的才是真相。漏掉这一步，行会永远停在 `connect_failed`。
 */
import { access, constants } from "node:fs/promises";
import path from "node:path";

import {
  mcpServerActionResultSchema,
  mcpServerListVmSchema,
  mcpServerVmSchema,
  type AddMcpServerRequest,
  type McpPrecheckReport,
  type McpServerActionResult,
  type McpServerConnectionVM,
  type McpServerErrorCode,
  type McpServerListVM,
  type McpServerVM,
  type UpdateMcpServerRequest
} from "@workhub/contracts";
import {
  isDeniedPluginHostEnvKey,
  MCP_CHILD_ENV_ALLOWLIST,
  MCP_SECRET_REF_ENV_PREFIX,
  mcpPrecheckErrorCode,
  mcpServerNameRiskTokens,
  mcpToolIdTokens,
  precheckMcpServer,
  type McpCommandResolution
} from "@workhub/mcp-client";
import { McpSessionError, type McpSessionFailureReason } from "@workhub/mcp-client/stdio";
import {
  createMcpServerRepository,
  getSharedDatabaseClient,
  type AuditLogRepository,
  type McpServerRepository,
  type McpServerRow,
  type WorkHubDatabaseClient
} from "@workhub/db";

import type { AuthActor } from "../middleware/auth.js";
import { getDefaultStructuredLogger } from "../logging.js";
import { parseOutputContract } from "../pages/output-contract.js";
import { getDefaultAuditStores } from "./audit-stores.js";
import { classifyHumanReservedToolCall } from "./human-reserved-guard.js";
import { getDefaultMcpClient, type McpClient, type McpServerStatusSnapshot } from "./mcp-client.js";
import { mcpServersT, type McpServersCopyKey } from "./mcp-servers-copy.js";

export class McpServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "McpServiceError";
  }
}

/**
 * 体检拒绝 → HTTP 状态 + 文案键。**码由 `mcpPrecheckErrorCode` 出**（M1 的权威映射），这里只补
 * 「这个码该配多少状态、说哪句话」。
 *
 * 只有「名字被占用」是 409：那是一次和现有清单的冲突（同 `plugin_already_installed` 的先例），
 * 用户改个名就能过；其余七条都是这份配置本身不成立，是 422。
 */
const PRECHECK_REFUSALS: Record<string, { status: number; copy: McpServersCopyKey }> = {
  mcp_server_name_invalid: { status: 422, copy: "serverNameInvalid" },
  mcp_server_name_taken: { status: 409, copy: "serverNameTaken" },
  mcp_command_not_found: { status: 422, copy: "commandNotFound" },
  mcp_remote_exec_refused: { status: 422, copy: "remoteExecRefused" },
  mcp_args_invalid: { status: 422, copy: "argsInvalid" },
  mcp_env_credential_shaped: { status: 422, copy: "envCredentialShaped" },
  mcp_env_overrides_base: { status: 422, copy: "envOverridesBase" },
  mcp_secret_ref_out_of_scope: { status: 422, copy: "secretRefOutOfScope" }
};

/**
 * M2 的会话失败原因 → 这一层的稳定码与文案键。
 *
 * 阶段 0 里 `McpClient.reload()` 把**每一台**服务器的连接失败都吞进快照（一台连不上不该让整次
 * 治理动作失败），所以这张表平时走的是「整次 reload 整体炸了」那条罕见路径；导出它是为了让 M7
 * 的设置页和未来放开 HTTP 之后的调用点共用同一份映射，而不是各自再猜一遍英文诊断的意思。
 */
const SESSION_FAILURES: Record<McpSessionFailureReason, { code: McpServerErrorCode; copy: McpServersCopyKey }> = {
  spawn_failed: { code: "mcp_spawn_failed", copy: "spawnFailed" },
  handshake_timeout: { code: "mcp_handshake_timeout", copy: "handshakeTimeout" },
  protocol_version_unsupported: { code: "mcp_protocol_version_unsupported", copy: "protocolVersionUnsupported" },
  protocol_error: { code: "mcp_protocol_error", copy: "protocolError" },
  server_error: { code: "mcp_server_error", copy: "serverRejected" },
  call_timeout: { code: "mcp_call_timeout", copy: "callTimeout" },
  not_running: { code: "mcp_not_running", copy: "notRunning" },
  exited: { code: "mcp_exited", copy: "exited" }
};

/**
 * 会话失败原因 → 对外稳定码。拿不到原因时回落到「连不上」。
 *
 * M2 的连接监督只在快照里回**原因枚举**（它不认识 `mcp_*` 码，认识了就得反过来 import 本文件，
 * 绕成一个循环）；翻成码这一步固定发生在这里，于是全仓只有这一张表。
 */
export function mcpSessionFailureCode(reason: McpSessionFailureReason | undefined): McpServerErrorCode {
  return reason ? SESSION_FAILURES[reason].code : "mcp_connect_failed";
}

/** 会话失败原因的对外码与人话。拿不到原因时回落到「连不上」。 */
export function describeMcpSessionFailure(error: unknown): { code: McpServerErrorCode; message: string } {
  const mapped = error instanceof McpSessionError ? SESSION_FAILURES[error.reason] : undefined;
  if (!mapped) {
    return { code: "mcp_connect_failed", message: mcpServersT("connectFailed") };
  }
  return { code: mapped.code, message: mcpServersT(mapped.copy) };
}

export type McpServerServiceDependencies = {
  repository: McpServerRepository;
  auditLog: Pick<AuditLogRepository, "createAuditLog">;
  /** 连接监督（M2）。不注入则用进程内单例。 */
  client?: Pick<McpClient, "status" | "reload">;
  /** 命令存在性查询。注入点只为单测——生产就是读磁盘那一份。 */
  resolveCommand?: (command: string) => Promise<McpCommandResolution>;
  /** API 进程的环境。只读**变量名**（引用式密钥体检与添加表单提示），从不读值。 */
  envSource?: Record<string, string | undefined>;
  now?: () => Date;
};

export type McpServerService = {
  list(input: { actor: AuthActor }): Promise<McpServerListVM>;
  add(input: { actor: AuthActor; request: AddMcpServerRequest }): Promise<McpServerActionResult>;
  setEnabled(input: { actor: AuthActor; id: string; enabled: boolean }): Promise<McpServerActionResult>;
  update(input: { actor: AuthActor; id: string; request: UpdateMcpServerRequest }): Promise<McpServerActionResult>;
  /** 测试连接：按最新清单重新握手，回最新的行与连接事实。 */
  reload(input: { actor: AuthActor; id: string }): Promise<McpServerActionResult>;
  remove(input: { actor: AuthActor; id: string }): Promise<{ removed: true }>;
};

type McpAuditAction =
  | "mcp_server.added"
  | "mcp_server.enabled"
  | "mcp_server.disabled"
  | "mcp_server.updated"
  | "mcp_server.reloaded"
  | "mcp_server.removed";

type AdminScope = { userId: string; workspaceId: string; label: string };

function requireAdmin(actor: AuthActor): AdminScope {
  const userId = actor.userId?.trim();
  if (actor.kind !== "human" || !userId || !actor.isAdmin) {
    throw new McpServiceError(403, "mcp_admin_required", mcpServersT("adminRequired"));
  }
  return { userId, workspaceId: actor.workspaceId, label: actor.label };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/**
 * 命令在这台机器上存不存在、能不能执行。
 *
 * 裸名走 `PATH` 逐目录找（与子进程真正被 spawn 时的解析口径一致）；绝对路径直接看那一个文件。
 * 相对路径根本走不到这里——体检在拿到这个结论之前就已经拒了（相对谁？API 进程的 cwd 是部署细节，
 * 不该决定跑起来的是哪个可执行文件）。
 *
 * **只回结论，不回错误原因**：`access()` 的 errno 里会带完整路径与权限位，那是宿主机细节，
 * 由体检报告的 detail 统一给，不从这里泄漏第二条通道。
 */
export async function resolveMcpCommandOnDisk(
  command: string,
  envSource: Record<string, string | undefined> = process.env
): Promise<McpCommandResolution> {
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return { found: false, executable: false };
  }
  const candidates = path.isAbsolute(trimmed)
    ? [trimmed]
    : (envSource["PATH"] ?? "")
        .split(path.delimiter)
        .filter((entry) => entry.length > 0)
        .map((dir) => path.join(dir, trimmed));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.F_OK);
    } catch {
      continue;
    }
    try {
      await access(candidate, constants.X_OK);
      return { found: true, executable: true, resolvedPath: candidate };
    } catch {
      // 找到了但不能执行是一条**确定**的结论，不该继续往后找同名文件——那会把「这个文件权限不对」
      // 悄悄换成「另一个同名文件可以跑」，用户以为自己填的是前者。
      return { found: true, executable: false, resolvedPath: candidate };
    }
  }
  return { found: false, executable: false };
}

/**
 * 服务器名里会让它的**每一个**工具都被判成高风险的词。
 *
 * 词表的权威在 `./human-reserved-guard.ts`（那才是真正的门），本文件不留副本：把服务器名切成词，
 * 逐词问一次那道门，问出来的就是那道门真会做的判定。`mcpServerNameRiskTokens` 负责把结果收敛回
 * 「名字里确实出现过的词」，于是从根上没有「两份词表漂移」这回事。
 */
export function serverNameRiskTokens(serverName: string): string[] {
  const words = mcpToolIdTokens(serverName).filter(
    (word) => classifyHumanReservedToolCall({ toolId: word }) !== null
  );
  return mcpServerNameRiskTokens(serverName, [...new Set(words)]);
}

function toConnectionVm(snapshot: McpServerStatusSnapshot): McpServerConnectionVM {
  return {
    live: snapshot.live,
    tool_count: snapshot.toolCount,
    ...(snapshot.toolIds.length > 0 ? { tool_ids: snapshot.toolIds } : {}),
    ...(snapshot.blockedReason ? { blocked_reason: snapshot.blockedReason } : {}),
    // 有诊断文本就一定有码：界面永远拿得到一句按码写的话，诊断串只作为括号里的次级信息。
    ...(snapshot.lastError
      ? { last_error: snapshot.lastError, last_error_code: mcpSessionFailureCode(snapshot.lastErrorReason) }
      : {})
  };
}

/**
 * 一行 → 对外 VM。**行是事实源**：M2 在每次连接尝试之后把 status / tool_count / tools / last_error
 * 写回这一行，所以重启 API 之后读到的仍然是上一次真实结论。内存快照只补一件行上没有的事——
 * 「此刻还有没有活着的子进程」，那件事在 `connection` 里单独给。
 */
export function toMcpServerVm(row: McpServerRow, snapshot?: McpServerStatusSnapshot): McpServerVM {
  const tools = stringArray(row.toolsJson);
  // fail-closed 输出契约：VM 装配走样 → 500，而不是把半成品甩给客户端（同 pages/* 的既有口径）。
  return parseOutputContract(
    mcpServerVmSchema,
    {
      id: row.id,
      server_name: row.serverName,
      ...(row.displayName ? { display_name: row.displayName } : {}),
      transport: "stdio",
      command: row.command ?? "",
      args: stringArray(row.argsJson),
      env: row.envJson ?? {},
      secret_refs: row.secretRefsJson ?? {},
      ...(row.cwd ? { cwd: row.cwd } : {}),
      tool_call_timeout_ms: row.toolCallTimeoutMs,
      enabled: row.enabled,
      status: row.status,
      trust_level: row.trustLevel,
      precheck_report: row.precheckReport as unknown as McpPrecheckReport,
      ...(row.lastError ? { last_error: row.lastError } : {}),
      // 码来自**本进程**的连接记录，因为 mcp_servers 表没有存码的列。行上有诊断而这个进程没连过
      // 它（重启之后、或从没启用过）时码就缺席——那是如实的「说不出这一次的原因」，不是没出过错。
      ...(row.lastError && snapshot?.lastError
        ? { last_error_code: mcpSessionFailureCode(snapshot.lastErrorReason) }
        : {}),
      tool_count: row.toolCount,
      ...(tools.length > 0 ? { tools } : {}),
      ...(row.installedBy ? { installed_by: row.installedBy } : {}),
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString()
    },
    "mcp_server.vm"
  );
}

// R27（与插件清单同一类事故）：precheck_report 是没有 CHECK 约束的 jsonb，读回来被 `as` 强转而不是
// parse；command 这一列在库里可空（给将来的非 stdio 传输留的余地），读侧又拿 `?? ""` 伪造了一个
// 契约明令禁止的空串。任一情形都让 GET /api/mcp-servers 整个 500，设置页那一区跟着静默消失。
// 清单这条路径改成逐行容错：解析不了的那一行丢掉并留一条结构化 warn，其余服务器照常列出。
// 契约不放宽——stdio 行的启动命令确实必填，一条没有命令的 stdio 行是坏数据，不是合法状态。
function toListedMcpServerVm(row: McpServerRow, snapshot?: McpServerStatusSnapshot): McpServerVM | undefined {
  try {
    return toMcpServerVm(row, snapshot);
  } catch (error) {
    getDefaultStructuredLogger().warn("mcp_server_row_dropped_unparsable", { mcpServerId: row.id, error });
    return undefined;
  }
}

export function createMcpServerService(deps: McpServerServiceDependencies): McpServerService {
  const logger = getDefaultStructuredLogger();
  const now = deps.now ?? (() => new Date());
  const envSource = deps.envSource ?? process.env;
  const resolveCommand = deps.resolveCommand ?? ((command: string) => resolveMcpCommandOnDisk(command, envSource));
  // 懒解析：不注入时才取进程内单例，且推迟到真正用到——M4 的 `useMcpServerSource()` 会重建那个单例，
  // 在构造期抓一份引用会抓到接线之前的那个空客户端。
  const client = () => deps.client ?? getDefaultMcpClient();

  /** 这台机器上现有的引用式密钥变量名。**只有名字，没有值。** */
  function availableSecretRefs(): string[] {
    return Object.keys(envSource)
      .filter((key) => key.startsWith(MCP_SECRET_REF_ENV_PREFIX))
      .sort();
  }

  async function writeAudit(input: {
    scope: AdminScope;
    row: McpServerRow;
    action: McpAuditAction;
    detail?: Record<string, unknown>;
  }) {
    try {
      await deps.auditLog.createAuditLog({
        actorKind: "human",
        actorUserId: input.scope.userId,
        actorNickname: input.scope.label,
        workspaceId: input.scope.workspaceId,
        entityType: "mcp_server",
        entityId: input.row.id,
        action: input.action,
        detailJson: {
          server_name: input.row.serverName,
          transport: "stdio",
          command: input.row.command ?? "",
          status: input.row.status,
          trust_level: input.row.trustLevel,
          tool_count: input.row.toolCount,
          // 环境变量与密钥引用只记**键名**：值里可能有配置也可能有别人以为不敏感的东西，
          // 审计表不是它们该出现的地方（同 `env_json` 结构性存不进密文的理由）。
          env_keys: Object.keys(input.row.envJson ?? {}).sort(),
          secret_ref_keys: Object.keys(input.row.secretRefsJson ?? {}).sort(),
          at: now().toISOString(),
          ...input.detail
        }
      });
    } catch (error) {
      // 审计写失败不该把一次已经生效的治理动作变成失败（与 plugins/agent-runner 的既有 fail-open
      // 口径一致），但必须留结构化日志，否则「没有审计」和「没发生过」分不清。
      logger.warn("mcp_server_audit_write_failed", {
        mcp_server_id: input.row.id,
        action: input.action,
        error
      });
    }
  }

  /**
   * 让 M2 按最新清单重新握手。
   *
   * **整次 reload 炸了不该让一个已经生效在 DB 上的治理动作失败**（同 `plugins.ts` 的 `reloadQuietly`）：
   * 记一条日志、把人话原因带回给调用方，动作照旧算数。单台服务器连不上更不会走到这里——M2 逐台
   * try/catch，失败写进那一行的 `last_error` 里。
   */
  async function reloadConnections(workspaceId: string): Promise<{
    snapshots: McpServerStatusSnapshot[];
    failure?: { code: string; message: string };
  }> {
    try {
      return { snapshots: await client().reload(workspaceId) };
    } catch (error) {
      const failure = describeMcpSessionFailure(error);
      logger.warn("mcp_reload_failed", { workspace_id: workspaceId, code: failure.code, error });
      return { snapshots: [], failure };
    }
  }

  function snapshotFor(snapshots: readonly McpServerStatusSnapshot[], id: string) {
    return snapshots.find((snapshot) => snapshot.id === id);
  }

  async function requireRow(workspaceId: string, id: string): Promise<McpServerRow> {
    const row = await deps.repository.findById(workspaceId, id);
    if (!row) {
      throw new McpServiceError(404, "mcp_server_not_found", mcpServersT("serverNotFound"));
    }
    return row;
  }

  /** 动作回执：行 + 这个进程当下看到的连接事实 + 名字里的高风险词。 */
  function actionResult(input: {
    row: McpServerRow;
    snapshot?: McpServerStatusSnapshot | undefined;
    failure?: { code: string; message: string } | undefined;
  }): McpServerActionResult {
    const connection = input.snapshot
      ? toConnectionVm(input.snapshot)
      : input.failure
        ? { live: false, tool_count: 0, last_error: input.failure.message }
        : undefined;
    return parseOutputContract(
      mcpServerActionResultSchema,
      {
        server: toMcpServerVm(input.row, input.snapshot),
        ...(connection ? { connection } : {}),
        risk_tokens: serverNameRiskTokens(input.row.serverName)
      },
      "mcp_server.action_result"
    );
  }

  /** 动作生效之后：重新握手、把行读一遍（M2 刚把真实结果写回去了）、落审计、出回执。 */
  async function settle(input: {
    scope: AdminScope;
    row: McpServerRow;
    action: McpAuditAction;
    detail?: Record<string, unknown>;
    /** 停用的服务器不连——省掉一次没有意义的整工作区重握手。 */
    reconnect: boolean;
  }): Promise<McpServerActionResult> {
    let row = input.row;
    let snapshot: McpServerStatusSnapshot | undefined;
    let failure: { code: string; message: string } | undefined;
    if (input.reconnect) {
      const reloaded = await reloadConnections(input.scope.workspaceId);
      failure = reloaded.failure;
      snapshot = snapshotFor(reloaded.snapshots, row.id);
      // M2 的 updateConnectionResult 刚写过这一行，不重读就会把「还没验证过」当成结论回出去。
      row = (await deps.repository.findById(input.scope.workspaceId, row.id)) ?? row;
    }
    await writeAudit({
      scope: input.scope,
      row,
      action: input.action,
      ...(input.detail ? { detail: input.detail } : {})
    });
    return actionResult({ row, snapshot, failure });
  }

  return {
    async list({ actor }) {
      const scope = requireAdmin(actor);
      const rows = await deps.repository.listForWorkspace(scope.workspaceId);
      const snapshots = client().status(scope.workspaceId);
      const connections: Record<string, McpServerConnectionVM> = {};
      for (const snapshot of snapshots) {
        connections[snapshot.id] = toConnectionVm(snapshot);
      }
      return parseOutputContract(
        mcpServerListVmSchema,
        {
          servers: rows.flatMap((row) => toListedMcpServerVm(row, snapshotFor(snapshots, row.id)) ?? []),
          connections,
          secret_ref_env_prefix: MCP_SECRET_REF_ENV_PREFIX,
          available_secret_refs: availableSecretRefs()
        },
        "mcp_server.list"
      );
    },

    async add({ actor, request }) {
      const scope = requireAdmin(actor);
      const existing = await deps.repository.listForWorkspace(scope.workspaceId);
      const args = request.args ?? [];
      const env = request.env ?? {};
      const secretRefs = request.secret_refs ?? {};
      const command = request.command.trim();
      const report = precheckMcpServer({
        serverName: request.server_name,
        takenServerNames: existing.map((row) => row.serverName),
        command,
        args,
        env,
        secretRefs,
        // 相对路径与空命令在体检里就被拒，不值得为它们先做一次磁盘 IO。
        ...(command.length > 0 && (path.isAbsolute(command) || !command.includes("/"))
          ? { commandResolution: await resolveCommand(command) }
          : {}),
        presentSecretEnvNames: availableSecretRefs(),
        checkedAt: now()
      });
      if (report.verdict === "blocked") {
        throw refusal(report, { command, env, secretRefs });
      }
      const created = await deps.repository.create({
        workspaceId: scope.workspaceId,
        serverName: request.server_name,
        ...(request.display_name ? { displayName: request.display_name } : {}),
        command,
        args,
        env,
        secretRefs,
        ...(request.cwd ? { cwd: request.cwd } : {}),
        ...(request.tool_call_timeout_ms ? { toolCallTimeoutMs: request.tool_call_timeout_ms } : {}),
        enabled: request.enabled ?? true,
        // 登记这件事本身不证明连得上。真实结果由紧随其后的 reload 经 M2 写回。
        status: (request.enabled ?? true) ? "connect_failed" : "disabled",
        ...(request.trust_level ? { trustLevel: request.trust_level } : {}),
        precheckReport: report as unknown as Record<string, unknown>,
        installedBy: scope.userId,
        now: now()
      });
      return settle({
        scope,
        row: created,
        action: "mcp_server.added",
        detail: { precheck_verdict: report.verdict },
        reconnect: created.enabled
      });
    },

    async setEnabled({ actor, id, enabled }) {
      const scope = requireAdmin(actor);
      const row = await requireRow(scope.workspaceId, id);
      if (row.enabled === enabled) {
        // 幂等：已经是这个状态就直接回执，不重连、不再记一条审计（会把审计流刷成噪音）。
        // 「连不上了想重试」走「测试连接」，那条路有自己的审计动作，看得出发生过什么。
        return actionResult({
          row,
          snapshot: snapshotFor(client().status(scope.workspaceId), row.id)
        });
      }
      const updated = await deps.repository.setEnabled({
        workspaceId: scope.workspaceId,
        id,
        enabled,
        now: now()
      });
      if (!updated) {
        throw new McpServiceError(404, "mcp_server_not_found", mcpServersT("serverNotFound"));
      }
      return settle({
        scope,
        row: updated,
        action: enabled ? "mcp_server.enabled" : "mcp_server.disabled",
        // 停用也要 reload：那台服务器的子进程得真的收掉，工具从此不出现在任何一次执行里。
        reconnect: true
      });
    },

    async update({ actor, id, request }) {
      const scope = requireAdmin(actor);
      const row = await requireRow(scope.workspaceId, id);
      if (request.env || request.secret_refs) {
        // 改环境变量与密钥引用要重跑那几条体检：否则「添加时拒绝凭据形状的键」这条红线，
        // 会被一次 PATCH 从后门绕过去。名字与命令不可改，故与它们相关的检查结论原样沿用。
        const report = precheckMcpServer({
          serverName: row.serverName,
          command: row.command ?? "",
          args: stringArray(row.argsJson),
          env: request.env ?? row.envJson ?? {},
          secretRefs: request.secret_refs ?? row.secretRefsJson ?? {},
          commandResolution: { found: true, executable: true },
          presentSecretEnvNames: availableSecretRefs(),
          checkedAt: now()
        });
        if (report.verdict === "blocked") {
          throw refusal(report, {
            command: row.command ?? "",
            env: request.env ?? row.envJson ?? {},
            secretRefs: request.secret_refs ?? row.secretRefsJson ?? {}
          });
        }
      }
      const updated = await deps.repository.updateSettings({
        workspaceId: scope.workspaceId,
        id,
        ...(request.trust_level ? { trustLevel: request.trust_level } : {}),
        ...(request.tool_call_timeout_ms ? { toolCallTimeoutMs: request.tool_call_timeout_ms } : {}),
        ...(request.env ? { env: request.env } : {}),
        ...(request.secret_refs ? { secretRefs: request.secret_refs } : {}),
        now: now()
      });
      if (!updated) {
        throw new McpServiceError(404, "mcp_server_not_found", mcpServersT("serverNotFound"));
      }
      return settle({
        scope,
        row: updated,
        action: "mcp_server.updated",
        detail: { changed: Object.keys(request).sort() },
        // 改过的字段全部只在下一次握手/下一次调用时生效，所以改完必须重连一次——
        // 否则设置页显示的是新值，跑着的子进程用的还是旧值。
        reconnect: updated.enabled
      });
    },

    async reload({ actor, id }) {
      const scope = requireAdmin(actor);
      const row = await requireRow(scope.workspaceId, id);
      return settle({ scope, row, action: "mcp_server.reloaded", reconnect: row.enabled });
    },

    async remove({ actor, id }) {
      const scope = requireAdmin(actor);
      const row = await requireRow(scope.workspaceId, id);
      const removed = await deps.repository.remove(scope.workspaceId, id);
      if (!removed) {
        throw new McpServiceError(404, "mcp_server_not_found", mcpServersT("serverNotFound"));
      }
      // 先让子进程收掉再落审计：审计写失败是 fail-open 的，进程没收掉才是真事故。
      await reloadConnections(scope.workspaceId);
      await writeAudit({ scope, row, action: "mcp_server.removed" });
      return { removed: true };
    }
  };
}

/**
 * 体检拒绝 → 带稳定码的错误。
 *
 * 文案里要点名的东西（命令、键名、前缀）**在这里重算一遍**，不从体检报告的英文 detail 里反解——
 * detail 是给人看的诊断，不是给代码解析的结构；照着它切字符串，改一次措辞就会把界面上的中文
 * 变成半截英文。
 */
function refusal(
  report: ReturnType<typeof precheckMcpServer>,
  context: { command: string; env: Record<string, string>; secretRefs: Record<string, string> }
): McpServiceError {
  const code = mcpPrecheckErrorCode(report);
  const mapped = code ? PRECHECK_REFUSALS[code] : undefined;
  if (!code || !mapped) {
    // 体检说拒但没给出码：只可能是两边的检查项枚举漂移了。宁可回一句实话，也不要装作装成功。
    return new McpServiceError(422, "mcp_precheck_refused", mcpServersT("precheckRefused"));
  }
  const values: Record<string, string> = { command: context.command };
  if (code === "mcp_env_credential_shaped") {
    values["keys"] = Object.keys(context.env).filter(isDeniedPluginHostEnvKey).join("、");
  }
  if (code === "mcp_env_overrides_base") {
    values["keys"] = Object.keys(context.env)
      .filter((key) => (MCP_CHILD_ENV_ALLOWLIST as readonly string[]).includes(key))
      .join("、");
  }
  if (code === "mcp_secret_ref_out_of_scope") {
    values["keys"] = MCP_SECRET_REF_ENV_PREFIX;
  }
  return new McpServiceError(mapped.status, code, mcpServersT(mapped.copy, { values }));
}

let defaultDbClient: WorkHubDatabaseClient | undefined;
let defaultService: McpServerService | undefined;

/** 懒单例，与 `plugin-stores.ts` 同款：import 本模块不会碰 PG，只有真被调用时才建连接池。 */
export function getDefaultMcpServerService(): McpServerService {
  defaultDbClient ??= getSharedDatabaseClient();
  defaultService ??= createMcpServerService({
    repository: createMcpServerRepository(defaultDbClient.db),
    auditLog: getDefaultAuditStores().auditLogs
  });
  return defaultService;
}
