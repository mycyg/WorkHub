import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import {
  createApprovalRequestSchema,
  permissionPolicyWriteSchema
} from "@workhub/contracts";

import {
  createCurrentUserMiddleware,
  createRequireLocalClientMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  createApprovalService,
  type CreateApprovalInput,
  type ApprovalService
} from "../services/approvals.js";

export type PermissionRoutesDependencies = {
  auth?: AuthDependencySource;
  service?: ApprovalService;
};

export function createPermissionRoutes(deps: PermissionRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const service = deps.service ?? createApprovalService();

  // 权限策略是 org 级治理面（§4.2 admin 治理角色/策略/配额）：读写均 admin-only。
  function requireAdmin(c: { var: { currentUser: { isAdmin: boolean } } }) {
    if (!c.var.currentUser.isAdmin) {
      throw new HTTPException(403, { message: "只有管理员可以查看或修改权限策略。" });
    }
  }

  routes.get("/", createCurrentUserMiddleware(authSource), async (c) => {
    requireAdmin(c);
    const data = await service.listPolicies();
    return c.json({ ok: true, data });
  });

  routes.put("/", createRequireLocalClientMiddleware(authSource), async (c) => {
    requireAdmin(c);
    const payload = permissionPolicyWriteSchema.parse(await c.req.json());
    const data = await service.createPolicy(c.var.actor, payload);
    return c.json({ ok: true, data });
  });

  routes.post("/ask", createCurrentUserMiddleware(authSource), async (c) => {
    const payload = createApprovalRequestSchema.parse(await c.req.json());
    const input: CreateApprovalInput = {
      actor: c.var.actor,
      kind: payload.kind,
      actionPattern: payload.action_pattern,
      payloadJson: payload.payload_json
    };
    if (payload.work_item_id) {
      input.workItemId = payload.work_item_id;
    }
    if (payload.agent_run_id) {
      input.agentRunId = payload.agent_run_id;
    }
    if (payload.routed_to_user_id) {
      input.routedToUserId = payload.routed_to_user_id;
    }
    if (payload.sla_due_at) {
      input.slaDueAt = new Date(payload.sla_due_at);
    }
    const data = await service.createApproval(input);
    return c.json({ ok: true, data });
  });

  return routes;
}
