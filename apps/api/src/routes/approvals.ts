import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import {
  type ApprovalCenterVM,
  type ApprovalRequest,
  addApprovalCommentRequestSchema,
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
    // L#W2-15：无 work item 的审批（工具/权限类）不能因 canReadWorkItem(undefined)=true 而对所有登录用户敞开——
    // 这类按 id 直达的端点（respond/delegate/comments）要求管理员或被路由到的本人。
    if (!approval.work_item_id) {
      const actorUserId = actor.userId ?? actor.id;
      if (!actor.isAdmin && approval.routed_to_user_id !== actorUserId) {
        throw new HTTPException(403, { message: "你没有权限查看这条审批。" });
      }
      return approval;
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
    const visibleItems = data.items.filter((item) => {
      const id = item.source_ref?.entity_type === "approval_request" ? item.source_ref.entity_id : item.id;
      return visibleRequestIds.has(id) || (item.source_ref?.entity_id && visibleRequestIds.has(item.source_ref.entity_id));
    });
    // W2：items_detail 按可见 item.id 收口，不把不可见事项的详情泄露出去。
    const visibleItemIds = new Set(visibleItems.map((item) => item.id));
    const visibleItemsDetail = Object.fromEntries(
      Object.entries(data.items_detail).filter(([itemId]) => visibleItemIds.has(itemId))
    );
    return {
      ...data,
      items: visibleItems,
      items_detail: visibleItemsDetail,
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

  // W2：审批工作台「相关讨论」评论流，读写都过同一资源可见性闸门。
  routes.get("/:id/comments", createCurrentUserMiddleware(authSource), async (c) => {
    await assertCanReadApproval(c.req.param("id"), c.var.actor);
    const data = await service.listComments(c.req.param("id"));
    return c.json({ ok: true, data });
  });

  routes.post("/:id/comments", createCurrentUserMiddleware(authSource), async (c) => {
    await assertCanReadApproval(c.req.param("id"), c.var.actor);
    const payload = addApprovalCommentRequestSchema.parse(await c.req.json());
    const data = await service.addComment(c.req.param("id"), c.var.actor, payload.body);
    return c.json({ ok: true, data });
  });

  return routes;
}
