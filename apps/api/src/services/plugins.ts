/**
 * 插件治理服务（R24-P 阶段 1：装得进来、管得住）。
 *
 * 阶段 0 的「装了哪些插件」只活在一个 env 变量里：没有清单、没有启停、没有安装前体检、
 * 安装这个动作本身也没有审计。这一层把它变成可查询、可治理的记录，四条纪律：
 *
 * 1. **只有管理员**。装插件 = 往这台服务器上引入第三方代码（宿主子进程没有凭据，但仍以当前
 *    用户身份跑、能读写这台机器上该用户能碰的文件、能出网——见阶段 0 Note 的「这是容器，不是沙箱」）。
 * 2. **只认本机绝对目录**。npm 包名 / git url / tarball 会在安装期跑包自己的 prepare/postinstall，
 *    那是任何沙箱之外的任意代码执行（DB 的 source_kind CHECK 也钉死了这条）。
 * 3. **先体检再登记**。静态体检不执行插件任何代码（读 package.json）；拒装的三类各有自己的
 *    错误码，两端 UI 据此出人话，而不是把一段英文诊断直接甩给用户。
 * 4. **每个动作都落审计**。plugin.installed / plugin.enabled / plugin.disabled / plugin.removed。
 *
 * 登记之后立刻**试加载**（让宿主按新清单重新握手，读它的 list_tools 报告）。装不上不是异常——
 * 记 `status='load_failed'` 并把原因留在 load_report 里，这条记录照样在列表上，用户看得到原因、
 * 能选择移除或修好目录再启用一次。
 */
import {
  pluginVmSchema,
  type PluginCompatReport,
  type PluginListVM,
  type PluginLoadReportVM,
  type PluginVM
} from "@workhub/contracts";
import { hostBundledDshToolsVersion, type PluginLoadReport } from "@workhub/plugin-host";
import {
  type AuditLogRepository,
  type PluginRepository,
  type PluginRow
} from "@workhub/db";

import type { AuthActor } from "../middleware/auth.js";
import { getDefaultStructuredLogger } from "../logging.js";
import { parseOutputContract } from "../pages/output-contract.js";
import { getDefaultAuditStores } from "./audit-stores.js";
import { getDefaultPluginRepository } from "./plugin-stores.js";
import { inspectPluginSource, type PluginInspection } from "./plugin-compat.js";
import { getDefaultPluginHostClient, type PluginHostClient } from "./plugin-host-client.js";

export class PluginServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "PluginServiceError";
  }
}

/** 体检拒装的三类各有自己的码——UI 靠码出人话，不是靠解析英文诊断。 */
const BLOCK_CODE_BY_CHECK: Record<string, { code: string; message: string }> = {
  manifest: {
    code: "plugin_manifest_unreadable",
    message: "这个目录里没有可读的 package.json，装不进来。请确认路径指向插件目录本身。"
  },
  client_surface: {
    code: "plugin_client_surface_unsupported",
    message: "这是界面/主题类插件（声明了 dsh.client），WorkHub 的界面不是同一套技术，装不了。"
  },
  install_scripts: {
    code: "plugin_install_scripts_refused",
    message: "这个插件带安装期脚本（prepare/postinstall 等），会在安装时执行任意代码，我们不装。"
  }
};

export type PluginServiceDependencies = {
  repository: PluginRepository;
  auditLog: Pick<AuditLogRepository, "createAuditLog">;
  /** 宿主客户端：登记后试加载、启停后热重载。不注入则用进程内单例。 */
  host?: Pick<PluginHostClient, "reload" | "bootstrapPathCount">;
  /** 静态体检。注入点只为单测——生产就是读磁盘那一份。 */
  inspect?: (sourcePath: string) => Promise<PluginInspection>;
  hostDshToolsVersion?: string | undefined;
  now?: () => Date;
};

export type PluginService = {
  list(input: { actor: AuthActor }): Promise<PluginListVM>;
  install(input: { actor: AuthActor; sourcePath: string }): Promise<PluginVM>;
  setEnabled(input: { actor: AuthActor; id: string; enabled: boolean }): Promise<PluginVM>;
  remove(input: { actor: AuthActor; id: string }): Promise<{ removed: true }>;
};

type AdminScope = { userId: string; workspaceId: string; label: string };

function requireAdmin(actor: AuthActor): AdminScope {
  const userId = actor.userId?.trim();
  if (actor.kind !== "human" || !userId || !actor.isAdmin) {
    throw new PluginServiceError(
      403,
      "plugin_admin_required",
      "只有管理员可以管理插件。"
    );
  }
  return { userId, workspaceId: actor.workspaceId, label: actor.label };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function toLoadReportVm(value: unknown): PluginLoadReportVM | undefined {
  const record = asRecord(value);
  if (typeof record["loaded_at"] !== "string") {
    return undefined;
  }
  return {
    ok: record["ok"] === true,
    tool_count: typeof record["tool_count"] === "number" ? record["tool_count"] : 0,
    prompt_section_count: typeof record["prompt_section_count"] === "number" ? record["prompt_section_count"] : 0,
    ...(typeof record["error"] === "string" ? { error: record["error"] } : {}),
    loaded_at: record["loaded_at"]
  };
}

export function toPluginVm(row: PluginRow): PluginVM {
  const loadReport = toLoadReportVm(row.loadReport);
  // fail-closed 输出契约：VM 装配走样 → 500，而不是把半成品甩给客户端（同 pages/* 的既有口径）。
  return parseOutputContract(
    pluginVmSchema,
    {
      id: row.id,
      name: row.name,
      ...(row.version ? { version: row.version } : {}),
      source_kind: "local_path",
      source_path: row.sourcePath,
      enabled: row.enabled,
      status: row.status,
      tool_count: row.toolCount,
      compat_report: row.compatReport as unknown as PluginCompatReport,
      ...(loadReport ? { load_report: loadReport } : {}),
      ...(row.installedBy ? { installed_by: row.installedBy } : {}),
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString()
    },
    "plugin.vm"
  );
}

export function createPluginService(deps: PluginServiceDependencies): PluginService {
  const logger = getDefaultStructuredLogger();
  const now = deps.now ?? (() => new Date());
  const inspect = deps.inspect ?? ((sourcePath: string) => inspectPluginSource(sourcePath, { now }));
  const host = deps.host ?? getDefaultPluginHostClient();

  async function writeAudit(input: {
    scope: AdminScope;
    row: PluginRow;
    action: "plugin.installed" | "plugin.enabled" | "plugin.disabled" | "plugin.removed";
    detail?: Record<string, unknown>;
  }) {
    try {
      await deps.auditLog.createAuditLog({
        actorKind: "human",
        actorUserId: input.scope.userId,
        actorNickname: input.scope.label,
        workspaceId: input.scope.workspaceId,
        entityType: "plugin",
        entityId: input.row.id,
        action: input.action,
        detailJson: {
          plugin_name: input.row.name,
          ...(input.row.version ? { plugin_version: input.row.version } : {}),
          source_kind: "local_path",
          source_path: input.row.sourcePath,
          status: input.row.status,
          tool_count: input.row.toolCount,
          at: now().toISOString(),
          ...input.detail
        }
      });
    } catch (error) {
      // 审计写失败不该把一次已经生效的治理动作变成失败（与 agent-runner 既有 fail-open 口径一致），
      // 但必须留结构化日志，否则「没有审计」和「没发生过」分不清。
      logger.warn("plugin_audit_write_failed", { plugin_id: input.row.id, action: input.action, error });
    }
  }

  /**
   * 让宿主按最新清单重新握手，并把这个插件的加载结果回填进行。
   * 宿主起不来/没报到这条插件时，如实记成 load_failed 而不是假装装上了。
   */
  async function applyLoadResult(row: PluginRow, workspaceId: string): Promise<PluginRow> {
    let reports: PluginLoadReport[] = [];
    let hostError: string | undefined;
    try {
      reports = await host.reload(workspaceId);
    } catch (error) {
      hostError = error instanceof Error ? error.message : String(error);
    }
    const mine = reports.find((report) => report.path === row.sourcePath);
    const loadedAt = now().toISOString();
    if (!mine) {
      const updated = await deps.repository.updateLoadResult({
        workspaceId,
        id: row.id,
        status: "load_failed",
        toolCount: 0,
        loadReport: {
          ok: false,
          tool_count: 0,
          prompt_section_count: 0,
          error: hostError ?? "插件宿主没有报告这个插件的加载结果。",
          loaded_at: loadedAt
        },
        now: now()
      });
      return updated ?? row;
    }
    const updated = await deps.repository.updateLoadResult({
      workspaceId,
      id: row.id,
      status: mine.ok ? "installed" : "load_failed",
      toolCount: mine.ok ? mine.toolCount : 0,
      loadReport: {
        ok: mine.ok,
        tool_count: mine.toolCount,
        prompt_section_count: mine.promptSectionCount,
        ...(mine.error ? { error: mine.error } : {}),
        loaded_at: loadedAt
      },
      now: now()
    });
    return updated ?? row;
  }

  /** 宿主起不来不该让一个已经生效在 DB 上的治理动作失败——记一条日志，动作照旧算数。 */
  async function reloadQuietly(workspaceId: string) {
    try {
      await host.reload(workspaceId);
    } catch (error) {
      logger.warn("plugin_host_reload_failed", { workspace_id: workspaceId, error });
    }
  }

  async function requireRow(workspaceId: string, id: string): Promise<PluginRow> {
    const row = await deps.repository.findById(workspaceId, id);
    if (!row) {
      throw new PluginServiceError(404, "plugin_not_found", "没有找到这个插件。");
    }
    return row;
  }

  return {
    async list({ actor }) {
      const scope = requireAdmin(actor);
      const rows = await deps.repository.listForWorkspace(scope.workspaceId);
      const hostVersion = deps.hostDshToolsVersion ?? hostBundledDshToolsVersion();
      return {
        plugins: rows.map(toPluginVm),
        ...(hostVersion ? { host_dsh_tools_version: hostVersion } : {}),
        bootstrap_path_count: host.bootstrapPathCount()
      };
    },

    async install({ actor, sourcePath }) {
      const scope = requireAdmin(actor);
      const inspection = await inspect(sourcePath);
      if (inspection.report.verdict === "blocked") {
        const blocking = inspection.report.checks.find((check) => check.level === "block");
        const mapped = (blocking && BLOCK_CODE_BY_CHECK[blocking.id]) ?? {
          code: "plugin_incompatible",
          message: "这个插件跟当前部署不兼容，装不进来。"
        };
        throw new PluginServiceError(422, mapped.code, mapped.message);
      }
      const existing = await deps.repository.findBySourcePath(scope.workspaceId, inspection.sourcePath);
      if (existing) {
        throw new PluginServiceError(
          409,
          "plugin_already_installed",
          "这个目录已经装过了。要换一份就先移除旧的那条。"
        );
      }
      const created = await deps.repository.create({
        workspaceId: scope.workspaceId,
        name: inspection.name,
        ...(inspection.version ? { version: inspection.version } : {}),
        sourcePath: inspection.sourcePath,
        status: "installed",
        enabled: true,
        compatReport: inspection.report as unknown as Record<string, unknown>,
        toolCount: 0,
        installedBy: scope.userId,
        now: now()
      });
      const loaded = await applyLoadResult(created, scope.workspaceId);
      await writeAudit({
        scope,
        row: loaded,
        action: "plugin.installed",
        detail: { compat_verdict: inspection.report.verdict, load_ok: loaded.status === "installed" }
      });
      return toPluginVm(loaded);
    },

    async setEnabled({ actor, id, enabled }) {
      const scope = requireAdmin(actor);
      const row = await requireRow(scope.workspaceId, id);
      if (row.enabled === enabled) {
        // 幂等：已经是这个状态就直接回执，不重启宿主、不再记一条审计（会把审计流刷成噪音）。
        // 「装不上了想重试」走停用再启用，而不是对着启用按钮连点——那样看不出发生过什么。
        return toPluginVm(row);
      }
      const updated = await deps.repository.setEnabled({
        workspaceId: scope.workspaceId,
        id,
        enabled,
        now: now()
      });
      if (!updated) {
        throw new PluginServiceError(404, "plugin_not_found", "没有找到这个插件。");
      }
      // 启用要重新试加载（结果可能是 load_failed）；停用只需要让宿主按少一个插件的清单重起。
      let settled = updated;
      if (enabled) {
        settled = await applyLoadResult(updated, scope.workspaceId);
      } else {
        await reloadQuietly(scope.workspaceId);
      }
      await writeAudit({ scope, row: settled, action: enabled ? "plugin.enabled" : "plugin.disabled" });
      return toPluginVm(settled);
    },

    async remove({ actor, id }) {
      const scope = requireAdmin(actor);
      const row = await requireRow(scope.workspaceId, id);
      const removed = await deps.repository.remove(scope.workspaceId, id);
      if (!removed) {
        throw new PluginServiceError(404, "plugin_not_found", "没有找到这个插件。");
      }
      await reloadQuietly(scope.workspaceId);
      await writeAudit({ scope, row, action: "plugin.removed" });
      return { removed: true };
    }
  };
}

let defaultService: PluginService | undefined;

export function getDefaultPluginService(): PluginService {
  defaultService ??= createPluginService({
    repository: getDefaultPluginRepository(),
    auditLog: getDefaultAuditStores().auditLogs
  });
  return defaultService;
}
