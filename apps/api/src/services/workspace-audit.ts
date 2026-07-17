// R20 P2A（R19-21 工作区审计列表 · 纯后端 · 仅管理员）：GET /api/workspace/audit 的服务层。
// 此前审计只有 forEntity/forWorkItem 两个读口 + 单工作项时间线端点，缺一个「工作区级」跨工作项审计流。
// 这里补上：仅管理员可读；按 actor.workspaceId 硬隔离（客户端不能传 workspace，杜绝越租户读）；
// 支持操作者 / 动作 / 时间范围过滤 + 分页；时间倒序。非管理员抛 HTTPException 403（app.onError 已映射
// 成 forbidden），不新起错误类型。
import { HTTPException } from "hono/http-exception";

import {
  WORKSPACE_AUDIT_DEFAULT_LIMIT,
  WORKSPACE_AUDIT_MAX_LIMIT,
  type WorkspaceAuditListVM,
  type WorkspaceAuditQuery
} from "@workhub/contracts";
import {
  createWorkspaceAuditLogRepository,
  getSharedDatabaseClient,
  type WorkspaceAuditLogRepository,
  type WorkHubDatabaseClient
} from "@workhub/db";

import type { AuthActor } from "../middleware/auth.js";
import { toAuditLogFact } from "../pages/replay.js";

export type WorkspaceAuditService = {
  list: (input: { actor: AuthActor; query: WorkspaceAuditQuery }) => Promise<WorkspaceAuditListVM>;
};

export type WorkspaceAuditServiceDependencies = {
  auditLogs: WorkspaceAuditLogRepository;
  now?: () => Date;
};

export function createWorkspaceAuditService(deps: WorkspaceAuditServiceDependencies): WorkspaceAuditService {
  const now = deps.now ?? (() => new Date());

  return {
    async list({ actor, query }) {
      // 仅管理员——工作区级审计流是特权视图。非管理员一律拒（不因过滤条件放行）。
      if (!actor.isAdmin) {
        throw new HTTPException(403, { message: "需要管理员权限查看工作区审计。" });
      }
      const limit = Math.min(Math.max(query.limit ?? WORKSPACE_AUDIT_DEFAULT_LIMIT, 1), WORKSPACE_AUDIT_MAX_LIMIT);
      const offset = Math.max(query.offset ?? 0, 0);
      const rows = await deps.auditLogs.listAuditLogsForWorkspace({
        // 硬隔离：workspace 恒取自认证身份，忽略任何客户端输入。
        workspaceId: actor.workspaceId,
        actorUserId: query.actor_user_id,
        action: query.action,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
        limit,
        offset
      });
      return {
        generated_at: now().toISOString(),
        workspace_id: actor.workspaceId,
        audit_logs: rows.map(toAuditLogFact),
        page: { limit, offset, count: rows.length }
      };
    }
  };
}

let defaultDbClient: WorkHubDatabaseClient | undefined;
let defaultService: WorkspaceAuditService | undefined;

export function getDefaultWorkspaceAuditService(): WorkspaceAuditService {
  if (!defaultService) {
    defaultDbClient = getSharedDatabaseClient();
    defaultService = createWorkspaceAuditService({
      auditLogs: createWorkspaceAuditLogRepository(defaultDbClient.db)
    });
  }
  return defaultService;
}
