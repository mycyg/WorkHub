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
  ApprovalServiceError,
  createApprovalService,
  toPermissionPolicyResponse,
  type ApprovalService
} from "../services/approvals.js";
import {
  getDefaultWorkItemService,
  type WorkItemService
} from "../services/work-items.js";
import { readJsonObject } from "./json-body.js";
import { isUuidParam } from "./uuid-param.js";

export type ApprovalRoutesDependencies = {
  auth?: AuthDependencySource;
  service?: ApprovalService;
  workItems?: Pick<WorkItemService, "canReadWorkItems"> | false;
};

export function createApprovalRoutes(deps: ApprovalRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const service = deps.service ?? createApprovalService();
  const workItems = deps.workItems === false ? undefined : deps.workItems ?? getDefaultWorkItemService();

  // routes-a-2/routes-b-1/services-a-2/xlink-authz-4/ux-web-govern-6：可见性判定改用轻量批量接口
  // （workItems.canReadWorkItems，一次 IN 查询 access record）而不是逐次完整 detailPage 装配只为拿一个 boolean。
  async function canReadWorkItem(workItemId: string | undefined, actor: AuthEnv["Variables"]["actor"]) {
    if (!workItemId) {
      return true;
    }
    if (!workItems) {
      return false;
    }
    const visible = await workItems.canReadWorkItems({ workItemIds: [workItemId], actor });
    return visible.has(workItemId);
  }

  async function assertCanReadApproval(id: string, actor: AuthEnv["Variables"]["actor"]) {
    // 与所有兄弟 :id 路由一致:非 uuid 直接 404,别把 `id` 透传到 PG uuid 列引发 22P02→未处理 500(且 500/404 状态差异泄露存在性)。
    if (!isUuidParam(id)) {
      throw new HTTPException(404, { message: "没有找到这条审批。" });
    }
    const approval = await service.get(id);
    if (!approval) {
      throw new HTTPException(404, { message: "没有找到这条审批。" });
    }
    // L#W2-15：无 work item 的审批（工具/权限类）不能因 canReadWorkItem(undefined)=true 而对所有登录用户敞开。
    // approval_requests 没有 org/workspace 列，admin 也没有可靠租户边界可用；这类端点按个人收件箱处理。
    if (!approval.work_item_id) {
      const actorUserId = actor.userId ?? actor.id;
      if (approval.routed_to_user_id !== actorUserId) {
        throw new HTTPException(403, { message: "你没有权限查看这条审批。" });
      }
      return approval;
    }
    if (!await canReadWorkItem(approval.work_item_id, actor)) {
      throw new HTTPException(403, { message: "你没有权限查看这条审批。" });
    }
    return approval;
  }

  function assertCanActOnApproval(approval: ApprovalRequest, actor: AuthEnv["Variables"]["actor"]) {
    if (actor.isAdmin) {
      return;
    }
    const actorUserId = actor.userId ?? actor.id;
    if (approval.routed_to_user_id !== actorUserId) {
      throw new ApprovalServiceError(403, "forbidden", "这条审批不在你的待处理列表里。");
    }
  }

  // routes-b-1/xlink-authz-4：`alreadyFiltered` lets callers that already passed `canReadWorkItem` into
  // service.listPendingForUser skip this second full detailPage pass over the same rows — the service applied
  // the identical predicate (with its own workItemId cache) already, so re-running it here was pure duplicate
  // work with no additional safety. Callers that did NOT inject a predicate (e.g. /attention's decision queue,
  // which calls listPendingForUser without options.canReadWorkItem) still need this filter — leave it real for them.
  async function visibleApprovalCenter(data: ApprovalCenterVM, actor: AuthEnv["Variables"]["actor"], alreadyFiltered = false) {
    const visibleRequests: ApprovalRequest[] = [];
    const visibleRequestIds = new Set<string>();
    // L#W2-14：按 work_item_id 去重可见性判定——多条审批常指向同一事项，避免对同一 work item 重复 detailPage（N+1）。
    const workItemVisibility = new Map<string, boolean>();
    const canRead = async (workItemId: string | undefined) => {
      if (alreadyFiltered) {
        return true;
      }
      const cacheKey = workItemId ?? "";
      const cached = workItemVisibility.get(cacheKey);
      if (cached !== undefined) {
        return cached;
      }
      const allowed = await canReadWorkItem(workItemId, actor);
      workItemVisibility.set(cacheKey, allowed);
      return allowed;
    };
    for (const request of data.requests) {
      if (await canRead(request.work_item_id)) {
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
    const pageInfo = data.page_info
      ? { ...data.page_info, returned: visibleRequests.length }
      : undefined;
    return {
      ...data,
      items: visibleItems,
      items_detail: visibleItemsDetail,
      requests: visibleRequests,
      ...(pageInfo ? { page_info: pageInfo } : {}),
      counts: {
        ...data.counts,
        pending: visibleRequests.length
      }
    };
  }

  routes.get("/", createCurrentUserMiddleware(authSource), async (c) => {
    const data = await service.listPendingForUser(c.var.currentUser, workItems
      ? { canReadWorkItem: (workItemId) => canReadWorkItem(workItemId, c.var.actor) }
      : {});
    // routes-b-1：service already ran the same canReadWorkItem predicate (with its own per-workItemId cache)
    // when `workItems` is wired, so this second pass would just repeat every detailPage call. Only re-filter
    // (alreadyFiltered=false) when no predicate was injected — i.e. workItems is unavailable and rows came back
    // unfiltered (canReadApprovalRow degrades to `true` in that case, see services/approvals.ts).
    return c.json({ ok: true, data: await visibleApprovalCenter(data, c.var.actor, Boolean(workItems)) });
  });

  routes.post("/:id/respond", createCurrentUserMiddleware(authSource), async (c) => {
    const approval = await assertCanReadApproval(c.req.param("id"), c.var.actor);
    assertCanActOnApproval(approval, c.var.actor);
    const payload = respondApprovalRequestSchema.parse(await readJsonObject(c));
    const result = await service.respond(c.req.param("id"), c.var.actor, payload);
    const data = {
      approval: result.approval,
      ...(result.learned_policy ? { learned_policy: toPermissionPolicyResponse(result.learned_policy) } : {})
    };
    return c.json({ ok: true, data });
  });

  // R12（批量效率）：多选批量放行。仅 allow——打回需要逐条理由，不进批量通道。
  // 逐条走完整 respond（鉴权/CAS/审计/策略/通知归档全复用），单条失败（409 竞态等）跳过不翻整批。
  routes.post("/respond-batch", createCurrentUserMiddleware(authSource), async (c) => {
    const body = await readJsonObject(c);
    const rawIds = Array.isArray((body as { ids?: unknown }).ids) ? (body as { ids: unknown[] }).ids : [];
    const ids = [...new Set(rawIds.filter((value): value is string => typeof value === "string" && value.length > 0))].slice(0, 50);
    if (ids.length === 0) {
      return c.json({ ok: false, code: "field_value_required", message: "请至少勾选一条要通过的审批。" }, 422);
    }
    let approved = 0;
    let skipped = 0;
    for (const id of ids) {
      try {
        const approval = await assertCanReadApproval(id, c.var.actor);
        assertCanActOnApproval(approval, c.var.actor);
        await service.respond(id, c.var.actor, { decision: "allow", remember: "once" });
        approved += 1;
      } catch {
        skipped += 1;
      }
    }
    return c.json({ ok: true, data: { approved, skipped } });
  });

  routes.post("/:id/delegate", createCurrentUserMiddleware(authSource), async (c) => {
    const approval = await assertCanReadApproval(c.req.param("id"), c.var.actor);
    assertCanActOnApproval(approval, c.var.actor);
    const payload = delegateApprovalRequestSchema.parse(await readJsonObject(c));
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
    const payload = addApprovalCommentRequestSchema.parse(await readJsonObject(c));
    const data = await service.addComment(c.req.param("id"), c.var.actor, payload.body);
    return c.json({ ok: true, data });
  });

  return routes;
}
