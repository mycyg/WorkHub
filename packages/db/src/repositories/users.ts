import { createHash, randomUUID } from "node:crypto";

import { and, eq, inArray, isNull, or } from "drizzle-orm";

import type { WorkHubLocale } from "@workhub/contracts";

import type { WorkHubDb } from "../client.js";
import { users, workspaceMemberships } from "../schema/index.js";

// CORE-02：users.cookie_token 是 bearer 凭据，落库一律 sha256 哈希（与同库 sessions.token_hash /
// client_devices.token_hash 的纪律一致）——一次 DB 读泄漏不再等于全员可冒充。
export function hashCookieToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export type UserAuthRow = typeof users.$inferSelect;

export type GetOrCreateUserResult = {
  user: UserAuthRow;
  created: boolean;
};

export type CreateUserInput = {
  id?: string;
  nickname: string;
  cookieToken: string;
  isAdmin?: boolean;
  preferredLocale?: WorkHubLocale;
};

export type UserRepository = {
  findActiveById: (id: string) => Promise<UserAuthRow | null>;
  findActiveByCookieToken: (cookieToken: string) => Promise<UserAuthRow | null>;
  findActiveByNickname: (nickname: string) => Promise<UserAuthRow | null>;
  createUser: (input: CreateUserInput) => Promise<UserAuthRow>;
  getOrCreateActiveByNickname: (nickname: string, newCookieToken: string) => Promise<GetOrCreateUserResult>;
  rotateCookieToken: (userId: string, cookieToken: string) => Promise<UserAuthRow | null>;
  updatePreferredLocale?: (userId: string, locale: WorkHubLocale) => Promise<UserAuthRow | null>;
  promoteToAdmin?: (userId: string) => Promise<UserAuthRow | null>;
  // R2 auth epic：首管引导用——空/零管理员的实例里首个密码注册者置 admin（取代 ADMIN_CLAIM_SECRET）。
  // OPTIONAL：旧运行时/假仓库不实现则跳过自举（默认不自动提权）。
  hasAnyActiveAdmin?: () => Promise<boolean>;
  // R2 auth epic（账号生命周期-停用）：软删用户并记录操作者。OPTIONAL（假仓库不实现则路由回 501）。
  softDelete?: (userId: string, deletedByUserId: string, at: Date) => Promise<UserAuthRow | null>;
  // R2 audit#5：按 id 批量取「活跃态引用」（含已软删者，带 deletedAt）。
  // 通知收件人活跃度过滤要分辨「不存在」与「已停用」——故不能复用只回活跃用户的 findActiveById；
  // 缺失 id 不在结果里（调用方据此 fail-open 视为活跃，只在确认 deletedAt 时丢弃）。OPTIONAL（假仓库不实现则跳过过滤）。
  findRefsByIds?: (ids: string[]) => Promise<Array<Pick<UserAuthRow, "id" | "deletedAt">>>;
  // 团队就绪 must-have（通知偏好-按类型静音）：读/写该用户被静音的通知类型清单。
  // 空/缺失=不静音（DEFAULT-OFF）。OPTIONAL（假仓库不实现则通知路径跳过静音、按今天创建）。
  getMutedNotificationTypes?: (userId: string) => Promise<string[]>;
  setMutedNotificationTypes?: (userId: string, types: string[]) => Promise<UserAuthRow | null>;
  // R10-P2-5（委派选人器）：活跃成员简表（id+昵称+admin），按昵称排序、上限 200——只暴露转交
  // 所需的最小字段。OPTIONAL（假仓库不实现则 /api/users 回 501，前端选人器降级隐藏）。
  listActiveRefs?: () => Promise<Array<Pick<UserAuthRow, "id" | "nickname" | "isAdmin">>>;
  // R11 Batch 0（工作区级成员目录）：同 listActiveRefs 但按工作区收拢——只返回该工作区有
  // active membership 且未软删的用户，杜绝跨工作区成员枚举。OPTIONAL（同 listActiveRefs 的
  // 501 降级范式）；实现存在时 /api/users 优先用它。
  listActiveRefsForWorkspace?: (
    workspaceId: string
  ) => Promise<Array<Pick<UserAuthRow, "id" | "nickname" | "isAdmin">>>;
  // R14 批 AVATAR（头像与资料入口）：写入/清空/读取用户头像二进制。setAvatar 覆盖写（含
  // avatarUpdatedAt，兼作 GET 端点的 ETag 源）；clearAvatar 回退「无头像」（渲染层回退首字母
  // 色块 tile）；findAvatar 只取头像相关两列，避免整行 SELECT * 把 bytea 意外带进不需要它的查询。
  // OPTIONAL：假仓库不实现则头像端点回 501（同 mutedNotificationTypes 的可选契约先例）。
  setAvatar?: (userId: string, avatarWebp: Buffer, at: Date) => Promise<UserAuthRow | null>;
  clearAvatar?: (userId: string, at: Date) => Promise<UserAuthRow | null>;
  findAvatar?: (userId: string) => Promise<{ avatarWebp: Buffer | null; avatarUpdatedAt: Date | null } | null>;
};

export function createUserRepository(db: WorkHubDb): UserRepository {
  return {
    async listActiveRefs() {
      const rows = await db
        .select({ id: users.id, nickname: users.nickname, isAdmin: users.isAdmin })
        .from(users)
        .where(isNull(users.deletedAt))
        .orderBy(users.nickname)
        .limit(200);
      return rows;
    },

    async listActiveRefsForWorkspace(workspaceId) {
      const rows = await db
        .select({ id: users.id, nickname: users.nickname, isAdmin: users.isAdmin })
        .from(users)
        .innerJoin(
          workspaceMemberships,
          and(eq(workspaceMemberships.userId, users.id), eq(workspaceMemberships.workspaceId, workspaceId))
        )
        .where(and(isNull(users.deletedAt), isNull(workspaceMemberships.deletedAt)))
        .orderBy(users.nickname)
        .limit(200);
      return rows;
    },

    async findActiveById(id) {
      const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
      const user = rows[0] ?? null;
      return user && user.deletedAt === null ? user : null;
    },

    async findActiveByCookieToken(cookieToken) {
      // H1：nickname/cookieToken 是部分唯一索引(WHERE deleted_at IS NULL)，同值可有多行(含墓碑)。
      // 必须把 isNull(deletedAt) 推进 WHERE(对齐索引谓词)，否则 limit(1) 无 ORDER BY 可能取到软删墓碑、
      // 再被 JS 后置过滤成 null → 重新注册过的昵称/令牌偶发登录失败。
      // CORE-02（过渡期）：优先按 sha256(入参) 匹配（新写法）；落空再按明文匹配旧行——命中即升级为
      // 哈希（客户端 cookie 值不变，下次请求走哈希分支），随后返回行的 cookieToken 已是哈希值。
      const tokenHash = hashCookieToken(cookieToken);
      const rows = await db
        .select()
        .from(users)
        .where(and(
          or(eq(users.cookieToken, tokenHash), eq(users.cookieToken, cookieToken)),
          isNull(users.deletedAt)
        ))
        .limit(1);
      const row = rows[0] ?? null;
      if (!row || row.cookieToken === tokenHash) {
        return row;
      }
      const upgraded = await db
        .update(users)
        .set({ cookieToken: tokenHash, updatedAt: new Date() })
        .where(and(eq(users.id, row.id), isNull(users.deletedAt)))
        .returning();
      return upgraded[0] ?? { ...row, cookieToken: tokenHash };
    },

    async findActiveByNickname(nickname) {
      const rows = await db
        .select()
        .from(users)
        .where(and(eq(users.nickname, nickname), isNull(users.deletedAt)))
        .limit(1);
      return rows[0] ?? null;
    },

    async createUser(input) {
      const rows = await db
        .insert(users)
        .values({
          id: input.id ?? randomUUID(),
          nickname: input.nickname,
          // CORE-02：bearer 凭据只存 sha256；签发侧用返回行的哈希值作 cookie（读取侧兼容）。
          cookieToken: hashCookieToken(input.cookieToken),
          preferredLocale: input.preferredLocale ?? "zh-CN",
          isAdmin: input.isAdmin ?? false
        })
        .returning();
      const user = rows[0];
      if (!user) {
        throw new Error("Failed to create user");
      }
      return user;
    },

    async getOrCreateActiveByNickname(nickname, newCookieToken) {
      const existing = await this.findActiveByNickname(nickname);
      if (existing) {
        return { user: existing, created: false };
      }
      // findings[#low]：check-then-insert 并发竞态——两个首登同 nickname 都过 findActive 检查，
      // 输者撞 nickname 部分唯一索引(WHERE deleted_at IS NULL)抛 500。改 onConflictDoNothing：
      // 插入返回行=created；冲突(0 行)=他人已建，回查复用、不算 created。
      const inserted = await db
        .insert(users)
        .values({
          id: randomUUID(),
          nickname,
          cookieToken: hashCookieToken(newCookieToken),
          preferredLocale: "zh-CN",
          isAdmin: false
        })
        .onConflictDoNothing()
        .returning();
      const created = inserted[0];
      if (created) {
        return { user: created, created: true };
      }
      const fallback = await this.findActiveByNickname(nickname);
      if (!fallback) {
        throw new Error("Failed to create or resolve user by nickname");
      }
      return { user: fallback, created: false };
    },

    async rotateCookieToken(userId, cookieToken) {
      const rows = await db
        .update(users)
        // CORE-02：轮换同样只落哈希——旧 cookie 立即失效（库里已没有它的明文/旧哈希）。
        .set({ cookieToken: hashCookieToken(cookieToken), updatedAt: new Date() })
        .where(eq(users.id, userId))
        .returning();
      const user = rows[0] ?? null;
      return user && user.deletedAt === null ? user : null;
    },

    async promoteToAdmin(userId) {
      const rows = await db
        .update(users)
        .set({ isAdmin: true, updatedAt: new Date() })
        .where(eq(users.id, userId))
        .returning();
      const user = rows[0] ?? null;
      return user && user.deletedAt === null ? user : null;
    },

    async hasAnyActiveAdmin() {
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.isAdmin, true), isNull(users.deletedAt)))
        .limit(1);
      return rows.length > 0;
    },

    async softDelete(userId, deletedByUserId, at) {
      // 仅软删仍 active 的用户（幂等：已删行不再返回）。
      const rows = await db
        .update(users)
        .set({ deletedAt: at, deletedByUserId, updatedAt: at })
        .where(and(eq(users.id, userId), isNull(users.deletedAt)))
        .returning();
      return rows[0] ?? null;
    },

    async updatePreferredLocale(userId, locale) {
      const rows = await db
        .update(users)
        .set({ preferredLocale: locale, updatedAt: new Date() })
        .where(eq(users.id, userId))
        .returning();
      const user = rows[0] ?? null;
      return user && user.deletedAt === null ? user : null;
    },

    async findRefsByIds(ids) {
      // R2 audit#5：含已软删者的一次性批量查询（不过滤 deletedAt）；空入参不打库。
      if (ids.length === 0) {
        return [];
      }
      return db
        .select({ id: users.id, deletedAt: users.deletedAt })
        .from(users)
        .where(inArray(users.id, ids));
    },

    async getMutedNotificationTypes(userId) {
      // 团队就绪 must-have：读该用户被静音的通知类型；行不存在/列为空一律回 []（DEFAULT-OFF）。
      const rows = await db
        .select({ mutedNotificationTypes: users.mutedNotificationTypes })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return rows[0]?.mutedNotificationTypes ?? [];
    },

    async setMutedNotificationTypes(userId, types) {
      const rows = await db
        .update(users)
        .set({ mutedNotificationTypes: types, updatedAt: new Date() })
        .where(eq(users.id, userId))
        .returning();
      const user = rows[0] ?? null;
      return user && user.deletedAt === null ? user : null;
    },

    async setAvatar(userId, avatarWebp, at) {
      const rows = await db
        .update(users)
        .set({ avatarWebp, avatarUpdatedAt: at, updatedAt: at })
        .where(and(eq(users.id, userId), isNull(users.deletedAt)))
        .returning();
      return rows[0] ?? null;
    },

    async clearAvatar(userId, at) {
      const rows = await db
        .update(users)
        .set({ avatarWebp: null, avatarUpdatedAt: null, updatedAt: at })
        .where(and(eq(users.id, userId), isNull(users.deletedAt)))
        .returning();
      return rows[0] ?? null;
    },

    async findAvatar(userId) {
      const rows = await db
        .select({ avatarWebp: users.avatarWebp, avatarUpdatedAt: users.avatarUpdatedAt })
        .from(users)
        .where(and(eq(users.id, userId), isNull(users.deletedAt)))
        .limit(1);
      return rows[0] ?? null;
    }
  };
}
