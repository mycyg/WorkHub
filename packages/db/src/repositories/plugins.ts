import { randomUUID } from "node:crypto";

import { and, asc, eq, ne } from "drizzle-orm";

import type { WorkHubDb } from "../client.js";
import { plugins } from "../schema/index.js";

// R24-P 阶段 1（见 0072 迁移）：插件清单的数据搬运层。这里只做「读写这张表」——
// 静态体检、试加载、启停后的宿主热重载、审计全部留在应用层（apps/api/src/services/plugins.ts）。
// 全部原语都带 workspaceId 谓词：插件是工作区级治理对象，跨租户读写在 SQL 层就不成立，
// 不依赖调用方记得加过滤（与 permission_policies 同口径）。

export type PluginRow = typeof plugins.$inferSelect;

export type CreatePluginInput = {
  /** 测试可注入确定性 id；生产默认 randomUUID（id 列无 DB 默认值，见 0072）。 */
  id?: string;
  workspaceId: string;
  name: string;
  version?: string;
  sourcePath: string;
  status: PluginRow["status"];
  enabled?: boolean;
  compatReport: Record<string, unknown>;
  loadReport?: Record<string, unknown>;
  toolCount?: number;
  installedBy?: string;
  now?: Date;
};

export type UpdatePluginLoadResultInput = {
  workspaceId: string;
  id: string;
  status: PluginRow["status"];
  toolCount: number;
  loadReport: Record<string, unknown>;
  now?: Date;
};

export type PluginRepository = {
  /** 列表：一个工作区里的全部插件，最早装的在前（列表顺序稳定，不随启停跳动）。 */
  listForWorkspace: (workspaceId: string) => Promise<PluginRow[]>;
  /** 宿主装配用：启用且未被停用的行——加载失败的仍然带上（下次重启可能就好了，是否重试由应用层定）。 */
  listEnabledForWorkspace: (workspaceId: string) => Promise<PluginRow[]>;
  findById: (workspaceId: string, id: string) => Promise<PluginRow | null>;
  findBySourcePath: (workspaceId: string, sourcePath: string) => Promise<PluginRow | null>;
  create: (input: CreatePluginInput) => Promise<PluginRow>;
  /** 试加载完成后回填 status/tool_count/load_report。 */
  updateLoadResult: (input: UpdatePluginLoadResultInput) => Promise<PluginRow | null>;
  /**
   * 启停。enabled=false 时 status 翻 'disabled'；重新启用时回到 'installed'——
   * 真实状态由随后的试加载再修正（失败会被 updateLoadResult 翻成 'load_failed'）。
   */
  setEnabled: (input: { workspaceId: string; id: string; enabled: boolean; now?: Date }) => Promise<PluginRow | null>;
  /** 移除：硬删。插件不是业务数据，留墓碑没有意义；做过什么在 audit_logs 里。 */
  remove: (workspaceId: string, id: string) => Promise<boolean>;
};

export function createPluginRepository(db: WorkHubDb): PluginRepository {
  return {
    async listForWorkspace(workspaceId) {
      return db
        .select()
        .from(plugins)
        .where(eq(plugins.workspaceId, workspaceId))
        .orderBy(asc(plugins.createdAt), asc(plugins.id));
    },
    async listEnabledForWorkspace(workspaceId) {
      return db
        .select()
        .from(plugins)
        .where(
          and(eq(plugins.workspaceId, workspaceId), eq(plugins.enabled, true), ne(plugins.status, "disabled"))
        )
        .orderBy(asc(plugins.createdAt), asc(plugins.id));
    },
    async findById(workspaceId, id) {
      const rows = await db
        .select()
        .from(plugins)
        .where(and(eq(plugins.workspaceId, workspaceId), eq(plugins.id, id)))
        .limit(1);
      return rows[0] ?? null;
    },
    async findBySourcePath(workspaceId, sourcePath) {
      const rows = await db
        .select()
        .from(plugins)
        .where(and(eq(plugins.workspaceId, workspaceId), eq(plugins.sourcePath, sourcePath)))
        .limit(1);
      return rows[0] ?? null;
    },
    async create(input) {
      const at = input.now ?? new Date();
      const rows = await db
        .insert(plugins)
        .values({
          id: input.id ?? randomUUID(),
          workspaceId: input.workspaceId,
          name: input.name,
          version: input.version ?? null,
          sourceKind: "local_path",
          sourcePath: input.sourcePath,
          enabled: input.enabled ?? true,
          status: input.status,
          compatReport: input.compatReport,
          loadReport: input.loadReport ?? null,
          toolCount: input.toolCount ?? 0,
          installedBy: input.installedBy ?? null,
          createdAt: at,
          updatedAt: at
        })
        .returning();
      const row = rows[0];
      if (!row) {
        throw new Error("failed to insert plugin row");
      }
      return row;
    },
    async updateLoadResult(input) {
      const rows = await db
        .update(plugins)
        .set({
          status: input.status,
          toolCount: input.toolCount,
          loadReport: input.loadReport,
          updatedAt: input.now ?? new Date()
        })
        .where(and(eq(plugins.workspaceId, input.workspaceId), eq(plugins.id, input.id)))
        .returning();
      return rows[0] ?? null;
    },
    async setEnabled(input) {
      const rows = await db
        .update(plugins)
        .set({
          enabled: input.enabled,
          status: input.enabled ? "installed" : "disabled",
          updatedAt: input.now ?? new Date()
        })
        .where(and(eq(plugins.workspaceId, input.workspaceId), eq(plugins.id, input.id)))
        .returning();
      return rows[0] ?? null;
    },
    async remove(workspaceId, id) {
      const rows = await db
        .delete(plugins)
        .where(and(eq(plugins.workspaceId, workspaceId), eq(plugins.id, id)))
        .returning({ id: plugins.id });
      return rows.length > 0;
    }
  };
}
