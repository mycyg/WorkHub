import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { bootstrapProjectRequestSchema, normalizeWorkHubLocale } from "@workhub/contracts";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  getDefaultObjectiveService,
  type ObjectiveService
} from "../services/objectives.js";
import {
  getDefaultProjectService,
  ProjectServiceError,
  type ProjectService
} from "../services/projects.js";
import {
  getDefaultProjectOpsService,
  type ProjectOpsService
} from "../services/project-ops.js";
import { readJsonObject } from "./json-body.js";
import { isUuidParam } from "./uuid-param.js";

export type ProjectRoutesDependencies = {
  auth?: AuthDependencySource;
  projects?: ProjectService;
  projectOps?: ProjectOpsService;
  objectives?: Pick<ObjectiveService, "listObjectives">;
};

// R24-K（S5-N-06）：建项目时决定内置「主区」会话该叫什么。顺序：显式 `?locale=`（前端明确表态）
// > 用户的 preferred_locale（服务端存着的设置，桌面端建项目不带 locale 参数，靠的就是这一层）
// > Accept-Language。都问不出来时 normalizeWorkHubLocale 回默认中文。
function resolveProjectLocale(c: { req: { query: (name: string) => string | undefined; header: (name: string) => string | undefined }; var: { currentUser?: { preferredLocale?: string | null } } }) {
  return normalizeWorkHubLocale(
    c.req.query("locale") ?? c.var.currentUser?.preferredLocale ?? c.req.header("Accept-Language")
  );
}

// 路由 uuid 形参先校验：非 uuid 串原本直达服务层的 uuid 列 → PG 22P02 → 误报 500；
// 非法即抛与「合法但不存在」同样的 404（ProjectServiceError，经 app.onError 收口）。
function requireProjectId(value: string): string {
  if (!isUuidParam(value)) {
    throw new ProjectServiceError(404, "project_not_found", "没有找到这个项目。");
  }
  return value;
}

function handleProjectError(error: unknown): never {
  if (error instanceof ProjectServiceError) {
    throw error;
  }
  throw error;
}

export function createProjectRoutes(deps: ProjectRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const projects = deps.projects ?? getDefaultProjectService();
  const projectOps = deps.projectOps ?? getDefaultProjectOpsService();
  const objectives = deps.objectives ?? getDefaultObjectiveService();

  routes.get("/", createCurrentUserMiddleware(authSource), async (c) => {
    try {
      const data = await projects.listProjects({ actor: c.var.actor });
      return c.json({ ok: true, data });
    } catch (error) {
      handleProjectError(error);
    }
  });

  routes.post("/bootstrap", createCurrentUserMiddleware(authSource), async (c) => {
    const payload = bootstrapProjectRequestSchema.parse(await readJsonObject(c));
    try {
      const data = await projects.bootstrapProject({
        payload,
        actor: c.var.actor,
        locale: resolveProjectLocale(c)
      });
      return c.json({ ok: true, data }, data.created ? 201 : 200);
    } catch (error) {
      handleProjectError(error);
    }
  });

  // R20 P2A（R19-19）：归档——软置 archived=true，从团队项目列表隐去。管理员/项目所有者门控。
  routes.post("/:id/archive", createCurrentUserMiddleware(authSource), async (c) => {
    const projectId = requireProjectId(c.req.param("id"));
    try {
      const data = await projectOps.archiveProject({ projectId, actor: c.var.actor });
      return c.json({ ok: true, data });
    } catch (error) {
      handleProjectError(error);
    }
  });

  // R20 P2A（R19-19）：软删——软置 deletedAt（墓碑）。管理员/项目所有者门控。
  routes.post("/:id/delete", createCurrentUserMiddleware(authSource), async (c) => {
    const projectId = requireProjectId(c.req.param("id"));
    try {
      const data = await projectOps.deleteProject({ projectId, actor: c.var.actor });
      return c.json({ ok: true, data });
    } catch (error) {
      handleProjectError(error);
    }
  });

  // R23 F-01（OKR 列表/详情持久化）：项目主页 OKR 面板首屏——目标是工作区级实体（objectives 表没有
  // project_id 列，见 packages/db/src/schema/core.ts），这条按项目挂 URL 只是给项目主页一个顺手入口，
  // 实际返回 project 所在工作区的全部目标，不做项目级过滤。鉴权判定照现有 objectives 写端点
  // （POST /api/objectives 等）：未登录 401（由 createCurrentUserMiddleware 处理），当前 actor 没有
  // 工作区 403；:id 非法 uuid 沿用本文件既有 requireProjectId（404，不区分「格式非法」与「不存在」）。
  routes.get("/:id/objectives", createCurrentUserMiddleware(authSource), async (c) => {
    // 目标不是项目级实体，:id 只做格式校验（非法 uuid → 404），返回值本身不需要——查询按 actor 的
    // 工作区走，不按 project 二次过滤。
    requireProjectId(c.req.param("id"));
    const workspaceId = c.var.actor.workspaceId;
    if (!workspaceId) {
      throw new HTTPException(403, { message: "没有权限查看目标。" });
    }
    const result = await objectives.listObjectives({ workspaceId });
    return c.json({
      ok: true,
      data: {
        objectives: result.items.map((objective) => ({
          objective_id: objective.id,
          title: objective.title,
          description_md: objective.descriptionMd,
          status: objective.status,
          progress_percent: objective.progressPercent,
          owner_user_id: objective.ownerUserId,
          updated_at: objective.updatedAt.toISOString()
        })),
        capped: result.capped
      }
    });
  });

  return routes;
}
