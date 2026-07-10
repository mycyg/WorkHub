import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import {
  desktopBootstrapRequestSchema,
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
  constantTimeEquals,
  forgetUserCookie,
  getAuthSettings,
  getDefaultAuthDependencies,
  hashClientToken,
  issueSessionCookie,
  issueUserCookie,
  makeClientToken,
  makeCookieToken,
  toClientDeviceResponse,
  mintSession,
  readCookieToken,
  readLocalClientToken,
  resolveAuthDependencies,
  resolveCurrentUser,
  resolveHumanActor,
  resolveOptionalCurrentUser,
  toIdentityResponse,
  validateNickname,
  type AuthAtomicWriteRepos,
  type AuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  adminClaimClientKey,
  createAdminClaimThrottle,
  type AdminClaimThrottle
} from "../middleware/admin-claim-throttle.js";
import { readJsonObject } from "./json-body.js";
import { isUuidParam } from "./uuid-param.js";

// R2 auth epic：登录失败锁定策略——连续失败达上限后临时锁定，节流在线暴力破解。
const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
// 邀请链接有效期（out-of-band 分发，给足管理员转交时间）。
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const inviteAcceptTokenRequestSchema = inviteAcceptRequestSchema.pick({ token: true });

function passwordModeEnabled(deps: AuthDependencies): boolean {
  return getAuthSettings(deps).auth.authMode !== "nickname";
}

// 裸 PG 唯一冲突（23505）→ 路由层转 409，不冒泡成 500（mirror drive/proposals 的 isXxxUniqueViolation）。
function isUniqueViolation(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { code?: string }).code === "23505";
}

// 唯一冲突就地映射成 409（昵称/邮箱各自的文案），其余原样抛出。在事务内抛出即触发整笔回滚。
async function createUserOr409(
  users: AuthAtomicWriteRepos["users"],
  input: Parameters<AuthAtomicWriteRepos["users"]["createUser"]>[0]
) {
  try {
    return await users.createUser(input);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new HTTPException(409, { message: "该昵称已被占用" });
    }
    throw error;
  }
}

async function createCredentialOr409(
  credentials: AuthAtomicWriteRepos["credentials"],
  input: Parameters<AuthAtomicWriteRepos["credentials"]["createCredential"]>[0]
) {
  try {
    return await credentials.createCredential(input);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new HTTPException(409, { message: "该邮箱已注册" });
    }
    throw error;
  }
}

// R2 audit 修复：把注册/接受邀请的跨表写跑成一个原子单元。注入了 atomicAuthWrites（生产真库）时
// 在单事务内执行（任一步抛即整笔回滚，不留孤儿 user / 不烧唯一昵称 / 邀请不被消费）；未注入（测试假仓库）
// 时回退到顺序写——直接用传入的 deps 仓库，行为与原逐步写一致。
async function runAuthWrites<T>(
  deps: AuthDependencies,
  fallbackRepos: AuthAtomicWriteRepos,
  write: (repos: AuthAtomicWriteRepos) => Promise<T>
): Promise<T> {
  if (deps.atomicAuthWrites) {
    return deps.atomicAuthWrites(write);
  }
  return write(fallbackRepos);
}

// 团队就绪 gap[41]：安全/身份事件审计。注册/登录(成败)/锁定/登出/停用/首管引导/邀请收发等核心
// 身份动作此前几乎不写审计。统一经 deps.auditLogs.createAuditLog seam（与 G3 停用交接同款），尽力而为——
// auditLogs seam 缺席（老运行时/假仓库）则静默跳过；写失败仅告警，绝不影响认证主流程的状态码/响应体。
// entityType 统一为 "user"（实体即被审计的账号），actorKind="human"（与 G3 模板一致；登录失败无确定 actor）。
async function auditSecurityEvent(
  deps: AuthDependencies,
  input: Omit<Parameters<NonNullable<AuthDependencies["auditLogs"]>["createAuditLog"]>[0], "actorKind" | "entityType"> & {
    actorKind?: Parameters<NonNullable<AuthDependencies["auditLogs"]>["createAuditLog"]>[0]["actorKind"];
  }
): Promise<void> {
  if (!deps.auditLogs) {
    return; // seam 可选——假仓库/老运行时缺席时静默跳过。
  }
  try {
    await deps.auditLogs.createAuditLog({
      actorKind: input.actorKind ?? "human",
      entityType: "user",
      ...input
    });
  } catch (error) {
    // 尽力而为：审计写失败绝不破坏认证主流程（与 G3 停用交接的 try/catch 善后语义一致）。
    console.warn(`security audit write failed (best-effort): ${input.action}`, error);
  }
}

async function bestEffortAuthCleanup(action: string, cleanup: () => Promise<void>): Promise<void> {
  try {
    await cleanup();
  } catch (error) {
    console.warn(`auth cleanup failed (best-effort): ${action}`, error);
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
    if (passwordModeEnabled(deps)) {
      throw new HTTPException(404, { message: "昵称登录在当前认证模式下不可用。" });
    }
    const payload = identifyRequestSchema.parse(await readJsonObject(c));
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
        // 安全事件：凭 ADMIN_CLAIM_SECRET 把普通账号提为管理员（权限抬升，必审）。
        await auditSecurityEvent(deps, {
          actorUserId: user.id,
          entityId: user.id,
          action: "auth.admin_bootstrapped",
          detailJson: { nickname: user.nickname, via: "admin_claim_secret" }
        });
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

  // 桌面端首启引导：一次调用完成 昵称 identify + 设备注册，client_token 走响应体（非 cookie）。
  // 仅昵称模式开放（密码模式身份必须来自 邮箱+密码/邀请 → 404）。CSRF 同源守卫对本路径豁免
  // （见 middleware/csrf.ts）——桌面首启是跨源且无 cookie/无 token 的合法引导出口。
  // 安全：token 走响应体，跨源攻击页因 CORS 不反射其源而读不到响应（偷不到 token），故比无鉴权的 /identify 更弱。
  routes.post("/desktop-bootstrap", async (c) => {
    const deps = resolveAuthDependencies(source);
    if (passwordModeEnabled(deps)) {
      throw new HTTPException(404, { message: "桌面引导在当前认证模式下不可用" });
    }
    const payload = desktopBootstrapRequestSchema.parse(await readJsonObject(c));
    const nickname = validateNickname(payload.nickname);
    const { user, created } = await deps.users.getOrCreateActiveByNickname(nickname, makeCookieToken());
    if (user.isAdmin) {
      const throttleKey = adminClaimClientKey(c.req.raw.headers);
      const gate = adminClaimThrottle.check(throttleKey);
      if (!gate.allowed) {
        throw new HTTPException(429, {
          message: `管理员口令尝试过于频繁，请约 ${gate.retryAfterSeconds} 秒后再试。`
        });
      }
      const secret = getAuthSettings(deps).auth.adminClaimSecret;
      const provided = payload.admin_secret ?? "";
      if (!secret || !constantTimeEquals(provided, secret)) {
        adminClaimThrottle.recordFailure(throttleKey);
        throw new HTTPException(403, { message: "该昵称是管理员账号，需要管理员口令才能注册桌面设备" });
      }
      adminClaimThrottle.recordSuccess(throttleKey);
    }
    const token = makeClientToken();
    const device = await deps.devices.createClientDevice({
      userId: user.id,
      deviceName: payload.device_name.trim(),
      platform: (payload.platform ?? "desktop").trim().slice(0, 64) || "desktop",
      clientTokenHash: hashClientToken(token),
      lastSeenAt: (deps.now ?? (() => new Date()))()
    });
    return c.json(
      {
        identity: toIdentityResponse(user, created),
        device: toClientDeviceResponse(device),
        client_token: token
      },
      201
    );
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
    const payload = passwordRegisterRequestSchema.parse(await readJsonObject(c));
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

    const credentials = deps.credentials;
    // R2 audit 修复（孤儿 user + 烧昵称）：user+credential 两笔写要么都成功要么都不留痕。
    // 生产经 atomicAuthWrites 在单事务内做（credential 失败则 createUser 回滚）；测试注入假仓库时
    // 该 seam 缺席，回退到原顺序写——假仓库的 createCredential 不会在 createUser 成功后失败，
    // 故顺序回退对单测语义不变（真库才有跨表失败窗口，那里走事务）。每步的 23505 在写点就地映射成
    // 对应 409（昵称 vs 邮箱），异常向上冒泡即触发事务回滚，HTTP 语义与原逐步写逐字一致。
    const user = await runAuthWrites(deps, { users: deps.users, credentials, memberships: deps.memberships }, async ({ users, credentials: credentialsTx, memberships }) => {
      // cookieToken 在会话模式下是 vestigial，但列 NOT NULL，仍生成一个。
      const created = await createUserOr409(users, { nickname, cookieToken: makeCookieToken(), isAdmin: shouldBeAdmin });
      await createCredentialOr409(credentialsTx, {
        userId: created.id,
        email,
        passwordHash,
        passwordAlgo: currentPasswordAlgo()
      });
      if (memberships) {
        await memberships.create({
          workspaceId: getAuthSettings(deps).auth.defaultWorkspaceId,
          userId: created.id,
          role: shouldBeAdmin ? "owner" : "member",
          defaultWorkspace: true
        });
      }
      return created;
    });

    const { token } = await mintSession(deps, user, { authMethod: "password" });
    await issueSessionCookie(c, token, getAuthSettings(deps));
    await deps.touchUser?.(user.id);

    // 安全事件：新账号注册。首个注册者自举为 admin 时一并记 admin_bootstrapped（首管引导路径，必审）。
    await auditSecurityEvent(deps, {
      actorUserId: user.id,
      entityId: user.id,
      action: "auth.user_registered",
      detailJson: { nickname: user.nickname, bootstrapped_admin: shouldBeAdmin }
    });
    if (shouldBeAdmin) {
      await auditSecurityEvent(deps, {
        actorUserId: user.id,
        entityId: user.id,
        action: "auth.admin_bootstrapped",
        detailJson: { nickname: user.nickname, via: "first_user_registration" }
      });
    }

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
    const payload = passwordLoginRequestSchema.parse(await readJsonObject(c));
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
    // 锁窗已过即清白：之前的失败计数若残留，下一次失败会因 failedAttempts(=上限) + 1 立即重锁，
    // 把合法用户永久挡在外面。锁过期后先清零计数+解锁，让后续失败从干净的 0 重新累计，只有锁过期之后的
    // 新失败才计入新一轮锁定。lockedUntil 为 null（从未锁过）则无需清零。
    const lockExpired = credential.lockedUntil !== null && credential.lockedUntil <= now;
    if (lockExpired) {
      await deps.credentials.resetFailedAttempts(credential.userId);
    }
    const user = await deps.users.findActiveById(credential.userId);
    if (!user) {
      throw invalid(); // 用户被软删/停用
    }
    const ok = credential.passwordHash ? await verifyPassword(payload.password, credential.passwordHash) : false;
    if (!ok) {
      // 锁过期已清零，本次失败从 0 起算；否则沿用既有计数。
      const priorAttempts = lockExpired ? 0 : credential.failedAttempts;
      const attempts = priorAttempts + 1;
      const lockedUntil = attempts >= LOGIN_MAX_ATTEMPTS ? new Date(now.getTime() + LOGIN_LOCK_MS) : null;
      await deps.credentials.recordFailedAttempt(credential.userId, lockedUntil);
      // 安全事件：密码错误（在线暴力破解信号）。subject=凭据所属用户；不记明文。
      await auditSecurityEvent(deps, {
        actorUserId: credential.userId,
        entityId: credential.userId,
        action: "auth.login_failed",
        detailJson: { reason: "bad_password", failed_attempts: attempts }
      });
      if (lockedUntil) {
        // 安全事件：连续失败达上限，账号临时锁定。
        await auditSecurityEvent(deps, {
          actorUserId: credential.userId,
          entityId: credential.userId,
          action: "auth.account_locked",
          detailJson: { failed_attempts: attempts, locked_until: lockedUntil.toISOString() }
        });
      }
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

    // 安全事件：登录成功。
    await auditSecurityEvent(deps, {
      actorUserId: user.id,
      entityId: user.id,
      action: "auth.login_succeeded",
      detailJson: { nickname: user.nickname }
    });

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
    const payload = passwordChangeRequestSchema.parse(await readJsonObject(c));
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
    const currentClientToken = readLocalClientToken(c);
    const currentClientDevice = currentClientToken
      ? await deps.devices.findActiveByTokenHashForUser(hashClientToken(currentClientToken), actingUser.id)
      : null;
    await deps.credentials.updatePassword(actingUser.id, await hashPassword(payload.new_password), currentPasswordAlgo());

    // 改密 = 重建信任：撤销旧会话和其它本地客户端令牌；当前请求的会话/token 保持可用，避免成功后立刻把自己踢出。
    const at = (deps.now ?? (() => new Date()))();
    await deps.sessions.revokeAllForUser(actingUser.id, at);
    await bestEffortAuthCleanup("devices.revoke_other_for_user", async () => {
      const devices = await deps.devices.listByUser(actingUser.id);
      for (const device of devices) {
        if (device.revokedAt === null && device.id !== currentClientDevice?.id) {
          await deps.devices.revokeByIdForUser(device.id, actingUser.id, at);
        }
      }
    });
    const { token } = await mintSession(deps, actingUser, { authMethod: "password" });
    await issueSessionCookie(c, token, getAuthSettings(deps));

    // 安全事件：用户自助改密（撤销旧会话即信任重建，必审）。
    await auditSecurityEvent(deps, {
      actorUserId: actingUser.id,
      entityId: actingUser.id,
      action: "auth.password_changed",
      detailJson: { nickname: actingUser.nickname }
    });

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
    const payload = inviteCreateRequestSchema.parse(await readJsonObject(c));
    const at = (deps.now ?? (() => new Date()))();
    const token = generateSessionToken();
    const expiresAt = new Date(at.getTime() + INVITE_TTL_MS);
    const actor = await resolveHumanActor(deps, actingUser);
    const invite = await deps.invites.create({
      email: payload.email.trim(),
      tokenHash: hashSessionToken(token),
      invitedByUserId: actingUser.id,
      role: "member",
      workspaceId: actor.workspaceId,
      expiresAt
    });
    // 安全事件：管理员创建邀请（赋权入口，必审）。entityId=邀请 id；actor=创建邀请的管理员。不记明文 token。
    await auditSecurityEvent(deps, {
      actorUserId: actingUser.id,
      entityId: invite.id,
      action: "auth.invite_created",
      detailJson: { email: invite.email, role: invite.role, workspace_id: invite.workspaceId ?? null }
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
    const rawPayload = await readJsonObject(c);
    const tokenPayload = inviteAcceptTokenRequestSchema.parse(rawPayload);
    const at = (deps.now ?? (() => new Date()))();
    const invite = await deps.invites.findActiveByTokenHash(hashSessionToken(tokenPayload.token), at);
    if (!invite) {
      throw new HTTPException(404, { message: "邀请无效或已过期" });
    }
    const payload = inviteAcceptRequestSchema.parse(rawPayload);
    const nickname = validateNickname(payload.nickname);
    try {
      validatePassword(payload.password);
    } catch (error) {
      if (error instanceof WeakPasswordError) {
        throw new HTTPException(400, { message: error.message });
      }
      throw error;
    }
    if (await deps.credentials.findByEmail(invite.email)) {
      throw new HTTPException(409, { message: "该邮箱已注册" });
    }

    const credentials = deps.credentials;
    const invites = deps.invites;
    const passwordHash = await hashPassword(payload.password);
    const workspaceId = invite.workspaceId ?? getAuthSettings(deps).auth.defaultWorkspaceId;
    // R2 audit 修复（孤儿 user + 烧昵称）：建 user → 建凭据 →（建成员）→ 标记邀请已用，整组同进退。
    // 生产在单事务内做（任一步抛即全回滚，邀请不被消费、昵称/邮箱不被烧）；假仓库注入时回退顺序写，
    // 假仓库不会在中途失败，故单测语义不变（真库的跨表失败窗口才走事务）。
    const user = await runAuthWrites(
      deps,
      { users: deps.users, credentials, memberships: deps.memberships, invites },
      async ({ users, credentials: credentialsTx, memberships, invites: invitesTx }) => {
        // invites 在本路由顶部已被 501 守卫，两条写路径（事务/顺序回退）都必带 invites——防御性兜底。
        if (!invitesTx) {
          throw new HTTPException(501, { message: "当前运行时不支持邀请" });
        }
        const created = await createUserOr409(users, { nickname, cookieToken: makeCookieToken() });
        // 邀请即证明邮箱控制权（trust-on-invite）→ email_verified_at 置 at。
        await createCredentialOr409(credentialsTx, {
          userId: created.id,
          email: invite.email,
          passwordHash,
          passwordAlgo: currentPasswordAlgo(),
          emailVerifiedAt: at
        });
        // 按邀请赋予工作区成员（默认成员=actor 租户锚点）。
        if (memberships) {
          await memberships.create({
            workspaceId,
            userId: created.id,
            role: invite.role as "member" | "admin" | "owner",
            defaultWorkspace: true
          });
        }
        await invitesTx.accept(invite.id, created.id, at);
        return created;
      }
    );

    const { token } = await mintSession(deps, user, { authMethod: "password" });
    await issueSessionCookie(c, token, getAuthSettings(deps));
    await deps.touchUser?.(user.id);

    // 安全事件：邀请被接受 → 新账号入驻（赋权落地，必审）。entityId=新用户；detail 记邀请来源。
    await auditSecurityEvent(deps, {
      actorUserId: user.id,
      entityId: user.id,
      action: "auth.invite_accepted",
      detailJson: { nickname: user.nickname, invite_id: invite.id, email: invite.email, role: invite.role }
    });

    return c.json(toIdentityResponse(user, true), 201);
  });

  routes.get("/me", async (c) => {
    const deps = resolveAuthDependencies(source);
    // R9 批次0-1：/me 对 invalid client token 必须保持抛 403——桌面端「死 token 自愈」
    // （ensureDesktopClientToken）唯一依赖 client.me() 抛出该错才会清掉本地死 token 重新 bootstrap。
    // 吞成 200 null 会让被吊销设备永久静默失联（rank16 回归，r9 审查 auth-core-1）。只吞 401。
    const user = await resolveOptionalCurrentUser(c, deps);
    if (!user) {
      return c.json(null);
    }

    // R2 多租户 Phase 4：identity 的 org/workspace 用 actor 的真实租户（从成员派生），取代写死常量——
    // 单租户下 actor 经 seed 解析 == 默认工作区，零变化；多租户下 /me 如实反映成员所属租户。
    const actor = await resolveHumanActor(deps, user);
    return c.json({
      ...toIdentityResponse(user, false),
      identity: {
        actor_kind: "human",
        actor_id: user.id,
        actor_label: user.nickname,
        user_id: user.id,
        org_id: actor.orgId,
        workspace_id: actor.workspaceId,
        is_admin: user.isAdmin
      }
    });
  });

  routes.patch("/preferences", async (c) => {
    const deps = resolveAuthDependencies(source);
    const user = await resolveCurrentUser(c, deps);
    const payload = updateUserPreferencesRequestSchema.parse(await readJsonObject(c));
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

    const rawToken = readLocalClientToken(c);
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
        if (session && session.userId === user.id) {
          await deps.sessions.revoke(session.id, at);
        }
      }
    }

    forgetUserCookie(c, runtimeSettings);
    await deps.forgetUser?.(user.id);

    // 安全事件：登出（会话/cookie 失效，会话审计闭环）。
    await auditSecurityEvent(deps, {
      actorUserId: user.id,
      entityId: user.id,
      action: "auth.logout",
      detailJson: { nickname: user.nickname }
    });

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
    // 路由 uuid 形参先校验：非 uuid 串原本直达 users.softDelete 的 uuid 列 → PG 22P02 → 误报 500；
    // 与「合法但不存在」同样回 404，攻击者无法据此区分存在性。置于自停用 400 防呆之前。
    if (!isUuidParam(targetId)) {
      throw new HTTPException(404, { message: "用户不存在或已停用" });
    }
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
    // 安全事件：账号被管理员停用（账号级，区别于下方 G3 的逐工作项交接审计）。entityId=被停用用户；
    // actor=执行停用的管理员。这是账号生命周期终止的权威审计点。
    await auditSecurityEvent(deps, {
      actorUserId: actingUser.id,
      entityId: targetId,
      action: "auth.user_deactivated",
      detailJson: { deactivated_nickname: deleted.nickname }
    });
    // 释放邮箱：user_credentials.email 是 citext UNIQUE，停用用户若留着凭据行会让那个邮箱永远无法再注册。
    // 用户行仍以 deletedAt 软删保留供审计，只删对停用用户已无意义的凭据。顺序写——软删成功后残留凭据无害,
    // 故删凭据失败不必回滚软删（与本路由后续撤会话/设备同为尽力而为的善后步骤）。
    if (deps.credentials) {
      await bestEffortAuthCleanup("credentials.delete_by_user", () => deps.credentials!.deleteByUserId(targetId));
    }
    // 工作交接：把被停用用户认领中的非终态事项退回可领取池（claimed_by_user_id=null），避免在岗工作卡在
    // 已消失的人身上。提交人(submitter)字段保留以保溯源，终态(merged/done/cancelled)与已软删事项不动。
    // 每退回一项写一笔审计（actor=执行停用的管理员）让交接可追溯。尽力而为——审计写失败不得使停用失败，
    // 故整段裹 try/catch 仅告警（与上方撤凭据/下方撤会话设备同为善后步骤）。
    if (deps.workItems) {
      try {
        const reassigned = await deps.workItems.unassignActiveClaimsForUser(targetId, at);
        if (deps.auditLogs) {
          for (const item of reassigned) {
            await deps.auditLogs.createAuditLog({
              actorKind: "human",
              actorUserId: actingUser.id,
              entityType: "work_item",
              entityId: item.id,
              action: "work_item.unassigned_on_offboarding",
              detailJson: { offboarded_user_id: targetId }
            });
          }
        }
      } catch (error) {
        console.warn("offboarding work-item handover failed (best-effort)", error);
      }
    }
    // 立即切断访问：撤销全部服务端会话 + 客户端设备令牌。
    if (deps.sessions) {
      await bestEffortAuthCleanup("sessions.revoke_all_for_user", async () => {
        await deps.sessions!.revokeAllForUser(targetId, at);
      });
    }
    await bestEffortAuthCleanup("devices.revoke_for_user", async () => {
      const devices = await deps.devices.listByUser(targetId);
      for (const device of devices) {
        if (device.revokedAt === null) {
          await deps.devices.revokeByIdForUser(device.id, targetId, at);
        }
      }
    });
    await bestEffortAuthCleanup("presence.forget_user", async () => {
      await deps.forgetUser?.(targetId);
    });

    return c.json({ ok: true });
  });

  return routes;
}

// R10-P2-5（委派选人器数据源）：活跃成员简表——只暴露转交所需最小字段（id/昵称/admin），
// 任何已登录成员可读。挂载于 /api → GET /api/users。
export function createUserDirectoryRoutes(source: AuthDependencySource = getDefaultAuthDependencies) {
  const routes = new Hono<AuthEnv>();
  routes.get("/users", async (c) => {
    const deps = resolveAuthDependencies(source);
    await resolveCurrentUser(c, deps);
    if (!deps.users.listActiveRefs) {
      return c.json({ ok: false, error: { code: "users_unsupported", message: "当前存储不支持成员清单。" } }, 501);
    }
    const refs = await deps.users.listActiveRefs();
    return c.json({
      ok: true,
      data: { users: refs.map((user) => ({ id: user.id, nickname: user.nickname, is_admin: user.isAdmin })) }
    });
  });
  return routes;
}
