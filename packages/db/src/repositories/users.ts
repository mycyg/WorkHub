import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

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
      const user = await this.createUser({ nickname, cookieToken: newCookieToken });
      return { user, created: true };
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
