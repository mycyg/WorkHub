import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import {
  type ApprovalCenterVM,
  type ApprovalRequest,
  delegateApprovalRequestSchema,
  respondApprovalRequestSchema
} from "@workhub/contracts";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  createApprovalService,
  type ApprovalService
} from "../services/approvals.js";
import {
  getDefaultWorkItemService,
  WorkItemServiceError,
  type WorkItemService
} from "../services/work-items.js";

export type ApprovalRoutesDependencies = {
  auth?: AuthDependencySource;
  service?: ApprovalService;
  workItems?: Pick<WorkItemService, "detailPage"> | false;
};

export function createApprovalRoutes(deps: ApprovalRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const service = deps.service ?? createApprovalService();
  const workItems = deps.workItems === false ? undefined : deps.workItems ?? getDefaultWorkItemService();

  async function canReadWorkItem(workItemId: string | undefined, actor: AuthEnv["Variables"]["actor"]) {
    if (!workItemId) {
      return true;
    }
    if (!workItems) {
      return false;
    }
    try {
      await workItems.detailPage({ workItemId, actor });
      return true;
    } catch (error) {
      if (error instanceof WorkItemServiceError && (error.status === 403 || error.status === 404)) {
        return false;
      }
      throw error;
    }
  }

  async function assertCanReadApproval(id: string, actor: AuthEnv["Variables"]["actor"]) {
    const approval = await service.get(id);
    if (!approval) {
      throw new HTTPException(404, { message: "没有找到这条审批。" });
    }
    if (!await canReadWorkItem(approval.work_item_id, actor)) {
      throw new HTTPException(403, { message: "你没有权限查看这条审批。" });
    }
    return approval;
  }

  async function visibleApprovalCenter(data: ApprovalCenterVM, actor: AuthEnv["Variables"]["actor"]) {
    const visibleRequests: ApprovalRequest[] = [];
    const visibleRequestIds = new Set<string>();
    for (const request of data.requests) {
      if (await canReadWorkItem(request.work_item_id, actor)) {
        visibleRequests.push(request);
        visibleRequestIds.add(request.id);
      }
    }
    return {
      ...data,
      items: data.items.filter((item) => {
        const id = item.source_ref?.entity_type === "approval_request" ? item.source_ref.entity_id : item.id;
        return visibleRequestIds.has(id) || (item.source_ref?.entity_id && visibleRequestIds.has(item.source_ref.entity_id));
      }),
      requests: visibleRequests,
      counts: {
        ...data.counts,
        pending: visibleRequests.length
      }
    };
  }

  routes.get("/", createCurrentUserMiddleware(authSource), async (c) => {
    const data = await service.listPendingForUser(c.var.currentUser);
    return c.json({ ok: true, data: await visibleApprovalCenter(data, c.var.actor) });
  });

  routes.post("/:id/respond", createCurrentUserMiddleware(authSource), async (c) => {
    await assertCanReadApproval(c.req.param("id"), c.var.actor);
    const payload = respondApprovalRequestSchema.parse(await c.req.json());
    const data = await service.respond(c.req.param("id"), c.var.actor, payload);
    return c.json({ ok: true, data });
  });

  routes.post("/:id/delegate", createCurrentUserMiddleware(authSource), async (c) => {
    await assertCanReadApproval(c.req.param("id"), c.var.actor);
    const payload = delegateApprovalRequestSchema.parse(await c.req.json());
    const data = await service.delegate(c.req.param("id"), c.var.actor, payload.to_user_id);
    return c.json({ ok: true, data });
  });

  return routes;
}
