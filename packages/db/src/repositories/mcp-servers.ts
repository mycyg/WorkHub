import { randomUUID } from "node:crypto";

import { and, asc, eq, ne } from "drizzle-orm";

import type { WorkHubDb } from "../client.js";
import { mcpServers } from "../schema/index.js";

// R26 M0（MCP 客户端接入·阶段 0，见 0073 迁移）：MCP 服务器清单的数据搬运层。这里只做「读写这张
// 表」——静态体检、试连接、启停后的重连、审计全部留在应用层（M2/M3 的 services/mcp-servers.ts 与
// services/mcp-client.ts）。全部原语都带 workspaceId 谓词：MCP 服务器是工作区级治理对象，跨租户
// 读写在 SQL 层就不成立，不依赖调用方记得加过滤（与 plugins/permission_policies 同口径）。

export type McpServerRow = typeof mcpServers.$inferSelect;

export type CreateMcpServerInput = {
  /** 测试可注入确定性 id；生产默认 randomUUID（id 列无 DB 默认值，见 0073）。 */
  id?: string;
  workspaceId: string;
  serverName: string;
  displayName?: string;
  command: string;
  args?: string[];
  /** 只允许非密键；应用层已过凭据形状黑名单，本表结构性存不进密文。 */
  env?: Record<string, string>;
  /** {子进程 env 名: 服务端 env 名}——存指针不是值。 */
  secretRefs?: Record<string, string>;
  cwd?: string;
  toolCallTimeoutMs?: number;
  enabled?: boolean;
  status: McpServerRow["status"];
  /** 管理员断言的读写分级上限；未传时落 DB 默认 'external_effect'（新增服务器不假设它安全）。 */
  trustLevel?: McpServerRow["trustLevel"];
  precheckReport: Record<string, unknown>;
  lastError?: string;
  toolCount?: number;
  tools?: string[];
  installedBy?: string;
  now?: Date;
};

export type UpdateMcpServerConnectionResultInput = {
  workspaceId: string;
  id: string;
  status: McpServerRow["status"];
  toolCount: number;
  /** 最近一次发现的工具名清单；成功时给数组，失败/未知时传 null 或省略清空旧清单。 */
  tools?: string[] | null;
  /** 握手/调用失败的人话原因；成功时省略或传 null 清空上一次的错误。 */
  lastError?: string | null;
  now?: Date;
};

export type McpServerRepository = {
  /** 列表：一个工作区里的全部 MCP 服务器，最早登记的在前（列表顺序稳定，不随启停/重连跳动）。 */
  listForWorkspace: (workspaceId: string) => Promise<McpServerRow[]>;
  /**
   * 连接监督用：启用且未被停用的行——上次连接失败的仍然带上（下次重试可能就好了，
   * 是否重试、按什么退避由应用层定）。
   */
  listEnabledForWorkspace: (workspaceId: string) => Promise<McpServerRow[]>;
  findById: (workspaceId: string, id: string) => Promise<McpServerRow | null>;
  /** server_name 在工作区内唯一——新增前查重复，唯一索引兜底真正的并发保证。 */
  findByServerName: (workspaceId: string, serverName: string) => Promise<McpServerRow | null>;
  create: (input: CreateMcpServerInput) => Promise<McpServerRow>;
  /** 试连接/重连完成后回填 status/tool_count/tools_json/last_error。 */
  updateConnectionResult: (input: UpdateMcpServerConnectionResultInput) => Promise<McpServerRow | null>;
  /**
   * 启停。enabled=false 时 status 强制翻 'disabled'（一台停用的服务器不该继续声称自己连着）。
   * 重新启用时 status 落回 'connect_failed'——MCP 没有 plugins 那个中性的 'installed' 态，
   * 重新启用不等于「已验证连接」，真实状态由紧随其后的同一次治理动作里的试连接
   * （updateConnectionResult）再修正。
   */
  setEnabled: (input: { workspaceId: string; id: string; enabled: boolean; now?: Date }) => Promise<McpServerRow | null>;
  /** 移除：硬删。MCP 服务器登记不是业务数据，留墓碑没有意义；做过什么在 audit_logs 里。 */
  remove: (workspaceId: string, id: string) => Promise<boolean>;
};

export function createMcpServerRepository(db: WorkHubDb): McpServerRepository {
  return {
    async listForWorkspace(workspaceId) {
      return db
        .select()
        .from(mcpServers)
        .where(eq(mcpServers.workspaceId, workspaceId))
        .orderBy(asc(mcpServers.createdAt), asc(mcpServers.id));
    },
    async listEnabledForWorkspace(workspaceId) {
      return db
        .select()
        .from(mcpServers)
        .where(
          and(eq(mcpServers.workspaceId, workspaceId), eq(mcpServers.enabled, true), ne(mcpServers.status, "disabled"))
        )
        .orderBy(asc(mcpServers.createdAt), asc(mcpServers.id));
    },
    async findById(workspaceId, id) {
      const rows = await db
        .select()
        .from(mcpServers)
        .where(and(eq(mcpServers.workspaceId, workspaceId), eq(mcpServers.id, id)))
        .limit(1);
      return rows[0] ?? null;
    },
    async findByServerName(workspaceId, serverName) {
      const rows = await db
        .select()
        .from(mcpServers)
        .where(and(eq(mcpServers.workspaceId, workspaceId), eq(mcpServers.serverName, serverName)))
        .limit(1);
      return rows[0] ?? null;
    },
    async create(input) {
      const at = input.now ?? new Date();
      const rows = await db
        .insert(mcpServers)
        .values({
          id: input.id ?? randomUUID(),
          workspaceId: input.workspaceId,
          serverName: input.serverName,
          displayName: input.displayName ?? null,
          transport: "stdio",
          command: input.command,
          argsJson: input.args ?? [],
          envJson: input.env ?? {},
          secretRefsJson: input.secretRefs ?? {},
          cwd: input.cwd ?? null,
          toolCallTimeoutMs: input.toolCallTimeoutMs ?? 60000,
          enabled: input.enabled ?? true,
          status: input.status,
          trustLevel: input.trustLevel ?? "external_effect",
          precheckReport: input.precheckReport,
          lastError: input.lastError ?? null,
          toolCount: input.toolCount ?? 0,
          toolsJson: input.tools ?? null,
          installedBy: input.installedBy ?? null,
          createdAt: at,
          updatedAt: at
        })
        .returning();
      const row = rows[0];
      if (!row) {
        throw new Error("failed to insert mcp_servers row");
      }
      return row;
    },
    async updateConnectionResult(input) {
      const rows = await db
        .update(mcpServers)
        .set({
          status: input.status,
          toolCount: input.toolCount,
          toolsJson: input.tools ?? null,
          lastError: input.lastError ?? null,
          updatedAt: input.now ?? new Date()
        })
        .where(and(eq(mcpServers.workspaceId, input.workspaceId), eq(mcpServers.id, input.id)))
        .returning();
      return rows[0] ?? null;
    },
    async setEnabled(input) {
      const rows = await db
        .update(mcpServers)
        .set({
          enabled: input.enabled,
          status: input.enabled ? "connect_failed" : "disabled",
          updatedAt: input.now ?? new Date()
        })
        .where(and(eq(mcpServers.workspaceId, input.workspaceId), eq(mcpServers.id, input.id)))
        .returning();
      return rows[0] ?? null;
    },
    async remove(workspaceId, id) {
      const rows = await db
        .delete(mcpServers)
        .where(and(eq(mcpServers.workspaceId, workspaceId), eq(mcpServers.id, id)))
        .returning({ id: mcpServers.id });
      return rows.length > 0;
    }
  };
}
