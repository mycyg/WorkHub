import { createHash, randomBytes, randomUUID } from "node:crypto";

import { and, eq, gt, isNull, lt, type SQL } from "drizzle-orm";

import type { WorkHubDb } from "../client.js";
import { sessions } from "../schema/index.js";

// R2 epic(真认证)：服务端会话仓库。与 devices 仓库同范式——仓库只认 token_hash（明文 secret 永不落库），
// 哈希/生成在本模块的纯函数里，供服务层调用。绝对过期(硬上限) + 滑动过期(每次活动续期)双控；
// revokedAt 墓碑用于登出/停用批量撤销。本仓库首版不接线（中间件仍走 nickname cookieToken），
// 为后续 AUTH_MODE 切换备好数据访问层。

export type SessionRow = typeof sessions.$inferSelect;

export type SessionAuthMethod = "password" | "oidc" | "nickname";

export type CreateSessionInput = {
  id?: string;
  userId: string;
  tokenHash: string;
  authMethod?: SessionAuthMethod;
  oidcProvider?: string | null;
  ipHash?: string | null;
  userAgent?: string | null;
  absoluteExpiresAt: Date;
  idleExpiresAt: Date;
};

export type SessionRepository = {
  /** 新建会话行（调用方已生成 + 哈希 token；明文只回给客户端一次）。 */
  create: (input: CreateSessionInput) => Promise<SessionRow>;
  /** 按 token_hash 取仍然有效的会话：未撤销 且 绝对未过期 且 滑动未过期。过期/撤销返回 null。 */
  findActiveByTokenHash: (tokenHash: string, now: Date) => Promise<SessionRow | null>;
  /** 滑动续期：把 idle 过期推到新值并记 last_seen；仅对未撤销会话生效（不复活墓碑）。 */
  touch: (sessionId: string, idleExpiresAt: Date, now: Date) => Promise<SessionRow | null>;
  /** 单会话登出：置 revoked_at 墓碑。 */
  revoke: (sessionId: string, at: Date) => Promise<SessionRow | null>;
  /** 全设备登出 / 账号停用：撤销某用户所有未撤销会话，返回撤销条数。 */
  revokeAllForUser: (userId: string, at: Date) => Promise<number>;
  /** 清扫：硬删绝对过期的死会话（墓碑/未过期保留）。返回删除条数。 */
  deleteExpired: (now: Date) => Promise<number>;
};

// ——— 纯函数（无 DB，可单测）———

/** 生成会话明文 secret（base64url，48 字节熵；mirror auth.ts makeClientToken）。 */
export function generateSessionToken(): string {
  return randomBytes(48).toString("base64url");
}

/** 会话 token 落库哈希（sha256 hex；mirror auth.ts hashClientToken，明文永不落库）。 */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** 会话有效性判定：未撤销 且 当前时刻早于绝对过期 与 滑动过期。 */
export function isSessionActive(
  row: Pick<SessionRow, "revokedAt" | "absoluteExpiresAt" | "idleExpiresAt">,
  now: Date
): boolean {
  if (row.revokedAt !== null) {
    return false;
  }
  return now < row.absoluteExpiresAt && now < row.idleExpiresAt;
}

/** 续期后的滑动过期 = min(now + idleTtl, 绝对过期)——滑动永不越过硬上限。 */
export function nextIdleExpiry(now: Date, idleTtlMs: number, absoluteExpiresAt: Date): Date {
  const slid = new Date(now.getTime() + idleTtlMs);
  return slid < absoluteExpiresAt ? slid : absoluteExpiresAt;
}

export function createSessionRepository(db: WorkHubDb): SessionRepository {
  return {
    async create(input) {
      const rows = await db
        .insert(sessions)
        .values({
          id: input.id ?? randomUUID(),
          userId: input.userId,
          tokenHash: input.tokenHash,
          authMethod: input.authMethod ?? "password",
          oidcProvider: input.oidcProvider ?? null,
          ipHash: input.ipHash ?? null,
          userAgent: input.userAgent ?? null,
          absoluteExpiresAt: input.absoluteExpiresAt,
          idleExpiresAt: input.idleExpiresAt
        })
        .returning();
      const session = rows[0];
      if (!session) {
        throw new Error("Failed to create session");
      }
      return session;
    },

    async findActiveByTokenHash(tokenHash, now) {
      const rows = await db
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.tokenHash, tokenHash),
            isNull(sessions.revokedAt),
            gt(sessions.absoluteExpiresAt, now),
            gt(sessions.idleExpiresAt, now)
          ) as SQL
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async touch(sessionId, idleExpiresAt, now) {
      const rows = await db
        .update(sessions)
        .set({ idleExpiresAt, lastSeenAt: now, updatedAt: now })
        .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)) as SQL)
        .returning();
      return rows[0] ?? null;
    },

    async revoke(sessionId, at) {
      const rows = await db
        .update(sessions)
        .set({ revokedAt: at, updatedAt: at })
        .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)) as SQL)
        .returning();
      return rows[0] ?? null;
    },

    async revokeAllForUser(userId, at) {
      const rows = await db
        .update(sessions)
        .set({ revokedAt: at, updatedAt: at })
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)) as SQL)
        .returning({ id: sessions.id });
      return rows.length;
    },

    async deleteExpired(now) {
      // 只硬删绝对过期(确定死)的行；未过期墓碑保留，留作短期审计 + 防止 token_hash 立刻被复用。
      const rows = await db
        .delete(sessions)
        .where(lt(sessions.absoluteExpiresAt, now))
        .returning({ id: sessions.id });
      return rows.length;
    }
  };
}
