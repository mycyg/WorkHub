import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import {
  identifyRequestSchema,
  passwordLoginRequestSchema,
  passwordRegisterRequestSchema,
  updateUserPreferencesRequestSchema
} from "@workhub/contracts";
import { hashSessionToken } from "@workhub/db";

import {
  currentPasswordAlgo,
  hashPassword,
  needsRehash,
  validatePassword,
  verifyPassword,
  WeakPasswordError
} from "../auth/password.js";
import {
  LOCAL_CLIENT_HEADER,
  constantTimeEquals,
  forgetUserCookie,
  getAuthSettings,
  getDefaultAuthDependencies,
  hashClientToken,
  issueSessionCookie,
  issueUserCookie,
  makeCookieToken,
  mintSession,
  readCookieToken,
  resolveAuthDependencies,
  resolveCurrentUser,
  resolveOptionalCurrentUser,
  toIdentityResponse,
  validateNickname,
  type AuthDependencies,
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

// R2 auth epic：登录失败锁定策略——连续失败达上限后临时锁定，节流在线暴力破解。
const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_LOCK_MS = 15 * 60 * 1000;

function passwordModeEnabled(deps: AuthDependencies): boolean {
  return getAuthSettings(deps).auth.authMode !== "nickname";
}

// 裸 PG 唯一冲突（23505）→ 路由层转 409，不冒泡成 500（mirror drive/proposals 的 isXxxUniqueViolation）。
function isUniqueViolation(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { code?: string }).code === "23505";
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

  // R2 auth epic：密码注册（AUTH_MODE!='nickname' 时启用）。建 user + 凭据 + 会话；
  // 零管理员实例的首个注册者自举为 admin（取代 ADMIN_CLAIM_SECRET）。
  routes.post("/register", async (c) => {
    const deps = resolveAuthDependencies(source);
    if (!passwordModeEnabled(deps)) {
      throw new HTTPException(404, { message: "密码注册未启用" });
    }
    if (!deps.credentials || !deps.sessions) {
      throw new HTTPException(501, { message: "当前运行时不支持密码认证" });
    }
    const payload = passwordRegisterRequestSchema.parse(await readJsonBody(c));
    const email = payload.email.trim();
    const nickname = validateNickname(payload.nickname);
    try {
      validatePassword(payload.password);
    } catch (error) {
      if (error instanceof WeakPasswordError) {
        throw new HTTPException(400, { message: error.message });
      }
      throw error;
    }

    // email 唯一预检（citext 大小写不敏感）；竞态由下方 createCredential 的 23505 兜底。
    if (await deps.credentials.findByEmail(email)) {
      throw new HTTPException(409, { message: "该邮箱已注册" });
    }

    const passwordHash = await hashPassword(payload.password);
    // 首管引导：零管理员实例的首个注册者直接建为 admin（建行前判定，避免多一次提权写）。
    const shouldBeAdmin = deps.users.hasAnyActiveAdmin ? !(await deps.users.hasAnyActiveAdmin()) : false;

    let user;
    try {
      // cookieToken 在会话模式下是 vestigial，但列 NOT NULL，仍生成一个。
      user = await deps.users.createUser({ nickname, cookieToken: makeCookieToken(), isAdmin: shouldBeAdmin });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new HTTPException(409, { message: "该昵称已被占用" });
      }
      throw error;
    }

    try {
      await deps.credentials.createCredential({
        userId: user.id,
        email,
        passwordHash,
        passwordAlgo: currentPasswordAlgo()
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new HTTPException(409, { message: "该邮箱已注册" });
      }
      throw error;
    }

    const { token } = await mintSession(deps, user, { authMethod: "password" });
    await issueSessionCookie(c, token, getAuthSettings(deps));
    await deps.touchUser?.(user.id);

    return c.json(toIdentityResponse(user, true), 201);
  });

  // R2 auth epic：密码登录。统一 401（不泄露 email 是否存在）；失败计数 + 达上限临时锁定；
  // 成功清零计数并按 needsRehash 透明升级哈希。
  routes.post("/login", async (c) => {
    const deps = resolveAuthDependencies(source);
    if (!passwordModeEnabled(deps)) {
      throw new HTTPException(404, { message: "密码登录未启用" });
    }
    if (!deps.credentials || !deps.sessions) {
      throw new HTTPException(501, { message: "当前运行时不支持密码认证" });
    }
    const payload = passwordLoginRequestSchema.parse(await readJsonBody(c));
    const email = payload.email.trim();
    const now = (deps.now ?? (() => new Date()))();
    const invalid = () => new HTTPException(401, { message: "邮箱或密码不正确" });

    const credential = await deps.credentials.findByEmail(email);
    if (!credential) {
      throw invalid();
    }
    if (credential.lockedUntil && credential.lockedUntil > now) {
      throw new HTTPException(429, { message: "登录失败次数过多，账号已临时锁定，请稍后再试。" });
    }
    const user = await deps.users.findActiveById(credential.userId);
    if (!user) {
      throw invalid(); // 用户被软删/停用
    }
    const ok = credential.passwordHash ? await verifyPassword(payload.password, credential.passwordHash) : false;
    if (!ok) {
      const attempts = credential.failedAttempts + 1;
      const lockedUntil = attempts >= LOGIN_MAX_ATTEMPTS ? new Date(now.getTime() + LOGIN_LOCK_MS) : null;
      await deps.credentials.recordFailedAttempt(credential.userId, lockedUntil);
      throw invalid();
    }

    await deps.credentials.resetFailedAttempts(credential.userId);
    // 透明重哈希：算法/参数升级时在成功登录路径无停机迁移旧串。
    if (credential.passwordHash && needsRehash(credential.passwordHash) && deps.credentials.updatePassword) {
      const rehashed = await hashPassword(payload.password);
      await deps.credentials.updatePassword(credential.userId, rehashed, currentPasswordAlgo());
    }

    const { token } = await mintSession(deps, user, { authMethod: "password" });
    await issueSessionCookie(c, token, getAuthSettings(deps));
    await deps.touchUser?.(user.id);

    return c.json(toIdentityResponse(user, false), 200);
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

    // R2 auth epic：会话模式下登出要撤销当前会话墓碑（nickname 模式无会话，跳过）。
    if (passwordModeEnabled(deps) && deps.sessions) {
      const cookieToken = await readCookieToken(c, runtimeSettings);
      if (cookieToken) {
        const at = (deps.now ?? (() => new Date()))();
        const session = await deps.sessions.findActiveByTokenHash(hashSessionToken(cookieToken), at);
        if (session) {
          await deps.sessions.revoke(session.id, at);
        }
      }
    }

    forgetUserCookie(c, runtimeSettings);
    await deps.forgetUser?.(user.id);

    return c.json({ ok: true });
  });

  // R2 auth epic（账号生命周期-停用）：管理员软删某用户并立即切断其访问（撤销全部会话 + 设备）。
  // 任意 AUTH_MODE 通用——软删用户是租户无关的管理操作。
  routes.post("/users/:id/deactivate", async (c) => {
    const deps = resolveAuthDependencies(source);
    const actingUser = await resolveCurrentUser(c, deps);
    if (!actingUser.isAdmin) {
      throw new HTTPException(403, { message: "需要管理员权限" });
    }
    const targetId = c.req.param("id");
    if (targetId === actingUser.id) {
      // 防呆：管理员停用自己会立即把自己锁在外面。
      throw new HTTPException(400, { message: "不能停用自己的账号" });
    }
    if (!deps.users.softDelete) {
      throw new HTTPException(501, { message: "当前运行时不支持账号停用" });
    }
    const at = (deps.now ?? (() => new Date()))();
    const deleted = await deps.users.softDelete(targetId, actingUser.id, at);
    if (!deleted) {
      throw new HTTPException(404, { message: "用户不存在或已停用" });
    }
    // 立即切断访问：撤销全部服务端会话 + 客户端设备令牌。
    if (deps.sessions) {
      await deps.sessions.revokeAllForUser(targetId, at);
    }
    const devices = await deps.devices.listByUser(targetId);
    for (const device of devices) {
      if (device.revokedAt === null) {
        await deps.devices.revokeByIdForUser(device.id, targetId, at);
      }
    }
    await deps.forgetUser?.(targetId);

    return c.json({ ok: true });
  });

  return routes;
}
