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
import { generateSessionToken, hashSessionToken, isPgErrorCode } from "@workhub/db";

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
  resolveNewUserLocale,
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
import { WorkspaceMemberServiceError } from "../services/workspace-members.js";
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
// R24 S3 严重#7：这两个判定曾经直接读顶层 error.code——但 drizzle-orm 0.45 的 node-postgres 驱动把
// 裸 pg DatabaseError 包进 DrizzleQueryError 的 `.cause`，顶层 code 恒为 undefined，判定死代码从不
// 命中（走查复现：首启主窗+桌宠并发打 desktop-bootstrap，输家在 ensureDefaultWorkspaceMembership
// 插 workspace_memberships 撞唯一索引，本该被这里吞掉，却直接冒泡成未捕获 500）。改用
// @workhub/db 的 isPgErrorCode（沿 `.cause` 链查找），同时兼容测试里直接顶层塞 code 的假错误。
function isUniqueViolation(error: unknown): boolean {
  return isPgErrorCode(error, "23505");
}

// 裸 PG 外键违约（23503）→ ensureDefaultWorkspaceMembership 的 best-effort 降级判定，见其 catch。
function isForeignKeyViolation(error: unknown): boolean {
  return isPgErrorCode(error, "23503");
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

type OffboardCleanupStep = { step: string; ok: boolean; error?: string };
type OffboardCleanupResult = { complete: boolean; steps: OffboardCleanupStep[] };

// P2-02（停用账号善后清理 · 可重入）：把账号停用后的各善后步骤收进一个「幂等 + 可重跑」例程。
// 每步都能重复执行并收敛——删已删的凭据=0 行、撤已撤的会话/设备=无操作、退回已退回的事项=空集、
// forgetUser 天然幂等——故某步失败留下半清理态时，重跑本例程会把残留逐步收敛到全清理。
// R21 加固：工作交接步优先走仓储层「退回+审计」原子入口（同一 db 事务，见 workitems.handover 处注释），
// 保证「退回成功但审计缺失」这种半态不再出现——步骤失败时整步回滚，重跑真收敛。
// 不吞错伪装成功：逐步捕获，失败写结构化告警并记入返回的 steps[]，由调用方据 complete 决定是否重试。
// 与 SEC-1（工作区移出）边界：SEC-1 是「工作区成员软删 + 撤 token」的【同事务】原子操作（见
// services/workspace-members.ts removeMember）；本例程是【账号级】停用善后，且含 presence.forgetUser
// 这种非库内的外部存储清理，无法整体收进库事务，故取「幂等重入」而非单事务。
async function runOffboardCleanup(
  deps: AuthDependencies,
  targetId: string,
  actingUserId: string,
  at: Date
): Promise<OffboardCleanupResult> {
  const steps: OffboardCleanupStep[] = [];
  const runStep = async (step: string, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
      steps.push({ step, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // 结构化告警：停用善后某步失败会留下半清理态，须可见、可重跑（P2-02）。
      console.warn(
        JSON.stringify({
          event: "auth.offboard_cleanup_step_failed",
          step,
          target_user_id: targetId,
          actor_user_id: actingUserId,
          error: message
        })
      );
      steps.push({ step, ok: false, error: message });
    }
  };

  // 释放邮箱（幂等：删不存在的凭据 = 0 行）。user_credentials.email 是 citext UNIQUE，停用用户若留着
  // 凭据行会让那个邮箱永远无法再注册；用户行仍以 deletedAt 软删保留供审计，只删对停用用户已无意义的凭据。
  if (deps.credentials) {
    await runStep("credentials.delete_by_user", () => deps.credentials!.deleteByUserId(targetId));
  }
  // 工作交接（幂等：只退回仍在认领中的非终态事项，已退回则为空集）。提交人(submitter)字段保留以保溯源，
  // 终态(merged/done/cancelled)与已软删事项不动；每退回一项写一笔审计让交接可追溯。
  // R21 加固（停用善后审计缺口）：优先走仓储层的原子版本 unassignActiveClaimsForUserWithAudit——退回与
  // 逐项审计共一 db 事务，审计写失败则退回一并回滚，重跑本善后才能真收敛（旧顺序写在审计失败时退回已
  // 生效、审计永久缺失——重试扫不到任何可退回行）。原子入口缺席（假仓库/老运行时）时回退顺序写，行为不变。
  if (deps.workItems) {
    await runStep("workitems.handover", async () => {
      const handover = deps.workItems!;
      if (handover.unassignActiveClaimsForUserWithAudit) {
        await handover.unassignActiveClaimsForUserWithAudit({
          userId: targetId,
          at,
          actorUserId: actingUserId
        });
        return;
      }
      const reassigned = await handover.unassignActiveClaimsForUser(targetId, at);
      if (deps.auditLogs) {
        for (const item of reassigned) {
          await deps.auditLogs.createAuditLog({
            actorKind: "human",
            actorUserId: actingUserId,
            // MRG-11：顶层 workspaceId 从 work item 行带出——工作区审计流按它硬过滤，缺列即查不到。
            ...(item.workspaceId ? { workspaceId: item.workspaceId } : {}),
            entityType: "work_item",
            entityId: item.id,
            action: "work_item.unassigned_on_offboarding",
            detailJson: { offboarded_user_id: targetId }
          });
        }
      }
    });
  }
  // 立即切断访问（幂等：撤已撤的会话/设备 = 无操作）。
  if (deps.sessions) {
    await runStep("sessions.revoke_all_for_user", async () => {
      await deps.sessions!.revokeAllForUser(targetId, at);
    });
  }
  await runStep("devices.revoke_for_user", async () => {
    const devices = await deps.devices.listByUser(targetId);
    for (const device of devices) {
      if (device.revokedAt === null) {
        await deps.devices.revokeByIdForUser(device.id, targetId, at);
      }
    }
  });
  await runStep("presence.forget_user", async () => {
    await deps.forgetUser?.(targetId);
  });

  return { complete: steps.every((entry) => entry.ok), steps };
}

// P2-02 重试入口判据：softDelete 落空（isNull(deletedAt) 守卫）时，分辨「已停用（墓碑在，本次即善后
// 重跑）」与「从不存在（真 404）」。复用既有 findRefsByIds（含墓碑、无需新迁移/新仓库方法）。
async function isSoftDeletedUser(deps: AuthDependencies, id: string): Promise<boolean> {
  if (!deps.users.findRefsByIds) {
    return false; // 无该可选查询的运行时：分辨不了墓碑与不存在，保持既有 404 行为（保守 fail-closed）。
  }
  const refs = await deps.users.findRefsByIds([id]);
  const ref = refs.find((entry) => entry.id === id);
  return Boolean(ref && ref.deletedAt !== null);
}

// ENV-01 修复（R12 人工验收）：昵称 identify / 桌面首启引导此前只调用 getOrCreateActiveByNickname
// 建 user 行，从不建 workspace_memberships——conversations/workbench 等路由的鉴权都要求 active
// membership，新用户由此处处 404。密码注册路径（见下方 /register）已有先例（memberships.create +
// defaultWorkspace:true），这里补齐同一语义，供 /identify 与 /desktop-bootstrap 共用。
// 幂等：先查 active 成员行，命中即短路；不重复建行、不覆写既有 role/defaultWorkspace。
async function ensureDefaultWorkspaceMembership(deps: AuthDependencies, userId: string): Promise<void> {
  const memberships = deps.memberships;
  if (!memberships) {
    return; // OPTIONAL seam：老运行时/假仓库缺席时跳过（与 /register 的 `if (memberships)` 同范式）。
  }
  const defaultWorkspaceId = getAuthSettings(deps).auth.defaultWorkspaceId;
  const existing = await memberships.findActiveForUserWorkspace(userId, defaultWorkspaceId);
  if (existing) {
    return; // 已是该工作区的 active 成员——幂等短路。
  }
  // SEC-1（P0-01）：identify/bootstrap 只为「从未有过 membership 行」的新用户建行。查到软删墓碑
  // （= 被管理员移出）则拒绝复活，fail-closed 403 workspace_access_revoked——否则被移出者一次 identify
  // 就自动补回成员身份、绕过移出。恢复必须走管理员显式动作。
  // TODO(SEC-1)：未来若需自助/管理员恢复，新增显式「重新加入」端点（校验邀请/管理员授权后清墓碑或建新行），
  // 不要在此隐式复活。
  const tombstone = await memberships.findSoftDeletedForUserWorkspace(userId, defaultWorkspaceId);
  if (tombstone) {
    throw new WorkspaceMemberServiceError(
      403,
      "workspace_access_revoked",
      "你已被移出该工作区，访问已被撤销。如需恢复请联系工作区管理员。"
    );
  }
  // schema 有「每用户至多一个 default workspace」的部分唯一索引
  // （workspace_memberships_user_default_uq）；只有该用户当前没有任何 active 默认工作区成员行时
  // 才把这行标记为默认，避免撞索引。
  const hasAnyDefault = await memberships.resolveDefaultWorkspace(userId);
  try {
    await memberships.create({
      workspaceId: defaultWorkspaceId,
      userId,
      role: "member",
      defaultWorkspace: !hasAnyDefault
    });
  } catch (error) {
    // 并发 identify/desktop-bootstrap 竞态：另一请求已抢先建好同一 (workspace,user) 行——幂等丢弃。
    if (isUniqueViolation(error)) {
      return;
    }
    // 默认工作区行不存在（migrate-only 库在迁移 0053 之前的存量状态，或 DEFAULT_WORKSPACE_ID 被
    // 指向不存在的行）→ FK 违约。登录不能因补建 membership 失败而 500：降级为本次跳过（与
    // ENV-01 修复前同等体验），修好数据后下次 identify 自愈。
    if (isForeignKeyViolation(error)) {
      console.warn("auth membership ensure skipped (best-effort): default workspace row missing", error);
      return;
    }
    throw error;
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
    // R24 S3 严重#4：只在真正新建时生效——命中既有用户 getOrCreateActiveByNickname 内部短路，
    // 不会碰这个 locale。
    const newUserLocale = resolveNewUserLocale(payload.locale, c.req.header("Accept-Language"));
    let { user, created } = await deps.users.getOrCreateActiveByNickname(nickname, makeCookieToken(), {
      preferredLocale: newUserLocale
    });

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

    // ENV-01：identify 出来的用户必须有默认工作区的 active membership，否则 conversations/
    // workbench 等鉴权全部 404。新建/已有用户都过一遍幂等 ensure。
    await ensureDefaultWorkspaceMembership(deps, user.id);

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
      // P1-02（REL-5）：密码/hybrid 模式下桌面不能昵称自助引导，但仍需要一条可用登录链路。
      // 本端点在密码模式改为「凭已建立的会话换设备令牌」的 exchange：用户先经既有 /api/auth/login
      // 建会话（cookie），桌面再打这一条把会话换成后续请求走 header 的 client_token——桌面跨源
      // (tauri://localhost→127.0.0.1) 不能靠 SameSite=Lax cookie 鉴权，必须持 token 走 header
      // （见 middleware/auth.ts 顶注）。不新造鉴权：会话校验完全复用 resolveCurrentUser。
      // 本路径已在 CSRF 同源守卫豁免（middleware/csrf.ts 的 desktop-bootstrap），桌面跨源 POST 得以送达；
      // 会话 cookie 的 SameSite=Lax 仍是这条豁免路径的 CSRF 防线（跨站攻击页发不出带会话的请求 →
      // 下面解析不到用户 → 404 拒），故豁免不新增 CSRF 面。
      // 无有效会话（首启尚未登录 / 会话过期）→ 404 拒（沿用本端点既有「当前模式不可用」语义，桌面据此
      // 渲凭据登录表单，登录后重打本端点）；持垃圾 client token → resolveOptionalCurrentUser 冒泡 403 拒。
      const user = await resolveOptionalCurrentUser(c, deps);
      if (!user) {
        throw new HTTPException(404, { message: "桌面引导在密码模式下需要先用凭据登录" });
      }
      const payload = desktopBootstrapRequestSchema.parse(await readJsonObject(c));
      // ENV-01：同 nickname 引导幂等确保默认工作区 active membership，否则换到 token 也进不了任何会话。
      await ensureDefaultWorkspaceMembership(deps, user.id);
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
          identity: toIdentityResponse(user, false),
          device: toClientDeviceResponse(device),
          client_token: token
        },
        201
      );
    }
    const payload = desktopBootstrapRequestSchema.parse(await readJsonObject(c));
    const nickname = validateNickname(payload.nickname);
    // R24 S3 严重#4：同 /identify——只在真正新建时生效，命中既有用户不改其偏好。
    const newUserLocale = resolveNewUserLocale(payload.locale, c.req.header("Accept-Language"));
    const { user, created } = await deps.users.getOrCreateActiveByNickname(nickname, makeCookieToken(), {
      preferredLocale: newUserLocale
    });
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
    // ENV-01：桌面首启引导同样只建用户不建成员——同一修法一并补上，否则桌面新设备首启的用户也
    // 进不了任何项目会话。
    await ensureDefaultWorkspaceMembership(deps, user.id);
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
    // R24 S3 严重#4：/register 总是新建用户（上面已做邮箱唯一预检），locale 直接落 createUser。
    const newUserLocale = resolveNewUserLocale(payload.locale, c.req.header("Accept-Language"));

    const credentials = deps.credentials;
    // R2 audit 修复（孤儿 user + 烧昵称）：user+credential 两笔写要么都成功要么都不留痕。
    // 生产经 atomicAuthWrites 在单事务内做（credential 失败则 createUser 回滚）；测试注入假仓库时
    // 该 seam 缺席，回退到原顺序写——假仓库的 createCredential 不会在 createUser 成功后失败，
    // 故顺序回退对单测语义不变（真库才有跨表失败窗口，那里走事务）。每步的 23505 在写点就地映射成
    // 对应 409（昵称 vs 邮箱），异常向上冒泡即触发事务回滚，HTTP 语义与原逐步写逐字一致。
    const user = await runAuthWrites(deps, { users: deps.users, credentials, memberships: deps.memberships }, async ({ users, credentials: credentialsTx, memberships }) => {
      // cookieToken 在会话模式下是 vestigial，但列 NOT NULL，仍生成一个。
      const created = await createUserOr409(users, {
        nickname,
        cookieToken: makeCookieToken(),
        isAdmin: shouldBeAdmin,
        preferredLocale: newUserLocale
      });
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
    // MRG-11：顶层 workspaceId 必带——工作区审计流（listAuditLogsForWorkspace）按它硬过滤，缺列即查不到。
    await auditSecurityEvent(deps, {
      actorUserId: actingUser.id,
      workspaceId: invite.workspaceId ?? actor.workspaceId,
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

  // R18 批 H1（成员管理面板 · 未过期邀请清单）：管理员列出本工作区仍可用的邀请（未接受 ∧ 未撤销 ∧
  // 未过期，最新在前）。门控与错误码同 POST /invites（鉴权先行 401 → 非管理员 403 → 非密码模式 404 →
  // 运行时不支持 501）。绝不回 token——服务端只存 sha256(token)，明文取不回（POST 创建时一次性回过）。
  routes.get("/invites", async (c) => {
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
    // ?status=pending 是目前唯一支持的取值（默认 pending）——收窄查询面，其它取值直接 400，
    // 避免客户端误以为 status=accepted 等也能查（本端点只服务成员管理面板的未过期邀请追踪）。
    const status = c.req.query("status") ?? "pending";
    if (status !== "pending") {
      throw new HTTPException(400, { message: "只支持 status=pending" });
    }
    const at = (deps.now ?? (() => new Date()))();
    const actor = await resolveHumanActor(deps, actingUser);
    const rows = await deps.invites.listPending(actor.workspaceId, at);
    return c.json({
      invites: rows.map((row) => ({
        invite_id: row.id,
        email: row.email,
        expires_at: row.expiresAt.toISOString(),
        created_at: row.createdAt.toISOString()
      }))
    });
  });

  // R20 P1-05：撤销一条未过期邀请（管理员在 web 成员分区点「撤销」）。门控同 POST/GET /invites
  // （鉴权先行 401 → 非管理员 403 → 非密码模式 404 → 运行时不支持 501）。仓库 revoke(id) 按 id 软删、
  // 不带工作区谓词——故这里先经 listPending(actor.workspaceId) 确认该邀请确属发起人本工作区且仍是
  // 未过期未接受未撤销的活跃邀请，再撤；查无（跨租户 id / 已接受 / 已过期 / 已撤销）一律 404，绝不
  // 让管理员据 id 撤掉别的工作区的邀请（fail-closed，租户隔离靠 listPending 谓词而非只信 :inviteId）。
  routes.delete("/invites/:inviteId", async (c) => {
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
    const inviteId = c.req.param("inviteId");
    const at = (deps.now ?? (() => new Date()))();
    const actor = await resolveHumanActor(deps, actingUser);
    // 租户隔离 + 存在性：只允许撤销本工作区当前活跃（未接受∧未撤销∧未过期）的邀请。
    const pending = await deps.invites.listPending(actor.workspaceId, at);
    const target = pending.find((row) => row.id === inviteId);
    if (!target) {
      throw new HTTPException(404, { message: "邀请不存在或已失效" });
    }
    const revoked = await deps.invites.revoke(target.id, at);
    if (!revoked) {
      // 并发窗口：listPending 后被别的请求抢先撤/接受——幂等地按「已失效」回 404，不 500。
      throw new HTTPException(404, { message: "邀请不存在或已失效" });
    }
    // 安全事件：管理员撤销邀请（收回赋权入口，必审）。entityId=邀请 id；actor=撤销的管理员。
    // MRG-11：顶层 workspaceId 必带（优先取邀请行自身的租户）——否则工作区审计页永远查不到这条撤销。
    await auditSecurityEvent(deps, {
      actorUserId: actingUser.id,
      workspaceId: revoked.workspaceId ?? actor.workspaceId,
      entityId: revoked.id,
      action: "auth.invite_revoked",
      detailJson: { email: revoked.email, workspace_id: revoked.workspaceId ?? null }
    });
    return c.json({ ok: true as const, invite_id: revoked.id });
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
    // R24 S3 严重#4：邀请接受总是新建用户（上面已做邮箱唯一预检），locale 直接落 createUser。
    const newUserLocale = resolveNewUserLocale(payload.locale, c.req.header("Accept-Language"));
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
        const created = await createUserOr409(users, {
          nickname,
          cookieToken: makeCookieToken(),
          preferredLocale: newUserLocale
        });
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
    // MRG-11：顶层 workspaceId 取邀请落地的工作区（invite.workspaceId ?? 默认工作区，即上方成员写入的同一个）。
    await auditSecurityEvent(deps, {
      actorUserId: user.id,
      workspaceId,
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
    if (deleted) {
      // 安全事件：账号被管理员停用（账号级，区别于 G3 的逐工作项交接审计）。entityId=被停用用户；
      // actor=执行停用的管理员。这是账号生命周期终止的权威审计点，只在首次停用（软删命中）时写一笔。
      // MRG-11：顶层 workspaceId 锚到执行管理员的工作区（账号级事件没有天然实体工作区），否则工作区
      // 审计页按 workspaceId 硬过滤永远查不到。best-effort：解析失败不阻断停用主流程（审计本就尽力而为）。
      const actingTenant = await deps.memberships?.resolveDefaultTenant(actingUser.id).catch(() => null);
      await auditSecurityEvent(deps, {
        actorUserId: actingUser.id,
        ...(actingTenant?.workspaceId ? { workspaceId: actingTenant.workspaceId } : {}),
        entityId: targetId,
        action: "auth.user_deactivated",
        detailJson: { deactivated_nickname: deleted.nickname }
      });
    } else {
      // softDelete 落空（isNull(deletedAt) 守卫）：或【已停用】(墓碑在，本次即善后重跑) 或【从不存在】(真 404)。
      // P2-02：停用善后是 best-effort 步骤，中途失败会留下半清理态；重发本请求即为重试入口——重跑幂等
      // 清理收敛，不再一律 404 把重试路径堵死。用 findRefsByIds（含墓碑）分辨墓碑与不存在。
      const alreadyDeactivated = await isSoftDeletedUser(deps, targetId);
      if (!alreadyDeactivated) {
        throw new HTTPException(404, { message: "用户不存在或已停用" });
      }
    }

    // 善后清理：幂等 + 可重跑。逐步捕获失败（不吞错伪装成功），失败步落结构化日志并记入 cleanup.steps。
    const cleanup = await runOffboardCleanup(deps, targetId, actingUser.id, at);
    if (!cleanup.complete) {
      // 失败可见（P2-02）：账号墓碑已置（首次）或早已置（重试），但某清理步未完成 → 残留访问可能仍在。
      // 回 500 让调用方感知（不伪装成功），重发本请求即重试，直至 cleanup.complete。
      const failed = cleanup.steps.filter((entry) => !entry.ok).map((entry) => entry.step);
      console.warn(
        JSON.stringify({
          event: "auth.offboard_cleanup_incomplete",
          target_user_id: targetId,
          actor_user_id: actingUser.id,
          failed_steps: failed
        })
      );
      return c.json(
        {
          ok: false,
          error: { code: "offboard_cleanup_incomplete", message: "账号已停用，但部分善后清理未完成，请重试。" },
          deactivated: true,
          cleanup
        },
        500
      );
    }

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
    const currentUser = await resolveCurrentUser(c, deps);
    const memberships = deps.memberships;
    const listActiveRefsForWorkspace = deps.users.listActiveRefsForWorkspace;
    if (!memberships?.findActiveForUserWorkspace || !listActiveRefsForWorkspace) {
      return c.json(
        { ok: false, error: { code: "users_unsupported", message: "当前存储不支持工作区成员清单。" } },
        501
      );
    }
    // R11 Batch 0：目录按 actor 工作区收拢——先验 actor 在该工作区的 active membership（fail-closed），
    // 再只回该工作区的活跃成员，杜绝跨工作区成员枚举。
    const actor = await resolveHumanActor(deps, currentUser);
    const membership = await memberships.findActiveForUserWorkspace(currentUser.id, actor.workspaceId);
    if (!membership) {
      return c.json(
        { ok: false, error: { code: "workspace_membership_required", message: "当前用户不是该工作区的活跃成员。" } },
        403
      );
    }
    const refs = await listActiveRefsForWorkspace.call(deps.users, actor.workspaceId);
    return c.json({
      ok: true,
      data: { users: refs.map((user) => ({ id: user.id, nickname: user.nickname, is_admin: user.isAdmin })) }
    });
  });
  return routes;
}
