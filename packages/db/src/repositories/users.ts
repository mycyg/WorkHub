import { randomUUID } from "node:crypto";

import { and, eq, inArray, isNull } from "drizzle-orm";

import type { WorkHubLocale } from "@workhub/contracts";

import type { WorkHubDb } from "../client.js";
import { users } from "../schema/index.js";

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

    async findActiveById(id) {
      const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
      const user = rows[0] ?? null;
      return user && user.deletedAt === null ? user : null;
    },

    async findActiveByCookieToken(cookieToken) {
      // H1：nickname/cookieToken 是部分唯一索引(WHERE deleted_at IS NULL)，同值可有多行(含墓碑)。
      // 必须把 isNull(deletedAt) 推进 WHERE(对齐索引谓词)，否则 limit(1) 无 ORDER BY 可能取到软删墓碑、
      // 再被 JS 后置过滤成 null → 重新注册过的昵称/令牌偶发登录失败。
      const rows = await db
        .select()
        .from(users)
        .where(and(eq(users.cookieToken, cookieToken), isNull(users.deletedAt)))
        .limit(1);
      return rows[0] ?? null;
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
          cookieToken: input.cookieToken,
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
          cookieToken: newCookieToken,
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
        .set({ cookieToken, updatedAt: new Date() })
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
    }
  };
}
