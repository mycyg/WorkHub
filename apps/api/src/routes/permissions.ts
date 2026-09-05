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
  toPermissionPolicyResponse,
  type CreateApprovalInput,
  type ApprovalService
} from "../services/approvals.js";
import {
  getDefaultWorkItemService,
  WorkItemServiceError,
  type WorkItemService
} from "../services/work-items.js";
import { readJsonObject } from "./json-body.js";
import { serviceT } from "../services/locales.js";
import { isUuidParam } from "./uuid-param.js";

export type PermissionRoutesDependencies = {
  auth?: AuthDependencySource;
  service?: ApprovalService;
  workItems?: Pick<WorkItemService, "detailPage"> | false;
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

  async function assertCanReadWorkItem(workItemId: string, actor: AuthEnv["Variables"]["actor"]) {
    const workItems = deps.workItems === false ? undefined : deps.workItems ?? getDefaultWorkItemService();
    if (!workItems) {
      throw new HTTPException(403, { message: serviceT("zh-CN", "taskViewForbidden") });
    }
    try {
      await workItems.detailPage({ workItemId, actor });
    } catch (error) {
      if (error instanceof WorkItemServiceError) {
        throw error;
      }
      throw error;
    }
  }

  function toPublicApprovalCreationResult(data: Awaited<ReturnType<ApprovalService["createApproval"]>>) {
    if (data.outcome !== "allowed" && data.outcome !== "denied") {
      return data;
    }
    return {
      outcome: data.outcome,
      decision: {
        effect: data.decision.effect,
        action_pattern: data.decision.actionPattern,
        ...(data.decision.reason ? { reason: data.decision.reason } : {})
      }
    };
  }

  routes.get("/", createCurrentUserMiddleware(authSource), async (c) => {
    requireAdmin(c);
    const data = (await service.listPolicies(c.var.actor)).map(toPermissionPolicyResponse);
    return c.json({ ok: true, data });
  });

  routes.put("/", createRequireLocalClientMiddleware(authSource), async (c) => {
    requireAdmin(c);
    const payload = permissionPolicyWriteSchema.parse(await readJsonObject(c));
    const data = toPermissionPolicyResponse(await service.createPolicy(c.var.actor, payload));
    return c.json({ ok: true, data });
  });

  // M24：撤销权限策略（含学到的 allow 授权）。管理员可从任一已认证客户端撤销；
  // 租户边界、软删除、等价规则收敛与审计仍由 service.revokePolicy 统一执行。
  routes.delete("/:id", createCurrentUserMiddleware(authSource), async (c) => {
    requireAdmin(c);
    const policyId = c.req.param("id");
    if (!isUuidParam(policyId)) {
      throw new HTTPException(404, { message: "找不到这条权限策略。" });
    }
    const data = toPermissionPolicyResponse(await service.revokePolicy(c.var.actor, policyId));
    return c.json({ ok: true, data });
  });

  routes.post("/ask", createCurrentUserMiddleware(authSource), async (c) => {
    const rawPayload = await readJsonObject(c);
    const rawWorkItemId = rawPayload.work_item_id;
    if (typeof rawWorkItemId === "string" && isUuidParam(rawWorkItemId)) {
      await assertCanReadWorkItem(rawWorkItemId, c.var.actor);
    }
    const payload = createApprovalRequestSchema.parse(rawPayload);
    if (!payload.work_item_id && payload.routed_to_user_id && payload.routed_to_user_id !== c.var.currentUser.id) {
      throw new HTTPException(403, { message: serviceT("zh-CN", "approvalWithoutTaskContext") });
    }
    // 防止任意用户把待审批塞进别人的收件箱：非管理员只能把 /ask 路由给自己。
    // 服务端的合法升级（agent-runner → 路由给工作项负责人）走 service.createApproval 直连，不经此 HTTP 路由。
    if (payload.routed_to_user_id && payload.routed_to_user_id !== c.var.currentUser.id && !c.var.currentUser.isAdmin) {
      throw new HTTPException(403, { message: "你只能把审批请求路由给自己。" });
    }
    if (payload.work_item_id && payload.work_item_id !== rawWorkItemId) {
      await assertCanReadWorkItem(payload.work_item_id, c.var.actor);
    }
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
    return c.json({ ok: true, data: toPublicApprovalCreationResult(data) });
  });

  return routes;
}
