// R20 P2A（R19-21 工作区审计列表 · 仅管理员）：GET /api/workspace/audit 的 HTTP 出口。
// 查询串（actor_user_id / action / from / to / limit / offset）经 zod 收口；workspace 恒取自认证身份，
// 不从查询串读（服务层硬隔离）。非管理员由服务层抛 HTTPException 403，经 app.onError 统一映射。
import { Hono } from "hono";

import { workspaceAuditQuerySchema } from "@workhub/contracts";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  getDefaultWorkspaceAuditService,
  type WorkspaceAuditService
} from "../services/workspace-audit.js";

export type WorkspaceAuditRoutesDependencies = {
  auth?: AuthDependencySource;
  workspaceAudit?: WorkspaceAuditService;
};

export function createWorkspaceAuditRoutes(deps: WorkspaceAuditRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const workspaceAudit = deps.workspaceAudit ?? getDefaultWorkspaceAuditService();

  routes.get("/workspace/audit", createCurrentUserMiddleware(authSource), async (c) => {
    const query = workspaceAuditQuerySchema.parse({
      ...(c.req.query("actor_user_id") ? { actor_user_id: c.req.query("actor_user_id") } : {}),
      ...(c.req.query("action") ? { action: c.req.query("action") } : {}),
      ...(c.req.query("from") ? { from: c.req.query("from") } : {}),
      ...(c.req.query("to") ? { to: c.req.query("to") } : {}),
      ...(c.req.query("limit") !== undefined ? { limit: c.req.query("limit") } : {}),
      ...(c.req.query("offset") !== undefined ? { offset: c.req.query("offset") } : {})
    });
    const data = await workspaceAudit.list({ actor: c.var.actor, query });
    return c.json({ ok: true, data });
  });

  return routes;
}
