import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";

import type { WorkHubDb } from "../client.js";
import { userCredentials } from "../schema/index.js";

// R2 auth epic（密码基线）：口令凭据仓库。仓库只存/读已哈希的 PHC 串（password_hash）+ 算法标签
// （password_algo），哈希策略在 apps/api 的 password 模块——仓库本身策略无关（与 sessions/devices 同范式）。
// email 列为 citext：eq(email, x) 生成的 `email = $1` 天然大小写不敏感。

export type UserCredentialRow = typeof userCredentials.$inferSelect;

export type CreateUserCredentialInput = {
  id?: string;
  userId: string;
  email: string;
  passwordHash: string | null;
  passwordAlgo: string | null;
  emailVerifiedAt?: Date | null;
};

export type CredentialRepository = {
  findByEmail: (email: string) => Promise<UserCredentialRow | null>;
  findByUserId: (userId: string) => Promise<UserCredentialRow | null>;
  createCredential: (input: CreateUserCredentialInput) => Promise<UserCredentialRow>;
  /** 改密：写新哈希 + 算法，并清零失败计数/解锁（改密视为重新建立信任）。 */
  updatePassword: (userId: string, passwordHash: string, passwordAlgo: string) => Promise<UserCredentialRow | null>;
  /** 记一次登录失败：失败计数 +1，可选置锁定截止（节流暴力破解）。 */
  recordFailedAttempt: (userId: string, lockedUntil?: Date | null) => Promise<UserCredentialRow | null>;
  /** 登录成功后清零失败计数 + 解锁。 */
  resetFailedAttempts: (userId: string) => Promise<UserCredentialRow | null>;
  /** out-of-band 邮箱确认（trust-on-first-use 之外的显式确认）。 */
  setEmailVerified: (userId: string, at: Date) => Promise<UserCredentialRow | null>;
  /**
   * 停用用户时释放其凭据：删除 user_credentials 行，让那个 email（citext UNIQUE）能被重新注册。
   * 用户行仍以 deletedAt 软删保留供审计；只删凭据（对停用用户已无意义）。无该用户凭据时是幂等 no-op。
   */
  deleteByUserId: (userId: string) => Promise<void>;
};

export function createCredentialRepository(db: WorkHubDb): CredentialRepository {
  return {
    async findByEmail(email) {
      const rows = await db.select().from(userCredentials).where(eq(userCredentials.email, email)).limit(1);
      return rows[0] ?? null;
    },

    async findByUserId(userId) {
      const rows = await db.select().from(userCredentials).where(eq(userCredentials.userId, userId)).limit(1);
      return rows[0] ?? null;
    },

    async createCredential(input) {
      const rows = await db
        .insert(userCredentials)
        .values({
          id: input.id ?? randomUUID(),
          userId: input.userId,
          email: input.email,
          passwordHash: input.passwordHash,
          passwordAlgo: input.passwordAlgo,
          emailVerifiedAt: input.emailVerifiedAt ?? null
        })
        .returning();
      const credential = rows[0];
      if (!credential) {
        throw new Error("Failed to create user credential");
      }
      return credential;
    },

    async updatePassword(userId, passwordHash, passwordAlgo) {
      const rows = await db
        .update(userCredentials)
        .set({ passwordHash, passwordAlgo, failedAttempts: 0, lockedUntil: null, updatedAt: new Date() })
        .where(eq(userCredentials.userId, userId))
        .returning();
      return rows[0] ?? null;
    },

    async recordFailedAttempt(userId, lockedUntil) {
      const rows = await db
        .update(userCredentials)
        .set({
          failedAttempts: sql`${userCredentials.failedAttempts} + 1`,
          lockedUntil: lockedUntil ?? null,
          updatedAt: new Date()
        })
        .where(eq(userCredentials.userId, userId))
        .returning();
      return rows[0] ?? null;
    },

    async resetFailedAttempts(userId) {
      const rows = await db
        .update(userCredentials)
        .set({ failedAttempts: 0, lockedUntil: null, updatedAt: new Date() })
        .where(eq(userCredentials.userId, userId))
        .returning();
      return rows[0] ?? null;
    },

    async setEmailVerified(userId, at) {
      const rows = await db
        .update(userCredentials)
        .set({ emailVerifiedAt: at, updatedAt: at })
        .where(eq(userCredentials.userId, userId))
        .returning();
      return rows[0] ?? null;
    },

    async deleteByUserId(userId) {
      await db.delete(userCredentials).where(eq(userCredentials.userId, userId));
    }
  };
}
