// R15 批 E3（项目规划 agent）的 HTTP 出口：项目级计划草案的起草 / 列表 / 详情 / 审批 / 物化。
// 全部经 createCurrentUserMiddleware 收口（未鉴权 401，route-auth-posture 门兜底）；领域错误经
// ProjectPlannerServiceError 走 app.onError 统一映射（LLM 未配置 503 / 需人澄清 409 / 无权 403 等）。
import { Hono } from "hono";

import { normalizeWorkHubLocale } from "@workhub/contracts";
import { z } from "zod";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  getDefaultProjectPlannerService,
  ProjectPlannerServiceError,
  type ProjectPlannerService
} from "../services/project-planner.js";
import { readJsonObject } from "./json-body.js";
import { isUuidParam } from "./uuid-param.js";

const createDraftRequestSchema = z.object({
  intent: z.string().trim().min(1).max(4_000)
});

const rejectRequestSchema = z.object({
  reason: z.string().trim().min(1).max(2_000)
});

export type ProjectPlannerRoutesDependencies = {
  auth?: AuthDependencySource;
  service?: ProjectPlannerService;
};

function requireProjectId(value: string): string {
  if (!isUuidParam(value)) {
    throw new ProjectPlannerServiceError(404, "project_not_found", "没有找到这个项目。");
  }
  return value;
}

function requireDraftId(value: string): string {
  if (!isUuidParam(value)) {
    throw new ProjectPlannerServiceError(404, "project_plan_draft_not_found", "没有找到这个规划草案。");
  }
  return value;
}

export function createProjectPlannerRoutes(deps: ProjectPlannerRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const service = deps.service ?? getDefaultProjectPlannerService();

  function localeFor(c: { req: { query: (key: string) => string | undefined; header: (key: string) => string | undefined } }) {
    return normalizeWorkHubLocale(c.req.query("locale") ?? c.req.header("Accept-Language"));
  }

  // 起草：Cuu 拟项目计划草案 → judge 二次校验 → 落库待人审。权限=能管项目的人；LLM 未配置 503。
  routes.post("/projects/:id/plan-drafts", createCurrentUserMiddleware(authSource), async (c) => {
    const projectId = requireProjectId(c.req.param("id"));
    const payload = createDraftRequestSchema.parse(await readJsonObject(c));
    const data = await service.createDraft({
      projectId,
      actor: c.var.actor,
      intent: payload.intent,
      locale: localeFor(c)
    });
    return c.json({ ok: true, data }, 201);
  });

  routes.get("/projects/:id/plan-drafts", createCurrentUserMiddleware(authSource), async (c) => {
    const projectId = requireProjectId(c.req.param("id"));
    const data = await service.listDrafts({ projectId, actor: c.var.actor, locale: localeFor(c) });
    return c.json({ ok: true, data: { drafts: data } });
  });

  routes.get("/plan-drafts/:draftId", createCurrentUserMiddleware(authSource), async (c) => {
    const draftId = requireDraftId(c.req.param("draftId"));
    const data = await service.getDraft({ draftId, actor: c.var.actor, locale: localeFor(c) });
    return c.json({ ok: true, data });
  });

  routes.post("/plan-drafts/:draftId/approve", createCurrentUserMiddleware(authSource), async (c) => {
    const draftId = requireDraftId(c.req.param("draftId"));
    const data = await service.approveDraft({ draftId, actor: c.var.actor, locale: localeFor(c) });
    return c.json({ ok: true, data });
  });

  routes.post("/plan-drafts/:draftId/reject", createCurrentUserMiddleware(authSource), async (c) => {
    const draftId = requireDraftId(c.req.param("draftId"));
    const payload = rejectRequestSchema.parse(await readJsonObject(c));
    const data = await service.rejectDraft({
      draftId,
      actor: c.var.actor,
      reasonMd: payload.reason,
      locale: localeFor(c)
    });
    return c.json({ ok: true, data });
  });

  routes.post("/plan-drafts/:draftId/materialize", createCurrentUserMiddleware(authSource), async (c) => {
    const draftId = requireDraftId(c.req.param("draftId"));
    const { draft, result } = await service.materialize({ draftId, actor: c.var.actor, locale: localeFor(c) });
    return c.json({
      ok: true,
      data: {
        draft,
        result: {
          milestone_ids: result.milestoneIds,
          work_item_ids: result.workItemIds,
          dependency_count: result.dependencyCount
        }
      }
    });
  });

  return routes;
}
