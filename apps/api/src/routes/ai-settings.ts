import { Hono } from "hono";

import {
  patchProjectAiGovernanceRequestSchema,
  patchUserAiProfileRequestSchema
} from "@workhub/contracts";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  AiSettingsServiceError,
  getDefaultAiSettingsService,
  type AiSettingsService
} from "../services/ai-settings.js";
import { readJsonObject } from "./json-body.js";
import { isUuidParam } from "./uuid-param.js";

export type AiSettingsRoutesDependencies = {
  auth?: AuthDependencySource;
  aiSettings?: AiSettingsService;
};

function requireProjectId(value: string) {
  if (!isUuidParam(value)) {
    throw new AiSettingsServiceError(
      404,
      "ai_governance_not_found",
      "没有找到可管理的项目 AI 设置。"
    );
  }
  return value;
}

export function createAiSettingsRoutes(deps: AiSettingsRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const aiSettings = deps.aiSettings ?? getDefaultAiSettingsService();
  const requireCurrentUser = createCurrentUserMiddleware(authSource);

  routes.get("/me/ai-profile", requireCurrentUser, async (c) => {
    const data = await aiSettings.getUserProfile({ actor: c.var.actor });
    return c.json({ ok: true, data });
  });

  routes.patch("/me/ai-profile", requireCurrentUser, async (c) => {
    await aiSettings.assertUserProfileAccess({ actor: c.var.actor });
    const payload = patchUserAiProfileRequestSchema.parse(await readJsonObject(c));
    const data = await aiSettings.patchUserProfile({ actor: c.var.actor, payload });
    return c.json({ ok: true, data });
  });

  routes.get("/projects/:id/ai-governance", requireCurrentUser, async (c) => {
    const projectId = requireProjectId(c.req.param("id"));
    const data = await aiSettings.getProjectGovernance({ actor: c.var.actor, projectId });
    return c.json({ ok: true, data });
  });

  routes.patch("/projects/:id/ai-governance", requireCurrentUser, async (c) => {
    const projectId = requireProjectId(c.req.param("id"));
    await aiSettings.assertProjectGovernanceAccess({ actor: c.var.actor, projectId });
    const payload = patchProjectAiGovernanceRequestSchema.parse(await readJsonObject(c));
    const data = await aiSettings.patchProjectGovernance({ actor: c.var.actor, projectId, payload });
    return c.json({ ok: true, data });
  });

  return routes;
}
