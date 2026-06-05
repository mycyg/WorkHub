import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { identifyRequestSchema } from "@workhub/contracts";

import {
  LOCAL_CLIENT_HEADER,
  constantTimeEquals,
  forgetUserCookie,
  getAuthSettings,
  getDefaultAuthDependencies,
  hashClientToken,
  issueUserCookie,
  makeCookieToken,
  resolveAuthDependencies,
  resolveCurrentUser,
  resolveOptionalCurrentUser,
  toIdentityResponse,
  validateNickname,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";

export function createAuthRoutes(source: AuthDependencySource = getDefaultAuthDependencies) {
  const routes = new Hono<AuthEnv>();

  routes.post("/identify", async (c) => {
    const deps = resolveAuthDependencies(source);
    const payload = identifyRequestSchema.parse(await c.req.json());
    const nickname = validateNickname(payload.nickname);
    const current = await resolveOptionalCurrentUser(c, deps);
    const { user, created } = await deps.users.getOrCreateActiveByNickname(nickname, makeCookieToken());

    if (user.isAdmin && current?.id !== user.id) {
      const secret = getAuthSettings(deps).auth.adminClaimSecret;
      const provided = payload.admin_secret ?? "";
      if (!secret || !constantTimeEquals(provided, secret)) {
        throw new HTTPException(403, {
          message: "该昵称是管理员账号，需要管理员口令才能在新设备登录"
        });
      }
    }

    await issueUserCookie(c, user, getAuthSettings(deps));
    await deps.touchUser?.(user.id);

    return c.json(toIdentityResponse(user, created), created ? 201 : 200);
  });

  routes.get("/me", async (c) => {
    const deps = resolveAuthDependencies(source);
    const user = await resolveOptionalCurrentUser(c, deps);
    if (!user) {
      return c.json(null);
    }

    return c.json({
      ...toIdentityResponse(user, false),
      identity: {
        actor_kind: "human",
        actor_id: user.id,
        actor_label: user.nickname,
        user_id: user.id,
        org_id: getAuthSettings(deps).auth.defaultOrgId,
        workspace_id: getAuthSettings(deps).auth.defaultWorkspaceId,
        is_admin: user.isAdmin
      }
    });
  });

  routes.post("/logout", async (c) => {
    const deps = resolveAuthDependencies(source);
    const user = await resolveCurrentUser(c, deps);
    const runtimeSettings = getAuthSettings(deps);
    await deps.users.rotateCookieToken(user.id, makeCookieToken());

    const rawToken = c.req.header(LOCAL_CLIENT_HEADER)?.trim();
    if (rawToken) {
      const revokedDevice = await deps.devices.revokeByTokenHash(
        hashClientToken(rawToken),
        (deps.now ?? (() => new Date()))()
      );
      if (revokedDevice && revokedDevice.userId !== user.id) {
        await deps.forgetUser?.(revokedDevice.userId);
      }
    }

    forgetUserCookie(c, runtimeSettings);
    await deps.forgetUser?.(user.id);

    return c.json({ ok: true });
  });

  return routes;
}
