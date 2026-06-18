import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import {
  identifyRequestSchema,
  inviteAcceptRequestSchema,
  inviteCreateRequestSchema,
  passwordChangeRequestSchema,
  passwordLoginRequestSchema,
  passwordRegisterRequestSchema,
  updateUserPreferencesRequestSchema
} from "@workhub/contracts";
import { generateSessionToken, hashSessionToken } from "@workhub/db";

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
// 邀请链接有效期（out-of-band 分发，给足管理员转交时间）。
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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

  // R2 auth epic（账号生命周期-改密）：已登录用户用旧密码换新密码。换成功后撤销该用户全部旧会话并
  // 为当前请求重新签发会话——其它设备被登出，当前会话不掉线。
  routes.post("/password", async (c) => {
    const deps = resolveAuthDependencies(source);
    // 鉴权先行——未鉴权必须 401 fail-closed（route-auth-posture 门），不能被下面的「功能未启用」404 抢先。
    const actingUser = await resolveCurrentUser(c, deps);
    if (!passwordModeEnabled(deps)) {
      throw new HTTPException(404, { message: "密码功能未启用" });
    }
    if (!deps.credentials || !deps.sessions) {
      throw new HTTPException(501, { message: "当前运行时不支持密码认证" });
    }
    const payload = passwordChangeRequestSchema.parse(await readJsonBody(c));
    try {
      validatePassword(payload.new_password);
    } catch (error) {
      if (error instanceof WeakPasswordError) {
        throw new HTTPException(400, { message: error.message });
      }
      throw error;
    }

    const credential = await deps.credentials.findByUserId(actingUser.id);
    const ok = credential?.passwordHash
      ? await verifyPassword(payload.current_password, credential.passwordHash)
      : false;
    if (!ok) {
      throw new HTTPException(403, { message: "当前密码不正确" });
    }

    if (!deps.credentials.updatePassword) {
      throw new HTTPException(501, { message: "当前运行时不支持改密" });
    }
    await deps.credentials.updatePassword(actingUser.id, await hashPassword(payload.new_password), currentPasswordAlgo());

    // 改密 = 重建信任：撤销全部旧会话（含其它设备），再为当前请求签发新会话，避免把自己也登出。
    const at = (deps.now ?? (() => new Date()))();
    await deps.sessions.revokeAllForUser(actingUser.id, at);
    const { token } = await mintSession(deps, actingUser, { authMethod: "password" });
    await issueSessionCookie(c, token, getAuthSettings(deps));

    return c.json({ ok: true });
  });

  // R2 auth epic（账号生命周期-邀请）：管理员建邀请，一次性返回明文 token（服务端只存 sha256）。
  // 管理员据 token 自行拼 out-of-band 链接分发（无 SMTP）。
  routes.post("/invites", async (c) => {
    const deps = resolveAuthDependencies(source);
    const actingUser = await resolveCurrentUser(c, deps); // 鉴权先行 → 未鉴权 401 fail-closed
    if (!actingUser.isAdmin) {
      throw new HTTPException(403, { message: "需要管理员权限" });
    }
    if (!passwordModeEnabled(deps)) {
      throw new HTTPException(404, { message: "邀请功能未启用" });
    }
    if (!deps.invites) {
      throw new HTTPException(501, { message: "当前运行时不支持邀请" });
    }
    const payload = inviteCreateRequestSchema.parse(await readJsonBody(c));
    const at = (deps.now ?? (() => new Date()))();
    const token = generateSessionToken();
    const expiresAt = new Date(at.getTime() + INVITE_TTL_MS);
    const invite = await deps.invites.create({
      email: payload.email.trim(),
      tokenHash: hashSessionToken(token),
      invitedByUserId: actingUser.id,
      role: payload.role ?? "member",
      workspaceId: payload.workspace_id ?? null,
      expiresAt
    });
    // 一次性返回明文 token——服务端只存 hash，明文不再可取回。
    return c.json(
      { invite_id: invite.id, token, email: invite.email, expires_at: expiresAt.toISOString() },
      201
    );
  });

  // 公开入口：收件人凭 out-of-band token 接受邀请 → 建账号 + 凭据 + 默认成员 + 会话。
  routes.post("/invites/accept", async (c) => {
    const deps = resolveAuthDependencies(source);
    if (!passwordModeEnabled(deps)) {
      throw new HTTPException(404, { message: "邀请功能未启用" });
    }
    if (!deps.invites || !deps.credentials || !deps.sessions) {
      throw new HTTPException(501, { message: "当前运行时不支持邀请" });
    }
    const payload = inviteAcceptRequestSchema.parse(await readJsonBody(c));
    const nickname = validateNickname(payload.nickname);
    try {
      validatePassword(payload.password);
    } catch (error) {
      if (error instanceof WeakPasswordError) {
        throw new HTTPException(400, { message: error.message });
      }
      throw error;
    }
    const at = (deps.now ?? (() => new Date()))();
    const invite = await deps.invites.findActiveByTokenHash(hashSessionToken(payload.token), at);
    if (!invite) {
      throw new HTTPException(404, { message: "邀请无效或已过期" });
    }
    if (await deps.credentials.findByEmail(invite.email)) {
      throw new HTTPException(409, { message: "该邮箱已注册" });
    }

    let user;
    try {
      user = await deps.users.createUser({ nickname, cookieToken: makeCookieToken() });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new HTTPException(409, { message: "该昵称已被占用" });
      }
      throw error;
    }
    try {
      // 邀请即证明邮箱控制权（trust-on-invite）→ email_verified_at 置 at。
      await deps.credentials.createCredential({
        userId: user.id,
        email: invite.email,
        passwordHash: await hashPassword(payload.password),
        passwordAlgo: currentPasswordAlgo(),
        emailVerifiedAt: at
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new HTTPException(409, { message: "该邮箱已注册" });
      }
      throw error;
    }
    // 按邀请赋予工作区成员（默认成员=actor 租户锚点）。
    if (deps.memberships) {
      const workspaceId = invite.workspaceId ?? getAuthSettings(deps).auth.defaultWorkspaceId;
      await deps.memberships.create({
        workspaceId,
        userId: user.id,
        role: invite.role as "member" | "admin" | "owner",
        defaultWorkspace: true
      });
    }
    await deps.invites.accept(invite.id, user.id, at);

    const { token } = await mintSession(deps, user, { authMethod: "password" });
    await issueSessionCookie(c, token, getAuthSettings(deps));
    await deps.touchUser?.(user.id);

    return c.json(toIdentityResponse(user, true), 201);
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
