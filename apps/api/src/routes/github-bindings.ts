import { Hono, type Context } from "hono";

import {
  githubBindingRequestSchema,
  githubTestConnectionRequestSchema
} from "@workhub/contracts";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  GithubBindingServiceError,
  getDefaultGithubBindingsService,
  type GithubBindingsService
} from "../services/github-bindings.js";
import { readJsonObject } from "./json-body.js";
import { isUuidParam } from "./uuid-param.js";

// R14 批 GH（07-gh-design.md §3）：项目级 GitHub 绑定端点。本文件不自行挂载——集成者在 app.ts
// `app.route("/api", createGithubBindingRoutes())` 收口（禁区纪律）。服务错误在本模块内映射为
// JSON 响应（照 drive.ts 的自带 catch 手法），挂载时无需改 app.onError；ZodError（请求体校验）
// 走 app.ts 既有全局 422 映射。
// 安全红线：请求体里的 PAT 只透传给服务层，绝不打日志/回显；响应 VM 在 contracts 层结构性无 token 字段。

export type GithubBindingRoutesDependencies = {
  auth?: AuthDependencySource;
  githubBindings?: GithubBindingsService;
};

function requireProjectId(value: string) {
  // 非法 uuid 与「合法但不存在」同样 404，不给攻击者可区分的存在性信号（照 drive.ts 先例）。
  if (!isUuidParam(value)) {
    throw new GithubBindingServiceError(
      404,
      "github_binding_project_not_found",
      "没有找到可访问的项目。"
    );
  }
  return value;
}

function errorResponse(c: Context<AuthEnv>, error: unknown) {
  if (error instanceof GithubBindingServiceError) {
    return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status);
  }
  throw error;
}

export function createGithubBindingRoutes(deps: GithubBindingRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const githubBindings = deps.githubBindings ?? getDefaultGithubBindingsService();
  const requireCurrentUser = createCurrentUserMiddleware(authSource);

  routes.get("/projects/:id/github-binding", requireCurrentUser, async (c) => {
    try {
      const projectId = requireProjectId(c.req.param("id"));
      const data = await githubBindings.getBindingStatus({ actor: c.var.actor, projectId });
      return c.json({ ok: true, data });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  routes.put("/projects/:id/github-binding", requireCurrentUser, async (c) => {
    let projectId: string;
    try {
      projectId = requireProjectId(c.req.param("id"));
    } catch (error) {
      return errorResponse(c, error);
    }
    // 先鉴权路径参数，再读 body：ZodError 交给 app 级全局 422 映射。
    const payload = githubBindingRequestSchema.parse(await readJsonObject(c));
    try {
      const { status, created } = await githubBindings.upsertBinding({
        actor: c.var.actor,
        projectId,
        payload
      });
      return c.json({ ok: true, data: status }, created ? 201 : 200);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  routes.delete("/projects/:id/github-binding", requireCurrentUser, async (c) => {
    try {
      const projectId = requireProjectId(c.req.param("id"));
      await githubBindings.deleteBinding({ actor: c.var.actor, projectId });
      return c.body(null, 204);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  routes.post("/projects/:id/github-binding/test", requireCurrentUser, async (c) => {
    let projectId: string;
    try {
      projectId = requireProjectId(c.req.param("id"));
    } catch (error) {
      return errorResponse(c, error);
    }
    const payload = githubTestConnectionRequestSchema.parse(await readJsonObject(c));
    try {
      const data = await githubBindings.testConnection({
        actor: c.var.actor,
        projectId,
        payload
      });
      return c.json({ ok: true, data });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  return routes;
}
