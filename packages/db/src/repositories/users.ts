import { randomUUID } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";

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
};

export function createUserRepository(db: WorkHubDb): UserRepository {
  return {
    async findActiveById(id) {
      const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
      const user = rows[0] ?? null;
      return user && user.deletedAt === null ? user : null;
    },

    async findActiveByCookieToken(cookieToken) {
      const rows = await db
        .select()
        .from(users)
        .where(eq(users.cookieToken, cookieToken))
        .limit(1);
      const user = rows[0] ?? null;
      return user && user.deletedAt === null ? user : null;
    },

    async findActiveByNickname(nickname) {
      const rows = await db
        .select()
        .from(users)
        .where(eq(users.nickname, nickname))
        .limit(1);
      const user = rows[0] ?? null;
      return user && user.deletedAt === null ? user : null;
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

    async updatePreferredLocale(userId, locale) {
      const rows = await db
        .update(users)
        .set({ preferredLocale: locale, updatedAt: new Date() })
        .where(eq(users.id, userId))
        .returning();
      const user = rows[0] ?? null;
      return user && user.deletedAt === null ? user : null;
    }
  };
}
