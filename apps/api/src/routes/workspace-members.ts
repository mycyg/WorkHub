import { Hono } from "hono";

import {
  updateWorkspaceMemberRoleRequestSchema,
  workspaceRosterQuerySchema,
  type WorkspaceRosterMemberVM,
  type WorkspaceRosterResultVM
} from "@workhub/contracts";
import {
  createWorkspaceMembershipRepository,
  getSharedDatabaseClient,
  type WorkspaceMembershipRepository
} from "@workhub/db";

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

// R20 P2A（P1-08 修复 · workspace-scoped roster）：读花名册所需的成员仓库子集——门控用
// findActiveForUserWorkspace（确认发起人确属本工作区），取数用 listActiveRosterPageByWorkspace（分页 join）。
// 仓库接口把 listActiveRosterPageByWorkspace 标为 OPTIONAL（不逼各处假仓库实现），但 roster 端点必须拿到它，
// 故这里用 NonNullable 把它收窄为必备——默认读者在解析时做存在性兜底，单测注入的假读者也恒实现。
export type WorkspaceRosterReader = {
  findActiveForUserWorkspace: WorkspaceMembershipRepository["findActiveForUserWorkspace"];
  listActiveRosterPageByWorkspace: NonNullable<WorkspaceMembershipRepository["listActiveRosterPageByWorkspace"]>;
};

export type WorkspaceMemberRoutesDependencies = {
  auth?: AuthDependencySource;
  members?: WorkspaceMemberService;
  // OPTIONAL——未注入则请求命中 roster 端点时懒解析共享 DB 仓库；单测注入内存假读者。
  roster?: WorkspaceRosterReader;
};

// 懒解析默认 roster 读者：只在真正命中 roster 端点且未注入读者时才触库，避免 createWorkspaceMemberRoutes
// 构造期就连 DB（否则不注入 roster 的既有单测会误连库）。
let defaultRosterReader: WorkspaceRosterReader | undefined;
function getDefaultWorkspaceRosterReader(): WorkspaceRosterReader {
  if (!defaultRosterReader) {
    const repo = createWorkspaceMembershipRepository(getSharedDatabaseClient().db);
    const listActiveRosterPageByWorkspace = repo.listActiveRosterPageByWorkspace;
    if (!listActiveRosterPageByWorkspace) {
      throw new Error("workspace membership repository does not support roster paging");
    }
    defaultRosterReader = {
      findActiveForUserWorkspace: repo.findActiveForUserWorkspace,
      listActiveRosterPageByWorkspace
    };
  }
  return defaultRosterReader;
}

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

  // R20 P2A（P1-08 修复 · workspace-scoped roster）：任意工作区成员读本工作区花名册，分页返回。
  // 取代消费端误用的全局 /api/users（跨租户泄露 + 全局排序 + 硬 200 截断）。门控＝调用者须为本工作区
  // active 真人成员（capability：工作区成员可读，比 /workspace/members 的管理员门更宽）；数据经 membership
  // join 严格按 actor.workspaceId 隔离。roster 读者懒解析，避免不注入时构造期触库。
  routes.get("/workspace/roster", requireCurrentUser, async (c) => {
    const roster = deps.roster ?? getDefaultWorkspaceRosterReader();
    const actor = c.var.actor;
    const workspaceId = actor.workspaceId?.trim();
    const actorUserId = actor.userId?.trim();
    // 非真人 / 无 userId / 无工作区 → 无从判定归属，直接拒。
    if (actor.kind !== "human" || !actorUserId || !workspaceId) {
      throw new WorkspaceMemberServiceError(403, "roster_forbidden", "需要已加入工作区的真人用户才能查看成员名册。");
    }
    // capability 门控：确认发起人确有本工作区 active 成员行——非成员（含被移出的墓碑）一律 403，
    // 绝不落到取数（fail-closed，与 SEC-1 resolveHumanActor 同philosophy，且不依赖中间件已做过同款校验）。
    const membership = await roster.findActiveForUserWorkspace(actorUserId, workspaceId);
    if (!membership) {
      throw new WorkspaceMemberServiceError(403, "roster_forbidden", "只有本工作区成员可以查看成员名册。");
    }
    const query = workspaceRosterQuerySchema.parse({
      limit: c.req.query("limit"),
      offset: c.req.query("offset")
    });
    const pageResult = await roster.listActiveRosterPageByWorkspace(workspaceId, {
      limit: query.limit,
      offset: query.offset
    });
    const selfId = actorUserId.toLowerCase();
    const rosterMembers: WorkspaceRosterMemberVM[] = pageResult.members.map((row) => ({
      user_id: row.userId,
      nickname: row.nickname,
      role: row.role,
      joined_at: row.joinedAt.toISOString(),
      is_self: row.userId.toLowerCase() === selfId,
      // R20 P1-08 收尾：全局管理员标签（非本工作区角色）——供转交选择器等消费端摆脱全局 /api/users。
      is_admin: row.isAdmin,
      // 头像占位：非空＝有头像（客户端据此取 /api/users/:id/avatar 并用作缓存键）；此处不带二进制。
      avatar_updated_at: row.avatarUpdatedAt ? row.avatarUpdatedAt.toISOString() : null,
      // 在线态占位：presence 接线在后续批次，字段先就位、恒 null。
      online: null
    }));
    const data: WorkspaceRosterResultVM = {
      members: rosterMembers,
      total: pageResult.total,
      limit: query.limit,
      offset: query.offset
    };
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
