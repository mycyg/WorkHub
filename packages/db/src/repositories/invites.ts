import { randomUUID } from "node:crypto";

import { and, eq, gt, isNull } from "drizzle-orm";

import type { WorkHubDb } from "../client.js";
import { userInvites } from "../schema/index.js";

// R2 auth epic（账号生命周期-邀请，out-of-band）：邀请仓库。与 sessions/credentials 同范式——仓库只认
// token_hash（明文邀请 token 永不落库，只回管理员一次）。Phase 1 不接线（无路由），待邀请路由调用。

export type UserInviteRow = typeof userInvites.$inferSelect;
export type InviteRole = "member" | "admin" | "owner";

export type CreateInviteInput = {
  id?: string;
  email: string;
  tokenHash: string;
  invitedByUserId?: string | null;
  role?: InviteRole;
  workspaceId?: string | null;
  expiresAt: Date;
};

export type InviteRepository = {
  create: (input: CreateInviteInput) => Promise<UserInviteRow>;
  /** 凭 token_hash 取仍可用的邀请：未接受 ∧ 未撤销 ∧ 未过期。 */
  findActiveByTokenHash: (tokenHash: string, now: Date) => Promise<UserInviteRow | null>;
  /** 接受邀请：记 accepted_at + accepted_user_id（幂等：仅未接受行翻墓碑，防重复使用）。 */
  accept: (id: string, acceptedUserId: string, at: Date) => Promise<UserInviteRow | null>;
  /** 管理员撤销邀请（软删）。 */
  revoke: (id: string, at: Date) => Promise<UserInviteRow | null>;
  /** 某邮箱的待接受邀请（未接受 ∧ 未撤销）。 */
  listPendingForEmail: (email: string) => Promise<UserInviteRow[]>;
};

export function createInviteRepository(db: WorkHubDb): InviteRepository {
  return {
    async create(input) {
      const rows = await db
        .insert(userInvites)
        .values({
          id: input.id ?? randomUUID(),
          email: input.email,
          tokenHash: input.tokenHash,
          invitedByUserId: input.invitedByUserId ?? null,
          role: input.role ?? "member",
          workspaceId: input.workspaceId ?? null,
          expiresAt: input.expiresAt
        })
        .returning();
      const invite = rows[0];
      if (!invite) {
        throw new Error("Failed to create user invite");
      }
      return invite;
    },

    async findActiveByTokenHash(tokenHash, now) {
      const rows = await db
        .select()
        .from(userInvites)
        .where(
          and(
            eq(userInvites.tokenHash, tokenHash),
            isNull(userInvites.acceptedAt),
            isNull(userInvites.deletedAt),
            gt(userInvites.expiresAt, now)
          )
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async accept(id, acceptedUserId, at) {
      const rows = await db
        .update(userInvites)
        .set({ acceptedAt: at, acceptedUserId, updatedAt: at })
        .where(and(eq(userInvites.id, id), isNull(userInvites.acceptedAt), isNull(userInvites.deletedAt)))
        .returning();
      return rows[0] ?? null;
    },

    async revoke(id, at) {
      const rows = await db
        .update(userInvites)
        .set({ deletedAt: at, updatedAt: at })
        .where(and(eq(userInvites.id, id), isNull(userInvites.deletedAt)))
        .returning();
      return rows[0] ?? null;
    },

    async listPendingForEmail(email) {
      return db
        .select()
        .from(userInvites)
        .where(and(eq(userInvites.email, email), isNull(userInvites.acceptedAt), isNull(userInvites.deletedAt)));
    }
  };
}
