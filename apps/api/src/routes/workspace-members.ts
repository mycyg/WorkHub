import { Hono } from "hono";

import { updateWorkspaceMemberRoleRequestSchema } from "@workhub/contracts";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  WorkspaceMemberServiceError,
  getDefaultWorkspaceMemberService,
  type WorkspaceMemberService
} from "../services/workspace-members.js";
import { readJsonObject } from "./json-body.js";
import { isUuidParam } from "./uuid-param.js";

// R17 批 G1（群成员管理 · #15 工作区成员移出/角色变更）：DELETE /api/workspace/members/:userId 移出、
// PATCH /api/workspace/members/:userId 改角色。权限红线（仅 admin/owner、不能对自己动手、不能移出/降级
// 最后一名特权成员）全在 services/workspace-members.ts 里做，路由层只做 param/body 校验与成形响应。
// 错误经 app.onError 的 WorkspaceMemberServiceError 分支映射。

export type WorkspaceMemberRoutesDependencies = {
  auth?: AuthDependencySource;
  members?: WorkspaceMemberService;
};

function requireTargetUserId(value: string) {
  if (!isUuidParam(value)) {
    throw new WorkspaceMemberServiceError(404, "member_not_found", "没有找到这个工作区里的这个成员。");
  }
  return value;
}

export function createWorkspaceMemberRoutes(deps: WorkspaceMemberRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const members = deps.members ?? getDefaultWorkspaceMemberService();
  const requireCurrentUser = createCurrentUserMiddleware(authSource);

  // R18 批 H1（成员清单）：管理员读本工作区 roster（昵称/角色/加入时间/是否本人）。门控在服务层
  // assertManager 里做（非管理员 403），路由层只成形响应。供 web /settings 成员分区渲染。
  routes.get("/workspace/members", requireCurrentUser, async (c) => {
    const data = await members.listMembers({ actor: c.var.actor });
    return c.json({ ok: true, data });
  });

  routes.delete("/workspace/members/:userId", requireCurrentUser, async (c) => {
    const targetUserId = requireTargetUserId(c.req.param("userId"));
    const data = await members.removeMember({ actor: c.var.actor, targetUserId });
    return c.json({ ok: true, data });
  });

  routes.patch("/workspace/members/:userId", requireCurrentUser, async (c) => {
    const targetUserId = requireTargetUserId(c.req.param("userId"));
    const payload = updateWorkspaceMemberRoleRequestSchema.parse(await readJsonObject(c));
    const data = await members.updateMemberRole({ actor: c.var.actor, targetUserId, role: payload.role });
    return c.json({ ok: true, data });
  });

  return routes;
}
