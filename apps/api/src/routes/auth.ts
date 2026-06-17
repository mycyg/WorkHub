import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { identifyRequestSchema, updateUserPreferencesRequestSchema } from "@workhub/contracts";

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
import {
  adminClaimClientKey,
  createAdminClaimThrottle,
  type AdminClaimThrottle
} from "../middleware/admin-claim-throttle.js";

// 与 workitems/knowledge 路由同款：畸形 JSON 体应回 400 而非冒泡成 500。
// 空体按 {} 处理，交由各请求 schema 报缺字段（仍是 400）。
async function readJsonBody(c: { req: { text: () => Promise<string> } }) {
  const text = await c.req.text();
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HTTPException(400, { message: "认证请求不是有效的 JSON。" });
  }
}

export function createAuthRoutes(
  source: AuthDependencySource = getDefaultAuthDependencies,
  options: { adminClaimThrottle?: AdminClaimThrottle } = {}
) {
  const routes = new Hono<AuthEnv>();
  // 默认每个 createAuthRoutes 起一个进程内限流器：生产只建一次（应用生命周期一个），
  // 测试各自隔离不串扰。
  const adminClaimThrottle = options.adminClaimThrottle ?? createAdminClaimThrottle();

  routes.post("/identify", async (c) => {
    const deps = resolveAuthDependencies(source);
    const payload = identifyRequestSchema.parse(await readJsonBody(c));
    const nickname = validateNickname(payload.nickname);
    const current = await resolveOptionalCurrentUser(c, deps);
    let { user, created } = await deps.users.getOrCreateActiveByNickname(nickname, makeCookieToken());

    const secret = getAuthSettings(deps).auth.adminClaimSecret;
    const provided = payload.admin_secret ?? "";
    // 需要校验口令的两种情形：在新设备登录已有管理员账号；或显式提交口令认领管理员。
    const needsSecret = (user.isAdmin && current?.id !== user.id) || provided !== "";
    const throttleKey = adminClaimClientKey(c.req.raw.headers);
    if (needsSecret) {
      const gate = adminClaimThrottle.check(throttleKey);
      if (!gate.allowed) {
        throw new HTTPException(429, {
          message: `管理员口令尝试过于频繁，请约 ${gate.retryAfterSeconds} 秒后再试。`
        });
      }
    }

    if (user.isAdmin && current?.id !== user.id) {
      if (!secret || !constantTimeEquals(provided, secret)) {
        adminClaimThrottle.recordFailure(throttleKey);
        throw new HTTPException(403, {
          message: "该昵称是管理员账号，需要管理员口令才能在新设备登录"
        });
      }
    } else if (provided) {
      // 认领管理员：显式提交口令即为认领意图，口令错误必须 fail-closed（403），不静默降级为普通用户。
      if (!secret || !constantTimeEquals(provided, secret)) {
        adminClaimThrottle.recordFailure(throttleKey);
        throw new HTTPException(403, { message: "管理员口令不正确" });
      }
      if (!user.isAdmin) {
        if (!deps.users.promoteToAdmin) {
          throw new HTTPException(501, { message: "当前运行时不支持管理员认领" });
        }
        const promoted = await deps.users.promoteToAdmin(user.id);
        if (!promoted) {
          throw new HTTPException(500, { message: "管理员认领失败" });
        }
        user = promoted;
      }
    }
    // 口令校验通过（或本就无需口令）：清空该来源的失败计数，避免影响后续正常登录。
    if (needsSecret) {
      adminClaimThrottle.recordSuccess(throttleKey);
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

  routes.patch("/preferences", async (c) => {
    const deps = resolveAuthDependencies(source);
    const user = await resolveCurrentUser(c, deps);
    const payload = updateUserPreferencesRequestSchema.parse(await readJsonBody(c));
    if (!deps.users.updatePreferredLocale) {
      throw new HTTPException(501, { message: "user preferences are not available in this runtime" });
    }
    const updated = await deps.users.updatePreferredLocale(user.id, payload.locale);
    if (!updated) {
      throw new HTTPException(404, { message: "current user not found" });
    }
    await deps.touchUser?.(updated.id);

    return c.json(toIdentityResponse(updated, false));
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
